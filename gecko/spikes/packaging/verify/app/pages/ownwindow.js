// Runs in Vitre's own top-level window opened with "-chrome". Reports what the browser runtime
// gives a window that is NOT browser.xhtml.
/* global Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, WebExtensionPolicy */
(async () => {
  const logPath = Services.env.get("VITRE_LOG");
  const outDir = Services.env.get("VITRE_OUT");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = async (...a) => {
    if (!logPath) return;
    await IOUtils.writeUTF8(logPath, a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n", { mode: "appendOrCreate" });
  };
  const capture = async (name) => {
    await sleep(400);
    await log("@@capture " + name);
    for (let i = 0; i < 200 && !(await IOUtils.exists(PathUtils.join(outDir, name + ".png.done"))); i++) await sleep(50);
  };
  try {
    await sleep(1500); // let BrowserGlue finish its startup work
    await log("OWN window: gBrowser=" + typeof window.gBrowser + " windowtype=" + document.documentElement.getAttribute("windowtype") + " app=" + Services.appinfo.name);
    const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
    await log("OWN BrowserWindowTracker.getTopWindow()=" + BrowserWindowTracker.getTopWindow() + " | navigator:browser windows=" + [...Services.wm.getEnumerator("navigator:browser")].length);
    const tryImport = (url) => {
      try {
        ChromeUtils.importESModule(url);
        return "ok";
      } catch (e) {
        return "MISSING";
      }
    };
    await log("OWN modules: SessionStore=" + tryImport("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs") + " Tabbrowser=" + tryImport("moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs") + " PlacesUtils=" + tryImport("resource://gre/modules/PlacesUtils.sys.mjs") + " Downloads=" + tryImport("resource://gre/modules/Downloads.sys.mjs"));

    const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    const b = document.createElementNS(XUL, "browser");
    b.setAttribute("type", "content");
    b.setAttribute("remote", "true");
    b.setAttribute("maychangeremoteness", "true");
    b.setAttribute("messagemanagergroup", "browsers");
    document.getElementById("content").append(b);
    await sleep(300);
    b.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (b.currentURI?.spec.startsWith("https://example.com") && !b.webProgress?.isLoadingDocument) break;
    }
    await sleep(700);
    await log("OWN browser element: isRemote=" + b.isRemoteBrowser + " remoteType=" + b.remoteType + " title=" + b.contentTitle);
    document.getElementById("status").textContent = "page: " + b.contentTitle;

    // What do WebExtensions see? (tabs API is built on navigator:browser windows + gBrowser)
    try {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const ext = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      ext.initWithPath(Services.env.get("VITRE_TESTEXT"));
      const addon = await AddonManager.installTemporaryAddon(ext);
      let title = null;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        try {
          const e = WebExtensionPolicy.getByID(addon.id).extension;
          title = e.apiManager.global.browserActionFor(e).action.getProperty(null, "title");
        } catch (err) {
          title = "ERR " + err;
        }
        if (title && title.includes("tabs=")) break;
      }
      await log("OWN extension tabs.query result: " + title + "  (our <browser> is invisible to extensions: tabs=0)");
    } catch (e) {
      await log("OWN extension ERR " + e);
    }
    await capture("own-window");
  } catch (e) {
    await log("ERROR " + e + "\n" + (e.stack || ""));
  }
  await log("@@quit");
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
})();
