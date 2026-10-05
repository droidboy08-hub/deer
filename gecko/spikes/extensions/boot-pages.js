// SPIKE 4: extension pages and menus with Firefox's toolbox hidden.
//   options pages (about:addons detail view, plain tab, embedded in a Vitre panel),
//   menus API items (native #contentAreaContextMenu, and the data source for a Vitre-drawn menu),
//   sidebar_action, devtools_page.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { ExtensionParent, AddonManager } = xt;
  const SYS = Services.scriptSecurityManager.getSystemPrincipal();
  const extGlobal = ExtensionParent.apiManager.global;

  await xt.nav(xt.page());
  const addon = await xt.installTemp("mv2");
  await xt.waitFor(() => xt.reported(addon.id)?.tabs);
  const extension = xt.extension(addon.id);
  const policy = xt.policy(addon.id);
  spike.log("options: optionsURL=" + addon.optionsURL, "optionsType=" + addon.optionsType, "(AddonManager.OPTIONS_TYPE_INLINE_BROWSER=" + AddonManager.OPTIONS_TYPE_INLINE_BROWSER + ", OPTIONS_TYPE_TAB=" + AddonManager.OPTIONS_TYPE_TAB + ")",
    "optionsPageProperties=" + JSON.stringify(extension.optionsPageProperties));

  // ---- 1a. What runtime.openOptionsPage() does for an inline options_ui: about:addons detail view.
  await extGlobal.openOptionsPage(extension);
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), 8000);
  await xt.sleep(3000);
  spike.log("openOptionsPage -> tab", gBrowser.selectedBrowser.currentURI.spec, "tabs=" + gBrowser.tabs.length);
  await spike.capture("pages-1a-options-in-about-addons");

  // ---- 1b. The options document as an ordinary tab.
  const optTab = gBrowser.addTab(addon.optionsURL, { triggeringPrincipal: extension.principal });
  gBrowser.selectedTab = optTab;
  await xt.sleep(2000);
  spike.log("options as a tab:", optTab.linkedBrowser.currentURI.spec, "remoteType=" + optTab.linkedBrowser.remoteType, "title=" + optTab.label);
  await spike.capture("pages-1b-options-as-tab");

  // ---- 1c. Embedded in Vitre's own UI (what a Settings > Extensions page would do): the same
  // browser element about:addons' <inline-options-browser> builds.
  gBrowser.selectedTab = gBrowser.tabs[0];
  await xt.sleep(400);
  xt.css("vitre-settings-mock", `
    #vitre-settings { position: fixed; left: 50%; top: 96px; transform: translateX(-50%); width: 720px; height: 420px; z-index: 30; border-radius: 12px; overflow: hidden;
      background: rgba(243,243,247,.92); backdrop-filter: blur(24px) saturate(1.6); box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 24px 60px rgba(0,0,0,.3); font: 14px "Segoe UI Variable Text","Segoe UI",sans-serif; color: #1b1b1f; }
    #vitre-settings > header { height: 48px; display: flex; align-items: center; padding: 0 20px; font-weight: 600; border-bottom: 1px solid rgba(0,0,0,.08); }
    #vitre-settings > .body { padding: 16px 20px; }
    #vitre-settings browser { width: 100%; height: 280px; border-radius: 8px; background: #fff; display: block; }
  `);
  const panel = ui.h("div", { id: "vitre-settings" }, ui.h("header", {}, "Settings › Extensions › " + addon.name + " › Options"), ui.h("div", { class: "body" }));
  document.body.appendChild(panel);
  const ob = document.createXULElement("browser");
  ob.setAttribute("type", "content");
  ob.setAttribute("disableglobalhistory", "true");
  ob.setAttribute("messagemanagergroup", "webext-browsers");
  ob.setAttribute("initialBrowsingContextGroupId", policy.browsingContextGroupId);
  ob.setAttribute("remote", "true");
  ob.setAttribute("remoteType", extension.remoteType);
  ob.setAttribute("maychangeremoteness", "true");
  const created = new Promise((r) => ob.addEventListener("XULFrameLoaderCreated", r, { once: true }));
  panel.querySelector(".body").appendChild(ob);
  await created;
  ExtensionParent.apiManager.emit("extension-browser-inserted", ob);
  ob.fixupAndLoadURIString(addon.optionsURL, { triggeringPrincipal: extension.principal });
  await xt.sleep(2500);
  spike.log("embedded options browser:", ob.currentURI?.spec, "remoteType=" + ob.remoteType, "title=" + ob.contentTitle);
  await spike.capture("pages-1c-options-embedded-in-vitre-panel");
  panel.remove();

  // ---- 2a. Native content context menu: extension items are built into #contentAreaContextMenu.
  const seen = [];
  const obs = { observe: (s) => { const d = s.wrappedJSObject; seen.push(Object.keys(d).filter((k) => k !== "wrappedJSObject" && d[k] !== undefined && d[k] !== false && d[k] !== null)); } };
  Services.obs.addObserver(obs, "on-build-contextmenu");
  const cm = document.getElementById("contentAreaContextMenu");
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  const px = br.left + 300, py = br.top + 420; // empty page area
  xt.mouseAt("mousedown", px, py, 2);
  xt.mouseAt("contextmenu", px, py, 2);
  xt.mouseAt("mouseup", px, py, 2);
  let shown = await xt.popupShown(cm, 4000);
  if (!shown) {
    spike.log("sync synthesized contextmenu did not open the menu; retrying async");
    xt.mouseAt("mousedown", px, py, 2, true);
    xt.mouseAt("contextmenu", px, py, 2, true);
    xt.mouseAt("mouseup", px, py, 2, true);
    shown = await xt.popupShown(cm, 4000);
  }
  await xt.sleep(600);
  spike.log("native page menu: state=" + cm.state, "extension items", JSON.stringify(xt.menuItems(cm).filter((l) => /MV2/.test(l))));
  spike.log("on-build-contextmenu subject fields (from nsContextMenu)", JSON.stringify(seen[0] || null));
  if (shown) await spike.capture("pages-2a-native-context-menu");
  await xt.closePopups();
  Services.obs.removeObserver(obs, "on-build-contextmenu");

  // ---- 2b. Data source for a Vitre-drawn page menu: the same observer notification, pointed at a
  // scratch menupopup that is never shown. Read the items out, run one, then signal "hidden".
  const scratch = document.createXULElement("menupopup");
  scratch.id = "vitre-ext-menu-scratch";
  document.getElementById("mainPopupSet").appendChild(scratch);
  const tab = gBrowser.selectedTab;
  const build = (ctx) => {
    const subject = { menu: scratch, tab, pageUrl: tab.linkedBrowser.currentURI.spec, timeStamp: Date.now(), ...ctx };
    subject.wrappedJSObject = subject;
    Services.obs.notifyObservers(subject, "on-build-contextmenu");
    const read = (popup) => [...popup.children].map((c) => c.localName === "menuseparator" ? { separator: true } :
      { id: c.id, label: c.getAttribute("label"), icon: c.getAttribute("image") || undefined, type: c.getAttribute("type") || undefined, checked: c.hasAttribute("checked") || undefined,
        disabled: c.hasAttribute("disabled") || undefined, children: c.localName === "menu" ? read(c.menupopup) : undefined });
    return read(scratch);
  };
  const done = () => scratch.dispatchEvent(new CustomEvent("popuphidden"));
  spike.log("custom menu data, page context", JSON.stringify(build({})));
  done();
  spike.log("custom menu data, link context", JSON.stringify(build({ onLink: true, linkUrl: "http://localhost:47631/ok/pixel.png", linkText: "a link" })));
  done();
  const sel = build({ isTextSelected: true, selectionText: "ad server" });
  spike.log("custom menu data, selection context", JSON.stringify(sel));
  // Activate "MV2: search blocklists for ..." the way a Vitre menu row would.
  const before = (xt.reported(addon.id)?.menuClicks || []).length;
  const target = [...scratch.querySelectorAll("menuitem")].find((m) => /search blocklists/.test(m.getAttribute("label")));
  target?.doCommand();
  await xt.waitFor(() => (xt.reported(addon.id)?.menuClicks || []).length > before, 4000);
  done();
  spike.log("menus.onClicked received by the extension", JSON.stringify(xt.reported(addon.id)?.menuClicks));
  spike.log("raw model also reachable: gMenuMap entries for the extension =", extGlobal.gMenuMap.get(extension)?.size, "root children =", extGlobal.gRootItems.get(extension)?.children.length);

  // ---- 3. sidebar_action: Firefox's sidebar lives outside #navigator-toolbox.
  const sidebarId = extGlobal.makeWidgetId(addon.id) + "-sidebar-action";
  await SidebarController.show(sidebarId);
  await xt.sleep(1500);
  const box = document.getElementById("sidebar-box");
  spike.log("sidebar: isOpen=" + SidebarController.isOpen, "currentID=" + SidebarController.currentID, "box rect", JSON.stringify((({ x, y, width, height }) => ({ x, y, width, height }))(box.getBoundingClientRect())), "revamp pref=" + Services.prefs.getBoolPref("sidebar.revamp", false));
  await spike.capture("pages-3-sidebar-action");
  SidebarController.hide();
  await xt.sleep(400);

  // ---- 4. devtools_page: only loads when a DevTools toolbox is open for the tab.
  try {
    const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
    const { gDevTools } = require("devtools/client/framework/devtools");
    const toolbox = await Promise.race([gDevTools.showToolboxForTab(gBrowser.selectedTab, { toolId: "webconsole" }), xt.sleep(25000).then(() => null)]);
    if (toolbox) {
      await xt.sleep(3000);
      const panels = [...toolbox.getToolDefinitions?.() ?? []];
      const extPanels = toolbox.getAdditionalTools ? toolbox.getAdditionalTools().map((t) => t.label || t.id) : [];
      spike.log("devtools toolbox opened: hostType=" + toolbox.hostType, "additional (extension) tools", JSON.stringify(extPanels), "tabs", JSON.stringify([...toolbox.doc.querySelectorAll(".devtools-tab")].map((t) => t.textContent.trim())));
      await spike.capture("pages-4-devtools-panel");
      await toolbox.destroy();
    } else {
      spike.log("devtools toolbox did not open within 25 s");
    }
  } catch (e) {
    spike.log("devtools toolbox failed: " + e);
  }
});
