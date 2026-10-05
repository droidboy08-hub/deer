// VERIFY claim 24 ("permanent install of unsigned extensions is not possible on the stock release
// runtime"): alternative 2. AddonSettings.REQUIRE_SIGNING is a frozen constant, but every consumer
// asks XPIDatabase.mustSign(type), which is an ordinary writable method on an exported object.
// Vitre's privileged code can replace it. This script (release build, NOT automation mode):
//   run 1: patch mustSign, install the unsigned XPI permanently through AddonManager;
//   run 2: after a restart, look at the add-on BEFORE patching (does it still run?), then run
//          Firefox's own daily signature check unpatched and patched;
//   run 3: state after another restart.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { toolbar } = xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  const DB = XPIExports.XPIDatabase;
  const ID = "vitre-inst@spike.test", W = "vitre-inst_spike_test-browser-action";
  const run = Services.prefs.getIntPref("vitre.verify.run", 0) + 1;
  Services.prefs.setIntPref("vitre.verify.run", run);
  const desc = Object.getOwnPropertyDescriptor(DB, "mustSign");
  spike.log(`RUN ${run}: REQUIRE_SIGNING=${AddonSettings.REQUIRE_SIGNING} Cu.isInAutomation=${Cu.isInAutomation} mustSign("extension")=${DB.mustSign("extension")} mustSign descriptor writable=${desc?.writable} configurable=${desc?.configurable}`);
  const rsDesc = Object.getOwnPropertyDescriptor(AddonSettings, "REQUIRE_SIGNING");
  spike.log(`RUN ${run}: AddonSettings.REQUIRE_SIGNING descriptor writable=${rsDesc?.writable} configurable=${rsDesc?.configurable}`);
  const info = async () => {
    const a = await AddonManager.getAddonByID(ID);
    return a ? JSON.stringify({ isActive: a.isActive, appDisabled: a.appDisabled, userDisabled: a.userDisabled, temporary: a.temporarilyInstalled, signedState: a.signedState, scope: a.scope,
      running: !!xt.extension(ID), placement: CustomizableUI.getPlacementOfWidget(W), nodesInPill: toolbar.children.length }) : "not installed";
  };
  const original = DB.mustSign;
  // The patch. A real implementation would only waive signing for add-on IDs the user loaded through
  // Vitre's "Load unpacked"; mustSign only receives the type, so the waiver is global while active.
  const patch = () => { DB.mustSign = function () { return false; }; };
  const unpatch = () => { DB.mustSign = original; };

  await xt.nav(xt.page());
  if (run === 1) {
    let install = await AddonManager.getInstallForFile(xt.file("www", "vitre-install.xpi"), "application/x-xpinstall");
    spike.log("RUN 1 unpatched: getInstallForFile -> state=" + AddonManager.stateToString(install.state), "error=" + install.error, AddonManager.errorToString(install.error) || "");
    patch();
    spike.log("RUN 1 patched: mustSign(\"extension\")=" + DB.mustSign("extension"));
    install = await AddonManager.getInstallForFile(xt.file("www", "vitre-install.xpi"), "application/x-xpinstall");
    spike.log("RUN 1 patched: getInstallForFile -> state=" + AddonManager.stateToString(install.state), "error=" + install.error);
    try {
      await install.install();
      await xt.waitFor(() => xt.extension(ID) && CustomizableUI.getPlacementOfWidget(W));
      await xt.sleep(600);
    } catch (e) { spike.log("RUN 1 install failed: " + e); }
    spike.log("RUN 1 patched: after install.install():", await info());
    await spike.capture("unsigned-perm-run1-installed");
  } else {
    await xt.sleep(1500);
    spike.log(`RUN ${run} after restart, BEFORE any patch (startup ran with stock mustSign):`, await info());
    await spike.capture(`unsigned-perm-run${run}-after-restart`);
    if (run === 2) {
      // Firefox re-verifies signatures once a day (timer "xpi-signature-verification") and when
      // extensions.signatureCheckpoint changes (after some updates). Emulate that check.
      await DB.verifySignatures();
      await xt.sleep(800);
      spike.log("RUN 2 after Firefox's periodic verifySignatures(), UNPATCHED:", await info());
      patch();
      await DB.verifySignatures();
      await xt.sleep(800);
      spike.log("RUN 2 after verifySignatures() with the patch in place:", await info());
    }
  }
  spike.log(`RUN ${run} end: installed add-ons`, JSON.stringify((await AddonManager.getAddonsByTypes(["extension"])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => a.id + (a.temporarilyInstalled ? " (temporary)" : "") + (a.isActive ? "" : " (inactive)"))));
  await xt.sleep(1500);
});
