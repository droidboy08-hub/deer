// VERIFY claim 20 (page_action was "unverified / not built"). Page actions live in the hidden url
// bar. Stock behaviour with the toolbox hidden, then a Vitre-drawn button in the pill that drives
// the extension's parent-side pageAction API object (ext-pageAction.js).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { ExtensionParent } = xt;
  const { IconDetails } = ExtensionParent;
  const { PageActions } = ChromeUtils.importESModule("resource:///modules/PageActions.sys.mjs");
  await xt.nav(xt.page());
  const addon = await xt.installTemp("pageaction");
  const extension = xt.extension(addon.id);
  const api = await xt.waitFor(() => ExtensionParent.apiManager.global.pageActionFor?.(extension));
  await xt.sleep(800);
  const rect = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect());
  const tab = () => gBrowser.selectedTab;

  // ---- stock: the url-bar node exists but is invisible; a click through the extension-facing path fails
  const urlbarNode = document.getElementById(BrowserPageActions.urlbarButtonNodeIDForActionID(api.browserPageAction.id));
  spike.log("stock: page action API object=" + !!api, "isShownForTab=" + api.action.isShownForTab(tab()), "url-bar node exists=" + !!urlbarNode, "url-bar node rect", JSON.stringify(urlbarNode ? rect(urlbarNode) : null));
  let stockError = null;
  try { await api.handleClick(window, { button: 0, modifiers: [] }); } catch (e) { stockError = String(e); }
  await xt.sleep(800);
  spike.log("stock: handleClick (what the keyboard command / pageAction.openPopup() do) -> " + (stockError || "no error") + "; popup panel state=" + (api.popupNode?.panel?.state || "none"));
  await xt.closePopups();

  // ---- Vitre-drawn button
  xt.css("vitre-pa-css", `
    .v-pa { width: 28px; height: 28px; border-radius: 14px; border: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; }
    .v-pa:hover { background: rgba(0,0,0,.06); }
    .v-pa[hidden] { display: none; }
    .v-pa > img { width: 16px; height: 16px; }
  `);
  const button = ui.h("button", { class: "v-pa", id: "vitre-pa-" + api.browserPageAction.id }, ui.h("img"));
  ui.accessories.prepend(button);
  const paint = () => {
    const data = api.action.getContextData(tab());
    const shown = api.action.isShownForTab(tab());
    button.hidden = !shown;
    button.title = data.title || extension.name;
    const { icon } = IconDetails.getPreferredIcon(data.icon, extension, 16 * window.devicePixelRatio);
    button.querySelector("img").src = IconDetails.escapeUrl(icon);
  };
  // Firefox calls updateButton(window) whenever the page action's state for the selected tab changes.
  const updateButton = api.updateButton.bind(api);
  api.updateButton = (win) => { updateButton(win); if (win === window) paint(); };
  window.addEventListener("TabSelect", paint);
  gBrowser.addTabsProgressListener({ onLocationChange: (b) => { if (b === gBrowser.selectedBrowser) paint(); } });
  // PageActions.Action has an anchor override: popups for this action anchor to Vitre's button.
  api.browserPageAction._anchorIDOverride = button.id;
  button.addEventListener("click", (e) => api.handleClick(window, { button: e.button, modifiers: [] }));
  paint();
  await xt.sleep(300);
  spike.log("Vitre button: hidden=" + button.hidden, "icon=" + button.querySelector("img").src.slice(0, 60), "title=" + button.title, "rect", JSON.stringify(rect(button)));
  await spike.capture("pageaction-1-vitre-button");

  xt.click(button);
  await xt.waitFor(() => api.popupNode?.panel?.state === "open", 6000);
  await xt.sleep(1000);
  spike.log("click on Vitre button: popup state=" + api.popupNode?.panel?.state, "anchor=" + api.popupNode?.panel?.anchorNode?.id, "panel rect", JSON.stringify(api.popupNode ? rect(api.popupNode.panel) : null));
  await spike.capture("pageaction-2-popup");
  await xt.closePopups();

  // extension-facing path (keyboard command, pageAction.openPopup) now works too
  let err2 = null;
  try { api.triggerAction(window); } catch (e) { err2 = String(e); }
  await xt.waitFor(() => api.popupNode?.panel?.state === "open", 6000);
  spike.log("triggerAction(window) with the anchor override: " + (err2 || "no error") + " popup state=" + api.popupNode?.panel?.state);
  await xt.closePopups();

  // real key: Ctrl+Shift+U -> _execute_page_action
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  tip.beginInputTransactionForTests(window);
  const ctrl = new KeyboardEvent("", { key: "Control", code: "ControlLeft", keyCode: KeyboardEvent.DOM_VK_CONTROL });
  const shift = new KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: KeyboardEvent.DOM_VK_SHIFT });
  const u = new KeyboardEvent("", { key: "U", code: "KeyU", keyCode: KeyboardEvent.DOM_VK_U });
  tip.keydown(ctrl, tip.KEY_NON_PRINTABLE_KEY); tip.keydown(shift, tip.KEY_NON_PRINTABLE_KEY); tip.keydown(u); tip.keyup(u); tip.keyup(shift, tip.KEY_NON_PRINTABLE_KEY); tip.keyup(ctrl, tip.KEY_NON_PRINTABLE_KEY);
  const viaKey = await xt.waitFor(() => api.popupNode?.panel?.state === "open", 5000);
  spike.log("Ctrl+Shift+U (_execute_page_action) through the real key pipeline: popup open=" + !!viaKey);
  await xt.closePopups();

  // hidden on pages that do not match show_matches
  await xt.nav("https://example.com/");
  await xt.sleep(600);
  spike.log("on example.com (not in show_matches): isShownForTab=" + api.action.isShownForTab(tab()), "Vitre button hidden=" + button.hidden);
  await spike.capture("pageaction-3-hidden-on-other-site");

  // menu items for the page action (contexts: ["page_action"]) through a scratch menupopup
  await xt.nav(xt.page() + "?pa");
  const scratch = document.createXULElement("menupopup");
  document.getElementById("mainPopupSet").appendChild(scratch);
  ExtensionParent.apiManager.global.actionContextMenu({ extension, onPageAction: true, menu: scratch });
  spike.log("page_action menu items (scratch menupopup):", JSON.stringify([...scratch.children].map((c) => c.localName === "menuseparator" ? "---" : c.getAttribute("label"))));
  scratch.dispatchEvent(new CustomEvent("popuphidden"));
});
