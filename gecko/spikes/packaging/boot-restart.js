// Dev loop: how long does an in-place restart take, and does it pick up edited sys.mjs code?
// Run 1 (no marker): records the module version, edits the module on disk, restarts the browser
// with Services.startup.quit(eAttemptQuit | eRestart). Run 2 (marker present): reports.
// Needs VITRE_APP pointing at a scratch copy of app/ (test-restart.py makes one).
/* global spike, Services, Ci, ChromeUtils, IOUtils, PathUtils */
(async () => {
  const marker = PathUtils.join(spike.outDir, "restart-marker.json");
  const { VitreProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs");
  await spike.loaded();
  if (!(await IOUtils.exists(marker))) {
    const file = PathUtils.join(Services.env.get("VITRE_APP"), "modules", "VitreProbe.sys.mjs");
    const src = await IOUtils.readUTF8(file);
    await IOUtils.writeUTF8(file, src.replace(/version: \d+,/, "version: 2,"));
    await IOUtils.writeJSON(marker, { t: Date.now(), version: VitreProbe.version, pid: Services.appinfo.processID });
    spike.log("RUN1 pid=" + Services.appinfo.processID + " VitreProbe.version=" + VitreProbe.version + " -> edited file to version 2, restarting in place");
    if (Services.env.get("VITRE_INVALIDATE")) Services.appinfo.invalidateCachesOnRestart();
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    return;
  }
  const m = await IOUtils.readJSON(marker);
  spike.log("RUN2 pid=" + Services.appinfo.processID + " (was " + m.pid + ") restart took " + (Date.now() - m.t) + " ms until the window was ready; VitreProbe.version=" + VitreProbe.version + " (was " + m.version + ")");
  spike.log((VitreProbe.version === 2 ? "PASS" : "FAIL") + " R1 in-place restart runs the edited sys.mjs");
  await spike.capture("restart-after");
  spike.quit();
})();
