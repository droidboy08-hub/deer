// Helpers for the extensions tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// then use window.xt. Extensions come from tests/extensions/build (make-extensions.py); the test
// site is http://127.0.0.1:47651 (serve.py, started by runx.py).
/* global Services, Cc, Ci, ChromeUtils, PathUtils, gBrowser, spike, CustomizableUI, WebExtensionPolicy */
window.xt = (() => {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const HERE = PathUtils.parent(Services.env.get("VITRE_BOOT"));
  const SITE = "http://127.0.0.1:47651";
  const AREA = "vitre-ext-bar";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = () => window.vitre;

  const file = (...parts) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(PathUtils.join(HERE, ...parts));
    return f;
  };
  const extPath = (name) => PathUtils.join(HERE, "build", "ext", name);
  const id = (name) => name + "@vitre.test";
  /** CustomizableUI widget id of an extension's browser action (makeWidgetId + "-browser-action"). */
  const widgetId = (name) => id(name).toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";

  async function waitFor(fn, ms = 8000, step = 100) {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try {
        v = await fn();
      } catch (e) {
        v = null;
      }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  /** Temporary add-on from build/ext/<name> (what "Load temporary add-on" does, without remembering it). */
  async function install(name) {
    const addon = await AddonManager.installTemporaryAddon(file("build", "ext", name));
    await waitFor(() => WebExtensionPolicy.getByID(addon.id)?.extension);
    return addon;
  }

  const extension = (name) => WebExtensionPolicy.getByID(id(name))?.extension;
  const actionFor = (name) => ExtensionParent.apiManager.global.browserActionFor?.(extension(name));
  const actionData = (name, tab = gBrowser.selectedTab) => actionFor(name)?.action.getContextData(tab);
  const pageActionFor = (name) => ExtensionParent.apiManager.global.pageActionFor?.(extension(name));
  function reported(name, tab = gBrowser.selectedTab) {
    const t = actionData(name, tab)?.title || "";
    const i = t.indexOf("{");
    if (i < 0) return null;
    try {
      return JSON.parse(t.slice(i));
    } catch (e) {
      return null;
    }
  }

  /** This window's widget node / action button of an extension. */
  const node = (name) => document.getElementById(widgetId(name));
  const button = (name) => node(name)?.querySelector(".unified-extensions-item-action-button");
  const toolbar = () => document.getElementById(AREA);
  const cluster = () => document.querySelector("#vitre-root .vx-cluster");
  const extButton = () => document.getElementById("unified-extensions-button");
  const area = (name) => CustomizableUI.getPlacementOfWidget(widgetId(name))?.area ?? null;
  const pinnedInPill = () => [...(toolbar()?.children ?? [])].map((n) => n.id);
  const visibleInPill = () => [...(toolbar()?.children ?? [])].filter((n) => n.getClientRects().length && !n.classList.contains("vx-overflow")).map((n) => n.id);

  /** Load a URL in the selected tab and wait for it. */
  async function nav(url, settle = 600) {
    const browser = gBrowser.selectedBrowser;
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await waitFor(() => browser.currentURI.spec === url && !browser.webProgress?.isLoadingDocument, 15000);
    await sleep(settle);
  }

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
  };

  /** Close every open XUL panel or menu and wait until they are gone. */
  async function closePopups() {
    for (const p of document.querySelectorAll("panel, menupopup")) {
      if (p.state === "open" || p.state === "showing") {
        try {
          p.hidePopup();
        } catch (e) {}
      }
    }
    await waitFor(() => ![...document.querySelectorAll("panel, menupopup")].some((p) => p.state === "open" || p.state === "showing" || p.state === "hiding"), 3000);
    await sleep(250);
  }

  /** The open widget (extension popup) panel, if any. */
  const widgetPanel = () => {
    const p = document.getElementById("customizationui-widget-panel");
    return p && p.state === "open" ? p : null;
  };

  /**
   * Keys through Gecko's real key pipeline (nsITextInputProcessor: trusted widget-level events,
   * the path a physical key takes), so XUL <key> elements of extension commands react
   * (spikes/extensions/RESULT.md verifier, claim 6).
   */
  function realKey(spec) {
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    tip.beginInputTransactionForTests(window);
    const parts = spec.split("+");
    const key = parts.pop();
    const mods = parts.map((m) =>
      m === "Ctrl"
        ? new KeyboardEvent("", { key: "Control", code: "ControlLeft", keyCode: KeyboardEvent.DOM_VK_CONTROL })
        : m === "Shift"
          ? new KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: KeyboardEvent.DOM_VK_SHIFT })
          : new KeyboardEvent("", { key: "Alt", code: "AltLeft", keyCode: KeyboardEvent.DOM_VK_ALT })
    );
    const k = new KeyboardEvent("", { key: key.toUpperCase(), code: "Key" + key.toUpperCase(), keyCode: KeyboardEvent["DOM_VK_" + key.toUpperCase()] });
    for (const m of mods) tip.keydown(m, tip.KEY_NON_PRINTABLE_KEY);
    tip.keydown(k);
    tip.keyup(k);
    for (const m of mods.reverse()) tip.keyup(m, tip.KEY_NON_PRINTABLE_KEY);
  }

  /** PopupNotifications / AppMenuNotifications open only in the active window: do what its "activate" handler does. */
  function keepActive() {
    if (Services.focus.activeWindow !== window && !PopupNotifications.isPanelOpen) {
      try {
        PopupNotifications._update();
      } catch (e) {}
    }
  }

  /**
   * The download mark shares the right end of the pill with the extensions. When the downloads
   * module has not drawn one, a stand-in ring shows where it goes (captures only). Returns undo.
   */
  function showDownloadMark() {
    const mark = b().bar.downloadMark();
    if (!mark || !mark.classList.contains("empty")) return () => {};
    mark.classList.remove("empty");
    const svgNS = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(svgNS, "svg");
    s.setAttribute("width", "18");
    s.setAttribute("height", "18");
    s.setAttribute("viewBox", "0 0 20 20");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.6");
    s.setAttribute("stroke-linecap", "round");
    for (const d of ["M10 5.5v7M7.2 10 10 12.8 12.8 10", "M6.5 15.5h7"]) {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", d);
      s.append(p);
    }
    mark.append(s);
    mark.dataset.standIn = "1";
    return () => {
      s.remove();
      mark.classList.add("empty");
      delete mark.dataset.standIn;
    };
  }

  return {
    AddonManager, ExtensionParent, HERE, SITE, AREA, sleep, file, extPath, id, widgetId, waitFor, install, extension, actionFor, actionData, pageActionFor, reported,
    node, button, toolbar, cluster, extButton, area, pinnedInPill, visibleInPill, nav, rect, closePopups, widgetPanel, realKey, keepActive, showDownloadMark,
    page: (path = "/page.html") => SITE + path,
  };
})();
