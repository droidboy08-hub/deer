// 150% scaling (layout.css.devPixelsPerPx = 1.5 set while running) and page zoom.
//   - every surface keeps its CSS size and place: the ring 44 at right 72 / bottom 20, the quick view
//     360 wide above it, the panel 960x688 centred (scaled to fit), the pill 12 px inside the video's
//     corner, the picker 8 px under the pill with right edges aligned;
//   - going back to 100% with the panel open lays it out again;
//   - page zoom 150% (at 100%): the pill still sits in the zoomed video's corner.
/* global spike, Services, gBrowser, DL, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  await DL.init();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.5");
  await sleep(1000);
  await spike.resize(1440, 900);
  await spike.activate();
  await sleep(600);
  log("devicePixelRatio", devicePixelRatio, "inner", innerWidth, innerHeight);
  check("the window runs at 150%", devicePixelRatio === 1.5, devicePixelRatio);
  const pill = b.root.querySelector(".vd-pill");
  const zoomOf = () => b.active()?.zoom || 1;
  const corner = async () => {
    // 12 px inside the visible part of the video (the page's viewport without its scrollbar).
    const q = await b.page(b.active()).query("downloads:main-video");
    const r = q.rect;
    const right = Math.min(r.x + r.w, q.view?.w ?? Infinity);
    const box = gBrowser.selectedBrowser.getBoundingClientRect();
    const z = zoomOf();
    const p = pill.getBoundingClientRect();
    return { dx: Math.round(box.left + right * z - p.right), dy: Math.round(p.top - (box.top + r.y * z)), z, view: q.view, pillRight: p.right };
  };

  const id = engine.start(DL.base + "/blob/big?rate=256", { filename: "scaled.bin", named: true });
  await DL.until(id, ["downloading"], { test: (v) => v.received > 1 << 20, timeout: 30000 });
  await DL.open(DL.base + "/video.html", { settle: 1500 });
  await DL.hoverInPage("#v", { dx: 0.45, dy: 0.5 });
  await V.until(() => ui.video.state.shown && ui.video.state.mode === "found", "the pill at 150%");
  await sleep(300);
  let c = await corner();
  check("at 150% the pill sits 12 px inside the video's corner", c.dx === 12 && c.dy === 12, c);
  const pr = pill.getBoundingClientRect();
  check("the pill is 36 px tall and at least 168 wide", Math.round(pr.height) === 36 && pr.width >= 168, [pr.width, pr.height]);
  spike.click(b.root.querySelector(".vd-pill-main"));
  await V.until(() => ui.video.picker.isOpen, "the picker at 150%");
  await sleep(400);
  const kr = ui.video.picker.element.getBoundingClientRect();
  const pr2 = pill.getBoundingClientRect();
  check("the picker is 340 wide, 8 px under the pill, right edges aligned", Math.round(kr.width) === 340 && Math.round(kr.top - pr2.bottom) === 8 && Math.round(kr.right - pr2.right) === 0, [kr.left, kr.top, kr.width, pr2.right, pr2.bottom]);
  check("the picker fits the window", kr.bottom <= innerHeight - 8 && kr.left >= 8, [kr.bottom, innerHeight]);
  await V.capture("v-scale-01-picker-150");
  ui.video.picker.close(false);
  await sleep(300);

  const rr = ui.ring.el.getBoundingClientRect();
  check("the ring is 44 at right 72, bottom 20 at 150%", Math.round(rr.width) === 44 && Math.round(innerWidth - rr.right) === 72 && Math.round(innerHeight - rr.bottom) === 20, [rr.left, rr.top, rr.width]);
  spike.click(ui.ring.el.querySelector("button"));
  await V.until(() => ui.ring.pop.isOpen, "the quick view at 150%");
  await sleep(500);
  const qr = b.root.querySelector(".vd-pop").getBoundingClientRect();
  check("the quick view is 360 wide at right 20, bottom 76", Math.round(qr.width) === 360 && Math.round(innerWidth - qr.right) === 20 && Math.round(innerHeight - qr.bottom) === 76, [qr.left, qr.top, qr.width, qr.height]);
  check("the quick view's lens is built for its size", /url\(/.test(b.root.querySelector(".vd-pop > .lens").style.backdropFilter));
  await V.capture("v-scale-02-quickview-150");
  spike.press("Escape");
  await sleep(300);

  spike.press("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel at 150%");
  await sleep(600);
  const fit = (r) => r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8;
  let r = b.root.querySelector(".vd-panel").getBoundingClientRect();
  // 960x688, scaled as a whole when the window is smaller (panel.ts layout, as Settings).
  const k = Math.min(1, (innerWidth - 32) / 960, (innerHeight - 32) / 688);
  const w = 960 * k;
  const h = 688 * k;
  check("the panel is 960x688 (scaled to fit) and centred at 150%", Math.abs(r.width - w) < 1.5 && Math.abs(r.height - h) < 1.5 && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.top + r.height / 2 - innerHeight / 2) < 1, [r.left, r.top, r.width, r.height, innerWidth, innerHeight]);
  await V.capture("v-scale-03-panel-150");
  Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.0");
  await sleep(1200);
  r = b.root.querySelector(".vd-panel").getBoundingClientRect();
  log("after 100%", devicePixelRatio, innerWidth, innerHeight, [r.left, r.top, r.width, r.height]);
  check("back at 100% with the panel open, it is laid out again and fits", devicePixelRatio === 1 && fit(r) && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 1, [r.left, r.top, r.width, r.height]);
  await V.until(() => /url\(/.test(b.root.querySelector(".vd-panel > .lens").style.backdropFilter), "the panel's lens to come back after the size settles", 3000).catch(() => null);
  check("the panel's lens is rebuilt for its new size", /url\(/.test(b.root.querySelector(".vd-panel > .lens").style.backdropFilter));
  await V.capture("v-scale-04-panel-back-to-100");
  spike.press("Escape");
  await sleep(400);
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await spike.resize(1440, 900);

  // ---- page zoom 150% ----
  window.FullZoom.setZoom(1.5, gBrowser.selectedBrowser);
  await V.until(() => Math.abs(zoomOf() - 1.5) < 0.01, "the tab's zoom", 5000).catch(() => null);
  await sleep(800);
  await DL.hoverInPage("#v", { dx: 0.3, dy: 0.5 });
  await sleep(300);
  await DL.hoverInPage("#v", { dx: 0.35, dy: 0.5 });
  await V.until(() => ui.video.state.shown, "the pill at 150% page zoom");
  await sleep(400);
  c = await corner();
  check("at 150% page zoom the pill sits 12 px inside the visible part of the video, off the page's scrollbar", c.dx === 12 && c.dy === 12, c);
  await V.capture("v-scale-05-page-zoom-150");
  window.FullZoom.reset(gBrowser.selectedBrowser);

  engine.cancel(id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
