// VERIFY switcher/thumbnails of discarded tabs: the spike says "not possible, use the cache".
// A tab cannot be captured AFTER it is discarded, but every discard goes through
// gBrowser.discardBrowser(tab, force). Wrapping that one method lets Vitre start a snapshot in the
// same tick, just before the browser is torn down. Does that snapshot resolve, reliably, also for
// real sites and for Firefox's own low-memory unloader?
// Run: python tools/run.py --boot spikes/switcher/verify/v-discard.js --name switcher-verify-vdisc --out spikes/switcher/verify/out/v-discard --timeout 180 --pref browser.tabs.min_inactive_duration_before_unload=0
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const dpr = window.devicePixelRatio;
  const urls = ["https://en.wikipedia.org/wiki/Firefox", "https://en.wikipedia.org/wiki/Gecko_(software)", "https://example.com/", "https://www.mozilla.org/en-US/", "https://news.ycombinator.com/",
    vx.page(6, "#0b7285"), vx.page(7, "#ffffff", "#111"), vx.page(8, "#101014")];
  const first = gBrowser.selectedTab;
  const tabs = urls.map((u) => vx.addTab(u));
  for (const t of tabs) await vx.waitLoaded(t.linkedBrowser, 30000);
  const keep = vx.addTab(vx.page(0, "#444"));
  await vx.waitLoaded(keep.linkedBrowser);
  gBrowser.selectedTab = keep;
  gBrowser.removeTab(first);
  await spike.sleep(1500);

  // ---- the wrapper (what Vitre would install once per window) ----
  const cache = new Map(); // tab -> { bmp, why }
  const log = [];
  const original = gBrowser.discardBrowser;
  gBrowser.discardBrowser = function (tab, force) {
    const b = tab.linkedBrowser;
    const wgp = b?.browsingContext?.currentWindowGlobal;
    if (wgp && !tab.selected) {
      const t0 = performance.now();
      try {
        b.getBoundingClientRect();
        wgp.drawSnapshot(null, 0.5 * dpr, "white").then(
          (bmp) => {
            cache.set(tab, { bmp, why: "at-discard" });
            log.push(tab.label.slice(0, 22) + ": RESOLVED " + bmp.width + "x" + bmp.height + " in " + (performance.now() - t0).toFixed(0) + "ms");
          },
          (e) => log.push(tab.label.slice(0, 22) + ": REJECTED " + String(e).slice(0, 60))
        );
      } catch (e) {
        log.push(tab.label.slice(0, 22) + ": THREW " + String(e).slice(0, 60));
      }
    }
    return original.call(this, tab, force);
  };

  // A. explicit discards, one after another and three in the same tick
  for (const t of tabs.slice(0, 3)) {
    const ok = gBrowser.discardBrowser(t, true);
    await spike.sleep(400);
    if (!ok) log.push(t.label + ": discardBrowser returned false");
  }
  for (const t of tabs.slice(3, 6)) gBrowser.discardBrowser(t, true);
  await spike.sleep(1500);
  spike.log("A explicit discards through the wrapper:", log.splice(0));
  spike.log("A states:", tabs.slice(0, 6).map((t) => (t.hasAttribute("pending") ? "pending" : "LOADED") + (cache.has(t) ? "+thumb" : "+NONE")));

  // B. Firefox's own low-memory unloader (TabUnloader) goes through the same method
  {
    const { TabUnloader } = ChromeUtils.importESModule("moz-src:///browser/components/tabbrowser/TabUnloader.sys.mjs");
    const before = gBrowser.tabs.filter((t) => t.hasAttribute("pending")).length;
    let r1, r2;
    try {
      r1 = await TabUnloader.unloadLeastRecentlyUsedTab(0);
      r2 = await TabUnloader.unloadLeastRecentlyUsedTab(0);
    } catch (e) {
      r1 = "THREW " + e;
    }
    await spike.sleep(1500);
    spike.log("B TabUnloader.unloadLeastRecentlyUsedTab() x2 ->", r1, r2, "| pending tabs", before, "->", gBrowser.tabs.filter((t) => t.hasAttribute("pending")).length, "| wrapper saw:", log.splice(0));
  }

  // overlay with the thumbnails captured at discard time
  const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:#14161c;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:18px;" +
    "align-content:start;box-sizing:border-box;font:12px Segoe UI,sans-serif;color:#fff");
  for (const t of tabs) {
    const cell = vx.el("div", "min-width:0");
    const c = vx.el("canvas", "display:block;width:100%;aspect-ratio:1264/707;border-radius:8px;background:#333;outline:1px solid #4cc2ff");
    const e = cache.get(t);
    if (e) {
      c.width = e.bmp.width;
      c.height = e.bmp.height;
      c.getContext("2d").drawImage(e.bmp, 0, 0);
    }
    cell.append(c, vx.el("div", "", (t.hasAttribute("pending") ? "[discarded" + (e ? ", captured at discard] " : ", NO THUMB] ") : "[still loaded] ") + t.label));
    overlay.append(cell);
  }
  document.documentElement.append(overlay);
  await spike.capture("v-discard-thumbs");
  overlay.remove();

  // C. selecting a discarded tab reloads it (and the normal cache refresh takes over)
  gBrowser.selectedTab = tabs[2];
  await spike.sleep(500);
  await vx.waitLoaded(tabs[2].linkedBrowser);
  spike.log("C discarded tab selected again ->", tabs[2].linkedBrowser.currentURI.spec, "pending", tabs[2].hasAttribute("pending"), "has browsingContext", !!tabs[2].linkedBrowser.browsingContext);
});
