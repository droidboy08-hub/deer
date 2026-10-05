// Shared helpers for the "extensions" spike boot scripts.
// Load with: Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
/* global Services, Cc, Ci, ChromeUtils, PathUtils, gBrowser, spike, CustomizableUI, gUnifiedExtensions */
window.xt = (() => {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const HTML = "http://www.w3.org/1999/xhtml";
  const root = PathUtils.parent(Services.env.get("VITRE_BOOT"));
  const PORT = 47631;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const file = (...parts) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(PathUtils.join(root, ...parts));
    return f;
  };

  /** Simulate the Vitre shell: Firefox's whole toolbox (tabs, nav bar, bookmarks) is gone. */
  function hideFirefoxUI() {
    css("vitre-hide-fx", `
      #navigator-toolbox { display: none !important; }
    `);
  }

  function css(id, text) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElementNS(HTML, "style");
      el.id = id;
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    return el;
  }

  async function waitFor(fn, ms = 8000, step = 100) {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try { v = await fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  /** Temporary add-on from an unpacked folder: what about:debugging "Load Temporary Add-on" does. */
  async function installTemp(name) {
    const addon = await AddonManager.installTemporaryAddon(file("ext", name));
    await waitFor(() => WebExtensionPolicy.getByID(addon.id)?.extension);
    return addon;
  }

  const policy = (id) => WebExtensionPolicy.getByID(id);
  const extension = (id) => policy(id)?.extension;
  /** The parent-process browserAction API object (ext-browserAction.js) of one extension. */
  const actionFor = (id) => ExtensionParent.apiManager.global.browserActionFor?.(extension(id));
  /** Per-tab resolved state: { title, badgeText, badgeBackgroundColor, icon, popup, enabled }. */
  const actionData = (id, tab = gBrowser.selectedTab) => actionFor(id)?.action.getContextData(tab);

  /** Extensions report through their action title: "<TAG> {json}". */
  function reported(id, tab = gBrowser.selectedTab) {
    const t = actionData(id, tab)?.title || "";
    const i = t.indexOf("{");
    if (i < 0) return null;
    try { return JSON.parse(t.slice(i)); } catch (e) { return null; }
  }

  /** Navigate the selected tab and wait for the load to settle. Returns what happened. */
  async function nav(url, settle = 1200) {
    const browser = gBrowser.selectedBrowser;
    const before = browser.currentURI.spec;
    let stopStatus = null;
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onStateChange(wp, req, flags, status) {
        if (wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP && flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
          stopStatus = status;
        }
      },
    };
    browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_ALL);
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await waitFor(() => stopStatus !== null, 15000);
    await sleep(settle);
    browser.removeProgressListener(listener);
    const name = (() => {
      if (stopStatus === null) return "no-stop";
      if (stopStatus === 0) return "NS_OK";
      for (const k of Object.keys(Components.results)) if (Components.results[k] === stopStatus) return k;
      return "0x" + (stopStatus >>> 0).toString(16);
    })();
    return { asked: url, before, after: browser.currentURI.spec, documentURI: browser.documentURI?.spec, title: gBrowser.selectedTab.label, status: name };
  }

  /** Dispatch a real-looking mouse click on a chrome element (no OS input). */
  function click(el, opts = {}) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: window.mozInnerScreenX + x, screenY: window.mozInnerScreenY + y, button: opts.button || 0, ...opts };
    el.dispatchEvent(new MouseEvent("mousedown", base));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  }

  function popupShown(popup, ms = 6000) {
    return waitFor(() => popup.state === "open", ms);
  }


  /**
   * A stand-in for Vitre's glass tab bar: favicon circles, the active pill with an accessories
   * slot at its right end, an extensions button and "+". Fixed over the page, top centre.
   */
  function buildBar() {
    css("vitre-bar-css", `
      #vitre-bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10; display: flex; gap: 8px; align-items: center;
        font: 13.5px "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1b1b1f; }
      #vitre-bar .v-glass { background: linear-gradient(rgba(255,255,255,.72), rgba(255,255,255,.52)); backdrop-filter: blur(24px) saturate(1.6);
        box-shadow: 0 0 0 1px rgba(255,255,255,.7) inset, 0 0 0 1px rgba(0,0,0,.08), 0 6px 18px rgba(0,0,0,.16); }
      #vitre-bar .v-circle { width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; font-weight: 600; }
      #vitre-pill { width: 480px; height: 44px; border-radius: 22px; display: flex; align-items: center; padding: 0 8px 0 16px; box-sizing: border-box; gap: 10px; }
      #vitre-pill .v-fav { width: 16px; height: 16px; border-radius: 4px; background: #4cc2ff; flex: none; }
      #vitre-pill .v-domain { flex: 1; text-align: center; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      #vitre-pill .v-accessories { display: flex; align-items: center; gap: 2px; flex: none; }
      #vitre-pill .v-reload { width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex: none; opacity: .7; }
      #vitre-ext-button { -moz-context-properties: fill; fill: currentColor; }
      #vitre-ext-button > img { width: 16px; height: 16px; -moz-context-properties: fill; fill: #1b1b1f; }
    `);
    const h = (tag, attrs = {}, ...kids) => {
      const el = document.createElementNS(HTML, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      for (const k of kids) el.append(k);
      return el;
    };
    const bar = h("div", { id: "vitre-bar" },
      h("div", { class: "v-circle v-glass" }, "F"),
      h("div", { class: "v-circle v-glass" }, "T"),
      h("div", { id: "vitre-pill", class: "v-glass" },
        h("span", { class: "v-fav" }),
        h("span", { class: "v-domain" }, "example.com"),
        h("span", { class: "v-accessories", role: "group", "aria-label": "Extensions" }),
        h("span", { class: "v-reload" }, "⟳")),
      h("div", { id: "vitre-ext-button", class: "v-circle v-glass", role: "button", "aria-label": "Extensions" },
        h("img", { src: "chrome://mozapps/skin/extensions/extension.svg" })),
      h("div", { class: "v-circle v-glass" }, "+"));
    document.body.appendChild(bar);
    const update = () => {
      try { bar.querySelector(".v-domain").textContent = gBrowser.currentURI.host || gBrowser.currentURI.spec; } catch (e) { bar.querySelector(".v-domain").textContent = gBrowser.currentURI.spec; }
    };
    gBrowser.addTabsProgressListener({ onLocationChange: update });
    window.addEventListener("TabSelect", update);
    update();
    return { bar, pill: bar.querySelector("#vitre-pill"), accessories: bar.querySelector(".v-accessories"), extButton: bar.querySelector("#vitre-ext-button"), h };
  }


  /**
   * RECIPE (approach a): Firefox's real extension widgets, re-homed into Vitre's bar.
   *  - pinned actions live in a CustomizableUI toolbar area inside the active pill;
   *  - Firefox's own #unified-extensions-button is moved into the bar as the "rest" button, so the
   *    extensions panel and every add-on doorhanger anchor to it without further patching;
   *  - the post-install "added" doorhanger (AppMenuNotifications) is anchored there as well.
   */
  const AREA = "vitre-ext-bar";
  function installExtensionBar(ui) {
    CustomizableUI.registerArea(AREA, { type: CustomizableUI.TYPE_TOOLBAR, defaultPlacements: [] });
    const toolbar = document.createXULElement("toolbar");
    toolbar.id = AREA;
    toolbar.setAttribute("customizable", "true");
    toolbar.setAttribute("mode", "icons");
    toolbar.setAttribute("context", "toolbar-context-menu");
    toolbar.setAttribute("class", "browser-toolbar chromeclass-toolbar-additional");
    ui.accessories.appendChild(toolbar);
    CustomizableUI.registerToolbarNode(toolbar);

    // Widgets that would land in a hidden Firefox toolbar go to the pill instead.
    const rehome = (id, area) => {
      if (CustomizableUI.isWebExtensionWidget(id) && area !== AREA && area !== CustomizableUI.AREA_ADDONS) {
        CustomizableUI.addWidgetToArea(id, AREA);
      }
    };
    CustomizableUI.addListener({ onWidgetAdded: rehome, onWidgetMoved: rehome });
    for (const area of CustomizableUI.areas) {
      if (area === AREA || area === CustomizableUI.AREA_ADDONS) continue;
      for (const id of CustomizableUI.getWidgetIdsInArea(area)) rehome(id, area);
    }
    // "Pin to toolbar" (panel gear menu, toolbar context menu) means "pin to the pill".
    gUnifiedExtensions.pinToToolbar = (widgetId, pin) =>
      CustomizableUI.addWidgetToArea(widgetId, pin ? AREA : CustomizableUI.AREA_ADDONS, pin ? undefined : 0);

    // The real extensions button, moved out of the hidden nav bar. Its mousedown handler was
    // delegated on #navigator-toolbox, so it needs its own.
    const extBtn = document.getElementById("unified-extensions-button");
    ui.extButton.replaceWith(extBtn);
    extBtn.classList.add("v-circle", "v-glass");
    extBtn.hidden = false;
    extBtn.addEventListener("mousedown", (e) => gUnifiedExtensions.togglePanel(e));
    extBtn.addEventListener("keypress", (e) => gUnifiedExtensions.togglePanel(e));
    ui.extButton = extBtn;

    // AppMenuNotifications ("<name> was added") anchor to the hidden app-menu button by default.
    // _getPanelAnchor is shared with every widget popup, so only the app-menu button is redirected.
    const origAnchor = PanelUI._getPanelAnchor.bind(PanelUI);
    PanelUI._getPanelAnchor = (candidate) =>
      candidate === PanelUI.menuButton ? extBtn.querySelector(".toolbarbutton-icon") || extBtn : origAnchor(candidate);

    css("vitre-ext-bar-css", `
      #vitre-ext-bar { appearance: none; background: none; border: 0; padding: 0; margin: 0; min-height: 0; display: flex; gap: 2px; align-items: center; }
      #vitre-ext-bar .unified-extensions-item { margin: 0; }
      #vitre-ext-bar .unified-extensions-item-action-button { appearance: none; width: 28px; height: 28px; min-width: 0; padding: 0 !important; margin: 0 !important;
        border-radius: 14px; background: transparent; }
      #vitre-ext-bar .unified-extensions-item-action-button > .toolbarbutton-badge-stack { padding: 6px !important; border-radius: 14px; background: transparent !important;
        width: 28px; height: 28px; box-sizing: border-box; }
      #vitre-ext-bar .unified-extensions-item-action-button:hover > .toolbarbutton-badge-stack { background: rgba(0,0,0,.06) !important; }
      #vitre-ext-bar .unified-extensions-item-action-button[open] > .toolbarbutton-badge-stack { background: rgba(0,0,0,.10) !important; }
      #vitre-ext-bar .unified-extensions-item-action-button[disabled] { opacity: .4; }
      #vitre-ext-bar .toolbarbutton-badge { font: 600 9px "Segoe UI", sans-serif !important; min-width: 12px !important; height: 12px; line-height: 12px; padding: 0 3px !important;
        border-radius: 6px !important; margin: -3px -4px 0 0 !important; box-shadow: 0 0 0 1.5px rgba(255,255,255,.9) !important; }
      #vitre-bar #unified-extensions-button { appearance: none; margin: 0; padding: 0; width: 44px; height: 44px; border-radius: 22px; color: #1b1b1f; fill: currentColor;
        list-style-image: url("chrome://mozapps/skin/extensions/extension.svg"); -moz-context-properties: fill; }
      #vitre-bar #unified-extensions-button > .toolbarbutton-icon { width: 16px; height: 16px; padding: 0 !important; background: none !important; border-radius: 0; }
      #vitre-bar #unified-extensions-button > .toolbarbutton-text { display: none; }
      #vitre-bar #unified-extensions-button[open] { box-shadow: 0 0 0 1px rgba(255,255,255,.7) inset, 0 0 0 2px #4cc2ff, 0 6px 18px rgba(0,0,0,.16); }
      /* Firefox toolbar items that make no sense in Vitre. */
      #toolbar-context-menu > :is(#toggle_toolbar-menubar, #toggle_PersonalToolbar, #viewToolbarsMenuSeparator, .viewCustomizeToolbar, #toolbar-context-autohide-downloads-button,
        #toolbar-context-always-show-extensions-button, #toolbar-context-move-to-panel, #toolbar-context-remove-from-toolbar, [id^="toolbar-context-"][id*="tab"]) { display: none !important; }
    `);
    return { area: AREA, toolbar, extBtn };
  }


  /** Close every open XUL panel/menu and wait until they are gone. */
  async function closePopups() {
    for (const p of document.querySelectorAll("panel, menupopup")) {
      if (p.state === "open" || p.state === "showing") { try { p.hidePopup(); } catch (e) {} }
    }
    await waitFor(() => ![...document.querySelectorAll("panel, menupopup")].some((p) => p.state === "open" || p.state === "showing" || p.state === "hiding"), 3000);
    await sleep(250);
  }

  /** Visible entries of a XUL menupopup as plain data. */
  function menuItems(menu) {
    return [...menu.children].filter((c) => !c.hidden && c.getBoundingClientRect().height > 0).map((c) =>
      c.localName === "menuseparator" ? "---" : (c.label || c.getAttribute("label") || c.id) + (c.hasAttribute("checked") ? " [x]" : "") + (c.disabled ? " (disabled)" : "") + (c.localName === "menu" ? " >" : ""));
  }

  function rightClick(el) {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      screenX: window.mozInnerScreenX + r.left + r.width / 2, screenY: window.mozInnerScreenY + r.top + r.height / 2 }));
  }


  /** Synthesize a mouse event at window coordinates; over a tab's <browser> it reaches the page. */
  function mouseAt(type, x, y, button = 0, isAsyncEnabled = false) {
    return window.synthesizeMouseEvent(type, x, y,
      { identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button, buttons: undefined, clickCount: 1, modifiers: 0, inputSource: MouseEvent.MOZ_SOURCE_MOUSE },
      { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled });
  }


  /**
   * PopupNotifications and AppMenuNotifications only open their panels in the active window; in an
   * inactive one the doorhanger waits for the window's "activate" event. Parallel spikes take OS
   * focus away, so doorhanger waits do what that "activate" handler does (PopupNotifications._update).
   * Spike-only: a real user is by definition in the active window.
   */
  function keepActive() {
    if (Services.focus.activeWindow !== window && !PopupNotifications.isPanelOpen) {
      try { PopupNotifications._update(); } catch (e) {}
    }
  }
  function waitActive(fn, ms = 8000) {
    return waitFor(() => { keepActive(); return fn(); }, ms, 250);
  }

  return { buildBar, keepActive, waitActive, mouseAt, closePopups, menuItems, rightClick, installExtensionBar, AREA, AddonManager, ExtensionParent, HTML, root, PORT, sleep, file, hideFirefoxUI, css, waitFor, installTemp, policy, extension, actionFor, actionData, reported, nav, click, popupShown,
    page: (host = "127.0.0.1", path = "/page.html") => `http://${host}:${PORT}${path}` };
})();
