// Helpers for the Peek tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.P. Input is synthesized in-process (EventUtils through spike.EU); runs have
// focusmanager.testmode=true (tools/run.py), and every test calls spike.activate() first.
/* global spike, Services, Ci, gBrowser */
window.P = (() => {
  const { sleep, waitFor } = spike;
  const b = window.vitre;
  const base = Services.env.get("VITRE_PEEK_BASE");
  const xsite = Services.env.get("VITRE_PEEK_XSITE");
  const page = (leaf) => base + leaf;
  const peek = () => b.service("peek");

  let seq = 0;
  /** Run fn(content, arg) in the top frame of a browser (a frame script) and return its result. */
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "peek-test:" + ++seq;
      const mm = browser.messageManager;
      const onMsg = (m) => {
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

  /** The issue page's own state: token (one per document), counter, typed text, Esc count, loads. */
  const state = (browser) =>
    inContent(browser, (w) => {
      const r = w.document.documentElement;
      const c = w.document.getElementById("comment");
      return {
        url: w.location.href,
        token: r.dataset.token || null,
        n: +r.dataset.n || 0,
        esc: +r.dataset.esc || 0,
        loads: +r.dataset.loads || 0,
        typed: c ? c.value : null,
        geo: r.dataset.geo || "",
        fs: r.dataset.fs || "",
        fschange: r.dataset.fschange || "",
        isFs: !!w.document.fullscreenElement,
        opened: r.dataset.opened || "",
        active: w.document.activeElement ? w.document.activeElement.id || w.document.activeElement.localName : null,
        visibility: w.document.visibilityState,
        scrollY: w.scrollY,
        hasOpener: !!w.wrappedJSObject.opener,
      };
    });

  /** A content element's rectangle in window px (scrolled into view first when asked). */
  async function rectOf(browser, selector, scroll = false) {
    const r = await inContent(
      browser,
      (w, a) => {
        const el = w.document.querySelector(a.selector);
        if (!el) return null;
        if (a.scroll) el.scrollIntoView({ block: "center" });
        const x = el.getBoundingClientRect();
        return { x: x.left, y: x.top, w: x.width, h: x.height };
      },
      { selector, scroll }
    );
    if (!r) return null;
    const br = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    return { x: br.left + r.x * z, y: br.top + r.y * z, w: r.w * z, h: r.h * z, cx: br.left + (r.x + r.w / 2) * z, cy: br.top + (r.y + r.h / 2) * z };
  }

  const mouse = (x, y, opts = {}) => spike.EU.synthesizeMouseAtPoint(x, y, opts, window);
  const move = (x, y) => spike.EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);

  /** Shift+click a link of the active tab's page (by selector), at its centre or at `dx` from its left. */
  async function shiftClick(selector, { browser = b.active().browser, dx = null } = {}) {
    const r = await rectOf(browser, selector);
    if (!r) throw new Error("no element " + selector);
    const x = dx === null ? r.cx : r.x + dx;
    move(x, r.cy);
    await sleep(60);
    mouse(x, r.cy, { shiftKey: true });
    return r;
  }

  /** Wait for the sheet to be open with a document from `part` committed and painted. */
  async function waitOpen(part, timeout = 10000) {
    await waitFor(() => peek()?.isOpen() && peek().browser(), { timeout, what: "a peek" });
    const br = peek().browser();
    await waitFor(() => br.currentURI.spec.includes(part) && !br.webProgress?.isLoadingDocument, { timeout, what: "the peek's page " + part });
    await sleep(700);
    return br;
  }

  async function waitClosed(timeout = 4000) {
    await waitFor(() => !peek()?.isOpen() && !document.querySelector("#layer-peek > .vp-sheet.on"), { timeout, what: "the peek to close" });
  }

  /** Load a URL in the active tab and wait for it. */
  async function load(url, tab = b.active()) {
    b.navigate(tab, url);
    await waitFor(() => tab.url === url && !tab.loading, { timeout: 20000, what: "load " + url });
    await sleep(400);
  }

  /** Round to integers, for logs and comparisons. */
  const R = (r) => (r ? { x: Math.round(r.x ?? r.left), y: Math.round(r.y ?? r.top), w: Math.round(r.w ?? r.width), h: Math.round(r.h ?? r.height) } : null);
  const near = (a, c, tol = 2) => Math.abs(a - c) <= tol;

  /** The sheet's elements and their boxes (window px). */
  function sheet() {
    const chrome = document.querySelector("#layer-peek > .vp-sheet");
    const frame = gBrowser.tabpanels.querySelector(".vitre-peek-frame");
    const dim = gBrowser.tabpanels.querySelector(".vitre-peek-dim");
    const panel = gBrowser.tabpanels.querySelector(".vitre-peek-panel");
    const head = chrome?.querySelector(".vp-head");
    const br = peek()?.browser();
    return {
      chrome: chrome && R(chrome.getBoundingClientRect()),
      shown: !!chrome?.classList.contains("on"),
      frame: frame && R(frame.getBoundingClientRect()),
      dimOn: !!dim?.classList.contains("on"),
      dimOpacity: dim ? getComputedStyle(dim).opacity : null,
      panel: panel && R(panel.getBoundingClientRect()),
      browser: br && R(br.getBoundingClientRect()),
      head: head && R(head.getBoundingClientRect()),
      host: chrome?.querySelector(".vp-id:last-child .dom")?.textContent ?? null,
      path: chrome?.querySelector(".vp-id:last-child .path")?.textContent ?? null,
      back: !!head?.classList.contains("can-back"),
      cover: chrome ? getComputedStyle(chrome.querySelector(".vp-cover")).opacity : null,
      snapshot: !!chrome?.querySelector(".vp-snap.on"),
      loading: !!chrome?.querySelector(".vp-load.loading"),
    };
  }

  /** Watch a browser's top-level document loads (STATE_START of a document) from now on. */
  function countLoads(browser) {
    const box = { loads: 0, stop() {} };
    const listener = {
      onStateChange(br, wp, _req, flags) {
        if (br === browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) box.loads++;
      },
    };
    gBrowser.addTabsProgressListener(listener);
    box.stop = () => gBrowser.removeTabsProgressListener(listener);
    return box;
  }

  /** Hidden tabs (peeks, warm or open) and the closed-tab list of this window. */
  function tabsInfo() {
    const all = Array.from(gBrowser.tabs);
    let closed = [];
    try {
      closed = window.SessionStore.getClosedTabDataForWindow(window).map((c) => c.state?.entries?.[c.state.index - 1]?.url ?? c.title);
    } catch (e) {
      closed = ["err " + e];
    }
    return { total: all.length, hidden: all.filter((t) => t.hidden).length, bar: b.tabs.length, closed };
  }

  /** Synthesize a key in this window; spec like "Shift+Enter", "Escape", "Alt+Left". */
  const press = (spec, opts = {}) => spike.press(spec, opts);

  /** Put keyboard focus in the sheet's page the way a click would (the focus manager activates its frame). */
  async function focusPeek() {
    const br = peek().browser();
    const r = br.getBoundingClientRect();
    mouse(r.right - 30, r.bottom - 30);
    await sleep(250);
    return Services.focus.focusedContentBrowsingContext === br.browsingContext;
  }

  /** Size the window so its inner (client) area is w×h, as on the boards. */
  async function size(w = 1440, h = 900) {
    await spike.resize(w, h);
    await spike.resize(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
  }

  return { b, base, xsite, page, peek, size, inContent, state, rectOf, mouse, move, shiftClick, waitOpen, waitClosed, load, R, near, sheet, countLoads, tabsInfo, press, focusPeek };
})();
