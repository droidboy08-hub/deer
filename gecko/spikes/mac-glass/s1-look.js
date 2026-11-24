// Spike S1 (look), S2 (shape) and the media-query half of S11: Apple's real Liquid Glass in Firefox
// 157 popup windows, next to Deer's CSS-glass row. Test-only: the glass pieces are XUL <panel>s made
// here at runtime (glasslib.js), the way src/window/modules/menus/panelhost.ts makes Deer's menus.
//   cd gecko
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s1-look.js --name mac-glass-s1 --url about:blank \
//       --timeout 400 --out tests/menus/out --pref ui.systemUsesDarkTheme=0     (then =1)
// Captures (spike.captureScreen: the window's screen area with its popup windows), each name ending
// in -syslight / -sysdark (what Gecko was told the system appearance is):
//   glass-look-<backdrop>-small-*  the row (Deer's CSS capsules) with four REAL glass capsules in it
//                                  (36 px light / dark / light dark, and a 24 px pill), and below three
//                                  columns of REAL glass, color-scheme light | dark | light dark,
//                                  24, 36, 64, 66 and 300 px tall
//   glass-look-<backdrop>-big-*    three 688 px REAL glass panels (Settings-like), one per scheme
//   backdrops: white, black, text, scroll (captured while the page scrolls, then stopped), photo
//   (Deer's Home wallpaper)
//   glass-look-stale-a/b-*         the pieces opened over the white page, then the page turned black
//                                  under them (0.4 s and 2.5 s later): a stale backdrop shows white
//   glass-look-shape-black/white-* S2: corners, CSS border-radius, a 24 px pill, content clipped at 18 px
/* global spike, G, Services, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const forced = Services.prefs.getIntPref("ui.systemUsesDarkTheme", -1);
  const sys = forced === 1 ? "sysdark" : forced === 0 ? "syslight" : "sys";
  const sysWords = forced === 1 ? "Gecko told: system Dark" : forced === 0 ? "Gecko told: system Light" : "system appearance";
  const ONLY = Services.env.get("GLASS_ONLY") || ""; // run only some sections (comma list), for retries
  const want = (s) => !ONLY || ONLY.split(",").includes(s);
  log("system appearance seen by Gecko: " + (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") + " (ui.systemUsesDarkTheme " + forced + ")");

  // ---- S11 (media half) ----
  const mq = [
    "(prefers-reduced-transparency)",
    "(prefers-reduced-transparency: reduce)",
    "(prefers-reduced-transparency: no-preference)",
    "(prefers-contrast)",
    "(prefers-contrast: more)",
    "(prefers-contrast: less)",
    "(prefers-contrast: custom)",
    "(prefers-contrast: no-preference)",
    "(forced-colors: active)",
    "(prefers-reduced-motion: reduce)",
    "(-moz-mac-tahoe-theme)",
  ];
  const chromeMQ = Object.fromEntries(mq.map((q) => { const m = matchMedia(q); return [q, { media: m.media, matches: m.matches }]; }));
  log("S11 chrome matchMedia " + JSON.stringify(chromeMQ));
  const prefs = {};
  for (const p of ["layout.css.prefers-reduced-transparency.enabled", "layout.css.prefers-contrast.enabled", "ui.prefersReducedTransparency", "ui.useAccessibilityTheme", "browser.display.document_color_use", "layout.css.forced-colors.enabled"]) {
    const t = Services.prefs.getPrefType(p);
    prefs[p] = t === 128 ? Services.prefs.getBoolPref(p) : t === 64 ? Services.prefs.getIntPref(p) : t === 32 ? Services.prefs.getStringPref(p) : "(unset)";
  }
  log("S11 prefs " + JSON.stringify(prefs));
  log("S11 CSS.supports " + JSON.stringify({
    "-moz-window-transform": CSS.supports("-moz-window-transform", "scale(0.96)"),
    "-moz-window-transform-origin": CSS.supports("-moz-window-transform-origin", "50% 50%"),
    "-moz-window-opacity": CSS.supports("-moz-window-opacity", "0.5"),
    "-moz-window-shadow": CSS.supports("-moz-window-shadow", "none"),
    "-moz-default-appearance": CSS.supports("-moz-default-appearance", "menupopup"),
  }));

  await spike.resize(1400, 880);
  await spike.activate();

  const W = 400;
  const COLS = [
    { x: 40, scheme: "light", label: "light" },
    { x: 500, scheme: "dark", label: "dark" },
    { x: 960, scheme: "light dark", label: "light dark" },
  ];
  const SMALL = [
    { y: 72, h: 24 },
    { y: 110, h: 36 },
    { y: 160, h: 64 },
    { y: 238, h: 66 },
    { y: 318, h: 300 },
  ];
  const menuRows = (label, h) =>
    `<div class="hd">REAL glass · ${h} px · color-scheme: ${label}</div>` +
    `<div class="row"><span>Back</span><span class="k">⌘[</span></div>` +
    `<div class="row dis"><span>Forward</span><span class="k">⌘]</span></div>` +
    `<div class="row hi"><span>Reload</span><span class="k">⌘R</span></div>` +
    `<div class="sep"></div>` +
    `<div class="row"><span>Find on page…</span><span class="k">⌘F</span></div>` +
    `<div class="row"><span>Print…</span><span class="k">⌘P</span></div>` +
    `<div class="row"><span>Save page as…</span><span class="k">⌘S</span></div>` +
    `<div class="sep"></div>` +
    `<div class="row"><span>Inspect</span><span class="k">⌥⌘I</span></div>`;
  const piece = (h, label) => {
    if (h === 24) return { cls: "h24", html: `<span>REAL glass · 24 px · ${label}</span>` };
    if (h === 36) return { cls: "h36", html: `<span class="dot"></span><span>REAL glass · 36 px · ${label}</span>` };
    if (h === 64 || h === 66) return { cls: "", html: `<div>REAL glass · ${h} px (${h <= 64 ? "small" : "large"} glass)</div><div class="sec">color-scheme: ${label} · Deer's menu ink</div>` };
    return { cls: "menu", html: menuRows(label, h) };
  };
  const settings = (label) =>
    `<h2>Settings</h2><div class="sec top">REAL glass · 688 px · color-scheme: ${label}</div>` +
    `<div class="grp">Appearance</div>` +
    `<div class="opt"><div class="t"><span>Mode</span><span class="sec">Follow the Mac, or always light or dark</span></div><span class="sec">System</span></div>` +
    `<div class="opt"><div class="t"><span>Hide the row</span><span class="sec">Show it when the pointer is at the top</span></div><span class="sw off"></span></div>` +
    `<div class="opt"><div class="t"><span>Compact titles</span><span class="sec">Background tabs show their title</span></div><span class="sw"></span></div>` +
    `<div class="grp">Privacy</div>` +
    `<div class="opt"><div class="t"><span>Block trackers</span><span class="sec">Strict protection on every site</span></div><span class="sw"></span></div>` +
    `<div class="opt"><div class="t"><span>Clear history on quit</span><span class="sec">Cookies and site data stay</span></div><span class="sw off"></span></div>` +
    `<div class="grp">Downloads</div>` +
    `<div class="opt"><div class="t"><span>Save files to</span><span class="sec">~/Downloads</span></div><span class="sec">Change…</span></div>` +
    `<div class="opt"><div class="t"><span>Ask where to save</span><span class="sec">Every download asks for a folder</span></div><span class="sw off"></span></div>` +
    `<span class="btn">Done</span>`;

  /** The row's free stretch, between the + capsule and the capsules at the end. */
  function rowGap() {
    const plus = document.querySelector("#vitre-bar .item.plus")?.getBoundingClientRect();
    const end = document.getElementById("vitre-row-end")?.getBoundingClientRect();
    const from = plus ? plus.right + 16 : 640;
    const to = end && end.width ? end.left - 16 : window.innerWidth - 120;
    return { from, to };
  }

  async function layoutSmall() {
    // Real glass capsules in the row, beside Deer's CSS capsules, over the same page.
    const { from, to } = rowGap();
    const cw = Math.min(150, Math.floor((to - from - 3 * 10 - 110) / 3));
    let x = from;
    for (const c of COLS) {
      await G.panel({ x, y: 8, w: cw, h: 36, scheme: c.scheme, cls: "h36", html: `<span class="dot"></span><span>real · ${c.label}</span>`, name: "row36-" + c.label, wait: false });
      x += cw + 10;
    }
    await G.panel({ x, y: 14, w: Math.min(110, to - x), h: 24, scheme: "light dark", cls: "h24", html: "<span>real 24 · auto</span>", name: "row24-auto", wait: false });
    for (const c of COLS)
      for (const s of SMALL) {
        const { cls, html } = piece(s.h, c.label);
        await G.panel({ x: c.x, y: s.y, w: W, h: s.h, scheme: c.scheme, cls, html, name: `col-${c.label}-${s.h}`, wait: false });
      }
    await sleep(700);
  }
  async function layoutBig() {
    for (const c of COLS) await G.panel({ x: c.x, y: 64, w: W, h: 688, scheme: c.scheme, cls: "settings", html: settings(c.label), name: `big-${c.label}`, wait: false });
    await sleep(700);
  }

  const shots = [];
  const shoot = async (name, what) => {
    const full = name + "-" + sys;
    G.layout(full);
    log("CAPTURE " + full + " :: " + what);
    shots.push(full);
    await spike.captureScreen(full);
  };
  const cap = (backdrop, kind) =>
    kind === "small"
      ? `Backdrop: ${backdrop} · ${sysWords} (the Mac itself: Dark) · Top row: Deer's capsules today = CSS glass, then 4 REAL glass capsules\n` +
        "Below: REAL Apple glass (popup windows), columns = color-scheme light | dark | light dark; heights 24, 36, 64, 66, 300 px"
      : `Backdrop: ${backdrop} · ${sysWords} (the Mac itself: Dark) · Top row: Deer's capsules today = CSS glass\n` +
        "Below: REAL Apple glass, three 688 px panels, color-scheme light | dark | light dark";

  const text = (n) =>
    "<p style='margin:0 40px 14px;max-width:1240px'>A ribbon of glass floats on molten tin until it is flat on both faces, then cools as it moves down the line and is cut into sheets. <a href='#' style='color:#0b57d0'>Read more about the float process</a>, its <b>history</b>, and why the tin bath is kept under a nitrogen atmosphere.</p>".repeat(n);
  const PAGES = {
    white: G.page("White", "#ffffff", "#1d1d1f", ""),
    black: G.page("Black", "#000000", "#f5f5f7", ""),
    text: G.page("Field Notes", "#ffffff", "#1d1d1f", "<div style='height:56px'></div><h1 style='margin:0 40px 12px;font-size:40px'>Float glass</h1>" + text(60), "#b00020"),
    scroll: G.page("Stripes", "#ffffff", "#1d1d1f", Array.from({ length: 300 }, (_, i) => `<div style="height:90px;background:${["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#1d1d1f", "#af52de", "#ff9500"][i % 8]};font:700 44px/90px system-ui;padding-left:40px;color:${i % 8 === 5 ? "#fff" : "#000"}">row ${i} · the quick brown fox</div>`).join(""), "#ffffff"),
  };

  // ---- S1 over plain pages ----
  for (const bd of ["white", "black", "text"]) {
    if (!want(bd)) continue;
    await G.load(PAGES[bd]);
    b.focusPage?.();
    await sleep(500);
    await G.caption(cap(bd + " page", "small"));
    await layoutSmall();
    await shoot(`glass-look-${bd}-small`, `${bd} page, small pieces`);
    if (bd === "white" && want("stale")) {
      // F11: the page turns black under the open glass, nothing else moves.
      await G.inContent(b.active().browser, (content) => {
        content.document.body.style.background = "#000";
        content.document.getElementById("cap").style.color = "#f5f5f7";
        content.document.getElementById("cap").style.background = "#000";
        return true;
      });
      await G.caption("STALE TEST: the pieces were opened over a WHITE page, then the page turned BLACK under them (0.4 s ago)\nA stale backdrop would show white or light glass where the page is black now.");
      await sleep(400);
      await shoot("glass-look-stale-a", "page turned black under open glass, 0.4 s");
      await sleep(2100);
      await G.caption("STALE TEST: the pieces were opened over a WHITE page, then the page turned BLACK under them (2.5 s ago)\nA stale backdrop would show white or light glass where the page is black now.");
      await shoot("glass-look-stale-b", "page turned black under open glass, 2.5 s");
    }
    G.closeAll();
    await sleep(300);
    if (bd === "white" && want("stale")) {
      await G.load(PAGES.white);
      await sleep(300);
    }
    await G.caption(cap(bd + " page", "big"));
    await layoutBig();
    await shoot(`glass-look-${bd}-big`, `${bd} page, 688 px panels`);
    G.closeAll();
    await sleep(300);
  }

  // ---- S1 over a page while it scrolls ----
  if (want("scroll")) {
    await G.load(PAGES.scroll);
    await sleep(300);
    await G.caption("");
    const startScroll = () =>
      G.inContent(b.active().browser, (content) => {
        content.__go = true;
        const step = () => {
          if (!content.__go) return;
          content.scrollBy(0, 6);
          content.requestAnimationFrame(step);
        };
        content.requestAnimationFrame(step);
        return true;
      });
    const stopScroll = () => G.inContent(b.active().browser, (content) => { content.__go = false; return content.scrollY; });
    for (const kind of ["small", "big"]) {
      if (kind === "small") await layoutSmall();
      else await layoutBig();
      await startScroll();
      await sleep(700);
      await shoot(`glass-look-scroll-${kind}-moving`, "stripes page scrolling 6 px a frame under the glass");
      const y = await stopScroll();
      await sleep(900);
      await shoot(`glass-look-scroll-${kind}-stopped`, "the same, 0.9 s after the scroll stopped at " + y);
      G.closeAll();
      await sleep(300);
    }
  }

  // ---- S2 shape ----
  if (want("shape")) {
    for (const bd of ["black", "white"]) {
      await G.load(PAGES[bd]);
      await sleep(300);
      await G.caption(`S2 shape, ${bd} page · 1: plain 160 px (glass corners 12) · 2: CSS border-radius 40 on the panel and its content · 3: content clipped to 18 px, tinted\n4: 24 px tall (pill?) · 5: 36 px, content clipped to 18 px, tinted · 6: 24 px dark · 7: 36 px plain · all color-scheme light unless said`);
      const y0 = 110;
      const sq = (n, x, extra = {}) => G.panel({ x, y: y0, w: 160, h: 160, scheme: "light", html: `<div>${n}</div>`, name: "shape" + n, wait: false, ...extra });
      await sq(1, 60);
      await sq(2, 260, { style: "border-radius:40px;--panel-border-radius:40px", inStyle: "border-radius:40px" });
      await sq(3, 460, { inStyle: "border-radius:18px;background:rgba(10,132,255,0.55);color:#fff" });
      await G.panel({ x: 700, y: y0, w: 160, h: 24, scheme: "light", cls: "h24", html: "<span>4 · 24 px</span>", name: "shape4", wait: false });
      await G.panel({ x: 700, y: y0 + 60, w: 160, h: 36, scheme: "light", cls: "h36", html: "<span>5 · 36 px</span>", inStyle: "border-radius:18px;background:rgba(10,132,255,0.55);color:#fff", name: "shape5", wait: false });
      await G.panel({ x: 920, y: y0, w: 160, h: 24, scheme: "dark", cls: "h24", html: "<span>6 · 24 px dark</span>", name: "shape6", wait: false });
      await G.panel({ x: 920, y: y0 + 60, w: 160, h: 36, scheme: "light", cls: "h36", html: "<span>7 · 36 px</span>", name: "shape7", wait: false });
      // Big squares for corner measurement, light and dark scheme.
      await G.panel({ x: 60, y: 360, w: 300, h: 300, scheme: "light", html: "<div>8 · 300 px light</div>", name: "shape8", wait: false });
      await G.panel({ x: 400, y: 360, w: 300, h: 300, scheme: "dark", html: "<div>9 · 300 px dark</div>", name: "shape9", wait: false });
      await sleep(800);
      await shoot("glass-look-shape-" + bd, "S2 shapes over " + bd);
      G.closeAll();
      await sleep(300);
    }
  }

  // ---- S1 over a photo: Deer's Home wallpaper ----
  if (want("photo")) {
    const home = b.newTab();
    await sleep(2200);
    b.focusPage?.();
    await sleep(400);
    await G.caption(cap("photo (Deer's Home wallpaper)", "small"));
    b.focusPage?.();
    await sleep(300);
    await layoutSmall();
    await shoot("glass-look-photo-small", "Home wallpaper, small pieces");
    G.closeAll();
    await sleep(300);
    await G.caption(cap("photo (Deer's Home wallpaper)", "big"));
    b.focusPage?.();
    await sleep(300);
    await layoutBig();
    await shoot("glass-look-photo-big", "Home wallpaper, 688 px panels");
    G.closeAll();
  }

  // S11 again, from a web page (content process).
  await G.load(PAGES.white);
  const contentMQ = await G.inContent(gBrowser.selectedBrowser, (content, qs) => Object.fromEntries(qs.map((q) => { const m = content.matchMedia(q); return [q, { media: m.media, matches: m.matches }]; })), mq);
  log("S11 content matchMedia (" + gBrowser.selectedBrowser.currentURI.spec.slice(0, 40) + ") " + JSON.stringify(contentMQ));
  check("captures taken: " + shots.length, shots.length > 0, shots);
});
