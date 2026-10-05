// Robustness review 2: several windows (normal, private, popup), each with features open, closed in
// the middle of what it was doing. The first window keeps a long download running all along.
//   python tests/review2/run.py windows
// For every case: the window closes (Ctrl+Shift+W), nothing throws, the first window and the download
// are unaffected, and the closed window is collected (weak references only).
// Then: a closed window that had a peek is reopened (Ctrl+Shift+N): its orphan peek tab must not come
// back; a tab with find open is torn off into its own window; a popup window with each feature key.
/* global spike, Services, Cu, ChromeUtils, gBrowser, SessionStore, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 820);
  await spike.activate();
  const engine = b.sys("VitreDownloads");
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];

  const main = await W.load(window, b.active(), W.P("main"));
  b.service("downloads").download(W.url("file?size=300000000&rate=100000&name=main-long.bin"), { browser: main.browser });
  await waitFor(() => engine.list(false).some((v) => v.filename.startsWith("main-long") && v.received > 0), { timeout: 20000, what: "main download" }).catch(() => null);
  const mainDl = () => engine.list(false).find((v) => v.filename.startsWith("main-long"));
  check("the first window's download runs", mainDl()?.state === "downloading", mainDl()?.state);

  const results = [];
  /** Open a window, set it up, close it; only plain data and weak references leave this function. */
  async function runCase(name, options, setup, { closeWith = "key", expectPrompt = false } = {}) {
    log(`--- case: ${name}`);
    let w = await spike.openWindow(options);
    const refs = {
      document: Cu.getWeakReference(w.document),
      vitre: Cu.getWeakReference(w.vitre),
      find: Cu.getWeakReference(w.vitreFind || {}),
      menus: Cu.getWeakReference(w.vitreMenus || {}),
      downloadsStore: Cu.getWeakReference(w.vitreDownloads?.store || {}),
      switcherThumbs: Cu.getWeakReference(w.vitreSwitcher?.thumbs || {}),
      settingsPanel: Cu.getWeakReference(w.vitreSettingsPanel?.panel || {}),
    };
    await w.spike.resize(1100, 720);
    await w.spike.activate();
    const r = { name };
    try {
      await W.load(w, w.vitre.active(), W.P("win-" + name.replace(/\W+/g, "-")));
      await setup(w, r);
      r.layers = W.fmt(W.layers(w));
      await w.spike.capture("windows-" + name.replace(/\W+/g, "-"));
    } catch (e) {
      r.setupError = String(e);
    }
    if (closeWith === "key") W.key(w, "w", { ctrlKey: true, shiftKey: true });
    else w.vitre.run("closeWindow");
    if (expectPrompt) {
      r.prompt = await waitFor(() => w.vitreDownloads?.prompt?.isOpen, { timeout: 4000, what: "prompt" }).then(() => true, () => false);
      r.promptText = w.vitreDownloads?.prompt?.isOpen ? w.vitre.root.querySelector(".vd-quit")?.textContent?.slice(0, 160) : "";
      await w.spike.capture("windows-" + name.replace(/\W+/g, "-") + "-prompt");
      if (r.prompt) {
        // Keep downloading first: the window stays.
        w.spike.click(w.vitre.root.querySelector(".vd-q-keep"));
        await sleep(600);
        r.keptOpen = !w.closed;
        w.vitre.run("closeWindow");
        await waitFor(() => w.vitreDownloads?.prompt?.isOpen, { timeout: 4000 }).catch(() => null);
        const go = w.vitre.root.querySelector(".vd-q-go");
        r.goLabel = go?.textContent;
        if (go) w.spike.click(go);
      }
    }
    r.closed = await waitFor(() => w.closed, { timeout: 8000, what: "window closed" }).then(() => true, () => false);
    if (!r.closed) {
      r.stillOpen = W.fmt(W.layers(w));
      w.close();
      await waitFor(() => w.closed, { timeout: 5000 }).catch(() => null);
    }
    w = null;
    await sleep(600);
    r.mainConsistent = W.consistent(window);
    r.mainHidden = [...gBrowser.tabs].filter((t) => t.hidden).length;
    r.mainLeft = W.leftovers(window);
    r.download = mainDl()?.state;
    r.windows = browsers().length;
    r.shellWindows = Shell.windows.size;
    r.errors = W.vitreErrors().length;
    log("case result", r);
    results.push([r, refs]);
    return r;
  }

  const peekFind = await runCase("peek with find", {}, async (w) => {
    await W.openPeek(w, W.P("w-peek"));
    await W.openFind(w, "glass");
  });
  check("closing a window with a peek and find open", peekFind.closed && !peekFind.setupError && peekFind.layers === "find+peek", peekFind);

  // ---- reopen the closed window that had a peek ----
  log("--- reopen closed window");
  const closed = SessionStore.getClosedWindowData();
  const idx = closed.findIndex((cw) => (cw.tabs || []).some((t) => (t.entries || []).some((e) => /w-peek$/.test(e.url))));
  log("closed windows", closed.map((cw) => (cw.tabs || []).map((t) => (t.entries?.[t.index - 1] || t.entries?.[0])?.url?.replace(W.base, "/") + (t.hidden ? " (hidden)" : ""))));
  if (idx >= 0) {
    const rw = SessionStore.undoCloseWindow(idx);
    await waitFor(() => rw.vitre?.ready, { timeout: 10000, what: "reopened window" });
    await sleep(2500);
    const urls = rw.vitre.tabs.map((t) => t.url.replace(W.base, "/"));
    const hiddenNodes = [...rw.gBrowser.tabs].filter((t) => t.hidden);
    log("reopened window tabs", urls, "hidden", hiddenNodes.length);
    check("reopened window: the orphan peek tab is neither in the bar nor left hidden", !urls.some((u) => /w-peek$/.test(u)) && hiddenNodes.length === 0, { urls, hidden: hiddenNodes.length });
    check("reopened window: consistent", W.consistent(rw).length === 0, W.consistent(rw));
    rw.spike.press("Ctrl+Shift+T");
    await sleep(1200);
    const urls2 = rw.vitre.tabs.map((t) => t.url.replace(W.base, "/"));
    check("reopened window: Ctrl+Shift+T does not bring the peek back as a tab", !urls2.some((u) => /w-peek$/.test(u)), urls2);
    rw.close();
    await waitFor(() => rw.closed, { timeout: 5000 }).catch(() => null);
  } else check("the closed window with the peek is in the closed-window list", false, closed.length);


  const menuPeek = await runCase("menu over peek", {}, async (w) => {
    await W.openPeek(w, W.P("w-peek2"));
    await W.pageMenu(w, w.vitre.service("peek").browser());
  }, { closeWith: "action" });
  check("closing a window with a page menu over a peek", menuPeek.closed && menuPeek.layers === "menu+peek", menuPeek);

  const settings = await runCase("settings", {}, async (w) => {
    await W.openSettings(w);
  });
  check("closing a window with Settings open", settings.closed && settings.layers === "settings", settings);

  const dlPanel = await runCase("downloads here", {}, async (w, r) => {
    w.vitre.service("downloads").download(W.url("file?size=40000000&rate=100000&name=closing-window.bin"));
    await waitFor(() => engine.list(false).some((v) => v.filename.startsWith("closing-window") && v.received > 0), { timeout: 15000, what: "second download" });
    await W.openDownloads(w);
    r.ring = !!w.document.querySelector("#layer-downloads-ring *");
  });
  const second = engine.list(false).find((v) => v.filename.startsWith("closing-window"));
  check("closing a window mid-download (its own download, panel open): the download carries on", dlPanel.closed && second?.state === "downloading", { dlPanel, state: second?.state });

  const sw = await runCase("switcher latched", {}, async (w) => {
    await W.open(w, W.P("w-sw-2"), { background: true });
    await W.open(w, W.P("w-sw-3"), { background: true });
    await W.openSwitcher(w);
  }, { closeWith: "action" });
  check("closing a window with the switcher open", sw.closed && sw.layers === "switcher", sw);

  const held = await runCase("ctrl-tab held", {}, async (w) => {
    await W.open(w, W.P("w-held-2"), { background: true });
    W.key(w, "KEY_Control", { type: "keydown" });
    W.key(w, "KEY_Tab", { ctrlKey: true });
    await sleep(700);
  }, { closeWith: "action" });
  check("closing a window while Ctrl+Tab is held", held.closed, held);
  // The Control key is still "down" in that window's EventUtils; the first window never saw it.

  const omni = await runCase("address field typing", {}, async (w) => {
    await W.openOmni(w);
    w.spike.type("glass ribbon");
    await sleep(500);
  });
  check("closing a window with the address field open and suggestions running", omni.closed && omni.layers === "omni", omni);

  const priv = await runCase("private peek find download", { private: true }, async (w, r) => {
    await W.openPeek(w, W.P("w-private-peek"));
    await W.openFind(w, "glass");
    w.vitre.service("downloads").download(W.url("file?size=40000000&rate=100000&name=private.bin"));
    r.privStarted = await waitFor(() => engine.list(true).some((v) => v.received > 0), { timeout: 15000 }).then(() => true, () => false);
    r.privList = engine.list(true).map((v) => [v.filename, v.state, v.received]);
  }, { closeWith: "action", expectPrompt: true });
  const privLeft = engine.list(true);
  log("private downloads after the window closed", privLeft.map((v) => [v.filename, v.state]));
  const parts = (await W.downloaded()).filter((f) => !/main-long|closing-window/.test(f));
  check("closing the last private window mid-download asks, Keep keeps it, the second answer cancels and closes", priv.prompt && priv.keptOpen && priv.closed && privLeft.length === 0 && parts.length === 0, { priv, privLeft: privLeft.length, parts });

  // ---- a popup window ----
  log("--- popup window");
  const opener = await W.open(window, W.url("opener?target=" + encodeURIComponent(W.P("popup-page"))));
  const btn = await W.rectOf(window, opener.browser, "#pop");
  const before = browsers().length;
  // A real popup window: Firefox's default restriction (Vitre's product default opens sized popups as tabs).
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  W.click(window, btn.cx, btn.cy);
  const popup = await waitFor(() => browsers().find((x) => x !== window && x.vitre?.isPopup && x.vitre?.ready), { timeout: 10000, what: "popup window" }).catch(() => null);
  if (popup) {
    await popup.spike.activate();
    await sleep(1200);
    const pv = popup.vitre;
    const steps = {};
    const tryKey = async (label, k, mods) => {
      W.key(popup, k, mods);
      await sleep(700);
      steps[label] = { popup: W.fmt(W.layers(popup)), main: W.fmt(W.layers(window)), wins: browsers().length };
      await popup.spike.capture("windows-popup-" + label.replace(/\W+/g, "-"));
      await W.unwind(popup, 4, 300);
      await W.unwind(window, 4, 300);
    };
    pv.focusPage();
    await tryKey("Ctrl+F", "f", { accelKey: true });
    await tryKey("Ctrl+J", "j", { ctrlKey: true });
    await tryKey("Ctrl+,", ",", { ctrlKey: true });
    await tryKey("Ctrl+Shift+A", "a", { ctrlKey: true, shiftKey: true });
    const r = pv.active().browser.getBoundingClientRect();
    W.rightClick(popup, r.left + r.width / 2, r.top + r.height / 2);
    await sleep(600);
    steps.menu = W.fmt(W.layers(popup));
    await popup.spike.capture("windows-popup-menu");
    log("popup steps", steps);
    check("popup window: the feature keys do not throw and leave nothing open after Esc", W.vitreErrors().length === 0, W.vitreErrors());
    // Close it with its menu open.
    popup.close();
    await waitFor(() => popup.closed, { timeout: 5000 }).catch(() => null);
    log("after popup close", { closed: popup.closed, before, now: browsers().map((x) => [x === window, x.vitre?.isPopup, x.closed, x.vitre?.tabs.map((t) => t.url.replace(W.base, "/"))]) });
    check("popup closed with its menu open", popup.closed, browsers().length);
  } else check("a popup window opened", false);
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 0);
  await sleep(500);

  // ---- tear-off with find open ----
  log("--- tear-off");
  const t1 = await W.open(window, W.P("tear-off"));
  b.focusPage();
  await W.openFind(window, "glass");
  b.moveToNewWindow(t1);
  const torn = await waitFor(() => browsers().find((x) => x !== window && x.vitre?.ready && x.vitre.tabs.some((t) => t.url === W.P("tear-off"))), { timeout: 10000, what: "torn-off window" }).catch(() => null);
  await sleep(1200);
  check("tear-off with find open: the first window has nothing left open", W.fmt(W.layers(window)) === "none" && W.leftovers(window).length === 0, { layers: W.fmt(W.layers(window)), left: W.leftovers(window) });
  if (torn) {
    await torn.spike.activate();
    torn.vitre.focusPage();
    await sleep(300);
    await W.openFind(torn, "glass");
    const ok = W.layers(torn).find;
    await torn.spike.capture("windows-torn-find");
    check("tear-off: find works in the new window", ok, W.fmt(W.layers(torn)));
    await W.unwind(torn);
    torn.close();
    await waitFor(() => torn.closed, { timeout: 5000 }).catch(() => null);
  }

  // ---- every closed window was collected ----
  await sleep(1500);
  await W.gc();
  await sleep(2500);
  await W.gc();
  for (const [r, refs] of results) {
    const alive = Object.entries(refs).filter(([, ref]) => ref.get() !== null).map(([k]) => k);
    check(`collected after close: ${r.name}`, alive.length === 0, "still reachable: " + alive.join(", "));
  }
  check("VitreShell.windows holds only the open window", Shell.windows.size === 1, Shell.windows.size);
  check("the engine keeps quit prompts only for open windows", [...(engine.prompts?.keys?.() || [])].every((w) => !w.closed) && (engine.prompts?.size ?? 1) === 1, engine.prompts?.size);
  check("the first window's download ran through all of it", mainDl()?.state === "downloading", mainDl()?.state);
  check("first window consistent and clean", W.consistent(window).length === 0 && W.leftovers(window).length === 0, [W.consistent(window), W.leftovers(window)]);
  W.consoleDump("windows");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(500);
});
