// VERIFY (claim 26): HLS against a REAL stream (the spike only used a local 12-segment fixture).
// The 240p rendition of the public mux.dev test stream: 64 .ts segments over HTTPS, about 20 MB.
/* global spike, ChromeUtils, Services, IOUtils, PathUtils, window, Ci */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { findFfmpeg, runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  await spike.resize(1100, 700);
  const dir = PathUtils.join(H.DATA, "downloads-hlsreal");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  const ff = await findFfmpeg();
  await VitreDownloads.init({ dir, connections: 6 });
  Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
  window.vitreOverlay.setNote("real HLS stream");
  const url = Services.env.get("VITRE_V_HLS") || "https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8";
  const t0 = Date.now();
  const id = VitreDownloads.start(url, { title: "Real stream test", mode: "hls" });
  let shot = false;
  for (;;) {
    const v = VitreDownloads.list()[0];
    if (!shot && v.received > 3 * 1048576) {
      shot = true;
      await spike.capture("hlsreal-1-downloading");
    }
    if (!["starting", "queued", "downloading"].includes(v.state)) break;
    await spike.sleep(100);
  }
  const v = await VitreDownloads.whenSettled(id);
  const rec = VitreDownloads.find(id);
  const track = rec.hls?.tracks?.[0];
  spike.log(`state ${v.state}${v.error ? " (" + v.error + ")" : ""}; ${track?.done}/${track?.count} segments; file ${v.filename} ${v.total} bytes; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let info = null;
  if (ff && v.state === "completed") {
    const r = await runTool(ff, ["-hide_banner", "-i", v.path]);
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
    info = {
      seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
      format: /Input #0, ([^\s]+?), from/.exec(r.stderr)?.[1] ?? "",
      video: /Video: (\w+)[^\n]*?(\d{3,4}x\d{3,4})/.exec(r.stderr)?.slice(1).join(" ") ?? "",
      audio: /Audio: (\w+)/.exec(r.stderr)?.[1] ?? "",
    };
    // Decode the whole file to null: any corrupt or misplaced segment shows up as decode errors.
    const dec = await runTool(ff, ["-hide_banner", "-v", "error", "-i", v.path, "-map", "0:v:0", "-f", "null", "-"]);
    info.decodeErrors = dec.stderr.trim().split(/\r?\n/).filter(Boolean).length;
    info.decodeExit = dec.exitCode;
  }
  check("a real HLS stream is downloaded, joined in order and repackaged to MP4", v.state === "completed" && !!info && Math.abs(info.seconds - 634) < 8 && /h264/.test(info.video) && info.decodeErrors === 0, JSON.stringify(info));
  await spike.capture("hlsreal-2-done");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
