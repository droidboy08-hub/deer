// Robustness review 2: edge cases between features (each found by looking for a state two features
// can be in at once).
//   python tests/review2/run.py edges
//  1. The downloads quit prompt asked while the latched switcher / a menu / Settings is up: is it
//     visible and does it get the keys?
//  2. A peek's page crashes: what the sheet shows, whether Reload brings it back, what find shows.
//  3. A page menu whose page crashed: running one of its rows.
//  4. The tab under a peek is closed by something else, or torn off to a new window, while the peek
//     is open: no orphan sheet, no hidden tab left.
//  5. A setting changed in one window while a surface that reads it is open in another.
//  6. An extension's popup (a native panel) open when Vitre's panels, find or the switcher open.
/* global spike, Services, gBrowser, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 820);
  await spike.activate();
  await W.installExt(["popup", "pin1"]);
  const engine = b.sys("VitreDownloads");
  const peek = b.service("peek");
  const find = b.service("find");
  const prompt = () => window.vitreDownloads.prompt;
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")].filter((w) => !w.closed);
  const A = await W.load(window, b.active(), W.P("edge-a", "n=8"));
  await W.open(window, W.P("edge-b"), { background: true });
  await W.open(window, W.P("edge-c"), { background: true });
  b.activate(A);
  await sleep(400);

  // ---- 1. the quit prompt over other surfaces ----
  b.service("downloads").download(W.url("file?size=200000000&rate=100000&name=edge.bin"), { browser: A.browser });
  await waitFor(() => engine.list(false).some((v) => v.state === "downloading" && v.received > 0), { timeout: 20000, what: "download" });
  const promptCase = async (name, open) => {
    b.focusPage();
    await sleep(200);
    await open();
    const before = W.fmt(W.layers(window));
    // What Exit, closing the last window or a restart ask (globalOverlay.js canQuitApplication).
    const allowed = window.canQuitApplication("lastwindow");
    await waitFor(() => prompt().isOpen, { timeout: 3000 }).catch(() => null);
    await sleep(500);
    const box = b.root.querySelector(".vd-quit");
    let hit = null;
    let visible = false;
    if (box) {
      const r = box.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      visible = !!at && box.contains(at);
      hit = at?.id || (typeof at?.className === "string" ? at.className : "") || at?.localName;
    }
    const focusIn = !!box && box.contains(document.activeElement);
    await capture("edges-1-prompt-" + name.replace(/\W+/g, "-"));
    // Tab inside the prompt moves between its two buttons; then Esc keeps downloading.
    W.key(window, "KEY_Tab");
    await sleep(200);
    const afterTab = { focusInBox: !!box && box.contains(document.activeElement), layers: W.fmt(W.layers(window)) };
    W.key(window, "KEY_Escape");
    await sleep(600);
    const res = { before, allowed, shown: !!box, visible, hit, focusIn, afterTab, afterEsc: W.fmt(W.layers(window)) };
    log("prompt over " + name, res);
    await W.unwind(window, 6, 400);
    if (prompt().isOpen) prompt().close();
    await sleep(400);
    return res;
  };
  const p1 = await promptCase("switcher", () => W.openSwitcher(window));
  const p2 = await promptCase("settings", () => W.openSettings(window));
  const p3 = await promptCase("downloads panel", () => W.openDownloads(window));
  const p4 = await promptCase("peek with find", async () => {
    await W.openPeek(window, W.P("edge-peek"));
    await W.openFind(window, "glass");
  });
  for (const [n, p] of [["the latched switcher", p1], ["Settings", p2], ["the Downloads panel", p3], ["a peek with find", p4]]) {
    check(`1. the quit prompt asked while ${n} is up is visible on top and has the keyboard`, p.shown && p.visible && p.focusIn && p.afterTab.focusInBox, p);
  }

  // ---- 2. a peek's page crashes ----
  b.activate(A);
  await sleep(300);
  await W.openPeek(window, W.X("edge-crash-peek"));
  await W.openFind(window, "glass");
  const pb0 = peek.browser();
  const pid = W.pidOf(pb0);
  W.kill(pid);
  // The sheet reloads the link into a fresh page ('tab-crashed', peek/index.ts crashed()).
  await waitFor(() => peek.isOpen() && !!peek.browser() && peek.browser() !== pb0 && peek.browser().contentTitle === "edge-crash-peek", { timeout: 15000 }).catch(() => null);
  await sleep(500);
  const pb = peek.browser();
  const c2 = { open: peek.isOpen(), fresh: !!pb && pb !== pb0, url: pb?.currentURI?.spec, remote: pb?.isRemoteBrowser, title: pb?.contentTitle, find: find.isOpen(), count: document.querySelector("#layer-find .vf-cap .vf-count")?.textContent };
  await capture("edges-2-peek-crashed");
  // Reload with the peek's page focused (page actions act on the focused peek).
  pb?.focus();
  await sleep(200);
  W.key(window, "r", { ctrlKey: true });
  await sleep(3000);
  c2.afterReload = { open: peek.isOpen(), url: peek.browser()?.currentURI?.spec, title: peek.browser()?.contentTitle };
  await capture("edges-2-peek-after-reload");
  log("peek crash", c2);
  check("2. a peek whose page crashed comes back by itself (a fresh page in the sheet) and Reload still works", c2.open && c2.fresh && c2.title === "edge-crash-peek" && c2.afterReload.title === "edge-crash-peek", c2);
  check("2. find in a crashed peek does not keep the dead page's count", !c2.find || !/of/.test(c2.count || ""), c2);
  // A page that crashes again at once: the sheet closes (no reload loop), nothing left on screen.
  const pb1 = peek.browser();
  if (pb1) W.kill(W.pidOf(pb1));
  await waitFor(() => !peek.isOpen(), { timeout: 10000 }).catch(() => null);
  await sleep(800);
  const c2b = { open: peek.isOpen(), layers: W.fmt(W.layers(window)), errors: W.vitreErrors() };
  log("peek crash again", c2b);
  check("2. a peek whose page crashes again within 30 s closes, nothing left behind", !c2b.open && c2b.layers === "none", c2b);
  await W.unwind(window, 6, 500);
  if (peek.isOpen()) peek.close();
  await sleep(800);

  // ---- 3. a page menu whose page crashed ----
  const C = await W.open(window, W.X("edge-crash-menu"));
  const link = await W.rectOf(window, C.browser, "#a1");
  W.rightClick(window, link.cx, link.cy);
  await waitFor(() => W.layers(window).menu, { timeout: 4000 }).catch(() => null);
  await sleep(300);
  const rows = window.vitreMenus.state().rows.map((r) => r.label);
  W.kill(W.pidOf(C.browser));
  await sleep(2000);
  const stillOpen = W.layers(window).menu;
  let ran = null;
  if (stillOpen) {
    const st = window.vitreMenus.state();
    const i = st.rows.findIndex((r) => /Peek link|Open link in new tab|Copy link/.test(r.label));
    if (i >= 0) {
      ran = st.rows[i].label;
      const el = window.vitreMenus.view.rowElement(i);
      const r = el.getBoundingClientRect();
      W.click(window, r.left + 40, r.top + r.height / 2);
      await sleep(1200);
    }
  }
  const c3 = { rows, stillOpenAfterCrash: stillOpen, ran, layers: W.fmt(W.layers(window)), errors: W.vitreErrors() };
  log("menu over a crashed page", c3);
  check("3. a page menu closes when its page crashes (context loss), or its rows still run without errors", !stillOpen || c3.errors.length === 0, c3);
  await W.unwind(window);
  b.closeTab(C);
  await sleep(500);

  // ---- 4. the tab under a peek goes away ----
  b.activate(A);
  await sleep(300);
  const src = await W.open(window, W.P("edge-src"));
  await W.openPeek(window, W.P("edge-src-peek"));
  b.closeTab(src);
  await sleep(1200);
  const c4a = { peek: peek.isOpen(), hidden: [...gBrowser.tabs].filter((t) => t.hidden).length, layers: W.fmt(W.layers(window)), left: W.leftovers(window), cons: W.consistent(window) };
  const src2 = await W.open(window, W.P("edge-src2"));
  await W.openPeek(window, W.P("edge-src2-peek"));
  const nWin = browsers().length;
  b.moveToNewWindow(src2);
  const torn = await waitFor(() => browsers().find((w) => w !== window && w.vitre?.ready && w.vitre.tabs.some((t) => t.url === W.P("edge-src2"))), { timeout: 10000 }).catch(() => null);
  await sleep(1500);
  const c4b = { peek: peek.isOpen(), hidden: [...gBrowser.tabs].filter((t) => t.hidden).length, layers: W.fmt(W.layers(window)), left: W.leftovers(window), cons: W.consistent(window), torn: !!torn, tornLayers: torn ? W.fmt(W.layers(torn)) : null, tornHidden: torn ? [...torn.gBrowser.tabs].filter((t) => t.hidden).length : null };
  await capture("edges-4-after-tear-off");
  log("peek source closed", c4a, "peek source torn off", c4b);
  check("4. closing the tab under a peek closes the peek; nothing left", !c4a.peek && c4a.left.length === 0 && c4a.cons.length === 0, c4a);
  check("4. tearing off the tab under a peek closes the peek; nothing left in either window", !c4b.peek && c4b.left.length === 0 && c4b.cons.length === 0 && c4b.tornLayers === "none", c4b);
  if (torn) {
    torn.close();
    await waitFor(() => torn.closed, { timeout: 5000 }).catch(() => null);
  }
  // After 60 s the warm peek is dropped: no hidden tab may stay for good.
  await sleep(62000);
  const hiddenLater = [...gBrowser.tabs].filter((t) => t.hidden).length;
  check("4. a minute later no hidden (peek) tab is left in the window", hiddenLater === 0, hiddenLater);

  // ---- 5. a setting changed in another window while a surface is open ----
  const w2 = await spike.openWindow();
  await w2.spike.resize(1000, 700);
  await W.open(w2, W.P("w2-b"), { background: true });
  await spike.activate();
  b.activate(A);
  await sleep(300);
  await W.openSwitcher(window);
  const swBefore = window.vitreSwitcher.state();
  b.sys("VitreSettings").set({ switcherStyle: "grid" });
  await sleep(1200);
  const swAfter = window.vitreSwitcher.state();
  await capture("edges-5-switcher-style-changed-while-open");
  const c5 = { before: { open: !!swBefore, style: swBefore?.style }, after: { open: b.service("switcher").isOpen(), style: swAfter?.style, phase: swAfter?.phase }, grid: b.root.classList.contains("vitre-switcher-grid") };
  // Keys in the switcher after its style changed under it: arrows, then Enter opens the selection.
  const errs0 = W.vitreErrors().length;
  for (const k of ["KEY_ArrowRight", "KEY_ArrowDown", "KEY_ArrowRight", "KEY_ArrowLeft"]) {
    W.key(window, k);
    await sleep(250);
  }
  const sel = window.vitreSwitcher.state()?.selected;
  W.key(window, "KEY_Enter");
  await sleep(900);
  c5.keys = { selected: sel, active: b.activeId, opened: b.activeId === sel, errors: W.vitreErrors().length - errs0, layers: W.fmt(W.layers(window)) };
  await W.unwind(window);
  await sleep(400);
  c5.left = W.leftovers(window);
  b.sys("VitreSettings").set({ switcherStyle: "deck" });
  await W.openSettings(window);
  // Auto-hide turned on from the other window while this one's Settings is open.
  w2.vitre.sys("VitreSettings").set({ barAutoHide: true });
  await sleep(1000);
  c5.autohideWhileSettings = { settings: W.layers(window).settings, barHidden: b.bar.hidden };
  await W.unwind(window);
  W.mouse(window, 600, 600, { type: "mousemove" });
  await sleep(1500);
  c5.barHidesAfter = b.bar.hidden;
  b.sys("VitreSettings").set({ barAutoHide: false });
  await sleep(500);
  log("settings changed elsewhere", c5);
  check("5. the switcher style changed while the switcher is open: its keys still work (Enter opens the selected card), nothing left behind", c5.left.length === 0 && c5.keys.errors === 0 && c5.keys.opened, c5);
  w2.close();
  await waitFor(() => w2.closed, { timeout: 5000 }).catch(() => null);

  // ---- 6. an extension's popup with Vitre's surfaces ----
  const ext = window.vitreExtensions;
  const widgetBtn = [...document.querySelectorAll("#vitre-root .accessories toolbarbutton, #vitre-root .accessories .toolbarbutton-1")].find((x) => /popup/i.test(x.id || x.getAttribute("label") || ""));
  log("extension button", widgetBtn?.id, widgetBtn?.getAttribute("label"));
  const c6 = {};
  for (const [name, open] of [["Ctrl+J", () => W.openDownloads(window)], ["Ctrl+,", () => W.openSettings(window)], ["Ctrl+F", () => W.openFind(window, "glass")], ["Ctrl+Shift+A", () => W.openSwitcher(window)]]) {
    if (!widgetBtn) break;
    widgetBtn.click();
    const panel = await waitFor(() => [...document.querySelectorAll("panel")].find((p) => p.state === "open" && /widget|webext|popup/i.test(p.id)), { timeout: 5000 }).catch(() => null);
    const pid = panel?.id;
    b.focusPage();
    await open().catch((e) => log(name + ": " + e));
    await sleep(500);
    c6[name] = { popup: pid, popupStillOpen: panel?.state === "open", layers: W.fmt(W.layers(window)) };
    await W.unwind(window, 6, 400);
    if (panel?.state === "open") panel.hidePopup();
    await sleep(500);
  }
  log("extension popup with Vitre surfaces", c6);
  check("6. an open extension popup gives way when a Vitre surface opens over it", Object.values(c6).every((v) => !v.popupStillOpen), c6);
  // ---- 7. a tab closed by something else while the switcher has its card selected ----
  const doomed = await W.open(window, W.P("edge-doomed"), { background: true });
  b.activate(A);
  await sleep(300);
  await W.openSwitcher(window);
  for (let i = 0; i < 6 && window.vitreSwitcher.state()?.selected !== doomed.id; i++) {
    W.key(window, "KEY_ArrowRight");
    await sleep(250);
  }
  const selectedDoomed = window.vitreSwitcher.state()?.selected === doomed.id;
  const errs7 = W.vitreErrors().length;
  b.closeTab(doomed);
  await sleep(700);
  const st7 = window.vitreSwitcher.state();
  W.key(window, "KEY_Enter");
  await sleep(900);
  const c7 = { selectedDoomed, afterClose: { open: b.service("switcher").isOpen(), selected: st7?.selected, list: st7?.list?.length }, active: b.active()?.url?.replace(W.base, "/"), layers: W.fmt(W.layers(window)), errors: W.vitreErrors().length - errs7, cons: W.consistent(window) };
  await W.unwind(window);
  log("switcher card's tab closed underneath", c7);
  check("7. the selected card's tab closed under the switcher: Enter opens a live tab, no error", c7.errors === 0 && c7.cons.length === 0 && c7.layers === "none" && !!c7.active, c7);

  // ---- 8. the extensions process crashes ----
  const info = await W.procs();
  const extProc = info.children.find((c) => c.type === "extension");
  const before8 = { count: b.service("extensions")?.count(), buttons: document.querySelectorAll("#vitre-root .accessories toolbarbutton").length };
  if (extProc) {
    W.kill(extProc.pid);
    await sleep(4000);
  }
  const after8 = { count: b.service("extensions")?.count(), buttons: document.querySelectorAll("#vitre-root .accessories toolbarbutton").length };
  await capture("edges-8-extension-process-crashed");
  // The cluster still answers: its menu and the panel.
  b.service("extensions")?.openPanel();
  await sleep(800);
  // With every extension pinned openPanel() opens Settings › Extensions instead (extensions/index.ts).
  const panelOpen = [...document.querySelectorAll("panel")].some((p) => p.state === "open") || W.layers(window).settings;
  document.getElementById("unified-extensions-panel")?.hidePopup?.();
  await W.unwind(window);
  log("extension process crash", { pid: extProc?.pid, before8, after8, panelOpen });
  check("8. after the extensions process crashes the cluster is still drawn and its panel (or Settings › Extensions) opens", after8.buttons >= 1 && panelOpen, { before8, after8, panelOpen });

  W.consoleDump("edges");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(500);
});
