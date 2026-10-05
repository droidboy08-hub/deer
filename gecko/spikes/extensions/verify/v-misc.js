// VERIFY robustness of approach (a):
//  1. Vitre's active pill changes with every tab switch. Can the registered toolbar node be moved to
//     another pill, detached and re-attached, or re-created, and still work?
//  2. The real "Manage Extension" and "Remove Extension" items of the button's context menu.
//  3. What the extensions button does when every extension is pinned.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  let { toolbar, extBtn } = xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2");
  const mv3 = await xt.installTemp("mv3");
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);
  await xt.nav(xt.page() + "?misc");
  await xt.waitFor(() => xt.actionData(mv2.id)?.badgeText);
  await xt.sleep(500);
  const w2 = xt.actionFor(mv2.id).widget.id, w3 = xt.actionFor(mv3.id).widget.id;
  const rect = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect());
  const btn = () => document.getElementById(w2)?.querySelector(".unified-extensions-item-action-button");
  const tryPopup = async (label) => {
    const b = btn();
    if (!b) { spike.log(label + ": NO BUTTON NODE in the document"); return false; }
    xt.click(b);
    const ok = await xt.waitFor(() => b.open, 5000);
    await xt.sleep(900);
    const wp = document.getElementById("customizationui-widget-panel");
    spike.log(label + ": node parent=" + document.getElementById(w2).parentNode.id + " button rect " + JSON.stringify(rect(b)) + " popup open=" + !!ok + " panel rect " + JSON.stringify(wp && wp.state === "open" ? rect(wp) : null) + " badge=" + b.getAttribute("badge"));
    return !!ok;
  };

  // ---- 1a. move the toolbar node into another pill (what a tab switch does to "the active pill")
  xt.css("vitre-pill2-css", `#vitre-pill-2 { height: 44px; border-radius: 22px; display: flex; align-items: center; padding: 0 10px; gap: 8px; font-weight: 600; } #vitre-pill-2 .slot { display: flex; }`);
  const pill2 = ui.h("div", { id: "vitre-pill-2", class: "v-glass" }, ui.h("span", {}, "other tab"), ui.h("span", { class: "slot" }));
  ui.bar.insertBefore(pill2, ui.pill);
  await tryPopup("1. original position");
  await xt.closePopups();
  pill2.querySelector(".slot").appendChild(toolbar);
  await xt.sleep(300);
  await tryPopup("1a. toolbar node MOVED to another pill");
  await spike.capture("misc-1a-toolbar-moved-to-other-pill");
  await xt.closePopups();

  // ---- 1b. detach, wait, re-attach (a renderer that removes and re-inserts the same node)
  toolbar.remove();
  await xt.sleep(500);
  CustomizableUI.addWidgetToArea(w3, xt.AREA); // a placement change while the node is detached
  await xt.sleep(300);
  ui.accessories.appendChild(toolbar);
  await xt.sleep(300);
  spike.log("1b. after detach + pin mv3 while detached + re-attach: children=" + JSON.stringify([...toolbar.children].map((c) => c.id)));
  await tryPopup("1b. toolbar node detached and re-attached");
  await xt.closePopups();
  CustomizableUI.addWidgetToArea(w3, CustomizableUI.AREA_ADDONS, 0);

  // ---- 1c. node thrown away and a NEW toolbar element with the same id registered
  toolbar.remove();
  const fresh = document.createXULElement("toolbar");
  fresh.id = xt.AREA;
  fresh.setAttribute("customizable", "true");
  fresh.setAttribute("mode", "icons");
  fresh.setAttribute("context", "toolbar-context-menu");
  fresh.setAttribute("class", "browser-toolbar chromeclass-toolbar-additional");
  ui.accessories.appendChild(fresh);
  let err = null;
  try { CustomizableUI.registerToolbarNode(fresh); } catch (e) { err = String(e); }
  await xt.sleep(400);
  spike.log("1c. NEW toolbar element with the same id, registerToolbarNode: error=" + err + " children of new node=" + JSON.stringify([...fresh.children].map((c) => c.id)) + " | old node children=" + toolbar.children.length);
  const ok1c = await tryPopup("1c. re-created toolbar element");
  await xt.closePopups();
  // a placement change after re-creation: does the new node follow?
  CustomizableUI.addWidgetToArea(w3, xt.AREA);
  await xt.sleep(300);
  spike.log("1c. pin mv3 after re-creation: new node children=" + JSON.stringify([...fresh.children].map((c) => c.id)) + " old node children=" + JSON.stringify([...toolbar.children].map((c) => c.id)));
  CustomizableUI.addWidgetToArea(w3, CustomizableUI.AREA_ADDONS, 0);
  await spike.capture("misc-1c-recreated-toolbar");
  if (!ok1c || !fresh.children.length) {
    // put the original node back so the rest of the script has a working bar
    fresh.remove();
    ui.accessories.appendChild(toolbar);
    await xt.sleep(300);
  } else {
    toolbar = fresh;
  }

  // ---- 2. real context-menu commands
  const tcm = document.getElementById("toolbar-context-menu");
  xt.rightClick(btn());
  await xt.popupShown(tcm);
  await xt.sleep(400);
  const manage = tcm.querySelector(".customize-context-manageExtension") || [...tcm.children].find((c) => /Manage Extension/.test(c.label || ""));
  spike.log("2. context menu items", JSON.stringify(xt.menuItems(tcm)), "last visible item is a separator=" + (xt.menuItems(tcm).at(-1) === "---"));
  tcm.activateItem(manage);
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), 8000);
  await xt.sleep(2500);
  spike.log("2a. Manage Extension -> tab " + gBrowser.selectedBrowser.currentURI.spec + " view=" + (gBrowser.selectedBrowser.contentWindow?.gViewController?.currentViewId || gBrowser.selectedBrowser.contentDocument?.querySelector("addon-card")?.addon?.id || "?"));
  await spike.capture("misc-2a-manage-extension");
  gBrowser.removeTab(gBrowser.selectedTab);
  await xt.sleep(500);

  xt.rightClick(btn());
  await xt.popupShown(tcm);
  await xt.sleep(400);
  const remove = tcm.querySelector(".customize-context-removeExtension") || [...tcm.children].find((c) => /Remove Extension/.test(c.label || ""));
  const dialogSeen = (async () => {
    const d = await xt.waitFor(() => window.gDialogBox?.isOpen && window.gDialogBox.dialog?._frame?.contentDocument?.querySelector("dialog"), 10000);
    await xt.sleep(900);
    const box = document.getElementById("window-modal-dialog");
    spike.log("2b. Remove Extension -> window-modal dialog open=" + !!d, "title/text=" + JSON.stringify((d?.ownerDocument?.documentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200)),
      "buttons=" + JSON.stringify(d ? [d.getButton("accept")?.label, d.getButton("cancel")?.label] : null), "dialog rect " + JSON.stringify(box ? rect(box) : null));
    await spike.capture("misc-2b-remove-extension-dialog");
    d?.cancelDialog();
  })();
  tcm.activateItem(remove); // confirmEx spins a nested event loop until the dialog closes
  await dialogSeen;
  await xt.sleep(600);
  spike.log("2b. after Cancel: add-on still installed=" + !!(await xt.AddonManager.getAddonByID(mv2.id)));

  // ---- 3. every extension pinned: what does the extensions button do?
  gUnifiedExtensions.pinToToolbar(w3, true);
  await xt.sleep(500);
  const tabsBefore = gBrowser.tabs.length;
  xt.click(extBtn);
  await xt.sleep(3000);
  const up = document.getElementById("unified-extensions-panel");
  spike.log("3. all extensions pinned, click on the extensions button: panel state=" + (up?.state || "not created") + " tabs before=" + tabsBefore + " after=" + gBrowser.tabs.length + " selected tab=" + gBrowser.selectedBrowser.currentURI.spec);
  await spike.capture("misc-3-all-pinned-extensions-button");
  await xt.closePopups();
});
