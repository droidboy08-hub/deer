// Spike glass / test 5: window-level translucency for Home. Is Mica / Acrylic / a transparent window
// usable under Vitre's chrome layer? Run with --pref widget.windows.mica=true (and
// widget.windows.mica.toplevel-backdrop=1|2|3). PrintWindow cannot see the DWM backdrop, so
// tools/screencap.py grabs the real screen when this script logs "@@screencap".
/* global spike, G, gBrowser, Services, document, window, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  // Other spikes park their windows at (40,40); move to the free part of the screen so the real
  // screen grab (tools/screencap.py) sees this window.
  if (Services.env.get("VITRE_MOVE") !== "0" && window.screen.availWidth >= 2500) {
    window.resizeTo(1240, 800);
    window.moveTo(1310, 630);
    await spike.sleep(500);
  }
  const tag = Services.env.get("VITRE_TAG") || "default";
  const mq = (q) => window.matchMedia(q).matches;
  for (const p of ["widget.windows.mica", "widget.windows.mica.toplevel-backdrop", "widget.windows.mica.popups", "browser.theme.native-theme"]) {
    const t = Services.prefs.getPrefType(p);
    spike.log("pref", p, t === 128 ? Services.prefs.getBoolPref(p) : t === 64 ? Services.prefs.getIntPref(p) : "(none)");
  }
  spike.log("media (-moz-windows-mica):", mq("(-moz-windows-mica)"), "(-moz-windows-accent-color-in-titlebar):", mq("(-moz-windows-accent-color-in-titlebar)"), "(prefers-reduced-transparency):", mq("(prefers-reduced-transparency: reduce)"), "(-moz-native-theme):", mq("(-moz-native-theme)"));
  const root = document.documentElement;
  spike.log("root attrs: windowsmica=", root.getAttribute("windowsmica"), "lwtheme=", root.hasAttribute("lwtheme"), "builtintheme=", root.hasAttribute("builtintheme"), "customtitlebar=", root.getAttribute("customtitlebar"));
  spike.log("root background:", getComputedStyle(root).backgroundColor, "toolbox:", getComputedStyle(document.getElementById("navigator-toolbox")).backgroundColor);

  // Phase 1: stock Firefox UI (is the title bar Mica?).
  await G.go(G.sibling("page.html") + "?noanim=1");
  await spike.capture("mica-" + tag + "-stock");
  spike.log("@@screencap stock");
  await spike.sleep(7000);

  // Phase 2: Vitre-style. Firefox UI hidden, every chrome background transparent, the page hidden,
  // so whatever is behind the window (DWM backdrop or nothing) is what Home would sit on.
  G.hideFirefoxUI();
  G.css(`
    :root, body, #browser, #tabbrowser-tabbox, #tabbrowser-tabpanels, .browserContainer, .browserStack, #appcontent, #main-window {
      background: transparent !important; background-color: transparent !important; }
    #tabbrowser-tabpanels browser { visibility: hidden !important; }
  `);
  const L = G.layer();
  G.el("div", "position:absolute; left:60px; top:90px; font:600 40px 'Segoe UI Variable Display','Segoe UI'; color:#fff; text-shadow:0 1px 3px rgba(0,0,0,0.5);", L, "Home on the window backdrop (" + tag + ")");
  G.el("div", "position:absolute; left:60px; top:150px; font:400 16px 'Segoe UI'; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.6);", L, "root background is transparent; the page <browser> is hidden; glass below uses parent backdrop-filter");
  const mk = (x, y, w, h, bf, label, bg) => {
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${Math.min(22, h / 2)}px; backdrop-filter:${bf}; background:${bg}; box-shadow:0 10px 28px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.35) inset; display:flex; align-items:center; justify-content:center; color:#fff;`, L, label);
    return t;
  };
  mk(400, 12, 480, 44, "blur(12px) saturate(1.5)", "pill: blur(12px) saturate(1.5), tint 0.10", "rgba(255,255,255,0.10)");
  mk(60, 220, 360, 200, "blur(24px) saturate(1.6)", "panel: blur(24px), dark tint 0.3", "rgba(16,16,20,0.3)");
  mk(460, 220, 360, 200, "none", "no backdrop-filter, tint 0.10", "rgba(255,255,255,0.10)");
  mk(860, 220, 360, 200, "none", "opaque #2b2a2e", "#2b2a2e");
  G.el("div", "position:absolute; left:60px; top:460px; width:1160px; height:260px; background:repeating-linear-gradient(90deg,#e6194b 0 40px,#ffe119 40px 80px,#4363d8 80px 120px,#fff 120px 160px,#000 160px 200px); border-radius:16px;", L);
  mk(160, 520, 480, 120, "blur(10px) saturate(1.5)", "blur over chrome-drawn stripes (works)", "rgba(255,255,255,0.10)");
  await spike.sleep(600);
  await spike.capture("mica-" + tag + "-vitre");
  spike.log("@@screencap vitre");
  await spike.sleep(7000);
});
