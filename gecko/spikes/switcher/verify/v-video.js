// VERIFY switcher/thumbnails: does drawSnapshot include <video> frames (selected and background tab)?
// Run: python tools/run.py --boot spikes/switcher/verify/v-video.js --name switcher-verify-vvid --out spikes/switcher/verify/out/v-video --timeout 120
/* global gBrowser, Services, Ci, Cc, spike, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1280, 800);
  // record a 2 s WebM in the chrome window
  const c = document.createElementNS(vx.HTML, "canvas");
  c.width = 640;
  c.height = 360;
  const g = c.getContext("2d");
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  const t0 = performance.now();
  await new Promise((r) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      g.fillStyle = `hsl(${(t * 160) % 360} 80% 55%)`;
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = "#fff";
      g.font = "600 60px Segoe UI";
      g.fillText("video " + t.toFixed(2) + "s", 40, 200);
      if (t < 2) requestAnimationFrame(frame);
      else r();
    };
    frame();
  });
  rec.stop();
  await stopped;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const page = "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>Video page</title><body style="margin:0;background:#111">` +
    `<video id=v muted loop autoplay playsinline style="display:block;margin:40px;width:800px;height:450px;background:#000" src="data:video/webm;base64,${btoa(bin)}"></video>`);
  spike.log("recorded", bytes.length, "bytes");

  const first = gBrowser.selectedTab;
  const tv = vx.addTab(page);
  const other = vx.addTab(vx.page(1, "#246"));
  await vx.waitLoaded(tv.linkedBrowser);
  await vx.waitLoaded(other.linkedBrowser);
  gBrowser.removeTab(first);
  const region = async (label) => {
    tv.linkedBrowser.getBoundingClientRect();
    const bmp = await tv.linkedBrowser.browsingContext.currentWindowGlobal.drawSnapshot(null, 0.5, "white");
    const r = new OffscreenCanvas(400, 225);
    r.getContext("2d").drawImage(bmp, 20, 20, 400, 225, 0, 0, 400, 225);
    const s = vx.stats(r, 40, 22);
    spike.log(label, "-> video region", s, s.luma > 0.2 ? "(video frame painted)" : "(BLACK: no video frame)");
    return bmp;
  };
  const state = () => new Promise((resolve) => {
    const mm = tv.linkedBrowser.messageManager;
    const l = (m) => { mm.removeMessageListener("vx:v", l); resolve(m.data); };
    mm.addMessageListener("vx:v", l);
    vx.inContent(tv.linkedBrowser, "const v=content.document.getElementById('v');sendAsyncMessage('vx:v',{t:+v.currentTime.toFixed(2),paused:v.paused,ready:v.readyState,w:v.videoWidth})");
    setTimeout(() => resolve("TIMEOUT"), 2000);
  });
  const shots = [];
  // never shown yet (opened in the background)
  gBrowser.selectedTab = other;
  await spike.sleep(800);
  spike.log("never-shown background tab: video", await state());
  shots.push(["background, never shown", await region("background tab that was never shown")]);
  gBrowser.selectedTab = tv;
  await spike.sleep(1200);
  spike.log("selected: video", await state());
  shots.push(["selected, playing", await region("selected tab, video playing")]);
  gBrowser.selectedTab = other;
  await spike.sleep(1500);
  spike.log("background again: video", await state());
  shots.push(["background after playing", await region("background tab after it played")]);

  const overlay = vx.el("div", "position:fixed;inset:0;z-index:2147483647;background:#14161c;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:18px;align-content:start;box-sizing:border-box;font:12px Segoe UI;color:#fff");
  for (const [label, bmp] of shots) {
    const cell = vx.el("div", "min-width:0");
    const cv = vx.el("canvas", "display:block;width:100%;height:auto;border-radius:8px;outline:1px solid #4cc2ff");
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    cell.append(cv, vx.el("div", "", label));
    overlay.append(cell);
  }
  document.documentElement.append(overlay);
  await spike.capture("v-video-thumbs");
});
