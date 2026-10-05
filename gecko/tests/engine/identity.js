// Deer engine identity, browser side. Driven by tests/engine/identity.py, which starts the engine
// WITHOUT -no-remote (Gecko's remoting is live), answers the @@handoff / @@remoting requests below and
// compares snapshots of everything outside the profile before and after the session.
//
// DEER_IDENTITY_MODE:
//   session   (default) run 1: identity, data root, user agent (chrome, HTTP header, page, worker),
//             getBrowserInfo() from a real add-on, crash reporter, Windows notifications set up,
//             URL hand-off from a second and a third start (single instance), the remote window
//             class, what programs Deer starts inherit; then an in-place restart. Run 2: the
//             identity survives the restart (whose command line is a bare deer.exe), clean quit.
//   facts     only the FACT lines (the stock-identity reference run): no checks.
//   quick     only the first FACT line (identity, directories, environment), then quit: the
//             environment-override runs of identity.py --env-overrides.
//   fallback  an unpatched deer.exe (stock compiled identity) started with
//             -app <engine>\browser\application.ini as its first argument: the identity checks, and
//             what that route leaves in the environment of programs Deer starts and registers with
//             Windows' restart manager.
// identity.py reads the FACT lines (install hash, data root) to attribute what the session wrote.
/* global spike, Services, ChromeUtils, Cc, Ci, IOUtils, PathUtils, gBrowser */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const mode = Services.env.get("DEER_IDENTITY_MODE") || "session";
  const fact = (key, value) => log("FACT " + key + " = " + JSON.stringify(value));
  const env = (name) => Services.env.get(name);
  const dir = (key) => { try { return Services.dirsvc.get(key, Ci.nsIFile).path; } catch (e) { return "(" + e.name + ")"; } };
  const ai = Services.appinfo;
  const http = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const join = (...p) => PathUtils.join(...p);
  const FIREFOX_ID = "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}";
  // What Firefox <version> on 64-bit Windows 10/11 sends (nsHttpHandler::BuildUserAgent).
  const STOCK_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${ai.version}) Gecko/20100101 Firefox/${ai.version}`;

  // ---- facts (every mode) ----
  const installHash = Cc["@mozilla.org/xre/directory-provider;1"].getService(Ci.nsIXREDirProvider).getInstallHash();
  const facts = {
    appinfo: { name: ai.name, vendor: ai.vendor, ID: ai.ID, version: ai.version, appBuildID: ai.appBuildID, UAName: ai.UAName, crashReporterEnabled: ai.crashReporterEnabled },
    // ContentTmpD: the content sandbox's temp folder (LocalLow\Mozilla\Temp-... on older Geckos; 157 has
    // none and answers NS_ERROR_FAILURE).
    dirs: { UAppData: dir("UAppData"), DefProfRt: dir("DefProfRt"), DefProfLRt: dir("DefProfLRt"), UpdRootD: dir("UpdRootD"), ProfD: dir("ProfD"), ProfLD: dir("ProfLD"), GreD: dir("GreD"), AppD: dir("XCurProcD"), ContentTmpD: dir("ContentTmpD"), XREUSysExt: dir("XREUSysExt") },
    installHash,
    env: { XUL_APP_FILE: env("XUL_APP_FILE") || null, MOZ_CRASHREPORTER_DISABLE: env("MOZ_CRASHREPORTER_DISABLE") || null },
    ua: { http: http.userAgent, appName: http.appName, appVersion: http.appVersion, navigator: navigator.userAgent, override: Services.prefs.prefHasUserValue("general.useragent.override") || Services.prefs.getDefaultBranch("").getPrefType("general.useragent.override") !== 0 },
    restartPref: Services.prefs.getBoolPref("toolkit.winRegisterApplicationRestart", false),
    run: spike.run,
  };
  fact("identity", facts);
  // quick: the facts above only (identity.py --env-overrides reads appinfo and ProfD from them).
  if (mode === "quick") return;

  // getBrowserInfo() as an add-on sees it: a temporary add-on whose background page opens its own page
  // with the answer in the hash.
  const browserInfo = async () => {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const id = "identity-probe@deer.test";
    const folder = join(PathUtils.tempDir, "deer-identity-addon-" + ai.processID);
    await IOUtils.makeDirectory(folder, { ignoreExisting: true });
    await IOUtils.writeUTF8(join(folder, "manifest.json"), JSON.stringify({
      manifest_version: 2, name: "Deer identity probe", version: "1.0",
      browser_specific_settings: { gecko: { id } }, background: { scripts: ["bg.js"] },
    }));
    await IOUtils.writeUTF8(join(folder, "bg.js"),
      "browser.runtime.getBrowserInfo().then((i) => browser.tabs.create({ active: false, url: browser.runtime.getURL('r.html') + '#' + encodeURIComponent(JSON.stringify(i)) }));");
    await IOUtils.writeUTF8(join(folder, "r.html"), "<!doctype html><meta charset=utf-8><title>r</title>");
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(folder);
    const addon = await AddonManager.installTemporaryAddon(file);
    let tab = null;
    try {
      tab = await waitFor(() => gBrowser.tabs.find((t) => /^moz-extension:.*\/r\.html#/.test(t.linkedBrowser.currentURI.spec)), { timeout: 15000, what: "the add-on's page" });
      return JSON.parse(decodeURIComponent(tab.linkedBrowser.currentURI.ref));
    } finally {
      if (tab) gBrowser.removeTab(tab);
      await addon.uninstall();
      await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
    }
  };

  // The environment a program started by Deer gets (opening a download with another program, a
  // protocol handler...): nsIProcess passes the browser's own environment on, as Gecko's helper-app
  // launches do. cmd.exe writes it to a file in the temp folder (a path without spaces).
  const childEnv = async () => {
    const out = join(PathUtils.tempDir, "deer-identity-env-" + ai.processID + ".txt");
    const cmd = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    cmd.initWithPath(env("ComSpec"));
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(cmd);
    proc.runw(true, ["/d", "/c", "set > " + out], 3);
    const text = await IOUtils.readUTF8(out).catch(() => null);
    await IOUtils.remove(out, { ignoreAbsent: true });
    if (text === null) throw new Error("cmd.exe wrote no environment (exit " + proc.exitValue + ")");
    return text.split(/\r?\n/).filter((l) => /^(XUL_APP_FILE|MOZ_|XRE_)/i.test(l));
  };

  const identityChecks = (where, compiledNames = true) => {
    const a = facts.appinfo, d = facts.dirs;
    check(where + "the engine is Deer: appinfo vendor and name 'Deer'", a.vendor === "Deer" && a.name === "Deer", a);
    check(where + "the application ID is still Firefox's (add-ons install as for Firefox)", a.ID === FIREFOX_ID, a.ID);
    check(where + "data root %APPDATA%\\Deer, local data root %LOCALAPPDATA%\\Deer", same(d.UAppData, join(env("APPDATA"), "Deer")) && same(d.DefProfRt, join(env("APPDATA"), "Deer", "Profiles")) && same(d.DefProfLRt, join(env("LOCALAPPDATA"), "Deer", "Profiles")), d);
    // XREUSysExt (%APPDATA%\Mozilla\Extensions, compiled in: toolkit/xre/nsXREDirProvider.cpp) is only
    // read: add-ons other programs install there for Firefox's application ID.
    const written = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "XREUSysExt"));
    const mozilla = Object.entries(written).filter(([, p]) => /\\(Mozilla|Firefox)(\\|-|$)/i.test(p));
    if (compiledNames) check(where + "no directory the engine writes to names Mozilla or Firefox (update root included)", !mozilla.length, written);
    else log("INFO " + where + "directories still under Mozilla's compile-time names (an application.ini cannot rename them): " + JSON.stringify(Object.fromEntries(mozilla)));
    check(where + "the user agent is exactly Firefox's, from the engine itself (no general.useragent.override)", facts.ua.http === STOCK_UA && facts.ua.navigator === STOCK_UA && !facts.ua.override, facts.ua);
  };

  // Windows notifications: the system alerts service registers its AppUserModelID (and the notification
  // server's COM class) the first time it is set up; nothing is shown. identity.py looks for what that
  // wrote. It cannot be set up without <engine>\browser\VisualElements\VisualElements_70.png (the toast
  // icon), which setup-engine.py strips: Gecko then shows its own notification windows instead.
  const alerts = () => {
    try {
      Cc["@mozilla.org/system-alerts-service;1"].getService(Ci.nsIAlertsService);
      return "set up";
    } catch (e) {
      return "not available: " + e.name;
    }
  };

  if (mode === "facts") {
    fact("getBrowserInfo", await browserInfo());
    fact("system alerts service", alerts());
    return;
  }

  if (mode === "fallback" && spike.run > 1) {
    // After an in-place restart (whose command line no longer has -app).
    identityChecks("[-app, after restart] ", false);
    return;
  }
  if (mode === "fallback") {
    identityChecks("[-app] ", false);
    const info = await browserInfo();
    fact("getBrowserInfo", info);
    check("[-app] getBrowserInfo() as with the compiled-in identity", info.name === "Deer" && info.vendor === "Deer" && info.version === ai.version, info);
    const inherited = await childEnv();
    fact("child environment", inherited);
    log("INFO -app route: XUL_APP_FILE in this process " + JSON.stringify(facts.env.XUL_APP_FILE) + ", in programs it starts " + JSON.stringify(inherited.filter((l) => /^XUL_APP_FILE/i.test(l))));
    const done = join(spike.outDir, "restartcmd.json");
    await IOUtils.remove(done, { ignoreAbsent: true });
    log("@@restartcmd");
    await waitFor(() => IOUtils.exists(done), { timeout: 20000, what: "restartcmd.json" });
    log("INFO Windows' restart manager would start: " + (await IOUtils.readUTF8(done)) + " (no -app, no XUL_APP_FILE: the stock identity on Deer's profile)");
    log("restarting in place");
    await spike.restart();
  }

  // ---- session, run 2: after the in-place restart ----
  if (spike.run > 1) {
    identityChecks("[after restart] ");
    check("[after restart] still no XUL_APP_FILE: the identity is compiled in, not passed", !facts.env.XUL_APP_FILE, facts.env);
    return;
  }

  // ---- session, run 1 ----
  await spike.resize(1100, 720);
  await spike.activate();
  identityChecks("");
  check("nothing was passed for the identity: no XUL_APP_FILE, no -app (it is compiled into deer.exe)", !facts.env.XUL_APP_FILE, facts.env);
  check("the crash reporter is off although MOZ_CRASHREPORTER_DISABLE is not set", !facts.appinfo.crashReporterEnabled && !facts.env.MOZ_CRASHREPORTER_DISABLE, [facts.appinfo.crashReporterEnabled, facts.env]);

  // User agent in a page, a worker and on the wire.
  const headers = [];
  const observer = { observe(subject) { const ch = subject.QueryInterface(Ci.nsIHttpChannel); if (/example\.com/.test(ch.URI.host)) headers.push(ch.getRequestHeader("User-Agent")); } };
  Services.obs.addObserver(observer, "http-on-modify-request");
  const page = join(spike.outDir, "identity-ua.html");
  await IOUtils.writeUTF8(page, "<!doctype html><meta charset=utf-8><title>UA ...</title><script>" +
    "const w = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'], { type: 'text/javascript' })));" +
    "w.onmessage = (e) => { document.title = 'UA ' + JSON.stringify({ page: navigator.userAgent, worker: e.data }); };</script>");
  const uaTab = gBrowser.addTab(PathUtils.toFileURI(page), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  const seen = await waitFor(() => /^UA \{/.test(uaTab.linkedBrowser.contentTitle) && JSON.parse(uaTab.linkedBrowser.contentTitle.slice(3)), { timeout: 15000, what: "the UA page" });
  gBrowser.removeTab(uaTab);
  const webTab = gBrowser.addTab("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await waitFor(() => headers.length, { timeout: 15000, what: "a request to example.com" }).catch(() => null);
  Services.obs.removeObserver(observer, "http-on-modify-request");
  gBrowser.removeTab(webTab);
  fact("ua as sites see it", { ...seen, header: headers[0] || null });
  check("pages, workers and the User-Agent header see exactly Firefox's user agent", seen.page === STOCK_UA && seen.worker === STOCK_UA && headers[0] === STOCK_UA, { expected: STOCK_UA, ...seen, header: headers[0] });

  const info = await browserInfo();
  fact("getBrowserInfo", info);
  check("browser.runtime.getBrowserInfo() from an add-on: name and vendor Deer, Firefox's version and build", info.name === "Deer" && info.vendor === "Deer" && info.version === ai.version && info.buildID === ai.appBuildID, info);

  // The add-on manager is up now (it asked for every install location). The folder other programs
  // drop add-ons into for Firefox's ID (XREUSysExt, compiled-in "Mozilla\Extensions") is only read.
  const usysExisted = env("DEER_IDENTITY_USYSEXT_EXISTED") === "1";
  check("%APPDATA%\\Mozilla\\Extensions (add-ons other programs install for Firefox) is only read, never created",
    usysExisted || !(await IOUtils.exists(facts.dirs.XREUSysExt)), { path: facts.dirs.XREUSysExt, existedBefore: usysExisted });
  // Deer's distribution\policies.json (no app update, no telemetry, no default-browser agent) does not
  // depend on appinfo.name; only the Windows GPO key does (Software\Policies\Mozilla\<Name>).
  const policies = { status: Services.policies.status, appUpdate: Services.policies.isAllowed("appUpdate") };
  check("Deer's distribution\\policies.json is in force under the name Deer (policy engine active, app update not allowed)",
    policies.status === Ci.nsIEnterprisePolicies.ACTIVE && policies.appUpdate === false, policies);

  fact("system alerts service", alerts());

  // Programs Deer starts.
  const inherited = await childEnv();
  fact("child environment", inherited);
  check("programs Deer starts get no identity override (no XUL_APP_FILE in their environment)", !inherited.some((l) => /^XUL_APP_FILE=/i.test(l)), inherited);

  // Remoting: the runner lists the windows of this process tree.
  const ask = async (line, file) => {
    const done = join(spike.outDir, file);
    await IOUtils.remove(done, { ignoreAbsent: true });
    log(line);
    await waitFor(() => IOUtils.exists(done), { timeout: 40000, what: file });
    await sleep(100);
    return JSON.parse(await IOUtils.readUTF8(done));
  };
  // Windows' restart manager: after an update reboot Windows starts deer.exe itself (not Deer.exe) with
  // the command line Gecko registered (toolkit.winRegisterApplicationRestart), in a fresh environment.
  // It keeps -profile; the identity has to come from deer.exe itself (-app and XUL_APP_FILE are gone).
  const restartCmd = await ask("@@restartcmd", "restartcmd.json");
  fact("restart manager registration", { pref: facts.restartPref, registered: restartCmd });
  check("Windows' restart manager would start deer.exe on this profile (-profile kept) with Deer's compiled-in identity", !facts.restartPref || (restartCmd.length === 1 && /-profile <profile>/.test(restartCmd[0][0]) && !/-app\b/.test(restartCmd[0][0])), restartCmd);

  const remote = await ask("@@remoting", "remoting.json");
  fact("remote window classes", remote);
  check("Gecko's remote window is keyed by the remoting name 'deer' (no 'firefox')", remote.some((c) => /deer/i.test(c)) && !remote.some((c) => /firefox/i.test(c)), remote);

  // URL hand-off: a second start (a link from another program) and a third with -new-window.
  const tabFor = (url) => {
    for (const w of Services.wm.getEnumerator("navigator:browser")) {
      for (const t of w.gBrowser.tabs) if (t.linkedBrowser.currentURI.spec === url) return { window: w, tab: t };
    }
    return null;
  };
  const windowsBefore = [...Services.wm.getEnumerator("navigator:browser")].length;
  for (const n of [1, 2]) {
    const file = join(spike.outDir, "identity-handoff-" + n + ".html");
    await IOUtils.writeUTF8(file, "<!doctype html><meta charset=utf-8><title>hand-off " + n + "</title><p>hand-off " + n);
    const url = PathUtils.toFileURI(file);
    const started = Date.now();
    const result = await ask("@@handoff " + n + " " + url, "handoff-" + n + ".json");
    const found = await waitFor(() => tabFor(url), { timeout: 20000, what: "the handed-over URL " + n }).catch(() => null);
    fact("handoff " + n, { ...result, arrivedAfterMs: Date.now() - started });
    check("start " + (n + 1) + " handed its URL to the running Deer and exited" + (n === 2 ? " (-new-window: a new window)" : ""),
      !!found && result.exitCode === 0 && result.processTreeGoneAfterMs !== null && result.mainProcesses === 1 && (n === 1 || found.window !== window), { result, found: !!found });
  }
  const windowsAfter = [...Services.wm.getEnumerator("navigator:browser")].length;
  check("one Deer process, one more window (the -new-window start)", windowsAfter === windowsBefore + 1, { windowsBefore, windowsAfter });
  for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window) w.close();
  await sleep(500);

  log("restarting in place (the new process's command line is a bare deer.exe)");
  await spike.restart();
});
