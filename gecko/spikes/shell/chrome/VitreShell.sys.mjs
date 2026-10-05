/* Vitre shell: the per-window entry point.
 *
 * One instance for the whole application (system ES module). Firefox 157 calls the three hooks
 * below for EVERY browser window (normal, private, popup, restored) through category entries,
 * see ../chrome.manifest:
 *   browser-window-before-initial-xul-layout -> beforeLayout    (attributes + stylesheet, no flash)
 *   browser-window-domcontentloaded          -> domContentLoaded (gBrowser exists: mount the UI)
 *   browser-window-delayed-startup           -> delayedStartup   (lazy Firefox UI objects exist)
 * `adopt(win)` runs all three for a window that was already open when the manifest was registered.
 */

const SHEET = "chrome://vitre/content/shell.css";
const UI_SCRIPT = "chrome://vitre/content/bar.js";

const t0 = ChromeUtils.now();

export const VitreShell = {
  /** Timeline of hook calls, for the spike: [{ms, hook, window id, state}] */
  timeline: [],
  windows: new Set(),

  note(win, hook, extra = {}) {
    let id = -1;
    try {
      id = win.docShell.outerWindowID;
    } catch (e) {}
    this.timeline.push({ ms: Math.round(ChromeUtils.now() - t0), hook, win: id, ...extra });
  },

  beforeLayout(win) {
    const root = win.document.documentElement;
    if (root.hasAttribute("vitre")) return;
    root.setAttribute("vitre", "true");
    // Synchronous, so the very first layout already has Firefox's interface hidden.
    win.windowUtils.loadSheetUsingURIString(SHEET, win.windowUtils.AUTHOR_SHEET);
    // The hidden native tab strip must never wait for its own CSS transitions.
    win.gReduceMotionOverride = true;
    // No native caption, ever. CustomTitlebar removes the root's customtitlebar attribute when a
    // "condition" disallows it: the browser.tabs.inTitlebar pref ("pref"), and popup windows
    // ("non-popup", set by TabBarVisibility.update on every tab change). Vitre draws its own
    // caption in all of them, so every condition is answered with "allowed".
    {
      const ct = win.CustomTitlebar;
      const allowedBy = ct.allowedBy;
      const popups = this.customTitlebarForPopups;
      ct.allowedBy = function (condition, allow) {
        return allowedBy.call(this, condition, condition === "non-popup" && !popups ? allow : true);
      };
      // CustomTitlebar.init already ran: its category entry (chrome://browser/...) sorts before ours.
      ct.allowedBy("pref", true);
      if (popups) ct.allowedBy("non-popup", true);
    }
    this.note(win, "beforeLayout", {
      popup: !win.toolbar.visible,
      customtitlebar: root.hasAttribute("customtitlebar"),
      readyState: win.document.readyState,
    });
  },

  domContentLoaded(win) {
    if (win.VitreUI?.root) return;
    this.beforeLayout(win);
    Services.scriptloader.loadSubScript(UI_SCRIPT, win);
    win.VitreUI.mount();
    this.spikeFirstPaint(win);
    if (!this.noRoute) this.routeAnchors(win);
    this.windows.add(win);
    win.addEventListener("unload", () => this.windows.delete(win), { once: true });
    this.note(win, "domContentLoaded", {
      tabs: win.gBrowser.tabs.length,
      private: win.PrivateBrowsingUtils.isWindowPrivate(win),
      customtitlebar: win.document.documentElement.hasAttribute("customtitlebar"),
      readyState: win.document.readyState,
    });
  },

  delayedStartup(win) {
    this.note(win, "delayedStartup", { tabs: win.gBrowser.tabs.length });
    // Document focus that lands nowhere is retargeted to #urlbar-input by default; that field is
    // not rendered any more.
    win.document.documentElement.removeAttribute("retargetdocumentfocus");
    // Ctrl+L / Alt+D run the Browser:OpenLocation command, which calls the global
    // openLocation() and would focus the hidden urlbar. Point it at the pill instead.
    win.openLocation = () => win.VitreUI.bar.editAddress();
    // Permission doorhangers: PopupNotifications asks this callback for a visible anchor.
    if (this.noRoute) return;
    try {
      win.PopupNotifications._getVisibleAnchorElement = () => win.VitreUI.anchor("site");
    } catch (e) {
      this.note(win, "PopupNotifications hook failed", { error: String(e) });
    }
  },

  /** Spike only (VITRE_EARLY=1): record the state at this window's first paint and ask the harness
   * for a screenshot right then, to show that Firefox's own interface is never painted. */
  spikeFirstPaint(win) {
    const logPath = Services.env.get("VITRE_LOG");
    if (!Services.env.get("VITRE_EARLY") || !logPath) return;
    const first = !this.firstPaintSeen;
    this.firstPaintSeen = true;
    win.addEventListener(
      "MozAfterPaint",
      () => {
        const d = win.document;
        this.note(win, "firstPaint", {
          navBar: win.getComputedStyle(d.getElementById("nav-bar")).display,
          tabsToolbar: win.getComputedStyle(d.getElementById("TabsToolbar")).display,
          toolboxHeight: d.getElementById("navigator-toolbox").getBoundingClientRect().height,
          vitreBarItems: win.VitreUI?.bar?.items.size,
        });
        if (!first) return;
        try {
          const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          file.initWithPath(logPath);
          const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
          s.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
          const line = "@@capture early-first-paint" + String.fromCharCode(10);
          s.write(line, line.length);
          s.close();
        } catch (e) {}
      },
      { once: true }
    );
  },

  /** For a window that already finished starting (the spike harness boots late). */
  adopt(win) {
    this.beforeLayout(win);
    this.domContentLoaded(win);
    this.delayedStartup(win);
  },

  /** Spike switch: leave Firefox's anchors alone, to record what happens without the router. */
  noRoute: false,

  /** Force the custom (caption-less) title bar on popup windows as well. */
  customTitlebarForPopups: true,

  /**
   * Firefox opens its panels with popup.openPopup(anchor, ...) where the anchor is a button in a
   * toolbar that is no longer rendered. One choke point: when the anchor has no box, hang the
   * panel from Vitre's own element instead (the active pill, or the + circle for the app menu).
   */
  routeAnchors(win) {
    const proto = win.XULPopupElement.prototype;
    if (proto.vitreRouted) return;
    const openPopup = proto.openPopup;
    const shell = this;
    proto.vitreRouted = true;
    proto.openPopup = function (anchor, options, x, y, isContextMenu, attributesOverride, triggerEvent) {
      let to = null;
      try {
        to = shell.route(win, this, anchor);
      } catch (e) {
        shell.routed.push({ popup: this.id, error: String(e) });
      }
      if (!to) return openPopup.apply(this, arguments);
      const o = options && typeof options === "object" ? options : { isContextMenu, attributesOverride, triggerEvent };
      return openPopup.call(this, to.anchor, {
        position: to.position,
        x: to.x,
        y: to.y,
        isContextMenu: !!o.isContextMenu,
        attributesOverride: !!o.attributesOverride,
        triggerEvent: o.triggerEvent || null,
      });
    };
  },

  /** Decide where a popup hangs. Returns null to leave Firefox's own anchor alone. */
  route(win, popup, anchor) {
    const ui = win.VitreUI;
    if (!ui?.root) return null;
    const isElement = anchor && anchor.nodeType === 1;
    const doorhanger = popup.id === "notification-popup";
    // PopupNotifications already got Vitre's element from _getVisibleAnchorElement, but passes its
    // own alignment; popups that Vitre code anchors to its own elements are left alone.
    const ours = isElement && ui.root.contains(anchor) && doorhanger;
    const hidden = isElement && !ui.root.contains(anchor) && anchor.isConnected && anchor.getClientRects().length === 0;
    const orphan = !anchor && doorhanger;
    if (!ours && !hidden && !orphan) return null;
    const menu = popup.id === "appMenu-popup";
    // Tab bar surfaces hang 8px under the bar (y 64): site panels left-aligned to the pill, the
    // application menu right-aligned to the + circle.
    const to = { anchor: ui.anchor(menu ? "menu" : "site"), position: menu ? "bottomright topright" : "bottomleft topleft", x: 0, y: 8 };
    this.routed.push({ popup: popup.id, from: ours ? "(vitre)" : anchor?.id || anchor?.localName || null, to: to.anchor?.className || to.anchor?.id || null, position: to.position });
    return to.anchor ? to : null;
  },
  routed: [],
};
