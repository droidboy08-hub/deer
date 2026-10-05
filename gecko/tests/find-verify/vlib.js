// Helpers for the find verification scripts (tests/find-verify/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
// It mounts tests/find as resource://vitre-find-tests/ and loads its flib.js (window.FL), then adds
// window.V: console error capture, page probes run in the content process, GC helpers and pages.
/* global spike, Services, Cc, Ci, Cu, gBrowser, FL */
(() => {
  const pagesDir = Services.env.get("FIND_PAGES");
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  if (!res.hasSubstitution("vitre-find-tests")) {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(pagesDir);
    res.setSubstitution("vitre-find-tests", Services.io.newFileURI(f.parent));
  }
  Services.scriptloader.loadSubScript("resource://vitre-find-tests/flib.js", window);
})();

window.V = (() => {
  const b = window.vitre;
  const { sleep } = spike;
  const port = Services.env.get("FIND_PORT");
  const errors = [];
  const listener = {
    observe(m) {
      try {
        if (!(m instanceof Ci.nsIScriptError)) return;
        if (m.flags & (Ci.nsIScriptError.warningFlag | Ci.nsIScriptError.infoFlag)) return;
        const text = `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`;
        // Vitre's own code, and anything that names find or the finder.
        if (/chrome:\/\/vitre|vitre-find|VitrePage|Finder|findbar|find/i.test(text)) errors.push(text.slice(0, 400));
      } catch {
        /* ignore */
      }
    },
  };
  Services.console.registerListener(listener);
  window.addEventListener("unload", () => Services.console.unregisterListener(listener));

  /** Console errors seen since the last call (Vitre's code, the finder). */
  function takeErrors() {
    return errors.splice(0);
  }

  /** The number of ranges in the top document's find selection (Gecko's highlight-all). */
  const findRanges = (browser) =>
    FL.inPage(
      "function (w, d) { try { const sc = docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay).QueryInterface(Ci.nsISelectionController); return sc.getSelection(Ci.nsISelectionController.SELECTION_FIND).rangeCount; } catch (e) { return 'ERR ' + e; } }",
      browser
    );

  /** The window rect (window CSS px) of the n-th occurrence (0-based) of `text` in the top document's text, or null. */
  async function textRect(text, n = 0, browser = gBrowser.selectedBrowser) {
    const r = await FL.inPage(
      "function (w, d) { const want = " + JSON.stringify(text) + "; let k = " + n + "; const tw = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); let node; while ((node = tw.nextNode())) { let i = -1; while ((i = node.data.indexOf(want, i + 1)) >= 0) { if (k-- === 0) { const r = d.createRange(); r.setStart(node, i); r.setEnd(node, i + want.length); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } } } return null; }",
      browser
    );
    if (!r) return null;
    const box = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    return { x: box.x + r.x * z, y: box.y + r.y * z, w: r.w * z, h: r.h * z };
  }

  /** The page's selection (the active match) in window coordinates, top document only. */
  async function selectionRect(browser = gBrowser.selectedBrowser) {
    const r = await FL.inPage("function (w, d) { const s = w.getSelection(); if (!s.rangeCount || s.isCollapsed) return null; const b = s.getRangeAt(0).getBoundingClientRect(); return { t: String(s), x: b.x, y: b.y, w: b.width, h: b.height }; }", browser);
    if (!r) return null;
    const box = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    return { t: r.t, x: box.x + r.x * z, y: box.y + r.y * z, w: r.w * z, h: r.h * z };
  }

  async function gc() {
    for (let i = 0; i < 6; i++) {
      Cu.forceGC();
      Cu.forceCC();
      window.windowUtils.garbageCollect();
      await sleep(150);
    }
  }

  const http = (leaf, host = "127.0.0.1") => `http://${host}:${port}/${leaf}`;

  /** Classes that must be gone once find is closed and its morph has finished. */
  function residue() {
    const left = ["find-face", "find-focused", "find-own", "find-in-peek"].filter((c) => b.root.classList.contains(c));
    if (document.documentElement.hasAttribute("vitre-find-in-peek")) left.push(":root[vitre-find-in-peek]");
    if (!FL.face().hidden) left.push("face shown");
    if (!FL.capsule().hidden) left.push("capsule shown");
    return left;
  }

  /** Whether the active pill's own face is visible (not hidden by find). */
  function pillFaceVisible(tab = b.active()) {
    const face = b.bar.item(tab.id)?.querySelector(".pill-face");
    return !!face && getComputedStyle(face).visibility !== "hidden";
  }

  return { takeErrors, findRanges, textRect, selectionRect, gc, http, residue, pillFaceVisible };
})();
