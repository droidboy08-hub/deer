// Robustness review 2: restart with every feature busy, then content-process crashes under features.
//   python tests/review2/run.py session
// Run 1: 40 tabs (find open on the active one), a running download, a peek with find in it, Settings
//   and the latched switcher open; a second window with its own peek; a private window. Restart is
//   asked the way Firefox asks (canQuitApplication("restart")): the downloads prompt must show and be
//   visible above whatever is open; its Restart goes ahead.
// Run 2: what came back (windows, tabs, no peek tab anywhere, the download paused and resumable, every
//   feature usable), then content-process crashes: under a peek, under find, under a page menu, under
//   the switcher's card, under the downloads video mark; each feature must cope and the tab revive.
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, SessionStore, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  W.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  const engine = window.vitre.sys("VitreDownloads");

  if (spike.run === 1) {
    const b = window.vitre;
    const first = await W.load(window, b.active(), W.P("s-0"));
    for (let i = 1; i < 40; i++) b.newTab(W.P("s-" + i), { background: true });
    await waitFor(() => b.tabs.length === 40 && b.tabs.every((t) => !t.loading), { timeout: 90000, what: "40 tabs" });
    const active = b.tabs[5];
    b.activate(active);
    await sleep(600);
    b.focusPage();
    await W.openFind(window, "glass");
    check("run 1: find open on the active tab", W.layers(window).find);
    b.service("downloads").download(W.url("file?size=300000000&rate=100000&name=session.bin"), { browser: active.browser });
    await waitFor(() => engine.list(false).some((v) => v.filename.startsWith("session") && v.received > 2e6), { timeout: 30000, what: "2 MB downloaded" });
    await W.openPeek(window, W.P("s-peek"));
    await W.openFind(window, "glass");
    await W.openSettings(window);
    await W.openSwitcher(window);
    const l1 = W.fmt(W.layers(window));
    log("run 1 main window layers", l1);
    const w2 = await spike.openWindow();
    await w2.spike.resize(1000, 700);
    await W.load(w2, w2.vitre.active(), W.P("w2-0"));
    await W.open(w2, W.P("w2-1"), { background: true });
    await W.open(w2, W.P("w2-2"), { background: true });
    await w2.spike.activate();
    await W.openPeek(w2, W.P("w2-peek"));
    const pw = await spike.openWindow({ private: true });
    await W.load(pw, pw.vitre.active(), W.P("private-0"));
    await spike.activate();
    await sleep(500);
    log("before restart", { tabs: b.tabs.length, w2: w2.vitre.tabs.length, layers: l1, w2layers: W.fmt(W.layers(w2)), dl: engine.list(false).map((v) => [v.filename, v.state, v.received]) });

    const raw = SessionStore.getWindowState(window);
    const ssw = (typeof raw === "string" ? JSON.parse(raw) : raw).windows[0];
    log("before restart: selected", { gIndex: [...gBrowser.tabs].indexOf(gBrowser.selectedTab), url: gBrowser.selectedBrowser.currentURI.spec, ssSelected: ssw.selected, ssTabs: ssw.tabs.length, hiddenAt: ssw.tabs.map((t, i) => (t.hidden ? i : -1)).filter((i) => i >= 0) });
    Services.prefs.setStringPref("vitre.review2.selected", gBrowser.selectedBrowser.currentURI.spec);
    // Restart the way Firefox asks for it: refused while the download runs, the prompt asks.
    Services.prefs.savePrefFile(null);
    const allowed = window.canQuitApplication("restart");
    check("run 1: a restart is held back while a download runs", allowed === false, allowed);
    const prompt = await waitFor(() => browserWindows().find((x) => x.vitreDownloads?.prompt?.isOpen), { timeout: 5000, what: "a prompt" }).catch(() => null);
    check("run 1: the restart prompt shows in a window", !!prompt, browserWindows().length);
    if (prompt) {
      const box = prompt.vitre.root.querySelector(".vd-quit");
      const r = box.getBoundingClientRect();
      const hit = prompt.document.elementFromPoint(r.left + r.width / 2, r.top + 20);
      const visible = !!hit && box.contains(hit);
      log("the prompt is in", prompt === window ? "the first window" : "another window", "; the element at its centre:", hit?.id || hit?.className || hit?.tagName, "; layers there:", W.fmt(W.layers(prompt)));
      await prompt.spike.capture("session-1-restart-prompt");
      check("run 1: the restart prompt is on top of what is open (switcher, Settings, peek)", visible, { hit: hit?.className || hit?.tagName, layers: W.fmt(W.layers(prompt)) });
      // Click Restart through the DOM (a point click would land on whatever covers it).
      prompt.vitre.root.querySelector(".vd-q-go").click();
      await new Promise(() => {});
    }
    return;
  }

  // ---- run 2 ----
  await sleep(1500);
  const wins = browserWindows();
  const main = wins.find((w) => w.vitre?.tabs.length === 40) || window;
  const b = main.vitre;
  const w2 = wins.find((w) => w !== main);
  log("run 2", { windows: wins.length, main: b.tabs.length, w2: w2?.vitre.tabs.length, private: wins.filter((w) => w.vitre?.isPrivate).length });
  check("run 2: the two normal windows are back, the private one is not", wins.length === 2 && w2?.vitre.tabs.length === 3 && !wins.some((w) => w.vitre?.isPrivate), wins.map((w) => w.vitre?.tabs.length));
  const hidden = wins.flatMap((w) => [...w.gBrowser.tabs].filter((t) => t.hidden).map((t) => t.linkedBrowser.currentURI?.spec));
  check("run 2: no peek tab came back (none hidden, none in the bar)", hidden.length === 0 && !wins.some((w) => w.vitre.tabs.some((t) => /peek/.test(t.url))), { hidden, urls: wins.map((w) => w.vitre.tabs.filter((t) => /peek/.test(t.url)).map((t) => t.url)) });
  const closedTabs = wins.flatMap((w) => SessionStore.getClosedTabDataForWindow(w).map((c) => c.state?.entries?.[0]?.url || ""));
  check("run 2: no peek in the closed-tab lists", !closedTabs.some((u) => /peek/.test(u)), closedTabs);
  log("run 2 selected", { index: b.tabs.indexOf(b.active()), url: b.active()?.url, gIndex: [...main.gBrowser.tabs].indexOf(main.gBrowser.selectedTab), mru: b.mru.slice(0, 5).map((id) => b.tab(id)?.url.replace(W.base, "/")) });
  const wasSelected = Services.prefs.getStringPref("vitre.review2.selected", "");
  check("run 2: the main window's selected tab is the one selected before the restart", b.active()?.url === wasSelected, [b.active()?.url, wasSelected]);
  for (const w of wins) check(`run 2: ${w === main ? "main" : "second"} window consistent and clean`, W.consistent(w).length === 0 && W.leftovers(w).length === 0, [W.consistent(w), W.leftovers(w)]);
  const dl = engine.list(false).find((v) => v.filename.startsWith("session"));
  check("run 2: the download is back, paused, with its bytes", dl?.state === "paused" && dl.received > 2e6, dl && [dl.state, dl.received]);
  if (dl) {
    engine.resume(dl.id);
    const grew = await waitFor(() => engine.get(dl.id)?.state === "downloading" && engine.get(dl.id).received > dl.received + 1e6, { timeout: 30000, what: "resumed" }).then(() => true, () => false);
    check("run 2: Resume continues it", grew, engine.get(dl.id) && [engine.get(dl.id).state, engine.get(dl.id).received, dl.received]);
  }
  await main.spike.activate();
  await main.spike.capture("session-2-restored");

  // Every feature works in the restored window.
  b.focusPage();
  await sleep(300);
  await W.openFind(main, "glass");
  const findOk = W.layers(main).find;
  await W.unwind(main);
  await W.openPeek(main, W.P("s-peek-again"));
  const peekOk = W.layers(main).peek;
  await W.unwind(main);
  await W.openSwitcher(main);
  const swState = main.vitreSwitcher.state();
  await main.spike.capture("session-3-switcher");
  await W.unwind(main);
  await W.openSettings(main);
  await W.unwind(main);
  await W.openDownloads(main);
  await main.spike.capture("session-4-downloads");
  await W.unwind(main);
  log("restored features", { findOk, peekOk, switcher: swState?.list?.length });
  check("run 2: find, peek, switcher (40 cards), Settings and Downloads open and close", findOk && peekOk && swState?.list?.length === 40 && W.fmt(W.layers(main)) === "none", { findOk, peekOk, cards: swState?.list?.length, left: W.fmt(W.layers(main)) });
  W.consoleDump("restore");

  // ---- crashes ----
  const crash = async (label, browser) => {
    const pid = W.pidOf(browser);
    log(`crash ${label}: killing content process ${pid}`);
    if (!pid) return false;
    W.kill(pid);
    await sleep(2500);
    return true;
  };
  const peek = b.service("peek");
  const find = b.service("find");

  // A. under an open peek (with find in its header)
  log("--- crash A: peek");
  await W.openPeek(main, W.X("crash-peek"));
  await W.openFind(main, "glass");
  await crash("peek", peek.browser());
  const a = { layers: W.fmt(W.layers(main)), peekUrl: peek.browser()?.currentURI?.spec, selected: main.gBrowser.selectedTab.hidden };
  await main.spike.capture("session-5-crash-peek");
  log("after the peek's process crashed", a);
  const aSteps = await W.unwind(main, 6, 600);
  check("crash A: the peek's page crashed: no tab switch to the hidden tab, Esc still closes everything", !a.selected && W.fmt(W.layers(main)) === "none" && W.consistent(main).length === 0, { a, aSteps, cons: W.consistent(main) });

  // B. under find on the active tab
  log("--- crash B: find");
  const tb = await W.open(main, W.X("crash-find"));
  b.focusPage();
  await W.openFind(main, "glass");
  await crash("find", tb.browser);
  const bState = { layers: W.fmt(W.layers(main)), crashed: tb.crashed, url: tb.url };
  await main.spike.capture("session-6-crash-find");
  log("after the find page's process crashed", bState);
  W.key(main, "KEY_Escape");
  await sleep(500);
  b.focusPage();
  main.spike.press("Ctrl+R");
  const revived = await waitFor(() => !tb.crashed && !tb.loading && tb.url === W.X("crash-find"), { timeout: 15000 }).then(() => true, () => false);
  b.focusPage();
  await sleep(300);
  await W.openFind(main, "glass").catch(() => null);
  const counter = main.document.querySelector("#layer-find .vf-count, #layer-find [class*=count]")?.textContent ?? null;
  await main.spike.capture("session-7-find-after-revive");
  check("crash B: find copes with its page crashing; after Ctrl+R find works again", revived && find.isOpen(), { bState, revived, find: find.isOpen(), counter });
  await W.unwind(main);

  // C. under a page menu
  log("--- crash C: menu");
  await W.pageMenu(main, tb.browser);
  await crash("menu", tb.browser);
  const cState = { layers: W.fmt(W.layers(main)) };
  log("after the menu page's process crashed", cState);
  await W.unwind(main);
  check("crash C: the page menu closes (or Esc closes it) when its page crashes", W.fmt(W.layers(main)) === "none", cState);
  b.focusPage();
  main.spike.press("Ctrl+R");
  await waitFor(() => !tb.crashed && !tb.loading, { timeout: 15000 }).catch(() => null);

  // D. under the switcher (a card's page crashes while the switcher is up)
  log("--- crash D: switcher");
  const victim = b.tabs[6];
  b.activate(victim);
  await waitFor(() => !victim.deferred && !victim.loading, { timeout: 15000 }).catch(() => null);
  b.activate(tb);
  await sleep(500);
  await W.openSwitcher(main);
  await crash("switcher card", victim.browser);
  const dState = { layers: W.fmt(W.layers(main)), state: main.vitreSwitcher.state() };
  await main.spike.capture("session-8-crash-switcher");
  // Pick the crashed card: its tab opens on the crashed page.
  W.key(main, "KEY_Escape");
  await sleep(600);
  check("crash D: the switcher survives a card's page crashing", W.fmt(W.layers(main)) === "none" && W.consistent(main).length === 0, { dState: { layers: dState.layers }, cons: W.consistent(main) });

  // E. Downloads panel open while the page that started a download crashes
  log("--- crash E: downloads");
  const te = await W.open(main, W.X("crash-dl"));
  b.service("downloads").download(W.xurl("file?size=20000000&rate=200000&name=crash-dl.bin"), { browser: te.browser });
  await W.openDownloads(main);
  await crash("downloads source page", te.browser);
  const eDl = engine.list(false).find((v) => v.filename.startsWith("crash-dl"));
  log("download after its page crashed", eDl && [eDl.state, eDl.received]);
  await main.spike.capture("session-9-crash-downloads");
  await W.unwind(main);
  check("crash E: a download keeps going when its page's process crashes", !!eDl && (eDl.state === "downloading" || eDl.state === "queued"), eDl && eDl.state);

  W.consoleDump("crashes");
  check("no console errors from Vitre's code (restart and crashes)", W.vitreErrors().length === 0, W.vitreErrors());
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(500);
});

function browserWindows() {
  return [...Services.wm.getEnumerator("navigator:browser")].filter((w) => !w.closed);
}
