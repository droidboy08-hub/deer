// Split view in the bar (../design/SPLIT-VIEW-SPEC.md "Where the bar sits", "Split pill", "Pair
// capsule", "Mixed tint"; boards SplitPill, SplitSpec): the group centred exactly as for one tab at
// every divider position, the split pill's parts, states, names and clicks, the capsule, the mixed
// tint and the window controls' own theme, the give-way to 360.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const W = () => Math.floor(window.innerWidth);
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;

  log("--- 1. the group is centred exactly as for one tab, and never follows the divider");
  let [fn, tl, ln, l2, d2] = await SL.scene(["dark.html", "links.html", "light.html?two", "dark.html?two"]);
  await SL.settled();
  const one = SL.items();
  log("one tab", JSON.stringify(one));
  b.split(tl);
  await SL.shown();
  await sleep(600);
  await SL.settled();
  let pair = SL.items();
  log("pair", JSON.stringify(pair));
  const units = pair.length - 1; // the + is not a unit
  const width = 480 + units * 52; // pill + (other units and the +) x (44 + 8)
  const pillItem = pair.find((x) => x.active);
  check("the split pill is 480 wide and the group (pill, circles, +) is centred in the window as for one tab", pillItem?.pair && pillItem.w === 480 && near(pair[0].x, Math.round((W() - width) / 2)) && near(pair[pair.length - 1].x + 44 - pair[0].x, width), { pair, W: W() });
  check("the joining circle's slot closed up: the group re-centred with one circle fewer", one.length === pair.length + 1 && pair[0].x - one[0].x === 26, { before: one[0].x, after: pair[0].x });
  const at = (r) => {
    b.splitRatio(undefined, r);
    return sleep(300).then(() => SL.items().map((x) => x.x).join(","));
  };
  const x50 = await at(0.5);
  const x33 = await at(0.333);
  const x75 = await at(0.75);
  check("dragging the divider moves only the panes: the bar is identical at 50/50, 1/3 and 3/4", x50 === x33 && x33 === x75, { x50, x33, x75 });
  await at(0.5);

  log("--- 2. the split pill's parts (pill-local, SplitPill board)");
  const item = SL.pairItem();
  const box = SL.rect(item);
  const local = (el) => {
    const r = SL.rect(el);
    return r ? { x: r.x - box.x, w: r.w, y: r.y - box.y, h: r.h } : null;
  };
  const back = local(item.querySelector(".split-face .back"));
  const fwd = local(item.querySelector(".split-face .forward"));
  const left = local(SL.half("left"));
  const right = local(SL.half("right"));
  const mark = local(item.querySelector(".split-face .dl-mark"));
  const reload = local(item.querySelector(".split-face .reload"));
  const acc = local(item.querySelector(".split-face .accessories"));
  log("parts", JSON.stringify({ back, fwd, left, right, mark, reload, acc }));
  check("Back 8..36, Forward 38..66, mark 410..438, Reload 442..470", back.x === 8 && fwd.x === 38 && mark.x === 410 && reload.x === 442 && back.w === 28, { back, fwd, mark, reload });
  check("the halves are equal, from 70 to the extension buttons (or the mark): 170 each without buttons", left.x === 70 && near(left.w, right.w) && near(right.x + right.w, acc.w ? acc.x : 410) && (acc.w ? true : left.w === 170), { left, right, acc });
  const seam = getComputedStyle(SL.half("right"), "::before");
  check("the seam: 1x20 at y 12 at the boundary, in the bar's theme", seam.width === "1px" && seam.height === "20px" && seam.top === "12px", { w: seam.width, h: seam.height, top: seam.top, bg: seam.backgroundColor });
  const plate = SL.half("left").querySelector(".plate");
  const pr = local(plate);
  check("the focused half (left) carries the plate: inset 2 px, y 6..38, radius 16, the light theme's on colours", getComputedStyle(plate).opacity === "1" && pr.x === left.x + 2 && pr.w === left.w - 4 && pr.y === 6 && pr.h === 32 && getComputedStyle(plate).borderTopLeftRadius === "16px" && getComputedStyle(plate).backgroundColor === "rgba(0, 95, 184, 0.1)", { pr, bg: getComputedStyle(plate).backgroundColor, op: getComputedStyle(plate).opacity, theme: b.root.className });
  check("the other half has no plate", getComputedStyle(SL.half("right").querySelector(".plate")).opacity === "0");
  const fav = local(SL.half("left").querySelector(".fav"));
  const host = SL.half("left").querySelector(".host");
  check("a half: favicon 16 px at 14..30 (y 14), host from 38, focused host at weight 500, other at 400", fav.x === left.x + 14 && fav.w === 16 && fav.y === 14 && near(local(host).x, left.x + 38) && getComputedStyle(host).fontWeight === "500" && getComputedStyle(SL.half("right").querySelector(".host")).fontWeight === "400", { fav, host: local(host) });
  check("both sides on one host: the halves show page titles", host.textContent === "Field Notes" && SL.half("right").querySelector(".host").textContent === "Tideline", [host.textContent, SL.half("right").querySelector(".host").textContent]);
  await spike.capture("bar-1-pill-left");

  log("--- 3. names (spec Accessibility)");
  const face = item.querySelector(".split-face");
  const lm = SL.half("left").querySelector(".half-main");
  const rm = SL.half("right").querySelector(".half-main");
  check("the pill is a group named Split view: Field Notes, left; Tideline, right", face.getAttribute("role") === "group" && face.getAttribute("aria-label") === "Split view: Field Notes, left; Tideline, right", face.getAttribute("aria-label"));
  check("focused half: Field Notes, left page, edit address (pressed); other: Tideline, right page (not pressed)", lm.getAttribute("aria-label") === "Field Notes, left page, edit address" && lm.getAttribute("aria-pressed") === "true" && rm.getAttribute("aria-label") === "Tideline, right page" && rm.getAttribute("aria-pressed") === "false", [lm.getAttribute("aria-label"), rm.getAttribute("aria-label")]);
  check("Back, Forward and Reload carry the side", item.querySelector(".split-face .back").getAttribute("aria-label") === "Back, left page" && item.querySelector(".split-face .reload").getAttribute("aria-label") === "Reload, left page");
  check("a half's x: Close right page, Tideline", SL.half("right").querySelector(".half-x").getAttribute("aria-label") === "Close right page, Tideline");

  log("--- 4. hover, clicks");
  SL.mouse(SL.rect(SL.half("right")).x + 40, 34, { type: "mousemove" });
  await sleep(250);
  check("hovering the unfocused half shows its hover plate", getComputedStyle(SL.half("right").querySelector(".plate")).opacity === "1");
  spike.click(rm);
  await SL.until(() => b.active() === tl);
  await sleep(400);
  check("a click on the unfocused half focuses that side and puts focus in its page", b.active() === tl && document.activeElement === tl.browser && !!b.splitView.active(), { active: b.active()?.title, focus: document.activeElement?.localName });
  check("the plate moved to the right half; the bar took the focused page's (dark) theme", SL.half("right").classList.contains("focused") && !SL.half("left").classList.contains("focused") && b.root.classList.contains("theme-dark"), b.root.className);
  await sleep(150);
  check("announced: Right page, Tideline", b.splitView.announced === "Right page, Tideline", b.splitView.announced);
  SL.mouse(10, 400, { type: "mousemove" });
  await sleep(300);
  await spike.capture("bar-2-pill-right");
  spike.click(SL.half("right").querySelector(".half-main"));
  await SL.until(() => b.omni.open);
  check("a click on the focused half opens the address field for that side", b.omni.open && b.omni.input.getAttribute("aria-label") === "Address for the right page" && b.omni.input.value === tl.url, { label: b.omni.input.getAttribute("aria-label"), value: b.omni.input.value });
  await sleep(400);
  await spike.capture("bar-3-field-right");
  b.omni.close();
  await sleep(300);

  log("--- 5. the mixed tint and the window controls' own theme");
  b.activate(fn);
  await sleep(600);
  const rects = SL.panes();
  pair = SL.items();
  const overRight = pair.filter((x) => x.x + x.w > rects.right.x);
  const onlyLeft = pair.filter((x) => x.x + x.w <= rects.left.r);
  check("Field Notes (light) focused beside Tideline (dark): glass over the dark page takes the mixed tint, glass only over the light one does not", overRight.length > 0 && overRight.every((x) => x.mixed) && onlyLeft.every((x) => !x.mixed), pair);
  // The mixed tint is its own layer over the glass's tint, so the two cross-fade (phase 2).
  await sleep(300);
  const mixLayer = getComputedStyle(SL.pairItem().querySelector(":scope > .tint-mix"));
  const tint = mixLayer.backgroundImage;
  const plain = getComputedStyle(SL.pairItem().querySelector(":scope > .tint")).opacity;
  check("the light theme's mixed tint: white 0.70 -> 0.54 (its layer shown, the plain tint hidden)", tint.includes("0.7") && tint.includes("0.54") && mixLayer.opacity === "1" && plain === "0", { tint, mix: mixLayer.opacity, plain });
  const winctl = document.getElementById("vitre-winctl");
  check("the window controls sample the page under them: dark over Tideline while the bar is light", winctl.classList.contains("theme-dark") && b.root.classList.contains("theme-light"), winctl.className);
  await spike.capture("bar-4-mixed");

  log("--- 5b. the mixed tint follows the divider: keys, double-click, a mouse drag (the bar never moves)");
  // Glass over the other page (Tideline, right) takes the mixed tint, and only that glass.
  const mixedRight = () => {
    const pr = SL.panes();
    return SL.items().map((it) => ({ key: it.key, x: it.x, mixed: it.mixed, want: it.x < pr.right.r && it.x + it.w > pr.right.x }));
  };
  const agree = (list) => list.every((x) => x.mixed === x.want);
  const xs0 = SL.items().map((x) => x.x).join(",");
  SL.divider().focus({ focusVisible: true });
  spike.press("End");
  await sleep(300);
  let mx = mixedRight();
  check("End (left pane 0..1112): nothing in the bar is over Tideline any more, so nothing keeps the mixed tint", agree(mx) && mx.every((x) => !x.want), mx);
  spike.press("Home");
  await sleep(300);
  mx = mixedRight();
  check("Home (left pane 0..320): the whole group is over Tideline now, all of it in the mixed tint", agree(mx) && mx.every((x) => x.want), mx);
  check("…and the window controls still take the page under them (Tideline, dark)", winctl.classList.contains("theme-dark"), winctl.className);
  b.focusPage();
  const dv = SL.rect(SL.divider());
  spike.EU.synthesizeMouseAtPoint(dv.x + 4, 600, {}, window);
  spike.EU.synthesizeMouseAtPoint(dv.x + 4, 600, { clickCount: 2 }, window);
  await sleep(300);
  mx = mixedRight();
  check("double-click (50/50): the mixed tint is back on exactly the glass over Tideline", b.splitRatio() === 0.5 && agree(mx) && mx.some((x) => x.want), { ratio: b.splitRatio(), mx });
  const dv2 = SL.rect(SL.divider());
  await SL.drag(SL.divider(), { x: dv2.x + 4, y: 600 }, { x: Math.round(window.innerWidth * 0.75), y: 600 }, 8, { noUp: true });
  const during = mixedRight();
  SL.mouse(Math.round(window.innerWidth * 0.75), 600, { type: "mouseup" });
  await sleep(300);
  mx = mixedRight();
  check("a mouse drag to 3/4: during the drag and after it the mixed tint is on exactly the glass over Tideline", agree(during) && agree(mx), { during, after: mx });
  check("the bar never moved for any of it", SL.items().map((x) => x.x).join(",") === xs0);
  b.splitRatio(undefined, 0.5);
  await sleep(300);
  b.navigate(tl, SL.http("light.html?right"));
  await SL.until(() => SL.loaded(tl, SL.http("light.html?right")), 10000);
  await SL.until(() => tl.theme === "light", 5000);
  await sleep(400);
  check("two light pages: no mixed tint, the controls follow the bar", SL.items().every((x) => !x.mixed) && !winctl.classList.contains("theme-dark"), { items: SL.items(), winctl: winctl.className });

  log("--- 6. the capsule (the pair while another tab is active)");
  b.navigate(tl, SL.http("dark.html"));
  await SL.until(() => SL.loaded(tl, SL.http("dark.html")), 10000);
  b.activate(ln);
  await sleep(700);
  await SL.settled();
  const cap = SL.pairItem();
  const cb = SL.rect(cap);
  const favs = [...cap.querySelectorAll(".capsule-face .fav")].map((f) => SL.rect(f));
  const hair = SL.rect(cap.querySelector(".capsule-face .hair"));
  check("the capsule is 96x44, radius 22: two circles and a gap", cb.w === 96 && cb.h === 44 && getComputedStyle(cap).borderTopLeftRadius === "22px", cb);
  check("18 px favicons centred at x 22 and x 74, a 1x16 hairline at x 48 (y 14)", favs[0].w === 18 && near(favs[0].x + 9 - cb.x, 22) && near(favs[1].x + 9 - cb.x, 74) && hair.w === 1 && hair.h === 16 && near(hair.x - cb.x, 48) && hair.y - cb.y === 14, { favs, hair, cb });
  check("the capsule is named Field Notes and Tideline, split view", cap.querySelector(".capsule-face").getAttribute("aria-label") === "Field Notes and Tideline, split view");
  const items6 = SL.items();
  const active6 = items6.find((x) => x.active);
  const last6 = items6[items6.length - 1];
  check("with a background pair the bar keeps today's coordinates: the capsule is two circles' footprint", items6[0].x === one[0].x && last6.x === one[one.length - 1].x && active6.x === one[0].x + 104, { items6, one });
  await spike.capture("bar-5-capsule");
  spike.click(cap.querySelector(".cap-slot.right .cap-half"));
  await SL.until(() => b.active() === tl);
  await sleep(500);
  check("a click on a capsule favicon shows the pair with that side focused", b.active() === tl && b.splitView.showing()?.right === tl && SL.pairItem().classList.contains("active"), b.active()?.title);

  log("--- 7. give-way: the split pill narrows to 360 before the circles shrink");
  for (let i = 0; i < 6; i++) await SL.tab("links.html?" + i);
  await spike.resize(1000, 800);
  await sleep(800);
  const st = b.bar.state;
  const pill7 = SL.items().find((x) => x.active);
  check("at 1000 px with ten tabs the split pill keeps at least 360", pill7.w >= 360 && pill7.w < 480, { pill: pill7.w, state: st });
  const halves = [SL.rect(SL.half("left")), SL.rect(SL.half("right"))];
  check("the halves narrow equally", near(halves[0].w, halves[1].w), halves);
  await spike.capture("bar-6-give-way");

  log("--- 8. a label that fits at rest but not beside the hover x ends in the fade on hover too");
  await spike.resize(1440, 900);
  await sleep(600);
  b.activate(fn);
  await SL.shown();
  // The pointer away from the bar: "at rest" is not hovered (the bar re-flowed under the last point).
  SL.mouse(10, 600, { type: "mousemove" });
  await sleep(400);
  {
    const lh = SL.half("left");
    const host = lh.querySelector(".host");
    const hw = SL.rect(lh).w;
    const rest = hw - 38 - 12;
    const hover = hw - 38 - 34;
    // The text width of a label in the focused half's style.
    const measure = (text) => {
      const c = host.cloneNode(false);
      c.className = "host";
      c.style.cssText = "right: auto; visibility: hidden;";
      c.textContent = text;
      lh.append(c);
      const w = c.getBoundingClientRect().width;
      c.remove();
      return w;
    };
    const source = "Molten tin bath and the float line at dawn";
    let title = "";
    for (let n = 4; n <= source.length; n++) {
      const w = measure(source.slice(0, n));
      if (w > hover + 4 && w < rest - 4) {
        title = source.slice(0, n).trim();
        break;
      }
    }
    log("half", hw, "rest box", rest, "hover box", hover, "title", title, title && measure(title));
    await SL.inPage((content, doc, t) => {
      doc.title = t;
      return 1;
    }, fn.browser, title);
    await SL.until(() => host.textContent === title, 5000);
    await sleep(300);
    const restMask = lh.matches(":hover") ? "hovered" : getComputedStyle(host).maskImage;
    SL.mouse(SL.rect(lh).x + 60, 30, { type: "mousemove" });
    await sleep(300);
    const hoverMask = getComputedStyle(host).maskImage;
    const xShown = getComputedStyle(lh.querySelector(".half-x")).display !== "none";
    await spike.capture("bar-7-hover-fade");
    SL.mouse(10, 500, { type: "mousemove" });
    await sleep(200);
    check("set-up: a title that fits the half at rest but not beside the x", !!title && host.textContent === title, { title, rest, hover });
    check("at rest it is whole (no fade); on hover, beside the x, it ends in the 12 px fade (SplitPill board)", restMask === "none" && xShown && hoverMask.includes("linear-gradient"), { restMask, hoverMask, xShown });
    await SL.inPage((content, doc) => {
      doc.title = "Field Notes";
      return 1;
    }, fn.browser);
  }

  log("--- 9. a focused Home side keeps Back, Forward and Reload (dimmed), as on the board");
  b.activate(ln);
  await sleep(400);
  b.split("home");
  await SL.until(() => b.active()?.kind === "home" && b.splitView.showing(), 5000);
  await sleep(500);
  b.omni.close();
  await sleep(300);
  {
    const it = document.querySelector("#vitre-bar .item.pair.active:not(.leaving)");
    const box9 = SL.rect(it);
    const part = (sel) => {
      const el = it.querySelector(".split-face " + sel);
      const cs = getComputedStyle(el);
      const r = SL.rect(el);
      return { visible: cs.visibility === "visible" && cs.display !== "none" && r.w > 0, x: r.x - box9.x, disabled: el.getAttribute("aria-disabled"), color: cs.color };
    };
    const back9 = part(".back");
    const fwd9 = part(".forward");
    const rel9 = part(".reload");
    check("Home side focused: Back 8, Forward 38 and Reload 442 are drawn; Back and Forward dimmed (aria-disabled)", back9.visible && fwd9.visible && rel9.visible && back9.x === 8 && fwd9.x === 38 && rel9.x === 442 && back9.disabled === "true" && fwd9.disabled === "true", { back9, fwd9, rel9 });
    await spike.capture("bar-8-home-side");
  }
});
