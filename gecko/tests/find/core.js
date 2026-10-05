// Find in page: the core battery (see tests/find/all.py). Local page served over http, with a
// cross-site frame from localhost (another content process).
/* global spike, FL, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/flib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  log("modules", b.modules, "errors", b.moduleErrors);
  check("find module installed", b.modules.includes("find"), b.moduleErrors);
  check("find service provided", !!b.service("find"));

  await FL.load(FL.http("article.html"));
  await sleep(1200);
  b.focusPage();
  await sleep(300);
  const tabA = b.active();

  // ---- open from the page ----
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open");
  await sleep(450);
  let s = FL.st();
  check("Ctrl+F from the page opens find in the pill, focused", s?.open && s.view === "pill" && s.focused, s);
  const pill = b.bar.layout.pillRect;
  const faceR = FL.rectOf(FL.face());
  check("the face lies exactly over the pill", pill && faceR && faceR.x === Math.round(pill.x) && faceR.y === Math.round(pill.y) && faceR.w === Math.round(pill.width) && faceR.h === 44, { pill: pill && { x: pill.x, y: pill.y, w: pill.width }, faceR });
  check("the pill's own face is hidden", b.root.classList.contains("find-face") && getComputedStyle(b.bar.item(tabA.id).querySelector(".pill-face")).visibility === "hidden");
  check("focused tint (find-focused)", b.root.classList.contains("find-focused"));
  check("empty counter, chevrons disabled", s.counter === "" && FL.face().querySelector(".vf-prev").getAttribute("aria-disabled") === "true");
  await capture("core-01-open-empty");

  // ---- live search ----
  FL.type("glass");
  s = await FL.counter("1 of 13");
  check("typing 'glass' -> 1 of 13 (11 in the page, 2 in the cross-site frame)", s?.counter === "1 of 13", s);
  await capture("core-02-results");

  // ---- steps ----
  spike.press("Enter");
  await FL.counter("2 of 13");
  spike.press("Enter");
  s = await FL.counter("3 of 13");
  check("Enter x2 -> 3 of 13", s?.counter === "3 of 13", s);
  spike.press("Shift+Enter");
  s = await FL.counter("2 of 13");
  check("Shift+Enter -> 2 of 13", s?.counter === "2 of 13", s);
  spike.press("F3");
  s = await FL.counter("3 of 13");
  check("F3 -> 3 of 13", s?.counter === "3 of 13", s);
  spike.press("Shift+F3");
  s = await FL.counter("2 of 13");
  check("Shift+F3 -> 2 of 13", s?.counter === "2 of 13", s);
  spike.press("Ctrl+G");
  s = await FL.counter("3 of 13");
  check("Ctrl+G -> 3 of 13", s?.counter === "3 of 13", s);
  spike.press("Ctrl+Shift+G");
  s = await FL.counter("2 of 13");
  check("Ctrl+Shift+G -> 2 of 13", s?.counter === "2 of 13", s);
  FL.face().querySelector(".vf-next").click();
  s = await FL.counter("3 of 13");
  check("the next button -> 3 of 13", s?.counter === "3 of 13", s);

  // Bursts must not leave a stuck "N of 1,000+" (verifier's correction 1).
  let plusSeen = 0;
  const obs = new MutationObserver(() => {
    if (/\+$/.test(FL.st()?.counter ?? "")) plusSeen++;
  });
  obs.observe(FL.face().querySelector(".vf-count"), { childList: true, characterData: true, subtree: true });
  for (let i = 0; i < 6; i++) spike.press("Enter");
  s = await FL.settle(600);
  log("after 6 quick Enter", s);
  check("a burst of 6 Enter lands on a real count", /^\d+ of 13$/.test(s?.counter ?? ""), s);
  check("no N+ text during the burst", plusSeen === 0, plusSeen);
  obs.disconnect();

  // Page Down / Page Up / Down in the field scroll the page; focus stays in the field.
  const y0 = (await FL.pageState()).scrollY;
  spike.press("PageDown");
  await sleep(700);
  const y1 = (await FL.pageState()).scrollY;
  spike.press("Down");
  await sleep(400);
  const y2 = (await FL.pageState()).scrollY;
  spike.press("PageUp");
  await sleep(700);
  const y3 = (await FL.pageState()).scrollY;
  log("scroll from the field", { y0, y1, y2, y3 });
  check("Page Down in the field scrolls the page by most of a view, Down by a line", y1 - y0 > 500 && y2 - y1 >= 30 && y2 - y1 <= 50 && document.activeElement === FL.input(), { y0, y1, y2 });
  check("Page Up scrolls back", y3 < y2 - 500, { y2, y3 });
  await FL.inPage("function (w, d) { w.scrollTo(0, 0); return 0; }");
  await sleep(200);

  // Ctrl+F in the field selects all, no motion; Tab cycles field -> previous -> next -> Aa -> ×.
  FL.input().setSelectionRange(5, 5);
  spike.press("Ctrl+F");
  await sleep(150);
  check("Ctrl+F while open selects the field's text, find stays as it is", FL.st()?.open && FL.input().selectionStart === 0 && FL.input().selectionEnd === 5 && FL.F().face.mode === "open");
  const order = [];
  for (let i = 0; i < 5; i++) {
    spike.press("Tab");
    await sleep(60);
    order.push(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.localName);
  }
  check("Tab cycles field -> previous -> next -> Aa -> × -> field", order.join("|") === "Previous match|Next match|Match case|Close find|Find on page", order);
  spike.press("Shift+Tab");
  await sleep(60);
  check("Shift+Tab goes back", document.activeElement?.getAttribute("aria-label") === "Close find", document.activeElement?.getAttribute("aria-label"));
  FL.input().focus();
  await sleep(60);

  const ordOf = () => Number((FL.st()?.counter ?? "").split(" ")[0].replace(/,/g, "")) || 0;
  /** Step with Enter (one at a time, no merging) until the counter's ordinal is n. */
  async function stepTo(n, key = "Enter") {
    for (let i = 0; i < 30 && ordOf() !== n; i++) {
      spike.press(key);
      await sleep(260);
    }
    return ordOf() === n;
  }
  const browserBox = () => gBrowser.selectedBrowser.getBoundingClientRect();
  const inside = (r, box, slack = 2) => r && box && r.x >= box.x - slack && r.y >= box.y - slack && r.x + r.width <= box.x + box.w + slack && r.y + r.height <= box.y + box.h + slack;

  // ---- into the cross-site frame, the ring there, and the wrap ----
  check("stepped to match 12", await stepTo(12));
  await sleep(450);
  s = FL.st();
  const frame = await FL.inPage("function (w, d) { const r = d.getElementById('xframe').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }");
  const bb = browserBox();
  const frameWin = { x: bb.x + frame.x, y: bb.y + frame.y, w: frame.w, h: frame.h };
  log("match 12", s.rect, "frame box", frameWin, "ring", FL.F().ring.last);
  check("match 12 lies inside the cross-site frame (frame-relative rect carried up)", inside(s.rect, frameWin), { rect: s.rect, frameWin });
  check("the ring landed on it", FL.F().ring.last && Math.abs(FL.F().ring.last.y - s.rect.y) < 1, FL.F().ring.last);
  spike.press("Enter");
  await FL.counter("13 of 13");
  spike.press("Enter");
  s = await FL.counter("1 of 13");
  await sleep(120);
  check("Enter on the last match wraps to 1 of 13", s?.counter === "1 of 13", s);
  check("the wrap is announced", FL.face().querySelector(".vf-sr").textContent === "Wrapped to first match", FL.face().querySelector(".vf-sr").textContent);
  spike.press("Shift+Enter");
  s = await FL.counter("13 of 13");
  check("Shift+Enter on the first match wraps to 13 of 13", s?.counter === "13 of 13", s);
  await sleep(250);
  FL.F().ring.freeze();
  await capture("core-03-frame-ring");

  // ---- match case ----
  spike.press("Alt+C");
  await FL.until(() => FL.st()?.total === 11, "11 with case");
  s = await FL.settle(300);
  check("Alt+C: match case on, 'glass' -> 11", s?.matchCase && s.total === 11 && FL.face().querySelector(".vf-case").getAttribute("aria-pressed") === "true", s);
  await FL.query("Glass");
  await FL.until(() => FL.st()?.total === 2, "2 Glass");
  s = await FL.settle(300);
  check("match case: 'Glass' -> N of 2", /^\d of 2$/.test(s?.counter ?? ""), s);
  await capture("core-04-match-case");
  spike.press("Alt+C");
  await FL.until(() => FL.st()?.total === 13, "13 again");
  check("Alt+C again: case off, 13", FL.st()?.total === 13 && !FL.st().matchCase, FL.st());

  // ---- no matches, empty ----
  await FL.query("glasszz");
  s = await FL.counter("No matches");
  const cnt = FL.face().querySelector(".vf-count");
  check("no matches: 'No matches' in #c42b1c", s?.counter === "No matches" && getComputedStyle(cnt).color === "rgb(196, 43, 28)", getComputedStyle(cnt).color);
  check("no matches: chevrons disabled", FL.face().querySelector(".vf-next").getAttribute("aria-disabled") === "true");
  spike.press("Enter");
  await sleep(200);
  check("Enter on no matches keeps 'No matches' (the counter pulses)", FL.st()?.counter === "No matches");
  await capture("core-05-no-matches");
  await FL.query("");
  s = await FL.settle(300);
  check("empty field: blank counter, chevrons disabled", s?.counter === "" && FL.face().querySelector(".vf-prev").getAttribute("aria-disabled") === "true", s);

  // ---- Esc keeps the match selected and focuses its link; Ctrl+F returns to it ----
  await FL.query("glass");
  await FL.counter("1 of 13");
  check("stepped to the link's match (5)", await stepTo(5));
  await sleep(300);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed");
  await sleep(350);
  let page = await FL.pageState();
  log("after Esc", page);
  check("Esc closes find", !FL.st()?.open && FL.face().hidden && !b.root.classList.contains("find-face"));
  check("the match stays selected", page.sel === "glass", page);
  check("its link has focus", page.active === "link1", page);
  check("the page has focus", document.activeElement === gBrowser.selectedBrowser);
  await capture("core-06-closed-selected");
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "reopen");
  s = await FL.counter("5 of 13");
  check("Esc then Ctrl+F returns to the same match (5 of 13), query selected", s?.counter === "5 of 13" && s.query === "glass" && FL.input().selectionStart === 0 && FL.input().selectionEnd === 5, s);

  // ---- Ctrl+Enter follows the link match ----
  await sleep(300);
  spike.press("Ctrl+Enter");
  const followed = await FL.until(() => gBrowser.selectedBrowser.currentURI.spec.includes("counter.html"), "followed", 8000);
  check("Ctrl+Enter closes find and clicks the match's link", !!followed && !FL.st()?.open, gBrowser.selectedBrowser.currentURI.spec);

  // ---- pre-fill from a selection made since find closed ----
  await FL.load(FL.http("article.html"));
  await sleep(900);
  b.focusPage();
  await sleep(700);
  // A page that selects by script does not pre-fill; the user's double-click does.
  await FL.inPage("function (w, d) { return w.find('surface tension'); }");
  await sleep(200);
  const scripted = await b.page(b.active()).query("find:selection");
  check("a selection made by script is not a fresh one", scripted && scripted.fresh === false, scripted);
  const word = await FL.inPage("function (w, d) { const t = d.getElementById('p2').firstChild; const i = t.data.indexOf('Pilkington'); const r = d.createRange(); r.setStart(t, i); r.setEnd(t, i + 10); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }");
  const wb = browserBox();
  spike.EU.synthesizeMouseAtPoint(wb.x + word.x, wb.y + word.y, { clickCount: 2 }, window);
  await sleep(300);
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open with selection");
  s = await FL.counter("1 of 1");
  page = await FL.pageState();
  check("pre-fill: the user's selection becomes the query, 1 of 1", s?.query === "Pilkington" && s.counter === "1 of 1", s);
  check("pre-fill: the field's text is selected", FL.input().selectionStart === 0 && FL.input().selectionEnd === "Pilkington".length);
  check("pre-fill: the page did not jump", page.scrollY === 0, page.scrollY);
  await capture("core-07-prefill");

  // ---- parked: F6 to the page and back; Esc ladder 90 ----
  spike.press("F6");
  await sleep(300);
  s = FL.st();
  check("F6 from the field: find stays open, parked (focus in the page)", s?.open && !s.focused && document.activeElement === gBrowser.selectedBrowser && !b.root.classList.contains("find-focused"), s);
  await capture("core-08-parked");
  spike.press("F6");
  await sleep(300);
  check("F6 from the page comes back to the field", FL.st()?.focused === true && document.activeElement === FL.input());
  spike.press("F6");
  await sleep(300);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "parked closed");
  check("Esc in the page closes parked find (after the page)", !FL.st()?.open);

  // ---- F3 with find closed reopens it parked and steps ----
  await sleep(300);
  spike.press("F3");
  await FL.until(() => FL.st()?.open, "F3 reopen");
  s = await FL.counter("1 of 1");
  check("F3 with find closed: reopens parked with the last query", s?.open && !s.focused && s.query === "Pilkington" && s.counter === "1 of 1", s);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed again");

  // ---- Ctrl+L leaves find for the address field, keeping the query ----
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open && FL.st()?.focused, "open focused");
  await FL.query("glass");
  await FL.counter("1 of 13");
  spike.press("Ctrl+L");
  await FL.until(() => b.omni.open && !FL.st()?.open, "omni");
  check("Ctrl+L in the field: the address field opens, find closes", b.omni.open && !FL.st()?.open);
  await sleep(300);
  await capture("core-09-ctrl-l");
  spike.press("Escape");
  spike.press("Escape");
  await FL.until(() => !b.omni.open, "omni closed");
  await sleep(300);
  b.focusPage();
  await sleep(200);
  spike.press("F3");
  await FL.until(() => FL.st()?.open, "F3 after Ctrl+L");
  s = await FL.settle(400);
  check("the query survives Ctrl+L for F3", s?.query === "glass" && /of 13$/.test(s.counter), s);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed 3");

  // ---- Home: Ctrl+F opens the address field ----
  b.newTab();
  await FL.until(() => b.omni.open, "new tab field");
  spike.press("Escape");
  await FL.until(() => !b.omni.open, "home field closed", 3000);
  await sleep(300);
  spike.press("Ctrl+F");
  await FL.until(() => b.omni.open, "Ctrl+F on Home");
  check("Ctrl+F on Home opens the address field, not find", b.omni.open && !FL.st()?.open, { omni: b.omni.open, st: FL.st() });
  b.omni.close();
  b.closeTab(b.active());
  await sleep(400);

  // ---- tab switch: the face follows its tab ----
  b.activate(tabA);
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open A");
  await FL.settle(400);
  const ordA = FL.st()?.counter;
  const tabB = b.newTab(FL.http("dark.html"));
  await sleep(1500);
  check("another tab: the face hides", FL.face().hidden && b.active() === tabB && !b.root.classList.contains("find-face"));
  b.activate(tabA);
  await sleep(700);
  s = FL.st();
  check("back on the tab: its find comes back, parked, same match", s?.open && s.view === "pill" && !FL.face().hidden && !s.focused && s.counter === ordA, { s, ordA });
  const faceBack = FL.rectOf(FL.face());
  const pillBack = b.bar.layout.pillRect;
  check("the restored face sits on the pill", faceBack.x === Math.round(pillBack.x) && faceBack.w === Math.round(pillBack.width), { faceBack, pill: [pillBack.x, pillBack.width] });
  await capture("core-10-tab-back");
  b.closeTab(tabB);
  await sleep(300);
  FL.face().querySelector(".vf-close").click();
  await FL.until(() => !FL.st()?.open, "x closed");
  check("× closes find", !FL.st()?.open);
  await sleep(300);
  check("the reload slot ignores clicks for a moment after ×", b.root.classList.contains("find-cooldown"));

  // ---- the count limit ----
  await FL.load(FL.http("long.html"));
  await sleep(900);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open long");
  FL.type("glass");
  s = await FL.counter("1 of 1,000+", 6000);
  check("past the count limit: '1 of 1,000+'", s?.counter === "1 of 1,000+", s);
  await capture("core-11-limit");

  // ---- the scroll guard and the ring: a match under the glass ----
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed long");
  await FL.inPage("function (w, d) { w.scrollTo(0, 0); return 0; }");
  await sleep(300);
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open guard");
  await FL.query("ribbon");
  s = await FL.counter("1 of 60");
  check("'ribbon' -> 1 of 60", s?.counter === "1 of 60", s);
  // Scroll the page so the next match sits under the glass (y 22), as on the FindContexts board.
  const before = await FL.inPage("function (w, d) { const p = d.getElementById('p20'); w.scrollTo(0, p.getBoundingClientRect().top + w.scrollY - 22); return { y: p.getBoundingClientRect().top, scrollY: w.scrollY }; }");
  await sleep(500);
  log("p20 before the step", before);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 2, "ord 2");
  await FL.until(() => FL.F().ring.visible, "ring", 1500);
  await sleep(150);
  FL.F().ring.freeze();
  s = FL.st();
  const after = await FL.inPage("function (w, d) { return { y: d.getElementById('p20').getBoundingClientRect().top, scrollY: w.scrollY }; }");
  log("guard: match 2", s.rect, "p20 after", after);
  check("a match under the glass is moved clear of it (y >= 68)", s?.rect && s.rect.y >= 68, s?.rect);
  check("... to about y 92 (the guard), or below the bar by Gecko's own scroll", s?.rect && s.rect.y <= 470, s?.rect);
  check("the ring landed on the match", FL.F().ring.visible && Math.abs(FL.F().ring.last.y - s.rect.y) < 1, FL.F().ring.last);
  await capture("core-12-guard-ring");
  await FL.inPage("function (w, d) { w.scrollBy(0, 40); return w.scrollY; }");
  await FL.until(() => !FL.F().ring.visible, "ring cancelled", 1500);
  check("scrolling the page sends the ring away", !FL.F().ring.visible);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 3, "ord 3");
  await sleep(600);
  s = FL.st();
  check("an off-screen match: the page jumps, the match lands below the bar", s?.rect && s.rect.y >= 68 && s.rect.y < 860, s?.rect);
  await FL.inPage("function (w, d) { w.scrollBy(0, 1500); return w.scrollY; }");
  await sleep(400);
  spike.press("Shift+Enter");
  await FL.until(() => FL.st()?.ord === 2, "back to 2");
  await sleep(600);
  s = FL.st();
  check("stepping back up to a match above the view: it lands below the bar", s?.rect && s.rect.y >= 68, s?.rect);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed ribbon");

  // ---- a match on fixed content under the glass: the pill takes its parked tint ----
  await FL.load(FL.http("sticky.html"));
  await sleep(900);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open sticky");
  FL.type("pinned marker");
  await FL.counter("1 of 1");
  await sleep(700);
  check("match on fixed content under the bar: parked tint (vf-under), no scroll", FL.face().classList.contains("vf-under") && !b.root.classList.contains("find-focused"), FL.face().className);
  await capture("core-13-pinned");
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed sticky");

  // ---- anchor jumps and scrollIntoView land below the bar (inset's scroll-padding-top) ----
  const jump = await FL.inPage("function (w, d) { d.querySelector('a[href=\"#second\"]').click(); return true; }");
  await sleep(500);
  const anchor = await FL.inPage("function (w, d) { return { top: d.getElementById('second').getBoundingClientRect().top, pad: w.getComputedStyle(d.documentElement).scrollPaddingTop }; }");
  check("a #hash link lands its target just below the bar (top ~68)", jump && Math.abs(anchor.top - 68) <= 2, anchor);
  const siv = await FL.inPage("function (w, d) { d.getElementById('third').scrollIntoView(); return d.getElementById('third').getBoundingClientRect().top; }");
  check("scrollIntoView() lands below the bar too (top ~68)", Math.abs(siv - 68) <= 2, siv);

  // ---- colours pinned per document ----
  const colours = await b.page(b.active()).query("find:colours");
  check("the find selection colours are pinned in the page", colours === true, colours);
  const prefs = ["ui.textSelectAttentionBackground", "ui.textHighlightBackground"].map((p) => Services.prefs.getStringPref(p, ""));
  check("active match orange, others yellow", prefs[0] === "#ff9632" && prefs[1] === "#ffff00", prefs);

  // ---- the field menu (through the 'menus' service; a stand-in when the menus module is absent) ----
  let shown = null;
  // Whether the menus module is built in decides the branch (not the shape of its show(), which changes).
  const hadMenus = !!b.service("menus");
  if (!hadMenus) b.provide("menus", { show: (items, at) => (shown = { items, at }), close() {} });
  const realMenus = hadMenus ? "menus module" : "stand-in";
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open for menu");
  const inp = FL.input();
  const r = inp.getBoundingClientRect();
  if (realMenus === "stand-in") {
    inp.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.x + 20, clientY: r.y + 20 }));
    await sleep(100);
    const labels = (shown?.items ?? []).map((i) => i.label ?? (i.separator ? "-" : "?"));
    log("field menu", labels);
    check("field menu: editing rows and Match case", labels.join("|") === "Undo|Redo|-|Cut|Copy|Paste|Select all|-|Match case", labels);
    shown.items.find((i) => i.label === "Match case").run();
    await sleep(200);
    check("field menu: Match case toggles", FL.st()?.matchCase === true);
    spike.press("Alt+C");
  } else {
    // The real menus module: Shift+F10 in the field opens the glass field menu with Match case.
    spike.press("Shift+F10");
    await FL.until(() => window.vitreMenus?.state().open, "menu open", 2000);
    let ms = window.vitreMenus?.state();
    if (!ms?.open) {
      inp.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.x + 20, clientY: r.y + 20 }));
      await FL.until(() => window.vitreMenus?.state().open, "menu open 2", 2000);
      ms = window.vitreMenus?.state();
    }
    const labels = (ms?.rows ?? []).map((x) => x.label);
    log("field menu (menus module)", labels, ms?.source);
    check("field menu (menus module): editing rows and Match case, unchecked", ms?.open && labels.includes("Match case") && labels.includes("Paste") && ms.rows.find((x) => x.label === "Match case").checked === false, labels);
    await capture("core-14-field-menu");
    spike.press("Escape");
    await FL.until(() => !window.vitreMenus?.state().open, "menu closed", 2000);
    check("Esc closes the menu first, find stays open", FL.st()?.open && !window.vitreMenus?.state().open);
  }
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed menu");

  log("native findbar", FL.nativeFindbar());
  check("the native findbar was never created", !FL.nativeFindbar().initialized && FL.nativeFindbar().elements === 0, FL.nativeFindbar());
});
