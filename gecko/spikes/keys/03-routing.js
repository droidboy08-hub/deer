// 03: routing details with Firefox neutralised and the Vitre router installed.
// page-first vs browser-first, editing keys, accesskeys, repeat, AltGr, IME, Ctrl keyup,
// focus in Vitre's own field, in-process pages, extension keysets.
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  // secondary window: nothing
} else {
  Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
  Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
  spike.main(async () => {
    await spike.resize(1100, 720);
    const actions = [];
    const routerLog = [];
    let ctrlUps = [];
    VitreKeys.neutralise();
    VitreKeys.install({
      onAction: (a, arg, info) => actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + (info.event.repeat ? ",repeat" : "") + "]"),
      log: (m) => routerLog.push(m),
      onCtrlUp: (e) => ctrlUps.push(e ? "ctrl-up@" + Math.round(performance.now()) + " target=" + e.target.localName : "ctrl-cancel"),
    });
    let pass = 0, fail = 0;
    const check = (name, ok, detail) => { if (ok) pass++; else fail++; spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); };
    const go = async (query) => { await KS.load(KS.pageURL("keys.html", query)); gBrowser.selectedBrowser.focus(); await spike.sleep(250); actions.length = 0; routerLog.length = 0; };
    const key = async (spec, extra) => { actions.length = 0; KS.press(spec, extra); await spike.sleep(350); return actions.slice(); };
    const seen = () => KS.pageSeen();
    const pageFocus = (id) => KS.inPage("function(w,d){ d.getElementById(" + JSON.stringify(id) + ").focus(); if (" + JSON.stringify(id) + " === 'field') d.getElementById('field').select(); return d.activeElement.id; }");
    const fieldValue = () => KS.inPage(function (w, d) { return d.getElementById("field").value; });

    // ---------------------------------------------------------------- A. page-first, plain page
    spike.log("--- A. page-first");
    VitreKeys.applyRebind({ peekLink: "Ctrl+K" }); // a rebindable verb moved onto Ctrl+K for this test
    await go("");
    let a = await key("Ctrl+K");
    check("A1 Ctrl+K, page does not prevent -> Vitre acts after the page", a.join() === "peekLink[page-first/reply]" && (await seen()).join().includes("d:ctrl-k"), { actions: a, page: await seen() });
    await go("prevent=ctrl-k");
    a = await key("Ctrl+K");
    check("A2 Ctrl+K, page preventDefaults keydown -> Vitre does nothing", a.length === 0 && (await seen()).join().includes("d:ctrl-k!"), { actions: a, page: await seen() });
    a = await key("Ctrl+L");
    check("A3 same page, Ctrl+L not prevented -> Vitre acts", a.join() === "focusAddress[page-first/reply]", a);
    a = await key("Ctrl+T");
    check("A4 browser-first Ctrl+T on a page that prevents '*'? (this page prevents only ctrl-k) -> acts, page never sees it", a.join() === "newTab[browser-first]" && !(await seen()).join().includes("ctrl-t"), { actions: a, page: await seen() });
    await go("prevent=*");
    a = await key("Ctrl+T");
    const a2 = await key("Ctrl+W");
    const a3 = await key("F6");
    const a4 = await key("Ctrl+R");
    const a5 = await key("Escape");
    check("A5 page prevents EVERY keydown: browser-first still act (T,W,F6), page-first do not (Ctrl+R, Esc)", a.length === 1 && a2.length === 1 && a3.length === 1 && a4.length === 0 && a5.length === 0, { T: a, W: a2, F6: a3, R: a4, Esc: a5, page: await seen() });
    VitreKeys.applyRebind(null);
    a = await key("Ctrl+K");
    check("A6 after reset, Ctrl+K is unbound (left to pages)", a.length === 0, a);

    // ---------------------------------------------------------------- B. default actions in the page count as "page used it"
    spike.log("--- B. page default actions");
    // A rebindable verb parked on Ctrl+A for the test: in a page field Ctrl+A is "select all"
    // (an editor default action, no page script involved), so the reply comes back consumed.
    VitreKeys.applyRebind({ peekLink: "Ctrl+A" });
    await go("");
    await pageFocus("field");
    await KS.inPage(function (w, d) { d.getElementById("field").setSelectionRange(0, 0); return 1; });
    a = await key("Ctrl+A");
    const selLen = await KS.inPage(function (w, d) { const f = d.getElementById("field"); return f.selectionEnd - f.selectionStart; });
    check("B1 a chord the page's editor uses (Ctrl+A in an <input>) is 'kept by the page': select-all happens, the Vitre verb bound to it does not fire", a.length === 0 && selLen === 11 && routerLog.join().includes("page kept Ctrl+A"), { actions: a, selectedChars: selLen, router: routerLog.slice(-2) });
    await KS.inPage(function (w, d) { d.activeElement.blur(); d.getSelection().removeAllRanges(); return 1; });
    a = await key("Ctrl+U");
    check("B2 Ctrl+U (no default action in the page) -> Vitre acts", a.join() === "viewSource[page-first/reply]", a);
    VitreKeys.applyRebind(null);
    await go("acc=d");
    a = await key("Alt+D");
    check("B3 Alt+D on a page with accesskey=d (ui.key.contentAccess=4): the page's accesskey wins, Vitre does nothing", a.length === 0 && (await seen()).includes("accesskey-click"), { actions: a, page: await seen() });
    await go("");
    a = await key("Alt+D");
    check("B4 Alt+D on a page without that accesskey -> Vitre acts", a.join() === "focusAddress[page-first/reply]", { actions: a, page: await seen() });
    a = await key("Alt+G");
    check("B5 Alt+G (page accesskey=g, not a Vitre key) clicks the page's button", (await seen()).includes("accesskey-click"), { actions: a, page: await seen() });

    // ---------------------------------------------------------------- C. editing in a page field
    spike.log("--- C. editing keys in a page <input> (value starts 'hello world')");
    await go("");
    await pageFocus("field");
    KS.press("Ctrl+A"); KS.EU.sendString("abc def", window);
    await spike.sleep(200);
    let v1 = await fieldValue();
    KS.press("Ctrl+Backspace");
    await spike.sleep(150);
    let v2 = await fieldValue();
    KS.press("Ctrl+Z");
    await spike.sleep(150);
    let v3 = await fieldValue();
    KS.press("Ctrl+Y");
    await spike.sleep(150);
    let v3b = await fieldValue();
    KS.press("Home"); KS.press("Shift+End"); KS.press("Delete");
    await spike.sleep(150);
    let v4 = await fieldValue();
    check("C1 Ctrl+A + typing, Ctrl+Backspace, Ctrl+Z, Ctrl+Y, Shift+End, Delete all edit", v1 === "abc def" && v2 === "abc " && v3 === "abc def" && v3b === "abc " && v4 === "", { v1, v2, v3, v3b, v4 });
    // clipboard round trip (restores the previous clipboard text afterwards)
    const clip = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
    const readClip = () => { try { const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable); t.init(null); t.addDataFlavor("text/plain"); Services.clipboard.getData(t, Services.clipboard.kGlobalClipboard); const o = {}; t.getTransferData("text/plain", o); return o.value.QueryInterface(Ci.nsISupportsString).data; } catch (e) { return null; } };
    const oldClip = readClip();
    KS.EU.sendString("vitre-clip", window);
    await spike.sleep(100);
    KS.press("Ctrl+A"); KS.press("Ctrl+X");
    await spike.sleep(250);
    const afterCut = await fieldValue();
    const clipText = readClip();
    KS.press("Ctrl+V"); KS.press("Ctrl+V");
    await spike.sleep(250);
    const afterPaste = await fieldValue();
    if (oldClip !== null) clip.copyString(oldClip);
    check("C2 Ctrl+X cuts to the clipboard, Ctrl+V pastes (page field)", afterCut === "" && clipText === "vitre-clip" && afterPaste === "vitre-clipvitre-clip", { afterCut, clipText, afterPaste });
    a = await key("Escape");
    check("C3 Escape in a page field still routes page-first (nothing consumed it)", a.join() === "escape[page-first/reply]", a);

    // ---------------------------------------------------------------- D. repeat, AltGr, Ctrl+Alt, IME
    spike.log("--- D. guards");
    await go("");
    a = await key("Ctrl+W", { repeat: 4 });
    check("D1 Ctrl+W held (4 keydowns): one action, repeats swallowed, page sees nothing", a.join() === "closeTab[browser-first]" && !(await seen()).join().includes("ctrl-w"), { actions: a, page: await seen() });
    a = await key("Ctrl+T", { repeat: 3 });
    check("D2 Ctrl+T held (3 keydowns): repeat allowed -> 3 actions", a.length === 3, a);
    a = await key("Ctrl+J", { repeat: 3 });
    check("D3 page-first Ctrl+J held (3 keydowns): one action; the page sees the repeats (Gecko may drop some repeats when the page is busy)", a.length === 1 && (await seen()).filter((s) => s.startsWith("d:ctrl-j")).length >= 2 && (await seen()).includes("d:ctrl-jR"), { actions: a, page: await seen() });
    a = await key("Ctrl+Alt+T");
    const b1 = await key("Ctrl+Alt+Tab");
    const b2 = await key("Ctrl+Alt+Left");
    check("D4 Ctrl+Alt chords never match (Ctrl+Alt+T, Ctrl+Alt+Tab, Ctrl+Alt+Left) and reach the page", a.length + b1.length + b2.length === 0 && (await seen()).join().includes("d:ctrl-alt-t"), { a, b1, b2, page: await seen() });
    const rec = [];
    const tapFn = (e) => rec.push(e.key + " ctrl=" + e.ctrlKey + " alt=" + e.altKey + " AltGraph=" + e.getModifierState("AltGraph"));
    window.addEventListener("keydown", tapFn, true);
    a = await key("AltGr+q");
    const b3 = await key("AltGr+d");
    window.removeEventListener("keydown", tapFn, true);
    check("D5 AltGr+Q / AltGr+D: getModifierState('AltGraph') is true, nothing fires, page gets the key", a.length + b3.length === 0 && rec.some((r) => r.includes("AltGraph=true")) && (await seen()).some((s) => s.includes("G")), { chromeSaw: rec, page: await seen() });

    // IME: start a composition in the page field, then press shortcut keys while composing
    await go("");
    await pageFocus("field");
    const imeRec = [];
    const imeTap = (e) => imeRec.push(e.type + " key=" + e.key + " kc=" + e.keyCode + " isComposing=" + e.isComposing + " guarded=" + VitreKeys.guarded(e));
    window.addEventListener("keydown", imeTap, true);
    KS.EU.synthesizeCompositionChange({ composition: { string: "あ", clauses: [{ length: 1, attr: Ci.nsITextInputProcessor.ATTR_RAW_CLAUSE }] }, caret: { start: 1, length: 0 } }, window);
    await spike.sleep(200);
    actions.length = 0;
    KS.press("Ctrl+T"); KS.press("Ctrl+W"); KS.press("F6"); KS.press("Ctrl+L"); KS.press("Escape");
    await spike.sleep(400);
    const imeActions = actions.slice();
    KS.EU.synthesizeComposition({ type: "compositioncommitasis", key: { key: "KEY_Enter" } }, window);
    await spike.sleep(200);
    window.removeEventListener("keydown", imeTap, true);
    const imeValue = await fieldValue();
    a = await key("Ctrl+T");
    check("D6 during IME composition no shortcut fires (Ctrl+T, Ctrl+W, F6, Ctrl+L, Esc); after commit they work again", imeActions.length === 0 && a.length === 1, { duringComposition: imeActions, chromeSaw: imeRec, fieldAfterCommit: imeValue, page: (await seen()).slice(-14) });

    // ---------------------------------------------------------------- E. Ctrl keyup with focus in the page (switcher)
    spike.log("--- E. Ctrl+Tab hold and release");
    await go("");
    ctrlUps = [];
    actions.length = 0;
    const t0 = Math.round(performance.now());
    KS.down("Control");
    await spike.sleep(30);
    KS.press("Tab");
    await spike.sleep(300);
    KS.press("Tab");
    await spike.sleep(100);
    KS.press("Shift+Tab");
    await spike.sleep(100);
    KS.up("Control");
    await spike.sleep(300);
    check("E1 Control down, Tab, Tab, Shift+Tab, Control up with focus in a remote page: chrome gets 3 switcher steps and the Ctrl keyup; the page sees Control down/up but no Tab",
      actions.join() === "switcherNext[browser-first],switcherNext[browser-first],switcherPrev[browser-first]" && ctrlUps.filter((u) => u.startsWith("ctrl-up")).length === 1 && !(await seen()).join().includes("tab") && (await seen()).join().includes("d:ctrl-control") && (await seen()).join().includes("u:control"),
      { actions: actions.slice(), ctrlUps, t0, page: await seen() });
    a = await key("Tab");
    check("E2 plain Tab afterwards is not swallowed (goes to the page)", a.length === 0 && (await seen()).includes("d:tab"), { page: (await seen()).slice(-3) });

    // ---------------------------------------------------------------- F. focus in Vitre's own HTML field
    spike.log("--- F. focus in a Vitre HTML input (chrome document)");
    const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    input.id = "vitre-field";
    input.style.cssText = "position:fixed;left:300px;top:120px;width:400px;height:32px;z-index:9999;font:15px Segoe UI;padding:0 10px;border:2px solid #36c;border-radius:16px;";
    document.documentElement.appendChild(input);
    input.focus();
    input.value = "hello world";
    input.select();
    await spike.sleep(150);
    KS.EU.sendString("abc def", window);
    KS.press("Ctrl+Backspace");
    const c1 = input.value;
    KS.press("Ctrl+Z");
    const c2 = input.value;
    KS.press("Ctrl+A"); KS.press("Delete");
    const c3 = input.value;
    KS.press("Ctrl+Z");
    const c4 = input.value;
    KS.press("Ctrl+Shift+Z");
    const c5 = input.value;
    KS.EU.sendString("x", window);
    KS.press("Shift+Left"); KS.press("Ctrl+C"); KS.press("Right"); KS.press("Ctrl+V");
    const c6 = input.value;
    if (oldClip !== null) clip.copyString(oldClip);
    check("F1 editing keys work in a chrome <html:input> with every <key> parked (typing, Ctrl+Backspace, Ctrl+Z, Ctrl+A, Delete, Ctrl+Shift+Z, Ctrl+C/V)", c1 === "abc " && c2 === "abc def" && c3 === "" && c4 === "abc def" && c5 === "" && c6 === "xx", { c1, c2, c3, c4, c5, c6 });
    a = await key("Ctrl+L");
    const f2 = await key("Ctrl+T");
    const f3 = await key("Ctrl+R");
    check("F2 from a Vitre field, page-first keys go straight to Vitre (how=local) and browser-first still work", a.join() === "focusAddress[page-first/local]" && f2.join() === "newTab[browser-first]" && f3.join() === "reload[page-first/local]", { L: a, T: f2, R: f3 });
    // a local widget that handles a key itself (stopPropagation / preventDefault) keeps it
    const own = (e) => { if (e.key === "Escape") { e.preventDefault(); } };
    input.addEventListener("keydown", own);
    a = await key("Escape");
    input.removeEventListener("keydown", own);
    const f5 = await key("Escape");
    check("F3 a Vitre widget that preventDefaults Esc on keydown keeps it; otherwise the router gets it", a.length === 0 && f5.join() === "escape[page-first/local]", { handledByWidget: a, unhandled: f5 });
    await spike.capture("03-vitre-field");
    input.remove();

    // ---------------------------------------------------------------- G. in-process page (not remote)
    spike.log("--- G. in-process page");
    await KS.load("about:config");
    gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    spike.log("about:config isRemoteBrowser=" + gBrowser.selectedBrowser.isRemoteBrowser + " remoteType=" + gBrowser.selectedBrowser.remoteType);
    a = await key("Ctrl+L");
    const g2 = await key("Ctrl+T");
    check("G1 non-remote <browser>: page-first via the bubble path, browser-first as usual", a.length === 1 && g2.join() === "newTab[browser-first]", { L: a, T: g2 });

    // ---------------------------------------------------------------- H. extension keysets stay alive, Vitre wins conflicts
    spike.log("--- H. extension-style keyset");
    await go("");
    const extFired = [];
    const ks = document.createXULElement("keyset");
    ks.id = "ext-keyset-id-fake_example_org";
    for (const [id, k, mods] of [["ext-l", "L", "accel"], ["ext-y", "Y", "accel,shift"], ["ext-t", "T", "accel"]]) {
      const el = document.createXULElement("key");
      el.id = id; el.setAttribute("key", k); el.setAttribute("modifiers", mods);
      el.addEventListener("command", () => extFired.push(id));
      ks.appendChild(el);
    }
    document.getElementById("mainKeyset").parentNode.appendChild(ks);
    await spike.sleep(200);
    a = await key("Ctrl+Shift+Y");
    const h1 = extFired.slice();
    extFired.length = 0;
    const h2 = await key("Ctrl+L");
    const h2e = extFired.slice();
    extFired.length = 0;
    const h3 = await key("Ctrl+T");
    const h3e = extFired.slice();
    check("H1 an extension command on a free chord (Ctrl+Shift+Y) still fires; on Vitre chords (Ctrl+L page-first, Ctrl+T browser-first) only Vitre fires",
      h1.join() === "ext-y" && a.length === 0 && h2.length === 1 && h2e.length === 0 && h3.length === 1 && h3e.length === 0, { freeChord: h1, CtrlL: { vitre: h2, ext: h2e }, CtrlT: { vitre: h3, ext: h3e } });
    ks.remove();
    // a non-extension keyset that shows up later (DevTools, CustomKeys, future Firefox code) is parked by the observer
    const late = document.createXULElement("keyset");
    late.id = "someLateFirefoxKeyset";
    const lk = document.createXULElement("key");
    lk.id = "late-y"; lk.setAttribute("key", "Y"); lk.setAttribute("modifiers", "accel,shift");
    lk.addEventListener("command", () => extFired.push("late-y"));
    late.appendChild(lk);
    document.getElementById("mainKeyset").parentNode.appendChild(late);
    await spike.sleep(300);
    extFired.length = 0;
    await key("Ctrl+Shift+Y");
    check("H2 a keyset added later by Firefox code is parked by the MutationObserver: its key no longer fires, the element still resolves", extFired.length === 0 && lk.parentNode.id === "vitre-dead-keys" && document.getElementById("late-y") === lk, { fired: extFired.slice(), parent: lk.parentNode.id });

    // ---------------------------------------------------------------- I. keyboard layouts (key label vs physical code)
    spike.log("--- I. layouts");
    await go("");
    const syn = async (key, opts) => { actions.length = 0; KS.EU.synthesizeKey(key, opts, window); await spike.sleep(300); return actions.slice(); };
    const i1 = await syn("е", { ctrlKey: true, code: "KeyT", keyCode: KeyboardEvent.DOM_VK_T }); // Russian: physical T types "е"
    const i2 = await syn("t", { ctrlKey: true, code: "KeyK", keyCode: KeyboardEvent.DOM_VK_T }); // Dvorak: physical K is labelled T
    const i3 = await syn("&", { ctrlKey: true, code: "Digit1", keyCode: KeyboardEvent.DOM_VK_1 }); // AZERTY: digit row unshifted
    const i4 = await syn("-", { ctrlKey: true, code: "Digit6", keyCode: KeyboardEvent.DOM_VK_6 }); // AZERTY: the 6 key types "-"
    const i5 = await syn("a", { ctrlKey: true, code: "KeyQ", keyCode: KeyboardEvent.DOM_VK_A }); // AZERTY: physical Q is labelled A (unbound)
    const i6 = await syn("q", { ctrlKey: true, code: "KeyA", keyCode: KeyboardEvent.DOM_VK_Q }); // AZERTY: physical A is labelled Q -> Ctrl+Q
    check("I1 letters match by label with fallback to the physical key; digits by physical key; zoom wins where a digit key types '-'",
      i1.join() === "newTab[browser-first]" && i2.join() === "newTab[browser-first]" && i3.join() === "goTab(1)[page-first/reply]" && i4.join() === "zoomOut[page-first/reply]" && i5.length === 0 && i6.join() === "peekLink[page-first/reply]",
      { "Ctrl+е (Russian, physical T)": i1, "Ctrl+t (Dvorak, physical K)": i2, "Ctrl+& (AZERTY Digit1)": i3, "Ctrl+- (AZERTY Digit6)": i4, "Ctrl+a (AZERTY physical Q)": i5, "Ctrl+q (AZERTY physical A)": i6 });

    // ---------------------------------------------------------------- J. focus inside a cross-site (out-of-process) iframe
    spike.log("--- J. out-of-process iframe");
    await go("iframe=" + encodeURIComponent("https://example.org/"));
    await spike.sleep(1500);
    const frameFocused = await KS.inPage(function (w, d) { d.getElementById("frame").contentWindow.focus(); return d.activeElement.id; });
    await spike.sleep(400);
    const frameBC = gBrowser.selectedBrowser.browsingContext.children[0];
    const focusedBC = Services.focus.focusedContentBrowsingContext;
    spike.log("frame browsingContext " + (frameBC && frameBC.id) + ", focused content browsingContext " + (focusedBC && focusedBC.id) + ", top " + gBrowser.selectedBrowser.browsingContext.id);
    const procs = gBrowser.selectedBrowser.browsingContext.children.map((c) => c.currentWindowGlobal && c.currentWindowGlobal.osPid);
    const topPid = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.osPid;
    const before = (await seen()).length;
    const j1 = await key("Ctrl+L");
    const j2 = await key("Ctrl+T");
    const j3 = await key("Escape");
    check("J1 focus in an out-of-process iframe: page-first keys still come back as a reply, browser-first still taken; the parent page does not see keys typed in the frame",
      frameFocused === "frame" && focusedBC === frameBC && procs.length === 1 && procs[0] !== topPid && j1.join() === "focusAddress[page-first/reply]" && j2.join() === "newTab[browser-first]" && j3.join() === "escape[page-first/reply]" && (await seen()).length === before,
      { frameFocused, topPid, framePid: procs, L: j1, T: j2, Esc: j3, parentPageSawNew: (await seen()).slice(before) });

    // ---------------------------------------------------------------- K. state-dependent priority
    spike.log("--- K. priorityOf hook");
    let inFullScreen = false, lastEsc = 0, peekOpen = true;
    VitreKeys.install({
      onAction: (a, arg, info) => actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + (info.event.repeat ? ",repeat" : "") + "]"),
      log: (m) => routerLog.push(m),
      priorityOf: (b, e) => {
        if (b.action === "fullscreen" && inFullScreen) return "browser"; // F11 always leaves full screen
        if (b.action === "escape" && peekOpen && !e.repeat) { // Esc Esc within 400 ms closes a peek even if the page uses Esc
          const now = performance.now(), second = now - lastEsc < 400;
          lastEsc = second ? 0 : now;
          if (second) return "browser";
        }
        return undefined;
      },
    });
    await go("prevent=*");
    const k1 = await key("F11");
    inFullScreen = true;
    const k2 = await key("F11");
    inFullScreen = false;
    await spike.sleep(500);
    const k3 = await key("Escape");
    await spike.sleep(500);
    actions.length = 0;
    KS.press("Escape"); await spike.sleep(120); KS.press("Escape");
    await spike.sleep(350);
    const k4 = actions.slice();
    check("K1 on a page that prevents every key: F11 to enter is the page's, F11 to leave is browser-first; one Esc is the page's, Esc Esc within 400 ms reaches Vitre",
      k1.length === 0 && k2.join() === "fullscreen[browser-first]" && k3.length === 0 && k4.join() === "escape[browser-first]", { enterF11: k1, leaveF11: k2, singleEsc: k3, doubleEsc: k4, page: (await seen()).slice(-8) });

    spike.log("activeWindow at end:", Services.focus.activeWindow === window, "| RESULT pass=" + pass + " fail=" + fail);
    await go("prevent=ctrl-k");
    KS.press("Ctrl+K"); KS.press("Ctrl+L"); KS.press("Ctrl+T");
    await spike.sleep(300);
    await spike.capture("03-page");
  });
}
