// Across a restart: add-ons loaded with "Load temporary add-on" come back (Vitre installs them again
// as temporary add-ons at start, no signing waiver), and pinned / unpinned placement is kept
// (CustomizableUI state in browser.uiCustomization.state).
//   python tests/extensions/runx.py --test tests/extensions/persist.js --name extensions-persist --app build-extensions --timeout 240
// Captures: persist-1-before-restart, persist-2-after-restart.
/* global spike, Services, CustomizableUI, xt */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1280, 800);
  await spike.activate();

  if (spike.run === 1) {
    await xt.nav(xt.page());
    await sys.loadTemporary(xt.extPath("popup"));
    await sys.loadTemporary(xt.extPath("pin1"));
    await xt.waitFor(() => xt.button("popup") && xt.button("pin1"), 6000);
    window.gUnifiedExtensions.pinToToolbar(xt.widgetId("popup"), false);
    await xt.waitFor(() => xt.area("popup") === CustomizableUI.AREA_ADDONS, 3000);
    check("run 1: popup unpinned, pin1 pinned", xt.area("popup") === CustomizableUI.AREA_ADDONS && xt.area("pin1") === "vitre-ext-bar");
    check("run 1: both remembered", sys.temporary().length === 2, sys.temporary());
    await sleep(500);
    await capture("persist-1-before-restart");
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  const t0 = Date.now();
  await sys.restored;
  log("restored after", Date.now() - t0, "ms (from the script start)", sys.temporary());
  await xt.nav(xt.page() + "?after");
  const popup = await xt.AddonManager.getAddonByID(xt.id("popup"));
  const pin1 = await xt.AddonManager.getAddonByID(xt.id("pin1"));
  check("run 2: both loaded again at start, as temporary add-ons", !!popup?.temporarilyInstalled && !!pin1?.temporarilyInstalled && sys.temporary().every((t) => !t.error), sys.temporary());
  await xt.waitFor(() => xt.button("pin1"), 6000);
  await sleep(500);
  check("run 2: pin1 still pinned in the pill", xt.area("pin1") === "vitre-ext-bar" && !!xt.button("pin1"), xt.area("pin1"));
  check("run 2: popup still in the extensions panel", xt.area("popup") === CustomizableUI.AREA_ADDONS && !xt.button("popup")?.closest("#vitre-ext-bar"), xt.area("popup"));
  check("run 2: blocking-free test page still loads", (window.gBrowser.selectedTab.label || "").includes("o1=loaded"));
  await capture("persist-2-after-restart");
});
