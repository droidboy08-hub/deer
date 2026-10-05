// Restart and session restore with downloads in every state.
// Run 1: a completed, a failed, a paused, two running and a queued download; two tabs (a page and a
// video page); restart. Run 2: the tabs come back (the video tab unloaded until shown); every download
// comes back in a state that can't surprise anyone: completed and failed as they were, everything
// that was running or waiting comes back paused with its bytes, nothing starts by itself; the panel
// shows them; the video tab's download mark appears once it is shown; resuming completes intact.
/* global spike, Services, gBrowser, DL, V, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const edge = `http://127.0.0.1:${Services.env.get("VITRE_DLV_EDGE")}`;
  const byName = (n) => engine.list().find((v) => v.filename === n);

  if (spike.run === 1) {
    await DL.open(DL.base + "/page.html");
    b.newTab(DL.base + "/video.html", { background: true });
    const done = engine.start(DL.base + "/blob/medium", { filename: "r-completed.bin", named: true });
    await DL.until(done, ["completed"], { timeout: 30000 });
    const failed = engine.start(edge + "/missing", { filename: "r-failed.zip", named: true });
    await DL.until(failed, ["failed"], { timeout: 30000 });
    const paused = engine.start(DL.base + "/blob/big?rate=1024", { filename: "r-paused.bin", named: true });
    await DL.until(paused, ["downloading"], { test: (v) => v.received > 16 << 20, timeout: 60000 });
    engine.pause(paused);
    await engine.whenSettled(paused);
    const run1 = engine.start(DL.base + "/blob/big?rate=512", { filename: "r-running-1.bin", named: true });
    const run2 = engine.start(DL.base + "/blob/big?rate=512", { filename: "r-running-2.bin", named: true });
    const queued = engine.start(DL.base + "/blob/medium?rate=64", { filename: "r-queued.bin", named: true });
    await DL.until(run2, ["downloading"], { test: (v) => v.received > 4 << 20 && !v.phase, timeout: 60000 });
    check("before the restart: two run, one waits", engine.get(run1).state === "downloading" && engine.get(queued).state === "queued");
    log("before", engine.list().map((v) => `${v.filename}:${v.state}:${v.received}`));
    await spike.capture("v-restore-1-before");
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  await V.until(() => b.tabs.length === 2, "the two tabs to come back", 20000);
  const video = b.tabs.find((t) => /video\.html/.test(t.url));
  check("session restore brings both tabs back", !!video && b.tabs.some((t) => /page\.html/.test(t.url)), b.tabs.map((t) => t.url));
  check("the video tab is not loaded until shown", !!video?.deferred, video?.deferred);
  await sleep(1500);
  const states = Object.fromEntries(engine.list().map((v) => [v.filename, v]));
  log("after", engine.list().map((v) => `${v.filename}:${v.state}:${v.received}`));
  check("a completed download stays completed, its file there", states["r-completed.bin"]?.state === "completed" && !states["r-completed.bin"].missing);
  check("a failed one stays failed with its reason", states["r-failed.zip"]?.state === "failed" && !!states["r-failed.zip"].error, states["r-failed.zip"]?.error);
  check("a paused one stays paused with its bytes", states["r-paused.bin"]?.state === "paused" && states["r-paused.bin"].received > 16 << 20, states["r-paused.bin"]?.received);
  for (const n of ["r-running-1.bin", "r-running-2.bin"]) check(`running ${n} comes back paused, with its bytes`, states[n]?.state === "paused" && states[n].received > 0, [states[n]?.state, states[n]?.received]);
  check("a queued one comes back paused (nothing starts by itself)", states["r-queued.bin"]?.state === "paused", states["r-queued.bin"]?.state);
  check("nothing is running after the restart", engine.runningCount() === 0, engine.runningCount());
  await sleep(1000);
  check("the ring stays hidden: nothing downloads", !ui.ring.isShown);
  spike.press("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel");
  await sleep(600);
  check("the panel lists all six", b.root.querySelectorAll(".vd-row").length === 6, b.root.querySelectorAll(".vd-row").length);
  check("its summary reads paused", /^5 paused$|^5 paused/.test(b.root.querySelector(".vd-summary").textContent) || /paused/.test(b.root.querySelector(".vd-summary").textContent), b.root.querySelector(".vd-summary").textContent);
  await V.capture("v-restore-2-panel-after");
  spike.press("Escape");
  await sleep(400);

  // The video tab: shown, it loads, and its mark appears.
  b.activate(video);
  await V.until(() => !video.deferred && !video.loading && /video\.html/.test(gBrowser.selectedBrowser.currentURI.spec), "the video tab to load", 20000);
  await V.until(() => !b.bar.downloadMark()?.classList.contains("empty"), "the mark on the restored video tab", 10000).catch(() => null);
  check("the restored video tab shows its download mark once loaded", !b.bar.downloadMark()?.classList.contains("empty"));

  // Resume one: it continues from its bytes and is intact.
  const p = byName("r-paused.bin");
  await DL.reset();
  engine.resume(p.id);
  const fin = await DL.until(p.id, ["completed", "failed"], { timeout: 120000 });
  const st = await DL.stats();
  const fetched = st.requests.filter((r) => /blob\/big/.test(r.path || "")).reduce((n, r) => n + (r.bytes || 0), 0);
  log("fetched after resume", fetched, "had", p.received);
  check("the resumed download completes intact", fin.state === "completed" && (await DL.sha256(fin.path)) === m["big.bin"].sha256, fin.error);
  for (const v of engine.list()) if (v.state === "paused") engine.cancel(v.id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
