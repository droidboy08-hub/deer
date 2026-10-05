// Spike glass / test 3: real-looking refraction without feDisplacementMap.
// Left half: content-side backdrop-filter:url(#offset-lens) (live, compositor).
// Right half: REFERENCE = the true Electron lens graph (feImage + feDisplacementMap) applied as a
// normal `filter` to a snapshot of exactly the pixels under the corresponding left-hand shape.
/* global spike, G, gBrowser, Services, document, window, DOMRect */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const tag = Services.env.get("VITRE_TAG") || "default";
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");
  const L = G.layer();
  const C = await G.contentGlass();
  const browser = gBrowser.selectedBrowser;
  spike.log("max-filter-ops-per-chain", Services.prefs.getIntPref("gfx.webrender.max-filter-ops-per-chain"));

  const BIG = { radius: 30, bezel: 26, scale: 40, blur: 0.6 };
  const PILL = { blur: 2.4 };
  const shapes = [
    // [x, y, w, h, lens opts, cell, label]
    [30, 20, 220, 120, BIG, 2, "big cell2"],
    [270, 20, 220, 120, BIG, 4, "big cell4"],
    [510, 20, 100, 100, { ...BIG, radius: 50 }, 3, "disc cell3"],
    [30, 170, 480, 44, PILL, 2, "pill cell2"],
    [30, 232, 480, 44, PILL, 4, "pill cell4"],
    [530, 170, 44, 44, {}, 2, "c2"],
    [530, 232, 44, 44, {}, 3, "c3"],
    [584, 232, 44, 44, {}, 4, "c4"],
    [30, 300, 480, 44, PILL, 3, "pill cell3 on text"],
    [530, 300, 44, 44, {}, 2, "c2"],
    [30, 480, 480, 44, PILL, 2, "pill cell2 on lines"],
    [530, 480, 44, 44, {}, 2, "c2"],
    [30, 640, 220, 120, BIG, 2, "big cell2 on grid"],
    [270, 640, 220, 120, BIG, 3, "big cell3 on grid"],
    [510, 640, 100, 100, { ...BIG, radius: 50 }, 2, "disc cell2"],
  ];

  // 1. References first (the snapshot must not contain the lens layer).
  const wg = browser.browsingContext.currentWindowGlobal;
  for (const [x, y, w, h, opts, , label] of shapes) {
    const t0 = performance.now();
    const bmp = await wg.drawSnapshot(new DOMRect(x, y, w, h), 1, "white");
    const dt = performance.now() - t0;
    const c = G.el("canvas", `position:absolute; left:${x + 640}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${opts.radius ?? Math.min(w, h) / 2}px;`, L);
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    c.style.filter = `url(#${G.lensFilter(w, h, opts)})`;
    spike.log("snapshot", label, w + "x" + h, dt.toFixed(1) + "ms");
  }
  // Divider + headings (parent chrome layer).
  G.el("div", "position:absolute; left:638px; top:0; bottom:0; width:4px; background:#000;", L);
  G.el("div", "position:absolute; left:250px; top:146px; background:#000; color:#fff; padding:1px 6px;", L, "LEFT: live backdrop-filter feOffset cells (content process)");
  G.el("div", "position:absolute; left:890px; top:146px; background:#000; color:#fff; padding:1px 6px;", L, "RIGHT: reference, true feDisplacementMap on a snapshot");

  // 2. Live lens layer in content.
  let defs = "";
  let divs = "";
  shapes.forEach(([x, y, w, h, opts, cell, label], i) => {
    const f = G.offsetLensMarkup("ol" + i, w, h, { ...opts, cell });
    defs += f.markup;
    spike.log("offset lens", label, w + "x" + h, "cell", cell, "feOffset nodes", f.nodes);
    divs += `<div style="position:fixed; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${opts.radius ?? Math.min(w, h) / 2}px; backdrop-filter:url(#ol${i});"></div>`;
  });
  spike.log("set ->", await C.set(`<svg style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}`));
  await spike.sleep(1000);
  await spike.capture("offsetlens-" + tag);
});
