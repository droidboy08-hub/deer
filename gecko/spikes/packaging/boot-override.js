// Checks the "override chrome://browser/content/browser.xhtml" variant (see make-override-variant.py).
/* global spike, gBrowser, Services, Cc, Ci */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.resize(1100, 720);
  await spike.loaded();
  const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
  spike.log("browser.xhtml resolves to " + reg.convertChromeURL(Services.io.newURI("chrome://browser/content/browser.xhtml")).spec);
  check("O1 the overridden document was used for the first window (registered from AutoConfig)", !!window.__vitreOverride, window.__vitreOverride);
  check("O2 document URI is still chrome://browser/content/browser.xhtml (relative URLs, CSP, windowtype intact)", document.documentURI === "chrome://browser/content/browser.xhtml" && document.documentElement.getAttribute("windowtype") === "navigator:browser", document.documentURI);
  check("O3 Firefox still works on top of it (gBrowser, tab loaded)", typeof gBrowser === "object" && gBrowser.currentURI.spec.startsWith("https://example.com"), gBrowser.currentURI.spec);
  check("O4 stylesheet from the overridden <head> applies", getComputedStyle(document.getElementById("vitre-probe")).backgroundColor === "rgb(10, 132, 255)");
  await spike.capture("override-browser-xhtml");
});
