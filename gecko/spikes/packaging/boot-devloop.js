// Spike "packaging", part 7: everything loads from a chrome package registered at RUNTIME.
// Two ways to run it:
//  (a) stock harness, app folder OUTSIDE the runtime (this script registers the manifest itself):
//        python tools/run.py --boot spikes/packaging/boot-devloop.js --name packaging-dev --url https://example.com
//      Parent-process things pass; the child actor cannot load (content sandbox cannot read the folder).
//  (b) this spike's runtime copy, app folder INSIDE the runtime (runtime/vitre is a junction to app/,
//      registered by config.js). Everything passes, including actors in web content processes:
//        python spikes/packaging/stage.py --link
//        python spikes/packaging/run-dist.py --name packaging-devdist --boot spikes/packaging/boot-devloop.js --url https://example.com
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, Components, IOUtils, PathUtils */
spike.main(async () => {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok });
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  };
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(name, false, "threw " + e);
    }
  };

  await spike.resize(1280, 800);
  await spike.loaded();

  // ---- T1: register <spike>/app/chrome.manifest at runtime ---------------------------------
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
  const bootDir = res.getSubstitution("vitre-boot").QueryInterface(Ci.nsIFileURL).file;
  const manifest = bootDir.clone();
  manifest.append("app");
  manifest.append("chrome.manifest");
  const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
  const resolve = (u) => {
    try {
      return reg.convertChromeURL(Services.io.newURI(u)).spec;
    } catch (e) {
      return "ERR " + e.name;
    }
  };
  const preRegistered = !resolve("chrome://vitre/content/pages/home.html").startsWith("ERR");
  const greDir = Services.dirsvc.get("GreD", Ci.nsIFile).path;
  spike.log("MODE " + (preRegistered ? "(b) chrome://vitre already registered by config.js -> " + resolve("chrome://vitre/content/chrome.manifest") : "(a) registering " + manifest.path + " from this script"));
  await attempt("T1 autoRegister", async () => {
    if (!preRegistered) Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);
    check("T1.1 content package", resolve("chrome://vitre/content/pages/home.html").startsWith("file:"), resolve("chrome://vitre/content/pages/home.html"));
    check("T1.2 skin package", resolve("chrome://vitre/skin/vitre.css").startsWith("file:"), resolve("chrome://vitre/skin/vitre.css"));
    check("T1.3 resource mapping", res.hasSubstitution("vitre"), res.hasSubstitution("vitre") ? res.getSubstitution("vitre").spec : "none");
    check("T1.4 override line", resolve("chrome://browser/content/aboutDialog.xhtml").includes("about.xhtml"), resolve("chrome://browser/content/aboutDialog.xhtml"));
  });

  // ---- T2: system ES module singleton -------------------------------------------------------
  let VitreProbe;
  let bumpBase = 0;
  await attempt("T2 sys.mjs", async () => {
    ({ VitreProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs"));
    const again = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs").VitreProbe;
    check("T2.1 importESModule(chrome://vitre/...sys.mjs)", VitreProbe && VitreProbe.hasServices, { url: VitreProbe.url, processType: VitreProbe.processType });
    const b0 = VitreProbe.bump();
    check("T2.2 singleton (same object and state on second import)", VitreProbe === again && again.bump() === b0 + 1);
    bumpBase = b0 + 1;
    const viaRes = ChromeUtils.importESModule("resource://vitre/modules/VitreProbe.sys.mjs").VitreProbe;
    check("T2.3 resource://vitre/ import works (but is a SECOND instance: pick one scheme)", !!viaRes, { sameObject: viaRes === VitreProbe, url: viaRes.url });
  });

  // ---- T3: JSWindowActor pair ---------------------------------------------------------------
  await attempt("T3 actors", async () => {
    ChromeUtils.unregisterWindowActor("VitreProbe"); // (b): VitreStartup registered it already
    ChromeUtils.registerWindowActor("VitreProbe", {
      parent: { esModuleURI: "chrome://vitre/content/actors/VitreProbeParent.sys.mjs" },
      child: {
        esModuleURI: "chrome://vitre/content/actors/VitreProbeChild.sys.mjs",
        events: { DOMContentLoaded: {} },
      },
      matches: ["http://*/*", "https://*/*"],
      messageManagerGroups: ["browsers"],
      // Firefox 157 (pref dom.jsipc.check_safeForUntrustedWebProcess): without this flag the actor
      // is refused in web/file content processes ("doesn't match remote type 'webIsolated=...'").
      safeForUntrustedWebProcess: true,
    });
    const expectFail = !preRegistered; // (a): the module file is outside the runtime dir
    const wait = VitreProbe.next();
    const tab = gBrowser.addTrustedTab("https://example.com/?actor", { inBackground: false });
    const ev = await Promise.race([wait, spike.sleep(8000).then(() => null)]);
    await spike.loaded(tab.linkedBrowser);
    let pong = null;
    try {
      const actor = tab.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe");
      pong = await Promise.race([actor.sendQuery("VitreProbe:Ping"), spike.sleep(5000).then(() => "TIMEOUT")]);
    } catch (e) {
      pong = "ERR " + e;
    }
    const failed = Services.console.getMessageArray().map((m) => String(m.message || m)).filter((m) => /Failed to load chrome:\/\/vitre\/content\/actors/.test(m)).length;
    if (expectFail) {
      check("T3 (mode a) EXPECTED LIMIT: child actor module outside the runtime dir cannot be read by the sandboxed content process", ev === null && pong === "TIMEOUT" && failed > 0, { event: ev, query: pong, failedToLoadErrors: failed });
    } else {
      check("T3.1 child actor (content process) -> parent actor -> module", ev && ev.name === "VitreProbe:Loaded" && ev.data.processType === 2, ev);
      check("T3.2 parent sendQuery -> child reads the page", pong && pong.title === "Example Domain", pong);
      check("T3.3 child runs in a web content process", pong && pong.processType === 2 && String(pong.remoteType).startsWith("web"), { remoteType: pong?.remoteType, pid: pong?.pid, parentPid: Services.appinfo.processID });
    }
  });

  // ---- T4: chrome stylesheets ---------------------------------------------------------------
  await attempt("T4 styles", async () => {
    const HTML = "http://www.w3.org/1999/xhtml";
    const a = document.createElementNS(HTML, "div");
    a.id = "vitre-probe";
    a.textContent = "skin: chrome://vitre/skin/vitre.css";
    const b = document.createElementNS(HTML, "div");
    b.id = "vitre-probe2";
    b.textContent = "content: chrome/window.css via <link>";
    document.body.append(a, b);
    window.windowUtils.loadSheetUsingURIString("chrome://vitre/skin/vitre.css", window.windowUtils.AUTHOR_SHEET);
    const link = document.createElementNS(HTML, "link");
    link.rel = "stylesheet";
    link.href = "chrome://vitre/content/chrome/window.css";
    const linked = new Promise((r) => {
      link.addEventListener("load", () => r("load"));
      link.addEventListener("error", () => r("error"));
    });
    document.head.append(link);
    const how = await Promise.race([linked, spike.sleep(5000).then(() => "timeout")]);
    await spike.sleep(200);
    check("T4.1 windowUtils.loadSheetUsingURIString(skin sheet)", getComputedStyle(a).backgroundColor === "rgb(10, 132, 255)", getComputedStyle(a).backgroundColor);
    check("T4.2 <link rel=stylesheet> appended to browser.xhtml <head>", getComputedStyle(b).backgroundColor === "rgb(48, 209, 88)", how + " " + getComputedStyle(b).backgroundColor);
  });

  // ---- T4b: scripts into the window ---------------------------------------------------------
  await attempt("T4b window scripts", async () => {
    Services.scriptloader.loadSubScript("chrome://vitre/content/chrome/window.js", window);
    check("T4b.1 loadSubScript classic script into window", window.VitreWindowProbe?.hasGBrowser, window.VitreWindowProbe);
    // (a) <script type=module src=chrome://...> element (allowed by browser.xhtml CSP: script-src chrome:)
    const s = document.createElementNS("http://www.w3.org/1999/xhtml", "script");
    s.type = "module";
    s.src = "chrome://vitre/content/chrome/window.mjs";
    const done = new Promise((r) => {
      s.addEventListener("load", () => r("load"));
      s.addEventListener("error", () => r("error"));
    });
    document.head.append(s);
    const how = await Promise.race([done, spike.sleep(5000).then(() => "timeout")]);
    check("T4b.2 <script type=module src=chrome://vitre/...> in browser.xhtml", window.VitreWindowModuleProbe?.globalIsWindow, { how, probe: window.VitreWindowModuleProbe });
    // (b) dynamic import() from a subscript
    try {
      Services.scriptloader.loadSubScript("chrome://vitre/content/chrome/dynimport.js", window);
      const ns = await window.__vitreImport("chrome://vitre/content/chrome/window.mjs");
      check("T4b.3 dynamic import() inside a loadSubScript'd script", ns.where === "window.mjs", ns.where);
    } catch (e) {
      check("T4b.3 dynamic import() inside a loadSubScript'd script", false, String(e));
    }
    try {
      const ns = ChromeUtils.importESModule("chrome://vitre/content/chrome/helper.mjs", { global: "current" });
      check("T4b.3b ChromeUtils.importESModule(url, {global:'current'}) in the window", ns.helper() === "helper.mjs ok");
    } catch (e) {
      check("T4b.3b ChromeUtils.importESModule(url, {global:'current'}) in the window", false, String(e));
    }
    try {
      window.eval("1+1");
      check("T4b.3c eval() in browser.xhtml is blocked by CSP (expected)", false, "eval ran");
    } catch (e) {
      check("T4b.3c eval() in browser.xhtml is blocked by CSP (expected)", true, String(e));
    }
    // (c) inline script is blocked by the CSP of browser.xhtml
    const inl = document.createElementNS("http://www.w3.org/1999/xhtml", "script");
    inl.textContent = "window.__vitreInline = 1;";
    document.head.append(inl);
    check("T4b.4 inline <script> is BLOCKED by browser.xhtml CSP (expected)", window.__vitreInline !== 1, "window.__vitreInline=" + window.__vitreInline);
  });
  await spike.capture("dev-1-styles-on-web-page");

  // ---- T5: privileged HTML page in a tab ----------------------------------------------------
  await attempt("T5 home page", async () => {
    const tab = gBrowser.addTrustedTab("chrome://vitre/content/pages/home.html", { inBackground: false });
    const br = tab.linkedBrowser;
    for (let i = 0; i < 100 && !(br.contentWindow && br.contentDocument?.readyState === "complete" && br.currentURI.spec.includes("home.html")); i++) await spike.sleep(100);
    await spike.sleep(500);
    const w = br.contentWindow;
    check("T5.1 chrome://vitre/content/pages/home.html loads in a tab", br.currentURI.spec === "chrome://vitre/content/pages/home.html", { uri: br.currentURI.spec, remoteType: br.remoteType, isRemote: br.isRemoteBrowser, title: tab.label });
    const probe = w && w.wrappedJSObject ? w.wrappedJSObject.vitreHomeProbe : w?.vitreHomeProbe;
    check("T5.2 page script is privileged (system principal, imports the same sys.mjs singleton)", probe && probe.privileged && probe.principal === "system" && probe.bump === bumpBase + 1, probe);
    check("T5.3 type=module script in the page", (w?.vitreHomeModuleProbe) === "helper.mjs ok", w?.vitreHomeModuleProbe);
    check("T5.4 inline <script> in the page is blocked by the page's own CSP meta (expected)", br.contentDocument.getElementById("inline").textContent === "inline script not run", br.contentDocument.getElementById("inline").textContent);
    await spike.capture("dev-2-home-page");
  });

  // ---- T6: override of a Firefox chrome URL -------------------------------------------------
  await attempt("T6 override", async () => {
    const win = Services.ww.openWindow(null, "chrome://browser/content/aboutDialog.xhtml", "_blank", "chrome,dialog=no,resizable,width=900,height=500", null);
    await new Promise((r) => win.addEventListener("load", r, { once: true }));
    await spike.sleep(600);
    check("T6.1 override: aboutDialog.xhtml now shows Vitre's page", win.document.title === "About Vitre", { title: win.document.title, uri: win.document.documentURI, line: win.document.getElementById("about-line")?.textContent });
    // make it the biggest window of the process so the harness captures it
    await spike.resize(600, 400);
    win.resizeTo(1000, 560);
    win.moveTo(60, 60);
    await spike.sleep(600);
    await spike.capture("dev-3-about-override");
    win.close();
    await spike.resize(1280, 800);
  });

  // ---- T7: reloading without restarting -----------------------------------------------------
  await attempt("T7 reload", async () => {
    // (b): the generated package must also sit inside the runtime copy so content processes can read it.
    const inDist = preRegistered && /spikes[\\/]packaging[\\/]dist/.test(greDir);
    const gen = inDist ? PathUtils.join(greDir, "vitregen-tmp") : PathUtils.join(spike.outDir, "gen");
    await IOUtils.remove(gen, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(gen);
    const put = (name, text) => IOUtils.writeUTF8(PathUtils.join(gen, name), text);
    await put("chrome.manifest", "content vitregen ./\n");
    await put("sub.js", "window.__gen = 'sub v1';\n");
    await put("mod.sys.mjs", "export const v = 'mod v1';\n");
    await put("win.mjs", "export const v = 'win v1';\n");
    await put("sheet.css", "#vitre-probe { background: rgb(255, 0, 0) !important; }\n");
    await put("page.html", "<!doctype html><title>page v1</title><h1>page v1</h1>\n");
    await put("ActorChild.sys.mjs", "export class VitreGenChild extends JSWindowActorChild { receiveMessage() { return 'actor v1'; } }\n");
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(PathUtils.join(gen, "chrome.manifest"));
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(f);
    const B = "chrome://vitregen/content/";
    const probe = document.getElementById("vitre-probe");
    const wu = window.windowUtils;

    Services.scriptloader.loadSubScript(B + "sub.js", window);
    const m1 = ChromeUtils.importESModule(B + "mod.sys.mjs").v;
    const w1 = (await window.__vitreImport(B + "win.mjs")).v;
    wu.loadSheetUsingURIString(B + "sheet.css", wu.AUTHOR_SHEET);
    await spike.sleep(100);
    const c1 = getComputedStyle(probe).backgroundColor;
    ChromeUtils.registerWindowActor("VitreGen", { child: { esModuleURI: B + "ActorChild.sys.mjs" }, matches: ["https://*/*"], safeForUntrustedWebProcess: true });
    const webTab = gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec.startsWith("https://example.com"));
    const askActor = () =>
      Promise.race([
        webTab.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitreGen").sendQuery("x"),
        spike.sleep(4000).then(() => "TIMEOUT (child module unreadable: generated package is outside the runtime dir)"),
      ]);
    const a1 = await askActor();
    const pageTab = gBrowser.addTrustedTab(B + "page.html", { inBackground: true });
    await spike.sleep(800);
    const p1 = pageTab.linkedBrowser.contentDocument.title;
    check("T7.0 v1 baseline", window.__gen === "sub v1" && m1 === "mod v1" && w1 === "win v1" && c1 === "rgb(255, 0, 0)" && (a1 === "actor v1" || !inDist) && p1 === "page v1", { sub: window.__gen, m1, w1, c1, a1, p1 });

    // edit every file on disk
    await put("sub.js", "window.__gen = 'sub v2';\n");
    await put("mod.sys.mjs", "export const v = 'mod v2';\n");
    await put("win.mjs", "export const v = 'win v2';\n");
    await put("sheet.css", "#vitre-probe { background: rgb(0, 0, 255) !important; }\n");
    await put("page.html", "<!doctype html><title>page v2</title><h1>page v2</h1>\n");
    await put("ActorChild.sys.mjs", "export class VitreGenChild extends JSWindowActorChild { receiveMessage() { return 'actor v2'; } }\n");

    // classic subscript
    Services.scriptloader.loadSubScript(B + "sub.js", window);
    const subSame = window.__gen;
    Services.scriptloader.loadSubScriptWithOptions(B + "sub.js", { target: window, ignoreCache: true });
    const subIgnore = window.__gen;
    window.__gen = null;
    Services.scriptloader.loadSubScript(B + "sub.js?2", window);
    const subQuery = window.__gen;
    spike.log("T7.1 subscript: same URL -> " + subSame + " | ignoreCache:true -> " + subIgnore + " | ?query -> " + subQuery);
    check("T7.1 classic subscript reloads (ignoreCache or ?query)", subIgnore === "sub v2" || subQuery === "sub v2");

    // system ESM
    const mSame = ChromeUtils.importESModule(B + "mod.sys.mjs").v;
    let mQuery = "n/a";
    try {
      mQuery = ChromeUtils.importESModule(B + "mod.sys.mjs?2").v;
    } catch (e) {
      mQuery = "ERR " + e;
    }
    spike.log("T7.2 sys.mjs: same URL -> " + mSame + " | ?query -> " + mQuery);
    check("T7.2 sys.mjs: same URL stays cached (singleton), ?query gives the new code", mSame === "mod v1" && mQuery === "mod v2");

    // window ESM
    const wSame = (await window.__vitreImport(B + "win.mjs")).v;
    let wQuery = "n/a";
    try {
      wQuery = (await window.__vitreImport(B + "win.mjs?2")).v;
    } catch (e) {
      wQuery = "ERR " + e;
    }
    spike.log("T7.3 window ESM: same URL -> " + wSame + " | ?query -> " + wQuery);
    check("T7.3 window ESM: ?query gives the new code", wQuery === "win v2");

    // stylesheet
    wu.removeSheetUsingURIString(B + "sheet.css", wu.AUTHOR_SHEET);
    await spike.sleep(100);
    const cRemoved = getComputedStyle(probe).backgroundColor;
    wu.loadSheetUsingURIString(B + "sheet.css", wu.AUTHOR_SHEET);
    await spike.sleep(100);
    const cSame = getComputedStyle(probe).backgroundColor;
    wu.removeSheetUsingURIString(B + "sheet.css", wu.AUTHOR_SHEET);
    wu.loadSheetUsingURIString(B + "sheet.css?2", wu.AUTHOR_SHEET);
    await spike.sleep(100);
    const cQuery = getComputedStyle(probe).backgroundColor;
    spike.log("T7.4 stylesheet: removed -> " + cRemoved + " | re-add same URL -> " + cSame + " | ?query -> " + cQuery);
    check("T7.4 stylesheet reloads (remove + add)", cSame === "rgb(0, 0, 255)" || cQuery === "rgb(0, 0, 255)");
    wu.removeSheetUsingURIString(B + "sheet.css?2", wu.AUTHOR_SHEET);

    // actor
    const aSame = await askActor();
    ChromeUtils.unregisterWindowActor("VitreGen");
    ChromeUtils.registerWindowActor("VitreGen", { child: { esModuleURI: B + "ActorChild.sys.mjs" }, matches: ["https://*/*"], safeForUntrustedWebProcess: true });
    let aRereg = "n/a";
    try {
      aRereg = await askActor();
    } catch (e) {
      aRereg = "ERR " + e;
    }
    ChromeUtils.unregisterWindowActor("VitreGen");
    ChromeUtils.registerWindowActor("VitreGen", { child: { esModuleURI: B + "ActorChild.sys.mjs?2" }, matches: ["https://*/*"], safeForUntrustedWebProcess: true });
    let aQuery = "n/a";
    try {
      aQuery = await askActor();
    } catch (e) {
      aQuery = "ERR " + e;
    }
    spike.log("T7.5 actor: no change -> " + aSame + " | re-register same URL -> " + aRereg + " | re-register ?query -> " + aQuery);
    if (inDist) check("T7.5 actor reloads (unregister + register with ?query)", aQuery === "actor v2");
    else spike.log("SKIP T7.5 (mode a): actor reload needs the package inside the runtime dir");

    // html page
    pageTab.linkedBrowser.reload();
    await spike.sleep(1000);
    const p2 = pageTab.linkedBrowser.contentDocument.title;
    check("T7.6 chrome:// HTML page: plain reload shows the edit", p2 === "page v2", p2);

    ChromeUtils.unregisterWindowActor("VitreGen");
    spike.log("T7.7 ChromeUtils.clearResourceCache: " + typeof ChromeUtils.clearResourceCache + " | xul cache pref nglayout.debug.disable_xul_cache=" + Services.prefs.getBoolPref("nglayout.debug.disable_xul_cache", false));
  });

  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  spike.log("SUMMARY " + (results.length - failed.length) + "/" + results.length + " passed" + (failed.length ? " FAILED: " + failed.join(" | ") : ""));
});
