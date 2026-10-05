// Verify / improve claim 1: can a PARENT chrome element with backdrop-filter sample the remote page
// if the remote <browser> and the glass element share a non-root backdrop root / surface?
//   VITRE_VAR = base | bodyop | rootop | stack | stackop | tabboxop | bodyfilter | blend | bodyiso |
//               bodyclip | bodymask | browserop | transform | stackfilter | stackblend | stackiso
/* global spike, G, gBrowser, Services, document, window, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const v = Services.env.get("VITRE_VAR") || "base";
  G.hideFirefoxUI();
  await G.go(Services.env.get("VITRE_URL") || G.sibling("page.html") + "?scroll=2&noanim=1");
  const browser = gBrowser.selectedBrowser;
  const stack = browser.closest(".browserStack");
  const tabbox = document.getElementById("tabbrowser-tabbox");
  spike.log("variant", v, "stack", !!stack, "remote", browser.isRemoteBrowser, "lm", window.windowUtils.layerManagerType);

  // Where the glass layer lives.
  let L;
  if (v.startsWith("stack")) {
    L = G.el("div", "position:relative; z-index:10; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", stack);
    L.id = "vitre-layer";
  } else if (v.startsWith("tabbox")) {
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
    L.id = "vitre-layer";
  } else L = G.layer();

  const set = (el, css) => (el.style.cssText += ";" + css);
  switch (v) {
    case "bodyop": set(document.body, "opacity:0.9"); break;
    case "rootop": set(document.documentElement, "opacity:0.9"); break;
    case "stackop": set(stack, "opacity:0.9"); break;
    case "tabboxop": set(tabbox, "opacity:0.9"); break;
    case "bodyfilter": set(document.body, "filter:hue-rotate(90deg)"); break;
    case "stackfilter": set(stack, "filter:hue-rotate(90deg)"); break;
    case "blend": G.el("div", "position:absolute; left:0; top:0; width:4px; height:4px; background:#fff; mix-blend-mode:multiply;", L); break;
    case "stackblend": G.el("div", "position:absolute; left:0; top:0; width:4px; height:4px; background:#fff; mix-blend-mode:multiply;", L); set(stack, "isolation:isolate"); break;
    case "bodyiso": set(document.body, "isolation:isolate; will-change:opacity"); break;
    case "stackiso": set(stack, "isolation:isolate; will-change:opacity"); break;
    case "bodyclip": set(document.body, "clip-path:inset(0 round 1px)"); break;
    case "bodymask": set(document.body, "mask:linear-gradient(#000,#000)"); break;
    case "browserop": set(browser, "opacity:0.9"); break;
    case "transform": set(document.body, "transform:perspective(1000px) translateZ(0); transform-style:preserve-3d"); break;
  }

  const d = G.defs();
  const fo = G.svgEl("filter", { id: "t-offset", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feOffset", { in: "SourceGraphic", dx: 20, dy: 20 }, fo);
  const lensId = G.lensFilter(220, 120, { radius: 30, bezel: 26, scale: 40, blur: 0.6 });
  const tiles = [
    ["blur(10px)", "blur(10px)"],
    ["invert(1)", "invert(1)"],
    ["url(#t-offset)", "url(#t-offset)"],
    ["url(#lens) displacement", `url(#${lensId})`],
    ["blur(8) sat + tint", "blur(8px) saturate(1.6)"],
  ];
  tiles.forEach(([label, bf], i) => {
    const x = 30 + i * 245;
    const t = G.el("div", `position:absolute; left:${x}px; top:60px; width:220px; height:120px; border-radius:30px; outline:2px solid #000;`, L);
    t.style.backdropFilter = bf;
    if (i === 4) t.style.background = "rgba(255,255,255,0.25)";
    G.el("div", "position:absolute; left:0; top:126px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap;", t, "PARENT " + v + ": " + label);
  });
  await spike.sleep(900);
  await spike.capture("root-" + v + "-0");
  await spike.sleep(400);
  await spike.capture("root-" + v + "-1");
});
