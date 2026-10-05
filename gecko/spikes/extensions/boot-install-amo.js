// SPIKE 3b: the AMO entry point. addons.mozilla.org installs through navigator.mozAddonManager
// (amWebAPI.sys.mjs -> amManager.sys.mjs -> AddonManager.webAPI.createInstall -> installAddonFromAOM).
// That API only exists on addons.mozilla.org; for testing Firefox also exposes it on example.com when
// extensions.webapi.testing is set. This run maps example.com to the local test server
// (network.dns.localDomains) and lets a mock store page install the local test XPI, so the same
// code path AMO uses is exercised without downloading a real extension.
//
// Release build: the unsigned XPI is refused (failure doorhanger).
// Automation run (run-install-real.py: signatures off): permission prompt -> Add -> "was added".
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const tag = AddonSettings.REQUIRE_SIGNING ? "amo-release" : "amo-unsigned-ok";
  spike.log("AddonSettings.REQUIRE_SIGNING=" + AddonSettings.REQUIRE_SIGNING, "Cu.isInAutomation=" + Cu.isInAutomation,
    "extensions.webapi.testing=" + Services.prefs.getBoolPref("extensions.webapi.testing", false), "localDomains=" + Services.prefs.getCharPref("network.dns.localDomains", ""));

  const rect = (p) => (({ x, y, width, height }) => ({ x, y, width, height }))(p.getBoundingClientRect());
  const doorhanger = () => { const n = PopupNotifications.panel.firstElementChild; return PopupNotifications.panel.state === "open" && n ? n : null; };
  const describe = (n) => ({ id: n.getAttribute("popupid"), label: n.getAttribute("label"), name: n.getAttribute("name"), primary: n.button?.label, secondary: n.secondaryButton?.label,
    anchorIn: PopupNotifications.panel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere", rect: rect(PopupNotifications.panel) });
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

  AddonManager.addInstallListener({
    onNewInstall: (i) => spike.log("install listener: onNewInstall", i.sourceURI?.spec),
    onDownloadEnded: (i) => spike.log("install listener: onDownloadEnded", i.addon?.id, "signedState=" + i.addon?.signedState),
    onDownloadFailed: (i) => spike.log("install listener: onDownloadFailed error=" + i.error, AddonManager.errorToString?.(i.error)),
    onInstallFailed: (i) => spike.log("install listener: onInstallFailed error=" + i.error),
    onInstallEnded: (i, a) => spike.log("install listener: onInstallEnded", a.id, "temporary=" + a.temporarilyInstalled, "signedState=" + a.signedState),
    onInstallCancelled: () => spike.log("install listener: onInstallCancelled"),
  });

  const r = await xt.nav("http://example.com:47631/amo.html#auto", 1500);
  spike.log("store page", JSON.stringify({ after: r.after, title: gBrowser.selectedTab.label }));

  let n = await xt.waitActive(doorhanger, 15000);
  spike.log("doorhanger 1", n ? JSON.stringify(describe(n)) : "none shown");
  await xt.sleep(500);
  await spike.capture(tag + "-1-first-doorhanger");

  if (n?.getAttribute("popupid") === "addon-webext-permissions") {
    spike.log("prompt text", JSON.stringify(n.textContent.replace(/\s+/g, " ").trim().slice(0, 400)));
    await press(n.button); // Add
    let added = await xt.waitActive(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden), 8000);
    if (!added) {
      spike.log("post-install doorhanger not opened by itself; window active=" + (Services.focus.activeWindow === window), "badge-status=" + PanelUI.menuButton.getAttribute("badge-status"));
      const { AppMenuNotifications } = ChromeUtils.importESModule("resource://gre/modules/AppMenuNotifications.sys.mjs");
      const pending = AppMenuNotifications.notifications.find((x) => x.id === "addon-installed");
      if (pending) { pending.dismissed = false; PanelUI._showNotificationPanel(pending); }
      added = await xt.waitActive(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden), 6000);
    }
    await xt.sleep(700);
    spike.log("post-install notification", added ? JSON.stringify({ id: added.id, name: added.getAttribute("name"), anchorIn: PanelUI.notificationPanel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere",
      pinCheckboxHidden: added.querySelector("#addon-pin-toolbarbutton-checkbox")?.hidden, rect: rect(PanelUI.notificationPanel) }) : "none shown");
    await spike.capture(tag + "-2-added-doorhanger");
    added?.button?.click();
    await xt.closePopups();
    await xt.sleep(500);
    const addon = await AddonManager.getAddonByID("vitre-inst@spike.test");
    spike.log("installed:", !!addon, addon ? JSON.stringify({ temporary: addon.temporarilyInstalled, signedState: addon.signedState, isActive: addon.isActive, scope: addon.scope }) : "",
      "widget placement", JSON.stringify(CustomizableUI.getPlacementOfWidget("vitre-inst_spike_test-browser-action")));
    await spike.capture(tag + "-3-installed-in-pill");
  } else {
    await xt.closePopups();
  }
  spike.log("store page saw", gBrowser.selectedTab.label);
  spike.log("installed add-ons", JSON.stringify((await AddonManager.getAddonsByTypes(["extension"])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => a.id + (a.temporarilyInstalled ? " (temporary)" : ""))));
});
