// VERIFY (claim 4, improvement): the panels the spike's router misses, and the fix.
//   site info / trust panel  -> Firefox passes a NULL anchor  -> opens at the window's top-left corner
//   bookmark editor (Ctrl+D) -> BrowserPageActions.panelAnchorNodeForAction throws -> never opens
// Run twice: --pref vitre.verify.improved=false (the spike's rules) and default (verifier's rules,
// see chrome/VitreShell.sys.mjs "VERIFY improvement"). Also re-checks that page popups still work.
//   python spikes/shell/run_popups.py --boot spikes/shell/verify/boot-v-panels.js --name shell-verify-s-panels --timeout 150 --out spikes/shell/verify/out
/* global spike, vt, vv, Services, gBrowser, VitreUI, PopupNotifications */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const shell = vt.install();
    const tag = shell.improved ? "vpanels-improved" : "vpanels-spike";
    const d = document;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    spike.log("mode", shell.improved ? "VERIFIER RULES" : "SPIKE RULES", "| pill", vt.rect(VitreUI.anchor("site")));
    const errors = [];
    const listener = { observe(m) { try { const e = m.QueryInterface(Ci.nsIScriptError); if (/PageActions|anchor/i.test(e.errorMessage)) errors.push(e.errorMessage.slice(0, 120)); } catch (x) {} } };
    Services.console.registerListener(listener);
    const tryPanel = async (name, open, find, shot) => {
      try {
        await vv.activate();
        errors.length = 0;
        let err = null;
        try {
          await open();
        } catch (e) {
          err = String(e);
        }
        const panel = await vt.until(() => {
          const p = find();
          return p && p.state === "open" ? p : null;
        }, 4000);
        await spike.sleep(600);
        const p = panel || find();
        spike.log(name, { opened: !!panel, error: err, consoleErrors: errors.slice(0, 2), active: Services.focus.activeWindow === window, ...(p ? vt.popupInfo(p) : { found: false }) });
        if (shot) await spike.capture(`${tag}-${shot}`);
        if (p) await vt.popupClosed(p);
        await spike.sleep(300);
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e));
      }
    };
    await tryPanel("site info / trust panel", () => window.gTrustPanelHandler.showPopup({}), () => d.getElementById("trustpanel-popup"), "1-trustpanel");
    await tryPanel("bookmark editor (PlacesCommandHook.bookmarkPage, the Ctrl+D command)", () => window.PlacesCommandHook.bookmarkPage(), () => d.getElementById("editBookmarkPanel"), "2-bookmark");
    spike.log("bookmarked anyway?", { isBookmarked: !!(await PlacesUtils.bookmarks.fetch({ url: "https://example.com/" })) });

    // regression check for the null-anchor rule: popups that legitimately have no anchor
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.until(() => gBrowser.currentURI.spec.endsWith("hit.html"), 8000);
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    await vv.activate();
    await vt.click(82, 128, { wait: 300 });
    const menulist = d.getElementById("ContentSelectDropdown");
    const sel = menulist?.menupopup || menulist?.querySelector("menupopup");
    spike.log("select", { opened: !!(sel && (await vt.popupOpen(sel, 4000))), active: Services.focus.activeWindow === window, rect: sel ? vt.popupInfo(sel).rect : null });
    if (sel) await vt.popupClosed(sel);
    await vv.activate();
    await vt.click(233, 128, { wait: 300 });
    vt.EU().synthesizeKey("L", {}, window);
    const ac = d.getElementById("PopupAutoComplete");
    spike.log("autocomplete", { opened: !!(await vt.popupOpen(ac, 4000)), rect: vt.popupInfo(ac).rect });
    await vt.popupClosed(ac);
    const menu = d.getElementById("contentAreaContextMenu");
    vt.mouse("contextmenu", 700, 500, { button: 2 });
    spike.log("context menu", { opened: !!(await vt.popupOpen(menu, 4000)), rect: vt.popupInfo(menu).rect });
    await vt.popupClosed(menu);
    await vv.activate();
    await vt.click(402, 128, { wait: 300 });
    spike.log("doorhanger", { opened: !!(await vt.popupOpen(PopupNotifications.panel, 5000)), rect: vt.popupInfo(PopupNotifications.panel).rect });
    await vt.popupClosed(PopupNotifications.panel);
    Services.console.unregisterListener(listener);
    spike.log("router log", shell.routed.map((r) => `${r.popup} <- ${r.from} => ${r.to || r.error}`));
  });
}
