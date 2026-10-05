// Switcher verification: the switcher against the core and the other modules. The address field
// open, find open, the Settings panel, a peek, a Vitre menu, the Esc and Ctrl+W ladders, F11,
// element full screen and the auto-hidden bar; console errors throughout.
// python tools/run.py --test tests/switcher-verify/ladders.js --name swverify-ladders --app build-switcher-verify --timeout 300
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const names = ["Alpha", "Bravo", "Charlie", "Delta"];
  const colours = ["#f4f1ea", "#dfe9f3", "#f3e0e0", "#e2f0df"];
  await V.openTabs(names.map((n, i) => V.page(n, colours[i], "<input id=f style='margin:0 60px;font:20px Segoe UI'>")));
  const byName = (n) => b.tabs.find((t) => t.title === n);
  const MRU = ["Delta", "Charlie", "Bravo", "Alpha"];
  const reset = async () => {
    // Put back any of the four that a step closed.
    const missing = names.filter((n) => !byName(n));
    const made = missing.map((n) => b.newTab(V.page(n, colours[names.indexOf(n)], "<input id=f style='margin:0 60px;font:20px Segoe UI'>"), { background: true, index: names.indexOf(n) }));
    await Promise.all(made.map((t) => V.loaded(t)));
    if (made.length) await waitFor(() => names.every((n) => byName(n)), { what: "tabs back" });
    await V.visit(MRU.map(byName));
    b.focusPage();
    await sleep(200);
  };
  const pageFocused = () => document.activeElement === b.active()?.browser;
  await reset();

  // ---- 1. the address field is open ----
  log("--- address field");
  b.editAddress();
  await sleep(300);
  spike.type("hello");
  await sleep(200);
  const omniBefore = b.omni.open;
  down("Control");
  await sleep(20);
  press("Tab");
  await waitFor(() => state().phase === "open", { what: "open over the address field" });
  await sleep(500);
  const omniDuring = b.omni.open;
  await spike.capture("ladders-over-address-field");
  await V.release();
  await sleep(300);
  check("address field open: Ctrl+Tab held closes the field, release opens the previous tab with focus in its page", omniBefore && !omniDuring && !b.omni.open && V.active() === "Bravo" && pageFocused(), { omniBefore, omniDuring, active: V.active(), focus: document.activeElement?.localName });
  await reset();
  b.editAddress();
  await sleep(300);
  spike.type("abc");
  down("Control");
  await sleep(20);
  press("Tab");
  await sleep(40);
  up("Control");
  await sleep(500);
  check("address field open: a quick tap switches to the previous tab, field closed, focus in the page", V.active() === "Bravo" && !b.omni.open && state().phase === "idle" && pageFocused(), { active: V.active(), omni: b.omni.open, focus: document.activeElement?.localName });
  await reset();

  // ---- 1b. the glass theme while the switcher covers the page ----
  log("--- glass theme");
  const theme = () => ["light", "dark", "clear"].find((t) => b.root.classList.contains("theme-" + t));
  const pageTheme = theme();
  const seen = {};
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    await V.holdOpen(1);
    await sleep(300);
    seen[style] = theme();
    if (style === "grid") {
      const input = document.querySelector("#layer-switcher .sw-input");
      seen.caretHeld = getComputedStyle(input).caretColor;
      press("G", { ctrlKey: true }); // types g: latched
      await sleep(150);
      seen.caretLatched = getComputedStyle(input).caretColor;
      press("Escape"); // latched: Esc cancels
      up("Control");
      await V.closed();
    } else {
      press("Shift+Tab");
      await sleep(80);
      await V.release();
    }
    seen[style + "-after"] = theme();
  }
  await V.setStyle("deck");
  check("grid held: the field shows no caret until the first character latches it (SwitcherKeys)", seen.caretHeld === "rgba(0, 0, 0, 0)" && seen.caretLatched === "rgb(76, 194, 255)", { held: seen.caretHeld, latched: seen.caretLatched });
  check("over a light page the window controls are clear glass while the deck or grid is up, the page's glass with the strip, and the page's again after", pageTheme === "light" && seen.deck === "clear" && seen.grid === "clear" && seen.strip === "light" && seen["deck-after"] === "light" && seen["grid-after"] === "light", { pageTheme, seen });
  await reset();

  // ---- 2. find is open ----
  log("--- find");
  const find = b.service("find");
  if (find) {
    find.open({ query: "Alpha" });
    await sleep(600);
    const findOpen = find.isOpen();
    press("Shift+A", { ctrlKey: true });
    await waitFor(() => state().phase === "open", { what: "search over find" });
    await sleep(400);
    press("Escape");
    await V.closed();
    check("find open: Esc in the latched switcher closes only the switcher; find stays open", findOpen && find.isOpen() && V.active() === "Alpha", { findOpen, now: find.isOpen() });
    await V.holdOpen(1);
    await V.release();
    await sleep(400);
    check("find open on Alpha: Ctrl+Tab to Bravo works", V.active() === "Bravo", V.active());
    b.activate(byName("Alpha"));
    await sleep(400);
    find.close();
    await sleep(300);
    await reset();
  } else log("no find service in this build");

  // ---- 3. the Settings panel ----
  log("--- settings panel");
  const settings = b.service("settings");
  if (settings) {
    settings.open("tabs");
    await waitFor(() => settings.isOpen(), { what: "settings open" });
    await sleep(700);
    for (const style of ["deck", "strip"]) {
      b.sys("VitreSettings").set({ switcherStyle: style });
      await sleep(200);
      press("Shift+A", { ctrlKey: true });
      await waitFor(() => state().phase === "open", { what: "switcher over settings" });
      await sleep(700);
      await spike.capture(`ladders-over-settings-${style}`);
      press("Escape");
      await V.closed();
      check(`settings open (${style}): Esc closes the latched switcher first, the panel stays`, settings.isOpen() && state().phase === "idle", { open: settings.isOpen() });
    }
    b.sys("VitreSettings").set({ switcherStyle: "deck" });
    await sleep(200);
    b.escape();
    await sleep(600);
    check("... and the next Esc closes the panel", !settings.isOpen(), settings.isOpen());
    await reset();
  } else log("no settings service in this build");

  // ---- 4. a peek ----
  log("--- peek");
  const peek = b.service("peek");
  if (peek) {
    peek.open("https://example.com/");
    await waitFor(() => peek.isOpen(), { timeout: 6000, what: "peek open" }).catch(() => null);
    await sleep(900);
    const peekOpen = peek.isOpen();
    const n0 = b.tabs.length;
    press("Shift+A", { ctrlKey: true });
    await waitFor(() => state().phase === "open", { what: "switcher over peek" });
    await sleep(500);
    press("Right");
    await sleep(100);
    const doomed = V.sel();
    press("W", { ctrlKey: true });
    await sleep(500);
    check("peek open: Ctrl+W in the switcher closes the selected card, never the peek", peekOpen && peek.isOpen() && b.tabs.length === n0 - 1 && !byName(doomed) && state().phase === "open", { peekOpen, peekNow: peek.isOpen(), tabs: b.tabs.length, n0, doomed });
    await spike.capture("ladders-over-peek");
    press("Escape");
    await V.closed();
    check("peek open: Esc closes the switcher, the peek stays", peek.isOpen(), peek.isOpen());
    press("W", { ctrlKey: true });
    await sleep(800);
    check("... then Ctrl+W closes the peek, not the tab", !peek.isOpen() && b.tabs.length === n0 - 1, { peek: peek.isOpen(), tabs: b.tabs.length });
    await reset();
  } else log("no peek service in this build");

  // ---- 5. a Vitre menu ----
  log("--- menus");
  const menus = b.service("menus");
  if (menus) {
    let ran = 0;
    menus.show([{ label: "One", run: () => ran++ }, { label: "Two" }], { x: 300, y: 300 });
    await sleep(400);
    log("menus layer with a menu", (document.getElementById("layer-menus")?.innerHTML ?? "none").slice(0, 400));
    down("Control");
    await sleep(20);
    press("Tab");
    await sleep(300);
    const during = state().phase;
    up("Control");
    await sleep(300);
    check("a Vitre menu is open: Ctrl+Tab is the menu's (global keys are swallowed while a menu is open)", during === "idle" && V.active() === "Alpha", { during, active: V.active() });
    press("Escape");
    await sleep(300);
    // A right-click on a card in the latched switcher: no menu over it, the switcher stays.
    await V.latched();
    const card = document.querySelector(`#layer-switcher .sw-dcard[data-id="${byName("Bravo").id}"]`);
    const r = card.getBoundingClientRect();
    spike.click(Math.min(r.left + r.width / 2, innerWidth - 40), r.top + r.height / 2, { button: 2, type: "contextmenu" });
    spike.click(innerWidth / 2, innerHeight / 2, { button: 2 });
    await sleep(500);
    const menuLayer = document.getElementById("layer-menus");
    const menuShown = !!menus.isOpen?.() || [...(menuLayer?.querySelectorAll("*") ?? [])].some((e) => !e.classList.contains("vt-catcher") && !e.classList.contains("vt-menus") && e.getBoundingClientRect().width > 0);
    log("menus layer after right-click", menuLayer ? menuLayer.innerHTML.slice(0, 300) : "none");
    await spike.capture("ladders-rightclick-card");
    check("latched switcher: a right-click on a card opens no menu and the switcher stays", state().phase === "open" && !menuShown, { phase: state().phase, menuShown });
    press("Escape");
    await V.closed();
    press("Escape");
    await sleep(300);
  }

  // ---- 6. keys that must do nothing in the switcher ----
  log("--- inert keys");
  await V.latched();
  const before = { tabs: b.tabs.length, active: b.activeId };
  for (const k of ["F6", "F10", "Shift+F10", "Alt+Left", "Ctrl+PageDown", "F11", "Ctrl+Shift+T", "Ctrl+L"]) {
    if (k === "Ctrl+L") press("L", { ctrlKey: true });
    else if (k === "Ctrl+Shift+T") press("Shift+T", { ctrlKey: true });
    else if (k === "Ctrl+PageDown") press("PageDown", { ctrlKey: true });
    else if (k === "Alt+Left") press("Left", { altKey: true });
    else if (k === "Shift+F10") press("F10", { shiftKey: true });
    else press(k);
    await sleep(120);
  }
  const after = { phase: state().phase, query: state().query, tabs: b.tabs.length, active: b.activeId, full: window.fullScreen, omni: b.omni.open, focus: document.activeElement?.className };
  check("latched: F6, F10, Shift+F10, Alt+Left, Ctrl+PageDown, F11 do nothing; Ctrl+Shift+T and Ctrl+L type T and l; focus stays in the field", after.phase === "open" && after.query.toLowerCase() === "tl" && after.tabs === before.tabs && after.active === before.active && !after.full && !after.omni && /sw-input/.test(after.focus || ""), after);
  press("Escape");
  await V.closed();

  // ---- 7. F11 ----
  log("--- F11");
  b.run("fullscreen");
  await waitFor(() => window.fullScreen, { timeout: 4000, what: "full screen" });
  await sleep(1200);
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    await V.holdOpen(1);
    await sleep(900);
    await spike.capture(`ladders-f11-${style}`);
    const field = document.querySelector("#layer-switcher .sw-gfield, #layer-switcher .sw-dock");
    log(style, "field", field ? V.rect(field) : null, "inner", innerWidth, innerHeight);
    await V.release();
    check(`F11 (${style}): held Ctrl+Tab and release switch tabs; still in full screen`, V.active() === "Bravo" && window.fullScreen, { active: V.active(), full: window.fullScreen });
    await reset();
  }
  await V.setStyle("deck");
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen, { timeout: 4000, what: "full screen left" });
  await sleep(800);

  // ---- 8. element full screen ----
  log("--- element full screen");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  Services.prefs.setStringPref("full-screen-api.transition-duration.enter", "0 0");
  Services.prefs.setStringPref("full-screen-api.transition-duration.leave", "0 0");
  await V.inPage((w, d) => d.body.requestFullscreen().then(() => "ok", (e) => "refused " + e), b.active().browser);
  const domFull = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000, what: "DOM full screen" }).catch(() => false);
  await sleep(500);
  b.focusPage();
  down("Control");
  await sleep(20);
  press("Tab");
  await sleep(500);
  const mid = { active: V.active(), phase: state().phase, dom: document.documentElement.hasAttribute("inDOMFullscreen") };
  press("Tab");
  await sleep(400);
  const mid2 = { active: V.active(), phase: state().phase };
  up("Control");
  await sleep(800);
  const end = { active: V.active(), phase: state().phase, consistent: V.consistent(), dom: document.documentElement.hasAttribute("inDOMFullscreen") };
  log("element full screen", { domFull, mid, mid2, end });
  check("element full screen: Ctrl+Tab still switches tabs (core step), leaves full screen, ends consistent with the switcher closed", domFull && mid.active === "Bravo" && end.phase === "idle" && !end.dom && end.consistent.length === 0, { domFull, mid, mid2, end });
  check("element full screen: Ctrl held, Tab, Tab steps twice as one gesture (Alpha -> Charlie), no switcher opens half-way", mid2.phase === "idle" && mid2.active === "Charlie" && end.active === "Charlie", { mid2, end });
  await reset();

  // ---- 9. auto-hidden bar ----
  log("--- auto-hide");
  b.sys("VitreSettings").set({ barAutoHide: true });
  await sleep(1500);
  await V.setStyle("strip");
  await V.holdOpen(1);
  await sleep(800);
  await spike.capture("ladders-autohide-strip");
  // Pointing at the top edge while the switcher is up.
  spike.click(720, 2, { type: "mousemove", ctrlKey: true });
  await sleep(800);
  const revealed = !b.bar.hidden;
  await V.release();
  check("auto-hide: the strip opens and release switches; the bar is not revealed under it by the pointer", V.active() === "Bravo", { active: V.active(), revealed });
  log("bar revealed by the pointer at the top edge while the strip was up:", revealed);
  b.sys("VitreSettings").reset("barAutoHide");
  await V.setStyle("deck");
  await sleep(600);

  const c = V.consoleDump("ladders");
  check("no console errors from Vitre during the ladders", c.vitre === 0, c);
});
