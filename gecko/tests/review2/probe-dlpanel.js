// Probe: the Downloads panel at several window sizes (CSS px): text that overlaps other text, and
// controls cut off by the panel's edge. Settings is measured the same way for comparison.
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { log, sleep, waitFor, capture, check } = spike;
  const b = window.vitre;
  await spike.resize(1280, 800);
  await spike.activate();
  const engine = b.sys("VitreDownloads");
  const t = await W.load(window, b.active(), W.P("dlp"));
  b.service("downloads").download(W.url("file?size=200000000&rate=100000&name=a-long-file-name-for-the-panel.bin"), { browser: t.browser });
  await waitFor(() => engine.list(false).some((v) => v.received > 0), { timeout: 15000 }).catch(() => null);
  b.service("downloads").download(W.url("file?size=500000&rate=2000000&name=done.zip"), { browser: t.browser });
  await sleep(2500);
  const leaves = (root) => [...root.querySelectorAll("*")].filter((el) => {
    if (el.children.length && [...el.children].some((c) => c.textContent.trim())) return false;
    if (!el.textContent.trim() && !/button|input/.test(el.localName)) return false;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  });
  const measure = (panel) => {
    const pr = panel.getBoundingClientRect();
    const els = leaves(panel);
    const overlaps = [];
    for (let i = 0; i < els.length; i++) {
      const a = els[i].getBoundingClientRect();
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const c = els[j].getBoundingClientRect();
        const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (w > 3 && h > 3) overlaps.push(`"${els[i].textContent.trim().slice(0, 18)}" x "${els[j].textContent.trim().slice(0, 18)}"`);
      }
    }
    // Cut off: a control or text that runs past the panel's edge (or its scroll box clips it sideways).
    const cut = els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1;
    }).map((el) => `"${el.textContent.trim().slice(0, 18) || el.localName}"`);
    return { panel: [Math.round(pr.width), Math.round(pr.height)], overlaps: overlaps.slice(0, 8), nOverlaps: overlaps.length, cut: cut.slice(0, 8), nCut: cut.length };
  };
  const sizes = [[1280, 800], [1280, 672], [1100, 700], [960, 640], [800, 600], [640, 480], [480, 360]];
  const out = {};
  for (const [w, h] of sizes) {
    await spike.resize(w, h);
    await sleep(500);
    W.key(window, "j", { ctrlKey: true });
    await waitFor(() => b.service("downloads").isPanelOpen(), { timeout: 4000 }).catch(() => null);
    await sleep(700);
    const panel = document.querySelector("#layer-downloads-panel .vd-panel") || [...document.querySelectorAll("#layer-downloads-panel > *")].pop();
    const d = measure(panel);
    await capture(`dlpanel-${w}x${h}`);
    W.key(window, "KEY_Escape");
    await sleep(500);
    W.key(window, ",", { ctrlKey: true });
    await waitFor(() => b.service("settings").isOpen(), { timeout: 4000 }).catch(() => null);
    await sleep(700);
    const sheet = document.querySelector("#layer-settings .vs-sheet") || [...document.querySelectorAll("#layer-settings > *")].pop();
    const s = sheet ? measure(sheet) : null;
    W.key(window, "KEY_Escape");
    await sleep(500);
    out[`${w}x${h}`] = { inner: [window.innerWidth, window.innerHeight], downloads: d, settings: s };
    log(`size ${w}x${h}`, out[`${w}x${h}`]);
  }
  for (const [k, v] of Object.entries(out)) check(`Downloads panel at ${k}: no overlapping or cut-off text`, v.downloads.nOverlaps === 0 && v.downloads.nCut === 0, v.downloads);
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(300);
});
