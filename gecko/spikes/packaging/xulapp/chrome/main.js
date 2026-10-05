// Main window script of the minimal "-app application.ini" XUL app. Reports which parts of the
// browser exist when Firefox's runtime is started as a custom toolkit app.
/* global Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils */
(async () => {
  const logPath = Services.env.get("VITRE_LOG");
  const outDir = Services.env.get("VITRE_OUT");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lines = [];
  const flush = async () => {
    if (!logPath) return;
    const text = lines.splice(0).join("\n") + "\n";
    await IOUtils.writeUTF8(logPath, text, { mode: "appendOrCreate" });
  };
  const log = async (...a) => {
    lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    await flush();
  };
  const capture = async (name) => {
    await sleep(400);
    await log("@@capture " + name);
    for (let i = 0; i < 200 && !(await IOUtils.exists(PathUtils.join(outDir, name + ".png.done"))); i++) await sleep(50);
  };
  const tryImport = (url) => {
    try {
      return Object.keys(ChromeUtils.importESModule(url)).slice(0, 3).join(",") || "(loaded)";
    } catch (e) {
      return "MISSING (" + String(e).slice(0, 90) + ")";
    }
  };
  try {
    const ai = Services.appinfo;
    await log("APP name=" + ai.name + " vendor=" + ai.vendor + " ID=" + ai.ID + " version=" + ai.version + " platformVersion=" + ai.platformVersion + " remoteAutostart=" + ai.browserTabsRemoteAutostart + " fission=" + ai.fissionAutostart);
    await log("UA " + navigator.userAgent);
    const dir = (k) => {
      try {
        return Services.dirsvc.get(k, Ci.nsIFile).path;
      } catch (e) {
        return "ERR " + e.name;
      }
    };
    await log("DIRS GreD=" + dir("GreD") + " | XCurProcD(app)=" + dir("XCurProcD") + " | UAppData=" + dir("UAppData") + " | DefProfRt=" + dir("DefProfRt") + " | ProfD=" + dir("ProfD"));
    await log("window: gBrowser=" + typeof window.gBrowser + " windowtype=" + document.documentElement.getAttribute("windowtype"));
    const mods = {
      "toolkit AddonManager": "resource://gre/modules/AddonManager.sys.mjs",
      "toolkit Extension (WebExtensions core)": "resource://gre/modules/Extension.sys.mjs",
      "toolkit PlacesUtils": "resource://gre/modules/PlacesUtils.sys.mjs",
      "toolkit Downloads": "resource://gre/modules/Downloads.sys.mjs",
      "toolkit LoginManager": "resource://gre/modules/LoginHelper.sys.mjs",
      "browser BrowserGlue": "resource:///modules/BrowserGlue.sys.mjs",
      "browser BrowserWindowTracker": "resource:///modules/BrowserWindowTracker.sys.mjs",
      "browser SessionStore": "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
      "browser CustomizableUI": "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
      "browser UrlbarUtils": "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
      "browser ExtensionPopups (browserAction UI)": "resource:///modules/ExtensionPopups.sys.mjs",
    };
    for (const [k, u] of Object.entries(mods)) await log("MODULE " + k + " -> " + tryImport(u));
    const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
    for (const u of ["chrome://browser/content/browser.xhtml", "chrome://global/content/elements/browser-custom-element.mjs", "chrome://extensions/content/ext-toolkit.json", "chrome://browser/content/ext-browser.json"]) {
      let r;
      try {
        r = reg.convertChromeURL(Services.io.newURI(u)).spec;
      } catch (e) {
        r = "NOT REGISTERED (" + e.name + ")";
      }
      await log("CHROME " + u + " -> " + r);
    }
    // WebExtension API surface registered in this app
    try {
      const cats = [];
      for (const { entry, value } of Services.catMan.enumerateCategory("webextension-modules")) cats.push(entry + "=" + value);
      await log("EXT webextension-modules: " + JSON.stringify(cats));
    } catch (e) {
      await log("EXT categories ERR " + e);
    }
    try {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      await log("ADDONS isReady=" + AddonManager.isReady);
      if (AddonManager.isReady) {
        const all = await AddonManager.getAllAddons();
        await log("ADDONS installed: " + JSON.stringify(all.map((a) => a.id)));
      }
    } catch (e) {
      await log("ADDONS ERR " + e);
    }
    // Places
    try {
      const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
      await PlacesUtils.history.insert({ url: "https://example.com/", title: "probe", visits: [{ date: new Date() }] });
      const has = await PlacesUtils.history.hasVisits("https://example.com/");
      await log("PLACES history insert/hasVisits -> " + has);
    } catch (e) {
      await log("PLACES ERR " + e);
    }
    // A remote content browser in our own window
    const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    const b = document.createElementNS(XUL, "browser");
    b.setAttribute("type", "content");
    b.setAttribute("remote", "true");
    b.setAttribute("maychangeremoteness", "true");
    b.setAttribute("messagemanagergroup", "browsers");
    document.getElementById("content").append(b);
    await sleep(300);
    try {
      b.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    } catch (e) {
      await log("BROWSER load ERR " + e);
    }
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (b.currentURI?.spec.startsWith("https://example.com") && !b.webProgress?.isLoadingDocument) break;
    }
    await sleep(700);
    await log("BROWSER isRemote=" + b.isRemoteBrowser + " remoteType=" + b.remoteType + " uri=" + b.currentURI?.spec + " title=" + b.contentTitle);
    document.getElementById("status").textContent = "page: " + b.contentTitle + " · remoteType " + b.remoteType;
    await capture("xulapp-window");
  } catch (e) {
    await log("ERROR " + e + "\n" + (e.stack || ""));
  }
  await log("@@quit");
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
})();
