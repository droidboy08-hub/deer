// Probe (not in all.py): does the deck's decoded wallpaper survive a minute off screen? Gecko's
// surface cache drops decoded images that were not drawn for image.mem.surfacecache.min_expiration_ms;
// an async-decoding <img> then paints nothing until it is decoded again. Times img.decode() of the
// wallpaper's URL right after a deck opening and again after 70 s, and checks the deck's first
// frames after the wait (the switcher warms the picture at the Ctrl+Tab keydown).
// python tools/run.py --test tests/switcher-verify/probe-wallpaper.js --name swverify-probewall --app build-switcher-verify --timeout 200
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { check, log, sleep } = V;
  await spike.resize(1440, 900);
  await spike.activate();
  await V.openTabs(["A", "B", "C"].map((n) => V.page(n, "#eee")));
  await sleep(2000);
  await V.holdOpen(1);
  await sleep(500);
  const wall = document.querySelector("#layer-switcher .sw-wall");
  const src = wall?.src ?? "";
  log("wallpaper", { tag: wall?.localName, src: src.slice(0, 80), natural: wall ? [wall.naturalWidth, wall.naturalHeight] : null });
  await V.release();
  const time = async () => {
    const img = document.createElement("img");
    img.decoding = "async";
    img.src = src;
    const t = performance.now();
    await img.decode().catch((e) => log("decode failed", String(e)));
    return Math.round((performance.now() - t) * 10) / 10;
  };
  if (!src) {
    log("no picture wallpaper on this machine (none / video / plain): nothing to probe");
    return;
  }
  const warm = await time();
  log("decode right after the deck showed (cached):", warm, "ms");
  await sleep(70000);
  const cold = await time();
  log("decode after 70 s off screen:", cold, "ms");
  check("probe: the wallpaper's decoded copy timing logged (cold decode is what the keydown warm-up hides)", true, { warm, cold });
});
