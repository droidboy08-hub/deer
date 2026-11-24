// macOS: Settings › Video downloads › Download ffmpeg and Download yt-dlp (with Deno), against local
// stand-ins of their macOS sources (tests/downloads/mac-tools.py serves them and runs this):
//   0. the folders are Deer's under the data root (no old folders on a Mac), files Deer writes in this
//      run are quarantined (LSFileQuarantineEnabled: what the install must undo), and the page offers
//      both downloads in Mac words;
//   1. Download ffmpeg follows the release's redirect to the versioned file, checks its .sha256,
//      unpacks ffmpeg alone, mode 0755 and no quarantine, starts it (phase verifying), points the
//      setting at it;
//   2. an ffmpeg whose fingerprint does not match installs nothing and says why;
//   2b. while ffmpeg starts for the first time the row says Checking and offers Cancel, which stops it;
//   3. Download yt-dlp installs the onedir build (yt-dlp/yt-dlp_macos beside _internal) and Deno for
//      this Mac's processor (the stand-in Denos name theirs): phases, files, modes, nothing quarantined,
//      nothing left over, Deer's own runner reads both versions, the page shows them;
//   3b. an update waits for a yt-dlp that runs (it reads its folder; Deer's runner marks it there) before
//      it replaces the folder;
//   3c. another Deer sharing the folder (Deer Dev), stood in for by /bin/sleep processes: while it holds
//      an install lock and runs, installs say so and change nothing, and once it has ended its lock is
//      taken over; an update waits for a yt-dlp it marked as running, and refuses over one that still
//      runs after 20 s, leaving the installed pair as it was;
//   (also: with its sources unreachable an install fails on the network, "could not be reached", not as a Mac);
//   4. an update whose fingerprint does not match leaves the installed pair as it was;
//   5. a zip with an entry outside its folder installs nothing and writes nothing outside;
//   6. a Deno that does not start, and 7. a Deno whose fingerprint does not match, install nothing.
//   python3 tests/downloads/mac-tools.py [--no-capture]
/* global spike, Services, ChromeUtils, IOUtils, PathUtils */
spike.main(async () => {
  const { check, log, waitFor, sleep } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    log("macOS only: nothing to do here");
    return;
  }
  const b = window.vitre;
  await spike.resize(1280, 860);
  await spike.activate();
  const base = Services.env.get("MACTOOLS_BASE");
  check("the stand-in releases are served", !!base, base);
  const engine = b.sys("VitreDownloads");
  const root = Services.prefs.getStringPref("vitre.localAppData", "");
  const deer = PathUtils.join(root, "Deer");
  const QUAR = "com.apple.quarantine";
  const arch = /^x86_64/.test(Services.appinfo.XPCOMABI) ? "x86_64" : "aarch64";
  log("engine " + Services.appinfo.XPCOMABI + ", data root " + root);
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const mode = async (p) => (await IOUtils.stat(p)).permissions & 0o777;
  /** Every path under dir (itself excluded), relative, sorted. */
  const tree = async (dir) => {
    const out = [];
    const walk = async (p, rel) => {
      for (const c of await IOUtils.getChildren(p)) {
        const r = rel ? rel + "/" + PathUtils.filename(c) : PathUtils.filename(c);
        out.push(r);
        if ((await IOUtils.stat(c)).type === "directory") await walk(c, r);
      }
    };
    if (await IOUtils.exists(dir)) await walk(dir, "");
    return out.sort();
  };
  const quarantined = async (dir) => {
    const bad = [];
    for (const r of await tree(dir)) if (await IOUtils.hasMacXAttr(PathUtils.join(dir, ...r.split("/")), QUAR)) bad.push(r);
    if (await IOUtils.hasMacXAttr(dir, QUAR)) bad.push(".");
    return bad;
  };
  const runOut = async (exe, args) => {
    const p = await Subprocess.call({ command: exe, arguments: args, stderr: "stdout" });
    let out = "";
    for (;;) {
      const s = await p.stdout.readString();
      if (!s) break;
      out += s;
    }
    return { code: (await p.wait()).exitCode, out };
  };
  const srcPrefs = ["vitre.ffmpeg.source", "vitre.ffmpeg.installDir", "vitre.tools.source.ytdlp", "vitre.tools.source.deno", "vitre.tools.installDir"];
  for (const p of srcPrefs) Services.prefs.clearUserPref(p);
  b.sys("VitreSettings").set({ ffmpegPath: "" });

  // ---- 0. folders, quarantine in this run, the page ----
  const f0 = engine.toolFolders();
  check(
    "the tools go to Deer's folder under the data root, no old folders on a Mac",
    f0.ffmpeg === PathUtils.join(deer, "ffmpeg") && f0.tools === PathUtils.join(deer, "tools") && f0.oldFfmpeg === "" && f0.oldTools === "" && f0.ytdlpFrom === "",
    f0
  );
  const probe = PathUtils.join(root, "quarantine-probe.txt");
  await IOUtils.writeUTF8(probe, "x");
  const probeQ = await IOUtils.hasMacXAttr(probe, QUAR);
  await IOUtils.remove(probe);
  check("files Deer writes in this run carry com.apple.quarantine (what the install must take off)", probeQ, probeQ);
  const before = await engine.ffmpeg();
  check("no ffmpeg found (PATH without Homebrew, nothing downloaded)", !before.path, before);
  check("no yt-dlp installed", !engine.hasYtdlp());

  const settings = await b.whenService("settings");
  settings.open("video-downloads");
  const $ = (id) => document.getElementById(id);
  await waitFor(() => $("vd-ff-get-row") && !$("vd-ff-get-row").hidden && $("vd-yt-row"), { what: "the Download rows" });
  await sleep(600);
  const main = document.querySelector("#vitre-settings .vs-main");
  const words = main?.textContent ?? "";
  check("the page offers to download ffmpeg", $("vd-ff-get").textContent === "Download" && !$("vd-ff-get").hidden && /Martin Riedl/.test($("vd-ff-get-status").textContent), $("vd-ff-get-status").textContent);
  check("the page offers to download yt-dlp", $("vd-yt-get").textContent === "Download" && !$("vd-yt-get").hidden && $("vd-yt-status").textContent === "Not installed", $("vd-yt-status").textContent);
  check("the page names nothing of Windows and promises nothing it cannot do", !/Windows|\bCtrl\b|\bAlt\b|Explorer|Program Files|\.exe\b|this PC|on a Mac yet/.test(words), words.slice(0, 400));
  await spike.capture("mac-tools-1-offer");

  // ---- 1. ffmpeg ----
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/ff/good/");
  const ffPhases = [];
  const offFf = engine.onFfmpegInstall((s) => ffPhases[ffPhases.length - 1] !== s.phase && ffPhases.push(s.phase));
  spike.click($("vd-ff-get"));
  const ff = await waitFor(() => ["done", "failed", "cancelled"].includes(engine.ffmpegInstall().phase) && engine.ffmpegInstall(), { timeout: 60000, what: "the ffmpeg install" });
  offFf();
  log("ffmpeg phases " + ffPhases.join(" > "));
  check("ffmpeg installed", ff.phase === "done", ff);
  check(
    "ffmpeg went through checking, downloading, verifying, unpacking, then verifying again for its first start",
    ["checking", "downloading", "verifying", "unpacking", "done"].every((p) => ffPhases.includes(p)) && ffPhases.lastIndexOf("verifying") > ffPhases.indexOf("unpacking"),
    ffPhases
  );
  check("its version is read from the versioned address the redirect led to (9.0.2)", ff.version === "9.0.2", ff.version);
  const ffExe = PathUtils.join(deer, "ffmpeg", "ffmpeg");
  check("ffmpeg is Deer's folder's ffmpeg/ffmpeg", ff.path === ffExe, ff.path);
  await waitFor(() => b.settings.ffmpegPath === ffExe, { what: "the setting" });
  check("ffmpeg alone is kept", JSON.stringify(await tree(PathUtils.join(deer, "ffmpeg"))) === JSON.stringify(["ffmpeg"]), await tree(PathUtils.join(deer, "ffmpeg")));
  check("ffmpeg is mode 0755 (stored 0644 in the zip)", (await mode(ffExe)) === 0o755, (await mode(ffExe)).toString(8));
  check("ffmpeg and its folder carry no quarantine", (await quarantined(PathUtils.join(deer, "ffmpeg"))).length === 0, await quarantined(PathUtils.join(deer, "ffmpeg")));
  check("the zip, the fresh folder and the install lock are gone", !(await tree(deer)).some((r) => /ffmpeg-download|ffmpeg\.new|install-lock/.test(r)), await tree(deer));
  const ffInfo = await engine.ffmpeg();
  check("the engine uses it (the setting)", ffInfo.path === ffExe && ffInfo.source === "settings", ffInfo);
  const ffRun = await runOut(ffExe, ["-version"]);
  check("the installed ffmpeg runs", ffRun.code === 0 && /ffmpeg version 9\.0\.2/.test(ffRun.out), ffRun);
  await waitFor(() => $("vd-ff-get-row").hidden, { what: "the row to step aside" });
  await sleep(300);
  check("with ffmpeg found the Download row steps aside and the page says which file is used", $("vd-ff-get-row").hidden && document.querySelector(".vs-path")?.textContent.includes(ffExe), document.querySelector(".vs-path")?.textContent);
  // Found without the setting too: the downloaded copy in Deer's folder.
  b.sys("VitreSettings").set({ ffmpegPath: "" });
  await sleep(200);
  const ffDl = await engine.ffmpeg();
  check("without the setting the engine finds Deer's downloaded copy", ffDl.path === ffExe && ffDl.source === "downloaded", ffDl);
  b.sys("VitreSettings").set({ ffmpegPath: ffExe });

  // ---- 2. ffmpeg: a fingerprint that does not match ----
  const ffBadDir = PathUtils.join(root, "ff-bad", "ffmpeg");
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", ffBadDir);
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/ff/bad/");
  b.sys("VitreSettings").set({ ffmpegPath: "" });
  await waitFor(() => !$("vd-ff-get-row").hidden, { what: "the row back" });
  const ffFail = await engine.installFfmpeg().then(() => null, (e) => e);
  const ffSt = engine.ffmpegInstall();
  check("a mismatching ffmpeg fingerprint fails the install", !!ffFail && ffSt.phase === "failed" && /fingerprint/.test(ffSt.error), ffSt);
  check("nothing of it is installed or left", JSON.stringify(await tree(PathUtils.join(root, "ff-bad"))) === "[]", await tree(PathUtils.join(root, "ff-bad")));
  await sleep(300);
  check("the page says why and offers to try again", $("vd-ff-get").textContent === "Try again" && /fingerprint/.test($("vd-ff-get-status").textContent), $("vd-ff-get-status").textContent);
  await spike.capture("mac-tools-2-ffmpeg-failed");

  // ---- 2b. Cancel while ffmpeg starts for the first time ----
  const ffSlow = PathUtils.join(root, "ff-slow");
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", PathUtils.join(ffSlow, "ffmpeg"));
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/ff/slow/");
  const slowPhases = [];
  const offSlow = engine.onFfmpegInstall((s) => slowPhases[slowPhases.length - 1] !== s.phase && slowPhases.push(s.phase));
  spike.click($("vd-ff-get"));
  const started = await waitFor(() => slowPhases.includes("unpacking") && engine.ffmpegInstall().phase === "verifying", { timeout: 30000, what: "ffmpeg's first start" }).then(
    () => true,
    () => false
  );
  if (!started) log("ffmpeg's first start not seen: phases " + slowPhases.join(" > ") + "; state " + JSON.stringify(engine.ffmpegInstall()));
  await sleep(400);
  const startRow = { status: $("vd-ff-get-status").textContent, cancel: !$("vd-ff-stop").hidden, get: !$("vd-ff-get").hidden };
  check("while ffmpeg starts for the first time the row says Checking and offers Cancel", startRow.status === "Checking FFmpeg 9.0.2…" && startRow.cancel && !startRow.get, startRow);
  const c0 = Date.now();
  spike.click($("vd-ff-stop"));
  await waitFor(() => engine.ffmpegInstall().phase === "cancelled" && engine.ffmpegInstall(), { timeout: 15000, what: "the cancel" });
  offSlow();
  const cancelMs = Date.now() - c0;
  log("ffmpeg phases " + slowPhases.join(" > ") + "; cancelled in " + cancelMs + " ms");
  check("Cancel stops ffmpeg's first start at once, and nothing of it is installed or left (no lock)", cancelMs < 5000 && JSON.stringify(await tree(ffSlow)) === "[]", { cancelMs, left: await tree(ffSlow) });
  Services.prefs.clearUserPref("vitre.ffmpeg.installDir");
  Services.prefs.clearUserPref("vitre.ffmpeg.source");
  b.sys("VitreSettings").set({ ffmpegPath: ffExe });

  // ---- 3. yt-dlp and Deno ----
  Services.prefs.setStringPref("vitre.tools.source.ytdlp", base + "/yt/good/");
  Services.prefs.setStringPref("vitre.tools.source.deno", base + "/deno/good/");
  const ytPhases = [];
  const offYt = engine.onYtdlpInstall((s) => {
    const k = s.phase + (s.tool ? ":" + s.tool : "");
    if (ytPhases[ytPhases.length - 1] !== k) ytPhases.push(k);
  });
  spike.click($("vd-yt-get"));
  const yt = await waitFor(() => ["done", "failed", "cancelled"].includes(engine.ytdlpInstall().phase) && engine.ytdlpInstall(), { timeout: 60000, what: "the yt-dlp install" });
  offYt();
  log("yt-dlp phases " + ytPhases.join(" > "));
  check("yt-dlp and Deno installed", yt.phase === "done", yt);
  check(
    "it went through checking, then yt-dlp and Deno each downloaded, verified, unpacked and started once",
    ["checking", "downloading:yt-dlp", "verifying:yt-dlp", "unpacking:yt-dlp", "downloading:Deno", "verifying:Deno", "unpacking:Deno", "done"].every((p) => ytPhases.includes(p)) &&
      ytPhases.lastIndexOf("verifying:yt-dlp") > ytPhases.indexOf("unpacking:Deno"),
    ytPhases
  );
  const tools = PathUtils.join(deer, "tools");
  const ytExe = PathUtils.join(tools, "yt-dlp", "yt-dlp_macos");
  const deno = PathUtils.join(tools, "deno");
  const want = ["deno", "yt-dlp", "yt-dlp/_internal", "yt-dlp/_internal/Python", "yt-dlp/_internal/base_library.zip", "yt-dlp/_internal/lib-dynload", "yt-dlp/_internal/lib-dynload/_heapq.cpython-314-darwin.so", "yt-dlp/yt-dlp_macos"];
  const got = await tree(tools);
  check("the onedir build is unpacked whole beside Deno, and no zip, fresh folder or temporary file is left", JSON.stringify(got) === JSON.stringify(want), got);
  check("yt-dlp_macos and deno are mode 0755 (stored 0644), the zip's other modes kept", (await mode(ytExe)) === 0o755 && (await mode(deno)) === 0o755 && (await mode(PathUtils.join(tools, "yt-dlp", "_internal", "Python"))) === 0o755, [(await mode(ytExe)).toString(8), (await mode(deno)).toString(8)]);
  // The tools folder itself is a plain folder Deer made (quarantined like everything Deer writes; nothing is run from it).
  check("nothing Deer installed in the tools folder carries quarantine", (await quarantined(tools)).filter((r) => r !== ".").length === 0, await quarantined(tools));
  check("the engine finds them", engine.hasYtdlp(), engine.toolFolders());
  check("toolFolders names the tools folder it found them in", engine.toolFolders().ytdlpFrom === tools, engine.toolFolders());
  const version = await engine.ytdlpVersion();
  check("Deer's own runner starts both (yt-dlp --version through run(), deno --version)", version === "yt-dlp 2026.10.26 · Deno 2.9.8", version);
  const denoSays = (await runOut(deno, ["--version"])).out;
  check("Deno is the build for this engine's processor (deno-" + arch + "-apple-darwin.zip)", new RegExp("\\(stable, release, " + arch + "-apple-darwin\\)").test(denoSays), denoSays.split("\n")[0]);
  check("no yt-dlp is marked as running once Deer's runner has ended", !(await tree(tools)).some((r) => /^\.yt-dlp-running-/.test(r)), await tree(tools));
  await waitFor(() => /2026\.10\.26/.test($("vd-yt-status").textContent), { what: "the version on the page" });
  check("the page shows the versions and offers Update", $("vd-yt-get").textContent === "Update" && /yt-dlp 2026\.10\.26 · Deno 2\.9\.8/.test($("vd-yt-status").textContent), [$("vd-yt-get").textContent, $("vd-yt-status").textContent]);
  await spike.capture("mac-tools-3-installed");

  // ---- 3b. an update waits for a yt-dlp that runs (it reads its folder) before it replaces the folder ----
  // "; exit 0": the shell stays the process (it would become sleep for a lone command).
  Services.prefs.setStringPref("vitre.tools.ytdlpCommand", JSON.stringify(["/bin/sh", "-c", "sleep 4; exit 0", "yt-dlp"]));
  let slowEnd = 0;
  const s0 = Date.now();
  const slow = engine.ytdlpVersion().then(() => (slowEnd = Date.now())); // 4 s through run()
  await sleep(300);
  Services.prefs.clearUserPref("vitre.tools.ytdlpCommand");
  const marks = [];
  for (const r of await tree(tools)) if (/^\.yt-dlp-running-\d+$/.test(r)) marks.push({ r, program: await IOUtils.readUTF8(PathUtils.join(tools, r)) });
  check("Deer's runner marks the yt-dlp that runs in the tools folder (for another Deer sharing it)", marks.length === 1 && marks[0].program === "/bin/sh", marks);
  await engine.installYtdlp(false).catch((e) => log("update error " + e));
  const upEnd = Date.now();
  await slow;
  // It ended at s0 + 4 s; the update alone takes about a second here.
  check("an update waits for a yt-dlp that runs, then replaces it", engine.ytdlpInstall().phase === "done" && slowEnd > 0 && upEnd - s0 >= 3900 && JSON.stringify(await tree(tools)) === JSON.stringify(want), { state: engine.ytdlpInstall(), took: upEnd - s0, ran: slowEnd - s0 });

  // ---- 3c. another Deer sharing the folder (Deer Dev), stood in for by /bin/sleep processes ----
  const sleeper = (secs) => Subprocess.call({ command: "/bin/sleep", arguments: [String(secs)] });
  const lockOf = (pid) => JSON.stringify({ pid, exe: "/bin/sleep", at: Date.now() });
  const other = await sleeper(120);
  const ytLock = PathUtils.join(tools, ".install-lock");
  await IOUtils.writeUTF8(ytLock, lockOf(other.pid));
  const lockFail = await engine.installYtdlp(false).then(() => null, (e) => e);
  const lockSt = engine.ytdlpInstall();
  check(
    "while another Deer that runs holds the install lock, an install says so at once and changes nothing",
    !!lockFail && lockSt.phase === "failed" && lockSt.error === "another Deer is installing yt-dlp right now; try again when it has finished" && lockSt.received === 0 && JSON.stringify(await tree(tools)) === JSON.stringify([".install-lock", ...want]) && (await IOUtils.readUTF8(ytLock)).includes('"pid":' + other.pid),
    { lockSt, left: await tree(tools) }
  );
  await sleep(300);
  check("the page says another Deer is installing", $("vd-yt-status").textContent === "Couldn’t install: another Deer is installing yt-dlp right now; try again when it has finished.", $("vd-yt-status").textContent);
  // ffmpeg's lock likewise (beside its folder).
  const ffLockDir = PathUtils.join(root, "ff-lock");
  await IOUtils.makeDirectory(ffLockDir, { ignoreExisting: true });
  await IOUtils.writeUTF8(PathUtils.join(ffLockDir, ".ffmpeg-install-lock"), lockOf(other.pid));
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", PathUtils.join(ffLockDir, "ffmpeg"));
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/ff/good/");
  const ffLockFail = await engine.installFfmpeg().then(() => null, (e) => e);
  const ffLockSt = engine.ffmpegInstall();
  check("ffmpeg's install says so too and changes nothing", !!ffLockFail && ffLockSt.phase === "failed" && ffLockSt.error === "another Deer is installing it right now; try again when it has finished" && JSON.stringify(await tree(ffLockDir)) === '[".ffmpeg-install-lock"]', { ffLockSt, left: await tree(ffLockDir) });
  other.kill();
  await other.wait();
  const ffTaken = await engine.installFfmpeg().then(() => null, (e) => e);
  check("once that Deer has ended, its ffmpeg lock is stale: the install takes it over, installs, and leaves no lock", !ffTaken && engine.ffmpegInstall().phase === "done" && JSON.stringify(await tree(ffLockDir)) === '["ffmpeg","ffmpeg/ffmpeg"]', { st: engine.ffmpegInstall(), left: await tree(ffLockDir) });
  Services.prefs.clearUserPref("vitre.ffmpeg.installDir");
  Services.prefs.clearUserPref("vitre.ffmpeg.source");
  b.sys("VitreSettings").set({ ffmpegPath: ffExe });
  const taken = await engine.installYtdlp(false).then(() => null, (e) => e);
  check("and its yt-dlp lock: the install takes it over and installs, no lock left", !taken && engine.ytdlpInstall().phase === "done" && JSON.stringify(await tree(tools)) === JSON.stringify(want), { st: engine.ytdlpInstall(), left: await tree(tools) });
  // Its yt-dlp that runs (marked as Deer's runner marks one): an update waits for it.
  const o0 = Date.now();
  const otherYt = await sleeper(5);
  await IOUtils.writeUTF8(PathUtils.join(tools, ".yt-dlp-running-" + otherYt.pid), "/bin/sleep");
  let otherEnd = 0;
  otherYt.wait().then(() => (otherEnd = Date.now()));
  await engine.installYtdlp(false).catch((e) => log("update error " + e));
  const up2End = Date.now();
  await otherYt.wait();
  check(
    "an update waits for a yt-dlp another Deer marked as running, then replaces the folder (the ended one's mark goes)",
    engine.ytdlpInstall().phase === "done" && up2End - o0 >= 4900 && JSON.stringify(await tree(tools)) === JSON.stringify(want),
    { st: engine.ytdlpInstall(), took: up2End - o0, ran: otherEnd - o0, left: await tree(tools) }
  );
  // One that still runs after 20 s: refused as Windows refuses, nothing replaced.
  const longYt = await sleeper(120);
  const longMark = PathUtils.join(tools, ".yt-dlp-running-" + longYt.pid);
  await IOUtils.writeUTF8(longMark, "/bin/sleep");
  const keep = PathUtils.join(tools, "yt-dlp", "_internal", "keep-me.txt");
  await IOUtils.writeUTF8(keep, "the installed folder");
  const l0 = Date.now();
  const busyFail = await engine.installYtdlp(false).then(() => null, (e) => e);
  const busySt = engine.ytdlpInstall();
  check(
    "an update refuses over another Deer's yt-dlp that still runs after 20 s, leaving the installed folder as it was",
    !!busyFail && busySt.phase === "failed" && busySt.error === "yt-dlp is in use by a download; let it finish and try again" && Date.now() - l0 >= 20000 && (await IOUtils.exists(keep)) && (await IOUtils.exists(longMark)) && engine.hasYtdlp(),
    { busySt, ms: Date.now() - l0, left: await tree(tools) }
  );
  longYt.kill();
  await longYt.wait();
  await IOUtils.remove(keep);
  await IOUtils.remove(longMark);
  check("nothing of its own is left by the refused update", JSON.stringify(await tree(tools)) === JSON.stringify(want), await tree(tools));

  // ---- 4. an update whose fingerprint does not match ----
  Services.prefs.setStringPref("vitre.tools.source.ytdlp", base + "/yt/bad/");
  const upFail = await engine.installYtdlp(true).then(() => null, (e) => e);
  const upSt = engine.ytdlpInstall();
  check("a mismatching yt-dlp fingerprint fails the update", !!upFail && upSt.phase === "failed" && /yt-dlp did not match its published fingerprint/.test(upSt.error), upSt);
  check("the installed pair stays as it was, nothing left over", JSON.stringify(await tree(tools)) === JSON.stringify(want) && engine.hasYtdlp(), await tree(tools));
  await sleep(300);
  check("the page says why", /Couldn’t install: yt-dlp did not match its published fingerprint/.test($("vd-yt-status").textContent) && $("vd-yt-get").textContent === "Try again", $("vd-yt-status").textContent);

  // ---- 5. an entry outside the folder ----
  const slipDir = PathUtils.join(root, "slip", "tools");
  Services.prefs.setStringPref("vitre.tools.installDir", slipDir);
  Services.prefs.setStringPref("vitre.tools.source.ytdlp", base + "/yt/slip/");
  const slipFail = await engine.installYtdlp(false).then(() => null, (e) => e);
  const slipSt = engine.ytdlpInstall();
  check("a zip with an entry outside its folder is refused", !!slipFail && slipSt.phase === "failed" && /outside its folder/.test(slipSt.error), slipSt);
  check("nothing is installed and nothing written outside", JSON.stringify(await tree(PathUtils.join(root, "slip"))) === JSON.stringify(["tools"]) && !(await IOUtils.exists(PathUtils.join(slipDir, "escape.txt"))) && !engine.hasYtdlp(), await tree(PathUtils.join(root, "slip")));

  // ---- 6. a Deno that does not start ----
  const brokenDir = PathUtils.join(root, "broken", "tools");
  Services.prefs.setStringPref("vitre.tools.installDir", brokenDir);
  Services.prefs.setStringPref("vitre.tools.source.ytdlp", base + "/yt/good/");
  Services.prefs.setStringPref("vitre.tools.source.deno", base + "/deno/broken/");
  const brFail = await engine.installYtdlp(false).then(() => null, (e) => e);
  const brSt = engine.ytdlpInstall();
  check("a Deno that does not start is not installed", !!brFail && brSt.phase === "failed" && /the downloaded Deno did not start on this Mac/.test(brSt.error), brSt);
  check("nothing of the pair is put in place or left over", JSON.stringify(await tree(brokenDir)) === "[]" && !engine.hasYtdlp(), await tree(brokenDir));

  // ---- 7. a Deno whose fingerprint does not match ----
  Services.prefs.setStringPref("vitre.tools.source.deno", base + "/deno/bad/");
  const dbFail = await engine.installYtdlp(false).then(() => null, (e) => e);
  const dbSt = engine.ytdlpInstall();
  check("a mismatching Deno fingerprint fails the install", !!dbFail && dbSt.phase === "failed" && /Deno did not match its published fingerprint/.test(dbSt.error), dbSt);
  check("nothing of the pair is put in place or left over", JSON.stringify(await tree(brokenDir)) === "[]" && !engine.hasYtdlp(), await tree(brokenDir));

  // ---- 8. sources that cannot be reached: a network failure, said as one (not a refusal for being a Mac) ----
  const deadDir = PathUtils.join(root, "dead");
  Services.prefs.setStringPref("vitre.tools.installDir", PathUtils.join(deadDir, "tools"));
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", PathUtils.join(deadDir, "ffmpeg"));
  for (const p of ["vitre.ffmpeg.source", "vitre.tools.source.ytdlp", "vitre.tools.source.deno"]) Services.prefs.setStringPref(p, "http://127.0.0.1:9/");
  const deadFf = await engine.installFfmpeg().then(() => "", (e) => String(e?.message || e));
  const deadYt = await engine.installYtdlp(false).then(() => "", (e) => String(e?.message || e));
  check(
    "with the sources unreachable both installs fail with 'the release could not be reached', receive and leave nothing",
    deadFf === "the release could not be reached" && deadYt === "the release could not be reached" && engine.ffmpegInstall().received === 0 && engine.ytdlpInstall().received === 0 && JSON.stringify(await tree(deadDir)) === '["tools"]',
    { deadFf, deadYt, left: await tree(deadDir) }
  );

  for (const p of srcPrefs) Services.prefs.clearUserPref(p);
  b.sys("VitreSettings").set({ ffmpegPath: "" });
});
