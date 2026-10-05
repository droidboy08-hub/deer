// SPIKE 6: why Chrome Web Store installs cannot work on Gecko, and what signatures allow.
// Release-build behaviour (plain run, no automation prefs).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  const mustSign = (t) => { try { return XPIExports.XPIDatabase.mustSign(t); } catch (e) { return "n/a " + e; } };
  spike.log("build:", JSON.stringify({ MOZ_REQUIRE_SIGNING: AppConstants.MOZ_REQUIRE_SIGNING, MOZILLA_OFFICIAL: AppConstants.MOZILLA_OFFICIAL, channel: AppConstants.MOZ_UPDATE_CHANNEL, version: AppConstants.MOZ_APP_VERSION }));
  spike.log("signing:", JSON.stringify({ "pref xpinstall.signatures.required": Services.prefs.getBoolPref("xpinstall.signatures.required"), "AddonSettings.REQUIRE_SIGNING": AddonSettings.REQUIRE_SIGNING,
    mustSign_extension: mustSign("extension"), mustSign_theme: mustSign("theme"), mustSign_locale: mustSign("locale"), mustSign_dictionary: mustSign("dictionary") }));

  // 1. The web install API is not there for ordinary sites (the Chrome Web Store included).
  await xt.nav(xt.page("127.0.0.1", "/amo.html"));
  spike.log("ordinary origin:", gBrowser.selectedTab.label);

  // 2. Even with the API, the package URL must be on addons.mozilla.org.
  for (const url of ["https://clients2.google.com/service/update2/crx?x=id%3Dabc"]) {
    const seen = [];
    const obs = { observe: (s, topic) => seen.push(topic) };
    Services.obs.addObserver(obs, "addon-install-webapi-blocked");
    let res;
    try {
      res = await Promise.race([
        AddonManager.webAPI.createInstall(gBrowser.selectedBrowser, { url, triggeringPrincipal: gBrowser.selectedBrowser.contentPrincipal }).then(() => "accepted", (e) => "rejected: " + JSON.stringify(e)),
        xt.sleep(4000).then(() => "pending"),
      ]);
    } catch (e) { res = "threw " + e; }
    Services.obs.removeObserver(obs, "addon-install-webapi-blocked");
    spike.log("webAPI.createInstall host check:", new URL(url).host, "->", res, seen.length ? "| observer topics " + JSON.stringify(seen) : "");
  }
  await xt.waitActive(() => PopupNotifications.panel.state === "open", 3000);
  await xt.sleep(400);
  const n = PopupNotifications.panel.state === "open" ? PopupNotifications.panel.firstElementChild : null;
  spike.log("doorhanger for the blocked host:", n ? JSON.stringify({ id: n.getAttribute("popupid"), label: n.getAttribute("label"), anchorIn: PopupNotifications.panel.anchorNode?.closest("#vitre-bar") ? "vitre-bar" : "elsewhere" }) : "none");
  if (n) await spike.capture("cws-1-webapi-blocked-doorhanger");
  await xt.closePopups();

  // 3. A CRX package is not an XPI.
  const crx = xt.file("www", "vitre-install.crx");
  const install = await AddonManager.getInstallForFile(crx, "application/x-chrome-extension");
  spike.log("getInstallForFile(.crx): state=" + AddonManager.stateToString(install.state), "error=" + install.error, AddonManager.errorToString(install.error));
  try { await AddonManager.installTemporaryAddon(crx); spike.log("installTemporaryAddon(.crx): loaded as a temporary add-on (the ZIP reader finds the archive behind the CRX header)"); } catch (e) { spike.log("installTemporaryAddon(.crx): " + String(e).slice(0, 200)); }

  // 4. The same content as a plain unsigned XPI: refused as a normal install, fine as temporary.
  const xpi = xt.file("www", "vitre-install.xpi");
  const i2 = await AddonManager.getInstallForFile(xpi, "application/x-xpinstall");
  spike.log("getInstallForFile(unsigned .xpi): state=" + AddonManager.stateToString(i2.state), "error=" + i2.error, AddonManager.errorToString(i2.error));
  const temp = await AddonManager.installTemporaryAddon(xpi);
  spike.log("installTemporaryAddon(unsigned .xpi): id=" + temp.id, "isActive=" + temp.isActive, "temporarilyInstalled=" + temp.temporarilyInstalled, "signedState=" + temp.signedState);

  // 5. Mozilla-signed and built-in add-ons in this runtime, for the signed-state values.
  const sys = (await AddonManager.getAddonsByTypes(["extension"])).filter((a) => a.isSystem || a.isBuiltin);
  spike.log("signedState legend: BROKEN=-2 UNKNOWN=-1 MISSING=0 PRELIMINARY=1 SIGNED=2 (AMO) SYSTEM=3 PRIVILEGED=4; NOT_REQUIRED=undefined");
  spike.log("add-ons shipped in the runtime:", JSON.stringify(sys.map((a) => ({ id: a.id, signedState: a.signedState, builtin: a.isBuiltin }))));
});
