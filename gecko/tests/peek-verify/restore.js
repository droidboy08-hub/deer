// Peek verification: restart with a WARM peek (closed, still a hidden tab) while another tab is
// active, then a second restart right after a peek was opened as a tab. Nothing hidden comes back,
// nothing a peek showed is in the closed-tab list, the promoted page comes back as an ordinary tab
// (without the hidden-tab mark), and the inset switch list starts empty.
//   python tests/peek-verify/all.py restore
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  const peekUrl = (u) => /issue\.html\?n=(?:39|41)\b/.test(String(u));

  if (spike.run === 1) {
    await spike.loaded();
    await sleep(600);
    const second = b.newTab(P.page("issue.html?n=27"), { background: true });
    await waitFor(() => !second.loading, { what: "second tab" });
    await P.shiftClick("#i41");
    await P.waitOpen("n=41");
    P.press("Escape");
    await P.waitClosed();
    b.activate(second);
    await sleep(800);
    check("before the restart: a warm peek (hidden tab) while the other tab is active", V.hidden() === 1 && b.active() === second && !peek().isOpen(), V.phase());
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    await spike.restart();
    return;
  }

  if (spike.run === 2) {
    await waitFor(() => b.tabs.length === 2, { timeout: 20000, what: "restored tabs" });
    await sleep(2500);
    const info = P.tabsInfo();
    log("after restart 1", info);
    check("after a restart with a warm peek: two tabs, no hidden tab", info.hidden === 0 && info.total === 2, info);
    check("the warm peek is not in the closed-tab list", !info.closed.some(peekUrl), info.closed);
    check("the inset switch list starts empty", V.insetOff().length === 0, V.insetOff());
    check("Ctrl+Shift+T has no peek to bring back", !peek().canReopen());
    // Now open a peek and promote it, then restart at once.
    b.activate(b.tabs[0]);
    await sleep(600);
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.active()?.browser === br, { what: "promoted" });
    await sleep(1500);
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    await spike.restart();
    return;
  }

  await waitFor(() => b.tabs.length === 3, { timeout: 20000, what: "restored tabs (3)" });
  await sleep(2500);
  const info = P.tabsInfo();
  log("after restart 2", info, b.tabs.map((t) => t.url.slice(-16)));
  check("after a restart right after Open as tab, the promoted page is an ordinary tab", b.tabs.length === 3 && b.tabs.some((t) => /n=39\b/.test(t.url)) && info.hidden === 0, b.tabs.map((t) => t.url));
  check("in its place right of its source", /n=39\b/.test(b.tabs[1].url), b.tabs.map((t) => t.url.slice(-16)));
  const promoted = b.tabs.find((t) => /n=39\b/.test(t.url));
  check("without the hidden-tab mark", window.SessionStore.getCustomTabValue(promoted.node, "vitre-hidden") === "");
  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
