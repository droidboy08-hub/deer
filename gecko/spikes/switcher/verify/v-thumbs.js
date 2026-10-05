// VERIFY switcher/thumbnails: robustness checks the spike did not run.
// Run: python tools/run.py --boot spikes/switcher/verify/v-thumbs.js --name switcher-verify-vth --out spikes/switcher/verify/out/v-thumbs --timeout 150
// HiDPI: add --pref layout.css.devPixelsPerPx=1.5 --name switcher-verify-vhd --out spikes/switcher/verify/out/v-thumbs-hidpi
/* global gBrowser, Services, Ci, Cc, spike, vx, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(() => {
  if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) return; // second window: do nothing
  spike.main(async () => {
    // HiDPI variant: --pref vitre.verify.dpr=d1.5 (run.py turns bare numbers into number prefs, and
    // layout.css.devPixelsPerPx is a string pref, so it is set here instead).
    const want = Services.prefs.getStringPref("vitre.verify.dpr", "").replace(/^d/, "");
    if (want) {
      Services.prefs.setStringPref("layout.css.devPixelsPerPx", want);
      await spike.sleep(800);
    }
    await spike.resize(want ? 1280 / +want : 1280, want ? 800 / +want : 800);
    const dpr = window.devicePixelRatio;
    spike.log("dpr", dpr, "inner", window.innerWidth, window.innerHeight);
    const snap = (browser, scale, r = null) => {
      browser.getBoundingClientRect();
      return browser.browsingContext.currentWindowGlobal.drawSnapshot(r, scale, "white");
    };
    const mk = (title, body) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title>${body}`);

    // 1. a page with a cross-origin (out-of-process under Fission) iframe
    const framed = mk("OOP iframe", `<body style="margin:0;background:#fff;font:20px Segoe UI"><h1 style="margin:20px">top document (white)</h1>` +
      `<iframe src="https://example.com/" style="width:900px;height:400px;border:4px solid #c00;margin:0 20px"></iframe>`);
    // 2. a page that keeps changing while it is in the background
    const ticking = mk("Ticking", `<body style="margin:0;font:600 120px Segoe UI;color:#fff"><div id=n style="padding:80px">0</div>` +
      `<script>let i=0;const c=['#b3261e','#1d6f42','#1a4fa3','#c56a00','#7a3e9d','#0b7285'];setInterval(()=>{i++;n.textContent=i;document.body.style.background=c[i%c.length]},400);document.body.style.background=c[0]</script>`);
    // 3. a video-ish / canvas page
    const canvasPage = mk("Canvas", `<body style="margin:0;background:#111"><canvas id=c width=800 height=400 style="margin:40px"></canvas>` +
      `<script>const g=c.getContext('2d');let t=0;(function f(){t++;g.fillStyle='hsl('+(t*3%360)+' 70% 50%)';g.fillRect(0,0,800,400);g.fillStyle='#fff';g.font='80px Segoe UI';g.fillText('frame '+t,40,200);requestAnimationFrame(f)})()</script>`);

    const first = gBrowser.selectedTab;
    const tFramed = vx.addTab(framed), tTick = vx.addTab(ticking), tCanvas = vx.addTab(canvasPage), tWiki = vx.addTab("https://en.wikipedia.org/wiki/Gecko_(software)");
    const tSel = vx.addTab(vx.page(1, "#246"));
    for (const t of [tFramed, tTick, tCanvas, tWiki, tSel]) await vx.waitLoaded(t.linkedBrowser);
    gBrowser.selectedTab = tSel;
    gBrowser.removeTab(first);
    await spike.sleep(2500); // let the iframe load in its own process

    // --- 1. OOP iframe in a never-shown background tab ---
    const bcs = tFramed.linkedBrowser.browsingContext.children;
    spike.log("1 iframe: child browsing contexts", bcs.length, "iframe remoteType", bcs[0]?.currentWindowGlobal?.domProcess?.remoteType,
      "top remoteType", tFramed.linkedBrowser.remoteType, "iframe uri", bcs[0]?.currentWindowGlobal?.documentURI?.spec);
    const shots = [];
    {
      const t0 = performance.now();
      const bmp = await snap(tFramed.linkedBrowser, 0.5 * dpr);
      const ms = vx.ms(t0);
      // stats of the iframe region only (page px 24..924 x 80..480, scaled by 0.5)
      const c = new OffscreenCanvas(450, 200);
      c.getContext("2d").drawImage(bmp, 12 * dpr + 2 * dpr, 45 * dpr, 440 * dpr, 190 * dpr, 0, 0, 450, 200);
      spike.log("1 background tab with OOP iframe:", bmp.width + "x" + bmp.height, ms, "ms; whole", vx.stats(bmp, 64, 40), "iframe region", vx.stats(c, 64, 30),
        "(iframe painted if the region is not pure white: example.com is dark in dark mode or has text)");
      shots.push(["1 bg tab, OOP iframe", bmp]);
    }

    // --- 2. background tab that changes: is the snapshot current? ---
    {
      const a = await snap(tTick.linkedBrowser, 0.5 * dpr);
      const sa = vx.stats(a, 32, 20);
      await spike.sleep(2600);
      const b = await snap(tTick.linkedBrowser, 0.5 * dpr);
      const sb = vx.stats(b, 32, 20);
      spike.log("2 background ticking tab: snapshot A", sa, "2.6 s later B", sb, "-> current DOM each time:", sa.luma !== sb.luma);
      shots.push(["2 ticking bg tab (A)", a], ["2 ticking bg tab (B, 2.6 s later)", b]);
      const c1 = await snap(tCanvas.linkedBrowser, 0.5 * dpr);
      await spike.sleep(1500);
      const c2 = await snap(tCanvas.linkedBrowser, 0.5 * dpr);
      spike.log("2 background rAF canvas tab (rAF is paused in background tabs): A", vx.stats(c1, 32, 20), "B", vx.stats(c2, 32, 20));
      shots.push(["2 canvas bg tab", c2]);
    }

    // --- 3. snapshot while a navigation is in flight ---
    {
      const b = tSel.linkedBrowser;
      b.fixupAndLoadURIString("https://example.org/", { triggeringPrincipal: vx.SYS });
      const results = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        try {
          const bmp = await snap(b, 0.25);
          results.push("ok " + bmp.width + "x" + bmp.height + " luma " + vx.stats(bmp, 16, 10).luma + " " + vx.ms(t0) + "ms");
        } catch (e) {
          results.push("REJECTED " + String(e).slice(0, 80));
        }
        await spike.sleep(60);
      }
      await vx.waitLoaded(b);
      spike.log("3 snapshots taken during a cross-process navigation:", results);
    }

    // --- 4. a second window: its background and selected tabs, snapshotted from window 1 ---
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
      win2.resizeTo(900, 600);
      const g2 = win2.gBrowser;
      const a = g2.addTab(vx.page(21, "#7a3e9d"), { triggeringPrincipal: vx.SYS });
      const bTab = g2.addTab("https://example.com/", { triggeringPrincipal: vx.SYS });
      await vx.waitLoaded(a.linkedBrowser);
      await vx.waitLoaded(bTab.linkedBrowser);
      g2.selectedTab = a;
      await spike.sleep(500);
      window.focus();
      const t0 = performance.now();
      const s1 = await snap(a.linkedBrowser, 0.5 * dpr);
      const s2 = await snap(bTab.linkedBrowser, 0.5 * dpr);
      spike.log("4 second window (900x600): selected tab", s1.width + "x" + s1.height, vx.stats(s1, 32, 20), "| background tab", s2.width + "x" + s2.height, vx.stats(s2, 32, 20), vx.ms(t0), "ms for both");
      shots.push(["4 window 2 selected", s1], ["4 window 2 background", s2]);
      win2.minimize();
      await spike.sleep(700);
      const s3 = await Promise.race([snap(bTab.linkedBrowser, 0.5 * dpr), spike.sleep(4000).then(() => null)]);
      spike.log("4 second window minimized (state", win2.windowState, "): background tab", s3 ? s3.width + "x" + s3.height + " " + JSON.stringify(vx.stats(s3, 32, 20)) : "TIMED OUT");
      win2.close();
      await spike.sleep(400);
    }

    // --- 5. resolution used for the deck (0.75 * dpr) on a real page, for a visual quality check ---
    {
      const t0 = performance.now();
      const bmp = await snap(tWiki.linkedBrowser, 0.75 * dpr);
      spike.log("5 wikipedia background tab @0.75*dpr:", bmp.width + "x" + bmp.height, vx.ms(t0), "ms");
      shots.unshift(["5 wikipedia bg tab @0.75*dpr " + bmp.width + "x" + bmp.height, bmp]);
    }

    // overlay: everything captured above
    const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:#14161c;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:18px;" +
      "align-content:start;box-sizing:border-box;font:12px Segoe UI,sans-serif;color:#fff");
    for (const [label, bmp] of shots) {
      const cell = vx.el("div", "min-width:0");
      const c = vx.el("canvas", "display:block;width:100%;height:auto;border-radius:8px;outline:1px solid #4cc2ff");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      cell.append(c, vx.el("div", "", label));
      overlay.append(cell);
    }
    document.documentElement.append(overlay);
    await spike.capture("v-thumbs-overlay");
    // the wikipedia card alone, large (deck-card size), to judge sharpness
    overlay.replaceChildren(overlay.firstChild);
    overlay.style.gridTemplateColumns = "1fr";
    overlay.style.padding = "40px 160px";
    await spike.capture("v-thumbs-wiki-card");
  });
})();
