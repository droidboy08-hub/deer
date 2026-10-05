// Helpers for the switcher verification scripts (tests/switcher-verify/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);
// Gives window.V (the first window only needs it; other windows get their own copy when they load it).
//
//   V.down / V.up / V.press(spec, extra)   keys through EventUtils (nsITextInputProcessor: the real
//                                          widget -> chrome -> content path, no OS focus). A held Ctrl
//                                          is always an explicit V.down("Control") ... V.up("Control").
//   V.state(), V.sel() (title of the selected card), V.active() (title of the active tab)
//   V.page(title, colour, extra)            a data: page; V.openTabs(urls), V.visit(tabs)
//   V.holdOpen(steps), V.release(), V.closed(), V.latched(mode)
//   V.consoleStart() / V.consoleDump(label) every error that reaches the console (Services.console and
//                                          console.error), split into Vitre's own and Firefox's
//   V.inPage(fn, browser)                  run fn(content, document) in the page's process
//   V.gc()                                 force GC + CC
//   V.cpu()                                parent-process CPU time in ms (ChromeUtils.cpuTimeSinceProcessStart)
//   V.consistent()                         b.tabs / gBrowser / MRU agree (list of problems)
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
window.V = (() => {
  const { sleep, waitFor, log, check } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  const sw = () => window.vitreSwitcher;

  const NAMED = {
    Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete",
    Backspace: "KEY_Backspace", Home: "KEY_Home", End: "KEY_End", Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight",
    Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Control: "KEY_Control", Shift: "KEY_Shift", Alt: "KEY_Alt",
    F5: "KEY_F5", F6: "KEY_F6", F10: "KEY_F10", F11: "KEY_F11", PageDown: "KEY_PageDown", PageUp: "KEY_PageUp",
  };
  function parse(spec) {
    const parts = spec.split("+");
    let key = parts.pop();
    const opts = {};
    for (const m of parts) {
      if (m === "Ctrl") opts.ctrlKey = true;
      else if (m === "Shift") opts.shiftKey = true;
      else if (m === "Alt") opts.altKey = true;
      else throw new Error("bad modifier " + m);
    }
    if (NAMED[key]) key = NAMED[key];
    else if (/^[A-Za-z]$/.test(key)) key = opts.shiftKey ? key.toUpperCase() : key.toLowerCase();
    return { key, opts };
  }
  function press(spec, extra = {}, win = window) {
    const { key, opts } = parse(spec);
    (win.spike?.EU ?? EU).synthesizeKey(key, Object.assign(opts, extra), win);
  }
  const down = (spec, extra = {}, win = window) => press(spec, { ...extra, type: "keydown" }, win);
  const up = (spec, extra = {}, win = window) => press(spec, { ...extra, type: "keyup" }, win);

  const state = (win = window) => win.vitreSwitcher.state();
  const titleOf = (id, win = window) => {
    const t = win.vitre.tab(id);
    return t ? (t.kind === "home" ? "Home" : t.title || t.url) : "?";
  };
  const sel = (win = window) => titleOf(state(win).selected, win);
  const active = (win = window) => titleOf(win.vitre.activeId, win);

  const page = (title, colour = "#f4f1ea", extra = "", text = "#111") =>
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style="margin:0;background:${colour};color:${text};font:28px Segoe UI"><p style="margin:140px 60px">${title}</p>${extra}`);

  async function loaded(tab, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const br = tab.browser;
      if (!tab.loading && br && br.currentURI && br.currentURI.spec !== "about:blank" && !br.webProgress?.isLoadingDocument) return true;
      await sleep(100);
    }
    return false;
  }

  async function openTabs(urls, win = window) {
    const vb = win.vitre;
    const first = vb.active();
    vb.navigate(first, urls[0]);
    const tabs = [first];
    for (let i = 1; i < urls.length; i += 6) {
      const group = urls.slice(i, i + 6).map((u) => vb.newTab(u, { background: true, index: vb.tabs.length }));
      tabs.push(...group);
      await Promise.all(group.map((t) => loaded(t)));
    }
    await loaded(first);
    await sleep(500);
    return tabs;
  }

  async function visit(tabs, win = window) {
    for (const t of tabs) {
      win.vitre.activate(t);
      await sleep(120);
    }
    await sleep(400);
  }

  async function holdOpen(steps = 1, { back = false, win = window } = {}) {
    win.vitre.focusPage();
    await sleep(80);
    down("Control", {}, win);
    await sleep(30);
    for (let i = 0; i < steps; i++) {
      press(back ? "Shift+Tab" : "Tab", {}, win);
      await sleep(40);
    }
    await waitFor(() => state(win).phase === "open", { timeout: 3000, what: "switcher open" });
  }

  const closed = (win = window) => waitFor(() => state(win).phase === "idle", { timeout: 4000, what: "switcher closed" }).then(() => sleep(200));

  async function release(win = window) {
    up("Control", {}, win);
    await closed(win);
  }

  async function latched(mode = "latched", win = window) {
    win.vitre.service("switcher").open(mode);
    await waitFor(() => state(win).phase === "open", { timeout: 3000, what: "latched open" });
    await sleep(500);
  }

  const setStyle = async (style) => {
    b.sys("VitreSettings").set({ switcherStyle: style });
    await sleep(150);
  };

  // ---- console ----
  const shared = (() => {
    const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
    if (!g.__vitreSwVerify) g.__vitreSwVerify = { errors: [], started: false };
    return g.__vitreSwVerify;
  })();
  const OURS = /chrome:\/\/vitre\//;
  function consoleStart() {
    if (shared.started) return;
    shared.started = true;
    const add = (kind, message, source, line, stack) => shared.errors.push({ kind, message: String(message), source: String(source || ""), line: line || 0, stack: String(stack || "") });
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
    let switcher = 0;
    let firefox = 0;
    for (const e of seen.values()) {
      const text = `${e.source} ${e.message} ${e.stack}`;
      const ours = OURS.test(text) || /resource:\/\/vitre-/.test(e.source);
      const mine = /switcher|vitreSwitcher|VitreSwitcher/i.test(text);
      if (ours) vitre++;
      else firefox++;
      if (mine) switcher++;
      log(`CONSOLE[${ours ? "vitre" : "firefox"}${mine ? ",switcher" : ""}] ${label} x${e.n} (${e.kind}) ${e.message.slice(0, 500)} @ ${e.source}:${e.line}${e.stack.slice(0, 700)}`);
    }
    log(`CONSOLE-SUMMARY ${label} vitre=${vitre} switcher=${switcher} firefox=${firefox}`);
    return { vitre, switcher, firefox };
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

  const cpu = () => ChromeUtils.cpuTimeSinceProcessStart;

  function consistent(win = window) {
    const v = win.vitre;
    const out = [];
    const visible = Array.from(win.gBrowser.tabs).filter((t) => !t.hidden && !t.closing);
    if (visible.length !== v.tabs.length) out.push(`gBrowser has ${visible.length} visible tabs, b.tabs ${v.tabs.length}`);
    const sel = v.tabs.find((t) => t.node === win.gBrowser.selectedTab);
    if (!sel) out.push("selected tab is not in b.tabs");
    else if (sel.id !== v.activeId) out.push(`activeId ${v.activeId} is not the selected tab ${sel.id}`);
    const ids = new Set(v.tabs.map((t) => t.id));
    for (const m of v.mru) if (!ids.has(m)) out.push(`mru holds a dead id ${m}`);
    for (const t of v.tabs) if (!v.mru.includes(t.id)) out.push(`tab ${t.id} is not in mru`);
    if (v.mru[0] !== v.activeId) out.push(`mru[0] ${v.mru[0]} is not the active tab ${v.activeId}`);
    if (new Set(v.mru).size !== v.mru.length) out.push("mru has duplicates");
    return out;
  }

  /** What is left of the switcher in the DOM and in the animation timeline. */
  function leftovers(win = window) {
    const layer = win.document.getElementById("layer-switcher");
    const anims = win.document.getAnimations().filter((a) => a.effect?.target && layer?.contains(a.effect.target));
    return { children: layer ? layer.children.length : -1, animations: anims.length, gridClass: win.vitre.root.classList.contains("vitre-switcher-grid") };
  }

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };

  return { b, EU, sw, parse, press, down, up, state, titleOf, sel, active, page, loaded, openTabs, visit, holdOpen, closed, release, latched, setStyle, consoleStart, consoleDump, inPage, gc, cpu, consistent, leftovers, rect, sleep, waitFor, log, check };
})();
