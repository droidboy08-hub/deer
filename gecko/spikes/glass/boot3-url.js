// Spike glass / test 2: does backdrop-filter: url(#svg) work at all in Gecko 157 (independent of the
// remote-browser problem)? Tiles sit over CHROME-DRAWN busy content, where backdrop-filter is known
// to work for CSS filter functions (see boot2-diag).
/* global spike, G, Services, document, window, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const tag = Services.env.get("VITRE_TAG") || "default";
  G.hideFirefoxUI();
  const L = G.layer();
  for (const p of ["gfx.webrender.svg-filter-effects", "gfx.webrender.svg-filter-effects.fedisplacementmap", "gfx.webrender.svg-filter-effects.feimage", "gfx.webrender.svg-filter-effects.also-convert-css-filters"]) {
    spike.log("pref", p, Services.prefs.getBoolPref(p, null));
  }

  // Busy chrome-drawn backdrop.
  G.el("div", "position:absolute; inset:0; background:repeating-linear-gradient(90deg,#e6194b 0 40px,#f58231 40px 80px,#ffe119 80px 120px,#3cb44b 120px 160px,#42d4f4 160px 200px,#4363d8 200px 240px,#911eb4 240px 280px,#fff 280px 320px,#000 320px 360px);", L);
  G.el("div", "position:absolute; left:0; right:0; top:400px; bottom:0; background:linear-gradient(#0a58ca 2px, transparent 2px) 0 0 / 100% 24px, linear-gradient(90deg, #d63384 2px, transparent 2px) 0 0 / 24px 100%, #fffbe6;", L);
  G.el("div", "position:absolute; left:20px; top:8px; background:#fff; color:#000; padding:2px 10px; font-size:20px;", L, "CHROME-DRAWN BACKDROP  The quick brown fox jumps over the lazy dog 0123456789 " + tag);
  G.el("div", "position:absolute; left:20px; top:408px; background:#fff; color:#000; padding:2px 10px; font-size:20px;", L, "GRID  The quick brown fox jumps over the lazy dog 0123456789");

  const d = G.defs();
  const fb = G.svgEl("filter", { id: "t-blur", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 6 }, fb);
  const fh = G.svgEl("filter", { id: "t-hue", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feColorMatrix", { type: "hueRotate", values: 180 }, fh);
  const ft = G.svgEl("filter", { id: "t-turb", x: 0, y: 0, width: 1, height: 1, "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: 0.03, numOctaves: 2, result: "n" }, ft);
  G.svgEl("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 40, xChannelSelector: "R", yChannelSelector: "G" }, ft);
  const fo = G.svgEl("filter", { id: "t-offset", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feOffset", { in: "SourceGraphic", dx: 20, dy: 20 }, fo);
  const lensId = G.lensFilter(220, 120, { radius: 30, bezel: 26, scale: 40, blur: 0.6 });

  const tiles = [
    ["control (none)", ""],
    ["blur(6px)", "blur(6px)"],
    ["url(#t-blur) feGaussianBlur", "url(#t-blur)"],
    ["url(#t-hue) feColorMatrix", "url(#t-hue)"],
    ["url(#t-offset) feOffset", "url(#t-offset)"],
    ["url(#t-turb) feDisplacementMap", "url(#t-turb)"],
    ["url(#lens) Electron graph", `url(#${lensId})`],
    ["blur(2px) url(#lens)", `blur(2px) url(#${lensId})`],
    ["FILTER (not backdrop) url(#lens) on a painted element", "FILTER"],
    ["hue-rotate(180deg)", "hue-rotate(180deg)"],
  ];
  tiles.forEach(([label, bf], i) => {
    const x = 30 + (i % 5) * 245;
    const row = Math.floor(i / 5);
    for (const y of [50 + row * 170, 450 + row * 170]) {
      const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:220px; height:120px; border-radius:30px; outline:2px solid #000;`, L);
      if (bf === "FILTER") {
        // Reference: what the lens looks like when applied as a normal filter to an element that paints the same stripes.
        t.style.background = y < 400 ? "repeating-linear-gradient(90deg,#e6194b 0 40px,#ffe119 40px 80px,#4363d8 80px 120px,#fff 120px 160px,#000 160px 200px)" : "linear-gradient(#0a58ca 2px, transparent 2px) 0 0 / 100% 24px, linear-gradient(90deg, #d63384 2px, transparent 2px) 0 0 / 24px 100%, #fffbe6";
        t.style.filter = `url(#${lensId})`;
      } else if (bf) t.style.backdropFilter = bf;
      G.el("div", "position:absolute; left:0; top:124px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap; font-size:11px;", t, label);
      if (y < 400) spike.log("tile", i, label, "computed backdrop:", getComputedStyle(t).backdropFilter, "filter:", getComputedStyle(t).filter);
    }
  });
  await spike.sleep(800);
  await spike.capture("url-" + tag);
});
