// Recently closed (../design/HISTORY-SPEC.md "Recently closed", "Menus"): closed tabs of every normal
// window newest first, closed windows; Home, blank and peek tabs and private tabs never listed; the
// count; reopening (switched to with its back history, the panel closing; in the background with the
// panel staying; a window); removing from the list; Ctrl+Shift+T under the panel; the menus; empty.
//   python tests/history/all.py closed
/* global spike, Services, H, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, heads, toolbar } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const first = await H.load(H.http("start.html"));
  const SS = window.SessionStore;
  const view = (v) => H.click(H.root().querySelector(`.vh-view[data-view="${v}"]`));
  const titled = async (t) => until(() => !t.loading && t.title && t.title !== "New Tab", 10000);

  // ---- empty ----
  await H.open();
  view("closed");
  await sleep(300);
  check("nothing closed yet: 'Tabs and windows you close show up here.'", H.message() === "Tabs and windows you close show up here." && toolbar().text === "" && rows().length === 0, H.message());
  await H.close();

  // ---- setup: tabs, a window, Home, a peek, a private tab ----
  log("--- setup");
  const c = b.newTab(H.http("c.html"), { background: true });
  await titled(c);
  b.navigate(c, H.http("d.html"));
  await until(() => c.url === H.http("d.html") && !c.loading && c.title === "Slow light", 8000);
  await sleep(400);
  b.closeTab(c);
  await sleep(300);
  for (const leaf of ["e.html", "f.html"]) {
    const t = b.newTab(H.http(leaf), { background: true });
    await titled(t);
    await sleep(200);
    b.closeTab(t);
    await sleep(300);
  }
  const home = b.newTab(undefined, { background: true });
  await sleep(800);
  b.closeTab(home);
  await sleep(300);
  if (b.service("peek")) {
    b.service("peek").open(H.http("b.html"));
    await until(() => b.service("peek").isOpen(), 4000);
    await sleep(800);
    b.service("peek").close();
    await sleep(600);
  }
  const w2 = await spike.openWindow();
  await sleep(800);
  await H.load(H.http("a.html"), w2.vitre.active());
  const w2b = w2.vitre.newTab(H.http("b.html"));
  await until(() => !w2b.loading && w2b.title === "Tin bath", 8000);
  await sleep(500);
  w2.close();
  await until(() => SS.getClosedWindowCount() >= 1, 5000);
  await sleep(300);
  const pw = await spike.openWindow({ private: true });
  await sleep(800);
  const pt = pw.vitre.newTab(H.http("a.html"));
  await until(() => !pt.loading, 8000);
  await sleep(300);
  pw.vitre.closeTab(pt);
  await sleep(300);
  window.focus();
  await spike.activate();
  b.focusPage();

  // ---- the list ----
  log("--- the list");
  await H.open();
  const cv = H.root().querySelector('.vh-view[data-view="closed"]');
  check("the sidebar's count: tabs plus windows ('Recently closed, 4')", cv.querySelector(".vh-count").textContent === "4" && cv.getAttribute("aria-label") === "Recently closed, 4", cv.getAttribute("aria-label"));
  view("closed");
  await sleep(400);
  const titles = rows().map((r) => r.title);
  log("closed rows", titles);
  check("Tabs then Windows, each under a 28 px heading", heads().map((h) => h.label).join() === "Tabs,Windows" && rows().filter((r) => r.group === "g-tabs").length === 3 && rows().filter((r) => r.group === "g-windows").length === 1, heads().map((h) => h.label));
  check("tabs newest first; Home, the peek and the private tab never listed", titles.slice(0, 3).join("|") === "Soda-lime glass|The quiet science of ice|Slow light" && !titles.includes("Tin bath ") && rows().length === 4, titles);
  const win = rows().find((r) => r.group === "g-windows");
  check("a window row: its selected tab's title, 'Window · 2 tabs', the window glyph", win.title === "Tin bath" && win.addr === "Window · 2 tabs" && !!win.el.querySelector(".vh-fav svg"), { title: win.title, addr: win.addr });
  check("…its tooltip lists its tabs", win.el.dataset.tip === "Float glass\nTin bath", win.el.dataset.tip);
  check("closed today: the time column shows the time", /\d/.test(rows()[0].time), rows()[0].time);
  check("the toolbar: '3 tabs and 1 window'", toolbar().text === "3 tabs and 1 window", toolbar().text);
  check("no checkboxes in Recently closed; the list is named for it", getComputedStyle(rows()[0].el.querySelector(".vh-slot .vh-cb")).opacity === "0" && H.list().getAttribute("aria-label") === "Recently closed" && H.list().getAttribute("aria-multiselectable") === "false");
  await spike.capture("closed-1-list");

  // ---- menus ----
  log("--- menus");
  // The window was closed last: Ctrl+Shift+T would bring it back next (SessionStore's last close action).
  const m3 = await H.menuOn(win.el);
  check("a closed window's menu: Reopen window  Ctrl+Shift+T (it comes back next) — Remove from list  Delete", JSON.stringify(m3.map((r) => [r.label, r.key ?? ""])) === JSON.stringify([["Reopen window", "Ctrl+Shift+T"], ["Remove from list", "Delete"]]), m3.map((r) => [r.label, r.key]));
  H.M().api.close();
  await sleep(150);
  const m1 = await H.menuOn(rows()[0].el);
  check("a closed tab's menu: Reopen tab · Copy address — Remove from list  Delete; Ctrl+Shift+T only on the next one", JSON.stringify(m1.map((r) => [r.label, r.key ?? ""])) === JSON.stringify([["Reopen tab", ""], ["Copy address", ""], ["Remove from list", "Delete"]]), m1.map((r) => [r.label, r.key]));
  H.M().api.close();
  await sleep(150);
  await H.menuOn(rows()[1].el);
  await H.pick("Copy address");
  check("Copy address", H.clipboard() === H.http("e.html"), H.clipboard());

  // ---- reopening ----
  log("--- reopening");
  const n = b.tabs.length;
  H.click(rows().find((r) => r.title === "The quiet science of ice").el.querySelector(".vh-title"), { ctrlKey: true });
  await until(() => b.tabs.length === n + 1, 4000);
  await sleep(600);
  check("Ctrl+click reopens the tab in the background; the panel stays; the row collapses out", b.tabs.length === n + 1 && b.active() === first && H.isOpen() && !rows().some((r) => r.title === "The quiet science of ice"), rows().map((r) => r.title));
  check("…Narrator: 'Reopened The quiet science of ice'", H.panel().announced === "Reopened The quiet science of ice", H.panel().announced);
  H.click(rows().find((r) => r.title === "Slow light").el.querySelector(".vh-title"));
  await until(() => b.active().url === H.http("d.html"), 4000);
  await sleep(800);
  const back = b.active();
  check("a click reopens it here, switched to, with its back history; the panel closes", back !== first && back.url === H.http("d.html") && back.browser.canGoBack && !H.isOpen(), { url: back.url, canGoBack: back.browser.canGoBack });
  b.activate(first);
  await sleep(300);
  await H.open();
  view("closed");
  await sleep(300);

  // ---- remove from list, Ctrl+Shift+T ----
  log("--- remove, Ctrl+Shift+T");
  const tabsClosed = SS.getClosedTabCount({ sourceWindow: window, closedTabsFromAllWindows: true });
  rows().find((r) => r.title === "Soda-lime glass").el.focus();
  H.press("Delete");
  await sleep(600);
  check("Delete removes the entry from Recently closed (SessionStore forgets it)", !rows().some((r) => r.title === "Soda-lime glass") && SS.getClosedTabCount({ sourceWindow: window, closedTabsFromAllWindows: true }) === tabsClosed - 1, rows().map((r) => r.title));
  check("…Narrator: 'Removed from Recently closed'", H.panel().announced === "Removed from Recently closed");
  const t2 = b.newTab(H.http("c.html"), { background: true });
  await titled(t2);
  b.closeTab(t2);
  await until(() => rows().some((r) => r.title === "Annealing lehr"), 3000);
  await sleep(300);
  check("a tab closed while the panel is open shows up at once", rows()[0].title === "Annealing lehr", rows().map((r) => r.title));
  const focusBefore = H.focused();
  H.press("Ctrl+Shift+T");
  await until(() => !rows().some((r) => r.title === "Annealing lehr"), 3000);
  await sleep(500);
  check("Ctrl+Shift+T under the panel reopens it and its entry collapses out; the panel keeps focus", H.isOpen() && !rows().some((r) => r.title === "Annealing lehr") && H.sheet().contains(document.activeElement), { focusBefore, now: H.focused() });
  H.click(rows().find((r) => r.group === "g-windows").el.querySelector(".vh-x"));
  await sleep(500);
  check("the x on a window row removes it", !rows().some((r) => r.group === "g-windows") && SS.getClosedWindowCount() === 0);

  // ---- a window ----
  log("--- a window");
  await H.close();
  const w3 = await spike.openWindow();
  await sleep(800);
  await H.load(H.http("e.html"), w3.vitre.active());
  await sleep(300);
  w3.close();
  await until(() => SS.getClosedWindowCount() === 1, 5000);
  await spike.activate();
  b.focusPage();
  await H.open();
  view("closed");
  await sleep(300);
  const known = new Set(Services.wm.getEnumerator("navigator:browser"));
  H.click(rows().find((r) => r.group === "g-windows").el.querySelector(".vh-title"));
  const back3 = await until(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => !known.has(w) && !w.closed && w.vitre), 6000);
  await until(() => back3?.vitre.tabs.some((t) => t.url === H.http("e.html")), 6000);
  check("a window row reopens the whole window; the panel closes", !!back3 && SS.getClosedWindowCount() === 0 && back3.vitre.tabs.some((t) => t.url === H.http("e.html")) && !H.isOpen(), back3?.vitre.tabs.map((t) => t.url));
  back3?.close();
  pw.close();
  await sleep(500);
});
