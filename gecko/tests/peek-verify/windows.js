// Peek verification: other windows. A peek in a second window is that window's alone; closing a
// window with a peek open leaves nothing behind (inset switch list, hidden tabs) and reopening that
// window (Ctrl+Shift+T / undoCloseWindow) brings back no orphan peek; a private window's peek and
// its close; a popup window has no peeks and nothing breaks there.
//   python tests/peek-verify/all.py windows
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(500);
  const wins = () => [...Services.wm.getEnumerator("navigator:browser")];

  /** A second window on the issues page, ready, active. */
  async function second(opts = {}) {
    const win = await spike.openWindow(opts);
    await sleep(500);
    const t = win.vitre.active();
    win.vitre.navigate(t, P.page("issues.html"));
    await waitFor(() => t.url.endsWith("issues.html") && !t.loading, { timeout: 15000, what: "issues in the new window" });
    await sleep(500);
    await win.spike.activate();
    return win;
  }

  await V.section("second window", async () => {
    const win = await second();
    const W = win.P;
    await W.shiftClick("#i39", { browser: win.vitre.active().browser });
    const br = await W.waitOpen("n=39");
    check("a peek opens in the second window", win.vitre.service("peek").isOpen() && !peek().isOpen());
    check("its hidden tab belongs to that window", win.gBrowser.getTabForBrowser(br)?.hidden === true && !gBrowser.getTabForBrowser(br));
    await win.spike.capture("windows-1-second");
    const id = br.browserId;
    check("its browser is on the inset switch list", V.insetOff().includes(id), V.insetOff());
    // A peek in this window at the same time.
    await spike.activate();
    await P.shiftClick("#i38");
    const br1 = await P.waitOpen("n=38");
    check("both windows can have a sheet open at once", peek().isOpen() && win.vitre.service("peek").isOpen() && V.insetOff().includes(br1.browserId) && V.insetOff().includes(id), V.insetOff());
    win.close();
    await waitFor(() => wins().length === 1, { what: "the window to close" });
    await sleep(800);
    check("closing the window with a peek open takes its browser off the inset switch list (this window's stays)", !V.insetOff().includes(id) && V.insetOff().includes(br1.browserId), V.insetOff());
    check("this window's peek is untouched", peek().isOpen() && peek().browser() === br1);
    P.press("Escape");
    await P.waitClosed();
  });

  await V.section("reopen a window closed with a peek open", async () => {
    const win = await second();
    const W = win.P;
    await W.shiftClick("#i41", { browser: win.vitre.active().browser });
    await W.waitOpen("n=41");
    // Give the session store a moment to see the window's state.
    await sleep(1500);
    win.close();
    await waitFor(() => wins().length === 1, { what: "the window to close" });
    await sleep(800);
    const closed = window.SessionStore.getClosedWindowData();
    log("closed windows", closed.map((w) => ({ tabs: w.tabs?.length, hidden: (w.tabs ?? []).filter((t) => t.hidden).length })));
    const restored = window.SessionStore.undoCloseWindow(0);
    await waitFor(() => restored.vitre?.ready, { timeout: 15000, what: "the reopened window" });
    await sleep(2500);
    const tabs = Array.from(restored.gBrowser.tabs);
    log("reopened window tabs", tabs.map((t) => ({ hidden: t.hidden, url: t.linkedBrowser.currentURI.spec.slice(-16) })));
    check("the reopened window has its tab and no orphan peek tab", tabs.length === 1 && !tabs.some((t) => t.hidden) && restored.vitre.tabs.length === 1, tabs.length);
    check("and no sheet", !restored.vitre.service("peek").isOpen());
    restored.close();
    await waitFor(() => wins().length === 1, { what: "close again" });
    await spike.activate();
  });

  await V.section("private window", async () => {
    const win = await second({ private: true });
    const W = win.P;
    await W.shiftClick("#i36", { browser: win.vitre.active().browser });
    const br = await W.waitOpen("n=36");
    const id = br.browserId;
    check("a private window's peek is private", br.browsingContext.originAttributes.privateBrowsingId > 0);
    W.press("Escape");
    await W.waitClosed();
    check("closed, it is warm there", win.vitre.service("peek").canReopen());
    win.close();
    await waitFor(() => wins().length === 1, { what: "the private window to close" });
    await sleep(800);
    check("closing the private window with a warm peek leaves nothing on the inset switch list", !V.insetOff().includes(id), V.insetOff());
    await spike.activate();
  });

  await V.section("popup window", async () => {
    const src = b.active();
    await P.load(P.page("verify.html"), src);
    const before = wins().length;
    // window.open with features opens a tab by product default; restriction 2 (Firefox's own
    // default, which a user or an extension can set) gives a real popup window.
    Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
    const pr = await P.rectOf(src.browser, "#pop");
    P.mouse(pr.cx, pr.cy);
    await waitFor(() => wins().length === before + 1, { what: "the popup window" });
    Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
    const pop = wins().find((w) => w !== window);
    await waitFor(() => pop.vitre?.ready && pop.spike && pop.P, { timeout: 15000, what: "Vitre in the popup" });
    await sleep(1200);
    await pop.spike.activate();
    check("the popup window is a popup to Vitre", pop.vitre.isPopup);
    const pp = pop.vitre.service("peek");
    const t = pop.vitre.active();
    await waitFor(() => t.url.endsWith("issues.html") && !t.loading, { what: "issues in the popup" });
    await sleep(400);
    const wbefore = wins().length;
    await pop.P.shiftClick("#i39", { browser: t.browser });
    await sleep(2000);
    log("after Shift+click in the popup", { windows: wins().length, peek: pp?.isOpen() });
    check("Shift+click in a popup opens no sheet (the popup shows one page)", !pp?.isOpen() && !pop.document.querySelector("#layer-peek > .vp-sheet.on"));
    pop.spike.press("Ctrl+Q");
    await sleep(600);
    check("Ctrl+Q in a popup opens no sheet either", !pp?.isOpen());
    for (const w of wins()) if (w !== window) w.close();
    await waitFor(() => wins().length === 1, { what: "popups closed" });
    log("windows opened by the Shift+click", wins().length - wbefore);
    await spike.activate();
  });

  await V.section("this window still peeks after all that", async () => {
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    check("a peek still opens here", peek().isOpen() && P.sheet().shown);
    P.press("Escape");
    await P.waitClosed();
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
