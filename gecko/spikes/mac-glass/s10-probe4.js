// S10 probe 4 (logic): can a glass window's -moz-window-opacity / -moz-window-transform be set per frame
// from script? Inline style (style.setProperty) against a chrome stylesheet rule that reads custom
// properties (var()) set inline. Read back from the window server (behave_mon.py WINLIST: alpha and bounds).
//   (behave_mon.py running) /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s10-probe4.js --name mac-glass-s10-probe4 \
//       --url about:blank --timeout 120 --out tests/menus/out --no-capture
/* global spike, G, GB, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
spike.main(async () => {
  const { sleep, log } = spike;
  const b = window.vitre;
  await spike.resize(1280, 800);
  await sleep(600);
  b.css("s10-probe4", `
panel.p4-var { -moz-window-opacity: var(--p4-o, 1); -moz-window-transform: var(--p4-t, none); }
panel.p4-cls { -moz-window-opacity: 0.5; }
`);
  const mk = async (x, cls) => {
    const p = await G.panel({ x, y: 200, w: 120, h: 36, scheme: "light", name: cls });
    p.classList.add(cls);
    return p;
  };
  const a = await mk(100, "p4-inline");
  a.style.setProperty("-moz-window-opacity", "0.5");
  log("inline set: getPropertyValue = " + JSON.stringify(a.style.getPropertyValue("-moz-window-opacity")) + " cssText=" + JSON.stringify(a.style.cssText));
  const v = await mk(300, "p4-var");
  v.style.setProperty("--p4-o", "0.5");
  const c = await mk(500, "p4-cls");
  const t = await mk(700, "p4-var");
  t.style.setProperty("--p4-t", "translate(30px, 9px) scale(0.5)");
  await sleep(800);
  const list = await GB.ask("WINLIST", GB.tag("w"));
  const rel = GB.rel(list);
  log("windows " + JSON.stringify(rel.others?.filter((w) => w.who === "mine").map((w) => [w.rel, w.alpha, w.layer])));
  // Change the var per frame for 30 frames and read again.
  for (let i = 0; i < 30; i++) {
    v.style.setProperty("--p4-o", String(0.2 + i / 60));
    await new Promise((r) => requestAnimationFrame(r));
  }
  await sleep(300);
  const list2 = await GB.ask("WINLIST", GB.tag("w"));
  log("after per-frame var changes " + JSON.stringify(GB.rel(list2).others?.filter((w) => w.who === "mine").map((w) => [w.rel, w.alpha])));
  G.closeAll();
});
