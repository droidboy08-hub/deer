// Spike 1 (popups): with Firefox's toolbars hidden, do panels, doorhangers, page dropdowns,
// autocomplete, context menus, extension popups, notification bars and tab-modal prompts still
// work, and where do they appear?
//   python spikes/shell/run_popups.py --boot spikes/shell/boot-popups.js --name shell-popups
//   ... --pref vitre.spike.noroute=true   (baseline: Firefox's own anchors, no router)
/* global spike, vt, Services, gBrowser, VitreUI, PanelUI, PopupNotifications, CustomizableUI, AddonManager */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const noRoute = Services.prefs.getBoolPref("vitre.spike.noroute", false);
    const tag = noRoute ? "popups-noroute" : "popups";
    await spike.resize(1280, 800);
    const shell = vt.register();
    shell.noRoute = noRoute;
    shell.adopt(window);
    const d = document;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    spike.log("mode", noRoute ? "BASELINE (no anchor routing)" : "ROUTED", "| pill favicon rect", vt.rect(VitreUI.anchor("site")), "| plus rect", vt.rect(VitreUI.anchor("menu")));

    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e), e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : "");
      }
    };

    // 1. App menu (PanelUI), normally anchored to the hamburger button in #nav-bar.
    await step("appmenu", async () => {
      PanelUI.show();
      const ok = await vt.popupOpen(PanelUI.panel);
      await spike.sleep(500);
      spike.log("appmenu", { opened: !!ok, ...vt.popupInfo(PanelUI.panel) });
      await spike.capture(`${tag}-1-appmenu`);
      await vt.popupClosed(PanelUI.panel);
    });

    // 2. Permission doorhanger (geolocation), normally anchored to an icon inside the urlbar.
    await step("doorhanger", async () => {
      await vt.click(402, 128, { wait: 300 }); // "Ask for location" button of hit.html
      const panel = PopupNotifications.panel;
      const ok = await vt.popupOpen(panel, 6000);
      await spike.sleep(500);
      const n = PopupNotifications.getNotification("geolocation", gBrowser.selectedBrowser);
      spike.log("doorhanger", { opened: !!ok, notification: n ? n.id : null, notificationAnchor: n?.anchorElement?.id, ...vt.popupInfo(panel) });
      await spike.capture(`${tag}-2-doorhanger`);
      await vt.popupClosed(panel);
      if (n) PopupNotifications.remove(n);
    });

    // 3. <select> dropdown of the page.
    await step("select", async () => {
      await vt.click(82, 128, { wait: 300 });
      const menulist = d.getElementById("ContentSelectDropdown");
      const popup = menulist?.menupopup || menulist?.querySelector("menupopup");
      const ok = popup && (await vt.popupOpen(popup, 5000));
      await spike.sleep(300);
      spike.log("select dropdown", { found: !!popup, opened: !!ok, items: popup?.children.length, ...vt.popupInfo(popup) });
      await spike.capture(`${tag}-3-select`);
      if (popup) await vt.popupClosed(popup);
    });

    // 4. Autocomplete (datalist) popup of the page.
    await step("autocomplete", async () => {
      await vt.click(233, 128, { wait: 300 });
      vt.EU().synthesizeKey("L", {}, window);
      const popup = d.getElementById("PopupAutoComplete");
      const ok = await vt.popupOpen(popup, 5000);
      await spike.sleep(300);
      spike.log("autocomplete", { opened: !!ok, ...vt.popupInfo(popup) });
      await spike.capture(`${tag}-4-autocomplete`);
      await vt.popupClosed(popup);
    });

    // 5. Page context menu.
    await step("context menu", async () => {
      const menu = d.getElementById("contentAreaContextMenu");
      vt.mouse("contextmenu", 700, 500, { button: 2 });
      const ok = await vt.popupOpen(menu, 5000);
      await spike.sleep(300);
      spike.log("context menu", { opened: !!ok, items: menu.children.length, ...vt.popupInfo(menu) });
      await spike.capture(`${tag}-5-contextmenu`);
      await vt.popupClosed(menu);
    });

    // 6. Extension toolbar-button popup (a local test extension, loaded temporarily).
    await step("extension popup", async () => {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const addon = await AddonManager.installTemporaryAddon(vt.fileIn("ext"));
      const widgetId = "shell-test_vitre_dev-browser-action";
      const node = await vt.until(() => CustomizableUI.getWidget(widgetId)?.forWindow(window)?.node, 8000);
      const placement = CustomizableUI.getPlacementOfWidget(widgetId);
      const button = node?.querySelector(".unified-extensions-item-action-button");
      spike.log("extension", { id: addon.id, widget: !!node, area: placement?.area, buttonRect: vt.rect(button) });
      button.dispatchEvent(new CustomEvent("command", { bubbles: true, cancelable: true, detail: { openPopupWithoutUserInteraction: true } }));
      const panel = await vt.until(() => [...d.querySelectorAll("panel")].find((p) => p.state === "open" && p.querySelector("browser")), 8000);
      await spike.sleep(900);
      const b = panel?.querySelector("browser");
      spike.log("extension popup", { opened: !!panel, browserURI: b?.currentURI?.spec?.replace(/moz-extension:\/\/[^/]+/, "moz-extension://…"), ...vt.popupInfo(panel) });
      await spike.capture(`${tag}-6-extension-popup`);
      if (panel) await vt.popupClosed(panel);
    });

    // 7. Notification bars: per-tab and global. They live in #navigator-toolbox > #notifications-toolbar.
    await step("notification bar", async () => {
      const box = gBrowser.getNotificationBox();
      const n = await box.appendNotification("vitre-spike-tab", { label: "Per-tab notification bar (gBrowser.getNotificationBox)", priority: box.PRIORITY_INFO_HIGH }, [{ label: "Button", callback: () => {} }]);
      await spike.sleep(700);
      spike.log("notification bar", { rect: vt.rect(n), toolbar: vt.rect(d.getElementById("notifications-toolbar")), toolbox: vt.rect(d.getElementById("navigator-toolbox")), browserTop: vt.rect(gBrowser.selectedBrowser) });
      await spike.capture(`${tag}-7-notification-bar`);
      const [cx, cy] = vt.center(n);
      spike.log("notification bar hit", { elementAtCentre: d.elementFromPoint(cx, cy)?.localName, nchittest: vt.hit(cx, cy) });
      box.removeNotification(n);
    });

    // 8. Tab-modal prompt (alert() from the page) under the floating bar.
    await step("alert", async () => {
      const tab = gBrowser.addTrustedTab(vt.pageURL("alert.html"));
      gBrowser.selectedTab = tab;
      const dialog = await vt.until(() => gBrowser.getTabDialogBox(tab.linkedBrowser)?.getContentDialogManager()?.dialogs?.[0] || gBrowser.getTabDialogBox(tab.linkedBrowser)?.getTabDialogManager()?.dialogs?.[0], 8000);
      await spike.sleep(700);
      const box = d.querySelector(".dialogStack:not([hidden]) .dialogBox") || d.querySelector(".dialogBox");
      spike.log("alert", { shown: !!dialog, dialogBox: vt.rect(box), barBottom: 12 + 44 });
      await spike.capture(`${tag}-8-alert`);
      try {
        dialog?.close();
      } catch (e) {}
      gBrowser.removeTab(tab, { skipPermitUnload: true });
    });

    spike.log("router log", shell.routed);
  });
}
