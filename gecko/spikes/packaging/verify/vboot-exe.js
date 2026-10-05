// Verifier: boot script for vtest-exe.py (engine started from a renamed / resource-edited exe copy).
/* global spike, gBrowser, Services, Ci, ChromeUtils */
spike.main(async () => {
  await spike.resize(1000, 700);
  await spike.loaded();
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
  spike.log("ENGINE exe=" + exe + " | appinfo.name=" + Services.appinfo.name + " | UA=" + navigator.userAgent);
  const b = gBrowser.selectedBrowser;
  spike.log("PAGE uri=" + b.currentURI.spec + " title=" + b.contentTitle + " remoteType=" + b.remoteType + " | window title=" + document.title);
  // a sandboxed content process must be able to run and reach our child actor
  let pong = null;
  try {
    pong = await Promise.race([b.browsingContext.currentWindowGlobal.getActor("VitreProbe").sendQuery("VitreProbe:Ping"), spike.sleep(5000).then(() => "TIMEOUT")]);
  } catch (e) {
    pong = "ERR " + e;
  }
  spike.log((pong && pong.processType === 2 ? "PASS" : "FAIL") + " content process + child actor work :: " + JSON.stringify(pong).slice(0, 200));
  const info = await ChromeUtils.requestProcInfo();
  spike.log("CHILDREN " + info.children.map((c) => c.type).join(","));
  await spike.capture("exe-window");
});
