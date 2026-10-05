// Find in page on awkward pages: a slow page (still loading), a hung page, Firefox's own pages, an
// error page, view-source, plain text, a page that changes under find (the match removed, a frame
// navigating, a reload), and a real PDF with embedded fonts. Run by tests/find-verify/all.py (pages).
/* global spike, FL, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(800);
  V.takeErrors();
  const closeFind = async () => {
    if (FL.st()?.open) FL.F().api().close();
    await FL.until(() => !FL.st()?.open, "closed", 3000);
    await sleep(500);
  };
  const tab = () => b.active();

  // ---- a slow page: the counter stays blank while loading with nothing found, then runs again ----
  b.navigate(tab(), V.http("slow?ms=5000&page=remove.html"));
  await FL.until(() => tab().loading, "slow loading", 3000);
  await sleep(800);
  b.run("find");
  await FL.until(() => FL.st()?.open, "open slow", 3000);
  await FL.query("Fourth");
  await sleep(700);
  let s = FL.st();
  log("slow page, query in the part not yet loaded", s, { loading: tab().loading, cls: FL.face().className });
  check("loading, nothing found yet: the counter is blank (not 'No matches')", tab().loading && s?.counter === "", s);
  check("loading: the face shows the load line", FL.face().classList.contains("vf-loading"), FL.face().className);
  await capture("pg-01-loading-blank");
  await FL.until(() => !tab().loading, "slow loaded", 10000);
  s = await FL.counter("1 of 1", 4000);
  check("loading done: find runs once more and finds the late text (1 of 1)", s?.counter === "1 of 1", s);
  await closeFind();

  // ---- a hung page: the field stays responsive, Esc closes, late answers are ignored ----
  await FL.load(V.http("hang.html"));
  await sleep(600);
  await FL.inPage("function (w) { w.wrappedJSObject.hang(6000); return true; }");
  await sleep(400);
  const t0 = Date.now();
  b.run("find");
  await FL.until(() => FL.st()?.open, "open hung", 3000);
  const openMs = Date.now() - t0;
  FL.input().focus();
  FL.type("glass");
  await sleep(500);
  s = FL.st();
  check("hung page: find opens at once and takes typing", s?.open && s.query === "glass" && openMs < 1000, { openMs, s });
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "esc hung", 2000);
  check("hung page: Esc closes find at once", !FL.st()?.open);
  await sleep(6500);
  s = FL.st();
  check("hung page: the late answers change nothing (closed, no face)", !s?.open && FL.face().hidden && V.residue().length === 0, { s, residue: V.residue() });
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "reopen hung", 3000);
  s = await FL.counter("1 of 3", 4000);
  check("hung page, after the hang: find works (1 of 3)", s?.counter === "1 of 3", s);
  await closeFind();
  // Ctrl+F from inside a hung page: page-first, so it waits for the page; F6 then Ctrl+F does not.
  await FL.inPage("function (w) { w.wrappedJSObject.hang(4000); return true; }");
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+F");
  await sleep(1000);
  const fromHung = !!FL.st()?.open;
  spike.press("F6");
  await sleep(200);
  spike.press("Ctrl+F");
  await sleep(500);
  log("Ctrl+F from a hung page", { fromHung, afterF6: !!FL.st()?.open });
  check("hung page: F6, then Ctrl+F opens find even while the page hangs", FL.st()?.open === true, FL.st());
  await sleep(4000);
  await closeFind();

  // ---- Firefox's own pages, an error page, view-source, plain text ----
  const cases = [
    ["about:license", "license", /^1 of \d+/],
    ["about:config", "browser", null],
    ["http://127.0.0.1:65530/", "connect", /^1 of \d+/],
    ["view-source:" + FL.http("article.html"), "glass", /^1 of \d+/],
    [V.http("plain.txt"), "glass", /^1 of 3$/],
  ];
  for (const [url, q, want] of cases) {
    b.navigate(tab(), url);
    await FL.until(() => !tab().loading && gBrowser.selectedBrowser.currentURI.spec !== "about:blank", "load " + url, 8000);
    await sleep(1200);
    b.focusPage();
    await sleep(150);
    b.run("find");
    const opened = await FL.until(() => FL.st()?.open, "open " + url, 3000);
    if (opened) {
      FL.input().focus();
      FL.type(q);
      s = await FL.settle(700, 5000);
    } else s = FL.st();
    log(url, s, { kind: tab().kind, omni: b.omni.open });
    if (want) check(`${url}: find counts '${q}'`, want.test(s?.counter ?? ""), s);
    else check(`${url}: find opens and does not break`, !!opened || b.omni.open, { s, omni: b.omni.open });
    if (url.startsWith("view-source")) await capture("pg-02-view-source");
    if (FL.st()?.open) spike.press("Escape");
    if (b.omni.open) b.omni.close();
    await closeFind();
  }

  // ---- a page that changes under find ----
  await FL.load(V.http("remove.html"));
  await sleep(1000);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open remove", 3000);
  await FL.query("glass");
  s = await FL.counter("1 of 6", 4000);
  check("changing page: 1 of 6 (4 here, 2 in the frame)", s?.counter === "1 of 6", s);
  spike.press("Enter");
  await FL.counter("2 of 6");
  await FL.inPage("function (w, d) { d.getElementById('b').remove(); return true; }");
  await sleep(300);
  spike.press("Enter");
  s = await FL.settle(700);
  check("the active match removed from the page: Enter still lands on a real match", /^\d of 5$/.test(s?.counter ?? ""), s);
  await FL.inPage("function (w, d) { d.getElementById('f').src = 'counter.html?moved'; return true; }");
  await sleep(1200);
  spike.press("Enter");
  s = await FL.settle(700);
  log("after the frame navigated", s);
  check("a frame navigated away: find keeps counting the page (N of 3 or more)", /^\d of [3-9]$/.test(s?.counter ?? ""), s);
  // Reload with find open: runs again; scrolling then still sends the ring away (the new document is armed).
  b.run("reload");
  await FL.until(() => tab().loading, "reloading", 3000);
  await FL.until(() => !tab().loading, "reloaded", 8000);
  await FL.settle(800);
  spike.press("Enter");
  await FL.until(() => FL.F().ring.visible, "ring after reload", 2000);
  await FL.inPage("function (w) { w.scrollBy(0, 30); return w.scrollY; }");
  await FL.until(() => !FL.F().ring.visible, "ring cancelled after reload", 1500);
  check("after a reload with find open, scrolling the page still sends the ring away", !FL.F().ring.visible);
  await closeFind();

  // ---- a real PDF with embedded fonts (network) ----
  await FL.load("https://arxiv.org/pdf/1706.03762");
  await FL.until(() => !tab().loading, "pdf", 20000);
  await sleep(3000);
  const spec = gBrowser.selectedBrowser.contentPrincipal?.spec ?? "";
  if (!spec.startsWith("resource://pdf.js")) {
    log("SKIP real PDF: not reachable or not shown in the viewer", gBrowser.selectedBrowser.currentURI.spec, spec);
  } else {
    b.focusPage();
    await sleep(200);
    b.run("find");
    await FL.until(() => FL.st()?.open, "open pdf", 3000);
    FL.input().focus();
    FL.type("attention");
    await FL.until(() => FL.st()?.total > 0, "pdf count", 10000);
    const early = FL.st()?.counter;
    s = await FL.settle(1200, 15000);
    log("real PDF", { early, s });
    check("real PDF: pdf.js counts the whole document ('1 of N', N > 50)", /^1 of \d+$/.test(s?.counter ?? "") && s.total > 50, s);
    spike.press("Enter");
    spike.press("Enter");
    s = await FL.settle(800, 5000);
    check("real PDF: Enter steps (3 of N)", /^3 of \d+$/.test(s?.counter ?? ""), s);
    await sleep(500);
    await capture("pg-03-real-pdf");
    await closeFind();
  }

  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
