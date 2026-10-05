// Peek: opening a sheet. Shift+click and Ctrl+Q, geometry and header (board PeekOpen: 1040×804 at
// (200, 72) in a 1440×900 window, 44 px header), the dim, the open motion, no top inset inside the
// sheet, links inside the sheet (target=_blank, window.open, Shift+click) stay in it, the address
// field's Shift+Enter, the Shift+click setting, leaving the tab, Ctrl+Shift+T, Alt+Left, back.
//   python tests/peek/all.py open
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet, near } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  log("window", { inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio, modules: b.modules, errors: b.moduleErrors });
  check("the peek service is provided", !!peek() && typeof peek().open === "function" && !!window.vitrePeek);
  const src = b.active();
  check("the issues page is the active tab", src.url.endsWith("issues.html"), src.url);

  // ---- 1. Shift+click a link: the sheet grows out of it -----------------------------------------
  const tabsBefore = P.tabsInfo();
  // Mid-motion frame: the open is 400 ms on the spring; slowed down 6x for the capture.
  Services.prefs.setIntPref("vitre.debug.peekMotionScale", 6);
  const link = await P.shiftClick("#i39");
  await sleep(40);
  await spike.capture("open-1-growing");
  const mid = sheet();
  log("mid-motion sheet", mid.chrome, "link", P.R(link));
  check("the sheet grows out of the link: mid-motion it is between the link's box and its own", mid.chrome && mid.chrome.x < 200 && mid.chrome.x >= link.x - 4 && mid.chrome.w < 1040 && mid.chrome.w > link.w, mid.chrome);
  await sleep(2600);
  Services.prefs.clearUserPref("vitre.debug.peekMotionScale");
  const br = await P.waitOpen("n=39");
  const s = sheet();
  log("sheet", s, "link", P.R(link));
  check("Shift+click opened a peek; no window, no tab in the bar", !!br && Services.wm.getEnumerator("navigator:browser").hasMoreElements() && b.tabs.length === 1 && P.tabsInfo().hidden === tabsBefore.hidden + 1, P.tabsInfo());
  check("the source page did not navigate", src.url.endsWith("issues.html") && gBrowser.selectedTab === src.node);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = Math.min(1120, Math.max(720, Math.round((W * 0.72) / 8) * 8));
  const x = Math.round((W - w) / 2);
  check("the sheet is 72 % of the window wide (720..1120, 8 px steps), centred, 72 px from the top, 96 px shorter than the window", s.chrome && near(s.chrome.x, x) && near(s.chrome.y, 72) && near(s.chrome.w, w) && near(s.chrome.h, H - 96) && near(s.frame.x, x) && near(s.frame.w, w), { chrome: s.chrome, expected: { x, y: 72, w, h: H - 96 } });
  check("the header is 44 px; the page sits right under it, sheet-wide", s.head && near(s.head.h, 44) && s.browser && near(s.browser.y, 72 + 44) && near(s.browser.x, x) && near(s.browser.w, w) && near(s.browser.h, H - 96 - 44), { head: s.head, browser: s.browser });
  check("the header shows the domain and the dimmed path", s.host === "127.0.0.1:" + new URL(P.base).port && s.path === "/issue.html?n=39" && !s.back, { host: s.host, path: s.path });
  check("the page under the sheet is dimmed", s.dimOn && Number(s.dimOpacity) === 1);
  check("the cover is gone once the page painted", Number(s.cover) === 0, s.cover);
  const inset = await b.page(br).query("inset:state");
  check("no top inset inside the sheet (it has its own header): the switch is off for this browser", inset && inset.browserOff === true && !inset.applied, inset && { browserOff: inset.browserOff, applied: inset.applied, reason: inset.reason });
  const srcInset = await b.page(src).query("inset:state");
  check("the page under the sheet keeps its strip", srcInset?.applied === true && srcInset.browserOff === false, srcInset && { applied: srcInset.applied, off: srcInset.browserOff, decision: srcInset.decision, reason: srcInset.reason });
  const st1 = await P.state(br);
  await sleep(500);
  const st2 = await P.state(br);
  check("the sheet's page runs while its tab is not selected", st2.n > st1.n && st2.visibility === "visible", [st1.n, st2.n, st2.visibility]);
  check("keyboard focus is in the sheet's page", document.activeElement === br, document.activeElement?.localName);
  check("window.vitrePeek.browser() is the sheet's page", window.vitrePeek.browser() === br);
  await spike.capture("open-2-open");

  // ---- 2. typing goes to the sheet; its own history; the header's back button --------------------
  await P.focusPeek();
  const ta = await P.rectOf(br, "#comment");
  P.mouse(ta.cx, ta.cy);
  await sleep(200);
  spike.type("hello peek");
  await sleep(300);
  check("typing goes to the sheet's page", (await P.state(br)).typed === "hello peek");
  const next = await P.rectOf(br, "#next");
  P.mouse(next.cx, next.cy);
  await waitFor(() => br.currentURI.spec.includes("n=38") && !br.webProgress.isLoadingDocument, { what: "navigation inside the sheet" });
  await sleep(500);
  check("a link inside the sheet navigates the sheet; the back chevron appears", sheet().back && sheet().path === "/issue.html?n=38" && b.tabs.length === 1, sheet());
  await spike.capture("open-3-history");
  const backBtn = document.querySelector("#layer-peek .vp-back").getBoundingClientRect();
  P.mouse(backBtn.left + 14, backBtn.top + 14);
  await waitFor(() => br.currentURI.spec.includes("n=39") && !br.webProgress.isLoadingDocument, { what: "back inside the sheet" });
  await sleep(400);
  check("the header's back button goes back inside the sheet", !sheet().back && sheet().path === "/issue.html?n=39");

  // ---- 3. new tabs and windows the sheet's page asks for stay in the sheet -----------------------
  const blank = await P.rectOf(br, "#blank");
  P.mouse(blank.cx, blank.cy);
  await waitFor(() => br.currentURI.spec.includes("n=36") && !br.webProgress.isLoadingDocument, { what: "target=_blank in the sheet" });
  await sleep(300);
  check("target=_blank inside the sheet loads in the sheet (no tab, no window)", b.tabs.length === 1 && P.tabsInfo().hidden === tabsBefore.hidden + 1 && peek().browser() === br, P.tabsInfo());
  // A real click: window.open needs a user gesture (the popup blocker).
  const openBtn = await P.rectOf(br, "#open");
  P.mouse(openBtn.cx, openBtn.cy);
  await waitFor(() => br.currentURI.spec.includes("n=33") && !br.webProgress.isLoadingDocument, { what: "window.open in the sheet" });
  await sleep(300);
  check("window.open() inside the sheet loads in the sheet", b.tabs.length === 1 && peek().browser() === br);
  const nx = await P.rectOf(br, "#next");
  P.move(nx.cx, nx.cy);
  P.mouse(nx.cx, nx.cy, { shiftKey: true });
  await waitFor(() => br.currentURI.spec.includes("n=38") && !br.webProgress.isLoadingDocument, { what: "Shift+click inside the sheet" });
  check("Shift+click inside the sheet navigates the sheet (peeks don't nest)", b.tabs.length === 1 && peek().browser() === br && P.tabsInfo().hidden === tabsBefore.hidden + 1);

  // ---- 4. Alt+Left on the first page closes it; never on key repeat -----------------------------
  // Back to the first page, then Alt+Left once more.
  while (br.canGoBack) {
    br.goBack();
    await sleep(500);
  }
  await waitFor(() => !br.webProgress.isLoadingDocument, { what: "first page" });
  await P.focusPeek();
  P.press("Alt+Left", { repeat: true });
  await sleep(500);
  check("Alt+Left held down (key repeat) on the sheet's first page does not close it", peek().isOpen());
  P.press("Alt+Left");
  await P.waitClosed();
  check("Alt+Left on the sheet's first page closes the peek", !peek().isOpen() && src.url.endsWith("issues.html"));
  await sleep(400);
  check("focus went back to the link the peek came from", (await P.state(src.browser)).active === "i39", (await P.state(src.browser)).active);
  check("the closed peek is warm (still a hidden tab) and can be reopened", peek().canReopen() && P.tabsInfo().hidden === tabsBefore.hidden + 1, P.tabsInfo());

  // ---- 5. Ctrl+Shift+T reopens the warm peek, the same page instance ------------------------------
  const tok = (await P.state(br)).token;
  P.press("Ctrl+Shift+T");
  const br2 = await P.waitOpen("issue.html");
  check("Ctrl+Shift+T brings the warm peek back: same page, same document", br2 === br && (await P.state(br)).token === tok);
  await sleep(300);

  // ---- 6. leaving the tab warm-closes the peek ------------------------------------------------------
  const other = b.newTab(P.page("issue.html?n=27"), { background: true });
  await waitFor(() => !other.loading, { what: "second tab" });
  b.activate(other);
  await sleep(500);
  check("switching tabs warm-closes the peek", !peek().isOpen() && !sheet().shown && !sheet().dimOn && peek().canReopen() === false, sheet());
  b.activate(src);
  await sleep(500);
  check("coming back shows no sheet; it is warm for Ctrl+Shift+T", !peek().isOpen() && peek().canReopen());
  P.press("Ctrl+Shift+T");
  await P.waitOpen("issue.html");
  check("and Ctrl+Shift+T brings it back over its tab", peek().isOpen() && peek().browser() === br);

  // ---- 7. Ctrl+W closes the peek, never the tab -----------------------------------------------------
  await P.focusPeek();
  P.press("Ctrl+W");
  await P.waitClosed();
  check("Ctrl+W closes the peek and leaves the tabs alone", b.tabs.length === 2 && b.active() === src);
  b.closeTab(other);
  await sleep(400);
  check("after a tab was closed, Ctrl+Shift+T reopens the tab, not the peek", !peek().canReopen());
  P.press("Ctrl+Shift+T");
  await waitFor(() => b.tabs.length === 2, { what: "reopened tab" });
  check("Ctrl+Shift+T reopened the closed tab", b.tabs.length === 2 && !peek().isOpen());
  b.closeTab(b.tabs[1]);
  await sleep(400);
  b.activate(src);
  await sleep(300);

  // ---- 8. Ctrl+Q: the link under the pointer, the focused link ------------------------------------
  const i41 = await P.rectOf(src.browser, "#i41");
  P.move(i41.cx, i41.cy);
  await sleep(150);
  b.focusPage();
  await sleep(100);
  P.press("Ctrl+Q");
  await P.waitOpen("n=41");
  check("Ctrl+Q peeks the link under the pointer", peek().isOpen() && sheet().path === "/issue.html?n=41");
  P.press("Escape");
  await P.waitClosed();
  await P.inContent(src.browser, (w) => {
    w.document.getElementById("i36").focus();
  });
  // Keyboard focus (focus-visible) on #36: a Tab key from #33's... use the keyboard to land on it.
  b.focusPage();
  await P.inContent(src.browser, (w) => w.document.getElementById("i33").focus());
  P.press("Shift+Tab");
  await sleep(200);
  const focused = (await P.state(src.browser)).active;
  P.press("Ctrl+Q");
  await P.waitOpen("n=36");
  check("Ctrl+Q peeks the link focused with the keyboard (over the one under the pointer)", focused === "i36" && sheet().path === "/issue.html?n=36", { focused, path: sheet().path });
  P.press("Escape");
  await P.waitClosed();

  // ---- 9. the address field's Shift+Enter ---------------------------------------------------------
  b.editAddress("");
  await sleep(300);
  spike.type(P.page("issue.html?n=29"));
  await sleep(300);
  P.press("Shift+Enter");
  await P.waitOpen("n=29");
  check("Shift+Enter in the address field peeks the address", peek().isOpen() && !b.omni.open && b.tabs.length === 1);
  await spike.capture("open-4-from-address");
  P.press("Escape");
  await P.waitClosed();

  // ---- 10. the Shift+click setting: Open in new window ----------------------------------------------
  const settings = b.sys("VitreSettings");
  settings.set({ shiftClick: "window" });
  await sleep(200);
  const wins = () => { let n = 0; for (const _ of Services.wm.getEnumerator("navigator:browser")) n++; return n; };
  const w0 = wins();
  await P.shiftClick("#i27");
  await waitFor(() => wins() === w0 + 1, { what: "a new window" });
  check("with Shift+click set to Open in new window, Shift+click opens a window, no peek", !peek().isOpen() && wins() === w0 + 1);
  for (const win of Services.wm.getEnumerator("navigator:browser")) if (win !== window) win.close();
  await sleep(500);
  settings.set({ shiftClick: "peek" });
  await spike.activate();

  // ---- 11. a fragment link and a javascript: link are not peeked -------------------------------------
  await P.shiftClick("#frag");
  await sleep(600);
  check("Shift+click on a #fragment of the same page does not open a peek", !peek().isOpen());

  // ---- 12. a closed peek never enters the closed-tab list --------------------------------------------
  const info = P.tabsInfo();
  log("tabs at the end", info);
  // (n=27 was a real tab closed above; every other issue page here was only ever peeked.)
  check("no peek page is in the closed-tab list", !info.closed.some((u) => /n=(?:39|41|38|36|33|29)\b/.test(String(u))), info.closed);
});
