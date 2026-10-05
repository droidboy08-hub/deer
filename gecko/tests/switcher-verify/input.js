// Switcher verification of the input paths the builder left untested: Sticky Keys (the switcher opens
// latched and Ctrl's early release does not commit), IME composition into the latched field, AltGr
// characters, Ctrl+Alt+Tab ignored, and the Sticky Keys registry reader itself.
// python tools/run.py --test tests/switcher-verify/input.js --name swverify-input --app build-switcher-verify --timeout 240
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const names = ["Alpha", "Bravo glass", "Charlie", "Delta"];
  await V.openTabs(names.map((n) => V.page(n, "#f4f1ea")));
  const byName = (n) => b.tabs.find((t) => t.title === n);
  const reset = async () => {
    await V.visit(["Delta", "Charlie", "Bravo glass", "Alpha"].map(byName));
    b.focusPage();
    await sleep(200);
  };
  await reset();
  const store = b.sys("VitreSwitcher");

  // ---- 1. the Sticky Keys reader ----
  let real;
  try {
    real = store.stickyKeys();
  } catch (e) {
    real = "threw " + e;
  }
  check("the Sticky Keys reader answers a boolean from the registry (no throw)", typeof real === "boolean", real);

  // ---- 2. Sticky Keys on: Ctrl lets go right after Tab, the switcher opens latched ----
  const original = store.stickyKeys;
  store.stickyKeys = () => true;
  try {
    down("Control");
    press("Tab");
    up("Control"); // Sticky Keys releases Ctrl after the next key
    await waitFor(() => state().phase === "open", { timeout: 2000, what: "latched by Sticky Keys" });
    await sleep(400);
    const st = { ...state(), active: V.active() };
    check("Sticky Keys: Ctrl+Tab opens the switcher latched on the previous tab; the early Ctrl release neither commits nor closes it", st.latched && st.phase === "open" && V.sel() === "Bravo glass" && st.active === "Alpha", st);
    press("Right");
    await sleep(80);
    press("Enter");
    await V.closed();
    check("... Right then Enter opens the next card", V.active() === "Charlie", V.active());
  } finally {
    store.stickyKeys = original;
  }
  await reset();

  // ---- 3. IME composition into the latched field ----
  press("Shift+A", { ctrlKey: true });
  await waitFor(() => state().phase === "open", { what: "search" });
  await sleep(300);
  const EU = V.EU;
  EU.synthesizeCompositionChange({ composition: { string: "gla", clauses: [{ length: 3, attr: EU.COMPOSITION_ATTR_RAW_CLAUSE }] }, caret: { start: 3, length: 0 } }, window);
  await sleep(150);
  const composing = { ...state() };
  EU.synthesizeComposition({ type: "compositioncommitasis" }, window);
  await sleep(200);
  const committed = { ...state() };
  log("ime", { composing, committed });
  check("IME: composed text goes to the field and searches; the commit keeps it", committed.query === "gla" && committed.list.length === 1 && V.sel() === "Bravo glass" && committed.phase === "open", { composing: composing.query, committed });
  press("Escape");
  await V.closed();

  // ---- 4. AltGr characters while held ----
  await V.holdOpen(1);
  // AltGr+Q ('@' on a German layout) with Ctrl still held for the switcher.
  const seen = [];
  const spy = (e) => seen.push(`${e.type}:${e.key}:c${+e.ctrlKey}a${+e.altKey}g${+e.getModifierState("AltGraph")}`);
  window.addEventListener("keydown", spy, true);
  window.addEventListener("keypress", spy, true);
  EU.synthesizeKey("@", { ctrlKey: true, altKey: true, altGraphKey: true, code: "KeyQ", keyCode: 81 }, window);
  await sleep(200);
  window.removeEventListener("keydown", spy, true);
  window.removeEventListener("keypress", spy, true);
  const altgr = { ...state() };
  log("altgr events", seen, "state", altgr);
  up("Control");
  await sleep(300);
  // Synthesized with Ctrl and Alt set, the editor inserts nothing (it ignores Ctrl/Alt keypresses), so
  // this only shows what the switcher does with such a key; what Windows really sends for AltGr with
  // the switcher's Ctrl held cannot be produced in-process. Logged, not asserted.
  log("AltGr+Q with Ctrl held (synthesized Ctrl+Alt+AltGraph):", { query: altgr.query, latched: altgr.latched, after: state().phase });
  if (state().phase !== "idle") {
    press("Escape");
    await V.closed();
  }
  await reset();
  // Held, an AltGr character that arrives as the character with AltGraph (Windows hands AltGr text
  // over with AltGraph, not Ctrl+Alt) is search text, never taken for a missing Ctrl release.
  await V.holdOpen(1);
  const seen2 = [];
  const spy2 = (e) => seen2.push(`${e.type}:${e.key}:c${+e.ctrlKey}a${+e.altKey}g${+e.getModifierState("AltGraph")}`);
  window.addEventListener("keydown", spy2, true);
  EU.synthesizeKey("@", { altGraphKey: true, code: "KeyQ", keyCode: 81 }, window);
  window.removeEventListener("keydown", spy2, true);
  await sleep(200);
  const heldAltGr = { ...state(), active: V.active(), events: seen2 };
  up("Control");
  await sleep(300);
  check("held: an AltGr character types @ and latches (no commit); letting go of Ctrl keeps the switcher open", heldAltGr.query === "@" && heldAltGr.latched && heldAltGr.active === "Alpha" && state().phase === "open", { heldAltGr, now: state().phase });
  if (state().phase !== "idle") {
    press("Escape");
    await V.closed();
  }
  await reset();
  // Latched (Ctrl up), AltGr characters arrive as the character with AltGraph: they go to the field.
  press("Shift+A", { ctrlKey: true });
  await waitFor(() => state().phase === "open", { what: "search for AltGr" });
  await sleep(300);
  EU.synthesizeKey("@", { altGraphKey: true, code: "KeyQ", keyCode: 81 }, window);
  await sleep(200);
  const latchedAltGr = { ...state() };
  check("latched: an AltGr character (@, AltGr+Q) types into the search field", latchedAltGr.query === "@" && latchedAltGr.phase === "open", latchedAltGr);
  press("Escape");
  await V.closed();
  await reset();

  // ---- 5. Ctrl+Alt+Tab is not Ctrl+Tab ----
  down("Control");
  press("Tab", { altKey: true });
  await sleep(300);
  const cat = state().phase;
  up("Control");
  await sleep(300);
  check("Ctrl+Alt+Tab (AltGr+Tab is Windows' task switcher) opens nothing and switches nothing", cat === "idle" && V.active() === "Alpha", { cat, active: V.active() });

  const c = V.consoleDump("input");
  check("no console errors from Vitre on these input paths", c.vitre === 0, c);
});
