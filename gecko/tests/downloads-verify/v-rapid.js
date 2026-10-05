// Rapid repeated input, the DRM race, idle cost and console errors.
//   - Pause then Resume before the connections have closed: the last word wins (it downloads);
//     Space Space in the panel does the same; Pause Resume Pause ends paused; the file stays intact;
//   - Ctrl+J pressed 15 times: one panel at most, open after an odd count; the ring clicked 10 times:
//     one quick view at most; Ctrl+Shift+D 5 times: one picker at most;
//   - six downloads started at once: two run, four wait in order;
//   - DRM after the offer: a page that starts a key session while its picker is open gets no
//     download (the picker closes, the pill says Protected video, the engine refuses);
//   - idle: once nothing downloads, the engine's ticker stops and the parent process stays quiet.
/* global spike, Services, gBrowser, DL, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  await DL.open(DL.base + "/page.html");

  // ---- pause / resume races ----
  const id = engine.start(DL.base + "/blob/big?rate=4096", { filename: "race.bin", named: true });
  await DL.until(id, ["downloading"], { test: (v) => v.received > 8 << 20 && !v.phase, timeout: 30000 });
  engine.pause(id);
  check("a pause reads as paused at once", engine.get(id).state === "paused", engine.get(id).state);
  engine.resume(id);
  await sleep(1500);
  check("Pause then Resume at once: it downloads (the last word wins)", ["downloading", "queued"].includes(engine.get(id).state), engine.get(id).state);
  await DL.until(id, ["downloading"], { test: (v) => !v.phase, timeout: 10000 });
  engine.pause(id);
  engine.resume(id);
  engine.pause(id);
  await sleep(1500);
  check("Pause Resume Pause at once: it ends paused", engine.get(id).state === "paused", engine.get(id).state);
  engine.resume(id);
  await DL.until(id, ["downloading"], { test: (v) => !v.phase, timeout: 10000 });
  spike.press("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel");
  await sleep(400);
  b.root.querySelector(`.vd-row[data-id="${id}"]`)?.focus();
  spike.press(" ");
  spike.press(" ");
  await sleep(1500);
  check("Space Space on a running row: it keeps downloading", ["downloading", "queued"].includes(engine.get(id).state), engine.get(id).state);
  spike.press("Escape");
  await sleep(400);
  const fin = await DL.until(id, ["completed", "failed"], { timeout: 120000 });
  check("after all that the file is intact", fin.state === "completed" && (await DL.sha256(fin.path)) === m["big.bin"].sha256, fin.error);

  // ---- rapid keys and clicks ----
  for (let i = 0; i < 15; i++) spike.press("Ctrl+J");
  await sleep(600);
  check("Ctrl+J 15 times: the panel is open (odd count)", ui.panel.open);
  check("... and there is one panel", b.root.querySelectorAll(".vd-panel").length === 1, b.root.querySelectorAll(".vd-panel").length);
  spike.press("Escape");
  await sleep(500);
  check("one Esc closes it", !ui.panel.open && b.root.querySelectorAll(".vd-panel").length === 0);

  const slow = engine.start(DL.base + "/blob/big?rate=128", { filename: "slow.bin", named: true });
  await DL.until(slow, ["downloading"], { timeout: 20000 });
  await V.until(() => ui.ring.isShown, "the ring");
  await sleep(400);
  const ringBtn = ui.ring.el.querySelector("button");
  for (let i = 0; i < 10; i++) {
    ringBtn.click();
    await sleep(15);
  }
  await sleep(500);
  check("the ring clicked 10 times: no quick view left open or half-closed", !ui.ring.pop.isOpen && b.root.querySelectorAll(".vd-pop").length === 0, b.root.querySelectorAll(".vd-pop").length);
  ringBtn.click();
  await sleep(500);
  check("one more click opens one quick view", ui.ring.pop.isOpen && b.root.querySelectorAll(".vd-pop").length === 1);
  spike.press("Escape");
  await sleep(300);

  await DL.open(DL.base + "/video.html", { settle: 1500 });
  for (let i = 0; i < 5; i++) {
    spike.press("Ctrl+Shift+D");
    await sleep(30);
  }
  await sleep(1500);
  check("Ctrl+Shift+D 5 times: at most one picker", b.root.querySelectorAll(".vd-picker").length <= 1, b.root.querySelectorAll(".vd-picker").length);
  ui.video.picker.close(false);
  await sleep(300);

  // ---- six at once ----
  const six = Array.from({ length: 6 }, (_, i) => engine.start(DL.base + `/blob/medium?rate=64&n=${i}`, { filename: `batch-${i}.bin`, named: true }));
  await sleep(1500);
  const states = six.map((x) => engine.get(x));
  const running = states.filter((v) => v.state === "downloading").length;
  const queued = states.filter((v) => v.state === "queued").map((v) => v.queuePos);
  log("six:", states.map((v) => `${v.filename}:${v.state}:${v.queuePos}`));
  check("six started at once: at most two run (with the slow one already running: one)", running === 1, running);
  check("the rest wait in order 1..5", JSON.stringify(queued) === "[1,2,3,4,5]", queued);
  for (const x of six) engine.cancel(x);
  engine.cancel(slow);
  await sleep(500);

  // ---- DRM after the offer ----
  await DL.open(DL.base + "/video-file.html", { settle: 1500 });
  spike.press("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "the picker");
  await sleep(300);
  const bid = gBrowser.selectedBrowser.browsingContext.browserId;
  check("the page has no DRM yet: the picker offers its video", !engine.media.isProtected(bid));
  // The page now starts a ClearKey session (as a player does after its first frames).
  await DL.frameScript(gBrowser.selectedBrowser, () => {
    const s = content.document.createElement("script");
    s.textContent = `navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then((a) => a.createMediaKeys()).then((k) => document.getElementById('v').setMediaKeys(k)).catch((e) => { document.title = 'eme failed ' + e; })`;
    content.document.head.append(s);
    return true;
  });
  await V.until(() => engine.media.isProtected(bid), "the page's key session to be seen", 10000);
  await sleep(800);
  check("the open picker closes when the page turns to DRM", !ui.video.picker.isOpen);
  check("the pill says Protected video", ui.video.state.mode === "protected" || !ui.video.state.shown, ui.video.state.mode);
  const before = engine.list().length;
  let threw = "";
  try {
    engine.start(DL.base + "/media/clip?x=.mp4", { browserId: bid, videoKey: "x", filename: "clip.mp4", named: true });
  } catch (e) {
    threw = String(e.message || e);
  }
  check("the engine refuses media for a tab that uses DRM, whoever asks", /protected/i.test(threw) && engine.list().length === before, threw);
  b.service("downloads").download(DL.base + "/fx/clip.mp4", { browser: gBrowser.selectedBrowser });
  await sleep(300);
  check("the downloads service refuses it too", engine.list().length === before);
  await V.capture("v-rapid-01-drm-after-offer");

  // ---- idle ----
  await DL.open(DL.base + "/page.html");
  for (const x of engine.list()) if (!["completed", "failed", "cancelled"].includes(x.state)) engine.cancel(x.id);
  await V.until(() => !ui.ring.isShown, "the ring to hide (6 s after the last download)", 12000);
  await sleep(1000);
  check("nothing downloading: the engine's ticker has stopped", !engine.ticker, !!engine.ticker);
  // Let the work of the steps above (part files removed, a 256 MiB checksum, a page with EME closed) settle.
  await sleep(10000);
  const c0 = await V.cpuMs();
  const steps = [];
  for (let i = 0, last = c0; i < 10; i++) {
    await sleep(1000);
    const now = await V.cpuMs();
    steps.push(Math.round(now - last));
    last = now;
  }
  const c1 = await V.cpuMs();
  const cpu = c1 - c0;
  log("parent CPU over 10 s idle (ms)", Math.round(cpu), "per second", steps);
  // One-off bursts (garbage and cycle collection after the 256 MiB transfers above) are not the
  // module's: the typical second is what idling costs.
  const median = [...steps].sort((a, c) => a - c)[5];
  check("idle: the typical second costs the parent process under 3% of a core", median < 30, { median, steps });
  // Idle with a paused download (the taskbar shows it; nothing else runs).
  const p = engine.start(DL.base + "/blob/big?rate=512", { filename: "idle-paused.bin", named: true });
  await DL.until(p, ["downloading"], { test: (v) => v.received > 1 << 20 && !v.phase, timeout: 20000 });
  engine.pause(p);
  await engine.whenSettled(p);
  await sleep(3000);
  const d0 = await V.cpuMs();
  await sleep(10000);
  const d1 = await V.cpuMs();
  log("parent CPU over 10 s with a paused download (ms)", Math.round(d1 - d0));
  check("idle with a paused download: still under 3%", d1 - d0 < 300, Math.round(d1 - d0));
  check("... and the engine's ticker is stopped", !engine.ticker);
  engine.cancel(p);

  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
