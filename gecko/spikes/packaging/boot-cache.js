// Reports which version of each kind of file this run executed (driven by test-cache.py).
/* global spike, Services, ChromeUtils */
spike.main(async () => {
  await spike.loaded();
  const { VitreProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs");
  const css = getComputedStyle(document.getElementById("vitre-probe")).backgroundColor;
  spike.log("VERSIONS subscript(window.js)=" + JSON.stringify(window.VitreWindowProbe?.loaded) + " sys.mjs(VitreProbe.version)=" + VitreProbe.version + " css=" + css + " label=" + (Services.env.get("VITRE_CACHE_LABEL") || ""));
  // Stay up long enough for the startup cache / script preloader to be written like a normal session.
  await spike.sleep(Number(Services.env.get("VITRE_CACHE_WAIT") || 0) * 1000);
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); // normal shutdown first (flushes caches)
  await spike.sleep(4000);
});
