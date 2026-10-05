// Verify menus, part 2:
//  1. right-click INSIDE an out-of-process (cross-site) frame: link, coordinates, frame info, actions.
//     Plain synthesized events from the parent stop at the top document, so these are sent with
//     asyncEnabled (through the widget / APZ like real input, which hit-tests the right process).
//  2. how to tell a keyboard-opened page menu from a mouse-opened one (the context's inputSource is
//     MOUSE for the real WM_CONTEXTMENU path, see boot-vkbd.js)
//  3. a password field, and a menu opened while a peek is NOT involved but find is open
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu, MouseEvent */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    VitreMenu.install();
    VitreMenu.closeOnBlur = false;
    VitreFind.install();
    const w32 = v.win32();
    const section = async (name, fn) => {
      try {
        await v.activate();
        await fn();
      } catch (e) {
        spike.log("SECTION " + name + " FAILED", String(e), (e.stack || "").split("\n").slice(0, 3).join(" | "));
      }
    };
    const amouse = (x, y, o = {}) => pf.EU.synthesizeMouseAtPoint(x, y, { asyncEnabled: true, ...o }, window);
    const aRightClick = async (x, y) => {
      amouse(x, y, { type: "mousedown", button: 2 });
      await spike.sleep(40);
      amouse(x, y, { type: "mouseup", button: 2 });
      await spike.sleep(40);
      amouse(x, y, { type: "contextmenu", button: 2 });
    };
    const pick = async (label) => {
      const i = VitreMenu.current.rowItems.findIndex((it) => it.label === label);
      if (i < 0) throw new Error("no item " + label);
      const rr = VitreMenu.current.rows[i].getBoundingClientRect();
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
      await pf.until(() => !VitreMenu.isOpen, 3000);
    };

    // keyboard / mouse trigger as seen by a capture listener in chrome, BEFORE the event goes to content
    const triggers = [];
    window.addEventListener("contextmenu", (e) => triggers.push({ target: e.target.localName, button: e.button, buttons: e.buttons, inputSource: e.inputSource, x: e.clientX, y: e.clientY }), true);

    // ---- 1. out-of-process frame ----------------------------------------------------------------------
    await section("oop-menu", async () => {
      const er = await pf.rectOf(b, "#xframe");
      const frameBC = b.browsingContext.children[0];
      spike.log("1 frame", { url: frameBC.currentWindowGlobal.documentURI.spec, pid: frameBC.currentWindowGlobal.osPid, topPid: b.browsingContext.currentWindowGlobal.osPid, rect: [Math.round(er.x), Math.round(er.y), Math.round(er.w), Math.round(er.h)] });
      let hit = null;
      for (let dx = 110; dx <= 190 && !hit; dx += 10) {
        const x = er.x + dx, y = er.y + 24;
        amouse(x, y, { type: "mousemove" });
        await spike.sleep(300);
        if (window.XULBrowserWindow.overLink) hit = { x, y, overLink: window.XULBrowserWindow.overLink };
      }
      spike.log("1 hover in the frame (asyncEnabled): overLink", hit);
      if (!hit) return;
      triggers.length = 0;
      await aRightClick(hit.x, hit.y);
      await pf.until(() => VitreMenu.isOpen, 3000);
      const d = VitreMenu.lastContext;
      spike.log("1 MENU on the link inside the cross-site frame", VitreMenu.isOpen, d && { clickAt: [Math.round(hit.x), Math.round(hit.y)], menuAt: [Math.round(d.x), Math.round(d.y)], linkURL: d.linkURL, linkText: d.linkText, inFrame: d.inFrame, frameURL: d.frameURL, isFrameBC: d.frameBrowsingContextID === frameBC.id, pageURL: d.pageURL.replace(pf.base, "") }, VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label), "chrome saw", triggers.slice());
      await spike.capture("vmenu-oop-link");
      if (VitreMenu.isOpen && d.linkURL) {
        const n = gBrowser.tabs.length;
        await pick("Open link in new tab");
        await pf.until(() => gBrowser.tabs.length > n, 4000);
        const nt = gBrowser.tabs[gBrowser.tabs.length - 1];
        await pf.browserLoaded(nt.linkedBrowser, "counter");
        spike.log("1 open-in-new-tab from the frame ->", nt.linkedBrowser.currentURI.spec, "tabs", n, "->", gBrowser.tabs.length);
        gBrowser.removeTab(nt);
        await aRightClick(hit.x, hit.y);
        await pf.until(() => VitreMenu.isOpen, 3000);
        await pick("Copy link address");
        spike.log("1 copy link from the frame ->", await pf.clipboardIs(d.linkURL, 2500));
        await aRightClick(hit.x, hit.y);
        await pf.until(() => VitreMenu.isOpen, 3000);
        await pick("Inspect");
        const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
        const tb = await pf.until(() => DevToolsShim.isInitialized() && DevToolsShim.hasToolboxForTab(gBrowser.selectedTab), 20000, 300);
        await spike.sleep(3000);
        spike.log("1 Inspect on a node inside the cross-site frame: toolbox", !!tb);
        await spike.capture("vmenu-oop-inspect");
        document.getElementById("key_toggleToolbox").doCommand();
        await spike.sleep(1500);
      } else if (VitreMenu.isOpen) VitreMenu.close("test");
      // select a word inside the frame (double click) and copy it from the menu
      const wx = er.x + 30, wy = er.y + 24;
      amouse(wx, wy, { type: "mousedown", button: 0, clickCount: 1 });
      amouse(wx, wy, { type: "mouseup", button: 0, clickCount: 1 });
      await spike.sleep(60);
      amouse(wx, wy, { type: "mousedown", button: 0, clickCount: 2 });
      amouse(wx, wy, { type: "mouseup", button: 0, clickCount: 2 });
      await spike.sleep(400);
      await aRightClick(wx, wy);
      await pf.until(() => VitreMenu.isOpen, 3000);
      const d2 = VitreMenu.lastContext;
      spike.log("1 selection inside the frame", d2 && { selectionText: d2.selectionText, inFrame: d2.inFrame }, VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label));
      if (VitreMenu.isOpen && d2.selectionText) {
        await pick("Copy");
        spike.log("1 Copy from the frame -> clipboard", await pf.clipboardIs(d2.selectionText, 2500));
      } else if (VitreMenu.isOpen) VitreMenu.close("test");
    });

    // ---- 2. keyboard or mouse? --------------------------------------------------------------------------
    await section("trigger", async () => {
      await pf.inContent(b, (w) => { w.scrollTo(0, 0); w.getSelection().removeAllRanges(); w.document.getElementById("same").focus(); });
      b.focus();
      await spike.sleep(200);
      triggers.length = 0;
      w32.post(0x007b, w32.wparamSelf, -1); // WM_CONTEXTMENU from the keyboard
      await pf.until(() => VitreMenu.isOpen, 3000);
      spike.log("2 KEYBOARD (WM_CONTEXTMENU): chrome capture listener saw", triggers.slice(), "context inputSource", VitreMenu.lastContext && VitreMenu.lastContext.inputSource, "MOZ_SOURCE_KEYBOARD is", MouseEvent.MOZ_SOURCE_KEYBOARD);
      VitreMenu.close("test");
      await spike.sleep(200);
      const r = await pf.rectOf(b, "#same");
      triggers.length = 0;
      pf.rightClick(r.cx, r.cy);
      await pf.until(() => VitreMenu.isOpen, 3000);
      spike.log("2 MOUSE right-click: chrome capture listener saw", triggers.slice(), "context inputSource", VitreMenu.lastContext && VitreMenu.lastContext.inputSource);
      VitreMenu.close("test");
    });
    spike.log("END");
  });
