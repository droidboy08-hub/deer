// VERIFY switcher/live deck: real sites, kept live for several seconds, a tab switch while live,
// and clean-up. (The spike ran three generated pages for about 1.4 s.)
// Run: python tools/run.py --boot spikes/switcher/verify/v-live.js --name switcher-verify-vlive --out spikes/switcher/verify/out/v-live --timeout 150
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const clock = `<p id=t style="margin:20px 80px;font-size:40px"></p><script>setInterval(()=>t.textContent='live clock '+(performance.now()/1000).toFixed(1),100)</script>`;
  const first = gBrowser.selectedTab;
  const tabs = [vx.addTab("https://en.wikipedia.org/wiki/Gecko_(software)"), vx.addTab("https://example.com/"), vx.addTab(vx.page(3, "#1a4fa3", "#fff", clock)), vx.addTab(vx.page(4, "#7a3e9d", "#fff", clock))];
  for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
  gBrowser.removeTab(first);
  gBrowser.selectedTab = tabs[0];
  await spike.sleep(800);
  const panelOf = (t) => document.getElementById(t.linkedPanel);
  const state = () => tabs.map((t) => ({ sel: t.selected, active: t.linkedBrowser.docShellIsActive, renderLayers: t.linkedBrowser.renderLayers, hasLayers: t.linkedBrowser.hasLayers }));
  spike.log("before:", state());

  window.windowUtils.loadSheetUsingURIString("data:text/css," + encodeURIComponent(
    "#tabbrowser-tabpanels > [vitre-live] { -moz-subtree-hidden-only-visually: 0 !important; visibility: inherit !important; }"), window.windowUtils.AGENT_SHEET);
  gBrowser.tabpanels.style.background = "#20242c";
  const place = (t, tx, ty, z) => {
    const p = panelOf(t);
    p.setAttribute("vitre-live", "true");
    p.style.transformOrigin = "50% 50%";
    p.style.transform = `translate(${tx}%, ${ty}%) scale(0.46)`;
    p.style.borderRadius = "24px";
    p.style.overflow = "clip";
    p.style.zIndex = String(z);
    t.linkedBrowser.docShellIsActive = true;
  };
  place(tabs[0], -25, -25, 4);
  place(tabs[1], 25, -25, 3);
  place(tabs[2], -25, 25, 2);
  place(tabs[3], 25, 25, 1);
  await spike.sleep(1200);
  spike.log("live x4:", state());
  await spike.capture("v-live-4-real");
  await spike.sleep(5000);
  spike.log("live x4 after 6 s:", state());
  await spike.capture("v-live-4-real-6s");

  // a tab switch while the panels are live (the async tab switcher runs)
  gBrowser.selectedTab = tabs[2];
  await spike.sleep(2500);
  spike.log("after selecting tab 3 while live (+2.5 s):", state());
  await spike.capture("v-live-after-switch");
  // repair: re-assert the outgoing tab (what the deck must do on TabSelect while it is animating)
  tabs[0].linkedBrowser.docShellIsActive = true;
  await spike.sleep(1200);
  spike.log("after re-asserting docShellIsActive on the outgoing tab:", state());
  await spike.capture("v-live-after-switch-reasserted");
  // how long does the outgoing tab keep its layers after a switch? (time budget for the deck animation)
  {
    gBrowser.selectedTab = tabs[3];
    const t0 = performance.now();
    let lost = null;
    for (let i = 0; i < 300 && lost === null; i++) {
      if (!tabs[2].linkedBrowser.hasLayers || !tabs[2].linkedBrowser.docShellIsActive) lost = performance.now() - t0;
      await spike.sleep(10);
    }
    spike.log("outgoing tab lost its layers", lost === null ? "never (3 s)" : lost.toFixed(0) + " ms after the switch");
    gBrowser.selectedTab = tabs[2];
    await spike.sleep(600);
  }

  // clean-up exactly as the recipe says
  for (const t of tabs) {
    const p = panelOf(t);
    p.removeAttribute("style");
    p.removeAttribute("vitre-live");
    if (!t.selected) t.linkedBrowser.docShellIsActive = false;
  }
  gBrowser.tabpanels.style.background = "";
  await spike.sleep(1500);
  spike.log("after clean-up:", state());
  await spike.capture("v-live-cleaned");
  // and an ordinary switch still works afterwards
  gBrowser.selectedTab = tabs[1];
  await spike.sleep(800);
  spike.log("ordinary switch afterwards:", state());
  await spike.capture("v-live-ordinary-switch");
});
