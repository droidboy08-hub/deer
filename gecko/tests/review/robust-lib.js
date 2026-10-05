// Helpers for the robustness review scripts (tests/review/robust-*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
// Gives window.R. Only the first window should load it (spike.main bodies run there).
//
//   R.consoleStart()            collect every error that reaches the browser console from now on
//                               (script errors through Services.console, console.error through the
//                               console-api-log-event topic), plus what was logged before the hook.
//   R.consoleDump(label)        log each distinct error once as "CONSOLE[vitre|firefox] ..." and
//                               return { vitre, firefox } counts. "vitre" = the source, the message or
//                               the stack names chrome://vitre/.
//   R.page(title, body, bg)     a data: page; R.load(url, tab?) navigate and wait for the load
//   R.inPage(fn, browser?)      run fn(content, document) in the page's process, resolve with result
//   R.consistent(win?)          compare b.tabs, gBrowser and the bar's DOM; returns a list of problems
//   R.gc()                      force GC + CC a few times
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
window.R = (() => {
  const { sleep, waitFor, log } = spike;
  const b = window.vitre;
  const shared = (() => {
    const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
    if (!g.__vitreReview) g.__vitreReview = { errors: [], started: false };
    return g.__vitreReview;
  })();

  const OURS = /chrome:\/\/vitre\//;
  function consoleStart() {
    if (shared.started) return;
    shared.started = true;
    const add = (kind, message, source, line, stack) => {
      shared.errors.push({ kind, message: String(message), source: String(source || ""), line: line || 0, stack: String(stack || "") });
    };
    const take = (m) => {
      try {
        if (!(m instanceof Ci.nsIScriptError)) return;
        if (m.flags & Ci.nsIScriptError.warningFlag) return;
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
        const text = Array.from(ev.arguments || [], (a) => {
          if (a && typeof a === "object" && "message" in a) return `${a}\n${a.stack || ""}`;
          try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); }
        }).join(" ");
        add("console.error", text, ev.filename, ev.lineNumber, "");
      } catch (e) {}
    }, "console-api-log-event");
  }

  let dumped = 0;
  function consoleDump(label = "") {
    const seen = new Map();
    for (const e of shared.errors.slice(dumped)) {
      const key = `${e.message}|${e.source}|${e.line}`;
      const have = seen.get(key);
      if (have) have.n++;
      else seen.set(key, { ...e, n: 1 });
    }
    dumped = shared.errors.length;
    let vitre = 0;
    let firefox = 0;
    for (const e of seen.values()) {
      const ours = OURS.test(e.source) || OURS.test(e.message) || OURS.test(e.stack) || /resource:\/\/vitre-/.test(e.source);
      if (ours) vitre++;
      else firefox++;
      log(`CONSOLE[${ours ? "vitre" : "firefox"}] ${label} x${e.n} (${e.kind}) ${e.message.slice(0, 600)} @ ${e.source}:${e.line}${e.stack.slice(0, 900)}`);
    }
    log(`CONSOLE-SUMMARY ${label} vitre=${vitre} firefox=${firefox}`);
    return { vitre, firefox };
  }

  const page = (title, body = "", bg = "#f4f1ea") =>
    "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style='margin:0;background:${bg};font:16px Segoe UI'>${body || `<p style='margin:120px 40px'>${title}</p>`}`);

  async function load(url, tab = b.active(), win = window) {
    const browser = tab.browser;
    const done = new Promise((resolve) => {
      const listener = {
        onStateChange(br, wp, _req, flags) {
          if (br === browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP && flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) {
            win.gBrowser.removeTabsProgressListener(listener);
            resolve();
          }
        },
      };
      win.gBrowser.addTabsProgressListener(listener);
    });
    win.vitre.navigate(tab, url);
    await Promise.race([done, sleep(20000)]);
    await sleep(250);
  }

  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "R:r" + Math.random();
      const on = (m) => { mm.removeMessageListener(id, on); resolve(m.data); };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } Promise.resolve(r).then((v) => sendAsyncMessage(" + JSON.stringify(id) + ", v), (e) => sendAsyncMessage(" + JSON.stringify(id) + ", 'ERR ' + e)); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  /** Problems between the three views of the tab strip: gBrowser, b.tabs, the bar's DOM. */
  function consistent(win = window) {
    const v = win.vitre;
    const out = [];
    const visible = Array.from(win.gBrowser.tabs).filter((t) => !t.hidden && !t.closing);
    if (visible.length !== v.tabs.length) out.push(`gBrowser has ${visible.length} visible tabs, b.tabs ${v.tabs.length}`);
    visible.forEach((n, i) => { if (v.tabs[i]?.node !== n) out.push(`order differs at ${i}`); });
    const sel = v.tabs.find((t) => t.node === win.gBrowser.selectedTab);
    if (!sel) out.push("selected tab is not in b.tabs");
    else if (sel.id !== v.activeId) out.push(`activeId ${v.activeId} is not the selected tab ${sel.id}`);
    const ids = new Set(v.tabs.map((t) => t.id));
    for (const m of v.mru) if (!ids.has(m)) out.push(`mru holds a dead id ${m}`);
    for (const t of v.tabs) if (!v.mru.includes(t.id)) out.push(`tab ${t.id} is not in mru`);
    if (new Set(v.mru).size !== v.mru.length) out.push("mru has duplicates");
    const doc = win.document;
    const items = [...doc.querySelectorAll("#vitre-bar .item.tab")];
    const shown = v.bar.state.shown;
    if (items.length !== shown) out.push(`bar DOM has ${items.length} tab items, state.shown ${shown}`);
    const active = doc.querySelectorAll("#vitre-bar .item.tab.active");
    if (active.length !== (v.tabs.length ? 1 : 0)) out.push(`${active.length} active pills`);
    else if (active.length && Number(active[0].dataset.id) !== v.activeId) out.push(`the pill is tab ${active[0].dataset.id}, active is ${v.activeId}`);
    for (const it of items) if (!ids.has(Number(it.dataset.id))) out.push(`bar shows a dead tab ${it.dataset.id}`);
    return out;
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

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };

  /** A popup's outer rectangle in window coordinates (panels are separate OS windows). */
  const popupRect = (popup, win = window) => {
    const r = popup.getOuterScreenRect();
    return { x: Math.round(r.left - win.mozInnerScreenX), y: Math.round(r.top - win.mozInnerScreenY), w: Math.round(r.width), h: Math.round(r.height), state: popup.state };
  };

  return { b, consoleStart, consoleDump, page, load, inPage, consistent, gc, rect, popupRect, sleep, waitFor, shared };
})();
