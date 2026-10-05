// Verify: element fullscreen requested from inside a peek (a peeked video going fullscreen).
// FullScreen.enterDomFullscreen() aborts unless the requesting browser is gBrowser.selectedBrowser
// (browser-fullScreenAndPointerLock.js), and a peek is by design NOT the selected tab.
//   A. as the spike wrote it          B. with the peek promoted when its page asks for fullscreen
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitrePeek, VitreMenu, VitreFind, FullScreen */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    VitreMenu.install();
    VitreFind.install();
    VitrePeek.install();
    const state = (br) => pf.inContent(br, (w) => ({ fs: w.document.documentElement.dataset.fs, fschange: w.document.documentElement.dataset.fschange, fserror: w.document.documentElement.dataset.fserror, isFs: !!w.document.fullscreenElement, token: w.document.documentElement.dataset.token, inner: [w.innerWidth, w.innerHeight] }));
    const chromeState = () => ({ windowFullScreen: window.fullScreen, fsElement: document.fullscreenElement && document.fullscreenElement.localName, inDOMFullscreen: document.documentElement.hasAttribute("inDOMFullscreen"), selectedIsSource: gBrowser.selectedTab === tab0 });
    const openPeek = async () => {
      await v.activate();
      VitrePeek.open(pf.base + "probe.html", { opener: b });
      const p = VitrePeek.current;
      await pf.browserLoaded(p.browser, "probe");
      await spike.sleep(900);
      return p;
    };
    const ask = async (p) => {
      const r = await pf.rectOf(p.browser, "#fs");
      pf.mouse(r.cx, r.cy, {});
      await spike.sleep(2500);
    };
    const leave = async () => {
      if (document.fullscreenElement || window.fullScreen) {
        try { document.exitFullscreen(); } catch (e) {}
        await spike.sleep(800);
        if (window.fullScreen) window.fullScreen = false;
        await spike.sleep(800);
      }
    };

    // ---- A. as written ---------------------------------------------------------------------------------
    let p = await openPeek();
    spike.log("A before: active window", Services.focus.activeWindow === window, "peek", !!VitrePeek.current);
    await ask(p);
    spike.log("A FULLSCREEN asked from a peek: page", await state(p.browser), "chrome", chromeState(), "peek still open", !!VitrePeek.current);
    await spike.capture("vfs-a");
    await leave();
    VitrePeek.close("test", { discard: true });
    await spike.sleep(500);

    // ---- B. promote on request -------------------------------------------------------------------------
    // The request reaches chrome as FullScreen.enterDomFullscreen(browser, actor), after the chrome
    // document went fullscreen. Selecting the tab synchronously there satisfies the selectedBrowser check.
    const orig = FullScreen.enterDomFullscreen;
    let wrapped = 0;
    FullScreen.enterDomFullscreen = function (aBrowser, aActor) {
      if (VitrePeek.isPeekBrowser(aBrowser)) {
        wrapped++;
        VitrePeek.promote();
      }
      return orig.call(this, aBrowser, aActor);
    };
    p = await openPeek();
    const tokenBefore = (await state(p.browser)).token;
    await ask(p);
    const s = await state(p.browser);
    spike.log("B FULLSCREEN asked from a peek with promote-on-request: page", s, "chrome", chromeState(), "wrapper hit", wrapped, "peek open", !!VitrePeek.current, "promoted tab selected", gBrowser.selectedTab === p.tab, "same page instance", s.token === tokenBefore);
    await spike.capture("vfs-b");
    await leave();
    await spike.sleep(500);
    spike.log("B after leaving fullscreen: chrome", chromeState(), "page", await state(p.browser), "tab still selected", gBrowser.selectedTab === p.tab);
    FullScreen.enterDomFullscreen = orig;
  });
