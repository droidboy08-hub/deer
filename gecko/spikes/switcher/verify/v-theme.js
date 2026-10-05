// VERIFY switcher/theme sampling: cases the spike did not run.
//  T1 a page that changes colour without scrolling or loading (JS dark-mode toggle)
//  T2 back from bfcache   T3 continuous scrolling across a light/dark boundary (debounce lag)
//  T4 a second window     T5 real sites
// Run: python tools/run.py --boot spikes/switcher/verify/v-theme.js --name switcher-verify-vtheme --out spikes/switcher/verify/out/v-theme --timeout 150
/* global gBrowser, Services, Ci, Cc, spike, vx, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(() => {
  const BAR_H = 64, THRESHOLD = 0.56;
  const isFirst = [...Services.wm.getEnumerator("navigator:browser")].length === 1;

  // ---- per-window sampler (same as the spike's theme.js, viewport strategy) ----
  const themes = new WeakMap();
  const timeline = [];
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  async function sampleViewport(browser, scale = 0.0625) {
    const wgp = browser.browsingContext?.currentWindowGlobal;
    if (!wgp) return null;
    browser.getBoundingClientRect();
    const bmp = await wgp.drawSnapshot(null, scale, "white");
    const rows = Math.max(1, Math.round(BAR_H * scale));
    canvas.width = bmp.width;
    canvas.height = rows;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const d = ctx.getImageData(0, 0, canvas.width, rows).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  }
  function apply(browser) {
    if (browser !== gBrowser.selectedBrowser) return;
    const t = themes.get(browser)?.theme ?? "light";
    document.documentElement.classList.toggle("theme-light", t === "light");
    document.documentElement.classList.toggle("theme-dark", t === "dark");
  }
  let seq = 0;
  async function resample(browser, why) {
    const mine = ++seq;
    let luma;
    try {
      luma = await sampleViewport(browser);
    } catch (e) {
      timeline.push({ at: performance.now(), why, error: String(e).slice(0, 60) });
      return;
    }
    if (luma == null || mine !== seq) return;
    const theme = luma > THRESHOLD ? "light" : "dark";
    const prev = themes.get(browser)?.theme;
    themes.set(browser, { theme, luma: +luma.toFixed(3) });
    apply(browser);
    timeline.push({ at: performance.now(), why, luma: +luma.toFixed(3), theme, changed: prev !== theme });
  }
  let timer = null, lastScrollSample = 0;
  const cfg = { usePaint: false, scrollMode: "debounce" };
  window.VitreProbe = {
    cfg,
    onPageChanged(browser, data) {
      if (browser !== gBrowser.selectedBrowser) return;
      if (data.why === "paint" && !cfg.usePaint) return;
      if (data.why === "scroll" && cfg.scrollMode === "throttle") {
        // leading + trailing: sample at most every 80 ms while scrolling, and once more when it stops
        clearTimeout(timer);
        const now = performance.now();
        if (now - lastScrollSample >= 80) {
          lastScrollSample = now;
          resample(browser, "scroll");
        } else {
          timer = setTimeout(() => { lastScrollSample = performance.now(); resample(browser, "scroll(trailing)"); }, 80);
        }
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => resample(browser, data.why), data.why === "scroll" ? 80 : 0);
    },
  };
  gBrowser.tabContainer.addEventListener("TabSelect", () => {
    apply(gBrowser.selectedBrowser);
    resample(gBrowser.selectedBrowser, "tabselect");
  });
  gBrowser.addTabsProgressListener({
    onStateChange(browser, wp, req, flags) {
      const F = Ci.nsIWebProgressListener;
      if (browser === gBrowser.selectedBrowser && wp.isTopLevel && flags & F.STATE_STOP && flags & F.STATE_IS_NETWORK) resample(browser, "load-stop");
    },
  });
  window.vxThemeOf = (browser) => themes.get(browser);
  if (!isFirst) return;

  spike.main(async () => {
    await spike.resize(1280, 800);
    const base = await vx.mountForContent("actors2", "vitre-actors2");
    ChromeUtils.registerWindowActor("VitreProbe", {
      parent: { esModuleURI: base + "VitreProbeParent.sys.mjs" },
      child: {
        esModuleURI: base + "VitreProbeChild.sys.mjs",
        events: { scroll: { capture: true }, DOMContentLoaded: {}, pageshow: {}, MozAfterPaint: { capture: true } },
      },
      messageManagerGroups: ["browsers"],
      allFrames: false,
      safeForUntrustedWebProcess: true,
    });
    const mk = (title, body) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title>${body}`);
    const white = mk("White page", `<body style="margin:0;background:#fff;color:#111;font:20px Segoe UI"><h1 style="margin:120px 80px">A white page</h1><div style="height:3000px"></div>`);
    const dark = mk("Dark page", `<body style="margin:0;background:#101014;color:#eee;font:20px Segoe UI"><h1 style="margin:120px 80px">A dark page</h1><div style="height:3000px"></div>`);
    const mixed = mk("Mixed page", `<body style="margin:0;font:20px Segoe UI"><div style="height:700px;background:#fff;color:#111"><h1 style="margin:0;padding:120px 80px">White on top</h1></div>` +
      `<div style="height:6000px;background:#16161c;color:#eee"><h1 style="margin:0;padding:120px 80px">Dark below 700px</h1></div>`);
    const cls = () => document.documentElement.className.match(/theme-\w+/)?.[0];
    const actor = (t) => t.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe");
    const evalIn = (t, js) => actor(t).sendQuery("Vitre:Eval", { js });

    const first = gBrowser.selectedTab;
    const tWhite = vx.addTab(white), tDark = vx.addTab(dark), tMixed = vx.addTab(mixed);
    for (const t of [tWhite, tDark, tMixed]) await vx.waitLoaded(t.linkedBrowser);
    gBrowser.removeTab(first);

    // ---- T1: colour change without scroll or load ----
    gBrowser.selectedTab = tWhite;
    await spike.sleep(500);
    spike.log("T1 white page:", cls(), themes.get(tWhite.linkedBrowser));
    timeline.length = 0;
    let t0 = performance.now();
    await evalIn(tWhite, "document.body.style.background='#101014';document.body.style.color='#eee';1");
    await spike.sleep(1200);
    spike.log("T1 page turned dark by script; spike triggers only (tabselect/load/scroll): class is", cls(), "after 1.2 s; resamples:", timeline.length,
      "| a manual sample reads luma", (await sampleViewport(tWhite.linkedBrowser)).toFixed(3));
    cfg.usePaint = true;
    await evalIn(tWhite, "document.body.style.background='#fff';document.body.style.color='#111';1");
    await spike.sleep(1500); // let every trailing paint message from the reset drain
    spike.log("T1 reset to white:", cls());
    timeline.length = 0;
    t0 = performance.now();
    await evalIn(tWhite, "document.body.style.background='#101014';document.body.style.color='#eee';1");
    const tq = performance.now() - t0;
    await spike.sleep(1200);
    const hit = timeline.find((e) => e.changed);
    spike.log("T1 with a throttled MozAfterPaint trigger: class is", cls(), "| changed", hit ? (hit.at - t0).toFixed(0) + " ms after the script was sent (" + hit.why + "; the query round trip took " + tq.toFixed(0) + " ms)" : "NEVER",
      "| resamples in 1.2 s:", timeline.map((e) => e.why + "@" + (e.at - t0).toFixed(0)));
    await spike.capture("v-theme-js-toggle");
    // cost of the paint trigger on an animating page: how many samples per second does it cause?
    await evalIn(tWhite, "document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;top:300px;width:80px;height:80px;background:#4cc2ff;animation:m 1s infinite alternate\"></div><style>@keyframes m{to{transform:translateX(600px)}}</style>');1");
    await spike.sleep(300);
    timeline.length = 0;
    await spike.sleep(2000);
    spike.log("T1 paint trigger on a page with a running CSS animation: resamples in 2 s:", timeline.length, "(throttle is 250 ms in the child)");
    cfg.usePaint = false;

    // ---- T2: bfcache ----
    gBrowser.selectedTab = tDark;
    await spike.sleep(400);
    tDark.linkedBrowser.fixupAndLoadURIString("https://example.org/?light", { triggeringPrincipal: vx.SYS });
    await spike.sleep(400);
    await vx.waitLoaded(tDark.linkedBrowser);
    await spike.sleep(500);
    const mid = { cls: cls(), ...themes.get(tDark.linkedBrowser) };
    timeline.length = 0;
    t0 = performance.now();
    tDark.linkedBrowser.goBack();
    await spike.sleep(900);
    spike.log("T2 dark page -> example.org:", mid, "-> Back:", cls(), themes.get(tDark.linkedBrowser), "| events", timeline.map((e) => e.why + "@" + (e.at - t0).toFixed(0) + "ms"));

    // ---- T3: continuous scrolling across the boundary (700px) ----
    for (const mode of ["debounce", "throttle"]) {
      cfg.scrollMode = mode;
      gBrowser.selectedTab = tMixed;
      await evalIn(tMixed, "scrollTo(0,0);1");
      await spike.sleep(500);
      timeline.length = 0;
      t0 = performance.now();
      // 40 px every frame for ~1.5 s: the strip under the bar turns dark after ~17 frames (~280 ms)
      await evalIn(tMixed, "let y=0;const id=setInterval(()=>{y+=40;scrollTo(0,y);if(y>=3600)clearInterval(id)},16);1");
      await spike.sleep(2200);
      const change = timeline.find((e) => e.changed);
      spike.log("T3 continuous scroll for ~1.5 s, mode", mode + ": class became dark", change ? (change.at - t0).toFixed(0) + " ms after scrolling started" : "NEVER", "| samples taken:", timeline.length, "| final", cls());
    }
    cfg.scrollMode = "debounce";

    // ---- T4: second window ----
    {
      const win2 = OpenBrowserWindow();
      await new Promise((r) => {
        const obs = (w) => {
          if (w === win2) {
            Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
            r();
          }
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
      await spike.sleep(500);
      const g2 = win2.gBrowser;
      const d2 = g2.addTab(dark, { triggeringPrincipal: vx.SYS });
      await vx.waitLoaded(d2.linkedBrowser);
      g2.selectedTab = d2;
      await spike.sleep(600);
      const c2 = win2.document.documentElement.className.match(/theme-\w+/)?.[0];
      d2.linkedBrowser.browsingContext.currentWindowGlobal.getActor("VitreProbe").sendAsyncMessage("Vitre:ScrollTo", { y: 10 });
      await spike.sleep(300);
      spike.log("T4 second window: dark tab selected there ->", c2, win2.vxThemeOf(d2.linkedBrowser), "| first window unchanged:", cls(), "| VitreProbe present in window 2:", !!win2.VitreProbe);
      win2.close();
      await spike.sleep(300);
    }

    // ---- T5: real sites ----
    for (const url of ["https://en.wikipedia.org/wiki/Gecko_(software)", "https://www.mozilla.org/en-US/", "https://github.com/mozilla/gecko-dev", "https://news.ycombinator.com/"]) {
      const t = vx.addTab(url);
      const ok = await vx.waitLoaded(t.linkedBrowser);
      gBrowser.selectedTab = t;
      await spike.sleep(900);
      spike.log("T5", url.slice(8, 40), "loaded", ok, "->", cls(), themes.get(t.linkedBrowser));
      if (/mozilla\.org/.test(url)) await spike.capture("v-theme-real-site");
    }
  });
})();
