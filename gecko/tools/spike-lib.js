// Helpers for test scripts run through tools/run.py. Loaded into every browser window before the
// test script, after Vitre has booted in that window (window.vitre.whenReady).
//
//   spike.main(async () => { ... })     run the test, log any error, always quit. The body runs in
//                                       the FIRST browser window of the process only (the script is
//                                       loaded into every window, including ones the test opens);
//                                       pass { everyWindow: true } to run it in all of them.
//   spike.log(...)                      a line in the run's output (objects are JSON)
//   spike.check(name, ok, detail)       logs "PASS name" or "FAIL name detail"; run.py exits 1 on FAIL
//   await spike.capture('name')         real composited screenshot of THIS window -> <out>/name.png
//   await spike.waitFor(fn, { timeout, what })   poll until fn() is truthy (throws on timeout)
//   await spike.loaded(browser?)        the tab has finished loading
//   await spike.resize(w, h)            size and place the window
//   await spike.activate()              make Gecko treat this window as active without OS focus
//   spike.EU                            EventUtils (chrome://remote/content/external/EventUtils.js)
//   spike.press('Ctrl+Shift+T')         synthesize a key in-process; spike.type('text')
//   spike.click(elementOrX, y?)         synthesize a click in-process
//   await spike.openWindow({ private }) open a browser window; resolves with it once Vitre is ready there
//   await spike.modules('idm')          ask the runner which DLLs matching the text are loaded
//   spike.run                           1 on the first start with this profile, 2 after a restart...
//   spike.restart()                     restart in place (same profile); the script runs again with run+1
//   spike.quit()
// Never use OS focus or real input: other windows are open on this desktop.
/* global Services, Cc, Ci, Cu, IOUtils, PathUtils, ChromeUtils */
window.spike = (() => {
  const logPath = Services.env.get("VITRE_LOG");
  const outDir = Services.env.get("VITRE_OUT");
  // State shared by every window of this process: lives on the system modules' global.
  const shared = (() => {
    const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
    if (!g.__vitreHarness) {
      // Count process starts on this profile, so a script can tell "before" from "after" a restart.
      const run = Services.prefs.getIntPref("vitre.harness.runs", 0) + 1;
      Services.prefs.setIntPref("vitre.harness.runs", run);
      Services.prefs.savePrefFile(null);
      g.__vitreHarness = { windows: 0, run, pass: 0, fail: 0 };
      // The development runtime keeps Mozilla's identity, so its crash manager's housekeeping, 57 s after
      // start (CrashManager.sys.mjs runMaintenanceTasks: the Crash Reports\events aggregation and
      // `crashreporter.exe --ping-cleanup`), would work in the INSTALLED Firefox's
      // %APPDATA%\Mozilla\Firefox\Crash Reports (its UAppData). Test runs never do it.
      try {
        const cm = Services.crashmanager;
        cm._disableGleanPing = true;
        // defineProperty: the prototype's method is not writable, so a plain assignment does nothing.
        Object.defineProperty(cm, "runMaintenanceTasks", { value: () => Promise.resolve(), configurable: true });
      } catch (e) {
        dump("[spike] crash manager housekeeping not turned off: " + e + "\n");
      }
    }
    return g.__vitreHarness;
  })();
  const first = shared.windows++ === 0;

  const write = (line) => {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(logPath);
      const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      s.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
      const data = new TextEncoder().encode(line + "\n");
      const bin = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
      bin.setOutputStream(s);
      bin.writeByteArray(data);
      s.close();
    } catch (e) {
      dump("[spike] log failed " + e + "\n");
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
  const hwnd = () => {
    try {
      return window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    } catch (e) {
      return "";
    }
  };
  let EU = null;

  const api = {
    outDir,
    sleep,
    /** True in the first browser window of this process. */
    first,
    /** 1 on the first start with this profile, 2 after one restart, and so on. */
    run: shared.run,
    log: (...a) => write(a.map(fmt).join(" ")),

    /** Record an assertion. Returns `ok` so it can guard follow-up steps. */
    check(name, ok, detail) {
      if (ok) shared.pass++;
      else shared.fail++;
      write((ok ? "PASS " : "FAIL ") + name + (detail === undefined || (ok && detail === "") ? "" : "  " + fmt(detail)));
      return !!ok;
    },

    /** Poll until fn() returns something truthy and return it. Throws after `timeout` ms. */
    async waitFor(fn, { timeout = 10000, interval = 50, what = "condition" } = {}) {
      const end = Date.now() + timeout;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("timed out waiting for " + what);
        await sleep(interval);
      }
    },

    /** Screenshot this window (chrome + page) into <out>/<name>.png. Popups are separate OS windows and are not in it. */
    async capture(name) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await sleep(250);
      const done = PathUtils.join(outDir, name + ".png.done");
      write("@@capture " + name + " " + hwnd());
      for (let i = 0; i < 200 && !(await IOUtils.exists(done)); i++) await sleep(50);
    },

    /** Ask the runner which loaded DLLs match `text` in this run's processes; printed as a [modules] line. */
    async modules(text) {
      const done = PathUtils.join(outDir, "modules.done");
      await IOUtils.remove(done, { ignoreAbsent: true });
      write("@@modules " + text);
      for (let i = 0; i < 400 && !(await IOUtils.exists(done)); i++) await sleep(50);
    },

    resize(w, h) {
      window.resizeTo(w, h);
      window.moveTo(40, 40);
      return sleep(400);
    },

    /** Wait until a tab has finished loading something other than about:blank. */
    async loaded(browser = window.gBrowser.selectedBrowser) {
      for (let i = 0; i < 300; i++) {
        if (!browser.webProgress?.isLoadingDocument && browser.currentURI.spec !== "about:blank") return;
        await sleep(100);
      }
    },

    /** With focusmanager.testmode=true Gecko emulates the raise: doorhangers, <select> and key routing then work without OS focus. */
    async activate() {
      for (let i = 0; i < 40 && Services.focus.activeWindow !== window; i++) {
        window.focus();
        await sleep(50);
      }
      return Services.focus.activeWindow === window;
    },

    /** EventUtils, loaded once per window. */
    get EU() {
      if (!EU) {
        EU = { window, parent: window, _EU_Ci: Ci, _EU_Cc: Cc };
        Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU);
      }
      return EU;
    },

    /** Synthesize a key: "Ctrl+Shift+T", "F6", "Escape", "Alt+Left", "Ctrl+1". opts are extra EventUtils options (type, repeat...). */
    press(spec, opts = {}) {
      const parts = spec.split("+");
      let key = parts.pop();
      const named = { Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown", Esc: "Escape", Space: " ", Plus: "+", Minus: "-", Comma: "," };
      key = named[key] ?? key;
      const mods = { ctrlKey: parts.includes("Ctrl"), shiftKey: parts.includes("Shift"), altKey: parts.includes("Alt") };
      const name = key.length === 1 ? (mods.shiftKey ? key.toUpperCase() : key.toLowerCase()) : "KEY_" + key;
      this.EU.synthesizeKey(name, { ...mods, ...opts }, window);
    },

    type(text) {
      this.EU.sendString(text, window);
    },

    /** Click an element (its centre) or a point in this window's coordinates. opts: { button, clickCount, shiftKey, ... } */
    click(target, y, opts = {}) {
      if (typeof target === "number") this.EU.synthesizeMouseAtPoint(target, y, opts, window);
      else this.EU.synthesizeMouseAtCenter(target, typeof y === "object" && y ? y : opts, window);
    },

    /** Open another browser window; resolves with it once Firefox's delayed startup and Vitre's boot are done there. */
    openWindow(options = {}) {
      return new Promise((resolve) => {
        const win = window.OpenBrowserWindow(options);
        const observer = (subject) => {
          if (subject !== win) return;
          Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
          Promise.resolve(win.vitre?.whenReady).then(() => resolve(win));
        };
        Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      });
    },

    quit() {
      write("RESULT pass=" + shared.pass + " fail=" + shared.fail);
      write("@@quit");
      Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
    },

    /** Restart in place on the same profile. The script runs again in the new process with spike.run + 1. */
    restart() {
      Services.prefs.savePrefFile(null);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
      return new Promise(() => {});
    },

    /** Run an async main in the first window (or every window), log any error, always quit. */
    async main(fn, { everyWindow = false } = {}) {
      if (!first && !everyWindow) return;
      try {
        await fn();
      } catch (e) {
        write("ERROR " + e + "\n" + (e && e.stack ? e.stack : ""));
      }
      this.quit();
    },
  };
  return api;
})();
