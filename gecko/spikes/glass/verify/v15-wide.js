// Risk check for the surface-root recipe: WebRender caps intermediate surfaces (Firefox's own CSS
// mentions a ~4096 device-pixel limit past which backdrop-filter "silently drops"). What happens to
// the page and the glass when the window is wider than 4096 device px (5K / ultrawide)?
// Tries to make the window VITRE_W px wide (Windows may clamp it to the desktop size).
//   VITRE_ROOT = 1 | 0 (surface root on/off)     VITRE_W = 4400
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  const W = Number(Services.env.get("VITRE_W") || 4400);
  const dpr = Services.env.get("VITRE_DPR");
  if (dpr) Services.prefs.setCharPref("layout.css.devPixelsPerPx", dpr);
  await spike.sleep(300);
  window.resizeTo(Math.round(W / window.devicePixelRatio), Math.round(600 / window.devicePixelRatio));
  window.moveTo(0, 40);
  await spike.sleep(800);
  G.hideFirefoxUI();
  const root = Services.env.get("VITRE_ROOT") !== "0";
  await G.go(G.sibling("page.html") + "?noanim=1");
  const tabbox = document.getElementById("tabbrowser-tabbox");
  if (root) tabbox.style.filter = "saturate(1.0001)";
  const L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
  const iw = window.innerWidth;
  for (const x of [40, Math.round(iw / 2) - 240, iw - 520]) G.el("div", `position:absolute; left:${x}px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1); outline:1px solid #f0f;`, L);
  // One backdrop-filter element wider than 4096 device px (a full-width single-element bar on a 5K display).
  G.el("div", `position:absolute; left:20px; top:130px; width:${iw - 40}px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1); outline:1px solid #0ff;`, L);
  G.el("div", `position:absolute; left:20px; top:190px; width:${Math.min(iw - 40, Math.floor(4000 / window.devicePixelRatio))}px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1); outline:1px solid #0ff;`, L);
  spike.log("surface root", root, "dpr", window.devicePixelRatio, "outer", window.outerWidth + "x" + window.outerHeight, "inner", window.innerWidth + "x" + window.innerHeight, "device px wide", Math.round(window.innerWidth * window.devicePixelRatio));
  await spike.sleep(900);
  await spike.capture("wide-" + (root ? "root" : "noroot"));
});
