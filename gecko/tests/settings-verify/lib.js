// Helpers for the Settings verifier's tests (tests/settings-verify/*.js). Load in the first window:
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.V:
//   V.consoleStart() / V.consoleCheck(label)   collect every console error from now on; the check
//                                              fails on any error whose source, message or stack names
//                                              chrome://vitre/ (Vitre's own code), and logs the rest
//   V.press(spec, extra, win)                  a key chord in-process (EventUtils), any window
//   V.page(title, body, bg) / V.load(url)      a data: page; navigate the active tab and wait
//   V.inPage(fn)                               run fn(content, document) in the active page's process
//   V.gc()                                     force GC + CC a few times
//   V.panel(win) / V.sheet(win) / V.page_(win) the Settings panel instance, its sheet, the page id shown
//   V.focusInSheet(win)                        focus is inside the sheet
//   V.rect(el)                                 rounded client rect
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
window.V = (() => {
  const { sleep, log, check } = spike;
  const b = window.vitre;
  const shared = (() => {
    const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
    if (!g.__vitreSettingsVerify) g.__vitreSettingsVerify = { errors: [], started: false };
    return g.__vitreSettingsVerify;
  })();
  const OURS = /chrome:\/\/vitre\/|resource:\/\/vitre-/;

  function consoleStart() {
    if (shared.started) return;
    shared.started = true;
    const add = (kind, message, source, line, stack) => shared.errors.push({ kind, message: String(message), source: String(source || ""), line: line || 0, stack: String(stack || "") });
    const take = (m) => {
      try {
        if (!(m instanceof Ci.nsIScriptError) || m.flags & Ci.nsIScriptError.warningFlag) return;
        let stack = "";
        try {
          let f = m.stack;
          for (let i = 0; f && i < 8; i++, f = f.parent) stack += `\n      at ${f.functionDisplayName || "?"} ${f.source}:${f.line}`;
        } catch (e) {}
        add("script", m.errorMessage, m.sourceName, m.lineNumber, stack);
      } catch (e) {}
    };
    try {
      for (const m of Services.console.getMessageArray()) take(m);
    } catch (e) {}
    Services.console.registerListener({ observe: take, QueryInterface: ChromeUtils.generateQI(["nsIConsoleListener"]) });
    Services.obs.addObserver((subject) => {
      try {
        const ev = subject.wrappedJSObject;
        if (ev.level !== "error") return;
        const text = Array.from(ev.arguments || [], (a) => (a && typeof a === "object" && "message" in a ? `${a}\n${a.stack || ""}` : String(a))).join(" ");
        add("console.error", text, ev.filename, ev.lineNumber, "");
      } catch (e) {}
    }, "console-api-log-event");
  }

  let seen = 0;
  /** Fails on errors from Vitre's code since the last check; Firefox's own are only logged. */
  function consoleCheck(label = "", allow = null) {
    const fresh = shared.errors.slice(seen);
    seen = shared.errors.length;
    const ours = [];
    for (const e of fresh) {
      const mine = OURS.test(e.source) || OURS.test(e.message) || OURS.test(e.stack);
      if (mine && !(allow && allow.test(e.message))) ours.push(`${e.message.slice(0, 300)} @ ${e.source}:${e.line}${e.stack.slice(0, 400)}`);
      else log(`console[firefox] ${label}: ${e.message.slice(0, 200)} @ ${e.source}:${e.line}`);
    }
    return check(`no console errors from Vitre's code${label ? " (" + label + ")" : ""}`, ours.length === 0, ours);
  }

  const NAMED = {
    Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete",
    Backspace: "KEY_Backspace", Home: "KEY_Home", End: "KEY_End", PageUp: "KEY_PageUp", PageDown: "KEY_PageDown",
    Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight", Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Space: " ",
    Comma: ",", Plus: "+", Minus: "-", Equal: "=",
  };
  for (let i = 1; i <= 12; i++) NAMED["F" + i] = "KEY_F" + i;
  function press(spec, extra = {}, win = window) {
    const parts = spec.split("+");
    let key = parts.pop();
    if (key === "" && spec.endsWith("+")) key = "+";
    const opts = { ctrlKey: parts.includes("Ctrl"), shiftKey: parts.includes("Shift"), altKey: parts.includes("Alt") };
    if (NAMED[key]) key = NAMED[key];
    else if (/^[A-Za-z]$/.test(key)) key = opts.shiftKey ? key.toUpperCase() : key.toLowerCase();
    (win === window ? spike.EU : win.spike.EU).synthesizeKey(key, Object.assign(opts, extra), win);
  }

  const page = (title, body = "", bg = "#f3eee4", fg = "#2b2722") =>
    "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style='margin:0;background:${bg};color:${fg};font:17px/1.6 Segoe UI'>${body || `<p style='margin:120px 40px'>${title}</p>`}`);

  async function load(url, win = window) {
    const v = win.vitre;
    const tab = v.active();
    v.navigate(tab, url);
    for (let i = 0; i < 200; i++) {
      await sleep(50);
      if (!tab.loading && tab.url === url) break;
    }
    await sleep(300);
  }

  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "V:r" + Math.random();
      const on = (m) => {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } Promise.resolve(r).then((v) => sendAsyncMessage(" + JSON.stringify(id) + ", v), (e) => sendAsyncMessage(" + JSON.stringify(id) + ", 'ERR ' + e)); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  async function gc() {
    for (let i = 0; i < 4; i++) {
      Cu.forceGC();
      Cu.forceCC();
      await sleep(150);
    }
    Cu.forceShrinkingGC();
    await new Promise((r) => Cu.schedulePreciseShrinkingGC(r));
    Cu.forceCC();
    await sleep(100);
  }

  const panel = (win = window) => win.vitreSettingsPanel.panel;
  const root = (win = window) => win.document.getElementById("vitre-settings");
  const sheet = (win = window) => root(win)?.querySelector(".vs-sheet");
  const content = (win = window) => root(win)?.querySelector(".vs-content");
  const shown = (win = window) => content(win)?.dataset.page;
  const isOpen = (win = window) => panel(win).isOpen && !root(win).hidden;
  const focusInSheet = (win = window) => !!sheet(win) && sheet(win).contains(win.document.activeElement);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  /** The row whose title is `title` on the page shown. */
  const rowFor = (title, win = window) => [...content(win).querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === title);
  const active = (win = window) => win.document.activeElement;
  const describe = (el) => (el ? `${el.localName}${el.className ? "." + String(el.className).replace(/\s+/g, ".") : ""}${el.dataset?.id ? "#" + el.dataset.id : ""}${el.textContent && el.textContent.length < 40 ? " '" + el.textContent + "'" : ""}` : "null");

  return { consoleStart, consoleCheck, press, page, load, inPage, gc, panel, root, sheet, content, shown, isOpen, focusInSheet, rect, rowFor, active, describe, b };
})();
