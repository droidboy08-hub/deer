// Helpers for the menus verifier's suites. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
// It mounts the feature's test folder (tests/menus, VITRE_MENUS_FEATURE) as resource://vitre-menus-feature/
// and loads its lib.js (window.M: right-clicks, the keyboard menu, fake services, clipboard...), then
// adds window.V:
//   V.page(leaf)        a verifier page (tests/menus-verify/pages, served at /v/ by all.py)
//   V.slow(ms, leaf)    the same page answered after ms (a slow server)
//   V.section(name, fn) run a block; an exception is a FAIL line and the next block still runs
//   V.errors()          console errors from Vitre's code since load (chrome://vitre/ sources)
//   V.menuNodes()       open menu panels, washes and owners in the DOM
/* global spike, Services, Cc, Ci, ChromeUtils, M */
(() => {
  const feature = Services.env.get("VITRE_MENUS_FEATURE");
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  if (feature && !res.hasSubstitution("vitre-menus-feature")) {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(feature);
    res.setSubstitution("vitre-menus-feature", Services.io.newFileURI(f));
  }
  Services.scriptloader.loadSubScript("resource://vitre-menus-feature/lib.js", window);
})();

window.V = (() => {
  const base = Services.env.get("VITRE_MENUS_BASE") || "";
  const errors = [];
  const listener = {
    observe(msg) {
      try {
        if (!(msg instanceof Ci.nsIScriptError)) return;
        if (msg.flags & (Ci.nsIScriptError.warningFlag | Ci.nsIScriptError.infoFlag)) return;
        const src = String(msg.sourceName || "");
        const text = String(msg.errorMessage || msg.message || "");
        // Deer's messages start "Deer ..." (the console prefix since the rename) or name a Vitre* module.
        if (src.startsWith("chrome://vitre/") || /\b(Deer|Vitre)\b/.test(text)) errors.push({ src: src.replace(/^.*\//, ""), line: msg.lineNumber, text: text.slice(0, 300) });
      } catch {
        /* ignore */
      }
    },
  };
  if (spike.first) {
    Services.console.registerListener(listener);
    window.addEventListener("unload", () => Services.console.unregisterListener(listener));
  }
  return {
    base,
    page: (leaf) => base + "v/" + leaf,
    slow: (ms, leaf) => base + "slow/" + ms + "/" + leaf,
    errors: () => errors.slice(),
    async section(name, fn) {
      spike.log("---- " + name);
      try {
        await fn();
      } catch (e) {
        spike.check(name + ": ran to the end", false, String(e) + " " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""));
      }
      // Leave no menu behind for the next block (nor a Windows system menu of this thread).
      try {
        if (window.vitreMenus?.state().open) window.vitreMenus.api.close();
      } catch {
        /* ignore */
      }
      try {
        const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
        ctypes.open("user32.dll").declare("EndMenu", ctypes.winapi_abi, ctypes.int32_t)();
      } catch {
        /* ignore */
      }
      await spike.sleep(200);
    },
    menuNodes(doc = document) {
      return {
        panels: doc.querySelectorAll(".vt-menus .vt-menu[role=menu]").length,
        allPanels: doc.querySelectorAll(".vt-menus .vt-menu").length,
        washes: doc.querySelectorAll(".vt-menus .vt-wash").length,
        owners: doc.querySelectorAll(".vt-menu-owner").length,
        catcherUp: !!doc.querySelector(".vt-menus .vt-catcher:not([data-off])"),
      };
    },
  };
})();
