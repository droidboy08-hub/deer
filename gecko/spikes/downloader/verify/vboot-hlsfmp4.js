// VERIFY (claim 28, reported unverified): HLS with fMP4 segments (EXT-X-MAP init segment,
// EXT-X-BYTERANGE into one file) and a SEPARATE audio rendition merged by ffmpeg.
// Apple's public "bipbop advanced fMP4" example: the 480x270 video rendition (27.7 MB) plus the
// AAC audio rendition (12.1 MB), chosen explicitly so the test stays small.
/* global spike, ChromeUtils, Services, IOUtils, PathUtils, window */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { findFfmpeg, runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  await spike.resize(1100, 700);
  const dir = PathUtils.join(H.DATA, "downloads-hlsfmp4");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  const ff = await findFfmpeg();
  await VitreDownloads.init({ dir, connections: 6 });
  Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
  window.vitreOverlay.setNote("real fMP4 HLS + separate audio");
  const base = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/";
  const t0 = Date.now();
  const id = VitreDownloads.start(base + "master.m3u8", { title: "bipbop fmp4", mode: "hls", variantUrl: base + "v2/prog_index.m3u8", audioUrl: base + "a1/prog_index.m3u8" });
  let shot = false;
  for (;;) {
    const v = VitreDownloads.list()[0];
    if (!shot && v.received > 6 * 1048576) {
      shot = true;
      await spike.capture("hlsfmp4-1-downloading");
    }
    if (!["starting", "queued", "downloading"].includes(v.state)) break;
    await spike.sleep(100);
  }
  const v = await VitreDownloads.whenSettled(id);
  const rec = VitreDownloads.find(id);
  spike.log(`state ${v.state}${v.error ? " (" + v.error + ")" : ""}; tracks ${JSON.stringify((rec.hls?.tracks ?? []).map((t) => ({ url: t.url.replace(base, ""), done: t.done, count: t.count, bytes: t.bytes, container: t.container })))}; file ${v.filename} ${v.total} bytes; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let info = null;
  if (ff && v.state === "completed") {
    const r = await runTool(ff, ["-hide_banner", "-i", v.path]);
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
    info = {
      seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
      video: /Video: (\w+)[^\n]*?(\d{3,4}x\d{3,4})/.exec(r.stderr)?.slice(1).join(" ") ?? "",
      audio: /Audio: (\w+)/.exec(r.stderr)?.[1] ?? "",
    };
    const dec = await runTool(ff, ["-hide_banner", "-v", "error", "-i", v.path, "-f", "null", "-"]);
    info.decodeErrors = dec.stderr.trim().split(/\r?\n/).filter(Boolean).length;
  }
  check("fMP4 HLS (init segment + byte ranges) with a separate audio rendition becomes one playable MP4", v.state === "completed" && !!info && Math.abs(info.seconds - 600) < 8 && /h264/.test(info.video) && info.audio === "aac" && info.decodeErrors === 0, JSON.stringify(info));
  await spike.capture("hlsfmp4-2-done");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
