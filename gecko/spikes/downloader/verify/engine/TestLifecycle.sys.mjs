// Spike test 7 (system scope half): what the engine does once there is no window left.
// The boot script starts a download and closes the last browser window; everything logged from
// here on proves the engine is alive without any window, and that the process leaves by itself
// when the download is done.
import { setInterval, clearInterval } from "resource://gre/modules/Timer.sys.mjs";
import { SHA, markQuitWhenStored } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { VitreDownloads } from "resource://vitre-boot/engine/VitreDownloads.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";

const windows = () => [...Services.wm.getEnumerator("navigator:browser")].filter((w) => !w.closed).length;

export function watchBackground(id) {
  const t0 = Date.now();
  markQuitWhenStored(VitreDownloads.storePath);
  let last = -1;
  const timer = setInterval(() => {
    const v = VitreDownloads.list().find((x) => x.id === id);
    const pct = Math.floor((10 * v.received) / v.total) * 10;
    if (pct !== last) {
      last = pct;
      log(`  +${Date.now() - t0} ms  [system scope] ${pct}% (${v.received} bytes, ${v.connections} connections, ${Math.round(v.speed / 1024)} kB/s) - browser windows open: ${windows()}`);
    }
  }, 100);
  VitreDownloads.whenSettled(id).then(async (v) => {
    clearInterval(timer);
    const sha = v.state === "completed" ? await IOUtils.computeHexDigest(v.path, "sha256") : "";
    log(`${v.state === "completed" && sha === SHA.big && windows() === 0 ? "PASS" : "FAIL"} the download finished with no window open - state ${v.state}, sha256 ${sha === SHA.big ? "ok" : "MISMATCH"}, browser windows open: ${windows()}, +${Date.now() - t0} ms`);
    log("  (nothing asks Firefox to quit from here: leaving the survival area lets the pending last-window quit go ahead)");
    await IOUtils.remove(v.path, { ignoreAbsent: true });
  });
}
