// Verify / improve claim 25: menus opened from the keyboard (Menu key / Shift+F10).
// On Windows both arrive as WM_CONTEXTMENU with lParam = -1 (nsWindow -> eContextMenu with
// mContextMenuTrigger = eContextMenuKey). That message can be posted to our own HWND in-process, so
// the REAL widget path is exercised without OS input or OS focus.
//   A. synthesized contextmenu (button 0) at a point far from the focus  -> where does Gecko anchor?
//   B. PostMessage(WM_CONTEXTMENU, hwnd, -1) with focus on a link / caret in a textarea / nothing
//   C. PostMessage WM_KEYDOWN+WM_KEYUP VK_APPS and WM_SYSKEYDOWN VK_F10 with Shift down
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreMenu, MouseEvent */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const popup = document.getElementById("contentAreaContextMenu");
    let nativeShown = 0;
    popup.addEventListener("popupshown", () => nativeShown++);
    VitreMenu.install();
    VitreMenu.closeOnBlur = false;
    const w32 = v.win32();
    const WM_CONTEXTMENU = 0x007b, WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    const VK_APPS = 0x5d, VK_F10 = 0x79, VK_SHIFT = 0x10;
    spike.log("hwnd", w32.handle, "testmode", Services.prefs.getBoolPref("focusmanager.testmode", false));

    const ctx = () => {
      const d = VitreMenu.lastContext;
      return d && { x: Math.round(d.x), y: Math.round(d.y), inputSource: d.inputSource, linkURL: d.linkURL.replace(pf.base, ""), isEditable: d.isEditable, selectionText: d.selectionText };
    };
    const result = async (label) => {
      const ok = await pf.until(() => VitreMenu.isOpen, 3000);
      spike.log(label, "opened", !!ok, ok ? { ctx: ctx(), rows: VitreMenu.current.rowItems.length, firstRowFocused: VitreMenu.current.index, firstLabel: VitreMenu.current.rowItems[0].label, placed: [VitreMenu.current.placed.left, VitreMenu.current.placed.top] } : "", "active", Services.focus.activeWindow === window, "OS fg", w32.isForeground());
      return !!ok;
    };
    const closeMenu = async () => {
      if (VitreMenu.isOpen) VitreMenu.close("test");
      await spike.sleep(250);
    };
    const focusLink = async () => {
      await v.activate();
      await pf.inContent(b, (w) => { w.scrollTo(0, 0); w.document.getElementById("link1").focus(); });
      b.focus();
      await spike.sleep(200);
      const r = await pf.rectOf(b, "#link1");
      return r;
    };

    // ---- A. synthesized, far from the focused link ------------------------------------------------
    let lr = await focusLink();
    spike.log("link1 rect (chrome px)", { x: Math.round(lr.x), y: Math.round(lr.y), w: Math.round(lr.w), h: Math.round(lr.h) }, "browser top", Math.round(b.getBoundingClientRect().top));
    pf.EU.synthesizeMouseAtPoint(900, 700, { type: "contextmenu", button: 0 }, window);
    await result("A1 synthesized button:0 at (900,700), focus on link");
    await spike.capture("kbd-a1-synth");
    await closeMenu();

    // ---- B. the real message ------------------------------------------------------------------------
    lr = await focusLink();
    w32.post(WM_CONTEXTMENU, w32.wparamSelf, -1);
    const b1 = await result("B1 WM_CONTEXTMENU lParam=-1, focus on link");
    await spike.capture("kbd-b1-wm-link");
    if (b1) {
      // Keyboard use: arrow down + Enter activates "Peek link" (row 2) without the mouse.
      pf.key("KEY_ArrowDown");
      pf.key("KEY_Enter");
      const pk = await pf.until(() => window.VitrePeek && VitrePeek.current, 100);
      spike.log("B1 arrow+enter ran row", VitreMenu.isOpen ? "(menu still open)" : "closed", "native popup shown", nativeShown);
    }
    await closeMenu();

    // caret in the textarea (after "The ")
    await v.activate();
    let r = await pf.rectOf(b, "#ta");
    pf.mouse(r.x + 60, r.y + 22, {});
    await spike.sleep(300);
    w32.post(WM_CONTEXTMENU, w32.wparamSelf, -1);
    await result("B2 WM_CONTEXTMENU, caret in textarea at chrome (" + Math.round(r.x + 60) + "," + Math.round(r.y + 22) + ")");
    await spike.capture("kbd-b2-wm-textarea");
    await closeMenu();

    // selection in a paragraph
    await v.activate();
    await pf.inContent(b, (w) => {
      w.scrollTo(0, 0);
      const t = w.document.getElementById("p1").firstChild;
      const i = t.data.indexOf("surface tension");
      const range = w.document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + 15);
      const s = w.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      w.document.activeElement.blur();
    });
    await spike.sleep(200);
    w32.post(WM_CONTEXTMENU, w32.wparamSelf, -1);
    await result("B3 WM_CONTEXTMENU, text selected in a paragraph");
    await spike.capture("kbd-b3-wm-selection");
    await closeMenu();

    // nothing focused, nothing selected
    await pf.inContent(b, (w) => { w.getSelection().removeAllRanges(); w.document.activeElement.blur(); });
    await spike.sleep(200);
    w32.post(WM_CONTEXTMENU, w32.wparamSelf, -1);
    await result("B4 WM_CONTEXTMENU, nothing focused");
    await closeMenu();

    // focus in Vitre's own chrome (a tab-circle-like button): the same message must reach chrome's contextmenu listener
    const H = "http://www.w3.org/1999/xhtml";
    const btn = document.createElementNS(H, "button");
    btn.textContent = "chrome button";
    btn.setAttribute("style", "position:fixed;left:560px;top:40px;z-index:2147482000");
    let chromeEvt = null;
    btn.addEventListener("contextmenu", (e) => {
      chromeEvt = { button: e.button, buttons: e.buttons, inputSource: e.inputSource, clientX: e.clientX, clientY: e.clientY };
      VitreMenu.showForChrome(e, [{ label: "Chrome item one", run() {} }, { label: "Chrome item two", run() {} }]);
    });
    document.body.appendChild(btn);
    btn.focus();
    await spike.sleep(200);
    w32.post(WM_CONTEXTMENU, w32.wparamSelf, -1);
    await pf.until(() => chromeEvt, 3000);
    const br = btn.getBoundingClientRect();
    spike.log("B5 WM_CONTEXTMENU with focus on a chrome <button>", chromeEvt, "button rect", [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)], "menu open", VitreMenu.isOpen, "first row focused", VitreMenu.current && VitreMenu.current.index, "native toolbar menu state", document.getElementById("toolbar-context-menu")?.state);
    await spike.capture("kbd-b5-wm-chrome");
    await closeMenu();
    btn.remove();

    // ---- C. the keys themselves, as window messages ------------------------------------------------
    lr = await focusLink();
    const kd = (vk, sys) => w32.post(sys ? WM_SYSKEYDOWN : WM_KEYDOWN, vk, 1);
    const ku = (vk, sys) => w32.post(sys ? WM_SYSKEYUP : WM_KEYUP, vk, 0xc0000001 | 0);
    kd(VK_APPS);
    ku(VK_APPS);
    await result("C1 WM_KEYDOWN/WM_KEYUP VK_APPS (Menu key), focus on link");
    await closeMenu();

    lr = await focusLink();
    spike.log("C2 set Shift down in the thread key state", w32.setKey(VK_SHIFT, true));
    w32.post(WM_KEYDOWN, VK_SHIFT, 1);
    kd(VK_F10, true);
    await spike.sleep(150);
    ku(VK_F10, true);
    w32.setKey(VK_SHIFT, false);
    w32.post(WM_KEYUP, VK_SHIFT, 0xc0000001 | 0);
    await result("C2 Shift+F10 as WM_SYSKEYDOWN VK_F10 with Shift down, focus on link");
    await spike.capture("kbd-c2-shift-f10");
    await closeMenu();
    spike.log("page saw keys", await pf.inContent(b, (w) => w.document.documentElement.dataset.lastKey || ""), "native popup ever shown", nativeShown);
  });
