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

  // 0. VERIFIER ADDITION - launch guard.
  // A bare "firefox.exe" (double-click, a pinned taskbar button, a Start Menu shortcut Firefox made
  // for itself, a file association) has no -profile and opens the user's REAL Firefox profile store
  // with Vitre's chrome in it. AutoConfig runs AFTER the profile has been selected and locked (ProfD is
  // already known here), so the guard cannot undo the selection, but it can refuse to run anything
  // in a profile that is not Vitre's.
  // Rule: the profile directory must contain the marker file "vitre-profile" (the launcher creates
  // it). The command line is NOT usable for this: after an in-place restart it is a bare
  // "firefox.exe" and XRE_PROFILE_PATH has already been consumed.
  // VITRE_ALLOW_ANY_PROFILE=1 switches the guard off (spike harness with throwaway profiles).
  try {
    const prof = Services.dirsvc.get("ProfD", Ci.nsIFile);
    const mark = prof.clone();
    mark.append("vitre-profile");
    const allowed = mark.exists() || !!Services.env.get("VITRE_ALLOW_ANY_PROFILE");
    trace("[guard] ProfD=" + prof.path + " marker=" + mark.exists() + " allowed=" + allowed + " msSinceStart=" + Math.round(Services.telemetry.msSinceProcessStart()));
    if (!allowed && Services.appinfo.processType === 0) {
      trace("[guard] not a Vitre profile: exiting");
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const k32 = ctypes.open("kernel32.dll");
      k32.declare("ExitProcess", ctypes.winapi_abi, ctypes.void_t, ctypes.uint32_t)(3);
    }
  } catch (e) {
    trace("[guard] ERROR " + e);
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
