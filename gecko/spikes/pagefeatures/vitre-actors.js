// Registers the VitrePage JSWindowActor (content-side helper for find colours, link rects, scroll).
//
// Where the child module lives matters: web content processes run in the Windows sandbox
// (security.sandbox.content.level 9) and cannot read arbitrary folders. A module under the boot
// folder fails with "Failed to load resource://vitre-boot/VitrePageChild.sys.mjs" and queries never
// answer. <profile>/chrome/ is readable by content (userContent.css lives there), so the spike
// copies the two modules there and maps resource://vitre-content/ to it. The shipped app should put
// them inside the install directory instead (not tested here: the spike may not write there).
/* global ChromeUtils, Services, Cc, Ci, PathUtils, IOUtils */
window.VitreActors = {
  registered: false,

  /** Copy the actor modules next to userChrome and return the resource: base URL for them. */
  async installToProfile() {
    const dir = PathUtils.join(PathUtils.profileDir, "chrome", "vitre");
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const src = PathUtils.parent(Services.env.get("VITRE_BOOT"));
    for (const f of ["VitrePageChild.sys.mjs", "VitrePageParent.sys.mjs"]) {
      await IOUtils.copy(PathUtils.join(src, f), PathUtils.join(dir, f));
    }
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(dir);
    res.setSubstitution("vitre-content", Services.io.newFileURI(f)); // also sent to content processes
    return "resource://vitre-content/";
  },

  register(baseURL = "resource://vitre-boot/") {
    try {
      ChromeUtils.registerWindowActor("VitrePage", {
        parent: { esModuleURI: baseURL + "VitrePageParent.sys.mjs" },
        child: { esModuleURI: baseURL + "VitrePageChild.sys.mjs", events: { DOMDocElementInserted: {} } },
        allFrames: true,
        messageManagerGroups: ["browsers"],
        // Without this flag an actor is refused in ordinary web content processes
        // ("Window protocol 'X' doesn't match remote type 'webIsolated=...'").
        safeForUntrustedWebProcess: true,
      });
      this.registered = true;
      return true;
    } catch (e) {
      return String(e);
    }
  },

  /** sendQuery to the top frame's actor of a browser (rejects after `ms` if the child never answers). */
  query(browser, name, data, ms = 4000) {
    const q = browser.browsingContext.currentWindowGlobal.getActor("VitrePage").sendQuery(name, data);
    return Promise.race([q, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: no answer from the child actor")), ms))]);
  },

  /** Ask every frame of a browser (find colours must be set per document). */
  broadcast(browser, name, data) {
    const walk = (bc) => {
      try {
        bc.currentWindowGlobal?.getActor("VitrePage").sendAsyncMessage(name, data);
      } catch (e) {}
      bc.children.forEach(walk);
    };
    walk(browser.browsingContext);
  },
};
