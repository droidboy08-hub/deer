// Peek verification: awkward pages. A PDF in the sheet (the viewer must not get the bar offset
// inside the sheet, and must get it back as a tab), a slow page and a page that never answers (cover,
// load line, Esc, Open as tab while loading), a dark page under and inside the sheet, a page that
// closes itself or asks for focus, a page that uses Shift+click itself, a peek that changes process,
// an error page.   python tests/peek-verify/all.py pages
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  const VERIFY = P.page("verify.html") + "?xsite=" + encodeURIComponent(P.xsite);
  const src = b.active();
  await P.load(VERIFY, src);

  await V.section("pdf", async () => {
    await P.load(VERIFY, src);
    await P.shiftClick("#pdf");
    const br = await P.waitOpen("doc.pdf", 15000);
    await waitFor(async () => (await b.page(br).query("pdf:state"))?.viewer, { timeout: 10000, what: "the PDF viewer in the sheet" });
    await sleep(1200);
    const st = await b.page(br).query("pdf:state");
    const top = await P.inContent(br, (w) => w.document.getElementById("mainContainer")?.getBoundingClientRect().top ?? null);
    log("pdf in the sheet", st, "mainContainer top", top);
    check("a PDF in the sheet: the viewer is not pushed under a bar it is not under (no 68 px band below the header)", st && st.viewer && !st.sheet && top === 0, { sheet: st && st.sheet, top });
    await spike.capture("pages-1-pdf-sheet");
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.active().browser === br, { what: "the PDF promoted" });
    await sleep(900);
    const st2 = await b.page(br).query("pdf:state");
    const top2 = await P.inContent(br, (w) => w.document.getElementById("mainContainer")?.getBoundingClientRect().top ?? null);
    check("promoted to a tab, the viewer goes under the bar again (68 px)", st2 && st2.sheet && top2 === 68, { sheet: st2 && st2.sheet, top: top2 });
    await spike.capture("pages-2-pdf-tab");
  });

  await V.section("slow page", async () => {
    await P.load(VERIFY, src);
    await P.shiftClick("#slow");
    await waitFor(() => peek().isOpen(), { what: "the sheet" });
    await sleep(500);
    const s = P.sheet();
    log("slow page after 500 ms", s);
    // The first half of the page arrives at once and paints (the cover goes at first paint); the
    // load line runs until the rest arrives 3 s later.
    check("a slow page: the sheet is up and the load line runs while it loads", s.shown && s.loading, s);
    await spike.capture("pages-3-slow-loading");
    await P.focusPeek().catch(() => {});
    P.press("Escape");
    await P.waitClosed();
    check("Esc closes a peek that is still loading", !peek().isOpen() && !P.sheet().dimOn);
    await sleep(3500);
    check("nothing is left behind: at most the one warm page, no closed-tab entry", V.hidden() <= 1 && !P.tabsInfo().closed.some((u) => /slow|n=41/.test(String(u))), P.tabsInfo());
    // Open as tab while it loads.
    await P.shiftClick("#i38");
    await P.waitOpen("n=38");
    P.press("Escape");
    await P.waitClosed();
    await P.shiftClick("#slow");
    await waitFor(() => peek().isOpen(), { what: "the sheet again" });
    await sleep(300);
    const br = peek().browser();
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.active().browser === br, { what: "promoted while loading" });
    await waitFor(() => !b.active().loading, { timeout: 10000, what: "the slow page to finish as a tab" });
    await sleep(1500);
    const inset = await b.page(br).query("inset:state");
    check("promoted while loading: it finishes loading as a tab and gets its strip", inset?.browserOff === false && inset.applied === true && V.hidden() <= 1, inset && { off: inset.browserOff, applied: inset.applied, reason: inset.reason, decision: inset.decision });
  });

  await V.section("page that never answers", async () => {
    await P.load(VERIFY, src);
    await P.shiftClick("#hang");
    await waitFor(() => peek().isOpen(), { what: "the sheet" });
    await sleep(2000);
    const s = P.sheet();
    check("a page that never answers: the cover and the load line stay, the header names it", s.shown && Number(s.cover) > 0.9 && s.loading && s.path === "/hang", s);
    await spike.capture("pages-4-hang");
    P.press("Escape");
    await sleep(80);
    P.press("Escape");
    await P.waitClosed();
    await sleep(400);
    check("Esc (and Esc Esc) close it; the never-loaded page is not kept, nothing in the closed-tab list", !peek().isOpen() && V.hidden() === 0 && !P.tabsInfo().closed.some((u) => /hang/.test(String(u))), { hidden: V.hidden(), closed: P.tabsInfo().closed });
    check("focus is back on the link", (await P.state(src.browser)).active === "hang");
    // Ctrl+Shift+T has nothing warm to bring back: it must not reopen the hung peek either.
    check("a never-loaded peek cannot be reopened", !peek().canReopen());
    await P.shiftClick("#hang");
    await waitFor(() => peek().isOpen(), { what: "the sheet again" });
    await sleep(300);
    peek().promote();
    await waitFor(() => !peek().isOpen() && b.tabs.length === 2, { what: "the hung peek promoted" });
    await sleep(600);
    check("a hung peek can still be opened as a tab (it keeps loading there)", b.active().loading && b.tabs.length === 2 && V.hidden() === 0, { loading: b.active().loading });
    b.run("stop");
    await sleep(300);
  });

  await V.section("dark pages", async () => {
    await P.load(P.page("verify.html?dark"), src);
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    await spike.capture("pages-5-dark-under");
    check("over a dark page the sheet opens the same way", P.sheet().shown && P.sheet().dimOn);
    P.press("Escape");
    await P.waitClosed();
    await P.load(VERIFY, src);
    await P.shiftClick("#dark");
    await P.waitOpen("dark");
    await spike.capture("pages-6-dark-inside");
    const s = P.sheet();
    check("a dark page inside the sheet: the cover went once it painted", Number(s.cover) === 0, s);
  });

  await V.section("page that closes itself", async () => {
    await P.load(VERIFY, src);
    await P.shiftClick("#closer");
    const br = await P.waitOpen("closer.html");
    await P.focusPeek();
    const fb = await P.rectOf(br, "#focus");
    P.mouse(fb.cx, fb.cy);
    await sleep(900);
    check("window.focus() from the sheet does not select its tab", peek().isOpen() && gBrowser.selectedTab === src.node);
    const cb = await P.rectOf(br, "#close");
    P.mouse(cb.cx, cb.cy);
    await sleep(1200);
    const node = gBrowser.getTabForBrowser(br);
    log("after window.close()", { open: peek().isOpen(), tabGone: !node || node.closing, out: node ? (await P.inContent(br, (w) => w.document.getElementById("out").textContent)) : "(gone)" });
    if (!peek().isOpen()) {
      check("the sheet went with its page", !P.sheet().shown && !P.sheet().dimOn);
      check("keyboard focus went back to the page under it (not lost)", document.activeElement === src.browser, document.activeElement?.localName + "#" + document.activeElement?.id);
      await sleep(600);
      check("the self-closed peek is not in the closed-tab list", !P.tabsInfo().closed.some((u) => /closer/.test(String(u))), P.tabsInfo().closed);
    } else {
      check("window.close() was refused by the engine: the peek is still a working sheet", P.sheet().shown && peek().browser() === br);
    }
  });

  await V.section("page that keeps Shift+click", async () => {
    await P.load(VERIFY, src);
    const wins = () => [...Services.wm.getEnumerator("navigator:browser")].length;
    const w0 = wins();
    await P.shiftClick("#kept");
    await sleep(900);
    const kept = await P.inContent(src.browser, (w) => w.document.documentElement.dataset.kept || "0");
    check("a page that preventDefaults Shift+click keeps it: no peek, no window, its handler ran", !peek().isOpen() && wins() === w0 && kept === "1" && b.tabs.length === 1, { kept, wins: wins() });
  });

  await V.section("process switch inside the sheet", async () => {
    await P.load(VERIFY, src);
    await P.shiftClick("#xsite");
    const br = await P.waitOpen("n=27");
    const pidA = br.frameLoader?.remoteTab?.osPid;
    const srcPid = src.browser.frameLoader?.remoteTab?.osPid;
    log("pids", { peek: pidA, src: srcPid });
    await P.focusPeek();
    // Back to the first site inside the sheet: another process switch.
    br.loadURI(Services.io.newURI(P.page("issue.html?n=24")), { triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}) });
    await waitFor(() => br.currentURI.spec.includes("n=24") && !br.webProgress.isLoadingDocument, { what: "the cross-site navigation in the sheet" });
    await sleep(800);
    const pidB = br.frameLoader?.remoteTab?.osPid;
    log("pid after", pidB);
    check("after a process switch the sheet still shows the page in place", P.sheet().shown && P.R(br.getBoundingClientRect()).y === 116 && peek().browser() === br, P.sheet().browser);
    check("and keyboard focus is still in the sheet's page", document.activeElement === br && Services.focus.focusedContentBrowsingContext === br.browsingContext, { active: document.activeElement?.localName });
    const ta = await P.rectOf(br, "#comment");
    P.mouse(ta.cx, ta.cy);
    await sleep(150);
    spike.type("after switch");
    await sleep(300);
    check("typing reaches the switched page", (await P.state(br)).typed === "after switch");
    await spike.capture("pages-7-process-switch");
  });

  await V.section("error page", async () => {
    await P.load(VERIFY, src);
    peek().open("http://127.0.0.1:1/nothing-here", { origin: { x: 100, y: 300, width: 200, height: 20 } });
    await waitFor(() => peek().isOpen() && !peek().browser().webProgress.isLoadingDocument && /about:neterror/.test(peek().browser().documentURI?.spec ?? ""), { timeout: 15000, what: "the error page in the sheet" });
    await sleep(1200);
    const s = P.sheet();
    check("an error page shows in the sheet, cover gone, the header names the address", s.shown && Number(s.cover) === 0 && s.host === "127.0.0.1:1" && !s.loading, s);
    await spike.capture("pages-8-error");
    P.press("Escape");
    await P.waitClosed();
    check("Esc closes it", !peek().isOpen());
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
