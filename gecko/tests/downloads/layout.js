// The hybrid file layout (spikes/downloader/IDM-WAY-DESIGN.md section 4, parts.ts; the owner's decision of 2026-10-21):
//   1. on this NTFS profile disk a ranged download stays in place (one sparse .part), detected by the volume query;
//   2. forced to the parts layout (vitre.test.partLayout=parts, as on an exFAT or FAT32 drive): "<name>.part" plus
//      "<name>.parts\<start in hex>.part", one file per part, each only ever written at its end; after the last byte
//      the parts are added to the .part in order (Saving) and deleted; completed intact, no folder left, not sparse;
//   3. paused and resumed under parts: every part keeps what its segments claim, the resume fetches only what is
//      missing, and it completes intact;
//   4. Keep partial file under parts: the parts of the unbroken beginning are joined first; the kept file is that
//      beginning, and no part is left;
//   5. Cancel under parts leaves no .part and no folder;
//   6. a drive that says exFAT (vitre.test.volumeInfo) picks the parts layout by itself;
//   7. a drive that says FAT32: a file over 4 GiB - 1 is refused before anything is written, with a sentence that
//      says why; one of exactly 4 GiB - 1 is not.
/* global spike, Services, ChromeUtils, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const engine = DL.engine;
  const MiB = 1 << 20;
  const page = DL.base + "/page.html";
  await DL.open(page);
  const rec = (id) => engine.recs.find((r) => r.id === id);
  const partsOf = async (path) => {
    const dir = path + ".parts";
    if (!(await IOUtils.exists(dir))) return null;
    const out = {};
    for (const p of await IOUtils.getChildren(dir)) out[PathUtils.filename(p)] = (await IOUtils.stat(p)).size;
    return out;
  };
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const k32 = ctypes.open("kernel32.dll");
  const GetFileAttributesW = k32.declare("GetFileAttributesW", ctypes.winapi_abi, ctypes.uint32_t, ctypes.char16_t.ptr);
  const prefs = Services.prefs;
  const forced = (v) => (v ? prefs.setStringPref("vitre.test.partLayout", v) : prefs.clearUserPref("vitre.test.partLayout"));
  const fakeVolume = (v) => (v ? prefs.setStringPref("vitre.test.volumeInfo", JSON.stringify(v)) : prefs.clearUserPref("vitre.test.volumeInfo"));

  try {
    // ---- 1. NTFS: in place ----
    await DL.reset();
    const id1 = engine.start(`${DL.base}/blob/big?rate=1024`, { pageUrl: page });
    await DL.until(id1, ["downloading"], { test: (v) => v.received > 4 * MiB, timeout: 30000, what: "the first bytes" });
    const l1 = engine.transferInfo(id1)?.diag?.layout;
    log("layout on the profile disk", l1);
    check("on this NTFS disk a ranged download stays in place (the volume query says NTFS, with sparse files)", l1?.kind === "inplace" && /NTFS/i.test(l1.fs) && l1.sparse === true && !(await IOUtils.exists(engine.get(id1).path + ".parts")), l1);
    engine.cancel(id1);
    await DL.until(id1, ["cancelled"], { timeout: 10000 });
    engine.remove(id1);

    // ---- 2. the parts layout: part files, then the join ----
    forced("parts");
    await DL.reset();
    const id2 = engine.start(`${DL.base}/blob/big?rate=2048`, { pageUrl: page });
    const v2 = await DL.until(id2, ["downloading"], { test: (v) => v.received > 32 * MiB, timeout: 60000, what: "32 MiB under parts" });
    const during = await partsOf(v2.path);
    const segs = rec(id2).file.segments.map((s) => ({ start: s.start, base: s.base ?? 0, received: s.received }));
    log("parts while downloading", during, segs);
    const named = segs.filter((s) => s.base > 0).every((s) => during && during[`${s.base.toString(16)}.part`] !== undefined);
    check("under parts: '<name>.part' plus '<name>.parts\\<start in hex>.part', one per part but the first", rec(id2).file.layout === "parts" && !!during && Object.keys(during).length === segs.filter((s) => s.base > 0).length && named && (await IOUtils.exists(v2.path + ".part")), { during, segs });
    check("... no part file is longer than what its segments claim plus what is still being written (each only written at its end)", segs.filter((s) => s.base > 0).every((s) => during[`${s.base.toString(16)}.part`] >= s.received - 4 * MiB), { during, segs });
    let saw = false;
    const d2 = await waitFor(
      () => {
        const v = engine.get(id2);
        if (v.phase === "merging") saw = true;
        return ["completed", "failed"].includes(v.state) ? v : null;
      },
      { timeout: 120000, interval: 50, what: "the parts download to finish" }
    );
    const info2 = d2;
    const left2 = await partsOf(info2.path);
    const attrs = GetFileAttributesW(info2.path);
    log("parts download", { state: info2.state, saw, left: left2 });
    check("... after the last byte the parts are joined (Saving) and the download completes intact", info2.state === "completed" && (await DL.sha256(info2.path)) === m["big.bin"].sha256, [info2.state, info2.error]);
    check("... no folder of parts is left, and the finished file is not sparse", left2 === null && attrs !== 0xffffffff && (attrs & 0x200) === 0, { left2, attrs: "0x" + attrs.toString(16) });

    // ---- 3. pause and resume under parts ----
    await DL.reset();
    const id3 = engine.start(`${DL.base}/blob/big?rate=1024`, { pageUrl: page });
    await DL.until(id3, ["downloading"], { test: (v) => v.received > 24 * MiB, timeout: 60000, what: "24 MiB" });
    engine.pause(id3);
    const p3 = await DL.until(id3, ["paused"], { timeout: 15000 });
    await waitFor(() => !engine.sealing.has(id3), { timeout: 15000, what: "the pause's seal" });
    const parts3 = await partsOf(p3.path);
    const segs3 = rec(id3).file.segments.map((s) => ({ start: s.start, end: s.end, base: s.base ?? 0, received: s.received }));
    const sizeOk = segs3.every((s) => {
      const size = s.base > 0 ? parts3?.[`${s.base.toString(16)}.part`] ?? -1 : -2;
      return s.base === 0 || size >= s.start - s.base + s.received;
    });
    check("paused under parts: every part holds at least what its segments claim", sizeOk, { parts3, segs3 });
    const marks = segs3.map((s) => [s.start, s.end, s.start + s.received]);
    await DL.reset();
    engine.resume(id3);
    const d3 = await DL.until(id3, ["completed", "failed"], { timeout: 120000 });
    const asks = (await DL.stats()).requests.filter((r) => r.path.startsWith("/blob/big") && r.status === 206 && (r.sent || 0) > 0);
    const again = asks.filter((r) => r.end - r.start + 1 !== 65536 && !marks.some(([a, z, at]) => r.start >= at && r.start < z));
    check("... the resume fetches only what is missing (and its proof windows), and completes intact", d3.state === "completed" && (await DL.sha256(d3.path)) === m["big.bin"].sha256 && again.length === 0 && (await partsOf(d3.path)) === null, { state: d3.state, again: again.map((r) => r.range) });

    // ---- 4. Keep partial file under parts ----
    // The first connection gets its part while the site turns the others away for a while (503: they stand by), so
    // the unbroken beginning runs past the first part into the next one; the row is then made File changed by hand
    // (the test reaches into the engine), and Keep partial file joins what it keeps.
    await DL.reset();
    const id4 = engine.start(`${DL.base}/blob/medium?rate=512&fail=${3 * MiB}-${24 * MiB}&failn=7&failcode=503`, { filename: "kept.bin", named: true });
    const unbroken = () => {
      let n = 0;
      for (const sg of [...rec(id4).file.segments].sort((a, b) => a.start - b.start)) {
        if (sg.start !== n) break;
        n += sg.received;
        if (sg.received < sg.end - sg.start) break;
      }
      return n;
    };
    await waitFor(() => (rec(id4)?.file?.segments?.length ? unbroken() > 3 * MiB + 256 * 1024 : false), { timeout: 60000, interval: 100, what: "an unbroken beginning past the first part" });
    engine.pause(id4);
    await DL.until(id4, ["paused"], { timeout: 15000 });
    await waitFor(() => !engine.sealing.has(id4), { timeout: 15000, what: "the pause's seal" });
    const path4 = rec(id4).path;
    const before4 = await partsOf(path4);
    const want4 = unbroken();
    rec(id4).need = { kind: "choice", since: Date.now(), evidence: "made by the test" };
    engine.touch(rec(id4));
    await engine.keepPartial(id4);
    const k4 = await DL.until(id4, ["completed", "failed", "paused"], { test: (v) => v.state !== "paused", timeout: 30000, what: "the kept file" });
    const bytes4 = k4.path ? await IOUtils.read(k4.path) : new Uint8Array(0);
    const fix = await IOUtils.read(PathUtils.join(DL.fix, "medium.bin"), { maxBytes: bytes4.length });
    const same = bytes4.length > 0 && bytes4.length === fix.length && bytes4.every((b, i) => b === fix[i]);
    await sleep(1000);
    log("kept partial under parts", { want4, len: bytes4.length, before: before4, path: k4.path });
    check("Keep partial file under parts: the kept file is the unbroken beginning, joined from its parts (past the first), and no part is left", k4.state === "completed" && same && bytes4.length === want4 && want4 > 3 * MiB && (await partsOf(path4)) === null, { state: k4.state, len: bytes4.length, want4, same });

    // ---- 5. Cancel under parts ----
    await DL.reset();
    const id5 = engine.start(`${DL.base}/blob/big?rate=1024`, { pageUrl: page });
    const v5 = await DL.until(id5, ["downloading"], { test: (v) => v.received > 8 * MiB, timeout: 60000, what: "8 MiB" });
    engine.cancel(id5);
    await DL.until(id5, ["cancelled"], { timeout: 10000 });
    await sleep(1500);
    check("Cancel under parts leaves no .part and no folder of parts", !(await IOUtils.exists(v5.path + ".part")) && !(await IOUtils.exists(v5.path + ".parts")));
    engine.remove(id5);
    forced("");

    // ---- 6. exFAT: parts by itself ----
    fakeVolume({ fs: "exFAT", flags: 0, serial: 7, root: "E:\\" });
    await DL.reset();
    const id6 = engine.start(`${DL.base}/blob/big?rate=1024`, { pageUrl: page });
    await DL.until(id6, ["downloading"], { test: (v) => v.received > 4 * MiB, timeout: 30000, what: "the first bytes" });
    const l6 = engine.transferInfo(id6)?.diag?.layout;
    check("a drive that says exFAT (no sparse files) picks the parts layout by itself", l6?.kind === "parts" && rec(id6).file.layout === "parts", l6);
    engine.cancel(id6);
    await DL.until(id6, ["cancelled"], { timeout: 10000 });
    engine.remove(id6);

    // ---- 7. FAT32: over 4 GiB - 1 refused before anything is written ----
    fakeVolume({ fs: "FAT32", flags: 0, serial: 8, root: "F:\\" });
    await DL.reset();
    const id7 = engine.start(`${DL.base}/huge?size=4294967296`, { filename: "huge.bin", named: true });
    const v7 = await DL.until(id7, ["failed", "paused", "downloading"], { test: (v) => v.state !== "downloading", timeout: 30000, what: "the FAT32 refusal" });
    const st7 = (await DL.stats()).requests.filter((r) => r.path.startsWith("/huge"));
    log("FAT32", { state: v7.state, error: v7.error, asked: st7.map((r) => r.start) });
    check("FAT32: a 4 GiB file is refused before anything is written, saying why", v7.state === "failed" && /can.t hold a file of 4 GB or more/.test(v7.error) && /FAT32/.test(v7.error) && !(await IOUtils.exists(engine.get(id7).path + ".part")) && st7.every((r) => r.start === 0), [v7.state, v7.error]);
    engine.remove(id7);
    await DL.reset();
    const id8 = engine.start(`${DL.base}/huge?size=4294967295`, { filename: "huge-fits.bin", named: true });
    const v8 = await DL.until(id8, ["downloading", "failed"], { test: (v) => v.state === "failed" || v.received > 0, timeout: 30000, what: "the one that fits" });
    check("... one of exactly 4 GiB - 1 is not refused", v8.state === "downloading", [v8.state, v8.error]);
    engine.cancel(id8);
    await DL.until(id8, ["cancelled"], { timeout: 10000 }).catch(() => null);
    engine.remove(id8);
  } finally {
    forced("");
    fakeVolume(null);
    k32.close();
  }
});
