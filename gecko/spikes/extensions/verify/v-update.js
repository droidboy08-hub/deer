// VERIFY claim 21's gap ("an actual update download was not exercised") and look for what the
// hidden Firefox UI swallows. Local update chain (verify/www/upd-*.xpi + updates-*.json):
//   1.0 -> 2.0  same permissions: must apply silently
//   2.0 -> 3.0  adds permissions: Firefox parks the update in ExtensionsUI.updates and only shows a
//               badge on the (hidden) app-menu button plus an entry inside the (hidden) app menu.
// Release build; the unsigned test packages install because XPIDatabase.mustSign is replaced.
// Needs pref extensions.checkUpdateSecurity=false (http update_url on the local server).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { toolbar, extBtn } = xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  const { ExtensionsUI } = ChromeUtils.importESModule("resource:///modules/ExtensionsUI.sys.mjs");
  XPIExports.XPIDatabase.mustSign = function () { return false; };
  const ID = "vitre-upd@spike.test", W = "vitre-upd_spike_test-browser-action";
  await xt.nav(xt.page());

  const first = await AddonManager.getInstallForFile(xt.file("www", "upd-1.0.xpi"), "application/x-xpinstall");
  await first.install();
  await xt.waitFor(() => xt.extension(ID) && xt.actionData(ID)?.badgeText);
  const now = async () => {
    const a = await AddonManager.getAddonByID(ID);
    return JSON.stringify({ version: a?.version, isActive: a?.isActive, badge: xt.actionData(ID)?.badgeText, updateURL: a?.updateURL, placement: CustomizableUI.getPlacementOfWidget(W)?.area, nodesInPill: toolbar.children.length,
      applyBackgroundUpdates: a?.applyBackgroundUpdates, perms: a?.userPermissions });
  };
  spike.log("installed:", await now());
  spike.log("AddonManager.updateEnabled=" + AddonManager.updateEnabled, "autoUpdateDefault=" + AddonManager.autoUpdateDefault, "extensions.update.interval=" + Services.prefs.getIntPref("extensions.update.interval", -1) + "s");

  const check = async () => {
    const addon = await AddonManager.getAddonByID(ID);
    return new Promise((resolve) => {
      let found = null;
      addon.findUpdates({
        onUpdateAvailable: (a, install) => { found = install; },
        onUpdateFinished: (a, error) => resolve({ install: found, error }),
      }, AddonManager.UPDATE_WHEN_PERIODIC_UPDATE);
    });
  };

  // ---- 1.0 -> 2.0, exactly what AddonManager.backgroundUpdateCheck() does per add-on
  let { install, error } = await check();
  spike.log("update check on 1.0: error=" + error, "found=" + (install ? install.version : null));
  if (install) {
    install.promptHandler = (...args) => AddonManager.updatePromptHandler(...args);
    await install.install();
    await xt.waitFor(() => xt.actionData(ID)?.badgeText === "2.0", 8000);
    await xt.sleep(500);
    spike.log("after silent update:", await now(), "| pending permission updates=" + ExtensionsUI.updates.size);
    await spike.capture("update-1-silent-2.0-in-pill");
  }

  // ---- 2.0 -> 3.0 adds permissions
  let changes = 0;
  ExtensionsUI.on("change", () => changes++);
  ({ install, error } = await check());
  spike.log("update check on 2.0: error=" + error, "found=" + (install ? install.version : null));
  if (install) {
    install.promptHandler = (...args) => AddonManager.updatePromptHandler(...args);
    const done = install.install().then(() => "installed", (e) => "rejected: " + e);
    await xt.waitFor(() => ExtensionsUI.updates.size > 0, 10000);
    await xt.sleep(800);
    const visibleNative = PanelUI.menuButton.getBoundingClientRect().width > 0;
    spike.log("permission-adding update is parked: ExtensionsUI.updates.size=" + ExtensionsUI.updates.size, "'change' events=" + changes, "app-menu button badge-status=" + PanelUI.menuButton.getAttribute("badge-status"),
      "app-menu button visible=" + visibleNative, "| extensions button attention=" + extBtn.hasAttribute("attention"), "doorhanger open=" + (PopupNotifications.panel.state === "open"), "| still", await now());
    await spike.capture("update-2-parked-update-nothing-visible");

    // What Vitre has to do itself: surface it, then hand it to ExtensionsUI.showUpdate.
    const update = [...ExtensionsUI.updates][0];
    spike.log("parked update data for Vitre's own indicator:", JSON.stringify({ addon: update.addon.name, version: update.addon.version, newPermissions: update.permissions, strings: (update.strings.msgs || []).slice(0, 4) }));
    ExtensionsUI.showUpdate(gBrowser, update);
    const n = await xt.waitActive(() => { const d = PopupNotifications.panel.firstElementChild; return PopupNotifications.panel.state === "open" && d?.getAttribute("popupid") === "addon-webext-permissions" ? d : null; }, 15000);
    await xt.sleep(700);
    spike.log("ExtensionsUI.showUpdate ->", n ? JSON.stringify({ tab: gBrowser.selectedBrowser.currentURI.spec, text: n.textContent.replace(/\s+/g, " ").trim().slice(0, 220), primary: n.button?.label, anchorIn: PopupNotifications.panel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere" }) : "no prompt shown");
    await spike.capture("update-3-permission-prompt-from-showUpdate");
    if (n) {
      for (let i = 0; i < 12; i++) {
        await xt.sleep(700);
        xt.keepActive();
        n.button.click();
        await xt.sleep(300);
        if (!n.isConnected || PopupNotifications.panel.state !== "open") break;
      }
    }
    spike.log("install promise:", await Promise.race([done, xt.sleep(10000).then(() => "still pending")]));
    await xt.waitFor(() => xt.actionData(ID)?.badgeText === "3.0", 8000);
    spike.log("after accepting:", await now(), "| pending=" + ExtensionsUI.updates.size, "badge-status=" + PanelUI.menuButton.getAttribute("badge-status"));
    gBrowser.selectedTab = gBrowser.tabs[0];
    await xt.sleep(500);
    await spike.capture("update-4-updated-3.0");
  }
});
