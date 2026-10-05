// VERIFY (claim 31): with no window left and a download running, can a window be opened again,
// and does the process then stay alive after the download finishes (instead of quitting)?
import { setInterval, clearInterval, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { SHA } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { VitreDownloads } from "resource://vitre-boot/engine/VitreDownloads.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";

const windows = () => [...Services.wm.getEnumerator("navigator:browser")].filter((w) => !w.closed).length;
const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

export function watchReopen(id) {
  const t0 = Date.now();
  const stamp = () => `+${Date.now() - t0} ms`;
  for (const topic of ["quit-application-requested", "quit-application-granted", "quit-application", "xul-window-destroyed"]) {
    Services.obs.addObserver((_s, t, data) => log(`  ${stamp()}  ${t}${data ? " (" + data + ")" : ""}`), topic);
  }
  let reopened = null;
  setTimeout(() => {
    const before = windows();
    const v = VitreDownloads.list().find((x) => x.id === id);
    log(`  ${stamp()}  no window for 3 s: windows ${before}, download ${v.state} ${Math.round((100 * v.received) / v.total)}%, ${v.connections} connections`);
    const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
    reopened = BrowserWindowTracker.openWindow({});
    Services.obs.addObserver(function obs(subject) {
      if (subject !== reopened) return;
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      const now = VitreDownloads.list().find((x) => x.id === id);
      check("a new browser window opens from the windowless state while the download carries on", windows() === 1 && before === 0 && now.state === "downloading", `${stamp()}: windows ${before} -> ${windows()}, download ${now.state} ${Math.round((100 * now.received) / now.total)}%`);
      log("@@capture lifecycle2-reopened");
    }, "browser-delayed-startup-finished");
  }, 3000);
  VitreDownloads.whenSettled(id).then(async (v) => {
    const sha = v.state === "completed" ? await IOUtils.computeHexDigest(v.path, "sha256") : "";
    check("the download finished", v.state === "completed" && sha === SHA.big, `${stamp()}, state ${v.state}, sha256 ${sha === SHA.big ? "ok" : "MISMATCH"}, windows ${windows()}`);
    await IOUtils.remove(v.path, { ignoreAbsent: true });
    // The survival area has been left. With a window open the pending last-window quit must NOT happen.
    setTimeout(() => {
      check("with a window open again, finishing the download does not quit the app", windows() === 1 && !Services.startup.shuttingDown, `${stamp()}: windows ${windows()}, shuttingDown ${Services.startup.shuttingDown}`);
      log("@@quit");
      Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
    }, 3000);
  });
}
