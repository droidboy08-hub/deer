// Edge cases of the page top inset (src/actors/page/inset.ts), written by its verifier. inset.js is the
// main battery; this one attacks it: the site's own root / body box model, background kinds, headers
// that come late or change on scroll, inner scrollers, element full screen, print preview, the PDF
// viewer and other excluded pages, zoom 50 % / 300 % and site zoom, pages that loop (style resets on
// every frame, scroll spies), cost on a 60 000-element page, a narrow window, ten tabs, a second window.
//   python tools/run.py --test tests/input/inset-edge.js --name input-edges --timeout 400
// (also: python tests/input/all.py edges)
// Captures (tests/input/out): inset-x-*.png.
/* global spike, K, gBrowser, Services, ChromeUtils, PrintUtils, IOUtils, PathUtils, Cc, Ci */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { load, inPage, pageURL, evalInPage } = K;
  const Settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  const BAR = 68;

  await spike.resize(1280, 800);
  await spike.activate();

  const state = (selector, t = b.active()) => b.page(t).query("inset:state", selector ? { selector } : {});
  const recheck = (selector, t = b.active()) => b.page(t).query("inset:check", selector ? { selector } : {});
  const scroll = (y, browser) => inPage(`function (w, d) { w.scrollTo({ top: ${y}, left: 0, behavior: "instant" }); return w.scrollY; }`, browser);
  const rect = (selector, browser) =>
    inPage(`function (w, d) {
      const el = d.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = w.getComputedStyle(el);
      return { top: Math.round(r.top * 100) / 100, bottom: Math.round(r.bottom * 100) / 100, height: Math.round(r.height), position: cs.position, marginTop: cs.marginTop, top_: cs.top, inline: el.getAttribute("style") || "" };
    }`, browser);
  /** What paints in the bar band (viewport y 2, 34, 66), the root padding, scroll. */
  const band = (browser) =>
    inPage(`function (w, d) {
      const root = d.documentElement, body = d.body, W = root.clientWidth;
      const seen = new Set();
      for (const y of [2, 34, 66]) for (let i = 0; i < 9; i++) for (const el of d.elementsFromPoint(W * (0.02 + 0.12 * i), y)) if (el !== root && el !== body) seen.add(el.localName + (el.id ? "#" + el.id : ""));
      return { band: [...seen].slice(0, 8), count: seen.size, padding: w.getComputedStyle(root).paddingTop, scrollY: w.scrollY, H: (d.scrollingElement || root).clientHeight, S: (d.scrollingElement || root).scrollHeight };
    }`, browser);
  const near = (a, c, tol = 1) => typeof a === "number" && Math.abs(a - c) <= tol;
  async function open(leaf, query, wait = 900) {
    await load(pageURL(leaf, query));
    await sleep(wait);
  }
  /** Mean luma of a band of the page (viewport px). */
  const lumaAt = (y, h, x = 200, w = 800) => b.luma(gBrowser.selectedBrowser, { x, y, width: w, height: h });
  const short = (s) => ({ applied: s.applied, decision: s.decision, px: s.px, padding: s.padding, colour: s.colour, pushed: s.pushed, why: s.why, log: s.log, checks: s.checks, ops: s.ops, yielded: s.yielded, flips: s.flips, scanMs: s.scanMs, checkMs: s.checkMs, checkMsMax: s.checkMsMax, checkMsTotal: s.checkMsTotal, times: s.times, probes: s.probes, probeMs: s.probeMs, probeMsMax: s.probeMsMax, parked: s.parked, rect: s.rect, reason: s.reason });
  async function section(name, fn) {
    log("--- " + name);
    try {
      await fn();
    } catch (e) {
      check(name + ": ran without an exception", false, String(e) + " " + (e.stack || "").split("\n").slice(0, 3).join(" | "));
    }
  }

  // ------------------------------------------------------------------ 1. the site's box model
  await section("box model", async () => {
    await open("inset-x-box.html", "rootpad");
    let hdr = await rect("#hdr"), title = await rect("#title"), s = await state();
    await spike.capture("inset-x-rootpad-0");
    log("rootpad:", { hdr, title, s: short(s) });
    check("html { padding-top: 56px } site: its fixed header is pushed to 68 and the content is not hidden under it (title top >= header bottom)", near(hdr.top, BAR) && title.top >= hdr.bottom - 0.5, { hdr, title, padding: s.padding });
    check("html { padding-top: 56px } site: the root padding is the strip plus the site's own (124 px)", s.padding === BAR + 56 + "px", s.padding);

    await open("inset-x-box.html", "wpbar");
    hdr = await rect("#hdr");
    title = await rect("#title");
    s = await state();
    await spike.capture("inset-x-wpbar-0");
    log("wpbar:", { hdr, title, s: short(s) });
    check("html { margin-top: 32px !important } with a fixed 32 px admin bar: the bar sits at 68, the content below it (>= 100)", near(hdr.top, BAR) && title.top >= hdr.bottom - 0.5, { hdr, title });

    await open("inset-x-box.html", "bodybox");
    title = await rect("#title");
    s = await state();
    const bb = await band();
    await spike.capture("inset-x-bodybox-0");
    log("bodybox:", { title, s: short(s), bb });
    check("body margin 40 + padding 20, background on html only: title at 68 + 60 = 128, nothing in the band", near(title.top, BAR + 60) && bb.count === 0, { title, bb });
    await waitFor(() => b.theme() === "dark", { timeout: 3000, what: "dark glass" }).catch(() => {});
    check("background on html only (dark): the strip is that colour, glass dark", b.theme() === "dark", b.theme());

    await open("inset-x-box.html", "bodyabs");
    title = await rect("#title");
    s = await state();
    await spike.capture("inset-x-bodyabs-0");
    log("bodyabs:", { title, s: short(s) });
    check("body { position: absolute; top: 0 }: the content still starts below the bar", title.top >= BAR, { title, s: short(s) });
  });

  // ------------------------------------------------------------------ 2. backgrounds and theme
  await section("backgrounds", async () => {
    const want = { bodydark: "dark", htmldark: "dark", none: "light", scheme: "dark", banner: "light", fixedbg: "dark", gradient: "light" };
    for (const v of Object.keys(want)) {
      await open("inset-x-bg.html", v);
      await scroll(0);
      await sleep(400);
      const s = await state("#hdr");
      const bb = await band();
      const strip = await lumaAt(4, 60);
      await waitFor(() => b.theme() === want[v], { timeout: 3000, what: v + " glass" }).catch(() => {});
      await spike.capture("inset-x-bg-" + v);
      log(`bg ${v}:`, { s: short(s), bb, stripLuma: strip, theme: b.theme() });
      check(`background ${v}: strip in, nothing but the canvas in the band, glass ${want[v]}`, s.applied && bb.count === 0 && b.theme() === want[v], { applied: s.applied, bb, theme: b.theme(), strip });
      if (v === "banner") {
        // The banner image is 120 px tall at the top of the page's background; the site's white
        // header text sits on it (#hdr, 120 px). Both must move together.
        const onBanner = await lumaAt(BAR + 70, 30, 600, 300); // inside the header box, 70..100 px below its top
        log("banner: luma inside the header box below the first 52 px:", onBanner, "header rect", s.rect);
        check("background image at the top: the banner moves down with the header text (dark behind the header text)", onBanner !== null && onBanner < 0.35, { onBanner, rect: s.rect });
      }
      if (v === "gradient") check("full-page gradient (repeats by default): left in place, the strip shows its top (white), not its dark end", s.origin === "" && strip !== null && strip > 0.9, { origin: s.origin, strip });
      if (v === "banner") check("banner image: background-origin moved below the strip (body)", s.origin === "body", s.origin);
      if (v === "scheme") check("color-scheme: dark with no background: the strip is the dark canvas", strip !== null && strip < 0.3, strip);
    }
  });

  // ------------------------------------------------------------------ 3. headers that come late or change
  await section("late headers", async () => {
    await open("inset-x-late.html", "late1500", 0);
    await waitFor(async () => (await rect("#hdr")) !== null, { timeout: 5000, what: "late header" });
    const appeared = Date.now();
    await sleep(300);
    const early = await rect("#hdr");
    await sleep(2600);
    const later = await rect("#hdr");
    const s = await state();
    await spike.capture("inset-x-late1500");
    log("late1500:", { early, later, s: short(s) });
    check("a fixed header added 1.5 s after load is pushed below the bar within 0.3 s", near(early.top, BAR), { early, appearedAgo: Date.now() - appeared });
    check("... and stays there", near(later.top, BAR), later);

    await open("inset-x-late.html", "late4000", 0);
    await waitFor(async () => (await rect("#hdr")) !== null, { timeout: 8000, what: "late header 4 s" });
    await sleep(600);
    const late4 = await rect("#hdr");
    await spike.capture("inset-x-late4000");
    log("late4000:", late4, short(await state()));
    check("a fixed header added 4 s after load (after the last settle) is pushed too", near(late4.top, BAR), late4);

    await open("inset-x-late.html", "onscroll");
    const before = await rect("#title");
    await scroll(400);
    await sleep(700);
    const fixedNow = await rect("#hdr");
    await spike.capture("inset-x-onscroll-400");
    await scroll(0);
    await sleep(700);
    const back = await rect("#hdr");
    const titleBack = await rect("#title");
    await spike.capture("inset-x-onscroll-0");
    log("onscroll:", { before, fixedNow, back, titleBack, s: short(await state()) });
    check("a header that becomes fixed after scrolling past 150 px is pushed below the bar", fixedNow.position === "fixed" && near(fixedNow.top, BAR), fixedNow);
    check("... and back in the flow at the top its push is gone: it sits at 68 and the title where it was", back.position === "relative" && near(back.top, BAR) && near(titleBack.top, before.top), { back, titleBack, before });

    await open("inset-x-late.html", "hide");
    const shown = await rect("#hdr");
    await scroll(150);
    await sleep(80);
    await scroll(300);
    await sleep(700);
    const hidden = await rect("#hdr");
    await spike.capture("inset-x-hide-300");
    await scroll(200);
    await sleep(700);
    const again = await rect("#hdr");
    log("hide:", { shown, hidden, again, s: short(await state()) });
    check("will-change header: pushed to 68 when shown", near(shown.top, BAR), shown);
    check("will-change header that hides with translateY(-100%): fully out of sight when hidden (bottom <= 0)", hidden.bottom <= 0.5, hidden);
    check("... and back at 68 when shown again", near(again.top, BAR), again);

    await open("inset-x-late.html", "hidet");
    await scroll(150);
    await sleep(80);
    await scroll(300);
    await sleep(900);
    const hiddenT = await rect("#hdr");
    const hideTrack = await evalInPage("JSON.stringify(window.track)");
    await scroll(200);
    await sleep(900);
    const shownT = await rect("#hdr");
    const showTrack = JSON.parse(await evalInPage("JSON.stringify(window.track)"));
    await spike.capture("inset-x-hidet-200");
    const jumps = showTrack.slice(1).map((v, i) => v - showTrack[i]);
    log("hidet:", { hiddenT, hideTrack, shownT, showTrack, s: short(await state()) });
    check("transition header (Headroom style): out of sight once hidden", hiddenT.bottom <= 0.5, hiddenT);
    check("transition header: slides back in to 68 without a jump (frame steps < 30 px, never above its hidden place)", near(shownT.top, BAR) && showTrack.length > 3 && jumps.every((d) => d >= 0 && d < 30) && showTrack[0] >= BAR - 56 - 1, { showTrack, shownT });

    await open("inset-x-late.html", "transform");
    const tr = await rect("#hdr");
    await spike.capture("inset-x-transform-0");
    check("fixed header with transform: translateZ(0): pushed to 68", near(tr.top, BAR), tr);

    await open("inset-x-late.html", "held");
    const held = await rect("#hdr");
    const hs = await state();
    const hb = await band();
    log("held:", { held, s: short(hs), hb });
    check("fixed header inside a will-change: transform ancestor (it scrolls with the page): not pushed, nothing in the band", !hs.pushed.length && hb.count === 0 && held.top >= BAR, { held, pushed: hs.pushed, hb });
  });

  // ------------------------------------------------------------------ 4. inner scrollers
  await section("inner scrollers", async () => {
    for (const [v, expectApplied] of [["htmlhidden", false], ["bodyscroll", false], ["plain100", false], ["fixedapp", null]]) {
      await open("inset-x-inner.html", v);
      const s = await state("#title");
      const bb = await band();
      await spike.capture("inset-x-inner-" + v);
      // Scroll the inner container to its end: the last line must be reachable, above the window bottom.
      const last = await inPage(`function (w, d) {
        const sc = d.querySelector("#scroller"), body = d.body;
        const el = sc.scrollHeight > sc.clientHeight ? sc : body;
        el.scrollTop = 1e6;
        const r = d.querySelector("#last").getBoundingClientRect();
        return { bottom: Math.round(r.bottom), H: d.documentElement.clientHeight, scroller: el === sc ? "scroller" : "body", scrollY: w.scrollY };
      }`);
      await sleep(200);
      await spike.capture("inset-x-inner-" + v + "-end");
      log(`inner ${v}:`, { s: short(s), bb, last });
      if (expectApplied === false) check(`inner scroller ${v}: no strip (no dead band), the window does not scroll, the last line is reachable`, !s.applied && s.padding === "0px" && last.bottom <= last.H && last.scrollY === 0, { s: short(s), last });
      else check(`inner scroller ${v}: the fixed app covers the window as before (no dead band at the top or bottom)`, last.bottom <= last.H && last.scrollY === 0 && bb.count > 0, { s: short(s), last, bb });
    }
  });

  // ------------------------------------------------------------------ 5. element full screen
  await section("full screen", async () => {
    Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
    Services.prefs.setCharPref("full-screen-api.transition-duration.enter", "0 0");
    Services.prefs.setCharPref("full-screen-api.transition-duration.leave", "0 0");
    await open("inset-x-busy.html", "fs");
    await scroll(120);
    await sleep(300);
    const before = await state("#stage");
    const root = document.documentElement;
    for (let i = 0; i < 4 && !root.hasAttribute("inDOMFullscreen"); i++) {
      await spike.activate();
      b.focusPage();
      await sleep(200);
      await evalInPage("window.fsErr = ''; document.getElementById('stage').requestFullscreen().catch(e => { window.fsErr = String(e); }); 1");
      await waitFor(() => root.hasAttribute("inDOMFullscreen"), { timeout: 3000, what: "element full screen" }).catch(() => {});
    }
    await sleep(1200);
    const inFs = await rect("#stage");
    const fsState = await state();
    const fsBand = await band();
    await spike.capture("inset-x-fs-element");
    log("element full screen:", { dom: root.hasAttribute("inDOMFullscreen"), inFs, fs: short(fsState), fsBand });
    if (root.hasAttribute("inDOMFullscreen")) {
      check("element full screen: the element fills the screen from its top (no inset on it)", near(inFs.top, 0) && inFs.height >= fsBand.H - 1, { inFs, H: fsBand.H });
      await evalInPage("document.exitFullscreen(); 1");
      await waitFor(() => !root.hasAttribute("inDOMFullscreen"), { timeout: 5000, what: "full screen exit" }).catch(() => {});
      await sleep(1200);
    } else log("NOTE element full screen did not start", { err: await evalInPage("window.fsErr"), active: Services.focus.activeWindow === window });
    const after = await state("#stage");
    const afterBand = await band();
    await spike.capture("inset-x-fs-after");
    log("after full screen:", { after: short(after), afterBand });
    check("after element full screen: strip, decision and scroll position as before, no flip", after.applied && after.decision === before.decision && near(afterBand.scrollY, 120) && near(after.rect.top, before.rect.top) && after.flips === before.flips, { before: short(before), after: short(after), afterBand });
    // The whole document full screen: the root is :fullscreen, the strip goes away while it lasts.
    for (let i = 0; i < 4 && !root.hasAttribute("inDOMFullscreen"); i++) {
      await spike.activate();
      b.focusPage();
      await sleep(200);
      await evalInPage("document.documentElement.requestFullscreen().catch(e => { window.fsErr = String(e); }); 1");
      await waitFor(() => root.hasAttribute("inDOMFullscreen"), { timeout: 3000, what: "root full screen" }).catch(() => {});
    }
    await sleep(1000);
    if (root.hasAttribute("inDOMFullscreen")) {
      const rb = await band();
      await spike.capture("inset-x-fs-root");
      check("document full screen: no strip while it lasts", rb.padding === "0px", rb);
      await evalInPage("document.exitFullscreen(); 1");
      await waitFor(() => !root.hasAttribute("inDOMFullscreen"), { timeout: 5000, what: "full screen exit" }).catch(() => {});
      await sleep(1000);
      check("document full screen ended: the strip is back", (await band()).padding === BAR + "px");
    }
  });

  // ------------------------------------------------------------------ 6. print preview
  await section("print preview", async () => {
    await open("inset-fixed.html", "print");
    const s = await state();
    check("print page: the fixed header is pushed on screen", s.pushed.some((p) => p.id === "hdr"), s.pushed);
    const sourceBrowser = gBrowser.selectedBrowser;
    PrintUtils.startPrintWindow(sourceBrowser.browsingContext);
    const preview = await waitFor(() => {
      const p = PrintUtils.getPreviewBrowser(sourceBrowser);
      return p && p.browsingContext?.currentWindowGlobal ? p : null;
    }, { timeout: 20000, what: "print preview browser" });
    await sleep(2500);
    const inPreview = await inPage(`function (w, d) {
      const el = d.querySelector("#hdr"), root = d.documentElement;
      const r = el ? el.getBoundingClientRect() : null;
      return { hdrTop: r && Math.round(r.top), marginTop: el && w.getComputedStyle(el).marginTop, inline: el && el.getAttribute("style"), padding: w.getComputedStyle(root).paddingTop, print: w.matchMedia("print").matches, url: d.documentURI.slice(-30) };
    }`, preview);
    await spike.capture("inset-x-print-preview");
    log("print preview:", inPreview);
    check("print preview: no strip in print (root padding 0)", inPreview && inPreview.padding === "0px", inPreview);
    check("print preview: the pushed header prints at its own place (margin-top 0)", inPreview && inPreview.marginTop === "0px", inPreview);
    gBrowser.getTabDialogBox(sourceBrowser).abortAllDialogs();
    await waitFor(() => !PrintUtils.getPreviewBrowser(sourceBrowser), { timeout: 8000, what: "print preview closed" }).catch(() => {});
    await sleep(500);
    const afterPrint = await rect("#hdr");
    check("after print preview the page still has its pushed header on screen", near(afterPrint.top, BAR), afterPrint);
  });

  // ------------------------------------------------------------------ 7. the PDF viewer and excluded pages
  await section("pdf and excluded pages", async () => {
    const pdf = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n4 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 72 700 Td (Vitre PDF) Tj ET\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
    const pdfPath = PathUtils.join(spike.outDir, "inset-x.pdf");
    await IOUtils.write(pdfPath, new TextEncoder().encode(pdf));
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(pdfPath);
    await load(Services.io.newFileURI(f).spec);
    await waitFor(async () => (await b.page(b.active()).query("pdf:state").catch(() => null))?.sheet, { timeout: 20000, what: "pdf viewer" }).catch(() => {});
    await sleep(1200);
    const ps = await state();
    const tb = await rect("#toolbarContainer");
    await spike.capture("inset-x-pdf");
    log("pdf:", { ps: short(ps), tb });
    check("PDF viewer: not inset (its own 68 px offset only): toolbar at 68, root padding 0", !ps.applied && ps.reason === "privileged" && near(tb.top, BAR) && ps.padding === "0px", { ps: short(ps), tb });

    for (const url of ["about:robots", "http://vitre-inset-test.invalid/", "about:config", "chrome://global/content/aboutAbout.html"]) {
      await load(url);
      await sleep(700);
      let st = null;
      try { st = await state(); } catch (e) { st = { error: String(e) }; }
      const pad = await inPage(`function (w, d) { return { padding: w.getComputedStyle(d.documentElement).paddingTop, uri: d.documentURI.slice(0, 40) }; }`).catch((e) => ({ error: String(e) }));
      log(`excluded ${url}:`, st && short(st), pad);
      check(`${url}: never inset`, (!st || st.error || !st.applied) && (!pad || pad.error || pad.padding === "0px"), { st: st && (st.error || short(st)), pad });
    }
    await spike.capture("inset-x-chrome-page");
  });

  // ------------------------------------------------------------------ 8. zoom
  await section("zoom", async () => {
    await open("inset-fixed.html", "zoom");
    for (const z of [0.5, 3]) {
      gBrowser.selectedBrowser.fullZoom = z;
      await waitFor(async () => Math.abs((await state()).px - BAR / z) < 0.01, { timeout: 4000, what: "strip for zoom " + z }).catch(() => {});
      await sleep(400);
      const s = await state("#hdr");
      const t = await rect("#title");
      await spike.capture("inset-x-zoom-" + Math.round(z * 100));
      log(`zoom ${z}:`, { s: short(s), title: t });
      check(`zoom ${z * 100}%: strip = 68 window px (${(BAR / z).toFixed(3)} page px) and the header at 68 window px`, Math.abs(parseFloat(s.padding) - BAR / z) < 0.05 && near(s.rect.top * z, BAR, 1), { padding: s.padding, hdr: s.rect, z });
    }
    gBrowser.selectedBrowser.fullZoom = 1;
    await waitFor(async () => (await state()).px === BAR, { timeout: 4000, what: "zoom back" }).catch(() => {});
    // Site-specific zoom (FullZoom, stored per site): zoom a page to 150 %, then load it again; the
    // stored zoom is applied after the document has started, so the strip must follow.
    await open("inset-x-bg.html", "none");
    window.FullZoom.setZoom(1.5);
    await sleep(800);
    await open("inset-x-bg.html", "bodydark", 1500);
    const z2 = gBrowser.selectedBrowser.fullZoom;
    const s2 = await state("#hdr");
    await spike.capture("inset-x-zoom-site");
    log("site zoom:", { zoom: z2, s: short(s2) });
    check("a page that opens with a stored site zoom (150 %) gets the strip for that zoom", Math.abs(z2 - 1.5) < 0.01 && Math.abs(parseFloat(s2.padding) * z2 - BAR) < 0.1 && near(s2.rect.top * z2, BAR), { zoom: z2, padding: s2.padding, rect: s2.rect });
    await window.FullZoom.reset();
    await sleep(500);
  });

  // ------------------------------------------------------------------ 9. loops and cost
  await section("loops and cost", async () => {
    await open("inset-x-busy.html", "raf", 3000);
    const r1 = await state("#hdr");
    await sleep(3000);
    const r2 = await state("#hdr");
    const resets = await evalInPage("window.resets");
    log("raf:", { r1: short(r1), r2: short(r2), resets });
    check("a page that resets its header's style every frame: no re-check loop (no checks in 3 s), at most 3 pushes", r2.checks === r1.checks && r2.ops <= 3 && resets > 100, { c1: r1.checks, c2: r2.checks, ops: r2.ops, resets });

    for (const v of ["spy", "spy250"]) {
      await open("inset-x-busy.html", v, 2700); // after the settle re-checks (0.7 s, 2.5 s)
      const a = await state();
      await sleep(4000);
      const c = await state();
      const spies = await evalInPage("window.spies");
      log(`${v}:`, { a: short(a), c: short(c), spies });
      check(`${v}: a page calling replaceState all the time costs at most one check a second (${c.checks - a.checks} in 4 s, ${(c.checkMsTotal - a.checkMsTotal).toFixed(1)} ms)`, c.checks - a.checks <= 5 && c.checkMsTotal - a.checkMsTotal < 40, { checks: c.checks - a.checks, ms: c.checkMsTotal - a.checkMsTotal, spies });
    }

    // A page that repaints on every frame (script animation): paint-driven probes at most every 500 ms.
    await open("inset-x-busy.html", "anim", 3200); // after the last settle re-check (2.5 s)
    const an0 = await state();
    const f0 = await evalInPage("window.frames_");
    await sleep(4000);
    const an1 = await state();
    const f1 = await evalInPage("window.frames_");
    const anProbes = an1.probes - an0.probes, anMs = Math.round((an1.probeMs - an0.probeMs) * 100) / 100;
    log("anim:", { frames: f1 - f0, anProbes, anMs, max: an1.probeMsMax, pushed: an1.pushed });
    check(`a page repainting every frame (${f1 - f0} frames in 4 s): ${anProbes} probes, ${anMs} ms in all (at most 2 a second, < 10 ms)`, f1 - f0 > 100 && anProbes <= 9 && anMs < 10 && an1.checks === an0.checks, { anProbes, anMs, checks: [an0.checks, an1.checks] });
    const rafProbe = await state();
    log("raf page probes:", { probes: r2.probes, probeMs: r2.probeMs, now: rafProbe.probes });

    await open("inset-x-busy.html", "heavy", 3000);
    const n = await inPage("function (w, d) { return d.getElementsByTagName('*').length; }");
    const h1 = await state();
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t = await recheck();
      times.push({ check: t.checkMs, scan: t.scanMs });
    }
    log("heavy:", { elements: n, h1: short(h1), times });
    check(`heavy page (${n} elements): one check costs < 15 ms (scan included)`, times.every((t) => t.check < 15), times);
    // Probes while scrolling the heavy page: 20 steps in 2 s.
    const p0 = await state();
    for (let i = 1; i <= 20; i++) {
      await scroll(i * 150);
      await sleep(100);
    }
    await sleep(600);
    const p1 = await state();
    const probes = p1.probes - p0.probes, probeMs = Math.round((p1.probeMs - p0.probeMs) * 100) / 100;
    log("heavy scroll probes:", { probes, probeMs, probeMsMax: p1.probeMsMax });
    check(`heavy page, 2 s of scrolling: band probes stay cheap (${probes} probes, ${probeMs} ms in all, at most ${p1.probeMsMax} ms each)`, probes <= 16 && probeMs < 40 && p1.probeMsMax < 6, { probes, probeMs, max: p1.probeMsMax });
    await inPage("function (w, d) { d.getElementById('sec').scrollIntoView(); w.scrollBy(0, 200); return w.scrollY; }");
    await sleep(500);
    const sec = await rect("#sec");
    await spike.capture("inset-x-heavy-sticky");
    log("heavy sticky section header (after the scan limit):", sec);
    check("heavy page: a sticky section header after the first 3 000 elements also sticks below the bar", near(sec.top, BAR), sec);
  });

  // ------------------------------------------------------------------ 9b. a real site's scroll-in header
  await section("wikipedia sticky header", async () => {
    await load("https://en.wikipedia.org/wiki/Glass");
    await sleep(3000);
    const s0 = await state();
    if (!s0.eligible) {
      log("NOTE wikipedia not loaded", s0.url, s0.reason);
      return;
    }
    const p0 = s0.probes;
    for (let y = 200; y <= 2000; y += 200) {
      await scroll(y);
      await sleep(120);
    }
    await sleep(1200);
    const down = await state(".vector-sticky-header");
    const sticky = await rect(".vector-sticky-header");
    await spike.capture("inset-x-wiki-sticky-2000");
    log("wikipedia scrolled:", { sticky, s: short(down) });
    // The slide-in sticky header is only enabled for some readers; when it is, it must sit below the bar.
    if (sticky && sticky.height > 0) check("Wikipedia: its sticky header that slides in after scrolling sits below the bar (68)", near(sticky.top, BAR), sticky);
    else log("NOTE Wikipedia's slide-in sticky header is not enabled for this reader:", sticky);
    log("wikipedia check timings:", down.times);
    check(`Wikipedia: probes while scrolling are cheap (${down.probes - p0} probes, at most ${down.probeMsMax} ms each)`, down.probeMsMax < 8, { probes: down.probes - p0, probeMs: down.probeMs, max: down.probeMsMax });
    for (let y = 1800; y >= 0; y -= 200) {
      await scroll(y);
      await sleep(120);
    }
    await sleep(1500);
    const up = await rect(".vector-sticky-header");
    const band0 = await band();
    await spike.capture("inset-x-wiki-top");
    log("wikipedia back at the top:", { up, band0, s: short(await state()) });
    check("Wikipedia back at the top: nothing is left in the band, it shows only the strip", (!up || up.bottom <= 0.5) && band0.count === 0, { up, band0 });
  });

  // ------------------------------------------------------------------ 10. narrow window
  await section("narrow window", async () => {
    await open("inset-x-busy.html", "narrow");
    const wide = await rect("#hdr");
    await spike.resize(600, 800);
    await sleep(900);
    const narrow = await rect("#hdr");
    const ns = await state();
    await spike.capture("inset-x-narrow");
    const barH = b.root.querySelector("#vitre-bar")?.getBoundingClientRect().height;
    log("narrow:", { wide, narrow, ns: short(ns), barH });
    check("narrow window: the header that becomes fixed below 700 px is pushed to 68; the strip stays 68", near(narrow.top, BAR) && ns.padding === "68px", { narrow, padding: ns.padding });
    await spike.resize(1280, 800);
    await sleep(900);
    const wideAgain = await rect("#hdr");
    const title = await rect("#title");
    await spike.capture("inset-x-narrow-wide-again");
    log("wide again:", { wideAgain, title });
    check("wide again: the header is back in the flow at 68 with no leftover push", wideAgain.position === "static" && near(wideAgain.top, BAR) && !/margin-top/.test(wideAgain.inline), wideAgain);
  });

  // ------------------------------------------------------------------ 11. ten tabs, setting off and on
  await section("ten tabs", async () => {
    const pages = ["inset-fixed.html", "inset-sticky.html", "inset-white.html", "inset-dark.html", "inset-abs.html", "inset-shadow.html", "inset-wrapper.html", "inset-x-late.html?transform", "inset-x-box.html?wpbar", "inset-x-bg.html?banner"];
    const tabs = [];
    for (const p of pages) tabs.push(b.newTab(pageURL(p.split("?")[0], p.split("?")[1] || ""), { background: true }));
    await waitFor(() => tabs.every((t) => !t.loading && t.url.includes("inset")), { timeout: 20000, what: "ten tabs loaded" }).catch(() => {});
    await sleep(3000);
    const zoomOk = (s, t) => !s.error && Math.abs(parseFloat(s.padding) * t.browser.fullZoom - BAR) < 0.1;
    log("ten tabs zoom:", tabs.map((t) => t.browser.fullZoom));
    const on = await Promise.all(tabs.map((t) => state(null, t).catch((e) => ({ error: String(e) }))));
    log("ten tabs on:", on.map((s) => s.error || [s.applied, s.padding, s.pushed.length]));
    check("ten tabs: every one has the strip (68 window px)", on.every((s, i) => s.applied && zoomOk(s, tabs[i])), on.map((s) => s.error || s.padding));
    Settings.set({ pageInset: false });
    await sleep(800);
    const off = await Promise.all(tabs.map((t) => state(null, t).catch((e) => ({ error: String(e) }))));
    const offHdr = await Promise.all(tabs.map((t) => rect("#hdr, #abs, #shdr", t.browser).catch(() => null)));
    log("ten tabs off:", off.map((s, i) => s.error || [s.applied, s.padding, s.pushed.length, offHdr[i] && offHdr[i].marginTop]));
    check("setting off with ten tabs open: every tab reverts (no padding, no pushed box)", off.every((s) => !s.applied && s.padding === "0px" && s.pushed.length === 0), off.map((s) => s.error || [s.padding, s.pushed.length]));
    check("... and every header is back at its own place (no margin-top push)", offHdr.every((r) => !r || !/margin-top|top: calc/.test(r.inline)), offHdr.map((r) => r && r.inline));
    Settings.set({ pageInset: true });
    await sleep(800);
    const back = await Promise.all(tabs.map((t) => state(null, t).catch((e) => ({ error: String(e) }))));
    check("setting on again: every tab has the strip again", back.every((s, i) => s.applied && zoomOk(s, tabs[i])), back.map((s) => s.error || s.padding));
    for (const t of tabs) b.closeTab(t);
    await sleep(500);
  });

  // ------------------------------------------------------------------ 12. a second window
  await section("second window", async () => {
    const win = await spike.openWindow();
    const wb = win.vitre;
    const tab = wb.active();
    wb.navigate(tab, pageURL("inset-fixed.html", "w2"));
    await waitFor(async () => (await wb.page(tab).query("inset:state", {}).catch(() => null))?.checks >= 2, { timeout: 8000, what: "second window page" }).catch(() => {});
    await sleep(800);
    const s = await wb.page(tab).query("inset:state", { selector: "#hdr" });
    await win.spike.capture("inset-x-window2");
    log("second window:", short(s));
    const z = tab.browser.fullZoom;
    check("second window: strip and header push (68 window px)", s.applied && near(s.rect.top * z, BAR) && Math.abs(parseFloat(s.padding) * z - BAR) < 0.1, { z, s: short(s) });
    win.close();
    await sleep(800);
  });

  Settings.set({ pageInset: true });
});
