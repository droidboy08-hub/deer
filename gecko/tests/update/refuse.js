// "Restart to update" when a page asks before it is left (beforeunload), run by tests/update/all.py.
// Firefox shows its "Leave page?" prompt while it tries to close the windows (nsAppStartup.quit
// spins a nested event loop until it is answered). Staying on the page stops the quit: the update
// must stop with it at once (phase ready again, browser.sessionstore.resume_session_once cleared),
// so that no later, ordinary quit starts the setup. Nothing is started in this test (no test
// command: with testInstallDir set the updater never starts anything without one).
/* global spike, Services, U, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, waitFor, log } = spike;
  const b = window.vitre;
  const { Up } = U;
  const st = () => Up.state();
  await spike.resize(1280, 860);
  await spike.activate();
  Services.prefs.setIntPref("vitre.update.firstDelay", 86400);
  Services.prefs.setBoolPref("dom.require_user_interaction_for_beforeunload", false);

  const dir = await U.fakeInstall();
  await U.use(dir);
  const r = await U.run("newer");
  check("1.5.0 staged", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);

  const page = "data:text/html," + encodeURIComponent("<title>Guarded</title><input id=i style='position:fixed;left:100px;top:200px;width:300px;height:40px'><script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'x'; });</script>");
  const g = b.newTab(page);
  await waitFor(() => g.title === "Guarded" && !g.loading, { timeout: 15000, what: "the guarded page" });
  await sleep(400);
  spike.click(200, 220); // a person's touch, as Firefox may ask only then
  spike.type("x");
  await sleep(400);

  const dialogs = () => {
    try {
      const box = gBrowser.getTabDialogBox(g.browser);
      return box.getTabDialogManager()._dialogs.length + (box._contentDialogManager?._dialogs.length ?? 0);
    } catch {
      return -1;
    }
  };
  // quit() waits inside Firefox's prompt: start it from a timer so this script keeps running.
  let result = null;
  window.setTimeout(() => {
    Up.restartToUpdate().then((v) => (result = v));
  }, 0);
  try {
    await waitFor(() => dialogs() > 0, { timeout: 15000, what: "Firefox's Leave page? prompt" });
  } catch {
    /* reported below */
  }
  await sleep(500);
  check("the page asks before it is left; meanwhile the update is on its way (restarting)", dialogs() > 0 && st().phase === "restarting" && Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) === true, { dialogs: dialogs(), phase: st().phase });
  await spike.capture("refuse-prompt");

  const t0 = Date.now();
  gBrowser.getTabDialogBox(g.browser).abortAllDialogs(); // "Stay on page"
  await waitFor(() => result !== null, { timeout: 10000, what: "restartToUpdate to return" });
  const took = Date.now() - t0;
  log("restartToUpdate returned " + result + " after " + took + " ms");
  check("staying on the page: Deer stays, restartToUpdate says it is not quitting", !window.closed && result === false && !Services.startup.shuttingDown, { result });
  check(`the update stopped with the quit at once (${took} ms): ready again, the session flag cleared, nothing started`, st().phase === "ready" && st().available === "1.5.0" && Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) === false && Up.lastLaunch === null && took < 5000, { phase: st().phase, launch: Up.lastLaunch });
  await U.about();
  check("About offers Restart to update again", U.button().textContent === "Restart to update" && !U.button().disabled, U.button().textContent);
  (await b.whenService("settings")).close();
  Services.prefs.clearUserPref("dom.require_user_interaction_for_beforeunload");
});
