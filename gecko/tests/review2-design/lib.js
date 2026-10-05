// Helpers for the design review scripts (tests/review2-design/run.py). Gives window.R.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
window.R = (() => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const EU = spike.EU;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const local = (path) => `http://127.0.0.1:${port}${path}`;
  const outName = PathUtils.filename(spike.outDir);
  const outUrl = (name) => local("/out/" + outName + "/" + name);
  const cs = (el) => window.getComputedStyle(el);
  const R4 = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
  };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async () => {
    try {
      await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "settle" });
    } catch {}
    await sleep(150);
  };
  async function inner(w, h) {
    for (let i = 0; i < 2; i++) {
      window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
      window.moveTo(30, 30);
      await sleep(500);
      if (window.innerWidth === w && window.innerHeight === h) break;
    }
  }
  async function go(url, t = b.active(), settle = 700) {
    b.navigate(t, url);
    await waitFor(() => t.browser.currentURI.spec.startsWith(url.slice(0, 30)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(settle);
    await settled();
    return t;
  }
  async function open(url, settle = 700) {
    const t = b.newTab(url);
    await waitFor(() => t.browser.currentURI.spec.startsWith(url.slice(0, 30)) && !t.loading, { timeout: 30000, what: "open " + url });
    await sleep(settle);
    await settled();
    return t;
  }
  const mouse = (x, y, opts = {}) => EU.synthesizeMouseAtPoint(x, y, opts, window);
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
  let seq = 0;
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "r2d:" + ++seq;
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
  async function rectOf(selector, browser = b.active().browser, scroll = false) {
    const r = await inContent(browser, (content, a) => {
      const el = content.document.querySelector(a.selector);
      if (!el) return null;
      if (a.scroll) el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, { selector, scroll });
    if (!r || r.error) return null;
    const br = browser.getBoundingClientRect();
    return { x: br.left + r.x, y: br.top + r.y, w: r.w, h: r.h, cx: br.left + r.x + r.w / 2, cy: br.top + r.y + r.h / 2 };
  }
  const menus = () => window.vitreMenus;
  const menuOpen = () => !!menus() && menus().state().open;
  async function waitMenu(ms = 4000) {
    try {
      await waitFor(() => menuOpen(), { timeout: ms, what: "menu open" });
      await sleep(320);
      return true;
    } catch {
      return false;
    }
  }
  function menuDump(tag) {
    const st = menus().state();
    const el = document.querySelector("#layer-menus .vt-menu, #vitre-menus-top .vt-menu");
    const o = { rows: st.rows.map((r) => r.label + (r.key ? " [" + r.key + "]" : "") + (r.disabled ? " (off)" : "")), rect: el && R4(el), cls: el && el.className, tint: el && cs(el).backgroundColor };
    dump(tag, o);
    return o;
  }
  async function closeMenu() {
    if (menuOpen()) {
      menus().view?.close?.();
      try {
        b.service("menus")?.close();
      } catch {}
      await sleep(300);
    }
  }
  const setSettings = async (patch, ms = 600) => {
    b.sys("VitreSettings").set(patch);
    await sleep(ms);
  };
  const shot = async (name) => {
    await spike.capture(name);
  };
  /** Errors from chrome://vitre in the console so far. */
  function errors() {
    return Services.console.getMessageArray().filter((m) => m instanceof Ci.nsIScriptError && m.flags === 0 && /chrome:\/\/vitre\//.test(m.sourceName || "")).map((m) => m.errorMessage + " @" + m.sourceName + ":" + m.lineNumber);
  }
  return { b, site, local, outUrl, cs, R4, dump, settled, inner, go, open, mouse, rightClick, click, inContent, rectOf, menus, menuOpen, waitMenu, menuDump, closeMenu, setSettings, shot, errors, EU, log, sleep, waitFor };
})();
