// A development run (this one: runtime\vitre.exe, no deer-version.json next to the engine's folder):
// updates are off, About says so, a check contacts nothing even with the prefs pointed at the local
// stand-in, and no automatic check is ever scheduled, even with automatic checks on and due.
//   python tests/update/all.py dev
/* global spike, Services, Ci, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, capture } = spike;
  const b = window.vitre;
  const { Up } = U;
  const st = () => Up.state();
  await spike.resize(1280, 860);
  await spike.activate();
  b.sys("VitreSettings").set({ theme: "dark" });

  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const parent = exe.parent.parent.path;
  check("this run is the development engine (runtime\\vitre.exe), with no deer-version.json beside its folder", /\\runtime\\vitre\.exe$/i.test(exe.path) && !(await IOUtils.exists(PathUtils.join(parent, "deer-version.json"))), exe.path);

  // Everything that would make an installed release check at once.
  await U.server.reset();
  Services.prefs.setStringPref("vitre.update.apiBase", U.base);
  Services.prefs.setStringPref("vitre.update.repo", "test/deer");
  Services.prefs.setBoolPref("vitre.update.auto", true);
  Services.prefs.setIntPref("vitre.update.firstDelay", 0);
  Services.prefs.setIntPref("vitre.update.lastCheck", 0);
  await Up.reload();

  const pkgPath = PathUtils.join(PathUtils.parent(PathUtils.parent(PathUtils.parent(Services.env.get("VITRE_BOOT")))), "package.json");
  const pkg = JSON.parse(new TextDecoder().decode(await IOUtils.read(pkgPath)));
  check("off, with the reason, and the version built in from gecko/package.json", st().phase === "off" && !st().release && st().offReason === "Updates are off in development builds" && st().version === pkg.version, { st: st(), pkg: pkg.version });
  check("no automatic check is scheduled", st().nextCheck === 0, st().nextCheck);

  await Up.check({ manual: true });
  await sleep(3000);
  const seen = await U.server.log();
  check("a check (and three seconds of waiting) contacted nothing", seen.length === 0 && st().phase === "off", seen);
  check("no check time recorded, no updates folder made", Services.prefs.getIntPref("vitre.update.lastCheck") === 0 && !(await IOUtils.exists(Up.updatesDir())));
  check("Restart to update does nothing here", (await Up.restartToUpdate()) === false && Up.proceedRestart() === false && st().phase === "off");

  await U.about();
  check("About: 'Updates are off in development builds', no button, no switch", U.status() === "Updates are off in development builds" && U.button().hidden && U.autoRow().hidden && U.rowDesc("Deer") === `Version ${pkg.version}`, U.status());
  await U.showUpdates();
  await capture("dev-about");
  (await b.whenService("settings")).close();
  await sleep(300);

  if (window.vitreMenus) {
    const plus = document.querySelector("#vitre-bar .item.plus");
    const r = plus.getBoundingClientRect();
    for (const type of ["mousemove", "mousedown", "mouseup", "contextmenu"]) spike.EU.synthesizeMouseAtPoint(r.left + r.width / 2, r.top + r.height / 2, { type, button: type === "mousemove" ? 0 : 2 }, window);
    await spike.waitFor(() => window.vitreMenus.state().open, { what: "the + menu" });
    const rows = window.vitreMenus.state().rows.map((x) => x.label);
    check("the + menu has no update row", !rows.includes("Restart to update"), rows);
    spike.press("Escape");
    await sleep(300);
  }
  const after = await U.server.log();
  check("still nothing contacted at the end", after.length === 0, after.length);
});
