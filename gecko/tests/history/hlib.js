// Helpers for the History panel tests (tests/history/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
// Gives window.H. Pages come from the local server tests/history/all.py starts (HISTORY_PORT) on
// 127.0.0.1 (localhost is a second site): pages/a.html ... (titled pages to open). History is seeded
// through PlacesUtils.history.insertMany with visits on several days; nothing reaches the internet
// (the "house sites" of the board's scene are only rows: they are never opened).
// Input is synthesized in-process (EventUtils), never OS input; real mouse input is shut out.
/* global spike, Services, Ci, Cc, ChromeUtils, gBrowser, PlacesObservers */
window.H = (() => {
  const b = window.vitre;
  const { sleep } = spike;
  const EU = spike.EU;
  const port = Services.env.get("HISTORY_PORT");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  // A real cursor over the test window would replace the synthesized hover (tests/split/slib.js).
  window.windowUtils.disableNonTestMouseEvents(true);

  const http = (leaf, host = "127.0.0.1") => `http://${host}:${port}/${leaf}`;

  async function until(fn, timeout = 8000) {
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try {
        v = await fn();
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(50);
    }
  }

  // ---- keys and mouse ----
  const NAMED = { Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete", Home: "KEY_Home", End: "KEY_End", PageUp: "KEY_PageUp", PageDown: "KEY_PageDown", Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight", Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Space: " ", Comma: ",", F6: "KEY_F6", F10: "KEY_F10", Backspace: "KEY_Backspace" };
  /** "Ctrl+Shift+T" as EventUtils keys, in this window. */
  function press(spec, extra = {}, win = window) {
    const parts = spec.split("+");
    let key = parts.pop();
    const opts = { ...extra };
    for (const m of parts) {
      if (m === "Ctrl") opts.ctrlKey = true;
      else if (m === "Shift") opts.shiftKey = true;
      else if (m === "Alt") opts.altKey = true;
    }
    key = NAMED[key] ?? (/^[A-Za-z]$/.test(key) ? (opts.shiftKey ? key.toUpperCase() : key.toLowerCase()) : key);
    (win === window ? EU : win.spike.EU).synthesizeKey(key, opts, win);
  }
  const type = (text) => EU.sendString(text, window);
  /** An element of the panel's list is scrolled into its box first (a click lands on it). */
  function reveal(target) {
    if (target instanceof Element && target.closest(".vh-scroll")) (target.closest(".vh-row, .vh-head") ?? target).scrollIntoView({ block: "nearest" });
  }
  /** Click an element's centre (or a point), with modifiers / button. */
  function click(target, opts = {}) {
    if (target && typeof target === "object" && "x" in target && !(target instanceof Element)) EU.synthesizeMouseAtPoint(target.x, target.y, opts, window);
    else {
      reveal(target);
      EU.synthesizeMouseAtCenter(target, opts, window);
    }
  }
  /** Move the pointer onto an element (hover). */
  function hover(target) {
    reveal(target);
    const r = target.getBoundingClientRect();
    EU.synthesizeMouseAtPoint(r.left + r.width / 2, r.top + r.height / 2, { type: "mousemove" }, window);
  }
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };

  // ---- history ----
  const now = () => Date.now();
  /** Local time `days` days ago (0 = today) at h:m (days start at local midnight). */
  function at(days, h, m = 0, s = 0) {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days, h, m, s);
  }
  /** Seed pages: [{ url, title, visits: [Date | { date, transition }] }]; dates in the future are clamped to now - 1 s. */
  async function seed(pages) {
    const limit = Date.now() - 1000;
    const infos = pages.map((p) => ({
      url: p.url,
      title: p.title,
      visits: p.visits.map((v) => {
        const date = v instanceof Date ? v : v.date;
        const transition = v instanceof Date ? PlacesUtils.history.TRANSITIONS.LINK : (v.transition ?? PlacesUtils.history.TRANSITIONS.LINK);
        return { date: new Date(Math.min(date.getTime(), limit)), transition };
      }),
    }));
    for (let i = 0; i < infos.length; i += 500) await PlacesUtils.history.insertMany(infos.slice(i, i + 500));
  }
  const clearHistory = () => PlacesUtils.history.clear();
  /** A page's visit dates (ms), oldest first; [] when the page is gone. */
  async function visits(url) {
    const info = await PlacesUtils.history.fetch(url, { includeVisits: true });
    return (info?.visits ?? []).map((v) => v.date.getTime()).sort((a, c) => a - c);
  }

  // ---- the panel ----
  const hist = () => window.vitreHistory;
  const panel = () => hist()?.panel;
  const store = () => hist()?.store;
  const root = () => document.getElementById("vitre-history");
  const sheet = () => root()?.querySelector(".vh-sheet");
  const isOpen = () => !!panel()?.isOpen;
  const field = () => root()?.querySelector(".vh-search-input");
  const list = () => root()?.querySelector(".vh-list");
  const scroller = () => root()?.querySelector(".vh-scroll");
  /** Drawn rows in order: { el, id, title, addr, time, selected, aria, group }. */
  function rows() {
    const l = list();
    if (!l) return [];
    return [...l.querySelectorAll(".vh-group:not(.leaving) .vh-row:not(.leaving)")].map((el) => ({
      el,
      id: el.dataset.id,
      title: el.querySelector(".vh-title").textContent,
      addr: el.querySelector(".vh-addr").textContent,
      time: el.querySelector(".vh-time").textContent,
      selected: el.getAttribute("aria-selected") === "true",
      aria: el.getAttribute("aria-label"),
      group: el.closest(".vh-group").dataset.id,
    }));
  }
  /** Drawn day headings in order: { el, label, sub, aria, group }. */
  function heads() {
    const l = list();
    if (!l) return [];
    return [...l.querySelectorAll(".vh-group:not(.leaving) > .vh-head")].map((el) => ({
      el,
      label: el.querySelector(".vh-hl").textContent,
      sub: el.querySelector(".vh-hs").hidden ? "" : el.querySelector(".vh-hs").textContent,
      aria: el.querySelector("[role=rowheader]").getAttribute("aria-label"),
      group: el.dataset.group,
      count: el.closest(".vh-group").querySelectorAll(".vh-row:not(.leaving)").length,
    }));
  }
  const row = (title) => rows().find((r) => r.title === title);
  /** Rows wholly inside the list's scrolled box (a click there lands on them). */
  function visibleRows() {
    const box = scroller()?.getBoundingClientRect();
    if (!box) return [];
    return rows().filter((r) => {
      const x = r.el.getBoundingClientRect();
      return x.top >= box.top && x.bottom <= box.bottom;
    });
  }
  /** The toolbar's shown line: { text, buttons }. */
  function toolbar() {
    const line = root()?.querySelector(".vh-tbline.on");
    return { text: line?.querySelector(".vh-tbtext")?.textContent ?? "", buttons: [...(line?.querySelectorAll("button") ?? [])].map((x) => x.textContent || x.getAttribute("aria-label")), el: line };
  }
  const message = () => {
    const m = root()?.querySelector(".vh-msg");
    return m && !m.hidden ? m.textContent : "";
  };
  /** Open with Ctrl+H from the page and wait until the panel has drawn (or shows a message). */
  async function open(how = "key") {
    if (how === "key") press("Ctrl+H");
    else b.service("history").open();
    await until(() => isOpen() && (rows().length || message() || !store()) && store()?.ready !== false, 8000);
    await sleep(350);
  }
  async function close() {
    if (isOpen()) panel().close();
    await until(() => !isOpen() && root()?.hidden, 3000);
    await sleep(100);
  }
  /** Type into the search field and wait for the answer. */
  async function search(text) {
    const f = field();
    f.focus();
    f.select();
    if (text) type(text);
    else press("Backspace");
    await until(() => store().query === text.trim() && store().shown === text.trim() && !store().searching, 5000);
    await sleep(200);
  }
  /** The focused element's description: a row's title, a heading's label, or a control's name. */
  function focused() {
    const a = document.activeElement;
    if (!a) return "";
    if (a.classList?.contains("vh-row")) return "row:" + a.querySelector(".vh-title").textContent;
    if (a.classList?.contains("vh-head")) return "head:" + a.querySelector(".vh-hl").textContent;
    return (a.getAttribute?.("aria-label") || a.textContent || a.localName || "").trim();
  }

  /** Load a URL in a tab (default: the active one) and wait for it. */
  async function load(url, tab = b.active()) {
    // Right after start the first tab's browser may not be remote yet (Firefox throws from
    // maybeCancelContentJSExecution): wait for it and try once more.
    try {
      b.navigate(tab, url);
    } catch {
      await until(() => tab.browser.frameLoader?.remoteTab, 5000);
      await sleep(300);
      b.navigate(tab, url);
    }
    await until(() => tab.url === url && !tab.loading && tab.browser.currentURI.spec === url, 20000);
    await sleep(250);
    return tab;
  }

  // ---- menus (window.vitreMenus) ----
  const M = () => window.vitreMenus;
  const menuOpen = () => !!M() && M().state().open;
  const menuRows = () => (menuOpen() ? M().state().rows : []);
  function rightClick(el) {
    reveal(el);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(120, r.width / 2);
    const y = r.top + r.height / 2;
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
  }
  async function menuOn(el) {
    if (menuOpen()) M().api.close();
    await sleep(80);
    rightClick(el);
    await until(() => menuOpen(), 4000);
    await sleep(240);
    return menuRows();
  }
  async function pick(label) {
    const st = M().state();
    const i = st.rows.findIndex((r) => r.label === label || r.label.startsWith(label));
    if (i < 0) throw new Error("no menu row " + label + " in " + JSON.stringify(st.rows.map((r) => r.label)));
    const elr = M().view.rowElement(i, 0);
    const r = elr.getBoundingClientRect();
    const x = r.left + Math.min(60, r.width / 2);
    const y = r.top + r.height / 2;
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    await sleep(40);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup" }, window);
    await until(() => !menuOpen(), 3000);
    await sleep(250);
  }
  /** WM_CONTEXTMENU with lParam -1 (Shift+F10 / the Menu key), as tests/menus/lib.js sends it. */
  function keyboardMenu() {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    PostMessageW(ctypes.voidptr_t(ctypes.UInt64(handle)), 0x007b, ctypes.UInt64(handle), -1);
    user32.close();
  }

  /** The text on the clipboard. */
  function clipboard() {
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    trans.init(null);
    trans.addDataFlavor("text/plain");
    Services.clipboard.getData(trans, Services.clipboard.kGlobalClipboard, null);
    const out = {};
    try {
      trans.getTransferData("text/plain", out);
      return out.value.QueryInterface(Ci.nsISupportsString).data;
    } catch {
      return "";
    }
  }

  /** Settings › Appearance › Mode (the chrome follows it). */
  async function mode(theme) {
    b.sys("VitreSettings").set({ theme });
    await until(() => window.matchMedia(`(prefers-color-scheme: ${theme === "light" ? "light" : "dark"})`).matches, 4000);
    await sleep(300);
  }

  /** Every Places event of the next `ms` (to show that nothing was written). */
  function recordPlaces() {
    const events = [];
    const fn = (evs) => events.push(...evs.map((e) => e.type));
    PlacesObservers.addListener(["page-visited", "page-removed", "page-title-changed", "history-cleared"], fn);
    return { events, stop: () => PlacesObservers.removeListener(["page-visited", "page-removed", "page-title-changed", "history-cleared"], fn) };
  }

  /**
   * The board's scene (HistoryPanel): Today 14 rows, Yesterday 12, the day before 4, from the house
   * sites, `base` days ago (with the clock set `base` days back, so every visit is in the past and the
   * times are the board's). Returns { title: url }.
   */
  async function scene(base = 1) {
    const R = (title, url, h, m) => ({ title, url, h, m });
    const days = [
      [
        R("Sand, heat and a bath of molten tin", "https://fieldnotes.press/notes/float-glass", 14, 32),
        R("Float glass", "https://refract.wiki/wiki/Float_glass", 14, 27),
        R("Molten: a 4K study of glass in motion", "https://tideline.fm/v/molten", 14, 19),
        R("Downloads: resume fails when the server drops the ETag · Issue #39 · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues/39", 14, 5),
        R("Search: Alt + Enter should open the result in a background tab · Issue #38 · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues/38", 13, 58),
        R("Slow light · Long Exposure Club", "https://longexposure.club/slow-light", 13, 41),
        R("The quiet science of ice", "https://fieldnotes.press/ice", 12, 56),
        R("Tin bath", "https://refract.wiki/wiki/Tin_bath", 12, 48),
        R("Issues · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues", 12, 30),
        R("Annealing lehr", "https://refract.wiki/wiki/Annealing_lehr", 11, 52),
        R("The tin bath, explained in five minutes", "https://tideline.fm/v/tin-bath", 11, 37),
        R("backdrop-filter - CSS | MDN", "https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter", 10, 24),
        R("Archive", "https://fieldnotes.press/archive", 10, 15),
        R("Segoe UI Variable font - Microsoft Learn", "https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography", 9, 48),
      ],
      [
        R("Ribbon studies, part 2", "https://tideline.fm/v/ribbon-2", 22, 41),
        R("Pull requests · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/pulls", 21, 12),
        R("Glass: refraction looks too strong at 125% display scaling · Issue #33 · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues/33", 20, 40),
        R("Collections · Long Exposure Club", "https://longexposure.club/collections", 19, 5),
        R("Soda-lime glass", "https://refract.wiki/wiki/Soda-lime_glass", 18, 22),
        R("Northern lake, four seasons in one take", "https://tideline.fm/v/northern-lake", 17, 50),
        R("How we lit the orb shot", "https://tideline.fm/v/orb", 17, 31),
        R("Members · Long Exposure Club", "https://longexposure.club/members", 16, 2),
        R("Peek: Esc should return focus to the link that opened it · Issue #24 · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues/24", 15, 20),
        R("The weight of a window", "https://fieldnotes.press/window", 11, 8),
        R("Fire polishing", "https://refract.wiki/wiki/Fire_polishing", 10, 40),
        R("Salt flats at first light", "https://tideline.fm/v/salt-flats", 9, 12),
      ],
      [
        R("Bristol Blue Glass, a visit", "https://fieldnotes.press/bristol-blue", 16, 5),
        R("Tab switcher: Ctrl + W closes the wrong tab while searching · Issue #29 · vitre/vitre-shell", "https://code.vitre.dev/vitre/vitre-shell/issues/29", 15, 47),
        R("Dusk, from a canoe", "https://tideline.fm/v/dusk", 13, 20),
        R("glass - Wiktionary, the free dictionary", "https://en.wiktionary.org/wiki/glass", 9, 12),
      ],
    ];
    const urls = {};
    const pages = new Map();
    days.forEach((list, i) => {
      for (const r of list) {
        urls[r.title] = r.url;
        const p = pages.get(r.url) ?? { url: r.url, title: r.title, visits: [] };
        p.visits.push(at(base + i, r.h, r.m));
        pages.set(r.url, p);
      }
    });
    await seed([...pages.values()]);
    return urls;
  }

  /** Run fn(content, document) in a page's process (a frame script); resolves with its (JSON) result. */
  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "H:r" + Math.random();
      const on = (m) => {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } Promise.resolve(r).then((v) => sendAsyncMessage(" + JSON.stringify(id) + ", v), (e) => sendAsyncMessage(" + JSON.stringify(id) + ", 'ERR ' + e)); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  /** Move the panel's "now" to `daysAgo` days back at h:m (it keeps running from there). */
  function useClock(daysAgo, h = 14, m = 40) {
    const fixed = at(daysAgo, h, m).getTime();
    const started = Date.now();
    store().clock = () => fixed + (Date.now() - started);
  }
  const realClock = () => {
    store().clock = () => Date.now();
  };

  return { b, PlacesUtils, http, until, scene, useClock, realClock, inPage, press, type, click, hover, rect, now, at, seed, clearHistory, visits, hist, panel, store, root, sheet, isOpen, field, list, scroller, rows, visibleRows, heads, row, toolbar, message, open, close, search, focused, load, M, menuOpen, menuRows, menuOn, pick, keyboardMenu, rightClick, clipboard, mode, recordPlaces };
})();
