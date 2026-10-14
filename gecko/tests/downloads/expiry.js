// Phase 2 of spikes/downloader/RESUME-DESIGN.md (section 7), "same-file proof, automatic renewal from
// the original address, Use another address…", against the local server's /sign, /signed-once, /mint,
// /edge, /swap, /flap, /tail and /whole routes (tests/downloads/server.py):
//   - control: a resume of an unexpired, unchanged download makes as many requests as before (one
//     connection: the probe, which now carries window 0, then one range);
//   - a pause past a signed address's expiry, then Resume: renewed from the original address before
//     the first request (the dead address is never asked), continued from its segments, only the
//     missing ranges fetched, sha256 equal;
//   - expiry during a run on 8 connections (the server cuts them when the token expires): exactly one
//     request to the original address, Renewing link meanwhile, completed intact with nothing fetched
//     twice;
//   - /edge, a new ETag on every answer over the same bytes: completes with no restart, the ETag no
//     longer trusted after two proofs (If-Range carries Last-Modified);
//   - review of Phase 2, /flap, a farm whose two backends differ in both ETag and Last-Modified over the
//     same bytes: completes with no restart and no File changed, neither validator trusted after two
//     proofs (no If-Range), and a pause and Resume there still completes intact;
//   - /swap with no validators at all and the same size: File changed, nothing mixed;
//   - review of Phase 2, /tail, a file whose bytes change after its first 64 KiB (same size, a server
//     that ignores If-Range), the download paused early with under 64 KiB in each segment: past 1 MiB
//     saved it is File changed with the .part untouched; under it, it starts again by itself and
//     completes as the new file, never a mix; "Use another address…" with such an address says "a
//     different file";
//   - review of Phase 2, /whole, a 40 KiB file whose server answers a Range over the whole file with a
//     200: a resume makes 2 requests, as before (the probe one byte short, then the rest);
//   - review of Phase 2: an attempt of the schedule that proves the address, whose run is then refused
//     before it saves a byte, carries the schedule on (the next try 13 minutes on, not 2 again); Pause
//     on that Link expired row stops the attempts planned;
//   - review of Phase 2: Pause (Space) on a Renewing link row stops the attempt and the ones planned,
//     keeping the bytes;
//   - /signed-once, whose original address dies too: Link expired with its next try; Retry right away
//     asks the original address again (review of Phase 2); in the panel, "Use another address…" says
//     "a different file" for another file, "a web page" for a page, "couldn't reach" for an address
//     that doesn't answer, and a fresh signed address attaches: the same row carries on from its
//     segments under the same name, only what was missing fetched, sha256 equal, and the pasted address
//     is asked with no Referer or Origin from the old page (review of Phase 2);
//   - run 2, after a restart: the attempt schedule survived (tries and next time), the attempt falls due
//     and asks the original address once, the next one is planned 13 minutes on; the store read with the
//     rules of version 1 still gives paused (a JSON assert).
// VITRE_DL_ONLY=a,b runs only those sections: control, past, midrun, edge, farm, none, early, tiny,
// refuse, stop, once, restart (needs once).
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
  const KiB = 1 << 10;
  const store = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
  const medium = m["medium.bin"];
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const LM = "Mon, 12 Oct 2026 09:00:00 GMT";

  /** The download once its run has ended (paused, failed, completed or cancelled). */
  const settled = (id, what) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && ["paused", "failed", "completed", "cancelled"].includes(v.state) ? v : null;
      },
      { timeout: 90000, interval: 100, what }
    );
  /**
   * Wait for `bytes`, pause, and return the view once every connection has stopped. A download that
   * stopped by itself first is returned as it is (its checks then fail instead of the run timing out).
   */
  const pauseAt = async (id, bytes, what) => {
    const v = await DL.until(id, ["downloading", "paused", "failed", "completed", "cancelled"], { test: (x) => x.state !== "downloading" || x.received > bytes, timeout: 30000, what });
    if (v.state === "downloading") engine.pause(id);
    return settled(id, what + " to pause");
  };
  /**
   * The server's log, once every body it sent has its byte count: the download can finish while the
   * handler of its last range is still in its last pause, before it records what it sent.
   */
  const requests = async () => {
    let reqs = [];
    for (let i = 0; i < 50; i++) {
      reqs = (await DL.stats()).requests;
      if (reqs.every((x) => x.start === undefined || x.sent !== undefined)) break;
      await sleep(100);
    }
    return reqs;
  };
  const seen = async (prefix) => (await requests()).filter((r) => r.path.startsWith(prefix));
  const brief = (reqs) => reqs.map((r) => `${r.status} ${r.path.split("?")[0].slice(0, 32)} ${r.range || "-"} ${r.ifrange || "-"}`);
  const sentIn = (reqs) => reqs.reduce((n, r) => n + (r.sent || 0), 0);
  /** Ranges that continue the download: If-Range carried, not the resume probe's window 0. */
  const pulls = (reqs) => reqs.filter((r) => r.status === 206 && r.end > r.start && r.ifrange && r.range !== "bytes=0-65535");
  /** The token and expiry time of the first signed address a download was sent to. */
  const tokenOf = (reqs) => {
    const r = reqs.find((x) => x.path.startsWith("/signed/"));
    const mm = r && /^\/signed\/([0-9a-f]+)\/[^?]*\?(?:Expires=(\d+))?/.exec(r.path);
    return mm ? { tok: mm[1], expires: Number(mm[2] || 0) * 1000 } : { tok: "", expires: 0 };
  };
  /** Wait until the signed address's own expiry time has passed (the client reads it from the address). */
  const pastExpiry = (expires) => waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the signed address to expire" });
  /** The download's file record as the store has it (segments, validators). */
  const fileOf = async (id) => {
    await engine.save(true);
    return (await IOUtils.readJSON(store)).items.find((x) => x.id === id)?.file ?? null;
  };
  /**
   * A Link expired row's next attempt, brought forward to now: the schedule's first one is 2 minutes
   * after the failure (a test reaches into the engine for this).
   */
  const bringForward = (id) => {
    const rec = engine.recs.find((r) => r.id === id);
    rec.wait.nextAt = Date.now();
    engine.armWaits();
  };
  /**
   * Start a /signed-once download, pause it, let its address expire, resume: Link expired. `opts` go
   * to engine.start (a source page, its referrer policy).
   */
  const expireOnce = async (key, name, opts = {}) => {
    await DL.reset();
    const id = engine.start(`${DL.base}/signed-once/medium?ttl=3&k=${key}&rate=512`, { filename: name, named: true, ...opts });
    const p = await pauseAt(id, 2 * MiB, name);
    const first = tokenOf(await requests());
    const sha = await DL.sha256(p.path + ".part");
    await pastExpiry(first.expires);
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, `${name}: the verdict`);
    return { id, p, v, sha, first, reqs: await requests() };
  };

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
    AsyncShutdown.profileBeforeChange.addBlocker(`Deer expiry test: ${what}`, sb.atQuit);
    log("restarting:", what);
    await spike.restart();
  };

  // ---- run 2: the attempt schedule after a restart ----
  if (spike.run === 2) {
    const saved = JSON.parse(Services.prefs.getStringPref("vitre.test.expiry", "{}"));
    const disk = (await IOUtils.readJSON(store)).items.find((x) => x.id === saved.id);
    await DL.reset();
    const v = engine.get(saved.id);
    check("after a restart the Link expired row is back with its attempt schedule (tries and the next time saved)", !!v && v.state === "paused" && v.need?.kind === "address" && v.wait?.tries === 1 && v.nextAt === disk?.wait?.nextAt && v.nextAt > 0, v && { state: v.state, need: v.need, wait: v.wait, stored: disk?.wait });
    if (!v) return;
    const v2 = await waitFor(() => (engine.get(saved.id)?.wait?.tries === 2 ? engine.get(saved.id) : null), { timeout: 40000, interval: 100, what: "the attempt that fell due" });
    const asked = await seen("/signed-once/");
    const ahead = v2.nextAt - Date.now();
    check("the attempt that fell due asked the original address once, found nothing, and planned the next 13 minutes on", asked.length === 1 && v2.state === "paused" && v2.need?.kind === "address" && ahead > 12 * 60000 && ahead < 13.5 * 60000, { asked: brief(asked), wait: v2.wait, ahead });
    // An older Deer (version 1 rules: ACTIVE rows become paused or failed, nothing else is read) still
    // reads a row that waits or needs the person as plain paused (RESUME-DESIGN.md 3, the state model).
    await engine.save(true);
    const d = await IOUtils.readJSON(store);
    const v1 = (r) => (["starting", "queued", "downloading"].includes(r.state) ? (r.mode === "browser" || r.state === "starting" ? "failed" : "paused") : r.state);
    const waiting = d.items.filter((r) => r.wait || r.need);
    check("a version 2 store read by version 1 rules gives paused for every row that waits or needs the person", d.version === 2 && waiting.length >= 1 && waiting.every((r) => v1(r) === "paused" && typeof r.url === "string" && Array.isArray(r.file?.segments)), waiting.map((r) => [r.filename, r.state, v1(r), r.wait?.for, r.need?.kind]));
    return;
  }

  const connections = settings.get().connections;

  // ---- control: an unexpired, unchanged resume makes as many requests as before ----
  if (want("control")) {
    settings.set({ connections: 1 });
    await DL.reset();
    const c = engine.start(`${DL.base}/sign/medium?ttl=600&k=ctl&rate=2048`, { filename: "control-signed.bin", named: true });
    const cp = await pauseAt(c, 2 * MiB, "the control");
    await DL.reset();
    engine.resume(c);
    const cd = await settled(c, "the control to finish");
    const cr = await requests();
    log("control requests after the resume", brief(cr));
    check("control: a resume of an unexpired, unchanged signed download makes 2 requests, as before (the probe, carrying window 0, then one range)", cr.length === 2 && cr.every((r) => r.path.startsWith("/signed/")) && cr[0].range === "bytes=0-65535" && !!cr[0].ifrange && cr[1].start === cp.received, brief(cr));
    check("control: it completed intact", cd.state === "completed" && (await DL.sha256(cd.path)) === medium.sha256, cd.error);
    settings.set({ connections });
  }

  // ---- a pause past the signed address's expiry, then Resume ----
  if (want("past")) {
    settings.set({ connections: 8 });
    await DL.reset();
    const p = engine.start(`${DL.base}/sign/medium?ttl=4&k=past&rate=512`, { filename: "paused-past-expiry.bin", named: true });
    const pp = await pauseAt(p, 2 * MiB, "the signed download");
    const first = tokenOf(await requests());
    await pastExpiry(first.expires);
    await DL.reset();
    engine.resume(p);
    const pd = await settled(p, "the download resumed past its expiry");
    const pr = await requests();
    const fetched = sentIn(pulls(pr));
    log("past expiry", brief(pr).slice(0, 6));
    check("a pause past expiry, then Resume: the original address is asked first, the dead one never", first.tok && pr[0]?.path.startsWith("/sign/medium") && !pr.some((r) => r.path.startsWith(`/signed/${first.tok}/`)), brief(pr).slice(0, 4));
    check("it continues from its segments: only the missing ranges are fetched, and the file is intact", pd.state === "completed" && (await DL.sha256(pd.path)) === medium.sha256 && fetched === medium.size - pp.received, { state: pd.state, error: pd.error, fetched, missing: medium.size - pp.received });
    check("the row's history says a new link was found", pd.history.some((h) => h.text === "New link found"), pd.history);
    settings.set({ connections });
  }

  // ---- expiry during a run on 8 connections ----
  if (want("midrun")) {
    settings.set({ connections: 8 });
    await DL.reset();
    const r = engine.start(`${DL.base}/sign/medium?ttl=3&k=midrun&rate=256&delay2=1.5`, { filename: "expires-mid-run.bin", named: true });
    let renewing = false;
    const watch = setInterval(() => {
      const v = engine.get(r);
      if (v?.state === "downloading" && v.phase === "renewing") renewing = true;
    }, 40);
    const rd = await settled(r, "the download whose address expires mid-run");
    clearInterval(watch);
    const all = await requests();
    const sign = all.filter((x) => x.path.startsWith("/sign/medium"));
    const first = tokenOf(all);
    const old = all.filter((x) => x.path.startsWith(`/signed/${first.tok}/`));
    const ran = old.filter((x) => x.status === 206 && x.end > x.start);
    log("mid-run", { sign: sign.length, old: brief(old).slice(0, 12), cut: old.filter((x) => x.cut).length });
    check("expiry during a run on 8 connections: exactly one request to the original address, and the download completes intact", rd.state === "completed" && (await DL.sha256(rd.path)) === medium.sha256 && sign.length === 2 && ran.length >= 8 && old.some((x) => x.cut) && old.some((x) => x.status === 403), { state: rd.state, error: rd.error, sign: sign.length, ranges: ran.length });
    check("the row read Renewing link while it looked for the new address", renewing);
    check("nothing was fetched twice: the connections carried on from where they were", sentIn(pulls(all)) === medium.size, { fetched: sentIn(pulls(all)), size: medium.size });
    settings.set({ connections });
  }

  // ---- /edge: a new ETag on every answer over the same bytes ----
  if (want("edge")) {
    settings.set({ connections: 8 });
    await DL.reset();
    const e = engine.start(`${DL.base}/edge/medium?rate=2048`, { filename: "edge.bin", named: true });
    // A restart would throw saved bytes away: the count would go back.
    let high = 0;
    let back = 0;
    const watch = setInterval(() => {
      const v = engine.get(e);
      if (!v) return;
      high = Math.max(high, v.received);
      back = Math.max(back, high - v.received);
    }, 50);
    const ed = await settled(e, "the /edge download");
    clearInterval(watch);
    const er = await seen("/edge/medium");
    const probes = er.filter((x) => x.range === "bytes=0-0");
    const byDate = er.filter((x) => x.status === 206 && x.ifrange === LM && x.end > x.start);
    log("edge", { requests: er.length, refused: er.filter((x) => x.status === 200).length, byDate: byDate.length });
    check("/edge (a new ETag on every answer) completes intact with no restart (probed once, no bytes ever thrown away)", ed.state === "completed" && (await DL.sha256(ed.path)) === medium.sha256 && probes.length === 1 && back === 0, { state: ed.state, need: ed.need, error: ed.error, probes: probes.length, back, high });
    check("after two proofs its ETag is no longer trusted: If-Range carries Last-Modified and the ranges come through", byDate.length > 0 && sentIn(er.filter((x) => x.status === 206 && x.end > x.start && x.ifrange)) === medium.size, { byDate: byDate.length });
    settings.set({ connections });
  }

  // ---- review of Phase 2: /flap, two backends that differ in both ETag and Last-Modified ----
  if (want("farm")) {
    settings.set({ connections: 8 });
    await DL.reset();
    const f = engine.start(`${DL.base}/flap/medium?rate=512`, { filename: "server-farm.bin", named: true });
    let high = 0;
    let back = 0;
    const watch = setInterval(() => {
      const v = engine.get(f);
      if (!v) return;
      high = Math.max(high, v.received);
      back = Math.max(back, high - v.received);
    }, 50);
    const fp = await pauseAt(f, 8 * MiB, "the download from a server farm");
    const before = await seen("/flap/medium");
    const state = await fileOf(f);
    await DL.reset();
    engine.resume(f);
    const fd = await settled(f, "the download from a server farm to finish");
    clearInterval(watch);
    const after = await seen("/flap/medium");
    const whole = [...before, ...after].filter((x) => x.status === 200);
    log("farm", { before: before.length, after: brief(after).slice(0, 6), whole: whole.length, unstable: [state?.etagUnstable, state?.dateUnstable] });
    check("a farm whose backends differ in both ETag and Last-Modified (the same bytes) completes intact: never File changed, no restart, nothing thrown away", fd.state === "completed" && !fd.need && (await DL.sha256(fd.path)) === medium.sha256 && back === 0 && fp.state === "paused" && !fp.need, { paused: [fp.state, fp.need], state: fd.state, need: fd.need, error: fd.error, back });
    check("after two proofs neither validator is trusted (etagUnstable, dateUnstable): the whole-file answers stop, and the resume sends no If-Range", !!state?.etagUnstable && !!state?.dateUnstable && whole.length <= 16 && after.length > 0 && after.every((x) => !x.ifrange && x.status === 206), { whole: whole.length, unstable: [state?.etagUnstable, state?.dateUnstable], after: brief(after).slice(0, 6) });
    check("the resume, with no validator to trust, compared windows of the saved bytes past window 0 before it carried on", after[0]?.range === "bytes=0-65535" && after.filter((x) => x.end - x.start + 1 <= 65536 && x.range !== "bytes=0-65535").length >= 2, brief(after).slice(0, 6));
    settings.set({ connections });
  }

  // ---- /swap with no validators and the same size ----
  if (want("none")) {
    await DL.reset();
    const n = engine.start(`${DL.base}/swap/medium?val=none&k=none&rate=512`, { filename: "no-validators.bin", named: true });
    const np = await pauseAt(n, 3 * MiB, "the download with no validators");
    const sha = await DL.sha256(np.path + ".part");
    await fetch(`${DL.base}/flag?k=none`, { cache: "no-store" });
    await DL.reset();
    engine.resume(n);
    const nv = await settled(n, "the verdict on a file swapped with no validators");
    const nr = await seen("/swap/medium");
    check("/swap with no validators and the same size: File changed, the .part untouched, nothing mixed", nv.state === "paused" && nv.need?.kind === "choice" && nv.need.evidence === "its first bytes are different" && (await DL.sha256(np.path + ".part")) === sha && nv.received === np.received, { state: nv.state, need: nv.need, error: nv.error });
    check("only the probe was asked, and its answer carried window 0", nr.length === 1 && nr[0].range === "bytes=0-65535" && !nr[0].ifrange, brief(nr));
  }

  // ---- review of Phase 2: /tail, a file whose bytes change after its first 64 KiB, paused early ----
  if (want("early")) {
    // Past 1 MiB saved on 24 connections, under 64 KiB in each segment: File changed, nothing mixed.
    settings.set({ connections: 24 });
    await DL.reset();
    const a = engine.start(`${DL.base}/tail/medium?k=early-a&rate=24`, { filename: "changed-after-start.bin", named: true });
    const ap = await pauseAt(a, 1.05 * MiB, "the download paused early on 24 connections");
    const segs = ((await fileOf(a))?.segments ?? []).filter((x) => x.received > 0);
    const asha = await DL.sha256(ap.path + ".part");
    await fetch(`${DL.base}/flag?k=early-a`, { cache: "no-store" });
    await DL.reset();
    engine.resume(a);
    const av = await settled(a, "the verdict on a file that changed after its first 64 KiB");
    const ar = await seen("/tail/medium");
    log("early", { saved: ap.received, segments: segs.length, largest: Math.max(...segs.map((x) => x.received)), reqs: brief(ar) });
    check("the early pause left under 64 KiB in every segment (24 of them) and over 1 MiB in all", segs.length >= 20 && segs.every((x) => x.received < 64 * KiB) && ap.received > MiB, segs.map((x) => x.received));
    check("a file whose bytes changed after its first 64 KiB (same size, a server that ignores If-Range) is File changed: the windows reach past window 0, and the .part is untouched", av.state === "paused" && av.need?.kind === "choice" && /are different$/.test(av.need.evidence ?? "") && (await DL.sha256(ap.path + ".part")) === asha && av.received === ap.received, { state: av.state, need: av.need, error: av.error });
    check("only the probe and the proof's windows were asked: no range continued the download", ar.length >= 2 && ar.length <= 4 && ar.slice(1).every((x) => !x.ifrange), brief(ar));
    // Under 1 MiB saved on 8 connections: the same change starts again by itself, never a mix.
    settings.set({ connections: 8 });
    await DL.reset();
    const c = engine.start(`${DL.base}/tail/medium?k=early-b&rate=24`, { filename: "restarted-after-change.bin", named: true });
    await pauseAt(c, 256 * KiB, "the download paused early on 8 connections");
    const fresh = (await (await fetch(`${DL.base}/flag?k=early-b&f=medium&tail=1`, { cache: "no-store" })).json()).sha256;
    engine.resume(c);
    const cv = await settled(c, "the download that starts again after the change");
    const got = cv.state === "completed" ? await DL.sha256(cv.path) : "";
    check("with under 1 MiB saved the same change starts again by itself and completes as the new file, never a mix of the two", cv.state === "completed" && got === fresh, { state: cv.state, need: cv.need, error: cv.error, got, fresh, old: medium.sha256 });
    // Use another address… with such an address: a different file, the row untouched.
    await DL.reset();
    const d = engine.start(`${DL.base}/tail/medium?k=early-c&rate=24`, { filename: "pasted-other-tail.bin", named: true });
    const dp = await pauseAt(d, 256 * KiB, "the download whose pasted address changes after 64 KiB");
    const dsha = await DL.sha256(dp.path + ".part");
    await fetch(`${DL.base}/flag?k=early-d`, { cache: "no-store" });
    await DL.reset();
    const res = await engine.setAddress(d, `${DL.base}/tail/medium?k=early-d`);
    const dv = engine.get(d);
    const dr = await seen("/tail/medium");
    check("Use another address… with an address that gives other bytes after its first 64 KiB (same size) says it is a different file; the row is untouched", !res.ok && res.kind === "different" && dv.state === "paused" && !dv.need && (await DL.sha256(dp.path + ".part")) === dsha && dr.length >= 2, { res, state: dv.state, need: dv.need, reqs: brief(dr) });
    engine.cancel(d);
    settings.set({ connections });
  }

  // ---- review of Phase 2: /whole, a tiny file whose server sends a 200 for a Range over all of it ----
  if (want("tiny")) {
    await DL.reset();
    const t = engine.start(`${DL.base}/whole/medium?size=40960&rate=4`, { filename: "tiny.bin", named: true });
    const tp = await pauseAt(t, 8 * KiB, "the tiny download");
    await DL.reset();
    engine.resume(t);
    const tv = await settled(t, "the tiny download to finish");
    const tr = await seen("/whole/medium");
    let same = false;
    if (tv.state === "completed") {
      const ours = await IOUtils.read(tv.path);
      const theirs = await IOUtils.read(PathUtils.join(DL.fix, "medium.bin"), { maxBytes: 40960 });
      same = ours.length === theirs.length && ours.every((x, i) => x === theirs[i]);
    }
    check("a 40 KiB file whose server answers a Range over the whole file with a 200 resumes in 2 requests, as before (the probe one byte short, then the rest), and completes intact", tv.state === "completed" && same && tr.length === 2 && tr[0].status === 206 && tr[0].range === "bytes=0-40958" && !!tr[0].ifrange && tr[1].status === 206 && tr[1].start === tp.received, { state: tv.state, need: tv.need, reqs: brief(tr) });
  }

  // ---- review of Phase 2: an attempt that proves the address, then a run the host refuses ----
  if (want("refuse")) {
    settings.set({ connections: 8 });
    await DL.reset();
    // Every later token works for 1 request: the proof (window 0 under the same strong ETag on the
    // same host, R5), never the transfer.
    const r = engine.start(`${DL.base}/sign/medium?ttl=3&k=refuse&uses2=1&rate=512`, { filename: "proof-only.bin", named: true });
    const rp = await pauseAt(r, 2 * MiB, "the download whose new addresses only pass the proof");
    const rsha = await DL.sha256(rp.path + ".part");
    await pastExpiry(tokenOf(await requests()).expires);
    engine.resume(r);
    const r1 = await settled(r, "the first Link expired");
    check("a new address that passes the proof but refuses the transfer: Link expired, the next try in 2 minutes", r1.state === "paused" && r1.need?.kind === "address" && r1.wait?.tries === 1, { state: r1.state, need: r1.need, wait: r1.wait, error: r1.error });
    bringForward(r);
    await DL.until(r, ["queued", "downloading"], { timeout: 20000, what: "the attempt to attach the new address" });
    const r2 = await settled(r, "the attached run to be refused");
    const ahead = r2.nextAt - Date.now();
    check("the attempt proved the address and attached it, the run was refused before it saved a byte: the schedule carries on (the next try 13 minutes on, not 2 again)", r2.state === "paused" && r2.need?.kind === "address" && r2.wait?.tries === 2 && ahead > 12 * 60000 && ahead < 13.5 * 60000 && r2.received === rp.received && (await DL.sha256(rp.path + ".part")) === rsha, { state: r2.state, need: r2.need, wait: r2.wait, ahead });
    // Review of Phase 2: Pause on a Link expired row stops the attempts planned (RESUME-DESIGN.md G4).
    engine.pause(r);
    const r3 = engine.get(r);
    check("Pause on a Link expired row with attempts planned stops them, keeping the bytes and the reason", r3.state === "paused" && !r3.wait && !r3.nextAt && r3.need?.kind === "address" && r3.received === rp.received, { state: r3.state, wait: r3.wait, need: r3.need });
    engine.cancel(r);
    settings.set({ connections });
  }

  // ---- review of Phase 2: Pause on a Renewing link row ----
  if (want("stop")) {
    const k = await expireOnce("stop", "stop-trying.bin");
    check("a /signed-once download is Link expired with its next try planned", k.v.need?.kind === "address" && k.v.wait?.tries === 1, [k.v.state, k.v.need, k.v.wait]);
    // The original address now hangs, so the attempt runs until something stops it.
    await fetch(`${DL.base}/flag?k=hang-stop`, { cache: "no-store" });
    await DL.reset();
    bringForward(k.id);
    const during = await waitFor(() => (engine.get(k.id)?.phase === "renewing" ? engine.get(k.id) : null), { timeout: 15000, interval: 50, what: "the attempt to start" });
    // The row's primary verb, as Space and its button run it.
    ui.store.primary(during);
    await sleep(800);
    const sv = engine.get(k.id);
    const asked = await seen("/signed-once/");
    check("Pause (Space) on a Renewing link row stops the attempt and the ones planned and keeps the bytes: still Link expired, no next try", during.state === "paused" && sv.state === "paused" && sv.phase !== "renewing" && !sv.wait && !sv.nextAt && sv.need?.kind === "address" && sv.received === k.p.received && (await DL.sha256(k.p.path + ".part")) === k.sha && asked.length === 1, { during: [during.state, during.phase], state: sv.state, phase: sv.phase, wait: sv.wait, need: sv.need, asked: brief(asked) });
    engine.cancel(k.id);
  }

  // ---- /signed-once: the original address dies too; Use another address… ----
  if (want("once")) {
    // From a page on another origin, with a policy that sends it whole: the old page must not reach a pasted address.
    const page = `${DL.base.replace("127.0.0.1", "localhost")}/page.html`;
    const o = await expireOnce("once", "signed-once.bin", { pageUrl: page, identity: { referrerPolicy: "unsafe-url", withOrigin: true } });
    const ahead = o.v.nextAt - Date.now();
    const originals = o.reqs.filter((x) => x.path.startsWith("/signed-once/"));
    check("/signed-once gives Link expired: paused, the bytes kept, the original address asked once, the next try in 2 minutes", o.v.state === "paused" && o.v.need?.kind === "address" && o.v.need.status === 403 && o.v.wait?.tries === 1 && ahead > 100000 && ahead < 125000 && originals.length === 1 && (await DL.sha256(o.p.path + ".part")) === o.sha, { state: o.v.state, need: o.v.need, wait: o.v.wait, ahead, reqs: brief(o.reqs) });
    // Review of Phase 2: the 30 s memory of a failed renewal is for one run; Retry asks again.
    await DL.reset();
    engine.resume(o.id);
    const ov = await settled(o.id, "the Retry right after Link expired");
    const again = await seen("/signed-once/");
    check("Retry right after Link expired asks the original address again (once), and the row is Link expired again with its bytes", again.length === 1 && ov.state === "paused" && ov.need?.kind === "address" && ov.wait?.tries === 1 && (await DL.sha256(o.p.path + ".part")) === o.sha, { state: ov.state, need: ov.need, wait: ov.wait, asked: brief(again) });
    check("the download's own requests carry its page (Referer and Origin)", !!again[0]?.referer && again[0]?.origin === page.replace("/page.html", ""), again.map((x) => [x.referer, x.origin]));

    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(400);
    const row = (id) => b.root.querySelector(`.vd-row[data-id="${id}"]`);
    const details = () => b.root.querySelector(".vd-details");
    spike.click(row(o.id).querySelector(".vd-name"));
    await sleep(600);
    const cap = details().querySelector(".vd-d-cap").textContent;
    const acts = Array.from(details().querySelectorAll("[data-act]")).map((x) => x.textContent);
    // Phase 3 (RESUME-DESIGN.md 6): Refresh address is a Link expired row's verb, with Open page for one that has a page.
    check("its caption says why, how much is saved and when the next try is; Use another address… is offered", /^The link stopped working \(403\) · \d+% is saved · next try \d/.test(cap) && acts.includes("Use another address…") && acts.includes("Refresh address") && acts.includes("Open page"), { cap, acts });
    const openField = async () => {
      spike.click(details().querySelector('[data-act="use-address"]'));
      await waitFor(() => !details().querySelector(".vd-addr").hidden, { what: "the address field" });
      await sleep(100);
      return details().querySelector(".vd-addr input");
    };
    let input = await openField();
    check("the field opens focused, labelled for the download", document.activeElement === input && input.getAttribute("aria-label") === "New address for signed-once.bin", [document.activeElement?.localName, input.getAttribute("aria-label")]);
    const note = () => details().querySelector(".vd-addr-note").textContent;
    const submit = async (url) => {
      input.value = url;
      spike.click(details().querySelector(".vd-addr-go"));
      await waitFor(() => note() && note() !== "Checking that address…", { timeout: 20000, interval: 50, what: `the verdict on ${url}` });
      return note();
    };
    const wrong = await submit(`${DL.base}/blob/big`);
    check("a wrong address (another file): \"That address is a different file (256 MB; this download is 24 MB).\" with Use it and start over; the row still waits", wrong === "That address is a different file (256 MB; this download is 24 MB)." && !details().querySelector(".vd-addr-over").hidden && engine.get(o.id).need?.kind === "address", wrong);
    await spike.capture("expiry-1-use-another-address");
    const pageNote = await submit(`${DL.base}/expired-page.html`);
    check("an address that answers with a page says so", pageNote === "That address answers with a web page, not the file." && details().querySelector(".vd-addr-over").hidden, pageNote);
    const gone = await submit("http://127.0.0.1:9/gone.bin");
    check("an address that doesn't answer says so", gone === "Deer couldn’t reach that address.", gone);
    input.focus();
    spike.press("Escape");
    await sleep(300);
    check("Esc in the field closes the field, not the panel", details().querySelector(".vd-addr").hidden && ui.panel.open);
    input = await openField();
    const minted = (await (await fetch(`${DL.base}/mint/medium?rate=512`, { cache: "no-store" })).json()).url;
    await DL.reset();
    input.value = `${DL.base}${minted}`;
    spike.click(details().querySelector(".vd-addr-go"));
    await DL.until(o.id, ["queued", "downloading", "completed"], { timeout: 20000, what: "the pasted address to attach" });
    const od = await settled(o.id, "the download from the pasted address");
    const or = await requests();
    const fetched = sentIn(pulls(or));
    const pasted = or.filter((x) => x.path.startsWith("/signed/"));
    check("a fresh signed address pasted into Use another address attaches: the same row completes intact under its name", od.state === "completed" && od.filename === "signed-once.bin" && (await DL.sha256(od.path)) === medium.sha256 && od.url === `${DL.base}${minted}` && details().querySelector(".vd-addr").hidden, { state: od.state, filename: od.filename, error: od.error, url: od.url });
    check("it carried on from its segments: only what was missing was fetched, and the row says where from", fetched === medium.size - o.p.received && od.history.some((h) => h.text === "Continued from another address") && !(await DL.files()).some((f) => /signed-once \(1\)/.test(f)), { fetched, missing: medium.size - o.p.received, history: od.history });
    check("the pasted address is asked as Add link asks: no Referer and no Origin from the old page", pasted.length > 0 && pasted.every((x) => !x.referer && !x.origin), pasted.map((x) => [x.referer, x.origin]).slice(0, 4));
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });

    if (want("restart")) {
      // A second one waits for its next attempt across a restart; it is moved to 6 s after the restart.
      const k = await expireOnce("once2", "kept-waiting.bin");
      check("a second /signed-once download is Link expired too, its schedule at its first try", k.v.need?.kind === "address" && k.v.wait?.tries === 1, [k.v.state, k.v.need, k.v.wait]);
      Services.prefs.setStringPref("vitre.test.expiry", JSON.stringify({ id: k.id }));
      await restartWith(
        "a Link expired row whose next attempt falls due after the restart",
        `const d = await IOUtils.readJSON(store);
        for (const r of d.items) if (r.id === data.id && r.wait) r.wait.nextAt = Date.now() + 6000;
        await IOUtils.writeJSON(store, d);
        await IOUtils.writeJSON(store + ".bak", d);`,
        { id: k.id }
      );
    }
  }
});
