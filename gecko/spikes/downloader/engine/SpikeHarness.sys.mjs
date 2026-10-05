// Spike-only helpers shared by the test modules: where the test server is, a one-shot download
// through FileTransfer (no manager), server statistics.
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { clearInterval, setInterval, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { RateLimiter } from "resource://vitre-boot/engine/VitreLimiter.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { Identity, open } from "resource://vitre-boot/engine/VitreNet.sys.mjs";
import { FileTransfer } from "resource://vitre-boot/engine/VitreRanged.sys.mjs";

export const PORT = Services.env.get("VITRE_DL_PORT") || "47811";
export const BASE = `http://127.0.0.1:${PORT}`;
export const DATA = Services.env.get("VITRE_DL_DIR");
export const DOWNLOADS = PathUtils.join(DATA, "downloads-" + PORT);
export const SHA = { big: Services.env.get("VITRE_DL_BIG_SHA"), medium: Services.env.get("VITRE_DL_MEDIUM_SHA") };
export const anon = new Identity();

export async function serverText(path) {
  const res = await open(BASE + path, anon, {}, null);
  return res.text();
}

export async function serverStats() {
  return JSON.parse(await serverText("/stats"));
}

export async function serverReset() {
  await serverText("/reset");
}

export const mb = (n) => (n / 1048576).toFixed(1);

/**
 * Download `url` to DOWNLOADS/<name> with FileTransfer and report what happened.
 * opts: connections, limitKBps, identity, sha (expected), signal, state (resume), keep
 */
export async function fetchFile(label, url, name, opts = {}) {
  await IOUtils.makeDirectory(DOWNLOADS, { ignoreExisting: true });
  const path = PathUtils.join(DOWNLOADS, name);
  const part = path + ".part";
  if (!opts.state) await IOUtils.remove(part, { ignoreAbsent: true });
  let bytes = 0;
  let retries = 0;
  const limiters = opts.limitKBps ? [new RateLimiter(() => opts.limitKBps)] : [];
  const transfer = new FileTransfer(opts.state ?? FileTransfer.fresh(url), {
    identity: opts.identity ?? anon,
    limiters,
    connections: () => opts.connections ?? 8,
    onBytes: (n) => {
      bytes += n;
      opts.onBytes?.(n, transfer);
    },
    onRetry: (err, n) => {
      retries++;
      log(`  [${label}] retry ${n} after ${err.code || err.status || err.message}`);
    },
  });
  const signal = opts.signal ?? new AbortController().signal;
  await serverReset();
  // Main-thread responsiveness while the transfer runs: the longest gap between 5 ms timer ticks.
  let lag = 0;
  let lastTick = Date.now();
  const ticker = setInterval(() => {
    const now = Date.now();
    lag = Math.max(lag, now - lastTick - 5);
    lastTick = now;
  }, 5);
  const t0 = Date.now();
  let info, tProbe, ms;
  try {
    info = await transfer.probe(signal);
    tProbe = Date.now() - t0;
    opts.onTransfer?.(transfer);
    await transfer.download(part, signal);
    ms = Date.now() - t0;
  } finally {
    clearInterval(ticker);
  }
  // Let the server's handler threads finish their bookkeeping before reading its statistics.
  await new Promise((r) => setTimeout(r, 300));
  const stats = await serverStats();
  const sha = await IOUtils.computeHexDigest(part, "sha256");
  const size = (await IOUtils.stat(part)).size;
  const ok = opts.sha ? sha === opts.sha : null;
  const result = {
    label,
    status: info.status,
    protocol: info.protocol,
    ranges: transfer.state.ranges,
    size,
    ms,
    probeMs: tProbe,
    mbps: Number((size / 1048576 / (ms / 1000)).toFixed(1)),
    netBytes: bytes,
    segments: transfer.state.segments.length,
    enginePeakConnections: transfer.peakLive,
    serverPeakConcurrent: stats.peak,
    serverTcpConnections: stats.connections,
    serverRequests: stats.requests.length,
    retries,
    mainThreadMaxLagMs: lag,
    sha256ok: ok,
  };
  log(`RESULT ${JSON.stringify(result)}`);
  if (!opts.keep) await IOUtils.remove(part, { ignoreAbsent: true });
  return { ...result, path: part, stats, transfer };
}

/**
 * For runs that quit Firefox the normal way: tell the runner ("@@quit") only once the engine's own
 * shutdown blocker has written the store with nothing left running, so the runner's kill can't be
 * what stopped the download. Registered from the system scope because the window is gone by then.
 */
export function markQuitWhenStored(storePath) {
  const t0 = Date.now();
  for (const topic of ["quit-application-requested", "quit-application-granted", "quit-application", "profile-change-net-teardown", "profile-change-teardown", "profile-before-change", "browser-lastwindow-close-granted", "xul-window-destroyed"]) {
    Services.obs.addObserver((_s, t, data) => log(`  +${Date.now() - t0} ms  ${t}${data ? " (" + data + ")" : ""}`), topic);
  }
  AsyncShutdown.profileBeforeChange.addBlocker("spike: wait for the downloads store, then tell the runner", async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const saved = await IOUtils.readJSON(storePath);
        if (saved.items.every((r) => !["starting", "queued", "downloading"].includes(r.state))) {
          log(`  +${Date.now() - t0} ms  shutdown: store written; states: ${saved.items.map((r) => `${r.state} ${r.received}/${r.file?.total ?? r.total}`).join(", ")}`);
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    log("@@quit");
  });
}

/** A timer that is not tied to any window: it still fires while a window is in a modal prompt. */
export function later(ms, fn) {
  setTimeout(fn, ms);
}

/** Ask the runner for a screenshot from the system scope (no requestAnimationFrame needed). */
export function captureNow(name) {
  log("@@capture " + name);
}
