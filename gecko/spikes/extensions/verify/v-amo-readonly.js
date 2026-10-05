// VERIFY claim 13 as far as it can go without downloading an extension: open the real
// addons.mozilla.org listing of uBlock Origin under the Vitre shell (release build), and read (only
// read) what the page sees: is navigator.mozAddonManager there, which process hosts the page, and
// does AMO offer its normal install button. Nothing is clicked and no .xpi is fetched.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const installs = [];
  AddonManager.addInstallListener({ onNewInstall: (i) => installs.push(i.sourceURI?.spec) });

  const r = await xt.nav("https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/", 4000);
  const browser = gBrowser.selectedBrowser;
  spike.log("AMO listing:", JSON.stringify({ after: r.after, status: r.status, title: gBrowser.selectedTab.label, remoteType: browser.remoteType }));

  const probe = () => new Promise((resolve) => {
    const mm = browser.messageManager;
    const onMsg = (m) => { mm.removeMessageListener("vitre-verify:amo", onMsg); resolve(m.data); };
    mm.addMessageListener("vitre-verify:amo", onMsg);
    const fs = function () {
      /* eslint-env mozilla/frame-script */
      const w = content.wrappedJSObject;
      const d = content.document;
      const btn = d.querySelector(".AMInstallButton-button, .AMInstallButton a, a.Button--action");
      const out = {
        mozAddonManager: typeof w.navigator.mozAddonManager,
        methods: w.navigator.mozAddonManager ? Object.getOwnPropertyNames(Object.getPrototypeOf(w.navigator.mozAddonManager)).filter((k) => k !== "constructor") : [],
        userAgent: w.navigator.userAgent,
        installButton: btn ? { text: btn.textContent.trim(), tag: btn.localName, hrefHost: btn.href ? new content.URL(btn.href).host : null, hrefIsXpi: btn.href ? /\.xpi(\?|$)/.test(btn.href) : null, disabled: btn.classList.contains("Button--disabled") } : null,
        getFirefoxBanner: !!d.querySelector(".GetFirefoxButton, .GetFirefoxBanner"),
        incompatible: (d.querySelector(".AddonCompatibilityError, .Notice-firefox-required, .Notice-warning")?.textContent || "").trim().slice(0, 200),
        h1: (d.querySelector("h1")?.textContent || "").trim().slice(0, 120),
      };
      sendAsyncMessage("vitre-verify:amo", out);
    };
    mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent("(" + fs.toString() + ")();"), false);
    setTimeout(() => resolve({ error: "no answer from the frame script" }), 8000);
  });
  spike.log("page probe:", JSON.stringify(await probe()));
  await spike.capture("amo-real-listing-ublock-origin");

  // What the parent-side web API would accept for this page (no install is created).
  const { AddonManagerPrivate } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  spike.log("extensions.webapi.enabled=" + Services.prefs.getBoolPref("extensions.webapi.enabled", true), "xpinstall.enabled=" + Services.prefs.getBoolPref("xpinstall.enabled", true),
    "extensions.getAddons.get.url host=" + (() => { try { return new URL(Services.prefs.getCharPref("extensions.getAddons.get.url")).host; } catch (e) { return "?"; } })(),
    "installs started by this run (must be empty):", JSON.stringify(installs.filter((u) => !/archive\.mozilla\.org\/pub\/system-addons/.test(u || ""))));
});
