// Phase 1 of spikes/downloader/RESUME-DESIGN.md, "never lose or mix bytes" (section 7), against the
// local server's /expire, /swap, /morph and /md5 routes (tests/downloads/server.py):
//   - control: a resume of an unexpired, unchanged download makes as many requests as before (one
//     connection: the probe, then one range; a server without ranges: the probe's answer only). Since
//     Phase 2 the resume's probe asks bytes=0-65535, so window 0 rides on it (RESUME-DESIGN.md 2.5);
//   - the store is version 2 and keeps a .bak: the last flushed list, which progress saves leave alone;
//   - a file swapped on the server during a pause: File changed (paused, need 'choice'), the .part's
//     sha256 unchanged, nothing fetched after the probe (its answer carries window 0, which differs); swapped
//     mid-download (a dropped connection, then a new request): File changed, every saved byte the old
//     file's; a weak ETag whose Last-Modified changed (If-Range carries the date) and an ETag dropped
//     while Last-Modified changed (on a server that ignores If-Range): both File changed;
//   - the same bytes under a new ETag (a redeploy), during a pause and mid-download: the windows (3 or
//     4, RESUME-DESIGN.md 2.5) prove it is the same file, and it completes intact fetching only what was
//     missing (R6, as before Phase 1 it completed);
//   - a download of unknown length (chunked, no ranges) whose address then takes ranges: completes
//     intact with only the missing bytes; whose address then gives fewer bytes than are saved (a 206
//     or a 200): File changed, the .part untouched, the list still builds; a known total whose resume
//     answer gives none ("/*") and turns out shorter: File changed;
//   - an address that now answers with a web page (200, or a 302 to one) is never completed and its
//     .part stays intact; 403 with S3's "Request has expired" and 410: Link expired, the bytes kept;
//   - the panel: the rows read Link expired and File changed, Space on a File changed row only moves
//     focus to Start over, Refresh address (Phase 3; Retry before it) keeps a Link expired row's bytes
//     and, with no page to open, offers the address field; Start over while another program
//     has the .part open moves and empties nothing; Start over keeps "<name>.old.part" until the new
//     file is complete (the owner's decision of 2026-10-13), and never touches another file of that
//     name ("<name>.old (1).part" then);
//   - Content-MD5 that matches completes; one that doesn't fails with the checksum sentence;
//   - an HLS segment answered with a web page is never written, encrypted or not; an AES-128 stream
//     whose CDN labels its segments text/html, one ciphertext starting with '<', completes;
//   - run 2, after a restart: a corrupt store loads from its .bak (written as a version 1 store), that
//     download resumes from its segments (a stale "<part>.new" goes), and a version 1 row of a text
//     file sniffed as binary resumes to the end; run 3: a stored record whose segments claim more than
//     its total loads settled (the list builds, no hang); run 4: a store and .bak both unreadable are
//     set aside as .corrupt and never written over.
// VITRE_DL_ONLY=a,b runs only those sections (control alone is also run on a build of the unchanged
// code): control, store, mid, swap, unknown, expired, panel (needs swap and expired), md5, hls,
// shrink (last: the unfixed build hung there), restart (runs 2-4).
/* global spike, Services, Cu, ChromeUtils, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const settings = b.sys("VitreSettings");
  const MiB = 1 << 20;
  const store = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
  const medium = m["medium.bin"];
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);

  /** The download once its run has ended (paused, failed, completed or cancelled). */
  const settled = (id, what) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && ["paused", "failed", "completed", "cancelled"].includes(v.state) ? v : null;
      },
      { timeout: 90000, interval: 100, what }
    );
  /** Wait for `bytes`, pause, and return the view once every connection has stopped. */
  const pauseAt = async (id, bytes, what) => {
    await DL.until(id, ["downloading"], { test: (v) => v.received > bytes, timeout: 30000, what });
    engine.pause(id);
    return settled(id, what + " to pause");
  };
  const flag = async (k, f = "") => (await fetch(`${DL.base}/flag?k=${k}${f ? `&f=${f}` : ""}`, { cache: "no-store" })).json();
  const seen = async (prefix) => (await DL.stats()).requests.filter((r) => r.path.startsWith(prefix));
  const brief = (reqs) => reqs.map((r) => `${r.status} ${r.range || "-"} ${r.ifrange || "-"}`);
  /** The proof's windows: ranges asked without If-Range (a first probe is bytes=0-0; a resume's carries If-Range). */
  const windowsOf = (reqs) => reqs.filter((r) => r.range && r.range !== "bytes=0-0" && !r.ifrange);
  const sentIn = (reqs) => reqs.reduce((n, r) => n + (r.sent || 0), 0);
  const exists = (p) => IOUtils.exists(p);

  /**
   * Restart in place; `body` (an async function's body, with engine, store, IOUtils and `data` in
   * scope) runs after the engine's last save at quit. Windows are gone by then, so it lives in a sandbox.
   */
  const restartWith = async (what, body, data = {}) => {
    const sb = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { wantGlobalProperties: ["IOUtils"] });
    sb.engine = engine;
    sb.store = store;
    sb.data = Cu.cloneInto(data, sb);
    Cu.evalInSandbox(`async function atQuit() { await engine.shutdown(); ${body} }`, sb);
    const { AsyncShutdown } = ChromeUtils.importESModule("resource://gre/modules/AsyncShutdown.sys.mjs");
    AsyncShutdown.profileBeforeChange.addBlocker(`Deer integrity test: ${what}`, sb.atQuit);
    log("restarting:", what);
    await spike.restart();
  };

  // ---- run 4: the store and its .bak were both unreadable ----
  if (spike.run === 4) {
    const garbage = JSON.parse(Services.prefs.getStringPref("vitre.test.integrity4", "{}"));
    check("a store and .bak that are both unreadable start an empty list", engine.list(false).length === 0, engine.list(false).map((v) => v.filename));
    await engine.save(true);
    const main = await IOUtils.readJSON(store).catch(() => null);
    const c1 = await IOUtils.readUTF8(store + ".corrupt").catch(() => "");
    const c2 = await IOUtils.readUTF8(store + ".bak.corrupt").catch(() => "");
    check("both were set aside as .corrupt and the next save wrote over neither", c1 === garbage.main && c2 === garbage.bak && Array.isArray(main?.items), { c1: c1.slice(0, 40), c2: c2.slice(0, 40), main: !!main });
    return;
  }

  // ---- run 3: a stored record whose segments claim more than its total ----
  if (spike.run === 3) {
    // An unknown-length segment of 3.1 MB beside a total of 1 MiB, as the unfixed resume stored it:
    // it loads settled to an unknown length, and building the list never hangs (review of Phase 1).
    const badId = Services.prefs.getStringPref("vitre.test.integrity3", "");
    const listed = engine.list(false).find((x) => x.id === badId);
    await engine.save(true);
    const stored = (await IOUtils.readJSON(store)).items.find((x) => x.id === badId);
    check("a stored record whose segments claim more than its total loads settled to an unknown length, and the list builds", !!listed && listed.state === "paused" && stored?.file?.total === -1 && stored.file.ranges === false, stored?.file);
    const garbage = { main: '{"version":2,"items":[{"id":"x",', bak: '{"version":2,"sess' };
    Services.prefs.setStringPref("vitre.test.integrity4", JSON.stringify(garbage));
    await restartWith("a store and .bak both unreadable", "await IOUtils.writeUTF8(store, data.main); await IOUtils.writeUTF8(store + '.bak', data.bak);", garbage);
    return;
  }

  // ---- run 2: the store came back from its .bak ----
  if (spike.run === 2) {
    const saved = JSON.parse(Services.prefs.getStringPref("vitre.test.integrity", "{}"));
    const v = engine.list(false).find((x) => x.filename === "kept-in-backup.bin");
    check("a corrupt store loads from its .bak (a version 1 copy): the download is back, paused, with its bytes", !!v && v.state === "paused" && v.received === saved.received, v && { state: v.state, received: v.received, saved });
    if (!v) return;
    const main = await IOUtils.readJSON(store).catch(() => null);
    check("the unreadable list was set aside and the backup put in its place", (await exists(store + ".corrupt")) && !!main?.items?.some((x) => x.filename === "kept-in-backup.bin"), main && main.version);
    check("its .part is as it was", (await DL.sha256(v.path + ".part")) === saved.sha);
    // A "<part>.new" a run left behind (a crash while a new answer was checked) goes with the next run.
    await IOUtils.writeUTF8(v.path + ".part.new", "left over");
    await DL.reset();
    engine.resume(v.id);
    const done = await settled(v.id, "the download from the backup to finish");
    const reqs = await seen("/blob/medium");
    const fetched = sentIn(reqs.filter((r) => r.status === 206 && r.end > r.start && r.range !== "bytes=0-65535"));
    check("it resumes from its segments and completes intact (only the missing bytes fetched)", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && fetched === medium.size - saved.received, { state: done.state, error: done.error, fetched, missing: medium.size - saved.received });
    check("a '<part>.new' left over from an earlier run is gone", !(await exists(v.path + ".part.new")));
    // A version 1 row of a text file (named, so no type was kept; its bytes sniff as binary): its
    // text/plain answers are not "a page where a file was" (review of Phase 1).
    const t = engine.list(false).find((x) => x.filename === "kept-text.bin");
    await DL.reset();
    engine.resume(t.id);
    const tDone = await settled(t.id, "the version 1 text file to finish");
    check("a version 1 row of a text file sniffed as binary resumes to the end (text/plain is not a page)", tDone.state === "completed" && (await DL.sha256(tDone.path)) === medium.sha256, [tDone.state, tDone.need, tDone.error]);
    // Run 3 starts with a record as the unfixed resume of an unknown-length download stored it.
    const badId = "integrity-bad-record";
    Services.prefs.setStringPref("vitre.test.integrity3", badId);
    await restartWith(
      "a stored record whose segments claim more than its total",
      `const d = await IOUtils.readJSON(store);
      const model = d.items.find((r) => r.filename === "kept-in-backup.bin");
      const bad = JSON.parse(JSON.stringify(model));
      Object.assign(bad, { id: data.badId, filename: "bad-record.bin", path: model.path.replace("kept-in-backup.bin", "bad-record.bin"), state: "paused", finishedAt: 0, received: 3227648 });
      Object.assign(bad.file, { total: 1048576, ranges: true, segments: [{ start: 0, end: -1, received: 3227648 }] });
      d.items.push(bad);
      await IOUtils.writeJSON(store, d);`,
      { badId }
    );
    return;
  }

  const connections = settings.get().connections;

  // ---- control: an unexpired, unchanged resume makes as many requests as before ----
  settings.set({ connections: 1 });
  if (want("control")) {
    await DL.reset();
    const c1 = engine.start(`${DL.base}/blob/medium?rate=2048`, { filename: "control-ranged.bin", named: true });
    const c1p = await pauseAt(c1, 2 * MiB, "the ranged control");
    await DL.reset();
    engine.resume(c1);
    const c1d = await settled(c1, "the ranged control to finish");
    const c1r = await seen("/blob/medium");
    log("control (ranges) requests after the resume", brief(c1r));
    check("control: a resume with ranges makes 2 requests, as before (the probe, carrying window 0, then one range from the saved end)", c1r.length === 2 && c1r[0].range === "bytes=0-65535" && c1r[0].ifrange && c1r[1].start === c1p.received, brief(c1r));
    check("control: it completed intact", c1d.state === "completed" && (await DL.sha256(c1d.path)) === medium.sha256, c1d.error);
    await DL.reset();
    const c2 = engine.start(`${DL.base}/md5/medium?good=1&rate=2048`, { filename: "control-single.bin", named: true });
    await pauseAt(c2, 2 * MiB, "the control without ranges");
    await DL.reset();
    engine.resume(c2);
    const c2d = await settled(c2, "the control without ranges to finish");
    const c2r = await seen("/md5/medium");
    log("control (no ranges) requests after the resume", brief(c2r));
    check("control: a resume without ranges makes 1 request, as before (the probe's answer is the download)", c2r.length === 1, brief(c2r));
    check("control: it completed intact, its Content-MD5 checked", c2d.state === "completed" && (await DL.sha256(c2d.path)) === medium.sha256, [c2d.state, c2d.error]);
    check("control: no '.part.new' is left", !(await exists(c2d.path + ".part.new")));
  }
  if (only.size === 1 && only.has("control")) {
    settings.set({ connections });
    return;
  }

  // ---- the store (RESUME-DESIGN.md 5.6) ----
  if (want("store")) {
    // Progress saves (every 2 s) leave the .bak alone: it is the last flushed list (review of Phase 1).
    await DL.reset();
    const sv = engine.start(`${DL.base}/blob/medium?rate=1024`, { filename: "store-bak.bin", named: true });
    await DL.until(sv, ["downloading"], { test: (v) => v.received > 1 * MiB, timeout: 30000, what: "a running download" });
    const saved = await IOUtils.readJSON(store).catch(() => null);
    check("the store is version 2, with its session, and keeps a .bak of its previous copy", saved?.version === 2 && typeof saved.session?.startedAt === "number" && (await exists(store + ".bak")), saved && { version: saved.version, session: saved.session });
    await sleep(500);
    const bak1 = await IOUtils.readUTF8(store + ".bak");
    const main1 = await IOUtils.readUTF8(store);
    await sleep(4500);
    const bak2 = await IOUtils.readUTF8(store + ".bak");
    const main2 = await IOUtils.readUTF8(store);
    check("progress saves rewrite the store but leave its .bak alone (the last flushed list)", bak1 === bak2 && main1 !== main2, { bakSame: bak1 === bak2, mainSame: main1 === main2 });
    engine.cancel(sv);
    await settled(sv, "the store download to cancel");
  }

  // ---- a file changed mid-download: the connection drops, the next request finds another version ----
  if (want("mid")) {
    await DL.reset();
    const mid = engine.start(`${DL.base}/swap/medium?val=etag&k=s-mid&cut=1048576`, { filename: "swapped-mid.bin", named: true });
    await DL.until(mid, ["downloading"], { test: (v) => v.received >= 2 * MiB, timeout: 30000, what: "2 MiB before the swap" });
    await flag("s-mid");
    const midV = await settled(mid, "the file swapped mid-download");
    const midR = await seen("/swap/medium");
    const n = midV.received;
    const ours = await IOUtils.read(midV.path + ".part", { maxBytes: n });
    const theirs = await IOUtils.read(PathUtils.join(DL.fix, "medium.bin"), { maxBytes: n });
    check("a file swapped mid-download (a dropped connection, then a new request) stops as File changed once a window shows other bytes", midV.state === "paused" && midV.need?.kind === "choice" && midR.some((r) => r.status === 200) && windowsOf(midR).length === 1 && midV.need.evidence === "its first bytes are different", [midV.state, midV.need, brief(midR)]);
    check("every saved byte is the old file's (nothing mixed)", n >= 2 * MiB && ours.length === n && theirs.length === n && ours.every((x, i) => x === theirs[i]), n);

    // The same bytes under a new ETag mid-download (a redeploy): proven by the bytes, carried on (R6).
    await DL.reset();
    const r2 = engine.start(`${DL.base}/swap/medium?val=etag&same=1&k=r-mid&cut=4194304`, { filename: "redeployed-mid.bin", named: true });
    await DL.until(r2, ["downloading"], { test: (v) => v.received >= 4 * MiB, timeout: 30000, what: "4 MiB before the redeploy" });
    await flag("r-mid");
    const r2d = await settled(r2, "the file redeployed mid-download");
    const r2r = await seen("/swap/medium");
    check("the same bytes under a new ETag mid-download: proven by the windows (2 to 4), carried on, completed intact", r2d.state === "completed" && (await DL.sha256(r2d.path)) === medium.sha256 && r2r.some((r) => r.status === 200) && windowsOf(r2r).length >= 2 && windowsOf(r2r).length <= 4, [r2d.state, r2d.need, r2d.error, brief(r2r)]);
    const r2after = r2r.slice(r2r.findIndex((r) => r.status === 200) + 1).filter((r) => r.ifrange);
    check("after the proof every range carries the new ETag", r2after.length > 0 && r2after.every((r) => r.ifrange === `"B-${medium.size.toString(16)}"`), brief(r2after));
  }
  settings.set({ connections });

  // ---- a file swapped on the server during a pause ----
  let s1 = null;
  let s1p = null;
  let s1part = "";
  let s1sha = "";
  let swappedSha = "";
  if (want("swap")) {
    await DL.reset();
    s1 = engine.start(`${DL.base}/swap/medium?val=etag&k=s-etag&rate=512`, { filename: "swapped.bin", named: true });
    s1p = await pauseAt(s1, 3 * MiB, "the file that will be swapped");
    s1part = s1p.path + ".part";
    s1sha = await DL.sha256(s1part);
    swappedSha = (await flag("s-etag", "medium")).sha256;
    await DL.reset();
    engine.resume(s1);
    const s1v = await settled(s1, "the swapped file's verdict");
    const s1r = await seen("/swap/medium");
    check("a file swapped during a pause reads File changed (paused, the person chooses)", s1v.state === "paused" && s1v.need?.kind === "choice", [s1v.state, s1v.need, s1v.error]);
    check("its .part is untouched (sha256) and its bytes still count", (await DL.sha256(s1part)) === s1sha && s1v.received === s1p.received, { received: s1v.received, before: s1p.received });
    check("nothing is fetched after the probe: its answer (a 200 to If-Range) carries window 0, whose bytes differ", s1r.length === 1 && s1r[0].range === "bytes=0-65535" && !!s1r[0].ifrange && s1r[0].status === 200 && s1v.need?.evidence === "its first bytes are different", brief(s1r));

    // A weak ETag and a new Last-Modified: If-Range carries the date (a weak ETag can't be used).
    await DL.reset();
    const s2 = engine.start(`${DL.base}/swap/medium?val=weak&k=s-weak&rate=512`, { filename: "weak.bin", named: true });
    const s2p = await pauseAt(s2, 2 * MiB, "the weak-ETag file");
    const s2pulls = (await seen("/swap/medium")).filter((r) => r.status === 206 && r.end > r.start);
    const s2sha = await DL.sha256(s2p.path + ".part");
    await flag("s-weak");
    await DL.reset();
    engine.resume(s2);
    const s2v = await settled(s2, "the weak-ETag file's verdict");
    const s2r = await seen("/swap/medium");
    check("with a weak ETag, If-Range carries Last-Modified", s2pulls.length > 0 && s2pulls.every((r) => r.ifrange === "Mon, 12 Oct 2026 09:00:00 GMT") && s2r[0]?.ifrange === "Mon, 12 Oct 2026 09:00:00 GMT", brief(s2pulls.slice(0, 3)));
    check("a weak ETag plus a Last-Modified change is caught: File changed, the .part intact", s2v.need?.kind === "choice" && (await DL.sha256(s2p.path + ".part")) === s2sha && s2r.length === 1 && s2r[0].status === 200, [s2v.state, s2v.need, brief(s2r)]);

    // "<name>.old.part" that is another file (another download's partial, the person's own) is never
    // touched by Start over: the old partial goes to "<name>.old (1).part" (review of Phase 1).
    const s2other = s2p.path + ".old.part";
    await IOUtils.writeUTF8(s2other, "the person's own file");
    await DL.reset();
    await engine.startOver(s2);
    const s2kept = s2p.path + ".old (1).part";
    const s2otherNow = await IOUtils.readUTF8(s2other).catch(() => "(replaced)");
    check("Start over never touches another file named <name>.old.part; the old partial goes to <name>.old (1).part", s2otherNow === "the person's own file" && (await exists(s2kept)) && (await DL.sha256(s2kept)) === s2sha, { other: s2otherNow.slice(0, 40), kept: await exists(s2kept) });
    engine.cancel(s2);
    await settled(s2, "the new weak.bin to cancel");
    const s2gone = await waitFor(async () => !(await exists(s2kept)), { timeout: 5000, what: "the old partial to go" }).catch(() => false);
    check("Cancel removes the old partial it kept, and only that", s2gone && (await exists(s2other)));

    // An ETag that is dropped while Last-Modified changes, on a server that ignores If-Range (206 anyway).
    await DL.reset();
    const s3 = engine.start(`${DL.base}/swap/medium?val=drop&ifrange=ignore&k=s-drop&rate=512`, { filename: "dropped.bin", named: true });
    const s3p = await pauseAt(s3, 2 * MiB, "the file whose ETag will be dropped");
    const s3sha = await DL.sha256(s3p.path + ".part");
    await flag("s-drop");
    await DL.reset();
    engine.resume(s3);
    const s3v = await settled(s3, "the dropped-ETag file's verdict");
    const s3r = await seen("/swap/medium");
    check("a dropped ETag plus a new Last-Modified is caught: File changed, the .part intact, only the probe's window 0 fetched", s3v.need?.kind === "choice" && (await DL.sha256(s3p.path + ".part")) === s3sha && s3r.length === 1 && s3r[0].status === 206 && s3r[0].range === "bytes=0-65535", [s3v.state, s3v.need, brief(s3r)]);

    // The same bytes under a new ETag during a pause (a redeploy): proven by the bytes (R6), and the
    // download completes, fetching only what was missing (before Phase 1 it started over and completed).
    await DL.reset();
    const r1 = engine.start(`${DL.base}/swap/medium?val=etag&same=1&k=r-pause&rate=512`, { filename: "redeployed.bin", named: true });
    const r1p = await pauseAt(r1, 3 * MiB, "the file that will be redeployed");
    await flag("r-pause");
    await DL.reset();
    engine.resume(r1);
    const r1d = await settled(r1, "the redeployed file");
    const r1r = await seen("/swap/medium");
    const r1pulls = r1r.filter((r) => r.status === 206 && r.ifrange && r.end > r.start);
    log("redeployed", brief(r1r).slice(0, 6));
    check("the same bytes under a new ETag during a pause: window 0 (in the probe's 200) and 1 to 3 more prove it, and it completes intact", r1d.state === "completed" && (await DL.sha256(r1d.path)) === medium.sha256 && r1r[0].status === 200 && windowsOf(r1r).length >= 1 && windowsOf(r1r).length <= 3, [r1d.state, r1d.need, r1d.error, brief(r1r).slice(0, 4)]);
    check("only what was missing was fetched after the proof, under the new ETag", sentIn(r1pulls) === medium.size - r1p.received && r1pulls.every((r) => r.ifrange === `"B-${medium.size.toString(16)}"`), { fetched: sentIn(r1pulls), missing: medium.size - r1p.received });
  }

  // ---- downloads whose length was never known (review of Phase 1), one connection ----
  if (want("unknown")) {
    settings.set({ connections: 1 });
    // The address now takes ranges, same ETag: the saved bytes are the start of the file.
    await DL.reset();
    const ua = engine.start(`${DL.base}/morph/medium?k=u-a&rate=1024`, { filename: "unknown-a.bin", named: true });
    const uap = await pauseAt(ua, 3 * MiB, "the download of unknown length");
    await flag("u-a");
    await DL.reset();
    engine.resume(ua);
    const uad = await settled(ua, "the download of unknown length to finish");
    const uar = await seen("/morph/medium");
    // The resume's probe (bytes=0-65535) carries window 0: compared, not fetched again.
    const uaFetched = sentIn(uar.filter((r) => r.status === 206 && r.end > r.start && r.range !== "bytes=0-65535"));
    check("a download of unknown length whose address now takes ranges completes intact, fetching only what was missing", uad.state === "completed" && (await DL.sha256(uad.path)) === medium.sha256 && uaFetched === medium.size - uap.received, { state: uad.state, error: uad.error, fetched: uaFetched, missing: medium.size - uap.received, reqs: brief(uar).slice(0, 4) });

    // A known total whose resume answer gives none ("/*") and whose whole answer is shorter.
    await DL.reset();
    const uc = engine.start(`${DL.base}/morph/medium?k=u-c&before=ranged&after=star&short=8388608&rate=1024`, { filename: "unknown-c.bin", named: true });
    const ucp = await pauseAt(uc, 3 * MiB, "the download whose total will go unsaid");
    const ucsha = await DL.sha256(ucp.path + ".part");
    await flag("u-c");
    await DL.reset();
    engine.resume(uc);
    const ucv = await settled(uc, "the verdict on an answer without a total");
    check("a known total whose resume answer gives none ('/*') and turns out shorter: File changed, the .part untouched", ucv.state === "paused" && ucv.need?.kind === "choice" && (await DL.sha256(ucp.path + ".part")) === ucsha && /was 24 MB, now 8\.0 MB/.test(ucv.need.evidence), { state: ucv.state, need: ucv.need, error: ucv.error, reqs: brief(await seen("/morph/medium")) });
    settings.set({ connections });
  }

  // ---- addresses that no longer give the file ----
  const gone = {};
  if (want("expired")) {
    const expired = async (how, name) => {
      await DL.reset();
      const id = engine.start(`${DL.base}/expire/medium?how=${how}&k=e-${how}&rate=512`, { filename: name, named: true });
      const p = await pauseAt(id, 2 * MiB, name);
      const before = await DL.sha256(p.path + ".part");
      await flag(`e-${how}`);
      engine.resume(id);
      const v = await settled(id, `${name}: the verdict`);
      return { id, p, v, before, after: await DL.sha256(p.path + ".part"), reqs: await seen("/expire/medium") };
    };
    for (const [how, label] of [
      ["html200", "a 200 web page"],
      ["302html", "a 302 to a web page"],
    ]) {
      const r = await expired(how, `expired-${how}.bin`);
      check(`an address that now answers with ${label} is never completed: Link expired, the .part intact`, r.v.state === "paused" && r.v.need?.kind === "address" && r.after === r.before && r.v.received === r.p.received, { state: r.v.state, need: r.v.need, error: r.v.error, reqs: brief(r.reqs) });
    }
    for (const [how, status] of [
      ["403xml", 403],
      ["410", 410],
    ]) {
      const r = await expired(how, `expired-${how}.bin`);
      gone[how] = r;
      check(`${how === "403xml" ? "403 with S3's \"Request has expired\"" : "410"} gives Link expired with the data kept`, r.v.state === "paused" && r.v.need?.kind === "address" && r.v.need.status === status && r.after === r.before && r.v.received === r.p.received, { state: r.v.state, need: r.v.need, error: r.v.error, reqs: brief(r.reqs) });
    }
  }

  // ---- the panel ----
  if (want("panel") && s1 && gone["410"]) {
    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(400);
    const row = (id) => b.root.querySelector(`.vd-row[data-id="${id}"]`);
    const details = () => b.root.querySelector(".vd-details");
    const lx = gone["410"];
    // Since Phase 2 a Link expired row's details are taller (its actions wrap): rows are brought into view first.
    row(lx.id).scrollIntoView({ block: "nearest" });
    spike.click(row(lx.id).querySelector(".vd-name"));
    await sleep(600);
    const lxStatus = row(lx.id).querySelector(".vd-status")?.textContent;
    const lxCap = details().querySelector(".vd-d-cap").textContent;
    const lxActs = Array.from(details().querySelectorAll("[data-act]")).map((x) => x.textContent);
    // Phase 3 (RESUME-DESIGN.md 6): Refresh address is the Link expired row's verb (Retry and Copy address
    // stay in its menu); with no source page there is nothing to open.
    check("a Link expired row says so, why, how much is saved and when the next try is; Refresh address and Use another address… are offered", lxStatus === "Link expired" && /^The link stopped working \(410\) · \d+% is saved · next try \S/.test(lxCap) && lxActs.includes("Refresh address") && lxActs.includes("Use another address…") && !lxActs.includes("Open page"), { lxStatus, lxCap, lxActs });
    check("its row's name reads it to a screen reader", /, Link expired, \d+ percent saved$/.test(row(lx.id).getAttribute("aria-label") ?? ""), row(lx.id).getAttribute("aria-label"));
    await spike.capture("integrity-1-link-expired");
    await DL.reset();
    spike.click(details().querySelector('[data-act="refresh"]'));
    await waitFor(async () => (await seen("/expire/")).length > 0 && engine.get(lx.id).phase !== "renewing" && engine.get(lx.id).wait?.tries === 1, { timeout: 15000, what: "Refresh address to ask the address" });
    const lxAgain = engine.get(lx.id);
    check("Refresh address on an address that is still gone: Link expired again, the bytes kept, and the address field offered (no page to open)", lxAgain.state === "paused" && lxAgain.need?.kind === "address" && (await DL.sha256(lx.p.path + ".part")) === lx.before && !details().querySelector(".vd-addr").hidden, [lxAgain.state, lxAgain.need]);

    row(s1).scrollIntoView({ block: "nearest" });
    await sleep(100);
    spike.click(row(s1).querySelector(".vd-name"));
    await sleep(600);
    const s1Status = row(s1).querySelector(".vd-status")?.textContent;
    const s1Cap = details().querySelector(".vd-d-cap").textContent;
    const s1Note = details().querySelector(".vd-d-note").textContent;
    const startOver = () => details().querySelector('[data-act="start-over"]');
    check("a File changed row says so and offers Start over, described by the caption", s1Status === "File changed" && /^The file on the site is different from the one being downloaded\. \d+% of the old one is saved\.$/.test(s1Cap) && !!startOver() && startOver().getAttribute("aria-describedby") === "vd-d-cap", { s1Status, s1Cap });
    check("the details say what Start over keeps", /swapped\.bin\.old\.part until the new file is complete/.test(s1Note), s1Note);
    await spike.capture("integrity-2-file-changed");
    row(s1).focus();
    spike.press("Space");
    await sleep(400);
    check("Space on a File changed row only moves focus to Start over", document.activeElement === startOver() && engine.get(s1).need?.kind === "choice" && !engine.transferInfo(s1) && (await DL.sha256(s1part)) === s1sha, document.activeElement?.textContent);

    // Start over while another program has the .part open (a rename fails, a write would not): nothing
    // is moved or emptied, and the row still asks, saying why (review of Phase 1).
    const old = s1p.path + ".old.part";
    const holder = DL.tool(Services.env.get("VITRE_DL_PY"), ["-c", "import sys, time; f = open(sys.argv[1], 'rb'); time.sleep(float(sys.argv[2]))", s1part, "4"]);
    await sleep(1500);
    await DL.reset();
    await engine.startOver(s1);
    const held = engine.get(s1);
    await sleep(300);
    check("Start over while another program has the saved part open: nothing moved or emptied, the row still asks and says why", held.state === "paused" && held.need?.kind === "choice" && /another program has the saved part open/.test(held.need.evidence) && (await DL.sha256(s1part)) === s1sha && !(await exists(old)) && (await seen("/swap/medium")).length === 0 && /^Another program has the saved part open/.test(details().querySelector(".vd-d-note").textContent), [held.state, held.need, details().querySelector(".vd-d-note").textContent]);
    await holder;

    // Start over: the old partial waits as "<name>.old.part" until the new file is complete.
    await DL.reset();
    spike.click(startOver());
    await DL.until(s1, ["downloading"], { test: (v) => v.received > 1 * MiB, timeout: 30000, what: "the new file to start" });
    check("Start over keeps the old partial as <name>.old.part while the new file downloads", (await exists(old)) && (await DL.sha256(old)) === s1sha);
    const s1d = await settled(s1, "the new file to finish");
    check("the new file completes with the site's new bytes, under the same name", s1d.state === "completed" && s1d.filename === "swapped.bin" && (await DL.sha256(s1d.path)) === swappedSha, [s1d.state, s1d.filename, s1d.error]);
    check("the old partial goes once the new file is complete", await waitFor(async () => !(await exists(old)), { timeout: 5000, what: "the old partial to go" }).catch(() => false));
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
  }

  // ---- Content-MD5 ----
  if (want("md5")) {
    const good = engine.start(`${DL.base}/md5/medium?good=1`, { filename: "md5-good.bin", named: true });
    const bad = engine.start(`${DL.base}/md5/medium?good=0`, { filename: "md5-bad.bin", named: true });
    const goodV = await settled(good, "the right Content-MD5");
    const badV = await settled(bad, "the wrong Content-MD5");
    check("Content-MD5 that matches: the download completes", goodV.state === "completed" && (await DL.sha256(goodV.path)) === medium.sha256, [goodV.state, goodV.error]);
    check("Content-MD5 that doesn't match: fails with the checksum sentence", badV.state === "failed" && badV.error === "The finished file doesn’t match the server’s checksum.", [badV.state, badV.error]);
  }

  // ---- HLS segments that are web pages; encrypted segments labelled as pages ----
  if (want("hls")) {
    /** Whether a stream's track files hold a page, and their sizes. */
    const tracksOf = async (stem) => {
      const tracks = (await IOUtils.getChildren(DL.dir)).filter((p) => new RegExp(`${stem}\\.(video|audio)\\.part$`).test(p));
      let written = false;
      const sizes = [];
      for (const p of tracks) {
        const bytes = await IOUtils.read(p);
        sizes.push(bytes.length);
        if (/<!doctype|<html|Sign in/i.test(new TextDecoder("latin1").decode(bytes))) written = true;
      }
      return { tracks, written, sizes };
    };
    await DL.reset();
    const h = engine.start(`${DL.base}/expire/hls/v360/index.m3u8?how=html200&after=4&k=h-page`, { mode: "hls", filename: "expired-stream.mp4", named: true });
    const hv = await settled(h, "the stream with a page for a segment");
    const pages = (await seen("/expire/hls")).filter((r) => r.expired === "html200");
    const ht = await tracksOf("expired-stream");
    log("stream", { state: hv.state, need: hv.need, error: hv.error, pages: pages.length, tracks: ht.tracks.map((p) => PathUtils.filename(p)), sizes: ht.sizes });
    check("an HLS segment answered with a web page is never written (not completed; the track holds only TS packets)", pages.length > 0 && hv.state !== "completed" && !ht.written && ht.sizes.every((x) => x % 188 === 0), { state: hv.state, error: hv.error, sizes: ht.sizes });
    check("the stream stops as Link expired when it has bytes, failed when it has none", hv.state === "paused" ? hv.need?.kind === "address" : hv.state === "failed", [hv.state, hv.need, hv.error]);

    // An encrypted segment (AES-128, the 180p rendition) answered with a web page: never decrypted
    // into the file; it reads as not the file, not as "couldn't be decrypted" (review of Phase 1).
    await DL.reset();
    const he = engine.start(`${DL.base}/expire/hls/v180/index.m3u8?how=html200&after=4&k=h-enc`, { mode: "hls", filename: "expired-enc.mp4", named: true });
    const hev = await settled(he, "the encrypted stream with a page for a segment");
    const het = await tracksOf("expired-enc");
    const encPages = (await seen("/expire/hls/v180")).filter((r) => r.expired === "html200");
    check("an encrypted HLS segment answered with a web page is never written and reads as not the file", encPages.length > 0 && hev.state !== "completed" && !het.written && (hev.state === "paused" ? hev.need?.kind === "address" : hev.state === "failed" && /web page/.test(hev.error)), { state: hev.state, need: hev.need, error: hev.error, sizes: het.sizes });

    // A CDN that labels real AES-128 segments text/html, and a segment whose ciphertext starts with
    // '<' (about 1 in 130 do): the stream completes as it did before Phase 1 (review of Phase 1). The
    // stream is the 360p rendition encrypted here with a fixed key and an IV searched for that start.
    const encDir = PathUtils.join(DL.fix, "enc-page");
    await IOUtils.makeDirectory(encDir, { ignoreExisting: true });
    const src = PathUtils.join(DL.fix, "hls", "v360");
    const segs = (await IOUtils.getChildren(src)).filter((p) => p.endsWith(".ts")).sort();
    const rawKey = new Uint8Array(16).fill(0x5a);
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-CBC", false, ["encrypt"]);
    const head = (await IOUtils.read(segs[2], { maxBytes: 16 })).slice();
    let iv = null;
    for (let n = 0; n < 100000 && !iv; n++) {
      const tryIv = new Uint8Array(16);
      new DataView(tryIv.buffer).setUint32(12, n);
      const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: tryIv }, key, head));
      if (c[0] === 0x3c) iv = tryIv;
    }
    for (const p of segs) {
      const bytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, await IOUtils.read(p)));
      await IOUtils.write(PathUtils.join(encDir, PathUtils.filename(p).replace(/\.ts$/, ".html")), bytes);
    }
    await IOUtils.write(PathUtils.join(encDir, "key.bin"), rawKey);
    const lines = (await IOUtils.readUTF8(PathUtils.join(src, "index.m3u8"))).split(/\r?\n/).map((l) => l.replace(/\.ts$/, ".html"));
    const hex = Array.from(iv, (x) => x.toString(16).padStart(2, "0")).join("");
    lines.splice(lines.findIndex((l) => l.startsWith("#EXTINF")), 0, `#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x${hex}`);
    await IOUtils.writeUTF8(PathUtils.join(encDir, "index.m3u8"), lines.join("\n"));
    const third = await IOUtils.read(PathUtils.join(encDir, "seg002.html"), { maxBytes: 1 });
    await DL.reset();
    const hc = engine.start(`${DL.base}/fx/enc-page/index.m3u8`, { mode: "hls", filename: "enc-page.mp4", named: true });
    const hcv = await settled(hc, "the encrypted stream labelled text/html");
    const hcPages = (await seen("/fx/enc-page/")).filter((r) => /\.html$/.test(r.path));
    check("an AES-128 stream whose segments are labelled text/html, one ciphertext starting with '<', completes", third[0] === 0x3c && hcPages.length === segs.length && hcv.state === "completed", { first: third[0], state: hcv.state, need: hcv.need, error: hcv.error, segments: hcPages.length });
  }

  // ---- downloads of unknown length whose address now gives fewer bytes than are saved (review of
  // Phase 1: before the fix these cut the .part and hung the main thread, so they run last) ----
  if (want("shrink")) {
    settings.set({ connections: 1 });
    // A 206 with a smaller total, then a 200 with a smaller Content-Length: neither may cut the .part
    // or complete it.
    for (const [key, query, label] of [
      ["u-b", "short=1048576&xor=1", "a 206 with a smaller total"],
      ["u-b2", "short=1048576&after=norange", "a 200 with a smaller length"],
    ]) {
      await DL.reset();
      const id = engine.start(`${DL.base}/morph/medium?k=${key}&rate=1024&${query}`, { filename: `unknown-${key}.bin`, named: true });
      const p = await pauseAt(id, 3 * MiB, `the download of unknown length (${key})`);
      const sha = await DL.sha256(p.path + ".part");
      await flag(key);
      await DL.reset();
      engine.resume(id);
      const v = await settled(id, `the verdict on ${label}`);
      const listed = engine.list(false).some((x) => x.id === id);
      const reqs = await seen("/morph/medium");
      check(`a download of unknown length whose address now answers ${label}: File changed, the .part untouched, its row still builds`, v.state === "paused" && v.need?.kind === "choice" && (await DL.sha256(p.path + ".part")) === sha && listed && reqs.length === 1, { state: v.state, need: v.need, error: v.error, reqs: brief(reqs) });
    }

    settings.set({ connections });
  }

  // ---- run 1's end: a store whose main copy is unreadable and whose .bak is a version 1 store ----
  if (!want("restart")) return;
  await DL.clean();
  settings.set({ connections: 1 });
  await DL.reset();
  const k = engine.start(`${DL.base}/blob/medium?rate=2048`, { filename: "kept-in-backup.bin", named: true });
  const kp = await pauseAt(k, 3 * MiB, "the download the backup keeps");
  // A text file (served as text/plain; named, so a version 1 record keeps no type for it).
  const kt = engine.start(`${DL.base}/blob/medium?rate=2048&ctype=text/plain`, { filename: "kept-text.bin", named: true });
  await pauseAt(kt, 2 * MiB, "the text file the backup keeps");
  Services.prefs.setStringPref("vitre.test.integrity", JSON.stringify({ received: kp.received, sha: await DL.sha256(kp.path + ".part") }));
  // After the engine's last save at quit, the store is corrupted and its .bak rewritten in version 1 shape.
  await restartWith(
    "a corrupt store with a version 1 backup",
    `const d = await IOUtils.readJSON(store);
    const items = d.items.map((r) => {
      const out = Object.assign({}, r);
      delete out.need;
      delete out.oldParts;
      if (out.file) {
        out.file = Object.assign({}, out.file);
        for (const k of ["contentType", "typeGuessed", "dispositionName", "allowFresh", "silent", "guarded"]) delete out.file[k];
      }
      return out;
    });
    await IOUtils.writeJSON(store + ".bak", { version: 1, items });
    await IOUtils.writeUTF8(store, '{"version":2,"session":{"startedAt":1,"clean":tr');`
  );
});
