// Spike 3+5: the per-window entry point (category hooks) in new, private, popup and torn-off windows.
//   python tools/run.py --boot spikes/shell/boot-windows.js --name shell-windows --timeout 200
//   --pref vitre.spike.nativepopup=true  : leave Firefox's native caption on popup windows
/* global spike, vt, Services, gBrowser, VitreUI, OpenBrowserWindow, BrowserWindowTracker, PrivateBrowsingUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const nativePopup = Services.prefs.getBoolPref("vitre.spike.nativepopup", false);
    const tag = nativePopup ? "windows-nativepopup" : "windows";
    await spike.resize(1280, 800);
    const shell = vt.register();
    shell.customTitlebarForPopups = !nativePopup;
    shell.adopt(window);
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("opener.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    spike.log("categories registered", {
      beforeLayout: [...Services.catMan.enumerateCategory("browser-window-before-initial-xul-layout")].map((e) => e.value).filter((v) => v.startsWith("Vitre")),
      dcl: [...Services.catMan.enumerateCategory("browser-window-domcontentloaded")].map((e) => e.value).filter((v) => v.startsWith("Vitre")),
      delayed: [...Services.catMan.enumerateCategory("browser-window-delayed-startup")].map((e) => e.value).filter((v) => v.startsWith("Vitre")),
    });

    // The first window stays alive (it owns this script) but small, so captures pick the other window.
    const shrink = async () => {
      window.resizeTo(480, 360);
      window.moveTo(1500, 700);
      await spike.sleep(300);
    };
    const started = (win) =>
      new Promise((resolve) => {
        if (win.gBrowserInit?.delayedStartupFinished) return resolve();
        const obs = (subject) => {
          if (subject === win) {
            Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
            resolve();
          }
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
    const describe = (win) => {
      const root = win.document.documentElement;
      const id = win.docShell.outerWindowID;
      const cs = (sel) => {
        const e = win.document.querySelector(sel);
        return e ? win.getComputedStyle(e).display : "(missing)";
      };
      return {
        id,
        hooks: shell.timeline.filter((t) => t.win === id).map((t) => `${t.hook}@${t.ms}ms${t.readyState ? "(" + t.readyState + ")" : ""}`),
        vitreAttr: root.getAttribute("vitre"),
        uiMounted: !!win.VitreUI?.root,
        popupWindow: root.hasAttribute("popup-window"),
        chromehidden: root.getAttribute("chromehidden"),
        customtitlebar: root.hasAttribute("customtitlebar"),
        private: PrivateBrowsingUtils.isWindowPrivate(win),
        privatebrowsingmode: root.getAttribute("privatebrowsingmode"),
        navBar: cs("#nav-bar"),
        tabsToolbar: cs("#TabsToolbar"),
        inner: [win.innerWidth, win.innerHeight],
        outer: [win.outerWidth, win.outerHeight],
        browserRect: vt.rect(win.gBrowser.selectedBrowser),
        bar: vt.barState(win),
        routed: !!win.XULPopupElement.prototype.vitreRouted,
        doorhangerHook: String(win.PopupNotifications?._getVisibleAnchorElement).includes("VitreUI"),
      };
    };
    const place = async (win, w = 1100, h = 720) => {
      win.resizeTo(w, h);
      win.moveTo(60, 60);
      await spike.sleep(500);
    };

    // ---- 1. new normal window
    await shrink();
    {
      const t = ChromeUtils.now();
      const win = OpenBrowserWindow();
      await started(win);
      spike.log("new window: started in", Math.round(ChromeUtils.now() - t), "ms");
      await place(win);
      win.gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: sys });
      await vt.tabLoaded(win.gBrowser.selectedTab);
      await spike.sleep(1800);
      spike.log("new window", describe(win));
      // the bar in the second window works on its own gBrowser
      await vt.click(...vt.center(win.VitreUI.bar.plus), { wait: 700 }, win);
      spike.log("new window: click plus -> tabs", win.gBrowser.tabs.length, "| first window tabs", gBrowser.tabs.length);
      win.gBrowser.selectedTab = win.gBrowser.tabs[0];
      await spike.sleep(500);
      await spike.capture(`${tag}-1-new-window`);
      win.close();
      await spike.sleep(500);
    }

    // ---- 2. private window
    {
      const win = OpenBrowserWindow({ private: true });
      await started(win);
      await place(win);
      win.gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: sys });
      await vt.tabLoaded(win.gBrowser.selectedTab);
      await spike.sleep(1800);
      spike.log("private window", describe(win));
      await spike.capture(`${tag}-2-private-window`);
      // the private start page too
      win.BrowserCommands.openTab();
      await spike.sleep(1500);
      spike.log("private new tab", { uri: win.gBrowser.currentURI.spec, pill: vt.barState(win).items.find((i) => i.active) });
      await spike.capture(`${tag}-2b-private-newtab`);
      win.close();
      await spike.sleep(500);
    }

    // ---- 3. popup window: window.open(url, name, "width=..,height=..") from a page
    {
      window.resizeTo(1280, 800);
      window.moveTo(40, 40);
      await spike.sleep(500);
      const before = new Set(BrowserWindowTracker.orderedWindows);
      await vt.click(100, 112, { wait: 300 }); // #pop button of opener.html
      const win = await vt.until(() => BrowserWindowTracker.orderedWindows.find((w) => !before.has(w)) || [...Services.wm.getEnumerator("navigator:browser")].find((w) => !before.has(w)), 10000);
      spike.log("popup: opener says", gBrowser.selectedTab.label, "| window found", !!win);
      if (win) {
        await started(win);
        await vt.tabLoaded(win.gBrowser.selectedTab);
        await spike.sleep(1500);
        await shrink();
        // a popup keeps the size the page asked for; make it the largest window for the capture
        win.resizeTo(700, 500);
        win.moveTo(60, 60);
        await spike.sleep(800);
        spike.log("popup window", describe(win));
        spike.log("popup NCHITTEST", {
          y4: vt.hit(300, 4, win),
          y9: vt.hit(300, 9, win),
          y30: vt.hit(60, 30, win),
          min: win.document.getElementById("vitre-win-min") ? vt.hit(...vt.center(win.document.getElementById("vitre-win-min")), win) : null,
          toolbarVisible: win.toolbar.visible,
          locationbarVisible: win.locationbar.visible,
        });
        await spike.capture(`${tag}-3-popup-window`);
        win.close();
        await spike.sleep(500);
      }
    }

    // ---- 4. window.open without features and target=_blank: a new tab in the same window
    {
      window.resizeTo(1280, 800);
      window.moveTo(40, 40);
      await spike.sleep(400);
      VitreUI.bar.events.length = 0;
      await vt.click(280, 112, { wait: 1500 }); // #tab button
      spike.log("window.open() without features ->", { tabs: gBrowser.tabs.length, windows: BrowserWindowTracker.orderedWindows.length, events: VitreUI.bar.events.join(" ") });
      await vt.tabLoaded(gBrowser.selectedTab);
      spike.log("  opened tab", { uri: gBrowser.currentURI.spec, bar: vt.barState().items.map((i) => (i.active ? "*" : "") + i.host) });
    }

    // ---- 5. tear a tab off into its own window (Move tab to new window)
    {
      const tab = gBrowser.selectedTab;
      const before = new Set(BrowserWindowTracker.orderedWindows);
      const win = gBrowser.replaceTabWithWindow(tab);
      await started(win);
      await vt.until(() => win.gBrowser.currentURI.spec.startsWith("https://example.com"), 8000);
      await shrink();
      await place(win);
      await spike.sleep(1200);
      spike.log("torn-off window", describe(win));
      spike.log("  first window after tear-off", { tabs: gBrowser.tabs.length, items: VitreUI.bar.items.size });
      await spike.capture(`${tag}-5-torn-off-window`);
      win.close();
      await spike.sleep(400);
    }

    spike.log("timeline", shell.timeline);
  });
}
