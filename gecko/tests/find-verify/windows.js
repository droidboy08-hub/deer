// Find in page across windows and pages that come and go: a second window, a private window, a
// popup window, a tab moved to a new window with find open, a peek closed and promoted with find
// open, and leaks: closed windows must be collectable and the idle poll must stop. Run by
// tests/find-verify/all.py (windows).
/* global spike, FL, V, gBrowser, Services, Cu */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1000);
  V.takeErrors();

  /** Open find in window w (its own FL-like helpers are not loaded there: drive it directly). */
  async function findIn(w, text) {
    await w.spike.activate();
    w.vitre.focusPage();
    await sleep(200);
    w.vitre.run("find");
    await FL.until(() => w.vitreFind.inspect()?.open, "open in " + w.name, 3000);
    const input = w.document.querySelector("#layer-find .vf-face .vf-input");
    input.focus();
    w.spike.type(text);
    await FL.until(() => /of/.test(w.vitreFind.inspect()?.counter ?? ""), "count in w", 5000);
    await sleep(300);
    return w.vitreFind.inspect();
  }
  async function loadIn(w, url) {
    const t = w.vitre.active();
    w.vitre.navigate(t, url);
    await FL.until(() => t.url.includes(url.split("/").pop()) && !t.loading, "load in w", 10000);
    await sleep(600);
  }

  // ---- leaks: a window closed without find (control), then one closed with find open ----
  async function collected(withFind) {
    let w = await spike.openWindow();
    await loadIn(w, FL.http("article.html"));
    if (withFind) await findIn(w, "glass");
    const weak = Cu.getWeakReference(w);
    const weakCtl = Cu.getWeakReference(w.vitreFind);
    w.close();
    w = null;
    await sleep(1500);
    for (let i = 0; i < 8 && weak.get(); i++) {
      Services.obs.notifyObservers(null, "memory-pressure", "heap-minimize");
      Cu.forceShrinkingGC();
      await V.gc();
      await sleep(800);
    }
    return { window: !weak.get(), controller: !weakCtl.get() };
  }
  const control = await collected(false);
  log("control: a window closed without find", control);
  if (control.window) {
    const leak = await collected(true);
    check("a window closed with find open is collected, with its find controller", leak.window && leak.controller, leak);
  } else {
    log("SKIP leak check: even a window closed without find is not collected in this harness", control);
  }
  await spike.activate();

  // ---- a second window: its own find, its own state ----
  let w2 = await spike.openWindow();
  await loadIn(w2, FL.http("article.html"));
  let s2 = await findIn(w2, "glass");
  check("second window: find opens there and counts (1 of 13)", s2?.counter === "1 of 13" && s2.view === "pill", s2);
  check("second window: the first window's find is untouched", !FL.st()?.open && FL.face().hidden);
  check("second window: separate controllers", w2.vitreFind && w2.vitreFind !== window.vitreFind);
  await w2.spike.capture("win-01-second-window");
  w2.close();
  w2 = null;
  await sleep(800);

  // ---- a private window ----
  const wp = await spike.openWindow({ private: true });
  await loadIn(wp, FL.http("article.html"));
  const sp = await findIn(wp, "glass");
  check("private window: find works (1 of 13)", sp?.counter === "1 of 13" && wp.vitre.isPrivate, sp);
  await wp.spike.capture("win-02-private-window");
  wp.close();
  await sleep(800);

  // ---- a popup window ----
  await FL.load(V.http("popup.html"));
  await sleep(800);
  const winsBefore = Services.wm.getEnumerator("navigator:browser");
  let nBefore = 0;
  for (const _ of winsBefore) nBefore++;
  // A real popup window: window.open with features opens a tab by product default; restriction 2
  // (Firefox's own default, which a user or an extension can set) gives a popup window.
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  await spike.activate();
  b.focusPage();
  await sleep(200);
  const pop = await FL.inPage("function (w, d) { const r = d.getElementById('pop').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }");
  const bb = gBrowser.selectedBrowser.getBoundingClientRect();
  const popupReady = new Promise((resolve) => {
    const obs = (subject) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      Promise.resolve(subject.vitre?.whenReady).then(() => resolve(subject));
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  spike.EU.synthesizeMouseAtPoint(bb.x + pop.x, bb.y + pop.y, {}, window);
  const wpop = await Promise.race([popupReady, sleep(8000).then(() => null)]);
  if (!wpop) {
    let n = 0;
    for (const _ of Services.wm.getEnumerator("navigator:browser")) n++;
    check("popup window opened", false, { windowsBefore: nBefore, windowsNow: n, tabs: b.tabs.length, peek: !!b.service("peek")?.isOpen() });
  } else {
    await FL.until(() => !wpop.vitre.active()?.loading && wpop.vitre.active()?.url.includes("article"), "popup loaded", 8000);
    await sleep(800);
    check("popup window: Vitre marks it as a popup", wpop.vitre.isPopup === true, wpop.vitre.isPopup);
    const spop = await findIn(wpop, "glass");
    const pf = wpop.document.querySelector("#layer-find .vf-face");
    const r = pf.getBoundingClientRect();
    const pill = wpop.vitre.bar.layout.pillRect;
    log("popup find", spop, { face: [r.x, r.y, r.width], pill: pill && [pill.x, pill.y, pill.width] });
    check("popup window: find opens in its pill and counts", spop?.counter === "1 of 13" && pill && Math.round(r.x) === Math.round(pill.x) && Math.round(r.width) === Math.round(pill.width), spop);
    await wpop.spike.capture("win-03-popup-window");
    wpop.vitre.run("findNext");
    await FL.until(() => wpop.vitreFind.inspect()?.counter === "2 of 13", "popup step", 3000);
    check("popup window: F3 steps", wpop.vitreFind.inspect()?.counter === "2 of 13", wpop.vitreFind.inspect());
    wpop.close();
    await sleep(800);
  }

  // ---- a tab moved to a new window with find open ----
  await FL.load(FL.http("article.html"));
  await sleep(800);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open", 3000);
  await FL.query("glass");
  await FL.counter("1 of 13");
  const keep = b.newTab(FL.http("counter.html"), { background: true });
  await sleep(500);
  const moved = b.active();
  const movedBrowser = moved.browser;
  const finderBefore = movedBrowser.finder;
  const newWin = new Promise((resolve) => {
    const obs = (subject) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      Promise.resolve(subject.vitre?.whenReady).then(() => resolve(subject));
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  b.moveToNewWindow(moved);
  const wm = await Promise.race([newWin, sleep(8000).then(() => null)]);
  await sleep(1500);
  if (!wm) {
    check("moved to a new window", false);
  } else {
    const newBrowser = wm.gBrowser.selectedBrowser;
    const finder = newBrowser.finder;
    const listeners = Array.from(finder._listeners || []).length;
    const ours = Array.from(finder._listeners || []).filter((l) => l && typeof l.onFindResult === "function" && l.shouldFocusContent).length;
    log("moved tab", { sameFinder: finder === finderBefore, listeners, ours, newWinFind: wm.vitreFind.inspect() });
    check("moved tab: the old window's find listener left the moved page's finder", ours === 0, { listeners, ours });
    const ranges = await V.findRanges(newBrowser);
    check("moved tab: the old window's highlights do not linger in the moved page", ranges === 0, ranges);
    check("moved tab: the old window shows no face", FL.face().hidden && V.residue().length === 0, V.residue());
    wm.vitre.run("find");
    await FL.until(() => wm.vitreFind.inspect()?.open, "find in moved", 3000);
    const inp = wm.document.querySelector("#layer-find .vf-face .vf-input");
    inp.focus();
    inp.select();
    wm.spike.type("glass");
    await FL.until(() => wm.vitreFind.inspect()?.counter === "1 of 13", "moved count", 5000);
    check("moved tab: find works in its new window", wm.vitreFind.inspect()?.counter === "1 of 13", wm.vitreFind.inspect());
    wm.close();
    await sleep(800);
  }
  b.activate(keep);
  await sleep(300);

  // ---- a peek closed and promoted with find open ----
  const peek = b.service("peek");
  if (!peek) {
    log("SKIP peek: the peek module is not in this build");
  } else {
    await FL.load(FL.http("article.html"));
    await sleep(800);
    peek.open(FL.http("article.html"));
    await FL.until(() => peek.isOpen() && peek.browser() && !peek.browser().webProgress?.isLoadingDocument, "peek open", 10000);
    await sleep(1200);
    const pb = peek.browser();
    pb.focus();
    await sleep(200);
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open && FL.st()?.view === "capsule", "capsule", 3000);
    FL.type("glass");
    await FL.counter("1 of 13");
    // Capsule geometry against the FindPill board (capsule-local): 440x32, field from 12, counter's
    // right edge 300, previous 308, next 334 (24x24 at y 4), divider 365, Aa 372, x 404.
    {
      const c = FL.capsule().getBoundingClientRect();
      const at = (sel) => {
        const r = FL.capsule().querySelector(sel).getBoundingClientRect();
        return { x: Math.round(r.x - c.x), y: Math.round(r.y - c.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right - c.x) };
      };
      const g = { input: at(".vf-input"), count: at(".vf-count"), prev: at(".vf-prev"), next: at(".vf-next"), div: at(".vf-div"), aa: at(".vf-case"), close: at(".vf-close") };
      log("capsule geometry", Math.round(c.width), Math.round(c.height), g);
      check("the capsule matches the FindPill board's capsule geometry", Math.round(c.width) === 440 && Math.round(c.height) === 32 && g.input.x === 12 && g.count.r === 300 && g.prev.x === 308 && g.prev.y === 4 && g.prev.w === 24 && g.next.x === 334 && g.div.x === 365 && g.aa.x === 372 && g.close.x === 404, g);
    }
    // Closing the sheet with find open (a click on the dim, Ctrl+W, the close button).
    peek.close();
    await FL.until(() => !peek.isOpen(), "peek closed", 3000);
    await sleep(900);
    const st = FL.F().inspect(pb);
    log("after closing the peek", { st, open: FL.F().open?.size, poll: FL.F().pollTimer });
    check("peek closed with find open: the capsule is gone, the header's text is back", FL.capsule().hidden && V.residue().length === 0, V.residue());
    check("peek closed with find open: its find is closed (nothing left open, no poll running)", !st?.open && FL.F().open.size === 0 && !FL.F().pollTimer, { st, open: FL.F().open.size, poll: FL.F().pollTimer });
    // Promote: the sheet's find becomes the tab's find in the pill.
    peek.open(FL.http("article.html"));
    await FL.until(() => peek.isOpen() && peek.browser() && !peek.browser().webProgress?.isLoadingDocument, "peek open 2", 10000);
    await sleep(1200);
    peek.browser().focus();
    await sleep(200);
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open && FL.st()?.view === "capsule", "capsule 2", 3000);
    FL.type("glass");
    await FL.counter("1 of 13");
    spike.press("Enter");
    await FL.counter("2 of 13");
    const promotedBrowser = peek.browser();
    peek.promote();
    await FL.until(() => !peek.isOpen() && b.active()?.browser === promotedBrowser, "promoted", 5000);
    await sleep(1200);
    const sp2 = FL.st();
    log("after promote", sp2, V.residue());
    check("peek promoted with find open: find carries over to the new tab's pill, same match", sp2?.open && sp2.view === "pill" && sp2.counter === "2 of 13" && FL.capsule().hidden && !FL.face().hidden, sp2);
    await capture("win-04-promoted");
    spike.press("Escape");
    FL.F().api().close();
    await FL.until(() => !FL.st()?.open, "closed", 3000);
    await sleep(600);
  }

  await sleep(500);
  check("nothing open: the poll is stopped", FL.F().open.size === 0 && !FL.F().pollTimer, { open: FL.F().open.size, poll: FL.F().pollTimer });
  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
