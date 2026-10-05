// v3 (verifier): attempts to break the routing claims on things real pages do.
//   env KS_KEYS=fixed uses vitre-keys-fixed.js, otherwise the spike's router (unchanged copy).
//   1 page <dialog> + Esc            2 <select> dropdown (parent-process popup) + Esc / Ctrl+T
//   3 element full screen + Esc/F11  4 keyboard lock (dom.fullscreen.keyboard_lock.enabled)
//   5 busy page: page-first latency and type-ahead after Ctrl+L
//   6 priorityOf turning a browser-first key into page-first (needed for keyboard lock)
//   7 second browser window with its own router   8 a real site that uses Ctrl+K (react.dev)
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
const fixed = Services.env.get("KS_KEYS") === "fixed";
const KEYS_FILE = fixed ? "vitre-keys-fixed.js" : "vitre-keys.js";
Services.scriptloader.loadSubScript("resource://vitre-boot/" + KEYS_FILE + "?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  spike.log("router under test: " + KEYS_FILE + "; focusmanager.testmode=" + Services.prefs.getBoolPref("focusmanager.testmode", false));
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  Services.prefs.setStringPref("full-screen-api.transition-duration.enter", "0 0");
  Services.prefs.setStringPref("full-screen-api.transition-duration.leave", "0 0");
  Services.prefs.setIntPref("full-screen-api.warning.timeout", 0);
  const actions = [];
  let hook = null;
  VitreKeys.neutralise();
  const onAction = (a, arg, info) => actions.push(a + "[" + info.how + "]@" + Math.round(performance.now()));
  VitreKeys.install({ onAction, priorityOf: (b, e) => (hook ? hook(b, e) : undefined) });
  const edge = (query = "") => KS.pageURL("edge.html", query);
  const go = async (query) => { await KS.load(edge(query)); window.focus(); gBrowser.selectedBrowser.focus(); await spike.sleep(300); actions.length = 0; };
  const page = (code) => KS.inPage("function(w,d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }");
  const key = async (spec, wait = 400, extra) => { actions.length = 0; KS.press(spec, extra); await spike.sleep(wait); return actions.map((a) => a.replace(/@.*/, "")); };
  const seen = () => KS.pageSeen();

  // ------------------------------------------------------------------ 1. <dialog>
  spike.log("--- 1. page <dialog>.showModal() then Esc");
  await go("");
  spike.log("  dialog open: " + (await page("openDialog()")));
  let a = await key("Escape");
  spike.log("  Esc with a modal page dialog open -> page: " + JSON.stringify(await seen()) + " | dialog still open: " + (await page("document.getElementById('dlg').open")) + " | Vitre actions: " + JSON.stringify(a) + (a.length ? "   <-- Vitre ALSO runs its Esc step (stop / close peek) on the same press" : "   (page kept it)"));
  a = await key("Escape");
  spike.log("  Esc again (dialog closed) -> Vitre actions: " + JSON.stringify(a));

  // ------------------------------------------------------------------ 2. <select> dropdown
  spike.log("--- 2. <select> dropdown (drawn by the parent process)");
  await go("");
  await page("document.getElementById('sel').focus(); 1");
  const popups = [];
  const onPop = (e) => popups.push(e.type + ":" + (e.target.id || e.target.localName));
  window.addEventListener("popupshown", onPop, true); window.addEventListener("popuphidden", onPop, true);
  KS.press("Alt+Down");
  await spike.sleep(700);
  const selPopup = document.getElementById("ContentSelectDropdown");
  const pstate = () => { const p = selPopup && (selPopup.menupopup || selPopup.querySelector("menupopup") || selPopup); return p ? p.state : "?"; };
  spike.log("  Alt+Down on a focused <select>: " + JSON.stringify(popups.splice(0)) + " popup state " + pstate());
  a = await key("Down");
  const a2 = await key("Ctrl+L");
  const a3 = await key("Escape");
  spike.log("  with the dropdown open: Down -> " + JSON.stringify(a) + ", Ctrl+L -> " + JSON.stringify(a2) + ", Esc -> " + JSON.stringify(a3) + " | popup events " + JSON.stringify(popups.splice(0)) + " state " + pstate() + " | select value " + (await page("document.getElementById('sel').value")) + " | page saw " + JSON.stringify(await seen()));
  KS.press("Alt+Down");
  await spike.sleep(700);
  const tabs0 = gBrowser.tabs.length;
  a = await key("Ctrl+T");
  spike.log("  dropdown open again (" + pstate() + "), Ctrl+T (browser-first) -> " + JSON.stringify(a) + " | popup events " + JSON.stringify(popups.splice(0)) + " state now " + pstate());
  KS.press("Escape"); await spike.sleep(300);
  window.removeEventListener("popupshown", onPop, true); window.removeEventListener("popuphidden", onPop, true);

  // ------------------------------------------------------------------ 3. element full screen
  spike.log("--- 3. element full screen (no keyboard lock)");
  const fsState = async () => "chrome fullscreenElement=" + (document.fullscreenElement ? document.fullscreenElement.localName : null) + " window.fullScreen=" + window.fullScreen + " keyboardLock=" + document.fullscreenKeyboardLock + " page fullscreenElement=" + (await page("document.fullscreenElement ? document.fullscreenElement.id : null"));
  const enter = async (lock) => { await page("goFull(" + (lock ? "true" : "false") + ")"); for (let i = 0; i < 30 && !document.fullscreenElement; i++) await spike.sleep(150); await spike.sleep(600); gBrowser.selectedBrowser.focus(); await spike.sleep(200); };
  const leave = async () => { if (document.fullscreenElement) { document.exitFullscreen(); await spike.sleep(900); } if (window.fullScreen) { window.fullScreen = false; await spike.sleep(600); } };
  await go("prevent=*");
  await enter(false);
  spike.log("  entered: " + (await fsState()));
  let s0 = (await seen()).length;
  a = await key("Escape", 1200);
  spike.log("  Esc on a page that prevents EVERY keydown -> Vitre " + JSON.stringify(a) + " | page saw " + JSON.stringify((await seen()).slice(s0)) + " | " + (await fsState()));
  await leave();
  await enter(false);
  s0 = (await seen()).length;
  a = await key("F11", 1200);
  spike.log("  F11 in element full screen (page prevents every keydown; F11 is page-first in the map) -> Vitre " + JSON.stringify(a) + " | page saw " + JSON.stringify((await seen()).slice(s0)) + " | " + (await fsState()));
  await leave();
  await enter(false);
  s0 = (await seen()).length;
  a = await key("Ctrl+T", 900);
  const a4 = await key("Ctrl+L", 900);
  spike.log("  Ctrl+T / Ctrl+L in element full screen -> Vitre " + JSON.stringify(a) + " / " + JSON.stringify(a4) + " | page saw " + JSON.stringify((await seen()).slice(s0)) + " | " + (await fsState()));
  await leave();

  // ------------------------------------------------------------------ 4. keyboard lock
  spike.log("--- 4. keyboard lock: requestFullscreen({ keyboardLock: 'browser' })");
  spike.log("  dom.fullscreen.keyboard_lock.enabled default = " + Services.prefs.getBoolPref("dom.fullscreen.keyboard_lock.enabled", false) + "; navigator.keyboard in content: " + (await page("'keyboard' in navigator")));
  Services.prefs.setBoolPref("dom.fullscreen.keyboard_lock.enabled", true);
  await go("");
  await enter(true);
  spike.log("  entered with the pref on: " + (await fsState()));
  s0 = (await seen()).length;
  a = await key("Ctrl+T", 900);
  const a5 = await key("Ctrl+W", 900);
  const a6 = await key("Escape", 1200);
  spike.log("  router as shipped by the spike: Ctrl+T -> " + JSON.stringify(a) + ", Ctrl+W -> " + JSON.stringify(a5) + ", Esc tap -> " + JSON.stringify(a6) + " | page saw " + JSON.stringify((await seen()).slice(s0)) + " | " + (await fsState()));
  // The rule in keymap.json: under keyboard lock the browser-first keys go to the page first.
  hook = (b) => (document.fullscreenElement && document.fullscreenKeyboardLock === "browser" && b.priority === "browser" ? "page" : undefined);
  if (!document.fullscreenElement) await enter(true);
  s0 = (await seen()).length;
  a = await key("Ctrl+T", 900);
  spike.log("  with priorityOf -> 'page' under keyboard lock, page does not prevent: Ctrl+T -> Vitre " + JSON.stringify(a) + " | page saw " + JSON.stringify((await seen()).slice(s0)) + " | " + (await fsState()));
  // hold Esc: synthesized repeats for ~2.2 s
  if (!document.fullscreenElement) await enter(true);
  s0 = (await seen()).length;
  KS.down("Escape");
  for (let i = 0; i < 22 && document.fullscreenElement; i++) { await spike.sleep(100); KS.EU.synthesizeKey("KEY_Escape", { type: "keydown", repeat: 1 }, window); }
  KS.up("Escape");
  await spike.sleep(900);
  spike.log("  Esc held ~2 s under keyboard lock -> " + (await fsState()) + " | page saw " + (await seen()).slice(s0).length + " key events");
  hook = null;
  await leave();
  Services.prefs.setBoolPref("dom.fullscreen.keyboard_lock.enabled", false);

  // ------------------------------------------------------------------ 5. busy page
  spike.log("--- 5. page-first keys while the page is busy (main thread blocked 2 s)");
  await go("");
  const field = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
  field.style.cssText = "position:fixed;left:300px;top:120px;width:300px;height:30px;z-index:9999;";
  document.body.appendChild(field);
  const t0 = Math.round(performance.now());
  VitreKeys.install({ onAction: (act, arg, info) => { actions.push(act + "[" + info.how + "]@" + Math.round(performance.now())); if (act === "focusAddress") field.focus(); }, priorityOf: (b, e) => (hook ? hook(b, e) : undefined) });
  actions.length = 0;
  await page("busy(2000)");
  await spike.sleep(150);
  const tPress = Math.round(performance.now());
  KS.press("Ctrl+L"); KS.EU.sendString("abc", window);
  await spike.sleep(60);
  const tT = Math.round(performance.now());
  KS.press("Ctrl+T");
  await spike.sleep(3200);
  spike.log("  Ctrl+L pressed at +0 ms, 'abc' typed right after, Ctrl+T at +" + (tT - tPress) + " ms: actions " + JSON.stringify(actions.map((x) => x.replace(/@(\d+)/, (m, t) => " at +" + (t - tPress) + " ms"))) + " | Vitre field got " + JSON.stringify(field.value) + " | page saw " + JSON.stringify(await seen()));
  field.remove();
  VitreKeys.install({ onAction, priorityOf: (b, e) => (hook ? hook(b, e) : undefined) });

  // ------------------------------------------------------------------ 6. priorityOf: browser -> page
  spike.log("--- 6. priorityOf turns a browser-first key into page-first (not in full screen)");
  hook = (b) => (b.action === "newTab" ? "page" : undefined);
  await go("");
  a = await key("Ctrl+T");
  spike.log("  page does not prevent Ctrl+T -> Vitre " + JSON.stringify(a) + " (expected newTab[page-first/reply]) | page saw " + JSON.stringify(await seen()));
  await go("prevent=ctrl-t");
  a = await key("Ctrl+T");
  spike.log("  page prevents Ctrl+T -> Vitre " + JSON.stringify(a) + " (expected nothing) | page saw " + JSON.stringify(await seen()));
  hook = null;

  // ------------------------------------------------------------------ 7. second window
  spike.log("--- 7. a second browser window, neutralised and routed the same way");
  const w2 = window.OpenBrowserWindow();
  await new Promise((r) => w2.addEventListener("load", r, { once: true }));
  for (let i = 0; i < 40 && !w2.gBrowser; i++) await spike.sleep(100);
  await spike.sleep(1500);
  Services.scriptloader.loadSubScript("resource://vitre-boot/" + KEYS_FILE + "?" + Date.now(), w2);
  const acts2 = [];
  const parked = w2.VitreKeys.neutralise();
  w2.VitreKeys.install({ onAction: (act, arg, info) => acts2.push(act + "[" + info.how + "]") });
  w2.gBrowser.selectedBrowser.fixupAndLoadURIString(edge("win=2"), { triggeringPrincipal: KS.sysPrincipal });
  await spike.sleep(1500);
  w2.focus(); await spike.sleep(400);
  w2.gBrowser.selectedBrowser.focus(); await spike.sleep(300);
  const EU2 = { window: w2, parent: w2, _EU_Ci: Ci, _EU_Cc: Cc };
  Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU2);
  actions.length = 0;
  EU2.synthesizeKey("l", { ctrlKey: true }, w2); EU2.synthesizeKey("t", { ctrlKey: true }, w2); EU2.synthesizeKey("KEY_F6", {}, w2); EU2.synthesizeKey("k", { ctrlKey: true }, w2);
  await spike.sleep(600);
  let seen2 = [];
  try { seen2 = JSON.parse(w2.gBrowser.selectedBrowser.contentTitle); } catch (e) {}
  spike.log("  window 2: parked " + parked + " keys; Ctrl+L, Ctrl+T, F6, Ctrl+K typed in window 2 -> window 2 router " + JSON.stringify(acts2) + " | window 1 router " + JSON.stringify(actions) + " | window 2 page saw " + JSON.stringify(seen2) + " | window 2 tabs " + w2.gBrowser.tabs.length + " urlbar focused: " + (w2.document.activeElement && w2.document.activeElement.id === "urlbar-input"));
  w2.close();
  await spike.sleep(600);
  window.focus(); await spike.sleep(400);

  // ------------------------------------------------------------------ 8. a real site
  spike.log("--- 8. real site: react.dev binds Ctrl+K (DocSearch). peekLink rebound to Ctrl+K for the test");
  try {
    VitreKeys.applyRebind({ peekLink: "Ctrl+K" });
    await KS.load("https://react.dev/");
    await spike.sleep(3500);
    gBrowser.selectedBrowser.focus(); await spike.sleep(400);
    const probe = () => KS.inPage(function (w, d) { const el = d.activeElement; return { url: w.location.href.slice(0, 40), active: el ? el.tagName + (el.className ? "." + String(el.className).slice(0, 40) : "") + (el.placeholder ? "[" + el.placeholder + "]" : "") : null, modal: !!d.querySelector(".DocSearch-Modal, [role=dialog], dialog[open]") }; });
    spike.log("  loaded: " + JSON.stringify(await probe()));
    a = await key("Ctrl+K", 1500);
    spike.log("  Ctrl+K -> Vitre " + JSON.stringify(a) + " | page: " + JSON.stringify(await probe()));
    await spike.capture("v3-react-ctrl-k");
    const b1 = await key("Escape", 900);
    spike.log("  Esc (closes the site's search) -> Vitre " + JSON.stringify(b1) + " | page: " + JSON.stringify(await probe()));
    const b2 = await key("Ctrl+L", 700);
    const b3 = await key("Ctrl+T", 700);
    const b4 = await key("Ctrl+F", 700);
    spike.log("  Ctrl+L -> " + JSON.stringify(b2) + ", Ctrl+T -> " + JSON.stringify(b3) + ", Ctrl+F -> " + JSON.stringify(b4));
  } catch (e) { spike.log("  real-site test failed: " + e); }
  VitreKeys.applyRebind(null);
});
