// VERIFY switcher/actors (claim 21, "unverified" in the spike): a JSWindowActor child module
// served from the APPLICATION directory loads in sandboxed web content processes.
// gecko/runtime must not be edited, so this runs against a scratch COPY of the runtime that has
// <appdir>/vitre-actors/VitrePage{Parent,Child}.sys.mjs added (same config.js):
//   cp -r gecko/runtime <scratch>/runtime-appdir-test ; mkdir <scratch>/runtime-appdir-test/vitre-actors ; cp spikes/switcher/actors/*.mjs there
//   VX_FIREFOX=<scratch>/runtime-appdir-test/firefox.exe python spikes/switcher/verify/run_v.py --boot spikes/switcher/verify/v-appdir.js --name switcher-verify-vapp --out spikes/switcher/verify/out/v-appdir --timeout 90
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  const appDir = Services.dirsvc.get("GreD", Ci.nsIFile);
  const dir = appDir.clone();
  dir.append("vitre-actors");
  spike.log("application dir", appDir.path.replace(/.*\\(?=[^\\]+\\?$)/, "…\\"), "| vitre-actors exists there:", dir.exists(), "| MOZ_DISABLE_CONTENT_SANDBOX", JSON.stringify(Services.env.get("MOZ_DISABLE_CONTENT_SANDBOX")));
  if (!dir.exists()) {
    spike.log("SKIP: this runtime has no vitre-actors folder (run against the scratch copy, see the header)");
    return;
  }
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  res.setSubstitution("vitre-app-actors", Services.io.newFileURI(dir));
  const base = "resource://vitre-app-actors/";
  const events = [];
  window.VitrePage = { onPageChanged: (b, d) => events.push(d.why + "@" + d.scrollY) };
  ChromeUtils.registerWindowActor("VitrePage", {
    parent: { esModuleURI: base + "VitrePageParent.sys.mjs" },
    child: { esModuleURI: base + "VitrePageChild.sys.mjs", events: { scroll: { capture: true }, DOMContentLoaded: {}, pageshow: {} } },
    messageManagerGroups: ["browsers"],
    allFrames: false,
    safeForUntrustedWebProcess: true,
  });
  const ping = (t) => Promise.race([t.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage").sendQuery("Vitre:Ping").catch((e) => "query error " + e), spike.sleep(2500).then(() => "TIMEOUT (child module never loaded)")]);
  const t1 = vx.addTab(vx.page(1, "#246"));
  const t2 = vx.addTab("https://example.com/");
  await vx.waitLoaded(t1.linkedBrowser);
  await vx.waitLoaded(t2.linkedBrowser);
  gBrowser.selectedTab = t1;
  await spike.sleep(400);
  spike.log("web process (" + t1.linkedBrowser.remoteType + "): ping ->", await ping(t1));
  t1.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage").sendAsyncMessage("Vitre:ScrollTo", { y: 300 });
  await spike.sleep(400);
  spike.log("isolated process (" + t2.linkedBrowser.remoteType + "): ping ->", await ping(t2));
  spike.log("events received from the child module:", events);
});
