// Verify the repair for the stuck counter (boot-vfind4.js): ignore a 0/0 count that arrives for a
// FOUND result, and ask again once things are quiet (finder.requestMatchesCount).
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    VitreFind.install();
    const NOTFOUND = Ci.nsITypeAheadFind.FIND_NOTFOUND;

    /** The patch an implementer would fold into the find module's listener. */
    function patch(st) {
      const L = st.listener;
      const origCount = L.onMatchesCountResult;
      const origResult = L.onFindResult;
      let timer = 0;
      const ask = () => {
        clearTimeout(timer);
        timer = setTimeout(() => st.open && st.query && st.result !== NOTFOUND && st.browser.finder.requestMatchesCount(st.query, { linksOnly: false }), 120);
      };
      L.onFindResult = (d) => {
        origResult(d);
        if (d.result !== NOTFOUND) ask(); // one authoritative count after the last result of a burst
      };
      L.onMatchesCountResult = (r) => {
        if (r.total === 0 && st.result !== NOTFOUND) return; // superseded request: not a real count
        origCount(r);
      };
    }

    const raw = (st) => ({ text: st.ui && st.ui.count.textContent, current: st.current, total: st.total });
    const exercise = async (br, label, expectTotal) => {
      const st = VitreFind.stateFor(br);
      patch(st);
      VitreFind.open(br, { query: "glass" });
      await spike.sleep(1500);
      spike.log(label, "query glass ->", raw(st));
      let wrongFrames = 0;
      const obs = new MutationObserver(() => { if (/\+$/.test(st.ui.count.textContent)) wrongFrames++; });
      obs.observe(st.ui.count, { childList: true, characterData: true, subtree: true });
      for (const burst of [2, 3, 6]) {
        for (let i = 0; i < burst; i++) pf.key("KEY_Enter");
        await spike.sleep(1500);
        spike.log(label, burst + " x Enter with no pause ->", raw(st));
      }
      for (let i = 0; i < 30; i++) {
        pf.key("KEY_Enter");
        await spike.sleep(30);
      }
      await spike.sleep(1500);
      spike.log(label, "30 x Enter at 30 ms ->", raw(st), "times the counter showed an 'N+' text", wrongFrames, "expected total", expectTotal);
      st.ui.field.select();
      pf.type("zzqx");
      await spike.sleep(1200);
      spike.log(label, "no-match query ->", raw(st));
      obs.disconnect();
      await spike.capture("vfind5-" + label.toLowerCase());
      VitreFind.close(br);
    };

    await v.activate();
    // the spike's own page first (13 matches, one in a frame)
    await exercise(gBrowser.selectedBrowser, "LOCAL", 13);
    // the limit case must still read as "limit+"
    Services.prefs.setIntPref("accessibility.typeaheadfind.matchesCountLimit", 5);
    const st0 = VitreFind.open(gBrowser.selectedBrowser, { query: "glass" });
    await spike.sleep(1500);
    spike.log("LOCAL limit 5 (page with a frame: Gecko sums -1 and 1) ->", raw(st0), "(a real limit hit that the patch cannot tell from a superseded 0/0: shows the previous text)");
    VitreFind.close(gBrowser.selectedBrowser);
    Services.prefs.clearUserPref("accessibility.typeaheadfind.matchesCountLimit");

    const t = gBrowser.addTrustedTab("https://en.wikipedia.org/wiki/Float_glass");
    gBrowser.selectedTab = t;
    const br = t.linkedBrowser;
    const ok = await pf.until(() => !br.webProgress?.isLoadingDocument && br.currentURI.spec.includes("wikipedia"), 25000, 200);
    await spike.sleep(1500);
    if (!ok) return spike.log("wikipedia did not load");
    await v.activate();
    await exercise(br, "WIKIPEDIA", 130);
  });
