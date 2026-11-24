// Spike S3 (lifetime): what real glass panels do when Deer's window moves, resizes, is minimised,
// goes full screen or loses focus. Test-only (glasslib.js + behavelib.js build the panels at runtime).
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s3-lifetime.js --name mac-glass-s3 --url about:blank \
//       --timeout 600 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Three glass panels (level="parent", the way Deer's menus are child windows of its window):
//   A "settings"  anchored with openPopup(placeholder, "overlap"), followanchor, noautohide: the
//                 Settings / Downloads panel stand-in, centred in the window (560 x 360)
//   B "quick"     anchored "bottomright topright" + 8 px under a 36 px placeholder at the window's
//                 top-right, followanchor, auto-hide: the Downloads quick view stand-in (380 x 240)
//   C "pinned"    openPopupAtScreen, noautohide: how glasslib.js and Deer's menus open (240 x 110)
// Each panel has a blue square at its top-left + 6 px; red squares in the window mark where A should be.
// Moves and resizes are tracked in the window server (behave_mon.py TRACK: every window's frame every
// ~4 ms), so "follows", "lags" and "closes" are measured, not guessed. Captures: glass-behave-s3-*.png.
/* global spike, G, GB, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const b = window.vitre;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const ONLY = Services.env.get("GLASS_ONLY") || "";
  const want = (s) => !ONLY || ONLY.split(",").includes(s);
  const W = 1200;
  const H = 760;
  await spike.resize(W, H);
  await spike.activate();
  const body =
    `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#e8e8e8 0 40px,#f7f7f7 40px 80px)"></div>` +
    `<div style="position:absolute;left:60px;top:90px;right:60px;font:600 40px/1.3 system-ui;color:#2b2b2b">${"Lifetime of a glass panel · ".repeat(14)}</div>`;
  await G.load(G.page("Lifetime", "#f2f2f2", "#1d1d1f", body));
  await G.caption("");
  b.focusPage();

  // Placeholders (pointer-transparent, in a module layer of #vitre-root).
  const aEl = GB.placeholder("gb-a", "left:calc(50% - 280px);top:calc(50% - 160px);width:560px;height:360px;");
  aEl.innerHTML = '<div style="position:absolute;left:-16px;top:-16px;width:10px;height:10px;background:#ff0000"></div><div style="position:absolute;right:-16px;bottom:-16px;width:10px;height:10px;background:#ff0000"></div>';
  const bEl = GB.placeholder("gb-b", "right:20px;top:8px;width:36px;height:36px;border-radius:18px;background:rgba(255,59,48,.85);");
  const settingsHtml =
    `<h2>Settings stand-in</h2><div class="sec top">anchored · followanchor · noautohide · level parent</div>` +
    `<div class="opt"><div class="t"><span>Hide the row</span><span class="sec">Show it when the pointer is at the top</span></div><span class="sw off"></span></div>` +
    `<div class="opt"><div class="t"><span>Block trackers</span><span class="sec">Strict protection on every site</span></div><span class="sw"></span></div>`;
  const quickHtml = `<div class="hd">Quick view stand-in · anchored · auto-hide</div><div class="row"><span>report.pdf</span><span class="k">2.1 MB</span></div><div class="row"><span>photo.jpg</span><span class="k">640 KB</span></div><div class="row"><span>video.mp4</span><span class="k">48%</span></div>`;
  const pinnedHtml = `<div>Pinned at a screen point</div><div class="sec">openPopupAtScreen · noautohide</div>`;

  const openA = () => GB.anchored({ name: "A-settings", anchor: aEl, position: "overlap", w: 560, h: 360, scheme: "dark", cls: "settings", html: settingsHtml, marker: true });
  const openB = () => GB.anchored({ name: "B-quick", anchor: bEl, position: "bottomright topright", y: 8, w: 380, h: 240, scheme: "dark", cls: "menu", html: quickHtml, marker: true, autohide: true });
  const openC = () => GB.anchored({ name: "C-pinned", atScreen: { x: 24, y: H - 160 }, follow: false, w: 240, h: 110, scheme: "dark", html: pinnedHtml, marker: true });
  let A = await openA();
  let B = await openB();
  let C = await openC();
  const panels = () => [A, B, C];
  const reopenB = async () => {
    if (B.state !== "open") {
      G.close(B);
      B = await openB();
      await sleep(300);
    }
    return B.state;
  };

  const ox = window.mozInnerScreenX - window.screenX;
  const oy = window.mozInnerScreenY - window.screenY;
  log("window " + JSON.stringify({ screen: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], inner: [window.innerWidth, window.innerHeight], ox, oy, dpr: window.devicePixelRatio }));
  const results = {};

  /** Gecko's idea and the window server's idea of where everything is. */
  async function snap(label, extra = {}) {
    const wl = await GB.ask("WINLIST", GB.tag("s3-" + label));
    const r = GB.rel(wl);
    const gecko = {};
    for (const p of panels()) gecko[p._gb.name] = p.state === "open" ? GB.rect(p) : p.state;
    gecko.anchorA = GB.erect(aEl);
    gecko.anchorB = GB.erect(bEl);
    const rec = { states: GB.states(panels()), gecko, server: r, ...extra };
    log("SNAP " + label + " " + JSON.stringify(rec));
    results[label] = rec;
    return rec;
  }

  /** Window-server frames per sample: main window + each glass window (matched by size). */
  function series(tr) {
    const out = [];
    for (const [ms, rows] of tr.samples || []) {
      const main = rows.filter((r) => r[1] === 0).sort((x, y) => y[4] * y[5] - x[4] * x[5])[0];
      if (!main) continue;
      const s = { t: tr.t0 * 1000 + ms, main: main.slice(2, 6) };
      for (const r of rows) {
        if (r === main) continue;
        const k = r[4] === 560 && r[5] === 360 ? "A" : r[4] === 380 && r[5] === 240 ? "B" : r[4] === 240 && r[5] === 110 ? "C" : null;
        if (k) s[k] = r.slice(2, 6);
      }
      out.push(s);
    }
    return out;
  }
  /** Where A, B and C should be for a main window frame (server points), by their anchoring rules. */
  function expected(main, c0) {
    const innerW = main[2] - (window.outerWidth - window.innerWidth);
    const innerH = main[3] - (window.outerHeight - window.innerHeight);
    const ix = main[0] + ox;
    const iy = main[1] + oy;
    return {
      A: [ix + Math.round(innerW / 2 - 280), iy + Math.round(innerH / 2 - 160)],
      B: [ix + innerW - 20 - 380, iy + 8 + 36 + 8],
      C: c0,
    };
  }
  /** Per glass window: largest distance from its rule after the action, how long it was off, and when the main window and it first moved. */
  function lag(ser, tAction, c0) {
    const rep = {};
    const first = ser[0];
    const mainMoved = ser.find((s) => s.t >= tAction && (s.main[0] !== first.main[0] || s.main[1] !== first.main[1] || s.main[2] !== first.main[2] || s.main[3] !== first.main[3]));
    rep.mainChangedAfterMs = mainMoved ? Math.round(mainMoved.t - tAction) : null;
    rep.samples = ser.length;
    for (const k of ["A", "B", "C"]) {
      let maxOff = 0;
      let offMs = 0;
      let firstMove = null;
      let lastOffAt = null;
      let present = 0;
      for (let i = 0; i < ser.length; i++) {
        const s = ser[i];
        if (!s[k]) continue;
        present++;
        if (firstMove === null && first[k] && (s[k][0] !== first[k][0] || s[k][1] !== first[k][1])) firstMove = Math.round(s.t - tAction);
        if (s.t < tAction) continue;
        const e = expected(s.main, c0)[k];
        const d = Math.max(Math.abs(s[k][0] - e[0]), Math.abs(s[k][1] - e[1]));
        if (d > 1) {
          const next = ser[i + 1];
          offMs += next ? next.t - s.t : 0;
          lastOffAt = Math.round(s.t - tAction);
        }
        maxOff = Math.max(maxOff, d);
      }
      const last = ser[ser.length - 1];
      rep[k] = { present, firstMoveMs: firstMove, maxOffPt: Math.round(maxOff), offMs: Math.round(offMs), lastOffAtMs: lastOffAt, final: last && last[k] ? last[k] : null, finalExpected: last ? expected(last.main, c0)[k] : null };
    }
    return rep;
  }

  await sleep(800);
  const s0 = await snap("open");
  const c0 = (() => {
    const c = s0.server.others?.find((w) => w.rel[2] === 240 && w.rel[3] === 110);
    return c ? [s0.server.main[0] + ox + c.rel[0], s0.server.main[1] + oy + c.rel[1]] : null;
  })();
  check("three glass panels open", panels().every((p) => p.state === "open"), GB.states(panels()));
  await spike.captureScreen("glass-behave-s3-open");

  // ---- 1. one programmatic move ----
  if (want("move")) {
    await reopenB();
    const t = GB.tag("s3-move");
    await GB.startTrack(t, 2.5);
    await sleep(150);
    const tA = Date.now();
    window.moveTo(window.screenX + 160, window.screenY + 70);
    const frames = await GB.perFrame(900, () => ({ sx: window.screenX, A: A.state === "open" ? GB.rect(A).x : A.state, B: B.state, C: C.state === "open" ? GB.rect(C).x : C.state }));
    const tr = await GB.result(t);
    const rep = lag(series(tr), tA, c0);
    log("MOVE gecko-per-frame " + JSON.stringify(frames.filter((f, i) => i < 3 || i % 10 === 0)));
    log("MOVE lag " + JSON.stringify(rep));
    results.move = rep;
    await snap("moved");
    await spike.captureScreen("glass-behave-s3-moved");
  }

  // ---- 2. animated move (one moveTo per frame, 40 frames: as close to a drag as a script gets) ----
  if (want("dragmove")) {
    await reopenB();
    const t = GB.tag("s3-dragmove");
    await GB.startTrack(t, 3);
    await sleep(150);
    const tA = Date.now();
    const x0 = window.screenX;
    const y0 = window.screenY;
    await GB.perFrame(700, (ms) => {
      const k = Math.min(1, ms / 650);
      window.moveTo(Math.round(x0 - 140 * k), Math.round(y0 + 40 * Math.sin(k * Math.PI)));
      return 0;
    });
    const tr = await GB.result(t);
    const rep = lag(series(tr), tA, c0);
    log("DRAGMOVE lag " + JSON.stringify(rep));
    results.dragmove = rep;
    await snap("dragmoved");
  }

  // ---- 3. window partly off the screen's right edge: are anchored panels kept on screen? ----
  if (want("offscreen")) {
    await reopenB();
    const sw = screen.availLeft + screen.availWidth;
    window.moveTo(sw - window.outerWidth + 220, 60);
    await sleep(1200);
    const s = await snap("offscreen-right", { screenRight: sw });
    results.offscreenRight = s;
    await spike.captureScreen("glass-behave-s3-offscreen-right");
    window.moveTo(40, 40);
    await sleep(800);
  }

  // ---- 4. one programmatic resize (wider and taller: A is re-centred, B follows the right edge) ----
  if (want("resize")) {
    await reopenB();
    const t = GB.tag("s3-resize");
    await GB.startTrack(t, 2.5);
    await sleep(150);
    const tA = Date.now();
    window.resizeTo(W + 240, H + 100);
    await sleep(1600);
    const tr = await GB.result(t);
    const rep = lag(series(tr), tA, c0);
    log("RESIZE lag " + JSON.stringify(rep));
    results.resize = rep;
    await snap("resized");
    await spike.captureScreen("glass-behave-s3-resized");
  }

  // ---- 5. animated resize from the right/bottom edge (one resizeTo per frame) ----
  if (want("dragresize")) {
    await reopenB();
    if (Services.env.get("GLASS_NO_REC") !== "1") {
      // 60 fps video of A while the window shrinks; the rectangle stays inside Deer's window throughout.
      await spike.captureScreen("glass-behave-s3-before-dragresize"); // brings the window to the front
      const ix = window.mozInnerScreenX;
      const iy = window.mozInnerScreenY;
      const ex = window.innerWidth - 300; // the window's inner width at the end of the drag
      const ey = window.innerHeight - 120;
      const rx = Math.round(ex / 2 - 300);
      const ry = Math.round(ey / 2 - 200);
      const rec = await GB.ask("REC", GB.tag("s3-rec-dragresize"), [Math.round(ix + rx), Math.round(iy + ry), Math.round(window.innerWidth / 2 + 300 - rx), Math.round(window.innerHeight / 2 + 200 - ry), 3]);
      log("REC dragresize " + JSON.stringify(rec) + " rect " + JSON.stringify([Math.round(ix + rx), Math.round(iy + ry)]));
    }
    const t = GB.tag("s3-dragresize");
    await GB.startTrack(t, 3);
    await sleep(150);
    const tA = Date.now();
    const w0 = window.outerWidth;
    const h0 = window.outerHeight;
    await GB.perFrame(700, (ms) => {
      const k = Math.min(1, ms / 650);
      window.resizeTo(Math.round(w0 - 300 * k), Math.round(h0 - 120 * k));
      return 0;
    });
    await sleep(800);
    const tr = await GB.result(t);
    const rep = lag(series(tr), tA, c0);
    log("DRAGRESIZE lag " + JSON.stringify(rep));
    results.dragresize = rep;
    await snap("dragresized");
  }

  // ---- 6. animated resize from the left edge (moveTo + resizeTo per frame) ----
  if (want("dragleft")) {
    await reopenB();
    const t = GB.tag("s3-dragleft");
    await GB.startTrack(t, 3);
    await sleep(150);
    const tA = Date.now();
    const x0 = window.screenX;
    const w0 = window.outerWidth;
    await GB.perFrame(700, (ms) => {
      const k = Math.min(1, ms / 650);
      const dx = Math.round(180 * k);
      window.moveTo(x0 + dx, window.screenY);
      window.resizeTo(w0 - dx, window.outerHeight);
      return 0;
    });
    await sleep(800);
    const tr = await GB.result(t);
    const rep = lag(series(tr), tA, c0);
    log("DRAGLEFT lag " + JSON.stringify(rep));
    results.dragleft = rep;
    await snap("dragleft");
    await spike.captureScreen("glass-behave-s3-after-drags");
    window.resizeTo(W, H);
    window.moveTo(40, 40);
    await sleep(800);
  }

  // ---- 7. focus moves to a second Deer window over the first ----
  if (want("window2")) {
    await reopenB();
    let deact = 0;
    const onDeact = () => deact++;
    window.addEventListener("deactivate", onDeact);
    const w2 = await spike.openWindow();
    w2.resizeTo(720, 520);
    w2.moveTo(window.screenX + 330, window.screenY + 160);
    await sleep(1800);
    const s = await snap("second-window", { deactivateEvents: deact, activeIsW2: Services.focus.activeWindow === w2 });
    results.secondWindow = s;
    await spike.captureScreen("glass-behave-s3-second-window");
    const ax = await GB.ask("AXINFO", GB.tag("s3-w2-ax"));
    log("AX second-window " + JSON.stringify(ax));
    w2.close();
    const gone = await waitFor(() => w2.closed, { timeout: 8000, what: "second window closed" }).then(() => true, () => false);
    await sleep(800);
    await spike.activate();
    await snap("second-window-closed", { w2Closed: gone });
    window.removeEventListener("deactivate", onDeact);
  }

  // ---- 8. another app's window ordered over Deer's window, without taking focus ----
  if (want("helper")) {
    await reopenB();
    const t = GB.tag("s3-helper");
    const hx = window.screenX + 280;
    const hy = window.screenY + 190;
    const up = await GB.ask("HELPER", t, [hx, hy, 640, 380, 10]);
    log("HELPER up " + JSON.stringify(up));
    await sleep(900);
    const s = await snap("helper-over", { helper: up });
    results.helperOver = s;
    const shot = await GB.ask("SHOT", "glass-behave-s3-helper-over", GB.winRect(0), 60000);
    log("SHOT " + JSON.stringify(shot));
    await sleep(9000);
  }

  // ---- 9. Deer loses focus to another app (the helper activates itself) ----
  if (want("deactivate")) {
    await reopenB();
    let deact = 0;
    const onDeact = () => deact++;
    window.addEventListener("deactivate", onDeact);
    const t = GB.tag("s3-helper-active");
    const up = await GB.ask("HELPER", t, [window.screenX + 280, window.screenY + 190, 640, 380, 7, "activate"]);
    await sleep(1200);
    const ax = await GB.ask("AXINFO", GB.tag("s3-deact-ax"));
    const s = await snap("deactivated", { helper: up, deactivateEvents: deact, deerActive: ax.active });
    results.deactivated = s;
    const shot = await GB.ask("SHOT", "glass-behave-s3-deactivated", GB.winRect(0), 60000);
    log("SHOT " + JSON.stringify(shot));
    await sleep(6500);
    window.removeEventListener("deactivate", onDeact);
    await spike.activate();
    await spike.captureScreen("glass-behave-s3-reactivated");
    await snap("reactivated");
  }

  // ---- 10. minimise and restore ----
  if (want("minimize")) {
    await reopenB();
    window.minimize();
    const mini = await waitFor(() => window.windowState === window.STATE_MINIMIZED, { timeout: 6000, what: "minimised" }).then(() => true, () => false);
    await sleep(1500);
    const s1 = await snap("minimized", { minimized: mini, windowState: window.windowState });
    results.minimized = s1;
    window.restore();
    const back = await waitFor(() => window.windowState === window.STATE_NORMAL, { timeout: 8000, what: "restored" }).then(() => true, () => false);
    await sleep(1500);
    const s2 = await snap("restored", { restored: back, windowState: window.windowState });
    results.restored = s2;
    await spike.captureScreen("glass-behave-s3-restored");
    if (A.state !== "open") log("A is " + A.state + " after restore");
  }

  // ---- 11. native full screen in and out ----
  if (want("fullscreen")) {
    await reopenB();
    for (const p of [A, C]) if (p.state !== "open") log("before full screen " + p._gb.name + " is " + p.state);
    const tA = Date.now();
    b.run("fullscreen");
    const fs = await waitFor(() => window.fullScreen, { timeout: 10000, what: "full screen" }).then(() => true, () => false);
    await sleep(2500);
    const s1 = await snap("fullscreen", { fullScreen: fs, ms: Date.now() - tA, rootClass: b.root.className, sizemode: document.documentElement.getAttribute("sizemode"), screenW: screen.width, screenH: screen.height, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight] });
    results.fullscreen = s1;
    await spike.captureScreen("glass-behave-s3-fullscreen");
    b.run("fullscreen");
    const out = await waitFor(() => !window.fullScreen, { timeout: 10000, what: "full screen left" }).then(() => true, () => false);
    await sleep(2500);
    const s2 = await snap("fullscreen-left", { left: out, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight] });
    results.fullscreenLeft = s2;
    await spike.captureScreen("glass-behave-s3-fullscreen-left");
  }

  log("S3 RESULTS " + JSON.stringify(results));
  G.closeAll();
});
