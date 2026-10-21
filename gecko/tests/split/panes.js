// Split view's content area (../design/SPLIT-VIEW-SPEC.md "Panes", "Build notes", "Focus"): the 8 px
// gutter in the Appearance mode's colour, pane widths from the ratio, inner corners, rims, Firefox's
// footer and splitter hidden, both pages live, a click in the unfocused pane, the keyboard pulse,
// pane names. Measured in the window and in a real capture.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const W = () => gBrowser.tabpanels.getBoundingClientRect().width;

  log("--- 1. panes and gutter");
  const [fn, tl] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(500);
  let panes = SL.panes();
  const left = Math.round(0.5 * (W() - 8));
  check("50/50: left = round(r x (W - 8)), an 8 px gutter, right = the rest", panes.left.x === 0 && panes.left.w === left && panes.right.x === left + 8 && panes.right.r === Math.round(W()), { panes, W: W() });
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const gutter = getComputedStyle(gBrowser.tabpanels).backgroundColor;
  check("the gutter follows Deer's Appearance mode, never the pages: #202020 dark, #F3F3F3 light", gutter === (dark ? "rgb(32, 32, 32)" : "rgb(243, 243, 243)"), { gutter, dark });
  const lc = SL.panel(fn).querySelector(".browserContainer");
  const rc = SL.panel(tl).querySelector(".browserContainer");
  check("inner corners at the gutter are 8 px, outer corners 0 (the window's own)", getComputedStyle(lc).borderTopRightRadius === "8px" && getComputedStyle(lc).borderTopLeftRadius === "0px" && getComputedStyle(rc).borderTopLeftRadius === "8px" && getComputedStyle(rc).borderBottomRightRadius === "0px", [getComputedStyle(lc).borderRadius, getComputedStyle(rc).borderRadius]);
  const footers = [...document.querySelectorAll("split-view-footer")].filter((f) => getComputedStyle(f).display !== "none");
  const splitter = gBrowser.tabpanels.querySelector(".split-view-splitter");
  check("Firefox's split-view footer and splitter are hidden", footers.length === 0 && (!splitter || getComputedStyle(splitter).display === "none"), { footers: footers.length });
  check("both pages are live: both docshells active", fn.browser.docShellIsActive && tl.browser.docShellIsActive);
  check("the panes are regions named Left page: Field Notes and Right page: Tideline", SL.panel(fn).getAttribute("aria-label") === "Left page: Field Notes" && SL.panel(tl).getAttribute("aria-label") === "Right page: Tideline" && SL.panel(fn).getAttribute("role") === "region" && SL.panel(tl).getAttribute("role") === "region", [fn, tl].map((t) => [SL.panel(t).getAttribute("role"), SL.panel(t).getAttribute("aria-label")]));

  log("--- 2. rims");
  await SL.until(() => tl.theme === "dark" && fn.theme === "light", 5000);
  await sleep(300);
  const [rl, rr] = SL.rims();
  const cl = getComputedStyle(rl);
  const cr = getComputedStyle(rr);
  check("rims sit on the panes (1 px inside), not hit-testable", SL.rect(rl).w === panes.left.w && SL.rect(rr).x === panes.right.x && cl.pointerEvents === "none" && cl.borderTopWidth === "1px", { rl: SL.rect(rl), rr: SL.rect(rr) });
  check("the focused pane (light page): #005FB8; the other (dark page): white 0.10", rl.classList.contains("focused") && cl.borderTopColor === "rgb(0, 95, 184)" && cr.borderTopColor === "rgba(255, 255, 255, 0.1)", [cl.borderTopColor, cr.borderTopColor]);
  await spike.capture("panes-1");
  b.activate(tl);
  await sleep(400);
  check("focus on the dark page: its rim #4CC2FF, the light one black 0.10", getComputedStyle(rr).borderTopColor === "rgb(76, 194, 255)" && getComputedStyle(rl).borderTopColor === "rgba(0, 0, 0, 0.1)", [getComputedStyle(rl).borderTopColor, getComputedStyle(rr).borderTopColor]);

  log("--- 3. a primary or secondary mouse-down in the unfocused pane focuses it; hover does not");
  SL.mouse(panes.left.x + 200, 500, { type: "mousemove" });
  await sleep(300);
  check("hovering the unfocused pane does not move focus", b.active() === tl);
  SL.mouse(panes.left.x + 200, 500, { type: "mousedown" });
  SL.mouse(panes.left.x + 200, 500, { type: "mouseup" });
  await SL.until(() => b.active() === fn, 3000);
  check("a click in the left pane focuses that side", b.active() === fn, b.active()?.title);
  SL.mouse(panes.right.x + 200, 500, { type: "mousedown", button: 2 });
  SL.mouse(panes.right.x + 200, 500, { type: "mouseup", button: 2 });
  SL.mouse(panes.right.x + 200, 500, { type: "contextmenu", button: 2 });
  await SL.until(() => b.active() === tl, 3000);
  await SL.until(() => SL.menuOpen(), 3000);
  check("a right-click in the unfocused pane focuses it, and its page menu survives the switch", b.active() === tl && SL.menuOpen(), { active: b.active()?.title, menu: SL.labels() });
  SL.closeMenu();
  await sleep(200);

  log("--- 4. the keyboard pulse (F6): 2 px, then back to 1 px");
  b.activate(fn);
  await sleep(300);
  b.focusPage();
  await sleep(200);
  spike.press("F6");
  await SL.until(() => b.active() === tl, 2000);
  await sleep(60);
  const pulsing = rr.classList.contains("pulse") && getComputedStyle(rr).animationName === "sp-pulse";
  check("F6 into the other page: its rim pulses (sp-pulse, 600 ms)", pulsing, { classes: rr.className, anim: getComputedStyle(rr).animationName });
  await sleep(800);
  check("…and settles to the 1 px rim", !rr.classList.contains("pulse"));
  spike.click(SL.half("left").querySelector(".half-main"));
  await SL.until(() => b.active() === fn, 2000);
  await sleep(50);
  check("a click gets no pulse", !rl.classList.contains("pulse"));

  log("--- 5. the capture: gutter and rims as drawn");
  b.activate(fn);
  await sleep(500);
  await spike.capture("panes-2-measure");
  panes = SL.panes();
  const path = PathUtils.join(spike.outDir, "panes-2-measure.png");
  log("MEASURE " + JSON.stringify({ path, gutter: panes.left.r, rightPane: panes.right.x, dark, inner: window.innerWidth, innerH: window.innerHeight }));

  log("--- 6. the pane names reach the accessibility tree (what Narrator reads)");
  // Last: starting the accessibility service changes nothing above.
  const a11y = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
  const named = [];
  for (const t of [fn, tl]) {
    let acc = null;
    for (let i = 0; i < 40 && !acc; i++) {
      acc = a11y.getAccessibleFor(SL.panel(t));
      if (!acc) await sleep(100);
    }
    named.push(acc ? { name: acc.name, role: a11y.getStringRole(acc.role) } : null);
  }
  log("pane accessibles", JSON.stringify(named));
  check("each pane is an accessible region (landmark) carrying its name", named.every((x) => x && ["region", "landmark"].includes(x.role)) && named[0].name === "Left page: Field Notes" && named[1].name === "Right page: Tideline", named);
});
