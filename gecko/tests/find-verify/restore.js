// Find in page across a restart with session restore: find is open on one tab and parked on another
// when the app restarts; after the restore nothing of it is left on screen, and find works on the
// restored tabs (the selected one and a deferred one). Run by tests/find-verify/all.py (restore).
/* global spike, FL, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture, waitFor } = spike;
  await spike.resize(1280, 860);
  await spike.activate();

  if (spike.run === 1) {
    await FL.load(FL.http("article.html"));
    await sleep(800);
    const a = b.active();
    b.focusPage();
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open, "open A", 3000);
    await FL.query("glass");
    await FL.counter("1 of 13");
    spike.press("Enter");
    await FL.counter("2 of 13");
    const d = b.newTab(FL.http("dark.html"));
    await waitFor(() => !d.loading && d.url.includes("dark"), { timeout: 8000, what: "dark" });
    await sleep(600);
    b.focusPage();
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open, "open D", 3000);
    await FL.query("float");
    await FL.settle(400);
    b.activate(a);
    await sleep(500);
    check("before the restart: find open on A (shown) and on the dark tab", FL.st()?.open && FL.F().inspect(d.browser)?.open);
    await capture("rs-01-before");
    log("restarting");
    await spike.restart();
    return;
  }

  V.takeErrors();
  await waitFor(() => b.tabs.length === 2, { timeout: 20000, what: "restored tabs" });
  await waitFor(() => b.active() && !b.active().loading && b.active().url.includes("article"), { timeout: 20000, what: "restored selected tab" });
  await sleep(1500);
  log("restored", b.tabs.map((t) => ({ url: t.url, deferred: t.deferred })));
  check("after the restart: no find on screen, nothing left on the bar", !FL.st()?.open && V.residue().length === 0 && V.pillFaceVisible(), { st: FL.st(), residue: V.residue() });
  check("after the restart: the native findbar was not created", !FL.nativeFindbar().initialized && FL.nativeFindbar().elements === 0, FL.nativeFindbar());
  await capture("rs-02-restored");
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open restored", 3000);
  let s = FL.st();
  check("Ctrl+F on the restored tab: find opens, empty (no query survives a restart)", s?.open && s.query === "" && s.focused, s);
  FL.type("glass");
  s = await FL.counter("1 of 13");
  check("... and counts (1 of 13)", s?.counter === "1 of 13", s);
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed", 3000);
  const dark = b.tabs.find((t) => t.url.includes("dark"));
  b.activate(dark);
  await waitFor(() => !dark.loading && !dark.deferred, { timeout: 15000, what: "deferred tab loads" });
  await sleep(800);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open dark", 3000);
  s = FL.st();
  check("the deferred tab, once shown: find opens with this window's last query", s?.open && s.query === "glass", s);
  await FL.query("float");
  s = await FL.settle(500);
  check("... and counts there", /^1 of \d+$/.test(s?.counter ?? ""), s);
  await capture("rs-03-deferred-find");
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed dark", 3000);
  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
