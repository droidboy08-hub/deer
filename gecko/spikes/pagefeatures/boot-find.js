// Find in page with Vitre's own field (no native findbar), driven by browser.finder.
/* global Services, Ci, gBrowser, spike, pf, VitreFind */
for (const f of ["common.js", "vitre-find.js", "vitre-actors.js"]) Services.scriptloader.loadSubScript("resource://vitre-boot/" + f, window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const nativeBar = () => ({ initialized: gBrowser.isFindBarInitialized(), elements: document.querySelectorAll("findbar").length });

    VitreFind.install();
    spike.log("native findbar at start", nativeBar());

    const st = VitreFind.stateFor(b);
    const counter = () => (st.ui ? st.ui.count.textContent : null);
    // Do something, then wait for the finder's callbacks that follow it.
    const act = async (fn, want = "count:") => {
      const n = st.events.length;
      await fn();
      await pf.until(() => st.events.slice(n).some((e) => e.startsWith(want) || e === "result:" + Ci.nsITypeAheadFind.FIND_NOTFOUND), 5000);
      await spike.sleep(120);
      return counter();
    };
    const setQuery = async (q) => {
      st.ui.field.focus();
      st.ui.field.select();
      return act(() => (q ? pf.type(q) : pf.key("KEY_Backspace")));
    };

    // ---- open with the real shortcut: focus is in the page, Ctrl+F goes page-first then to chrome
    const r0 = await pf.rectOf(b, "#p1");
    pf.mouse(r0.x + 5, r0.y + 5, {});
    await spike.sleep(200);
    pf.key("f", { accelKey: true });
    await pf.until(() => VitreFind.active, 3000);
    spike.log("CTRL+F opened Vitre find", !!VitreFind.active, "field focused", document.activeElement === st.ui?.field, "native", nativeBar());
    await spike.capture("find-empty");

    // ---- incremental search, counts
    let c = await setQuery("glass");
    spike.log("QUERY glass ->", c, "state", { current: st.current, total: st.total, limit: st.limit, result: st.result, rect: st.rect });
    await spike.capture("find-1-of-13");
    c = await act(() => pf.key("KEY_Enter"));
    c = await act(() => pf.key("KEY_Enter"));
    spike.log("ENTER x2 ->", c);
    const scroll1 = await pf.inContent(b, (w) => [w.scrollX, w.scrollY]);
    spike.log("RING box", VitreFind.ring(st, scroll1[0], scroll1[1]), "rect (document px)", st.rect, "scroll", scroll1);
    await spike.capture("find-3-of-13");
    for (const r of document.querySelectorAll(".vf-ring")) r.remove();

    // Gecko swapped the yellow highlight to yellow-on-black above (contrast guard against the light
    // page). The VitrePage actor pins the colours per document with Selection.setColors().
    spike.log("ACTOR registered", VitreActors.register(await VitreActors.installToProfile()));
    VitreActors.broadcast(b, "Vitre:Ping"); // documents that were already loaded
    await spike.sleep(400);
    await setQuery("glass");
    c = await act(() => pf.key("KEY_Enter"));
    c = await act(() => pf.key("KEY_Enter"));
    spike.log("with pinned colours ->", c);
    await spike.capture("find-pinned-colours");
    c = await act(() => pf.key("KEY_Enter", { shiftKey: true }));
    spike.log("SHIFT+ENTER ->", c);
    c = await act(() => pf.key("KEY_F3"));
    spike.log("F3 in field ->", c);
    // click the chevrons (they must not steal focus)
    const nx = st.ui.next.getBoundingClientRect();
    c = await act(() => pf.mouse(nx.left + 14, nx.top + 14, {}));
    spike.log("NEXT button ->", c, "field still focused", document.activeElement === st.ui.field);

    // highlight-all + colours as seen by the page
    const hl = await pf.inContent(b, (w) => {
      const sc = w.docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay).QueryInterface(Ci.nsISelectionController);
      const find = sc.getSelection(Ci.nsISelectionController.SELECTION_FIND);
      const att = sc.getSelection(Ci.nsISelectionController.SELECTION_ATTENTION);
      return { findRanges: find.rangeCount, attentionRanges: att.rangeCount, normal: w.getSelection().toString(), displaySelection: sc.getDisplaySelection() };
    });
    spike.log("HIGHLIGHT ranges in the top frame", hl);

    // walk to the last match: it is inside the iframe
    let guard = 0;
    while (st.current !== st.total && guard++ < 20) await act(() => pf.key("KEY_Enter"));
    spike.log("LAST match", counter(), "rect", st.rect);
    await spike.capture("find-in-frame");
    c = await act(() => pf.key("KEY_Enter"));
    spike.log("WRAP ->", c, "wrapped flag", st.wrapped);

    // ---- match case
    c = await act(() => pf.key("c", { altKey: true }));
    spike.log("MATCH CASE on (Alt+C), query glass ->", c, "pressed", st.ui.aa.getAttribute("aria-pressed"));
    c = await setQuery("Glass");
    spike.log("MATCH CASE on, query Glass ->", c);
    await spike.capture("find-match-case");
    c = await act(() => pf.key("c", { altKey: true }));
    spike.log("MATCH CASE off, query Glass ->", c);

    // ---- no matches
    c = await act(() => pf.type("zz"), "result:");
    spike.log("QUERY Glasszz ->", JSON.stringify(c), "prev disabled", st.ui.prev.disabled);
    await spike.capture("find-no-matches");

    // ---- keys in the field scroll the page
    await setQuery("glass");
    const y0 = await pf.inContent(b, (w) => w.scrollY);
    pf.key("KEY_PageDown");
    await spike.sleep(500);
    const y1 = await pf.inContent(b, (w) => w.scrollY);
    spike.log("PAGEDOWN in field scrolls the page", y0, "->", y1, "field still focused", document.activeElement === st.ui.field);

    // ---- close: highlights go, the match stays selected, focus returns to the page
    await setQuery("counter page");
    spike.log("QUERY counter page ->", counter(), "linkURL", st.linkURL);
    pf.key("KEY_Escape");
    await spike.sleep(400);
    const closed = await pf.inContent(b, (w) => {
      const sc = w.docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay).QueryInterface(Ci.nsISelectionController);
      return {
        findRanges: sc.getSelection(Ci.nsISelectionController.SELECTION_FIND).rangeCount,
        selection: w.getSelection().toString(),
        activeElement: w.document.activeElement && (w.document.activeElement.id || w.document.activeElement.localName),
      };
    });
    spike.log("ESC closed", !VitreFind.active, "pill hidden", st.ui.pill.hidden, "page state", closed, "chrome focus", document.activeElement && document.activeElement.localName);
    await spike.capture("find-closed");

    // ---- typing in the page still works after find was used (content is not stuck passing keys)
    const ri = await pf.rectOf(b, "#inp");
    pf.mouse(ri.x + ri.w - 10, ri.cy, {});
    await spike.sleep(150);
    pf.key("KEY_End");
    pf.type("xyz");
    await spike.sleep(200);
    spike.log("TYPING in a page field after find", await pf.inContent(b, (w) => w.document.getElementById("inp").value));

    // ---- quick find keys do nothing: "/" and "'" reach the page, no native findbar appears
    const rp = await pf.rectOf(b, "#p3");
    pf.mouse(rp.x + 5, rp.y + 5, {});
    await spike.sleep(150);
    pf.type("/");
    pf.type("'");
    pf.type("gl");
    await spike.sleep(600);
    spike.log("QUICK FIND keys: page lastKey", await pf.inContent(b, (w) => w.document.documentElement.dataset.lastKey), "native", nativeBar(), "vitre open", !!VitreFind.active);

    // ---- F3 with find closed: reopens parked with the last query and steps
    pf.key("KEY_F3");
    await pf.until(() => VitreFind.active, 3000);
    await spike.sleep(500);
    await pf.until(() => st.events.slice(-3).some((e) => e.startsWith("count:")), 3000);
    spike.log("F3 while closed reopened", !!VitreFind.active, "query", st.ui.field.value, "counter", counter(), "field focused", document.activeElement === st.ui.field);
    pf.key("KEY_Escape");
    await spike.sleep(300);

    // ---- pre-fill from the page selection
    await pf.inContent(b, (w) => {
      const t = w.document.getElementById("p1").firstChild;
      const i = t.data.indexOf("surface tension");
      const range = w.document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + 15);
      const s = w.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    });
    pf.key("f", { accelKey: true });
    await pf.until(() => VitreFind.active && st.ui.field.value === "surface tension", 3000);
    await spike.sleep(400);
    spike.log("PREFILL from selection ->", JSON.stringify(st.ui.field.value), "counter", counter(), "selected in field", st.ui.field.selectionStart, st.ui.field.selectionEnd);
    await spike.capture("find-prefill");

    // ---- Ctrl+Enter: close and follow the match's link
    await setQuery("counter page");
    pf.key("KEY_Enter", { accelKey: true });
    const nav = await pf.until(() => b.currentURI.spec.includes("counter.html"), 5000);
    spike.log("CTRL+ENTER followed the link", !!nav, b.currentURI.spec);

    // ---- the count limit: "1 of N+"
    Services.prefs.setIntPref("accessibility.typeaheadfind.matchesCountLimit", 5);
    const t2 = gBrowser.addTrustedTab(pf.base + "article.html");
    gBrowser.selectedTab = t2;
    await pf.browserLoaded(t2.linkedBrowser, "article");
    await spike.sleep(500);
    const st2 = VitreFind.open(t2.linkedBrowser, { query: "glass" });
    await pf.until(() => st2.events.some((e) => e.startsWith("count:")), 5000);
    await spike.sleep(200);
    spike.log("LIMIT 5, page with a subframe ->", JSON.stringify(st2.ui.count.textContent), "raw", { current: st2.current, total: st2.total, limit: st2.limit }, "(raw total is -1 from the top frame plus 1 from the iframe)");
    await spike.capture("find-limit");
    const t3 = gBrowser.addTrustedTab(pf.base + "second.html");
    gBrowser.selectedTab = t3;
    await pf.browserLoaded(t3.linkedBrowser, "second");
    await spike.sleep(500);
    const st3 = VitreFind.open(t3.linkedBrowser, { query: "e" });
    await pf.until(() => st3.events.some((e) => e.startsWith("count:")), 5000);
    await spike.sleep(200);
    spike.log("LIMIT 5, page without frames ->", JSON.stringify(st3.ui.count.textContent), "raw", { current: st3.current, total: st3.total, limit: st3.limit });
    spike.log("native findbar at end", nativeBar());
  });
