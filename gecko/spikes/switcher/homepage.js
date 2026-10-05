// SPIKE switcher/5: Home. A privileged page (about:vitre-home) as new tab / home page, showing the
// user's Windows wallpaper; custom image and video backgrounds; nsIFilePicker; and the alternative
// (a layer in the chrome document) for comparison.
// Run: python tools/run.py --boot spikes/switcher/homepage.js --name switcher-home --out spikes/switcher/out/home --timeout 180
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils, BrowserCommands, gURLBar, isInitialPage, BROWSER_NEW_TAB_URL, HomePage */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const { VitreSettings } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreSettings.sys.mjs");
  const { VitreWallpaper } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreWallpaper.sys.mjs");
  const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
  VitreSettings.init();

  // ---- A. where the wallpaper is ----
  const reg = VitreWallpaper.registryPath();
  const tr = VitreWallpaper.transcodedPath();
  spike.log("A registry WallPaper =", JSON.stringify(reg), "exists", reg ? await IOUtils.exists(reg) : false);
  spike.log("A TranscodedWallpaper =", tr.replace(Services.env.get("APPDATA"), "%APPDATA%"), "exists", await IOUtils.exists(tr), "bytes", (await IOUtils.stat(tr).catch(() => ({}))).size);
  const found = await VitreWallpaper.find();
  spike.log("A find() ->", found && found.source);
  for (const p of [reg, tr]) {
    if (!p || !(await IOUtils.exists(p))) continue;
    const t0 = performance.now();
    const luma = await VitreWallpaper.meanLuma(window, p);
    spike.log("A mean luma of", PathUtils.filename(p), "=", luma.toFixed(3), "in", vx.ms(t0), "ms (read + decode to 64x36)");
  }
  // TranscodedWallpaper has no extension: does a plain <img src=file://> sniff it?
  {
    const img = new Image();
    img.src = VitreWallpaper.fileURL(tr);
    const ok = await img.decode().then(() => true, (e) => String(e));
    spike.log("A <img> of extension-less TranscodedWallpaper decodes:", ok, img.naturalWidth + "x" + img.naturalHeight);
  }

  // ---- B. register chrome package + about:vitre-home, make it new tab and home ----
  VitreHomeAbout.register("resource://vitre-boot/");
  // The harness writes browser.startup.homepage=about:blank as a USER pref, which hides the default
  // that register() installs; a real Vitre profile has no such user value.
  Services.prefs.clearUserPref("browser.startup.homepage");
  spike.log("B BROWSER_NEW_TAB_URL =", BROWSER_NEW_TAB_URL, "| HomePage.get() =", HomePage.get(), "| isInitialPage =", isInitialPage(VitreHomeAbout.URL));

  const t0open = performance.now();
  BrowserCommands.openTab();
  const home = gBrowser.selectedTab;
  const hb = home.linkedBrowser;
  const ready = async (b, since = 0) => {
    for (let i = 0; i < 200; i++) {
      const r = b.contentDocument?.documentElement?.dataset?.ready;
      if (r && +r > since) return true;
      await spike.sleep(25);
    }
    return false;
  };
  const okReady = await ready(hb);
  const ds = () => ({ ...hb.contentDocument.documentElement.dataset });
  spike.log("B Ctrl+T -> Home ready", okReady, "in", vx.ms(t0open), "ms; currentURI", hb.currentURI.spec, "| document", hb.contentDocument?.documentURI,
    "| remoteType", JSON.stringify(hb.remoteType), "| isRemoteBrowser", hb.isRemoteBrowser,
    "| system principal", hb.contentPrincipal.isSystemPrincipal, "| urlbar value", JSON.stringify(gURLBar.value), "| tab label", home.label);
  spike.log("B page dataset", ds());
  await spike.capture("home-wallpaper");

  // thumbnail + strip sampling of the Home tab use the same primitive as web tabs
  {
    const wgp = hb.browsingContext.currentWindowGlobal;
    let t0 = performance.now();
    const bmp = await wgp.drawSnapshot(null, 0.5, "white");
    spike.log("B Home tab drawSnapshot (in-process browser)", bmp.width + "x" + bmp.height, vx.ms(t0), "ms", vx.stats(bmp, 32, 20));
    t0 = performance.now();
    const strip = await wgp.drawSnapshot(new DOMRect(0, 0, 1264, 64), 0.125, "white");
    spike.log("B Home strip sample", vx.stats(strip), vx.ms(t0), "ms");
  }

  // back/forward: Home -> a web page -> back to Home (process switch both ways)
  hb.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: vx.SYS });
  await spike.sleep(300);
  await vx.waitLoaded(home.linkedBrowser);
  spike.log("B navigated from Home:", home.linkedBrowser.currentURI.spec, "remoteType", home.linkedBrowser.remoteType, "canGoBack", home.linkedBrowser.canGoBack);
  home.linkedBrowser.goBack();
  await spike.sleep(1200);
  spike.log("B after Back:", home.linkedBrowser.currentURI.spec, "remoteType", JSON.stringify(home.linkedBrowser.remoteType), "ready", await ready(home.linkedBrowser));
  // Home button / Alt+Home
  const t2 = vx.addTab("https://example.com/");
  await vx.waitLoaded(t2.linkedBrowser);
  gBrowser.selectedTab = t2;
  BrowserCommands.home();
  await spike.sleep(1200);
  spike.log("B BrowserCommands.home() loads", gBrowser.selectedBrowser.currentURI.spec);
  gBrowser.removeTab(t2);
  gBrowser.selectedTab = home;
  await spike.sleep(300);

  // ---- C. custom image background, through the settings (the open Home page follows the pref) ----
  const dir = PathUtils.join(PathUtils.profileDir, "vitre-test-media");
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const imgPath = PathUtils.join(dir, "custom background é #1.png"); // awkward characters on purpose
  {
    const c = new OffscreenCanvas(1600, 900);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 1600, 900);
    grad.addColorStop(0, "#0b1d3a");
    grad.addColorStop(0.5, "#6b2a7a");
    grad.addColorStop(1, "#f08a4b");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 900);
    g.fillStyle = "rgba(255,255,255,.9)";
    g.font = "600 60px Segoe UI";
    g.fillText("custom image background", 80, 820);
    const blob = await c.convertToBlob({ type: "image/png" });
    await IOUtils.write(imgPath, new Uint8Array(await blob.arrayBuffer()));
  }
  let since = Date.now();
  VitreSettings.set({ homeBackground: { kind: "image", path: imgPath } });
  await ready(home.linkedBrowser, since);
  spike.log("C image background via settings:", { ...home.linkedBrowser.contentDocument.documentElement.dataset });
  await spike.capture("home-custom-image");
  {
    const wgp = home.linkedBrowser.browsingContext.currentWindowGlobal;
    const t0 = performance.now();
    const bmp = await wgp.drawSnapshot(null, 0.5, "white");
    spike.log("C Home drawSnapshot with a 1600x900 image (versus the 5120x2880 wallpaper above):", vx.ms(t0), "ms", bmp.width + "x" + bmp.height);
  }

  // ---- D. video background: record a short WebM in-process, then use it as a picked file ----
  const vidPath = PathUtils.join(dir, "custom background.webm");
  {
    const c = document.createElementNS(vx.HTML, "canvas");
    c.width = 640;
    c.height = 360;
    const g = c.getContext("2d");
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    await new Promise((r) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = `hsl(${(t * 120) % 360} 60% 30%)`;
        g.fillRect(0, 0, 640, 360);
        g.fillStyle = "#4cc2ff";
        g.beginPath();
        g.arc(60 + ((t * 260) % 520), 180, 50, 0, 7);
        g.fill();
        g.fillStyle = "#fff";
        g.font = "600 28px Segoe UI";
        g.fillText("video background " + t.toFixed(2) + "s", 20, 40);
        if (t < 2.2) requestAnimationFrame(frame);
        else r();
      };
      frame();
    });
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    await IOUtils.write(vidPath, new Uint8Array(await blob.arrayBuffer()));
    spike.log("D recorded test video", blob.size, "bytes");
  }
  since = Date.now();
  VitreSettings.set({ homeBackground: { kind: "video", path: vidPath } });
  await ready(home.linkedBrowser, since);
  const video = () => home.linkedBrowser.contentDocument.querySelector("video");
  const ct1 = video()?.currentTime;
  spike.log("D video background via settings:", { ...home.linkedBrowser.contentDocument.documentElement.dataset });
  await spike.capture("home-video-1");
  await spike.sleep(600);
  await spike.capture("home-video-2");
  spike.log("D video currentTime", ct1, "->", video()?.currentTime, "paused", video()?.paused);
  // a Home tab in the background does not keep decoding: check after switching away
  const other = vx.addTab(vx.page(1, "#246"));
  await vx.waitLoaded(other.linkedBrowser);
  gBrowser.selectedTab = other;
  await spike.sleep(1500);
  const bgA = video()?.currentTime;
  await spike.sleep(1000);
  spike.log("D Home in a background tab: video currentTime", bgA, "->", video()?.currentTime, "(still advancing = Home must pause it itself on visibilitychange)",
    "visibilityState", home.linkedBrowser.contentDocument.visibilityState);
  gBrowser.selectedTab = home;
  gBrowser.removeTab(other);

  // ---- E. nsIFilePicker ----
  const TITLE = "Vitre spike choose background 7f3a";
  function pickBackground() {
    return new Promise((resolve) => {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, TITLE, Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages | Ci.nsIFilePicker.filterVideo);
      fp.appendFilter("Pictures and videos", "*.jpg; *.jpeg; *.png; *.webp; *.avif; *.gif; *.bmp; *.mp4; *.webm; *.mkv; *.mov");
      fp.open((result) => {
        if (result !== Ci.nsIFilePicker.returnOK || !fp.file) return resolve(null);
        const path = fp.file.path;
        const kind = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(path) ? "video" : "image";
        VitreSettings.set({ homeBackground: { kind, path } });
        resolve({ kind, path });
      });
    });
  }
  // E1. the real native dialog: prove it appears, then dismiss it with WM_CLOSE
  {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const FindWindowW = user32.declare("FindWindowW", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const p = pickBackground();
    let hwnd = null, waited = 0;
    for (; waited < 8000; waited += 100) {
      await spike.sleep(100);
      hwnd = FindWindowW(null, TITLE);
      if (!hwnd.isNull()) break;
    }
    spike.log("E1 real file dialog window found:", !hwnd.isNull(), "after", waited, "ms (FindWindowW by title)");
    if (!hwnd.isNull()) {
      await spike.sleep(500);
      PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, 0, 0);
    }
    const r = await Promise.race([p, spike.sleep(5000).then(() => "TIMEOUT")]);
    spike.log("E1 after WM_CLOSE the picker callback returned:", r, "(null = cancelled)");
    user32.close();
  }
  // E2. the consumer path with a stand-in picker factory that "chooses" the test image
  {
    const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    const CONTRACT = "@mozilla.org/filepicker;1";
    const original = registrar.contractIDToCID(CONTRACT);
    const CID = Components.ID("{b1c2d3e4-0000-4a7f-9d11-7a5c5f3e2a10}");
    const seenArgs = {};
    const factory = {
      createInstance(iid) {
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(imgPath);
        return {
          init(bc, title, mode) { seenArgs.title = title; seenArgs.mode = mode; seenArgs.bc = !!bc; },
          appendFilters(f) { seenArgs.filters = f; },
          appendFilter(t, f) { seenArgs.custom = f; },
          open(cb) { Services.tm.dispatchToMainThread(() => cb.done(Ci.nsIFilePicker.returnOK)); },
          file,
          QueryInterface: ChromeUtils.generateQI(["nsIFilePicker"]),
        }.QueryInterface(iid);
      },
      QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    };
    registrar.registerFactory(CID, "spike picker", CONTRACT, factory);
    since = Date.now();
    const r = await pickBackground();
    registrar.unregisterFactory(CID, factory);
    registrar.registerFactory(original, "", CONTRACT, null);
    await ready(home.linkedBrowser, since);
    spike.log("E2 stand-in picker returned", r && { kind: r.kind, file: PathUtils.filename(r.path) }, "init args", seenArgs);
    spike.log("E2 settings now", VitreSettings.get().homeBackground.kind, "| Home page shows", home.linkedBrowser.contentDocument.documentElement.dataset.kind,
      home.linkedBrowser.contentDocument.documentElement.dataset.img);
  }

  // ---- F. the alternative: Home as a layer in the chrome document under the bar ----
  {
    VitreSettings.set({ homeBackground: { kind: "windows", path: "" } });
    const blank = vx.addTab("about:blank");
    gBrowser.selectedTab = blank;
    await spike.sleep(300);
    const r = gBrowser.selectedBrowser.getBoundingClientRect();
    const t0 = performance.now();
    const layer = vx.el("div", `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:10;` +
      `background:#101014 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#111;font:600 40px Segoe UI`);
    const img = new Image();
    img.src = VitreWallpaper.fileURL(found.path);
    await img.decode();
    layer.style.backgroundImage = `url("${img.src}")`;
    layer.textContent = "Home as a chrome-document layer";
    document.documentElement.append(layer);
    spike.log("F chrome layer shown in", vx.ms(t0), "ms; the tab under it is", gBrowser.selectedBrowser.currentURI.spec);
    await spike.capture("home-layer-variant");
    // what the switcher would get as this tab's thumbnail: the blank page, not Home
    const bmp = await gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.drawSnapshot(null, 0.25, "white");
    spike.log("F thumbnail of the layer-variant tab (drawSnapshot sees only the blank page):", vx.stats(bmp, 16, 10));
    layer.remove();
    gBrowser.removeTab(blank);
  }
  spike.log("done; final settings.homeBackground", VitreSettings.get().homeBackground);
});
