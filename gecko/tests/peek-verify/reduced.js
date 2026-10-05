// Peek verification: reduced motion (ui.prefersReducedMotion=1, set by all.py for this script).
// DESIGN-NOTES "Motion": 150 ms cross-fades, no scale, glide or flight. The sheet appears in place,
// leaves in place, Open as tab has no rising capsule; nothing is left half-way.
//   python tests/peek-verify/all.py reduced
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(400);
  check("the window prefers reduced motion", window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  await V.section("open and close in place", async () => {
    await P.shiftClick("#i39");
    await waitFor(() => peek().isOpen() && P.sheet().shown, { what: "the sheet" });
    await sleep(20);
    const s = P.sheet();
    log("right after opening", s.chrome);
    check("reduced motion: the sheet appears at its place and size (no growth from the link)", s.chrome && s.chrome.x === 200 && s.chrome.y === 72 && s.chrome.w === 1040 && s.chrome.h === 804, s.chrome);
    await P.waitOpen("n=39");
    await spike.capture("reduced-1-open");
    const t0 = performance.now();
    P.press("Escape");
    await sleep(60);
    const mid = P.sheet();
    check("closing does not shrink it: it fades where it is", !mid.shown || (mid.chrome.w === 1040 && mid.chrome.x === 200), mid.chrome);
    await P.waitClosed();
    const took = performance.now() - t0;
    check("and it is gone within about 150 ms (plus a frame or two)", took < 450, Math.round(took));
  });

  await V.section("open as tab without the rising capsule", async () => {
    await P.shiftClick("#i38");
    const br = await P.waitOpen("n=38");
    peek().promote();
    await sleep(40);
    const rise = document.querySelector("#layer-peek-rise > .vp-rise");
    check("no capsule flies to the bar under reduced motion", !rise || getComputedStyle(rise).display === "none");
    await waitFor(() => !peek().isOpen() && b.active().browser === br, { what: "promoted" });
    await sleep(400);
    check("promoted cleanly: a tab, no sheet, panels normal", b.tabs.length === 2 && !P.sheet().shown && !gBrowser.tabpanels.querySelector(".vitre-peek-panel, .vitre-peek-under"));
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
