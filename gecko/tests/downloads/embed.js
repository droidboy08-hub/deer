// An embedded player from another site (a page on localhost, its player an iframe from 127.0.0.1):
//   1. the player's CDN has hotlink rules (403 unless the Referer is the player's site, segments labelled
//      image/jpeg, as embed CDNs serve them): the offer is refused as the tab's page, asked again as the
//      player's frame, and the download (180p, AES-128, its key behind the same rule) goes out as the
//      frame too and completes; the download's source stays the tab's page;
//   2. control: an embedded player whose server takes the tab's page: everything goes out as the tab's
//      page, exactly as before the fix (one request per playlist, no frame identity).
// Real case: www.1flex.org/play?... embeds www.viduki.net, whose HLS CDN answers 403 to any other Referer.
/* global spike, Services, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const port = Number(Services.env.get("VITRE_DL_PORT"));
  const top = (hot) => `http://localhost:${port}/embed-top.html?hot=${hot}`;
  const player = `http://127.0.0.1:${port}/`;
  const mark = () => b.bar.downloadMark();
  // Deer's own requests ask for identity encoding (net.ts); the player's fetches do not.
  const deerRequests = async (prefix) => (await DL.stats()).requests.filter((r) => r.path.startsWith(prefix) && r.ae === "identity");

  // ---- 1. a hotlink-protected embed ----
  await DL.reset();
  await DL.open(top(1), { settle: 1500 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 10000, what: "the download mark" });
  const seen = engine.media.candidates(b.active().browser.browserId);
  check("the player's playlists are detected, as the frame's", seen.length >= 1 && seen.every((c) => c.kind === "hls" && c.frameUrl.startsWith(player)), seen);
  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 15000, what: "the picker" });
  await sleep(500);
  await spike.capture("embed-1-picker");
  const picker = ui.video.picker.element;
  check("the picker offers the ladder (360p, 180p)", picker.querySelectorAll(".vd-opt").length === 2, picker.textContent);
  const masters = await deerRequests("/hot/fx/hls/master.m3u8");
  log("master requests", masters.map((r) => [r.referer, r.origin]));
  check("asked as the tab's page first: refused", masters.length >= 2 && masters[0].referer.startsWith(`http://localhost:${port}/`) && masters[0].status === 403, masters);
  check("then asked as the player's frame: served", masters.some((r) => r.referer.startsWith(player)));

  spike.click(picker.querySelectorAll(".vd-opt")[1]);
  await sleep(150);
  spike.click(picker.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).find((v) => v.quality === "180p"), { timeout: 5000, what: "the 180p download" });
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 90000 });
  check("the download completed", done.state === "completed", done.error);
  check("its source is the tab's page; only its requests name the player", done.pageUrl === top(1) && engine.get(dl.id)?.pageUrl === top(1), done.pageUrl);
  const media = await deerRequests("/hot/fx/hls/v180/");
  check("every playlist, key and segment request went out as the player's frame", media.length > 5 && media.every((r) => r.referer.startsWith(player) && r.status !== 403), media.map((r) => [r.path, r.status, r.referer]).slice(0, 6));
  const p = await DL.probe(done.path);
  const kinds = (p?.streams ?? []).map((s) => s.codec_name).sort().join(",");
  check("the file is the 24 s video with sound", kinds === "aac,h264" && Math.abs(Number(p.format.duration) - 24) < 1, [kinds, p?.format?.duration]);
  await waitFor(() => !ui.video.picker.isOpen, { timeout: 4000, what: "the picker to close" }).catch(() => null);

  // ---- 2. control: an embed whose server takes the tab's page ----
  await DL.reset();
  await DL.open(top(0), { settle: 1500 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 10000, what: "the download mark (control)" });
  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 15000, what: "the picker (control)" });
  const offer = ui.video.picker.offer; // private in TypeScript, readable here
  const masters2 = await deerRequests("/fx/hls/master.m3u8");
  log("control master requests", masters2.map((r) => [r.referer, r.origin, r.status]));
  check("control: one request, as the tab's page (unchanged)", masters2.length === 1 && masters2[0].referer.startsWith(`http://localhost:${port}/`) && masters2[0].status !== 403, masters2);
  check("control: no frame identity on the offer", !!offer && offer.state === "ok" && !offer.requestPage, offer && [offer.state, offer.requestPage]);
  await spike.capture("embed-2-control-picker");
});
