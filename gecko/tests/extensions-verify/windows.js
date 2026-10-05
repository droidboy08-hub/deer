// Several windows: leaks when windows close (weak references to each closed window's cluster after
// GC + CC), a window closed with its panel open, popup windows (window.open with features), private
// windows and page actions, a tab moved to a new window keeping its badge.
//   python tests/extensions/runx.py --test tests/extensions-verify/windows.js --name extensions-verify-windows --app build-extensions-verify-all --out tests/extensions-verify/out/windows
// Captures: windows-1-popup-window, windows-2-moved-tab.
/* global spike, gBrowser, Services, Cc, Ci, Cu, ChromeUtils, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep } = spike;
  await spike.resize(1200, 760);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["popup", "blocker", "badge", "dnr", "menus", "command", "pin1", "pin2", "pageaction"]) await xt.install(name);
  await xt.waitFor(() => xt.pinnedInPill().length === 8, 8000);
  await xt.nav(xt.page() + "?w1");
  await sleep(500);
  const load = async (win, url) => {
    win.gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await xt.waitFor(() => win.gBrowser.selectedBrowser.currentURI.spec === url && !win.gBrowser.selectedBrowser.webProgress?.isLoadingDocument, 15000);
    await sleep(600);
  };
  const paApi = xt.pageActionFor("pageaction");
  const listeners = () => paApi?.__vitreUpdateListeners?.size ?? -1;
  check("one window: one page action repaint listener", listeners() === 1, listeners());

  // ---- 1. windows opened and closed: nothing of theirs stays alive ----
  const refs = [];
  for (let i = 0; i < 3; i++) {
    const w2 = await spike.openWindow();
    w2.resizeTo(1100, 700);
    await sleep(600);
    await load(w2, xt.page() + "?leak" + i);
    const bar2 = w2.vitreExtensions.bar;
    check(`window ${i + 2}: its own cluster with the pinned buttons and the page action`, bar2.drawn() && w2.document.getElementById("vitre-ext-bar").children.length === 8 && bar2.pageActions.buttons.size === 1, w2.document.getElementById("vitre-ext-bar").children.length);
    if (i === 0) {
      check("two windows: a page action repaint listener each", listeners() === 2, listeners());
      // Close it with its extensions panel open and four buttons lent to the panel.
      w2.spike.click(w2.document.getElementById("unified-extensions-button"));
      await xt.waitFor(() => w2.document.getElementById("unified-extensions-panel")?.state === "open", 5000);
      await sleep(500);
      log("window 2 panel open, lent", [...bar2.lent]);
    }
    if (i === 1) {
      w2.spike.click(w2.document.getElementById(xt.widgetId("popup")).querySelector(".unified-extensions-item-action-button"));
      await xt.waitFor(() => w2.document.getElementById("customizationui-widget-panel")?.state === "open", 5000);
      await sleep(500);
    }
    if (i === 2) {
      // Closed with Settings › Extensions on screen: its page listens to the process singleton.
      w2.vitre.service("settings")?.open("extensions");
      await xt.waitFor(() => w2.document.querySelector(".vx-page .vx-card"), 5000);
      await sleep(400);
    }
    refs.push({ bar: Cu.getWeakReference(bar2), page: Cu.getWeakReference(w2.vitreExtensions.page), core: Cu.getWeakReference(w2.vitre.bar), win: Cu.getWeakReference(w2) });
    w2.close();
    await xt.waitFor(() => w2.closed, 5000);
    await sleep(500);
  }
  await spike.activate();
  await sleep(500);
  check("after closing them: one page action repaint listener again", listeners() === 1, listeners());
  check("window 1 still consistent (8 pinned, order, nothing lent)", xt.pinnedInPill().length === 8 && window.vitreExtensions.bar.lent.size === 0 && xt.visibleInPill().length >= 4, { pinned: xt.pinnedInPill().length, visible: xt.visibleInPill().length });
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin1"), false);
  await sleep(300);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin1"), true);
  await sleep(300);
  check("window 1: pin / unpin still works after the others closed", xt.area("pin1") === "vitre-ext-bar" && xt.pinnedInPill().includes(xt.widgetId("pin1")));
  for (let i = 0; i < 6 && refs.some((r) => r.bar.get() || r.page.get()); i++) {
    await vx.gc(3);
    await sleep(1000);
  }
  const alive = refs.map((r) => ({ bar: !!r.bar.get(), page: !!r.page.get(), core: !!r.core.get(), win: !!r.win.get() }));
  log("closed windows still alive after GC/CC:", alive);
  check("closed windows: their extensions clusters and Settings pages are collected (no leak)", alive.every((a) => !a.bar && !a.page), alive);

  // ---- 2. a popup window (window.open with features) ----
  // The popup blocker would refuse an open() without a user gesture: off for this step.
  Services.prefs.setBoolPref("dom.disable_open_during_load", false);
  // window.open with features opens a tab by product default; restriction 2 (Firefox's own default)
  // gives a popup window (as tests/find-verify/windows.js).
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  const popupWin = await new Promise((resolve) => {
    setTimeout(() => resolve(null), 15000);
    const obs = (subject) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      Promise.resolve(subject.vitre?.whenReady).then(() => resolve(subject));
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
    const url = xt.page() + "?popupwin";
    gBrowser.selectedBrowser.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`content.open(${JSON.stringify(url)}, "vx", "width=520,height=420,left=80,top=80");`), false);
  });
  check("a popup window opened", !!popupWin);
  if (!popupWin) throw new Error("no popup window");
  await sleep(1500);
  log("popup window", popupWin.vitre?.isPopup, "cluster drawn", popupWin.vitreExtensions?.bar?.drawn(), "count", popupWin.vitre?.service("extensions")?.count());
  check("popup window: Vitre's popup layout, the cluster is not drawn", popupWin.vitre?.isPopup === true && popupWin.vitreExtensions?.bar?.drawn() === false);
  await popupWin.spike.capture("windows-1-popup-window");
  popupWin.focus();
  await sleep(400);
  // The service still answers there: with nothing to anchor to, it opens Settings or does nothing.
  let threw = "";
  try {
    popupWin.vitre.service("extensions").openPanel();
  } catch (e) {
    threw = String(e);
  }
  await sleep(1200);
  log("popup window openPanel ->", threw || "ok", "panel", popupWin.document.getElementById("unified-extensions-panel")?.state, "tabs in window 1", gBrowser.tabs.length);
  check("popup window: openPanel() does not throw and opens no panel without an anchor", !threw && popupWin.document.getElementById("unified-extensions-panel")?.state !== "open");
  popupWin.close();
  await sleep(600);
  await spike.activate();
  // Settings may have opened in window 1 (a popup window has no panel of its own).
  b.service("settings")?.close?.();
  await sleep(400);

  // ---- 3. private window: page action only with private access ----
  const pw = await spike.openWindow({ private: true });
  pw.resizeTo(1100, 700);
  await sleep(600);
  await load(pw, xt.page() + "?private");
  check("private window: no page action button without private access", pw.vitreExtensions.bar.pageActions.buttons.size === 0);
  await b.sys("VitreExtensions").setPrivateAllowed(xt.id("pageaction"), true);
  await xt.waitFor(() => pw.vitreExtensions.bar.pageActions.buttons.size === 1, 8000);
  await load(pw, xt.page() + "?private2");
  const ppa = pw.vitreExtensions.bar.pageActions.buttons.get(xt.id("pageaction"));
  check("private window: allowed, the page action button shows there", !!ppa && !ppa.hidden && ppa.getClientRects().length > 0);
  check("window 1 kept its page action through the reload", !!window.vitreExtensions.bar.pageActions.buttons.get(xt.id("pageaction")));
  pw.close();
  await sleep(600);
  await spike.activate();

  // ---- 4. a tab moved to a new window keeps its badge there ----
  await xt.nav(xt.page() + "?move");
  await xt.waitFor(() => xt.button("blocker")?.querySelector(".toolbarbutton-badge")?.textContent === "2", 6000);
  b.newTab(xt.page("/install.html"));
  await sleep(1200);
  const moving = b.tabs.find((t) => t.url.endsWith("?move"));
  const moved = new Promise((resolve) => {
    const obs = (subject) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      Promise.resolve(subject.vitre?.whenReady).then(() => resolve(subject));
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  b.moveToNewWindow(moving);
  const w3 = await moved;
  await sleep(1500);
  const badge3 = () => w3.document.getElementById(xt.widgetId("blocker"))?.querySelector(".toolbarbutton-badge")?.textContent;
  await xt.waitFor(() => badge3() === "2", 5000);
  log("moved tab: url", w3.gBrowser.selectedBrowser.currentURI.spec, "badge", badge3());
  check("a tab moved to a new window keeps its badge in that window's pill", badge3() === "2" && w3.vitreExtensions.bar.drawn(), badge3());
  await w3.spike.capture("windows-2-moved-tab");
  w3.close();
  await sleep(600);
  await spike.activate();

  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
