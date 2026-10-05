// The built-in actions, driven by their keys on real pages: tabs, windows, navigation, zoom, full
// screen, the Esc and close ladders, F6, the peek hook.
//   python tools/run.py --test tests/input/actions.js --name input-actions --timeout 300
// Captures: actions-zoom.png (the pill shows "110%"), actions-view-source.png.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { press, down, up, key } = K;
  await spike.resize(1180, 760);
  await spike.activate();
  const titles = () => b.tabs.map((t) => (t.kind === "home" ? "Home" : t.title));
  const active = () => (b.active().kind === "home" ? "Home" : b.active().title);
  const settle = (ms = 350) => sleep(ms);
  const pressOnPage = async (spec, ms = 400) => { b.focusPage(); await sleep(120); press(spec); await sleep(ms); };

  // Tabs A B C, B active.
  await K.load(K.dataPage("A"));
  b.newTab(K.dataPage("B"), { index: 1 });
  b.newTab(K.dataPage("C"), { background: true, index: 2 });
  await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading && t.title), { what: "three tabs" });
  await settle();
  check("setup: A B C with B active", titles().join() === "A,B,C" && active() === "B", titles());
  // Real input from the desktop (somebody typing or clicking in the test window) shows up as router
  // actions or tabs this script did not ask for; the log at the end lists every routed key.

  // ------------------------------------------------------------------ new tab, close, reopen
  log("--- tabs");
  await pressOnPage("Ctrl+T", 700);
  check("Ctrl+T opens Home next to the active tab with the address field focused", titles().join() === "A,B,Home,C" && active() === "Home" && b.omni.open && document.activeElement === b.omni.input && b.active().url === "about:vitre-home", { titles: titles(), url: b.active().url, open: b.omni.open });
  await sleep(900); // the tab switch completes in the background; the field must keep focus through it
  check("the field still has focus after the tab switch finished", b.omni.open && document.activeElement === b.omni.input, document.activeElement && document.activeElement.id);
  press("Escape");
  await settle();
  check("Esc closes the field and focus goes to the page", !b.omni.open && document.activeElement === gBrowser.selectedBrowser, document.activeElement && document.activeElement.localName);
  await pressOnPage("Ctrl+W");
  check("Ctrl+W closes the active tab", titles().join() === "A,B,C", titles());
  b.sys("VitreSettings").set({ newTabPosition: "end" });
  await sleep(150);
  await pressOnPage("Ctrl+T", 700);
  check("with 'New tabs open: at the end' Ctrl+T opens at the end", titles().join() === "A,B,C,Home" && active() === "Home", titles());
  b.sys("VitreSettings").reset("newTabPosition");
  press("Escape");
  await settle();
  press("Ctrl+W");
  await settle();
  b.activate(b.tabs[2]);
  await settle();
  await pressOnPage("Ctrl+W");
  check("closing C leaves A B", titles().join() === "A,B", titles());
  await pressOnPage("Ctrl+Shift+T", 900);
  await waitFor(() => b.tabs.length === 3 && b.active().title === "C", { timeout: 15000, what: "reopened tab" });
  check("Ctrl+Shift+T reopens the closed tab at its place and selects it", titles().join() === "A,B,C" && active() === "C", titles());

  // ------------------------------------------------------------------ positional switching
  await pressOnPage("Ctrl+PageDown");
  const wrapped = active();
  await pressOnPage("Ctrl+PageDown");
  const second = active();
  await pressOnPage("Ctrl+PageUp");
  await pressOnPage("Ctrl+PageUp");
  check("Ctrl+PageDown / Ctrl+PageUp go through the bar in order and wrap", wrapped === "A" && second === "B" && active() === "C", { wrapped, second, now: active() });
  await pressOnPage("Ctrl+1");
  const one = active();
  await pressOnPage("Ctrl+2");
  const two = active();
  await pressOnPage("Ctrl+9");
  const last = active();
  await pressOnPage("Ctrl+8");
  check("Ctrl+1, Ctrl+2 go to that tab, Ctrl+9 to the last one, Ctrl+8 with three tabs does nothing", one === "A" && two === "B" && last === "C" && active() === "C", { one, two, last });
  await pressOnPage("Ctrl+Shift+PageUp");
  const moved = titles().join();
  await pressOnPage("Ctrl+Shift+PageUp");
  await pressOnPage("Ctrl+Shift+PageUp");
  const atStart = titles().join();
  await pressOnPage("Ctrl+Shift+PageDown");
  await pressOnPage("Ctrl+Shift+PageDown");
  check("Ctrl+Shift+PageUp / PageDown move the active tab one place and stop at the ends", moved === "A,C,B" && atStart === "C,A,B" && titles().join() === "A,B,C" && active() === "C", { moved, atStart, now: titles() });

  // ------------------------------------------------------------------ Ctrl+Tab, most recently used
  log("--- Ctrl+Tab");
  b.activate(b.tabs[0]);
  await settle();
  b.activate(b.tabs[2]);
  await settle();
  b.activate(b.tabs[1]);
  await settle(); // MRU: B, C, A
  check("MRU order follows use", b.mru.map((id) => b.tab(id).title).join() === "B,C,A", b.mru.map((id) => b.tab(id).title));
  b.focusPage();
  await sleep(150);
  // With the switcher module installed (it owns nextTabMru / prevTabMru) a held Ctrl+Tab shows the
  // switcher and steps its selection; the tab changes only when Ctrl is released. Without it the
  // core's built-in cycle switches tabs as it steps.
  const switcher = b.service("switcher");
  const selectedTitle = () => {
    const st = window.vitreSwitcher?.state?.();
    return st && st.selected !== undefined ? b.tab(st.selected)?.title : undefined;
  };
  down("Control");
  await sleep(40);
  press("Tab");
  await settle();
  const step1 = switcher ? selectedTitle() : active();
  const tab1 = active();
  press("Tab");
  await settle();
  const step2 = switcher ? selectedTitle() : active();
  const tab2 = active();
  const mruWhileHeld = b.mru.map((id) => b.tab(id).title).join();
  up("Control");
  await settle(switcher ? 700 : 350);
  if (switcher) {
    check("Ctrl held, Tab, Tab (switcher module): the switcher steps through C then A while the tab stays B; A is activated and the order committed when Ctrl is released", step1 === "C" && step2 === "A" && tab1 === "B" && tab2 === "B" && mruWhileHeld === "B,C,A" && active() === "A" && b.mru.map((id) => b.tab(id).title).join() === "A,B,C", { step1, step2, tab1, tab2, mruWhileHeld, now: active(), after: b.mru.map((id) => b.tab(id).title) });
  } else {
    check("Ctrl held, Tab, Tab: steps through C then A; the order is committed when Ctrl is released", step1 === "C" && step2 === "A" && mruWhileHeld === "B,C,A" && b.mru.map((id) => b.tab(id).title).join() === "A,B,C", { step1, step2, mruWhileHeld, after: b.mru.map((id) => b.tab(id).title) });
  }
  // A tap: Ctrl down, Tab, Ctrl up (EventUtils' ctrlKey option alone sends no Control key events).
  const tap = async (spec) => { down("Control"); await sleep(30); press(spec); await sleep(60); up("Control"); await settle(); };
  await tap("Tab");
  const tap1 = active();
  await tap("Tab");
  check("a quick Ctrl+Tab goes to the previous tab, and again goes back", tap1 === "B" && active() === "A", { tap1, now: active() });
  await tap("Shift+Tab");
  check("Ctrl+Shift+Tab steps the other way (to the least recent)", active() === "C", active());
  b.sys("VitreSettings").set({ tabOrder: "bar" });
  await sleep(150);
  b.activate(b.tabs[0]);
  await settle();
  await tap("Tab");
  check("with 'Order of tabs: Tab bar order' Ctrl+Tab goes to the tab on the right", active() === "B", active());
  b.sys("VitreSettings").reset("tabOrder");
  await sleep(150);

  // ------------------------------------------------------------------ navigation
  log("--- navigation");
  b.activate(b.tabs[0]);
  await settle();
  const first = b.active();
  await K.load(K.dataPage("A2"));
  check("after a navigation the tab can go back", first.canBack && !first.canForward && first.title === "A2", [first.canBack, first.title]);
  await pressOnPage("Alt+Left", 200);
  await waitFor(() => first.title === "A", { what: "back" });
  await pressOnPage("Alt+Right", 200);
  await waitFor(() => first.title === "A2", { what: "forward" });
  check("Alt+Left goes back, Alt+Right forward", first.canBack && !first.canForward);
  let loads = 0;
  const listener = { onStateChange(br, wp, _r, flags) { if (br === first.browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) loads++; } };
  gBrowser.addTabsProgressListener(listener);
  await pressOnPage("Ctrl+R", 700);
  const afterReload = loads;
  await pressOnPage("F5", 700);
  const afterF5 = loads;
  await pressOnPage("Ctrl+Shift+R", 700);
  gBrowser.removeTabsProgressListener(listener);
  check("Ctrl+R, F5 and Ctrl+Shift+R each reload the page", afterReload === 1 && afterF5 === 2 && loads === 3, { afterReload, afterF5, loads });
  // A page that never finishes loading (an image from an address nothing answers on).
  b.navigate(first, "data:text/html,<title>Slow</title><body>slow<img src='http://10.255.255.1/x.png'>");
  await waitFor(() => first.title === "Slow", { what: "slow page" });
  await sleep(400);
  const wasLoading = first.loading;
  await pressOnPage("Escape", 600);
  check("Esc stops a page that is still loading", wasLoading && !first.loading, { wasLoading, loading: first.loading });

  // ------------------------------------------------------------------ the Esc ladder and the close ladder
  log("--- ladders");
  const used = [];
  const layers = { menu: true, panel: true, peek: true };
  const offs = [
    b.addEscLayer(100, () => layers.peek && (layers.peek = false, used.push("peek 100"), true)),
    b.addEscLayer(20, () => layers.menu && (layers.menu = false, used.push("menu 20"), true)),
    b.addEscLayer(60, () => layers.panel && (layers.panel = false, used.push("panel 60"), true)),
  ];
  for (let i = 0; i < 4; i++) await pressOnPage("Escape", 300);
  check("Esc unwinds one layer per press, lowest priority number first: menu, panel, peek, then nothing", used.join() === "menu 20,panel 60,peek 100", used);
  offs.forEach((off) => off());
  const closed = [];
  const surfaces = { panel: true, peek: true };
  const offClose = [
    b.addCloseLayer(100, () => surfaces.peek && (surfaces.peek = false, closed.push("peek"), true)),
    b.addCloseLayer(60, () => surfaces.panel && (surfaces.panel = false, closed.push("panel"), true)),
  ];
  const count = b.tabs.length;
  await pressOnPage("Ctrl+W", 300);
  await pressOnPage("Ctrl+W", 300);
  check("Ctrl+W closes the topmost surface first: the panel, then the peek, and no tab", closed.join() === "panel,peek" && b.tabs.length === count, { closed, tabs: b.tabs.length });
  offClose.forEach((off) => off());

  // ------------------------------------------------------------------ the peek hook
  log("--- a focused peek gets page keys first");
  const peekCalls = [];
  const fakePeek = b.tabs[1].browser; // stands in for the sheet's page
  window.vitrePeek = { browser: () => fakePeek, close: () => (peekCalls.push("close"), true) };
  b.keys.current = { action: "back", spec: "Alt+Left", how: "page-first/reply", repeat: false, browser: fakePeek };
  b.run("back");
  b.keys.current = null;
  const titleBefore = first.title;
  await sleep(300);
  check("Back from a peek on its first page closes the peek and leaves the tab under it alone", peekCalls.join() === "close" && first.title === titleBefore, { peekCalls, title: first.title });
  b.run("back");
  await waitFor(() => first.title !== titleBefore, { what: "back on the tab" });
  check("when the peek is not focused, Back acts on the tab", peekCalls.length === 1 && first.title === "A2", first.title);
  delete window.vitrePeek;

  // ------------------------------------------------------------------ zoom
  log("--- zoom");
  await K.load("https://example.com/");
  await pressOnPage("Ctrl+Plus", 500);
  const host = () => document.querySelector("#vitre-bar .item.active .host").textContent;
  check("Ctrl+Plus zooms in and the pill shows the level", Math.abs(first.zoom - 1.1) < 0.001 && host() === "110%", { zoom: first.zoom, host: host() });
  await spike.capture("actions-zoom");
  await pressOnPage("Ctrl+Minus", 400);
  await pressOnPage("Ctrl+Minus", 400);
  const out = first.zoom;
  b.newTab("https://example.com/?same-site", { index: 1 });
  const twin = b.active();
  await waitFor(() => !twin.loading && twin.url.includes("same-site"), { timeout: 20000, what: "second example.com tab" });
  await sleep(500);
  check("zoom is per site: another tab on the same site opens at the same level", Math.abs(out - 0.9) < 0.001 && Math.abs(twin.zoom - 0.9) < 0.001, { out, twin: twin.zoom });
  await pressOnPage("Ctrl+0", 500);
  await sleep(2200);
  check("Ctrl+0 resets, and after 2 s the pill shows the host again", twin.zoom === 1 && host() === "example.com", { zoom: twin.zoom, host: host() });
  b.closeTab(twin);
  await settle();

  // ------------------------------------------------------------------ F6
  log("--- F6");
  b.activate(first);
  await settle();
  await pressOnPage("F6", 400);
  const f6open = b.omni.open && document.activeElement === b.omni.input && b.omni.input.value === first.url;
  press("F6");
  await settle();
  const f6back = !b.omni.open && document.activeElement === gBrowser.selectedBrowser;
  await pressOnPage("Shift+F6", 400);
  const sf6 = b.omni.open;
  press("Shift+F6");
  await settle();
  check("F6 moves focus from the page to the address field and back; Shift+F6 does the same the other way", f6open && f6back && sf6 && !b.omni.open, { f6open, f6back, sf6 });
  await pressOnPage("Ctrl+L", 400);
  const lOpen = b.omni.open && b.omni.input.selectionEnd - b.omni.input.selectionStart === first.url.length;
  spike.type("zzz");
  press("Ctrl+L");
  await settle(200);
  check("Ctrl+L opens the field with the address selected; Ctrl+L again puts the address back, selected", lOpen && b.omni.open && b.omni.input.value === first.url && b.omni.input.selectionEnd - b.omni.input.selectionStart === first.url.length, { lOpen, value: b.omni.input.value });
  press("Escape");
  await settle();

  // ------------------------------------------------------------------ view source, full screen, windows
  log("--- view source, full screen, windows");
  const before = b.tabs.length;
  await pressOnPage("Ctrl+U", 900);
  await waitFor(() => b.tabs.length === before + 1 && b.active().url.startsWith("view-source:"), { timeout: 15000, what: "view-source tab" });
  check("Ctrl+U opens the page source in a new tab next to the page", b.tabs.indexOf(b.active()) === b.tabs.indexOf(first) + 1 && b.active().url === "view-source:" + first.url, b.active().url);
  await sleep(600);
  await spike.capture("actions-view-source");
  await pressOnPage("Ctrl+W");

  await pressOnPage("F11", 1200);
  const entered = window.fullScreen && b.root.classList.contains("fullscreen");
  await pressOnPage("F11", 1200);
  check("F11 enters window full screen and F11 again leaves", entered && !window.fullScreen && !b.root.classList.contains("fullscreen"), { entered, now: window.fullScreen });

  // The harness starts on a blank page; the product's own defaults (restore the session, Home as
  // the home page) are what a new window follows.
  Services.prefs.clearUserPref("browser.startup.page");
  Services.prefs.clearUserPref("browser.startup.homepage");
  const opened = new Promise((resolve) => {
    const obs = (win) => { Services.obs.removeObserver(obs, "browser-delayed-startup-finished"); Promise.resolve(win.vitre && win.vitre.whenReady).then(() => resolve(win)); };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  await pressOnPage("Ctrl+N", 300);
  const w2 = await opened;
  await waitFor(() => w2.vitre.active() && w2.vitre.active().url === "about:vitre-home" && !w2.vitre.active().loading, { timeout: 15000, what: "new window on Home" });
  check("Ctrl+N opens a new window on Home", w2 !== window && w2.vitre.tabs.length === 1 && w2.vitre.active().kind === "home", w2.vitre.active().url);
  await w2.spike.resize(900, 620);
  w2.focus();
  w2.vitre.navigate(w2.vitre.active(), K.dataPage("Window two"));
  await waitFor(() => w2.vitre.active().title === "Window two", { timeout: 15000, what: "page in window two" });
  w2.vitre.focusPage();
  await sleep(400);
  K.press("Ctrl+Shift+W", {}, w2);
  await waitFor(() => w2.closed, { timeout: 10000, what: "window two closing" });
  check("Ctrl+Shift+W closes that window, with no prompt", w2.closed && !window.closed);
  window.focus();
  await sleep(500);
  const reopened = new Promise((resolve) => {
    const obs = (win) => { Services.obs.removeObserver(obs, "browser-delayed-startup-finished"); resolve(win); };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  await pressOnPage("Ctrl+Shift+T", 300);
  const w3 = await Promise.race([reopened, sleep(15000).then(() => null)]);
  if (check("Ctrl+Shift+T brings the closed window back", !!w3 && w3 !== window)) {
    await waitFor(() => w3.vitre && w3.vitre.tabs.some((t) => t.title === "Window two"), { timeout: 15000, what: "restored window's tab" });
    check("... with its tab", true);
    w3.close();
    await sleep(600);
  }
  window.focus();
  await sleep(300);

  // ------------------------------------------------------------------ Home key
  log("--- Home key");
  b.activate(first);
  await settle();
  const tabsBeforeHome = b.tabs.length;
  await pressOnPage("BrowserHome", 800);
  const homeTab = b.active();
  check("the Home key opens a Home tab when none is open", homeTab.kind === "home" && b.tabs.length === tabsBeforeHome + 1, titles());
  press("Escape");
  await settle();
  b.activate(first);
  await settle();
  await pressOnPage("BrowserHome", 600);
  check("... and goes to the open Home tab when there is one", b.active() === homeTab && b.tabs.length === tabsBeforeHome + 1, titles());
  b.closeTab(homeTab);
  await settle();

  // ------------------------------------------------------------------ print, quit
  log("--- print, quit");
  b.activate(first);
  await settle();
  await pressOnPage("Ctrl+P", 500);
  let printing = false;
  try {
    await waitFor(() => gBrowser.selectedBrowser.hasAttribute("tabDialogShowing"), { timeout: 20000, what: "print preview" });
    printing = true;
  } catch (e) {
    printing = false;
  }
  check("Ctrl+P opens the print dialog over the page", printing);
  if (printing) {
    await sleep(1500);
    await spike.capture("actions-print");
    const stepsBefore = b.keys.log.length;
    press("Escape");
    let closedPrint = true;
    try {
      await waitFor(() => !gBrowser.selectedBrowser.hasAttribute("tabDialogShowing"), { timeout: 8000, what: "print dialog closing" });
    } catch (e) {
      closedPrint = false;
      gBrowser.getTabDialogBox(gBrowser.selectedBrowser).abortAllDialogs();
      await sleep(500);
    }
    check("Esc closes the print dialog, and that press is not also Vitre's Esc step", closedPrint && !b.keys.log.slice(stepsBefore).some((l) => l.includes("ACTION stop")), b.keys.log.slice(stepsBefore));
  }
  let asked = 0;
  const quitObserver = { observe(subject) { asked++; subject.QueryInterface(Ci.nsISupportsPRBool).data = true; } };
  Services.obs.addObserver(quitObserver, "quit-application-requested");
  b.run("quit");
  Services.obs.removeObserver(quitObserver, "quit-application-requested");
  await sleep(300);
  check("the quit action asks Firefox to quit the application (the test cancels the request)", asked === 1 && !window.closed, asked);

  // ------------------------------------------------------------------ developer tools
  log("--- developer tools");
  b.activate(first);
  await settle();
  const toolbox = () => !!document.querySelector("[class*='devtools-toolbox']");
  await pressOnPage("F12", 500);
  let devOpen = false;
  try {
    await waitFor(toolbox, { timeout: 25000, what: "developer tools" });
    devOpen = true;
  } catch (e) {
    devOpen = false;
  }
  check("F12 opens the developer tools for the page", devOpen);
  if (devOpen) {
    await sleep(1500);
    b.run("devtools");
    let devClosed = true;
    try {
      await waitFor(() => !toolbox(), { timeout: 20000, what: "developer tools closing" });
    } catch (e) {
      devClosed = false;
    }
    check("... and the same action closes them", devClosed);
  }
  await spike.capture("actions-end");
  log("keys routed during this test: " + b.keys.log.filter((l) => l.startsWith("ACTION")).length);
});
