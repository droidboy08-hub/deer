// v1 (verifier): the claims the spike could only reach through the text input processor, tried
// again through Gecko's NATIVE Windows key path, still in-process and without OS focus:
//   A. windowUtils.sendNativeKeyEvent(layout, vk, modifiers, chars, unmodifiedChars)
//      -> widget/windows NativeKey with a real keyboard layout DLL (German, French, Russian, Dvorak)
//      -> real AltGr handling, real key/code values per layout.
//   B. user32 PostMessageW to this window's own HWND (js-ctypes):
//      WM_APPCOMMAND (hardware Back/Forward..., keyboard and mouse device),
//      WM_KEYDOWN/UP VK_BROWSER_BACK (does a consumed keydown still produce an AppCommand?),
//      WM_KEYDOWN/UP VK_APPS and WM_CONTEXTMENU(-1) (Menu key / Shift+F10 context menu),
//      WM_SYSKEYDOWN/UP VK_MENU and VK_F10 (Alt / F10 alone on the real message path).
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const U = window.windowUtils;
  const M = Ci.nsIDOMWindowUtils;
  spike.log("native modifier constants: " + Object.keys(M).filter((k) => k.startsWith("NATIVE_MODIFIER")).map((k) => k.replace("NATIVE_MODIFIER_", "") + "=0x" + M[k].toString(16)).join(" "));

  const actions = [];
  const routerLog = [];
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + "]"), log: (m) => routerLog.push(m) });
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);

  const chromeSaw = [];
  window.addEventListener("keydown", (e) => {
    chromeSaw.push("key=" + JSON.stringify(e.key) + " code=" + e.code + " kc=" + e.keyCode + " ctrl=" + e.ctrlKey + " alt=" + e.altKey + " shift=" + e.shiftKey + " AltGraph=" + e.getModifierState("AltGraph") + " guard=" + VitreKeys.guarded(e) + " name=" + VitreKeys.keyName(e));
  }, true);

  const LAYOUT = { US: 0x409, German: 0x407, French: 0x40c, Russian: 0x419, Dvorak: 0x10409, Spanish: 0x40a, UKext: 0x452 };
  const native = async (label, layout, vk, mods, chars, unmod) => {
    actions.length = 0; chromeSaw.length = 0;
    const before = (await KS.pageSeen()).length;
    let err = "";
    try {
      await new Promise((resolve) => {
        U.sendNativeKeyEvent(LAYOUT[layout], vk, mods, chars, unmod, { observe: () => resolve() });
        setTimeout(resolve, 1500);
      });
    } catch (e) { err = " THROWS " + e; }
    await spike.sleep(350);
    const page = (await KS.pageSeen()).slice(before);
    spike.log((layout + " " + label).padEnd(44) + "vitre: " + (actions.join(",") || "-") + err);
    for (const c of chromeSaw.filter((c) => !/key="(Control|Alt|AltGraph|Shift)"/.test(c))) spike.log("        chrome keydown " + c);
    spike.log("        page saw " + JSON.stringify(page));
  };
  const VK = (c) => c.toUpperCase().charCodeAt(0);
  const CTRL = M.NATIVE_MODIFIER_CONTROL_LEFT, ALT = M.NATIVE_MODIFIER_ALT_LEFT, ALTR = M.NATIVE_MODIFIER_ALT_RIGHT, ALTGR = M.NATIVE_MODIFIER_ALT_GRAPH, SHIFT = M.NATIVE_MODIFIER_SHIFT_LEFT;
  const ctl = (c) => String.fromCharCode(c.toUpperCase().charCodeAt(0) - 64);

  spike.log("--- A. sendNativeKeyEvent with real layout DLLs (window active: " + (Services.focus.activeWindow === window) + ")");
  await native("Ctrl+T", "US", VK("T"), CTRL, ctl("T"), "t");
  await native("Ctrl+L", "US", VK("L"), CTRL, ctl("L"), "l");
  await native("LCtrl+LAlt+T (no AltGr on US)", "US", VK("T"), CTRL | ALT, "", "t");
  await native("RightAlt+D (US: plain Alt)", "US", VK("D"), ALTR, "", "d");
  await native("AltGr+Q -> @", "German", VK("Q"), ALTGR, "@", "q");
  await native("AltGr+E -> euro", "German", VK("E"), ALTGR, "€", "e");
  await native("AltGr+T (types nothing)", "German", VK("T"), ALTGR, "", "t");
  await native("AltGr+D (types nothing; Alt+D is bound)", "German", VK("D"), ALTGR, "", "d");
  await native("AltGr+Left", "German", 0x25, ALTGR, "", "");
  await native("LCtrl+LAlt+Q (also types @)", "German", VK("Q"), CTRL | ALT, "@", "q");
  await native("LCtrl+LAlt+T (types nothing)", "German", VK("T"), CTRL | ALT, "", "t");
  await native("Ctrl+T", "German", VK("T"), CTRL, ctl("T"), "t");
  await native("Ctrl+Z (physical Y key)", "German", VK("Z"), CTRL, ctl("Z"), "z");
  await native("Ctrl+OEM_PLUS (the + key)", "German", 0xbb, CTRL, "", "+");
  await native("Ctrl+OEM_MINUS (the - key)", "German", 0xbd, CTRL, "", "-");
  await native("Ctrl+OEM_COMMA", "German", 0xbc, CTRL, "", ",");
  await native("Ctrl+1 (digit row types &)", "French", VK("1"), CTRL, "", "&");
  await native("Ctrl+6 (digit row types -)", "French", VK("6"), CTRL, "", "-");
  await native("Ctrl+0 (digit row types a-grave)", "French", VK("0"), CTRL, "", "à");
  await native("Ctrl+Q (physical A key)", "French", VK("Q"), CTRL, ctl("Q"), "q");
  await native("Ctrl+A (physical Q key)", "French", VK("A"), CTRL, ctl("A"), "a");
  await native("Ctrl+W (physical Z key)", "French", VK("W"), CTRL, ctl("W"), "w");
  await native("Ctrl+OEM_PLUS (the = key)", "French", 0xbb, CTRL, "", "=");
  await native("AltGr+0 -> @", "French", VK("0"), ALTGR, "@", "à");
  await native("Ctrl+T (key types Cyrillic ie)", "Russian", VK("T"), CTRL, ctl("T"), "е");
  await native("Ctrl+L", "Russian", VK("L"), CTRL, ctl("L"), "д");
  await native("Ctrl+W", "Russian", VK("W"), CTRL, ctl("W"), "ц");
  await native("Ctrl+OEM_COMMA (types Cyrillic be)", "Russian", 0xbc, CTRL, "", "б");
  await native("Alt+D (types Cyrillic ve)", "Russian", VK("D"), ALT, "", "в");
  await native("Ctrl+T (physical K key)", "Dvorak", VK("T"), CTRL, ctl("T"), "t");
  await native("Ctrl+K (physical V key)", "Dvorak", VK("K"), CTRL, ctl("K"), "k");
  await native("Ctrl+W (physical comma key)", "Dvorak", VK("W"), CTRL, ctl("W"), "w");
  await native("Ctrl+OEM_COMMA (physical W key)", "Dvorak", 0xbc, CTRL, "", ",");
  await native("Ctrl+Tab", "US", 0x09, CTRL, "", "");
  await native("F6", "US", 0x75, 0, "", "");
  await native("Ctrl+NumpadAdd", "US", 0x6b, CTRL, "", "+");
  await native("Ctrl+Numpad0", "US", 0x60, CTRL, "", "0");

  // ------------------------------------------------------------------------------------------
  spike.log("--- B. window messages posted to this window's HWND (PostMessageW through js-ctypes)");
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const hwndStr = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
  const hwnd = ctypes.voidptr_t(ctypes.UInt64(hwndStr));
  spike.log("  hwnd " + hwndStr);
  const post = (msg, w, l) => PostMessageW(hwnd, msg, ctypes.UInt64(w >>> 0), ctypes.Int64(l));
  const WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105, WM_CONTEXTMENU = 0x7b, WM_APPCOMMAND = 0x319, WM_XBUTTONDOWN = 0x20b, WM_XBUTTONUP = 0x20c;
  const keyL = (scan, up, ext, alt) => ((scan << 16) | 1 | (ext ? 1 << 24 : 0) | (alt ? 1 << 29 : 0)) + (up ? 0xc0000000 : 0);

  const ev = [];
  const appCmds = [];
  window.addEventListener("AppCommand", (e) => { appCmds.push("AppCommand:" + e.command + (e.isTrusted ? "(trusted)" : "") + " target=" + (e.target && (e.target.localName || e.target.constructor.name))); }, true);
  window.addEventListener("popupshown", (e) => ev.push("popup:" + e.target.id), true);
  window.addEventListener("contextmenu", (e) => ev.push("chrome contextmenu event target=" + (e.target && e.target.localName) + " inputSource=" + e.inputSource + " button=" + e.button), true);
  window.addEventListener("DOMMenuBarActive", () => ev.push("menubar ACTIVE"), true);
  const closePopups = () => { for (const p of document.querySelectorAll("menupopup, panel")) if (p.state === "open" || p.state === "showing") p.hidePopup(); };

  // B1. WM_APPCOMMAND with Firefox's own handler still attached
  await KS.load(KS.pageURL("keys.html", "second=1"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  post(WM_APPCOMMAND, 0, 1 << 16); // APPCOMMAND_BROWSER_BACKWARD, device = key
  await spike.sleep(1200);
  spike.log("  B1 stock handler: WM_APPCOMMAND(BROWSER_BACKWARD) -> " + JSON.stringify(appCmds.splice(0)) + "; went back: " + !gBrowser.currentURI.spec.includes("second=1"));
  // B2. Vitre takes AppCommand over
  window.removeEventListener("AppCommand", window.HandleAppCommandEvent, true);
  const vitreApp = [];
  window.addEventListener("AppCommand", (e) => { vitreApp.push(e.command); e.stopPropagation(); e.preventDefault(); }, true);
  await KS.load(KS.pageURL("keys.html", "third=1"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  for (const cmd of [1, 2, 3, 4, 5, 6, 7]) { post(WM_APPCOMMAND, 0, cmd << 16); await spike.sleep(150); }
  post(WM_APPCOMMAND, 0, (0x8000 | 1) << 16); // Back from a mouse (FAPPCOMMAND_MOUSE)
  await spike.sleep(900);
  spike.log("  B2 after removing HandleAppCommandEvent: native WM_APPCOMMAND 1..7 + mouse Back -> Vitre listener got " + JSON.stringify(vitreApp.splice(0)) + "; still at " + gBrowser.currentURI.spec.slice(-12) + "; raw " + JSON.stringify(appCmds.splice(0)));

  // B3. the Browser Back KEY: WM_KEYDOWN VK_BROWSER_BACK. Router has BrowserBack browser-first.
  actions.length = 0; chromeSaw.length = 0;
  post(WM_KEYDOWN, 0xa6, keyL(0x6a, false, true)); post(WM_KEYUP, 0xa6, keyL(0x6a, true, true));
  await spike.sleep(900);
  spike.log("  B3 posted WM_KEYDOWN/UP VK_BROWSER_BACK, router takes it browser-first: router " + JSON.stringify(actions.slice()) + " | AppCommand events " + JSON.stringify(vitreApp.splice(0)) + " | chrome keydown " + JSON.stringify(chromeSaw.slice()));
  // ...and when Vitre does NOT consume the keydown (filter lets it through)
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + "[" + info.how + "]"), filter: (b) => !/^Browser/.test(b.key) });
  actions.length = 0; chromeSaw.length = 0;
  const seen0 = (await KS.pageSeen()).length;
  post(WM_KEYDOWN, 0xa6, keyL(0x6a, false, true)); post(WM_KEYUP, 0xa6, keyL(0x6a, true, true));
  await spike.sleep(900);
  post(WM_KEYDOWN, 0xa8, keyL(0x67, false, true)); post(WM_KEYUP, 0xa8, keyL(0x67, true, true)); // VK_BROWSER_REFRESH
  await spike.sleep(900);
  spike.log("  B3b same keys NOT consumed by the router: router " + JSON.stringify(actions.slice()) + " | AppCommand events " + JSON.stringify(vitreApp.splice(0)) + " | page saw " + JSON.stringify((await KS.pageSeen()).slice(seen0)));
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + "[" + info.how + "]") });

  // B4. mouse side button: WM_XBUTTONDOWN/UP (XBUTTON1) over the page
  const r = gBrowser.selectedBrowser.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const cx = Math.round((r.left + 200) * dpr), cy = Math.round((r.top + 300) * dpr);
  const pageMouse = () => KS.inPage(function (w, d) { if (!w.wrappedJSObject.__m) { const m = w.wrappedJSObject.__m = new w.Array(); for (const t of ["mousedown", "mouseup", "auxclick", "contextmenu"]) w.addEventListener(t, function (e) { w.wrappedJSObject.__m.push(t + ":" + e.button); }, true); } return w.JSON.stringify(w.wrappedJSObject.__m); });
  await pageMouse();
  post(WM_XBUTTONDOWN, (1 << 16) | 0x20, (cy << 16) | cx); post(WM_XBUTTONUP, 1 << 16, (cy << 16) | cx);
  await spike.sleep(900);
  spike.log("  B4 posted WM_XBUTTONDOWN/UP (XBUTTON1) at client " + cx + "," + cy + ": AppCommand events " + JSON.stringify(vitreApp.splice(0)) + " | page mouse events " + (await pageMouse()));

  // B5. Menu key (VK_APPS) and WM_CONTEXTMENU(-1): the keyboard context menu
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await KS.inPage(function (w, d) { d.getElementById("link").focus(); return 1; });
  await spike.sleep(300);
  await pageMouse();
  ev.length = 0; actions.length = 0;
  post(WM_KEYDOWN, 0x5d, keyL(0x5d, false, true)); post(WM_KEYUP, 0x5d, keyL(0x5d, true, true));
  await spike.sleep(1200);
  const menu = document.getElementById("contentAreaContextMenu");
  spike.log("  B5 posted WM_KEYDOWN/UP VK_APPS, focus on a page link: " + JSON.stringify(ev.slice()) + " | context menu state " + menu.state + " | router " + JSON.stringify(actions) + " | page: keys " + JSON.stringify((await KS.pageSeen()).slice(-2)) + " mouse " + (await pageMouse()));
  if (menu.state === "open") { spike.log("      menu anchored on link: openLinkInNewTab item visible = " + !document.getElementById("context-openlinkintab").hidden); await spike.capture("v1-menu-key"); }
  closePopups(); await spike.sleep(300);
  ev.length = 0;
  post(WM_CONTEXTMENU, 0, -1);
  await spike.sleep(1200);
  spike.log("  B5b posted WM_CONTEXTMENU lParam=-1 (what Shift+F10 produces): " + JSON.stringify(ev.slice()) + " | context menu state " + menu.state + " | page mouse " + (await pageMouse()));
  closePopups(); await spike.sleep(300);
  // a page that replaces the context menu keeps the keyboard context menu too (page-first)
  await KS.load(KS.pageURL("keys.html", "nocontext=1"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  ev.length = 0;
  post(WM_CONTEXTMENU, 0, -1);
  await spike.sleep(1200);
  spike.log("  B5c same on a page that preventDefaults contextmenu: " + JSON.stringify(ev.slice()) + " | menu state " + menu.state + " | page saw " + JSON.stringify((await KS.pageSeen()).slice(-2)));
  closePopups();
  // focus in a Vitre chrome field: where does the contextmenu event go?
  const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
  input.id = "vitre-field"; input.value = "vitre field";
  input.style.cssText = "position:fixed;left:300px;top:120px;width:300px;height:30px;z-index:9999;";
  document.body.appendChild(input);
  input.focus();
  await spike.sleep(200);
  ev.length = 0;
  post(WM_KEYDOWN, 0x5d, keyL(0x5d, false, true)); post(WM_KEYUP, 0x5d, keyL(0x5d, true, true));
  await spike.sleep(1000);
  spike.log("  B5d Menu key with focus in a Vitre <html:input>: " + JSON.stringify(ev.slice()));
  closePopups();
  // a Vitre widget that consumes the Menu keydown suppresses the menu?
  const eat = (e) => { if (e.key === "ContextMenu") e.preventDefault(); };
  input.addEventListener("keydown", eat);
  ev.length = 0;
  post(WM_KEYDOWN, 0x5d, keyL(0x5d, false, true)); post(WM_KEYUP, 0x5d, keyL(0x5d, true, true));
  await spike.sleep(1000);
  spike.log("  B5e same, but the field preventDefaults the ContextMenu keydown: " + JSON.stringify(ev.slice()));
  closePopups();
  input.remove();

  // B6. Alt alone and F10 alone on the real WM_SYSKEY path (prefs already set by neutralise())
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  ev.length = 0;
  const s0 = (await KS.pageSeen()).length;
  post(WM_SYSKEYDOWN, 0x12, keyL(0x38, false, false, true)); post(WM_SYSKEYUP, 0x12, keyL(0x38, true, false, false));
  await spike.sleep(600);
  post(WM_KEYDOWN, 0x41, keyL(0x1e, false)); post(0x102, 0x61, keyL(0x1e, false)); post(WM_KEYUP, 0x41, keyL(0x1e, true));
  await spike.sleep(600);
  spike.log("  B6 posted Alt down/up then 'a': " + JSON.stringify(ev.slice()) + " | page saw " + JSON.stringify((await KS.pageSeen()).slice(s0)));
  ev.length = 0;
  const s1 = (await KS.pageSeen()).length;
  post(WM_SYSKEYDOWN, 0x79, keyL(0x44, false)); post(WM_SYSKEYUP, 0x79, keyL(0x44, true));
  await spike.sleep(600);
  post(WM_KEYDOWN, 0x41, keyL(0x1e, false)); post(0x102, 0x61, keyL(0x1e, false)); post(WM_KEYUP, 0x41, keyL(0x1e, true));
  await spike.sleep(600);
  spike.log("  B6b posted F10 down/up then 'a': " + JSON.stringify(ev.slice()) + " | page saw " + JSON.stringify((await KS.pageSeen()).slice(s1)));
  user32.close();
  await spike.capture("v1-end");
});
