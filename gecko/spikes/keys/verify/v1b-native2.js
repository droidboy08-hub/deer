// v1b (verifier): follow-up to v1-native.js.
//   A. layout cases that expose the keyName() bug, run against the spike's router (default) or the
//      verifier's fixed copy (env KS_KEYS=fixed -> vitre-keys-fixed.js).
//   B. Alt+letter with a real WM_SYSCHAR, mouse side button with a page that prevents it,
//      WM_CONTEXTMENU(-1) with focus in a Vitre field.
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
const fixed = Services.env.get("KS_KEYS") === "fixed";
Services.scriptloader.loadSubScript("resource://vitre-boot/" + (fixed ? "vitre-keys-fixed.js" : "vitre-keys.js") + "?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  spike.log("router under test: " + (fixed ? "vitre-keys-fixed.js (verifier)" : "vitre-keys.js (spike, unchanged copy)"));
  const U = window.windowUtils;
  const M = Ci.nsIDOMWindowUtils;
  const actions = [];
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + "]") });
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const chromeSaw = [];
  window.addEventListener("keydown", (e) => {
    if (/^(Control|Alt|AltGraph|Shift)$/.test(e.key)) return;
    chromeSaw.push("key=" + JSON.stringify(e.key) + " code=" + e.code + " kc=" + e.keyCode + " -> name=" + VitreKeys.keyName(e));
  }, true);
  const LAYOUT = { US: 0x409, German: 0x407, French: 0x40c, Russian: 0x419, Dvorak: 0x10409, Greek: 0x408, Turkish: 0x41f, Hebrew: 0x40d };
  let pass = 0, fail = 0;
  const native = async (label, layout, vk, mods, chars, unmod, expect) => {
    actions.length = 0; chromeSaw.length = 0;
    let err = "";
    try {
      await new Promise((resolve) => { U.sendNativeKeyEvent(LAYOUT[layout], vk, mods, chars, unmod, { observe: () => resolve() }); setTimeout(resolve, 1500); });
    } catch (e) { err = " THROWS " + e; }
    await spike.sleep(350);
    const got = actions.map((a) => a.replace(/\[.*$/, "")).join(",") || "-";
    const ok = got === expect;
    if (ok) pass++; else fail++;
    spike.log((ok ? "PASS " : "FAIL ") + (layout + " " + label).padEnd(46) + "vitre: " + got.padEnd(16) + " expected: " + expect.padEnd(14) + (chromeSaw[0] || "") + err);
  };
  const VK = (c) => c.toUpperCase().charCodeAt(0);
  const CTRL = M.NATIVE_MODIFIER_CONTROL_LEFT, ALT = M.NATIVE_MODIFIER_ALT_LEFT, ALTR = M.NATIVE_MODIFIER_ALT_RIGHT, ALTGR = M.NATIVE_MODIFIER_ALT_GRAPH, SHIFT = M.NATIVE_MODIFIER_SHIFT_LEFT;
  const ctl = (c) => String.fromCharCode(c.toUpperCase().charCodeAt(0) - 64);
  const COMMA = 0xbc, PERIOD = 0xbe, OEM7 = 0xde, OEM1 = 0xba;

  spike.log("--- A. layouts through the native key path");
  await native("Ctrl+, (VK_OEM_COMMA)", "US", COMMA, CTRL, "", ",", "settings");
  await native("Ctrl+, (physical W)", "Dvorak", COMMA, CTRL, "", ",", "settings");
  await native("Ctrl+. (physical E)", "Dvorak", PERIOD, CTRL, "", ".", "-");
  await native("Ctrl+' (physical Q; Ctrl+Q is bound)", "Dvorak", OEM7, CTRL, "", "'", "-");
  await native("Ctrl+; (physical Z)", "Dvorak", OEM1, CTRL, "", ";", "-");
  await native("Ctrl+W (physical comma)", "Dvorak", VK("W"), CTRL, ctl("W"), "w", "closeTab");
  await native("Ctrl+T (physical K)", "Dvorak", VK("T"), CTRL, ctl("T"), "t", "newTab");
  await native("Ctrl+L (physical P)", "Dvorak", VK("L"), CTRL, ctl("L"), "l", "focusAddress");
  await native("Ctrl+, (physical M)", "French", COMMA, CTRL, "", ",", "settings");
  await native("Ctrl+M (physical semicolon)", "French", VK("M"), CTRL, ctl("M"), "m", "-");
  await native("Ctrl+Q (physical A)", "French", VK("Q"), CTRL, ctl("Q"), "q", "peekLink");
  await native("Ctrl+W (physical Z)", "French", VK("W"), CTRL, ctl("W"), "w", "closeTab");
  await native("Ctrl+1 (types &)", "French", VK("1"), CTRL, "", "&", "goTab(1)");
  await native("Ctrl+6 (types -)", "French", VK("6"), CTRL, "", "-", "zoomOut");
  await native("Ctrl+= ", "French", 0xbb, CTRL, "", "=", "zoomIn");
  await native("Ctrl+, (types Cyrillic be)", "Russian", COMMA, CTRL, "", "б", "settings");
  await native("Ctrl+T", "Russian", VK("T"), CTRL, ctl("T"), "е", "newTab");
  await native("Ctrl+L", "Russian", VK("L"), CTRL, ctl("L"), "д", "focusAddress");
  await native("Alt+D with WM_SYSCHAR", "Russian", VK("D"), ALT, "в", "в", "focusAddress");
  await native("Ctrl+T", "Greek", VK("T"), CTRL, ctl("T"), "τ", "newTab");
  await native("Ctrl+F", "Hebrew", VK("F"), CTRL, ctl("F"), "כ", "find");
  await native("Ctrl++ (the + key)", "German", 0xbb, CTRL, "", "+", "zoomIn");
  await native("Ctrl+- (the - key)", "German", 0xbd, CTRL, "", "-", "zoomOut");
  await native("Ctrl+Z (physical Y)", "German", VK("Z"), CTRL, ctl("Z"), "z", "-");
  await native("AltGr+Q", "German", VK("Q"), ALTGR, "@", "q", "-");
  await native("AltGr+D", "German", VK("D"), ALTGR, "", "d", "-");
  await native("Alt+D with WM_SYSCHAR", "US", VK("D"), ALT, "d", "d", "focusAddress");
  await native("RightAlt+D with WM_SYSCHAR (no AltGr)", "US", VK("D"), ALTR, "d", "d", "focusAddress");
  await native("Alt+Left", "US", 0x25, ALT, "", "", "back");
  await native("Ctrl+Shift+T", "US", VK("T"), CTRL | SHIFT, ctl("T"), "T", "reopenClosed");
  await native("Ctrl+I (Turkish dotless/dotted I)", "Turkish", VK("I"), CTRL, "\t", "ı", "-");
  await native("Ctrl+Shift+I", "Turkish", VK("I"), CTRL | SHIFT, "\t", "I", "devtools");
  spike.log("RESULT A (" + (fixed ? "fixed" : "spike") + " keyName) pass=" + pass + " fail=" + fail);

  // ------------------------------------------------------------------------------------------
  spike.log("--- B. posted window messages");
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const hwnd = ctypes.voidptr_t(ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
  const post = (msg, w, l) => PostMessageW(hwnd, msg, ctypes.UInt64(w >>> 0), ctypes.Int64(l));
  const WM_CONTEXTMENU = 0x7b, WM_XBUTTONDOWN = 0x20b, WM_XBUTTONUP = 0x20c;
  const ev = [];
  const app = [];
  window.removeEventListener("AppCommand", window.HandleAppCommandEvent, true);
  window.addEventListener("AppCommand", (e) => { app.push(e.command); e.stopPropagation(); e.preventDefault(); }, true);
  window.addEventListener("popupshown", (e) => ev.push("popup:" + e.target.id), true);
  window.addEventListener("contextmenu", (e) => ev.push("chrome contextmenu target=" + e.target.localName + (e.target.id ? "#" + e.target.id : "") + " inputSource=" + e.inputSource + " defaultPrevented=" + e.defaultPrevented), true);
  for (const t of ["mousedown", "mouseup", "auxclick", "click"]) window.addEventListener(t, (e) => { if (e.button > 2) ev.push("chrome " + t + " button=" + e.button + " target=" + e.target.localName); }, true);
  const closePopups = () => { for (const p of document.querySelectorAll("menupopup, panel")) if (p.state === "open" || p.state === "showing") p.hidePopup(); };
  const hook = (prevent) => KS.inPage("function(w,d){ const W = w.wrappedJSObject; W.eval(\"window.__m = []; for (const t of ['mousedown','mouseup','auxclick','contextmenu']) addEventListener(t, (e) => { if (" + (prevent ? "true" : "false") + " && e.button > 2) e.preventDefault(); __m.push(t + ':' + e.button + (e.defaultPrevented ? '!' : '')); }, true);\"); return 1; }");
  const pageMouse = () => KS.inPage(function (w, d) { return w.wrappedJSObject.eval("JSON.stringify(window.__m || [])"); });

  const r = gBrowser.selectedBrowser.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const cx = Math.round((r.left + 200) * dpr), cy = Math.round((r.top + 300) * dpr);
  const xbutton = async (which) => { post(WM_XBUTTONDOWN, (which << 16) | (which === 1 ? 0x20 : 0x40), (cy << 16) | cx); await spike.sleep(60); post(WM_XBUTTONUP, which << 16, (cy << 16) | cx); await spike.sleep(900); };
  await hook(false);
  ev.length = 0;
  await xbutton(1); await xbutton(2);
  spike.log("  B1 mouse side buttons (WM_XBUTTONDOWN/UP 1 and 2) over a page that prevents nothing: AppCommand " + JSON.stringify(app.splice(0)) + " | chrome " + JSON.stringify(ev.splice(0)) + " | page " + (await pageMouse()));
  await KS.load(KS.pageURL("keys.html", "x=1"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  await hook(true);
  await xbutton(1);
  spike.log("  B2 same on a page that preventDefaults mousedown/mouseup of buttons 3/4: AppCommand " + JSON.stringify(app.splice(0)) + " | chrome " + JSON.stringify(ev.splice(0)) + " | page " + (await pageMouse()));

  // WM_CONTEXTMENU(-1) = the keyboard context menu (Shift+F10 / Menu key), focus in a Vitre field
  const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
  input.id = "vitre-field"; input.value = "vitre field";
  input.style.cssText = "position:fixed;left:300px;top:120px;width:300px;height:30px;z-index:9999;";
  document.body.appendChild(input);
  input.focus();
  await spike.sleep(200);
  ev.length = 0;
  post(WM_CONTEXTMENU, 0, -1);
  await spike.sleep(1000);
  spike.log("  B3 WM_CONTEXTMENU(-1), focus in a Vitre <html:input>: " + JSON.stringify(ev.splice(0)));
  await spike.capture("v1b-field-menu");
  closePopups();
  const own = (e) => { e.preventDefault(); ev.push("vitre field handled contextmenu itself"); };
  input.addEventListener("contextmenu", own);
  post(WM_CONTEXTMENU, 0, -1);
  await spike.sleep(1000);
  spike.log("  B3b same, the field preventDefaults 'contextmenu' (Vitre draws its own menu): " + JSON.stringify(ev.splice(0)));
  closePopups();
  input.remove();
  // focus on a link in the page: where is the menu anchored and which target does nsContextMenu see?
  gBrowser.selectedBrowser.focus();
  await KS.inPage(function (w, d) { d.getElementById("link").focus(); return 1; });
  await spike.sleep(300);
  post(WM_CONTEXTMENU, 0, -1);
  await spike.sleep(1200);
  const menu = document.getElementById("contentAreaContextMenu");
  const openLink = document.getElementById("context-openlinkintab");
  spike.log("  B4 WM_CONTEXTMENU(-1), focus on a page link: " + JSON.stringify(ev.splice(0)) + " | menu " + menu.state + " | 'Open Link in New Tab' shown: " + (openLink && !openLink.hidden) + " | gContextMenu.linkURL=" + (window.gContextMenu && window.gContextMenu.linkURL));
  if (menu.state === "open") await spike.capture("v1b-link-menu");
  closePopups();
  user32.close();
});
