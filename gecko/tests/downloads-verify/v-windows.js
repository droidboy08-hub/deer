// Windows: a second window, a private window, a popup window, and what is left behind when they close.
//   - a download started in one window shows in the other's ring and panel; pausing it from the second
//     window shows in the first; closing a window that is not the last never asks and never stops it;
//   - a private window keeps its own list (not in the normal windows, not in the store file); closing
//     the last private window while a private download runs asks first ("Keep downloading" keeps the
//     window and the download; "Cancel download and close" cancels it and closes the window);
//   - a quit with only private downloads running says they are cancelled, not resumed;
//   - a popup window (window.open with popup features) has the ring and a panel that fits it;
//   - every window that closes takes its listeners with it (engine, media watch, quit prompts).
/* global spike, Services, gBrowser, DL, V, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const counts = () => ({ engine: engine.listeners.size, media: engine.media.listeners.size, prompts: engine.prompts.size });
  const base = counts();
  log("listeners at start", base);

  await DL.open(DL.base + "/page.html");

  // ---- a second normal window ----
  const w2 = await spike.openWindow();
  await sleep(600);
  check("the second window has the downloads module", w2.vitre.modules.includes("downloads") && !!w2.vitreDownloads);
  window.focus();
  await spike.activate();
  const id = engine.start(DL.base + "/blob/big?rate=512", { filename: "two-windows.bin", named: true, pageUrl: DL.base + "/page.html", browserId: gBrowser.selectedBrowser.browsingContext.browserId });
  await DL.until(id, ["downloading"], { test: (v) => v.received > 1 << 20, timeout: 30000 });
  await sleep(500);
  check("the ring shows in both windows", ui.ring.isShown && w2.vitreDownloads.ring.isShown);
  check("both windows list the download", !!ui.store.get(id) && !!w2.vitreDownloads.store.get(id));
  w2.vitreDownloads.store.run("pause", id);
  await DL.until(id, ["paused"], { timeout: 8000 });
  await sleep(400);
  check("a pause from the second window shows in the first", ui.store.get(id)?.state === "paused", ui.store.get(id)?.state);
  engine.resume(id);
  await DL.until(id, ["downloading"], { timeout: 15000 });
  w2.vitre.run("closeWindow");
  await V.until(() => w2.closed, "the second window to close (no prompt: another window stays)", 8000);
  await sleep(500);
  check("closing a window that is not the last keeps the download running", engine.get(id).state === "downloading");
  check("the closed window's listeners are gone", counts().engine === base.engine && counts().media === base.media && counts().prompts === base.prompts, counts());

  // ---- a private window ----
  const pw = await spike.openWindow({ private: true });
  await sleep(600);
  check("the private window is private", pw.vitre.isPrivate === true);
  await pw.spike.resize(1200, 800);
  pw.vitre.navigate(pw.vitre.active().id, DL.base + "/page.html");
  await pw.spike.loaded(pw.gBrowser.selectedBrowser);
  await sleep(400);
  pw.vitre.service("downloads").download(DL.base + "/blob/big?rate=256", { filename: "private-notes.bin", browser: pw.gBrowser.selectedBrowser });
  const pid = await V.until(() => engine.list(true).find((v) => v.filename === "private-notes.bin")?.id, "the private download");
  await DL.until(pid, ["downloading"], { timeout: 20000 });
  check("the private download is private", engine.get(pid).isPrivate === true);
  await sleep(500);
  check("the normal window does not list it", !ui.store.get(pid));
  check("the private window lists it", !!pw.vitreDownloads.store.get(pid));
  await engine.save();
  const stored = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "vitre-downloads.json"));
  check("the store file has no private download", !stored.items.some((r) => r.identity?.isPrivate || r.filename === "private-notes.bin"), stored.items.map((r) => r.filename));

  pw.vitre.run("closeWindow");
  await sleep(700);
  check("closing the last private window while a private download runs asks first", !pw.closed && !!pw.vitreDownloads?.prompt.isOpen, { closed: pw.closed });
  if (!pw.closed) {
    const text = pw.vitre.root.querySelector(".vd-quit")?.textContent ?? "";
    check("the prompt says the private download will be cancelled", /private download/i.test(text) && /cancelled/.test(text), text);
    await pw.spike.capture("v-windows-01-private-prompt");
    pw.vitreDownloads.prompt.close();
    await sleep(300);
    check("Keep downloading keeps the private window and its download", !pw.closed && engine.get(pid)?.state === "downloading");

    // A quit with only a private download running (the normal one paused) says it is cancelled.
    engine.pause(id);
    await DL.until(id, ["paused"]);
    await sleep(300);
    const allowed = window.canQuitApplication();
    check("a quit while the private download runs is refused at first", allowed === false, allowed);
    const prompted = await V.until(() => (ui.prompt.isOpen ? ui : pw.vitreDownloads.prompt.isOpen ? pw.vitreDownloads : null), "the quit prompt");
    const qwin = prompted === ui ? window : pw;
    const qtext = qwin.vitre.root.querySelector(".vd-quit")?.textContent ?? "";
    check("the quit prompt says the private download is cancelled, not resumed", /cancelled/.test(qtext) && !/continues/.test(qtext), qtext);
    prompted.prompt.close();
    await sleep(300);

    pw.vitre.run("closeWindow");
    await V.until(() => pw.vitreDownloads.prompt.isOpen, "the private prompt again");
    pw.vitre.root.querySelector(".vd-q-go").click();
    await V.until(() => pw.closed, "the private window to close after 'Cancel download and close'", 10000);
    await sleep(800);
    const gone = engine.get(pid);
    check("its private download is cancelled and gone from the list", !gone || gone.state === "cancelled", gone?.state);
    check("the normal download is untouched", engine.get(id).state === "paused");
  } else {
    pw.vitreDownloads?.prompt.close();
  }
  await sleep(300);
  check("the closed private window's listeners are gone", counts().engine === base.engine && counts().media === base.media && counts().prompts === base.prompts, counts());

  // ---- a popup window ----
  // Pages' window.open() goes to tabs in Vitre (browser.link.open_newwindow.restriction = 0); popup
  // windows come from extensions (windows.create type popup): a browser window without toolbars,
  // which browser-init.js marks popup-window.
  const popupReady = new Promise((resolve) => {
    const obs = (subject) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      Promise.resolve(subject.vitre?.whenReady).then(() => resolve(subject));
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  window.openDialog(AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,dialog=no,resizable,width=720,height=560", "about:blank");
  const pop = await Promise.race([popupReady, new Promise((r) => setTimeout(() => r(null), 10000))]);
  check("a popup window opened", !!pop && pop.vitre?.isPopup === true, pop?.vitre?.isPopup);
  if (pop) {
    pop.vitre.navigate(pop.vitre.active().id, DL.base + "/page.html?popup=1");
    await pop.spike.loaded(pop.gBrowser.selectedBrowser);
    engine.resume(id);
    await DL.until(id, ["downloading"], { timeout: 15000 });
    await sleep(600);
    check("the popup shows the ring while downloading", pop.vitreDownloads.ring.isShown);
    // A popup is too small for the panel: Ctrl+J there opens it in the main window (panel.ts header).
    pop.vitre.run("downloads");
    await sleep(600);
    const inPopup = !!pop.vitre.root.querySelector(".vd-panel");
    const inMain = !!window.vitreDownloads?.panel.open;
    check("Ctrl+J in a popup opens the panel in the main window, not in the popup", !inPopup && inMain, { inPopup, inMain });
    await V.capture("v-windows-02-popup-panel-in-main");
    window.vitreDownloads?.panel.hide();
    await sleep(400);
    pop.close();
    await V.until(() => pop.closed, "the popup to close");
    await sleep(800);
  }
  check("the closed popup's listeners are gone", counts().engine === base.engine && counts().media === base.media && counts().prompts === base.prompts, counts());
  check("the download kept going through all of it", ["downloading", "completed"].includes(engine.get(id).state), engine.get(id).state);

  engine.cancel(id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
