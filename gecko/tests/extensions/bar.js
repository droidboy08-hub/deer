// Extensions in the pill: the cluster, pinned buttons (1, 3 and 8), overflow into Firefox's panel,
// badges, popups and the panel hanging under the bar, page actions, keyboard commands, the menus.
//   python tests/extensions/runx.py --test tests/extensions/bar.js --name extensions-bar --app build-extensions --timeout 240
// Captures (popups composited by runx.py): bar-1-one-pinned, bar-2-three-pinned, bar-3-eight-pinned,
// bar-4-popup, bar-5-panel, bar-6-page-action, bar-7-menu, bar-8-dark, bar-9-home.
/* global spike, gBrowser, Services, CustomizableUI, xt */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();

  // ---- 1. module, area, button, prefs ----
  check("module installed", b.modules.includes("extensions"), b.moduleErrors);
  const sys = b.sys("VitreExtensions");
  check("singleton inited", sys.inited);
  check("pill toolbar is a CustomizableUI toolbar area", CustomizableUI.getAreaType("vitre-ext-bar") === CustomizableUI.TYPE_TOOLBAR);
  check("toolbar inside the active pill's accessories", !!xt.toolbar()?.closest(".item.active .accessories"), xt.rect(xt.toolbar()));
  check("extensions button moved into the cluster", xt.extButton()?.parentElement === xt.cluster());
  check("extensions button visible pref locked", Services.prefs.prefIsLocked("extensions.unifiedExtensions.button.always_visible") && Services.prefs.getBoolPref("extensions.unifiedExtensions.button.always_visible"));
  check("abuse reports off", Services.prefs.getBoolPref("extensions.abuseReport.enabled") === false);
  check("'extensions' service", typeof b.service("extensions")?.openPanel === "function" && b.service("extensions").count() === 0);

  await xt.nav(xt.page());
  log("pill", xt.rect(b.bar.item(b.activeId)), "cluster", xt.rect(xt.cluster()), "ext button", xt.rect(xt.extButton()));
  const undoMark = xt.showDownloadMark();

  // ---- 2. one pinned ----
  await xt.install("popup");
  await xt.waitFor(() => xt.button("popup"));
  await sleep(400);
  check("1 pinned: default_area navbar lands in the pill", xt.area("popup") === "vitre-ext-bar" && xt.visibleInPill().length === 1, { area: xt.area("popup"), pill: xt.pinnedInPill() });
  log("1 pinned: button", xt.rect(xt.button("popup")), "ext button", xt.rect(xt.extButton()), "address", xt.rect(b.bar.item(b.activeId)?.querySelector(".address")));
  check("button is 28 px round at y 20", (() => { const r = xt.rect(xt.button("popup")); return r && r.w === 28 && r.h === 28 && r.y === 20; })(), xt.rect(xt.button("popup")));
  // The test extensions report their state through their title, so the tip is that title.
  check("tooltip is Vitre's (data-tip = the action title), Firefox's tooltiptext removed", xt.button("popup").getAttribute("data-tip") === xt.actionData("popup").title && !xt.button("popup").hasAttribute("tooltiptext"), xt.button("popup").getAttribute("data-tip"));
  check("extensions button tooltip", xt.extButton().getAttribute("data-tip") === "Extensions" && !xt.extButton().hasAttribute("tooltiptext"));
  await capture("bar-1-one-pinned");

  // ---- 3. three pinned, badges ----
  await xt.install("blocker");
  await xt.install("badge");
  await xt.waitFor(() => xt.button("blocker") && xt.button("badge"));
  await xt.nav(xt.page() + "?three");
  await xt.waitFor(() => xt.reported("blocker")?.blocked >= 2, 6000);
  await sleep(500);
  const badge = (name) => xt.button(name)?.querySelector(".toolbarbutton-badge");
  check("3 pinned", xt.visibleInPill().length === 3, xt.visibleInPill());
  check("blocker blocked the /ads/ images (webRequestBlocking)", (gBrowser.selectedTab.label || "").includes("a1=blocked") && (gBrowser.selectedTab.label || "").includes("o1=loaded"), gBrowser.selectedTab.label);
  check("blocker badge shows the count", badge("blocker")?.textContent === "2", badge("blocker")?.textContent);
  log("badge rect", xt.rect(badge("blocker")), "style", badge("blocker")?.getAttribute("style"));
  check("badge extension badge", badge("badge")?.textContent === "3", badge("badge")?.textContent);
  await capture("bar-2-three-pinned");

  // ---- 4. eight pinned: five fit, three overflow ----
  for (const name of ["dnr", "menus", "command", "pin1", "pin2"]) await xt.install(name);
  await xt.install("panelonly");
  await xt.waitFor(() => xt.pinnedInPill().length === 8, 8000);
  await xt.nav(xt.page() + "?eight");
  await sleep(800);
  const st = window.vitreExtensions.bar;
  log("8 pinned: in pill", xt.pinnedInPill(), "visible", xt.visibleInPill(), "overflowed", [...st.overflowed]);
  check("8 pinned, 5 visible, 3 hidden for room", xt.pinnedInPill().length === 8 && xt.visibleInPill().length === 5 && st.overflowed.size === 3, { pinned: xt.pinnedInPill().length, visible: xt.visibleInPill().length });
  const address = b.bar.item(b.activeId)?.querySelector(".address");
  check("address keeps at least 140 px", xt.rect(address).w >= 140, xt.rect(address));
  check("panelonly stays in the panel", xt.area("panelonly") === CustomizableUI.AREA_ADDONS);
  check("dnr blocked /dnr-ads/", (gBrowser.selectedTab.label || "").includes("a2=blocked"), gBrowser.selectedTab.label);
  check("'extensions' count", b.service("extensions").count() === 9, b.service("extensions").count());
  await capture("bar-3-eight-pinned");
  undoMark();

  // ---- 5. an extension popup hangs 8 px under the pill, right-aligned to its button ----
  const pillRect = () => xt.rect(b.bar.item(b.activeId));
  spike.click(xt.button("popup"));
  let wp = await xt.waitFor(() => xt.widgetPanel(), 6000);
  await sleep(900);
  const pr = xt.rect(wp);
  const br = xt.rect(xt.button("popup"));
  log("popup panel", pr, "button", br, "anchor", wp?.anchorNode?.className, "pill", pillRect());
  check("popup opens from the pill button", !!wp && xt.button("popup").hasAttribute("open"));
  check("popup anchored to the hang point in the cluster", wp?.anchorNode?.classList?.contains("vx-hang"), wp?.anchorNode?.localName);
  check("popup hangs 8 px under the pill (visible top 64), right edge on the button's", Math.abs(pr.y + 4 - 64) <= 2 && Math.abs(pr.r - 4 - br.r) <= 2, { pr, br });
  check("no tooltip while the popup is open", !b.bar.tips.shownFor && !xt.button("popup").hasAttribute("data-tip"));
  await capture("bar-4-popup");
  const shadow = wp ? Math.round((wp.getBoundingClientRect().height - wp.shadowRoot?.querySelector("[part=content]")?.getBoundingClientRect().height || 0) / 2) : 0;
  log("panel shadow margin estimate", shadow);
  await xt.closePopups();
  check("popup closed, button no longer open", !xt.button("popup").hasAttribute("open"));

  // ---- 6. the extensions panel: the panel-only extension and the three that did not fit ----
  spike.click(xt.extButton());
  const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 6000);
  await sleep(900);
  const overflowList = panel?.querySelector("#overflowed-extensions-list");
  const addonsArea = panel?.querySelector("#unified-extensions-area");
  log("panel", xt.rect(panel), "ext button", xt.rect(xt.extButton()), "overflow list", [...(overflowList?.children ?? [])].map((n) => n.id), "area", [...(addonsArea?.children ?? [])].map((n) => n.id));
  check("panel opens from the extensions button", !!panel && panel.anchorNode?.closest?.("#unified-extensions-button"));
  check("panel hangs 8 px under the pill (visible top at 64), right edge on the button's", !!panel && Math.abs(xt.rect(panel).y + 4 - 64) <= 2 && Math.abs(xt.rect(panel).r - 4 - xt.rect(xt.extButton()).r) <= 6, xt.rect(panel));
  check("the three hidden pinned buttons are listed in the panel", overflowList?.children.length === 3, overflowList?.children.length);
  check("the panel-only extension is listed", !!addonsArea?.querySelector("#" + CSS.escape(xt.widgetId("panelonly"))));
  await capture("bar-5-panel");
  await xt.closePopups();
  await sleep(300);
  check("the lent buttons came back to the pill, hidden for room, in order", xt.pinnedInPill().length === 8 && xt.visibleInPill().length === 5 && xt.pinnedInPill()[5] === xt.widgetId("command"), xt.pinnedInPill());
  check("lent buttons lost the panel attributes", !xt.node("pin1").hasAttribute("overflowedItem") && !xt.node("pin1").hasAttribute("cui-anchorid"));

  // The 'extensions' service opens the same panel.
  b.service("extensions").openPanel();
  const viaService = await xt.waitFor(() => document.getElementById("unified-extensions-panel")?.state === "open", 5000);
  check("'extensions' service openPanel() opens the panel", !!viaService);
  await xt.closePopups();
  await sleep(300);

  // ---- 7. keyboard commands (real key pipeline) ----
  xt.realKey("Ctrl+Shift+Y");
  wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
  await sleep(700);
  log("Ctrl+Shift+Y popup", xt.rect(wp), "anchor", wp?.anchorNode?.className, "ext button", xt.rect(xt.extButton()));
  check("_execute_browser_action (Ctrl+Shift+Y) opens the command extension's popup", !!wp);
  check("its button is hidden for room: the popup hangs from the extensions button", !!wp && Math.abs(xt.rect(wp).r - xt.rect(xt.extButton()).r) <= 12, { panel: xt.rect(wp), button: xt.rect(xt.extButton()) });
  await xt.closePopups();
  xt.realKey("Ctrl+Shift+O");
  const said = await xt.waitFor(() => xt.reported("command")?.commands?.includes("say-hello"), 4000);
  check("a custom command (Ctrl+Shift+O) reaches the extension", !!said, xt.reported("command"));

  // ---- 8. page actions ----
  await xt.install("pageaction");
  await xt.nav(xt.page() + "?pa");
  const paButton = () => window.vitreExtensions.bar.pageActions.buttons.get(xt.id("pageaction"));
  await xt.waitFor(() => paButton() && !paButton().hidden, 5000);
  log("page action button", xt.rect(paButton()), "img", paButton()?.querySelector("img")?.getAttribute("src")?.slice(0, 60), "tip", paButton()?.getAttribute("data-tip"));
  check("page action button shown on a matching page", !!paButton() && !paButton().hidden);
  check("Firefox's anchor override names it", xt.pageActionFor("pageaction")?.browserPageAction?._anchorIDOverride === paButton()?.id);
  check("a shown page action leaves room: 4 pinned visible", xt.visibleInPill().length === 4, xt.visibleInPill().length);
  spike.click(paButton());
  const paPanel = () => { const p = document.getElementById("pageaction_vitre_test-panel"); return p?.state === "open" ? p : null; };
  let pap = await xt.waitFor(paPanel, 6000);
  await sleep(900);
  log("page action popup", xt.rect(pap), "button", xt.rect(paButton()), "anchor", pap?.anchorNode?.className);
  check("page action popup opens anchored to its button's hang point, 8 px under the pill", !!pap && pap.anchorNode?.classList?.contains("vx-hang") && Math.abs(xt.rect(pap).r - 4 - xt.rect(paButton()).r) <= 2 && Math.abs(xt.rect(pap).y + 4 - 64) <= 2, xt.rect(pap));
  await capture("bar-6-page-action");
  await xt.closePopups();
  xt.realKey("Ctrl+Shift+U");
  pap = await xt.waitFor(paPanel, 5000);
  check("_execute_page_action (Ctrl+Shift+U) opens it too", !!pap);
  await xt.closePopups();
  await xt.nav("http://localhost:47651/page.html?other");
  await sleep(500);
  check("page action hidden on a page it does not match", paButton()?.hidden === true && xt.visibleInPill().length === 5);
  // Back on a page without the page action: five pinned buttons visible again (menus among them).
  await xt.nav("http://localhost:47651/page.html?menus");

  // ---- 9. right-click menus through the 'menus' service ----
  const menus = b.service("menus");
  check("'menus' service present in this build", !!menus);
  if (menus) {
    let rows = null;
    const show = menus.show;
    menus.show = function (items, at, opts) {
      rows = items;
      return show.call(this, items, at, opts);
    };
    const rightClick = (el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, screenX: window.mozInnerScreenX + r.left + r.width / 2, screenY: window.mozInnerScreenY + r.top + r.height / 2 }));
    };
    const labels = () => (rows || []).map((r) => ("separator" in r ? "---" : "caption" in r ? "[" + r.caption + "]" : r.label + (r.checked !== undefined ? (r.checked ? " [x]" : " [ ]") : "") + (r.submenu ? " >" : "") + (r.disabled ? " (disabled)" : "")));
    rightClick(xt.button("menus"));
    await xt.waitFor(() => rows, 3000);
    await sleep(500);
    log("pinned button menu", labels());
    check("menu: the extension's own items first (labels escaped, check item, submenu)", labels().slice(0, 5).join("|") === "Open the && log|Strict mode [ ]|---|More >|---", labels());
    check("menu: Manage, Remove, Pin (checked), no Report", labels().includes("&Manage extension") && labels().includes("&Remove extension…") && labels().includes("&Pin to tab bar [x]") && !labels().some((l) => /report/i.test(l)), labels());
    check("no native toolbar menu opened", document.getElementById("toolbar-context-menu")?.state !== "open");
    const mr = window.vitreMenus?.state?.()?.rect;
    log("menu rect", mr, "button", xt.rect(xt.button("menus")));
    check("menu hangs 8 px under the pill, right edge on the button's", !!mr && Math.round(mr.top) === 64 && Math.abs(mr.left + mr.width - xt.rect(xt.button("menus")).r) <= 1, mr);
    await capture("bar-7-menu");
    const strict = rows.find((r) => r.label === "Strict mode");
    menus.close();
    strict.run();
    const clicked = await xt.waitFor(() => xt.reported("menus")?.strict === true, 4000);
    check("choosing an extension item reaches menus.onClicked", !!clicked, xt.reported("menus"));
    await sleep(300);
    rows = null;
    rightClick(xt.button("menus"));
    await xt.waitFor(() => rows, 3000);
    menus.close();
    rows.find((r) => r.label === "&Pin to tab bar").run();
    await xt.waitFor(() => xt.area("menus") === CustomizableUI.AREA_ADDONS, 3000);
    check("Pin to tab bar unchecked: the extension moves to the panel", xt.area("menus") === CustomizableUI.AREA_ADDONS && !xt.pinnedInPill().includes(xt.widgetId("menus")));
    window.gUnifiedExtensions.pinToToolbar(xt.widgetId("menus"), true);
    await xt.waitFor(() => xt.area("menus") === "vitre-ext-bar", 3000);
    check("gUnifiedExtensions.pinToToolbar(id, true) pins to the pill", xt.area("menus") === "vitre-ext-bar");
    rows = null;
    rightClick(xt.extButton());
    await xt.waitFor(() => rows, 3000);
    log("extensions button menu", labels());
    check("extensions button menu", labels().join("|") === "Show &extensions panel|Extension &settings|&Get add-ons", labels());
    menus.close();
    menus.show = show;
    await sleep(300);
  }

  // ---- 10. dark glass ----
  await xt.nav("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>Dark</title><body style='margin:0;background:#15161a;color:#ddd;font:16px Segoe UI'><div style='padding:120px 80px'>A dark page</div>"));
  await xt.waitFor(() => b.theme() === "dark", 4000);
  await sleep(500);
  check("dark glass: the toolbar asks for dark-theme icons (brighttext)", xt.toolbar().hasAttribute("brighttext"), b.theme());
  await capture("bar-8-dark");

  // ---- 11. Home: the cluster is not drawn; a command popup hangs from the pill ----
  b.newTab();
  await xt.waitFor(() => b.active()?.kind === "home", 4000);
  await sleep(600);
  b.omni.open && b.omni.close();
  await sleep(300);
  check("Home: the cluster is not drawn", !window.vitreExtensions.bar.drawn());
  xt.realKey("Ctrl+Shift+Y");
  wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
  await sleep(700);
  log("Home popup", xt.rect(wp), "pill", pillRect(), "anchor", wp?.anchorNode?.className);
  check("Home: the command popup opens under the pill", !!wp && Math.abs(xt.rect(wp).r - pillRect().r) <= 12, { panel: xt.rect(wp), pill: pillRect() });
  await capture("bar-9-home");
  await xt.closePopups();

  // ---- 12. narrow windows: pins give way first, then the whole cluster ----
  b.closeTab(b.active());
  await xt.nav(xt.page() + "?narrow");
  await spike.resize(640, 700);
  await sleep(700);
  log("640 wide: pill", pillRect(), "visible", xt.visibleInPill().length, "address", xt.rect(b.bar.item(b.activeId)?.querySelector(".address")), "lent", [...window.vitreExtensions.bar.lent], "pa", paButton()?.className, paButton()?.hidden, "layout", b.bar.layout.pillRect?.width);
  log("cluster children", [...xt.cluster().children].map((c) => (c.id || c.className) + " " + JSON.stringify(xt.rect(c))), "cluster", xt.rect(xt.cluster()), xt.cluster().className);
  check("narrow pill: no pinned button fits, the extensions button stays", xt.visibleInPill().length === 0 && window.vitreExtensions.bar.drawn() && !!xt.extButton().getClientRects().length);
  check("narrow pill: the page action waits for room too; the address keeps 100 px", !paButton().getClientRects().length && xt.rect(b.bar.item(b.activeId)?.querySelector(".address")).w >= 100, xt.rect(b.bar.item(b.activeId)?.querySelector(".address")));
  await capture("bar-10-narrow");
  await spike.resize(520, 700);
  await sleep(700);
  log("520 wide: pill", pillRect(), "address", xt.rect(b.bar.item(b.activeId)?.querySelector(".address")));
  check("very narrow pill: the cluster steps out, the address keeps its room", !window.vitreExtensions.bar.drawn());
  await spike.resize(1280, 800);
  await sleep(500);
  check("wide again: the page action and four pinned visible", xt.visibleInPill().length === 4 && !!paButton().getClientRects().length, xt.visibleInPill().length);
  log("done");
});
