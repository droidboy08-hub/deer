// Phase 5 of spikes/downloader/RESUME-DESIGN.md (section 4: the block hash record, crash recovery, Check
// file and Repair), against the local server (tests/downloads/server.py). medium.bin is 24 MiB, so its
// blocks are 1 MiB (ledger.ts blockSize()) and its 8 segments 3 MiB each, cut at block boundaries:
//   - record: a download keeps <profile>/vitre-downloads/<id>.jsonl while it runs (a header, a line per
//     hashed block, seals); a pause seals it (the dirty mark cleared); a finished file keeps it as
//     <id>.done.jsonl with its whole-file SHA-256, which equals the fixture's; Remove from list removes it;
//   - flip: bytes flipped in block k of the .part during a pause, more than 5 s after its seal (another
//     program changed it): Resume checks every block, only block k is fetched again (one range, exactly
//     the block), the history says so, sha256 equal;
//   - missing: the .part deleted during a pause: it starts over, saying so, and completes intact;
//   - corrupt: /corrupt-once sends one byte of block 5 wrong, once, with a Repr-Digest of the true file:
//     the checksum does not match at the end, every block matches its record (the wrong byte was hashed as
//     it arrived), so each block is compared with the site and only block 5 is replaced; sha256 equal;
//   - finished: a byte flipped in a finished file, its modified time kept (silent damage): Check file finds
//     1 damaged part (Damaged: the error colour, the bar's stretch emptied, Repair · Open anyway · Show in
//     folder · Remove from list); Space is Repair, which asks for one block's range (besides the proof's
//     64 KiB windows) and writes it; sha256 equals the fixture; "Repaired 1 damaged part";
//   - changed: the same damage, then the file on the site changes (/swap): Repair refuses, writes nothing,
//     and offers Download again;
//   - edited: a finished file modified later (its modified time after the finish): Changed after download in
//     the normal colour, "This file was changed on ...", Space only moves focus to Restore original; Restore
//     original (chosen) puts the original back (sha256 equal);
//   - check: Check file on an intact finished file: "no damage found";
//   - torn: a journal whose last line a crash cut (5.7) is read without it: the paused download's record
//     comes back (its resume asks no window to build a new one) and it completes intact.
// From the review of Phase 5 (each failed on the reviewed build):
//   - once: a link that allows one full download (every byte sent, then 403), Last-Modified only or no
//     validator at all: the completion check can't compare, so it completes as before Phase 5, at once;
//   - small: a file under 1 MiB with no validators that changes while it downloads: the completion check
//     sees it, it starts again by itself and completes with the new file (its old block hashes forgotten);
//   - uneven: a paused download whose first segment ran ahead (hashed blocks there only), its signed link
//     expired: the original address mints a new one, which is proven with windows over every stretch and
//     continues ("New link found"), never File changed;
//   - edit: a Damaged file the person then edited: it reads Changed after download, Space only moves focus,
//     and Repair (asked twice) refuses and writes nothing over the edit;
//   - cut: a repair Deer cut short (aborted after its first block, as a quit does) never reads Changed after
//     download, and the next start's check finds the 2 blocks still damaged; the same after a simulated crash
//     (the repair line and the row's mark left, Deer's write moving the modified time); Repair then completes;
//   - keep: Keep partial file, then Check file: no damage (the blocks past the cut are not in the record);
//   - restore: Restore original whose link is refused leaves the edited file exactly as it was; one whose
//     every block moved (1 MiB inserted at the start) puts the original back from the record;
//   - leak: Remove from list and Cancel while a pause's seal runs leave no journal in the profile;
//   - final: Cancel and Pause that come once every byte is in, before the rename, are honoured;
//   - older: a finished file with no record and no checksum (an older row): one damaged block of 24 is
//     local damage (compared with the site), which Repair fixes; two (8%) is another file.
// VITRE_DL_ONLY=a,b runs only those sections.
/* global spike, Services, Cc, Ci, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const MiB = 1 << 20;
  const medium = m["medium.bin"];
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const journals = PathUtils.join(PathUtils.profileDir, "vitre-downloads");
  const rec = (id) => engine.recs.find((r) => r.id === id);
  const ledger = (id) => engine.ledgers.get(id);
  const events = (id) => (rec(id)?.events ?? []).map((e) => e.text);
  const control = async (route) => (await fetch(DL.base + route, { cache: "no-store" })).json();
  // Every byte count recorded (DL.settledStats(): the server writes it after its last pacing pause).
  const asked = async (prefix) => (await DL.settledStats()).requests.filter((r) => r.path.startsWith(prefix));
  /** Bytes sent by 206s after a resume's probe (which carries window 0). */
  const sentAfterProbe = (reqs) => reqs.filter((r) => r.status === 206 && r.range !== "bytes=0-65535").reduce((n, r) => n + (r.sent || 0), 0);
  /** Bytes written into a file at an offset, its modified time kept or set (`mtime`). */
  const writeAt = async (path, offset, bytes, mtime = null) => {
    const keep = mtime ?? (await IOUtils.stat(path)).lastModified;
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(file, 0x02, 0o644, 0);
    s.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, offset);
    const out = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    out.setOutputStream(s);
    out.writeByteArray(bytes);
    out.close();
    if (mtime !== false) await IOUtils.setModificationTime(path, keep);
  };
  /** The bytes at an offset, every one inverted (other bytes, as damage leaves). */
  const inverted = async (path, offset, n) => (await IOUtils.read(path, { offset, maxBytes: n })).map((x) => x ^ 0xff);
  const journalLines = async (path) => (await IOUtils.readUTF8(path)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  /** The finished file's record kept (<id>.done.jsonl) and its SHA-256 known: computed right after it reads Completed. */
  const recorded = (id) => waitFor(() => !!rec(id)?.sha256 && /\.done\.jsonl$/.test(rec(id)?.journal ?? ""), { timeout: 20000, what: "the finished file's record" });
  /** A completed download of medium.bin from `url` as `name`, its record kept. */
  const fetchDone = async (url, name) => {
    const id = engine.start(url, { filename: name, named: true });
    const v = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: name });
    check(`${name} downloads`, v.state === "completed" && (await DL.sha256(v.path)) === medium.sha256, [v.state, v.error]);
    await recorded(id);
    return v;
  };
  const row = (id) => b.root.querySelector(`.vd-row[data-id="${id}"]`);
  const details = () => b.root.querySelector(".vd-details");
  const acts = () => Array.from(details().querySelectorAll("[data-act]")).map((x) => x.textContent);
  const cap = () => details().querySelector(".vd-d-cap").textContent;
  const showRow = async (id) => {
    ui.panel.show(id);
    await waitFor(() => ui.panel.open && !!row(id), { what: "the panel with the row" });
    await sleep(500);
  };
  const hidePanel = async () => {
    if (!ui.panel.open) return;
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    await sleep(200);
  };
  /** Check file on a finished row, done (`quiet`: as the check after a start runs it, no network). */
  const checkFile = async (id, quiet = false) => {
    await engine.checkFile(id, quiet);
    return waitFor(() => (engine.get(id).phase === "" && engine.get(id).check ? engine.get(id) : null), { timeout: 30000, what: "Check file" });
  };
  const fixturePath = PathUtils.join(DL.fix, "medium.bin");
  /** SHA-256 of bytes, hex. */
  const sha256Of = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
  /** Bytes a row's segments claim. */
  const savedOf = (r) => (r.file?.segments ?? []).reduce((n, s) => n + s.received, 0);
  /** A completed download of the first `size` bytes of medium.bin (/vary?size=), its record kept. */
  const fetchSized = async (url, name, size) => {
    const id = engine.start(url, { filename: name, named: true });
    const v = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: name });
    check(`${name} downloads`, v.state === "completed" && (await DL.sha256(v.path)) === (await sha256Of(await IOUtils.read(fixturePath, { maxBytes: size }))), [v.state, v.error]);
    await recorded(id);
    return v;
  };
  /** The journals in the profile that belong to a row. */
  const journalsOf = async (id) => (await IOUtils.getChildren(journals).catch(() => [])).map((p) => PathUtils.filename(p)).filter((n) => n.startsWith(id));

  // ---- record: the journal while running, sealed at a pause, kept with the finished file ----
  if (want("record") || want("flip")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/blob/medium?rate=1024`, { filename: "flip.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 16 * MiB && !v.phase, timeout: 60000, what: "16 MiB" });
    const jpath = rec(id).journal;
    check("a running download keeps its block hash record in the profile (<id>.jsonl), marked dirty", jpath === PathUtils.join(journals, `${id}.jsonl`) && rec(id).file.dirty === true, { jpath, dirty: rec(id).file.dirty });
    engine.pause(id);
    await DL.until(id, ["paused"], { timeout: 10000 });
    await waitFor(() => rec(id).file.dirty === false && !engine.sealing.has(id), { timeout: 15000, what: "the pause's seal" });
    const l = ledger(id);
    const lines = await journalLines(jpath);
    const head = lines[0];
    const seal = lines.filter((x) => Array.isArray(x.cov)).pop();
    const segs = rec(id).file.segments;
    const claimed = segs.reduce((n, s) => n + s.received, 0);
    check("its header names the file, its length and 1 MiB blocks; the segments are cut at block boundaries", head.deer === 1 && head.total === medium.size && head.bs === MiB && segs.every((s) => s.start % MiB === 0), { head, segs: segs.map((s) => [s.start, s.end, s.received]) });
    check("the pause drained the hashing and sealed: every whole block under the claims is hashed, the seal line has the coverage, the dirty mark is cleared", l.covered(segs).every((k) => l.blocks.has(k)) && l.blocks.size === l.covered(segs).length && !!seal && seal.cov.reduce((n, [, r]) => n + r, 0) === claimed, { hashed: l.blocks.size, covered: l.covered(segs).length, seal });
    log("seal flushed the .part:", seal.f === 1);

    // ---- flip: another program changes block k while it is paused ----
    if (want("flip")) {
      // Block k: the second block of the third segment (6..9 MiB), wholly saved and hashed.
      const k = 7;
      check("block 7 is saved and hashed", l.blocks.has(k), [...l.blocks.keys()]);
      const part = rec(id).path + ".part";
      // More than 5 s after the seal: the .part's modified time says another program wrote it (4.2).
      await waitFor(() => Date.now() > l.seal.t + 6000, { timeout: 10000, interval: 200, what: "6 s after the seal" });
      await writeAt(part, k * MiB + 4096, await inverted(part, k * MiB + 4096, 512), false);
      await DL.reset();
      engine.resume(id);
      const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the resume" });
      check("the download completes intact (sha256)", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [done.state, done.error]);
      const reqs = await asked("/blob/medium");
      const fetched = sentAfterProbe(reqs);
      const exact = reqs.filter((r) => r.status === 206 && r.start === k * MiB && r.end === (k + 1) * MiB - 1);
      // Besides block 7, only what was missing, and what no hashed block covered (the part of a block below
      // each frontier, which no hash can check).
      const kept = segs.reduce((n, s) => n + Math.floor(s.received / MiB) * MiB, 0);
      check("only block 7 was fetched again: one request for exactly its range, and only what was missing besides", exact.length === 1 && fetched === medium.size - kept + MiB, { fetched, expected: medium.size - kept + MiB, ranges: reqs.map((r) => `${r.status} ${r.range}`) });
      check("its history says another program changed the saved part", events(id).some((t) => /^The saved part was changed by another program · [\d.]+ MB fetched again$/.test(t)), events(id));
      await recorded(id);
      const done2 = PathUtils.join(journals, `${id}.done.jsonl`);
      const fin = (await journalLines(done2)).filter((x) => typeof x.fin === "string").pop();
      check("the finished file keeps its record as <id>.done.jsonl, with its whole-file SHA-256", !(await IOUtils.exists(jpath)) && fin?.fin === medium.sha256 && rec(id).sha256 === medium.sha256 && fin.size === medium.size, { fin, sha: rec(id).sha256 });
      engine.remove(id);
      await sleep(500);
      check("Remove from list removes the record (never the file)", !(await IOUtils.exists(done2)) && (await IOUtils.exists(done.path)));
    }
  }

  // ---- missing: the .part deleted during a pause ----
  if (want("missing")) {
    const id = engine.start(`${DL.base}/blob/medium?rate=512`, { filename: "gone.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 4 * MiB && !v.phase, timeout: 60000, what: "4 MiB" });
    engine.pause(id);
    const p = await DL.until(id, ["paused"], { timeout: 10000 });
    await waitFor(() => !engine.sealing.has(id), { timeout: 10000, what: "the seal" });
    // The person deletes it (a scan of the just-closed file may hold it a moment).
    for (let i = 0; i < 10; i++) {
      try {
        await IOUtils.remove(p.path + ".part");
        break;
      } catch (e) {
        log("remove", String(e));
        await sleep(500);
      }
    }
    engine.resume(id);
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the start over" });
    check("a .part deleted during a pause: it starts over without asking, saying so, and completes intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && events(id).includes("Started over: the saved part was moved or deleted"), { state: done.state, events: events(id) });
    engine.remove(id);
  }

  // ---- corrupt: the network delivered one wrong block once ----
  if (want("corrupt")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/corrupt-once/medium?k=c1&block=5`, { filename: "corrupt.bin", named: true });
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the corrupted download" });
    const reqs = await asked("/corrupt-once/medium");
    const wrong = reqs.filter((r) => r.corrupted);
    check("the site sent one byte of block 5 wrong, once", wrong.length === 1, reqs.map((r) => `${r.status} ${r.range} ${r.corrupted ? "corrupted" : ""}`));
    check("the checksum did not match, every block matched its record, so the blocks were compared with the site and only block 5 replaced: complete and intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && events(id).includes("The checksum did not match: 1 damaged part fetched again"), { state: done.state, error: done.error, events: events(id) });
    const compared = reqs.filter((r) => r.status === 206 && r.end - r.start + 1 === MiB);
    log("blocks asked for the comparison:", compared.length, "(each into memory; only the one that differed was written)");
    engine.remove(id);
  }

  // ---- finished: silent damage in a finished file; Check file, then Repair ----
  if (want("finished")) {
    const v = await fetchDone(`${DL.base}/blob/medium`, "finished.bin");
    const k = 9;
    await writeAt(v.path, k * MiB + 12345, await inverted(v.path, k * MiB + 12345, 1));
    const c = await checkFile(v.id);
    check("Check file finds 1 damaged part: Damaged (need 'repair')", c.need?.kind === "repair" && c.check?.bad === 1 && c.check.badBytes === MiB && !c.check.edited, { need: c.need, check: c.check });
    await showRow(v.id);
    const status = row(v.id).querySelector(".vd-status");
    check("Damaged in the error colour; its bar shows the damaged stretch emptied", status.textContent === "Damaged" && status.classList.contains("err") && c.segments.length === 8 && c.segments.filter((x) => x < 1).length === 1, { status: status.textContent, cls: status.className, segs: c.segments });
    check("Damaged details: Repair · Open anyway · Show in folder · Remove from list, and what Repair does", acts().join("|") === "Repair|Open anyway|Show in folder|Remove from list" && cap() === "1 damaged part (1.0 MB). Repair fetches only that part again." && details().querySelector(".vd-d-cap").classList.contains("err"), { acts: acts(), cap: cap() });
    check("its row's label and verb", /^finished\.bin, Damaged, 1 damaged part$/.test(row(v.id).getAttribute("aria-label")) && row(v.id).querySelector(".primary").getAttribute("aria-label") === "Repair finished.bin", [row(v.id).getAttribute("aria-label"), row(v.id).querySelector(".primary").getAttribute("aria-label")]);
    await spike.capture("repair-1-damaged");
    await DL.reset();
    // Space on a Damaged row is Repair (RESUME-DESIGN.md 6).
    row(v.id).focus();
    spike.press("Space");
    const r = await waitFor(() => (engine.get(v.id).phase === "" && !engine.get(v.id).need ? engine.get(v.id) : null), { timeout: 30000, what: "Repair" });
    const reqs = await asked("/blob/medium");
    const blocks = reqs.filter((q) => q.status === 206 && q.end - q.start + 1 > 65536);
    check("Space repaired it: one block's range asked for (besides the proof's 64 KiB windows), and sha256 equals the fixture", blocks.length === 1 && blocks[0].start === k * MiB && blocks[0].end === (k + 1) * MiB - 1 && (await DL.sha256(v.path)) === medium.sha256 && reqs.every((q) => q.status === 206), { ranges: reqs.map((q) => `${q.status} ${q.range}`) });
    check("it reads Completed again, with 'Repaired 1 damaged part'", r.state === "completed" && r.check?.ok && row(v.id).querySelector(".vd-status").textContent === "Completed" && events(v.id).includes("Repaired 1 damaged part"), { check: r.check, events: events(v.id) });
    const lines = await journalLines(rec(v.id).journal);
    check("the repair wrote its durable line before writing, and the repaired line after", lines.some((x) => Array.isArray(x.repair) && x.repair[0] === k) && lines.some((x) => Array.isArray(x.repaired)), lines.filter((x) => x.repair || x.repaired));
    const again = await checkFile(v.id);
    check("Check file afterwards: no damage found", again.check?.ok && !again.need && events(v.id).includes("Checked: no damage found"), { check: again.check, events: events(v.id) });
    await hidePanel();
  }

  // ---- changed: the file on the site changed: Repair refuses ----
  if (want("changed")) {
    const v = await fetchDone(`${DL.base}/swap/medium?val=etag&k=rp1`, "swapped.bin");
    const k = 3;
    await writeAt(v.path, k * MiB + 99, await inverted(v.path, k * MiB + 99, 1));
    const c = await checkFile(v.id);
    check("the damage is found", c.need?.kind === "repair" && c.check?.bad === 1, c.check);
    const before = await DL.sha256(v.path);
    await control("/flag?k=rp1");
    await DL.reset();
    await engine.repair(v.id);
    const r = engine.get(v.id);
    const reqs = await asked("/swap/medium");
    check("the site has another file now: Repair refuses, writes nothing, still Damaged, and offers Download again", r.need?.kind === "repair" && r.check?.site === "changed" && (await DL.sha256(v.path)) === before && !reqs.some((q) => q.status === 206 && q.end - q.start + 1 === MiB), { check: r.check, ranges: reqs.map((q) => `${q.status} ${q.range}`) });
    await showRow(v.id);
    check("its details say why and offer Download again", acts()[0] === "Download again" && cap() === "The file on the site is different now, so this copy can’t be repaired. Download again gets the new one.", { acts: acts(), cap: cap() });
    await spike.capture("repair-2-changed");
    await hidePanel();
  }

  // ---- edited: Changed after download, never damage; Restore original only when chosen ----
  if (want("edited")) {
    const v = await fetchDone(`${DL.base}/blob/medium`, "edited.bin");
    const st = await IOUtils.stat(v.path);
    // A tag editor changed it ten minutes later.
    await writeAt(v.path, 2 * MiB + 7, new Uint8Array(32).fill(0x41), st.lastModified + 10 * 60 * 1000);
    const edited = await DL.sha256(v.path);
    await showRow(v.id);
    const status = row(v.id).querySelector(".vd-status");
    check("Changed after download, in the normal colour, never Damaged", status.textContent === "Changed after download" && !status.classList.contains("err") && !engine.get(v.id).need, { status: status.textContent, cls: status.className });
    check("its caption says when, and Restore original comes first", /^This file was changed on (\d{1,2} \w+|\w+ \d{1,2}), \d{1,2}:\d{2}/.test(cap()) && acts().join("|") === "Restore original|Open|Show in folder|Remove from list" && !details().querySelector(".vd-d-cap").classList.contains("err"), { cap: cap(), acts: acts() });
    await spike.capture("repair-3-changed-after-download");
    row(v.id).focus();
    spike.press("Space");
    await sleep(600);
    check("Space only moves focus to Restore original: nothing is restored", document.activeElement?.dataset?.act === "restore" && (await DL.sha256(v.path)) === edited && !engine.fixing.has(v.id), document.activeElement?.textContent);
    const c = await checkFile(v.id);
    check("Check file says the same: Changed after download, not damage", c.check?.edited && !c.need, c.check);
    await DL.reset();
    spike.click(details().querySelector('[data-act="restore"]'));
    await waitFor(() => (engine.get(v.id).phase === "" && !engine.get(v.id).check?.edited && events(v.id).includes("Original restored") ? true : null), { timeout: 30000, what: "Restore original" });
    await sleep(600);
    const reqs = await asked("/blob/medium");
    const sha = await DL.sha256(v.path);
    check("Restore original (chosen) puts the original back: one block fetched, sha256 equals the fixture, Completed", sha === medium.sha256 && reqs.filter((q) => q.status === 206 && q.end - q.start + 1 === MiB).length === 1 && row(v.id).querySelector(".vd-status").textContent === "Completed", { sha: sha === medium.sha256, status: row(v.id).querySelector(".vd-status").textContent, check: engine.get(v.id).check, ranges: reqs.map((q) => `${q.status} ${q.range}`) });
    await hidePanel();
  }

  // ---- check: an intact finished file ----
  if (want("check")) {
    const v = await fetchDone(`${DL.base}/blob/medium`, "intact.bin");
    await DL.reset();
    const c = await checkFile(v.id);
    const reqs = await asked("/blob/medium");
    check("Check file on an intact file with its record: no damage found, nothing asked of the site", c.check?.ok && !c.need && events(v.id).includes("Checked: no damage found") && reqs.length === 0, { check: c.check, reqs: reqs.length });
    await showRow(v.id);
    check("a finished row offers Check file (details, and the row's menu with access key H)", acts().includes("Check file"), acts());
    await hidePanel();
  }

  // ---- torn: a journal whose last line was cut ----
  if (want("torn")) {
    const id = engine.start(`${DL.base}/blob/medium?rate=1024`, { filename: "torn.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 12 * MiB && !v.phase, timeout: 60000, what: "12 MiB" });
    engine.pause(id);
    await DL.until(id, ["paused"], { timeout: 10000 });
    await waitFor(() => !engine.sealing.has(id) && rec(id).file.dirty === false, { timeout: 15000, what: "the pause's seal" });
    const hashed = [...ledger(id).blocks.keys()];
    const claimed = rec(id).file.segments.reduce((n, s) => n + s.received, 0);
    await IOUtils.writeUTF8(rec(id).journal, '{"b":3,"h":"0123456789ab', { mode: "append" });
    // As at the next start: the record is read from its journal.
    engine.ledgers.delete(id);
    await DL.reset();
    engine.resume(id);
    // Past its check and fetching again (a run's phase reads '' for a moment before its check starts).
    await DL.until(id, ["downloading", "completed"], { test: (v) => !!ledger(id) && !v.phase && v.received > claimed + 1024 * 1024, timeout: 20000, what: "the resume past its check" });
    const back = ledger(id);
    check("a journal whose last line was torn is read without it: every hashed block comes back as it was", !!back && hashed.every((k) => back.blocks.has(k)) && back.blocks.get(3)?.h !== "0123456789ab", { hashed: hashed.length, back: back?.blocks.size });
    const done = await DL.until(id, ["completed", "failed"], { timeout: 90000, what: "the resume" });
    const reqs = await asked("/blob/medium");
    check("... no window was asked to build a new record, only what was missing fetched, and it completes intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256 && sentAfterProbe(reqs) === medium.size - claimed, { fetched: sentAfterProbe(reqs), missing: medium.size - claimed, ranges: reqs.map((r) => `${r.status} ${r.range}`) });
    engine.remove(id);
  }

  // ==== From the review of Phase 5 ====

  // ---- once: a link that allows one full download, no strong validator: the completion check can't compare ----
  if (want("once")) {
    for (const val of ["lm", "none"]) {
      await DL.reset();
      const t0 = Date.now();
      const id = engine.start(`${DL.base}/vary/medium?val=${val}&full=1&k=once-${val}`, { filename: `once-${val}.bin`, named: true });
      const v = await DL.until(id, ["completed", "failed", "paused"], { test: (x) => x.state !== "paused" || !!x.need || !!x.wait, timeout: 60000, what: "the one-time download" });
      const secs = (Date.now() - t0) / 1000;
      const reqs = await asked("/vary/medium");
      const refused = reqs.filter((r) => r.status === 403);
      check(`a link that allows one full download (${val === "lm" ? "Last-Modified only" : "no validator"}) completes once every byte is in, as before Phase 5: the completion check can't compare (403, asked once) and does not stop it`, v.state === "completed" && (await DL.sha256(v.path)) === medium.sha256 && refused.length <= 1 && secs < 20, { state: v.state, need: v.need, error: v.error, secs, ranges: reqs.map((r) => `${r.status} ${r.range}`) });
      engine.remove(id);
    }
  }

  // ---- small: under 1 MiB, no validators, changed while it downloaded ----
  if (want("small")) {
    await DL.reset();
    const size = 900000;
    const swapped = (await IOUtils.read(fixturePath, { maxBytes: size })).map((x) => x ^ 0xa5);
    const expect = await sha256Of(swapped);
    const id = engine.start(`${DL.base}/vary/medium?val=none&size=${size}&swap=small-new&k=small-link&rate=300`, { filename: "small.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 100000 && !v.phase, timeout: 30000, what: "100 KB" });
    // The file on the site changes while the only request still sends the old bytes.
    await control("/flag?k=small-new");
    const v = await DL.until(id, ["completed", "failed", "paused"], { test: (x) => x.state !== "paused" || !!x.need || !!x.wait, timeout: 90000, what: "the small download" });
    const reqs = await asked("/vary/medium");
    check("a file under 1 MiB with no validators that changed while it downloaded: the completion check sees it, it starts again by itself (its old block hashes forgotten) and completes with the new file", v.state === "completed" && (await DL.sha256(v.path)) === expect, { state: v.state, need: v.need, error: v.error, ranges: reqs.map((r) => `${r.status} ${r.range} ${r.swapped ? "new" : "old"}`) });
    engine.remove(id);
  }

  // ---- uneven: a renewed link of the same file, hashed blocks in one segment only ----
  if (want("uneven")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/vsign/big?k=un1&val=lm&rate=120&rate0=3000`, { filename: "uneven.bin", named: true });
    await DL.until(id, ["downloading"], { test: () => (rec(id)?.file?.segments ?? []).some((s) => s.start === 0 && s.received >= 5 * MiB), timeout: 60000, what: "5 MiB in the first segment" });
    engine.pause(id);
    await DL.until(id, ["paused"], { timeout: 20000 });
    await waitFor(() => !engine.sealing.has(id) && rec(id).file.dirty === false, { timeout: 20000, what: "the pause's seal" });
    const segs = rec(id).file.segments.filter((s) => s.received > 0);
    const hashed = [...ledger(id).blocks.keys()];
    const bs = ledger(id).bs;
    check("the first segment ran ahead: hashed blocks in it only, while every segment holds bytes", segs.length >= 4 && hashed.length >= 3 && hashed.every((b) => b * bs < segs[0].start + segs[0].received), { segs: segs.map((s) => [s.start, s.received]), hashed });
    // Its signed address expires during the pause.
    const key = new URL(rec(id).file.finalUrl).searchParams.get("k");
    await control(`/flag?k=${encodeURIComponent(key)}`);
    await DL.reset();
    engine.resume(id);
    const v = await waitFor(() => {
      const x = engine.get(id);
      return x.need || x.state === "failed" || events(id).includes("New link found") ? x : null;
    }, { timeout: 60000, what: "the renewal" });
    const reqs = await asked("/v");
    check("its original address mints a new link, proven with windows over every stretch (not the first segment alone): New link found, never File changed", events(id).includes("New link found") && !v.need && v.state !== "failed", { state: v.state, need: v.need, events: events(id), reqs: reqs.slice(0, 12).map((r) => `${r.status} ${r.path.split("?")[0]} ${r.range}`) });
    engine.remove(id);
  }

  // ---- edit: Damaged, then edited by the person: never repaired over the edit ----
  if (want("edit")) {
    const v = await fetchDone(`${DL.base}/blob/medium`, "damaged-edited.bin");
    await writeAt(v.path, 9 * MiB + 12345, await inverted(v.path, 9 * MiB + 12345, 1));
    const c = await checkFile(v.id);
    check("the damage is found (Damaged)", c.need?.kind === "repair" && c.check?.bad === 1, c.check);
    // The person then edits it (a tag editor), ten minutes later.
    const st = await IOUtils.stat(v.path);
    await writeAt(v.path, 2 * MiB + 7, new Uint8Array(32).fill(0x41), st.lastModified + 10 * 60 * 1000);
    const edited = await DL.sha256(v.path);
    await showRow(v.id);
    const status = row(v.id).querySelector(".vd-status");
    check("a Damaged file the person then edited reads Changed after download (normal colour), not Damaged", status.textContent === "Changed after download" && !status.classList.contains("err") && !engine.get(v.id).need, { status: status.textContent, need: engine.get(v.id).need });
    await DL.reset();
    row(v.id).focus();
    spike.press("Space");
    await sleep(600);
    check("Space only moves focus to Restore original: nothing is repaired", document.activeElement?.dataset?.act === "restore" && (await DL.sha256(v.path)) === edited && !engine.fixing.has(v.id), document.activeElement?.textContent);
    await hidePanel();
    // Repair asked anyway (a stale verb), twice: it refuses before asking the site or writing anything.
    await engine.repair(v.id);
    await engine.repair(v.id);
    const kept = await IOUtils.read(v.path, { offset: 2 * MiB + 7, maxBytes: 32 });
    const reqs = await asked("/blob/medium");
    check("Repair never writes over the person's edit: refused twice, nothing asked of the site, the file as they left it, Changed after download", kept.every((x) => x === 0x41) && (await DL.sha256(v.path)) === edited && !reqs.length && engine.get(v.id).check?.edited && !engine.get(v.id).need && events(v.id).includes("Repair stopped: the file was changed after download"), { reqs: reqs.length, check: engine.get(v.id).check, events: events(v.id) });
    engine.remove(v.id);
  }

  // ---- cut: a repair cut short, by a quit and by a crash ----
  if (want("cut")) {
    const v = await fetchDone(`${DL.base}/blob/medium?rate=1024`, "cut.bin");
    // Well after it finished: Deer's own writes now are later than the modified time it finished with.
    await waitFor(() => Date.now() > rec(v.id).final.mtime + 6500, { timeout: 10000, interval: 200, what: "6.5 s after the finish" });
    for (const k of [3, 12, 20]) await writeAt(v.path, k * MiB + 777, await inverted(v.path, k * MiB + 777, 1));
    const c = await checkFile(v.id);
    check("3 damaged parts", c.check?.bad === 3, c.check);
    const good = async (k) => (await IOUtils.read(fixturePath, { offset: k * MiB + 777, maxBytes: 1 }))[0];
    const good3 = await good(3);
    const repairing = engine.repair(v.id);
    await waitFor(async () => (await IOUtils.read(v.path, { offset: 3 * MiB + 777, maxBytes: 1 }))[0] === good3, { timeout: 20000, interval: 20, what: "block 3 written" });
    // As a quit stops it (shutdown(): the repair's AbortController).
    engine.fixing.get(v.id)?.ac.abort();
    await repairing;
    const after = engine.get(v.id);
    check("a repair Deer cut short (as a quit stops it) never reads Changed after download, and keeps its mark for the next start's check", !after.check?.edited && after.need?.kind === "repair" && !!rec(v.id).repairing, { check: after.check, need: after.need, repairing: rec(v.id).repairing });
    const q = await checkFile(v.id, true);
    check("the next start's check (no network) finds the 2 blocks still damaged, never the person's change, and closes the repair", q.need?.kind === "repair" && q.check?.bad === 2 && !q.check.edited && !rec(v.id).repairing && !ledger(v.id).pendingRepair.length, { check: q.check, need: q.need, pending: ledger(v.id).pendingRepair });
    // A crash in the middle of a repair: its repair line and the row's mark stay; block 12 was written (Deer's
    // write moves the modified time, more than 5 s after the last stamp).
    await sleep(6000);
    await ledger(v.id).repairing([12, 20]);
    rec(v.id).repairing = Date.now();
    await writeAt(v.path, 12 * MiB + 777, new Uint8Array([await good(12)]), false);
    const q2 = await checkFile(v.id, true);
    check("after a crash in the middle of a repair, the check finds what it left damaged (block 20), not Changed after download", q2.need?.kind === "repair" && q2.check?.bad === 1 && !q2.check.edited, { check: q2.check, need: q2.need, events: events(v.id) });
    await DL.reset();
    await engine.repair(v.id);
    check("Repair then completes it: sha256 equals the fixture, Completed", (await DL.sha256(v.path)) === medium.sha256 && !engine.get(v.id).need && engine.get(v.id).check?.ok, { check: engine.get(v.id).check, events: events(v.id) });
    engine.remove(v.id);
  }

  // ---- keep: Keep partial file, then Check file ----
  if (want("keep")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/swap/medium?val=etag&k=kp1&rate=512`, { filename: "kp.bin", named: true });
    await DL.until(id, ["downloading"], { test: (v) => v.received > 11 * MiB && !v.phase, timeout: 60000, what: "11 MiB" });
    engine.pause(id);
    await DL.until(id, ["paused"], { timeout: 10000 });
    await waitFor(() => rec(id).file.dirty === false && !engine.sealing.has(id), { timeout: 15000, what: "the seal" });
    await control("/flag?k=kp1");
    engine.resume(id);
    const ch = await DL.until(id, ["paused", "completed", "failed"], { test: (v) => v.state !== "paused" || v.need?.kind === "choice", timeout: 30000, what: "File changed" });
    check("File changed", ch.need?.kind === "choice", ch.need);
    await engine.decide(id, "keep-partial");
    const done = await DL.until(id, ["completed"], { timeout: 30000, what: "Keep partial" });
    await recorded(id);
    const size = (await IOUtils.stat(done.path)).size;
    const l = ledger(id);
    check("the kept file's record keeps only the blocks wholly inside it", l.total === size && [...l.blocks.keys()].every((b) => (b + 1) * l.bs <= size), { size, total: l.total, blocks: [...l.blocks.keys()] });
    const c = await checkFile(id);
    check("Check file on the kept partial file: no damage found", c.check?.ok && !c.need && c.check.badBytes === 0, { check: c.check, need: c.need, events: events(id) });
    engine.remove(id);
  }

  // ---- restore: Restore original refused, and Restore original of a file whose every block moved ----
  if (want("restore")) {
    /** The person's edit: 1 MiB inserted at the start (a tag editor growing its tag), saved a minute later. */
    const insert = async (path) => {
      const orig = await IOUtils.read(path);
      const out = new Uint8Array(MiB + orig.length);
      out.fill(0x5a, 0, MiB);
      out.set(orig, MiB);
      await IOUtils.write(path, out);
      await IOUtils.setModificationTime(path, Date.now() + 60000);
    };
    const v = await fetchDone(`${DL.base}/vary/medium?val=etag&k=rs1`, "restore-refused.bin");
    await insert(v.path);
    const before = { size: (await IOUtils.stat(v.path)).size, sha: await DL.sha256(v.path) };
    await sleep(300);
    check("the edited file reads Changed after download", !!engine.get(v.id).check?.edited, engine.get(v.id).check);
    // The link no longer works.
    await control("/flag?k=rs1");
    await engine.restoreOriginal(v.id);
    const after = { size: (await IOUtils.stat(v.path)).size, sha: await DL.sha256(v.path) };
    check("Restore original whose link is refused leaves the person's file exactly as it was (size and sha256), and says why", after.size === before.size && after.sha === before.sha && events(v.id).includes("Restore stopped: the link stopped working") && !(await IOUtils.exists(PathUtils.join(journals, `${v.id}.restore`))), { before, after, events: events(v.id) });
    engine.remove(v.id);

    const w = await fetchDone(`${DL.base}/blob/medium`, "restore-moved.bin");
    await insert(w.path);
    await DL.reset();
    await engine.restoreOriginal(w.id);
    const reqs = await asked("/blob/medium");
    const sha = await DL.sha256(w.path);
    check("Restore original of a file whose every block moved puts the original back from the record: every block fetched once, sha256 equals the fixture, Completed", sha === medium.sha256 && (await IOUtils.stat(w.path)).size === medium.size && reqs.filter((q) => q.status === 206 && q.end - q.start + 1 === MiB).length === 24 && !engine.get(w.id).check?.edited && events(w.id).includes("Original restored"), { sha: sha === medium.sha256, events: events(w.id), blocks: reqs.filter((q) => q.end - q.start + 1 === MiB).length });
    engine.remove(w.id);
  }

  // ---- leak: Remove from list or Cancel while a pause's seal runs ----
  if (want("leak")) {
    for (const how of ["remove", "cancel"]) {
      const id = engine.start(`${DL.base}/blob/medium?rate=2048`, { filename: `leak-${how}.bin`, named: true });
      await DL.until(id, ["downloading"], { test: (v) => v.received > 6 * MiB && !v.phase, timeout: 60000, what: "6 MiB" });
      // The moment the pause's seal is registered, the row goes.
      const set = engine.sealing.set.bind(engine.sealing);
      engine.sealing.set = (k, val) => {
        set(k, val);
        if (k === id && rec(id)?.state === "paused") {
          engine.sealing.set = set;
          Promise.resolve().then(() => (how === "remove" ? engine.remove(id) : engine.cancel(id)));
        }
        return engine.sealing;
      };
      engine.pause(id);
      await waitFor(() => (how === "remove" ? !rec(id) : rec(id)?.state === "cancelled"), { timeout: 10000, what: how });
      engine.sealing.set = set;
      await sleep(3000);
      const left = await journalsOf(id);
      check(`${how === "remove" ? "Remove from list" : "Cancel"} while the pause's seal runs leaves no journal in the profile`, !left.length, left);
      if (rec(id)) engine.remove(id);
    }
  }

  // ---- final: Cancel and Pause once every byte is in, before the rename ----
  if (want("final")) {
    for (const how of ["cancel", "pause"]) {
      await DL.reset();
      const id = engine.start(`${DL.base}/blob/medium?rate=0`, { filename: `final-${how}.bin`, named: true });
      let target = "";
      engine.hooks.beforePlace = async (hid) => {
        if (hid !== id) return;
        target = rec(id).path;
        if (how === "cancel") engine.cancel(id);
        else engine.pause(id);
      };
      await waitFor(() => (rec(id)?.state === (how === "cancel" ? "cancelled" : "paused") && !engine.runs.has(id)) || rec(id)?.state === "completed", { timeout: 60000, what: how });
      engine.hooks.beforePlace = undefined;
      const r = rec(id);
      await sleep(1000);
      if (how === "cancel") {
        check("Cancel that comes once every byte is in, before the rename, is honoured: cancelled, nothing placed, the .part and the record gone", !!target && r.state === "cancelled" && !(await IOUtils.exists(target)) && !(await IOUtils.exists(target + ".part")) && !(await journalsOf(id)).length, { state: r.state, target, journals: await journalsOf(id) });
        engine.remove(id);
      } else {
        check("Pause that comes once every byte is in, before the rename, is honoured: paused with every byte saved, nothing placed", !!target && r.state === "paused" && savedOf(r) === medium.size && !(await IOUtils.exists(target)), { state: r.state, saved: savedOf(r), target });
        engine.resume(id);
        const done = await DL.until(id, ["completed", "failed"], { timeout: 60000, what: "the resume" });
        check("... Resume then completes it intact", done.state === "completed" && (await DL.sha256(done.path)) === medium.sha256, [done.state, done.error]);
        engine.remove(id);
      }
    }
  }

  // ---- older: a finished file with no record and no checksum (a row from before Phase 5) ----
  if (want("older")) {
    /** As a row from before Phase 5: no record, no stored SHA-256. */
    const strip = async (id) => {
      const r = rec(id);
      engine.ledgers.delete(id);
      if (r.journal) await IOUtils.remove(r.journal, { ignoreAbsent: true });
      r.journal = undefined;
      r.sha256 = undefined;
    };
    const v = await fetchDone(`${DL.base}/blob/medium`, "older.bin");
    await strip(v.id);
    await writeAt(v.path, 5 * MiB + 4321, await inverted(v.path, 5 * MiB + 4321, 1));
    await DL.reset();
    const c = await checkFile(v.id);
    check("an older finished file with 1 damaged block of 24 (4%): compared with the site, 1 damaged part (local damage)", c.need?.kind === "repair" && c.check?.bad === 1, { check: c.check, need: c.need });
    await engine.repair(v.id);
    check("... Repair fetches it again: sha256 equals the fixture", (await DL.sha256(v.path)) === medium.sha256 && !engine.get(v.id).need, { check: engine.get(v.id).check, events: events(v.id) });
    engine.remove(v.id);
    // 10 blocks: one block different is 10%, another file (no 1-block floor), and the person is asked.
    const size = 10 * MiB;
    const s = await fetchSized(`${DL.base}/vary/medium?val=etag&size=${size}&k=older10`, "older10.bin", size);
    await strip(s.id);
    await writeAt(s.path, 4 * MiB + 99, await inverted(s.path, 4 * MiB + 99, 1));
    const c2 = await checkFile(s.id);
    check("an older finished file of 10 blocks with 1 block different (10%, at least 5%): another file, nothing marked repairable", c2.check?.site === "changed" && !c2.need, { check: c2.check, need: c2.need, events: events(s.id) });
    engine.remove(s.id);
  }
});
