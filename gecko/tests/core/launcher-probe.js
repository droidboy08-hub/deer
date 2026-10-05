// Used by tests/core/launcher.py: report what the launched instance looks like from inside, then
// keep reporting its tabs so a URL handed over by a second launch shows up in the log.
/* global spike, Services, gBrowser */
(async () => {
  if (!spike.first) return;
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
  const marker = profile.clone();
  marker.append("vitre-profile");
  spike.log("LAUNCHED profile=" + profile.path + " marker=" + marker.exists() + " vitre=" + !!window.vitre + " allowAny=" + (Services.env.get("VITRE_ALLOW_ANY_PROFILE") || "unset"));
  for (let i = 0; i < 60; i++) {
    const wins = [...Services.wm.getEnumerator("navigator:browser")];
    spike.log("TABS " + JSON.stringify(wins.flatMap((w) => w.gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec))));
    spike.log("MODEL " + JSON.stringify(window.vitre.tabs.map((t) => [t.url, t.kind, t.theme, t.loading])));
    await spike.sleep(1000);
  }
})();
