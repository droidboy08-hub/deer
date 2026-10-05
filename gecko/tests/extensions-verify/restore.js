// Restart and session restore: the pinned order the user chose survives (also across a private-
// access change, which reloads the add-on), an unpinned add-on stays in the panel, the restored
// active tab gets its page action and its blocking, and the cluster is in the restored active pill.
//   python tests/extensions/runx.py --test tests/extensions-verify/restore.js --name extensions-verify-restore --app build-extensions-verify-all --out tests/extensions-verify/out/restore
// Captures: restore-1-before, restore-2-after.
/* global spike, gBrowser, Services, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1280, 800);
  await spike.activate();
  const order = () => CustomizableUI.getWidgetIdsInArea("vitre-ext-bar");
  const want = [xt.widgetId("pin2"), xt.widgetId("blocker"), xt.widgetId("popup")];

  if (spike.run === 1) {
    // Session restore of the tabs on the next start.
    Services.prefs.setIntPref("browser.startup.page", 3);
    await xt.nav(xt.page() + "?tab1");
    for (const name of ["popup", "blocker", "pin1", "pin2", "pageaction"]) await sys.loadTemporary(xt.extPath(name));
    await xt.waitFor(() => xt.pinnedInPill().length === 4, 8000);
    // The user's order: pin2 first, pin1 unpinned.
    window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin1"), false);
    CustomizableUI.moveWidgetWithinArea(xt.widgetId("pin2"), 0);
    CustomizableUI.moveWidgetWithinArea(xt.widgetId("blocker"), 1);
    await sleep(300);
    check("run 1: the order is pin2, blocker, popup", order().join() === want.join(), order());
    // Private access reloads the add-on: its button must come back where it was.
    await sys.setPrivateAllowed(xt.id("blocker"), true);
    await xt.waitFor(() => xt.button("blocker"), 6000);
    await sleep(500);
    check("private access changed (add-on reloaded): its button keeps its place", order().join() === want.join() && xt.pinnedInPill().join() === want.join(), { cui: order(), nodes: xt.pinnedInPill() });
    b.newTab(xt.page() + "?tab2");
    await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.endsWith("?tab2") && !b.active()?.loading, 8000);
    b.newTab(xt.page("/install.html"));
    await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.endsWith("/install.html") && !b.active()?.loading, 8000);
    b.activate(b.tabs[1]);
    await sleep(1200);
    await capture("restore-1-before");
    await sleep(1500); // let SessionStore write
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  await sys.restored;
  await xt.waitFor(() => xt.pinnedInPill().length === 3, 10000);
  await xt.waitFor(() => b.tabs.length === 3, 10000);
  await sleep(1500);
  log("restored tabs", b.tabs.map((t) => t.url), "active", b.active()?.url, "pill", xt.pinnedInPill(), "pin1 area", xt.area("pin1"));
  check("restart: three tabs restored, the second active", b.tabs.length === 3 && /\?tab2$/.test(b.active()?.url ?? ""), b.tabs.map((t) => t.url));
  check("restart: pinned order kept (pin2, blocker, popup)", order().join() === want.join() && xt.pinnedInPill().join() === want.join(), { cui: order(), nodes: xt.pinnedInPill() });
  check("restart: pin1 still in the extensions panel", xt.area("pin1") === CustomizableUI.AREA_ADDONS);
  check("restart: the cluster is in the restored active pill and drawn", b.bar.item(b.activeId)?.contains(xt.cluster()) && window.vitreExtensions.bar.drawn());
  // The temporary add-ons start after the window: the restored active tab may have loaded before
  // the blocker existed. A reload is what the user sees blocked.
  const pa = await xt.waitFor(() => { const x = window.vitreExtensions.bar.pageActions.buttons.get(xt.id("pageaction")); return x && !x.hidden ? x : null; }, 6000);
  check("restart: the page action shows on the restored active tab", !!pa);
  log("restored tab title before reload", gBrowser.selectedTab.label);
  gBrowser.reload();
  await xt.waitFor(() => !b.active()?.loading && /a1=blocked/.test(gBrowser.selectedTab.label || ""), 10000);
  check("restart: the blocker blocks on the restored tab (after a reload)", /a1=blocked/.test(gBrowser.selectedTab.label || ""), gBrowser.selectedTab.label);
  await capture("restore-2-after");
  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
