// Split view's divider (../design/SPLIT-VIEW-SPEC.md "Divider", "Keys", "Accessibility"): the gutter
// as hit area, ew-resize, the grip after a 120 ms rest, a live drag (once per frame), the 320 px
// minimums, the 50/50 magnet, double-click, Esc cancels, the keys, ghost mode, the ratio per pair
// (saved as the column-0 tab's session value).
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const area = () => gBrowser.tabpanels.getBoundingClientRect().width - 8;
  const H = () => window.innerHeight;
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;

  const [fn, tl, ln, l2] = await SL.scene(["dark.html", "links.html", "light.html?two"]);
  b.split(tl);
  await SL.shown();
  await sleep(500);
  const d = SL.divider();
  let panes = SL.panes();

  log("--- 1. the divider is the gutter itself");
  const dr = SL.rect(d);
  check("hit area: the 8 px gutter, full height, ew-resize", dr.x === panes.left.r && dr.w === 8 && dr.y === 0 && dr.h === Math.round(H()) && getComputedStyle(d).cursor === "ew-resize", { dr, panes });
  check("a separator named Split divider, focusable, valuenow 50, min/max from the 320 px minimums, valuetext", d.getAttribute("role") === "separator" && d.getAttribute("aria-label") === "Split divider" && d.tabIndex === 0 && d.getAttribute("aria-valuenow") === "50" && d.getAttribute("aria-valuemin") === String(Math.round((320 / area()) * 100)) && d.getAttribute("aria-valuetext") === "Left page 50 percent", { now: d.getAttribute("aria-valuenow"), min: d.getAttribute("aria-valuemin"), max: d.getAttribute("aria-valuemax") });
  const grip = d.querySelector(".sp-grip");
  check("at rest: no grip", getComputedStyle(grip).opacity === "0");
  SL.mouse(dr.x + 4, 600, { type: "mousemove" });
  await sleep(80);
  check("no grip before the 120 ms rest", !d.classList.contains("hover"));
  await sleep(300);
  const gr = SL.rect(grip);
  check("after the rest: the 4x40 grip, centred on the window's height, in the gutter", d.classList.contains("hover") && gr.w === 4 && gr.h === 40 && gr.x === dr.x + 2 && near(gr.y, Math.round(H() / 2 - 20)), gr);
  await spike.capture("divider-1-hover");

  log("--- 2. a live drag: the panes follow, the bar does not");
  const bar0 = SL.items().map((x) => x.x).join(",");
  const widths = [];
  const watch = new ResizeObserver(() => widths.push(Math.round(SL.panel(fn).getBoundingClientRect().width)));
  watch.observe(SL.panel(fn));
  await SL.drag(d, { x: dr.x + 4, y: 600 }, { x: dr.x + 4 - 300, y: 600 }, 10, { noUp: true });
  check("while dragging: the grip in the accent, the ratio not saved yet", d.classList.contains("dragging") && b.splitView.dragging && getComputedStyle(grip).opacity === "1");
  await spike.capture("divider-2-drag");
  SL.mouse(dr.x + 4 - 300, 600, { type: "mouseup" });
  await sleep(300);
  watch.disconnect();
  panes = SL.panes();
  check("the left pane resized live during the drag (several layouts) and ended 300 px narrower", widths.length >= 3 && near(panes.left.w, dr.x - 300, 2), { widths, left: panes.left.w });
  check("the bar never moved", SL.items().map((x) => x.x).join(",") === bar0);
  check("the ratio is saved on the pair (column-0 tab's session value)", near(b.splitRatio() * area(), panes.left.w, 2) && window.SessionStore.getCustomTabValue(fn.node, "vitre-split-ratio") === b.splitRatio().toFixed(3), { ratio: b.splitRatio(), saved: window.SessionStore.getCustomTabValue(fn.node, "vitre-split-ratio") });
  // A press is not keyboard focus (spec "Divider": the ring is the keyboard's; "Look at rest: no grip").
  await sleep(100);
  SL.mouse(300, 600, { type: "mousemove" });
  await sleep(400);
  check("after a mouse drag keyboard focus is back in the focused page, with no ring and no grip", document.activeElement === fn.browser && !d.classList.contains("focused") && !d.matches(":focus-visible") && getComputedStyle(grip).opacity === "0", { focus: document.activeElement?.localName + "." + document.activeElement?.className, opacity: getComputedStyle(grip).opacity });
  const scroll0 = await SL.inPage((content) => content.scrollY, fn.browser);
  spike.press("Down");
  spike.press("Down");
  await sleep(300);
  const scroll1 = await SL.inPage((content) => content.scrollY, fn.browser);
  check("…so page keys go to the page (Down scrolls it) and leave the divider alone", scroll1 > scroll0 && near(SL.panes().left.w, panes.left.w, 0), { scroll0, scroll1, left: SL.panes().left.w });
  await SL.inPage((content) => content.scrollTo(0, 0), fn.browser);

  log("--- 2b. a pause during a drag of fast pages does not switch it to ghost mode");
  {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    let px = SL.rect(d).x + 4;
    spike.EU.synthesizeMouseAtPoint(px, 600, { type: "mousedown" }, window);
    for (let i = 0; i < 6; i++) {
      px -= 6;
      spike.EU.synthesizeMouseAtPoint(px, 600, { type: "mousemove", buttons: 1 }, window);
      await raf();
    }
    // The hand holds still (reading the page), then the drag goes on.
    await sleep(250);
    for (let i = 0; i < 4; i++) {
      px -= 6;
      spike.EU.synthesizeMouseAtPoint(px, 600, { type: "mousemove", buttons: 1 }, window);
      await raf();
      await raf();
    }
    const mid = { ghost: b.splitView.ghost, divider: SL.rect(d).x, pane: SL.panes().left.r };
    spike.EU.synthesizeMouseAtPoint(px, 600, { type: "mouseup" }, window);
    await sleep(300);
    check("after a 250 ms pause the drag is still live: the pane follows the divider", !mid.ghost && mid.divider === mid.pane, mid);
  }

  log("--- 3. limits: 320 px each side, one magnet at 50/50");
  let x = SL.rect(d).x + 4;
  await SL.drag(d, { x, y: 500 }, { x: 4, y: 500 }, 6);
  check("dragged past the left edge: the left pane stops at 320", SL.panes().left.w === 320, SL.panes());
  x = SL.rect(d).x + 4;
  await SL.drag(d, { x, y: 500 }, { x: area() - 2, y: 500 }, 6);
  check("dragged past the right edge: the right pane stops at 320", SL.panes().right.w === 320, SL.panes());
  x = SL.rect(d).x + 4;
  await SL.drag(d, { x, y: 500 }, { x: area() / 2 + 6 + 4, y: 500 }, 8);
  check("released 6 px from the middle: the magnet makes it exactly 50/50", b.splitRatio() === 0.5 && SL.panes().left.w === Math.round(area() / 2), { ratio: b.splitRatio(), panes: SL.panes() });

  log("--- 4. double-click goes back to 50/50; Esc cancels a drag");
  b.splitRatio(undefined, 0.3);
  await sleep(300);
  // A real double-click: two presses, the second with clickCount 2 (Gecko sends dblclick).
  spike.EU.synthesizeMouseAtCenter(d, {}, window);
  spike.EU.synthesizeMouseAtCenter(d, { clickCount: 2 }, window);
  await sleep(300);
  check("double-click: back to 50/50 in one step", b.splitRatio() === 0.5 && SL.panes().left.w === Math.round(area() / 2), b.splitRatio());
  check("…and keyboard focus stays with the focused page (no ring on the divider)", document.activeElement === fn.browser && !d.classList.contains("focused"), document.activeElement?.localName + "." + document.activeElement?.className);
  b.splitRatio(undefined, 0.4);
  await sleep(300);
  const before = SL.panes().left.w;
  x = SL.rect(d).x + 4;
  await SL.drag(d, { x, y: 500 }, { x: x + 200, y: 500 }, 6, { noUp: true });
  check("mid-drag the pane is wider", SL.panes().left.w > before + 100, SL.panes().left.w);
  spike.press("Escape");
  await sleep(300);
  check("Esc cancels: the divider returns to where the drag started, the ratio is unchanged", !b.splitView.dragging && SL.panes().left.w === before && b.splitRatio() === 0.4, { left: SL.panes().left.w, before, ratio: b.splitRatio() });
  SL.mouse(x + 200, 500, { type: "mouseup" });
  await sleep(200);
  check("the release after Esc changes nothing", SL.panes().left.w === before && b.splitRatio() === 0.4);

  log("--- 5. the keys");
  // Keyboard focus (the divider is a Tab stop between the bar and the page): focus-visible.
  d.focus({ focusVisible: true });
  await sleep(250); // the grip fades in over 120 ms
  check("focused: the accent grip with its 2 px focus ring", d.classList.contains("focused") && getComputedStyle(grip).opacity === "1" && getComputedStyle(grip).outlineWidth === "2px" && getComputedStyle(grip).outlineOffset === "2px");
  let w0 = SL.panes().left.w;
  spike.press("Left");
  await sleep(200);
  check("Left: 16 px", SL.panes().left.w === w0 - 16, [w0, SL.panes().left.w]);
  w0 = SL.panes().left.w;
  spike.press("Shift+Right");
  await sleep(200);
  check("Shift+Right: 64 px", SL.panes().left.w === w0 + 64, [w0, SL.panes().left.w]);
  spike.press("Home");
  await sleep(200);
  check("Home: the left minimum (320)", SL.panes().left.w === 320);
  spike.press("End");
  await sleep(200);
  check("End: the right minimum (320)", SL.panes().right.w === 320);
  spike.press("Enter");
  await sleep(200);
  check("Enter: 50/50", b.splitRatio() === 0.5);
  check("the keys stayed with the divider (no tab action, no page key)", b.active() === fn && b.tabs.length === 4 && document.activeElement === d);
  await spike.capture("divider-3-focus");
  b.focusPage();

  log("--- 6. ghost mode: a slow pane makes the rest of the drag move only the gutter");
  b.splitView.ghostThreshold = 0;
  const w1 = SL.panes().left.w;
  x = SL.rect(d).x + 4;
  await SL.drag(d, { x, y: 500 }, { x: x - 250, y: 500 }, 10, { noUp: true });
  const mid = { ghost: d.classList.contains("ghost"), line: getComputedStyle(d.querySelector(".sp-ghost")).display, divider: SL.rect(d).x, pane: SL.panes().left.w };
  await spike.capture("divider-4-ghost");
  SL.mouse(x - 250, 500, { type: "mouseup" });
  await sleep(300);
  b.splitView.ghostThreshold = 50;
  check("ghost: only the gutter moves (2 px accent line), the pages keep their width until release", mid.ghost && mid.line === "block" && mid.divider < x - 200 && Math.abs(mid.pane - w1) <= 32, mid);
  check("…and on release the pages take the new width", near(SL.panes().left.w, w1 - 250, 2), SL.panes().left.w);

  log("--- 7. the ratio belongs to the pair");
  b.splitRatio(undefined, 0.3);
  await sleep(200);
  b.activate(ln);
  await sleep(300);
  b.split(l2);
  await SL.shown();
  check("a new pair starts at 50/50", b.splitRatio() === 0.5);
  b.splitRatio(undefined, 0.65);
  await sleep(300);
  b.activate(fn);
  await SL.shown();
  await sleep(300);
  check("back to the first pair: its 0.3", b.splitRatio() === 0.3 && near(SL.panes().left.w, Math.round(0.3 * area()), 1), { ratio: b.splitRatio(), left: SL.panes().left.w });
  b.activate(ln);
  await SL.shown();
  await sleep(300);
  check("and the second pair: its 0.65", b.splitRatio() === 0.65 && near(SL.panes().left.w, Math.round(0.65 * area()), 1), { ratio: b.splitRatio(), left: SL.panes().left.w });
  log("--- 8. a window resize keeps the ratio");
  await spike.resize(1200, 860);
  await sleep(500);
  check("at 1200 px the second pair is still 0.65 of the area", near(SL.panes().left.w, Math.round(0.65 * area()), 1) && SL.rect(d).x === SL.panes().left.r, { left: SL.panes().left.w, area: area() });
  log("--- 9. a pair that ends takes its ratio with it");
  b.activate(fn);
  await SL.shown();
  check("set-up: the first pair at 0.3", b.splitRatio() === 0.3, b.splitRatio());
  b.separate();
  await sleep(300);
  b.split(tl);
  await SL.shown();
  await sleep(300);
  check("separated and paired again: 50/50, not the old 0.3", b.splitRatio() === 0.5 && !window.SessionStore.getCustomTabValue(fn.node, "vitre-split-ratio"), b.splitRatio());

  log("--- 10. keyboard focus on the divider is never stranded when the split goes away");
  SL.divider().focus({ focusVisible: true });
  await sleep(150);
  check("set-up: the divider has keyboard focus", document.activeElement === SL.divider());
  spike.press("Ctrl+Shift+U");
  await SL.until(() => !b.splitView.active(), 3000);
  await sleep(300);
  check("Ctrl+Shift+U from the divider: separated, and keyboard focus is in the remaining page (not the window's body)", !b.splitView.active() && document.activeElement === b.active().browser, document.activeElement?.localName + "." + document.activeElement?.className);
  b.split(tl);
  await SL.shown();
  await sleep(300);
  SL.divider().focus({ focusVisible: true });
  await sleep(150);
  b.activate(ln);
  await sleep(500);
  check("another tab from the divider: keyboard focus is in that tab's page", b.active() === ln && document.activeElement === ln.browser, document.activeElement?.localName + "." + document.activeElement?.className);
});
