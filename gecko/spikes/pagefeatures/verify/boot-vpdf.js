// Probe: why does a PDF tab not load in the harness, then find in PDFs with Vitre's field.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitreFind, ChromeUtils, CustomEvent */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-find.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const tab0 = gBrowser.selectedTab;
    const b = gBrowser.selectedBrowser;
    VitreFind.install();
    const seen = [];
    Services.console.registerListener({ observe(m) { const s = String(m.message || m); seen.push(s.slice(0, 300)); } });
    const nativeBar = (t = gBrowser.selectedTab) => ({ initialized: gBrowser.isFindBarInitialized(t), elements: document.querySelectorAll("findbar").length });
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
    let PdfJs = null;
    try {
      ({ PdfJs } = ChromeUtils.importESModule("resource://pdf.js/PdfJs.sys.mjs"));
      spike.log("PdfJs module", { initialized: PdfJs._initialized, cachedIsDefault: PdfJs.cachedIsDefault(), cachePref: Services.prefs.getBoolPref("pdfjs.enabledCache.state", "unset"), migration: Services.prefs.getIntPref("pdfjs.migrationVersion", -1), startupIdleDone: "see below" });
    } catch (e) {
      spike.log("PdfJs import failed", String(e));
    }
    const mode = Services.prefs.getStringPref("vitre.v.pdfmode", "plain");
    if (mode === "init" && PdfJs) {
      try {
        PdfJs.init(true);
        spike.log("called PdfJs.init(true)", { initialized: PdfJs._initialized, cachedIsDefault: PdfJs.cachedIsDefault(), cachePref: Services.prefs.getBoolPref("pdfjs.enabledCache.state", "unset") });
      } catch (e) {
        spike.log("PdfJs.init failed", String(e));
      }
    }
    gBrowser.addTabsProgressListener({
      onStateChange(br, wp, req, flags, status) {
        if (!wp.isTopLevel) return;
        let name = "";
        try { name = req.name.slice(0, 80); } catch (e) {}
        let ct = "";
        try { ct = req.QueryInterface(Ci.nsIChannel).contentType; } catch (e) {}
        const f = [];
        for (const k of ["STATE_START", "STATE_STOP", "STATE_IS_DOCUMENT", "STATE_IS_NETWORK", "STATE_IS_WINDOW", "STATE_REDIRECTING", "STATE_TRANSFERRING"]) if (flags & Ci.nsIWebProgressListener[k]) f.push(k.replace("STATE_", ""));
        spike.log("   progress", f.join("|"), "status 0x" + (status >>> 0).toString(16), name, ct);
      },
    });
    const pdfUrl = Services.prefs.getStringPref("vitre.v.pdfurl", "") || pf.base + "test.pdf";
    const openPdf = async () => {
      let t;
      if (mode === "link") {
        // a click on a link in a page (content principal), as a user would get to a PDF
        await pf.inContent(b, (w, url) => { const a = w.document.createElement("a"); a.href = url; a.target = "_blank"; a.id = "pdflink"; a.textContent = "PDF"; a.style = "position:fixed;left:20px;top:20px;z-index:99;background:#fff;padding:8px"; w.document.body.appendChild(a); }, pdfUrl);
        const n = gBrowser.tabs.length;
        const r = await pf.rectOf(b, "#pdflink");
        pf.mouse(r.cx, r.cy, {});
        await pf.until(() => gBrowser.tabs.length > n, 5000);
        t = gBrowser.tabs[gBrowser.tabs.length - 1];
      } else t = gBrowser.addTrustedTab(pdfUrl);
      gBrowser.selectedTab = t;
      const br = t.linkedBrowser;
      let last = "";
      for (let i = 0; i < 20; i++) {
        await spike.sleep(500);
        const s = br.currentURI.spec + " loading=" + br.webProgress?.isLoadingDocument + " remote=" + br.remoteType;
        if (s !== last) spike.log("  +" + (i + 1) * 500 + "ms", s);
        last = s;
        if (br.currentURI.spec.includes(".pdf") && !br.webProgress?.isLoadingDocument) break;
      }
      await spike.sleep(2500);
      return t;
    };
    let t = await openPdf();
    let br = t.linkedBrowser;
    const viewer = () => pf.inContent(br, (w) => ({ href: w.location.href, principal: w.document.nodePrincipal.origin, pages: w.document.querySelectorAll(".page").length, textSpans: w.document.querySelectorAll(".textLayer span").length, title: w.document.title }));
    spike.log("PDF tab", { uri: br.currentURI.spec.replace(pf.base, ""), remoteType: br.remoteType }, "viewer", await viewer(), "PdfJs", PdfJs && { enabled: PdfJs.enabled, initialized: PdfJs._initialized }, "console", seen.splice(0).filter((m) => !/Glean|telemetry|remote settings|RemoteSettings/i.test(m)).slice(-12));
    spike.log("windows", Array.from(Services.wm.getEnumerator(null)).map((w) => w.location.href));
    await spike.capture("vpdf-open");
    try {
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      const list = await (await Downloads.getList(Downloads.ALL)).getAll();
      spike.log("downloads", list.map((d) => ({ url: d.source.url, target: d.target.path, succeeded: d.succeeded, error: d.error && d.error.message })));
    } catch (e) {
      spike.log("downloads check failed", String(e));
    }
    if (!br.currentURI.spec.includes(".pdf")) return;

    await v.activate();
    // a: Vitre's field as the spike wrote it
    let st = VitreFind.open(br, { query: "glass" });
    await settle(st, 3000);
    spike.log("a Vitre find as written, 'glass' on the PDF ->", raw(st), "events", st.events.slice(-6), "(the PDF has 6 across 2 pages)", "native findbar", nativeBar(t));
    for (let i = 0; i < 5; i++) {
      VitreFind.step(br, false);
      await settle(st, 1200);
    }
    spike.log("a after 5x Enter ->", raw(st), "native findbar", nativeBar(t));
    await spike.capture("vpdf-unbridged");
    VitreFind.close(br);
    gBrowser.removeTab(t);
    gBrowser.selectedTab = tab0;
    await spike.sleep(300);

    // b: a stand-in for the native findbar. pdf.js (PdfJsParent) asks tabbrowser for the tab's findbar,
    // listens on it for "find" / "findagain" / "findhighlightallchange" / "findcasesensitivitychange" /
    // "findbarclose" (and preventDefaults them), and answers through findbar.updateControlState(result,
    // findPrevious) and findbar.onMatchesCountResult({current,total,limit}).
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
    t = await openPdf();
    br = t.linkedBrowser;
    spike.log("b PDF tab loaded with the stand-in installed, viewer", await viewer(), "calls so far", calls.splice(0));
    const handled = bridge(br);
    st = VitreFind.open(br, { query: "glass" });
    await settle(st, 3000);
    spike.log("b BRIDGED 'glass' on the PDF ->", raw(st), "events pdf.js took over", handled.slice(), "stand-in calls", calls.splice(0));
    VitreFind.step(br, false);
    await settle(st, 1500);
    VitreFind.step(br, false);
    await settle(st, 1500);
    spike.log("b after 2x Enter ->", raw(st), calls.splice(0));
    await spike.capture("vpdf-bridged");
    VitreFind.setMatchCase(br, true);
    await settle(st, 2500);
    spike.log("b match case ->", raw(st), "(expected total 5)");
    VitreFind.setMatchCase(br, false);
    await settle(st, 2000);
    for (let i = 0; i < 4; i++) {
      VitreFind.step(br, false);
      await settle(st, 1200);
    }
    spike.log("b stepped on to", raw(st), "(page 2 holds matches 5 and 6)");
    await spike.capture("vpdf-bridged-page2");
    st.ui.field.value = "zzqx";
    st.ui.field.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(st, 2500);
    spike.log("b no-match query ->", raw(st));
    VitreFind.close(br);
    await spike.sleep(500);
    spike.log("b native findbar after all this", nativeBar(t), "tab._findBar", String(t._findBar));
    gBrowser.removeTab(t);
    gBrowser.selectedTab = tab0;
    const st0 = VitreFind.open(b, { query: "glass" });
    await settle(st0);
    spike.log("b a normal page with the stand-in installed ->", raw(st0), "native", nativeBar(tab0));
    VitreFind.close(b);
  });
