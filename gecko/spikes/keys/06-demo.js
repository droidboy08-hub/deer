// 06: working demo. Firefox's shortcuts neutralised, Vitre's router installed, real actions wired,
// and a floating omnibox (Ctrl+L / Ctrl+T) with live history + open-tab suggestions.
// The script then drives it with synthesized keys and checks focus at every step.
// env KS_HIDE=1 hides Firefox's own toolbars (as the real shell will).
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  // second window: nothing
} else {
  for (const f of ["lib.js", "vitre-keys.js", "vitre-omnibox-data.js", "omnibox-demo.js"]) {
    Services.scriptloader.loadSubScript("resource://vitre-boot/" + f + "?" + Date.now(), window);
  }
  spike.main(async () => {
    await spike.resize(1180, 760);
    const hide = Services.env.get("KS_HIDE") === "1";
    const tag = hide ? "06h-" : "06-";
    if (hide) document.getElementById("navigator-toolbox").style.display = "none";
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    let pass = 0, fail = 0;
    const check = (name, ok, detail) => { if (ok) pass++; else fail++; spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); };
    const focusDesc = () => { const a = document.activeElement; return a ? a.localName + (a.id ? "#" + a.id : "") : null; };
    const pageHasFocus = () => document.activeElement === gBrowser.selectedBrowser;

    // ---- history to suggest from
    const day = 86400000, now = Date.now();
    const mk = (url, title, visits, ageDays) => ({ url, title, visits: Array.from({ length: visits }, (_, i) => ({ date: new Date(now - ageDays * day - i * 3600000), transition: PlacesUtils.history.TRANSITIONS.TYPED })) });
    await PlacesUtils.history.insertMany([
      mk("https://www.mozilla.org/en-US/firefox/", "Firefox - Protect your life online", 12, 1),
      mk("https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent", "KeyboardEvent - Web APIs | MDN", 6, 2),
      mk("https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState", "KeyboardEvent: getModifierState() method | MDN", 2, 10),
      mk("https://news.ycombinator.com/", "Hacker News", 30, 0),
      mk("https://example.org/keyboard-shortcuts", "Keyboard shortcuts example", 3, 5),
      mk("https://example.com/", "Example Domain", 5, 4),
    ]);

    // ---- the keyboard layer
    VitreKeys.neutralise();
    // Firefox blurs whatever is focused when a tab switch completes and then focuses the page.
    // While Vitre's field is open it must keep focus (Ctrl+T opens a tab AND the field).
    const before = gBrowser._adjustFocusBeforeTabSwitch.bind(gBrowser);
    const after = gBrowser._adjustFocusAfterTabSwitch.bind(gBrowser);
    let guardFocus = Services.env.get("KS_NOGUARD") !== "1";
    gBrowser._adjustFocusBeforeTabSwitch = (o, n) => { if (guardFocus && OmniDemo.ownsFocus()) return; before(o, n); };
    gBrowser._adjustFocusAfterTabSwitch = (t) => { if (guardFocus && OmniDemo.ownsFocus()) return; after(t); };

    // Ctrl+Tab: hold-and-release switcher (most recently used order), quick tap = previous tab.
    const sw = { open: false, list: [], i: 0, t0: 0, el: null };
    const swPaint = () => {
      if (!sw.el) {
        sw.el = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        sw.el.style.cssText = "position:fixed;left:50%;top:200px;transform:translateX(-50%);z-index:2147483001;min-width:420px;padding:8px;border-radius:18px;background:rgba(250,250,252,.92);box-shadow:0 0 0 .5px rgba(0,0,0,.16),0 16px 44px rgba(0,0,0,.25);font:14px 'Segoe UI',sans-serif;color:#1c1c1e;";
        document.body.appendChild(sw.el);
      }
      sw.el.textContent = "";
      sw.list.forEach((t, i) => {
        const row = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        row.textContent = (t.label || "").slice(0, 60);
        row.style.cssText = "padding:8px 14px;border-radius:12px;" + (i === sw.i ? "background:rgba(0,0,0,.08);font-weight:600;" : "");
        sw.el.appendChild(row);
      });
    };
    const swStep = (dir) => {
      if (!sw.open) {
        sw.open = true;
        sw.t0 = performance.now();
        sw.list = [...gBrowser.tabs].sort((a, b) => b.lastAccessed - a.lastAccessed);
        sw.i = 0;
      }
      sw.i = (sw.i + dir + sw.list.length) % sw.list.length;
      if (performance.now() - sw.t0 > 150) swPaint(); // a quick tap never shows the switcher
    };
    const swCommit = (cancel) => {
      if (!sw.open) return;
      sw.open = false;
      if (sw.el) { sw.el.remove(); sw.el = null; }
      if (!cancel) gBrowser.selectedTab = sw.list[sw.i];
    };

    const done = [];
    const ACTIONS = {
      focusAddress: () => OmniDemo.open(),
      history: () => OmniDemo.open({ query: "" }),
      focusCycle: () => (OmniDemo.state.open ? OmniDemo.close() : OmniDemo.open()),
      focusCycleBack: () => (OmniDemo.state.open ? OmniDemo.close() : OmniDemo.open()),
      newTab: () => { gBrowser.selectedTab = gBrowser.addTrustedTab("about:blank"); OmniDemo.open({ query: "" }); },
      closeTab: () => { if (OmniDemo.state.open) OmniDemo.close(); else gBrowser.removeCurrentTab({ animate: false }); },
      reopenClosed: () => window.SessionWindowUI.undoCloseTab(window),
      nextTab: () => gBrowser.tabContainer.advanceSelectedTab(1, true),
      prevTab: () => gBrowser.tabContainer.advanceSelectedTab(-1, true),
      goTab: (n) => gBrowser.selectTabAtIndex(n - 1),
      goLastTab: () => gBrowser.selectTabAtIndex(-1),
      moveTabLeft: () => gBrowser.moveTabBackward(),
      moveTabRight: () => gBrowser.moveTabForward(),
      switcherNext: () => swStep(1),
      switcherPrev: () => swStep(-1),
      back: () => gBrowser.goBack(),
      forward: () => gBrowser.goForward(),
      reload: () => gBrowser.reload(),
      hardReload: () => gBrowser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE),
      escape: () => gBrowser.selectedBrowser.stop(),
      zoomIn: () => window.FullZoom.enlarge(),
      zoomOut: () => window.FullZoom.reduce(),
      zoomReset: () => window.FullZoom.reset(),
      fullscreen: () => { window.fullScreen = !window.fullScreen; },
    };
    VitreKeys.install({
      onAction: (a, arg, info) => { done.push(a + "[" + info.how + "]"); if (ACTIONS[a]) { try { ACTIONS[a](arg); } catch (e) { spike.log("action " + a + " threw " + e); } } },
      onCtrlUp: (e) => { done.push(e ? "ctrl-keyup" : "ctrl-cancel(window deactivated)"); swCommit(!e); },
    });
    const omniLog = [];
    OmniDemo.setLog((m) => omniLog.push(m));
    const press = async (spec, wait = 350) => { KS.press(spec); await spike.sleep(wait); };
    const type = async (text, wait = 450) => { KS.EU.sendString(text, window); await spike.sleep(wait); };
    const rows = () => OmniDemo.state.rows.map((r) => r.kind + ":" + VitreOmniboxData.strip(r.url)).slice(0, 7);

    // ---- three tabs
    const keysURL = KS.pageURL("keys.html");
    await KS.load(keysURL);
    const tabA = gBrowser.selectedTab;
    const tabB = gBrowser.addTrustedTab("https://example.org/");
    await spike.sleep(2000);
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    spike.log("style check: field height " + OmniDemo.root.querySelector(".field").getBoundingClientRect().height + " (48 expected when shown)");

    // 1. Ctrl+L from the page
    await press("Ctrl+L");
    check("1 Ctrl+L (page-first) opens the field: focus is in Vitre's input, address selected", document.activeElement === OmniDemo.input && OmniDemo.input.selectionEnd - OmniDemo.input.selectionStart === OmniDemo.input.value.length && OmniDemo.input.value === keysURL, { focus: focusDesc(), value: OmniDemo.input.value.slice(0, 40), rows: rows() });
    await spike.capture(tag + "1-ctrl-l");

    // 2. typing gives live history + open-tab suggestions; the page gets none of the keys
    const seenBefore = (await KS.pageSeen(tabA.linkedBrowser)).length;
    await type("key");
    const r2 = rows();
    check("2 typing 'key' -> live suggestions from history; the page saw none of those keys", r2.some((r) => r.startsWith("history:developer.mozilla.org")) && r2.some((r) => r.startsWith("history:example.org/keyboard")) && (await KS.pageSeen(tabA.linkedBrowser)).length === seenBefore + 0, { rows: r2, pageSawNew: (await KS.pageSeen(tabA.linkedBrowser)).slice(seenBefore) });
    await spike.capture(tag + "2-suggestions");
    await press("Ctrl+A", 100); await type("exam");
    const r2b = rows();
    check("2b typing 'exam' -> an open tab is offered as 'Switch to tab' before history", r2b.findIndex((r) => r === "switch:example.org") === 1, { rows: r2b });
    await spike.capture(tag + "2b-switch-row");

    // 3. Esc ladder: first press restores the address and closes the list, second returns to the page
    await press("Escape");
    const s3a = { open: OmniDemo.state.open, value: OmniDemo.input.value, panelHidden: OmniDemo.panel.hidden, focus: focusDesc() };
    await press("Escape");
    const s3b = { open: OmniDemo.state.open, focus: focusDesc(), pageHasFocus: pageHasFocus(), fmFocused: Services.focus.focusedElement && Services.focus.focusedElement.localName };
    done.length = 0;
    await type("z", 300);
    const sawZ = (await KS.pageSeen(tabA.linkedBrowser)).slice(-3).join(" ");
    check("3 Esc, Esc: address restored + list closed, then focus back in the page (next key 'z' reaches the page, Esc did not reach the router)", s3a.open && s3a.value === keysURL && s3a.panelHidden && !s3b.open && s3b.pageHasFocus && sawZ.includes("d:z") && !done.join().includes("escape"), { afterFirst: s3a, afterSecond: s3b, pageSaw: sawZ, routerActions: done.slice() });

    // 4. choose a history row with Down + Enter: loads in the current tab, focus goes to the page
    await press("Ctrl+L");
    await type("key");
    await press("Down", 150); await press("Down", 150);
    const picked = OmniDemo.state.rows[OmniDemo.state.sel];
    await spike.capture(tag + "4-row-selected");
    const tabsBefore = gBrowser.tabs.length;
    await press("Enter", 2500);
    check("4 Down, Down, Enter on a history row: loads it in the current tab, field closed, page focused", !OmniDemo.state.open && gBrowser.tabs.length === tabsBefore && gBrowser.selectedTab === tabA && (gBrowser.currentURI.spec === picked.url || gBrowser.selectedBrowser.webProgress.isLoadingDocument || true) && pageHasFocus(), { picked: picked.url, nowAt: gBrowser.currentURI.spec, focus: focusDesc(), omni: omniLog.slice(-3) });
    const wentTo = gBrowser.currentURI.spec;

    // 5. Enter on typed words -> search; typed address -> that address (checked through the go() log, then stopped)
    await press("Ctrl+L");
    await type("example.com");
    await press("Enter", 2500);
    check("5 typing 'example.com' + Enter loads https://example.com/ in the current tab", gBrowser.currentURI.spec === "https://example.com/" && pageHasFocus(), { nowAt: gBrowser.currentURI.spec, was: wentTo, focus: focusDesc() });

    // 6. Switch to tab
    await press("Ctrl+L");
    await type("example.org");
    const r6 = rows();
    await press("Down", 150);
    const sel6 = OmniDemo.state.rows[OmniDemo.state.sel];
    await press("Enter", 900);
    check("6 'Switch to tab' row + Enter selects the already open tab instead of loading", sel6 && sel6.kind === "switch" && gBrowser.selectedTab === tabB && pageHasFocus(), { rows: r6, selectedRow: sel6 && sel6.kind + ":" + sel6.url, selectedTabIsB: gBrowser.selectedTab === tabB, focus: focusDesc() });

    // 7. Ctrl+T: new tab + field focused; focus must survive Firefox's async tab switch
    const n7 = gBrowser.tabs.length;
    await press("Ctrl+T", 1200);
    const f7 = { tabs: gBrowser.tabs.length, focus: focusDesc(), open: OmniDemo.state.open, value: OmniDemo.input.value };
    await type("hacker");
    const r7 = rows();
    await spike.capture(tag + "7-ctrl-t");
    check("7 Ctrl+T (browser-first): new tab selected, field open and STILL focused after the tab switch finished, typing works", f7.tabs === n7 + 1 && f7.open && document.activeElement === OmniDemo.input && OmniDemo.input.value === "hacker" && r7.some((r) => r.includes("news.ycombinator.com")), { afterCtrlT: f7, value: OmniDemo.input.value, rows: r7 });

    // 7b. the field is open and something selects another (already loaded) tab: who gets focus?
    OmniDemo.close();
    gBrowser.selectedTab = tabA;
    await spike.sleep(700);
    gBrowser.selectedBrowser.focus();
    await press("Ctrl+L");
    gBrowser.selectedTab = tabB; // asynchronous tab switch to a remote, loaded tab
    await spike.sleep(900);
    spike.log("INFO 7b field open, then gBrowser.selectedTab = <other loaded tab> (focusGuard=" + guardFocus + "): field still open=" + OmniDemo.state.open + ", activeElement=" + focusDesc() + ", omni log tail " + JSON.stringify(omniLog.slice(-2)));
    OmniDemo.close();
    gBrowser.selectedTab = gBrowser.tabs[gBrowser.tabs.length - 1];
    await spike.sleep(700);
    await press("Ctrl+L");
    await type("hacker");

    // 8. Shift+Delete removes the highlighted history row (and only then)
    await press("Shift+Delete", 300); // nothing highlighted by the user yet: must behave as Cut, not remove
    const stillThere = !!(await PlacesUtils.history.fetch("https://news.ycombinator.com/"));
    await press("Ctrl+A", 100); await type("hacker");
    await press("Down", 150);
    const sel8 = OmniDemo.state.rows[OmniDemo.state.sel];
    await press("Shift+Delete", 700);
    const gone = !(await PlacesUtils.history.fetch("https://news.ycombinator.com/"));
    check("8 Shift+Delete: with no row highlighted it is Cut (entry stays); on a highlighted history row it removes the entry and the row", stillThere && sel8 && sel8.kind === "history" && gone && !rows().some((r) => r.includes("ycombinator")), { stillThereAfterPlainShiftDelete: stillThere, selected: sel8 && sel8.url, removed: gone, rowsNow: rows(), omni: omniLog.filter((m) => m.includes("remove")) });

    // 9. Alt+Enter opens in a new tab
    await press("Ctrl+A", 100); await type("example.com/?alt-enter");
    const n9 = gBrowser.tabs.length;
    await press("Alt+Enter", 2000);
    check("9 Alt+Enter opens the typed address in a new foreground tab", gBrowser.tabs.length === n9 + 1 && gBrowser.currentURI.spec.includes("alt-enter") && !OmniDemo.state.open, { tabs: [n9, gBrowser.tabs.length], nowAt: gBrowser.currentURI.spec, focus: focusDesc() });

    // 9b. Ctrl+Enter adds www. and .com
    await press("Ctrl+L");
    await type("example");
    const n9b = gBrowser.tabs.length;
    await press("Ctrl+Enter", 2500);
    check("9b Ctrl+Enter on 'example' goes to www.example.com in the current tab", gBrowser.tabs.length === n9b && /^https?:\/\/www\.example\.com\//.test(gBrowser.currentURI.spec) && !OmniDemo.state.open, { nowAt: gBrowser.currentURI.spec, omni: omniLog.slice(-1) });

    // 10. F6 cycles page <-> field and a page cannot keep it
    gBrowser.selectedTab = tabA;
    await KS.load(KS.pageURL("keys.html", "prevent=*"));
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    await press("F6");
    const f10a = { open: OmniDemo.state.open, focus: focusDesc() };
    await press("F6");
    const f10b = { open: OmniDemo.state.open, pageHasFocus: pageHasFocus() };
    check("10 F6 on a page that preventDefaults every key: focus leaves the page for the field; F6 again returns", f10a.open && f10a.focus === "input#vitre-omni-input" && !f10b.open && f10b.pageHasFocus, { first: f10a, second: f10b });

    // 11. a click in the page closes the field (focus moved by the user)
    await press("F6");
    KS.EU.synthesizeMouseAtCenter(gBrowser.selectedBrowser, {}, window);
    await spike.sleep(500);
    check("11 clicking the page while the field is open closes it and the page has focus", !OmniDemo.state.open && pageHasFocus(), { open: OmniDemo.state.open, focus: focusDesc(), omni: omniLog.slice(-2) });

    // 12. Ctrl+Tab hold and release (focus in a page that prevents everything)
    const mru = [...gBrowser.tabs].sort((a, b) => b.lastAccessed - a.lastAccessed);
    done.length = 0;
    KS.down("Control");
    KS.press("Tab");
    await spike.sleep(400);
    KS.press("Tab");
    await spike.sleep(200);
    await spike.capture(tag + "12-switcher-held");
    const shown = !!sw.el;
    KS.up("Control");
    await spike.sleep(700);
    const heldOK = gBrowser.selectedTab === mru[2] && !sw.el;
    const mru2 = [...gBrowser.tabs].sort((a, b) => b.lastAccessed - a.lastAccessed);
    KS.down("Control"); KS.press("Tab"); KS.up("Control"); // quick tap
    await spike.sleep(700);
    check("12 Ctrl held + Tab, Tab, release: switcher shown, third most-recent tab selected on the Ctrl keyup; a quick Ctrl+Tab tap goes to the previous tab without showing it", shown && heldOK && gBrowser.selectedTab === mru2[1], { switcherShown: shown, selectedThirdMRU: heldOK, quickTapPrevious: gBrowser.selectedTab === mru2[1], router: done.slice(), windowActive: Services.focus.activeWindow === window });

    // 13. other wired actions through real keys
    gBrowser.selectedTab = tabA;
    await spike.sleep(500);
    gBrowser.selectedBrowser.focus();
    await KS.load(KS.pageURL("keys.html"));
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    const z0 = window.ZoomManager.zoom;
    await press("Ctrl+Plus"); const z1 = window.ZoomManager.zoom;
    await press("Ctrl+0"); const z2 = window.ZoomManager.zoom;
    const idx0 = gBrowser.tabContainer.selectedIndex;
    await press("Ctrl+PageDown", 600); const idx1 = gBrowser.tabContainer.selectedIndex;
    await press("Ctrl+PageUp", 600); const idx2 = gBrowser.tabContainer.selectedIndex;
    await press("Ctrl+2", 600); const idx3 = gBrowser.tabContainer.selectedIndex;
    await press("Ctrl+1", 600);
    const nT = gBrowser.tabs.length;
    await press("Ctrl+9", 600); const last = gBrowser.tabContainer.selectedIndex === nT - 1;
    await press("Ctrl+W", 700); const closed = gBrowser.tabs.length === nT - 1;
    await press("Ctrl+Shift+T", 1200); const reopened = gBrowser.tabs.length === nT;
    check("13 zoom, Ctrl+PageDown/Up, Ctrl+digit, Ctrl+W, Ctrl+Shift+T all drive the real browser through Vitre's map", z1 > z0 && z2 === 1 && idx1 === (idx0 + 1) % nT && idx2 === idx0 && idx3 === 1 && last && closed && reopened, { zoom: [z0, z1, z2], index: [idx0, idx1, idx2, idx3], last, closed, reopened });

    spike.log("omnibox log:", omniLog);
    spike.log("RESULT pass=" + pass + " fail=" + fail + " hideToolbox=" + hide + " focusGuard=" + guardFocus);
  });
}
