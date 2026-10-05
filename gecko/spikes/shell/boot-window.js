// Spike 2: layering, hit-testing, drag region, window controls, resize borders, maximized state.
//   python tools/run.py --boot spikes/shell/boot-window.js --name shell-window --out spikes/shell/out
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(500);
    const d = document;
    const title = () => gBrowser.selectedTab.label;
    const W = window.innerWidth;
    const H = window.innerHeight;

    // --- z-order: what does the chrome document itself hit at these points?
    const at = (x, y) => {
      const e = d.elementFromPoint(x, y);
      return e ? e.id || e.className || e.localName : null;
    };
    const pill = VitreUI.bar.layout.pillRect;
    const plus = vt.center(VitreUI.bar.plus);
    const max = vt.center(d.getElementById("vitre-win-max"));
    const min = vt.center(d.getElementById("vitre-win-min"));
    const close = vt.center(d.getElementById("vitre-win-close"));
    spike.log("elementFromPoint", {
      stripLeft: at(100, 30),
      pill: at(pill.x + pill.width / 2, 34),
      plus: at(...plus),
      betweenBarAndControls: at(1000, 34),
      max: at(...max),
      dragStrip: at(600, 4),
      page: at(600, 400),
    });

    // --- clicks: bar strip outside the items must reach the page; items must not.
    await vt.click(100, 30);
    spike.log("click strip-left (100,30) ->", title());
    await vt.click(1000, 34);
    spike.log("click between bar and controls (1000,34) ->", title());
    await vt.click(pill.x - 12, 34);
    spike.log("click 12px left of the pill ->", title());
    await vt.click(600, 400);
    spike.log("click page centre ->", title());
    const before = title();
    const tabsBefore = gBrowser.tabs.length;
    await vt.click(...plus, { wait: 600 });
    spike.log("click plus -> tabs", tabsBefore, "->", gBrowser.tabs.length, "| page title unchanged:", gBrowser.tabs[0].label === before);
    // back to the first tab by clicking its circle
    const circle = VitreUI.bar.items.get(gBrowser.tabs[0]);
    await vt.click(...vt.center(circle), { wait: 400 });
    spike.log("click circle -> selected index", gBrowser.tabs.indexOf(gBrowser.selectedTab));
    // hover the other circle to show its close badge, then click the badge
    const other = VitreUI.bar.items.get(gBrowser.tabs[1]);
    await vt.move(...vt.center(other));
    const badge = other.querySelector(".close-badge");
    spike.log("hover circle -> close badge opacity", getComputedStyle(badge).opacity, "pointer-events", getComputedStyle(badge).pointerEvents);
    await spike.sleep(300);
    await spike.capture("window-1-hover-close");
    await vt.click(...vt.center(badge), { wait: 500 });
    spike.log("click close badge -> tabs", gBrowser.tabs.length);
    await vt.move(600, 500);

    // --- what Windows is told about each point (WM_NCHITTEST)
    const col = (x, ys) => ys.map((y) => `${y}:${vt.hit(x, y)}`).join(" ");
    spike.log("NCHITTEST x=600 by y", col(600, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 34, 60, 100]));
    spike.log("NCHITTEST on pill", vt.hit(pill.x + 100, 34), "| on plus", vt.hit(...plus), "| strip-left y=30", vt.hit(100, 30));
    spike.log("NCHITTEST window buttons", { min: vt.hit(...min), max: vt.hit(...max), close: vt.hit(...close), capsuleGap: vt.hit(W - 8, 34) });
    spike.log("NCHITTEST edges", {
      left: vt.hit(0, 400), leftIn: vt.hit(3, 400), leftOut: vt.hit(-3, 400),
      right: vt.hit(W - 1, 400), rightOut: vt.hit(W + 3, 400),
      bottom: vt.hit(600, H - 1), bottomOut: vt.hit(600, H + 3),
      topLeft: vt.hit(0, 0), topRight: vt.hit(W - 1, 0), bottomRightOut: vt.hit(W + 3, H + 3),
      middle: vt.hit(600, 400),
    });
    await spike.capture("window-2-normal");

    // --- window controls
    const state = () => ({ windowState: window.windowState, sizemode: d.documentElement.getAttribute("sizemode"), inner: [window.innerWidth, window.innerHeight], outer: [window.outerWidth, window.outerHeight], screen: [screen.availWidth, screen.availHeight] });
    await vt.click(...max, { wait: 900 });
    spike.log("after clicking maximize", state(), "button label", d.getElementById("vitre-win-max").getAttribute("aria-label"));
    spike.log("maximized NCHITTEST x=600 by y", col(600, [0, 1, 2, 4, 7, 8, 9, 12, 34]), "| max button", vt.hit(...vt.center(d.getElementById("vitre-win-max"))), "| right edge", vt.hit(window.innerWidth - 1, 400));
    spike.log("maximized rects", { winctl: vt.rect(d.getElementById("vitre-winctl")), bar: vt.barState().layout, browser: vt.rect(gBrowser.selectedBrowser) });
    await spike.capture("window-3-maximized");
    await vt.click(...vt.center(d.getElementById("vitre-win-max")), { wait: 900 });
    spike.log("after clicking restore", state(), "button label", d.getElementById("vitre-win-max").getAttribute("aria-label"));

    await vt.click(...vt.center(d.getElementById("vitre-win-min")), { wait: 900 });
    spike.log("after clicking minimize", { windowState: window.windowState, minimized: window.windowState === window.STATE_MINIMIZED });
    window.restore();
    await spike.sleep(700);
    spike.log("after restore()", state());

    // --- keyboard into the pill (HTML input inside the XUL document)
    VitreUI.bar.editAddress();
    await spike.sleep(200);
    const input = VitreUI.bar.items.get(gBrowser.selectedTab).querySelector(".address-input");
    spike.log("pill edit", { focused: d.activeElement === input, value: input.value.slice(0, 60), editable: !input.readOnly });
    await spike.capture("window-4-pill-editing");
    input.value = "https://example.com/";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vt.until(() => gBrowser.currentURI.spec === "https://example.com/", 15000);
    await vt.tabLoaded(gBrowser.selectedTab);
    spike.log("pill navigate ->", gBrowser.currentURI.spec, "| bar host", vt.barState().items[0].host, "| canGoBack", gBrowser.canGoBack);
    await spike.capture("window-5-navigated");

    // --- close button: goes through Firefox's own close path (with one window this quits)
    spike.log("close button wired to BrowserCommands.tryToCloseWindow:", typeof BrowserCommands.tryToCloseWindow);
  });
}
