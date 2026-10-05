// SPIKE 1: request blocking (MV2 webRequestBlocking + MV3 declarativeNetRequest), content scripts,
// background page, storage, tabs.query, with Firefox's own toolbox hidden.
// Needs the local test server (python spikes/extensions/serve.py); run-all.py starts it.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();

  // Baseline without extensions: everything loads.
  let r = await xt.nav(xt.page());
  await xt.waitFor(() => gBrowser.selectedTab.label.startsWith("RESULT"));
  spike.log("BASELINE (no extensions)", gBrowser.selectedTab.label);
  await spike.capture("block-0-baseline");

  const mv2 = await xt.installTemp("mv2");
  const mv3 = await xt.installTemp("mv3");
  spike.log("installed", mv2.id, "temporary=" + mv2.temporarilyInstalled, "signedState=" + mv2.signedState, "|", mv3.id, "temporary=" + mv3.temporarilyInstalled);
  spike.log("mv3 host permission state", JSON.stringify(xt.policy(mv3.id).allowedOrigins.patterns.map((p) => p.pattern)));
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);

  // A second tab so tabs.query has more than one tab to report.
  const tab2 = gBrowser.addTab("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await xt.sleep(2500);

  // Sub-resource blocking on the test page.
  r = await xt.nav(xt.page() + "?with-extensions");
  await xt.waitFor(() => gBrowser.selectedTab.label.startsWith("RESULT"));
  spike.log("WITH EXTENSIONS", gBrowser.selectedTab.label);
  await xt.sleep(800);
  await spike.capture("block-1-subresources");

  const s2 = xt.reported(mv2.id);
  spike.log("MV2 background state: blocked=" + s2?.blocked, "contentScriptPages=" + JSON.stringify(s2?.cs), "storage=" + JSON.stringify(s2?.storage));
  spike.log("MV2 blocked urls", JSON.stringify(s2?.blockedUrls));
  spike.log("MV2 tabs.query", JSON.stringify(s2?.tabs));
  spike.log("MV2 badge on this tab", JSON.stringify(xt.actionData(mv2.id)?.badgeText), "badge on tab2", JSON.stringify(xt.actionData(mv2.id, tab2)?.badgeText));
  const s3 = xt.reported(mv3.id);
  spike.log("MV3 background state", JSON.stringify(s3));
  spike.log("real Vitre tabs", JSON.stringify(gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec)));

  // Main-frame navigations to blocked URLs.
  for (const [label, url] of [
    ["allowed local", xt.page("localhost", "/ok/page.html")],
    ["MV2-blocked local", xt.page("localhost", "/ads-mv2/page.html")],
    ["DNR-blocked local", xt.page("localhost", "/ads-dnr/page.html")],
    ["allowed real host", "https://example.com/"],
    ["MV2-blocked real host", "https://example.org/"],
    ["DNR-blocked real host", "https://example.net/"],
  ]) {
    r = await xt.nav(url);
    spike.log("NAV", label, JSON.stringify(r));
    if (label.includes("blocked")) await spike.capture("block-nav-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  }
  spike.log("MV2 final blocked count", xt.reported(mv2.id)?.blocked, JSON.stringify(xt.reported(mv2.id)?.blockedUrls));

  // Content script evidence on a real site.
  r = await xt.nav("https://example.com/");
  await xt.sleep(800);
  await spike.capture("block-2-content-script");
});
