// Quit and restart while downloading. Run 1: a 256 MiB download on 8 connections; Exit is refused
// with Vitre's prompt ("Keep downloading" keeps it going); a restart is confirmed from the prompt,
// the download is paused where it was and its segments written to the store. Run 2: the download is
// back, paused, with its bytes; resuming fetches only what is missing (If-Range) and the file is intact.
// Then Phase 5 (spikes/downloader/RESUME-DESIGN.md 4.2): a paused download whose record says what a power
// loss leaves (the dirty mark set, no seal reached the disk) and 3 MiB of zeros under its claims: Resume
// checks every hashed block, finds the zeros, fetches those blocks again, says so, and the file is intact.
/* global spike, Services, Cc, Ci, IOUtils, DL */
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
  // The resume's probe carries window 0 (bytes=0-65535, RESUME-DESIGN.md 2.5): compared, not fetched again.
  const fetched = reqs.filter((r) => r.range !== "bytes=0-65535").reduce((n, r) => n + (r.sent || 0), 0);
  check("every request after the restart carries If-Range", reqs.length >= 8 && reqs.every((r) => r.ifrange), reqs.length);
  check("only what was missing was fetched again", fetched <= m["big.bin"].size - v.received + 1, { fetched, missing: m["big.bin"].size - v.received });

  // ---- Phase 5: the dirty mark and 3 MiB of zeros under the claims ----
  const MiB = 1 << 20;
  const medium = m["medium.bin"];
  await DL.reset();
  const z = engine.start(`${DL.base}/blob/medium?rate=1024`, { filename: "zeros.bin", named: true });
  await DL.until(z, ["downloading"], { test: (x) => x.received > 18 * MiB && !x.phase, timeout: 60000, what: "18 MiB" });
  engine.pause(z);
  const zp = await DL.until(z, ["paused"], { timeout: 10000 });
  const zr = engine.recs.find((x) => x.id === z);
  await waitFor(() => !engine.sealing.has(z) && zr.file.dirty === false, { timeout: 15000, what: "the pause's seal" });
  // What a power loss leaves: the mark a run sets before it writes, no seal on the disk, and zeros where the
  // disk never got the cached pages (1.5 MiB at the start of each of the first two segments).
  const zl = engine.ledgers.get(z);
  zl.seal = null;
  zr.file.dirty = true;
  const zeros = new Uint8Array(1.5 * MiB);
  const segs = zr.file.segments.slice(0, 2);
  check("the first two segments claim at least 1.5 MiB each", segs.length === 2 && segs.every((s) => s.received >= 1.5 * MiB), segs);
  for (const s of segs) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(zp.path + ".part");
    const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    out.init(file, 0x02, 0o644, 0);
    out.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, s.start);
    const bin = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    bin.setOutputStream(out);
    bin.writeByteArray(zeros);
    bin.close();
  }
  await DL.reset();
  engine.resume(z);
  const zd = await DL.until(z, ["completed", "failed"], { timeout: 90000, what: "the dirty download" });
  check("the zeros are caught and fetched again: the file is intact (sha256)", zd.state === "completed" && (await DL.sha256(zd.path)) === medium.sha256, [zd.state, zd.error]);
  const zreqs = (await DL.stats()).requests.filter((r) => r.path.startsWith("/blob/medium") && r.status === 206 && r.range !== "bytes=0-65535");
  check("the blocks the zeros were in were fetched again, from each segment's start", segs.every((s) => zreqs.some((r) => r.start === s.start)), zreqs.map((r) => r.range));
  const zline = (zd.history ?? []).map((h) => h.text).find((t) => t.startsWith("Checked after Deer closed unexpectedly"));
  check("its history says so", !!zline && / · \d+(\.\d)? MB fetched again$/.test(zline), zd.history);
});
