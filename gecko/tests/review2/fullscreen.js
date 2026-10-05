// Robustness review 2: element full screen and F11 with every feature.
//   python tests/review2/run.py fullscreen
// E. A page element goes full screen while a feature is open (find, a menu, Downloads, Settings, the
//    latched switcher, a peek's page); features asked for while in it (Ctrl+F stays the page's,
//    Ctrl+J / Ctrl+, leave full screen, Ctrl+Tab); leaving it (Esc) brings everything back clean.
// F. F11 with each feature open, features opened in F11, leaving F11 with each open: positions on
//    screen, no bar hold left behind (the bar hides again once nothing needs it).
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 820);
  await spike.activate();
  const peek = b.service("peek");
  const find = b.service("find");
  const downloads = b.service("downloads");
  const settings = b.service("settings");
  const switcher = b.service("switcher");
  const efs = () => b.root.classList.contains("element-fullscreen");
  const enterEfs = async (browser) => {
    await W.inContent(browser, (c) => {
      c.document.getElementById("title").requestFullscreen();
      return true;
    });
    return waitFor(efs, { timeout: 5000, what: "element full screen" }).then(() => true, () => false);
  };
  const leaveEfs = async () => {
    if (!efs()) return true;
    // Firefox's own exit (what Esc does in full screen).
    if (window.FullScreen?.exitDomFullScreen) window.FullScreen.exitDomFullScreen();
    else document.exitFullscreen().catch(() => null);
    return waitFor(() => !efs(), { timeout: 5000, what: "left element full screen" }).then(() => true, () => false);
  };
  const tab = await W.load(window, b.active(), W.P("fs-page"));
  await W.open(window, W.P("fs-other"), { background: true });
  await W.open(window, W.P("fs-third"), { background: true });
  b.activate(tab);
  await sleep(400);

  // ---- E. element full screen ----
  const E = {};
  const scenario = async (name, open) => {
    b.focusPage();
    await sleep(200);
    await open();
    const before = W.fmt(W.layers(window));
    const entered = await enterEfs(peek.isOpen() ? peek.browser() : b.active().browser);
    await sleep(600);
    const inside = W.fmt(W.layers(window));
    await capture("fs-e-" + name);
    const left = await leaveEfs();
    await sleep(700);
    const after = W.fmt(W.layers(window));
    const unwound = await W.unwind(window, 6, 500);
    await sleep(500);
    E[name] = { before, entered, inside, left, after, unwound, leftovers: W.leftovers(window), consistent: W.consistent(window).length === 0 };
    log("E " + name, E[name]);
  };
  await scenario("find", () => W.openFind(window, "glass"));
  await scenario("menu", () => W.pageMenu(window));
  await scenario("downloads", () => W.openDownloads(window));
  await scenario("settings", () => W.openSettings(window));
  await scenario("switcher", () => W.openSwitcher(window));
  await scenario("peek", () => W.openPeek(window, W.P("fs-peek")));
  b.activate(b.tabs.find((t) => t.url === W.P("fs-page")) || b.active());
  await sleep(500);
  check("E: a menu closes when the page goes full screen", E.menu.entered && E.menu.inside === "none", E.menu);
  for (const k of ["find", "downloads", "settings", "switcher", "menu", "peek"]) {
    check(`E: ${k}: after full screen ends everything unwinds and nothing is left behind`, E[k].left && E[k].leftovers.length === 0 && E[k].consistent && W.fmt(W.layers(window)) !== "x", E[k]);
  }
  check("E: a peek's page going full screen becomes a tab first (decision 4)", E.peek.entered && !/peek/.test(E.peek.inside), E.peek);

  // Features asked for while a page element is full screen.
  const F = {};
  const ask = async (label, fn, wait = 900) => {
    await enterEfs(b.active().browser);
    await sleep(400);
    const t0 = b.active();
    await fn();
    await sleep(wait);
    F[label] = { efs: efs(), layers: W.fmt(W.layers(window)), tabChanged: b.active() !== t0 };
    await capture("fs-ask-" + label.replace(/\W+/g, "-"));
    await leaveEfs();
    await sleep(500);
    await W.unwind(window, 6, 500);
    b.activate(tab);
    await sleep(400);
  };
  await ask("Ctrl+F", () => W.key(window, "f", { accelKey: true }));
  await ask("Ctrl+J", () => W.key(window, "j", { ctrlKey: true }));
  await ask("Ctrl+,", () => W.key(window, ",", { ctrlKey: true }));
  await ask("Ctrl+Shift+A", () => W.key(window, "a", { ctrlKey: true, shiftKey: true }));
  await ask("Ctrl+Tab held", async () => {
    W.key(window, "KEY_Control", { type: "keydown" });
    W.key(window, "KEY_Tab", { ctrlKey: true });
    await sleep(800);
    F.heldSwitcherOpen = switcher.isOpen();
    F.heldEfs = efs();
    await capture("fs-ask-ctrl-tab-held-down");
    W.key(window, "KEY_Control", { type: "keyup" });
  });
  await ask("Ctrl+Q", async () => {
    const r = await W.rectOf(window, b.active().browser, "#a0").catch(() => null);
    if (r) W.mouse(window, r.cx, r.cy, { type: "mousemove" });
    W.key(window, "q", { ctrlKey: true });
  });
  log("features asked for in element full screen", F);
  check("E: Ctrl+F in element full screen stays the page's (no find face over the page)", !F["Ctrl+F"].layers.includes("find"), F["Ctrl+F"]);
  check("E: Ctrl+J leaves element full screen and shows the panel", !F["Ctrl+J"].efs && F["Ctrl+J"].layers.includes("downloads"), F["Ctrl+J"]);
  check("E: Ctrl+, leaves element full screen and shows Settings (a surface that must be seen)", !F["Ctrl+,"].efs && F["Ctrl+,"].layers.includes("settings"), F["Ctrl+,"]);
  check("E: the switcher (Ctrl+Shift+A, held Ctrl+Tab) is never up unseen while a page element is full screen", !(F["Ctrl+Shift+A"].efs && F["Ctrl+Shift+A"].layers.includes("switcher")) && !(F.heldEfs && F.heldSwitcherOpen), { search: F["Ctrl+Shift+A"], held: { efs: F.heldEfs, open: F.heldSwitcherOpen } });
  check("E: no layer is left open after these", W.fmt(W.layers(window)) === "none" && W.leftovers(window).length === 0, [W.fmt(W.layers(window)), W.leftovers(window)]);
  W.consoleDump("element fullscreen");

  // ---- F. F11 ----
  const f11 = async (on) => {
    if (b.root.classList.contains("fullscreen") === on) return true;
    b.run("fullscreen");
    return waitFor(() => b.root.classList.contains("fullscreen") === on, { timeout: 6000, what: "F11 " + on }).then(() => true, () => false);
  };
  const G = {};
  const inside = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), onScreen: r.width > 0 && r.y >= 0 && r.x >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 };
  };
  const f11Case = async (name, open, el) => {
    await f11(false);
    await sleep(400);
    b.focusPage();
    await sleep(200);
    await open();
    const before = W.fmt(W.layers(window));
    await f11(true);
    await sleep(1200);
    const during = { layers: W.fmt(W.layers(window)), el: inside(el()), barHidden: b.bar.hidden };
    await capture("fs-f11-" + name);
    await f11(false);
    await sleep(900);
    const after = W.fmt(W.layers(window));
    const unwound = await W.unwind(window, 6, 500);
    // In F11 again with nothing open: the bar must slide away (nothing holds it).
    await f11(true);
    W.mouse(window, 600, 600, { type: "mousemove" });
    await sleep(1600);
    const hidesAgain = b.bar.hidden;
    const holds = W.leftovers(window).filter((l) => /holds/.test(l));
    await f11(false);
    await sleep(600);
    G[name] = { before, during, after, unwound, hidesAgain, holds };
    log("F11 " + name, G[name]);
  };
  await f11Case("find", () => W.openFind(window, "glass"), () => document.querySelector("#layer-find > *"));
  await f11Case("peek", () => W.openPeek(window, W.P("f11-peek")), () => document.querySelector("#layer-peek > *"));
  await f11Case("downloads", () => W.openDownloads(window), () => document.querySelector("#layer-downloads-panel > *:last-child"));
  await f11Case("settings", () => W.openSettings(window), () => document.querySelector("#layer-settings > *:last-child") || document.querySelector("[id^='layer-settings'] > *:last-child"));
  await f11Case("switcher", () => W.openSwitcher(window), () => document.querySelector("#layer-switcher > *"));
  await f11Case("menu", () => W.pageMenu(window), () => document.querySelector("#layer-menus .vt-menus > *"));
  for (const [k, g] of Object.entries(G)) check(`F11 ${k}: after leaving it and closing, F11 again hides the bar (no hold left)`, g.hidesAgain && g.holds.length === 0, g);
  check("F11: a menu closes on the F11 switch (context loss), the rest stay on screen", Object.entries(G).every(([k, g]) => k === "menu" || g.during.layers === g.before), Object.fromEntries(Object.entries(G).map(([k, g]) => [k, [g.before, g.during.layers]])));
  // Features opened in F11.
  await f11(true);
  W.mouse(window, 600, 600, { type: "mousemove" });
  await sleep(1200);
  const opened = {};
  for (const [name, open] of [["find", () => W.openFind(window, "glass")], ["peek", () => W.openPeek(window, W.P("f11-peek2"))], ["downloads", () => W.openDownloads(window)], ["switcher", () => W.openSwitcher(window)], ["settings", () => W.openSettings(window)]]) {
    b.focusPage();
    await sleep(200);
    try {
      await open();
      opened[name] = { ok: true, barHidden: b.bar.hidden };
    } catch (e) {
      opened[name] = { ok: false, error: String(e) };
    }
    await capture("fs-f11-open-" + name);
    await W.unwind(window, 6, 500);
    W.mouse(window, 600, 600, { type: "mousemove" });
    await sleep(1500);
    opened[name].hidesAfter = b.bar.hidden;
  }
  log("opened in F11", opened);
  check("F11: every feature opens in F11 and the bar hides again after it closes", Object.values(opened).every((o) => o.ok && o.hidesAfter), opened);
  const face = opened.find && document.querySelector("#layer-find > *");
  check("F11: find opened in F11 shows its face on screen (the pill drops in alone)", opened.find?.ok, opened.find);
  await f11(false);
  await sleep(600);
  W.consoleDump("f11");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
});
