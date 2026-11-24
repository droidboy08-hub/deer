// Spike S9 (count): 0, 1, 4 and 8 real glass panels open while the page scrolls and plays a video.
// CPU of the engine's processes and of WindowServer (cumulative CPU time, behave_mon.py CPU), the
// GPU's utilisation (ioreg), and frame timing in Deer's window and in the page (requestAnimationFrame).
// Test-only (glasslib.js + behavelib.js).
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s9-count.js --name mac-glass-s9 --url about:blank \
//       --timeout 600 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Each step runs SECS seconds (env GLASS_SECS, default 6) and the whole series runs twice (A, B) in
// opposite orders, because other apps on this Mac use the GPU and WindowServer too.
// Captures: glass-behave-s9-*.png.
/* global spike, G, GB, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const SECS = Number(Services.env.get("GLASS_SECS") || 6);
  await spike.resize(1400, 860);
  await spike.activate();

  // A long page: coloured blocks and text, a looping video made in the page (MediaRecorder of a
  // canvas animation, played back from a blob: real decoding), scrolled by the page itself, 6 px a frame.
  const blocks = Array.from({ length: 60 }, (_, i) => `<div style="height:220px;margin:16px 40px;border-radius:16px;background:hsl(${(i * 37) % 360} 70% ${i % 2 ? 55 : 75}%);font:700 28px/220px system-ui;padding-left:30px;color:#111">block ${i + 1} · ${"glass ".repeat(12)}</div>`).join("");
  const script = `
<script>
window.__frames = []; window.__scroll = false;
const v = document.getElementById('vid');
(async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
  const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  rec.start(); const t0 = performance.now();
  await new Promise(done => { const f = () => { const t = (performance.now() - t0) / 1000;
    x.fillStyle = 'hsl(' + (t * 90) + ' 60% 30%)'; x.fillRect(0, 0, 640, 360);
    x.fillStyle = '#ffd60a'; x.fillRect(40 + (t * 200) % 520, 120, 80, 80);
    x.fillStyle = '#fff'; x.font = '40px system-ui'; x.fillText('video ' + t.toFixed(2), 30, 60);
    if (t < 2.5) requestAnimationFrame(f); else done(); }; f(); });
  rec.stop(); await stopped;
  v.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  v.loop = true; v.muted = true; await v.play().catch(e => document.title = 'play failed ' + e);
  window.__videoReady = true;
})();
let last = 0;
const tick = (t) => { if (window.__scroll) { window.__frames.push(t);
  const max = document.documentElement.scrollHeight - innerHeight;
  window.scrollTo(0, (scrollY + 6) % max); } requestAnimationFrame(tick); };
requestAnimationFrame(tick);
</` + `script>`;
  const body = `<video id=vid style="position:fixed;right:40px;top:120px;width:480px;height:270px;border-radius:12px;background:#000;z-index:5" playsinline></video>${blocks}${script}`;
  await G.load(G.page("Count", "#ffffff", "#111", body), 1200);
  await G.caption("");
  b.focusPage();
  const br = b.active().browser;
  const ready = await spike.waitFor(() => G.inContent(br, (content) => !!content.wrappedJSObject.__videoReady), { timeout: 20000, what: "video" }).then(() => true, () => false);
  check("S9 the page's video plays", ready);

  // Eight glass pieces, 300 x 200, tiled over the page (two rows of four).
  const spots = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) spots.push({ x: 40 + c * 330, y: 110 + r * 330 });
  let open = [];
  async function setCount(n) {
    while (open.length > n) G.close(open.pop());
    while (open.length < n) {
      const i = open.length;
      open.push(await G.panel({ x: spots[i].x, y: spots[i].y, w: 300, h: 200, scheme: i % 2 ? "dark" : "light", cls: "menu", html: `<div class="hd">REAL glass ${i + 1} of 8</div><div class="row"><span>Back</span><span class="k">⌘[</span></div><div class="row hi"><span>Reload</span><span class="k">⌘R</span></div><div class="row"><span>Find on page…</span><span class="k">⌘F</span></div>` }));
    }
    await sleep(800);
  }
  const contentFrames = async (start) =>
    G.inContent(br, (content, s) => {
      const w = content.wrappedJSObject;
      if (s) {
        w.__frames = new w.Array();
        w.__scroll = true;
        return true;
      }
      w.__scroll = false;
      const f = Array.from(w.__frames);
      const d = f.slice(1).map((t, i) => t - f[i]);
      return d;
    }, start);

  async function measure(label, n, scroll) {
    await setCount(n);
    if (scroll) await contentFrames(true);
    await sleep(500);
    const cpuTag = GB.tag("s9-cpu-" + label);
    await GB.start("CPU", cpuTag, [SECS]);
    const chrome = await GB.frameStats(SECS * 1000);
    const cpu = await GB.result(cpuTag, SECS * 1000 + 30000);
    const page = scroll ? GB.stats(await contentFrames(false)) : null;
    const procs = (cpu.procs || []).map((p) => `${p.name}:${p.cpu}`).join(" ");
    const res = { label, panels: n, scroll, engineCpu: cpu.engineCpu, windowServerCpu: cpu.windowServerCpu, gpuUtilAvg: cpu.gpuUtilAvg, gpuUtilMax: cpu.gpuUtilMax, chromeFrames: chrome, pageFrames: page, procs };
    log("S9 " + JSON.stringify(res));
    return res;
  }

  const runs = [];
  const series = [
    ["0-static", 0, false],
    ["0-scroll", 0, true],
    ["1-scroll", 1, true],
    ["4-scroll", 4, true],
    ["8-scroll", 8, true],
    ["8-static", 8, false],
  ];
  for (const [label, n, scroll] of series) runs.push(await measure("A-" + label, n, scroll));
  // a picture of the eight while the page scrolls
  await setCount(8);
  await contentFrames(true);
  await sleep(600);
  await spike.captureScreen("glass-behave-s9-eight-scrolling");
  await contentFrames(false);
  for (const [label, n, scroll] of [...series].reverse()) runs.push(await measure("B-" + label, n, scroll));
  await setCount(0);
  log("S9 SUMMARY " + JSON.stringify(runs));
  G.closeAll();
});
