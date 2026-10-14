// Phase 4 of spikes/downloader/RESUME-DESIGN.md (section 7; G4 "Restarts, sleep and lost internet"), against
// the local server's /net, /drop and /busy routes (tests/downloads/server.py) and hard kills (spike.kill(),
// run.py's @@kill: every runtime process terminated, then a start on the same profile):
//   - drop: /drop?for=60 cuts a running download's connections and refuses new ones: it reads Waiting for
//     network (paused, wait 'network'; the speed and time a dash, "Continues when the connection is back",
//     Try now; the ring "Downloads, 1 waiting, N percent"), every saved byte where its segment says; the
//     tries come 10 s, then 30 s apart; once the network is back, Try now continues it from its segments:
//     only what was missing is fetched, sha256 equal;
//   - checking: a resume whose check takes a while reads Checking after 400 ms (the bar dimmed at its old
//     percentage, "Checking the saved part and the link"), never "Starting";
//   - offline: Firefox switched offline (Services.io.offline, localhost included) while a download runs (its
//     connections cut at the same moment: Necko keeps open sockets when it goes offline, only new ones
//     fail): Waiting for network, the tries only counted (nothing reaches the server); switched back online,
//     the next try comes within 5 s and it completes intact;
//   - busy: the site answers 503 for 90 s: Retrying ("Retrying · in N s", "The site had a problem (503).
//     Trying again at HH:MM", Try now), never Failed, then it completes intact; its first run asks 3 times,
//     each try of the wait once (a wait's try stops its check at the first 503);
//   - long: a 503 with Retry-After: 3600 stops the run at its first answer: Retrying, the next try an hour
//     away; Try now completes it;
//   - alternate: a site that answers 503, then drops the connections, then 503 again: one count (try 1, 2,
//     3; the next 10 s, 30 s, 1 min later), the 503's clock kept through the network failure; 24 h after
//     the first 503 the next one fails the row with today's sentence (waits brought forward by hand);
//   - fatal: failures no wait can fix (a port Gecko blocks, a redirect loop, two Content-Length headers
//     that disagree) fail as before Phase 4, never Waiting for network;
//   - sleep: sleep_notification pauses the running download into wait 'sleep' (the store says so);
//     wake_notification: it waits, then continues about 10 s later, through its resume probe; a sleep and a
//     wake followed by a network link-up continue at once. Gecko's timer thread stops at sleep_notification
//     until wake_notification (TimerThread::DoBeforeSleep), as in a real sleep: nothing in between waits on
//     a timer;
//   - pauseall: a waiting row counts as under way (the ring stays, "1 waiting", Pause all), and Pause all
//     ends its wait;
//   - run 2, after a restart: the download the quit stopped continues by itself about 10 s after the start
//     ("Continued after restart") and completes intact; the one the person paused stays paused. Then, with
//     "Continue unfinished downloads when Deer starts" off, the quit prompt says the download pauses to be
//     resumed from Downloads; run 3: a download that went through Retrying and continued stays paused like
//     any other the quit stopped, while one whose automatic try was still on its check at the quit (it never
//     held the quit back) comes back waiting and continues by its wait, the setting off;
//   - run 4, after a hard kill: the last session read as unclean; the row that was running comes back with
//     the last 8 MiB below each segment's mark given back, continues by itself, fetches those again (bytes
//     corrupted there, as writes the disk never got, are replaced: sha256 equal) and says so in its history;
//     a try the kill caught on its check comes back waiting (no suspect tail) and continues by its wait;
//   - run 5, a hard kill between a stream's merge and the save that completes it: completed from the output
//     at the start, nothing fetched again;
//   - run 6, a hard kill once a stream's merge phase was saved, before ffmpeg ran: merged again from its parts
//     when it continues, nothing fetched again;
//   - run 7, a hard kill once the merge's output was moved into place, before its audio part was removed:
//     completed from that output at the start, no second copy, nothing fetched again.
// VITRE_DL_ONLY=a,b runs only those sections of run 1: drop, checking, offline, busy, long, alternate, fatal,
// sleep, pauseall; and restarts for the quit, restart and kill runs (left out, run 1 ends after its sections).
/* global spike, Services, Cc, Ci, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
const engine0 = () => DL.engine;

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  log("run", spike.run);
  const m = await DL.init();
  log("engine ready; the last session ended", engine0().prevClean ? "clean" : "unclean");
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const settings = b.sys("VitreSettings");
  const MiB = 1 << 20;
  const TAIL = 8 * MiB;
  const store = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
  const medium = m["medium.bin"];
  const big = m["big.bin"];
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const PREF = "vitre.test.network";
  const saved = () => JSON.parse(Services.prefs.getStringPref(PREF, "{}"));
  const remember = (o) => Services.prefs.setStringPref(PREF, JSON.stringify({ ...saved(), ...o }));
  /** A fixture behind /net/ under its own key. */
  const net = (k, rate = 1024, f = "medium") => `${DL.base}/net/${f}?k=${k}&rate=${rate}`;
  const control = async (route) => (await fetch(DL.base + route, { cache: "no-store" })).json();
  const rec = (id) => engine.recs.find((r) => r.id === id);
  /** Paused in a wait of that kind, its run over. */
  const waitingIn = (id, what, timeout = 60000) => DL.until(id, ["paused"], { test: (v) => v.wait?.for === what && !engine.transferInfo(id), timeout, what: `the ${what} wait` });
  /** A wait's next try now (the schedule itself is checked in drop and busy): the wait timer runs it at once. */
  const bring = async (id) => {
    const r = rec(id);
    r.wait = { ...r.wait, nextAt: Date.now() };
    await engine.save(true);
  };
  const row = (id) => b.root.querySelector(`.vd-row[data-id="${id}"]`);
  const text = (el) => el?.textContent ?? "";
  /** The panel open with the row selected (its details shown). */
  const showRow = async (id) => {
    ui.panel.show(id);
    await waitFor(() => ui.panel.open && !!row(id), { what: "the panel with the row" });
    await sleep(600);
  };
  const hidePanel = async () => {
    if (!ui.panel.open) return;
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    await sleep(200);
  };
  /** Bytes the server sent for these requests (ranges after a resume's probe, which carries window 0). */
  const sentAfterProbe = (reqs) => reqs.filter((r) => r.status === 206 && r.range !== "bytes=0-65535").reduce((n, r) => n + (r.sent || 0), 0);
  /** Every segment claims exactly the fixture's bytes in the .part. */
  const claimsTrue = async (id, fixture) => {
    const r = rec(id);
    const part = r.path + ".part";
    for (const s of r.file.segments) {
      if (!s.received) continue;
      const ours = await IOUtils.read(part, { offset: s.start, maxBytes: s.received });
      const theirs = await IOUtils.read(PathUtils.join(DL.fix, fixture), { offset: s.start, maxBytes: s.received });
      if (ours.length !== theirs.length) return false;
      for (let i = 0; i < ours.length; i++) if (ours[i] !== theirs[i]) return false;
    }
    return true;
  };
  /** Bytes written into a file at an offset (what a lost write leaves: other bytes under the claims). */
  const writeAt = (path, offset, bytes) => {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(file, 0x02, 0o644, 0);
    s.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, offset);
    const out = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    out.setOutputStream(s);
    out.writeByteArray(bytes);
    out.close();
  };
  /** When this process started: requests the server logged since then. */
  const startedAt = Services.startup.getStartupInfo().process.getTime();
  const since = async (prefix) => (await DL.stats()).requests.filter((r) => r.path.startsWith(prefix) && r.t * 1000 >= startedAt - 500);
  /** The requests for one /net/ key since this process started. */
  const asked = async (k, f = "medium") => (await since(`/net/${f}`)).filter((q) => q.path.includes(`k=${k}&`));
  /** How long after the engine started a row left 'paused' (a wait's try, or a continue after the start). */
  const leftPausedAt = (id, timeout = 20000) => waitFor(() => (engine.get(id)?.state !== "paused" ? Date.now() - engine.loadedAt : null), { timeout, interval: 100, what: "the row to continue" });
  const events = (id) => (rec(id)?.events ?? []).map((e) => e.text);

  // ---- run 7: a hard kill once the merge's output was in place, its audio part not yet removed ----
  if (spike.run === 7) {
    const { s3, out3, base3 } = saved();
    const done = await DL.until(s3, ["completed", "failed"], { timeout: 20000, what: "the stream to complete from its output" });
    check("run 7: a stream killed once its merged output was in place, its audio part still there, is completed from that output at the start", done.state === "completed" && done.path === out3 && !rec(s3).stream.phase, [done.state, done.path, out3, done.error]);
    const fetched = await since("/fx/hlsfmp4");
    check("... with nothing fetched again", fetched.length === 0, fetched.map((r) => r.path));
    const names = (await IOUtils.getChildren(PathUtils.parent(out3))).map((p) => PathUtils.filename(p)).filter((n) => n.startsWith("Crash after the move"));
    check("... no second copy is made (no ' (1)'), and the part left goes", names.length === 1 && !(await IOUtils.exists(base3 + ".audio.part")) && !(await IOUtils.exists(base3 + ".video.part")), names);
    return;
  }

  // ---- run 6: a hard kill after the merge phase was saved, before ffmpeg ran ----
  if (spike.run === 6) {
    const { s2 } = saved();
    const v0 = engine.get(s2);
    const r0 = rec(s2);
    const base = r0?.stream?.mergeBase ?? "";
    check("run 6: the stream killed before its merge comes back paused, marked to continue, its parts there", v0?.state === "paused" && !!r0?.resumeOnStart && r0?.stream?.phase === "merging" && !!base && (await IOUtils.exists(base + ".video.part")), { state: v0?.state, flag: r0?.resumeOnStart, phase: r0?.stream?.phase, base });
    const done = await DL.until(s2, ["completed", "failed"], { timeout: 60000, what: "the merge to run again" });
    const at = Date.now() - engine.loadedAt;
    check("... it continues by itself after the start and the merge runs again: completed as one MP4", done.state === "completed" && /\.mp4$/.test(done.filename) && at >= 9500, [done.state, done.filename, done.error, at]);
    const fetched = await since("/fx/hlsfmp4");
    check("... with nothing fetched again (the parts are the whole download)", fetched.length === 0, fetched.map((r) => r.path));
    const p = await DL.probe(done.path);
    const kinds = (p?.streams ?? []).map((s) => s.codec_type).sort().join(",");
    check("... video and sound joined, 24 s", kinds === "audio,video" && Math.abs(Number(p?.format?.duration) - 24) < 1, [kinds, p?.format?.duration]);
    check("... and no part is left", !(await IOUtils.exists(base + ".video.part")) && !(await IOUtils.exists(base + ".audio.part")) && !(await IOUtils.exists(base + ".merge.part")));
    for (const v of engine.list()) if (!["completed", "failed", "cancelled"].includes(v.state)) engine.cancel(v.id);
    // Review of Phase 4: a kill once the merged output was moved into place, before its parts were removed.
    // What finish() leaves there is made by hand: the output (the video part copied to it), the video part
    // removed, the audio part kept (run 7).
    const s3 = engine.start(DL.base + "/fx/hlsfmp4/master.m3u8", { mode: "hls", title: "Crash after the move", pageUrl: DL.base + "/video-fmp4.html" });
    remember({ s3 });
    engine.hooks.beforeMerge = async (id) => {
      if (id !== s3) return;
      const s = rec(s3).stream;
      await IOUtils.copy(s.mergeBase + ".video.part", s.mergeOut);
      await IOUtils.remove(s.mergeBase + ".video.part");
      remember({ out3: s.mergeOut, base3: s.mergeBase });
      log("killing with the output in place and the audio part left");
      await spike.kill();
    };
    await DL.until(s3, ["completed", "failed"], { timeout: 90000, what: "the kill after the move" });
    check("run 6: the kill after the move happened", false, engine.get(s3));
    return;
  }

  // ---- run 5: a hard kill between a stream's merge and its save ----
  if (spike.run === 5) {
    const { s1 } = saved();
    const done = await DL.until(s1, ["completed", "failed"], { timeout: 20000, what: "the merged stream to complete" });
    check("run 5: the stream killed between its merge and its save is completed from its output at the start", done.state === "completed" && /\.mp4$/.test(done.filename) && (await IOUtils.exists(done.path)) && !rec(s1).stream.phase, [done.state, done.filename, done.error]);
    const fetched = await since("/fx/hlsfmp4");
    check("... with nothing fetched again", fetched.length === 0, fetched.map((r) => r.path));
    const p = await DL.probe(done.path);
    const kinds = (p?.streams ?? []).map((s) => s.codec_type).sort().join(",");
    check("... the output is the joined video, 24 s", kinds === "audio,video" && Math.abs(Number(p?.format?.duration) - 24) < 1, [kinds, p?.format?.duration]);
    check("... with the Mark of the Web", /ZoneId=3/.test(await DL.motw(done.path)));
    // A stream whose merge phase is saved, then killed before ffmpeg runs (run 6).
    const s2 = engine.start(DL.base + "/fx/hlsfmp4/master.m3u8", { mode: "hls", title: "Crash before the merge", pageUrl: DL.base + "/video-fmp4.html" });
    remember({ s2 });
    engine.hooks.beforeMerge = async (id) => {
      if (id !== s2) return;
      log("killing once the merge phase is saved");
      await spike.kill();
    };
    await DL.until(s2, ["completed", "failed"], { timeout: 90000, what: "the kill before the merge" });
    check("run 5: the kill before the merge happened", false, engine.get(s2));
    return;
  }

  // ---- run 4: after a hard kill ----
  if (spike.run === 4) {
    const { k, marks, t2 } = saved();
    await control("/slow?for=0&k=k2");
    await control("/busy?for=0&k=k2");
    check("run 4: after a hard kill the engine read the last session as unclean", engine.prevClean === false, engine.prevClean);
    // Review of Phase 4: the try the kill caught on its check is still the wait, not a download that ran.
    const early = Date.now() - engine.loadedAt;
    const w0 = rec(t2);
    log("the try the kill caught", early, "ms after the start:", w0?.state, JSON.stringify(w0?.wait), "marked", !!w0?.resumeOnStart, "suspect", JSON.stringify(w0?.suspect));
    if (early < 4000) check("the try the kill caught on its check comes back waiting (its wait given back), not marked to continue, no suspect tail (it wrote nothing)", w0?.state === "paused" && w0.wait?.for === "server" && w0.wait.tries >= 1 && !w0.resumeOnStart && !w0.suspect, { state: w0?.state, wait: w0?.wait, flag: w0?.resumeOnStart, suspect: w0?.suspect });
    const r = rec(k);
    const back = marks.reduce((n, [, got]) => n + Math.min(got, TAIL), 0);
    const now = r?.file?.segments.map((s) => [s.start, s.received]);
    const rewound = marks.every(([start, got]) => now?.some(([s, g]) => s === start && g === Math.max(0, got - TAIL)));
    check("the row that was running comes back paused, marked to continue, the last 8 MiB below each segment's mark given back (suspect)", r?.state === "paused" && !!r.resumeOnStart && r.suspect?.bytes === back && rewound, { state: r?.state, flag: r?.resumeOnStart, suspect: r?.suspect, back, marks, now });
    // What a crash can leave: under the marks, bytes the disk never got. The last MiB below each mark is
    // made other bytes; only a refetch of the suspect tails puts the file right.
    const part = r.path + ".part";
    const junk = new Uint8Array(MiB).fill(0x5a);
    for (const [start, got] of marks) if (got >= MiB) writeAt(part, start + got - MiB, junk);
    const t2At = await leftPausedAt(t2);
    check("... it continues by its wait about 5 s after the start (before the 10 s of the restarted ones), with no history of a restart or a crash", t2At >= 4500 && t2At <= 9000 && !events(t2).some((e) => /^Continued after restart|^Checked after Deer closed/.test(e)), { t2At, events: events(t2) });
    const done = await DL.until(k, ["completed", "failed"], { timeout: 120000, what: "the killed download to continue and complete" });
    const at = (rec(k).events ?? []).find((e) => e.text === "Continued after restart")?.at - engine.loadedAt;
    check("it continues by itself about 10 s after the start (Continued after restart)", at >= 9500 && at <= 14000, at);
    check("it completes intact: the corrupted tails were fetched again (sha256 equal)", done.state === "completed" && (await DL.sha256(done.path)) === big.sha256, [done.state, done.error]);
    const reqs = await since("/net/big");
    const fetched = sentAfterProbe(reqs);
    const kept = marks.reduce((n, [, got]) => n + Math.max(0, got - TAIL), 0);
    const starts = marks.filter(([, got]) => got > 0).every(([start, got]) => reqs.some((q) => q.status === 206 && q.start === start + Math.max(0, got - TAIL)));
    check("only what was missing and the suspect tails were fetched again, each segment from 8 MiB below its mark", fetched === big.size - kept && starts, { fetched, expected: big.size - kept, ranges: reqs.map((q) => `${q.status} ${q.range}`) });
    const line = (done.history ?? []).map((h) => h.text).find((t) => t.startsWith("Checked after Deer closed unexpectedly"));
    check("its history says so: Checked after Deer closed unexpectedly · N fetched again", !!line && / · \d+(\.\d)? MB fetched again$/.test(line), done.history);
    const d2 = await DL.until(t2, ["completed", "failed"], { timeout: 60000, what: "the try the kill caught to complete" });
    check("... and the try the kill caught completes intact", d2.state === "completed" && (await DL.sha256(d2.path)) === medium.sha256, [d2.state, d2.error]);
    await showRow(k);
    await spike.capture("network-6-after-kill");
    await hidePanel();
    settings.set({ connections: 8 });
    // A stream killed between its merge and the save that completes it (run 5).
    const s1 = engine.start(DL.base + "/fx/hlsfmp4/master.m3u8", { mode: "hls", title: "Crash after the merge", pageUrl: DL.base + "/video-fmp4.html" });
    remember({ s1 });
    engine.hooks.afterMerge = async (id) => {
      if (id !== s1) return;
      log("killing between the merge and its save");
      await spike.kill();
    };
    await DL.until(s1, ["completed", "failed"], { timeout: 90000, what: "the kill after the merge" });
    check("run 4: the kill after the merge happened", false, engine.get(s1));
    return;
  }

  // ---- run 3: the setting off; then a hard kill ----
  if (spike.run === 3) {
    const { c, wt, pausedId } = saved();
    await control("/slow?for=0&k=r5");
    // Review of Phase 4: the try the quit stopped on its check is still the wait, which always continues.
    const v0 = engine.get(wt);
    log("the try the quit stopped", Date.now() - engine.loadedAt, "ms after the start:", v0?.state, JSON.stringify(v0?.wait), "marked", !!rec(wt)?.resumeOnStart);
    const wtAt = await leftPausedAt(wt);
    check("run 3: the try the quit stopped on its check came back waiting and continues by its wait about 5 s after the start, the setting off", wtAt >= 4500 && wtAt <= 9000 && !events(wt).includes("Continued after restart"), { wtAt, events: events(wt) });
    await waitFor(() => Date.now() - engine.loadedAt > 13000, { timeout: 30000, interval: 250, what: "13 s after the start" });
    check("with the setting off, the download the quit stopped stays paused (its mark gone), although it had gone through Retrying (its wait does not come back)", engine.get(c)?.state === "paused" && !engine.get(c).wait && !rec(c).resumeOnStart && !events(c).includes("Continued after restart"), { state: engine.get(c)?.state, wait: engine.get(c)?.wait, flag: rec(c)?.resumeOnStart });
    check("... and the one the person paused still is", engine.get(pausedId)?.state === "paused", engine.get(pausedId)?.state);
    const wd = await DL.until(wt, ["completed", "failed"], { timeout: 60000, what: "the try the quit stopped to complete" });
    check("... the try the quit stopped completes intact", wd.state === "completed" && (await DL.sha256(wd.path)) === medium.sha256, [wd.state, wd.error]);
    settings.set({ continueDownloadsOnStart: true });
    engine.cancel(c);
    engine.cancel(pausedId);
    // A hard kill while a download runs on 4 connections, 18 MiB or more in each segment, and while a
    // Retrying row's try hangs on its check (its answers come 5 min late).
    settings.set({ connections: 4 });
    await DL.reset();
    await control("/busy?for=9&k=k2");
    const t1 = Date.now();
    const t2 = engine.start(net("k2", 0), { filename: "try-at-crash.bin", named: true });
    const k = engine.start(net("k1", 2048, "big"), { filename: "killed.bin", named: true });
    await waitingIn(t2, "server", 30000);
    await control("/slow?for=300&k=k2&ms=300000");
    await waitFor(() => Date.now() - t1 > 9500, { timeout: 20000, interval: 200, what: "the end of the 503s" });
    await bring(t2);
    await DL.until(t2, ["downloading"], { timeout: 10000, what: "the try on its check" });
    await DL.until(k, ["downloading"], { test: (v) => v.received > 76 * MiB && !v.phase, timeout: 60000, what: "76 MiB before the kill" });
    // The network goes away first, so nothing moves after the last progress save: the store then holds
    // exactly what the kill leaves (its marks are what the next start reads).
    await control("/drop?for=8&k=k1");
    await sleep(2600);
    const st = await IOUtils.readJSON(store);
    const it = st.items.find((x) => x.id === k);
    const ti = st.items.find((x) => x.id === t2);
    check("before the kill the store says the session is not over (clean false) and the row runs", st.session?.clean === false && it?.state === "downloading", { session: st.session, state: it?.state });
    check("... and the try on its check is saved running with its wait (trying)", ti?.state === "downloading" && ti?.trying?.for === "server", { state: ti?.state, trying: ti?.trying });
    remember({ k, t2, marks: it.file.segments.map((s) => [s.start, s.received]) });
    log("marks before the kill", it.file.segments.map((s) => `${s.start}+${s.received}`));
    await spike.kill();
    return;
  }

  // ---- run 2: after a restart ----
  if (spike.run === 2) {
    const { stopped, pausedId } = saved();
    const s0 = engine.get(stopped);
    check("run 2: both come back with their bytes; the one the quit stopped is marked to continue, the paused one is not", s0?.received > 0 && engine.get(pausedId)?.received > 0 && (!!rec(stopped)?.resumeOnStart || s0.state !== "paused") && !rec(pausedId)?.resumeOnStart, { s0: s0?.state, flag: rec(stopped)?.resumeOnStart, p: rec(pausedId)?.resumeOnStart });
    await DL.until(stopped, ["downloading", "queued", "completed"], { timeout: 25000, what: "the stopped download to continue" });
    const at = (rec(stopped).events ?? []).find((e) => e.text === "Continued after restart")?.at - engine.loadedAt;
    check("the download the quit stopped continues by itself about 10 s after the start (Continued after restart)", at >= 9500 && at <= 14000, at);
    check("the one the person paused stays paused", engine.get(pausedId).state === "paused" && !engine.get(pausedId).wait, engine.get(pausedId).state);
    await showRow(stopped);
    check("its details say Continued after restart", /^Continued after restart (today|on)/.test(text(b.root.querySelector(".vd-d-note"))), text(b.root.querySelector(".vd-d-note")));
    await spike.capture("network-5-continued-after-restart");
    await hidePanel();
    const done = await DL.until(stopped, ["completed", "failed"], { timeout: 90000 });
    check("... and completes intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [done.state, done.error]);
    // With the setting off (run 3), review of Phase 4: a download that went through Retrying and continued
    // is past its check when the quit stops it, so it stays paused like any other; one whose automatic try
    // is still on its check (its answers come 3 min late) is still the wait: it never holds the quit back,
    // and continues by its wait after the start whatever the setting says.
    settings.set({ continueDownloadsOnStart: false });
    await DL.reset();
    await control("/busy?for=9&k=r3");
    await control("/busy?for=9&k=r5");
    const t0 = Date.now();
    const c = engine.start(net("r3", 128), { filename: "setting-off.bin", named: true });
    const wt = engine.start(net("r5", 0), { filename: "try-at-quit.bin", named: true });
    await waitingIn(c, "server", 30000);
    await waitingIn(wt, "server", 30000);
    await control("/slow?for=180&k=r5&ms=180000");
    await waitFor(() => Date.now() - t0 > 9500, { timeout: 20000, interval: 200, what: "the end of the 503s" });
    await bring(c);
    await bring(wt);
    await DL.until(c, ["downloading"], { test: (v) => v.received > 2 * MiB && !v.phase, timeout: 30000, what: "the download that continued after Retrying" });
    await DL.until(wt, ["downloading"], { timeout: 10000, what: "the try on its check" });
    check("a download that continued after Retrying is past its check: no wait kept on it", !rec(c).trying && !rec(c).wait, { trying: rec(c).trying, wait: rec(c).wait });
    check("a try still on its check keeps its wait on the record (trying) and never holds a quit back", rec(wt).trying?.for === "server" && engine.runningCount() === 1, { trying: rec(wt).trying, count: engine.runningCount() });
    // The quit prompt, the setting off: it no longer promises that the download continues by itself.
    const allowed = window.canQuitApplication("quit");
    await waitFor(() => ui.prompt.isOpen, { timeout: 5000, what: "the quit prompt" });
    const body = text(b.root.querySelector("#vd-quit-body"));
    check("the quit prompt, the setting off, counts only the running download and says it pauses to be resumed from Downloads", allowed === false && text(b.root.querySelector("#vd-quit-title")) === "A download is still running" && body === "If you quit now, it pauses. Resume it from Downloads the next time you open Deer.", [text(b.root.querySelector("#vd-quit-title")), body]);
    spike.press("Escape");
    await waitFor(() => !ui.prompt.isOpen, { timeout: 5000, what: "the prompt to close" });
    remember({ c, wt });
    await spike.restart();
    return;
  }

  // ---- run 1 ----
  await DL.open(DL.base + "/page.html");

  // ---- the network goes away: /drop?for=60 ----
  if (want("drop")) {
    await DL.reset();
    const id = engine.start(net("d1", 1024), { filename: "drop.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 4 * MiB && !v.phase, timeout: 30000, what: "4 MiB before the drop" });
    const t0 = Date.now();
    await control("/drop?for=60&k=d1");
    const w1 = await waitingIn(id, "network", 40000);
    log("waiting for network after", Date.now() - t0, "ms", w1.wait);
    check("drop: a network that went away makes it Waiting for network (paused, wait 'network'), never Failed", w1.wait.tries === 1 && !w1.need && !w1.error, w1.wait);
    const next1 = w1.nextAt - Date.now();
    check("... its next try about 10 s later", next1 > 6000 && next1 <= 10500, next1);
    check("... every segment claims exactly the bytes in its .part (each connection closed its writer first)", await claimsTrue(id, "medium.bin"));
    await showRow(id);
    const r = row(id);
    check("its row reads Waiting for network with a dash for speed and time", text(r.querySelector(".vd-status")) === "Waiting for network" && text(r.querySelector(".speed")) === "—" && text(r.querySelector(".time")) === "—", [text(r.querySelector(".vd-status")), text(r.querySelector(".speed")), text(r.querySelector(".time"))]);
    check("... its caption: Continues when the connection is back", text(b.root.querySelector(".vd-d-cap")) === "Continues when the connection is back", text(b.root.querySelector(".vd-d-cap")));
    check("... its verb is Try now", /^Try now drop\.bin$/.test(r.querySelector(".primary").getAttribute("aria-label")), r.querySelector(".primary").getAttribute("aria-label"));
    check("... its label says so", /^drop\.bin, Waiting for network, \d+ percent saved$/.test(r.getAttribute("aria-label")), r.getAttribute("aria-label"));
    await spike.capture("network-1-waiting-for-network");
    await hidePanel();
    check("the ring stays shown while it waits", ui.ring.isShown);
    const ringLabel = ui.ring.btn?.getAttribute("aria-label");
    check("... and its label calls the row waiting, never active: Downloads, 1 waiting, N percent", /^Downloads, 1 waiting, \d+ percent$/.test(ringLabel), ringLabel);
    ui.ring.pop.open(false);
    await sleep(500);
    const prow = b.root.querySelector(`.vd-pop-row[data-id="${id}"]`);
    check("the quick view says Waiting for network and offers Try now", / · Waiting for network$/.test(text(prow?.querySelector(".vd-pop-meta"))) && prow?.querySelector(".vd-round")?.getAttribute("aria-label") === "Try now drop.bin", [text(prow?.querySelector(".vd-pop-meta")), prow?.querySelector(".vd-round")?.getAttribute("aria-label")]);
    ui.ring.pop.close(false);
    await sleep(300);
    check("waits never hold a quit back", engine.runningCount() === 0, engine.runningCount());
    const w2 = await DL.until(id, ["paused"], { test: (v) => v.wait?.tries >= 2 && !engine.transferInfo(id), timeout: 25000, what: "the second try" });
    const next2 = w2.nextAt - Date.now();
    check("the second try fails too, the next comes about 30 s later", w2.wait.tries === 2 && next2 > 24000 && next2 <= 30500, [w2.wait.tries, next2]);
    // The network back: Try now (resume now) goes at once.
    await waitFor(() => Date.now() - t0 > 61000, { timeout: 70000, interval: 500, what: "the end of the drop" });
    const before = engine.get(id).received;
    await DL.reset();
    ui.store.primary(engine.get(id));
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000 });
    const fetched = sentAfterProbe(await since("/net/medium"));
    check("Try now continues it from its segments: completed intact, only the missing bytes fetched", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && fetched === medium.size - before, { state: done.state, fetched, missing: medium.size - before });
  }

  // ---- Checking: a resume's check that takes a while ----
  if (want("checking")) {
    const id = engine.start(net("c1", 512), { filename: "checking.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 4 * MiB && !v.phase, timeout: 30000, what: "4 MiB before the pause" });
    engine.pause(id);
    const p = await engine.whenSettled(id);
    await control("/slow?for=6&k=c1&ms=2500");
    await showRow(id);
    const r = row(id);
    const t0 = Date.now();
    engine.resume(id);
    await sleep(150);
    const early = [engine.get(id).phase, text(r.querySelector(".speed")), r.querySelector(".vd-prog").hidden, text(r.querySelector(".vd-pct"))];
    check("checking: in its first 400 ms a resume shows its dimmed bar at the old percentage, no word yet (never Starting)", early[0] === "probing" && early[1] === "—" && !early[2] && early[3] === `${Math.floor((p.received / medium.size) * 100)}%` && r.querySelector(".vd-bar").classList.contains("dim"), early);
    await waitFor(() => engine.get(id).phase === "checking", { timeout: 3000, interval: 50, what: "Checking" });
    await sleep(300);
    check("... after 400 ms it reads Checking, the bar still dimmed", Date.now() - t0 >= 400 && text(r.querySelector(".speed")) === "Checking" && r.querySelector(".vd-bar").classList.contains("dim") && text(b.root.querySelector(".vd-d-cap")) === "Checking the saved part and the link", [text(r.querySelector(".speed")), text(b.root.querySelector(".vd-d-cap"))]);
    await spike.capture("network-3-checking");
    await hidePanel();
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000 });
    check("... then it continues and completes intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [done.state, done.error]);
  }

  // ---- Firefox offline ----
  if (want("offline")) {
    await DL.reset();
    const id = engine.start(net("o1", 256), { filename: "offline.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 4 * MiB && !v.phase, timeout: 30000, what: "4 MiB before going offline" });
    const managed = Services.io.manageOfflineStatus;
    Services.prefs.setBoolPref("network.disable-localhost-when-offline", true);
    let offAt = 0;
    let onAt = 0;
    try {
      // Going offline leaves open sockets alone (only new connections fail): the running ones are cut.
      await control("/drop?for=2&k=o1");
      Services.io.manageOfflineStatus = false;
      Services.io.offline = true;
      offAt = Date.now();
      const w = await waitingIn(id, "network", 40000);
      check("offline: switched offline, a running download is Waiting for network", w.wait.tries >= 1 && !w.error, w.wait);
      const w2 = await DL.until(id, ["paused"], { test: (v) => v.wait?.tries >= 2, timeout: 20000, what: "a try counted while offline" });
      check("... while offline a try is only counted: nothing is started", w2.state === "paused" && !engine.transferInfo(id), w2.wait);
      Services.io.offline = false;
      onAt = Date.now();
      await sleep(200);
      const soon = engine.get(id).nextAt - onAt;
      check("switched online, the next try comes within 5 s", soon <= 5200, soon);
    } finally {
      Services.io.offline = false;
      Services.io.manageOfflineStatus = managed;
      Services.prefs.clearUserPref("network.disable-localhost-when-offline");
    }
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000 });
    check("... and it completes intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && Date.now() - onAt < 30000, [done.state, done.error]);
    const during = (await since("/net/medium")).filter((r) => r.t * 1000 > offAt + 2500 && r.t * 1000 < onAt);
    check("no request reached the server while Firefox was offline", during.length === 0, during.map((r) => r.range));
  }

  // ---- the site answers 503 for 90 s ----
  if (want("busy")) {
    await DL.reset();
    await control("/busy?for=90&k=b1");
    const t0 = Date.now();
    const id = engine.start(net("b1", 0), { filename: "busy.bin", named: true });
    const w = await waitingIn(id, "server", 30000);
    check("busy: a 503 makes it Retrying (paused, wait 'server', status 503)", w.wait.tries === 1 && w.status === 503 && !w.error, { wait: w.wait, status: w.status });
    await showRow(id);
    const r = row(id);
    const status = text(r.querySelector(".vd-status"));
    check("its row reads Retrying · in N s", /^Retrying · in \d+ s$/.test(status), status);
    await sleep(1500);
    check("... counting down", text(r.querySelector(".vd-status")) !== status || /^Retrying$/.test(text(r.querySelector(".vd-status"))), [status, text(r.querySelector(".vd-status"))]);
    check("... its caption: The site had a problem (503). Trying again at HH:MM", /^The site had a problem \(503\)\. Trying again at \d{1,2}:\d{2}/.test(text(b.root.querySelector(".vd-d-cap"))), text(b.root.querySelector(".vd-d-cap")));
    check("... its verb is Try now", /^Try now busy\.bin$/.test(r.querySelector(".primary").getAttribute("aria-label")), r.querySelector(".primary").getAttribute("aria-label"));
    await spike.capture("network-2-retrying");
    await hidePanel();
    let failed = null;
    let tries = 0;
    const done = await waitFor(
      () => {
        const v = engine.get(id);
        if (v.state === "failed") failed = v.error;
        if (v.wait?.tries) tries = Math.max(tries, v.wait.tries);
        return v.state === "completed" || v.state === "failed" ? v : null;
      },
      { timeout: 200000, interval: 250, what: "the busy download to complete" }
    );
    const busy = (await asked("b1")).filter((q) => q.status === 503);
    log("503 answers", busy.length, "tries", tries, "took", Date.now() - t0);
    check("it never failed while the site answered 503 for 90 s, and completed intact after", !failed && done.state === "completed" && Date.now() - t0 >= 90000 && (await DL.sha256(done.path)) === medium.sha256, { failed, state: done.state, error: done.error });
    check("... on the schedule: its first run asked 3 times (its own retries), each try of the wait once (a try's check stops at the 503)", tries >= 2 && busy.length === 3 + (tries - 1), { busy: busy.length, tries });
  }

  // ---- a server that asks for an hour (Retry-After: 3600) ----
  if (want("long")) {
    await DL.reset();
    await control("/busy?for=600&k=l1&ra=3600");
    const id = engine.start(net("l1", 0), { filename: "retry-after.bin", named: true });
    const w = await waitingIn(id, "server", 20000);
    const reqs = await asked("l1");
    const left = w.nextAt - Date.now();
    check("long: a 503 asking for an hour stops the run at its first answer: Retrying, the next try an hour away, nothing asked in between", reqs.length === 1 && left > 3590000 && left <= 3600500, { asked: reqs.map((q) => q.status), left });
    await control("/busy?for=0&k=l1");
    ui.store.primary(engine.get(id));
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000 });
    check("... Try now goes at once and completes it intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [done.state, done.error]);
  }

  // ---- a site that answers 503 to some tries and drops others: one count ----
  if (want("alternate")) {
    await DL.reset();
    await control("/busy?for=600&k=a1");
    const id = engine.start(net("a1", 0), { filename: "alternate.bin", named: true });
    await waitingIn(id, "server", 30000);
    const r1 = { ...rec(id).wait };
    check("alternate: a 503 makes it Retrying, try 1, the 503's clock started", r1.for === "server" && r1.tries === 1 && r1.serverSince === r1.since, r1);
    // The site drops the connections now: the next try (brought forward) fails on the network.
    await control("/busy?for=0&k=a1");
    await control("/drop?for=600&k=a1");
    await bring(id);
    await DL.until(id, ["paused"], { test: (v) => v.wait?.tries >= 2 && !engine.transferInfo(id), timeout: 30000, what: "the second try" });
    const r2 = { ...rec(id).wait };
    const in2 = r2.nextAt - Date.now();
    check("... a dropped connection then makes it Waiting for network with the count going on: try 2, the next 30 s later, the 503's clock kept", r2.for === "network" && r2.tries === 2 && in2 > 24000 && in2 <= 30500 && r2.since === r1.since && r2.serverSince === r1.serverSince, { r2, in2 });
    await control("/drop?for=0&k=a1");
    await control("/busy?for=600&k=a1");
    await bring(id);
    await DL.until(id, ["paused"], { test: (v) => v.wait?.tries >= 3 && !engine.transferInfo(id), timeout: 30000, what: "the third try" });
    const r3 = { ...rec(id).wait };
    const in3 = r3.nextAt - Date.now();
    check("... a 503 again: Retrying, try 3, the next 1 min later, still counted from the first 503", r3.for === "server" && r3.tries === 3 && in3 > 54000 && in3 <= 60500 && r3.since === r1.since && r3.serverSince === r1.serverSince, { r3, in3 });
    // 24 h after the first 503, the next one ends it with today's sentence.
    rec(id).wait = { ...rec(id).wait, serverSince: Date.now() - 24 * 3600 * 1000 - 1000, nextAt: Date.now() };
    await engine.save(true);
    const v = await DL.until(id, ["failed", "completed"], { timeout: 30000, what: "the 24 h give-up" });
    check("... and once the site has failed for 24 h, the row fails with today's sentence", v.state === "failed" && v.error === "The site had a problem serving the file (503)." && !v.wait, [v.state, v.error]);
    await control("/busy?for=0&k=a1");
  }

  // ---- failures no wait can fix end as before (review of Phase 4) ----
  if (want("fatal")) {
    const cases = [
      ["a port Gecko blocks", "http://127.0.0.1:6000/blocked.bin", "fatal-port.bin"],
      ["a redirect loop", `${DL.base}/loop/a`, "fatal-loop.bin"],
      ["two Content-Length headers that disagree", `${DL.base}/dupcl`, "fatal-length.bin"],
    ];
    for (const [what, url, name] of cases) {
      const id = engine.start(url, { filename: name, named: true });
      const v = await DL.until(id, ["failed", "paused", "completed"], { timeout: 30000, what });
      check(`fatal: ${what} fails as before Phase 4 (The connection was lost.), never Waiting for network`, v.state === "failed" && v.error === "The connection was lost." && !v.wait, { state: v.state, error: v.error, wait: v.wait });
      if (v.state !== "failed") engine.cancel(id);
    }
  }

  // ---- sleep and wake ----
  if (want("sleep")) {
    await DL.reset();
    const id = engine.start(net("s1", 512), { filename: "sleep.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 3 * MiB && !v.phase, timeout: 30000, what: "3 MiB before the sleep" });
    Services.obs.notifyObservers(null, "sleep_notification");
    // No timers until the wake: the run's end is awaited as a promise, the store's last save too.
    const w = await engine.whenSettled(id);
    await engine.save(true);
    const st = (await IOUtils.readJSON(store)).items.find((x) => x.id === id);
    check("sleep: the running download pauses into wait 'sleep', and the store says so with its segments", w.state === "paused" && w.wait?.for === "sleep" && st?.state === "paused" && st?.wait?.for === "sleep" && st.file.segments.reduce((n, s) => n + s.received, 0) === w.received, { view: [w.state, w.wait], state: st?.state, wait: st?.wait });
    check("... every segment claims exactly the bytes in its .part", await claimsTrue(id, "medium.bin"));
    await DL.reset();
    const woke = Date.now();
    Services.obs.notifyObservers(null, "wake_notification");
    await sleep(3000);
    check("after the wake it waits a moment for the network", engine.get(id).state === "paused" && engine.get(id).wait?.for === "sleep" && !engine.transferInfo(id), [engine.get(id).state, engine.get(id).wait]);
    await DL.until(id, ["downloading", "queued", "completed"], { timeout: 20000, what: "the download after the wake" });
    const took = Date.now() - woke;
    check("wake: it continues about 10 s after the wake", took >= 9000 && took <= 13000, took);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000 });
    const first = (await since("/net/medium")).find((r) => r.path.includes("k=s1"));
    check("... through its resume probe (window 0 with If-Range), and completes intact", first?.range === "bytes=0-65535" && !!first.ifrange && done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [first?.range, first?.ifrange, done.state, done.error]);
    // A sleep, a wake and then the network back: at once.
    const id2 = engine.start(net("s2", 512), { filename: "sleep-2.bin", named: true });
    await DL.until(id2, ["downloading"], { test: (v) => v.received > 3 * MiB && !v.phase, timeout: 30000, what: "3 MiB before the second sleep" });
    Services.obs.notifyObservers(null, "sleep_notification");
    const w2 = await engine.whenSettled(id2);
    Services.obs.notifyObservers(null, "wake_notification");
    check("a second sleep pauses it into wait 'sleep' too", w2.state === "paused" && w2.wait?.for === "sleep", [w2.state, w2.wait]);
    await sleep(500);
    const up = Date.now();
    Services.obs.notifyObservers(null, "network:link-status-changed", "up");
    await DL.until(id2, ["downloading", "queued", "completed"], { timeout: 20000, what: "the download after the link-up" });
    check("a network link-up after the wake continues it at once", Date.now() - up < 2500, Date.now() - up);
    const done2 = await DL.until(id2, ["completed", "failed"], { timeout: 60000 });
    check("... and it completes intact", done2.state === "completed" && (await DL.sha256(done2.path)) === medium.sha256, [done2.state, done2.error]);
  }

  // ---- Pause all reaches a waiting row ----
  if (want("pauseall")) {
    await DL.clean();
    await control("/drop?for=30&k=p1");
    const id = engine.start(net("p1", 1024), { filename: "pause-all.bin", named: true });
    await waitingIn(id, "network", 30000);
    await showRow(id);
    const summary = text(b.root.querySelector(".vd-summary"));
    const btn = b.root.querySelector(".vd-pause-all");
    check("pauseall: a waiting row reads as under way: '1 waiting' and Pause all", /1 waiting/.test(summary) && text(btn) === "Pause all" && !btn.disabled, [summary, text(btn)]);
    spike.click(btn);
    await sleep(400);
    const v = engine.get(id);
    check("Pause all ends the wait: the row is plainly paused", v.state === "paused" && !v.wait && text(row(id).querySelector(".vd-status")) === "Paused", [v.state, v.wait, text(row(id).querySelector(".vd-status"))]);
    check("... and the summary says paused", /1 paused/.test(text(b.root.querySelector(".vd-summary"))), text(b.root.querySelector(".vd-summary")));
    await hidePanel();
    engine.cancel(id);
  }

  // ---- a quit: what it stops continues at the start, what the person paused stays paused (run 2) ----
  if (!want("restarts")) return;
  await DL.clean();
  settings.set({ continueDownloadsOnStart: true });
  const stopped = engine.start(net("r1", 128), { filename: "quit-stopped.bin", named: true });
  const pausedId = engine.start(net("r2", 128), { filename: "person-paused.bin", named: true });
  await DL.until(stopped, ["downloading"], { test: (v) => v.received > 2 * MiB && !v.phase, timeout: 30000, what: "the download the quit stops" });
  await DL.until(pausedId, ["downloading"], { test: (v) => v.received > 2 * MiB && !v.phase, timeout: 30000, what: "the download the person pauses" });
  engine.pause(pausedId);
  await engine.whenSettled(pausedId);
  remember({ stopped, pausedId });
  await spike.restart();
});
