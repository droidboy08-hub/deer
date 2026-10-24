// Deleting, and undo (../design/HISTORY-SPEC.md "Deleting, and undo", the owner's decisions 4 and 6):
// a row takes only that page's visits on that row's day; a selection each row's own day; a day that
// day's visits; nothing changes in Places until the commit (Undo is exact and writes nothing); the
// commit runs when the line goes (10 s, paused on hover), on a new delete, on close, when a page opens
// from the panel, on Clear browsing data in any window, when the window closes and when Deer quits; a
// visit made after a Today delete survives it, and after Undo the page still has one row; this
// window's address field leaves out the pages a pending delete would remove entirely; Undo after the
// list was read again (a peek round trip, a bulk change) brings the rows back; a reopen while a large
// commit runs never shows its rows; Delete day on a search-results heading counts the whole day.
//   python tests/history/all.py delete
/* global spike, Services, H, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, at } = H;
  const { check, log, sleep } = spike;
  const u = (p) => `https://house.example/${p}`;
  const day = (n) => [at(n, 0, 0).getTime(), at(n - 1, 0, 0).getTime()];
  const onDay = (dates, n) => dates.filter((d) => d >= day(n)[0] && d < day(n)[1]).length;
  const suggests = async (text) => (await b.omni.history.query(text, 10))?.map((r) => r.url) ?? [];

  if (spike.run === 2) {
    // ---- 12 (after the restart): the quit committed the pending delete ----
    log("--- 12. after the quit");
    const left = await H.visits(u("quit"));
    check("a delete pending when Deer quit was committed (Places' shutdown waited for it)", left.length === 1 && onDay(left, 4) === 1, left.map((d) => new Date(d).toString()));
    return;
  }

  await spike.resize(1440, 900);
  await spike.activate();
  await H.load(H.http("start.html"));
  await H.seed([
    { url: u("tin-bath"), title: "Tin bath", visits: [at(1, 9, 0), at(1, 12, 48), at(2, 15, 0)] },
    { url: u("only-today"), title: "Only today", visits: [at(1, 10, 0), at(1, 11, 0)] },
    { url: u("lehr"), title: "Annealing lehr", visits: [at(1, 11, 52), at(2, 9, 0), at(3, 9, 0)] },
    { url: u("soda"), title: "Soda-lime glass", visits: [at(2, 18, 22)] },
    { url: u("orb"), title: "How we lit the orb shot", visits: [at(2, 17, 31), at(4, 10, 0)] },
    { url: u("fire"), title: "Fire polishing", visits: [at(2, 10, 40)] },
    { url: u("dusk"), title: "Dusk, from a canoe", visits: [at(3, 13, 20)] },
    { url: u("other-window"), title: "Deleted in another window", visits: [at(1, 8, 0), at(4, 8, 0)] },
    { url: u("quit"), title: "Deleted as Deer quits", visits: [at(1, 8, 5), at(4, 8, 5)] },
  ]);
  // A bookmark keeps its bookmark; that day's visits go (spec "Bookmarks").
  await H.PlacesUtils.bookmarks.insert({ parentGuid: H.PlacesUtils.bookmarks.unfiledGuid, url: u("soda"), title: "Soda-lime glass" });
  H.useClock(1, 14, 40);
  b.focusPage();
  await H.open();
  H.panel().undoMs = 600000;
  const rec = H.recordPlaces();
  const xOf = async (title, n = 0) => {
    const r = rows().filter((x) => x.title === title)[n];
    H.hover(r.el);
    await sleep(160);
    return r.el.querySelector(".vh-x");
  };

  // ---- 1. a row: that day only; Undo writes nothing ----
  log("--- 1. a row");
  H.click(await xOf("Tin bath"));
  await sleep(500);
  check("the x: the row leaves at once, the line names the day", rows().filter((r) => r.title === "Tin bath").length === 1 && toolbar().text === "Deleted “Tin bath” from Today." && toolbar().buttons.includes("Undo"), { tb: toolbar().text, n: rows().filter((r) => r.title === "Tin bath").length });
  check("…the page stays under its other day", rows().find((r) => r.title === "Tin bath")?.group === heads().find((h) => h.label === "Yesterday").group);
  check("…and Places is not changed yet", (await H.visits(u("tin-bath"))).length === 3);
  await sleep(500);
  check("Narrator hears the line, then 'Undo with Control+Z.'", H.panel().announced === "Deleted “Tin bath” from Today. Undo with Control+Z.", H.panel().announced);
  await spike.capture("delete-1-undo-line");
  H.click(toolbar().el.querySelector("button"));
  await sleep(600);
  check("Undo brings the row back from memory, under its day, at its time", rows().filter((r) => r.title === "Tin bath").length === 2 && rows().find((r) => r.title === "Tin bath").group === heads()[0].group && /pages since/.test(toolbar().text));
  check("…focus on the restored row; Narrator: 'Restored 1 page'", H.focused() === "row:Tin bath" && H.panel().announced === "Restored 1 page", { f: H.focused(), a: H.panel().announced });
  check("…and nothing was written to Places (no event, all visits there)", rec.events.length === 0 && (await H.visits(u("tin-bath"))).length === 3, rec.events);

  // ---- 2. the line goes: commit ----
  log("--- 2. the commit when the line goes");
  H.panel().undoMs = 1200;
  H.click(await xOf("Tin bath"));
  await sleep(300);
  H.hover(toolbar().el);
  await sleep(1800);
  check("the line pauses while the pointer is on it", !!H.store().pending && (await H.visits(u("tin-bath"))).length === 3);
  H.hover(H.root().querySelector(".vh-ttl"));
  await until(async () => !H.store().pending && (await H.visits(u("tin-bath"))).length === 1, 4000);
  const tb = await H.visits(u("tin-bath"));
  check("when it goes, the commit removes that day's visits only", tb.length === 1 && onDay(tb, 2) === 1, tb.map((d) => new Date(d).toString()));
  check("…the line is gone", /pages since/.test(toolbar().text), toolbar().text);
  check("…and the page is still suggested by the address field", (await suggests("tin bath")).includes(u("tin-bath")));
  H.panel().undoMs = 600000;

  // ---- 3. a page whose only visits were that day ----
  log("--- 3. a page only visited that day");
  H.click(await xOf("Only today"));
  await sleep(600);
  check("while pending, this window's address field leaves out a page the delete removes entirely", !(await suggests("only today")).includes(u("only-today")) && (await H.visits(u("only-today"))).length === 2);
  check("…but keeps a page with visits on other days", (await suggests("lehr")).includes(u("lehr")));
  H.press("Ctrl+W");
  await until(async () => (await H.visits(u("only-today"))).length === 0, 4000);
  check("closing the panel commits: the page leaves history", (await H.visits(u("only-today"))).length === 0 && !H.isOpen());
  await sleep(300);
  check("…and the address field's filter has gone with the commit", (await suggests("only today")).length === 0);
  await H.open();
  H.panel().undoMs = 600000;

  // ---- 4. a selection across days ----
  log("--- 4. a selection across days");
  const slots = () => rows().filter((r) => r.title === "Annealing lehr").map((r) => r.el.querySelector(".vh-slot"));
  H.click(slots()[0]);
  H.click(rows().find((r) => r.title === "Fire polishing").el.querySelector(".vh-slot"));
  await sleep(200);
  rows().find((r) => r.title === "Fire polishing").el.focus();
  H.press("Delete");
  await sleep(600);
  check("Delete acts on the selection: 'Deleted 2 pages from 2 days.'", toolbar().text === "Deleted 2 pages from 2 days." && !rows().some((r) => r.title === "Fire polishing") && rows().filter((r) => r.title === "Annealing lehr").length === 2, toolbar().text);
  check("…keyboard focus stays in the list", H.list().contains(document.activeElement), H.focused());
  // A new delete commits the pending one and takes over the line.
  H.click(await xOf("Dusk, from a canoe"));
  await sleep(500);
  const lehr = await H.visits(u("lehr"));
  check("a new delete commits the pending one: each row's own day only", lehr.length === 2 && onDay(lehr, 1) === 0 && onDay(lehr, 2) === 1 && (await H.visits(u("fire"))).length === 0, lehr.map((d) => new Date(d).toString()));
  check("…and takes over the line", toolbar().text.startsWith("Deleted “Dusk, from a canoe” from "), toolbar().text);
  H.press("Ctrl+Z");
  await sleep(500);
  check("Ctrl+Z in the list undoes it", rows().some((r) => r.title === "Dusk, from a canoe") && !H.store().pending);

  // ---- 5. a day ----
  log("--- 5. a day");
  const yh = heads().find((h) => h.label === "Yesterday");
  H.hover(yh.el);
  await sleep(200);
  const del = yh.el.querySelector(".vh-hdel");
  check("Delete day fades in on hover of the heading; named 'Delete day, Yesterday'", Number(getComputedStyle(del).opacity) > 0.5 && del.getAttribute("aria-label") === "Delete day, Yesterday", del.getAttribute("aria-label"));
  const n = yh.count;
  H.click(del);
  await sleep(700);
  check("the day's group goes; the line: 'Deleted Yesterday’s history (N pages).'", !heads().some((h) => h.label === "Yesterday") && toolbar().text === `Deleted Yesterday’s history (${n} pages).`, toolbar().text);
  await spike.capture("delete-2-day");
  H.field().focus();
  H.press("Ctrl+Z");
  await sleep(300);
  check("Ctrl+Z in the search field does not undo (it edits text)", !!H.store().pending);
  await H.panel().commit();
  await sleep(500);
  const orb = await H.visits(u("orb"));
  check("the commit removes that day's visits; a page visited on other days stays under them", orb.length === 1 && onDay(orb, 4) === 1 && (await H.visits(u("soda"))).length === 0 && rows().some((r) => r.title === "How we lit the orb shot"), orb.map((d) => new Date(d).toString()));
  const bm = await H.PlacesUtils.bookmarks.fetch({ url: u("soda") });
  check("a bookmarked page keeps its bookmark; its row leaves the list", !!bm && !rows().some((r) => r.title === "Soda-lime glass"));
  await H.close();

  // ---- 6. a visit made while a Today delete is pending survives ----
  log("--- 6. a visit after the delete");
  H.realClock();
  const fresh = H.http("e.html");
  await H.seed([{ url: fresh, title: "The quiet science of ice", visits: [new Date(Math.max(at(0, 0, 0).getTime() + 1000, Date.now() - 120000))] }]);
  b.focusPage();
  await H.open();
  H.panel().undoMs = 600000;
  H.click(await xOf("The quiet science of ice"));
  await sleep(500);
  check("(Today's row of the page is pending)", !!H.store().pending && !rows().some((r) => r.title === "The quiet science of ice"));
  const t = b.newTab(fresh, { background: true });
  await until(async () => (await H.visits(fresh)).length === 2, 8000);
  await sleep(500);
  check("visiting it again while pending: a fresh row at the top of Today", rows()[0]?.title === "The quiet science of ice" && heads()[0].label === "Today", rows().slice(0, 2).map((r) => r.title));
  await H.panel().commit();
  await sleep(400);
  const kept = await H.visits(fresh);
  check("the commit leaves the visit made after the delete", kept.length === 1 && kept[0] > H.store().clock() - 60000, kept.map((d) => new Date(d).toString()));
  b.closeTab(t);
  // Visited again while pending, then Undo: the restored row takes the newer time, in its place, and
  // the fresh row goes (one row per page per day).
  await H.close();
  await H.open();
  H.panel().undoMs = 600000;
  const iceToday = () => rows().filter((r) => r.title === "The quiet science of ice" && r.group === heads()[0].group);
  H.click(await xOf("The quiet science of ice"));
  await sleep(500);
  await H.PlacesUtils.history.insert({ url: fresh, title: "The quiet science of ice", visits: [{ date: new Date() }] });
  await until(() => iceToday().length === 1, 4000);
  await sleep(300);
  const newTime = iceToday()[0]?.time;
  H.click(toolbar().el.querySelector(".vh-tb-undo"));
  await sleep(700);
  check("visited again while pending, then Undo: one row of the page under Today, with the newer time", iceToday().length === 1 && iceToday()[0].time === newTime && !H.store().pending, { n: iceToday().length, times: iceToday().map((r) => r.time), newTime });
  check("…and it is focused (the restored row)", H.focused() === "row:The quiet science of ice", H.focused());
  // A visit dated before the delete (it falls in the deleted range) never makes a row of its own.
  const delAt = Date.now();
  H.click(await xOf("The quiet science of ice"));
  await sleep(500);
  await H.PlacesUtils.history.insert({ url: fresh, title: "The quiet science of ice", visits: [{ date: new Date(Math.min(delAt, H.store().pending.at) - 5000) }] });
  await sleep(800);
  check("a visit dated before the delete stays with the deleted row (no fresh row)", iceToday().length === 0, iceToday().map((r) => r.time));
  H.click(toolbar().el.querySelector(".vh-tb-undo"));
  await sleep(700);
  check("…and after Undo the page has one row under Today", iceToday().length === 1, iceToday().map((r) => r.time));
  await H.close();

  // ---- 7. Clear browsing data in another window commits first ----
  log("--- 7. Clear browsing data");
  H.useClock(1, 14, 40);
  const w2 = await spike.openWindow();
  await sleep(1000);
  w2.vitreHistory.store.clock = H.store().clock;
  w2.vitre.service("history").open();
  await until(() => w2.vitreHistory.panel.isOpen && w2.vitreHistory.store.ready, 5000);
  await sleep(500);
  w2.vitreHistory.panel.undoMs = 600000;
  const w2row = [...w2.document.querySelectorAll("#vitre-history .vh-row")].find((r) => r.querySelector(".vh-title").textContent === "Deleted in another window");
  // Delete it from the other window's panel with its own x.
  w2.spike.EU.synthesizeMouseAtCenter(w2row, { type: "mousemove" }, w2);
  await sleep(150);
  w2.spike.EU.synthesizeMouseAtCenter(w2row.querySelector(".vh-x"), {}, w2);
  await sleep(400);
  check("(another window's panel holds a pending delete)", !!w2.vitreHistory.store.pending && (await H.visits(u("other-window"))).length === 2);
  window.focus();
  await spike.activate();
  b.focusPage();
  // Settings › Clear browsing data, the last hour, history only.
  H.press("Ctrl+Shift+Delete");
  const sp = window.vitreSettingsPanel?.panel;
  await until(() => sp?.isOpen, 3000);
  await sleep(400);
  const go = document.querySelector(".vs-clear [data-action='clear-data']");
  const status = document.querySelector(".vs-clear .vs-status");
  H.click(go);
  await until(() => status?.dataset.done, 20000);
  await sleep(300);
  const q = await H.visits(u("other-window"));
  check("Clear browsing data commits the other window's pending delete first", !w2.vitreHistory.store.pending && q.length === 1 && onDay(q, 4) === 1, q.map((d) => new Date(d).toString()));
  sp.close();
  await sleep(300);

  // ---- 8. the window closing commits ----
  log("--- 8. the window closing");
  w2.vitreHistory.store.clock = H.store().clock;
  await H.seed([{ url: u("closing"), title: "Deleted as the window closes", visits: [at(1, 7, 0), at(4, 7, 0)] }]);
  w2.vitreHistory.panel.close();
  await sleep(300);
  w2.vitre.service("history").open();
  await until(() => w2.vitreHistory.panel.isOpen && [...w2.document.querySelectorAll("#vitre-history .vh-row")].some((r) => r.querySelector(".vh-title").textContent === "Deleted as the window closes"), 5000);
  await sleep(300);
  w2.vitreHistory.panel.undoMs = 600000;
  const cr = [...w2.document.querySelectorAll("#vitre-history .vh-row")].find((r) => r.querySelector(".vh-title").textContent === "Deleted as the window closes");
  w2.spike.EU.synthesizeMouseAtCenter(cr, { type: "mousemove" }, w2);
  await sleep(150);
  w2.spike.EU.synthesizeMouseAtCenter(cr.querySelector(".vh-x"), {}, w2);
  await sleep(300);
  w2.close();
  await until(async () => (await H.visits(u("closing"))).length === 1, 5000);
  const cl = await H.visits(u("closing"));
  check("its window closing commits the pending delete (the singleton finishes it)", cl.length === 1 && onDay(cl, 4) === 1, cl.map((d) => new Date(d).toString()));
  await spike.activate();

  // ---- 9. Undo after the list was read again: a peek round trip, a bulk change ----
  log("--- 9. Undo after the list was read again");
  await H.seed([
    { url: H.http("d.html"), title: "Peeked while a delete waits", visits: [at(1, 13, 0)] },
    { url: u("undo-peek"), title: "Deleted before a peek", visits: [at(1, 12, 10)] },
    { url: u("undo-bulk"), title: "Deleted before a bulk change", visits: [at(1, 12, 20)] },
  ]);
  b.focusPage();
  await H.open();
  H.panel().undoMs = 600000;
  const peek = b.service("peek");
  if (peek) {
    H.click(await xOf("Deleted before a peek"));
    await sleep(500);
    H.click(H.row("Peeked while a delete waits").el.querySelector(".vh-title"), { shiftKey: true });
    await until(() => peek.isOpen() && !H.isOpen(), 4000);
    await sleep(700);
    check("(History stepped aside for a peek, its delete pending)", peek.isOpen() && !!H.store().pending);
    peek.close();
    await until(() => H.isOpen() && !peek.isOpen(), 4000);
    await sleep(900);
    check("the peek put back: History comes back (the list read again) with the undo line", toolbar().text === "Deleted “Deleted before a peek” from Today." && !H.row("Deleted before a peek"), toolbar().text);
    H.click(toolbar().el.querySelector(".vh-tb-undo"));
    await sleep(700);
    check("Undo after the peek round trip brings the row back, focused", !!H.row("Deleted before a peek") && H.focused() === "row:Deleted before a peek" && !H.store().pending, { focus: H.focused(), tb: toolbar().text });
    check("…from memory: its visit never left Places", (await H.visits(u("undo-peek"))).length === 1);
  } else check("the Peek module is in the build", false);
  H.click(await xOf("Deleted before a bulk change"));
  await sleep(500);
  const reread = new Promise((resolve) => {
    const off = H.store().subscribe((c) => {
      if (c.type === "reset") {
        off();
        resolve(true);
      }
    });
    window.setTimeout(() => resolve(false), 5000);
  });
  const bulk = [];
  for (let i = 0; i < 60; i++) bulk.push({ url: u(`bulk/${i}`), title: `Bulk ${i}`, visits: [at(5, 9, i)] });
  await H.seed(bulk);
  const wasRead = await reread;
  await sleep(400);
  check("(a bulk change elsewhere read the list again while the delete was pending)", wasRead && rows().some((r) => r.title === "Bulk 0") && !H.row("Deleted before a bulk change") && !!H.store().pending, { wasRead });
  H.click(toolbar().el.querySelector(".vh-tb-undo"));
  await sleep(700);
  check("Undo after a bulk change brings the row back", !!H.row("Deleted before a bulk change") && !H.store().pending && (await H.visits(u("undo-bulk"))).length === 1, toolbar().text);
  await H.close();

  // ---- 10. reopening while a large commit runs ----
  log("--- 10. reopening while a commit runs");
  // 1500 pages on one day, half of them also visited on another: one removal per row, about 2 s.
  const big = [];
  for (let i = 0; i < 1500; i++) big.push({ url: u(`sel/${i}`), title: `Selected ${i}`, visits: i % 2 ? [at(8, 9, i % 60, i % 60)] : [at(8, 9, i % 60, i % 60), at(12, 9, i % 60)] });
  await H.seed(big);
  const bigDay = at(8, 0, 0).getTime();
  const bigLabel = () => heads().find((h) => h.group === `gd${bigDay}`);
  b.focusPage();
  await H.open();
  await H.store().loadMore(1600);
  await until(() => bigLabel()?.count === 1500, 15000);
  await sleep(300);
  const bh = bigLabel();
  bh.el.focus();
  H.press("Space");
  await sleep(300);
  check("(Space on the day's heading selects its 1,500 rows)", toolbar().text === "1,500 selected", toolbar().text);
  H.press("Delete");
  await sleep(500);
  check("(the selection is deleted, pending)", toolbar().text.startsWith("Deleted 1,500 pages from ") && !bigLabel(), toolbar().text);
  const countDay = async () => {
    const db = await H.PlacesUtils.promiseDBConnection();
    const r = await db.execute("SELECT COUNT(*) AS n FROM moz_historyvisits WHERE visit_date >= :b AND visit_date < :e", { b: bigDay * 1000, e: at(7, 0, 0).getTime() * 1000 });
    return r[0].getResultByName("n");
  };
  H.press("Ctrl+W");
  await until(() => !H.isOpen(), 2000);
  await H.open();
  await H.store().loadMore(1600);
  await sleep(300);
  const drawnAgain = rows().filter((r) => r.group === `gd${bigDay}`).length;
  const left = await countDay();
  log("visits of that day still in Places when the panel was read again:", left);
  check("reopened while the commit runs: the rows being removed are not drawn again", drawnAgain === 0 && !bigLabel(), { drawnAgain, left });
  check("…(the commit was still running when it was read)", left > 0, left);
  await H.b.sys("VitreHistory").idle();
  await sleep(500);
  check("…and they never come back once it is done", !bigLabel() && (await countDay()) === 0);
  const after = await Promise.all([0, 1, 2, 3, 1498, 1499].map((i) => H.visits(u(`sel/${i}`))));
  check("each row took only its own day (pages visited on another day keep that visit)", after.map((v) => v.length).join(",") === "1,0,1,0,1,0", after.map((v) => v.length));
  await H.close();

  // ---- 11. Delete day on a search-results heading ----
  log("--- 11. Delete day in search results");
  // 70 rows on Today, so the old day isn't loaded in All history; 41 pages on it, one a rare word.
  const near = [];
  for (let i = 0; i < 70; i++) near.push({ url: u(`near/${i}`), title: `Near ${i}`, visits: [at(1, 6, i % 60, i)] });
  const far = [];
  for (let i = 0; i < 40; i++) far.push({ url: u(`far/${i}`), title: `Far page ${i}`, visits: [at(30, 10, i)] });
  far.push({ url: u("far/rare"), title: "Zanzibar, a rare word", visits: [at(30, 11, 0)] });
  await H.seed([...near, ...far]);
  const farDay = at(30, 0, 0).getTime();
  b.focusPage();
  await H.open();
  H.panel().undoMs = 600000;
  check("(that day is not loaded in All history)", !H.store().days.some((d) => d.start === farDay), H.store().days.length);
  await H.search("zanzibar");
  const zh = heads()[0];
  check("(its search-results heading shows the one match)", zh?.count === 1 && rows().length === 1, zh && { label: zh.label, count: zh.count });
  H.hover(zh.el);
  await sleep(200);
  H.click(zh.el.querySelector(".vh-hdel"));
  await until(() => /^Deleted history from /.test(toolbar().text), 3000);
  await sleep(700);
  const line = toolbar().text;
  check("Delete day there: the line counts the whole day's pages (41), not the match shown", line === `Deleted history from ${zh.label} (41 pages).`, line);
  check("…and Narrator hears that count", H.panel().announced === `${line} Undo with Control+Z.`, H.panel().announced);
  H.click(toolbar().el.querySelector(".vh-tb-undo"));
  await sleep(800);
  check("Undo: 'Restored 41 pages', the match back", H.panel().announced === "Restored 41 pages" && rows().length === 1 && (await H.visits(u("far/3"))).length === 1, H.panel().announced);
  H.hover(heads()[0].el);
  await sleep(200);
  H.click(heads()[0].el.querySelector(".vh-hdel"));
  await sleep(500);
  await H.panel().commit();
  await H.b.sys("VitreHistory").idle();
  const farLeft = (await Promise.all([...Array(40).keys()].map((i) => H.visits(u(`far/${i}`))))).filter((v) => v.length).length;
  check("the commit took every page of that day (as the line said), and nothing nearer", farLeft === 0 && (await H.visits(u("far/rare"))).length === 0 && (await H.visits(u("near/5"))).length === 1, farLeft);
  await H.search("");
  await H.close();

  // ---- 12. quitting commits ----
  log("--- 12. quitting");
  await H.open();
  H.panel().undoMs = 600000;
  H.click(await xOf("Deleted as Deer quits"));
  await sleep(400);
  check("(pending as Deer quits)", !!H.store().pending && (await H.visits(u("quit"))).length === 2);
  rec.stop();
  await spike.restart();
});
