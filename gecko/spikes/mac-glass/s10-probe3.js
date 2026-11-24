// S10 probe 3 (logic only): what -moz-element() paints for an element with its own transform and
// opacity (a tab capsule entering or leaving the row is scale(0.6) and fading).
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s10-probe3.js --name mac-glass-s10-probe3 --url about:blank \
//       --timeout 120 --out tests/menus/out --no-capture
/* global spike, Services */
spike.main(async () => {
  const { sleep, log } = spike;
  const b = window.vitre;
  await spike.resize(1280, 800);
  await sleep(800);
  const H = "http://www.w3.org/1999/xhtml";
  const layer = b.layer("s10-probe3", 70);
  const mk = (css, parent = layer) => {
    const d = document.createElementNS(H, "div");
    d.style.cssText = css;
    parent.append(d);
    return d;
  };
  // 100x40 target, left half red, right half blue; scale(0.5) and opacity 0.5 on it.
  const t = mk("position:absolute;left:20px;top:300px;width:100px;height:40px;transform:scale(0.5);opacity:0.5;pointer-events:none");
  t.id = "s10-t";
  mk("position:absolute;left:0;top:0;width:50px;height:40px;background:rgb(255,0,0)", t);
  mk("position:absolute;left:50px;top:0;width:50px;height:40px;background:rgb(0,0,255)", t);
  const m = mk("position:absolute;left:420px;top:300px;width:100px;height:40px;background:-moz-element(#s10-t) no-repeat;pointer-events:none");
  await sleep(400);
  const row = (x0, y, w) => {
    const c = document.createElementNS(H, "canvas");
    c.width = w;
    c.height = 1;
    const ctx = c.getContext("2d");
    ctx.drawWindow(window, x0, y, w, 1, "rgb(255,255,255)", ctx.DRAWWINDOW_DRAW_VIEW);
    const d = ctx.getImageData(0, 0, w, 1).data;
    const out = [];
    for (let i = 0; i < w; i++) out.push(d[i * 4] + "," + d[i * 4 + 1] + "," + d[i * 4 + 2]);
    return out;
  };
  // Runs of equal colour along the middle row.
  const runs = (r) => {
    const out = [];
    let start = 0;
    for (let i = 1; i <= r.length; i++) {
      if (i === r.length || r[i] !== r[start]) {
        out.push(`${start}-${i - 1}:${r[start]}`);
        start = i;
      }
    }
    return out;
  };
  log("original (100 px from x 20): " + JSON.stringify(runs(row(20, 320, 100))));
  log("mirror   (100 px from x 420): " + JSON.stringify(runs(row(420, 320, 100))));
  log("original top row y 305: " + JSON.stringify(runs(row(20, 305, 100))) + " mirror " + JSON.stringify(runs(row(420, 305, 100))));
  m.remove();
  t.remove();
});
