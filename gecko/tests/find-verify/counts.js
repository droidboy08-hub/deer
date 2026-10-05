// The counter under rapid input on a page with a cross-site (out-of-process) frame: bursts of Enter,
// held Enter, typing, match case flips and F3 reopening; after each the settled counter must be the
// true total (13, or 11 with match case) and say the same match the page shows. Overlapping count
// requests make Gecko answer with partial totals (FinderParent stops summing at a superseded frame).
// Run by tests/find-verify/all.py (counts).
/* global spike, FL, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1000);
  V.takeErrors();
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open", 3000);
  await FL.query("glass");
  await FL.counter("1 of 13");

  let wrong = 0;
  const seen = [];
  // Every counter text shown, to count how often a wrong total flashed.
  const flashes = new Set();
  const obs = new MutationObserver(() => {
    const t = FL.st()?.counter ?? "";
    if (/ of /.test(t)) flashes.add(t.split(" of ")[1]);
  });
  obs.observe(FL.face().querySelector(".vf-count"), { childList: true, characterData: true, subtree: true });
  async function expectTotal(label, total) {
    const t0 = Date.now();
    await FL.until(() => FL.st()?.total === total && FL.F().states.get(gBrowser.selectedBrowser)?.countSettled, label, 3000);
    const ms = Date.now() - t0;
    const s = await FL.settle(500);
    const ok = s?.total === total && new RegExp(`^\\d+ of ${total}$`).test(s.counter);
    if (!ok) wrong++;
    seen.push({ label, counter: s?.counter, ms });
    return ok;
  }
  for (let round = 0; round < 6; round++) {
    for (const n of [2, 3, 6]) {
      for (let i = 0; i < n; i++) spike.press(i % 2 && round % 2 ? "F3" : "Enter");
      await expectTotal(`r${round} burst ${n}`, 13);
    }
    spike.press("Enter");
    for (let i = 0; i < 10; i++) {
      spike.press("Enter", { repeat: true });
      await sleep(33);
    }
    await expectTotal(`r${round} held`, 13);
    spike.press("Alt+C");
    await expectTotal(`r${round} case on`, 11);
    for (let i = 0; i < 4; i++) spike.press("Shift+Enter");
    await expectTotal(`r${round} case burst`, 11);
    spike.press("Alt+C");
    await expectTotal(`r${round} case off`, 13);
    await FL.query("gla");
    await FL.query("glass");
    await expectTotal(`r${round} retyped`, 13);
    // Ctrl+L, then F3 from the page: reopen parked and step.
    spike.press("Ctrl+L");
    await FL.until(() => b.omni.open, "omni", 2000);
    spike.press("Escape");
    spike.press("Escape");
    await FL.until(() => !b.omni.open, "omni closed", 2000);
    b.focusPage();
    await sleep(150);
    spike.press("F3");
    await FL.until(() => FL.st()?.open, "F3 reopen", 2000);
    await expectTotal(`r${round} F3 reopen`, 13);
    FL.input().focus();
  }
  obs.disconnect();
  log("settled counters", seen);
  log("totals ever shown", [...flashes]);
  check("every burst settles on the true total (13, 11 with match case)", wrong === 0, seen.filter((x) => !/of (13|11)$/.test(x.counter ?? "")));
  const slow = seen.filter((x) => x.ms > 1500);
  check("... within 1.5 s of the last key", slow.length === 0, slow);
  const page = await FL.pageState();
  const s = FL.st();
  check("the counter's match is the one the page shows", page.sel.toLowerCase() === "glass" || s.foundTop === false, { page, s });
  const errs = V.takeErrors();
  check("no console errors from find", errs.length === 0, errs);
});
