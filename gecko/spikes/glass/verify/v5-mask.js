// Verify claim 12 ("clip-path and mask disable backdrop-filter; one element for the whole bar is not
// possible"). Firefox's own UI ships backdrop-filter + mask: linear-gradient (aiwindow/ai-chat-content.css),
// so test which clip / mask kinds survive on a backdrop-filter element.
//   VITRE_SIDE = content | parent     (parent uses the surface-root recipe from v4-parent.js)
/* global spike, G, gBrowser, Services, document, window, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const side = Services.env.get("VITRE_SIDE") || "content";
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");

  // A 3-shape "bar" 300x44: circle, pill, circle.
  const W = 300;
  const shapes = [{ x: 0, w: 44 }, { x: 52, w: 196 }, { x: 256, w: 44 }];
  // NOTE: single quotes. ../boot10-row.js put url("...") and path("...") inside style="..." attributes,
  // which ends the attribute early and drops the backdrop-filter declaration that follows.
  const svgMask = `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="44">${shapes.map((s) => `<rect x="${s.x}" y="0" width="${s.w}" height="44" rx="22" fill="#000"/>`).join("")}</svg>`)}')`;
  const path = shapes.map((s) => `M${s.x + 22},0 H${s.x + s.w - 22} A22,22 0 0 1 ${s.x + s.w - 22},44 H${s.x + 22} A22,22 0 0 1 ${s.x + 22},0 Z`).join(" ");
  // Union of pills from gradients only: per shape two radial caps + one linear middle.
  const layers = [];
  for (const s of shapes) {
    layers.push(`radial-gradient(circle 22px at 22px 22px, #000 21.5px, transparent 22px) ${s.x}px 0 / 44px 44px no-repeat`);
    if (s.w > 44) {
      layers.push(`radial-gradient(circle 22px at 22px 22px, #000 21.5px, transparent 22px) ${s.x + s.w - 44}px 0 / 44px 44px no-repeat`);
      layers.push(`linear-gradient(#000, #000) ${s.x + 22}px 0 / ${s.w - 44}px 44px no-repeat`);
    }
  }
  const BF = "backdrop-filter:blur(3px) invert(1);";
  const rows = [
    ["no clip (control)", ""],
    ["border-radius:22px", "border-radius:22px;"],
    ["mask: linear-gradient fade (as Firefox aiwindow)", "mask:linear-gradient(90deg, #000 30%, transparent 90%);"],
    ["mask: gradient layers = union of pills", `mask:${layers.join(", ")};`],
    ["mask: url(data: svg)", `mask:${svgMask} no-repeat;`],
    ["mask: url(#m) svg <mask>", "mask:url(#m);"],
    ["clip-path: inset(0 round 22px)", "clip-path:inset(0 round 22px);"],
    ["clip-path: circle(60px)", "clip-path:circle(60px at 150px 22px);"],
    ["clip-path: polygon()", "clip-path:polygon(0 0, 100% 0, 80% 100%, 0 100%);"],
    ["clip-path: path() union", `clip-path:path('${path}');`],
    ["clip-path: url(#c) svg <clipPath>", "clip-path:url(#c);"],
    ["overflow:hidden rounded PARENT", "WRAP"],
  ];
  const defs = `<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0"><defs>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="44">${shapes.map((s) => `<rect x="${s.x}" y="0" width="${s.w}" height="44" rx="22" fill="#fff"/>`).join("")}</mask>
    <clipPath id="c" clipPathUnits="userSpaceOnUse">${shapes.map((s) => `<rect x="${s.x}" y="0" width="${s.w}" height="44" rx="22"/>`).join("")}</clipPath>
  </defs></svg>`;
  const pos = side === "content" ? "fixed" : "absolute";
  let html = defs;
  const labels = [];
  rows.forEach(([label, css], i) => {
    const x = 60 + (i % 3) * 400;
    const y = 30 + Math.floor(i / 3) * 110;
    if (css === "WRAP") html += `<div style="position:${pos}; left:${x}px; top:${y}px; width:${W}px; height:44px; border-radius:22px; overflow:hidden;"><div style="position:absolute; inset:0; ${BF}"></div></div>`;
    else html += `<div style="position:${pos}; left:${x}px; top:${y}px; width:${W}px; height:44px; ${css} ${BF}"></div>`;
    labels.push([x, y + 46, label]);
  });

  let L;
  if (side === "content") {
    L = G.layer();
    const C = await G.contentGlass();
    spike.log("set ->", await C.set(html));
  } else {
    const tabbox = document.getElementById("tabbrowser-tabbox");
    tabbox.style.filter = "saturate(1.0001)";
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
    L.appendChild(document.importNode(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`, "application/xhtml+xml").documentElement, true));
  }
  for (const [x, y, label] of labels) G.el("div", `position:absolute; left:${x}px; top:${y}px; background:#000; color:#fff; padding:0 5px; font-size:11px;`, L, side + ": " + label);
  await spike.sleep(900);
  await spike.capture("mask-" + side);
});
