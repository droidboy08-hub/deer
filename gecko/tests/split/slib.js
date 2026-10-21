// Helpers for the split view tests (tests/split/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
// Gives window.SL. Pages come from the local server tests/split/all.py starts (SPLIT_PORT): light.html
// (Field Notes, a light page), dark.html (Tideline, a dark page), links.html, focus.html, flat.html
// (Flat Mark: a flat white favicon). Input is synthesized in-process (spike.press / spike.click /
// EventUtils), never OS input; real mouse input is shut out (below).
/* global spike, Services, Ci, gBrowser */
window.SL = (() => {
  const b = window.vitre;
  const { sleep } = spike;
  const port = Services.env.get("SPLIT_PORT");

  // The person's cursor over the test window (or resting there while a window opens or closes under
  // it) makes Windows send a WM_MOUSEMOVE or WM_MOUSELEAVE, which Gecko takes as the pointer's new
  // place: it replaces the synthesized pointer and the hover with it, so a link hovered in a pane is
  // left a moment later and the status bubble rightly follows the real pointer (extras.js section 1
  // failed that way about 1 run in 3). Gecko drops every mouse event not synthesized for tests from
  // here on, in every window of this process (what mochitests do with EventUtils.disableNonTestMouseEvents).
  window.windowUtils.disableNonTestMouseEvents(true);

  const http = (leaf, host = "127.0.0.1") => `http://${host}:${port}/${leaf}`;

  /** Wait until fn() is truthy (polls every 50 ms). Returns its value, or null after `timeout`. */
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

  /** A tab's page has loaded `url` (its address and not loading). */
  const loaded = (t, url) => !!t && b.tabs.includes(t) && (!url || t.url === url) && !t.loading && !t.deferred && t.browser.currentURI.spec !== "about:blank";

  /** Load a URL in a tab (default: the active one) and wait for it. */
  async function load(url, tab = b.active()) {
    b.navigate(tab, url);
    await until(() => loaded(tab, url), 20000);
    await sleep(250);
    return tab;
  }

  /** A background tab on `url`, loaded. */
  async function tab(url) {
    const t = b.newTab(url, { background: true, index: b.tabs.length });
    await until(() => loaded(t, url), 20000);
    await sleep(200);
    return t;
  }

  /** The window's tabs reset to one active tab on light.html plus background tabs on `others`. */
  async function scene(others = ["dark.html"]) {
    const first = b.tabs[0];
    for (const t of b.tabs.slice(1)) b.closeTab(t);
    for (const p of b.splitView.pairs()) b.separate(p.left);
    await sleep(100);
    b.activate(first);
    await load(http("light.html"), first);
    const made = [first];
    for (const leaf of others) made.push(await tab(http(leaf)));
    b.activate(first);
    b.focusPage();
    // Under load a tab's label can follow its page a moment after the load (Firefox sets it from the
    // document's title): wait for it, so names and hosts are the pages'.
    await until(() => made.every((t) => !t.loading && t.title && t.title !== "New Tab" && t.title === (t.browser.contentTitle || t.title)), 10000);
    await sleep(300);
    return made;
  }

  /**
   * Run a function in a page (content process); resolves with its JSON result. `arg` (JSON) is
   * passed as the third parameter: (content, doc, arg). browser.xhtml's CSP forbids new Function,
   * so arguments travel as JSON in the frame script's source.
   */
  function inPage(fn, browser = gBrowser.selectedBrowser, arg = null) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "SL:r" + Math.random();
      const on = (m) => {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document, " + JSON.stringify(arg) + "); } catch (e) { r = 'ERR ' + e; } sendAsyncMessage(" + JSON.stringify(id) + ", r); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
  };
  const panel = (t) => document.getElementById(t.node.linkedPanel);
  const pairItem = () => document.querySelector("#vitre-bar .item.pair:not(.leaving)");
  const half = (side) => pairItem()?.querySelector(`.split-face .half.${side}`);
  const divider = () => document.querySelector("#vitre-split .sp-divider");
  const rims = () => [...document.querySelectorAll("#vitre-split .sp-rim")];
  /** The bar's drawn items (not leaving) as { key, x, w, active, pair }. */
  const items = () =>
    [...document.querySelectorAll("#vitre-bar .item:not(.leaving)")]
      .map((el) => ({ key: el.dataset.id ?? el.dataset.pair ?? "plus", x: Math.round(parseFloat(el.style.left)), w: Math.round(parseFloat(el.style.width)), active: el.classList.contains("active"), pair: el.classList.contains("pair"), mixed: el.classList.contains("mixed") }))
      .sort((a, c) => a.x - c.x);

  /** The live panes: rects of the two panels of the active pair (or null). */
  function panes() {
    const p = b.splitView.showing();
    if (!p) return null;
    return { left: rect(panel(p.left)), right: rect(panel(p.right)) };
  }

  /** Wait for the active pair to show (both panes laid out). */
  const shown = () => until(() => b.splitView.showing() && panes()?.left?.w > 0 && panes()?.right?.w > 0, 8000);

  /** Wait until the bar has settled (lenses in). */
  const settled = () => until(() => b.bar.state.settled, 3000);

  /** Synthesize a mouse event at window coordinates (type: mousedown, mouseup, mousemove...). */
  function mouse(x, y, opts = {}) {
    spike.EU.synthesizeMouseAtPoint(x, y, opts, window);
  }

  /** Synthesize a pointer drag on an element in steps (pointer capture follows). */
  async function drag(el, from, to, steps = 8, opts = {}) {
    const EU = spike.EU;
    EU.synthesizeMouseAtPoint(from.x, from.y, { type: "mousedown", ...opts }, window);
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      EU.synthesizeMouseAtPoint(x, y, { type: "mousemove", buttons: 1, ...opts }, window);
      await new Promise((r) => requestAnimationFrame(() => r()));
      await sleep(16);
    }
    if (!opts.noUp) EU.synthesizeMouseAtPoint(to.x, to.y, { type: "mouseup", ...opts }, window);
    await sleep(120);
  }

  // ---- Deer's menus (window.vitreMenus: the menus module's test hook) ----
  const M = () => window.vitreMenus;
  const menuOpen = () => !!M() && M().state().open;
  /** The open menu's rows: { label, key, disabled }. */
  const rows = () => (menuOpen() ? M().state().rows : []);
  const labels = () => rows().map((r) => r.label);
  /** What Windows sends for a right-click: move, down, up, then contextmenu. */
  function rightClick(x, y) {
    const EU = spike.EU;
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
  }
  /** Right-click a chrome element's centre (or a window point) and wait for Deer's menu; its labels. */
  async function menuAt(target, y) {
    closeMenu();
    await sleep(100);
    if (typeof target === "number") rightClick(target, y);
    else {
      const r = target.getBoundingClientRect();
      rightClick(r.left + r.width / 2, r.top + r.height / 2);
    }
    await until(() => menuOpen(), 4000);
    await sleep(260);
    return labels();
  }
  /** Click a row of the open menu (by label or label prefix). */
  async function pick(label) {
    const st = M().state();
    const i = st.rows.findIndex((r) => r.label === label || r.label.startsWith(label));
    if (i < 0) throw new Error("no menu row " + label + " in " + JSON.stringify(st.rows.map((r) => r.label)));
    const el = M().view.rowElement(i, 0);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(60, r.width / 2);
    const yy = r.top + r.height / 2;
    const EU = spike.EU;
    EU.synthesizeMouseAtPoint(x, yy, { type: "mousemove" }, window);
    await sleep(40);
    EU.synthesizeMouseAtPoint(x, yy, { type: "mousedown" }, window);
    EU.synthesizeMouseAtPoint(x, yy, { type: "mouseup" }, window);
    await until(() => !menuOpen(), 3000);
    await sleep(250);
  }
  function closeMenu() {
    try {
      if (menuOpen()) M().api.close();
    } catch {
      /* none */
    }
  }

  /**
   * The keyboard menu, as Windows sends it for Shift+F10 and the Menu key: WM_CONTEXTMENU with
   * lParam -1, posted to this window (tests/menus/lib.js keyboardMenu). It opens on the focused element.
   */
  function keyboardMenu() {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    PostMessageW(ctypes.voidptr_t(ctypes.UInt64(handle)), 0x007b, ctypes.UInt64(handle), -1);
    user32.close();
  }

  /** Send a hardware key or mouse side button (an AppCommand event, as Gecko makes from WM_APPCOMMAND). */
  function appCommand(command) {
    const ev = new Event("AppCommand", { bubbles: true });
    ev.command = command;
    window.dispatchEvent(ev);
  }

  /** An element of a page, in window coordinates (centre cx / cy). */
  async function pageRect(selector, browser = gBrowser.selectedBrowser) {
    const r = await inPage(
      (content, doc, sel) => {
        const el = doc.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      },
      browser,
      selector
    );
    if (!r || typeof r === "string") return null;
    const br = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    const x = br.left + r.x * z;
    const y = br.top + r.y * z;
    return { x, y, w: r.w * z, h: r.h * z, cx: x + (r.w * z) / 2, cy: y + (r.h * z) / 2 };
  }

  return { b, http, until, loaded, load, tab, scene, inPage, rect, panel, pairItem, half, divider, rims, items, panes, shown, settled, mouse, drag, menuAt, menuOpen, rows, labels, pick, closeMenu, rightClick, keyboardMenu, appCommand, pageRect };
})();
