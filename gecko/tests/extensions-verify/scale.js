// 150% scaling (layout.css.devPixelsPerPx = 1.5, set while running): the cluster keeps its CSS sizes
// (28 px round buttons, 14 px badges), popups, the panel and menus still hang 8 px under the pill
// with their right edge on the button, and the narrow-pill rules work in CSS px.
//   python tests/extensions/runx.py --test tests/extensions-verify/scale.js --name extensions-verify-scale --app build-extensions-verify-all --out tests/extensions-verify/out/scale
// Captures: scale-1-pill-150, scale-2-popup-150, scale-3-panel-150, scale-4-menu-150.
/* global spike, gBrowser, Services, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["popup", "blocker", "badge", "dnr", "menus", "command", "pin1", "panelonly"]) await xt.install(name);
  await xt.waitFor(() => xt.pinnedInPill().length === 7, 8000);

  Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.5");
  await xt.waitFor(() => window.devicePixelRatio === 1.5, 5000);
  await spike.resize(1280, 800);
  await sleep(1200);
  await xt.nav(xt.page() + "?scale");
  await sleep(800);
  log("dpr", window.devicePixelRatio, "inner", window.innerWidth, window.innerHeight, "pill", xt.rect(b.bar.item(b.activeId)));
  check("150%: devicePixelRatio 1.5, the window is 1280 CSS px wide", window.devicePixelRatio === 1.5 && Math.abs(window.innerWidth - 1280) <= 16, { dpr: window.devicePixelRatio, w: window.innerWidth });
  const buttons = [...xt.toolbar().querySelectorAll(".unified-extensions-item-action-button")].filter((n) => n.getClientRects().length);
  const sizes = buttons.map((n) => xt.rect(n));
  log("buttons", sizes, "ext button", xt.rect(xt.extButton()), "visible", xt.visibleInPill().length);
  check("150%: pinned buttons are 28 CSS px round at y 20", sizes.length >= 4 && sizes.every((r) => r.w === 28 && r.h === 28 && r.y === 20), sizes);
  const badge = xt.button("blocker")?.querySelector(".toolbarbutton-badge");
  const br = badge?.getBoundingClientRect();
  log("badge", br && { w: br.width, h: br.height, x: br.x, y: br.y }, badge?.textContent);
  check("150%: the badge is a 14 CSS px capsule", !!br && Math.abs(br.height - 14) < 0.6 && br.width >= 13.5, br && { w: br.width, h: br.height });
  check("150%: the address keeps at least 140 CSS px", xt.rect(b.bar.item(b.activeId).querySelector(".address")).w >= 140, xt.rect(b.bar.item(b.activeId).querySelector(".address")));
  await capture("scale-1-pill-150");

  spike.click(xt.button("popup"));
  const wp = await xt.waitFor(() => xt.widgetPanel(), 6000);
  await sleep(900);
  log("popup", xt.rect(wp), "button", xt.rect(xt.button("popup")));
  check("150%: the popup hangs 8 px under the pill, right edge on its button", !!wp && Math.abs(xt.rect(wp).y + 4 - 64) <= 2 && Math.abs(xt.rect(wp).r - 4 - xt.rect(xt.button("popup")).r) <= 2, { wp: xt.rect(wp), button: xt.rect(xt.button("popup")) });
  await capture("scale-2-popup-150");
  await xt.closePopups();

  spike.click(xt.extButton());
  const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 6000);
  await sleep(900);
  log("panel", xt.rect(panel), "ext button", xt.rect(xt.extButton()));
  check("150%: the extensions panel hangs at 64, right edge on the extensions button", !!panel && Math.abs(xt.rect(panel).y + 4 - 64) <= 2 && Math.abs(xt.rect(panel).r - 4 - xt.rect(xt.extButton()).r) <= 2, xt.rect(panel));
  await capture("scale-3-panel-150");
  await xt.closePopups();

  const rows = vx.menuRows();
  vx.rightClick(xt.button("blocker"));
  await xt.waitFor(() => window.vitreMenus?.state?.()?.open, 3000);
  await sleep(500);
  const mr = window.vitreMenus.state().rect;
  log("menu", mr, "button", xt.rect(xt.button("blocker")));
  check("150%: the button menu hangs at 64, right edge on the button", !!mr && Math.round(mr.top) === 64 && Math.abs(mr.left + mr.width - xt.rect(xt.button("blocker")).r) <= 1, mr);
  await capture("scale-4-menu-150");
  b.service("menus")?.close();
  rows.undo();
  await sleep(300);

  // Narrow at 150%: the rules are in CSS px.
  await spike.resize(640, 600);
  await sleep(900);
  log("640 CSS px: pill", xt.rect(b.bar.item(b.activeId)), "visible", xt.visibleInPill().length, "address", xt.rect(b.bar.item(b.activeId).querySelector(".address")));
  check("150%, 640 CSS px wide: the address keeps 100 CSS px", xt.rect(b.bar.item(b.activeId).querySelector(".address")).w >= 100);
  await spike.resize(1280, 800);
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await xt.waitFor(() => window.devicePixelRatio === 1, 5000);
  await sleep(800);
  check("back to 100%: 28 px buttons", xt.rect(xt.button("blocker")).w === 28);
  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
