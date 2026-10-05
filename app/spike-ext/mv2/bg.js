let api = typeof chrome.webRequest;
try {
  chrome.webRequest.onBeforeRequest.addListener(
    () => ({ cancel: true }),
    { urls: ['*://example.org/*'] },
    ['blocking']
  );
  api += ' + blocking listener ok';
} catch (e) {
  api += ' + listener error: ' + e.message;
}
chrome.browserAction.setTitle({ title: 'mv2 api: ' + api });
