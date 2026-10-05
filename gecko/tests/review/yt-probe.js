// Diagnostic, not a product test: how YouTube's player fetches its media in Vitre today, what the
// media watcher records, and what the picker would offer. Nothing is saved.
//   python tools/run.py --test tests/review/yt-probe.js --name yt-probe --timeout 150
/* global spike, Services, Ci, gBrowser */
spike.main(async () => {
  const { log, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const b = window.vitre;
  const seen = [];
  const obs = {
    observe(subject) {
      try {
        const ch = subject.QueryInterface(Ci.nsIHttpChannel);
        const u = ch.URI.spec;
        if (!/googlevideo\.com|\/videoplayback|youtube\.com\/(youtubei|api\/manifest)/.test(u)) return;
        let ct = "";
        try {
          ct = ch.getResponseHeader("content-type");
        } catch {}
        let len = "";
        try {
          len = ch.getResponseHeader("content-length");
        } catch {}
        const q = new URL(u).searchParams;
        seen.push({
          host: ch.URI.host,
          path: ch.URI.filePath.slice(0, 40),
          method: ch.requestMethod,
          status: ch.responseStatus,
          ct,
          len,
          itag: q.get("itag"),
          mime: q.get("mime"),
          clen: q.get("clen"),
          range: q.get("range"),
          sabr: q.get("sabr"),
          ump: q.get("ump"),
          rn: q.get("rn"),
          dur: q.get("dur"),
        });
      } catch {}
    },
  };
  Services.obs.addObserver(obs, "http-on-examine-response");
  b.navigate(b.active(), "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  await sleep(14000);
  await spike.capture("yt-1");
  // Start playback if autoplay was blocked (a click on the player).
  const br = gBrowser.selectedBrowser;
  const r = br.getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(r.left + 400, r.top + 300, {}, window);
  await sleep(12000);
  await spike.capture("yt-2");
  Services.obs.removeObserver(obs, "http-on-examine-response");
  const byKind = {};
  for (const s of seen) {
    const k = `${s.method} ${s.host.replace(/^[^.]*\./, "*.")} ${s.path} ct=${s.ct} sabr=${s.sabr} ump=${s.ump}`;
    byKind[k] = (byKind[k] || 0) + 1;
  }
  log("REQUEST KINDS " + JSON.stringify(byKind, null, 1));
  log("SAMPLE " + JSON.stringify(seen.filter((s) => s.itag).slice(0, 6), null, 1));
  const engine = b.sys("VitreDownloads");
  const id = br.browsingContext.browserId;
  log("NOTICE " + JSON.stringify(engine.media.notice(id)));
  try {
    log("CANDIDATES " + JSON.stringify(engine.media.candidates(id).map((c) => ({ kind: c.kind, url: c.url.slice(0, 120), bytes: c.bytes, frameUrl: c.frameUrl }))));
  } catch (e) {
    log("CANDIDATES error " + e);
  }
  const video = await b.page(b.active()).query("downloads:main-video").catch((e) => "err " + e);
  log("MAIN VIDEO " + JSON.stringify(video)?.slice(0, 400));
});
