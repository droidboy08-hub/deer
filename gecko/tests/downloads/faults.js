// A disk that refuses writes in the middle of a download (another process holds a byte-range lock on
// the .part file, spikes/downloader/verify/lock_region.py): the download stops at once with a disk
// sentence (never "the connection was lost", never retried as a network error), keeps the bytes that
// reached the file, and resumes from them once the disk takes writes again (recipe correction 6).
// Phase 5 (spikes/downloader/RESUME-DESIGN.md 4.1, 4.2): the disk error ends with a seal (a seal line in the
// download's block hash record, its dirty mark cleared), every hash the record kept matches the .part (review
// of Phase 5: a failed writer's unwritten bytes once looked certain), and the finished file keeps its record
// with its whole-file SHA-256.
/* global spike, Services, IOUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  const engine = DL.engine;
  await DL.reset();
  const id = engine.start(`${DL.base}/blob/big?rate=2048`, { filename: "locked.bin", named: true });
  const v = await DL.until(id, ["downloading"], { test: (x) => x.received > 48 << 20, timeout: 60000, what: "48 MB" });
  const part = v.path + ".part";
  const py = Services.env.get("VITRE_DL_PY");
  const lock = Services.env.get("VITRE_DL_LOCK");
  // The lock is held for 8 s, in the background. Under the parts layout (all.py --layout parts) the file a running
  // segment writes is a part that grows at its end: it is locked past its end.
  const live = engine.recs.find((x) => x.id === id).file.segments.find((s) => (s.base ?? 0) > 0 && s.received < s.end - s.start);
  const locked = DL.partsLayout() && live ? DL.placeOf(engine.recs.find((x) => x.id === id), live.start).path : part;
  const locker = DL.tool(py, [lock, locked, "8", ...(locked !== part ? [String(256 << 20)] : [])]);
  const t0 = Date.now();
  const failed = await DL.until(id, ["failed", "completed"], { timeout: 30000, what: "the write error" });
  const secs = (Date.now() - t0) / 1000;
  log("failed after", secs, "s:", failed.error);
  check("a disk write error stops the download at once", failed.state === "failed" && secs < 6, [failed.state, secs]);
  check("it reads as a disk problem, not a network one", /folder|disk|file/i.test(failed.error) && !/connection/i.test(failed.error), failed.error);
  check("the bytes that reached the file are kept", failed.received > 32 << 20, failed.received);
  const st = await DL.stats();
  const after = st.requests.filter((r) => r.path.startsWith("/blob/big") && r.t * 1000 > t0 + 1500);
  check("nothing is retried while the disk refuses", after.length === 0, after.length);
  const rec = () => engine.recs.find((x) => x.id === id);
  await spike.waitFor(() => !engine.sealing.has(id) && rec().file.dirty === false, { timeout: 20000, what: "the seal after the disk error" });
  const ledger = engine.ledgers.get(id);
  check("the disk error sealed the download's record: a seal line after it, the dirty mark cleared", rec().file.dirty === false && !!ledger?.seal && ledger.seal.t >= t0, { dirty: rec().file.dirty, seal: ledger?.seal?.t, t0 });
  const out = await locker;
  log("locker", out.stdout.trim());
  await sleep(500);
  // Review of Phase 5: a failed writer's pipe reads empty once its copier closed it, so the bytes it never wrote
  // looked certain (ranged.ts provable()) and could be hashed from the pre-sized file. Every hash the record
  // kept must match the .part as it is.
  const wrong = await ledger.verify(part, [...ledger.blocks.keys()]);
  check("every block the record hashed matches the .part after the disk error (no hash of bytes that never reached it)", ledger.blocks.size > 0 && wrong.length === 0, { hashed: ledger.blocks.size, wrong });
  await DL.reset();
  engine.resume(id);
  const done = await DL.until(id, ["completed", "failed"], { timeout: 120000 });
  check("after the disk recovers, the download resumes and completes", done.state === "completed", done.error);
  check("the file is intact (sha256)", (await DL.sha256(done.path)) === m["big.bin"].sha256);
  await spike.waitFor(() => !!rec().sha256 && /\.done\.jsonl$/.test(rec().journal ?? ""), { timeout: 20000, what: "the finished file's record" });
  check("the finished file keeps its record (<id>.done.jsonl) and its SHA-256", /\.done\.jsonl$/.test(rec().journal ?? "") && (await IOUtils.exists(rec().journal)) && rec().sha256 === m["big.bin"].sha256, { journal: rec().journal, sha: rec().sha256 });
  const st2 = await DL.stats();
  const fetched = st2.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end > r.start).reduce((n, r) => n + (r.sent || 0), 0);
  check("only what had not reached the file was fetched again", fetched < m["big.bin"].size - (32 << 20), { fetched, kept: failed.received });
});
