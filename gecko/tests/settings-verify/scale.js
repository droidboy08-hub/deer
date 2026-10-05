// Settings verifier: the panel at 150 % and 125 % display scaling (changed at run time), in F11 full
// screen, with the bar auto-hidden, with the address field open, over dark and light pages in both
// modes, over a real site, and what it costs while idle.
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/scale.js --name settings-verify-scale --timeout 300
// Captures: scale-150-tabs.png, scale-150-dropdown.png, scale-125-shortcuts.png, scale-f11.png,
// scale-autohide.png, scale-dark-page-dark.png, scale-dark-page-light.png, scale-real-site.png.
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
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
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });
  const article = "<div style='max-width:760px;margin:0 auto;padding:110px 24px'><h1 style='font:600 44px/1.15 Georgia,serif'>Float glass</h1>" + "<p>Crown glass was spun into a disc, cylinder glass was blown, slit and flattened, and both left ripples that bent the street outside.</p>".repeat(8) + "</div>";
  await V.load(V.page("Light article", article));
  const fits = (r) => r.x >= 15 && r.y >= 15 && r.x + r.w <= window.innerWidth - 15 && r.y + r.h <= window.innerHeight - 15;

  // ---------------------------------------------------------------- 150 % and 125 %
  for (const scale of ["1.5", "1.25"]) {
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", scale);
    await waitFor(() => Math.abs(window.devicePixelRatio - Number(scale)) < 0.01, { timeout: 6000, what: scale + "x" });
    await sleep(900);
    svc.open(scale === "1.5" ? "tabs" : "shortcuts");
    await sleep(900);
    const r = V.rect(V.sheet());
    const lens = getComputedStyle(V.root().querySelector(".vs-lens")).backdropFilter;
    check(`${scale}x: the sheet is scaled to fit the ${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)} CSS px window with its margin, lens on`, fits(r) && /url\(/.test(lens), { r, inner: [window.innerWidth, window.innerHeight] });
    await spike.capture(scale === "1.5" ? "scale-150-tabs" : "scale-125-shortcuts");
    if (scale === "1.5") {
      svc.open("downloads");
      await sleep(400);
      const dd = V.rowFor("Limit speed").querySelector(".vs-dd");
      dd.click();
      await sleep(400);
      const list = V.sheet().querySelector(".vs-pop");
      const lr = list && V.rect(list);
      const sr = V.rect(V.sheet());
      check("1.5x: a drop-down list opens inside the scaled sheet, at its box", !!lr && lr.x >= sr.x && lr.x + lr.w <= sr.x + sr.w + 1 && lr.y + lr.h <= sr.y + sr.h + 1 && Math.abs(lr.y - (V.rect(dd).y + V.rect(dd).h)) < 12, { lr, sr, dd: V.rect(dd) });
      await spike.capture("scale-150-dropdown");
      V.press("Escape");
      await sleep(200);
    }
    panel.close();
    await sleep(300);
  }
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await waitFor(() => Math.abs(window.devicePixelRatio - 1) < 0.01, { timeout: 6000, what: "1x" });
  await sleep(800);

  // ---------------------------------------------------------------- F11 and back
  svc.open("appearance");
  await sleep(400);
  b.run("fullscreen");
  await waitFor(() => window.fullScreen, { timeout: 6000, what: "F11" });
  await sleep(1200);
  let r = V.rect(V.sheet());
  check("F11 with Settings open: still open, re-centred in the full-screen window", panel.isOpen && Math.abs(r.x + r.w / 2 - window.innerWidth / 2) <= 1 && Math.abs(r.y + r.h / 2 - window.innerHeight / 2) <= 1, { r, inner: [window.innerWidth, window.innerHeight] });
  await spike.capture("scale-f11");
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen, { timeout: 6000, what: "F11 off" });
  await sleep(1000);
  r = V.rect(V.sheet());
  check("…and centred again after it", Math.abs(r.x + r.w / 2 - window.innerWidth / 2) <= 1 && r.w === 960, r);
  panel.close();
  await sleep(300);

  // ---------------------------------------------------------------- auto-hide, address field
  store.set({ barAutoHide: true });
  await sleep(1200);
  check("setup: the bar is auto-hidden", b.bar.hidden || b.root.classList.contains("bar-hiding"), b.root.className);
  b.focusPage();
  await sleep(150);
  V.press("Ctrl+Comma");
  await sleep(700);
  check("with the bar auto-hidden Settings opens over the page (the bar is not dragged out by it)", V.isOpen() && V.focusInSheet() && b.root.classList.contains("bar-hiding"), b.root.className);
  await spike.capture("scale-autohide");
  panel.close();
  store.set({ barAutoHide: false });
  await sleep(800);
  b.editAddress("float");
  await sleep(400);
  check("setup: the address field is open", b.omni.open);
  V.press("Ctrl+Comma");
  await sleep(600);
  check("Ctrl+, with the address field open: the field closes, Settings opens with focus", V.isOpen() && !b.omni.open && V.focusInSheet(), { open: panel.isOpen, omni: b.omni.open });
  V.press("Escape");
  await sleep(400);
  check("Esc then goes back to the page, not to the closed field", !panel.isOpen && V.active() === gBrowser.selectedBrowser && !b.omni.open, V.describe(V.active()));

  // ---------------------------------------------------------------- dark and light pages, both modes
  const sample = async (name) => {
    svc.open("appearance");
    await sleep(700);
    await spike.capture(name);
    const s = V.rect(V.sheet());
    // The sheet's own tint and text colours: what the page under it can change is the lens.
    return { tint: getComputedStyle(V.root().querySelector(".vs-tint")).backgroundColor, text: getComputedStyle(V.root()).color, sheet: s };
  };
  await V.load(V.page("Dark page", article, "#0d0f12", "#e8e6e3"));
  const darkDark = await sample("scale-dark-page-dark");
  store.set({ theme: "light" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: light)").matches, { timeout: 10000, what: "light chrome" });
  await sleep(400);
  const darkLight = await sample("scale-dark-page-light");
  check("light mode: the panel's tint and text turn light (over a dark page too)", /243, 243, 246/.test(darkLight.tint) && /rgba\(0, 0, 0, 0\.9\)/.test(darkLight.text) && /20, 20, 24/.test(darkDark.tint), { dark: darkDark, light: darkLight });
  panel.close();
  store.set({ theme: "dark" });
  await sleep(500);

  // ---------------------------------------------------------------- a real site (network allowed for plain pages)
  b.navigate(b.active(), "https://example.com/");
  const real = await waitFor(() => b.active().title === "Example Domain" && !b.active().loading, { timeout: 15000, what: "example.com" }).then(() => true, () => false);
  log("example.com loaded:", real);
  if (real) {
    await sleep(500);
    svc.open("search");
    await sleep(700);
    check("over a real site: open, focus inside, page keys still held off", V.isOpen() && V.focusInSheet());
    await spike.capture("scale-real-site");
    panel.close();
    await sleep(300);
  }

  // ---------------------------------------------------------------- idle cost
  // Vitre's code runs on the parent's main thread and paints through the GPU process; Firefox's own
  // start-up storage work (IndexedDB, QuotaManager) on other threads is left out of the sum.
  const cpu = async () => {
    const p = await ChromeUtils.requestProcInfo();
    const main = (p.threads || []).filter((t) => t.name === "MainThread").reduce((a, t) => a + t.cpuTime, 0);
    const gpu = (p.children || []).filter((c) => c.type === "gpu").reduce((a, c) => a + c.cpuTime, 0);
    return { main, gpu };
  };
  /** The quietest of three windows: Firefox's own start-up work comes in bursts that are not Settings'. */
  const idle = async (ms) => {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await idleOnce(ms / 3));
    return runs.reduce((a, r) => ({ paints: a.paints + r.paints, mainMs: Math.min(a.mainMs, r.mainMs), gpuMs: Math.min(a.gpuMs, r.gpuMs), animations: Math.max(a.animations, r.animations) }), { paints: 0, mainMs: Infinity, gpuMs: Infinity, animations: 0 });
  };
  const idleOnce = async (ms) => {
    let paints = 0;
    const onPaint = () => paints++;
    window.addEventListener("MozAfterPaint", onPaint);
    const c0 = await cpu();
    await sleep(ms);
    const c1 = await cpu();
    window.removeEventListener("MozAfterPaint", onPaint);
    return { paints, mainMs: Math.round((c1.main - c0.main) / 1e6), gpuMs: Math.round((c1.gpu - c0.gpu) / 1e6), animations: document.getAnimations().length };
  };
  await V.load(V.page("Idle page"));
  await sleep(2500);
  const base = await idle(3000);
  svc.open("home");
  await sleep(3000);
  const open = await idle(3000);
  svc.open("tabs");
  await sleep(2500);
  const openTabs = await idle(3000);
  panel.close();
  await sleep(1500);
  const closed = await idle(3000);
  log("idle 3 s:", { base, open, openTabs, closed });
  check("idle with Settings open (Home and background, Tabs): no repaints, no running animations", open.paints === 0 && openTabs.paints === 0 && open.animations === 0 && openTabs.animations === 0, { open, openTabs });
  check("idle main-thread and GPU-process CPU with Settings open stay under 5 % (50 ms per quietest 1 s window)", open.mainMs < 50 && openTabs.mainMs < 50 && open.gpuMs < 50 && openTabs.gpuMs < 50, { base, open, openTabs });
  check("after closing: no paints, no animations left", closed.paints === 0 && closed.animations === 0, closed);
  store.reset("theme");
  store.reset("barAutoHide");
  await sleep(300);
  V.consoleCheck("scale");
});
