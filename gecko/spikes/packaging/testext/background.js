browser.tabs.query({}).then(async (tabs) => {
  const info = await browser.runtime.getBrowserInfo();
  await browser.browserAction.setTitle({ title: "probe tabs=" + tabs.length + " browser=" + info.name + "/" + info.version });
});
