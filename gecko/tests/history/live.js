// Live while open (../design/HISTORY-SPEC.md "Live, while the panel is open"): a new visit appears at
// the top of Today and the view does not move; a visit to a page already under Today updates its time
// in place; a title change; a deletion made elsewhere (another window's panel, the address field's
// Shift+Delete) fades out only the rows it emptied; history-cleared resets to "No history yet"; new
// visits are ignored while search results show (All history still takes them: they show once the
// search ends); a bulk change keeps the first visible row in place, keyboard focus and the selection;
// a page loaded in the background never steals focus.
//   python tests/history/all.py live
/* global spike, Services, H */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, at } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const first = await H.load(H.http("start.html"));
  const u = (p) => `https://house.example/${p}`;
  // Today (two minutes ago at the latest) and yesterday; enough rows to scroll.
  const today = (min) => new Date(Math.max(at(0, 0, 0).getTime() + 1000 + min * 1000, Date.now() - 120000 - min * 1000));
  const seedRows = [{ url: u("both"), title: "On both days", visits: [today(30), at(1, 9, 0)] }];
  for (let i = 0; i < 24; i++) seedRows.push({ url: u(`y${i}`), title: `Yesterday page ${i}`, visits: [at(1, 20, i)] });
  await H.seed(seedRows);
  b.focusPage();
  await H.open();

  // ---- 1. a new visit, the view still ----
  log("--- 1. a new visit");
  H.scroller().scrollTop = 200;
  await sleep(200);
  const anchor = H.visibleRows()[0];
  const y0 = anchor.el.getBoundingClientRect().top;
  const t = b.newTab(H.http("c.html"), { background: true });
  await until(() => rows().some((r) => r.title === "Annealing lehr"), 8000);
  await sleep(300);
  check("a new visit to a page not under Today appears at the top of Today", rows()[0].title === "Annealing lehr" && heads()[0].label === "Today", rows().slice(0, 2).map((r) => r.title));
  check("…and the view does not move (the row in view stays where it was)", Math.abs(anchor.el.getBoundingClientRect().top - y0) < 1 && H.scroller().scrollTop > 200, { before: y0, after: anchor.el.getBoundingClientRect().top });
  check("…focus stays in the panel", H.sheet().contains(document.activeElement), H.focused());
  const time0 = H.row("On both days").time;
  const order = rows().map((r) => r.title).join("|");
  // A visit to a page already under Today: recorded through Places (the house site is never fetched).
  b.navigate(t, H.http("d.html"));
  await H.PlacesUtils.history.insert({ url: u("both"), visits: [{ date: new Date(Date.now() - 1000) }] });
  await until(() => H.row("On both days").time !== time0, 4000);
  await sleep(300);
  check("a visit to a page already under Today updates its time in place; nothing moves", H.row("On both days").time !== time0 && rows().filter((r) => r.title !== "Slow light").map((r) => r.title).join("|") === order, { time0, now: H.row("On both days").time });
  await until(() => rows().some((r) => r.title === "Slow light"), 6000);

  // ---- 2. a title change ----
  log("--- 2. a title change");
  await H.PlacesUtils.history.insert({ url: u("both"), title: "Now called something else", visits: [{ date: at(3, 9, 0) }] });
  await until(() => rows().filter((r) => r.title === "Now called something else").length === 2, 4000);
  check("a title change updates every row of that page in place", rows().filter((r) => r.title === "Now called something else").length === 2 && !rows().some((r) => r.title === "On both days"));

  // ---- 3. deletions made elsewhere ----
  log("--- 3. deletions elsewhere");
  const w2 = await spike.openWindow();
  await sleep(800);
  w2.vitre.service("history").open();
  await until(() => w2.vitreHistory.panel.isOpen && w2.vitreHistory.store.ready, 5000);
  await sleep(400);
  w2.vitreHistory.panel.undoMs = 600000;
  const yGroup = [...w2.document.querySelectorAll("#vitre-history .vh-head")].find((h) => h.querySelector(".vh-hl").textContent === "Yesterday").closest(".vh-group");
  const yRow = [...yGroup.querySelectorAll(".vh-row")].find((r) => r.querySelector(".vh-title").textContent === "Now called something else");
  yRow.scrollIntoView({ block: "nearest" });
  w2.spike.EU.synthesizeMouseAtCenter(yRow, { type: "mousemove" }, w2);
  await sleep(150);
  w2.spike.EU.synthesizeMouseAtCenter(yRow.querySelector(".vh-x"), {}, w2);
  await sleep(500);
  check("(another window's panel deleted the page's Yesterday row, pending)", !!w2.vitreHistory.store.pending);
  check("other windows may show it until the commit", rows().filter((r) => r.title === "Now called something else").length === 2);
  await w2.vitreHistory.panel.commit();
  await until(() => rows().filter((r) => r.title === "Now called something else").length === 1, 4000);
  await sleep(200);
  check("after the commit, only the row of the day left without a visit goes; its Today row stays", rows().filter((r) => r.title === "Now called something else").length === 1 && rows().find((r) => r.title === "Now called something else").group === heads()[0].group);
  w2.close();
  await sleep(500);
  await spike.activate();
  // The address field's Shift+Delete removes a whole page (history.remove): every row of it goes.
  const yb = rows().find((r) => r.title === "Yesterday page 3");
  await H.PlacesUtils.history.remove(u("y3"));
  await sleep(60);
  const fading = yb.el.classList.contains("fade") || Number(getComputedStyle(yb.el.querySelector(".vh-in")).opacity) < 1;
  await until(() => !rows().some((r) => r.title === "Yesterday page 3"), 3000);
  await sleep(200);
  check("a page removed elsewhere fades out over 150 ms, without the collapse", fading && !yb.el.isConnected, { fading });

  // ---- 4. while searching, new visits are ignored ----
  log("--- 4. while searching");
  await H.search("page");
  const n = rows().length;
  await H.PlacesUtils.history.insert({ url: u("page-new"), title: "A new page", visits: [{ date: new Date(Date.now() - 500) }] });
  await sleep(800);
  check("while search results show, a new visit is ignored", rows().length === n && !rows().some((r) => r.title === "A new page"));
  await H.search("");
  await until(() => rows().some((r) => r.title === "A new page"), 3000);
  check("…but All history took it: it is at the top of Today once the search ends", rows()[0]?.title === "A new page" && rows()[0].group === heads()[0].group && heads()[0].label === "Today", rows().slice(0, 3).map((r) => r.title));

  // ---- 5. a bulk change ----
  log("--- 5. a bulk change");
  H.scroller().scrollTop = 160;
  await sleep(200);
  // A row selected, and keyboard focus on another (both in view).
  const inView = H.visibleRows();
  H.click(inView[3].el.querySelector(".vh-slot"));
  await sleep(200);
  inView[2].el.focus({ focusVisible: true });
  await sleep(100);
  const focusedBefore = H.focused();
  const selectedBefore = rows().filter((r) => r.selected).map((r) => r.title);
  check("(one row selected, keyboard focus on another)", toolbar().text === "1 selected" && selectedBefore.length === 1 && focusedBefore === "row:" + inView[2].title, { tb: toolbar().text, focusedBefore });
  // The first visible row: the first one with any part in view (here cut by the list's top).
  const top0 = H.scroller().getBoundingClientRect().top;
  const anchorRow = rows().find((r) => r.el.getBoundingClientRect().bottom > top0 + 1);
  const anchorTitle = anchorRow.title;
  const anchorTop = anchorRow.el.getBoundingClientRect().top;
  const bulk = [];
  for (let i = 0; i < 60; i++) bulk.push({ url: u(`bulk/${i}`), title: `Bulk page ${i}`, visits: [at(1, 6, i % 60)] });
  await H.seed(bulk);
  await until(() => rows().some((r) => r.title === "Bulk page 0"), 4000);
  await sleep(300);
  const again = rows().find((r) => r.title === anchorTitle);
  check("a bulk change (60 visits in one batch) reloads the loaded days, the first visible row staying in place", !!again && Math.abs(again.el.getBoundingClientRect().top - anchorTop) < 2 && rows().some((r) => r.title === "Bulk page 59"), { anchorTitle, before: anchorTop, after: again?.el.getBoundingClientRect().top });
  check("…keyboard focus stays on its row", H.focused() === focusedBefore && H.list().contains(document.activeElement), { now: H.focused(), focusedBefore });
  check("…and the selection stays (only Esc, the x, a delete or a close clear it)", toolbar().text === "1 selected" && rows().filter((r) => r.selected).map((r) => r.title).join("|") === selectedBefore.join("|"), { tb: toolbar().text, sel: rows().filter((r) => r.selected).map((r) => r.title) });
  H.press("Down");
  await sleep(150);
  check("…and the keys still move it", H.focused() !== focusedBefore && H.focused().startsWith("row:"), H.focused());
  H.press("Escape");
  await sleep(200);

  // ---- 6. history cleared ----
  log("--- 6. history cleared");
  await H.PlacesUtils.history.clear();
  await until(() => H.message() === "Pages you visit will show up here.", 4000);
  check("history-cleared (Clear browsing data elsewhere) resets the list to 'No history yet'", H.message() === "Pages you visit will show up here." && rows().length === 0 && H.toolbar().text === "", { msg: H.message(), n: rows().length });
  await spike.capture("live-1-cleared");
  await H.close();
  b.closeTab(t);
  check("(the first tab is untouched)", b.tabs.includes(first));
});
