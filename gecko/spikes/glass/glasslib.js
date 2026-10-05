// Shared helpers for the "glass" spike boot scripts. Loaded with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
/* global window, document, gBrowser, Services, Ci, spike */
window.G = (() => {
  const HTML = "http://www.w3.org/1999/xhtml";
  const SVG = "http://www.w3.org/2000/svg";
  const sys = Services.scriptSecurityManager.getSystemPrincipal();

  /** Create an HTML element with inline css, appended to parent. */
  function el(tag, css, parent, text) {
    const e = document.createElementNS(HTML, tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** The Vitre chrome layer: a fixed, click-through HTML div above everything in browser.xhtml. */
  function layer() {
    let l = document.getElementById("vitre-layer");
    if (l) return l;
    l = el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI Variable Text','Segoe UI',sans-serif;", document.body);
    l.id = "vitre-layer";
    return l;
  }

  /** Add a stylesheet (author level) to browser.xhtml. */
  function css(text) {
    const s = document.createElementNS(HTML, "style");
    s.textContent = text;
    document.documentElement.appendChild(s);
    return s;
  }

  /** Hide Firefox's own toolbars so the page fills the window (Vitre floats on top of the page). */
  function hideFirefoxUI() {
    css(`
      #navigator-toolbox { visibility: collapse !important; }
      #sidebar-main, #sidebar-box, #sidebar-splitter { display: none !important; }
      #tabbrowser-tabbox, #tabbrowser-tabpanels, .browserContainer, .browserStack { outline: 0 !important; border: 0 !important; margin: 0 !important; }
      #tabbrowser-tabpanels browser { border-radius: 0 !important; clip-path: none !important; }
      #tabbrowser-tabpanels { background: transparent !important; }
    `);
  }

  async function go(url, browser = gBrowser.selectedBrowser) {
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: sys });
    for (let i = 0; i < 300; i++) {
      await spike.sleep(100);
      if (!browser.webProgress?.isLoadingDocument && browser.currentURI.spec.split("#")[0] === url.split("#")[0]) break;
    }
    await spike.sleep(300);
  }

  /** file: URL of a sibling file of the boot script. */
  function sibling(name) {
    const uri = Services.io.newURI("resource://vitre-boot/" + name);
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    return res.resolveURI(uri);
  }

  // ---- Lens displacement map (port of app/src/renderer/glass.ts) ----
  function lensMap(w, h, r, bezel, power) {
    const c = document.createElementNS(HTML, "canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - w / 2;
        const py = y + 0.5 - h / 2;
        const qx = Math.abs(px) - (w / 2 - r);
        const qy = Math.abs(py) - (h / 2 - r);
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
        const t = Math.min(1, Math.max(0, -d / bezel));
        const k = Math.pow(1 - t, power);
        let nx = 0;
        let ny = 0;
        if (qx > 0 || qy > 0) {
          const l = Math.hypot(ox, oy) || 1;
          nx = (Math.sign(px) * ox) / l;
          ny = (Math.sign(py) * oy) / l;
        } else if (qx > qy) nx = Math.sign(px);
        else ny = Math.sign(py);
        const i = (y * w + x) * 4;
        img.data[i] = Math.round(128 - nx * k * 127);
        img.data[i + 1] = Math.round(128 - ny * k * 127);
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  function defs() {
    let svg = document.getElementById("vitre-glass-defs");
    if (!svg) {
      svg = document.createElementNS(SVG, "svg");
      svg.id = "vitre-glass-defs";
      svg.setAttribute("style", "position:fixed; width:0; height:0; overflow:hidden;");
      svg.appendChild(document.createElementNS(SVG, "defs"));
      document.body.appendChild(svg);
    }
    return svg.firstChild;
  }

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (parent) parent.appendChild(e);
    return e;
  }

  let n = 0;
  /** Same filter graph as the Electron lens(): feImage(map) + blur + feDisplacementMap + saturate. Returns the filter id. */
  function lensFilter(w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    const radius = opts.radius ?? Math.min(w, h) / 2;
    const bezel = opts.bezel ?? Math.min(14, h / 3);
    const scale = opts.scale ?? (h <= 36 ? 12 : 18);
    const blur = opts.blur ?? 1.4;
    const id = "vitre-lens-" + n++;
    const f = svgEl("filter", { id, x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }, defs());
    svgEl("feImage", { x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map", href: lensMap(w, h, radius, bezel, 2.2) }, f);
    svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: blur, result: "soft" }, f);
    svgEl("feDisplacementMap", { in: "soft", in2: "map", scale, xChannelSelector: "R", yChannelSelector: "G", result: "bent" }, f);
    svgEl("feColorMatrix", { in: "bent", type: "saturate", values: opts.saturate ?? 1.5 }, f);
    return id;
  }

  /** Lens filter as SVG markup (for the content-side layer). */
  function lensFilterMarkup(id, w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    const radius = opts.radius ?? Math.min(w, h) / 2;
    const bezel = opts.bezel ?? Math.min(14, h / 3);
    const scale = opts.scale ?? (h <= 36 ? 12 : 18);
    const blur = opts.blur ?? 1.4;
    return `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      `<feImage x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map" href="${lensMap(w, h, radius, bezel, 2.2)}"/>` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="soft"/>` +
      `<feDisplacementMap in="soft" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="bent"/>` +
      `<feColorMatrix in="bent" type="saturate" values="${opts.saturate ?? 1.5}"/></filter>`;
  }

  /**
   * Load the content-side lens layer script into a browser (frame script; the real app would use a
   * JSWindowActor). Returns { set(html), style(id, css), frames(n), scroll(y), once(tag) }.
   */
  async function contentGlass(browser = gBrowser.selectedBrowser) {
    const code = await (await fetch("resource://vitre-boot/content-glass.js")).text();
    // GOTCHA: browser.messageManager is replaced whenever the browser gets a new frame loader
    // (process switch, and also same-process navigations when the old page goes into the
    // parent-controlled bfcache). So listen on the WINDOW message manager, load the script with
    // allowDelayedLoad for future frame loaders, and always send through the current
    // browser.messageManager. (A JSWindowActor pair has none of these problems.)
    const wmm = window.messageManager;
    const mm = { sendAsyncMessage: (n, d) => browser.messageManager.sendAsyncMessage(n, d) };
    const waiters = new Map();
    const once = (tag, ms = 8000) =>
      new Promise((r) => {
        waiters.set(tag, r);
        setTimeout(() => r("TIMEOUT"), ms);
      });
    wmm.addMessageListener("VitreGlass:Result", (m) => {
      if (m.target !== browser) return;
      const w = waiters.get(m.data.tag);
      if (w) {
        waiters.delete(m.data.tag);
        w(m.data.value);
      } else spike.log("[content]", m.data.tag, m.data.value);
    });
    wmm.addMessageListener("VitreGlass:Ready", (m) => spike.log("[content] ready", m.data.url));
    const loaded = once("loaded");
    wmm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(code), true);
    spike.log("content script loaded in", await loaded);
    return {
      once,
      set(html) {
        const r = once("set");
        mm.sendAsyncMessage("VitreGlass:Set", { html });
        return r;
      },
      style(id, css) {
        mm.sendAsyncMessage("VitreGlass:Style", { id, css });
      },
      frames(n = 120, tag = "frames") {
        const r = once(tag, 30000);
        mm.sendAsyncMessage("VitreGlass:FrameStats", { frames: n, tag });
        return r;
      },
      scroll(y) {
        const r = once("scroll");
        mm.sendAsyncMessage("VitreGlass:Scroll", { y });
        return r;
      },
    };
  }

  // ---- Lens displacement field (same maths as lensMap), shared by the feOffset approximation ----
  /** Displacement (in px, to ADD to the sample position) at pixel centre (x, y) of a w*h rounded rect. */
  function lensField(x, y, w, h, r, bezel, power, scale) {
    const px = x - w / 2;
    const py = y - h / 2;
    const qx = Math.abs(px) - (w / 2 - r);
    const qy = Math.abs(py) - (h / 2 - r);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
    if (d > 0) return [0, 0, false];
    const t = Math.min(1, Math.max(0, -d / bezel));
    const k = Math.pow(1 - t, power);
    let nx = 0;
    let ny = 0;
    if (qx > 0 || qy > 0) {
      const l = Math.hypot(ox, oy) || 1;
      nx = (Math.sign(px) * ox) / l;
      ny = (Math.sign(py) * oy) / l;
    } else if (qx > qy) nx = Math.sign(px);
    else ny = Math.sign(py);
    // feDisplacementMap: P'(x,y) = P(x + scale*(R/255 - 0.5), ...), R = 128 - nx*k*127
    return [(-nx * k * scale) / 2, (-ny * k * scale) / 2, true];
  }

  /**
   * Lens WITHOUT feDisplacementMap (which WebRender cannot run in a backdrop-filter): the
   * displacement field is quantised into rectangular cells, each an feOffset with a primitive
   * subregion, merged over the undisplaced backdrop, then blurred and saturated.
   * Straight edges collapse into full-length strips, so a pill costs few nodes.
   * Returns { markup, nodes }.
   */
  function offsetLensMarkup(id, w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    const radius = opts.radius ?? Math.min(w, h) / 2;
    const bezel = opts.bezel ?? Math.min(14, h / 3);
    const scale = opts.scale ?? (h <= 36 ? 12 : 18);
    const blur = opts.blur ?? 1.4;
    const cell = opts.cell ?? 3;
    const step = opts.step ?? 1; // quantisation of the offsets, px
    const minD = opts.min ?? 0.75; // ignore displacements smaller than this
    const q = (v) => Math.round(v / step) * step;
    const rects = [];
    for (let y = 0; y < h; y += cell) {
      let run = null;
      for (let x = 0; x < w; x += cell) {
        const cw = Math.min(cell, w - x);
        const ch = Math.min(cell, h - y);
        const [fx, fy] = lensField(x + cw / 2, y + ch / 2, w, h, radius, bezel, 2.2, scale);
        const dx = q(fx);
        const dy = q(fy);
        const live = Math.hypot(fx, fy) >= minD && (dx !== 0 || dy !== 0);
        if (run && live && run.dx === dx && run.dy === dy) run.w += cw;
        else {
          if (run) rects.push(run);
          run = live ? { x, y, w: cw, h: ch, dx, dy } : null;
        }
      }
      if (run) rects.push(run);
    }
    // Merge vertically adjacent runs with the same geometry and offset.
    const merged = [];
    for (const r of rects) {
      const m = merged.find((o) => o.x === r.x && o.w === r.w && o.dx === r.dx && o.dy === r.dy && o.y + o.h === r.y);
      if (m) m.h += r.h;
      else merged.push(r);
    }
    let body = "";
    let mergeNodes = `<feMergeNode in="SourceGraphic"/>`;
    merged.forEach((r, i) => {
      // out(p) = in(p - (dx,dy)) and we want in(p + D): dx = -D
      body += `<feOffset in="SourceGraphic" dx="${-r.dx}" dy="${-r.dy}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" result="o${i}"/>`;
      mergeNodes += `<feMergeNode in="o${i}"/>`;
    });
    const markup =
      `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      body +
      `<feMerge x="0" y="0" width="${w}" height="${h}" result="bent">${mergeNodes}</feMerge>` +
      (blur > 0 ? `<feGaussianBlur in="bent" stdDeviation="${blur}" result="soft"/>` : "") +
      `<feColorMatrix in="${blur > 0 ? "soft" : "bent"}" type="saturate" values="${opts.saturate ?? 1.5}"/></filter>`;
    return { markup, nodes: merged.length };
  }

  /**
   * CHEAP lens for backdrop-filter (the recommended recipe): the bezel refraction is approximated by a
   * few full-length strips, each an feOffset with a primitive subregion. Top/bottom strips bend the
   * backdrop vertically (exact direction on a pill's straight edges, quantised magnitude), left/right
   * strips bend it horizontally at the caps, optional diagonal cells cover the 45 degree points.
   * ~10 nodes for a pill, ~14 for a circle with diagonals. Then blur + saturate as in the Electron lens.
   * opts: radius, bezel, scale, blur, saturate, bands (depth bands in px for a 14 px bezel), diag.
   * Returns { markup, nodes }.
   */
  function stripLensMarkup(id, w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    const radius = opts.radius ?? Math.min(w, h) / 2;
    const bezel = opts.bezel ?? Math.min(14, h / 3);
    const scale = opts.scale ?? (h <= 36 ? 12 : 18);
    const blur = opts.blur ?? 1.4;
    const f = bezel / 14;
    const bands = (opts.bands ?? [[0, 2.5], [2.5, 5.5], [5.5, 9.5]]).map(([a, b]) => [a * f, b * f]);
    const mag = (a, b) => {
      // mean of the lens profile over the band
      let sum = 0;
      const n = 8;
      for (let i = 0; i < n; i++) sum += Math.pow(1 - Math.min(1, (a + ((b - a) * (i + 0.5)) / n) / bezel), 2.2);
      return +(((sum / n) * scale) / 2).toFixed(2);
    };
    const r = (v) => +v.toFixed(2);
    const nodes = [];
    const add = (x, y, rw, rh, dx, dy) => {
      if (rw > 0 && rh > 0) nodes.push(`<feOffset in="SourceGraphic" dx="${r(dx)}" dy="${r(dy)}" x="${r(x)}" y="${r(y)}" width="${r(rw)}" height="${r(rh)}" result="s${nodes.length}"/>`);
    };
    // Sample position is p + D with D pointing inwards; feOffset dx = -D.
    for (const [a, b] of bands) {
      const m = mag(a, b);
      add(0, a, w, b - a, 0, -m); // top: sample from below
      add(0, h - b, w, b - a, 0, m); // bottom: sample from above
    }
    // Caps: only where the outline is closer to vertical than horizontal.
    const inset = radius * (1 - Math.SQRT1_2);
    const capBands = opts.capBands ? opts.capBands.map(([a, b]) => [a * f, b * f]) : bands;
    if (radius > 4) {
      for (const [a, b] of capBands) {
        const m = mag(a, b);
        add(a, inset, b - a, h - 2 * inset, -m, 0); // left: sample from the right
        add(w - b, inset, b - a, h - 2 * inset, m, 0); // right
      }
      if (opts.diag ?? radius >= 12) {
        // One cell around each 45 degree point of the corner arcs, bent along the diagonal.
        const c = radius * (1 - Math.SQRT1_2); // 45 degree point is (c, c) from the corner
        const size = Math.max(4, bezel * 0.55);
        const [a, b] = bands[0];
        const m = (mag(a, bands[Math.min(1, bands.length - 1)][1]) * Math.SQRT1_2);
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const x = sx ? w - c - size : c;
          const y = sy ? h - c - size : c;
          add(x - size * 0.15, y - size * 0.15, size, size, sx ? m : -m, sy ? m : -m);
        }
      }
    }
    const markup =
      `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      nodes.join("") +
      `<feMerge x="0" y="0" width="${w}" height="${h}" result="bent"><feMergeNode in="SourceGraphic"/>${nodes.map((_, i) => `<feMergeNode in="s${i}"/>`).join("")}</feMerge>` +
      `<feGaussianBlur in="bent" stdDeviation="${blur}" result="soft"/>` +
      `<feColorMatrix in="soft" type="saturate" values="${opts.saturate ?? 1.5}"/></filter>`;
    return { markup, nodes: nodes.length };
  }

  /**
   * One lens for a whole row of same-height shapes (the tab bar): ONE backdrop-filter element spanning
   * the row, clipped to the union of the shapes with clip-path, with ONE filter in which the top and
   * bottom strips are shared by every shape. shapes: [{ x, w }] relative to the row. Returns
   * { markup, nodes, clip } where clip is a CSS clip-path value.
   */
  function rowLensMarkup(id, width, h, shapes, opts = {}) {
    const bezel = opts.bezel ?? Math.min(14, h / 3);
    const scale = opts.scale ?? (h <= 36 ? 12 : 18);
    const blur = opts.blur ?? 1.8;
    const f = bezel / 14;
    const bands = (opts.bands ?? [[0, 2.5], [2.5, 5.5], [5.5, 9.5]]).map(([a, b]) => [a * f, b * f]);
    const capBands = (opts.capBands ?? [[0, 3], [3, 8]]).map(([a, b]) => [a * f, b * f]);
    const mag = (a, b) => {
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += Math.pow(1 - Math.min(1, (a + ((b - a) * (i + 0.5)) / 8) / bezel), 2.2);
      return +(((sum / 8) * scale) / 2).toFixed(2);
    };
    const r2 = (v) => +v.toFixed(2);
    const nodes = [];
    const add = (x, y, rw, rh, dx, dy) => nodes.push(`<feOffset in="SourceGraphic" dx="${r2(dx)}" dy="${r2(dy)}" x="${r2(x)}" y="${r2(y)}" width="${r2(rw)}" height="${r2(rh)}" result="s${nodes.length}"/>`);
    for (const [a, b] of bands) {
      const m = mag(a, b);
      add(0, a, width, b - a, 0, -m);
      add(0, h - b, width, b - a, 0, m);
    }
    const radius = h / 2;
    const inset = radius * (1 - Math.SQRT1_2);
    let clip = "";
    for (const sh of shapes) {
      for (const [a, b] of capBands) {
        const m = mag(a, b);
        add(sh.x + a, inset, b - a, h - 2 * inset, -m, 0);
        add(sh.x + sh.w - b, inset, b - a, h - 2 * inset, m, 0);
      }
      const x0 = sh.x;
      const x1 = sh.x + sh.w;
      clip += `M${x0 + radius},0 H${x1 - radius} A${radius},${radius} 0 0 1 ${x1 - radius},${h} H${x0 + radius} A${radius},${radius} 0 0 1 ${x0 + radius},0 Z `;
    }
    const markup =
      `<filter id="${id}" x="0" y="0" width="${width}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      nodes.join("") +
      `<feMerge x="0" y="0" width="${width}" height="${h}" result="bent"><feMergeNode in="SourceGraphic"/>${nodes.map((_, i) => `<feMergeNode in="s${i}"/>`).join("")}</feMerge>` +
      `<feGaussianBlur in="bent" stdDeviation="${blur}" result="soft"/>` +
      `<feColorMatrix in="soft" type="saturate" values="${opts.saturate ?? 1.5}"/></filter>`;
    return { markup, nodes: nodes.length, clip: `path("${clip.trim()}")` };
  }

  return { HTML, SVG, el, layer, css, hideFirefoxUI, go, sibling, lensMap, lensField, lensFilter, lensFilterMarkup, offsetLensMarkup, stripLensMarkup, rowLensMarkup, contentGlass, defs, svgEl };
})();
