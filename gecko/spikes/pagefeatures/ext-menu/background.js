browser.menus.create({ id: "probe-link", title: "Probe: open link with marker", contexts: ["link"] });
browser.menus.create({ id: "probe-any", title: "Probe: page item", contexts: ["page", "selection", "image"] });
browser.menus.create({ id: "probe-tab", title: "Probe: tab item", contexts: ["tab"] });
browser.menus.onClicked.addListener((info, tab) => {
  const url = (info.linkUrl || info.pageUrl || "about:blank").split("#")[0] + "#ext-clicked-" + info.menuItemId;
  browser.tabs.create({ url, active: false });
});
