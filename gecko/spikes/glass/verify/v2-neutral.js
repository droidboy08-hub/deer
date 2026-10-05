// Verify / improve claim 1, part 2: which "surface root" trigger on an ancestor of the remote <browser>
// makes PARENT backdrop-filter sample the page, and which of them leaves the page pixels unchanged?
// Static page (no scroll, no animation) so captures can be compared pixel by pixel (see v2-compare.py).
//   VITRE_VAR = none | op999 | op995 | op99 | sat | bright | opf | svgid | svgcm | mask | clip | wc | anim |
//               persp | rot | bf | contain | bodysat | tabboxsat
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const v = Services.env.get("VITRE_VAR") || "none";
  G.hideFirefoxUI();
  await G.go(Services.env.get("VITRE_URL") || G.sibling("page.html") + "?noanim=1");
  const browser = gBrowser.selectedBrowser;
  const stack = browser.closest(".browserStack");
  const tabbox = document.getElementById("tabbrowser-tabbox");

  // Glass layer: inside the browser stack (so stack-level triggers enclose page + glass), except for
  // the body/tabbox variants where it is the usual fixed layer on <body> / in the tabbox.
  let L;
  if (v.startsWith("body")) L = G.layer();
  else if (v.startsWith("tabbox")) L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none;", tabbox);
  else L = G.el("div", "position:relative; z-index:10; pointer-events:none;", stack);

  const d = G.defs();
  const f1 = G.svgEl("filter", { id: "ident-off", x: 0, y: 0, width: "100%", height: "100%", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feOffset", { in: "SourceGraphic", dx: 0, dy: 0 }, f1);
  const f2 = G.svgEl("filter", { id: "ident-cm", x: 0, y: 0, width: "100%", height: "100%", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feColorMatrix", { type: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" }, f2);
  G.css(`@keyframes vitre-one { from { opacity: 1; } to { opacity: 1; } }`);

  const set = (el, css) => (el.style.cssText += ";" + css);
  const T = {
    none: () => {},
    op999: () => set(stack, "opacity:0.999"),
    op995: () => set(stack, "opacity:0.995"),
    op99: () => set(stack, "opacity:0.99"),
    sat: () => set(stack, "filter:saturate(1.0001)"),
    bright: () => set(stack, "filter:brightness(1.0001)"),
    opf: () => set(stack, "filter:opacity(0.9999)"),
    svgid: () => set(stack, "filter:url(#ident-off)"),
    svgcm: () => set(stack, "filter:url(#ident-cm)"),
    mask: () => set(stack, "mask:linear-gradient(#000,#000)"),
    clip: () => set(stack, "clip-path:inset(0)"),
    wc: () => set(stack, "will-change:opacity"),
    anim: () => set(stack, "animation:vitre-one 1000s linear infinite"),
    persp: () => set(stack, "transform:perspective(1000px) translateZ(0px)"),
    rot: () => set(stack, "transform:rotateX(0.0001deg)"),
    bf: () => set(stack, "backdrop-filter:brightness(1.0001)"),
    contain: () => set(stack, "contain:paint; isolation:isolate"),
    bodysat: () => set(document.body, "filter:saturate(1.0001)"),
    tabboxsat: () => set(tabbox, "filter:saturate(1.0001)"),
  };
  T[v]();
  spike.log("variant", v, "stack style:", stack.style.cssText);

  const tiles = [
    [40, 290, "invert(1)"],
    [300, 290, "blur(6px)"],
    [560, 290, "url(#t-offset)"],
  ];
  const fo = G.svgEl("filter", { id: "t-offset", "color-interpolation-filters": "sRGB" }, d);
  G.svgEl("feOffset", { in: "SourceGraphic", dx: 20, dy: 20 }, fo);
  for (const [x, y, bf] of tiles) {
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:220px; height:100px; border-radius:30px;`, L);
    t.style.backdropFilter = bf;
  }
  // VITRE_SCROLL: scroll the page first (to compare other content, e.g. the gradient band at 1090).
  const sy = Number(Services.env.get("VITRE_SCROLL") || 0);
  if (sy) browser.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`content.scrollTo(0, ${sy});`), false);
  await spike.sleep(1000);
  await spike.capture("neutral-" + v);
});
