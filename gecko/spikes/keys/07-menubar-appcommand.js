// 07: the non-<key> built-ins: Alt / F10 menu bar, hardware browser keys (AppCommand),
// and calling Firefox's own commands once their <key> elements are parked.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1100, 720);
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const ev = [];
  window.addEventListener("DOMMenuBarActive", () => ev.push("menubar ACTIVE"), true);
  window.addEventListener("DOMMenuBarInactive", () => ev.push("menubar inactive"), true);
  window.addEventListener("popupshown", (e) => ev.push("popup:" + e.target.id), true);
  const menubarState = () => {
    const tb = document.getElementById("toolbar-menubar");
    return "toolbar-menubar inactive=" + tb.hasAttribute("inactive") + " autohide=" + tb.getAttribute("autohide");
  };
  const reset = async () => {
    for (const p of document.querySelectorAll("menupopup")) if (p.state === "open") p.hidePopup();
    KS.press("Escape"); await spike.sleep(120); KS.press("Escape"); await spike.sleep(120);
    gBrowser.selectedBrowser.focus();
    await spike.sleep(150);
    ev.length = 0;
  };
  const probe = async (label) => {
    for (const k of ["F10", "Alt", "Alt+F", "Shift+F10"]) {
      await reset();
      KS.press(k);
      await spike.sleep(450);
      spike.log("  [" + label + "] " + k.padEnd(10) + (ev.join(", ") || "nothing") + " | " + menubarState() + " | focus " + (document.activeElement && document.activeElement.localName));
    }
    await reset();
  };

  spike.log("--- 1. menu bar");
  await probe("stock");
  for (const [k, v] of Object.entries(VitreKeys.PREFS)) {
    if (!k.startsWith("ui.key.menu")) continue;
    if (typeof v === "boolean") Services.prefs.setBoolPref(k, v); else Services.prefs.setIntPref(k, v);
  }
  spike.log("  prefs set at runtime: ui.key.menuAccessKeyFocuses=false ui.key.menuAccessKey=0");
  await probe("prefs");
  VitreKeys.neutralise();
  const acts = [];
  VitreKeys.install({ onAction: (a, arg, info) => acts.push(a + "[" + info.how + "]") });
  await probe("prefs+router");

  spike.log("--- 2. hardware browser keys: AppCommand event");
  await KS.load(KS.pageURL("keys.html", "second=1"));
  await spike.sleep(300);
  const appCommand = (cmd) => {
    let e;
    try { e = new CommandEvent("AppCommand", { bubbles: true, cancelable: true, command: cmd }); } catch (ex) {
      e = new Event("AppCommand", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "command", { value: cmd });
    }
    return { e, notCancelled: gBrowser.selectedBrowser.dispatchEvent(e) };
  };
  spike.log("  canGoBack=" + gBrowser.canGoBack + " at " + gBrowser.currentURI.spec.slice(-30) + "; typeof window.HandleAppCommandEvent=" + typeof window.HandleAppCommandEvent);
  let r = appCommand("Back");
  await spike.sleep(900);
  spike.log("  stock: synthetic AppCommand 'Back' (isTrusted=" + r.e.isTrusted + ") -> now at " + gBrowser.currentURI.spec.slice(-30) + " (Firefox's own handler went back: " + !gBrowser.currentURI.spec.includes("second=1") + ")");
  // Vitre takes AppCommand over: remove Firefox's listener, add its own.
  window.removeEventListener("AppCommand", window.HandleAppCommandEvent, true);
  const vitreApp = [];
  window.addEventListener("AppCommand", (e) => { vitreApp.push(e.command); e.stopPropagation(); e.preventDefault(); }, true);
  await KS.load(KS.pageURL("keys.html", "third=1"));
  await spike.sleep(300);
  for (const c of ["Back", "Forward", "Reload", "Stop", "Search", "Home", "Bookmarks"]) appCommand(c);
  await spike.sleep(900);
  spike.log("  after removeEventListener('AppCommand', HandleAppCommandEvent, true) + Vitre's listener: Vitre got " + JSON.stringify(vitreApp) + "; still at " + gBrowser.currentURI.spec.slice(-30) + ", tabs " + gBrowser.tabs.length);
  // The same hardware keys also arrive as key events (key = BrowserBack ...): what does the router do?
  acts.length = 0;
  for (const k of ["BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserStop", "BrowserSearch", "BrowserHome"]) { KS.press(k); await spike.sleep(200); }
  spike.log("  synthesized key events BrowserBack..BrowserHome -> router actions " + JSON.stringify(acts) + "; page saw " + JSON.stringify((await KS.pageSeen()).filter((s) => s.includes("browser"))));

  spike.log("--- 3. Firefox commands stay callable after their <key> elements are parked");
  const cmds = {};
  for (const id of ["key_toggleToolboxF12", "key_toggleToolbox", "key_inspector", "key_webconsole", "key_browserConsole", "key_viewSource", "printKb", "key_savePage", "key_enterFullScreen", "key_sanitize", "key_find", "key_openDownloads"]) {
    const k = document.getElementById(id);
    cmds[id] = k ? "parent=" + k.parentNode.id + (k.getAttribute("command") ? " command=" + k.getAttribute("command") : " (own listener)") : "MISSING";
  }
  spike.log("  parked keys:", cmds);
  const tabs0 = gBrowser.tabs.length;
  document.getElementById("View:PageSource").doCommand();
  await spike.sleep(1500);
  spike.log("  View:PageSource.doCommand() -> tabs " + tabs0 + " -> " + gBrowser.tabs.length + ", selected " + gBrowser.currentURI.spec.slice(0, 40));
  gBrowser.removeCurrentTab({ animate: false });
  await spike.sleep(400);
  gBrowser.selectedBrowser.focus();
  document.getElementById("key_toggleToolboxF12").doCommand();
  let dt = false;
  for (let i = 0; i < 40 && !dt; i++) { await spike.sleep(250); dt = !!document.querySelector("[class*='devtools-toolbox']"); }
  spike.log("  key_toggleToolboxF12.doCommand() -> devtools toolbox iframe present: " + dt);
  await spike.sleep(1500);
  await spike.capture("07-devtools");
  // With devtools open and focused, do Vitre's keys still route? (focus is in the toolbox document)
  acts.length = 0;
  KS.press("Ctrl+T"); await spike.sleep(300);
  KS.press("Ctrl+L"); await spike.sleep(300);
  spike.log("  with DevTools open: activeElement=" + (document.activeElement && document.activeElement.localName + "." + document.activeElement.className) + ", Ctrl+T / Ctrl+L -> " + JSON.stringify(acts) + "; keysets now: " + [...document.querySelectorAll("keyset")].map((k) => k.id + "(" + k.querySelectorAll("key").length + ")").join(" "));

  spike.log("--- 4. misc facts");
  spike.log("  document.fullscreenKeyboardLock=" + JSON.stringify(document.fullscreenKeyboardLock) + " ('fullscreenKeyboardLock' in document: " + ("fullscreenKeyboardLock" in document) + ")");
  const probeEv = new KeyboardEvent("keydown", {});
  spike.log("  chrome-only KeyboardEvent members: " + ["requestReplyFromRemoteContent", "isWaitingReplyFromRemoteContent", "isReplyEventFromRemoteContent", "defaultPreventedByChrome", "defaultPreventedByContent", "isReservedByChrome", "defaultCancelled", "initDict"].map((n) => n + "=" + (n in probeEv)).join(" "));
});
