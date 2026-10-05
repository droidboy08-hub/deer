// DRM is never downloadable. A page that asks for a key system (ClearKey here; Widevine and
// PlayReady go the same way) is protected: no download mark, the pill says "Protected video",
// Ctrl+Shift+D opens no picker, the 'downloads' service refuses the page's media, and a download
// click on that page does not lift the protection (the verifier's hole, keyed by the document now).
// Streams with DRM keys (HLS SESSION-KEY Widevine, DASH ContentProtection) are refused by the engine.
/* global spike, Services, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  check("Firefox's EncryptedMedia actor is tapped", engine.media.emeTap === true);

  const tab = await DL.open(DL.base + "/drm.html", { settle: 500 });
  const bid = tab.browser.browsingContext.browserId;
  await waitFor(() => engine.media.isProtected(bid), { timeout: 15000, what: "the page to be marked protected" });
  check("the ClearKey page is marked protected", engine.media.isProtected(bid), engine.media.debug(bid));
  const pageLog = await DL.frameScript(tab.browser, () => content.document.getElementById("log").textContent);
  log("page says", pageLog);
  await sleep(500);
  b.render();
  check("the pill shows no download mark on a protected page", b.bar.downloadMark().classList.contains("empty"));
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "protected", { timeout: 8000, what: "the Protected pill" });
  check("hovering the video shows 'Protected video', no download", /Protected video/.test(b.root.querySelector(".vd-pill").textContent) && !b.root.querySelector(".vd-pill-main"));
  await spike.capture("drm-1-protected-pill");
  check("the offer is 'protected' with no options", ui.video.state.offer?.state === "protected" && ui.video.state.offer.options.length === 0);

  spike.press("Ctrl+Shift+D");
  await sleep(1200);
  check("Ctrl+Shift+D opens no picker on DRM video", !ui.video.picker.isOpen);

  const before = engine.list(false).length;
  b.service("downloads").download(DL.base + "/media/clip.mp4", { browser: tab.browser });
  await sleep(500);
  check("the downloads service refuses a protected page's media", engine.list(false).length === before);

  // A download started from the protected page (a top-level response that becomes a download) must
  // not clear its protection: the page is still showing.
  const takes = engine.takeovers.length;
  b.openLink(DL.base + "/blob/medium", "current", { triggeringPrincipal: tab.browser.contentPrincipal });
  await waitFor(() => engine.takeovers.length > takes, { timeout: 15000, what: "the download from the protected page" });
  await sleep(800);
  check("the page is still the protected one", tab.browser.currentURI.spec.endsWith("/drm.html"), tab.browser.currentURI.spec);
  check("a download from the protected page keeps it protected", engine.media.isProtected(bid), engine.media.debug(bid));

  // Another document in the same tab is not protected.
  await DL.open(DL.base + "/video.html", { settle: 1200 });
  check("the next page in the tab is not protected", !engine.media.isProtected(tab.browser.browsingContext.browserId));

  // Streams with DRM keys are refused by the engine itself.
  const h = engine.start(DL.base + "/fx/hls/drm.m3u8", { mode: "hls", title: "DRM HLS" });
  const hv = await DL.until(h, ["failed", "completed"], { timeout: 20000 });
  check("an HLS master with a Widevine session key is refused", hv.state === "failed" && /protected/.test(hv.error), [hv.state, hv.error]);
  const d = engine.start(DL.base + "/fx/dash-drm.mpd", { mode: "dash", title: "DRM DASH" });
  const dv = await DL.until(d, ["failed", "completed"], { timeout: 20000 });
  check("a DASH manifest with ContentProtection is refused", dv.state === "failed" && /protected/.test(dv.error), [dv.state, dv.error]);
  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(700);
  await spike.capture("drm-2-panel-refused");
});
