// Alternative Peek primitive, for comparison: a STANDALONE <browser remote> that is not a tab,
// shown in an overlay, then "promoted" by swapping its docshell into a fresh tab
// (browser.swapDocShells). The question is whether this is any better than the hidden-tab way.
/* global Services, Ci, gBrowser, spike, pf, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/common.js", window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const tab0 = gBrowser.selectedTab;
    const b0 = gBrowser.selectedBrowser;
    const { E10SUtils } = ChromeUtils.importESModule("resource://gre/modules/E10SUtils.sys.mjs");
    const url = pf.base + "counter.html";
    const remoteType = ChromeUtils.predictRemoteTypeForURI(url, { window, userContextId: 0 });
    spike.log("remoteType for url", remoteType, "source remoteType", b0.remoteType);

    // gBrowser.createBrowser() builds the element with the same attributes a tab's browser gets and
    // returns it wrapped in stack > box > hbox (not attached to anything).
    const browser = gBrowser.createBrowser({ remoteType, uriIsAboutBlank: false });
    const panel = gBrowser.getPanel(browser);
    const tp = gBrowser.tabpanels.getBoundingClientRect();
    panel.setAttribute("style", `position:fixed; left:${tp.left + 180}px; top:${tp.top + 16}px; width:${tp.width - 360}px; height:${tp.height - 40}px; z-index:5; border-radius:22px; overflow:clip; box-shadow:0 30px 80px rgba(0,0,0,.4); inset:auto;`);
    document.getElementById("browser").appendChild(panel);
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await pf.browserLoaded(browser, "counter");
    await spike.sleep(1500);
    const state = (br) => pf.inContent(br, (w) => ({ token: w.document.documentElement.dataset.token, n: +w.document.documentElement.dataset.n, visibility: w.document.visibilityState }));
    let s;
    try {
      s = await state(browser);
    } catch (e) {
      spike.log("frame script on standalone browser failed", String(e));
    }
    spike.log("STANDALONE browser", { isRemote: browser.isRemoteBrowser, remoteType: browser.remoteType, docShellIsActive: browser.docShellIsActive, isTab: !!gBrowser.getTabForBrowser(browser), tabs: gBrowser.tabs.length, state: s });
    await spike.capture("alt-standalone");

    // context menu and find on a non-tab browser
    const popup = document.getElementById("contentAreaContextMenu");
    let cm = null;
    popup.addEventListener("popupshowing", (e) => {
      if (e.target !== popup) return;
      cm = { browserIsOurs: window.gContextMenu?.browser === browser, inTabBrowser: window.gContextMenu?.inTabBrowser, link: window.gContextMenu?.linkURL };
      e.preventDefault();
    });
    const r = await pf.rectOf(browser, "#next");
    pf.rightClick(r.cx, r.cy);
    await pf.until(() => cm, 3000);
    spike.log("STANDALONE context menu", cm);
    let found = null;
    try {
      browser.finder.addResultListener({ onFindResult: (d) => (found = d.result), onMatchesCountResult() {}, onHighlightFinished() {}, onCurrentSelection() {} });
      browser.finder.fastFind("Counter", false, false);
      await pf.until(() => found !== null, 3000);
    } catch (e) {
      found = String(e);
    }
    spike.log("STANDALONE finder result", found);

    // ---- promote by swapping the docshell into a new tab -----------------------------------------
    const before = await state(browser);
    let loads = 0;
    const tab = gBrowser.addTrustedTab("about:blank", { skipAnimation: true, preferredRemoteType: remoteType });
    const nb = tab.linkedBrowser;
    await spike.sleep(300);
    spike.log("new tab browser remote", nb.isRemoteBrowser, nb.remoteType);
    try {
      if (nb.remoteType !== browser.remoteType) gBrowser.updateBrowserRemoteness(nb, { remoteType: browser.remoteType, newFrameloader: true });
      gBrowser.addTabsProgressListener({
        onStateChange(br, wp, req, flags) {
          if (br === nb && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) loads++;
        },
      });
      nb.swapDocShells(browser);
      panel.remove();
      gBrowser.selectedTab = tab;
      await spike.sleep(1200);
      const after = await state(nb);
      spike.log("SWAP promote", { before, after, sameToken: before.token === after.token, loads, tabLabel: tab.label, urlbar: window.gURLBar?.value, currentURI: nb.currentURI.spec, canGoBack: nb.canGoBack });
    } catch (e) {
      spike.log("SWAP failed", String(e), e.stack || "");
    }
    await spike.capture("alt-promoted");
  });
