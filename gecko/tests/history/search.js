// The search (../design/HISTORY-SPEC.md "Search"): every word, anywhere in the title or the address,
// case-insensitive; one row per page under the day of its last visit, newest first; matches Semibold;
// a match only in the path shows host/…/segment; the count; "Searching…" after 400 ms; no match
// (Clear search); Esc clears then closes; Down / Enter into the list; 150 more on scroll; a deleted
// result leaves the results; Recently closed searched in memory; the query kept between views.
//   python tests/history/all.py search
/* global spike, Services, H */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, at } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const page = await H.load(H.http("start.html"));
  await H.scene(1);
  H.useClock(1, 14, 40);
  // Float glass visited again today: one result, under its last day.
  await H.seed([{ url: "https://refract.wiki/wiki/Float_glass", title: "Float glass", visits: [at(3, 9, 0)] }]);
  b.focusPage();
  await H.open();

  // ---- 1. words, matches, path matches ----
  log("--- 1. glass");
  await H.search("glass");
  const r1 = rows();
  log("results", r1.map((r) => `${r.title} | ${r.addr}`));
  check("results for every page whose title or address has the word", r1.length === 7 && r1.every((r) => /glass/i.test(r.title + r.addr) || r.addr.includes("…")), r1.map((r) => r.title));
  check("one row per page (Float glass once, under the day of its last visit)", r1.filter((r) => r.title === "Float glass").length === 1 && r1.find((r) => r.title === "Float glass").group === heads()[0].group && heads()[0].label === "Today", heads().map((h) => h.label));
  check("the toolbar counts them: '7 pages match “glass”'", toolbar().text === "7 pages match “glass”", toolbar().text);
  const fg = H.row("Float glass");
  check("matched characters are Semibold, no colour fill", fg.el.querySelector(".vh-title b")?.textContent === "glass" && getComputedStyle(fg.el.querySelector(".vh-title b")).fontWeight === "600" && getComputedStyle(fg.el.querySelector(".vh-title b")).backgroundColor === "rgba(0, 0, 0, 0)");
  const path = H.row("Sand, heat and a bath of molten tin");
  check("a match only in the path shows the host and the matching segment", path?.addr === "fieldnotes.press/…/float-glass" && path.el.querySelector(".vh-addr b")?.textContent === "glass", path?.addr);
  check("the address column's match turns to the full text colour", getComputedStyle(path.el.querySelector(".vh-addr b")).color === getComputedStyle(path.el.querySelector(".vh-title")).color);
  check("the list is named for the search", H.list().getAttribute("aria-label") === "Search results for glass", H.list().getAttribute("aria-label"));
  await spike.capture("search-1-glass");

  log("--- 2. several words, any case");
  await H.search("TIN bath");
  check("every word, anywhere, any case: 'TIN bath' finds Tin bath, The tin bath… and …a bath of molten tin", rows().map((r) => r.title).sort().join("|") === ["Sand, heat and a bath of molten tin", "The tin bath, explained in five minutes", "Tin bath"].sort().join("|"), rows().map((r) => r.title));
  await H.search("tin bath five");
  check("'1 page matches'", toolbar().text === "1 page matches “tin bath five”", toolbar().text);

  // ---- 3. no match ----
  log("--- 3. no match");
  await H.search("obsidian");
  check("no match: the two lines and Clear search, the toolbar empty", H.message().startsWith("No pages match “obsidian”.") && H.message().includes("Search looks in page titles and addresses.") && toolbar().text === "" && rows().length === 0, { msg: H.message(), tb: toolbar().text });
  await spike.capture("search-2-nomatch");
  H.click([...H.root().querySelectorAll(".vh-msg button")].find((x) => x.textContent === "Clear search"));
  await until(() => H.store().shown === "" && rows().length > 10, 3000);
  check("Clear search empties the field and All history comes back, focus in the field", H.field().value === "" && document.activeElement === H.field() && heads()[0].label === "Today");

  // ---- 4. keys in the field ----
  log("--- 4. keys in the field");
  await H.search("glass");
  H.press("Escape");
  await until(() => H.store().shown === "", 3000);
  check("Esc clears the text first", H.isOpen() && H.field().value === "" && rows().length > 10);
  await H.search("glass");
  const url = b.active().url;
  H.press("Enter");
  await sleep(300);
  check("Enter moves to the first result and never opens a page from the field", H.isOpen() && H.focused() === "row:" + rows()[0].title && b.active().url === url, H.focused());
  H.field().focus();
  H.press("Down");
  await sleep(200);
  check("Down moves to the first result", H.focused() === "row:" + rows()[0].title, H.focused());
  H.field().focus();
  H.press("Ctrl+A");
  await sleep(100);
  check("Ctrl+A in the field selects its text (no row is selected)", H.field().selectionStart === 0 && H.field().selectionEnd === 5 && rows().every((r) => !r.selected));
  // ---- 5. Searching… ----
  log("--- 5. Searching…");
  const st = H.store();
  const real = st.searchPage;
  st.searchPage = async function (...args) {
    await sleep(700);
    return real.apply(this, args);
  };
  H.field().select();
  H.type("lehr");
  await sleep(560);
  const slow = toolbar().text;
  const old = rows().map((r) => r.title).join("|");
  check("after 400 ms without an answer the toolbar says Searching…, and the old results stay", slow === "Searching…" && old.includes("Float glass"), { slow, old });
  await until(() => st.shown === "lehr", 3000);
  await sleep(200);
  st.searchPage = real;
  check("…until the answer arrives", toolbar().text === "1 page matches “lehr”" && rows().length === 1, toolbar().text);

  // ---- 6. more on scroll ----
  log("--- 6. more on scroll");
  const many = [];
  for (let i = 0; i < 400; i++) many.push({ url: `https://archive.example/scroll/${i}`, title: `Scrolling result ${i}`, visits: [new Date(at(2, 20, 0).getTime() - i * 60000)] });
  await H.seed(many);
  await H.search("scrolling result");
  check("the first page holds 150 results; the count says all 400", rows().length === 150 && toolbar().text === "400 pages match “scrolling result”", { n: rows().length, tb: toolbar().text });
  H.scroller().scrollTop = H.scroller().scrollHeight;
  await until(() => rows().length >= 300, 3000);
  check("scrolling near the end loads the next 150", rows().length === 300, rows().length);

  // ---- 7. deleting a result ----
  log("--- 7. deleting a result");
  await H.search("float glass");
  H.panel().undoMs = 600000;
  const before = rows().map((r) => r.title);
  H.hover(H.row("Float glass").el);
  await sleep(150);
  H.click(H.row("Float glass").el.querySelector(".vh-x"));
  await sleep(600);
  check("a deleted result leaves the results at once (its day's visits only, pending)", !H.row("Float glass") && before.includes("Float glass") && /^Deleted “Float glass” from Today\.$/.test(toolbar().text), { tb: toolbar().text });
  await H.search("float");
  check("while pending, a new search leaves it out too", !H.row("Float glass"), rows().map((r) => r.title));
  await H.panel().commit();
  await sleep(500);
  await H.search("float glass");
  check("once committed, a page with older visits is listed again under its new last day", !!H.row("Float glass") && H.row("Float glass").group !== heads()[0].group || (H.row("Float glass") && heads().find((h) => h.group === H.row("Float glass").group).label === "Yesterday"), heads().map((h) => h.label));

  // ---- 8. Recently closed, and the query between views ----
  log("--- 8. Recently closed");
  await H.close();
  for (const leaf of ["c.html", "d.html", "e.html"]) {
    const t = b.newTab(H.http(leaf), { background: true });
    await until(() => !t.loading && t.title && t.title !== "New Tab", 10000);
    await sleep(200);
    b.closeTab(t);
    await sleep(300);
  }
  await H.open();
  H.click(H.root().querySelector('.vh-view[data-view="closed"]'));
  await sleep(300);
  check("Recently closed: the field asks 'Search recently closed'", H.field().placeholder === "Search recently closed" && H.field().getAttribute("aria-label") === "Search recently closed");
  H.field().focus();
  H.type("ice");
  await sleep(300);
  check("its search runs in memory over the closed tabs", rows().length === 1 && rows()[0].title === "The quiet science of ice" && toolbar().text === "1 tab matches “ice”", { rows: rows().map((r) => r.title), tb: toolbar().text });
  H.click(H.root().querySelector('.vh-view[data-view="all"]'));
  await until(() => H.store().shown === "ice", 3000);
  await sleep(200);
  check("the query stays when switching back to All history, and searches it", H.field().value === "ice" && rows().some((r) => r.title === "The quiet science of ice") && H.field().placeholder === "Search history");
  await H.close();
  check("(the page is untouched)", b.active() === page);
});
