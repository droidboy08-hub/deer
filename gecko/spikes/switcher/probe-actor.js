// PROBE: where can a content process read actor modules from?
// Run: python tools/run.py --boot spikes/switcher/probe-actor.js --name switcher-probe-actor --out spikes/switcher/out/probe-actor --timeout 90
// Finding: web content processes cannot read files in the project folder (sandbox), so a child
// actor module mapped straight from the spike folder fails with "Failed to load resource://...".
// <profile>/chrome is readable by the content sandbox (it is where userContent.css lives).
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  Services.console.registerListener({
    observe(m) {
      const s = String(m.message || m);
      if (/vitre|actor/i.test(s)) spike.log("[console]", s.slice(0, 200));
    },
  });
  const register = (name, base, extra = {}) =>
    ChromeUtils.registerWindowActor(name, {
      parent: { esModuleURI: base + "VitrePageParent.sys.mjs" },
      child: { esModuleURI: base + "VitrePageChild.sys.mjs", events: { scroll: { capture: true }, DOMContentLoaded: {}, pageshow: {} } },
      messageManagerGroups: ["browsers"],
      allFrames: false,
      ...extra,
    });
  const ping = (actor) => Promise.race([actor.sendQuery("Vitre:Ping").catch((e) => "query error " + e), spike.sleep(2500).then(() => "TIMEOUT (child module never loaded)")]);
  window.VitrePage = { onPageChanged: (b, d) => spike.log("   page changed:", d.why, "scrollY", d.scrollY) };

  const t = vx.addTab(vx.page(1, "#246"));
  await vx.waitLoaded(t.linkedBrowser);
  gBrowser.selectedTab = t;
  await spike.sleep(300);
  const wgp = () => t.linkedBrowser.browsingContext.currentWindowGlobal;

  // 1. without safeForUntrustedWebProcess
  register("VitreNoFlag", "resource://vitre-boot/actors/");
  try {
    wgp().getActor("VitreNoFlag");
    spike.log("1 no safeForUntrustedWebProcess: getActor worked");
  } catch (e) {
    spike.log("1 no safeForUntrustedWebProcess: getActor throws:", String(e).slice(0, 140));
  }

  // 2. child module mapped straight from the project folder
  // (the actor name fixes the export names: "VitrePage" -> VitrePageParent / VitrePageChild)
  register("VitrePage", "resource://vitre-boot/actors/", { safeForUntrustedWebProcess: true });
  spike.log("2 child module in the project folder (resource://vitre-boot/actors/): ping ->", await ping(wgp().getActor("VitrePage")));
  ChromeUtils.unregisterWindowActor("VitrePage");
  vx.inContent(t.linkedBrowser, `
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    let r;
    try { f.initWithPath(${JSON.stringify(Services.env.get("VITRE_BOOT"))}); r = "readable, size " + f.fileSize; } catch (e) { r = String(e).match(/NS_ERROR_\\w+/)?.[0] ?? String(e); }
    sendAsyncMessage("vx:r", { r, level: Services.prefs.getIntPref("security.sandbox.content.level", -1), type: Services.appinfo.remoteType });
  `);
  await new Promise((r) => {
    t.linkedBrowser.messageManager.addMessageListener("vx:r", (m) => {
      spike.log("2 content process reading a project file directly:", m.data);
      r();
    });
    setTimeout(r, 2000);
  });

  // 3. the same modules copied to <profile>/chrome/
  const base = await vx.mountForContent("actors", "vitre-actors");
  register("VitrePage", base, { safeForUntrustedWebProcess: true });
  t.linkedBrowser.reload();
  await spike.sleep(800);
  const actor = wgp().getActor("VitrePage");
  spike.log("3 child module in <profile>/chrome (" + base + "): ping ->", await ping(actor));
  actor.sendAsyncMessage("Vitre:ScrollTo", { y: 500 });
  await spike.sleep(600);
  spike.log("3 after ScrollTo(500): ping ->", await ping(actor));
  // an https page (a different content process type: webIsolated)
  const t2 = vx.addTab("https://example.com/");
  await vx.waitLoaded(t2.linkedBrowser);
  gBrowser.selectedTab = t2;
  await spike.sleep(500);
  spike.log("3 remote types", t.linkedBrowser.remoteType, "|", t2.linkedBrowser.remoteType, "| ping in https page ->", await ping(t2.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage")));
  // Firefox 157: node.ownerGlobal is gone
  spike.log("4 browser.ownerGlobal:", typeof t.linkedBrowser.ownerGlobal, "| browser.documentGlobal === window:", t.linkedBrowser.documentGlobal === window, "| tab._tPos:", typeof t._tPos, "| tab.elementIndex:", typeof t.elementIndex);
});
