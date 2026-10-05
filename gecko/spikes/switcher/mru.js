// SPIKE switcher/3: MRU order tracking and taking Ctrl+Tab away from Firefox.
// Run: python tools/run.py --boot spikes/switcher/mru.js --name switcher-mru --out spikes/switcher/out/mru --timeout 120
/* global gBrowser, Services, Ci, Cc, spike, vx, ctrlTab */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const EU = vx.EU();
  const first = gBrowser.selectedTab;
  const tabs = [1, 2, 3, 4, 5].map((n) => vx.addTab(vx.page(n, vx.COLOURS[n - 1])));
  for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
  gBrowser.removeTab(first);
  const n = (t) => tabs.indexOf(t) + 1;
  const sel = () => n(gBrowser.selectedTab);

  // ---- 1. MRU: our own list from TabSelect/TabOpen/TabClose versus tab.lastAccessed ----
  const mru = [...gBrowser.tabs];
  const touch = (t) => {
    const i = mru.indexOf(t);
    if (i >= 0) mru.splice(i, 1);
    mru.unshift(t);
  };
  gBrowser.tabContainer.addEventListener("TabSelect", (e) => touch(e.target));
  gBrowser.tabContainer.addEventListener("TabOpen", (e) => mru.splice(1, 0, e.target));
  gBrowser.tabContainer.addEventListener("TabClose", (e) => mru.splice(mru.indexOf(e.target), 1));
  for (const i of [3, 1, 4, 2]) {
    gBrowser.selectedTab = tabs[i - 1];
    await spike.sleep(60);
  }
  const byLastAccessed = () => [...gBrowser.tabs].sort((a, b) => b.lastAccessed - a.lastAccessed).map(n);
  spike.log("1 selected 3,1,4,2 -> own MRU list", mru.map(n), "sort by tab.lastAccessed", byLastAccessed());
  spike.log("1 lastAccessed raw", tabs.map((t) => [n(t), t._lastAccessed === Infinity ? "Infinity(selected)" : t.lastAccessed - Date.now()]));

  // focus the page, and report keys the page sees
  const seen = [];
  const watch = (t) => {
    t.linkedBrowser.messageManager.addMessageListener("vx:key", (m) => seen.push(n(t) + ":" + m.data));
    vx.inContent(t.linkedBrowser, "addEventListener('keydown',e=>sendAsyncMessage('vx:key',(e.ctrlKey?'Ctrl+':'')+e.key),true)");
  };
  tabs.forEach(watch);
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const ctrlDown = () => EU.synthesizeKey("KEY_Control", { type: "keydown" }, window);
  const ctrlUp = () => EU.synthesizeKey("KEY_Control", { type: "keyup" }, window);
  const tab = (shift = false) => EU.synthesizeKey("KEY_Tab", { ctrlKey: true, shiftKey: shift }, window);

  // ---- 2. Firefox defaults ----
  spike.log("2 defaults: browser.ctrlTab.sortByRecentlyUsed =", Services.prefs.getBoolPref("browser.ctrlTab.sortByRecentlyUsed"),
    "tabbox.handleCtrlTab =", gBrowser.tabbox.handleCtrlTab, "ctrlTab initialised =", !!ctrlTab._recentlyUsedTabs);
  let before = sel();
  ctrlDown(); tab(); ctrlUp();
  await spike.sleep(300);
  spike.log("2 default Ctrl+Tab: selected", before, "->", sel(), "(Firefox's tabbox moved to the next tab in bar order); page saw", seen.splice(0));

  // ---- 3. Firefox's own MRU panel when the pref is on ----
  Services.prefs.setBoolPref("browser.ctrlTab.sortByRecentlyUsed", true);
  await spike.sleep(100);
  spike.log("3 pref on: handleCtrlTab =", gBrowser.tabbox.handleCtrlTab, "ctrlTab initialised =", !!ctrlTab._recentlyUsedTabs);
  before = sel();
  ctrlDown(); tab();
  await spike.sleep(700);
  spike.log("3 Firefox ctrlTab panel state", ctrlTab.panel.state, "isOpen", !!ctrlTab.isOpen);
  await spike.capture("mru-firefox-panel");
  ctrlUp();
  await spike.sleep(400);
  spike.log("3 after Ctrl up: selected", before, "->", sel(), "panel", ctrlTab.panel.state);
  seen.length = 0;

  // ---- 4. Vitre takes Ctrl+Tab ----
  // Pref off (and locked so nothing can turn Firefox's panel back on), tabbox told not to handle it,
  // our own listener in the capture phase of the chrome window.
  Services.prefs.clearUserPref("browser.ctrlTab.sortByRecentlyUsed");
  Services.prefs.getDefaultBranch("").setBoolPref("browser.ctrlTab.sortByRecentlyUsed", false);
  Services.prefs.lockPref("browser.ctrlTab.sortByRecentlyUsed");
  await spike.sleep(100);
  gBrowser.tabbox.handleCtrlTab = false;
  spike.log("4 takeover: pref locked =", Services.prefs.prefIsLocked("browser.ctrlTab.sortByRecentlyUsed"),
    "handleCtrlTab =", gBrowser.tabbox.handleCtrlTab, "ctrlTab initialised =", !!ctrlTab._recentlyUsedTabs);

  const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
  const sw = { open: false, order: [], index: 0, log: [] };
  const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:rgba(16,16,20,.8);display:none;" +
    "align-items:center;justify-content:center;gap:16px;font:600 20px Segoe UI,sans-serif;color:#fff");
  document.documentElement.append(overlay);
  const paint = () => {
    overlay.replaceChildren(...sw.order.map((t, i) => vx.el("div", "padding:40px 28px;border-radius:16px;background:" +
      (i === sw.index ? "#4cc2ff;color:#000" : "rgba(255,255,255,.12)"), t.label)));
  };
  window.addEventListener("keydown", (e) => {
    if (ShortcutUtils.getSystemActionForEvent(e) !== ShortcutUtils.CYCLE_TABS) return;
    e.preventDefault();
    e.stopPropagation();
    if (!sw.open) {
      sw.open = true;
      sw.order = [...mru];
      sw.index = 0;
      overlay.style.display = "flex";
    }
    sw.index = (sw.index + (e.shiftKey ? -1 : 1) + sw.order.length) % sw.order.length;
    sw.log.push("step->" + n(sw.order[sw.index]));
    paint();
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Control" || !sw.open) return;
    e.preventDefault();
    e.stopPropagation();
    sw.open = false;
    overlay.style.display = "none";
    sw.log.push("commit->" + n(sw.order[sw.index]));
    gBrowser.selectedTab = sw.order[sw.index];
  }, true);

  before = sel();
  spike.log("4 MRU before", mru.map(n));
  ctrlDown(); tab();
  await spike.sleep(200);
  const mid1 = sel();
  tab();
  await spike.sleep(300);
  await spike.capture("mru-vitre-switcher-held");
  const mid2 = sel();
  ctrlUp();
  await spike.sleep(300);
  spike.log("4 Vitre Ctrl+Tab x2: selected", before, "(held:", mid1, mid2, ") ->", sel(), "handler log", sw.log, "page saw", seen.splice(0));
  spike.log("4 MRU after", mru.map(n), "Firefox panel state", ctrlTab.panel?.state);

  // quick tap = previous tab (classic Alt+Tab behaviour)
  before = sel();
  ctrlDown(); tab(); ctrlUp();
  await spike.sleep(300);
  spike.log("4 quick tap: selected", before, "->", sel(), "MRU", mru.map(n));
  // Ctrl+Shift+Tab goes the other way
  before = sel();
  ctrlDown(); tab(true); ctrlUp();
  await spike.sleep(300);
  spike.log("4 Ctrl+Shift+Tab: selected", before, "->", sel(), "MRU", mru.map(n), "page saw", seen.splice(0));
  // Ctrl+PageDown still belongs to Firefox's tabbox (bar order), unaffected by handleCtrlTab=false
  before = sel();
  EU.synthesizeKey("KEY_PageDown", { ctrlKey: true }, window);
  await spike.sleep(300);
  spike.log("4 Ctrl+PageDown still handled by Firefox tabbox:", before, "->", sel());
  // a user (or Sync) trying to flip the pref cannot bring Firefox's panel back
  try { Services.prefs.setBoolPref("browser.ctrlTab.sortByRecentlyUsed", true); } catch (e) { spike.log("4 set locked pref threw", String(e).slice(0, 60)); }
  spike.log("4 after attempted flip: pref =", Services.prefs.getBoolPref("browser.ctrlTab.sortByRecentlyUsed"), "ctrlTab initialised =", !!ctrlTab._recentlyUsedTabs);
});
