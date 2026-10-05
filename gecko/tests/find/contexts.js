// Find in page in its contexts (see tests/find/all.py): a dark page, the bar hidden, a PDF (pdf.js
// through the findbar stand-in), a long Wikipedia article, the scroll guard with the inset off,
// IME composition, reload and navigation, and the 'find' service.
/* global spike, FL, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/flib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  const Settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  await spike.resize(1280, 860);
  await spike.activate();

  async function openFind(text) {
    b.focusPage();
    await sleep(150);
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open, "open");
    if (text !== undefined) {
      await FL.query(text);
      await FL.settle(500);
    }
    return FL.st();
  }
  async function closeFind() {
    spike.press("Escape");
    await FL.until(() => !FL.st()?.open, "closed");
    await sleep(350);
  }

  // ---- a dark page: dark glass ----
  await FL.load(FL.http("dark.html"));
  await sleep(1200);
  let s = await openFind("float");
  log("dark", s, b.root.className);
  check("dark page: the glass is dark", b.root.classList.contains("theme-dark"), b.root.className);
  check("dark page: 'float' found", /^1 of \d+$/.test(s?.counter ?? ""), s);
  await sleep(500);
  await capture("ctx-01-dark-results");
  await FL.query("floatzz");
  s = await FL.counter("No matches");
  const none = getComputedStyle(FL.face().querySelector(".vf-count")).color;
  check("dark page: 'No matches' in #ff99a4", none === "rgb(255, 153, 164)", none);
  await capture("ctx-02-dark-none");
  spike.press("F6");
  await sleep(300);
  await capture("ctx-03-dark-parked");
  spike.press("F6");
  await sleep(200);
  await FL.query("float");
  await FL.settle(400);
  spike.press("Enter");
  await FL.until(() => FL.F().ring.visible, "dark ring", 1500);
  await sleep(150);
  FL.F().ring.freeze();
  const edge = document.querySelector("#layer-find-ring .vf-ring-edge");
  const ec = edge && getComputedStyle(edge);
  check("dark page: the ring is #4cc2ff with a dark hairline", ec && ec.borderTopColor === "rgb(76, 194, 255)" && /rgba\(0, 0, 0, 0.35\)/.test(ec.boxShadow), ec && [ec.borderTopColor, ec.boxShadow]);
  await capture("ctx-03b-dark-ring");
  FL.F().ring.cancel();
  // Same-document navigation keeps find open.
  await FL.inPage("function (w, d) { w.location.hash = '#later'; return w.location.href; }");
  await sleep(400);
  check("a same-document navigation keeps find open", FL.st()?.open, FL.st());
  await closeFind();

  // ---- IME: no search while composing, the counter dims ----
  await openFind("");
  spike.EU.synthesizeCompositionChange({ composition: { string: "flo", clauses: [{ length: 3, attr: spike.EU._EU_Ci.nsITextInputProcessor.ATTR_RAW_CLAUSE }] }, caret: { start: 3, length: 0 } }, window);
  await sleep(300);
  s = FL.st();
  check("IME: composing does not search, the face dims its counter", FL.face().classList.contains("vf-ime") && !s.searched, { cls: FL.face().className, s });
  await capture("ctx-04-ime");
  spike.EU.synthesizeComposition({ type: "compositioncommitasis" }, window);
  s = await FL.settle(500);
  check("IME: the committed text is searched", s?.query === "flo" && s.searched && !FL.face().classList.contains("vf-ime"), s);
  await closeFind();

  // ---- the bar hidden (auto-hide): only the pill drops in, with its own glass ----
  await FL.load(FL.http("article.html"));
  await sleep(1200);
  Settings.set({ barAutoHide: true });
  await FL.until(() => b.bar.hidden, "bar hidden", 4000);
  check("auto-hide: the bar is hidden", b.bar.hidden);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open hidden");
  await sleep(120);
  await capture("ctx-05-hidden-dropping");
  await sleep(400);
  s = FL.st();
  const own = FL.face().classList.contains("vf-own") && b.root.classList.contains("find-own");
  const faceR = FL.rectOf(FL.face());
  check("bar hidden: the face brings its own glass and sits at the pill's slot", own && faceR.y === 12 && faceR.x === Math.round(b.bar.layout.pillRect.x), { own, faceR, slot: b.bar.layout.pillRect && b.bar.layout.pillRect.x });
  check("bar hidden: the rest of the bar stays hidden", b.bar.hidden);
  FL.type("glass");
  await FL.counter("1 of 13");
  await sleep(300);
  await capture("ctx-06-hidden-find");
  spike.press("Escape");
  await sleep(300);
  check("bar hidden, closing: the address face shows for a moment", FL.F().face.mode !== "hidden" && !FL.face().hidden && !FL.face().classList.contains("vf-find"));
  await capture("ctx-07-hidden-closing");
  await sleep(1200);
  check("bar hidden, closed: the face has risen away", FL.face().hidden);
  Settings.set({ barAutoHide: false });
  await FL.until(() => !b.bar.hidden, "bar back", 3000);
  await sleep(500);

  // ---- the scroll guard with the inset off (no scroll padding): the match goes to y 92 ----
  Settings.set({ pageInset: false });
  await sleep(300);
  await FL.load(FL.http("long.html"));
  await sleep(1200);
  s = await openFind("ribbon");
  await FL.counter("1 of 60");
  const pad = await FL.inPage("function (w, d) { return w.getComputedStyle(d.documentElement).scrollPaddingTop; }");
  check("inset off: no scroll padding", pad === "auto" || pad === "0px", pad);
  await FL.inPage("function (w, d) { const p = d.getElementById('p20'); w.scrollTo(0, p.getBoundingClientRect().top + w.scrollY - 22); return w.scrollY; }");
  await sleep(500);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 2, "ord 2");
  await FL.until(() => FL.F().ring.visible, "ring", 1500);
  await sleep(120);
  FL.F().ring.freeze();
  s = FL.st();
  log("guard with the inset off", s.rect);
  check("inset off: a match under the glass is scrolled to y 92 by the guard", s?.rect && Math.abs(s.rect.y - 92) <= 2, s?.rect);
  await capture("ctx-08-guard-92");
  FL.F().ring.cancel();
  await closeFind();
  Settings.set({ pageInset: true });
  await sleep(300);

  // ---- reload keeps the query and runs it again; another document closes find ----
  await FL.load(FL.http("article.html"));
  await sleep(1200);
  s = await openFind("glass");
  await FL.counter("1 of 13");
  b.run("reload");
  await sleep(300);
  await FL.until(() => !b.active().loading, "reloaded", 8000);
  s = await FL.counter("1 of 13", 4000);
  check("reload: find stays open and runs again", s?.open && s.counter === "1 of 13", s);
  await FL.load(FL.http("counter.html"));
  await sleep(500);
  s = FL.st();
  check("another document: find closes and keeps the query", !s?.open && s?.query === "glass" && FL.face().hidden, s);

  // ---- the 'find' service ----
  await FL.load(FL.http("article.html"));
  await sleep(1200);
  const api = b.service("find");
  api.open({ query: "Coated" });
  await FL.until(() => FL.st()?.open, "api open");
  s = await FL.counter("1 of 1");
  check("find service: open({ query }) seeds the field and searches", s?.query === "Coated" && s.counter === "1 of 1" && api.isOpen(), s);
  api.close();
  await FL.until(() => !FL.st()?.open, "api closed");
  check("find service: close()", !api.isOpen());
  await sleep(400);

  // ---- a PDF: pdf.js searches the whole document through the stand-in ----
  await FL.load(FL.file("test-long.pdf"));
  await FL.until(() => gBrowser.selectedBrowser.currentURI.spec.endsWith(".pdf") && !b.active().loading, "pdf", 10000);
  await sleep(2500);
  const pdfState = await b.page(b.active()).query("pdf:state");
  log("pdf state", pdfState);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+F");
  const opened = await FL.until(() => FL.st()?.open, "open pdf", 3000);
  if (!opened) {
    log("Ctrl+F in the viewer did not reach Vitre; opening through the action");
    b.run("find");
    await FL.until(() => FL.st()?.open, "open pdf 2");
  }
  FL.type("glass");
  await FL.until(() => FL.st()?.total > 0, "pdf count", 8000);
  await sleep(150);
  const climbing = FL.st()?.counter;
  await capture("ctx-09-pdf-counting");
  s = await FL.counter("1 of 40", 8000);
  log("pdf", { climbing, s });
  check("PDF: pdf.js counts the whole document, 1 of 40", s?.counter === "1 of 40" && s.pdf, s);
  // The glass follows the viewer's toolbar under the bar (Firefox 157's pdf.js is light here).
  log("PDF: glass over the viewer", b.root.className);
  spike.press("Enter");
  spike.press("Enter");
  s = await FL.counter("3 of 40", 4000);
  check("PDF: Enter steps (3 of 40)", s?.counter === "3 of 40", s);
  await sleep(600);
  await capture("ctx-10-pdf-results");
  spike.press("Alt+C");
  await FL.query("Glass");
  await FL.settle(800);
  log("pdf match case 'Glass'", FL.st());
  spike.press("Alt+C");
  await FL.query("glasszz");
  s = await FL.counter("No matches", 4000);
  check("PDF: no matches", s?.counter === "No matches", s);
  await closeFind();
  check("PDF: the native findbar was never created", !FL.nativeFindbar().initialized && FL.nativeFindbar().elements === 0, FL.nativeFindbar());

  // ---- a narrow window: the pill under 400 px, Aa moves into the field menu ----
  await FL.load(FL.http("article.html"));
  await sleep(1000);
  await spike.resize(700, 700);
  await sleep(800);
  s = await openFind("glass");
  await FL.counter("1 of 13");
  await sleep(400);
  const narrowFace = FL.rectOf(FL.face());
  check("narrow window: the face follows the narrower pill and hides Aa", narrowFace.w < 400 && FL.face().classList.contains("vf-narrow") && getComputedStyle(FL.face().querySelector(".vf-case")).display === "none", { narrowFace, pill: b.bar.layout.pillRect && b.bar.layout.pillRect.width });
  await capture("ctx-12-narrow");
  await closeFind();
  await spike.resize(1280, 860);
  await sleep(800);

  // ---- tooltips: plain text with a dim key ----
  s = await openFind("glass");
  const next = FL.face().querySelector(".vf-next");
  const nr = next.getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(nr.x + nr.width / 2, nr.y + nr.height / 2, { type: "mousemove" }, window);
  await FL.until(() => b.bar.tips.shownFor === next, "tip", 2000);
  const tip = document.querySelector("#layer-tips .vitre-tip");
  check("the next button's tooltip reads 'Next match' with the key 'Enter'", b.bar.tips.shownFor === next && tip?.textContent === "Next matchEnter", tip?.textContent);
  await sleep(200);
  await capture("ctx-13-tooltip");
  spike.EU.synthesizeMouseAtPoint(640, 500, { type: "mousemove" }, window);
  await closeFind();

  // ---- a long real article (network) ----
  await FL.load("https://en.wikipedia.org/wiki/Float_glass");
  await sleep(2000);
  if (!gBrowser.selectedBrowser.currentURI.spec.includes("wikipedia")) {
    log("SKIP Wikipedia: not reachable", gBrowser.selectedBrowser.currentURI.spec);
  } else {
    s = await openFind("glass");
    s = await FL.settle(800, 8000);
    log("wikipedia", s);
    check("Wikipedia: a real count for 'glass'", /^1 of \d{2,3}$/.test(s?.counter ?? ""), s);
    let plus = 0;
    for (let burst = 0; burst < 3; burst++) {
      for (let i = 0; i < 5; i++) spike.press("Enter");
      s = await FL.settle(600);
      if (/\+$/.test(s?.counter ?? "")) plus++;
    }
    check("Wikipedia: bursts of Enter end on a real count (no stuck N+)", plus === 0 && /^\d+ of \d+$/.test(s?.counter ?? ""), s);
    spike.press("Enter");
    await FL.until(() => FL.F().ring.visible, "ring", 1500);
    await sleep(120);
    FL.F().ring.freeze();
    s = FL.st();
    check("Wikipedia: the match lands below the bar, ring on it", s?.rect && s.rect.y >= 68 && FL.F().ring.visible, s?.rect);
    await capture("ctx-11-wikipedia");
    FL.F().ring.cancel();
    await closeFind();
  }
  check("the native findbar was never created", !FL.nativeFindbar().initialized && FL.nativeFindbar().elements === 0, FL.nativeFindbar());
});
