// The downloads surfaces with the core: the address field open, element full screen, F11, the
// auto-hidden bar, the page inset, find open, Home.
//   - the pill stays in the video's corner (12 px in) with the page inset on and off;
//   - with the address field open the pill is not left floating above the dim (the page is dimmed
//     and the pointer can't reach it), the ring stays where it is;
//   - element full screen hides the ring and the pill; leaving it brings them back;
//   - F11 and the auto-hidden bar: the pill may then go up to 8 px from the top (64 with the bar);
//   - find open hides the pill's download mark (its slot holds Aa); closing find shows it again;
//   - Home shows the ring while a download runs (board Home).
/* global spike, Services, gBrowser, DL, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const settings = b.sys("VitreSettings");
  const pill = b.root.querySelector(".vd-pill");
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const videoRect = async () => (await b.page(b.active()).query("downloads:main-video"))?.rect;
  const corner = async () => {
    const r = await videoRect();
    const box = gBrowser.selectedBrowser.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    return { dx: Math.round(box.left + r.x + r.w - p.right), dy: Math.round(p.top - (box.top + r.y)), video: r, pill: [p.left, p.top, p.width] };
  };

  // A running download keeps the ring up the whole time.
  const bg = engine.start(DL.base + "/blob/big?rate=128", { filename: "background.bin", named: true });
  await DL.until(bg, ["downloading"], { timeout: 20000 });

  // ---- the pill and the page inset ----
  for (const inset of [true, false]) {
    settings.set({ pageInset: inset });
    await sleep(300);
    await DL.open(DL.base + "/video.html", { settle: 1200 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await V.until(() => ui.video.state.shown && ui.video.state.mode === "found", "the pill (inset " + inset + ")");
    await sleep(200);
    const c = await corner();
    check(`the pill sits 12 px inside the video's top-right corner (page inset ${inset ? "on" : "off"})`, c.dx === 12 && c.dy === 12, c);
  }
  settings.set({ pageInset: true });
  await sleep(300);
  // A slow stream (64 KB/s per connection), so the pill is still downloading when it is paused.
  await DL.open(DL.base + "/video-slow.html", { settle: 1500 });
  await DL.hoverInPage("#v", { dx: 0.45, dy: 0.5 });
  const main = await V.until(() => ui.video.state.shown && ui.video.state.mode === "found" && b.root.querySelector(".vd-pill-main"), "the pill");
  // Downloading, then paused: the pill stays on the video (pinned).
  spike.click(main, { shiftKey: true });
  const small = await V.until(() => ui.video.state.mode === "downloading" && b.root.querySelector(".vd-pill-small"), "the downloading pill", 15000);
  await sleep(300);
  spike.click(small);
  await V.until(() => ui.video.state.mode === "paused", "the paused pill");
  await sleep(300);
  check("the paused pill stays on the video", shown(pill));

  // ---- the address field open ----
  b.editAddress();
  await V.until(() => b.root.classList.contains("omni-open"), "the address field");
  await sleep(500);
  await V.capture("v-core-01-address-open");
  check("with the address field open the pill is not drawn over the dim", !shown(pill), pill.getBoundingClientRect().toJSON?.());
  check("the ring stays", ui.ring.isShown && shown(ui.ring.el));
  await V.key("Escape");
  await V.until(() => !b.root.classList.contains("omni-open"), "the address field to close");
  await sleep(400);
  check("the pill comes back when the field closes", shown(pill) && ui.video.state.mode === "paused", ui.video.state.mode);

  // ---- element full screen ----
  await DL.frameScript(gBrowser.selectedBrowser, () => {
    content.document.notifyUserGestureActivation();
    content.document.getElementById("v").requestFullscreen();
    return true;
  });
  await V.until(() => b.root.classList.contains("element-fullscreen"), "element full screen", 8000);
  await sleep(800);
  check("element full screen hides the ring", !shown(ui.ring.el));
  check("element full screen hides the pill", !shown(pill));
  await V.capture("v-core-02-element-fullscreen");
  await DL.frameScript(gBrowser.selectedBrowser, () => {
    content.document.exitFullscreen();
    return true;
  });
  await V.until(() => !b.root.classList.contains("element-fullscreen"), "leaving element full screen", 8000);
  await sleep(1200);
  check("leaving element full screen brings the ring back", shown(ui.ring.el));

  // Surfaces that must be seen leave element full screen first (Vitre's layer is hidden there).
  const enterFs = async () => {
    await DL.frameScript(gBrowser.selectedBrowser, () => {
      content.document.notifyUserGestureActivation();
      content.document.getElementById("v").requestFullscreen();
      return true;
    });
    await V.until(() => b.root.classList.contains("element-fullscreen"), "element full screen", 8000);
    await sleep(700);
  };
  const vitreShown = () => getComputedStyle(b.root).visibility !== "hidden" && getComputedStyle(b.root).display !== "none";
  await enterFs();
  b.run("downloads");
  await V.until(() => !b.root.classList.contains("element-fullscreen"), "Ctrl+J to leave element full screen", 5000).catch(() => null);
  await sleep(600);
  check("Ctrl+J over a full-screen video leaves full screen and the panel is seen", ui.panel.open && !b.root.classList.contains("element-fullscreen") && vitreShown() && shown(b.root.querySelector(".vd-panel")));
  b.run("downloads");
  await sleep(500);
  await enterFs();
  b.run("quit");
  await V.until(() => ui.prompt.isOpen, "the quit prompt", 5000);
  await V.until(() => !b.root.classList.contains("element-fullscreen"), "the prompt to leave element full screen", 5000).catch(() => null);
  await sleep(500);
  check("quitting from a full-screen video leaves full screen and the prompt is seen", !b.root.classList.contains("element-fullscreen") && shown(b.root.querySelector(".vd-quit")));
  ui.prompt.close();
  await sleep(300);
  await enterFs();
  b.run("downloadVideo");
  await V.until(() => ui.video.picker.isOpen, "the picker from full screen", 6000).catch(() => null);
  await sleep(600);
  const pkr = ui.video.picker.element?.getBoundingClientRect();
  check("Ctrl+Shift+D over a full-screen video leaves full screen and the picker is seen inside the window", ui.video.picker.isOpen && !b.root.classList.contains("element-fullscreen") && !!pkr && pkr.top >= 8 && pkr.bottom <= innerHeight - 8, pkr && [pkr.left, pkr.top, pkr.width, pkr.height]);
  await V.capture("v-core-02b-picker-after-fullscreen");
  ui.video.picker.close(false);
  await sleep(300);

  // ---- F11: the bar slides away; the pill may go up to 8 px from the top ----
  ui.video.picker.close(false);
  await DL.frameScript(gBrowser.selectedBrowser, () => {
    // The page is no taller than the window: give it room to scroll the video's top under the bar.
    content.document.body.style.paddingBottom = "1200px";
    content.scrollTo(0, 230);
    return content.scrollY;
  });
  await sleep(400);
  await DL.hoverInPage("#v", { dx: 0.5, dy: 0.5 });
  await sleep(400);
  const withBar = pill.getBoundingClientRect().top;
  b.run("fullscreen");
  await V.until(() => b.root.classList.contains("fullscreen") && b.bar.hidden, "F11", 8000);
  await sleep(900);
  await DL.hoverInPage("#v", { dx: 0.5, dy: 0.6 });
  await sleep(500);
  const r = await videoRect();
  const fsTop = pill.getBoundingClientRect().top;
  log("pill top with bar", withBar, "in F11", fsTop, "video top", r?.y);
  check("with the bar shown the pill keeps below it (64)", withBar >= 64, withBar);
  check("in F11 the pill follows the video up to 8 px from the top", shown(pill) && fsTop >= 8 && fsTop < 64, fsTop);
  check("the ring stays in F11", shown(ui.ring.el));
  await V.capture("v-core-03-f11");
  b.run("fullscreen");
  await V.until(() => !b.root.classList.contains("fullscreen"), "leaving F11", 8000);
  await sleep(800);

  // ---- find open hides the pill's download mark ----
  await DL.frameScript(gBrowser.selectedBrowser, () => {
    content.scrollTo(0, 0);
    return true;
  });
  const mark = b.bar.downloadMark();
  await V.until(() => mark && !mark.classList.contains("empty"), "the download mark");
  check("the mark shows on a page with media", shown(mark));
  if (b.service("find")) {
    b.service("find").open();
    await V.until(() => b.service("find").isOpen(), "find");
    await sleep(500);
    check("find open hides the mark", !shown(mark));
    await V.capture("v-core-04-find-open");
    b.service("find").close();
    await sleep(500);
    check("closing find shows the mark again", shown(mark));
  } else log("no find module in this build");

  // ---- two videos: Ctrl+Shift+D (and the menus' "Download video…") is for the one the pill sits on ----
  const clip = DL.base + "/media/clip";
  const two = "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>Two clips</title><body style="margin:0;background:#0e0f12"><video id="a" src="${clip}" width="640" height="360" muted autoplay loop style="position:absolute;left:60px;top:120px"></video><video id="b" src="${clip}?second" width="480" height="270" muted autoplay loop style="position:absolute;left:760px;top:420px"></video>`);
  b.navigate(b.active().id, two);
  await spike.loaded();
  await sleep(1500);
  await DL.hoverInPage("#b", { dx: 0.5, dy: 0.5 });
  await V.until(() => ui.video.state.shown && ui.video.state.mode === "found", "the pill on the second video");
  await V.key("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "the picker for the hovered video");
  await sleep(300);
  const pk = ui.video.picker.element.getBoundingClientRect();
  const pl = pill.getBoundingClientRect();
  const bq = await DL.frameScript(gBrowser.selectedBrowser, () => content.document.getElementById("b").getBoundingClientRect().toJSON());
  const bx = gBrowser.selectedBrowser.getBoundingClientRect();
  check("with two videos, Ctrl+Shift+D opens the picker on the hovered one", Math.round(pk.right) === Math.round(pl.right) && pl.left > bx.left + bq.left && pl.right <= bx.left + bq.right, { picker: [pk.left, pk.top], pill: [pl.left, pl.top], video: [bq.left, bq.top, bq.width] });
  ui.video.picker.close(false);
  await sleep(300);

  // ---- a download from a peek flies from the sheet's header ----
  const peek = b.service("peek");
  if (peek) {
    await DL.open(DL.base + "/page.html");
    const flights = [];
    const fly = ui.ring.fly.bind(ui.ring);
    ui.ring.fly = (from, view) => {
      flights.push({ from, name: view.filename });
      fly(from, view);
    };
    peek.open(DL.base + "/page.html?peek=1");
    await V.until(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("peek=1") && !peek.browser().webProgress?.isLoadingDocument, "the peek", 15000);
    await sleep(800);
    const header = peek.headerRect();
    await DL.clickInPage("#plain", { browser: peek.browser() });
    await V.until(() => flights.length > 0, "a flight from the peek's download", 15000).catch(() => null);
    log("flights", flights, "header", header && [header.left, header.top, header.width, header.height]);
    const f = flights[0]?.from;
    check("a download from a peek flies to the ring from the sheet's header", !!f && !!header && f.x >= header.left && f.x <= header.right && f.y >= header.top && f.y <= header.bottom, f);
    ui.ring.fly = fly;
    peek.close();
    await sleep(600);
    for (const v of engine.list()) if (v.filename !== "background.bin") engine.cancel(v.id);
  } else log("no peek module in this build");

  // ---- Settings and Downloads: one panel at a time ----
  if (b.service("settings")) {
    b.run("settings");
    await V.until(() => b.root.classList.contains("settings-open"), "Settings");
    await sleep(500);
    spike.press("Ctrl+J");
    await V.until(() => ui.panel.open, "Downloads over Settings");
    await sleep(700);
    check("opening Downloads over Settings leaves one panel: Settings steps aside", !b.root.classList.contains("settings-open"), b.root.className);
    spike.press("Escape");
    await sleep(600);
    check("one Esc closes Downloads", !ui.panel.open);
    const left = b.root.classList.contains("settings-open");
    check("panel-open is cleared with the panels (page keys work again)", left || !b.root.classList.contains("panel-open"), b.root.className);
    if (left) {
      spike.press("Escape");
      await sleep(500);
    }
  }

  // ---- Home ----
  b.newTab();
  await V.until(() => b.active().kind === "home", "Home");
  await sleep(900);
  check("Home shows the ring while a download runs", ui.ring.isShown && shown(ui.ring.el));
  check("Home has no download mark", !shown(b.bar.downloadMark()));
  await V.capture("v-core-05-home-ring");
  const rr = ui.ring.el.getBoundingClientRect();
  check("the ring sits at right 72, bottom 20 on Home", Math.round(innerWidth - rr.right) === 72 && Math.round(innerHeight - rr.bottom) === 20, [rr.left, rr.top]);

  for (const v of engine.list()) engine.cancel(v.id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
