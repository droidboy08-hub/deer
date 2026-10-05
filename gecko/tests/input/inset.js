// The page top inset (src/actors/page/inset.ts): pages start below the bar with a strip of the bar
// area's height in their own colour, which scrolls away with them.
//   python tools/run.py --test tests/input/inset.js --name input-inset --timeout 300
// Captures (tests/input/out): inset-<case>-0.png at scroll 0 and inset-<case>-300.png after scrolling
// 300 px. Cases: white (strict CSP), dark, fixed header, sticky header, absolute header, a fixed
// header in a closed shadow root, dark wrapper (colour fallback), app layouts (locked / 100vh /
// border-box 100%), the setting off and on, back / forward cache, same-document navigation, an
// iframe, page zoom, a page that fights the push, text/plain and view-source, and two real sites
// (Wikipedia, DuckDuckGo results).
/* global spike, K, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { load, inPage, pageURL } = K;
  const Settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  const BAR = 68;

  await spike.resize(1280, 800);
  await spike.activate();

  const state = (selector, t = b.active()) => b.page(t).query("inset:state", selector ? { selector } : {});
  const recheck = (selector, t = b.active()) => b.page(t).query("inset:check", selector ? { selector } : {});
  const scroll = (y) => inPage(`function (w, d) { w.scrollTo({ top: ${y}, left: 0, behavior: "instant" }); return w.scrollY; }`);
  /** Geometry of the page as it is now (viewport px): what paints in the bar band, the top of the
   * highest visible element, the strip (root padding), a selector's box. */
  const geo = (selector = "#title") =>
    inPage(`function (w, d) {
      const root = d.documentElement, body = d.body;
      const W = root.clientWidth, H = (d.scrollingElement || root).clientHeight;
      let minTop = Infinity, minEl = "";
      const all = body ? body.querySelectorAll("*") : [];
      for (let i = 0; i < Math.min(all.length, 5000); i++) {
        const el = all[i];
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.left >= W || r.top >= H) continue;
        if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (r.top < minTop) { minTop = r.top; minEl = el.localName + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/)[0] : ""); }
      }
      const band = new Set();
      for (const y of [2, 34, 66]) for (let i = 0; i < 9; i++) for (const el of d.elementsFromPoint(W * (0.02 + 0.12 * i), y)) if (el !== root && el !== body) band.add(el.localName + (el.id ? "#" + el.id : ""));
      const sel = d.querySelector(${JSON.stringify(selector)});
      const r = sel ? sel.getBoundingClientRect() : null;
      return {
        minTop: Math.round(minTop * 10) / 10, minEl, band: [...band].slice(0, 10), bandCount: band.size,
        padding: w.getComputedStyle(root).paddingTop, rootTop: root.getBoundingClientRect().top,
        scrollY: w.scrollY, H, S: (d.scrollingElement || root).scrollHeight,
        sel: r ? { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height) } : null,
        canvas: w.getComputedStyle(body || root).backgroundColor,
      };
    }`);
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;
  const settle = async (ms = 900) => { await sleep(ms); };
  async function open(leaf, query) {
    await load(pageURL(leaf, query));
    await settle();
  }
  /** Capture at scroll 0 and after scrolling `by`; returns the two geometries. */
  async function both(name, selector = "#title", by = 300) {
    await scroll(0);
    await sleep(500);
    const g0 = await geo(selector);
    const s0 = await state();
    await spike.capture(`inset-${name}-0`);
    await scroll(by);
    await sleep(600);
    const g1 = await geo(selector);
    await spike.capture(`inset-${name}-${by}`);
    await scroll(0);
    await sleep(300);
    log(`${name}:`, { g0, g1, state: { applied: s0.applied, decision: s0.decision, px: s0.px, colour: s0.colour, pushed: s0.pushed, S: s0.S, H: s0.H, scanMs: s0.scanMs, why: s0.why } });
    return { g0, g1, s0 };
  }

  // ---- defaults ----
  check("setting pageInset defaults to true", Settings.get().pageInset === true && b.settings.pageInset === true && Services.prefs.getBoolPref("vitre.pageInset") === true, Settings.get().pageInset);

  // ---- (a) a plain white page with a strict CSP ----
  await open("inset-white.html");
  let r = await both("a-white");
  check("(a) white page: the strip is in (root padding 68 px, decision scrolls)", r.s0.applied && r.s0.decision === "scrolls" && r.g0.padding === "68px", r.s0);
  check("(a) at scroll 0 nothing of the page is under the bar: highest element top >= 68, the band shows only the canvas", r.g0.minTop >= BAR && r.g0.bandCount === 0 && r.g0.sel.top >= BAR, r.g0);
  check("(a) after scrolling 300 px the strip is gone (title moved up 300, root top -300)", near(r.g1.sel.top, r.g0.sel.top - 300) && near(r.g1.rootTop, -300) && r.g1.bandCount > 0, r.g1);
  check("(a) the strict CSP page still got the sheet (user sheets are not subject to it)", r.g0.padding === "68px");
  await waitFor(() => b.theme() === "light", { timeout: 3000, what: "light glass" }).catch(() => {});
  check("(a) glass theme over the white strip: light", b.theme() === "light", b.theme());

  // ---- (b) a dark page ----
  await open("inset-dark.html");
  r = await both("b-dark");
  check("(b) dark page: strip in, title below the bar, band clear", r.s0.applied && r.g0.minTop >= BAR && r.g0.bandCount === 0 && r.g0.canvas === "rgb(16, 16, 20)", r.g0);
  await waitFor(() => b.theme() === "dark", { timeout: 3000, what: "dark glass" }).catch(() => {});
  check("(b) glass theme over the dark strip: dark", b.theme() === "dark", b.theme());
  check("(b) after scrolling 300 px the strip is gone", near(r.g1.sel.top, r.g0.sel.top - 300) && near(r.g1.rootTop, -300), r.g1);

  // ---- (c) a fixed header at top 0 ----
  await open("inset-fixed.html");
  r = await both("c-fixed", "#hdr");
  const hdrPush = r.s0.pushed.find((p) => p.id === "hdr");
  check("(c) fixed header pushed by margin-top: calc(0px + var(--vitre-inset)) !important = 68px", hdrPush && hdrPush.kind === "fixed" && hdrPush.prop === "margin-top" && /var\(--vitre-inset/.test(hdrPush.value) && hdrPush.computed === "68px", r.s0.pushed);
  check("(c) at scroll 0 the header sits at 68 and nothing else is in the band", r.g0.sel.top === BAR && r.g0.bandCount === 0 && r.g0.minTop >= BAR, r.g0);
  check("(c) scrolled 300: the header stays below the bar (68), the content scrolls under the glass", r.g1.sel.top === BAR && r.g1.bandCount > 0 && near(r.g1.rootTop, -300), r.g1);
  const titleFixed = (await geo("#title")).sel;
  check("(c) the first content is below the header (68 + 56 + its margin)", titleFixed.top >= BAR + 56, titleFixed);

  // ---- (d) a sticky header ----
  await open("inset-sticky.html");
  r = await both("d-sticky", "#hdr");
  const sticky = r.s0.pushed.filter((p) => p.kind === "sticky");
  check("(d) sticky header and the sticky table header cells are pushed (top + 68)", sticky.some((p) => p.id === "hdr" && p.prop === "top" && p.computed === "68px") && sticky.some((p) => p.tag === "th" && p.computed === "120px"), sticky);
  check("(d) at scroll 0 the sticky header is in the flow below the strip (68)", r.g0.sel.top === BAR && r.g0.bandCount === 0, r.g0);
  check("(d) scrolled 300: it sticks at 68, below the bar, not under it", r.g1.sel.top === BAR && r.g1.bandCount > 0, r.g1);
  await scroll(4200);
  await sleep(500);
  const th = (await geo("th")).sel;
  await spike.capture("inset-d-sticky-table");
  check("(d) the sticky table header sticks below the sticky page header (68 + 52)", th && th.top === BAR + 52, th);
  await scroll(0);

  // ---- absolute header anchored to the initial containing block ----
  await open("inset-abs.html");
  r = await both("abs", "#abs");
  check("absolute header at top 0 of the document is pushed with the content (margin-top)", r.s0.pushed.some((p) => p.id === "abs" && p.kind === "absolute") && r.g0.sel.top === BAR && r.g0.bandCount === 0, { pushed: r.s0.pushed, g0: r.g0 });
  check("absolute header scrolls away with the page", near(r.g1.sel.top, BAR - 300), r.g1);

  // ---- a fixed header inside a closed shadow root ----
  await open("inset-shadow.html");
  r = await both("shadow");
  check("fixed header inside a closed shadow root is found (flat tree) and pushed; band clear at scroll 0", r.s0.pushed.some((p) => p.id === "shdr" && p.kind === "fixed") && r.g0.bandCount === 0 && r.g0.sel.top >= BAR + 56, { pushed: r.s0.pushed, g0: r.g0 });

  // ---- colour fallback: transparent root and body, dark wrapper ----
  await open("inset-wrapper.html");
  r = await both("wrapper");
  check("dark wrapper page: the strip takes the wrapper's colour (root and body have none)", r.s0.applied && r.s0.colour === "rgb(18, 20, 24)" && r.g0.bandCount === 0, r.s0);
  await waitFor(() => b.theme() === "dark", { timeout: 3000, what: "dark glass" }).catch(() => {});
  check("dark wrapper page: glass theme dark", b.theme() === "dark", b.theme());

  // ---- (e) app layouts ----
  for (const [variant, expect] of [["locked", "skip:locked"], ["vh", "skip:fitted"], ["bb", "fits"]]) {
    await open("inset-app.html", variant);
    const g = await geo("#foot");
    const s = await state();
    await spike.capture(`inset-e-app-${variant}`);
    log(`app ${variant}:`, { g, decision: s.decision, applied: s.applied, S: s.S, H: s.H, flips: s.flips });
    check(`(e) app layout ${variant}: decision ${expect}`, s.decision === expect && s.applied === (expect === "fits"), s);
    check(`(e) app layout ${variant}: the bottom edge (status bar) stays at the bottom of the window, no page scroll`, g.sel && near(g.sel.bottom, g.H) && g.S === g.H, g);
    if (expect === "fits") check("(e) border-box 100% app: the strip is in and the app shrinks below it (toolbar at 68)", (await geo("#top")).sel.top === BAR);
    else check(`(e) app layout ${variant}: the app's toolbar keeps its place at the top (as before)`, (await geo("#top")).sel.top === 0);
  }

  // ---- (g) the setting off and on at runtime ----
  await open("inset-fixed.html");
  await scroll(400);
  await sleep(300);
  const onScrolled = await geo("#title");
  Settings.set({ pageInset: false });
  await waitFor(async () => !(await state()).applied, { timeout: 3000, what: "strip removed" });
  await sleep(300);
  const offScrolled = await geo("#title");
  const offState = await state("#hdr");
  await spike.capture("inset-g-off-scrolled");
  check("(g) off at runtime: root padding 0, the header gets its own style back (top 0)", offScrolled.padding === "0px" && offState.pushed.length === 0 && offState.rect.top === 0 && offState.decision === "off", { offScrolled, offState });
  check("(g) off while scrolled: the content stays where it was (scroll position moves with the strip)", near(offScrolled.sel.top, onScrolled.sel.top) && near(offScrolled.scrollY, onScrolled.scrollY - BAR), { on: onScrolled, off: offScrolled });
  await scroll(0);
  await sleep(300);
  const off0 = await geo("#title");
  await spike.capture("inset-g-off-0");
  check("(g) off: the page starts at the top of the window again (title under the header at 0)", off0.padding === "0px" && off0.minTop === 0, off0);
  Settings.set({ pageInset: true });
  await waitFor(async () => (await state()).applied, { timeout: 3000, what: "strip back" });
  await sleep(300);
  const on0 = await geo("#hdr");
  await spike.capture("inset-g-on-0");
  check("(g) on again: strip and header push are back", on0.padding === "68px" && on0.sel.top === BAR && on0.bandCount === 0, on0);

  // ---- (h) back / forward cache and same-document navigation ----
  const shows = [];
  const offMsg = b.on("page-message", (_t, name, data) => { if (name === "core:pageshow") shows.push(data); });
  await open("inset-fixed.html", "bf");
  await scroll(250);
  await open("inset-dark.html");
  shows.length = 0;
  gBrowser.goBack();
  await waitFor(() => shows.some((d) => d.persisted), { timeout: 8000, what: "pageshow from the bfcache" }).catch(() => {});
  await sleep(500);
  let hs = await state("#hdr");
  let hg = await geo("#hdr");
  await spike.capture("inset-h-bfcache-restored");
  log("bfcache restore:", { shows, hs: { applied: hs.applied, why: hs.why, pushed: hs.pushed, rect: hs.rect }, hg });
  check("(h) back: the page came from the bfcache", shows.some((d) => d.persisted), shows);
  check("(h) bfcache restore: strip and header push still in place, scroll position kept", hs.applied && hs.why === "restored" && hg.padding === "68px" && hg.sel.top === BAR && near(hg.scrollY, 250), { hs, hg });
  // The setting changes while the page sits in the bfcache: it must follow on restore.
  await open("inset-dark.html", "2");
  Settings.set({ pageInset: false });
  await sleep(400);
  shows.length = 0;
  gBrowser.goBack();
  await waitFor(() => shows.some((d) => d.persisted), { timeout: 8000, what: "pageshow from the bfcache (2)" }).catch(() => {});
  await sleep(500);
  hs = await state("#hdr");
  hg = await geo("#hdr");
  check("(h) setting turned off while the page was in the bfcache: restored without the strip", shows.some((d) => d.persisted) && !hs.applied && hg.padding === "0px" && hg.sel.top === 0, { shows, hs, hg });
  Settings.set({ pageInset: true });
  await waitFor(async () => (await state()).applied, { timeout: 3000, what: "strip back after bfcache" });
  offMsg();
  // Same-document navigation: the article becomes an app view (pushState) and back.
  await open("inset-spa.html");
  const spa0 = await state();
  check("(h) SPA article: strip in", spa0.applied && spa0.decision === "scrolls", spa0);
  await K.evalInPage("go('app')");
  await waitFor(async () => !(await state()).applied, { timeout: 4000, what: "strip off for the app view" }).catch(() => {});
  const spaApp = await state("#foot");
  await spike.capture("inset-h-spa-app");
  check("(h) pushState to an app view (100vh, overflow hidden): strip removed, status bar at the bottom", !spaApp.applied && spaApp.decision === "skip:locked" && spaApp.why === "navigation" && near(spaApp.rect.bottom, spaApp.H), spaApp);
  await K.evalInPage("go('article')");
  await waitFor(async () => (await state()).applied, { timeout: 4000, what: "strip back for the article" }).catch(() => {});
  const spaBack = await state("#title");
  await spike.capture("inset-h-spa-article");
  check("(h) pushState back to the article: strip back, title below the bar", spaBack.applied && spaBack.rect.top >= BAR && spaBack.flips <= 2, spaBack);
  // popstate (same document) back to the app view. history.back() from the page: the browser's own
  // Back skips entries a page pushed without user interaction (browser.navigation.requireUserInteraction).
  await K.evalInPage("history.back()");
  await waitFor(async () => !(await state()).applied, { timeout: 4000, what: "strip off after popstate" }).catch(() => {});
  check("(h) history back (popstate, same document) re-checks too", !(await state()).applied);

  // ---- (i) an iframe ----
  await open("inset-frame.html");
  const frames = await b.page(b.active()).queryAll("inset:state", { selector: "#title" });
  const topF = frames.find((f) => f.isTop)?.answer;
  const sub = frames.filter((f) => !f.isTop).map((f) => f.answer);
  log("frames:", frames.map((f) => ({ isTop: f.isTop, answer: f.answer })));
  const subState = sub[0];
  check("(i) the top document has the strip", topF && topF.applied && topF.padding === "68px", topF);
  check("(i) the iframe's document is not inset (padding 0, its title at its own top)", sub.length === 1 && subState && !subState.applied && subState.reason === "frame" && subState.padding === "0px" && subState.rect && subState.rect.top === 0, sub);
  await spike.capture("inset-i-frame-0");

  // ---- page zoom ----
  await open("inset-white.html");
  gBrowser.selectedBrowser.fullZoom = 1.5;
  await waitFor(async () => Math.abs((await state()).px - BAR / 1.5) < 0.01, { timeout: 4000, what: "strip re-applied for the zoom" }).catch(() => {});
  const zs = await state("#title");
  await spike.capture("inset-zoom-150");
  check("zoom 150%: the strip is 68/1.5 page px = 68 window px, title still below the bar", Math.abs(parseFloat(zs.padding) - BAR / 1.5) < 0.05 && zs.rect.top * 1.5 >= BAR, zs);
  gBrowser.selectedBrowser.fullZoom = 1;
  await waitFor(async () => (await state()).px === BAR, { timeout: 4000, what: "zoom back" }).catch(() => {});

  // ---- a page that keeps resetting its header's style ----
  await open("inset-fight.html");
  for (let i = 0; i < 8; i++) {
    await sleep(200);
    await recheck();
  }
  const fight = await state("#hdr");
  log("fight:", fight);
  check("a page that resets its header's inline style: pushed at most 3 times, then left alone (no loop)", fight.yielded === 1 && fight.pushed.length === 0 && fight.ops <= 3, fight);

  // ---- text/plain and view-source ----
  await load("data:text/plain;charset=utf-8," + encodeURIComponent(Array.from({ length: 80 }, (_, i) => `line ${i + 1}: plain text document`).join("\n")));
  await settle();
  const plain = await state();
  const plainG = await geo("pre");
  await spike.capture("inset-text-plain");
  check("text/plain: strip in, text below the bar", plain.applied && plainG.minTop >= BAR, { plain, plainG });
  await load("view-source:" + pageURL("inset-fixed.html"));
  await settle();
  const vs = await state();
  const vsG = await geo("pre");
  await spike.capture("inset-view-source");
  check("view-source: strip in, source below the bar", vs.applied && vsG.minTop >= BAR, { vs: { applied: vs.applied, reason: vs.reason, decision: vs.decision }, vsG });

  // ---- excluded documents ----
  await load("about:vitre-home");
  await settle(500);
  const home = await state();
  check("Home is never inset", !home.applied && (home.reason === "scheme" || home.reason === "not started"), home);
  const img = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  img.initWithPath(Services.env.get("VITRE_BOOT"));
  const homeDark = img.parent.clone();
  homeDark.append("out");
  homeDark.append("home-dark.jpg");
  if (homeDark.exists()) {
    await load(Services.io.newFileURI(homeDark).spec);
    await settle(500);
    const imgState = await state();
    check("image documents are not inset", !imgState.applied && imgState.reason === "media", imgState);
  }

  // ---- (f) real sites ----
  for (const [name, url, selector] of [["f-wikipedia", "https://en.wikipedia.org/wiki/Glass", "#firstHeading"], ["f-duckduckgo", "https://duckduckgo.com/?q=glass", "header, #header, [data-testid=header], .header"]]) {
    await load(url);
    await sleep(3000);
    const s = await state();
    if (!s.eligible) {
      log(`NOTE ${name}: not loaded (${s.url}) ${s.reason}`);
      continue;
    }
    r = await both(name, selector);
    log(`${name} theme:`, b.theme());
    check(`(f) ${name}: strip in (${r.s0.decision})`, r.s0.applied && r.g0.padding === "68px", r.s0);
    check(`(f) ${name}: at scroll 0 nothing but the page's canvas paints under the bar; highest visible element at ${r.g0.minTop} (${r.g0.minEl})`, r.g0.bandCount === 0 && r.g0.minTop >= BAR - 0.5, r.g0);
    check(`(f) ${name}: after scrolling 300 px the strip is gone`, r.g1.rootTop <= -BAR, r.g1);
    const end = await state();
    log(`${name} checks:`, end.log);
    check(`(f) ${name}: the strip never went away while the page loaded (no flips)`, end.flips === 0, end.log);
  }

  Settings.set({ pageInset: true });
});
