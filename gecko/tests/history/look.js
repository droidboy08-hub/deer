// The panel's look against the boards (HistoryPanel, HistoryOpen, HistoryStates): the canonical scene
// at 1440x900 in dark mode (geometry of the sheet, title bar, sidebar, views, toolbar, first heading,
// first card and rows, the row's columns), the buttons' own sizes and colours (Delete day, the row's x,
// the views, the toolbar's buttons), light mode, the selection and undo states, the private window's
// line, and a small window (the sheet scales as a whole).
//   python tests/history/all.py look
// Captures in tests/history/out/look: look-1-dark, look-2-light, look-3-select, look-4-undo,
// look-5-private, look-6-small.
/* global spike, Services, H */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar, rect, root } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  await H.load(H.http("start.html"));
  await H.scene(1);
  H.useClock(1, 14, 40);
  await H.mode("dark");

  // ---- 1. The canonical scene ----
  log("--- 1. dark");
  b.focusPage();
  await H.open();
  const s = H.sheet();
  const cs = (el) => window.getComputedStyle(el);
  const sr = rect(s);
  // The board's window coordinates are for a 1440x900 inner window (sheet at 240,106); here the
  // sheet is centred in this window's inner size, and every rectangle is checked from its corner.
  const ox = Math.round((window.innerWidth - 960) / 2) - 240;
  const oy = Math.round((window.innerHeight - 688) / 2) - 106;
  const at = (r) => ({ ...r, x: r.x - ox, y: r.y - oy });
  check("the sheet is 960x688, centred, radius 22, over a 0.3 scrim", sr.x - ox === 240 && sr.y - oy === 106 && sr.w === 960 && sr.h === 688 && cs(s).borderRadius === "22px" && cs(root().querySelector(".vh-scrim")).backgroundColor === "rgba(8, 8, 12, 0.3)", { sr });
  check("the lens is the float lens (a url() backdrop filter)", /url\(/.test(cs(root().querySelector(".vh-lens")).backdropFilter), cs(root().querySelector(".vh-lens")).backdropFilter);
  check("dark tint rgba(20,20,24,0.62)", cs(root().querySelector(".vh-tint")).backgroundColor === "rgba(20, 20, 24, 0.62)", cs(root().querySelector(".vh-tint")).backgroundColor);
  const tb = at(rect(root().querySelector(".vh-titlebar")));
  const close = at(rect(root().querySelector(".vh-close")));
  const ttl = root().querySelector(".vh-ttl");
  check("title bar 960x48; History in 14 px Semibold at x 284; Close 30x30 at (1160,115)", tb.h === 48 && at(rect(ttl)).x === 284 && cs(ttl).fontSize === "14px" && cs(ttl).fontWeight === "600" && close.x === 1160 && close.y === 115 && close.w === 30, { tb, ttl: rect(ttl), close });
  const search = at(rect(root().querySelector(".vh-search")));
  check("the search field at (252,170) 192x34", search.x === 252 && search.y === 170 && search.w === 192 && search.h === 34, search);
  const views = [...root().querySelectorAll(".vh-view")].map((v) => at(rect(v)));
  check("the views at (252,216) and (252,252), 192x34", views[0].x === 252 && views[0].y === 216 && views[1].y === 252 && views[0].w === 192 && views[0].h === 34, views);
  const cd = at(rect(root().querySelector(".vh-cleardata")));
  check("Clear browsing data… at (252,744) 192x34", cd.x === 252 && cd.y === 744 && cd.w === 192, cd);
  const tbr = at(rect(root().querySelector(".vh-toolbar")));
  check("the toolbar at (477,172) 703x32", tbr.x === 477 && tbr.y === 172 && tbr.w === 703 && tbr.h === 32, tbr);
  const h0 = heads()[0];
  const hr = at(rect(h0.el.querySelector(".vh-hbox")));
  check("the first heading at (477,216) 703x28: Today and the date", hr.x === 477 && hr.y === 216 && hr.w === 703 && hr.h === 28 && h0.label === "Today" && !!h0.sub, { hr, h0: { label: h0.label, sub: h0.sub } });
  const card = at(rect(root().querySelector(".vh-card")));
  const r0 = rows()[0];
  check("the first card at (477,250), 703 wide, radius 10; rows of 40 from 250", card.x === 477 && card.y === 250 && card.w === 703 && at(rect(r0.el)).y === 250 && rect(r0.el).h === 40 && at(rect(rows()[1].el)).y === 290, { card, r0: at(rect(r0.el)) });
  const title = at(rect(r0.el.querySelector(".vh-title")));
  const addr = at(rect(r0.el.querySelector(".vh-addr")));
  const time = at(rect(r0.el.querySelector(".vh-time")));
  const x = at(rect(r0.el.querySelector(".vh-x")));
  const fav = at(rect(r0.el.querySelector(".vh-fav")));
  check("row columns: favicon 16 at 14, title 44-359, address 375-575, time 591-655, x 663-691", fav.x - 477 === 14 && fav.w === 16 && title.x - 477 === 44 && title.w === 315 && addr.x - 477 === 375 && addr.w === 200 && time.x - 477 === 591 && time.w === 64 && x.x - 477 === 663 && x.w === 28 && x.y - 250 === 6, { fav, title, addr, time, x });
  check("the first rows are the board's (newest first)", rows().slice(0, 3).map((r) => r.title).join(" | ") === "Sand, heat and a bath of molten tin | Float glass | Molten: a 4K study of glass in motion", rows().slice(0, 3).map((r) => r.title));
  check("addresses are hosts without www, cut at their start", r0.addr === "fieldnotes.press" && rows().every((r) => !/^www\./.test(r.addr)), r0.addr);
  check("three days: Today, Yesterday, then the date alone", heads().length === 3 && heads()[1].label === "Yesterday" && !!heads()[1].sub && heads()[2].sub === "" && /21|October|Oct/.test(heads()[2].label) === /21|October|Oct/.test(heads()[2].label), heads().map((h) => [h.label, h.sub]));
  check("the toolbar summary: '<n> pages since <date>'", /^\d[\d,]* pages since /.test(toolbar().text), toolbar().text);
  check("the house sites have no favicon: Deer's line globe", rows().every((r) => r.el.querySelector(".vh-fav svg")), null);
  // Each button has its own size and colour (the panel's button reset never outranks them).
  const hdel = h0.el.querySelector(".vh-hdel");
  check("Delete day: 12.5 px at 0.7", cs(hdel).fontSize === "12.5px" && cs(hdel).color === "rgba(255, 255, 255, 0.7)", [cs(hdel).fontSize, cs(hdel).color]);
  check("the row's x: dim 0.6", cs(r0.el.querySelector(".vh-x")).color === "rgba(255, 255, 255, 0.6)", cs(r0.el.querySelector(".vh-x")).color);
  const viewAll = root().querySelector('.vh-view[data-view="all"]');
  const viewClosed = root().querySelector('.vh-view[data-view="closed"]');
  const clearData = root().querySelector(".vh-cleardata");
  check("views: the current one full white, the other and Clear browsing data… at 0.88, all 13.5 px", cs(viewAll).color === "rgb(255, 255, 255)" && cs(viewClosed).color === "rgba(255, 255, 255, 0.88)" && cs(clearData).color === "rgba(255, 255, 255, 0.88)" && cs(viewClosed).fontSize === "13.5px" && cs(clearData).fontSize === "13.5px", [cs(viewAll).color, cs(viewClosed).color, cs(clearData).color, cs(viewClosed).fontSize]);
  H.field().focus();
  H.type("tin");
  await sleep(300);
  const clearX = root().querySelector(".vh-search-clear");
  check("the search field's clear button: dim 0.6", !clearX.hidden && cs(clearX).color === "rgba(255, 255, 255, 0.6)", cs(clearX).color);
  H.press("Escape");
  await until(() => H.field().value === "" && H.store().shown === "", 3000);
  await sleep(300);
  await spike.capture("look-1-dark");

  // ---- 2. light ----
  log("--- 2. light");
  await H.mode("light");
  check("light tint rgba(243,243,246,0.8)", cs(root().querySelector(".vh-tint")).backgroundColor === "rgba(243, 243, 246, 0.8)", cs(root().querySelector(".vh-tint")).backgroundColor);
  const lightDel = heads()[0].el.querySelector(".vh-hdel");
  const lightX = rows()[0].el.querySelector(".vh-x");
  check("light: Delete day at black 0.62, the row's x at black 0.6", cs(lightDel).color === "rgba(0, 0, 0, 0.62)" && cs(lightX).color === "rgba(0, 0, 0, 0.6)", [cs(lightDel).color, cs(lightX).color]);
  await spike.capture("look-2-light");
  await H.mode("dark");

  // ---- 3. selection ----
  log("--- 3. selection");
  for (const t of ["Float glass", "Tin bath", "Annealing lehr"]) H.click(H.row(t).el.querySelector(".vh-slot"));
  await sleep(400);
  check("selection mode: 3 selected, Delete and x in the toolbar", toolbar().text === "3 selected" && toolbar().buttons.length === 2 && H.list().classList.contains("selmode"), toolbar());
  const tbDel = toolbar().el.querySelector(".vh-tb-delete");
  check("the toolbar's Delete: 13 px, full text colour", cs(tbDel).fontSize === "13px" && cs(tbDel).color === "rgb(255, 255, 255)", [cs(tbDel).fontSize, cs(tbDel).color]);
  const hcb = heads()[0].el.querySelector(".vh-hcb");
  check("the heading's checkbox is mixed and its text moved to the title column", hcb.classList.contains("mixed") && at(rect(heads()[0].el.querySelector(".vh-htext"))).x === 477 + 44, at(rect(heads()[0].el.querySelector(".vh-htext"))));
  await spike.capture("look-3-select");
  H.press("Escape");
  await sleep(300);
  check("Esc clears the selection", !H.list().classList.contains("selmode") && rows().every((r) => !r.selected));

  // ---- 4. undo line ----
  log("--- 4. undo");
  H.panel().undoMs = 60000;
  H.click(H.row("Tin bath").el, { type: "mousemove" });
  H.hover(H.row("Tin bath").el);
  await sleep(200);
  H.click(H.row("Tin bath").el.querySelector(".vh-x"));
  await sleep(600);
  check("the undo line names the day", toolbar().text === "Deleted “Tin bath” from Today." && toolbar().buttons.includes("Undo"), toolbar());
  check("Undo: 13 px", cs(toolbar().el.querySelector(".vh-tb-undo")).fontSize === "13px", cs(toolbar().el.querySelector(".vh-tb-undo")).fontSize);
  await spike.capture("look-4-undo");
  H.click(toolbar().el.querySelector("button"));
  await sleep(500);
  check("Undo brings the row back", !!H.row("Tin bath"));
  await H.close();

  // ---- 5. small window ----
  log("--- 5. small window");
  await spike.resize(900, 640);
  await H.open();
  const small = H.sheet().getBoundingClientRect();
  const fit = Math.min(1, (window.innerWidth - 32) / 960, (window.innerHeight - 32) / 688);
  check("below 992x720 the sheet scales as a whole with 16 px margins (nothing re-flows)", fit < 1 && Math.abs(small.width - 960 * fit) < 1 && Math.abs(small.height - 688 * fit) < 1 && small.left >= 15.5 && small.top >= 15.5 && H.sheet().offsetWidth === 960, { w: small.width, left: small.left, top: small.top, fit });
  await spike.capture("look-6-small");
  await H.close();
  await spike.resize(1440, 900);

  // ---- 6. private window ----
  log("--- 6. private window");
  const pw = await spike.openWindow({ private: true });
  await sleep(800);
  pw.focus();
  pw.vitre.focusPage();
  await sleep(200);
  pw.spike.EU.synthesizeKey("h", { ctrlKey: true }, pw);
  await until(() => pw.vitreHistory?.panel.isOpen, 4000);
  await sleep(500);
  const pr = pw.document.getElementById("vitre-history");
  const line = pr.querySelector(".vh-private");
  check("a private window shows only the title bar and its line", !!line && line.textContent === "History isn’t shown in private windows." && !pr.querySelector(".vh-side, .vh-toolbar, .vh-list"), pr.textContent);
  await pw.spike.capture("look-5-private");
  pw.close();
  await sleep(500);
});
