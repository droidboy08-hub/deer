// Shared helpers for the "shell" spike boot scripts. Loaded into the browser window with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window)
// Defines window.vt.
/* global Services, Cc, Ci, Cu, ChromeUtils, Components, spike, gBrowser */
window.vt = (() => {
  const shared = Cu.getGlobalForObject(Services);
  const bootPath = Services.env.get("VITRE_BOOT");
  const dir = (() => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(bootPath);
    return f.parent;
  })();
  const fileIn = (...parts) => {
    const f = dir.clone();
    for (const p of parts) f.append(p);
    return f;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let user32 = null;
  let SendMessageW = null;
  const HT = { 0: "NOWHERE", 1: "CLIENT", 2: "CAPTION", 3: "SYSMENU", 8: "MINBUTTON", 9: "MAXBUTTON", 10: "LEFT", 11: "RIGHT", 12: "TOP", 13: "TOPLEFT", 14: "TOPRIGHT", 15: "BOTTOM", 16: "BOTTOMLEFT", 17: "BOTTOMRIGHT", 20: "CLOSE", "-1": "TRANSPARENT" };

  return {
    sleep,
    dir,
    fileIn,
    pageURL: (name) => Services.io.newFileURI(fileIn("pages", name)).spec,

    /** True only in the first window that runs a boot script in this process. */
    first() {
      if (shared.__vitreSpikeOwner) return false;
      shared.__vitreSpikeOwner = true;
      return true;
    },

    /** Register chrome://vitre/ and the category hooks from ./chrome.manifest at runtime. */
    register() {
      let known = false;
      try {
        Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry).convertChromeURL(Services.io.newURI("chrome://vitre/content/shell.css"));
        known = true; // already registered (run_early.py: config.js did it at AutoConfig time)
      } catch (e) {}
      if (!known && !shared.__vitreRegistered) {
        Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(fileIn("chrome.manifest"));
      }
      shared.__vitreRegistered = true;
      this.registeredEarly = known;
      return ChromeUtils.importESModule("chrome://vitre/content/VitreShell.sys.mjs").VitreShell;
    },

    /** Register + install the shell in this (already started) window. */
    install(win = window) {
      const shell = this.register();
      shell.adopt(win);
      return shell;
    },

    // ---- real Windows hit-testing (what the OS asks the window for a point) ----
    hwnd(win = window) {
      return win.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    },
    /** WM_NCHITTEST at client CSS pixel (x, y) of `win`. Returns e.g. "CAPTION", "CLIENT", "MAXBUTTON", "TOP". */
    hit(x, y, win = window) {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      if (!user32) {
        user32 = ctypes.open("user32.dll");
        SendMessageW = user32.declare("SendMessageW", ctypes.winapi_abi, ctypes.intptr_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
      }
      const dpr = win.devicePixelRatio;
      const sx = Math.round((win.mozInnerScreenX + x) * dpr);
      const sy = Math.round((win.mozInnerScreenY + y) * dpr);
      const lparam = ((sy & 0xffff) << 16) | (sx & 0xffff);
      const h = ctypes.voidptr_t(ctypes.UInt64(this.hwnd(win)));
      const r = SendMessageW(h, 0x0084, 0, lparam);
      const n = Number(r.toString());
      return HT[n] || String(n);
    },

    /** Kill a process the hard way (a content process dying, as with an out-of-memory kill). */
    kill(pid) {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const k32 = ctypes.open("kernel32.dll");
      const OpenProcess = k32.declare("OpenProcess", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.uint32_t);
      const TerminateProcess = k32.declare("TerminateProcess", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t);
      const CloseHandle = k32.declare("CloseHandle", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t);
      const h = OpenProcess(0x0001, 0, pid);
      if (h.isNull()) return false;
      const ok = TerminateProcess(h, 1);
      CloseHandle(h);
      k32.close();
      return !!ok;
    },

    // ---- in-process input (never native) ----
    mouse(type, x, y, opts = {}, win = window) {
      return win.synthesizeMouseEvent(type, x, y, { button: opts.button || 0, clickCount: opts.clickCount || 1, modifiers: 0, ...opts.data }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false });
    },
    async click(x, y, opts = {}, win = window) {
      this.mouse("mousemove", x, y, opts, win);
      this.mouse("mousedown", x, y, opts, win);
      this.mouse("mouseup", x, y, opts, win);
      await sleep(opts.wait ?? 150);
    },
    async move(x, y, win = window) {
      this.mouse("mousemove", x, y, {}, win);
      await sleep(120);
    },
    center(el) {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    },
    rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    },

    /** mochitest EventUtils (ships in omni.ja for the remote agent): keys into the focused element, in-process. */
    EU(win = window) {
      if (!win.__vtEU) {
        const o = { window: win, parent: win, _EU_Ci: Ci, _EU_Cc: Cc };
        Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", o);
        win.__vtEU = o;
      }
      return win.__vtEU;
    },
    /** Where a XUL popup is, relative to the window's client area (CSS px). */
    popupInfo(popup, win = window) {
      if (!popup) return null;
      const r = popup.getOuterScreenRect();
      const a = popup.anchorNode;
      return {
        id: popup.id,
        state: popup.state,
        anchor: a ? `${a.localName}#${a.id || ""}.${String(a.className?.baseVal ?? a.className).replace(/\s+/g, ".")}` : null,
        anchorRect: a ? this.rect(a) : null,
        rect: [Math.round(r.left - win.mozInnerScreenX), Math.round(r.top - win.mozInnerScreenY), Math.round(r.width), Math.round(r.height)],
      };
    },
    async popupOpen(popup, ms = 8000) {
      return this.until(() => popup.state === "open", ms);
    },
    async popupClosed(popup, ms = 4000) {
      try {
        popup.hidePopup();
      } catch (e) {}
      return this.until(() => popup.state === "closed", ms);
    },

    /** Wait for a condition (poll). */
    async until(fn, ms = 10000, step = 50) {
      const end = Date.now() + ms;
      for (;;) {
        let v;
        try {
          v = await fn();
        } catch (e) {}
        if (v) return v;
        if (Date.now() > end) return null;
        await sleep(step);
      }
    },

    /** Open a tab and wait until it has loaded. */
    async openTab(url, { select = true, wait = true } = {}, win = window) {
      const tab = win.gBrowser.addTrustedTab(url);
      if (select) win.gBrowser.selectedTab = tab;
      if (wait) await this.tabLoaded(tab);
      return tab;
    },
    async tabLoaded(tab, ms = 20000) {
      const b = tab.linkedBrowser;
      await this.until(() => !tab.hasAttribute("busy") && b.currentURI && b.currentURI.spec !== "about:blank" && !b.webProgress?.isLoadingDocument, ms);
      await sleep(200);
    },

    /** Summary of what the Vitre bar shows right now. */
    barState(win = window) {
      const bar = win.VitreUI?.bar;
      if (!bar) return null;
      const items = bar
        .tabs()
        .map((t) => bar.items.get(t))
        .filter(Boolean)
        .map((i) => ({
          active: i.classList.contains("active"),
          loading: i.classList.contains("loading"),
          host: i.querySelector(".host").textContent,
          title: i.querySelector(".circle-face").title,
          icon: i.querySelector(".circle-face .fav").dataset.src?.slice(0, 40),
          rect: this.rect(i),
        }));
      return { n: items.length, theme: win.VitreUI.root.className, layout: { left: bar.layout.left, right: bar.layout.right, compact: bar.layout.compact, circle: bar.layout.circle, pillW: bar.layout.pillW }, items };
    },
  };
})();
