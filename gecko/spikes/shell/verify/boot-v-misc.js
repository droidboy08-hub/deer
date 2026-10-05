// VERIFY: recipe details an implementer would trip on.
//   1. category entry order: which Firefox consumers run BEFORE and AFTER Vitre's hooks
//   2. middle-click close (coded in bar.js, never exercised by the spike)
//   3. is gReduceMotionOverride needed? Ctrl+W path timing with and without it
//   4. HTML title tooltips on the bar's buttons (XUL documents need tooltip="aHTMLTooltip")
//   5. backdrop-filter over the remote browser: does the "frost stand-in" blur the page at all?
//   python tools/run.py --boot spikes/shell/verify/boot-v-misc.js --name shell-verify-u-misc --timeout 150 --out spikes/shell/verify/out
/* global spike, vt, vv, Services, gBrowser, VitreUI, BrowserCommands */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const d = document;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        spike.log(`STEP ${name} FAILED`, String(e), e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : "");
      }
    };

    // ---- 1. category order
    await step("order", async () => {
      for (const cat of ["browser-window-before-initial-xul-layout", "browser-window-domcontentloaded", "browser-window-delayed-startup"]) {
        const entries = [...Services.catMan.enumerateCategory(cat)].map((e) => `${e.data.replace(/^.*\//, "")}:${e.value}`);
        const i = entries.findIndex((e) => e.includes("VitreShell"));
        spike.log(cat, { total: entries.length, vitreIndex: i, before: entries.slice(0, i), after: entries.slice(i + 1) });
      }
    });

    // ---- 2. middle click on a circle closes that tab
    await step("middle click", async () => {
      const t2 = await vt.openTab("https://example.com/", { select: false });
      const item = VitreUI.bar.items.get(t2);
      const n = gBrowser.tabs.length;
      VitreUI.bar.events.length = 0;
      await vt.click(...vt.center(item), { button: 1, wait: 600 });
      spike.log("middle click on a background circle", { tabs: `${n} -> ${gBrowser.tabs.length}`, selectedStill0: gBrowser.selectedTab === gBrowser.tabs[0], events: VitreUI.bar.events.join(" ") });
      // and on the active pill
      const t3 = await vt.openTab("https://example.com/", { select: true });
      const n2 = gBrowser.tabs.length;
      const pill = VitreUI.bar.items.get(t3);
      const r = pill.getBoundingClientRect();
      await vt.click(r.left + r.width / 2, r.top + r.height / 2, { button: 1, wait: 600 });
      spike.log("middle click on the active pill", { tabs: `${n2} -> ${gBrowser.tabs.length}` });
    });

    // ---- 3. reduce motion override
    await step("motion", async () => {
      const time = async (label) => {
        const t = await vt.openTab("https://example.com/", { select: true });
        await spike.sleep(300);
        const n = gBrowser.tabs.length;
        const t0 = performance.now();
        let closeEvent = null;
        gBrowser.tabContainer.addEventListener("TabClose", () => (closeEvent = Math.round(performance.now() - t0)), { once: true });
        BrowserCommands.closeTabOrWindow();
        const sync = gBrowser.tabs.length;
        await vt.until(() => gBrowser.tabs.length < n, 6000, 10);
        spike.log(label, { gReduceMotionOverride: window.gReduceMotionOverride, tabsRightAfterCall: `${n} -> ${sync}`, tabCloseEventMs: closeEvent, removedFromGBrowserAfterMs: Math.round(performance.now() - t0), closingAttr: t.closing });
      };
      await time("Ctrl+W path WITH override (shipped)");
      window.gReduceMotionOverride = undefined;
      await time("Ctrl+W path WITHOUT override");
      window.gReduceMotionOverride = true;
    });

    // ---- 4. tooltips for title="" on HTML buttons in the XUL document
    await step("tooltip", async () => {
      const tip = d.getElementById("aHTMLTooltip");
      const hover = async () => {
        await vt.move(600, 400);
        await spike.sleep(200);
        const [x, y] = vt.center(VitreUI.bar.plus);
        vt.mouse("mousemove", x, y);
        await spike.sleep(60);
        vt.mouse("mousemove", x + 1, y);
        const shown = await vt.until(() => tip.state === "open", 2500);
        const r = { state: tip.state, label: tip.getAttribute("label") || tip.textContent || null };
        if (shown) tip.hidePopup();
        await vt.move(600, 400);
        return r;
      };
      spike.log("tooltip exists", !!tip, "| vitre-root tooltip attr", VitreUI.root.getAttribute("tooltip"));
      spike.log("hover + (title='New tab  Ctrl+T') as shipped ->", await hover());
      VitreUI.root.setAttribute("tooltip", "aHTMLTooltip");
      spike.log("hover + with tooltip='aHTMLTooltip' on #vitre-root ->", await hover());
    });

    // ---- 5. backdrop-filter over the remote browser
    await step("backdrop", async () => {
      gBrowser.selectedTab = gBrowser.tabs[0];
      await spike.sleep(600);
      const lens = VitreUI.bar.items.get(gBrowser.selectedTab).querySelector(".lens");
      spike.log("lens computed backdrop-filter", getComputedStyle(lens).backdropFilter);
      await spike.capture("vmisc-1-backdrop-shipped");
      // remove tint and rim so only the backdrop-filter is left: the pill must still be visible if it filters anything
      const style = d.createElementNS(VitreUI.HTML, "style");
      style.textContent = "#vitre-root .glass > .tint, #vitre-root .glass > .rim { display:none !important } #vitre-root .glass { box-shadow:none !important } #vitre-root .glass > .lens { backdrop-filter: blur(22px) invert(1) !important }";
      VitreUI.root.append(style);
      await spike.sleep(500);
      await spike.capture("vmisc-2-backdrop-invert-only");
      // the same filter over chrome-drawn content, as a control
      const bg = d.createElementNS(VitreUI.HTML, "div");
      bg.style.cssText = "position:fixed; left:0; top:0; width:100%; height:68px; z-index:9; pointer-events:none; background:repeating-linear-gradient(90deg,#0a5 0 40px,#fd0 40px 80px);";
      d.body.insertBefore(bg, VitreUI.root);
      await spike.sleep(500);
      await spike.capture("vmisc-3-backdrop-invert-over-chrome-content");
      bg.remove();
      style.remove();
    });
  });
}
