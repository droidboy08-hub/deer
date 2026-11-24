// Spike S10, the capsule demo the owner asked for (2026-11-15): Deer's One row with its capsules as
// REAL Liquid Glass windows instead of Deer's CSS glass, next to today's row, in a normal 1280 x 800
// window with six tabs. Test-only: nothing in src/ changes; everything below is built at runtime.
//
// How the real-glass row works (window.CD below):
//   - Deer's row stays exactly as it is and keeps doing everything: layout, the springs, hover growth,
//     clicks, right-clicks, typing (it stays the source of truth). It is only made invisible:
//     opacity 0.001 on #vitre-bar, #vitre-row-end and #vitre-omni-field (still hit-tested, still
//     painted, so its changes keep flowing), and its CSS glass layers are display:none.
//   - Each capsule gets its own popup window: a XUL <panel> like panelhost.ts makes Deer's menus
//     (toolkit's menupopup appearance, so Gecko wraps the window in NSGlassEffectView: real .regular
//     glass, 12 px corners), level="parent" (a child window of Deer's window), noautohide.
//     pointer-events: none on the panel makes the window ignore the mouse (Gecko's
//     IsMouseTransparent -> setIgnoresMouseEvents), so the pointer reaches Deer's row under it.
//   - What the capsule shows (favicon, title, host, Reload, the hover x, the typed text and caret) is
//     painted in the window with -moz-element(): a live picture of Deer's own capsule content, so the
//     text is Deer's, in Deer's colours (s10-probe2.js: -moz-element paints in chrome, also under an
//     ancestor at opacity 0, caret and selection included).
//   - Every frame (requestAnimationFrame) each window is moved (moveTo) and sized (sizeTo) onto its
//     capsule; a capsule entering or leaving the row (scale 0.6 and a fade on the CSS item) becomes
//     -moz-window-transform (scale, centred by hand: the pivot is the top-left, S6) and
//     -moz-window-opacity, through custom properties a chrome sheet reads (inline -moz-window-* is
//     dropped, s10-probe4.js).
//   - The window's light or dark (its color-scheme) follows Deer's row theme: theme-light -> light,
//     theme-dark / theme-clear / private -> dark (small glass may still flip by itself, S1).
//   - The windows are taken out of keys.ts's list of open Firefox panels (b.keys.popups) and refuse
//     to hide unless the demo hides them (popuphiding is cancelled): otherwise b.closePanels() (a tab
//     switch, the address field) would close them and Esc would be left to them (S4).
//   - The traffic lights keep Deer's CSS capsule: a glass window over them would blur Apple's buttons
//     (AppKit draws them in Deer's window, under any child window) and could not move the window.
//     In the 24 px variant their CSS capsule is made 24 px tall too, so the row matches.
//   Variants: "36": windows exactly over the 36 px capsules (12 px corners, not pills); "24": 24 px
//   tall windows centred on the capsules (true pills, radius 12); "css": today's row.
//
// Run it with spikes/mac-glass/run-capsule-demo.sh (serves the pages under fake .example hosts on
// 127.0.0.1, waits for an unlocked screen, runs behave_mon.py beside the engine for the videos, the
// window-server track and CPU, then makes the summaries and the mp4s). By hand, from gecko/ (with the
// page server running; without CD_MON only the stills are taken):
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/capsule-demo.js --name mac-glass-s10 --url about:blank \
//       --timeout 900 --out tests/menus/out --pref ui.systemUsesDarkTheme=1 --pref dom.security.https_first=false \
//       --pref network.dns.localDomains=fieldnotes.example,nightshift.example,wildlife.example,tideline.example,refract.example,moltentin.example \
//       --env CD_PORT=8765 [--env CD_MON=1] [--env CD_ONLY=stills,motion,measure] [--env CD_STATES=article,dark]
//
// Captures (tests/menus/out), each in three variants: -css (today), -36 (real glass over the 36 px
// capsules) and -24 (real glass pills):
//   glass-demo-article-*        the light article (Field Notes) active, five more tabs
//   glass-demo-scrolled-*       the same page scrolled: text under the row
//   glass-demo-dark-*           the dark page (Night Shift) active
//   glass-demo-home-*           Home with the wallpaper active
//   glass-demo-photo-*          the photo page (Wildlife: five photos along the top) active
//   glass-demo-hover-*          the pointer on the Tideline tab: grown with its close x
//   glass-demo-typing-*         typing in the address capsule (grown to 640, suggestions under it)
//   glass-demo-resized-*        the window narrowed to 960 px
//   glass-demo-menu-*           a tab's menu (Deer's real-glass menu) opened from a capsule
// Videos (with CD_MON=1; behave_mon.py REC, then run-capsule-demo.sh makes the mp4s):
//   glass-demo-motion(.mp4), glass-demo-motion-css, glass-demo-motion-24: the same 12.5 s script:
//   a background tab opens and closes, a foreground tab opens and closes, hover growth, typing, the
//   window narrowed and widened, a tab's menu.
// Measurements (with CD_MON=1): the window server's frames of every glass window during the same
// script (TRACK) against where Deer's row had each capsule in that frame (CDREC), and CPU for the CSS
// and the glass row, idle and during the script.
/* global spike, G, GB, Services, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);

window.CD = (() => {
  const { log } = spike;
  const b = window.vitre;
  const root = b.root;
  const H = "http://www.w3.org/1999/xhtml";

  const CSS = `
#vitre-root.cd-real #vitre-bar,
#vitre-root.cd-real #vitre-row-end,
#vitre-root.cd-real #vitre-omni-field,
#vitre-root.cd-real #vitre-omni-panel { opacity: 0.001 !important; }
#vitre-root.cd-real #vitre-bar .item > :is(.lens, .tint, .rim, .tint-mix),
#vitre-root.cd-real :is(#vitre-omni-field, #vitre-omni-panel) > :is(.lens, .tint, .rim) { display: none !important; }
#vitre-root.cd-real #vitre-omni-panel { box-shadow: none !important; }
#vitre-root.cd-real #vitre-row-end > * { background: none !important; box-shadow: none !important; backdrop-filter: none !important; }
#vitre-root.cd-real #vitre-row-end > .vd-ring + .vx-rowcap::before { display: none !important; }
#vitre-root.cd-24 #vitre-winctl { top: 14px !important; height: 24px !important; border-radius: 12px !important; }
/* -moz-window-* are taken from a chrome sheet only (an inline style.setProperty of them is dropped,
   s10-probe4.js), so the sheet reads custom properties the script sets per frame. */
panel.cd-cap { pointer-events: none; -moz-window-opacity: var(--cd-wo, 1); -moz-window-transform: var(--cd-wt, none); }
panel.cd-cap > .cd-face {
  flex: 1 1 auto; align-self: stretch; min-width: 0; min-height: 0;
  background-repeat: no-repeat; pointer-events: none;
}
panel.cd-cap > .cd-face.cd-typing { box-shadow: inset 0 0 0 2.5px rgba(0,122,255,0.5); border-radius: 12px; }
.cd-mark { position: absolute; height: 3px; background: #ff2d55; pointer-events: none; z-index: 2147483647; }
`;

  const PANEL_ATTRS = [
    ["noautohide", "true"],
    ["level", "parent"],
    ["consumeoutsideclicks", "false"],
    ["noautofocus", "true"],
    ["norestorefocus", "true"],
    ["ignorekeys", "true"],
    ["role", "presentation"],
  ];

  let on = false;
  let pill = 0; // 0: the capsule's own height (36); 24: a 24 px pill centred on it
  let raf = 0;
  let seq = 0;
  let refs = 0;
  let vetoes = 0;
  let errors = 0;
  let marks = false;
  const caps = new Map(); // key -> capsule window state
  const keys = new WeakMap(); // element -> key
  let rec = null; // per-frame record while measuring
  const popupSet = () => document.getElementById("mainPopupSet") ?? document.documentElement;
  const markLayer = () => b.layer("cd-marks", 64);

  const idOf = (el) => {
    if (!el.id) el.id = "cd-ref-" + ++refs;
    return el.id;
  };
  const keyOf = (el) => {
    let k = keys.get(el);
    if (!k) {
      k = "c" + ++seq;
      keys.set(el, k);
    }
    return k;
  };
  const schemeNow = () => (root.classList.contains("private") || !root.classList.contains("theme-light") ? "dark" : "light");

  /** The element's own scale (an entering or leaving capsule) and opacity. */
  function ownEffects(el) {
    const cs = getComputedStyle(el);
    let s = 1;
    const m = /^matrix\(\s*([-\d.e]+)/.exec(cs.transform || "");
    if (m) s = parseFloat(m[1]);
    return { s: Number.isFinite(s) && s > 0 ? s : 1, o: parseFloat(cs.opacity) };
  }

  /** The untransformed box of `el` in window CSS px (getBoundingClientRect less its own scale about the centre). */
  function box(el, s) {
    const r = el.getBoundingClientRect();
    if (s === 1) return { x: r.left, y: r.top, w: r.width, h: r.height };
    const w = r.width / s;
    const h = r.height / s;
    return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
  }

  /** What to paint for a bar item: its faces (not its CSS glass layers), at their offsets in the item. */
  function itemParts(item) {
    const parts = [];
    for (const c of item.children) {
      if (c.matches(".lens, .tint, .rim, .tint-mix")) continue;
      if (!c.offsetParent) continue; // display: none
      parts.push({ el: c, x: c.offsetLeft, y: c.offsetTop });
    }
    return parts;
  }

  function make(key, kind) {
    const p = document.createXULElement("panel");
    p.id = "cd-cap-" + key;
    p.className = "gs-host cd-cap";
    for (const [k, v] of PANEL_ATTRS) p.setAttribute(k, v);
    const face = document.createElementNS(H, "div");
    face.className = "cd-face";
    p.append(face);
    const c = { key, kind, panel: p, face, state: "new", closing: false, bg: "", pos: "", scheme: "", wt: "", wo: "", sx: NaN, sy: NaN, w: 0, h: 0, typing: false, shownAt: 0, made: performance.now() };
    p.addEventListener("popupshown", (e) => {
      if (e.target !== p) return;
      c.state = "open";
      c.shownAt = performance.now();
      // keys.ts counts every open <panel> as Firefox's: b.closePanels() would hide it, Esc would be left to it (S4).
      try {
        b.keys?.popups?.delete?.(p);
      } catch (err) {
        /* not there */
      }
    });
    p.addEventListener("popuphiding", (e) => {
      if (e.target === p && !c.closing) {
        e.preventDefault();
        vetoes++;
      }
    });
    p.addEventListener("popuphidden", (e) => {
      if (e.target === p) c.state = "closed";
    });
    popupSet().append(p);
    if (marks) {
      c.mark = document.createElementNS(H, "div");
      c.mark.className = "cd-mark";
      markLayer().append(c.mark);
    }
    return c;
  }

  function drop(c) {
    c.closing = true;
    try {
      if (c.panel.state === "open" || c.panel.state === "showing") c.panel.hidePopup(false);
    } catch (err) {
      /* going */
    }
    c.panel.remove();
    c.mark?.remove();
    caps.delete(c.key);
  }

  /** Put capsule `key`'s window over box `L` (window CSS px), painting `parts`, with scale s and opacity o. */
  function place(key, kind, L, parts, s, o, scheme, typing, frameRec, noPill = false) {
    if (L.w < 1 || L.h < 1) return false;
    let c = caps.get(key);
    if (!c) {
      c = make(key, kind);
      caps.set(key, c);
    }
    const h = (!noPill && pill) || L.h;
    const R = { x: L.x, y: L.y + (L.h - h) / 2, w: L.w, h };
    const dy = R.y - L.y;
    const rw = Math.max(1, Math.round(R.w));
    const rh = Math.max(1, Math.round(R.h));
    const sx = Math.round(window.mozInnerScreenX + R.x);
    const sy = Math.round(window.mozInnerScreenY + R.y);
    // What the window shows: Deer's own content, live.
    const bg = parts.map((p) => `-moz-element(#${idOf(p.el)})`).join(", ");
    const pos = parts.map((p) => `${Math.round(p.x)}px ${Math.round(p.y - dy)}px`).join(", ");
    if (bg !== c.bg) {
      c.face.style.backgroundImage = bg || "none";
      c.bg = bg;
    }
    if (pos !== c.pos) {
      c.face.style.backgroundPosition = pos || "0 0";
      c.pos = pos;
    }
    if (typing !== c.typing) {
      c.face.classList.toggle("cd-typing", typing);
      c.typing = typing;
    }
    if (scheme !== c.scheme) {
      c.panel.style.colorScheme = scheme;
      c.scheme = scheme;
    }
    const wt = Math.abs(s - 1) > 0.001 ? `translate(${((rw * (1 - s)) / 2).toFixed(1)}px, ${((rh * (1 - s)) / 2).toFixed(1)}px) scale(${s.toFixed(4)})` : "none";
    if (wt !== c.wt) {
      c.panel.style.setProperty("--cd-wt", wt);
      c.wt = wt;
    }
    const wo = o < 0.999 ? o.toFixed(3) : "1";
    if (wo !== c.wo) {
      c.panel.style.setProperty("--cd-wo", wo);
      c.wo = wo;
    }
    if (c.state === "new") {
      c.panel.sizeTo(rw, rh);
      c.w = rw;
      c.h = rh;
      c.sx = sx;
      c.sy = sy;
      c.state = "showing";
      c.panel.openPopupAtScreen(sx, sy, false);
    } else {
      if (rw !== c.w || rh !== c.h) {
        c.panel.sizeTo(rw, rh);
        c.w = rw;
        c.h = rh;
        c.sizes = (c.sizes || 0) + 1;
      }
      if (sx !== c.sx || sy !== c.sy) {
        c.panel.moveTo(sx, sy);
        c.sx = sx;
        c.sy = sy;
        c.moves = (c.moves || 0) + 1;
      }
    }
    if (c.mark) {
      // Where Deer's row has the capsule in this frame, 3 px under it (a diagnostic, CD_MARKS).
      const ms = c.mark.style;
      ms.left = `${L.x}px`;
      ms.width = `${L.w}px`;
      ms.top = `${L.y + L.h + 2}px`;
    }
    c.seen = true;
    c.L = L;
    c.R = { x: Math.round(R.x), y: Math.round(R.y), w: rw, h: rh };
    c.el = parts[0]?.el ?? null;
    if (frameRec) frameRec.push([key, kind, +R.x.toFixed(2), +R.y.toFixed(2), +R.w.toFixed(2), +R.h.toFixed(2), +s.toFixed(3), +o.toFixed(3)]);
    return true;
  }

  function tick() {
    const t0 = performance.now();
    for (const c of caps.values()) c.seen = false;
    const scheme = schemeNow();
    const frameRec = rec ? [] : null;
    const bar = document.getElementById("vitre-bar");
    const omniOpen = root.classList.contains("omni-open");
    const field = document.getElementById("vitre-omni-field");
    const activeItem = b.bar?.item?.(b.activeId) ?? null;
    if (bar) {
      for (const item of bar.children) {
        if (!item.classList?.contains("item")) continue;
        const key = keyOf(item);
        const { s, o } = ownEffects(item);
        const kind = item.classList.contains("plus") ? "plus" : item.classList.contains("leaving") ? "leaving" : item.classList.contains("active") ? "active" : "tab";
        if (item === activeItem && omniOpen && field) {
          // The address field is the active capsule while it is open: paint its row (glyph, text, caret).
          const fr = field.getBoundingClientRect();
          const row = field.querySelector(".omni-row");
          if (fr.width > 1 && row) {
            place(key, "field", { x: fr.left, y: fr.top, w: fr.width, h: fr.height }, [{ el: row, x: row.offsetLeft, y: row.offsetTop }], 1, 1, scheme, true, frameRec);
            continue;
          }
        }
        place(key, kind, box(item, s), itemParts(item), s, o, scheme, false, frameRec);
      }
    }
    const end = document.getElementById("vitre-row-end");
    if (end) {
      for (const cap of end.children) {
        const r = cap.getBoundingClientRect();
        if (r.width < 1) continue;
        const kind = cap.classList.contains("vd-ring") ? "downloads" : cap.classList.contains("vx-rowcap") ? "extensions" : "end";
        place(keyOf(cap), kind, { x: r.left, y: r.top, w: r.width, h: r.height }, [{ el: cap, x: 0, y: 0 }], 1, 1, scheme, false, frameRec);
      }
    }
    // The suggestions hang from the field: a big glass window of their own while they show.
    const sug = document.getElementById("vitre-omni-panel");
    const list = document.getElementById("vitre-omni-list");
    if (omniOpen && sug && list) {
      const r = sug.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && getComputedStyle(sug).visibility !== "hidden") {
        place(keyOf(sug), "suggestions", { x: r.left, y: r.top, w: r.width, h: r.height }, [{ el: list, x: list.offsetLeft, y: list.offsetTop }], 1, 1, scheme, false, frameRec, true);
      }
    }
    for (const c of [...caps.values()]) if (!c.seen) drop(c);
    if (rec && frameRec) rec.push([+(performance.timeOrigin + t0).toFixed(2), +(performance.now() - t0).toFixed(3), +window.mozInnerScreenX.toFixed(1), +window.mozInnerScreenY.toFixed(1), frameRec]);
  }

  function frame() {
    raf = 0;
    if (!on) return;
    try {
      tick();
    } catch (e) {
      if (errors++ < 5) log("CD tick error " + e + " " + (e.stack || ""));
    }
    raf = requestAnimationFrame(frame);
  }

  /** Turn the real-glass row on (pillHeight 0: windows as tall as the capsules; 24: pills) or off (null). */
  async function set(variant) {
    G.ensureCss();
    b.css("capsule-demo", CSS);
    const want = variant === "36" ? 0 : variant === "24" ? 24 : null;
    for (const c of [...caps.values()]) drop(c);
    if (want === null) {
      on = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      root.classList.remove("cd-real", "cd-24");
      return;
    }
    pill = want;
    root.classList.add("cd-real");
    root.classList.toggle("cd-24", want === 24);
    on = true;
    if (!raf) raf = requestAnimationFrame(frame);
    // Every capsule's window open.
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await spike.sleep(100);
      const list = [...caps.values()];
      if (list.length && list.every((c) => c.state === "open")) break;
    }
    await spike.sleep(300);
  }

  /** Every capsule window: where Deer's row has the capsule and where Gecko has the window (window CSS px). */
  function report() {
    const ox = window.mozInnerScreenX;
    const oy = window.mozInnerScreenY;
    return [...caps.values()].map((c) => {
      let g = null;
      try {
        const r = c.panel.getOuterScreenRect();
        g = [Math.round(r.x - ox), Math.round(r.y - oy), Math.round(r.width), Math.round(r.height)];
      } catch (e) {
        g = null;
      }
      return { key: c.key, kind: c.kind, state: c.panel.state, want: c.R ? [c.R.x, c.R.y, c.R.w, c.R.h] : null, gecko: g, scheme: c.scheme, wt: c.wt, wo: c.wo, moves: c.moves || 0, sizes: c.sizes || 0, parts: (c.bg.match(/-moz-element/g) || []).length };
    });
  }

  return {
    set,
    report,
    get on() {
      return on;
    },
    get count() {
      return caps.size;
    },
    get vetoes() {
      return vetoes;
    },
    get errors() {
      return errors;
    },
    set marks(v) {
      marks = v;
    },
    startRec() {
      rec = [];
    },
    stopRec() {
      const r = rec;
      rec = null;
      return r;
    },
    caps,
  };
})();

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  const env = (k, d = "") => Services.env.get(k) || d;
  const PORT = env("CD_PORT", "8765");
  const MON = env("CD_MON") === "1";
  const ONLY = env("CD_ONLY", "stills,motion,measure").split(",");
  const STATES = env("CD_STATES", "article,scrolled,dark,home,photo,hover,typing,resized,menu").split(",");
  const VARIANTS = env("CD_VARIANTS", "css,36,24").split(",");
  CD.marks = env("CD_MARKS") === "1";
  const url = (host, file) => `http://${host}.example:${PORT}/${file}`;
  const VWORDS = { css: "Today: Deer's CSS capsules", 36: "Real glass windows, 36 px (12 px corners)", 24: "Real glass windows, 24 px pills" };

  // Real pointer moves (the owner may be using the Mac) must not disturb hover.
  window.windowUtils.disableNonTestMouseEvents(true);
  await spike.resize(1280, 800);
  await spike.activate();
  log("screen " + JSON.stringify({ w: screen.width, h: screen.height, dpr: window.devicePixelRatio }) + " window " + JSON.stringify([window.screenX, window.screenY, window.outerWidth, window.outerHeight, window.mozInnerScreenX, window.mozInnerScreenY]));

  // ---- Six tabs: Field Notes (light article), Night Shift (dark), Home, Wildlife (photos), Tideline, Refract ----
  const article = await G.load(url("fieldnotes", "article.html"), 800);
  const want = [
    ["night", url("nightshift", "night.html")],
    ["home", null],
    ["photo", url("wildlife", "wildlife.html")],
    ["tideline", url("tideline", "tideline.html")],
    ["refract", url("refract", "refract.html")],
  ];
  const T = { article };
  want.forEach(([name, u], i) => {
    T[name] = u ? b.newTab(u, { background: true, index: i + 1 }) : b.newTab(undefined, { background: true, index: i + 1 });
  });
  await waitFor(() => b.tabs.length === 6 && b.tabs.every((t) => !t.loading), { timeout: 30000, what: "six tabs loaded" });
  await sleep(1500);
  log("tabs: " + JSON.stringify(b.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url.slice(0, 60) }))));
  check("six tabs in order: Field Notes, Night Shift, Home, Wildlife, Tideline, Refract", b.tabs.map((t) => t.id).join() === [T.article, T.night, T.home, T.photo, T.tideline, T.refract].map((t) => t.id).join(), b.tabs.map((t) => t.title));

  const rowState = () => ({
    theme: (b.root.className.match(/theme-\w+/) || [""])[0],
    items: [...document.querySelectorAll("#vitre-bar > .item")].map((i) => {
      const r = i.getBoundingClientRect();
      return [i.className.replace(/\b(item|glass)\b/g, "").trim(), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    }),
    end: [...(document.getElementById("vitre-row-end")?.children ?? [])].map((c) => {
      const r = c.getBoundingClientRect();
      return [c.className, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    }),
  });
  const settle = async (ms = 700) => {
    await sleep(120);
    await waitFor(() => b.bar.state.settled, { timeout: 4000, what: "the row settles" }).catch(() => {});
    await sleep(ms);
  };

  /** A label on the page, just under the row (y 58), so each capture says what it shows. */
  const label = async (text) => {
    const br = b.active()?.browser;
    if (!br) return;
    const r = await G.inContent(br, (content, t) => {
      const d = content.document;
      let c = d.getElementById("cd-label");
      if (!c) {
        c = d.createElement("div");
        c.id = "cd-label";
        c.style.cssText = "position:fixed;left:96px;top:58px;z-index:2147483647;padding:3px 10px;border-radius:7px;background:rgba(20,20,24,0.78);color:#fff;font:600 12px/16px -apple-system,system-ui,sans-serif;pointer-events:none;white-space:nowrap";
        (d.body || d.documentElement).append(c);
      }
      c.textContent = t;
      return true;
    }, text);
    if (r?.error) log("label failed on " + b.active().url + ": " + r.error);
  };
  const unlabel = async () => {
    const br = b.active()?.browser;
    if (br) await G.inContent(br, (content) => content.document.getElementById("cd-label")?.remove() ?? true);
  };

  /** Ink colour of a capsule's main text (what Deer paints), for the contrast check. */
  const inkOf = (el, kind) => {
    const pick = kind === "active" ? el.querySelector(".address .host") || el.querySelector(".address") : kind === "field" ? document.getElementById("vitre-omni") : kind === "plus" ? el.querySelector(".face") : el.querySelector?.(".circle-face .title") || el;
    return pick ? getComputedStyle(pick).color : "";
  };
  /** LAYOUT: every capsule (glass window or CSS capsule) in capture pixels of spike.captureScreen, with its ink. */
  const layout = (name, variant) => {
    const scale = window.devicePixelRatio || 2;
    const ox = window.mozInnerScreenX - window.screenX;
    const oy = window.mozInnerScreenY - window.screenY;
    const toPx = (x, y, w, h) => [(ox + x) * scale, (oy + y) * scale, w * scale, h * scale].map(Math.round);
    const out = [];
    if (variant === "css") {
      for (const i of document.querySelectorAll("#vitre-bar > .item")) {
        const r = i.getBoundingClientRect();
        const kind = i.classList.contains("plus") ? "plus" : i.classList.contains("active") ? "active" : "tab";
        out.push({ kind, title: i.querySelector(".circle-face")?.getAttribute("aria-label") || kind, px: toPx(r.left, r.top, r.width, r.height), ink: inkOf(i, kind) });
      }
      for (const c of document.getElementById("vitre-row-end")?.children ?? []) {
        const r = c.getBoundingClientRect();
        out.push({ kind: c.className, title: c.className, px: toPx(r.left, r.top, r.width, r.height), ink: getComputedStyle(c).color });
      }
    } else {
      for (const c of CD.caps.values()) {
        if (!c.R) continue;
        const item = c.el?.closest?.(".item") || c.el;
        out.push({ kind: c.kind, title: item?.querySelector?.(".circle-face")?.getAttribute("aria-label") || c.kind, px: toPx(c.R.x, c.R.y, c.R.w, c.R.h), ink: inkOf(item || document.body, c.kind), scheme: c.scheme });
      }
    }
    log("LAYOUT " + JSON.stringify({ name, variant, scale, theme: (b.root.className.match(/theme-\w+/) || [""])[0], win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], inner: [ox * scale, oy * scale], caps: out }));
  };

  let shots = 0;
  const shoot = async (state, variant) => {
    const name = `glass-demo-${state}-${variant}`;
    // A stray real key must not land in a focused field during the capture (S1); not while typing.
    if (!b.root.classList.contains("omni-open")) b.focusPage?.();
    await sleep(250);
    layout(name, variant);
    if (variant !== "css") log("CAPS " + name + " " + JSON.stringify(CD.report()));
    await spike.captureScreen(name);
    shots++;
  };

  const hoverAt = (x, y) => {
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x + 1, y, { type: "mousemove" }, window);
  };
  const away = () => {
    EU.synthesizeMouseAtPoint(640, 600, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(641, 600, { type: "mousemove" }, window);
  };
  const rightClick = (x, y) => {
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
  };
  const menuOpen = () => !!window.vitreMenus && window.vitreMenus.state().open;
  const center = (tab) => {
    const r = b.bar.item(tab.id).getBoundingClientRect();
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 };
  };
  const esc = () => EU.synthesizeKey("KEY_Escape", {}, window);
  const typeSlow = async (text, ms) => {
    for (const ch of text) {
      EU.sendString(ch, window);
      await sleep(ms);
    }
  };
  const resizeAnim = async (from, to, ms) => {
    const t0 = performance.now();
    await new Promise((done) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        window.resizeTo(Math.round(from + (to - from) * e), 800);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
  };
  const show = async (tab) => {
    b.activate(tab);
    await waitFor(() => b.activeId === tab.id, { timeout: 4000, what: "tab active" });
    await sleep(900);
    await settle(400);
  };

  // ---- 1. Stills: each state in the three variants ----
  if (ONLY.includes("stills")) {
    const states = {
      article: { tab: "article" },
      scrolled: { tab: "article", before: async () => G.inContent(b.active().browser, (c) => c.scrollTo(0, 300)), after: async () => G.inContent(b.active().browser, (c) => c.scrollTo(0, 0)) },
      dark: { tab: "night" },
      home: { tab: "home" },
      photo: { tab: "photo" },
      hover: { tab: "article", during: async () => {
        const p = center(T.tideline);
        hoverAt(p.x, p.y);
        await sleep(1100);
        return b.bar.item(T.tideline.id).classList.contains("hovered");
      }, still: async () => b.bar.item(T.tideline.id).classList.contains("hovered"), end: async () => {
        away();
        await sleep(700);
      } },
      typing: { tab: "article", during: async () => {
        if (!b.root.classList.contains("omni-open")) {
          b.editAddress("");
          await sleep(500);
          await typeSlow("liquid glass", 40);
        }
        await sleep(900);
        return b.root.classList.contains("omni-open");
      }, still: async () => b.root.classList.contains("omni-open"), end: async () => {
        esc();
        esc();
        await sleep(700);
      } },
      resized: { tab: "article", before: async () => {
        window.resizeTo(960, 800);
        await sleep(900);
        await settle(400);
      }, after: async () => {
        window.resizeTo(1280, 800);
        await sleep(900);
        await settle(400);
      } },
      menu: { tab: "article", during: async () => {
        if (!menuOpen()) {
          const p = center(T.refract);
          rightClick(p.x, p.y);
          await waitFor(menuOpen, { timeout: 4000, what: "tab menu" }).catch(() => {});
          await sleep(500);
        }
        return menuOpen();
      }, still: async () => menuOpen(), end: async () => {
        esc();
        await sleep(500);
      } },
    };
    for (const st of STATES) {
      const s = states[st];
      if (!s) continue;
      await show(T[s.tab]);
      if (s.before) await s.before();
      await sleep(400);
      for (const v of VARIANTS) {
        await CD.set(v === "css" ? null : v);
        await label(VWORDS[v] + " - " + st);
        let ok = true;
        if (s.during) ok = await s.during();
        await sleep(v === "css" ? 300 : 600);
        log("ROW " + st + " " + v + " " + JSON.stringify(rowState()));
        await shoot(st, v);
        // The capture raises Deer's window first; if that took the state away (a menu rolls up when the
        // window becomes key, a field can lose focus), set it up again and take the picture once more.
        if (s.during && ok && !(await s.still())) {
          log(`${st} (${v}): the state was gone after the capture; again`);
          ok = await s.during();
          await sleep(600);
          await shoot(st, v);
          ok = ok && (await s.still());
        }
        check(`${st} (${v}): the state is on screen`, ok !== false, { st, v });
        if (v !== "css") {
          const rep = CD.report();
          const off = rep.filter((c) => c.state !== "open" || (c.gecko && c.want && (Math.abs(c.gecko[0] - c.want[0]) > 1 || Math.abs(c.gecko[1] - c.want[1]) > 1 || Math.abs(c.gecko[2] - c.want[2]) > 1 || Math.abs(c.gecko[3] - c.want[3]) > 1)));
          check(`${st} (${v}): every glass window is open and on its capsule (Gecko's rect)`, rep.length >= 8 && off.length === 0, { n: rep.length, off });
        }
        if (s.end && s.during && st !== "typing" && st !== "hover") await s.end();
      }
      if (s.end && (st === "typing" || st === "hover")) await s.end();
      await CD.set(null);
      await unlabel();
      if (s.after) await s.after();
    }
    check("captures taken: " + shots, shots > 0);
    log("vetoed hides: " + CD.vetoes + ", tick errors: " + CD.errors);
  }

  await show(T.article);
  await CD.set(null);

  /** The motion script (12.5 s): tabs opening and closing, hover, typing, a resize, a menu. Returns its event times. */
  const motionScript = async () => {
    const ev = [];
    const mark = (what) => ev.push([+(performance.timeOrigin + performance.now()).toFixed(1), what]);
    await sleep(500);
    mark("bg-tab-open");
    const extra = b.newTab(url("moltentin", "molten.html"), { background: true, index: 1 });
    await sleep(1000);
    mark("bg-tab-close");
    b.closeTab(extra);
    await sleep(900);
    mark("fg-tab-open");
    const fg = b.newTab(url("moltentin", "molten.html"), { index: 2 });
    await sleep(1100);
    mark("fg-tab-close");
    b.closeTab(fg);
    await sleep(300);
    if (b.activeId !== T.article.id) b.activate(T.article);
    await sleep(700);
    mark("hover-in");
    const p = center(T.tideline);
    hoverAt(p.x, p.y);
    await sleep(1200);
    mark("hover-out");
    away();
    await sleep(500);
    mark("typing-open");
    b.editAddress("");
    await sleep(400);
    mark("typing");
    await typeSlow("liquid glass", 70);
    await sleep(800);
    mark("typing-close");
    esc();
    esc();
    await sleep(700);
    mark("resize-narrow");
    await resizeAnim(1280, 980, 500);
    await sleep(300);
    mark("resize-wide");
    await resizeAnim(980, 1280, 500);
    await sleep(400);
    mark("menu-open");
    const q = center(T.refract);
    rightClick(q.x, q.y);
    await sleep(1300);
    mark("menu-close");
    esc();
    await sleep(500);
    mark("end");
    return ev;
  };
  const now = () => +(performance.timeOrigin + performance.now()).toFixed(1);
  const saveJSON = async (name, data) => {
    const path = PathUtils.join(spike.outDir, name);
    await IOUtils.writeJSON(path, data);
    return path;
  };
  /** Per-frame numbers from a CD record: frames, rAF intervals, the sync's own cost, moves and resizes. */
  const recStats = (frames) => {
    if (!frames?.length) return { frames: 0 };
    const dt = frames.slice(1).map((f, i) => f[0] - frames[i][0]);
    const cost = frames.map((f) => f[1]);
    const q = (arr, k) => {
      const s2 = [...arr].sort((x, y) => x - y);
      return +s2[Math.min(s2.length - 1, Math.floor(k * s2.length))].toFixed(2);
    };
    return { frames: frames.length, secs: +((frames[frames.length - 1][0] - frames[0][0]) / 1000).toFixed(2), dtP50: q(dt, 0.5), dtP95: q(dt, 0.95), dtMax: q(dt, 1), costP50: q(cost, 0.5), costP95: q(cost, 0.95), costMax: q(cost, 1), windowsMax: Math.max(...frames.map((f) => f[4].length)) };
  };

  // ---- 2. Motion: the same script recorded in each variant (60 fps, the window's area) ----
  if (ONLY.includes("motion") && MON) {
    for (const v of ["36", "css", "24"].filter((x) => VARIANTS.includes(x))) {
      await CD.set(v === "css" ? null : v);
      await label(VWORDS[v]);
      await sleep(600);
      // A capture brings Deer's window to the front first (deer-wintool), so nothing covers it in the video.
      await spike.captureScreen(`glass-demo-motion-start-${v}`);
      const tag = v === "36" ? "glass-demo-motion" : `glass-demo-motion-${v}`;
      const r = GB.winRect();
      const recd = await GB.ask("REC", tag, [...r, 14.5], 20000);
      log("CD-RECORDING " + tag + " " + JSON.stringify(recd) + " rect " + JSON.stringify(r));
      if (recd.error) {
        check("recording " + tag, false, recd);
        continue;
      }
      if (v !== "css") CD.startRec();
      const t0 = now();
      const ev = await motionScript();
      const frames = v !== "css" ? CD.stopRec() : null;
      log("MOTION " + tag + " " + JSON.stringify({ t0, ev, sync: frames ? recStats(frames) : null }));
      await sleep(1500);
      check(`motion ${v}: the script ran, row back to six tabs`, b.tabs.length === 6 && !menuOpen(), { tabs: b.tabs.length });
    }
    await CD.set(null);
    await unlabel();
  }

  // ---- 3. Measure: the window server's frames of the glass windows against where Deer's row had each
  // capsule in that frame (CDREC), a programmatic window move, and CPU (CSS row against glass row) ----
  if (ONLY.includes("measure") || ONLY.includes("logic")) {
    for (const v of ["36", "24"].filter((x) => VARIANTS.includes(x))) {
      await CD.set(v);
      await sleep(800);
      const tag = GB.tag("track-" + v);
      if (MON) log("CD-TRACK started " + tag + " " + (await GB.startTrack(tag, 17)));
      CD.startRec();
      const ev = await motionScript();
      // A programmatic window move (not a drag): child windows ride along, Gecko then places them again.
      ev.push([now(), "window-move"]);
      window.moveTo(240, 40);
      await sleep(900);
      ev.push([now(), "window-back"]);
      window.moveTo(40, 40);
      await sleep(900);
      ev.push([now(), "end-measure"]);
      const frames = CD.stopRec();
      const stats = recStats(frames);
      const recPath = await saveJSON(`cd-rec-${v}.json`, { events: ev, frames });
      log("MEASURE " + v + " " + JSON.stringify({ tag, stats, recPath, report: CD.report() }));
      check(`measure ${v}: the sync ran every frame and cost little (p95 under 4 ms)`, stats.frames > 200 && stats.costP95 < 4, stats);
      if (MON) {
        const tr = await GB.result(tag, 40000);
        log("TRACKFILE " + v + " beh-" + tag + ".json samples " + (tr.samples || []).length + (tr.error ? " error " + tr.error : ""));
        check(`measure ${v}: a window-server track came back`, !tr.error && (tr.samples || []).length > 10, tr.error || (tr.samples || []).length);
      }
    }
    if (MON && ONLY.includes("measure")) {
      // CPU: the CSS row and the glass row, idle (5 s) and during the motion script.
      for (const v of ["css", "36"]) {
        await CD.set(v === "css" ? null : v);
        await sleep(1500);
        const t1 = GB.tag("cpu-idle-" + v);
        await GB.start("CPU", t1, [5]);
        const idle = await GB.result(t1, 20000);
        const t2 = GB.tag("cpu-motion-" + v);
        await GB.start("CPU", t2, [12]);
        await motionScript();
        const motion = await GB.result(t2, 30000);
        log("CD-CPU " + v + " " + JSON.stringify({ idle: { engine: idle.engineCpu, ws: idle.windowServerCpu, gpu: idle.gpuUtilAvg, gpuMax: idle.gpuUtilMax }, motion: { engine: motion.engineCpu, ws: motion.windowServerCpu, gpu: motion.gpuUtilAvg, gpuMax: motion.gpuUtilMax } }));
      }
    }
    await CD.set(null);
  }
  log("vetoed hides (b.closePanels and the like): " + CD.vetoes + ", tick errors: " + CD.errors);
  check("no errors in the per-frame sync", CD.errors === 0, CD.errors);
});
