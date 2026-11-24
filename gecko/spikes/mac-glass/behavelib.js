// Helpers for the mac-glass behaviour spikes (S3, S4, S5, S7, S8, S9). Load after glasslib.js:
//   Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
//   Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
// Gives window.GB. Test-only, nothing in src/ changes:
//   - anchored glass panels: a XUL <panel> (menupopup appearance from toolkit popup.css, so the
//     popup window is wrapped in NSGlassEffectView on macOS 26), opened with
//     openPopup(anchor, position, x, y) from a placeholder <div> made at runtime in #vitre-root;
//   - GB.ask(): a request to behave_mon.py, which runs beside tools/run.py (window-server lists,
//     Accessibility, CPU, frame tracking, another app's window, real keys, screen pictures).
/* global spike, G, Services, IOUtils, PathUtils */
window.GB = (() => {
  const { sleep, log } = spike;
  const b = window.vitre;
  let seq = 0;
  /** A tag no other request of this run has. */
  const tag = (t) => `${t}-${++seq}`;

  async function flag(name, timeout) {
    const path = PathUtils.join(spike.outDir, name);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await IOUtils.exists(path)) return true;
      await sleep(25);
    }
    return false;
  }

  /** Ask behave_mon.py: `cmd t args` in the log; resolves with its JSON answer ({error} when none came). */
  async function ask(cmd, t, args = [], timeout = 30000) {
    await IOUtils.remove(PathUtils.join(spike.outDir, "beh-done-" + t), { ignoreAbsent: true });
    log(`${cmd} ${t}${args.length ? " " + args.join(" ") : ""}`);
    if (!(await flag("beh-done-" + t, timeout))) return { error: "no answer from behave_mon.py for " + t };
    try {
      return await IOUtils.readJSON(PathUtils.join(spike.outDir, "beh-" + t + ".json"));
    } catch (e) {
      return { error: String(e) };
    }
  }

  /** Send a request without waiting (CPU over a period that the test fills meanwhile); read it with result(t). */
  async function start(cmd, t, args = []) {
    await IOUtils.remove(PathUtils.join(spike.outDir, "beh-done-" + t), { ignoreAbsent: true });
    log(`${cmd} ${t}${args.length ? " " + args.join(" ") : ""}`);
  }

  /** Start a TRACK of the window server's frames; resolves once sampling runs. Read it with result(t). */
  async function startTrack(t, secs) {
    await IOUtils.remove(PathUtils.join(spike.outDir, "beh-go-" + t), { ignoreAbsent: true });
    await IOUtils.remove(PathUtils.join(spike.outDir, "beh-done-" + t), { ignoreAbsent: true });
    log(`TRACK ${t} ${secs}`);
    return flag("beh-go-" + t, 10000);
  }
  async function result(t, timeout = 60000) {
    if (!(await flag("beh-done-" + t, timeout))) return { error: "no result for " + t };
    try {
      return await IOUtils.readJSON(PathUtils.join(spike.outDir, "beh-" + t + ".json"));
    } catch (e) {
      return { error: String(e) };
    }
  }

  // ---- placeholders and markers (in a module layer of #vitre-root, pointer-transparent) ----
  const layer = () => b.layer("gb-spike", 9);
  const markLayer = () => b.layer("gb-marks", 65);
  function placeholder(id, css, where = layer()) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      where.append(el);
    }
    el.style.cssText = "position:absolute;pointer-events:none;" + css;
    return el;
  }

  // ---- panels ----
  const BASE_ATTRS = {
    level: "parent",
    noautofocus: "true",
    norestorefocus: "true",
    role: "presentation",
  };

  /**
   * An anchored glass panel. opts: anchor (element), position ("overlap", "bottomleft topleft"...),
   * x, y (offsets), w, h, scheme, html, cls (classes of the .gs-in content), autohide (false: stays
   * open), follow (followanchor), ignorekeys (true: Deer-menu style), attrs (more attributes), name,
   * marker (true: a blue 10 px square at the content's top-left + 6 px, for alignment checks).
   */
  async function anchored(o) {
    G.ensureCss();
    const p = document.createXULElement("panel");
    p.id = "gb-" + (o.name || "panel") + "-" + ++seq;
    p.className = "gs-host" + (o.pcls ? " " + o.pcls : "");
    const attrs = { ...BASE_ATTRS };
    attrs.noautohide = o.autohide ? "false" : "true";
    attrs.consumeoutsideclicks = o.autohide ? "true" : "false";
    if (o.follow !== false) attrs.followanchor = "true";
    if (o.ignorekeys !== false) attrs.ignorekeys = "true";
    Object.assign(attrs, o.attrs || {});
    for (const [k, v] of Object.entries(attrs)) if (v !== null) p.setAttribute(k, v);
    if (o.style) p.setAttribute("style", o.style);
    p.style.colorScheme = o.scheme || "light dark";
    const div = document.createElement("div");
    div.className = "gs-in " + (o.scheme === "light" ? "s-light" : o.scheme === "dark" ? "s-dark" : "s-auto") + " " + (o.cls || "");
    if (o.inStyle) div.setAttribute("style", o.inStyle);
    // Not innerHTML: in the chrome document it is sanitized and drops <input> ("Flattening unsafe node").
    const parsed = new DOMParser().parseFromString("<body>" + (o.marker ? `<div class="gb-mark" style="position:absolute;left:6px;top:6px;width:10px;height:10px;background:#0000ff"></div>` : "") + (o.html || "") + "</body>", "text/html");
    for (const n of [...parsed.body.childNodes]) div.append(document.importNode(n, true));
    if (o.marker) div.style.position = "relative";
    p.append(div);
    (document.getElementById("mainPopupSet") ?? document.documentElement).append(p);
    if (o.w && o.h) p.sizeTo(o.w, o.h);
    const shown = new Promise((r) => p.addEventListener("popupshown", r, { once: true }));
    const t0 = performance.now();
    if (o.atScreen) p.openPopupAtScreen(Math.round(window.mozInnerScreenX + o.atScreen.x), Math.round(window.mozInnerScreenY + o.atScreen.y), false);
    else p.openPopup(o.anchor, { position: o.position || "overlap", x: o.x || 0, y: o.y || 0 });
    if (o.wait !== false) await Promise.race([shown, sleep(3000)]);
    p._gb = { name: o.name || p.id, div, anchor: o.anchor || null, openedIn: Math.round(performance.now() - t0) };
    G.open.add(p);
    p.addEventListener("popuphidden", () => (p._gb.hiddenAt = performance.now()));
    return p;
  }

  /** The panel's outer rect in window CSS px (relative to the window's content origin), as Gecko has it. */
  function rect(p) {
    const r = p.getOuterScreenRect();
    return { x: Math.round(r.x - window.mozInnerScreenX), y: Math.round(r.y - window.mozInnerScreenY), w: Math.round(r.width), h: Math.round(r.height) };
  }
  /** An element's rect in window CSS px. */
  function erect(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  const state = (p) => p.state;
  const states = (ps) => Object.fromEntries(ps.map((p) => [p._gb.name, p.state]));

  /** The main window and the glass windows in a WINLIST answer, relative to the main window's content origin. */
  function rel(list) {
    const ws = (list.windows || []).filter((w) => w.who === "mine");
    const main = ws.filter((w) => w.layer === 0).sort((a, c) => c.w * c.h - a.w * a.h)[0];
    if (!main) return { error: "no main window", list };
    const ox = window.mozInnerScreenX - window.screenX;
    const oy = window.mozInnerScreenY - window.screenY;
    return {
      main: [main.x, main.y, main.w, main.h],
      others: (list.windows || []).map((w) => ({ order: w.order, who: w.who, layer: w.layer, title: w.title, alpha: w.alpha, rel: [Math.round(w.x - main.x - ox), Math.round(w.y - main.y - oy), w.w, w.h] })),
    };
  }

  /** One sample per animation frame for `ms`: fn(t) -> any. */
  async function perFrame(ms, fn) {
    const out = [];
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (ts) => {
        const t = performance.now() - t0;
        out.push({ t: Math.round(t * 10) / 10, v: fn(t) });
        if (t < ms) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return out;
  }

  /** Frame intervals of this window's refresh driver over `ms`: {n, mean, p50, p95, max, over (count > 1.5 x median)}. */
  async function frameStats(ms) {
    const ts = [];
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (t) => {
        ts.push(t);
        if (performance.now() - t0 < ms) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return stats(ts.slice(1).map((t, i) => t - ts[i]));
  }
  function stats(d) {
    if (!d.length) return { n: 0 };
    const s = [...d].sort((a, c) => a - c);
    const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    const med = q(0.5);
    const r = (x) => Math.round(x * 100) / 100;
    return { n: d.length, mean: r(d.reduce((a, c) => a + c, 0) / d.length), p50: r(med), p95: r(q(0.95)), max: r(s[s.length - 1]), over: d.filter((x) => x > med * 1.5).length };
  }

  /** The screen area of this window, for SHOT / REC (global points). */
  const winRect = (pad = 0) => [Math.round(window.screenX - pad), Math.round(window.screenY - pad), Math.round(window.outerWidth + 2 * pad), Math.round(window.outerHeight + 2 * pad)];

  return { tag, ask, start, startTrack, result, placeholder, layer, markLayer, anchored, rect, erect, state, states, rel, perFrame, frameStats, stats, winRect };
})();
