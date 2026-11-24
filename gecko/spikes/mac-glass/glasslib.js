// Helpers for the mac-glass spike (real Liquid Glass panels). Load after spike-lib with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
// Gives window.G. Test-only: it builds XUL <panel>s at runtime the way
// src/window/modules/menus/panelhost.ts does (menupopup appearance from toolkit popup.css, so the
// popup window is wrapped in NSGlassEffectView on macOS 26), and never touches Deer's own code.
/* global spike, Services, Ci, Cc, IOUtils, PathUtils */
window.G = (() => {
  const { sleep, waitFor, log } = spike;
  const b = window.vitre;

  const CSS = `
panel.gs-host {
  margin: 0; padding: 0; min-width: 0; min-height: 0;
  --panel-padding: 0px;
  --panel-border-color: transparent;
  --panel-background-color: transparent;
  --panel-border-radius: 12px;
}
panel.gs-host::part(content) {
  flex-direction: column; height: 100%; padding: 0; border: none; background: none; box-shadow: none;
}
.gs-in {
  --ink: rgba(0,0,0,0.90); --sec: rgba(0,0,0,0.62); --sep: rgba(0,0,0,0.08);
  flex: 1 1 auto; min-width: 0; min-height: 0; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: center;
  color: var(--ink);
  font: 400 14px/20px system-ui, sans-serif;
  padding: 0 14px; overflow: clip; user-select: none; cursor: default;
}
.gs-in.s-dark { --ink: #ffffff; --sec: rgba(255,255,255,0.70); --sep: rgba(255,255,255,0.10); }
.gs-in.s-auto { --ink: light-dark(rgba(0,0,0,0.90), #ffffff); --sec: light-dark(rgba(0,0,0,0.62), rgba(255,255,255,0.70)); --sep: light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.10)); }
.gs-in .sec { color: var(--sec); font-size: 12px; line-height: 16px; }
.gs-in.h24 { font-size: 12px; line-height: 24px; padding: 0 12px; flex-direction: row; justify-content: flex-start; }
.gs-in.h36 { font-size: 13px; line-height: 36px; padding: 0 14px; flex-direction: row; justify-content: flex-start; gap: 8px; align-items: center; }
.gs-in .dot { width: 14px; height: 14px; border-radius: 7px; border: 1.5px solid var(--ink); box-sizing: border-box; flex: none; }
.gs-in.menu { justify-content: flex-start; padding: 8px 6px; }
.gs-in.menu .hd { font-weight: 600; font-size: 12px; color: var(--sec); padding: 4px 12px 6px; }
.gs-in.menu .row { display: flex; justify-content: space-between; height: 32px; line-height: 32px; padding: 0 12px; border-radius: 8px; }
.gs-in.menu .row.dis { color: var(--sec); }
.gs-in.menu .row.hi { background: light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.12)); }
.gs-in.s-light.menu .row.hi { background: rgba(0,0,0,0.06); }
.gs-in.s-dark.menu .row.hi { background: rgba(255,255,255,0.12); }
.gs-in.menu .row .k { color: var(--sec); }
.gs-in.menu .sep { height: 1px; margin: 5px 12px; background: var(--sep); }
.gs-in.settings { justify-content: flex-start; padding: 22px 22px; gap: 0; }
.gs-in.settings h2 { margin: 0 0 4px; font: 700 22px/28px system-ui; }
.gs-in.settings .sec.top { margin-bottom: 16px; }
.gs-in.settings .grp { font: 600 12px/16px system-ui; color: var(--sec); margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; }
.gs-in.settings .opt { display: flex; align-items: center; justify-content: space-between; min-height: 44px; border-bottom: 1px solid var(--sep); }
.gs-in.settings .opt .t { display: flex; flex-direction: column; }
.gs-in.settings .sw { width: 38px; height: 22px; border-radius: 11px; background: #34c759; position: relative; flex: none; }
.gs-in.settings .sw::after { content: ""; position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 9px; background: #fff; }
.gs-in.settings .sw.off { background: light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.22)); }
.gs-in.settings.s-light .sw.off { background: rgba(0,0,0,0.15); }
.gs-in.settings.s-dark .sw.off { background: rgba(255,255,255,0.22); }
.gs-in.settings .sw.off::after { right: auto; left: 2px; }
.gs-in.settings .btn { display: inline-block; padding: 0 14px; height: 28px; line-height: 28px; border-radius: 14px; background: #0a84ff; color: #fff; font-weight: 500; align-self: flex-start; margin-top: 16px; }
.gs-in.tag { position: relative; }
`;

  const PANEL_ATTRS = [
    // Stay open (the spike's pieces live until the test closes them), child window of Deer's window.
    ["noautohide", "true"],
    ["level", "parent"],
    ["consumeoutsideclicks", "false"],
    ["noautofocus", "true"],
    ["norestorefocus", "true"],
    ["ignorekeys", "true"],
    ["role", "presentation"],
  ];

  const open = new Set();
  let seq = 0;
  const popupSet = () => document.getElementById("mainPopupSet") ?? document.documentElement;

  function ensureCss() {
    b.css("mac-glass-spike", CSS);
  }

  const schemeClass = (scheme) => (scheme === "light" ? "s-light" : scheme === "dark" ? "s-dark" : "s-auto");

  /**
   * A real glass piece at window CSS px (x, y), w x h, color-scheme `scheme` ("light", "dark",
   * "light dark"), holding `html` in a .gs-in div with extra classes `cls`. Opens it and waits for
   * popupshown. `style` is extra inline CSS for the panel; `inStyle` for the content div.
   */
  async function panel({ x, y, w, h, scheme = "light dark", html = "", cls = "", style = "", inStyle = "", attrs = {}, wait = true, name = "", pcls = "" }) {
    ensureCss();
    const p = document.createXULElement("panel");
    p.id = "gs-panel-" + ++seq;
    p.className = "gs-host" + (pcls ? " " + pcls : "");
    for (const [k, v] of PANEL_ATTRS) p.setAttribute(k, v);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    if (style) p.setAttribute("style", style);
    p.style.colorScheme = scheme;
    const div = document.createElement("div");
    div.className = "gs-in " + schemeClass(scheme) + " " + cls;
    if (inStyle) div.setAttribute("style", inStyle);
    div.innerHTML = html;
    p.append(div);
    popupSet().append(p);
    p.sizeTo(w, h);
    const shown = new Promise((r) => p.addEventListener("popupshown", r, { once: true }));
    p.openPopupAtScreen(Math.round(window.mozInnerScreenX + x), Math.round(window.mozInnerScreenY + y), false);
    if (wait) await Promise.race([shown, sleep(3000)]);
    p._gs = { x, y, w, h, scheme, name: name || p.id, div };
    open.add(p);
    return p;
  }

  function close(p) {
    try {
      if (p.state === "open" || p.state === "showing") p.hidePopup(false);
    } catch (e) {
      log("WARN hide failed " + e);
    }
    p.remove();
    open.delete(p);
  }

  function closeAll() {
    for (const p of [...open]) close(p);
  }

  /** Every open piece's place in capture pixels of spike.captureScreen (the window's outer frame at 2x). */
  function layout(tag) {
    const scale = window.devicePixelRatio || 2;
    const ox = window.mozInnerScreenX - window.screenX;
    const oy = window.mozInnerScreenY - window.screenY;
    const pieces = [...open].map((p) => {
      const r = p.getOuterScreenRect ? p.getOuterScreenRect() : null;
      return {
        name: p._gs.name,
        scheme: p._gs.scheme,
        state: p.state,
        // asked-for rect, capture px
        px: [(ox + p._gs.x) * scale, (oy + p._gs.y) * scale, p._gs.w * scale, p._gs.h * scale].map(Math.round),
        // where the popup really is (screen CSS px -> capture px)
        real: r ? [(r.x - window.screenX) * scale, (r.y - window.screenY) * scale, r.width * scale, r.height * scale].map(Math.round) : null,
        ink: getComputedStyle(p._gs.div).color,
      };
    });
    log("LAYOUT " + JSON.stringify({ tag, scale, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], inner: [window.mozInnerScreenX, window.mozInnerScreenY], pieces }));
  }

  /** Run fn(content, arg) in the top frame of a browser (a frame script) and return its result. */
  let fs = 0;
  function inContent(browser, fn, arg) {
    return new Promise((resolve) => {
      const id = "glass-spike:" + ++fs;
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

  async function load(url, settle = 600) {
    const t = b.active();
    b.navigate(t, url);
    await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "load " + url.slice(0, 60) });
    await sleep(settle);
    return t;
  }

  /** A data: page with a fixed caption at the bottom (id=cap) the test fills before each capture. */
  const page = (title, bg, fg, body, capColor) =>
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<!doctype html><meta charset=utf-8><title>${title}</title><body style="margin:0;background:${bg};color:${fg};font:17px/1.5 Georgia">${body}` +
        `<div id=cap style="position:fixed;left:30px;right:auto;max-width:1300px;bottom:8px;padding:4px 10px;border-radius:8px;background:${bg};font:600 14px/1.45 system-ui;color:${capColor || fg};white-space:pre-line"></div>`
    );

  async function caption(text) {
    const br = b.active()?.browser;
    if (!br) return;
    await inContent(
      br,
      (content, t) => {
        let c = content.document.getElementById("cap");
        if (!c) {
          c = content.document.createElement("div");
          c.id = "cap";
          c.style.cssText = "position:fixed;left:40px;right:40px;bottom:12px;font:600 14px/1.45 system-ui;color:#fff;text-shadow:0 1px 3px #000;white-space:pre-line;z-index:99999";
          (content.document.body || content.document.documentElement).append(c);
        }
        c.textContent = t;
        return true;
      },
      text
    );
  }

  return { CSS, panel, close, closeAll, layout, inContent, load, page, caption, open, ensureCss };
})();
