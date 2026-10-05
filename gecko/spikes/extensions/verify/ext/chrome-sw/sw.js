chrome.action.setBadgeText({ text: "sw" });
chrome.action.setTitle({ title: "CHROME-SW " + JSON.stringify({ ran: true, hasBrowser: typeof browser, hasChrome: typeof chrome }) });
