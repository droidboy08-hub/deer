// VERIFY: the engine against a REAL server (TLS, HTTP/2 CDN, no ETag: If-Range by Last-Modified).
// The spike only ever moved file data from a local plain-HTTP/1.1 Python server.
// File: a 24.6 MB source tarball on cdn.kernel.org (Fastly) whose sha256 kernel.org publishes.
import { fetchFile } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";

const PER_SERVER = "network.http.max-persistent-connections-per-server";
const URL_ = Services.env.get("VITRE_V_REAL_URL") || "https://cdn.kernel.org/pub/linux/kernel/v2.4/linux-2.4.37.tar.xz";
const SHA = Services.env.get("VITRE_V_REAL_SHA") || "b354f62063c929e9f35563a5d673ec86329e966601221f993b801688b677df76";
const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

export async function run() {
  log("real download:", URL_);
  const rows = [];
  const go = async (label, opts) => {
    try {
      const r = await fetchFile(label, URL_, `${label}.bin`, { sha: SHA, ...opts });
      rows.push(r);
      log(`  ${label.padEnd(30)} ${String(r.ms).padStart(6)} ms ${String(r.mbps).padStart(6)} MB/s  engine peak ${r.enginePeakConnections}  sockets ${r.sockets}  protocols ${r.protocols || r.protocol}  segments ${r.segments}  retries ${r.retries}  ui-lag ${r.mainThreadMaxLagMs} ms  sha ${r.sha256ok ? "OK (kernel.org's published sha256)" : "MISMATCH"}`);
      return r;
    } catch (e) {
      log(`  ${label}: FAILED ${e.code || e.status || e} ${e.message ?? ""}`);
      return null;
    }
  };
  const one = await go("1conn", { connections: 1 });
  // The spike's recipe: allowSpdy=false and the global per-host pref raised while downloading.
  Services.prefs.setIntPref(PER_SERVER, 22);
  const spike = await go("8conn-spike-recipe", { connections: 8 });
  Services.prefs.clearUserPref(PER_SERVER);
  // The verifier's alternative: one network partition per connection, HTTP/2 allowed, pref untouched.
  const lanes = await go("8conn-lanes-h2", { connections: 8, lanes: true, h1: false, noH3: true });
  const lanes16 = await go("16conn-lanes-h2", { connections: 16, lanes: true, h1: false, noH3: true });
  check("single connection over TLS: checksum matches the published one", !!one?.sha256ok, one ? `${one.size} bytes, ${one.protocol}` : "");
  check("spike recipe on a real HTTP/2 CDN: 8 connections, checksum matches", !!spike?.sha256ok && spike.enginePeakConnections === 8, spike ? `sockets ${spike.sockets}, protocols ${spike.protocols}` : "");
  check("lanes on a real HTTP/2 CDN: 8 sockets, checksum matches, pref untouched", !!lanes?.sha256ok && lanes.sockets >= 8 && !Services.prefs.prefHasUserValue(PER_SERVER), lanes ? `sockets ${lanes.sockets}, protocols ${lanes.protocols}` : "");
  check("lanes: 16 sockets", !!lanes16?.sha256ok && lanes16.sockets >= 16, lanes16 ? `sockets ${lanes16.sockets}, protocols ${lanes16.protocols}` : "");
}
