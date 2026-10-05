// MV3 event page (Firefox runs MV3 backgrounds as non-persistent event pages).
const state = { bg: true, staticRules: null, dynamicRules: null, matched: null, storage: null, tabs: null, error: null };

function report() {
  browser.action.setTitle({ title: "MV3 " + JSON.stringify(state) });
}

async function refresh() {
  try {
    // A dynamic rule on top of the static rule set, added at runtime.
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [100],
      addRules: [
        {
          id: 100,
          priority: 1,
          action: { type: "block" },
          condition: { urlFilter: "/ads-dnr-dynamic/", resourceTypes: ["image", "xmlhttprequest", "main_frame"] },
        },
      ],
    });
    state.staticRules = await browser.declarativeNetRequest.getEnabledRulesets();
    state.dynamicRules = (await browser.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
    try {
      const m = await browser.declarativeNetRequest.getMatchedRules({});
      state.matched = m.rulesMatchedInfo.length;
    } catch (e) {
      state.matched = "n/a: " + e.message;
    }
    await browser.storage.local.set({ greeting: "stored-by-mv3" });
    state.storage = await browser.storage.local.get(null);
    const tabs = await browser.tabs.query({});
    state.tabs = tabs.map((t) => ({ id: t.id, active: t.active, url: t.url, title: t.title }));
  } catch (e) {
    state.error = String(e);
  }
  report();
}

browser.action.setBadgeBackgroundColor({ color: "#186ec8" });
browser.action.setBadgeText({ text: "on" });
browser.tabs.onUpdated.addListener((id, change) => {
  if (change.status === "complete") refresh();
});
browser.runtime.onInstalled.addListener(refresh);
browser.runtime.onStartup.addListener(refresh);
refresh();
