// VERIFY switcher/claim 15 (partial): a picture of Firefox's own Ctrl+Tab panel. The runner's
// PrintWindow capture misses XUL popups (separate OS window). Try an in-process route instead:
// drawSnapshot of the CHROME document while the panel is open, written to <out>/v-panel-chrome.png.
// Run: python tools/run.py --boot spikes/switcher/verify/v-panel.js --name switcher-verify-vpanel --out spikes/switcher/verify/out/v-panel --timeout 90
/* global gBrowser, Services, Ci, Cc, spike, vx, ctrlTab, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  const EU = vx.EU();
  const first = gBrowser.selectedTab;
  const tabs = [1, 2, 3, 4].map((n) => vx.addTab(vx.page(n, vx.COLOURS[n - 1])));
  for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
  gBrowser.removeTab(first);
  for (const i of [2, 0, 3, 1]) {
    gBrowser.selectedTab = tabs[i];
    await spike.sleep(300);
  }
  Services.prefs.setBoolPref("browser.ctrlTab.sortByRecentlyUsed", true);
  await spike.sleep(200);
  gBrowser.selectedBrowser.focus();
  EU.synthesizeKey("KEY_Control", { type: "keydown" }, window);
  EU.synthesizeKey("KEY_Tab", { ctrlKey: true }, window);
  await spike.sleep(900);
  const p = ctrlTab.panel;
  const r = p.getBoundingClientRect();
  spike.log("panel state", p.state, "rect", Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), "previews", ctrlTab.previews?.length);
  const save = async (name, bmp) => {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    await IOUtils.write(PathUtils.join(spike.outDir, name + ".png"), new Uint8Array(await blob.arrayBuffer()));
    return vx.stats(bmp, 64, 40);
  };
  try {
    const whole = await window.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0, 0, window.innerWidth, window.innerHeight), 1, "white");
    spike.log("chrome drawSnapshot (whole window) saved:", whole.width + "x" + whole.height, await save("v-panel-chrome", whole));
  } catch (e) {
    spike.log("chrome drawSnapshot failed", String(e));
  }
  await spike.capture("v-panel-printwindow");
  EU.synthesizeKey("KEY_Control", { type: "keyup" }, window);
  await spike.sleep(300);
  Services.prefs.clearUserPref("browser.ctrlTab.sortByRecentlyUsed");
});
