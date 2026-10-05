// Spike glass: can ONE backdrop-filter element serve the whole tab bar (union shape)? Which of
// clip-path: path() / mask / plain border-radius survive on a backdrop-filter element, and does a
// 70-node shared-strip filter render?
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");
  const L = G.layer();
  const C = await G.contentGlass();
  spike.log("max-filter-ops-per-chain", Services.prefs.getIntPref("gfx.webrender.max-filter-ops-per-chain"));

  const shapes = [];
  let x = 0;
  for (let i = 0; i < 12; i++) {
    if (i === 3) {
      shapes.push({ x, w: 480 });
      x += 488;
    }
    shapes.push({ x, w: 44 });
    x += 52;
  }
  const width = x - 8;
  const few = shapes.slice(0, 5);
  const fewWidth = few[few.length - 1].x + few[few.length - 1].w;
  const full = G.rowLensMarkup("full", width, 44, shapes);
  const small = G.rowLensMarkup("small", fewWidth, 44, few);
  spike.log("row filter nodes: full", full.nodes, "small", small.nodes);
  // SVG mask alternative to clip-path (data: URL image mask).
  const maskSvg = (w, list) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44">${list.map((s) => `<rect x="${s.x}" y="0" width="${s.w}" height="44" rx="22" fill="#000"/>`).join("")}</svg>`)}")`;

  const rows = [
    ["clip-path + CSS blur(6px) invert(1)", `clip-path:${full.clip}; backdrop-filter:blur(6px) invert(1);`, width],
    ["clip-path + url(#small) (" + small.nodes + " nodes)", `clip-path:${small.clip}; backdrop-filter:url(#small);`, fewWidth],
    ["clip-path + url(#full) (" + full.nodes + " nodes)", `clip-path:${full.clip}; backdrop-filter:url(#full);`, width],
    ["NO clip + url(#full)", `backdrop-filter:url(#full);`, width],
    ["mask-image svg + url(#full)", `mask:${maskSvg(width, shapes)} no-repeat; backdrop-filter:url(#full);`, width],
    ["mask-image svg + CSS blur(6px) invert(1)", `mask:${maskSvg(width, shapes)} no-repeat; backdrop-filter:blur(6px) invert(1);`, width],
  ];
  let html = `<svg style="position:fixed;width:0;height:0"><defs>${full.markup}${small.markup}</defs></svg>`;
  rows.forEach(([label, css, w], i) => {
    const y = 20 + i * 64;
    html += `<div style="position:fixed; left:60px; top:${y}px; width:${w}px; height:44px; ${css}"></div>`;
    G.el("div", `position:absolute; left:60px; top:${y + 45}px; background:#000; color:#fff; padding:0 5px; font-size:11px;`, L, label);
  });
  spike.log("set ->", await C.set(html));
  await spike.sleep(900);
  await spike.capture("row-" + (Services.env.get("VITRE_TAG") || "default"));
});
