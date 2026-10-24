// Opening a row (../design/HISTORY-SPEC.md "Opening a row", "Peek from a row", "Menus"): a click opens
// in the current tab (the panel closes, focus to the page; Home is replaced; the focused side of a
// split), Ctrl+click and middle-click a background tab (the wash, the panel stays, Narrator hears it),
// Ctrl+Shift+click a new tab switched to, Shift+click a peek (History steps aside and comes back warm
// with the wash and focus on the row; not after Open as tab), the Shift+click setting, the keys, a
// double-click and Alt+click as a click, a file: row without Peek, the row menu, a pending delete
// committed first.
//   python tests/history/all.py gestures
/* global spike, Services, H, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/hlib.js", window);
spike.main(async () => {
  const { b, until, rows, at } = H;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const first = await H.load(H.http("start.html"));
  const P = { c: H.http("c.html"), d: H.http("d.html"), e: H.http("e.html"), f: H.http("f.html"), b: H.http("b.html") };
  await H.seed([
    { url: P.c, title: "Annealing lehr", visits: [at(1, 10, 0)] },
    { url: P.d, title: "Slow light", visits: [at(1, 11, 0)] },
    { url: P.e, title: "The quiet science of ice", visits: [at(2, 9, 0)] },
    { url: P.f, title: "Soda-lime glass", visits: [at(2, 10, 0)] },
    { url: P.b, title: "Tin bath", visits: [at(3, 10, 0)] },
    { url: "file:///C:/Users/test/notes.html", title: "Notes on disk", visits: [at(3, 11, 0)] },
  ]);
  const peek = () => b.service("peek");
  const reopen = async () => {
    b.focusPage();
    await sleep(150);
    await H.open();
  };

  // ---- 1. click: here ----
  log("--- 1. click");
  await reopen();
  H.click(H.row("Annealing lehr").el.querySelector(".vh-title"));
  await until(() => !H.isOpen() && b.active().url === P.c && !b.active().loading, 8000);
  await sleep(300);
  check("a click opens the page in the current tab; the panel closes; focus goes to the page", b.active() === first && b.active().url === P.c && !H.isOpen() && document.activeElement === first.browser, { url: b.active().url, focus: H.focused() });

  // Home is replaced.
  const home = b.newTab();
  await until(() => b.active() === home && home.kind === "home", 5000);
  await sleep(600);
  b.omni.close(false);
  await reopen();
  H.click(H.row("Slow light").el.querySelector(".vh-title"));
  await until(() => home.url === P.d && !home.loading, 8000);
  await sleep(300);
  check("on Home, a click replaces Home with the page (the same tab)", b.active() === home && home.kind === "web" && home.url === P.d, { kind: home.kind, url: home.url });
  b.closeTab(home);
  await sleep(400);

  // ---- 2. background, new tab ----
  log("--- 2. Ctrl+click, middle-click, Ctrl+Shift+click");
  await reopen();
  const n = b.tabs.length;
  const row = H.row("The quiet science of ice");
  H.click(row.el.querySelector(".vh-title"), { ctrlKey: true });
  await sleep(120);
  const washed = row.el.classList.contains("washed") || getComputedStyle(row.el.querySelector(".vh-wash")).opacity > 0.3;
  await until(() => b.tabs.length === n + 1, 5000);
  await sleep(600);
  check("Ctrl+click: a background tab, the panel stays, the row gets the accent wash", b.tabs.length === n + 1 && b.active() === first && H.isOpen() && washed && b.tabs.some((t) => t.url === P.e), { tabs: b.tabs.length, washed });
  check("…and Narrator says 'Opened in a new tab'", H.panel().announced === "Opened in a new tab", H.panel().announced);
  H.click(H.row("Soda-lime glass").el.querySelector(".vh-title"), { button: 1 });
  await until(() => b.tabs.length === n + 2, 5000);
  await sleep(300);
  check("middle-click: a background tab too, the panel stays", b.tabs.length === n + 2 && b.active() === first && H.isOpen());
  check("new tabs open where Settings › Tabs says (next to the current one)", b.tabs.indexOf(b.tabs.find((t) => t.url === P.f)) === b.tabs.indexOf(first) + 1, b.tabs.map((t) => t.url));
  H.click(H.row("Tin bath").el.querySelector(".vh-title"), { ctrlKey: true, shiftKey: true });
  await until(() => b.active().url === P.b, 5000);
  await sleep(300);
  check("Ctrl+Shift+click: a new tab, switched to; the panel closes", b.active() !== first && b.active().url === P.b && !H.isOpen());
  for (const t of [...b.tabs]) if (t !== first) b.closeTab(t);
  await sleep(400);
  b.activate(first);
  await sleep(300);

  // ---- 3. Shift+click: a peek ----
  log("--- 3. Shift+click peeks");
  if (peek()) {
    await reopen();
    const pr = H.row("Slow light");
    const rr = pr.el.getBoundingClientRect();
    const fromGroup = pr.group;
    H.click(pr.el.querySelector(".vh-title"), { shiftKey: true });
    await until(() => peek().isOpen() && !H.isOpen(), 4000);
    await sleep(700);
    check("Shift+click: History steps aside and the row's page opens in a peek", peek().isOpen() && !H.isOpen() && peek().browser()?.currentURI.spec === P.d && !b.root.classList.contains("history-open"), peek().browser()?.currentURI.spec);
    await spike.capture("gestures-1-peek");
    H.press("Escape", {}, window);
    peek().close();
    await until(() => H.isOpen() && !peek().isOpen(), 4000);
    await until(() => H.focused() === "row:Slow light", 2000);
    await sleep(150);
    const back = document.activeElement;
    check("the peek put back: History comes back warm, focus on that row (the one it came from)", H.isOpen() && H.focused() === "row:Slow light" && back.closest(".vh-group")?.dataset.id === fromGroup, { focus: H.focused(), group: back.closest(".vh-group")?.dataset.id, fromGroup });
    const washOp = Number(getComputedStyle(back.querySelector(".vh-wash")).opacity);
    check("…and that row has the wash, fading (History's, not Peek's)", !document.querySelector(".vitre-peek-wash") && washOp > 0.05 && washOp < 1, { peekWash: !!document.querySelector(".vitre-peek-wash"), washOp, rr: rr.top });
    // Open as tab: History stays away; Ctrl+H within 60 s brings it back warm.
    H.click(H.row("Annealing lehr").el.querySelector(".vh-title"), { shiftKey: true });
    await until(() => peek().isOpen(), 4000);
    await sleep(700);
    const phases = [];
    const onPhase = (e) => phases.push(e.detail?.phase);
    window.addEventListener("vitre:peek", onPhase);
    peek().promote();
    await until(() => !peek().isOpen() && b.active().url === P.c, 4000);
    await sleep(800);
    window.removeEventListener("vitre:peek", onPhase);
    check("opened as a tab: History does not come back", !H.isOpen() && b.active().url === P.c, { open: H.isOpen(), url: b.active().url, phases });
    b.focusPage();
    await sleep(200);
    H.press("Ctrl+H");
    await until(() => H.isOpen(), 3000);
    await sleep(300);
    check("Ctrl+H then brings it back warm", H.isOpen(), { open: H.isOpen(), focus: H.focused() });
    await H.close();
    for (const t of [...b.tabs]) if (t !== first) b.closeTab(t);
    b.activate(first);
    await sleep(400);

    // The Shift+click setting: "Open in new window".
    b.sys("VitreSettings").set({ shiftClick: "window" });
    await sleep(200);
    await reopen();
    const wins = [...Services.wm.getEnumerator("navigator:browser")].length;
    H.click(H.row("Tin bath").el.querySelector(".vh-title"), { shiftKey: true });
    const w2 = await until(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => w !== window), 6000);
    await sleep(800);
    check("with Shift+click set to 'Open in new window', Shift+click opens a window", !!w2 && [...Services.wm.getEnumerator("navigator:browser")].length === wins + 1 && !peek().isOpen());
    w2?.close();
    await sleep(500);
    b.sys("VitreSettings").set({ shiftClick: "peek" });
    await spike.activate();
    await H.close();
  } else check("the Peek module is in the build", false);

  // ---- 4. keys ----
  log("--- 4. keys");
  await reopen();
  const focusRow = async (title) => {
    H.row(title).el.focus();
    await sleep(80);
  };
  const m = b.tabs.length;
  await focusRow("Soda-lime glass");
  H.press("Ctrl+Enter");
  await until(() => b.tabs.length === m + 1, 4000);
  check("Ctrl+Enter: a background tab, the panel stays", b.tabs.length === m + 1 && b.active() === first && H.isOpen());
  await focusRow("Tin bath");
  H.press("Alt+Enter");
  await until(() => b.active().url === P.b, 4000);
  await sleep(300);
  check("Alt+Enter: a new tab, switched to (the page-first Open as tab never sees it)", b.active().url === P.b && b.active() !== first && !H.isOpen());
  for (const t of [...b.tabs]) if (t !== first) b.closeTab(t);
  b.activate(first);
  await sleep(300);
  if (peek()) {
    await reopen();
    await focusRow("Slow light");
    H.press("Shift+Enter");
    await until(() => peek().isOpen(), 4000);
    await sleep(600);
    check("Shift+Enter: a peek", peek().isOpen() && !H.isOpen());
    peek().close();
    await until(() => H.isOpen(), 4000);
    await sleep(700);
    await focusRow("Soda-lime glass");
    H.press("Ctrl+Q");
    await until(() => peek().isOpen(), 4000);
    await sleep(600);
    check("Ctrl+Q always peeks (taken by the panel before the page-first key)", peek().isOpen() && peek().browser()?.currentURI.spec === P.f);
    peek().close();
    await until(() => H.isOpen(), 4000);
    await sleep(700);
  }
  await focusRow("The quiet science of ice");
  H.press("Enter");
  await until(() => b.active().url === P.e && !H.isOpen(), 4000);
  await sleep(300);
  check("Enter: opens here, the panel closes", b.active() === first && first.url === P.e && !H.isOpen());

  // ---- 5. double-click, Alt+click, a file: row ----
  log("--- 5. double-click, Alt+click, file:");
  await reopen();
  const tabsNow = b.tabs.length;
  H.click(H.row("Slow light").el.querySelector(".vh-title"), { clickCount: 1 });
  H.click(H.row("Slow light")?.el.querySelector(".vh-title") ?? document.body, { clickCount: 2 });
  await until(() => first.url === P.d, 4000);
  await sleep(500);
  check("a double-click acts as a click (opens here once, no download)", first.url === P.d && b.tabs.length === tabsNow && !H.isOpen());
  await reopen();
  H.click(H.row("Annealing lehr").el.querySelector(".vh-title"), { altKey: true });
  await until(() => first.url === P.c, 4000);
  await sleep(500);
  check("Alt+click acts as a click", first.url === P.c && b.tabs.length === tabsNow && !H.isOpen());
  await reopen();
  const menu = await H.menuOn(H.row("Notes on disk").el);
  check("a file: row's menu leaves Peek out", !menu.some((r) => r.label === "Peek") && menu.some((r) => r.label === "Open in new tab"), menu.map((r) => r.label));
  H.M().api.close();
  await sleep(200);

  // ---- 6. the row menu ----
  log("--- 6. the row menu");
  const rm = await H.menuOn(H.row("Slow light").el);
  check("the row menu: Open in new tab · Peek  Shift+click · Open in new window · Open in new private window — Copy address — Delete from history  Delete", JSON.stringify(rm.map((r) => [r.label, r.key ?? ""])) === JSON.stringify([["Open in new tab", ""], ["Peek", "Shift+click"], ["Open in new window", ""], ["Open in new private window", ""], ["Copy address", ""], ["Delete from history", "Delete"]]), rm.map((r) => [r.label, r.key]));
  check("the row keeps its pressed look while its menu is open", H.row("Slow light").el.classList.contains("pressed"));
  await spike.capture("gestures-2-row-menu");
  await H.pick("Copy address");
  check("Copy address", H.clipboard() === P.d, H.clipboard());
  check("…the pressed look goes with the menu", !H.row("Slow light").el.classList.contains("pressed"));
  const before = b.tabs.length;
  await H.menuOn(H.row("Slow light").el);
  await H.pick("Open in new tab");
  await until(() => b.tabs.length === before + 1, 3000);
  check("Open in new tab (background; the panel stays)", b.tabs.length === before + 1 && H.isOpen());
  const winsBefore = [...Services.wm.getEnumerator("navigator:browser")].length;
  await H.menuOn(H.row("Slow light").el);
  await H.pick("Open in new private window");
  const pw = await until(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => w !== window && w.vitre?.isPrivate), 6000);
  await sleep(800);
  check("Open in new private window", !!pw && [...Services.wm.getEnumerator("navigator:browser")].length === winsBefore + 1);
  pw?.close();
  await sleep(500);
  await spike.activate();
  for (const t of [...b.tabs]) if (t !== first) b.closeTab(t);
  b.activate(first);
  await sleep(300);

  // ---- 7. opening commits a pending delete ----
  log("--- 7. opening commits a pending delete");
  await H.close();
  await reopen();
  H.panel().undoMs = 600000;
  H.hover(H.row("Tin bath").el);
  await sleep(150);
  H.click(H.row("Tin bath").el.querySelector(".vh-x"));
  await sleep(400);
  const pend = H.store().pending;
  check("(a delete is pending)", !!pend && (await H.visits(P.b)).length > 0, pend && pend.ranges);
  H.click(H.row("Soda-lime glass").el.querySelector(".vh-title"), { ctrlKey: true });
  await until(async () => (await H.visits(P.b)).length < 2, 4000);
  const left = await H.visits(P.b);
  check("opening a page from the panel commits the pending delete first (that day's visits of Tin bath gone)", !H.store().pending && left.every((d) => d < pend.ranges[0].begin || d > pend.ranges[0].end), { pending: !!H.store().pending, left, range: pend?.ranges[0] });
  await H.close();
  for (const t of [...b.tabs]) if (t !== first) b.closeTab(t);
  await sleep(300);

  // ---- 8. split view ----
  log("--- 8. split view");
  b.activate(first);
  await H.load(H.http("start.html"), first);
  const other = b.newTab(H.http("a.html"), { background: true });
  await until(() => !other.loading && other.url === H.http("a.html"), 8000);
  await sleep(300);
  const pair = b.split(other);
  await until(() => b.splitView.showing?.() ?? !!pair, 4000);
  await sleep(800);
  b.activate(other);
  await sleep(500);
  if (pair && b.pairOf(first)) {
    await reopen();
    H.click(H.row("Slow light").el.querySelector(".vh-title"));
    await until(() => other.url === P.d, 5000);
    await sleep(500);
    check("in split view, a click loads into the focused side; the other side stays", other.url === P.d && first.url === H.http("start.html") && !!b.pairOf(first), { focused: other.url, otherSide: first.url });
    await reopen();
    const k = b.tabs.length;
    H.click(H.row("Annealing lehr").el.querySelector(".vh-title"), { ctrlKey: true });
    await until(() => b.tabs.length === k + 1, 4000);
    await sleep(300);
    const added = b.tabs.find((t) => t.url === P.c);
    check("new tabs open after the pair", !!added && b.tabs.indexOf(added) > Math.max(b.tabs.indexOf(first), b.tabs.indexOf(other)), b.tabs.map((t) => t.url));
    await H.close();
  } else check("a split could be made for the test", false);
});
