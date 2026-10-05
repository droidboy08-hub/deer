// Verifier: add-on based loading paths on the release-signed 157 runtime.
//   D1  unsigned XPI in <runtime>\distribution\extensions\<id>.xpi          (spike claim 15: not run)
//   E1  AddonManager.installBuiltinAddon("resource://vitre/ext-builtin/")    (spike claim 14)
//   E2  (second run, same profile, VITRE_RUN=2) is the built-in add-on still there and running
//       WITHOUT calling installBuiltinAddon again?  -> does it persist, or must Vitre re-install it
//       on every start?
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, WebExtensionPolicy */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.loaded();
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const { AddonSettings } = ChromeUtils.importESModule("resource://gre/modules/addons/AddonSettings.sys.mjs");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const run = Services.env.get("VITRE_RUN") || "1";
  spike.log("RUN " + run + " REQUIRE_SIGNING=" + AddonSettings.REQUIRE_SIGNING + " pref xpinstall.signatures.required=" + Services.prefs.getBoolPref("xpinstall.signatures.required", true) + " EXPERIMENTS_ENABLED=" + AddonSettings.EXPERIMENTS_ENABLED);
  const describe = (a) =>
    a ? { id: a.id, isActive: a.isActive, appDisabled: a.appDisabled, userDisabled: a.userDisabled, signedState: a.signedState, location: a.locationName, isBuiltin: a.isBuiltin, isSystem: a.isSystem, hidden: a.hidden, temporarilyInstalled: a.temporarilyInstalled } : null;
  const titleOf = async (id) => {
    let title = null;
    for (let i = 0; i < 40; i++) {
      await spike.sleep(100);
      try {
        const e = WebExtensionPolicy.getByID(id).extension;
        title = ExtensionParent.apiManager.global.browserActionFor(e).action.getProperty(null, "title");
      } catch (err) {
        title = "ERR " + err;
      }
      if (title && title.includes("tabs=")) break;
    }
    return title;
  };

  // D1: distribution add-on (installed into the profile on first run of a new profile)
  const dist = await AddonManager.getAddonByID("pkg-probe@vitre.invalid");
  spike.log("D1 distribution/extensions unsigned xpi -> " + JSON.stringify(describe(dist)));
  check("D1 unsigned XPI in distribution/extensions is NOT usable on this release runtime (expected)", !dist || !dist.isActive, dist ? "installed but isActive=" + dist.isActive + " appDisabled=" + dist.appDisabled + " signedState=" + dist.signedState : "not installed at all");

  const ID = "builtin-probe@vitre.invalid";
  if (run === "1") {
    try {
      const addon = await AddonManager.installBuiltinAddon("resource://vitre/ext-builtin/");
      const ext = WebExtensionPolicy.getByID(addon.id)?.extension;
      spike.log("E1 " + JSON.stringify(describe(addon)) + " isPrivileged=" + ext?.isPrivileged + " rootURI=" + ext?.rootURI?.spec);
      const title = await titleOf(addon.id);
      check("E1 installBuiltinAddon(resource://vitre/ext-builtin/): unsigned, privileged, experiment API + tabs work", !!title && title.includes("chrome code in") && title.includes("tabs="), title);
    } catch (e) {
      check("E1 installBuiltinAddon", false, String(e));
    }
  } else {
    const addon = await AddonManager.getAddonByID(ID);
    spike.log("E2 " + JSON.stringify(describe(addon)));
    const title = addon ? await titleOf(ID) : null;
    check("E2 built-in add-on persists and starts by itself on the next start (no re-install call)", !!addon && addon.isActive && !!title && title.includes("tabs="), title);
  }
  // let the add-on database flush before the harness force-quits
  await spike.sleep(2500);
});
