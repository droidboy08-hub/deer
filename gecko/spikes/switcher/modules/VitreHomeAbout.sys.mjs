// Registers Vitre's Home at runtime: a chrome:// package for the page files and an
// about:vitre-home redirector to it, then makes it the new-tab page and the home page.
// Parent process only; the page loads in the parent with the system principal.
import { AboutNewTab } from "resource:///modules/AboutNewTab.sys.mjs";

const ABOUT = "vitre-home";
const CHROME_URL = "chrome://vitre-home/content/home.html";

class AboutVitreHome {
  classDescription = "about:" + ABOUT;
  classID = Components.ID("{6c2f6f4e-6b53-4d50-9a43-2f8b2d6f3a11}");
  contractID = "@mozilla.org/network/protocol/about;1?what=" + ABOUT;
  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule", "nsIFactory"]);

  newChannel(uri, loadInfo) {
    const chan = Services.io.newChannelFromURIWithLoadInfo(Services.io.newURI(CHROME_URL), loadInfo);
    chan.originalURI = uri; // the tab's URL stays about:vitre-home
    chan.owner = Services.scriptSecurityManager.getSystemPrincipal();
    return chan;
  }
  getURIFlags() {
    // No URI_SAFE_FOR_UNTRUSTED_CONTENT (web pages cannot link to it), no URI_MUST_LOAD_IN_CHILD
    // (it runs in the parent process), scripts allowed.
    return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI;
  }
  getChromeURI() {
    return Services.io.newURI(CHROME_URL);
  }
  // nsIFactory
  createInstance(iid) {
    return this.QueryInterface(iid);
  }
}

let chromeHandle = null;
let done = false;

export const VitreHomeAbout = {
  URL: "about:" + ABOUT,
  CHROME_URL,

  /** baseURI: the folder that contains home/ (a file: or resource: URI string ending in "/"). */
  register(baseURI) {
    if (done) return;
    done = true;
    // 1. chrome://vitre-home/content/ -> <base>/home/
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let base = Services.io.newURI(baseURI);
    if (base.schemeIs("resource")) base = Services.io.newURI(res.resolveURI(base));
    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    const manifestURI = Services.io.newURI("chrome.manifest", null, base); // only used as the base for relative paths
    chromeHandle = aomStartup.registerChrome(manifestURI, [["content", "vitre-home", "home/"]]);

    // 2. about:vitre-home
    const about = new AboutVitreHome();
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(about.classID, about.classDescription, about.contractID, about);

    // 3. new tab and home page. newTabURL is in-memory only, so this runs at every startup.
    AboutNewTab.newTabURL = this.URL;
    Services.prefs.getDefaultBranch("").setStringPref("browser.startup.homepage", this.URL);
  },

  unregister() {
    chromeHandle?.destruct();
    chromeHandle = null;
  },
};
