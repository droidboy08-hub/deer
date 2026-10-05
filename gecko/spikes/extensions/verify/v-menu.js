// VERIFY recipe detail: the toolbar context menu with the recipe's CSS ends in a dangling
// separator, and what a right-click on the moved extensions button / the empty bar area shows.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { toolbar, extBtn } = xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2");
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs);
  await xt.sleep(600);
  const tcm = document.getElementById("toolbar-context-menu");
  const visible = () => [...tcm.children].filter((c) => !c.hidden && c.getBoundingClientRect().height > 0).map((c) => (c.localName === "menuseparator" ? "--- #" + (c.id || "(no id)") : (c.label || c.id)));
  const open = async (el, label, shot) => {
    xt.rightClick(el);
    const ok = await xt.popupShown(tcm, 3000);
    await xt.sleep(400);
    spike.log(label + ": menu open=" + !!ok + " visible items " + JSON.stringify(ok ? visible() : []));
    if (ok && shot) await spike.capture(shot);
    await xt.closePopups();
  };
  const btn = document.getElementById(xt.actionFor(mv2.id).widget.id).querySelector(".unified-extensions-item-action-button");
  await open(btn, "pinned extension button, recipe CSS as delivered");
  await open(extBtn, "extensions button (moved #unified-extensions-button), recipe CSS as delivered", "menu-1-extensions-button-context-menu");

  // the correction: also hide the separators that are left without neighbours
  xt.css("vitre-menu-fix", `#toolbar-context-menu > :is(#customizationMenuSeparator, #toolbarDownloadsAnchorMenuSeparator, #toolbarNavigatorItemsMenuSeparator, #tabbarItemsMenuSeparator, #sidebarRevampSeparator,
    #toolbar-context-openANewTab, #toolbar-context-customize-sidebar, #toolbar-context-toggle-vertical-tabs, #toolbar-context-always-open-downloads-panel) { display: none !important; }`);
  await open(btn, "pinned extension button, with the extra CSS", "menu-2-fixed-context-menu");
  await open(extBtn, "extensions button, with the extra CSS");
});
