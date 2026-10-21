// Bench: one download through Deer's engine (tools/run.py test script, driven by bench.py).
// Env: BENCH_URL, BENCH_SIZE, BENCH_TIMEOUT (s). Prints "BENCH_DONE {state, path, error, done_at, samples}".
/* global spike, Services */
spike.main(async () => {
  const { log, sleep } = spike;
  const engine = window.vitre.sys("VitreDownloads");
  await engine.ready;
  await spike.resize(1280, 800);
  const url = Services.env.get("BENCH_URL");
  const timeout = Number(Services.env.get("BENCH_TIMEOUT") || 300) * 1000;
  const id = engine.start(url, { pageUrl: "http://127.0.0.1:47995/" });
  const t0 = Date.now();
  const samples = [];
  let v = null;
  let most = { reconnects: 0, stepAsides: 0, live: 0 };
  for (;;) {
    v = engine.get(id);
    const info = engine.transferInfo(id);
    if (info) most = { reconnects: Math.max(most.reconnects, info.reconnects || 0), stepAsides: Math.max(most.stepAsides, info.stepAsides || 0), live: Math.max(most.live, info.live || 0) };
    samples.push([Date.now() - t0, v ? v.received : 0, v ? v.state : "", info ? info.live : 0]);
    if (v && ["completed", "failed", "cancelled"].includes(v.state)) break;
    if (Date.now() - t0 > timeout) break;
    await sleep(250);
  }
  const doneAt = Date.now();
  log("BENCH_DONE " + JSON.stringify({ state: v?.state, path: v?.path, error: v?.error || "", wait: v?.wait || null, done_at: doneAt, most, samples: samples.filter((_, i) => i % 4 === 0) }));
  if (v && v.state !== "completed") {
    try {
      engine.cancel(id);
    } catch {
      /* gone */
    }
  }
});
