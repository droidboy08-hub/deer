// 04: how to synthesize keys for automated tests in this harness, and what does not work.
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  // second window opened by the test below: nothing to do
} else {
  Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
  Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
  spike.main(async () => {
    await spike.resize(1000, 700);
    spike.log("focusmanager.testmode =", Services.prefs.getBoolPref("focusmanager.testmode", false));
    await KS.load(KS.pageURL("keys.html"));
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    const seen = async () => (await KS.pageSeen()).join(" ");
    const clear = () => KS.inPage(function (w, d) { w.wrappedJSObject.seen.length = 0; w.wrappedJSObject.publish(); return 1; });
    const active = () => "activeWindow=" + (Services.focus.activeWindow === window) + " osForeground=" + (Services.focus.activeWindow === window && document.hasFocus());

    VitreKeys.neutralise(); // so Firefox's own Ctrl+K / F5 do not move focus or reload during the test
    // 1. EventUtils (shipped in omni.ja) -> nsITextInputProcessor
    await clear();
    KS.press("a"); KS.press("Ctrl+K");
    spike.log("1. EventUtils.synthesizeKey, " + active() + " -> page saw: " + (await seen()));

    // 2. raw nsITextInputProcessor, no helper library
    await clear();
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    const began = tip.beginInputTransactionForTests(window);
    const ctrl = new KeyboardEvent("", { key: "Control", code: "ControlLeft", keyCode: KeyboardEvent.DOM_VK_CONTROL });
    const kk = new KeyboardEvent("", { key: "k", code: "KeyK", keyCode: KeyboardEvent.DOM_VK_K });
    const f5 = new KeyboardEvent("", { key: "F5", code: "F5", keyCode: KeyboardEvent.DOM_VK_F5 });
    const r1 = tip.keydown(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    const r2 = tip.keydown(kk);
    tip.keyup(kk);
    tip.keyup(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    const r3 = tip.keydown(f5, tip.KEY_NON_PRINTABLE_KEY);
    tip.keyup(f5, tip.KEY_NON_PRINTABLE_KEY);
    spike.log("2. raw TIP: beginInputTransactionForTests=" + began + " keydown results (consumed flags) ctrl=" + r1 + " k=" + r2 + " f5=" + r3 + " -> page saw: " + (await seen()));

    // 3. keydown() tells the test whether chrome consumed the key (browser-first)
    const acts = [];
    VitreKeys.install({ onAction: (a, arg, info) => acts.push(a + "[" + info.how + "]") });
    const tt = new KeyboardEvent("", { key: "t", code: "KeyT", keyCode: KeyboardEvent.DOM_VK_T });
    tip.keydown(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    const consumedT = tip.keydown(tt);
    tip.keyup(tt);
    const consumedK = tip.keydown(kk);
    tip.keyup(kk);
    tip.keyup(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    await spike.sleep(200);
    spike.log("3. with the router: tip.keydown(Ctrl+T) returns " + consumedT + " (KEYDOWN_IS_CONSUMED=" + tip.KEYDOWN_IS_CONSUMED + "), Ctrl+K returns " + consumedK + "; actions " + JSON.stringify(acts));

    // 4. untrusted DOM events are useless for this
    await clear();
    acts.length = 0;
    const fake = new KeyboardEvent("keydown", { key: "t", code: "KeyT", keyCode: 84, ctrlKey: true, bubbles: true, cancelable: true });
    gBrowser.selectedBrowser.dispatchEvent(fake);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true }));
    await spike.sleep(200);
    spike.log("4. dispatchEvent(new KeyboardEvent): isTrusted=" + fake.isTrusted + ", router actions " + JSON.stringify(acts) + ", page saw: '" + (await seen()) + "'");

    // 5. a second browser window takes activation; keys synthesized on window 1 still reach its page
    await clear();
    const win2 = window.OpenBrowserWindow();
    await new Promise((r) => win2.addEventListener("load", r, { once: true }));
    await spike.sleep(1500);
    win2.focus();
    await spike.sleep(500);
    spike.log("5. after opening window 2: " + active() + " window2Active=" + (Services.focus.activeWindow === win2));
    acts.length = 0;
    KS.press("b"); KS.press("Ctrl+L"); KS.press("Ctrl+T");
    await spike.sleep(300);
    spike.log("   keys synthesized on window 1 while window 2 of the same Firefox is active -> page saw: '" + (await seen()) + "' | router actions " + JSON.stringify(acts) + " | window 1 focus " + JSON.stringify(KS.focusInfo()));
    // and a held Ctrl is cancelled when the window is deactivated
    window.focus();
    await spike.sleep(500);
    const ups = [];
    await clear();
    acts.length = 0;
    KS.press("c"); KS.press("Ctrl+L");
    await spike.sleep(300);
    spike.log("   after window.focus() on window 1 (" + active() + ") -> page saw: '" + (await seen()) + "' | router actions " + JSON.stringify(acts));
    VitreKeys.install({ onAction: (a) => acts.push(a), onCtrlUp: (e) => ups.push(e ? "keyup" : "cancel(deactivate)") });
    KS.down("Control");
    KS.press("Tab");
    await spike.sleep(100);
    spike.log("   window 1 active again: " + active() + "; Ctrl held, ctrlHeld=" + VitreKeys.state.ctrlHeld);
    win2.focus();
    await spike.sleep(600);
    spike.log("   window 2 focused while Ctrl held -> onCtrlUp calls: " + JSON.stringify(ups) + " (" + active() + ")");
    KS.up("Control");
    win2.close();
    await spike.sleep(400);
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);

    // 6. where do synthesized keys go? Wherever Gecko's focus is inside this window.
    await clear();
    const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    input.style.cssText = "position:fixed;left:250px;top:100px;width:400px;height:30px;z-index:9999;";
    document.body.appendChild(input);
    input.focus();
    KS.EU.sendString("typed in chrome", window);
    await spike.sleep(150);
    const v = input.value;
    gBrowser.selectedBrowser.focus();
    await spike.sleep(200);
    KS.EU.sendString("xy", window);
    spike.log("6. focus in chrome input -> input.value=" + JSON.stringify(v) + "; after browser.focus() -> page saw: " + (await seen()));
    input.remove();
    await spike.capture("04");
  });
}
