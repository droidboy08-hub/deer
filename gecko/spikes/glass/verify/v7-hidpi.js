// Verify claim 22 (HiDPI): run another boot script at a forced devicePixelRatio.
// tools/run.py writes numeric --pref values as numbers, but layout.css.devPixelsPerPx is a STRING pref,
// so it is set here at runtime instead.
//   VITRE_DPR = 1.5 | 2 ...      VITRE_INNER = v4-parent.js | ../boot7-bar.js (path relative to verify/)
/* global spike, Services, window, Ci */
(() => {
  const dpr = Services.env.get("VITRE_DPR") || "1.5";
  const inner = Services.env.get("VITRE_INNER") || "v4-parent.js";
  Services.prefs.setCharPref("layout.css.devPixelsPerPx", dpr);
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const here = res.resolveURI(Services.io.newURI("resource://vitre-boot/"));
  res.setSubstitution("vitre-glass", Services.io.newURI(here + "../"));
  const url = inner.startsWith("../") ? "resource://vitre-glass/" + inner.slice(3) : "resource://vitre-boot/" + inner;
  window.setTimeout(() => {
    spike.log("devicePixelRatio now", window.devicePixelRatio, "running", url);
    Services.scriptloader.loadSubScript(url, window);
  }, 800);
})();
