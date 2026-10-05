// Robustness review 2: memory and listener leaks with every feature.
//   python tests/review2/run.py leaks
// 1. In one window, each feature is opened and closed 25 times: the event listeners on window,
//    document, #vitre-root, the tab container and the page's <browser> (nsIEventListenerService), the
//    nodes under #vitre-root, the hidden tabs and the singletons' subscriber sets must not grow.
// 2. Three windows that used every feature are closed: each is collected (weak references only) and
//    the singletons' per-window state (VitreShell.windows, the downloads engine's listeners and quit
//    prompts, the media watch's listeners, observer-service topics) is back where it started.
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 820);
  await spike.activate();
  await W.installExt(["popup", "pin1"]);
  const engine = b.sys("VitreDownloads");
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  const els = Cc["@mozilla.org/eventlistenerservice;1"].getService(Ci.nsIEventListenerService);
  const listenerCount = (target) => {
    try {
      return els.getListenerInfoFor(target).length;
    } catch {
      return -1;
    }
  };
  const TOPICS = ["sessionstore-closed-objects-changed", "browser-delayed-startup-finished", "quit-application-requested", "last-pb-context-exiting", "nsPref:changed", "domwindowclosed", "xul-window-visible", "browser-window-before-show", "PopupNotifications-updateNotShowing", "network:offline-status-changed", "sessionstore-windows-restored", "window-global-created", "http-on-modify-request", "console-api-log-event"];
  const observers = () => Object.fromEntries(TOPICS.map((t) => [t, [...Services.obs.enumerateObservers(t)].length]));
  const singletons = () => ({
    shellWindows: Shell.windows.size,
    engineListeners: engine.listeners?.size ?? -1,
    mediaListeners: engine.media?.listeners?.size ?? -1,
    prompts: engine.prompts?.size ?? -1,
  });

  // ---- 1. repeat each feature in one window ----
  const tab = await W.load(window, b.active(), W.P("leak-main", "n=8"));
  await W.open(window, W.P("leak-2"), { background: true });
  await W.open(window, W.P("leak-3"), { background: true });
  b.activate(tab);
  await sleep(400);
  const snapshot = () => ({
    window: listenerCount(window),
    document: listenerCount(document),
    root: listenerCount(b.root),
    tabContainer: listenerCount(gBrowser.tabContainer),
    browser: listenerCount(b.active().browser),
    rootNodes: b.root.getElementsByTagName("*").length,
    hidden: [...gBrowser.tabs].filter((t) => t.hidden).length,
    ...singletons(),
  });
  const cycles = {
    peek: async (i) => {
      await W.openPeek(window, W.P("leak-peek-" + (i % 4)));
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).peek, { timeout: 4000 });
    },
    "peek+find+promote": async (i) => {
      await W.openPeek(window, W.P("leak-pp-" + i));
      await W.openFind(window, "glass");
      W.key(window, "KEY_Escape");
      await sleep(300);
      b.service("peek").promote();
      await sleep(700);
      b.closeTab(b.active());
      b.activate(tab);
      await sleep(300);
    },
    find: async () => {
      b.focusPage();
      await W.openFind(window, "glass");
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).find, { timeout: 4000 });
    },
    menu: async () => {
      await W.pageMenu(window);
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).menu, { timeout: 4000 });
    },
    downloads: async () => {
      await W.openDownloads(window);
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).downloads, { timeout: 4000 });
    },
    settings: async (i) => {
      b.service("settings").open(["general", "appearance", "home", "tabs", "downloads", "privacy", "search", "shortcuts", "about", "extensions"][i % 10]);
      await waitFor(() => W.layers(window).settings, { timeout: 4000 });
      await sleep(250);
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).settings, { timeout: 4000 });
    },
    switcher: async () => {
      await W.openSwitcher(window);
      W.key(window, "KEY_Escape");
      await waitFor(() => !W.layers(window).switcher, { timeout: 4000 });
    },
    omni: async () => {
      await W.openOmni(window);
      W.EU(window).sendString("glass", window);
      await sleep(250);
      // The first Esc reverts the typed text, the second closes the field.
      await W.unwind(window, 3, 300);
      await waitFor(() => !W.layers(window).omni, { timeout: 4000 });
    },
    "extensions panel": async () => {
      b.service("extensions")?.openPanel();
      await sleep(500);
      window.CustomizableUI?.hidePanelForNode?.(document.getElementById("unified-extensions-panel"));
      document.getElementById("unified-extensions-panel")?.hidePopup?.();
      await sleep(300);
    },
  };
  const growth = {};
  for (const [name, fn] of Object.entries(cycles)) {
    // Two warm-up rounds: first-use caches and lazily built DOM are not leaks.
    for (let i = 0; i < 2; i++) await fn(i).catch((e) => log(`${name} warm-up: ${e}`));
    await sleep(600);
    await W.gc();
    const before = snapshot();
    let errors = 0;
    for (let i = 0; i < 25; i++) {
      try {
        await fn(i + 2);
      } catch (e) {
        errors++;
        if (errors < 3) log(`${name} round ${i}: ${e}`);
        await W.unwind(window, 6, 300);
      }
    }
    await sleep(900);
    await W.gc();
    const after = snapshot();
    const grew = Object.fromEntries(Object.keys(before).filter((k) => after[k] > before[k]).map((k) => [k, after[k] - before[k]]));
    growth[name] = { grew, errors };
    log(`cycle ${name}`, { before, after, grew, errors });
  }
  for (const [name, g] of Object.entries(growth)) {
    // Allow a little slack on DOM nodes (a tooltip, a cached view); 25 rounds that leak show 25+.
    const bad = Object.entries(g.grew).filter(([k, d]) => (k === "rootNodes" ? d > 12 : d >= 5));
    check(`25 x ${name}: nothing grows with each round`, bad.length === 0 && g.errors === 0, g);
  }
  W.consoleDump("cycles");

  // ---- 2. windows that used everything are collected ----
  await W.gc();
  const base = { ...singletons(), obs: observers() };
  async function useAndClose(options) {
    let w = await spike.openWindow(options);
    const refs = {
      document: Cu.getWeakReference(w.document),
      vitre: Cu.getWeakReference(w.vitre),
      find: Cu.getWeakReference(w.vitreFind || {}),
      menus: Cu.getWeakReference(w.vitreMenus || {}),
      store: Cu.getWeakReference(w.vitreDownloads?.store || {}),
      thumbs: Cu.getWeakReference(w.vitreSwitcher?.thumbs || {}),
      settings: Cu.getWeakReference(w.vitreSettingsPanel?.panel || {}),
      extbar: Cu.getWeakReference(w.vitreExtensions?.bar || {}),
    };
    await w.spike.resize(1100, 720);
    await w.spike.activate();
    try {
      const t = await W.load(w, w.vitre.active(), W.P("leakwin"));
      await W.open(w, W.P("leakwin-2"), { background: true });
      await W.openPeek(w, W.P("leakwin-peek"));
      await W.openFind(w, "glass");
      await W.pageMenu(w, w.vitre.service("peek").browser());
      W.key(w, "KEY_Escape");
      await sleep(300);
      await W.unwind(w);
      w.vitre.service("downloads").download(W.url("file?size=300000&rate=300000&name=leakwin.bin"), { browser: t.browser });
      await W.openDownloads(w);
      await W.unwind(w);
      await W.openSettings(w);
      await W.unwind(w);
      await W.openSwitcher(w);
      await W.unwind(w);
      await W.openOmni(w);
      w.spike.type("leak");
      await sleep(400);
      await W.unwind(w);
      w.vitre.service("extensions")?.openPanel();
      await sleep(600);
      w.document.getElementById("unified-extensions-panel")?.hidePopup?.();
      // Leave a warm peek and a parked find behind on purpose.
      await W.openPeek(w, W.P("leakwin-warm"));
      W.key(w, "KEY_Escape");
      await sleep(600);
      w.vitre.focusPage();
      await W.openFind(w, "glass");
      w.vitre.focusPage();
      await sleep(300);
    } catch (e) {
      log("window use failed: " + e);
    }
    w.close();
    await waitFor(() => w.closed, { timeout: 5000 }).catch(() => null);
    w = null;
    await sleep(400);
    return refs;
  }
  const all = [];
  all.push(["normal window 1", await useAndClose({})]);
  all.push(["private window", await useAndClose({ private: true })]);
  all.push(["normal window 2", await useAndClose({})]);
  await sleep(1500);
  await W.gc();
  await sleep(3000);
  await W.gc();
  // A broadcast after the windows are gone: a listener that survived would throw or resurrect state.
  const S = b.sys("VitreSettings");
  S.set({ switcherStyle: "grid" });
  await sleep(200);
  S.set({ switcherStyle: "deck" });
  await sleep(300);
  await W.gc();
  for (const [name, refs] of all) {
    const alive = Object.entries(refs).filter(([, r]) => r.get() !== null).map(([k]) => k);
    check(`${name} that used every feature is collected after close`, alive.length === 0, "still reachable: " + alive.join(", "));
  }
  const now = { ...singletons(), obs: observers() };
  log("singletons before/after the windows", { base, now });
  // One more observer on a topic after three windows is a lazy service starting once; one per window is a leak.
  const grownObs = Object.keys(base.obs).filter((k) => now.obs[k] - base.obs[k] >= 3).map((k) => `${k}: ${base.obs[k]} -> ${now.obs[k]}`);
  log("observer counts that changed", Object.keys(base.obs).filter((k) => now.obs[k] !== base.obs[k]).map((k) => `${k}: ${base.obs[k]} -> ${now.obs[k]}`));
  check("singletons hold nothing for closed windows (shell windows, engine listeners and prompts, media listeners)", now.shellWindows === base.shellWindows && now.engineListeners === base.engineListeners && now.prompts === base.prompts && now.mediaListeners === base.mediaListeners, { base, now });
  check("observer-service topics are back to where they were", grownObs.length === 0, grownObs);
  W.consoleDump("windows");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
});
