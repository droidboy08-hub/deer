// SPIKE 3: the add-on install flow with Firefox's toolbox hidden. Every install doorhanger is
// anchored to #unified-extensions-button, which xt.installExtensionBar() moved into Vitre's bar.
//
// Part 1 drives the real web-install path (navigation to an application/x-xpinstall URL, the same
//   code a third-party site or AMO reaches) with a local unsigned XPI. On release Firefox the
//   install must fail at signature verification, which is itself evidence for the signing rule.
// Part 2 shows the permission prompt and the "added" confirmation. With VITRE_UNSIGNED=1 (see
//   run-install-real) signatures are off and the real flow reaches them; otherwise they are
//   raised through the same observer topics XPIInstall/AddonManager use.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { extBtn } = xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const tag = AddonSettings.REQUIRE_SIGNING ? "link-release" : "link-unsigned-ok";
  spike.log("AddonSettings.REQUIRE_SIGNING=" + AddonSettings.REQUIRE_SIGNING, "pref xpinstall.signatures.required=" + Services.prefs.getBoolPref("xpinstall.signatures.required", true), "Cu.isInAutomation=" + Cu.isInAutomation);

  const doorhanger = () => {
    const n = PopupNotifications.panel.firstElementChild;
    return PopupNotifications.panel.state === "open" && n ? n : null;
  };
  const describe = (n) => ({ id: n.getAttribute("popupid"), label: n.getAttribute("label"), name: n.getAttribute("name"), primary: n.button?.label, secondary: n.secondaryButton?.label,
    anchor: PopupNotifications.panel.anchorNode?.id || PopupNotifications.panel.anchorNode?.className, anchorIn: PopupNotifications.panel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere",
    rect: (({ x, y, width, height }) => ({ x, y, width, height }))(PopupNotifications.panel.getBoundingClientRect()) });
  const waitDoorhanger = (id, ms = 15000) => xt.waitActive(() => { const n = doorhanger(); return n && (!id || n.getAttribute("popupid") === id) ? n : null; }, ms);
  // Doorhanger buttons ignore clicks for security.notification_enable_delay (500 ms) after the panel
  // is shown or the window is re-activated; other spikes steal focus, so retry until it takes.
  const press = async (button) => {
    const note = button.closest("popupnotification");
    for (let i = 0; i < 12; i++) {
      await xt.sleep(700);
      xt.keepActive();
      button.click();
      await xt.sleep(300);
      if (!note.isConnected || note.hidden || PopupNotifications.panel.firstElementChild !== note || PopupNotifications.panel.state !== "open") return true;
    }
    return false;
  };

  await xt.nav(xt.page());

  // ---- Part 1: real path. A navigation to an .xpi is handled by amContentHandler ->
  // AddonManager.installAddonFromWebpage -> "addon-install-blocked" (the site is not allow-listed).
  const installs = [];
  AddonManager.addInstallListener({
    onNewInstall: (i) => { installs.push(i); spike.log("install listener: onNewInstall", i.sourceURI?.spec); },
    onDownloadEnded: (i) => spike.log("install listener: onDownloadEnded", i.addon?.id, "signedState=" + i.addon?.signedState),
    onDownloadFailed: (i) => spike.log("install listener: onDownloadFailed error=" + i.error, AddonManager.errorToString?.(i.error)),
    onInstallFailed: (i) => spike.log("install listener: onInstallFailed error=" + i.error),
    onInstallEnded: (i, a) => spike.log("install listener: onInstallEnded", a.id, "temporary=" + a.temporarilyInstalled, "signedState=" + a.signedState),
    onInstallCancelled: () => spike.log("install listener: onInstallCancelled"),
  });
  gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("127.0.0.1", "/vitre-install.xpi"), { triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://127.0.0.1:47631") , hasValidUserGestureActivation: true });
  let n = await waitDoorhanger();
  spike.log("doorhanger 1", n ? JSON.stringify(describe(n)) : "none shown");
  await spike.capture(tag + "-1-first-doorhanger");

  if (n && n.getAttribute("popupid") === "addon-install-blocked") {
    await press(n.button); // "Continue to Installation"
    n = await xt.waitActive(() => { const d = doorhanger(); return d && d.getAttribute("popupid") !== "addon-install-blocked" ? d : null; }, 15000);
    spike.log("doorhanger 2", n ? JSON.stringify(describe(n)) : "none shown");
    await xt.sleep(500);
    await spike.capture(tag + "-2-after-continue");
  }

  let realInstalled = false;
  if (n && n.getAttribute("popupid") === "addon-webext-permissions") {
    // Signatures are off (automation run): this is the genuine permission prompt.
    spike.log("permission list", JSON.stringify([...n.querySelectorAll("li, .webext-perm-granted, .popup-notification-description")].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 12)));
    await press(n.button); // "Add"
    const added = await xt.waitActive(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden), 15000);
    await xt.sleep(700);
    spike.log("post-install notification", added ? JSON.stringify({ id: added.id, name: added.getAttribute("name"), anchorIn: PanelUI.notificationPanel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere",
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(PanelUI.notificationPanel.getBoundingClientRect()) }) : "none shown (window active: " + (Services.focus.activeWindow === window) + ")");
    await spike.capture(tag + "-3-added-doorhanger");
    realInstalled = !!(await AddonManager.getAddonByID("vitre-inst@spike.test"));
    spike.log("real install completed:", realInstalled, "widget placement", JSON.stringify(CustomizableUI.getPlacementOfWidget("vitre-inst_spike_test-browser-action")));
    added?.button?.click();
    await xt.closePopups();
    await spike.capture(tag + "-4-installed-in-pill");
  } else {
    PopupNotifications.panel.hidePopup();
    for (const id of gXPInstallObserver.NOTIFICATION_IDS) PopupNotifications.getNotification(id, gBrowser.selectedBrowser)?.remove();
    await xt.closePopups();
  }

  // The same check without any UI: an unsigned file install.
  const install = await AddonManager.getInstallForFile(xt.file("www", "vitre-install.xpi"), "application/x-xpinstall");
  spike.log("getInstallForFile(unsigned xpi): state=" + AddonManager.stateToString?.(install.state) + " error=" + install.error + " " + (AddonManager.errorToString?.(install.error) || ""),
    "(ERROR_SIGNEDSTATE_REQUIRED=" + AddonManager.ERROR_SIGNEDSTATE_REQUIRED + ", ERROR_CORRUPT_FILE=" + AddonManager.ERROR_CORRUPT_FILE + ")");

  if (!realInstalled) {
    // ---- Part 2 (release build, signatures enforced): raise the two remaining doorhangers through
    // the observer topics the installer uses, with a real add-on object from a temporary install.
    const addon = await xt.installTemp("inst");
    spike.log("temporary install for the prompt data:", addon.id, "installPermissions", JSON.stringify(addon.installPermissions));
    await xt.sleep(500);
    const answer = new Promise((resolve) => {
      const info = { addon, icon: addon.iconURL, permissions: addon.installPermissions, install, source: "spike", resolve: () => resolve("accepted"), reject: () => resolve("rejected") };
      xt.keepActive();
      Services.obs.notifyObservers({ wrappedJSObject: { target: gBrowser.selectedBrowser, info } }, "webextension-permission-prompt");
    });
    n = await waitDoorhanger("addon-webext-permissions");
    spike.log("permission prompt", n ? JSON.stringify(describe(n)) : "none shown");
    await xt.sleep(600);
    await spike.capture(tag + "-3-permission-prompt-via-observer");
    if (n) await press(n.button);
    spike.log("permission prompt answer:", await Promise.race([answer, xt.sleep(5000).then(() => "no answer")]));

    xt.keepActive();
    Services.obs.notifyObservers({ wrappedJSObject: { target: gBrowser.selectedBrowser, addon } }, "webextension-install-notify");
    let added = await xt.waitActive(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden), 6000);
    if (!added) {
      // AppMenuNotifications only opens its doorhanger in the active window; other spikes may hold focus.
      spike.log("post-install doorhanger not opened by itself; window active=" + (Services.focus.activeWindow === window), "badge-status=" + PanelUI.menuButton.getAttribute("badge-status"));
      const { AppMenuNotifications } = ChromeUtils.importESModule("resource://gre/modules/AppMenuNotifications.sys.mjs");
      const pending = AppMenuNotifications.notifications.find((x) => x.id === "addon-installed");
      if (pending) { pending.dismissed = false; PanelUI._showNotificationPanel(pending); }
      added = await xt.waitActive(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden), 6000);
    }
    await xt.sleep(700);
    spike.log("post-install notification", added ? JSON.stringify({ id: added.id, name: added.getAttribute("name"), anchorIn: PanelUI.notificationPanel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere",
      pinCheckboxHidden: added.querySelector("#addon-pin-toolbarbutton-checkbox")?.hidden,
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(PanelUI.notificationPanel.getBoundingClientRect()) }) : "none shown");
    await spike.capture(tag + "-4-added-doorhanger-via-observer");
    await xt.closePopups();
  }
  spike.log("installed add-ons", JSON.stringify((await AddonManager.getAddonsByTypes(["extension"])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => a.id + (a.temporarilyInstalled ? " (temporary)" : ""))));
});
