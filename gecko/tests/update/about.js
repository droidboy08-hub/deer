// Settings › About with Deer's updater, in each state, driven through its real button and switch
// against the local GitHub stand-in (tests/update/release_server.py), plus the note "Deer <v> is
// ready" (once per version) and "Restart to update" in the + circle's menu (only while an update waits).
//   python tests/update/all.py about
// Captures (tests/update/out): about-dev, about-idle, about-checking, about-current, about-current-light,
// about-downloading, about-ready, note-ready, plus-ready, about-ready-allusers, note-ready-allusers,
// about-ready-retry, about-ratelimit, about-offline, about-checksum, about-nowrite, about-search.
/* global spike, Services, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  const { Up } = U;
  const st = () => Up.state();
  await spike.resize(1280, 860);
  await spike.activate();
  b.sys("VitreSettings").set({ theme: "dark" });
  await waitFor(() => matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });
  // No automatic check while this test runs (it is in schedule.js).
  Services.prefs.setIntPref("vitre.update.firstDelay", 86400);
  const svc = await b.whenService("settings");
  const note = () => document.querySelector("#vitre-root .vu-note");
  const click = async (el) => {
    spike.click(el);
    await sleep(50);
  };

  // ---- this development run ----
  await U.about();
  check("development: Deer's version is gecko/package.json's, built in", U.rowDesc("Deer") === `Version ${st().version}` && /^\d+\.\d+\.\d+/.test(st().version), U.rowDesc("Deer"));
  check("development: 'Updates are off in development builds', no button, no switch", U.status() === "Updates are off in development builds" && U.button().hidden && U.autoRow().hidden, { status: U.status(), button: !U.button().hidden, auto: !U.autoRow().hidden });
  await U.showUpdates();
  await capture("about-dev");

  // ---- an installed release, idle ----
  const dir = await U.fakeInstall();
  await U.use(dir, { auto: true });
  await U.about();
  check("installed: About shows the install's version (deer-version.json)", U.rowDesc("Deer") === "Version 1.4.2", U.rowDesc("Deer"));
  check("installed, never checked: 'Deer checks for updates once a day', Check for updates, the switch on", U.status() === "Deer checks for updates once a day" && !U.button().hidden && !U.button().disabled && U.button().textContent === "Check for updates" && !U.autoRow().hidden && U.autoRow().querySelector("[role=switch]").getAttribute("aria-checked") === "true", { status: U.status(), btn: U.button().textContent });
  check("the switch and the button are named for assistive technology", !!U.autoRow().querySelector("[role=switch]").getAttribute("aria-labelledby") && U.autoRow().querySelector(".vs-title").textContent === "Check automatically");
  await U.showUpdates();
  await capture("about-idle");

  const sw = () => U.autoRow().querySelector("[role=switch]");
  await click(sw());
  await waitFor(() => !st().auto, { what: "automatic checks off" });
  check("the switch turns automatic checks off: pref, state, nothing scheduled, the line says so", Services.prefs.getBoolPref("vitre.update.auto") === false && st().nextCheck === 0 && sw().getAttribute("aria-checked") === "false" && U.status() === "Automatic checks are off", { status: U.status(), next: st().nextCheck });
  await click(sw());
  await waitFor(() => st().auto, { what: "automatic checks on" });
  check("and on again: a check is scheduled", Services.prefs.getBoolPref("vitre.update.auto") === true && st().nextCheck > Date.now() && sw().getAttribute("aria-checked") === "true", st().nextCheck);

  // ---- checking, then up to date ----
  await U.server.scenario("slow-api");
  await click(U.button());
  await waitFor(() => U.status() === "Checking for updates…", { what: "checking" });
  check("checking: the line says so and the button waits", U.button().disabled && st().phase === "checking");
  await capture("about-checking");
  await waitFor(() => st().phase === "current", { timeout: 15000, what: "up to date" });
  await sleep(200);
  check("up to date: 'Deer is up to date · Checked today at …'", /^Deer is up to date · Checked today at \d{1,2}:\d{2}( [AP]M)?$/.test(U.status()) && !U.button().disabled, U.status());
  await capture("about-current");
  b.sys("VitreSettings").set({ theme: "light" });
  await waitFor(() => !matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "light chrome" });
  await sleep(400);
  await capture("about-current-light");
  b.sys("VitreSettings").set({ theme: "dark" });
  await waitFor(() => matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });
  await sleep(300);

  // ---- downloading, then ready ----
  await U.server.scenario("slow");
  await click(U.button());
  await waitFor(() => st().phase === "downloading" && st().received > 600 * 1024, { timeout: 15000, what: "downloading" });
  await sleep(100);
  check("downloading: 'Downloading Deer 1.5.0… x of 3.0 MB', the button waits", /^Downloading Deer 1\.5\.0… \d+(\.\d)? of 3\.0 MB$/.test(U.status()) && U.button().disabled, U.status());
  await capture("about-downloading");
  await waitFor(() => st().phase === "ready", { timeout: 30000, what: "ready" });
  await sleep(200);
  check("ready: 'Deer 1.5.0 is ready to install' and the accent Restart to update button", U.status() === "Deer 1.5.0 is ready to install" && U.button().textContent === "Restart to update" && U.button().classList.contains("accent") && !U.button().disabled, { status: U.status(), btn: U.button().textContent });
  await capture("about-ready");

  // ---- the note: after Settings closes, once per version ----
  await sleep(2000);
  check("no note over the open Settings panel", !note());
  svc.close();
  await waitFor(() => note(), { timeout: 8000, what: "the note" });
  await sleep(400);
  check("the note: 'Deer 1.5.0 is ready' and Restart to update, under the tab pill", note().textContent === "Deer 1.5.0 is readyRestart to update" && note().getBoundingClientRect().top > b.bar.layout.pillRect.bottom, note().textContent);
  check("the note is remembered for this version (vitre.update.notified)", Services.prefs.getStringPref("vitre.update.notified", "") === "1.5.0");
  await capture("note-ready");
  spike.click(window.innerWidth / 2, window.innerHeight - 60);
  await waitFor(() => !note(), { what: "the note closing on a click elsewhere" });
  await U.run("newer");
  await sleep(2500);
  check("checked again: still ready, but the note is not shown again for 1.5.0", st().phase === "ready" && !note());

  // ---- + circle's menu ----
  const plus = document.querySelector("#vitre-bar .item.plus");
  const menuRows = () => window.vitreMenus.state().rows.map((r) => r.label);
  const openPlus = async () => {
    const r = plus.getBoundingClientRect();
    const EU = spike.EU;
    for (const type of ["mousemove", "mousedown", "mouseup", "contextmenu"]) EU.synthesizeMouseAtPoint(r.left + r.width / 2, r.top + r.height / 2, { type, button: type === "mousemove" ? 0 : 2 }, window);
    await waitFor(() => window.vitreMenus.state().open, { what: "the + menu" });
    await sleep(300);
  };
  const closeMenu = async () => {
    spike.press("Escape");
    await waitFor(() => !window.vitreMenus.state().open, { what: "menu closed" });
    await sleep(200);
  };
  if (window.vitreMenus) {
    await openPlus();
    const rows = menuRows();
    check("the + menu ends with 'Restart to update' while 1.5.0 waits", rows[rows.length - 1] === "Restart to update", rows);
    await capture("plus-ready");
    await closeMenu();
  } else check("the menus module is in this build", false);

  // ---- ready, installed for all users ----
  await U.fakeInstall({ scope: "machine" });
  await Up.reload();
  await U.about();
  check("all users: the line says Windows asks for administrator permission", U.status() === "Deer 1.5.0 is ready to install · Windows asks for administrator permission" && st().machine, U.status());
  await capture("about-ready-allusers");
  Services.prefs.clearUserPref("vitre.update.notified");
  svc.close();
  await U.run("newer");
  await waitFor(() => note(), { timeout: 8000, what: "the note (all users)" });
  await sleep(400);
  check("the all-users note says so too", /Windows asks for administrator permission/.test(note().textContent), note().textContent);
  await capture("note-ready-allusers");
  spike.click(window.innerWidth / 2, window.innerHeight - 60);
  await waitFor(() => !note(), { what: "note closed" });

  // ---- the last setup run did not finish ----
  await IOUtils.writeUTF8(PathUtils.join(U.updates(), "setup.log"), "RESULT 11\r\n");
  await Up.reload();
  await U.about();
  check("a setup run that did not install says why (permission mentioned once) and offers it again", U.status() === "Deer 1.5.0 didn’t install because administrator permission was refused" && U.button().textContent === "Restart to update", U.status());
  await IOUtils.writeUTF8(PathUtils.join(U.updates(), "setup.log"), "RESULT 3\r\n");
  await Up.reload();
  await U.about();
  check("another reason: said, and that Windows asks for permission", U.status() === "Deer 1.5.0 didn’t install because Deer was still open · Windows asks for administrator permission", U.status());
  await capture("about-ready-retry");

  // ---- failures, one sentence each ----
  await U.fakeInstall();
  await U.clear();
  await U.about();
  const fail = async (prep, name, test) => {
    await prep();
    await click(U.button());
    await waitFor(() => st().phase === "failed", { timeout: 15000, what: name });
    await sleep(200);
    check(`${name}: one plain sentence in the status line (no full stop, as every Settings line)`, test(U.status()) && U.button().textContent === "Check for updates" && !U.button().disabled, U.status());
    await capture("about-" + name);
  };
  await fail(() => U.server.scenario("ratelimit"), "ratelimit", (t) => /^GitHub’s limit for update checks was reached; try again after \d{1,2}:\d{2}( [AP]M)?$/.test(t));
  Services.prefs.setStringPref("vitre.update.apiBase", U.down);
  await fail(async () => undefined, "offline", (t) => t === "Couldn’t reach GitHub; check your internet connection and try again");
  Services.prefs.setStringPref("vitre.update.apiBase", U.base);
  await fail(() => U.server.scenario("bad-sum"), "checksum", (t) => t === "The download didn’t match its published checksum, so Deer deleted it");
  await fail(
    async () => {
      await U.server.scenario("newer");
      await IOUtils.remove(U.updates(), { recursive: true, ignoreAbsent: true });
      await IOUtils.writeUTF8(U.updates(), "a file where the updates folder goes");
    },
    "nowrite",
    (t) => t === `Deer can’t save updates in ${U.updates()}`
  );
  await IOUtils.remove(U.updates());

  // ---- the + menu without a waiting update ----
  if (window.vitreMenus) {
    svc.close();
    await sleep(500);
    await openPlus();
    check("no 'Restart to update' in the + menu when nothing waits", !menuRows().includes("Restart to update"), menuRows());
    await closeMenu();
  }

  // ---- Find a setting ----
  svc.open("general", "updates");
  await waitFor(() => U.root()?.querySelector(".vs-content")?.dataset.page === "results", { what: "search results" });
  await sleep(400);
  const titles = [...U.root().querySelectorAll(".vs-content .vs-title")].map((t) => t.textContent);
  check("Find a setting: 'updates' finds the Software update row and the switch", titles.includes("Software update") && titles.includes("Check automatically"), titles);
  await capture("about-search");
  svc.close();
});
