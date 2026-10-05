// SPIKE switcher/1: tab thumbnails for the Ctrl+Tab switcher.
// Run: python tools/run.py --boot spikes/switcher/thumbs.js --name switcher-thumbs --out spikes/switcher/out/thumbs --timeout 150
// Big variant (1920x1080 window, 8 real sites + 4 generated pages):
//      python tools/run.py --boot spikes/switcher/thumbs.js --name switcher-thumbs-big --out spikes/switcher/out/thumbs-big --timeout 200 --pref vitre.spike.big=true
/* global gBrowser, Services, Ci, Cc, spike, vx, PageThumbs */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const big = Services.prefs.getBoolPref("vitre.spike.big", false);
  await spike.resize(big ? 1920 : 1280, big ? 1080 : 800);
  const dpr = window.devicePixelRatio;
  spike.log("dpr", dpr, "inner", window.innerWidth, window.innerHeight);

  // ---- 12 tabs: 10 generated pages + 2 real sites, all opened in the background ----
  const urls = [];
  for (let i = 1; i <= 10; i++) urls.push(vx.page(i, vx.COLOURS[i - 1], i === 7 || i === 9 ? "#111" : "#fff"));
  urls.push("https://example.com/");
  urls.push("https://en.wikipedia.org/wiki/Gecko_(software)");
  if (big) {
    urls.splice(0, 6, "https://en.wikipedia.org/wiki/Firefox", "https://en.wikipedia.org/wiki/Web_browser", "https://www.mozilla.org/en-US/",
      "https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter", "https://github.com/mozilla/gecko-dev", "https://news.ycombinator.com/");
  }
  const first = gBrowser.selectedTab;
  const tabs = urls.map((u) => vx.addTab(u));
  for (const t of tabs) {
    const ok = await vx.waitLoaded(t.linkedBrowser);
    if (!ok) spike.log("LOAD TIMEOUT", t.linkedBrowser.currentURI.spec.slice(0, 60));
  }
  gBrowser.removeTab(first);
  await spike.sleep(500);
  spike.log("tabs", gBrowser.tabs.length, "selected index", gBrowser.tabContainer.selectedIndex);
  const b0 = gBrowser.selectedBrowser;
  const rect = b0.getBoundingClientRect();
  spike.log("browser css size", rect.width, rect.height);

  // ---- A. selected tab: drawSnapshot cost by scale ----
  const snap = (browser, scale, r = null) => browser.browsingContext.currentWindowGlobal.drawSnapshot(r, scale, "white");
  for (const scale of [dpr, 0.75 * dpr, 0.5 * dpr, 0.25 * dpr, 0.1]) {
    const times = [];
    let bmp;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      bmp = await snap(b0, scale);
      times.push(vx.ms(t0));
    }
    spike.log("A selected drawSnapshot scale", scale, "->", bmp.width + "x" + bmp.height, "ms", times, vx.stats(bmp, 32, 20));
  }

  // ---- B. background tabs (loaded, never shown): drawSnapshot ----
  const bgScale = 0.5 * dpr;
  const seq = [];
  const t0seq = performance.now();
  for (const t of gBrowser.tabs) {
    const b = t.linkedBrowser;
    const t0 = performance.now();
    try {
      const bmp = await snap(b, bgScale);
      seq.push({ i: t._tPos, sel: t.selected, ms: vx.ms(t0), size: bmp.width + "x" + bmp.height, ...vx.stats(bmp, 32, 20) });
    } catch (e) {
      seq.push({ i: t._tPos, error: String(e) });
    }
  }
  spike.log("B sequential 12 tabs total ms", vx.ms(t0seq));
  for (const s of seq) spike.log("B  ", s);

  const t0par = performance.now();
  const bitmaps = await Promise.all(gBrowser.tabs.map((t) => snap(t.linkedBrowser, bgScale).catch((e) => null)));
  spike.log("B parallel 12 tabs total ms", vx.ms(t0par), "ok", bitmaps.filter(Boolean).length);

  // Deck-card resolution (Electron used 0.75 * dpr of the window width)
  const t0hi = performance.now();
  const hi = await Promise.all(gBrowser.tabs.map((t) => snap(t.linkedBrowser, 0.75 * dpr).catch(() => null)));
  spike.log("B parallel 12 tabs @0.75*dpr total ms", vx.ms(t0hi), "size", hi[0] && hi[0].width + "x" + hi[0].height);

  // ---- C. PageThumbs helpers ----
  {
    const t = gBrowser.tabs[3];
    const c = document.createElementNS(vx.HTML, "canvas");
    c.width = 640;
    c.height = 400;
    let t0 = performance.now();
    try {
      await PageThumbs.captureToCanvas(t.linkedBrowser, c, { fullViewport: true });
      spike.log("C PageThumbs.captureToCanvas bg tab ms", vx.ms(t0), c.width + "x" + c.height, vx.stats(c, 32, 20));
    } catch (e) {
      spike.log("C captureToCanvas FAILED", String(e));
    }
    const c2 = document.createElementNS(vx.HTML, "canvas");
    c2.width = 560;
    c2.height = 280;
    t0 = performance.now();
    try {
      const ok = await PageThumbs.captureTabPreviewThumbnail(t.linkedBrowser, c2);
      spike.log("C PageThumbs.captureTabPreviewThumbnail ok", ok, "ms", vx.ms(t0), vx.stats(c2, 32, 20));
    } catch (e) {
      spike.log("C captureTabPreviewThumbnail FAILED", String(e));
    }
    t0 = performance.now();
    const blob = await PageThumbs.captureToBlob(t.linkedBrowser, { fullViewport: true });
    spike.log("C PageThumbs.captureToBlob ms", vx.ms(t0), blob && blob.type, blob && blob.size);
  }

  // ---- D. scrolled background tab: does the snapshot follow the scroll position? ----
  {
    const t = gBrowser.tabs[1];
    gBrowser.selectedTab = t;
    await spike.sleep(300);
    // scroll in content through the parent-side message manager-free route: a JSWindowActor-less eval
    await SpecialScroll(t.linkedBrowser, 900);
    await spike.sleep(300);
    const top = await snap(t.linkedBrowser, 0.25);
    gBrowser.selectedTab = gBrowser.tabs[0];
    await spike.sleep(400);
    const bg = await snap(t.linkedBrowser, 0.25);
    const docTop = await snap(t.linkedBrowser, 0.25, new DOMRect(0, 0, rect.width, rect.height));
    spike.log("D scrolled tab: selected", vx.stats(top, 16, 10), "as background", vx.stats(bg, 16, 10), "rect(0,0) document top", vx.stats(docTop, 16, 10));
  }

  // ---- D2. a minimized window (Electron could not capture hidden pages at all) ----
  {
    window.minimize();
    await spike.sleep(800);
    const t0 = performance.now();
    try {
      const bmp = await Promise.race([snap(gBrowser.tabs[2].linkedBrowser, 0.25), spike.sleep(4000).then(() => null)]);
      spike.log("D2 minimized window (windowState", window.windowState, "): background-tab snapshot", bmp ? bmp.width + "x" + bmp.height + " " + JSON.stringify(vx.stats(bmp, 16, 10)) : "TIMED OUT", vx.ms(t0), "ms");
      const bmp2 = await Promise.race([snap(gBrowser.selectedBrowser, 0.25), spike.sleep(4000).then(() => null)]);
      spike.log("D2 minimized window: selected-tab snapshot", bmp2 ? bmp2.width + "x" + bmp2.height + " " + JSON.stringify(vx.stats(bmp2, 16, 10)) : "TIMED OUT");
    } catch (e) {
      spike.log("D2 minimized snapshot failed", String(e));
    }
    window.restore();
    await spike.sleep(600);
  }

  // ---- E. discarded and lazy tabs ----
  const cache = new Map(); // tab -> { bmp, url, at }
  for (let i = 0; i < gBrowser.tabs.length; i++) cache.set(gBrowser.tabs[i], { bmp: bitmaps[i], at: Date.now() });
  {
    const t = gBrowser.tabs[5];
    const before = !!t.linkedBrowser.browsingContext;
    gBrowser.discardBrowser(t, true);
    await spike.sleep(300);
    const bc = t.linkedBrowser.browsingContext;
    spike.log("E discarded tab: had bc", before, "now linkedPanel", JSON.stringify(t.linkedPanel), "isConnected", t.linkedBrowser.isConnected, "bc", !!bc, "pending attr", t.hasAttribute("pending"));
    try {
      const bmp = await snap(t.linkedBrowser, 0.25);
      spike.log("E discarded drawSnapshot unexpectedly worked", bmp.width);
    } catch (e) {
      spike.log("E discarded drawSnapshot fails as expected:", String(e).slice(0, 120));
    }
    const lazy = vx.addTab(vx.page(13, "#444"), { createLazyBrowser: true });
    await spike.sleep(300);
    spike.log("E lazy tab: bc", !!lazy.linkedBrowser.browsingContext, "linkedPanel", JSON.stringify(lazy.linkedPanel), "pending", lazy.hasAttribute("pending"));
    gBrowser.removeTab(lazy);
    // PageThumbs storage fallback (moz-page-thumb://) for the discarded tab's URL
    const img = new Image();
    img.src = PageThumbs.getThumbnailURL(t.linkedBrowser.currentURI.spec);
    const stored = await new Promise((r) => {
      img.onload = () => r(img.naturalWidth);
      img.onerror = () => r(0);
      setTimeout(() => r(-1), 1500);
    });
    spike.log("E moz-page-thumb for discarded url naturalWidth", stored, "(0/-1 = nothing stored)");
  }

  // ---- F. the cache policy: refresh on TabSelect (outgoing + incoming) and on load stop ----
  const events = [];
  const refresh = async (tab, why) => {
    const b = tab.linkedBrowser;
    if (!b.browsingContext?.currentWindowGlobal) return;
    const t0 = performance.now();
    try {
      const bmp = await snap(b, bgScale);
      cache.get(tab)?.bmp?.close?.();
      cache.set(tab, { bmp, at: Date.now() });
      events.push(why + ":" + tab._tPos + ":" + vx.ms(t0) + "ms");
    } catch (e) {
      events.push(why + ":" + tab._tPos + ":ERR");
    }
  };
  gBrowser.tabContainer.addEventListener("TabSelect", (e) => {
    refresh(e.detail.previousTab, "leave");
    setTimeout(() => refresh(e.target, "enter"), 300);
  });
  gBrowser.tabContainer.addEventListener("TabClose", (e) => cache.delete(e.target));
  gBrowser.addTabsProgressListener({
    onStateChange(browser, wp, req, flags) {
      const F = Ci.nsIWebProgressListener;
      if (wp.isTopLevel && flags & F.STATE_STOP && flags & F.STATE_IS_NETWORK) {
        const tab = gBrowser.getTabForBrowser(browser);
        if (tab) setTimeout(() => refresh(tab, "load"), 250);
      }
    },
  });
  gBrowser.selectedTab = gBrowser.tabs[2];
  await spike.sleep(700);
  gBrowser.tabs[8].linkedBrowser.fixupAndLoadURIString(vx.page(99, "#00695c"), { triggeringPrincipal: vx.SYS });
  await spike.sleep(1500);
  spike.log("F cache refresh events", events);

  // ---- G. the grid overlay with 12 real thumbnails ----
  const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:rgba(16,16,20,.82);display:grid;" +
    "grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;padding:28px;align-content:start;box-sizing:border-box;font:12px Segoe UI,sans-serif;color:#fff");
  let drawn = 0;
  for (const t of gBrowser.tabs) {
    const cell = vx.el("div", "display:flex;flex-direction:column;gap:6px;min-width:0");
    const c = vx.el("canvas", "display:block;width:100%;height:auto;aspect-ratio:" + rect.width + "/" + rect.height + ";border-radius:10px;background:#333;" +
      (t.selected ? "outline:3px solid #4cc2ff" : ""));
    const entry = cache.get(t);
    if (entry?.bmp) {
      c.width = entry.bmp.width;
      c.height = entry.bmp.height;
      c.getContext("2d").drawImage(entry.bmp, 0, 0);
      drawn++;
    }
    cell.append(c, vx.el("div", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
      (t.hasAttribute("pending") ? "[discarded] " : "") + t.label));
    overlay.append(cell);
  }
  document.documentElement.append(overlay);
  spike.log("G overlay cells", overlay.children.length, "with thumbnails", drawn);
  await spike.capture("thumbs-grid");
  overlay.remove();
  await spike.capture("thumbs-after");

  // helper: scroll content of a remote browser from the parent
  async function SpecialScroll(browser, y) {
    // No actor of ours yet: use the built-in "scrollBy" through docShell-less path:
    // messageManager.loadFrameScript still works for remote browsers in 157.
    browser.messageManager.loadFrameScript("data:,content.scrollTo(0," + y + ")", false);
  }
});
