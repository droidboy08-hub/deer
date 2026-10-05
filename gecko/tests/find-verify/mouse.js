// Find in page with the mouse and in forced colours: a click in the page parks find, a press on the
// face's glass brings focus back, the buttons never take focus from the field, the favicon's URL
// tooltip, a right-click sends the ring away; then the face under a forced-colours (contrast) theme.
// Run by tests/find-verify/all.py (mouse).
/* global spike, FL, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(900);
  V.takeErrors();
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open", 3000);
  await FL.query("glass");
  await FL.counter("1 of 13");

  // Geometry against the FindPill board (pill-local, 480 px pill): favicon 16, field 42, counter's
  // right edge 324, previous 334, next 364 (28x28 at y 8), divider 401 (1x16 at y 14), Aa 410, x 442.
  {
    const f = FL.face().getBoundingClientRect();
    const at = (sel) => {
      const r = FL.face().querySelector(sel).getBoundingClientRect();
      return { x: Math.round(r.x - f.x), y: Math.round(r.y - f.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right - f.x) };
    };
    const g = { fav: at(".vf-fav"), input: at(".vf-input"), count: at(".vf-count"), prev: at(".vf-prev"), next: at(".vf-next"), div: at(".vf-div"), aa: at(".vf-case"), close: at(".vf-close") };
    log("face geometry", Math.round(f.width), Math.round(f.height), g);
    const ok =
      Math.round(f.width) === 480 && Math.round(f.height) === 44 &&
      g.fav.x === 16 && g.fav.y === 14 && g.fav.w === 16 &&
      g.input.x === 42 && g.count.r === 324 && g.input.r <= g.count.x - 10 &&
      g.prev.x === 334 && g.prev.y === 8 && g.prev.w === 28 && g.next.x === 364 &&
      g.div.x === 401 && g.div.y === 14 && g.div.w === 1 && g.div.h === 16 &&
      g.aa.x === 410 && g.close.x === 442 && g.close.w === 28;
    check("the find face matches the FindPill board's geometry", ok, g);
  }

  // The buttons never take focus from the field.
  spike.click(...center(FL.face().querySelector(".vf-next")));
  let s = await FL.counter("2 of 13");
  check("a click on next steps and the field keeps focus", s?.counter === "2 of 13" && document.activeElement === FL.input(), document.activeElement?.className);
  spike.click(...center(FL.face().querySelector(".vf-case")));
  await FL.until(() => FL.st()?.matchCase, "case", 2000);
  check("a click on Aa toggles match case and the field keeps focus", FL.st()?.matchCase && document.activeElement === FL.input());
  spike.click(...center(FL.face().querySelector(".vf-case")));
  await FL.until(() => !FL.st()?.matchCase, "case off", 2000);

  // A click in the page parks find; a press on the face's glass comes back to the field.
  spike.click(640, 700);
  await sleep(300);
  s = FL.st();
  check("a click in the page parks find (focus in the page, parked tint)", s?.open && !s.focused && !b.root.classList.contains("find-focused") && document.activeElement === gBrowser.selectedBrowser, s);
  const fav = FL.face().querySelector(".vf-fav");
  const [fx, fy] = center(fav);
  spike.click(fx, fy);
  await sleep(250);
  check("a press on the face's glass (the favicon) puts focus back in the field; nothing else happens", FL.st()?.focused && document.activeElement === FL.input() && FL.st()?.open, FL.st());

  // The favicon's tooltip: the full address after 500 ms.
  spike.EU.synthesizeMouseAtPoint(fx, fy, { type: "mousemove" }, window);
  await FL.until(() => b.bar.tips.shownFor === fav, "fav tip", 2000);
  const tip = document.querySelector("#layer-tips .vitre-tip");
  check("hovering the favicon shows the full address", b.bar.tips.shownFor === fav && tip?.textContent.includes("/article.html"), tip?.textContent);
  await sleep(200);
  await capture("ms-01-favicon-tip");
  spike.EU.synthesizeMouseAtPoint(640, 600, { type: "mousemove" }, window);
  await sleep(300);

  // A right-click in the page sends the ring away.
  spike.press("Enter");
  await FL.until(() => FL.F().ring.visible, "ring", 2000);
  const bb = gBrowser.selectedBrowser.getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(bb.x + 700, bb.y + 600, { type: "contextmenu", button: 2 }, window);
  await FL.until(() => !FL.F().ring.visible, "ring gone", 1500);
  check("a right-click in the page sends the ring away", !FL.F().ring.visible);
  if (window.vitreMenus?.state?.().open) spike.press("Escape");
  await sleep(300);

  // Forced colours (a contrast theme): system colours, no glass.
  Services.prefs.setIntPref("ui.useAccessibilityTheme", 1);
  await sleep(1200);
  const forced = window.matchMedia("(forced-colors: active)").matches;
  log("forced colours active in the chrome", forced);
  if (!forced) {
    log("SKIP forced colours: the pref does not turn forced-colors on in this runtime");
  } else {
    if (!FL.st()?.open) {
      b.focusPage();
      spike.press("Ctrl+F");
      await FL.until(() => FL.st()?.open, "open fc", 3000);
    }
    FL.input().focus();
    spike.press("Alt+C");
    await FL.until(() => FL.st()?.matchCase, "case fc", 2000);
    await sleep(600);
    const face = FL.face();
    const cs = getComputedStyle(face);
    const lensShown = getComputedStyle(face.querySelector(".lens")).display !== "none";
    check("forced colours: the face is Canvas with a CanvasText outline, no glass", cs.backdropFilter === "none" && !lensShown && cs.outlineStyle === "solid", { bg: cs.backgroundColor, outline: cs.outlineStyle, backdrop: cs.backdropFilter, lensShown });
    await capture("ms-02-forced-colours");
    spike.press("Alt+C");
  }
  Services.prefs.clearUserPref("ui.useAccessibilityTheme");
  await sleep(800);
  FL.F().api().close();
  await FL.until(() => !FL.st()?.open, "closed", 3000);
  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
