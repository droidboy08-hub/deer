// SPIKE switcher/4: theme sampling. The bar's glass is light or dark depending on the page under it.
// Run: python tools/run.py --boot spikes/switcher/theme.js --name switcher-theme --out spikes/switcher/out/theme --timeout 150
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const BAR_H = 64; // the strip of page under Vitre's floating bar, CSS px
  const THRESHOLD = 0.56; // same as the Electron build

  // ---- pages ----
  const mk = (title, body) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title>${body}`);
  const white = mk("White page", `<body style="margin:0;background:#fff;color:#111;font:20px Segoe UI"><h1 style="margin:120px 80px">A white page</h1><div style="height:3000px"></div>`);
  const dark = mk("Dark page", `<body style="margin:0;background:#101014;color:#eee;font:20px Segoe UI"><h1 style="margin:120px 80px">A dark page</h1><div style="height:3000px"></div>`);
  const mixed = mk("Mixed page", `<body style="margin:0;font:20px Segoe UI"><div style="height:700px;background:#fff;color:#111"><h1 style="margin:0;padding:120px 80px">White on top</h1></div>` +
    `<div style="height:3000px;background:#16161c;color:#eee"><h1 style="margin:0;padding:120px 80px">Dark below 700px</h1></div>`);

  // ---- the actor that reports scroll / paint milestones from the content process ----
  // (the child module must live where the content sandbox can read it: see lib.js mountForContent)
  const base = await vx.mountForContent("actors", "vitre-actors");
  ChromeUtils.registerWindowActor("VitrePage", {
    parent: { esModuleURI: base + "VitrePageParent.sys.mjs" },
    child: {
      esModuleURI: base + "VitrePageChild.sys.mjs",
      events: { scroll: { capture: true }, DOMContentLoaded: {}, pageshow: {} },
    },
    messageManagerGroups: ["browsers"],
    allFrames: false,
    // Firefox 157 refuses to instantiate an actor in a "web" content process without this flag
    // (getActor throws "Window protocol 'VitrePage' doesn't match remote type 'web'").
    safeForUntrustedWebProcess: true,
  });

  // ---- a stand-in for Vitre's glass bar, floating over the top of the page ----
  const css = `
    #vx-bar { position: fixed; z-index: 2147483647; left: 50%; translate: -50% 0; width: 720px; height: 44px; border-radius: 22px;
      display: flex; align-items: center; justify-content: center; font: 600 14px "Segoe UI Variable", "Segoe UI", sans-serif;
      backdrop-filter: blur(24px) saturate(1.6); transition: background-color 180ms, color 180ms; pointer-events: none; }
    :root.theme-light #vx-bar { background: rgba(255,255,255,.55); color: #111; box-shadow: 0 0 0 1px rgba(0,0,0,.10), 0 8px 24px rgba(0,0,0,.12); }
    :root.theme-dark #vx-bar { background: rgba(16,16,20,.45); color: #fff; box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 8px 24px rgba(0,0,0,.4); }`;
  window.windowUtils.loadSheetUsingURIString("data:text/css," + encodeURIComponent(css), window.windowUtils.AUTHOR_SHEET);
  const bar = vx.el("div", "", "");
  bar.id = "vx-bar";
  document.documentElement.append(bar);
  const placeBar = () => {
    const r = gBrowser.selectedBrowser.getBoundingClientRect();
    bar.style.top = r.y + 10 + "px";
  };

  // ---- the sampler ----
  const themes = new WeakMap(); // browser -> { theme, luma }
  const timeline = [];
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  function meanLuma(bmp, rows = bmp.height) {
    canvas.width = bmp.width;
    canvas.height = rows;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, rows).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  }
  /** Strategy "strip": only the rect under the bar, in document coordinates (needs the scroll offset). */
  async function sampleStrip(browser, scroll) {
    const wgp = browser.browsingContext?.currentWindowGlobal;
    if (!wgp) return null;
    const r = browser.getBoundingClientRect(); // also flushes layout so drawSnapshot does not fail
    const bmp = await wgp.drawSnapshot(new DOMRect(scroll.scrollX, scroll.scrollY, r.width, BAR_H), 0.125, "white");
    const l = meanLuma(bmp);
    bmp.close();
    return l;
  }
  /** Strategy "viewport": the whole viewport at a very low scale, read the top rows (no scroll offset needed). */
  async function sampleViewport(browser, scale = 0.0625) {
    const wgp = browser.browsingContext?.currentWindowGlobal;
    if (!wgp) return null;
    browser.getBoundingClientRect();
    const bmp = await wgp.drawSnapshot(null, scale, "white");
    const l = meanLuma(bmp, Math.max(1, Math.round(BAR_H * scale)));
    bmp.close();
    return l;
  }
  function apply(browser) {
    if (browser !== gBrowser.selectedBrowser) return;
    const t = themes.get(browser)?.theme ?? "light";
    document.documentElement.classList.toggle("theme-light", t === "light");
    document.documentElement.classList.toggle("theme-dark", t === "dark");
    bar.textContent = "Vitre bar: theme-" + t + "  (luma " + (themes.get(browser)?.luma ?? "?") + ")";
    placeBar();
  }
  let seq = 0;
  async function resample(browser, why, scroll) {
    const mine = ++seq;
    const t0 = performance.now();
    let luma;
    try {
      luma = scroll ? await sampleStrip(browser, scroll) : await sampleViewport(browser);
    } catch (e) {
      timeline.push(why + ":ERR " + String(e).slice(0, 50));
      return;
    }
    if (luma == null || mine !== seq) return; // a newer sample is on its way
    const theme = luma > THRESHOLD ? "light" : "dark";
    const prev = themes.get(browser)?.theme;
    themes.set(browser, { theme, luma: +luma.toFixed(3) });
    apply(browser);
    timeline.push(`${why}: luma ${luma.toFixed(3)} -> ${theme}${prev !== theme ? " (CHANGED)" : ""} in ${vx.ms(t0)}ms` +
      (scroll?.t ? `, ${Date.now() - scroll.t}ms after the content event` : ""));
  }

  // when to resample
  let timer = null;
  window.VitrePage = {
    onPageChanged(browser, data) {
      if (browser !== gBrowser.selectedBrowser) return; // background tabs are sampled when they are shown
      clearTimeout(timer);
      timer = setTimeout(() => resample(browser, data.why, data), data.why === "scroll" ? 80 : 0);
    },
  };
  gBrowser.tabContainer.addEventListener("TabSelect", () => {
    apply(gBrowser.selectedBrowser); // cached theme at once, no flash
    resample(gBrowser.selectedBrowser, "tabselect");
  });
  gBrowser.addTabsProgressListener({
    onStateChange(browser, wp, req, flags) {
      const F = Ci.nsIWebProgressListener;
      if (browser === gBrowser.selectedBrowser && wp.isTopLevel && flags & F.STATE_STOP && flags & F.STATE_IS_NETWORK) resample(browser, "load-stop");
    },
  });

  // ---- demo ----
  const first = gBrowser.selectedTab;
  const tWhite = vx.addTab(white), tDark = vx.addTab(dark), tMixed = vx.addTab(mixed), tWiki = vx.addTab("https://en.wikipedia.org/wiki/Gecko_(software)");
  for (const t of [tWhite, tDark, tMixed, tWiki]) await vx.waitLoaded(t.linkedBrowser);
  gBrowser.removeTab(first);

  gBrowser.selectedTab = tWhite;
  await spike.sleep(500);
  spike.log("white page:", themes.get(tWhite.linkedBrowser), "root classes", document.documentElement.className.match(/theme-\w+/)?.[0]);
  await spike.capture("theme-white");

  gBrowser.selectedTab = tDark;
  await spike.sleep(500);
  spike.log("dark page:", themes.get(tDark.linkedBrowser), "root classes", document.documentElement.className.match(/theme-\w+/)?.[0]);
  await spike.capture("theme-dark");

  gBrowser.selectedTab = tMixed;
  await spike.sleep(500);
  spike.log("mixed page at top:", themes.get(tMixed.linkedBrowser));
  await spike.capture("theme-mixed-top");
  const actor = () => tMixed.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage");
  actor().sendAsyncMessage("Vitre:ScrollTo", { y: 900 });
  await spike.sleep(600);
  spike.log("mixed page scrolled to 900:", themes.get(tMixed.linkedBrowser));
  await spike.capture("theme-mixed-scrolled");
  actor().sendAsyncMessage("Vitre:ScrollTo", { y: 0 });
  await spike.sleep(600);
  spike.log("mixed page back at top:", themes.get(tMixed.linkedBrowser));

  // navigation inside a tab: dark page -> white page
  gBrowser.selectedTab = tDark;
  await spike.sleep(300);
  tDark.linkedBrowser.fixupAndLoadURIString(white, { triggeringPrincipal: vx.SYS });
  await spike.sleep(900);
  spike.log("dark tab after navigating to the white page:", themes.get(tDark.linkedBrowser));
  spike.log("timeline:");
  for (const l of timeline) spike.log("   ", l);

  // a white page with a dark position:fixed header, scrolled: both strategies must see the header
  {
    const fixed = mk("Fixed header", `<body style="margin:0;background:#fff;font:20px Segoe UI"><div style="position:fixed;top:0;left:0;right:0;height:80px;background:#14141a;color:#fff">fixed dark header</div><div style="height:4000px"></div>`);
    const tFixed = vx.addTab(fixed);
    await vx.waitLoaded(tFixed.linkedBrowser);
    gBrowser.selectedTab = tFixed;
    await spike.sleep(400);
    tFixed.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage").sendAsyncMessage("Vitre:ScrollTo", { y: 1200 });
    await spike.sleep(500);
    const b = tFixed.linkedBrowser;
    spike.log("fixed dark header on a white page, scrolled to 1200: strip(rect at scroll offset) luma", (await sampleStrip(b, { scrollX: 0, scrollY: 1200 })).toFixed(3),
      "| viewport(null rect) luma", (await sampleViewport(b)).toFixed(3), "| strip with a stale offset (0,0)", (await sampleStrip(b, { scrollX: 0, scrollY: 0 })).toFixed(3),
      "| theme", themes.get(b));
    await spike.capture("theme-fixed-header");
    gBrowser.removeTab(tFixed);
  }

  // ---- cost ----
  async function bench(label, fn, n = 30) {
    const times = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await fn();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    spike.log("cost", label, "median", times[n >> 1].toFixed(2), "p90", times[Math.floor(n * 0.9)].toFixed(2), "max", times[n - 1].toFixed(2), "ms");
  }
  for (const [name, t] of [["simple page", tMixed], ["wikipedia", tWiki]]) {
    gBrowser.selectedTab = t;
    await spike.sleep(500);
    const b = t.linkedBrowser;
    await bench(name + " strip 1264x64 @0.125", () => sampleStrip(b, { scrollX: 0, scrollY: 0 }));
    await bench(name + " viewport @0.0625 (top rows)", () => sampleViewport(b, 0.0625));
    await bench(name + " viewport @0.25 (top rows)", () => sampleViewport(b, 0.25));
    spike.log("   lumas strip/viewport", (await sampleStrip(b, { scrollX: 0, scrollY: 0 })).toFixed(3), (await sampleViewport(b)).toFixed(3));
  }
  // sampling a background tab ahead of the switch works too
  const bgL = await sampleViewport(tWhite.linkedBrowser);
  spike.log("background tab sample (white page, not selected):", bgL.toFixed(3));
});
