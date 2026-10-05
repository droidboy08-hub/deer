// Right-click menus: replace #contentAreaContextMenu with Vitre's HTML glass menu and exercise it.
/* global Services, Cc, Ci, gBrowser, spike, pf, VitreMenu, gContextMenu, internalSave, PathUtils, IOUtils, AddonManager, ChromeUtils */
for (const f of ["common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js"]) Services.scriptloader.loadSubScript("resource://vitre-boot/" + f, window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    const popup = document.getElementById("contentAreaContextMenu");
    let nativeShown = 0;
    popup.addEventListener("popupshown", () => nativeShown++);

    // Local test extension that adds menu items (never downloaded; it lives in this spike folder).
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const bootDir = PathUtils.parent(Services.env.get("VITRE_BOOT"));
    const extDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    extDir.initWithPath(PathUtils.join(bootDir, "ext-menu"));
    try {
      const addon = await AddonManager.installTemporaryAddon(extDir);
      spike.log("ext installed", addon.id);
      await spike.sleep(800);
    } catch (e) {
      spike.log("ext install failed", String(e));
    }

    // start clean so the "file exists" checks below mean this run wrote it
    for (const f of await IOUtils.getChildren(spike.outDir)) if (/photo.*\.svg$/.test(f)) await IOUtils.remove(f);
    VitreMenu.install();
    VitreMenu.closeOnBlur = false; // other spikes' windows take OS focus while this runs
    VitreFind.install();
    VitrePeek.install();
    // "Save image as..." without a native file dialog: the same internalSave() Firefox uses, with
    // aSkipPrompt and a fixed download folder (Vitre would hand this to its own downloader).
    Services.prefs.setIntPref("browser.download.folderList", 2);
    Services.prefs.setStringPref("browser.download.dir", spike.outDir);
    Services.prefs.setBoolPref("browser.download.useDownloadDir", true);
    VitreMenu.onSaveImage = (d, cm) =>
      internalSave(d.mediaURL, null, null, null, d.contentDisposition, d.contentType, false, "SaveImageTitle", null,
        cm.contentData.referrerInfo, cm.contentData.cookieJarSettings, null, true /* skip prompt */, null, false, cm.principal);

    const waitOpen = () => pf.until(() => VitreMenu.isOpen, 4000);
    const waitClosed = () => pf.until(() => !VitreMenu.isOpen, 4000);
    const labels = () => (VitreMenu.current ? VitreMenu.current.rowItems.map((i) => i.label) : null);
    const pick = async (label) => {
      const cur = VitreMenu.current;
      const i = cur.rowItems.findIndex((it) => it.label === label);
      if (i < 0) throw new Error("no item " + label + " in " + labels());
      const r = cur.rows[i].getBoundingClientRect();
      pf.mouse(r.left + 40, r.top + 17, { type: "mousemove" });
      pf.mouse(r.left + 40, r.top + 17, { type: "mousedown", button: 0 });
      pf.mouse(r.left + 40, r.top + 17, { type: "mouseup", button: 0 });
      await waitClosed();
    };
    const ctx = (keys) => {
      const d = VitreMenu.lastContext;
      const o = {};
      for (const k of keys) o[k] = d[k];
      return o;
    };
    const openOn = async (selector, opts = {}) => {
      const r = await pf.rectOf(b, selector, opts.frame);
      await spike.sleep(150);
      const x = opts.dx != null ? r.x + opts.dx : r.cx;
      const y = opts.dy != null ? r.y + opts.dy : r.cy;
      pf.rightClick(x, y, opts.mods || {});
      const ok = await waitOpen();
      return { ok: !!ok, x, y };
    };

    // ---- 1. link -------------------------------------------------------------------------------
    let at = await openOn("#link1");
    spike.log("LINK opened", at.ok, "at", Math.round(at.x), Math.round(at.y), "items", labels());
    spike.log("LINK ctx", ctx(["x", "y", "screenX", "screenY", "pageURL", "frameURL", "inFrame", "frameID", "linkURL", "linkText", "linkProtocol", "onSaveableLink", "selectionText", "isEditable"]));
    spike.log("native popup state", popup.state, "nativeShown", nativeShown, "gContextMenu alive", !!gContextMenu);
    await spike.capture("menu-link");

    // keys never reach the page while the menu is open, and focus stays where it was
    const before = await pf.inContent(b, (c) => c.document.documentElement.dataset.lastKey || "");
    pf.key("KEY_ArrowDown");
    pf.key("KEY_ArrowDown");
    await spike.sleep(100);
    const after = await pf.inContent(b, (c) => c.document.documentElement.dataset.lastKey || "");
    spike.log("KEYS swallowed: page lastKey before/after", JSON.stringify(before), JSON.stringify(after), "current row", VitreMenu.current.index, labels()[VitreMenu.current.index]);
    await spike.capture("menu-link-keyboard");
    // access key: E = Copy link address
    pf.key("e");
    await waitClosed();
    spike.log("COPY LINK clipboard", await pf.clipboardIs(pf.base + "counter.html"), "gContextMenu after close", String(gContextMenu));

    // "Peek link" hands the link to Peek with the click's principal and referrer
    at = await openOn("#link1");
    await pick("Peek link");
    const pk = await pf.until(() => VitrePeek.current, 4000);
    if (pk) await pf.browserLoaded(pk.browser, "counter");
    await spike.sleep(600);
    spike.log("PEEK LINK from the menu opened a peek", !!pk, pk && pk.browser.currentURI.spec);
    await spike.capture("menu-peek-link");
    VitrePeek.close("test", { discard: true });
    await spike.sleep(300);

    at = await openOn("#link1");
    const tabsBefore = gBrowser.tabs.length;
    await pick("Open link in new tab");
    await pf.until(() => gBrowser.tabs.length > tabsBefore, 4000);
    const nt = gBrowser.tabs[gBrowser.tabs.length - 1];
    await pf.browserLoaded(nt.linkedBrowser, "counter");
    spike.log("OPEN IN NEW TAB tabs", tabsBefore, "->", gBrowser.tabs.length, "url", nt.linkedBrowser.currentURI.spec, "selected stays", gBrowser.selectedTab === tab0);
    gBrowser.removeTab(nt);

    // extension item, listed and clicked
    at = await openOn("#link1");
    const extRow = VitreMenu.current.rowItems.find((i) => i.ext);
    spike.log("EXT item", extRow ? { label: extRow.label, id: extRow.ext, icon: extRow.icon } : null);
    if (extRow) {
      const n = gBrowser.tabs.length;
      await pick(extRow.label);
      await pf.until(() => gBrowser.tabs.length > n, 5000);
      const et = gBrowser.tabs[gBrowser.tabs.length - 1];
      await pf.until(() => et.linkedBrowser.currentURI.spec.includes("#ext-clicked"), 5000);
      spike.log("EXT click opened", gBrowser.tabs.length > n ? et.linkedBrowser.currentURI.spec : "nothing");
      if (gBrowser.tabs.length > n) gBrowser.removeTab(et);
      spike.log("EXT cleanup: leftover extension nodes in the XUL popup", popup.querySelectorAll('[id*="-menuitem-"]').length);
    } else {
      VitreMenu.close("test");
    }

    // right-click elsewhere while open: the menu moves, no replay needed
    at = await openOn("#link1");
    const r2 = await pf.rectOf(b, "#p3");
    pf.rightClick(r2.x + 40, r2.cy);
    await spike.sleep(500);
    spike.log("RIGHT-CLICK OUTSIDE reopened", VitreMenu.isOpen, "items", labels(), "at", ctx(["x", "y"]));
    // left click outside closes and does NOT reach the page (the link under it is not followed)
    const r1 = await pf.rectOf(b, "#link1");
    pf.mouse(r1.cx, r1.cy, {});
    await spike.sleep(400);
    spike.log("CLICK OUTSIDE closed", !VitreMenu.isOpen, "page still", b.currentURI.spec);

    // ---- 2. selected text ----------------------------------------------------------------------
    await pf.inContent(b, (c) => {
      const p = c.document.getElementById("p1");
      const t = p.firstChild;
      const i = t.data.indexOf("surface tension");
      const range = c.document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + "surface tension".length);
      const s = c.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      const rr = range.getBoundingClientRect();
      c.document.documentElement.dataset.selRect = JSON.stringify([rr.left, rr.top, rr.width, rr.height]);
    });
    const sel = JSON.parse(await pf.inContent(b, (c) => c.document.documentElement.dataset.selRect));
    const br = b.getBoundingClientRect();
    pf.rightClick(br.left + sel[0] + sel[2] / 2, br.top + sel[1] + sel[3] / 2);
    await waitOpen();
    spike.log("SELECTION items", labels(), "ctx", ctx(["selectionText", "linkURL", "isEditable"]));
    await spike.capture("menu-selection");
    await pick("Copy");
    spike.log("SELECTION copy -> clipboard", await pf.clipboardIs("surface tension"));
    pf.rightClick(br.left + sel[0] + sel[2] / 2, br.top + sel[1] + sel[3] / 2);
    await waitOpen();
    await pick("Find “surface tension” on page");
    await pf.until(() => VitreFind.active && VitreFind.active.total > 0, 4000);
    spike.log("FIND SELECTION from the menu", VitreFind.active && { query: VitreFind.active.query, counter: VitreFind.active.ui.count.textContent });
    await spike.capture("menu-find-selection");
    VitreFind.close(b);
    await pf.inContent(b, (c) => c.getSelection().removeAllRanges());

    // ---- 3. image ------------------------------------------------------------------------------
    at = await openOn("#img1");
    spike.log("IMAGE items", labels(), "ctx", ctx(["onImage", "mediaURL", "imageInfo", "contentType", "linkURL"]));
    await spike.capture("menu-image");
    await pick("Save image as…");
    const saved = PathUtils.join(spike.outDir, "photo.svg");
    const okSaved = await pf.until(() => IOUtils.exists(saved), 6000, 200);
    spike.log("SAVE IMAGE file", saved, "exists", !!okSaved, okSaved ? (await IOUtils.stat(saved)).size + " bytes" : "");
    at = await openOn("#img1");
    await pick("Copy image address");
    spike.log("COPY IMAGE ADDRESS clipboard", await pf.clipboardIs(pf.base + "photo.svg"));
    at = await openOn("#img1");
    await pick("Copy image");
    await spike.sleep(300);
    const flavors = ["image/png", "text/html", "text/plain"].filter((f) => Services.clipboard.hasDataMatchingFlavors([f], Ci.nsIClipboard.kGlobalClipboard));
    spike.log("COPY IMAGE clipboard flavors", flavors);

    at = await openOn("#img2");
    spike.log("IMAGE LINK items", labels(), "ctx", ctx(["onImage", "mediaURL", "linkURL"]));
    await spike.capture("menu-image-link");
    VitreMenu.close("test");

    // ---- 4. text field: copy from one field, paste into another --------------------------------
    let r = await pf.rectOf(b, "#inp");
    pf.mouse(r.cx, r.cy, {});
    await spike.sleep(150);
    pf.key("a", { accelKey: true });
    await spike.sleep(150);
    pf.rightClick(r.x + 60, r.cy);
    await waitOpen();
    spike.log("EDITABLE items", labels(), "ctx", ctx(["isEditable", "onPassword", "isDesignMode", "edit", "selectionText"]));
    await spike.capture("menu-editable");
    await pick("Copy");
    spike.log("EDITABLE copy -> clipboard", await pf.clipboardIs("editable field text"));
    const focusKept = await pf.inContent(b, (c) => c.document.activeElement && c.document.activeElement.id);
    spike.log("focus stayed in the page field", focusKept, "chrome activeElement", document.activeElement && document.activeElement.localName);

    r = await pf.rectOf(b, "#ta");
    pf.mouse(r.x + r.w - 12, r.y + r.h - 8, {});
    await spike.sleep(150);
    pf.key("KEY_End", { accelKey: true });
    pf.rightClick(r.x + r.w - 12, r.y + r.h - 8);
    await waitOpen();
    spike.log("TEXTAREA items", labels(), "edit", ctx(["edit"]));
    await pick("Paste");
    await spike.sleep(300);
    spike.log("PASTE result textarea value", await pf.inContent(b, (c) => c.document.getElementById("ta").value));
    at = await openOn("#ta", { dx: 12, dy: 12 });
    await pick("Undo");
    await spike.sleep(200);
    spike.log("UNDO result textarea value", await pf.inContent(b, (c) => c.document.getElementById("ta").value));

    // ---- 5. misspelled word --------------------------------------------------------------------
    r = await pf.rectOf(b, "#miss");
    pf.mouse(r.cx, r.cy, {}); // focus the editor so the inline spellchecker runs
    await spike.sleep(1200);
    pf.rightClick(r.cx, r.cy);
    await waitOpen();
    spike.log("SPELLING items", labels(), "ctx", ctx(["misspelling", "suggestions", "isEditable", "isDesignMode", "spellcheckable"]));
    await spike.capture("menu-spelling");
    const first = VitreMenu.current.rowItems[0];
    if (VitreMenu.lastContext.misspelling) {
      await pick(first.label);
      await spike.sleep(300);
      spike.log("SPELLING replaced with", first.label, "->", await pf.inContent(b, (c) => c.document.getElementById("ce").textContent));
    } else {
      VitreMenu.close("test");
    }

    // the same in a plain <textarea> (the common case)
    r = await pf.rectOf(b, "#ta");
    pf.mouse(r.x + 50, r.y + 22, {});
    await spike.sleep(1200);
    pf.rightClick(r.x + 50, r.y + 22);
    await waitOpen();
    spike.log("SPELLING (textarea) items", labels(), "ctx", ctx(["misspelling", "suggestions", "isDesignMode"]));
    if (VitreMenu.lastContext.misspelling) {
      await pick(VitreMenu.current.rowItems[0].label);
      await spike.sleep(300);
      spike.log("SPELLING (textarea) replaced ->", await pf.inContent(b, (c) => c.document.getElementById("ta").value));
    } else VitreMenu.close("test");

    // ---- 6. video ------------------------------------------------------------------------------
    at = await openOn("#vid");
    spike.log("VIDEO items", labels(), "ctx", ctx(["onVideo", "onAudio", "mediaURL", "media", "onDRMMedia"]));
    await spike.capture("menu-video");
    await pick("Pause");
    await spike.sleep(300);
    spike.log("VIDEO paused after menu Pause", await pf.inContent(b, (c) => c.document.getElementById("vid").paused));
    at = await openOn("#cv");
    spike.log("CANVAS items", labels(), "ctx", ctx(["onCanvas", "onImage"]));
    VitreMenu.close("test");

    // ---- 7. frame, page, and a page that replaces the menu -------------------------------------
    at = await openOn("#flink", { frame: "#frame1" });
    spike.log("FRAME LINK ctx", ctx(["inFrame", "frameURL", "pageURL", "frameID", "frameBrowsingContextID", "linkURL"]));
    VitreMenu.close("test");

    at = await openOn("#nomenu");
    spike.log("PAGE-OWNED MENU: Vitre menu opened", at.ok, "(expected false)", "page handler hits", await pf.inContent(b, (c) => c.document.getElementById("nomenu").dataset.hits));
    at = await openOn("#nomenu", { mods: { shiftKey: true } });
    spike.log("SHIFT+RIGHT-CLICK on it: Vitre menu opened", at.ok, "items", labels(), "page handler hits", await pf.inContent(b, (c) => c.document.getElementById("nomenu").dataset.hits));
    VitreMenu.close("test");

    // near the right/bottom edge: flips
    await pf.inContent(b, (c) => c.scrollTo(0, 0));
    const bb = b.getBoundingClientRect();
    pf.rightClick(bb.right - 30, bb.bottom - 20);
    await waitOpen();
    spike.log("PAGE items", labels(), "placed (flipped)", VitreMenu.current.placed, "ctx", ctx(["canGoBack", "canGoForward", "x", "y"]));
    await spike.capture("menu-page-flipped");
    VitreMenu.close("test");

    // ---- 8. keyboard open (Shift+F10) on a focused link ----------------------------------------
    // The keyboard path cannot be driven without OS input: on Windows Shift+F10 / the Menu key become
    // WM_CONTEXTMENU in the widget, not a key event. What can be checked in-process is that a
    // contextmenu event whose inputSource is KEYBOARD reaches the menu and focuses the first row.
    await pf.inContent(b, (c) => c.document.getElementById("link1").focus());
    const lr = await pf.rectOf(b, "#link1");
    await spike.sleep(150);
    pf.EU.synthesizeMouseAtPoint(lr.x, lr.y + lr.h, { type: "contextmenu", button: 0, inputSource: MouseEvent.MOZ_SOURCE_KEYBOARD }, window);
    const kb = await waitOpen();
    spike.log("KEYBOARD-SOURCE contextmenu opened", !!kb, "items", labels(), "ctx", ctx(["x", "y", "inputSource", "linkURL"]), "first row focused", VitreMenu.current && VitreMenu.current.index);
    await spike.capture("menu-keyboard-open");
    pf.key("KEY_Escape");
    await waitClosed();

    // ---- 9. Vitre's own chrome: a tab circle ---------------------------------------------------
    const H = "http://www.w3.org/1999/xhtml";
    const dock = document.createElementNS(H, "div");
    dock.setAttribute("style", "position:fixed;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:8px;z-index:2147482000;padding:4px;border-radius:26px;background:rgba(20,20,26,.55);backdrop-filter:blur(20px)");
    const circles = [];
    gBrowser.addTrustedTab(pf.base + "counter.html", { inBackground: true });
    for (const t of gBrowser.tabs) {
      const c = document.createElementNS(H, "div");
      c.setAttribute("style", "width:44px;height:44px;border-radius:22px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3);color:#fff;font:600 13px Segoe UI;display:flex;align-items:center;justify-content:center");
      c.textContent = String(gBrowser.tabs.indexOf(t) + 1);
      c.addEventListener("contextmenu", (e) => {
        const r = c.getBoundingClientRect();
        const ext = VitreMenu.extensionItemsFor({ tab: t, pageUrl: t.linkedBrowser.currentURI.spec, onTab: true });
        VitreMenu.showForChrome(e, [
          { caption: (t.label || "Tab") + " · " + (t.linkedBrowser.currentURI.host || "") },
          { label: "Reload tab", key: "r", run: () => gBrowser.reloadTab(t) },
          { label: "Duplicate tab", key: "d", run: () => gBrowser.duplicateTab(t) },
          { label: "Copy address", key: "a", run: () => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(t.linkedBrowser.currentURI.spec) },
          { label: t.muted ? "Unmute tab" : "Mute tab", key: "m", run: () => t.toggleMuteAudio() },
          { label: "Move tab to new window", key: "w", enabled: gBrowser.tabs.length > 1, run: () => gBrowser.replaceTabWithWindow(t) },
          "-",
          { label: "Close other tabs", key: "o", enabled: gBrowser.tabs.length > 1, run: () => gBrowser.removeAllTabsBut(t) },
          { label: "Close tab", key: "c", run: () => gBrowser.removeTab(t) },
          "-",
          ...ext.items,
        ], { x: e.clientX - 16, y: r.bottom + 8, native: ext.native });
      });
      dock.appendChild(c);
      circles.push(c);
    }
    document.body.appendChild(dock);
    await spike.sleep(600);
    const cr = circles[1].getBoundingClientRect();
    pf.rightClick(cr.left + 22, cr.top + 22);
    await waitOpen();
    spike.log("CHROME (tab circle) items", labels(), "placed", VitreMenu.current.placed, "native tab menu state", document.getElementById("tabContextMenu").state);
    await spike.capture("menu-tab-circle");
    // the extension's contexts:["tab"] item, listed in Vitre's tab menu and clicked
    const tabExt = VitreMenu.current.rowItems.find((i) => i.ext);
    spike.log("CHROME menu extension item", tabExt ? { label: tabExt.label, id: tabExt.ext } : null);
    if (tabExt) {
      const n1 = gBrowser.tabs.length;
      await pick(tabExt.label);
      await pf.until(() => gBrowser.tabs.length > n1, 5000);
      const et2 = gBrowser.tabs[gBrowser.tabs.length - 1];
      await pf.until(() => et2.linkedBrowser.currentURI.spec.includes("#ext-clicked"), 5000);
      spike.log("CHROME menu extension click ->", gBrowser.tabs.length > n1 ? et2.linkedBrowser.currentURI.spec : "nothing", "scratch popup cleaned", document.getElementById("vitre-ext-scratch").children.length === 0);
      if (gBrowser.tabs.length > n1) gBrowser.removeTab(et2);
      pf.rightClick(cr.left + 22, cr.top + 22);
      await waitOpen();
    }
    const n0 = gBrowser.tabs.length;
    pf.key("c"); // access key C = Close tab
    await waitClosed();
    await spike.sleep(300);
    spike.log("CHROME menu 'Close tab' by access key: tabs", n0, "->", gBrowser.tabs.length);

    // ---- 10. Inspect ---------------------------------------------------------------------------
    at = await openOn("#link1");
    await pick("Inspect");
    const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
    const tb = await pf.until(() => {
      try {
        return DevToolsShim.hasToolboxForTab ? DevToolsShim.hasToolboxForTab(gBrowser.selectedTab) : !!document.querySelector("#browser iframe.devtools-toolbox-bottom-iframe, .devtools-toolbox-bottom-iframe");
      } catch (e) {
        return false;
      }
    }, 20000, 300);
    await spike.sleep(2500);
    spike.log("INSPECT toolbox open", !!tb);
    await spike.capture("menu-inspect");
    spike.log("native popup ever shown", nativeShown);
  });
