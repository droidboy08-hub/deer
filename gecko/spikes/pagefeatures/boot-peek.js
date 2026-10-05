// Peek: a link opens in a floating sheet above the page; dismiss, hop, or promote to a real tab
// without reloading. Also the link-open interception (Shift+click, target=_blank, window.open).
/* global Services, Ci, gBrowser, spike, pf, VitrePeek, VitreMenu, VitreFind, VitreActors, XULBrowserWindow */
for (const f of ["common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js"])
  Services.scriptloader.loadSubScript("resource://vitre-boot/" + f, window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    VitreMenu.install();
    VitreMenu.closeOnBlur = false; // other spikes' windows take OS focus while this runs
    VitreFind.install();
    VitrePeek.install();
    spike.log("actor registered", VitreActors.register(await VitreActors.installToProfile()));

    const windows = () => Array.from(Services.wm.getEnumerator("navigator:browser")).length;
    const state = (br) =>
      pf.inContent(br, (w) => ({
        url: w.location.href,
        token: w.document.documentElement.dataset.token || null,
        n: +w.document.documentElement.dataset.n || 0,
        typed: w.document.getElementById("typed") ? w.document.getElementById("typed").value : null,
        hasOpener: !!w.wrappedJSObject.opener,
        openerTitle: (() => { try { return w.wrappedJSObject.opener ? String(w.wrappedJSObject.opener.document.title) : null; } catch (e) { return "err " + e; } })(),
        visibility: w.document.visibilityState,
        esc: w.document.documentElement.dataset.esc || 0,
      }));
    const peekRect = () => {
      const r = VitrePeek.current.panel.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    const waitPeek = async (part) => {
      const p = await pf.until(() => VitrePeek.current, 5000);
      if (!p) return null;
      await pf.browserLoaded(p.browser, part || "counter");
      await spike.sleep(700);
      return p;
    };
    const shiftClick = async (selector, br = b) => {
      const r = await pf.rectOf(br, selector);
      await spike.sleep(150);
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      return r;
    };

    // ---- 1. Shift+click a link -> peek ---------------------------------------------------------
    await shiftClick("#link1");
    let p = await waitPeek();
    spike.log("SHIFT+CLICK opened peek", !!p, "windows", windows(), "source page still", b.currentURI.spec);
    spike.log("PEEK tab", { hidden: p.tab.hidden, tabs: gBrowser.tabs.length, visibleTabs: gBrowser.visibleTabs.length, selectedIsSource: gBrowser.selectedTab === tab0, docShellIsActive: p.browser.docShellIsActive, remoteType: p.browser.remoteType, rect: peekRect() });
    let s1 = await state(p.browser);
    await spike.sleep(1000);
    let s2 = await state(p.browser);
    spike.log("PEEK page runs while its tab is not selected", s1.n, "->", s2.n, "visibility", s2.visibility, "token", s2.token);
    await spike.capture("peek-open");

    // ---- 2. input goes to the sheet ------------------------------------------------------------
    let r = await pf.rectOf(p.browser, "#typed");
    pf.mouse(r.cx, r.cy, {});
    await spike.sleep(200);
    spike.log("FOCUS after click in peek: activeElement is the peek browser", document.activeElement === p.browser, document.activeElement && document.activeElement.localName, "focusedContentBC is peek", Services.focus.focusedContentBrowsingContext === p.browser.browsingContext);
    pf.type("hello peek");
    await spike.sleep(200);
    spike.log("TYPED into the peek", (await state(p.browser)).typed);

    // ---- 3. its own history: follow a link, header back ----------------------------------------
    r = await pf.rectOf(p.browser, "#next");
    pf.mouse(r.cx, r.cy, {});
    await pf.until(() => p.browser.currentURI.spec.includes("second.html"), 5000);
    await spike.sleep(500);
    spike.log("PEEK navigated", p.browser.currentURI.spec, "canGoBack", p.browser.canGoBack, "header back shown", !p.ui.back.hidden, "header", p.ui.host.textContent + p.ui.path.textContent, "source tab url", b.currentURI.spec);
    await spike.capture("peek-history");
    const bk = p.ui.back.getBoundingClientRect();
    pf.mouse(bk.left + 14, bk.top + 14, {});
    await pf.until(() => p.browser.currentURI.spec.includes("counter.html"), 5000);
    await spike.sleep(500);
    const s3 = await state(p.browser);
    spike.log("PEEK back", p.browser.currentURI.spec, "canGoForward", p.browser.canGoForward, "state (same token = restored from bfcache)", { token: s3.token, typed: s3.typed, n: s3.n });

    // ---- 4. find inside the peek (capsule in the header) ---------------------------------------
    p.browser.focus();
    pf.key("f", { accelKey: true });
    await pf.until(() => VitreFind.active, 3000);
    const fst = VitreFind.active;
    spike.log("CTRL+F in peek targets the peek browser", fst && fst.browser === p.browser, "capsule in header", !!(fst && fst.ui.host));
    pf.type("page");
    await pf.until(() => fst.events.some((e) => e.startsWith("count:")), 4000);
    await spike.sleep(300);
    spike.log("PEEK find counter", fst.ui.count.textContent);
    await spike.capture("peek-find");
    pf.key("KEY_Escape");
    await spike.sleep(300);
    spike.log("ESC in the find field closed find, not the peek", !VitreFind.active, !!VitrePeek.current, "peek tab still hidden", p.tab.hidden, "selected is source", gBrowser.selectedTab === tab0, "framefocusrequested blocked", VitrePeek.blockedFocusRequests, "focus in peek", document.activeElement === p.browser);

    // ---- 4b. alert() from the peek stays in the sheet ------------------------------------------
    r = await pf.rectOf(p.browser, "#alert");
    pf.mouse(r.cx, r.cy, {});
    const dlg = await pf.until(() => p.browser.hasAttribute("tabDialogShowing"), 4000);
    await spike.sleep(500);
    spike.log("ALERT in peek: dialog showing", !!dlg, "selected is still source", gBrowser.selectedTab === tab0, "tab switch blocked", VitrePeek.blockedDialogSwitches, "attention flag", p.tab.hasAttribute("attention"));
    await spike.capture("peek-alert");
    try {
      gBrowser.getTabDialogBox(p.browser).abortAllDialogs();
    } catch (e) {
      spike.log("abort dialog failed", String(e));
    }
    await spike.sleep(400);
    spike.log("ALERT dismissed", !p.browser.hasAttribute("tabDialogShowing"));

    // ---- 5. right-click inside the peek --------------------------------------------------------
    r = await pf.rectOf(p.browser, "#next");
    pf.rightClick(r.cx, r.cy);
    await pf.until(() => VitreMenu.isOpen, 4000);
    spike.log("MENU in peek", VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label), "browser is peek", VitreMenu.lastContext.pageURL);
    await spike.capture("peek-menu");
    VitreMenu.close("test");
    const hr = p.header.getBoundingClientRect();
    pf.rightClick(hr.left + 200, hr.top + 22);
    await pf.until(() => VitreMenu.isOpen, 3000);
    spike.log("MENU on peek header", VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label));
    VitreMenu.close("test");

    // ---- 6. promote: same browser, nothing reloads ---------------------------------------------
    let loads = 0;
    const listener = {
      onStateChange(br, wp, req, flags) {
        if (br === p.browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) loads++;
      },
    };
    gBrowser.addTabsProgressListener(listener);
    const before = await state(p.browser);
    const bcId = p.browser.browsingContext.id;
    const pid = p.browser.frameLoader.remoteTab.osPid;
    p.browser.focus();
    pf.key("KEY_Enter", { altKey: true });
    await pf.until(() => !VitrePeek.current && gBrowser.selectedTab === p.tab, 4000);
    await spike.sleep(900);
    const after = await state(p.browser);
    spike.log("PROMOTE (Alt+Enter)", {
      selected: gBrowser.selectedTab === p.tab,
      hidden: p.tab.hidden,
      index: gBrowser.tabs.indexOf(p.tab),
      sourceIndex: gBrowser.tabs.indexOf(tab0),
      visibleTabs: gBrowser.visibleTabs.length,
      sameBrowsingContext: p.browser.browsingContext.id === bcId,
      sameProcess: p.browser.frameLoader.remoteTab.osPid === pid,
      documentLoadsDuringPromotion: loads,
    });
    spike.log("PROMOTE state before", { token: before.token, n: before.n, typed: before.typed }, "after", { token: after.token, n: after.n, typed: after.typed, visibility: after.visibility });
    await spike.capture("peek-promoted");
    gBrowser.removeTabsProgressListener(listener);
    const promotedTab = p.tab;

    // ---- 7. peek belongs to its source tab; close routes; warm reopen --------------------------
    gBrowser.selectedTab = tab0;
    await spike.sleep(400);
    await shiftClick("#link1");
    p = await waitPeek();
    const tokA = (await state(p.browser)).token;
    gBrowser.selectedTab = promotedTab;
    await spike.sleep(500);
    spike.log("TAB SWITCH away: sheet shown", p.panel.classList.contains("vp-panel"), "scrim hidden", p.scrim.hidden, "active", p.browser.docShellIsActive);
    gBrowser.selectedTab = tab0;
    await spike.sleep(500);
    spike.log("TAB SWITCH back: sheet shown", p.panel.classList.contains("vp-panel"), "active", p.browser.docShellIsActive, "same token", (await state(p.browser)).token === tokA);

    p.browser.focus();
    await spike.sleep(150);
    spike.log("window is the OS-active window", Services.focus.activeWindow === window, "focusedContentBrowsingContext is the peek", Services.focus.focusedContentBrowsingContext === p.browser.browsingContext);
    pf.key("KEY_Escape");
    await pf.until(() => !VitrePeek.current, 3000);
    spike.log("ESC closed the peek (page did not use Esc)", !VitrePeek.current, "warm tab kept", !!VitrePeek.warm, "focus back in source", document.activeElement === b, "key events seen", VitrePeek.escTrace.splice(0));
    const re = VitrePeek.reopen();
    await spike.sleep(600);
    spike.log("REOPEN warm peek: same page instance", !!re && (await state(re.browser)).token === tokA);
    const sc = VitrePeek.current.scrim.getBoundingClientRect();
    pf.mouse(sc.left + 30, sc.top + 300, {});
    await pf.until(() => !VitrePeek.current, 3000);
    spike.log("CLICK on the dim closed it", !VitrePeek.current, "source did not navigate", b.currentURI.spec);

    // page that uses Esc: first Esc goes to the page, Esc Esc closes
    VitrePeek.open(pf.base + "counter.html?trapesc", { opener: b });
    p = await waitPeek("trapesc");
    p.browser.focus();
    await spike.sleep(200);
    VitrePeek.escTrace.splice(0);
    spike.log("before Esc: focus in peek", document.activeElement === p.browser, "window is the OS-active window", Services.focus.activeWindow === window, "focusedContentBrowsingContext is the peek", Services.focus.focusedContentBrowsingContext === p.browser.browsingContext);
    if (Services.focus.focusedContentBrowsingContext !== p.browser.browsingContext) {
      // Another spike's window has OS focus, so the focus manager did not switch the active remote
      // frame when the peek's <browser> was focused. A click in the sheet (what a user does) does.
      const hb = p.browser.getBoundingClientRect();
      pf.mouse(hb.left + hb.width - 40, hb.top + hb.height - 40, {});
      await spike.sleep(300);
      spike.log("after a click in the sheet: focusedContentBrowsingContext is the peek", Services.focus.focusedContentBrowsingContext === p.browser.browsingContext);
    }
    pf.key("KEY_Escape");
    await spike.sleep(700);
    spike.log("ESC on a page that handles it: peek still open", !!VitrePeek.current, "page esc count", (await state(p.browser)).esc, "key events seen", VitrePeek.escTrace.splice(0), "focus in peek", document.activeElement === p.browser);
    pf.key("KEY_Escape");
    await spike.sleep(60);
    pf.key("KEY_Escape");
    await spike.sleep(400);
    spike.log("ESC ESC closed anyway", !VitrePeek.current);

    // ---- 8. hop: Shift+click another link on the dimmed page -----------------------------------
    await shiftClick("#link1");
    p = await waitPeek();
    const hopTab = p.tab;
    pf.EU.synthesizeKey("KEY_Shift", { type: "keydown" }, window);
    await shiftClick("#imglink");
    pf.EU.synthesizeKey("KEY_Shift", { type: "keyup" }, window);
    await pf.until(() => VitrePeek.current && VitrePeek.current.browser.currentURI.spec.includes("from=imglink"), 5000);
    spike.log("HOP: same sheet navigated", VitrePeek.current.tab === hopTab, VitrePeek.current.browser.currentURI.spec, "tabs", gBrowser.tabs.length);
    VitrePeek.close("test", { discard: true });

    // ---- 9. Ctrl+Q sources: focused link (actor) and hovered link (XULBrowserWindow.overLink) ---
    spike.log("source tab alive", b.isConnected, gBrowser.selectedTab === tab0, b.currentURI.spec);
    await pf.inContent(b, (w) => { w.scrollTo(0, 0); w.document.getElementById("link1").focus(); });
    try {
      const info = await VitreActors.query(b, "Vitre:Link");
      spike.log("ACTOR Vitre:Link (focused link)", info);
      spike.log("ACTOR Vitre:Ping", await VitreActors.query(b, "Vitre:Ping"));
    } catch (e) {
      spike.log("ACTOR query failed", String(e));
    }
    await pf.inContent(b, (w) => w.document.activeElement.blur());
    r = await pf.rectOf(b, "#link1");
    pf.mouse(r.cx, r.cy, { type: "mousemove" });
    await pf.until(() => XULBrowserWindow.overLink, 3000);
    spike.log("HOVERED link from chrome: XULBrowserWindow.overLink =", XULBrowserWindow.overLink);
    try {
      spike.log("ACTOR Vitre:Link (hovered link)", await VitreActors.query(b, "Vitre:Link"));
    } catch (e) {
      spike.log("ACTOR query failed", String(e));
    }

    // Ctrl+Q itself: focused link, then hovered link
    await pf.inContent(b, (w) => w.document.getElementById("link1").focus());
    await spike.sleep(150);
    b.focus();
    pf.key("q", { accelKey: true });
    p = await waitPeek();
    spike.log("CTRL+Q on a focused link opened a peek", !!p, p && p.browser.currentURI.spec, "origin (link centre, chrome px)", p && p.origin);
    if (p) VitrePeek.close("test", { discard: true });
    await pf.inContent(b, (w) => w.document.activeElement.blur());
    r = await pf.rectOf(b, "#imglink");
    pf.mouse(r.cx, r.cy, { type: "mousemove" });
    await pf.until(() => XULBrowserWindow.overLink.includes("imglink"), 3000);
    pf.key("q", { accelKey: true });
    p = await waitPeek("imglink");
    spike.log("CTRL+Q on a hovered link opened a peek", !!p, p && p.browser.currentURI.spec);
    if (p) VitrePeek.close("test", { discard: true });
    await pf.inContent(b, (w) => w.scrollTo(0, 0));

    // ---- 10. target=_blank and window.open ------------------------------------------------------
    spike.log("PREFS browser.link.open_newwindow", Services.prefs.getIntPref("browser.link.open_newwindow"), "restriction", Services.prefs.getIntPref("browser.link.open_newwindow.restriction"), "loadDivertedInBackground", Services.prefs.getBoolPref("browser.tabs.loadDivertedInBackground"));
    VitrePeek.newWindowMode = "tab";
    let n = gBrowser.tabs.length;
    r = await pf.rectOf(b, "#link2");
    pf.mouse(r.cx, r.cy, {});
    await pf.until(() => gBrowser.tabs.length > n, 5000);
    await spike.sleep(600);
    spike.log("TARGET=_BLANK (mode tab): new tab selected", gBrowser.selectedTab !== tab0, gBrowser.selectedBrowser.currentURI.spec, "routed", VitrePeek.routed.slice(-1)[0]);
    if (gBrowser.selectedTab !== tab0) gBrowser.removeTab(gBrowser.selectedTab);
    gBrowser.selectedTab = tab0;
    await spike.sleep(300);

    VitrePeek.newWindowMode = "peek";
    r = await pf.rectOf(b, "#opener");
    pf.mouse(r.cx, r.cy, {});
    p = await waitPeek("from=open");
    let so = p ? await state(p.browser) : null;
    spike.log("WINDOW.OPEN (mode peek): became a peek", !!p, "selected stays source", gBrowser.selectedTab === tab0, "routed", VitrePeek.routed.slice(-1)[0], "window.opener in the peek", so && { hasOpener: so.hasOpener, openerTitle: so.openerTitle });
    await spike.capture("peek-window-open");
    if (p) {
      const t = VitrePeek.promote();
      await spike.sleep(700);
      so = await state(t.linkedBrowser);
      spike.log("PROMOTED window.open peek keeps its opener", { hasOpener: so.hasOpener, openerTitle: so.openerTitle, token: so.token });
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);
    }

    // window.open with features: by default a separate window; restriction=0 diverts it here too
    Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 0);
    r = await pf.rectOf(b, "#opener2");
    pf.mouse(r.cx, r.cy, {});
    p = await waitPeek("from=popup");
    spike.log("POPUP window.open(features) with restriction=0: became a peek", !!p, "windows", windows(), "routed", VitrePeek.routed.slice(-1)[0]);
    if (p) VitrePeek.close("test", { discard: true });

    // ---- 11. animated promotion (CSS on the panel) ----------------------------------------------
    VitrePeek.animatePromote = true;
    await shiftClick("#link1");
    p = await waitPeek();
    const t1 = (await state(p.browser)).token;
    VitrePeek.promote({ animate: true });
    await spike.sleep(120);
    const mid = peekRect();
    await pf.until(() => !VitrePeek.current, 3000);
    await spike.sleep(300);
    spike.log("ANIMATED promote: mid-flight rect", mid, "ended selected", gBrowser.selectedTab === p.tab, "same token", (await state(p.browser)).token === t1);
    spike.log("END tabs", gBrowser.tabs.length, "visible", gBrowser.visibleTabs.length, "windows", windows());
  });
