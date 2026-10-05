// The key battery: every binding of design/keymap.json fires the right action with the right
// priority, pages keep the page-first keys they use, text editing works, and Firefox's own
// shortcuts do nothing.
//   python tools/run.py --test tests/input/keys.js --name input-keys --timeout 420
// Keys are synthesized in-process (EventUtils); nothing here needs OS focus. Most of the battery
// runs with every action replaced by a recorder, so nothing really closes, prints or opens.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { key, page, seen, press, down, up, firefoxDid, inPage, evalInPage, actions, mark } = K;
  await spike.resize(1180, 760);
  await spike.activate();

  // Three tabs, the test page in the middle one.
  b.newTab(K.dataPage("Left tab"), { background: true, index: 0 });
  b.newTab(K.dataPage("Right tab"), { background: true, index: 2 });
  await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading), { what: "three tabs" });
  check("setup: three tabs, the test tab in the middle and active", b.tabs.indexOf(b.active()) === 1, b.tabs.map((t) => t.title));

  // ------------------------------------------------------------------ 0. Firefox neutralised
  log("--- 0. Firefox's keys are parked");
  const liveKeys = [...document.querySelectorAll("keyset key")].filter((k) => !k.closest("keyset").id.startsWith("ext-keyset-id-"));
  check("every <key> of Firefox is parked, and still resolves by id", b.keys.parked >= 80 && liveKeys.length === 0 && !!document.getElementById("key_newNavigatorTab") && document.getElementById("key_newNavigatorTab").parentNode.id === "vitre-dead-keys", { parked: b.keys.parked, live: liveKeys.map((k) => k.id) });
  check("the DevTools keys are parked too and can still be run by id", !!document.getElementById("key_toggleToolboxF12") && document.getElementById("key_toggleToolboxF12").parentNode.id === "vitre-dead-keys");
  check("#mainKeyset is still in place (Firefox inserts next to it)", !!document.getElementById("mainKeyset"));

  // ------------------------------------------------------------------ 1. the map
  // [keys as printed in design/keymap.json, action, priority]. "browser" = Vitre first, the page
  // never sees the key; "page" = the page gets it first.
  const MAP = [
    // Tabs and windows
    ["Ctrl+T", "newTab", "browser"], ["Ctrl+W", "closeTab", "browser"], ["Ctrl+F4", "closeTab", "browser"],
    ["Ctrl+Shift+T", "reopenClosed", "browser"], ["Ctrl+N", "newWindow", "browser"], ["Ctrl+Shift+N", "newPrivateWindow", "browser"], ["Ctrl+Shift+W", "closeWindow", "browser"],
    ["Ctrl+PageDown", "nextTab", "browser"], ["Ctrl+PageUp", "prevTab", "browser"],
    ["Ctrl+1", "goTab(1)", "page"], ["Ctrl+2", "goTab(2)", "page"], ["Ctrl+3", "goTab(3)", "page"], ["Ctrl+4", "goTab(4)", "page"],
    ["Ctrl+5", "goTab(5)", "page"], ["Ctrl+6", "goTab(6)", "page"], ["Ctrl+7", "goTab(7)", "page"], ["Ctrl+8", "goTab(8)", "page"],
    ["Ctrl+9", "goLastTab", "page"],
    ["Ctrl+Shift+PageUp", "moveTabLeft", "page"], ["Ctrl+Shift+PageDown", "moveTabRight", "page"],
    ["F11", "fullscreen", "page"],
    // Address and search
    ["Ctrl+L", "focusAddress", "page"], ["Alt+D", "focusAddress", "page"], ["Ctrl+H", "history", "page"],
    // Page
    ["Alt+Left", "back", "page"], ["Alt+Right", "forward", "page"],
    ["Ctrl+R", "reload", "page"], ["F5", "reload", "page"],
    ["Ctrl+Shift+R", "hardReload", "page"], ["Ctrl+F5", "hardReload", "page"], ["Shift+F5", "hardReload", "page"],
    ["Escape", "stop", "page"],
    ["Ctrl+Plus", "zoomIn", "page"], ["Ctrl+Shift+Plus", "zoomIn", "page"], ["Ctrl+Equal", "zoomIn", "page"],
    ["Ctrl+Minus", "zoomOut", "page"], ["Ctrl+0", "zoomReset", "page"], ["Ctrl+Num0", "zoomReset", "page"],
    ["Ctrl+P", "print", "page"], ["Ctrl+S", "savePage", "page"], ["Ctrl+U", "viewSource", "page"],
    ["BrowserBack", "back", "browser"], ["BrowserForward", "forward", "browser"], ["BrowserRefresh", "reload", "browser"],
    ["BrowserStop", "stop", "browser"], ["BrowserSearch", "focusAddress", "browser"], ["BrowserHome", "goHome", "browser"],
    // Peek
    ["Ctrl+Q", "peekLink", "page"], ["Alt+Enter", "openAsTab", "page"],
    // Find
    ["Ctrl+F", "find", "page"], ["F3", "findNext", "page"], ["Shift+F3", "findPrev", "page"],
    ["Ctrl+G", "findNext", "page"], ["Ctrl+Shift+G", "findPrev", "page"],
    // Tab switcher
    ["Ctrl+Tab", "nextTabMru", "browser"], ["Ctrl+Shift+Tab", "prevTabMru", "browser"], ["Ctrl+Shift+A", "switcherSearch", "page"],
    // Downloads
    ["Ctrl+J", "downloads", "page"], ["Ctrl+Shift+D", "downloadVideo", "page"],
    // Menus and focus
    ["F6", "focusAddress(6)", "browser"], ["Shift+F6", "focusAddress(6)", "browser"],
    // Panels and app
    ["Ctrl+Comma", "settings", "page"], ["F1", "shortcutsHelp", "page"], ["Ctrl+Shift+Delete", "clearData", "page"],
    ["F12", "devtools", "page"], ["Ctrl+Shift+I", "devtools", "page"], ["Ctrl+Shift+J", "devtoolsConsole", "page"], ["Ctrl+Shift+C", "devtoolsInspect", "page"],
  ];
  const mapped = new Set(MAP.map((m) => m[0].replace("Ctrl+Shift+Plus", "Ctrl+Plus")));
  const routerHas = b.keys.bindings().map((x) => x.spec);
  check("the router's map and the keymap table list the same keys", routerHas.every((s) => mapped.has(s)) && [...mapped].every((s) => routerHas.includes(s)), { onlyInRouter: routerHas.filter((s) => !mapped.has(s)), onlyInTable: [...mapped].filter((s) => !routerHas.includes(s)) });

  const rec = K.recordActions();
  // Real input from the desktop (somebody clicking the test window) would send the keys elsewhere:
  // put the test tab and the page focus back before each key and count how often that was needed.
  const testTab = b.active();
  let disturbed = 0;
  const steady = async () => {
    if (b.active() === testTab && document.activeElement === gBrowser.selectedBrowser && !b.omni.open) return;
    disturbed++;
    if (b.omni.open) b.omni.close();
    b.activate(testTab);
    b.focusPage();
    await sleep(300);
  };

  log("--- 1a. every binding, on a page that uses no key");
  await page("");
  let bad = [];
  for (const [spec, action, priority] of MAP) {
    await steady();
    rec.ran.length = 0;
    mark();
    const before = (await seen(undefined, 0)).length;
    const did = await firefoxDid(spec, {}, 260);
    const how = actions();
    const saw = (await seen(undefined, 120)).slice(before);
    const sawDown = saw.some((s) => s.startsWith("d:"));
    const wantHow = action.replace(/\(.*/, "") + "[" + (priority === "browser" ? "browser-first" : "page-first/reply") + "]";
    const ok = rec.ran.join() === action && how.length === 1 && how[0].replace(/\(\d+\)/, "") === wantHow && did.length === 0 && (priority === "browser" ? saw.length === 0 : sawDown);
    if (!ok) bad.push({ spec, ran: rec.ran.slice(), how, firefox: did, pageSaw: saw });
  }
  check(`all ${MAP.length} bindings run their action once, with the keymap's priority; browser-first keys never reach the page, page-first keys do; Firefox itself does nothing`, bad.length === 0, bad);

  log("--- 1b. every binding, on a page that calls preventDefault on every keydown");
  await page("prevent=*");
  bad = [];
  for (const [spec, action, priority] of MAP) {
    await steady();
    rec.ran.length = 0;
    mark();
    const before = (await seen(undefined, 0)).length;
    const did = await firefoxDid(spec, {}, 240);
    const saw = (await seen(undefined, 120)).slice(before);
    const ok = priority === "browser" ? rec.ran.join() === action && saw.length === 0 && did.length === 0 : rec.ran.length === 0 && saw.some((s) => s.startsWith("d:") && s.includes("!")) && did.length === 0;
    if (!ok) bad.push({ spec, priority, ran: rec.ran.slice(), firefox: did, pageSaw: saw });
  }
  check("a page that prevents every keydown keeps all the page-first keys and none of the browser-first ones", bad.length === 0, bad);

  log("--- 1c. page-first is decided on what the page really used");
  await page("prevent=ctrl-k,ctrl-l");
  rec.ran.length = 0;
  let a = await key("Ctrl+L");
  const a2 = await key("Ctrl+J");
  check("a page that prevents only Ctrl+L keeps Ctrl+L; Ctrl+J still runs", a.length === 0 && a2.join() === "downloads[page-first/reply]" && rec.ran.join() === "downloads", { L: a, J: a2 });
  await page("acc=d");
  a = await key("Alt+D");
  const accSeen = await seen();
  check("a page accesskey on Alt+D keeps Alt+D (the button is clicked, the address field stays shut)", a.length === 0 && accSeen.includes("accesskey-click"), { a, accSeen });
  await page("");
  a = await key("Alt+D");
  check("without that accesskey Alt+D reaches Vitre", a.join() === "focusAddress[page-first/reply]", a);

  // ------------------------------------------------------------------ 2. Firefox's own shortcuts
  log("--- 2. Firefox's own shortcuts do nothing");
  await page("");
  const FIREFOX = ["Ctrl+B", "Ctrl+D", "Ctrl+E", "Ctrl+K", "Ctrl+I", "Ctrl+M", "Ctrl+Shift+B", "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+S", "Ctrl+Shift+M",
    "Ctrl+Shift+K", "Ctrl+Shift+E", "Ctrl+Shift+Z", "Ctrl+Shift+H", "Ctrl+Shift+Y", "Ctrl+Shift+X", "Ctrl+Y", "Ctrl+[", "Ctrl+]", "F7", "F9", "F10", "Shift+F7", "Shift+F9", "Shift+F2", "Shift+F12",
    "Alt+Home", "Alt+F", "Alt+E", "Alt+V", "Alt+S", "Alt+B", "Alt+T", "Alt+H", "Alt+1", "Backspace", "Shift+Backspace", "/", "'", "Ctrl+Alt+R", "Ctrl+Shift+F5"];
  bad = [];
  rec.ran.length = 0;
  for (const spec of FIREFOX) {
    const before = (await seen(undefined, 0)).length;
    const did = await firefoxDid(spec, {}, 220);
    const saw = (await seen(undefined, 100)).slice(before);
    if (did.length || !saw.some((s) => s.startsWith("d:"))) bad.push({ spec, firefox: did, pageSaw: saw });
  }
  check(`${FIREFOX.length} Firefox shortcuts that Vitre does not bind: Firefox does nothing, Vitre does nothing, the page gets the key`, bad.length === 0 && rec.ran.length === 0, { bad, vitreRan: rec.ran.slice() });
  // The Alt key alone must not wake Firefox's menu bar.
  K.noise.length = 0;
  press("Alt");
  press("F10");
  await sleep(300);
  check("Alt and F10 alone do not activate a menu bar", !K.noise.includes("menubar-active"), K.noise.slice());

  // ------------------------------------------------------------------ 3. text editing in a page field
  log("--- 3. text editing in a page field");
  await page("");
  const fieldValue = () => inPage(function (w, d) { return d.getElementById("field").value; });
  await inPage(function (w, d) { const f = d.getElementById("field"); f.focus(); f.select(); return 1; });
  await sleep(150);
  rec.ran.length = 0;
  mark();
  press("Ctrl+A");
  spike.type("abc def");
  await sleep(150);
  const v1 = await fieldValue();
  press("Ctrl+Backspace");
  await sleep(150);
  const v2 = await fieldValue();
  press("Ctrl+Z");
  await sleep(150);
  const v3 = await fieldValue();
  press("Ctrl+Y");
  await sleep(150);
  const v3b = await fieldValue();
  press("Home");
  press("Shift+End");
  press("Delete");
  await sleep(150);
  const v4 = await fieldValue();
  spike.type("xy");
  press("Left");
  press("Shift+Right");
  press("Backspace");
  await sleep(150);
  const v5 = await fieldValue();
  check("page field: Ctrl+A, typing, Ctrl+Backspace, Ctrl+Z, Ctrl+Y, Home, Shift+End, Delete, arrows, Backspace all edit, and no Vitre action runs", v1 === "abc def" && v2 === "abc " && v3 === "abc def" && v3b === "abc " && v4 === "" && v5 === "x" && rec.ran.length === 0, { v1, v2, v3, v3b, v4, v5, ran: rec.ran.slice() });
  a = await key("Escape");
  check("Esc in a page field still reaches Vitre when the field does not use it", a.join() === "stop[page-first/reply]", a);

  // ------------------------------------------------------------------ 4. guards
  log("--- 4. guards: repeat, AltGr, Ctrl+Alt, the Windows key, IME");
  await page("");
  a = await key("Ctrl+W", { repeat: 4 });
  check("Ctrl+W held: one action, the repeats are swallowed, the page sees nothing", a.join() === "closeTab[browser-first]" && !(await seen()).join().includes("ctrl-w"), { a, page: await seen() });
  a = await key("Ctrl+T", { repeat: 3 });
  check("Ctrl+T held: repeat is allowed (3 actions)", a.length === 3, a);
  a = await key("Ctrl+J", { repeat: 3 });
  check("page-first Ctrl+J held: one action", a.length === 1, a);
  a = await key("Escape", { repeat: 3 });
  check("Esc held: one step of the ladder, not three", a.length === 1, a);
  rec.ran.length = 0;
  a = [...(await key("Ctrl+Alt+T")), ...(await key("Ctrl+Alt+Tab")), ...(await key("Ctrl+Alt+Left"))];
  check("Ctrl+Alt chords never match and reach the page", a.length === 0 && (await seen()).join().includes("d:ctrl-alt-t"), { a, page: (await seen()).slice(-8) });
  a = [...(await key("AltGr+q")), ...(await key("AltGr+d")), ...(await key("AltGr+t"))];
  check("AltGr chords never match; the page gets the key with AltGraph set", a.length === 0 && (await seen()).some((s) => s.includes("G")), { a, page: (await seen()).slice(-8) });
  // The same tab keys with the Windows key held: Vitre refuses them, and Firefox must not act either.
  bad = [];
  for (const spec of ["Ctrl+Meta+Tab", "Ctrl+Shift+Meta+Tab", "Ctrl+Meta+PageDown", "Ctrl+Meta+PageUp", "Ctrl+Shift+Meta+PageDown", "Ctrl+Meta+F4", "Ctrl+Meta+T", "Ctrl+Meta+W"]) {
    const did = await firefoxDid(spec, {}, 220);
    if (did.length || actions().length) bad.push({ spec, firefox: did });
  }
  check("chords with the Windows key held do nothing in Vitre and nothing in Firefox (tabs stay as they are)", bad.length === 0 && rec.ran.length === 0 && b.tabs.length === 3, { bad, ran: rec.ran.slice() });
  // IME: a composition in the page field, then shortcut keys while composing.
  await page("");
  await inPage(function (w, d) { d.getElementById("field").focus(); return 1; });
  await sleep(150);
  K.EU.synthesizeCompositionChange({ composition: { string: "あ", clauses: [{ length: 1, attr: Ci.nsITextInputProcessor.ATTR_RAW_CLAUSE }] }, caret: { start: 1, length: 0 } }, window);
  await sleep(200);
  mark();
  rec.ran.length = 0;
  for (const spec of ["Ctrl+T", "Ctrl+W", "F6", "Ctrl+L", "Escape"]) press(spec);
  await sleep(400);
  const duringIme = rec.ran.slice();
  K.EU.synthesizeComposition({ type: "compositioncommitasis", key: { key: "KEY_Enter" } }, window);
  await sleep(200);
  a = await key("Ctrl+T");
  check("during IME composition no shortcut fires; after the commit they work again", duringIme.length === 0 && a.length === 1, { duringIme, after: a, field: await fieldValue() });

  // Layouts: letters by virtual key, digits by physical key, comma by its virtual key, zoom by the character.
  await page("");
  const syn = async (k, opts) => { mark(); K.EU.synthesizeKey(k, opts, window); await sleep(300); return actions(); };
  const KE = window.KeyboardEvent;
  const l1 = await syn("е", { ctrlKey: true, code: "KeyT", keyCode: KE.DOM_VK_T }); // Russian: physical T types a Cyrillic letter
  const l2 = await syn("t", { ctrlKey: true, code: "KeyK", keyCode: KE.DOM_VK_T }); // Dvorak: physical K is labelled T
  const l3 = await syn("&", { ctrlKey: true, code: "Digit1", keyCode: KE.DOM_VK_1 }); // AZERTY digit row
  const l4 = await syn("-", { ctrlKey: true, code: "Digit6", keyCode: KE.DOM_VK_6 }); // AZERTY: the 6 key types "-"
  const l5 = await syn(",", { ctrlKey: true, code: "KeyW", keyCode: 188 }); // Dvorak: comma sits on physical W
  const l6 = await syn(",", { ctrlKey: true, code: "KeyM", keyCode: 188 }); // AZERTY: comma sits on physical M
  const l7 = await syn("б", { ctrlKey: true, code: "Comma", keyCode: 188 }); // Russian: the comma key types a letter
  check("layouts: Ctrl+T by virtual key (Russian, Dvorak), Ctrl+1 by physical digit, AZERTY 6 zooms out, Ctrl+comma by its virtual key on Dvorak, AZERTY and Russian",
    l1.join() === "newTab[browser-first]" && l2.join() === "newTab[browser-first]" && l3.join() === "goTab(1)[page-first/reply]" && l4.join() === "zoomOut[page-first/reply]" && [l5, l6, l7].every((x) => x.join() === "settings[page-first/reply]"),
    { l1, l2, l3, l4, l5, l6, l7 });

  // ------------------------------------------------------------------ 5. Ctrl release
  log("--- 5. Ctrl held and released with focus in the page");
  await page("");
  let ctrlUps = 0;
  const offCtrl = b.on("ctrl-up", () => ctrlUps++);
  rec.ran.length = 0;
  down("Control");
  await sleep(40);
  const heldDuring = b.keys.ctrlHeld;
  press("Tab");
  await sleep(200);
  press("Tab");
  await sleep(100);
  press("Shift+Tab");
  await sleep(100);
  up("Control");
  await sleep(300);
  const pageSaw = await seen();
  check("Ctrl down, Tab, Tab, Shift+Tab, Ctrl up: three switcher steps, one ctrl-up event, and the page sees Control but never Tab",
    rec.ran.join() === "nextTabMru,nextTabMru,prevTabMru" && ctrlUps === 1 && heldDuring && !b.keys.ctrlHeld && pageSaw.some((s) => s.includes("control")) && !pageSaw.some((s) => s.includes("tab")), { ran: rec.ran.slice(), ctrlUps, pageSaw });
  offCtrl();

  // ------------------------------------------------------------------ 6. hardware keys (AppCommand)
  log("--- 6. hardware browser keys and mouse side buttons");
  await page("");
  rec.ran.length = 0;
  mark();
  const appCommand = (command) => {
    const e = new window.Event("AppCommand", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "command", { value: command });
    gBrowser.selectedBrowser.dispatchEvent(e);
  };
  for (const c of ["Back", "Forward", "Reload", "Stop", "Search", "Home", "Bookmarks"]) appCommand(c);
  await sleep(300);
  check("AppCommand Back / Forward / Reload / Stop / Search / Home run Vitre's actions; Bookmarks is swallowed", rec.ran.join() === "back,forward,reload,stop,focusAddress,goHome" && !K.snap().sidebar, rec.ran.slice());
  // The real thing: WM_APPCOMMAND and the mouse side buttons, posted to this window's own HWND.
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
    rec.ran.length = 0;
    const before = K.snap();
    // lParam = command << 16 (1 Back, 2 Forward, 3 Refresh, 5 Search, 7 Home); 0x8000 in the high word = from the mouse.
    for (const cmd of [1, 2, 3, 5, 7]) PostMessageW(hwnd, 0x319, ctypes.uintptr_t(0), ctypes.intptr_t(cmd << 16));
    PostMessageW(hwnd, 0x319, ctypes.uintptr_t(0), ctypes.intptr_t((1 | 0x8000) << 16));
    await sleep(700);
    check("native WM_APPCOMMAND (keys and the mouse Back button) reaches Vitre's actions only", rec.ran.join() === "back,forward,reload,focusAddress,goHome,back" && K.diff(before, K.snap()).length === 0, { ran: rec.ran.slice(), firefox: K.diff(before, K.snap()) });
    user32.close();
  } catch (e) {
    check("native WM_APPCOMMAND could be posted", false, String(e));
  }

  // ------------------------------------------------------------------ 7. hooks
  log("--- 7. hooks for feature modules");
  await page("prevent=*");
  let hookSaw = [];
  let off = b.keys.addHook((binding, e) => {
    hookSaw.push((binding ? binding.action : "-") + ":" + e.key);
    return binding && binding.action === "stop" ? "browser" : undefined;
  });
  a = await key("Escape");
  check("a hook can take a page-first key browser-first (the second Esc on a peek): it runs although the page prevents every key, and the page does not see it", a.join() === "stop[browser-first]" && !(await seen()).join().includes("escape"), { a, page: await seen() });
  off();
  await page("");
  off = b.keys.addHook((binding) => (binding && binding.action === "newTab" ? "page" : undefined));
  a = await key("Ctrl+T");
  const sawT = (await seen()).includes("d:ctrl-t");
  off();
  check("a hook can hand a browser-first key to the page first", a.join() === "newTab[page-first/reply]" && sawT, { a, sawT });
  await page("prevent=ctrl-t");
  off = b.keys.addHook((binding) => (binding && binding.action === "newTab" ? "page" : undefined));
  a = await key("Ctrl+T");
  off();
  check("... and the page can then keep it", a.length === 0, a);
  await page("");
  off = b.keys.addHook((binding, e) => (e.key === "w" && e.ctrlKey ? "swallow" : e.key === "t" && e.ctrlKey ? "pass" : undefined));
  rec.ran.length = 0;
  const s0 = (await seen(undefined, 0)).length;
  a = [...(await key("Ctrl+W")), ...(await key("Ctrl+T"))];
  const sawAfter = (await seen()).slice(s0);
  off();
  check("'swallow' eats a key (no action, the page sees nothing); 'pass' leaves it alone (no action, the page gets it)", a.length === 0 && rec.ran.length === 0 && !sawAfter.join().includes("ctrl-w") && sawAfter.includes("d:ctrl-t"), { a, sawAfter });
  a = await key("Ctrl+T");
  check("with the hook removed Ctrl+T is Vitre's again", a.join() === "newTab[browser-first]", a);

  // ------------------------------------------------------------------ 8. [data-key-capture]
  log("--- 8. a key-capture field takes raw keys");
  const capture = document.createElement("input");
  capture.setAttribute("data-key-capture", "");
  capture.style.cssText = "position:absolute;left:300px;top:200px;width:200px;height:28px;pointer-events:auto;";
  b.layer("test-capture", 60).append(capture);
  const got = [];
  capture.addEventListener("keydown", (e) => { got.push((e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + e.key); e.preventDefault(); });
  capture.focus();
  rec.ran.length = 0;
  const tabsBefore = K.snap();
  for (const spec of ["Ctrl+T", "Ctrl+W", "Ctrl+Tab", "F6", "Ctrl+L", "Ctrl+Shift+PageDown"]) press(spec);
  await sleep(350);
  check("in a [data-key-capture] field every key goes to the field: no Vitre action, nothing from Firefox", rec.ran.length === 0 && got.join() === "Ctrl+t,Ctrl+w,Ctrl+Tab,F6,Ctrl+l,Ctrl+Shift+PageDown" && K.diff(tabsBefore, K.snap()).length === 0, { ran: rec.ran.slice(), got, firefox: K.diff(tabsBefore, K.snap()) });
  capture.remove();
  b.focusPage();
  await sleep(200);

  // ------------------------------------------------------------------ 9. Esc and page layers
  log("--- 9. Esc: a page dialog, a popover, an alert take the press");
  await page("");
  const dlgOpen = await evalInPage("openDialog()");
  await sleep(200);
  a = await key("Escape", {}, 500);
  let saw = await seen();
  check("Esc with a modal page <dialog> open closes the dialog and Vitre's Esc step does not run", dlgOpen === true && saw.includes("dialog-closed") && a.length === 0, { a, saw });
  a = await key("Escape");
  check("the next Esc (dialog closed) is Vitre's", a.join() === "stop[page-first/reply]", a);
  await page("");
  const popOpen = await evalInPage("openPopover()");
  await sleep(200);
  a = await key("Escape", {}, 500);
  saw = await seen();
  check("Esc with a page popover open closes the popover and Vitre's Esc step does not run", popOpen === true && saw.includes("popover:closed") && a.length === 0, { a, saw });
  await page("");
  await inPage(function (w) { w.setTimeout(function () { w.wrappedJSObject.alert("an alert"); }, 0); return 1; });
  await waitFor(() => gBrowser.selectedBrowser.hasAttribute("tabDialogShowing"), { timeout: 5000, what: "alert prompt" });
  await sleep(400);
  rec.ran.length = 0;
  a = await key("Ctrl+L");
  const stillOpen = gBrowser.selectedBrowser.hasAttribute("tabDialogShowing");
  const esc = await key("Escape", {}, 600);
  check("with an alert() open Ctrl+L still works, and Esc closes the alert without running Vitre's Esc step", a.length === 1 && stillOpen && esc.length === 0 && !gBrowser.selectedBrowser.hasAttribute("tabDialogShowing"), { L: a, stillOpen, esc, open: gBrowser.selectedBrowser.hasAttribute("tabDialogShowing") });
  b.focusPage();
  await sleep(200);

  // ------------------------------------------------------------------ 10. where focus is
  log("--- 10. focus in an out-of-process iframe, in an in-process page, in Vitre's own UI");
  await page("iframe=" + encodeURIComponent("https://example.org/"));
  await sleep(1800);
  const frameFocused = await inPage(function (w, d) { d.getElementById("frame").contentWindow.focus(); return d.activeElement.id; });
  await sleep(400);
  const top = gBrowser.selectedBrowser.browsingContext;
  const framePid = top.children[0]?.currentWindowGlobal?.osPid;
  const beforeFrame = (await seen()).length;
  const j1 = await key("Ctrl+L");
  const j2 = await key("Ctrl+T");
  const j3 = await key("Escape");
  check("focus in a cross-site iframe (another process): page-first keys come back as a reply, browser-first are taken, the parent page sees none of them",
    frameFocused === "frame" && framePid && framePid !== top.currentWindowGlobal.osPid && j1.join() === "focusAddress[page-first/reply]" && j2.join() === "newTab[browser-first]" && j3.join() === "stop[page-first/reply]" && (await seen()).length === beforeFrame,
    { frameFocused, framePid, topPid: top.currentWindowGlobal.osPid, j1, j2, j3 });
  await K.load("about:vitre-home");
  b.focusPage();
  await sleep(300);
  const g1 = await key("Ctrl+L");
  const g2 = await key("Ctrl+T");
  check("an in-process page: page-first keys run from the local path, browser-first as usual", g1.join() === "focusAddress[page-first/local]" && g2.join() === "newTab[browser-first]", { g1, g2, remote: gBrowser.selectedBrowser.isRemoteBrowser });

  // ------------------------------------------------------------------ 11. extension commands
  log("--- 11. extension command keysets stay alive");
  await page("");
  const extFired = [];
  const ks = document.createXULElement("keyset");
  ks.id = "ext-keyset-id-fake_example_org";
  for (const [id, k, mods] of [["ext-l", "L", "accel"], ["ext-y", "Y", "accel,shift"], ["ext-t", "T", "accel"]]) {
    const el = document.createXULElement("key");
    el.id = id;
    el.setAttribute("key", k);
    el.setAttribute("modifiers", mods);
    el.addEventListener("command", () => extFired.push(id));
    ks.appendChild(el);
  }
  document.getElementById("mainKeyset").parentNode.appendChild(ks);
  await sleep(200);
  a = await key("Ctrl+Shift+Y");
  const h1 = extFired.splice(0);
  const h2 = await key("Ctrl+L");
  const h2e = extFired.splice(0);
  const h3 = await key("Ctrl+T");
  const h3e = extFired.splice(0);
  check("an extension command on a free chord fires; on chords Vitre binds (page-first Ctrl+L, browser-first Ctrl+T) only Vitre fires", h1.join() === "ext-y" && a.length === 0 && h2.length === 1 && h2e.length === 0 && h3.length === 1 && h3e.length === 0, { free: h1, L: [h2, h2e], T: [h3, h3e] });
  ks.remove();
  const late = document.createXULElement("keyset");
  late.id = "someLateFirefoxKeyset";
  const lk = document.createXULElement("key");
  lk.id = "late-y";
  lk.setAttribute("key", "Y");
  lk.setAttribute("modifiers", "accel,shift");
  lk.addEventListener("command", () => extFired.push("late-y"));
  late.appendChild(lk);
  document.getElementById("mainKeyset").parentNode.appendChild(late);
  await sleep(300);
  await key("Ctrl+Shift+Y");
  check("a keyset Firefox adds later is parked too", extFired.length === 0 && lk.parentNode.id === "vitre-dead-keys", { fired: extFired.slice(), parent: lk.parentNode.id });
  late.remove();

  // ------------------------------------------------------------------ 12. rebinding, in every window
  log("--- 12. rebinding through settings reaches every window");
  await page("");
  const w2 = await spike.openWindow();
  await w2.spike.resize(900, 600);
  const rec2 = K.recordActions(w2);
  w2.vitre.navigate(w2.vitre.active(), K.pageURL("keys.html"));
  await waitFor(() => w2.vitre.active().url.includes("keys.html") && !w2.vitre.active().loading, { timeout: 20000, what: "second window page" });
  check("the second window has its own router with Firefox's keys parked", w2.vitre.keys.parked >= 80 && w2.vitre.keys !== b.keys, w2.vitre.keys.parked);
  b.sys("VitreSettings").set({ rebind: { peekLink: "Ctrl+K", switcherSearch: "Ctrl+Shift+E" } });
  await sleep(200);
  rec.ran.length = 0;
  window.focus();
  b.focusPage();
  await sleep(300);
  a = [...(await key("Ctrl+K")), ...(await key("Ctrl+Q")), ...(await key("Ctrl+Shift+E")), ...(await key("Ctrl+Shift+A"))];
  check("after rebinding, Ctrl+K peeks and Ctrl+Shift+E searches tabs; the old keys do nothing", a.join() === "peekLink[page-first/reply],switcherSearch[page-first/reply]" && rec.ran.join() === "peekLink,switcherSearch", { a, ran: rec.ran.slice() });
  w2.focus();
  w2.vitre.focusPage();
  await sleep(500);
  press("Ctrl+K", {}, w2);
  press("Ctrl+Q", {}, w2);
  press("Ctrl+T", {}, w2);
  await sleep(500);
  check("the second window follows the same rebind, and its keys run in that window only", rec2.ran.slice().sort().join() === "newTab,peekLink" && rec.ran.join() === "peekLink,switcherSearch", { second: rec2.ran.slice(), first: rec.ran.slice() });
  b.sys("VitreSettings").reset("rebind");
  await sleep(200);
  rec2.restore();
  w2.close();
  await sleep(600);
  window.focus();
  b.focusPage();
  await sleep(300);
  a = await key("Ctrl+Q");
  check("resetting the rebind brings Ctrl+Q back", a.join() === "peekLink[page-first/reply]", a);

  // ------------------------------------------------------------------ 13. full screen and keyboard lock
  log("--- 13. full screen and keyboard lock");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  Services.prefs.setStringPref("full-screen-api.transition-duration.enter", "0 0");
  Services.prefs.setStringPref("full-screen-api.transition-duration.leave", "0 0");
  Services.prefs.setIntPref("full-screen-api.warning.timeout", 0);
  const enter = async (lock) => {
    await evalInPage("goFull(" + (lock ? "true" : "false") + ")");
    for (let i = 0; i < 30 && !document.fullscreenElement; i++) await sleep(150);
    await sleep(600);
    b.focusPage();
    await sleep(250);
    return !!document.fullscreenElement;
  };
  const leave = async () => {
    if (document.fullscreenElement) { document.exitFullscreen(); await sleep(900); }
    if (window.fullScreen) { window.fullScreen = false; await sleep(700); }
  };
  await page("prevent=*");
  if (await enter(false)) {
    rec.ran.length = 0;
    a = await key("F11", {}, 600);
    check("F11 in element full screen is browser-first (a page that prevents every key cannot keep it)", a.join() === "fullscreen[browser-first]", a);
    const t = await key("Ctrl+T", {}, 500);
    check("plain element full screen keeps tab keys browser-first", t.join() === "newTab[browser-first]", t);
    await leave();
    await page("");
    if ((await enter(true)) && document.fullscreenKeyboardLock === "browser") {
      const s1 = (await seen(undefined, 0)).length;
      a = await key("Ctrl+T", {}, 700);
      const sawLock = (await seen()).slice(s1);
      check("under keyboard lock Ctrl+T goes to the page first and runs when the page does not use it", a.join() === "newTab[lock/reply]" && sawLock.includes("d:ctrl-t"), { a, sawLock });
      const f6 = await key("F6", {}, 700);
      const tab = await key("Ctrl+Tab", {}, 700);
      check("... so do F6 and Ctrl+Tab (decided on the keydown reply)", f6.join() === "focusAddress(6)[lock/reply]" && tab.join() === "nextTabMru[lock/reply]", { f6, tab });
      const f11 = await key("F11", {}, 600);
      check("... and F11 still leaves at once", f11.join() === "fullscreen[browser-first]", f11);
      await leave();
      await page("prevent=ctrl-t,ctrl-w");
      if (await enter(true)) {
        a = [...(await key("Ctrl+T", {}, 700)), ...(await key("Ctrl+W", {}, 700))];
        check("a page under keyboard lock that uses Ctrl+T and Ctrl+W keeps them", a.length === 0 && K.routed().some((l) => l.startsWith("page kept")), { a, log: K.routed() });
      } else check("keyboard lock could be entered a second time", false);
    } else {
      log("SKIP keyboard lock: full screen with keyboardLock was not granted (lock=" + document.fullscreenKeyboardLock + ")");
    }
  } else {
    log("SKIP full screen: element full screen was not granted under the harness");
  }
  await leave();

  rec.restore();
  await sleep(200);
  if (disturbed) log("NOTE the test window was disturbed from outside " + disturbed + " time(s) during the battery");
  check("after the battery: still three tabs, no Firefox UI woken up", b.tabs.length === 3 && !K.snap().sidebar && !K.snap().findbar && !K.snap().devtools, K.snap());
  await spike.capture("keys-end");
});
