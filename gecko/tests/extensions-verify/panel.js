// Firefox's own surfaces opened from the cluster, in Vitre's words and flows: the "was added" notice
// of an extension that lands in the panel (its "Pin to tab bar" checkbox pins it into the pill; no
// toolbar), and the extensions panel's gear menu (Pin to tab bar, Manage extension,
// Remove extension… asking in Settings › Extensions instead of Firefox's window-modal dialog).
//   python tests/extensions/runx.py --test tests/extensions-verify/panel.js --name extensions-verify-panel --app build-extensions-verify-all --out tests/extensions-verify/out/panel
// TEST-ONLY: the local package is unsigned; XPIDatabase.mustSign is replaced for the install, as
// tests/extensions/install.js does. Vitre itself never does this.
// Captures: panel-1-added-checkbox, panel-2-gear-menu, panel-3-remove-in-settings.
/* global spike, gBrowser, Services, ChromeUtils, CustomizableUI, PopupNotifications, PanelUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  const mustSign = XPIExports.XPIDatabase.mustSign;
  XPIExports.XPIDatabase.mustSign = () => false; // TEST-ONLY, see the header
  await xt.install("blocker");
  await xt.nav(xt.page("/install.html"));
  await sleep(400);

  const doorhanger = () => {
    const n = PopupNotifications.panel.firstElementChild;
    return PopupNotifications.panel.state === "open" && n ? n : null;
  };
  const wait = (fn, ms = 15000) => xt.waitFor(() => { xt.keepActive(); return fn(); }, ms, 200);
  const press = async (button) => {
    const note = button.closest("popupnotification");
    for (let i = 0; i < 12; i++) {
      await sleep(700);
      xt.keepActive();
      button.click();
      await sleep(300);
      if (!note.isConnected || note.hidden || PopupNotifications.panel.firstElementChild !== note || PopupNotifications.panel.state !== "open") return true;
    }
    return false;
  };

  // ---- 1. install an extension that lands in the panel ----
  gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("/xpi/panelonly.xpi"), {
    triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin(xt.SITE),
    hasValidUserGestureActivation: true,
  });
  let n = await wait(() => { const d = doorhanger(); return d && d.getAttribute("popupid") === "addon-install-blocked" ? d : null; });
  if (n) await press(n.button);
  n = await wait(() => { const d = doorhanger(); return d && d.getAttribute("popupid") === "addon-webext-permissions" ? d : null; });
  if (n) await press(n.button);
  const added = await wait(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden));
  await sleep(900);
  const box = document.getElementById("addon-pin-toolbarbutton-checkbox");
  const text = (added?.querySelector("#addon-install-description")?.textContent || "").trim();
  log("added notice", added?.id, "text", text, "checkbox", box?.hidden, box?.getAttribute("label"), "area", xt.area("panelonly"));
  check("installed from the page, it lands in the extensions panel", xt.area("panelonly") === CustomizableUI.AREA_ADDONS);
  // 157's default text (extensions.dataCollectionPermissions.enabled): its "extension settings" link
  // opens the add-on's page in about:addons, where its data permissions are.
  check("'was added' text does not send the user to an application menu Vitre does not have", !!text && !/application menu/i.test(text), text);
  check("'was added' offers the pin checkbox in Vitre's words", !!box && !box.hidden && box.getAttribute("label") === "Pin to tab bar", box && { hidden: box.hidden, label: box.getAttribute("label") });
  await capture("panel-1-added-checkbox");
  if (box && !box.hidden) {
    box.click();
    await xt.waitFor(() => xt.area("panelonly") === "vitre-ext-bar", 3000);
  }
  check("ticking it pins the extension into the pill", xt.area("panelonly") === "vitre-ext-bar" && !!xt.button("panelonly"), xt.area("panelonly"));
  added?.button?.click();
  await xt.closePopups();
  XPIExports.XPIDatabase.mustSign = mustSign;
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("panelonly"), false);
  await xt.waitFor(() => xt.area("panelonly") === CustomizableUI.AREA_ADDONS, 3000);

  // ---- 2. the panel's gear menu ----
  await xt.nav(xt.page() + "?gear");
  spike.click(xt.extButton());
  const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 5000);
  await sleep(700);
  const header = panel?.querySelector(".panel-header span")?.textContent;
  const footer = panel?.querySelector("#unified-extensions-manage-extensions")?.getAttribute("label");
  check("the panel keeps Firefox's title and footer (no l10n id lost)", header === "Extensions" && footer === "Manage extensions", { header, footer });
  const item = panel?.querySelector("#" + CSS.escape(xt.widgetId("panelonly")));
  const gearButton = item?.querySelector(".unified-extensions-item-menu-button");
  spike.click(gearButton);
  const gear = await xt.waitFor(() => { const m = document.getElementById("unified-extensions-context-menu"); return m?.state === "open" ? m : null; }, 4000);
  await sleep(600);
  const labels = [...(gear?.children ?? [])].filter((c) => !c.hidden && c.getBoundingClientRect().height > 0).map((c) => (c.localName === "menuseparator" ? "---" : c.getAttribute("label")));
  log("gear menu", labels);
  check("gear menu in Vitre's words: Pin to tab bar, Manage extension, Remove extension…", labels.includes("Pin to tab bar") && labels.includes("Manage extension") && labels.includes("Remove extension…"), labels);
  check("gear menu: no Report", !labels.some((l) => /report/i.test(l || "")), labels);
  await capture("panel-2-gear-menu");
  const remove = document.getElementById("unified-extensions-context-menu-remove-extension");
  remove.doCommand();
  const page = () => document.querySelector(".vx-page");
  const card = () => page()?.querySelector(`.vx-card[data-extension-id="${xt.id("panelonly")}"]`);
  await xt.waitFor(() => card()?.querySelector(".vx-confirm"), 5000);
  await sleep(600);
  log("after gear Remove: panel", panel?.state, "gear", gear?.state, "dialog", !!window.gDialogBox?.isOpen);
  check("gear menu Remove asks in Settings › Extensions (the card's confirmation)", !!card()?.querySelector(".vx-confirm") && /Remove Test Panel Only\?/.test(card().textContent));
  check("...the panel closed and Firefox's window-modal dialog did not open", panel?.state === "closed" && !window.gDialogBox?.isOpen && !document.querySelector("dialog[open], .dialogBox"), { panel: panel?.state, dialog: !!window.gDialogBox?.isOpen });
  await capture("panel-3-remove-in-settings");
  spike.click([...card().querySelectorAll(".vx-confirm .vs-btn")].find((x) => x.textContent === "Remove"));
  await xt.waitFor(async () => !(await xt.AddonManager.getAddonByID(xt.id("panelonly"))), 6000);
  check("confirmed: removed", !(await xt.AddonManager.getAddonByID(xt.id("panelonly"))));
  b.service("settings")?.close?.();
  await sleep(300);

  // ---- 3. an optional permission asked from an extension's popup: the prompt hangs from the bar ----
  await vx.install("optperm");
  await xt.nav(xt.page() + "?optperm");
  const optButton = () => document.getElementById(vx.widgetId("optperm"))?.querySelector(".unified-extensions-item-action-button");
  await xt.waitFor(() => optButton()?.getClientRects().length, 5000);
  spike.click(optButton());
  const wp = await xt.waitFor(() => xt.widgetPanel(), 6000);
  await sleep(1200);
  const inner = wp?.querySelector("browser");
  if (inner) spike.EU.synthesizeMouseAtCenter(inner, {}, window);
  const ask = await wait(() => { const d = doorhanger(); return d && /addon-webext-permissions/.test(d.getAttribute("popupid")) ? d : null; }, 10000);
  await sleep(700);
  const anchor = PopupNotifications.panel.anchorNode;
  log("optional permission prompt", ask?.getAttribute("popupid"), "anchor", anchor?.className || anchor?.id, "rect", xt.rect(PopupNotifications.panel), "ext button", xt.rect(xt.extButton()), "text", ask?.textContent.replace(/\s+/g, " ").trim().slice(0, 120));
  check("optional permission prompt from a popup hangs from the extensions button, 8 px under the pill", !!ask && !!anchor?.closest?.(".vx-cluster") && Math.abs(xt.rect(PopupNotifications.panel).y + 4 - 64) <= 2, { anchor: anchor?.className, rect: xt.rect(PopupNotifications.panel) });
  await capture("panel-4-optional-permission");
  if (ask) await press(ask.button);
  const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
  const granted = await xt.waitFor(async () => (await ExtensionPermissions.get(vx.id("optperm")))?.permissions?.includes("history"), 5000);
  check("allowed: the extension has the permission", !!granted);
  await xt.closePopups();

  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
