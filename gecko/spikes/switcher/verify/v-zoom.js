// VERIFY switcher/thumbnails + theme: page zoom. drawSnapshot's scale is relative to the page's CSS
// pixels, so a zoomed tab gives a different bitmap size unless the scale is multiplied by the zoom
// (Firefox's own tabs.captureTab does `scale * zoom`, ext-tabs-base.js).
// Run: python tools/run.py --boot spikes/switcher/verify/v-zoom.js --name switcher-verify-vzoom --out spikes/switcher/verify/out/v-zoom --timeout 90
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  const first = gBrowser.selectedTab;
  const t = vx.addTab("https://en.wikipedia.org/wiki/Gecko_(software)");
  await vx.waitLoaded(t.linkedBrowser);
  gBrowser.selectedTab = t;
  gBrowser.removeTab(first);
  await spike.sleep(600);
  const b = t.linkedBrowser;
  const r = b.getBoundingClientRect();
  const snap = (scale, rect = null) => {
    b.getBoundingClientRect();
    return b.browsingContext.currentWindowGlobal.drawSnapshot(rect, scale, "white");
  };
  for (const zoom of [1, 1.5, 0.67]) {
    b.fullZoom = zoom;
    await spike.sleep(700);
    const plain = await snap(0.5);
    const fixed = await snap(0.5 * zoom);
    spike.log("zoom", zoom, "(browser.fullZoom", b.fullZoom + ") browser", r.width + "x" + r.height, "| drawSnapshot(null, 0.5) ->", plain.width + "x" + plain.height,
      "| drawSnapshot(null, 0.5 * fullZoom) ->", fixed.width + "x" + fixed.height);
  }
  b.fullZoom = 1;
});
