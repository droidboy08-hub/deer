// Verifier: is safeForUntrustedWebProcess really required for a window actor in web content on 157?
// Runs on the verifier runtime (chrome://vitre inside the runtime, so the child module is readable).
/* global spike, gBrowser, Services, ChromeUtils */
spike.main(async () => {
  await spike.loaded();
  const P = "chrome://vitre/content/actors/VitreProbeParent.sys.mjs";
  const C = "chrome://vitre/content/actors/VitreProbeChild.sys.mjs";
  spike.log("pref dom.jsipc.check_safeForUntrustedWebProcess=" + Services.prefs.getBoolPref("dom.jsipc.check_safeForUntrustedWebProcess", null) + " tab remoteType=" + gBrowser.selectedBrowser.remoteType);
  const ask = async () => {
    try {
      const actor = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe");
      const r = await Promise.race([actor.sendQuery("VitreProbe:Ping"), spike.sleep(4000).then(() => "TIMEOUT")]);
      return typeof r === "string" ? r : "OK title=" + r.title + " processType=" + r.processType;
    } catch (e) {
      return "THROWS " + String(e).slice(0, 220);
    }
  };
  const variants = {
    "A no flag": { parent: { esModuleURI: P }, child: { esModuleURI: C } },
    "B safeForUntrustedWebProcess:true": { parent: { esModuleURI: P }, child: { esModuleURI: C }, safeForUntrustedWebProcess: true },
    "C no flag + remoteTypes:[web,webIsolated]": { parent: { esModuleURI: P }, child: { esModuleURI: C }, remoteTypes: ["web", "webIsolated"] },
  };
  for (const [name, opts] of Object.entries(variants)) {
    try {
      ChromeUtils.unregisterWindowActor("VitreProbe");
      ChromeUtils.registerWindowActor("VitreProbe", opts);
      spike.log(name + " -> " + (await ask()));
    } catch (e) {
      spike.log(name + " register THROWS " + e);
    }
  }
});
