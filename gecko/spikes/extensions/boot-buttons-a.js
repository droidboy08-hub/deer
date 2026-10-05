// SPIKE 2, approach (a): keep Firefox's real browserAction widgets and give them a home in Vitre's
// bar. Pinned ones sit in a CustomizableUI toolbar area inside the active pill; the real extensions
// button is moved next to the pill and opens Firefox's extensions panel for the rest.
// The recipe itself is xt.installExtensionBar() in lib.js.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { toolbar, extBtn } = xt.installExtensionBar(ui);
  const items = (menu) => JSON.stringify(xt.menuItems(menu));
  const rightClick = xt.rightClick;

  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2"); // default_area "navbar"    -> re-homed into the pill
  const mv3 = await xt.installTemp("mv3"); // default_area "menupanel" -> stays in the extensions panel
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);
  await xt.nav(xt.page() + "?a");
  await xt.waitFor(() => xt.actionData(mv2.id)?.badgeText);
  await xt.sleep(600);

  const w2 = xt.actionFor(mv2.id).widget, w3 = xt.actionFor(mv3.id).widget;
  spike.log("placements", JSON.stringify({ mv2: CustomizableUI.getPlacementOfWidget(w2.id), mv3: CustomizableUI.getPlacementOfWidget(w3.id) }));
  const node2 = w2.forWindow(window).node;
  const button2 = node2.querySelector(".unified-extensions-item-action-button");
  spike.log("mv2 widget node parent=" + node2.parentNode.id, "badge=" + button2.getAttribute("badge"), "badgeStyle=" + button2.getAttribute("badgeStyle"), "rect", JSON.stringify(button2.getBoundingClientRect()));
  await spike.capture("a-1-pinned-with-badge");

  // Per-tab state: a second tab has no blocked requests, so no badge there.
  const tab1 = gBrowser.selectedTab;
  const tab2 = gBrowser.addTab("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  gBrowser.selectedTab = tab2;
  await xt.sleep(2500);
  spike.log("tab2 selected: badge attr=" + button2.getAttribute("badge"));
  await spike.capture("a-1b-other-tab-no-badge");
  gBrowser.selectedTab = tab1;
  await xt.sleep(500);
  spike.log("tab1 selected again: badge attr=" + button2.getAttribute("badge"));

  // Click -> popup, through Firefox's own path (onBeforeCommand -> PanelUI.showSubView -> ViewPopup).
  xt.click(button2);
  await xt.waitFor(() => button2.open, 6000);
  await xt.sleep(1500);
  const wpanel = document.getElementById("customizationui-widget-panel");
  spike.log("popup via click: button.open=" + button2.open, "panel=" + wpanel?.id, "state=" + wpanel?.state, "rect", JSON.stringify(wpanel?.getBoundingClientRect()));
  await spike.capture("a-2-popup-open");
  await xt.closePopups();

  // The same popup through the extension-facing path (keyboard command, action.openPopup(),
  // menu item bound to _execute_browser_action). Needs this window to be the active one.
  spike.log("window active for triggerAction:", Services.focus.activeWindow === window);
  xt.actionFor(mv2.id).triggerAction(window);
  const viaTrigger = await xt.waitFor(() => button2.open, 3000);
  spike.log("popup via triggerAction(window): open=" + !!viaTrigger);
  await xt.closePopups();

  // The extension's keyboard command (Ctrl+Shift+Y -> _execute_browser_action) is a <key> element in
  // the window's keysets; it does not depend on the toolbar. First a synthesized key press, then
  // the key element's own command as a fallback.
  const keyEl = [...document.querySelectorAll('keyset[id^="ext-keyset-id-"] key')].find((k) => k.closest("keyset").id.includes("vitre-mv2"));
  spike.log("command key element:", keyEl ? JSON.stringify({ keyset: keyEl.closest("keyset").id, key: keyEl.getAttribute("key"), modifiers: keyEl.getAttribute("modifiers") }) : "none");
  const keyOpts = { key: "Y", code: "KeyY", keyCode: 89, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, view: window };
  for (const type of ["keydown", "keypress", "keyup"]) document.documentElement.dispatchEvent(new KeyboardEvent(type, { ...keyOpts, charCode: type === "keypress" ? 89 : 0 }));
  let viaKey = await xt.waitFor(() => button2.open, 2500);
  spike.log("popup via synthesized Ctrl+Shift+Y: open=" + !!viaKey);
  if (!viaKey && keyEl) {
    keyEl.doCommand();
    viaKey = await xt.waitFor(() => button2.open, 3000);
    spike.log("popup via the <key> element's command: open=" + !!viaKey);
  }
  await xt.sleep(800);
  await spike.capture("a-2b-popup-from-keyboard-command");
  await xt.closePopups();

  // Right-click on the pinned widget: Firefox's toolbar-context-menu.
  const tcm = document.getElementById("toolbar-context-menu");
  rightClick(button2);
  await xt.popupShown(tcm);
  await xt.sleep(500);
  spike.log("toolbar-context-menu state=" + tcm.state, "items", items(tcm));
  await spike.capture("a-3-context-menu");
  // Use the real "Pin to Toolbar" item to unpin.
  const pinItem = tcm.querySelector("#toolbar-context-pin-to-toolbar");
  tcm.activateItem(pinItem);
  await xt.sleep(700);
  spike.log("after menu Unpin:", JSON.stringify(CustomizableUI.getPlacementOfWidget(w2.id)), "nodes in pill:", toolbar.children.length);
  await spike.capture("a-4-unpinned");

  // The extensions button (moved from the hidden nav bar) opens Firefox's panel for the rest.
  xt.click(extBtn);
  const upanel = await xt.waitFor(() => document.getElementById("unified-extensions-panel"), 4000);
  await xt.popupShown(upanel);
  await xt.sleep(1200);
  spike.log("extensions panel state=" + upanel?.state, "items", JSON.stringify([...upanel.querySelectorAll(".unified-extensions-item")].map((n) => n.id || n.getAttribute("extension-id"))), "rect", JSON.stringify(upanel.getBoundingClientRect()));
  await spike.capture("a-5-extensions-panel");

  // Gear menu of an item in the panel: Pin to Toolbar / Manage / Remove / Report.
  const gear = upanel.querySelector("#" + CSS.escape(w3.id) + " .unified-extensions-item-menu-button");
  const ucm = document.getElementById("unified-extensions-context-menu");
  xt.click(gear);
  gear.dispatchEvent(new CustomEvent("command", { bubbles: true, cancelable: true }));
  if (!(await xt.popupShown(ucm, 1500))) {
    ucm.openPopup(gear, "after_end", 0, 0, true, false);
    await xt.popupShown(ucm, 3000);
  }
  await xt.sleep(500);
  spike.log("unified-extensions-context-menu state=" + ucm.state, "items", items(ucm));
  await spike.capture("a-6-panel-gear-menu");
  const pin3 = ucm.querySelector(".unified-extensions-context-menu-pin-to-toolbar");
  ucm.activateItem(pin3);
  await xt.sleep(900);
  spike.log("after gear-menu Pin on mv3:", JSON.stringify(CustomizableUI.getPlacementOfWidget(w3.id)), "panel state=" + upanel.state);
  await xt.closePopups();
  await spike.capture("a-7-mv3-pinned-from-panel");

  // An unpinned extension's popup opens inside the extensions panel (a sub view).
  xt.click(extBtn);
  await xt.popupShown(upanel);
  await xt.sleep(800);
  const row2 = upanel.querySelector("#" + CSS.escape(w2.id) + " .unified-extensions-item-action-button");
  spike.log("mv2 row in panel:", !!row2);
  if (row2) {
    xt.click(row2);
    row2.dispatchEvent(new CustomEvent("command", { bubbles: true, cancelable: true }));
    await xt.sleep(2000);
    spike.log("panel after clicking unpinned mv2 row: state=" + upanel.state, "views", JSON.stringify([...upanel.querySelectorAll("panelview")].map((v) => v.id + ":" + (v.hasAttribute("visible") ? "visible" : "hidden"))));
    await spike.capture("a-8-unpinned-popup-in-panel");
  }
  await xt.closePopups();

  spike.log("final placements", JSON.stringify(CustomizableUI.getWidgetIdsInArea(xt.AREA)), "addons area", JSON.stringify(CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_ADDONS)));
  spike.log("browserAction.getUserSettings equivalent: mv3 isOnToolbar=" + (CustomizableUI.getPlacementOfWidget(w3.id).area !== CustomizableUI.AREA_ADDONS), "mv2 isOnToolbar=" + (CustomizableUI.getPlacementOfWidget(w2.id).area !== CustomizableUI.AREA_ADDONS));
});
