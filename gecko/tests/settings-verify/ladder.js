// Settings verifier: the panel is the topmost surface. Page keys must not act on the page hidden
// under it, Esc must close it even over a tab prompt (alert, print preview), the Esc and Ctrl+W
// ladders inside it, element full screen, and rapid repeated input.
//   node tools/build.mjs --out=build-settings-verify --modules=settings
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/ladder.js --name settings-verify-ladder --timeout 240
// Captures (tests/settings-verify/out/ladder): ladder-alert.png (Settings over an alert),
// ladder-print.png (over print preview), ladder-fullscreen.png (opened from element full screen).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const svc = b.service("settings");
  const store = b.sys("VitreSettings");
  const dialog = () => gBrowser.selectedBrowser.hasAttribute("tabDialogShowing");
  const abortDialogs = async () => {
    try {
      gBrowser.getTabDialogBox(gBrowser.selectedBrowser).abortAllDialogs();
    } catch (e) {
      log("abortAllDialogs: " + e);
    }
    await waitFor(() => !dialog(), { timeout: 4000, what: "dialogs gone" }).catch(() => null);
    await sleep(300);
  };

  // Counters for Vitre's page verbs (their modules are not in this build: the router runs whatever is registered).
  const verbs = { peekLink: 0, openAsTab: 0, downloadVideo: 0 };
  for (const a of Object.keys(verbs)) b.registerAction(a, () => verbs[a]++);
  let loads = 0;
  b.on("tab-loading", (_t, br, loading) => {
    if (loading && br === gBrowser.selectedBrowser) loads++;
  });

  const fsBody = "<p style='margin:120px 40px'>Second page <a href='https://example.com/'>a link</a></p><div id=v style='width:420px;height:220px;margin:0 40px;background:#2f5d73'></div>";
  await V.load(V.page("First page"));
  await V.load(V.page("Second page", fsBody));
  check("setup: the active tab has a page to go back to", gBrowser.selectedBrowser.canGoBack && b.active().title === "Second page", b.active().title);
  const tabs0 = b.tabs.length;

  const openFromPage = async () => {
    b.focusPage();
    await sleep(150);
    V.press("Ctrl+Comma");
    await waitFor(() => V.isOpen(), { timeout: 3000, what: "Settings open" });
    await sleep(350);
  };

  // ---------------------------------------------------------------- page keys over the panel
  await openFromPage();
  const zoom0 = gBrowser.selectedBrowser.fullZoom;
  loads = 0;
  for (const k of ["Ctrl+R", "F5", "Ctrl+Shift+R", "Ctrl+F5", "Ctrl+Plus", "Ctrl+Minus", "Alt+Left", "Ctrl+U", "Ctrl+Q", "Alt+Enter", "Ctrl+Shift+D", "Ctrl+P"]) {
    V.press(k);
    await sleep(120);
  }
  await sleep(1500);
  const after = { loads, zoom: gBrowser.selectedBrowser.fullZoom, title: b.active().title, tabs: b.tabs.length, dialog: dialog(), verbs: { ...verbs } };
  check("with Settings open, reload / hard reload keys do not reload the page under it", after.loads === 0, after);
  check("…zoom keys do not zoom it", Math.abs(after.zoom - zoom0) < 0.001, after.zoom);
  check("…Alt+Left does not take it back", after.title === "Second page", after.title);
  check("…Ctrl+U opens no view-source tab", after.tabs === tabs0, after.tabs);
  check("…Ctrl+P opens no Print under the panel", !after.dialog);
  check("…Ctrl+Q, Alt+Enter and Ctrl+Shift+D do not run Peek, Open as tab or Download this video", after.verbs.peekLink === 0 && after.verbs.openAsTab === 0 && after.verbs.downloadVideo === 0, after.verbs);
  check("…and the panel stays open with focus inside", V.isOpen() && V.focusInSheet(), V.describe(V.active()));
  if (after.dialog) await abortDialogs();

  // Tab and window keys still act on the window, under the panel.
  const extra = b.newTab(V.page("Third page"), { background: true });
  await waitFor(() => extra.title === "Third page" && !extra.loading, { timeout: 10000, what: "third tab" });
  if (!V.isOpen()) svc.open("general");
  await sleep(300);
  V.press(`Ctrl+${b.tabs.indexOf(extra) + 1}`);
  await sleep(500);
  check("Ctrl+digit switches tabs under the open panel; the panel keeps focus", b.active() === extra && V.isOpen() && V.focusInSheet(), { active: b.active()?.title, open: V.isOpen(), focus: V.describe(V.active()) });
  V.press("Ctrl+1");
  await sleep(400);
  b.closeTab(extra);
  await sleep(300);
  b.activate(b.tabs[0]);
  await sleep(300);
  panel.close();
  await sleep(400);

  // The same keys act on the page again once the panel is closed.
  b.focusPage();
  await sleep(150);
  V.press("Ctrl+Plus");
  await sleep(500);
  const zoomed = gBrowser.selectedBrowser.fullZoom;
  V.press("Ctrl+0");
  await sleep(300);
  V.press("Ctrl+Q");
  await sleep(500);
  check("with the panel closed the page keys work again (zoom, Ctrl+Q)", zoomed > zoom0 + 0.01 && verbs.peekLink === 1, { zoomed, peek: verbs.peekLink });

  // ---------------------------------------------------------------- Esc over a tab prompt
  b.focusPage();
  await sleep(150);
  void V.inPage(function (w) { w.setTimeout(() => w.alert("A page prompt"), 30); return 1; });
  await waitFor(dialog, { timeout: 5000, what: "alert" });
  await sleep(500);
  V.press("Ctrl+Comma");
  await waitFor(() => V.isOpen(), { timeout: 3000, what: "Settings over the alert" }).catch(() => null);
  await sleep(400);
  check("Ctrl+, with an alert showing opens Settings over it", V.isOpen() && dialog() && V.focusInSheet());
  await spike.capture("ladder-alert");
  V.press("Escape");
  await sleep(500);
  check("Esc closes Settings first; the alert stays", !panel.isOpen && dialog(), { open: panel.isOpen, dialog: dialog(), log: b.keys.log.slice(-2) });
  await abortDialogs();

  b.focusPage();
  await sleep(150);
  b.run("print");
  await waitFor(dialog, { timeout: 8000, what: "print preview" }).catch(() => null);
  await sleep(1200);
  const printing = dialog();
  log("print preview showing:", printing);
  if (printing) {
    svc.open("privacy");
    await sleep(500);
    await spike.capture("ladder-print");
    V.press("Escape");
    await sleep(500);
    check("Settings opened over print preview closes on Esc (print preview stays)", !panel.isOpen && dialog(), { open: panel.isOpen, dialog: dialog() });
    await abortDialogs();
  }

  // ---------------------------------------------------------------- the ladder inside the panel
  await openFromPage();
  svc.open("appearance");
  await sleep(300);
  const dd = V.rowFor("Show the tab bar").querySelector(".vs-dd");
  dd.focus();
  V.press("Alt+Down");
  await sleep(250);
  check("Alt+Down opens a drop-down list", !!V.sheet().querySelector(".vs-pop") && dd.getAttribute("aria-expanded") === "true");
  V.press("Escape");
  await sleep(250);
  check("Esc closes only the list; focus back on its box", !V.sheet().querySelector(".vs-pop") && panel.isOpen && V.active() === dd, V.describe(V.active()));
  dd.click();
  await sleep(250);
  const tabsW = b.tabs.length;
  V.press("Ctrl+W");
  await sleep(400);
  check("Ctrl+W with a list open closes the panel, no tab", !panel.isOpen && !V.sheet().querySelector(".vs-pop") && b.tabs.length === tabsW, { open: panel.isOpen, tabs: b.tabs.length });

  await openFromPage();
  const search = V.root().querySelector(".vs-search-input");
  V.press("Ctrl+F");
  await sleep(200);
  spike.type("speed");
  await sleep(300);
  V.press("Escape");
  await sleep(200);
  check("Esc in Find a setting clears the text first", panel.isOpen && search.value === "" && V.shown() !== "results");
  V.press("Escape");
  await sleep(400);
  check("…then closes the panel, focus back on the page", !panel.isOpen && V.active() === gBrowser.selectedBrowser, V.describe(V.active()));

  await openFromPage();
  svc.open("shortcuts");
  await sleep(400);
  const keyRow = () => V.root().querySelector('[data-rebind="peekLink"]');
  keyRow().querySelector(".vs-keybtn").click();
  await sleep(250);
  check("the key capture field has focus", !!V.active()?.closest("[data-key-capture]"));
  V.press("Escape");
  await sleep(250);
  check("Esc cancels the capture only", panel.isOpen && !keyRow().querySelector("[data-key-capture]") && V.active() === keyRow().querySelector(".vs-keybtn"), V.describe(V.active()));
  V.press("Escape");
  await sleep(400);
  check("the next Esc closes the panel", !panel.isOpen);

  // ---------------------------------------------------------------- rapid repeated input
  b.focusPage();
  await sleep(150);
  for (let i = 0; i < 9; i++) {
    V.press("Ctrl+Comma");
    await sleep(25);
  }
  await sleep(500);
  check("9 quick Ctrl+, leave it open and whole", V.isOpen() && V.root().classList.contains("open") && !V.root().classList.contains("closing") && b.root.classList.contains("settings-open") && V.focusInSheet(), V.root().className);
  V.press("Ctrl+Comma");
  await sleep(500);
  check("the tenth closes it, hidden after its motion", !panel.isOpen && V.root().hidden && !b.root.classList.contains("panel-open"));
  V.press("Ctrl+Comma");
  V.press("Ctrl+Comma", { repeat: true });
  V.press("Ctrl+Comma", { repeat: true });
  await sleep(400);
  check("auto-repeat of Ctrl+, does not toggle it again", V.isOpen());
  panel.close();
  await sleep(40);
  svc.open("tabs");
  await sleep(500);
  check("reopened during its close motion: shown and stays shown (no stale hide)", V.isOpen() && V.shown() === "tabs" && getComputedStyle(V.sheet()).visibility !== "hidden");
  let rendered = 0;
  let cleaned = 0;
  const off = svc.registerPage({ id: "verify-count", title: "Count", order: 99, render: () => (rendered++, () => cleaned++) });
  for (const id of ["general", "verify-count", "home", "verify-count", "privacy", "verify-count", "shortcuts", "verify-count"]) svc.open(id);
  await sleep(800);
  check("quick page changes: one page on screen, every registered render cleaned up but the last", V.shown() === "verify-count" && rendered === 4 && cleaned === 3 && V.content().querySelectorAll(".vs-h1").length === 1, { shown: V.shown(), rendered, cleaned });
  panel.close();
  await sleep(300);
  check("closing cleans up the last one", cleaned === 4, cleaned);
  off();
  // The registry changing while Find a setting shows results.
  const late = { id: "verify-late", title: "Late page", order: 98, keywords: "latecomer", render: () => () => {} };
  let offLate = svc.registerPage(late);
  svc.open(undefined, "latecomer");
  await sleep(300);
  const listed = () => [...V.content().querySelectorAll(".vs-title")].some((x) => x.textContent === "Late page");
  check("results list a registered page", V.shown() === "results" && listed());
  offLate();
  await sleep(200);
  check("removing it while its result is on screen takes the result away", V.shown() === "results" && !listed());
  offLate = svc.registerPage(late);
  await sleep(200);
  check("registering it while the results are on screen adds it", listed());
  offLate();
  panel.close();
  await sleep(300);

  // ---------------------------------------------------------------- element full screen
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  b.focusPage();
  await sleep(150);
  await V.inPage(function (w, d) { d.getElementById("v").requestFullscreen().catch(() => {}); return 1; });
  const inFs = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 5000, what: "element full screen" }).then(() => true, () => false);
  await sleep(900);
  log("element full screen:", inFs);
  if (inFs) {
    b.focusPage();
    await sleep(150);
    V.press("Ctrl+Comma");
    await waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen") && V.isOpen(), { timeout: 5000, what: "out of full screen, Settings open" }).catch(() => null);
    await sleep(600);
    check("Ctrl+, in element full screen leaves it and opens Settings where it can be seen", !document.documentElement.hasAttribute("inDOMFullscreen") && V.isOpen() && getComputedStyle(b.root).display !== "none" && V.focusInSheet(), { fs: document.documentElement.hasAttribute("inDOMFullscreen"), open: panel.isOpen, display: getComputedStyle(b.root).display });
    await spike.capture("ladder-fullscreen");
    V.press("Escape");
    await sleep(400);
    check("…and Esc then closes it", !panel.isOpen);
  } else check("element full screen could be entered for the test", false);
  Services.prefs.clearUserPref("full-screen-api.allow-trusted-requests-only");
  store.reset("theme");
  await sleep(200);
  V.consoleCheck("ladder");
});
