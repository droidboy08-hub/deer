// Settings verifier: several windows. A second window's open panel follows changes made in the
// first, a private window has its own panel, a popup window (window.open with features) sends
// Settings to the normal window instead of scaling the sheet to 40 %, and windows closed with the
// panel open (on Keyboard shortcuts, with a registered page on screen) are collected.
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/windows.js --name settings-verify-windows --timeout 240
// Captures: windows-second.png, windows-private.png, windows-popup-main.png (Settings in the normal
// window after Ctrl+, in the popup), windows-popup.png (the popup itself, left alone).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const store = b.sys("VitreSettings");
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  await V.load(V.page("Main window"));

  // ---------------------------------------------------------------- a second window follows live
  const w2 = await spike.openWindow();
  await w2.spike.resize(1200, 800);
  await sleep(400);
  w2.vitre.service("settings").open("appearance");
  b.service("settings").open("appearance");
  await sleep(500);
  const seg = (win, label) => [...V.content(win).querySelectorAll(".vs-seg-btn")].find((x) => x.textContent === label);
  seg(window, "Dark").click();
  await sleep(400);
  check("Mode chosen in one window: the other window's open panel shows it at once", seg(w2, "Dark").getAttribute("aria-checked") === "true" && w2.vitre.settings.theme === "dark");
  b.service("settings").open("shortcuts");
  w2.vitre.service("settings").open("shortcuts");
  await sleep(400);
  store.set({ rebind: { peekLink: "Ctrl+Shift+Y" } });
  await sleep(300);
  const keyText = (win) => V.root(win).querySelector('[data-rebind="peekLink"] .vs-keybtn')?.textContent;
  check("a rebind shows in both windows' Keyboard shortcuts", keyText(window) === "Ctrl+Shift+Y" && keyText(w2) === "Ctrl+Shift+Y", [keyText(window), keyText(w2)]);
  await w2.spike.capture("windows-second");
  store.set({ rebind: {} });
  V.panel(w2).close();
  V.panel().close();
  await sleep(300);
  w2.close();
  await sleep(500);

  // ---------------------------------------------------------------- a private window
  const pw = await spike.openWindow({ private: true });
  await pw.spike.resize(1280, 820);
  await sleep(500);
  V.press("Ctrl+Comma", {}, pw);
  await sleep(200);
  pw.vitre.service("settings").open("privacy");
  await sleep(600);
  check("a private window has its own panel", pw.vitre.isPrivate && V.isOpen(pw) && V.shown(pw) === "privacy" && !V.panel().isOpen);
  await pw.spike.capture("windows-private");
  V.press("Escape", {}, pw);
  await sleep(400);
  check("Esc closes it there", !V.panel(pw).isOpen);
  pw.close();
  await sleep(500);
  await spike.activate();

  // ---------------------------------------------------------------- a popup window
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  await V.load(V.page("Opener", "<p style='margin:120px 40px'><a id=a href='#' onclick=\"const w = window.open('about:blank', 'p', 'width=420,height=320'); w.document.write('<title>Popup</title><body style=background:#eef>A popup'); return false\" style='display:inline-block;width:300px;height:80px;background:#246;color:#fff'>open a popup</a></p>"));
  const known = new Set(browsers());
  const a = await V.inPage(function (w, d) { const r = d.getElementById("a").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  spike.click(br.left + a.x, br.top + a.y);
  let pop = null;
  for (let i = 0; i < 80 && !pop; i++) {
    await sleep(100);
    pop = browsers().find((w) => !known.has(w) && !w.closed);
  }
  if (pop) {
    await waitFor(() => { try { return pop.document.readyState === "complete" && pop.vitre?.ready; } catch { return false; } }, { timeout: 10000, what: "popup ready" });
    await sleep(800);
    check("the popup window is a Vitre popup", pop.vitre.isPopup === true, [pop.innerWidth, pop.innerHeight]);
    pop.focus();
    await sleep(300);
    V.press("Ctrl+Comma", {}, pop);
    await waitFor(() => V.isOpen(), { timeout: 3000, what: "Settings in the main window" }).catch(() => null);
    await sleep(500);
    check("Ctrl+, in a popup opens Settings in the normal window, not in the 420 px popup", V.isOpen() && !V.panel(pop).isOpen && !pop.document.querySelector("#vitre-settings:not([hidden])"), { main: V.panel().isOpen, popup: V.panel(pop).isOpen });
    check("…and the normal window comes to the front", Services.focus.activeWindow === window, Services.focus.activeWindow === pop ? "popup" : "other");
    await spike.capture("windows-popup-main");
    V.panel().close();
    await sleep(300);
    pop.focus();
    await sleep(300);
    V.press("F1", {}, pop);
    await sleep(600);
    check("F1 in the popup: Keyboard shortcuts in the normal window", V.isOpen() && V.shown() === "shortcuts" && !V.panel(pop).isOpen);
    V.panel().close();
    await sleep(300);
    pop.vitre.service("settings").open("downloads");
    await sleep(500);
    check("the popup's settings service sends open() to the normal window too", V.isOpen() && V.shown() === "downloads" && !V.panel(pop).isOpen);
    V.panel().close();
    await sleep(300);
    await pop.spike.capture("windows-popup");
    pop.close();
    await sleep(600);
  } else check("a popup window opened", false);
  Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
  await spike.activate();

  // ---------------------------------------------------------------- leaks
  async function useAndClose(how) {
    let win = await spike.openWindow(how === "private" ? { private: true } : {});
    const refs = { document: Cu.getWeakReference(win.document), vitre: Cu.getWeakReference(win.vitre), panel: Cu.getWeakReference(win.vitreSettingsPanel.panel), bg: Cu.getWeakReference(win.vitreSettingsPanel.bg) };
    await sleep(400);
    const s = win.vitre.service("settings");
    for (const id of ["general", "appearance", "home", "tabs", "downloads", "privacy", "search", "about", "shortcuts"]) {
      s.open(id);
      await sleep(250);
    }
    s.open(undefined, "caret");
    await sleep(250);
    s.open("shortcuts");
    await sleep(250);
    let cleaned = false;
    if (how === "registered") {
      s.registerPage({ id: "leak-page", title: "Leak page", order: 95, render: (host) => { host.append(win.document.createElement("p")); return () => (cleaned = true); } });
      s.open("leak-page");
      await sleep(250);
    }
    // Left open on purpose: the window closes with the panel on screen.
    win.close();
    win = null;
    await sleep(500);
    return { refs, cleaned: () => cleaned };
  }
  const cases = [["a window closed with Settings open on Keyboard shortcuts", "plain"], ["a private one", "private"], ["one with a registered page on screen", "registered"]];
  const results = [];
  for (const [name, how] of cases) results.push([name, how, await useAndClose(how)]);
  await sleep(800);
  await V.gc();
  await sleep(2000);
  await V.gc();
  store.set({ closeButton: "always" });
  await sleep(150);
  store.reset("closeButton");
  Services.prefs.setBoolPref("accessibility.browsewithcaret", true);
  Services.prefs.clearUserPref("accessibility.browsewithcaret");
  await V.gc();
  for (const [name, how, r] of results) {
    const alive = Object.entries(r.refs).filter(([, ref]) => ref.get() !== null).map(([k]) => k);
    check(`${name}: collected after close`, alive.length === 0, "still reachable: " + alive.join(", "));
    if (how === "registered") check("…and the registered page's clean-up ran when its window closed", r.cleaned());
  }
  store.reset("theme");
  await sleep(200);
  V.consoleCheck("windows");
});
