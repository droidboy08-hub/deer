// PROBE: what does drawSnapshot return for an in-process (parent) browser such as Home?
// Run: python tools/run.py --boot spikes/switcher/probe-home-snapshot.js --name switcher-probe-home --out spikes/switcher/out/probe-home --timeout 60
/* global gBrowser, Services, Ci, Cc, spike, vx, BrowserCommands */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
  VitreHomeAbout.register("resource://vitre-boot/");
  BrowserCommands.openTab();
  const home = gBrowser.selectedTab;
  const hb = home.linkedBrowser;
  for (let i = 0; i < 200 && !hb.contentDocument?.documentElement?.dataset?.ready; i++) await spike.sleep(25);
  const r = hb.getBoundingClientRect();
  spike.log("browser rect", r.x, r.y, r.width, r.height, "content inner", hb.contentWindow.innerWidth, hb.contentWindow.innerHeight);
  const wgp = hb.browsingContext.currentWindowGlobal;
  const shots = [];
  const take = async (label, rect, scale) => {
    const t0 = performance.now();
    try {
      const bmp = await wgp.drawSnapshot(rect, scale, "white");
      spike.log(label, bmp.width + "x" + bmp.height, vx.ms(t0), "ms");
      shots.push([label + " " + bmp.width + "x" + bmp.height, bmp]);
    } catch (e) {
      spike.log(label, "FAILED", String(e));
    }
  };
  await take("selected null rect @0.5", null, 0.5);
  await take("selected DOMRect(0,0,w,h) @0.5", new DOMRect(0, 0, r.width, r.height), 0.5);
  // as a background tab
  const other = vx.addTab(vx.page(1, "#246"));
  await vx.waitLoaded(other.linkedBrowser);
  gBrowser.selectedTab = other;
  await spike.sleep(500);
  await take("background null rect @0.5", null, 0.5);
  await take("background DOMRect(0,0,w,h) @0.5", new DOMRect(0, 0, r.width, r.height), 0.5);
  const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:#223;display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px;color:#fff;font:13px Segoe UI");
  for (const [label, bmp] of shots) {
    const cell = vx.el("div", "min-height:0");
    const c = vx.el("canvas", "max-width:100%;max-height:300px;outline:1px solid #4cc2ff");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    cell.append(vx.el("div", "", label), c);
    overlay.append(cell);
  }
  document.documentElement.append(overlay);
  await spike.capture("probe-home-snapshots");
});
