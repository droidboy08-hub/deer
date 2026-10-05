// Loaded into the INSTALLED Deer's window by engine\config.js when installer\test.py starts it on a
// throwaway profile that carries the "vitre-harness" marker (config.js ignores the test hook in any
// other profile). Reports where the engine and the chrome package were loaded from, then keeps
// listing the open tabs so a URL handed over by a second launch shows up in the log.
/* global spike, Services, Cc, Ci */
(async () => {
  if (!spike.first) return;
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
  const marker = profile.clone();
  marker.append("vitre-profile");
  let pkg = "?";
  try {
    const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
    pkg = reg.convertChromeURL(Services.io.newURI("chrome://vitre/content/chrome.manifest")).spec;
  } catch (e) {
    pkg = "error " + e;
  }
  spike.log("LAUNCHED " + JSON.stringify({
    profile: profile.path,
    marker: marker.exists(),
    vitre: !!window.vitre,
    exe: Services.dirsvc.get("XREExeF", Ci.nsIFile).path,
    gre: Services.dirsvc.get("GreD", Ci.nsIFile).path,
    pkg,
    allowAny: Services.env.get("VITRE_ALLOW_ANY_PROFILE") || "unset",
  }));
  for (let i = 0; i < 120; i++) {
    const wins = [...Services.wm.getEnumerator("navigator:browser")];
    spike.log("TABS " + JSON.stringify(wins.flatMap((w) => w.gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec))));
    await spike.sleep(1000);
  }
})();
