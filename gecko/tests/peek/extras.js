// Peek: the rest. The one-time discovery hint (board PeekDiscover), F6 through peek page -> header ->
// address field, find's slot in the header, the header menu (through the 'menus' service; a stand-in
// here), the sheet's size when the window changes (and the full sheet below 900×600), page keys on
// the focused peek, and a peeked link that turns out to be a download.
//   python tests/peek/all.py extras
/* global spike, P, gBrowser, Services, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();

  // ---- 1. discovery: after two bounces, the first link pointed at gets "Shift+click to peek" -------
  Services.prefs.clearUserPref("vitre.peek.hintShown");
  const list = P.page("issues.html");
  const bounce = async (leaf) => {
    await P.load(P.page(leaf));
    await sleep(300);
    src.browser.goBack();
    await waitFor(() => src.url === list && !src.loading, { what: "back to the list" });
    await sleep(400);
  };
  await bounce("issue.html?n=41");
  await bounce("issue.html?n=36");
  const i39 = await P.rectOf(src.browser, "#i39");
  P.move(i39.cx - 40, i39.cy);
  await sleep(100);
  P.move(i39.cx, i39.cy);
  const hint = await waitFor(() => document.querySelector("#layer-peek > .vp-hint"), { timeout: 4000, what: "the hint" }).catch(() => null);
  const hr = hint && P.R(hint.getBoundingClientRect());
  log("hint", hr, hint?.textContent);
  check("after bouncing back and forth twice, pointing at a link shows the hint in the status bubble", !!hint && /issue\.html\?n=39/.test(hint.textContent) && hint.textContent.includes("Shift+click to peek"), hint?.textContent);
  check("the bubble sits in the bottom-left corner, 12 px in, 30 px tall", hr && hr.x === 12 && P.near(hr.y + hr.h, window.innerHeight - 12) && hr.h === 30, hr);
  check("Firefox's own status bubble is hidden while it shows", document.documentElement.hasAttribute("vitre-peek-hint"));
  check("it is shown once: retired from now on", Services.prefs.getBoolPref("vitre.peek.hintShown", false));
  await spike.capture("extras-1-hint");
  P.move(700, 120);
  await sleep(1000);
  check("it goes when the pointer leaves the link", !document.querySelector("#layer-peek > .vp-hint") && !document.documentElement.hasAttribute("vitre-peek-hint"));
  await bounce("issue.html?n=41");
  await bounce("issue.html?n=36");
  P.move(i39.cx, i39.cy);
  await sleep(800);
  check("never again after that", !document.querySelector("#layer-peek > .vp-hint"));
  P.move(700, 120);

  // ---- 2. F6: peek page -> header -> address field -> peek page --------------------------------------
  await P.shiftClick("#i39");
  const br = await P.waitOpen("n=39");
  await P.focusPeek();
  P.press("F6");
  await sleep(200);
  const inHeader = !!document.activeElement?.closest?.(".vp-head");
  P.press("F6");
  await sleep(300);
  const inField = b.omni.focused;
  P.press("F6");
  await sleep(300);
  check("F6 with a peek open: page -> header -> address field -> page", inHeader && inField && !b.omni.open && document.activeElement === br && peek().isOpen(), { inHeader, inField, active: document.activeElement?.localName });

  // ---- 3. find's capsule slot in the header ----------------------------------------------------------
  const slot = peek().headerSlot(true);
  const s = sheet();
  log("slot", P.R(slot));
  check("headerSlot(true): the 440×32 slot 38 px into the header, 6 px down; the domain and path give way", slot && P.near(slot.x, s.chrome.x + 38) && P.near(slot.y, s.chrome.y + 6) && slot.width === 440 && slot.height === 32 && getComputedStyle(document.querySelector("#layer-peek .vp-id:last-child .dom")).visibility === "hidden", P.R(slot));
  peek().headerSlot(false);
  check("headerSlot(false) gives them back", getComputedStyle(document.querySelector("#layer-peek .vp-id:last-child .dom")).visibility === "visible");
  check("headerRect() is the header", P.R(peek().headerRect()).h === 44);

  // ---- 4. the header menu goes through the menus service --------------------------------------------
  const shown = [];
  if (!b.service("menus")) b.provide("menus", { show: (items, at) => shown.push({ items, at }), close() {} });
  const menus = b.service("menus");
  const realShow = menus.show;
  menus.show = (items, at, opts) => {
    shown.push({ items, at });
    if (realShow && realShow !== menus.show) realShow.call(menus, items, at, opts);
  };
  const hd = document.querySelector("#layer-peek .vp-head").getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(hd.left + 500, hd.top + 22, { type: "contextmenu", button: 2 }, window);
  await sleep(200);
  const labels = shown[0]?.items.map((i) => i.label ?? (i.separator ? "—" : "")) ?? [];
  check("right-click on the header asks the menus module for the Peek header menu", labels.join("|") === "Open as tab|Copy address|Open in new window|—|Close peek", labels);
  menus.show = realShow;
  await sleep(300);
  // With the menus module installed this shows its glass menu (MenuSpec "Peek header").
  await spike.capture("extras-4-header-menu");
  b.service("menus")?.close?.();

  // ---- 5. page keys act on the focused peek: Ctrl+R reloads the peek, not the tab --------------------
  await P.focusPeek();
  const tokPeek = (await P.state(br)).token;
  const tokTab = await P.inContent(src.browser, (w) => w.performance.timeOrigin);
  P.press("Ctrl+R");
  await waitFor(async () => (await P.state(br)).token !== tokPeek, { what: "the peek reloading" });
  await sleep(500);
  check("Ctrl+R in the peek reloads the peek, not the tab under it", (await P.inContent(src.browser, (w) => w.performance.timeOrigin)) === tokTab && peek().isOpen());

  // ---- 6. the window changes size: the sheet follows ------------------------------------------------
  await P.size(1200, 800);
  await sleep(500);
  let g = sheet();
  check("at 1200×800 the sheet is 864 wide (72 %, 8 px steps), centred, 704 tall", g.chrome && g.chrome.w === 864 && g.chrome.x === 168 && g.chrome.y === 72 && g.chrome.h === 704 && g.browser.w === 864 && g.browser.y === 116, g.chrome);
  await P.size(860, 560);
  await sleep(500);
  g = sheet();
  check("below 900×600 it fills the window under the bar with 8 px margins", g.chrome && g.chrome.x === 8 && g.chrome.w === window.innerWidth - 16 && g.chrome.y === 72, g.chrome);
  await spike.capture("extras-2-small-window");
  await P.size(1440, 900);
  await sleep(500);
  P.press("Escape");
  await P.waitClosed();

  // ---- 7. a peeked link that is a download: the sheet folds toward the downloads corner ----------------
  const dir = PathUtils.join(PathUtils.profileDir, "peek-downloads");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setStringPref("browser.download.dir", dir);
  Services.prefs.setBoolPref("browser.download.useDownloadDir", true);
  Services.prefs.setBoolPref("browser.download.always_ask_before_handling_new_types", false);
  await P.inContent(src.browser, (w) => {
    const a = w.document.createElement("a");
    a.id = "dl";
    a.href = "file.bin";
    a.textContent = "Download the log";
    a.style.cssText = "position:fixed;left:40px;bottom:40px;font:15px Segoe UI";
    w.document.body.append(a);
  });
  const closedBefore = window.SessionStore.getClosedTabDataForWindow(window).length;
  log("closed before the download", closedBefore);
  await P.shiftClick("#dl");
  await waitFor(() => peek().isOpen(), { timeout: 4000, what: "a peek for the download link" }).catch(() => null);
  const folded = await waitFor(() => !peek().isOpen() && !sheet().shown, { timeout: 8000, what: "the sheet to fold" }).then(() => true, () => false);
  await sleep(800);
  log("after the download link", P.tabsInfo(), await IOUtils.getChildren(dir), window.SessionStore.getClosedTabDataForWindow(window).map((c) => ({ id: c.closedId, ext: c.state?.extData, title: c.title, entries: c.state?.entries?.length, hidden: c.state?.hidden })));
  check("a peeked link that turns out to be a download folds the sheet away; no tab or hidden tab is left", folded && b.tabs.length === 1 && P.tabsInfo().hidden === 0, P.tabsInfo());
  check("the download landed in the download folder (the downloads module takes over from there)", (await IOUtils.getChildren(dir)).some((f) => f.endsWith("file.bin")));
  check("and the peek's tab did not stay in the closed-tab list", P.tabsInfo().closed.length === 0, P.tabsInfo().closed);

  // ---- 8. "Search for" a selection: in a peek or a new tab, as Settings › Tabs says ----------------------
  const settings = b.sys("VitreSettings");
  settings.set({ searchEngine: "duckduckgo", selectionSearchOpens: "peek" });
  await sleep(200);
  peek().search("float glass");
  await waitFor(() => peek().isOpen() && peek().browser(), { what: "a search peek" });
  const searchUrl = peek().browser().userTypedValue || peek().browser().currentURI.spec;
  check("search() with 'Open in a peek' peeks the search on the chosen engine", /duckduckgo\.com\/\?q=float%20glass/.test(searchUrl) && b.tabs.length === 1, searchUrl);
  P.press("Ctrl+W");
  await P.waitClosed();
  settings.set({ selectionSearchOpens: "tab" });
  await sleep(200);
  peek().search("float glass");
  await sleep(500);
  await waitFor(() => /duckduckgo/.test(b.active()?.browser.currentURI.spec ?? ""), { timeout: 10000, what: "the search tab's page" }).catch(() => null);
  log("search tab", { url: b.active()?.url, current: b.active()?.browser.currentURI.spec, typed: b.active()?.browser.userTypedValue, title: b.active()?.title });
  check("with 'Open in a new tab' it opens a tab right of the page", !peek().isOpen() && b.tabs.length === 2 && b.tabs.indexOf(b.active()) === 1 && /duckduckgo\.com/.test(b.active().browser.currentURI.spec), b.active()?.url);
  b.closeTab(b.active());
  await sleep(300);
  b.activate(src);
  settings.set({ selectionSearchOpens: "peek", searchEngine: "google" });

  // ---- 9. Open as tab can be rebound (Settings › Keyboard shortcuts) ----------------------------------------
  settings.set({ rebind: { openAsTab: "Ctrl+Shift+O" } });
  await sleep(300);
  await P.shiftClick("#i41");
  const br41 = await P.waitOpen("n=41");
  check("the Open as tab tooltip names the rebound key", document.querySelector("#layer-peek .vp-open").dataset.key === "Ctrl+Shift+O", document.querySelector("#layer-peek .vp-open").dataset.key);
  await P.focusPeek();
  P.press("Alt+Enter");
  await sleep(600);
  const stayed = peek().isOpen();
  P.press("Ctrl+Shift+O");
  await waitFor(() => gBrowser.selectedBrowser === br41 && !peek().isOpen(), { what: "promote by the rebound key" }).catch(() => null);
  check("after rebinding, Alt+Enter no longer promotes and the new key does", stayed && gBrowser.selectedBrowser === br41, { stayed });
  settings.set({ rebind: {} });
  b.closeTab(b.active());
  await sleep(300);

  // ---- 10. a private window has its own peeks, private too --------------------------------------------------
  const win = await spike.openWindow({ private: true });
  const b2 = win.vitre;
  await win.spike.activate();
  b2.navigate(b2.active(), P.page("issues.html"));
  await waitFor(() => b2.active().url.endsWith("issues.html") && !b2.active().loading, { what: "private page" });
  await sleep(600);
  const pr = await P.rectOf(b2.active().browser, "#i39");
  win.spike.EU.synthesizeMouseAtPoint(pr.cx, pr.cy, { type: "mousemove" }, win);
  await sleep(60);
  win.spike.EU.synthesizeMouseAtPoint(pr.cx, pr.cy, { shiftKey: true }, win);
  await waitFor(() => b2.service("peek").isOpen() && b2.service("peek").browser()?.currentURI.spec.includes("n=39"), { timeout: 10000, what: "a peek in the private window" });
  const pbr = b2.service("peek").browser();
  check("a peek in a private window is private, and this window has none", pbr.browsingContext.originAttributes.privateBrowsingId > 0 && !peek().isOpen() && win.gBrowser.getTabForBrowser(pbr)?.hidden === true);
  await win.spike.capture("extras-3-private");
  win.close();
  await sleep(500);
});
