// Spike 1: ranged multi-connection download, run from a system module (engine/TestRanged.sys.mjs).
// The window only draws a progress overlay so the captures show the segments filling.
/* global spike, ChromeUtils, document */
spike.main(async () => {
  await spike.resize(1100, 700);
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/TestRanged.sys.mjs");
  const { fileFills } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreRanged.sys.mjs");

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:40px;top:120px;width:700px;padding:18px 20px;border-radius:14px;background:#1c1c1ecc;color:#fff;font:14px 'Segoe UI';z-index:99999";
  document.documentElement.appendChild(box);
  let current = null;
  let shots = 0;
  const draw = () => {
    if (!current) return;
    const s = current.state;
    const fills = fileFills(s, 32);
    const got = s.segments.reduce((n, x) => n + x.received, 0);
    box.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = `${s.url}  |  ${current.live} connections  |  ${(got / 1048576).toFixed(0)} / ${(s.total / 1048576).toFixed(0)} MB  |  ${s.segments.length} segments`;
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:2px;margin-top:10px;height:14px";
    for (const f of fills) {
      const cell = document.createElement("div");
      cell.style.cssText = `flex:1;border-radius:3px;background:linear-gradient(to right,#0a84ff ${f * 100}%,#ffffff30 ${f * 100}%)`;
      bar.appendChild(cell);
    }
    box.append(title, bar);
  };
  const timer = setInterval(draw, 100);
  const onTransfer = (t) => {
    current = t;
    const n = ++shots;
    // One capture a third of the way through each of the first transfers.
    if (n === 2 || n === 4) setTimeout(() => spike.capture(n === 2 ? "ranged-8conn" : "ranged-16conn"), n === 2 ? 2500 : 1200);
  };
  await run(onTransfer);
  clearInterval(timer);
  draw();
  await spike.capture("ranged-done");
});
