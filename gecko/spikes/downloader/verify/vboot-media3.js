// VERIFY (claims 22, 23): the recipe clears a tab's media list and DRM flag on any TYPE_DOCUMENT
// response for the tab. A top-level request that turns into a DOWNLOAD (Content-Disposition:
// attachment) is such a response, but the page stays. Is the tab's state wrongly wiped?
/* global spike, ChromeUtils, Services, gBrowser, window, IOUtils, PathUtils, Cc, Ci */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreMedia } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreMedia.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  const here = Services.env.get("VITRE_VERIFY_HERE");
  const dir = PathUtils.join(H.DATA, "downloads-media3");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setStringPref("browser.download.dir", dir);
  const actors = PathUtils.join(PathUtils.profileDir, "chrome", "vitre-actors");
  await IOUtils.makeDirectory(actors, { createAncestors: true, ignoreExisting: true });
  await IOUtils.copy(PathUtils.join(here, "engine", "actors", "VitreMediaChild.sys.mjs"), PathUtils.join(actors, "VitreMediaChild.sys.mjs"));
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(actors);
  Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution("vitre-actors", Services.io.newFileURI(f));
  VitreMedia.install({ childActorURI: "resource://vitre-actors/VitreMediaChild.sys.mjs" });
  const waitFor = async (fn, ms = 10000) => {
    for (let i = 0; i < ms / 100; i++) {
      const v = await fn();
      if (v) return v;
      await spike.sleep(100);
    }
    return null;
  };
  const open = async (url) => {
    const tab = gBrowser.addTab(url, { triggeringPrincipal: system });
    gBrowser.selectedTab = tab;
    await waitFor(() => !tab.linkedBrowser.webProgress?.isLoadingDocument && tab.linkedBrowser.currentURI.spec === url);
    return tab;
  };

  // A tab with media, then a download started from it.
  const a = await open(`${H.BASE}/media.html`);
  const idA = a.linkedBrowser.browsingContext.browserId;
  await waitFor(() => (VitreMedia.tabs.get(idA)?.items.size ?? 0) >= 5);
  const before = VitreMedia.tabs.get(idA)?.items.size ?? 0;
  a.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/dl/small`, { triggeringPrincipal: system });
  await spike.sleep(2500);
  const after = VitreMedia.tabs.get(idA)?.items.size ?? 0;
  check("a download started from a tab leaves that tab's media list alone", a.linkedBrowser.currentURI.spec.endsWith("/media.html") && after >= before,
    `page still ${a.linkedBrowser.currentURI.spec.replace(H.BASE, "")}; media items ${before} -> ${after}`);

  // A tab that used EME, then a download started from it.
  const b = await open(`${H.BASE}/drm.html`);
  const idB = b.linkedBrowser.browsingContext.browserId;
  await waitFor(() => VitreMedia.isProtected(idB));
  const was = VitreMedia.isProtected(idB);
  b.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/dl/small`, { triggeringPrincipal: system });
  await spike.sleep(2500);
  const videos = await VitreMedia.videos(idB).catch((e) => String(e));
  check("a download started from a DRM tab leaves the tab marked protected", was && VitreMedia.isProtected(idB),
    `protected ${was} -> ${VitreMedia.isProtected(idB)}; page still ${b.linkedBrowser.currentURI.spec.replace(H.BASE, "")}; its <video> still has mediaKeys: ${Array.isArray(videos) ? videos[0]?.protected : videos}`);
  await spike.capture("media3-drm-after-download");

  // A real navigation must still forget both.
  const hadA = VitreMedia.candidates(idA).length;
  a.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/page.html`, { triggeringPrincipal: system });
  await waitFor(() => a.linkedBrowser.currentURI.spec.endsWith("/page.html") && !a.linkedBrowser.webProgress?.isLoadingDocument);
  await spike.sleep(500);
  check("a real navigation forgets the tab's media", VitreMedia.candidates(idA).length === 0, `candidates ${hadA} -> ${VitreMedia.candidates(idA).length}`);
  b.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/page.html`, { triggeringPrincipal: system });
  await waitFor(() => b.linkedBrowser.currentURI.spec.endsWith("/page.html") && !b.linkedBrowser.webProgress?.isLoadingDocument);
  await spike.sleep(500);
  check("a real navigation clears the DRM mark", !VitreMedia.isProtected(idB));
  // Media that the NEW page loads is recorded for the new document.
  a.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/media.html`, { triggeringPrincipal: system });
  await waitFor(() => VitreMedia.candidates(idA).length >= 4);
  check("media of the next page is recorded again", VitreMedia.candidates(idA).length >= 4, `${VitreMedia.candidates(idA).length} candidates`);
  spike.log("fix active:", VitreMedia.fixed);
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
