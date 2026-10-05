// Home (about:vitre-home) with each background kind, and how the bar shows it.
//   python tools/run.py --test tests/input/home.js --name input-home --timeout 300
// Captures in tests/input/out: home-1-windows (the user's own wallpaper), home-2-image-light,
// home-3-image-dark, home-4-video, home-5-none, home-6-second-window.
// The pictures and the video are made here (canvas, MediaRecorder) and written to the output folder.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const settings = b.sys("VitreSettings");
  const home = b.sys("VitreHome");
  const out = Services.env.get("VITRE_OUT");
  await spike.resize(1440, 900);
  await spike.activate();

  // ---- test media ----
  async function picture(name, w, h, base, ink, type = "image/png") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink;
    for (let i = 0; i < 9; i++) ctx.fillRect((w / 9) * i + w / 40, h * 0.45 + (i % 3) * h * 0.08, w / 14, h * 0.3);
    ctx.font = `${Math.round(h / 9)}px Segoe UI`;
    ctx.fillText(name, w * 0.06, h * 0.3);
    const blob = await canvas.convertToBlob({ type, quality: 0.9 });
    const path = PathUtils.join(out, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  async function video(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.fillStyle = "#16324a";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#e9b949";
        ctx.fillRect(40 + t * 220, 150, 120, 120);
        ctx.fillStyle = "#ffffff";
        ctx.font = "40px Segoe UI";
        ctx.fillText("video " + t.toFixed(1), 40, 90);
        if (t < 2.2) requestAnimationFrame(frame);
        else done();
      };
      frame();
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    const path = PathUtils.join(out, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return { path, size: blob.size };
  }
  const bright = await picture("home bright é #1.png", 4200, 2600, "#efe9dc", "#c9b79a");
  const dark = await picture("home-dark.jpg", 1200, 800, "#14202b", "#2f5d7c", "image/jpeg");
  const clip = await video("home-video.webm");
  log("test media: " + JSON.stringify({ bright, dark, video: clip }));

  // ---- helpers ----
  const page = () => b.active().browser.contentDocument;
  const data = () => ({ ...page().documentElement.dataset });
  const ready = (kind) => waitFor(() => { const d = page()?.documentElement.dataset; return d && d.kind === kind && (d.state === "ready" || d.state === "error") ? d : null; }, { timeout: 20000, what: "Home showing " + kind });
  const media = () => [...page().querySelectorAll("#bg > .media")];
  const barState = () => {
    const pill = document.querySelector("#vitre-bar .item.active");
    // Board (Home): the navigation buttons are not drawn at all; the placeholder spans the pill.
    return { home: pill.classList.contains("home"), text: pill.querySelector(".host").textContent, placeholder: pill.querySelector(".address").classList.contains("placeholder"), nav: [...pill.querySelectorAll(".back, .forward, .reload")].map((n) => (n.getClientRects().length ? "drawn" : "none")).join() };
  };

  // ------------------------------------------------------------------ 1. the Windows wallpaper
  log("--- 1. Home with the Windows wallpaper");
  const wallpaper = await home.windowsWallpaper();
  log("Windows wallpaper: " + JSON.stringify(wallpaper));
  await K.load("https://example.com/");
  b.focusPage();
  await sleep(200);
  K.press("Ctrl+T");
  await waitFor(() => b.active().url === "about:vitre-home", { timeout: 10000, what: "Home tab" });
  const homeTab = b.active();
  let d = await ready("windows");
  K.press("Escape");
  await sleep(600);
  check("a new tab is Home: about:vitre-home, in the parent process, titled Home", homeTab.kind === "home" && homeTab.title === "Home" && !homeTab.browser.isRemoteBrowser && page().nodePrincipal.isSystemPrincipal, { title: homeTab.title, remote: homeTab.browser.isRemoteBrowser });
  check("the page is static and locked down: a strict CSP, no inline script, one script and one sheet from the package", !!page().querySelector("meta[http-equiv='Content-Security-Policy']")?.content.includes("default-src 'none'") && [...page().scripts].every((s) => s.src.startsWith("chrome://vitre/content/pages/home/") && !s.textContent) && page().body.children.length === 2, [...page().scripts].map((s) => s.src));
  const img = media()[0];
  const box = { w: Math.round(window.screen.width * window.devicePixelRatio), h: Math.round(window.screen.height * window.devicePixelRatio) };
  if (wallpaper) {
    check("the user's Windows wallpaper fills the page", media().length === 1 && img.localName === "img" && img.naturalWidth > 0 && img.classList.contains("shown") && img.getBoundingClientRect().width === window.innerWidth, { natural: [img.naturalWidth, img.naturalHeight], src: img.src.slice(0, 80) });
    const copy = PathUtils.join(PathUtils.profileDir, "vitre-home", "picture.jpg");
    const meta = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "vitre-home", "picture.json")).catch(() => null);
    const stat = await IOUtils.stat(wallpaper.path);
    log("wallpaper file " + stat.size + " bytes; shown " + img.naturalWidth + "x" + img.naturalHeight + " on a " + box.w + "x" + box.h + " screen; cache " + JSON.stringify(meta) + "; first load took " + d.ms + " ms");
    check("a wallpaper larger than the screen is shown from a screen-sized cached copy in the profile; a smaller one is shown as it is", meta && (meta.direct ? img.src.startsWith("file:") && !img.src.includes("vitre-home") : (await IOUtils.exists(copy)) && img.src.includes("vitre-home/picture.jpg") && img.naturalWidth <= box.w + 1 || img.naturalHeight <= box.h + 1), meta);
  } else {
    check("with no Windows wallpaper Home shows the plain background", media().length === 0 && d.state === "ready");
  }
  check("the wallpaper's brightness picks the glass: light above 0.62, clear otherwise, and the bar follows", d.theme === (Number(d.luma) > 0.62 ? "light" : "clear") && b.theme() === d.theme && b.homeTheme === d.theme && b.root.classList.contains("theme-" + d.theme), { luma: d.luma, theme: d.theme, bar: b.theme() });
  check("the bar shows Home as the design does: the search placeholder, no host, no Back / Forward / Reload", JSON.stringify(barState()) === JSON.stringify({ home: true, text: "Search or enter address", placeholder: true, nav: "none,none,none" }), barState());
  await sleep(500);
  await spike.capture("home-1-windows");

  // ------------------------------------------------------------------ 2. a bright picture
  log("--- 2. a picture");
  settings.set({ homeBackground: { kind: "image", path: bright } });
  d = await ready("image");
  await sleep(500);
  const big = media()[0];
  check("choosing a picture in settings changes the open Home page at once, cross-fading (one picture left afterwards)", media().length === 1 && big.naturalWidth > 0 && d.state === "ready", { n: media().length, natural: [big.naturalWidth, big.naturalHeight] });
  check("a 4200x2600 picture is shown from the screen-sized copy (path with a space, an accent and #)", big.src.includes("vitre-home/picture.jpg") && big.naturalWidth < 4200 && (big.naturalWidth === Math.min(box.w, 3840) || big.naturalHeight === Math.round(box.h * Math.min(box.w, 3840) / box.w)), { src: big.src.slice(-60), natural: [big.naturalWidth, big.naturalHeight], box });
  check("a bright picture gives light glass", d.theme === "light" && Number(d.luma) > 0.62 && b.theme() === "light", d);
  await sleep(400);
  await spike.capture("home-2-image-light");

  settings.set({ homeBackground: { kind: "image", path: dark } });
  await waitFor(() => page().documentElement.dataset.theme === "clear" && page().documentElement.dataset.state === "ready", { timeout: 15000, what: "dark picture" });
  d = data();
  await sleep(600);
  const small = media()[0];
  check("a picture smaller than the screen is shown as it is, and a dark one gives clear glass", media().length === 1 && small.src.endsWith("home-dark.jpg") && small.naturalWidth === 1200 && d.theme === "clear" && Number(d.luma) < 0.62 && b.theme() === "clear" && b.root.classList.contains("theme-clear"), { src: small.src.slice(-30), d });
  await spike.capture("home-3-image-dark");

  // A Home tab closed while its (first, large) picture is still decoding must not leave the shared
  // decode hanging for every later Home tab (the decode runs on that tab's window).
  const huge = await picture("home-huge.jpg", 6000, 4000, "#d9d3c4", "#8a7a5a", "image/jpeg");
  const homeBefore = b.active();
  let stuck = 0;
  for (const delay of [0, 20]) {
    settings.set({ homeBackground: { kind: "image", path: huge } });
    await sleep(200);
    const firstHome = b.newTab();
    let seen = "";
    for (let k = 0; k < 2000 && !seen; k++) {
      const ds = firstHome.browser.contentDocument?.documentElement?.dataset;
      if (ds && ds.kind === "image" && ds.state) seen = ds.state;
      else await sleep(1);
    }
    await sleep(delay);
    const stateAtClose = firstHome.browser.contentDocument?.documentElement?.dataset.state;
    b.closeTab(firstHome);
    await sleep(150);
    const nextHome = b.newTab();
    const got = await waitFor(() => { const ds = nextHome.browser.contentDocument?.documentElement?.dataset; return ds && ds.kind === "image" && (ds.state === "ready" || ds.state === "error") ? ds.state : null; }, { timeout: 12000, what: "the next Home tab's picture" }).catch(() => "timeout");
    log("Home closed " + delay + " ms after its first state (" + stateAtClose + "); the next Home tab: " + got);
    if (got !== "ready") stuck++;
    if (b.omni.open) b.omni.close();
    b.closeTab(nextHome);
    await sleep(200);
    // Start the next round from a fresh decode: another background first.
    settings.set({ homeBackground: { kind: "image", path: dark } });
    await sleep(300);
  }
  b.activate(homeBefore);
  check("closing a Home tab mid-decode does not strand the next Home tab on 'loading'", stuck === 0, { stuck });
  settings.set({ homeBackground: { kind: "image", path: dark } });
  await waitFor(() => page().documentElement.dataset.state === "ready" && page().documentElement.dataset.theme === "clear", { timeout: 15000, what: "dark picture again" });

  // ------------------------------------------------------------------ 3. a video
  log("--- 3. a video");
  settings.set({ homeBackground: { kind: "video", path: clip.path } });
  d = await ready("video");
  await sleep(700);
  const v = media().find((m) => m.localName === "video");
  const t1 = v.currentTime;
  await sleep(500);
  const t2 = v.currentTime;
  check("a video background plays, muted and looping", !!v && v.muted && v.loop && !v.paused && t2 > t1 && d.state === "ready" && data().playing === "true", { t1, t2, paused: v.paused, size: [v.videoWidth, v.videoHeight] });
  check("the video's first frame picks the glass (a dark clip: clear)", data().theme === "clear" && b.theme() === "clear", data());
  await spike.capture("home-4-video");
  b.activate(b.tabs[0]);
  await sleep(700);
  const hiddenAt = v.currentTime;
  await sleep(700);
  const stillAt = v.currentTime;
  check("the video is paused while the Home tab is hidden", v.paused && stillAt === hiddenAt && homeTab.browser.contentDocument.visibilityState === "hidden", { hiddenAt, stillAt, paused: v.paused });
  b.activate(homeTab);
  await sleep(900);
  check("... and plays again when the tab is shown", !v.paused && v.currentTime !== stillAt, { paused: v.paused, now: v.currentTime });

  // ------------------------------------------------------------------ 4. none, and a missing file
  log("--- 4. none");
  settings.set({ homeBackground: { kind: "none", path: "" } });
  d = await ready("none");
  await sleep(600);
  check("'none' shows the plain base colour with clear glass", media().length === 0 && window.getComputedStyle(page().body).backgroundColor === "rgb(43, 42, 46)" && d.theme === "clear" && b.theme() === "clear", { n: media().length, bg: window.getComputedStyle(page().body).backgroundColor });
  await spike.capture("home-5-none");
  settings.set({ homeBackground: { kind: "image", path: PathUtils.join(out, "does-not-exist.png") } });
  d = await ready("image");
  await sleep(300);
  check("a file that cannot be opened falls back to the plain background", d.state === "error" && media().length === 0 && b.theme() === "clear", d);

  // ------------------------------------------------------------------ 5. every window, navigation, the web
  log("--- 5. windows and navigation");
  settings.set({ homeBackground: { kind: "image", path: bright } });
  await waitFor(() => page().documentElement.dataset.theme === "light" && page().documentElement.dataset.state === "ready", { timeout: 15000, what: "bright picture again" });
  Services.prefs.clearUserPref("browser.startup.page");
  Services.prefs.clearUserPref("browser.startup.homepage");
  const w2 = await spike.openWindow();
  await w2.spike.resize(1000, 700);
  await waitFor(() => w2.vitre.active().url === "about:vitre-home" && w2.vitre.active().browser.contentDocument?.documentElement.dataset.state === "ready", { timeout: 15000, what: "Home in the second window" });
  await sleep(500);
  check("a new window opens on Home and its bar has the same glass", w2.vitre.active().kind === "home" && w2.vitre.theme() === "light" && w2.vitre.homeTheme === "light", { url: w2.vitre.active().url, theme: w2.vitre.theme() });
  await w2.spike.capture("home-6-second-window");
  settings.set({ homeBackground: { kind: "image", path: dark } });
  await waitFor(() => w2.vitre.theme() === "clear" && b.theme() === "clear", { timeout: 15000, what: "both windows turning clear" });
  check("a change of background reaches every window's Home and bar", w2.vitre.active().browser.contentDocument.documentElement.dataset.theme === "clear");
  w2.close();
  await sleep(500);
  window.focus();
  b.activate(homeTab);
  await sleep(300);
  b.navigate(homeTab, "https://example.com/?from-home");
  await waitFor(() => homeTab.url.includes("from-home") && !homeTab.loading, { timeout: 20000, what: "navigation away from Home" });
  await sleep(500);
  const onWeb = { kind: homeTab.kind, remote: homeTab.browser.isRemoteBrowser, back: homeTab.canBack, theme: b.theme() };
  b.run("back");
  await waitFor(() => homeTab.url === "about:vitre-home" && page()?.documentElement.dataset.state === "ready", { timeout: 15000, what: "Back to Home" });
  check("Home navigates to a web page (in a content process, sampled glass) and Back returns to Home", onWeb.kind === "web" && onWeb.remote && onWeb.back && onWeb.theme === "light" && homeTab.kind === "home" && b.theme() === "clear", onWeb);
  b.activate(b.tabs[0]);
  await sleep(400);
  const blocked = await K.inPage(function (w) { try { w.wrappedJSObject.eval("window.open('about:vitre-home')"); return "opened"; } catch (e) { return "blocked: " + e.message; } });
  await sleep(600);
  check("a web page cannot open or link to about:vitre-home", String(blocked).startsWith("blocked") && b.tabs.filter((t) => t.url === "about:vitre-home").length === 1, blocked);
  settings.reset("homeBackground.kind");
  settings.reset("homeBackground.path");
  await sleep(300);
});
