// SPIKE 2, approach (b): Vitre draws its own HTML buttons and drives each extension through its
// parent-process browserAction API object (ext-browserAction.js). No Firefox widget node is shown.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { ExtensionParent } = xt;
  const { IconDetails } = ExtensionParent;
  const { PanelPopup } = ChromeUtils.importESModule("resource:///modules/ExtensionPopups.sys.mjs");

  xt.css("vitre-own-buttons", `
    .v-ext { position: relative; width: 28px; height: 28px; border-radius: 14px; border: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; }
    .v-ext:hover { background: rgba(0,0,0,.06); }
    .v-ext[aria-expanded="true"] { background: rgba(0,0,0,.10); }
    .v-ext[disabled] { opacity: .4; }
    .v-ext > img { width: 16px; height: 16px; }
    .v-ext > .v-badge { position: absolute; top: -2px; right: -4px; min-width: 12px; height: 12px; line-height: 12px; padding: 0 3px; box-sizing: border-box; border-radius: 6px;
      font: 600 9px "Segoe UI", sans-serif; text-align: center; box-shadow: 0 0 0 1.5px rgba(255,255,255,.9); }
    .v-ext > .v-badge:empty { display: none; }
  `);

  const rgba = ([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  const buttons = new Map(); // extension id -> { button, api }

  /** Paint one button from the action's resolved per-tab state. */
  function paint(id) {
    const entry = buttons.get(id);
    if (!entry) return;
    const { api, button } = entry;
    const extension = api.extension;
    const data = api.action.getContextData(gBrowser.selectedTab);
    const { icon } = IconDetails.getPreferredIcon(data.icon, extension, 16 * window.devicePixelRatio);
    button.querySelector("img").src = IconDetails.escapeUrl(icon);
    button.title = data.title || extension.name;
    button.toggleAttribute("disabled", !data.enabled);
    const badge = button.querySelector(".v-badge");
    badge.textContent = data.badgeText || "";
    badge.style.backgroundColor = rgba(data.badgeBackgroundColor);
    badge.style.color = rgba(api.action.getTextColor(data));
  }

  /** Open the action's popup in its own arrow panel, anchored to Vitre's button. */
  async function openPopup(id, { userGesture = true } = {}) {
    const { api, button } = buttons.get(id);
    const existing = entryPopup.get(id);
    if (existing && !existing.destroyed) { existing.closePopup(); return null; }
    const tab = gBrowser.selectedTab;
    // Grants activeTab and returns the popup URL, or fires action.onClicked when there is none.
    const url = userGesture ? api.action.triggerClickOrPopup(tab, { button: 0, modifiers: [] }) : api.action.getPopupUrl(tab);
    if (!url) return null;
    const popup = new PanelPopup(api.extension, document, url, api.browserStyle);
    entryPopup.set(id, popup);
    popup.panel.addEventListener("popuphidden", () => { button.removeAttribute("aria-expanded"); entryPopup.delete(id); }, { once: true });
    await popup.contentReady;
    if (popup.destroyed) return null;
    button.setAttribute("aria-expanded", "true");
    popup.panel.openPopup(button, "bottomright topright", 0, 4);
    return popup;
  }
  const entryPopup = new Map();

  function add(extension) {
    const api = ExtensionParent.apiManager.global.browserActionFor?.(extension);
    if (!api || buttons.has(extension.id)) return;
    const button = ui.h("button", { class: "v-ext", "data-extension-id": extension.id }, ui.h("img"), ui.h("span", { class: "v-badge" }));
    ui.accessories.appendChild(button);
    buttons.set(extension.id, { api, button });
    button.addEventListener("click", () => openPopup(extension.id));
    // Firefox calls updateWindow(window) whenever the action's state changes for the selected tab.
    const updateWindow = api.updateWindow.bind(api);
    api.updateWindow = (win) => { updateWindow(win); if (win === window) paint(extension.id); };
    // Extension-initiated opens (keyboard command, action.openPopup(), menu item) go to Vitre too.
    api.openPopup = (win, withoutUserInteraction = false) => (win === window ? openPopup(extension.id, { userGesture: false }) : undefined);
    paint(extension.id);
  }
  function remove(extension) {
    const e = buttons.get(extension.id);
    if (e) { e.button.remove(); buttons.delete(extension.id); }
  }
  // Extension lifecycle: "ready" fires after the API objects exist; "shutdown" on disable/uninstall.
  ExtensionParent.apiManager.on("ready", (_e, extension) => add(extension));
  ExtensionParent.apiManager.on("shutdown", (_e, extension) => remove(extension));
  window.addEventListener("TabSelect", () => { for (const id of buttons.keys()) paint(id); });

  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2");
  const mv3 = await xt.installTemp("mv3");
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);
  for (const p of WebExtensionPolicy.getActiveExtensions()) if (p.extension) add(p.extension);
  await xt.nav(xt.page() + "?b");
  await xt.waitFor(() => xt.actionData(mv2.id)?.badgeText);
  await xt.sleep(800);
  spike.log("own buttons", JSON.stringify([...buttons].map(([id, e]) => ({ id, icon: e.button.querySelector("img").src, badge: e.button.querySelector(".v-badge").textContent, bg: e.button.querySelector(".v-badge").style.backgroundColor }))));
  await spike.capture("b-1-own-buttons-with-badges");

  // Per-tab state follows the selected tab.
  const tab1 = gBrowser.selectedTab;
  const tab2 = gBrowser.addTab("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  gBrowser.selectedTab = tab2;
  await xt.sleep(2500);
  spike.log("tab2: mv2 badge=" + JSON.stringify(buttons.get(mv2.id).button.querySelector(".v-badge").textContent));
  gBrowser.selectedTab = tab1;
  await xt.sleep(500);
  spike.log("tab1: mv2 badge=" + JSON.stringify(buttons.get(mv2.id).button.querySelector(".v-badge").textContent));

  // Click -> popup anchored to Vitre's own button.
  xt.click(buttons.get(mv2.id).button);
  const popup = await xt.waitFor(() => entryPopup.get(mv2.id)?.panel?.state === "open" && entryPopup.get(mv2.id), 6000);
  await xt.sleep(1200);
  spike.log("own-button popup: state=" + popup?.panel?.state, "rect", JSON.stringify(popup?.panel?.getBoundingClientRect()), "button rect", JSON.stringify(buttons.get(mv2.id).button.getBoundingClientRect()));
  await spike.capture("b-2-own-button-popup");
  await xt.closePopups();

  // The extension-facing path now lands on Vitre's popup as well.
  xt.actionFor(mv3.id).triggerAction(window);
  const p3 = await xt.waitFor(() => entryPopup.get(mv3.id)?.panel?.state === "open" && entryPopup.get(mv3.id), 6000);
  await xt.sleep(800);
  spike.log("triggerAction(window) -> Vitre popup for mv3: state=" + p3?.panel?.state, "(window active: " + (Services.focus.activeWindow === window) + ")");
  await spike.capture("b-3-triggerAction-popup");
  await xt.closePopups();

  // Data for a Vitre-drawn button menu: the extension's own "browser_action" menu items are built
  // by Firefox into any menupopup we hand it; a scratch one is enough to read them out.
  const scratch = document.createXULElement("menupopup");
  document.getElementById("mainPopupSet").appendChild(scratch);
  ExtensionParent.apiManager.global.actionContextMenu({ extension: xt.extension(mv2.id), onBrowserAction: true, menu: scratch });
  const built = [...scratch.children].map((c) => ({ tag: c.localName, id: c.id, label: c.getAttribute("label") }));
  spike.log("browser_action menu items for mv2 (scratch menupopup)", JSON.stringify(built));
  const first = scratch.querySelector("menuitem");
  first?.doCommand();
  await xt.sleep(600);
  spike.log("after doCommand on the scratch item, extension saw menus.onClicked:", JSON.stringify(xt.reported(mv2.id)?.menuClicks));
  scratch.dispatchEvent(new CustomEvent("popuphidden")); // lets gMenuBuilder clean up
  spike.log("scratch items after popuphidden:", scratch.children.length);
  const addon = await xt.AddonManager.getAddonByID(mv2.id);
  spike.log("menu commands available to Vitre: BrowserAddonUI.manageAddon / removeAddon / reportAddon; canUninstall=" + !!(addon.permissions & xt.AddonManager.PERM_CAN_UNINSTALL),
    "widget placement", JSON.stringify(CustomizableUI.getPlacementOfWidget(xt.actionFor(mv2.id).widget.id)));
});
