// Identity + branding without recompiling (items 2 and 3).
// Run stock:    python spikes/packaging/run-dist.py --name packaging-ident --boot spikes/packaging/boot-identity.js --url https://example.com
// Run renamed:  ... --name packaging-identapp --arg -app --arg <dist runtime>\browser\application.ini
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, L10nRegistry, L10nFileSource, Localization */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.resize(1100, 720);
  await spike.loaded();

  // ---- identity -----------------------------------------------------------------------------
  const ai = Services.appinfo;
  const dir = (k) => {
    try {
      return Services.dirsvc.get(k, Ci.nsIFile).path;
    } catch (e) {
      return "ERR " + e.name;
    }
  };
  spike.log("APP name=" + ai.name + " vendor=" + ai.vendor + " ID=" + ai.ID + " version=" + ai.version);
  spike.log("UA " + navigator.userAgent);
  spike.log("DIRS UAppData=" + dir("UAppData") + " | DefProfRt=" + dir("DefProfRt") + " | ProfD=" + dir("ProfD") + " | XCurProcD=" + dir("XCurProcD"));
  const taskbar = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
  spike.log("TASKBAR defaultGroupId(AUMID)=" + taskbar.defaultGroupId + " available=" + taskbar.available + " taskbar.grouping.useprofile=" + Services.prefs.getBoolPref("taskbar.grouping.useprofile", false));
  spike.log("BROWSER gBrowser=" + typeof gBrowser + " tabs=" + gBrowser.tabs.length);
  const tryImport = (url) => {
    try {
      ChromeUtils.importESModule(url);
      return "ok";
    } catch (e) {
      return "MISSING";
    }
  };
  spike.log("MODULES SessionStore=" + tryImport("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs") + " BrowserGlue=" + tryImport("resource:///modules/BrowserGlue.sys.mjs") + " PlacesUtils=" + tryImport("resource://gre/modules/PlacesUtils.sys.mjs"));
  const cats = [];
  for (const { entry } of Services.catMan.enumerateCategory("webextension-modules")) cats.push(entry);
  spike.log("EXT webextension-modules categories: " + cats.join(","));

  // A local WebExtension with browser_action + tabs: proves the browser-level extension machinery.
  try {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
    const ext = res.getSubstitution("vitre-boot").QueryInterface(Ci.nsIFileURL).file;
    ext.append("testext");
    const addon = await AddonManager.installTemporaryAddon(ext);
    let title = null;
    for (let i = 0; i < 50; i++) {
      await spike.sleep(100);
      try {
        const ext = WebExtensionPolicy.getByID(addon.id).extension;
        title = ext.apiManager.global.browserActionFor(ext).action.getProperty(null, "title");
      } catch (e) {
        title = "ERR " + e;
      }
      if (title && title.includes("tabs=")) break;
    }
    check("X1 WebExtension with browser_action + tabs API works", !!title && title.includes("tabs="), { addon: addon.id, widgetTitle: title });
  } catch (e) {
    check("X1 WebExtension with browser_action + tabs API works", false, String(e));
  }

  // ---- branding: window title ---------------------------------------------------------------
  spike.log("TITLE before: " + JSON.stringify(document.title));
  await spike.capture("ident-1-stock");

  // (a) Fluent brand override: a higher-priority L10n source that only contains branding/brand.ftl
  try {
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
    const hasPkg = (() => {
      try {
        return !!Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry).convertChromeURL(Services.io.newURI("chrome://vitre/content/chrome.manifest"));
      } catch (e) {
        return false;
      }
    })();
    spike.log("L10N chrome://vitre registered=" + hasPkg + " sources before=" + JSON.stringify(L10nRegistry.getInstance().getAvailableLocales()) + " names=" + JSON.stringify(L10nRegistry.getInstance().getSourceNames?.()));
    const src = new L10nFileSource("0-vitre-brand", "app", ["en-US"], "chrome://vitre/content/locales/{locale}/");
    L10nRegistry.getInstance().registerSources([src]);
    spike.log("L10N names after=" + JSON.stringify(L10nRegistry.getInstance().getSourceNames?.()));
    const loc = new Localization(["branding/brand.ftl", "browser/browser.ftl"], false);
    const v = await loc.formatValue("browser-main-window-default-title");
    check("B1 Fluent brand override (L10nRegistry source with branding/brand.ftl)", v === "Vitre", "browser-main-window-default-title -> " + v);
  } catch (e) {
    check("B1 Fluent brand override", false, String(e));
  }

  // (b) per-window title function
  const orig = gBrowser.getWindowTitleForBrowser;
  gBrowser.getWindowTitleForBrowser = function (browser) {
    const t = browser.contentTitle || "";
    return t ? t + " — Vitre" : "Vitre";
  };
  gBrowser.updateTitlebar();
  check("B2 window title via gBrowser.getWindowTitleForBrowser override", document.title === "Example Domain — Vitre", document.title + " (original fn length " + orig.length + ")");

  // ---- branding: window icon + taskbar identity --------------------------------------------
  try {
    const ui = Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils);
    const uri = Services.io.newURI("chrome://vitre/skin/icon256.png");
    const channel = Services.io.newChannelFromURI(uri, null, Services.scriptSecurityManager.getSystemPrincipal(), null, Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL, Ci.nsIContentPolicy.TYPE_IMAGE);
    const img = await ChromeUtils.fetchDecodedImage(uri, channel);
    if (!Services.env.get("VITRE_SKIP_SETICON")) {
      ui.setWindowIcon(window, img, img);
      check("B3 nsIWindowsUIUtils.setWindowIcon(window, small, large) accepted", true, img.width + "x" + img.height);
    } else {
      spike.log("B3 skipped (VITRE_SKIP_SETICON): icon comes from chrome/icons/default/main-window.ico or the exe");
    }
  } catch (e) {
    check("B3 nsIWindowsUIUtils.setWindowIcon", false, String(e));
  }
  try {
    if (!Services.env.get("VITRE_SKIP_AUMID")) {
      taskbar.setGroupIdForWindow(window, "Vitre.Browser.PackagingSpike");
      check("B4 nsIWinTaskbar.setGroupIdForWindow(window, 'Vitre.Browser.PackagingSpike') accepted", true);
    }
  } catch (e) {
    check("B4 setGroupIdForWindow", false, String(e));
  }
  await spike.sleep(500);
  await spike.capture("ident-2-branded");

  // The About window (override line in chrome.manifest) + its title bar icon
  try {
    const win = Services.ww.openWindow(null, "chrome://browser/content/aboutDialog.xhtml", "_blank", "chrome,dialog=no,resizable,width=1200,height=760", null);
    await new Promise((r) => win.addEventListener("load", r, { once: true }));
    win.resizeTo(1200, 760);
    win.moveTo(30, 30);
    await spike.resize(500, 400);
    await spike.sleep(700);
    spike.log("ABOUT title=" + win.document.title + " uri=" + win.document.documentURI);
    await spike.capture("ident-3-about");
    win.close();
  } catch (e) {
    spike.log("ABOUT ERR " + e);
  }
});
