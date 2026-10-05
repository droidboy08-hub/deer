// VERIFY: what the moved extensions button does on a fresh profile with no extensions at all
// (this is Vitre's "get extensions" entry point).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  const { extBtn } = xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  spike.log("fresh profile: extensions button hidden=" + extBtn.hidden, "always_visible pref=" + Services.prefs.getBoolPref("extensions.unifiedExtensions.button.always_visible", true), "active policies=" + gUnifiedExtensions.getActivePolicies().length);
  xt.click(extBtn);
  const up = await xt.waitFor(() => document.getElementById("unified-extensions-panel"), 5000);
  await xt.waitFor(() => up?.state === "open", 5000);
  await xt.sleep(1200);
  const buttons = [...(up?.querySelectorAll("toolbarbutton, button, a") || [])].filter((b) => b.getBoundingClientRect().height > 0).map((b) => (b.label || b.textContent || "").trim() + (b.id ? " #" + b.id : ""));
  spike.log("no extensions: panel state=" + up?.state, "text=" + JSON.stringify((up?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300)), "buttons=" + JSON.stringify(buttons));
  await spike.capture("empty-1-no-extensions-panel");
  const discover = up?.querySelector("#unified-extensions-discover-extensions");
  if (discover) {
    discover.click();
    await xt.sleep(3500);
    spike.log("'Discover extensions' -> tabs", JSON.stringify(gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec)));
    await spike.capture("empty-2-after-discover");
  }
});
