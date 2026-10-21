// Split view with the rest of Deer, the parts phase 1 left untested or undone
// (../design/SPLIT-VIEW-SPEC.md "With the rest of Deer": Prompts and other per-pane surfaces,
// Element full screen; "Accessibility": Forced colours): the link status bubble 12 px in from the
// bottom-left of the pane under the pointer, element full screen from one pane (Firefox's
// inDOMFullscreen rules; Esc returns to the split), and the forced-colours look of the gutter, the
// rims, the focused half, the grip and the drop plate.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const near = (a, c, tol = 2) => Math.abs(a - c) <= tol;
  const status = () => document.getElementById("statuspanel");
  const label = () => document.getElementById("statuspanel-label");
  const bubbleShown = () => !!status() && !status().hidden && !status().hasAttribute("inactive") && !!label()?.value;
  /** Hover a link of a page (window coordinates from its centre) and wait for the status bubble. */
  async function hover(selector, browser) {
    const r = await SL.pageRect(selector, browser);
    SL.mouse(r.cx, r.cy, { type: "mousemove" });
    await SL.until(() => bubbleShown() && status().previousElementSibling === browser, 4000);
    await sleep(250);
    return r;
  }

  log("--- 1. the link status bubble shows in the pane under the pointer");
  let [fn, tl, ln] = await SL.scene(["links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  check("set-up: Field Notes (left) focused, Links (right) beside it", b.active() === fn && b.splitView.active()?.right === tl);
  await hover("#plain", tl.browser);
  const panes = SL.panes();
  const bubble = SL.rect(label());
  check("a link hovered in the unfocused right pane: the bubble is in that pane (after its page)", bubbleShown() && status().previousElementSibling === tl.browser, { prev: status().previousElementSibling?.localName, label: label()?.value });
  check("…12 px in from that pane's bottom-left corner", near(bubble.x, panes.right.x + 12) && near(bubble.b, panes.right.b - 12), { bubble, pane: panes.right });
  check("focus did not move (hover never moves it)", b.active() === fn);
  await spike.capture("extras-1-status-right");
  SL.mouse(700, 450, { type: "mousemove" });
  await sleep(500);
  await hover("#l1", fn.browser);
  const lb = SL.rect(label());
  check("a link hovered in the left pane: the bubble goes back there, 12 px in from its bottom-left", status().previousElementSibling === fn.browser && near(lb.x, SL.panes().left.x + 12) && near(lb.b, SL.panes().left.b - 12), { lb, pane: SL.panes().left });
  await hover("#plain", tl.browser);
  check("set-up: the bubble in the right pane again", status().previousElementSibling === tl.browser);
  SL.mouse(700, 450, { type: "mousemove" });
  await sleep(400);
  b.separate();
  await SL.until(() => !b.splitView.active(), 3000);
  await sleep(200);
  check("the pair ended: the bubble is back after the selected page (Firefox's place)", status().previousElementSibling === gBrowser.selectedBrowser && gBrowser.selectedBrowser === fn.browser, status().previousElementSibling?.localName);
  await hover("#l2", fn.browser);
  const one = SL.rect(label());
  check("one tab: the bubble 12 px from the window's bottom-left, as always", near(one.x, 12) && near(one.b, window.innerHeight - 12), one);
  SL.mouse(700, 450, { type: "mousemove" });
  await sleep(300);

  log("--- 2. element full screen from one pane; Esc returns to the split");
  [fn, tl] = await SL.scene(["fullscreen.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  const fsButton = await SL.pageRect("#fs", tl.browser);
  const pageFs = () => SL.inPage((content, doc) => doc.documentElement.dataset.fs || "", tl.browser);
  SL.mouse(fsButton.cx, fsButton.cy, { type: "mousemove" });
  await sleep(50);
  spike.EU.synthesizeMouseAtPoint(fsButton.cx, fsButton.cy, {}, window);
  await SL.until(async () => (await pageFs()) === "in" && document.documentElement.hasAttribute("inDOMFullscreen"), 8000);
  await sleep(900);
  const root = document.documentElement;
  check("a click in the unfocused pane focuses it, and its element goes full screen (Firefox's inDOMFullscreen)", root.hasAttribute("inDOMFullscreen") && document.fullscreenElement === tl.browser && b.active() === tl, { fs: await pageFs(), active: b.active()?.title });
  const tlBox = SL.panel(tl).getBoundingClientRect();
  // Firefox's rules (content-area.css, :root[inDOMFullscreen]): the selected panel is laid over the
  // whole window; the other stays laid out and live but is hidden visually.
  check("that pane fills the window over the other one; Deer's gutter and split layer are off", Math.round(tlBox.width) === window.innerWidth && tlBox.x === 0 && getComputedStyle(SL.panel(tl)).position === "absolute" && getComputedStyle(document.getElementById("vitre-split")).display === "none" && !["rgb(32, 32, 32)", "rgb(243, 243, 243)"].includes(getComputedStyle(gBrowser.tabpanels).backgroundColor), { w: tlBox.width, x: tlBox.x, pos: getComputedStyle(SL.panel(tl)).position, inner: window.innerWidth });
  check("the pair is kept meanwhile (the other side is not closed or unpaired)", b.splitView.active()?.left === fn && b.splitView.active()?.right === tl && b.tabs.includes(fn));
  check("the hidden pane's page stays active (it keeps its sound)", fn.browser.docShellIsActive === true);
  await spike.capture("extras-2-fullscreen");
  spike.press("Escape");
  await SL.until(() => !root.hasAttribute("inDOMFullscreen") && !document.fullscreenElement, 6000);
  await SL.shown();
  await sleep(900);
  const back = SL.panes();
  check("Esc: back in the split, both panes and the gutter where they were", !!back && near(back.left.w, Math.round((window.innerWidth - 8) / 2), 1) && back.right.x === back.left.r + 8 && document.getElementById("vitre-split").classList.contains("on"), back);
  await spike.capture("extras-3-after-fullscreen");

  log("--- 3. forced colours (a Windows contrast theme)");
  [fn, tl] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  window.browsingContext.forcedColorsOverride = "active";
  const forced = await SL.until(() => window.matchMedia("(forced-colors: active)").matches, 5000);
  check("forced colours can be simulated in the chrome", !!forced);
  if (forced) {
    await sleep(400);
    const canvas = (() => {
      const probe = document.createElement("div");
      probe.style.background = "Canvas";
      document.documentElement.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    })();
    const highlight = (() => {
      const probe = document.createElement("div");
      probe.style.color = "Highlight";
      document.documentElement.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    })();
    check("the gutter is Canvas", getComputedStyle(gBrowser.tabpanels).backgroundColor === canvas, { gutter: getComputedStyle(gBrowser.tabpanels).backgroundColor, canvas });
    const rims = SL.rims();
    const focusedRim = rims.find((r) => r.classList.contains("focused"));
    const otherRim = rims.find((r) => !r.classList.contains("focused"));
    check("the focused pane's rim: 2 px Highlight; the other pane's edge: 1 px CanvasText", !!focusedRim && getComputedStyle(focusedRim).borderTopWidth === "2px" && getComputedStyle(focusedRim).borderTopColor === highlight && !!otherRim && getComputedStyle(otherRim).borderTopWidth === "1px", { f: focusedRim && getComputedStyle(focusedRim).borderTopColor, highlight });
    const plate = SL.half("left").querySelector(".plate");
    check("the focused half: a 2 px Highlight outline", getComputedStyle(plate).outlineStyle === "solid" && getComputedStyle(plate).outlineWidth === "2px", getComputedStyle(plate).outline);
    const d = SL.divider();
    d.focus();
    await sleep(250);
    check("the grip while focused: Highlight", getComputedStyle(d.querySelector(".sp-grip")).backgroundColor === highlight, getComputedStyle(d.querySelector(".sp-grip")).backgroundColor);
    b.focusPage();
    await sleep(200);
    b.separate();
    await sleep(600);
    await SL.settled();
    const circle = b.bar.item(tl.id).querySelector(".circle-face");
    const c = circle.getBoundingClientRect();
    const at = { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    SL.mouse(at.x, at.y, { type: "mousemove" });
    SL.mouse(at.x, at.y, { type: "mousedown" });
    await sleep(400);
    const to = { x: Math.round(window.innerWidth * 0.85), y: 450 };
    for (let i = 1; i <= 6; i++) {
      SL.mouse(at.x + ((to.x - at.x) * i) / 6, at.y + ((to.y - at.y) * i) / 6, { type: "mousemove", buttons: 1 });
      await sleep(30);
    }
    await sleep(400);
    const dropPlate = document.querySelector("#layer-split-lift > .sv-plate.right");
    const mat = dropPlate && getComputedStyle(dropPlate.querySelector(".sv-plate-mat"));
    check("the drop plate: Canvas with a 2 px Highlight outline, no frost", !!dropPlate && mat.backgroundColor === canvas && mat.backdropFilter === "none" && getComputedStyle(dropPlate).outlineWidth === "2px" && getComputedStyle(dropPlate).outlineColor === highlight, dropPlate && { bg: mat.backgroundColor, bf: mat.backdropFilter, outline: getComputedStyle(dropPlate).outline });
    await spike.capture("extras-4-forced-drop");
    spike.press("Escape");
    SL.mouse(to.x, to.y, { type: "mouseup" });
    await sleep(500);
    check("Esc cancelled the lift", !b.bar.lift.state && !b.splitView.active());
  }
  window.browsingContext.forcedColorsOverride = "none";
  await sleep(300);

  log("--- 4. Ctrl+W twice in a row on a pair: both sides close (the second press is the partner's)");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+W");
  spike.press("Ctrl+W");
  await SL.until(() => !b.tabs.includes(fn) && !b.tabs.includes(tl), 3000);
  await sleep(400);
  check("the focused side closed (pictured first) and the second Ctrl+W closed its partner; Links is left", !b.tabs.includes(fn) && !b.tabs.includes(tl) && b.tabs.includes(ln) && !b.splitView.active(), b.tabs.map((t) => t.title));

  log("--- 5. auto-hide: a divider drag keeps a revealed bar shown (spec Auto-hide and F11: drags hold the bar shown)");
  const settings = b.sys("VitreSettings");
  const autoHide = settings.get().barAutoHide;
  settings.set({ barAutoHide: true });
  [fn, tl] = await SL.scene(["dark.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  await SL.until(() => b.bar.hiding, 3000);
  SL.mouse(700, 10, { type: "mousemove" });
  await SL.until(() => !b.bar.hidden, 3000);
  await sleep(300);
  check("set-up: auto-hide on, the bar revealed by the pointer at the top", b.bar.hiding && !b.bar.hidden);
  const gx = SL.panes().left.r + 4;
  SL.mouse(gx, 300, { type: "mousemove" });
  SL.mouse(gx, 300, { type: "mousedown" });
  for (let i = 1; i <= 10; i++) {
    SL.mouse(gx - i * 8, 300 + i * 20, { type: "mousemove", buttons: 1 });
    await sleep(100);
  }
  await sleep(400);
  check("dragging the divider, the pointer far below the bar: the bar stays shown", b.splitView.dragging && !b.bar.hidden, { dragging: b.splitView.dragging, hidden: b.bar.hidden });
  SL.mouse(gx - 80, 500, { type: "mouseup" });
  await SL.until(() => b.bar.hidden, 3000);
  check("released: the bar leaves again", !b.splitView.dragging && b.bar.hidden);
  settings.set({ barAutoHide: autoHide });
  await sleep(400);
  log("done");
});
