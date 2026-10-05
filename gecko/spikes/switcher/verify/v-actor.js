// VERIFY switcher/actors: where can a sandboxed web content process read code from, and what
// works without any file at all.
// Run: python tools/run.py --boot spikes/switcher/verify/v-actor.js --name switcher-verify-vactor --out spikes/switcher/verify/out/v-actor --timeout 90
// Dev-only variant (sandbox off): MOZ_DISABLE_CONTENT_SANDBOX=1 python tools/run.py ... --name switcher-verify-vactorns --out spikes/switcher/verify/out/v-actor-nosandbox
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  spike.log("env MOZ_DISABLE_CONTENT_SANDBOX =", JSON.stringify(Services.env.get("MOZ_DISABLE_CONTENT_SANDBOX")));
  const t = vx.addTab(vx.page(1, "#246"));
  await vx.waitLoaded(t.linkedBrowser);
  gBrowser.selectedTab = t;
  await spike.sleep(300);

  // ---- 1. what a "web" content process can open for reading ----
  const appDir = Services.dirsvc.get("GreD", Ci.nsIFile).path; // gecko/runtime
  await IOUtils.makeDirectory(PathUtils.join(PathUtils.profileDir, "chrome"), { createAncestors: true });
  await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "chrome", "vx-probe.txt"), "hello");
  await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "vx-probe.txt"), "hello");
  const paths = {
    "project folder (spikes/.../v-actor.js)": Services.env.get("VITRE_BOOT"),
    "application dir (runtime/application.ini)": PathUtils.join(appDir, "application.ini"),
    "application dir, loose file two levels down (runtime/defaults/pref/*)": (await IOUtils.getChildren(PathUtils.join(appDir, "defaults", "pref")))[0],
    "application dir browser/omni.ja": PathUtils.join(appDir, "browser", "omni.ja"),
    "<profile>/chrome/vx-probe.txt": PathUtils.join(PathUtils.profileDir, "chrome", "vx-probe.txt"),
    "<profile>/vx-probe.txt": PathUtils.join(PathUtils.profileDir, "vx-probe.txt"),
  };
  const result = await new Promise((resolve) => {
    t.linkedBrowser.messageManager.addMessageListener("vx:read", (m) => resolve(m.data));
    setTimeout(() => resolve("TIMEOUT"), 4000);
    vx.inContent(t.linkedBrowser, `
      const out = {};
      const paths = ${JSON.stringify(paths)};
      for (const [label, p] of Object.entries(paths)) {
        try {
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(p);
          const s = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
          s.init(f, 0x01, 0, 0);
          const b = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
          b.setInputStream(s);
          const n = b.readBytes(Math.min(4, s.available())).length;
          s.close();
          out[label] = "READABLE (" + n + " bytes read)";
        } catch (e) { out[label] = String(e).match(/NS_ERROR_\\w+/)?.[0] ?? String(e).slice(0, 80); }
      }
      sendAsyncMessage("vx:read", { out, type: Services.appinfo.remoteType, level: Services.prefs.getIntPref("security.sandbox.content.level", -1) });
    `);
  });
  spike.log("1 content process", result.type, "sandbox level pref", result.level);
  for (const [k, v] of Object.entries(result.out ?? {})) spike.log("   ", k, "->", v);

  // ---- 2. JSWindowActor child module straight from the project folder ----
  window.VitrePage = { onPageChanged: (b, d) => spike.log("   [actor] page changed:", d.why, "scrollY", d.scrollY) };
  ChromeUtils.registerWindowActor("VitrePage", {
    parent: { esModuleURI: "resource://vitre-boot/actors/VitrePageParent.sys.mjs" },
    child: { esModuleURI: "resource://vitre-boot/actors/VitrePageChild.sys.mjs", events: { scroll: { capture: true }, DOMContentLoaded: {}, pageshow: {} } },
    messageManagerGroups: ["browsers"],
    allFrames: false,
    safeForUntrustedWebProcess: true,
  });
  const ping = (actor) => Promise.race([actor.sendQuery("Vitre:Ping").catch((e) => "query error " + e), spike.sleep(2500).then(() => "TIMEOUT (child module never loaded)")]);
  spike.log("2 actor child module in the project folder: ping ->", await ping(t.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage")));
  ChromeUtils.unregisterWindowActor("VitrePage");

  // ---- 3. no file at all: a frame script from a data: URL on the WINDOW message manager ----
  // (allowDelayedLoad=true -> also runs in every tab opened later in this window)
  const fs = `
    let pending = false;
    addEventListener("scroll", () => {
      if (pending) return;
      pending = true;
      content.requestAnimationFrame(() => { pending = false; sendAsyncMessage("Vitre:FS", { why: "scroll", scrollY: content.scrollY, t: Date.now() }); });
    }, true);
    addEventListener("pageshow", (e) => { if (e.target === content.document) sendAsyncMessage("Vitre:FS", { why: "pageshow", scrollY: content.scrollY, t: Date.now() }); }, true);
    addMessageListener("Vitre:FS:ScrollTo", (m) => content.scrollTo(0, m.data.y));
  `;
  const got = [];
  window.messageManager.addMessageListener("Vitre:FS", (m) => got.push((m.target === t.linkedBrowser ? "tab1" : m.target.currentURI.spec.slice(0, 24)) + ":" + m.data.why + "@" + m.data.scrollY + " (" + (Date.now() - m.data.t) + "ms)"));
  window.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(fs), true);
  await spike.sleep(300);
  t.linkedBrowser.messageManager.sendAsyncMessage("Vitre:FS:ScrollTo", { y: 400 });
  await spike.sleep(400);
  const t2 = vx.addTab("https://example.com/"); // opened after loadFrameScript, different process type
  await vx.waitLoaded(t2.linkedBrowser);
  await spike.sleep(500);
  spike.log("3 frame script from a data: URL (window.messageManager, delayed load): messages", got, "| second tab remoteType", t2.linkedBrowser.remoteType);
});
