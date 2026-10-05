// Peek verification: the motion at real speed (the feature's own tests only look at slowed-down
// frames). Every animation frame the sheet's box is recorded: open 400 ms on the spring from the
// link, close 280 ms into the link, Open as tab 380 ms to the window; the time from the input to
// the first moving frame, the frame count and the longest gap between frames.
//   python tests/peek-verify/all.py motion
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(800);
  const src = b.active();
  const chrome = () => document.querySelector("#layer-peek > .vp-sheet");

  /** Record the sheet's box on every frame from now until stop(). */
  function recorder() {
    const frames = [];
    let live = true;
    const t0 = performance.now();
    const step = (now) => {
      if (!live) return;
      const el = chrome();
      const on = !!el?.classList.contains("on");
      const r = el?.getBoundingClientRect();
      frames.push({ t: Math.round(now - t0), on, x: Math.round(r?.left ?? 0), y: Math.round(r?.top ?? 0), w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0), o: Number(el ? getComputedStyle(el).opacity : 0) });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return { t0, frames, stop: () => (live = false) };
  }
  /** From the frames: when the box first and last changed, and frame gaps in between. */
  function analyse(rec) {
    const f = rec.frames.filter((x) => x.on);
    let first = -1;
    let last = -1;
    for (let i = 1; i < f.length; i++) {
      const a = f[i - 1];
      const z = f[i];
      if (a.x !== z.x || a.y !== z.y || a.w !== z.w || a.h !== z.h) {
        if (first < 0) first = i - 1;
        last = i;
      }
    }
    const moving = first >= 0 ? f.slice(first, last + 1) : [];
    let gap = 0;
    for (let i = 1; i < moving.length; i++) gap = Math.max(gap, moving[i].t - moving[i - 1].t);
    return {
      shownAt: f[0]?.t ?? -1,
      startAt: moving[0]?.t ?? -1,
      duration: moving.length ? moving[moving.length - 1].t - moving[0].t : 0,
      frames: moving.length,
      gap,
      from: moving[0] ?? f[0],
      to: moving[moving.length - 1] ?? f[f.length - 1],
      widths: moving.map((m) => m.w),
    };
  }

  // ---- open ----
  const link = await P.rectOf(src.browser, "#i39");
  P.move(link.cx, link.cy);
  await sleep(100);
  let rec = recorder();
  P.mouse(link.cx, link.cy, { shiftKey: true });
  await sleep(900);
  rec.stop();
  let a = analyse(rec);
  log("open", { ...a, widths: a.widths.join(",") });
  check("open at real speed: the sheet appears within 120 ms of the click", a.shownAt >= 0 && a.shownAt <= 120, a.shownAt);
  check("it starts at the link's box (window px)", a.from && Math.abs(a.from.x - link.x) <= 6 && Math.abs(a.from.y - link.y) <= 6 && a.from.w <= link.w + 12, { from: a.from, link: P.R(link) });
  check("it grows for about 400 ms (the last rounded px change comes at 320-480 ms on the spring)", a.duration >= 320 && a.duration <= 480, a.duration);
  check("it ends at the sheet's box, never overshooting it", a.to && a.to.x === 200 && a.to.y === 72 && a.to.w === 1040 && a.to.h === 804 && Math.max(...a.widths) <= 1040, a.to);
  check("smooth: no frame gap over 50 ms while it moves, 15+ frames", a.gap <= 50 && a.frames >= 15, { gap: a.gap, frames: a.frames });
  await P.waitOpen("n=39");

  // ---- close ----
  rec = recorder();
  P.press("Escape");
  await sleep(700);
  rec.stop();
  a = analyse(rec);
  log("close", { ...a, widths: a.widths.join(",") });
  check("close at real speed: it shrinks for about 280 ms (230-360)", a.duration >= 230 && a.duration <= 360, a.duration);
  check("into the link's box", a.to && Math.abs(a.to.x - link.x) <= 8 && Math.abs(a.to.y - link.y) <= 8, { to: a.to, link: P.R(link) });
  check("smooth: no gap over 50 ms", a.gap <= 50, a.gap);
  await P.waitClosed();

  // ---- promote ----
  await P.shiftClick("#i38");
  await P.waitOpen("n=38");
  rec = recorder();
  const t = performance.now();
  peek().promote();
  await sleep(900);
  rec.stop();
  a = analyse(rec);
  log("promote", { ...a, widths: a.widths.join(","), since: Math.round(rec.t0 - t) });
  check("Open as tab starts moving within 120 ms", a.startAt >= 0 && a.startAt <= 120, a.startAt);
  check("it expands for about 380 ms (330-460)", a.duration >= 330 && a.duration <= 460, a.duration);
  check("to the whole window", a.to && a.to.x === 0 && a.to.y === 0 && a.to.w === Math.round(gBrowser.tabpanels.getBoundingClientRect().width), a.to);
  check("smooth: no gap over 50 ms", a.gap <= 50, a.gap);
  await waitFor(() => !peek().isOpen() && b.tabs.length === 2, { what: "promoted" });
  b.closeTab(b.active());
  await sleep(500);

  // ---- a busy page (180 ms of script every 200 ms) under and in the sheet ----
  await P.load(P.page("busy.html"), src);
  const busy = await P.rectOf(src.browser, "#busy");
  P.move(busy.cx, busy.cy);
  await sleep(300);
  rec = recorder();
  P.mouse(busy.cx, busy.cy, { shiftKey: true });
  await sleep(1500);
  rec.stop();
  a = analyse(rec);
  log("open from a busy page", { shownAt: a.shownAt, startAt: a.startAt, duration: a.duration, frames: a.frames, gap: a.gap });
  check("from a busy page the sheet still appears within 400 ms of the click (the page answers the link query late)", a.shownAt >= 0 && a.shownAt <= 400, a.shownAt);
  await P.waitOpen("busy.html?2");
  rec = recorder();
  peek().promote();
  await sleep(1200);
  rec.stop();
  a = analyse(rec);
  log("promote a busy page", { startAt: a.startAt, duration: a.duration, frames: a.frames, gap: a.gap });
  check("Open as tab on a busy page starts moving within 300 ms", a.startAt >= 0 && a.startAt <= 300, a.startAt);
  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
