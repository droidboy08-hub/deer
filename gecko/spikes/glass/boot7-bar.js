// Spike glass / test 4: Vitre's tab bar (active pill, tab circles, plus, window-controls capsule) on
// Gecko, in the light / dark / clear themes, over busy and plain pages.
//
// Row A (top 12)  : the Gecko recipe. Lens = content-side backdrop-filter (strip lens / plain / none),
//                   tint + rim + shadow + faces = parent chrome layer (browser.xhtml).
// Row R (top 76)  : REFERENCE, the Electron look: true feImage+feDisplacementMap lens applied (as a
//                   normal filter) to a snapshot of exactly the pixels under row A, same tint/rim.
// Row P (top 140) : plain content-side backdrop-filter: blur() saturate() (no refraction), same tint/rim.
// Row N (top 204) : no lens at all (what the bar looks like if the content layer is missing).
//
//   VITRE_THEME = light | dark | clear     VITRE_LENS = strip | cells | plain
/* global spike, G, gBrowser, Services, document, window, DOMRect */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

const THEMES = {
  light: `--g-tint: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.22));
    --g-rim: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 30%, rgba(255,255,255,0.2) 60%, rgba(255,255,255,0.8));
    --g-shadow: 0 10px 28px rgba(40,30,15,0.14), 0 1px 2px rgba(40,30,15,0.18);
    --g-text: #16181d; --g-icon: rgba(22,24,29,0.78); --g-dim: rgba(22,24,29,0.28);`,
  dark: `--g-tint: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(16,16,20,0.3);
    --g-rim: linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35));
    --g-shadow: 0 10px 28px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.3);
    --g-text: #ffffff; --g-icon: rgba(255,255,255,0.85); --g-dim: rgba(255,255,255,0.3);`,
  clear: `--g-tint: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03));
    --g-rim: linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35));
    --g-shadow: 0 10px 28px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.22);
    --g-text: #ffffff; --g-icon: rgba(255,255,255,0.9); --g-dim: rgba(255,255,255,0.32);`,
};

const ICON = {
  back: "M10 3 L5 8 L10 13",
  forward: "M6 3 L11 8 L6 13",
  reload: "M12.5 8a4.5 4.5 0 1 1-1.4-3.2 M11.5 2.5v2.6h-2.6",
  plus: "M8 3v10 M3 8h10",
  min: "M3 8h10",
  max: "M3.5 3.5h9v9h-9z",
  close: "M3.5 3.5l9 9 M12.5 3.5l-9 9",
};

function icon(name, size = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name]}"/></svg>`;
}

spike.main(async () => {
  await spike.resize(1280, 800);
  const theme = Services.env.get("VITRE_THEME") || "light";
  const lensMode = Services.env.get("VITRE_LENS") || "strip";
  G.hideFirefoxUI();
  // VITRE_URL + VITRE_SHOTS ("name:scrollY,name:scrollY") run the same bar over any page.
  const customURL = Services.env.get("VITRE_URL");
  await G.go(customURL || G.sibling("page.html") + "?noanim=1");
  if (customURL) await spike.sleep(2500);
  const L = G.layer();
  const C = await G.contentGlass();
  const browser = gBrowser.selectedBrowser;

  G.css(`
    #vitre-layer { ${THEMES[theme]} color: var(--g-text); font: 500 13.5px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif; }
    .vg { position: absolute; border-radius: 22px; box-shadow: var(--g-shadow); }
    .vg > .lens, .vg > .tint, .vg > .rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; overflow: hidden; }
    .vg > .tint { background: var(--g-tint); }
    .vg > .rim { padding: 1px; background: var(--g-rim);
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
    .vg > .face { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
    .vg .nav { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .vg .address { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--g-text); }
    .vg .fav { width: 16px; height: 16px; border-radius: 4px; }
    .rowlabel { position: absolute; left: 8px; background: #000; color: #fff; font: 600 11px 'Segoe UI'; padding: 1px 5px; }
  `);

  // Bar geometry: 3 circles, the 480 px active pill, 3 circles, plus; window controls at the right.
  const items = [];
  let x = 190;
  const favs = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4"];
  for (let i = 0; i < 6; i++) {
    if (i === 3) {
      items.push({ x, y: 0, w: 480, h: 44, kind: "pill", opts: { blur: 2.4 } });
      x += 488;
    }
    items.push({ x, y: 0, w: 44, h: 44, kind: "circle", fav: favs[i], opts: {} });
    x += 52;
  }
  items.push({ x, y: 0, w: 44, h: 44, kind: "plus", opts: {} });
  items.push({ x: 1160, y: 6, w: 108, h: 32, kind: "winctl", opts: {} });

  const face = (it) => {
    if (it.kind === "pill")
      return `<div class="nav" style="margin-left:8px">${icon("back")}</div><div class="nav" style="margin-left:2px;color:var(--g-dim)">${icon("forward")}</div>` +
        `<div class="address"><span class="fav" style="background:#f58231"></span><span>en.wikipedia.org</span></div><div class="nav" style="margin-right:8px">${icon("reload")}</div>`;
    if (it.kind === "circle") return `<span class="fav" style="background:${it.fav}"></span>`;
    if (it.kind === "plus") return icon("plus", 18);
    return `<div style="display:flex; gap:14px;">${icon("min", 14)}${icon("max", 14)}${icon("close", 14)}</div>`;
  };

  const rows = { A: 12, R: 76, P: 140, N: 204 };
  const els = { R: [] };
  for (const [row, top] of Object.entries(rows)) {
    for (const it of items) {
      const g = G.el("div", `left:${it.x}px; top:${top + it.y}px; width:${it.w}px; height:${it.h}px; border-radius:${it.h / 2}px;`, L);
      g.className = "vg";
      const lens = G.el("div", "", g);
      lens.className = "lens";
      G.el("div", "", g).className = "tint";
      G.el("div", "", g).className = "rim";
      const f = G.el("div", "", g);
      f.className = "face";
      // Parsed as XHTML fragments in the chrome document.
      f.appendChild(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%">${face(it)}</div>`, "application/xhtml+xml").documentElement);
      if (row === "R") els.R.push([it, lens]);
    }
    const lab = G.el("div", `top:${top + 14}px;`, L, { A: "A  Gecko: " + lensMode + " lens (content backdrop-filter)", R: "R  reference: true displacement lens", P: "P  Gecko: plain blur+saturate", N: "N  no lens" }[row]);
    lab.className = "rowlabel";
  }

  // Content-side lens markup for rows A and P.
  const made = new Map();
  let defs = "";
  let divs = "";
  let total = 0;
  for (const it of items) {
    const key = it.w + "x" + it.h;
    if (!made.has(key)) {
      const id = "l" + made.size;
      const f = lensMode === "cells" ? G.offsetLensMarkup(id, it.w, it.h, { ...it.opts, cell: 3 }) : G.stripLensMarkup(id, it.w, it.h, it.opts);
      defs += f.markup;
      made.set(key, [id, f.nodes]);
    }
    total += made.get(key)[1];
    const r = it.h / 2;
    const a = lensMode === "plain" ? `blur(${it.opts.blur ?? 1.4}px) saturate(1.5)` : `url(#${made.get(key)[0]})`;
    divs += `<div style="position:fixed; left:${it.x}px; top:${rows.A + it.y}px; width:${it.w}px; height:${it.h}px; border-radius:${r}px; backdrop-filter:${a};"></div>`;
    divs += `<div style="position:fixed; left:${it.x}px; top:${rows.P + it.y}px; width:${it.w}px; height:${it.h}px; border-radius:${r}px; backdrop-filter:blur(${it.opts.blur ?? 1.4}px) saturate(1.5);"></div>`;
  }
  const lensHTML = `<svg style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}`;
  spike.log("theme", theme, "lens", lensMode, "filter nodes per shape", [...made.entries()].map(([k, v]) => k + ":" + v[1]).join(" "), "total", total);

  // Reference lenses (true displacement), one filter per size.
  const trueLens = new Map();
  for (const it of items) {
    const key = it.w + "x" + it.h;
    if (!trueLens.has(key)) trueLens.set(key, G.lensFilter(it.w, it.h, it.opts));
  }

  const wg = () => browser.browsingContext.currentWindowGlobal;
  async function shot(name, query, scrollY) {
    await C.set("");
    if (query !== null) {
      await G.go(G.sibling("page.html") + query);
    }
    const sy = await C.scroll(scrollY);
    spike.log("shot", name, "scrollY", sy, "url", browser.currentURI.spec.slice(-30));
    await spike.sleep(300);
    for (const [it, lens] of els.R) {
      lens.textContent = "";
      const bmp = await wg().drawSnapshot(new DOMRect(it.x, sy + rows.A + it.y, it.w, it.h), 1, "white");
      const c = G.el("canvas", `position:absolute; left:0; top:0; width:${it.w}px; height:${it.h}px; filter:url(#${trueLens.get(it.w + "x" + it.h)});`, lens);
      c.width = it.w;
      c.height = it.h;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
    }
    await C.set(lensHTML);
    await spike.sleep(700);
    await spike.capture(`bar-${theme}-${lensMode}-${name}`);
  }

  if (customURL) {
    for (const spec of (Services.env.get("VITRE_SHOTS") || "top:0").split(",")) {
      const [name, y] = spec.split(":");
      await shot(name, null, Number(y));
    }
    return;
  }
  await shot("stripes", null, 0);
  await shot("text", null, 262);
  await shot("lines", null, 440);
  await shot("grid", null, 610);
  await shot("gradient", null, 1090);
  await shot("white", "?noanim=1&bg=white", 0);
  await shot("darkpage", "?noanim=1&bg=dark", 0);
});
