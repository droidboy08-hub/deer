// Robustness review 2: 150 % scaling (layout.css.devPixelsPerPx 1.5, run.py), a scale change at run
// time with features open, the smallest window, and 40 tabs.
//   python tests/review2/run.py scale
// For each surface: its box (the visible non-scrim children of its layer) must lie inside the window.
// 40 tabs: the pill is 220 px (the core's many-tabs rule); find's face, the switcher and the menus must
// stay usable (the find field keeps its 160 px minimum: DESIGN-NOTES "Find in page" Field).
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  const b = window.vitre;
  W.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  log("devicePixelRatio", window.devicePixelRatio, "inner", window.innerWidth, window.innerHeight);
  check("the window runs at 150 %", Math.abs(window.devicePixelRatio - 1.5) < 0.01, window.devicePixelRatio);
  await W.installExt(["popup", "pin1"]);
  const peek = b.service("peek");
  const engine = b.sys("VitreDownloads");

  /** The visible boxes of a layer, scrims (full-window children) left out, and their union. */
  const layerBox = (id) => {
    const layer = document.getElementById("layer-" + id);
    if (!layer) return null;
    const boxes = [];
    const walk = (el, depth) => {
      for (const c of el.children) {
        const cs = window.getComputedStyle(c);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const r = c.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) {
          if (depth < 2) walk(c, depth + 1);
          continue;
        }
        if (r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2) {
          if (depth < 2) walk(c, depth + 1);
          continue;
        }
        boxes.push(r);
      }
    };
    walk(layer, 0);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((r) => r.left));
    const y = Math.min(...boxes.map((r) => r.top));
    const right = Math.max(...boxes.map((r) => r.right));
    const bottom = Math.max(...boxes.map((r) => r.bottom));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y), right: Math.round(right), bottom: Math.round(bottom) };
  };
  const fits = (r) => !!r && r.x >= -1 && r.y >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
  const surfaces = {
    find: ["find", () => W.openFind(window, "glass")],
    peek: ["peek", () => W.openPeek(window, W.P("scale-peek"))],
    menu: ["menus", () => W.pageMenu(window)],
    downloads: ["downloads-panel", () => W.openDownloads(window)],
    settings: ["settings", () => W.openSettings(window)],
    switcher: ["switcher", () => W.openSwitcher(window)],
    omni: ["omnibox", () => W.openOmni(window)],
  };
  const layerOf = (key) => {
    const want = surfaces[key][0];
    const ids = [...b.root.querySelectorAll(":scope > [id^='layer-']")].map((l) => l.id.slice(6));
    return ids.find((i) => i === want) || ids.find((i) => i.startsWith(want)) || want;
  };
  const sweep = async (tag) => {
    const out = {};
    for (const key of Object.keys(surfaces)) {
      b.activate(b.tabs[0]);
      await sleep(200);
      b.focusPage();
      await sleep(200);
      try {
        await surfaces[key][1]();
      } catch (e) {
        out[key] = { error: String(e) };
        await W.unwind(window, 6, 400);
        continue;
      }
      await sleep(400);
      const r = layerBox(layerOf(key));
      out[key] = { box: r, fits: fits(r), layer: layerOf(key) };
      await capture(`scale-${tag}-${key}`);
      await W.unwind(window, 6, 450);
      await sleep(300);
    }
    log(`surfaces ${tag}`, out);
    return out;
  };

  const first = await W.load(window, b.active(), W.P("scale-0", "n=8"));
  await W.open(window, W.P("scale-1"), { background: true });
  await W.open(window, W.P("scale-2"), { background: true });
  b.service("downloads").download(W.url("file?size=100000000&rate=100000&name=scale.bin"), { browser: first.browser });
  await waitFor(() => engine.list(false).some((v) => v.received > 0), { timeout: 15000 }).catch(() => null);

  // 1. 150 % at 1280x800 CSS px.
  const s1 = await sweep("150");
  for (const [k, v] of Object.entries(s1)) check(`150 %: ${k} lies inside the window`, v.fits, v);

  // 2. A scale change while each panel is open (a monitor change, or Windows' scale setting).
  const live = {};
  for (const key of ["downloads", "settings", "peek", "find", "switcher"]) {
    b.focusPage();
    await sleep(200);
    await surfaces[key][1]();
    await sleep(400);
    Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.25");
    await sleep(1500);
    const r125 = layerBox(layerOf(key));
    const fits125 = fits(r125);
    const inner125 = [Math.round(window.innerWidth), Math.round(window.innerHeight)];
    await capture(`scale-live-${key}-125`);
    Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.5");
    await sleep(1500);
    const r150 = layerBox(layerOf(key));
    live[key] = { r125, inner125, fits125, r150, fits150: fits(r150), open: W.fmt(W.layers(window)) };
    await W.unwind(window, 6, 450);
    await sleep(300);
  }
  log("scale changed while open", live);
  for (const [k, v] of Object.entries(live)) check(`scale change while ${k} is open: it re-lays out inside the window`, v.fits125 && v.fits150, v);

  // 3. The smallest window (480x360 CSS px minimum).
  await spike.resize(480, 360);
  await sleep(800);
  log("small window inner", window.innerWidth, window.innerHeight);
  const s3 = await sweep("small");
  for (const [k, v] of Object.entries(s3)) check(`smallest window: ${k} lies inside the window`, v.fits, v);
  await spike.resize(1280, 800);
  await sleep(800);

  // 4. Many tabs: the find field's width as tabs are added (1280 px window), then 40 tabs.
  const fieldAt = {};
  for (const n of [6, 10, 14, 18, 24]) {
    while (b.tabs.length < n) b.newTab(W.P("scale-" + b.tabs.length), { background: true });
    await waitFor(() => b.tabs.every((t) => !t.loading), { timeout: 30000 }).catch(() => null);
    b.activate(b.tabs[1]);
    await sleep(900);
    b.focusPage();
    await W.openFind(window, "glass ribbon");
    const f = document.querySelector("#layer-find .vf-face .vf-input");
    fieldAt[n] = { pill: Math.round(document.querySelector("#vitre-bar .item.tab.active").getBoundingClientRect().width), field: Math.round(f?.getBoundingClientRect().width ?? -1) };
    await W.unwind(window);
  }
  log("find field width by tab count (1280 CSS px window)", fieldAt);
  for (let i = b.tabs.length; i < 40; i++) b.newTab(W.P("scale-" + i), { background: true });
  await waitFor(() => b.tabs.length === 40 && b.tabs.every((t) => !t.loading), { timeout: 90000, what: "40 tabs" }).catch(() => null);
  b.activate(b.tabs[20]);
  await sleep(1200);
  const pill = document.querySelector("#vitre-bar .item.tab.active");
  const pillW = Math.round(pill.getBoundingClientRect().width);
  b.focusPage();
  await W.openFind(window, "glass ribbon");
  const face = document.querySelector("#layer-find .vf-face");
  const input = face?.querySelector(".vf-input");
  const count = face?.querySelector(".vf-count");
  const faceBox = W.rect(face);
  const inputBox = W.rect(input);
  await capture("scale-40-find");
  log("40 tabs: pill", pillW, "find face", faceBox, "field", inputBox, "count", W.rect(count), count?.textContent);
  check("40 tabs: the find field keeps its 160 px minimum (DESIGN-NOTES Find: Field 'at least 160 px')", inputBox && inputBox.w >= 160, { pill: pillW, face: faceBox, field: inputBox });
  await W.unwind(window);
  await W.openSwitcher(window);
  const swBox = layerBox(layerOf("switcher"));
  await capture("scale-40-switcher");
  await W.unwind(window);
  await sleep(300);
  const br = b.active().browser.getBoundingClientRect();
  const at = document.elementFromPoint(br.left + br.width * 0.6, br.top + br.height * 0.7);
  log("40 tabs: after the switcher closed, the element at the menu point is", at?.id || at?.className || at?.localName, "layers", W.fmt(W.layers(window)), "left", W.leftovers(window));
  const menuOk = await W.pageMenu(window).then(() => true, () => false);
  check("40 tabs: a page menu opens right after the switcher closes", menuOk, at?.id || at?.className || at?.localName);
  if (!menuOk) {
    await sleep(1500);
    await W.pageMenu(window).catch(() => null);
  }
  const menuBox = layerBox("menus");
  await W.unwind(window);
  const pr = pill.getBoundingClientRect();
  W.rightClick(window, pr.left + 30, pr.top + pr.height / 2);
  await sleep(700);
  const pillMenu = layerBox("menus");
  await capture("scale-40-pill-menu");
  await W.unwind(window);
  log("40 tabs boxes", { swBox, menuBox, pillMenu });
  check("40 tabs: switcher and menus lie inside the window", fits(swBox) && fits(menuBox) && fits(pillMenu), { swBox, menuBox, pillMenu });
  check("everything closed, nothing left behind", W.fmt(W.layers(window)) === "none" && W.leftovers(window).length === 0, [W.fmt(W.layers(window)), W.leftovers(window)]);
  W.consoleDump("scale");
  check("no console errors from Vitre's code", W.vitreErrors().length === 0, W.vitreErrors());
  for (const v of engine.list(false)) engine.cancel(v.id);
  await sleep(400);
});
