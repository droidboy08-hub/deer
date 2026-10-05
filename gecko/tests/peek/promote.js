// Peek: Open as tab. Alt+Enter, the header button or a double-click on the header turns the sheet
// into a tab: the same <browser> (same browsing context and process, no load), its running state
// and typed text kept, placed right of its source tab; the page gets its top strip back (it now
// sits under the bar). Over Home the new tab takes Home's place. Selecting the peek's tab from
// outside (DevTools, an extension) promotes it.   python tests/peek/all.py promote
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();
  const created = [];
  b.on("tab-created", (t) => created.push(t.id));

  // ---- 1. Alt+Enter: same page, nothing reloads ----------------------------------------------------
  await P.shiftClick("#i39");
  const br = await P.waitOpen("n=39");
  await P.focusPeek();
  const ta = await P.rectOf(br, "#comment");
  P.mouse(ta.cx, ta.cy);
  await sleep(150);
  spike.type("keep me");
  await sleep(300);
  const before = await P.state(br);
  const bcId = br.browsingContext.id;
  const pid = br.frameLoader?.remoteTab?.osPid;
  const loads = P.countLoads(br);
  const node = gBrowser.getTabForBrowser(br);
  check("the peek is a hidden tab before", node.hidden && !b.tabs.some((t) => t.node === node));
  Services.prefs.setIntPref("vitre.debug.peekMotionScale", 5);
  P.press("Alt+Enter");
  await sleep(60);
  await spike.capture("promote-1-expanding");
  const mid = sheet();
  log("mid promote", mid.chrome, mid.panel);
  await waitFor(() => !document.querySelector("#layer-peek > .vp-sheet.on") && gBrowser.selectedTab === node, { timeout: 6000, what: "promotion" });
  Services.prefs.clearUserPref("vitre.debug.peekMotionScale");
  await sleep(900);
  loads.stop();
  const after = await P.state(br);
  const t = b.active();
  log("before", before, "after", after, { loads: loads.loads, bc: [bcId, br.browsingContext.id], pid: [pid, br.frameLoader?.remoteTab?.osPid] });
  check("mid-motion the sheet is growing toward the window", mid.chrome && mid.chrome.w > 1040 && mid.chrome.w < 1440, mid.chrome);
  check("Alt+Enter turned the peek into the active tab", !!t && t.node === node && !node.hidden && b.tabs.length === 2 && !peek().isOpen());
  check("right of its source tab", b.tabs.indexOf(t) === b.tabs.indexOf(src) + 1, b.tabs.map((x) => x.url.slice(-14)));
  check("same browsing context and process: nothing reloaded", br.browsingContext.id === bcId && br.frameLoader?.remoteTab?.osPid === pid && loads.loads === 0 && after.loads === 1, { loads: loads.loads, pageLoads: after.loads });
  check("the page kept running and kept what was typed", after.token === before.token && after.n > before.n && after.typed === "keep me", { before, after });
  check("one tab-created for the new tab", created.length === 1 && created[0] === t.id, created);
  check("the bar's active pill is the new tab, its source a circle", b.activeId === t.id && b.bar.item(t.id)?.classList.contains("active") && !b.bar.item(src.id)?.classList.contains("active"));
  const inset = await b.page(br).query("inset:state");
  check("the promoted page gets its top strip back (it is under the bar now)", inset?.browserOff === false && inset.applied === true, inset && { off: inset.browserOff, applied: inset.applied, decision: inset.decision });
  const pageTop = await P.inContent(br, (w) => w.document.querySelector("header").getBoundingClientRect().top);
  check("the page's own header sits below the bar band", pageTop >= 67, pageTop);
  check("the source page went to sleep and back to normal", !gBrowser.tabpanels.querySelector(".vitre-peek-under") && !src.browser.docShellIsActive);
  check("its tab no longer carries the hidden-tab session value", window.SessionStore.getCustomTabValue(node, "vitre-hidden") === "");
  check("keyboard focus is in the promoted page", document.activeElement === br);
  await spike.capture("promote-2-tab");

  // ---- 2. the Open as tab button --------------------------------------------------------------------
  b.activate(src);
  await sleep(500);
  await P.shiftClick("#i41");
  const br41 = await P.waitOpen("n=41");
  const openBtn = document.querySelector("#layer-peek .vp-open").getBoundingClientRect();
  P.mouse(openBtn.left + 16, openBtn.top + 16);
  await waitFor(() => gBrowser.selectedBrowser === br41 && !peek().isOpen() && !document.querySelector("#layer-peek > .vp-sheet.on"), { what: "button promote" });
  check("the Open as tab button promotes, right of the source", b.tabs.length === 3 && b.tabs.indexOf(b.active()) === b.tabs.indexOf(src) + 1);

  // ---- 3. a double-click on the header --------------------------------------------------------------
  b.activate(src);
  await sleep(500);
  await P.shiftClick("#i36");
  const br36 = await P.waitOpen("n=36");
  const head = document.querySelector("#layer-peek .vp-head").getBoundingClientRect();
  P.mouse(head.left + 600, head.top + 22, { clickCount: 1 });
  P.mouse(head.left + 600, head.top + 22, { clickCount: 2 });
  await waitFor(() => gBrowser.selectedBrowser === br36 && !peek().isOpen(), { what: "double-click promote" });
  check("a double-click on the header promotes", b.tabs.length === 4);

  // ---- 4. the peek's tab selected from outside (as DevTools' Inspect does) --------------------------
  b.activate(src);
  await sleep(500);
  await P.shiftClick("#i33");
  const br33 = await P.waitOpen("n=33");
  const node33 = gBrowser.getTabForBrowser(br33);
  gBrowser.selectedTab = node33;
  await sleep(800);
  check("selecting the peek's tab from outside promotes it: in the bar, active, no sheet", b.active()?.node === node33 && !node33.hidden && !peek().isOpen() && !sheet().shown && !sheet().dimOn && b.tabs.length === 5, { active: b.active()?.url, tabs: b.tabs.length });
  check("Vitre's active tab follows (bar and MRU)", b.activeId === b.active().id && b.mru[0] === b.active().id);

  // ---- 5. over Home: the new tab takes Home's place -------------------------------------------------
  const home = b.newTab();
  await waitFor(() => home.kind === "home" && !home.loading, { what: "Home" });
  await sleep(600);
  b.omni.close(false);
  const homeIndex = b.tabs.indexOf(home);
  window.vitrePeek.open(P.page("issue.html?n=27"));
  const br27 = await P.waitOpen("n=27");
  await spike.capture("promote-3-over-home");
  await P.focusPeek();
  P.press("Alt+Enter");
  await waitFor(() => gBrowser.selectedBrowser === br27 && !peek().isOpen(), { what: "promote over Home" });
  await sleep(700);
  check("promoting over Home replaces Home: same place, Home gone", !b.tabs.includes(home) && b.tabs.indexOf(b.active()) === homeIndex && b.active().browser === br27, b.tabs.map((x) => x.url.slice(-14)));
  await spike.capture("promote-4-replaced-home");
  const info = P.tabsInfo();
  check("no hidden tabs left", info.hidden === 0, info);
});
