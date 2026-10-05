// VERIFY (claim 31): close the last window with a download running, then open a window again.
/* global spike, ChromeUtils, Services, IOUtils, PathUtils, window, BrowserCommands */
if (Services.prefs.getBoolPref("vitre.verify.started", false)) {
  // the reopened window: not the test
} else {
  Services.prefs.setBoolPref("vitre.verify.started", true);
  (async () => {
    try {
      const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
      const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
      const { watchReopen } = ChromeUtils.importESModule("resource://vitre-boot/engine/VerifyLifecycle.sys.mjs");
      await spike.resize(1100, 700);
      const dir = PathUtils.join(H.DATA, "downloads-lifecycle2");
      await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
      await VitreDownloads.init({ dir, connections: 8, keepAliveWithoutWindows: true });
      const id = VitreDownloads.start(`${H.BASE}/blob/big?rate=2048`, { filename: "lifecycle2.bin", named: true });
      while ((VitreDownloads.list().find((v) => v.id === id)?.received ?? 0) < 20 * 1048576) await spike.sleep(50);
      watchReopen(id);
      spike.log("closing the last window");
      BrowserCommands.tryToCloseWindow({});
    } catch (e) {
      spike.log("ERROR " + e + "\n" + (e.stack || ""));
      spike.quit();
    }
  })();
}
