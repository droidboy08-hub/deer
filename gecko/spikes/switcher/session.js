// SPIKE switcher/7: what Firefox gives Vitre for free: history (Places), closed-tab undo and session
// restore (SessionStore), clearing browsing data (Sanitizer); plus thumbnails that survive a restart.
// Run 1: python tools/run.py --boot spikes/switcher/session.js --name switcher-session --out spikes/switcher/out/session --timeout 180
// Run 2: python tools/run.py --boot spikes/switcher/session.js --name switcher-session --out spikes/switcher/out/session2 --timeout 120 --keep-profile --pref browser.startup.page=3
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils, SessionStore, PlacesUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(async () => {
  const { Sanitizer } = ChromeUtils.importESModule("resource:///modules/Sanitizer.sys.mjs");
  const thumbDir = PathUtils.join(PathUtils.profileDir, "vitre-thumbs");
  const second = Services.prefs.getBoolPref("vitre.spike.sessionSecondRun", false);
  const short = (u) => (u.startsWith("data:") ? "data:" + (decodeURIComponent(u).match(/<title>(.*?)<\/title>/)?.[1] ?? "") : u);

  // Home (about:vitre-home) is registered in both runs. In the spike that happens here, at
  // browser-delayed-startup-finished; a real build must do it earlier (see FINDINGS: session restore).
  const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
  VitreHomeAbout.register("resource://vitre-boot/");

  try {
    await spike.resize(1280, 800);
    if (second) return await run2();
    await run1();
  } catch (e) {
    spike.log("ERROR " + e + "\n" + (e.stack || ""));
    spike.quit();
  }

  async function run1() {
    const first = gBrowser.selectedTab;
    const tabs = [vx.addTab("https://example.com/"), vx.addTab("https://en.wikipedia.org/wiki/Gecko_(software)"), vx.addTab(vx.page(3, "#1a4fa3"))];
    for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
    gBrowser.removeTab(first);
    await spike.sleep(800);

    // ---- 1. history is recorded by Places without any Vitre code ----
    for (const u of ["https://example.com/", "https://en.wikipedia.org/wiki/Gecko_(software)"]) {
      const info = await PlacesUtils.history.fetch(u, { includeVisits: true });
      spike.log("1 Places has", u, "->", info ? { title: info.title, visits: info.visits.length, frecency: info.frecency } : null);
    }
    const db = await PlacesUtils.promiseDBConnection();
    const rows = await db.execute("SELECT url, title, visit_count, frecency FROM moz_places WHERE visit_count > 0 ORDER BY last_visit_date DESC LIMIT 5");
    spike.log("1 recent history rows (SQL on places.sqlite):", rows.map((r) => [short(r.getResultByName("url")).slice(0, 50), r.getResultByName("visit_count"), r.getResultByName("frecency")]));
    spike.log("1 data: pages are not stored in history:", !(await PlacesUtils.history.fetch(tabs[2].linkedBrowser.currentURI.spec).catch(() => null)));

    // ---- 2. reopen closed tab, with its back/forward history ----
    const t = vx.addTab("https://example.com/");
    await vx.waitLoaded(t.linkedBrowser);
    gBrowser.selectedTab = t;
    t.linkedBrowser.fixupAndLoadURIString("https://example.org/", { triggeringPrincipal: vx.SYS });
    await spike.sleep(500);
    await vx.waitLoaded(t.linkedBrowser);
    await spike.sleep(500);
    const before = SessionStore.getClosedTabCountForWindow(window);
    gBrowser.removeTab(t);
    await spike.sleep(500);
    const closed = SessionStore.getClosedTabDataForWindow(window);
    spike.log("2 closed tab count", before, "->", SessionStore.getClosedTabCountForWindow(window), "| last closed:", closed[0] && { title: closed[0].title, entries: closed[0].state.entries.length });
    const back = SessionStore.undoCloseTab(window, 0);
    await spike.sleep(300);
    await vx.waitLoaded(back.linkedBrowser);
    await spike.sleep(500);
    spike.log("2 undoCloseTab ->", back.linkedBrowser.currentURI.spec, "canGoBack", back.linkedBrowser.canGoBack, "position", back._tPos, "of", gBrowser.tabs.length);
    gBrowser.removeTab(back);
    await spike.sleep(300);

    // ---- 3. clear browsing data with time ranges ----
    await PlacesUtils.history.insert({ url: "https://old.example.net/", title: "Two days ago", visits: [{ date: new Date(Date.now() - 2 * 86400e3) }] });
    vx.inContent(tabs[0].linkedBrowser, "content.document.cookie='vx=1; max-age=3600; path=/'");
    await spike.sleep(500);
    const state = async () => ({
      exampleVisit: !!(await PlacesUtils.history.fetch("https://example.com/")),
      oldVisit: !!(await PlacesUtils.history.fetch("https://old.example.net/")),
      cookies: Services.cookies.countCookiesFromHost("example.com"),
      closedTabs: SessionStore.getClosedTabCountForWindow(window),
      openTabs: gBrowser.tabs.length,
    });
    spike.log("3 before clearing:", await state());
    let t0 = performance.now();
    await Sanitizer.sanitize(["history", "cookies", "cache", "formdata", "downloads", "sessions"], {
      ignoreTimespan: false,
      range: Sanitizer.getClearRange(Sanitizer.TIMESPAN_HOUR),
    });
    spike.log("3 Sanitizer.sanitize(last hour) took", vx.ms(t0), "ms ->", await state());
    t0 = performance.now();
    await Sanitizer.sanitize(["history", "cookies", "cache", "offlineApps", "formdata", "downloads", "sessions"]);
    spike.log("3 Sanitizer.sanitize(everything) took", vx.ms(t0), "ms ->", await state());
    spike.log("3 time spans offered:", Object.keys(Sanitizer).filter((k) => k.startsWith("TIMESPAN_")), "| items:", Object.keys(Sanitizer.items));
    // the lower-level service the Sanitizer calls
    await new Promise((r) => Services.clearData.deleteDataInTimeRange((Date.now() - 3600e3) * 1000, Date.now() * 1000, true, Ci.nsIClearDataService.CLEAR_HISTORY, r));
    spike.log("3 Services.clearData.deleteDataInTimeRange(CLEAR_HISTORY) ok");

    // ---- 4. prepare the restart: thumbnails on disk, keyed through SessionStore custom tab values ----
    const homeTab = vx.addTab(VitreHomeAbout.URL);
    for (let i = 0; i < 200 && !homeTab.linkedBrowser.contentDocument?.documentElement?.dataset?.ready; i++) await spike.sleep(25);
    await IOUtils.makeDirectory(thumbDir, { createAncestors: true });
    for (const tab of gBrowser.tabs) {
      const b = tab.linkedBrowser;
      const r = b.getBoundingClientRect();
      let t1 = performance.now();
      // in-process pages (Home) need an explicit rect; remote pages take null = the current viewport
      const bmp = await b.browsingContext.currentWindowGlobal.drawSnapshot(b.isRemoteBrowser ? null : new DOMRect(0, 0, r.width, r.height), 0.5, "white");
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d").drawImage(bmp, 0, 0);
      const snapMs = vx.ms(t1);
      t1 = performance.now();
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      const encMs = vx.ms(t1);
      const id = Services.uuid.generateUUID().toString().slice(1, -1);
      t1 = performance.now();
      await IOUtils.write(PathUtils.join(thumbDir, id + ".jpg"), new Uint8Array(await blob.arrayBuffer()));
      SessionStore.setCustomTabValue(tab, "vitre-thumb", id);
      spike.log("4 thumbnail", bmp.width + "x" + bmp.height, "snapshot", snapMs, "ms, JPEG encode", encMs, "ms, write", vx.ms(t1), "ms,", blob.size, "bytes ->", short(b.currentURI.spec).slice(0, 40));
    }
    gBrowser.selectedTab = gBrowser.tabs[1];
    await spike.sleep(400);
    spike.log("4 before quit: tabs", gBrowser.tabs.map((x) => short(x.linkedBrowser.currentURI.spec).slice(0, 44)), "selected", gBrowser.tabContainer.selectedIndex);
    Services.prefs.setBoolPref("vitre.spike.sessionSecondRun", true);
    Services.prefs.savePrefFile(null);
    const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
    await TabStateFlusher.flushWindow(window);
    spike.log("4 quitting the normal way (eAttemptQuit) so the session file is written");
    ChromeUtils.importESModule("resource://vitre-boot/modules/SpikeQuit.sys.mjs").cleanQuit(Services.env.get("VITRE_LOG"));
  }

  async function run2() {
    await SessionStore.promiseAllWindowsRestored;
    await spike.sleep(1500);
    spike.log("RUN 2 browser.startup.page =", Services.prefs.getIntPref("browser.startup.page"), "| willAutoRestore", SessionStore.willAutoRestore);
    const info = [];
    for (const t of gBrowser.tabs) {
      info.push({
        url: short(t.linkedBrowser.currentURI.spec).slice(0, 48),
        label: t.label.slice(0, 28),
        selected: t.selected,
        pending: t.hasAttribute("pending"),
        hasBC: !!t.linkedBrowser.browsingContext,
        thumb: SessionStore.getCustomTabValue(t, "vitre-thumb").slice(0, 8),
        lastAccessedAgoS: Math.round((Date.now() - t.lastAccessed) / 1000),
      });
    }
    spike.log("RUN 2 restored tabs:");
    for (const i of info) spike.log("   ", i);

    // thumbnails for restored (still unloaded) tabs come from Vitre's own files
    const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:rgba(16,16,20,.9);display:grid;grid-template-columns:repeat(2,1fr);gap:18px;padding:28px;" +
      "box-sizing:border-box;font:13px Segoe UI,sans-serif;color:#fff");
    let shown = 0;
    for (const t of gBrowser.tabs) {
      const id = SessionStore.getCustomTabValue(t, "vitre-thumb");
      const cell = vx.el("div", "min-height:0");
      const img = vx.el("img", "display:block;width:100%;max-height:240px;object-fit:contain;border-radius:10px;background:#333");
      if (id) {
        const bytes = await IOUtils.read(PathUtils.join(thumbDir, id + ".jpg")).catch(() => null);
        if (bytes) {
          img.src = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          await img.decode().catch(() => {});
          shown++;
        }
      }
      cell.append(img, vx.el("div", "", (t.hasAttribute("pending") ? "[not loaded yet] " : "") + t.label));
      overlay.append(cell);
    }
    document.documentElement.append(overlay);
    spike.log("RUN 2 thumbnails read back from disk for", shown, "of", gBrowser.tabs.length, "tabs");
    await spike.capture("session-restored-thumbs");
    overlay.remove();

    // selecting a restored tab loads it, with its history
    const pending = gBrowser.tabs.find((t) => t.hasAttribute("pending"));
    if (pending) {
      gBrowser.selectedTab = pending;
      await spike.sleep(500);
      await vx.waitLoaded(pending.linkedBrowser);
      spike.log("RUN 2 selected a pending tab ->", short(pending.linkedBrowser.currentURI.spec).slice(0, 48), "pending", pending.hasAttribute("pending"));
    }
    const homeRestored = gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec === VitreHomeAbout.URL);
    if (homeRestored) {
      gBrowser.selectedTab = homeRestored;
      let ok = false;
      for (let i = 0; i < 200 && !(ok = !!homeRestored.linkedBrowser.contentDocument?.documentElement?.dataset?.ready); i++) await spike.sleep(25);
      spike.log("RUN 2 restored Home tab selected -> page ready", ok, "document", homeRestored.linkedBrowser.contentDocument?.documentURI, "remoteType", JSON.stringify(homeRestored.linkedBrowser.remoteType));
      await spike.capture("session-restored-home");
    } else {
      spike.log("RUN 2 no Home tab was restored");
    }
    spike.log("RUN 2 closed windows/tabs remembered:", SessionStore.getClosedWindowCount(), SessionStore.getClosedTabCountForWindow(window), "| canRestoreLastSession", SessionStore.canRestoreLastSession);
    spike.quit();
  }
})();
