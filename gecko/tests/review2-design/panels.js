// Design review: the two floating panels (Settings, Downloads), the downloads quick view and ring, the
// video pill and picker and the download mark, in System, Light and Dark modes over a light page,
// plus over a busy page. Captures + DUMP lines with measured values.
/* global spike, Services, R, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b, dump, shot, sleep, log, cs, R4 } = R;
  await R.inner(1440, 900);
  await spike.activate();
  const engine = b.sys("VitreDownloads");
  await engine.ready;
  // a >5 s noise video for the pill
  const H = "http://www.w3.org/1999/xhtml";
  const canvas = document.createElementNS(H, "canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm", videoBitsPerSecond: 6000000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  const t0 = performance.now();
  await new Promise((done) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const img = ctx.createImageData(640, 360);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        img.data[i] = v >> 1;
        img.data[i + 1] = 60 + (v >> 2);
        img.data[i + 2] = 120;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = "#e9b949";
      ctx.fillRect(40 + t * 60, 140, 90, 90);
      if (t < 6.5) requestAnimationFrame(frame);
      else done();
    };
    frame();
  });
  rec.stop();
  await stopped;
  await IOUtils.write(PathUtils.join(spike.outDir, "clip.webm"), new Uint8Array(await new Blob(chunks).arrayBuffer()));
  const videoPage = `<!doctype html><meta charset=utf-8><title>Molten: a 4K study of glass in motion</title><body style="margin:0;background:#fbfaf7;color:#1b1b1f;font:16px 'Segoe UI'"><main style="max-width:900px;margin:0 auto;padding:30px"><h1>Molten: a 4K study</h1><video id="v" src="clip.webm" muted loop autoplay playsinline style="width:860px;height:484px;background:#000;border-radius:12px;display:block"></video><p>The ribbon moves through the lehr.</p><div style="height:1200px"></div></main>`;
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "video.html"), videoPage);

  const light = await R.go(R.site("fieldnotes", "/article"));
  const busy = await R.open(R.site("club", "/busy"));
  const vid = await R.open(R.outUrl("video.html"), 2500);
  b.activate(light);
  await sleep(800);

  // downloads in several states
  const done = engine.start(R.local("/dl/a.bin?mb=2&kbps=40000"), { filename: "field-notes-issue-14.pdf", named: true });
  await R.waitFor(() => engine.get(done)?.state === "completed", { timeout: 30000, what: "completed" }).catch(() => log("no complete"));
  const paused = engine.start(R.local("/dl/b.bin?mb=300&kbps=400"), { filename: "dataset-2026-q3.csv.gz", named: true });
  await sleep(2500);
  engine.pause(paused);
  const run1 = engine.start(R.local("/dl/c.bin?mb=600&kbps=600"), { filename: "float-line-tour-4k.mp4", named: true });
  const run2 = engine.start(R.local("/dl/d.bin?mb=600&kbps=300"), { filename: "photos-archive-2026.zip", named: true });
  await sleep(4000);
  dump("engine", engine.list().map((v) => [v.filename || v.name, v.state]));

  const panelDump = (tag) => {
    const p = document.querySelector(".vd-panel, .vs-panel");
    const tint = p && p.querySelector(":scope > .tint");
    dump(tag, { panel: R4(p), tint: tint && cs(tint).backgroundColor, color: p && cs(p).color, rootClass: b.root.className, dark: window.matchMedia("(prefers-color-scheme: dark)").matches });
  };
  for (const mode of ["system", "light", "dark"]) {
    await R.setSettings({ theme: mode }, 1500);
    // Settings over the light page
    b.activate(light);
    await sleep(900);
    for (const page of ["appearance", "tabs", "downloads", "video-downloads", "extensions", "shortcuts", "home"]) {
      b.service("settings").open(page);
      await sleep(900);
      panelDump(`set-${mode}-${page}`);
      await shot(`p-${mode}-settings-${page}`);
      if (mode !== "system") break;
    }
    b.service("settings").close?.();
    await sleep(600);
    // Downloads over the light page
    b.service("downloads").openPanel();
    await sleep(1100);
    panelDump(`dl-${mode}`);
    await shot(`p-${mode}-downloads`);
    spike.press("Escape");
    await sleep(700);
    // quick view from the ring
    const ring = document.querySelector(".vd-ring button") || document.querySelector(".vd-ring");
    if (ring) {
      const r = ring.getBoundingClientRect();
      R.click(r.left + r.width / 2, r.top + r.height / 2);
      await sleep(900);
      const pop = document.querySelector(".vd-pop");
      dump(`pop-${mode}`, { rect: R4(pop), tint: pop && cs(pop.querySelector(":scope > .tint")).backgroundColor });
      await shot(`p-${mode}-quickview`);
      spike.press("Escape");
      await sleep(600);
    }
  }
  await R.setSettings({ theme: "system" }, 1200);

  // over the busy page
  b.activate(busy);
  await sleep(1200);
  await R.settled();
  b.service("settings").open("appearance");
  await sleep(900);
  await shot("p-busy-settings");
  b.service("settings").close?.();
  await sleep(500);
  b.service("downloads").openPanel();
  await sleep(1100);
  await shot("p-busy-downloads");
  spike.press("Escape");
  await sleep(600);
  await shot("p-busy-ring");

  // video page: the mark, the hover pill, the picker
  b.activate(vid);
  await sleep(1500);
  await R.settled();
  const mark = b.bar.item(b.activeId)?.querySelector(".dl-mark");
  dump("mark", { rect: R4(mark), cls: mark && mark.className, bg: mark && cs(mark).backgroundColor, color: mark && cs(mark).color });
  await shot("p-video-mark");
  const vr = await R.rectOf("#v", vid.browser);
  if (vr) {
    await R.inContent(vid.browser, (content) => {
      const el = content.document.querySelector("#v");
      const r = el.getBoundingClientRect();
      content.windowUtils.sendMouseEvent("mousemove", r.left + r.width * 0.45, r.top + r.height * 0.5, 0, 0, 0);
      return true;
    });
    await sleep(1500);
    const pill = document.querySelector(".vd-pill");
    dump("video-pill", { rect: R4(pill), text: pill && pill.textContent, cls: pill && pill.className });
    await shot("p-video-pill");
  }
  b.service("downloads").videoPicker();
  await sleep(1300);
  const pk = document.querySelector(".vd-picker");
  dump("picker", { rect: R4(pk), text: pk && pk.textContent.slice(0, 300) });
  await shot("p-video-picker");
  spike.press("Escape");
  await sleep(500);
  await R.setSettings({ theme: "light" }, 1500);
  b.service("downloads").videoPicker();
  await sleep(1300);
  await shot("p-light-video-picker");
  spike.press("Escape");
  await sleep(500);
  await R.setSettings({ theme: "system" }, 800);
  for (const v of engine.list()) engine.cancel(v.id);
  log("errors", JSON.stringify(R.errors()));
  log("done");
});
