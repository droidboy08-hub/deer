browser.commands.onCommand.addListener((name) => {
  browser.tabs.create({ url: "https://example.com/?ext-command=" + name, active: false });
});
