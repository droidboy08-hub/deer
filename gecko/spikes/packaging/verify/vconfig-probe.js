// Vitre loader (AutoConfig; this first line must be a comment and is skipped by Gecko).
// Production path: no environment variables needed.
//   1. registers <runtime>/vitre/chrome.manifest  (chrome://vitre/content/, chrome://vitre/skin/)
//   2. imports chrome://vitre/content/modules/VitreStartup.sys.mjs and calls VitreStartup.init()
// Everything else lives in the chrome package, so this file never needs to change.
// Dev/test hooks (all optional): VITRE_APP = another app folder; VITRE_BOOT/VITRE_LIB/VITRE_LOG =
// the spike harness protocol (a test script loaded into each browser window after Vitre itself).
try {
  const Cc = Components.classes;
  const Ci = Components.interfaces;
  const sys = Components.utils.getGlobalForObject(
    ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs")
  );
  const Services = sys.Services;
  const localFile = (path) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    return f;
  };
  const trace = (m) => {
    try {
      const log = Services.env.get("VITRE_LOG");
      if (!log) return;
      const o = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      o.init(localFile(log), 0x02 | 0x08 | 0x10, 420, 0);
      const line = m + String.fromCharCode(10);
      o.write(line, line.length);
      o.close();
    } catch (e) {}
  };

  // VERIFIER PROBE: what is already known about the profile when AutoConfig runs?
  for (const key of ["ProfD", "ProfLD", "ProfDS", "UAppData", "PrefD"]) {
    try {
      trace("[probe] " + key + "=" + Services.dirsvc.get(key, Ci.nsIFile).path);
    } catch (e) {
      trace("[probe] " + key + " -> " + e.name);
    }
  }
  try {
    trace("[probe] startup observers topic order check: msSinceStart=" + Math.round(Services.telemetry.msSinceProcessStart()) + " policies.status=" + Services.policies.status);
  } catch (e) {
    trace("[probe] " + e);
  }

  // 1. the app folder: <runtime>/vitre (inside the install dir, so sandboxed content processes can read it)
  let appDir;
  const override = Services.env.get("VITRE_APP");
  if (override) {
    appDir = localFile(override);
  } else {
    appDir = Services.dirsvc.get("GreD", Ci.nsIFile);
    appDir.append("vitre");
  }
  const manifest = appDir.clone();
  manifest.append("chrome.manifest");
  if (manifest.exists()) {
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);
    trace("[config] registered " + manifest.path);
    // 2. hand over to the chrome package
    try {
      ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs").VitreStartup.init({
        appDir: appDir.path,
        loader: "autoconfig",
      });
    } catch (e) {
      trace("[config] VitreStartup ERROR " + e + " " + (e.stack || ""));
    }
  } else {
    trace("[config] no manifest at " + manifest.path);
  }

  // Test hook: same protocol as gecko/tools/run.py.
  const boot = Services.env.get("VITRE_BOOT");
  if (boot) {
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
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
  // Never let an exception escape: AutoConfig would show "Failed to read the configuration file".
  try {
    pref("vitre.bootstrap.error", String(e) + " @ " + e.lineNumber);
  } catch (e2) {}
}
