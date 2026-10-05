// VERIFY claim 24 ("load unpacked that sticks is not possible"): alternative 1, no internals patched.
// Vitre remembers the folder and re-installs it as a temporary add-on at every start. Does the
// extension keep its identity (uuid), its storage.local data and its pinned/unpinned placement?
// Run several times on one kept profile (release build, signatures enforced).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { AddonManager } = xt;
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const ID = "vitre-persist@spike.test", W = "vitre-persist_spike_test-browser-action";
  const run = Services.prefs.getIntPref("vitre.verify.run", 0) + 1;
  Services.prefs.setIntPref("vitre.verify.run", run);
  const saved = (() => { try { return JSON.parse(Services.prefs.getStringPref("browser.uiCustomization.state", "{}")).placements || {}; } catch (e) { return {}; } })();
  const uuids = (() => { try { return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids", "{}")); } catch (e) { return {}; } })();
  spike.log(`RUN ${run} startup: REQUIRE_SIGNING=${AddonSettings.REQUIRE_SIGNING} keepStorageOnUninstall=${Services.prefs.getBoolPref("extensions.webextensions.keepStorageOnUninstall", false)} keepUuidOnUninstall=${Services.prefs.getBoolPref("extensions.webextensions.keepUuidOnUninstall", false)}`);
  spike.log(`RUN ${run} startup: known to AddonManager before re-install=${!!(await AddonManager.getAddonByID(ID))} saved uuid=${uuids[ID] || null} saved placements pill=${JSON.stringify(saved["vitre-ext-bar"])} addons-area=${JSON.stringify(saved["unified-extensions-area"])}`);
  const { toolbar } = xt.installExtensionBar(ui);
  await xt.nav(xt.page());

  const t0 = Date.now();
  const addon = await AddonManager.installTemporaryAddon(xt.file("ext", "persist"));
  await xt.waitFor(() => xt.reported(ID)?.runs);
  const ms = Date.now() - t0;
  await xt.sleep(500);
  const where = () => JSON.stringify(CustomizableUI.getPlacementOfWidget(W)) + " nodesInPill=" + toolbar.children.length;
  spike.log(`RUN ${run}: installTemporaryAddon took ${ms} ms; temporarilyInstalled=${addon.temporarilyInstalled} extension reports`, JSON.stringify(xt.reported(ID)), "| placement", where());

  if (run === 1) {
    gUnifiedExtensions.pinToToolbar(W, false);
    await xt.sleep(400);
    spike.log("RUN 1: user unpins ->", where());
  } else if (run === 2) {
    spike.log("RUN 2: placement chosen in run 1 was " + (CustomizableUI.getPlacementOfWidget(W)?.area === CustomizableUI.AREA_ADDONS ? "KEPT (still unpinned)" : "LOST (back in the pill)"));
    gUnifiedExtensions.pinToToolbar(W, true);
    await xt.sleep(400);
    spike.log("RUN 2: user pins ->", where());
  } else {
    spike.log("RUN 3: placement chosen in run 2 was " + (CustomizableUI.getPlacementOfWidget(W)?.area === "vitre-ext-bar" ? "KEPT (still pinned)" : "LOST"));
  }
  await xt.nav(xt.page() + "?persist" + run);
  await xt.waitFor(() => gBrowser.selectedTab.label.startsWith("RESULT"));
  spike.log(`RUN ${run}: blocking works:`, gBrowser.selectedTab.label);
  await spike.capture("temp-persist-run" + run);
  await xt.sleep(1500);
});
