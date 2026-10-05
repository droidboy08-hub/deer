// Verify the counter on a long real page when the query is TYPED (one search per keystroke), in a
// normal tab and in a peek. In boot-vpeek2.js the peek showed "1 of 1,000+" for "glass" on a page
// that has 130 matches.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu, VitrePeek */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    VitreMenu.install();
    VitreFind.install();
    VitrePeek.install();
    const url = "https://en.wikipedia.org/wiki/Float_glass";
    const raw = (st) => ({ text: st.ui && st.ui.count.textContent, current: st.current, total: st.total, limit: st.limit, result: st.result, query: st.query });
    const watch = async (st, ms, label) => {
      const t0 = Date.now();
      let n = st.events.length;
      const tl = [];
      while (Date.now() - t0 < ms) {
        if (st.events.length !== n) {
          tl.push("+" + (Date.now() - t0) + "ms " + st.events.slice(n).join(" ") + " => " + JSON.stringify(st.ui.count.textContent));
          n = st.events.length;
        }
        await spike.sleep(40);
      }
      spike.log(label, tl, "final", raw(st));
    };
    const run = async (br, label) => {
      await v.activate();
      br.focus();
      pf.key("f", { accelKey: true });
      await pf.until(() => VitreFind.active && VitreFind.active.browser === br, 3000);
      const st = VitreFind.active;
      if (!st) return spike.log(label, "find did not open");
      st.events.length = 0;
      pf.type("glass"); // five keystrokes, no delay: five searches
      await watch(st, 4000, label + " typed 'glass' at once:");
      pf.key("KEY_Enter");
      await watch(st, 1500, label + " Enter:");
      pf.key("KEY_Enter");
      await watch(st, 1500, label + " Enter:");
      await spike.capture("vfind3-" + label.replace(/\W+/g, "-").toLowerCase());
      // slow typing (a human): one key every 180 ms
      st.ui.field.select();
      for (const ch of "float") {
        pf.type(ch);
        await spike.sleep(180);
      }
      await watch(st, 3000, label + " typed 'float' slowly:");
      pf.key("KEY_Escape");
      await spike.sleep(300);
    };

    const t = gBrowser.addTrustedTab(url);
    gBrowser.selectedTab = t;
    const ok = await pf.until(() => !t.linkedBrowser.webProgress?.isLoadingDocument && t.linkedBrowser.currentURI.spec.includes("wikipedia"), 25000, 200);
    await spike.sleep(1500);
    if (!ok) return spike.log("wikipedia did not load");
    await run(t.linkedBrowser, "TAB");
    gBrowser.removeTab(t);
    await spike.sleep(300);

    VitrePeek.open(url, { opener: b });
    const p = VitrePeek.current;
    await pf.until(() => !p.browser.webProgress?.isLoadingDocument && p.browser.currentURI.spec.includes("wikipedia"), 25000, 200);
    await spike.sleep(1500);
    await run(p.browser, "PEEK");
  });
