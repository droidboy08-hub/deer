// Spike S4 (input): an <input> inside a real glass panel. Focus, typing, ⌘A/C/X/V/Z, the native
// editing keys, a synthesized IME composition and where Gecko would put the IME candidate window,
// Esc, ⌘W and ⌘L through Deer's key router, and real key events posted to the engine process.
// Test-only (glasslib.js + behavelib.js build the panels at runtime).
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s4-input.js --name mac-glass-s4 --url about:blank \
//       --timeout 400 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Variants (all level="parent", anchored with followanchor, the Settings stand-in):
//   V1 "deer"    noautohide, noautofocus, ignorekeys="true" (how panelhost.ts opens Deer's menus)
//   V2 "plain"   noautohide, noautofocus, no ignorekeys (the popup manager may listen to keys)
//   V3 "autohide" auto-hide, noautofocus, no ignorekeys (the quick view / suggestions stand-in)
// Deer's Esc ladder and ⌘W ladder get a test layer each (b.addEscLayer(60), b.addCloseLayer(60)),
// as a glass Settings panel would register them. Captures: glass-behave-s4-*.png.
/* global spike, G, GB, Services, Cc, Ci, gBrowser */
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
  await spike.resize(1200, 760);
  await spike.activate();

  // The page records every key it receives (the keys must stay in the panel's field).
  const pageUrl = G.page("Input", "#f4f4f4", "#1d1d1f", `<h1 style="margin:60px 40px 10px;font:700 34px system-ui">A page under a glass panel</h1><p style="margin:0 40px;max-width:900px">${"Keys typed in the panel's field must not reach this page. ".repeat(20)}</p><input id=pagefield style="margin:20px 40px;font:16px system-ui" value="page field" />`);
  await G.load(pageUrl);
  // A second tab, so ⌘W never closes the window.
  b.newTab(G.page("Spare", "#ffffff", "#000", "<p>spare tab</p>"), { background: true });
  await sleep(600);
  const tabsAt = () => b.tabs.length;
  const pageKeys = async (reset) =>
    G.inContent(b.active().browser, (content, r) => {
      const w = content.wrappedJSObject || content;
      if (!content.__gbKeys) {
        content.__gbKeys = [];
        content.addEventListener("keydown", (e) => content.__gbKeys.push(e.key), true);
      }
      const k = content.__gbKeys.slice();
      if (r) content.__gbKeys.length = 0;
      return k;
    }, !!reset);
  await pageKeys(true);
  b.focusPage();
  await sleep(200);

  // Anchor: the centred placeholder, as for a Settings panel.
  const aEl = GB.placeholder("gb-a", "left:calc(50% - 280px);top:calc(50% - 170px);width:560px;height:340px;");
  const fieldHtml = (label) =>
    `<h2>Settings stand-in</h2><div class="sec top">${label}</div>` +
    `<input id="gb-in" type="text" placeholder="Find a setting" style="font:15px system-ui;padding:6px 10px;border-radius:8px;border:1px solid light-dark(rgba(0,0,0,.2),rgba(255,255,255,.25));background:light-dark(rgba(255,255,255,.6),rgba(0,0,0,.25));color:inherit;width:360px" />` +
    `<div class="opt"><div class="t"><span>Block trackers</span><span class="sec">Strict protection on every site</span></div><span class="sw"></span></div>`;

  // Deer's ladders get a layer for the panel, the way a glass Settings would register them.
  let panel = null;
  const calls = { esc: 0, close: 0 };
  const offEsc = b.addEscLayer(60, () => {
    if (!panel || panel.state !== "open") return false;
    calls.esc++;
    panel.hidePopup();
    return true;
  });
  let closeHow = "state";
  let panelFlag = false;
  const offClose = b.addCloseLayer(60, () => {
    if (!panel) return false;
    if (closeHow === "state" ? panel.state !== "open" : !panelFlag) return false;
    calls.close++;
    panelFlag = false;
    if (panel.state === "open") panel.hidePopup();
    return true;
  });

  const readClip = () => {
    try {
      const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      t.init(null);
      t.addDataFlavor("text/plain");
      Services.clipboard.getData(t, Ci.nsIClipboard.kGlobalClipboard);
      const o = {};
      t.getTransferData("text/plain", o);
      return o.value.QueryInterface(Ci.nsISupportsString).data;
    } catch {
      return "";
    }
  };
  const setClip = (s) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(s);
  const key = (k, mods = {}) => EU.synthesizeKey(k, mods, window);
  const routerTail = (n) => b.keys.log.slice(-n);
  const routerSince = (len) => b.keys.log.slice(len);
  const sel = (inp) => [inp.selectionStart, inp.selectionEnd];
  const summary = {};

  async function openVariant(v) {
    const attrs = v === "deer" ? {} : { ignorekeys: null };
    const p = await GB.anchored({ name: "S4-" + v, anchor: aEl, position: "overlap", w: 560, h: 340, scheme: "dark", cls: "settings", html: fieldHtml(`variant ${v}: ${v === "deer" ? "ignorekeys, noautohide" : v === "plain" ? "noautohide" : "auto-hide"} · type here`), autohide: v === "autohide", ignorekeys: v === "deer", attrs });
    await sleep(300);
    return p;
  }
  const inputOf = (p) => p.querySelector("#gb-in");

  async function runVariant(v) {
    const res = {};
    const before = document.activeElement?.localName + (document.activeElement?.id ? "#" + document.activeElement.id : "");
    panel = await openVariant(v);
    const inp = inputOf(panel);
    res.openState = panel.state;
    res.focusBefore = before;
    res.focusAfterOpen = document.activeElement?.localName;
    inp.focus();
    await sleep(150);
    res.focused = document.activeElement === inp && Services.focus.focusedElement === inp;
    res.focusVisible = inp.matches(":focus-visible");
    check(`S4 ${v}: the panel's field takes focus`, res.focused, { active: document.activeElement?.localName, fm: Services.focus.focusedElement?.localName });
    const events = [];
    const onKey = (e) => events.push(e.type + ":" + e.key);
    inp.addEventListener("keydown", onKey);
    inp.addEventListener("compositionstart", (e) => events.push("compositionstart"));
    inp.addEventListener("compositionend", (e) => events.push("compositionend:" + e.data));
    await pageKeys(true);

    // Typing
    spike.type("Glass panels");
    await sleep(150);
    res.typed = inp.value;
    check(`S4 ${v}: synthesized typing lands in the field`, inp.value === "Glass panels", inp.value);
    const pk = await pageKeys(true);
    res.pageKeysWhileTyping = pk.length;
    check(`S4 ${v}: the page gets none of those keys`, pk.length === 0, pk);
    if (v === "deer") await spike.captureScreen("glass-behave-s4-typed");

    // ⌘A ⌘C ⌘X ⌘Z ⌘⇧Z ⌘V
    key("a", { accelKey: true });
    await sleep(80);
    res.cmdA = sel(inp);
    check(`S4 ${v}: ⌘A selects the field's text`, inp.selectionStart === 0 && inp.selectionEnd === inp.value.length, sel(inp));
    setClip("before");
    key("c", { accelKey: true });
    await sleep(200);
    res.cmdC = readClip();
    check(`S4 ${v}: ⌘C copies it`, res.cmdC === "Glass panels", res.cmdC);
    key("x", { accelKey: true });
    await sleep(150);
    res.cmdX = { value: inp.value, clip: readClip() };
    check(`S4 ${v}: ⌘X cuts it`, inp.value === "" && readClip() === "Glass panels", res.cmdX);
    key("z", { accelKey: true });
    await sleep(150);
    res.cmdZ = inp.value;
    check(`S4 ${v}: ⌘Z undoes the cut`, inp.value === "Glass panels", inp.value);
    key("z", { accelKey: true, shiftKey: true });
    await sleep(150);
    res.cmdShiftZ = inp.value;
    check(`S4 ${v}: ⇧⌘Z redoes it`, inp.value === "", inp.value);
    setClip("pasted text");
    key("v", { accelKey: true });
    await sleep(150);
    res.cmdV = inp.value;
    check(`S4 ${v}: ⌘V pastes`, inp.value === "pasted text", inp.value);

    // Native editing keys (macOS key bindings): ⌘← ⌥← ⌘⌫
    key("KEY_ArrowLeft", { accelKey: true });
    await sleep(60);
    res.cmdLeft = sel(inp);
    key("KEY_ArrowRight", { accelKey: true });
    key("KEY_ArrowLeft", { altKey: true });
    await sleep(60);
    res.altLeft = sel(inp);
    key("KEY_ArrowRight", { accelKey: true });
    key("KEY_Backspace", { accelKey: true });
    await sleep(80);
    res.cmdBackspace = inp.value;
    log(`S4 ${v} native editing keys ` + JSON.stringify({ cmdLeft: res.cmdLeft, altLeft: res.altLeft, cmdBackspace: res.cmdBackspace }));
    check(`S4 ${v}: ⌘← goes to the start, ⌥← one word back, ⌘⌫ deletes to the start`, res.cmdLeft[0] === 0 && res.altLeft[0] === 7 && res.cmdBackspace === "", { cmdLeft: res.cmdLeft, altLeft: res.altLeft, cmdBackspace: res.cmdBackspace });

    // A synthesized IME composition (what an input method sends), committed
    inp.value = "";
    EU.synthesizeCompositionChange({ composition: { string: "にほん", clauses: [{ length: 3, attr: EU.COMPOSITION_ATTR_RAW_CLAUSE }] }, caret: { start: 3, length: 0 } }, window);
    await sleep(100);
    const during = inp.value;
    // Where Gecko tells the IME the text is (the candidate window is placed from this):
    // queried through the MAIN window's widget, as the main window's TextInputHandler does.
    const wu = window.windowUtils;
    const q = wu.sendQueryContentEvent(wu.QUERY_TEXT_RECT, 0, 1, 0, 0, wu.QUERY_CONTENT_FLAG_USE_NATIVE_LINE_BREAK);
    const qc = wu.sendQueryContentEvent(wu.QUERY_CARET_RECT, 3, 0, 0, 0, wu.QUERY_CONTENT_FLAG_USE_NATIVE_LINE_BREAK);
    EU.synthesizeComposition({ type: "compositioncommit", data: "日本" }, window);
    await sleep(120);
    res.ime = { during, committed: inp.value };
    check(`S4 ${v}: a synthesized IME composition commits in the field`, inp.value === "日本" && events.includes("compositionstart"), { during, value: inp.value, events: events.filter((e) => e.startsWith("comp")) });
    // Compare with the input's real place on screen (panel window + input box), in screen CSS px.
    const pr = panel.getOuterScreenRect();
    const ir = inp.getBoundingClientRect();
    const pBox = panel.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const real = { x: Math.round(pr.x + (ir.left - pBox.left)), y: Math.round(pr.y + (ir.top - pBox.top)), w: Math.round(ir.width), h: Math.round(ir.height) };
    const asMain = q.succeeded ? { x: Math.round(window.mozInnerScreenX + q.left / dpr), y: Math.round(window.mozInnerScreenY + q.top / dpr), w: Math.round(q.width / dpr), h: Math.round(q.height / dpr) } : null;
    const asPanel = q.succeeded ? { x: Math.round(pr.x + q.left / dpr), y: Math.round(pr.y + q.top / dpr) } : null;
    res.imeRect = { query: q.succeeded ? [q.left, q.top, q.width, q.height] : "failed", caret: qc.succeeded ? [qc.left, qc.top, qc.width, qc.height] : "failed", inputOnScreen: real, ifRelativeToMainWindow: asMain, ifRelativeToPanelWindow: asPanel };
    const inside = asMain && asMain.x >= real.x - 4 && asMain.x <= real.x + real.w && asMain.y >= real.y - 4 && asMain.y <= real.y + real.h;
    log(`S4 ${v} IME rect ` + JSON.stringify(res.imeRect));
    check(`S4 ${v}: the text rect Gecko gives the IME (main window's widget) lies on the field`, !!inside, res.imeRect);

    // Esc: Deer's router, the Esc ladder layer, the popup manager
    inp.value = "esc test";
    let n = b.keys.log.length;
    calls.esc = 0;
    events.length = 0;
    key("KEY_Escape");
    await sleep(400);
    res.esc = { panel: panel.state, escLayerRan: calls.esc, router: routerSince(n), fieldGotKeydown: events.includes("keydown:Escape"), pageKeys: await pageKeys(true) };
    log(`S4 ${v} Esc ` + JSON.stringify(res.esc));
    check(`S4 ${v}: Esc closes the panel (by any route)`, panel.state !== "open", res.esc);

    // ⌘W: Deer's ⌘W ladder (a panel's close layer first, never the tab). Twice: the layer asks the
    // panel's state ("state"), or a flag of its own as a Settings module would keep ("flag").
    for (const how of ["state", "flag"]) {
      while (tabsAt() < 2) {
        b.newTab(G.page("Spare", "#ffffff", "#000", "<p>spare tab</p>"), { background: true });
        await sleep(700);
      }
      if (panel.state !== "open") {
        G.close(panel);
        panel = await openVariant(v);
      }
      inputOf(panel).focus();
      await sleep(150);
      closeHow = how;
      panelFlag = true;
      n = b.keys.log.length;
      calls.close = 0;
      const tabs0 = tabsAt();
      let hiddenBy = null;
      panel.addEventListener("popuphidden", () => (hiddenBy = calls.close ? "close layer" : "something else first"), { once: true });
      key("w", { accelKey: true });
      await sleep(700);
      res["cmdW-" + how] = { panel: panel.state, hiddenBy, closeLayerRan: calls.close, tabsBefore: tabs0, tabsAfter: tabsAt(), router: routerSince(n) };
      log(`S4 ${v} ⌘W (${how}) ` + JSON.stringify(res["cmdW-" + how]));
      check(`S4 ${v}: ⌘W in the panel's field closes the panel, not the tab (layer by ${how})`, panel.state !== "open" && tabsAt() === tabs0, res["cmdW-" + how]);
    }
    while (tabsAt() < 2) {
      b.newTab(G.page("Spare", "#ffffff", "#000", "<p>spare tab</p>"), { background: true });
      await sleep(700);
    }

    // ⌘L (another browser-first key): what happens to the open panel?
    if (panel.state !== "open") {
      G.close(panel);
      panel = await openVariant(v);
      inputOf(panel).focus();
      await sleep(150);
    }
    n = b.keys.log.length;
    key("l", { accelKey: true });
    await sleep(600);
    res.cmdL = { panel: panel.state, router: routerSince(n), focus: document.activeElement?.localName + "." + (document.activeElement?.className || "") };
    log(`S4 ${v} ⌘L ` + JSON.stringify(res.cmdL));
    // leave the address field
    key("KEY_Escape");
    await sleep(300);
    b.focusPage();
    await sleep(200);
    G.close(panel);
    panel = null;
    await sleep(300);
    res.focusAfterClose = document.activeElement?.localName;
    summary[v] = res;
    log(`S4 ${v} RESULT ` + JSON.stringify(res));
  }

  for (const v of ["deer", "plain", "autohide"]) if (want(v)) await runVariant(v);

  // ---- real keys: CGEvent posted to the engine process (Deer is the active app after a capture) ----
  if (want("real")) {
    panel = await openVariant("deer");
    const inp = inputOf(panel);
    inp.focus();
    inp.value = "";
    await sleep(200);
    await spike.captureScreen("glass-behave-s4-real-before"); // brings Deer to the front
    inp.focus();
    await sleep(200);
    const ax0 = await GB.ask("AXINFO", GB.tag("s4-ax"));
    const pk0 = await pageKeys(true);
    let n = b.keys.log.length;
    const k1 = await GB.ask("KEYS", GB.tag("s4-keys"), ["g", "l", "a", "s", "s"]);
    await sleep(500);
    const typed = inp.value;
    const k2 = await GB.ask("KEYS", GB.tag("s4-keys"), ["cmd+a"]);
    await sleep(300);
    const selAll = sel(inp);
    const pk = await pageKeys(true);
    const axf = await GB.ask("AXFOCUS", GB.tag("s4-axfocus"), [], 20000);
    calls.esc = 0;
    n = b.keys.log.length;
    const k3 = await GB.ask("KEYS", GB.tag("s4-keys"), ["esc"]);
    await sleep(500);
    const afterEsc = { panel: panel.state, escLayerRan: calls.esc, router: routerSince(n) };
    const real = { ax: { active: ax0.active, focusedWindow: ax0.focusedWindow, mainWindow: ax0.mainWindow, windows: (ax0.windows || []).length }, sent: [k1, k2, k3].map((k) => k.sent || k.error), typed, selAll, pageKeys: pk, pageKeysBefore: pk0, axFocused: axf.focused, afterEsc };
    log("S4 real keys " + JSON.stringify(real));
    check("S4 real keys: typed into the panel's field", typed === "glass", real);
    check("S4 real keys: ⌘A selects in the field", selAll[0] === 0 && selAll[1] === typed.length, selAll);
    check("S4 real keys: Deer's main window stays the key (focused) window", ax0.focusedWindow && ax0.focusedWindow.w >= 1000, ax0.focusedWindow);
    summary.real = real;
    if (panel.state === "open") G.close(panel);
  }

  offEsc();
  offClose();
  log("S4 SUMMARY " + JSON.stringify(summary));
});
