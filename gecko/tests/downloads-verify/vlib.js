// Helpers for the downloader verifier's scripts (tests/downloads-verify/*.js). Loads the builder's
// helpers first (tests/downloads/lib.js, copied next to this file as _dl-lib.js by all.py), so
// window.DL is there too; adds window.V:
//   V.errors()            Vitre's console errors and warnings since the script started (Services.console)
//   V.cpuMs()             CPU time of the parent process so far (ChromeUtils.requestProcInfo), in ms
//   V.focus()             a short description of what has keyboard focus in this window
//   V.key(spec)           spike.press after making sure the window is active
//   V.until(fn, what, ms) spike.waitFor with a name
//   V.capture(name)       spike.capture
//   V.within(el)          document.activeElement is el or inside it
/* global spike, Services, ChromeUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/_dl-lib.js", window);

window.V = (() => {
  const errors = [];
  const started = Date.now();
  const listener = {
    observe(msg) {
      try {
        const e = msg.QueryInterface(Ci.nsIScriptError);
        const src = String(e.sourceName || "");
        const text = String(e.errorMessage || "");
        const warning = !!(e.flags & Ci.nsIScriptError.warningFlag);
        if (/chrome:\/\/vitre\//.test(src) || /(Deer|Vitre) downloads/.test(text)) errors.push({ warning, text: text.slice(0, 300), src: src.split("/").pop() + ":" + e.lineNumber });
      } catch {
        const text = String(msg.message || "");
        if (/(Deer|Vitre) downloads/.test(text)) errors.push({ warning: false, text: text.slice(0, 300), src: "console" });
      }
    },
  };
  Services.console.registerListener(listener);
  window.addEventListener("unload", () => Services.console.unregisterListener(listener));

  return {
    started,
    errors(opts = {}) {
      return errors.filter((e) => opts.warnings || !e.warning);
    },
    async cpuMs() {
      const info = await ChromeUtils.requestProcInfo();
      return Number(info.cpuTime) / 1e6;
    },
    focus() {
      const a = document.activeElement;
      if (!a) return "none";
      if (a.localName === "browser") return "page";
      return `${a.localName}.${String(a.className || "").replace(/\s+/g, ".")}${a.getAttribute?.("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}`;
    },
    within(el) {
      const a = document.activeElement;
      return !!el && !!a && (a === el || el.contains(a));
    },
    async key(spec, opts) {
      await spike.activate();
      spike.press(spec, opts);
    },
    until(fn, what, timeout = 8000) {
      return spike.waitFor(fn, { timeout, what });
    },
    capture(name) {
      return spike.capture(name);
    },
  };
})();
