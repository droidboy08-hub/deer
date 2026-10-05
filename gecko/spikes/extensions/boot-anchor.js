// SPIKE 3c: doorhangers that are NOT anchored to the extensions button. With the toolbox hidden,
// PopupNotifications finds no visible anchor (its own fallbacks are all url-bar icons) and opens
// the panel unanchored. One hook gives every such doorhanger a home in Vitre's bar. This matters for
// the extension flows that use other anchors (e.g. "change your default search engine?" uses
// #addons-notification-icon) as well as site permission prompts.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  const rect = (p) => (({ x, y, width, height }) => ({ x, y, width, height }))(p.getBoundingClientRect());
  const show = async (label) => {
    const n = PopupNotifications.show(gBrowser.selectedBrowser, "vitre-anchor-test", "Test doorhanger anchored to a url-bar icon (" + label + ")", "addons-notification-icon",
      { label: "OK", accessKey: "O", callback() {} }, null, { persistent: true, removeOnDismissal: true });
    await xt.waitActive(() => PopupNotifications.panel.state === "open", 4000);
    await xt.sleep(500);
    const a = PopupNotifications.panel.anchorNode;
    spike.log(label + ": panel state=" + PopupNotifications.panel.state, "anchorNode=" + (a ? (a.id || a.localName) + (a.closest?.("#vitre-bar") ? " (in vitre-bar)" : " (outside vitre-bar)") : "null"), "rect", JSON.stringify(rect(PopupNotifications.panel)));
    return n;
  };

  let n = await show("stock");
  await spike.capture("anchor-1-stock-unanchored");
  n.remove();
  await xt.closePopups();

  // The hook: keep a visible requested anchor, otherwise use Vitre's pill.
  const stock = PopupNotifications._getVisibleAnchorElement;
  PopupNotifications._getVisibleAnchorElement = (anchor) => {
    const found = stock ? stock(anchor) : anchor;
    return found?.checkVisibility?.(PopupNotifications.CHECK_VISIBILITY_OPTIONS) ? found : ui.pill;
  };
  n = await show("with Vitre fallback anchor");
  await spike.capture("anchor-2-fallback-to-pill");
  n.remove();
  await xt.closePopups();
});
