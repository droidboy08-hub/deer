chrome.action.setBadgeText({ text: "dual" });
chrome.action.setTitle({ title: "CHROME-DUAL " + JSON.stringify({ ran: true, hasBrowser: typeof browser, hasChrome: typeof chrome, id: chrome.runtime.id }) });
