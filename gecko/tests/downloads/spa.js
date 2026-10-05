// A single-page video site moves to the next video without a new document (pushState), as YouTube,
// X or Instagram do: the first video's streams are forgotten and the next one is offered, with no reload.
/* global spike, Services, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, waitFor, sleep, log } = spike;
  await DL.init();
  await spike.resize(1280, 860);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const engine = DL.engine;
  const mark = () => b.bar.downloadMark();
  const browserId = () => gBrowser.selectedBrowser.browsingContext.browserId;
  const urls = () => engine.media.candidates(browserId()).map((c) => c.url.replace(/^https?:\/\/[^/]+/, ""));

  await DL.open(DL.base + "/video-spa.html", { settle: 1500 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the download mark" });
  log("first video: " + JSON.stringify(urls()));
  check("the first video's stream is known", urls().some((u) => u.startsWith("/fx/hls/")));
  const docBefore = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId;
  await sleep(2000);

  await DL.clickInPage("#next");
  await waitFor(() => /v=2/.test(gBrowser.selectedBrowser.currentURI.spec), { what: "the address change" });
  await waitFor(() => urls().some((u) => u.startsWith("/fx/hlsfmp4/")), { timeout: 8000, what: "the next video's stream" });
  await sleep(500);
  log("next video: " + JSON.stringify(urls()));
  check("still the same document (no reload)", gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId === docBefore);
  check("the first video's streams are forgotten", !urls().some((u) => u.startsWith("/fx/hls/")), urls());
  check("the next video's stream is known", urls().some((u) => u.startsWith("/fx/hlsfmp4/")), urls());
  check("the mark still shows", !mark().classList.contains("empty"));

  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 10000, what: "the picker" });
  const offered = ui.video.picker.element?.textContent ?? "";
  log("picker: " + offered.slice(0, 200));
  check("a click offers the next video without a reload", ui.video.picker.isOpen);
  await spike.capture("spa-1-next-video");

  // A #fragment change is the same page: nothing is forgotten.
  ui.video.picker.close(false);
  const before = urls().length;
  await b.page(b.active()).query("downloads:main-video").catch(() => null);
  gBrowser.selectedBrowser.browsingContext.currentWindowGlobal; // keep the reference warm
  b.navigate(b.active(), gBrowser.selectedBrowser.currentURI.spec.replace(/#.*$/, "") + "#comments");
  await sleep(800);
  check("a #fragment change keeps the streams", urls().length === before, [before, urls()]);
});
