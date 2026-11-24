// macOS, against the real world (on demand, not in a default set; about 125 MB from the internet):
// Download ffmpeg and Download yt-dlp get the real macOS builds (Martin Riedl's ffmpeg, yt-dlp's onedir
// yt-dlp_macos.zip, Deno for this Mac's processor), checked against their published SHA-256, into this
// run's throwaway data root (tools/run.py's vitre.localAppData). Then:
//   - files, modes and no quarantine on anything Deer installed;
//   - Deer's own runner starts yt-dlp and Deno (ytdlpVersion: yt-dlp --version through run(), deno
//     --version), timed: macOS's first-run check of new code happened during the install;
//   - the installed ffmpeg answers -version, is the one the engine uses (the setting) and is built for
//     the engine's processor (its Mach-O CPU type), as Deno is (deno --version);
//   - a real YouTube video ("Me at the zoo", 19 s) is downloaded through the picker with the installed
//     yt-dlp and Deno, picture and sound joined by the installed ffmpeg (yt-dlp --ffmpeg-location), and
//     the saved file holds both; while it runs the installed yt-dlp is marked in the tools folder
//     (.yt-dlp-running-<pid>, whose process ps names as that yt-dlp_macos), and no mark is left after.
// PATH without Homebrew, so no tool of the machine's own stands in:
//   python3 -u tools/run.py --test tests/downloads/mac-tools-real.js --name dl-mac-tools-real --url about:blank --timeout 900 --no-capture --env PATH=/usr/bin:/bin:/usr/sbin:/sbin
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
  const engine = b.sys("VitreDownloads");
  await engine.ready;
  const QUAR = "com.apple.quarantine";
  const root = Services.prefs.getStringPref("vitre.localAppData", "");
  const deer = PathUtils.join(root, "Deer");
  for (const p of ["vitre.ffmpeg.source", "vitre.ffmpeg.installDir", "vitre.tools.source.ytdlp", "vitre.tools.source.deno", "vitre.tools.installDir"]) Services.prefs.clearUserPref(p);
  b.sys("VitreSettings").set({ ffmpegPath: "" });
  log("engine " + Services.appinfo.XPCOMABI + ", data root " + root + ", PATH " + Services.env.get("PATH"));
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const mode = async (p) => (await IOUtils.stat(p)).permissions & 0o777;
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
  /** What under `p` (itself included) carries quarantine. */
  const quarantined = async (p) => {
    const bad = (await IOUtils.hasMacXAttr(p, QUAR)) ? ["."] : [];
    if ((await IOUtils.stat(p)).type === "directory") for (const r of await tree(p)) if (await IOUtils.hasMacXAttr(PathUtils.join(p, ...r.split("/")), QUAR)) bad.push(r);
    return bad;
  };
  const runOut = async (exe, args) => {
    const t0 = Date.now();
    const p = await Subprocess.call({ command: exe, arguments: args, stderr: "stdout" });
    let out = "";
    for (;;) {
      const s = await p.stdout.readString();
      if (!s) break;
      out += s;
    }
    return { code: (await p.wait()).exitCode, out, ms: Date.now() - t0 };
  };
  const before = await engine.ffmpeg();
  check("no ffmpeg of the machine's stands in (PATH without Homebrew)", !before.path, before);

  // ---- ffmpeg ----
  const ffPhases = [];
  let ffT = Date.now();
  const offFf = engine.onFfmpegInstall((s) => {
    if (ffPhases.length && ffPhases[ffPhases.length - 1].startsWith(s.phase + " ")) return;
    ffPhases.push(s.phase + " +" + (Date.now() - ffT) + "ms");
    ffT = Date.now();
  });
  const ffExe = await engine.installFfmpeg().catch((e) => log("ffmpeg install error " + e));
  offFf();
  const ff = engine.ffmpegInstall();
  log("ffmpeg phases " + ffPhases.join(" > ") + "; state " + JSON.stringify(ff));
  check("ffmpeg installed from Martin Riedl's macOS release build", ff.phase === "done" && ffExe === PathUtils.join(deer, "ffmpeg", "ffmpeg"), ff);
  if (ff.phase !== "done") return;
  check("its version is read from the release address", /^\d+\.\d+/.test(ff.version), ff.version);
  check("ffmpeg alone, mode 0755, nothing quarantined", JSON.stringify(await tree(PathUtils.join(deer, "ffmpeg"))) === '["ffmpeg"]' && (await mode(ffExe)) === 0o755 && (await quarantined(PathUtils.join(deer, "ffmpeg"))).length === 0, [await tree(PathUtils.join(deer, "ffmpeg")), (await mode(ffExe)).toString(8), await quarantined(PathUtils.join(deer, "ffmpeg"))]);
  const ffRun = await runOut(ffExe, ["-version"]);
  log("ffmpeg -version in " + ffRun.ms + " ms: " + ffRun.out.split("\n")[0]);
  check("the installed ffmpeg runs (-version)", ffRun.code === 0 && /^ffmpeg version/.test(ffRun.out), ffRun.out.slice(0, 200));
  const ffInfo = await engine.ffmpeg();
  check("the engine uses it (the setting points at it)", ffInfo.path === ffExe && ffInfo.source === "settings", ffInfo);
  // Its Mach-O header names the processor it was built for: CPU_TYPE_ARM64 0x0100000C, CPU_TYPE_X86_64
  // 0x01000007 (a universal file lists each in its fat header).
  const head = await IOUtils.read(ffExe, { maxBytes: 4096 });
  const le32 = (o) => (head[o] | (head[o + 1] << 8) | (head[o + 2] << 16) | (head[o + 3] << 24)) >>> 0;
  const be32 = (o) => ((head[o] << 24) | (head[o + 1] << 16) | (head[o + 2] << 8) | head[o + 3]) >>> 0;
  const cpus = [];
  if (le32(0) === 0xfeedfacf) cpus.push(le32(4));
  else if (be32(0) === 0xcafebabe) for (let i = 0, n = be32(4); i < n && 8 + 20 * i + 4 <= head.length; i++) cpus.push(be32(8 + 20 * i));
  const cpuWant = /^aarch64/.test(Services.appinfo.XPCOMABI) ? 0x0100000c : 0x01000007;
  check("ffmpeg is the build for this engine's processor (" + Services.appinfo.XPCOMABI + ")", cpus.includes(cpuWant), cpus.map((c) => "0x" + c.toString(16)));

  // ---- yt-dlp and Deno ----
  const ytPhases = [];
  let ytT = Date.now();
  const offYt = engine.onYtdlpInstall((s) => {
    const k = s.phase + (s.tool ? ":" + s.tool : "");
    if (ytPhases.length && ytPhases[ytPhases.length - 1].startsWith(k + " ")) return;
    ytPhases.push(k + " +" + (Date.now() - ytT) + "ms");
    ytT = Date.now();
  });
  const t0 = Date.now();
  await engine.installYtdlp(false).catch((e) => log("yt-dlp install error " + e));
  offYt();
  log("yt-dlp phases " + ytPhases.join(" > ") + " in " + (Date.now() - t0) + " ms; state " + JSON.stringify(engine.ytdlpInstall()));
  check("yt-dlp and Deno installed from their GitHub releases", engine.ytdlpInstall().phase === "done" && engine.hasYtdlp(), engine.ytdlpInstall());
  if (!engine.hasYtdlp()) return;
  const tools = PathUtils.join(deer, "tools");
  const ytHome = PathUtils.join(tools, "yt-dlp");
  const ytExe = PathUtils.join(ytHome, "yt-dlp_macos");
  const deno = PathUtils.join(tools, "deno");
  const top = (await IOUtils.getChildren(tools)).map((p) => PathUtils.filename(p)).sort();
  const files = await tree(ytHome);
  log("tools folder " + JSON.stringify(top) + ", yt-dlp folder " + files.length + " entries");
  check("the tools folder holds the onedir yt-dlp and deno, nothing left over", JSON.stringify(top) === '["deno","yt-dlp"]' && files.includes("yt-dlp_macos") && files.includes("_internal/Python"), top);
  check("yt-dlp_macos and deno are mode 0755", (await mode(ytExe)) === 0o755 && (await mode(deno)) === 0o755, [(await mode(ytExe)).toString(8), (await mode(deno)).toString(8)]);
  const qYt = await quarantined(ytHome);
  const qDeno = await quarantined(deno);
  check("nothing of yt-dlp (" + files.length + " entries) or Deno carries quarantine", qYt.length === 0 && qDeno.length === 0, { qYt: qYt.slice(0, 5), qDeno });
  const v0 = Date.now();
  const version = await engine.ytdlpVersion();
  const vMs = Date.now() - v0;
  log("ytdlpVersion " + JSON.stringify(version) + " in " + vMs + " ms");
  check("Deer's own runner starts yt-dlp and Deno: their versions are read", /^yt-dlp \d{4}\.\d{2}\.\d{2}\S* · Deno \d+\.\d+/.test(version), version);
  check("the first start after the install is quick (macOS's first-run check happened during the install)", vMs < 8000, vMs);
  const denoArch = (await runOut(deno, ["--version"])).out;
  check("Deno is this engine's processor's build", (/^aarch64/.test(Services.appinfo.XPCOMABI) ? /aarch64-apple-darwin/ : /x86_64-apple-darwin/).test(denoArch), denoArch.split("\n")[0]);

  // ---- a real video, joined by the installed ffmpeg ----
  const dlDir = PathUtils.join(PathUtils.profileDir, "mac-tools-real-downloads");
  await IOUtils.makeDirectory(dlDir, { ignoreExisting: true });
  b.sys("VitreSettings").set({ downloadsFolder: dlDir, askWhereToSave: false });
  const ui = window.vitreDownloads;
  // While Deer's runner runs the installed yt-dlp it is marked in the tools folder, and the mark's process is
  // that yt-dlp (what another Deer sharing the folder waits for before an update replaces it).
  let watching = true;
  let seenMark = null;
  const markWatch = (async () => {
    for (const until = Date.now() + 600000; watching && !seenMark && Date.now() < until; ) {
      for (const p of await IOUtils.getChildren(tools).catch(() => [])) {
        const m = /^\.yt-dlp-running-(\d+)$/.exec(PathUtils.filename(p));
        if (!m) continue;
        const ps = await runOut("/bin/ps", ["-p", m[1], "-o", "comm="]);
        if (ps.code === 0) seenMark = { pid: m[1], comm: ps.out.trim(), program: await IOUtils.readUTF8(p).catch(() => "") };
        break;
      }
      await sleep(150);
    }
  })();
  const t = b.active();
  b.navigate(t.id, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await waitFor(() => !t.loading && /watch/.test(t.browser.currentURI.spec), { timeout: 45000, what: "YouTube" });
  await sleep(3000);
  const mark = b.bar.downloadMark();
  if (mark) spike.click(mark);
  else void ui.video.downloadVideo(false);
  const a0 = Date.now();
  await waitFor(() => ui.video.picker.isOpen || (b.root.querySelector(".vd-note") && !/Finding/.test(b.root.querySelector(".vd-note").textContent)), { timeout: 120000, what: "an answer" });
  log("picker answer in " + (Date.now() - a0) + " ms");
  check("the picker offers the real video's qualities (yt-dlp -J with Deno)", ui.video.picker.isOpen, b.root.querySelector(".vd-note")?.textContent ?? "");
  if (!ui.video.picker.isOpen) return;
  const pick = ui.video.picker.element;
  log("rows " + JSON.stringify([...pick.querySelectorAll(".vd-opt")].map((r) => r.textContent.replace(/\s+/g, " ").trim())));
  const before2 = engine.list(false).length;
  spike.click(pick.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).length > before2 && engine.list(false)[0], { timeout: 15000, what: "the download" });
  const rec = engine.recs.find((r) => r.id === dl.id);
  log("format " + (rec?.ytdlp?.format ?? "") + " ext " + (rec?.ytdlp?.ext ?? ""));
  const done = await waitFor(
    () => {
      const v = engine.get(dl.id);
      return v && ["completed", "failed", "canceled", "cancelled"].includes(v.state) && v;
    },
    { timeout: 300000, interval: 500, what: "the video" }
  );
  log("download " + JSON.stringify({ state: done.state, file: done.filename, received: done.received, error: done.error }));
  watching = false;
  await markWatch;
  check("the yt-dlp Deer ran was marked in the tools folder, and that mark's process is the installed yt-dlp", !!seenMark && seenMark.program === ytExe && seenMark.comm.endsWith("/yt-dlp_macos"), seenMark);
  await sleep(500);
  check("no mark is left once it has ended", !(await IOUtils.getChildren(tools)).some((p) => /^\.yt-dlp-running-/.test(PathUtils.filename(p))), (await IOUtils.getChildren(tools)).map((p) => PathUtils.filename(p)));
  check("the real video downloads with the installed yt-dlp and Deno", done.state === "completed" && (await IOUtils.exists(done.path)) && (await IOUtils.stat(done.path)).size > 100000, done.error);
  if (done.state !== "completed") return;
  const joined = (rec?.ytdlp?.format ?? "").includes("+");
  const probe = await runOut(ffExe, ["-hide_banner", "-i", done.path]);
  const streams = probe.out.split("\n").filter((l) => /Stream #/.test(l));
  log("streams " + JSON.stringify(streams));
  check("picture and sound were two formats, joined into one file by the installed ffmpeg", joined && streams.some((l) => /Video:/.test(l)) && streams.some((l) => /Audio:/.test(l)), { format: rec?.ytdlp?.format, streams });
  check("nothing yt-dlp kept is left beside the video", (await IOUtils.getChildren(dlDir)).length === 1, (await IOUtils.getChildren(dlDir)).map((p) => PathUtils.filename(p)));
  await IOUtils.remove(dlDir, { recursive: true, ignoreAbsent: true });
});
