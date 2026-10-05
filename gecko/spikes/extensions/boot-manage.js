// SPIKE 5: managing add-ons through the AddonManager API (what a Vitre Settings > Extensions page
// needs): list, enable/disable, private-window access, update check, remove; about:addons still
// reachable; and an unsigned extension shipped as a built-in.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { AddonManager, ExtensionParent } = xt;
  const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");

  const events = [];
  AddonManager.addAddonListener({
    onInstalled: (a) => events.push("onInstalled " + a.id),
    onEnabled: (a) => events.push("onEnabled " + a.id),
    onDisabled: (a) => events.push("onDisabled " + a.id),
    onUninstalling: (a) => events.push("onUninstalling " + a.id),
    onUninstalled: (a) => events.push("onUninstalled " + a.id),
    onPropertyChanged: (a, props) => events.push("onPropertyChanged " + a.id + " " + props.join(",")),
  });

  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2");
  const mv3 = await xt.installTemp("mv3");
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);

  // ---- An unsigned extension shipped with the app: built-in add-ons are exempt from signing.
  let builtin = null;
  try {
    builtin = await AddonManager.installBuiltinAddon("resource://vitre-boot/ext/inst/");
    await xt.waitFor(() => xt.extension("vitre-inst@spike.test"));
    spike.log("installBuiltinAddon:", JSON.stringify({ id: builtin.id, isBuiltin: builtin.isBuiltin, isActive: builtin.isActive, signedState: builtin.signedState, isPrivileged: builtin.isPrivileged, temporary: builtin.temporarilyInstalled,
      canUninstall: !!(builtin.permissions & AddonManager.PERM_CAN_UNINSTALL), canDisable: !!(builtin.permissions & AddonManager.PERM_CAN_DISABLE), hidden: builtin.hidden }));
  } catch (e) {
    spike.log("installBuiltinAddon failed: " + e);
  }

  // ---- List: everything a settings page shows.
  const flags = (a) => ({ uninstall: !!(a.permissions & AddonManager.PERM_CAN_UNINSTALL), enable: !!(a.permissions & AddonManager.PERM_CAN_ENABLE), disable: !!(a.permissions & AddonManager.PERM_CAN_DISABLE),
    upgrade: !!(a.permissions & AddonManager.PERM_CAN_UPGRADE), privateBrowsing: !!(a.permissions & AddonManager.PERM_CAN_CHANGE_PRIVATEBROWSING_ACCESS) });
  const list = async () => (await AddonManager.getAddonsByTypes(["extension"])).filter((a) => !a.hidden);
  const all = await AddonManager.getAddonsByTypes(["extension"]);
  spike.log("all extension-type add-ons (including hidden system ones):", JSON.stringify(all.map((a) => a.id + (a.hidden ? " [hidden]" : "") + (a.isBuiltin ? " [builtin]" : "") + (a.isSystem ? " [system]" : ""))));
  for (const a of await list()) {
    spike.log("ADDON", JSON.stringify({ id: a.id, name: a.name, version: a.version, description: a.description?.slice(0, 40), creator: a.creator?.name, isActive: a.isActive, userDisabled: a.userDisabled, appDisabled: a.appDisabled,
      temporary: a.temporarilyInstalled, signedState: a.signedState, icon: AddonManager.getPreferredIconURL(a, 32, window), optionsURL: a.optionsURL, optionsType: a.optionsType, incognito: a.incognito,
      installDate: a.installDate?.toISOString?.().slice(0, 10), applyBackgroundUpdates: a.applyBackgroundUpdates, updateURL: a.updateURL, canDo: flags(a),
      userPermissions: a.userPermissions, hasBrowserAction: !!xt.actionFor(a.id), pinned: xt.actionFor(a.id) ? CustomizableUI.getPlacementOfWidget(xt.actionFor(a.id).widget.id)?.area !== CustomizableUI.AREA_ADDONS : null }));
  }
  spike.log("global update settings: AddonManager.updateEnabled=" + AddonManager.updateEnabled, "autoUpdateDefault=" + AddonManager.autoUpdateDefault, "extensions.update.url=" + Services.prefs.getCharPref("extensions.update.url", "").slice(0, 60) + "...");

  // ---- A Vitre-drawn Settings > Extensions panel from that data.
  xt.css("vitre-settings-mock", `
    #vitre-settings { position: fixed; left: 50%; top: 84px; transform: translateX(-50%); width: 760px; z-index: 30; border-radius: 12px; overflow: hidden;
      background: rgba(243,243,247,.94); backdrop-filter: blur(24px) saturate(1.6); box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 24px 60px rgba(0,0,0,.3); font: 14px "Segoe UI Variable Text","Segoe UI",sans-serif; color: #1b1b1f; }
    #vitre-settings > header { height: 48px; display: flex; align-items: center; padding: 0 20px; font-weight: 600; border-bottom: 1px solid rgba(0,0,0,.08); }
    #vitre-settings .row { display: flex; align-items: center; gap: 14px; margin: 10px 16px; padding: 12px 16px; border-radius: 8px; background: rgba(255,255,255,.75); box-shadow: 0 0 0 1px rgba(0,0,0,.06); }
    #vitre-settings .row img { width: 32px; height: 32px; }
    #vitre-settings .row .t { flex: 1; min-width: 0; }
    #vitre-settings .row .n { font-weight: 600; }
    #vitre-settings .row .d { opacity: .65; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #vitre-settings .tag { font-size: 11.5px; padding: 2px 8px; border-radius: 10px; background: rgba(0,0,0,.07); }
    #vitre-settings .sw { width: 40px; height: 20px; border-radius: 10px; background: #005fb8; position: relative; flex: none; }
    #vitre-settings .sw::after { content: ""; position: absolute; top: 4px; left: 24px; width: 12px; height: 12px; border-radius: 6px; background: #fff; }
    #vitre-settings .sw.off { background: transparent; box-shadow: 0 0 0 1px rgba(0,0,0,.45) inset; }
    #vitre-settings .sw.off::after { left: 4px; background: rgba(0,0,0,.6); }
  `);
  const render = async () => {
    document.getElementById("vitre-settings")?.remove();
    const panel = ui.h("div", { id: "vitre-settings" }, ui.h("header", {}, "Settings › Extensions"));
    for (const a of await list()) {
      panel.append(ui.h("div", { class: "row" },
        ui.h("img", { src: AddonManager.getPreferredIconURL(a, 32, window) || "chrome://mozapps/skin/extensions/extensionGeneric.svg" }),
        ui.h("div", { class: "t" }, ui.h("div", { class: "n" }, a.name + "  " + a.version), ui.h("div", { class: "d" }, a.description || "")),
        ...(a.temporarilyInstalled ? [ui.h("span", { class: "tag" }, "Temporary")] : []), ...(a.isBuiltin ? [ui.h("span", { class: "tag" }, "Built in")] : []),
        ...(a.optionsURL ? [ui.h("span", { class: "tag" }, "Options")] : []),
        ui.h("div", { class: "sw" + (a.userDisabled ? " off" : "") })));
    }
    document.body.appendChild(panel);
  };
  await render();
  await xt.sleep(500);
  await spike.capture("manage-1-vitre-extensions-list");

  // ---- Disable: the blocker stops blocking and its button leaves the pill.
  const result = async () => { await xt.nav(xt.page() + "?" + Date.now()); await xt.waitFor(() => gBrowser.selectedTab.label.startsWith("RESULT")); return gBrowser.selectedTab.label; };
  document.getElementById("vitre-settings")?.remove();
  spike.log("mv2 enabled :", await result(), "| pill widgets", JSON.stringify(CustomizableUI.getWidgetIdsInArea(xt.AREA)));
  await mv2.disable();
  await xt.sleep(500);
  spike.log("mv2 disabled:", await result(), "| isActive=" + mv2.isActive, "userDisabled=" + mv2.userDisabled, "| pill widgets", JSON.stringify(CustomizableUI.getWidgetIdsInArea(xt.AREA)), "widget nodes in pill:", document.getElementById(xt.AREA).children.length);
  await render();
  await xt.sleep(400);
  await spike.capture("manage-2-mv2-disabled");
  document.getElementById("vitre-settings")?.remove();
  await mv2.enable();
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs);
  spike.log("mv2 re-enabled:", await result(), "| pill widgets", JSON.stringify(CustomizableUI.getWidgetIdsInArea(xt.AREA)), "widget nodes in pill:", document.getElementById(xt.AREA).children.length);

  // ---- Private-window access (the "Run in Private Windows" switch).
  const pb = async () => (await ExtensionPermissions.get(mv3.id)).permissions.includes("internal:privateBrowsingAllowed");
  spike.log("mv3 private browsing allowed before:", await pb());
  await ExtensionPermissions.add(mv3.id, { permissions: ["internal:privateBrowsingAllowed"], origins: [] });
  spike.log("mv3 private browsing allowed after ExtensionPermissions.add:", await pb(), "(an enabled add-on must be reloaded for it to apply: addon.reload())");
  await ExtensionPermissions.remove(mv3.id, { permissions: ["internal:privateBrowsingAllowed"], origins: [] });

  // ---- Update check for one add-on (user requested).
  const upd = await new Promise((resolve) => {
    const out = [];
    try {
      mv3.findUpdates({
        onUpdateAvailable: (a, install) => out.push("onUpdateAvailable " + install.version),
        onNoUpdateAvailable: () => out.push("onNoUpdateAvailable"),
        onCompatibilityUpdateAvailable: () => out.push("onCompatibilityUpdateAvailable"),
        onNoCompatibilityUpdateAvailable: () => out.push("onNoCompatibilityUpdateAvailable"),
        onUpdateFinished: (a, error) => { out.push("onUpdateFinished error=" + error); resolve(out); },
      }, AddonManager.UPDATE_WHEN_USER_REQUESTED);
    } catch (e) { out.push("findUpdates threw " + e); resolve(out); }
    setTimeout(() => resolve(out.concat("timeout")), 20000);
  });
  spike.log("findUpdates(mv3):", JSON.stringify(upd), "(UPDATE_STATUS_NO_ERROR=" + AddonManager.UPDATE_STATUS_NO_ERROR + ", DOWNLOAD_ERROR=" + AddonManager.UPDATE_STATUS_DOWNLOAD_ERROR + ")");

  // ---- about:addons is still reachable (and is the fallback UI for everything above).
  await BrowserAddonUI.openAddonsMgr("addons://list/extension");
  await xt.sleep(3000);
  spike.log("about:addons tab:", gBrowser.selectedBrowser.currentURI.spec);
  await spike.capture("manage-3-about-addons");

  // ---- Remove.
  await mv3.uninstall();
  await xt.sleep(800);
  spike.log("after mv3.uninstall(): getAddonByID ->", String(await AddonManager.getAddonByID(mv3.id)), "| policy active:", !!xt.policy(mv3.id), "| remaining", JSON.stringify((await list()).map((a) => a.id)));
  if (builtin) {
    try { await builtin.uninstall(); spike.log("builtin uninstall ok ->", String(await AddonManager.getAddonByID(builtin.id))); } catch (e) { spike.log("builtin uninstall: " + e); }
  }
  spike.log("listener events", JSON.stringify(events));
});
