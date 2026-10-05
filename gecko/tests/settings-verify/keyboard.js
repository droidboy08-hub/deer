// Settings verifier: everything by keyboard alone. Open from the page, move through the sidebar,
// Tab into a page and use every kind of control (style tiles, drop-downs, switches, check boxes,
// radio rows, segmented buttons), the focus trap, Find a setting into its results, a rebind and its
// Reset, the Caret browsing switch, and Home's Background popover.
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/keyboard.js --name settings-verify-keyboard --timeout 240
// Captures: keyboard-caret.png (the new Caret browsing row), keyboard-popover.png (the popover by keys).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const store = b.sys("VitreSettings");
  store.set({ theme: "dark" });
  await V.load(V.page("Keyboard page", "<p style='margin:120px 40px'>Nothing but keys. <a href='https://example.com/'>link</a></p>"));
  const at = () => V.active();
  const nav = (id) => V.root().querySelector(`.vs-navitem[data-id="${id}"]`);
  const keys = async (...list) => {
    for (const k of list) {
      V.press(k);
      await sleep(90);
    }
    await sleep(150);
  };

  // ---------------------------------------------------------------- open, sidebar
  b.focusPage();
  await sleep(150);
  await keys("Ctrl+Comma");
  await waitFor(() => V.isOpen(), { timeout: 3000, what: "open" });
  await sleep(300);
  check("Ctrl+, from the page: focus on the current sidebar item", at() === nav("general"), V.describe(at()));
  await keys("Down", "Down", "Down");
  check("Down moves through the sidebar and shows each page (Tabs)", at() === nav("tabs") && V.shown() === "tabs" && nav("tabs").getAttribute("aria-current") === "page", { focus: V.describe(at()), shown: V.shown() });
  await keys("End");
  check("End: the last page", at() === nav("about") && V.shown() === "about");
  await keys("Home", "Up");
  check("Up from the first wraps to the last", at() === nav("about"));
  await keys("Up", "Up", "Up", "Up", "Up");
  check("…and back up to Tabs", at() === nav("tabs") && V.shown() === "tabs", V.shown());

  // ---------------------------------------------------------------- Tabs page by keys
  await keys("Tab");
  const tile = (v) => V.content().querySelector(`.vs-style[data-value="${v}"]`);
  check("Tab goes into the page: the selected switcher style tile", at() === tile(store.get().switcherStyle), V.describe(at()));
  await keys("Right");
  check("Right chooses the next style (Grid) and moves focus to it", store.get().switcherStyle === "grid" && at() === tile("grid") && tile("grid").getAttribute("aria-checked") === "true");
  await keys("Left");
  check("Left back to the deck", store.get().switcherStyle === "deck");
  await keys("Tab");
  const orderBox = V.rowFor("Order of tabs").querySelector(".vs-dd");
  check("Tab: the Order of tabs drop-down", at() === orderBox, V.describe(at()));
  await keys("Alt+Down");
  check("Alt+Down opens its list with focus in it", !!V.sheet().querySelector(".vs-pop") && V.sheet().querySelector(".vs-pop") === at());
  await keys("Down", "Enter");
  check("Down, Enter picks Tab bar order; focus back on the box", store.get().tabOrder === "bar" && at() === orderBox && !V.sheet().querySelector(".vs-pop"), { order: store.get().tabOrder, focus: V.describe(at()) });
  await keys("F4");
  check("F4 opens it too", !!V.sheet().querySelector(".vs-pop"));
  await keys("m", "Enter");
  check("type-ahead (m) finds Most recently used", store.get().tabOrder === "recent", store.get().tabOrder);
  await keys("Down");
  check("Down on a closed box steps to the next choice (as Windows)", store.get().tabOrder === "bar");
  await keys("Up");
  await keys("Tab");
  const typeSwitch = V.rowFor("Type to search while switching").querySelector(".vs-switch");
  check("Tab: the Type to search switch", at() === typeSwitch, V.describe(at()));
  await keys("Space");
  check("Space turns it off", store.get().typeToSearch === false && typeSwitch.getAttribute("aria-checked") === "false");
  await keys("Space");
  check("…and on", store.get().typeToSearch === true);

  // Focus trap: from the last control Tab wraps to the first; Shift+Tab the other way.
  const focusables = () => [...V.sheet().querySelectorAll("button, input, [tabindex]")].filter((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[hidden]") && el.getClientRects().length);
  const list = focusables();
  list[list.length - 1].focus();
  await keys("Tab");
  check("Tab from the last control wraps to the first (the panel keeps focus)", at() === list[0], { focus: V.describe(at()), first: V.describe(list[0]) });
  await keys("Shift+Tab");
  check("Shift+Tab from the first goes to the last", at() === list[list.length - 1], V.describe(at()));

  // ---------------------------------------------------------------- Find a setting
  await keys("Ctrl+F");
  const search = V.root().querySelector(".vs-search-input");
  check("Ctrl+F focuses Find a setting", at() === search);
  spike.type("limit speed");
  await sleep(300);
  await keys("Down");
  const speedBox = V.rowFor("Limit speed")?.querySelector(".vs-dd");
  check("Down from the field goes to the first result's control", !!speedBox && at() === speedBox, V.describe(at()));
  await keys("Ctrl+F", "Escape");
  check("Ctrl+F back in the field, Esc clears it", at() === search && search.value === "" && V.shown() !== "results");
  await keys("Down");
  check("Down from the empty field goes to the sidebar", at()?.classList.contains("vs-navitem"), V.describe(at()));

  // ---------------------------------------------------------------- Privacy, Search engine
  await keys("Escape");
  b.focusPage();
  await sleep(150);
  await keys("Ctrl+Shift+Delete");
  await sleep(300);
  const clearBox = V.content().querySelector(".vs-clear");
  check("Ctrl+Shift+Delete: focus on the time range", at() === clearBox.querySelector(".vs-dd"), V.describe(at()));
  await keys("Tab");
  const hist = clearBox.querySelector('.vs-check[data-id="history"]');
  check("Tab: the Browsing history check box", at() === hist);
  await keys("Space");
  check("Space unticks it", hist.getAttribute("aria-checked") === "false");
  await keys("Space");
  check("…and ticks it", hist.getAttribute("aria-checked") === "true");
  await keys("Shift+Tab", "Shift+Tab");
  const navPrivacy = nav("privacy");
  // From the sidebar: down to Search engine, into its radios.
  navPrivacy.focus();
  await keys("Down", "Tab");
  const radios = [...V.content().querySelectorAll(".vs-radio")];
  const engine0 = store.get().searchEngine;
  check("Search engine page: Tab lands on the selected radio", radios.includes(at()) && at().getAttribute("aria-checked") === "true", V.describe(at()));
  await keys("Down");
  check("Down chooses the next engine", store.get().searchEngine !== engine0 && at().getAttribute("aria-checked") === "true", store.get().searchEngine);
  store.reset("searchEngine");
  await sleep(150);

  // ---------------------------------------------------------------- Keyboard shortcuts: rebind, Reset, Caret browsing
  nav("shortcuts").focus();
  await keys("Enter");
  b.service("settings").open("shortcuts");
  await sleep(300);
  const keyBtn = () => V.root().querySelector('[data-rebind="peekLink"] .vs-keybtn');
  keyBtn().focus();
  await keys("Enter");
  check("Enter on the key opens the capture field", !!at()?.closest("[data-key-capture]"));
  await keys("Ctrl+Shift+Y");
  check("pressing the new keys saves them; focus back on the key", store.get().rebind.peekLink === "Ctrl+Shift+Y" && at() === keyBtn(), { rebind: store.get().rebind, focus: V.describe(at()) });
  await keys("Shift+Tab");
  const reset = V.root().querySelector('[data-rebind="peekLink"] .vs-link');
  check("Shift+Tab reaches its Reset", at() === reset, V.describe(at()));
  await keys("Enter");
  check("Enter resets it; focus on the key again", !store.get().rebind.peekLink && at() === keyBtn(), V.describe(at()));

  const caretRow = V.rowFor("Caret browsing");
  check("Keyboard shortcuts has a Caret browsing switch (keymap.json)", !!caretRow && !!caretRow.querySelector(".vs-switch"));
  if (caretRow) {
    caretRow.scrollIntoView({ block: "center" });
    const sw = caretRow.querySelector(".vs-switch");
    sw.focus();
    await keys("Space");
    const inContent = await V.inPage(function () { return Services.prefs.getBoolPref("accessibility.browsewithcaret", false); });
    check("Space turns caret browsing on (Firefox's pref, seen by the page's process)", Services.prefs.getBoolPref("accessibility.browsewithcaret") === true && sw.getAttribute("aria-checked") === "true" && inContent === true, { inContent });
    await spike.capture("keyboard-caret");
    Services.prefs.setBoolPref("accessibility.browsewithcaret", false);
    await sleep(150);
    check("the switch follows the pref changed elsewhere (about:config)", sw.getAttribute("aria-checked") === "false" && caretRow.querySelector(".vs-state").textContent === "Off");
    Services.prefs.clearUserPref("accessibility.browsewithcaret");
  }
  const search2 = V.root().querySelector(".vs-search-input");
  search2.focus();
  spike.type("caret");
  await sleep(300);
  check("Find a setting finds it", !!V.rowFor("Caret browsing"), [...V.content().querySelectorAll(".vs-title")].map((x) => x.textContent));
  await keys("Escape", "Escape");
  check("Esc, Esc: cleared, then closed; focus back on the page", !panel.isOpen && at() === gBrowser.selectedBrowser, V.describe(at()));

  // ---------------------------------------------------------------- Home's Background popover by keys
  b.newTab();
  await sleep(400);
  if (b.omni.open) b.omni.close();
  await waitFor(() => b.active().url === "about:vitre-home", { timeout: 10000, what: "Home" });
  await sleep(600);
  const face = document.querySelector("#vitre-home-bg .hb-circle-face");
  face.focus();
  await keys("Enter");
  await waitFor(() => V.b && window.vitreSettingsPanel.home.isOpen && document.querySelector("#vitre-home-bg-pop .hb-picker")?.dataset.ready, { timeout: 5000, what: "popover" });
  await sleep(500);
  const pop = document.getElementById("vitre-home-bg-pop");
  check("Enter on the circle opens the popover with focus on the chosen tile", pop.contains(at()) && at().classList.contains("hb-tile") && at().getAttribute("aria-checked") === "true", V.describe(at()));
  check("no tooltip over the popover it opened", !document.querySelector(".vitre-tip:not([hidden])") && !face.dataset.tip);
  await spike.capture("keyboard-popover");
  const tiles = [...pop.querySelectorAll(".hb-tile")];
  if (tiles.length > 2) {
    const i0 = tiles.indexOf(at());
    await keys("Right");
    check("arrows move between tiles without choosing", tiles.indexOf(at()) === Math.min(i0 + 1, tiles.length - 1) && at().getAttribute("aria-checked") !== "true");
  }
  const popFocusables = [...pop.querySelectorAll("button, [tabindex]")].filter((el) => el.tabIndex >= 0 && !el.closest("[hidden]"));
  popFocusables[popFocusables.length - 1].focus();
  await keys("Tab");
  check("Tab wraps inside the popover", pop.contains(at()) && at() === popFocusables[0], V.describe(at()));
  await keys("Escape");
  await sleep(250);
  check("Esc closes it; focus back on the circle, whose tooltip is back", !window.vitreSettingsPanel.home.isOpen && at() === face && face.dataset.tip === "Change background");
  b.closeTab(b.active());
  await sleep(300);
  store.reset("theme");
  store.reset("tabOrder");
  store.reset("switcherStyle");
  await sleep(200);
  V.consoleCheck("keyboard");
});
