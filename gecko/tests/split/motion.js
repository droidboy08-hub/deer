// Split view's motion (../design/SPLIT-VIEW-SPEC.md "Motion"; board SplitMotion; src/window/
// splitmotion.ts, bar.ts morph / crossFade, split.ts enterPane / leaving). Run twice by all.py:
// `motion` as it is, `reduced` with ui.prefersReducedMotion (every moment a 150 ms cross-fade, no
// glide, scale, slide, flight or pulse). The animations are read from document.getAnimations()
// right after each change (their kind, keyframes and timing), so the checks do not depend on how
// fast the machine is; two captures freeze the motion part-way (all animations paused at 150 ms).
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  log(reduced ? "REDUCED MOTION run" : "full motion run");
  const near = (a, c, tol = 3) => Math.abs(a - c) <= tol;
  const anims = (pred) => document.getAnimations().filter((a) => {
    try {
      return pred(a);
    } catch {
      return false;
    }
  });
  const target = (a) => a.effect?.target;
  const frames = (a) => JSON.stringify(a.effect?.getKeyframes?.() ?? []);
  const timing = (a) => a.effect?.getTiming?.() ?? {};
  const transitionOf = (el, prop) => el?.getAnimations?.().find((a) => a.transitionProperty === prop) ?? null;
  const ghosts = () => [...document.querySelectorAll("#vitre-bar > .sv-ghost")];
  /** Freeze every running animation at `ms` from its start, capture, then let them run on. */
  async function frozen(name, ms) {
    const running = document.getAnimations();
    for (const a of running) {
      try {
        a.pause();
        a.currentTime = Math.min(ms, (timing(a).delay ?? 0) + (timing(a).duration ?? ms));
      } catch {
        /* finished */
      }
    }
    await spike.capture(name);
    for (const a of running) {
      try {
        a.play();
      } catch {
        /* gone */
      }
    }
  }

  log("--- 1. split forms (b.split): the pill, the joining circle, the pane, the seam and the plate");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  const before = SL.items();
  const pill0 = before.find((x) => x.active);
  const tl0 = before.find((x) => x.key === String(tl.id));
  const ln0 = before.find((x) => x.key === String(ln.id));
  b.split(tl);
  const item = SL.pairItem();
  const leftMain = SL.half("left").querySelector(".half-main");
  const rightMain = SL.half("right").querySelector(".half-main");
  const pane = SL.panel(tl).querySelector(".browserContainer");
  const g = ghosts();
  const lnItem = b.bar.item(ln.id);
  if (!reduced) {
    const leftT = transitionOf(item, "left");
    check("the pair's item starts on the pill it continues (x " + pill0.x + ") and slides to its slot on the 420 ms spring", near(item.getBoundingClientRect().x, pill0.x) && parseFloat(item.style.left) !== pill0.x && !!leftT && leftT.effect.getComputedTiming().duration === 420, { now: item.getBoundingClientRect().x, to: item.style.left, from: pill0.x });
    check("the joining circle morphs into its half: a ghost from the circle's slot, 420 ms", g.length === 1 && near(g[0].getBoundingClientRect().x, tl0.x) && g[0].getAnimations().some((a) => timing(a).duration === 420 && frames(a).includes("left")), g.map((x) => SL.rect(x)));
    check("…the half's own content waits for it (hidden until the ghost lands)", rightMain.style.opacity === "0");
    const slide = leftMain.getAnimations().find((a) => frames(a).includes("translateX"));
    check("the page you were on: its favicon and host slide into their half (240 ms, from the pill's middle)", !!slide && timing(slide).duration === 240 && /translateX\((\d+)px\)/.test(frames(slide)), slide && frames(slide));
    const enter = pane.getAnimations();
    check("the new pane slides 24 px in from its outer (right) edge on the spring (280 ms) and fades in (200 ms)", enter.some((a) => frames(a).includes("translateX(24px)") && timing(a).duration === 280) && enter.some((a) => frames(a).includes("opacity") && timing(a).duration === 200), enter.map((a) => [frames(a), timing(a).duration]));
    const seam = anims((a) => target(a) === SL.half("right") && a.effect.pseudoElement === "::before");
    check("the seam fades in at 120-240 ms", seam.length === 1 && timing(seam[0]).delay === 120 && timing(seam[0]).duration === 120, seam.map((a) => timing(a)));
    const plate = anims((a) => target(a) === SL.half("left").querySelector(".plate") && !(a instanceof CSSTransition));
    check("…and no transition of its own runs under that fade", !SL.half("left").querySelector(".plate").getAnimations().some((a) => a instanceof CSSTransition));
    check("…until 240 ms the plate is not there (opacity 0), the seam neither", getComputedStyle(SL.half("left").querySelector(".plate")).opacity === "0" && getComputedStyle(SL.half("right"), "::before").opacity === "0", { plate: getComputedStyle(SL.half("left").querySelector(".plate")).opacity, seam: getComputedStyle(SL.half("right"), "::before").opacity });
    check("the focused plate fades in at 240-390 ms", plate.length === 1 && timing(plate[0]).delay === 240 && timing(plate[0]).duration === 150, plate.map((a) => timing(a)));
    const rim = anims((a) => target(a)?.classList?.contains("sp-rim") && timing(a).delay === 240 && timing(a).duration === 150);
    check("both rims fade in with the plate (240-390 ms): the new pane's and the focused one (spec: the focused plate and rim fade in)", rim.length === 2 && new Set(rim.map(target)).size === 2, rim.map((a) => target(a).className));
    check("the circles after the joining one close up on the spring (Links slides left)", !!transitionOf(lnItem, "left") && parseFloat(lnItem.style.left) < ln0.x, { from: ln0.x, to: lnItem.style.left });
    await sleep(30);
    await frozen("motion-1-forming", 150);
  } else {
    check("reduced: no ghost, no slide; the pair's item fades in (150 ms)", g.length === 0 && !transitionOf(item, "left") && !leftMain.getAnimations().length, { ghosts: g.length });
    const enter = pane.getAnimations();
    check("reduced: the new pane only fades in (150 ms), no transform", enter.length === 1 && !frames(enter[0]).includes("translate") && timing(enter[0]).duration === 150, enter.map((a) => frames(a)));
  }
  await sleep(700);
  check("after the motion: no ghost, the half's content shown, the pane at rest", ghosts().length === 0 && rightMain.style.opacity === "" && !pane.getAnimations().length && near(item.getBoundingClientRect().x, parseFloat(item.style.left), 1));
  await SL.settled();

  log("--- 2. focus moves: the plate glides, the group's theme cross-fades (150 ms)");
  SL.mouse(...(() => {
    const r = rightMain.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  })(), { type: "mousemove" });
  await sleep(50);
  spike.EU.synthesizeMouseAtCenter(rightMain, {}, window);
  await SL.until(() => b.active() === tl, 3000);
  const veils = [...document.querySelectorAll("#vitre-bar .sv-veil")];
  const glide = anims((a) => target(a) === SL.half("right").querySelector(".plate") && frames(a).includes("translateX"));
  if (!reduced) {
    check("the plate glides from the left half to the right one (240 ms, spring)", glide.length === 1 && timing(glide[0]).duration === 240 && /translateX\(-\d+px\)/.test(frames(glide[0])), glide.map((a) => frames(a)));
    check("the group cross-fades from light glass to Tideline's dark glass: a light veil over each item fading out in 150 ms", veils.length >= 3 && veils.every((v) => v.classList.contains("theme-light")) && veils[0].getAnimations().some((a) => timing(a).duration === 150) && document.getElementById("vitre-bar").classList.contains("sv-xf"), veils.map((v) => v.className));
  } else {
    check("reduced: no glide; the theme still cross-fades in 150 ms", glide.length === 0 && veils.length >= 3 && veils[0].getAnimations().some((a) => timing(a).duration === 150), { glide: glide.length, veils: veils.length });
  }
  await sleep(350);
  check("after the cross-fade: no veil left, the root is dark", !document.querySelector("#vitre-bar .sv-veil") && b.root.classList.contains("theme-dark"));
  b.activate(fn);
  await sleep(400);

  log("--- 3. the mixed tint cross-fades (150 ms) as the gutter passes under an item");
  await SL.settled();
  const plus = document.querySelector("#vitre-bar .item.plus");
  check("set-up: the + is over Tideline, in the mixed tint", plus.classList.contains("mixed"));
  SL.divider().focus();
  spike.press("End");
  await sleep(10);
  const mixT = transitionOf(plus.querySelector(":scope > .tint-mix"), "opacity");
  const plainT = transitionOf(plus.querySelector(":scope > .tint"), "opacity");
  check("End: the + is over Field Notes now; its mixed layer fades out while the plain tint fades in, both 150 ms", !plus.classList.contains("mixed") && !!mixT && !!plainT && mixT.effect.getComputedTiming().duration === 150 && plainT.effect.getComputedTiming().duration === 150, { mix: mixT?.effect.getComputedTiming().duration, plain: plainT?.effect.getComputedTiming().duration });
  spike.press("Enter");
  await sleep(300);
  b.focusPage();
  await sleep(200);

  log("--- 4. swap sides: the halves' contents cross over (320 ms), the pages fade in (150 ms)");
  b.swapSides();
  const crossL = SL.half("left").querySelector(".half-main").getAnimations();
  const crossR = SL.half("right").querySelector(".half-main").getAnimations();
  const fades = [SL.panel(fn), SL.panel(tl)].map((x) => x.getAnimations());
  if (!reduced) check("the halves' contents cross over on the spring (320 ms)", crossL.some((a) => timing(a).duration === 320 && /translateX\(\d+px\)/.test(frames(a))) && crossR.some((a) => timing(a).duration === 320 && /translateX\(-\d+px\)/.test(frames(a))), { l: crossL.map(frames), r: crossR.map(frames) });
  else check("reduced: the halves do not slide", !crossL.length && !crossR.length);
  check("both pages fade in over 150 ms after the swap", fades.every((f) => f.some((a) => timing(a).duration === 150 && frames(a).includes("opacity"))), fades.map((f) => f.map(frames)));
  await sleep(500);
  b.swapSides();
  await sleep(500);

  log("--- 5. a pair <-> another tab: the pill and the capsule morph into each other (420 ms)");
  await SL.settled();
  b.activate(ln);
  await sleep(20);
  const widthT = transitionOf(SL.pairItem(), "width");
  if (!reduced) check("the pair's item narrows from the pill to the capsule on the spring (420 ms), under the morph frost", !!widthT && widthT.effect.getComputedTiming().duration === 420 && SL.pairItem().classList.contains("morphing"), widthT && widthT.effect.getComputedTiming());
  else check("reduced: no width motion (opacity only)", !widthT);
  await sleep(600);
  check("the capsule at rest: 96 x 44", Math.round(SL.pairItem().getBoundingClientRect().width) === 96);
  // Going to or from a pair in the background is a tab switch: the glass theme changes at once, as
  // for any tab (only focus moves, a pair forming or ending cross-fade it).
  b.activate(tl);
  await sleep(500);
  check("set-up: Tideline (dark) focused in the pair", b.root.classList.contains("theme-dark") && b.splitView.showing()?.right === tl);
  b.activate(ln);
  await sleep(20);
  check("from the pair (dark) to Links (light): the theme changes at once, no veil", b.root.classList.contains("theme-light") && !document.querySelector("#vitre-bar .sv-veil"));
  await sleep(500);
  b.activate(tl);
  await sleep(20);
  check("…and back to the pair on its dark side: at once too", b.root.classList.contains("theme-dark") && !document.querySelector("#vitre-bar .sv-veil"));
  await sleep(500);
  b.activate(fn);
  await sleep(600);

  log("--- 6. Separate tabs (a gesture): the other pane's picture slides out, its half goes back to its circle");
  await SL.settled();
  const motionLayer = () => document.getElementById("layer-split-motion");
  let leaving = false;
  const seen = new MutationObserver(() => {
    if (document.querySelector("#layer-split-motion > .sv-leaving")) leaving = true;
  });
  seen.observe(b.root, { childList: true, subtree: true });
  const pairX = SL.pairItem().getBoundingClientRect().x;
  let ghostSeen = false;
  const watchGhost = new MutationObserver(() => {
    if (ghosts().length) ghostSeen = true;
  });
  watchGhost.observe(document.getElementById("vitre-bar"), { childList: true });
  const fnPane = SL.rect(SL.panel(fn));
  const rimsOut = [];
  const watchRims = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains("sv-rim-out")) rimsOut.push(n);
  });
  watchRims.observe(b.root, { childList: true, subtree: true });
  b.separate(undefined, { animate: true });
  check("the pair stays until its other pane is pictured (at most 150 ms)", !!b.splitView.active());
  await SL.until(() => !b.splitView.active(), 2000);
  watchRims.disconnect();
  const fnNow = SL.rect(SL.panel(fn));
  if (!reduced) check("then Field Notes keeps its pane (place and width) while Tideline's picture slides out (spec: then the page widens)", b.splitView.held === fn && fnNow.x === fnPane.x && Math.abs(fnNow.w - fnPane.w) <= 1, { held: b.splitView.held?.title, fnPane, fnNow });
  else check("reduced: Field Notes fills the window at once under the fading picture (a cross-fade)", !b.splitView.held && fnNow.w >= Math.floor(window.innerWidth) - 1, fnNow);
  check("both rims fade out (" + (reduced ? 150 : 200) + " ms) as the pair ends", rimsOut.length === 2 && rimsOut.every((r) => r.getAnimations().some((a) => timing(a).duration === (reduced ? 150 : 200))), rimsOut.length);
  const fnItem = b.bar.item(fn.id);
  const tlItem = b.bar.item(tl.id);
  if (!reduced) {
    const slide = transitionOf(fnItem, "left");
    const from = slide ? parseFloat(slide.effect.getKeyframes()[0].left) : NaN;
    check("the remaining side's pill starts on the pair's slot and slides to its own (420 ms)", !!slide && near(from, pairX, 2) && slide.effect.getComputedTiming().duration === 420, { from, pairX });
    check("Tideline's half morphs back into its circle (a ghost); the circle waits for it", ghostSeen && tlItem.classList.contains("sv-hidden"), { ghostSeen, cls: tlItem.className });
    const recentre = fnItem.querySelector(".address").getAnimations();
    check("the remaining favicon and host re-centre (240 ms)", recentre.some((a) => timing(a).duration === 240), recentre.map(frames));
  } else check("reduced: no ghost, no slide", !ghostSeen && !transitionOf(fnItem, "left"));
  await sleep(500);
  check("Tideline's pane went as a picture sliding out (pictured first, at most 150 ms)", leaving, { leaving, layer: !!motionLayer() });
  check("after the motion: Tideline's circle is drawn, no ghost, no picture or rim left, Field Notes fills the window", !tlItem.classList.contains("sv-hidden") && !ghosts().length && !document.querySelector("#layer-split-motion > :is(.sv-leaving, .sv-rim-out)") && !b.splitView.held && SL.rect(SL.panel(fn)).w >= Math.floor(window.innerWidth) - 1);
  watchGhost.disconnect();

  log("--- 7. close one side (Ctrl+W): its half collapses into the seam (280 ms); the pill keeps its slot");
  b.split(tl);
  await SL.shown();
  await sleep(700);
  await SL.settled();
  b.activate(tl);
  await sleep(500);
  const slot = SL.pairItem().getBoundingClientRect().x;
  let collapsed = false;
  const watchCollapse = new MutationObserver(() => {
    const c = document.querySelector("#vitre-bar > .sv-collapse");
    if (c && c.getAnimations().some((a) => timing(a).duration === 280)) collapsed = true;
  });
  watchCollapse.observe(document.getElementById("vitre-bar"), { childList: true });
  b.focusPage();
  await sleep(150);
  const pillMixed = SL.pairItem().classList.contains("mixed");
  spike.press("Ctrl+W");
  await SL.until(() => !b.tabs.includes(tl), 3000);
  await sleep(20);
  watchCollapse.disconnect();
  if (!reduced) {
    const rest = b.bar.item(fn.id);
    const settleT = transitionOf(rest?.querySelector(":scope > .tint-mix"), "opacity");
    check("the remaining pill was in the mixed tint (over Field Notes, dark glass) and settles out of it over 200 ms (spec Close one side)", pillMixed && !!settleT && settleT.effect.getComputedTiming().duration === 200 && !rest.classList.contains("mixed"), { pillMixed, d: settleT?.effect.getComputedTiming().duration });
  }
  if (!reduced) check("the closed side's half collapses into the seam on the spring (280 ms)", collapsed);
  else check("reduced: no collapse motion", !collapsed);
  check("the remaining side's pill keeps the pair's slot", near(b.bar.item(fn.id).getBoundingClientRect().x, slot, 30) && b.active() === fn, { now: b.bar.item(fn.id).getBoundingClientRect().x, slot });
  await sleep(500);
  check("after it: no copy of the half left", !document.querySelector("#vitre-bar > .sv-collapse"));
  seen.disconnect();
  log("leaving picture seen (separate or close): " + leaving);

  log("--- 8. New tab in split view: the group cross-fades to the Home side's glass");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  const veilsMade = [];
  const spy = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains("sv-veil")) veilsMade.push(n.className);
  });
  spy.observe(document.getElementById("vitre-bar"), { childList: true, subtree: true });
  b.split("home");
  await SL.until(() => b.active()?.kind === "home" && b.splitView.active(), 3000);
  await sleep(100);
  spy.disconnect();
  const homeTheme = ["light", "dark", "clear"].find((x) => b.root.classList.contains("theme-" + x));
  if (homeTheme !== "light") check("light veils fade out as the group takes the Home side's " + homeTheme + " glass", veilsMade.length >= 1 && veilsMade.every((c) => c.includes("theme-light")), veilsMade);
  else log("Home's glass is light here too: nothing to cross-fade (" + veilsMade.length + " veils)");
  await sleep(400);
  b.omni.close();
  await sleep(200);
  b.separate();
  await sleep(500);

  log("--- 9. a collapse fades the hidden pane (150 ms); a collapsed split comes back with the motion of a pair forming");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(700);
  const realAnimate = Element.prototype.animate;
  const hiding = [];
  Element.prototype.animate = function (kf, opts) {
    const a = realAnimate.call(this, kf, opts);
    if (this.classList?.contains("browserContainer")) hiding.push(a);
    return a;
  };
  await spike.resize(620, 800);
  await SL.until(() => b.splitView.collapsed, 4000);
  Element.prototype.animate = realAnimate;
  const fadeOut = hiding.filter((a) => target(a) === SL.panel(tl).querySelector(".browserContainer") && /"opacity":"1"/.test(frames(a)) && timing(a).duration === 150);
  check("narrowed under 648 px: the hidden pane (Tideline) fades out over 150 ms (spec Collapse / restore), then hides", fadeOut.length === 1, hiding.map((a) => [frames(a), timing(a).duration]));
  await SL.until(() => gBrowser.tabpanels.hasAttribute("vitre-collapsed"), 2000);
  await sleep(50);
  check("…then vitre-collapsed hides it and its own opacity is back (the fade is cancelled)", getComputedStyle(SL.panel(tl)).display === "none" && !SL.panel(tl).querySelector(".browserContainer").getAnimations().some((a) => a.playState !== "finished" && /"opacity":"1"/.test(frames(a))), getComputedStyle(SL.panel(tl)).display);
  await sleep(300);
  // Record what is animated as the window comes back (the resize may take longer than the motion).
  const made = [];
  Element.prototype.animate = function (kf, opts) {
    const a = realAnimate.call(this, kf, opts);
    if (this.classList?.contains("browserContainer")) made.push(a);
    return a;
  };
  await spike.resize(1200, 860);
  await SL.until(() => !b.splitView.collapsed && b.splitView.showing(), 4000);
  await sleep(50);
  Element.prototype.animate = realAnimate;
  const back = made.filter((a) => target(a) === SL.panel(tl).querySelector(".browserContainer"));
  if (!reduced) check("restored: the pane that was hidden slides in 24 px and fades in", back.some((a) => frames(a).includes("translateX(24px)")), back.map(frames));
  else check("restored (reduced): it fades in", back.some((a) => frames(a).includes("opacity")), back.map(frames));
  await spike.resize(1440, 900);
  await sleep(600);

  log("--- 10. an unpainted page keeps a frosted cover until it paints (at most 600 ms)");
  [fn, tl, ln] = await SL.scene(["dark.html"]);
  await SL.settled();
  const fresh = b.newTab(http("links.html?fresh"), { background: true, index: b.tabs.length });
  b.split(fresh);
  const frost = document.querySelector("#vitre-split > .sp-frost");
  check("a pane whose page has not painted yet gets the frosted cover over it", !!frost && near(SL.rect(frost).x, SL.panes().right.x, 2), frost && SL.rect(frost));
  await sleep(900);
  check("the cover is gone once the page painted (or 600 ms passed)", !document.querySelector("#vitre-split > .sp-frost"));
  await spike.capture("motion-2-formed-fresh");

  log("--- 11. without a split nothing of this happens: closing and opening tabs as before");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  b.activate(tl);
  await sleep(20);
  check("a tab switch: no ghost, no veil, no tint layer shown", !ghosts().length && !document.querySelector("#vitre-bar .sv-veil") && [...document.querySelectorAll("#vitre-bar .item > .tint-mix")].every((x) => getComputedStyle(x).opacity === "0"));
  b.closeTab(ln);
  await sleep(20);
  check("a tab closed: its circle fades as before (leaving), no ghost", !ghosts().length && !!document.querySelector("#vitre-bar .item.leaving"));
  await sleep(500);

  log("--- 12. split forms, measured frame by frame: the ghost lands on its half; the glass over the new pane takes the mixed tint in " + (reduced ? 150 : 200) + " ms");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  await SL.settled();
  await sleep(300);
  b.split(tl);
  const pill = SL.pairItem();
  const tintMs = reduced ? 150 : 200;
  const pillMix = transitionOf(pill.querySelector(":scope > .tint-mix"), "opacity");
  const plusMix = transitionOf(document.querySelector("#vitre-bar .item.plus > .tint-mix"), "opacity");
  check("the split pill cross-fades into the mixed tint over " + tintMs + " ms (it spans Tideline's pane; it is not switched at once)", pill.classList.contains("mixed") && !!pillMix && pillMix.effect.getComputedTiming().duration === tintMs, pillMix?.effect.getComputedTiming().duration);
  check("…and so does the + over Tideline (" + tintMs + " ms, not the gutter's 150 ms)", !!plusMix && plusMix.effect.getComputedTiming().duration === tintMs, plusMix?.effect.getComputedTiming().duration);
  if (!reduced) {
    const gfav = document.querySelector("#vitre-bar > .sv-ghost .g-fav svg");
    check("the ghost draws the joining circle's globe as an outline (fill none), as the bar does", !!gfav && getComputedStyle(gfav).fill === "none", gfav && getComputedStyle(gfav).fill);
    const samples = [];
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const gh = ghosts()[0];
        if (gh) samples.push({ t: Math.round(performance.now() - t0), x: gh.getBoundingClientRect().x, w: gh.getBoundingClientRect().width, fav: gh.querySelector(".g-fav").getBoundingClientRect().x });
        if (performance.now() - t0 < 600) requestAnimationFrame(step);
        else res();
      };
      step();
    });
    const last = samples[samples.length - 1];
    const half = SL.half("right").getBoundingClientRect();
    const hfav = SL.half("right").querySelector(".fav").getBoundingClientRect();
    const acc = SL.pairItem().querySelector(".split-face .accessories").getBoundingClientRect().width;
    check("the joining circle's ghost lands on the right half as laid out with the extension buttons (" + Math.round(acc) + " px): no jump when it hands over", !!last && last.t > 330 && near(last.x, half.x, 2) && near(last.w, half.width, 2) && near(last.fav, hfav.x, 2), { last, half: [half.x, half.width], fav: hfav.x });
  }
  await sleep(700);
  log("done");
});
