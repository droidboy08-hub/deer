// Helpers for the integration tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.I. Pages come from tests/integrate/pages over http (INTEG_BASE, all.py); files a test
// writes into its output folder are served at /out/<name>/. Input is synthesized in-process.
/* global spike, Services, Cc, Ci, ChromeUtils, Components, gBrowser, IOUtils, PathUtils */
window.I = (() => {
  const { sleep, waitFor, log } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  const base = Services.env.get("INTEG_BASE") || "";
  const xsite = Services.env.get("INTEG_XSITE") || "";
  const dlDir = Services.env.get("INTEG_DL") || "";
  const extDir = Services.env.get("INTEG_EXT") || "";
  const outName = PathUtils.filename(spike.outDir);

  const page = (leaf) => base + leaf;
  const xpage = (leaf) => xsite + leaf;
  const outUrl = (name) => base + "out/" + outName + "/" + name;

  let seq = 0;
  /** Run fn(content, arg) in the top frame of a browser (a frame script) and return its result. */
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "integ-test:" + ++seq;
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

  /** An element's rectangle in window CSS px, scrolled into view first (unless scroll: false). */
  async function rectOf(selector, opts = {}) {
    const browser = opts.browser || b.active().browser;
    const r = await inContent(
      browser,
      (content, a) => {
        const el = content.document.querySelector(a.selector);
        if (!el) return null;
        if (a.scroll) el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      { selector, scroll: opts.scroll !== false }
    );
    if (!r || r.error) return null;
    const br = browser.getBoundingClientRect();
    const z = browser.fullZoom || 1;
    const x = br.left + r.x * z;
    const y = br.top + r.y * z;
    return { x, y, w: r.w * z, h: r.h * z, cx: x + (r.w * z) / 2, cy: y + (r.h * z) / 2, right: x + r.w * z, bottom: y + r.h * z };
  }

  const mouse = (x, y, opts = {}) => EU.synthesizeMouseAtPoint(x, y, opts, window);
  /** What Windows sends for a right-click: move, down, up, then contextmenu. */
  function rightClick(x, y, opts = {}) {
    mouse(x, y, { type: "mousemove", ...opts });
    mouse(x, y, { type: "mousedown", button: 2, ...opts });
    mouse(x, y, { type: "mouseup", button: 2, ...opts });
    mouse(x, y, { type: "contextmenu", button: 2, ...opts });
  }
  function click(x, y, opts = {}) {
    mouse(x, y, { type: "mousemove", ...opts });
    mouse(x, y, { type: "mousedown", button: 0, ...opts });
    mouse(x, y, { type: "mouseup", button: 0, ...opts });
  }
  const key = (k, mods = {}) => EU.synthesizeKey(k, mods, window);

  // ---- menus (window.vitreMenus, the menus module's test hook) ----
  const menus = () => window.vitreMenus;
  const menuOpen = () => !!menus() && menus().state().open;
  const labels = () => (menus() ? menus().state().rows.map((r) => r.label) : []);
  async function waitMenu(ms = 4000) {
    try {
      await waitFor(() => menuOpen(), { timeout: ms, what: "menu open" });
      await sleep(260);
      return true;
    } catch {
      return false;
    }
  }
  async function waitMenuClosed(ms = 4000) {
    try {
      await waitFor(() => !menuOpen(), { timeout: ms, what: "menu closed" });
      return true;
    } catch {
      return false;
    }
  }
  /** Click a row of the open menu by its label (or a label starting with it). */
  async function pick(label, opts = {}) {
    const st = menus().state();
    const i = st.rows.findIndex((r) => r.label === label || (opts.prefix && r.label.startsWith(label)));
    if (i < 0) throw new Error("no row " + label + " in " + JSON.stringify(st.rows.map((r) => r.label)));
    const el = menus().view.rowElement(i);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(60, r.width / 2);
    const y = r.top + r.height / 2;
    mouse(x, y, { type: "mousemove" });
    await sleep(40);
    mouse(x, y, { type: "mousedown", button: 0 });
    mouse(x, y, { type: "mouseup", button: 0 });
    return waitMenuClosed();
  }
  /** Right-click an element of a page and wait for the menu. */
  async function menuOn(selector, opts = {}) {
    const r = await rectOf(selector, opts);
    if (!r) throw new Error("no element " + selector);
    await sleep(200);
    rightClick(opts.dx != null ? r.x + opts.dx : r.cx, opts.dy != null ? r.y + opts.dy : r.cy);
    return waitMenu();
  }
  function describeMenu(tag) {
    const st = menus().state();
    log(tag, JSON.stringify({ rows: st.rows.map((r) => r.label + (r.key ? " [" + r.key + "]" : "") + (r.disabled ? " (off)" : "")), rect: st.rect && [Math.round(st.rect.left), Math.round(st.rect.top), Math.round(st.rect.width), Math.round(st.rect.height)] }));
    return st;
  }

  /** Load a URL in the active tab and wait until it has loaded. */
  async function load(url, settle = 500) {
    const t = b.active();
    b.navigate(t, url);
    await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "load " + url });
    await sleep(settle);
    return t;
  }
  /** Open a URL in a new foreground tab and wait for it. */
  async function open(url, settle = 500) {
    const t = b.newTab(url);
    await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "open " + url });
    await sleep(settle);
    return t;
  }

  /** The inset page module's state for a browser's top document. */
  const inset = (browser, selector) => b.page(browser).query("inset:state", selector ? { selector } : {});

  /** A short webm made here (MediaRecorder on a canvas), written to the output folder; returns its URL. */
  // The downloads module ignores media files under 500 kB (thumbnail clips): a high bit rate makes
  // even a short clip count as a video worth saving.
  async function makeVideo(name, seconds = 1.5) {
    const H = "http://www.w3.org/1999/xhtml";
    const canvas = document.createElementNS(H, "canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm", videoBitsPerSecond: 8000000 });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        // Noise keeps the encoder busy (a flat picture compresses to almost nothing).
        const img = ctx.createImageData(640, 360);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          img.data[i] = v;
          img.data[i + 1] = (v * 7) & 255;
          img.data[i + 2] = 120;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        ctx.fillStyle = "#e9b949";
        ctx.fillRect(40 + t * 200, 140, 90, 90);
        if (t < seconds) requestAnimationFrame(frame);
        else done();
      };
      frame();
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    await IOUtils.write(PathUtils.join(spike.outDir, name), new Uint8Array(await blob.arrayBuffer()));
    return outUrl(name);
  }

  /** Files in the downloads folder (INTEG_DL). */
  async function downloaded() {
    try {
      return (await IOUtils.getChildren(dlDir)).map((p) => PathUtils.filename(p));
    } catch {
      return [];
    }
  }

  /**
   * A stand-in for Windows' file dialogs (nsIFilePicker): the contract's factory is replaced until the
   * returned function is called. answer({ title, mode, name }) returns the path to "choose" (or null:
   * cancelled). Every dialog asked for is recorded in `asked`.
   */
  function mockFilePicker(answer) {
    const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    const CONTRACT = "@mozilla.org/filepicker;1";
    const asked = [];
    class Picker {
      init(_bc, title, mode) {
        this.title = title;
        this.mode = mode;
      }
      appendFilters() {}
      appendFilter() {}
      open(cb) {
        const req = { title: this.title, mode: this.mode, name: this.defaultString || "" };
        const path = answer(req);
        asked.push({ ...req, path });
        if (path) {
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(path);
          this.file = f;
        }
        const result = path ? Ci.nsIFilePicker.returnOK : Ci.nsIFilePicker.returnCancel;
        Services.tm.dispatchToMainThread(() => (typeof cb === "function" ? cb(result) : cb.done(result)));
      }
    }
    Picker.prototype.QueryInterface = ChromeUtils.generateQI(["nsIFilePicker"]);
    const factory = { createInstance: (iid) => new Picker().QueryInterface(iid), QueryInterface: ChromeUtils.generateQI(["nsIFactory"]) };
    const realCid = registrar.contractIDToCID(CONTRACT);
    const mockCid = Components.ID(Services.uuid.generateUUID().toString());
    registrar.registerFactory(mockCid, "Integration test file picker", CONTRACT, factory);
    const restore = () => {
      registrar.unregisterFactory(mockCid, factory);
      registrar.registerFactory(realCid, "", CONTRACT, null);
    };
    return { asked, restore };
  }

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };

  return { b, base, xsite, dlDir, extDir, page, xpage, outUrl, inContent, rectOf, mouse, rightClick, click, key, menus, menuOpen, labels, waitMenu, waitMenuClosed, pick, menuOn, describeMenu, load, open, inset, makeVideo, downloaded, mockFilePicker, rect };
})();
