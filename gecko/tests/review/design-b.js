// Design-fidelity review, probe B: what the theme sampler reads on text-heavy light pages.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const settled = async () => { await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "settle" }); await sleep(150); };
  const inner = async (w, h) => {
    window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
    window.moveTo(30, 30);
    await sleep(500);
  };
  const go = async (url, t = b.active()) => {
    b.navigate(t, url);
    await waitFor(() => t.url.startsWith(url.slice(0, 24)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(1500);
    await settled();
  };
  async function luma(scale) {
    const browser = b.active().browser;
    const wg = browser.browsingContext.currentWindowGlobal;
    const bitmap = await wg.drawSnapshot(null, scale, "white");
    const l = b.bar.layout;
    const k = scale;
    const x0 = Math.max(0, Math.floor((l.left - 16) * k));
    const x1 = Math.min(bitmap.width, Math.ceil((l.right + 16) * k));
    const rows = Math.min(bitmap.height, Math.max(1, Math.ceil(64 * k)));
    const canvas = new OffscreenCanvas(x1 - x0, rows);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, -x0, 0);
    const { data } = ctx.getImageData(0, 0, x1 - x0, rows);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    bitmap.close();
    return +(sum / (data.length / 4) / 255).toFixed(3);
  }
  const page = (title, body) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title>${body}`);
  const lines = (font, n = 60) => `<body style='margin:0;background:#fff;color:#111;font:${font}'>` + Array.from({ length: n }, () => "<div style='white-space:nowrap'>" + "The quick brown fox jumps over the lazy dog 0123456789 ".repeat(6) + "</div>").join("");

  await inner(1440, 900);
  await spike.activate();
  const cases = [
    ["text 13/16 Segoe UI on white", site("refract", "/text")],
    ["text 16/24 Georgia on white", page("t16", lines("16px/24px Georgia,serif"))],
    ["text 14/20 Segoe UI on white", page("t14", lines("14px/20px Segoe UI"))],
    ["text 11/13 Verdana on white (Hacker News-like)", page("t11", lines("11px/13px Verdana").replace("#fff", "#f6f6ef"))],
    ["monospace 13/18 code on white", page("code", lines("13px/18px Consolas,monospace"))],
    ["article", site("fieldnotes", "/article")],
    ["wikipedia", "https://en.wikipedia.org/wiki/Float_glass"],
    ["example.com", "https://example.com/"],
  ];
  for (const [name, url] of cases) {
    try {
      await go(url);
    } catch (e) {
      log("SKIP " + name + " " + e);
      continue;
    }
    const sixteenth = await luma(1 / 16);
    const full = await luma(1);
    const quarter = await luma(1 / 4);
    log("LUMA " + JSON.stringify({ name, theme: b.theme(), sampler_1_16: sixteenth, true_full: full, at_1_4: quarter }));
    await spike.capture("b-" + name.replace(/[^a-z0-9]+/gi, "-").slice(0, 24));
  }
});
