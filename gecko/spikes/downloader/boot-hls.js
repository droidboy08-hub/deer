// Spikes 5 and 6: running ffmpeg with Subprocess.sys.mjs, and HLS (playlist -> segments fetched
// concurrently -> one file -> ffmpeg repackaging). Uses the ffmpeg.exe found on this machine
// (VITRE_DL_FFMPEG, set by go.py; nothing is downloaded).
/* global spike, ChromeUtils, Services, IOUtils, PathUtils, window */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { HlsTransfer, trackPart } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreHls.sys.mjs");
  const { findFfmpeg, runFfmpeg, runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  await spike.resize(1100, 700);
  const dir = PathUtils.join(H.DATA, "downloads-hls");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });

  // ---- 5. Subprocess ----
  spike.log("--- Subprocess");
  const cmd = await runTool("cmd.exe", ["/c", "echo out-line & echo err-line 1>&2 & exit /b 7"]);
  check("Subprocess runs a console program: stdout, stderr and the exit code come back", cmd.exitCode === 7 && cmd.stdout.trim() === "out-line" && cmd.stderr.trim() === "err-line", JSON.stringify({ exitCode: cmd.exitCode, stdout: cmd.stdout.trim(), stderr: cmd.stderr.trim(), pid: cmd.pid }));
  const ff = await findFfmpeg();
  spike.log("ffmpeg found at:", ff, "| Vitre would bundle it at:", PathUtils.join(Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.path, "ffmpeg", "ffmpeg.exe"));
  if (ff) {
    const version = await runTool(ff, ["-hide_banner", "-version"]);
    check("ffmpeg.exe runs under Subprocess", version.exitCode === 0 && version.stdout.startsWith("ffmpeg version"), version.stdout.split("\n")[0].trim());
    // Progress from stderr: an encode long enough to report several times.
    const ticks = [];
    const t0 = Date.now();
    const encoded = PathUtils.join(dir, "encode-test.mp4");
    await runFfmpeg(ff, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=duration=20:size=1280x720:rate=30", "-c:v", "libx264", "-preset", "medium", encoded], null, (p) => ticks.push({ at: Date.now() - t0, seconds: p.seconds }));
    check("ffmpeg progress is read from stderr while it runs", ticks.length >= 2 && ticks.at(-1).seconds >= 19.9, `${ticks.length} progress reports over ${Date.now() - t0} ms: ${ticks.map((t) => `${t.seconds.toFixed(1)}s@${t.at}ms`).slice(0, 8).join(", ")}${ticks.length > 8 ? ", ..." : ""}`);
    // Abort: the process is killed.
    const ac = new AbortController();
    const t1 = Date.now();
    setTimeout(() => ac.abort(), 700);
    const aborted = await runFfmpeg(ff, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=duration=600:size=1920x1080:rate=30", "-c:v", "libx264", "-preset", "slow", PathUtils.join(dir, "never.mp4")], ac.signal).then(() => "finished", (e) => e.name);
    check("aborting kills ffmpeg", aborted === "AbortError" && Date.now() - t1 < 3000, `rejected with ${aborted} after ${Date.now() - t1} ms`);
    const failed = await runFfmpeg(ff, ["-hide_banner", "-loglevel", "error", "-i", PathUtils.join(dir, "missing.ts"), "-c", "copy", PathUtils.join(dir, "x.mp4")]).then(() => "ok", (e) => String(e.message));
    check("a failing ffmpeg run reports its exit code and stderr", /exited with/.test(failed) && /No such file/i.test(failed), failed.slice(0, 160));
  }
  const describe = async (path) => {
    const r = await runTool(ff, ["-hide_banner", "-i", path]);
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
    return {
      seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
      format: /Input #0, ([^\s]+?), from/.exec(r.stderr)?.[1] ?? "",
      video: /Video: (\w+)[^\n]*?(\d{3,4}x\d{3,4})/.exec(r.stderr)?.slice(1).join(" ") ?? "",
      audio: /Audio: (\w+)/.exec(r.stderr)?.[1] ?? "",
    };
  };

  // ---- 6. HLS through the manager: master -> best rendition -> segments in parallel -> ffmpeg ----
  spike.log("--- HLS");
  await VitreDownloads.init({ dir, connections: 6 });
  Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
  window.vitreOverlay.setNote("HLS test");
  await H.serverReset();
  const id = VitreDownloads.start(`${H.BASE}/fx/hls/master.m3u8`, { title: "Test stream" });
  VitreDownloads.setLimit(id, 300);
  // Pause part-way, then resume: segments already written must not be fetched again.
  let v;
  for (;;) {
    v = VitreDownloads.list()[0];
    if (v.state !== "starting" && v.state !== "queued" && v.received > 450000) break;
    await spike.sleep(30);
  }
  await spike.capture("hls-1-downloading");
  VitreDownloads.pause(id);
  v = await VitreDownloads.whenSettled(id);
  const rec = VitreDownloads.find(id);
  const track = rec.hls.tracks[0];
  spike.log(`paused: state ${v.state}; rendition ${track.url.replace(H.BASE, "")}; ${track.done}/${track.count} segments written (${track.bytes} bytes, container ${track.container})`);
  const doneAtPause = track.done;
  await H.serverReset();
  VitreDownloads.setLimit(id, 0);
  VitreDownloads.resume(id);
  v = await VitreDownloads.whenSettled(id);
  const stats = await H.serverStats();
  const segs = stats.requests.filter((q) => /seg\d+\.ts/.test(q.path));
  check("HLS: master resolved to the best rendition, segments written in order, resumable", v.state === "completed" && segs.length === track.count - doneAtPause && doneAtPause > 0,
    `after the pause ${segs.length} of ${track.count} segments were fetched (${doneAtPause} were already on disk); server peak concurrency ${stats.peak}`);
  if (ff && v.state === "completed") {
    const info = await describe(v.path);
    check("HLS: the .ts stream was repackaged by ffmpeg into a playable MP4", /mov|mp4/.test(info.format) && Math.abs(info.seconds - 24) < 0.5 && /h264/.test(info.video) && info.audio === "aac", `${v.filename}: ${JSON.stringify(info)}, ${v.total} bytes`);
  }
  await spike.capture("hls-2-done");

  // ---- AES-128 encrypted rendition, no ffmpeg: the decrypted .ts itself is checked ----
  let net = 0;
  const transfer = new HlsTransfer(HlsTransfer.fresh(`${H.BASE}/fx/hls/v180/index.m3u8`), { identity: H.anon, limiters: [], connections: () => 6, onBytes: (n) => (net += n) });
  const signal = new AbortController().signal;
  await transfer.prepare(signal);
  const base = PathUtils.join(dir, "encrypted");
  await H.serverReset();
  await transfer.download(base, signal);
  const part = trackPart(base, transfer.state.tracks[0]);
  const bytes = await IOUtils.read(part);
  let sync = bytes.length % 188 === 0;
  for (let i = 0; i < bytes.length && sync; i += 188) sync = bytes[i] === 0x47;
  const keyReqs = (await H.serverStats()).requests.filter((q) => q.path.endsWith("enc.key")).length;
  const encInfo = ff ? await describe(part) : null;
  check("HLS AES-128: segments are decrypted with WebCrypto (every 188-byte packet starts with the TS sync byte)", sync && bytes.length > 1000000,
    `${bytes.length} bytes = ${bytes.length / 188} TS packets from ${net} encrypted bytes; key fetched ${keyReqs} time(s)${encInfo ? "; ffmpeg reads it as " + JSON.stringify(encInfo) : ""}`);

  // ---- DRM and live streams are refused ----
  const refuse = async (url) => new HlsTransfer(HlsTransfer.fresh(url), { identity: H.anon, limiters: [], connections: () => 4, onBytes() {} }).prepare(signal).then(() => "accepted", (e) => e.message);
  const drm = await refuse(`${H.BASE}/fx/hls/drm.m3u8`);
  check("HLS with a DRM key (Widevine session key) is refused", /protected/.test(drm), drm);
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
