// Verify finding: the WHOLE glass (lens + tint + rim + faces) in the PARENT chrome layer, sampling the
// remote page, by making the tab box a WebRender surface ("surface root": filter: saturate(1.0001)).
// Same bar and rows as ../boot7-bar.js, but row A and row P use parent backdrop-filter:
//   A  parent: strip lens (url(#feOffset strips) -> blur -> saturate), tint + rim + face in the same element
//   R  reference: true feImage + feDisplacementMap lens on a snapshot of the pixels under row A
//   P  parent: plain blur() saturate()
//   N  no lens
// plus a 420 px "omnibox panel" with the frost recipe blur(24px) saturate(1.6).
// Robustness steps: real site, navigation without dropout, tab switch, in-process page, video, second window.
//   VITRE_THEME = light | dark | clear      VITRE_STEPS = comma list (default: all)
/* global spike, G, gBrowser, Services, document, window, DOMRect, DOMParser, OpenBrowserWindow */
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
const ICON = { back: "M10 3 L5 8 L10 13", forward: "M6 3 L11 8 L6 13", reload: "M12.5 8a4.5 4.5 0 1 1-1.4-3.2 M11.5 2.5v2.6h-2.6", plus: "M8 3v10 M3 8h10", min: "M3 8h10", max: "M3.5 3.5h9v9h-9z", close: "M3.5 3.5l9 9 M12.5 3.5l-9 9" };
const icon = (name, size = 16) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name]}"/></svg>`;
const xhtml = (markup) => document.importNode(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml" style="display:contents">${markup}</div>`, "application/xhtml+xml").documentElement, true);

const theme = Services.env.get("VITRE_THEME") || "light";
const rows = { A: 12, R: 76, P: 140, N: 204 };

/** Build the bar in this window. Returns { items, refLens } */
function buildBar() {
  G.hideFirefoxUI();
  const tabbox = document.getElementById("tabbrowser-tabbox");
  // THE RECIPE: one surface root that contains every <browser> and the glass layer.
  tabbox.style.filter = "saturate(1.0001)";
  const L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none;", tabbox);
  L.id = "vitre-layer";
  G.css(`
    #vitre-layer { ${THEMES[theme]} color: var(--g-text); font: 500 13.5px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif; }
    .vg { position: absolute; border-radius: 22px; box-shadow: var(--g-shadow); }
    .vg > .lens, .vg > .tint, .vg > .rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
    .vg > .tint { background: var(--g-tint); }
    .vg > .rim { padding: 1px; background: var(--g-rim);
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
    .vg > .face { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
    .vg .nav { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .vg .address { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--g-text); }
    .vg .fav { width: 16px; height: 16px; border-radius: 4px; }
    .rowlabel { position: absolute; left: 8px; background: #000; color: #fff; font: 600 11px 'Segoe UI'; padding: 1px 5px; }
  `);
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
  // Strip-lens filters (one per size) and true-lens reference filters, in the chrome document.
  const strip = new Map();
  const trueLens = new Map();
  let defs = "";
  for (const it of items) {
    const key = it.w + "x" + it.h;
    if (strip.has(key)) continue;
    const f = G.stripLensMarkup("vs" + strip.size, it.w, it.h, { ...it.opts, diag: false });
    defs += f.markup;
    strip.set(key, "vs" + strip.size);
    trueLens.set(key, G.lensFilter(it.w, it.h, it.opts));
  }
  for (const f of [...xhtml(`<svg xmlns="http://www.w3.org/2000/svg">${defs}</svg>`).firstChild.children]) G.defs().appendChild(f);
  const refLens = [];
  for (const [row, top] of Object.entries(rows)) {
    for (const it of items) {
      const g = G.el("div", `left:${it.x}px; top:${top + it.y}px; width:${it.w}px; height:${it.h}px; border-radius:${it.h / 2}px;`, L);
      g.className = "vg";
      const lens = G.el("div", "", g);
      lens.className = "lens";
      if (row === "A") lens.style.backdropFilter = `url(#${strip.get(it.w + "x" + it.h)})`;
      if (row === "P") lens.style.backdropFilter = `blur(${it.opts.blur ?? 1.4}px) saturate(1.5)`;
      if (row === "R") {
        lens.style.overflow = "hidden";
        refLens.push([it, lens]);
      }
      G.el("div", "", g).className = "tint";
      G.el("div", "", g).className = "rim";
      const f = G.el("div", "", g);
      f.className = "face";
      f.appendChild(xhtml(`<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%">${face(it)}</div>`));
    }
    const lab = G.el("div", `top:${top + 14}px;`, L, { A: "A  PARENT strip lens (surface root)", R: "R  reference: true displacement lens", P: "P  PARENT plain blur+saturate", N: "N  no lens" }[row]);
    lab.className = "rowlabel";
  }
  // Omnibox-panel frost.
  const p = G.el("div", "left:430px; top:270px; width:420px; height:150px; border-radius:22px;", L);
  p.className = "vg";
  const pl = G.el("div", "backdrop-filter:blur(24px) saturate(1.6);", p);
  pl.className = "lens";
  G.el("div", "", p).className = "tint";
  G.el("div", "", p).className = "rim";
  G.el("div", "padding:14px 18px; justify-content:flex-start; align-items:flex-start; color:var(--g-text);", p, "omnibox panel: parent backdrop-filter blur(24px) saturate(1.6)").className = "face";
  return { items, refLens, trueLens, L };
}

const first = !Services.prefs.getBoolPref("vitre.verify.second", false);
if (!first) {
  // Second window: build the bar and stay (the first window drives the captures).
  buildBar();
} else
  spike.main(async () => {
    await spike.resize(1280, 800);
    const steps = (Services.env.get("VITRE_STEPS") || "local,wiki,nav,tabs,inproc,video,window").split(",");
    const bar = buildBar();
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const wg = () => gBrowser.selectedBrowser.browsingContext.currentWindowGlobal;
    const scrollTo = (y) => gBrowser.selectedBrowser.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`content.scrollTo(0, ${y});`), false);
    async function ref(scrollY) {
      // Reference row: hide the layer is not needed, drawSnapshot only sees the page.
      for (const [it, lens] of bar.refLens) {
        lens.textContent = "";
        const bmp = await wg().drawSnapshot(new DOMRect(it.x, scrollY + rows.A + it.y, it.w, it.h), 1, "white");
        const c = G.el("canvas", `position:absolute; left:0; top:0; width:${it.w}px; height:${it.h}px; filter:url(#${bar.trueLens.get(it.w + "x" + it.h)});`, lens);
        c.width = it.w;
        c.height = it.h;
        c.getContext("2d").drawImage(bmp, 0, 0);
        bmp.close();
      }
    }
    async function shot(name, scrollY = 0) {
      scrollTo(scrollY);
      await spike.sleep(500);
      await ref(scrollY);
      await spike.sleep(400);
      await spike.capture(`parent-${theme}-${name}`);
    }
    const page = G.sibling("page.html");

    if (steps.includes("local")) {
      await G.go(page + "?noanim=1");
      spike.log("local page remote:", gBrowser.selectedBrowser.isRemoteBrowser, gBrowser.selectedBrowser.remoteType);
      await shot("stripes", 0);
      await shot("text", 262);
      await shot("lines", 440);
      await shot("grid", 610);
      await shot("gradient", 1090);
      await G.go(page + "?noanim=1&bg=white");
      await shot("white", 0);
      await G.go(page + "?noanim=1&bg=dark");
      await shot("darkpage", 0);
    }
    if (steps.includes("wiki")) {
      await G.go("https://en.wikipedia.org/wiki/Stained_glass");
      await spike.sleep(2500);
      spike.log("wiki remoteType:", gBrowser.selectedBrowser.remoteType, "uri", gBrowser.currentURI.spec);
      await shot("wiki-top", 0);
      await shot("wiki-image", 900);
    }
    if (steps.includes("nav")) {
      // Navigation: capture WHILE the next document is loading (no lens dropout expected: nothing
      // lives in the content document).
      await G.go(page + "?noanim=1");
      gBrowser.selectedBrowser.fixupAndLoadURIString(page + "?noanim=1&bg=dark&x=2", { triggeringPrincipal: sys });
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        spike.log("nav frame", i, "loading", gBrowser.selectedBrowser.webProgress.isLoadingDocument, gBrowser.currentURI.spec.slice(-22));
      }
      await spike.capture(`parent-${theme}-nav-during`);
      await spike.sleep(800);
      await spike.capture(`parent-${theme}-nav-after`);
    }
    if (steps.includes("tabs")) {
      await G.go(page + "?noanim=1");
      const t1 = gBrowser.selectedTab;
      const t2 = gBrowser.addTab(page + "?noanim=1&bg=dark&tab=2", { triggeringPrincipal: sys });
      await spike.sleep(1500);
      gBrowser.selectedTab = t2;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await spike.capture(`parent-${theme}-tab2-immediately`);
      await spike.sleep(600);
      await shot("tab2", 0);
      gBrowser.selectedTab = t1;
      await spike.sleep(600);
      await shot("tab1-again", 0);
      gBrowser.removeTab(t2);
    }
    if (steps.includes("inproc")) {
      await G.go("about:preferences");
      await spike.sleep(1500);
      spike.log("about:preferences isRemoteBrowser =", gBrowser.selectedBrowser.isRemoteBrowser);
      await spike.capture(`parent-${theme}-preferences`);
    }
    if (steps.includes("video")) {
      await G.go(page + "?scroll=3&video=1");
      for (let i = 0; i < 60 && gBrowser.selectedBrowser.contentTitle !== "video-playing"; i++) await spike.sleep(100);
      spike.log("page title:", gBrowser.selectedBrowser.contentTitle);
      await spike.sleep(500);
      for (let i = 0; i < 3; i++) {
        await spike.capture(`parent-${theme}-live-${i}`);
        await spike.sleep(350);
      }
    }
    if (steps.includes("window")) {
      Services.prefs.setBoolPref("vitre.verify.second", true);
      const w2 = OpenBrowserWindow();
      await new Promise((r) => Services.obs.addObserver(function o(s) { if (s === w2) { Services.obs.removeObserver(o, "browser-delayed-startup-finished"); r(); } }, "browser-delayed-startup-finished"));
      await spike.sleep(500);
      w2.resizeTo(1400, 900);
      w2.moveTo(10, 10);
      w2.gBrowser.selectedBrowser.fixupAndLoadURIString(page + "?noanim=1&win=2", { triggeringPrincipal: sys });
      await spike.sleep(2500);
      spike.log("second window url", w2.gBrowser.currentURI.spec.slice(-30), "has layer", !!w2.document.getElementById("vitre-layer"));
      await spike.capture(`parent-${theme}-window2`);
      w2.close();
    }
  });
