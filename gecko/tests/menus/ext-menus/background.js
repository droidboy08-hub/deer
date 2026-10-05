// Menu items for tests/menus/ext.js. One link item (shown on its own, with the extension's icon);
// several page items (Firefox groups them under one entry named after the extension, a submenu),
// including a checkbox and a nested submenu; one tab item. A click opens a background tab whose
// address carries a marker. menus.onShown renames one item and calls menus.refresh(), so the open
// menu must follow; shown / hidden counts are kept for the test.
/* global browser */
let shown = 0;
let hidden = 0;
browser.menus.create({ id: "probe-link", title: "Probe: open link with &marker", contexts: ["link"] });
browser.menus.create({ id: "probe-page", title: "Probe: page item", contexts: ["page", "selection"] });
browser.menus.create({ id: "probe-check", title: "Probe: checkbox", type: "checkbox", checked: false, contexts: ["page"] });
browser.menus.create({ id: "probe-more", title: "Probe: more", contexts: ["page"] });
browser.menus.create({ id: "probe-child-1", parentId: "probe-more", title: "Probe: child one", contexts: ["page"] });
browser.menus.create({ id: "probe-child-2", parentId: "probe-more", title: "Probe: child two", contexts: ["page"] });
browser.menus.create({ id: "probe-tab", title: "Probe: tab item", contexts: ["tab"] });

browser.menus.onShown.addListener(async (info) => {
  shown++;
  if (info.contexts.includes("page")) {
    await browser.menus.update("probe-page", { title: "Probe: page item (shown " + shown + ")" });
    await browser.menus.refresh();
  }
});
browser.menus.onHidden.addListener(() => {
  hidden++;
});

browser.menus.onClicked.addListener((info, tab) => {
  const base = (info.linkUrl || info.pageUrl || (tab && tab.url) || "about:blank").split("#")[0];
  const extra = info.menuItemId === "probe-check" ? "-" + info.checked : "";
  browser.tabs.create({ url: base + "#ext-clicked-" + info.menuItemId + extra + "-shown" + shown + "-hidden" + hidden, active: false });
});
