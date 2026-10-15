// Phase 6 of spikes/downloader/RESUME-DESIGN.md (section 7, "Streams"; goal G2, 2.6, 4.1-4.3), against the
// local server's /vod-sign, /vod-reenc, /dash-rename, /vod-html and /vod-page.html routes
// (tests/downloads/server.py). The 360p HLS fixture has 12 TS segments of 2 s (24 s); /vod-hold stops a
// stream at a known segment, so each pause lands at the same place:
//   - sign: a variant token expires during a pause (its master is stable): the variant playlist refuses, the
//     master is read again, the same rung is picked, the proof fetches the last written segment once and it
//     hashes to its line, and the download continues at the next sequence: no segment before it is fetched
//     again, every later one exactly once; the segment table holds {i, seq, off, len, h, d} for each segment
//     written, its hashes those of the fixture's segments;
//   - reenc: the same segments re-encoded (/vod-reenc: the same count, other bytes) during a pause: File
//     changed (more than 1 MiB saved), the saved part untouched, nothing fetched but the proof's segment and the
//     next one (the proof runs beside the download, which fetches only the next segment meanwhile: review of
//     Phase 6); the details say "Keeps 0:14 of 0:24"; Keep partial file then saves those 14 s, merged, as
//     "(partial).mp4";
//   - dash: the DASH representations renamed during a pause (/dash-rename: new ids, the old addresses 404):
//     matched by their attributes, the download continues and completes, video and sound joined (24 s);
//   - html: a segment that answers with a web page is never written: the stream stops as Link expired with
//     its TS bytes kept (the renewal attempt at the failure, then the schedule);
//   - damage: bytes flipped in a middle segment of the saved part during a pause (the part modified after its
//     stop): the resume checks every segment against the table, fetches only that segment again, checks it,
//     writes it back at its offset (no other segment is fetched again, not even the proof's), and the part is
//     byte for byte the fixture's segments before the merge;
//   - merge: a stream whose every segment is written, its addresses since expired, joins at once when it
//     continues: no address is asked;
//   - cut: a saved part that lost its last segment and a half (shorter than recorded) is cut at the end of its
//     last good segment and continues from there (4.3: before Phase 6 the track started again from zero);
//   - length: a joined video whose length differs from the playlist's by more than 2% or 2 s says so (4.2);
//   - continue: a stream downloaded from its page's pill, paused, its master and variant tokens expired: Link
//     expired; the page opened again (a fresh master) shows "Continue · N%" on the pill, and pressing it
//     continues the same row from the fresh addresses (no new row, nothing before the proof's segment
//     fetched again), which completes;
//   - gone: the same, but the page now offers only 180p: the picker says "360p is no longer offered", and
//     picking 180p turns the row into File changed.
// From the review of Phase 6 (each reproduces a finding; the reviewed build fails them):
//   - trunc: a finished stream damaged on disk, its playlist since cut to 6 of its 12 segments: Repair refuses
//     (the video on the site is different now) and leaves the file as it was, fetching nothing;
//   - dashmix: a DASH representation renamed AND re-encoded while the run goes on (more than 1 MiB saved): File
//     changed, the part holding only the old encode's chunks; dashlive: renamed with the same bytes mid-run, it
//     is proven by its last written chunk at the new address and continues (the 12 chunks of one encode);
//   - mix: a run proves the old token's playlist, then its segments refuse; the master gives a token whose
//     segments are re-encoded: that playlist is proven again (File changed), never let through by the first proof;
//   - br: HLS byte ranges over one file whose answers carry other validators (two backends taking turns, a new
//     ETag on every answer, and a stable control) complete: an If-Range answered with the whole file decides
//     nothing by itself; brswap: the file swapped during a pause, and while the run goes on, is File changed by
//     its bytes, nothing of the new file written;
//   - init: the init segment refuses (404) on a resume: Link expired, the part untouched, never media segment 0
//     written or judged as the init;
//   - audio: an audio-only download of the master's own audio rendition, its token expired during a pause, is
//     renewed from the master (the rendition's fingerprint kept) and completes;
//   - crash: what a crash saves, the place of the next segment with the count of the one before, in a playlist of
//     segments of differing lengths: it continues after the count (never File changed for ever);
//   - lag: table lines that never reached the journal: the segments counted beyond the last line are fetched
//     again, and the table is whole again;
//   - container: the page opened again in another container never offers Continue for the default container's
//     row, and the engine refuses that Continue, the row keeping its addresses;
//   - first: a first start whose playlist refuses asks it three times, as before Phase 6, and runs no yt-dlp.
// VITRE_DL_ONLY=a,b runs only those sections: sign, reenc, dash, html, damage, merge, cut, length, continue, gone,
// trunc, dashmix, dashlive, mix, br, brswap, init, audio, crash, lag, container, first.
/* global spike, Services, Cc, Ci, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const MiB = 1 << 20;
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const rec = (id) => engine.recs.find((r) => r.id === id);
  const hold = async (k, from) => fetch(`${DL.base}/vod-hold?k=${k}&from=${from}`, { cache: "no-store" });
  const expire = async (k) => fetch(`${DL.base}/vod-expire?k=${k}`, { cache: "no-store" });
  const flag = async (k) => (await fetch(`${DL.base}/flag?k=${k}`, { cache: "no-store" })).json();
  const stem = (p) => p.replace(/\.[^.\\/]+$/, "");
  const partOf = (id) => `${stem(rec(id).path)}.video.part`;
  const v360 = PathUtils.join(DL.fix, "hls", "v360");
  const segFile = (i) => PathUtils.join(v360, `seg${String(i).padStart(3, "0")}.ts`);
  const sizes = [];
  for (let i = 0; i < 12; i++) sizes.push((await IOUtils.stat(segFile(i))).size);
  /** SHA-256 cut to 128 bits, hex: a segment's line in the table (downloads/table.ts segmentHash()). */
  const h128 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).subarray(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  const hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
  /** The download once its run has ended and no renewal attempt runs. */
  const settled = (id, what, test = null) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && v.phase !== "renewing" && ["paused", "failed", "completed", "cancelled"].includes(v.state) && (!test || test(v)) ? v : null;
      },
      { timeout: 90000, interval: 100, what }
    );
  /** Wait until the main track wrote `n` segments (the hold stops it there), then pause. */
  const pauseAt = async (id, n, what) => {
    await waitFor(() => (rec(id)?.stream?.tracks?.[0]?.done ?? 0) >= n, { timeout: 60000, interval: 50, what });
    engine.pause(id);
    return settled(id, what + " to pause");
  };
  /** Requests for a route since the last reset (byte counts settled). */
  const asked = async (prefix) => (await DL.settledStats()).requests.filter((r) => r.path.startsWith(prefix));
  /** How many times each 360p segment was sent whole (by its number) among `reqs`. */
  const wholeSegs = (reqs) => {
    const n = new Array(12).fill(0);
    for (const r of reqs) {
      const m = /seg(\d+)\.ts/.exec(r.path);
      if (m && r.status === 200 && r.sent === sizes[Number(m[1])]) n[Number(m[1])]++;
    }
    return n;
  };
  /** The lines of a stream's segment table journal: headers and segment lines of track k. */
  const tableOf = async (id) => {
    const path = rec(id)?.stream?.journal;
    if (!path) return [];
    return (await IOUtils.readUTF8(path)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };
  const segLines = (lines, k = 0) => {
    const byI = new Map();
    for (const l of lines) {
      if (l.k !== k) continue;
      if (l.deer === 1 && l.stream === 1) {
        if (!l.keep) byI.clear();
      } else if (typeof l.cut === "number") {
        for (const i of [...byI.keys()]) if (i >= l.cut) byI.delete(i);
      } else if (typeof l.h === "string") byI.set(l.i, l);
    }
    return [...byI.values()].sort((a, b) => a.i - b.i);
  };
  const events = (id) => (rec(id)?.events ?? []).map((e) => e.text);
  const duration = async (path) => Number((await DL.probe(path))?.format?.duration);
  const noParts = async () => !(await DL.files()).some((f) => /\.part$|\.d$/.test(f));

  // ---- sign: a variant token expires during a pause; the master is read again ----
  if (want("sign")) {
    await DL.reset();
    await hold("vs", 6);
    const id = engine.start(`${DL.base}/vod-sign/vs/master.m3u8`, { mode: "hls", title: "Signed stream", filename: "signed-stream.mp4", named: true, pageUrl: `${DL.base}/video.html` });
    const p = await pauseAt(id, 6, "six segments");
    check("sign: the stream pauses with six segments written", p.state === "paused" && rec(id).stream.tracks[0].done === 6, [p.state, rec(id).stream.tracks[0].done]);
    const lines = segLines(await tableOf(id));
    let hashesOk = lines.length === 6;
    let off = 0;
    for (const l of lines) {
      const want = await h128(await IOUtils.read(segFile(l.i)));
      if (l.seq !== l.i || l.off !== off || l.len !== sizes[l.i] || l.h !== want || l.d !== 2) hashesOk = false;
      off += l.len;
    }
    check("sign: the segment table has a line {i, seq, off, len, h, d} per written segment, hashed as the fixture's", hashesOk, lines.map((l) => [l.i, l.seq, l.off, l.len, l.d]));
    check("sign: the track keeps its next sequence, its base and the rung picked from the master", rec(id).stream.tracks[0].nextSeq === 6 && rec(id).stream.tracks[0].seq0 === 0 && rec(id).stream.rung?.height === 360, [rec(id).stream.tracks[0].nextSeq, rec(id).stream.tracks[0].seq0, rec(id).stream.rung]);
    await expire("vs");
    await hold("vs", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the signed stream to finish" });
    const reqs = await asked("/vod-sign/vs/");
    const masters = reqs.filter((r) => r.path.startsWith("/vod-sign/vs/master.m3u8") && r.status === 200).length;
    const refused = reqs.filter((r) => r.status === 403).length;
    const n = wholeSegs(reqs);
    log("sign", { state: done.state, error: done.error, masters, refused, segs: n, events: events(id) });
    check("sign: the stream whose variant token expired completes", done.state === "completed" && /\.mp4$/.test(done.filename), [done.state, done.error]);
    check("sign: its variant playlist refused, the master was read again", refused >= 1 && masters === 1, { refused, masters });
    check("sign: it continued at the next sequence: nothing before the proof's segment fetched again, every later one once", n.slice(0, 5).every((x) => x === 0) && n[5] === 1 && n.slice(6).every((x) => x === 1), n);
    check("sign: the history says a new link was found", events(id).some((t) => /New link found/.test(t)), events(id));
    check("sign: the joined video is complete (24 s)", Math.abs((await duration(done.path)) - 24) < 1, await duration(done.path));
    check("sign: no part files are left", await noParts(), await DL.files());
  }

  // ---- reenc: the same count, other bytes: File changed; Keep partial file ----
  if (want("reenc")) {
    await DL.reset();
    await hold("re", 7);
    const id = engine.start(`${DL.base}/vod-reenc/re/hls/v360/index.m3u8`, { mode: "hls", title: "Re-encoded", filename: "reenc.mp4", named: true });
    await pauseAt(id, 7, "seven segments");
    const part = partOf(id);
    const sha = await DL.sha256(part);
    check("reenc: more than 1 MiB is saved", rec(id).stream.tracks[0].bytes > MiB, rec(id).stream.tracks[0].bytes);
    await flag("re");
    await hold("re", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "the re-encoded stream to ask", (x) => x.state !== "paused" || !!x.need);
    const reqs = await asked("/vod-reenc/re/");
    const segs = reqs.filter((r) => /seg\d+\.ts/.test(r.path));
    log("reenc", { state: v.state, need: v.need, keep: v.keep, segs: segs.map((r) => r.path.replace(/.*\//, "")) });
    check("reenc: a stream re-encoded with the same count is File changed", v.state === "paused" && v.need?.kind === "choice", [v.state, v.need]);
    check("reenc: the saved part is untouched", (await DL.sha256(part)) === sha);
    check("reenc: only the proof's segment (the last written) and the next one were fetched", segs.some((r) => /seg006\.ts/.test(r.path)) && segs.every((r) => /seg00[67]\.ts/.test(r.path)) && segs.length <= 2, segs.map((r) => r.path));
    check("reenc: Keep partial keeps the written 14 s of 24", v.keep && Math.round(v.keep.secs) === 14 && Math.round(v.keep.of) === 24 && /\(partial\)\.mp4$/.test(v.keep.name), v.keep);
    ui.panel.show(id);
    await waitFor(() => ui.panel.open && !!b.root.querySelector(".vd-details"), { what: "the panel" });
    await sleep(500);
    const note = b.root.querySelector(".vd-details")?.textContent ?? "";
    check("reenc: the details say what Keep partial keeps (Keeps 0:14 of 0:24)", /Keeps 0:14 of 0:24/.test(note), note.slice(0, 400));
    await spike.capture("stream-expiry-1-file-changed");
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    await engine.keepPartial(id);
    const k = await DL.until(id, ["completed", "failed"], { timeout: 30000, what: "Keep partial" });
    const secs = await duration(k.path);
    check("reenc: Keep partial file saves the written segments merged as (partial).mp4, 14 s", k.state === "completed" && /reenc \(partial\)\.mp4$/.test(k.filename) && Math.abs(secs - 14) < 1, [k.state, k.filename, secs, k.note]);
    check("reenc: its note says how much was kept", /Kept 0:14 of 0:24/.test(k.note), k.note);
    check("reenc: the stream's parts went with it", !(await DL.files()).some((f) => /^reenc\..*part$/.test(f)), await DL.files());
  }

  // ---- dash: renamed representations continue ----
  if (want("dash")) {
    await DL.reset();
    await hold("dr", 6);
    const id = engine.start(`${DL.base}/dash-rename/dr/dash/manifest.mpd`, { mode: "dash", title: "Renamed DASH", filename: "renamed.mp4", named: true });
    await pauseAt(id, 6, "six DASH segments");
    await flag("dr");
    await hold("dr", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the renamed DASH stream" });
    const reqs = await asked("/dash-rename/dr/");
    const video = reqs.filter((r) => /chunk-streamv360-/.test(r.path) && r.status === 200).map((r) => Number(/-(\d+)\.m4s/.exec(r.path)[1]));
    const old = reqs.filter((r) => /stream0[-.]/.test(r.path)).length;
    log("dash", { state: done.state, error: done.error, video, old, url: rec(id).stream.tracks[0].url });
    check("dash: a DASH stream whose representations were renamed continues and completes", done.state === "completed", [done.state, done.error, done.need]);
    check("dash: matched by its attributes, the video track takes the new id", /#vitre-rep=v360$/.test(rec(id).stream.tracks[0].url) && rec(id).stream.dashVideo === "v360", [rec(id).stream.tracks[0].url, rec(id).stream.dashVideo]);
    check("dash: it continued after the written segments (the proof's segment 6, then 7-12)", video.sort((a, b) => a - b).join(",") === "6,7,8,9,10,11,12" && old === 0, { video, old });
    const pr = await DL.probe(done.path);
    const kinds = (pr?.streams ?? []).map((s) => s.codec_type).sort().join(",");
    check("dash: video and sound are joined (24 s)", kinds === "audio,video" && Math.abs(Number(pr?.format?.duration) - 24) < 1, [kinds, pr?.format?.duration]);
  }

  // ---- html: a segment that is a web page is never written ----
  if (want("html")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/vod-html/vh/5/hls/v360/index.m3u8`, { mode: "hls", title: "A page for a segment", filename: "with-page.mp4", named: true });
    const v = await settled(id, "the stream with a page for a segment to wait", (x) => x.state !== "paused" || (!!x.wait && x.wait.tries >= 1 && x.nextAt > Date.now() + 30000));
    const part = partOf(id);
    const bytes = await IOUtils.read(part);
    const text = new TextDecoder("latin1").decode(bytes);
    const pages = (await asked("/vod-html/vh/")).filter((r) => r.page);
    log("html", { state: v.state, need: v.need, wait: v.wait, size: bytes.length, pages: pages.length, events: events(id) });
    // What was written is whole segments before the page, byte for byte the fixture's (never the page).
    let prefix = -1;
    for (let j = 1, sum = 0; j <= 5; j++) {
      sum += sizes[j - 1];
      if (sum === bytes.length) prefix = j;
    }
    let same = prefix > 0;
    for (let i = 0, o = 0; same && i < prefix; o += sizes[i], i++) {
      const want = await IOUtils.read(segFile(i));
      for (let x = 0; x < want.length; x += 4093) if (want[x] !== bytes[o + x]) same = false;
    }
    check("html: a segment answered with a web page is never written (the part holds whole TS segments before it)", pages.length >= 1 && v.state !== "completed" && same && !/<!doctype|<html|Sign in/i.test(text), { size: bytes.length, prefix, pages: pages.length });
    check("html: the stream stops as Link expired with its bytes kept, its next attempt planned", v.state === "paused" && v.need?.kind === "address" && v.wait?.for === "address" && v.nextAt > Date.now(), [v.state, v.need, v.wait]);
    engine.cancel(id);
  }

  // ---- damage: a damaged middle segment is fetched again, alone ----
  if (want("damage")) {
    await DL.reset();
    await hold("dm", 8);
    const id = engine.start(`${DL.base}/vod-sign/dm/master.m3u8`, { mode: "hls", title: "Damaged middle", filename: "damaged.mp4", named: true });
    await pauseAt(id, 8, "eight segments");
    const part = partOf(id);
    const line = segLines(await tableOf(id)).find((l) => l.i === 3);
    // Another program changes segment 3's bytes after the stop (its modified time well after it).
    const at = line.off + 1000;
    const flipped = (await IOUtils.read(part, { offset: at, maxBytes: 64 })).map((x) => x ^ 0xff);
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(part);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(file, 0x02, 0o644, 0);
    s.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, at);
    const out = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    out.setOutputStream(s);
    out.writeByteArray(Array.from(flipped));
    out.close();
    await IOUtils.setModificationTime(part, (rec(id).stream.tracks[0].sealedAt || Date.now()) + 10000);
    await hold("dm", -1);
    await sleep(400);
    await DL.reset();
    let partSha = "";
    engine.hooks.beforeMerge = async (hid) => {
      if (hid === id) partSha = await DL.sha256(part);
    };
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the repaired stream" });
    engine.hooks.beforeMerge = undefined;
    const n = wholeSegs(await asked("/vod-sign/dm/"));
    const whole = new Uint8Array(sizes.reduce((a, x) => a + x, 0));
    let o = 0;
    for (let i = 0; i < 12; i++) {
      const bytes = await IOUtils.read(segFile(i));
      whole.set(bytes, o);
      o += bytes.length;
    }
    log("damage", { state: done.state, segs: n, events: events(id) });
    check("damage: the stream with a damaged middle segment completes", done.state === "completed", [done.state, done.error]);
    check("damage: only that segment was fetched again (and the ones never written)", n.slice(0, 3).every((x) => x === 0) && n[3] === 1 && n.slice(4, 8).every((x) => x === 0) && n.slice(8).every((x) => x === 1), n);
    check("damage: before the merge the part was byte for byte the fixture's segments", partSha === (await hex(whole)), partSha);
    check("damage: the history says a damaged part was fetched again", events(id).some((t) => /1 damaged part fetched again/.test(t)), events(id));
    check("damage: the joined video is complete (24 s)", Math.abs((await duration(done.path)) - 24) < 1);
  }

  // ---- merge: every segment written, the addresses expired: it joins without asking them ----
  if (want("merge")) {
    await DL.reset();
    let id = "";
    let stopped = false;
    engine.hooks.beforeMerge = async (hid) => {
      if (hid === id && !stopped) {
        stopped = true;
        engine.pause(hid);
      }
    };
    id = engine.start(`${DL.base}/vod-sign/mg/master.m3u8`, { mode: "hls", title: "Joined later", filename: "joined-later.mp4", named: true });
    await waitFor(() => stopped, { timeout: 60000, what: "every segment written" });
    await settled(id, "the pause before the merge");
    engine.hooks.beforeMerge = undefined;
    const r = rec(id);
    check("merge: every segment is written", r.stream.tracks.every((t) => t.count > 0 && t.done >= t.count), r.stream.tracks.map((t) => [t.done, t.count]));
    // As a stop between the last segment and the merge leaves it (no merging phase saved).
    r.stream.phase = undefined;
    r.stream.mergeOut = undefined;
    r.stream.mergeBase = undefined;
    await expire("mg");
    await DL.reset();
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 30000, what: "the join" });
    const reqs = await asked("/vod-sign/mg/");
    check("merge: a stream whose every segment is written joins at once, its expired addresses never asked", done.state === "completed" && reqs.length === 0 && Math.abs((await duration(done.path)) - 24) < 1, [done.state, done.error, reqs.length]);
  }

  // ---- cut: a part cut short continues after its last good segment ----
  if (want("cut")) {
    await DL.reset();
    await hold("ct", 8);
    const id = engine.start(`${DL.base}/vod-sign/ct/master.m3u8`, { mode: "hls", title: "Cut short", filename: "cut-short.mp4", named: true });
    await pauseAt(id, 8, "eight segments");
    const part = partOf(id);
    const line6 = segLines(await tableOf(id)).find((l) => l.i === 6);
    // The part loses its last segment and a half (what a disk that lost its last writes leaves).
    const kept = await IOUtils.read(part, { maxBytes: line6.off + Math.floor(line6.len / 2) });
    await IOUtils.write(part, kept);
    await hold("ct", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the stream cut short" });
    const n = wholeSegs(await asked("/vod-sign/ct/"));
    log("cut", { state: done.state, segs: n, events: events(id) });
    check("cut: a part shorter than recorded continues after its last good segment and completes", done.state === "completed" && n.slice(0, 5).every((x) => x === 0) && n[5] === 1 && n.slice(6).every((x) => x === 1), [done.state, n]);
    check("cut: the history says where it continues", events(id).some((t) => /cut short: it continues after 0:12/.test(t)), events(id));
    check("cut: the joined video is complete (24 s)", Math.abs((await duration(done.path)) - 24) < 1);
  }

  // ---- length: the joined video against the playlist's length ----
  if (want("length")) {
    const dir = PathUtils.join(DL.fix, "lie");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const src = (await IOUtils.readUTF8(PathUtils.join(v360, "index.m3u8"))).split(/\r?\n/);
    const lines = src.map((l) => (l.startsWith("#EXTINF:") ? "#EXTINF:4.000000," : l.startsWith("#EXT-X-TARGETDURATION") ? "#EXT-X-TARGETDURATION:4" : /^seg\d+\.ts$/.test(l) ? `../hls/v360/${l}` : l));
    await IOUtils.writeUTF8(PathUtils.join(dir, "index.m3u8"), lines.join("\n"));
    const id = engine.start(`${DL.base}/fx/lie/index.m3u8`, { mode: "hls", title: "Says 48 s", filename: "says-48.mp4", named: true });
    const done = await DL.until(id, ["completed", "failed"], { timeout: 60000, what: "the stream that says 48 s" });
    check("length: a joined video whose length differs from the playlist's says so in its note", done.state === "completed" && /The saved video is 0:24 long; the stream is 0:48/.test(done.note), [done.state, done.note]);
  }

  // ---- continue / gone: the pill on the page opened again ----
  const fromPill = async (k, n) => {
    await DL.reset();
    await hold(k, n);
    await DL.open(`${DL.base}/vod-page.html?k=${k}`, { settle: 1500 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 10000, what: "the pill" });
    const before = new Set(engine.list(false).map((v) => v.id));
    spike.click(b.root.querySelector(".vd-pill-main"), { shiftKey: true });
    const dl = await waitFor(() => engine.list(false).find((v) => !before.has(v.id)), { timeout: 8000, what: "the pill's download" });
    await pauseAt(dl.id, n, `${n} segments from the pill`);
    await expire(k);
    await hold(k, -1);
    await sleep(400);
    engine.resume(dl.id);
    const lx = await settled(dl.id, "Link expired", (x) => x.state !== "paused" || (x.need?.kind === "address" && !!x.wait && x.wait.tries >= 1));
    return { id: dl.id, lx };
  };
  if (want("continue")) {
    const { id, lx } = await fromPill("pc", 6);
    log("continue", { state: lx.state, need: lx.need, quality: lx.quality, key: lx.streamKey });
    check("continue: the stream from the pill, its master and variant expired, is Link expired", lx.state === "paused" && lx.need?.kind === "address" && !!lx.streamKey, [lx.state, lx.need, lx.streamKey]);
    await DL.reset();
    await DL.open(`${DL.base}/vod-page.html?k=pc&again=1`, { settle: 1500 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await waitFor(() => ui.video.state.shown && ui.video.state.mode === "continue", { timeout: 10000, what: "the Continue pill" });
    const pill = b.root.querySelector(".vd-pill");
    await sleep(300);
    await spike.capture("stream-expiry-2-continue-pill");
    check("continue: the pill on the page opened again says Continue with the saved percentage", /Continue/.test(pill.textContent) && new RegExp(`${engine.get(id).total > 0 ? Math.floor((engine.get(id).received / engine.get(id).total) * 100) : 0}%`).test(pill.textContent), pill.textContent);
    const rows = engine.list(false).length;
    spike.click(b.root.querySelector(".vd-pill-main"));
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the continued stream" });
    const n = wholeSegs(await asked("/vod-sign/pc/"));
    log("continue", { state: done.state, error: done.error, segs: n, events: events(id) });
    check("continue: pressing it continues the same row, which completes (no new row)", done.state === "completed" && engine.list(false).length === rows, [done.state, done.error, rows, engine.list(false).length]);
    check("continue: nothing written before was fetched again but the proof's segment", n.slice(0, 5).every((x) => x === 0) && n[5] === 1 && n.slice(6).every((x) => x === 1), n);
    check("continue: the joined video is complete (24 s)", Math.abs((await duration(done.path)) - 24) < 1);
  }
  if (want("gone")) {
    const { id, lx } = await fromPill("pg", 6);
    check("gone: the stream from the pill is Link expired", lx.state === "paused" && lx.need?.kind === "address" && lx.quality === "360p", [lx.state, lx.need, lx.quality]);
    await DL.open(`${DL.base}/vod-page.html?k=pg&only=180`, { settle: 1500 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await waitFor(() => ui.video.state.shown && ui.video.state.mode === "continue", { timeout: 10000, what: "the Continue pill" });
    spike.click(b.root.querySelector(".vd-pill-main"));
    await waitFor(() => ui.video.picker.isOpen, { timeout: 5000, what: "the picker" });
    await sleep(500);
    const picker = ui.video.picker.element;
    await spike.capture("stream-expiry-3-quality-gone");
    check("gone: the picker says the row's quality is no longer offered", /360p is no longer offered/.test(picker.textContent), picker.textContent);
    spike.click(picker.querySelector(".vd-go"));
    const v = await waitFor(() => (engine.get(id)?.need?.kind === "choice" ? engine.get(id) : null), { timeout: 5000, what: "File changed" });
    check("gone: picking another quality turns the row into File changed, that quality kept for Start over", v.state === "paused" && /no longer offered/.test(v.need.evidence) && rec(id).need?.candidate?.stream?.quality === "180p", [v.state, v.need, rec(id).need?.candidate?.stream]);
    // The panel opens on the row's choice (Start over with the new file, Keep partial file).
    await waitFor(() => ui.panel.open, { timeout: 5000, what: "the panel on the File changed row" });
    await sleep(700);
    await spike.capture("stream-expiry-4-gone-file-changed");
    const focused = document.activeElement?.textContent ?? "";
    check("gone: the panel opens on the row with focus on its first choice", /Start over/.test(focused), focused);
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    // Every vod-page.html load is the same page, title and length (one stable key): the next section's pill
    // must not find this row.
    engine.cancel(id);
  }

  // ======== From the review of Phase 6: each section reproduces a finding of the review ========

  /** Bytes changed in place (another program's write), the modified time kept or set. */
  const overwrite = async (path, at, count, mtime = null) => {
    const keep = (await IOUtils.stat(path)).lastModified;
    const bytes = (await IOUtils.read(path, { offset: at, maxBytes: count })).map((x) => x ^ 0xff);
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(file, 0x02, 0o644, 0);
    s.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, at);
    const out = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    out.setOutputStream(s);
    out.writeByteArray(Array.from(bytes));
    out.close();
    await IOUtils.setModificationTime(path, mtime ?? keep);
  };
  /** The files joined, as one array (what a part holds when it is those segments). */
  const joined = async (paths) => {
    const parts = [];
    for (const p of paths) parts.push(await IOUtils.read(p));
    const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of parts) {
      all.set(x, o);
      o += x.length;
    }
    return all;
  };
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  /** A part's bytes and SHA-256, empty when it is gone (merged away by a build that let the stream through). */
  const readPart = (path, opts) => IOUtils.read(path, opts).catch(() => new Uint8Array(0));
  const shaOf = (path) => DL.sha256(path).catch(() => "");
  /** How many times each segment `re` names (its number) was sent whole with a 200 among `reqs`. */
  const sentWhole = (reqs, re, n, sizeOf) => {
    const out = new Array(n).fill(0);
    for (const r of reqs) {
      const m = re.exec(r.path);
      if (m && r.status === 200 && r.sent === sizeOf(Number(m[1]))) out[Number(m[1])]++;
    }
    return out;
  };
  /** Stopped for good: completed, failed, File changed, or Link expired with an attempt of the schedule made. */
  const ended = (x) => x.state !== "paused" || x.need?.kind === "choice" || (x.need?.kind === "address" && !!x.wait && x.wait.tries >= 1);

  // ---- trunc: Repair of a finished stream against a shorter playlist refuses (review finding 1) ----
  if (want("trunc")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/vod-trunc/tr/hls/v360/index.m3u8`, { mode: "hls", title: "Shortened later", filename: "shortened.mp4", named: true });
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the stream to finish" });
    await waitFor(() => !!rec(id)?.sha256 && !!rec(id)?.final, { timeout: 20000, what: "its SHA-256" });
    const path = done.path;
    const before = await duration(path);
    await overwrite(path, Math.floor((await IOUtils.stat(path)).size / 2), 1);
    const sha = await DL.sha256(path);
    await engine.checkFile(id);
    await waitFor(() => (engine.get(id).phase === "" && engine.get(id).need?.kind === "repair" ? engine.get(id) : null), { timeout: 30000, what: "Damaged" });
    await flag("tr");
    await DL.reset();
    await engine.repair(id);
    const v = engine.get(id);
    const after = await duration(path);
    const segs = (await asked("/vod-trunc/tr/")).filter((r) => /seg\d+\.ts/.test(r.path)).length;
    log("trunc", { before, after, need: v.need, check: v.check, events: events(id), segs });
    check("trunc: Repair against a playlist that now lists 6 of the 12 segments leaves the file as it was", Math.abs(after - before) < 1 && (await DL.sha256(path)) === sha, { before, after });
    check("trunc: it refuses as the video on the site being different, with no segment fetched", v.check?.site === "changed" && events(id).some((t) => /Repair stopped: the video on the site is different now/.test(t)) && segs === 0, { check: v.check, events: events(id), segs });
  }

  // ---- dashmix / dashlive: a DASH representation renamed while the run goes on (review finding 2) ----
  const dashChunks = PathUtils.join(DL.fix, "dash");
  const chunkFile = (i) => PathUtils.join(dashChunks, `chunk-stream0-${String(i).padStart(5, "0")}.m4s`);
  const chunkSize = [];
  for (let i = 1; i <= 12; i++) chunkSize[i] = (await IOUtils.stat(chunkFile(i))).size;
  for (const [section, reenc] of [["dashmix", true], ["dashlive", false]]) {
    if (!want(section)) continue;
    const k = reenc ? "dx" : "dl";
    await DL.reset();
    await hold(k, 8);
    const id = engine.start(`${DL.base}/dash-rename/${k}/dash/manifest.mpd`, { mode: "dash", title: `Renamed mid-run ${k}`, filename: `${section}.mp4`, named: true });
    await waitFor(() => (rec(id)?.stream?.tracks?.[0]?.done ?? 0) >= 8, { timeout: 60000, interval: 50, what: "eight video chunks" });
    const part = partOf(id);
    let atMerge = null;
    engine.hooks.beforeMerge = async (hid) => {
      if (hid === id) atMerge = await IOUtils.read(part);
    };
    await flag(k);
    if (reenc) await flag(`${k}-reenc`);
    await hold(k, -1);
    const v = await settled(id, `the stream renamed mid-run (${section})`, (x) => x.state !== "paused" || !!x.need);
    engine.hooks.beforeMerge = undefined;
    const reqs = await asked(`/dash-rename/${k}/`);
    const v360 = reqs.filter((r) => /chunk-streamv360-/.test(r.path) && r.status === 200).map((r) => Number(/-(\d+)\.m4s/.exec(r.path)[1]));
    const old8 = await joined([PathUtils.join(dashChunks, "init-stream0.m4s"), ...[1, 2, 3, 4, 5, 6, 7, 8].map(chunkFile)]);
    const all12 = await joined([PathUtils.join(dashChunks, "init-stream0.m4s"), ...Array.from({ length: 12 }, (_, i) => chunkFile(i + 1))]);
    log(section, { state: v.state, need: v.need, error: v.error, v360, url: rec(id).stream.tracks[0].url, events: events(id) });
    if (reenc) {
      const bytes = await readPart(part);
      check("dashmix: renamed AND re-encoded mid-run (more than 1 MiB saved) is File changed: the part holds the 8 chunks of the old encode, nothing re-encoded written", v.state === "paused" && v.need?.kind === "choice" && atMerge === null && sameBytes(bytes, old8), { state: v.state, need: v.need, size: bytes.length, want: old8.length });
      check("dashmix: the proof asked only the last written chunk at the new address", v360.every((x) => x === 8) && v360.length >= 1, v360);
      engine.cancel(id);
    } else {
      check("dashlive: renamed mid-run with the same bytes, proven by its last written chunk, continues and completes", v.state === "completed" && /#vitre-rep=v360$/.test(rec(id).stream.tracks[0].url), [v.state, v.error, rec(id).stream.tracks[0].url]);
      check("dashlive: before the merge the part is the 12 chunks of the one encode", !!atMerge && sameBytes(atMerge, all12), atMerge?.length);
      // A chunk whose first request waited out the rename may be raced as well (the hedge), never one written.
      check("dashlive: at the new address only the proof's chunk 8 and the ones never written were fetched", [...new Set(v360)].sort((a, b) => a - b).join(",") === "8,9,10,11,12", v360);
    }
  }

  // ---- mix: a proof of one playlist never stands for another (review finding 3) ----
  if (want("mix")) {
    await DL.reset();
    await hold("mx", 6);
    const id = engine.start(`${DL.base}/vod-sign/mx/master.m3u8`, { mode: "hls", title: "Proven once", filename: "mix.mp4", named: true });
    await pauseAt(id, 6, "six segments");
    const part = partOf(id);
    const sha = await DL.sha256(part);
    // The old token's variant answers once more and then refuses, and its segments from 6 on refuse; a token
    // minted from now on serves the same segments re-encoded.
    await fetch(`${DL.base}/vod-trap?k=mx&from=6`, { cache: "no-store" });
    await hold("mx", -1);
    await sleep(400);
    await DL.reset();
    let atMerge = false;
    engine.hooks.beforeMerge = async (hid) => {
      if (hid === id) atMerge = true;
    };
    engine.resume(id);
    const v = await settled(id, "the trapped stream to stop", ended);
    engine.hooks.beforeMerge = undefined;
    const reqs = await asked("/vod-sign/mx/");
    const reenc = reqs.filter((r) => r.reenc).map((r) => r.path.replace(/.*\//, ""));
    log("mix", { state: v.state, need: v.need, events: events(id), reenc, segs: reqs.filter((r) => /seg\d+/.test(r.path)).map((r) => `${r.path.replace(/.*\//, "")}:${r.status}${r.reenc ? ":reenc" : ""}`) });
    check("mix: the re-encoded stream found through the master is proven again and is File changed", v.state === "paused" && v.need?.kind === "choice" && !atMerge, [v.state, v.need]);
    check("mix: the part is untouched, and only the proof's segment was asked re-encoded", (await shaOf(part)) === sha && reenc.every((x) => x === "seg005.ts"), reenc);
    engine.cancel(id);
  }

  // ---- br: byte ranges of one file whose answers differ in their validators (review findings 4 and 13) ----
  const brSize = (i) => sizes[i];
  if (want("br")) {
    for (const be of ["flap", "edge", "stable"]) {
      await DL.reset();
      const k = `b${be}`;
      const id = engine.start(`${DL.base}/vod-br/${k}/index.m3u8?be=${be}`, { mode: "hls", title: `Byte ranges (${be})`, filename: `br-${be}.mp4`, named: true });
      let atMerge = null;
      engine.hooks.beforeMerge = async (hid) => {
        if (hid === id) atMerge = await IOUtils.read(partOf(id));
      };
      const v = await settled(id, `the byte-range stream (${be})`, (x) => x.state !== "paused" || !!x.need);
      engine.hooks.beforeMerge = undefined;
      const reqs = await asked(`/vod-br/${k}/all.ts`);
      log(`br-${be}`, { state: v.state, need: v.need, error: v.error, answers: reqs.map((r) => r.status).join(","), ifRange: reqs.filter((r) => r.ifrange).length });
      check(`br ${be}: a byte-range stream whose answers carry other validators completes (2.4 R6: headers never decide alone)`, v.state === "completed" && Math.abs((await duration(v.path)) - 24) < 1, [v.state, v.need, v.error]);
      check(`br ${be}: before the merge the part is the 12 segments`, !!atMerge && sameBytes(atMerge, await joined(Array.from({ length: 12 }, (_, i) => segFile(i)))), atMerge?.length);
    }
    void brSize;
  }
  if (want("brswap")) {
    // The one file swapped during a pause: the bytes say so (File changed, the part untouched).
    await DL.reset();
    await hold("bsw", 7);
    const id = engine.start(`${DL.base}/vod-br/bsw/index.m3u8?be=stable`, { mode: "hls", title: "Byte ranges swapped", filename: "br-swapped.mp4", named: true });
    await pauseAt(id, 7, "seven pieces");
    const part = partOf(id);
    const sha = await DL.sha256(part);
    await flag("bsw");
    await hold("bsw", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "the swapped byte-range stream", (x) => x.state !== "paused" || !!x.need);
    log("brswap", { state: v.state, need: v.need });
    check("brswap: the file swapped during a pause is File changed by its bytes, the part untouched", v.state === "paused" && v.need?.kind === "choice" && (await shaOf(part)) === sha, [v.state, v.need]);
    engine.cancel(id);
    // The file swapped while the run goes on: an If-Range answered with the whole new file is checked against
    // the last written piece (R4), which differs: File changed, nothing of the new file written.
    await DL.reset();
    await hold("brr", 7);
    const id2 = engine.start(`${DL.base}/vod-br/brr/index.m3u8?be=stable`, { mode: "hls", title: "Byte ranges swapped mid-run", filename: "br-swapped-run.mp4", named: true });
    await waitFor(() => (rec(id2)?.stream?.tracks?.[0]?.done ?? 0) >= 7, { timeout: 60000, interval: 50, what: "seven pieces" });
    const part2 = partOf(id2);
    await flag("brr");
    await hold("brr", -1);
    const v2 = await settled(id2, "the byte-range stream swapped mid-run", (x) => x.state !== "paused" || !!x.need);
    const bytes = await readPart(part2);
    log("brswap mid-run", { state: v2.state, need: v2.need, size: bytes.length });
    check("brswap: the file swapped mid-run is File changed and the part holds only the 7 pieces of the old file", v2.state === "paused" && v2.need?.kind === "choice" && sameBytes(bytes, await joined(Array.from({ length: 7 }, (_, i) => segFile(i)))), [v2.state, v2.need, bytes.length]);
    engine.cancel(id2);
  }

  // ---- init: a refused init segment is never answered with a media segment (review finding 5) ----
  if (want("init")) {
    await DL.reset();
    await hold("in", 4);
    const id = engine.start(`${DL.base}/vod-init/in/hlsfmp4/master.m3u8`, { mode: "hls", title: "Its init gone", filename: "init-gone.mp4", named: true });
    await pauseAt(id, 4, "four fMP4 segments");
    const part = partOf(id);
    const sha = await DL.sha256(part);
    await flag("in");
    await hold("in", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "the stream whose init is refused", ended);
    const head = String.fromCharCode(...(await readPart(part, { maxBytes: 8 })).subarray(4, 8));
    log("init", { state: v.state, need: v.need, wait: v.wait, head, events: events(id) });
    check("init: a refused init segment leaves the row Link expired, the part untouched and still starting with its ftyp", v.state === "paused" && v.need?.kind === "address" && (await shaOf(part)) === sha && head === "ftyp", [v.state, v.need, head]);
    engine.cancel(id);
  }

  // ---- audio: an audio-only download of the master's own audio rendition renews (review finding 7) ----
  if (want("audio")) {
    await DL.reset();
    await hold("au", 5);
    const master = await (await fetch(`${DL.base}/vod-asign/au/master.m3u8`, { cache: "no-store" })).text();
    const tok = /URI="(t\d+)\/audio\//.exec(master)[1];
    // As the picker started "Audio only" for such a master before this review (no fingerprint): a row like it
    // must renew too, its rendition found as the picker finds it and the proof deciding.
    const id = engine.start(`${DL.base}/vod-asign/au/master.m3u8`, { mode: "hls", variantUrl: `${DL.base}/vod-asign/au/${tok}/audio/index.m3u8`, audioOnly: true, quality: "M4A", title: "Sound only", filename: "sound-only.m4a", named: true });
    await pauseAt(id, 5, "five audio segments");
    await expire("au");
    await hold("au", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "the audio rendition", (x) => x.state !== "paused" || !!x.need);
    const audioDir = PathUtils.join(DL.fix, "hlsfmp4", "audio");
    const aSize = [];
    for (let i = 0; i < 13; i++) aSize.push((await IOUtils.stat(PathUtils.join(audioDir, `seg${String(i).padStart(3, "0")}.m4s`))).size);
    const n = sentWhole(await asked("/vod-asign/au/"), /audio\/seg(\d+)\.m4s/, 13, (i) => aSize[i]);
    log("audio", { state: v.state, need: v.need, error: v.error, segs: n, rung: rec(id).stream.rung ?? null, events: events(id) });
    check("audio: the audio rendition whose token expired is renewed from the master and completes", v.state === "completed", [v.state, v.need, v.error]);
    check("audio: it continued after its written segments (the proof's segment 4, then 5 on)", n.slice(0, 4).every((x) => x === 0) && n[4] === 1 && n.slice(5).every((x) => x === 1), n);
    check("audio: the rendition's fingerprint is kept for the next renewal", rec(id).stream.rung?.audioOnly === true && rec(id).stream.rung?.audioName === "audio_1", rec(id).stream.rung);
  }

  // ---- crash: the place a crash saved a segment ahead of the count (review finding 8) ----
  if (want("crash")) {
    // Segments of differing lengths (as a scene-cut segmenter cuts them), over the 360p fixture's segments.
    const d = [6.006, 4.004, 6.006, 2.002, 5.005, 6.006, 3.003, 6.006, 4.004, 6.006, 2.002, 5.005];
    const dir = PathUtils.join(DL.fix, "vary");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const text = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:7", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", ...d.flatMap((x, i) => [`#EXTINF:${x.toFixed(3)},`, `../hls/v360/seg${String(i).padStart(3, "0")}.ts`]), "#EXT-X-ENDLIST"].join("\n");
    await IOUtils.writeUTF8(PathUtils.join(dir, "index.m3u8"), text);
    await DL.reset();
    await hold("cr", 7);
    const id = engine.start(`${DL.base}/vod-reenc/cr/vary/index.m3u8`, { mode: "hls", title: "Saved a step ahead", filename: "crash-ahead.mp4", named: true });
    await pauseAt(id, 7, "seven segments of differing lengths");
    // What a crash (or a disk error) saved: the count of the segments certainly on disk (6, more than 1 MiB),
    // with the place of the next one the run had already moved to (nextSeq 7, the duration of segment 6).
    const lines = segLines(await tableOf(id));
    Object.assign(rec(id).stream.tracks[0], { done: 6, bytes: lines[5].off + lines[5].len, secs: d.slice(0, 6).reduce((a, x) => a + x, 0), nextSeq: 7, lastDur: d[6] });
    await hold("cr", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "the stream saved a step ahead", (x) => x.state !== "paused" || !!x.need);
    const n = wholeSegs(await asked("/vod-reenc/cr/"));
    log("crash", { state: v.state, need: v.need, error: v.error, segs: n });
    check("crash: a stream whose saved place ran ahead of its count continues and completes (never File changed for ever)", v.state === "completed", [v.state, v.need, v.error]);
    check("crash: it continued after the count: segment 6 again, nothing before it but the proof's segment 5", n.slice(0, 5).every((x) => x === 0) && n[5] === 1 && n.slice(6).every((x) => x === 1), n);
  }

  // ---- lag: table lines that never reached the journal (review finding 9) ----
  if (want("lag")) {
    await DL.reset();
    await hold("lg", 8);
    const id = engine.start(`${DL.base}/vod-sign/lg/master.m3u8`, { mode: "hls", title: "Lines behind", filename: "lines-behind.mp4", named: true });
    await pauseAt(id, 8, "eight segments");
    // The journal lost the lines of segments 6 and 7 (a kill between the count's save and the table's next
    // tick); the engine reads it again.
    await IOUtils.writeUTF8(rec(id).stream.journal, JSON.stringify({ k: 0, cut: 6 }) + "\n", { mode: "append" });
    engine.tables.delete(id);
    await hold("lg", -1);
    await sleep(400);
    await DL.reset();
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the stream whose lines lag" });
    const n = wholeSegs(await asked("/vod-sign/lg/"));
    log("lag", { state: done.state, error: done.error, segs: n });
    check("lag: segments counted beyond the table's last line are fetched again, not trusted unchecked, and it completes", done.state === "completed" && n.slice(0, 5).every((x) => x === 0) && n[5] === 1 && n.slice(6).every((x) => x === 1), [done.state, n]);
    check("lag: the table holds a line for every segment again", segLines(await tableOf(id)).length === 12, segLines(await tableOf(id)).length);
  }

  // ---- container: the pill's Continue never crosses containers (review finding 6) ----
  if (want("container")) {
    const { id, lx } = await fromPill("cx", 6);
    check("container: the stream from the pill (default container) is Link expired", lx.state === "paused" && lx.need?.kind === "address", [lx.state, lx.need]);
    const source = rec(id).stream.sourceUrl;
    Services.prefs.setBoolPref("privacy.userContext.enabled", true);
    const node = gBrowser.addTab(`${DL.base}/vod-page.html?k=cx&again=1`, { userContextId: 1, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    gBrowser.selectedTab = node;
    await waitFor(() => !node.linkedBrowser.webProgress?.isLoadingDocument && /vod-page/.test(node.linkedBrowser.currentURI.spec), { timeout: 20000, what: "the page in another container" });
    await sleep(1500);
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5, browser: node.linkedBrowser });
    await waitFor(() => ui.video.state.shown && !!ui.video.state.mode, { timeout: 10000, what: "the pill in the other container" });
    await sleep(500);
    const mode = ui.video.state.mode;
    const opt = ui.video.state.offer?.options.find((o) => o.label === "360p");
    const r = opt ? engine.renewWith(id, opt, { identity: { userContextId: 1, isPrivate: false } }) : "no option";
    log("container", { mode, r, row: rec(id).identity.userContextId, url: rec(id).url });
    check("container: the pill in another container offers a download of its own, never Continue for the default container's row", mode === "found", mode);
    check("container: the engine refuses that container's Continue too, and the row keeps its addresses", r === "busy" && engine.get(id).state === "paused" && !rec(id).stream.prior && rec(id).stream.sourceUrl === source, [r, engine.get(id).state, rec(id).stream.sourceUrl, source]);
    gBrowser.removeTab(node);
    engine.cancel(id);
  }

  // ---- first: a first start whose playlist refuses (review findings 10 and 15) ----
  if (want("first")) {
    const py = Services.env.get("VITRE_DL_PY");
    const root = PathUtils.parent(Services.env.get("VITRE_DL_LOCK"), 4);
    const fakeLog = Services.env.get("VITRE_FAKE_YTDLP_LOG") || PathUtils.join(PathUtils.tempDir, "vitre-fake-ytdlp.log");
    await IOUtils.remove(fakeLog, { ignoreAbsent: true });
    Services.prefs.setStringPref("vitre.tools.ytdlpCommand", JSON.stringify([py, PathUtils.join(root, "tests", "downloads", "fake_ytdlp.py")]));
    try {
      check("first: the stand-in yt-dlp counts as installed", engine.hasYtdlp());
      await DL.reset();
      // A variant address whose token never existed: every answer is 403.
      const id = engine.start(`${DL.base}/vod-sign/fs/t0/v360/index.m3u8`, { mode: "hls", title: "Refused from the start", filename: "refused.mp4", named: true, pageUrl: `${DL.base}/video.html` });
      const v = await settled(id, "the refused first start", (x) => x.state !== "paused" || !!x.need);
      const lists = (await asked("/vod-sign/fs/")).filter((r) => /index\.m3u8/.test(r.path)).map((r) => r.status);
      let calls = "";
      try {
        calls = await IOUtils.readUTF8(fakeLog);
      } catch {}
      log("first", { state: v.state, error: v.error, lists, calls });
      check("first: a first start whose playlist refuses asks it three times, as before Phase 6, and fails", v.state === "failed" && lists.length === 3 && lists.every((s) => s === 403), [v.state, lists]);
      check("first: yt-dlp is never run for a stream with nothing to renew", !/-J/.test(calls), calls);
      engine.cancel(id);
    } finally {
      Services.prefs.clearUserPref("vitre.tools.ytdlpCommand");
    }
  }

  log("files", await DL.files());
});
