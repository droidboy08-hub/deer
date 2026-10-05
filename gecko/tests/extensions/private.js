// Private windows and a second window: extensions without private access are absent from a private
// window's pill (and block nothing there); Firefox's panel explains it; allowing the extension
// (Settings › Extensions' switch, VitreExtensions.setPrivateAllowed) brings its button and its
// blocking there. A second normal window has its own cluster; pinning in one shows in both.
//   python tests/extensions/runx.py --test tests/extensions/private.js --name extensions-private --app build-extensions --timeout 240
// Captures: private-1-second-window, private-2-no-access, private-3-panel, private-4-allowed.
/* global spike, Services, CustomizableUI, xt */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1100, 720);
  await spike.activate();
  await xt.nav(xt.page());
  await xt.install("blocker");
  await xt.install("popup");
  await xt.waitFor(() => xt.button("blocker") && xt.button("popup"), 6000);

  const load = async (win, url) => {
    win.gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await xt.waitFor(() => win.gBrowser.selectedBrowser.currentURI.spec === url && !win.gBrowser.selectedBrowser.webProgress?.isLoadingDocument, 15000);
    await sleep(800);
  };
  const inPill = (win) => [...(win.document.getElementById("vitre-ext-bar")?.children ?? [])].map((n) => n.id);

  // ---- second normal window ----
  const w2 = await spike.openWindow();
  w2.resizeTo(1100, 720);
  w2.moveTo(60, 60);
  await sleep(800);
  await load(w2, xt.page() + "?w2");
  log("window 2 pill", inPill(w2));
  check("second window: its own cluster with both buttons", inPill(w2).length === 2 && !!w2.document.getElementById("unified-extensions-button")?.closest(".vx-cluster"), inPill(w2));
  check("second window: blocking works", (w2.gBrowser.selectedTab.label || "").includes("a1=blocked"), w2.gBrowser.selectedTab.label);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("popup"), false);
  await xt.waitFor(() => inPill(w2).length === 1, 3000);
  check("unpinned in window 1: gone from window 2's pill too", inPill(w2).length === 1 && inPill(window).length === 1, { w1: inPill(window), w2: inPill(w2) });
  w2.gUnifiedExtensions.pinToToolbar(xt.widgetId("popup"), true);
  await xt.waitFor(() => inPill(window).length === 2, 3000);
  check("pinned from window 2: back in both", inPill(window).length === 2 && inPill(w2).length === 2);
  await w2.spike.capture("private-1-second-window");
  w2.close();
  await sleep(800);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("popup"), false);
  await sleep(300);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("popup"), true);
  await sleep(300);
  check("window 1 still works after window 2 closed", inPill(window).length === 2);

  // ---- private window ----
  const pw = await spike.openWindow({ private: true });
  pw.resizeTo(1100, 720);
  pw.moveTo(60, 60);
  await sleep(800);
  await load(pw, xt.page() + "?private");
  log("private pill", inPill(pw), "title", pw.gBrowser.selectedTab.label);
  check("private window: no button of an extension without private access", inPill(pw).length === 0, inPill(pw));
  check("private window: no blocking without private access", (pw.gBrowser.selectedTab.label || "").includes("a1=loaded"), pw.gBrowser.selectedTab.label);
  check("private window: the extensions button is there", !!pw.document.getElementById("unified-extensions-button")?.closest(".vx-cluster"));
  check("private window: 'extensions' count is 0", pw.vitre.service("extensions").count() === 0);
  await pw.spike.capture("private-2-no-access");

  pw.spike.click(pw.document.getElementById("unified-extensions-button"));
  const panel = await xt.waitFor(() => { const p = pw.document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 6000);
  await sleep(1000);
  const text = (panel?.textContent || "").replace(/\s+/g, " ").trim();
  log("private panel", text.slice(0, 200));
  check("private window: Firefox's panel explains extensions are off there", !!panel && /private/i.test(text), text.slice(0, 120));
  await pw.spike.capture("private-3-panel");
  panel?.hidePopup();
  await sleep(400);

  await sys.setPrivateAllowed(xt.id("blocker"), true);
  await xt.waitFor(() => inPill(pw).includes(xt.widgetId("blocker")), 10000);
  await load(pw, xt.page() + "?private2");
  check("allowed: its button appears in the private window's pill", inPill(pw).includes(xt.widgetId("blocker")) && !inPill(pw).includes(xt.widgetId("popup")), inPill(pw));
  check("allowed: it blocks in the private window", (pw.gBrowser.selectedTab.label || "").includes("a1=blocked"), pw.gBrowser.selectedTab.label);
  await pw.spike.capture("private-4-allowed");
  pw.close();
  await sleep(600);
});
