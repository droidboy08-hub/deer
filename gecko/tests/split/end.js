// Split view, every way out (../design/SPLIT-VIEW-SPEC.md "Menus", "Keys", CtxMenu kinds splitpill
// and capsule): Separate tabs, Swap sides, a half's x and middle-click, Ctrl+W on the focused side,
// closing a side from anywhere, the capsule's badge and Close both tabs, Ctrl+Shift+U.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const order = () => b.tabs.map((t) => t.title).join(" | ");
  const pairOn = async (others = ["dark.html", "links.html"]) => {
    const made = await SL.scene(others);
    const pair = b.split(made[1]);
    await SL.shown();
    await SL.until(() => SL.pairItem()?.classList.contains("active"), 3000);
    await sleep(300);
    if (!pair || !SL.pairItem()) log("pairOn: no pair", b.tabs.map((t) => t.title), !!SL.pairItem());
    return made;
  };

  log("--- 1. a half's menu (splitpill): Separate tabs keeps both tabs, focus stays");
  let [fn, tl, ln] = await pairOn();
  let rows = await SL.menuAt(SL.half("right").querySelector(".half-main"));
  const st = SL.rows();
  const sep = st.find((r) => r.label === "Separate tabs");
  const close = st.find((r) => r.label === "Close tab");
  check("the unfocused half's menu: Copy address, Swap sides [P], Separate tabs [E] Ctrl+Shift+U, Close other tabs, Close tab (no Ctrl+W)", rows.includes("Copy address") && rows.includes("Swap sides") && !!sep && sep.key === "Ctrl+Shift+U" && sep.access.toUpperCase() === "E" && rows.includes("Close other tabs") && !!close && close.key === "", st.map((r) => [r.label, r.key, r.access]));
  check("a right-click on a half does not move focus", b.active() === fn, b.active()?.title);
  check("that half shows pressed while its menu is open", SL.half("right").classList.contains("vt-menu-owner"));
  SL.closeMenu();
  await sleep(200);
  rows = await SL.menuAt(SL.half("left").querySelector(".half-main"));
  check("the focused half's Close tab prints Ctrl+W", SL.rows().find((r) => r.label === "Close tab")?.key === "Ctrl+W", SL.rows().map((r) => [r.label, r.key]));
  await SL.pick("Separate tabs");
  await sleep(300);
  check("Separate tabs: no pair, both tabs open in place, the focused side stays active", !b.splitView.active() && order() === "Field Notes | Tideline | Links" && b.active() === fn, { order: order(), active: b.active()?.title });
  check("announced: Split view closed", b.splitView.announced === "Split view closed", b.splitView.announced);
  check("the content area is back to one page (no splitview on the panels)", !gBrowser.tabpanels.hasAttribute("splitview") || !SL.panel(fn).classList.contains("split-view-panel-active"));
  check("the panels lose their pane names and region role with the pair", [fn, tl].every((t) => !SL.panel(t).hasAttribute("aria-label") && !SL.panel(t).hasAttribute("role")), [fn, tl].map((t) => [SL.panel(t).getAttribute("role"), SL.panel(t).getAttribute("aria-label")]));
  await spike.capture("end-1-separated");

  log("--- 2. Swap sides: the pages trade places, the divider stays");
  [fn, tl, ln] = await pairOn();
  b.splitRatio(undefined, 0.3);
  await sleep(300);
  const before = SL.panes();
  rows = await SL.menuAt(SL.half("left").querySelector(".half-main"));
  await SL.pick("Swap sides");
  await sleep(400);
  let p = b.splitView.active();
  const after = SL.panes();
  check("Swap sides: Tideline left, Field Notes right, focus still on Field Notes", p && p.left === tl && p.right === fn && b.active() === fn, p && [p.left.title, p.right.title]);
  check("the divider stays where it was (the ratio moved to the new left tab)", Math.abs(b.splitRatio() - 0.3) < 0.002 && after.left.w === before.left.w, { ratio: b.splitRatio(), before, after });
  check("announced: Sides swapped", b.splitView.announced === "Sides swapped", b.splitView.announced);

  log("--- 3. the x of a half closes that side; the other fills the window");
  [fn, tl, ln] = await pairOn();
  const closed0 = b.closedCount();
  const right = SL.half("right");
  SL.mouse(SL.rect(right).x + 40, 30, { type: "mousemove" });
  await sleep(300);
  const x = right.querySelector(".half-x");
  check("hovering a half shows its x (24 px), named Close right page, Tideline", getComputedStyle(x).display !== "none" && SL.rect(x).w === 24 && x.getAttribute("aria-label") === "Close right page, Tideline", { display: getComputedStyle(x).display, rect: SL.rect(x), name: x.getAttribute("aria-label") });
  spike.click(x);
  await SL.until(() => !b.tabs.includes(tl));
  await SL.until(() => b.closedCount() === closed0 + 1, 3000);
  check("x: Tideline closed (on the closed list), Field Notes alone and active", !b.tabs.includes(tl) && !b.splitView.active() && b.active() === fn && b.closedCount() === closed0 + 1, { order: order(), closed: b.closedCount() - closed0 });

  log("--- 4. middle-click on a half closes that side");
  [fn, tl, ln] = await pairOn();
  // Down and up: Gecko makes the auxclick.
  spike.EU.synthesizeMouseAtCenter(SL.half("left").querySelector(".half-main"), { button: 1 }, window);
  await SL.until(() => !b.tabs.includes(fn));
  check("middle-click on the left half closed Field Notes; Tideline (its partner) took focus", !b.tabs.includes(fn) && b.active() === tl, { order: order(), active: b.active()?.title });

  log("--- 5. Ctrl+W on the focused side: the partner takes focus (not the next tab)");
  [fn, tl, ln] = await pairOn();
  b.activate(tl);
  await sleep(400);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+W");
  await SL.until(() => !b.tabs.includes(tl));
  check("Ctrl+W closed the focused side; its partner is active, not Links after it", !b.tabs.includes(tl) && b.active() === fn, { order: order(), active: b.active()?.title });
  await sleep(200);
  check("announced: Tideline closed. Field Notes fills the window.", b.splitView.announced === "Tideline closed. Field Notes fills the window.", b.splitView.announced);

  log("--- 6. closing a paired tab from anywhere ends the pair");
  [fn, tl, ln] = await pairOn();
  b.activate(ln);
  await sleep(400);
  check("set-up: the pair is in the background as a capsule", !!SL.pairItem() && !SL.pairItem().classList.contains("active"));
  b.closeTab(tl);
  await sleep(400);
  check("b.closeTab on a background side: the pair is gone, Field Notes is a circle, Links stays active", !b.pairOf(fn) && !SL.pairItem() && b.active() === ln && !!document.querySelector(`#vitre-bar .item.tab:not(.leaving)[data-id="${fn.id}"]`), order());

  log("--- 7. the capsule's badge closes that side");
  [fn, tl, ln] = await pairOn();
  b.activate(ln);
  await sleep(500);
  const slot = SL.pairItem().querySelector(".cap-slot.right");
  SL.mouse(SL.rect(slot).x + 10, 30, { type: "mousemove" });
  await sleep(250);
  const badge = slot.querySelector(".close-badge");
  const leftBadge = SL.pairItem().querySelector(".cap-slot.left .close-badge");
  check("hovering a half of the capsule shows only that half's badge, at its outer top corner", getComputedStyle(badge).display !== "none" && getComputedStyle(leftBadge).display === "none" && SL.rect(badge).x === SL.rect(SL.pairItem()).x + 96 - 13, { badge: SL.rect(badge), item: SL.rect(SL.pairItem()) });
  spike.click(badge);
  await SL.until(() => !b.tabs.includes(tl));
  check("the badge closed Tideline; Field Notes is a plain circle", !b.tabs.includes(tl) && !b.pairOf(fn) && b.active() === ln, order());

  log("--- 8. the capsule's menu: Close both tabs (two closed-list entries)");
  [fn, tl, ln] = await pairOn();
  b.splitRatio(undefined, 0.3);
  await sleep(200);
  b.activate(ln);
  await sleep(500);
  const closed1 = b.closedCount();
  rows = await SL.menuAt(SL.pairItem().querySelector(".cap-half"));
  check("capsule menu: caption Field Notes · Tideline, Swap sides, Separate tabs (no key), Close other tabs, Close both tabs (CtxMenu capsule)", JSON.stringify(rows) === JSON.stringify(["Swap sides", "Separate tabs", "Close other tabs", "Close both tabs"]) && SL.rows().find((r) => r.label === "Separate tabs")?.key === "" && (window.vitreMenus.state().captions[0] ?? "") === "Field Notes · Tideline", { rows: SL.rows().map((r) => [r.label, r.key]), captions: window.vitreMenus.state().captions });
  await SL.pick("Close both tabs");
  await SL.until(() => !b.tabs.includes(fn) && !b.tabs.includes(tl));
  check("Close both tabs: both closed, two entries on the closed list, Links stays", !b.tabs.includes(fn) && !b.tabs.includes(tl) && b.closedCount() === closed1 + 2 && b.active() === ln, { order: order(), closed: b.closedCount() - closed1 });
  b.run("reopenClosed");
  await SL.until(() => b.tabs.length === 3);
  await sleep(500);
  // Firefox brings back what one action closed together (SessionWindowUI): both tabs, unpaired.
  check("Ctrl+Shift+T reopens the closed sides as ordinary tabs (no pair)", b.tabs.length === 3 && !b.splitView.pairs().length, order());
  const carried = b.tabs.map((t) => window.SessionStore.getCustomTabValue(t.node, "vitre-split-ratio")).filter(Boolean);
  check("…and neither carries the pair's ratio (0.3) back", carried.length === 0, carried);

  log("--- 9. the capsule's Separate tabs and Swap sides");
  [fn, tl, ln] = await pairOn();
  b.activate(ln);
  await sleep(500);
  await SL.menuAt(SL.pairItem().querySelector(".cap-half"));
  await SL.pick("Swap sides");
  await sleep(300);
  check("capsule Swap sides: Tideline left now, Links still active", b.pairOf(fn)?.left === tl && b.active() === ln, order());
  await SL.menuAt(SL.pairItem().querySelector(".cap-half"));
  await SL.pick("Separate tabs");
  await sleep(300);
  check("capsule Separate tabs: two circles, Links still active", !b.splitView.pairs().length && b.active() === ln, order());

  log("--- 10. Ctrl+Shift+U in a pair is Separate tabs");
  [fn, tl, ln] = await pairOn();
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+Shift+U");
  await SL.until(() => !b.splitView.active(), 3000);
  check("Ctrl+Shift+U separated the pair; the focused side stays active", !b.splitView.active() && b.active() === fn && b.tabs.includes(tl), { order: order(), active: b.active()?.title });

  log("--- 11. a closed left side reopens without the pair's ratio; a new pair from it starts at 50/50");
  [fn, tl, ln] = await pairOn();
  b.splitRatio(undefined, 0.3);
  await sleep(200);
  check("set-up: the ratio 0.3 is on the left (column-0) tab", window.SessionStore.getCustomTabValue(fn.node, "vitre-split-ratio") === "0.300");
  b.focusPage();
  spike.press("Ctrl+W");
  await SL.until(() => !b.tabs.includes(fn));
  await sleep(300);
  const before11 = new Set(b.tabs);
  b.run("reopenClosed");
  await SL.until(() => b.tabs.some((t) => !before11.has(t)), 5000);
  const back11 = b.tabs.find((t) => !before11.has(t));
  await SL.until(() => back11 && SL.loaded(back11), 8000);
  await sleep(300);
  check("Ctrl+Shift+T: the reopened tab carries no ratio", !!back11 && !window.SessionStore.getCustomTabValue(back11.node, "vitre-split-ratio"), back11 && window.SessionStore.getCustomTabValue(back11.node, "vitre-split-ratio"));
  b.activate(back11);
  await sleep(300);
  b.split(tl);
  await SL.shown();
  await sleep(300);
  const area11 = gBrowser.tabpanels.getBoundingClientRect().width - 8;
  check("paired again: 50/50, not the old 0.3", b.splitRatio() === 0.5 && Math.abs(SL.panes().left.w - Math.round(area11 / 2)) <= 1, { ratio: b.splitRatio(), panes: SL.panes() });
});
