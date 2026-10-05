// VERIFY claim 22 robustness: does an add-on installed with AddonManager.installBuiltinAddon()
// survive a restart on its own, or must Vitre call it at every start? Run twice on a kept profile.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { toolbar } = xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const ID = "vitre-persist@spike.test", W = "vitre-persist_spike_test-browser-action";
  const run = Services.prefs.getIntPref("vitre.verify.run", 0) + 1;
  Services.prefs.setIntPref("vitre.verify.run", run);
  await xt.nav(xt.page());
  await xt.sleep(1000);
  const info = async () => {
    const a = await AddonManager.getAddonByID(ID);
    return a ? JSON.stringify({ isBuiltin: a.isBuiltin, isActive: a.isActive, isPrivileged: a.isPrivileged, signedState: a.signedState, hidden: a.hidden, running: !!xt.extension(ID), reported: xt.reported(ID),
      canUninstall: !!(a.permissions & AddonManager.PERM_CAN_UNINSTALL), canDisable: !!(a.permissions & AddonManager.PERM_CAN_DISABLE), placement: CustomizableUI.getPlacementOfWidget(W)?.area, nodesInPill: toolbar.children.length }) : "not installed";
  };
  spike.log(`RUN ${run} at startup, before any install call:`, await info());
  if (run === 1) {
    const a = await AddonManager.installBuiltinAddon("resource://vitre-boot/ext/persist/");
    await xt.waitFor(() => xt.reported(ID)?.runs);
    await xt.sleep(500);
    spike.log("RUN 1 after installBuiltinAddon:", await info());
  } else {
    // the documented idempotent call for every start
    const a = await AddonManager.maybeInstallBuiltinAddon(ID, "1.0", "resource://vitre-boot/ext/persist/");
    await xt.sleep(1500);
    spike.log(`RUN ${run} after maybeInstallBuiltinAddon(id, version, base):`, await info());
  }
  await xt.nav(xt.page() + "?builtin" + run);
  await xt.waitFor(() => gBrowser.selectedTab.label.startsWith("RESULT"));
  spike.log(`RUN ${run} blocking:`, gBrowser.selectedTab.label);
  await spike.capture("builtin-run" + run);
  await xt.sleep(1200);
});
