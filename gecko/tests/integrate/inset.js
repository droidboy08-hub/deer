// The page top strip follows the bar's hiding mode (src/window/pagearea.ts, src/actors/page/inset.ts
// "Hidden bar"): with auto-hide on or in F11 full screen the bar keeps no band, so pages start at the
// top of the window (no empty band); a reveal of the hidden bar does not bring the strip back (the bar
// slides in over the page); leaving the mode brings it back with the content kept in place. The PDF
// viewer's offset follows the same rule. F11 is per window; auto-hide is every window's.
// Captures: inset-1-shown, inset-2-autohide-hidden, inset-3-autohide-revealed, inset-4-back,
// inset-5-f11, inset-6-pdf-hidden, inset-7-pdf-shown.
/* global spike, Services, I, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  const near = (a, x, d = 1.5) => Math.abs(a - x) <= d;
  const settings = b.sys("VitreSettings");
  await spike.resize(1280, 800);
  await spike.activate();
  // The pointer rests in the middle of the page (a reveal needs it at the top).
  const away = () => I.mouse(640, 420, { type: "mousemove" });
  const top = () => I.mouse(640, 4, { type: "mousemove" });
  away();

  const t = await I.load(I.page("long.html"), 900);
  const st0 = await I.inset(t.browser, "#first");
  log("shown", st0);
  check("bar shown: the strip is on, the page's first line starts at 68 under the bar", st0.applied && !st0.barHidden && near(st0.rect.top, 68), { applied: st0.applied, top: st0.rect?.top });
  await capture("inset-1-shown");

  // ---- auto-hide on: no band ----
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hiding, { what: "hiding mode" });
  away();
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "bar hidden" });
  await waitFor(async () => !(await I.inset(t.browser)).applied, { timeout: 4000, what: "strip gone" }).catch(() => null);
  await sleep(400);
  const st1 = await I.inset(t.browser, "#first");
  log("auto-hide hidden", st1);
  check("auto-hide, bar hidden: the strip goes, the page starts at the top of the window (no empty band)", !st1.applied && st1.barHidden && near(st1.rect.top, 0) && st1.padding === "0px", { applied: st1.applied, barHidden: st1.barHidden, top: st1.rect?.top, padding: st1.padding });
  await capture("inset-2-autohide-hidden");

  // ---- a reveal keeps it: the bar slides in over the page ----
  top();
  await waitFor(() => !b.bar.hidden, { timeout: 3000, what: "bar revealed" });
  await sleep(600);
  const st2 = await I.inset(t.browser, "#first");
  check("auto-hide, bar revealed by the pointer: the strip stays off, nothing reflows (the bar floats over the page)", b.bar.hiding && !b.bar.hidden && !st2.applied && near(st2.rect.top, 0), { hiding: b.bar.hiding, hidden: b.bar.hidden, applied: st2.applied, top: st2.rect?.top });
  await capture("inset-3-autohide-revealed");
  // A hold (a module keeping the bar on screen) is a reveal too.
  away();
  const release = b.bar.hold("integration-test");
  await sleep(500);
  const st2b = await I.inset(t.browser);
  release();
  check("a hold of the hidden bar does not bring the strip back", !st2b.applied, st2b.applied);
  away();
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "bar hidden again" }).catch(() => null);

  // ---- scrolled page: leaving the mode brings the strip back, the content stays in place ----
  await I.inContent(t.browser, (content) => content.scrollTo(0, 600));
  await sleep(300);
  const before = await I.inset(t.browser, "#p30");
  settings.set({ barAutoHide: false });
  await waitFor(async () => (await I.inset(t.browser)).applied, { timeout: 4000, what: "strip back" }).catch(() => null);
  await sleep(400);
  const after = await I.inset(t.browser, "#p30");
  check("auto-hide off: the strip comes back; a scrolled page keeps its content in place (scrollY +68)", after.applied && !after.barHidden && near(after.scrollY, before.scrollY + 68, 2) && near(after.rect.top, before.rect.top, 2), { before: [before.scrollY, before.rect?.top], after: [after.scrollY, after.rect?.top] });
  await I.inContent(t.browser, (content) => content.scrollTo(0, 0));
  await sleep(300);
  const st3 = await I.inset(t.browser, "#first");
  check("at the top again: the first line at 68, under the bar", near(st3.rect.top, 68), st3.rect);
  await capture("inset-4-back");

  // ---- a second window follows the global auto-hide; F11 is per window ----
  const win2 = await spike.openWindow();
  await sleep(500);
  const t2 = win2.vitre.active();
  win2.vitre.navigate(t2, I.page("long.html"));
  await waitFor(() => t2.url === I.page("long.html") && !t2.loading, { timeout: 15000, what: "second window page" });
  await sleep(800);
  settings.set({ barAutoHide: true });
  await waitFor(async () => !(await win2.vitre.page(t2.browser).query("inset:state", {})).applied, { timeout: 4000, what: "second window strip gone" }).catch(() => null);
  const w2a = await win2.vitre.page(t2.browser).query("inset:state", {});
  check("auto-hide applies to every window: the second window's page has no strip", !w2a.applied && w2a.barHidden, { applied: w2a.applied, barHidden: w2a.barHidden });
  settings.set({ barAutoHide: false });
  await waitFor(async () => (await win2.vitre.page(t2.browser).query("inset:state", {})).applied, { timeout: 4000, what: "second window strip back" }).catch(() => null);
  window.focus();
  await spike.activate();
  b.run("fullscreen");
  await waitFor(() => b.root.classList.contains("fullscreen") && b.bar.hiding, { timeout: 5000, what: "F11 full screen" });
  away();
  await waitFor(async () => !(await I.inset(t.browser)).applied, { timeout: 4000, what: "F11 strip gone" }).catch(() => null);
  await sleep(500);
  const st4 = await I.inset(t.browser, "#first");
  const w2b = await win2.vitre.page(t2.browser).query("inset:state", {});
  check("F11: this window's page has no strip and starts at the top; the other window keeps its strip", !st4.applied && st4.barHidden && near(st4.rect.top, 0) && w2b.applied && !w2b.barHidden, { here: [st4.applied, st4.rect?.top], other: [w2b.applied, w2b.barHidden] });
  await capture("inset-5-f11");
  // A tab opened while the bar hides never gets the strip (it reads the list before its first layout).
  const t3 = await I.open(I.page("long.html?new"), 900);
  const st5 = await I.inset(t3.browser, "#first");
  check("a tab opened in F11 starts without the strip: its document's checks all decided 'off', its first line at the top", !st5.applied && st5.barHidden && st5.checks >= 1 && st5.decision === "off" && st5.flips === 0 && near(st5.rect.top, 0), { applied: st5.applied, checks: st5.checks, decision: st5.decision, flips: st5.flips, top: st5.rect?.top });
  b.run("fullscreen");
  await waitFor(() => !b.root.classList.contains("fullscreen") && !b.bar.hiding, { timeout: 5000, what: "F11 left" });
  await waitFor(async () => (await I.inset(t3.browser)).applied, { timeout: 4000, what: "strip back after F11" }).catch(() => null);
  const st6 = await I.inset(t3.browser, "#first");
  check("leaving F11 brings the strip back to the window's pages", st6.applied && near(st6.rect.top, 68), { applied: st6.applied, top: st6.rect?.top });
  win2.close();
  await sleep(300);

  // ---- the PDF viewer's offset follows the same rule ----
  const pdfTop = async (browser) => {
    const r = await I.inContent(browser, (content) => {
      const el = content.document.querySelector("#toolbarContainer");
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    });
    return typeof r === "number" ? r : null;
  };
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hiding);
  away();
  const pdf = await I.open(I.page("doc.pdf"), 1500);
  await waitFor(async () => (await b.page(pdf).query("pdf:state"))?.viewer, { timeout: 15000, what: "pdf viewer" }).catch(() => null);
  await sleep(800);
  const p1 = await b.page(pdf).query("pdf:state");
  const top1 = await pdfTop(pdf.browser);
  check("PDF under the hidden bar: no offset, the viewer's toolbar at the top of the window", p1?.viewer && !p1.sheet && top1 === 0, { state: p1, toolbar: top1 });
  await capture("inset-6-pdf-hidden");
  settings.set({ barAutoHide: false });
  await waitFor(async () => (await b.page(pdf).query("pdf:state"))?.sheet, { timeout: 4000, what: "pdf offset back" }).catch(() => null);
  await sleep(500);
  const p2 = await b.page(pdf).query("pdf:state");
  const top2 = await pdfTop(pdf.browser);
  check("PDF with the bar shown: the toolbar starts at 68, under the bar", p2?.sheet && top2 === 68, { state: p2, toolbar: top2 });
  await capture("inset-7-pdf-shown");

  // ---- the shared list holds only live ids: a closed window took its own out ----
  const list = Services.ppmm.sharedData.get("vitre:inset-bar-hidden");
  check("with the bar shown everywhere the hidden-bar list is empty", Array.isArray(list) && list.length === 0, list);
  settings.reset?.("barAutoHide");
});
