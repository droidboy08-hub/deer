// The staged setup replaced on disk after the person clicked "Restart to update", run by
// tests/update/all.py (one start, run.py --until-exit; the stand-in setup must never be started).
//   1. While the downloads quit prompt holds the restart back, the file is replaced (same size, other
//      bytes). The prompt's "Restart" checks it again: refused (failed, the download was damaged),
//      Deer stays, the file is removed.
//   2. Downloaded again, clicked again; this time the file is replaced after Deer granted the quit
//      (quit-application-granted), just before the setup would start. At quit-application the updater
//      holds the file, hashes it, finds it changed: nothing is started (lastLaunch.refused) and the
//      file is removed. all.py checks that the stand-in setup never ran.
/* global spike, Services, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, waitFor, log } = spike;
  const b = window.vitre;
  const { Up } = U;
  const st = () => Up.state();
  await spike.resize(1280, 860);
  await spike.activate();
  Services.prefs.setIntPref("vitre.update.firstDelay", 86400);
  const DAMAGED = "The downloaded update was damaged, so Deer deleted it; check for updates to download it again.";

  const dir = await U.fakeInstall();
  await U.use(dir);
  let r = await U.run("newer");
  check("1.5.0 staged", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);
  const setup = PathUtils.join(Up.updatesDir(), "Deer-Setup-1.5.0.exe");
  const pyw = Services.env.get("UPTEST_PYTHONW");
  const fake = Services.env.get("UPTEST_FAKE_SETUP");
  const result = Services.env.get("UPTEST_SETUP_RESULT");
  Services.prefs.setStringPref("vitre.update.testCommand", JSON.stringify([pyw, fake, result]));

  // ---- 1. replaced while the downloads prompt holds the restart back ----
  const folder = PathUtils.join(PathUtils.profileDir, "Downloads");
  await IOUtils.makeDirectory(folder, { ignoreExisting: true });
  b.sys("VitreSettings").set({ downloadsFolder: folder, askWhereToSave: false });
  const engine = b.sys("VitreDownloads");
  const id = engine.start(`${U.base}/slowfile`, { filename: "slow.bin", named: true });
  await waitFor(() => engine.list().find((v) => v.id === id && v.state === "downloading" && v.received > 0), { timeout: 30000, what: "the download running" });
  const prompt = () => b.root.querySelector(".vd-quit");
  await U.about();
  spike.click(U.button());
  await waitFor(() => prompt(), { timeout: 10000, what: "the downloads quit prompt" });
  await sleep(500);
  check("held back by the downloads prompt; still ready", st().phase === "ready");
  const size = (await IOUtils.stat(setup)).size;
  await IOUtils.write(setup, new Uint8Array(size).fill(0x42));
  log("replaced the staged setup with other bytes of the same size");
  spike.click(b.root.querySelector(".vd-q-go"));
  await waitFor(() => st().phase === "failed", { timeout: 15000, what: "the replaced setup refused" });
  await sleep(1000);
  check("the prompt's Restart: the replaced setup is refused (damaged), Deer stays, nothing started", !window.closed && !Services.startup.shuttingDown && st().error === DAMAGED && Up.lastLaunch === null, { st: st(), launch: Up.lastLaunch });
  check("the replaced file is removed", !(await U.files()).some((f) => /\.exe$/.test(f)), await U.files());
  engine.cancel(id);
  await waitFor(() => engine.list().find((v) => v.id === id)?.state !== "downloading", { what: "the download cancelled" });

  // ---- 2. replaced after the quit was granted ----
  r = await U.run("newer");
  check("downloaded again: ready", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);
  Services.obs.addObserver(() => {
    // Synchronously: the quit goes on from here without waiting for anything.
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(setup);
    const len = f.fileSize;
    const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    out.init(f, 0x02 | 0x20, 0o644, 0); // write, truncate
    const text = "C".repeat(len);
    out.write(text, text.length);
    out.close();
    log("quit granted: replaced the staged setup");
  }, "quit-application-granted");
  Services.obs.addObserver((_s, _t, data) => log("quit-application: " + data), "quit-application");
  Services.obs.addObserver(() => {
    const l = Up.lastLaunch;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(setup);
    check("at quit-application the changed setup was not started: held, hashed, refused", !!l && l.started === false && l.refused === "the setup changed after Deer checked it", l);
    check("and it was removed", !f.exists());
    log("profile-change-teardown reached: Deer is quitting");
  }, "profile-change-teardown");
  await U.about();
  check("About offers Restart to update", U.button().textContent === "Restart to update");
  spike.click(U.button());
  log("clicked Restart to update; waiting for Deer to quit by itself");
  await sleep(60000);
  check("Deer quit within 60 s", false);
});
