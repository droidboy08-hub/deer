// Spike: does nsIHttpChannelInternal.allowSpdy=false really give a download HTTP/1.1 connections
// (one TCP stream each) on a server that speaks HTTP/2? Real h2 servers, tiny ranged requests.
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { Identity, open } from "resource://vitre-boot/engine/VitreNet.sys.mjs";

const anon = new Identity();

async function ask(url, h1) {
  try {
    const res = await open(url, anon, { Range: "bytes=0-99" }, null, { h1 });
    const out = `${res.status}/${res.protocol}`;
    res.destroy();
    return out;
  } catch (e) {
    return `error ${e.code || e}`;
  }
}

export async function run() {
  log("prefs:", JSON.stringify({
    http2: Services.prefs.getBoolPref("network.http.http2.enabled", null),
    http3: Services.prefs.getBoolPref("network.http.http3.enable", null),
    httpsRR: Services.prefs.getBoolPref("network.dns.use_https_rr_as_altsvc", null),
    perServer: Services.prefs.getIntPref("network.http.max-persistent-connections-per-server"),
  }));
  for (const url of ["https://www.mozilla.org/robots.txt", "https://www.wikipedia.org/robots.txt", "https://example.com/"]) {
    log(url);
    log("  4 at once, h1 forced, first contact:", (await Promise.all([1, 2, 3, 4].map(() => ask(url, true)))).join("  "));
    log("  1 default:", await ask(url, false));
    log("  4 at once, h1 forced, h2 session exists:", (await Promise.all([1, 2, 3, 4].map(() => ask(url, true)))).join("  "));
    log("  1 default again:", await ask(url, false));
  }
}
