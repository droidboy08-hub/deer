// Verify claims 3/4/5 for robustness: does the CONTENT-side lens (anonymous content, position:fixed,
// backdrop-filter) still sample the page when the page scrolls in a NESTED scroll container (app-shell
// layouts, the PDF viewer) instead of the root scroll frame? WebRender slices picture caches by scroll
// root, so a nested scroller can end up in a different slice than the lens.
//   VITRE_SIDE = content | parent     (parent = surface-root recipe, for comparison)
/* global spike, G, gBrowser, Services, document, window, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const side = Services.env.get("VITRE_SIDE") || "content";
  G.hideFirefoxUI();
  const browser = gBrowser.selectedBrowser;
  const strip = G.stripLensMarkup("pill", 480, 44, { blur: 2.4, diag: false });
  const pos = side === "parent" ? "absolute" : "fixed";
  const html = `<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0"><defs>${strip.markup}</defs></svg>` +
    `<div style="position:${pos}; left:120px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1);"></div>` +
    `<div style="position:${pos}; left:680px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:url(#pill);"></div>`;
  let L;
  let C = null;
  if (side === "parent") {
    const tabbox = document.getElementById("tabbrowser-tabbox");
    tabbox.style.filter = "saturate(1.0001)";
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
    L.appendChild(document.importNode(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`, "application/xhtml+xml").documentElement, true));
  } else L = G.layer();
  for (const x of [120, 680]) G.el("div", `position:absolute; left:${x}px; top:60px; width:480px; height:44px; border-radius:22px; outline:1px solid #f0f;`, L);
  const lab = G.el("div", "position:absolute; left:120px; top:108px; background:#000; color:#fff; padding:1px 6px;", L, "");

  const cases = [
    ["root", G.sibling("page.html") + "?noanim=1"],
    ["abs", G.sibling("scroller.html") + "?kind=abs"],
    ["abs-scrolling", G.sibling("scroller.html") + "?kind=abs&scroll=2"],
    ["fixed", G.sibling("scroller.html") + "?kind=fixed"],
    ["wc", G.sibling("scroller.html") + "?kind=wc"],
    ["contain", G.sibling("scroller.html") + "?kind=contain"],
    ["iframe", G.sibling("scroller.html") + "?kind=iframe"],
  ];
  for (const [name, url] of cases) {
    await G.go(url);
    await spike.sleep(500);
    let set = "(parent layer)";
    if (side === "content") {
      if (!C) C = await G.contentGlass();
      set = await C.set(html);
    }
    lab.textContent = `${side}: ${name}`;
    spike.log(side, name, "set ->", set);
    await spike.sleep(700);
    await spike.capture(`scroller-${side}-${name}`);
  }
});
