// Spike S5 (ordering): with a real glass panel open, what ends on top when the page shows alert(),
// a beforeunload prompt, a window-modal dialog (what ⌘Q's quit prompt is), DOM full screen, a Deer
// tooltip, and a Deer menu opened after it. Test-only (glasslib.js + behavelib.js).
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s5-order.js --name mac-glass-s5 --url about:blank \
//       --timeout 500 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Panels: A, the Settings stand-in (anchored with followanchor to a placeholder in #vitre-root,
// noautohide, holds a focused <input>), placed at the top-centre where Firefox's prompts appear;
// C, pinned at a screen point (openPopupAtScreen, noautohide). Captures: glass-behave-s5-*.png.
/* global spike, G, GB, Services, Cc, Ci, ChromeUtils, gBrowser */
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
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  Services.prefs.setBoolPref("dom.require_user_interaction_for_beforeunload", false);

  const body =
    `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#ffd29a,#ff8a65 40%,#6a5acd)"></div>` +
    `<div id=v style="position:absolute;left:80px;top:430px;width:420px;height:220px;background:#2f5d73;color:#fff;font:600 22px/220px system-ui;text-align:center">element for full screen</div>` +
    `<h1 style="position:relative;margin:90px 40px;font:700 44px system-ui;color:#fff">The page under the glass</h1>`;
  const url = G.page("Ordering", "#ffd29a", "#1d1d1f", body);
  await G.load(url);
  await G.caption("");
  b.newTab(G.page("Spare", "#ffffff", "#000", "<p>spare tab</p>"), { background: true });
  await sleep(500);
  b.focusPage();

  const aEl = GB.placeholder("gb-a", "left:calc(50% - 300px);top:56px;width:600px;height:300px;");
  const html = `<h2>Settings stand-in</h2><div class="sec top">anchored · noautohide · level parent · focused field below</div><input id="gb-in" type="text" placeholder="Find a setting" style="font:15px system-ui;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.25);color:inherit;width:360px" /><div class="opt"><div class="t"><span>Block trackers</span><span class="sec">Strict protection on every site</span></div><span class="sw"></span></div>`;
  let A = null;
  let C = null;
  const openA = async () => {
    if (A) G.close(A);
    A = await GB.anchored({ name: "A-settings", anchor: aEl, position: "overlap", w: 600, h: 300, scheme: "dark", cls: "settings", html });
    A.querySelector("#gb-in").focus();
    await sleep(250);
    return A;
  };
  const openC = async () => {
    if (C) G.close(C);
    C = await GB.anchored({ name: "C-pinned", atScreen: { x: 840, y: 470 }, follow: false, w: 300, h: 140, scheme: "dark", html: `<div>Pinned glass</div><div class="sec">openPopupAtScreen · noautohide</div>` });
    return C;
  };
  const dialog = () => gBrowser.selectedBrowser.hasAttribute("tabDialogShowing");
  const abortDialogs = async () => {
    try {
      gBrowser.getTabDialogBox(gBrowser.selectedBrowser).abortAllDialogs();
    } catch (e) {
      log("abortAllDialogs: " + e);
    }
    await waitFor(() => !dialog(), { timeout: 4000, what: "dialogs gone" }).catch(() => null);
    await sleep(300);
  };
  const focusName = () => {
    const a = document.activeElement;
    return a ? a.localName + (a.id ? "#" + a.id : "") + (a.className && typeof a.className === "string" ? "." + a.className.split(" ")[0] : "") : null;
  };
  const results = {};
  async function order(label, extra = {}) {
    const wl = await GB.ask("WINLIST", GB.tag("s5-" + label));
    const ws = (wl.windows || []).filter((w) => w.who === "mine").map((w) => ({ order: w.order, layer: w.layer, size: [w.w, w.h], pos: [w.x, w.y], title: w.title || "" }));
    const rec = { A: A?.state, C: C?.state, focus: focusName(), windowsFrontToBack: ws, ...extra };
    log("ORDER " + label + " " + JSON.stringify(rec));
    results[label] = rec;
    return rec;
  }

  // ---- 1. alert() from the page ----
  if (want("alert")) {
    await openA();
    await openC();
    void G.inContent(b.active().browser, (content) => {
      content.setTimeout(() => content.alert("A page's alert(), opened while the glass panel is open"), 50);
      return 1;
    });
    const shown = await waitFor(dialog, { timeout: 6000, what: "alert" }).then(() => true, () => false);
    await sleep(800);
    const box = gBrowser.selectedBrowser.closest(".browserStack")?.querySelector(".dialogBox, dialog") || document.querySelector(".content-prompt-dialog .dialogBox, .dialogOverlay .dialogBox");
    const r = await order("alert", { dialog: shown, dialogBox: box ? GB.erect(box) : null, panelA: A.state === "open" ? GB.rect(A) : null });
    await spike.captureScreen("glass-behave-s5-alert");
    // Esc: the alert, the panel, or nothing?
    const n = b.keys.log.length;
    EU.synthesizeKey("KEY_Escape", {}, window);
    await sleep(600);
    results.alertEsc = { dialogAfterEsc: dialog(), A: A.state, router: b.keys.log.slice(n), focus: focusName() };
    log("ORDER alert-esc " + JSON.stringify(results.alertEsc));
    if (dialog()) await abortDialogs();
    check("S5 alert: the prompt opened with the panel open", shown, r);
  }

  // ---- 2. a beforeunload prompt (closing the tab of a page that asks) ----
  if (want("beforeunload")) {
    await openA();
    await G.inContent(b.active().browser, (content) => {
      content.onbeforeunload = (e) => {
        e.preventDefault();
        e.returnValue = "stay";
      };
      return 1;
    });
    const tabs0 = b.tabs.length;
    const t = b.active();
    // closeTab spins a nested event loop until the prompt is answered: call it from a timer, so this
    // test goes on (inside that loop) and answers it.
    let closeReturned = false;
    setTimeout(() => {
      b.closeTab(t);
      closeReturned = true;
    }, 0);
    const shown = await waitFor(dialog, { timeout: 6000, what: "beforeunload prompt" }).then(() => true, () => false);
    log("beforeunload: closeTab returned before the prompt was answered: " + closeReturned);
    await sleep(800);
    await order("beforeunload", { dialog: shown, tabs: [tabs0, b.tabs.length] });
    await spike.captureScreen("glass-behave-s5-beforeunload");
    await abortDialogs();
    await sleep(500);
    results.beforeunloadAfter = { tabs: b.tabs.length, A: A.state };
    log("ORDER beforeunload-after " + JSON.stringify(results.beforeunloadAfter));
    await G.inContent(b.active().browser, (content) => {
      content.onbeforeunload = null;
      return 1;
    });
  }

  // ---- 3. a window-modal dialog (Firefox's quit prompt is one) ----
  if (want("windowmodal")) {
    await openA();
    const { PromptUtils } = ChromeUtils.importESModule("resource://gre/modules/PromptUtils.sys.mjs");
    const bag = PromptUtils.objectToPropBag({ promptType: "confirm", title: "Quit Deer?", text: "A window-modal dialog (as ⌘Q's prompt), opened while the glass panel is open.", checkLabel: null, checked: false, ok: false, modalType: Ci.nsIPromptService.MODAL_TYPE_WINDOW });
    bag.setProperty("async", true);
    const asked = window.gDialogBox.open("chrome://global/content/commonDialog.xhtml", bag);
    await waitFor(() => window.gDialogBox?.isOpen, { timeout: 5000, what: "window-modal dialog" }).catch(() => {});
    await sleep(800);
    const dbox = document.querySelector("#window-modal-dialog .dialogBox, #window-modal-dialog");
    await order("windowmodal", { open: !!window.gDialogBox?.isOpen, box: dbox ? GB.erect(dbox) : null });
    await spike.captureScreen("glass-behave-s5-windowmodal");
    try {
      window.gDialogBox._dialog?.close();
    } catch (e) {
      log("close dialog: " + e);
    }
    await Promise.race([asked, sleep(2000)]);
    await sleep(400);
  }

  // ---- 4. DOM (element) full screen ----
  if (want("domfs")) {
    await openA();
    await openC();
    b.focusPage();
    await sleep(150);
    await G.inContent(b.active().browser, (content) => {
      content.document.getElementById("v").requestFullscreen().catch(() => {});
      return 1;
    });
    const fs = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 8000, what: "DOM full screen" }).then(() => true, () => false);
    await sleep(2200);
    const r = await order("domfullscreen", { fullscreen: fs, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], anchorBox: aEl.getClientRects().length });
    await spike.captureScreen("glass-behave-s5-domfullscreen");
    await G.inContent(b.active().browser, (content) => {
      content.document.exitFullscreen().catch(() => {});
      return 1;
    });
    await waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 8000, what: "DOM full screen left" }).catch(() => {});
    await sleep(1800);
    await order("domfullscreen-left");
    await spike.captureScreen("glass-behave-s5-domfullscreen-left");
    check("S5 DOM full screen entered", fs, r);
  }

  // ---- 5. a Deer tooltip under a glass panel opened before it ----
  if (want("tooltip")) {
    if (A) G.close(A);
    if (C) G.close(C);
    A = null;
    C = null;
    const plus = document.querySelector("#vitre-bar .item.plus");
    const face = plus?.querySelector("[data-tip]") || plus;
    const pr = face ? GB.erect(face) : null;
    log("plus capsule " + JSON.stringify(pr));
    if (pr) {
      // A small glass panel exactly where the tip will appear (8 px under the capsule, centred).
      const tEl = GB.placeholder("gb-t", `left:${pr.x + pr.w / 2 - 110}px;top:${pr.y + pr.h + 2}px;width:220px;height:70px;`);
      const T = await GB.anchored({ name: "T-over-tip", anchor: tEl, position: "overlap", w: 220, h: 70, scheme: "dark", html: `<div>Glass panel</div><div class="sec">opened before the tooltip</div>` });
      await sleep(300);
      EU.synthesizeMouseAtPoint(pr.x + pr.w / 2, pr.y + pr.h / 2, { type: "mousemove" }, window);
      const tip = await waitFor(() => {
        const t = document.querySelector(".vitre-tip");
        return t && !t.hidden ? t : null;
      }, { timeout: 4000, what: "Deer tooltip" }).catch(() => null);
      await sleep(400);
      const tr = tip ? GB.erect(tip) : null;
      await order("tooltip", { tip: tr, tipText: tip?.textContent, panel: GB.rect(T) });
      await spike.captureScreen("glass-behave-s5-tooltip");
      EU.synthesizeMouseAtPoint(600, 500, { type: "mousemove" }, window);
      G.close(T);
      check("S5 tooltip shown while the glass panel covers its place", !!tip, tr);
    }
  }

  // ---- 6. a Deer menu (also a glass child window) opened after the panel ----
  if (want("menu")) {
    await openA();
    b.focusPage();
    await sleep(200);
    const x = 600;
    const y = 250;
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
    const open = await waitFor(() => window.vitreMenus?.state().open, { timeout: 4000, what: "Deer menu" }).then(() => true, () => false);
    await sleep(500);
    await order("menu-over-panel", { menuOpen: open });
    await spike.captureScreen("glass-behave-s5-menu-over-panel");
    EU.synthesizeKey("KEY_Escape", {}, window);
    await sleep(500);
    results.menuEsc = { menuOpen: window.vitreMenus?.state().open, A: A.state };
    log("ORDER menu-esc " + JSON.stringify(results.menuEsc));
    // The other way round: a menu open first, then a glass panel shown: which is on top?
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
    await waitFor(() => window.vitreMenus?.state().open, { timeout: 4000, what: "Deer menu" }).catch(() => {});
    await sleep(400);
    const P2 = await GB.anchored({ name: "P2-after-menu", anchor: aEl, position: "overlap", x: 260, y: 120, w: 300, h: 160, scheme: "light", html: `<div>Panel shown after the menu</div>` });
    await sleep(500);
    await order("panel-after-menu", { menuOpen: window.vitreMenus?.state().open, P2: P2.state });
    await spike.captureScreen("glass-behave-s5-panel-after-menu");
    EU.synthesizeKey("KEY_Escape", {}, window);
    await sleep(300);
    G.close(P2);
  }

  log("S5 RESULTS " + JSON.stringify(results));
  Services.prefs.clearUserPref("full-screen-api.allow-trusted-requests-only");
  Services.prefs.clearUserPref("dom.require_user_interaction_for_beforeunload");
  G.closeAll();
});
