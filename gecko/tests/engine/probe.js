// Engine probe: what changes when Deer runs on Mozilla's unbranded build instead of the branded
// Firefox runtime. Identity and brand strings, AutoConfig, add-on signing (an unsigned add-on installed
// for good and still there after a restart), app update, telemetry, crash reporter, default-browser
// agent, maintenance service, Mozilla endpoints, process image names, the About window.
//   python tests/engine/run_engine.py --test tests/engine/probe.js --name engine-probe --app build-engine --timeout 180
// Control run on the branded runtime (same script; the checks become INFO lines, the signing check is
// reversed: the branded build must refuse the unsigned add-on):
//   python tools/run.py --test tests/engine/probe.js --name engine-ctl-probe --app build-engine --env DEER_PROBE_MODE=control --out tests/engine/out/engine-ctl-probe --timeout 180
// python tests/engine/all.py runs both and prints the comparison. Captures: probe-about.png (the About
// window, a separate OS window captured by its handle), probe-window.png.
/* global spike, Services, ChromeUtils, Cc, Ci, Localization, openAboutDialog, gBrowser, IOUtils, PathUtils */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const control = Services.env.get("DEER_PROBE_MODE") === "control";
  // Engine mode: PASS/FAIL. Control mode: the same facts as INFO lines (the branded runtime is the
  // reference, not the subject), except where a check names its own control expectation.
  const expect = (name, ok, detail, controlOk, controlName) => {
    if (!control) return check(name, ok, detail);
    if (controlOk !== undefined) return check("[control] " + (controlName || name), controlOk, detail);
    log("INFO " + name + " -> " + (ok ? "yes" : "no") + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
    return ok;
  };
  const fact = (key, value) => log("FACT " + key + " = " + JSON.stringify(value));
  // Something a user would see that the layer (not the engine) still has to brand: listed, not failed.
  const gap = (name, detail) => log("GAP " + name + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
  const prefs = Services.prefs;
  const defaults = prefs.getDefaultBranch("");
  const pref = (name) => {
    try {
      switch (prefs.getPrefType(name)) {
        case prefs.PREF_BOOL: return prefs.getBoolPref(name);
        case prefs.PREF_INT: return prefs.getIntPref(name);
        case prefs.PREF_STRING: return prefs.getStringPref(name);
        default: return null;
      }
    } catch (e) {
      return "(error " + e.name + ")";
    }
  };
  const locked = (name) => { try { return prefs.prefIsLocked(name); } catch { return false; } };
  const gre = (...parts) => { const f = Services.dirsvc.get("GreD", Ci.nsIFile); for (const p of parts) f.append(p); return f; };
  const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const ADDON_ID = "engine-probe@deer.test";

  // ---- run 2 (after an in-place restart): the unsigned add-on is still installed and running ----
  if (spike.run > 1) {
    const addon = await AddonManager.getAddonByID(ADDON_ID);
    const info = addon && { active: addon.isActive, appDisabled: addon.appDisabled, signedState: addon.signedState, scope: addon.scope, temporary: addon.temporarilyInstalled };
    log("after restart:", info);
    expect("the unsigned add-on is still installed and active after a restart", !!addon && addon.isActive && !addon.appDisabled && !addon.temporarilyInstalled, info);
    if (addon) await addon.uninstall();
    return;
  }

  await spike.resize(1280, 800);
  await spike.activate();

  // ---- 1. identity ----
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const ai = Services.appinfo;
  fact("exe", exe.leafName);
  fact("appinfo", { name: ai.name, vendor: ai.vendor, version: ai.version, appBuildID: ai.appBuildID, platformVersion: ai.platformVersion, ID: ai.ID, updateURL: ai.updateURL, crashReporterEnabled: ai.crashReporterEnabled });
  const C = {};
  for (const k of ["MOZ_APP_NAME", "MOZ_APP_BASENAME", "MOZ_APP_VERSION_DISPLAY", "MOZ_UPDATE_CHANNEL", "MOZ_OFFICIAL_BRANDING", "MOZILLA_OFFICIAL", "MOZ_REQUIRE_SIGNING", "MOZ_UPDATER", "MOZ_MAINTENANCE_SERVICE", "MOZ_BITS_DOWNLOAD", "MOZ_CRASHREPORTER", "MOZ_TELEMETRY_REPORTING", "MOZ_DATA_REPORTING", "MOZ_NORMANDY", "MOZ_SERVICES_SYNC", "MOZ_SANDBOX", "MOZ_GECKO_PROFILER", "RELEASE_OR_BETA", "NIGHTLY_BUILD", "EARLY_BETA_OR_EARLIER"]) C[k] = AppConstants[k];
  fact("AppConstants", C);
  fact("userAgent", navigator.userAgent);
  const dir = (key) => { try { return Services.dirsvc.get(key, Ci.nsIFile).path; } catch (e) { return "(" + e.name + ")"; } };
  fact("dirs", { UAppData: dir("UAppData"), DefProfRt: dir("DefProfRt"), UpdRootD: dir("UpdRootD"), GreD: dir("GreD") });
  expect("runs as deer.exe", exe.leafName === "deer.exe", exe.leafName);
  expect("Gecko 157.0, build 20260924084938 (the same as gecko/runtime)", ai.version === "157.0" && ai.platformVersion === "157.0" && ai.appBuildID === "20260924084938", [ai.version, ai.appBuildID]);
  expect("websites still see Firefox 157 in the user agent", /\) Gecko\/20100101 Firefox\/157\.0$/.test(navigator.userAgent), navigator.userAgent);
  expect("the build does not force add-on signing (MOZ_REQUIRE_SIGNING off)", !AppConstants.MOZ_REQUIRE_SIGNING, AppConstants.MOZ_REQUIRE_SIGNING);

  // ---- 2. brand strings: the engine's own, and what Deer's layer makes of them ----
  const raw = async (url) => { try { return await (await fetch(url)).text(); } catch (e) { return "(" + e + ")"; } };
  const engineBrand = await raw("resource://app/localization/en-US/branding/brand.ftl");
  fact("engine brand.ftl", engineBrand.split("\n").filter((l) => l.startsWith("-") || l.startsWith("trademark")).join(" | "));
  const l10n = new Localization(["branding/brand.ftl", "browser/aboutDialog.ftl", "browser/browser.ftl"], true);
  const attr = (id, name) => l10n.formatMessagesSync([{ id }])[0]?.attributes?.find((a) => a.name === name)?.value;
  const shown = {
    aboutTitle: attr("aboutDialog-title", "title"),
    privateTitle: l10n.formatValueSync("browser-main-private-window-title"),
    brandProperties: Services.strings.createBundle("chrome://branding/locale/brand.properties").GetStringFromName("brandShortName"),
    windowTitle: document.title,
  };
  fact("strings as shown", shown);
  expect("Firefox's strings say the layer's brand, not Nightly or Firefox", !/Nightly|Firefox/.test(JSON.stringify(shown)), shown);
  expect("the engine's own brand is not Firefox", /-brand-short-name = (?!Firefox)/.test(engineBrand), undefined, /-brand-short-name = Firefox/.test(engineBrand), "the branded runtime's own brand is Firefox");

  // ---- 3. AutoConfig (config.js, unsandboxed) ----
  const S = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs").VitreStartup;
  const autoconfig = { filename: defaults.getStringPref("general.config.filename", ""), sandbox: defaults.getBoolPref("general.config.sandbox_enabled", true), loader: S.options?.loader, inited: S.inited, error: pref("vitre.bootstrap.error") };
  fact("autoconfig", autoconfig);
  expect("AutoConfig ran config.js unsandboxed and it started the layer", autoconfig.filename === "config.js" && autoconfig.sandbox === false && autoconfig.loader === "autoconfig" && autoconfig.inited && autoconfig.error === null, autoconfig);

  // ---- 4. enterprise policies, app update ----
  const policies = Services.policies;
  const active = Object.keys(policies.getActivePolicies?.() || {});
  fact("policies", { status: policies.status, active });
  const us = Cc["@mozilla.org/updates/update-service;1"].getService(Ci.nsIApplicationUpdateService);
  const update = {
    appUpdateAllowed: policies.isAllowed("appUpdate"), disabled: us.disabled, canCheck: us.canCheckForUpdates, canApply: us.canApplyUpdates,
    channel: defaults.getStringPref("app.update.channel", ""), url: ai.updateURL, auto: pref("app.update.auto"), background: pref("app.update.background.enabled"),
    service: pref("app.update.service.enabled"), updater: gre("updater.exe").exists(), maintenanceService: gre("maintenanceservice.exe").exists(),
  };
  fact("update", update);
  expect("app update is off (policy) and Mozilla's updater and maintenance service are not in the folder", !update.appUpdateAllowed && update.disabled && !update.canCheck && !update.updater && !update.maintenanceService, update);

  // ---- 5. telemetry, studies ----
  const tel = {};
  for (const k of ["datareporting.healthreport.uploadEnabled", "datareporting.policy.dataSubmissionEnabled", "toolkit.telemetry.enabled", "toolkit.telemetry.unified", "toolkit.telemetry.archive.enabled", "toolkit.telemetry.server", "toolkit.telemetry.shutdownPingSender.enabled", "toolkit.telemetry.firstShutdownPing.enabled", "toolkit.telemetry.newProfilePing.enabled", "toolkit.telemetry.updatePing.enabled", "app.normandy.enabled", "app.shield.optoutstudies.enabled", "browser.newtabpage.activity-stream.telemetry", "browser.ping-centre.telemetry"]) tel[k] = [pref(k), locked(k) ? "locked" : ""];
  tel.canRecordExtended = Services.telemetry.canRecordExtended;
  tel.pingsender = gre("pingsender.exe").exists();
  fact("telemetry", tel);
  expect("telemetry upload is off and locked by policy; no pingsender.exe", tel["datareporting.healthreport.uploadEnabled"][0] === false && tel["datareporting.healthreport.uploadEnabled"][1] === "locked" && tel["datareporting.policy.dataSubmissionEnabled"][0] === false && !tel.pingsender, tel);

  // ---- 6. crash reporter ----
  const cr = { enabled: ai.crashReporterEnabled };
  try {
    const r = Cc["@mozilla.org/toolkit/crash-reporter;1"].getService(Ci.nsICrashReporter);
    try { cr.serverURL = r.serverURL.spec; } catch (e) { cr.serverURL = "(" + e.name + ")"; }
  } catch (e) {
    cr.error = String(e);
  }
  cr.env = Services.env.get("MOZ_CRASHREPORTER_DISABLE");
  cr.crashreporterExe = gre("crashreporter.exe").exists();
  cr.crashhelperExe = gre("crashhelper.exe").exists();
  cr.unsubmittedCheck = pref("browser.crashReports.unsubmittedCheck.enabled");
  cr.tabsSendReport = pref("browser.tabs.crashReporting.sendReport");
  fact("crash reporter", cr);
  // The launcher and the harness set MOZ_CRASHREPORTER_DISABLE=1. Without it (DEER_PROBE_CRASH=on, see
  // all.py) the stock identity's reporter is on and points at Mozilla's server, with no crashreporter.exe
  // to send with; Deer's identity (setup-engine.py CRASH_REPORTER, deer-engine.json "identity") switches
  // it off in the engine itself.
  let identity = null;
  try { identity = JSON.parse(await IOUtils.readUTF8(gre("deer-engine.json").path)).identity; } catch {}
  const reporterOn = identity?.app ? !!identity.crashReporter : true;
  cr.identity = identity?.app ? "Deer" : "stock";
  if (Services.env.get("DEER_PROBE_CRASH") === "on") expect("with MOZ_CRASHREPORTER_DISABLE unset the engine still starts (no crashhelper.exe), has no crashreporter.exe, and its reporter is " + (reporterOn ? "on (stock identity)" : "off (Deer's identity)"), cr.enabled === reporterOn && !cr.crashreporterExe && !cr.crashhelperExe, cr);
  else expect("no crash report can be sent: reporter off in this process, crashreporter.exe absent", !cr.enabled && !cr.crashreporterExe, cr);

  // ---- 7. default-browser agent, shell integration ----
  // The DisableDefaultBrowserAgent policy is enforced by the agent itself (Policies.sys.mjs), and the
  // browser schedules the agent's task only for MSIX installs (DefaultAgentScheduler.sys.mjs); the
  // pref default-browser-agent.enabled stays true. Without the exe there is nothing to run.
  const dba = { pref: pref("default-browser-agent.enabled"), policy: active.includes("DisableDefaultBrowserAgent"), exe: gre("default-browser-agent.exe").exists(), checkDefault: pref("browser.shell.checkDefaultBrowser"), privateStub: gre("private_browsing.exe").exists(), helper: gre("uninstall", "helper.exe").exists(), jumpLists: pref("browser.taskbar.lists.enabled") };
  fact("default browser", dba);
  expect("default-browser agent: policy set and the exe not in the folder; no private_browsing.exe / helper.exe stubs", dba.policy && !dba.exe && !dba.privateStub && !dba.helper, dba);

  // ---- 8. Mozilla endpoints still configured (informational) ----
  const fmt = (name) => {
    if (prefs.getPrefType(name) !== prefs.PREF_STRING) return pref(name);
    const value = pref(name);
    if (!/%[A-Z_]+%/.test(value)) return value;
    try { return Services.urlFormatter.formatURLPref(name); } catch { return value; }
  };
  const keyed = (url) => (typeof url === "string" ? url.replace(/([?&]key=)[^&]+/, (m, p) => (/no-/.test(m) ? m : p + "<present>")) : url);
  const endpoints = {};
  for (const k of ["services.settings.server", "browser.safebrowsing.provider.google4.updateURL", "browser.safebrowsing.provider.mozilla.updateURL", "geo.provider.network.url", "browser.region.network.url", "captivedetect.canonicalURL", "network.connectivity-service.DNSv4.domain", "dom.push.serverURL", "media.gmp-manager.url", "extensions.update.url", "extensions.getAddons.get.url", "extensions.blocklist.enabled", "security.remote_settings.crlite_filters.enabled", "app.normandy.api_url", "identity.fxaccounts.enabled", "identity.fxaccounts.remote.root", "network.trr.uri", "browser.contentblocking.report.lockwise.enabled", "app.support.baseURL", "app.update.url.manual", "app.releaseNotesURL"]) endpoints[k] = keyed(fmt(k));
  fact("endpoints", endpoints);
  const runtimePrefs = {};
  for (const k of ["dom.ipc.processPrelaunch.enabled", "dom.ipc.processPrelaunch.fission.number", "fission.autostart", "dom.ipc.processCount", "media.eme.enabled", "media.gmp-widevinecdm.visible", "media.gmp-widevinecdm.enabled", "media.gmp-gmpopenh264.enabled", "media.gmp-manager.updateEnabled", "media.wmf.media-engine.enabled", "browser.taskbar.lists.enabled", "toolkit.winRegisterApplicationRestart", "app.update.channel"]) runtimePrefs[k] = pref(k);
  fact("engine prefs", runtimePrefs);
  const sbKey = /key=<present>/.test(endpoints["browser.safebrowsing.provider.google4.updateURL"]);
  fact("google safebrowsing api key compiled in", sbKey);

  // ---- 9. a media plug-in process (ClearKey ships in gmp-clearkey, nothing is downloaded), then the
  // image name of every process of this run (QueryFullProcessImageNameW on each pid) ----
  // EME needs a web page in a secure context: a file: page written to the temp folder runs it and
  // reports through its title (the session stays open while the tab is open).
  const eme = {};
  let emeTab = null;
  try {
    const page = Services.dirsvc.get("TmpD", Ci.nsIFile);
    page.append("deer-engine-probe-eme-" + Services.appinfo.processID + ".html");
    const html = "<!doctype html><meta charset=utf-8><title>EME ...</title><script>" +
      "(async () => { let step = 'access'; try {" +
      " const a = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{ initDataTypes: ['keyids'], audioCapabilities: [{ contentType: 'audio/mp4; codecs=\"mp4a.40.2\"' }] }]);" +
      " step = 'createMediaKeys'; const k = await a.createMediaKeys(); step = 'createSession'; const s = k.createSession('temporary'); window.keep = [k, s];" +
      " const m = new Promise((r) => s.addEventListener('message', () => r('message'), { once: true }));" +
      " step = 'generateRequest'; await s.generateRequest('keyids', new TextEncoder().encode(JSON.stringify({ kids: ['AAAAAAAAAAAAAAAAAAAAAA'] })));" +
      " document.title = 'EME ok ' + a.keySystem + ' ' + (await Promise.race([m, new Promise((r) => setTimeout(() => r('no message'), 5000))]));" +
      " } catch (e) { document.title = 'EME error at ' + step + ': ' + e + ' ' + (e.message || ''); } })();</script>";
    await IOUtils.writeUTF8(page.path, html);
    emeTab = gBrowser.addTab(Services.io.newFileURI(page).spec, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    const title = await waitFor(() => /^EME (ok|error)/.test(emeTab.linkedBrowser.contentTitle) && emeTab.linkedBrowser.contentTitle, { timeout: 15000, what: "the EME page" });
    eme.result = title;
    await sleep(500);
    try { page.remove(false); } catch {}
  } catch (e) {
    eme.error = String(e);
  }
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const k32 = ctypes.open("kernel32.dll");
    const OpenProcess = k32.declare("OpenProcess", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.uint32_t);
    const QueryImage = k32.declare("QueryFullProcessImageNameW", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.char16_t.ptr, ctypes.uint32_t.ptr);
    const CloseHandle = k32.declare("CloseHandle", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t);
    const image = (pid) => {
      const h = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
      if (h.isNull()) return "(no access)";
      const buf = ctypes.char16_t.array(1024)();
      const len = ctypes.uint32_t(1024);
      const ok = QueryImage(h, 0, buf, len.address());
      CloseHandle(h);
      return ok ? buf.readString().split("\\").pop() : "(unknown)";
    };
    const info = await ChromeUtils.requestProcInfo();
    const procs = [info, ...info.children].map((p) => [p.pid, p.type || "browser", image(p.pid)]);
    k32.close();
    eme.process = procs.filter((p) => /gmp/i.test(p[1])).map((p) => p[1] + " " + p[2]).join(", ") || "(none)";
    fact("media plug-in (ClearKey)", eme);
    fact("processes", procs);
    // Without a firefox.exe next to the engine createMediaKeys() rejects with AbortError and no plug-in
    // process starts (tools/setup-engine.py, --media-host).
    expect("a media plug-in (ClearKey CDM) starts and answers: createMediaKeys + generateRequest", /^EME ok org\.w3\.clearkey message$/.test(eme.result || "") && /gmpPlugin/.test(eme.process), eme);
    const firefoxExe = gre("firefox.exe");
    fact("firefox.exe in the engine folder", firefoxExe.exists() ? firefoxExe.fileSize + " bytes" : "absent");
    expect("processes run as deer.exe, media plug-ins as plugin-container.exe; nothing runs as firefox.exe", procs.every((p) => p[2].toLowerCase() === (p[1] === "gmpPlugin" ? "plugin-container.exe" : "deer.exe")), procs.map((p) => p[1] + ":" + p[2]));
  } catch (e) {
    log("FAIL process images: " + e);
  }
  if (emeTab) gBrowser.removeTab(emeTab);

  // ---- 10. add-on signing: an unsigned add-on installed for good ----
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const xpi = (() => {
    const f = Services.dirsvc.get("TmpD", Ci.nsIFile);
    f.append("deer-engine-probe-" + Services.appinfo.processID + ".xpi");
    const manifest = JSON.stringify({ manifest_version: 2, name: "Deer engine probe", version: "1.0", description: "Unsigned test add-on written by tests/engine/probe.js", browser_specific_settings: { gecko: { id: ADDON_ID } } });
    const zw = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
    zw.open(f, 0x02 | 0x08 | 0x20);
    const s = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    s.setByteStringData(manifest);
    zw.addEntryStream("manifest.json", Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, s, false);
    zw.close();
    return f;
  })();
  const tryInstall = async () => {
    const install = await AddonManager.getInstallForFile(xpi, "application/x-xpinstall");
    const before = { state: install.state, error: install.error };
    let addon = null;
    let thrown = null;
    try {
      addon = await install.install();
    } catch (e) {
      thrown = String(e && (e.message || e));
    }
    return { before, state: install.state, error: install.error, thrown, addon, signedState: addon?.signedState, active: addon?.isActive, appDisabled: addon?.appDisabled };
  };
  const show = (r) => ({ before: r.before, state: r.state, error: r.error, thrown: r.thrown, signedState: r.signedState, active: r.active, appDisabled: r.appDisabled });
  // a) with Firefox's default, xpinstall.signatures.required = true
  prefs.setBoolPref("xpinstall.signatures.required", true);
  const strict = await tryInstall();
  log("signatures required:", { REQUIRE_SIGNING: AddonSettings.REQUIRE_SIGNING, ...show(strict) });
  if (strict.addon) await strict.addon.uninstall();
  expect("with xpinstall.signatures.required=true the unsigned add-on is refused", !strict.addon || !strict.addon.isActive, show(strict));
  // b) with the pref false (what a Deer default would set)
  prefs.setBoolPref("xpinstall.signatures.required", false);
  const loose = await tryInstall();
  log("signatures not required:", { REQUIRE_SIGNING: AddonSettings.REQUIRE_SIGNING, ...show(loose) });
  const honoured = !!loose.addon && loose.addon.isActive && !loose.addon.appDisabled && loose.signedState === AddonManager.SIGNEDSTATE_MISSING;
  expect("xpinstall.signatures.required=false is honoured: the unsigned add-on installs permanently and runs", honoured, show(loose), !honoured, "the branded runtime refuses the unsigned add-on even with xpinstall.signatures.required=false");
  try { xpi.remove(false); } catch {}

  // ---- 11. the About window ----
  try {
    openAboutDialog();
    const about = await waitFor(() => {
      const w = Services.wm.getMostRecentWindow("Browser:About");
      return w && w.document.readyState === "complete" && w.document.getElementById("version")?.textContent ? w : null;
    }, { timeout: 10000, what: "About window" });
    await sleep(1500);
    const d = about.document;
    const text = (id) => d.getElementById(id)?.textContent.replace(/\s+/g, " ").trim();
    const deck = d.getElementById("updateDeck");
    const bg = (id) => { const el = d.getElementById(id); return el ? about.getComputedStyle(el).backgroundImage : null; };
    const aboutInfo = { title: d.title, version: text("version"), distribution: text("distribution"), update: deck?.selectedPanel?.id, updateText: deck?.selectedPanel?.textContent.replace(/\s+/g, " ").trim(), channel: text("currentChannelText"), trademark: text("trademark"), community: text("communityDesc")?.slice(0, 120), logo: bg("leftBox"), wordmark: bg("rightBox") };
    fact("about window", aboutInfo);
    expect("the About window's text speaks as the layer's brand (no Nightly or Firefox)", !/Nightly|Firefox/.test([aboutInfo.title, aboutInfo.version, aboutInfo.updateText, aboutInfo.trademark, aboutInfo.community].join(" ")), aboutInfo);
    if (/chrome:\/\/branding\//.test(aboutInfo.logo + aboutInfo.wordmark)) {
      gap("the About window draws the engine's own branding art (chrome://branding/content/about-logo.png and about-wordmark.svg: the 'Nightly' wordmark on the unbranded engine); the layer must override chrome://branding/content/* or aboutDialog.xhtml", { logo: aboutInfo.logo, wordmark: aboutInfo.wordmark });
    }
    if (/default/.test(aboutInfo.channel || "")) gap("the About window names the update channel 'default'", aboutInfo.channel);
    const hwnd = about.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    const done = PathUtils.join(spike.outDir, "probe-about.png.done");
    log("@@capture probe-about " + hwnd);
    for (let i = 0; i < 200 && !(await IOUtils.exists(done)); i++) await sleep(50);
    about.close();
  } catch (e) {
    log("FAIL About window: " + e);
  }

  await spike.capture("probe-window");
  log("restarting to see whether the add-on stays installed");
  await spike.restart();
});
