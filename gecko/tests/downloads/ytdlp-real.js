// Diagnostic against the real world (not in the default set): the installer gets the real yt-dlp and
// Deno from GitHub (checked against their published SHA-256) into a temporary folder, then a real
// YouTube video ("Me at the zoo", 19 s) is offered and downloaded through the picker.
//   python tests/downloads/all.py ytdlp-real
/* global spike, Services, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, waitFor, sleep, log } = spike;
  await DL.init();
  await spike.resize(1280, 860);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const engine = DL.engine;
  const dir = PathUtils.join(PathUtils.tempDir, "vitre-tools-real");
  Services.prefs.setStringPref("vitre.tools.installDir", dir);

  const phases = [];
  const off = engine.onYtdlpInstall((s) => {
    const k = s.phase + (s.tool ? ":" + s.tool : "");
    if (phases[phases.length - 1] !== k) phases.push(k);
  });
  const t0 = Date.now();
  await engine.installYtdlp(false).catch((e) => log("install error " + e));
  off();
  log("install phases " + phases.join(" > ") + " in " + (Date.now() - t0) + " ms");
  check("yt-dlp and Deno installed from their releases", engine.ytdlpInstall().phase === "done" && engine.hasYtdlp(), engine.ytdlpInstall());
  const version = await engine.ytdlpVersion();
  log("version " + version);
  check("their versions are read", /^yt-dlp \d{4}\.\d{2}\.\d{2}.* · Deno \d/.test(version), version);

  const t = b.active();
  b.navigate(t.id, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await waitFor(() => !t.loading && /watch/.test(t.browser.currentURI.spec), { timeout: 30000, what: "YouTube" });
  await sleep(3000);
  spike.click(b.bar.downloadMark());
  const t1 = Date.now();
  await waitFor(() => ui.video.picker.isOpen || (b.root.querySelector(".vd-note") && !/Finding/.test(b.root.querySelector(".vd-note").textContent)), { timeout: 120000, what: "an answer" });
  log("answer in " + (Date.now() - t1) + " ms");
  const noteText = b.root.querySelector(".vd-note")?.textContent ?? "";
  check("the picker offers the real video's qualities", ui.video.picker.isOpen, noteText);
  if (!ui.video.picker.isOpen) return;
  const pick = ui.video.picker.element;
  log("rows " + JSON.stringify([...pick.querySelectorAll(".vd-opt")].map((r) => r.textContent.replace(/\s+/g, " ").trim())));
  await spike.capture("real-1-picker");
  const before = engine.list(false).length;
  spike.click(pick.querySelector(".vd-go"));
  const dl = await waitFor(() => engine.list(false).length > before && engine.list(false)[0], { timeout: 10000, what: "the download" });
  const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 240000 });
  log("download " + JSON.stringify({ state: done.state, file: done.filename, received: done.received, error: done.error }));
  check("the real YouTube video downloads", done.state === "completed" && (await IOUtils.exists(done.path)) && (await IOUtils.stat(done.path)).size > 100000, done.error);
  await spike.capture("real-2-done");
  if (done.path) await IOUtils.remove(done.path, { ignoreAbsent: true });
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
