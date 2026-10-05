// VERIFY (claims 7 and 8): more than 6 connections per host, and one TCP stream per connection on
// HTTP/2 servers, WITHOUT the global pref network.http.max-persistent-connections-per-server and
// without relying on allowSpdy=false: every connection of a download gets its own network
// partition ("lane") through loadInfo.cookieJarSettings (see VitreNet.makeChannel in this folder).
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { BASE, SHA, fetchFile, serverReset, serverStats } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { Identity, open } from "resource://vitre-boot/engine/VitreNet.sys.mjs";

const PER_SERVER = "network.http.max-persistent-connections-per-server";
const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addCookie(oa, value = "vitre-secret") {
  Services.cookies.add("127.0.0.1", "/", "sid", value, false, false, true, Date.now() + 3600e3, oa, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTP, false);
}

async function local() {
  log(`--- local server, ${PER_SERVER} = ${Services.prefs.getIntPref(PER_SERVER)} (never changed in this run)`);
  const url = `${BASE}/blob/big?rate=8192`;
  const rows = [];
  const go = async (label, connections, lanes) => {
    const r = await fetchFile(label, url, `${label}.bin`, { connections, sha: SHA.big, lanes });
    rows.push(r);
    return r;
  };
  const base = await go("16conn-no-lanes", 16, false);
  const l16 = await go("16conn-lanes", 16, true);
  const l32 = await go("32conn-lanes", 32, true);
  check("without lanes Necko holds the download to 6 sockets", base.enginePeakConnections === 6, `engine peak ${base.enginePeakConnections}, ${base.mbps} MB/s, server tcp ${base.serverTcpConnections}, segments ${base.segments}`);
  check("16 lanes: 16 concurrent connections with the per-host pref left at 6", l16.sha256ok && l16.serverPeakConcurrent === 16 && l16.enginePeakConnections === 16, `server peak ${l16.serverPeakConcurrent}, tcp ${l16.serverTcpConnections}, ${l16.mbps} MB/s (no lanes: ${base.mbps})`);
  check("32 lanes: 32 concurrent connections with the per-host pref left at 6", l32.sha256ok && l32.serverPeakConcurrent === 32, `server peak ${l32.serverPeakConcurrent}, tcp ${l32.serverTcpConnections}, ${l32.mbps} MB/s`);
  check("the pref was not touched", Services.prefs.getIntPref(PER_SERVER) === 6 && !Services.prefs.prefHasUserValue(PER_SERVER));
}

async function cookies() {
  log("--- cookies and Referer with lanes");
  const url = `${BASE}/auth/medium?rate=0&ref=1`;
  const page = `${BASE}/page.html`;
  const attempt = async (label, id) => {
    try {
      const r = await fetchFile(label, url, "auth.bin", { connections: 4, sha: SHA.medium, identity: id, lanes: true });
      const body = r.stats.requests.filter((q) => q.status === 206);
      return { ok: r.sha256ok, cookies: body.every((q) => q.cookie.includes("sid=vitre-secret")), referers: body.every((q) => q.referer === page), n: body.length };
    } catch (e) {
      return { ok: false, error: e.status || e.code || String(e) };
    }
  };
  Services.cookies.removeAll();
  let r = await attempt("lanes-no-cookie", new Identity({ pageUrl: page }));
  check("lanes, no cookie: 403", !r.ok && r.error === 403, JSON.stringify(r));
  addCookie({});
  r = await attempt("lanes-default-jar", new Identity({ pageUrl: page }));
  check("lanes, default jar: cookie and Referer on every ranged request", r.ok && r.cookies && r.referers, JSON.stringify(r));
  Services.cookies.removeAll();
  addCookie({ userContextId: 3 });
  r = await attempt("lanes-container-3", new Identity({ pageUrl: page, userContextId: 3 }));
  check("lanes, container 3: its jar", r.ok && r.cookies && r.referers, JSON.stringify(r));
  r = await attempt("lanes-container-wrong", new Identity({ pageUrl: page, userContextId: 0 }));
  check("lanes, wrong container: 403", !r.ok && r.error === 403, JSON.stringify(r));
  r = await attempt("lanes-container-3-as-page", new Identity({ pageUrl: page, userContextId: 3, firstParty: false }));
  check("lanes, container 3, page as loading principal", r.ok && r.cookies && r.referers, JSON.stringify(r));
  Services.cookies.removeAll();
  addCookie({ privateBrowsingId: 1 });
  r = await attempt("lanes-private", new Identity({ pageUrl: page, isPrivate: true }));
  check("lanes, private jar", r.ok && r.cookies, JSON.stringify(r));
  r = await attempt("lanes-private-wrong", new Identity({ pageUrl: page, isPrivate: false }));
  check("lanes, private cookie not sent for a normal window", !r.ok && r.error === 403, JSON.stringify(r));
  Services.cookies.removeAll();
}

const anon = new Identity();
async function ask(url, opts) {
  try {
    const res = await open(url, anon, { Range: "bytes=0-99" }, null, opts);
    const out = { status: res.status, protocol: res.protocol, socket: res.socket, key: res.poolKey };
    res.destroy();
    return out;
  } catch (e) {
    return { error: String(e.code || e) };
  }
}

async function batch(label, url, n, optsFor) {
  const rs = await Promise.all(Array.from({ length: n }, (_u, i) => ask(url, optsFor(i))));
  const sockets = new Set(rs.map((r) => r.socket).filter(Boolean));
  const keys = new Set(rs.map((r) => r.key).filter(Boolean));
  const protos = rs.map((r) => r.protocol || r.error).join(" ");
  log(`  ${label}: ${protos} | distinct sockets ${sockets.size}/${n}, pool entries ${keys.size}`);
  return { rs, sockets: sockets.size, protos: rs.map((r) => r.protocol) };
}

async function real() {
  log("--- real HTTP/2 servers (8 small ranged requests at once)");
  const hosts = (Services.env.get("VITRE_V_HOSTS") || "https://www.mozilla.org/robots.txt,https://example.com/,https://www.cloudflare.com/robots.txt,https://www.wikipedia.org/robots.txt").split(",");
  const tag = Date.now().toString(36);
  for (const url of hosts) {
    log(url);
    const a = await batch("spike recipe (allowSpdy=false, allowHttp3=false), first contact", url, 8, () => ({ h1: true }));
    const b = await batch("default protocols, no lanes                                    ", url, 8, () => ({ h1: false }));
    const c = await batch("lanes, HTTP/2 allowed, HTTP/3 off                              ", url, 8, (i) => ({ h1: false, noH3: true, lane: `${tag}c${i}` }));
    const d = await batch("lanes + allowSpdy=false (the spike's switch)                   ", url, 8, (i) => ({ h1: true, lane: `${tag}d${i}` }));
    const e = await batch("lanes, all protocols allowed (HTTP/3 too)                      ", url, 8, (i) => ({ h1: false, lane: `${tag}e${i}` }));
    log(`    a pool key: ${a.rs[0].key} | a lane's: ${c.rs[0].key}`);
    check(`${url}: allowSpdy=false alone is all HTTP/1.1 on first contact`, a.protos.every((p) => p === "http/1.1"), `${a.protos.join(" ")}; sockets ${a.sockets}/8`);
    check(`${url}: lanes give 8 separate sockets with HTTP/2 allowed`, c.sockets === 8, `protocols ${[...new Set(c.protos)].join(",")}`);
    check(`${url}: lanes + allowSpdy=false give 8 separate sockets`, d.sockets === 8, `protocols ${d.protos.join(" ")}`);
    void b;
    void e;
  }
}

export async function run() {
  const steps = { local, cookies, real };
  const only = (Services.env.get("VITRE_V_ONLY") || "").split(",").filter(Boolean);
  for (const [name, fn] of Object.entries(steps)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await fn();
    } catch (e) {
      log(`FAIL ${name} threw ${e} ${e.stack ?? ""}`);
    }
  }
  await serverReset().catch(() => {});
  void serverStats;
  void sleep;
}
