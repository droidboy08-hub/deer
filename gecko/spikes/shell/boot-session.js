// Spike 6: session restore across a real restart, with Firefox's chrome hidden.
//   phase 1 (save):    python tools/run.py --boot spikes/shell/boot-session.js --name shell-session --pref vitre.spike.phase=1
//   phase 2 (restore): python tools/run.py --boot spikes/shell/boot-session.js --name shell-session --keep-profile
//                        --pref vitre.spike.phase=2 --pref browser.startup.page=3 --pref browser.sessionstore.resume_from_crash=true
/* global spike, vt, Services, gBrowser, VitreUI, SessionStore, PathUtils, IOUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const phase = Services.prefs.getIntPref("vitre.spike.phase", 1);
    await spike.resize(1280, 800);
    vt.install();
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const recovery = PathUtils.join(PathUtils.profileDir, "sessionstore-backups", "recovery.jsonlz4");

    if (phase === 1) {
      gBrowser.selectedBrowser.fixupAndLoadURIString("https://en.wikipedia.org/wiki/Glass", { triggeringPrincipal: sys });
      await vt.tabLoaded(gBrowser.selectedTab);
      const t2 = await vt.openTab("https://example.com/", { select: true });
      const t3 = await vt.openTab("https://www.mozilla.org/en-US/", { select: false });
      await vt.until(() => t3.getAttribute("image"), 6000);
      gBrowser.pinTab(t3);
      await spike.sleep(1500);
      spike.log("phase 1 tabs", gBrowser.tabs.map((t) => `${t.selected ? "*" : ""}${t.pinned ? "(pinned) " : ""}${t.linkedBrowser.currentURI.spec}`));
      spike.log("phase 1 bar", vt.barState().items.map((i) => `${i.active ? "*" : ""}${i.host}`));
      await spike.capture("session-1-before-quit");
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      const { SessionSaver } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs");
      await TabStateFlusher.flushWindow(window);
      await SessionSaver.run();
      await spike.sleep(500);
      spike.log("session file written", await IOUtils.exists(recovery), recovery.replace(/.*vitre-gecko-/, "…vitre-gecko-"));
      return;
    }

    // phase 2: Firefox restores the previous session by itself; the shell is installed on top.
    spike.log("phase 2 start", { tabsAtBoot: gBrowser.tabs.length, sessionFile: await IOUtils.exists(recovery), startupPage: Services.prefs.getIntPref("browser.startup.page") });
    await Promise.race([SessionStore.promiseAllWindowsRestored, spike.sleep(15000)]);
    await vt.until(() => gBrowser.tabs.length >= 3, 10000);
    await spike.sleep(2500);
    spike.log("restored tabs", gBrowser.tabs.map((t) => `${t.selected ? "*" : ""}${t.pinned ? "(pinned) " : ""}${t.hasAttribute("pending") ? "(pending) " : ""}${t.label}`));
    spike.log("restored bar", vt.barState().items.map((i) => `${i.active ? "*" : ""}${i.host} | ${i.title} | ${i.icon?.slice(0, 24)}`));
    await spike.capture("session-2-restored");
    // activate a tab that has not loaded yet: Firefox restores it on demand
    const pending = gBrowser.tabs.find((t) => t.hasAttribute("pending"));
    if (pending) {
      const item = VitreUI.bar.items.get(pending);
      await vt.click(...vt.center(item), { wait: 500 });
      await vt.tabLoaded(pending);
      await spike.sleep(800);
      spike.log("activated a pending tab", { selected: pending.selected, pending: pending.hasAttribute("pending"), uri: pending.linkedBrowser.currentURI.spec, pill: vt.barState().items.find((i) => i.active) });
      await spike.capture("session-3-pending-activated");
    } else {
      spike.log("no pending tab to activate");
    }
  });
}
