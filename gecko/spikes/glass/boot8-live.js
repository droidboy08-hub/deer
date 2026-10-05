// Spike glass / test 1b: is the content-side backdrop LIVE? The page auto-scrolls (3 px per frame),
// a CSS animation slides a box under the glass, and a real <video> (WebM recorded in-page) plays under it.
// Three captures 350 ms apart must each show the current page through the glass.
// Also checks: page zoom (CSS `zoom` compensation), and whether drawSnapshot() of the page includes the lens layer.
/* global spike, G, gBrowser, Services, document, window, DOMRect */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?scroll=3&video=1");
  const L = G.layer();
  const C = await G.contentGlass();
  const browser = gBrowser.selectedBrowser;

  const strip = G.stripLensMarkup("pill", 460, 44, { blur: 2.4 });
  const shapes = [
    [430, 30, 460, 44, 22, "backdrop-filter:url(#pill); background:rgba(255,255,255,0.18)", "strip lens pill over <video>"],
    [430, 90, 200, 70, 20, "backdrop-filter:blur(10px) saturate(1.6)", "blur(10) over <video>"],
    [650, 90, 240, 70, 20, "backdrop-filter:invert(1)", "invert over <video>"],
    [40, 140, 300, 80, 24, "backdrop-filter:blur(6px) saturate(1.6); background:rgba(255,255,255,0.18)", "blur over CSS animation path"],
    [960, 140, 280, 80, 24, "backdrop-filter:invert(1)", "invert over CSS animation path"],
    [40, 300, 1200, 44, 22, "backdrop-filter:url(#wide); background:rgba(255,255,255,0.18)", "strip lens over scrolling page"],
  ];
  const wide = G.stripLensMarkup("wide", 1200, 44, { blur: 2.4 });
  const html = (zoom) =>
    `<svg style="position:fixed;width:0;height:0"><defs>${strip.markup}${wide.markup}</defs></svg>` +
    `<div style="zoom:${1 / zoom}">` +
    shapes.map(([x, y, w, h, r, css]) => `<div style="position:fixed; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${r}px; ${css}"></div>`).join("") +
    `</div>`;
  for (const [x, y, w, h, r, , label] of shapes) {
    const o = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${r}px; outline:1px solid rgba(0,0,0,0.9);`, L);
    G.el("div", "position:absolute; left:10px; top:-15px; background:#000; color:#fff; padding:0 5px; white-space:nowrap; font-size:11px;", o, label);
  }
  spike.log("set ->", await C.set(html(1)));
  // Wait for the in-page recording (2 s) and playback to start.
  for (let i = 0; i < 60 && browser.contentTitle !== "video-playing"; i++) await spike.sleep(100);
  spike.log("page title:", browser.contentTitle);
  await spike.sleep(500);
  for (let i = 0; i < 3; i++) {
    await spike.capture("live-" + i);
    await spike.sleep(350);
  }

  // drawSnapshot of the page: does it contain the lens layer? (matters for captureVisibleTab, thumbnails)
  const bmp = await browser.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 0.5, "white");
  const c = G.el("canvas", "position:absolute; right:10px; bottom:10px; width:640px; height:400px; outline:3px solid #f0f; background:#fff;", L);
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  G.el("div", "position:absolute; right:10px; bottom:414px; background:#f0f; color:#000; padding:1px 6px;", L, "drawSnapshot() of the page, half size: is the lens layer in it?");
  await spike.capture("live-snapshot");
  c.remove();

  // Page zoom 150 %: content CSS px grow, so the layer root is counter-zoomed with CSS `zoom`.
  browser.fullZoom = 1.5;
  await spike.sleep(300);
  spike.log("fullZoom", browser.fullZoom, "set ->", await C.set(html(1.5)));
  await spike.sleep(600);
  await spike.capture("live-zoom150");
});
