// VERIFY (claims 8, 11, 12, 25): the things the spike could not show because they need a REAL pointer.
// Uses the real cursor (SetCursorPos + mouse_event), guarded: the window is made topmost, a button
// is pressed only while this window is under the cursor, and the cursor is put back at the end.
//   python spikes/shell/verify/run_screen.py --boot spikes/shell/verify/boot-v-native.js --name shell-verify-p-native --timeout 120
// Captures are SCREEN grabs of the window rectangle (run_screen.py), so shell flyouts are visible.
/* global spike, vt, vv, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const only = Services.prefs.getStringPref("vitre.verify.only", "");
    const want = (n) => !only || only.split(",").includes(n);
    await spike.resize(1280, 800);
    vt.install();
    const d = document;
    const root = d.documentElement;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(500);
    const hwnd = vv.hptr();
    const btn = (id) => d.getElementById(id);
    const info = (id) => ({ hover: btn(id).matches(":hover"), bg: getComputedStyle(btn(id)).backgroundColor });
    const step = async (name, fn) => {
      if (!want(name)) return;
      try {
        if (vv.userBusy()) throw new Error("a real mouse button is held by the user; skipping");
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e));
        vv.up();
      }
    };
    const modes = [];
    window.addEventListener("sizemodechange", () => modes.push(root.getAttribute("sizemode")));

    vv.saveCursor();
    vv.topmost(true);
    await spike.sleep(300);
    spike.log("start", { cursor: vv.cursor(), active: Services.focus.activeWindow === window, foreground: vv.foreground(), dpr: devicePixelRatio, origin: [mozInnerScreenX, mozInnerScreenY] });
    try {
      // ---- claim 12 + 11: hover the caption buttons with the real cursor; snap-layouts flyout on maximize
      await step("hover", async () => {
        await vv.moveTo(600, 400);
        await vv.moveTo(...vt.center(btn("vitre-win-max")));
        spike.log("cursor over maximize", { mine: vv.mine(), nchittest: vt.hit(...vt.center(btn("vitre-win-max"))) });
        await spike.sleep(400);
        spike.log("real hover on maximize after 0.4 s", info("vitre-win-max"));
        await spike.sleep(1800);
        spike.log("real hover on maximize after 2.2 s", info("vitre-win-max"));
        await spike.capture("vnative-1-hover-max");
        await vv.moveTo(...vt.center(btn("vitre-win-close")));
        await spike.sleep(500);
        spike.log("real hover on close", info("vitre-win-close"), "| maximize now", info("vitre-win-max"));
        await spike.capture("vnative-2-hover-close");
        await vv.moveTo(...vt.center(btn("vitre-win-min")));
        await spike.sleep(500);
        spike.log("real hover on minimize", info("vitre-win-min"));
        // a bar item for comparison (client area)
        await vv.moveTo(...vt.center(VitreUI.bar.plus));
        await spike.sleep(400);
        spike.log("real hover on + circle", { hover: VitreUI.bar.plus.matches(":hover") });
        await vv.moveTo(600, 400);
        await spike.sleep(400);
        spike.log("cursor back on the page", { max: info("vitre-win-max").hover, close: info("vitre-win-close").hover, min: info("vitre-win-min").hover });
      });

      // ---- real clicks: page under the bar strip, bar items, caption buttons
      await step("clicks", async () => {
        await vv.click(300, 40);
        spike.log("real click at (300,40), beside the pill ->", gBrowser.selectedTab.label);
        await vv.click(1000, 30);
        spike.log("real click at (1000,30), between bar and controls ->", gBrowser.selectedTab.label);
        const n = gBrowser.tabs.length;
        await vv.click(...vt.center(VitreUI.bar.plus));
        await spike.sleep(500);
        spike.log("real click on + ->", `tabs ${n} -> ${gBrowser.tabs.length}`);
        if (gBrowser.tabs.length > n) gBrowser.removeTab(gBrowser.selectedTab, { animate: false });
        await spike.sleep(300);
        modes.length = 0;
        await vv.click(...vt.center(btn("vitre-win-max")));
        await spike.sleep(900);
        spike.log("real click on maximize ->", root.getAttribute("sizemode"), "| sizemode changes:", modes.join(","));
        modes.length = 0;
        await vv.click(...vt.center(btn("vitre-win-max")));
        await spike.sleep(900);
        spike.log("real click on restore ->", root.getAttribute("sizemode"), "| sizemode changes:", modes.join(","), "| outer", [outerWidth, outerHeight]);
      });

      // ---- claim 8: a real mouse drag on the drag strip moves the window
      await step("drag", async () => {
        if (window.windowState === window.STATE_MAXIMIZED) {
          window.restore();
          await spike.sleep(800);
        }
        const before = [screenX, screenY];
        const [sx, sy] = vv.screen(150, 13);
        await vv.moveTo(150, 13);
        spike.log("on the strip", { mine: vv.mine(), nchittest: vt.hit(150, 13) });
        vv.down();
        await spike.sleep(120);
        for (let i = 1; i <= 14; i++) {
          // absolute screen positions: the window moves under the cursor
          const dpr = devicePixelRatio;
          await vv.moveTo((sx + i * 10) / dpr - mozInnerScreenX, (sy + i * 6) / dpr - mozInnerScreenY, window, 30);
        }
        await spike.sleep(150);
        const during = [screenX, screenY];
        vv.up();
        await spike.sleep(500);
        spike.log("real drag on the strip (+140,+84)", { before, during, after: [screenX, screenY], moved: [screenX - before[0], screenY - before[1]], sizemode: root.getAttribute("sizemode") });
        await spike.capture("vnative-3-after-strip-drag");
      });

      // ---- claim 25: start a window move from script (drag the pill itself)
      await step("pilldrag", async () => {
        const item = VitreUI.bar.items.get(gBrowser.selectedTab);
        const addr = item.querySelector(".address");
        const seen = [];
        let press = null;
        let started = 0;
        addr.addEventListener("mousedown", (e) => {
          if (e.button === 0) press = [e.screenX, e.screenY];
          seen.push("mousedown");
        });
        window.addEventListener(
          "mousemove",
          (e) => {
            if (!press || Math.hypot(e.screenX - press[0], e.screenY - press[1]) < 5) return;
            press = null;
            started++;
            seen.push("-> begin native move");
            // The classic borderless-window move: give up Gecko's mouse capture, then ask Windows
            // to run its own move loop as if the caption had been grabbed (SC_MOVE | HTCAPTION).
            const mode = Services.prefs.getStringPref("vitre.verify.pillmode", "sys-post");
            const lp = ((e.screenY * devicePixelRatio) & 0xffff) << 16 | ((e.screenX * devicePixelRatio) & 0xffff);
            const go = () => {
              const rc = vv.ReleaseCapture();
              let r;
              if (mode === "sys-post") r = vv.PostMessageW(hwnd, 0x0112, 0xf012, lp); // WM_SYSCOMMAND SC_MOVE|HTCAPTION
              else if (mode === "nc-post") r = vv.PostMessageW(hwnd, 0x00a1, 2, lp); // WM_NCLBUTTONDOWN HTCAPTION
              else if (mode === "nc-send") r = vv.SendMessageW(hwnd, 0x00a1, 2, lp);
              else if (mode === "sys-send") r = vv.SendMessageW(hwnd, 0x0112, 0xf012, lp);
              seen.push(`(${mode} releaseCapture=${rc} result=${r})`);
            };
            if (mode.endsWith("-send")) setTimeout(go, 0); // never run a modal loop inside a DOM event
            else go();
          },
          true
        );
        window.addEventListener("mouseup", () => { press = null; seen.push("mouseup"); }, true);
        addr.addEventListener("click", () => seen.push("click"), true);

        spike.log("activate", await vv.activate(), { foreground: vv.foreground() });
        const before = [screenX, screenY];
        const [cx, cy] = vt.center(addr);
        const [sx, sy] = vv.screen(cx, cy);
        await vv.moveTo(cx, cy);
        spike.log("on the pill", { mine: vv.mine(), nchittest: vt.hit(cx, cy) });
        vv.down();
        await spike.sleep(120);
        for (let i = 1; i <= 14; i++) {
          const dpr = devicePixelRatio;
          await vv.moveTo((sx - i * 8) / dpr - mozInnerScreenX, (sy + i * 7) / dpr - mozInnerScreenY, window, 30);
        }
        await spike.sleep(150);
        const during = [screenX, screenY];
        vv.up();
        await spike.sleep(600);
        spike.log("script-started move from the pill (-112,+98)", { started, before, during, after: [screenX, screenY], moved: [screenX - before[0], screenY - before[1]], dom: seen.join(" "), editing: item.classList.contains("editing"), active: addr.matches(":active") });
        await spike.capture("vnative-4-after-pill-drag");
        // the pill still works as a button afterwards: a plain click enters edit mode
        seen.length = 0;
        await vv.click(...vt.center(addr));
        await spike.sleep(300);
        spike.log("plain real click on the pill afterwards", { dom: seen.join(" "), editing: item.classList.contains("editing"), moved: [screenX - before[0], screenY - before[1]] });
        VitreUI.bar.endEdit(item);
        // and a move that ends at the top edge of the screen: Aero Snap maximizes
        if (Services.prefs.getBoolPref("vitre.verify.snap", true)) {
          const [c2x, c2y] = vt.center(addr);
          const [s2x] = vv.screen(c2x, c2y);
          await vv.moveTo(c2x, c2y);
          vv.down();
          await spike.sleep(120);
          const [, startY] = vv.screen(c2x, c2y);
          for (let i = 1; i <= 12; i++) {
            const dpr = devicePixelRatio;
            const y = Math.round(startY * (1 - i / 12)); // to screen y 0
            await vv.moveTo(s2x / dpr - mozInnerScreenX, y / dpr - mozInnerScreenY, window, 35);
          }
          await spike.sleep(500);
          vv.up();
          await spike.sleep(900);
          spike.log("pill dragged to the top edge of the screen ->", { sizemode: root.getAttribute("sizemode"), windowState: window.windowState });
          if (window.windowState === window.STATE_MAXIMIZED) window.restore();
          await spike.sleep(600);
        }
      });
      // ---- the same script-started move from a MAXIMIZED window: Windows restores and drags it
      await step("pillmax", async () => {
        const item = VitreUI.bar.items.get(gBrowser.selectedTab);
        const addr = item.querySelector(".address");
        let press = null;
        addr.addEventListener("mousedown", (e) => { if (e.button === 0) press = [e.screenX, e.screenY]; });
        window.addEventListener("mousemove", (e) => {
          if (!press || Math.hypot(e.screenX - press[0], e.screenY - press[1]) < 5) return;
          press = null;
          vv.ReleaseCapture();
          vv.PostMessageW(hwnd, 0x00a1, 2, ((e.screenY * devicePixelRatio) & 0xffff) << 16 | ((e.screenX * devicePixelRatio) & 0xffff));
        }, true);
        await vv.activate();
        window.maximize();
        await spike.sleep(1200);
        const before = { sizemode: root.getAttribute("sizemode"), pos: [screenX, screenY], outer: [outerWidth, outerHeight] };
        const [cx, cy] = vt.center(addr);
        const [sx, sy] = vv.screen(cx, cy);
        await vv.moveTo(cx, cy);
        vv.down();
        await spike.sleep(120);
        for (let i = 1; i <= 14; i++) {
          const dpr = devicePixelRatio;
          await vv.moveTo((sx + i * 6) / dpr - mozInnerScreenX, (sy + i * 12) / dpr - mozInnerScreenY, window, 30);
        }
        await spike.sleep(300);
        const during = { sizemode: root.getAttribute("sizemode"), pos: [screenX, screenY], outer: [outerWidth, outerHeight] };
        vv.up();
        await spike.sleep(700);
        spike.log("pill dragged down from a maximized window", { before, during, after: { sizemode: root.getAttribute("sizemode"), pos: [screenX, screenY], outer: [outerWidth, outerHeight] } });
        await spike.capture("vnative-5-after-maximized-pill-drag");
      });

      // ---- real wheel: over the page, over the bar strip beside the pill, over the drag strip, over the pill
      await step("wheel", async () => {
        if (window.windowState === window.STATE_MAXIMIZED) window.restore();
        await spike.resize(1280, 800);
        await vv.activate();
        gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("scroll.html"), { triggeringPrincipal: sys });
        await vt.until(() => gBrowser.currentURI.spec.endsWith("scroll.html"), 8000);
        await vt.tabLoaded(gBrowser.selectedTab);
        await spike.sleep(600);
        const at = async (label, x, y) => {
          const before = gBrowser.selectedTab.label;
          await vv.moveTo(x, y);
          await spike.sleep(150);
          if (!vv.mine()) throw new Error("not over this window");
          vv.wheel(-3);
          await spike.sleep(900);
          spike.log(`real wheel down ${label} (${x},${y})`, { nchittest: vt.hit(x, y), page: `${before} -> ${gBrowser.selectedTab.label}` });
        };
        await at("over the page", 600, 400);
        await at("beside the pill, inside the bar strip", 200, 40);
        await at("on the drag strip", 200, 12);
        await at("on the pill", ...vt.center(VitreUI.bar.items.get(gBrowser.selectedTab)));
        await at("on the window controls", ...vt.center(btn("vitre-win-max")));
      });
    } finally {
      vv.up();
      vv.topmost(false);
      vv.restoreCursor();
    }
    spike.log("end", { cursor: vv.cursor(), sizemode: root.getAttribute("sizemode") });
  });
}
