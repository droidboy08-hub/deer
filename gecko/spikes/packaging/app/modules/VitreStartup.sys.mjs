// Process-wide startup singleton, imported once by config.js (AutoConfig) before any window exists.
// It registers actors and hooks every browser window. All Vitre code is reached from here.
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  VitreProbe: "chrome://vitre/content/modules/VitreProbe.sys.mjs",
});

const HTML = "http://www.w3.org/1999/xhtml";
let inited = false;
let windowCount = 0;
const timeline = [];
const AUMID = "Vitre.Browser.PackagingSpike";
let icon = null;
const mark = (what) => timeline.push([what, Math.round(Services.telemetry.msSinceProcessStart())]);

export const VitreStartup = {
  options: null,
  timeline,

  init(options = {}) {
    if (inited) return;
    inited = true;
    this.options = options;
    mark("init (config.js)");
    Services.obs.addObserver(this, "browser-window-before-show");
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.obs.addObserver(this, "final-ui-startup");
    Services.obs.addObserver(this, "profile-after-change");
    // Branding for EVERY top-level window (dialogs, About, Library...), not only browser windows.
    if (!Services.env.get("VITRE_SKIP_SETICON")) Services.obs.addObserver(this, "domwindowopened");
    // Brand strings: an extra Fluent source that only carries branding/brand.ftl. Registered before
    // any window exists, so "Mozilla Firefox" never appears in titles, menus, dialogs or settings.
    if (!Services.env.get("VITRE_SKIP_BRAND_FTL")) {
      try {
        L10nRegistry.getInstance().registerSources([
          new L10nFileSource("0-vitre-brand", "app", ["en-US"], "chrome://vitre/content/locales/{locale}/"),
        ]);
        mark("brand.ftl source registered");
      } catch (e) {
        mark("brand.ftl ERROR " + e);
      }
    }
    // Actors can be registered this early; child modules load lazily in content processes.
    ChromeUtils.registerWindowActor("VitreProbe", {
      parent: { esModuleURI: "chrome://vitre/content/actors/VitreProbeParent.sys.mjs" },
      child: {
        esModuleURI: "chrome://vitre/content/actors/VitreProbeChild.sys.mjs",
        events: { DOMContentLoaded: {} },
      },
      matches: ["http://*/*", "https://*/*"],
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    });
  },

  observe(subject, topic) {
    mark(topic);
    if (topic === "domwindowopened") this.brandWindow(subject);
    else if (topic === "browser-window-before-show") this.beforeShow(subject);
    else if (topic === "browser-delayed-startup-finished") this.started(subject);
  },

  /** Window icon + taskbar group (AppUserModelID) for any new top-level window. */
  async brandWindow(win) {
    try {
      if (!icon) {
        const uri = Services.io.newURI("chrome://vitre/skin/icon256.png");
        const channel = Services.io.newChannelFromURI(
          uri,
          null,
          Services.scriptSecurityManager.getSystemPrincipal(),
          null,
          Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
          Ci.nsIContentPolicy.TYPE_IMAGE
        );
        icon = ChromeUtils.fetchDecodedImage(uri, channel);
      }
      const img = await icon;
      if (win.closed) return;
      Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils).setWindowIcon(win, img, img);
      mark("icon set " + (win.document?.documentURI || "window"));
      // Throws NS_ERROR_ILLEGAL_VALUE for windows without a native top-level widget yet; harmless.
      Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(win, AUMID);
    } catch (e) {
      mark("brandWindow ERROR " + e);
    }
  },

  /** Before first paint: styles and root attributes, so Firefox's own UI never flashes. */
  beforeShow(win) {
    const doc = win.document;
    doc.documentElement.setAttribute("vitre", "true");
    const link = doc.createElementNS(HTML, "link");
    link.rel = "stylesheet";
    link.href = "chrome://vitre/skin/vitre.css";
    doc.head.append(link);
  },

  /** After Firefox finished starting the window: load the per-window UI. */
  started(win) {
    const n = ++windowCount;
    try {
      Services.scriptloader.loadSubScript("chrome://vitre/content/chrome/window.js", win);
      const badge = win.document.createElementNS(HTML, "div");
      badge.id = "vitre-probe";
      badge.textContent = "Vitre layer loaded by config.js (no VITRE_BOOT) · window " + n;
      win.document.body.append(badge);
      win.VitreWindowProbe.windowNumber = n;
    } catch (e) {
      console.error("Vitre window init failed", e);
    }
  },
};
