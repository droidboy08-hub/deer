// Motion (TabMotion board) and reduced motion. The opening and the release are frozen part-way
// (every animation in the switcher's layer paused at one time) to capture them, and their timings and
// curves are read from the running animations. Reduced motion (ui.prefersReducedMotion = 1, what
// Windows' "Animation effects: off" gives) must leave only short cross-fades.
// python tools/run.py --test tests/switcher/motion.js --name switcher-motion --app build-switcher --timeout 240
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, state } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  const tabs = await S.openTabs(REAL_PAGES.slice(0, 5));
  await S.visit([tabs[4], tabs[3], tabs[2], tabs[1], tabs[0]]);
  const layer = document.getElementById("layer-switcher");
  const anims = () => document.getAnimations().filter((a) => a.effect?.target && layer.contains(a.effect.target));
  const describe = (a) => {
    const t = a.effect.getTiming();
    const el = a.effect.target;
    const kf = a.effect.getKeyframes?.() ?? [];
    const props = [...new Set(kf.flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset", "simulateComputeValuesFailure"].includes(p))))];
    const cls = (el.className || el.localName).toString().split(" ");
    return { el: cls.find((c) => c.startsWith("sw-") && c !== "sw-glass") ?? cls[0], props: a.transitionProperty ? [a.transitionProperty] : props, duration: t.duration, delay: t.delay, easing: t.easing === "linear" ? kf[0]?.easing ?? "linear" : t.easing };
  };
  /** Freeze every switcher animation at `ms` after it started and capture. */
  const freezeAt = async (ms, name) => {
    const list = anims();
    for (const a of list) {
      a.pause();
      a.currentTime = ms;
    }
    await spike.capture(name);
    for (const a of list) a.play();
  };

  // ---- opening (held) ----
  await S.setStyle("deck");
  b.focusPage();
  await sleep(100);
  S.down("Control");
  await sleep(20);
  S.press("Tab");
  await S.waitFor(() => state().phase === "open", { what: "open" });
  const opening = anims().map(describe);
  log("opening animations", opening);
  const find = (el, prop) => opening.find((a) => a.el === el && a.props.includes(prop));
  const shrink = find("sw-dcard-in", "transform");
  const rise = opening.filter((a) => a.el === "sw-dcard-in" && a.props.includes("opacity"));
  const dock = find("sw-dock", "transform");
  const wall = find("sw-wall", "filter");
  check("open: the page you were on shrinks into its card in 420 ms on the spring", shrink && shrink.duration === 420 && /0\.22, 1, 0\.36, 1/.test(shrink.easing), shrink);
  check("open: the others rise 560 ms each, 60 ms apart from 120 ms", rise.length >= 1 && rise.every((a) => a.duration === 560 && (a.delay - 120) % 60 === 0), rise);
  check("open: the dock rises 18 px in 380 ms from 160 ms; the wallpaper blurs in 320 ms", dock && dock.duration === 380 && dock.delay === 160 && wall && wall.duration === 320, { dock, wall });
  await freezeAt(90, "motion-open-90ms");
  await freezeAt(300, "motion-open-300ms");
  await sleep(700);
  // ---- Tab again: the deck slides one card ----
  S.press("Tab");
  await sleep(30);
  const slide = anims().map(describe).filter((a) => a.el === "sw-dcard");
  check("Tab again: the cards slide with the spring in 560 ms", slide.length >= 2 && slide.some((a) => a.props.includes("transform") && a.duration === 560), slide);
  await freezeAt(200, "motion-step-200ms");
  await sleep(700);
  // ---- release: the chosen card fills the window ----
  // The switcher fades out on a 360 ms timer once the card has grown; hold that timer back while the
  // frozen frame is captured (test-only: the capture itself takes about 300 ms).
  const realSetTimeout = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 300 && ms <= 400 ? ms + 2500 : ms, ...rest);
  S.up("Control");
  await sleep(40);
  const expand = anims().map(describe).filter((a) => a.props.includes("transform") && a.el === "sw-dcard");
  check("release: the chosen card grows to fill the window in 360 ms on the expand curve", expand.some((a) => a.duration === 360 && /0\.2, 0, 0, 1/.test(a.easing)), expand);
  await freezeAt(180, "motion-release-180ms");
  window.setTimeout = realSetTimeout;
  await S.waitFor(() => state().phase === "idle", { what: "closed" });
  await sleep(400);
  check("release: then the switcher is gone and the tab is active", S.active() === tabs[2].title, S.active());

  // ---- reduced motion ----
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await sleep(300);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  b.focusPage();
  await sleep(100);
  S.down("Control");
  await sleep(20);
  S.press("Tab");
  await S.waitFor(() => state().phase === "open", { what: "open (reduced)" });
  const rOpen = anims().map(describe);
  log("reduced opening", rOpen);
  check("reduced motion: opening is one 150 ms cross-fade, nothing moves", reduced && rOpen.length >= 1 && rOpen.every((a) => a.props.every((p) => p === "opacity") && a.duration <= 150), rOpen);
  await sleep(400);
  S.press("Tab");
  await sleep(30);
  const rStep = anims().map(describe);
  check("reduced motion: a step only cross-fades (no slide)", rStep.every((a) => a.props.every((p) => p === "opacity") && a.duration <= 150), rStep);
  await sleep(300);
  await spike.capture("motion-reduced-open");
  S.up("Control");
  await sleep(30);
  const rClose = anims().map(describe);
  check("reduced motion: release cross-fades in 150 ms, no expand", rClose.every((a) => a.props.every((p) => p === "opacity") && a.duration <= 150), rClose);
  await S.waitFor(() => state().phase === "idle", { what: "closed (reduced)" });
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
});
