// Alternative loading path: a built-in (unsigned, privileged) WebExtension installed at runtime
// from a resource: URL with AddonManager.installBuiltinAddon. Also compares installTemporaryAddon.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, WebExtensionPolicy */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.loaded();
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
  const dir = res.getSubstitution("vitre-boot").QueryInterface(Ci.nsIFileURL).file;
  dir.append("testext-priv");
  res.setSubstitution("vitre-builtin-ext", Services.io.newFileURI(dir));
  spike.log("signatures required pref=" + Services.prefs.getBoolPref("xpinstall.signatures.required", true) + " | experiments pref=" + Services.prefs.getBoolPref("extensions.experiments.enabled", false));

  const titleOf = async (id) => {
    let title = null;
    for (let i = 0; i < 50; i++) {
      await spike.sleep(100);
      try {
        const e = WebExtensionPolicy.getByID(id).extension;
        // an extension with experiment_apis has its own apiManager; the shared global is on ExtensionParent
        const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
        title = ExtensionParent.apiManager.global.browserActionFor(e).action.getProperty(null, "title");
      } catch (err) {
        title = "ERR " + err;
      }
      if (title && title.includes("tabs=")) break;
    }
    return title;
  };

  try {
    const addon = await AddonManager.installBuiltinAddon("resource://vitre-builtin-ext/");
    const ext = WebExtensionPolicy.getByID(addon.id)?.extension;
    spike.log("BUILTIN addon id=" + addon.id + " isActive=" + addon.isActive + " isBuiltin=" + addon.isBuiltin + " isSystem=" + addon.isSystem + " hidden=" + addon.hidden + " signedState=" + addon.signedState + " location=" + addon.locationName + " temporarilyInstalled=" + addon.temporarilyInstalled + " isPrivileged=" + ext?.isPrivileged);
    const title = await titleOf(addon.id);
    check("E1 installBuiltinAddon(resource://...) : unsigned extension runs, privileged, experiment API works", !!title && title.includes("chrome code in"), title);
  } catch (e) {
    check("E1 installBuiltinAddon(resource://...)", false, String(e));
  }
  await spike.capture("builtin-addon");
});
