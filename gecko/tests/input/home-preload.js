// A new tab shows Home's picture from its first frame: no white or grey frame (owner's report,
// 2026-10-05). Firefox's new-tab preloading is on for Deer's Home (VitreStartup.useHomeAsNewTab):
// each window keeps one Home page drawn in a hidden browser, and the next new tab takes it.
//   python tools/run.py --test tests/input/home-preload.js --name input-home-preload --timeout 300
// Every frame for a while after b.newTab(), the middle of the page area is read back from the
// window (canvas drawWindow: what the window draws then, Home included, since Home runs in this
// process). A frame is "white" when all channels are above 235 and "grey" when it is Home's plain
// base colour #2b2a2e. Run once with preloading off (browser.newtab.preload false: how Deer behaved
// before), then on. Captures: home-preload-1-tab.
/* global spike, Services, IOUtils, PathUtils, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const settings = b.sys("VitreSettings");
  const out = Services.env.get("VITRE_OUT");
  await spike.resize(1440, 900);
  await spike.activate();

  // A mid-tone picture, so white, the plain grey and the picture are told apart.
  async function picture(name) {
    const w = 2560;
    const h = 1440;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#2f6f4f");
    g.addColorStop(1, "#9a7b3c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const path = PathUtils.join(out, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  settings.set({ homeBackground: { kind: "image", path: await picture("home-preload.jpg") } });

  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pixel = () => {
    ctx.drawWindow(window, Math.round(window.innerWidth / 2), Math.round(window.innerHeight * 0.6), 1, 1, "rgb(255,0,255)");
    const [r, g, bl] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, bl];
  };
  const kind = ([r, g, bl]) => (r > 235 && g > 235 && bl > 235 ? "white" : r === 43 && g === 42 && bl === 46 ? "grey" : r === 255 && g === 0 && bl === 255 ? "none" : "other");

  /** Open a new tab and read the page area on every frame until Home's picture is there plus 10 frames. */
  async function frames(what) {
    const seen = [];
    const done = new Promise((resolve) => {
      let after = -1;
      const tick = () => {
        const p = pixel();
        seen.push(p);
        const tab = b.active();
        const ds = tab?.url === "about:vitre-home" ? tab.browser.contentDocument?.documentElement?.dataset : null;
        if (after < 0 && ds?.state === "ready" && tab !== before) after = 10;
        if (after === 0 || seen.length > 120) resolve();
        else {
          if (after > 0) after--;
          window.requestAnimationFrame(tick);
        }
      };
      window.requestAnimationFrame(tick);
    });
    const before = b.active();
    const preloaded = gBrowser.preloadedBrowser;
    const tab = b.newTab();
    await done;
    const kinds = seen.map(kind);
    const summary = { frames: seen.length, white: kinds.filter((k) => k === "white").length, grey: kinds.filter((k) => k === "grey").length, usedPreloaded: !!preloaded && tab.browser === preloaded, first: seen.slice(0, 4).map((p) => p.join(",")) };
    log(what, JSON.stringify(summary));
    return { tab, summary };
  }
  const waitPreloaded = (what) =>
    waitFor(() => gBrowser.preloadedBrowser?.contentDocument?.documentElement?.dataset?.state === "ready", { timeout: 20000, what });

  // 1. Before: preloading off (how Deer opened new tabs until now).
  Services.prefs.setBoolPref("browser.newtab.preload", false);
  ChromeUtils.importESModule("moz-src:///browser/components/tabbrowser/NewTabPagePreloading.sys.mjs").NewTabPagePreloading.removePreloadedBrowser(window);
  const off = [];
  for (let i = 0; i < 3; i++) {
    off.push((await frames("preload off " + (i + 1))).summary);
    await sleep(600);
  }

  // 2. After: preloading on. The window makes its hidden Home when idle; each new tab takes it.
  Services.prefs.setBoolPref("browser.newtab.preload", true);
  ChromeUtils.importESModule("moz-src:///browser/components/tabbrowser/NewTabPagePreloading.sys.mjs").NewTabPagePreloading.maybeCreatePreloadedBrowser(window);
  await waitPreloaded("a preloaded Home");
  check("the window keeps a Home page loaded in a hidden browser", gBrowser.preloadedBrowser.currentURI.spec === "about:vitre-home");
  const on = [];
  let last;
  for (let i = 0; i < 3; i++) {
    await waitPreloaded("a preloaded Home before tab " + (i + 1));
    last = await frames("preload on " + (i + 1));
    on.push(last.summary);
    await sleep(600);
  }
  await spike.capture("home-preload-1-tab");
  check("new tabs take the preloaded Home", on.every((s) => s.usedPreloaded), on.map((s) => s.usedPreloaded));
  check("no white frame when a new tab opens", on.every((s) => s.white === 0), on.map((s) => s.white));
  check("no plain grey frame when a new tab opens", on.every((s) => s.grey === 0), on.map((s) => s.grey));
  log("before (preload off): white frames", off.map((s) => s.white).join("/"), "grey frames", off.map((s) => s.grey).join("/"));

  // 3. Deer's own state for the taken tab is right: address, title, the Home glass.
  const t = last.tab;
  check("the tab is Deer's Home tab (address, title Home)", t.url === "about:vitre-home" && t.title === "Home" && b.active() === t, { url: t.url, title: t.title });
  check("the preloaded page is visible once it is a tab", t.browser.contentDocument.visibilityState === "visible");

  // 4. Two new tabs at once: the second has no preloaded page yet. Reported, not failed.
  const quick = await frames("second tab right after the first");
  log("second tab at once:", JSON.stringify(quick.summary));
});
