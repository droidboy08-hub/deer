// What the list shows (../design/HISTORY-SPEC.md "What the list shows", "Day heading", "Row",
// "Edge cases"): one row per page per day with that day's latest counted visit, newest first; the
// uncounted visits (reload, embed, download, framed link), redirect sources and pages that can't be
// opened left out; a day with only uncounted visits skipped; the heading labels (Today, Yesterday,
// the date, another year); a daylight-saving day; midnight; the summary; the tooltip; the fallbacks
// (no title, file:, no favicon); loading more; a 2000-row day built in frames; 100k visits; a change
// with 20,000 rows drawn.
//   python tests/history/all.py list
/* global spike, Services, H, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, at, PlacesUtils } = H;
  const { check, log, sleep } = spike;
  const T = PlacesUtils.history.TRANSITIONS;
  await spike.resize(1440, 900);
  await spike.activate();
  await H.load(H.http("start.html"));
  await H.clearHistory();
  const fmt = (opts, d) => new Services.intl.DateTimeFormat(undefined, opts).format(d);
  const time = (d) => fmt({ hour: "numeric", minute: "2-digit" }, d);

  // ---- 1. rows per day, counted visits ----
  log("--- 1. rows per day");
  // The clock is put 1 day back at 14:40, so "Today" is a day whose visits are all in the past.
  const u = (p) => `https://house.example/${p}`;
  await H.seed([
    { url: u("twice"), title: "Visited twice today", visits: [at(1, 10, 0), at(1, 12, 30), at(2, 9, 0)] },
    { url: u("reload-only"), title: "Reloaded only", visits: [{ date: at(1, 11, 0), transition: T.RELOAD }] },
    { url: u("link-then-reload"), title: "Link then reload", visits: [at(1, 8, 0), { date: at(1, 13, 0), transition: T.RELOAD }] },
    { url: u("embed"), title: "Embedded", visits: [{ date: at(1, 11, 5), transition: T.EMBED }] },
    { url: u("download"), title: "A download", visits: [{ date: at(1, 11, 10), transition: T.DOWNLOAD }] },
    { url: u("framed"), title: "A framed link", visits: [{ date: at(1, 11, 15), transition: T.FRAMED_LINK }] },
    { url: u("hidden"), title: "A redirect source", visits: [at(1, 11, 20)] },
    { url: u("untitled/path"), title: "", visits: [at(1, 11, 25)] },
    { url: "file:///C:/Users/test/notes.html", title: "Notes on disk", visits: [at(1, 11, 30)] },
    { url: u("typed"), title: "Typed in", visits: [{ date: at(1, 11, 35), transition: T.TYPED }] },
    { url: u("reloads-day"), title: "Only reloads that day", visits: [{ date: at(3, 10, 0), transition: T.RELOAD }, at(4, 10, 0)] },
  ]);
  // A page only reached through redirects is hidden (moz_places.hidden = 1), as Places marks a redirect source.
  const db = await PlacesUtils.promiseUnsafeWritableDBConnection();
  await db.execute("UPDATE moz_places SET hidden = 1 WHERE url = :url", { url: u("hidden") });
  // A page with a favicon of its own.
  const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVQ4y2Ng+M/AQAXAOGrBqAWjFgxXCwBOBQEfYPpdTAAAAABJRU5ErkJggg==";
  try {
    await PlacesUtils.favicons.setFaviconForPage(Services.io.newURI(u("typed")), Services.io.newURI(u("typed-icon.png")), Services.io.newURI(icon));
  } catch (e) {
    log("favicon not set", String(e));
  }
  H.useClock(1, 14, 40);
  b.focusPage();
  await H.open();
  const titles = rows().map((r) => r.title);
  log("rows", titles);
  check("a page visited twice on one day is one row, at that day's latest visit", rows().filter((r) => r.title === "Visited twice today" && r.group === heads()[0].group).length === 1 && H.row("Visited twice today").time === time(at(1, 12, 30)), H.row("Visited twice today"));
  check("…and has its own row under the other day it was visited", rows().filter((r) => r.title === "Visited twice today").length === 2 && heads()[1].label === "Yesterday", rows().filter((r) => r.title === "Visited twice today").map((r) => r.group));
  check("uncounted visits are left out: reloads, embeds, downloads, framed links", !titles.includes("Reloaded only") && !titles.includes("Embedded") && !titles.includes("A download") && !titles.includes("A framed link"), titles);
  check("a row shows the day's latest counted visit (a later reload does not move it)", H.row("Link then reload")?.time === time(at(1, 8, 0)), H.row("Link then reload")?.time);
  check("a redirect source (hidden) is left out", !titles.includes("A redirect source"));
  check("rows within a day run newest first", rows().filter((r) => r.group === heads()[0].group).map((r) => r.title).join("|") === ["Visited twice today", "Typed in", "Notes on disk", "house.example/untitled/path", "Link then reload"].join("|"), rows().filter((r) => r.group === heads()[0].group).map((r) => r.title));
  const bare = H.row("house.example/untitled/path");
  check("no title: the address without its scheme, at 0.85", !!bare && bare.el.querySelector(".vh-title").classList.contains("bare") && getComputedStyle(bare.el.querySelector(".vh-title")).opacity === "0.85", bare?.title);
  check("file: shows Local file in the address column", H.row("Notes on disk")?.addr === "Local file", H.row("Notes on disk")?.addr);
  await until(() => H.row("Typed in")?.el.querySelector(".vh-fav img")?.complete, 3000);
  check("a page with a favicon shows it; the others show Deer's line globe", !!H.row("Typed in")?.el.querySelector(".vh-fav img") && !!H.row("Link then reload")?.el.querySelector(".vh-fav svg"), H.row("Typed in")?.el.querySelector(".vh-fav")?.innerHTML.slice(0, 80));
  check("a day with only uncounted visits is skipped (no heading for it)", heads().length === 3 && heads()[2].label === fmt({ weekday: "long", day: "numeric", month: "long" }, at(4, 10, 0)), heads().map((h) => h.label));

  // ---- 2. labels and the summary ----
  log("--- 2. labels");
  const h = heads();
  check("Today and Yesterday carry the date after them", h[0].label === "Today" && h[0].sub === fmt({ weekday: "long", day: "numeric", month: "long" }, at(1, 12, 0)) && h[1].label === "Yesterday" && h[1].sub === fmt({ weekday: "long", day: "numeric", month: "long" }, at(2, 12, 0)), h.map((x) => [x.label, x.sub]));
  check("the heading's name: 'Today, <full date>, 5 pages'", h[0].aria === `Today, ${fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, at(1, 12, 0))}, 5 pages`, h[0].aria);
  check("the summary: '<n> pages since <first visit's date>' (pages with a counted visit)", toolbar().text === `6 pages since ${fmt({ day: "numeric", month: "long", year: "numeric" }, at(4, 10, 0))}`, toolbar().text);
  const tip = H.row("Visited twice today").el.dataset.tip;
  check("the tooltip: title, address, the visit's full date and time", tip === `Visited twice today\n${u("twice")}\n${fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, at(1, 12, 30))}, ${time(at(1, 12, 30))}`, tip);
  H.hover(H.row("Visited twice today").el.querySelector(".vh-title"));
  await sleep(900);
  const tipEl = document.querySelector("#layer-tips .vitre-tip");
  check("…shown after 600 ms as three lines", !!tipEl && !tipEl.hidden && tipEl.classList.contains("lines") && tipEl.textContent.split("\n").length === 3 && tipEl.offsetHeight > 40, tipEl && { h: tipEl.offsetHeight, text: tipEl.textContent });
  const t0 = rows()[0].el.querySelector("time");
  check("the time is a <time datetime> in local time", /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t0.getAttribute("datetime")), t0.getAttribute("datetime"));
  await H.close();

  // ---- 3. another year, a daylight-saving day ----
  log("--- 3. other years and daylight saving");
  await H.seed([
    { url: u("last-year"), title: "Last June", visits: [new Date(2025, 5, 14, 15, 0)] },
    { url: u("dst-a"), title: "Just after midnight", visits: [new Date(2026, 2, 8, 0, 30)] },
    { url: u("dst-b"), title: "Late that night", visits: [new Date(2026, 2, 8, 23, 30)] },
    { url: u("dst-c"), title: "The next morning", visits: [new Date(2026, 2, 9, 0, 10)] },
  ]);
  await H.open();
  await H.store().loadMore(500);
  await sleep(500);
  const all = heads();
  const dstLabel = fmt({ weekday: "long", day: "numeric", month: "long" }, new Date(2026, 2, 8, 12));
  const dst = all.find((x) => x.label === dstLabel);
  const hours = (new Date(2026, 2, 9) - new Date(2026, 2, 8)) / 3600000;
  log("8 March 2026 lasts", hours, "hours here");
  check("a daylight-saving day is one day from local midnight to the next (its first and last visits under one heading)", !!dst && dst.count === 2 && rows().filter((r) => r.group === dst.group).map((r) => r.title).join("|") === "Late that night|Just after midnight", { dst, hours });
  check("the visit after that midnight is under the next day", all.some((x) => x.label === fmt({ weekday: "long", day: "numeric", month: "long" }, new Date(2026, 2, 9, 12))));
  const ly = all.find((x) => x.label === fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, new Date(2025, 5, 14, 12)));
  check("a day in another year adds the year", !!ly && ly.sub === "", all.map((x) => x.label));
  check("once the end has loaded, the grid has its row count", H.list().getAttribute("aria-rowcount") !== "-1", H.list().getAttribute("aria-rowcount"));

  // ---- 4. midnight ----
  log("--- 4. midnight");
  const before = heads()[0].label;
  H.useClock(0, 0, 0);
  H.panel().midnight();
  await sleep(300);
  check("at midnight the headings relabel in place: Today becomes Yesterday", before === "Today" && heads()[0].label === "Yesterday" && heads()[1].label === fmt({ weekday: "long", day: "numeric", month: "long" }, at(2, 12, 0)), heads().slice(0, 2).map((x) => x.label));
  await H.close();
  H.useClock(1, 14, 40);

  // ---- 5. loading more, and a large day ----
  log("--- 5. loading more");
  await H.clearHistory();
  const many = [];
  for (let d = 1; d <= 60; d++) for (let i = 0; i < 6; i++) many.push({ url: u(`d${d}/p${i}`), title: `Day ${d} page ${i}`, visits: [at(d, 9 + i, 0)] });
  await H.seed(many);
  await H.open();
  const first = rows().length;
  check("the first open loads days until at least 60 rows are in, not all of them", first >= 60 && first < 120 && H.list().getAttribute("aria-rowcount") === "-1", first);
  H.scroller().scrollTop = H.scroller().scrollHeight;
  await until(() => rows().length > first, 3000);
  await sleep(300);
  check("scrolling near the end loads the next days (60 rows or more)", rows().length >= first + 60, { first, now: rows().length });
  H.list().querySelector(".vh-row").focus();
  const loaded = rows().length;
  const last = rows().at(-1).title;
  H.press("End");
  await sleep(50);
  const landed = H.focused();
  await until(() => rows().length > loaded, 3000);
  check("End goes to the last loaded row (instantly) and loads more", landed === "row:" + last && rows().length > loaded, { loaded, now: rows().length, landed, last });
  await H.close();

  log("--- 6. a large day");
  await H.clearHistory();
  const big = [];
  for (let i = 0; i < 2000; i++) big.push({ url: u(`big/${i}`), title: `Page ${i} of a busy day`, visits: [new Date(at(1, 13, 0).getTime() - i * 15000)] });
  await H.seed(big);
  b.focusPage();
  const counts = [];
  b.service("history").open();
  await until(() => H.store().ready, 5000);
  for (let i = 0; i < 20; i++) {
    counts.push(H.list().querySelectorAll(".vh-row").length);
    await new Promise((r) => requestAnimationFrame(() => r()));
  }
  log("rows drawn frame by frame", counts.join(","));
  check("a 2000-row day is built 200 rows per frame", counts[0] < 2000 && counts.at(-1) === 2000 && counts.every((n, i, a) => i === 0 || n - a[i - 1] <= 200), counts);
  await H.close();

  // ---- 7. Places can't be read ----
  log("--- 7. unavailable");
  const st = H.store();
  const real = st.dayPage;
  st.dayPage = () => Promise.reject(new Error("the test's broken Places"));
  b.focusPage();
  await H.open();
  check("a failed read says so, with Try again (never 'No history')", H.message().startsWith("History isn’t available right now.") && H.message().includes("Try again") && H.toolbar().text === "", H.message());
  await spike.capture("list-unavailable");
  st.dayPage = real;
  H.click([...H.root().querySelectorAll(".vh-msg button")].find((x) => x.textContent === "Try again"));
  await until(() => rows().length > 0, 4000);
  check("Try again reads it again", rows().length > 0 && !H.message());
  await H.close();

  // ---- 8. 100k visits ----
  log("--- 8. 100k visits");
  await H.clearHistory();
  const t = Date.now();
  const huge = [];
  // 20,000 pages with 5 visits each over the last 400 days.
  for (let i = 0; i < 20000; i++) {
    const v = [];
    for (let k = 0; k < 5; k++) v.push(new Date(t - 3600000 - ((i * 7 + k * 3301) % 400) * 86400000 - ((i * 13 + k) % 1000) * 60000));
    huge.push({ url: u(`h/${i}`), title: `Page number ${i} about glass and light`, visits: v });
  }
  const s0 = Date.now();
  await H.seed(huge);
  log("seeded 100k visits in", Date.now() - s0, "ms");
  H.realClock();
  b.focusPage();
  await sleep(500);
  const times = [];
  for (let n = 0; n < 3; n++) {
    // From the key to the first day page drawn (the store's 'reset' is drawn in the same task).
    let drawn = 0;
    const off = H.store().subscribe((c) => {
      if (c.type === "reset" && !drawn) drawn = performance.now();
    });
    const k0 = performance.now();
    H.press("Ctrl+H");
    await until(() => drawn && rows().length > 0, 5000);
    off();
    times.push(Math.round(drawn - k0));
    await sleep(300);
    await H.close();
    b.focusPage();
    await sleep(300);
  }
  log("Ctrl+H to the first rows (ms)", times);
  check("Ctrl+H to the first rows at 100k visits: under 100 ms once warm (the first open also opens Places' read connection)", Math.min(...times.slice(1)) < 100 && times[0] < 1000, times);
  await H.open();
  const q0 = performance.now();
  await H.search("light 1999");
  const qms = Math.round(performance.now() - q0);
  log("a search at 100k visits", qms, "ms with the typing delay", H.toolbar().text);
  check("a search at 100k visits answers (its count in the toolbar)", /match “light 1999”/.test(H.toolbar().text) && qms < 1500, { qms, text: H.toolbar().text });
  await H.search("");

  // Every loaded row is drawn: with thousands loaded, a change costs little per row (an unchanged
  // row is not painted again, an unchanged day not walked).
  log("--- 9. a change with thousands of rows loaded");
  await H.store().loadMore(20000);
  const loadedN = () => H.store().days.reduce((n, d) => n + d.rows.length, 0);
  await until(() => H.list().querySelectorAll(".vh-row").length >= loadedN(), 60000);
  await sleep(500);
  const p = H.panel();
  const syncs = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    p.sync();
    syncs.push(performance.now() - a);
  }
  syncs.sort((a, c) => a - c);
  log("rows drawn", loadedN(), "sync (ms)", syncs.map((x) => Math.round(x)));
  check(`with ${loadedN()} rows drawn, the list is brought up to date in under 60 ms (median)`, loadedN() >= 20000 && syncs[2] < 60, syncs.map((x) => Math.round(x)));
  const victim = H.visibleRows()[2];
  H.hover(victim.el);
  await sleep(150);
  const d0 = performance.now();
  H.click(victim.el.querySelector(".vh-x"));
  const dms = performance.now() - d0;
  log("a row deleted in", Math.round(dms), "ms");
  check("…and a row delete is handled in under 150 ms", dms < 150 && !!H.store().pending, Math.round(dms));
  p.undo();
  await H.close();
});
