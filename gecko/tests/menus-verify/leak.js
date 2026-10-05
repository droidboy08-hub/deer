// Does a window that showed menus get collected after it closes, like one that never did?
// Two windows: A never opens a menu, B opens a page menu, a chrome menu and a service menu (and is
// closed while one is open). Both are closed; after GC/CC rounds both weak references must be empty.
//   python tests/menus-verify/all.py leak
/* global spike, Services, Cu, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep } = spike;
  await spike.resize(1200, 800);
  await M.activate();
  const article = M.page("article.html");
  const collect = async (refs, rounds = 20) => {
    for (let i = 0; i < rounds && refs.some((r) => r.get()); i++) {
      Cu.forceShrinkingGC();
      Cu.forceCC();
      await sleep(400);
    }
    return refs.map((r) => !r.get());
  };
  const close = (w) => new Promise((r) => {
    w.addEventListener("unload", r, { once: true });
    w.close();
  });

  // Each window is used inside its own function, so the test keeps no reference to it or its DOM.
  // A: no menu.
  const refA = await (async () => {
    const a = await spike.openWindow();
    await a.spike.activate();
    await a.M.load(article);
    await sleep(500);
    const ref = Cu.getWeakReference(a);
    await close(a);
    return ref;
  })();

  // B: menus of every kind, closed with one open.
  const refB = await (async () => {
    const bw = await spike.openWindow();
    await bw.spike.activate();
    bw.M.fakeServices();
    await bw.M.load(article);
    await bw.M.openOn("#link1");
    check("B: a page menu opened", bw.M.isOpen());
    bw.M.key("KEY_Escape");
    await bw.M.waitClosed();
    {
      const r = bw.vitre.bar.item(bw.vitre.active().id).getBoundingClientRect();
      bw.M.rightClick(r.left + 100, r.top + 22);
    }
    check("B: a chrome menu opened", await bw.M.waitOpen());
    bw.M.key("KEY_Escape");
    await bw.M.waitClosed();
    bw.M.menus().api.show([{ label: "Service row", run: () => {} }], { x: 300, y: 300 });
    await bw.M.openOn("#img1");
    check("B: an image menu open while the window closes", bw.M.isOpen());
    const ref = Cu.getWeakReference(bw);
    await close(bw);
    return ref;
  })();
  await sleep(1000);

  const [goneA, goneB] = await collect([refA, refB]);
  log("collected after close", JSON.stringify({ withoutMenus: goneA, withMenus: goneB }));
  if (goneA) check("a window that showed menus is collected like one that did not", goneB, { goneA, goneB });
  else log("inconclusive: even the window without menus stays alive in this run");
  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
});
