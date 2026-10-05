// Verifier: what do the command line and environment look like after an in-place restart
// (Services.startup.quit(eAttemptQuit | eRestart))? Needed for any launch guard that inspects the
// command line, and it explains why the harness cannot find the restarted process by profile name.
/* global spike, Services, Ci, ChromeUtils, IOUtils, PathUtils */
(async () => {
  const marker = PathUtils.join(spike.outDir, "restart-cmdline-marker.json");
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const k32 = ctypes.open("kernel32.dll");
  const cmdline = k32.declare("GetCommandLineW", ctypes.winapi_abi, ctypes.char16_t.ptr)().readString();
  k32.close();
  await spike.loaded();
  const second = await IOUtils.exists(marker);
  spike.log((second ? "AFTER RESTART" : "FIRST START") + " pid=" + Services.appinfo.processID + " appinfo.name=" + Services.appinfo.name + " UA=" + navigator.userAgent);
  spike.log("  cmdline=" + cmdline);
  spike.log("  env XRE_PROFILE_PATH=" + (Services.env.get("XRE_PROFILE_PATH") || "(unset)") + " | XRE_PROFILE_LOCAL_PATH=" + (Services.env.get("XRE_PROFILE_LOCAL_PATH") || "(unset)") + " | MOZ_NO_REMOTE=" + (Services.env.get("MOZ_NO_REMOTE") || "(unset)") + " | XUL_APP_FILE=" + (Services.env.get("XUL_APP_FILE") || "(unset)"));
  spike.log("  ProfD=" + PathUtils.profileDir + " | tabs=" + JSON.stringify(gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec)));
  if (!second) {
    await IOUtils.writeJSON(marker, { t: Date.now() });
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    return;
  }
  await IOUtils.remove(marker);
  spike.quit();
})();
