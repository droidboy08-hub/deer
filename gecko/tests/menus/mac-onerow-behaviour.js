// macOS One row behaviour (boards RowSpec, DirOneRowBehaviour, RowFullScreen, RowFullScreenReveal):
//   python3 tools/run.py --test tests/menus/mac-onerow-behaviour.js --name mac-onerow-behaviour --url about:blank --timeout 200 --pref ui.systemUsesDarkTheme=1
//   python3 tools/run.py --test tests/menus/mac-onerow-behaviour.js --name mac-onerow-behaviour --url about:blank --timeout 200 --pref ui.systemUsesDarkTheme=0
// (run it in both appearances: the row's ink must follow the page, whatever the system's). Structural
// checks, no captures:
//   1. A press that moves 5 px on a background capsule asks for a window move; macOS has none yet
//      (fx.beginWindowMove: false), so the click still selects the tab (src/window/bar.ts watchDrag).
//   2. A normal window (the owner, 2026-11-15: "remove the gray bar like windows"): the window's least
//      width is the row's (src/window/onerow.ts minWindowWidth: 564, private 676); the page fills the
//      window from y 0 under the row and its content starts below the row through the top strip
//      (ROW_AREA 64, src/actors/page/inset.ts); no band lies across the row: the window's drag region
//      is the 18 px strip at the top (#vitre-drag, as on Windows), which paints nothing and stays 18 px
//      zoomed (sizemode maximized, simulated); the capsules
//      (and Downloads, Extensions) carry their own CSS glass and the full shadow; find's landing ring
//      is not cut.
//   3. Window full screen, simulated: the root's inFullscreen attribute (what Firefox's
//      FullScreen.willToggle sets when the system's transition starts) and synthetic
//      MacFullscreenMenubarRevealUpdate events (what Gecko sends while the menu bar slides in). The
//      page starts at y 0, there is no drag strip and the traffic lights' placeholder goes (no haze,
//      nothing moves the window); the row hides as the Windows bar does in F11 (the owner,
//      2026-11-15), whatever the setting, and comes back with the pointer at the top, the first tab at
//      20, with the page under the pointer between its capsules; the menu bar brings it in and moves it
//      down by the overlap, and it stays while the menu bar is down; leaving full screen puts it all
//      back. Over the page the address field carries its own glass and the other capsules keep theirs.
//   4. The row's ink follows the PAGE under it, as the Windows bar's does (browser.ts samples the strip
//      under the row; #vitre-root theme-light / theme-dark): on a light page (#f3eee4) the active
//      capsule's text, the + and the Downloads capsule are dark, on a dark page (#15161a) light,
//      whatever the system's appearance.
//   5. The row's empty space is the page's, as between the Windows bar's items (skin/bar.css "Moving the
//      window"): on a page scrolled under the row, document.elementFromPoint at y 30 between two
//      capsules and between + and the right group, and at y 40 between Downloads and Extensions (below
//      the liquid bridge), is the page (the selected <browser>), at y 6 the drag strip; on the bridge
//      (y 26) it is the Extensions capsule (the bridge is part of it: extensions/css.ts); the strip is
//      drag and 18 px tall, the capsules (a private window's Private capsule too) no-drag, the lights'
//      capsule drag, #vitre-bar and #vitre-row-end click-through; a synthesized
//      hover, click, wheel (3 lines) and right-click at a gap reach the page (it records the move and
//      the click, it scrolls, the PAGE menu opens), and a right-click on a capsule still opens Deer's
//      tab menu.
//   6. A crowded strip still scrolls under the wheel over a capsule.
//   7. Typing in the address capsule: the suggestions hang at 52 (8 px under the capsule).
//   8. Settings › Appearance on a Mac: "Start pages below the tab bar" is there and "Show the tab bar"
//      is not; turning the inset off starts the page at the top, on brings the 64 px strip back (the
//      setting is restored at the end).
// Not driven here: synthesized events act on the DOM, above AppKit, so they neither move the window nor
// zoom it. For a real mouse (the owner's check): dragging the 18 px strip at the top (between the
// capsules and over the empty right part of the row) and the traffic lights' capsule moves the window;
// a double-click there zooms it (or minimises it, as System Settings says); pressing between the
// capsules below the strip does not move the window and reaches the page (a link there opens).
/* global spike, M, InspectorUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, waitFor, log } = spike;
  const EU = spike.EU;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  await spike.resize(1280, 800);
  await M.activate();
  b.sys("VitreSettings").set({ barAutoHide: true });
  await M.load("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>First</title><body style='background:#f3eee4'><h1>First</h1>"));
  b.newTab("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>Second</title><body style='background:#e9f4f3'><h1>Second</h1>"), { background: true });
  await waitFor(() => b.tabs.length === 2 && b.tabs.every((t) => !t.loading), { what: "two tabs loaded" });
  await sleep(800);
  const root = document.documentElement;
  const vr = b.root;
  const panels = document.getElementById("tabbrowser-tabpanels");
  // -moz-window-dragging is chrome-only (servo longhands.toml: enabled_in = "chrome"), and
  // getComputedStyle()/getPropertyValue() look properties up as web content would, so they always
  // report "" for it. Read the winning declaration from the rules that match instead (InspectorUtils
  // lists them least specific first, as devtools' page-style.js notes).
  const dragging = (el) => {
    const find = InspectorUtils.getMatchingCSSRules || InspectorUtils.getCSSStyleRules;
    let value = "";
    for (const rule of find.call(InspectorUtils, el) || []) {
      const m = /(?:^|;)\s*-moz-window-dragging\s*:\s*([\w-]+)/.exec(rule.style?.cssText || "");
      if (m) value = m[1];
    }
    return value;
  };
  // The window's drag strip (skin/shell.css section 4, skin/bar.css "Moving the window").
  const strip = document.getElementById("vitre-drag");
  check("no band across the row (#vitre-row-band is gone) and the drag strip exists", !document.getElementById("vitre-row-band") && !!strip);
  const stripLook = () => {
    const s = getComputedStyle(strip);
    const r = strip.getBoundingClientRect();
    return { appearance: s.appearance, background: s.backgroundColor, image: s.backgroundImage, display: s.display, visibility: s.visibility, pointerEvents: s.pointerEvents, top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
  };
  const clearStrip = (s) => s.appearance === "none" && s.background === "rgba(0, 0, 0, 0)" && s.image === "none";
  const box = (e) => e.getBoundingClientRect();
  const shown = (e) => !!e && e.getClientRects().length > 0 && box(e).width > 0 && getComputedStyle(e).visibility !== "hidden";
  /** Points of the row at height y where no capsule is: between two capsules of the strip, between the last one (+) and the right group (a private window's Private capsule first), between Downloads and Extensions. */
  const rowGaps = (y) => {
    const caps = [...document.querySelectorAll("#vitre-bar .item:not(.leaving)")].filter(shown).map(box).sort((p, q) => p.left - q.left);
    const right = [...document.querySelectorAll("#vitre-row-end > *, #vitre-private")].filter(shown).map(box).sort((p, q) => p.left - q.left);
    const gaps = {};
    for (let i = 1; i < caps.length && !gaps.between; i++) if (caps[i].left - caps[i - 1].right >= 4) gaps.between = { x: Math.round((caps[i - 1].right + caps[i].left) / 2), y };
    if (caps.length && right.length) gaps.beforeEnd = { x: Math.round((caps[caps.length - 1].right + right[0].left) / 2), y };
    const end = [...document.querySelectorAll("#vitre-row-end > *")].filter(shown).map(box).sort((p, q) => p.left - q.left);
    for (let i = 1; i < end.length && !gaps.inEnd; i++) if (end[i].left - end[i - 1].right >= 4) gaps.inEnd = { x: Math.round((end[i - 1].right + end[i].left) / 2), y };
    return gaps;
  };
  const describeEl = (e) => (e ? e.localName + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : "") : null);
  /** What a pointer at p is over: the page (the selected <browser>, or something in the tab panels) or a Deer element. */
  const pageAt = (p) => {
    const e = document.elementFromPoint(p.x, p.y);
    return { ok: !!e && (e === b.active().browser || panels.contains(e)), el: describeEl(e) };
  };

  // 1. Press-drag on a background capsule.
  const first = b.active();
  const other = b.tabs.find((t) => t.id !== first.id);
  const item = b.bar.item(other.id);
  check("background capsule found", !!item);
  if (item) {
    const r = item.getBoundingClientRect();
    const x = r.left + Math.min(18, r.width / 2);
    const y = r.top + r.height / 2;
    const calls = [];
    const saved = b.bar.moveWindow;
    b.bar.moveWindow = (sx, sy) => {
      calls.push([sx, sy]);
      return false;
    };
    try {
      EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
      EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 0 }, window);
      EU.synthesizeMouseAtPoint(x + 8, y, { type: "mousemove", buttons: 1 }, window);
      EU.synthesizeMouseAtPoint(x + 8, y, { type: "mouseup", button: 0 }, window);
      await sleep(400);
    } finally {
      b.bar.moveWindow = saved;
    }
    check("drag: a window move was asked for once", calls.length === 1, calls);
    check("drag: no move started, so the click selected the tab", b.active()?.id === other.id, { active: b.active()?.id, want: other.id });
  }

  // 2. The least window width.
  const minW = getComputedStyle(root).minWidth;
  check("least window width is the row's", minW === (b.isPrivate ? "676px" : "564px"), minW);
  const pageTop = () => Math.round(panels.getBoundingClientRect().top);
  const browserTop = () => Math.round(b.active().browser.getBoundingClientRect().top);
  check("normal window: the page fills the window from the top, under the row", pageTop() === 0 && browserTop() === 0, { panels: panels.getBoundingClientRect().toJSON(), browser: browserTop() });
  const h1 = await M.rectOf("h1", { scroll: false });
  check("normal window: the page's content starts below the row (the 64 px top strip)", !!h1 && h1.y >= 64, h1);
  check("normal window: the drag strip paints nothing (no title-bar material, no fill)", clearStrip(stripLook()), stripLook());
  const s0 = stripLook();
  check("normal window: the drag strip is drawn, full width and 18 px tall at the top, and takes the pointer", s0.display !== "none" && s0.visibility === "visible" && s0.top === 0 && s0.height === 18 && s0.width === Math.round(window.innerWidth) && s0.pointerEvents === "auto", s0);
  const afterStrip = getComputedStyle(strip, "::after");
  check("normal window: no hairline under the strip", afterStrip.content === "none" || afterStrip.content === "normal", afterStrip.content);
  check("the drag strip is the window's drag region", dragging(strip) === "drag", dragging(strip));
  // Zoomed, Windows' maximized strip is 8 px (no resize band there); a Mac has none inside the window
  // at all, so it stays 18 (simulated with the root's sizemode attribute, as Gecko sets it).
  const sizemode = root.getAttribute("sizemode");
  root.setAttribute("sizemode", "maximized");
  const zoomedH = stripLook().height;
  if (sizemode === null) root.removeAttribute("sizemode");
  else root.setAttribute("sizemode", sizemode);
  check("zoomed (sizemode maximized): the drag strip stays 18 px tall", zoomedH === 18, { zoomedH, sizemode });
  const lights = document.getElementById("vitre-win-lights");
  check("normal window: the traffic lights' placeholder is painted at the left of the row", !!lights && getComputedStyle(lights).visibility === "visible" && getComputedStyle(document.getElementById("vitre-winctl")).display !== "none", lights && lights.getBoundingClientRect().toJSON());
  const glassOf = (node) => {
    const lens = node?.querySelector(":scope > .lens");
    const s = lens ? getComputedStyle(lens) : null;
    return { display: s?.display, filter: s?.backdropFilter, shadow: node ? getComputedStyle(node).boxShadow : null };
  };
  const activeGlass = glassOf(b.bar.item(b.active().id));
  check("normal window: the active capsule carries its own glass (blur lens)", activeGlass.display === "block" && /blur\(14px\)/.test(activeGlass.filter || ""), activeGlass);
  check("normal window: the capsules carry the full shadow (0 8 24)", /24px/.test(activeGlass.shadow || ""), activeGlass.shadow);
  const plusGlass = glassOf(document.querySelector("#vitre-bar .item.plus"));
  check("normal window: the + capsule carries its own glass", plusGlass.display === "block" && /blur\(14px\)/.test(plusGlass.filter || ""), plusGlass);
  const endCaps = [...document.querySelectorAll("#vitre-row-end > *")].filter((e) => e.getClientRects().length);
  const endLook = endCaps.map((e) => ({ cls: e.className, filter: getComputedStyle(e).backdropFilter, shadow: getComputedStyle(e).boxShadow }));
  check("normal window: Downloads and Extensions carry the same glass and shadow", endCaps.length >= 1 && endLook.every((x) => /blur\(14px\)/.test(x.filter) && /24px/.test(x.shadow)), endLook);
  const ringLayer = document.getElementById("layer-find-ring");
  const ringClip = () => (ringLayer ? getComputedStyle(ringLayer).clipPath : "none");
  check("normal window: find's landing ring is not cut (the page runs under the row, as on Windows)", ringClip() === "none", ringClip());

  // 3. Window full screen (simulated).
  root.setAttribute("inFullscreen", "true");
  try {
    await waitFor(() => vr.classList.contains("fullscreen"), { what: "fullscreen class" });
    await sleep(700);
    check("full screen: the page starts at the top", pageTop() === 0, panels.getBoundingClientRect().toJSON());
    check("full screen: no drag strip (nothing over the page, nothing moves the window)", getComputedStyle(strip).display === "none", stripLook());
    check("full screen: no traffic-light placeholder", getComputedStyle(document.getElementById("vitre-winctl")).display === "none");
    check("full screen: find's landing ring is not cut (the page starts at 0)", ringClip() === "none", ringClip());
    // As the Windows bar in F11 (reveal.ts): hiding mode, hidden once the pointer is away from the top.
    check("full screen: the row is in hiding mode", b.bar.hiding === true, b.bar.state);
    EU.synthesizeMouseAtPoint(400, 500, { type: "mousemove" }, window);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
    check("full screen, pointer on the page: no bars at the top", b.bar.hidden && vr.classList.contains("bar-hiding") && !vr.classList.contains("bar-revealed"), b.bar.state);
    const endOp = () => Number(getComputedStyle(document.getElementById("vitre-row-end")).opacity);
    await sleep(300);
    check("full screen, hidden: Downloads and Extensions hide with the row", endOp() < 0.05, endOp());
    // The pointer at the top brings it back.
    EU.synthesizeMouseAtPoint(400, 4, { type: "mousemove" }, window);
    await waitFor(() => !b.bar.hidden, { timeout: 2000, what: "row revealed" }).catch(() => {});
    await sleep(400);
    check("full screen, pointer at the top: the row comes back", !b.bar.hidden && vr.classList.contains("bar-revealed"), b.bar.state);
    const lefts = [...document.querySelectorAll("#vitre-bar .item.tab")].map((e) => e.getBoundingClientRect().left);
    check("full screen: the first tab starts at 20", Math.round(Math.min(...lefts)) === 20, lefts);
    // Revealed over the page, the row is the page's between its capsules, as in a normal window.
    // Between Downloads and Extensions at y 40, below the liquid bridge (which is the capsule's).
    const fsGaps = { ...rowGaps(30), inEnd: rowGaps(40).inEnd, top: rowGaps(6).beforeEnd };
    const fsHits = Object.entries(fsGaps).filter(([, p]) => p).map(([name, p]) => ({ name, p, ...pageAt(p) }));
    check("full screen, row revealed: between its capsules (y 30, and y 6) the page is under the pointer", fsHits.length >= 3 && fsHits.every((h) => h.ok), fsHits);
    const lens = b.bar.item(b.active().id)?.querySelector(":scope > .lens");
    check("full screen: capsules carry their own glass", !!lens && getComputedStyle(lens).display !== "none" && getComputedStyle(lens).backdropFilter !== "none", lens && getComputedStyle(lens).backdropFilter);

    // The address field lies over the page too: its own glass, and the other capsules keep theirs.
    b.editAddress();
    await waitFor(() => b.omni.open, { timeout: 2000, what: "address field open" }).catch(() => {});
    await sleep(500);
    const fieldLens = document.querySelector("#vitre-omni-field > .lens");
    const fl = fieldLens ? getComputedStyle(fieldLens) : null;
    check("full screen: the address field carries its own glass", !!fl && fl.display !== "none" && fl.backdropFilter !== "none", fl && { display: fl.display, backdropFilter: fl.backdropFilter });
    const bg = b.tabs.find((t) => t.id !== b.active()?.id);
    const bgLens = bg ? b.bar.item(bg.id)?.querySelector(":scope > .lens") : null;
    const bl = bgLens ? getComputedStyle(bgLens) : null;
    check("full screen: the other capsules keep their glass while the address is edited", !!bl && bl.display !== "none" && bl.visibility === "visible" && bl.backdropFilter !== "none", bl && { display: bl.display, visibility: bl.visibility, backdropFilter: bl.backdropFilter });
    b.omni.close();
    EU.synthesizeMouseAtPoint(400, 500, { type: "mousemove" }, window);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
    check("full screen: the row hides again once the pointer leaves", b.bar.hidden, b.bar.state);

    // The menu bar slides in: it brings the row in and moves it down by the overlap.
    window.dispatchEvent(new CustomEvent("MacFullscreenMenubarRevealUpdate", { detail: 52 }));
    await sleep(100);
    const layer = document.getElementById("layer-bar");
    check("menu bar: the root is marked and carries the overlap", vr.classList.contains("row-shifted") && vr.style.getPropertyValue("--vitre-row-shift") === "52px", vr.style.cssText);
    check("menu bar: the row's layer moves down by it", getComputedStyle(layer).translate === "0px 52px", getComputedStyle(layer).translate);
    check("menu bar: it brings the row in", !b.bar.hidden, b.bar.state);
    // The pointer goes down onto the moved row while the menu bar is down: the row stays.
    EU.synthesizeMouseAtPoint(400, 80, { type: "mousemove" }, window);
    await sleep(900);
    check("menu bar: the row stays under the pointer while the menu bar is down", !b.bar.hidden, b.bar.state);
    window.dispatchEvent(new CustomEvent("MacFullscreenMenubarRevealUpdate", { detail: 0 }));
    await sleep(100);
    check("menu bar gone: the row goes back up", !vr.classList.contains("row-shifted") && getComputedStyle(layer).translate === "none", getComputedStyle(layer).translate);
    EU.synthesizeMouseAtPoint(400, 500, { type: "mousemove" }, window);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
    check("full screen: the row hides with the pointer far below", b.bar.hidden, b.bar.state);
    // As F11 on Windows: full screen hides the row whatever the auto-hide setting.
    b.sys("VitreSettings").set({ barAutoHide: false });
    await sleep(300);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
    check("full screen: the row hides with the auto-hide setting off too", b.bar.hiding === true && b.bar.hidden, b.bar.state);
    b.sys("VitreSettings").set({ barAutoHide: true });
  } finally {
    root.removeAttribute("inFullscreen");
  }
  await waitFor(() => !vr.classList.contains("fullscreen"), { what: "fullscreen class gone" });
  await sleep(700);
  check("after full screen: the page still starts at the top", pageTop() === 0, panels.getBoundingClientRect().toJSON());
  check("after full screen: the drag strip is drawn again, 18 px, and still paints nothing", clearStrip(stripLook()) && stripLook().display !== "none" && stripLook().height === 18, stripLook());
  check("after full screen: the strip is the drag region again", dragging(strip) === "drag", dragging(strip));
  check("after full screen: the row is not hiding", b.bar.hiding === false, b.bar.state);
  const lefts = [...document.querySelectorAll("#vitre-bar .item.tab")].map((e) => e.getBoundingClientRect().left);
  check("after full screen: the first tab starts at 96 again", Math.round(Math.min(...lefts)) === 96, lefts);
  await sleep(400);
  const h1Again = await M.rectOf("h1", { scroll: false });
  check("after full screen: the page's content starts below the row again (the top strip is back)", !!h1Again && h1Again.y >= 64, h1Again);

  // 4. The row's ink follows the page under it, whatever the system's appearance.
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  log("system appearance: " + (systemDark ? "dark" : "light"));
  const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (c) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const inks = () => {
    const item = b.bar.item(b.active().id);
    const host = item?.querySelector(".address .host") || item?.querySelector(".address");
    const plus = document.querySelector("#vitre-bar .item.plus .face");
    const ring = document.querySelector("#vitre-row-end > .vd-ring");
    return {
      theme: ["light", "dark", "clear"].find((t) => vr.classList.contains("theme-" + t)),
      active: host ? getComputedStyle(host).color : null,
      plus: plus ? getComputedStyle(plus).color : null,
      downloads: ring ? getComputedStyle(ring).color : null,
      fill: item ? getComputedStyle(item.querySelector(":scope > .tint")).backgroundColor : null,
    };
  };
  const page = (bg, fg) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>Ink ${bg}</title><body style='margin:0;background:${bg};color:${fg};font:17px Georgia'><h1 style='margin:40px'>Ink</h1>` + "<p style='margin:0 40px 14px'>A ribbon of glass floats on molten tin.</p>".repeat(30));
  await M.load(page("#f3eee4", "#1d1d1f"), 300);
  await waitFor(() => vr.classList.contains("theme-light"), { timeout: 6000, what: "light theme from the page" }).catch(() => {});
  await sleep(300);
  const light = inks();
  check("light page (#f3eee4): the row samples it as light", light.theme === "light", light);
  check("light page: the active capsule's text is dark", luminance(light.active) < 0.1, light);
  check("light page: the + and the Downloads capsule are dark too", luminance(light.plus) < 0.2 && (light.downloads === null || luminance(light.downloads) < 0.1), light);
  // Scrolled: the strip under the row is still the page's (its content now runs under the capsules).
  await M.inContent(b.active().browser, (content) => content.scrollTo(0, 400));
  await sleep(700);
  check("light page, scrolled under the row: the ink stays dark", vr.classList.contains("theme-light") && luminance(inks().active) < 0.1, inks());
  await M.load(page("#15161a", "#e8e8ea"), 300);
  await waitFor(() => vr.classList.contains("theme-dark"), { timeout: 6000, what: "dark theme from the page" }).catch(() => {});
  await sleep(300);
  const dark = inks();
  check("dark page (#15161a): the row samples it as dark", dark.theme === "dark", dark);
  check("dark page: the active capsule's text is light", luminance(dark.active) > 0.8, dark);
  check("dark page: the + and the Downloads capsule are light too", luminance(dark.plus) > 0.6 && (dark.downloads === null || luminance(dark.downloads) > 0.8), dark);
  // And back: the ink is the page's again, not the system's.
  await M.load(page("#f3eee4", "#1d1d1f"), 300);
  await waitFor(() => vr.classList.contains("theme-light"), { timeout: 6000, what: "light theme again" }).catch(() => {});
  await sleep(300);
  check("light page again: the active capsule's text is dark again", luminance(inks().active) < 0.1, inks());

  // 5. The row's empty space is the page's (skin/bar.css "Moving the window"). The person's real
  // pointer over the window would add moves of its own (tests/split/slib.js).
  window.windowUtils.disableNonTestMouseEvents(true);
  const gapPage =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      "<!doctype html><title>Gap</title><body style='margin:0;background:#f3eee4;color:#1d1d1f;font:17px Georgia'><h1 style='margin:0 40px 12px'>Gap</h1>" +
        "<p style='margin:0 40px 14px'>A ribbon of glass floats on molten tin until it is flat on both faces.</p>".repeat(120) +
        "<script>const d = document.documentElement; addEventListener('mousemove', (e) => { d.dataset.move = Math.round(e.clientX) + ',' + Math.round(e.clientY); }); addEventListener('click', (e) => { d.dataset.click = Math.round(e.clientX) + ',' + Math.round(e.clientY); });</script>"
    );
  const near = (v, q) => {
    const [x, y] = String(v).split(",").map(Number);
    return Math.abs(x - q.x) <= 1 && Math.abs(y - q.y) <= 1;
  };
  const settings = b.service("settings");
  const savedInset = b.settings.pageInset;
  const extra = [];
  try {
    await M.load(gapPage, 400);
    const br = b.active().browser;
    const read = (key) => M.inContent(br, (content, k) => content.document.documentElement.dataset[k] || "", key);
    const scrollY = () => M.inContent(br, (content) => content.scrollY);
    await M.inContent(br, (content) => content.scrollTo(0, 400));
    await sleep(700);
    const gaps = rowGaps(30);
    log("row gaps at y 30: " + JSON.stringify(gaps));
    check("the row has gaps at y 30: between two capsules, before the right group, between Downloads and Extensions", !!gaps.between && !!gaps.beforeEnd && !!gaps.inEnd, gaps);
    for (const name of ["between", "beforeEnd"]) {
      const p = gaps[name];
      const hit = p ? pageAt(p) : { ok: false, el: null };
      check("gap (" + name + ") at y 30: the page is under the pointer, not Deer", hit.ok, { p, hit: hit.el });
    }
    // Between Downloads and Extensions the liquid bridge is painted across the gap's middle (y 20.5 to
    // 31.5: extensions/css.ts): it is part of the Extensions capsule and takes the pointer; below it
    // (and above, in the drag strip) the gap is the page's.
    const mid = rowGaps(26).inEnd;
    const onBridge = mid ? document.elementFromPoint(mid.x, mid.y) : null;
    check("the bridge between Downloads and Extensions (y 26): the Extensions capsule takes the pointer, not the page", !!onBridge && !!onBridge.closest("#vitre-row-end > .vd-ring + .vx-rowcap"), { p: mid, hit: describeEl(onBridge) });
    const low = rowGaps(40).inEnd;
    const lowHit = low ? pageAt(low) : { ok: false, el: null };
    check("gap (inEnd) at y 40, below the bridge: the page is under the pointer, not Deer", lowHit.ok, { p: low, hit: lowHit.el });
    const high = rowGaps(6);
    const stripHits = [high.between, high.beforeEnd].filter(Boolean).map((p) => describeEl(document.elementFromPoint(p.x, p.y)));
    check("gaps at y 6: the drag strip is under the pointer", stripHits.length === 2 && stripHits.every((h) => h === "div#vitre-drag"), stripHits);
    check("the drag strip: a drag region, 18 px tall", dragging(strip) === "drag" && stripLook().height === 18, { dragging: dragging(strip), look: stripLook() });
    const capsules = [...document.querySelectorAll("#vitre-bar .item:not(.leaving), #vitre-row-end > *, #vitre-private")].filter(shown);
    const capDrag = capsules.map((e) => [describeEl(e), dragging(e)]);
    check("the capsules are no-drag (the strip under them does not move the window)" + (b.isPrivate ? ", the Private capsule too" : ""), capsules.length >= 4 && capDrag.every(([, d]) => d === "no-drag") && (!b.isPrivate || capsules.some((e) => e.id === "vitre-private")), capDrag);
    const winctl = document.getElementById("vitre-winctl");
    check("the lights' capsule is still a drag region", shown(winctl) && dragging(winctl) === "drag", dragging(winctl));
    const through = ["vitre-bar", "vitre-row-end"].map((id) => {
      const e = document.getElementById(id);
      return { id, pointerEvents: getComputedStyle(e).pointerEvents, dragging: dragging(e) };
    });
    check("#vitre-bar and #vitre-row-end are click-through and no drag region between their capsules", through.every((x) => x.pointerEvents === "none" && x.dragging !== "drag"), through);

    const p = gaps.beforeEnd;
    // Hover: the page gets the move.
    M.mouse(p.x, p.y, { type: "mousemove" });
    const move = await waitFor(async () => (near(await read("move"), p) ? read("move") : ""), { timeout: 3000, what: "the page's mousemove" }).catch(() => "");
    check("hover at a gap (" + p.x + ", " + p.y + "): the page gets the move", !!move, { p, move: move || (await read("move")) });
    // Click: it lands in the page.
    M.mouse(p.x, p.y, { type: "mousedown", button: 0 });
    M.mouse(p.x, p.y, { type: "mouseup", button: 0 });
    const click = await waitFor(async () => (near(await read("click"), p) ? read("click") : ""), { timeout: 3000, what: "the page's click" }).catch(() => "");
    check("click at a gap: it lands in the page", !!click, { p, click: click || (await read("click")) });
    // The wheel (3 lines): the page scrolls.
    const y0 = await scrollY();
    spike.EU.synthesizeWheelAtPoint(p.x, p.y, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }, window);
    const y1 = await waitFor(async () => ((await scrollY()) > y0 + 10 ? scrollY() : 0), { timeout: 5000, what: "the page scrolled" }).catch(() => 0);
    check("wheel at a gap (3 lines down): the page scrolls", y1 > y0, { y0, y1: y1 || (await scrollY()) });
    // And between two capsules too.
    const q = gaps.between;
    const y2 = await scrollY();
    spike.EU.synthesizeWheelAtPoint(q.x, q.y, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }, window);
    const y3 = await waitFor(async () => ((await scrollY()) > y2 + 10 ? scrollY() : 0), { timeout: 5000, what: "the page scrolled" }).catch(() => 0);
    check("wheel between two capsules (3 lines down): the page scrolls", y3 > y2, { q, y2, y3: y3 || (await scrollY()) });
    // Right-click: the PAGE's menu, on the scrolled page.
    const before = M.last().pageMenus;
    M.rightClick(p.x, p.y);
    let open = await M.waitOpen();
    if (!open) {
      log("page menu at the gap: not open after one right-click, trying once more");
      await sleep(600);
      M.rightClick(p.x, p.y);
      open = await M.waitOpen();
    }
    const rows = open ? M.labels() : [];
    log("page menu at the gap: " + JSON.stringify(rows));
    check("right-click at a gap on the scrolled page: the PAGE menu opens", open && M.last().kind === "page" && M.last().pageMenus > before && rows.includes("Reload") && rows.some((l) => /^Save page as/.test(l)), { open, kind: M.last().kind, rows });
    if (open) {
      M.key("KEY_Escape");
      await M.waitClosed();
    }
    // Over a capsule a right-click still opens Deer's own tab menu.
    const bgTab = b.tabs.find((t) => t.id !== b.active().id);
    const cap = bgTab && b.bar.item(bgTab.id);
    if (cap) {
      const r = box(cap);
      M.rightClick(r.left + Math.min(18, r.width / 2), r.top + r.height / 2);
      const tabMenu = await M.waitOpen();
      const tabRows = tabMenu ? M.labels() : [];
      check("right-click on a capsule: Deer's tab menu opens, not the page's", tabMenu && M.last().kind === "chrome" && tabRows.includes("Close tab"), { kind: M.last().kind, rows: tabRows });
      if (tabMenu) {
        M.key("KEY_Escape");
        await M.waitClosed();
      }
    } else check("a background capsule to right-click", false, b.tabs.length);
    M.mouse(400, 500, { type: "mousemove" });
    await sleep(500);

    // 6. A crowded strip still scrolls under the wheel over a capsule.
    for (let i = 0; i < 24; i++) extra.push(b.newTab("about:blank", { background: true }));
    const host = document.getElementById("vitre-bar");
    await waitFor(() => host.classList.contains("overflow"), { timeout: 8000, what: "the strip overflows" }).catch(() => {});
    await sleep(800);
    const row = b.bar.place.row;
    check("crowded (26 tabs): the strip overflows", host.classList.contains("overflow") && !!row?.overflow, { cls: host.className, row });
    if (row?.overflow) {
      const mid = [...host.querySelectorAll(".item.tab:not(.active):not(.leaving)")].filter(shown).find((e) => {
        const r = box(e);
        return r.left > row.left + 60 && r.right < row.right - 60;
      });
      const sx0 = b.bar.scrollX;
      const lines = sx0 < row.overflow / 2 ? 3 : -3;
      if (mid) {
        const r = box(mid);
        spike.EU.synthesizeWheelAtPoint(r.left + r.width / 2, r.top + r.height / 2, { deltaY: lines, deltaMode: WheelEvent.DOM_DELTA_LINE }, window);
      }
      const moved = await waitFor(() => b.bar.scrollX !== sx0, { timeout: 3000, what: "the strip scrolled" }).catch(() => false);
      check("crowded: the wheel over a capsule scrolls the strip", !!mid && !!moved, { sx0, sx1: b.bar.scrollX, overflow: row.overflow, lines, capsule: !!mid });
    }
    for (const t of extra.splice(0)) b.closeTab(t);
    await waitFor(() => b.tabs.length === 2, { timeout: 8000, what: "the extra tabs closed" }).catch(() => {});
    await sleep(900);

    // 7. The address suggestions hang 8 px under the capsule, at 52.
    b.editAddress("deer");
    await waitFor(() => b.omni.open, { timeout: 3000, what: "address field open" }).catch(() => {});
    const panel = document.getElementById("vitre-omni-panel");
    await waitFor(() => shown(panel) && box(panel).height > 20, { timeout: 3000, what: "suggestions shown" }).catch(() => {});
    await sleep(400);
    const pr = panel ? box(panel) : null;
    check("typing in the address capsule: the suggestions' top is 52 (8 px under the capsule)", !!pr && shown(panel) && Math.abs(pr.top - 52) <= 1, pr && { top: pr.top, left: pr.left, width: pr.width, styleTop: panel.style.top });
    b.omni.close();
    await sleep(400);

    // 8. Settings › Appearance on a Mac: the page inset is there, "Show the tab bar" is not.
    b.sys("VitreSettings").set({ pageInset: true });
    await M.inContent(br, (content) => content.scrollTo(0, 0));
    await sleep(600);
    settings.open("appearance");
    await waitFor(() => document.querySelector("#vitre-settings .vs-content")?.dataset.page === "appearance", { timeout: 4000, what: "Settings › Appearance" }).catch(() => {});
    await sleep(700);
    const main = document.querySelector("#vitre-settings .vs-main");
    const text = main?.textContent ?? "";
    check("Settings › Appearance on a Mac: 'Start pages below the tab bar' is shown, 'Show the tab bar' and App icon are not", text.includes("Start pages below the tab bar") && !text.includes("Show the tab bar") && !text.includes("App icon"), text.slice(0, 400));
    const insetRow = main ? [...main.querySelectorAll(".vs-row")].find((e) => e.textContent.includes("Start pages below the tab bar")) : null;
    const sw = insetRow?.querySelector("[role='switch']");
    check("the inset row has its switch, on", !!sw && sw.getAttribute("aria-checked") === "true", sw && sw.getAttribute("aria-checked"));
    const h1At = async () => {
      const r = await M.rectOf("h1", { scroll: false });
      return r ? Math.round(r.y) : null;
    };
    if (sw) {
      sw.click();
      await waitFor(() => b.settings.pageInset === false, { timeout: 3000, what: "pageInset off" }).catch(() => {});
      const off = await waitFor(async () => {
        const y = await h1At();
        return y !== null && y < 30 ? String(y) : "";
      }, { timeout: 6000, what: "the strip gone" }).catch(() => "");
      check("inset off (its switch): the page's content starts at the top (h1 well above 64)", !!off && b.settings.pageInset === false, { h1: off || (await h1At()), pageInset: b.settings.pageInset });
      sw.click();
      await waitFor(() => b.settings.pageInset === true, { timeout: 3000, what: "pageInset on" }).catch(() => {});
      const on = await waitFor(async () => {
        const y = await h1At();
        return y !== null && y >= 64 ? String(y) : "";
      }, { timeout: 6000, what: "the strip back" }).catch(() => "");
      check("inset on again: the 64 px strip is back (h1 >= 64)", !!on && b.settings.pageInset === true, { h1: on || (await h1At()), pageInset: b.settings.pageInset });
    }
  } finally {
    for (const t of extra.splice(0)) b.closeTab(t);
    b.sys("VitreSettings").set({ pageInset: savedInset });
    if (settings?.isOpen()) settings.close();
    window.windowUtils.disableNonTestMouseEvents(false);
  }
  log({ done: true });
});
