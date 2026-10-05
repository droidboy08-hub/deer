// VERIFY switcher/Home: checks the spike did not run.
//  H1 repeated new-tab timings   H2 a new window opens Home   H3 web content cannot reach Home
//  H4 the REAL native file dialog driven end to end (window messages, no OS focus)
//  H5 the chrome-layer variant CAN have a thumbnail   H6 theme sampling of the Home tab
//  H7 the visibilitychange pause for the video background
// Run: python tools/run.py --boot spikes/switcher/verify/v-home.js --name switcher-verify-vhome --out spikes/switcher/verify/out/v-home --timeout 180
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils, BrowserCommands, gURLBar, OpenBrowserWindow, HomePage */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(() => {
  if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) return;
  spike.main(async () => {
    await spike.resize(1280, 800);
    const { VitreSettings } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreSettings.sys.mjs");
    const { VitreWallpaper } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreWallpaper.sys.mjs");
    const { VitreHomeAbout } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreHomeAbout.sys.mjs");
    VitreSettings.init();
    VitreHomeAbout.register("resource://vitre-boot/");
    Services.prefs.clearUserPref("browser.startup.homepage");
    const ready = async (b, since = 0) => {
      for (let i = 0; i < 400; i++) {
        const r = b.contentDocument?.documentElement?.dataset?.ready;
        if (r && +r > since) return true;
        await spike.sleep(10);
      }
      return false;
    };

    // ---- H1: new-tab timings, 6 opens ----
    const times = [];
    let home;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      BrowserCommands.openTab();
      home = gBrowser.selectedTab;
      // first paint-ish: document exists; ready: wallpaper decoded and luma computed
      let docAt = null;
      for (let j = 0; j < 800; j++) {
        const d = home.linkedBrowser.contentDocument;
        if (docAt === null && d?.documentURI === "about:vitre-home" && d.readyState !== "loading") docAt = performance.now() - t0;
        if (d?.documentElement?.dataset?.ready) break;
        await spike.sleep(5);
      }
      times.push({ domReady: docAt && +docAt.toFixed(0), wallpaperReady: +(performance.now() - t0).toFixed(0), pageMs: +home.linkedBrowser.contentDocument.documentElement.dataset.ms });
      if (i < 5) {
        gBrowser.removeTab(home);
        await spike.sleep(300);
      }
    }
    spike.log("H1 Ctrl+T -> Home, 6 opens (ms):", times);
    spike.log("H1 urlbar value", JSON.stringify(gURLBar.value), "urlbar focused", gURLBar.focused, "label", home.label);

    // ---- H6: theme sampling of the in-process Home tab ----
    {
      const hb = home.linkedBrowser;
      const r = hb.getBoundingClientRect();
      const wgp = hb.browsingContext.currentWindowGlobal;
      const lumaTop = (bmp, rows) => {
        const c = new OffscreenCanvas(bmp.width, rows);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, rows).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return +(s / (d.length / 4) / 255).toFixed(3);
      };
      const res = {};
      for (const [label, rect] of [["null rect", null], ["DOMRect(0,0,w,h)", new DOMRect(0, 0, r.width, r.height)], ["DOMRect strip (0,0,w,64)", new DOMRect(0, 0, r.width, 64)]]) {
        const ts = [];
        let bmp;
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          bmp = await wgp.drawSnapshot(rect, 1 / 16, "white");
          ts.push(+(performance.now() - t0).toFixed(1));
        }
        res[label] = { size: bmp.width + "x" + bmp.height, lumaTop4rows: lumaTop(bmp, Math.min(4, bmp.height)), ms: ts };
      }
      spike.log("H6 sampling the Home tab (5K wallpaper) at 1/16:", res, "| page's own wallpaper luma", hb.contentDocument.documentElement.dataset.luma);
    }

    // ---- H3: web content cannot navigate to / embed Home ----
    {
      const t = vx.addTab("https://example.com/");
      await vx.waitLoaded(t.linkedBrowser);
      gBrowser.selectedTab = t;
      const res = await new Promise((resolve) => {
        t.linkedBrowser.messageManager.addMessageListener("vx:h3", (m) => resolve(m.data));
        setTimeout(() => resolve("TIMEOUT"), 6000);
        vx.inContent(t.linkedBrowser, `
          (async () => {
            const w = content.wrappedJSObject;
            const out = {};
            const tryIt = (label, js) => { try { out[label] = String(w.eval(js)); } catch (e) { out[label] = "THROWS " + String(e).slice(0, 70); } };
            tryIt("location.href=about:vitre-home", "location.href='about:vitre-home'; 'no throw'");
            tryIt("window.open(about:)", "var x = window.open('about:vitre-home'); x ? 'opened' : 'null'");
            tryIt("iframe about:", "var f=document.createElement('iframe'); f.id='fa'; f.src='about:vitre-home'; document.body.append(f); 'appended'");
            tryIt("iframe chrome:", "var g=document.createElement('iframe'); g.id='fc'; g.src='chrome://vitre-home/content/home.html'; document.body.append(g); 'appended'");
            tryIt("img chrome:", "var i=new Image(); i.src='chrome://vitre-home/content/home.css'; 'set'");
            await new Promise((r) => content.setTimeout(r, 1500));
            const fa = content.document.getElementById('fa'), fc = content.document.getElementById('fc');
            out.iframeAboutDoc = (() => { try { return fa.contentDocument ? fa.contentDocument.documentURI : "no contentDocument"; } catch (e) { return "inaccessible"; } })();
            out.iframeChromeDoc = (() => { try { return fc.contentDocument ? fc.contentDocument.documentURI : "no contentDocument"; } catch (e) { return "inaccessible"; } })();
            out.topStill = content.location.href;
            sendAsyncMessage("vx:h3", out);
          })();
        `);
      });
      await spike.sleep(300);
      spike.log("H3 from https://example.com:", res, "| tab URI after", t.linkedBrowser.currentURI.spec, "remoteType", t.linkedBrowser.remoteType, "| tabs", gBrowser.tabs.length);
      gBrowser.removeTab(t);
      gBrowser.selectedTab = home;
    }

    // ---- H4: the real native file dialog, end to end ----
    const dir = PathUtils.join(PathUtils.profileDir, "vitre-test-media");
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const imgPath = PathUtils.join(dir, "picked background é #1.png");
    {
      const c = new OffscreenCanvas(1600, 900);
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 1600, 900);
      grad.addColorStop(0, "#06304a");
      grad.addColorStop(1, "#3fb68b");
      g.fillStyle = grad;
      g.fillRect(0, 0, 1600, 900);
      g.fillStyle = "#fff";
      g.font = "600 64px Segoe UI";
      g.fillText("picked in the REAL native file dialog", 80, 800);
      const blob = await c.convertToBlob({ type: "image/png" });
      await IOUtils.write(imgPath, new Uint8Array(await blob.arrayBuffer()));
    }
    {
      const TITLE = "Vitre verify choose background 91c4";
      const pick = () => new Promise((resolve) => {
        const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        fp.init(window.browsingContext, TITLE, Ci.nsIFilePicker.modeOpen);
        fp.appendFilters(Ci.nsIFilePicker.filterAll | Ci.nsIFilePicker.filterImages | Ci.nsIFilePicker.filterVideo);
        fp.open((result) => {
          if (result !== Ci.nsIFilePicker.returnOK || !fp.file) return resolve({ result, path: null });
          const path = fp.file.path;
          const kind = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(path) ? "video" : "image";
          VitreSettings.set({ homeBackground: { kind, path } });
          resolve({ result, kind, path });
        });
      });
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const user32 = ctypes.open("user32.dll");
      const HWND = ctypes.voidptr_t;
      const FindWindowW = user32.declare("FindWindowW", ctypes.winapi_abi, HWND, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
      const FindWindowExW = user32.declare("FindWindowExW", ctypes.winapi_abi, HWND, HWND, HWND, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
      const SendText = user32.declare("SendMessageTimeoutW", ctypes.winapi_abi, ctypes.uintptr_t, HWND, ctypes.uint32_t, ctypes.uintptr_t, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.uintptr_t.ptr);
      const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, HWND, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
      const GetWindowThreadProcessId = user32.declare("GetWindowThreadProcessId", ctypes.winapi_abi, ctypes.uint32_t, HWND, ctypes.uint32_t.ptr);
      const since = Date.now();
      const p = pick();
      let hwnd = null;
      for (let i = 0; i < 80; i++) {
        await spike.sleep(100);
        hwnd = FindWindowW(null, TITLE);
        if (!hwnd.isNull()) break;
      }
      let how = "dialog not found";
      if (hwnd && !hwnd.isNull()) {
        await spike.sleep(700); // let the shell finish building the dialog
        const pid = ctypes.uint32_t(0);
        GetWindowThreadProcessId(hwnd, pid.address());
        const combo = FindWindowExW(hwnd, null, "ComboBoxEx32", null);
        const inner = combo.isNull() ? combo : FindWindowExW(combo, null, "ComboBox", null);
        const edit = inner.isNull() ? inner : FindWindowExW(inner, null, "Edit", null);
        how = "dialog pid " + pid.value + " (parent pid " + Services.appinfo.processID + "), filename edit found " + !edit.isNull();
        if (!edit.isNull()) {
          const out = ctypes.uintptr_t(0);
          SendText(edit, 0x000c /* WM_SETTEXT */, 0, imgPath, 0x0002 /* SMTO_ABORTIFHUNG */, 3000, out.address());
          await spike.sleep(300);
          PostMessageW(hwnd, 0x0111 /* WM_COMMAND */, 1 /* IDOK */, 0);
        } else {
          PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, 0, 0);
        }
      }
      const r = await Promise.race([p, spike.sleep(8000).then(() => "TIMEOUT")]);
      if (r === "TIMEOUT" && hwnd && !hwnd.isNull()) PostMessageW(hwnd, 0x0010, 0, 0);
      user32.close();
      await ready(home.linkedBrowser, since);
      spike.log("H4 real nsIFilePicker dialog:", how, "| callback ->", r === "TIMEOUT" ? r : { result: r.result, kind: r.kind, file: r.path && PathUtils.filename(r.path), samePath: r.path === imgPath });
      spike.log("H4 settings.homeBackground.kind", VitreSettings.get().homeBackground.kind, "| Home page shows", { ...home.linkedBrowser.contentDocument.documentElement.dataset });
      await spike.capture("v-home-picked-in-real-dialog");
    }

    // ---- H7: video background pauses in a background tab (with the visibilitychange handler) ----
    {
      const vidPath = PathUtils.join(dir, "bg.webm");
      const c = document.createElementNS(vx.HTML, "canvas");
      c.width = 320;
      c.height = 180;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start();
      const t0 = performance.now();
      await new Promise((r) => {
        const frame = () => {
          const t = (performance.now() - t0) / 1000;
          g.fillStyle = `hsl(${(t * 120) % 360} 60% 30%)`;
          g.fillRect(0, 0, 320, 180);
          if (t < 6) requestAnimationFrame(frame);
          else r();
        };
        frame();
      });
      rec.stop();
      await stopped;
      await IOUtils.write(vidPath, new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
      const since = Date.now();
      VitreSettings.set({ homeBackground: { kind: "video", path: vidPath } });
      await ready(home.linkedBrowser, since);
      const video = () => home.linkedBrowser.contentDocument.querySelector("video");
      await spike.sleep(500);
      const fg = [video().currentTime, video().paused];
      const other = vx.addTab(vx.page(1, "#246"));
      await vx.waitLoaded(other.linkedBrowser);
      gBrowser.selectedTab = other;
      await spike.sleep(600);
      const a = video().currentTime;
      await spike.sleep(1200);
      const b = video().currentTime;
      const hiddenPaused = video().paused;
      gBrowser.selectedTab = home;
      await spike.sleep(700);
      spike.log("H7 video: foreground [currentTime, paused]", fg, "| in a background tab", a.toFixed(3), "->", b.toFixed(3), "paused", hiddenPaused, "| back in front: paused", video().paused, "currentTime", video().currentTime.toFixed(3));
      gBrowser.removeTab(other);
      VitreSettings.set({ homeBackground: { kind: "windows", path: "" } });
      await spike.sleep(500);
    }

    // ---- H5: the chrome-layer variant: can the switcher get a thumbnail of it? ----
    {
      const found = await VitreWallpaper.find();
      const blank = vx.addTab("about:blank");
      gBrowser.selectedTab = blank;
      await spike.sleep(300);
      const r = gBrowser.selectedBrowser.getBoundingClientRect();
      const layer = vx.el("div", `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:10;` +
        `background:#101014 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#111;font:600 40px Segoe UI`);
      layer.id = "vx-home-layer";
      const img = new Image();
      img.src = VitreWallpaper.fileURL(found.path);
      await img.decode();
      layer.style.backgroundImage = `url("${img.src}")`;
      layer.textContent = "Home as a chrome-document layer";
      document.documentElement.append(layer);
      await spike.sleep(400);
      const ts = [];
      let bmp;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        bmp = await window.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(r.x, r.y, r.width, r.height), 0.5, "white");
        ts.push(+(performance.now() - t0).toFixed(1));
      }
      spike.log("H5 layer variant: drawSnapshot of the CHROME document rect under the layer ->", bmp.width + "x" + bmp.height, vx.stats(bmp, 32, 20), "ms", ts);
      layer.remove();
      const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:#14161c;padding:30px;color:#fff;font:13px Segoe UI");
      const c = vx.el("canvas", "display:block;outline:1px solid #4cc2ff;border-radius:8px");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      overlay.append(vx.el("div", "margin-bottom:8px", "thumbnail of the chrome-layer Home, taken with window.browsingContext.currentWindowGlobal.drawSnapshot(rect)"), c);
      document.documentElement.append(overlay);
      await spike.capture("v-home-layer-thumbnail");
      overlay.remove();
      gBrowser.removeTab(blank);
    }

    // ---- H2: a new window ----
    {
      Services.prefs.setIntPref("browser.startup.page", 1);
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
      const b2 = win2.gBrowser.selectedBrowser;
      const ok = await ready(b2);
      spike.log("H2 new window (browser.startup.page=1): HomePage.get()", HomePage.get(), "| first tab", b2.currentURI.spec, "ready", ok, "| urlbar value", JSON.stringify(win2.gURLBar.value), "| label", win2.gBrowser.selectedTab.label);
      // Ctrl+T in the second window
      win2.BrowserCommands.openTab();
      const ok2 = await ready(win2.gBrowser.selectedBrowser);
      spike.log("H2 new tab in window 2:", win2.gBrowser.selectedBrowser.currentURI.spec, "ready", ok2);
      win2.close();
      await spike.sleep(300);
    }
  });
})();
