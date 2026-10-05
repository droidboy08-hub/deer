// Comparison probe on stock Firefox (run with --stock): what Firefox itself does when an extension
// popup asks for an optional permission (is the popup still open, which window is on top).
//   python tests/extensions/runx.py --stock --test tests/extensions-verify/stock-optperm.js --name extensions-verify-stock --timeout 120 --out tests/extensions-verify/out/stock
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, PathUtils, PopupNotifications, CustomizableUI */
spike.main(async () => {
  const { log, sleep, capture } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(PathUtils.join(PathUtils.parent(Services.env.get("VITRE_BOOT")), "build", "ext", "optperm"));
  await AddonManager.installTemporaryAddon(f);
  await sleep(1500);
  const id = "optperm_vitre_verify-browser-action";
  const node = document.getElementById(id);
  log("widget area", CustomizableUI.getPlacementOfWidget(id)?.area, "node", !!node);
  const button = node?.querySelector(".unified-extensions-item-action-button") || node;
  spike.click(button);
  let panel = null;
  for (let i = 0; i < 60 && !panel; i++) {
    const p = document.getElementById("customizationui-widget-panel");
    if (p?.state === "open") panel = p;
    else await sleep(100);
  }
  await sleep(1200);
  const inner = panel?.querySelector("browser");
  if (inner) spike.EU.synthesizeMouseAtCenter(inner, {}, window);
  let shown = false;
  for (let i = 0; i < 80 && !shown; i++) {
    shown = PopupNotifications.panel.state === "open";
    await sleep(100);
  }
  await sleep(800);
  const r = (el) => { const b = el?.getBoundingClientRect(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.right), Math.round(b.bottom)]; };
  log("doorhanger", shown, r(PopupNotifications.panel), "popup still open", panel?.state, r(panel), "focused", document.activeElement?.localName);
  await capture("stock-optperm");
});
