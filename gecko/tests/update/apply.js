// "Restart to update", for real except for the setup: run by tests/update/all.py, twice on one profile.
//   1st start: a staged 1.5.0 for the stand-in install (a folder with a space in its name), two pages
//              open; the About page's "Restart to update" is clicked. Deer must quit by itself
//              (run.py --until-exit), with browser.sessionstore.resume_session_once set, and at
//              quit-application start the stand-in setup (vitre.update.testCommand = [pythonw,
//              fake_setup.py, <result file>]) with the staged setup's path and exactly
//              /update /installdir:<install> /wait:180 /launch /log:<updates>\setup.log
//              /sha256:<the staged setup's SHA-256>.
//              The expected argument list is written to out/apply-expected.json; all.py compares it
//              with what fake_setup.py received and that it outlived Deer.
//   2nd start: the two pages are back (the session was restored once) and the flag is used up.
/* global spike, Services, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
const PAGES = ["data:text/plain,deer-update-one", "data:text/plain,deer-update-two"];

if (spike.run === 1) {
  spike.main(async () => {
    const { check, sleep, waitFor, log } = spike;
    const b = window.vitre;
    const { Up } = U;
    const st = () => Up.state();
    await spike.resize(1280, 860);
    await spike.activate();
    for (const url of PAGES) b.newTab(url);
    await waitFor(() => PAGES.every((u) => b.tabs.some((t) => t.url === u && !t.loading)), { timeout: 15000, what: "the two pages" });

    const dir = await U.fakeInstall({ name: "Deer Install" });
    await U.use(dir);
    const r = await U.run("newer");
    check("1.5.0 staged for the stand-in install", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);

    const setup = PathUtils.join(Up.updatesDir(), "Deer-Setup-1.5.0.exe");
    const logFile = PathUtils.join(Up.updatesDir(), "setup.log");
    const sha = await U.sha256(setup);
    const expected = [setup, "/update", `/installdir:${dir}`, "/wait:180", "/launch", `/log:${logFile}`, `/sha256:${sha}`];
    await IOUtils.writeJSON(PathUtils.join(spike.outDir, "apply-expected.json"), expected);
    check("the setup's arguments", JSON.stringify(Up.setupArgs(dir, logFile, sha)) === JSON.stringify(expected.slice(1)), Up.setupArgs(dir, logFile, sha));
    const pyw = Services.env.get("UPTEST_PYTHONW");
    const fake = Services.env.get("UPTEST_FAKE_SETUP");
    const result = Services.env.get("UPTEST_SETUP_RESULT");
    Services.prefs.setStringPref("vitre.update.testCommand", JSON.stringify([pyw, fake, result]));

    // What happened by the time the profile goes away (after quit-application).
    Services.obs.addObserver(() => {
      const l = Up.lastLaunch;
      check("at quit-application the stand-in setup was started (not the real one), the setup held and hashed first", !!l && l.started === true && l.program === pyw && !l.refused, l);
      check("its arguments: the stand-in, its result file, then the setup path and the setup's arguments", !!l && JSON.stringify(l.args) === JSON.stringify([fake, result, ...expected]), l && l.args);
      check("the session will be restored once (browser.sessionstore.resume_session_once)", Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) === true);
      log("profile-change-teardown reached: Deer is quitting");
    }, "profile-change-teardown");

    await U.about();
    check("About offers Restart to update", U.button().textContent === "Restart to update");
    spike.click(U.button());
    await waitFor(() => st().phase === "restarting", { timeout: 10000, what: "restarting" });
    check("clicked: 'Restarting to update…'", U.status() === "Restarting to update…", U.status());
    log("waiting for Deer to quit by itself");
    await sleep(60000);
    check("Deer quit within 60 s of the click", false);
  });
} else {
  spike.main(async () => {
    const { check, waitFor } = spike;
    const b = window.vitre;
    let ok = false;
    try {
      await waitFor(() => PAGES.every((u) => b.tabs.some((t) => t.url === u)), { timeout: 20000, what: "the restored pages" });
      ok = true;
    } catch {
      /* reported below */
    }
    check("next start: the two pages are back (the session was restored)", ok, b.tabs.map((t) => t.url));
    check("the restore flag is used up", Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) === false);
  });
}
