// The panel's keys (../design/HISTORY-SPEC.md "Keys"): Up / Down with headings as stops, Home / End,
// Page Up / Down (13), Ctrl+Up / Down between headings, the Tab order (search, views, Clear browsing
// data…, the toolbar's buttons, the list as one stop, Close), Ctrl+F, Shift+F10 (4 px below the row),
// Delete on a row and on a heading, the Esc ladder one step per key, window keys underneath (Ctrl+Tab,
// Ctrl+1) keeping the panel's focus, page keys doing nothing under it, the views' arrows, and a
// private window (Close only).
//   python tests/history/all.py keys
/* global spike, Services, H, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const first = await H.load(H.http("start.html"));
  const second = b.newTab(H.http("a.html"), { background: true });
  await until(() => !second.loading && second.title === "Float glass", 8000);
  await H.scene(1);
  H.useClock(1, 14, 40);
  b.activate(first);
  await sleep(300);
  b.focusPage();
  await H.open();

  // ---- 1. moving ----
  log("--- 1. moving");
  H.press("Down");
  await sleep(100);
  check("Down from the field goes to the first row", H.focused() === "row:" + rows()[0].title, H.focused());
  H.press("Up");
  await sleep(80);
  check("Up from the first row: its day heading is a stop", H.focused() === "head:Today", H.focused());
  for (let i = 0; i < 15; i++) H.press("Down");
  await sleep(100);
  check("Down through Today's 14 rows reaches Yesterday's heading", H.focused() === "head:Yesterday", H.focused());
  H.press("Ctrl+Down");
  await sleep(80);
  const third = heads()[2].label;
  check("Ctrl+Down: the next day heading", H.focused() === "head:" + third, H.focused());
  H.press("Ctrl+Up");
  H.press("Ctrl+Up");
  await sleep(80);
  check("Ctrl+Up: the previous day headings", H.focused() === "head:Today", H.focused());
  H.press("PageDown");
  await sleep(80);
  check("Page Down: 13 stops on", H.focused() === "row:" + rows()[12].title, H.focused());
  H.press("PageUp");
  await sleep(80);
  check("Page Up: 13 back", H.focused() === "head:Today", H.focused());
  H.press("End");
  await sleep(80);
  check("End: the last loaded row (instantly)", H.focused() === "row:" + rows().at(-1).title, H.focused());
  H.press("Home");
  await sleep(80);
  check("Home: the first stop", H.focused() === "head:Today", H.focused());
  check("the list is one Tab stop (roving): only the focused stop has tabindex 0", H.list().querySelectorAll('[tabindex="0"]').length === 1);
  H.press("Down");
  await sleep(80);

  // ---- 2. Tab order ----
  log("--- 2. Tab order");
  const seen = [];
  for (let i = 0; i < 6; i++) {
    H.press("Tab");
    await sleep(60);
    seen.push(H.focused());
  }
  log("Tab", seen);
  check("Tab: Close → search → the current view → Clear browsing data… → the list → Close (focus stays in the panel)", seen.join(" > ") === ["Close history", "Search history", "All history", "Clear browsing data, opens Settings", "row:" + rows()[0].title, "Close history"].join(" > "), seen);
  H.press("Shift+Tab");
  await sleep(60);
  check("Shift+Tab goes back (Close → the list)", H.focused() === "row:" + rows()[0].title, H.focused());
  // With a selection, the toolbar's buttons are stops before the list.
  H.press("Space");
  await sleep(150);
  H.press("Shift+Tab");
  await sleep(60);
  check("with a selection: the toolbar's x comes before the list", H.focused() === "Clear selection", H.focused());
  H.press("Shift+Tab");
  await sleep(60);
  check("…and its Delete before that", H.focused() === "Delete", H.focused());

  // ---- 3. Esc, one step per key ----
  log("--- 3. Esc");
  H.field().focus();
  H.type("tin");
  await until(() => H.store().shown === "tin", 3000);
  await sleep(200);
  const sel = rows().length > 0;
  // The selection made above is still there (its row may not be in the results): select a result too.
  H.press("Down");
  H.press("Space");
  await sleep(150);
  H.field().focus();
  const m = await H.menuOn(rows()[0].el);
  H.press("Escape");
  await sleep(250);
  check("Esc 1: the open menu closes (the rest stays)", !H.menuOpen() && m.length > 0 && H.isOpen() && /selected/.test(toolbar().text) && H.field().value === "tin");
  H.field().focus();
  H.press("Escape");
  await sleep(200);
  check("Esc 2: the selection clears", !/selected/.test(toolbar().text) && H.field().value === "tin" && H.isOpen(), toolbar().text);
  H.press("Escape");
  await until(() => H.store().shown === "", 3000);
  check("Esc 3: the search text clears (focus in the field)", H.field().value === "" && H.isOpen() && sel);
  H.press("Escape", { repeat: true });
  await sleep(200);
  check("a repeated Esc does nothing", H.isOpen());
  H.press("Escape");
  await until(() => !H.isOpen(), 2000);
  check("Esc 4: the panel closes, focus back on the page", !H.isOpen() && document.activeElement === first.browser, H.focused());

  // ---- 4. Ctrl+F, Shift+F10, Delete ----
  log("--- 4. Ctrl+F, Shift+F10, Delete");
  await H.open();
  H.press("Down");
  H.press("Down");
  await sleep(100);
  H.press("Ctrl+F");
  await sleep(150);
  check("Ctrl+F focuses the search field", document.activeElement === H.field());
  H.field().value = "x";
  H.press("Ctrl+F");
  await sleep(100);
  check("…and selects its text", H.field().selectionStart === 0 && H.field().selectionEnd === 1);
  H.field().value = "";
  H.press("Down");
  H.press("Down");
  await sleep(100);
  const focusedRow = document.activeElement;
  H.keyboardMenu();
  await until(() => H.menuOpen(), 3000);
  await sleep(300);
  const menuBox = H.M().view.rowElement(0, 0).closest("[role=menu]").getBoundingClientRect();
  const rr = focusedRow.getBoundingClientRect();
  log("menu at", menuBox.top, "row bottom", rr.bottom);
  check("Shift+F10 / the Menu key: the row's menu hangs 4 px below it, first row focused", H.menuRows()[0]?.label === "Open in new tab" && Math.abs(menuBox.top - (rr.bottom + 4)) <= 1, { menu: menuBox.top, row: rr.bottom });
  H.press("Escape");
  await sleep(250);
  const title = focusedRow.querySelector(".vh-title").textContent;
  H.panel().undoMs = 600000;
  focusedRow.focus();
  H.press("Shift+Delete");
  await sleep(500);
  check("Shift+Delete on a focused row deletes it (that day's visits)", toolbar().text === `Deleted “${title.length > 40 ? title.slice(0, 40).trimEnd() + "…" : title}” from Today.` && H.list().contains(document.activeElement), toolbar().text);
  H.press("Ctrl+Z");
  await sleep(400);
  heads()[1].el.focus();
  H.press("Delete");
  await sleep(600);
  check("Delete on a heading deletes the day", /^Deleted Yesterday’s history \(\d+ pages\)\.$/.test(toolbar().text), toolbar().text);
  H.press("Ctrl+Z");
  await sleep(500);
  check("Ctrl+Z brings it back", heads().some((h) => h.label === "Yesterday"));

  // ---- 5. window keys underneath, page keys under it ----
  log("--- 5. underneath");
  rows()[2].el.focus();
  const zoom = first.browser.fullZoom;
  H.press("Ctrl+Plus");
  await sleep(300);
  check("page keys do nothing under the panel (Ctrl+Plus leaves the page's zoom alone)", first.browser.fullZoom === zoom, first.browser.fullZoom);
  // (Ctrl+Tab belongs to the switcher, which draws above the panel; Ctrl+Page Down switches at once.)
  H.press("Ctrl+PageDown");
  await until(() => b.active() === second, 3000);
  await sleep(400);
  check("Ctrl+Page Down switches tabs underneath; the panel stays and keeps focus", H.isOpen() && b.active() === second && H.sheet().contains(document.activeElement), H.focused());
  H.press("Ctrl+1");
  await until(() => b.active() === first, 3000);
  await sleep(400);
  check("Ctrl+1 too", H.isOpen() && b.active() === first && H.sheet().contains(document.activeElement), H.focused());
  // The views: Up / Down switch them.
  H.root().querySelector(".vh-view[aria-current='page']").focus();
  H.press("Down");
  await sleep(300);
  check("Down in the views switches to Recently closed", H.root().querySelector(".vh-view[aria-current='page']").dataset.view === "closed" && H.focused() === "Recently closed");
  H.press("Up");
  await sleep(300);
  check("Up switches back", H.root().querySelector(".vh-view[aria-current='page']").dataset.view === "all");
  await H.close();

  // ---- 6. a private window ----
  log("--- 6. a private window");
  const pw = await spike.openWindow({ private: true });
  await sleep(800);
  pw.focus();
  pw.vitre.focusPage();
  await sleep(200);
  const pk = (spec, extra = {}) => H.press(spec, extra, pw);
  pk("Ctrl+H");
  await until(() => pw.vitreHistory.panel.isOpen, 3000);
  await sleep(400);
  const pclose = pw.document.querySelector("#vitre-history .vh-close");
  check("private: focus starts on Close", pw.document.activeElement === pclose);
  pk("Tab");
  pk("Tab");
  await sleep(100);
  check("…Tab stays on Close", pw.document.activeElement === pclose);
  pk("Ctrl+F");
  pk("Delete");
  pk("Ctrl+Z");
  await sleep(200);
  check("…Ctrl+F, Delete and Ctrl+Z do nothing", pw.vitreHistory.panel.isOpen && pw.document.activeElement === pclose);
  pk("Escape");
  await until(() => !pw.vitreHistory.panel.isOpen, 2000);
  check("…Esc closes it", !pw.vitreHistory.panel.isOpen);
  pk("Ctrl+H");
  await until(() => pw.vitreHistory.panel.isOpen, 3000);
  pk("Ctrl+W");
  await until(() => !pw.vitreHistory.panel.isOpen, 2000);
  check("…Ctrl+W closes it (never the tab)", !pw.vitreHistory.panel.isOpen && pw.vitre.tabs.length === 1);
  pk("Ctrl+H");
  await until(() => pw.vitreHistory.panel.isOpen, 3000);
  pk("Ctrl+H");
  await until(() => !pw.vitreHistory.panel.isOpen, 2000);
  check("…Ctrl+H toggles it", !pw.vitreHistory.panel.isOpen);
  // The address field: Ctrl+H opens it too, without the typed text.
  pk("Ctrl+L");
  await until(() => pw.vitre.omni.open, 2000);
  await sleep(200);
  pw.spike.EU.sendString("tin", pw);
  pk("Ctrl+H");
  await until(() => pw.vitreHistory.panel.isOpen, 3000);
  await sleep(300);
  check("…Ctrl+H in its address field opens it to the line (no search to carry); the field closes", pw.vitreHistory.panel.isOpen && !pw.vitre.omni.open && !pw.document.querySelector("#vitre-history .vh-search-input"));
  pw.close();
  await sleep(500);
});
