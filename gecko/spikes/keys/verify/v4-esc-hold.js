// v4 (verifier): keyboard lock in element full screen. Does "hold Esc" leave full screen, and does
// the Vitre router (which hides page-first keydowns from the system group) break it?
//   KS_MODE=stock  : untouched Firefox        KS_MODE=router : neutralise + spike router
//   KS_KEYS=fixed  : use vitre-keys-fixed.js and send browser-first keys to the page under lock
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
const fixed = Services.env.get("KS_KEYS") === "fixed";
Services.scriptloader.loadSubScript("resource://vitre-boot/" + (fixed ? "vitre-keys-fixed.js" : "vitre-keys.js") + "?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const mode = Services.env.get("KS_MODE") || "stock";
  spike.log("mode " + mode + (fixed ? " (fixed router)" : "") + "; dom.fullscreen.keyboard_lock.enabled=" + Services.prefs.getBoolPref("dom.fullscreen.keyboard_lock.enabled", false));
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  Services.prefs.setStringPref("full-screen-api.transition-duration.enter", "0 0");
  Services.prefs.setStringPref("full-screen-api.transition-duration.leave", "0 0");
  const actions = [];
  if (mode === "router") {
    VitreKeys.neutralise();
    VitreKeys.install({
      onAction: (a, arg, info) => actions.push(a + "[" + info.how + "]"),
      priorityOf: (b) => (fixed && document.fullscreenElement && document.fullscreenKeyboardLock === "browser" && b.priority === "browser" ? "page" : undefined),
    });
  }
  const page = (code) => KS.inPage("function(w,d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }");
  const fsState = async () => "chrome fullscreenElement=" + (document.fullscreenElement ? document.fullscreenElement.localName : null) + " window.fullScreen=" + window.fullScreen + " keyboardLock=" + document.fullscreenKeyboardLock;
  const enter = async () => { await page("goFull(true)"); for (let i = 0; i < 30 && !document.fullscreenElement; i++) await spike.sleep(150); await spike.sleep(700); gBrowser.selectedBrowser.focus(); await spike.sleep(200); };
  const load = async (q) => { await KS.load(KS.pageURL("edge.html", q)); window.focus(); gBrowser.selectedBrowser.focus(); await spike.sleep(300); };

  await load("");
  await enter();
  spike.log("entered: " + (await fsState()));
  let s0 = (await KS.pageSeen()).length;
  KS.press("Escape");
  await spike.sleep(900);
  spike.log("Esc tap -> " + (await fsState()) + " | vitre " + JSON.stringify(actions.splice(0)) + " | page saw " + JSON.stringify((await KS.pageSeen()).slice(s0)));
  if (!document.fullscreenElement) await enter();
  // hold: keydown, then auto-repeat keydowns every 50 ms for up to 5 s, then keyup
  s0 = (await KS.pageSeen()).length;
  const t0 = performance.now();
  KS.down("Escape");
  let left = null;
  for (let i = 0; i < 100; i++) {
    await spike.sleep(50);
    if (!document.fullscreenElement) { left = Math.round(performance.now() - t0); break; }
    KS.EU.synthesizeKey("KEY_Escape", { type: "keydown", repeat: 2 }, window);
  }
  KS.up("Escape");
  await spike.sleep(900);
  spike.log("Esc held with repeats -> left full screen after " + (left === null ? "NEVER (5 s)" : left + " ms") + " | " + (await fsState()) + " | vitre " + JSON.stringify(actions.splice(0)) + " | page saw " + (await KS.pageSeen()).slice(s0).length + " key events");
  if (!document.fullscreenElement) await enter();
  // hold without repeats: one keydown, wait, keyup
  const t1 = performance.now();
  KS.down("Escape");
  left = null;
  for (let i = 0; i < 100; i++) { await spike.sleep(50); if (!document.fullscreenElement) { left = Math.round(performance.now() - t1); break; } }
  KS.up("Escape");
  await spike.sleep(900);
  spike.log("Esc held, single keydown no repeats -> left full screen after " + (left === null ? "NEVER (5 s)" : left + " ms") + " | " + (await fsState()));
  if (!document.fullscreenElement) await enter();
  // the tab keys under lock
  for (const k of ["Ctrl+T", "Ctrl+W", "Ctrl+Tab", "F11", "F6", "Ctrl+L"]) {
    s0 = (await KS.pageSeen()).length;
    const tabs = gBrowser.tabs.length;
    actions.length = 0;
    KS.press(k);
    await spike.sleep(900);
    spike.log(k.padEnd(9) + " under keyboard lock -> page saw " + JSON.stringify((await KS.pageSeen()).slice(s0)) + " | vitre " + JSON.stringify(actions.slice()) + " | tabs " + tabs + "->" + gBrowser.tabs.length + " | " + (await fsState()));
    for (const t of [...gBrowser.tabs].slice(1)) gBrowser.removeTab(t);
    if (window.fullScreen && !document.fullscreenElement) { window.fullScreen = false; await spike.sleep(700); }
    if (!document.fullscreenElement) { await load(""); await enter(); }
  }
  // a page that prevents everything under lock: can the user still get out?
  if (document.fullscreenElement) { document.exitFullscreen(); await spike.sleep(900); }
  await load("prevent=*");
  await enter();
  actions.length = 0;
  KS.press("Ctrl+W"); KS.press("Ctrl+T"); KS.press("F11");
  await spike.sleep(900);
  spike.log("page prevents every keydown under lock: Ctrl+W, Ctrl+T, F11 -> vitre " + JSON.stringify(actions.slice()) + " | tabs " + gBrowser.tabs.length + " | " + (await fsState()));
  if (document.fullscreenElement) { document.exitFullscreen(); await spike.sleep(700); }
});
