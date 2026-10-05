// Spike glass: JSWindowActor route for the content-side lens (production shape). Which registration
// options work, and can a content process load the child module from this spike folder?
/* global spike, G, gBrowser, Services, document, window, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const browser = gBrowser.selectedBrowser;
  const html = `<div style="position:fixed; left:400px; top:12px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(6px) invert(1);"></div>`;
  const variants = {
    VitreGlassA: { child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs", events: { DOMContentLoaded: {} } } },
    VitreGlassB: { child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs" }, allFrames: true },
    VitreGlassC: { child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs" }, messageManagerGroups: ["browsers"] },
    VitreGlassD: { child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs" }, remoteTypes: ["web", "file", "privilegedabout", "extension"] },
    VitreGlass: { parent: { esModuleURI: "resource://vitre-boot/GlassParent.sys.mjs" }, child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs", events: { DOMContentLoaded: {} } }, messageManagerGroups: ["browsers"], safeForUntrustedWebProcess: true },
    VitreGlassE: { parent: { esModuleURI: "resource://vitre-boot/GlassParent.sys.mjs" }, child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs" } },
  };
  for (const [name, opts] of Object.entries(variants)) {
    try {
      ChromeUtils.registerWindowActor(name, opts);
      spike.log("registered", name);
    } catch (e) {
      spike.log("register failed", name, String(e));
    }
  }
  spike.log("browser messagemanagergroup =", browser.getAttribute("messagemanagergroup"));
  for (const url of [G.sibling("page.html") + "?noanim=1", "https://example.com/"]) {
    // Actors registered after a window global exists only apply to NEW window globals: navigate.
    await G.go(url);
    spike.log("page", browser.currentURI.spec.slice(0, 60), "remoteType", browser.remoteType);
    for (const name of Object.keys(variants)) {
      try {
        const actor = browser.browsingContext.currentWindowGlobal.getActor(name);
        const res = await Promise.race([actor.sendQuery("Set", { html }), new Promise((r) => setTimeout(() => r("TIMEOUT"), 5000))]);
        spike.log("  ", name, "Set ->", res);
      } catch (e) {
        spike.log("  ", name, "failed:", String(e).slice(0, 300));
      }
    }
    await spike.sleep(500);
    await spike.capture("actor-" + (url.startsWith("https") ? "web" : "file"));
  }
});
