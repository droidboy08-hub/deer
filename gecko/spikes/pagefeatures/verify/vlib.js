// Verifier helpers. Loads the spike's own modules (one folder up) unchanged, so what is tested is
// the spike's code, and adds a few probes.
/* global Services, Cc, Ci, ChromeUtils, PathUtils, IOUtils, spike */
(() => {
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const spikeDir = Services.env.get("VITRE_PF_SPIKE");
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(spikeDir);
  if (!res.hasSubstitution("vitre-pf")) res.setSubstitution("vitre-pf", Services.io.newFileURI(dir));
  const vload = (...names) => names.forEach((n) => Services.scriptloader.loadSubScript("resource://vitre-pf/" + n, window));

  /** Copy the spike's actor modules into <profile>/chrome/vitre/ (same as VitreActors.installToProfile,
   *  which looks next to the boot script and so cannot be used from the verify folder). */
  async function installActors() {
    const dst = PathUtils.join(PathUtils.profileDir, "chrome", "vitre");
    await IOUtils.makeDirectory(dst, { createAncestors: true });
    for (const f of ["VitrePageChild.sys.mjs", "VitrePageParent.sys.mjs"]) await IOUtils.copy(PathUtils.join(spikeDir, f), PathUtils.join(dst, f));
    const d = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    d.initWithPath(dst);
    res.setSubstitution("vitre-content", Services.io.newFileURI(d));
    return "resource://vitre-content/";
  }

  /** Post a real Win32 message to this window's HWND (in-process; no OS focus needed). */
  function win32() {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const GetForegroundWindow = user32.declare("GetForegroundWindow", ctypes.winapi_abi, ctypes.voidptr_t);
    const GetKeyboardState = user32.declare("GetKeyboardState", ctypes.winapi_abi, ctypes.bool, ctypes.uint8_t.ptr);
    const SetKeyboardState = user32.declare("SetKeyboardState", ctypes.winapi_abi, ctypes.bool, ctypes.uint8_t.ptr);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(handle));
    return {
      handle,
      post: (msg, wParam, lParam) => PostMessageW(hwnd, msg, wParam, lParam),
      wparamSelf: ctypes.UInt64(handle),
      isForeground: () => String(GetForegroundWindow()) === String(hwnd),
      /** Set or clear a virtual key in this thread's key state table (what GetKeyState reads). */
      setKey(vk, down) {
        const buf = ctypes.uint8_t.array(256)();
        GetKeyboardState(buf);
        buf[vk] = down ? 0x80 : 0;
        return SetKeyboardState(buf);
      },
    };
  }

  /**
   * Make this window the focus manager's active window without OS input. Needs the pref
   * focusmanager.testmode=true (then window.focus() emulates a raise inside Gecko). Parallel spike
   * windows steal the OS foreground; an inactive window has no focused content document, which breaks
   * anything that depends on focus (spellcheck, key routing, caret-anchored menus).
   */
  async function activate() {
    for (let i = 0; i < 20 && Services.focus.activeWindow !== window; i++) {
      window.focus();
      await new Promise((r) => setTimeout(r, 50));
    }
    return Services.focus.activeWindow === window;
  }

  window.v = { vload, installActors, win32, spikeDir, activate };
})();
