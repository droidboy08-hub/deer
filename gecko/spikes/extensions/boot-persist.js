// SPIKE 2c: does "pinned to the pill" survive a restart? Run three times on the same profile
// (run-install-real.py ... --keep-profile; a permanent install of the unsigned test XPI needs the
// signatures-off automation run). Each run logs what it found at startup, then changes the state.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  // What CustomizableUI already knows before Vitre registers its area in this session.
  const W = "vitre-inst_spike_test-browser-action";
  const saved = (() => { try { return JSON.parse(Services.prefs.getStringPref("browser.uiCustomization.state", "{}")).placements || {}; } catch (e) { return {}; } })();
  spike.log("startup: saved placements for vitre-ext-bar=" + JSON.stringify(saved["vitre-ext-bar"]), "unified-extensions-area=" + JSON.stringify(saved["unified-extensions-area"]),
    "| widget placement before registerArea:", JSON.stringify(CustomizableUI.getPlacementOfWidget(W)));
  const { toolbar } = xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  let addon = await xt.AddonManager.getAddonByID("vitre-inst@spike.test");
  const where = () => JSON.stringify(CustomizableUI.getPlacementOfWidget(W)) + " nodesInPill=" + toolbar.children.length;
  if (!addon) {
    const install = await xt.AddonManager.getInstallForFile(xt.file("www", "vitre-install.xpi"), "application/x-xpinstall");
    await install.install();
    await xt.waitFor(() => xt.extension("vitre-inst@spike.test") && CustomizableUI.getPlacementOfWidget(W));
    await xt.sleep(500);
    spike.log("RUN 1: installed permanently; default_area navbar re-homed ->", where());
    gUnifiedExtensions.pinToToolbar(W, false);
    await xt.sleep(400);
    spike.log("RUN 1: unpinned ->", where());
    await spike.capture("persist-1-unpinned");
  } else {
    await xt.waitFor(() => xt.extension("vitre-inst@spike.test") && CustomizableUI.getPlacementOfWidget(W));
    await xt.sleep(800);
    const p = CustomizableUI.getPlacementOfWidget(W);
    if (p.area === CustomizableUI.AREA_ADDONS) {
      spike.log("RUN 2: after restart still unpinned ->", where());
      gUnifiedExtensions.pinToToolbar(W, true);
      await xt.sleep(400);
      spike.log("RUN 2: pinned ->", where());
      await spike.capture("persist-2-pinned");
    } else {
      spike.log("RUN 3: after restart still pinned ->", where(), "badge=" + toolbar.querySelector(".unified-extensions-item-action-button")?.getAttribute("badge"));
      await spike.capture("persist-3-pinned-after-restart");
    }
  }
  await xt.sleep(1500); // let CustomizableUI save its state
  spike.log("saved state now: vitre-ext-bar=" + JSON.stringify(JSON.parse(Services.prefs.getStringPref("browser.uiCustomization.state", "{}")).placements?.["vitre-ext-bar"]));
});
