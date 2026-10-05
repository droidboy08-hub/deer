// Verify claim 17: JSWindowActor bridge in a sandboxed WEB content process.
// ../boot14-actor.js timed out there because the child module sat in the spike folder, which a
// web content process may not read. Here the two modules are copied into <profile>/chrome/vitre/
// (the Windows content sandbox allows reading the profile's chrome folder, like the app folder) and
// served from resource://vitre-actors/. If Set succeeds in webIsolated, a module shipped inside the
// app (or any sandbox-readable folder) will work.
//   VITRE_WHERE = profile (default) | spike   (spike = original location, expected to time out)
/* global spike, G, gBrowser, Services, document, window, ChromeUtils, IOUtils, PathUtils, Ci */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const where = Services.env.get("VITRE_WHERE") || "profile";
  const browser = gBrowser.selectedBrowser;
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  let base = "resource://vitre-boot/";
  if (where === "profile") {
    const dir = PathUtils.join(PathUtils.profileDir, "chrome", "vitre");
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    for (const f of ["GlassChild.sys.mjs", "GlassParent.sys.mjs"]) {
      const text = await (await fetch("resource://vitre-boot/" + f)).text();
      await IOUtils.writeUTF8(PathUtils.join(dir, f), text);
    }
    res.setSubstitution("vitre-actors", Services.io.newURI(PathUtils.toFileURI(dir) + "/"));
    base = "resource://vitre-actors/";
  }
  spike.log("modules served from", base, "->", res.resolveURI(Services.io.newURI(base)));
  ChromeUtils.registerWindowActor("VitreGlass", {
    parent: { esModuleURI: base + "GlassParent.sys.mjs" },
    child: { esModuleURI: base + "GlassChild.sys.mjs", events: { DOMContentLoaded: {} } },
    messageManagerGroups: ["browsers"],
    safeForUntrustedWebProcess: true,
  });
  let ready = 0;
  window.addEventListener("VitreGlassReady", (e) => spike.log("VitreGlassReady #" + ++ready, e.detail.url.slice(0, 60)), true);
  const html = `<div style="position:fixed; left:400px; top:12px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(6px) invert(1);"></div>`;
  const L = G.layer();
  G.el("div", "position:absolute; left:400px; top:60px; background:#000; color:#fff; padding:1px 6px;", L, "lens above set through JSWindowActor (" + where + ")");
  for (const url of ["https://example.com/", "https://en.wikipedia.org/wiki/Stained_glass", G.sibling("page.html") + "?noanim=1", "about:preferences"]) {
    await G.go(url);
    await spike.sleep(url.includes("wikipedia") ? 2000 : 300);
    try {
      const actor = browser.browsingContext.currentWindowGlobal.getActor("VitreGlass");
      const t0 = performance.now();
      const r = await Promise.race([actor.sendQuery("Set", { html }), new Promise((r2) => setTimeout(() => r2("TIMEOUT"), 6000))]);
      spike.log("page", browser.currentURI.spec.slice(0, 50), "remoteType", browser.remoteType, "Set ->", r, (performance.now() - t0).toFixed(1) + " ms");
    } catch (e) {
      spike.log("page", browser.currentURI.spec.slice(0, 50), "remoteType", browser.remoteType, "FAILED", String(e).slice(0, 200));
    }
    await spike.sleep(500);
    await spike.capture("actor-" + where + "-" + (browser.remoteType || "parent").replace(/[^a-z]/gi, "").slice(0, 14) + (url.includes("wikipedia") ? "-wiki" : ""));
  }
});
