// Shared helpers for the "switcher" spike boot scripts.
// Loaded with Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window).
/* global gBrowser, Services, Ci, Cc, spike, IOUtils, PathUtils */
window.vx = (() => {
  const HTML = "http://www.w3.org/1999/xhtml";
  const SYS = Services.scriptSecurityManager.getSystemPrincipal();

  /** A self-contained test page: big number, colour, tall enough to scroll. */
  function page(n, bg, fg = "#fff", extra = "") {
    const html =
      `<!doctype html><meta charset=utf-8><title>Page ${n}</title>` +
      `<body style="margin:0;background:${bg};color:${fg};font:600 28px Segoe UI,sans-serif">` +
      `<div style="height:64px;background:${bg}"></div>` +
      `<h1 style="font-size:220px;margin:40px 80px 0">${n}</h1>` +
      `<p style="margin:0 80px">Vitre thumbnail test page ${n} &mdash; ${bg}</p>` +
      extra +
      `<div style="height:3000px;background:linear-gradient(${bg},#888)"></div></body>`;
    return "data:text/html;charset=utf-8," + encodeURIComponent(html);
  }

  const COLOURS = [
    "#b3261e", "#1d6f42", "#1a4fa3", "#7a3e9d", "#c56a00", "#0b7285",
    "#ffffff", "#101014", "#f4e9d8", "#2b2b33", "#e8f0fe", "#3a0f2a",
  ];

  function addTab(url, opts = {}) {
    return gBrowser.addTab(url, { triggeringPrincipal: SYS, ...opts });
  }

  async function waitLoaded(browser, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (browser.browsingContext && !browser.webProgress?.isLoadingDocument && browser.currentURI.spec !== "about:blank") return true;
      await spike.sleep(50);
    }
    return false;
  }

  /** Mean luma (0..1, Rec. 709) and distinct-ish colour count of an ImageBitmap / canvas / image. */
  function stats(img, w = img.width, h = img.height) {
    const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (seen.size < 64) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
    }
    return { luma: +(sum / (d.length / 4) / 255).toFixed(3), colours: seen.size };
  }

  function el(tag, style, text) {
    const e = document.createElementNS(HTML, tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  const ms = (t0) => +(performance.now() - t0).toFixed(1);

  /** Firefox ships mochitest's EventUtils for WebDriver; it synthesizes input in-process (no OS focus needed). */
  let eu = null;
  function EU() {
    if (!eu) {
      eu = { window, parent: window, _EU_Ci: Ci, _EU_Cc: Cc };
      Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", eu);
    }
    return eu;
  }

  /** Run a snippet in the content process of a remote browser (spike-only convenience). */
  function inContent(browser, js) {
    browser.messageManager.loadFrameScript("data:," + encodeURIComponent(js), false);
  }

  /**
   * Web content processes are sandboxed and cannot read the project folder, so a JSWindowActor
   * child module mapped straight from spikes/ fails with "Failed to load resource://...".
   * <profile>/chrome is readable by the content sandbox: copy the modules there and map
   * resource://<name>/ to the copy. (A shipped build keeps them in the application directory.)
   */
  async function mountForContent(subdir, name) {
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const src = Services.io.newURI(res.resolveURI(Services.io.newURI("resource://vitre-boot/" + subdir + "/"))).QueryInterface(Ci.nsIFileURL).file.path;
    const dst = PathUtils.join(PathUtils.profileDir, "chrome", name);
    await IOUtils.makeDirectory(dst, { createAncestors: true });
    for (const f of await IOUtils.getChildren(src)) await IOUtils.copy(f, PathUtils.join(dst, PathUtils.filename(f)));
    const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    dir.initWithPath(dst);
    res.setSubstitution(name, Services.io.newFileURI(dir));
    return "resource://" + name + "/";
  }

  return { mountForContent, HTML, SYS, page, COLOURS, addTab, waitLoaded, stats, el, ms, EU, inContent };
})();
