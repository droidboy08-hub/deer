const v = browser.runtime.getManifest().version;
browser.browserAction.setBadgeText({ text: v });
browser.browserAction.setBadgeBackgroundColor({ color: "#0a7d32" });
browser.browserAction.setTitle({ title: "UPD " + JSON.stringify({ version: v, permissions: browser.runtime.getManifest().permissions }) });
