// The three switcher styles at 3, 12 and 40 tabs over real pages, held Ctrl+Tab, with the time from
// the Ctrl+Tab keydown to the switcher's first paint.
// python tools/run.py --test tests/switcher/styles.js --name switcher-styles --app build-switcher --timeout 420
// Captures: styles-<style>-<n>.png (TabSwitcher, TabOverview, TabSwitcherStrip boards).
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  log("dpr", window.devicePixelRatio, "inner", innerWidth, innerHeight);
  const timings = [];
  let tabs = [];

  async function round(n) {
    // Open up to n tabs (the first ones stay), then visit the last three so the MRU is known.
    if (!tabs.length) tabs = await S.openTabs(REAL_PAGES.slice(0, n));
    else {
      const more = REAL_PAGES.slice(tabs.length, n);
      for (let i = 0; i < more.length; i += 6) {
        const group = more.slice(i, i + 6).map((u) => b.newTab(u, { background: true, index: b.tabs.length }));
        tabs.push(...group);
        await Promise.all(group.map((t) => S.loaded(t)));
      }
    }
    log(`--- ${n} tabs (${b.tabs.length} open), not loaded:`, b.tabs.filter((t) => t.loading).map((t) => t.url));
    await S.visit([tabs[2], tabs[1], tabs[0]]);
    for (const style of ["deck", "grid", "strip"]) {
      await S.setStyle(style);
      await S.holdOpen(1);
      const st = S.state();
      await S.settled(1100);
      const tm = { ...S.sw().timing };
      const shown = S.painted();
      timings.push({ style, tabs: tm.tabs, keyToPaint: Math.round(tm.paint - tm.begin), showToPaint: Math.round(tm.paint - tm.show), keyToShow: Math.round(tm.show - tm.begin) });
      check(`${style} at ${n} tabs: opens on the previous tab with every tab as a card`, st.selected === tabs[1].id && st.list.length === b.tabs.length && S.cards().length === b.tabs.length, { selected: S.selected(), list: st.list.length, cards: S.cards().length });
      check(`${style} at ${n} tabs: every card on screen shows its page`, shown.onScreen > 0 && shown.painted === shown.onScreen, shown);
      check(`${style} at ${n} tabs: first paint within 60 ms of the 150 ms quick-tap window`, tm.paint > 0 && tm.paint - tm.begin < 210, timings[timings.length - 1]);
      await spike.capture(`styles-${style}-${n}`);
      await S.release();
      check(`${style} at ${n} tabs: letting go of Ctrl opens the selected tab`, b.activeId === tabs[1].id, S.active());
      // Back to the first tab for the next round.
      b.activate(tabs[0]);
      await sleep(400);
    }
  }

  await round(3);
  await round(12);
  await round(40);
  log("timings (ms)", timings);
  log("thumbs", S.sw().thumbs.stats, S.sw().thumbs.memory());
  const mem = S.sw().thumbs.memory();
  check("40 tabs: at most 16 decoded pictures are kept; every tab has a JPEG", mem.bitmaps <= 16 && mem.jpegs >= b.tabs.length - 1, mem);
});
