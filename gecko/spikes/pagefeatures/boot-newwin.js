// Probe: which hook sees target=_blank / window.open from remote content?
/* global Services, Ci, Cu, gBrowser, spike, pf, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/common.js", window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1100, 760);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    const bdw = window.browserDOMWindow;
    spike.log("browserDOMWindow", String(bdw), "win field is this window", bdw.win === window, "has wrappedJSObject", !!bdw.wrappedJSObject, "own props", Object.getOwnPropertyNames(bdw), "proto methods", Object.getOwnPropertyNames(Object.getPrototypeOf(bdw)));

    const calls = [];
    // A: own-property override on the instance
    for (const m of ["createContentWindowInFrame", "openURIInFrame", "createContentWindow", "openURI"]) {
      const orig = bdw[m];
      bdw[m] = function (...a) {
        calls.push("instance." + m + " where=" + a[2]);
        return orig.apply(bdw, a);
      };
    }
    // B: prototype override on the class (shared by every window)
    const { BrowserDOMWindow } = ChromeUtils.importESModule("resource:///modules/BrowserDOMWindow.sys.mjs");
    spike.log("instance is BrowserDOMWindow", bdw instanceof BrowserDOMWindow, "own props now", Object.getOwnPropertyNames(bdw));
    for (const m of ["createContentWindowInFrame", "openURIInFrame"]) {
      const orig = BrowserDOMWindow.prototype[m];
      BrowserDOMWindow.prototype[m] = function (...a) {
        calls.push("prototype." + m + " where=" + a[2]);
        return orig.apply(this, a);
      };
    }
    // C: tabbrowser entry point
    const addTab = gBrowser.addTab;
    gBrowser.addTab = function (uri, opts) {
      calls.push("gBrowser.addTab " + uri + " inBackground=" + opts?.inBackground + " openWindowInfo=" + !!opts?.openWindowInfo + " openerBrowser=" + !!opts?.openerBrowser + " skipLoad=" + opts?.skipLoad);
      return addTab.call(this, uri, opts);
    };
    gBrowser.tabContainer.addEventListener("TabOpen", (e) => calls.push("TabOpen openWindowInfo=" + !!e.target.linkedBrowser.openWindowInfo + " opener=" + !!e.target.linkedBrowser.browsingContext?.opener));

    const click = async (sel) => {
      const r = await pf.rectOf(b, sel);
      await spike.sleep(150);
      const n = gBrowser.tabs.length;
      pf.mouse(r.cx, r.cy, {});
      await pf.until(() => gBrowser.tabs.length > n, 4000);
      await spike.sleep(600);
      spike.log(sel, "->", calls.splice(0), "tabs", gBrowser.tabs.length, "selected new", gBrowser.selectedTab !== tab0);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);
    };
    await click("#link2"); // <a target=_blank>
    await click("#opener"); // window.open(url)
    Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 0);
    await click("#opener2"); // window.open(url, "_blank", "width=..,height=..")
  });
