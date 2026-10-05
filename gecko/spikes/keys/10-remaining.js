// 10: bindings not pressed by the other scripts (numpad zoom, Shift+F5, Alt+Enter, Ctrl+2..8,
// Insert-key editing), and key routing when focus is in a second remote <browser> (a peek).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
// (the test opens a second window; the boot script must do nothing there)
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const actions = [];
  let lastTarget = null;
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => { actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + "]"); lastTarget = info.event.target; } });
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const one = async (label, fn) => { actions.length = 0; fn(); await spike.sleep(330); spike.log(label.padEnd(34) + (actions.join(",") || "-")); };
  const syn = (key, opts) => () => KS.EU.synthesizeKey(key, opts, window);

  spike.log("--- remaining global bindings (focus in a remote page that prevents nothing)");
  await one("Shift+F5", () => KS.press("Shift+F5"));
  await one("Alt+Enter", () => KS.press("Alt+Enter"));
  for (const n of [2, 3, 4, 5, 6, 7, 8]) await one("Ctrl+" + n, () => KS.press("Ctrl+" + n));
  await one("Ctrl+NumpadAdd", syn("+", { ctrlKey: true, code: "NumpadAdd", keyCode: KeyboardEvent.DOM_VK_ADD, location: 3 }));
  await one("Ctrl+NumpadSubtract", syn("-", { ctrlKey: true, code: "NumpadSubtract", keyCode: KeyboardEvent.DOM_VK_SUBTRACT, location: 3 }));
  await one("Ctrl+Numpad0", syn("0", { ctrlKey: true, code: "Numpad0", keyCode: KeyboardEvent.DOM_VK_NUMPAD0, location: 3 }));
  await one("Ctrl+Shift+= (types +)", syn("+", { ctrlKey: true, shiftKey: true, code: "Equal", keyCode: KeyboardEvent.DOM_VK_EQUALS }));
  await one("Ctrl+Shift+- (types _)", syn("_", { ctrlKey: true, shiftKey: true, code: "Minus", keyCode: KeyboardEvent.DOM_VK_HYPHEN_MINUS }));
  await one("Ctrl+Shift+1 (layout switch key)", () => KS.press("Ctrl+Shift+1"));
  await one("Shift+F6", () => KS.press("Shift+F6"));
  await one("Ctrl+Shift+Tab", () => KS.press("Ctrl+Shift+Tab"));
  await one("ContextMenu key", () => KS.press("ContextMenu"));
  await one("Shift+F10", () => KS.press("Shift+F10"));
  await one("F10", () => KS.press("F10"));

  spike.log("--- CUA editing keys in a page field");
  const fieldValue = () => KS.inPage(function (w, d) { return d.getElementById("field").value; });
  await KS.inPage(function (w, d) { const f = d.getElementById("field"); f.focus(); f.select(); return 1; });
  const clipHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
  const readClip = () => { try { const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable); t.init(null); t.addDataFlavor("text/plain"); Services.clipboard.getData(t, Services.clipboard.kGlobalClipboard); const o = {}; t.getTransferData("text/plain", o); return o.value.QueryInterface(Ci.nsISupportsString).data; } catch (e) { return null; } };
  const oldClip = readClip();
  KS.EU.sendString("ins-test", window); await spike.sleep(100);
  KS.press("Ctrl+A"); KS.press("Ctrl+Insert"); await spike.sleep(150);
  const copied = readClip();
  KS.press("End"); KS.press("Shift+Insert"); await spike.sleep(150);
  const afterPaste = await fieldValue();
  KS.press("Ctrl+A"); KS.press("Shift+Delete"); await spike.sleep(150);
  const afterCut = await fieldValue();
  KS.press("Ctrl+Shift+V"); await spike.sleep(150);
  const afterPlainPaste = await fieldValue();
  KS.press("Ctrl+Delete"); KS.press("Home"); KS.press("Ctrl+Delete"); await spike.sleep(150);
  const afterWordDelete = await fieldValue();
  if (oldClip !== null) clipHelper.copyString(oldClip);
  spike.log("Ctrl+Insert copied=" + JSON.stringify(copied) + " | Shift+Insert -> " + JSON.stringify(afterPaste) + " | Shift+Delete -> " + JSON.stringify(afterCut) + " | Ctrl+Shift+V -> " + JSON.stringify(afterPlainPaste) + " | Home, Ctrl+Delete -> " + JSON.stringify(afterWordDelete));

  spike.log("--- a second remote <browser> in the chrome document (what a peek would be)");
  try {
    const b = document.createXULElement("browser");
    b.id = "vitre-peek";
    for (const [k, v] of [["type", "content"], ["remote", "true"], ["maychangeremoteness", "true"], ["messagemanagergroup", "browsers"], ["initialBrowsingContextGroupId", ""]]) if (v !== "") b.setAttribute(k, v);
    b.style.cssText = "position:fixed;right:24px;top:150px;width:520px;height:330px;z-index:1000;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);background:#fff;";
    document.body.appendChild(b);
    await spike.sleep(300);
    b.loadURI(Services.io.newURI("https://example.org/"), { triggeringPrincipal: KS.sysPrincipal });
    for (let i = 0; i < 40 && b.currentURI.spec !== "https://example.org/"; i++) await spike.sleep(200);
    await spike.sleep(700);
    spike.log("peek browser: isRemoteBrowser=" + b.isRemoteBrowser + " remoteType=" + b.remoteType + " url=" + b.currentURI.spec);
    // A. while ANOTHER window of this Firefox is active, focus() on the peek only moves
    //    document.activeElement; the keys keep going to the page that had focus before.
    gBrowser.selectedBrowser.focus();
    const win2 = window.OpenBrowserWindow();
    await new Promise((r) => win2.addEventListener("load", r, { once: true }));
    await spike.sleep(1500);
    win2.focus();
    await spike.sleep(500);
    const seenA = (await KS.pageSeen()).length;
    b.focus();
    await spike.sleep(300);
    KS.EU.sendString("x", window);
    await spike.sleep(300);
    spike.log("  A. window 1 inactive (activeWindow is window 1: " + (Services.focus.activeWindow === window) + "): after peek.focus(), activeElement=" + document.activeElement.localName + "#" + document.activeElement.id + ", focusedContentBrowsingContext is the peek's: " + (Services.focus.focusedContentBrowsingContext === b.browsingContext) + ", the tab's page saw of the typed 'x': " + JSON.stringify((await KS.pageSeen()).slice(seenA)) + " (where keys land is not dependable in this state)");
    win2.close();
    await spike.sleep(500);
    // B. with the window active, focus really moves.
    window.focus();
    await spike.sleep(300);
    gBrowser.selectedBrowser.focus();
    await spike.sleep(200);
    b.focus();
    await spike.sleep(300);
    spike.log("  B. window active when focusing the peek: " + (Services.focus.activeWindow === window) + " (testmode=" + Services.prefs.getBoolPref("focusmanager.testmode", false) + "); focusedContentBrowsingContext is the peek's: " + (Services.focus.focusedContentBrowsingContext === b.browsingContext) + ", is the tab's: " + (Services.focus.focusedContentBrowsingContext === gBrowser.selectedBrowser.browsingContext));
    const tabSeen = (await KS.pageSeen()).length;
    for (const k of ["Ctrl+R", "Ctrl+L", "Escape", "Ctrl+W", "Alt+Enter", "F12"]) {
      actions.length = 0; lastTarget = null;
      KS.press(k);
      await spike.sleep(350);
      spike.log("  focus in peek: " + k.padEnd(10) + (actions.join(",") || "-") + "  event.target=" + (lastTarget ? lastTarget.localName + "#" + lastTarget.id : "?") + " (is the peek: " + (lastTarget === b) + ")");
    }
    spike.log("  the tab's page under the peek saw " + ((await KS.pageSeen()).length - tabSeen) + " new key events; document.activeElement=" + document.activeElement.localName + "#" + document.activeElement.id);
    await spike.capture("10-peek-browser");
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    actions.length = 0; lastTarget = null;
    KS.press("Ctrl+R");
    await spike.sleep(350);
    spike.log("  focus back in the tab: Ctrl+R -> " + actions.join(",") + " target is the tab's browser: " + (lastTarget === gBrowser.selectedBrowser));
    b.remove();
  } catch (e) {
    spike.log("peek browser test failed: " + e + "\n" + (e.stack || ""));
  }
});
