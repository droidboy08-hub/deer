chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [2],
  addRules: [{ id: 2, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||example.net^', resourceTypes: ['main_frame'] } }],
}).then(
  () => chrome.declarativeNetRequest.getDynamicRules().then((r) => chrome.action.setTitle({ title: 'dnr dynamic ok, rules=' + r.length })),
  (e) => chrome.action.setTitle({ title: 'dnr dynamic error: ' + e.message })
);
