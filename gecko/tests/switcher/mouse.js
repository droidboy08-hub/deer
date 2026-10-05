// The switcher with the mouse (SwitcherKeys, TabMotion "Close a tab"): in the deck a click selects a
// neighbour and a second click opens it, a dock circle selects, a middle click closes a card, a click
// on the wallpaper cancels; in the grid a click opens, the close badge closes, the New tab card opens
// a tab; in the strip a click opens and a click beside the panel cancels.
// python tools/run.py --test tests/switcher/mouse.js --name switcher-mouse --app build-switcher --timeout 200
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, sleep, state } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  const page = (name, colour) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>${name}</title><body style="margin:0;background:${colour};font:28px Segoe UI"><p style="margin:140px 60px">${name}</p>`);
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
  await S.openTabs(names.map((n, i) => page(n, ["#f4f1ea", "#dfe9f3", "#f3e0e0", "#e2f0df", "#ece2f3", "#f3efd9"][i])));
  const byName = (n) => b.tabs.find((t) => t.title === n);
  const order = ["Foxtrot", "Echo", "Delta", "Charlie", "Bravo", "Alpha"];
  const reset = async () => {
    await S.visit(order.map(byName).filter(Boolean));
    await sleep(200);
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const openLatched = async () => {
    b.service("switcher").open("latched");
    await S.waitFor(() => state().phase === "open");
    await sleep(700);
  };
  const closed = () => S.waitFor(() => state().phase === "idle", { what: "switcher closed" }).then(() => sleep(250));
  await reset();

  // ---- deck ----
  await S.setStyle("deck");
  await openLatched();
  const right = document.querySelector(`#layer-switcher .sw-dcard[data-id="${byName("Charlie").id}"]`);
  const [rx, ry] = center(right);
  spike.click(Math.min(rx, innerWidth - 40), ry);
  await sleep(500);
  const afterOne = S.selected();
  check("deck: a click on a neighbour card selects it (the deck slides)", afterOne === "Charlie" && state().phase === "open", afterOne);
  spike.click(innerWidth / 2, innerHeight / 2);
  await closed();
  check("deck: a click on the selected card opens it", S.active() === "Charlie", S.active());
  await reset();
  // Held (Ctrl down): the dock shows the tab circles (latched it is the search field).
  await S.holdOpen(1);
  await sleep(600);
  const dot = document.querySelector(`#layer-switcher .sw-dot[data-id="${byName("Echo").id}"]`);
  spike.click(dot, { ctrlKey: true });
  await sleep(400);
  check("deck, held: a click on a dock circle selects that tab", S.selected() === "Echo", S.selected());
  S.press("Shift+Tab");
  S.press("Shift+Tab");
  await sleep(500);
  const tabsBefore = b.tabs.length;
  const neighbour = document.querySelector(`#layer-switcher .sw-dcard[data-id="${byName("Delta").id}"]`);
  const [nx, ny] = center(neighbour);
  spike.click(Math.min(nx, innerWidth - 40), ny, { button: 1, ctrlKey: true });
  await sleep(500);
  check("deck, held: a middle click on a neighbour card closes its tab", b.tabs.length === tabsBefore - 1 && !byName("Delta") && state().phase === "open", { tabs: b.tabs.length, selected: S.selected() });
  await spike.capture("mouse-deck-after-close");
  spike.click(720, 40, { ctrlKey: true });
  await closed();
  S.up("Control");
  await sleep(200);
  check("deck: a click on the wallpaper cancels", S.active() === "Alpha", S.active());

  // ---- grid ----
  await S.setStyle("grid");
  await openLatched();
  const card = document.querySelector(`#layer-switcher .sw-gcard[data-id="${byName("Echo").id}"]`);
  spike.click(card.querySelector(".sw-gface"), { type: "mousemove" });
  await sleep(250);
  const badge = card.querySelector(".sw-x");
  const badgeOpacity = getComputedStyle(badge).opacity;
  await spike.capture("mouse-grid-hover");
  const n0 = b.tabs.length;
  spike.click(badge);
  await sleep(500);
  check("grid: hovering a card shows its close badge; clicking it closes the tab", badgeOpacity === "1" && b.tabs.length === n0 - 1 && !byName("Echo") && state().phase === "open", { badgeOpacity, tabs: b.tabs.length });
  const bravo = document.querySelector(`#layer-switcher .sw-gcard[data-id="${byName("Bravo").id}"] .sw-gface`);
  spike.click(bravo);
  await closed();
  check("grid: a click on a card opens it", S.active() === "Bravo", S.active());
  await openLatched();
  const n1 = b.tabs.length;
  spike.click(document.querySelector("#layer-switcher .sw-gnew"));
  await closed();
  await sleep(500);
  check("grid: the New tab card opens a tab with the address field", b.tabs.length === n1 + 1 && b.active().kind === "home" && b.omni.open, { tabs: b.tabs.length, kind: b.active().kind, omni: b.omni.open });
  b.omni.close();
  b.closeTab(b.active());
  await sleep(300);

  // ---- strip ----
  await S.setStyle("strip");
  await reset();
  await openLatched();
  const scard = document.querySelector(`#layer-switcher .sw-scard[data-id="${byName("Foxtrot").id}"] .sw-sface`);
  spike.click(scard);
  await closed();
  check("strip: a click on a card opens it", S.active() === "Foxtrot", S.active());
  await openLatched();
  spike.click(80, 800);
  await closed();
  check("strip: a click beside the panel cancels", S.active() === "Foxtrot", S.active());
  await S.setStyle("deck");
});
