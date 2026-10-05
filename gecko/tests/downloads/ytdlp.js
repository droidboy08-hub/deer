// yt-dlp for sites whose pages have nothing downloadable (YouTube), with a stand-in yt-dlp
// (tests/downloads/fake_ytdlp.py; nothing is fetched from YouTube's video servers):
//   1. without yt-dlp: the mark shows on a YouTube video page; a click says yt-dlp is needed and
//      its button opens Settings › Video downloads;
//   2. with yt-dlp: a click asks yt-dlp (-J), the picker under the tab pill offers its qualities
//      (H.264 MP4 preferred, audio alone), and Download runs yt-dlp with the chosen format into the
//      downloads folder, with progress in the panel, ending completed;
//   3. a page yt-dlp fails on says why;
//   4. a page whose own streams cannot be read falls back to yt-dlp.
/* global spike, Services, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, waitFor, sleep, log } = spike;
  await DL.init();
  await spike.resize(1280, 860);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const engine = DL.engine;
  const mark = () => b.bar.downloadMark();
  const note = () => b.root.querySelector(".vd-note");
  // YouTube rewrites its addresses as it loads: wait for the page, not for the exact address.
  const openSite = async (url) => {
    const t = b.active();
    b.navigate(t.id, url);
    await waitFor(() => !t.loading && /youtube\.com/.test(t.browser.currentURI.host) && /watch/.test(t.browser.currentURI.spec), { timeout: 30000, what: "load of " + url });
    await sleep(2500);
  };
  const fakeLog = PathUtils.join(PathUtils.tempDir, "vitre-fake-ytdlp.log");
  await IOUtils.remove(fakeLog, { ignoreAbsent: true });
  Services.prefs.setStringPref("vitre.tools.installDir", PathUtils.join(PathUtils.tempDir, "vitre-no-tools-here"));

  // ---- 1. no yt-dlp ----
  await openSite("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the mark on a YouTube video page" });
  check("the mark shows on a YouTube video page", !mark().classList.contains("empty"));
  check("yt-dlp is not installed", !engine.hasYtdlp());
  spike.click(mark());
  const n1 = await waitFor(() => note(), { timeout: 8000, what: "the note" });
  check("a click says yt-dlp is needed", /needs yt-dlp/.test(n1.textContent), n1.textContent);
  await spike.capture("ytdlp-1-needed");
  spike.click(n1.querySelector(".vd-note-act"));
  await waitFor(() => document.getElementById("vd-yt-row"), { timeout: 5000, what: "Settings › Video downloads" });
  check("its button opens Settings › Video downloads", !!document.getElementById("vd-yt-row"), document.getElementById("vd-yt-status")?.textContent);
  check("the page says yt-dlp is not installed", /Not installed/.test(document.getElementById("vd-yt-status").textContent));
  await spike.capture("ytdlp-2-settings");
  spike.press("Escape");
  await sleep(400);

  // ---- 2. with yt-dlp (the stand-in) ----
  const py = Services.env.get("VITRE_DL_PY");
  // ROOT\spikes\downloadererify\lock_region.py -> ROOT	ests\downloadsake_ytdlp.py
  const root = PathUtils.parent(Services.env.get("VITRE_DL_LOCK"), 4);
  const fake = PathUtils.join(root, "tests", "downloads", "fake_ytdlp.py");
  Services.prefs.setStringPref("vitre.tools.ytdlpCommand", JSON.stringify([py, fake]));
  check("with the stand-in, yt-dlp counts as installed", engine.hasYtdlp());
  check("its version is read", /^yt-dlp 2026\.08\.19/.test(await engine.ytdlpVersion()), await engine.ytdlpVersion());
  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 20000, what: "the picker" });
  await sleep(300);
  const pick = ui.video.picker.element;
  const rows = [...pick.querySelectorAll("[role=radio], [role=menuitemradio], .vd-opt")].map((r) => r.textContent.replace(/\s+/g, " ").trim());
  log("picker rows: " + JSON.stringify(rows));
  check("the picker offers yt-dlp's qualities", rows.some((r) => /1080p/.test(r)) && rows.some((r) => /720p/.test(r)) && rows.some((r) => /M4A/.test(r)), rows);
  const pr = pick.getBoundingClientRect();
  const pill = b.bar.layout.pillRect;
  check("it hangs under the tab pill", pr.top >= pill.bottom - 1, [pr.top, pill.bottom]);
  await spike.capture("ytdlp-3-picker");
  const before = engine.list(false).length;
  spike.click(pick.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).length > before && engine.list(false)[0], { timeout: 8000, what: "the download" });
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 30000 });
  check("the yt-dlp download completes", done.state === "completed", done.error);
  check("it is saved as an MP4 named after the video", /^A fake clip_ glass in motion\.mp4$|^A fake clip.*\.mp4$/.test(done.filename) && (await IOUtils.exists(done.path)), [done.filename, done.path]);
  const calls = (await IOUtils.readUTF8(fakeLog)).trim().split("\n").map((l) => JSON.parse(l));
  const dlCall = calls.find((c) => c.includes("-f"));
  log("yt-dlp download call: " + JSON.stringify(dlCall));
  check("yt-dlp was asked for H.264 1080p with M4A audio, joined to MP4", dlCall && dlCall[dlCall.indexOf("-f") + 1] === "137+140" && dlCall[dlCall.indexOf("--merge-output-format") + 1] === "mp4", dlCall);
  check("with Vitre's ffmpeg and no user config", dlCall.includes("--ffmpeg-location") && dlCall.includes("--no-config"), dlCall);
  check("the size reached the panel", done.received >= 3_000_000, done.received);
  await spike.capture("ytdlp-4-done");

  // ---- 3. a video yt-dlp cannot get ----
  await openSite("https://www.youtube.com/watch?v=unavailable0");
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the mark" });
  spike.click(mark());
  const n3 = await waitFor(() => note() && !/Finding/.test(note().textContent) && note(), { timeout: 20000, what: "the failure note" });
  check("a video yt-dlp cannot get says why", /Can’t save this video/.test(n3.textContent) && /unavailable/i.test(n3.textContent), n3.textContent);
  await spike.capture("ytdlp-5-unavailable");

  // ---- 4. another site whose streams cannot be read: yt-dlp is asked ----
  await DL.open(DL.base + "/video-bad.html", { settle: 1200 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the mark (local page)" });
  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 20000, what: "the picker (fallback)" });
  check("a page whose own streams fail falls back to yt-dlp", ui.video.picker.isOpen);
});
