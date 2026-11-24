// Spike S6, second run: where -moz-window-transform scales from, and a slow (3 s) open and close.
// s6-motion.js showed scale(0.96) pivots on the window's top-left corner. Here:
//   V4  scale(0.96) with -moz-window-transform-origin: 50% 50%
//   V5  translate(6px, 6px) scale(0.96) (centred by hand for a 300 px panel)
//   V1  scale + opacity again, slowed to 3 s, recorded (what the glass does during a fade)
// Run beside recorder.py, as s6-motion.js says.
/* global spike, G, Services, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const forced = Services.prefs.getIntPref("ui.systemUsesDarkTheme", -1);
  const sys = forced === 1 ? "sysdark" : forced === 0 ? "syslight" : "sys";
  await spike.resize(1400, 880);
  await spike.activate();
  G.ensureCss();
  b.css(
    "mac-glass-motion2",
    `
panel.gs-anim { transition-property: -moz-window-transform, -moz-window-opacity; transition-duration: var(--gs-d, 240ms); transition-timing-function: cubic-bezier(.2,.9,.3,1), linear; }
panel.gs-anim.v1 { -moz-window-transform: scale(0.96); -moz-window-opacity: 0; }
panel.gs-anim.v4 { -moz-window-transform: scale(0.96); -moz-window-transform-origin: 50% 50%; }
panel.gs-anim.v5 { -moz-window-transform: translate(6px, 6px) scale(0.96); }
panel.gs-anim.gs-shown { -moz-window-transform: none; -moz-window-opacity: 1; }
`
  );
  const band = Array.from({ length: 24 }, (_, i) => `<div style="flex:1;background:${["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#1d1d1f", "#af52de"][i % 6]}"></div>`).join("");
  const url = G.page("Motion", "#ffffff", "#1d1d1f", `<div style="position:absolute;left:0;right:0;top:150px;height:200px;display:flex">${band}</div><div style="position:absolute;left:0;right:0;top:150px;height:200px;font:700 40px/200px system-ui;color:#fff;padding-left:40px;text-shadow:0 0 2px #000">the quick brown fox jumps over the lazy dog</div>`);
  await G.load(url);
  await G.caption("");

  async function openAnim(spec, variant, d) {
    const p = await G.panel({ ...spec, pcls: "gs-anim " + variant, style: `--gs-d:${d}ms`, wait: false });
    await new Promise((r) => (p.state === "open" ? r() : p.addEventListener("popupshown", r, { once: true })));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    p.classList.add("gs-shown");
    log(`OPEN ${spec.name} ${variant} d=${d}`);
    return p;
  }
  async function closeAnim(p, d) {
    const ended = new Promise((r) => {
      const t = setTimeout(() => r("timeout"), d + 400);
      p.addEventListener("transitionend", (e) => { clearTimeout(t); r("transitionend " + e.propertyName); }, { once: true });
    });
    p.classList.remove("gs-shown");
    const how = await ended;
    G.close(p);
    log(`CLOSE ${p._gs.name} (${how})`);
  }
  const A = { x: 140, y: 200, w: 300, h: 300, scheme: "dark", cls: "menu", html: `<div class="hd">REAL glass · animated</div><div class="row"><span>Back</span><span class="k">⌘[</span></div><div class="row hi"><span>Reload</span><span class="k">⌘R</span></div><div class="row"><span>Find on page…</span><span class="k">⌘F</span></div>`, name: "A" };

  const go = async (tag, secs) => {
    await spike.captureScreen("glass-look-motion-before-" + tag + "-" + sys);
    log(`MOTION-REC ${tag}-${sys} ${Math.round(window.mozInnerScreenX + 100)} ${Math.round(window.mozInnerScreenY + 150)} 1200 420 ${secs}`);
    const flag = PathUtils.join(spike.outDir, "motion-go-" + tag + "-" + sys);
    for (let i = 0; i < 200 && !(await IOUtils.exists(flag)); i++) await sleep(50);
    log("recording " + tag + ": " + ((await IOUtils.exists(flag)) ? "started" : "NOT started"));
  };
  await go("rec2", 14);
  const t0 = performance.now();
  const mark = (what) => log(`T+${Math.round(performance.now() - t0)} ${what}`);
  for (const v of ["v4", "v5"]) {
    mark("open " + v);
    const p = await openAnim(A, v, 240);
    await sleep(900);
    mark("close " + v);
    await closeAnim(p, 240);
    await sleep(700);
  }
  mark("open v1 slow");
  const p = await openAnim(A, "v1", 3000);
  await sleep(3600);
  mark("close v1 slow");
  await closeAnim(p, 3000);
  mark("end");
  await sleep(1500);
  check("done", true);
});
