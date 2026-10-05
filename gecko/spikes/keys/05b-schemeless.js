// 05b: does a typed schemeless address ("example.org") end up on https? Which call makes it so?
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-omnibox-data.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1000, 700);
  const trail = [];
  gBrowser.addTabsProgressListener({
    onLocationChange(b, wp, req, uri) { if (wp.isTopLevel) trail.push("loc:" + uri.spec); },
  });
  const run = async (label, fn) => {
    trail.length = 0;
    await KS.load("about:blank");
    trail.length = 0;
    fn();
    await spike.sleep(3500);
    spike.log(label + " -> " + gBrowser.currentURI.spec + "   trail " + JSON.stringify(trail));
  };
  const sys = KS.sysPrincipal;
  // One host per variant: after a downgrade HTTPS-First remembers the host for the session.
  await run("go('example.org')", () => VitreOmniboxData.go("example.org", "current"));
  await run("fixupAndLoadURIString('example.com', schemelessInput=Schemeless)", () => gBrowser.selectedBrowser.fixupAndLoadURIString("example.com", { triggeringPrincipal: sys, schemelessInput: Ci.nsILoadInfo.SchemelessInputTypeSchemeless, loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP | Ci.nsIWebNavigation.LOAD_FLAGS_FIXUP_SCHEME_TYPOS }));
  await run("fixupAndLoadURIString('example.net') without schemelessInput", () => gBrowser.selectedBrowser.fixupAndLoadURIString("example.net", { triggeringPrincipal: sys, loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP }));
  await run("go('http://www.iana.org/') explicit http", () => VitreOmniboxData.go("http://www.iana.org/", "current"));
  await run("go('example.org/typed') (https answers 404)", () => VitreOmniboxData.go("example.org/typed", "current"));
  await run("go('example.org') again after that", () => VitreOmniboxData.go("example.org", "current"));
  await run("fixupAndLoadURIString('some words') -> keyword search", () => { gBrowser.selectedBrowser.fixupAndLoadURIString("vitre spike words", { triggeringPrincipal: sys, loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP }); setTimeout(() => gBrowser.selectedBrowser.stop(), 1200); });
});
