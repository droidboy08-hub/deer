// Verify / improve claim 12 + 14: ONE backdrop-filter element for the whole tab bar (union shape via
// clip-path: path('...')) with ONE shared-strip filter, compared with one element + filter per shape
// and with the true displacement lens. Backdrops are vertically periodic (40 px checker, 20 px lines)
// so the rows 80 px apart sit on identical pixels.
//   row A (top 20)  : per-shape strip lens (12 feOffset nodes each)
//   row B (top 100) : single element, G.rowLensMarkup, clip-path union
//   row R (top 300) : reference, true feDisplacementMap lens on a snapshot of the pixels under row A
//   VITRE_SIDE = content | parent
/* global spike, G, gBrowser, Services, document, window, DOMRect, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const side = Services.env.get("VITRE_SIDE") || "content";
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");
  const browser = gBrowser.selectedBrowser;
  spike.log("side", side, "max-filter-ops-per-chain", Services.prefs.getIntPref("gfx.webrender.max-filter-ops-per-chain"));

  const shapes = [];
  let x = 0;
  // VITRE_TABS: number of 44 px circles (default 12). With many tabs the shared filter passes
  // gfx.webrender.max-filter-ops-per-chain (64 by default) and silently stops rendering.
  const tabs = Number(Services.env.get("VITRE_TABS") || 12);
  const pillW = tabs > 12 ? 240 : 480;
  for (let i = 0; i < tabs; i++) {
    if (i === 3) {
      shapes.push({ x, w: pillW });
      x += pillW + 8;
    }
    shapes.push({ x, w: 44 });
    x += 52;
  }
  const width = x - 8;
  const left = tabs > 12 ? 20 : 170;
  const row = G.rowLensMarkup("row", width, 44, shapes, { blur: 1.8 });
  const pill = G.stripLensMarkup("pill", pillW, 44, { blur: 1.8, diag: false });
  const circle = G.stripLensMarkup("circle", 44, 44, { blur: 1.8, diag: false });
  spike.log("nodes: row filter", row.nodes, "(1 element) | per-shape", shapes.length * 12, "(" + shapes.length + " elements)");
  const pos = side === "content" ? "fixed" : "absolute";
  let html = `<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0"><defs>${row.markup}${pill.markup}${circle.markup}</defs></svg>`;
  for (const s of shapes) html += `<div style="position:${pos}; left:${left + s.x}px; top:20px; width:${s.w}px; height:44px; border-radius:22px; backdrop-filter:url(#${s.w === pillW ? "pill" : "circle"});"></div>`;
  html += `<div style="position:${pos}; left:${left}px; top:100px; width:${width}px; height:44px; clip-path:${row.clip.replace(/"/g, "'")}; backdrop-filter:url(#row);"></div>`;

  let L;
  let setLens;
  if (side === "content") {
    L = G.layer();
    const C = await G.contentGlass();
    setLens = (h) => C.set(h);
  } else {
    const tabbox = document.getElementById("tabbrowser-tabbox");
    tabbox.style.filter = "saturate(1.0001)";
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
    const host = G.el("div", "", L);
    setLens = async (h) => {
      host.textContent = "";
      if (h) host.appendChild(document.importNode(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${h}</div>`, "application/xhtml+xml").documentElement, true));
      return true;
    };
  }
  const lab = (y, t) => G.el("div", `position:absolute; left:8px; top:${y}px; background:#000; color:#fff; padding:0 5px; font:600 11px 'Segoe UI';`, L, t);
  lab(34, "A per-shape strip");
  lab(114, "B ONE element + row filter");
  lab(314, "R true lens (ref)");
  const trueP = G.lensFilter(pillW, 44, { blur: 1.8 });
  const trueC = G.lensFilter(44, 44, { blur: 1.8 });
  const refs = shapes.map((s) => [s, G.el("div", `position:absolute; left:${left + s.x}px; top:300px; width:${s.w}px; height:44px; border-radius:22px; overflow:hidden;`, L)]);

  const scrollToSel = (sel, dy) =>
    new Promise((res) => {
      const mm = browser.messageManager;
      const on = (m) => {
        mm.removeMessageListener("VitreVerify:Y", on);
        res(m.data);
      };
      mm.addMessageListener("VitreVerify:Y", on);
      mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`content.scrollTo(0, content.document.querySelector(${JSON.stringify(sel)}).offsetTop + ${dy}); sendAsyncMessage("VitreVerify:Y", content.scrollY);`), false);
    });
  for (const [name, sel, dy] of [["checker", ".b3", 0], ["lines", ".b2", 0], ["text", ".text", 6], ["stripes", ".band", 60]]) {
    await setLens("");
    const sy = await scrollToSel(sel, dy);
    await spike.sleep(400);
    for (const [s, host] of refs) {
      host.textContent = "";
      const bmp = await browser.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(left + s.x, sy + 20, s.w, 44), 1, "white");
      const c = G.el("canvas", `position:absolute; left:0; top:0; width:${s.w}px; height:44px; filter:url(#${s.w === pillW ? trueP : trueC});`, host);
      c.width = s.w;
      c.height = 44;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
    }
    spike.log("shot", name, "scrollY", sy, "set ->", await setLens(html));
    await spike.sleep(700);
    await spike.capture(`row-${side}-${name}`);
  }
});
