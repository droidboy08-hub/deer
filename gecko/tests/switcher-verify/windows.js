// Switcher verification: several windows. Each window has its own switcher over its own tabs, keys
// in one never reach another, a window that loses focus cancels its switcher, a tab torn out while
// the switcher is up leaves cleanly, a popup window has no switcher, and a window closed with its
// switcher up is collected (weak references only) with no console errors.
// python tools/run.py --test tests/switcher-verify/windows.js --name swverify-windows --app build-switcher-verify --timeout 300
/* global spike, Services, Cu */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  const tabs1 = await V.openTabs(["One A", "One B", "One C"].map((n) => V.page(n, "#f4f1ea")));
  await V.visit([tabs1[2], tabs1[1], tabs1[0]]);

  // ---- 1. a second window has its own switcher ----
  log("--- second window");
  let w2 = await spike.openWindow();
  await w2.spike.resize(1100, 700);
  await w2.spike.activate();
  const tabs2 = await V.openTabs(["Two A", "Two B", "Two C", "Two D"].map((n) => V.page(n, "#dfe9f3")), w2);
  await V.visit([tabs2[3], tabs2[2], tabs2[1], tabs2[0]], w2);
  await V.holdOpen(1, { win: w2 });
  await sleep(600);
  const s2 = state(w2);
  const s1 = state(window);
  await w2.spike.capture("windows-second");
  await V.release(w2);
  check("second window: held Ctrl+Tab shows that window's four tabs only; the first window's switcher stays idle", s2.list.length === 4 && s1.phase === "idle" && V.active(w2) === "Two B" && V.active() === "One A", { s2: s2.list.length, s1: s1.phase, w2active: V.active(w2), w1active: V.active() });

  // ---- 2. losing focus to another window cancels ----
  await spike.activate();
  await V.latched("latched");
  const before = V.active();
  await w2.spike.activate();
  await sleep(500);
  check("latched switcher in window 1: activating window 2 cancels it back to the starting tab", state().phase === "idle" && V.active() === before, { phase: state().phase, active: V.active(), before });
  await spike.activate();
  await V.holdOpen(1);
  await w2.spike.activate();
  await sleep(500);
  up("Control");
  await sleep(300);
  check("held switcher in window 1: another window coming to the front cancels it (no switch on the late Ctrl release)", state().phase === "idle" && V.active() === before, { phase: state().phase, active: V.active() });
  await spike.activate();

  // ---- 3. a tab torn out of the window while the switcher is up ----
  log("--- tear-off under the switcher");
  await V.latched("latched");
  const n0 = b.tabs.length;
  const known = new Set(browsers());
  gBrowser.replaceTabWithWindow(tabs1[2].node);
  const w3 = await waitFor(() => browsers().find((w) => !known.has(w)), { timeout: 15000, what: "torn-off window" });
  await waitFor(() => w3.vitre?.ready, { timeout: 15000, what: "torn-off window ready" });
  await sleep(800);
  await spike.activate();
  await sleep(300);
  const st = state();
  log("after tear-off", { phase: st.phase, list: st.list, tabs: b.tabs.length });
  // Window 1 lost focus to the new window: its switcher cancelled; the model never holds a dead tab.
  check("a tab torn out while the switcher is up: window 1 keeps a consistent model; the switcher holds no dead tab", b.tabs.length === n0 - 1 && V.consistent().length === 0 && (st.phase === "idle" || st.list.every((id) => b.tab(id))), { tabs: b.tabs.length, consistent: V.consistent(), st });
  if (state().phase !== "idle") {
    press("Escape");
    await V.closed();
  }
  w3.close();
  await sleep(500);

  // ---- 4. a popup window has no switcher ----
  log("--- popup window");
  const opener = V.page("Opener", "#fff", `<button id=a style='position:fixed;left:100px;top:200px;width:200px;height:80px' onclick="window.open('https://example.com/?popped','n','width=520,height=420')">open</button>`);
  b.navigate(b.active(), opener);
  await V.loaded(b.active());
  await sleep(500);
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  const known2 = new Set(browsers());
  spike.click(200, 240);
  const pop = await waitFor(() => browsers().find((w) => !known2.has(w)), { timeout: 15000, what: "popup window" }).catch(() => null);
  if (pop) {
    await waitFor(() => pop.vitre?.ready, { timeout: 15000, what: "popup ready" });
    await pop.spike.activate();
    await sleep(800);
    const pv = pop.vitre;
    log("popup", { isPopup: pv.isPopup, tabs: pv.tabs.length, modules: pv.modules });
    down("Control", {}, pop);
    press("Tab", {}, pop);
    await sleep(400);
    const held = pop.vitreSwitcher?.state();
    up("Control", {}, pop);
    press("Shift+A", { ctrlKey: true }, pop);
    await sleep(400);
    const search = pop.vitreSwitcher?.state();
    pv.service("switcher")?.open("latched");
    await sleep(400);
    const svc = pop.vitreSwitcher?.state();
    const layer = pop.document.getElementById("layer-switcher");
    check("popup window: Ctrl+Tab, Ctrl+Shift+A and the service open nothing", pv.isPopup && held?.phase === "idle" && search?.phase === "idle" && svc?.phase === "idle" && (!layer || layer.children.length === 0), { isPopup: pv.isPopup, held, search, svc, layer: layer?.children.length });
    const ps = pop.vitreSwitcher?.thumbs.stats;
    check("popup window: nothing is pictured or written to disk there (it has no switcher)", !!ps && ps.captures === 0 && ps.saved === 0 && !pop.SessionStore.getCustomTabValue(pv.tabs[0].node, "vitre-thumb"), ps);
    await pop.spike.capture("windows-popup");
    pop.close();
    await sleep(500);
  } else check("popup window opened", false);
  Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
  await spike.activate();

  // ---- 5. a window closed with its switcher up is collected ----
  log("--- window closed with the switcher up");
  async function useAndClose(how) {
    let win = await spike.openWindow(how === "private" ? { private: true } : {});
    await win.spike.activate();
    const refs = { document: Cu.getWeakReference(win.document), browser: Cu.getWeakReference(win.vitre), thumbs: Cu.getWeakReference(win.vitreSwitcher.thumbs) };
    const v = win.vitre;
    v.navigate(v.active(), V.page("Leak 1", "#eee"));
    v.newTab(V.page("Leak 2", "#ddd"), { background: true });
    v.newTab(V.page("Leak 3", "#ccc"));
    await sleep(1200);
    for (const style of ["deck", "grid", "strip"]) {
      b.sys("VitreSettings").set({ switcherStyle: style });
      await sleep(150);
      await V.latched("latched", win);
      press("Escape", {}, win);
      await V.closed(win);
    }
    b.sys("VitreSettings").set({ switcherStyle: "deck" });
    await sleep(150);
    if (how === "held") {
      await V.holdOpen(1, { win });
      await sleep(300);
    } else {
      await V.latched("search", win);
      spike.EU.sendString("le", win);
    }
    await sleep(200);
    const open = state(win).phase;
    win.close();
    win = null;
    await sleep(500);
    if (how === "held") up("Control");
    return { refs, open };
  }
  const runs = [];
  for (const how of ["held", "latched", "private"]) runs.push({ how, ...(await useAndClose(how)) });
  await spike.activate();
  await sleep(1000);
  await V.gc();
  await sleep(1500);
  await V.gc();
  for (const r of runs) {
    const alive = Object.entries(r.refs).filter(([, ref]) => ref.get()).map(([k]) => k);
    check(`a ${r.how} window closed with its switcher open (${r.open}) is collected`, r.open === "open" && alive.length === 0, { alive, open: r.open });
  }
  check("windows left: only the first", browsers().length === 2 ? browsers().includes(w2) : browsers().length === 1, browsers().length);
  w2.close();
  w2 = null;
  await sleep(500);
  const c = V.consoleDump("windows");
  check("no console errors from Vitre across the windows", c.vitre === 0, c);
});
