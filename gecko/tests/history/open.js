// Every way in and out (../design/HISTORY-SPEC.md "Opening and closing", "Panel switching", "Warm
// state", "With the rest of Deer"): Ctrl+H (toggle, page-first, key repeat ignored), the + circle's
// History row, Esc, Ctrl+W, the x, a click on the dim; focus back where it was; Ctrl+H in the address
// field carrying the typed text; the field taking focus closes the panel; one panel at a time with
// Settings and Downloads, focus landing on the page when the panel that took over closes; warm state
// within 60 s and fresh after; a popup window; element full screen.
//   python tests/history/all.py open
/* global spike, Services, H, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, toolbar, root } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const page = await H.load(H.http("start.html"));
  await H.scene(1);
  H.useClock(1, 14, 40);
  const cl = () => b.root.classList;
  const settings = () => window.vitreSettingsPanel?.panel;
  const downloads = () => b.service("downloads");

  // ---- 1. Ctrl+H toggles ----
  log("--- 1. Ctrl+H");
  b.focusPage();
  await sleep(200);
  H.press("Ctrl+H");
  await until(() => H.isOpen() && rows().length, 4000);
  await sleep(400);
  check("Ctrl+H on the page opens History: panel-open and history-open on the root", H.isOpen() && cl().contains("panel-open") && cl().contains("history-open") && !root().hidden, b.root.className);
  check("focus starts in the empty search field", document.activeElement === H.field() && H.field().value === "", H.focused());
  check("the first rows came from Places", rows().length >= 14, rows().length);
  H.press("Ctrl+H", { repeat: true });
  await sleep(300);
  check("a repeat of Ctrl+H does nothing", H.isOpen());
  H.press("Ctrl+H");
  await until(() => !H.isOpen(), 3000);
  await sleep(300);
  check("Ctrl+H again closes it; panel-open goes; focus back on the page", !H.isOpen() && !cl().contains("panel-open") && !cl().contains("history-open") && document.activeElement === page.browser, H.focused());

  // ---- 2. the + circle ----
  log("--- 2. the + menu");
  const plus = document.querySelector("#vitre-bar .item.plus");
  const menu = await H.menuOn(plus);
  check(
    "the + menu: History  Ctrl+H [H] is the first row of the panel group",
    JSON.stringify(menu.map((r) => r.label)) === JSON.stringify(["New window", "New private window", "Reopen closed tab", "History", "Show downloads", "Full screen", "Settings"]) && menu[3].key === "Ctrl+H",
    menu.map((r) => `${r.label} ${r.key ?? ""}`)
  );
  const mr = H.M().view.rowElement(3, 0).getBoundingClientRect();
  const panelBox = H.M().view.rowElement(0, 0).closest("[role=menu]")?.getBoundingClientRect();
  log("menu size", panelBox && [Math.round(panelBox.width), Math.round(panelBox.height)], "row", Math.round(mr.height));
  // Height by the house rule: 12 + 34 x 7 + 9 x 1. The width is the menus module's own measure of
  // its widest row ("New private window  Ctrl+Shift+N"), the + menu's width before History came.
  check("the + menu with History is 259 high, as wide as before", !!panelBox && Math.round(panelBox.height) === 259 && [288, 296].includes(Math.round(panelBox.width)), panelBox && [panelBox.width, panelBox.height]);
  await spike.capture("open-1-plus-menu");
  await H.pick("History");
  await until(() => H.isOpen(), 3000);
  await sleep(400);
  check("History in the + menu opens the panel", H.isOpen());
  b.service("history").open();
  await sleep(300);
  check("the service's open() (the + row's call) never closes it", H.isOpen());

  // ---- 3. ways out ----
  log("--- 3. ways out");
  H.press("Escape");
  await until(() => !H.isOpen(), 2000);
  check("Esc in the empty field closes it", !H.isOpen());
  await H.open();
  const tabs = b.tabs.length;
  H.press("Ctrl+W");
  await until(() => !H.isOpen(), 2000);
  await sleep(200);
  check("Ctrl+W closes the panel, never the tab", !H.isOpen() && b.tabs.length === tabs);
  await H.open();
  H.click(root().querySelector(".vh-close"));
  await until(() => !H.isOpen(), 2000);
  check("the x closes it", !H.isOpen());
  await H.open();
  H.click({ x: 60, y: 600 });
  await until(() => !H.isOpen(), 2000);
  await sleep(200);
  check("a click on the dim closes it; focus is back on the page", !H.isOpen() && document.activeElement === page.browser, H.focused());
  // Focus returns to the element that had it: a control of the tab bar with keyboard focus.
  const control = [...document.querySelectorAll("#vitre-bar button, #vitre-bar [tabindex]")].find((x) => {
    x.focus();
    return document.activeElement === x;
  });
  if (control) {
    b.service("history").open();
    await until(() => H.isOpen(), 2000);
    await sleep(300);
    H.panel().close();
    await sleep(300);
    check("focus returns to the element that had it before (a tab bar control)", document.activeElement === control, H.focused());
  } else log("no focusable tab bar control to try focus return with");
  b.focusPage();

  // ---- 4. the address field ----
  log("--- 4. the address field");
  H.press("Ctrl+L");
  await until(() => b.omni.open, 2000);
  await sleep(300);
  H.type("tin bath");
  await sleep(200);
  H.press("Ctrl+H");
  await until(() => H.isOpen() && H.store().shown === "tin bath", 4000);
  await sleep(300);
  check("Ctrl+H in the address field opens History searching for what was typed; the field closes", H.isOpen() && !b.omni.open && H.field().value === "tin bath" && rows().some((r) => r.title === "Tin bath"), { field: H.field().value, omni: b.omni.open });
  check("the field's text is selected", document.activeElement === H.field() && H.field().selectionStart === 0 && H.field().selectionEnd === H.field().value.length);
  H.press("Ctrl+L");
  await until(() => b.omni.open && !H.isOpen(), 3000);
  await sleep(300);
  check("Ctrl+L while open: the panel closes and focus is in the address field", !H.isOpen() && document.activeElement === b.omni.input, H.focused());
  // (Without the warm state, which would bring "tin bath" back within 60 s.)
  H.panel().warm = null;
  H.press("Ctrl+H");
  await until(() => H.isOpen(), 3000);
  await sleep(300);
  check("Ctrl+H with the page's own address in the field: no search", H.isOpen() && H.field().value === "", H.field().value);
  H.press("F6");
  await until(() => !H.isOpen(), 2000);
  await sleep(300);
  check("F6 to the address field closes the panel too", !H.isOpen());
  H.press("Escape");
  H.press("Escape");
  await sleep(300);
  b.focusPage();

  // ---- 5. one panel at a time ----
  log("--- 5. Settings and Downloads");
  H.panel().warm = null;
  if (settings()) {
    H.press("Ctrl+Comma");
    await until(() => settings().isOpen, 3000);
    await sleep(300);
    H.press("Ctrl+H");
    await until(() => H.isOpen() && !settings().isOpen, 3000);
    await sleep(400);
    check("Settings open, Ctrl+H: Settings steps aside and History opens", H.isOpen() && !settings().isOpen && cl().contains("history-open") && !cl().contains("settings-open") && cl().contains("panel-open") && H.sheet().contains(document.activeElement), { root: b.root.className, focus: H.focused() });
    H.press("Ctrl+Comma");
    await until(() => settings().isOpen && !H.isOpen(), 3000);
    await sleep(400);
    check("History open, Ctrl+,: History steps aside and Settings opens", settings().isOpen && !H.isOpen() && cl().contains("settings-open") && !cl().contains("history-open") && cl().contains("panel-open"), b.root.className);
    H.press("Escape");
    await until(() => !settings().isOpen, 3000);
    await sleep(400);
    check("Esc closes Settings; focus goes back to the page, not into History's hidden sheet", !cl().contains("panel-open") && document.activeElement === page.browser, H.focused());
  } else check("the Settings module is in the build", false);
  if (downloads()) {
    H.press("Ctrl+H");
    await until(() => H.isOpen(), 3000);
    await sleep(300);
    H.press("Ctrl+J");
    await until(() => downloads().isPanelOpen() && !H.isOpen(), 3000);
    await sleep(400);
    check("History open, Ctrl+J: Downloads takes over", downloads().isPanelOpen() && !H.isOpen() && cl().contains("downloads-open") && !cl().contains("history-open") && cl().contains("panel-open"), b.root.className);
    H.press("Ctrl+H");
    await until(() => H.isOpen() && !downloads().isPanelOpen(), 3000);
    await sleep(400);
    check("Downloads open, Ctrl+H: History takes over", H.isOpen() && !downloads().isPanelOpen() && !cl().contains("downloads-open") && cl().contains("history-open") && H.sheet().contains(document.activeElement), { root: b.root.className, focus: H.focused() });
    const scrims = [...document.querySelectorAll(".vh-scrim, .vd-scrim, .vs-scrim")].filter((s) => getComputedStyle(s).opacity > 0.5 && s.getClientRects().length);
    check("one scrim shows", scrims.length === 1, scrims.length);
    H.press("Escape");
    await until(() => !H.isOpen(), 3000);
    await sleep(300);
    check("…and Esc closes it to the page", !H.isOpen() && document.activeElement === page.browser, H.focused());
    // Downloads over History, then Esc: Downloads gives focus back to History's hidden search field,
    // which can't take it; focus goes back to the page at once, and stays once Downloads' sheet is gone.
    const chains = [["Ctrl+H", "Ctrl+J"]];
    if (settings()) chains.push(["Ctrl+Comma", "Ctrl+H", "Ctrl+J"]);
    for (const chain of chains) {
      b.focusPage();
      await sleep(200);
      for (const k of chain) {
        H.press(k);
        await sleep(600);
      }
      check(`(${chain.join(", ")}: Downloads open, History stepped aside)`, downloads().isPanelOpen() && !H.isOpen() && !settings()?.isOpen, b.root.className);
      H.press("Escape");
      await until(() => !downloads().isPanelOpen(), 3000);
      await sleep(100);
      check(`${chain.join(", ")}, Esc: focus is back on the page at once`, !cl().contains("panel-open") && document.activeElement === page.browser, H.focused());
      await sleep(500);
      check("…and stays there once Downloads' sheet is gone", document.activeElement === page.browser, H.focused());
    }
  } else check("the Downloads module is in the build", false);

  // ---- 6. warm state ----
  log("--- 6. warm state");
  H.panel().warm = null;
  await H.open();
  await H.search("glass");
  const matches = rows().length;
  H.press("Ctrl+W");
  await until(() => !H.isOpen(), 2000);
  await sleep(200);
  await H.open();
  await until(() => H.store().shown === "glass", 3000);
  await sleep(300);
  check("within 60 s the query comes back, selected, with its results", H.field().value === "glass" && H.field().selectionStart === 0 && H.field().selectionEnd === 5 && rows().length === matches, { value: H.field().value, n: rows().length, matches });
  await H.search("");
  H.store().loadMore(200);
  await sleep(800);
  H.scroller().scrollTop = 300;
  await sleep(200);
  const seen = H.visibleRows();
  H.click(seen[1].el.querySelector(".vh-slot"));
  await sleep(200);
  check("(a row is selected before the close)", H.toolbar().text === "1 selected", H.toolbar().text);
  seen[4].el.focus();
  H.press("Down");
  await sleep(150);
  const focusedTitle = H.focused();
  const top = H.scroller().scrollTop;
  H.press("Ctrl+W");
  await until(() => !H.isOpen(), 2000);
  await sleep(200);
  H.press("Ctrl+H");
  await until(() => H.isOpen() && rows().length, 4000);
  await sleep(800);
  const stop = H.list().querySelector('[tabindex="0"]');
  check("…and the scroll position and the focused row come back", Math.abs(H.scroller().scrollTop - top) < 2 && stop && "row:" + stop.querySelector(".vh-title")?.textContent === focusedTitle, { top, now: H.scroller().scrollTop, focusedTitle, stop: stop?.textContent });
  check("the selection never comes back", rows().every((r) => !r.selected) && toolbar().text !== "1 selected", toolbar().text);
  H.press("Ctrl+W");
  await until(() => !H.isOpen(), 2000);
  // 61 s later (the warm state's time moved back).
  H.panel().warm.at -= 61000;
  await sleep(200);
  await H.open();
  await sleep(500);
  check("after 60 s it opens fresh: All history, no query, at the top", H.field().value === "" && H.scroller().scrollTop === 0 && root().querySelector('.vh-view[aria-current="page"]').dataset.view === "all", { value: H.field().value, top: H.scroller().scrollTop });
  await H.close();

  // ---- 7. a popup window ----
  log("--- 7. a popup window");
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  await H.load(H.http("opener.html"));
  const before = new Set(Services.wm.getEnumerator("navigator:browser"));
  const a = await H.inPage(function (w, d) {
    const r = d.getElementById("a").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  H.click({ x: br.left + a.x, y: br.top + a.y });
  const pop = await until(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => !before.has(w) && w.vitre?.ready), 10000);
  if (pop) {
    await sleep(800);
    check("the popup is a Deer popup", pop.vitre.isPopup === true);
    pop.focus();
    await sleep(300);
    pop.vitre.run("history");
    await until(() => H.isOpen(), 3000);
    await sleep(400);
    check("Ctrl+H in a popup opens History in the normal window, which comes to the front", H.isOpen() && !pop.vitreHistory.panel.isOpen && Services.focus.activeWindow === window, { main: H.isOpen(), popup: pop.vitreHistory?.panel.isOpen });
    await H.close();
    pop.close();
    await sleep(500);
  } else check("a popup window opened", false);
  Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
  await spike.activate();

  // ---- 8. element full screen ----
  log("--- 8. element full screen");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  await H.load(H.http("fs.html"));
  b.focusPage();
  await sleep(150);
  await H.inPage(function (w, d) {
    d.getElementById("v").requestFullscreen().catch(() => {});
    return 1;
  });
  const inFs = await until(() => document.documentElement.hasAttribute("inDOMFullscreen"), 5000);
  await sleep(900);
  if (inFs) {
    b.focusPage();
    await sleep(150);
    H.press("Ctrl+H");
    await until(() => !document.documentElement.hasAttribute("inDOMFullscreen") && H.isOpen(), 5000);
    await sleep(500);
    check("Ctrl+H in element full screen leaves it first, then History shows", !document.documentElement.hasAttribute("inDOMFullscreen") && H.isOpen() && getComputedStyle(b.root).display !== "none");
    await H.close();
  } else check("element full screen could be entered for the test", false);
  Services.prefs.clearUserPref("full-screen-api.allow-trusted-requests-only");
});
