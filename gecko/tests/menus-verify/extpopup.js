// The one place a page keeps Firefox's own menu: a page inside a native panel (an extension's
// browser-action popup is a separate OS window above Vitre's layer). A local temporary extension
// (tests/menus-verify/ext-popup, never downloaded) opens its popup; a right-click in it shows
// #contentAreaContextMenu, never Vitre's menu; the same right-click in a tab shows Vitre's.
// The right-click is synthesized inside the page (Window.synthesizeMouseEvent from a frame script),
// as Firefox's own tests do for remote browsers.
//   python tests/menus-verify/all.py extpopup
/* global spike, Services, Cc, Ci, ChromeUtils, PathUtils, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, waitFor } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  const until = (fn, ms = 6000) => waitFor(fn, { timeout: ms }).then(() => true, () => false);
  const nativePopup = document.getElementById("contentAreaContextMenu");
  const rightClickIn = (browser, x, y) =>
    M.inContent(browser, (content, a) => {
      // Window.synthesizeMouseEvent (ChromeOnly; what EventUtils uses in 157).
      for (const type of ["mousedown", "mouseup", "contextmenu"]) content.synthesizeMouseEvent(type, a.x, a.y, { button: 2, buttons: type === "mousedown" ? 2 : 0, clickCount: 1, modifiers: 0 }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false });
      return true;
    }, { x, y });

  // Control: the same synthesized right-click in a tab gets Vitre's menu.
  const tab = await M.load(M.page("article.html"));
  const p = await M.rectOf("#p1", { scroll: false });
  const br = tab.browser.getBoundingClientRect();
  const r0 = await rightClickIn(tab.browser, p.x - br.left + 20, p.y - br.top + 10);
  log("synthesized in the page:", JSON.stringify(r0));
  check("control: a right-click in a tab opens Vitre's menu", (await M.waitOpen()) && M.last().nativeShown === 0);
  M.key("KEY_Escape");
  await M.waitClosed();
  await sleep(300);

  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(PathUtils.join(PathUtils.parent(Services.env.get("VITRE_BOOT")), "ext-popup"));
  const addon = await AddonManager.installTemporaryAddon(dir);
  check("popup extension installed (temporary, local)", !!addon, addon?.id);
  await sleep(1500);
  try {
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const ext = WebExtensionPolicy.getByID(addon.id).extension;
    await M.activate();
    // ext-browserAction.js BrowserAction.openPopup(window, withoutUserInteraction)
    await ExtensionParent.apiManager.global.browserActionFor(ext).openPopup(window, true);
    const ok = await until(() => {
      const pb = document.querySelector(".webextension-popup-browser");
      return pb && pb.currentURI?.spec.endsWith("/popup.html") && !pb.webProgress?.isLoadingDocument;
    }, 10000);
    check("the extension's popup opened", ok);
    if (!ok) return;
    await sleep(800);
    const pb = document.querySelector(".webextension-popup-browser");
    const panel = pb.closest("panel");
    log("popup", JSON.stringify({ panel: panel?.id || panel?.className, state: panel?.state, remote: pb.isRemoteBrowser }));
    const allowed = M.last().nativeAllowed;
    const pages = M.last().pageMenus;
    let shown = false;
    const onShown = () => (shown = true);
    nativePopup.addEventListener("popupshown", onShown);
    await rightClickIn(pb, 40, 30);
    const opened = await until(() => shown || nativePopup.state === "open", 5000);
    log("after a right-click in the popup", JSON.stringify({ native: nativePopup.state, nativeAllowed: M.last().nativeAllowed - allowed, vitreMenu: M.isOpen(), pageMenus: M.last().pageMenus - pages }));
    check("extension popup: Firefox's own menu shows there (DESIGN keeps it: a panel above Vitre's layer)", opened && M.last().nativeAllowed === allowed + 1);
    check("extension popup: no Vitre menu behind it", !M.isOpen() && M.last().pageMenus === pages);
    nativePopup.hidePopup();
    await until(() => nativePopup.state === "closed", 3000);
    nativePopup.removeEventListener("popupshown", onShown);
    panel?.hidePopup?.();
    await sleep(500);
    // Back in the tab: Vitre's menu again, and the native popup does not come back.
    const before = M.last().nativeShown;
    await rightClickIn(tab.browser, p.x - br.left + 20, p.y - br.top + 10);
    check("after the popup: a right-click in a tab opens Vitre's menu again", await M.waitOpen() && M.last().nativeShown === before);
    M.key("KEY_Escape");
    await M.waitClosed();
  } finally {
    await addon?.uninstall();
  }
  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
});
