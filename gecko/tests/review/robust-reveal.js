// Robustness review: auto-hide and full screen in combination with the address field, focus,
// element full screen, window state changes and rapid toggling.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-reveal.js --name review-robust-reveal --timeout 240
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s, d = document) => d.querySelector(s);
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const settings = b.sys("VitreSettings");
  const pointer = (x, y) => spike.EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
  const hidden = () => waitFor(() => b.bar.hidden, { timeout: 4000, what: "bar hiding" }).then(() => true, () => false);
  const shown = () => waitFor(() => !b.bar.hidden, { timeout: 4000, what: "bar showing" }).then(() => true, () => false);
  const state = () => ({ hidden: b.bar.hidden, hiding: b.bar.state.hiding, revealed: b.bar.state.revealed, classes: b.root.className, inert: $("#vitre-bar").hasAttribute("inert"), omni: b.omni.open, fs: window.fullScreen });

  await R.load(R.page("Reveal", "<input id=i style='position:fixed;left:100px;top:300px;width:300px;height:30px'>"));
  const t = b.active();
  pointer(640, 500);

  // ---- 1. auto-hide and the address field ----
  log("--- 1. auto-hide + address field");
  settings.set({ barAutoHide: true });
  check("auto-hide: the bar hides", await hidden(), state());
  spike.press("Ctrl+L");
  await sleep(500);
  check("auto-hide: Ctrl+L reveals the bar with the field open", !b.bar.hidden && b.omni.open && b.omni.focused, state());
  spike.press("Escape");
  await sleep(200);
  check("auto-hide: Esc closes the field and the bar leaves again", !b.omni.open && (await hidden()), state());
  // Typing on Home opens the field: the bar must come with it.
  const home = b.newTab();
  await waitFor(() => home.url === "about:vitre-home" && b.omni.open, { timeout: 8000, what: "Home with the field" });
  check("auto-hide: Ctrl+T shows the bar with the new tab's field", !b.bar.hidden, state());
  spike.press("Escape");
  await hidden();
  spike.type("q");
  await sleep(400);
  check("auto-hide: typing on Home opens the field and reveals the bar", b.omni.open && !b.bar.hidden && b.omni.input.value === "q", state());
  spike.press("Escape");
  spike.press("Escape");
  await sleep(300);
  b.closeTab(home);
  await sleep(300);
  check("auto-hide: hidden again after the Home tab closes", await hidden(), state());

  // Keyboard focus in the bar keeps it; Esc returns to the page and it leaves.
  spike.press("Ctrl+L");
  await sleep(400);
  spike.press("Tab");
  await sleep(300);
  check("auto-hide: Tab from the field moves focus into the bar, which stays", $("#vitre-bar").contains(document.activeElement) && !b.bar.hidden, { focus: document.activeElement?.className, hidden: b.bar.hidden });
  spike.press("Escape");
  await sleep(300);
  check("auto-hide: Esc from the bar returns to the page and the bar leaves", document.activeElement?.localName === "browser" && (await hidden()), { focus: document.activeElement?.localName, hidden: b.bar.hidden });

  // ---- 2. pointer rules ----
  log("--- 2. pointer");
  pointer(640, 10);
  check("pointer within 28 px of the top reveals", await shown());
  pointer(640, 60);
  await sleep(700);
  check("pointer resting on the bar (above 76 px) keeps it", !b.bar.hidden);
  pointer(640, 300);
  check("pointer down the page: it leaves after 400 ms", await hidden());
  // Leaving through the top edge (into the resize band): counts as resting at the top.
  pointer(640, 20);
  await shown();
  spike.EU.synthesizeMouseAtPoint(640, -5, { type: "mousemove" }, window);
  const out = new MouseEvent("mouseout", { relatedTarget: null, bubbles: true, clientX: 640, clientY: 0 });
  document.documentElement.dispatchEvent(out);
  await sleep(900);
  check("pointer leaving through the top edge keeps the bar", !b.bar.hidden, state());
  // A deactivated window lets go.
  window.dispatchEvent(new Event("deactivate"));
  check("window deactivated: the bar leaves", await hidden(), state());

  // ---- 3. window state changes while hidden ----
  log("--- 3. window state");
  window.maximize();
  await sleep(900);
  check("maximize while auto-hidden: still hidden, nothing stuck", b.bar.hidden && b.root.classList.contains("maximized"), state());
  pointer(640, 5);
  check("maximized: reveal at the top edge", await shown());
  pointer(640, 400);
  await hidden();
  window.restore();
  await sleep(900);
  check("restore: still hidden", b.bar.hidden && !b.root.classList.contains("maximized"), state());

  // ---- 4. F11 on top of auto-hide, and rapid toggling ----
  log("--- 4. F11");
  b.run("fullscreen");
  await waitFor(() => window.fullScreen, { timeout: 6000 }).catch(() => {});
  await sleep(800);
  check("F11 with auto-hide: hidden", b.bar.hidden && b.root.classList.contains("fullscreen"), state());
  spike.press("Ctrl+L");
  await sleep(500);
  check("F11: Ctrl+L reveals with the field", !b.bar.hidden && b.omni.open, state());
  spike.press("Escape");
  check("F11: Esc, and it leaves", await hidden(), state());
  // Quick toggles: the widget drops a toggle that lands during a transition (Firefox's own
  // behaviour), so the parity is not asserted; the bar must mirror whatever window.fullScreen is.
  const mirrors = () => b.root.classList.contains("fullscreen") === !!window.fullScreen && (window.fullScreen ? b.bar.hidden : b.root.classList.contains("bar-hiding") === !!b.settings.barAutoHide);
  for (let i = 0; i < 6; i++) { b.run("fullscreen"); await sleep(120); }
  await sleep(2000);
  log("after 6 quick F11 toggles:", state());
  check("6 quick F11 toggles (auto-hide on): the bar mirrors the window's full-screen state", mirrors() && b.bar.hidden, state());
  if (window.fullScreen) { b.run("fullscreen"); await waitFor(() => !window.fullScreen, { timeout: 6000 }).catch(() => {}); await sleep(1000); }
  settings.set({ barAutoHide: false });
  await shown();
  for (let i = 0; i < 5; i++) { b.run("fullscreen"); await sleep(100); }
  await sleep(2000);
  log("after 5 quick F11 toggles:", state());
  check("5 quick F11 toggles (auto-hide off): the bar mirrors the window's full-screen state", mirrors(), state());
  if (window.fullScreen) { b.run("fullscreen"); await waitFor(() => !window.fullScreen, { timeout: 6000 }).catch(() => {}); }
  await sleep(1000);
  check("...and back: the bar is shown, no hiding class", !window.fullScreen && !b.bar.hidden && !b.root.classList.contains("bar-hiding") && !$("#vitre-bar").hasAttribute("inert"), state());

  // ---- 5. element full screen while auto-hidden, with the field open ----
  log("--- 5. element full screen");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  settings.set({ barAutoHide: true });
  await hidden();
  await spike.activate();
  b.focusPage();
  await R.inPage("function(w, d){ d.documentElement.requestFullscreen().catch(() => {}); return 1; }");
  const dom = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000 }).then(() => true, () => false);
  if (dom) {
    await sleep(600);
    check("element full screen: the layer is gone", getComputedStyle(b.root).display === "none" && b.root.classList.contains("element-fullscreen"), state());
    // Ctrl+L in element full screen: nothing should open (the layer is not drawn).
    spike.press("Ctrl+L");
    await sleep(400);
    check("element full screen: Ctrl+L opens no field", !b.omni.open, state());
    document.exitFullscreen();
    await waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 5000 }).catch(() => {});
    await sleep(900);
    check("after element full screen: layer back, still in auto-hide mode and hidden", getComputedStyle(b.root).display !== "none" && b.root.classList.contains("bar-hiding") && b.bar.hidden, state());
  } else log("SKIP element full screen not granted");
  settings.set({ barAutoHide: false });
  await shown();

  // ---- 6. a hold that is released after the window is already hidden / a hold during F11 exit ----
  log("--- 6. holds");
  settings.set({ barAutoHide: true });
  await hidden();
  const release = b.bar.hold("review");
  await shown();
  b.run("fullscreen");
  await waitFor(() => window.fullScreen, { timeout: 6000 }).catch(() => {});
  await sleep(800);
  check("a hold keeps the bar through entering F11", !b.bar.hidden, state());
  release();
  check("released: it leaves (in F11)", await hidden(), state());
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen, { timeout: 6000 }).catch(() => {});
  await sleep(800);
  check("out of F11, auto-hide still on: hidden", b.bar.hidden && b.root.classList.contains("bar-hiding"), state());
  settings.set({ barAutoHide: false });
  await shown();

  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("reveal");
});
