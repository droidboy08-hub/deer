// Verify Peek, part 2: a link the page handles itself, what session store sees, a peek tab that gets
// selected from outside Vitre (DevTools, an extension, tabs.update), a SECOND WINDOW (peek + find +
// menu there), and a real website.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitrePeek, VitreMenu, VitreFind, SessionStore, OpenBrowserWindow */
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
    VitrePeek.install();
    const section = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        spike.log("SECTION " + name + " FAILED", String(e), (e.stack || "").split("\n").slice(0, 3).join(" | "));
      }
    };
    const tokenOf = (br) => pf.inContent(br, (w) => ({ token: w.document.documentElement.dataset.token || null, n: +w.document.documentElement.dataset.n || 0, visibility: w.document.visibilityState, title: w.document.title }));
    const waitPeek = async (P, part, PF = pf) => {
      const p = await PF.until(() => P.current, 5000);
      if (!p) return null;
      await PF.browserLoaded(p.browser, part);
      await spike.sleep(700);
      return p;
    };

    // ---- 1. a link the page handles itself --------------------------------------------------------
    await section("preventDefault", async () => {
      await v.activate();
      const r = await pf.rectOf(b, "#pd");
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      await spike.sleep(900);
      spike.log("1 SHIFT+CLICK on a link whose onclick calls preventDefault: peek opened", !!VitrePeek.current, "page handler hits", await pf.inContent(b, (w) => w.document.getElementById("pd").dataset.hits), "windows", Array.from(Services.wm.getEnumerator("navigator:browser")).length, "source url", b.currentURI.spec.replace(pf.base, ""));
      if (VitrePeek.current) VitrePeek.close("test", { discard: true });
    });

    // ---- 2. session store ---------------------------------------------------------------------------
    await section("session", async () => {
      await v.activate();
      const r = await pf.rectOf(b, "#same");
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      const p = await waitPeek(VitrePeek, "counter");
      let ss = SessionStore.getWindowState(window);
      if (typeof ss === "string") ss = JSON.parse(ss);
      const w = ss.windows[0];
      spike.log("2 SESSION STATE with a peek open: tabs", w.tabs.map((t) => ({ url: (t.entries[t.entries.length - 1]?.url || "").replace(pf.base, ""), hidden: !!t.hidden, extData: t.extData || null })), "selected", w.selected);
      const closedBefore = SessionStore.getClosedTabCountForWindow(window);
      VitrePeek.close("test", { discard: true });
      await spike.sleep(600);
      spike.log("2 CLOSED-TAB LIST: discarding a peek adds an entry", closedBefore, "->", SessionStore.getClosedTabCountForWindow(window));
    });

    // ---- 3. the peek tab gets selected by something that is not Vitre -------------------------------
    await section("external-select", async () => {
      await v.activate();
      const r = await pf.rectOf(b, "#same");
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      const p = await waitPeek(VitrePeek, "counter");
      gBrowser.selectedTab = p.tab; // what DevTools "Inspect", tabs.update({active:true}) or a notification click do
      await spike.sleep(700);
      spike.log("3 EXTERNAL SELECT of the peek tab:", { vitreStillThinksPeekOpen: !!VitrePeek.current, tabHidden: p.tab.hidden, tabSelected: p.tab.selected, hasPeekAttr: p.tab.hasAttribute("vitre-peek"), headerStillInPanel: p.header.isConnected, scrimStillInDOM: p.scrim.isConnected, scrimHidden: p.scrim.hidden, panelClass: p.panel.className, keptActiveSet: gBrowser._printPreviewBrowsers.has(p.browser) });
      await spike.capture("vpeek2-external-select");
      gBrowser.selectedTab = tab0;
      await spike.sleep(500);
      spike.log("3 back on the source tab: sheet shown again", p.panel.classList.contains("vp-panel"), "peek tab hidden", p.tab.hidden, "(a visible tab in the strip AND a sheet = inconsistent)");
      await spike.capture("vpeek2-external-select-back");
      VitrePeek.close("test", { discard: true });
      for (const t of gBrowser.tabs.slice()) if (t !== tab0) gBrowser.removeTab(t);
    });

    // ---- 4. second window ---------------------------------------------------------------------------
    await section("second-window", async () => {
      const w2 = OpenBrowserWindow();
      await pf.until(() => w2.VitrePeek && w2.pf && w2.gBrowser && w2.spike, 15000, 100);
      await spike.sleep(500);
      w2.resizeTo(1340, 940);
      w2.moveTo(20, 20);
      const g2 = w2.gBrowser;
      const P2 = w2.pf;
      w2.VitreMenu.install();
      w2.VitreMenu.closeOnBlur = false;
      w2.VitreFind.install();
      w2.VitrePeek.install();
      const b2 = g2.selectedBrowser;
      b2.fixupAndLoadURIString(pf.base + "article.html", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await P2.browserLoaded(b2, "article");
      await spike.sleep(800);
      for (let i = 0; i < 20 && Services.focus.activeWindow !== w2; i++) {
        w2.focus();
        await spike.sleep(50);
      }
      spike.log("4 SECOND WINDOW ready", { windows: Array.from(Services.wm.getEnumerator("navigator:browser")).length, w2Active: Services.focus.activeWindow === w2, secondary: P2.secondary });
      // peek
      let r = await P2.rectOf(b2, "#link1");
      P2.mouse(r.cx, r.cy, { shiftKey: true });
      const p = await waitPeek(w2.VitrePeek, "counter", P2);
      const s1 = p && (await P2.inContent(p.browser, (w) => ({ token: w.document.documentElement.dataset.token, n: +w.document.documentElement.dataset.n, visibility: w.document.visibilityState })));
      spike.log("4 W2 SHIFT+CLICK -> peek in window 2", !!p, "window 1 has a peek", !!VitrePeek.current, "w2 tabs", g2.tabs.length, "w1 tabs", gBrowser.tabs.length, "state", s1);
      await w2.spike.capture("vpeek2-w2-peek");
      // find inside window 2 (page under the peek is not the target: the peek is)
      p.browser.focus();
      P2.key("f", { accelKey: true });
      await P2.until(() => w2.VitreFind.active, 3000);
      P2.type("page");
      await spike.sleep(900);
      spike.log("4 W2 CTRL+F in the peek: counter", w2.VitreFind.active && w2.VitreFind.active.ui.count.textContent, "window 1 find active", !!VitreFind.active, "native findbar in w2", g2.isFindBarInitialized());
      P2.key("KEY_Escape");
      await spike.sleep(300);
      // promote
      p.browser.focus();
      P2.key("KEY_Enter", { altKey: true });
      await P2.until(() => !w2.VitrePeek.current, 4000);
      await spike.sleep(600);
      const s2 = await P2.inContent(p.browser, (w) => ({ token: w.document.documentElement.dataset.token, n: +w.document.documentElement.dataset.n }));
      spike.log("4 W2 PROMOTE: selected in w2", g2.selectedTab === p.tab, "same token", s1 && s2.token === s1.token, "w2 tabs", g2.tabs.length, "w1 tabs", gBrowser.tabs.length);
      // menu in window 2 on the source tab
      g2.selectedTab = g2.tabs[0];
      await spike.sleep(400);
      r = await P2.rectOf(b2, "#link1");
      P2.rightClick(r.cx, r.cy);
      await P2.until(() => w2.VitreMenu.isOpen, 4000);
      spike.log("4 W2 MENU on a link", w2.VitreMenu.current && w2.VitreMenu.current.rowItems.map((i) => i.label), "window 1 menu open", VitreMenu.isOpen, "native popup state", w2.document.getElementById("contentAreaContextMenu").state);
      await w2.spike.capture("vpeek2-w2-menu");
      P2.key("e"); // Copy link address
      await P2.until(() => !w2.VitreMenu.isOpen, 3000);
      spike.log("4 W2 copy link ->", await pf.clipboardIs(pf.base + "counter.html"));
      // find on the page in window 2
      b2.focus();
      P2.key("f", { accelKey: true });
      await P2.until(() => w2.VitreFind.active, 3000);
      P2.type("glass");
      await spike.sleep(900);
      P2.key("KEY_Enter");
      await spike.sleep(500);
      spike.log("4 W2 FIND glass + Enter ->", w2.VitreFind.active && w2.VitreFind.active.ui.count.textContent);
      await w2.spike.capture("vpeek2-w2-find");
      w2.close();
      await spike.sleep(800);
    });

    // ---- 5. a real website ---------------------------------------------------------------------------
    await section("real-site", async () => {
      await v.activate();
      const url = "https://en.wikipedia.org/wiki/Float_glass";
      VitrePeek.open(url, { opener: b });
      const p = VitrePeek.current;
      const ok = await pf.until(() => !p.browser.webProgress?.isLoadingDocument && p.browser.currentURI.spec.includes("wikipedia"), 25000, 200);
      await spike.sleep(1500);
      const st = await tokenOf(p.browser);
      spike.log("5 REAL SITE peek loaded", !!ok, p.browser.currentURI.spec, { remoteType: p.browser.remoteType, active: p.browser.docShellIsActive, title: st.title, visibility: st.visibility });
      await spike.capture("vpeek2-real-peek");
      if (!ok) return;
      // find inside it
      p.browser.focus();
      pf.key("f", { accelKey: true });
      await pf.until(() => VitreFind.active, 3000);
      pf.type("glass");
      await spike.sleep(1500);
      pf.key("KEY_Enter");
      pf.key("KEY_Enter");
      await spike.sleep(700);
      spike.log("5 REAL SITE find 'glass' in the peek ->", VitreFind.active && VitreFind.active.ui.count.textContent);
      await spike.capture("vpeek2-real-find");
      pf.key("KEY_Escape");
      await spike.sleep(300);
      // right-click the first content link
      const lr = await pf.inContent(p.browser, (w) => {
        const a = Array.from(w.document.querySelectorAll("#mw-content-text p a[href^='/wiki/']")).find((x) => x.getClientRects().length && x.getBoundingClientRect().top > 0 && x.getBoundingClientRect().top < w.innerHeight - 40);
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: a.href };
      });
      if (lr) {
        const br = p.browser.getBoundingClientRect();
        pf.rightClick(br.left + lr.x, br.top + lr.y);
        await pf.until(() => VitreMenu.isOpen, 4000);
        const d = VitreMenu.lastContext;
        spike.log("5 REAL SITE menu on a link in the peek", VitreMenu.isOpen, { linkURL: d && d.linkURL, expected: lr.href, linkText: d && d.linkText, pageURL: d && d.pageURL }, VitreMenu.current && VitreMenu.current.rowItems.map((i) => i.label));
        await spike.capture("vpeek2-real-menu");
        VitreMenu.close("test");
      } else spike.log("5 no link found in view");
      // promote
      let loads = 0;
      const l = { onStateChange(br, wp, req, flags) { if (br === p.browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) loads++; } };
      gBrowser.addTabsProgressListener(l);
      const y0 = await pf.inContent(p.browser, (w) => { w.scrollTo(0, 600); return w.scrollY; });
      VitrePeek.promote();
      await spike.sleep(1200);
      const y1 = await pf.inContent(p.browser, (w) => w.scrollY);
      spike.log("5 REAL SITE promote: selected", gBrowser.selectedTab === p.tab, "document loads", loads, "scroll kept", y0, "->", y1);
      await spike.capture("vpeek2-real-promoted");
      gBrowser.removeTabsProgressListener(l);
    });
    spike.log("END");
  });
