// Robustness review 2: hung and slow pages under every feature.
//   python tests/review2/run.py hung
// A. A page whose script blocks its process (localhost /busy, 45 s): every feature opened through its
//    service or a browser-first key still works in the window; find opened on it does not wedge;
//    the switcher's card for it; Firefox's slow-script notice shows; the hung tab closes.
// B. A peek whose page hangs: Esc Esc and Ctrl+W (browser-first) still close it.
// C. Addresses that never answer (/hang): a peek of one, a download of one (cancel works), find,
//    menus and the switcher with a tab that never finishes loading.
// D. A slow answer (/slow 6 s): Esc before it lands, promote while it loads.
/* global spike, Services, gBrowser, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 820);
  await spike.activate();
  const engine = b.sys("VitreDownloads");
  const peek = b.service("peek");
  const find = b.service("find");
  const settings = b.service("settings");
  const downloads = b.service("downloads");
  const switcher = b.service("switcher");
  const menus = b.service("menus");
  const timed = async (label, fn, ms = 3000) => {
    const t0 = Date.now();
    let res;
    try {
      res = await Promise.race([Promise.resolve().then(fn), sleep(ms).then(() => "TIMEOUT")]);
    } catch (e) {
      res = "THREW " + e;
    }
    const took = Date.now() - t0;
    log(`${label}: ${took} ms -> ${typeof res === "string" ? res : JSON.stringify(res)?.slice(0, 200)}`);
    return { res, took };
  };

  const home = await W.load(window, b.active(), W.P("hung-home"));
  await W.open(window, W.P("hung-other"), { background: true });

  // ---- A. a busy page ----
  log("--- A: busy page");
  const busy = await W.open(window, W.xurl("busy?ms=45000"));
  await waitFor(() => busy.title === "Busy now", { timeout: 8000, what: "page busy" }).catch(() => null);
  await sleep(500);
  const chromeLag = await timed("chrome event loop while the page is busy", () => new Promise((r) => setTimeout(() => r("ok"), 50)));
  check("A: the chrome stays responsive while a page is busy", chromeLag.took < 500, chromeLag.took);
  const a = {};
  b.focusPage();
  // Find opened through the service (the menus' Find "x" on page path) on the busy page.
  a.find = await timed("find.open on the busy page", async () => {
    find.open({ query: "glass" });
    await sleep(800);
    return find.isOpen();
  });
  await capture("hung-1-find-on-busy");
  W.key(window, "KEY_Escape");
  await sleep(600);
  a.findClosed = !find.isOpen();
  if (find.isOpen()) find.close();
  await sleep(300);
  a.switcher = await timed("switcher on the busy page", async () => {
    switcher.open("latched");
    await waitFor(() => switcher.isOpen() && window.vitreSwitcher.state().phase === "open", { timeout: 2500 });
    await sleep(800);
    return window.vitreSwitcher.state().list?.length;
  });
  await capture("hung-2-switcher-busy");
  W.key(window, "KEY_Escape");
  await sleep(600);
  a.switcherClosed = !switcher.isOpen();
  a.downloads = await timed("downloads panel on the busy page", async () => {
    downloads.openPanel();
    await waitFor(() => downloads.isPanelOpen(), { timeout: 2500 });
    return true;
  });
  await sleep(600);
  W.key(window, "KEY_Escape");
  await sleep(500);
  a.downloadsClosed = !downloads.isPanelOpen();
  a.settings = await timed("settings on the busy page", async () => {
    settings.open("general");
    await waitFor(() => settings.isOpen(), { timeout: 2500 });
    return true;
  });
  await sleep(600);
  W.key(window, "KEY_Escape");
  await sleep(500);
  a.settingsClosed = !settings.isOpen();
  a.peek = await timed("peek over the busy page", async () => {
    await W.openPeek(window, W.P("over-busy"));
    return peek.isOpen();
  }, 15000);
  W.key(window, "KEY_Escape");
  await sleep(700);
  a.peekClosed = !peek.isOpen();
  if (peek.isOpen()) peek.close();
  // A glass menu from the bar (the pill) while the page is busy.
  const pill = document.querySelector("#vitre-bar .item.tab.active");
  const pr = pill.getBoundingClientRect();
  W.rightClick(window, pr.left + 40, pr.top + pr.height / 2);
  await sleep(700);
  a.pillMenu = W.layers(window).menu;
  W.key(window, "KEY_Escape");
  await sleep(400);
  // Browser-first keys on the busy page.
  b.focusPage();
  W.key(window, "KEY_Control", { type: "keydown" });
  W.key(window, "KEY_Tab", { ctrlKey: true });
  await sleep(700);
  a.ctrlTab = switcher.isOpen();
  W.key(window, "KEY_Control", { type: "keyup" });
  await sleep(700);
  a.ctrlTabMoved = b.active() !== busy;
  b.activate(busy);
  await sleep(500);
  log("A results", a);
  check("A: on a busy page find, the switcher, Downloads, Settings, a peek and the pill menu open and close", a.find.res === true && a.findClosed && typeof a.switcher.res === "number" && a.switcherClosed && a.downloads.res === true && a.downloadsClosed && a.settings.res === true && a.settingsClosed && a.peek.res === true && a.peekClosed && a.pillMenu, a);
  check("A: Ctrl+Tab (browser-first) switches away from a busy page", a.ctrlTab && a.ctrlTabMoved, a);
  // Firefox's "This page is slowing down" notice (process hang monitor) must be visible.
  const notice = await waitFor(() => {
    try {
      const box = window.gNotificationBox;
      return box?.getNotificationWithValue?.("process-hang") || gBrowser.getNotificationBox?.(busy.browser)?.getNotificationWithValue?.("process-hang");
    } catch {
      return null;
    }
  }, { timeout: 20000, what: "slow-script notice" }).catch(() => null);
  let noticeRect = null;
  if (notice) {
    const r = notice.getBoundingClientRect();
    noticeRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    noticeRect.onTop = !!hit && (notice.contains(hit) || notice === hit || notice.shadowRoot?.contains?.(hit));
    noticeRect.hit = hit?.id || hit?.className || hit?.localName;
  }
  await capture("hung-3-slow-script-notice");
  log("slow-script notice", noticeRect);
  check("A: Firefox's slow-script notice is shown on screen", !!noticeRect && noticeRect.w > 100 && noticeRect.h > 20 && noticeRect.y >= 0, noticeRect);
  // With Settings open over it: the notice stays reachable?
  settings.open("general");
  await sleep(700);
  if (notice) {
    const r = notice.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    log("notice under Settings: element at its centre", hit?.id || hit?.className || hit?.localName);
  }
  await capture("hung-4-notice-under-settings");
  W.key(window, "KEY_Escape");
  await sleep(500);
  // Close the busy tab.
  const closeT = await timed("close the busy tab", async () => {
    b.closeTab(busy);
    await waitFor(() => !b.tabs.includes(busy), { timeout: 8000 });
    return true;
  }, 10000);
  check("A: the busy tab closes at once", closeT.res === true && closeT.took < 3000, closeT);
  W.consoleDump("busy");

  // ---- B. a peek whose page hangs ----
  log("--- B: hung peek");
  b.activate(home);
  await sleep(400);
  peek.open(W.xurl("busy?ms=40000"));
  await waitFor(() => peek.isOpen() && peek.browser()?.contentTitle === "Busy now", { timeout: 10000, what: "busy peek" }).catch(() => null);
  await sleep(600);
  peek.browser()?.focus();
  await sleep(200);
  W.key(window, "KEY_Escape");
  await sleep(120);
  W.key(window, "KEY_Escape");
  await sleep(1200);
  const escEsc = !peek.isOpen();
  log("B: Esc Esc on a hung peek closed it:", escEsc);
  if (peek.isOpen()) {
    W.key(window, "w", { ctrlKey: true });
    await sleep(1200);
  }
  const ctrlW = !peek.isOpen();
  await capture("hung-5-after-hung-peek");
  check("B: Esc Esc (browser-first) closes a peek whose page hangs", escEsc, { escEsc, ctrlW });
  check("B: and the peek is gone either way (Ctrl+W)", ctrlW && b.tabs.includes(home) && W.consistent(window).length === 0, W.consistent(window));
  if (peek.isOpen()) peek.close();
  await sleep(500);

  // ---- C. addresses that never answer ----
  log("--- C: never answers");
  peek.open(W.url("hang"));
  await sleep(2000);
  const c = { peekOpen: peek.isOpen() };
  await capture("hung-6-peek-never-answers");
  W.key(window, "KEY_Escape");
  await sleep(900);
  c.peekClosed = !peek.isOpen();
  if (peek.isOpen()) peek.close();
  await sleep(400);
  c.hiddenAfter = [...gBrowser.tabs].filter((t) => t.hidden).length;
  // A download of an address that never answers: it waits, and Cancel ends it.
  downloads.download(W.url("hang?name=never.bin"), { browser: home.browser });
  await sleep(4000);
  const never = engine.list(false).find((v) => /hang|never/.test(v.url));
  c.dlState = never?.state;
  if (never) engine.cancel(never.id);
  await sleep(1500);
  c.dlAfterCancel = never && engine.get(never.id)?.state;
  // A tab that never finishes loading: find, a menu, the switcher with it.
  const stuck = b.newTab(W.url("hang"));
  await sleep(2000);
  c.stuckLoading = stuck.loading;
  b.focusPage();
  W.key(window, "f", { accelKey: true });
  await sleep(800);
  c.findOnStuck = find.isOpen();
  W.key(window, "KEY_Escape");
  await sleep(500);
  if (find.isOpen()) find.close();
  const sr = stuck.browser.getBoundingClientRect();
  W.rightClick(window, sr.left + sr.width / 2, sr.top + sr.height / 2);
  await sleep(800);
  c.menuOnStuck = W.layers(window).menu;
  W.key(window, "KEY_Escape");
  await sleep(400);
  switcher.open("latched");
  await sleep(1200);
  c.switcherWithStuck = switcher.isOpen() && window.vitreSwitcher.state().list?.length;
  await capture("hung-7-switcher-with-stuck-tab");
  W.key(window, "KEY_Escape");
  await sleep(600);
  c.layersAfter = W.fmt(W.layers(window));
  log("C results", c);
  check("C: a peek of an address that never answers opens and closes, leaving at most the warm tab", c.peekOpen && c.peekClosed && c.hiddenAfter <= 1, c);
  check("C: a download of an address that never answers waits and Cancel ends it", !!c.dlState && c.dlAfterCancel === "cancelled", c);
  check("C: find, a menu and the switcher work with a tab that never finishes loading", c.layersAfter === "none" && c.switcherWithStuck >= 3, c);
  b.closeTab(stuck);
  await sleep(500);

  // ---- D. a slow answer ----
  log("--- D: slow answer");
  peek.open(W.url("slow?ms=6000&name=Slow%20peek"));
  await sleep(1200);
  W.key(window, "KEY_Escape");
  await sleep(900);
  const d = { escBeforeLoad: !peek.isOpen() };
  if (peek.isOpen()) peek.close();
  await sleep(600);
  peek.open(W.url("slow?ms=5000&name=Slow%20promote"));
  await sleep(1500);
  const n0 = b.tabs.length;
  peek.promote();
  await sleep(1500);
  d.promotedWhileLoading = b.tabs.length === n0 + 1 && !peek.isOpen();
  const promoted = b.active();
  await waitFor(() => promoted.title === "Slow promote" && !promoted.loading, { timeout: 12000 }).catch(() => null);
  d.promotedTitle = promoted.title;
  d.consistent = W.consistent(window);
  d.left = W.leftovers(window);
  log("D results", d);
  check("D: Esc before a slow page lands closes the peek; promoting while it loads makes a tab that finishes loading", d.escBeforeLoad && d.promotedWhileLoading && d.promotedTitle === "Slow promote" && d.consistent.length === 0 && d.left.length === 0, d);

  // ---- E. keys pressed on a hung page answer late ----
  // The page is busy; the user presses Esc (or Ctrl+J), gets nothing, then opens Settings with the
  // mouse. When the page wakes up its late replies must not act on what is open by then.
  log("--- E: late replies");
  const late = {};
  for (const [label, press] of [["Esc", () => W.key(window, "KEY_Escape")], ["Ctrl+J", () => W.key(window, "j", { ctrlKey: true })], ["Ctrl+F", () => W.key(window, "f", { accelKey: true })]]) {
    const t = await W.open(window, W.xurl("busy?ms=8000&late=" + label.length));
    // The page blocks its process 400 ms after load (its title only changes once it is free again).
    b.focusPage();
    await sleep(900);
    const asleep = await Promise.race([b.page(t).query("inset:state", {}).then(() => false, () => false), sleep(700).then(() => true)]);
    press();
    await sleep(600);
    settings.open("general");
    await sleep(600);
    const during = W.fmt(W.layers(window));
    await waitFor(() => t.title === "Busy done", { timeout: 15000 }).catch(() => null);
    await sleep(1200);
    late[label] = { asleep, during, after: W.fmt(W.layers(window)), router: (b.keys.log || []).slice(-3) };
    await capture("hung-8-late-" + label.replace(/\W+/g, "-"));
    await W.unwind(window, 6, 400);
    b.closeTab(t);
    await sleep(500);
  }
  log("E late replies", late);
  for (const [k, v] of Object.entries(late)) if (v.asleep) check(`E: a late reply to ${k} from a page that was hung does not act on the Settings panel opened meanwhile`, v.during === "settings" && v.after === "settings", v);

  W.consoleDump("hung");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
});
