// Page commands Vitre's chrome will call: zoom (per site / per tab), reload, stop, view source,
// save page, print, DevTools toggle.
/* global Services, Ci, gBrowser, spike, pf, FullZoom, ZoomManager, BrowserCommands, PrintUtils, saveBrowser, ChromeUtils, PathUtils, IOUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/common.js", window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    const zoomOf = (br) => ({ zoomManager: +ZoomManager.getZoomForBrowser(br).toFixed(2), fullZoom: +br.fullZoom.toFixed(2), bc: +br.browsingContext.fullZoom.toFixed(2) });
    const openTab = async (page) => {
      const t = gBrowser.addTrustedTab(pf.base + page);
      gBrowser.selectedTab = t;
      await pf.browserLoaded(t.linkedBrowser, page.split("?")[0]);
      await spike.sleep(500);
      return t;
    };

    // ---- zoom -----------------------------------------------------------------------------------
    spike.log("ZOOM prefs", { siteSpecific: Services.prefs.getBoolPref("browser.zoom.siteSpecific"), full: Services.prefs.getBoolPref("browser.zoom.full"), values: Services.prefs.getStringPref("toolkit.zoomManager.zoomValues"), min: Services.prefs.getIntPref("zoom.minPercent"), max: Services.prefs.getIntPref("zoom.maxPercent") });
    let zoomEvents = 0;
    window.addEventListener("FullZoomChange", () => zoomEvents++, true);
    await FullZoom.enlarge();
    await FullZoom.enlarge();
    await spike.sleep(300);
    spike.log("ZOOM after 2x FullZoom.enlarge()", zoomOf(b), "FullZoomChange events", zoomEvents, "page innerWidth", await pf.inContent(b, (w) => w.innerWidth));
    await spike.capture("misc-zoom-120");
    const t2 = await openTab("counter.html");
    await spike.sleep(500);
    spike.log("ZOOM site-specific: a new tab on the same host starts at", zoomOf(t2.linkedBrowser));
    FullZoom.setZoom(0.9, t2.linkedBrowser);
    await spike.sleep(400);
    gBrowser.selectedTab = tab0;
    await spike.sleep(600);
    spike.log("ZOOM site-specific: setZoom(0.9) in tab 2 also changed tab 1 (same host) to", zoomOf(b));
    await FullZoom.reset(b);
    await spike.sleep(400);
    spike.log("ZOOM after FullZoom.reset()", zoomOf(b));

    Services.prefs.setBoolPref("browser.zoom.siteSpecific", false);
    await spike.sleep(200);
    await FullZoom.enlarge(b);
    await spike.sleep(300);
    const t3 = await openTab("counter.html?b");
    spike.log("ZOOM per tab (browser.zoom.siteSpecific=false): tab 1", zoomOf(b), "new tab same host", zoomOf(t3.linkedBrowser), "tab 2", zoomOf(t2.linkedBrowser));
    gBrowser.selectedTab = tab0;
    await spike.sleep(500);
    spike.log("ZOOM per tab survives a tab switch", zoomOf(b), "tabHasCustomZoom", b.tabHasCustomZoom);
    b.reload();
    await spike.sleep(1200);
    spike.log("ZOOM per tab survives reload", zoomOf(b));
    ZoomManager.setZoomForBrowser(b, 1);
    gBrowser.removeTab(t3);

    // ---- reload / stop --------------------------------------------------------------------------
    gBrowser.selectedTab = t2;
    await spike.sleep(300);
    const token = () => pf.inContent(t2.linkedBrowser, (w) => w.document.documentElement.dataset.token);
    const tk1 = await token();
    BrowserCommands.reload();
    await spike.sleep(300);
    await pf.browserLoaded(t2.linkedBrowser, "counter");
    await spike.sleep(500);
    const tk2 = await token();
    spike.log("RELOAD BrowserCommands.reload(): new page instance", tk1 !== tk2);
    BrowserCommands.reloadSkipCache();
    await spike.sleep(300);
    await pf.browserLoaded(t2.linkedBrowser, "counter");
    await spike.sleep(500);
    spike.log("RELOAD BrowserCommands.reloadSkipCache(): new page instance", tk2 !== (await token()));
    let sawBusy = false;
    const obs = new MutationObserver(() => (sawBusy = sawBusy || t2.hasAttribute("busy")));
    obs.observe(t2, { attributes: true });
    t2.linkedBrowser.fixupAndLoadURIString("http://10.255.255.1/never-answers", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await spike.sleep(700);
    const busyBefore = t2.hasAttribute("busy");
    BrowserCommands.stop();
    await spike.sleep(500);
    spike.log("STOP BrowserCommands.stop(): tab busy before", busyBefore, "after", t2.hasAttribute("busy"), "url", t2.linkedBrowser.currentURI.spec);
    obs.disconnect();
    gBrowser.removeTab(t2);
    gBrowser.selectedTab = tab0;
    await spike.sleep(300);

    // ---- view source ----------------------------------------------------------------------------
    let n = gBrowser.tabs.length;
    BrowserCommands.viewSource(b);
    await pf.until(() => gBrowser.tabs.length > n, 4000);
    const vs = gBrowser.tabs[gBrowser.tabs.length - 1];
    await pf.until(() => vs.linkedBrowser.currentURI.spec.startsWith("view-source:"), 5000);
    await spike.sleep(600);
    spike.log("VIEW SOURCE BrowserCommands.viewSource(browser) ->", vs.linkedBrowser.currentURI.spec, "selected", vs.selected);
    await spike.capture("misc-view-source");
    gBrowser.removeTab(vs);
    gBrowser.selectedTab = tab0;

    // ---- save page (no dialog: skipPrompt + fixed download folder) ------------------------------
    Services.prefs.setIntPref("browser.download.folderList", 2);
    Services.prefs.setStringPref("browser.download.dir", spike.outDir);
    Services.prefs.setBoolPref("browser.download.useDownloadDir", true);
    for (const f of await IOUtils.getChildren(spike.outDir)) if (/Field Notes/.test(f)) await IOUtils.remove(f, { recursive: true });
    saveBrowser(b, true);
    const saved = await pf.until(async () => (await IOUtils.getChildren(spike.outDir)).filter((f) => /\.html?$/i.test(f)), 6000, 300);
    await spike.sleep(500);
    spike.log("SAVE PAGE saveBrowser(browser, true) ->", (await IOUtils.getChildren(spike.outDir)).map((f) => PathUtils.filename(f)).filter((f) => !/\.png|\.done|log\.txt/.test(f)));

    // ---- print ----------------------------------------------------------------------------------
    PrintUtils.startPrintWindow(b.browsingContext);
    const pp = await pf.until(() => document.querySelector(".printPreviewBrowser, .printSettingsBrowser"), 8000, 200);
    await spike.sleep(2500);
    spike.log("PRINT PrintUtils.startPrintWindow(browsingContext): preview shown", !!pp, "dialog on tab", b.hasAttribute("tabDialogShowing") || !!document.querySelector(".dialogStack:not([hidden])"));
    await spike.capture("misc-print");
    try {
      gBrowser.getTabDialogBox(b).abortAllDialogs();
    } catch (e) {
      spike.log("print close failed", String(e));
    }
    await spike.sleep(600);
    spike.log("PRINT closed", !document.querySelector(".printPreviewBrowser"));

    // ---- DevTools toggle ------------------------------------------------------------------------
    const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
    const key = document.getElementById("key_toggleToolbox");
    spike.log("DEVTOOLS key element", !!key, key && key.getAttribute("keycode"), "enabled pref", Services.prefs.getBoolPref("devtools.policy.disabled", false) === false);
    key.doCommand();
    const opened = await pf.until(() => DevToolsShim.isInitialized() && DevToolsShim.hasToolboxForTab(gBrowser.selectedTab), 20000, 300);
    await spike.sleep(1500);
    spike.log("DEVTOOLS toggled on (key_toggleToolbox.doCommand())", !!opened);
    await spike.capture("misc-devtools");
    key.doCommand();
    const closed = await pf.until(() => !DevToolsShim.hasToolboxForTab(gBrowser.selectedTab), 10000, 300);
    spike.log("DEVTOOLS toggled off", !!closed);
  });
