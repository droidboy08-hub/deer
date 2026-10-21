// Split view after a restart (../design/SPLIT-VIEW-SPEC.md "Edge cases": After a restart; Build notes
// spike S3): pairs, their focused side and ratio come back, also for a pair that was in the background
// (its tabs load lazily, both when the pair is first shown); a window under 648 px restores collapsed.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.activate();

  if (spike.run === 1) {
    await spike.resize(1440, 900);
    const [, tl, ln, , d2] = await SL.scene(["dark.html", "links.html", "light.html?two", "dark.html?two"]);
    b.split(tl);
    await SL.shown();
    b.splitRatio(undefined, 0.35);
    b.activate(ln);
    await sleep(300);
    b.split(d2);
    await SL.shown();
    b.splitRatio(undefined, 0.7);
    b.activate(d2);
    await sleep(300);
    // Pair A shows with its right side focused; pair B goes to the background with its right side last used.
    b.activate(tl);
    await SL.shown();
    await sleep(500);
    check("before: two pairs, A = Field Notes | Tideline (0.35, right focused), B = Links | dark two (0.7)", b.splitView.pairs().length === 2 && b.active() === tl && b.splitRatio() === 0.35 && b.splitRatio(d2) === 0.7, { order: b.tabs.map((t) => t.title), ratio: b.splitRatio() });
    await spike.capture("restore-1-before");
    // Let SessionStore write the pairs and the tab values.
    window.SessionStore.getWindowState(window);
    await sleep(2500);
    await spike.resize(620, 760);
    await sleep(800);
    log("restarting");
    await spike.restart();
    return;
  }

  await SL.until(() => b.tabs.length === 5 && b.splitView.pairs().length === 2, 30000);
  await sleep(1500);
  log("restored", b.tabs.map((t) => ({ title: t.title, deferred: t.deferred, active: t.id === b.activeId })), "pairs", b.splitView.pairs().map((p) => [p.left.title, p.right.title]));
  const a = b.splitView.pairs()[0];
  const pb = b.splitView.pairs()[1];
  check("both pairs came back with their sides", a.left.title === "Field Notes" && a.right.title === "Tideline" && pb.left.title === "Links" && pb.right.url === http("dark.html?two"), b.splitView.pairs().map((p) => [p.left.title, p.right.title]));
  check("the focused side came back: Tideline (the right side of pair A) is active", b.active() === a.right, b.active()?.title);
  check("a window under 648 px restores collapsed", window.innerWidth < 648 && b.splitView.collapsed, { width: window.innerWidth, collapsed: b.splitView.collapsed });
  await spike.resize(1440, 900);
  await SL.until(() => !b.splitView.collapsed && SL.panes(), 5000);
  await SL.until(() => SL.loaded(a.left) && SL.loaded(a.right), 15000);
  await sleep(500);
  const area = gBrowser.tabpanels.getBoundingClientRect().width - 8;
  let panes = SL.panes();
  check("the shown pair's ratio came back (0.35), and both its sides loaded", b.splitRatio() === 0.35 && Math.abs(panes.left.w - Math.round(0.35 * area)) <= 1 && !a.left.deferred && !a.right.deferred, { ratio: b.splitRatio(), panes, deferred: [a.left.deferred, a.right.deferred] });
  check("the background pair's tabs wait unloaded (lazy)", pb.left.deferred && pb.right.deferred, [pb.left.deferred, pb.right.deferred]);
  check("the background pair is a capsule in the bar", !!document.querySelector(`#vitre-bar .item.pair:not(.active):not(.leaving)`));
  await spike.capture("restore-2-after");
  b.activate(pb.right);
  await SL.until(() => SL.loaded(pb.left) && SL.loaded(pb.right), 15000);
  await sleep(600);
  panes = SL.panes();
  check("showing the background pair loads both its sides, at its ratio (0.7)", !pb.left.deferred && !pb.right.deferred && b.splitRatio() === 0.7 && Math.abs(panes.left.w - Math.round(0.7 * area)) <= 1, { ratio: b.splitRatio(), panes });
  check("the restored pair works: Separate tabs", (b.separate(), !b.splitView.active()));
});
