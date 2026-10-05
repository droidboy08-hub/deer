// Switcher verification at 150% (layout.css.devPixelsPerPx = 1.5 set at run time): geometry of the
// three styles in CSS px, pictures and card canvases at device resolution (sharp), the window controls
// on top of the deck and grid at their place, a change of scale while the switcher is up, and back to
// 100%.
// python tools/run.py --test tests/switcher-verify/scale.js --name swverify-scale --app build-switcher-verify --timeout 300
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const tabs = await V.openTabs(["https://en.wikipedia.org/wiki/Float_glass", "https://www.mozilla.org/en-US/", "https://en.wikipedia.org/wiki/Glass", "https://example.com/", "https://www.python.org/"]);
  await V.visit([tabs[4], tabs[3], tabs[2], tabs[1], tabs[0]]);
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;

  /** Every card canvas on screen, against its CSS size times the scale. */
  function canvases() {
    const dpr = window.devicePixelRatio;
    const out = [];
    for (const c of document.querySelectorAll("#layer-switcher .sw-media canvas")) {
      const r = c.getBoundingClientRect();
      if (!r.width || r.right < 0 || r.left > innerWidth) continue;
      const card = c.closest(".sw-dcard, .sw-gcard, .sw-scard");
      // The deck scales neighbours by transform: compare with the layout size.
      const w = c.offsetWidth || c.parentElement.offsetWidth;
      out.push({ backing: c.width, css: w, want: Math.round(w * dpr), sharp: Math.abs(c.width - Math.round(w * dpr)) <= 1, sel: card?.classList.contains("sel") });
    }
    return out;
  }
  /** The window controls are on top of the switcher where they belong; the hidden tab bar takes no clicks. */
  function controlsOnTop() {
    const ctl = document.getElementById("vitre-winctl");
    const r = ctl.getBoundingClientRect();
    const hits = [0.17, 0.5, 0.83].map((f) => ctl.contains(document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)));
    const pill = document.querySelector("#vitre-bar .item.active");
    const pr = pill?.getBoundingClientRect();
    const atPill = pr ? document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2) : null;
    const ok = hits.every(Boolean) && near(innerWidth - r.right, 12) && near(r.top, 18) && r.width === 108 && (!atPill || !atPill.closest("#vitre-bar"));
    return { ok, hits, ctl: V.rect(ctl), atPill: atPill ? (atPill.id || atPill.className) : null };
  }

  for (const scale of ["1.5", "1"]) {
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", scale);
    await waitFor(() => near(window.devicePixelRatio, Number(scale), 0.01), { timeout: 6000, what: scale + "x" });
    await sleep(1500);
    // Pictures taken at the old scale are refreshed by the switcher as it opens (older than 2.5 s).
    log(`--- ${scale}x: inner ${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`);
    for (const style of ["deck", "grid", "strip"]) {
      await V.setStyle(style);
      await V.holdOpen(1);
      await sleep(1600);
      const cv = canvases();
      const geo = {};
      if (style === "deck") {
        const sel = document.querySelector("#layer-switcher .sw-dcard.sel");
        const dock = document.querySelector("#layer-switcher .sw-dock");
        Object.assign(geo, { card: V.rect(sel), dock: V.rect(dock), pill: V.rect(document.querySelector("#layer-switcher .sw-dot.sel")) });
        check(`${scale}x deck: the card keeps the window's shape at 60% height, the dock is 52 px high, 70 px off the bottom, the pill 216 x 40`, near(geo.card.h, Math.min(innerHeight * 0.6, innerHeight - 70 - 52 - 84), 1) && near(geo.card.w / geo.card.h, innerWidth / innerHeight, 0.01) && geo.dock.h === 52 && near(innerHeight - (geo.dock.y + geo.dock.h), 70) && near(geo.pill.w, 216, 1) && geo.pill.h === 40, geo);
      } else if (style === "grid") {
        const card = document.querySelector("#layer-switcher .sw-gcard .sw-gface");
        Object.assign(geo, { face: V.rect(card), field: V.rect(document.querySelector("#layer-switcher .sw-gfield")) });
        check(`${scale}x grid: cards 291 x 182, the field 44 high at top 12, centred`, geo.face.w === 291 && geo.face.h === 182 && geo.field.h === 44 && geo.field.y === 12 && near(geo.field.x + geo.field.w / 2, innerWidth / 2, 1), geo);
      } else {
        const panel = document.querySelector("#layer-switcher .sw-panel");
        Object.assign(geo, { panel: V.rect(panel), face: V.rect(document.querySelector("#layer-switcher .sw-scard .sw-sface")) });
        check(`${scale}x strip: the panel is 212 high and centred, cards 192 x 120`, geo.panel.h === 212 && near(geo.panel.y + 106, innerHeight / 2, 1) && geo.face.w === 192 && geo.face.h === 120, geo);
      }
      check(`${scale}x ${style}: every card canvas on screen is at device resolution (sharp)`, cv.length > 0 && cv.every((c) => c.sharp), cv);
      if (style !== "strip") {
        const top = controlsOnTop();
        check(`${scale}x ${style}: the window controls sit on top of the switcher at their place (108 wide, 12 from the right, 18 from the top); the hidden tab bar takes no clicks`, top.ok, top);
      }
      // The picture of the selected card is at least as wide as its canvas (no upscaling blur).
      const selId = state().selected;
      let bw = 0;
      window.vitreSwitcher.thumbs.drawInto(selId, (bmp) => (bw = bmp.width));
      const selCanvas = document.querySelector(`#layer-switcher [data-id="${selId}"] .sw-media canvas`);
      check(`${scale}x ${style}: the selected card's picture is at least its canvas's width (${bw} >= ${selCanvas?.width})`, bw >= (selCanvas?.width ?? 1) - 2 || bw >= 1280 - 2, { bw, canvas: selCanvas?.width });
      await spike.capture(`scale-${scale.replace(".", "")}-${style}`);
      await V.release();
      b.activate(tabs[0]);
      await sleep(500);
    }
  }

  // ---- the scale changes while the switcher is up ----
  log("--- scale changes while open");
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    await V.latched();
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", "1.5");
    await waitFor(() => near(window.devicePixelRatio, 1.5, 0.01), { timeout: 6000, what: "1.5x" });
    await sleep(1200);
    const cv = canvases();
    check(`${style}: the scale changes to 150% while the switcher is up: the cards on screen are redrawn at device resolution`, cv.length > 0 && cv.every((c) => c.sharp), cv);
    await spike.capture(`scale-change-open-${style}`);
    press("Escape");
    await V.closed();
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", "1");
    await waitFor(() => near(window.devicePixelRatio, 1, 0.01), { timeout: 6000, what: "1x" });
    await sleep(800);
  }
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await V.setStyle("deck");
  const c = V.consoleDump("scale");
  check("no console errors from Vitre while scaling", c.vitre === 0, c);
});
