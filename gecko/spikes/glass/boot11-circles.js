// Spike glass: which cheap lens is good enough for the 44 px tab circles and the 480 px pill?
// Each variant shape (left of a pair) sits next to its REFERENCE twin (right of the pair): the true
// feDisplacementMap lens applied to a snapshot of the variant's own backdrop.
/* global spike, G, gBrowser, Services, document, window, DOMRect */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");
  const L = G.layer();
  const C = await G.contentGlass();
  const browser = gBrowser.selectedBrowser;

  const variants = [
    ["plain blur+sat", null, 0],
    ["octo 8 nodes", { bands: [[0, 5]], capBands: [[0, 5]], diag: true }, 0],
    ["nsew 12 nodes", { diag: false }, 0],
    ["full 16 nodes", { diag: true }, 0],
    ["cells3", "cells", 0],
  ];
  // Circle pairs: 5 variants x 3 rows; pill pairs below.
  const shapes = [];
  const rowsY = [70, 150, 215];
  variants.forEach(([label, opts], vi) => {
    rowsY.forEach((y, ri) => shapes.push({ x: 40 + vi * 240 + ri * 9, y, w: 44, h: 44, label, opts, lens: {} }));
  });
  [["plain blur+sat", null], ["strip 12 nodes", { diag: false }], ["strip 16 nodes", { diag: true }]].forEach(([label, opts], i) => {
    shapes.push({ x: 40, y: 290 + i * 56, w: 480, h: 44, label, opts, lens: { blur: 2.4 }, refDX: 520 });
  });

  let defs = "";
  let divs = "";
  shapes.forEach((s, i) => {
    let bf = `blur(${s.lens.blur ?? 1.4}px) saturate(1.5)`;
    if (s.opts) {
      const f = s.opts === "cells" ? G.offsetLensMarkup("f" + i, s.w, s.h, { ...s.lens, cell: 3 }) : G.stripLensMarkup("f" + i, s.w, s.h, { ...s.lens, ...s.opts });
      defs += f.markup;
      s.nodes = f.nodes;
      bf = `url(#f${i})`;
    }
    divs += `<div style="position:fixed; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; border-radius:22px; backdrop-filter:${bf};"></div>`;
  });
  const lensHTML = `<svg style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}`;
  spike.log("nodes:", shapes.filter((s) => s.nodes).map((s) => s.label + "=" + s.nodes).filter((v, i, a) => a.indexOf(v) === i).join(", "));

  G.css(`
    .vg { position:absolute; border-radius:22px; box-shadow: 0 10px 28px rgba(40,30,15,0.14), 0 1px 2px rgba(40,30,15,0.18); }
    .vg > div { position:absolute; inset:0; border-radius:inherit; overflow:hidden; }
    .vg > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.22)); }
    .vg > .rim { padding:1px; background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 30%, rgba(255,255,255,0.2) 60%, rgba(255,255,255,0.8));
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
  `);
  const tinted = Services.env.get("VITRE_TINT") !== "0";
  const refs = [];
  const trueLens = new Map();
  for (const s of shapes) {
    for (const ref of [false, true]) {
      const x = s.x + (ref ? s.refDX ?? 52 : 0);
      const g = G.el("div", `left:${x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px;`, L);
      g.className = "vg";
      const lens = G.el("div", "", g);
      if (tinted) {
        G.el("div", "", g).className = "tint";
        G.el("div", "", g).className = "rim";
      } else g.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.6)";
      if (ref) {
        const key = s.w + "x" + s.h;
        if (!trueLens.has(key)) trueLens.set(key, G.lensFilter(s.w, s.h, s.lens));
        refs.push([s, lens, trueLens.get(key)]);
      }
    }
  }
  variants.forEach(([label], vi) => G.el("div", `position:absolute; left:${40 + vi * 240}px; top:52px; background:#000; color:#fff; padding:0 5px; font-size:11px;`, L, label + " | true"));
  shapes.filter((s) => s.w > 44).forEach((s) => G.el("div", `position:absolute; left:${s.x + 180}px; top:${s.y - 13}px; background:#000; color:#fff; padding:0 5px; font-size:11px;`, L, s.label + "  (left)  |  true lens (right)"));

  async function shot(name, scrollY) {
    await C.set("");
    const sy = await C.scroll(scrollY);
    await spike.sleep(300);
    for (const [s, lens, id] of refs) {
      lens.textContent = "";
      const bmp = await browser.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(s.x, sy + s.y, s.w, s.h), 1, "white");
      const c = G.el("canvas", `position:absolute; left:0; top:0; width:${s.w}px; height:${s.h}px; filter:url(#${id});`, lens);
      c.width = s.w;
      c.height = s.h;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
    }
    await C.set(lensHTML);
    await spike.sleep(700);
    await spike.capture("circles-" + name + (tinted ? "" : "-raw"));
  }
  await shot("stripes", 0);
  await shot("lines", 400);
  await shot("grid", 560);
  await shot("checker", 930);
});
