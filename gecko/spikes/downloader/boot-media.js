// Spike 4: media detection per tab and DRM detection (engine/VitreMedia.sys.mjs + actors).
// Tab A plays a video, fetches an HLS master/rendition/segment and a DASH manifest by fetch(),
// and embeds a frame that fetches another playlist. Tab B uses EME (ClearKey, built into Gecko).
/* global spike, ChromeUtils, Services, gBrowser, window, document, IOUtils, PathUtils, Cc, Ci */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreMedia } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreMedia.sys.mjs");
  const { fetchText } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreNet.sys.mjs");
  const { parseMaster, parseMedia, isMaster } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitrePlaylist.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  const errors = [];
  const listener = { observe: (m) => /vitre|VitreMedia|actors/i.test(m.message) && errors.push(m.message.slice(0, 300)) };
  Services.console.registerListener(listener);

  await spike.resize(1200, 760);
  // The content-process actor must be readable by sandboxed content processes: for the spike it is
  // copied into <profile>/chrome (the shipped app keeps it in the application folder instead).
  const actors = PathUtils.join(PathUtils.profileDir, "chrome", "vitre-actors");
  await IOUtils.makeDirectory(actors, { createAncestors: true, ignoreExisting: true });
  await IOUtils.copy(PathUtils.join(Services.env.get("VITRE_DL_HERE"), "engine", "actors", "VitreMediaChild.sys.mjs"), PathUtils.join(actors, "VitreMediaChild.sys.mjs"));
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(actors);
  Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution("vitre-actors", Services.io.newFileURI(dir));
  const fromSpikeFolder = Services.env.get("VITRE_DL_PHASE") === "spikefolder";
  VitreMedia.install(fromSpikeFolder ? {} : { childActorURI: "resource://vitre-actors/VitreMediaChild.sys.mjs" });
  spike.log(`child actor loaded from ${fromSpikeFolder ? "the spike folder" : actors}; tap on Firefox's EncryptedMedia actor: ${VitreMedia.emeTap}`);
  const notices = [];
  VitreMedia.subscribe((n) => notices.push(n));

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:24px;top:96px;width:560px;padding:14px 16px;border-radius:14px;background:#1c1c1ef2;color:#fff;font:12px 'Segoe UI';z-index:2147483647;white-space:pre-wrap;pointer-events:none";
  document.documentElement.appendChild(box);
  const show = (id) => {
    const tab = VitreMedia.tabs.get(id);
    const lines = [`Vitre media watch - tab "${VitreMedia.tabFor(id)?.label}"`, VitreMedia.isProtected(id) ? `PROTECTED (EME: ${[...tab.drm.keys()].join(", ")}): nothing is offered` : `${VitreMedia.candidates(id).length} candidate(s):`];
    for (const c of tab?.items.values() ?? []) lines.push(`  ${c.kind.padEnd(5)} ${c.type.padEnd(5)} ${String(c.bytes).padStart(8)} B  ${c.url.replace(H.BASE, "")}${c.frameUrl ? "  [frame " + c.frameUrl.replace(H.BASE, "") + "]" : ""}`);
    box.textContent = lines.join("\n");
  };

  // ---- tab A: a page with media ----
  const tabA = gBrowser.selectedTab;
  gBrowser.selectedBrowser.fixupAndLoadURIString(`${H.BASE}/media.html`, { triggeringPrincipal: system });
  await spike.loaded();
  const idA = gBrowser.selectedBrowser.browsingContext.browserId;
  for (let i = 0; i < 60 && (VitreMedia.tabs.get(idA)?.items.size ?? 0) < 5; i++) await spike.sleep(100);
  await spike.sleep(800);
  const a = [...(VitreMedia.tabs.get(idA)?.items.values() ?? [])];
  spike.log("tab A candidates:", JSON.stringify(a.map((c) => ({ kind: c.kind, type: c.type, mime: c.mime, bytes: c.bytes, url: c.url.replace(H.BASE, ""), frame: c.frameUrl.replace(H.BASE, "") }))));
  const by = (path) => a.find((c) => c.url.includes(path));
  check("the <video> element's file is seen as video with its full size (from Content-Range)", by("/media/clip")?.kind === "video" && by("/media/clip")?.type === "media" && by("/media/clip")?.bytes === 2471986, JSON.stringify(by("/media/clip") ?? null));
  check("HLS playlists fetched by script are seen (master and rendition)", by("/hls/master.m3u8")?.kind === "hls" && by("/hls/v360/index.m3u8")?.kind === "hls");
  check("a DASH manifest is seen", by("/manifest.mpd")?.kind === "dash");
  check("an HLS segment (.ts fetched by script) is not offered as a file", !by("seg000.ts"));
  check("a request made inside an iframe is attributed to the tab, with the frame's address", by("from=frame")?.frameUrl === `${H.BASE}/frame.html`, by("from=frame")?.frameUrl);
  check("responses map back to the gBrowser tab", VitreMedia.tabFor(idA) === tabA, `browserId ${idA} -> tab "${VitreMedia.tabFor(idA)?.label}"`);
  // Can a web content process read the spike folder at all? (resource://vitre-boot maps to a file: path.)
  const probe = await new Promise((resolve) => {
    const mm = gBrowser.selectedBrowser.messageManager;
    mm.addMessageListener("vitre-spike:probe", function on(m) {
      mm.removeMessageListener("vitre-spike:probe", on);
      resolve(m.data);
    });
    const script = () => {
      const out = {};
      try {
        out.sandboxLevel = Services.prefs.getIntPref("security.sandbox.content.level");
        out.resolved = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).resolveURI(Services.io.newURI("resource://vitre-boot/engine/VitreLimiter.sys.mjs"));
        ChromeUtils.importESModule("resource://vitre-boot/engine/VitreLimiter.sys.mjs");
        out.imported = true;
      } catch (e) {
        out.error = String(e);
      }
      sendAsyncMessage("vitre-spike:probe", out);
    };
    mm.loadFrameScript(`data:,(${encodeURIComponent(script.toString())})()`, false);
  });
  spike.log("content process and the spike folder:", JSON.stringify(probe));
  const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((r) => setTimeout(() => r("actor query timed out"), ms))]);
  let videos = await withTimeout(VitreMedia.videos(idA).catch((e) => "actor query failed: " + e));
  spike.log("tab A videos (asked from the content process):", JSON.stringify(videos));
  check("the page's <video> is described by the content-process actor", Array.isArray(videos) && videos[0]?.src.endsWith("/media/clip") && videos[0].width === 640 && !videos[0].protected);
  show(idA);
  await spike.capture("media-1-tab-a");

  // The downloader's own requests have no frame: they never show up as page media.
  const before = VitreMedia.tabs.get(idA).items.size;
  const master = await fetchText(`${H.BASE}/fx/hls/master.m3u8`, H.anon);
  check("the engine's own fetches are not mistaken for page media", VitreMedia.tabs.get(idA).items.size === before && isMaster(master));

  // ---- tab B: a page that uses EME ----
  const tabB = gBrowser.addTab(`${H.BASE}/drm.html`, { triggeringPrincipal: system });
  gBrowser.selectedTab = tabB;
  await spike.loaded(tabB.linkedBrowser);
  const idB = tabB.linkedBrowser.browsingContext.browserId;
  for (let i = 0; i < 80 && !VitreMedia.isProtected(idB); i++) await spike.sleep(100);
  await spike.sleep(500);
  const b = VitreMedia.tabs.get(idB);
  spike.log("tab B EME reports:", JSON.stringify(b ? { drm: [...b.drm.entries()], encrypted: b.encrypted, reportedBy: [...(b.sources ?? [])] } : null));
  check("EME use is detected for the tab that used it", VitreMedia.isProtected(idB) && b.drm.has("org.w3.clearkey"), `key systems ${JSON.stringify([...(b?.drm.keys() ?? [])])}`);
  check("...and not for the other tab", !VitreMedia.isProtected(idA) && VitreMedia.candidates(idA).length > 0 && VitreMedia.candidates(idB).length === 0);
  videos = await withTimeout(VitreMedia.videos(idB).catch((e) => "actor query failed: " + e));
  spike.log("tab B videos:", JSON.stringify(videos));
  check("the protected <video> reports mediaKeys", Array.isArray(videos) && videos[0]?.protected === true);
  show(idB);
  await spike.capture("media-2-tab-b-drm");

  // ---- DRM declared in the manifests themselves (the playlist parser, unchanged from the Electron engine) ----
  const drmMaster = parseMaster(await fetchText(`${H.BASE}/fx/hls/drm.m3u8`, H.anon), `${H.BASE}/fx/hls/drm.m3u8`);
  const encrypted = parseMedia(await fetchText(`${H.BASE}/fx/hls/v180/index.m3u8`, H.anon), `${H.BASE}/fx/hls/v180/index.m3u8`);
  const mpd = await fetchText(`${H.BASE}/fx/manifest.mpd`, H.anon);
  check("an HLS master with a Widevine session key is DRM", drmMaster.drm === true);
  check("plain AES-128 HLS is not DRM (it is decrypted)", encrypted.drm === false && !!encrypted.segments[0].key);
  check("a DASH manifest with ContentProtection is DRM", /<ContentProtection[^>]+(edef8ba9|9a04f079|widevine|playready|cenc)/i.test(mpd));

  spike.log("notices sent to the UI:", JSON.stringify(notices));
  // Navigating away forgets the tab's media.
  gBrowser.selectedTab = tabA;
  tabA.linkedBrowser.fixupAndLoadURIString(`${H.BASE}/page.html`, { triggeringPrincipal: system });
  for (let i = 0; i < 50 && VitreMedia.tabs.has(idA); i++) await spike.sleep(100);
  check("a new top-level page clears the tab's media", !VitreMedia.tabs.has(idA) || VitreMedia.tabs.get(idA).items.size === 0);
  if (errors.length) spike.log("console errors:", JSON.stringify(errors));
});
