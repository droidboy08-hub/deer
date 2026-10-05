// Robustness review 2: every feature open at once, then rapid random input over all of them.
//   python tests/review2/run.py allopen
// 1. A download runs; a peek with find in it and a page menu over it; then Downloads, Settings, the
//    switcher and the address field on top. Esc unwinds one layer at a time; nothing is left behind.
// 2. The same stack in auto-hide: once closed, no surface still holds the bar.
// 3. 600 random actions (feature keys, peeks, promotions, menus, tab keys) with short pauses; every
//    100 the window is checked (model vs bar, one panel at most), at the end everything unwinds.
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const exts = await W.installExt(["popup", "pin1"]);
  log("extensions", exts.map((a) => a?.id));
  const peek = b.service("peek");
  const find = b.service("find");
  const downloads = b.service("downloads");
  const engine = b.sys("VitreDownloads");

  const A = await W.load(window, b.active(), W.P("alpha", "n=10"));
  await W.open(window, W.P("beta"), { background: true });
  await W.open(window, W.P("gamma"), { background: true });
  b.activate(A);
  await sleep(400);

  // A long download (200 MB at 100 kB/s per connection).
  downloads.download(W.url("file?size=200000000&rate=100000&name=allopen.bin"), { browser: A.browser });
  const dl = await waitFor(() => engine.list(false).find((v) => v.filename.startsWith("allopen") && v.state === "downloading" && v.received > 0), { timeout: 20000, what: "download running" }).catch(() => null);
  check("a download runs", !!dl, engine.list(false).map((v) => [v.filename, v.state]));

  // ---- 1. the stack ----
  const steps = [];
  const at = (what) => steps.push([what, W.fmt(W.layers(window))]);
  await W.openPeek(window, W.P("alpha-0"));
  at("peek");
  await W.openFind(window, "glass");
  at("find in peek");
  await W.pageMenu(window, peek.browser());
  at("page menu");
  await capture("allopen-1-menu-find-peek");
  W.key(window, "KEY_Escape");
  await sleep(400);
  at("esc");
  await W.openDownloads(window);
  at("downloads");
  await W.openSettings(window).catch((e) => log("settings: " + e));
  at("settings");
  await W.openSwitcher(window).catch((e) => log("switcher: " + e));
  at("switcher");
  await capture("allopen-2-switcher-over-all");
  W.key(window, "KEY_Escape");
  await sleep(500);
  at("esc");
  await W.openOmni(window).catch((e) => log("omni: " + e));
  at("address field");
  await capture("allopen-3-omni-over-all");
  log("stack", steps);
  const peak = W.layers(window);
  check("the stack reached menu+find+peek, then find+peek+Settings+switcher, then the address field over the peek", steps.some(([, l]) => l === "menu+find+peek") && steps.some(([, l]) => l === "find+peek+settings+switcher") && peak.peek && peak.omni, steps);
  check("one panel at a time (Settings replaced Downloads)", !(peak.settings && peak.downloads), W.fmt(peak));
  const unwound = await W.unwind(window, 10, 600);
  log("unwind", unwound);
  check("Esc unwinds the stack to nothing", W.fmt(W.layers(window)) === "none", unwound);
  await sleep(800);
  check("nothing left behind after the stack", W.leftovers(window).length === 0, W.leftovers(window));
  check("model, gBrowser and bar agree", W.consistent(window).length === 0, W.consistent(window));
  check("the download kept running", engine.list(false).find((v) => v.filename.startsWith("allopen"))?.state === "downloading", engine.list(false).map((v) => [v.filename, v.state]));
  W.consoleDump("stack");

  // ---- 2. the same in auto-hide ----
  const S = b.sys("VitreSettings");
  S.set({ barAutoHide: true });
  await sleep(900);
  await W.openPeek(window, W.P("alpha-1"));
  await W.openFind(window, "glass");
  await W.pageMenu(window, peek.browser());
  W.key(window, "KEY_Escape");
  await sleep(400);
  await W.openDownloads(window);
  await W.openSwitcher(window).catch((e) => log("switcher: " + e));
  const ah = W.fmt(W.layers(window));
  await capture("allopen-4-autohide-stack");
  const ahSteps = await W.unwind(window, 10, 600);
  // Pointer far from the top: the bar may leave.
  W.mouse(window, 700, 600, { type: "mousemove" });
  await sleep(1500);
  log("auto-hide stack", ah, "unwind", ahSteps, "bar hidden", b.bar.hidden);
  check("auto-hide: after the stack closes the bar leaves (no surface keeps a hold)", b.bar.hidden && W.leftovers(window).length === 0, { hidden: b.bar.hidden, left: W.leftovers(window) });
  await capture("allopen-5-autohide-after");
  S.set({ barAutoHide: false });
  await sleep(600);
  W.consoleDump("autohide");

  // ---- 3. rapid random input ----
  // mulberry32: a seeded generator with good low bits (the run is repeatable).
  let seed = 20261003;
  const rnd = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
  const pagePoint = () => {
    const r = b.active().browser.getBoundingClientRect();
    return [r.left + 80 + rnd(Math.max(1, r.width - 160)), r.top + 120 + rnd(Math.max(1, r.height - 200))];
  };
  const actions = [
    ["find", () => W.key(window, "f", { accelKey: true })],
    ["type", () => W.EU(window).sendString("gl", window)],
    ["esc", () => W.key(window, "KEY_Escape")],
    ["esc", () => W.key(window, "KEY_Escape")],
    ["downloads", () => W.key(window, "j", { ctrlKey: true })],
    ["settings", () => W.key(window, ",", { ctrlKey: true })],
    ["switcher-search", () => W.key(window, "a", { ctrlKey: true, shiftKey: true })],
    ["ctrl-tab", async () => {
      W.key(window, "KEY_Control", { type: "keydown" });
      W.key(window, "KEY_Tab", { ctrlKey: true });
      await sleep(rnd(300));
      W.key(window, "KEY_Control", { type: "keyup" });
    }],
    ["new-tab", () => b.tabs.length < 14 && W.key(window, "t", { ctrlKey: true })],
    ["close-tab", () => b.tabs.length > 4 && W.key(window, "w", { ctrlKey: true })],
    ["reopen", () => W.key(window, "t", { ctrlKey: true, shiftKey: true })],
    ["address", () => W.key(window, "l", { ctrlKey: true })],
    ["peek", () => peek.open(W.P("rnd-" + rnd(5)))],
    ["peek-link", () => {
      const [x, y] = pagePoint();
      W.mouse(window, x, y, { type: "mousemove" });
      W.key(window, "q", { ctrlKey: true });
    }],
    ["promote", () => W.key(window, "KEY_Enter", { altKey: true })],
    ["menu", () => {
      const [x, y] = pagePoint();
      W.rightClick(window, x, y);
    }],
    ["menu-down", () => W.key(window, "KEY_ArrowDown")],
    ["click", () => {
      const [x, y] = pagePoint();
      W.click(window, x, y);
    }],
    ["tab-n", () => W.key(window, String(1 + rnd(9)), { ctrlKey: true })],
    ["f3", () => W.key(window, "KEY_F3")],
    ["back", () => W.key(window, "KEY_ArrowLeft", { altKey: true })],
    ["video", () => W.key(window, "d", { ctrlKey: true, shiftKey: true })],
    ["f6", () => W.key(window, "KEY_F6")],
    ["tab", () => W.key(window, "KEY_Tab")],
    ["home-page", () => W.key(window, "KEY_Home", { altKey: true })],
    ["load", () => b.active() && b.navigate(b.active(), W.P("nav-" + rnd(7)))],
  ];
  const counts = {};
  const problems = [];
  const t0 = Date.now();
  for (let i = 1; i <= 600; i++) {
    const [name, fn] = actions[rnd(actions.length)];
    counts[name] = (counts[name] || 0) + 1;
    try {
      await fn();
    } catch (e) {
      problems.push(`${i} ${name}: ${e}`);
    }
    await sleep(rnd(140));
    if (window.closed) break;
    if (i % 100 === 0) {
      await sleep(1200);
      const l = W.layers(window);
      const c = W.consistent(window);
      log(`fuzz ${i}: layers ${W.fmt(l)}, tabs ${b.tabs.length}, inconsistencies ${c.length}`);
      if (c.length) problems.push(`${i}: ${c.join("; ")}`);
      if (l.settings && l.downloads) problems.push(`${i}: two panels open`);
    }
  }
  log("fuzz actions", counts, "in", Date.now() - t0, "ms");
  await sleep(1500);
  const end = await W.unwind(window, 14, 600);
  await sleep(1200);
  // A latched switcher or the address field may have taken Esc for itself: try once more.
  if (W.fmt(W.layers(window)) !== "none") end.push(...(await W.unwind(window, 6, 700)));
  log("fuzz unwind", end);
  await capture("allopen-6-after-fuzz");
  check("fuzz: no step threw", problems.filter((p) => / \w+: /.test(p) && !/inconsisten|two panels/.test(p)).length === 0, problems);
  check("fuzz: the window stays consistent at every checkpoint", !problems.some((p) => /^\d+: /.test(p)), problems);
  check("fuzz: everything unwinds with Esc", W.fmt(W.layers(window)) === "none", { layers: W.fmt(W.layers(window)), end });
  check("fuzz: nothing left behind", W.leftovers(window).length === 0, W.leftovers(window));
  const hidden = [...gBrowser.tabs].filter((t) => t.hidden);
  log("hidden tabs after fuzz", hidden.length, hidden.map((t) => t.linkedBrowser.currentURI.spec));
  check("fuzz: at most one hidden (warm peek) tab remains", hidden.length <= 1, hidden.length);
  check("fuzz: the download is still there", engine.list(false).some((v) => v.filename.startsWith("allopen") && (v.state === "downloading" || v.state === "paused" || v.state === "queued")), engine.list(false).map((v) => [v.filename, v.state]));
  W.consoleDump("fuzz");
  check("no console errors from Vitre's code in the whole run", W.vitreErrors().length === 0, W.vitreErrors());
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(500);
});
