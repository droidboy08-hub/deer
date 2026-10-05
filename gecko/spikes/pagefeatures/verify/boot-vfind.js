// Verify find beyond the spike's pages:
//   A. a page with an out-of-process (cross-site) iframe: counts, stepping into the frame, the match
//      rect, and the right-click context inside that frame
//   B. the "N of limit+" rule against the raw numbers on a real, long page
//   C. PDFs: pdf.js does its own find and only talks to the NATIVE <findbar> element; what happens
//      with Vitre's field, and a bridge that makes it work without creating the native findbar
//   D. the pill after a tab switch
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu, CustomEvent */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const tab0 = gBrowser.selectedTab;
    VitreMenu.install();
    VitreMenu.closeOnBlur = false;
    VitreFind.install();
    const nativeBar = (t = gBrowser.selectedTab) => ({ initialized: gBrowser.isFindBarInitialized(t), elements: document.querySelectorAll("findbar").length });
    const section = async (name, fn) => {
      try {
        await v.activate();
        await fn();
      } catch (e) {
        spike.log("SECTION " + name + " FAILED", String(e), (e.stack || "").split("\n").slice(0, 3).join(" | "));
      }
    };
    const openTab = async (url, part) => {
      const t = gBrowser.addTrustedTab(url);
      gBrowser.selectedTab = t;
      await pf.until(() => !t.linkedBrowser.webProgress?.isLoadingDocument && t.linkedBrowser.currentURI.spec.includes(part), 25000, 200);
      await spike.sleep(1200);
      return t;
    };
    const raw = (st) => ({ text: st.ui && st.ui.count.textContent, current: st.current, total: st.total, limit: st.limit, result: st.result });
    const settle = async (st, ms = 2500) => {
      let n = -1;
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (st.events.length === n) break;
        n = st.events.length;
        await spike.sleep(350);
      }
    };

    // ---- A. out-of-process iframe -------------------------------------------------------------------
    await section("oop-frame", async () => {
      const frames = b.browsingContext.children.map((c) => ({ url: c.currentWindowGlobal?.documentURI?.spec.replace(/:\d+/, ""), pid: c.currentWindowGlobal?.osPid, remoteType: c.currentWindowGlobal?.domProcess?.remoteType }));
      spike.log("A top pid", b.browsingContext.currentWindowGlobal.osPid, "frames", frames);
      const st = VitreFind.open(b, { query: "glass" });
      await settle(st);
      spike.log("A QUERY glass ->", raw(st), "(expected 6: 5 in the top document + 1 in the cross-site frame)");
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(st.ui.count.textContent + " @" + (st.rect ? Math.round(st.rect.x) + "," + Math.round(st.rect.y) : "norect"));
        VitreFind.step(b, false);
        await settle(st, 1200);
      }
      spike.log("A stepping through all matches", seen, "then wraps to", st.ui.count.textContent, "wrapped", st.wrapped);
      // go to the match in the frame: it is number 5 in document order (frame sits before #p2)
      for (let i = 0; i < 12 && st.current !== 5; i++) {
        VitreFind.step(b, false);
        await settle(st, 1000);
      }
      const fr = await pf.rectOf(b, "#xframe");
      spike.log("A match 5 (inside the cross-site frame): counter", st.ui.count.textContent, "rect (top-document px)", st.rect, "frame element rect (chrome px)", fr && [Math.round(fr.x), Math.round(fr.y), Math.round(fr.w), Math.round(fr.h)], "browser top", Math.round(b.getBoundingClientRect().top));
      const sc = await pf.inContent(b, (w) => [w.scrollX, w.scrollY]);
      spike.log("A ring box", VitreFind.ring(st, sc[0], sc[1]));
      await spike.capture("vfind-oop-frame");
      for (const r of document.querySelectorAll(".vf-ring")) r.remove();
      VitreFind.setMatchCase(b, true);
      await settle(st);
      spike.log("A match case 'glass' ->", raw(st), "(expected 5)");
      VitreFind.setMatchCase(b, false);
      VitreFind.close(b);
      await spike.sleep(300);

      // right-click the link inside the cross-site frame
      const frame = b.browsingContext.children[0];
      const lr = await frame.currentWindowGlobal.getActor("ContextMenu") && null;
      const xy = await new Promise((resolve) => {
        // ask the frame's own process for the link rect through a frame script on its message manager is
        // not possible (frame scripts are per top browser), so compute from the frame element + known layout
        resolve(null);
      });
      const er = await pf.rectOf(b, "#xframe");
      // frame.html: body margin 12px, text "Inside a frame: " then the link. Probe points along the first line.
      let hit = null;
      for (let dx = 100; dx <= 200 && !hit; dx += 12) {
        pf.rightClick(er.x + dx, er.y + 22);
        await pf.until(() => VitreMenu.isOpen, 1500);
        if (VitreMenu.isOpen && VitreMenu.lastContext.linkURL) hit = { dx, d: VitreMenu.lastContext, click: [Math.round(er.x + dx), Math.round(er.y + 22)] };
        else VitreMenu.close("probe");
        await spike.sleep(150);
      }
      spike.log("A MENU on the link inside the cross-site frame", hit ? { clickAt: hit.click, menuAt: [Math.round(hit.d.x), Math.round(hit.d.y)], linkURL: hit.d.linkURL, inFrame: hit.d.inFrame, frameURL: hit.d.frameURL, pageURL: hit.d.pageURL.replace(pf.base, ""), items: VitreMenu.current.rowItems.map((i) => i.label) } : "no link hit");
      await spike.capture("vfind-oop-menu");
      if (VitreMenu.isOpen) {
        // "Open link in new tab" from an out-of-process frame
        const n = gBrowser.tabs.length;
        const i = VitreMenu.current.rowItems.findIndex((it) => it.label === "Open link in new tab");
        const rr = VitreMenu.current.rows[i].getBoundingClientRect();
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
        await pf.until(() => gBrowser.tabs.length > n, 4000);
        const nt = gBrowser.tabs[gBrowser.tabs.length - 1];
        await pf.browserLoaded(nt.linkedBrowser, "counter");
        spike.log("A open-in-new-tab from the frame ->", nt.linkedBrowser.currentURI.spec, "tabs", n, "->", gBrowser.tabs.length);
        gBrowser.removeTab(nt);
      }
    });

    // ---- D. tab switch with find open -----------------------------------------------------------------
    await section("tab-switch", async () => {
      const st = VitreFind.open(b, { query: "glass" });
      await settle(st);
      const t2 = await openTab(pf.base + "second.html", "second");
      spike.log("D tab A has find open, switched to tab B: A's pill still visible over B", !st.ui.pill.hidden && st.ui.pill.isConnected, "VitreFind.active is A's state", VitreFind.active === st, "(the module has no TabSelect handling)");
      await spike.capture("vfind-tab-switch");
      gBrowser.removeTab(t2);
      gBrowser.selectedTab = tab0;
      VitreFind.close(b);
    });

    // ---- B. counts on a real long page -----------------------------------------------------------------
    await section("real-count", async () => {
      const t = await openTab("https://en.wikipedia.org/wiki/Float_glass", "wikipedia");
      const br = t.linkedBrowser;
      const st = VitreFind.open(br, { query: "glass" });
      const t0 = Date.now();
      const timeline = [];
      let n = 0;
      while (Date.now() - t0 < 6000) {
        if (st.events.length !== n) {
          timeline.push("+" + (Date.now() - t0) + "ms " + st.events.slice(n).join(" ") + " => " + JSON.stringify(st.ui.count.textContent));
          n = st.events.length;
        }
        await spike.sleep(50);
      }
      spike.log("B wikipedia 'glass' event timeline", timeline);
      const truth = await pf.inContent(br, (w) => ({ inText: (w.document.body.innerText.match(/glass/gi) || []).length, inTextContent: (w.document.body.textContent.match(/glass/gi) || []).length, frames: w.frames.length }));
      spike.log("B raw", raw(st), "regex count in the page: visible text", truth.inText, "all text nodes", truth.inTextContent, "subframes", truth.frames, "browsingContext children", br.browsingContext.children.length);
      VitreFind.step(br, false);
      await settle(st);
      VitreFind.step(br, false);
      await settle(st);
      spike.log("B after 2 steps", raw(st));
      await spike.capture("vfind-real-count");
      for (const q of ["float", "Pilkington", "zzqx"]) {
        st.ui.field.value = q;
        st.ui.field.dispatchEvent(new Event("input", { bubbles: true }));
        await settle(st, 4000);
        const tr = await pf.inContent(br, (w, q) => (w.document.body.innerText.match(new RegExp(q, "gi")) || []).length, q);
        spike.log("B query", q, "->", raw(st), "regex count (visible text)", tr);
      }
      Services.prefs.setIntPref("accessibility.typeaheadfind.matchesCountLimit", 20);
      st.ui.field.value = "glass";
      st.ui.field.dispatchEvent(new Event("input", { bubbles: true }));
      await settle(st, 4000);
      spike.log("B limit 20, 'glass' ->", raw(st));
      Services.prefs.clearUserPref("accessibility.typeaheadfind.matchesCountLimit");
      VitreFind.close(br);
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
    });

    // ---- C. PDF ---------------------------------------------------------------------------------------
    await section("pdf", async () => {
      // C1: Vitre's field as the spike wrote it
      let t = await openTab(pf.base + "test.pdf", "test.pdf");
      let br = t.linkedBrowser;
      await spike.sleep(1500);
      spike.log("C1 PDF tab", { uri: br.currentURI.spec.replace(pf.base, ""), principal: br.contentPrincipal.spec || br.contentPrincipal.origin, remoteType: br.remoteType, native: nativeBar(t) });
      let st = VitreFind.open(br, { query: "glass" });
      await settle(st, 3000);
      spike.log("C1 Vitre find as written, 'glass' on a PDF ->", raw(st), "events", st.events.slice(-6), "(the PDF has 6 across 2 pages)", "native findbar", nativeBar(t));
      VitreFind.step(br, false);
      await settle(st, 1500);
      spike.log("C1 after Enter ->", raw(st));
      await spike.capture("vfind-pdf-unbridged");
      VitreFind.close(br);
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);

      // C2: bridge. pdf.js (PdfJsParent) asks tabbrowser for the tab's findbar, listens for the
      // findbar's "find" / "findagain" / ... events (and preventDefaults them), and answers through
      // findbar.updateControlState() / findbar.onMatchesCountResult(). Give it a stand-in object.
      const fakes = new WeakMap();
      const fakeFor = (tab) => {
        let f = fakes.get(tab);
        if (!f) {
          f = document.createXULElement("box"); // never attached: only an EventTarget
          f.hidden = true;
          Object.defineProperty(f, "browser", { get: () => tab.linkedBrowser, set() {} });
          f.updateControlState = (result, findPrevious) => VitreFind.stateFor(tab.linkedBrowser).listener.onFindResult({ result, findBackwards: findPrevious, rect: null, linkURL: null });
          f.onMatchesCountResult = (r) => VitreFind.stateFor(tab.linkedBrowser).listener.onMatchesCountResult(r);
          fakes.set(tab, f);
        }
        return f;
      };
      gBrowser.getCachedFindBar = (tab = gBrowser.selectedTab) => tab._findBar || fakeFor(tab);
      gBrowser.getFindBar = async (tab = gBrowser.selectedTab) => tab._findBar || fakeFor(tab);
      const bridge = (browser) => {
        const tab = gBrowser.getTabForBrowser(browser);
        const fb = fakeFor(tab);
        const fin = browser.finder;
        const state = VitreFind.stateFor(browser);
        const fire = (type, q, prev) => fb.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { query: q, caseSensitive: !!state.matchCase, matchDiacritics: false, entireWord: false, highlightAll: true, findPrevious: !!prev } }));
        const o = { fastFind: fin.fastFind.bind(fin), findAgain: fin.findAgain.bind(fin), onFindbarClose: fin.onFindbarClose.bind(fin) };
        const handled = [];
        fin.fastFind = (q, ...a) => (fire("find", q, false) ? o.fastFind(q, ...a) : handled.push("find"));
        fin.findAgain = (q, back, ...a) => (fire("findagain", q, back) ? o.findAgain(q, back, ...a) : handled.push("findagain"));
        fin.onFindbarClose = () => {
          fb.dispatchEvent(new Event("findbarclose", { bubbles: true, cancelable: true }));
          o.onFindbarClose();
        };
        return handled;
      };
      t = await openTab(pf.base + "test.pdf", "test.pdf");
      br = t.linkedBrowser;
      await spike.sleep(1500);
      const handled = bridge(br);
      st = VitreFind.open(br, { query: "glass" });
      await settle(st, 3000);
      spike.log("C2 BRIDGED 'glass' on the PDF ->", raw(st), "events pdf.js took over", handled.slice(), "events", st.events.slice(-6));
      VitreFind.step(br, false);
      await settle(st, 1500);
      VitreFind.step(br, false);
      await settle(st, 1500);
      spike.log("C2 after 2x Enter ->", raw(st));
      await spike.capture("vfind-pdf-bridged");
      VitreFind.setMatchCase(br, true);
      await settle(st, 2500);
      spike.log("C2 match case ->", raw(st), "(expected 5)");
      VitreFind.setMatchCase(br, false);
      await settle(st, 2000);
      for (let i = 0; i < 4; i++) {
        VitreFind.step(br, false);
        await settle(st, 1200);
      }
      spike.log("C2 stepped to", raw(st), "(page 2 holds matches 5 and 6)");
      await spike.capture("vfind-pdf-bridged-page2");
      VitreFind.close(br);
      await spike.sleep(500);
      spike.log("C2 native findbar after all this", nativeBar(t), "tab._findBar", String(t._findBar));
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
      // a normal page still works with the stand-in installed
      const st0 = VitreFind.open(b, { query: "glass" });
      await settle(st0);
      spike.log("C2 normal page with the stand-in installed ->", raw(st0), "native", nativeBar(tab0));
      VitreFind.close(b);
    });
    spike.log("END");
  });
