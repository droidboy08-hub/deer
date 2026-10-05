chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  chrome.tabs.query({ active: true }).then((tabs) => {
    reply({ tabs: tabs.map((t) => ({ id: t.id, url: t.url })), senderTab: sender.tab && sender.tab.id });
  });
  chrome.action.setBadgeText({ text: '7' });
  return true;
});
