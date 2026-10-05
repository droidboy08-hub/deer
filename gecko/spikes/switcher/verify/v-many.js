// VERIFY switcher/thumbnails at scale + the discard race.
//  M1 40 tabs (20 Wikipedia articles sharing one site process + 20 generated pages): how long does
//     "snapshot every tab when the switcher opens" take, and when does the FIRST card arrive?
//  M2 can a tab be captured at the moment it is discarded (drawSnapshot started, then discardBrowser)?
//  M3 memory of the bitmap cache.
// Run: python tools/run.py --boot spikes/switcher/verify/v-many.js --name switcher-verify-vmany --out spikes/switcher/verify/out/v-many --timeout 240
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  await spike.resize(1920, 1080);
  const dpr = window.devicePixelRatio;
  const articles = ["Firefox", "Gecko_(software)", "Web_browser", "Mozilla", "Rust_(programming_language)", "JavaScript", "HTML", "CSS", "WebGL", "HTTP",
    "Servo_(software)", "SpiderMonkey", "XUL", "Netscape", "Chromium_(web_browser)", "WebKit", "Blink_(browser_engine)", "World_Wide_Web", "Internet", "Tab_(interface)"];
  const urls = [...articles.map((a) => "https://en.wikipedia.org/wiki/" + a)];
  for (let i = 1; i <= 20; i++) urls.push(vx.page(i, vx.COLOURS[(i - 1) % 12]));
  const first = gBrowser.selectedTab;
  const tabs = urls.map((u) => vx.addTab(u));
  let timeouts = 0;
  for (const t of tabs) if (!(await vx.waitLoaded(t.linkedBrowser, 30000))) timeouts++;
  gBrowser.removeTab(first);
  await spike.sleep(1500);
  const procs = new Set(gBrowser.tabs.map((t) => t.linkedBrowser.browsingContext?.currentWindowGlobal?.osPid));
  spike.log("M1 tabs", gBrowser.tabs.length, "load timeouts", timeouts, "distinct content processes", procs.size, "browser", gBrowser.selectedBrowser.getBoundingClientRect().width + "x" + gBrowser.selectedBrowser.getBoundingClientRect().height);

  const snap = (b, scale) => {
    b.getBoundingClientRect();
    return b.browsingContext.currentWindowGlobal.drawSnapshot(null, scale, "white");
  };
  for (const scale of [0.5 * dpr, 0.75 * dpr]) {
    for (let round = 0; round < 3; round++) {
      const t0 = performance.now();
      const done = [];
      const bitmaps = await Promise.all(gBrowser.tabs.map((t) => snap(t.linkedBrowser, scale).then((bmp) => { done.push(performance.now() - t0); return bmp; }, () => null)));
      const total = performance.now() - t0;
      done.sort((a, b) => a - b);
      const bytes = bitmaps.filter(Boolean).reduce((s, b) => s + b.width * b.height * 4, 0);
      spike.log("M1 Promise.all over", bitmaps.length, "tabs @" + scale, "->", bitmaps[0].width + "x" + bitmaps[0].height, "| first card", done[0].toFixed(0), "ms, median", done[done.length >> 1].toFixed(0), "ms, all", total.toFixed(0), "ms | ok",
        bitmaps.filter(Boolean).length, "| M3 bitmap memory", (bytes / 1048576).toFixed(0), "MB");
      // is the chrome main thread free meanwhile? longest gap between animation frames during the next round
      for (const b of bitmaps) b?.close();
      await spike.sleep(300);
    }
  }
  {
    // main-thread responsiveness while 40 snapshots are in flight
    let last = performance.now(), worst = 0, frames = 0, running = true;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await spike.sleep(200);
    worst = 0;
    const t0 = performance.now();
    const bitmaps = await Promise.all(gBrowser.tabs.map((t) => snap(t.linkedBrowser, 0.75 * dpr).catch(() => null)));
    const total = performance.now() - t0;
    running = false;
    spike.log("M1 chrome main thread while 40 snapshots @0.75 were in flight (" + total.toFixed(0) + " ms): longest frame gap", worst.toFixed(0), "ms");
    for (const b of bitmaps) b?.close();
  }

  // ---- M2: discard race ----
  {
    const t = gBrowser.tabs[25];
    const p = snap(t.linkedBrowser, 0.5 * dpr);
    const discarded = gBrowser.discardBrowser(t, true);
    const r = await Promise.race([p.then((bmp) => "RESOLVED " + bmp.width + "x" + bmp.height + " luma " + vx.stats(bmp, 16, 10).luma, (e) => "REJECTED " + String(e).slice(0, 90)), spike.sleep(3000).then(() => "NEVER SETTLED (3 s)")]);
    spike.log("M2 drawSnapshot started, then discardBrowser() in the same tick (discarded:", discarded, "):", r);
    const t2 = gBrowser.tabs[26];
    const t0 = performance.now();
    const bmp = await snap(t2.linkedBrowser, 0.5 * dpr);
    const ok = gBrowser.discardBrowser(t2, true);
    spike.log("M2 await snapshot, THEN discard (Vitre's own 'unload tab' command): snapshot", bmp.width + "x" + bmp.height, "in", vx.ms(t0), "ms, discarded", ok, "pending", t2.hasAttribute("pending"));
    // which event tells Vitre a tab was discarded by someone else (memory pressure, an extension)?
    const seen = [];
    gBrowser.tabContainer.addEventListener("TabBrowserDiscarded", (e) => seen.push("TabBrowserDiscarded:" + e.target.label));
    gBrowser.discardBrowser(gBrowser.tabs[27], true);
    await spike.sleep(200);
    spike.log("M2 event on discard:", seen);
  }
});
