// Settings verifier: forced colours (Windows contrast themes), reduced motion, the lens during the
// open motion (slowed down so a capture lands in the middle of it), About's version against
// package.json, and the accessible names and roles of the controls.
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/a11y.js --name settings-verify-a11y --timeout 240
// Captures: a11y-forced-colors.png, a11y-forced-colors-shortcuts.png, a11y-open-motion.png
// (mid-open, slowed 20x), a11y-reduced-motion.png.
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, IOUtils, PathUtils */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const svc = b.service("settings");
  const store = b.sys("VitreSettings");
  store.set({ theme: "dark" });
  await V.load(V.page("Article", "<div style='max-width:760px;margin:0 auto;padding:110px 24px'><h1 style='font:600 44px Georgia'>Float glass</h1>" + "<p>Crown glass was spun into a disc and cylinder glass was blown, slit and flattened.</p>".repeat(10) + "</div><div style='position:fixed;right:40px;top:180px;width:220px;height:300px;border-radius:14px;background:#c46a3b'></div>"));

  // ---------------------------------------------------------------- the lens during the open motion
  b.css("settings-verify-slow", "#vitre-root .vs-sheet { transition-duration: 5600ms !important; } #vitre-root :is(.vs-tint, .vs-rim, .vs-body) { transition-duration: 3200ms !important; }");
  svc.open("appearance");
  await sleep(900);
  const mid = parseFloat(getComputedStyle(V.sheet()).scale);
  check("mid-open (slowed): the sheet is still scaling and its lens is already on", mid > 0.955 && mid < 0.999 && getComputedStyle(V.root().querySelector(".vs-lens")).visibility === "visible", { scale: mid });
  await spike.capture("a11y-open-motion");
  panel.close();
  await sleep(200);
  document.getElementById("css-settings-verify-slow")?.remove();
  await sleep(300);

  // ---------------------------------------------------------------- reduced motion
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await waitFor(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, { timeout: 5000, what: "reduced motion" });
  svc.open("tabs");
  await sleep(30);
  const rm = { scale: getComputedStyle(V.sheet()).scale, transition: getComputedStyle(V.sheet()).transitionProperty, knob: getComputedStyle(V.root().querySelector(".vs-knob") ?? V.root()).transitionDuration };
  check("reduced motion: no scale on the sheet (150 ms cross-fade only)", (rm.scale === "none" || rm.scale === "1") && !/scale/.test(rm.transition), rm);
  await sleep(500);
  await spike.capture("a11y-reduced-motion");
  panel.close();
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await sleep(400);

  // ---------------------------------------------------------------- forced colours
  // The chrome window's own override (what devtools' forced-colours simulation sets): the
  // ui.useAccessibilityTheme pref alone does not reach a chrome document under the harness.
  window.browsingContext.forcedColorsOverride = "active";
  const forced = await waitFor(() => window.matchMedia("(forced-colors: active)").matches, { timeout: 5000, what: "forced colours" }).then(() => true, () => false);
  check("forced colours can be simulated in the chrome", forced);
  if (forced) {
    svc.open("appearance");
    await sleep(700);
    const tint = getComputedStyle(V.root().querySelector(".vs-tint")).backgroundColor;
    const lens = getComputedStyle(V.root().querySelector(".vs-lens")).backdropFilter;
    const sw = V.rowFor("Start pages below the tab bar").querySelector(".vs-switch");
    check("forced colours: the sheet is a solid Canvas, no lens, the switch keeps its own colours", lens === "none" && !/rgba\(.*0\.\d+\)/.test(tint) && getComputedStyle(sw).forcedColorAdjust === "none", { tint, lens });
    const card = V.content().querySelector(".vs-card");
    const search = V.root().querySelector(".vs-search");
    const cur = getComputedStyle(V.root().querySelector('.vs-navitem[aria-current="page"]'), "::before").backgroundColor;
    check("forced colours: cards, the search field and the sheet keep a visible edge; the current page keeps its mark", getComputedStyle(card).outlineStyle === "solid" && getComputedStyle(search).outlineStyle === "solid" && getComputedStyle(V.sheet()).outlineStyle === "solid" && !/rgba\(0, 0, 0, 0\)/.test(cur), { card: getComputedStyle(card).outlineStyle, cur });
    await spike.capture("a11y-forced-colors");
    svc.open("shortcuts");
    await sleep(500);
    await spike.capture("a11y-forced-colors-shortcuts");
    panel.close();
  }
  window.browsingContext.forcedColorsOverride = "none";
  await sleep(500);

  // ---------------------------------------------------------------- About: the version is package.json's
  const pkgPath = PathUtils.join(PathUtils.parent(PathUtils.parent(PathUtils.parent(Services.env.get("VITRE_BOOT")))), "package.json");
  let pkg = null;
  try {
    pkg = JSON.parse(new TextDecoder().decode(await IOUtils.read(pkgPath)));
  } catch (e) {
    log("package.json: " + e);
  }
  svc.open("about");
  await sleep(400);
  const ver = V.rowFor("Deer")?.querySelector(".vs-desc")?.textContent;
  check("About shows the version in gecko/package.json", !!pkg && ver === `Version ${pkg.version}`, { about: ver, pkg: pkg && pkg.version });
  const engine = V.rowFor("Engine")?.querySelector(".vs-desc")?.textContent;
  check("About names the engine and Firefox version of this runtime", engine === `Gecko ${Services.appinfo.platformVersion}, from Firefox ${Services.appinfo.version}`, engine);

  // ---------------------------------------------------------------- names and roles
  const unnamed = [];
  for (const id of ["general", "appearance", "home", "tabs", "downloads", "privacy", "search", "shortcuts", "about"]) {
    svc.open(id);
    await sleep(id === "home" || id === "tabs" ? 700 : 250);
    for (const el of V.sheet().querySelectorAll("button, [role=switch], [role=radio], [role=checkbox], [role=textbox], input")) {
      if (el.closest("[hidden]") || !el.getClientRects().length) continue;
      const name = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((x) => x && document.getElementById(x)?.textContent).filter(Boolean).join(" ") || el.textContent.trim();
      if (!name) unnamed.push(`${id}: ${V.describe(el)}`);
    }
  }
  check("every control on every page has an accessible name", unnamed.length === 0, unnamed.slice(0, 10));
  const dlg = V.sheet();
  check("the sheet is a modal dialog named Settings; the sidebar marks the current page", dlg.getAttribute("role") === "dialog" && dlg.getAttribute("aria-modal") === "true" && document.getElementById(dlg.getAttribute("aria-labelledby"))?.textContent === "Settings" && V.root().querySelectorAll('.vs-navitem[aria-current="page"]').length === 1);
  panel.close();
  store.reset("theme");
  await sleep(300);
  V.consoleCheck("a11y");
});
