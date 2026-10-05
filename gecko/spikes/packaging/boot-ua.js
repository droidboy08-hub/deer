// Logs identity + UA only (used to compare UA prefs under a renamed application.ini).
spike.main(async () => {
  await spike.loaded();
  const ai = Services.appinfo;
  spike.log("APP name=" + ai.name + " | chrome UA=" + navigator.userAgent);
  const ua = await gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe").sendQuery("VitreProbe:Ping").then(() => null).catch(() => null);
  const http = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  spike.log("HTTP handler userAgent=" + http.userAgent);
  spike.log("prefs: compatMode.firefox=" + Services.prefs.getBoolPref("general.useragent.compatMode.firefox", false) + " override=" + Services.prefs.getStringPref("general.useragent.override", "(unset)"));
});
