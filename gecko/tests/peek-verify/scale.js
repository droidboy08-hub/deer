// Peek verification: 150 % scaling (layout.css.devPixelsPerPx 1.5, set at runtime). The sheet is laid
// out in CSS px: a window of 1440×900 physical px is 960×600 CSS px (sheet 720 wide, the minimum, at
// x 120), and a 2160×1350 window is the board's 1440×900 (sheet 1040×804 at 200,72). Header, page
// box, the grow / shrink end states and the wash are checked in CSS px; captures are physical.
//   python tests/peek-verify/all.py scale
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(400);
  const src = b.active();

  const expected = () => {
    const a = gBrowser.tabpanels.getBoundingClientRect();
    const W = a.width;
    const H = a.height;
    if (W < 900 || H < 600) return { x: a.left + 8, y: a.top + 72, w: W - 16, h: H - 80 };
    const w = Math.min(1120, Math.max(720, Math.round((W * 0.72) / 8) * 8));
    return { x: a.left + Math.round((W - w) / 2), y: a.top + 72, w, h: H - 96 };
  };

  await V.section("scaling changes while a sheet is open", async () => {
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", "1.5");
    await waitFor(() => window.devicePixelRatio === 1.5, { what: "150 %" });
    await sleep(1200);
    let s = P.sheet();
    let e = expected();
    check("going to 150 % with a sheet open lays it out again for the new CSS size", peek().isOpen() && s.chrome && P.near(s.chrome.x, e.x) && P.near(s.chrome.w, e.w) && P.near(s.chrome.h, e.h) && P.near(s.browser.y, e.y + 44) && P.near(s.browser.w, e.w), { chrome: s.chrome, browser: s.browser, e });
    await spike.capture("scale-0-changed-while-open");
    Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
    await waitFor(() => window.devicePixelRatio === 1, { what: "100 %" });
    await sleep(1200);
    s = P.sheet();
    e = expected();
    check("and back at 100 % it is the board's sheet again", peek().isOpen() && s.chrome && s.chrome.x === e.x && s.chrome.w === e.w && s.chrome.h === e.h && s.browser.y === e.y + 44, { chrome: s.chrome, e });
  });

  Services.prefs.setStringPref("layout.css.devPixelsPerPx", "1.5");
  await waitFor(() => window.devicePixelRatio === 1.5, { what: "150 %" });
  await sleep(1200);
  log("at 150 %", { inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio });

  await V.section("1440×900 physical at 150 %", async () => {
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    const s = P.sheet();
    const e = expected();
    log("sheet", s, "expected", e);
    check("at 150 % the sheet follows the CSS-px rules (" + JSON.stringify(e) + ")", s.chrome && P.near(s.chrome.x, e.x) && P.near(s.chrome.y, e.y) && P.near(s.chrome.w, e.w) && P.near(s.chrome.h, e.h) && P.near(s.frame.x, e.x) && P.near(s.frame.w, e.w), s.chrome);
    check("header 44 CSS px, page right under it", s.head && s.head.h === 44 && s.browser && P.near(s.browser.y, e.y + 44) && P.near(s.browser.h, e.h - 44) && P.near(s.browser.x, e.x), { head: s.head, browser: s.browser });
    const inner = await P.inContent(br, (w) => ({ iw: w.innerWidth, ih: w.innerHeight, dpr: w.devicePixelRatio }));
    check("the sheet's page has the sheet's width and the scaled pixel ratio", inner && P.near(inner.iw, e.w, 20) && inner.dpr === 1.5, inner);
    await spike.capture("scale-1-150-small");
    P.mouse(e.x - 40, e.y + 300);
    await P.waitClosed();
    await sleep(300);
    const wash = gBrowser.tabpanels.querySelector(":scope > .vitre-peek-wash");
    const wr = wash && P.R(wash.getBoundingClientRect());
    const row = await P.inContent(src.browser, (w) => {
      const r = w.document.getElementById("i39").closest('[role="listitem"]').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const bx = src.browser.getBoundingClientRect();
    check("the wash lands on the row at 150 %", wr && P.near(wr.x, bx.left + row.x, 2) && P.near(wr.y, bx.top + row.y, 2) && P.near(wr.w, row.w, 3), { wr, row });
  });

  await V.section("2160×1350 physical at 150 % = the board's 1440×900", async () => {
    window.resizeTo(2160 / 1.5 + (window.outerWidth - window.innerWidth), 1350 / 1.5 + (window.outerHeight - window.innerHeight));
    await sleep(800);
    log("window", { inner: [window.innerWidth, window.innerHeight], screen: [screen.availWidth, screen.availHeight] });
    if (window.innerWidth < 1400) {
      log("the screen is too small for a 2160 px window: skipped");
      return;
    }
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    const s = P.sheet();
    const e = expected();
    check("at 150 % in a 1440×900 CSS px window the sheet is the board's 1040×804 at (200,72)", s.chrome && P.near(s.chrome.x, e.x) && P.near(s.chrome.w, e.w) && P.near(s.chrome.h, e.h) && s.head.h === 44, { chrome: s.chrome, e });
    await spike.capture("scale-2-150-board");
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.active().browser === br, { what: "promote at 150 %" });
    await sleep(800);
    const inset = await b.page(br).query("inset:state");
    check("promoted at 150 %: a tab with its strip", inset?.applied === true && inset.browserOff === false, inset && { applied: inset.applied, off: inset.browserOff });
    await spike.capture("scale-3-150-promoted");
  });

  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await sleep(600);
  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
