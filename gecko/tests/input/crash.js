// Crash recovery, as Firefox does it: the process is killed (no clean shutdown) and the next start
// brings the tabs back. Driven by tests/input/crash.py, which runs this script twice on one profile:
// run 1 opens tabs, has the session written, and is then killed by the harness; run 2 checks.
// Capture: crash-2-recovered.png.
/* global spike, Services, ChromeUtils, gBrowser, IOUtils, PathUtils, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  await spike.resize(1200, 760);

  if (spike.run === 1) {
    await K.load(K.dataPage("First tab", "The first tab."));
    b.newTab(K.dataPage("Second tab", "The second tab.", "#14161c"), { index: 1 });
    b.newTab("about:vitre-home", { background: true, index: 2 });
    await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading), { what: "three tabs" });
    await sleep(500);
    check("before the crash: three tabs, the second one selected", b.tabs.length === 3 && b.active().title === "Second tab", b.tabs.map((t) => t.title));
    // Firefox collects each tab's history from its page and writes the session every 15 s. Ask for
    // both now, so the kill comes after a write, as it would in a session that ran a little longer.
    const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
    const { SessionSaver } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs");
    await TabStateFlusher.flushWindow(window);
    await SessionSaver.run();
    await sleep(500);
    Services.prefs.savePrefFile(null);
    log("session written; the harness kills the process now");
    spike.log("@@quit"); // the runner stops the process tree with taskkill /F: no clean shutdown
    await new Promise(() => {});
    return;
  }

  try {
    const { SessionStartup } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStartup.sys.mjs");
    log("run 2: previous session crashed " + SessionStartup.previousSessionCrashed + ", session type " + SessionStartup.sessionType + ", will restore " + SessionStartup.willRestore());
  } catch (e) {
    log("run 2: SessionStartup not readable: " + e);
  }
  log("run 2: tabs at start " + JSON.stringify(b.tabs.map((t) => t.url.slice(0, 28))));
  await waitFor(() => b.tabs.filter((t) => t.url.startsWith("data:text/html") || t.url === "about:vitre-home").length === 3, { timeout: 25000, what: "tabs recovered after the crash" });
  await sleep(800);
  const restored = b.tabs.filter((t) => t.url !== "about:blank");
  log("recovered: " + JSON.stringify(b.tabs.map((t) => ({ title: t.title, url: t.url.slice(0, 28), deferred: t.deferred }))));
  check("after a crash the tabs come back in order (Firefox's session recovery)", restored.length === 3 && restored[0].title === "First tab" && restored[1].title === "Second tab" && restored[2].url === "about:vitre-home", restored.map((t) => t.title));
  check("no crash page or prompt stands in the way", !b.tabs.some((t) => t.url.startsWith("about:sessionrestore") || t.url.startsWith("about:welcomeback")));
  b.activate(restored[1]);
  await waitFor(() => !restored[1].deferred && !restored[1].loading, { timeout: 15000, what: "recovered tab loading" });
  await sleep(500);
  await spike.capture("crash-2-recovered");
});
