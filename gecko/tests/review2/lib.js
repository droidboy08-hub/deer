// Helpers for the robustness review of the integrated app (tests/review2/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.W. Every helper that acts on a window takes it as its first argument (several windows
// are driven from the first one's script). Input is synthesized in-process only.
//
//   W.consoleStart() / W.consoleDump(label)   every error that reaches the browser console (script
//                                  errors and console.error, warnings left out), split into Vitre's
//                                  (chrome://vitre/ in the source, message or stack) and Firefox's
//   W.P(name, query) / W.X(...)    a generated page on 127.0.0.1 / localhost (run.py's server)
//   W.load(win, tab, url) / W.open(win, url, opts)   navigate / new tab, resolved when loaded
//   W.inContent(browser, fn, arg)  run fn(content, arg) in a page's top frame
//   W.layers(win) / W.fmt(layers)  which Vitre surfaces are open
//   W.leftovers(win)               state that must be gone once every surface is closed
//   W.consistent(win)              b.tabs vs gBrowser vs the bar's DOM
//   W.openPeek / openFind / pageMenu / openSettings / openDownloads / openSwitcher / openOmni
//   W.unwind(win)                  Esc until nothing is open (returns the steps)
//   W.gc(), W.procs()              GC + CC; per-process CPU time (ChromeUtils.requestProcInfo)
//   W.installExt(names)            local test extensions (tests/extensions/build/ext) as temporary add-ons
//   W.kill(pid)                    end a content process (taskkill), to crash its tabs
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, IOUtils, PathUtils */
window.W = (() => {
  const { sleep, waitFor, log } = spike;
  const env = (k) => Services.env.get(k) || "";
  const base = env("R2_BASE");
  const xsite = env("R2_XSITE");
  const dlDir = env("R2_DL");
  const extDir = env("R2_EXT");
  const stock = env("R2_STOCK") === "1";

  const shared = (() => {
    const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
    if (!g.__vitreReview2) g.__vitreReview2 = { errors: [], started: false };
    return g.__vitreReview2;
  })();

  // ---- console ----
  const OURS = /chrome:\/\/vitre\/|resource:\/\/vitre-/;
  function consoleStart() {
    if (shared.started) return;
    shared.started = true;
    const add = (kind, message, source, line, stack) => shared.errors.push({ kind, message: String(message), source: String(source || ""), line: line || 0, stack: String(stack || ""), at: Date.now() });
    const take = (m) => {
      try {
        if (!(m instanceof Ci.nsIScriptError)) return;
        if (m.flags & Ci.nsIScriptError.warningFlag) return;
        let stack = "";
        try {
          let f = m.stack;
          for (let i = 0; f && i < 8; i++, f = f.parent) stack += `\n      at ${f.functionDisplayName || "?"} ${f.source}:${f.line}`;
        } catch {}
        add("script", m.errorMessage, m.sourceName, m.lineNumber, stack);
      } catch {}
    };
    try {
      for (const m of Services.console.getMessageArray() || []) take(m);
    } catch {}
    Services.console.registerListener({ observe: take, QueryInterface: ChromeUtils.generateQI(["nsIConsoleListener"]) });
    Services.obs.addObserver((subject) => {
      try {
        const ev = subject.wrappedJSObject;
        if (ev.level !== "error") return;
        const text = Array.from(ev.arguments || [], (a) => {
          if (a && typeof a === "object" && "message" in a) return `${a}\n${a.stack || ""}`;
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        }).join(" ");
        add("console.error", text, ev.filename, ev.lineNumber, "");
      } catch {}
    }, "console-api-log-event");
  }
  let dumped = 0;
  function consoleDump(label = "", { quiet = false } = {}) {
    const seen = new Map();
    for (const e of shared.errors.slice(dumped)) {
      const key = `${e.message}|${e.source}|${e.line}`;
      const have = seen.get(key);
      if (have) have.n++;
      else seen.set(key, { ...e, n: 1 });
    }
    dumped = shared.errors.length;
    const out = { vitre: [], firefox: [] };
    for (const e of seen.values()) {
      const ours = OURS.test(e.source) || OURS.test(e.message) || OURS.test(e.stack);
      (ours ? out.vitre : out.firefox).push(e);
      if (!quiet || ours) log(`CONSOLE[${ours ? "vitre" : "firefox"}] ${label} x${e.n} (${e.kind}) ${e.message.slice(0, 500)} @ ${e.source}:${e.line}${e.stack.slice(0, 700)}`);
    }
    log(`CONSOLE-SUMMARY ${label} vitre=${out.vitre.length} firefox=${out.firefox.length}`);
    return out;
  }
  /** Every distinct error from Vitre's code since consoleStart(). */
  function vitreErrors() {
    const seen = new Set();
    return shared.errors.filter((e) => (OURS.test(e.source) || OURS.test(e.message) || OURS.test(e.stack)) && !seen.has(e.message + e.line) && seen.add(e.message + e.line)).map((e) => `${e.message.slice(0, 300)} @ ${e.source}:${e.line}`);
  }

  // ---- pages ----
  const qs = (q) => (q ? "?" + q : "");
  const P = (name, q = "") => base + "p/" + name + qs(q);
  const X = (name, q = "") => xsite + "p/" + name + qs(q);
  const url = (path) => base + path;
  const xurl = (path) => xsite + path;

  const settled = (t, target) => t.url === target && !t.loading && t.browser.currentURI?.spec === target;
  async function load(win, tab, target, settle = 400) {
    win.vitre.navigate(tab, target);
    await waitFor(() => settled(tab, target), { timeout: 20000, what: "load " + target });
    await sleep(settle);
    return tab;
  }
  async function open(win, target, opts = {}) {
    const t = win.vitre.newTab(target, opts);
    await waitFor(() => settled(t, target), { timeout: 20000, what: "open " + target });
    await sleep(opts.settle ?? 300);
    return t;
  }

  let seq = 0;
  function inContent(browser, fn, arg, timeout = 8000) {
    return new Promise((resolve) => {
      const id = "r2-test:" + ++seq;
      let mm;
      try {
        mm = browser.messageManager;
      } catch {
        resolve({ error: "no message manager" });
        return;
      }
      const timer = setTimeout(() => {
        try {
          mm.removeMessageListener(id, onMsg);
        } catch {}
        resolve({ error: "timeout" });
      }, timeout);
      const onMsg = (m) => {
        clearTimeout(timer);
        mm.removeMessageListener(id, onMsg);
        resolve(m.data);
      };
      mm.addMessageListener(id, onMsg);
      const src =
        "(async () => { let r; try { r = await (" + fn + ")(content, " + JSON.stringify(arg === undefined ? null : arg) +
        "); } catch (e) { r = { error: String(e) }; } sendAsyncMessage(" + JSON.stringify(id) + ", r === undefined ? null : r); })()";
      mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(src), false);
    });
  }

  async function rectOf(win, browser, selector) {
    const r = await inContent(browser, (content, sel) => {
      const el = content.document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, selector);
    if (!r || r.error) return null;
    const br = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    const x = br.left + r.x * z;
    const y = br.top + r.y * z;
    return { x, y, w: r.w * z, h: r.h * z, cx: x + (r.w * z) / 2, cy: y + (r.h * z) / 2 };
  }

  // ---- input ----
  const EU = (win) => win.spike.EU;
  const key = (win, k, mods = {}) => EU(win).synthesizeKey(k, mods, win);
  const mouse = (win, x, y, opts = {}) => EU(win).synthesizeMouseAtPoint(x, y, opts, win);
  function rightClick(win, x, y, opts = {}) {
    mouse(win, x, y, { type: "mousemove", ...opts });
    mouse(win, x, y, { type: "mousedown", button: 2, ...opts });
    mouse(win, x, y, { type: "mouseup", button: 2, ...opts });
    mouse(win, x, y, { type: "contextmenu", button: 2, ...opts });
  }
  function click(win, x, y, opts = {}) {
    mouse(win, x, y, { type: "mousemove", ...opts });
    mouse(win, x, y, { type: "mousedown", button: 0, ...opts });
    mouse(win, x, y, { type: "mouseup", button: 0, ...opts });
  }

  // ---- surfaces ----
  const svc = (win, name) => {
    try {
      return win.vitre.service(name);
    } catch {
      return undefined;
    }
  };
  function layers(win) {
    const b = win.vitre;
    const s = (n) => svc(win, n);
    let prompt = false;
    try {
      prompt = !!win.vitreDownloads?.prompt?.isOpen;
    } catch {}
    return {
      menu: !!win.vitreMenus?.state?.().open,
      find: !!s("find")?.isOpen(),
      peek: !!s("peek")?.isOpen(),
      settings: !!s("settings")?.isOpen?.(),
      switcher: !!s("switcher")?.isOpen(),
      omni: !!b.omni?.open,
      downloads: !!s("downloads")?.isPanelOpen?.(),
      prompt,
    };
  }
  const fmt = (l) => Object.entries(l).filter(([, v]) => v).map(([k]) => k).join("+") || "none";

  /** Root classes / attributes and holds that must be gone once every surface is closed. */
  function leftovers(win) {
    const b = win.vitre;
    const out = [];
    const STATE = ["panel-open", "settings-open", "downloads-open", "find-face", "find-focused", "find-own", "find-in-peek", "omni-open", "vitre-switcher-cover", "vitre-switcher-grid", "latched", "sw-expanding", "sw-out", "sw-still", "closing"];
    for (const c of STATE) if (b.root.classList.contains(c)) out.push("root." + c);
    for (const a of ["vitre-find-in-peek"]) if (win.document.documentElement.hasAttribute(a)) out.push(":root[" + a + "]");
    try {
      const holds = b.bar.visibility?.holds?.size ?? 0;
      if (holds) out.push(`bar holds ${holds} (${[...b.bar.visibility.holds].map((s) => s.description).join(",")})`);
    } catch {}
    try {
      const th = b.themeHolds?.length ?? 0;
      if (th) out.push(`theme holds ${th}`);
    } catch {}
    // Visible Vitre layers that should be empty or hidden.
    for (const layer of b.root.querySelectorAll(":scope > [id^='layer-']")) {
      if (/layer-(bar|tips|home-bg|downloads-ring|find-ring)$/.test(layer.id)) continue;
      const kids = layer.id === "layer-menus" ? [...layer.querySelectorAll(".vt-menus > *")] : [...layer.children];
      const visible = kids.filter((c) => {
        const cs = win.getComputedStyle(c);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
        const r = c.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      });
      if (visible.length && !/layer-(tips|home-bg|downloads-ring|find-ring)$/.test(layer.id)) out.push(`${layer.id}: ${visible.length} visible (${visible.map((c) => c.className || c.tagName).join(" | ").slice(0, 160)})`);
    }
    try {
      const ka = b.keys.hooks?.length;
      if (ka !== undefined) out.push; // informational only
    } catch {}
    return out;
  }

  async function openPeek(win, target, { focus = true } = {}) {
    const peek = svc(win, "peek");
    peek.open(target);
    await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec === target && !peek.browser().webProgress?.isLoadingDocument, { timeout: 12000, what: "peek " + target });
    await sleep(700);
    if (focus) {
      peek.browser().focus();
      await sleep(150);
    }
    return peek.browser();
  }
  async function openFind(win, text = "glass") {
    const find = svc(win, "find");
    key(win, "f", { accelKey: true });
    await waitFor(() => find.isOpen(), { timeout: 4000, what: "find" });
    await sleep(350);
    if (text) EU(win).sendString(text, win);
    await sleep(600);
    return find;
  }
  async function pageMenu(win, browser) {
    browser = browser || win.vitre.active().browser;
    const r = browser.getBoundingClientRect();
    rightClick(win, r.left + r.width * 0.6, r.top + r.height * 0.7);
    await waitFor(() => layers(win).menu, { timeout: 4000, what: "menu" });
    await sleep(250);
  }
  async function openSettings(win) {
    key(win, ",", { ctrlKey: true });
    await waitFor(() => layers(win).settings, { timeout: 4000, what: "settings" });
    await sleep(500);
  }
  async function openDownloads(win) {
    key(win, "j", { ctrlKey: true });
    await waitFor(() => layers(win).downloads, { timeout: 4000, what: "downloads panel" });
    await sleep(500);
  }
  async function openSwitcher(win) {
    key(win, "a", { ctrlKey: true, shiftKey: true });
    await waitFor(() => layers(win).switcher, { timeout: 4000, what: "switcher" });
    await sleep(600);
  }
  async function openOmni(win) {
    key(win, "l", { ctrlKey: true });
    await waitFor(() => layers(win).omni, { timeout: 4000, what: "address field" });
    await sleep(300);
  }
  /** Esc until nothing is open (at most `max` presses); returns the layers seen after each. */
  async function unwind(win, max = 10, wait = 450) {
    const steps = [];
    for (let i = 0; i < max && fmt(layers(win)) !== "none"; i++) {
      key(win, "KEY_Escape");
      await sleep(wait);
      steps.push(fmt(layers(win)));
    }
    return steps;
  }

  /** Problems between gBrowser, b.tabs and the bar's DOM. */
  function consistent(win) {
    const v = win.vitre;
    const out = [];
    const visible = Array.from(win.gBrowser.tabs).filter((t) => !t.hidden && !t.closing);
    if (visible.length !== v.tabs.length) out.push(`gBrowser has ${visible.length} visible tabs, b.tabs ${v.tabs.length}`);
    visible.forEach((n, i) => {
      if (v.tabs[i]?.node !== n) out.push(`order differs at ${i}`);
    });
    const sel = v.tabs.find((t) => t.node === win.gBrowser.selectedTab);
    if (!sel) out.push("selected tab is not in b.tabs");
    else if (sel.id !== v.activeId) out.push(`activeId ${v.activeId} is not the selected tab ${sel.id}`);
    const ids = new Set(v.tabs.map((t) => t.id));
    for (const m of v.mru) if (!ids.has(m)) out.push(`mru holds a dead id ${m}`);
    for (const t of v.tabs) if (!v.mru.includes(t.id)) out.push(`tab ${t.id} is not in mru`);
    const items = [...win.document.querySelectorAll("#vitre-bar .item.tab")];
    for (const it of items) if (!ids.has(Number(it.dataset.id))) out.push(`bar shows a dead tab ${it.dataset.id}`);
    const active = win.document.querySelectorAll("#vitre-bar .item.tab.active");
    if (active.length !== (v.tabs.length ? 1 : 0)) out.push(`${active.length} active pills`);
    const hidden = Array.from(win.gBrowser.tabs).filter((t) => t.hidden && !t.closing);
    if (hidden.length > 2) out.push(`${hidden.length} hidden tabs`);
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

  /** CPU time (ms) and memory per process. */
  async function procs() {
    const info = await ChromeUtils.requestProcInfo();
    const row = (p) => ({ pid: p.pid, type: p.type, origin: p.origin || "", cpu: Number(p.cpuTime) / 1e6, mem: Math.round(Number(p.memory || 0) / 1048576), threads: (p.threads || []).map((t) => ({ name: t.name, cpu: Number(t.cpuTime) / 1e6 })) });
    return { parent: row(info), children: (info.children || []).map(row) };
  }

  async function installExt(names) {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const out = [];
    for (const name of names) {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(PathUtils.join(extDir, name));
      try {
        out.push(await AddonManager.installTemporaryAddon(f));
      } catch (e) {
        log("extension " + name + " failed: " + e);
      }
    }
    return out;
  }

  function kill(pid) {
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    const exe = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    exe.initWithPath("C:\\Windows\\System32\\taskkill.exe");
    proc.init(exe);
    proc.run(true, ["/F", "/PID", String(pid)], 3);
  }
  const pidOf = (browser) => {
    try {
      return browser.frameLoader?.remoteTab?.osPid || 0;
    } catch {
      return 0;
    }
  };

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };

  async function downloaded() {
    try {
      return (await IOUtils.getChildren(dlDir)).map((p) => PathUtils.filename(p));
    } catch {
      return [];
    }
  }

  return {
    base, xsite, dlDir, extDir, stock, shared,
    consoleStart, consoleDump, vitreErrors, P, X, url, xurl, load, open, inContent, rectOf,
    EU, key, mouse, rightClick, click, svc, layers, fmt, leftovers,
    openPeek, openFind, pageMenu, openSettings, openDownloads, openSwitcher, openOmni, unwind,
    consistent, gc, procs, installExt, kill, pidOf, rect, downloaded, sleep, waitFor,
  };
})();
