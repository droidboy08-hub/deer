// Find in page while nothing happens: CPU time of the parent process, chrome paints and live timers
// and animations over idle stretches with find closed, open (focused), parked, and open in a
// background tab. Run by tests/find-verify/all.py (idle).
/* global spike, FL, V, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1500);
  V.takeErrors();

  // Count the timers find's window code starts (setTimeout / setInterval / rAF callbacks that run).
  let ticks = 0;
  const wrap = (name) => {
    const orig = window[name];
    window[name] = function (fn, ...rest) {
      const f = typeof fn === "function" ? (...a) => { ticks++; return fn(...a); } : fn;
      return orig.call(window, f, ...rest);
    };
    return () => (window[name] = orig);
  };
  let paints = 0;
  const onPaint = () => paints++;
  window.addEventListener("MozAfterPaint", onPaint);

  async function measure(label, ms = 5000) {
    await sleep(1500);
    const p0 = await ChromeUtils.requestProcInfo();
    const c0 = p0.cpuTime;
    paints = 0;
    ticks = 0;
    const undo = [wrap("setTimeout"), wrap("setInterval"), wrap("requestAnimationFrame")];
    await sleep(ms);
    undo.forEach((u) => u());
    const p1 = await ChromeUtils.requestProcInfo();
    const cpuMs = Math.round((p1.cpuTime - c0) / 1e6);
    const anims = document.getAnimations().filter((a) => a.playState === "running");
    const findAnims = anims.filter((a) => a.effect?.target?.closest?.("#layer-find, #layer-find-ring")).length;
    const r = { label, cpuMs, paints, ticksStarted: ticks, runningAnimations: anims.length, findAnimations: findAnims, poll: !!FL.F().pollTimer };
    log("idle", r);
    return r;
  }

  const closed = await measure("find closed");
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open", 3000);
  await FL.query("glass");
  await FL.counter("1 of 13");
  const focused = await measure("find open, field focused");
  spike.press("F6");
  await sleep(300);
  const parked = await measure("find parked");
  const other = b.newTab(FL.http("counter.html"));
  await sleep(1500);
  const background = await measure("find open in a background tab");
  b.closeTab(other);
  await sleep(500);
  FL.F().api().close();
  await FL.until(() => !FL.st()?.open, "closed", 3000);
  const after = await measure("find closed again");
  window.removeEventListener("MozAfterPaint", onPaint);

  check("idle: no find animation runs while nothing changes (open, parked, background)", [focused, parked, background].every((r) => r.findAnimations === 0), [focused, parked, background]);
  check("idle: no poll runs while no peek is open", [focused, parked, background].every((r) => !r.poll), [focused, parked, background]);
  check("idle, parked: no more chrome paints than with find closed (+3)", parked.paints <= Math.max(closed.paints, after.paints) + 3, { closed: closed.paints, parked: parked.paints, after: after.paints });
  check("idle, find open in a background tab: no more chrome paints than with find closed (+3)", background.paints <= Math.max(closed.paints, after.paints) + 3, { closed: closed.paints, background: background.paints });
  check("idle: find starts no timers while parked or in the background (beyond the closed baseline + 2)", parked.ticksStarted <= Math.max(closed.ticksStarted, after.ticksStarted) + 2 && background.ticksStarted <= Math.max(closed.ticksStarted, after.ticksStarted) + 2, { closed: closed.ticksStarted, parked: parked.ticksStarted, background: background.ticksStarted, after: after.ticksStarted });
  log("cpu ms over 5 s", { closed: closed.cpuMs, focused: focused.cpuMs, parked: parked.cpuMs, background: background.cpuMs, after: after.cpuMs });
  const errs = V.takeErrors();
  check("no console errors from find", errs.length === 0, errs);
});
