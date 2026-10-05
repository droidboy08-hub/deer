// Verify Peek beyond the spike's same-origin test pages: cross-site peeks (another content process),
// a process switch INSIDE the sheet, a real video across promotion, a link the page handles itself,
// Ctrl+W, Ctrl+Tab, what session store and "closed tabs" see, permission prompts and DevTools
// from a peek, target=_blank inside a peek.
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitrePeek, VitreMenu, VitreFind, PopupNotifications, SessionStore, ChromeUtils */
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
    const other = pf.base.replace("127.0.0.1", "localhost");
    const section = async (name, fn) => {
      try {
        await v.activate();
        await fn();
      } catch (e) {
        spike.log("SECTION " + name + " FAILED", String(e), (e.stack || "").split("\n").slice(0, 3).join(" | "));
      }
    };
    const state = (br) =>
      pf.inContent(br, (w) => {
        const d = w.document.documentElement.dataset;
        const vid = w.document.getElementById("vid");
        return { url: w.location.href, token: d.token || null, n: +d.n || 0, visibility: w.document.visibilityState, hasFocus: w.document.hasFocus(),
          video: vid ? { t: +vid.currentTime.toFixed(2), paused: vid.paused } : null, fs: d.fs, fschange: d.fschange, geo: d.geo, notif: d.notif };
      });
    const info = (p) => ({ remoteType: p.browser.remoteType, pid: p.browser.frameLoader.remoteTab?.osPid, active: p.browser.docShellIsActive, bc: p.browser.browsingContext.id, shown: p.panel.classList.contains("vp-panel") });
    const waitPeek = async (part) => {
      const p = await pf.until(() => VitrePeek.current, 5000);
      if (!p) return null;
      await pf.browserLoaded(p.browser, part);
      await spike.sleep(700);
      return p;
    };
    const shiftClick = async (selector, br = b) => {
      const r = await pf.rectOf(br, selector);
      await spike.sleep(150);
      pf.mouse(r.cx, r.cy, { shiftKey: true });
    };
    const loads = { n: 0, browser: null };
    gBrowser.addTabsProgressListener({
      onStateChange(br, wp, req, flags) {
        if (br === loads.browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) loads.n++;
      },
    });
    let remotenessChanges = 0;
    gBrowser.tabContainer.addEventListener("TabRemotenessChange", () => remotenessChanges++);

    spike.log("source", b.currentURI.spec, "remoteType", b.remoteType, "pid", b.frameLoader.remoteTab.osPid, "fission", Services.appinfo.fissionAutostart);

    // ---- 1. a link the page handles itself: no peek ---------------------------------------------
    await section("preventDefault", async () => {
      await shiftClick("#pd");
      await spike.sleep(900);
      spike.log("1 SHIFT+CLICK on a link whose onclick calls preventDefault: peek opened", !!VitrePeek.current, "page handler hits", await pf.inContent(b, (w) => w.document.getElementById("pd").dataset.hits), "windows", Array.from(Services.wm.getEnumerator("navigator:browser")).length, "source url", b.currentURI.spec);
      if (VitrePeek.current) VitrePeek.close("test", { discard: true });
    });

    // ---- 2. cross-site peek ---------------------------------------------------------------------
    let p;
    await section("cross-site", async () => {
      await shiftClick("#xlink");
      p = await waitPeek("localhost");
      const s1 = await state(p.browser);
      await spike.sleep(1000);
      const s2 = await state(p.browser);
      spike.log("2 CROSS-SITE peek opened", !!p, info(p), "differs from source process", p.browser.frameLoader.remoteTab.osPid !== b.frameLoader.remoteTab.osPid, "runs", s1.n, "->", s2.n, "visibility", s2.visibility, "url", s2.url);
      await spike.capture("vpeek-cross-site");
      // process switch inside the sheet: hop to a page on the first site
      const before = info(p);
      VitrePeek.open(pf.base + "probe.html");
      await pf.until(() => p.browser.currentURI.spec.includes("probe.html"), 6000);
      await pf.browserLoaded(p.browser, "probe");
      await spike.sleep(1200);
      const s3 = await state(p.browser);
      await spike.sleep(600);
      const s4 = await state(p.browser);
      spike.log("2 HOP to another site inside the sheet", { before, after: info(p), sameBrowsingContext: before.bc === p.browser.browsingContext.id, remotenessChanges }, "runs", s3.n, "->", s4.n, "visibility", s4.visibility, "video", s3.video, "->", s4.video, "header", p.ui.host.textContent + p.ui.path.textContent, "back shown", !p.ui.back.hidden, "selected still source", gBrowser.selectedTab === tab0);
      await spike.capture("vpeek-after-process-switch");
      // typing still lands in the sheet after the process switch?
      spike.log("2 focus after process switch: activeElement is peek browser", document.activeElement === p.browser, "focusedContentBC is the peek", Services.focus.focusedContentBrowsingContext === p.browser.browsingContext);
    });

    // ---- 3. promote with a playing video ---------------------------------------------------------
    await section("promote-video", async () => {
      loads.browser = p.browser;
      loads.n = 0;
      const before = await state(p.browser);
      const pid = p.browser.frameLoader.remoteTab.osPid;
      p.browser.focus();
      pf.key("KEY_Enter", { altKey: true });
      await pf.until(() => !VitrePeek.current && gBrowser.selectedTab === p.tab, 4000);
      await spike.sleep(1000);
      const after = await state(p.browser);
      spike.log("3 PROMOTE", { selected: gBrowser.selectedTab === p.tab, hidden: p.tab.hidden, samePid: pid === p.browser.frameLoader.remoteTab.osPid, loads: loads.n }, "before", { token: before.token, n: before.n, video: before.video }, "after", { token: after.token, n: after.n, video: after.video, visibility: after.visibility }, "canGoBack", p.browser.canGoBack);
      await spike.capture("vpeek-promoted-video");
      // history made inside the peek survives: Back goes to the cross-site counter page
      p.browser.goBack();
      await pf.until(() => p.browser.currentURI.spec.includes("counter.html"), 5000);
      await spike.sleep(500);
      spike.log("3 BACK after promotion ->", p.browser.currentURI.spec);
      gBrowser.removeTab(p.tab);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);
    });

    // ---- 4. Ctrl+W and Ctrl+Tab with a peek open -------------------------------------------------
    await section("keys", async () => {
      const extra = gBrowser.addTrustedTab(pf.base + "second.html", { inBackground: true });
      await pf.browserLoaded(extra.linkedBrowser, "second");
      await shiftClick("#same");
      p = await waitPeek("counter");
      p.browser.focus();
      await spike.sleep(200);
      // Ctrl+Tab from the peek: which tab gets selected? (the hidden peek tab must be skipped)
      const order = gBrowser.tabs.map((t) => (t === tab0 ? "source" : t === p.tab ? "PEEK(hidden=" + t.hidden + ")" : "extra"));
      gBrowser.tabContainer.advanceSelectedTab(1, true);
      await spike.sleep(400);
      spike.log("4 tabs in DOM order", order, "advanceSelectedTab(1) from the source selected", gBrowser.selectedTab === extra ? "extra (peek skipped)" : gBrowser.selectedTab === p.tab ? "THE PEEK TAB" : "source", "visibleTabs", gBrowser.visibleTabs.length, "peek sheet shown", p.panel.classList.contains("vp-panel"));
      gBrowser.selectedTab = tab0;
      await spike.sleep(400);
      await v.activate();
      p.browser.focus();
      await spike.sleep(200);
      const nTabs = gBrowser.tabs.length;
      pf.key("w", { accelKey: true });
      await spike.sleep(600);
      spike.log("4 CTRL+W with the peek focused: peek closed", !VitrePeek.current, "tabs", nTabs, "->", gBrowser.tabs.length, "source tab still there", tab0.isConnected && !tab0.closing, "selected is source", gBrowser.selectedTab === tab0);
      gBrowser.removeTab(extra);
    });

    // ---- 5. session store / closed tabs ----------------------------------------------------------
    await section("session", async () => {
      await shiftClick("#same");
      p = await waitPeek("counter");
      const ss = JSON.parse(SessionStore.getWindowState(window)).windows[0];
      spike.log("5 SESSION STATE with a peek open: tabs", ss.tabs.map((t) => ({ url: t.entries[t.entries.length - 1]?.url.replace(pf.base, ""), hidden: !!t.hidden, extData: t.extData || null })), "selected", ss.selected);
      const closedBefore = SessionStore.getClosedTabCountForWindow(window);
      VitrePeek.close("test", { discard: true });
      await spike.sleep(500);
      spike.log("5 CLOSED-TAB LIST: discarding a peek adds an entry", closedBefore, "->", SessionStore.getClosedTabCountForWindow(window), "(Ctrl+Shift+T would reopen it as a normal tab)");
    });

    // ---- 6. target=_blank / permission prompt / devtools from inside a peek -----------------------
    await section("inside", async () => {
      VitrePeek.open(pf.base + "probe.html", { opener: b });
      p = await waitPeek("probe");
      VitrePeek.newWindowMode = "peek";
      const nTabs = gBrowser.tabs.length;
      let r = await pf.rectOf(p.browser, "#blank");
      pf.mouse(r.cx, r.cy, {});
      await spike.sleep(1500);
      const cur = VitrePeek.current;
      spike.log("6 TARGET=_BLANK inside a peek (mode peek): tabs", nTabs, "->", gBrowser.tabs.length, "current peek url", cur && cur.browser.currentURI.spec.replace(pf.base, ""), "same sheet tab", cur && cur.tab === p.tab, "old peek tab alive", p.tab.isConnected && !p.tab.closing, "old peek tab hidden", p.tab.hidden, "selected is source", gBrowser.selectedTab === tab0, "warm", !!VitrePeek.warm);
      await spike.capture("vpeek-blank-inside");
      if (VitrePeek.current) VitrePeek.close("test", { discard: true });
      if (VitrePeek.warm) gBrowser.removeTab(VitrePeek.warm.tab);
      for (const t of gBrowser.tabs.slice()) if (t !== tab0) gBrowser.removeTab(t);
      await spike.sleep(300);

      VitrePeek.open(pf.base + "probe.html", { opener: b });
      p = await waitPeek("probe");
      r = await pf.rectOf(p.browser, "#geo");
      pf.mouse(r.cx, r.cy, {});
      await spike.sleep(1500);
      const note = PopupNotifications.getNotification("geolocation", p.browser);
      spike.log("6 GEOLOCATION asked from a peek: page state", (await state(p.browser)).geo, "notification queued for the peek browser", !!note, "panel state", PopupNotifications.panel.state, "isPanelOpen", PopupNotifications.isPanelOpen, "anchor", note && note.anchorElement && note.anchorElement.id);
      await spike.capture("vpeek-permission");
      VitrePeek.promote();
      await spike.sleep(1200);
      spike.log("6 after promote: panel state", PopupNotifications.panel.state, "isPanelOpen", PopupNotifications.isPanelOpen);
      await spike.capture("vpeek-permission-promoted");
      try { PopupNotifications.panel.hidePopup(); } catch (e) {}
      gBrowser.removeTab(p.tab);
      gBrowser.selectedTab = tab0;
      await spike.sleep(300);

      VitrePeek.open(pf.base + "probe.html", { opener: b });
      p = await waitPeek("probe");
      const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
      r = await pf.rectOf(p.browser, "#geo");
      pf.rightClick(r.cx, r.cy);
      await pf.until(() => VitreMenu.isOpen, 4000);
      const i = VitreMenu.current.rowItems.findIndex((it) => it.label === "Inspect");
      const rr = VitreMenu.current.rows[i].getBoundingClientRect();
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousemove" });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mousedown", button: 0 });
      pf.mouse(rr.left + 40, rr.top + 17, { type: "mouseup", button: 0 });
      const tb = await pf.until(() => DevToolsShim.isInitialized() && DevToolsShim.hasToolboxForTab(p.tab), 20000, 300);
      await spike.sleep(2500);
      spike.log("6 INSPECT from a peek: toolbox for the peek tab", !!tb, "for the source tab", DevToolsShim.isInitialized() && DevToolsShim.hasToolboxForTab(tab0), "peek still open", !!VitrePeek.current, "selected is source", gBrowser.selectedTab === tab0, "toolbox iframe inside the sheet", !!p.panel.querySelector(".devtools-toolbox-bottom-iframe, iframe[src*='toolbox']"));
      await spike.capture("vpeek-inspect");
    });
    spike.log("END tabs", gBrowser.tabs.length, "visible", gBrowser.visibleTabs.length);
  });
