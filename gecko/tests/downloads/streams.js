// Streams through the UI and the engine, with ffmpeg from the settings path:
//   1. a page whose player fetched an HLS master: the download mark in the pill, the pill on hover,
//      the picker (360p / 180p), the 180p rendition (AES-128) downloaded and repackaged as MP4;
//   2. fMP4 HLS with a separate audio rendition: one MP4 with video and sound;
//   3. DASH (SegmentTemplate + SegmentTimeline): the best video joined with the audio;
//   4. a crawling segment raced by a second request; 5. an expired segment address (403) fetched
//      again from a refreshed playlist (matched by media sequence);
//   6. Ctrl+Shift+D on a DASH page opens the picker with the DASH ladder.
/* global spike, Services, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const ff = await engine.ffmpeg();
  check("ffmpeg is found through the settings path", ff.source === "settings" && !!ff.path, ff);

  // ---- 1. HLS through the pill and the picker ----
  await DL.open(DL.base + "/video-slow.html", { settle: 1500 });
  const tab = b.active();
  await waitFor(() => !b.bar.downloadMark()?.classList.contains("empty"), { timeout: 8000, what: "the download mark" });
  check("the active pill shows the download mark while the page has media", !b.bar.downloadMark().classList.contains("empty"));
  await spike.capture("streams-1-mark");
  const hover = await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  log("hover", hover);
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 8000, what: "the pill on the video" });
  const st1 = ui.video.state;
  const box = tab.browser.getBoundingClientRect();
  const [vx, vy, vw] = hover.rect;
  check("the pill sits in the video's top-right corner, 12 px in", Math.abs(st1.rect.right - (box.left + vx + vw - 12)) < 2 && Math.abs(st1.rect.top - (box.top + vy + 12)) < 2, { pill: [st1.rect.left, st1.rect.top, st1.rect.width], video: hover.rect });
  check("the pill offers the best quality for this screen", /360p/.test(b.root.querySelector(".vd-pill .q")?.textContent ?? ""), b.root.querySelector(".vd-pill")?.textContent);
  check("the offer is the HLS ladder", st1.offer?.options.map((o) => o.label).join(",") === "360p,180p", st1.offer?.options.map((o) => o.label));
  await spike.capture("streams-2-pill-found");
  spike.click(b.root.querySelector(".vd-pill-main"));
  await waitFor(() => ui.video.picker.isOpen, { what: "the picker" });
  await sleep(600);
  await spike.capture("streams-3-picker");
  const picker = ui.video.picker.element;
  check("the picker lists both qualities with 'Best for this screen' on the suggestion", picker.querySelectorAll(".vd-opt").length === 2 && /Best for this screen/.test(picker.textContent), picker.textContent);
  check("no ffmpeg line when ffmpeg is there", picker.querySelector(".vd-mux").hidden);
  // Pick 180p (the AES-128 rendition) and download.
  spike.click(picker.querySelectorAll(".vd-opt")[1]);
  await sleep(150);
  check("the button follows the choice", /Download 180p/.test(picker.querySelector(".vd-go").textContent), picker.querySelector(".vd-go").textContent);
  spike.click(picker.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).find((v) => v.quality === "180p"), { timeout: 5000, what: "the 180p download" });
  await waitFor(() => ui.video.state.mode === "downloading" && engine.get(dl.id).received > 0, { timeout: 15000, what: "the pill to show progress" });
  await sleep(500);
  await spike.capture("streams-4-pill-downloading");
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 90000 });
  check("the HLS download completed", done.state === "completed", done.error);
  check("it was repackaged as .mp4", /\.mp4$/.test(done.filename), done.filename);
  await waitFor(() => ui.video.state.mode === "saved", { timeout: 4000, what: "the Saved pill" });
  await spike.capture("streams-5-pill-saved");
  const p1 = await DL.probe(done.path);
  log("probe 180p", p1);
  const kinds1 = (p1?.streams ?? []).map((s) => s.codec_name).sort().join(",");
  check("the 180p file has h264 video and aac sound, 24 s", kinds1 === "aac,h264" && Math.abs(Number(p1.format.duration) - 24) < 1, [kinds1, p1?.format?.duration]);
  check("no part files are left", !(await DL.files()).some((f) => /\.part$|\.d$/.test(f)), await DL.files());

  // ---- 2. fMP4 HLS with a separate audio rendition ----
  const id2 = engine.start(DL.base + "/fx/hlsfmp4/master.m3u8", { mode: "hls", title: "fMP4 with separate audio", pageUrl: DL.base + "/video-fmp4.html" });
  const d2 = await DL.until(id2, ["completed", "failed"], { timeout: 90000 });
  check("fMP4 + separate audio completed", d2.state === "completed" && /\.mp4$/.test(d2.filename), [d2.state, d2.filename, d2.error]);
  const p2 = await DL.probe(d2.path);
  const kinds2 = (p2?.streams ?? []).map((s) => s.codec_type).sort().join(",");
  check("it is one MP4 with video and sound joined", kinds2 === "audio,video" && Math.abs(Number(p2.format.duration) - 24) < 1, [kinds2, p2?.format?.duration]);

  // ---- 3. DASH: best video + audio, joined ----
  const id3 = engine.start(DL.base + "/fx/dash/manifest.mpd", { mode: "dash", title: "DASH sample", pageUrl: DL.base + "/video-dash.html" });
  const d3 = await DL.until(id3, ["completed", "failed"], { timeout: 90000 });
  check("DASH completed", d3.state === "completed" && /\.mp4$/.test(d3.filename), [d3.state, d3.filename, d3.error]);
  const p3 = await DL.probe(d3.path);
  const kinds3 = (p3?.streams ?? []).map((s) => s.codec_type).sort().join(",");
  check("the DASH video and audio are joined into one MP4", kinds3 === "audio,video" && Math.abs(Number(p3.format.duration) - 24) < 1, [kinds3, p3?.format?.duration]);
  check("each finished stream carries the Mark of the Web", /ZoneId=3/.test(await DL.motw(d3.path)));

  // ---- 4. a slow segment is raced by a second request ----
  await DL.reset();
  const t5 = Date.now();
  const id5 = engine.start(DL.base + "/hedge/fx/hls/v360/index.m3u8", { mode: "hls", title: "Raced segment" });
  const d5 = await DL.until(id5, ["completed", "failed"], { timeout: 60000 });
  const took5 = (Date.now() - t5) / 1000;
  const st5 = await DL.stats();
  const seg5 = st5.requests.filter((r) => r.path.includes("seg005"));
  check("a crawling segment is raced and the stream does not wait for it", d5.state === "completed" && seg5.length >= 2 && took5 < 15, { state: d5.state, requests: seg5.length, secs: took5 });

  // ---- 5. an expired segment address is looked up again in a fresh playlist ----
  await DL.reset();
  const id6 = engine.start(DL.base + "/token/fx/hls/v360/index.m3u8", { mode: "hls", title: "Expiring addresses" });
  const d6 = await DL.until(id6, ["completed", "failed"], { timeout: 60000 });
  const st6 = await DL.stats();
  const lists = st6.requests.filter((r) => r.path.includes("index.m3u8")).length;
  const refused = st6.requests.filter((r) => r.status === 403).length;
  check("a segment refused with 403 is fetched again from a refreshed playlist", d6.state === "completed" && lists >= 2 && refused >= 1, { state: d6.state, error: d6.error, playlists: lists, refused });
  const p6 = await DL.probe(d6.path);
  check("the refreshed stream is complete (24 s)", Math.abs(Number(p6?.format?.duration) - 24) < 1, p6?.format?.duration);

  // ---- 6. Ctrl+Shift+D on a DASH page ----
  await DL.open(DL.base + "/video-dash.html", { settle: 1500 });
  spike.press("Ctrl+Shift+D");
  await waitFor(() => ui.video.picker.isOpen, { timeout: 8000, what: "the picker from Ctrl+Shift+D" });
  await sleep(600);
  const labels = Array.from(ui.video.picker.element.querySelectorAll(".vd-opt .lbl")).map((x) => x.textContent);
  check("Ctrl+Shift+D opens the picker with the DASH options", labels.join(",") === "360p,M4A", labels);
  await spike.capture("streams-6-picker-dash");
  spike.press("Escape");
  await waitFor(() => !ui.video.picker.isOpen, { what: "Esc to close the picker" });
  log("files", await DL.files());
});
