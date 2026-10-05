// VERIFY: which per-channel switch gives a channel its own connection-pool entry
// (nsIHttpChannelInternal.connectionInfoHashKey), and whether cookies still travel.
/* global spike, ChromeUtils, Services, Ci, Cc, Cr */
spike.main(async () => {
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
  const port = Services.env.get("VITRE_DL_PORT");
  spike.log("TLS_FLAG_CONFIGURE_AS_RETRY =", Ci.nsIHttpChannelInternal.TLS_FLAG_CONFIGURE_AS_RETRY);
  Services.cookies.add("127.0.0.1", "/", "sid", "vitre-secret", false, false, true, Date.now() + 3600e3, {}, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTP, false);

  const ask = (url, tweak) => new Promise((resolve) => {
    const ch = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true, contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD });
    ch.QueryInterface(Ci.nsIHttpChannel).QueryInterface(Ci.nsIHttpChannelInternal);
    ch.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING;
    ch.setRequestHeader("Range", "bytes=0-99", false);
    ch.channelIsForDownload = true;
    ch.forceAllowThirdPartyCookie = true;
    const out = {};
    try {
      tweak(ch);
    } catch (e) {
      out.tweakError = String(e);
    }
    ch.asyncOpen({
      QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]),
      onStartRequest(req) {
        try {
          const h = req.QueryInterface(Ci.nsIHttpChannel).QueryInterface(Ci.nsIHttpChannelInternal);
          out.status = h.responseStatus;
          out.protocol = h.protocolVersion;
          out.port = h.localPort;
          out.key = h.connectionInfoHashKey;
          out.rr = h.hasHTTPSRR;
        } catch (e) {
          out.error = String(e);
        }
      },
      onDataAvailable(req, stream, off, count) {
        NetUtil.readInputStreamToString(stream, count);
      },
      onStopRequest(req, status) {
        if (!Components.isSuccessCode(status)) out.stop = ChromeUtils.getXPCOMErrorName(status);
        resolve(out);
      },
    });
  });

  const tweaks = {
    "none": () => {},
    "allowSpdy=false": (ch) => { ch.allowSpdy = false; ch.allowHttp3 = false; },
    "cookieJarSettings partition": (ch, i) => {
      const cjs = Cc["@mozilla.org/cookieJarSettings;1"].createInstance(Ci.nsICookieJarSettings);
      cjs.initWithURI(Services.io.newURI(`https://lane-${i}.vitre.invalid/`), false);
      ch.loadInfo.cookieJarSettings = cjs;
    },
    "originAttributes.partitionKey": (ch, i) => { ch.loadInfo.originAttributes = { ...ch.loadInfo.originAttributes, partitionKey: `(https,lane-${i}.vitre.invalid)` }; },
    "originAttributes.firstPartyDomain": (ch, i) => { ch.loadInfo.originAttributes = { ...ch.loadInfo.originAttributes, firstPartyDomain: `lane-${i}.vitre.invalid` }; },
    "tlsFlags high bits": (ch, i) => { ch.tlsFlags = (i + 1) << 16; },
    "tlsFlags high bits + allowSpdy=false": (ch, i) => { ch.tlsFlags = (i + 1) << 16; ch.allowSpdy = false; ch.allowHttp3 = false; },
    "ipv6 disabled": (ch) => { ch.setIPv6Disabled(); },
    "trr disabled mode": (ch) => { ch.setTRRMode(Ci.nsIRequest.TRR_DISABLED_MODE); },
    "beConservative": (ch) => { ch.beConservative = true; },
    "beConservative + allowSpdy=false": (ch) => { ch.beConservative = true; ch.allowSpdy = false; ch.allowHttp3 = false; },
  };
  const targets = [`http://127.0.0.1:${port}/auth/medium`, "https://example.com/"];
  for (const url of targets) {
    spike.log("=== " + url);
    for (const [name, tweak] of Object.entries(tweaks)) {
      const rs = await Promise.all([0, 1, 2].map((i) => ask(url, (ch) => tweak(ch, i))));
      const keys = new Set(rs.map((r) => r.key));
      const ports = new Set(rs.map((r) => r.port));
      spike.log(`${name.padEnd(38)} status ${rs.map((r) => r.status ?? r.stop ?? r.error).join(",")} proto ${rs.map((r) => r.protocol).join(",")} | distinct keys ${keys.size} sockets ${ports.size}${rs[0].tweakError ? " | tweak error " + rs[0].tweakError : ""}`);
      spike.log(`    key[0] = ${JSON.stringify(rs[0].key)}`);
    }
  }
});
