// Spike 6: F11 full screen, element (video) full screen, a crashed content process, and
// reopening closed tabs/windows, all with Firefox's own chrome hidden.
//   python tools/run.py --boot spikes/shell/boot-states.js --name shell-states --timeout 200
/* global spike, vt, Services, gBrowser, VitreUI, SessionStore, BrowserWindowTracker, FullScreen */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const shell = vt.install();
    const d = document;
    const root = d.documentElement;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const EU = vt.EU();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(500);
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e), e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : "");
      }
    };
    const barVisible = () => {
      const bar = d.getElementById("vitre-bar");
      const cs = getComputedStyle(bar);
      const r = VitreUI.bar.items.get(gBrowser.selectedTab).getBoundingClientRect();
      return { opacity: cs.opacity, pillTop: Math.round(r.top), rootDisplay: getComputedStyle(VitreUI.root).display };
    };
    const state = () => ({
      fullScreen: window.fullScreen,
      inFullscreen: root.hasAttribute("inFullscreen"),
      inDOMFullscreen: root.hasAttribute("inDOMFullscreen"),
      sizemode: root.getAttribute("sizemode"),
      customtitlebar: root.hasAttribute("customtitlebar"),
      inner: [window.innerWidth, window.innerHeight],
      screen: [screen.width, screen.height],
      browser: vt.rect(gBrowser.selectedBrowser),
      toolbox: vt.rect(d.getElementById("navigator-toolbox")),
      bar: barVisible(),
    });

    // ---- F11 (the real key path: keyset -> View:FullScreen -> BrowserCommands.fullScreen)
    await step("F11", async () => {
      spike.log("before F11", state());
      EU.synthesizeKey("KEY_F11", {}, window);
      await vt.until(() => window.fullScreen && root.hasAttribute("inFullscreen"), 6000);
      await vt.move(600, 400);
      await spike.sleep(1500);
      spike.log("after F11", state());
      await spike.capture("states-1-f11");
      // reveal: pointer at the very top edge
      await vt.move(640, 2);
      await spike.sleep(700);
      spike.log("F11 + pointer at top edge", { hoverReveal: d.getElementById("vitre-reveal").matches(":hover"), ...barVisible() });
      await spike.capture("states-2-f11-revealed");
      // pointer on the bar keeps it open; a click on a bar item works
      const pill = VitreUI.bar.items.get(gBrowser.selectedTab);
      await vt.move(...vt.center(pill));
      await spike.sleep(500);
      spike.log("F11 pointer on pill", { pillHover: pill.matches(":hover"), ...barVisible() });
      await vt.move(600, 500);
      await spike.sleep(800);
      spike.log("F11 pointer back on page", barVisible());
      EU.synthesizeKey("KEY_F11", {}, window);
      await vt.until(() => !window.fullScreen, 6000);
      await spike.sleep(1200);
      spike.log("after second F11", state());
      await spike.capture("states-3-after-f11");
    });

    // ---- element full screen (video.requestFullscreen() from a click in the page)
    await step("dom fullscreen", async () => {
      // Gecko refuses element full screen unless this window is the active one; other spikes
      // running in parallel can take OS focus, so retry a few times.
      for (let i = 0; i < 5 && !root.hasAttribute("inDOMFullscreen"); i++) {
        window.focus();
        await vt.click(541, 128, { wait: 300 }); // "Video full screen" button
        await vt.until(() => root.hasAttribute("inDOMFullscreen"), 3000);
        spike.log("element full screen attempt", i + 1, { active: Services.focus.activeWindow === window, ok: root.hasAttribute("inDOMFullscreen"), page: gBrowser.selectedTab.label });
      }
      await spike.sleep(1500);
      spike.log("element full screen", { ...state(), chromeFullscreenElement: d.fullscreenElement?.localName, pageTitle: gBrowser.selectedTab.label, warning: d.getElementById("fullscreen-warning")?.getAttribute("onscreen") !== null });
      await spike.capture("states-4-dom-fullscreen");
      EU.synthesizeKey("KEY_Escape", {}, window);
      await vt.until(() => !root.hasAttribute("inDOMFullscreen") && !window.fullScreen, 6000);
      await spike.sleep(1200);
      spike.log("after Esc", state());
      await spike.capture("states-5-after-dom-fullscreen");
    });

    // ---- a content process dies
    await step("crash", async () => {
      const tab = await vt.openTab("https://example.com/");
      const other = gBrowser.tabs[0];
      spike.log("before crash", { tabs: gBrowser.tabs.length, pids: gBrowser.tabs.map((t) => t.linkedBrowser.frameLoader?.remoteTab?.osPid) });
      VitreUI.bar.events.length = 0;
      const crashed = new Promise((r) => tab.linkedBrowser.addEventListener("oop-browser-crashed", r, { once: true }));
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      await TabStateFlusher.flush(tab.linkedBrowser); // a tab that has lived for a while; session data is collected lazily
      const pid = tab.linkedBrowser.frameLoader.remoteTab.osPid;
      spike.log("killing content process", pid, "->", vt.kill(pid));
      const got = await Promise.race([crashed.then(() => true), spike.sleep(8000).then(() => false)]);
      await spike.sleep(1500);
      const item = VitreUI.bar.items.get(tab);
      spike.log("after crash", {
        crashEvent: got,
        tabCrashedAttr: tab.hasAttribute("crashed"),
        uri: tab.linkedBrowser.currentURI.spec,
        docURI: tab.linkedBrowser.documentURI?.spec,
        label: tab.label,
        itemClasses: item.className,
        pillHost: item.querySelector(".host").textContent,
        events: VitreUI.bar.events.join(" "),
        otherTabAlive: !!other.linkedBrowser.frameLoader?.remoteTab,
      });
      await spike.capture("states-6-tab-crashed");
      // the shell still works: switch away and back, then revive the tab
      await vt.click(...vt.center(VitreUI.bar.items.get(other)), { wait: 600 });
      spike.log("switch to the healthy tab ->", gBrowser.selectedTab === other, gBrowser.selectedTab.label);
      await vt.click(...vt.center(VitreUI.bar.items.get(tab)), { wait: 600 });
      SessionStore.reviveCrashedTab(tab);
      await vt.until(() => !tab.hasAttribute("crashed") && tab.linkedBrowser.currentURI.spec.startsWith("https://example.com"), 10000);
      await vt.tabLoaded(tab);
      spike.log("revived", { crashed: tab.hasAttribute("crashed"), uri: tab.linkedBrowser.currentURI.spec, pillHost: VitreUI.bar.items.get(tab).querySelector(".host").textContent });
      await spike.capture("states-7-tab-revived");
    });

    // ---- reopen a closed tab, reopen a closed window (session store, in-process)
    await step("undo close", async () => {
      const tab = gBrowser.selectedTab;
      const n = gBrowser.tabs.length;
      gBrowser.removeTab(tab, { animate: false });
      await spike.sleep(600);
      spike.log("closed tab", { tabs: gBrowser.tabs.length, closedCount: SessionStore.getClosedTabCountForWindow(window), items: VitreUI.bar.items.size });
      VitreUI.bar.events.length = 0;
      const back = SessionStore.undoCloseTab(window, 0);
      await vt.until(() => back.linkedBrowser.currentURI.spec.startsWith("https://example.com"), 10000);
      await spike.sleep(800);
      spike.log("undoCloseTab", { tabs: gBrowser.tabs.length === n, uri: back.linkedBrowser.currentURI.spec, items: VitreUI.bar.items.size, events: VitreUI.bar.events.slice(0, 12).join(" ") });

      // a second window with two tabs, closed, then reopened
      const win = OpenBrowserWindow();
      await new Promise((r) => {
        const obs = (s) => {
          if (s === win) {
            Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
            r();
          }
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
      win.gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/?w2a", { triggeringPrincipal: sys });
      const t2 = win.gBrowser.addTrustedTab("https://en.wikipedia.org/wiki/Glass");
      await vt.tabLoaded(win.gBrowser.tabs[0]);
      await vt.tabLoaded(t2);
      await spike.sleep(1500);
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      await TabStateFlusher.flushWindow(win);
      win.close();
      await spike.sleep(1000);
      spike.log("closed window", { closedWindows: SessionStore.getClosedWindowCount() });
      const before = new Set(BrowserWindowTracker.orderedWindows);
      const re = SessionStore.undoCloseWindow(0);
      await vt.until(() => re.gBrowserInit?.delayedStartupFinished && re.gBrowser.tabs.length === 2, 10000);
      await spike.sleep(2500);
      window.resizeTo(480, 360);
      window.moveTo(1500, 700);
      re.resizeTo(1100, 720);
      re.moveTo(60, 60);
      await spike.sleep(1200);
      spike.log("undoCloseWindow", {
        vitre: re.document.documentElement.getAttribute("vitre"),
        ui: !!re.VitreUI?.root,
        tabs: re.gBrowser.tabs.map((t) => `${t.selected ? "*" : ""}${t.label}${t.hasAttribute("pending") ? " (pending)" : ""}`),
        bar: vt.barState(re).items.map((i) => `${i.active ? "*" : ""}${i.host} | ${i.title} | ${i.icon}`),
        hooks: shell.timeline.filter((t) => t.win === re.docShell.outerWindowID).map((t) => t.hook),
      });
      await spike.capture("states-8-reopened-window");
      re.close();
    });
  });
}
