// "Restart to update" while a download runs, run by tests/update/all.py (one start, run.py --until-exit):
// the downloads module's quit prompt holds the restart back ("A download is still running", Restart /
// Keep downloading). "Keep downloading" keeps Deer, the download and the waiting update; "Restart"
// goes on as the update's restart (VitreUpdater.proceedRestart through the prompt's proceed()), not as
// an in-place restart: Deer quits by itself and the stand-in setup (fake_setup.py, via
// vitre.update.testCommand) is started with the setup's arguments, which all.py compares with
// out/prompt-expected.json. Before that: after "Keep downloading", another restart asked for (as
// Firefox or an add-on would) drops the held one, so that prompt's "Restart" is an ordinary restart
// and not the update's.
/* global spike, Services, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, waitFor, log, capture } = spike;
  const b = window.vitre;
  const { Up } = U;
  const st = () => Up.state();
  await spike.resize(1280, 860);
  await spike.activate();
  b.sys("VitreSettings").set({ theme: "dark" });

  const dir = await U.fakeInstall();
  await U.use(dir);
  const r = await U.run("newer");
  check("1.5.0 staged", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);
  const setup = PathUtils.join(Up.updatesDir(), "Deer-Setup-1.5.0.exe");
  const logFile = PathUtils.join(Up.updatesDir(), "setup.log");
  const expected = [setup, ...Up.setupArgs(dir, logFile, await U.sha256(setup))];
  await IOUtils.writeJSON(PathUtils.join(spike.outDir, "prompt-expected.json"), expected);
  const pyw = Services.env.get("UPTEST_PYTHONW");
  const fake = Services.env.get("UPTEST_FAKE_SETUP");
  const result = Services.env.get("UPTEST_SETUP_RESULT");
  Services.prefs.setStringPref("vitre.update.testCommand", JSON.stringify([pyw, fake, result]));

  // A download that runs for minutes.
  const folder = PathUtils.join(PathUtils.profileDir, "Downloads");
  await IOUtils.makeDirectory(folder, { ignoreExisting: true });
  b.sys("VitreSettings").set({ downloadsFolder: folder, askWhereToSave: false });
  const engine = b.sys("VitreDownloads");
  const id = engine.start(`${U.base}/slowfile`, { filename: "slow.bin", named: true });
  await waitFor(() => engine.list().find((v) => v.id === id && v.state === "downloading" && v.received > 0), { timeout: 30000, what: "the download running" });
  const running = () => engine.list().find((v) => v.id === id)?.state === "downloading";

  const prompt = () => b.root.querySelector(".vd-quit");
  await U.about();
  spike.click(U.button());
  await waitFor(() => prompt(), { timeout: 10000, what: "the downloads quit prompt" });
  await sleep(500);
  check("Restart to update while downloading: the downloads prompt asks first", /A download is still running/.test(prompt().textContent) && b.root.querySelector(".vd-q-go")?.textContent === "Restart", prompt().textContent);
  check("meanwhile the update waits (ready) and nothing was started", st().phase === "ready" && Up.lastLaunch === null && running(), { phase: st().phase, launch: Up.lastLaunch });
  await capture("prompt-restart");

  spike.click(b.root.querySelector(".vd-q-keep"));
  await waitFor(() => !prompt(), { what: "the prompt closing" });
  await sleep(1500);
  check("Keep downloading: Deer stays, the download runs, the update still waits", !window.closed && running() && st().phase === "ready" && Up.lastLaunch === null, st().phase);

  // Another restart is asked for meanwhile (not the update's): the downloads prompt asks again, and
  // the held update restart is gone, so "Restart" there is not the update's.
  const other = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
  Services.obs.notifyObservers(other, "quit-application-requested", "restart");
  await waitFor(() => prompt(), { timeout: 10000, what: "the prompt for the other restart" });
  check("another restart while downloading: refused for now, the downloads prompt asks", other.data === true && /A download is still running/.test(prompt().textContent));
  check("the update's held restart is dropped: the prompt's Restart would not be the update's", Up.proceedRestart() === false && st().phase === "ready" && Up.lastLaunch === null, st().phase);
  spike.click(b.root.querySelector(".vd-q-keep"));
  await waitFor(() => !prompt(), { what: "the prompt closing again" });
  await sleep(500);

  Services.obs.addObserver(() => {
    const l = Up.lastLaunch;
    check("the prompt's Restart quit Deer for the update: the stand-in setup started at quit-application", !!l && l.started === true && JSON.stringify(l.args) === JSON.stringify([fake, result, ...expected]), l);
    check("not an in-place restart (quit-application said shutdown, the session flag is set)", Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) === true);
    log("profile-change-teardown reached: Deer is quitting");
  }, "profile-change-teardown");
  Services.obs.addObserver((_s, _t, data) => log("quit-application: " + data), "quit-application");

  spike.click(U.button());
  await waitFor(() => prompt(), { timeout: 10000, what: "the prompt again" });
  await sleep(400);
  spike.click(b.root.querySelector(".vd-q-go"));
  log("Restart chosen in the downloads prompt; waiting for Deer to quit by itself");
  await sleep(60000);
  check("Deer quit within 60 s", false);
});
