// S10 probe 2 (logic only): does -moz-element() paint in Deer's chrome, also for an element whose
// ancestor is at opacity 0, and does it carry a focused field's caret and selection? Read back with
// CanvasRenderingContext2D.drawWindow (the main window only; popups are their own widgets).
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s10-probe2.js --name mac-glass-s10-probe2 --url about:blank \
//       --timeout 120 --out tests/menus/out --no-capture --pref ui.caretBlinkTime=0
/* global spike, Services */
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  await spike.resize(1280, 800);
  await spike.activate();
  await sleep(800);
  const H = "http://www.w3.org/1999/xhtml";
  const layer = b.layer("s10-probe2", 70);
  const mk = (css, parent = layer) => {
    const d = document.createElementNS(H, "div");
    d.style.cssText = css;
    parent.append(d);
    return d;
  };
  // A target: a red block with a blue square inside, and a hidden twin under an opacity:0 ancestor.
  const t1 = mk("position:absolute;left:20px;top:300px;width:60px;height:30px;background:rgb(255,0,0);pointer-events:none");
  t1.id = "s10-t1";
  mk("position:absolute;left:10px;top:10px;width:10px;height:10px;background:rgb(0,0,255)", t1);
  const veil = mk("position:absolute;left:20px;top:360px;width:60px;height:30px;opacity:0;pointer-events:none");
  const t2 = mk("position:absolute;left:0;top:0;width:60px;height:30px;background:rgb(0,160,0)", veil);
  t2.id = "s10-t2";
  // A focused field with text, caret at the end.
  const f = document.createElementNS(H, "input");
  f.id = "s10-f";
  f.value = "glass caret";
  f.style.cssText = "position:absolute;left:20px;top:420px;width:200px;height:30px;font:16px system-ui;color:rgb(0,0,0);caret-color:rgb(255,0,255);background:rgb(255,255,255);border:none;padding:0 4px;pointer-events:auto";
  layer.append(f);
  // Mirrors, 400 px to the right.
  const m1 = mk("position:absolute;left:420px;top:300px;width:60px;height:30px;background:-moz-element(#s10-t1) no-repeat;pointer-events:none");
  const m2 = mk("position:absolute;left:420px;top:360px;width:60px;height:30px;background:-moz-element(#s10-t2) no-repeat;pointer-events:none");
  const m3 = mk("position:absolute;left:420px;top:420px;width:200px;height:30px;background:-moz-element(#s10-f) no-repeat;pointer-events:none");
  f.focus();
  f.setSelectionRange(11, 11);
  await sleep(600);
  const px = (x, y) => {
    const c = document.createElementNS(H, "canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    ctx.drawWindow(window, x, y, 1, 1, "rgb(128,128,128)", ctx.DRAWWINDOW_DRAW_CARET | ctx.DRAWWINDOW_DRAW_VIEW);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const row = (x0, y, w) => {
    const c = document.createElementNS(H, "canvas");
    c.width = w;
    c.height = 1;
    const ctx = c.getContext("2d");
    ctx.drawWindow(window, x0, y, w, 1, "rgb(128,128,128)", ctx.DRAWWINDOW_DRAW_CARET | ctx.DRAWWINDOW_DRAW_VIEW);
    const d = ctx.getImageData(0, 0, w, 1).data;
    const out = [];
    for (let i = 0; i < w; i++) out.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    return out;
  };
  log("target red " + JSON.stringify(px(25, 305)) + " blue " + JSON.stringify(px(35, 325 - 10)));
  log("mirror of red " + JSON.stringify(px(425, 305)) + " blue " + JSON.stringify(px(435, 315)));
  log("hidden green (should be page) " + JSON.stringify(px(25, 365)) + " mirror of hidden green " + JSON.stringify(px(425, 365)));
  check("-moz-element paints in chrome", JSON.stringify(px(425, 305)) === "[255,0,0]", px(425, 305));
  check("-moz-element paints an element whose ancestor is at opacity 0", JSON.stringify(px(425, 365)) === "[0,160,0]", px(425, 365));
  // Caret: magenta pixels on the field's middle row, original and mirror.
  const magenta = (r) => r.map((c, i) => (c[0] > 200 && c[1] < 80 && c[2] > 200 ? i : -1)).filter((i) => i >= 0);
  const orig = row(20, 435, 200);
  const mir = row(420, 435, 200);
  log("caret columns: field " + JSON.stringify(magenta(orig)) + ", mirror " + JSON.stringify(magenta(mir)));
  const dark = (r) => r.filter((c) => c[0] < 90 && c[1] < 90 && c[2] < 90).length;
  log("text pixels on the middle row: field " + dark(orig) + ", mirror " + dark(mir));
  f.setSelectionRange(0, 5);
  await sleep(300);
  const sel = (r) => r.filter((c) => !(c[0] > 240 && c[1] > 240 && c[2] > 240) && !(c[0] < 90 && c[1] < 90 && c[2] < 90)).length;
  log("selection: non-white non-text pixels, field " + sel(row(20, 435, 200)) + ", mirror " + sel(row(420, 435, 200)));
  log("sample field row " + JSON.stringify(row(20, 435, 60).slice(0, 60).map((c) => c.join(","))));
  log("sample mirror row " + JSON.stringify(row(420, 435, 60).slice(0, 60).map((c) => c.join(","))));
  m1.remove();
  m2.remove();
  m3.remove();
});
