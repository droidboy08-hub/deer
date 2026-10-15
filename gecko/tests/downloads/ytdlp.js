// yt-dlp for sites whose pages have nothing downloadable (YouTube), with a stand-in yt-dlp
// (tests/downloads/fake_ytdlp.py; nothing is fetched from YouTube's video servers):
//   1. without yt-dlp: the mark shows on a YouTube video page; a click says yt-dlp is needed and
//      its button opens Settings › Video downloads;
//   2. with yt-dlp: a click asks yt-dlp (-J), the picker under the tab pill offers its qualities
//      (H.264 MP4 preferred, audio alone), and Download runs yt-dlp with the chosen format into the
//      downloads folder, with progress in the panel, ending completed; the row recorded the chosen
//      formats the picker's yt-dlp run reported (Phase 8, RESUME-DESIGN.md 5.4);
//   3. a page yt-dlp fails on says why;
//   4. a page whose own streams cannot be read falls back to yt-dlp.
// Phase 8 of spikes/downloader/RESUME-DESIGN.md (section 7; 2.7, 5.4, G1 step 2), on pages of the local server only
// (the stand-in is steered per page through "<its log>.ctl.json": tests/downloads/fake_ytdlp.py):
//   - picker: a page that falls back to yt-dlp: the download from its picker records the chosen formats (5.4) and its
//     first run asks yt-dlp nothing more;
//   - same: an unchanged resume asks yt-dlp again (-J) and continues the same format with --continue, from its
//     saved part;
//   - small: a format that is gone, with under 1 MiB of it saved, is re-picked by its height, ext and kind (then the
//     nearest bitrate) and started over by itself; its old part waits aside and is removed once the new file is done;
//   - big: the same with more than 1 MiB saved asks (File changed, "this quality is no longer offered", no Keep
//     partial), its part untouched; Start over keeps it as "<name>.old.part" until the new file is complete;
//   - size: another filesize for the same format is File changed with the old part kept; Resume checks again and still
//     asks; Start over gets the new bytes, nothing mixed;
//   - single: one format saved as the file itself ("<name>.part") whose size changed with under 1 MiB saved starts over
//     by itself, its part set aside, never continued;
//   - expired: a download yt-dlp is refused (HTTP Error 403) with saved parts is Link expired with its next try
//     planned; Retry asks yt-dlp again; an attempt of the schedule (Renewing link) asks it again and the row
//     continues, its run reading what that attempt heard;
//   - pill: the pill's Continue (G2 manual fallback) never crosses containers; for the same quality under another
//     format id it resumes and the run's check asks; another quality makes the row File changed ("1080p is no longer
//     offered"), and Start over gets it, the sound it shares continuing and the old picture's part kept aside until done;
//   - pagefile: a page media file whose signed address expired is renewed from yt-dlp's https format of its page with
//     the file's filesize (G1 step 2), before the page step (its page never loads); other formats are never asked;
//   - order: when yt-dlp's formats give nothing, the page step comes after it and renews the file;
//   - skip: a private page media file and a file that is not media never run yt-dlp; the control: a page media file
//     its original address renews never runs it either;
//   - cookies: no call to yt-dlp ever carried cookie options (ytdlp.ts header, the owner's decision 14).
// From the review of Phase 8:
//   - approx: a format yt-dlp only estimates (filesize_approx, as YouTube's HLS formats) whose estimate and bitrate
//     changed is File changed with its part untouched, never continued into; back to the same estimate and bitrate,
//     Resume continues it with --continue; another length (more than 1 s) is File changed too; a format with nothing
//     to compare (no size, estimate or bitrate) asks above 1 MiB saved ("Deer can't confirm it is the same file": R7);
//   - dup: a resume whose own check yt-dlp refuses (HTTP Error 403) is Link expired after one -J: the check was the
//     attempt at the failure;
//   - sib: two rows of one video (MP4, and its sound alone as M4A): cancelling one removes only its own parts, and
//     the other then continues from its saved part;
//   - burst: five yt-dlp rows whose attempts fall due together run yt-dlp -J at most two at a time, and two rows of
//     one page share one -J;
//   - container: a WEBM row re-picked to an H.264 picture (the check's loose re-pick, and the pill's MP4 quality) is
//     saved as a file type that holds it (MKV, MP4), never asked to join H.264 into WEBM;
//   - kind: the pill's video quality for a sound row (and the sound for a video row) makes the row that kind of file;
//   - sound: a sound format that is gone, with nothing of it saved, is replaced by itself (an Opus sound joins an MP4
//     row); with under 1 MiB saved it starts over by itself saying "the sound"; with more it asks, naming the sound;
//   - fburst: three page media files of one page whose addresses expired together share one -J (G1 step 2);
//   - budget: a site's seventh yt-dlp look within the hour (G1 step 2) is not made; the page step renews the file.
// VITRE_DL_ONLY=a,b runs only those sections: youtube (1-4), picker, same, small, big, size, single, expired, pill,
// approx, dup, sib, burst, container, kind, sound, pagefile, order, skip, fburst, budget (cookies always runs).
/* global spike, Services, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, waitFor, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1280, 860);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const engine = DL.engine;
  const mark = () => b.bar.downloadMark();
  const note = () => b.root.querySelector(".vd-note");
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const rec = (id) => engine.recs.find((r) => r.id === id);
  // YouTube rewrites its addresses as it loads: wait for the page, not for the exact address.
  const openSite = async (url) => {
    const t = b.active();
    b.navigate(t.id, url);
    await waitFor(() => !t.loading && /youtube\.com/.test(t.browser.currentURI.host) && /watch/.test(t.browser.currentURI.spec), { timeout: 30000, what: "load of " + url });
    await sleep(2500);
  };
  // This run's own log (the runner gives each run one, so a concurrent run never removes it; fake_ytdlp.py).
  const fakeLog = Services.env.get("VITRE_FAKE_YTDLP_LOG") || PathUtils.join(PathUtils.tempDir, "vitre-fake-ytdlp.log");
  await IOUtils.remove(fakeLog, { ignoreAbsent: true });
  await IOUtils.remove(fakeLog + ".ctl.json", { ignoreAbsent: true });
  await IOUtils.remove(fakeLog + ".events", { ignoreAbsent: true });
  Services.prefs.setStringPref("vitre.tools.installDir", PathUtils.join(PathUtils.tempDir, "vitre-no-tools-here"));
  const py = Services.env.get("VITRE_DL_PY");
  // ROOT\spikes\downloader\verify\lock_region.py -> ROOT\tests\downloads\fake_ytdlp.py
  const root = PathUtils.parent(Services.env.get("VITRE_DL_LOCK"), 4);
  const fake = PathUtils.join(root, "tests", "downloads", "fake_ytdlp.py");

  if (want("youtube")) {
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
    const asked = (await IOUtils.readUTF8(fakeLog)).trim().split("\n").length;
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
    // Phase 8 (5.4): the picker's formats, as yt-dlp reported them, reached the row; its first run asked nothing more.
    const chosen = rec(dl.id)?.ytdlp?.formats ?? [];
    check(
      "the row recorded the chosen formats at its start (height, fps, ext, audioOnly, filesize), and its first run asked yt-dlp nothing more",
      JSON.stringify(chosen.map((f) => [f.id, f.height, f.fps, f.ext, f.audioOnly, f.filesize])) === JSON.stringify([["137", 1080, 30, "mp4", false, 3000000], ["140", 0, 0, "m4a", true, 300000]]) && calls.length === asked + 1 && calls[asked] === dlCall,
      { chosen, since: calls.slice(asked) }
    );
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
    spike.press("Escape");
    await sleep(300);
  }

  // ---- Phase 8 (RESUME-DESIGN.md section 7; 2.7, 5.4, G1 step 2): local pages and the stand-in only ----
  Services.prefs.setStringPref("vitre.tools.ytdlpCommand", JSON.stringify([py, fake]));
  const MiB = 1 << 20;
  const medium = m["medium.bin"];
  const ctl = { pages: {} };
  /** Steers the stand-in for pages whose address contains `key` (fake_ytdlp.py's docstring). */
  const steer = async (key, spec) => {
    ctl.pages[key] = spec;
    await IOUtils.writeUTF8(fakeLog + ".ctl.json", JSON.stringify(ctl));
  };
  const lines = async (path) => {
    try {
      return (await IOUtils.readUTF8(path)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  const callsFor = async (key) => (await lines(fakeLog)).filter((c) => String(c[c.length - 1]).includes(key));
  const writes = async (key) => (await lines(fakeLog + ".events")).filter((e) => e.page.includes(key));
  const fmtArg = (c) => (c && c.includes("-f") ? c[c.indexOf("-f") + 1] : "");
  const argOf = (c, name) => (c && c.includes(name) ? c[c.indexOf(name) + 1] : "");
  const has = (c) => !!c && c !== "none";
  /** A format as the picker hands it to the download (ytdlp.ts formatOf(); the stand-in's -J says 19 s long). */
  const fmtOf = (f, duration = 19) => ({
    id: f.format_id, ext: f.ext, height: f.height || 0, fps: f.fps || 0, audioOnly: has(f.acodec) && !has(f.vcodec), video: has(f.vcodec), audio: has(f.acodec), filesize: f.filesize || 0, tbr: f.tbr || f.abr || 0,
    approx: f.filesize_approx || 0, duration, vcodec: has(f.vcodec) ? f.vcodec : "", acodec: has(f.acodec) ? f.acodec : "",
  });
  const V = (id, height, ext, tbr, size) => ({ format_id: id, ext, vcodec: ext === "webm" ? "vp9" : "avc1.640028", acodec: "none", height, fps: 30, tbr, filesize: size, protocol: "https" });
  const A = (id, ext, abr, size) => ({ format_id: id, ext, vcodec: "none", acodec: ext === "m4a" ? "mp4a.40.2" : "opus", abr, filesize: size, protocol: "https" });
  const MUX = (id, height, size) => ({ format_id: id, ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height, fps: 30, tbr: 500, filesize: size, protocol: "https" });
  const P8 = `${DL.base}/yt8`;
  const nameOf = (key) => `Phase 8 ${key}`;
  /** A yt-dlp download of the page P8/<key> as the picker starts one: its format and the formats' record. */
  const startYt = (key, format, list, { quality = "1080p", ext = "mp4", audioOnly = false } = {}) => {
    const chosen = format.split("+").map((id) => fmtOf(list.find((f) => f.format_id === id)));
    return engine.start(`${P8}/${key}`, {
      mode: "ytdlp",
      ytdlpFormat: format,
      ytdlpExt: ext,
      ytdlpFormats: chosen,
      audioOnly,
      quality,
      bytes: chosen.reduce((n, f) => n + f.filesize, 0),
      title: nameOf(key),
      videoKey: `ytdlp|${P8}/${key}`,
      pageUrl: `${P8}/${key}`,
    });
  };
  const settled = (id, what, test = null, timeout = 60000) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && v.phase !== "renewing" && ["paused", "failed", "completed", "cancelled"].includes(v.state) && (!test || test(v)) ? v : null;
      },
      { timeout, interval: 100, what }
    );
  const pauseAt = async (id, bytes, what) => {
    const v = await DL.until(id, ["downloading", "paused", "failed", "completed", "cancelled"], { test: (x) => x.state !== "downloading" || x.received > bytes, timeout: 30000, what });
    if (v.state === "downloading") engine.pause(id);
    return settled(id, what + " to pause");
  };
  /** The stand-in's bytes of formats [{id, size, ver}] one after the other, as it joins them: their SHA-256. */
  const shaOf = async (parts) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.size, 0));
    let at = 0;
    for (const p of parts) {
      const s = (7 * [...new TextEncoder().encode(p.id)].reduce((a, x) => a + x, 0) + 101 * (p.ver || 0)) & 255;
      for (let i = 0; i < p.size; i++) all[at + i] = (s + i) & 255;
      at += p.size;
    }
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", all))].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const filesOf = async (key) => (await DL.files()).filter((f) => f.startsWith(nameOf(key) + "."));
  const at = (name) => PathUtils.join(DL.dir, name);
  /** Every need kind each row showed (File changed must never show where the row starts over by itself). */
  const needs = new Map();
  engine.subscribe((e) => {
    if (e.kind !== "update") return;
    for (const v of e.views) if (v.need) needs.set(v.id, new Set([...(needs.get(v.id) ?? []), v.need.kind]));
  });
  /** The downloads folder's names while `id` runs, until it settles (an old part kept aside while the new file downloads). */
  const watchFiles = (key) => {
    const seen = new Set();
    let on = true;
    (async () => {
      while (on) {
        for (const f of await filesOf(key)) seen.add(f);
        await sleep(60);
      }
    })();
    return () => {
      on = false;
      return [...seen];
    };
  };

  // ---- picker: the picker's formats reach the row (5.4), on a local page that falls back to yt-dlp ----
  if (want("picker")) {
    await DL.open(DL.base + "/video-bad.html", { settle: 1200 });
    await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the mark (local page)" });
    spike.click(mark());
    await waitFor(() => ui.video.picker.isOpen, { timeout: 20000, what: "the picker (yt-dlp)" });
    await sleep(300);
    const before = engine.list(false).length;
    const asked = (await lines(fakeLog)).length;
    spike.click(ui.video.picker.element.querySelector(".vd-go"));
    const dl = await waitFor(() => engine.list(false).length > before && engine.list(false)[0], { timeout: 8000, what: "the download" });
    const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 30000 });
    const calls = (await lines(fakeLog)).slice(asked);
    const chosen = rec(dl.id)?.ytdlp?.formats ?? [];
    log("picker", { state: done.state, chosen, calls });
    check(
      "picker: the row recorded the chosen formats as the picker's yt-dlp run reported them (5.4), and its first run asked yt-dlp nothing more",
      done.state === "completed" && calls.length === 1 && fmtArg(calls[0]) === chosen.map((f) => f.id).join("+") && chosen.length === 2 && chosen[0].height > 0 && chosen[0].filesize > 0 && !chosen[0].audioOnly && chosen[1].audioOnly && chosen[1].filesize === 300000,
      { chosen, calls }
    );
    engine.remove(dl.id);
  }

  // ---- same: an unchanged resume continues the same format with --continue ----
  if (want("same")) {
    const key = "p8-same";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    const p = await pauseAt(id, 1_200_000, "same");
    const parts = await filesOf(key);
    const before = (await callsFor(key)).length;
    check("same: the first run asked yt-dlp nothing (the picker's record), and the pause left the video format's part under yt-dlp's name", before === 1 && p.state === "paused" && parts.includes(`${nameOf(key)}.f137.mp4.part`), { before, state: p.state, parts });
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "same to complete" });
    const after = (await callsFor(key)).slice(before);
    const from = (await writes(key)).filter((e) => e.id === "137").map((e) => e.from);
    log("same", { state: d.state, error: d.error, after, from, saved: p.received });
    check("same: the resume asked yt-dlp again (-J) before it continued", after.length === 2 && after[0].includes("-J") && after[1].includes("-f"), after);
    check("same: the same format id with the same filesize continued with --continue and the same format", fmtArg(after[1]) === "137+140" && after[1].includes("--continue"), after[1]);
    check("same: the video's part was continued from its saved bytes, not started again", from.length === 2 && from[0] === 0 && from[1] > 0 && from[1] >= p.received - 200_000, { from, saved: p.received });
    check("same: completed, the formats' bytes in order (nothing mixed, nothing asked)", d.state === "completed" && (await DL.sha256(d.path)) === (await shaOf([{ id: "137", size: 3_000_000 }, { id: "140", size: 300_000 }])) && !needs.has(id), [d.state, d.error]);
    check("same: no part is left behind", (await filesOf(key)).length === 1, await filesOf(key));
  }

  // ---- small: a gone format, under 1 MiB of it saved: re-picked and started over by itself ----
  if (want("small")) {
    const key = "p8-small";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    const p = await pauseAt(id, 200_000, "small");
    const old = at(`${nameOf(key)}.f137.mp4.part`);
    const size0 = (await IOUtils.stat(old)).size;
    // 137 is gone: 399 is the same height and ext at the nearest bitrate; 400 (1080p WEBM) and 398 (720p MP4, a nearer
    // bitrate) are other qualities.
    const now = [V("399", 1080, "mp4", 3900, 2_900_000), V("400", 1080, "webm", 4000, 2_800_000), V("398", 720, "mp4", 3950, 1_600_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: now, rate: 1_000_000 });
    const before = (await callsFor(key)).length;
    const stop = watchFiles(key);
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "small to complete" });
    const seen = stop();
    const after = (await callsFor(key)).slice(before);
    log("small", { saved: size0, state: d.state, error: d.error, after: after.map(fmtArg), seen, events: rec(id).events });
    check("small: under 1 MiB of the gone format was saved", p.state === "paused" && size0 > 0 && size0 <= MiB, size0);
    check("small: the gone format was re-picked by its height, ext and kind, then the nearest bitrate (399, not 400 or 398); the sound kept", fmtArg(after.find((c) => c.includes("-f"))) === "399+140", after);
    check("small: it started over by itself, never asking (the owner's decision 1)", d.state === "completed" && !needs.has(id) && (rec(id).events ?? []).some((e) => /^Started the picture over/.test(e.text)), { state: d.state, events: rec(id).events });
    check("small: the new file is the new format's bytes and the sound's, nothing of the old part", (await DL.sha256(d.path)) === (await shaOf([{ id: "399", size: 2_900_000 }, { id: "140", size: 300_000 }])));
    check("small: the old format's part waited aside while the new one downloaded and was removed once it succeeded", seen.includes(`${nameOf(key)}.f137.mp4.old.part`) && (await filesOf(key)).length === 1, { seen, now: await filesOf(key) });
  }

  // ---- big: a gone format with more than 1 MiB saved asks; Start over keeps the old part until the new file is done ----
  if (want("big")) {
    const key = "p8-big";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    await pauseAt(id, 1_500_000, "big");
    const old = at(`${nameOf(key)}.f137.mp4.part`);
    const size0 = (await IOUtils.stat(old)).size;
    const sha0 = await DL.sha256(old);
    await steer(key, { formats: [V("399", 1080, "mp4", 3900, 2_900_000), A("140", "m4a", 129, 300_000)], rate: 1_000_000 });
    const before = (await callsFor(key)).length;
    engine.resume(id);
    const v = await settled(id, "big to ask", (x) => x.state === "paused" && !!x.need);
    const after = (await callsFor(key)).slice(before);
    log("big", { saved: size0, need: v.need, keep: v.keep, after });
    check("big: more than 1 MiB of the gone format saved", size0 > MiB, size0);
    check("big: File changed, saying this quality is no longer offered", v.need?.kind === "choice" && /^this quality is no longer offered/.test(v.need.evidence), v.need);
    check("big: no Keep partial for a yt-dlp row, and its part untouched with nothing downloaded", v.keep === null && after.length === 1 && after[0].includes("-J") && (await DL.sha256(old)) === sha0, { keep: v.keep, after });
    const stop = watchFiles(key);
    await engine.decide(id, "start-over");
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "big to complete" });
    const seen = stop();
    const again = (await callsFor(key)).slice(before + 1);
    log("big after Start over", { state: d.state, error: d.error, again: again.map((c) => (c.includes("-J") ? "-J" : fmtArg(c))), seen });
    check("big: Start over asked for the re-picked format, needing no new lookup", again.length === 1 && fmtArg(again[0]) === "399+140", again);
    check("big: the old part was kept as .old.part until the new file was complete, then removed", seen.includes(`${nameOf(key)}.f137.mp4.old.part`) && d.state === "completed" && (await filesOf(key)).length === 1, { seen, now: await filesOf(key) });
    check("big: the new file is the new format's bytes", (await DL.sha256(d.path)) === (await shaOf([{ id: "399", size: 2_900_000 }, { id: "140", size: 300_000 }])));
  }

  // ---- size: another filesize for the same format is File changed, the old part kept ----
  if (want("size")) {
    const key = "p8-size";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    await pauseAt(id, 1_500_000, "size");
    const old = at(`${nameOf(key)}.f137.mp4.part`);
    const sha0 = await DL.sha256(old);
    await steer(key, { formats: list, sizes: { 137: 2_500_000 }, ver: { 137: 1 }, rate: 1_000_000 });
    const before = (await callsFor(key)).length;
    engine.resume(id);
    const v = await settled(id, "size to ask", (x) => x.state === "paused" && !!x.need);
    check("size: another filesize for the same format is File changed, with what differed", v.need?.kind === "choice" && v.need.evidence === "was 3.1 MB, now 2.7 MB", v.need);
    check("size: the old part is kept untouched and nothing was downloaded", (await DL.sha256(old)) === sha0 && (await callsFor(key)).slice(before).every((c) => c.includes("-J")), await callsFor(key));
    // Resume on a changed row checks again and never starts over (3 G3).
    engine.resume(id);
    const v2 = await settled(id, "size to ask again", (x) => x.state === "paused" && !!x.need);
    check("size: Resume checks again and still asks, never starting over", v2.need?.kind === "choice" && (await DL.sha256(old)) === sha0 && (await callsFor(key)).slice(before).every((c) => c.includes("-J")), v2.need);
    const stop = watchFiles(key);
    await engine.decide(id, "start-over");
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "size to complete" });
    const seen = stop();
    log("size", { state: d.state, error: d.error, seen });
    check("size: Start over kept the old part as .old.part until the new file was complete", seen.includes(`${nameOf(key)}.f137.mp4.old.part`) && (await filesOf(key)).length === 1, seen);
    check("size: the new file is the new version's bytes, nothing of the old mixed in", d.state === "completed" && (await DL.sha256(d.path)) === (await shaOf([{ id: "137", size: 2_500_000, ver: 1 }, { id: "140", size: 300_000 }])), [d.state, d.error]);
  }

  // ---- single: one format saved as the file itself, changed with under 1 MiB saved ----
  if (want("single")) {
    const key = "p8-single";
    const list = [MUX("18", 360, 2_000_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "18", list, { quality: "360p" });
    await pauseAt(id, 200_000, "single");
    const parts = await filesOf(key);
    await steer(key, { formats: list, sizes: { 18: 1_800_000 }, ver: { 18: 1 }, rate: 1_000_000 });
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "single to complete" });
    const from = (await writes(key)).map((e) => e.from);
    log("single", { parts, state: d.state, error: d.error, from, events: rec(id).events });
    check("single: one format is saved through <name>.part", parts.includes(`${nameOf(key)}.mp4.part`), parts);
    check("single: its new version started from zero by itself (the old part set aside, never continued)", d.state === "completed" && !needs.has(id) && from.length === 2 && from[1] === 0 && (rec(id).events ?? []).some((e) => e.text === "Started over: the file on the site changed"), { from, events: rec(id).events });
    check("single: the file is the new version's bytes only, and nothing is left aside", (await DL.sha256(d.path)) === (await shaOf([{ id: "18", size: 1_800_000, ver: 1 }])) && (await filesOf(key)).length === 1, await filesOf(key));
  }

  // ---- expired: refused with saved parts is Link expired; Retry and the schedule ask yt-dlp again ----
  if (want("expired")) {
    const key = "p8-expired";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    const p = await pauseAt(id, 1_200_000, "expired");
    await steer(key, { formats: list, rate: 1_000_000, refuse: 403 });
    const t0 = Date.now();
    engine.resume(id);
    const v = await settled(id, "expired to be Link expired", (x) => x.state === "paused" && !!x.need);
    log("expired", { need: v.need, wait: v.wait, nextAt: v.nextAt - t0, received: v.received, saved: p.received });
    check("expired: a download yt-dlp is refused (HTTP Error 403) with saved parts is Link expired, its bytes kept", v.need?.kind === "address" && v.need.status === 403 && v.received >= p.received - 200_000 && v.wait?.for === "address", { need: v.need, wait: v.wait });
    check("expired: its run had just asked yt-dlp, so the next try is the schedule's (2 minutes)", v.nextAt - t0 > 100_000 && v.nextAt - t0 < 140_000, v.nextAt - t0);
    // Retry: its run asks yt-dlp again first.
    const before = (await callsFor(key)).length;
    engine.resume(id);
    const v2 = await settled(id, "expired again", (x) => x.state === "paused" && !!x.need);
    const retry = (await callsFor(key)).slice(before);
    check("expired: Retry asks yt-dlp again (-J) before the download, still refused: Link expired", v2.need?.kind === "address" && retry.length === 2 && retry[0].includes("-J") && retry[1].includes("-f"), retry);
    // The site lets it through again; an attempt of the schedule (Renewing link while yt-dlp answers) continues it.
    await steer(key, { formats: list, rate: 1_000_000, jdelay: 1.5 });
    const before2 = (await callsFor(key)).length;
    // What Retry's check heard a moment ago would stand in for the attempt's own -J (review of Phase 8: rows of one page
    // share an answer for a minute); this section watches the attempt ask.
    engine.forgetYtdlpAnswers?.();
    rec(id).wait = { ...rec(id).wait, nextAt: Date.now() };
    engine.armWaits();
    const renewing = await waitFor(() => engine.get(id)?.phase === "renewing", { timeout: 10000, what: "Renewing link" }).catch(() => false);
    const d = await DL.until(id, ["completed", "failed"], { timeout: 40000, what: "expired to complete" });
    const later = (await callsFor(key)).slice(before2);
    log("expired attempt", { renewing, state: d.state, error: d.error, later: later.map((c) => (c.includes("-J") ? "-J" : fmtArg(c))) });
    check("expired: the attempt of the schedule read as Renewing link while it asked yt-dlp again", renewing === true);
    check("expired: it continued the same format, its run reading what the attempt heard (one -J)", later.length === 2 && later[0].includes("-J") && fmtArg(later[1]) === "137+140" && later[1].includes("--continue"), later);
    check("expired: completed with the formats' bytes", d.state === "completed" && (await DL.sha256(d.path)) === (await shaOf([{ id: "137", size: 3_000_000 }, { id: "140", size: 300_000 }])), [d.state, d.error]);
  }

  // ---- pill: the pill's Continue on a yt-dlp row (RESUME-DESIGN.md G2 manual fallback; Phase 8) ----
  if (want("pill")) {
    const key = "p8-pill";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), V("136", 720, "mp4", 2000, 1_500_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    await pauseAt(id, 1_500_000, "pill");
    const old = at(`${nameOf(key)}.f137.mp4.part`);
    const sha0 = await DL.sha256(old);
    // The page's offer as the pill has it: 1080p is now format 399 (137 is gone), 720p is 136.
    const now = [V("399", 1080, "mp4", 3900, 2_900_000), V("136", 720, "mp4", 2000, 1_500_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: now, rate: 1_000_000 });
    const option = (fmt, label, height) => ({
      id: `y${height}`, group: "video", label, detail: "", container: "MP4", bytes: 0, height, url: `${P8}/${key}`, mode: "ytdlp", variantUrl: "", audioUrl: "", dashVideo: "", dashAudio: "", needsMux: true,
      ytdlpFormat: fmt, ytdlpExt: "mp4", ytdlpFormats: fmt.split("+").map((f) => fmtOf(now.find((x) => x.format_id === f))),
    });
    check("pill: another container's Continue is refused", engine.renewWith(id, option("399+140", "1080p", 1080), { identity: { userContextId: 1, isPrivate: false } }) === "busy" && engine.get(id).state === "paused");
    // The same quality under another format id: Continue resumes, and the run's check re-picks (more than 1 MiB saved: it asks).
    const r1 = engine.renewWith(id, option("399+140", "1080p", 1080), { identity: { userContextId: 0, isPrivate: false } });
    const v1 = await settled(id, "pill to ask", (x) => x.state === "paused" && !!x.need);
    check("pill: Continue with the same quality resumes, and the run's check asks about the format that is gone", r1 === "continued" && v1.need?.kind === "choice" && /^this quality is no longer offered/.test(v1.need.evidence) && (await DL.sha256(old)) === sha0, { r1, need: v1.need });
    // Another quality: File changed; Start over gets it, the sound it shares continuing.
    const r2 = engine.renewWith(id, option("136+140", "720p", 720), { identity: { userContextId: 0, isPrivate: false } });
    const v2 = engine.get(id);
    check("pill: picking another quality makes the row File changed (1080p is no longer offered)", r2 === "changed" && v2.need?.kind === "choice" && v2.need.evidence === "1080p is no longer offered", { r2, need: v2.need });
    const before = (await callsFor(key)).length;
    const stop = watchFiles(key);
    await engine.decide(id, "start-over");
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "pill to complete" });
    const seen = stop();
    const after = (await callsFor(key)).slice(before);
    log("pill", { state: d.state, error: d.error, after: after.map((c) => (c.includes("-J") ? "-J" : fmtArg(c))), seen, quality: d.quality });
    check("pill: Start over got the chosen quality (136+140), the old picture's part kept aside until it was complete, then removed", d.state === "completed" && fmtArg(after.find((c) => c.includes("-f"))) === "136+140" && seen.includes(`${nameOf(key)}.f137.mp4.old.part`) && (await filesOf(key)).length === 1 && d.quality === "720p", { after, seen });
    check("pill: the file is the 720p format's bytes and the sound's", (await DL.sha256(d.path)) === (await shaOf([{ id: "136", size: 1_500_000 }, { id: "140", size: 300_000 }])));
  }

  // ---- From the review of Phase 8 ----
  /** The page's option as the pill hands it to renewWith() (probe()'s VideoOption). */
  const ytOption = (key, now, fmt, label, height, ext, group = "video") => ({
    id: `y${height}`, group, label, detail: "", container: ext.toUpperCase(), bytes: 0, height, url: `${P8}/${key}`, mode: "ytdlp", variantUrl: "", audioUrl: "", dashVideo: "", dashAudio: "", needsMux: fmt.includes("+"),
    ytdlpFormat: fmt, ytdlpExt: ext, ytdlpFormats: fmt.split("+").map((f) => fmtOf(now.find((x) => x.format_id === f))),
  });
  const asks = (x) => x.state !== "paused" || !!x.need;
  const shown = (c) => (c.includes("-J") ? "-J" : fmtArg(c));
  /** A file's SHA-256, "missing" when it is not there (a section goes on to say what else is wrong). */
  const sha = async (p) => {
    try {
      return await DL.sha256(p);
    } catch {
      return "missing";
    }
  };

  // ---- approx: formats yt-dlp only estimates (finding 1; RESUME-DESIGN.md 2.7, R7) ----
  if (want("approx")) {
    const key = "p8-approx";
    // YouTube's HLS formats as the real run saw format 230: an estimate (filesize_approx) and a bitrate, no exact size.
    const H = (tbr, approx) => ({ format_id: "230", ext: "mp4", vcodec: "avc1.4d400d", acodec: "none", height: 240, fps: 15, tbr, filesize_approx: approx, protocol: "m3u8_native", _bytes: 2_400_000 });
    const list = [H(800, 1_900_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "230+140", list, { quality: "240p" });
    await pauseAt(id, 1_300_000, "approx");
    const old = at(`${nameOf(key)}.f230.mp4.part`);
    const size0 = (await IOUtils.stat(old)).size;
    const sha0 = await sha(old);
    // Encoded again: another estimate and bitrate, other bytes.
    await steer(key, { formats: [H(950, 2_250_000), A("140", "m4a", 129, 300_000)], ver: { 230: 1 }, rate: 1_000_000 });
    const before = (await callsFor(key)).length;
    engine.resume(id);
    const v = await settled(id, "approx to ask", asks);
    const after = (await callsFor(key)).slice(before);
    log("approx", { saved: size0, state: v.state, need: v.need, after: after.map(shown) });
    check("approx: more than 1 MiB of a format yt-dlp only estimates was saved", size0 > MiB, size0);
    check("approx: another estimate and bitrate for the same format is File changed, saying what differed", v.need?.kind === "choice" && v.need.evidence === "was about 1.8 MB, now about 2.1 MB", { state: v.state, need: v.need });
    check("approx: its part is untouched and nothing was downloaded into it", (await sha(old)) === sha0 && after.length === 1 && after[0].includes("-J"), after.map(shown));
    // The site has the first encode again: Resume checks again and continues it.
    await steer(key, { formats: list, rate: 1_000_000 });
    const before2 = (await callsFor(key)).length;
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "approx to complete" });
    const later = (await callsFor(key)).slice(before2);
    const from = (await writes(key)).filter((e) => e.id === "230").map((e) => e.from);
    log("approx again", { state: d.state, error: d.error, need: d.need, later: later.map(shown), from });
    const last = later[later.length - 1];
    check("approx: the same estimate and bitrate again: Resume continued the same format with --continue from its part", d.state === "completed" && fmtArg(last) === "230+140" && last.includes("--continue") && from.length === 2 && from[1] === size0, { from, size0, later: later.map(shown) });
    check("approx: completed with the first encode's bytes only", (await sha(d.path)) === (await shaOf([{ id: "230", size: 2_400_000 }, { id: "140", size: 300_000 }])));
    // Another length (more than 1 s): another file, though its estimate and bitrate are the same.
    const key2 = "p8-dur";
    await steer(key2, { formats: list, rate: 1_000_000 });
    const id2 = startYt(key2, "230+140", list, { quality: "240p" });
    await pauseAt(id2, 1_300_000, "dur");
    const old2 = at(`${nameOf(key2)}.f230.mp4.part`);
    const sha2 = await sha(old2);
    await steer(key2, { formats: list, duration: 25, rate: 1_000_000 });
    engine.resume(id2);
    const v2 = await settled(id2, "dur to ask", asks);
    check("approx: another length (more than 1 s) is File changed too, its part untouched", v2.need?.kind === "choice" && v2.need.evidence === "was 0:19 long, now 0:25" && (await sha(old2)) === sha2, { state: v2.state, need: v2.need });
    engine.cancel(id2);
    // Nothing to compare at all (no size, estimate or bitrate): R7, asked about above 1 MiB saved.
    const key3 = "p8-unk";
    const bare = [{ format_id: "hls-360", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360, fps: 30, protocol: "m3u8_native", _bytes: 2_000_000 }];
    await steer(key3, { formats: bare, rate: 1_000_000 });
    const id3 = startYt(key3, "hls-360", bare, { quality: "360p" });
    await pauseAt(id3, 1_300_000, "unknown");
    const old3 = at(`${nameOf(key3)}.mp4.part`);
    const sha3 = await sha(old3);
    engine.resume(id3);
    const v3 = await settled(id3, "unknown to ask", asks);
    check("approx: a format with nothing to compare asks above 1 MiB saved (R7), its part untouched", v3.need?.kind === "choice" && v3.need.evidence === "Deer can’t confirm it is the same file" && (await sha(old3)) === sha3, { state: v3.state, need: v3.need });
    engine.cancel(id3);
  }

  // ---- dup: a refused check is the attempt at the failure (finding 4) ----
  if (want("dup")) {
    const key = "p8-dup";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    await pauseAt(id, 400_000, "dup");
    await steer(key, { formats: list, rate: 1_000_000, fail: "HTTP Error 403: Forbidden" });
    const before = (await callsFor(key)).length;
    const t0 = Date.now();
    engine.resume(id);
    const v = await settled(id, "dup to be Link expired", asks);
    // An attempt at the failure would ask at once: it has the time to.
    await sleep(2000);
    const after = (await callsFor(key)).slice(before);
    const w = engine.get(id);
    log("dup", { need: w.need, nextAt: w.nextAt - t0, after: after.map(shown) });
    check("dup: a resume whose check yt-dlp refuses (HTTP Error 403) is Link expired, its bytes kept", v.need?.kind === "address" && v.need.status === 403, { state: v.state, need: v.need });
    check("dup: yt-dlp was asked once (the refused check was the attempt at the failure); the next try is the schedule's (2 minutes)", after.length === 1 && after[0].includes("-J") && w.nextAt - t0 > 100_000 && w.nextAt - t0 < 140_000, { after: after.map(shown), nextAt: w.nextAt - t0 });
    engine.cancel(id);
  }

  // ---- sib: Cancel removes only the row's own parts (finding 3) ----
  if (want("sib")) {
    const key = "p8-sib";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 1_500_000)];
    await steer(key, { formats: list, rate: 500_000 });
    const video = startYt(key, "137+140", list);
    const sound = startYt(key, "140", list, { quality: "M4A", ext: "m4a", audioOnly: true });
    await pauseAt(video, 600_000, "sib video");
    await pauseAt(sound, 300_000, "sib sound");
    const vpart = `${nameOf(key)}.f137.mp4.part`;
    const spart = `${nameOf(key)}.m4a.part`;
    const files0 = await filesOf(key);
    const vsha = await sha(at(vpart));
    const vsize = (await IOUtils.stat(at(vpart))).size;
    engine.cancel(sound);
    await sleep(1500);
    const files1 = await filesOf(key);
    log("sib", { files0, files1 });
    check("sib: the two rows of one video keep their parts apart (<stem>.f137.mp4.part, <stem>.m4a.part)", files0.includes(vpart) && files0.includes(spart), files0);
    check("sib: cancelling the sound's row removed only its own part; the video row's part is untouched", !files1.includes(spart) && files1.includes(vpart) && (await sha(at(vpart))) === vsha, files1);
    engine.resume(video);
    const d = await DL.until(video, ["completed", "failed", "paused"], { timeout: 40000, what: "sib video to complete" });
    const from = (await writes(key)).filter((e) => e.id === "137").map((e) => e.from);
    log("sib video", { state: d.state, error: d.error, from, vsize });
    check("sib: the video's row then continued from its part and completed with its bytes", d.state === "completed" && from[from.length - 1] === vsize && (await sha(d.path)) === (await shaOf([{ id: "137", size: 3_000_000 }, { id: "140", size: 1_500_000 }])), { state: d.state, from, vsize });
    check("sib: nothing of either row is left behind", (await filesOf(key)).length === 1, await filesOf(key));
  }

  // ---- burst: background -J runs are shared per page and two at a time (finding 2) ----
  if (want("burst")) {
    engine.forgetYtdlpAnswers?.();
    const list = [V("137", 1080, "mp4", 4000, 2_000_000), A("140", "m4a", 129, 300_000)];
    const keys = ["p8-b1", "p8-b2", "p8-b3", "p8-b4"];
    for (const k of keys) await steer(k, { formats: list, rate: 400_000 });
    const ids = keys.map((k) => startYt(k, "137+140", list));
    // The first page's sound alone: a second row of the same page.
    ids.push(startYt("p8-b1", "140", list, { quality: "M4A", ext: "m4a", audioOnly: true }));
    for (const id of ids) await pauseAt(id, 100_000, "burst");
    // Their links expired: Link expired rows whose attempts all fall due at once (as after a start or a link-up).
    for (const k of keys) await steer(k, { formats: list, rate: 400_000, jdelay: 1.5 });
    const jr = (await lines(fakeLog + ".jruns")).length;
    const now = Date.now();
    for (const id of ids) {
      const r = rec(id);
      r.need = { kind: "address", since: now, status: 403 };
      r.wait = { for: "address", since: now, tries: 1, nextAt: now };
    }
    engine.armWaits();
    const done = [];
    for (const id of ids) done.push(await DL.until(id, ["completed", "failed"], { timeout: 60000, what: "burst to complete" }));
    const runs = (await lines(fakeLog + ".jruns")).slice(jr).filter((r) => keys.some((k) => r.page.includes(k)));
    const most = Math.max(0, ...runs.map((a) => runs.filter((b) => b.t0 < a.t1 && a.t0 < b.t1).length));
    log("burst", { runs: runs.map((r) => [r.page.split("/").pop(), +(r.t0 % 1000).toFixed(2), +(r.t1 % 1000).toFixed(2)]), most, states: done.map((d) => [d.state, d.error]) });
    check("burst: five rows' attempts falling due together ran yt-dlp -J at most two at a time", runs.length > 0 && most <= 2, { most, runs: runs.length });
    check("burst: the two rows of one page shared one -J (one per page)", runs.length === keys.length && keys.every((k) => runs.filter((r) => r.page.includes(k)).length === 1), runs.map((r) => r.page.split("/").pop()));
    check("burst: every row continued and completed", done.every((d) => d.state === "completed"), done.map((d) => [d.state, d.error]));
  }

  // ---- container: a re-pick the row's file type can't hold (finding 6) ----
  if (want("container")) {
    // 1. The check's loose re-pick: a 1440p WEBM row whose 1440p is gone, with only H.264 pictures offered now.
    const key = "p8-exta";
    const list = [V("271", 1440, "webm", 9000, 3_000_000), A("251", "webm", 135, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "271+251", list, { quality: "1440p", ext: "webm" });
    await pauseAt(id, 1_500_000, "ext");
    await steer(key, { formats: [V("137", 1080, "mp4", 4000, 2_000_000), A("251", "webm", 135, 300_000), A("140", "m4a", 129, 300_000)], rate: 1_000_000 });
    engine.resume(id);
    const v = await settled(id, "ext to ask", asks);
    check("container: a WEBM row whose quality is gone asks, saying Start over gets 1080p as MKV (WEBM can't hold H.264)", v.need?.kind === "choice" && v.need.evidence === "this quality is no longer offered; Start over gets 1080p as MKV", { state: v.state, need: v.need });
    const before = (await callsFor(key)).length;
    await engine.decide(id, "start-over");
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "ext to complete" });
    const call = (await callsFor(key)).slice(before).find((c) => c.includes("-f"));
    log("container 1", { state: d.state, error: d.error, call, filename: d.filename, files: await filesOf(key) });
    check("container: Start over joined 137+251 into MKV, the file named for it", d.state === "completed" && fmtArg(call) === "137+251" && argOf(call, "--merge-output-format") === "mkv" && PathUtils.filename(argOf(call, "-o")) === `${nameOf(key)}.mkv` && d.filename === `${nameOf(key)}.mkv`, { call, filename: d.filename });
    check("container: the MKV holds the new picture's bytes and the sound's, and nothing is left behind", d.state === "completed" && (await sha(d.path)) === (await shaOf([{ id: "137", size: 2_000_000 }, { id: "251", size: 300_000 }])) && (await filesOf(key)).length === 1, await filesOf(key));
    // 2. The pill: another WEBM row whose 1440p is gone; the person picks the 1080p MP4 option.
    const key2 = "p8-extb";
    await steer(key2, { formats: list, rate: 1_000_000 });
    const id2 = startYt(key2, "271+251", list, { quality: "1440p", ext: "webm" });
    await pauseAt(id2, 1_500_000, "ext2");
    const now = [V("137", 1080, "mp4", 4000, 2_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key2, { formats: now, rate: 1_000_000 });
    const r = engine.renewWith(id2, ytOption(key2, now, "137+140", "1080p", 1080, "mp4"), { identity: { userContextId: 0, isPrivate: false } });
    const before2 = (await callsFor(key2)).length;
    await engine.decide(id2, "start-over");
    const d2 = await DL.until(id2, ["completed", "failed", "paused"], { timeout: 40000, what: "ext2 to complete" });
    const call2 = (await callsFor(key2)).slice(before2).find((c) => c.includes("-f"));
    log("container 2", { r, state: d2.state, error: d2.error, call2, filename: d2.filename, files: await filesOf(key2) });
    check(
      "container: the pill's MP4 quality for a WEBM row is joined into MP4, the file named for it",
      r === "changed" && d2.state === "completed" && fmtArg(call2) === "137+140" && argOf(call2, "--merge-output-format") === "mp4" && d2.filename === `${nameOf(key2)}.mp4` && (await sha(d2.path)) === (await shaOf([{ id: "137", size: 2_000_000 }, { id: "140", size: 300_000 }])) && (await filesOf(key2)).length === 1,
      { r, call2, filename: d2.filename }
    );
  }

  // ---- kind: the pill's quality of the other kind (finding 5) ----
  if (want("kind")) {
    const key = "p8-kinda";
    const list = [A("140", "m4a", 129, 2_000_000)];
    await steer(key, { formats: list, rate: 500_000 });
    const id = startYt(key, "140", list, { quality: "M4A", ext: "m4a", audioOnly: true });
    await pauseAt(id, 400_000, "kind");
    // The sound alone is no longer offered; the person picks 1080p (an H.264 picture with Opus sound: MKV).
    const now = [V("137", 1080, "mp4", 4000, 2_000_000), A("251", "webm", 135, 300_000)];
    await steer(key, { formats: now, rate: 1_000_000 });
    const r = engine.renewWith(id, ytOption(key, now, "137+251", "1080p", 1080, "mkv"), { identity: { userContextId: 0, isPrivate: false } });
    const before = (await callsFor(key)).length;
    await engine.decide(id, "start-over");
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "kind to complete" });
    const call = (await callsFor(key)).slice(before).find((c) => c.includes("-f"));
    log("kind", { r, state: d.state, error: d.error, call, filename: d.filename, quality: d.quality, files: await filesOf(key) });
    check(
      "kind: a sound row given the pill's 1080p becomes a video: joined as MKV, named for it, no longer sound alone",
      r === "changed" && d.state === "completed" && fmtArg(call) === "137+251" && argOf(call, "--merge-output-format") === "mkv" && d.filename === `${nameOf(key)}.mkv` && rec(id).ytdlp?.audioOnly === false && d.quality === "1080p" && (await filesOf(key)).length === 1,
      { r, call, filename: d.filename, audioOnly: rec(id).ytdlp?.audioOnly }
    );
    // The other way: a video row given the sound alone saves it as M4A.
    const key2 = "p8-kindb";
    const list2 = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key2, { formats: list2, rate: 1_000_000 });
    const id2 = startYt(key2, "137+140", list2);
    await pauseAt(id2, 1_200_000, "kind2");
    const now2 = [A("140", "m4a", 129, 300_000)];
    await steer(key2, { formats: now2, rate: 1_000_000 });
    const r2 = engine.renewWith(id2, ytOption(key2, now2, "140", "M4A", 0, "m4a", "audio"), { identity: { userContextId: 0, isPrivate: false } });
    const before2 = (await callsFor(key2)).length;
    await engine.decide(id2, "start-over");
    const d2 = await DL.until(id2, ["completed", "failed", "paused"], { timeout: 40000, what: "kind2 to complete" });
    const call2 = (await callsFor(key2)).slice(before2).find((c) => c.includes("-f"));
    log("kind 2", { r2, state: d2.state, error: d2.error, call2, filename: d2.filename, files: await filesOf(key2) });
    check(
      "kind: a video row given the sound alone saves it as M4A, sound alone",
      r2 === "changed" && d2.state === "completed" && fmtArg(call2) === "140" && !call2.includes("--merge-output-format") && d2.filename === `${nameOf(key2)}.m4a` && rec(id2).ytdlp?.audioOnly === true && (await sha(d2.path)) === (await shaOf([{ id: "140", size: 300_000 }])) && (await filesOf(key2)).length === 1,
      { r2, call2, filename: d2.filename, files: await filesOf(key2) }
    );
  }

  // ---- sound: a sound format that is gone (finding 7) ----
  if (want("sound")) {
    // 1. Nothing of the sound saved (paused inside the picture), its M4A gone, Opus offered: replaced by itself.
    const key = "p8-snda";
    const list = [V("137", 1080, "mp4", 4000, 3_000_000), A("140", "m4a", 129, 300_000)];
    await steer(key, { formats: list, rate: 1_000_000 });
    const id = startYt(key, "137+140", list);
    await pauseAt(id, 1_200_000, "sa");
    await steer(key, { formats: [V("137", 1080, "mp4", 4000, 3_000_000), A("251", "webm", 135, 280_000)], rate: 1_000_000 });
    const before = (await callsFor(key)).length;
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed", "paused"], { timeout: 40000, what: "sa to complete" });
    const call = (await callsFor(key)).slice(before).find((c) => c.includes("-f"));
    const from = (await writes(key)).filter((e) => e.id === "137").map((e) => e.from);
    log("sound 1", { state: d.state, need: d.need, call, from, events: rec(id).events });
    check(
      "sound: an M4A sound that is gone with nothing of it saved is replaced by itself (Opus, joined into the MP4), never asked; the picture continued",
      d.state === "completed" && !needs.has(id) && fmtArg(call) === "137+251" && argOf(call, "--merge-output-format") === "mp4" && d.filename === `${nameOf(key)}.mp4` && from.length === 2 && from[1] > 0 && (await sha(d.path)) === (await shaOf([{ id: "137", size: 3_000_000 }, { id: "251", size: 280_000 }])),
      { state: d.state, need: d.need, call, from }
    );
    // 2. Under 1 MiB of the sound saved, its M4A replaced by another M4A: started over by itself, the history line naming the sound.
    const key2 = "p8-sndb";
    const list2 = [V("137", 1080, "mp4", 4000, 1_000_000), A("140", "m4a", 129, 2_000_000)];
    await steer(key2, { formats: list2, rate: 1_000_000 });
    const id2 = startYt(key2, "137+140", list2);
    await pauseAt(id2, 1_400_000, "sb");
    const now2 = [V("137", 1080, "mp4", 4000, 1_000_000), A("139", "m4a", 48, 800_000)];
    await steer(key2, { formats: now2, rate: 1_000_000 });
    engine.resume(id2);
    const d2 = await DL.until(id2, ["completed", "failed", "paused"], { timeout: 40000, what: "sb to complete" });
    log("sound 2", { state: d2.state, need: d2.need, events: rec(id2).events });
    check(
      "sound: with under 1 MiB of it saved the sound started over by itself in its new format, the history line naming the sound",
      d2.state === "completed" && !needs.has(id2) && (rec(id2).events ?? []).some((e) => e.text === "Started the sound over: the site offers it as another format now") && (await sha(d2.path)) === (await shaOf([{ id: "137", size: 1_000_000 }, { id: "139", size: 800_000 }])),
      { state: d2.state, events: rec(id2).events }
    );
    // 3. More than 1 MiB of the sound saved: it asks, naming the sound, not the picture's quality.
    const key3 = "p8-sndc";
    await steer(key3, { formats: list2, rate: 1_000_000 });
    const id3 = startYt(key3, "137+140", list2);
    await pauseAt(id3, 2_300_000, "sc");
    await steer(key3, { formats: now2, rate: 1_000_000 });
    engine.resume(id3);
    const v3 = await settled(id3, "sc to ask", asks);
    check("sound: with more than 1 MiB of it saved it asks, naming the sound", v3.need?.kind === "choice" && v3.need.evidence === "the M4A sound is no longer offered", { state: v3.state, need: v3.need });
    engine.cancel(id3);
  }

  // ---- pagefile, order, skip: a page media file whose address expired (G1 step 2) ----
  /** /page/<pid>.html's first address (valid 5 s at 512 KB/s), a download of it paused at 2 MiB, after it expired. */
  const expiredFile = async (pid, { filename = "clip.mp4", media = true, isPrivate = false } = {}) => {
    const q = `&name=${filename}&ttl=5&rate=512`;
    const url = DL.base + (await (await fetch(`${DL.base}/page/${pid}.json?${q.slice(1)}`, { cache: "no-store" })).json()).url;
    const page = `${DL.base}/page/${pid}.html?${q.slice(1)}`;
    const id = engine.start(url, { filename, named: true, pageUrl: page, ...(media ? { videoKey: `${page}|${filename}` } : {}), ...(isPrivate ? { identity: { isPrivate: true } } : {}) });
    const p = await pauseAt(id, 2 * MiB, pid);
    const expires = Number(/Expires=(\d+)/.exec(url)?.[1] ?? 0) * 1000;
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the address to expire" });
    return { id, url, page, q, p };
  };
  const requests = async () => (await DL.settledStats()).requests;
  /** yt-dlp's formats of a page: its own file as an https format (filesize `size`) at a fresh address, and two that are never asked. */
  const pageFormats = (pid, size) => [
    { format_id: "http-720", ext: "mp4", vcodec: "avc1.4d401f", acodec: "mp4a.40.2", height: 720, protocol: "https", url: "@mint", filesize: size },
    { format_id: "http-360", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360, protocol: "https", url: `${DL.base}/named?name=decoy-${pid}.mp4`, filesize: 65536 },
    { format_id: "hls-720", ext: "mp4", vcodec: "avc1.4d401f", acodec: "mp4a.40.2", height: 720, protocol: "m3u8_native", url: `${DL.base}/fx/hls/v360/index.m3u8?decoy=${pid}`, filesize: medium.size },
  ];

  if (want("pagefile")) {
    await DL.reset();
    const pid = "p8pf";
    const x = await expiredFile(pid);
    await steer(pid, { mint: `/page/${pid}.json?${x.q.slice(1)}`, formats: pageFormats(pid, medium.size) });
    const t0 = Date.now();
    engine.resume(x.id);
    const d = await DL.until(x.id, ["completed", "failed"], { timeout: 60000, what: "the page media file to complete" });
    const reqs = await requests();
    const asked = await callsFor(`/page/${pid}.html`);
    log("pagefile", { state: d.state, error: d.error, ms: Date.now() - t0, events: rec(x.id).events, calls: asked, reqs: reqs.filter((r) => r.page === pid || /decoy/.test(r.path)).map((r) => `${r.status} ${r.path.slice(0, 40)} ${r.minted ? "minted" : ""}`) });
    check("pagefile: renewed from yt-dlp's https format of its page with the file's filesize, and completed intact", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && (rec(x.id).events ?? []).some((e) => e.text === "New link found through yt-dlp"), { state: d.state, error: d.error, events: rec(x.id).events });
    check("pagefile: yt-dlp was asked for the page's formats (-J), with no cookie options", asked.length === 1 && asked[0].includes("-J") && asked[0].every((a) => !/cookie/i.test(a)), asked);
    check("pagefile: the page step never ran (the page itself never loaded): yt-dlp comes before it; the address was the one yt-dlp's -J minted", !reqs.some((r) => r.page === pid && !r.minted) && reqs.filter((r) => r.page === pid && r.minted).length === 2, reqs.filter((r) => r.page === pid).map((r) => r.path));
    check("pagefile: a format of another size and a playlist format were never asked", !reqs.some((r) => /decoy/.test(r.path)), reqs.filter((r) => /decoy/.test(r.path)).map((r) => r.path));
    check("pagefile: the row keeps its own address; the new one is its final address", rec(x.id).url === x.url && rec(x.id).file.finalUrl !== x.url, { url: rec(x.id).url, final: rec(x.id).file?.finalUrl });
  }

  if (want("order")) {
    await DL.reset();
    const pid = "p8or";
    // From a redirector that answers once (/signed-once/): its original address is asked again, and refuses, first.
    const q = "name=clip.mp4&ttl=5&rate=512";
    const page = `${DL.base}/page/${pid}.html?${q}`;
    const id = engine.start(`${DL.base}/signed-once/medium?k=${pid}&ttl=5&rate=512`, { filename: "clip.mp4", named: true, pageUrl: page, videoKey: `${page}|clip.mp4` });
    await pauseAt(id, 2 * MiB, pid);
    const expires = Number(/Expires=(\d+)/.exec(rec(id).file?.finalUrl ?? "")?.[1] ?? 0) * 1000;
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the address to expire" });
    // yt-dlp gives the file's address with another filesize: never judged, so the page step comes next.
    await steer(pid, { mint: `/page/${pid}.json?${q}`, formats: pageFormats(pid, medium.size - 1) });
    const t0 = Date.now() / 1000;
    engine.resume(id);
    const d = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the page media file to complete from its page" });
    const reqs = await requests();
    const original = reqs.find((r) => r.t >= t0 && r.path.startsWith(`/signed-once/medium?k=${pid}`));
    const mint = reqs.find((r) => r.page === pid && r.minted);
    const load = reqs.find((r) => r.page === pid && !r.minted);
    log("order", { state: d.state, error: d.error, events: rec(id).events, original: original && [original.status, original.t], mint: mint?.t, load: load?.t });
    check("order: yt-dlp finding nothing, the page step renewed it", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && (rec(id).events ?? []).some((e) => e.text === "New link found on its page"), { state: d.state, events: rec(id).events });
    check(
      "order: the original address was asked again first (refused), then yt-dlp (its -J), then the page was opened",
      !!original && original.status === 403 && !!mint && !!load && original.t <= mint.t && mint.t <= load.t && (await callsFor(`/page/${pid}.html`)).length === 1,
      { original: original && [original.status, original.t], mint: mint?.t, load: load?.t }
    );
  }

  if (want("skip")) {
    await DL.reset();
    // A private download: yt-dlp would ask the site from outside the private session (no private window here either).
    const pv = await expiredFile("p8pv", { isPrivate: true });
    await steer("p8pv", { mint: `/page/p8pv.json?${pv.q.slice(1)}`, formats: pageFormats("p8pv", medium.size) });
    engine.resume(pv.id);
    const v = await settled(pv.id, "the private file to be Link expired", (x) => x.state === "paused" && !!x.need, 30000);
    check("skip: a private page media file never runs yt-dlp (Link expired)", v.need?.kind === "address" && (await callsFor("/page/p8pv.html")).length === 0, { need: v.need, calls: await callsFor("/page/p8pv.html") });
    engine.cancel(pv.id);
    // A file that is not media ("report.bin", not from the picker): never yt-dlp (the page step may renew it).
    const nm = await expiredFile("p8nm", { filename: "report.bin", media: false });
    await steer("p8nm", { mint: `/page/p8nm.json?${nm.q.slice(1)}`, formats: pageFormats("p8nm", medium.size) });
    engine.resume(nm.id);
    const w = await settled(nm.id, "the other file to settle", (x) => x.state === "completed" || (x.state === "paused" && !!x.need), 90000);
    check("skip: a file that is not media never runs yt-dlp", (await callsFor("/page/p8nm.html")).length === 0, { state: w.state, calls: await callsFor("/page/p8nm.html") });
    engine.cancel(nm.id);
    // The control: a page media file whose own redirector gives a fresh address renews from it, as before Phase 8.
    const sgPage = `${DL.base}/page/p8sg.html?name=clip.mp4`;
    const sg = engine.start(`${DL.base}/sign/medium?k=p8sg&ttl=5&rate=512`, { filename: "clip.mp4", named: true, pageUrl: sgPage, videoKey: `${sgPage}|clip.mp4` });
    await pauseAt(sg, 2 * MiB, "p8sg");
    const sgExpires = Number(/Expires=(\d+)/.exec(rec(sg).file?.finalUrl ?? "")?.[1] ?? 0) * 1000;
    await waitFor(() => Date.now() > sgExpires + 300, { timeout: 20000, interval: 100, what: "the address to expire" });
    await steer("p8sg", { mint: "/page/p8sg.json?name=clip.mp4", formats: pageFormats("p8sg", medium.size) });
    engine.resume(sg);
    const sd = await DL.until(sg, ["completed", "failed"], { timeout: 60000, what: "the redirected file to complete" });
    log("skip control", { state: sd.state, error: sd.error, events: rec(sg).events });
    check(
      "skip: a page media file its original address renews completes from it and never runs yt-dlp",
      sd.state === "completed" && (await DL.sha256(sd.path)) === medium.sha256 && (rec(sg).events ?? []).some((e) => e.text === "New link found") && (await callsFor("/page/p8sg.html")).length === 0,
      { state: sd.state, events: rec(sg).events, calls: await callsFor("/page/p8sg.html") }
    );
  }

  // ---- fburst: page media files of one page share yt-dlp's look at it (finding 2; G1 step 2) ----
  if (want("fburst")) {
    await DL.reset();
    engine.forgetYtdlpAnswers?.();
    engine.ytdlpSites?.clear();
    const pid = "p8fb";
    // (A page address that ends in ".mp4" would read as the media itself: MEDIA_URL.)
    const page = `${DL.base}/page/${pid}.html?name=one.mp4&ttl=600`;
    const rows = [];
    for (const [i, name] of ["one.mp4", "two.mp4", "three.mp4"].entries()) {
      const q = `name=${name}&ttl=5&rate=512`;
      const url = DL.base + (await (await fetch(`${DL.base}/page/${pid}${i}.json?${q}`, { cache: "no-store" })).json()).url;
      rows.push({ name, q, url, id: engine.start(url, { filename: name, named: true, pageUrl: page, videoKey: `${page}|${name}` }) });
    }
    for (const r of rows) await pauseAt(r.id, MiB, `fburst ${r.name}`);
    const expires = Math.max(...rows.map((r) => Number(/Expires=(\d+)/.exec(r.url)?.[1] ?? 0) * 1000));
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the addresses to expire" });
    // yt-dlp's formats of the page: each file at a fresh address (a later mint of its id is fast and lasts).
    await steer(`/page/${pid}.html`, { jdelay: 1, formats: rows.map((r, i) => ({ format_id: `http-${i}`, ext: "mp4", vcodec: "avc1.4d401f", acodec: "mp4a.40.2", height: 720, protocol: "https", url: `@mint:/page/${pid}${i}.json?${r.q}`, filesize: medium.size })) });
    for (const r of rows) engine.resume(r.id);
    const done = [];
    for (const r of rows) done.push(await DL.until(r.id, ["completed", "failed"], { timeout: 90000, what: `fburst ${r.name} to complete` }));
    const asked = await callsFor(`/page/${pid}.html`);
    log("fburst", { states: done.map((d) => [d.state, d.error]), asked: asked.length, events: rows.map((r) => (rec(r.id).events ?? []).map((e) => e.text)) });
    check("fburst: three page media files of one page whose addresses expired together asked yt-dlp about the page once", asked.length === 1, asked.length);
    const intact = [];
    for (const d of done) intact.push(d.state === "completed" && (await sha(d.path)) === medium.sha256);
    check("fburst: each was renewed through yt-dlp and completed intact", intact.every(Boolean) && rows.every((r) => (rec(r.id).events ?? []).some((e) => e.text === "New link found through yt-dlp")), { intact, states: done.map((d) => [d.state, d.error]) });
  }

  // ---- budget: a site's yt-dlp looks are limited as its pages are (finding 2; G1 step 2, decision 6) ----
  if (want("budget")) {
    await DL.reset();
    engine.forgetYtdlpAnswers?.();
    engine.pageSites.clear();
    // The site had six yt-dlp looks this hour.
    engine.ytdlpSites?.clear();
    for (let i = 0; i < 6; i++) engine.ytdlpSites?.use("127.0.0.1");
    const x = await expiredFile("p8bg");
    await steer("p8bg", { mint: `/page/p8bg.json?${x.q.slice(1)}`, formats: pageFormats("p8bg", medium.size) });
    engine.resume(x.id);
    const d = await DL.until(x.id, ["completed", "failed"], { timeout: 90000, what: "the budget file to complete" });
    const asked = await callsFor("/page/p8bg.html");
    log("budget", { state: d.state, error: d.error, asked: asked.length, events: rec(x.id).events });
    check(
      "budget: a site's seventh yt-dlp look within the hour is not made; the page step renewed the file",
      asked.length === 0 && d.state === "completed" && (await sha(d.path)) === medium.sha256 && (rec(x.id).events ?? []).some((e) => e.text === "New link found on its page"),
      { asked: asked.length, state: d.state, events: rec(x.id).events }
    );
    engine.ytdlpSites?.clear();
  }

  // ---- cookies: never ----
  const all = await lines(fakeLog);
  check(
    "cookies: no call to yt-dlp ever carried cookie options (no --cookies, --cookies-from-browser or Cookie header)",
    (only.size > 0 || all.length > 0) && all.every((c) => Array.isArray(c) && c.every((a) => !/cookie/i.test(String(a))) && !c.includes("--add-header")),
    all.filter((c) => !Array.isArray(c) || c.some((a) => /cookie/i.test(String(a))) || c.includes("--add-header"))
  );
  log("files", await DL.files());
});
