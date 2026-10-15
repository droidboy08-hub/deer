// Diagnostic against the real world (not in the default set): the installer gets the real yt-dlp and
// Deno from GitHub (checked against their published SHA-256) into a temporary folder, then a real
// YouTube video ("Me at the zoo", 19 s) is offered and downloaded through the picker.
// Phase 8 of spikes/downloader/RESUME-DESIGN.md: the names of the files real yt-dlp keeps while it works are
// watched (ytdlp.ts ytdlpParts() and partsOf() infer them: "<stem>.f<id>.<ext>.part" for joined formats), the row
// records the chosen formats with their sizes (5.4), and the download is paused as soon as a part shows and
// resumed: yt-dlp is asked again and the same formats continue (--continue).
//   python tests/downloads/all.py ytdlp-real
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
  const dir = PathUtils.join(PathUtils.tempDir, "vitre-tools-real");
  Services.prefs.setStringPref("vitre.tools.installDir", dir);

  const phases = [];
  const off = engine.onYtdlpInstall((s) => {
    const k = s.phase + (s.tool ? ":" + s.tool : "");
    if (phases[phases.length - 1] !== k) phases.push(k);
  });
  const t0 = Date.now();
  await engine.installYtdlp(false).catch((e) => log("install error " + e));
  off();
  log("install phases " + phases.join(" > ") + " in " + (Date.now() - t0) + " ms");
  check("yt-dlp and Deno installed from their releases", engine.ytdlpInstall().phase === "done" && engine.hasYtdlp(), engine.ytdlpInstall());
  const version = await engine.ytdlpVersion();
  log("version " + version);
  check("their versions are read", /^yt-dlp \d{4}\.\d{2}\.\d{2}.* · Deno \d/.test(version), version);

  const t = b.active();
  b.navigate(t.id, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await waitFor(() => !t.loading && /watch/.test(t.browser.currentURI.spec), { timeout: 30000, what: "YouTube" });
  await sleep(3000);
  spike.click(b.bar.downloadMark());
  const t1 = Date.now();
  await waitFor(() => ui.video.picker.isOpen || (b.root.querySelector(".vd-note") && !/Finding/.test(b.root.querySelector(".vd-note").textContent)), { timeout: 120000, what: "an answer" });
  log("answer in " + (Date.now() - t1) + " ms");
  const noteText = b.root.querySelector(".vd-note")?.textContent ?? "";
  check("the picker offers the real video's qualities", ui.video.picker.isOpen, noteText);
  if (!ui.video.picker.isOpen) return;
  const pick = ui.video.picker.element;
  log("rows " + JSON.stringify([...pick.querySelectorAll(".vd-opt")].map((r) => r.textContent.replace(/\s+/g, " ").trim())));
  await spike.capture("real-1-picker");
  const before = engine.list(false).length;
  const known = new Set(await DL.files());
  // Phase 8: every name yt-dlp's files take in the downloads folder while it works.
  const seen = new Set();
  let watching = true;
  let paused = false;
  let dlId = "";
  const watch = (async () => {
    while (watching) {
      for (const f of await DL.files()) {
        if (known.has(f)) continue;
        seen.add(f);
        // Paused as soon as a part shows (Phase 8: the resume asks yt-dlp again and continues).
        if (!paused && dlId && /\.part$/i.test(f) && engine.get(dlId)?.state === "downloading") {
          paused = true;
          engine.pause(dlId);
        }
      }
      await sleep(10);
    }
  })();
  spike.click(pick.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).length > before && engine.list(false)[0], { timeout: 10000, what: "the download" });
  dlId = dl.id;
  const rec = engine.recs.find((r) => r.id === dl.id);
  log("recorded formats " + JSON.stringify(rec?.ytdlp?.formats ?? null) + " format " + (rec?.ytdlp?.format ?? ""));
  // A format yt-dlp gives no exact size for (YouTube's HLS formats, such as 230, report only an estimate) is recorded
  // with filesize 0 (2.7; ytdlp.ts judge()).
  check(
    "Phase 8: the row recorded the chosen formats (5.4: id, ext, a video's height and fps; the sizes yt-dlp reported exactly)",
    !!rec?.ytdlp?.formats?.length && rec.ytdlp.formats.map((f) => f.id).join("+") === rec.ytdlp.format && rec.ytdlp.formats.every((f) => !!f.ext && (f.audioOnly || (f.height > 0 && f.fps > 0)) && f.filesize >= 0),
    rec?.ytdlp?.formats
  );
  // Review of Phase 8: such a format carries what its resume compares instead (ytdlp.ts compare()): an estimate or a
  // bitrate, and the video's length; the resume below then shows whether YouTube reports them the same twice.
  check(
    "Phase 8 review: a format with no exact size recorded its estimate or bitrate and the video's length",
    !!rec?.ytdlp?.formats?.length && rec.ytdlp.formats.every((f) => f.filesize > 0 || ((f.approx > 0 || f.tbr > 0) && f.duration > 0)),
    rec?.ytdlp?.formats
  );
  const first = await DL.until(dl.id, ["completed", "failed", "paused"], { timeout: 240000 });
  let parts = [];
  if (first.state === "paused") {
    parts = (await DL.files()).filter((f) => !known.has(f));
    log("paused with " + JSON.stringify(parts) + " at " + first.received);
    engine.resume(dl.id);
  } else log("it finished before the pause took: " + first.state);
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 240000 });
  watching = false;
  await watch;
  const names = [...seen];
  log("download " + JSON.stringify({ state: done.state, file: done.filename, received: done.received, error: done.error, events: rec?.events }));
  log("names seen " + JSON.stringify(names));
  check("the real YouTube video downloads", done.state === "completed" && (await IOUtils.exists(done.path)) && (await IOUtils.stat(done.path)).size > 100000, done.error);
  // ytdlp.ts ytdlpParts() and partsOf(): what a joined download keeps is "<stem>.f<id>.<ext>" (with .part while it
  // is written), a single format "<name>.part"; merging, "<stem>.temp.<ext>".
  const stemName = done.filename.replace(/\.[^.]+$/, "");
  const ids = (rec?.ytdlp?.format ?? "").split("+");
  const isPart = (n) => n.startsWith(stemName + ".") && (/\.part(-Frag\d+)?$/i.test(n) || /\.ytdl$/i.test(n) || /^\.f[\w-]+\.\w+$/i.test(n.slice(stemName.length)) || /\.temp\.\w+$/i.test(n));
  const others = names.filter((n) => n !== done.filename && !isPart(n));
  check("Phase 8: every file real yt-dlp kept while it worked is one ytdlpParts() names", others.length === 0, { names, others });
  check(
    "Phase 8: each joined format's part is named <stem>.f<id>.<ext>.part (partsOf())",
    ids.length < 2 || ids.every((id) => names.some((n) => n.startsWith(`${stemName}.f${id}.`) && /\.part$/i.test(n))),
    { ids, names }
  );
  check("Phase 8: nothing yt-dlp kept is left once the video is complete", (await DL.files()).filter((f) => !known.has(f) && f !== done.filename).length === 0, await DL.files());
  if (first.state === "paused") check("Phase 8: paused with its parts, the resume asked yt-dlp again and the same formats continued", done.state === "completed" && rec?.ytdlp?.format === ids.join("+") && !(rec?.events ?? []).some((e) => /Started/.test(e.text)), { events: rec?.events, parts });
  await spike.capture("real-2-done");
  if (done.path) await IOUtils.remove(done.path, { ignoreAbsent: true });
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
