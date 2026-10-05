// Settings › Video downloads › Download ffmpeg, against a local stand-in release
// (tests/downloads/ffmpeg_release.py, started by tests/downloads/ffmpeg-install.py):
//   1. with no ffmpeg the page offers the download; a click installs the newest stable LGPL shared
//      build from the checksum list (n9.0, not master or n8.1), only ffmpeg.exe, its DLLs and the
//      licence; the setting points at it, it runs, the zip is gone;
//   2. a release whose fingerprint does not match installs nothing and says why.
/* global spike, Services, ChromeUtils, IOUtils, PathUtils */
spike.main(async () => {
  const { check, log, waitFor, sleep } = spike;
  const b = window.vitre;
  await spike.resize(1280, 860);
  await spike.activate();
  const base = Services.env.get("FFTEST_BASE");
  const root = Services.env.get("FFTEST_DIR");
  const installDir = PathUtils.join(root, "install");
  const engine = b.sys("VitreDownloads");
  b.sys("VitreSettings").set({ ffmpegPath: "" });
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", installDir);
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/good/");

  const before = await engine.ffmpeg();
  check("no ffmpeg on this machine's PATH, beside Deer or in its folders", !before.path, before);

  const settings = await b.whenService("settings");
  settings.open("video-downloads");
  const $ = (id) => document.getElementById(id);
  await waitFor(() => $("vd-ff-get-row") && !$("vd-ff-get-row").hidden, { what: "the Download ffmpeg row" });
  await sleep(400);
  check("the page offers to download ffmpeg", $("vd-ff-get").textContent === "Download" && !$("vd-ff-get").hidden, $("vd-ff-get-status").textContent);
  await spike.capture("ffmpeg-1-offer");

  // ---- 1. install ----
  const phases = [];
  const off = engine.onFfmpegInstall((s) => phases[phases.length - 1] !== s.phase && phases.push(s.phase));
  spike.click($("vd-ff-get"));
  const done = await waitFor(() => ["done", "failed"].includes(engine.ffmpegInstall().phase) && engine.ffmpegInstall(), { timeout: 60000, what: "the install" });
  off();
  log("phases " + phases.join(" > "));
  check("installed", done.phase === "done", done);
  check("it went through checking, downloading, verifying, unpacking", ["checking", "downloading", "verifying", "unpacking", "done"].every((p) => phases.includes(p)), phases);
  check("the newest stable release was picked (9.0)", done.version === "9.0", done.version);
  const exe = PathUtils.join(installDir, "ffmpeg.exe");
  await waitFor(() => b.settings.ffmpegPath === exe, { what: "the setting" });
  check("the setting points at the installed ffmpeg.exe", b.settings.ffmpegPath === exe, b.settings.ffmpegPath);
  const files = (await IOUtils.getChildren(installDir)).map((p) => PathUtils.filename(p)).sort();
  check("only ffmpeg.exe, its DLLs and the licence are kept", JSON.stringify(files) === JSON.stringify(["LICENSE.txt", "avcodec-62.dll", "ffmpeg.exe"]), files);
  const parent = PathUtils.parent(installDir);
  check("the downloaded zip is removed", !(await IOUtils.exists(PathUtils.join(parent, "ffmpeg-download.zip"))));
  const after = await engine.ffmpeg();
  check("the engine now finds it", after.path === exe && after.source === "settings", after);
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const size = (await IOUtils.stat(exe)).size;
  const want = Number(Services.env.get("FFTEST_EXE_SIZE"));
  check("ffmpeg.exe is unpacked whole", size === want, [size, want]);
  const proc = await Subprocess.call({ command: exe, arguments: ["-version"], stderr: "stdout" });
  let out = "";
  for (;;) {
    const s = await proc.stdout.readString();
    if (!s) break;
    out += s;
  }
  const { exitCode } = await proc.wait();
  check("the installed ffmpeg runs", exitCode === 0 && /ffmpeg version/.test(out), [exitCode, out.slice(0, 80)]);
  await waitFor(() => $("vd-ff-get-row").hidden, { what: "the row to step aside" });
  await sleep(300);
  check("with ffmpeg found the download row is gone and the page says where it is", $("vd-ff-get-row").hidden && document.querySelector(".vs-path")?.textContent.includes(exe), document.querySelector(".vs-path")?.textContent);
  await spike.capture("ffmpeg-2-installed");

  // ---- 2. a fingerprint that does not match ----
  const badDir = PathUtils.join(root, "install-bad");
  Services.prefs.setStringPref("vitre.ffmpeg.installDir", badDir);
  Services.prefs.setStringPref("vitre.ffmpeg.source", base + "/bad/");
  b.sys("VitreSettings").set({ ffmpegPath: "" });
  await waitFor(() => !$("vd-ff-get-row").hidden, { what: "the row back" });
  const failed = await engine.installFfmpeg().then(() => null, (e) => e);
  const st = engine.ffmpegInstall();
  check("a mismatching fingerprint fails the install", failed && st.phase === "failed" && /fingerprint/.test(st.error), st);
  check("nothing is installed and the zip is removed", !(await IOUtils.exists(badDir)) && !(await IOUtils.exists(PathUtils.join(PathUtils.parent(badDir), "ffmpeg-download.zip"))));
  check("the setting stays empty", b.settings.ffmpegPath === "", b.settings.ffmpegPath);
  await sleep(300);
  check("the page says why and offers to try again", $("vd-ff-get").textContent === "Try again" && /fingerprint/.test($("vd-ff-get-status").textContent), $("vd-ff-get-status").textContent);
  await spike.capture("ffmpeg-3-failed");
});
