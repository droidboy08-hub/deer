// Switcher verification under stress: Tab storms, key repeat, quick-tap storms, reopening during the
// closing motion, open/close storms, tabs closing and opening underneath, a tab that refuses to close
// (beforeunload), closing every tab of a window from the switcher, a page that never answers, a hung
// content process, dark and light pages; console errors and the idle CPU cost before and after.
// python tools/run.py --test tests/switcher-verify/stress.js --name swverify-stress --app build-switcher-verify --timeout 420
/* global spike, Services, Cc, Ci */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const th = () => window.vitreSwitcher.thumbs;
  const names = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"];
  await V.openTabs(names.map((n, i) => V.page(n, `hsl(${i * 30} 60% 88%)`)));
  const byName = (n) => b.tabs.find((t) => t.title === n);
  const order = () => names.map(byName).filter(Boolean);
  const resetMru = async () => {
    await V.visit([...order()].reverse());
    b.focusPage();
    await sleep(200);
  };
  await resetMru();

  // ---- idle cost, before any use ----
  async function idle(label, ms = 8000) {
    await sleep(2500);
    const c0 = V.cpu();
    const s0 = { ...th().stats };
    await sleep(ms);
    const c1 = V.cpu();
    const s1 = th().stats;
    const r = { label, cpuMs: Math.round(c1 - c0), captures: s1.captures - s0.captures, encodes: s1.encodes - s0.encodes, saved: s1.saved - s0.saved, decodes: s1.decodes - s0.decodes, left: V.leftovers() };
    log("idle", r);
    return r;
  }
  const idleBefore = await idle("before");

  // ---- 1. a Tab storm with Ctrl held ----
  log("--- Tab storm");
  const mru0 = b.mru.map((id) => V.titleOf(id));
  b.focusPage();
  await sleep(100);
  down("Control");
  for (let i = 0; i < 37; i++) {
    press("Tab");
    if (i % 5 === 0) await sleep(1);
  }
  await waitFor(() => state().phase === "open", { what: "open after storm" });
  const stormSel = V.sel();
  await V.release();
  const expectStorm = mru0[37 % mru0.length];
  check("37 Tabs as fast as they come with Ctrl held: the 37th card is selected and opens", stormSel === expectStorm && V.active() === expectStorm && V.consistent().length === 0, { stormSel, expectStorm, active: V.active(), problems: V.consistent() });
  await resetMru();

  // ---- 2. key repeat on Tab ----
  down("Control");
  await sleep(20);
  press("Tab");
  await sleep(20);
  V.EU.synthesizeKey("KEY_Tab", { ctrlKey: true, repeat: 9 }, window);
  await sleep(300);
  const rep = V.sel();
  await V.release();
  check("Ctrl held, Tab then 9 repeated Tabs (key repeat steps): the 10th card from the start", rep === mru0[10 % mru0.length] && V.active() === rep, { rep, expected: mru0[10 % mru0.length] });
  await resetMru();

  // ---- 3. quick-tap storm ----
  log("--- quick taps");
  const start = V.active();
  for (let i = 0; i < 20; i++) {
    down("Control");
    press("Tab");
    await sleep(15);
    up("Control");
    await sleep(25);
  }
  await sleep(500);
  check("20 quick taps in a row: back on the starting tab (even count), the switcher never showed, the model consistent", V.active() === start && state().phase === "idle" && window.vitreSwitcher.timing.show === 0 && V.consistent().length === 0, { active: V.active(), start, show: window.vitreSwitcher.timing.show, problems: V.consistent() });
  await resetMru();

  // ---- 4. Ctrl+Tab again while the chosen card is still growing ----
  await V.holdOpen(1);
  await sleep(500);
  up("Control");
  await sleep(60); // the card is growing (360 ms)
  down("Control");
  press("Tab");
  await waitFor(() => state().phase === "open", { what: "reopened during the expand" });
  const reopened = { ...state(), sel: V.sel(), startTitle: V.titleOf(state().startId) };
  await sleep(500);
  await V.release();
  check("Ctrl+Tab while the previous switch is still growing: opens again from the new tab, whose previous tab is the old one", reopened.startTitle === "S1" && reopened.sel === "S0" && V.active() === "S0" && V.consistent().length === 0, reopened);
  check("... and nothing is left behind in the layer", V.leftovers().children === 0, V.leftovers());
  await resetMru();

  // ---- 5. open / close storm through the service, every style ----
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    for (let i = 0; i < 12; i++) {
      b.service("switcher").open(i % 3 === 0 ? "search" : "latched");
      await sleep(i % 4 === 0 ? 0 : 30);
      press("Escape");
      await sleep(i % 2 ? 5 : 60);
    }
    await sleep(600);
    check(`${style}: 12 rapid open / Esc pairs leave the switcher idle, the start tab active and the layer empty`, state().phase === "idle" && V.active() === "S0" && V.leftovers().children === 0 && V.consistent().length === 0, { phase: state().phase, active: V.active(), left: V.leftovers() });
  }
  await V.setStyle("deck");

  // ---- 6. tabs closing and opening underneath ----
  log("--- tabs changing underneath");
  await V.latched();
  press("Right");
  await sleep(100);
  const selId = state().selected;
  const live = (s) => s.list.every((id) => b.tab(id)) && (s.selected === undefined || !!b.tab(s.selected));
  b.closeTab(selId); // the selected card's tab goes away (the page closed itself, another window...)
  await sleep(300);
  const afterSel = state();
  const liveSel = live(afterSel);
  b.closeTab(b.activeId); // the start tab goes away
  await sleep(300);
  const afterStart = state();
  const liveStart = live(afterStart);
  const fresh = b.newTab(V.page("Newcomer", "#fff"), { background: true });
  await sleep(500);
  const afterNew = state();
  log("underneath", { afterSel, afterStart, afterNew });
  check("tabs closed underneath: the switcher keeps only live tabs and a live selection", liveSel && liveStart && !afterSel.list.includes(selId) && afterSel.phase === "open" && afterStart.phase === "open" && afterStart.startId === b.activeId, { afterSel, afterStart, active: b.activeId });
  press("Enter");
  await V.closed();
  check("... Enter then opens a live tab and the model is consistent", !!b.active() && V.consistent().length === 0 && state().phase === "idle", { active: V.active(), problems: V.consistent() });
  b.closeTab(fresh);
  await sleep(300);

  // ---- 7. a tab that refuses to close (beforeunload) ----
  log("--- beforeunload");
  const sticky = b.newTab(V.page("Sticky", "#fec", `<script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });</script>`), { background: true });
  await V.loaded(sticky);
  b.activate(sticky);
  await sleep(500);
  spike.click(400, 400); // user activation: Firefox shows the prompt only for pages the user touched
  await sleep(300);
  b.activate(byName("S2") ?? b.tabs[0]);
  await sleep(500);
  const nSticky = b.tabs.length;
  await V.latched();
  // Select the sticky card.
  for (let i = 0; i < 20 && state().selected !== sticky.id; i++) {
    press("Right");
    await sleep(40);
  }
  // Firefox asks the page synchronously (browser.permitUnload spins a nested event loop until the
  // prompt is answered): press from a timer so this script keeps running in that loop.
  const stickySelected = state().selected === sticky.id;
  window.setTimeout(() => press("W", { ctrlKey: true }), 0);
  await sleep(1500);
  const dialogs = (t) => {
    try {
      const box = gBrowser.getTabDialogBox(t.browser);
      return box.getTabDialogManager()._dialogs.length + (box._contentDialogManager?._dialogs.length ?? 0);
    } catch (e) {
      return -1;
    }
  };
  const stickyState = { phase: state().phase, tabs: b.tabs.length, n: nSticky, stickyOpen: b.tabs.includes(sticky), inList: state().list?.includes(sticky.id), prompts: dialogs(sticky), active: V.active() };
  log("beforeunload after Ctrl+W", stickyState);
  await spike.capture("stress-beforeunload");
  check("a card whose page asks before closing: the switcher opens that tab and its prompt shows there (never hidden behind the switcher or in a background tab)", stickySelected && stickyState.phase === "idle" && stickyState.stickyOpen && stickyState.active === "Sticky" && stickyState.prompts > 0, stickyState);
  // Answer it: stay. The tab stays open and the switcher shows it again.
  try {
    gBrowser.getTabDialogBox(sticky.browser).abortAllDialogs();
  } catch (e) {
    log("abort prompt", String(e));
  }
  await sleep(800);
  await V.latched();
  const back = state().list?.includes(sticky.id);
  press("Escape");
  await V.closed();
  check("... answered 'stay': the tab is still open and its card is in the switcher again", b.tabs.includes(sticky) && back, { open: b.tabs.includes(sticky), back });
  // A page with a beforeunload listener that does not ask (most sites): its card closes at once, in place.
  const quiet = b.newTab(V.page("Quiet", "#cef", `<script>addEventListener('beforeunload', () => { navigator.sendBeacon && 0; });</script>`), { background: true });
  await V.loaded(quiet);
  await sleep(300);
  const nQuiet = b.tabs.length;
  await V.latched();
  for (let i = 0; i < 20 && state().selected !== quiet.id; i++) {
    press("Right");
    await sleep(40);
  }
  window.setTimeout(() => press("W", { ctrlKey: true }), 0);
  await sleep(1200);
  check("a card whose page listens for beforeunload without asking closes in place; the switcher stays", !b.tabs.includes(quiet) && b.tabs.length === nQuiet - 1 && state().phase === "open", { tabs: b.tabs.length, nQuiet, phase: state().phase });
  press("Escape");
  await V.closed();
  // Let the sticky one go.
  if (b.tabs.includes(sticky)) {
    try {
      gBrowser.removeTab(sticky.node, { skipPermitUnload: true });
    } catch (e) {
      log("remove sticky", String(e));
    }
  }
  await sleep(600);
  log("tabs now", b.tabs.map((t) => t.title));

  // ---- 8. closing every tab of a window from the switcher ----
  log("--- close every tab of a window");
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  let w2 = await spike.openWindow();
  await w2.spike.activate();
  await V.openTabs(["W A", "W B", "W C"].map((n) => V.page(n, "#eee")), w2);
  await V.latched("latched", w2);
  for (let i = 0; i < 3 && !w2.closed; i++) {
    press("W", { ctrlKey: true }, w2);
    await sleep(500);
  }
  await sleep(800);
  check("Ctrl+W on every card of a window: the last one closes the window cleanly", w2.closed && browsers().length === 1, { closed: w2.closed, windows: browsers().length });
  w2 = null;
  await spike.activate();
  await sleep(500);

  // ---- 9. a page that never answers ----
  log("--- a page that never answers");
  const server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
  server.init(-1, true, -1);
  const held = [];
  server.asyncListen({ onSocketAccepted: (_s, transport) => held.push(transport.openInputStream(0, 0, 0)), onStopListening: () => {} });
  const hang = b.newTab(`http://127.0.0.1:${server.port}/never`, { background: true });
  await sleep(1500);
  log("hanging tab", { loading: hang.loading, url: hang.url, title: hang.title });
  await V.latched();
  for (let i = 0; i < 30 && state().selected !== hang.id; i++) {
    press("Right");
    await sleep(30);
  }
  await sleep(400);
  const hangCard = document.querySelector(`#layer-switcher [data-id="${hang.id}"] .sw-media`);
  await spike.capture("stress-never-answers-card");
  const t0 = performance.now();
  press("Enter");
  await V.closed();
  const toClose = Math.round(performance.now() - t0);
  check("a tab whose page never answers: it has a card (its blank page or a placeholder), Enter opens it and the switcher closes on time", !!hangCard && V.active() === V.titleOf(hang.id) && toClose < 1500, { placeholder: hangCard?.classList.contains("none"), active: V.active(), toClose });
  b.closeTab(hang);
  server.close();
  await sleep(300);

  // ---- 10. a hung content process ----
  log("--- hung content process");
  const busy = b.newTab("https://example.org/", { background: true });
  await V.loaded(busy);
  b.activate(busy);
  await sleep(1200);
  b.activate(byName("S3"));
  await sleep(800);
  const hangFor = (ms) => V.inPage(`function (w) { w.setTimeout(function () { var e = Date.now() + ${ms}; while (Date.now() < e) {} }, 200); return 1; }`, busy.browser);
  await hangFor(7000);
  await sleep(600);
  // Held Ctrl+Tab while a background tab's process is hung: shows at once with the cached picture.
  await V.holdOpen(1);
  await sleep(600);
  const tHung = { ...window.vitreSwitcher.timing }; // read once the opening has painted
  const busyCard = document.querySelector(`#layer-switcher [data-id="${busy.id}"] .sw-media`);
  await spike.capture("stress-hung-background");
  press("Escape");
  up("Control");
  await V.closed();
  await sleep(500);
  check("a background tab's process is hung: the held switcher still paints within 250 ms of the keydown", tHung.paint > 0 && tHung.paint - tHung.begin < 250, { keyToPaint: Math.round(tHung.paint - tHung.begin), busyPainted: busyCard && !busyCard.classList.contains("none") });
  await sleep(6000);
  // The current tab's process is hung: Ctrl+Shift+A waits at most 150 ms for its picture.
  b.activate(busy);
  await sleep(1000);
  await hangFor(6000);
  await sleep(600);
  const tA = performance.now();
  b.service("switcher").open("search");
  await waitFor(() => state().phase === "open", { what: "search over a hung tab" });
  const toShow = Math.round(performance.now() - tA);
  await sleep(300);
  press("Escape");
  await V.closed();
  check("the current tab's process is hung: Ctrl+Shift+A still opens within 300 ms", toShow < 300, { toShow });
  await V.holdOpen(1);
  await V.release();
  check("... and Ctrl+Tab away from the hung tab works", V.active() !== V.titleOf(busy.id) && V.consistent().length === 0, V.active());
  await sleep(6000);
  b.closeTab(busy);
  await sleep(300);

  // ---- 11. dark and light pages ----
  log("--- dark and light pages");
  const dark = b.newTab(V.page("Midnight", "#0d0f14", "<p style='margin:0 60px;font:18px Segoe UI'>white text on a dark page</p>", "#f2f2f2"));
  await V.loaded(dark);
  await sleep(1200);
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    await V.holdOpen(1);
    await sleep(900);
    await spike.capture(`stress-dark-page-${style}`);
    press("Shift+Tab");
    await sleep(100);
    await V.release();
    await sleep(300);
  }
  await V.setStyle("deck");
  check("dark page: every style opens and cancels back to it", V.active() === "Midnight", V.active());

  const idleAfter = await idle("after");
  check("idle after all this: no pictures taken, nothing left in the layer, no animations running", idleAfter.captures === 0 && idleAfter.left.children === 0 && idleAfter.left.animations === 0 && !idleAfter.left.gridClass, idleAfter);
  check("idle CPU after use is no higher than before use (+60 ms / 8 s)", idleAfter.cpuMs <= idleBefore.cpuMs + 60, { before: idleBefore.cpuMs, after: idleAfter.cpuMs });
  const c = V.consoleDump("stress");
  check("no console errors from Vitre under stress", c.vitre === 0, c);
});
