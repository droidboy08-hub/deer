// What an open menu costs while nothing happens: parent-process CPU time and chrome repaints
// (MozAfterPaint) with the menu closed and open, alternated three times so background noise
// shows up on both sides; once over a static page and once over a blinking caret in a field (the
// frost re-samples the page whenever it repaints under the menu). No animation may keep running in
// a menu that has landed.
//   python tests/menus-verify/all.py idle
/* global spike, Services, ChromeUtils, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  const tab = await M.load(V.page("plain.html"));
  await sleep(10000); // a fresh profile's start-up work settles
  let paints = 0;
  window.addEventListener("MozAfterPaint", () => paints++);
  const measure = async (ms) => {
    const p0 = paints;
    const a = await ChromeUtils.requestProcInfo();
    await sleep(ms);
    const z = await ChromeUtils.requestProcInfo();
    // The busiest threads of the parent process and the other processes (GPU, content) over the span.
    const before = new Map((a.threads || []).map((t) => [t.tid, t.cpuTime]));
    const top = (z.threads || [])
      .map((t) => [t.name, Math.round((t.cpuTime - (before.get(t.tid) ?? t.cpuTime)) / 1e6)])
      .filter((t) => t[1] > 5)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5);
    const kids = new Map((a.children || []).map((c) => [c.pid, c.cpuTime]));
    const children = (z.children || [])
      .map((c) => [c.type, Math.round((c.cpuTime - (kids.get(c.pid) ?? c.cpuTime)) / 1e6)])
      .filter((c) => c[1] > 5);
    // What the menu itself can cost: the parent's main thread (script, layout, painting) and the GPU
    // process (compositing the frost). The rest of a fresh profile's background work (URL
    // classifier, IndexedDB, caches) is noise here and is only logged.
    const main = (z.threads || []).find((t) => t.name === "MainThread");
    const main0 = (a.threads || []).find((t) => t.name === "MainThread");
    const gpu = (z.children || []).find((c) => c.type === "gpu");
    const gpu0 = (a.children || []).find((c) => c.type === "gpu" && gpu && c.pid === gpu.pid);
    const cost = ((main && main0 ? main.cpuTime - main0.cpuTime : 0) + (gpu && gpu0 ? gpu.cpuTime - gpu0.cpuTime : 0)) / 1e6;
    return { cpu: cost, all: Math.round((z.cpuTime - a.cpuTime) / 1e6), paints: paints - p0, top, children };
  };
  const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const open = async (x, y) => {
    M.rightClick(x, y);
    await M.waitOpen();
    await sleep(500);
  };
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(500);
  };

  const run = async (label, x, y) => {
    const shut = [];
    const shown = [];
    for (let i = 0; i < 3; i++) {
      shut.push(await measure(2000));
      await open(x, y);
      const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.(".vt-menus"));
      check(label + ": no animation running in a landed menu", anims.length === 0, anims.length);
      shown.push(await measure(2000));
      await close();
    }
    const r = {
      cpuClosed: median(shut.map((m) => m.cpu)),
      allClosed: median(shut.map((m) => m.all)),
      allOpen: median(shown.map((m) => m.all)),
      cpuOpen: median(shown.map((m) => m.cpu)),
      paintsClosed: median(shut.map((m) => m.paints)),
      paintsOpen: median(shown.map((m) => m.paints)),
    };
    log(label, JSON.stringify({ ...r, closed: shut, open: shown }));
    return r;
  };

  const p = await M.rectOf("#p2");
  const still = await run("static page", p.x + 12, p.y + 8);
  check("static page: an open menu adds under 3 % of a core on the main thread + GPU process (median of 3 x 2 s)", still.cpuOpen - still.cpuClosed < 60, still);
  check("static page: an open menu does not keep the window repainting", still.paintsOpen <= still.paintsClosed + 4, still);

  // A focused field with a blinking caret under the menu (the right-click lands in the field).
  await M.inContent(tab.browser, (content) => {
    const d = content.document;
    const ta = d.createElement("textarea");
    ta.id = "blink";
    ta.style.cssText = "position:absolute;left:300px;top:420px;width:420px;height:90px;font:17px Segoe UI";
    ta.value = "A caret blinks here";
    d.body.append(ta);
    ta.focus();
    ta.setSelectionRange(5, 5);
  });
  await M.activate();
  await sleep(800);
  const f = await M.rectOf("#blink");
  const blink = await run("blinking caret", f.x + 20, f.y + 20);
  check("blinking caret: an open menu adds under 3 % of a core", blink.cpuOpen - blink.cpuClosed < 60, blink);
  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
  void b;
});
