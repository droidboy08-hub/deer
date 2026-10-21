// Split view: dragging a tab circle to an edge (../design/SPLIT-VIEW-SPEC.md "How to start split
// view": By dragging a tab circle to an edge; "Motion": Lift, drop, cancel; boards SplitDrop and
// SplitSpec "Dropping on a side"; src/window/splitlift.ts). The 300 ms hold before the 5 px window
// move, the lifted circle (1.08 from its resting shadow, its slot's rim alone at 0.5, Deer's glyphs
// as outlines, a flat favicon's contrast plate), the zones and their plates (one reveal per lift), a drop on either side, a drop
// replacing a side of the active pair, every way to cancel, a release in place as a click, touch and
// pen never lifting, a narrow window, Home with Home, F11; keyboard focus back in the page after a
// drop or a cancel, a second button during a lift, a window that lost focus, a collapsed pair.
/* global spike, SL */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  const EU = spike.EU;
  await spike.resize(1440, 900);
  await spike.activate();
  const near = (a, c, tol = 2) => Math.abs(a - c) <= tol;
  const circle = (t) => b.bar.item(t.id)?.querySelector(".circle-face");
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const clone = () => document.querySelector("#layer-split-lift > .sv-lifted");
  const plate = (side) => document.querySelector(`#layer-split-lift > .sv-plate.${side}`);
  const order = () => b.tabs.map((t) => t.title).join(" | ");
  const down = (p, opts = {}) => EU.synthesizeMouseAtPoint(p.x, p.y, { type: "mousedown", ...opts }, window);
  const move = (p, opts = {}) => EU.synthesizeMouseAtPoint(p.x, p.y, { type: "mousemove", buttons: 1, ...opts }, window);
  const up = (p, opts = {}) => EU.synthesizeMouseAtPoint(p.x, p.y, { type: "mouseup", ...opts }, window);
  /** Press on a circle and hold it still for `ms`. */
  async function hold(t, ms = 380) {
    await SL.settled();
    const at = centre(circle(t));
    EU.synthesizeMouseAtPoint(at.x, at.y, { type: "mousemove" }, window);
    down(at);
    await sleep(ms);
    return at;
  }
  /** Move a held pointer in steps (the lifted circle follows). */
  async function glide(from, to, steps = 6) {
    for (let i = 1; i <= steps; i++) {
      move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await new Promise((r) => requestAnimationFrame(() => r()));
      await sleep(16);
    }
  }
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  /** The plate a drop on `side` shows for a new pair: its 50/50 pane, 8 px inside it, from y 64 (SplitDrop). */
  function expectPlate(side) {
    const area = W() - 8;
    const lw = Math.max(320, Math.min(area - 320, Math.round(area / 2)));
    const l = side === "left" ? 0 : lw + 8;
    const r = side === "left" ? lw : W();
    return { x: l + 8, y: 64, w: r - l - 16, h: H() - 72 };
  }

  log("--- 1. a press held 300 ms lifts the circle; before that nothing happens");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  const slot0 = SL.rect(b.bar.item(tl.id));
  let at = await hold(tl, 150);
  check("at 150 ms the press is still a press (no lift yet)", !b.bar.lift.state && !clone());
  await sleep(250);
  const st = b.bar.lift.state;
  check("at 300 ms the circle lifts (b.bar.lift.state names Tideline)", st && st.tabId === tl.id && st.zone === null, st);
  await sleep(200);
  const c1 = clone();
  const cs = c1 ? getComputedStyle(c1) : null;
  check("the lifted circle: a glass copy scaled to 1.08 with the shadow 0 14px 32px rgba(0,0,0,0.26) (SplitDrop)", !!c1 && /matrix\(1\.08/.test(cs.transform) && cs.boxShadow.includes("rgba(0, 0, 0, 0.26)") && cs.boxShadow.includes("14px 32px"), cs && { transform: cs.transform, shadow: cs.boxShadow });
  const slotItem = b.bar.item(tl.id);
  check("its slot keeps the glass rim alone, at 0.5", slotItem.classList.contains("lifted") && getComputedStyle(slotItem.querySelector(":scope > .rim")).opacity === "0.5" && getComputedStyle(slotItem.querySelector(":scope > .circle-face")).visibility === "hidden", slotItem.className);
  check("the bar keeps its place: the slot did not move", SL.rect(slotItem).x === slot0.x, { before: slot0.x, now: SL.rect(slotItem).x });
  check("a transparent cover over the pages takes the pointer", !!document.querySelector("#layer-split-lift > .sv-lift-cover"));

  log("--- 2. the zones: the outer thirds below the bar band, each with its plate");
  const rightAt = { x: Math.round(W() * 0.8), y: 420 };
  await glide(at, rightAt);
  await sleep(320);
  const pr = plate("right");
  const want = expectPlate("right");
  check("over the right third: the right zone, the plate where the right pane will be (8 px inside it, from y 64)", b.bar.lift.state?.zone === "right" && !!pr && near(SL.rect(pr).x, want.x) && near(SL.rect(pr).w, want.w) && SL.rect(pr).y === 64 && near(SL.rect(pr).h, want.h), { plate: pr && SL.rect(pr), want });
  check("the plate shows the tab: favicon (32 px), title and host; named as a preview", !!pr && pr.querySelector(".sv-plate-title")?.textContent === "Tideline" && pr.querySelector(".sv-plate-line")?.textContent.startsWith("127.0.0.1") && pr.querySelector(".sv-plate-fav")?.getBoundingClientRect().width === 32 && pr.getAttribute("aria-label") === "Split view preview: Tideline opens on the right", pr && { label: pr.getAttribute("aria-label"), lines: [...pr.querySelectorAll(".sv-plate-in > div")].map((x) => x.textContent) });
  const mat = pr && getComputedStyle(pr.querySelector(".sv-plate-mat"));
  check("the plate: frost rgba(32,32,38,0.80) blur 24 saturate 1.6, radius 8, shadow 0 18px 44px", !!mat && mat.backgroundColor === "rgba(32, 32, 38, 0.8)" && mat.backdropFilter.includes("blur(24px)") && getComputedStyle(pr).borderRadius === "8px", mat && { bg: mat.backgroundColor, bf: mat.backdropFilter });
  const cl = clone();
  check("the lifted circle follows the pointer and, light over the dark plate, takes the mixed tint", near(centre(cl).x, rightAt.x, 30) && cl.classList.contains("mixed"), { c: centre(cl), p: rightAt, cls: cl.className });
  await spike.capture("lift-1-right-zone");
  await glide(rightAt, { x: W() / 2, y: 420 });
  await sleep(300);
  check("over the middle third: no zone, no plate", b.bar.lift.state?.zone === null && !plate("right") && !plate("left") && !clone().classList.contains("mixed"), b.bar.lift.state);
  const leftAt = { x: Math.round(W() * 0.15), y: 500 };
  await glide({ x: W() / 2, y: 420 }, leftAt);
  await sleep(320);
  const pl = plate("left");
  const wantL = expectPlate("left");
  check("over the left third: the left plate (8 px inside the left pane)", b.bar.lift.state?.zone === "left" && !!pl && near(SL.rect(pl).x, wantL.x) && near(SL.rect(pl).w, wantL.w), pl && SL.rect(pl));
  await glide(leftAt, { x: leftAt.x, y: 30 });
  await sleep(200);
  check("in the bar band there is no zone", b.bar.lift.state?.zone === null, b.bar.lift.state);

  log("--- 3. a drop in the right zone: split view with Tideline on the right, the circle flying into its half");
  await glide({ x: leftAt.x, y: 30 }, rightAt);
  await sleep(150);
  up(rightAt);
  await sleep(40);
  const flying = !!document.querySelector("#vitre-bar > .sv-ghost");
  await SL.shown();
  let p = b.splitView.active();
  check("dropped on the right: Field Notes | Tideline, focus stays on Field Notes", p && p.left === fn && p.right === tl && b.active() === fn, p && [p.left.title, p.right.title, b.active().title]);
  check("the dropped circle flies into its half (a ghost in the bar while it does)", flying);
  await sleep(600);
  check("the lift is over: no copy, no cover, no plate, no ghost", !b.bar.lift.state && !clone() && !document.querySelector("#layer-split-lift > .sv-lift-cover, #layer-split-lift > .sv-plate, #vitre-bar > .sv-ghost"));
  await spike.capture("lift-2-formed");

  log("--- 4. a drop in the left zone puts the circle on the left, though it was right of the pill");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  at = await hold(tl);
  await glide(at, leftAt);
  await sleep(200);
  up(leftAt);
  await SL.shown();
  p = b.splitView.active();
  check("dropped on the left: Tideline | Field Notes, Field Notes still focused", p && p.left === tl && p.right === fn && b.active() === fn, p && [p.left.title, p.right.title]);
  await sleep(600);

  log("--- 5. with a pair active a drop replaces that side; the replaced tab goes back to the bar");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(700);
  at = await hold(ln);
  check("set-up: Links lifted beside the pair", b.bar.lift.state?.tabId === ln.id);
  await glide(at, rightAt);
  await sleep(320);
  const pr2 = plate("right");
  const rr = SL.panes().right;
  check("the plate covers the right pane (8 px inside) and says what it replaces", !!pr2 && near(SL.rect(pr2).x, rr.x + 8) && near(SL.rect(pr2).w, rr.w - 16) && [...pr2.querySelectorAll(".sv-plate-line")].some((x) => x.textContent === "Replaces Tideline") && pr2.getAttribute("aria-label") === "Split view preview: Links replaces Tideline on the right", pr2 && { r: SL.rect(pr2), rr, label: pr2.getAttribute("aria-label") });
  up(rightAt);
  await SL.until(() => b.splitView.active()?.right === ln, 3000);
  p = b.splitView.active();
  check("Links replaced the right side; Tideline is back in the bar beside the pair, not closed; focus stays", p && p.left === fn && p.right === ln && b.tabs.includes(tl) && b.active() === fn && order() === "Field Notes | Links | Tideline", { order: order(), active: b.active()?.title });
  await sleep(700);
  check("Tideline's circle is drawn and clickable again once its half has morphed back", !!circle(tl) && !b.bar.item(tl.id).classList.contains("sv-hidden") && getComputedStyle(b.bar.item(tl.id)).opacity === "1");

  log("--- 6. cancels: Esc, a drop in the middle, a drop on the bar; the circle flies back");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  at = await hold(tl);
  await glide(at, rightAt);
  await sleep(200);
  spike.press("Escape");
  await sleep(80);
  check("Esc cancels: no zone, no pair, the copy flies back to its slot", !b.bar.lift.state && !b.splitView.active() && !!clone(), { state: b.bar.lift.state });
  await sleep(400);
  check("after the flight: the copy is gone, the slot shows its circle again", !clone() && !b.bar.item(tl.id).classList.contains("lifted") && getComputedStyle(b.bar.item(tl.id).querySelector(".circle-face")).visibility === "visible");
  up(rightAt);
  await sleep(200);
  check("the Esc went no further (the page did not get it)", b.active() === fn && !b.splitView.active());
  at = await hold(tl);
  await glide(at, { x: W() / 2, y: 500 });
  up({ x: W() / 2, y: 500 });
  await sleep(450);
  check("a drop in the middle third cancels", !b.splitView.active() && !clone() && b.active() === fn);
  at = await hold(tl);
  await glide(at, { x: rightAt.x, y: 30 });
  up({ x: rightAt.x, y: 30 });
  await sleep(450);
  check("a drop on the bar band (even above the right third) cancels", !b.splitView.active() && !clone());

  log("--- 7. a release where it lifted is a click; a quick drag still moves the window");
  at = await hold(tl);
  up({ x: at.x + 2, y: at.y + 1 });
  await sleep(300);
  check("released within 5 px of where it lifted: a click (Tideline shown), no pair", b.active() === tl && !b.splitView.active() && !clone());
  b.activate(fn);
  await sleep(300);
  let moved = 0;
  const realMove = b.bar.moveWindow;
  b.bar.moveWindow = () => {
    moved++;
    return true;
  };
  await SL.settled();
  at = centre(circle(tl));
  down(at);
  await sleep(60);
  move({ x: at.x + 12, y: at.y + 2 });
  await sleep(400);
  up({ x: at.x + 12, y: at.y + 2 });
  b.bar.moveWindow = realMove;
  check("a press that moves 5 px within 300 ms moves the window as today, and never lifts", moved === 1 && !b.bar.lift.state && !clone(), { moved });

  log("--- 8. by touch and pen press-and-hold is Windows' context menu: no lift");
  for (const [name, source] of [["touch", 5], ["pen", 2]]) {
    await SL.settled();
    at = centre(circle(tl));
    down(at, { inputSource: source });
    await sleep(420);
    check(`${name}: held 400 ms, nothing lifts`, !b.bar.lift.state && !clone());
    up(at, { inputSource: source });
    await sleep(200);
    if (b.active() !== fn) b.activate(fn);
    await sleep(200);
  }

  log("--- 9. no lift in a window too narrow for split view, nor for Home beside Home");
  await spike.resize(620, 800);
  await sleep(500);
  if (b.bar.item(tl.id)?.querySelector(".circle-face")) {
    at = await hold(tl, 420);
    check("under 648 px a held circle does not lift (no drop zones)", !b.bar.lift.state && !clone());
    up(at);
    await sleep(200);
  } else log("Tideline's circle is not drawn at this width");
  await spike.resize(1440, 900);
  await sleep(500);
  [fn, tl, ln] = await SL.scene(["dark.html"]);
  const h1 = b.newTab();
  await sleep(400);
  b.omni.close();
  const h2 = b.newTab(undefined, { background: true, index: b.tabs.length });
  await sleep(400);
  b.activate(h1);
  await sleep(400);
  if (h2 && circle(h2)) {
    at = await hold(h2, 420);
    check("Home is never paired with Home: a Home circle does not lift while Home is the active tab", !b.bar.lift.state && !clone());
    up(at);
    await sleep(200);
  } else check("set-up: a second Home circle", false);
  b.activate(fn);
  await sleep(300);

  log("--- 10. in F11 a held circle lifts too (spec Auto-hide and F11: drags hold the bar shown); a quick drag moves nothing");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.run("fullscreen");
  await SL.until(() => window.fullScreen && b.root.classList.contains("fullscreen") && b.bar.hidden, 8000);
  await sleep(900);
  const shownBar = b.bar.hold("test", true);
  await sleep(500);
  let movedFs = 0;
  const realMoveFs = b.bar.moveWindow;
  b.bar.moveWindow = () => {
    movedFs++;
    return true;
  };
  await SL.settled();
  at = centre(circle(tl));
  down(at);
  await sleep(60);
  move({ x: at.x + 12, y: at.y + 2 });
  await sleep(400);
  up({ x: at.x + 12, y: at.y + 2 });
  await sleep(300);
  check("F11: a quick drag on a circle moves no window and lifts nothing", movedFs === 0 && !b.bar.lift.state && !clone(), { movedFs });
  b.bar.moveWindow = realMoveFs;
  if (b.active() !== fn) b.activate(fn);
  await sleep(300);
  at = await hold(tl, 420);
  check("F11: a circle held 300 ms lifts", b.bar.lift.state?.tabId === tl.id && !!clone(), b.bar.lift.state);
  const rightFs = { x: Math.round(W() * 0.8), y: Math.round(H() / 2) };
  await glide(at, rightFs);
  await sleep(250);
  up(rightFs);
  await SL.shown();
  p = b.splitView.active();
  check("F11: dropped on the right, split view forms (focus stays on Field Notes)", p?.left === fn && p?.right === tl && b.active() === fn, p && [p.left.title, p.right.title]);
  shownBar();
  await sleep(600);
  b.separate();
  await sleep(300);
  b.run("fullscreen");
  await SL.until(() => !window.fullScreen && !b.root.classList.contains("fullscreen"), 8000);
  await sleep(800);
  await spike.resize(1440, 900);
  await sleep(400);

  log("--- 11. the lift's look in detail: it grows from the circle's resting shadow; Deer's own glyphs stay outlines; the other zone only cross-fades");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  const restShadow = getComputedStyle(b.bar.item(tl.id)).boxShadow;
  at = centre(circle(tl));
  EU.synthesizeMouseAtPoint(at.x, at.y, { type: "mousemove" }, window);
  down(at);
  await SL.until(() => b.bar.lift.state, 1000);
  const grow = clone()?.getAnimations().find((a) => JSON.stringify(a.effect.getKeyframes()).includes("scale(1.08)"));
  const shadow0 = grow?.effect.getKeyframes()[0].boxShadow;
  check("the copy's shadow starts from the circle's resting one (no frame without a shadow), then grows (160 ms)", !!grow && shadow0 === restShadow && shadow0 !== "none" && grow.effect.getTiming().duration === 160, { shadow0, restShadow });
  // The test pages have no favicon: the circle shows Deer's globe, a stroke-only SVG (icons.ts).
  const svgFill = (sel) => {
    const s = document.querySelector(sel);
    return s ? getComputedStyle(s).fill : "no svg";
  };
  check("the lifted copy draws the globe as an outline (fill none), as the bar does", svgFill("#layer-split-lift > .sv-lifted .fav svg") === "none", svgFill("#layer-split-lift > .sv-lifted .fav svg"));
  await glide(at, rightAt);
  await sleep(320);
  check("…and so does the plate (fill none, white strokes)", svgFill("#layer-split-lift .sv-plate.right .sv-plate-fav svg") === "none", svgFill("#layer-split-lift .sv-plate.right .sv-plate-fav svg"));
  await glide(rightAt, leftAt, 8);
  await sleep(10);
  const pl2 = plate("left");
  const reveal2 = pl2?.getAnimations().some((a) => JSON.stringify(a.effect.getKeyframes()).includes("clip"));
  check("over to the other zone (through the middle third): its plate only cross-fades (120 ms), no second reveal", !!pl2 && !reveal2 && pl2.getAnimations().some((a) => a.effect.getTiming().duration === 120), { plate: !!pl2, reveal2 });
  spike.press("Escape");
  up(leftAt);
  await sleep(500);

  log("--- 12. keyboard focus stays where it was: in the page after a drop and after a cancelled lift");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.focusPage();
  await sleep(200);
  check("set-up: keyboard focus in Field Notes' page", document.activeElement === fn.browser);
  at = await hold(tl);
  await glide(at, rightAt);
  await sleep(200);
  up(rightAt);
  await SL.shown();
  await sleep(700);
  check("after a drop keyboard focus is in the focused page (Field Notes), not on the document", b.active() === fn && document.activeElement === fn.browser, document.activeElement?.localName + "." + document.activeElement?.className);
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.focusPage();
  await sleep(200);
  at = await hold(tl);
  await glide(at, { x: W() / 2, y: 500 });
  spike.press("Escape");
  await sleep(80);
  up({ x: W() / 2, y: 500 });
  await sleep(500);
  check("after Esc cancels a lift keyboard focus is back in the page", document.activeElement === fn.browser, document.activeElement?.localName + "." + document.activeElement?.className);

  log("--- 13. only the lifting button ends a lift: a right-click meanwhile neither drops it nor opens a menu");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  at = await hold(tl);
  await glide(at, rightAt);
  await sleep(250);
  down(rightAt, { button: 2, buttons: 3 });
  await sleep(50);
  up(rightAt, { button: 2, buttons: 1 });
  EU.synthesizeMouseAtPoint(rightAt.x, rightAt.y, { type: "contextmenu", button: 2 }, window);
  await sleep(400);
  check("the right button pressed and released with the left held: still lifted over the right zone, no pair, no menu", b.bar.lift.state?.zone === "right" && !b.splitView.active() && !SL.menuOpen(), { lift: b.bar.lift.state, pair: !!b.splitView.active(), menu: SL.labels() });
  SL.closeMenu();
  up(rightAt);
  await SL.shown();
  check("…then releasing the left button drops it", b.splitView.active()?.right === tl);
  await sleep(600);

  log("--- 14. a window that lost focus: no lift after the hold; a lift whose button went up elsewhere ends at the next move");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  at = centre(circle(tl));
  EU.synthesizeMouseAtPoint(at.x, at.y, { type: "mousemove" }, window);
  down(at);
  await sleep(100);
  const other = await spike.openWindow();
  other.focus();
  await sleep(450);
  check("the window lost focus 100 ms into the hold: nothing lifts", !b.bar.lift.state && !clone(), b.bar.lift.state);
  other.close();
  await sleep(400);
  await spike.activate();
  await sleep(200);
  at = await hold(tl);
  check("set-up: lifted", b.bar.lift.state?.tabId === tl.id);
  EU.synthesizeMouseAtPoint(rightAt.x, rightAt.y, { type: "mousemove", buttons: 0 }, window);
  await sleep(80);
  check("a move with no button held (the release went to another window) cancels the lift", !b.bar.lift.state);
  down(rightAt);
  up(rightAt);
  await sleep(500);
  check("…so a later click on the page forms no split", !b.splitView.active());

  log("--- 15. a collapsed pair (a window between 648 and 680 px that has not come back yet): no lift, no drop zones");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(700);
  const inner = async (w, h) => {
    await spike.resize(w + (window.outerWidth - window.innerWidth), h);
    await sleep(600);
  };
  await inner(600, 800);
  await inner(660, 800);
  check("set-up: 660 px wide and still collapsed", window.innerWidth >= 648 && window.innerWidth < 680 && b.splitView.collapsed, { w: window.innerWidth, collapsed: b.splitView.collapsed });
  if (circle(ln)) {
    at = await hold(ln, 420);
    check("a held circle does not lift over a collapsed pair (only its focused side shows)", !b.bar.lift.state && !clone(), b.bar.lift.state);
    up(at);
    await sleep(200);
  } else check("set-up: Links' circle is drawn at 660 px", false);
  await spike.resize(1440, 900);
  await sleep(500);

  log("--- 16. a favicon that is one flat white shape keeps its dark contrast plate in the copy and in the ghost (bar.ts toneOf)");
  const [fn2, flat] = await SL.scene(["flat.html"]);
  const flatFav = await SL.until(() => b.bar.item(flat.id)?.querySelector(".circle-face .fav[data-tone='light']"), 6000);
  check("set-up: on light glass the bar draws Flat Mark's white favicon on its dark plate", !!flatFav && b.root.classList.contains("theme-light") && getComputedStyle(flatFav.querySelector("img")).backgroundColor === "rgb(29, 31, 36)", flatFav && getComputedStyle(flatFav.querySelector("img")).backgroundColor);
  if (flatFav) {
    at = await hold(flat);
    const copyImg = document.querySelector("#layer-split-lift > .sv-lifted .fav img");
    check("the lifted copy keeps the plate (#1D1F24)", !!copyImg && getComputedStyle(copyImg).backgroundColor === "rgb(29, 31, 36)", copyImg && getComputedStyle(copyImg).backgroundColor);
    await glide(at, rightAt);
    await sleep(250);
    up(rightAt);
    await sleep(30);
    const ghostImg = document.querySelector("#vitre-bar > .sv-ghost .g-fav img");
    check("the ghost flying into its half keeps it too", !!ghostImg && getComputedStyle(ghostImg).backgroundColor === "rgb(29, 31, 36)", ghostImg && getComputedStyle(ghostImg).backgroundColor);
    await SL.shown();
    check("set-up: Field Notes | Flat Mark", b.splitView.active()?.left === fn2 && b.splitView.active()?.right === flat);
    await sleep(600);
  }
  log("done");
});
