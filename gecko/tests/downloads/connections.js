// Connections that keep up on a big file (IDM comparison, 2026-10-20): the 256 MiB file on 8 connections,
//   1. the .part is sparse (workers/flush.js FSCTL_SET_SPARSE), so writes far into a big file never wait
//      while NTFS fills the gap before them with zeros (3.4 s at 35 GB on NVMe, minutes on a hard disk);
//   2. one part's server keeps failing (500, four times): that connection steps aside while the other seven
//      go on; the download never stops to wait (it used to: three failures on one connection stopped all
//      eight and waited 10 s before starting them all again), completes, and its sha256 matches. Control:
//      connections that run evenly are never cut;
//   3. one part's first answer crawls at 16 KB/s while the others run at 1 MB/s: after about 16 s it is cut
//      and asked again at once on a new connection, which runs at full speed;
//   4. one part's connection is reset after 2 MiB, three times: each time it is asked again at once (IDM:
//      0.01 s; Deer used to wait 2 s), and the diagnostics count the resets;
//   5. a host that caps every answer at 8 MiB: each short but clean 206 is followed at once by the next ask,
//      never a failure or a wait;
//   6. a slow line (128 KB/s per connection, below the old 256 KB/s gate): one connection goes silent after
//      512 KiB and is cut after about 10 s of silence (the idle timeout took 30 s), another crawls at 8 KB/s
//      and is cut after about 16 s;
//   7. control: an even 96 KB/s on every connection is never cut;
//   8. a proxy host's 520 (Cloudflare) on one part, four times: retried on that connection, which steps aside;
//      the run never stops to wait (a 520 used to stop all eight);
//   9. a 404 on one part mid-run (with the others receiving): that connection leaves for the run, the others
//      take its part, and the download never pauses as "Link expired". (A 404 before anything arrived still
//      fails the download, as before.)
//  10. the finished file is not sparse (Windows refuses to mount a sparse ISO, VHD or VHDX);
//  11. a server that sends one answer's head at once and its body 16 s later: never cut as a stall or as slow
//      (the time before the first byte is the idle timeout's; the slow rule used to count it and cut it);
//  12. an outage mid-run (every connection cut, then 502 on every ask): the run stops and waits within about
//      10 s, no connection steps aside (it used to keep going about 18 s more with 0 B/s);
//  13. every connection refused at once mid-run (cut, then 404 on every ask): the row pauses as Link expired,
//      never Failed (lanes no longer all retire together);
//  14. the room a sparse download still needs (a sparse .part holds no room ahead of its writes): a fresh one
//      needs the whole file, a second download on the same disk also counts what the first has left to write,
//      and a resumed .part counts what it does not hold yet (workers/flush.js 'held').
/* global spike, Services, ChromeUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const engine = DL.engine;
  const MiB = 1 << 20;
  const page = DL.base + "/page.html";
  await DL.open(page);

  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const k32 = ctypes.open("kernel32.dll");
  const GetFileAttributesW = k32.declare("GetFileAttributesW", ctypes.winapi_abi, ctypes.uint32_t, ctypes.char16_t.ptr);
  const SPARSE = 0x200;

  /** Run a download to its end, noting every state it passed and the most its transfer counted. */
  const follow = async (id, timeout) => {
    const states = new Set();
    let most = { reconnects: 0, stepAsides: 0 };
    let cutAt = 0;
    let diag = null;
    const t0 = Date.now();
    for (;;) {
      const v = DL.view(id);
      if (v) states.add(v.state + (v.wait ? ":wait" : ""));
      const info = engine.transferInfo(id);
      if (info) {
        if (info.reconnects > most.reconnects && !cutAt) cutAt = Date.now() - t0;
        most = { reconnects: Math.max(most.reconnects, info.reconnects), stepAsides: Math.max(most.stepAsides, info.stepAsides) };
        if (info.diag) diag = info.diag;
      }
      const done = v && ["completed", "failed", "cancelled"].includes(v.state);
      if (done || Date.now() - t0 > timeout) return { v, states: [...states], most, cutAt, diag, ends: endsOf(diag), secs: (Date.now() - t0) / 1000, timedOut: !done };
      await sleep(200);
    }
  };
  /** How the answers of all connections ended, summed (diagnostics). */
  const endsOf = (diag) => {
    const out = {};
    for (const lane of diag?.lanes ?? []) for (const [k, n] of Object.entries(lane.ends)) out[k] = (out[k] ?? 0) + n;
    return out;
  };
  const neverPaused = (r) => !r.states.some((s) => s.startsWith("paused"));

  // ---- 1. the .part is sparse ----
  await DL.reset();
  const id1 = engine.start(`${DL.base}/blob/big?rate=256`, { pageUrl: page });
  const v1 = await DL.until(id1, ["downloading"], { test: (v) => v.received > 2 * MiB, timeout: 30000, what: "the first bytes" });
  const part = v1.path + ".part";
  const attrs = GetFileAttributesW(part);
  log("part", part, "attributes", "0x" + attrs.toString(16));
  check("the .part of a ranged download is sparse", attrs !== 0xffffffff && (attrs & SPARSE) === SPARSE, "0x" + attrs.toString(16));
  engine.cancel(id1);
  await DL.until(id1, ["cancelled"], { timeout: 10000 });
  engine.remove(id1);

  // ---- 2. one part keeps failing: that connection steps aside, the rest go on ----
  await DL.reset();
  const region3 = `${96 * MiB}-${128 * MiB}`;
  const id2 = engine.start(`${DL.base}/blob/big?rate=2048&fail=${region3}&failn=4`, { pageUrl: page });
  const r2 = await follow(id2, 150000);
  log("failing part", { states: r2.states, most: r2.most, secs: r2.secs, error: r2.v?.error });
  check("the download completed", r2.v?.state === "completed", [r2.v?.state, r2.v?.error]);
  check("it never stopped to wait (one connection's failures no longer stop all eight)", !r2.states.some((s) => s.startsWith("paused")), r2.states);
  check("the failing connection stepped aside", r2.most.stepAsides >= 1, r2.most);
  check("control: connections running evenly are never cut", r2.most.reconnects === 0, r2.most);
  const st2 = await DL.stats();
  const failed = st2.requests.filter((r) => r.fault === "fail");
  check("the server refused that part four times, then served it", failed.length === 4 && st2.requests.some((r) => r.status === 206 && r.start >= 96 * MiB && r.start < 128 * MiB && r.sent > 0), failed.length);
  check("sha256 matches", r2.v?.state === "completed" && (await DL.sha256(r2.v.path)) === m["big.bin"].sha256);
  const done2 = r2.v?.state === "completed" ? GetFileAttributesW(r2.v.path) : 0xffffffff;
  check("the finished file is not sparse (Windows mounts ISO/VHD only when it is not)", done2 !== 0xffffffff && (done2 & SPARSE) === 0, "0x" + done2.toString(16));

  // ---- 3. one part's answer crawls: it is cut and asked again on a new connection ----
  await DL.reset();
  const lo = 160 * MiB;
  const hi = 192 * MiB;
  const id3 = engine.start(`${DL.base}/blob/big?rate=1024&slow=${lo}-${hi}&slowrate=16`, { pageUrl: page });
  const r3 = await follow(id3, 150000);
  log("slow part", { states: r3.states, most: r3.most, cutAt: r3.cutAt, secs: r3.secs, error: r3.v?.error });
  check("the download completed", r3.v?.state === "completed", [r3.v?.state, r3.v?.error]);
  check("the crawling connection was cut and asked again", r3.most.reconnects >= 1 && r3.cutAt > 0 && r3.cutAt < 26000, { most: r3.most, cutAt: r3.cutAt });
  const st3 = await DL.stats();
  const inRegion = st3.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.start >= lo && r.start < hi).sort((a, b) => a.t - b.t);
  log("requests in the slow part", inRegion.map((r) => ({ start: r.start, sent: r.sent, secs: r.secs, port: r.port })));
  check("the new request picked up where the slow one stopped, on another connection", inRegion.length >= 2 && inRegion[1].port !== inRegion[0].port && inRegion[1].start > inRegion[0].start && inRegion[1].start <= inRegion[0].start + inRegion[0].sent, inRegion.slice(0, 2));
  check("sha256 matches", r3.v?.state === "completed" && (await DL.sha256(r3.v.path)) === m["big.bin"].sha256);

  // ---- 4. resets after progress: asked again at once ----
  await DL.reset();
  const r4 = await follow(engine.start(`${DL.base}/blob/big?rate=1024&reset=${96 * MiB}-${128 * MiB}&resetafter=${2 * MiB}&resetn=3`, { pageUrl: page }), 150000);
  log("resets", { states: r4.states, ends: r4.ends, all: r4.diag?.reconnectsAll, secs: r4.secs, error: r4.v?.error });
  check("resets: completed, never paused", r4.v?.state === "completed" && neverPaused(r4), [r4.v?.state, r4.states, r4.v?.error]);
  const st4 = (await DL.stats()).requests.filter((r) => r.path.startsWith("/blob/big") && r.start >= 96 * MiB && r.start < 128 * MiB).sort((a, b) => a.t - b.t);
  const gaps4 = [];
  for (let i = 0; i + 1 < st4.length; i++) if (st4[i].fault === "reset") gaps4.push(+(st4[i + 1].t - (st4[i].t + st4[i].secs)).toFixed(2));
  log("reset to next request (s)", gaps4);
  check("each reset is followed by the next ask within 0.5 s (it used to be 2 s)", gaps4.length === 3 && gaps4.every((g) => g < 0.5), gaps4);
  check("the diagnostics count the resets and reconnects", (r4.ends.reset ?? 0) >= 3 && (r4.diag?.reconnectsAll ?? 0) >= 3, { ends: r4.ends, all: r4.diag?.reconnectsAll });
  check("sha256 matches (resets)", r4.v?.state === "completed" && (await DL.sha256(r4.v.path)) === m["big.bin"].sha256);

  // ---- 5. a host that caps every answer: the next ask follows at once ----
  await DL.reset();
  const r5 = await follow(engine.start(`${DL.base}/blob/big?rate=4096&capresp=${8 * MiB}`, { pageUrl: page }), 120000);
  const st5 = (await DL.stats()).requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end - r.start > 0);
  const byPort = {};
  for (const r of st5) (byPort[r.port] = byPort[r.port] || []).push(r);
  const gaps5 = Object.values(byPort).flatMap((rs) => rs.sort((a, b) => a.t - b.t).slice(1).map((r, i) => +(r.t - (rs[i].t + rs[i].secs)).toFixed(2)));
  log("capped answers", { states: r5.states, ends: r5.ends, answers: st5.length, maxGap: Math.max(0, ...gaps5), secs: r5.secs });
  check("capped answers: completed, never paused, no failures", r5.v?.state === "completed" && neverPaused(r5) && !r5.ends.short && !r5.ends.mismatch, [r5.v?.state, r5.ends]);
  check("each next ask on a connection follows within 0.5 s", st5.length >= 32 && gaps5.every((g) => g < 0.5), { answers: st5.length, gaps: gaps5.filter((g) => g >= 0.5) });
  check("sha256 matches (capped)", r5.v?.state === "completed" && (await DL.sha256(r5.v.path)) === m["big.bin"].sha256);

  // ---- 6. a slow line: a silent connection and a crawling one are both cut ----
  await DL.reset();
  const med = m["medium.bin"];
  const r6 = await follow(engine.start(`${DL.base}/blob/medium?rate=128&stall=${9 * MiB}-${12 * MiB}&stallafter=${512 << 10}&slow=${12 * MiB}-${15 * MiB}&slowrate=8`, { pageUrl: page }), 150000);
  const st6 = (await DL.stats()).requests.filter((r) => r.path.startsWith("/blob/medium"));
  const stalled = st6.find((r) => r.fault === "stall");
  log("slow line", { states: r6.states, ends: r6.ends, secs: r6.secs, stalledSecs: stalled?.stalled_secs, error: r6.v?.error });
  check("slow line: completed, never paused", r6.v?.state === "completed" && neverPaused(r6), [r6.v?.state, r6.v?.error]);
  check("the silent connection was cut after about 10 s of silence (the idle timeout took 30 s)", (r6.ends.stall ?? 0) >= 1 && stalled && stalled.stalled_secs < 16, { ends: r6.ends, stalled: stalled?.stalled_secs });
  check("the crawling connection was cut (the median 128 KB/s is below the old 256 KB/s gate)", (r6.ends.slow ?? 0) >= 1, r6.ends);
  check("sha256 matches (slow line)", r6.v?.state === "completed" && (await DL.sha256(r6.v.path)) === med.sha256);

  // ---- 7. control: an even, slow line is never cut ----
  await DL.reset();
  const r7 = await follow(engine.start(`${DL.base}/blob/medium?rate=96`, { pageUrl: page }), 150000);
  log("even slow line", { states: r7.states, ends: r7.ends, most: r7.most, secs: r7.secs });
  check("control: an even 96 KB/s on every connection is never cut", r7.v?.state === "completed" && r7.most.reconnects === 0 && !r7.ends.stall && !r7.ends.slow, { most: r7.most, ends: r7.ends });

  // ---- 8. a proxy host's 520 on one part ----
  await DL.reset();
  const r8 = await follow(engine.start(`${DL.base}/blob/big?rate=2048&fail=${96 * MiB}-${128 * MiB}&failn=4&failcode=520`, { pageUrl: page }), 150000);
  log("520 on one part", { states: r8.states, most: r8.most, ends: r8.ends, secs: r8.secs, error: r8.v?.error });
  check("520: completed, never paused (it used to stop every connection)", r8.v?.state === "completed" && neverPaused(r8), [r8.v?.state, r8.states, r8.v?.error]);
  check("520: the failing connection stepped aside", r8.most.stepAsides >= 1, r8.most);
  check("sha256 matches (520)", r8.v?.state === "completed" && (await DL.sha256(r8.v.path)) === m["big.bin"].sha256);

  // ---- 9. a 404 on one part while the others receive ----
  await DL.reset();
  // Its first answer is served and cut after 2 MiB (the others are receiving by then); the next two asks get 404.
  const R9 = `${96 * MiB}-${128 * MiB}`;
  const r9 = await follow(engine.start(`${DL.base}/blob/big?rate=2048&reset=${R9}&resetafter=${2 * MiB}&resetn=1&fail=${R9}&failskip=1&failn=2&failcode=404`, { pageUrl: page }), 150000);
  log("404 on one part", { states: r9.states, retired: r9.diag?.retired, ends: r9.ends, secs: r9.secs, error: r9.v?.error });
  check("404: completed, never paused as Link expired", r9.v?.state === "completed" && neverPaused(r9), [r9.v?.state, r9.states, r9.v?.error]);
  check("404: that connection left for the run", (r9.diag?.retired ?? 0) >= 1, r9.diag?.retired);
  check("sha256 matches (404)", r9.v?.state === "completed" && (await DL.sha256(r9.v.path)) === m["big.bin"].sha256);
  // ---- 11. a head at once, the body 16 s later: no stall or slow cut ----
  await DL.reset();
  const r11 = await follow(engine.start(`${DL.base}/blob/big?rate=1024&bodydelay=${96 * MiB}-${128 * MiB}&bodydelayms=16000`, { pageUrl: page }), 150000);
  log("body after 16 s", { states: r11.states, ends: r11.ends, most: r11.most, secs: r11.secs });
  check("a body that starts 16 s after its head is not cut as a stall or as slow", r11.v?.state === "completed" && !r11.ends.stall && !r11.ends.slow && r11.most.reconnects === 0, { ends: r11.ends, most: r11.most });

  /** Follow a download until `pred(view)` holds or it ends; the most its transfer counted on the way. */
  const until = async (id, pred, timeout) => {
    const t0 = Date.now();
    let most = { stepAsides: 0, retired: 0 };
    for (;;) {
      const v = DL.view(id);
      const info = engine.transferInfo(id);
      if (info) most = { stepAsides: Math.max(most.stepAsides, info.stepAsides), retired: Math.max(most.retired, info.diag?.retired ?? 0) };
      if ((v && pred(v)) || (v && ["completed", "failed", "cancelled"].includes(v.state)) || Date.now() - t0 > timeout) return { v, most, secs: (Date.now() - t0) / 1000 };
      await sleep(100);
    }
  };
  // Every connection's first answer is cut after 1 MiB (the probe and the 8 first asks are served), and every ask
  // after that is refused.
  const everyone = (code) => `${DL.base}/blob/big?rate=1024&reset=0-${256 * MiB}&resetafter=${MiB}&resetn=9&fail=0-${256 * MiB}&failskip=9&failn=100000&failcode=${code}`;

  // ---- 12. an outage mid-run: stop and wait promptly ----
  await DL.reset();
  const id12 = engine.start(everyone(502), { pageUrl: page });
  const r12 = await until(id12, (v) => v.state === "paused", 60000);
  log("outage", { state: r12.v?.state, wait: r12.v?.wait, most: r12.most, secs: r12.secs });
  check("an outage on every connection stops the run and waits within about 15 s", r12.v?.state === "paused" && !!r12.v?.wait && r12.secs < 15, { state: r12.v?.state, wait: r12.v?.wait, secs: r12.secs });
  check("no connection stepped aside in the outage (nobody else was receiving)", r12.most.stepAsides === 0, r12.most);
  engine.cancel(id12);
  await DL.until(id12, ["cancelled"], { timeout: 10000 }).catch(() => null);
  engine.remove(id12);

  // ---- 13. every connection refused at once: Link expired, never Failed ----
  await DL.reset();
  const id13 = engine.start(everyone(404), { pageUrl: page });
  const r13 = await until(id13, (v) => v.state === "paused" || v.state === "failed", 90000);
  log("everyone refused", { state: r13.v?.state, wait: r13.v?.wait, error: r13.v?.error, most: r13.most, secs: r13.secs });
  check("every connection refused at once: the row pauses (Link expired), not Failed", r13.v?.state === "paused", { state: r13.v?.state, error: r13.v?.error, wait: r13.v?.wait });
  check("not every connection retired (the last one reports the refusal)", r13.most.retired <= 7, r13.most);
  engine.cancel(id13);
  await DL.until(id13, ["cancelled"], { timeout: 10000 }).catch(() => null);
  engine.remove(id13);

  // ---- 14. the room a sparse download still needs ----
  await DL.reset();
  const room = (id) => engine.transferInfo(id)?.diag?.room ?? null;
  const id14 = engine.start(`${DL.base}/blob/big?rate=512`, { pageUrl: page });
  await DL.until(id14, ["downloading"], { test: (v) => v.received > 8 * MiB, timeout: 30000, what: "8 MiB" });
  const fresh14 = room(id14);
  log("room: fresh", fresh14);
  check("a fresh download needs room for the whole file", !!fresh14 && fresh14.holds === 0 && fresh14.needed === 256 * MiB, fresh14);
  const id14b = engine.start(`${DL.base}/blob/medium?rate=512`, { pageUrl: page });
  await DL.until(id14b, ["downloading"], { test: (v) => v.received > 0, timeout: 30000, what: "the second's first bytes" });
  const other14 = room(id14b);
  log("room: second download", other14);
  check("a second download on the same disk counts what the first still has to write", !!other14 && other14.needed === 24 * MiB && other14.others > 200 * MiB && other14.others < 256 * MiB, other14);
  engine.cancel(id14b);
  await DL.until(id14b, ["cancelled"], { timeout: 10000 }).catch(() => null);
  engine.remove(id14b);
  engine.pause(id14);
  const p14 = await DL.until(id14, ["paused"], { timeout: 15000 });
  engine.resume(id14);
  await DL.until(id14, ["downloading"], { test: (v) => v.received > p14.received, timeout: 30000, what: "bytes after the resume" });
  const again14 = room(id14);
  log("room: resumed", again14, "saved", p14.received);
  check("a resumed sparse .part counts the room it does not hold yet", !!again14 && again14.holds >= p14.received && again14.holds < 256 * MiB && again14.needed === 256 * MiB - again14.holds, { room: again14, saved: p14.received });
  engine.cancel(id14);
  await DL.until(id14, ["cancelled"], { timeout: 10000 }).catch(() => null);
  engine.remove(id14);
  k32.close();
});
