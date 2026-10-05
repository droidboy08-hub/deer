// Switcher smoke: three real pages, held Ctrl+Tab in each style, one capture each.
// python tools/run.py --test tests/switcher/smoke.js --name switcher-smoke --app build-switcher --timeout 120
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  log("modules", b.modules, b.moduleErrors, "dpr", window.devicePixelRatio, "inner", innerWidth, innerHeight);
  const tabs = await S.openTabs(REAL_PAGES.slice(0, 3));
  await S.visit([tabs[2], tabs[1], tabs[0]]);
  log("tabs", tabs.map((t) => t.title));
  for (const style of ["deck", "grid", "strip"]) {
    await S.setStyle(style);
    await S.holdOpen(1);
    await S.settled(1000);
    const st = S.state();
    log(style, "state", st, "painted", S.painted(), "timing", S.sw().timing);
    await spike.capture(`smoke-${style}`);
    await S.release();
    check(`${style}: release opens the selected card`, S.active() === S.titleOf(st.selected), { active: S.active() });
    await sleep(500);
  }
  log("thumbs", S.sw().thumbs.stats, S.sw().thumbs.memory());
});
