// Switcher verification across a restart: quit with the switcher up (a card other than the current
// one selected), then after session restore: the tab you were on is the active one, nothing is left
// of the switcher, Ctrl+Tab works at once over tabs that have not loaded (their cards show last
// session's pictures, painted on time), and a restored card can be closed from the switcher.
// python tools/run.py --test tests/switcher-verify/restore.js --name swverify-restore --app build-switcher-verify --timeout 300
/* global spike, Services, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const th = () => window.vitreSwitcher.thumbs;
  const names = ["Rose", "Sky", "Mint", "Sand", "Lilac", "Ink"];
  const colours = ["#e8a0a0", "#a0c0e8", "#a0e8c0", "#e8d8a0", "#c8a0e8", "#20242c"];

  if (spike.run === 1) {
    await V.openTabs(names.map((n, i) => V.page(n, colours[i], "", i === 5 ? "#eee" : "#111")));
    const byName = (n) => b.tabs.find((t) => t.title === n);
    // MRU: Rose (current), Sky, Mint, Sand, Lilac, Ink.
    await V.visit(["Ink", "Lilac", "Sand", "Mint", "Sky", "Rose"].map(byName));
    await sleep(2500); // pictures settle and are saved
    await V.latched(); // opens on Sky, the previous tab
    press("Right");
    await sleep(300);
    log("quitting with the switcher up", { selected: V.sel(), active: V.active(), saved: th().stats.saved });
    check("run 1: the switcher is up with Mint selected while Rose is active", state().phase === "open" && V.sel() === "Mint" && V.active() === "Rose", { sel: V.sel(), active: V.active() });
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  await waitFor(() => b.tabs.length >= 6, { timeout: 20000, what: "restored tabs" });
  await sleep(1200);
  const deferred = b.tabs.filter((t) => t.deferred).map((t) => t.title || t.url);
  log("restored", { tabs: b.tabs.map((t) => [t.title, t.deferred]), active: V.active(), mru: b.mru.map((id) => V.titleOf(id)), stats: th().stats });
  check("after the restart the tab you were on is active (the selected card was never opened) and the switcher is gone", V.active() === "Rose" && state().phase === "idle" && V.leftovers().children === 0, { active: V.active(), phase: state().phase, left: V.leftovers() });
  check("restored tabs that have not loaded are known with last session's pictures", deferred.length >= 4 && b.tabs.filter((t) => t.deferred).every((t) => th().has(t.id)), { deferred, has: b.tabs.filter((t) => t.deferred).map((t) => th().has(t.id)) });
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    await V.holdOpen(1);
    await sleep(900);
    // Read after the opening has painted (holdOpen resolves as soon as the switcher's DOM is in).
    const tm = { ...window.vitreSwitcher.timing };
    const p = (() => {
      const vis = [...document.querySelectorAll("#layer-switcher .sw-media")].filter((m) => {
        const r = m.getBoundingClientRect();
        const card = m.closest(".sw-dcard, .sw-gcard, .sw-scard");
        return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && parseFloat(getComputedStyle(card).opacity) > 0.05;
      });
      return { onScreen: vis.length, painted: vis.filter((m) => !m.classList.contains("none")).length };
    })();
    await spike.capture(`restore-${style}`);
    const sel = V.sel();
    press("Shift+Tab");
    await sleep(100);
    await V.release();
    check(`restored session, ${style}: Ctrl+Tab paints within 250 ms over unloaded tabs and every card on screen shows its picture`, tm.paint > 0 && tm.paint - tm.begin < 250 && p.onScreen > 0 && p.painted === p.onScreen, { keyToPaint: Math.round(tm.paint - tm.begin), ...p, sel });
  }
  await V.setStyle("deck");
  // Close a restored, never-loaded tab from the switcher.
  const n0 = b.tabs.length;
  const target = b.tabs.find((t) => t.deferred && t.title === "Lilac") ?? b.tabs.find((t) => t.deferred);
  await V.latched();
  for (let i = 0; i < 10 && state().selected !== target?.id; i++) {
    press("Right");
    await sleep(40);
  }
  press("W", { ctrlKey: true });
  await sleep(600);
  check("a restored tab that never loaded closes from the switcher", !!target && !b.tabs.includes(target) && b.tabs.length === n0 - 1 && state().phase === "open", { target: target?.title, tabs: b.tabs.length });
  press("Escape");
  await V.closed();
  // And comes back with Ctrl+Shift+T (the switcher's file id travels with it).
  press("Shift+T", { ctrlKey: true });
  await sleep(1500);
  const back = b.tabs.find((t) => t.title === target?.title);
  check("Ctrl+Shift+T brings it back", !!back, b.tabs.map((t) => t.title));
  const c = V.consoleDump("restore");
  check("no console errors from Vitre across the restart", c.vitre === 0, c);
});
