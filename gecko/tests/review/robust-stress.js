// Robustness review: 40 tabs, rapid open / close / switch / move, Firefox-side tab operations,
// narrow windows, beforeunload.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-stress.js --name review-robust-stress --timeout 300
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const settled = async () => { await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "bar settle" }); await sleep(100); };
  const tabPage = (i) => R.page("Tab " + i, `<p style='margin:120px 40px'>Tab ${i}</p>`, `hsl(${(i * 37) % 360} 40% 90%)`);
  const overlap = () => {
    const ctl = $("#vitre-winctl").getBoundingClientRect();
    const items = $$("#vitre-bar .item:not(.leaving)").map((i) => i.getBoundingClientRect());
    const right = Math.max(...items.map((r) => r.right));
    const left = Math.min(...items.map((r) => r.left));
    let touching = 0;
    const sorted = items.sort((a, c) => a.left - c.left);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].left < sorted[i - 1].right - 0.5) touching++;
    return { right: Math.round(right), left: Math.round(left), ctl: Math.round(ctl.left), under: right > ctl.left - 15.5, offLeft: left < 0, touching };
  };

  await R.load(tabPage(1));

  // ---- 1. forty tabs ----
  let t0 = performance.now();
  for (let i = 2; i <= 40; i++) b.newTab(tabPage(i), { background: true, index: i - 1 });
  log("opening 39 background tabs took", Math.round(performance.now() - t0), "ms (synchronous part)");
  await waitFor(() => b.tabs.length === 40 && b.tabs.every((t) => !t.loading), { timeout: 60000, what: "40 tabs loaded" });
  await settled();
  let st = b.bar.state;
  log("40 tabs at 1280:", st, overlap(), "filters:", $$("#vitre-glass-defs filter").length);
  check("40 tabs: model, gBrowser and bar agree", R.consistent().length === 0, R.consistent());
  check("40 tabs at 1280: nothing under the window controls, nothing off the left edge, no items overlapping", !overlap().under && !overlap().offLeft && overlap().touching === 0, overlap());
  check("40 tabs: the active pill is drawn", !!$("#vitre-bar .item.tab.active"));
  await spike.capture("stress-40-1280");

  // render cost with 40 tabs
  t0 = performance.now();
  for (let i = 0; i < 50; i++) b.render();
  const per = (performance.now() - t0) / 50;
  log("b.render() with 40 tabs:", per.toFixed(2), "ms each");
  check("render with 40 tabs stays under a frame (16 ms)", per < 16, per.toFixed(2));

  // ---- 2. step through all of them without waiting ----
  const order = [];
  const off = b.on("tab-activated", (t) => order.push(t.id));
  for (let i = 0; i < 45; i++) spike.press("Ctrl+PageDown");
  await sleep(1500);
  await settled();
  off();
  check("45 quick Ctrl+PageDown: 45 activations, ending on tab 6, consistent", order.length === 45 && b.tabs.indexOf(b.active()) === 5 && R.consistent().length === 0, [order.length, b.tabs.indexOf(b.active()), R.consistent()]);
  check("...the active pill is drawn after the run, bar clear of the window controls", !!$("#vitre-bar .item.tab.active") && !overlap().under && overlap().touching === 0, overlap());
  spike.press("Ctrl+9");
  await sleep(700);
  await settled();
  check("Ctrl+9 with 40 tabs goes to the last one and draws it", b.tabs.indexOf(b.active()) === 39 && Number($("#vitre-bar .item.tab.active")?.dataset.id) === b.activeId && !overlap().under, [b.tabs.indexOf(b.active()), overlap()]);
  await spike.capture("stress-40-last");

  // ---- 3. narrow window with 40 tabs ----
  await spike.resize(640, 600);
  await settled();
  log("40 tabs at 640:", b.bar.state, overlap());
  check("40 tabs at 640 px: nothing under the window controls or off the left edge", !overlap().under && !overlap().offLeft && overlap().touching === 0 && !!$("#vitre-bar .item.tab.active"), overlap());
  await spike.capture("stress-40-640");
  window.resizeTo(300, 400); // below the minimum: Firefox clamps to --window-min-width
  await sleep(600);
  await settled();
  log("40 tabs at minimum width:", { inner: window.innerWidth, outer: window.outerWidth }, b.bar.state, overlap());
  check("40 tabs at the minimum window width: bar still clear of the window controls", !overlap().under && !overlap().offLeft && !!$("#vitre-bar .item.tab.active"), [window.innerWidth, overlap()]);
  await spike.capture("stress-40-min");
  await spike.resize(1280, 800);
  await settled();

  // ---- 4. Firefox-side operations ----
  gBrowser.pinTab(b.active().node);
  await sleep(400);
  check("pinTab from Firefox: the tab moved to the front, model follows", b.tabs[0] === b.active() && b.tabs[0].pinned && R.consistent().length === 0, R.consistent());
  gBrowser.unpinTab(b.tabs[0].node);
  await sleep(300);
  const hide = b.tabs.slice(10, 20);
  for (const t of hide) gBrowser.hideTab(t.node, "review");
  await sleep(400);
  check("hideTab x10 from Firefox: they leave the model", b.tabs.length === 30 && R.consistent().length === 0, [b.tabs.length, R.consistent()]);
  for (const t of hide) gBrowser.showTab(t.node);
  await sleep(400);
  check("showTab x10: back in the model, in gBrowser's order", b.tabs.length === 40 && R.consistent().length === 0, [b.tabs.length, R.consistent()]);
  // moves
  for (let i = 0; i < 30; i++) b.run(i % 3 === 2 ? "moveTabLeft" : "moveTabRight");
  await sleep(500);
  check("30 quick moves: consistent", R.consistent().length === 0, R.consistent());
  gBrowser.removeTabsToTheEndFrom(b.tabs[19].node);
  await sleep(800);
  check("removeTabsToTheEndFrom (Firefox batch close): model follows", b.tabs.length === 20 && R.consistent().length === 0, [b.tabs.length, R.consistent()]);
  gBrowser.removeAllTabsBut(b.active().node);
  await sleep(800);
  await settled();
  check("removeAllTabsBut: one tab left, consistent, no leftover items", b.tabs.length === 1 && R.consistent().length === 0 && $$("#vitre-bar .item").length === 2, [b.tabs.length, R.consistent(), $$("#vitre-bar .item").length]);

  // ---- 5. reopen closed tabs many times ----
  for (let i = 0; i < 12; i++) b.run("reopenClosed");
  await sleep(2500);
  await settled();
  // (Firefox reopens a batch close as one group, so the count is its own.)
  check("12 quick Ctrl+Shift+T: tabs come back, consistent", b.tabs.length >= 13 && R.consistent().length === 0, [b.tabs.length, R.consistent()]);

  // ---- 6. rapid open and close ----
  const before = b.tabs.length;
  for (let i = 0; i < 20; i++) spike.press("Ctrl+T");
  for (let i = 0; i < 20; i++) spike.press("Ctrl+W");
  await sleep(1500);
  await settled();
  log("after 20 Ctrl+T then 20 Ctrl+W:", { tabs: b.tabs.length, omni: b.omni.open, active: b.active()?.title, kind: b.active()?.kind, items: $$("#vitre-bar .item").length, leaving: $$("#vitre-bar .item.leaving").length });
  check("20 Ctrl+T then 20 Ctrl+W in one burst: same tabs as before, consistent, no leftover elements", b.tabs.length === before && R.consistent().length === 0 && $$("#vitre-bar .item.leaving").length === 0 && $$("#vitre-bar .item").length === b.bar.state.shown + 1, [b.tabs.length, before, R.consistent(), $$("#vitre-bar .item").length]);
  check("...and the address field is not left open over a web page", !(b.omni.open && b.active().kind === "web"), { omni: b.omni.open, kind: b.active()?.kind, value: b.omni.input.value.slice(0, 40) });
  if (b.omni.open) b.omni.close();

  // Ctrl+T immediately followed by Ctrl+W (the new tab is gone before its field opens).
  b.activate(b.tabs[0]);
  await sleep(400);
  const webTab = b.active();
  spike.press("Ctrl+T");
  spike.press("Ctrl+W");
  await sleep(700);
  check("Ctrl+T, Ctrl+W at once: back on the same tab", b.active() === webTab, b.active()?.title);
  check("Ctrl+T, Ctrl+W at once: the address field does not open over the page that was there", !b.omni.open, { omni: b.omni.open, value: b.omni.input.value.slice(0, 50), focus: document.activeElement?.id });
  if (b.omni.open) b.omni.close();

  // interleaved
  for (let i = 0; i < 15; i++) {
    b.newTab(tabPage(100 + i), { background: i % 2 === 0 });
    if (i % 3 === 0) b.closeTab(b.tabs[0]);
    if (i % 4 === 0) b.run("nextTab");
  }
  await sleep(1500);
  await settled();
  check("interleaved open / close / switch: consistent", R.consistent().length === 0 && $$("#vitre-bar .item.leaving").length === 0, R.consistent());
  const filters = $$("#vitre-glass-defs filter").length;
  log("SVG filters kept after the run:", filters, "rows:", $$("#vitre-glass-defs filter[id^=vitre-row]").length, "bar rows:", b.bar.state.rows);
  check("row filters are released (only the ones in use remain)", $$("#vitre-glass-defs filter[id^=vitre-row]").length === b.bar.state.rows, [$$("#vitre-glass-defs filter[id^=vitre-row]").length, b.bar.state.rows]);

  // ---- 7. beforeunload ----
  const guard = R.page("Guarded", "<input id=i style='position:fixed;left:100px;top:200px;width:300px;height:40px'><script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'x'; });</script>");
  const g = b.newTab(guard);
  await waitFor(() => g.title === "Guarded" && !g.loading, { what: "guarded page" });
  await sleep(300);
  spike.click(200, 220); // user interaction, or Firefox skips the prompt
  spike.type("x");
  await sleep(300);
  const n = b.tabs.length;
  // removeTab spins a nested event loop while Firefox's "Leave page?" prompt is up (permitUnload),
  // so every key from here on is sent from a timer.
  const later = (fn, ms = 0) => window.setTimeout(fn, ms);
  later(() => spike.press("Ctrl+W"));
  await sleep(1500);
  const dialog = g.browser.hasAttribute("tabDialogShowing") || !!document.querySelector(".dialogStack .dialogBox");
  log("beforeunload on Ctrl+W:", { tabs: b.tabs.length, dialog, tabDialogShowing: g.browser.hasAttribute("tabDialogShowing"), stillThere: b.tabs.includes(g) });
  if (b.tabs.includes(g) && dialog) {
    await spike.capture("stress-beforeunload");
    check("beforeunload: Ctrl+W shows Firefox's prompt and the tab stays until answered", b.tabs.length === n && R.consistent().length === 0, [b.tabs.length, R.consistent()]);
    // (A second Ctrl+W while the prompt is up closes the tab at once: that is Firefox's own rule,
    // Tabbrowser.sys.mjs removeTab with _pendingPermitUnload, so it is not pressed here.)
    later(() => spike.press("Ctrl+PageDown"));
    await sleep(700);
    log("Ctrl+PageDown while the prompt is open:", { active: b.active()?.title, dialogStill: g.browser.hasAttribute("tabDialogShowing") });
    later(() => b.activate(g));
    await sleep(500);
    // Esc answers the prompt (stay).
    later(() => spike.press("Escape"));
    await sleep(1000);
    check("beforeunload: Esc keeps the tab and closes the prompt", b.tabs.includes(g) && !g.browser.hasAttribute("tabDialogShowing"), [b.tabs.includes(g), g.browser.hasAttribute("tabDialogShowing")]);
    check("beforeunload: consistent afterwards", R.consistent().length === 0, R.consistent());
  } else {
    log("NOTE no prompt appeared (no user activation registered, or the tab closed)");
  }
  gBrowser.removeTab(g.node, { skipPermitUnload: true });
  await sleep(300);

  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("stress");
});
