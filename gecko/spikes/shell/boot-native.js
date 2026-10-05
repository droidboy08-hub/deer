// Spike 2 (continued): the real Windows message path for the caption buttons and the drag strip
// (posted WM_NC* messages, no cursor movement), a taller drag strip, auto-hide, and entry-point
// alternatives for scripts and stylesheets inside browser.xhtml.
//   python tools/run.py --boot spikes/shell/boot-native.js --name shell-native --timeout 150
/* global spike, vt, Services, gBrowser, gURLBar, VitreUI, OpenBrowserWindow, BrowserWindowTracker */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const shell = vt.install();
    const d = document;
    const root = d.documentElement;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(500);
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e), e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : "");
      }
    };

    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(vt.hwnd()));
    const lparam = (x, y) => {
      const sx = Math.round((window.mozInnerScreenX + x) * devicePixelRatio);
      const sy = Math.round((window.mozInnerScreenY + y) * devicePixelRatio);
      return ((sy & 0xffff) << 16) | (sx & 0xffff);
    };
    const WM_NCLBUTTONDOWN = 0x00a1;
    const WM_NCLBUTTONUP = 0x00a2;
    const WM_NCLBUTTONDBLCLK = 0x00a3;
    const WM_NCMOUSEMOVE = 0x00a0;
    const HT = { CAPTION: 2, MIN: 8, MAX: 9, CLOSE: 20 };
    const ncClick = async (ht, x, y) => {
      PostMessageW(hwnd, WM_NCMOUSEMOVE, ht, lparam(x, y));
      PostMessageW(hwnd, WM_NCLBUTTONDOWN, ht, lparam(x, y));
      PostMessageW(hwnd, WM_NCLBUTTONUP, ht, lparam(x, y));
      await spike.sleep(900);
    };
    const st = () => ({ windowState: window.windowState, sizemode: root.getAttribute("sizemode"), inner: [window.innerWidth, window.innerHeight] });
    const maxBtn = () => d.getElementById("vitre-win-max");

    // ---- caption buttons through non-client messages (what a real click on HTMAXBUTTON sends)
    await step("nc buttons", async () => {
      const seen = [];
      const t0 = performance.now();
      for (const t of ["mousedown", "mouseup", "click"]) maxBtn().addEventListener(t, (e) => seen.push(`${e.type}@${Math.round(e.clientX)},${Math.round(e.clientY)}[state ${window.windowState} t=${Math.round(performance.now() - t0)}]`), true);
      const modes = [];
      window.addEventListener("sizemodechange", () => modes.push(`${Math.round(performance.now() - t0)}ms:${root.getAttribute("sizemode")}`));
      spike.log("before", st(), { active: Services.focus.activeWindow === window, hitOnMax: vt.hit(...vt.center(maxBtn())) });
      for (let i = 1; i <= 4; i++) {
        seen.length = 0;
        modes.length = 0;
        await ncClick(HT.MAX, ...vt.center(maxBtn()));
        await spike.sleep(400);
        spike.log(`non-client click ${i} on HTMAXBUTTON ->`, st().sizemode, "| DOM events:", seen.join(" "), "| sizemode changes:", modes.join(" "));
      }
      if (window.windowState === window.STATE_MAXIMIZED) {
        window.restore();
        await spike.sleep(700);
      }
      // hover: the non-client mouse move reaches the button as :hover (so Vitre's own hover style shows)
      PostMessageW(hwnd, WM_NCMOUSEMOVE, HT.MAX, lparam(...vt.center(maxBtn())));
      await spike.sleep(400);
      spike.log("WM_NCMOUSEMOVE on HTMAXBUTTON -> button :hover", maxBtn().matches(":hover"));
      await ncClick(HT.MIN, ...vt.center(d.getElementById("vitre-win-min")));
      spike.log("WM_NCLBUTTONDOWN/UP on HTMINBUTTON ->", { windowState: window.windowState, minimized: window.windowState === window.STATE_MINIMIZED });
      window.restore();
      await spike.sleep(700);
      spike.log("after restore()", st());
    });

    // ---- close button through non-client messages, on a second window
    await step("nc close", async () => {
      const win = OpenBrowserWindow();
      await vt.until(() => win.gBrowserInit?.delayedStartupFinished && win.VitreUI?.root, 10000);
      win.resizeTo(900, 600);
      win.moveTo(200, 120);
      await spike.sleep(1200);
      const btn = win.document.getElementById("vitre-win-close");
      const [x, y] = vt.center(btn);
      const h2 = ctypes.voidptr_t(ctypes.UInt64(vt.hwnd(win)));
      const lp = (((Math.round((win.mozInnerScreenY + y) * win.devicePixelRatio)) & 0xffff) << 16) | (Math.round((win.mozInnerScreenX + x) * win.devicePixelRatio) & 0xffff);
      spike.log("second window close button", { rect: vt.rect(btn), hit: vt.hit(x, y, win) });
      PostMessageW(h2, WM_NCMOUSEMOVE, HT.CLOSE, lp);
      PostMessageW(h2, WM_NCLBUTTONDOWN, HT.CLOSE, lp);
      PostMessageW(h2, WM_NCLBUTTONUP, HT.CLOSE, lp);
      await vt.until(() => win.closed, 5000);
      spike.log("non-client click on HTCLOSE -> window closed:", win.closed, "| first window alive:", !window.closed, "windows:", BrowserWindowTracker.orderedWindows.length);
    });

    // ---- drag strip: double-click on HTCAPTION is handled by Windows itself (maximize / restore)
    await step("caption dblclk", async () => {
      spike.log("hit at (100,12)", vt.hit(100, 12));
      PostMessageW(hwnd, WM_NCLBUTTONDBLCLK, HT.CAPTION, lparam(100, 12));
      await spike.sleep(1000);
      spike.log("WM_NCLBUTTONDBLCLK on HTCAPTION ->", st());
      spike.log("maximized: hit at (600,3)", vt.hit(600, 3));
      PostMessageW(hwnd, WM_NCLBUTTONDBLCLK, HT.CAPTION, lparam(600, 3));
      await spike.sleep(1000);
      spike.log("WM_NCLBUTTONDBLCLK again ->", st());
      if (window.windowState === window.STATE_MAXIMIZED) window.restore();
      await spike.sleep(800);
      spike.log("state for the strip tests", st());
    });

    // ---- the shipped drag strip (18px normal, 8px maximized) with the bar items opted out (no-drag)
    await step("strip", async () => {
      const strip = d.getElementById("vitre-drag");
      const pill = VitreUI.bar.layout.pillRect;
      const ys = [0, 4, 7, 8, 9, 11, 12, 14, 17, 18, 19, 24];
      const scan = (x) => ys.map((y) => `${y}:${vt.hit(x, y)}`).join(" ");
      spike.log("strip", vt.rect(strip), "state", st().sizemode);
      spike.log("normal, x=100 (page only)   ", scan(100));
      spike.log("normal, x on the pill       ", scan(pill.x + 100));
      spike.log("normal, x on the + circle   ", scan(vt.center(VitreUI.bar.plus)[0]));
      spike.log("normal, x on window controls", scan(vt.center(d.getElementById("vitre-win-min"))[0]));
      // without the opt-out the strip would win over the items painted above it
      const off = d.createElementNS(VitreUI.HTML, "style");
      off.textContent = "#vitre-bar .item, #vitre-winctl { -moz-window-dragging: default !important; }";
      VitreUI.root.append(off);
      await spike.sleep(300);
      spike.log("items WITHOUT no-drag, x on the pill", scan(pill.x + 100));
      off.remove();
      await spike.sleep(200);
      window.maximize();
      await spike.sleep(900);
      const p2 = VitreUI.bar.layout.pillRect;
      spike.log("maximized strip", vt.rect(strip), "| x=100", scan(100), "| x on the pill", scan(p2.x + 100));
      window.restore();
      await spike.sleep(900);
      spike.log("window.beginWindowMove available:", typeof window.beginWindowMove);
    });

    // ---- auto-hide
    await step("autohide", async () => {
      await vt.move(600, 500);
      VitreUI.root.classList.add("autohide");
      await spike.sleep(700);
      const pill = VitreUI.bar.items.get(gBrowser.selectedTab);
      spike.log("autohide on", { pillTop: Math.round(pill.getBoundingClientRect().top), opacity: getComputedStyle(d.getElementById("vitre-bar")).opacity, hitWherePillWas: d.elementFromPoint(640, 34)?.localName });
      await spike.capture("native-1-autohide-hidden");
      await vt.click(640, 34, { wait: 300 });
      spike.log("click where the pill was -> page title", gBrowser.selectedTab.label);
      await vt.move(640, 2);
      await spike.sleep(700);
      spike.log("pointer at top edge", { pillTop: Math.round(pill.getBoundingClientRect().top), opacity: getComputedStyle(d.getElementById("vitre-bar")).opacity });
      await spike.capture("native-2-autohide-revealed");
      VitreUI.root.classList.remove("autohide");
      await vt.move(600, 500);
    });

    // ---- Firefox's own keyboard commands with its chrome hidden
    await step("keys", async () => {
      const EU = vt.EU();
      const who = () => {
        const a = d.activeElement;
        return a ? `${a.localName}${a.id ? "#" + a.id : ""}${a.className && typeof a.className === "string" ? "." + a.className.split(" ")[0] : ""}` : null;
      };
      gBrowser.selectedBrowser.focus();
      await spike.sleep(200);
      const n = gBrowser.tabs.length;
      EU.synthesizeKey("t", { accelKey: true }, window);
      await spike.sleep(900);
      spike.log("Ctrl+T", { tabs: `${n} -> ${gBrowser.tabs.length}`, barItems: VitreUI.bar.items.size, activeElement: who(), urlbarFocused: gURLBar.focused });
      EU.synthesizeKey("l", { accelKey: true }, window);
      await spike.sleep(400);
      const item = VitreUI.bar.items.get(gBrowser.selectedTab);
      spike.log("Ctrl+L (Browser:OpenLocation -> openLocation override)", { pillEditing: item.classList.contains("editing"), activeElement: who() });
      EU.sendString("example.com", window);
      await spike.sleep(200);
      spike.log("typed into the pill", item.querySelector(".address-input").value);
      EU.synthesizeKey("KEY_Enter", {}, window);
      await vt.until(() => gBrowser.currentURI.spec.startsWith("https://example.com") || gBrowser.currentURI.spec.startsWith("http://example.com"), 12000);
      await vt.tabLoaded(gBrowser.selectedTab);
      spike.log("Enter ->", gBrowser.currentURI.spec, "| pill host", item.querySelector(".host").textContent, "| focus", who());
      await spike.capture("native-3-typed-url");
      EU.synthesizeKey("w", { accelKey: true }, window);
      await spike.sleep(700);
      spike.log("Ctrl+W", { tabs: gBrowser.tabs.length, barItems: VitreUI.bar.items.size });
    });

    // ---- ways to get script and CSS into browser.xhtml
    await step("injection", async () => {
      const HTML = VitreUI.HTML;
      const out = {};
      // 1. <script type="module" src="chrome://vitre/..."> appended to the chrome document
      window.__vitreProbe = null;
      const s = d.createElementNS(HTML, "script");
      s.type = "module";
      s.src = "chrome://vitre/content/probe.mjs";
      const loaded = new Promise((r) => {
        s.addEventListener("load", () => r("load"));
        s.addEventListener("error", () => r("error"));
      });
      d.documentElement.append(s);
      out.moduleScript = await Promise.race([loaded, spike.sleep(4000).then(() => "timeout")]);
      out.moduleScriptResult = window.__vitreProbe;
      // 2. dynamic import() from window scope
      try {
        const m = await import("chrome://vitre/content/probe2.mjs");
        out.dynamicImport = `${m.answer} (sees window: ${m.hasWindow()})`;
      } catch (e) {
        out.dynamicImport = "FAILED " + e;
      }
      // 3. ChromeUtils.importESModule into this window's global
      try {
        const m = ChromeUtils.importESModule("chrome://vitre/content/probe2.mjs", { global: "current" });
        out.importESModuleCurrent = `${m.answer} (sees window: ${m.hasWindow()})`;
      } catch (e) {
        out.importESModuleCurrent = "FAILED " + String(e).slice(0, 160);
      }
      // 4. inline <script> (the document's CSP is script-src chrome: moz-src: resource:)
      window.__vitreInline = false;
      const inl = d.createElementNS(HTML, "script");
      inl.textContent = "window.__vitreInline = true;";
      d.documentElement.append(inl);
      out.inlineScript = window.__vitreInline;
      // 5. innerHTML on an HTML element in the chrome document (sanitized?)
      const box = d.createElementNS(HTML, "div");
      box.innerHTML = '<span onclick="1" style="color:red" class="a">x</span><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><path d="M0 0h4"/></svg><script>1</script>';
      out.innerHTML = { kept: box.innerHTML.slice(0, 200), spanNS: box.firstChild?.namespaceURI === HTML, svg: !!box.querySelector("svg"), onclick: box.firstChild?.hasAttribute?.("onclick"), script: !!box.querySelector("script") };
      // 6. stylesheets
      const probe = d.createElementNS(HTML, "div");
      probe.id = "vitre-css-probe";
      VitreUI.root.append(probe);
      const z = () => getComputedStyle(probe).zIndex;
      const link = d.createElementNS(HTML, "link");
      link.rel = "stylesheet";
      link.href = "chrome://vitre/content/probe.css";
      const linkLoaded = new Promise((r) => {
        link.addEventListener("load", () => r("load"));
        link.addEventListener("error", () => r("error"));
      });
      d.head.append(link);
      out.linkSync = z();
      out.link = `${await Promise.race([linkLoaded, spike.sleep(3000).then(() => "timeout")])} z=${z()}`;
      link.remove();
      const pi = d.createProcessingInstruction("xml-stylesheet", 'href="chrome://vitre/content/probe.css" type="text/css"');
      d.insertBefore(pi, d.documentElement);
      await spike.sleep(500);
      out.processingInstruction = `z=${z()}`;
      pi.remove();
      await spike.sleep(100);
      window.windowUtils.loadSheetUsingURIString("chrome://vitre/content/probe.css", window.windowUtils.AUTHOR_SHEET);
      out.loadSheetSync = `z=${z()}`;
      window.windowUtils.removeSheetUsingURIString("chrome://vitre/content/probe.css", window.windowUtils.AUTHOR_SHEET);
      out.afterRemoveSheet = `z=${z()}`;
      const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
      const uri = Services.io.newURI("chrome://vitre/content/probe.css");
      sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
      out.styleSheetService = `z=${z()} registered=${sss.sheetRegistered(uri, sss.AUTHOR_SHEET)}`;
      sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
      probe.remove();
      spike.log("injection", out);
    });

    spike.log("timeline", shell.timeline);
  });
}
