(async () => {
  let who = "experiment API missing";
  try {
    who = await browser.vitreProbe.whoami();
  } catch (e) {
    who = "ERR " + e;
  }
  const tabs = await browser.tabs.query({});
  await browser.browserAction.setTitle({ title: "builtin tabs=" + tabs.length + " | " + who });
})();
