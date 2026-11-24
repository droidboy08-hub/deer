// Spike S7 (cost): the address suggestions as a real glass panel whose height changes on every
// keystroke (panel.sizeTo), against today's way (an in-window CSS box with backdrop-filter) and a
// glass panel kept at full height. Test-only (glasslib.js + behavelib.js).
//   cd gecko
//   rm -f tests/menus/out/log.txt
//   /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> --vids <scratch>/vids &
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s7-cost.js --name mac-glass-s7 --url about:blank \
//       --timeout 500 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// The field is a test <input> in Deer's window (focus and typing stay there, as in the plan); the list
// hangs under it, 560 px wide, 1 to 8 rows of 44 px. Typing is synthesized: 40 keys at 20 a second,
// then 60 keys, one per frame. Measured: the handler's own time (render + resize + a forced layout),
// the window's frame intervals (requestAnimationFrame), how long the window server takes to show each
// new height (behave_mon.py TRACK), and CPU (engine processes, WindowServer, GPU utilisation).
/* global spike, G, GB, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/behavelib.js", window);
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const ONLY = Services.env.get("GLASS_ONLY") || "";
  const want = (s) => !ONLY || ONLY.split(",").includes(s);
  await spike.resize(1200, 760);
  await spike.activate();
  const body = `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,#fff 0 28px,#eef3fb 28px 56px)"></div><div style="position:relative;margin:70px 40px;font:17px/28px Georgia;color:#222;max-width:1000px">${"Suggestions float over the page while you type in the address capsule. ".repeat(40)}</div>`;
  await G.load(G.page("Cost", "#ffffff", "#222", body));
  await G.caption("");

  // The field: a test input where Deer's address capsule is, in a layer of #vitre-root.
  const L = b.layer("gb-s7", 70);
  const input = document.createElement("input");
  input.id = "gb-s7-field";
  input.style.cssText = "position:absolute;left:300px;top:10px;width:420px;height:34px;pointer-events:auto;font:15px system-ui;padding:0 14px;border-radius:17px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.8);color:#111";
  L.append(input);
  const anchor = GB.placeholder("gb-s7-anchor", "left:300px;top:52px;width:560px;height:1px;");
  const ROW = 44;
  const heightFor = (n) => 12 + n * ROW;
  const rows = (n, q) =>
    Array.from({ length: n }, (_, i) => `<div class="row" style="height:${ROW}px;line-height:${ROW}px"><span><span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#0a84ff;vertical-align:-2px;margin-right:10px"></span>${q || "glass"} result ${i + 1} — example.com/${(q || "x").replace(/\W/g, "")}/${i}</span><span class="k">${i ? "" : "↩"}</span></div>`).join("");

  // CSS box (today's suggestions are a CSS layer with a backdrop blur of 30 px)
  const cssBox = document.createElement("div");
  cssBox.style.cssText = "position:absolute;left:300px;top:52px;width:560px;height:56px;border-radius:18px;overflow:hidden;backdrop-filter:blur(30px) saturate(1.9);background:rgba(255,255,255,.55);box-shadow:0 10px 30px rgba(0,0,0,.18);font:14px system-ui;color:#111;display:none;padding:6px;box-sizing:border-box";
  L.append(cssBox);

  let mode = "none";
  let panel = null;
  let costs = [];
  let marks = [];
  const nOf = (len) => 1 + ((len * 3) % 8);
  input.addEventListener("input", () => {
    const q = input.value;
    const n = nOf(q.length);
    const h = heightFor(n);
    const t0 = performance.now();
    if (mode === "css") {
      cssBox.innerHTML = rows(n, q);
      cssBox.style.height = h + "px";
      cssBox.getBoundingClientRect();
    } else if (mode === "glass-sizeTo") {
      panel._gb.div.innerHTML = rows(n, q);
      panel.sizeTo(560, h);
      panel.getBoundingClientRect();
    } else if (mode === "glass-fixed") {
      panel._gb.div.innerHTML = rows(n, q);
      panel.getBoundingClientRect();
    }
    costs.push(performance.now() - t0);
    marks.push([Date.now(), h]);
  });

  async function openPanel(h) {
    if (panel) G.close(panel);
    panel = await GB.anchored({ name: "suggest", anchor, position: "overlap", w: 560, h, scheme: "light", cls: "menu", html: rows(Math.round((h - 12) / ROW)), inStyle: "padding:6px" });
    await sleep(400);
  }

  /** Type `count` keys, one every `every` ms (0: one per frame). Returns frame stats, costs, and the server's delay per new height. */
  async function burst(label, count, every, opts = {}) {
    input.value = "";
    input.focus();
    await sleep(300);
    costs = [];
    marks = [];
    const ms = every ? count * every + 300 : count * 9 + 400;
    const cpuTag = GB.tag("s7-cpu-" + label);
    await GB.start("CPU", cpuTag, [(ms / 1000).toFixed(2)]);
    let trackTag = null;
    if (opts.track) {
      trackTag = GB.tag("s7-track-" + label);
      await GB.startTrack(trackTag, ((ms + 800) / 1000).toFixed(1));
    }
    const fsP = GB.frameStats(ms);
    const letters = "glassmorphismliquidglassregularpanel".split("");
    if (every) {
      for (let i = 0; i < count; i++) {
        EU.synthesizeKey(letters[i % letters.length], {}, window);
        await sleep(every);
      }
    } else {
      await new Promise((done) => {
        let i = 0;
        const step = () => {
          EU.synthesizeKey(letters[i % letters.length], {}, window);
          if (++i < count) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    }
    const frames = await fsP;
    const cpu = await GB.result(cpuTag, 30000);
    let server = null;
    if (trackTag) {
      const tr = await GB.result(trackTag, 30000);
      // Delay from each keystroke to the first window-server sample showing the new height.
      const delays = [];
      let prevH = null;
      const series = (tr.samples || []).map(([t, rows]) => [tr.t0 * 1000 + t, (rows.find((r) => r[4] === 560) || [])[5]]);
      for (const [at, h] of marks) {
        if (h === prevH) continue;
        prevH = h;
        const hit = series.find(([t, sh]) => t >= at && sh === h);
        delays.push(hit ? hit[0] - at : null);
      }
      const ok = delays.filter((d) => d !== null);
      server = { heights: delays.length, shown: ok.length, missed: delays.length - ok.length, delay: GB.stats(ok), samples: series.length };
    }
    const res = { label, keys: count, every, handler: GB.stats(costs), frames, cpu: { engine: cpu.engineCpu, windowServer: cpu.windowServerCpu, gpu: cpu.gpuUtilAvg, gpuMax: cpu.gpuUtilMax }, server };
    log("S7 " + JSON.stringify(res));
    return res;
  }

  const out = {};
  // idle reference: the glass list open, nothing typed
  await openPanel(heightFor(4));
  input.focus();
  const idleCpu = GB.tag("s7-cpu-idle");
  await GB.start("CPU", idleCpu, ["2"]);
  out.idle = { frames: await GB.frameStats(2000), cpu: await GB.result(idleCpu, 20000) };
  log("S7 idle " + JSON.stringify(out.idle));

  if (want("css")) {
    G.close(panel);
    panel = null;
    mode = "css";
    cssBox.style.display = "block";
    out.css20 = await burst("css-20cps", 40, 50);
    out.cssFrame = await burst("css-perframe", 60, 0);
    cssBox.style.display = "none";
  }
  if (want("sizeTo")) {
    mode = "glass-sizeTo";
    await openPanel(heightFor(1));
    // A 60 fps video of the first burst, cropped to the field and the list (inside Deer's window).
    let rec = null;
    if (Services.env.get("GLASS_NO_REC") !== "1") {
      await spike.captureScreen("glass-behave-s7-before"); // brings the window to the front
      input.focus();
      rec = await GB.ask("REC", GB.tag("s7-rec"), [Math.round(window.mozInnerScreenX + 280), Math.round(window.mozInnerScreenY), 620, 440, 5]);
      log("REC " + JSON.stringify(rec));
    }
    out.sizeTo20 = await burst("glass-sizeTo-20cps", 40, 50, { track: true });
    out.sizeToFrame = await burst("glass-sizeTo-perframe", 60, 0, { track: true });
    await spike.captureScreen("glass-behave-s7-sizeTo-end");
  }
  if (want("fixed")) {
    mode = "glass-fixed";
    await openPanel(heightFor(8));
    out.fixed20 = await burst("glass-fixed-20cps", 40, 50);
    out.fixedFrame = await burst("glass-fixed-perframe", 60, 0);
  }
  log("S7 SUMMARY " + JSON.stringify(out));
  G.closeAll();
});
