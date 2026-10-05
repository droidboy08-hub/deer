// Spike test 2: pause/resume, retry, speed limit, servers without Range, servers that refuse
// extra connections, redirects, and whose cookies/referrer a request carries. System scope.
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { BASE, DOWNLOADS, SHA, anon, fetchFile, mb, serverReset, serverStats } from "resource://vitre-boot/engine/SpikeHarness.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { AbortedError, Identity, open } from "resource://vitre-boot/engine/VitreNet.sys.mjs";
import { FileTransfer } from "resource://vitre-boot/engine/VitreRanged.sys.mjs";

const PER_SERVER = "network.http.max-persistent-connections-per-server";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = "") => log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

async function redirect() {
  const r = await fetchFile("redirect-8conn", `${BASE}/redir/big?rate=16384`, "redirect.bin", { connections: 8, sha: SHA.big });
  const ranged = r.stats.requests.filter((q) => q.path.startsWith("/blob/big") && q.status === 206 && q.ae === "identity").length;
  check("redirect keeps Range and Accept-Encoding on the new channel", r.ranges && ranged >= 8 && r.sha256ok, `${ranged} ranged requests after the 302, final url ${r.transfer.state.finalUrl}`);
}

async function pauseResume() {
  // Pause at ~40%, wait, resume from the saved segment map with a NEW FileTransfer (as after a restart).
  const ac = new AbortController();
  let transfer = null;
  let got = 0;
  let paused = null;
  try {
    await fetchFile("pause", `${BASE}/blob/big?rate=4096`, "pause.bin", {
      connections: 8, signal: ac.signal, keep: true,
      onTransfer: (t) => (transfer = t),
      onBytes: (n) => {
        got += n;
        if (got > 0.4 * 268435456 && !ac.signal.aborted) ac.abort();
      },
    });
  } catch (e) {
    paused = e;
  }
  const state = JSON.parse(JSON.stringify(transfer.snapshot()));
  const before = state.segments.reduce((n, s) => n + s.received, 0);
  await sleep(600);
  const idle = await serverStats();
  check("pause aborts every connection", paused instanceof AbortedError && idle.active === 0, `paused at ${mb(before)} MB in ${state.segments.length} segments; server active transfers: ${idle.active}`);
  log("  persisted segment map:", JSON.stringify(state.segments.map((s) => [s.start, s.end, s.received])));

  const r = await fetchFile("resume", state.url, "pause.bin", { connections: 8, sha: SHA.big, state });
  const served = r.stats.requests.filter((q) => q.status === 206 && q.end > q.start).reduce((n, q) => n + (q.sent || 0), 0);
  const ifRange = r.stats.requests.filter((q) => q.ifrange).length;
  check("resume downloads only what was missing", r.sha256ok && r.netBytes === 268435456 - before,
    `engine fetched ${mb(r.netBytes)} MB of ${mb(268435456)}; server sent ${mb(served)} MB; ${ifRange}/${r.stats.requests.length} requests carried If-Range (the ETag)`);
}

async function retry() {
  // The server cuts the first 3 body responses after 3 MB (connection reset mid-body).
  const r = await fetchFile("retry-flaky", `${BASE}/blob/flaky?rate=8192&drop=3000000`, "flaky.bin", { connections: 4, sha: SHA.medium });
  const cut = r.stats.requests.filter((q) => q.cut).length;
  check("retry after a dropped connection resumes mid-segment", r.sha256ok && r.retries >= 1 && r.netBytes === r.size, `${cut} responses cut by the server, ${r.retries} retries, bytes fetched ${r.netBytes} = file size (nothing fetched twice)`);
}

async function speedLimit() {
  // An unthrottled server, limited by the engine's token bucket to 4 MB/s over 4 connections.
  const r = await fetchFile("limit-4096KBps", `${BASE}/blob/medium`, "limit.bin", { connections: 4, sha: SHA.medium, limitKBps: 4096 });
  const expected = 25165824 / (4096 * 1024);
  const secs = r.ms / 1000;
  check("speed limit (token bucket, suspends the channel)", r.sha256ok && Math.abs(secs - expected) / expected < 0.2, `24 MB at a 4096 kB/s limit took ${secs.toFixed(2)} s (ideal ${(expected - 0.5).toFixed(2)}-${expected.toFixed(2)} s, half a second of burst) = ${(r.size / 1024 / secs).toFixed(0)} kB/s`);
}

async function noRange() {
  const r = await fetchFile("no-range", `${BASE}/blob/norange?rate=16384`, "norange.bin", { connections: 8, sha: SHA.medium });
  check("server without Range support: one stream, the probe's own response is reused", r.sha256ok && !r.ranges && r.status === 200 && r.serverRequests === 1 && r.segments === 1,
    `probe status ${r.status}, ranges=${r.ranges}, ${r.serverRequests} request reached the server, ${r.segments} segment`);
}

async function refused() {
  // The server answers 503 to a third concurrent connection. Retry-After: 1.
  const r = await fetchFile("server-allows-2", `${BASE}/blob/limit2?rate=8192`, "limit2.bin", { connections: 6, sha: SHA.medium });
  const busy = r.stats.requests.filter((q) => q.status === 503).length;
  check("connections the server refuses (503) step aside; the rest finish the file", r.sha256ok && busy >= 1 && r.serverPeakConcurrent <= 2, `${busy} refusals, server peak ${r.serverPeakConcurrent}, engine peak ${r.enginePeakConnections}`);
}

async function h2() {
  // A real HTTP/2 server on the internet (small ranged page fetches): allowSpdy=false must force
  // HTTP/1.1, which is what gives every connection of a download its own TCP stream.
  const { makeChannel } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreNet.sys.mjs");
  const { channel } = makeChannel("https://www.mozilla.org/robots.txt", anon, {}, { h1: true });
  const internal = channel.QueryInterface(Ci.nsIHttpChannelInternal);
  log(`  after makeChannel(h1): allowSpdy=${internal.allowSpdy} allowHttp3=${internal.allowHttp3}`);
  for (const [label, h1, url] of [["h1 forced, first contact", true, "https://www.mozilla.org/robots.txt"], ["default", false, "https://www.mozilla.org/robots.txt"], ["h1 forced, after an h2 connection exists", true, "https://www.mozilla.org/robots.txt"]]) {
    try {
      const res = await open(url, anon, { Range: "bytes=0-99" }, null, { h1 });
      log(`  ${url} (${label}): status ${res.status}, protocol ${res.protocol}`);
      res.destroy();
    } catch (e) {
      log(`  h2 check (${label}) failed: ${e.code || e}`);
    }
  }
}

async function crossOriginReferrer() {
  // The page is on http://localhost:PORT, the file on http://127.0.0.1:PORT: another origin.
  await serverReset();
  const page = `http://localhost:${BASE.split(":").pop()}/page.html?secret=1#frag`;
  const res = await open(`${BASE}/blob/medium`, new Identity({ pageUrl: page, withOrigin: true }), { Range: "bytes=0-0" }, null);
  res.destroy();
  const q = (await serverStats()).requests[0];
  check("cross-origin Referer is the page's origin only; Origin is sent for media requests", q.referer === page.split("/page")[0] + "/" && q.origin === page.split("/page")[0], `Referer: ${q.referer}  Origin: ${q.origin}`);
}

async function speedLimitLong() {
  const r = await fetchFile("limit-16384KBps-256MB", `${BASE}/blob/big`, "limit-big.bin", { connections: 8, sha: SHA.big, limitKBps: 16384 });
  const secs = r.ms / 1000;
  check("speed limit over a long transfer", r.sha256ok && Math.abs(r.size / 1024 / secs - 16384) / 16384 < 0.06, `256 MB at a 16384 kB/s limit took ${secs.toFixed(2)} s = ${(r.size / 1024 / secs).toFixed(0)} kB/s (${((r.size / 1024 / secs / 16384 - 1) * 100).toFixed(1)}% off)`);
}

function addCookie(oa, value = "vitre-secret") {
  const cv = Services.cookies.add("127.0.0.1", "/", "sid", value, false, false, true, Date.now() + 3600e3, oa, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTP, false);
  return cv?.result === Ci.nsICookieValidation.eOK || cv === undefined;
}

async function identity() {
  const url = `${BASE}/auth/medium?rate=0&ref=1`;
  const page = `${BASE}/page.html`;
  const attempt = async (label, id) => {
    try {
      const r = await fetchFile(label, url, "auth.bin", { connections: 4, sha: SHA.medium, identity: id });
      const body = r.stats.requests.filter((q) => q.status === 206);
      return { ok: r.sha256ok, cookies: body.every((q) => q.cookie.includes("sid=vitre-secret")), referers: body.every((q) => q.referer === page), n: body.length };
    } catch (e) {
      return { ok: false, error: e.status || e.code || String(e) };
    }
  };

  Services.cookies.removeAll();
  let r = await attempt("auth-no-cookie", new Identity({ pageUrl: page }));
  check("no cookie in the jar: the server refuses (403)", !r.ok && r.error === 403, JSON.stringify(r));

  addCookie({});
  r = await attempt("auth-default-jar", new Identity({ pageUrl: page }));
  check("default jar: every ranged request carries the cookie and the page as Referer", r.ok && r.cookies && r.referers, JSON.stringify(r));

  r = await attempt("auth-no-referrer", new Identity({}));
  check("without a page there is no Referer (the server wants one)", !r.ok && r.error === 403, JSON.stringify(r));

  Services.cookies.removeAll();
  addCookie({ userContextId: 3 });
  r = await attempt("auth-container-3", new Identity({ pageUrl: page, userContextId: 3 }));
  check("container tab (userContextId 3): its own cookie jar is used", r.ok && r.cookies, JSON.stringify(r));
  r = await attempt("auth-container-wrong", new Identity({ pageUrl: page, userContextId: 0 }));
  check("a container's cookie is not sent for another container", !r.ok && r.error === 403, JSON.stringify(r));
  r = await attempt("auth-container-3-as-page", new Identity({ pageUrl: page, userContextId: 3, firstParty: false }));
  check("container, page as loading principal (media fetched for a page)", r.ok && r.cookies && r.referers, JSON.stringify(r));

  Services.cookies.removeAll();
  addCookie({ privateBrowsingId: 1 });
  r = await attempt("auth-private", new Identity({ pageUrl: page, isPrivate: true }));
  check("private window: the private cookie jar is used", r.ok && r.cookies, JSON.stringify(r));
  r = await attempt("auth-private-wrong", new Identity({ pageUrl: page, isPrivate: false }));
  check("a private cookie is not sent for a normal window", !r.ok && r.error === 403, JSON.stringify(r));
  Services.cookies.removeAll();
}

/** fetch() from the system scope, for comparison with channels. */
async function systemFetch() {
  Services.cookies.removeAll();
  addCookie({});
  addCookie({ userContextId: 3 }, "container-only");
  await serverReset();
  const out = {};
  try {
    const ac = new AbortController();
    const res = await fetch(`${BASE}/blob/big?rate=8192`, {
      headers: { Range: "bytes=1000-20001000", Referer: `${BASE}/page.html`, Cookie: "forced=1", "Accept-Encoding": "identity" },
      credentials: "include", cache: "no-store", signal: ac.signal,
    });
    out.status = res.status;
    out.contentRange = res.headers.get("content-range");
    const reader = res.body.getReader();
    let got = 0;
    let chunks = 0;
    const t0 = Date.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      chunks++;
      if (got > 4 * 1048576) {
        ac.abort();
        break;
      }
    }
    out.streamed = `${got} bytes in ${chunks} chunks over ${Date.now() - t0} ms, then aborted`;
  } catch (e) {
    out.error = String(e);
  }
  await sleep(500);
  const stats = await serverStats();
  const q = stats.requests[0] ?? {};
  out.serverSaw = { range: q.range, cookie: q.cookie, referer: q.referer, ae: q.ae, sent: q.sent };
  out.activeAfterAbort = stats.active;
  log("system fetch():", JSON.stringify(out));
  check("fetch() from a system module: streams, takes Range, aborts", out.status === 206 && stats.active === 0, "but it has no way to pick a container or private jar, and its body arrives as JS Uint8Arrays");
  Services.cookies.removeAll();
}

export async function run() {
  log("downloads folder", DOWNLOADS);
  Services.prefs.setIntPref(PER_SERVER, 16);
  const steps = { redirect, pauseResume, retry, speedLimit, speedLimitLong, noRange, refused, identity, crossOriginReferrer, systemFetch, h2 };
  for (const [name, fn] of Object.entries(steps)) {
    log(`--- ${name}`);
    try {
      await fn();
    } catch (e) {
      log(`FAIL ${name} threw ${e} ${e.stack ?? ""}`);
    }
  }
  Services.prefs.clearUserPref(PER_SERVER);
}
