// Helpers for the menus tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.M. Input is synthesized in-process (EventUtils): a right-click is mousedown + mouseup
// + a contextmenu event, as Windows sends them; the real keyboard path is a WM_CONTEXTMENU posted
// to this window's HWND (what Windows sends for Shift+F10 and the Menu key; pagefeatures correction 7).
// Test pages are served over http by tests/menus/all.py (VITRE_MENUS_BASE); without it, file: URLs.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
window.M = (() => {
  const { sleep, waitFor } = spike;
  const b = window.vitre;
  const EU = spike.EU;

  const bootFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  bootFile.initWithPath(Services.env.get("VITRE_BOOT"));
  const dir = bootFile.parent;
  const base = Services.env.get("VITRE_MENUS_BASE") || "";
  /** URL of a test page (tests/menus/pages/<leaf>). */
  function page(leaf) {
    if (base) return base + "pages/" + leaf;
    const f = dir.clone();
    f.append("pages");
    for (const part of leaf.split("/")) f.append(part);
    return Services.io.newFileURI(f).spec;
  }
  /** URL of a file the test wrote into its output folder (served at /out/ by all.py). */
  function outUrl(name) {
    if (base) return base + "out/" + name;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(PathUtils.join(spike.outDir, name));
    return Services.io.newFileURI(f).spec;
  }

  const menus = () => window.vitreMenus;
  const state = () => menus().state();
  const isOpen = () => !!menus() && state().open;
  const labels = () => state().rows.map((r) => r.label);
  const last = () => menus().last;

  let seq = 0;
  /** Run fn(content, arg) in the top frame of a browser (a frame script) and return its result. */
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "menus-test:" + ++seq;
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

  const active = () => b.active().browser;

  /** An element's rectangle in window CSS px (optionally inside a same-origin iframe), scrolled into view first. */
  async function rectOf(selector, opts = {}) {
    const browser = opts.browser || active();
    const r = await inContent(
      browser,
      (content, a) => {
        let doc = content.document;
        let ox = 0;
        let oy = 0;
        const f = a.frame ? doc.querySelector(a.frame) : null;
        if (f) doc = f.contentDocument;
        const el = doc.querySelector(a.selector);
        if (!el) return null;
        if (a.scroll) {
          if (f) f.scrollIntoView({ block: "center" });
          else el.scrollIntoView({ block: a.block || "center" });
        }
        if (f) {
          const fr = f.getBoundingClientRect();
          ox = fr.left + f.clientLeft;
          oy = fr.top + f.clientTop;
        }
        const r = el.getBoundingClientRect();
        return { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height };
      },
      { selector, frame: opts.frame || null, scroll: opts.scroll !== false, block: opts.block || "center" }
    );
    if (!r || r.error) return null;
    const br = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    const x = br.left + r.x * z;
    const y = br.top + r.y * z;
    return { x, y, w: r.w * z, h: r.h * z, cx: x + (r.w * z) / 2, cy: y + (r.h * z) / 2, right: x + r.w * z, bottom: y + r.h * z };
  }

  const mouse = (x, y, opts = {}) => EU.synthesizeMouseAtPoint(x, y, opts, window);
  /** What Windows sends for a right-click: down, up, then contextmenu on the release. */
  function rightClick(x, y, opts = {}) {
    const extra = { ...opts };
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove", ...extra }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2, ...extra }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2, ...extra }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2, ...extra }, window);
  }
  const key = (k, mods = {}) => EU.synthesizeKey(k, mods, window);

  async function waitOpen(ms = 4000) {
    try {
      await waitFor(() => isOpen(), { timeout: ms, what: "menu open" });
      await sleep(260); // the open motion (200 ms) has landed
      return true;
    } catch {
      return false;
    }
  }
  async function waitClosed(ms = 4000) {
    try {
      await waitFor(() => !isOpen(), { timeout: ms, what: "menu closed" });
      return true;
    } catch {
      return false;
    }
  }

  /** Right-click an element of the active page (centre, or dx / dy from its top-left) and wait for the menu. */
  async function openOn(selector, opts = {}) {
    const r = await rectOf(selector, opts);
    if (!r) throw new Error("no element " + selector);
    await sleep(opts.settle ?? 200);
    const x = opts.dx != null ? r.x + opts.dx : r.cx;
    const y = opts.dy != null ? r.y + opts.dy : r.cy;
    const pages = last().pageMenus;
    rightClick(x, y, opts.mods || {});
    const ok = opts.expectNone ? false : await waitOpen(opts.timeout ?? 4000);
    if (!ok && opts.expectNone) await sleep(700);
    return { ok, x, y, rect: r, newPageMenu: last().pageMenus > pages };
  }

  /** Click a row of the open menu by label (mouse: move, press, release on its centre). */
  async function pick(label, opts = {}) {
    const st = state();
    const i = st.rows.findIndex((r) => r.label === label || (opts.prefix && r.label.startsWith(label)));
    if (i < 0) throw new Error("no row " + label + " in " + JSON.stringify(st.rows.map((r) => r.label)));
    const el = menus().view.rowElement(i, opts.depth || 0);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(60, r.width / 2);
    const y = r.top + r.height / 2;
    mouse(x, y, { type: "mousemove" });
    await sleep(opts.hover ?? 40);
    mouse(x, y, { type: "mousedown", button: opts.button ?? 0 });
    mouse(x, y, { type: "mouseup", button: opts.button ?? 0 });
    if (opts.stayOpen) return true;
    return waitClosed();
  }

  function readClipboard() {
    try {
      const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      trans.init(null);
      trans.addDataFlavor("text/plain");
      Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard);
      const out = {};
      trans.getTransferData("text/plain", out);
      return out.value.QueryInterface(Ci.nsISupportsString).data;
    } catch (e) {
      return "";
    }
  }
  function setClipboard(text) {
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
  }
  async function clipboardIs(want, ms = 3000) {
    let got = "";
    const end = Date.now() + ms;
    while (Date.now() < end) {
      got = readClipboard();
      if (got === want) return got;
      await sleep(80);
    }
    return got;
  }

  /** Load a URL in the active tab and wait until it has loaded. */
  async function load(url, settle = 500) {
    const t = b.active();
    b.navigate(t, url);
    await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "load " + url });
    await sleep(settle);
    return t;
  }

  /** Stand-ins for the services other modules provide (they are built in parallel): each records its calls. */
  function fakeServices(which = ["peek", "find", "downloads", "settings"]) {
    const calls = [];
    const rec = (name) => (...args) => calls.push({ name, args });
    const fakes = {
      peek: { open: rec("peek.open"), isOpen: () => false, browser: () => null, close: rec("peek.close"), promote: rec("peek.promote"), headerRect: () => null, canReopen: () => false, reopen: rec("peek.reopen") },
      find: { open: rec("find.open"), close: rec("find.close"), isOpen: () => false },
      downloads: { download: rec("downloads.download"), openPanel: rec("downloads.openPanel"), videoPicker: rec("downloads.videoPicker") },
      settings: { open: rec("settings.open"), registerPage: () => () => {}, changeBackground: rec("settings.changeBackground") },
    };
    for (const name of which) b.provide(name, fakes[name]);
    return { calls, fakes, take: () => calls.splice(0) };
  }

  /** Post a real Win32 message to this window (WM_CONTEXTMENU with lParam -1 is the keyboard menu). */
  function win32() {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(handle));
    return {
      post: (msg, wParam, lParam) => PostMessageW(hwnd, msg, wParam, lParam),
      self: ctypes.UInt64(handle),
    };
  }
  const WM_CONTEXTMENU = 0x007b;
  /** The keyboard menu, as Windows sends it for Shift+F10 / the Menu key. */
  function keyboardMenu() {
    const w = win32();
    w.post(WM_CONTEXTMENU, w.self, -1);
  }

  /** A video file made here (MediaRecorder on a canvas), written to the output folder. */
  async function makeVideo(name, seconds = 1.5) {
    const H = "http://www.w3.org/1999/xhtml";
    const canvas = document.createElementNS(H, "canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.fillStyle = "#16324a";
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = "#e9b949";
        ctx.fillRect(20 + t * 120, 70, 60, 60);
        ctx.fillStyle = "#ffffff";
        ctx.font = "22px Segoe UI";
        ctx.fillText("video " + t.toFixed(1), 20, 40);
        if (t < seconds) requestAnimationFrame(frame);
        else done();
      };
      frame();
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    const path = PathUtils.join(spike.outDir, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return outUrl(name);
  }

  /** Make the window the focus manager's active one (spelling, caret anchors and key routing need it). */
  const activate = () => spike.activate();

  /** Log a compact line for the open menu. */
  function describe(tag) {
    const st = state();
    // DESIGN-NOTES: at most 10 actionable rows, access keys unique in a menu (extension items aside).
    const own = st.rows.filter((r) => !/^moz-extension:/.test(r.icon) && !r.label.startsWith("Probe:") && r.label !== "Vitre menus probe");
    const keys = own.map((r) => r.access).filter(Boolean);
    spike.check(tag + ": at most 10 rows, unique access keys", own.length <= 10 && new Set(keys).size === keys.length, { rows: own.length, keys });
    spike.log(tag, JSON.stringify({ rows: st.rows.map((r) => r.label + (r.key ? " [" + r.key + "]" : "") + (r.disabled ? " (off)" : "") + (r.checked !== undefined ? (r.checked ? " (on)" : " (unchecked)") : "")), captions: st.captions, rect: st.rect && [Math.round(st.rect.left), Math.round(st.rect.top), Math.round(st.rect.width), Math.round(st.rect.height)], active: st.active, classes: st.classes, wash: st.wash }));
    return st;
  }

  /** Expected height from the spec formula: 12 + 34 x rows + 9 x separators + 28 x captions. */
  function expectedHeight(view) {
    const el = view.rowElement(0)?.closest(".vt-menu");
    if (!el) return 0;
    const list = el.querySelector(".vt-menu-list");
    let h = 12;
    for (const c of list.children) {
      if (c.classList.contains("vt-mi")) h += parseFloat(getComputedStyle(c).height);
      else if (c.classList.contains("vt-sep")) h += 9;
      else if (c.classList.contains("vt-caption")) h += 28;
    }
    return h;
  }

  return { b, base, page, outUrl, menus, state, isOpen, labels, last, inContent, rectOf, mouse, rightClick, key, waitOpen, waitClosed, openOn, pick, readClipboard, setClipboard, clipboardIs, load, fakeServices, keyboardMenu, win32, makeVideo, activate, describe, expectedHeight };
})();
