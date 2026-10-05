// SPIKE switcher/2: can a tab's <browser> be shown live, scaled, for the deck animation?
// Run: python tools/run.py --boot spikes/switcher/live.js --name switcher-live --out spikes/switcher/out/live --timeout 120
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const anim = `<div style="width:120px;height:120px;border-radius:60px;background:#4cc2ff;margin:0 80px;animation:m 1s infinite alternate"></div>` +
    `<style>@keyframes m{to{transform:translateX(600px)}}</style><p id=t style="margin:20px 80px"></p>` +
    `<script>setInterval(()=>t.textContent='live clock '+(performance.now()/1000).toFixed(1),100)</script>`;
  const first = gBrowser.selectedTab;
  const tabs = [1, 2, 3].map((n) => vx.addTab(vx.page(n, vx.COLOURS[n - 1], "#fff", anim)));
  for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
  gBrowser.removeTab(first);
  gBrowser.selectedTab = tabs[0];
  await spike.sleep(600);

  const panels = gBrowser.tabpanels;
  const panelOf = (t) => document.getElementById(t.linkedPanel);
  spike.log("tabpanels display", getComputedStyle(panels).display, "children", panels.children.length);

  // ---- a. the selected panel, scaled with a CSS transform ----
  const p0 = panelOf(tabs[0]);
  p0.style.transformOrigin = "50% 50%";
  p0.style.transition = "transform 300ms cubic-bezier(.2,.8,.2,1)";
  p0.style.transform = "scale(0.62)";
  p0.style.borderRadius = "24px";
  p0.style.overflow = "clip";
  p0.style.boxShadow = "0 30px 80px rgba(0,0,0,.5)";
  panels.style.background = "#20242c";
  await spike.sleep(700);
  await spike.capture("live-scaled-selected");
  // is it still live? the clock text changes between two snapshots of the page
  const snap = () => tabs[0].linkedBrowser.browsingContext.currentWindowGlobal.drawSnapshot(null, 0.5, "white");
  const a = vx.stats(await snap(), 64, 40);
  await spike.sleep(450);
  const b = vx.stats(await snap(), 64, 40);
  spike.log("a. scaled selected panel; page still animating (two samples differ):", a, b);

  // ---- b. two more panels made visible beside it (background tabs shown live) ----
  // Non-selected panels are hidden by xul.css with -moz-subtree-hidden-only-visually: 1. That
  // property is refused in inline styles (probe.js), so it is overridden from an agent sheet.
  const sheet = "data:text/css," + encodeURIComponent(
    "#tabbrowser-tabpanels > [vitre-live] { -moz-subtree-hidden-only-visually: 0 !important; visibility: inherit !important; }");
  window.windowUtils.loadSheetUsingURIString(sheet, window.windowUtils.AGENT_SHEET);
  const show = (t, tx) => {
    const p = panelOf(t);
    p.setAttribute("vitre-live", "true");
    p.style.transform = `translateX(${tx}%) scale(0.5)`;
    p.style.borderRadius = "24px";
    p.style.overflow = "clip";
    p.style.zIndex = "1";
    t.linkedBrowser.docShellIsActive = true; // asks the content process to render layers
    return p;
  };
  p0.style.transform = "translateX(0%) scale(0.5)";
  p0.style.zIndex = "2";
  show(tabs[1], -40);
  show(tabs[2], 40);
  await spike.sleep(900);
  spike.log("b. renderLayers/hasLayers", tabs.map((t) => [t.linkedBrowser.renderLayers, t.linkedBrowser.hasLayers, t.linkedBrowser.docShellIsActive]));
  await spike.capture("live-three-panels");
  await spike.sleep(500);
  await spike.capture("live-three-panels-later");

  // ---- c. restore and make sure nothing sticks ----
  for (const t of tabs) {
    const p = panelOf(t);
    p.removeAttribute("style");
    p.removeAttribute("vitre-live");
    if (!t.selected) t.linkedBrowser.docShellIsActive = false;
  }
  panels.style.background = "";
  await spike.sleep(600);
  await spike.capture("live-restored");
  // input mapping under a transform: synthesize a click at a scaled position and see where content receives it
  p0.style.transform = "scale(0.5)";
  p0.style.transformOrigin = "0 0";
  await spike.sleep(400);
  const mm = tabs[0].linkedBrowser.messageManager;
  const got = new Promise((r) => {
    mm.addMessageListener("vx:click", (m) => r(m.data));
    setTimeout(() => r(null), 2500);
  });
  mm.loadFrameScript("data:,addEventListener('mousedown',e=>sendAsyncMessage('vx:click',{x:e.clientX,y:e.clientY}),true)", false);
  await spike.sleep(300);
  const r = tabs[0].linkedBrowser.getBoundingClientRect();
  spike.log("c. scaled browser rect", r.x, r.y, r.width, r.height);
  vx.EU().synthesizeMouseAtPoint(r.x + 100, r.y + 100, {}, window);
  spike.log("c. click at chrome (+100,+100) inside 0.5-scaled browser arrives in content at", await got, "(expected about 200,200)");
});
