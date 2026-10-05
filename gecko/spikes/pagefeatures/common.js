// Shared test helpers for the pagefeatures boot scripts (NOT part of the recipe: Vitre itself
// needs none of this; it only drives the features without OS input).
/* global Services, Cc, Ci, Cu, gBrowser, spike */
window.pf = (() => {
  const base = Services.env.get("VITRE_PF_BASE");
  const sys = Cu.getGlobalForObject(Services);
  // The runtime loads the boot script into EVERY browser window; only the first one drives the test.
  const secondary = !!sys.__pfStarted;
  sys.__pfStarted = true;

  // Mochitest's EventUtils ships inside the remote agent; it synthesizes real widget-level input
  // in-process (no OS focus needed), and the events cross into remote content like real ones.
  const EU = { window, parent: window, _EU_Ci: Ci, _EU_Cc: Cc };
  Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU);

  let seq = 0;
  /** Run `fn(content, arg)` in the top frame of a browser (frame script) and return its result. */
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "pf:" + ++seq;
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

  /** Rect of a content element (by selector, optionally inside an iframe) in chrome-window CSS px. */
  async function rectOf(browser, selector, frameSelector) {
    const r = await inContent(
      browser,
      (content, a) => {
        let doc = content.document;
        let ox = 0, oy = 0;
        const f = a.frameSelector ? doc.querySelector(a.frameSelector) : null;
        if (f) doc = f.contentDocument;
        const el = doc.querySelector(a.selector);
        if (!el) return null;
        if (a.scroll) {
          if (f) f.scrollIntoView({ block: "center" });
          el.scrollIntoView({ block: "center" });
        }
        if (f) {
          const fr = f.getBoundingClientRect();
          ox = fr.left + f.clientLeft;
          oy = fr.top + f.clientTop;
        }
        const b = el.getBoundingClientRect();
        return { x: b.left + ox, y: b.top + oy, w: b.width, h: b.height };
      },
      { selector, frameSelector, scroll: true }
    );
    if (!r) return null;
    const br = browser.getBoundingClientRect();
    return { x: br.left + r.x, y: br.top + r.y, w: r.w, h: r.h, cx: br.left + r.x + r.w / 2, cy: br.top + r.y + r.h / 2 };
  }

  const mouse = (x, y, opts = {}) => EU.synthesizeMouseAtPoint(x, y, opts, window);
  const rightClick = (x, y, opts = {}) => {
    // What Windows sends: down, up, then contextmenu on release.
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2, ...opts }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2, ...opts }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2, ...opts }, window);
  };
  const key = (k, mods = {}) => EU.synthesizeKey(k, mods, window);
  const type = (s) => EU.sendString(s, window);

  async function until(fn, ms = 5000, step = 50) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await spike.sleep(step);
    }
  }

  async function browserLoaded(browser, urlPart) {
    return until(
      () => !browser.webProgress?.isLoadingDocument && browser.currentURI.spec.includes(urlPart || "http") && browser.currentURI.spec !== "about:blank",
      15000,
      100
    );
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
      return "<clipboard error " + e + ">";
    }
  }

  /** Wait for the clipboard to hold `want` (copy commands run in the content process, asynchronously). */
  async function clipboardIs(want, ms = 3000) {
    let last = null;
    await until(() => (last = readClipboard()) === want, ms, 100);
    return last;
  }

  return { base, secondary, EU, inContent, rectOf, mouse, rightClick, key, type, until, browserLoaded, readClipboard, clipboardIs };
})();
