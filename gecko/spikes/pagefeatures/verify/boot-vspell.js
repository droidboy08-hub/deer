// Verify: spelling suggestions in the context menu (claims 19/20/21). The spike's own final log shows
// misspelling "" for both the contenteditable and the textarea, so find out whether the inline
// spellchecker runs at all in this runtime, what it needs, and whether the menu then gets suggestions.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreMenu, InlineSpellCheckerUI, gContextMenu */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    VitreMenu.install();
    VitreMenu.closeOnBlur = false;

    const engine = Cc["@mozilla.org/spellchecker/engine;1"].getService(Ci.mozISpellCheckingEngine);
    spike.log("PARENT dictionaries", engine.getDictionaryList(), "layout.spellcheckDefault", Services.prefs.getIntPref("layout.spellcheckDefault"),
      "spellchecker.dictionary", Services.prefs.getStringPref("spellchecker.dictionary", "(unset)"), "locale", Services.locale.appLocaleAsBCP47);
    const w32 = v.win32();
    spike.log("WINDOW focus manager active", Services.focus.activeWindow === window, "OS foreground", w32.isForeground());

    const probe = (id) =>
      pf.inContent(b, (w, id) => {
        const el = w.document.getElementById(id);
        const out = { focus: w.document.hasFocus(), active: w.document.activeElement && w.document.activeElement.id };
        try {
          const ed = el.editor || w.docShell.editingSession.getEditorForWindow(w);
          const isc = ed.getInlineSpellChecker(false);
          out.hasChecker = !!isc;
          if (isc) {
            out.enabled = isc.enableRealTimeSpell;
            out.pending = isc.spellCheckPending;
            try {
              out.dicts = isc.spellChecker.getCurrentDictionaries();
            } catch (e) {
              out.dictErr = String(e).slice(0, 80);
            }
          }
          out.ranges = ed.selectionController.getSelection(Ci.nsISelectionController.SELECTION_SPELLCHECK).rangeCount;
        } catch (e) {
          out.err = String(e).slice(0, 120);
        }
        return out;
      }, id);

    spike.log("ACTIVATE (focusmanager.testmode=" + Services.prefs.getBoolPref("focusmanager.testmode", false) + ")", await v.activate());
    spike.log("TEXTAREA before focus", await probe("ta"));
    // Focus the textarea at its end (caret away from the typo), as a user would.
    let r = await pf.rectOf(b, "#ta");
    pf.mouse(r.x + r.w - 30, r.y + r.h - 10, {});
    for (let i = 0; i < 6; i++) {
      await spike.sleep(700);
      const p = await probe("ta");
      spike.log("TEXTAREA +" + (i + 1) * 700 + "ms", p);
      if (p.ranges) break;
    }
    await spike.capture("spell-textarea-focused");

    // right-click on the misspelled word
    pf.rightClick(r.x + 50, r.y + 22);
    await pf.until(() => VitreMenu.isOpen, 4000);
    let d = VitreMenu.lastContext;
    spike.log("TEXTAREA menu", VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label), { misspelling: d.misspelling, suggestions: d.suggestions, spellcheckable: d.spellcheckable },
      "InlineSpellCheckerUI", { enabled: InlineSpellCheckerUI.enabled, canSpellCheck: InlineSpellCheckerUI.canSpellCheck, over: InlineSpellCheckerUI.overMisspelling }, "spellInfo", gContextMenu && gContextMenu.contentData.spellInfo);
    await spike.capture("spell-textarea-menu");
    if (d.misspelling) {
      const first = VitreMenu.current.rowItems[0];
      const rr = VitreMenu.current.rows[0].getBoundingClientRect();
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
      await pf.until(() => !VitreMenu.isOpen, 3000);
      await spike.sleep(300);
      spike.log("TEXTAREA replaced with", first.label, "->", await pf.inContent(b, (w) => w.document.getElementById("ta").value));
    } else VitreMenu.close("test");

    // contenteditable: focus at the end, then right-click the word
    spike.log("ACTIVATE", await v.activate(), "OS foreground", w32.isForeground());
    r = await pf.rectOf(b, "#ce");
    pf.mouse(r.x + r.w - 20, r.cy, {});
    for (let i = 0; i < 6; i++) {
      await spike.sleep(700);
      const p = await probe("ce");
      spike.log("CONTENTEDITABLE +" + (i + 1) * 700 + "ms", p);
      if (p.ranges) break;
    }
    r = await pf.rectOf(b, "#miss");
    pf.rightClick(r.cx, r.cy);
    await pf.until(() => VitreMenu.isOpen, 4000);
    d = VitreMenu.lastContext;
    spike.log("CONTENTEDITABLE menu", VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label), { misspelling: d.misspelling, suggestions: d.suggestions });
    await spike.capture("spell-ce-menu");
    if (d.misspelling) {
      const first = VitreMenu.current.rowItems[0];
      const rr = VitreMenu.current.rows[0].getBoundingClientRect();
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
      await pf.until(() => !VitreMenu.isOpen, 3000);
      await spike.sleep(300);
      spike.log("CONTENTEDITABLE replaced with", first.label, "->", JSON.stringify(await pf.inContent(b, (w) => w.document.getElementById("ce").textContent)));
    } else VitreMenu.close("test");

    // The spike's order: click INSIDE the word first (caret in the word), wait, right-click.
    await pf.inContent(b, (w) => w.location.reload());
    await spike.sleep(1500);
    await spike.loaded();
    spike.log("ACTIVATE", await v.activate(), "OS foreground", w32.isForeground());
    r = await pf.rectOf(b, "#miss");
    pf.mouse(r.cx, r.cy, {});
    await spike.sleep(1500);
    spike.log("SPIKE ORDER (click in the word first) probe", await probe("ce"));
    pf.rightClick(r.cx, r.cy);
    await pf.until(() => VitreMenu.isOpen, 4000);
    d = VitreMenu.lastContext;
    spike.log("SPIKE ORDER menu", { misspelling: d.misspelling, suggestions: d.suggestions });
    VitreMenu.close("test");
  });
