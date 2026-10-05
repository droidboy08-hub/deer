// Vitre AutoConfig bootstrap (this first line must be a comment). SHELL SPIKE VARIANT of gecko/runtime/config.js:
// identical, plus an early autoRegister of the chrome.manifest named by VITRE_MANIFEST.
// Loads the boot script named by the VITRE_BOOT environment variable (a file path) into every
// browser window once it has finished starting. Spikes and the real app both enter through here.
try {
  const sys = Components.utils.getGlobalForObject(
    ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs")
  );
  const Services = sys.Services;
  const localFile = (path) => {
    const f = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    f.initWithPath(path);
    return f;
  };
  const fileURL = (path) => Services.io.newFileURI(localFile(path)).spec;
  const trace = (m) => {
    try {
      const o = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(
        Components.interfaces.nsIFileOutputStream
      );
      o.init(localFile(Services.env.get("VITRE_LOG")), 0x02 | 0x08 | 0x10, 420, 0);
      const line = m + String.fromCharCode(10);
      o.write(line, line.length);
      o.close();
    } catch (e) {}
  };
  // --- shell spike: register chrome://vitre/ and its per-window category hooks NOW, at AutoConfig
  // time, before any window exists. From here on Firefox itself calls VitreShell for every browser
  // window (first window included) through BrowserUtils.callModulesFromCategory.
  const manifest = Services.env.get("VITRE_MANIFEST");
  if (manifest) {
    try {
      Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar).autoRegister(localFile(manifest));
      trace("[config] registered " + manifest + " at AutoConfig time");
    } catch (e) {
      trace("[config] REGISTER ERROR " + e);
    }
  }
  const boot = Services.env.get("VITRE_BOOT");
  if (boot) {
    // loadSubScript only accepts chrome:/resource: URLs, so map the script folders.
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
    const mount = (name, path) => {
      const f = localFile(path);
      res.setSubstitution(name, Services.io.newFileURI(f.parent));
      return "resource://" + name + "/" + f.leafName;
    };
    const lib = Services.env.get("VITRE_LIB");
    const libURL = lib && mount("vitre-lib", lib);
    const bootURL = mount("vitre-boot", boot);
    Services.obs.addObserver((win) => {
      try {
        if (libURL) Services.scriptloader.loadSubScript(libURL + "?" + Date.now(), win);
        Services.scriptloader.loadSubScript(bootURL + "?" + Date.now(), win);
      } catch (e) {
        trace("[config] BOOT ERROR " + e + " " + (e.stack || ""));
      }
    }, "browser-delayed-startup-finished");
  }
} catch (e) {
  pref("vitre.bootstrap.error", String(e) + " @ " + e.lineNumber);
}
