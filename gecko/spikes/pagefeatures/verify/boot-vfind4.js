// Verify: rapid Enter presses (two findAgain calls with no pause) on a long page. In boot-vpeek2.js the
// counter was left at "1 of 1,000+" on a page with 130 matches.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    VitreFind.install();
    const url = "https://en.wikipedia.org/wiki/Float_glass";
    const t = gBrowser.addTrustedTab(url);
    gBrowser.selectedTab = t;
    const br = t.linkedBrowser;
    const ok = await pf.until(() => !br.webProgress?.isLoadingDocument && br.currentURI.spec.includes("wikipedia"), 25000, 200);
    await spike.sleep(1500);
    if (!ok) return spike.log("wikipedia did not load");
    await v.activate();
    const raw = (st) => ({ text: st.ui && st.ui.count.textContent, current: st.current, total: st.total, limit: st.limit, result: st.result });
    const st = VitreFind.open(br, { query: "glass" });
    await spike.sleep(1500);
    spike.log("query glass ->", raw(st));
    for (const burst of [2, 3, 6]) {
      st.events.length = 0;
      for (let i = 0; i < burst; i++) pf.key("KEY_Enter"); // no pause: key repeat or a fast double press
      await spike.sleep(2500);
      spike.log(burst + " x Enter with no pause -> events", st.events.slice(), "shown", raw(st));
      if (st.total <= 0) {
        await spike.capture("vfind4-stuck-after-" + burst);
        st.events.length = 0;
        br.finder.requestMatchesCount(st.query, { linksOnly: false });
        await spike.sleep(1200);
        spike.log("  repaired by finder.requestMatchesCount(query) ->", st.events.slice(), raw(st));
      }
    }
    // held key: Enter repeating every 30 ms for a second
    st.events.length = 0;
    for (let i = 0; i < 30; i++) {
      pf.key("KEY_Enter");
      await spike.sleep(30);
    }
    await spike.sleep(2500);
    spike.log("30 x Enter at 30 ms -> last events", st.events.slice(-4), "shown", raw(st));
  });
