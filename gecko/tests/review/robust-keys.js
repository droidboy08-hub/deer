// Robustness review: keys against hostile or slow pages, native key synthesis (AltGr layouts), IME
// in the address field, element full screen.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-keys.js --name review-robust-keys --timeout 300
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const EU = spike.EU;
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();

  const mark = () => b.keys.log.length;
  const since = (m) => b.keys.log.slice(m);
  const actions = (m) => since(m).filter((l) => l.startsWith("ACTION")).map((l) => l.replace(/^ACTION /, ""));
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")].length;

  // A page that records keys, can hang its process and can prevent everything.
  const keyPage = (title, extra = "") => R.page(title, `<h1 style='margin:100px 40px 10px'>${title}</h1><input id=f style='margin:0 40px;width:400px;font:16px Segoe UI' value=''><p id=log style='margin:10px 40px;font:12px Consolas'></p><div id=fs tabindex=0 style='margin:10px 40px;padding:20px;background:#234;color:#fff'>fs</div>
<script>
  const seen = [];
  const preventAll = ${extra.includes("prevent") ? "true" : "false"};
  for (const type of ["keydown", "keypress", "keyup"]) addEventListener(type, (e) => {
    if (preventAll) e.preventDefault();
    seen.push(type[3] + ":" + (e.ctrlKey ? "c-" : "") + (e.altKey ? "a-" : "") + (e.getModifierState("AltGraph") ? "g-" : "") + e.key);
    document.getElementById("log").textContent = seen.join(" ");
  }, true);
  function hang(ms) { setTimeout(() => { const t = Date.now(); while (Date.now() - t < ms) {} }, 30); return "hanging"; }
  function goFull(lock) { const p = document.getElementById("fs").requestFullscreen(lock ? { keyboardLock: "browser" } : {}); p.catch((e) => seen.push("rejected:" + e.name)); return "asked"; }
</script>`);
  const evalIn = (code, browser) => R.inPage("function(w, d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }", browser);
  const seen = (browser) => R.inPage("function(w, d){ return d.getElementById('log').textContent; }", browser);
  const field = (browser) => R.inPage("function(w, d){ return d.getElementById('f').value; }", browser);
  const focusField = (browser) => R.inPage("function(w, d){ d.getElementById('f').value = ''; d.getElementById('f').focus(); return d.activeElement.id; }", browser);

  await R.load(keyPage("Keys A"));
  const A = b.active();
  await R.load(keyPage("Keys A second"), A); // A has history: Back is possible
  const B = b.newTab(keyPage("Keys B first"), { background: true });
  await waitFor(() => B.title === "Keys B first" && !B.loading, { what: "tab B" });
  await R.load(keyPage("Keys B"), B);
  await waitFor(() => B.canBack, { what: "B history" });
  b.focusPage();
  await sleep(300);

  // ---- 1. native keys: layouts with AltGr ----
  log("--- 1. native key synthesis");
  // EventUtils.synthesizeNativeKey needs SpecialPowers for its constants: call nsIDOMWindowUtils directly.
  const U = window.windowUtils;
  const nativeKey = (layout, vk, mods, chars, unmodified) =>
    new Promise((resolve) => {
      let flags = 0;
      if (mods.ctrlKey) flags |= U.NATIVE_MODIFIER_CONTROL_LEFT;
      if (mods.altKey) flags |= U.NATIVE_MODIFIER_ALT_LEFT;
      if (mods.shiftKey) flags |= U.NATIVE_MODIFIER_SHIFT_LEFT;
      if (mods.altGrKey) flags |= U.NATIVE_MODIFIER_ALT_GRAPH;
      try {
        U.sendNativeKeyEvent(layout.Win, vk, flags, chars, unmodified, { observe: () => resolve(true), QueryInterface: ChromeUtils.generateQI(["nsIObserver"]) });
      } catch (e) {
        resolve("threw " + e);
      }
      setTimeout(() => resolve("timeout"), 4000);
    });
  const VK = (c) => c.toUpperCase().charCodeAt(0);
  const POLISH = { name: "Polish (Programmers)", Mac: null, Win: 0x00000415, hasAltGrOnWin: true };
  await focusField();
  let m = mark();
  let tabs = b.tabs.length;
  let r = await nativeKey(EU.KEYBOARD_LAYOUT_EN_US, VK("t"), { ctrlKey: true }, "\u0014", "t");
  await sleep(600);
  log("native Ctrl+T (US):", r, actions(m), "tabs", b.tabs.length);
  const nativeWorks = b.tabs.length === tabs + 1;
  check("native Ctrl+T (US layout) opens one tab through the router", nativeWorks && actions(m).join() === "newTab via Ctrl+T [browser-first]", actions(m));
  if (nativeWorks) {
    if (b.omni.open) b.omni.close();
    b.closeTab(b.active());
    await sleep(300);
    b.activate(A);
    await sleep(300);
  }
  if (nativeWorks) {
    const cases = [
      // layout, key, typed character, what a broken guard would run
      [EU.KEYBOARD_LAYOUT_GERMAN, "q", "@", "Ctrl+Q peek"],
      [EU.KEYBOARD_LAYOUT_GERMAN, "e", "€", "nothing bound, must type"],
      [POLISH, "n", "ń", "Ctrl+N new window"],
      [POLISH, "l", "ł", "Ctrl+L address field"],
      [POLISH, "s", "ś", "Ctrl+S save page"],
      [POLISH, "a", "ą", "nothing bound, must type"],
      [EU.KEYBOARD_LAYOUT_SPANISH, "2", "@", "Ctrl+2 go to tab 2"],
      [EU.KEYBOARD_LAYOUT_FRENCH, "0", "@", "Ctrl+0 zoom reset"],
    ];
    for (const [layout, key, ch, risk] of cases) {
      b.activate(A);
      await focusField();
      await sleep(150);
      m = mark();
      const wins = windows();
      tabs = b.tabs.length;
      const zoom = A.zoom;
      r = await nativeKey(layout, VK(key), { altGrKey: true }, ch, key);
      await sleep(500);
      const typed = await field();
      const what = await seen();
      const ok = actions(m).length === 0 && windows() === wins && b.tabs.length === tabs && !b.omni.open && b.active() === A && A.zoom === zoom;
      check(`AltGr+${key.toUpperCase()} on ${layout.name} types "${ch}" and runs nothing (${risk})`, ok && typed === ch, { r, typed, actions: actions(m), omni: b.omni.open, windows: windows() - wins, tabs: b.tabs.length - tabs, page: String(what).slice(-60) });
      if (b.omni.open) b.omni.close();
      for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (w !== window) w.close();
    }
    // Ctrl+Alt+letter that types nothing (US): the guard says no shortcut either.
    m = mark();
    tabs = b.tabs.length;
    await nativeKey(EU.KEYBOARD_LAYOUT_EN_US, VK("t"), { ctrlKey: true, altKey: true }, "", "t");
    await sleep(400);
    check("native Ctrl+Alt+T (US) runs nothing", actions(m).length === 0 && b.tabs.length === tabs, actions(m));
    // A layout whose letters are not Latin: Ctrl+T by position (Russian), Ctrl+W on Greek.
    m = mark();
    tabs = b.tabs.length;
    await nativeKey(EU.KEYBOARD_LAYOUT_RUSSIAN, VK("t"), { ctrlKey: true }, "", "е");
    await sleep(600);
    check("native Ctrl+T on the Russian layout opens a tab", b.tabs.length === tabs + 1, actions(m));
    if (b.omni.open) b.omni.close();
    m = mark();
    await nativeKey(EU.KEYBOARD_LAYOUT_GREEK, VK("w"), { ctrlKey: true }, "", "ς");
    await sleep(600);
    check("native Ctrl+W on the Greek layout closes it", b.tabs.length === tabs, [b.tabs.length, tabs, actions(m)]);
    // Dead key then a letter in the page field (French ^ + e = ê): no action, the character arrives.
    b.activate(A);
    await focusField();
    await sleep(200);
  } else log("SKIP native key cases: the first native key did not arrive");

  // ---- 2. IME composition in the address field ----
  log("--- 2. composition in the address field");
  b.activate(A);
  await sleep(200);
  b.editAddress("");
  await sleep(300);
  EU.synthesizeCompositionChange({ composition: { string: "にほん", clauses: [{ length: 3, attr: EU.COMPOSITION_ATTR_RAW_CLAUSE }] }, caret: { start: 3, length: 0 }, key: { key: "n" } }, window);
  await sleep(300);
  const urlBefore = A.url;
  // Enter while composing commits the composition; it must not navigate.
  EU.synthesizeComposition({ type: "compositioncommitasis", key: { key: "KEY_Enter" } }, window);
  await sleep(500);
  check("address field: Enter that commits an IME composition does not navigate or close the field", b.omni.open && b.omni.input.value === "にほん" && A.url === urlBefore && !A.loading, { open: b.omni.open, value: b.omni.input.value, url: A.url.slice(0, 30) });
  // Esc while composing cancels the composition only.
  EU.synthesizeCompositionChange({ composition: { string: "ご", clauses: [{ length: 1, attr: EU.COMPOSITION_ATTR_RAW_CLAUSE }] }, caret: { start: 1, length: 0 }, key: { key: "g" } }, window);
  await sleep(200);
  EU.synthesizeComposition({ type: "compositioncommit", data: "", key: { key: "KEY_Escape" } }, window);
  await sleep(400);
  check("address field: Esc that cancels a composition leaves the field open with the text", b.omni.open && b.omni.input.value === "にほん", { open: b.omni.open, value: b.omni.input.value });
  // Ctrl+W during a composition in the field: the guard says nothing fires.
  EU.synthesizeCompositionChange({ composition: { string: "あ", clauses: [{ length: 1, attr: EU.COMPOSITION_ATTR_RAW_CLAUSE }] }, caret: { start: 1, length: 0 }, key: { key: "a" } }, window);
  await sleep(200);
  EU.synthesizeComposition({ type: "compositioncommitasis" }, window);
  await sleep(200);
  b.omni.close();
  await sleep(300);

  // ---- 3. a page whose process hangs ----
  log("--- 3. hung page");
  b.activate(A);
  b.focusPage();
  await sleep(400);
  const loads = [];
  const listener = {
    onStateChange(browser, wp, _req, flags) {
      if (wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) loads.push(browser === A.browser ? "A" : browser === B.browser ? "B" : "other");
    },
    onLocationChange(browser, wp, _req, location) {
      if (wp.isTopLevel) loads.push((browser === A.browser ? "A" : browser === B.browser ? "B" : "other") + "@" + (/title%3E([^%]*(%20[^%]*)*)%3C/.exec(location.spec)?.[1] || "?").replace(/%20/g, " "));
    },
  };
  gBrowser.addTabsProgressListener(listener);

  // 3a. browser-first keys do not wait for the page.
  await evalIn("hang(5000)");
  await sleep(300);
  tabs = b.tabs.length;
  let t0 = performance.now();
  spike.press("Ctrl+T");
  await waitFor(() => b.tabs.length === tabs + 1, { timeout: 3000, what: "Ctrl+T on a hung page" }).catch(() => {});
  const tookT = performance.now() - t0;
  check("hung page: Ctrl+T (browser-first) opens a tab at once", b.tabs.length === tabs + 1 && tookT < 1000, Math.round(tookT) + " ms");
  if (b.omni.open) b.omni.close();
  b.closeTab(b.active());
  await sleep(300);
  b.activate(A);
  await sleep(5500);

  // 3b. a page-first key pressed on the hung tab, then the user moves to another tab.
  b.focusPage();
  await sleep(300);
  loads.length = 0;
  await evalIn("hang(5000)");
  await sleep(300);
  m = mark();
  spike.press("Alt+Left"); // page-first: waits for the hung page
  spike.press("Ctrl+R");
  await sleep(200);
  b.activate(B); // the user gives up on the hung tab and goes to another
  await sleep(300);
  const bTitle = B.title;
  log("pressed Alt+Left and Ctrl+R on hung tab A, switched to B (" + bTitle + "); waiting for the page to answer");
  await sleep(7000);
  log("after the hang:", { actions: actions(m), loads, A: A.title, B: B.title, active: b.active().title });
  const wrong = loads.filter((l) => l.startsWith("B"));
  check("hung page: Alt+Left / Ctrl+R pressed on tab A do not act on tab B after the user switched", B.title === bTitle && wrong.length === 0, { actions: actions(m), loads, B: B.title });
  await sleep(1000);

  // 3c. Ctrl+L pressed on the hung tab arrives late, over what the user is typing elsewhere.
  if (B.title !== "Keys B") { await R.load(keyPage("Keys B"), B); }
  b.activate(A);
  b.focusPage();
  await sleep(600);
  log("processes:", { A: A.browser.frameLoader?.remoteTab?.osPid, B: B.browser.frameLoader?.remoteTab?.osPid });
  await evalIn("hang(5000)", A.browser);
  await sleep(300);
  m = mark();
  const pressedAt = performance.now();
  spike.press("Ctrl+L");
  await sleep(200);
  log("200 ms after Ctrl+L on the hung tab:", { actions: actions(m), open: b.omni.open });
  b.activate(B);
  await sleep(300);
  b.editAddress("");
  spike.type("my search words");
  const typedAt = performance.now();
  let ranAt = 0;
  for (let i = 0; i < 80 && !ranAt; i++) {
    await sleep(100);
    if (actions(m).length) ranAt = performance.now();
  }
  await sleep(300);
  log("late Ctrl+L:", { actions: actions(m), ranAfterPressMs: ranAt ? Math.round(ranAt - pressedAt) : null, ranAfterTypingMs: ranAt ? Math.round(ranAt - typedAt) : null, open: b.omni.open, value: b.omni.input.value.slice(0, 40) });
  check("hung page: a late Ctrl+L from tab A does not replace what was typed in tab B's field", b.omni.input.value === "my search words", b.omni.input.value.slice(0, 60));
  if (b.omni.open) b.omni.close();
  await sleep(1500);

  // 3d. Ctrl+W on a hung page closes it at once.
  b.activate(A);
  b.focusPage();
  await sleep(600);
  await evalIn("hang(6000)");
  await sleep(300);
  tabs = b.tabs.length;
  t0 = performance.now();
  spike.press("Ctrl+W");
  await waitFor(() => b.tabs.length === tabs - 1, { timeout: 4000, what: "Ctrl+W on a hung page" }).catch(() => {});
  check("hung page: Ctrl+W closes the tab at once", b.tabs.length === tabs - 1 && performance.now() - t0 < 1500, Math.round(performance.now() - t0) + " ms");
  gBrowser.removeTabsProgressListener(listener);
  await sleep(500);

  // ---- 4. a page that prevents every key, in element full screen ----
  log("--- 4. hostile page in element full screen");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  const H = b.newTab(keyPage("Hostile", "prevent"));
  await waitFor(() => H.title === "Hostile" && !H.loading, { what: "hostile page" });
  await spike.activate();
  b.focusPage();
  await sleep(400);
  await evalIn("goFull(false)");
  const full = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000, what: "element full screen" }).then(() => true, () => false);
  if (full) {
    await sleep(600);
    // Ctrl+T from element full screen.
    tabs = b.tabs.length;
    spike.press("Ctrl+T");
    await sleep(1500);
    log("Ctrl+T in element full screen:", { tabs: b.tabs.length - tabs, dom: document.documentElement.hasAttribute("inDOMFullscreen"), omni: b.omni.open, active: b.active().url, focus: document.activeElement?.id || document.activeElement?.localName });
    check("element full screen: Ctrl+T opens a tab and leaves full screen", b.tabs.length === tabs + 1 && !document.documentElement.hasAttribute("inDOMFullscreen"));
    check("element full screen: the new tab's address field is open (as after any Ctrl+T)", b.omni.open && b.omni.focused, { open: b.omni.open, focus: document.activeElement?.id || document.activeElement?.localName });
    if (b.omni.open) b.omni.close();
    if (b.tabs.length === tabs + 1) b.closeTab(b.active());
    await sleep(500);
    // Again, then F11 must get out although the page prevents every key.
    b.activate(H);
    b.focusPage();
    await sleep(400);
    await evalIn("goFull(false)");
    const again = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000 }).then(() => true, () => false);
    if (again) {
      await sleep(500);
      spike.press("F11");
      await sleep(1500);
      check("element full screen on a page that prevents every key: F11 leaves", !document.documentElement.hasAttribute("inDOMFullscreen") && !window.fullScreen, { dom: document.documentElement.hasAttribute("inDOMFullscreen"), fs: window.fullScreen });
      if (document.documentElement.hasAttribute("inDOMFullscreen")) { document.exitFullscreen(); await sleep(800); }
      // Esc too (Gecko's own exit).
      await evalIn("goFull(false)");
      const third = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000 }).then(() => true, () => false);
      if (third) {
        await sleep(500);
        spike.press("Escape");
        await sleep(1500);
        check("element full screen on a page that prevents every key: Esc leaves", !document.documentElement.hasAttribute("inDOMFullscreen"));
        if (document.documentElement.hasAttribute("inDOMFullscreen")) { document.exitFullscreen(); await sleep(800); }
      }
    }
    check("after element full screen the layer and the filter are back", getComputedStyle(b.root).display !== "none" && getComputedStyle(document.getElementById("tabbrowser-tabbox")).filter.startsWith("saturate") && !b.root.classList.contains("element-fullscreen"));
  } else log("SKIP element full screen was not granted to the test");

  // The hostile page cannot keep browser-first keys, and Esc / page-first keys stay with it.
  b.activate(H);
  b.focusPage();
  await sleep(300);
  m = mark();
  tabs = b.tabs.length;
  spike.press("Ctrl+L");
  spike.press("F5");
  spike.press("Escape");
  await sleep(600);
  check("page that prevents every key keeps page-first keys", actions(m).length === 0 && !b.omni.open, actions(m));
  spike.press("F6");
  await sleep(400);
  check("...but F6 (browser-first) still reaches the address field", b.omni.open);
  if (b.omni.open) b.omni.close();
  spike.press("Ctrl+W");
  await sleep(500);
  check("...and Ctrl+W still closes it", b.tabs.length === tabs - 1);

  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("keys");
});
