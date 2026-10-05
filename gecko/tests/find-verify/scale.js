// Find in page at 150 % scaling (layout.css.devPixelsPerPx 1.5, set at runtime) and at 150 % page
// zoom: the face on the pill, the landing ring on the match (top document and the cross-site frame),
// the scroll guard. Run by tests/find-verify/all.py (scale).
/* global spike, FL, V, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  const Settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1000);
  V.takeErrors();

  const near = (a, b2, tol = 1.5) => a && b2 && Math.abs(a.x - b2.x) <= tol && Math.abs(a.y - b2.y) <= tol && Math.abs(a.width - b2.w) <= tol && Math.abs(a.height - b2.h) <= tol;
  const ordOf = () => Number((FL.st()?.counter ?? "").split(" ")[0].replace(/,/g, "")) || 0;
  async function stepTo(n) {
    for (let i = 0; i < 30 && ordOf() !== n; i++) {
      spike.press("Enter");
      await sleep(260);
    }
    return ordOf() === n;
  }
  async function ringOn(label) {
    await FL.until(() => FL.F().ring.visible, "ring " + label, 2000);
    await sleep(120);
    FL.F().ring.freeze();
    return FL.F().ring.last;
  }
  async function frameBox() {
    const f = await FL.inPage("function (w, d) { const r = d.getElementById('xframe').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }");
    const bb = gBrowser.selectedBrowser.getBoundingClientRect();
    const z = gBrowser.selectedBrowser.fullZoom || 1;
    return { x: bb.x + f.x * z, y: bb.y + f.y * z, w: f.w * z, h: f.h * z };
  }
  const inside = (r, box, slack = 2) => r && box && r.x >= box.x - slack && r.y >= box.y - slack && r.x + r.width <= box.x + box.w + slack && r.y + r.height <= box.y + box.h + slack;

  async function battery(label) {
    b.focusPage();
    await sleep(200);
    spike.press("Ctrl+F");
    await FL.until(() => FL.st()?.open, "open " + label, 3000);
    // A fresh query from the top: an empty field drops the page's selection first.
    await FL.query("");
    await FL.settle(300);
    await FL.query("glass");
    await FL.counter("1 of 13", 5000);
    const faceR = FL.face().getBoundingClientRect();
    const pill = b.bar.layout.pillRect;
    check(`${label}: the face lies on the pill`, pill && Math.abs(faceR.x - pill.x) <= 1 && Math.abs(faceR.width - pill.width) <= 1 && Math.abs(faceR.y - 12) <= 1, { face: [faceR.x, faceR.y, faceR.width], pill: pill && [pill.x, pill.y, pill.width] });
    spike.press("Enter");
    await FL.counter("2 of 13");
    let ring = await ringOn(label + " 2");
    let text = await V.selectionRect();
    log(label, "match 2 ring", ring, "selection", text);
    check(`${label}: the ring lands exactly on the active match (top document)`, near(ring, text), { ring, text });
    await capture(`scale-${label}-ring`);
    check(`${label}: stepped to match 12 (in the cross-site frame)`, await stepTo(12));
    ring = await ringOn(label + " 12");
    const fb = await frameBox();
    check(`${label}: the ring for match 12 lies inside the cross-site frame`, inside(ring, fb), { ring, fb });
    await capture(`scale-${label}-frame-ring`);
    spike.press("Escape");
    await FL.until(() => !FL.st()?.open, "closed " + label, 3000);
    await sleep(500);
  }

  // ---- 150 % scaling ----
  Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.5");
  await sleep(1500);
  log("devicePixelRatio", window.devicePixelRatio, "inner", window.innerWidth, window.innerHeight);
  check("150 % scaling applied", Math.abs(window.devicePixelRatio - 1.5) < 0.01, window.devicePixelRatio);
  await FL.load(FL.http("article.html"));
  await sleep(1000);
  await battery("dpi150");

  // The guard at 150 % with the inset off (no scroll padding): the match lands at y 92.
  Settings.set({ pageInset: false });
  await sleep(300);
  await FL.load(FL.http("long.html"));
  await sleep(1000);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open guard", 3000);
  await FL.query("ribbon");
  await FL.counter("1 of 60");
  await FL.inPage("function (w, d) { const p = d.getElementById('p20'); w.scrollTo(0, p.getBoundingClientRect().top + w.scrollY - 22); return w.scrollY; }");
  await sleep(500);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 2, "ord 2", 3000);
  await ringOn("guard dpi150");
  let s = FL.st();
  check("150 %: the guard lifts a match under the glass to y 92", s?.rect && Math.abs(s.rect.y - 92) <= 2, s?.rect);
  await capture("scale-dpi150-guard");
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed guard", 3000);
  Settings.set({ pageInset: true });
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await sleep(1500);

  // ---- 150 % page zoom ----
  await FL.load(FL.http("article.html"));
  await sleep(800);
  gBrowser.selectedBrowser.fullZoom = 1.5;
  await sleep(1200);
  log("page zoom", gBrowser.selectedBrowser.fullZoom);
  await battery("zoom150");

  // The guard at 150 % page zoom with the inset off.
  Settings.set({ pageInset: false });
  await sleep(300);
  await FL.load(FL.http("long.html"));
  await sleep(1000);
  gBrowser.selectedBrowser.fullZoom = 1.5;
  await sleep(800);
  b.focusPage();
  spike.press("Ctrl+F");
  await FL.until(() => FL.st()?.open, "open guard z", 3000);
  await FL.query("ribbon");
  await FL.counter("1 of 60");
  await FL.inPage("function (w, d) { const p = d.getElementById('p20'); w.scrollTo(0, p.getBoundingClientRect().top + w.scrollY - 15); return w.scrollY; }");
  await sleep(500);
  spike.press("Enter");
  await FL.until(() => FL.st()?.ord === 2, "ord 2 z", 3000);
  await ringOn("guard zoom150");
  s = FL.st();
  const t2 = await V.selectionRect();
  check("150 % zoom: the guard lifts the match to y 92 (window px), the ring on it", s?.rect && Math.abs(s.rect.y - 92) <= 2 && Math.abs(FL.F().ring.last.y - t2.y) <= 1.5, { rect: s?.rect, text: t2 });
  await capture("scale-zoom150-guard");
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "closed guard z", 3000);
  Settings.set({ pageInset: true });
  gBrowser.selectedBrowser.fullZoom = 1;
  await sleep(300);

  const errs = V.takeErrors();
  log("console errors", errs);
  check("no console errors from find", errs.length === 0, errs);
});
