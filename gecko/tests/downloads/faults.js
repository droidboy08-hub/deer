// A disk that refuses writes in the middle of a download (another process holds a byte-range lock on
// the .part file, spikes/downloader/verify/lock_region.py): the download stops at once with a disk
// sentence (never "the connection was lost", never retried as a network error), keeps the bytes that
// reached the file, and resumes from them once the disk takes writes again (recipe correction 6).
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
  // The lock is held for 8 s, in the background.
  const locker = DL.tool(py, [lock, part, "8"]);
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
  const out = await locker;
  log("locker", out.stdout.trim());
  await sleep(500);
  await DL.reset();
  engine.resume(id);
  const done = await DL.until(id, ["completed", "failed"], { timeout: 120000 });
  check("after the disk recovers, the download resumes and completes", done.state === "completed", done.error);
  check("the file is intact (sha256)", (await DL.sha256(done.path)) === m["big.bin"].sha256);
  const st2 = await DL.stats();
  const fetched = st2.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end > r.start).reduce((n, r) => n + (r.sent || 0), 0);
  check("only what had not reached the file was fetched again", fetched < m["big.bin"].size - (32 << 20), { fetched, kept: failed.received });
});
