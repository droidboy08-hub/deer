// The bar's states: hover and press, tooltips, motion (enter, morph, leave, reduced motion), favicon
// plates, many tabs, the close-button setting, the load line, zoom flash.
//   python tests/shell/all.py states      (needs the slow page from all.py's server for the load line)
// Captures: states-hover-circle, states-hover-back, states-hover-plus, states-hover-close-window,
// states-motion-mid, states-plates-light, states-plates-dark, states-30-wide, states-30-1280,
// states-close-always, states-loading.
/* global spike, T, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const $ = (s) => document.querySelector(s);
  const css = (el, prop) => getComputedStyle(el)[prop];
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;
  const settings = b.sys("VitreSettings");
  const tip = () => $("#layer-tips .vitre-tip");
  const tipShown = (el) => waitFor(() => b.bar.tips.shownFor === el && tip().classList.contains("on"), { timeout: 3000, what: "tooltip" });
  const away = async () => {
    T.pointer(640, 400);
    await sleep(80);
  };

  await spike.resize(1280, 800);
  await spike.activate();
  await T.go(T.pages.white);
  await T.tabs(4);

  // ---- 1. hover, press, tooltips ----
  let info = T.bar();
  const circle = info.items[1];
  const face = circle.el.querySelector(".circle-face");
  const badge = circle.el.querySelector(".close-badge");
  check("close badge is not rendered until the circle is hovered", badge.getClientRects().length === 0);
  check("no tooltip before hover; title attributes are not used", tip().hidden && !document.querySelector("#vitre-bar [title]"));
  T.pointer(face);
  await waitFor(() => badge.getClientRects().length > 0 && css(badge, "opacity") === "1", { what: "close badge" });
  const br = T.rect(badge);
  check("hover: circle gets the hover wash, close badge 18x18 at the top right corner (-5, -5)", css(face, "backgroundColor") === "rgba(22, 24, 29, 0.06)" && br.w === 18 && br.h === 18 && near(br.x + 18 - (circle.x + 44), 5) && near(circle.y - br.y, 5), { bg: css(face, "backgroundColor"), br });
  check("close badge: dark disc, white cross, white hairline", css(badge, "backgroundColor") === "rgba(28, 28, 32, 0.88)" && css(badge, "color") === "rgb(255, 255, 255)" && css(badge, "boxShadow").startsWith("rgba(255, 255, 255, 0.7) 0px 0px 0px 1px"), css(badge, "boxShadow"));
  const before = performance.now();
  await tipShown(face);
  const waited = performance.now() - before;
  let tr = T.rect(tip());
  check("tooltip after about 600 ms: the tab's title, 8 px under the bar, centred on the circle", waited > 350 && tip().querySelector(".t").textContent === b.tabs[1].title && tip().querySelector(".k").hidden && tr.y === 64 && near(tr.x + tr.w / 2, circle.x + 22, 1), { waited: Math.round(waited), text: tip().textContent, tr });
  check("tooltip look: 26 px high, radius 8, rgba(28,28,32,.88), white 12 px text", tr.h === 26 && css(tip(), "borderTopLeftRadius") === "8px" && css(tip(), "backgroundColor") === "rgba(28, 28, 32, 0.88)" && css(tip(), "fontSize") === "12px" && css(tip(), "color") === "rgb(255, 255, 255)" && css(tip(), "pointerEvents") === "none", [tr.h, css(tip(), "backgroundColor")]);
  await spike.capture("states-hover-circle");
  spike.EU.synthesizeMouseAtCenter(face, { type: "mousedown" }, window);
  check("press: the press wash; the tooltip goes away", css(face, "backgroundColor") === "rgba(22, 24, 29, 0.1)" && tip().hidden, css(face, "backgroundColor"));
  spike.EU.synthesizeMouseAtPoint(640, 400, { type: "mouseup" }, window);
  await away();
  await waitFor(() => badge.getClientRects().length === 0, { what: "badge to leave" });
  check("leaving the circle hides the badge again and activated nothing", b.activeId === b.tabs[0].id);

  const pill = info.pill.el;
  const backBtn = pill.querySelector(".back");
  T.pointer(backBtn);
  await tipShown(backBtn);
  tr = T.rect(tip());
  check("Back: hover wash and the tip 'Back' with the key as dim text", css(backBtn, "backgroundColor") === "rgba(22, 24, 29, 0.06)" && tip().querySelector(".t").textContent === "Back" && tip().querySelector(".k").textContent === "Alt+Left" && css(tip().querySelector(".k"), "color") === "rgba(255, 255, 255, 0.6)" && css(tip().querySelector(".k"), "backgroundColor") === "rgba(0, 0, 0, 0)" && css(tip().querySelector(".k"), "borderTopWidth") === "0px" && tr.y === 64, { text: tip().textContent, tr, key: css(tip().querySelector(".k"), "color") });
  await spike.capture("states-hover-back");
  const tips = {};
  for (const [name, el] of [["forward", pill.querySelector(".forward")], ["reload", pill.querySelector(".reload")], ["plus", $("#vitre-bar .plus .face")]]) {
    await away();
    T.pointer(el);
    await tipShown(el);
    tips[name] = tip().querySelector(".t").textContent + " | " + tip().querySelector(".k").textContent;
    if (name === "plus") await spike.capture("states-hover-plus");
  }
  check("tips: Forward Alt+Right, Reload Ctrl+R, New tab Ctrl+T", tips.forward === "Forward | Alt+Right" && tips.reload === "Reload | Ctrl+R" && tips.plus === "New tab | Ctrl+T", tips);
  spike.press("Shift");
  check("a key press hides the tooltip", tip().hidden);
  await away();
  const closeWin = document.getElementById("vitre-win-close");
  T.pointer(closeWin);
  await sleep(150);
  check("window Close hover is #c42b1c with a white cross; Minimize hover is the glass wash", css(closeWin, "backgroundColor") === "rgb(196, 43, 28)" && css(closeWin, "color") === "rgb(255, 255, 255)", css(closeWin, "backgroundColor"));
  await spike.capture("states-hover-close-window");
  await away();

  // ---- 2. motion ----
  const tabbox = document.getElementById("tabbrowser-tabbox");
  const oldActive = b.active();
  const oldItem = b.bar.item(oldActive.id);
  // Slow the slide and the settle down for this one change, so a capture can catch it mid-way.
  const slow = document.createElement("style");
  slow.textContent = "#vitre-bar .item { transition-duration: 3s, 3s, 3s, 3s, 0.2s, 0.32s !important; }";
  document.documentElement.append(slow);
  b.bar.settleDelay = 3200;
  await T.go(T.pages.stripesLight);
  const fresh = b.newTab(T.pages.stripesLight);
  const freshItem = b.bar.item(fresh.id);
  const plusLens = $("#vitre-bar .plus > .lens");
  const mid = {
    moving: $("#vitre-bar").classList.contains("moving"),
    rows: document.querySelectorAll("#vitre-bar .row-lens").length,
    freshMorph: freshItem.classList.contains("morphing"),
    oldMorph: oldItem.classList.contains("morphing"),
    frost: css(freshItem.querySelector(":scope > .lens"), "backdropFilter"),
    plain: css(plusLens, "backdropFilter"),
    opacity: Number(css(freshItem, "opacity")),
    width: T.rect(freshItem).w,
    settled: b.bar.state.settled,
  };
  log("motion, right after opening a tab:", mid);
  check("opening a tab: the new item enters (fading in, growing from a circle)", mid.opacity < 1 && mid.width < 480, [mid.opacity, mid.width]);
  check("while the layout moves the row lens is gone and each circle blurs for itself", mid.moving && mid.rows === 0 && mid.plain === "blur(1.4px) saturate(1.5)" && !mid.settled, mid);
  check("the two items that change size carry the morph frost", mid.freshMorph && mid.oldMorph && mid.frost === "blur(10px) saturate(1.6)", mid.frost);
  await sleep(500);
  await spike.capture("states-motion-mid");
  log("motion, at the capture:", { settled: b.bar.state.settled, pillWidth: T.rect(freshItem).w });
  slow.remove();
  b.bar.settleDelay = 440;
  await T.settled();
  await waitFor(() => !fresh.loading, { what: "new tab loaded" });
  await sleep(300);
  info = T.bar();
  check("after 440 ms: lenses for the final layout, no frost left", info.rows.length === 1 && !$("#vitre-bar").classList.contains("moving") && !document.querySelector("#vitre-bar .morphing") && /^url\(/.test(css(freshItem.querySelector(":scope > .lens"), "backdropFilter")) && css(oldItem.querySelector(":scope > .lens"), "backdropFilter") === "none" && T.rect(freshItem).w === 480 && css(freshItem, "opacity") === "1", info.state);
  check("the new tab is the pill, next to the tab it came from", info.pill.el === freshItem && b.tabs.indexOf(fresh) === 1);
  await T.shot("states-motion-after");
  // Close a background tab: it leaves, the others close the gap on the spring.
  const victim = b.tabs[3];
  const victimItem = b.bar.item(victim.id);
  const lastItem = b.bar.item(b.tabs[b.tabs.length - 1].id);
  const lastBefore = T.rect(lastItem).x;
  b.closeTab(victim);
  await sleep(60);
  const sliding = T.rect(lastItem).x;
  check("closing a tab: its item leaves (fades, scales down) and takes no clicks", victimItem.classList.contains("leaving") && victimItem.isConnected && css(victimItem, "pointerEvents") === "none" && b.bar.item(victim.id) === undefined);
  await T.settled();
  await sleep(150);
  const lastAfter = T.rect(lastItem).x;
  check("the neighbours slide into the gap instead of jumping", sliding !== lastBefore && sliding !== lastAfter && !victimItem.isConnected, { lastBefore, sliding, lastAfter });
  // Reduced motion: cross-fades only.
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await waitFor(() => matchMedia("(prefers-reduced-motion: reduce)").matches, { what: "reduced motion" });
  const reducedProp = css(lastItem, "transitionProperty");
  const reducedDur = css(lastItem, "transitionDuration");
  const t0 = performance.now();
  b.activate(b.tabs[0]);
  const jumped = T.rect(b.bar.item(b.tabs[0].id)).w;
  await T.settled();
  const took = performance.now() - t0;
  check("reduced motion: opacity cross-fades of 150 ms only, sizes jump, lenses settle at once", reducedProp === "opacity" && /^0\.15s/.test(reducedDur) && jumped === 480 && took < 420, { reducedProp, reducedDur, jumped, took: Math.round(took) });
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await waitFor(() => !matchMedia("(prefers-reduced-motion: reduce)").matches, { what: "normal motion" });
  check("tab box still carries the filter after all that motion", css(tabbox, "filter").startsWith("saturate"));

  // ---- 3. favicon plates ----
  await T.tabs(1);
  await T.go(T.pages.white);
  const samples = [
    ["white ring", T.ring("#ffffff")],
    ["dark ring", T.ring("#141416")],
    ["pale ring", T.ring("#f1e9a0")],
    ["red ring", T.ring("#e0532f")],
    ["white tile", T.tile("#f4f2ec", "#1b1d21")],
    ["dark tile", T.tile("#1d1f24", "#7df3d0")],
  ];
  for (const [name, icon] of samples) b.newTab(T.page(name, "<body style='background:#fff'>" + name, icon), { background: true, index: b.tabs.length });
  await waitFor(() => b.tabs.length === 7 && b.tabs.every((t) => !t.loading && (t === b.tabs[0] || t.favicon)), { timeout: 15000, what: "favicons" });
  await T.settled();
  await sleep(500);
  const plate = (i) => {
    const fav = b.bar.item(b.tabs[i].id).querySelector(".circle-face .fav");
    const img = fav.querySelector("img");
    return { tone: fav.dataset.tone ?? "ok", bg: img ? css(img, "backgroundColor") : "no img", w: img ? T.rect(img).w : 0 };
  };
  let p = samples.map((_, i) => plate(i + 1));
  log("favicon tones on light glass:", p);
  check("on light glass a flat light icon (white, pale) gets the dark plate; dark and coloured ones and tiles do not", b.theme() === "light" && p[0].tone === "light" && p[0].bg === "rgb(29, 31, 36)" && p[0].w === 18 && p[2].tone === "light" && p[2].bg === "rgb(29, 31, 36)" && p[1].bg === "rgba(0, 0, 0, 0)" && p[3].tone === "ok" && p[3].bg === "rgba(0, 0, 0, 0)" && p[4].tone === "ok" && p[5].tone === "ok" && p[4].w === 18, p);
  await spike.capture("states-plates-light");
  await T.go(T.pages.dark);
  await waitFor(() => b.theme() === "dark", { what: "dark" });
  p = samples.map((_, i) => plate(i + 1));
  check("on dark glass a flat dark icon gets the light plate; the light ones need none", p[1].tone === "dark" && p[1].bg === "rgb(244, 242, 236)" && p[1].w === 18 && p[0].bg === "rgba(0, 0, 0, 0)" && p[2].bg === "rgba(0, 0, 0, 0)" && p[5].bg === "rgba(0, 0, 0, 0)", p);
  await spike.capture("states-plates-dark");

  // ---- 4. many tabs ----
  await T.go(T.pages.stripes);
  await T.tabs(30);
  window.resizeTo(2400, 700);
  window.moveTo(20, 40);
  await sleep(600);
  await T.settled();
  info = T.bar();
  const rowFilters = [...document.querySelectorAll("#vitre-glass-defs filter[id^=vitre-row-]")].map((f) => f.querySelectorAll("feOffset").length);
  log("30 tabs in a", window.innerWidth, "px window:", info.state, "row filters (feOffset nodes):", rowFilters);
  check("30 tabs in a wide window: all drawn at 44 px, the 30 circles split into two row lenses under the node limit", info.state.shown === 30 && info.state.size === 44 && info.rows.length === 2 && rowFilters.length === 2 && Math.max(...rowFilters) === 6 + 4 * 24 && Math.max(...rowFilters) <= 122, { state: info.state, rowFilters });
  await T.shot("states-30-wide");
  await spike.resize(1280, 800);
  await T.settled();
  info = T.bar();
  const rightEdge = Math.max(...info.items.map((i) => i.x + i.w));
  log("30 tabs at 1280:", info.state);
  check("30 tabs at 1280: smallest circles (30 px), the tabs nearest the active one are drawn, nothing under the window controls", info.state.size === 30 && info.state.pill === 220 && info.state.shown < 30 && info.state.shown >= 20 && rightEdge <= info.capsule.x - 16 && info.items[0].x >= 12 && !!info.pill, { state: info.state, rightEdge });
  await T.shot("states-30-1280");
  b.activate(b.tabs[29]);
  await T.settled();
  info = T.bar();
  check("activating a tab that was not drawn brings it into the bar", !!b.bar.item(b.tabs[29].id) && info.pill.el === b.bar.item(b.tabs[29].id) && b.bar.item(b.tabs[0].id) === undefined, info.state);
  b.activate(b.tabs[0]);
  await T.tabs(4);
  await T.go(T.pages.white);

  // ---- 5. close button: always ----
  settings.set({ closeButton: "always" });
  await waitFor(() => $("#vitre-bar").classList.contains("close-always"), { what: "setting" });
  await sleep(250);
  const badges = b.tabs.map((t) => b.bar.item(t.id).querySelector(".close-badge").getClientRects().length);
  check("closeButton 'always': every circle shows its badge, the pill does not", badges.join() === "0,1,1,1", badges);
  await spike.capture("states-close-always");
  settings.set({ closeButton: "hover" });
  await waitFor(() => !$("#vitre-bar").classList.contains("close-always"), { what: "setting back" });

  // ---- 6. load line, Stop, zoom flash, Shift+click Reload ----
  const server = Services.env.get("VITRE_TEST_SERVER");
  if (server) {
    const t = b.active();
    const item = b.bar.item(t.id);
    b.navigate(t, server + "/slow?load");
    await waitFor(() => t.loading && item.classList.contains("loading"), { timeout: 5000, what: "loading state" });
    const line = item.querySelector(".load-line");
    const reload = item.querySelector(".reload");
    const lr = T.rect(line);
    T.pointer(reload);
    await tipShown(reload);
    check("loading: the 2 px accent load line runs along the bottom of the pill, 22 px in from each end", css(line, "animationName") === "vt-load" && css(line, "backgroundColor") === "rgb(76, 194, 255)" && css(line, "height") === "2px" && css(line, "left") === "22px" && css(line, "right") === "22px" && css(line, "bottom") === "0px", { anim: css(line, "animationName"), lr });
    check("loading: Reload becomes Stop, with the tip 'Stop  Esc'", reload.getAttribute("aria-label") === "Stop" && tip().querySelector(".t").textContent === "Stop" && tip().querySelector(".k").textContent === "Esc");
    await spike.capture("states-loading");
    await away();
    spike.click(reload);
    await waitFor(() => !t.loading, { timeout: 5000, what: "stop" });
    check("Stop stops the load: the line and the Stop button go", !item.classList.contains("loading") && reload.getAttribute("aria-label") === "Reload" && css(line, "animationName") === "none");
  } else log("no VITRE_TEST_SERVER: load line step skipped (run through tests/shell/all.py)");
  await T.go(T.pages.white);
  const host = b.bar.item(b.activeId).querySelector(".host");
  b.run("zoomIn");
  await waitFor(() => host.textContent === "110%", { timeout: 3000, what: "zoom flash" });
  check("zooming shows the percentage in the pill for a moment", true);
  b.run("zoomReset");
  await waitFor(() => host.textContent === "100%", { timeout: 3000, what: "zoom reset flash" });
  let hard = 0;
  b.registerAction("hardReload", () => {
    hard++;
    b.builtin("hardReload");
  });
  spike.click(b.bar.item(b.activeId).querySelector(".reload"), { shiftKey: true });
  check("Shift+click on Reload reloads without the cache", hard === 1);
  await sleep(500);

  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
});
