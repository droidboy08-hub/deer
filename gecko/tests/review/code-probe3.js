// Code-review probe 3 (reviewer's own): cost of the paint-driven theme sampling on a real page.
//   python tests/review/code_run.py extra code-probe3.js
/* global spike, gBrowser, Services, ChromeUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const calls = [];
  const original = b.sample;
  b.sample = async function () {
    const t0 = performance.now();
    try {
      return await original.call(this);
    } finally {
      calls.push(performance.now() - t0);
    }
  };
  const report = async (name, seconds) => {
    calls.length = 0;
    await sleep(seconds * 1000);
    const n = calls.length;
    const sorted = [...calls].sort((a, c) => a - c);
    const mean = n ? calls.reduce((a, c) => a + c, 0) / n : 0;
    log("P4b " + name + ": " + n + " samples in " + seconds + " s (" + (n / seconds).toFixed(1) + "/s), mean " + mean.toFixed(1) + " ms, median " + (n ? sorted[n >> 1].toFixed(1) : 0) + " ms, max " + (n ? sorted[n - 1].toFixed(1) : 0) + " ms");
  };
  for (const url of ["https://en.wikipedia.org/wiki/Glass", "https://example.com/"]) {
    b.navigate(b.activeId, url);
    await spike.loaded();
    await sleep(2500);
    await report(url + " at rest", 4);
    // A 24 px spinner far below the bar, as any page with a loading indicator, a carousel or a video has.
    gBrowser.selectedBrowser.messageManager.loadFrameScript(
      "data:," +
        encodeURIComponent(
          "(function(){const d=content.document;const s=d.createElement('style');s.textContent='@keyframes vs{to{transform:rotate(360deg)}}';d.head.append(s);const e=d.createElement('div');e.style.cssText='position:fixed;top:600px;left:40px;width:24px;height:24px;border:3px solid #999;border-top-color:#000;border-radius:50%;animation:vs 1s linear infinite;z-index:99999';d.body.append(e);})()"
        ),
      false
    );
    await sleep(1000);
    await report(url + " with a 24 px spinner", 6);
  }
  b.sample = original;
  log("PROBES3 DONE");
});
