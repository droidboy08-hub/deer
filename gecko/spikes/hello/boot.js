spike.main(async () => {
  await spike.resize(1280, 800);
  await spike.loaded();
  spike.log('ua', navigator.userAgent, 'dpr', window.devicePixelRatio, 'tabs', gBrowser.tabs.length, 'url', gBrowser.currentURI.spec);
  await spike.capture('hello');
});
