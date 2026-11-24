// Spike S8 (native popover): with widget.macos.native-popovers=true, an anchored panel that follows
// its anchor (type="arrow", or followanchor="true") is shown by Gecko in a real NSPopover. Its look
// and corners, whether Deer's window stays the key window (or the popover takes it and Gecko's
// rollup closes Deer's other popups), its colour scheme, text input, and following a window move.
// Test-only (glasslib.js + behavelib.js). The pref is read when a panel's widget is created, so it
// is set at start:
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s8-popover.js --name mac-glass-s8 --url about:blank \
//       --timeout 500 --out tests/menus/out --pref widget.macos.native-popovers=true --pref ui.systemUsesDarkTheme=1
// Panels, all hanging from a 36 px placeholder capsule at the window's top-right (where Deer's
// Downloads capsule is), position "bottomright topright":
//   P-notail  type="arrow" hidepopovertail animate="false" (appearance none: the popover is the material)
//   P-tail    the same with the popover's arrow
//   P-glass   followanchor="true" without type="arrow": menupopup appearance, so Gecko's NSGlassEffectView
//             inside the popover
//   Q         a Deer-style auto-hide glass panel (nonnative, at a screen point): the canary for a rollup
//   N         an anchored followanchor panel with nonnative="true": stays a plain glass popup window
// Captures: glass-behave-s8-*.png.
/* global spike, G, GB, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const ONLY = Services.env.get("GLASS_ONLY") || "";
  const want = (s) => !ONLY || ONLY.split(",").includes(s);
  const pref = Services.prefs.getBoolPref("widget.macos.native-popovers", false);
  const forced = Services.prefs.getIntPref("ui.systemUsesDarkTheme", -1);
  const sys = forced === 1 ? "sysdark" : forced === 0 ? "syslight" : "sys";
  log("widget.macos.native-popovers = " + pref + "; system " + sys);
  check("S8 runs with widget.macos.native-popovers=true", pref, pref);
  await spike.resize(1200, 760);
  await spike.activate();
  const body = `<div style="position:absolute;inset:0;background:linear-gradient(90deg,#ffffff 0 50%,#101010 50% 100%)"></div><div style="position:absolute;left:40px;top:120px;font:700 40px system-ui;color:#222">white half</div><div style="position:absolute;right:40px;top:120px;font:700 40px system-ui;color:#eee">black half</div>`;
  await G.load(G.page("Popover", "#ffffff", "#222", body));
  await G.caption("");
  b.focusPage();

  const cap = GB.placeholder("gb-cap", "right:20px;top:8px;width:36px;height:36px;border-radius:18px;background:rgba(10,132,255,.9);");
  const cap2 = GB.placeholder("gb-cap2", "left:calc(50% - 18px);top:8px;width:36px;height:36px;border-radius:18px;background:rgba(10,132,255,.9);");
  let deact = 0;
  let act = 0;
  window.addEventListener("deactivate", () => deact++);
  window.addEventListener("activate", () => act++);
  const listHtml = (title) =>
    `<div class="hd">${title}</div><div class="row"><span>report.pdf</span><span class="k">2.1 MB</span></div><div class="row hi"><span>photo.jpg</span><span class="k">640 KB</span></div><div class="row"><span>video.mp4</span><span class="k">48%</span></div>` +
    `<div style="padding:6px 12px"><input id="gb-in" type="text" placeholder="Search downloads" style="font:14px system-ui;padding:5px 10px;border-radius:8px;border:1px solid light-dark(rgba(0,0,0,.2),rgba(255,255,255,.25));background:transparent;color:inherit;width:300px" /></div>`;

  async function popover(name, attrs, opts = {}) {
    const p = await GB.anchored({
      name,
      anchor: opts.anchor || cap,
      position: opts.position || "bottomright topright",
      y: opts.y ?? 0,
      w: 360,
      h: 240,
      scheme: opts.scheme || "dark",
      cls: "menu",
      html: listHtml(name + " · " + (opts.scheme || "dark")),
      attrs,
      ignorekeys: false,
      pcls: opts.pcls || "",
    });
    await sleep(700);
    return p;
  }
  const results = {};
  async function look(label, extra = {}) {
    const wl = await GB.ask("WINLIST", GB.tag("s8-" + label));
    const ax = await GB.ask("AXINFO", GB.tag("s8-ax-" + label));
    const ws = (wl.windows || []).filter((w) => w.who === "mine").map((w) => ({ order: w.order, layer: w.layer, rect: [w.x, w.y, w.w, w.h], title: w.title || "" }));
    const rec = {
      deactivateEvents: deact,
      activateEvents: act,
      geckoActive: Services.focus.activeWindow === window,
      docHasFocus: document.hasFocus(),
      ax: { active: ax.active, focused: ax.focusedWindow, main: ax.mainWindow, windows: (ax.windows || []).map((w) => [w.role, w.subrole, w.title, Math.round(w.w || 0), Math.round(w.h || 0)]) },
      windows: ws,
      win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight],
      ...extra,
    };
    log("S8 " + label + " " + JSON.stringify(rec));
    results[label] = rec;
    return rec;
  }

  await look("start");

  // ---- 1. control: an anchored followanchor panel marked nonnative stays a glass popup window ----
  let Q = null;
  const openQ = async () => {
    if (Q) G.close(Q);
    Q = await GB.anchored({ name: "Q-autohide", atScreen: { x: 40, y: 420 }, follow: false, w: 260, h: 120, scheme: "dark", html: `<div>Deer-style auto-hide glass</div><div class="sec">the rollup canary</div>`, autohide: true, attrs: { nonnative: "true" } });
    await sleep(300);
  };
  if (want("control")) {
    await openQ();
    const N = await GB.anchored({ name: "N-nonnative", anchor: cap2, position: "bottomcenter topcenter", y: 8, w: 360, h: 200, scheme: "dark", cls: "menu", html: `<div class="hd">followanchor + nonnative: a plain glass popup</div>`, attrs: { nonnative: "true" } });
    await sleep(600);
    await look("control-nonnative", { Q: Q.state, N: N.state });
    await spike.captureScreen("glass-behave-s8-control-nonnative-" + sys);
    G.close(N);
  }

  // ---- 2. the popover without its arrow, with the canary open ----
  if (want("notail")) {
    await openQ();
    deact = 0;
    act = 0;
    const P = await popover("P-notail", { type: "arrow", hidepopovertail: "true", animate: "false" });
    const r = await look("notail", { P: P.state, Q: Q.state, panelRect: GB.rect(P) });
    await spike.captureScreen("glass-behave-s8-popover-notail-" + sys);
    check("S8 the popover opens", P.state === "open", P.state);
    results.rollup = { canaryAfterPopover: Q.state, deactivateEvents: deact };
    check("S8 Deer's auto-hide popups survive the popover opening (no rollup)", Q.state === "open", results.rollup);

    // text input in the popover: synthesized, then real keys posted to the engine
    const inp = P.querySelector("#gb-in");
    inp.focus();
    await sleep(200);
    const focused = document.activeElement === inp;
    spike.type("pdf");
    await sleep(150);
    const synth = inp.value;
    inp.value = "";
    await spike.captureScreen("glass-behave-s8-popover-input-" + sys); // Deer to the front for real keys
    inp.focus();
    await sleep(200);
    const k = await GB.ask("KEYS", GB.tag("s8-keys"), ["j", "p", "g"]);
    await sleep(500);
    const realTyped = inp.value;
    const axf = await GB.ask("AXFOCUS", GB.tag("s8-axfocus"), [], 20000);
    const after = await look("notail-typed", { P: P.state });
    results.input = { focused, synth, sent: k.sent || k.error, realTyped, axFocused: axf.focused, keyWindowAfterTyping: after.ax.focused };
    log("S8 input " + JSON.stringify(results.input));
    check("S8 synthesized typing reaches the popover's field", synth === "pdf", synth);
    check("S8 real keys reach the popover's field", realTyped === "jpg", realTyped);

    // the window moves: does the popover follow?
    const t = GB.tag("s8-move");
    await GB.startTrack(t, 2);
    await sleep(100);
    const tA = Date.now();
    window.moveTo(window.screenX + 120, window.screenY + 50);
    await sleep(1400);
    const tr = await GB.result(t);
    const first = tr.samples?.[0]?.[1] || [];
    const last = tr.samples?.[tr.samples.length - 1]?.[1] || [];
    results.move = { firstFrames: first.map((r) => r.slice(1, 6)), lastFrames: last.map((r) => r.slice(1, 6)), P: P.state, samples: tr.samples?.length, tA, t0: tr.t0 };
    log("S8 move " + JSON.stringify(results.move));
    await look("notail-moved", { P: P.state, panelRect: P.state === "open" ? GB.rect(P) : null });
    window.moveTo(40, 40);
    await sleep(600);
    // Esc in the popover's field
    inp.focus();
    const n = b.keys.log.length;
    EU.synthesizeKey("KEY_Escape", {}, window);
    await sleep(500);
    results.esc = { P: P.state, router: b.keys.log.slice(n) };
    log("S8 esc " + JSON.stringify(results.esc));
    G.close(P);
    await sleep(400);
  }

  // ---- 2b. an auto-hide popover (the quick view would be one): does it stay open? ----
  if (want("auto")) {
    await openQ();
    deact = 0;
    const P = await GB.anchored({ name: "P-autohide", anchor: cap, position: "bottomright topright", w: 360, h: 200, scheme: "dark", cls: "menu", html: `<div class="hd">auto-hide popover</div>`, attrs: { type: "arrow", hidepopovertail: "true", animate: "false" }, autohide: true, ignorekeys: false });
    await sleep(1200);
    await look("autohide-popover", { P: P.state, Q: Q.state });
    check("S8 an auto-hide popover stays open after it shows", P.state === "open", { P: P.state, Q: Q.state, deact });
    G.close(P);
    await sleep(300);
  }

  // ---- 3. with the arrow ----
  if (want("tail")) {
    const P = await popover("P-tail", { type: "arrow", animate: "false" });
    await look("tail", { P: P.state, panelRect: GB.rect(P) });
    await spike.captureScreen("glass-behave-s8-popover-tail-" + sys);
    G.close(P);
    await sleep(300);
  }

  // ---- 4. colour scheme: light and dark panels, over the white half and the black half ----
  if (want("scheme")) {
    const left = GB.placeholder("gb-capL", "left:200px;top:8px;width:36px;height:36px;border-radius:18px;background:rgba(10,132,255,.9);");
    const P1 = await popover("P-light", { type: "arrow", hidepopovertail: "true", animate: "false" }, { scheme: "light", anchor: left, position: "bottomleft topleft" });
    const P2 = await popover("P-dark", { type: "arrow", hidepopovertail: "true", animate: "false" }, { scheme: "dark" });
    await look("scheme", { P1: P1.state, P2: P2.state, r1: GB.rect(P1), r2: GB.rect(P2), rootTheme: [...b.root.classList].filter((c) => c.startsWith("theme")) });
    await spike.captureScreen("glass-behave-s8-popover-scheme-" + sys);
    G.close(P1);
    G.close(P2);
    await sleep(300);
  }

  // ---- 5. followanchor with menupopup appearance: Gecko's glass inside the popover ----
  if (want("glassinside")) {
    const P = await popover("P-glass-inside", { followanchor: "true" });
    await look("glass-inside", { P: P.state, panelRect: GB.rect(P) });
    await spike.captureScreen("glass-behave-s8-popover-glass-inside-" + sys);
    G.close(P);
    await sleep(300);
  }

  // ---- 6. Deer's own menu still works with the pref on (it opens at a screen point) ----
  if (want("menu")) {
    b.focusPage();
    await sleep(200);
    for (const type of ["mousemove", "mousedown", "mouseup", "contextmenu"]) EU.synthesizeMouseAtPoint(500, 400, type === "mousemove" ? { type } : { type, button: 2 }, window);
    const open = await waitFor(() => window.vitreMenus?.state().open, { timeout: 4000, what: "Deer menu" }).then(() => true, () => false);
    await sleep(400);
    await look("deer-menu", { menuOpen: open });
    check("S8 Deer's menu still opens with the pref on", open);
    EU.synthesizeKey("KEY_Escape", {}, window);
    await sleep(300);
  }
  log("S8 RESULTS " + JSON.stringify(results));
  G.closeAll();
});
