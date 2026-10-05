// Counts background starts in storage.local and reports through the action title.
const state = { runs: null, firstSeen: null, origin: location.origin, installedReason: null, temporary: null, blocked: 0 };
const report = () => browser.browserAction.setTitle({ title: "PERSIST " + JSON.stringify(state) });
browser.runtime.onInstalled.addListener((d) => { state.installedReason = d.reason; state.temporary = d.temporary; report(); });
browser.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (!new URL(d.url).pathname.includes("/ads-mv2/")) return {};
    state.blocked++;
    report();
    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
(async () => {
  const s = await browser.storage.local.get({ runs: 0, firstSeen: null });
  state.runs = s.runs + 1;
  state.firstSeen = s.firstSeen || new Date().toISOString();
  await browser.storage.local.set({ runs: state.runs, firstSeen: state.firstSeen });
  browser.browserAction.setBadgeText({ text: String(state.runs) });
  report();
})();
