// Quit and restart while downloading. Run 1: a 256 MiB download on 8 connections; Exit is refused
// with Vitre's prompt ("Keep downloading" keeps it going); a restart is confirmed from the prompt,
// the download is paused where it was and its segments written to the store. Run 2: the download is
// back, paused, with its bytes; resuming fetches only what is missing (If-Range) and the file is intact.
/* global spike, Services, Ci, IOUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();

  if (spike.run === 1) {
    await DL.open(DL.base + "/page.html");
    await DL.reset();
    const id = engine.start(`${DL.base}/blob/big?rate=1024`, { filename: "restart.bin", named: true, pageUrl: DL.base + "/page.html" });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 48 << 20, timeout: 60000, what: "48 MB" });

    // Exit while downloading: refused, the prompt asks.
    b.run("quit");
    await waitFor(() => ui.prompt.isOpen, { timeout: 5000, what: "the quit prompt" });
    check("Exit while downloading shows Vitre's prompt instead of quitting", ui.prompt.isOpen);
    await sleep(400);
    await spike.capture("restart-1-quit-prompt");
    const box = b.root.querySelector(".vd-quit");
    check("the prompt says how many are running", /still running/.test(box.textContent), box.textContent);
    spike.click(b.root.querySelector(".vd-q-keep"));
    await sleep(500);
    check("'Keep downloading' keeps Vitre and the download going", !ui.prompt.isOpen && engine.get(id).state === "downloading");

    // Closing the last window while downloading asks the same.
    b.run("closeWindow");
    await waitFor(() => ui.prompt.isOpen, { timeout: 5000, what: "the close prompt" });
    check("closing the last window while downloading asks first", ui.prompt.isOpen && !window.closed);
    spike.press("Escape");
    await sleep(400);
    check("Esc keeps the window and the download", !ui.prompt.isOpen && !window.closed && engine.get(id).state === "downloading");

    // Restart: refused too; confirmed from the prompt it goes ahead and pauses the download.
    // (Firefox's own restarts ask first, as canQuitApplication("restart") in globalOverlay.js.)
    Services.prefs.savePrefFile(null);
    const allowed = window.canQuitApplication("restart");
    check("a restart while downloading is refused at first", allowed === false, allowed);
    if (allowed) Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    await waitFor(() => ui.prompt.isOpen, { timeout: 5000, what: "the restart prompt" });
    const go = b.root.querySelector(".vd-q-go");
    check("the restart prompt offers Restart", go?.textContent === "Restart", go?.textContent);
    log("received before restart", engine.get(id).received);
    spike.click(go);
    await new Promise(() => {}); // the process restarts; this script runs again with spike.run === 2
  }

  // ---- run 2 ----
  const v = engine.list(false).find((x) => x.filename === "restart.bin");
  check("the download is back after the restart", !!v, engine.list().map((x) => x.filename));
  if (!v) return;
  check("it is paused, with its bytes and segments", v.state === "paused" && v.received > 40 << 20 && v.segments.filter((x) => x > 0).length >= 8, { state: v.state, received: v.received, segs: v.segments });
  check("its .part file is there", await IOUtils.exists(v.path + ".part"));
  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(700);
  await spike.capture("restart-2-panel-after-restart");
  await DL.reset();
  engine.resume(v.id);
  const done = await DL.until(v.id, ["completed", "failed"], { timeout: 120000 });
  check("the resumed download completed", done.state === "completed", done.error);
  check("sha256 after the restart matches", (await DL.sha256(done.path)) === m["big.bin"].sha256);
  const st = await DL.stats();
  const reqs = st.requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && r.end > r.start);
  const fetched = reqs.reduce((n, r) => n + (r.sent || 0), 0);
  check("every request after the restart carries If-Range", reqs.length >= 8 && reqs.every((r) => r.ifrange), reqs.length);
  check("only what was missing was fetched again", fetched <= m["big.bin"].size - v.received + 1, { fetched, missing: m["big.bin"].size - v.received });
});
