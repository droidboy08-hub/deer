// Peek verification: what a peek costs while nobody does anything, and console errors over a whole
// cycle. With a static page in an open sheet over a static page, and then with the page warm, the
// chrome window must not run animation frames, timers or repaints of its own; the parent process
// CPU time over 3 s is compared with the same window without a peek.
//   python tests/peek-verify/all.py idle
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  const src = b.active();
  await P.load(P.page("verify.html"), src);
  // Park the pointer away from the bar and links.
  P.move(1300, 800);
  // Firefox's own start-up work runs in idle tasks for the first seconds (browser-init.js
  // idleTasksFinished) and burns parent CPU in bursts: measure after it.
  await Promise.race([window.gBrowserInit?.idleTasksFinished?.promise, sleep(30000)]);
  await sleep(6000);

  /** Chrome activity over 3 s, and the median parent CPU of five 2 s windows (bursts of unrelated background work drop out). */
  const measure = async (label) => {
    const act = await V.chromeActivity(3000);
    const cpu = [];
    for (let i = 0; i < 5; i++) {
      const c0 = await V.cpuMs();
      await sleep(2000);
      cpu.push(Math.round((await V.cpuMs()) - c0));
    }
    const sorted = [...cpu].sort((x, y) => x - y);
    const r = { ...act, parentCpuMs: sorted[2], windows: cpu };
    log("idle " + label, r);
    return r;
  };

  const base = await measure("baseline (no peek)");

  await P.shiftClick("#still");
  const br = await P.waitOpen("still.html");
  P.move(1300, 860);
  // Opening or closing any tab (a plain background tab too) is followed by several seconds of
  // parent CPU bursts from Firefox's own tab and process bookkeeping: measure the steady state.
  await sleep(10000);
  const open = await measure("peek open");
  check("an idle open peek runs no animation frames in the window", open.raf === 0, open);
  check("an idle open peek sets no timers of its own beyond the baseline", open.timers <= base.timers + 2 && open.intervals <= base.intervals, { base, open });
  check("an idle open peek does not keep the window repainting", open.paints <= base.paints + 2, { base, open });
  check("an idle open peek costs about what the window costs without one (median parent CPU per 2 s)", open.parentCpuMs <= base.parentCpuMs + 40, { base: base.windows, open: open.windows });

  P.press("Escape");
  await P.waitClosed();
  await sleep(6000);
  const warm = await measure("peek warm");
  check("a warm (closed) peek is asleep", !br.docShellIsActive && V.hidden() === 1);
  check("a warm peek costs nothing in the window", warm.raf === 0 && warm.paints <= base.paints + 2 && warm.parentCpuMs <= base.parentCpuMs + 40, { base: base.windows, warm: warm.windows });

  // A whole cycle for the console: open, hop, close, reopen, promote, close the tab.
  await P.load(P.page("issues.html"), src);
  await P.shiftClick("#i39");
  await P.waitOpen("n=39");
  const r38 = await P.rectOf(src.browser, "#i38");
  P.move(r38.x + 10, r38.cy);
  P.mouse(r38.x + 10, r38.cy, { shiftKey: true });
  await waitFor(() => peek().browser()?.currentURI.spec.includes("n=38"), { what: "hop" });
  await sleep(800);
  P.mouse(100, 860);
  await P.waitClosed();
  P.press("Ctrl+Shift+T");
  await P.waitOpen("n=38");
  P.press("Alt+Enter");
  await waitFor(() => !peek().isOpen() && b.tabs.length === 2, { what: "promote" });
  await sleep(800);
  b.closeTab(b.active());
  await sleep(800);
  log("console errors", V.errors);
  check("no errors from Vitre's code in the console over a whole cycle", V.errors.length === 0, V.errors.slice(0, 8));
});
