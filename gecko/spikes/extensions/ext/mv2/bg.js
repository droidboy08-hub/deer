// MV2 persistent background page. Blocks with a blocking webRequest listener, like uBlock Origin.
const state = { bg: true, blocked: 0, blockedUrls: [], cs: [], storage: null, tabs: null, menuClicks: [] };
const perTab = new Map();

function report() {
  // The spike reads this back from the parent process through the action's title.
  browser.browserAction.setTitle({ title: "MV2 " + JSON.stringify(state) });
}

function shouldBlock(url) {
  try {
    const u = new URL(url);
    return u.pathname.includes("/ads-mv2/") || u.hostname === "example.org";
  } catch (e) {
    return false;
  }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldBlock(details.url)) return {};
    state.blocked++;
    state.blockedUrls.push(details.type + " " + details.url);
    if (details.tabId >= 0) {
      const n = (perTab.get(details.tabId) || 0) + 1;
      perTab.set(details.tabId, n);
      browser.browserAction.setBadgeText({ tabId: details.tabId, text: String(n) });
    }
    report();
    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

browser.browserAction.setBadgeBackgroundColor({ color: "#c42b1c" });

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "cs-hello") {
    state.cs.push(msg.url);
    report();
    return Promise.resolve({ ok: true, blocked: state.blocked });
  }
  if (msg && msg.type === "popup-state") {
    return Promise.resolve({ blocked: state.blocked, urls: state.blockedUrls });
  }
});

browser.menus.create({ id: "vitre-mv2-page", title: "MV2: block element here", contexts: ["page"] });
browser.menus.create({ id: "vitre-mv2-link", title: "MV2: block this link", contexts: ["link"] });
browser.menus.create({ id: "vitre-mv2-sel", title: "MV2: search blocklists for \"%s\"", contexts: ["selection"] });
browser.menus.create({ id: "vitre-mv2-action", title: "MV2: open the logger", contexts: ["browser_action"] });
browser.menus.create({ id: "vitre-mv2-parent", title: "MV2: more", contexts: ["page"] });
browser.menus.create({ id: "vitre-mv2-child", parentId: "vitre-mv2-parent", title: "MV2: child item", contexts: ["page"] });
browser.menus.onClicked.addListener((info, tab) => {
  state.menuClicks.push({ id: info.menuItemId, page: info.pageUrl, tab: tab && tab.id });
  report();
});

async function refresh() {
  await browser.storage.local.set({ greeting: "stored-by-mv2", at: 1 });
  state.storage = await browser.storage.local.get(null);
  const tabs = await browser.tabs.query({});
  state.tabs = tabs.map((t) => ({ id: t.id, active: t.active, url: t.url, title: t.title, windowId: t.windowId }));
  report();
}
browser.tabs.onUpdated.addListener((id, change) => {
  if (change.status === "loading" && change.url) {
    perTab.delete(id);
  }
  if (change.status === "complete") refresh();
});
browser.tabs.onActivated.addListener(refresh);
refresh();
