// 09: does parking every <key> break Firefox code that looks key elements up?
// Neutralise, then exercise the parts of Firefox that touch keys (full screen, menus, DevTools,
// new window, tab operations) while collecting every chrome JS error from the console service.
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  // second window: nothing
} else {
  Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
  Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
  spike.main(async () => {
    await spike.resize(1100, 720);
    const errors = [];
    const listener = {
      observe(msg) {
        try {
          const e = msg.QueryInterface(Ci.nsIScriptError);
          if (e.flags & Ci.nsIScriptError.warningFlag) return;
          errors.push(step + ": " + e.errorMessage + " @ " + (e.sourceName || "").split("/").slice(-2).join("/") + ":" + e.lineNumber);
        } catch (ex) {}
      },
    };
    let step = "baseline (before neutralise)";
    Services.console.registerListener(listener);
    await KS.load(KS.pageURL("keys.html"));
    await spike.sleep(500);
    const baseline = errors.length;

    step = "neutralise";
    const stock = Services.env.get("KS_MODE") === "stock"; // control run: same steps on untouched Firefox
    if (!stock) { VitreKeys.neutralise(); VitreKeys.install({}); }
    spike.log("mode: " + (stock ? "stock (control)" : "neutralised"));
    await spike.sleep(300);

    step = "full screen on/off";
    window.fullScreen = true; await spike.sleep(1500);
    window.fullScreen = false; await spike.sleep(1500);

    step = "app menu";
    try { await window.PanelUI.show(); await spike.sleep(700); window.PanelUI.hide(); } catch (e) { errors.push(step + ": threw " + e); }
    await spike.sleep(300);

    step = "context menu";
    const menu = document.getElementById("contentAreaContextMenu");
    KS.EU.synthesizeMouseAtCenter(gBrowser.selectedBrowser, { type: "contextmenu", button: 2 }, window);
    await spike.sleep(900);
    const ctxShown = menu.state === "open";
    if (ctxShown) menu.hidePopup();
    await spike.sleep(300);

    step = "tabs";
    const t = gBrowser.addTrustedTab("https://example.com/");
    gBrowser.selectedTab = t; await spike.sleep(1200);
    gBrowser.removeTab(t); await spike.sleep(500);
    window.SessionWindowUI.undoCloseTab(window); await spike.sleep(1000);
    gBrowser.removeCurrentTab({ animate: false }); await spike.sleep(400);

    step = "DevTools open/close";
    document.getElementById("key_toggleToolboxF12").doCommand();
    for (let i = 0; i < 40 && !document.querySelector("[class*='devtools-toolbox']"); i++) await spike.sleep(250);
    await spike.sleep(1500);
    document.getElementById("key_toggleToolboxF12").doCommand();
    await spike.sleep(1500);

    step = "new window";
    const w2 = window.OpenBrowserWindow();
    await new Promise((r) => w2.addEventListener("load", r, { once: true }));
    await spike.sleep(2000);
    const w2keys = [...w2.document.querySelectorAll("keyset")].map((k) => k.id + "(" + k.querySelectorAll("key").length + ")").join(" ");
    w2.close();
    await spike.sleep(700);

    step = "customize mode key lookups (ShortcutUtils.prettifyShortcut)";
    const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
    const pretty = ShortcutUtils.prettifyShortcut(document.getElementById("key_newNavigatorTab"));

    Services.console.unregisterListener(listener);
    spike.log("errors before neutralise: " + baseline + "; after: " + (errors.length - baseline));
    for (const e of errors) spike.log("   " + e.slice(0, 260));
    spike.log("context menu opened: " + ctxShown + "; second window keysets (the boot script does not neutralise it in this spike): " + w2keys + "; prettifyShortcut(key_newNavigatorTab)=" + pretty);
  });
}
