// Verify find/menu, part 2: (1) right-click inside an out-of-process frame, (2) PDFs.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, VitreMenu, CustomEvent, gContextMenu */
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

    // ---- 1. right-click the link inside the cross-site frame ------------------------------------------
    await section("oop-menu", async () => {
      const er = await pf.rectOf(b, "#xframe");
      const frameBC = b.browsingContext.children[0];
      spike.log("1 frame", { url: frameBC.currentWindowGlobal.documentURI.spec, pid: frameBC.currentWindowGlobal.osPid, topPid: b.browsingContext.currentWindowGlobal.osPid, rect: [Math.round(er.x), Math.round(er.y), Math.round(er.w), Math.round(er.h)] });
      // hover first so the status-bar link (overLink) tells us we are on the link
      let hit = null;
      for (let dx = 110; dx <= 190 && !hit; dx += 10) {
        const x = er.x + dx, y = er.y + 24;
        pf.mouse(x, y, { type: "mousemove" });
        await spike.sleep(250);
        if (window.XULBrowserWindow.overLink) hit = { x, y, overLink: window.XULBrowserWindow.overLink };
      }
      spike.log("1 hover in the frame: overLink", hit);
      if (!hit) return;
      pf.rightClick(hit.x, hit.y);
      await pf.until(() => VitreMenu.isOpen, 3000);
      const d = VitreMenu.lastContext;
      spike.log("1 MENU on the link inside the cross-site frame", VitreMenu.isOpen, d && { clickAt: [Math.round(hit.x), Math.round(hit.y)], menuAt: [Math.round(d.x), Math.round(d.y)], linkURL: d.linkURL, linkText: d.linkText, inFrame: d.inFrame, frameURL: d.frameURL, frameBrowsingContextID: d.frameBrowsingContextID, isFrameBC: d.frameBrowsingContextID === frameBC.id, pageURL: d.pageURL.replace(pf.base, "") }, VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label));
      await spike.capture("vfind2-oop-menu");
      if (VitreMenu.isOpen && d.linkURL) {
        const n = gBrowser.tabs.length;
        const i = VitreMenu.current.rowItems.findIndex((it) => it.label === "Open link in new tab");
        const rr = VitreMenu.current.rows[i].getBoundingClientRect();
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
        pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
        await pf.until(() => gBrowser.tabs.length > n, 4000);
        const nt = gBrowser.tabs[gBrowser.tabs.length - 1];
        await pf.browserLoaded(nt.linkedBrowser, "counter");
        spike.log("1 open-in-new-tab from the frame ->", nt.linkedBrowser.currentURI.spec, "tabs", n, "->", gBrowser.tabs.length);
        gBrowser.removeTab(nt);
      } else if (VitreMenu.isOpen) VitreMenu.close("test");
      // select text inside the frame and copy from the menu
      pf.mouse(er.x + 30, er.y + 24, { clickCount: 1 });
      pf.mouse(er.x + 30, er.y + 24, { clickCount: 2 }); // double-click selects the word "Inside"
      await spike.sleep(300);
      pf.rightClick(er.x + 30, er.y + 24);
      await pf.until(() => VitreMenu.isOpen, 3000);
      const d2 = VitreMenu.lastContext;
      spike.log("1 selection inside the frame", d2 && { selectionText: d2.selectionText, inFrame: d2.inFrame }, VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label));
      if (VitreMenu.isOpen) {
        pf.key("c"); // Copy
        await pf.until(() => !VitreMenu.isOpen, 2000);
        spike.log("1 Copy from the frame -> clipboard", await pf.clipboardIs("Inside", 2500));
      }
    });

    // ---- 2. PDF ---------------------------------------------------------------------------------------
    await section("pdf", async () => {
      const mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService).getFromTypeAndExtension("application/pdf", "pdf");
      spike.log("2 pdf handling", { "pdfjs.disabled": Services.prefs.getBoolPref("pdfjs.disabled", false), preferredAction: mime.preferredAction, handleInternally: Ci.nsIHandlerInfo.handleInternally, alwaysAsk: mime.alwaysAskBeforeHandling });
      const openPdf = async () => {
        const t = gBrowser.addTrustedTab(pf.base + "test.pdf");
        gBrowser.selectedTab = t;
        const ok = await pf.until(() => t.linkedBrowser.currentURI.spec.includes("test.pdf") && !t.linkedBrowser.webProgress?.isLoadingDocument, 15000, 200);
        await spike.sleep(2500);
        return { t, ok: !!ok };
      };
      let { t, ok } = await openPdf();
      let br = t.linkedBrowser;
      const viewer = () => pf.inContent(br, (w) => ({ href: w.location.href, principal: w.document.nodePrincipal.origin, pages: w.document.querySelectorAll(".page").length, textSpans: w.document.querySelectorAll(".textLayer span").length, title: w.document.title }));
      spike.log("2 PDF tab loaded", ok, { uri: br.currentURI.spec.replace(pf.base, ""), remoteType: br.remoteType, native: nativeBar(t) }, "viewer", await viewer());
      await spike.capture("vfind2-pdf-open");

      // 2a: Vitre's field as the spike wrote it
      let st = VitreFind.open(br, { query: "glass" });
      await settle(st, 3000);
      spike.log("2a Vitre find as written, 'glass' on the PDF ->", raw(st), "events", st.events.slice(-6), "(the PDF has 6 across 2 pages)", "native findbar", nativeBar(t));
      for (let i = 0; i < 5; i++) {
        VitreFind.step(br, false);
        await settle(st, 1200);
      }
      spike.log("2a after 5x Enter ->", raw(st));
      await spike.capture("vfind2-pdf-unbridged");
      VitreFind.close(br);
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);

      // 2b: a stand-in for the native findbar (see boot-vfind.js for the explanation)
      const fakes = new WeakMap();
      const calls = [];
      const fakeFor = (tab) => {
        let f = fakes.get(tab);
        if (!f) {
          f = document.createXULElement("box"); // never attached: only an EventTarget
          f.hidden = true;
          Object.defineProperty(f, "browser", { get: () => tab.linkedBrowser, set() {} });
          f.updateControlState = (result, findPrevious) => {
            calls.push("updateControlState:" + result);
            VitreFind.stateFor(tab.linkedBrowser).listener.onFindResult({ result, findBackwards: findPrevious, rect: null, linkURL: null });
          };
          f.onMatchesCountResult = (r) => {
            calls.push("onMatchesCountResult:" + r.current + "/" + r.total);
            VitreFind.stateFor(tab.linkedBrowser).listener.onMatchesCountResult(r);
          };
          fakes.set(tab, f);
        }
        return f;
      };
      gBrowser.getCachedFindBar = (tab = gBrowser.selectedTab) => {
        calls.push("getCachedFindBar");
        return tab._findBar || fakeFor(tab);
      };
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
      ({ t, ok } = await openPdf());
      br = t.linkedBrowser;
      spike.log("2b PDF tab loaded with the stand-in installed", ok, "viewer", await viewer(), "calls so far", calls.splice(0));
      const handled = bridge(br);
      st = VitreFind.open(br, { query: "glass" });
      await settle(st, 3000);
      spike.log("2b BRIDGED 'glass' on the PDF ->", raw(st), "events pdf.js took over", handled.slice(), "stand-in calls", calls.splice(0));
      VitreFind.step(br, false);
      await settle(st, 1500);
      VitreFind.step(br, false);
      await settle(st, 1500);
      spike.log("2b after 2x Enter ->", raw(st), calls.splice(0));
      await spike.capture("vfind2-pdf-bridged");
      VitreFind.setMatchCase(br, true);
      await settle(st, 2500);
      spike.log("2b match case ->", raw(st), "(expected total 5)");
      VitreFind.setMatchCase(br, false);
      await settle(st, 2000);
      for (let i = 0; i < 4; i++) {
        VitreFind.step(br, false);
        await settle(st, 1200);
      }
      spike.log("2b stepped on to", raw(st), "(page 2 holds matches 5 and 6)");
      await spike.capture("vfind2-pdf-bridged-page2");
      st.ui.field.value = "zzqx";
      st.ui.field.dispatchEvent(new Event("input", { bubbles: true }));
      await settle(st, 2500);
      spike.log("2b no-match query ->", raw(st));
      VitreFind.close(br);
      await spike.sleep(500);
      spike.log("2b native findbar after all this", nativeBar(t), "tab._findBar", String(t._findBar));
      gBrowser.removeTab(t);
      gBrowser.selectedTab = tab0;
      const st0 = VitreFind.open(b, { query: "glass" });
      await settle(st0);
      spike.log("2b a normal page with the stand-in installed ->", raw(st0), "native", nativeBar(tab0));
      VitreFind.close(b);
    });
    spike.log("END");
  });
