// Robustness review 2: idle cost with every feature installed.
//   python tests/review2/run.py idle            (Vitre, every module)
//   python tests/review2/run.py idle --stock    (the same states on Firefox's own interface: baseline)
// In each state, after a settle: CPU time of every process over 15 s (ChromeUtils.requestProcInfo),
// chrome paints over 10 s (MozAfterPaint on the window), and the chrome document's running animations
// (document.getAnimations()). Nothing visible changes in these states, so the chrome should neither
// paint nor animate, and the parent should stay near Firefox's own idle cost.
// States: a page; Home; a page after every feature was used and closed (a warm peek, parked find
// closed); a finished download in the list; auto-hide on with the pointer away; 40 tabs; two windows.
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const b = window.vitre;
  const stock = W.stock || !b;
  W.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const gB = window.gBrowser;
  const navigate = async (url) => {
    gB.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await waitFor(() => gB.selectedBrowser.currentURI.spec === url && !gB.selectedBrowser.webProgress.isLoadingDocument, { timeout: 15000 }).catch(() => null);
  };
  const addTab = (url) => gB.addTrustedTab(url, { inBackground: true });

  const results = {};
  async function measure(name, settle = 4000) {
    // The pointer rests in the middle of the page, away from the bar.
    W.mouse(window, 640, 500, { type: "mousemove" });
    await sleep(settle);
    const anims = document.getAnimations().filter((a) => a.playState === "running").map((a) => {
      const t = a.effect?.target;
      return `${a.animationName || a.transitionProperty || a.constructor.name} on ${t?.id || (typeof t?.className === "string" ? t.className : "") || t?.localName}`;
    });
    let paints = 0;
    const onPaint = () => paints++;
    window.addEventListener("MozAfterPaint", onPaint);
    const p0 = await W.procs();
    const t0 = performance.now();
    await sleep(15000);
    const p1 = await W.procs();
    const secs = (performance.now() - t0) / 1000;
    window.removeEventListener("MozAfterPaint", onPaint);
    const pct = (a, b2) => Math.round(((b2 - a) / secs / 10) * 100) / 100; // % of one core
    const parent = pct(p0.parent.cpu, p1.parent.cpu);
    const kids = p1.children.map((c) => {
      const before = p0.children.find((x) => x.pid === c.pid);
      return { type: c.type, origin: c.origin.slice(0, 40), pct: before ? pct(before.cpu, c.cpu) : null };
    }).filter((c) => c.pct !== null && c.pct > 0.05);
    const threads = p1.parent.threads.map((t) => {
      const before = p0.parent.threads.find((x) => x.name === t.name);
      return { name: t.name, pct: before ? pct(before.cpu, t.cpu) : 0 };
    }).filter((t) => t.pct > 0.1).sort((x, y) => y.pct - x.pct).slice(0, 6);
    results[name] = { parent, children: kids, threads, paintsPerSec: Math.round((paints / secs) * 10) / 10, anims, mem: p1.parent.mem };
    log(`IDLE ${stock ? "[stock] " : ""}${name}`, results[name]);
  }

  await navigate(W.P("idle-page"));
  // Firefox's own start-up work (cache, URL classifier, quota manager) runs for the first minute.
  await sleep(50000);
  await measure("a page");
  if (!stock) {
    b.newTab();
    await sleep(2500);
    await measure("Home");
    b.closeTab(b.active());
    await sleep(800);
    // Every feature once, then all closed.
    b.focusPage();
    await W.openPeek(window, W.P("idle-peek"));
    await W.openFind(window, "glass");
    await W.unwind(window);
    await W.pageMenu(window);
    await W.unwind(window);
    await W.openDownloads(window);
    await W.unwind(window);
    await W.openSettings(window);
    await W.unwind(window);
    await W.openSwitcher(window).catch(() => null);
    await W.unwind(window);
    b.focusPage();
    await W.openFind(window, "glass");
    await W.unwind(window);
    await measure("after every feature (warm peek kept)");
    // A finished download in the list.
    b.service("downloads").download(W.url("file?size=400000&rate=2000000&name=idle.bin"));
    const engine = b.sys("VitreDownloads");
    await waitFor(() => engine.list(false).some((v) => v.state === "completed"), { timeout: 20000 }).catch(() => null);
    await sleep(3000);
    await measure("a finished download");
    b.sys("VitreSettings").set({ barAutoHide: true });
    await sleep(1500);
    await measure("auto-hide, pointer away");
    b.sys("VitreSettings").set({ barAutoHide: false });
    await sleep(800);
  }
  for (let i = 0; i < 39; i++) addTab(W.P("idle-" + i));
  await waitFor(() => [...gB.tabs].every((t) => !t.linkedBrowser.webProgress?.isLoadingDocument), { timeout: 60000 }).catch(() => null);
  await sleep(1500);
  await measure("40 tabs");
  const w2 = await spike.openWindow();
  await sleep(2000);
  w2.gBrowser.selectedBrowser.fixupAndLoadURIString(W.P("idle-w2"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await sleep(2500);
  await spike.activate();
  await measure("two windows");
  log("IDLE-SUMMARY " + (stock ? "stock" : "vitre"), Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { parent: v.parent, paints: v.paintsPerSec, anims: v.anims.length }])));
  if (!stock) {
    for (const [k, v] of Object.entries(results)) {
      check(`idle ${k}: no chrome animation keeps running`, v.anims.length === 0, v.anims);
      check(`idle ${k}: the chrome does not keep painting (< 1 paint/s)`, v.paintsPerSec < 1, v.paintsPerSec);
      check(`idle ${k}: parent process under 2 % of a core`, v.parent < 2, v);
    }
    check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
  }
});
