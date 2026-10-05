// Spike test 1: ranged multi-connection download of a 256 MiB file, in the system scope.
import { BASE, DOWNLOADS, SHA, fetchFile, serverStats } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { Writer, setSize } from "resource://vitre-boot/engine/VitrePartFile.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";

const PER_SERVER = "network.http.max-persistent-connections-per-server";

export async function smoke() {
  log("globals in a system module:", JSON.stringify({
    AbortController: typeof AbortController,
    fetch: typeof fetch,
    crypto: typeof crypto?.subtle,
    TextDecoder: typeof TextDecoder,
    URL: typeof URL,
    IOUtils: typeof IOUtils,
    PathUtils: typeof PathUtils,
    setTimeout: typeof globalThis.setTimeout,
    atob: typeof atob,
    IOUtilsMethods: Object.getOwnPropertyNames(IOUtils).join(","),
  }));
  log("perServerLimit default:", Services.prefs.getIntPref(PER_SERVER), "max-connections:", Services.prefs.getIntPref("network.http.max-connections"));
}

/**
 * What pre-sizing costs. The engine sets the .part file's length up front (on the main thread) and
 * its last connection writes at 7/8 of the file straight away. NTFS zeroes everything below a
 * write that lands beyond the file's "valid data length": this measures both steps for 256 MiB
 * and 2 GiB, with the same primitives the engine uses.
 */
async function presize() {
  await IOUtils.makeDirectory(DOWNLOADS, { ignoreExisting: true });
  for (const mib of [256, 2048]) {
    const path = PathUtils.join(DOWNLOADS, `presize-${mib}.part`);
    const size = mib * 1048576;
    const t0 = Date.now();
    setSize(path, size, { truncate: true });
    const t1 = Date.now();
    const w = new Writer(path, size - 1048576);
    w.writeBytes(new Uint8Array(1048576).fill(7));
    await w.close();
    const t2 = Date.now();
    const w2 = new Writer(path, 0);
    w2.writeBytes(new Uint8Array(1048576).fill(7));
    await w2.close();
    const t3 = Date.now();
    log(`presize ${mib} MiB: set length ${t1 - t0} ms (main thread); first 1 MiB write at the very end ${t2 - t1} ms (writer thread); a write at the start afterwards ${t3 - t2} ms; size on disk ${(await IOUtils.stat(path)).size}`);
    await IOUtils.remove(path);
  }
}

export async function run(onTransfer) {
  await smoke();
  const results = [];
  // Each connection is throttled by the server to 8 MB/s: the situation multi-connection exists for.
  const rate = 8192;
  const url = `${BASE}/blob/big?rate=${rate}`;
  const go = async (label, u, connections, extra = {}) => {
    const r = await fetchFile(label, u, `${label}.bin`, { connections, sha: SHA.big, onTransfer, ...extra });
    results.push(r);
    return r;
  };

  await go("throttled-1conn", url, 1);
  await go("throttled-8conn-default-prefs", url, 8);
  await go("throttled-16conn-default-prefs", url, 16);
  Services.prefs.setIntPref(PER_SERVER, 32);
  log("set", PER_SERVER, "= 32");
  await go("throttled-16conn-limit32", url, 16);
  await go("throttled-32conn-limit32", url, 32);
  // Unthrottled: what the engine and the disk can do on loopback.
  await go("unthrottled-1conn", `${BASE}/blob/big`, 1);
  await go("unthrottled-8conn", `${BASE}/blob/big`, 8);
  // Redirect: the Range header must survive the hop.
  const redir = await go("redirect-8conn", `${BASE}/redir/big?rate=${rate * 2}`, 8);
  const ranged = redir.stats.requests.filter((q) => q.path.startsWith("/blob/big") && q.status === 206).length;
  log(`redirect: ${ranged} ranged requests reached /blob/big after the 302, final url ${redir.transfer.state.finalUrl}`);
  await presize();
  Services.prefs.clearUserPref(PER_SERVER);

  log("SUMMARY");
  for (const r of results) {
    log(`  ${r.label.padEnd(34)} ${String(r.ms).padStart(6)} ms  ${String(r.mbps).padStart(7)} MB/s  server-peak ${String(r.serverPeakConcurrent).padStart(2)}  tcp ${String(r.serverTcpConnections).padStart(2)}  segs ${String(r.segments).padStart(2)}  ui-lag ${String(r.mainThreadMaxLagMs).padStart(3)} ms  sha ${r.sha256ok ? "OK" : "MISMATCH"}`);
  }
  return results;
}

export { serverStats };
