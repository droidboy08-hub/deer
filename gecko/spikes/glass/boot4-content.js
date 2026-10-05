// Spike glass / test 1 (the working route): the lens layer lives INSIDE the content document as
// native anonymous content, where backdrop-filter is in the same WebRender pipeline as the page.
// The parent chrome layer draws only the labels/outlines on top (to check alignment across processes).
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const tag = Services.env.get("VITRE_TAG") || "default";
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + (Services.env.get("VITRE_QUERY") || ""));
  const L = G.layer();
  const C = await G.contentGlass();

  const tiles = [
    ["control (none)", ""],
    ["blur(14px)", "backdrop-filter:blur(14px)"],
    ["invert(1)", "backdrop-filter:invert(1)"],
    ["blur(8) saturate(1.6) + tint", "backdrop-filter:blur(8px) saturate(1.6); background:rgba(255,255,255,0.25)"],
    ["saturate(3) brightness(1.3)", "backdrop-filter:saturate(3) brightness(1.3)"],
    ["url(#t-blur)", "backdrop-filter:url(#t-blur)"],
    ["url(#t-offset) feOffset 20,20", "backdrop-filter:url(#t-offset)"],
    ["url(#lens) displacement", "backdrop-filter:url(#lens)"],
    ["url(data: svg #f) blur", `backdrop-filter:url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><filter id="f"><feGaussianBlur stdDeviation="6"/></filter></svg>')}#f")`],
    ["blur(2px) url(#t-offset)", "backdrop-filter:blur(2px) url(#t-offset)"],
  ];
  let html = `<style>
    .t { position: fixed; width: 220px; height: 120px; border-radius: 30px; box-sizing: border-box; pointer-events: none; }
  </style>
  <svg style="position:fixed;width:0;height:0"><defs>
    <filter id="t-blur" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="6"/></filter>
    <filter id="t-offset" color-interpolation-filters="sRGB"><feOffset in="SourceGraphic" dx="20" dy="20"/></filter>
    ${G.lensFilterMarkup("lens", 220, 120, { radius: 30, bezel: 26, scale: 40, blur: 0.6 })}
  </defs></svg>`;
  tiles.forEach(([label, css], i) => {
    const x = 30 + (i % 5) * 245;
    const y = 40 + Math.floor(i / 5) * 190;
    html += `<div class="t" id="t${i}" style="left:${x}px; top:${y}px; ${css}"></div>`;
    // Parent-side outline + label, drawn by the chrome layer at the same coordinates.
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:220px; height:120px; border-radius:30px; outline:2px solid #000;`, L);
    G.el("div", "position:absolute; left:0; top:126px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap;", t, "content: " + label);
  });
  spike.log("set ->", await C.set(html));
  await spike.sleep(800);
  await spike.capture("content-" + tag);

  // Live check: scroll the page and capture again; the same tiles must show the new backdrop.
  spike.log("scroll ->", await C.scroll(700));
  await spike.sleep(500);
  await spike.capture("content-" + tag + "-scrolled");
});
