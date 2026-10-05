// VERIFY (claims 3-6): popups with the window made ACTIVE deterministically (the spike's run only
// works when its window happens to have OS focus: doorhangers, <select> and autocomplete popups do
// not open in an inactive window), plus robustness (tab switch, second window) and the Firefox
// panels the spike did not try (bookmark, site info, downloads, extensions list, find bar).
//   python spikes/shell/run_popups.py --boot spikes/shell/verify/boot-v-popups.js --name shell-verify-q-popups --timeout 200 --out spikes/shell/verify/out
/* global spike, vt, vv, Services, gBrowser, VitreUI, PanelUI, PopupNotifications, CustomizableUI, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const noRoute = Services.prefs.getBoolPref("vitre.spike.noroute", false);
    const shell = vt.register();
    shell.noRoute = noRoute;
    if (noRoute) shell.improved = false;
    shell.adopt(window);
    const d = document;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    const step = async (name, fn) => {
      try {
        await vv.activate();
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e), e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : "");
      }
    };
    const pill = (win = window) => vt.rect(win.VitreUI.anchor("site"));
    spike.log("activation", { before: Services.focus.activeWindow === window, osForeground: vv.foreground(), after: await vv.activate() });

    const tab1 = gBrowser.selectedTab;
    // 1. geolocation doorhanger
    await step("doorhanger", async () => {
      await vt.click(402, 128, { wait: 300 });
      const panel = PopupNotifications.panel;
      const ok = await vt.popupOpen(panel, 6000);
      await spike.sleep(500);
      spike.log("doorhanger", { opened: !!ok, pill: pill(), ...vt.popupInfo(panel) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "1-doorhanger");
    });
    // 2. the same doorhanger across a tab switch: the pill is elsewhere when we come back
    await step("doorhanger after tab switch", async () => {
      const panel = PopupNotifications.panel;
      const t2 = await vt.openTab("https://example.com/", { select: true });
      await spike.sleep(700);
      spike.log("on tab 2", { panel: panel.state, pill: pill() });
      gBrowser.selectedTab = tab1;
      await vv.activate();
      const ok = await vt.popupOpen(panel, 6000);
      await spike.sleep(900);
      spike.log("back on tab 1 (pill has moved: one circle to its right)", { opened: !!ok, pill: pill(), ...vt.popupInfo(panel) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "2-doorhanger-after-switch");
      const n = PopupNotifications.getNotification("geolocation", gBrowser.selectedBrowser);
      await vt.popupClosed(panel);
      if (n) PopupNotifications.remove(n);
      gBrowser.removeTab(t2, { animate: false });
      await spike.sleep(400);
    });
    // 3. a doorhanger with another Firefox anchor id (password-style), shown from chrome code
    await step("custom doorhanger", async () => {
      const panel = PopupNotifications.panel;
      const n = PopupNotifications.show(gBrowser.selectedBrowser, "vitre-verify", "Doorhanger shown with anchor id password-notification-icon", "password-notification-icon", { label: "OK", accessKey: "O", callback() {} }, [], {});
      const ok = await vt.popupOpen(panel, 6000);
      await spike.sleep(500);
      spike.log("custom doorhanger", { opened: !!ok, pill: pill(), ...vt.popupInfo(panel) });
      await vt.popupClosed(panel);
      PopupNotifications.remove(n);
    });
    // 4. <select> and datalist
    await step("select", async () => {
      await vt.click(82, 128, { wait: 300 });
      const menulist = d.getElementById("ContentSelectDropdown");
      const popup = menulist?.menupopup || menulist?.querySelector("menupopup");
      const ok = popup && (await vt.popupOpen(popup, 5000));
      await spike.sleep(300);
      spike.log("select dropdown", { opened: !!ok, ...vt.popupInfo(popup) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "3-select");
      if (popup) await vt.popupClosed(popup);
    });
    await step("autocomplete", async () => {
      await vt.click(233, 128, { wait: 300 });
      vt.EU().synthesizeKey("L", {}, window);
      const popup = d.getElementById("PopupAutoComplete");
      const ok = await vt.popupOpen(popup, 5000);
      await spike.sleep(300);
      spike.log("autocomplete", { opened: !!ok, ...vt.popupInfo(popup) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "4-autocomplete");
      await vt.popupClosed(popup);
    });
    // 5. extension popup
    await step("extension popup", async () => {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      await AddonManager.installTemporaryAddon(vt.fileIn("ext"));
      const widgetId = "shell-test_vitre_dev-browser-action";
      const node = await vt.until(() => CustomizableUI.getWidget(widgetId)?.forWindow(window)?.node, 8000);
      const button = node?.querySelector(".unified-extensions-item-action-button");
      await vv.activate();
      button.dispatchEvent(new CustomEvent("command", { bubbles: true, cancelable: true, detail: { openPopupWithoutUserInteraction: true } }));
      const panel = await vt.until(() => [...d.querySelectorAll("panel")].find((p) => p.state === "open" && p.querySelector("browser")), 8000);
      await spike.sleep(900);
      spike.log("extension popup", { opened: !!panel, pill: pill(), ...vt.popupInfo(panel) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "5-extension-popup");
      if (panel) await vt.popupClosed(panel);
    });
    // 6. Firefox panels the spike did not try
    const tryPanel = async (name, open, find, shot) => {
      await step(name, async () => {
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
        await spike.sleep(500);
        const p = panel || find();
        spike.log(name, { opened: !!panel, error: err, pill: pill(), plus: vt.rect(VitreUI.anchor("menu")), ...(p ? vt.popupInfo(p) : { found: false }) });
        if (panel && shot) await spike.capture(noRoute ? shot.replace("vpopups-", "vpopups-noroute-") : shot);
        if (p) await vt.popupClosed(p);
      });
    };
    await tryPanel("bookmark panel (Ctrl+D)", () => vt.EU().synthesizeKey("d", { accelKey: true }, window), () => d.getElementById("editBookmarkPanel"), "vpopups-6-bookmark");
    await tryPanel("site info / trust panel", () => window.gTrustPanelHandler.showPopup({}), () => d.getElementById("trustpanel-popup") || d.getElementById("identity-popup"), "vpopups-7-trustpanel");
    await tryPanel("downloads panel (Firefox's own)", () => window.DownloadsPanel.showPanel(true), () => d.getElementById("downloadsPanel"), "vpopups-8-downloads");
    await tryPanel("extensions list panel", () => window.gUnifiedExtensions.togglePanel(), () => d.getElementById("unified-extensions-panel"), "vpopups-9-extensions-list");
    await tryPanel("app menu", () => PanelUI.show(), () => PanelUI.panel, null);

    // 7. find bar
    await step("find bar", async () => {
      await window.gLazyFindCommand("onFindCommand");
      await spike.sleep(900);
      const fb = window.gFindBar;
      spike.log("find bar", { hidden: fb?.hidden, rect: vt.rect(fb), browser: vt.rect(gBrowser.selectedBrowser), focused: d.activeElement?.localName });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "10-findbar");
      fb?.close();
    });

    // 8. doorhanger in a second window
    await step("second window doorhanger", async () => {
      const win = OpenBrowserWindow();
      await vt.until(() => win.gBrowserInit?.delayedStartupFinished && win.VitreUI?.root, 10000);
      win.resizeTo(1300, 820);
      win.moveTo(30, 30);
      win.gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html") + "#geo", { triggeringPrincipal: sys });
      await vt.tabLoaded(win.gBrowser.selectedTab);
      await vv.activate(win);
      const panel = win.PopupNotifications.panel;
      const ok = await vt.popupOpen(panel, 6000);
      await spike.sleep(600);
      spike.log("second window doorhanger", { active: Services.focus.activeWindow === win, opened: !!ok, pill: pill(win), ...vt.popupInfo(panel, win) });
      await spike.capture((noRoute ? "vpopups-noroute-" : "vpopups-") + "11-second-window-doorhanger");
      win.close();
    });

    spike.log("router log", shell.routed);
  });
}
