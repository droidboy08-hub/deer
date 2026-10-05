// Find in page, attacked from the keyboard: the Esc and close ladders, keyboard-only use of the
// face's buttons, rapid repeated input, the address field, a page that keeps Ctrl+F, a page
// dialog, F11 and element full screen, a tab-switch storm, window resizes, closing the tab, and
// misuse of the 'find' service. Run by tests/find-verify/all.py (ladder).
/* global spike, FL, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  const settledClosed = async () => {
    await FL.until(() => !FL.st()?.open, "closed", 3000);
    await sleep(700);
  };
  const open = async (text) => {
    b.focusPage();
    await sleep(150);
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open && FL.st()?.focused, "open", 3000);
    if (text !== undefined) {
      await FL.query(text);
      await FL.settle(400);
    }
    return FL.st();
  };

  await FL.load(FL.http("article.html"));
  await sleep(1000);
  V.takeErrors();

  // ---- keyboard only: Tab to the buttons, use them, Esc from a button ----
  let s = await open("glass");
  await FL.counter("1 of 13");
  spike.press("Tab");
  spike.press("Tab");
  await sleep(60);
  check("Tab, Tab: the next button has focus, the face keeps its focused tint", document.activeElement === FL.face().querySelector(".vf-next") && b.root.classList.contains("find-focused"), document.activeElement?.className);
  spike.press("Enter");
  s = await FL.counter("2 of 13");
  check("Enter on the focused next button steps (2 of 13)", s?.counter === "2 of 13", s);
  spike.press(" ");
  s = await FL.counter("3 of 13");
  check("Space on the focused next button steps (3 of 13)", s?.counter === "3 of 13", s);
  spike.press("Tab");
  await sleep(60);
  spike.press(" ");
  await FL.until(() => FL.st()?.matchCase, "case", 2000);
  check("Space on the focused Aa toggles match case", FL.st()?.matchCase === true, FL.st());
  spike.press("Alt+C");
  await sleep(300);
  check("Alt+C with focus on a face button (not the field) toggles match case too", FL.st()?.matchCase === false, FL.st());
  if (FL.st()?.matchCase) {
    FL.face().querySelector(".vf-case").click();
    await sleep(300);
  }
  spike.press("Tab");
  await sleep(60);
  check("Tab reaches ×", document.activeElement?.getAttribute("aria-label") === "Close find", document.activeElement?.getAttribute("aria-label"));
  spike.press("Escape");
  await settledClosed();
  let page = await FL.pageState();
  check("Esc with focus on × closes find; the page gets focus and the match stays selected", !FL.st()?.open && document.activeElement === gBrowser.selectedBrowser && page.sel.toLowerCase() === "glass", { st: FL.st(), page, active: document.activeElement?.localName });
  check("after close: no find classes left, the pill's face is back", V.residue().length === 0 && V.pillFaceVisible(), V.residue());

  // ---- Esc from the Aa button, and Enter / Space on × ----
  await open("glass");
  spike.press("Tab");
  spike.press("Tab");
  spike.press("Tab");
  spike.press("Tab");
  await sleep(60);
  spike.press("Enter");
  await settledClosed();
  check("Enter on the focused × closes find", !FL.st()?.open && V.residue().length === 0);

  // ---- rapid open / close toggling ----
  b.focusPage();
  await sleep(200);
  for (let i = 0; i < 7; i++) {
    spike.press("Ctrl+F");
    await sleep(i % 2 ? 10 : 40);
    spike.press("Escape");
    await sleep(15);
  }
  await sleep(900);
  check("7 quick Ctrl+F / Esc pairs: closed, nothing left behind", !FL.st()?.open && V.residue().length === 0 && V.pillFaceVisible(), { st: FL.st(), residue: V.residue(), mode: FL.F().face.mode });
  for (let i = 0; i < 5; i++) {
    spike.press("Ctrl+F");
    await sleep(20);
    spike.press("Escape");
    await sleep(20);
  }
  spike.press("Ctrl+F");
  await sleep(900);
  s = FL.st();
  const faceR = FL.rectOf(FL.face());
  const pill = b.bar.layout.pillRect;
  check("... and one more Ctrl+F: open, focused, face on the pill, pill face hidden", s?.open && s.focused && FL.F().face.mode === "open" && faceR.x === Math.round(pill.x) && !V.pillFaceVisible() && b.root.classList.contains("find-face"), { s, faceR, pill: pill && [pill.x, pill.width], cls: FL.face().className });
  await capture("lad-01-after-toggle-storm");

  // ---- typing and Enter at once, then wiping the field ----
  await FL.query("");
  FL.type("glass");
  spike.press("Enter");
  s = await FL.settle(600);
  page = await FL.pageState();
  check("typing then Enter at once lands on a real match, the one the page shows", /^\d+ of 13$/.test(s?.counter ?? "") && page.sel.toLowerCase() === "glass", { s, page });
  const ranges1 = await V.findRanges();
  for (let i = 0; i < 5; i++) spike.press("Backspace");
  s = await FL.settle(500);
  const ranges0 = await V.findRanges();
  check("emptying the field fast: blank counter, highlights gone", s?.counter === "" && ranges0 === 0 && ranges1 > 0, { s, ranges1, ranges0 });

  // ---- holding Enter (key repeat): no ring while repeating, a real count after ----
  FL.type("glass");
  await FL.counter("1 of 13");
  await sleep(900);
  FL.F().ring.cancel();
  let ringDuringRepeat = 0;
  const ringObs = new MutationObserver(() => {
    if (FL.F().ring.visible) ringDuringRepeat++;
  });
  ringObs.observe(document.getElementById("layer-find-ring"), { childList: true, subtree: true });
  spike.press("Enter");
  for (let i = 0; i < 14; i++) {
    spike.press("Enter", { repeat: true });
    await sleep(33);
  }
  ringObs.disconnect();
  s = await FL.settle(600);
  log("after holding Enter", s, "ring shows during repeat", ringDuringRepeat);
  check("holding Enter: a real count at the end", /^\d+ of 13$/.test(s?.counter ?? ""), s);
  check("holding Enter: the ring stays away during key repeat (at most the first press)", ringDuringRepeat <= 1, ringDuringRepeat);

  // ---- Ctrl+F while the address field is open ----
  spike.press("Escape");
  await settledClosed();
  b.focusPage();
  spike.press("Ctrl+L");
  await FL.until(() => b.omni.open, "omni", 2000);
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "find from omni", 2000);
  await sleep(400);
  s = FL.st();
  check("Ctrl+F in the address field: the field closes and find opens, focused", !b.omni.open && s?.open && s.focused, { omni: b.omni.open, s });
  spike.press("Escape");
  await settledClosed();

  // ---- a page that keeps Ctrl+F: F6 then Ctrl+F reaches Vitre ----
  await FL.load(V.http("keeps.html"));
  await sleep(800);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+F");
  await sleep(600);
  let own = await FL.inPage("function (w) { return w.wrappedJSObject.ownSearch; }");
  check("a page that keeps Ctrl+F gets it; Vitre's find stays closed", own === 1 && !FL.st()?.open, { own, st: FL.st() });
  b.focusPage();
  await sleep(200);
  spike.press("F6");
  await sleep(300);
  log("after F6 from the page", { omniFocused: b.omni.focused, omniOpen: b.omni.open, active: document.activeElement?.id || document.activeElement?.localName });
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "find after F6", 2000);
  await sleep(300);
  s = FL.st();
  own = await FL.inPage("function (w) { return w.wrappedJSObject.ownSearch; }");
  check("F6, then Ctrl+F: Vitre's find opens, focused; the page did not get this Ctrl+F", s?.open && s.focused && own === 1 && !b.omni.open, { s, own, omni: b.omni.open });
  FL.type("glass");
  s = await FL.settle(500);
  check("... and searches the page (the 2 visible matches; the closed dialog's is not one)", /^\d of 2$/.test(s?.counter ?? ""), s);
  spike.press("Escape");
  await settledClosed();

  // ---- a page dialog takes Esc before parked find ----
  await FL.load(V.http("dialog.html"));
  await sleep(800);
  await open("glass");
  spike.press("F6");
  await sleep(250);
  check("parked", FL.st()?.open && !FL.st().focused);
  await FL.inPage("function (w, d) { d.getElementById('dlg').showModal(); return true; }");
  await sleep(300);
  b.focusPage();
  await sleep(200);
  spike.press("Escape");
  await sleep(500);
  let dlg = await FL.inPage("function (w, d) { return { open: d.getElementById('dlg').open, esc: w.wrappedJSObject.dialogEsc }; }");
  check("Esc with a page dialog open: the dialog closes, parked find stays", !dlg.open && FL.st()?.open, { dlg, st: FL.st() });
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "parked closed", 2000);
  check("the next Esc closes parked find", !FL.st()?.open);
  await settledClosed();

  // ---- F11 (window full screen) with find open ----
  await FL.load(FL.http("article.html"));
  await sleep(800);
  await open("glass");
  await FL.counter("1 of 13");
  b.run("fullscreen");
  await FL.until(() => window.fullScreen, "fullscreen", 4000);
  await sleep(1500);
  s = FL.st();
  let fr = FL.rectOf(FL.face());
  log("F11 with find open", { s, fr, cls: FL.face().className, root: b.root.className, barHidden: b.bar.hidden });
  check("F11 with find open: find stays open, the face keeps its slot with its own glass", s?.open && !FL.face().hidden && FL.face().classList.contains("vf-own") && fr.y === 12, { fr, cls: FL.face().className });
  await capture("lad-02-f11-find");
  spike.press("Enter");
  s = await FL.counter("2 of 13");
  check("F11: Enter still steps", s?.counter === "2 of 13", s);
  b.run("fullscreen");
  await FL.until(() => !window.fullScreen, "left fullscreen", 4000);
  await sleep(1200);
  fr = FL.rectOf(FL.face());
  const pill2 = b.bar.layout.pillRect;
  check("after F11: the face is back on the pill without its own glass", !FL.face().classList.contains("vf-own") && !b.root.classList.contains("find-own") && fr.x === Math.round(pill2.x) && fr.w === Math.round(pill2.width) && !V.pillFaceVisible(), { fr, pill: pill2 && [pill2.x, pill2.width], cls: FL.face().className });
  await capture("lad-03-after-f11");
  spike.press("Escape");
  await settledClosed();

  // ---- element full screen: the face leaves with the bar, Ctrl+F goes to the page ----
  await FL.load(V.http("fullscreen.html"));
  await sleep(800);
  await open("glass");
  await FL.counter("1 of 4");
  spike.press("F6");
  await sleep(200);
  const go = await FL.inPage("function (w, d) { const r = d.getElementById('go').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }");
  const bb = gBrowser.selectedBrowser.getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(bb.x + go.x, bb.y + go.y, {}, window);
  const fsIn = await FL.until(() => b.root.classList.contains("element-fullscreen"), "element fullscreen", 5000);
  await sleep(1200);
  const faceVisible = !FL.face().hidden && getComputedStyle(FL.face()).visibility !== "hidden" && FL.face().getBoundingClientRect().bottom > 0;
  log("element full screen", { fsIn: !!fsIn, faceVisible, cls: FL.face().className, root: b.root.className });
  check("element full screen with find open: the find face does not cover the full-screen element", !!fsIn && !faceVisible, { faceVisible, cls: FL.face().className });
  await capture("lad-04-element-fullscreen");
  const before = await FL.inPage("function (w) { return w.wrappedJSObject.pageCtrlF; }");
  b.focusPage();
  await sleep(150);
  spike.press("Ctrl+F");
  await sleep(500);
  const after = await FL.inPage("function (w) { return w.wrappedJSObject.pageCtrlF; }");
  check("element full screen: Ctrl+F goes to the page, the face does not come up", after === before + 1 && !(!FL.face().hidden && FL.face().getBoundingClientRect().bottom > 0 && getComputedStyle(FL.face()).visibility !== "hidden"), { before, after });
  await FL.inPage("function (w, d) { d.exitFullscreen(); return true; }");
  await FL.until(() => !b.root.classList.contains("element-fullscreen"), "left element fs", 5000);
  await sleep(1000);
  s = FL.st();
  check("after element full screen: find is still open (parked), its face back on the pill", s?.open && !FL.face().hidden && !V.pillFaceVisible(), { s, cls: FL.face().className });
  await capture("lad-05-after-element-fullscreen");
  FL.F().api().close();
  await settledClosed();

  // ---- tab-switch storm ----
  await FL.load(FL.http("article.html"));
  await sleep(800);
  const tabA = b.active();
  await open("glass");
  await FL.counter("1 of 13");
  const tabB = b.newTab(FL.http("dark.html"));
  await sleep(1200);
  await open("float");
  await FL.settle(400);
  const tabC = b.newTab(FL.http("counter.html"));
  await sleep(1000);
  const order = [tabA, tabB, tabC, tabB, tabA, tabC, tabA, tabB, tabA, tabB, tabC, tabA];
  for (const t of order) {
    b.activate(t);
    await sleep(25);
  }
  await sleep(900);
  s = FL.st();
  fr = FL.rectOf(FL.face());
  const pill3 = b.bar.layout.pillRect;
  check("tab storm ending on A: A's find shows, parked, on A's pill", b.active() === tabA && s?.open && s.query === "glass" && !FL.face().hidden && fr.x === Math.round(pill3.x) && fr.w === Math.round(pill3.width) && FL.F().face.browser === tabA.browser, { s, fr, pill: pill3 && [pill3.x, pill3.width] });
  b.activate(tabC);
  await sleep(600);
  check("on C (no find): no face, the pill's own face shows", FL.face().hidden && V.residue().length === 0 && V.pillFaceVisible(), V.residue());
  b.activate(tabB);
  await sleep(600);
  s = FL.st();
  check("on B: B's find, with B's query", s?.open && s.query === "float" && !FL.face().hidden && FL.F().face.browser === tabB.browser, s);

  // ---- window resizes while find is open ----
  for (const [w, h] of [[900, 700], [1440, 900], [1280, 860]]) {
    await spike.resize(w, h);
    await sleep(800);
    fr = FL.rectOf(FL.face());
    const p = b.bar.layout.pillRect;
    check(`resize to ${w}x${h}: the face stays on the pill`, fr.x === Math.round(p.x) && fr.w === Math.round(p.width) && fr.y === 12, { fr, pill: p && [p.x, p.width] });
  }

  // ---- closing the tab with find open (Ctrl+W in the field) ----
  b.activate(tabB);
  await sleep(300);
  FL.input().focus();
  await sleep(100);
  spike.press("Ctrl+W");
  await FL.until(() => !b.tabs.includes(tabB), "B closed", 3000);
  await sleep(700);
  check("Ctrl+W in the field closes the tab; the next tab shows its own state", !b.tabs.includes(tabB) && (FL.st()?.open ? FL.F().face.browser === b.active().browser : FL.face().hidden), { active: b.active().url, st: FL.st() });
  b.closeTab(tabC);
  b.activate(tabA);
  await sleep(600);

  // ---- the 'find' service, misused ----
  const api = b.service("find");
  api.close();
  api.close();
  await sleep(400);
  check("service: close() twice is harmless", !api.isOpen());
  api.open({ query: "x".repeat(500) });
  await FL.until(() => api.isOpen(), "api long", 2000);
  await sleep(300);
  check("service: a 500-character query is cut to 120", FL.st()?.query.length === 120, FL.st()?.query.length);
  api.open({ query: "  glass \n\t counter  " });
  await sleep(500);
  check("service: whitespace and newlines collapse to one line", FL.st()?.query === "glass counter", FL.st()?.query);
  const other = b.newTab(FL.http("counter.html"), { background: true });
  await sleep(600);
  api.open({ browser: other.browser, query: "counter" });
  await sleep(300);
  check("service: open({ browser }) for a background tab does nothing", FL.st()?.query === "glass counter" && !FL.F().inspect(other.browser)?.open, FL.F().inspect(other.browser));
  api.open({ query: 42 });
  await sleep(200);
  check("service: a non-string query is ignored (plain Ctrl+F)", api.isOpen());
  b.closeTab(other);
  api.close();
  await settledClosed();

  // ---- the scroll guard with the inset on (the default): a match under the glass goes to y 92 ----
  await FL.load(FL.http("long.html"));
  await sleep(1000);
  const padOf = () => FL.inPage("function (w, d) { return w.getComputedStyle(d.documentElement).scrollPaddingTop; }");
  const padBefore = await padOf();
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open guard", 3000);
  await FL.query("ribbon");
  await FL.counter("1 of 60");
  const padOpen = await padOf();
  check("inset on: the page's scroll padding is the inset's (68px), and 0 while find is open", padBefore === "68px" && padOpen === "0px", { padBefore, padOpen });
  await FL.inPage("function (w, d) { const p = d.getElementById('p20'); w.scrollTo(0, p.getBoundingClientRect().top + w.scrollY - 22); return w.scrollY; }");
  await sleep(500);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 2, "ord 2", 3000);
  await FL.until(() => FL.F().ring.visible, "ring", 1500);
  await sleep(120);
  FL.F().ring.freeze();
  s = FL.st();
  const selR = await V.selectionRect();
  check("inset on: a match under the glass is lifted to y 92 by the guard (not centred), the ring on it", s?.rect && Math.abs(s.rect.y - 92) <= 2 && selR && Math.abs(selR.y - 92) <= 2 && Math.abs(FL.F().ring.last.y - selR.y) <= 1, { rect: s?.rect, selR });
  await capture("lad-06-guard-inset-on");
  FL.F().ring.cancel();
  // An off-screen match is still centred by Gecko.
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 3, "ord 3", 3000);
  await sleep(500);
  s = FL.st();
  check("inset on: an off-screen match is centred (below the bar)", s?.rect && s.rect.y > 300 && s.rect.y < 600, s?.rect);
  // Page Down from the field: most of a view, less the bar.
  const sy0 = (await FL.pageState()).scrollY;
  FL.input().focus();
  spike.press("PageDown");
  await sleep(800);
  const sy1 = (await FL.pageState()).scrollY;
  const inner = await FL.inPage("function (w) { return w.innerHeight; }");
  check("Page Down in the field scrolls 87.5 % of the view below the bar", Math.abs(sy1 - sy0 - Math.round((inner - 68) * 0.875)) <= 2, { delta: sy1 - sy0, want: Math.round((inner - 68) * 0.875) });
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed guard", 3000);
  await sleep(300);
  const padAfter = await padOf();
  check("after find closes the inset's scroll padding is back (68px)", padAfter === "68px", padAfter);

  // ---- the guard for a match inside a frame (cross-site: another process; same-site: the same) ----
  for (const [page, frameId, label] of [[FL.http("article.html"), "xframe", "cross-site"], [V.http("remove.html"), "f", "same-site"]]) {
    await FL.load(page);
    await sleep(1000);
    // The frame's first line just under the glass (window y ~24).
    const top = await FL.inPage(`function (w, d) { const f = d.getElementById(${JSON.stringify(frameId)}); w.scrollTo(0, f.getBoundingClientRect().top + w.scrollY + 12 - 24); return f.getBoundingClientRect().top; }`);
    await sleep(400);
    b.service("find").open({ query: "one more glass" });
    await FL.until(() => FL.st()?.open && FL.st()?.counter === "1 of 1", "frame match " + label, 4000);
    await FL.until(() => FL.F().ring.visible, "ring " + label, 2500);
    await sleep(120);
    FL.F().ring.freeze();
    s = FL.st();
    log(`frame match (${label})`, { frameTopBefore: top, rect: s?.rect, foundTop: s?.foundTop });
    check(`a match inside a ${label} frame under the glass is lifted to y 92 too, the ring on it`, s?.rect && !s.foundTop && Math.abs(s.rect.y - 92) <= 2 && Math.abs(FL.F().ring.last.y - s.rect.y) <= 1, s?.rect);
    await capture(`lad-07-guard-frame-${label}`);
    FL.F().ring.cancel();
    FL.F().api().close();
    await FL.until(() => !FL.st()?.open, "closed frame " + label, 3000);
    await sleep(300);
  }

  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
