// VERIFY: what a Necko http channel exposes in 157 that could key its connection pool entry.
/* global spike, ChromeUtils, Services, Ci, Cc */
spike.main(async () => {
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
  const ch = NetUtil.newChannel({ uri: "https://example.com/", loadUsingSystemPrincipal: true, contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD });
  ch.QueryInterface(Ci.nsIHttpChannel);
  ch.QueryInterface(Ci.nsIHttpChannelInternal);
  const props = [];
  for (const k in ch) props.push(k);
  spike.log("channel props:", props.sort().join(" "));
  const li = [];
  for (const k in ch.loadInfo) li.push(k);
  spike.log("loadInfo props:", li.sort().join(" "));
  spike.log("originAttributes:", JSON.stringify(ch.loadInfo.originAttributes));
  const cjs = [];
  for (const k in ch.loadInfo.cookieJarSettings) cjs.push(k);
  spike.log("cookieJarSettings props:", cjs.sort().join(" "), "| partitionKey:", JSON.stringify(ch.loadInfo.cookieJarSettings.partitionKey));
  const req = [];
  for (const k in Ci.nsIRequest) req.push(k);
  spike.log("nsIRequest consts:", req.join(" "));
  const cos = [];
  for (const k in Ci.nsIClassOfService) cos.push(k);
  spike.log("nsIClassOfService consts:", cos.join(" "));
  for (const p of ["network.http.max-persistent-connections-per-server", "network.http.max-urgent-start-excessive-connections-per-host", "network.http.max-connections", "privacy.partition.network_state", "privacy.partition.network_state.connection_with_proxy", "network.dns.use_https_rr_as_altsvc", "network.dns.force_waiting_https_rr", "network.http.http2.enabled", "network.http.speculative-parallel-limit", "browser.download.start_downloads_in_tmp_dir", "browser.download.open_pdf_attachments_inline", "browser.download.always_ask_before_handling_new_types", "browser.download.useDownloadDir", "media.eme.enabled", "security.sandbox.content.level"]) {
    let v = "(unset)";
    try {
      const t = Services.prefs.getPrefType(p);
      v = t === Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(p) : t === Services.prefs.PREF_INT ? Services.prefs.getIntPref(p) : t === Services.prefs.PREF_STRING ? Services.prefs.getStringPref(p) : "(no such pref)";
    } catch (e) {
      v = "error " + e;
    }
    spike.log("pref", p, "=", String(v));
  }
});
