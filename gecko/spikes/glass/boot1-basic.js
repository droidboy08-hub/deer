// Spike glass / test 1+2: does backdrop-filter on an HTML element in browser.xhtml sample the live
// remote page underneath? CSS functions and url(#svg) variants side by side.
/* global spike, G, gBrowser, Services, document, window, CSS, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html"));
  const L = G.layer();

  spike.log("dpr", window.devicePixelRatio, "url", gBrowser.currentURI.spec);
  spike.log("CSS.supports backdrop-filter blur", CSS.supports("backdrop-filter", "blur(4px)"));
  spike.log("CSS.supports backdrop-filter url", CSS.supports("backdrop-filter", "url(#x)"));
  for (const p of [
    "layout.css.backdrop-filter.enabled",
    "layout.css.backdrop-filter.force-enabled",
    "gfx.webrender.svg-filter-effects",
    "gfx.webrender.svg-filter-effects.fedisplacementmap",
    "gfx.webrender.svg-filter-effects.feimage",
    "gfx.webrender.svg-filter-effects.also-convert-css-filters",
    "gfx.webrender.max-filter-ops-per-chain",
  ]) {
    let v = "(unset)";
    try {
      const t = Services.prefs.getPrefType(p);
      v = t === 128 ? Services.prefs.getBoolPref(p) : t === 64 ? Services.prefs.getIntPref(p) : t === 32 ? Services.prefs.getStringPref(p) : "(no such pref)";
    } catch (e) {
      v = "ERR " + e;
    }
    spike.log("pref", p, "=", v);
  }

  // Simple SVG filters to separate "url() works at all" from "feDisplacementMap works".
  const d = G.defs();
  const fb = G.svgEl("filter", { id: "t-blur", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 6 }, fb);
  const fh = G.svgEl("filter", { id: "t-hue", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feColorMatrix", { type: "hueRotate", values: 180 }, fh);
  const ft = G.svgEl("filter", { id: "t-turb", x: 0, y: 0, width: 1, height: 1, "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: 0.03, numOctaves: 2, result: "n" }, ft);
  G.svgEl("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 40, xChannelSelector: "R", yChannelSelector: "G" }, ft);
  const lensId = G.lensFilter(220, 120, { radius: 30, bezel: 26, scale: 40, blur: 0.6 });

  const tiles = [
    ["control (none)", ""],
    ["blur(14px)", "blur(14px)"],
    ["saturate(3) brightness(1.3)", "saturate(3) brightness(1.3)"],
    ["invert(1)", "invert(1)"],
    ["blur(8) saturate(1.6)", "blur(8px) saturate(1.6)"],
    ["url(#t-blur)", "url(#t-blur)"],
    ["url(#t-hue)", "url(#t-hue)"],
    ["url(#t-turb) feDisplacementMap", "url(#t-turb)"],
    ["url(#lens) Electron graph", `url(#${lensId})`],
    ["blur(2px) url(#lens)", `blur(2px) url(#${lensId})`],
  ];
  tiles.forEach(([label, bf], i) => {
    const x = 30 + (i % 5) * 245;
    const y = 40 + Math.floor(i / 5) * 190;
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:220px; height:120px; border-radius:30px; outline:2px solid #000; box-shadow:0 0 0 4px #fff;`, L);
    if (bf) t.style.backdropFilter = bf;
    const cs = getComputedStyle(t).backdropFilter;
    G.el("div", "position:absolute; left:0; top:126px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap;", t, label);
    spike.log("tile", i, label, "computed:", cs);
  });
  await spike.sleep(800);
  await spike.capture("basic-" + (Services.env.get("VITRE_TAG") || "default"));
});
