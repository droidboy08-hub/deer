// The engine on a local throttled Range server: a 256 MiB file on 8 connections (sha256), one socket
// per lane, pause and resume (If-Range, no byte fetched twice), the speed limit, and the panel and
// ring while it runs (captures against the Downloads and Home boards).
/* global spike, Services, Ci, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  check("the downloads module installed", b.modules.includes("downloads"), b.moduleErrors);
  check("the 'downloads' service is provided", typeof b.service("downloads")?.download === "function");
  check("the engine's take-over points Firefox at the scratch folder", Services.prefs.getStringPref("browser.download.dir", "") === engine.scratch && Services.prefs.getIntPref("browser.download.folderList") === 2, engine.scratch);
  check("no global per-host connection pref is set", !Services.prefs.prefHasUserValue("network.http.max-persistent-connections-per-server"));

  // ---- 1. 256 MiB on 8 connections, each throttled to 4 MB/s ----
  await DL.open(DL.base + "/page.html");
  await DL.reset();
  const t0 = Date.now();
  const id = engine.start(`${DL.base}/blob/big?rate=4096`, { pageUrl: DL.base + "/page.html" });
  await DL.until(id, ["downloading"], { test: (v) => v.received > 32 << 20, timeout: 30000, what: "32 MB of the big file" });
  const info = engine.transferInfo(id);
  log("live transfer", info);
  const mid = DL.view(id);
  check("8 connections receive at once", info && info.live >= 8, info);
  check("each connection has its own socket (lanes)", info && info.sockets >= 8, info);
  check("the view reports 8 connections and 8 segment fills", mid.maxConnections === 8 && mid.segments.length === 8, { max: mid.maxConnections, segs: mid.segments.length });
  const P = Ci.nsITaskbarProgress;
  const tb = DL.ui().taskbar;
  check("the taskbar button shows the progress", tb.state === P.STATE_NORMAL && tb.total === m["big.bin"].size && tb.done > 0, tb);
  // The ring shows over the page while it downloads.
  await spike.capture("engine-1-ring-over-page");
  const ui = DL.ui();
  check("the ring is shown over the page", ui.ring.isShown);
  // The panel (Ctrl+J) with the running download selected.
  spike.press("Ctrl+J");
  await spike.waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(700);
  await spike.capture("engine-2-panel-downloading");
  const panelEl = b.root.querySelector(".vd-panel");
  const pr = panelEl.getBoundingClientRect();
  check("the panel is 960x688, centred", Math.round(pr.width) === 960 && Math.round(pr.height) === 688 && Math.abs(pr.left - (window.innerWidth - 960) / 2) < 1.5, [pr.left, pr.top, pr.width, pr.height]);
  check("the details show 8 connection blocks", b.root.querySelectorAll(".vd-details .vd-segs > span").length === 8);
  const done = await DL.until(id, ["completed", "failed"], { timeout: 120000, what: "the big file to finish" });
  const secs = (Date.now() - t0) / 1000;
  check("the big file completed", done.state === "completed", done.error);
  const sha = await DL.sha256(done.path);
  check("sha256 of the 256 MiB file matches", sha === m["big.bin"].sha256, { sha, secs });
  const st = await DL.stats();
  const ranged = st.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end - r.start > 0);
  const ports = new Set(ranged.map((r) => r.port));
  check("the server saw 8 parallel transfers on 8 sockets", st.peak >= 8 && ports.size >= 8, { peak: st.peak, sockets: ports.size, requests: ranged.length, secs });
  check("bytes on the wire = the file size (no overlap)", ranged.reduce((n, r) => n + (r.sent || 0), 0) === m["big.bin"].size, ranged.reduce((n, r) => n + (r.sent || 0), 0));
  check("Referer is the page on every ranged request", ranged.every((r) => r.referer === DL.base + "/page.html"));
  check("no .part file is left", !(await IOUtils.exists(done.path + ".part")));
  check("the finished file carries the Mark of the Web", /ZoneId=3/.test(await DL.motw(done.path)));
  await sleep(400);
  await spike.capture("engine-3-panel-completed");

  // ---- 2. pause and resume ----
  await DL.reset();
  const id2 = engine.start(`${DL.base}/blob/big?rate=2048`, { filename: "pause-resume.bin", named: true });
  await DL.until(id2, ["downloading"], { test: (v) => v.received > 60 << 20, timeout: 60000, what: "60 MB before the pause" });
  engine.pause(id2);
  const paused = await DL.until(id2, ["paused"], { timeout: 10000 });
  await sleep(1200);
  const st2 = await DL.stats();
  check("pausing stops every connection", st2.active === 0, st2.active);
  check("the paused download keeps its bytes and segments", paused.received > 60 << 20 && paused.segments.some((x) => x > 0), paused.received);
  await sleep(300);
  check("the taskbar button turns to paused", DL.ui().taskbar.state === Ci.nsITaskbarProgress.STATE_PAUSED, DL.ui().taskbar);
  await spike.capture("engine-4-panel-paused");
  const before = paused.received;
  await DL.reset();
  engine.resume(id2);
  const done2 = await DL.until(id2, ["completed", "failed"], { timeout: 120000, what: "the resumed file" });
  check("the resumed download completed", done2.state === "completed", done2.error);
  check("sha256 after pause and resume matches", (await DL.sha256(done2.path)) === m["big.bin"].sha256);
  const st3 = await DL.stats();
  const after = st3.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end > r.start);
  check("every request after the resume carries If-Range", after.length > 0 && after.every((r) => r.ifrange), after.length);
  const fetched = after.reduce((n, r) => n + (r.sent || 0), 0);
  check("the resume fetched only what was missing", Math.abs(fetched - (m["big.bin"].size - before)) < 64 * 1024 * 1024 && fetched < m["big.bin"].size - before + 1, { fetched, missing: m["big.bin"].size - before });

  // ---- 3. the speed limit (Settings › Downloads, shared by every download) ----
  // 256 MiB at 16 MB/s: 16 s. (Short transfers run a little fast: half a second of burst plus what
  // the 8 sockets had buffered when the first wait came; the spike measured the same.)
  b.sys("VitreSettings").set({ speedLimitKBps: 16384 });
  await DL.reset();
  const t3 = Date.now();
  const id3 = engine.start(`${DL.base}/blob/big`, { filename: "limited.bin", named: true });
  const done3 = await DL.until(id3, ["completed", "failed"], { timeout: 90000 });
  const took = (Date.now() - t3) / 1000;
  check("256 MiB at a 16 MB/s limit is never faster than the limit (about 16 s)", done3.state === "completed" && took > 14.5 && took < 40, took);
  b.sys("VitreSettings").set({ speedLimitKBps: 0 });
  check("the limited file is intact", (await DL.sha256(done3.path)) === m["big.bin"].sha256);
  spike.press("Escape");
  await spike.waitFor(() => !ui.panel.open, { what: "Esc to close the panel" });
  check("Esc closes the panel", !ui.panel.open);
});
