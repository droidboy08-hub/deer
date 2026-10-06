// New Home tabs show their picture without a grey frame first (owner's bug report, 2026-10-05).
//   python tools/run.py --test tests/input/home-flash.js --name input-home-flash --timeout 300
// A 3840x2160 photo-like JPEG (slow to decode) is the Home background. Then new tabs are opened one
// after another, and each Home page's own timings are read: data-cached (memory | true | false),
// data-blank-frames (frames drawn before the picture was on screen) and data-t-* (ms since the tab
// started loading Home). Captures: home-flash-1-first, home-flash-2-later.
/* global spike, Services, IOUtils, PathUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const settings = b.sys("VitreSettings");
  const home = b.sys("VitreHome");
  const out = Services.env.get("VITRE_OUT");
  await spike.resize(1440, 900);
  await spike.activate();

  // A picture JPEG decodes slowly: noise and gradients at 3840x2160.
  async function photo(name) {
    const w = 3840;
    const h = 2160;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#1d3b5a");
    g.addColorStop(0.5, "#7a5c3e");
    g.addColorStop(1, "#d8b46a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 64) - 32;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    const path = PathUtils.join(out, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }

  const path = await photo("home-flash-photo.jpg");
  log("photo", (await IOUtils.stat(path)).size, "bytes");
  settings.set({ homeBackground: { kind: "image", path } });

  const timings = (tab) => {
    const d = tab.browser.contentDocument?.documentElement?.dataset;
    if (!d || d.kind !== "image" || (d.state !== "ready" && d.state !== "error")) return null;
    return { state: d.state, cached: d.cached, blank: Number(d.blankFrames), script: Number(d.tScript), picture: Number(d.tPicture), decoded: Number(d.tDecoded), shown: Number(d.tShown) };
  };
  const openHome = async (what) => {
    const preloaded = gBrowser.preloadedBrowser;
    const tab = b.newTab();
    await waitFor(() => tab.url === "about:vitre-home", { timeout: 10000, what: what + ": Home tab" });
    const t = await waitFor(() => timings(tab), { timeout: 20000, what: what + ": picture shown" });
    t.preloaded = !!preloaded && tab.browser === preloaded;
    log(what, JSON.stringify(t));
    return { tab, t };
  };

  // 1. The first Home of this process: the screen-sized copy is made, nothing is remembered yet.
  const first = await openHome("first");
  check("the first Home tab shows the picture", first.t.state === "ready" && first.t.cached === "false", first.t);
  await sleep(400);
  await spike.capture("home-flash-1-first");

  // 2. Later Home tabs, the earlier ones still open: from memory, already decoded.
  const later = [];
  for (let i = 0; i < 5; i++) {
    later.push(await openHome("later " + (i + 1)));
    await sleep(250);
  }
  await spike.capture("home-flash-2-later");
  check("later Home tabs are drawn already (preloaded) or start from the remembered picture (no file access first)", later.every((x) => x.t.preloaded || x.t.cached === "memory"), later.map((x) => (x.t.preloaded ? "preloaded" : x.t.cached)));
  check("later Home tabs draw no frame before the picture is on screen", later.every((x) => x.t.blank === 0), later.map((x) => x.t.blank));
  const waits = later.map((x) => x.t.shown - x.t.script);
  log("script -> shown (ms):", waits.join(", "));
  check("later Home tabs show the picture within 50 ms of the page script", waits.every((ms) => ms <= 50), waits);

  // 3. Every Home tab closed (nothing holds the picture any more; another page stays), then a new one.
  const other = b.newTab("about:robots");
  await waitFor(() => other && other.url === "about:robots" && !other.loading, { timeout: 10000, what: "another page" });
  for (const t of b.tabs.filter((t) => t.url === "about:vitre-home")) b.closeTab(t);
  await waitFor(() => b.tabs.every((t) => t.url !== "about:vitre-home"), { timeout: 10000, what: "no Home tab left" });
  await sleep(1500);
  const after = await openHome("after all Home tabs left");
  check("with no Home tab open, a new one is still drawn already or starts from memory", after.t.preloaded || after.t.cached === "memory", after.t);
  log("with no Home tab open: blank frames", after.t.blank, "script -> shown", after.t.shown - after.t.script, "ms");

  // 4. The base colour under the picture is the picture's mean colour, remembered across restarts.
  const color = home.baseColor({ kind: "image", path });
  const base = getComputedStyle(after.tab.browser.contentDocument.documentElement).backgroundColor;
  check("Home paints the picture's mean colour under it, not the plain grey", /^#[0-9a-f]{6}$/.test(color || "") && base !== "rgb(43, 42, 46)", { color, base });
  check("the colour is kept in the pref vitre.home.color for the next start", Services.prefs.getStringPref("vitre.home.color", "").includes(color));

  // 5. A different picture replaces the remembered one: the next tab shows the new picture (a
  // preloaded Home took the change while hidden, so it may already come from memory).
  const box = { width: screen.width * devicePixelRatio, height: screen.height * devicePixelRatio };
  const oldUrl = home.peek({ kind: "image", path }, box)?.url;
  const path2 = await photo("home-flash-photo-2.jpg");
  settings.set({ homeBackground: { kind: "image", path: path2 } });
  await waitFor(() => home.peek({ kind: "image", path: path2 }, box), { timeout: 20000, what: "the new picture remembered" });
  const changed = await openHome("changed picture");
  await sleep(700); // a cross-fade (300 ms) still in progress has both pictures on the page
  const media = [...changed.tab.browser.contentDocument.querySelectorAll("#bg > .media")];
  log("Home's pictures after the change:", JSON.stringify(media.map((m) => [m.className, m.src.slice(-40)])));
  const shownSrc = media.length === 1 ? media[0].src : "(" + media.length + " pictures)";
  const newUrl = home.peek({ kind: "image", path: path2 }, box)?.url;
  check("after a change of picture a new tab shows the new one, not the remembered old one", changed.t.state === "ready" && shownSrc === newUrl && newUrl !== oldUrl, { shownSrc, newUrl, oldUrl });
});
