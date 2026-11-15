// Vitre loader (AutoConfig, unsandboxed). This first line must be a comment: Gecko skips it.
// Installed into the engine's GRE folder (runtime/ on Windows, <app>/Contents/Resources on macOS) by
// tools/setup-runtime.py; defaults/pref/config-prefs.js points here.
//
// Runs once per start in the parent process, about 100 ms in: after the profile is selected and
// locked (ProfD is readable) and all default prefs are loaded, BEFORE prefs.js and user.js are read.
//   1. Launch guard: refuse to run in a profile that is not Vitre's.
//   2. Product defaults: apply defaults/pref/vitre-prefs.js over Firefox's own defaults, then on
//      macOS defaults/vitre-platform/mac*.js.
//   3. Register the chrome package and hand over to VitreStartup.init().
//   4. Test hook: load the harness library and a test script into every browser window.
// Everything else lives in the chrome package, so this file rarely needs to change.
//
// Environment (all optional):
//   VITRE_APP_DIR             the chrome package folder instead of <GRE folder>/vitre. It must be
//                             readable by sandboxed content processes: on Windows inside the runtime
//                             or <profile>/chrome; on macOS step 3 adds it to the sandbox's read paths.
//   VITRE_ALLOW_ANY_PROFILE=1 switch the launch guard off (test harness with throwaway profiles)
//   VITRE_DISABLE=1           do not load Vitre at all (stock Firefox, for comparisons)
//   VITRE_BOOT, VITRE_LIB, VITRE_LOG, VITRE_OUT   the test harness protocol of tools/run.py
// VITRE_APP_DIR, VITRE_BOOT and VITRE_LIB run script with full browser privileges, so they are
// honoured only in a harness profile: one that contains the marker file "vitre-harness", which
// tools/run.py and tests/core/launcher.py write into their throwaway profiles. In any other profile
// (the user's real one, with the variables set per user) they are ignored and a line is traced.
try {
  const Cc = Components.classes;
  const Ci = Components.interfaces;
  const Services = Components.utils.getGlobalForObject(
    ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs")
  ).Services;
  const mac = Services.appinfo.OS === "Darwin";
  const env = (name) => Services.env.get(name);
  const localFile = (path) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    return f;
  };
  const trace = (m) => {
    try {
      const log = env("VITRE_LOG");
      if (!log) return;
      const o = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      o.init(localFile(log), 0x02 | 0x08 | 0x10, 420, 0);
      const line = m + String.fromCharCode(10);
      o.write(line, line.length);
      o.close();
    } catch (e) {}
  };

  // 1. Launch guard. An engine started without -profile (on Windows a bare vitre.exe / firefox.exe:
  // a double-click, a pinned taskbar button, a file association; on macOS Contents/MacOS/firefox
  // started directly) would open the user's REAL Firefox profile with Vitre's chrome in it. The
  // profile directory must contain the marker file "vitre-profile", which the launcher creates. The
  // command line cannot be used for this: after an in-place restart it is the bare program.
  // This cannot undo Gecko having selected and locked that profile; it is a second line of defence.
  // macOS fails closed: when the guard cannot end the process (or cannot decide), `refused` skips
  // steps 2-4, so Vitre never loads into a foreign profile. Windows keeps going, as it always has.
  let refused = false;
  try {
    const profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
    const marker = profile.clone();
    marker.append("vitre-profile");
    if (!marker.exists() && !env("VITRE_ALLOW_ANY_PROFILE") && Services.appinfo.processType === 0) {
      trace("[config] not a Vitre profile, exiting: " + profile.path);
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      if (mac) {
        // _exit from libSystem, opened by the name Mozilla's own tests use for it on macOS
        // (security/sandbox/test/browser_content_sandbox_utils.js): no atexit handlers run in a
        // half-started Gecko. `refused` is set first, in case the call throws.
        refused = true;
        ctypes.open("libSystem.B.dylib").declare("_exit", ctypes.default_abi, ctypes.void_t, ctypes.int)(3);
      } else {
        ctypes.open("kernel32.dll").declare("ExitProcess", ctypes.winapi_abi, ctypes.void_t, ctypes.uint32_t)(3);
      }
    }
  } catch (e) {
    trace("[config] guard ERROR " + e);
    if (mac && Services.appinfo.processType === 0) refused = true;
  }

  // The harness marker: without it the three privileged variables are ignored (see the header).
  let harness = false;
  try {
    const m = Services.dirsvc.get("ProfD", Ci.nsIFile);
    m.append("vitre-harness");
    harness = m.exists();
  } catch (e) {
    harness = false;
  }
  if (!harness && (env("VITRE_APP_DIR") || env("VITRE_BOOT") || env("VITRE_LIB"))) {
    trace("[config] VITRE_APP_DIR / VITRE_BOOT / VITRE_LIB ignored: no vitre-harness marker in this profile");
  }

  if (refused) {
    trace("[config] launch guard could not exit: Vitre not loaded");
  } else if (env("VITRE_DISABLE")) {
    trace("[config] VITRE_DISABLE set: stock Firefox");
  } else {
    // 2. Product defaults. Gecko loads <GRE folder>/defaults/pref/*.js before Firefox's own
    // firefox.js, which then wins for every pref both define. Run the file again now, with pref()
    // writing the default branch, so Vitre's values are the defaults whatever the load order.
    // (loadSubScript only takes chrome: and resource: URLs, and resource://gre/ is omni.ja, not the
    // folder: mount the folder under its own name.)
    try {
      const defaults = Services.prefs.getDefaultBranch("");
      const dir = Services.dirsvc.get("GreD", Ci.nsIFile);
      dir.append("defaults");
      dir.append("pref");
      const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
      const shim = {
        pref(name, value) {
          try {
            if (typeof value === "boolean") defaults.setBoolPref(name, value);
            else if (typeof value === "number") defaults.setIntPref(name, value);
            else defaults.setStringPref(name, String(value));
          } catch (e) {
            // A pref whose built-in default has another type: say so instead of dropping the rest.
            trace("[config] product default " + name + " ERROR " + e);
          }
        },
      };
      res.setSubstitution("vitre-defaults", Services.io.newFileURI(dir));
      Services.scriptloader.loadSubScript("resource://vitre-defaults/vitre-prefs.js", shim);
      res.setSubstitution("vitre-defaults", null);

      // macOS defaults: every <GRE folder>/defaults/vitre-platform/mac*.js, in name order, over
      // vitre-prefs.js. The folder is outside defaults/pref on purpose: Gecko reads every .js in
      // defaults/pref on every OS (modules/libpref/Preferences.cpp, pref_LoadPrefsInDir), so a Mac
      // file there would change Windows too. Nothing but this step reads defaults/vitre-platform.
      if (mac) {
        const platform = dir.parent;
        platform.append("vitre-platform");
        const names = [];
        if (platform.exists()) {
          for (const f of platform.directoryEntries) {
            if (/^mac.*\.js$/.test(f.leafName) && f.isFile()) names.push(f.leafName);
          }
        }
        names.sort();
        res.setSubstitution("vitre-platform", Services.io.newFileURI(platform));
        for (const name of names) {
          try {
            Services.scriptloader.loadSubScript("resource://vitre-platform/" + encodeURIComponent(name), shim);
          } catch (e) {
            trace("[config] platform defaults " + name + " ERROR " + e);
          }
        }
        res.setSubstitution("vitre-platform", null);
      }
    } catch (e) {
      trace("[config] product defaults ERROR " + e);
    }

    // 3. The chrome package: chrome://vitre/content/ and the per-window category hooks.
    let appDir;
    if (harness && env("VITRE_APP_DIR")) {
      appDir = localFile(env("VITRE_APP_DIR"));
    } else {
      appDir = Services.dirsvc.get("GreD", Ci.nsIFile);
      appDir.append("vitre");
    }
    // macOS: the content sandbox reads only the app bundle, <profile>/chrome, <profile>/extensions
    // and the folders in the prefs security.sandbox.content.mac.testing_read_path1 and 2
    // (security/sandbox/mac/SandboxPolicyContent.h), by real path. In development
    // <app>/Contents/Resources/vitre is a symlink to gecko/build, so page actors could not load. Use
    // the package's real path and, when that is outside the bundle and <profile>/chrome, add it as a
    // read path (path 2 for the harness's VITRE_APP_DIR, tools/run.py --app). The pref is read once,
    // when the first content process starts (dom/ipc/ContentParent.cpp, CacheSandboxParams), which is
    // after this. A release carries a real copy inside the bundle, so it never sets either pref.
    if (mac) {
      try {
        appDir.normalize();
        const real = appDir.path;
        // The bundle as the sandbox has it: <app>/Contents/Resources -> <app>, symlinks resolved
        // (xpcom/base/nsMacUtilsImpl.cpp, GetAppPath).
        const bundle = Services.dirsvc.get("GreD", Ci.nsIFile).parent.parent;
        bundle.normalize();
        // The profile is not normalized: if its path is not a real one, no real path is inside it
        // and the pref is set, which is harmless.
        const profileChrome = Services.dirsvc.get("ProfD", Ci.nsIFile);
        profileChrome.append("chrome");
        const inside = (dir) => real.startsWith(dir.path + "/");
        if (!inside(bundle) && !inside(profileChrome)) {
          const name = "security.sandbox.content.mac.testing_read_path" + (harness && env("VITRE_APP_DIR") ? "2" : "1");
          Services.prefs.getDefaultBranch("").setStringPref(name, real);
          trace("[config] " + name + " = " + real);
        }
      } catch (e) {
        trace("[config] sandbox read path ERROR " + e);
      }
    }
    const manifest = appDir.clone();
    manifest.append("chrome.manifest");
    if (manifest.exists()) {
      Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);
      try {
        ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs").VitreStartup.init({
          appDir: appDir.path,
          loader: "autoconfig",
        });
      } catch (e) {
        trace("[config] VitreStartup ERROR " + e + " " + (e.stack || ""));
      }
    } else {
      trace("[config] no chrome.manifest in " + appDir.path + " (run: node tools/build.mjs)");
    }
  }

  // 4. Test hook (tools/run.py), harness profiles only. The test script runs in each browser window
  // after Vitre's own boot for that window has finished (window.vitre.whenReady), with `spike` from
  // the harness library. loadSubScript only accepts chrome: and resource: URLs, so the script folders
  // are mounted as resource://vitre-boot/ (siblings of the test script are reachable there) and
  // resource://vitre-lib/.
  const boot = harness && !refused ? env("VITRE_BOOT") : "";
  if (boot) {
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const mount = (name, path) => {
      const f = localFile(path);
      res.setSubstitution(name, Services.io.newFileURI(f.parent));
      return "resource://" + name + "/" + f.leafName;
    };
    const lib = env("VITRE_LIB");
    const libURL = lib && mount("vitre-lib", lib);
    const bootURL = mount("vitre-boot", boot);
    Services.obs.addObserver((win) => {
      const run = () => {
        try {
          if (libURL) Services.scriptloader.loadSubScript(libURL + "?" + Date.now(), win);
          Services.scriptloader.loadSubScript(bootURL + "?" + Date.now(), win);
        } catch (e) {
          trace("[config] BOOT ERROR " + e + " " + (e.stack || ""));
        }
      };
      const ready = win.vitre && win.vitre.whenReady;
      if (ready && typeof ready.then === "function") ready.then(run, run);
      else run();
    }, "browser-delayed-startup-finished");
  }
} catch (e) {
  // Never let an exception escape: AutoConfig would show "Failed to read the configuration file".
  try {
    pref("vitre.bootstrap.error", String(e) + " @ " + e.lineNumber);
  } catch (e2) {}
}
