// Script of Vitre's Home page (about:vitre-home -> chrome://vitre-home/content/home.html).
// Runs in the parent process with the system principal, so it can import Vitre's modules,
// read prefs, and load file:// images and videos directly.
/* global ChromeUtils, Services */
const { VitreSettings } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreSettings.sys.mjs");
const { VitreWallpaper } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreWallpaper.sys.mjs");

const bg = document.getElementById("bg");
const info = document.getElementById("info");
const root = document.documentElement;

async function showBackground(settings) {
  const t0 = performance.now();
  const { kind, path } = settings.homeBackground;
  let file = null;
  let source = kind;
  if (kind === "windows") {
    const found = await VitreWallpaper.find();
    file = found?.path ?? null;
    source = found ? "windows (" + found.source + ")" : "windows (none found)";
  } else if (kind === "image" || kind === "video") {
    file = path || null;
  }
  bg.replaceChildren();
  let luma = null;
  if (file && kind === "video") {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.src = VitreWallpaper.fileURL(file);
    bg.append(v);
    await new Promise((r) => {
      v.addEventListener("playing", r, { once: true });
      v.addEventListener("error", r, { once: true });
      setTimeout(r, 4000);
    });
    // luma of the current frame
    const c = new OffscreenCanvas(64, 36);
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    luma = s / (d.length / 4) / 255;
    root.dataset.video = v.error ? "error " + v.error.message : "playing " + v.videoWidth + "x" + v.videoHeight;
  } else if (file) {
    const img = document.createElement("img");
    img.src = VitreWallpaper.fileURL(file);
    bg.append(img);
    await img.decode().catch((e) => (root.dataset.imgError = String(e)));
    root.dataset.img = img.naturalWidth + "x" + img.naturalHeight;
    luma = await VitreWallpaper.meanLuma(window, file).catch((e) => ((root.dataset.lumaError = String(e)), null));
  }
  // Same rule as the Electron build: light glass on bright wallpapers, clear glass otherwise.
  const theme = luma !== null && luma > 0.62 ? "light" : "clear";
  root.dataset.theme = theme;
  root.dataset.luma = luma === null ? "" : luma.toFixed(3);
  root.dataset.kind = kind;
  root.dataset.ms = (performance.now() - t0).toFixed(0);
  info.textContent = `background: ${source} · mean luma ${root.dataset.luma || "n/a"} · theme-${theme} · ${root.dataset.ms} ms`;
  root.dataset.ready = String(Date.now());
}

function tick() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
tick();
setInterval(tick, 10000);

showBackground(VitreSettings.get());
const off = VitreSettings.onChange((s, changed) => {
  if (changed.some((k) => k.startsWith("homeBackground."))) showBackground(s);
});
window.addEventListener("unload", off);
