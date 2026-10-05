// Spike glass: the cases where the PARENT chrome layer can (or cannot) hold the lens itself.
//  1. A parent-process page (about:preferences, non-remote <browser>): does parent backdrop-filter sample it?
//  2. -moz-element(#remote-browser) painted into a parent element: does it show the remote page?
//  3. drawSnapshot() loop for a bar-sized strip: cost per snapshot (the only way to get remote pixels
//     into the parent for a true feDisplacementMap lens).
/* global spike, G, gBrowser, Services, document, window, DOMRect */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const L = G.layer();
  const browser = gBrowser.selectedBrowser;

  // Parent-side lens tiles (same on every page).
  const d = G.defs();
  const strip = G.stripLensMarkup("p-strip", 480, 44, { blur: 2.4 });
  // Markup -> nodes in the chrome document.
  const frag = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${strip.markup}</svg>`, "image/svg+xml");
  d.appendChild(document.importNode(frag.documentElement.firstChild, true));
  const trueLens = G.lensFilter(480, 44, { blur: 2.4 });
  const tiles = [
    [40, 20, 480, 44, 22, "url(#p-strip)", "parent: strip lens url()"],
    [540, 20, 300, 44, 22, "blur(8px) saturate(1.6)", "parent: blur(8) saturate"],
    [860, 20, 300, 44, 22, "invert(1)", "parent: invert"],
  ];
  for (const [x, y, w, h, r, bf, label] of tiles) {
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${r}px; outline:1px solid #000; backdrop-filter:${bf};`, L);
    G.el("div", "position:absolute; left:10px; top:46px; background:#000; color:#fff; padding:0 5px; white-space:nowrap; font-size:11px;", t, label);
  }

  // 1. Parent-process page.
  await G.go("about:preferences");
  await spike.sleep(1500);
  spike.log("about:preferences isRemoteBrowser =", browser.isRemoteBrowser, "remoteType =", browser.remoteType);
  await spike.capture("inproc-preferences");

  await G.go("about:support");
  await spike.sleep(1500);
  spike.log("about:support isRemoteBrowser =", browser.isRemoteBrowser, "remoteType =", browser.remoteType);

  // 2. Remote page + -moz-element.
  await G.go(G.sibling("page.html") + "?scroll=2&noanim=1");
  spike.log("page.html isRemoteBrowser =", browser.isRemoteBrowser, "remoteType =", browser.remoteType);
  if (!browser.id) browser.id = "vitre-test-browser";
  const me = G.el("div", `position:absolute; left:40px; top:120px; width:480px; height:120px; outline:2px solid #f0f; background: -moz-element(#${browser.id}) no-repeat 0 0; background-color:#888;`, L);
  G.el("div", "position:absolute; left:0; top:-16px; background:#f0f; color:#000; padding:0 5px; white-space:nowrap; font-size:11px;", me, "-moz-element(#remote browser): grey = nothing painted");
  await spike.sleep(600);
  await spike.capture("inproc-remote-mozelement");

  // 3. drawSnapshot loop: bar-sized strip, drawn into a canvas with the TRUE lens filter.
  const c = G.el("canvas", `position:absolute; left:40px; top:300px; width:480px; height:44px; border-radius:22px; filter:url(#${trueLens});`, L);
  c.width = 480;
  c.height = 44;
  const ctx = c.getContext("2d");
  const lab = G.el("div", "position:absolute; left:40px; top:284px; background:#000; color:#fff; padding:0 5px; white-space:nowrap; font-size:11px;", L, "drawSnapshot loop -> canvas -> filter:url(true lens)");
  for (const [name, rect] of [["pill 480x44", [40, 300, 480, 44]], ["bar strip 1280x56", [0, 0, 1280, 56]]]) {
    const times = [];
    const t0 = performance.now();
    let n = 0;
    while (performance.now() - t0 < 3000) {
      const wg = browser.browsingContext.currentWindowGlobal;
      const a = performance.now();
      // rect is in document coordinates; the page scrolls, so ask the page where it is first is not
      // possible synchronously: use resetScrollPosition:false and a viewport-relative guess of 0.
      const bmp = await wg.drawSnapshot(new DOMRect(rect[0], rect[1] + n * 2, rect[2], rect[3]), 1, "white");
      times.push(performance.now() - a);
      if (rect[2] === 480) ctx.drawImage(bmp, 0, 0);
      bmp.close();
      n++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    times.sort((x, y) => x - y);
    const mean = times.reduce((x, y) => x + y, 0) / times.length;
    spike.log("drawSnapshot", name, "calls", n, "in 3 s (", (n / 3).toFixed(0), "per s ) ms: mean", mean.toFixed(2), "median", times[times.length >> 1].toFixed(2), "p95", times[Math.floor(times.length * 0.95)].toFixed(2), "max", times[times.length - 1].toFixed(2));
  }
  lab.textContent += " (last frame shown)";
  await spike.capture("inproc-snapshot-loop");
});
