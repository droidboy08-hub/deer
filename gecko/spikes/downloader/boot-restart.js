// Spike 2b: resume after a restart from the persisted segment map (<profile>/vitre-downloads.json).
// Three runs on the same profile (go.py --phase 1|2|3, the last two with --keep-profile):
//   1: start a 256 MiB download, and at 25-40% the process is KILLED (taskkill /F, no shutdown code runs).
//   2: the list is loaded (the download comes back paused), resumed, and at ~75% Firefox quits
//      normally (at ~70%): the AsyncShutdown blocker pauses the transfer and writes the store.
//   3: resumed again, completes; the file's sha256 must match.
/* global spike, ChromeUtils, Services, Ci, IOUtils, PathUtils */
(async () => {
  const phase = Services.env.get("VITRE_DL_PHASE");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const TOTAL = 268435456;
  try {
    await spike.resize(1100, 700);
    const dir = PathUtils.join(H.DATA, "downloads-restart");
    if (phase === "1") await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    const loaded = await VitreDownloads.init({ dir, connections: 8 });
    Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
    window.vitreOverlay.setNote("restart test, phase " + phase);
    spike.log(`phase ${phase}: store ${VitreDownloads.storePath}`);
    spike.log(`phase ${phase}: loaded ${loaded.length} download(s): ` + JSON.stringify(loaded.map((v) => ({ file: v.filename, state: v.state, received: v.received, total: v.total, resumable: v.resumable }))));
    await H.serverReset();

    let id;
    if (phase === "1") {
      id = VitreDownloads.start(`${H.BASE}/blob/big?rate=2048`, { filename: "restart-test.bin", named: true });
    } else {
      id = loaded[0].id;
      VitreDownloads.resume(id);
    }
    const startedAt = loaded[0]?.received ?? 0;
    const until = async (fraction) => {
      for (;;) {
        const v = VitreDownloads.list().find((x) => x.id === id);
        if (v.state === "failed" || v.state === "completed" || v.received >= fraction * TOTAL) return v;
        await spike.sleep(50);
      }
    };

    if (phase === "1") {
      await until(0.25);
      await spike.capture("restart-1-before-kill");
      const saved = await IOUtils.readJSON(VitreDownloads.storePath);
      const rec = saved.items[0];
      const now = VitreDownloads.list()[0];
      spike.log(`phase 1: the engine has ${now.received} bytes; the store on disk (saved every second while running) says ${rec.received} in ${rec.file.segments.length} segments, state "${rec.state}"`);
      spike.log("phase 1: KILL (the runner taskkills the process; no quit code runs)");
      // "@@quit" makes tools/run.py kill the process tree. Services.startup.quit is NOT called.
      spike.log("@@quit");
      return;
    }
    if (phase === "2") {
      const v = await until(0.7);
      await spike.capture("restart-2-before-quit");
      const stats = await H.serverStats();
      const ranges = stats.requests.filter((q) => q.status === 206 && q.end > q.start);
      spike.log(`phase 2: resumed from ${startedAt}; now ${v.received}; ${ranges.length} ranged requests, all with If-Range: ${ranges.every((q) => q.ifrange)}; first offsets ${ranges.slice(0, 8).map((q) => q.start).join(",")}`);
      spike.log("phase 2: normal quit (quit-application-requested -> confirmQuit -> AsyncShutdown blocker)");
      VitreDownloads.confirmQuit = (n) => {
        spike.log(`phase 2: confirmQuit asked about ${n} running download(s): answering yes`);
        return true;
      };
      H.markQuitWhenStored(VitreDownloads.storePath);
      // The same path as the menu's Exit: notifies quit-application-requested, then quits.
      window.goQuitApplication({});
      return;
    }
    const v = await until(2);
    await spike.sleep(400);
    const stats = await H.serverStats();
    const sent = stats.requests.filter((q) => q.status === 206 && q.end > q.start).reduce((n, q) => n + (q.sent || 0), 0);
    const path = PathUtils.join(dir, "restart-test.bin");
    const sha = await IOUtils.computeHexDigest(path, "sha256");
    spike.log(`phase 3: resumed from ${startedAt}; final state ${v.state}; this run fetched ${sent} bytes (${(100 * sent / TOTAL).toFixed(1)}% of the file)`);
    spike.log(`${sha === H.SHA.big ? "PASS" : "FAIL"} restart resume: sha256 of the finished file ${sha === H.SHA.big ? "matches" : "DIFFERS"} after a kill and a normal quit mid-download`);
    await spike.capture("restart-3-done");
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  } catch (e) {
    spike.log("ERROR " + e + "\n" + (e.stack || ""));
  }
  spike.quit();
})();
