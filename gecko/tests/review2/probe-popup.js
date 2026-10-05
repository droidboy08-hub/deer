// Probe: does the /opener button open a popup window under the harness?
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { log, sleep } = spike;
  const b = window.vitre;
  await spike.resize(1280, 820);
  await spike.activate();
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  const opener = await W.load(window, b.active(), W.url("opener?target=" + encodeURIComponent(W.P("popup-page"))));
  const btn = await W.rectOf(window, opener.browser, "#pop");
  log("button", btn);
  W.click(window, btn.cx, btn.cy);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    log(i, browsers().map((x) => ({ popup: x.document.documentElement.hasAttribute("popup-window"), vitre: !!x.vitre, ready: x.vitre?.ready, isPopup: x.vitre?.isPopup, url: x.gBrowser?.selectedBrowser?.currentURI?.spec })));
    if (browsers().length > 1) break;
  }
  log("blocked?", gBrowser.selectedBrowser.popupBlocker?.getBlockedPopupCount?.());
});
