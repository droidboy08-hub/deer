// No ffmpeg anywhere (no settings path, none beside Vitre, none on PATH): the picker says so, a
// stream with separate sound is kept as two files, a TS stream stays .ts, and Settings › Video
// downloads shows "ffmpeg not found" until a path is chosen.
/* global spike, Services, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const ff = await engine.ffmpeg();
  check("no ffmpeg is found", ff.source === "none" && !ff.path, ff);

  // ---- the picker on an fMP4 stream with separate audio ----
  await DL.open(DL.base + "/video-fmp4.html", { settle: 1500 });
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 8000, what: "the pill" });
  spike.click(b.root.querySelector(".vd-pill-main"));
  await waitFor(() => ui.video.picker.isOpen, { what: "the picker" });
  await sleep(600);
  const picker = ui.video.picker.element;
  const note = picker.querySelector(".vd-mux");
  check("the picker says ffmpeg is missing and what happens", !note.hidden && /ffmpeg not found/.test(note.textContent), note.textContent);
  await spike.capture("noffmpeg-1-picker");
  spike.click(picker.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false)[0]?.stream && engine.list(false)[0], { timeout: 5000, what: "the stream download" });
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 90000 });
  check("the stream completed without ffmpeg", done.state === "completed", done.error);
  check("its row explains it was kept as two files", /ffmpeg not found/.test(done.note), done.note);
  const files = await DL.files();
  log("files", files);
  check("video and sound are two files", files.some((f) => /\.mp4$/.test(f)) && files.some((f) => /\(audio\)\.m4a$/.test(f)), files);

  // ---- TS HLS stays .ts ----
  const id2 = engine.start(DL.base + "/fx/hls/master.m3u8", { mode: "hls", title: "Transport stream" });
  const d2 = await DL.until(id2, ["completed", "failed"], { timeout: 90000 });
  check("a TS stream without ffmpeg is saved as .ts", d2.state === "completed" && /\.ts$/.test(d2.filename), [d2.state, d2.filename, d2.note]);
  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(700);
  await spike.capture("noffmpeg-2-panel-note");
  spike.press("Escape");
  await waitFor(() => !ui.panel.open, { what: "the panel to close" });

  // ---- Settings › Video downloads ----
  const settings = b.service("settings");
  if (!settings) {
    log("the settings module is not in this build: settings page not checked");
    return;
  }
  settings.open("video-downloads");
  await sleep(1200);
  const page = () => b.root.querySelector(".vd-ff-missing, .vs-row .vs-path");
  check("Settings › Video downloads says ffmpeg is not found", /ffmpeg not found/.test(page()?.textContent ?? ""), page()?.textContent);
  await spike.capture("noffmpeg-3-settings-missing");
  b.sys("VitreSettings").set({ ffmpegPath: m.ffmpeg });
  await waitFor(() => /Using/.test(page()?.textContent ?? ""), { timeout: 5000, what: "the settings page to update" });
  check("choosing a path is shown at once", (page()?.textContent ?? "").includes(m.ffmpeg), page()?.textContent);
  check("the engine uses it", (await engine.ffmpeg()).source === "settings");
  await spike.capture("noffmpeg-4-settings-found");
  settings.close?.();
});
