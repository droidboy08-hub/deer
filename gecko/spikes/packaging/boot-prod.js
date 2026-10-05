// Checks the PRODUCTION loader (dist-files/config.js -> chrome://vitre/ -> VitreStartup.sys.mjs).
// This script registers nothing itself: it only inspects what config.js already did.
// Run: python spikes/packaging/run-dist.py --name packaging-prod --boot spikes/packaging/boot-prod.js --url https://example.com
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, OpenBrowserWindow */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.resize(1280, 800);
  await spike.loaded();

  const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
  const where = reg.convertChromeURL(Services.io.newURI("chrome://vitre/content/chrome.manifest")).spec;
  const greDir = Services.dirsvc.get("GreD", Ci.nsIFile).path;
  spike.log("GreD=" + greDir + " | VITRE_APP=" + (Services.env.get("VITRE_APP") || "(unset)") + " | chrome://vitre/content/ -> " + where);
  spike.log("bootstrap error pref: " + Services.prefs.getStringPref("vitre.bootstrap.error", "(none)"));

  const { VitreStartup } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs");
  check("P1 config.js registered chrome://vitre and ran VitreStartup.init", VitreStartup.options?.loader === "autoconfig", VitreStartup.options);
  spike.log("P1 timeline (ms since process start): " + JSON.stringify(VitreStartup.timeline));
  check("P2 stylesheet + root attribute were set before first paint (browser-window-before-show)", document.documentElement.getAttribute("vitre") === "true" && !!document.querySelector('link[href="chrome://vitre/skin/vitre.css"]'));
  check("P3 per-window script ran in this window", window.VitreWindowProbe?.windowNumber === 1 && getComputedStyle(document.getElementById("vitre-probe")).backgroundColor === "rgb(10, 132, 255)", window.VitreWindowProbe);

  // Actor round trip: the child module must be readable by the sandboxed web content process.
  const { VitreProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs");
  const loaded = VitreProbe.events.find((e) => e.name === "VitreProbe:Loaded");
  check("P4 child actor in the web content process reported DOMContentLoaded", !!loaded && loaded.data.processType === 2, loaded?.data ?? VitreProbe.events);
  try {
    const actor = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe");
    const pong = await Promise.race([actor.sendQuery("VitreProbe:Ping"), spike.sleep(5000).then(() => "TIMEOUT")]);
    check("P5 parent -> child sendQuery", pong && pong.title === "Example Domain" && pong.processType === 2, pong);
  } catch (e) {
    check("P5 parent -> child sendQuery", false, String(e));
  }
  const errs = Services.console.getMessageArray().map((m) => String(m.message || m)).filter((m) => /Failed to load chrome:\/\/vitre/.test(m));
  check("P6 no 'Failed to load chrome://vitre...' errors from content processes", errs.length === 0, errs.slice(0, 3));
  await spike.capture("prod-1-window");

  // Second window gets the layer too.
  const opened = new Promise((r) => {
    const obs = (w) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      r(w);
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  OpenBrowserWindow();
  const win2 = await opened;
  await spike.sleep(500);
  check("P7 a second browser window also gets the layer", win2.VitreWindowProbe?.windowNumber === 2 && win2.document.documentElement.getAttribute("vitre") === "true", win2.VitreWindowProbe);
  win2.close();

  // ---- updates (item 4) ----
  const upd = {};
  try { upd.policyAppUpdateAllowed = Services.policies.isAllowed("appUpdate"); } catch (e) { upd.policyAppUpdateAllowed = "ERR " + e; }
  try { upd.policiesStatus = Services.policies.status; upd.activePolicies = Object.keys(Services.policies.getActivePolicies() || {}); } catch (e) { upd.policies = "ERR " + e; }
  try {
    const aus = Cc["@mozilla.org/updates/update-service;1"].getService(Ci.nsIApplicationUpdateService);
    upd.ausDisabled = aus.disabled;
    upd.canUsuallyCheckForUpdates = aus.canUsuallyCheckForUpdates;
    upd.canCheckForUpdates = aus.canCheckForUpdates;
    upd.canUsuallyApplyUpdates = aus.canUsuallyApplyUpdates;
    upd.currentState = aus.currentState;
  } catch (e) { upd.aus = "ERR " + e; }
  try { upd.autoUpdatePref = Services.prefs.getBoolPref("app.update.auto", null); } catch (e) {}
  try { upd.backgroundTaskPref = Services.prefs.getBoolPref("app.update.background.enabled", null); } catch (e) {}
  try {
    const { UpdateUtils } = ChromeUtils.importESModule("resource://gre/modules/UpdateUtils.sys.mjs");
    upd.channel = UpdateUtils.UpdateChannel;
  } catch (e) {}
  try { upd.updRootDir = Services.dirsvc.get("UpdRootD", Ci.nsIFile).path; } catch (e) { upd.updRootDir = "ERR " + e.name; }
  spike.log("UPDATES " + JSON.stringify(upd));
  check("U1 policy DisableAppUpdate holds (appUpdate not allowed, update service disabled)", upd.policyAppUpdateAllowed === false && upd.ausDisabled === true, upd);
});
