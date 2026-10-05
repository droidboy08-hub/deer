// Rapid and repeated input on the extensions cluster, idle cost, add-ons coming and going, and the
// module's console errors.
//   python tests/extensions/runx.py --test tests/extensions-verify/stress.js --name extensions-verify-stress --app build-extensions-verify-all --out tests/extensions-verify/out/stress
// Captures: stress-1-after-clicks, stress-2-after-storm.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["popup", "blocker", "badge", "dnr", "menus", "command", "pin1", "pin2", "panelonly"]) await xt.install(name);
  await vx.install("storm");
  await xt.waitFor(() => xt.pinnedInPill().length === 9, 8000);
  // The storm button first, so it is one of the five that fit.
  CustomizableUI.moveWidgetWithinArea(vx.widgetId("storm"), 0);
  await xt.nav(xt.page() + "?stress");
  await sleep(800);
  const bar = window.vitreExtensions.bar;
  const panel = () => document.getElementById("unified-extensions-panel");
  const order = () => CustomizableUI.getWidgetIdsInArea("vitre-ext-bar").filter((id) => document.getElementById(id));
  const consistent = () => {
    const nodes = xt.pinnedInPill();
    const cui = order();
    return {
      ok: nodes.join() === cui.join() && bar.lent.size === 0 && !panel()?.querySelector("#overflowed-extensions-list")?.children.length && xt.visibleInPill().length === 5,
      nodes, cui, lent: [...bar.lent], visible: xt.visibleInPill().length,
    };
  };
  check("start: 9 pinned, 5 visible, order matches CustomizableUI", consistent().ok, consistent());

  // Count the module's work.
  const counts = { fit: 0, place: 0, paint: 0, tips: 0 };
  for (const [obj, name, key] of [[bar, "fit", "fit"], [bar, "place", "place"], [bar.pageActions, "paint", "paint"], [bar, "tipFor", "tips"]]) {
    const original = obj[name];
    obj[name] = function (...args) {
      counts[key]++;
      return original.apply(this, args);
    };
  }
  const take = () => {
    const c = { ...counts };
    for (const k in counts) counts[k] = 0;
    return c;
  };

  // ---- 1. idle: nothing runs ----
  take();
  spike.click(640, 600, { type: "mousemove" });
  await sleep(500);
  take();
  const cpu0 = (await ChromeUtils.requestProcInfo()).cpuTime;
  await sleep(10000);
  const cpu1 = (await ChromeUtils.requestProcInfo()).cpuTime;
  const idle = take();
  const ms = (cpu1 - cpu0) / 1e6;
  log("idle 10 s:", idle, "parent CPU ms", Math.round(ms));
  check("idle 10 s: the cluster does no work (no fit / place / paint / tooltip passes)", idle.fit + idle.place + idle.paint + idle.tips === 0, idle);
  // (CPU over the same 10 s is logged only: a fresh profile's own start-up work dominates it; idle.js
  // compares the quietest windows with and without extensions.)

  // ---- 2. a badge storm (an ad blocker on a busy page) ----
  const stormButton = () => document.getElementById(vx.widgetId("storm"))?.querySelector(".unified-extensions-item-action-button");
  spike.click(stormButton());
  await sleep(200);
  take();
  const t0 = (await ChromeUtils.requestProcInfo()).cpuTime;
  await sleep(3500);
  const t1 = (await ChromeUtils.requestProcInfo()).cpuTime;
  const storm = take();
  const badgeNow = document.getElementById(vx.widgetId("storm"))?.querySelector(".toolbarbutton-badge")?.textContent;
  log("badge storm 3.5 s:", storm, "parent CPU ms", Math.round((t1 - t0) / 1e6), "badge", badgeNow, "tip", stormButton()?.getAttribute("data-tip"));
  check("badge storm: the badge follows (about 75 updates)", Number(badgeNow) >= 50, badgeNow);
  // One title change in five badge updates; a title change is a few attribute records (label,
  // tooltiptext, and Vitre taking tooltiptext away): badge updates alone must cost nothing.
  check("badge storm: no refits; tooltips follow title changes only", storm.fit === 0 && storm.place === 0 && storm.tips <= Math.max(8, Math.floor(Number(badgeNow) / 5) * 4), storm);
  check("badge storm: its tooltip is Vitre's, with the latest title", /^Badge Storm \d+$/.test(stormButton()?.getAttribute("data-tip") || ""), stormButton()?.getAttribute("data-tip"));
  await capture("stress-2-after-storm");

  // ---- 3. rapid clicks on the extensions button ----
  for (let i = 0; i < 9; i++) {
    spike.click(xt.extButton());
    await sleep(30 + (i % 3) * 40);
  }
  await sleep(2500);
  log("after 9 rapid clicks: panel", panel()?.state, "lent", [...bar.lent], "button open", xt.extButton().open);
  if (panel()?.state === "open") {
    check("rapid clicks, panel left open: the hidden pinned buttons are in it", panel().querySelector("#overflowed-extensions-list")?.children.length === 4, panel().querySelector("#overflowed-extensions-list")?.children.length);
    await xt.closePopups();
    await sleep(400);
  }
  check("after rapid clicks and close: pill consistent (order, nothing lent, 5 visible)", consistent().ok, consistent());
  check("the extensions button is not left pressed", !xt.extButton().open && !xt.extButton().hasAttribute("open"));
  await capture("stress-1-after-clicks");

  // ---- 4. open the panel, then pin / unpin from outside while it is open ----
  spike.click(xt.extButton());
  await xt.waitFor(() => panel()?.state === "open", 4000);
  await sleep(500);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin2"), false);
  await sleep(300);
  window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin2"), true);
  await sleep(300);
  await xt.closePopups();
  await sleep(400);
  log("after pin/unpin while the panel was open", consistent());
  check("pin / unpin while the panel is open: pill consistent afterwards", consistent().ok, consistent());

  // ---- 5. 20 quick pin / unpin toggles ----
  for (let i = 0; i < 20; i++) window.gUnifiedExtensions.pinToToolbar(xt.widgetId("pin1"), i % 2 === 1);
  await sleep(600);
  check("20 quick toggles: ends pinned, one node, order consistent", xt.area("pin1") === "vitre-ext-bar" && document.querySelectorAll("#" + CSS.escape(xt.widgetId("pin1"))).length === 1 && consistent().ok, consistent());

  // ---- 6. rapid right-clicks: one menu, no leftover scratch popups ----
  const scratch = () => document.querySelectorAll("#mainPopupSet > menupopup[hidden='true']:not([id])").length;
  const before = scratch();
  for (let i = 0; i < 6; i++) {
    vx.rightClick(xt.button("menus"));
    await sleep(15);
  }
  await sleep(800);
  const menuOpen = window.vitreMenus?.state?.()?.open;
  b.service("menus")?.close();
  await sleep(600);
  log("scratch popups before", before, "after", scratch(), "menu was open", menuOpen);
  check("6 rapid right-clicks: a menu is open, no scratch popup left behind once it closed", !!menuOpen && scratch() === before, { before, after: scratch() });

  // ---- 7. a page action extension installed and removed five times ----
  for (let i = 0; i < 5; i++) {
    const addon = await xt.install("pageaction");
    await xt.waitFor(() => bar.pageActions.buttons.size === 1, 4000);
    await addon.uninstall();
    await xt.waitFor(() => bar.pageActions.buttons.size === 0, 4000);
  }
  await sleep(300);
  check("page action extension in and out 5 times: no button left over", bar.pageActions.buttons.size === 0 && xt.cluster().querySelectorAll(".vx-pa").length === 0, xt.cluster().querySelectorAll(".vx-pa").length);
  const last = await xt.install("pageaction");
  await xt.nav(xt.page() + "?pa-again");
  const pa = await xt.waitFor(() => { const x = bar.pageActions.buttons.get(xt.id("pageaction")); return x && !x.hidden ? x : null; }, 5000);
  const api = xt.pageActionFor("pageaction");
  check("reinstalled page action shows, with one repaint listener for this window", !!pa && api?.__vitreUpdateListeners?.size === 1, api?.__vitreUpdateListeners?.size);
  await last.uninstall();

  // ---- 8. extensions removed while their popup is open ----
  spike.click(xt.button("popup"));
  await xt.waitFor(() => xt.widgetPanel(), 5000);
  await sleep(500);
  await (await xt.AddonManager.getAddonByID(xt.id("popup"))).uninstall();
  await sleep(800);
  check("uninstalled with its popup open: the popup is gone, tips are back", !xt.widgetPanel() && !!xt.button("blocker")?.hasAttribute("data-tip"), vx.openPopups());
  check("...and the pill is consistent", xt.pinnedInPill().join() === order().join() && bar.lent.size === 0, { nodes: xt.pinnedInPill(), cui: order() });

  // ---- 9. disable everything, enable everything ----
  const all = (await xt.AddonManager.getAddonsByTypes(["extension"])).filter((a) => /@vitre\.(test|verify)$/.test(a.id));
  for (const a of all) await a.disable();
  await sleep(500);
  check("all disabled: no pinned button, the extensions button stays", xt.pinnedInPill().length === 0 && !!xt.extButton()?.getClientRects().length);
  for (const a of all) await a.enable();
  await xt.waitFor(() => xt.pinnedInPill().length === 8, 8000);
  await sleep(500);
  check("all enabled again: 8 pinned back, consistent", xt.pinnedInPill().length === 8 && xt.pinnedInPill().join() === order().join(), xt.pinnedInPill());

  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
