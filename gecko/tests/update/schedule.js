// The automatic check of an installed release: never during startup (vitre.update.firstDelay after
// start), at most once a day (vitre.update.lastCheck, seconds), none when switched off, a clock that
// moved back cannot postpone it by more than a day, and a newer release found this way is downloaded
// and ready. Times are read from the requests the local stand-in saw.
//   python tests/update/all.py schedule
/* global spike, Services, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, waitFor, log } = spike;
  const { Up } = U;
  const st = () => Up.state();
  const DAY = 86400 * 1000;
  const requests = async () => (await U.server.log()).filter((r) => r.path === "/repos/test/deer/releases/latest").length;
  const setLast = (ms) => Services.prefs.setIntPref("vitre.update.lastCheck", Math.floor(ms / 1000));
  const near = (a, b, slack = 5000) => Math.abs(a - b) <= slack;

  const dir = await U.fakeInstall();
  await U.server.scenario("same");
  await U.server.reset();
  Services.prefs.setIntPref("vitre.update.firstDelay", 600);
  setLast(0);
  await U.use(dir, { auto: true });

  // The first check waits firstDelay from the start of the process.
  const startedAt = st().nextCheck - 600 * 1000;
  check("never checked, firstDelay 600 s: the first check is 600 s after start, not now", st().nextCheck > Date.now() + 400 * 1000 && startedAt <= Date.now() && startedAt > Date.now() - 300 * 1000, { next: st().nextCheck - Date.now(), startedAgo: Date.now() - startedAt });
  await sleep(2000);
  check("nothing asked during startup", (await requests()) === 0);

  // A first delay that ends 4 s from now: the timer fires then, not before.
  const delay = Math.ceil((Date.now() - startedAt) / 1000) + 4;
  Services.prefs.setIntPref("vitre.update.firstDelay", delay);
  await Up.reload();
  check("the timer is set for the end of the first delay", near(st().nextCheck, startedAt + delay * 1000, 1500), st().nextCheck - Date.now());
  await sleep(1500);
  check("not before it", (await requests()) === 0);
  await waitFor(async () => (await requests()) === 1, { timeout: 12000, what: "the first automatic check" });
  await waitFor(() => st().phase === "current", { what: "up to date" });
  const last = Services.prefs.getIntPref("vitre.update.lastCheck") * 1000;
  check("the automatic check ran once and recorded its time", near(last, Date.now(), 15000) && near(st().nextCheck, last + DAY, 2000), { last: Date.now() - last, next: (st().nextCheck - Date.now()) / 3600000 });
  await sleep(3000);
  check("no second check the same day", (await requests()) === 1);

  // Checked an hour ago: the next one is a day after that one.
  setLast(Date.now() - 3600 * 1000);
  await Up.reload();
  check("checked an hour ago: next check 23 h from now", near(st().nextCheck, Date.now() + 23 * 3600 * 1000, 10000), (st().nextCheck - Date.now()) / 3600000);
  await sleep(2500);
  check("and none now", (await requests()) === 1);

  // Checked more than a day ago (after the first delay): due at once.
  Services.prefs.setIntPref("vitre.update.firstDelay", 0);
  setLast(Date.now() - DAY - 60 * 1000);
  await Up.reload();
  await waitFor(async () => (await requests()) === 2, { timeout: 10000, what: "the check a day later" });
  check("checked a day and a minute ago: checked again at once", true);
  await waitFor(() => st().phase === "current", { what: "up to date" });

  // A clock that moved back (last check "in the future"): at most a day from now.
  setLast(Date.now() + 10 * DAY);
  await Up.reload();
  check("a last check in the future does not postpone the next one by more than a day", st().nextCheck > Date.now() && st().nextCheck <= Date.now() + DAY + 5000, (st().nextCheck - Date.now()) / 3600000);

  // Switched off: nothing is scheduled, whatever the last check.
  setLast(Date.now() - 3 * DAY);
  Services.prefs.setBoolPref("vitre.update.auto", false);
  await Up.reload();
  await sleep(3000);
  check("automatic checks off: nothing scheduled, nothing asked", st().nextCheck === 0 && (await requests()) === 2, { next: st().nextCheck, requests: await requests() });

  // Switched on again with a newer release out: found, downloaded and ready by itself.
  await U.server.scenario("newer");
  Services.prefs.setBoolPref("vitre.update.auto", true);
  await waitFor(() => st().phase === "ready", { timeout: 20000, what: "the automatic check downloading 1.5.0" });
  check("switched on with a check due: the automatic check finds 1.5.0 and downloads it", st().available === "1.5.0" && (await requests()) === 3, st());
  check("the next automatic check is a day later", near(st().nextCheck, Services.prefs.getIntPref("vitre.update.lastCheck") * 1000 + DAY, 2000));
  log("requests: " + JSON.stringify(U.paths(await U.server.log())));
});
