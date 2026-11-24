// Spike S6 (motion): real glass pieces opened and closed with -moz-window-transform (scale 0.96 -> 1)
// and -moz-window-opacity (0 -> 1), the window-level properties toolkit popup.css animates arrow
// panels with on macOS. Test-only (glasslib.js builds the panels at runtime).
//   cd gecko
//   /usr/bin/python3 spikes/mac-glass/recorder.py tests/menus/out/log.txt <video folder> &   (real-speed video)
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s6-motion.js --name mac-glass-s6 --url about:blank \
//       --timeout 300 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Part 1, real speed (240 ms), recorded at 60 fps by recorder.py (MOTION-REC / motion-go-<tag>):
//   V1 scale+opacity on a 300 px panel, V1 on a 36 px capsule, V2 scale only, V3 opacity only.
// Then glass-look-motion-shadow: an animated panel at rest beside one opened without animation (is
// its shadow there? toolkit popup.css avoids the fade on Big Sur+ for missing shadows, bug 1672091).
// Filmstrips are cut from the recording with ffmpeg (NOTES-S1-S2-S6-S11.md says how).
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
    "mac-glass-motion",
    `
panel.gs-anim { transition-property: -moz-window-transform, -moz-window-opacity; transition-duration: var(--gs-d, 240ms); transition-timing-function: cubic-bezier(.2,.9,.3,1), linear; }
panel.gs-anim.v1, panel.gs-anim.v2 { -moz-window-transform: scale(0.96); }
panel.gs-anim.v1, panel.gs-anim.v3 { -moz-window-opacity: 0; }
panel.gs-anim.gs-shown { -moz-window-transform: none; -moz-window-opacity: 1; }
`
  );

  // A white page with a band of colour stripes behind the top of the pieces (so the glass has
  // something to show) and plain white below them (so their shadow can be seen).
  const band = Array.from({ length: 24 }, (_, i) => `<div style="flex:1;background:${["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#1d1d1f", "#af52de"][i % 6]}"></div>`).join("");
  const url = G.page("Motion", "#ffffff", "#1d1d1f", `<div style="position:absolute;left:0;right:0;top:150px;height:200px;display:flex">${band}</div><div style="position:absolute;left:0;right:0;top:150px;height:200px;font:700 40px/200px system-ui;color:#fff;padding-left:40px;text-shadow:0 0 2px #000">the quick brown fox jumps over the lazy dog</div>`);
  await G.load(url);
  await G.caption("");

  const D = (p) => getComputedStyle(p).transitionDuration;
  const wcs = (p) => ({ t: getComputedStyle(p).getPropertyValue("-moz-window-transform"), o: getComputedStyle(p).getPropertyValue("-moz-window-opacity") });

  async function openAnim(spec, variant, d) {
    const p = await G.panel({ ...spec, pcls: "gs-anim " + variant, style: `--gs-d:${d}ms`, wait: false });
    await new Promise((r) => (p.state === "open" ? r() : p.addEventListener("popupshown", r, { once: true })));
    const t0 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    p.classList.add("gs-shown");
    log(`OPEN ${spec.name} ${variant} d=${d} shown->class ${Math.round(performance.now() - t0)} ms; transition ${D(p)}; computed ${JSON.stringify(wcs(p))}`);
    return p;
  }
  async function closeAnim(p, d) {
    const ended = new Promise((r) => {
      const t = setTimeout(() => r("timeout"), d + 400);
      p.addEventListener("transitionend", (e) => { clearTimeout(t); r("transitionend " + e.propertyName); }, { once: true });
    });
    const t0 = performance.now();
    p.classList.remove("gs-shown");
    const how = await ended;
    G.close(p);
    log(`CLOSE ${p._gs.name} after ${Math.round(performance.now() - t0)} ms (${how})`);
  }

  const A = { x: 140, y: 200, w: 300, h: 300, scheme: "dark", cls: "menu", html: `<div class="hd">REAL glass · animated</div><div class="row"><span>Back</span><span class="k">⌘[</span></div><div class="row hi"><span>Reload</span><span class="k">⌘R</span></div><div class="row"><span>Find on page…</span><span class="k">⌘F</span></div>`, name: "A" };
  const B = { x: 520, y: 200, w: 180, h: 36, scheme: "dark", cls: "h36", html: `<span class="dot"></span><span>capsule · animated</span>`, name: "B" };
  const C = { x: 900, y: 200, w: 300, h: 300, scheme: "dark", cls: "menu", html: `<div class="hd">REAL glass · opened with no animation</div><div class="row"><span>Back</span><span class="k">⌘[</span></div><div class="row hi"><span>Reload</span><span class="k">⌘R</span></div><div class="row"><span>Find on page…</span><span class="k">⌘F</span></div>`, name: "C" };

  const ref = await G.panel(C);
  await sleep(600);

  // ---- part 1: real speed, recorded ----
  const go = async (tag, secs) => {
    const ox = window.mozInnerScreenX, oy = window.mozInnerScreenY;
    const flag = PathUtils.join(spike.outDir, "motion-go-" + tag);
    await IOUtils.remove(flag, { ignoreAbsent: true });
    await spike.captureScreen("glass-look-motion-before-" + tag + "-" + sys); // brings the window to the front
    log(`MOTION-REC ${tag}-${sys} ${Math.round(ox + 100)} ${Math.round(oy + 150)} 1200 420 ${secs}`);
    const flag2 = PathUtils.join(spike.outDir, "motion-go-" + tag + "-" + sys);
    for (let i = 0; i < 200 && !(await IOUtils.exists(flag2)); i++) await sleep(50);
    const ok = await IOUtils.exists(flag2);
    log("recording " + tag + ": " + (ok ? "started" : "NOT started (no recorder.py?)"));
    return ok;
  };
  if (Services.env.get("GLASS_NO_REC") !== "1") {
    await go("rec", 12);
    const t0 = performance.now();
    const mark = (what) => log(`T+${Math.round(performance.now() - t0)} ${what}`);
    for (const [spec, v] of [[A, "v1"], [B, "v1"], [A, "v2"], [A, "v3"]]) {
      mark(`open ${spec.name} ${v}`);
      const p = await openAnim(spec, v, 240);
      await sleep(900);
      mark(`close ${spec.name} ${v}`);
      await closeAnim(p, 240);
      await sleep(700);
    }
    mark("end");
    await sleep(1500);
  }

  // (Part 2, stills of a 3 s transition, was dropped: each spike.captureScreen took about 8 s here, so
  // only the first still fell inside the transition. s6b-motion.js records the slow transition instead.)
  const shots = [];
  const still = async (name) => {
    shots.push(name);
    await spike.captureScreen(name + "-" + sys);
  };
  let p;

  // ---- shadow after an animated open (toolkit popup.css: "missing shadows on Big Sur+", bug 1672091) ----
  p = await openAnim(A, "v1", 240);
  await sleep(1200);
  G.layout("glass-look-motion-shadow-" + sys);
  await still("glass-look-motion-shadow");
  await closeAnim(p, 240);
  G.close(ref);
  check("motion captures: " + shots.length, shots.length > 0, shots);
});
