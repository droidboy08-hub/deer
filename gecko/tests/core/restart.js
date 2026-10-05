// Settings survive a restart, and the harness follows an in-place restart.
//   python tools/run.py --test tests/core/restart.js --name core-restart --timeout 120
// Run 1 writes settings and restarts in place; run 2 (same profile, new process) reads them back.
/* global spike, Services */
spike.main(async () => {
  const b = window.vitre;
  const settings = b.sys("VitreSettings");
  const wanted = {
    theme: "dark",
    appIcon: "orange",
    barAutoHide: true,
    pageInset: false,
    homeBackground: { kind: "image", path: "D:\\Pictures\\caf\u00e9 #2 \u65e5\u672c.png" },
    switcherStyle: "grid",
    tabOrder: "bar",
    typeToSearch: false,
    closeButton: "always",
    newTabPosition: "end",
    selectionSearchOpens: "tab",
    shiftClick: "window",
    rebind: { peekLink: "Ctrl+K", switcherSearch: "Ctrl+Shift+E" },
    searchEngine: "duckduckgo",
    downloadsFolder: "D:\\Downloads\\Deer",
    askWhereToSave: true,
    connections: 16,
    speedLimitKBps: 2048,
    // Added to Settings by the downloads module (src/shared/settings.ts); compared as a whole below.
    ffmpegPath: "C:\\Tools\\ffmpeg\\ffmpeg.exe",
  };
  spike.log("run", spike.run, "pid", Services.appinfo.processID);
  if (spike.run === 1) {
    spike.check("first start has the defaults", settings.get().theme === "system" && settings.get().connections === 8);
    settings.set(wanted);
    await spike.sleep(50);
    spike.check("set() wrote every field", JSON.stringify(settings.get()) === JSON.stringify(wanted), settings.get());
    spike.check("Firefox's own pref follows newTabPosition", Services.prefs.getBoolPref("browser.tabs.insertAfterCurrent") === false);
    await spike.capture("restart-1-before");
    spike.log("restarting in place");
    await spike.restart();
  } else {
    spike.check("the restarted process is followed by the harness", spike.run === 2);
    spike.check("settings survived the restart", JSON.stringify(settings.get()) === JSON.stringify(wanted), settings.get());
    spike.check("the window's copy has them", b.settings.searchEngine === "duckduckgo" && b.settings.rebind.peekLink === "Ctrl+K");
    spike.check("engine pref synced at startup", Services.prefs.getBoolPref("browser.tabs.insertAfterCurrent") === false);
    spike.check("the window opened with the chosen app icon", document.documentElement.getAttribute("icon") === "deer-orange", document.documentElement.getAttribute("icon"));
    await spike.resize(1100, 700);
    await spike.capture("restart-2-after");
  }
});
