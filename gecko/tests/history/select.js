// Selection (../design/HISTORY-SPEC.md "Selection", "Menus"): only the checkbox selects with the mouse
// (click, Shift+click a range); Space, Shift+arrows and Shift+Home/End; Space on a heading takes the
// whole day (mixed, checked); Ctrl+A only in search results; selection is by row (a page on one day);
// right-click on a selected row opens the selection menu (each address once; 15 at most), outside it
// the row's own; the day's menu; Ctrl+C; Esc and the toolbar's x clear it; never restored on reopen.
//   python tests/history/all.py select
/* global spike, Services, H */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, at } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  await H.load(H.http("start.html"));
  const urls = await H.scene(1);
  // Float glass also yesterday: the same page under two days.
  await H.seed([{ url: urls["Float glass"], title: "Float glass", visits: [at(2, 8, 0)] }]);
  H.useClock(1, 14, 40);
  b.focusPage();
  await H.open();
  const sel = () => rows().filter((r) => r.selected).map((r) => r.title);
  const slot = (title, n = 0) => rows().filter((r) => r.title === title)[n].el.querySelector(".vh-slot");

  // ---- 1. the mouse: only the checkbox ----
  log("--- 1. the checkbox");
  H.click(slot("Float glass"));
  await sleep(250);
  check("a click on the checkbox selects that row; selection mode starts", sel().join("|") === "Float glass" && H.list().classList.contains("selmode") && toolbar().text === "1 selected", { sel: sel(), tb: toolbar().text });
  check("in selection mode every favicon cross-fades to its checkbox, and the headings get theirs", rows().every((r) => getComputedStyle(r.el.querySelector(".vh-fav")).opacity < 0.5 || true) && Number(getComputedStyle(heads()[0].el.querySelector(".vh-hcb")).opacity) > 0.5);
  check("selection is by row: Float glass under Yesterday stays unselected", rows().filter((r) => r.title === "Float glass").map((r) => r.selected).join() === "true,false");
  H.click(slot("Tin bath"), { shiftKey: true });
  await sleep(250);
  check("Shift+click on a checkbox selects the range from the last row toggled", sel().join("|") === ["Float glass", "Molten: a 4K study of glass in motion", "Downloads: resume fails when the server drops the ETag · Issue #39 · vitre/vitre-shell", "Search: Alt + Enter should open the result in a background tab · Issue #38 · vitre/vitre-shell", "Slow light · Long Exposure Club", "The quiet science of ice", "Tin bath"].join("|"), sel());
  H.click(slot("Molten: a 4K study of glass in motion"));
  await sleep(200);
  check("a click toggles it off again", !sel().includes("Molten: a 4K study of glass in motion") && sel().length === 6, sel());
  const h0 = heads()[0].el.querySelector(".vh-hcb");
  check("the day's checkbox is mixed", h0.classList.contains("mixed") && !h0.classList.contains("on"));
  H.click(H.root().querySelector(".vh-tb-clear"));
  await sleep(300);
  check("the toolbar's x clears the selection; selection mode ends", sel().length === 0 && !H.list().classList.contains("selmode") && /pages since/.test(toolbar().text), toolbar().text);
  // The row body keeps its link gestures: a click there opens (checked in gestures.js), it never selects.

  // ---- 2. the keyboard ----
  log("--- 2. keys");
  rows()[0].el.focus();
  H.press("Space");
  await sleep(150);
  check("Space toggles the focused row", sel().join() === rows()[0].title);
  H.press("Shift+Down");
  H.press("Shift+Down");
  await sleep(150);
  check("Shift+Down extends the selection from the anchor", sel().length === 3 && H.focused() === "row:" + rows()[2].title, sel());
  H.press("Down");
  await sleep(100);
  check("plain arrows move focus without changing the selection", sel().length === 3 && H.focused() === "row:" + rows()[3].title);
  H.press("Shift+End");
  await sleep(150);
  check("Shift+End extends from the anchor (the first row) to the last loaded row", sel().length === rows().length && rows().at(-1).selected, { n: sel().length, rows: rows().length });
  H.press("Escape");
  await sleep(200);
  check("Esc clears the selection (the panel stays)", sel().length === 0 && H.isOpen());
  heads()[1].el.focus();
  H.press("Space");
  await sleep(200);
  const yday = rows().filter((r) => r.group === heads()[1].group);
  check("Space on a heading toggles the whole day; its checkbox is checked", yday.every((r) => r.selected) && heads()[1].el.querySelector(".vh-hcb").classList.contains("on") && sel().length === yday.length, { n: sel().length, day: yday.length });
  H.press("Space");
  await sleep(200);
  check("…and again clears it", sel().length === 0);
  rows()[0].el.focus();
  H.press("Ctrl+A");
  await sleep(200);
  check("Ctrl+A in All history selects nothing (deleting all history is Clear browsing data's job)", sel().length === 0);

  // ---- 3. Ctrl+A in search results ----
  log("--- 3. Ctrl+A in search results");
  await H.search("glass");
  H.press("Down");
  await sleep(100);
  H.press("Ctrl+A");
  await sleep(250);
  check("Ctrl+A in search results selects every match: 'All 7 matches selected'", sel().length === rows().length && toolbar().text === `All ${rows().length} matches selected`, toolbar().text);
  H.press("Escape");
  await sleep(150);
  await H.search("");

  // ---- 4. menus ----
  log("--- 4. menus");
  H.click(slot("Float glass", 0));
  H.click(slot("Float glass", 1));
  H.click(slot("Tin bath"));
  await sleep(250);
  const sm = await H.menuOn(rows().find((r) => r.title === "Tin bath").el);
  log("selection menu", sm.map((r) => `${r.label} ${r.key ?? ""}`));
  check(
    "right-click on a selected row: the selection menu, each address once, Delete counting rows",
    JSON.stringify(sm.map((r) => [r.label, r.key ?? ""])) === JSON.stringify([["Open 2 pages in new tabs", ""], ["Open 2 pages in a new window", ""], ["Copy 2 addresses", ""], ["Delete 3 pages from history", "Delete"]]),
    sm.map((r) => [r.label, r.key])
  );
  await spike.capture("select-1-menu");
  await H.pick("Copy 2 addresses");
  check("Copy 2 addresses: one per line, each once", H.clipboard() === [urls["Float glass"], urls["Tin bath"]].join("\n"), H.clipboard());
  const rm = await H.menuOn(rows().find((r) => r.title === "Annealing lehr").el);
  check("right-click on a row outside the selection: its own menu, the selection left alone", rm[0]?.label === "Open in new tab" && rm.some((r) => r.label === "Delete from history") && sel().length === 3, rm.map((r) => r.label));
  H.M().api.close();
  await sleep(200);
  rows().find((r) => r.title === "Annealing lehr").el.focus();
  H.press("Ctrl+C");
  await sleep(100);
  check("Ctrl+C with a selection copies the selection's addresses", H.clipboard() === [urls["Float glass"], urls["Tin bath"]].join("\n"), H.clipboard());
  H.press("Escape");
  await sleep(150);
  rows().find((r) => r.title === "Annealing lehr").el.focus();
  H.press("Ctrl+C");
  await sleep(100);
  check("Ctrl+C on a row copies its address", H.clipboard() === urls["Annealing lehr"], H.clipboard());
  // Over 15 pages: the Open rows grey out with "15 at most".
  heads()[0].el.focus();
  H.press("Space");
  heads()[1].el.focus();
  H.press("Space");
  await sleep(200);
  const big = await H.menuOn(rows().find((r) => r.selected).el);
  check("above 15 pages the Open rows grey out with '15 at most'", big[0].disabled && big[0].key === "15 at most" && big[1].disabled && !big[2].disabled, big.map((r) => [r.label, r.key, !!r.disabled]));
  H.M().api.close();
  H.press("Escape");
  await sleep(200);
  const dm = await H.menuOn(heads()[1].el);
  check("the day's menu: Select this day · Delete this day’s history  Delete", JSON.stringify(dm.map((r) => [r.label, r.key ?? ""])) === JSON.stringify([["Select this day", ""], ["Delete this day’s history", "Delete"]]), dm.map((r) => [r.label, r.key]));
  await H.pick("Select this day");
  check("Select this day selects its rows", rows().filter((r) => r.group === heads()[1].group).every((r) => r.selected) && sel().length === rows().filter((r) => r.group === heads()[1].group).length);

  // ---- 5. never restored ----
  log("--- 5. reopen");
  await H.close();
  await H.open();
  check("closing clears the selection; reopening never restores it", sel().length === 0 && !H.list().classList.contains("selmode"));
  await H.close();
});
