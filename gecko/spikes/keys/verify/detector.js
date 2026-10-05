// Detects "Firefox did something" after a synthesized key: XUL commands, popups, menu bar,
// loads, new windows, tab changes, focus moves, zoom, full screen, find bar, sidebar, devtools.
/* global window, document, gBrowser, Services, Ci, ZoomManager, KS, spike */
window.Detector = (() => {
  const ev = [];
  window.addEventListener("command", (e) => ev.push("command:" + (e.target.id || e.target.getAttribute("command") || e.target.localName)), true);
  window.addEventListener("popupshown", (e) => ev.push("popup:" + (e.target.id || e.target.localName)), true);
  window.addEventListener("DOMMenuBarActive", () => ev.push("menubar-active"), true);
  window.addEventListener("fullscreen", () => ev.push("fullscreen-event"), true);
  gBrowser.addTabsProgressListener({
    onStateChange(b, wp, req, flags) {
      if (wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) ev.push("load-start");
    },
  });
  const winObs = { observe: (s, topic) => ev.push(topic) };
  Services.obs.addObserver(winObs, "domwindowopened");

  const desc = (el) => (el ? el.localName + (el.id ? "#" + el.id : "") : null);
  let labels = 0;
  function label(tab) { if (!tab._ks) tab._ks = "T" + ++labels; return tab._ks; }
  function snap() {
    let findbar = false, sidebar = false, devtools = false, dialogs = 0;
    try { findbar = gBrowser.isFindBarInitialized() && !gBrowser.getCachedFindBar().hidden; } catch (e) {}
    try { sidebar = !!(window.SidebarController && window.SidebarController.isOpen); } catch (e) {}
    try { devtools = !!document.querySelector("[class*='devtools-toolbox']"); } catch (e) {}
    try { dialogs = gBrowser.getTabDialogBox(gBrowser.selectedBrowser).getTabDialogManager()._dialogs.length; } catch (e) {}
    return {
      tabs: gBrowser.tabs.map(label).join(","),
      selected: label(gBrowser.selectedTab),
      windows: [...Services.wm.getEnumerator(null)].length,
      focus: desc(document.activeElement),
      zoom: ZoomManager.zoom,
      fullscreen: window.fullScreen,
      findbar, sidebar, devtools, dialogs,
      caret: Services.prefs.getBoolPref("accessibility.browsewithcaret", false),
    };
  }
  function diff(a, b) {
    const out = [];
    for (const k of Object.keys(a)) if (a[k] !== b[k]) out.push(k + ": " + a[k] + " -> " + b[k]);
    return out;
  }
  /** Put the window back: 3 test tabs, middle one selected and focused, nothing open. */
  async function restore(tabs, url) {
    for (const w of [...Services.wm.getEnumerator(null)]) {
      if (w !== window && w.location.href !== "about:blank") { try { w.close(); } catch (e) {} }
    }
    try { for (const p of document.querySelectorAll("panel, menupopup")) if (p.state === "open" || p.state === "showing") p.hidePopup(); } catch (e) {}
    try { if (window.SidebarController && window.SidebarController.isOpen) window.SidebarController.hide(); } catch (e) {}
    try { if (gBrowser.isFindBarInitialized()) gBrowser.getCachedFindBar().close(); } catch (e) {}
    try { if (window.fullScreen) window.fullScreen = false; } catch (e) {}
    try { gBrowser.getTabDialogBox(gBrowser.selectedBrowser).abortAllDialogs(); } catch (e) {}
    try { if (window.gDialogBox && window.gDialogBox.isOpen) window.gDialogBox.dialog.close(); } catch (e) {}
    try {
      if (document.querySelector("[class*='devtools-toolbox']")) {
        const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
        await require("devtools/client/framework/devtools").gDevTools.closeToolboxForTab(gBrowser.selectedTab);
      }
    } catch (e) {}
    Services.prefs.clearUserPref("accessibility.browsewithcaret");
    for (const t of [...gBrowser.tabs]) if (!tabs.includes(t)) gBrowser.removeTab(t);
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].closing || !tabs[i].isConnected) {
        tabs[i] = gBrowser.addTrustedTab(url);
        await spike.sleep(600);
      }
      if (gBrowser.tabs[i] !== tabs[i]) gBrowser.moveTabTo(tabs[i], { tabIndex: i });
    }
    gBrowser.selectedTab = tabs[1];
    try { ZoomManager.zoom = 1; } catch (e) {}
    gBrowser.selectedBrowser.focus();
    await spike.sleep(120);
  }
  return { ev, snap, diff, restore };
})();
