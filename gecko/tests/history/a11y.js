// Accessibility (../design/HISTORY-SPEC.md "Accessibility"): roles and names in the DOM and in Gecko's
// accessibility tree (the dialog named History; the searchbox described; the views nav with the
// current view; Clear browsing data's name; the grid with aria-rowcount -1 until the end; rowgroups;
// rowheaders; rows with aria-selected and their names; the x's and Delete day's names; the checkbox
// hidden), the polite announcements, a private window's dialog described by its line, forced colours.
//   python tests/history/all.py a11y
/* global spike, Services, H, Cc, Ci */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, at } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  await H.load(H.http("start.html"));
  await H.scene(1);
  H.useClock(1, 14, 40);
  const fmt = (opts, d) => new Services.intl.DateTimeFormat(undefined, opts).format(d);
  const time = (d) => fmt({ hour: "numeric", minute: "2-digit" }, d);
  b.focusPage();
  await H.open();
  const R = H.root();

  // ---- 1. the DOM's roles and names ----
  log("--- 1. roles and names");
  const dialog = R.querySelector(".vh-sheet");
  check("the panel is a modal dialog named History", dialog.getAttribute("role") === "dialog" && dialog.getAttribute("aria-modal") === "true" && document.getElementById(dialog.getAttribute("aria-labelledby"))?.textContent === "History");
  const f = H.field();
  check("the search field: searchbox 'Search history', described as 'Searches page titles and addresses'", f.getAttribute("role") === "searchbox" && f.getAttribute("aria-label") === "Search history" && f.getAttribute("aria-description") === "Searches page titles and addresses");
  const nav = R.querySelector("nav.vh-views");
  const views = [...nav.querySelectorAll("button")];
  check("the views: a nav 'History views' with All history (aria-current page) and Recently closed", nav.getAttribute("aria-label") === "History views" && views[0].textContent === "All history" && views[0].getAttribute("aria-current") === "page" && views[1].getAttribute("aria-label") === "Recently closed");
  check("Clear browsing data: 'Clear browsing data, opens Settings'", R.querySelector(".vh-cleardata").getAttribute("aria-label") === "Clear browsing data, opens Settings");
  const grid = H.list();
  // (This history is small: its end has loaded, so the count is known; list.js checks -1 before the end.)
  check("the list: a multiselectable grid named All history, its row count once the end has loaded", grid.getAttribute("role") === "grid" && grid.getAttribute("aria-multiselectable") === "true" && grid.getAttribute("aria-label") === "All history" && grid.getAttribute("aria-rowcount") === String(grid.querySelectorAll(".vh-head, .vh-row").length), grid.getAttribute("aria-rowcount"));
  check("each day is a rowgroup", [...grid.querySelectorAll(".vh-group")].every((g) => g.getAttribute("role") === "rowgroup"));
  const h0 = heads()[0];
  const full = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, at(1, 12, 0));
  check("a heading is a row: rowheader 'Today, <date>, 14 pages', and the cell with 'Delete day, Today'", h0.el.getAttribute("role") === "row" && h0.aria === `Today, ${full}, 14 pages` && h0.el.querySelector("[role=gridcell] button").getAttribute("aria-label") === "Delete day, Today", h0.aria);
  const older = heads()[2];
  check("an older day's Delete day starts with its visible label: 'Delete day, <date>'", older.el.querySelector(".vh-hdel").getAttribute("aria-label") === `Delete day, ${older.label}`, older.el.querySelector(".vh-hdel").getAttribute("aria-label"));
  const fg = H.row("Float glass");
  check("a page row: role row, aria-selected false, named 'Float glass, refract.wiki, <time>'", fg.el.getAttribute("role") === "row" && fg.el.getAttribute("aria-selected") === "false" && fg.aria === `Float glass, refract.wiki, ${time(at(1, 14, 27))}`, fg.aria);
  check("its x: 'Delete from history, Float glass, Today'", fg.el.querySelector(".vh-x").getAttribute("aria-label") === "Delete from history, Float glass, Today");
  check("the checkbox is hidden from assistive technology (aria-selected carries the state)", fg.el.querySelector(".vh-slot").getAttribute("aria-hidden") === "true");
  const idx = [...grid.querySelectorAll(".vh-head, .vh-row")].map((x) => Number(x.getAttribute("aria-rowindex")));
  check("drawn rows carry aria-rowindex 1..n in order", idx.every((n, i) => n === i + 1), idx.slice(0, 5));

  // ---- 2. Gecko's accessibility tree ----
  log("--- 2. the accessibility tree");
  const svc = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
  await sleep(500);
  const acc = (el) => {
    try {
      return svc.getAccessibleFor(el);
    } catch {
      return null;
    }
  };
  const role = (a) => (a ? svc.getStringRole(a.role) : "none");
  await until(() => acc(fg.el), 3000);
  const ad = acc(dialog);
  const ar = acc(fg.el);
  const ag = acc(grid);
  log("roles", role(ad), role(ag), role(ar));
  check("the tree: dialog 'History', grid 'All history', row 'Float glass, …'", role(ad) === "dialog" && ad.name === "History" && role(ag) === "grid" && ag.name === "All history" && role(ar) === "row" && ar.name === fg.aria, { d: [role(ad), ad?.name], g: [role(ag), ag?.name], r: [role(ar), ar?.name] });
  const as = acc(f);
  check("…the searchbox named 'Search history' with its description", role(as) === "searchbox" && as.name === "Search history" && as.description === "Searches page titles and addresses", { r: role(as), n: as?.name, d: as?.description });

  // ---- 3. announcements ----
  log("--- 3. announcements");
  const live = R.querySelector(".vh-live");
  check("a polite live region", live.getAttribute("aria-live") === "polite" && live.getAttribute("role") === "status");
  await H.search("glass");
  await sleep(650);
  check("'7 pages found'", H.panel().announced === "7 pages found", H.panel().announced);
  await H.search("obsidian");
  await sleep(650);
  check("'No pages found'", H.panel().announced === "No pages found", H.panel().announced);
  await H.search("");
  for (const t of ["Float glass", "Tin bath", "Annealing lehr"]) H.click(H.row(t).el.querySelector(".vh-slot"));
  await sleep(650);
  check("'3 selected'", H.panel().announced === "3 selected", H.panel().announced);
  check("…and the rows say aria-selected true", rows().filter((r) => r.selected).length === 3);
  H.press("Escape");
  await sleep(200);

  // With assistive technology running, the undo line stays until the next action.
  H.panel().assistive = true;
  H.panel().undoMs = 400;
  H.hover(H.row("Tin bath").el);
  await sleep(150);
  H.click(H.row("Tin bath").el.querySelector(".vh-x"));
  await sleep(1200);
  check("with assistive technology running the undo line outlives its 10 s (here 0.4 s)", !!H.store().pending && /^Deleted/.test(H.toolbar().text));
  H.press("Ctrl+Z");
  await sleep(700);
  check("'Restored 1 page'", H.panel().announced === "Restored 1 page", H.panel().announced);
  H.panel().assistive = null;

  // ---- 4. forced colours ----
  log("--- 4. forced colours");
  window.browsingContext.forcedColorsOverride = "active";
  const forced = await until(() => window.matchMedia("(forced-colors: active)").matches, 5000);
  check("forced colours can be simulated in the chrome", !!forced);
  if (forced) {
    H.click(H.row("Float glass").el.querySelector(".vh-slot"));
    rows()[3].el.focus({ focusVisible: true });
    await sleep(500);
    const cs = (el) => getComputedStyle(el);
    check("forced colours: the sheet is solid Canvas without the lens", cs(R.querySelector(".vh-lens")).backdropFilter === "none" && !/rgba\(.*0\.\d+\)/.test(cs(R.querySelector(".vh-tint")).backgroundColor), cs(R.querySelector(".vh-tint")).backgroundColor);
    const plate = cs(H.row("Float glass").el.querySelector(".vh-plate")).backgroundColor;
    const hl = (() => {
      const p = document.createElement("div");
      p.style.background = "Highlight";
      document.documentElement.append(p);
      const c = getComputedStyle(p).backgroundColor;
      p.remove();
      return c;
    })();
    check("…a selected row is Highlight", plate === hl, { plate, hl });
    check("…cards get a 1 px outline", cs(R.querySelector(".vh-card")).outlineStyle === "solid");
    await spike.capture("a11y-1-forced-colors");
    window.browsingContext.forcedColorsOverride = "none";
    H.press("Escape");
    await sleep(300);
  }
  await H.close();

  // ---- 5. a private window ----
  log("--- 5. a private window");
  const pw = await spike.openWindow({ private: true });
  await sleep(800);
  pw.vitre.service("history").open();
  await until(() => pw.vitreHistory.panel.isOpen, 3000);
  await sleep(500);
  const pd = pw.document.querySelector("#vitre-history .vh-sheet");
  const note = pw.document.getElementById(pd.getAttribute("aria-describedby"));
  check("private: the dialog is described by its one line", note?.textContent === "History isn’t shown in private windows.");
  await until(() => acc(pd), 3000);
  const apd = acc(pd);
  check("…in the tree too: dialog 'History' described 'History isn’t shown in private windows.'", role(apd) === "dialog" && apd.name === "History" && apd.description === "History isn’t shown in private windows.", { r: role(apd), n: apd?.name, d: apd?.description });
  check("…and Close is its only control", [...pd.querySelectorAll("button, input, [tabindex]")].length === 1);
  pw.close();
  await sleep(500);
});
