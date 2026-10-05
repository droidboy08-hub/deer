// Peek and session restore. A peek is a hidden tab and the session store saves it (verifier
// correction 14): after a restart with a peek open (and a warm one) no orphan tab comes back, and
// nothing a peek showed is in the closed-tab list, so Ctrl+Shift+T never brings one back as a tab.
//   python tests/peek/all.py session
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = P;
  await P.size(1440, 900);
  await spike.activate();

  if (spike.run === 1) {
    await spike.loaded();
    await sleep(600);
    const second = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !second.loading, { what: "second tab" });
    // A peek closed (warm) is dropped when another link is peeked: one warm page at most. The open
    // peek is the one the session store has to deal with.
    await P.shiftClick("#i41");
    await P.waitOpen("n=41");
    P.press("Escape");
    await P.waitClosed();
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    const info = P.tabsInfo();
    const state = window.SessionStore.getWindowState(window);
    const saved = (typeof state === "string" ? JSON.parse(state) : state).windows[0].tabs.map((t) => ({ hidden: !!t.hidden, url: t.entries?.[t.index - 1]?.url?.slice(-14), ext: t.extData }));
    log("before restart", info, saved);
    check("before the restart: two tabs in the bar and the open peek's hidden tab (the warm one was dropped for the new peek)", info.bar === 2 && info.hidden === 1 && peek().isOpen(), info);
    check("the session store has saved the hidden peek tab (what restore must clean up)", saved.filter((t) => t.hidden && t.ext?.["vitre-hidden"] === "1").length === 1, saved);
    check("the dropped warm peek did not go into the closed-tab list", info.closed.length === 0, info.closed);
    await spike.capture("session-1-before");
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    await spike.restart();
    return;
  }

  await waitFor(() => b.tabs.length === 2, { timeout: 20000, what: "restored tabs" });
  await sleep(2500);
  const info = P.tabsInfo();
  log("after restart", info, b.tabs.map((t) => t.url.slice(-16)));
  check("after the restart the bar has its two tabs back", b.tabs.length === 2 && b.tabs[0].url.endsWith("issues.html") && b.tabs[1].url.endsWith("n=27"), b.tabs.map((t) => t.url));
  check("no orphan peek tab came back (hidden tabs closed at restore)", info.hidden === 0 && info.total === 2, info);
  check("nothing a peek showed is in the closed-tab list", !info.closed.some((u) => /n=(?:39|41)\b/.test(String(u))), info.closed);
  check("no sheet is open after the restart", !peek().isOpen() && !P.sheet().shown);
  b.activate(b.tabs[0]);
  await sleep(500);
  P.press("Ctrl+Shift+T");
  await sleep(1500);
  check("Ctrl+Shift+T does not bring a peek back as a tab", b.tabs.length === 2 && !b.tabs.some((t) => /n=(?:39|41)\b/.test(t.url)) && !peek().isOpen(), b.tabs.map((t) => t.url));
  await spike.capture("session-2-after");
});
