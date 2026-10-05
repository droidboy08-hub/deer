// Robustness review: display scaling changed at run time (layout.css.devPixelsPerPx 1.5 and 1.25):
// bar geometry, the theme sampler's alignment, the address field, tooltips, auto-hide and F11.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-scale.js --name review-robust-scale --timeout 240
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s, d = document) => d.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const settled = async () => { await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "bar settle" }); await sleep(150); };
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;
  const geometry = () => {
    const items = $$("#vitre-bar .item:not(.leaving)").map((i) => ({ cls: i.className.replace("item ", ""), ...R.rect(i) })).sort((a, c) => a.x - c.x);
    const ctl = R.rect($("#vitre-winctl"));
    let touching = 0;
    for (let i = 1; i < items.length; i++) if (items[i].x < items[i - 1].x + items[i - 1].w - 0.5) touching++;
    const pill = items.find((i) => i.cls.includes("active"));
    const centre = (items[0].x + items[items.length - 1].x + items[items.length - 1].w) / 2;
    return { items, ctl, touching, pill, centre, inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio };
  };
  // The top strip of this page is dark on the left 40 % and white to the right. The bar's sample
  // strip covers the centred bar group only (about 30 % dark): it must read "light" however the
  // snapshot is scaled; columns taken 1.5x too far left would read dark.
  const split = R.page("Split top", `<div style='position:fixed;left:0;top:0;width:40%;height:120px;background:#101014'></div><div style='position:fixed;left:40%;top:0;right:0;height:120px;background:#fff'></div><p style='margin:200px 40px'>split</p>`, "#fff");
  const sampleTheme = async () => {
    // force a fresh sample: a scroll message re-samples
    await R.inPage("function(w, d){ d.body.style.height = '3000px'; w.scrollTo(0, 1); w.scrollTo(0, 0); return 1; }");
    await sleep(700);
    return b.active().theme;
  };

  await R.load(split);
  await spike.resize(1500, 800);
  await settled();
  const g100 = geometry();
  log("100 %:", { pill: g100.pill, ctl: g100.ctl, centre: g100.centre, inner: g100.inner });
  check("100 %: the dark-left / white-right page reads light under the bar", (await sampleTheme()) === "light", b.active().theme);

  for (const scale of ["1.5", "1.25"]) {
    log(`--- ${scale} x`);
    Services.prefs.setStringPref("layout.css.devPixelsPerPx", scale);
    await waitFor(() => near(window.devicePixelRatio, Number(scale), 0.01), { timeout: 6000, what: scale + " scaling" });
    await sleep(800);
    await settled();
    const g = geometry();
    log(`${scale} x:`, { pill: g.pill, ctl: g.ctl, centre: g.centre, inner: g.inner, items: g.items.length, touching: g.touching, state: b.bar.state });
    check(`${scale} x: bar sizes in CSS px unchanged (pill 44 high at top 12, capsule 108x32 at right 12), group centred, nothing overlapping`, g.pill.h === 44 && g.pill.y === 12 && g.ctl.w === 108 && g.ctl.h === 32 && near(g.inner[0] - (g.ctl.x + g.ctl.w), 12, 1.5) && near(g.centre, g.inner[0] / 2, 2) && g.touching === 0, { pill: g.pill, ctl: g.ctl, centre: g.centre, inner: g.inner });
    const theme = await sampleTheme();
    check(`${scale} x: the theme sampler still reads the strip under the bar (light)`, theme === "light", theme);
    // The address field.
    b.editAddress();
    await sleep(500);
    const field = R.rect($("#vitre-omni-field"));
    log(`${scale} x: field`, field);
    check(`${scale} x: the address field is 640x48 at top 12, centred, clear of the window controls`, field.w === 640 && field.h === 48 && field.y === 12 && near(field.x + field.w / 2, g.inner[0] / 2, 2) && field.x + field.w <= g.ctl.x - 8, field);
    spike.type("example");
    await sleep(600);
    const panel = R.rect($("#vitre-omni-panel"));
    check(`${scale} x: the suggestion panel sits under the field`, panel.y === 68 && panel.x === field.x && panel.w === field.w, panel);
    await spike.capture(`scale-${scale.replace(".", "_")}-field`);
    b.omni.close();
    await sleep(300);
    // A tooltip.
    const plus = $("#vitre-bar .plus .face");
    spike.EU.synthesizeMouseAtCenter(plus, { type: "mousemove" }, window);
    await sleep(900);
    const tip = $(".vitre-tip");
    const tr = tip && !tip.hidden ? R.rect(tip) : null;
    const pr = R.rect($("#vitre-bar .plus"));
    check(`${scale} x: the tooltip hangs 8 px under the + circle, centred on it`, !!tr && near(tr.y, pr.y + pr.h + 8, 1) && near(tr.x + tr.w / 2, pr.x + pr.w / 2, 2), { tr, pr });
    spike.EU.synthesizeMouseAtPoint(600, 400, { type: "mousemove" }, window);
    await sleep(200);
    // Auto-hide reveal at the top edge.
    b.sys("VitreSettings").set({ barAutoHide: true });
    await waitFor(() => b.bar.hidden, { timeout: 5000, what: "auto-hide" }).catch(() => {});
    await sleep(500);
    spike.EU.synthesizeMouseAtPoint(600, 20, { type: "mousemove" }, window);
    await waitFor(() => !b.bar.hidden, { timeout: 3000, what: "reveal" }).catch(() => {});
    check(`${scale} x: auto-hide reveals at the top edge`, !b.bar.hidden);
    spike.EU.synthesizeMouseAtPoint(600, 400, { type: "mousemove" }, window);
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "hide again" }).catch(() => {});
    check(`${scale} x: ...and hides again`, b.bar.hidden);
    b.sys("VitreSettings").set({ barAutoHide: false });
    await sleep(400);
    // F11.
    b.run("fullscreen");
    await waitFor(() => window.fullScreen && b.bar.hidden, { timeout: 6000, what: "F11" }).catch(() => {});
    await sleep(1200);
    spike.EU.synthesizeMouseAtPoint(600, 2, { type: "mousemove" }, window);
    await waitFor(() => !b.bar.hidden, { timeout: 3000, what: "reveal in F11" }).catch(() => {});
    await sleep(500);
    const gf = geometry();
    check(`${scale} x: F11 reveal brings the bar and capsule back in place`, !b.bar.hidden && gf.pill.y === 12 && gf.ctl.y === 18, { pill: gf.pill, ctl: gf.ctl });
    await spike.capture(`scale-${scale.replace(".", "_")}-f11`);
    b.run("fullscreen");
    await waitFor(() => !window.fullScreen, { timeout: 6000 }).catch(() => {});
    await sleep(800);
    spike.EU.synthesizeMouseAtPoint(600, 400, { type: "mousemove" }, window);
    Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
    await waitFor(() => window.devicePixelRatio === 1, { timeout: 6000, what: "100 %" });
    await spike.resize(1500, 800);
    await settled();
  }
  const back = geometry();
  check("back at 100 %: geometry as before", near(back.pill.x, g100.pill.x, 1) && back.pill.w === g100.pill.w && near(back.ctl.x, g100.ctl.x, 1), { back: back.pill, before: g100.pill });
  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("scale");
});
