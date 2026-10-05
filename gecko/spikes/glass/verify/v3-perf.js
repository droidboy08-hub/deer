// Verify claim 14 and cost the new parent-side recipe: same 14-shape bar as ../boot6-perf.js over an
// auto-scrolling page, lens either in the CONTENT document (spike recipe) or in the PARENT chrome
// layer with a "surface root" on the browser stack (verify finding).
//   VITRE_MODE = none | rootonly | pcss | pstrip | prow | ccss | cstrip | cpill | crow
//   VITRE_URL  = page to load (default page.html?scroll=3&noanim=1); VITRE_AUTOSCROLL=px per frame for other pages
/* global spike, G, gBrowser, Services, document, window, ChromeUtils, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

async function cpu() {
  const info = await ChromeUtils.requestProcInfo();
  const out = { parent: info.cpuTime / 1e6 };
  for (const c of info.children) out[c.type] = (out[c.type] || 0) + c.cpuTime / 1e6;
  return out;
}

spike.main(async () => {
  await spike.resize(1280, 800);
  const mode = Services.env.get("VITRE_MODE") || "none";
  const circles = 12;
  G.hideFirefoxUI();
  const url = Services.env.get("VITRE_URL");
  await G.go(url || G.sibling("page.html") + "?scroll=3&noanim=1");
  if (url) await spike.sleep(2500);
  const browser = gBrowser.selectedBrowser;
  const stack = browser.closest(".browserStack");
  const C = await G.contentGlass();
  const auto = Number(Services.env.get("VITRE_AUTOSCROLL") || 0);
  if (auto) {
    const code = `(() => { const step = () => { content.scrollBy(0, ${auto}); if (content.scrollY + content.innerHeight >= content.document.documentElement.scrollHeight - 4) content.scrollTo(0, 0); content.requestAnimationFrame(step); }; content.requestAnimationFrame(step); })();`;
    browser.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(code), false);
  }

  const items = [];
  let x = 150;
  for (let i = 0; i < circles; i++) {
    if (i === 3) {
      items.push([x, 12, 480, 44, { blur: 2.4 }]);
      x += 488;
    }
    items.push([x, 12, 44, 44, {}]);
    x += 52;
  }
  items.push([1160, 18, 108, 32, {}]);

  const parentSide = mode.startsWith("p") || mode === "rootonly";
  const strip = mode.endsWith("strip") || mode.endsWith("row");
  let defs = "";
  let divs = "";
  const made = new Map();
  let nodes = 0;
  items.forEach(([ix, iy, w, h, opts]) => {
    const r = Math.min(w, h) / 2;
    let bf = `blur(${opts.blur ?? 1.4}px) saturate(1.5)`;
    if (strip || (mode === "cpill" && w !== 44)) {
      const key = w + "x" + h;
      if (!made.has(key)) {
        const f = G.stripLensMarkup("ol" + made.size, w, h, { ...opts, diag: false });
        defs += f.markup;
        made.set(key, ["ol" + made.size, f.nodes]);
      }
      nodes += made.get(key)[1];
      bf = `url(#${made.get(key)[0]})`;
    }
    divs += `<div style="position:${parentSide ? "absolute" : "fixed"}; left:${ix}px; top:${iy}px; width:${w}px; height:${h}px; border-radius:${r}px; backdrop-filter:${bf};"></div>`;
  });
  if (mode.endsWith("row")) {
    // ONE backdrop element for all 44 px shapes (union via clip-path: path()), ONE shared-strip filter;
    // the 32 px capsule keeps its own element. (../boot10-row.js concluded this was impossible, but
    // that was a quoting bug: path("...") inside style="...".)
    const row = items.filter((it) => it[3] === 44);
    const left = row[0][0];
    const right = row[row.length - 1][0] + row[row.length - 1][2];
    const f = G.rowLensMarkup("row", right - left, 44, row.map((it) => ({ x: it[0] - left, w: it[2] })));
    const w = items[items.length - 1];
    const fw = G.stripLensMarkup("wc", w[2], w[3], { diag: false });
    defs = f.markup + fw.markup;
    nodes = f.nodes + fw.nodes;
    const pos = parentSide ? "absolute" : "fixed";
    divs = `<div style="position:${pos}; left:${left}px; top:12px; width:${right - left}px; height:44px; clip-path:${f.clip.replace(/"/g, "'")}; backdrop-filter:url(#row);"></div>` +
      `<div style="position:${pos}; left:${w[0]}px; top:${w[1]}px; width:${w[2]}px; height:${w[3]}px; border-radius:16px; backdrop-filter:url(#wc);"></div>`;
  }
  spike.log("mode", mode, "items", items.length, "feOffset nodes", nodes);

  if (parentSide) {
    stack.style.filter = "saturate(1.0001)"; // surface root: page + glass share one WebRender surface
    if (mode !== "rootonly") {
      const L = G.el("div", "position:relative; z-index:10; pointer-events:none;", stack);
      const frag = new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml"><svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}</div>`, "application/xhtml+xml");
      L.appendChild(document.importNode(frag.documentElement, true));
    }
  } else if (mode !== "none") {
    spike.log("set ->", await C.set(`<svg style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}`));
  }

  await spike.sleep(2000);
  const runs = [];
  for (let k = 0; k < 3; k++) {
    const c0 = await cpu();
    const t0 = performance.now();
    // VITRE_IDLE=1: nothing animates (static page); just wait, to measure the idle cost of the glass.
    const stats = Services.env.get("VITRE_IDLE") ? await spike.sleep(3000) : await C.frames(360, "frames" + k);
    const dt = performance.now() - t0;
    const c1 = await cpu();
    const pct = {};
    for (const key of ["parent", "gpu", "file", "web", "webIsolated"]) if (key in c1 && key in c0) pct[key] = +(((c1[key] - c0[key]) / dt) * 100).toFixed(1);
    runs.push(pct.gpu);
    spike.log("RESULT", mode, "wall ms", dt.toFixed(0), "content rAF", stats, "CPU% of one core", pct);
  }
  spike.log("SUMMARY", mode, "gpu-process CPU% runs", runs.join(" / "));
  await spike.capture("perf-" + mode);
});
