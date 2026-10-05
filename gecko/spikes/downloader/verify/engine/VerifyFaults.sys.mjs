// VERIFY: failure paths the spike listed as never run (claim 33) or only half run.
//   changed  : the file changes on the server between pause and resume (If-Range answered 200)
//   diskError: every WriteFile into the .part file starts failing mid-download (a byte-range lock
//              held by another process), then works again; resume from the state the engine kept
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { BASE, DATA, DOWNLOADS, SHA, fetchFile, mb } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { runTool } from "resource://vitre-boot/engine/VitreFfmpeg.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { AbortedError, describeError } from "resource://vitre-boot/engine/VitreNet.sys.mjs";

const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIUM = 25165824;
const BIG = 268435456;

async function changed() {
  log("--- changed: the file's ETag changes between pause and resume");
  const ac = new AbortController();
  let transfer = null;
  let got = 0;
  try {
    await fetchFile("changed-pause", `${BASE}/blob/medium?rate=2048`, "changed.bin", {
      connections: 4, signal: ac.signal, keep: true, onTransfer: (t) => (transfer = t),
      onBytes: (n) => {
        got += n;
        if (got > 0.4 * MEDIUM && !ac.signal.aborted) ac.abort();
      },
    });
  } catch (e) {
    if (!(e instanceof AbortedError)) throw e;
  }
  const state = JSON.parse(JSON.stringify(transfer.snapshot()));
  const before = state.segments.reduce((n, s) => n + s.received, 0);
  const oldTag = state.etag;
  // The test server's ETag is "<size>-<mtime>": touching the fixture is a new version of the file.
  // (The server's handler threads may still hold the file for a moment after the abort.)
  for (let i = 0; ; i++) {
    try {
      await IOUtils.setModificationTime(PathUtils.join(DATA, "fixtures", "medium.bin"), Date.now() - 86400e3 * 3 - i * 1000);
      break;
    } catch (e) {
      if (i > 40) throw e;
      await sleep(250);
    }
  }
  const r = await fetchFile("changed-resume", state.url, "changed.bin", { connections: 4, sha: SHA.medium, state });
  const full200 = r.stats.requests.filter((q) => q.status === 200).length;
  check("a file that changed on the server is started again from zero, not stitched together", r.sha256ok && r.netBytes === MEDIUM && r.transfer.state.etag !== oldTag,
    `had ${mb(before)} MB with ETag ${oldTag}; resume fetched ${mb(r.netBytes)} MB with ETag ${r.transfer.state.etag}; ${full200} request(s) answered 200 to If-Range`);
}

async function diskError() {
  log("--- diskError: WriteFile into the .part file fails for a while (byte-range lock held by another process)");
  const part = PathUtils.join(DOWNLOADS, "locked.bin.part");
  const helper = PathUtils.join(Services.env.get("VITRE_VERIFY_HERE"), "lock_region.py");
  let transfer = null;
  let got = 0;
  let locker = null;
  let retries = 0;
  const t0 = Date.now();
  let failure = null;
  try {
    await fetchFile("disk-error", `${BASE}/blob/big?rate=4096`, "locked.bin", {
      connections: 4, keep: true, onTransfer: (t) => (transfer = t),
      onBytes: (n) => {
        got += n;
        if (!locker && got > 0.15 * BIG) {
          log(`  +${Date.now() - t0} ms  locking the .part file (${mb(got)} MB received so far)`);
          locker = runTool("python.exe", [helper, part, "14"]);
        }
      },
    });
  } catch (e) {
    failure = e;
  }
  const failedAt = Date.now() - t0;
  const state = transfer ? JSON.parse(JSON.stringify(transfer.snapshot())) : null;
  const kept = state ? state.segments.reduce((n, s) => n + s.received, 0) : 0;
  log(`  +${failedAt} ms  download() ${failure ? "rejected: " + (failure.code || failure.name) + " / " + failure.message + ' -> row text "' + describeError(failure) + '"' : "RESOLVED"}; live connections ${transfer?.live}; state keeps ${mb(kept)} MB in ${state?.segments.length} segments; handed to writers in total ${mb(got)} MB`);
  check("a disk write error stops the download with an error (no hang, no false completion)", !!failure && !(failure instanceof AbortedError), `${failure?.code || failure?.name}`);
  check("the error is described as a disk problem", /disk|write|folder/i.test(failure ? describeError(failure) : ""), failure ? describeError(failure) : "");
  check("no connection is left counted as live", transfer?.live === 0, `live = ${transfer?.live}`);
  const out = await locker;
  log("  helper:", (out.stdout + out.stderr).trim().split(/\r?\n/).join(" | "));
  await sleep(300);
  // Resume from the state the engine kept: if it counted bytes that never reached the file, the checksum fails.
  const r = await fetchFile("disk-error-resume", state.url, "locked.bin", { connections: 4, sha: SHA.big, state });
  check("after the error, resuming from the kept segment map gives an intact file", r.sha256ok && r.netBytes === BIG - kept, `resume fetched ${mb(r.netBytes)} MB = ${mb(BIG)} - ${mb(kept)}; sha ${r.sha256ok ? "OK" : "MISMATCH"}`);
  void retries;
}

export async function run() {
  const only = (Services.env.get("VITRE_V_ONLY") || "").split(",").filter(Boolean);
  for (const [name, fn] of Object.entries({ changed, diskError })) {
    if (only.length && !only.includes(name)) continue;
    log(`=== ${name}`);
    try {
      await fn();
    } catch (e) {
      log(`FAIL ${name} threw ${e} ${e.stack ?? ""}`);
    }
  }
}
