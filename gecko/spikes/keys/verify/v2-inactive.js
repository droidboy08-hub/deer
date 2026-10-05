// v2 (verifier): is key synthesis dependable when the window is NOT the active window (the normal
// state while several spikes run in parallel) and the test switches tabs? Compare
// focusmanager.testmode=false / true (run.py --pref focusmanager.testmode=true).
// The window is deactivated the way Windows does it (WM_ACTIVATE WA_INACTIVE + WM_KILLFOCUS posted
// to our own HWND), so the result does not depend on what else is on the desktop.
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const testmode = Services.prefs.getBoolPref("focusmanager.testmode", false);
  spike.log("focusmanager.testmode=" + testmode);
  const actions = [];
  let lastTarget = null;
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => { actions.push(a + "[" + info.how + "]"); lastTarget = info.event.target; } });
  await KS.load(KS.pageURL("keys.html", "tab=1"));
  const tab1 = gBrowser.selectedTab;
  const tab2 = gBrowser.addTrustedTab(KS.pageURL("keys.html", "tab=2"));
  await spike.sleep(1500);
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);

  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const SendMessageW = user32.declare("SendMessageW", ctypes.winapi_abi, ctypes.intptr_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const hwnd = ctypes.voidptr_t(ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
  const deactivate = async () => { SendMessageW(hwnd, 0x0006, ctypes.UInt64(0), ctypes.Int64(0)); SendMessageW(hwnd, 0x0008, ctypes.UInt64(0), ctypes.Int64(0)); await spike.sleep(400); };
  const state = () => "activeWindow=" + (Services.focus.activeWindow === window) + " focusedWindow=" + (Services.focus.focusedWindow ? (Services.focus.focusedWindow === window ? "chrome" : "other") : null);

  let ok = 0, bad = 0;
  const tryTabs = async (label) => {
    for (const [name, tab, other] of [["tab2", tab2, tab1], ["tab1", tab1, tab2]]) {
      gBrowser.selectedTab = tab;
      await spike.sleep(700);
      gBrowser.selectedBrowser.focus();
      await spike.sleep(300);
      const a0 = (await KS.pageSeen(tab.linkedBrowser)).length, b0 = (await KS.pageSeen(other.linkedBrowser)).length;
      actions.length = 0; lastTarget = null;
      KS.press("x"); KS.press("Ctrl+L"); KS.press("Ctrl+T");
      await spike.sleep(450);
      const sel = (await KS.pageSeen(tab.linkedBrowser)).slice(a0).join(" "), oth = (await KS.pageSeen(other.linkedBrowser)).slice(b0).join(" ");
      const good = sel.includes("d:x") && sel.includes("d:ctrl-l") && !oth && actions.slice().sort().join() === "focusAddress[page-first/reply],newTab[browser-first]" && lastTarget === tab.linkedBrowser;
      if (good) ok++; else bad++;
      spike.log((good ? "OK   " : "BAD  ") + label + ", switched to " + name + " (" + state() + ", focusedContentBC is selected tab's: " + (Services.focus.focusedContentBrowsingContext === tab.linkedBrowser.browsingContext) + "): selected page saw [" + sel + "], the other tab's page saw [" + oth + "], router " + JSON.stringify(actions) + ", last event.target is selected browser: " + (lastTarget === tab.linkedBrowser));
    }
  };

  spike.log("start: " + state());
  await tryTabs("1 window as launched");
  await deactivate();
  spike.log("after WM_ACTIVATE(WA_INACTIVE)+WM_KILLFOCUS: " + state());
  await tryTabs("2 window inactive");
  // remedy a: Services.focus.setFocus on the browser
  gBrowser.selectedTab = tab2; await spike.sleep(700);
  Services.focus.setFocus(gBrowser.selectedBrowser, 0); await spike.sleep(300);
  let b0 = (await KS.pageSeen(tab2.linkedBrowser)).length;
  KS.press("y"); await spike.sleep(300);
  spike.log("   remedy a (still inactive): Services.focus.setFocus(browser) -> tab2 page saw [" + (await KS.pageSeen(tab2.linkedBrowser)).slice(b0).join(" ") + "]");
  // remedy b: window.focus()
  window.focus();
  await spike.sleep(500);
  spike.log("after window.focus(): " + state());
  await tryTabs("3 after window.focus()");
  await deactivate();
  spike.log("deactivated again: " + state());
  // remedy c: focus the chrome field, then the browser (does a chrome->content focus move work while inactive?)
  const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
  input.style.cssText = "position:fixed;left:300px;top:120px;width:300px;height:30px;z-index:9999;";
  document.body.appendChild(input);
  gBrowser.selectedTab = tab2; await spike.sleep(700);
  input.focus(); await spike.sleep(200);
  KS.EU.sendString("ab", window); await spike.sleep(200);
  gBrowser.selectedBrowser.focus(); await spike.sleep(300);
  b0 = (await KS.pageSeen(tab2.linkedBrowser)).length;
  const c0 = (await KS.pageSeen(tab1.linkedBrowser)).length;
  KS.press("z"); await spike.sleep(300);
  spike.log("   inactive: chrome input got " + JSON.stringify(input.value) + "; then selectedBrowser.focus() + 'z' -> tab2 page saw [" + (await KS.pageSeen(tab2.linkedBrowser)).slice(b0).join(" ") + "], tab1 page saw [" + (await KS.pageSeen(tab1.linkedBrowser)).slice(c0).join(" ") + "], input value now " + JSON.stringify(input.value));
  input.remove();
  spike.log("RESULT testmode=" + testmode + " ok=" + ok + " bad=" + bad);
  user32.close();
});
