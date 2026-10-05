// Card pictures (spikes/switcher/RESULT.md recipe 1 and corrections): fresh pictures of background
// tabs that changed, a picture taken at discard, zoom-independent size, JPEGs on disk keyed through
// SessionStore values, none from private windows, restored (unloaded) tabs showing last session's
// picture after a restart, and the sweep of unused files.
// python tools/run.py --test tests/switcher/thumbs.js --name switcher-thumbs --app build-switcher --timeout 240
/* global spike, Services, gBrowser, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, state } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  const th = () => S.sw().thumbs;
  const dir = PathUtils.join(PathUtils.profileDir, "vitre-thumbs");
  const page = (name, colour, script = "") => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>${name}</title><body style="margin:0;background:${colour};font:40px Segoe UI"><p style="margin:200px 80px">${name}</p>${script ? `<script>${script}</script>` : ""}`);
  /** Mean colour of the middle of a card's picture in the switcher. */
  const cardColour = (tab) => {
    const c = document.querySelector(`#layer-switcher [data-id="${tab.id}"] .sw-media canvas`);
    if (!c || !c.width) return null;
    const d = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.7), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const reddish = (c) => c && c[0] > 180 && c[2] < 120;
  const bluish = (c) => c && c[2] > 180 && c[0] < 120;

  if (spike.run === 1) {
    const tabs = await S.openTabs([
      page("Home base", "#f4f1ea"),
      // Turns from red to blue 2.5 s after it loads, while it sits in the background.
      page("Chameleon", "#d0302a", "setTimeout(()=>{document.body.style.background='#2a50d0'},2500)"),
      page("To discard", "#2aa04a"),
      page("Zoomed", "#f3efd9"),
    ]);
    const [home, cham, disc, zoomed] = tabs;
    await S.visit([zoomed, disc, cham, home]);
    // 1. A background tab that changed shows its new picture.
    b.service("switcher").open("latched");
    await S.waitFor(() => state().phase === "open");
    await sleep(500);
    const before = cardColour(cham);
    b.escape();
    await S.waitFor(() => state().phase === "idle");
    await sleep(3200);
    b.service("switcher").open("latched");
    await S.waitFor(() => state().phase === "open");
    await S.waitFor(() => bluish(cardColour(cham)), { timeout: 3000, what: "fresh picture" }).catch(() => null);
    const after = cardColour(cham);
    check("a background tab whose page changed shows its new picture when its card is on screen", reddish(before) && bluish(after), { before, after });
    await spike.capture("thumbs-fresh");
    b.escape();
    await S.waitFor(() => state().phase === "idle");

    // 2. Discard: the picture is taken in the same tick, before the document goes.
    const d0 = th().stats.discards;
    const v0 = th().age(disc.id);
    gBrowser.discardBrowser(disc.node, true);
    await sleep(800);
    check("a tab being discarded is drawn at that moment", th().stats.discards === d0 + 1 && disc.deferred && th().age(disc.id) < v0 && th().age(disc.id) < 1500, { discards: th().stats.discards, deferred: disc.deferred, age: Math.round(th().age(disc.id)) });

    // 3. Zoom does not change the picture's size.
    b.activate(zoomed);
    await sleep(400);
    window.FullZoom.setZoom(1.5, zoomed.browser);
    await sleep(500);
    await th().capture(zoomed, "show");
    let zw = 0;
    th().drawInto(zoomed.id, (bmp) => (zw = bmp.width));
    const expected = Math.round(zoomed.browser.getBoundingClientRect().width * 0.6 * window.devicePixelRatio);
    check("a page zoomed to 150% is pictured at the same size", Math.abs(zw - expected) <= 2, { zw, expected });
    window.FullZoom.reset(zoomed.browser);
    b.activate(home);
    await sleep(2400);

    // 4. Files on disk, named through SessionStore values.
    const files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
    const values = b.tabs.map((t) => window.SessionStore.getCustomTabValue(t.node, "vitre-thumb"));
    check("every tab's JPEG is on disk and its tab carries the file id", values.every((v) => v && files.includes(v + ".jpg")), { files, values });
    // An unused file the sweep must remove at the next start.
    await IOUtils.write(PathUtils.join(dir, "0123456789abcdef0123456789abcdef.jpg"), new Uint8Array([1, 2, 3]));

    // 5. Private windows never write.
    const priv = await spike.openWindow({ private: true });
    await priv.spike.activate();
    const pb = priv.vitre;
    pb.navigate(pb.active(), page("Private one", "#333"));
    const pt = pb.newTab(page("Private two", "#e0d0f0"), { background: true });
    await sleep(1500);
    priv.spike.press("Shift+A", { ctrlKey: true });
    await priv.spike.waitFor(() => priv.vitreSwitcher.state().phase === "open");
    await sleep(900);
    await priv.spike.capture("thumbs-private-window");
    const privState = priv.vitreSwitcher.state();
    priv.spike.press("Escape");
    await sleep(2200);
    const privStats = priv.vitreSwitcher.thumbs.stats;
    check("a private window has its own switcher with its own tabs and writes nothing to disk", privState.list.length === 2 && privStats.captures > 0 && privStats.saved === 0 && !priv.SessionStore.getCustomTabValue(pt.node, "vitre-thumb"), { list: privState.list.length, privStats });
    priv.close();
    await sleep(500);
    await spike.activate();
    log("run 1 stats", th().stats, th().memory());
    await spike.restart();
    return;
  }

  // ---- run 2: restored session ----
  await S.waitFor(() => b.tabs.length >= 4, { timeout: 20000, what: "restored tabs" });
  await sleep(1500);
  const deferred = b.tabs.filter((t) => t.deferred);
  log("restored", b.tabs.map((t) => ({ title: t.title, deferred: t.deferred })), "stats", th().stats);
  check("restored tabs that have not loaded have last session's pictures", deferred.length >= 2 && deferred.every((t) => th().has(t.id)) && th().stats.loadedFromDisk >= deferred.length, { deferred: deferred.length, fromDisk: th().stats.loadedFromDisk });
  b.service("switcher").open("latched");
  await S.waitFor(() => state().phase === "open");
  await sleep(900);
  const shown = S.painted();
  check("... and their cards show them", shown.painted === shown.onScreen && shown.onScreen >= 2, shown);
  await spike.capture("thumbs-restored");
  b.escape();
  await S.waitFor(() => state().phase === "idle");
  const fake = PathUtils.join(dir, "0123456789abcdef0123456789abcdef.jpg");
  await S.waitFor(async () => !(await IOUtils.exists(fake)), { timeout: 40000, interval: 1000, what: "sweep" }).catch(() => null);
  const left = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
  const values = b.tabs.map((t) => window.SessionStore.getCustomTabValue(t.node, "vitre-thumb")).filter(Boolean);
  check("the sweep removed the unused file and kept the ones the session refers to", !left.includes("0123456789abcdef0123456789abcdef.jpg") && values.every((v) => left.includes(v + ".jpg")), { left, values });
});
