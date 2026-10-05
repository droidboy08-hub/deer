// VERIFY switcher/settings: do vitre.* prefs survive WITHOUT savePrefFile and WITHOUT a clean quit?
// (The spike's run 1 called Services.prefs.savePrefFile(null) before quitting, so its run 2 did not prove this.)
// Run 1: python tools/run.py --boot spikes/switcher/verify/v-settings-kill.js --name switcher-verify-vkill --out spikes/switcher/verify/out/v-settings-kill1 --timeout 60
//        (the script never asks Firefox to quit: it writes the runner's quit marker and the runner taskkills /F)
// Run 2: same command with --keep-profile and --out .../v-settings-kill2
/* global Services, spike, IOUtils, PathUtils */
(async () => {
  const { VitreSettings } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreSettings.sys.mjs");
  VitreSettings.init();
  const marker = PathUtils.join(PathUtils.profileDir, "vx-kill-marker.txt");
  const prefsFile = PathUtils.join(PathUtils.profileDir, "prefs.js");
  const vitreLines = async () => (await IOUtils.readUTF8(prefsFile).catch(() => "")).split("\n").filter((l) => l.includes('"vitre.')).length;
  const WANT = { theme: "dark", connections: 16, homeBackground: { kind: "image", path: "D:\\Médias\\Zoë\\Pictures\\море #1.png" }, rebind: { peek: "Ctrl+E" }, barAutoHide: true };
  if (!(await IOUtils.exists(marker))) {
    await IOUtils.writeUTF8(marker, "1");
    const t0 = performance.now();
    VitreSettings.set(WANT);
    const seen = [];
    for (const at of [0, 100, 250, 500, 750, 1000, 1500, 2500]) {
      await spike.sleep(Math.max(0, at - (performance.now() - t0)));
      seen.push(at + "ms:" + (await vitreLines()));
    }
    spike.log("RUN 1 set() without savePrefFile; vitre.* lines in prefs.js over time:", seen);
    spike.log("RUN 1 now the runner hard-kills the process (taskkill /F), no quit is requested");
    spike.log("@@quit");
    return;
  }
  const s = VitreSettings.get();
  const ok = s.theme === WANT.theme && s.connections === WANT.connections && s.homeBackground.kind === "image" && s.homeBackground.path === WANT.homeBackground.path &&
    JSON.stringify(s.rebind) === JSON.stringify(WANT.rebind) && s.barAutoHide === true;
  spike.log("RUN 2 after a hard kill, settings equal what run 1 set:", ok, { theme: s.theme, connections: s.connections, homeBackground: s.homeBackground, rebind: s.rebind, barAutoHide: s.barAutoHide });
  spike.quit();
})();
