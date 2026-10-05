// Helpers for the extensions verifier's scripts. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
// It loads the builder's tests/extensions/lib.js (window.xt: install, nav, rect, realKey...) with its
// paths pointing at tests/extensions, then adds window.vx:
//   vx.install(name)        a temporary add-on from tests/extensions-verify/build/ext (make-more.py)
//   vx.errors()             console errors raised by Vitre's code since the script started
//                           (nsIConsoleListener), vx.extErrors() the ones from the extensions module
//   vx.menuRows()           capture the rows the 'menus' service is asked to show (returns a reader)
//   vx.rightClick(el, kbd)  dispatch a contextmenu event on an element (kbd: as Shift+F10 does)
//   vx.gc()                 force GC + CC a few rounds (leak checks)
/* global Services, Cc, Ci, Cu, ChromeUtils, PathUtils */
(() => {
  const boot = Services.env.get("VITRE_BOOT");
  const here = PathUtils.parent(boot);
  const xtDir = PathUtils.join(PathUtils.parent(here), "extensions");
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(xtDir);
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  res.setSubstitution("vitre-xt", Services.io.newFileURI(dir));
  // lib.js finds its extensions next to VITRE_BOOT: point it at tests/extensions while it loads.
  Services.env.set("VITRE_BOOT", PathUtils.join(xtDir, "lib.js"));
  try {
    Services.scriptloader.loadSubScript("resource://vitre-xt/lib.js?" + Date.now(), window);
  } finally {
    Services.env.set("VITRE_BOOT", boot);
  }

  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const errors = [];
  const started = Date.now();
  const listener = {
    QueryInterface: ChromeUtils.generateQI(["nsIConsoleListener"]),
    observe(m) {
      try {
        if (!(m instanceof Ci.nsIScriptError)) return;
        if (m.flags & Ci.nsIScriptError.warningFlag || m.flags & Ci.nsIScriptError.infoFlag) return;
        const src = String(m.sourceName || "");
        const stack = m.stack ? String(m.stack) : "";
        const text = String(m.errorMessage || m.message || "");
        if (!/chrome:\/\/vitre\//.test(src + " " + stack) && !/Deer|Vitre/.test(text)) return;
        errors.push({ text, src, line: m.lineNumber, stack: stack.slice(0, 600), at: Date.now() - started });
      } catch (e) {}
    },
  };
  if (!window.__vxListening) {
    window.__vxListening = true;
    Services.console.registerListener(listener);
    window.addEventListener("unload", () => Services.console.unregisterListener(listener));
  }
  const EXT = /(Deer|Vitre) extensions|VitreExtensions|vx-|ExtBar|PageActions|ExtMenus|ExtensionsPage|modules\/extensions/;

  window.vx = {
    here,
    errors: () => errors.slice(),
    extErrors: () => errors.filter((e) => EXT.test(e.text + " " + e.stack)),
    id: (name) => name + "@vitre.verify",
    widgetId: (name) => (name + "@vitre.verify").toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action",
    async install(name) {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(PathUtils.join(here, "build", "ext", name));
      const addon = await AddonManager.installTemporaryAddon(f);
      await window.xt.waitFor(() => globalThis.WebExtensionPolicy.getByID(addon.id)?.extension);
      return addon;
    },
    /** Capture the rows of the next menus.show(); returns { rows(), labels(), undo() }. */
    menuRows(b = window.vitre) {
      const menus = b.service("menus");
      let rows = null;
      let opts = null;
      if (!menus) return { rows: () => null, labels: () => [], opts: () => null, reset() {}, undo() {} };
      const show = menus.show;
      menus.show = function (items, at, o) {
        rows = items;
        opts = o;
        return show.call(this, items, at, o);
      };
      const label = (r) => ("separator" in r ? "---" : "caption" in r ? "[" + r.caption + "]" : r.label);
      return {
        rows: () => rows,
        opts: () => opts,
        labels: () => (rows || []).map(label),
        reset() {
          rows = null;
          opts = null;
        },
        undo() {
          menus.show = show;
        },
      };
    },
    rightClick(el, keyboard = false) {
      const r = el.getBoundingClientRect();
      const x = keyboard ? 0 : r.left + r.width / 2;
      const y = keyboard ? 0 : r.top + r.height / 2;
      // Gecko sends the keyboard's contextmenu (Shift+F10, the Menu key) with button 0 (the menus
      // module tells the two apart that way).
      el.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, view: window, button: keyboard ? 0 : 2, clientX: x, clientY: y,
        screenX: keyboard ? 0 : window.mozInnerScreenX + x, screenY: keyboard ? 0 : window.mozInnerScreenY + y,
      }));
    },
    async gc(rounds = 4) {
      for (let i = 0; i < rounds; i++) {
        Cu.forceGC();
        Cu.forceCC();
        Cu.forceShrinkingGC();
        await new Promise((r) => setTimeout(r, 250));
      }
    },
    /** Any open XUL panel / menupopup ids. */
    openPopups(win = window) {
      return [...win.document.querySelectorAll("panel, menupopup")].filter((p) => p.state === "open" || p.state === "showing").map((p) => p.id || p.localName);
    },
    focused(win = window) {
      const a = win.document.activeElement;
      if (!a) return "";
      return (a.id || "") + "." + String(a.className || "").split(" ").slice(0, 2).join(".");
    },
  };
})();
