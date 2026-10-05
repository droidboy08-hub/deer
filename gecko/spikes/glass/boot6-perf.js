// Spike glass / cost: a realistic tab bar (1 active pill, N circles, window-controls capsule) as a
// content-side lens layer over an auto-scrolling page. Measures content rAF intervals and per-process
// CPU time (ChromeUtils.requestProcInfo) over a fixed window, for several lens recipes.
//   VITRE_MODE = none | css | strip | stripnd | pillonly | row | cells4 | cells3
/* global spike, G, gBrowser, Services, document, window, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

async function cpu() {
  const info = await ChromeUtils.requestProcInfo();
  const out = { parent: info.cpuTime / 1e6 };
  for (const c of info.children) out[c.type + ":" + c.pid] = c.cpuTime / 1e6;
  return out;
}

spike.main(async () => {
  await spike.resize(1280, 800);
  const mode = Services.env.get("VITRE_MODE") || "none";
  const circles = Number(Services.env.get("VITRE_CIRCLES") || 12);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?scroll=3&noanim=1");
  const C = await G.contentGlass();

  // Bar geometry (design: 44 px items at top 12, 8 px gaps).
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

  let defs = "";
  let divs = "";
  const made = new Map();
  let nodes = 0;
  if (mode === "row") {
    // ONE element + ONE filter for all 44 px shapes; the 32 px capsule keeps its own.
    const row = items.filter((it) => it[3] === 44);
    const left = row[0][0];
    const right = row[row.length - 1][0] + row[row.length - 1][2];
    const f = G.rowLensMarkup("row", right - left, 44, row.map((it) => ({ x: it[0] - left, w: it[2] })));
    defs += f.markup;
    nodes += f.nodes;
    divs += `<div style="position:fixed; left:${left}px; top:12px; width:${right - left}px; height:44px; clip-path:${f.clip}; backdrop-filter:url(#row);"></div>`;
    const w = items[items.length - 1];
    const fw = G.stripLensMarkup("wc", w[2], w[3], { diag: false });
    defs += fw.markup;
    nodes += fw.nodes;
    divs += `<div style="position:fixed; left:${w[0]}px; top:${w[1]}px; width:${w[2]}px; height:${w[3]}px; border-radius:16px; backdrop-filter:url(#wc);"></div>`;
  } else
  items.forEach(([ix, iy, w, h, opts], i) => {
    const r = Math.min(w, h) / 2;
    let bf = "";
    const plain = `blur(${opts.blur ?? 1.4}px) saturate(1.5)`;
    if (mode === "css") bf = plain;
    else if (mode === "pillonly" && w === 44) bf = plain;
    else if (mode.startsWith("cells") || mode.startsWith("strip") || mode === "pillonly") {
      const cell = Number(mode.slice(5)) || 4;
      const key = w + "x" + h;
      if (!made.has(key)) {
        const f = mode.startsWith("cells") ? G.offsetLensMarkup("ol" + made.size, w, h, { ...opts, cell, step: cell >= 4 ? 2 : 1 }) : G.stripLensMarkup("ol" + made.size, w, h, { ...opts, diag: mode === "strip" ? undefined : false });
        defs += f.markup;
        made.set(key, ["ol" + made.size, f.nodes]);
      }
      nodes += made.get(key)[1];
      bf = `url(#${made.get(key)[0]})`;
    }
    if (bf) divs += `<div style="position:fixed; left:${ix}px; top:${iy}px; width:${w}px; height:${h}px; border-radius:${r}px; backdrop-filter:${bf};"></div>`;
  });
  spike.log("mode", mode, "items", items.length, "total feOffset nodes", nodes, "filters", [...made.entries()].map(([k, v]) => k + ":" + v[1]).join(" "));
  if (divs) spike.log("set ->", await C.set(`<svg style="position:fixed;width:0;height:0"><defs>${defs}</defs></svg>${divs}`));

  await spike.sleep(1500);
  const c0 = await cpu();
  const t0 = performance.now();
  const stats = await C.frames(360, "frames");
  const dt = performance.now() - t0;
  const c1 = await cpu();
  const pct = {};
  for (const k of Object.keys(c1)) if (k in c0) pct[k] = +(((c1[k] - c0[k]) / dt) * 100).toFixed(1);
  spike.log("RESULT", mode, "wall ms", dt.toFixed(0), "content rAF", stats);
  spike.log("CPU% of one core during the window", pct);
  await spike.capture("perf-" + mode);
});
