// VERIFY switcher/session: a restored Home tab that is the SELECTED tab at startup, with
// about:vitre-home registered late (at boot-script time = browser-delayed-startup-finished).
// The spike could not produce this because tools/run.py always passes a URL (which takes the
// selection). run_v.py starts Firefox without a URL.
// Run 1: python spikes/switcher/verify/run_v.py --boot spikes/switcher/verify/v-restore.js --name switcher-verify-vrest --out spikes/switcher/verify/out/v-restore1 --timeout 120
// Run 2: python spikes/switcher/verify/run_v.py --boot spikes/switcher/verify/v-restore.js --name switcher-verify-vrest --out spikes/switcher/verify/out/v-restore2 --timeout 120 --keep-profile --pref browser.startup.page=3 --url vitre:none
// Run 2b (after a fresh run 1, other --name/--out): add --pref vitre.verify.registerAtTop=true  -> registers at the top of the boot script
// Also checks: tab.lastAccessed really is the saved value after a restart, undoCloseWindow, Sanitizer.showUI.
/* global gBrowser, Services, Ci, Cc, spike, vx, SessionStore, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
(async () => {
  if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) return;
  const bootAt = Date.now();
  const second = Services.prefs.getBoolPref("vitre.verify.restoreSecondRun", false);
  const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
  // Variant "registerAtTop" (run 2b): register synchronously, before the first await of this boot
  // script, i.e. inside the browser-delayed-startup-finished notification itself.
  const atTop = second && Services.prefs.getBoolPref("vitre.verify.registerAtTop", false);
  if (atTop) VitreHomeAbout.register("resource://vitre-boot/");
  const describe = (t) => {
    const b = t.linkedBrowser;
    const doc = b.contentDocument;
    return {
      uri: b.currentURI?.spec,
      label: t.label,
      selected: t.selected,
      pending: t.hasAttribute("pending"),
      remoteType: b.remoteType,
      doc: doc ? doc.documentURI.slice(0, 90) : b.isRemoteBrowser ? "(remote)" : "(none)",
      homeReady: !!doc?.documentElement?.dataset?.ready,
    };
  };
  try {
    if (!second) {
      await spike.resize(1280, 800);
      VitreHomeAbout.register("resource://vitre-boot/");
      const first = gBrowser.selectedTab;
      const web = vx.addTab("https://example.com/");
      await vx.waitLoaded(web.linkedBrowser);
      gBrowser.selectedTab = web;
      await spike.sleep(1200);
      const home = vx.addTab(VitreHomeAbout.URL);
      gBrowser.selectedTab = home;
      for (let i = 0; i < 200 && !home.linkedBrowser.contentDocument?.documentElement?.dataset?.ready; i++) await spike.sleep(25);
      gBrowser.removeTab(first);
      await spike.sleep(1500);

      // --- undoCloseWindow (claim 41, unverified in the spike) ---
      const win2 = OpenBrowserWindow();
      await new Promise((r) => {
        const obs = (w) => {
          if (w === win2) {
            Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
            r();
          }
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
      const w2tab = win2.gBrowser.addTab("https://example.org/", { triggeringPrincipal: vx.SYS });
      await vx.waitLoaded(w2tab.linkedBrowser);
      win2.gBrowser.selectedTab = w2tab;
      await spike.sleep(800);
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      await TabStateFlusher.flushWindow(win2);
      const closedBefore = SessionStore.getClosedWindowCount();
      win2.close();
      await spike.sleep(800);
      const closedAfter = SessionStore.getClosedWindowCount();
      const win3 = SessionStore.undoCloseWindow(0);
      await new Promise((r) => win3.addEventListener("SSWindowStateReady", r, { once: true }));
      await spike.sleep(1500);
      spike.log("W undoCloseWindow: closed-window count", closedBefore, "->", closedAfter, "| reopened window tabs:",
        win3.gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec + (t.selected ? " (selected)" : "")), "| count now", SessionStore.getClosedWindowCount());
      win3.close();
      await spike.sleep(600);
      SessionStore.forgetClosedWindow(0);

      // --- Sanitizer.showUI (claim 41) ---
      {
        const { Sanitizer } = ChromeUtils.importESModule("resource:///modules/Sanitizer.sys.mjs");
        const opened = new Promise((resolve) => {
          const seen = [];
          const obs = {
            observe(subject, topic) {
              const w = subject;
              w.addEventListener("load", () => {
                seen.push(w.location.href);
                resolve({ kind: "window", url: w.location.href, win: w });
              }, { once: true });
            },
          };
          Services.ww.registerNotification(obs);
          // Firefox may show it as a tab-modal / window-modal SubDialog instead of a window
          const poll = async () => {
            for (let i = 0; i < 60; i++) {
              await spike.sleep(100);
              const frames = [...document.querySelectorAll("browser.dialogFrame, .dialogFrame")].map((f) => f.currentURI?.spec || f.getAttribute("src")).filter((u) => u && u !== "about:blank");
              if (frames.length) return resolve({ kind: "subdialog in the browser window", url: frames[0] });
            }
            resolve({ kind: "nothing appeared in 6 s", seen });
          };
          poll();
          setTimeout(() => Services.ww.unregisterNotification(obs), 7000);
        });
        let threw = null;
        try {
          Sanitizer.showUI(window);
        } catch (e) {
          threw = String(e);
        }
        const r = await opened;
        spike.log("S Sanitizer.showUI(window):", threw ? "THREW " + threw : "called", "->", r.kind, r.url);
        await spike.capture("v-sanitizer-showui");
        if (r.win) r.win.close();
        else window.gDialogBox?.dialog?.close?.();
        for (const f of document.querySelectorAll(".dialogFrame")) f.contentWindow?.close?.();
        await spike.sleep(500);
      }

      gBrowser.selectedTab = home;
      await spike.sleep(600);
      const la = gBrowser.tabs.map((t) => (t.selected ? "selected" : t.lastAccessed));
      Services.prefs.setStringPref("vitre.verify.lastAccessed", JSON.stringify({ at: Date.now(), la }));
      spike.log("RUN 1 before quit:", gBrowser.tabs.map(describe));
      spike.log("RUN 1 lastAccessed (ms ago):", gBrowser.tabs.map((t) => (t.selected ? "selected" : Date.now() - t.lastAccessed)));
      Services.prefs.setBoolPref("vitre.verify.restoreSecondRun", true);
      Services.prefs.savePrefFile(null);
      await TabStateFlusher.flushWindow(window);
      ChromeUtils.importESModule("resource://vitre-boot/modules/SpikeQuit.sys.mjs").cleanQuit(Services.env.get("VITRE_LOG"));
      return;
    }

    // ---------------- run 2: nothing registered when the session was restored ----------------
    const early = atTop;
    spike.log("RUN 2 boot script running; about:vitre-home registered synchronously at the top of the boot script:", early, "| args had no URL");
    spike.log("RUN 2 at boot-script time:", gBrowser.tabs.map(describe));
    await SessionStore.promiseAllWindowsRestored;
    await spike.sleep(1500);
    await spike.resize(1280, 800);
    spike.log("RUN 2 1.5 s after windows restored" + (early ? "" : ", still unregistered") + ":", gBrowser.tabs.map(describe));
    const saved = JSON.parse(Services.prefs.getStringPref("vitre.verify.lastAccessed", "{}"));
    spike.log("RUN 2 lastAccessed: saved in run 1", saved.la, "| now", gBrowser.tabs.map((t) => (t.selected ? "selected" : t.lastAccessed)),
      "| run 1 ended", Math.round((bootAt - saved.at) / 1000), "s before this boot script started");
    await spike.capture("v-restore-selected-home-before");
    if (!early) {
      VitreHomeAbout.register("resource://vitre-boot/");
      await spike.sleep(1000);
      const sel = gBrowser.selectedTab;
      spike.log("RUN 2 registered late, nothing else done:", describe(sel));
      // repair: every tab that points at Home but is not showing it
      const broken = gBrowser.tabs.filter((t) => !t.hasAttribute("pending") && t.linkedBrowser.currentURI?.spec === VitreHomeAbout.URL && !t.linkedBrowser.contentDocument?.documentElement?.dataset?.ready);
      spike.log("RUN 2 tabs needing repair:", broken.length);
      const t0 = performance.now();
      for (const t of broken) t.linkedBrowser.reload();
      let ok = false;
      for (let i = 0; i < 200 && !(ok = !!sel.linkedBrowser.contentDocument?.documentElement?.dataset?.ready); i++) await spike.sleep(25);
      spike.log("RUN 2 after browser.reload():", describe(sel), "ready", ok, "in", vx.ms(t0), "ms", "| canGoBack", sel.linkedBrowser.canGoBack);
    }
    await spike.sleep(500);
    await spike.capture("v-restore-selected-home-after");
    spike.quit();
  } catch (e) {
    spike.log("ERROR " + e + "\n" + (e.stack || ""));
    spike.quit();
  }
})();
