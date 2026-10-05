// PROBE: what happens to a restored Home tab if about:vitre-home is registered late?
// The spike harness loads boot scripts at browser-delayed-startup-finished, which is after session
// restore has started on the selected tab. A real build can register earlier (AutoConfig).
// Run 1: python tools/run.py --boot spikes/switcher/probe-home-restore.js --name switcher-probe-restore --out spikes/switcher/out/probe-restore --timeout 90
// Run 2: python tools/run.py --boot spikes/switcher/probe-home-restore.js --name switcher-probe-restore --out spikes/switcher/out/probe-restore2 --timeout 90 --keep-profile --pref browser.startup.page=3
/* global gBrowser, Services, Ci, Cc, spike, vx, SessionStore */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
(async () => {
  const second = Services.prefs.getBoolPref("vitre.spike.restoreSecondRun", false);
  const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
  const describe = () => gBrowser.tabs.map((t) => ({
    uri: t.linkedBrowser.currentURI.spec,
    pending: t.hasAttribute("pending"),
    selected: t.selected,
    doc: t.linkedBrowser.contentDocument?.documentURI?.slice(0, 70) ?? (t.linkedBrowser.isRemoteBrowser ? "(remote)" : "(none)"),
    label: t.label,
  }));
  try {
    await spike.resize(1280, 800);
    if (!second) {
      VitreHomeAbout.register("resource://vitre-boot/");
      const home = vx.addTab(VitreHomeAbout.URL);
      gBrowser.selectedTab = home;
      for (let i = 0; i < 200 && !home.linkedBrowser.contentDocument?.documentElement?.dataset?.ready; i++) await spike.sleep(25);
      gBrowser.removeTab(gBrowser.tabs[0]);
      await spike.sleep(300);
      spike.log("RUN 1 tabs before quit", describe());
      Services.prefs.setBoolPref("vitre.spike.restoreSecondRun", true);
      Services.prefs.savePrefFile(null);
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      await TabStateFlusher.flushWindow(window);
      ChromeUtils.importESModule("resource://vitre-boot/modules/SpikeQuit.sys.mjs").cleanQuit(Services.env.get("VITRE_LOG"));
      return;
    }
    // run 2: nothing registered yet
    spike.log("RUN 2 at boot-script time, before registering about:vitre-home:", describe());
    await SessionStore.promiseAllWindowsRestored;
    await spike.sleep(1000);
    spike.log("RUN 2 after windows restored, still unregistered:", describe());
    await spike.capture("restore-before-register");
    VitreHomeAbout.register("resource://vitre-boot/");
    const home = gBrowser.tabs.find((t) => /vitre-home/.test(t.linkedBrowser.currentURI.spec) || /vitre-home/.test(t.linkedBrowser.contentDocument?.documentURI ?? ""));
    if (home) {
      gBrowser.selectedTab = home;
      await spike.sleep(800);
      spike.log("RUN 2 registered, Home tab selected (no reload):", describe().find((d) => d.selected));
      home.linkedBrowser.reload();
      await spike.sleep(1200);
      spike.log("RUN 2 after reload:", describe().find((d) => d.selected), "ready", !!home.linkedBrowser.contentDocument?.documentElement?.dataset?.ready);
    } else {
      spike.log("RUN 2 no tab refers to vitre-home any more");
    }
    await spike.capture("restore-after-register");
    spike.quit();
  } catch (e) {
    spike.log("ERROR " + e + "\n" + (e.stack || ""));
    spike.quit();
  }
})();
