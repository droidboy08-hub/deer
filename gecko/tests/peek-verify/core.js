// Peek verification: the core around the sheet. The auto-hidden bar stays on screen while a sheet is
// up (DESIGN-NOTES "Sheet", PeekMotion), F11 full screen in and out with a sheet open, the address
// field over a sheet (Enter navigates the tab under it, Shift+Enter hops), a zoomed source page (grow
// and wash geometry), the source tab closed or torn off into a window while its peek is open, tab
// keys while a peek is open.   python tests/peek-verify/all.py core
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(500);
  const src = b.active();
  const settings = b.sys("VitreSettings");
  const barShown = () => !b.bar.hidden;

  await V.section("auto-hide bar", async () => {
    settings.set({ barAutoHide: true });
    await sleep(300);
    P.move(700, 500);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the bar to hide" });
    check("with auto-hide on and the pointer on the page, the bar is hidden", b.bar.hidden);
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    P.move(700, 600);
    await sleep(1500);
    check("while a peek is open the bar stays on screen above the dim (it does not auto-hide)", barShown() && peek().isOpen(), { hidden: b.bar.hidden });
    await spike.capture("core-1-autohide-peek");
    P.press("Escape");
    await P.waitClosed();
    P.move(700, 520);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the bar to hide again" });
    check("after the peek closed the bar hides again", b.bar.hidden);
    await P.shiftClick("#i38");
    await P.waitOpen("n=38");
    check("open again: the bar is back", barShown());
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.tabs.length === 2, { what: "promote" });
    await sleep(200);
    check("during and right after Open as tab the bar is on screen (the new pill rises into it)", barShown());
    P.move(700, 520);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the bar to hide after promote" });
    check("then it auto-hides as usual", b.bar.hidden);
    settings.set({ barAutoHide: false });
    await sleep(300);
  });

  await V.section("F11 full screen", async () => {
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    b.run("fullscreen");
    await waitFor(() => window.fullScreen && b.root.classList.contains("fullscreen"), { timeout: 6000, what: "F11 full screen" });
    await sleep(1200);
    const area = gBrowser.tabpanels.getBoundingClientRect();
    const s = P.sheet();
    const W = area.width;
    const w = W < 900 || area.height < 600 ? W - 16 : Math.min(1120, Math.max(720, Math.round((W * 0.72) / 8) * 8));
    log("F11", { area: P.R(area), sheet: s.chrome, inner: [window.innerWidth, window.innerHeight] });
    check("in F11 the sheet is laid out for the full-screen window", peek().isOpen() && s.chrome && P.near(s.chrome.w, w) && P.near(s.chrome.y, area.top + 72) && P.near(s.chrome.h, area.height - 96), { chrome: s.chrome, w });
    check("and the bar is held on screen above it", barShown());
    await spike.capture("core-2-f11");
    b.run("fullscreen");
    await waitFor(() => !window.fullScreen && !b.root.classList.contains("fullscreen"), { timeout: 6000, what: "leaving F11" });
    await sleep(1200);
    const s2 = P.sheet();
    check("leaving F11 the sheet goes back to the window's size (1040×804 at 200,72)", peek().isOpen() && s2.chrome && s2.chrome.x === 200 && s2.chrome.y === 72 && s2.chrome.w === 1040 && s2.chrome.h === 804 && s2.browser.y === 116, s2.chrome);
  });

  await V.section("address field over a peek", async () => {
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    b.editAddress("");
    await sleep(300);
    spike.type(P.page("issue.html?n=24"));
    await sleep(200);
    P.press("Shift+Enter");
    await waitFor(() => peek().isOpen() && br.currentURI.spec.includes("n=24") && !br.webProgress.isLoadingDocument, { what: "Shift+Enter over the peek" });
    await sleep(500);
    check("Shift+Enter in the address field over an open peek shows the address in the same sheet", peek().browser() === br && b.tabs.length === 1 && !b.omni.open && V.hidden() === 1);
    check("focus is in the sheet's page after the field closed", document.activeElement === br, document.activeElement?.localName);
    b.editAddress("");
    await sleep(300);
    spike.type(P.page("issue.html?n=27"));
    await sleep(200);
    P.press("Enter");
    await waitFor(() => src.url.includes("n=27") && !src.loading, { what: "the tab under the peek navigating" });
    await sleep(600);
    check("Enter in the field navigates the tab under the peek, which closes the peek", !peek().isOpen() && !P.sheet().shown && !P.sheet().dimOn && src.url.includes("n=27"));
    check("focus is in the tab's page", document.activeElement === src.browser, document.activeElement?.localName);
    await P.load(P.page("issues.html"), src);
  });

  await V.section("zoomed source page", async () => {
    b.run("zoomIn");
    b.run("zoomIn");
    await waitFor(() => src.zoom > 1.15, { what: "zoom" });
    await sleep(600);
    const link = await P.rectOf(src.browser, "#i38");
    await P.shiftClick("#i38");
    await P.waitOpen("n=38");
    check("a peek opens from a zoomed page; the sheet is the usual size", P.sheet().chrome.w === 1040);
    const tok = src.zoom;
    P.mouse(100, 870);
    await P.waitClosed();
    const wash = gBrowser.tabpanels.querySelector(":scope > .vitre-peek-wash");
    const wr = wash && P.R(wash.getBoundingClientRect());
    const row = await P.inContent(src.browser, (w) => {
      const r = w.document.getElementById("i38").closest('[role="listitem"]').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const z = src.browser.fullZoom;
    const br = src.browser.getBoundingClientRect();
    const exp = { x: Math.round(br.left + row.x * z), y: Math.round(br.top + row.y * z), w: Math.round(row.w * z), h: Math.round(row.h * z) };
    log("zoom", tok, "link", P.R(link), "wash", wr, "expected", exp);
    check("on a zoomed page the wash lands on the link's row (zoom applied)", wr && P.near(wr.x, exp.x, 3) && P.near(wr.y, exp.y, 3) && P.near(wr.w, exp.w, 4) && P.near(wr.h, exp.h, 3), { wr, exp });
    b.run("zoomReset");
    await waitFor(() => src.zoom === 1, { what: "zoom reset" });
  });

  await V.section("pinned source tab", async () => {
    const other = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !other.loading, { what: "second tab" });
    gBrowser.pinTab(src.node);
    await sleep(500);
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.active()?.browser === br, { what: "promote from a pinned tab" });
    await sleep(600);
    const order = b.tabs.map((t) => (t === src ? "src" : t.browser === br ? "new" : "other"));
    check("Open as tab from a pinned tab: the new tab is the first after the pinned ones, active", order.join(",") === "src,new,other" && !gBrowser.getTabForBrowser(br).pinned, order);
    gBrowser.unpinTab(src.node);
    await sleep(300);
  });

  await V.section("source tab closed under its peek", async () => {
    const other = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !other.loading, { what: "second tab" });
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    const id = br.browserId;
    b.closeTab(src);
    await waitFor(() => b.tabs.length === 1, { what: "the source tab closed" });
    await sleep(800);
    check("closing the tab under an open peek closes the peek with it: no sheet, no hidden tab", !peek().isOpen() && !P.sheet().shown && !P.sheet().dimOn && V.hidden() === 0, V.phase());
    check("its browser left the inset switch list", !V.insetOff().includes(id), V.insetOff());
    check("the peek did not enter the closed-tab list", !P.tabsInfo().closed.some((u) => /n=39/.test(String(u))), P.tabsInfo().closed);
    // Bring the issues page back as the only tab for the next sections.
    await P.load(P.page("issues.html"), b.active());
  });

  await V.section("source tab torn off into a window", async () => {
    const tab = b.active();
    const other = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !other.loading, { what: "second tab" });
    await P.shiftClick("#i41");
    const br = await P.waitOpen("n=41");
    const id = br.browserId;
    const before = [...Services.wm.getEnumerator("navigator:browser")].length;
    b.moveToNewWindow(tab);
    await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")].length === before + 1, { what: "the new window" });
    await sleep(1500);
    check("tearing the source tab off closes its peek here: no sheet, no hidden tab left in this window", !peek().isOpen() && !P.sheet().shown && V.hidden() === 0, V.phase());
    check("its browser left the inset switch list", !V.insetOff().includes(id), V.insetOff());
    for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window) w.close();
    await sleep(600);
    await spike.activate();
    await P.load(P.page("issues.html"), b.active());
  });

  await V.section("tab keys while a peek is open", async () => {
    // (The first tab was closed above: the source here is whatever tab is active now.)
    const src = b.active();
    const other = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !other.loading, { what: "second tab" });
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    await P.focusPeek();
    // (Ctrl+Tab belongs to the switcher module; Ctrl+Page Down is the plain next-tab key.)
    P.press("Ctrl+PageDown");
    await sleep(700);
    check("Ctrl+Page Down moves to the next tab: the peek warm-closes", !peek().isOpen() && b.active() !== src && !P.sheet().dimOn, { active: b.active()?.url });
    check("the warm peek is still a hidden tab, asleep and muted", V.hidden() === 1 && !br.docShellIsActive, { hidden: V.hidden(), active: br.docShellIsActive });
    check("keyboard focus went to the new tab's page, not the hidden peek's", document.activeElement === b.active().browser && Services.focus.focusedContentBrowsingContext !== br.browsingContext, { active: document.activeElement === br ? "the hidden peek" : document.activeElement?.localName });
    P.press("Ctrl+1");
    await waitFor(() => b.active() === src, { what: "Ctrl+1" });
    await sleep(600);
    check("Ctrl+1 back to the source: no sheet comes back by itself", b.active() === src && !peek().isOpen());
    P.press("Ctrl+Shift+T");
    await P.waitOpen("n=39");
    check("Ctrl+Shift+T brings it back", peek().browser() === br);
    P.press("Ctrl+T");
    await sleep(800);
    check("Ctrl+T opens a new tab and warm-closes the peek", !peek().isOpen() && b.tabs.length === 3, b.tabs.length);
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
