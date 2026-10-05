// VERIFIER'S COPY of the spike's VitreStartup.sys.mjs, with extra env-controlled variants:
//   VITRE_SKIP_SETICON=1     no nsIWindowsUIUtils.setWindowIcon (as in the spike)
//   VITRE_SKIP_AUMID=1       no setGroupIdForWindow
//   VITRE_ICON_ATTR=<name>   set the root attribute icon="<name>" before the window is shown, so
//                            Gecko itself loads <runtime>\browser\chrome\icons\default\<name>.ico
//   VITRE_ICON_FROM_EXE=<path>[,index]  use setWindowIconFromExe(win, path, index) instead of a PNG
//   VITRE_LEGACY_BRAND=1     nothing here; the manifest override of brand.properties is always on
// Process-wide startup singleton, imported once by config.js (AutoConfig) before any window exists.
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
const env = (k) => Services.env.get(k);

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
    Services.obs.addObserver(this, "domwindowopened");
    if (!env("VITRE_SKIP_BRAND_FTL")) {
      try {
        L10nRegistry.getInstance().registerSources([
          new L10nFileSource("0-vitre-brand", "app", ["en-US"], "chrome://vitre/content/locales/{locale}/"),
        ]);
        mark("brand.ftl source registered");
      } catch (e) {
        mark("brand.ftl ERROR " + e);
      }
    }
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
      const ui = Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils);
      if (env("VITRE_ICON_ATTR")) {
        // Variant: let Gecko load <name>.ico itself. The attribute must be on the root element
        // before AppWindow syncs attributes to the widget (chrome load), so set it as early as the
        // document exists. Works for every chrome window, not only browser windows.
        const name = env("VITRE_ICON_ATTR");
        const setAttr = () => {
          try {
            const root = win.document?.documentElement;
            if (root && !root.hasAttribute("icon")) {
              root.setAttribute("icon", name);
              mark("icon attr set on " + win.document.documentURI + " readyState=" + win.document.readyState);
            }
          } catch (e) {
            mark("icon attr ERROR " + e);
          }
        };
        win.addEventListener("DOMContentLoaded", setAttr, { once: true, capture: true });
        win.addEventListener("MozBeforeInitialXULLayout", setAttr, { once: true, capture: true });
      } else if (env("VITRE_ICON_FROM_EXE")) {
        const [path, index] = env("VITRE_ICON_FROM_EXE").split(",");
        await null;
        ui.setWindowIconFromExe(win, path, Number(index || 0));
        mark("icon from exe set " + path);
      } else if (!env("VITRE_SKIP_SETICON")) {
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
        ui.setWindowIcon(win, img, img);
        mark("icon set " + (win.document?.documentURI || "window"));
      }
      if (!env("VITRE_SKIP_AUMID")) {
        // Throws NS_ERROR_ILLEGAL_VALUE for windows without a native top-level widget yet; harmless.
        Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(win, AUMID);
      }
    } catch (e) {
      mark("brandWindow ERROR " + e);
    }
  },

  /** Before first paint: styles and root attributes, so Firefox's own UI never flashes. */
  beforeShow(win) {
    const doc = win.document;
    doc.documentElement.setAttribute("vitre", "true");
    if (env("VITRE_ICON_ATTR") && !doc.documentElement.hasAttribute("icon")) {
      doc.documentElement.setAttribute("icon", env("VITRE_ICON_ATTR"));
      mark("icon attr set in before-show");
    }
    const link = doc.createElementNS(HTML, "link");
    link.rel = "stylesheet";
    link.href = "chrome://vitre/skin/vitre.css";
    doc.head.append(link);
    if (env("VITRE_PAINT_PROBE")) {
      // Is the <link> sheet really applied before the first paint? Compare with the synchronous API.
      mark("paint-probe: right after append link.sheet=" + !!link.sheet + " readyState=" + doc.readyState);
      link.addEventListener("load", () => mark("paint-probe: link load event"), { once: true });
      win.windowUtils.loadSheetUsingURIString("chrome://vitre/content/chrome/window.css", win.windowUtils.AUTHOR_SHEET);
      // window.css styles #vitre-probe2 green, vitre.css (the <link>) styles #vitre-probe blue.
      const a = doc.createElementNS(HTML, "div");
      a.id = "vitre-probe2";
      const b = doc.createElementNS(HTML, "div");
      b.id = "vitre-probe-linkcheck";
      b.setAttribute("style", "display:none");
      doc.documentElement.append(a);
      const bg = () => win.getComputedStyle(a).backgroundColor;
      mark("paint-probe: SYNC sheet (windowUtils.loadSheetUsingURIString) applied immediately=" + (bg() === "rgb(48, 209, 88)") + " (" + bg() + ")");
      a.remove();
      let paints = 0;
      const onPaint = () => {
        paints++;
        mark("paint-probe: MozAfterPaint #" + paints + " link.sheet=" + !!link.sheet);
        if (paints >= 2 || link.sheet) win.removeEventListener("MozAfterPaint", onPaint);
      };
      win.addEventListener("MozAfterPaint", onPaint);
      win.requestAnimationFrame(() => mark("paint-probe: first requestAnimationFrame link.sheet=" + !!link.sheet));
    }
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
