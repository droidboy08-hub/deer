// Deer's updater against the local GitHub stand-in (tests/update/release_server.py): what is asked,
// what is downloaded, what is refused, and the updates folder. The install is the stand-in 1.4.2
// (VitreUpdater.testInstallDir); nothing outside the throwaway profile is touched.
//   python tests/update/all.py check
// Cases: same version, older, prerelease (flag and tag), draft, a tag that is no version, newer (a
// full download through GitHub's redirect, verified, staged, then reused), a capital-V tag, a newer
// release than the staged one, missing setup asset, missing SHA256SUMS.txt, no line for the setup,
// checksum mismatch, GitHub's digest disagreeing, wrong size, truncated download then resumed with
// Range, a server that ignores Range, 403 rate limit, 429, 500, 404, an answer that is not JSON, an
// API answer that stalls after its headers (the check ends; the next one runs), an API answer and a
// SHA256SUMS.txt over their size limits, a setup link on another host or outside the repository's
// releases, a setup link redirected to another host, server down, no write access, a failing
// re-check keeping a ready update, stale files removed, a staged update removed once the install
// caught up, setup.log results (3, 4, 0 and 6), a release whose setup is another version never
// offered again, the hold launch() takes on the setup, signed releases (with a release key: no
// SHA256SUMS.txt.sig, a signature by another key, a good one; without a key the signature is not
// needed), and the installs that never update (test install, local-test channel, not installed by
// setup). Requests carry no query, cookie or credentials.
/* global spike, Services, IOUtils, PathUtils, U */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep } = spike;
  const { Up } = U;
  const st = () => Up.state();
  const INST = U.INSTALLED;
  const LINKS = "/test/deer/releases/download";
  const noExe = async () => (await U.files()).every((f) => !/\.exe(\.part)?$/.test(f));

  // The development run itself: nothing is enabled before the stand-in install is given.
  check("before the stand-in: a development run, updates off", st().phase === "off" && !st().release, st());

  const dir = await U.fakeInstall();
  await U.use(dir);
  check("the stand-in install: an installed release 1.4.2, idle, nothing scheduled (automatic checks off in this test)", st().phase === "idle" && st().release && st().version === INST && st().nextCheck === 0, st());

  // ---- the rules themselves ----
  const cmp = (a, b) => Math.sign(Up.compareVersions(a, b));
  check("semver: 1.10.0 > 1.9.9, v-prefix (either case), build metadata ignored", cmp("1.10.0", "1.9.9") === 1 && cmp("v1.4.2", "1.4.2") === 0 && cmp("V1.4.2", "1.4.2") === 0 && cmp("1.4.2+b7", "1.4.2") === 0);
  check("semver: a prerelease is older than its release; numeric before alphanumeric; longer wins", cmp("1.5.0-beta.1", "1.5.0") === -1 && cmp("1.5.0-alpha", "1.5.0-alpha.1") === -1 && cmp("1.5.0-alpha.1", "1.5.0-alpha.beta") === -1 && cmp("1.5.0-beta.11", "1.5.0-beta.2") === 1);
  check("semver: not versions", Number.isNaN(Up.compareVersions("latest", "1.0.0")) && !Up.parseVersion("1.2") && !Up.parseVersion("01.2.3") && !Up.parseVersion("x1.2.3"));
  const sumText = `${"a".repeat(64)}  Deer-Setup.exe\n${"b".repeat(64)} *Other.exe\n`;
  check("SHA256SUMS.txt lines (two spaces, or a star)", Up.sumFor(sumText, "Deer-Setup.exe") === "a".repeat(64) && Up.sumFor(sumText, "Other.exe") === "b".repeat(64) && Up.sumFor(sumText, "x.exe") === "");
  check("SHA256SUMS.txt with two lines that disagree gives nothing", Up.sumFor(sumText + `${"c".repeat(64)}  Deer-Setup.exe\n`, "Deer-Setup.exe") === "");

  // ---- releases that are not offered ----
  for (const [name, why] of [["same", "the same version"], ["older", "an older version"], ["prerelease", "a prerelease"], ["pretag", "a tag with a prerelease part"], ["draft", "a draft"]]) {
    const r = await U.run(name);
    check(`${why}: up to date, only the API was asked`, r.state.phase === "current" && !r.state.available && r.log.length === 1 && r.log[0].path === "/repos/test/deer/releases/latest", { state: r.state.phase, log: U.paths(r.log) });
  }
  let r = await U.run("same");
  const api = r.log[0];
  const names = Object.keys(api.headers).map((h) => h.toLowerCase());
  check("the API request: no query string, no cookie, no credentials, GitHub's Accept and API version", !api.query && !names.includes("cookie") && !names.includes("authorization") && api.headers.Accept === "application/vnd.github+json" && api.headers["X-GitHub-Api-Version"] === "2022-11-28", api);
  check("the API request carries only the browser's own headers besides those two", names.every((h) => ["host", "user-agent", "accept", "accept-language", "accept-encoding", "x-github-api-version", "connection", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "priority", "pragma", "cache-control", "te"].includes(h)), names);
  check("the User-Agent is the browser's ordinary one", api.headers["User-Agent"] === navigator.userAgent, [api.headers["User-Agent"], navigator.userAgent]);
  check("the time of the check is kept (vitre.update.lastCheck)", Math.abs(Services.prefs.getIntPref("vitre.update.lastCheck") * 1000 - Date.now()) < 60000 && st().lastCheck > 0);

  r = await U.run("badtag");
  check("a latest release tagged 'latest': refused in one sentence", r.state.phase === "failed" && r.state.error === "GitHub’s latest release is tagged “latest”, which isn’t a version Deer can compare.", r.state.error);

  // ---- newer: the whole way ----
  await U.clear();
  r = await U.run("newer-digest");
  const staged = PathUtils.join(U.updates(), "Deer-Setup-1.5.0.exe");
  check("newer (1.5.0): downloaded, verified, ready", r.state.phase === "ready" && r.state.available === "1.5.0" && !r.state.error, r.state);
  check("requests: the API, SHA256SUMS.txt and Deer-Setup.exe of the same release, through GitHub's redirect", JSON.stringify(U.paths(r.log)) === JSON.stringify(["/repos/test/deer/releases/latest", `${LINKS}/v1.5.0/SHA256SUMS.txt`, "/objects/v1.5.0/SHA256SUMS.txt", `${LINKS}/v1.5.0/Deer-Setup.exe`, "/objects/v1.5.0/Deer-Setup.exe"]), U.paths(r.log));
  check("no request carries a query string, a cookie or credentials", r.log.every((q) => !q.query && !Object.keys(q.headers).some((h) => /^(cookie|authorization)$/i.test(h))));
  const meta = await IOUtils.readJSON(PathUtils.join(U.updates(), "Deer-Setup-1.5.0.json"));
  check("the folder holds the setup and what its release said, nothing else", JSON.stringify(await U.files()) === JSON.stringify(["Deer-Setup-1.5.0.exe", "Deer-Setup-1.5.0.json"]), await U.files());
  check("the staged file is the release's (size and SHA-256 as published)", (await U.size("Deer-Setup-1.5.0.exe")) === meta.size && (await U.sha256(staged)) === meta.sha256 && meta.version === "1.5.0" && meta.tag === "v1.5.0", meta);

  // The hold launch() takes on the setup at quit: reading works, changing it does not.
  const hold = Up.hold(staged);
  let wrote = true;
  let moved = true;
  let removed = true;
  try {
    await IOUtils.write(staged, new Uint8Array(4), { mode: "appendOrCreate" });
  } catch {
    wrote = false;
  }
  try {
    await IOUtils.move(staged, staged + ".moved");
  } catch {
    moved = false;
  }
  try {
    await IOUtils.remove(staged);
  } catch {
    removed = false;
  }
  const readable = (await IOUtils.read(staged, { maxBytes: 16 })).byteLength === 16;
  hold?.close();
  check("while held, the setup can be read but not written, renamed or deleted", !!hold && readable && !wrote && !moved && !removed, { hold: !!hold, readable, wrote, moved, removed });
  check("after the hold, the setup is unchanged", (await U.sha256(staged)) === meta.sha256 && (await U.size("Deer-Setup-1.5.0.exe")) === meta.size);
  await IOUtils.move(staged, staged + ".moved");
  await IOUtils.move(staged + ".moved", staged);
  check("after the hold, it can be renamed again", (await U.size("Deer-Setup-1.5.0.exe")) === meta.size);

  r = await U.run("newer");
  check("checked again: still ready, the setup is not downloaded again", r.state.phase === "ready" && JSON.stringify(U.paths(r.log)) === JSON.stringify(["/repos/test/deer/releases/latest", `${LINKS}/v1.5.0/SHA256SUMS.txt`, "/objects/v1.5.0/SHA256SUMS.txt"]), U.paths(r.log));
  r = await U.run("error");
  check("a re-check that fails keeps offering the update already downloaded", r.state.phase === "ready" && r.state.available === "1.5.0", r.state);

  await Up.reload();
  check("after a restart (reload) the staged update is ready again", st().phase === "ready" && st().available === "1.5.0", st());

  r = await U.run("newer2");
  check("a newer release than the staged one (1.6.0): downloaded, ready, 1.5.0's files gone", r.state.phase === "ready" && r.state.available === "1.6.0" && JSON.stringify(await U.files()) === JSON.stringify(["Deer-Setup-1.6.0.exe", "Deer-Setup-1.6.0.json"]), { state: r.state, files: await U.files() });

  await U.clear();
  r = await U.run("upper-v");
  check("a release tagged V1.5.0 (capital V): offered as 1.5.0 and staged", r.state.phase === "ready" && r.state.available === "1.5.0" && (await U.files()).includes("Deer-Setup-1.5.0.exe"), { state: r.state, files: await U.files() });

  // ---- refused before anything is downloaded ----
  const BAD_URL = "GitHub gave a download address Deer doesn’t use, so nothing was downloaded.";
  const refusals = [
    ["no-setup", "Deer 1.5.0 is out, but its release has no Deer-Setup.exe yet.", 1],
    ["no-sums", "Deer 1.5.0’s release has no SHA256SUMS.txt, so Deer didn’t download it.", 1],
    ["sums-other", "SHA256SUMS.txt of Deer 1.5.0 has no checksum for Deer-Setup.exe, so Deer didn’t download it.", 3],
    ["bad-digest", "GitHub’s checksum for Deer 1.5.0 disagrees with its SHA256SUMS.txt, so Deer didn’t download it.", 3],
    ["huge-sums", "SHA256SUMS.txt of Deer 1.5.0 couldn’t be read, so Deer didn’t download it.", 3],
    ["other-host", BAD_URL, 1],
    ["outside", BAD_URL, 1],
  ];
  for (const [name, text, requests] of refusals) {
    await U.clear();
    r = await U.run(name);
    check(`${name}: refused in one sentence, the setup never requested`, r.state.phase === "failed" && r.state.error === text && r.log.length === requests && !r.log.some((q) => /Deer-Setup\.exe$/.test(q.path)), { error: r.state.error, log: U.paths(r.log) });
    check(`${name}: nothing left in the updates folder but notes`, await noExe(), await U.files());
  }
  await U.clear();
  r = await U.run("huge-api");
  check("an API answer over 1 MB: refused as unreadable", r.state.phase === "failed" && r.state.error === "GitHub’s answer about the latest release couldn’t be read; try again later." && r.log.length === 1, { error: r.state.error, log: U.paths(r.log) });

  // ---- redirected elsewhere ----
  await U.clear();
  r = await U.run("redirect-host");
  check("a setup link redirected to another host: refused, nothing kept", r.state.phase === "failed" && r.state.error === "GitHub sent the download to a server Deer doesn’t use, so nothing was downloaded." && (await noExe()), { error: r.state.error, files: await U.files(), log: r.log.map((q) => q.headers.Host + q.path) });

  // ---- refused after the download ----
  await U.clear();
  r = await U.run("bad-sum");
  check("checksum mismatch: downloaded, refused, deleted", r.state.phase === "failed" && r.state.error === "The download didn’t match its published checksum, so Deer deleted it." && r.log.some((q) => q.path === "/objects/v1.5.0/Deer-Setup.exe"), r.state.error);
  check("checksum mismatch: no setup or part left", await noExe(), await U.files());
  await U.clear();
  r = await U.run("size");
  check("a setup whose size is not the one GitHub gave: refused, deleted", r.state.phase === "failed" && r.state.error === "The download wasn’t the size GitHub gave for it, so Deer deleted it." && (await noExe()), { error: r.state.error, files: await U.files() });

  // ---- truncated, then resumed ----
  await U.clear();
  r = await U.run("truncate");
  const partSize = await U.size("Deer-Setup-1.5.0.exe.part");
  check("truncated download: one plain sentence, the part kept for later", r.state.phase === "failed" && r.state.error === "The download stopped before it finished; Deer continues it at the next check." && partSize > 0 && (await U.size("Deer-Setup-1.5.0.exe")) === -1, { error: r.state.error, partSize });
  await Up.reload();
  check("the part survives a restart (reload) for the next check", (await U.size("Deer-Setup-1.5.0.exe.part")) === partSize && st().phase === "idle", { files: await U.files(), st: st().phase });
  r = await U.run("newer");
  const ranged = r.log.find((q) => q.path === "/objects/v1.5.0/Deer-Setup.exe");
  check("the next check continues it with a Range request from where it stopped", ranged && ranged.headers.Range === `bytes=${partSize}-`, ranged && ranged.headers);
  check("resumed: complete, verified, ready", r.state.phase === "ready" && (await U.sha256(PathUtils.join(U.updates(), "Deer-Setup-1.5.0.exe"))) === (await IOUtils.readJSON(PathUtils.join(U.updates(), "Deer-Setup-1.5.0.json"))).sha256, r.state);

  await U.clear();
  await U.run("truncate");
  r = await U.run("norange");
  check("a server that ignores Range: the download starts over and completes", r.state.phase === "ready" && r.log.some((q) => q.headers.Range) && (await U.size("Deer-Setup-1.5.0.exe")) > 0, { state: r.state.phase, log: U.paths(r.log) });

  // ---- GitHub refusing, or not there ----
  await U.clear();
  r = await U.run("ratelimit");
  check("HTTP 403 rate limit: one sentence with the time it ends", r.state.phase === "failed" && /^GitHub’s limit for update checks was reached; try again after \d{1,2}:\d{2}( [AP]M)?\.$/.test(r.state.error), r.state.error);
  r = await U.run("toomany");
  check("HTTP 429: the same sentence", r.state.phase === "failed" && /^GitHub’s limit for update checks was reached; try again after/.test(r.state.error), r.state.error);
  r = await U.run("error");
  check("HTTP 500: one sentence", r.state.error === "GitHub answered with error 500; try again later.", r.state.error);
  r = await U.run("notfound");
  check("HTTP 404: one sentence", r.state.error === "Deer’s releases weren’t found on GitHub.", r.state.error);
  r = await U.run("badjson");
  check("an answer that is not JSON: one sentence", r.state.error === "GitHub’s answer about the latest release couldn’t be read; try again later.", r.state.error);
  Services.prefs.setStringPref("vitre.update.apiBase", U.down);
  await Up.check({ manual: true });
  check("server down (offline): one sentence", st().phase === "failed" && st().error === "Couldn’t reach GitHub; check your internet connection and try again.", st().error);
  Services.prefs.setStringPref("vitre.update.apiBase", U.base);

  // ---- an answer that stalls after its headers ----
  await U.server.scenario("stall-api");
  await U.server.reset();
  const t0 = Date.now();
  let ended = false;
  const stalled = Up.check({ manual: true }).then(() => (ended = true));
  await Promise.race([stalled, sleep(50000)]);
  const took = Date.now() - t0;
  check(`an API answer that stops after its headers: the check ends by itself (${Math.round(took / 1000)} s) with one sentence`, ended && st().phase === "failed" && st().error === "GitHub stopped answering half way; try again later." && took < 45000, { ended, phase: st().phase, error: st().error, took });
  r = await U.run("same");
  check("the next check runs (a request is made) and finds Deer up to date", r.state.phase === "current" && r.log.length === 1, { phase: r.state.phase, log: U.paths(r.log) });

  // ---- no write access ----
  await U.clear();
  await IOUtils.makeDirectory(PathUtils.parent(U.updates()), { createAncestors: true, ignoreExisting: true });
  await IOUtils.writeUTF8(U.updates(), "a file where the updates folder goes");
  r = await U.run("newer");
  check("no write access to the updates folder: one sentence naming it", r.state.phase === "failed" && r.state.error === `Deer can’t save updates in ${U.updates()}.`, r.state.error);
  await IOUtils.remove(U.updates());

  // ---- the folder at start ----
  await U.clear();
  await IOUtils.makeDirectory(PathUtils.join(U.updates(), "a folder"), { createAncestors: true });
  for (const f of ["Deer-Setup-1.0.0.exe", "Deer-Setup-1.3.0.exe.part", "Deer-Setup-1.3.0.json", "Deer-Setup-1.6.0.exe.part", "notes.txt", "Deer-Setup-latest.exe"]) await IOUtils.writeUTF8(PathUtils.join(U.updates(), f), "stale");
  await Up.reload();
  check("stale files are removed at start (old versions, a part with no record, other files); folders are left alone", JSON.stringify(await U.files()) === JSON.stringify(["a folder"]) && st().phase === "idle", await U.files());
  await IOUtils.remove(PathUtils.join(U.updates(), "a folder"), { recursive: true });

  // ---- what the last setup run said (setup.log) ----
  const setupLog = (text) => IOUtils.writeUTF8(PathUtils.join(U.updates(), "setup.log"), text);
  r = await U.run("newer");
  check("staged again", r.state.phase === "ready");
  await setupLog("12:00:00.000 update 1.4.2 -> 1.5.0 (just for me)\r\n12:03:00.000 Deer did not close within 180 s: not updated.\r\n12:03:00.001 RESULT 3\r\n");
  await Up.reload();
  check("setup.log RESULT 3: still ready, says why it did not install, the log is read once", st().phase === "ready" && st().lastAttempt === "Deer was still open" && !(await U.files()).includes("setup.log"), { st: st(), files: await U.files() });
  await setupLog("RESULT 4\r\n");
  await Up.reload();
  check("setup.log RESULT 4 (damaged setup): the staged update is dropped and the line says so", st().phase === "failed" && st().error === "Deer 1.5.0 didn’t install because the downloaded setup was damaged; Deer downloads it again at the next check." && (await noExe()), { st: st(), files: await U.files() });
  r = await U.run("newer");
  check("... and the next check downloads it again", r.state.phase === "ready" && r.log.some((q) => q.path === "/objects/v1.5.0/Deer-Setup.exe"), U.paths(r.log));

  // Setup said it installed (0), or that a newer Deer is there (6), yet the install still reads 1.4.2:
  // the release's setup is another version than its tag. Dropped, said, and that release not offered again.
  for (const code of [0, 6]) {
    Services.prefs.clearUserPref("vitre.update.skip");
    if (code === 6) {
      r = await U.run("newer");
      check("staged again", r.state.phase === "ready");
    }
    await setupLog(`RESULT ${code}\r\n`);
    await Up.reload();
    check(`setup.log RESULT ${code} with the install still at 1.4.2: dropped, one sentence, the release remembered`, st().phase === "failed" && st().error === "Deer 1.5.0 didn’t install: its release holds the setup of another version." && (await noExe()) && Services.prefs.getStringPref("vitre.update.skip", "") === `1.5.0 ${meta.sha256}`, { st: st(), files: await U.files(), skip: Services.prefs.getStringPref("vitre.update.skip", "") });
    r = await U.run("newer");
    check(`RESULT ${code}: the same release is not downloaded again, and the line says why`, r.state.phase === "failed" && r.state.error === "Deer 1.5.0’s release holds the setup of another version, so Deer doesn’t offer it." && !r.log.some((q) => /Deer-Setup\.exe$/.test(q.path)), { error: r.state.error, log: U.paths(r.log) });
  }
  r = await U.run("newer2");
  check("a later release (1.6.0) is offered as usual", r.state.phase === "ready" && r.state.available === "1.6.0", r.state);
  Services.prefs.clearUserPref("vitre.update.skip");
  await U.clear();

  // ---- signed releases (a release key: here a test key through vitre.update.testKey) ----
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sumsBytes = new Uint8Array(await (await fetch(`${U.base}/objects/v1.5.0/SHA256SUMS.txt`, { cache: "no-store" })).arrayBuffer());
  const useSig = async (key, data = sumsBytes) => fetch(`${U.base}/__sig/${b64url(await crypto.subtle.sign({ name: "Ed25519" }, key, data))}`, { cache: "no-store" });
  Services.prefs.setStringPref("vitre.update.testKey", b64(await crypto.subtle.exportKey("raw", keys.publicKey)));
  await U.clear();
  r = await U.run("newer");
  check("with a release key, a release without SHA256SUMS.txt.sig: refused, nothing downloaded", r.state.phase === "failed" && r.state.error === "Deer 1.5.0’s release isn’t signed, so Deer didn’t download it." && r.log.length === 1, { error: r.state.error, log: U.paths(r.log) });
  await useSig(other.privateKey);
  r = await U.run("signed");
  check("a signature by another key (a release that is not the owner's): refused, the setup never requested", r.state.phase === "failed" && r.state.error === "Deer 1.5.0’s release isn’t signed with Deer’s key, so Deer didn’t download it." && !r.log.some((q) => /Deer-Setup\.exe$/.test(q.path)), { error: r.state.error, log: U.paths(r.log) });
  await useSig(keys.privateKey, new TextEncoder().encode("another SHA256SUMS.txt\n"));
  r = await U.run("signed");
  check("the key's signature of other content: refused", r.state.phase === "failed" && r.state.error === "Deer 1.5.0’s release isn’t signed with Deer’s key, so Deer didn’t download it.", r.state.error);
  await useSig(keys.privateKey);
  r = await U.run("signed");
  check("signed with the key: downloaded, verified, ready (requests: the API, SHA256SUMS.txt, its signature, the setup)", r.state.phase === "ready" && r.state.available === "1.5.0" && r.log.some((q) => q.path === "/objects/v1.5.0/SHA256SUMS.txt.sig") && r.log.some((q) => q.path === "/objects/v1.5.0/Deer-Setup.exe"), { state: r.state, log: U.paths(r.log) });
  Services.prefs.clearUserPref("vitre.update.testKey");
  await U.clear();
  r = await U.run("newer");
  check("without a release key (this build has none) no signature is needed", r.state.phase === "ready" && !r.log.some((q) => /\.sig$/.test(q.path)), { state: r.state.phase, log: U.paths(r.log) });
  await U.clear();

  r = await U.run("newer");
  check("staged again", r.state.phase === "ready");
  await U.fakeInstall({ version: "1.5.0" });
  await Up.reload();
  check("the install caught up (1.5.0 installed): the staged setup and its record are removed", st().phase === "idle" && st().version === "1.5.0" && (await U.files()).length === 0, { st: st(), files: await U.files() });
  r = await U.run("newer");
  check("1.5.0 installed, 1.5.0 latest: up to date", r.state.phase === "current", r.state);

  // ---- installs that never update ----
  const never = [
    [{ mode: "test" }, "a test install (install.ini Mode=test)", "Updates are off in test installs"],
    [{ channel: "local-test" }, "a local-test build", "Updates are off in development builds"],
    [{ versionFile: false }, "no deer-version.json", "Updates are off in development builds"],
    [{ ini: false }, "a release folder that was never installed", "Updates are off because this copy of Deer wasn’t installed with Deer Setup"],
  ];
  for (const [opts, what, reason] of never) {
    await U.fakeInstall(opts);
    await Up.reload();
    await U.server.reset();
    await Up.check({ manual: true });
    const seen = await U.server.log();
    check(`${what}: off, says why, and a check contacts nothing`, st().phase === "off" && st().offReason === reason && seen.length === 0, { st: st(), requests: seen.length });
  }
  log("updates folder at the end: " + JSON.stringify(await U.files()));
});
