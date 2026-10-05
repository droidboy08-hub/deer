// The bar's look: 1, 3 and 12 tabs over a busy real page (Wikipedia), a white page and a dark page,
// at 1280x800 and 900x700; geometry against the design's numbers; the glass tokens; the lenses.
//   python tools/run.py --test tests/shell/look.js --name shell-look --timeout 240
// (python tests/shell/all.py runs it with the pixel checks.) Captures: look-<tabs>-<page>-<width>.png,
// look-stripes-*.png (the ones check.py measures), look-wiki-photo-1280.png.
/* global spike, T, gBrowser, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const $ = (s) => document.querySelector(s);
  const css = (el, prop) => getComputedStyle(el)[prop];
  const near = (a, c, tol = 0.6) => Math.abs(a - c) <= tol;

  await spike.resize(1280, 800);
  await spike.activate();
  const W = window.innerWidth;
  log("window", { innerWidth: W, innerHeight: window.innerHeight, dpr: window.devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });

  // ---- 1. the matrix of captures ----
  const themes = {};
  for (const count of [1, 3, 12]) {
    await T.tabs(count);
    for (const name of ["wiki", "white", "dark"]) {
      await T.go(T.pages[name]);
      for (const [w, h] of [[1280, 800], [900, 700]]) {
        await spike.resize(w, h);
        await T.settled();
        await sleep(300);
        const info = T.bar();
        themes[name] = info.theme;
        log(`look ${count} tabs, ${name}, ${w}x${h}:`, { theme: info.theme, pill: [info.pill.x, info.pill.y, info.pill.w, info.pill.h], circle: info.circles[0] && [info.circles[0].w, info.circles[0].h], group: [b.bar.layout.left, b.bar.layout.right], capsule: [info.capsule.x, info.capsule.y], state: info.state });
        await spike.capture(`look-${count}-${name}-${w}`);
      }
      await spike.resize(1280, 800);
    }
  }
  check("glass theme follows the page: light over Wikipedia and the white page, dark over the dark page", themes.wiki === "light" && themes.white === "light" && themes.dark === "dark", themes);

  // ---- 2. geometry against the design (1280x800, one tab) ----
  await T.tabs(1);
  await T.go(T.pages.white);
  await T.settled();
  let info = T.bar();
  const pill = info.pill;
  const plus = info.circles[0];
  check("pill is 480x44 at top 12", pill.w === 480 && pill.h === 44 && pill.y === 12, pill);
  check("+ circle is 44x44, 8 px right of the pill", plus.w === 44 && plus.h === 44 && plus.y === 12 && near(plus.x - (pill.x + pill.w), 8), plus);
  check("the group is centred in the window", near((pill.x + plus.x + plus.w) / 2, W / 2, 1), [pill.x, plus.x + plus.w, W]);
  check("b.bar.layout reports the pill and the group", b.bar.layout.pillRect.x === pill.x && b.bar.layout.pillRect.width === 480 && b.bar.layout.left === pill.x && b.bar.layout.right === plus.x + plus.w, b.bar.layout);
  check("window controls: 108x32 capsule, 12 px from the right, top 18", info.capsule.w === 108 && info.capsule.h === 32 && info.capsule.y === 18 && near(W - (info.capsule.x + info.capsule.w), 12), info.capsule);
  const item = pill.el;
  check("radii: pill 22, capsule 16", css(item, "borderTopLeftRadius") === "22px" && css($("#vitre-winctl"), "borderTopLeftRadius") === "16px");
  const back = T.rect(item.querySelector(".back"));
  const forward = T.rect(item.querySelector(".forward"));
  const reload = T.rect(item.querySelector(".reload"));
  // Board (HomeBrowse, 480 pill): Back 8..36, Forward 38..66, download mark 410..438, Reload 442..470.
  const mark = item.querySelector(".dl-mark");
  check("Back 28x28 at 8 px, Forward 2 px after it, Reload 10 px from the right end with the 28 px download slot 4 px before it", back.w === 28 && back.h === 28 && near(back.x - pill.x, 8) && near(back.y - pill.y, 8) && near(forward.x - (back.x + 28), 2) && near(pill.x + pill.w - (reload.x + reload.w), 10) && near(T.rect(mark).x - pill.x, 410) && near(reload.x - pill.x, 442), { back, forward, reload, mark: T.rect(mark) });
  const address = item.querySelector(".address");
  const host = item.querySelector(".host");
  check("address: favicon + host, 13.5 px / 500, centred between the buttons", css(address, "fontSize") === "13.5px" && css(address, "fontWeight") === "500" && css(address, "justifyContent") === "center" && css(address, "columnGap") === "8px", [css(address, "fontSize"), css(address, "fontWeight")]);
  const favBox = T.rect(address.querySelector(".fav"));
  const hostBox = T.rect(host);
  // A feature module may fill the accessories slot (the extensions module's button): the address box
  // then ends before it, and the favicon + host group still sits at the pill's middle (bar.css).
  // A host too long for the box (this data: page's) fills it and ellipsizes; a host that fits is
  // centred at the pill's middle.
  const accW = item.querySelector(".accessories").getBoundingClientRect().width;
  const addrBox = T.rect(address);
  const cut = host.scrollWidth > host.clientWidth + 0.5;
  const groupOk = cut ? near(favBox.x, addrBox.x, 1) && near(hostBox.x + hostBox.w, addrBox.x + addrBox.w, 1.5) : near((favBox.x + hostBox.x + hostBox.w) / 2, pill.x + pill.w / 2, 1.5);
  check("the favicon + host group is centred at the pill's middle, or fills the address box when the host is cut (board: address 76..404 in the 480 pill, less the accessories slot)", groupOk && near(addrBox.x - pill.x, 76, 1) && near(pill.x + pill.w - (addrBox.x + addrBox.w), 76 + accW, 1), { group: [favBox.x, hostBox.x + hostBox.w], cut, centre: pill.x + pill.w / 2, address: addrBox, accessories: accW });
  check("font is Segoe UI Variable Text", css(host, "fontFamily").startsWith('"Segoe UI Variable Text"'), css(host, "fontFamily"));
  const acc = item.querySelector(".accessories");
  const order = [...item.querySelector(".pill-face").children].map((c) => c.className.replace("nav ", "").replace(" empty", ""));
  check("pill order: back, forward, address, accessories, dl-mark, reload", order.join() === "back,forward,address,accessories,dl-mark,reload", order);
  check("accessories slot: role group, label Extensions; download mark empty (invisible) but keeping its 28 px slot", acc.getAttribute("role") === "group" && acc.getAttribute("aria-label") === "Extensions" && mark.classList.contains("empty") && css(mark, "visibility") === "hidden" && css(mark, "pointerEvents") === "none" && T.rect(mark).w === 28 && b.bar.accessories() === acc && b.bar.downloadMark() === mark, { visibility: css(mark, "visibility"), w: T.rect(mark).w });
  const buttons = [...document.querySelectorAll("#vitre-winctl button")].map(T.rect);
  check("caption buttons are 36x32 each", buttons.length === 3 && buttons.every((r) => r.w === 36 && r.h === 32), buttons);

  // ---- 3. glass structure and tokens (light) ----
  const layers = [...item.children].slice(0, 3).map((c) => c.className);
  check(".glass > .lens, .tint, .rim under the content", item.classList.contains("glass") && layers.join() === "lens,tint,rim", layers);
  const tint = item.querySelector(":scope > .tint");
  const rim = item.querySelector(":scope > .rim");
  check("light tint is white 0.42 -> 0.22", css(tint, "backgroundImage") === "linear-gradient(rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.22))", css(tint, "backgroundImage"));
  check("light rim: 1 px ring, 165deg white 0.95 / 0.35 / 0.2 / 0.8", css(rim, "paddingTop") === "1px" && css(rim, "backgroundImage") === "linear-gradient(165deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.35) 30%, rgba(255, 255, 255, 0.2) 60%, rgba(255, 255, 255, 0.8))" && css(rim, "maskComposite").includes("exclude"), [css(rim, "backgroundImage"), css(rim, "maskComposite")]);
  check("light shadow: 0 10px 28px rgba(40,30,15,.14), 0 1px 2px rgba(40,30,15,.18)", css(item, "boxShadow") === "rgba(40, 30, 15, 0.14) 0px 10px 28px 0px, rgba(40, 30, 15, 0.18) 0px 1px 2px 0px", css(item, "boxShadow"));
  const fwd = item.querySelector(".forward");
  check("light text #16181d, icons at 0.78, a disabled button at 0.28", css(host, "color") === "rgb(22, 24, 29)" && fwd.getAttribute("aria-disabled") === "true" && css(fwd, "color") === "rgba(22, 24, 29, 0.28)" && css(item.querySelector(".reload"), "color") === "rgba(22, 24, 29, 0.78)", [css(host, "color"), css(fwd, "color"), css(item.querySelector(".reload"), "color")]);
  const lensEl = item.querySelector(":scope > .lens");
  check("the active pill has its own lens filter", /^url\("?#vitre-lens-\d+"?\)$/.test(css(lensEl, "backdropFilter")), css(lensEl, "backdropFilter"));
  const pillFilter = document.querySelector(css(lensEl, "backdropFilter").match(/#vitre-lens-\d+/)[0]);
  check("pill lens: 480x44, 12 feOffset strips, blur 2.4, saturate 1.5", pillFilter.getAttribute("width") === "480" && pillFilter.getAttribute("height") === "44" && pillFilter.querySelectorAll("feOffset").length === 12 && pillFilter.querySelector("feGaussianBlur").getAttribute("stdDeviation") === "2.4" && pillFilter.querySelector("feColorMatrix").getAttribute("values") === "1.5", pillFilter.outerHTML.slice(0, 200));
  check("the circles share one row-lens element", info.rows.length === 1 && css(plus.el.querySelector(":scope > .lens"), "backdropFilter") === "none", info.rows);
  const capLens = css($("#vitre-winctl > .lens"), "backdropFilter");
  const capFilter = document.querySelector(capLens.match(/#vitre-lens-\d+/)[0]);
  check("capsule lens: 108x32, blur 1.4", capFilter.getAttribute("width") === "108" && capFilter.getAttribute("height") === "32" && capFilter.querySelector("feGaussianBlur").getAttribute("stdDeviation") === "1.4", capLens);
  const motion = css(plus.el, "transition");
  check("motion: left and width 420 ms on the spring", /left 0\.42s cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(motion) && /width 0\.42s cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(motion), motion);
  check("tab box keeps the neutral filter (glass sees the page)", css(document.getElementById("tabbrowser-tabbox"), "filter").startsWith("saturate"));
  check("the bar is click-through between its items", css($("#vitre-bar"), "pointerEvents") === "none" && document.elementFromPoint(100, 30)?.localName === "browser" && document.elementFromPoint(pill.x + pill.w + 4, 30)?.localName === "browser", document.elementFromPoint(100, 30)?.localName);

  // ---- 4. dark tokens ----
  await T.go(T.pages.dark);
  await waitFor(() => b.theme() === "dark", { what: "dark theme" });
  check("dark tint: white 0.12 -> 0.04 over rgba(16,16,20,.3)", css(tint, "backgroundImage").startsWith("linear-gradient(rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04))") && css(tint, "backgroundColor") === "rgba(16, 16, 20, 0.3)", [css(tint, "backgroundImage"), css(tint, "backgroundColor")]);
  check("dark shadow and white text", css(item, "boxShadow") === "rgba(0, 0, 0, 0.25) 0px 10px 28px 0px, rgba(0, 0, 0, 0.3) 0px 1px 2px 0px" && css(host, "color") === "rgb(255, 255, 255)", css(item, "boxShadow"));
  check("native popups read the theme from the root", document.documentElement.getAttribute("vitre-theme") === "dark" && b.root.classList.contains("theme-dark"));

  // ---- 5. theme sampling: scroll and paint ----
  const half = T.page("Half", "<body style='margin:0;background:#fff'><div style='height:600px'></div><div id=d style='height:3000px;background:#0b0b0e'></div><script>onmessage=()=>{document.body.style.background='#000';document.querySelector('div').style.background='#000'}</script>", T.tile("#888", "#fff"));
  await T.go(half);
  await waitFor(() => b.theme() === "light", { what: "light over the white top" });
  gBrowser.selectedBrowser.messageManager.loadFrameScript("data:,content.scrollTo(0, 900)", false);
  const flipped = await waitFor(() => b.theme() === "dark", { timeout: 4000, what: "dark after scrolling to the dark part" }).then(() => true, () => false);
  check("scrolling to a dark part of the page turns the glass dark", flipped);
  gBrowser.selectedBrowser.messageManager.loadFrameScript("data:,content.scrollTo(0, 0)", false);
  await waitFor(() => b.theme() === "light", { timeout: 4000, what: "light again" });
  gBrowser.selectedBrowser.messageManager.loadFrameScript("data:,content.postMessage('dark','*')", false);
  const repainted = await waitFor(() => b.theme() === "dark", { timeout: 4000, what: "dark after the page repainted itself" }).then(() => true, () => false);
  check("a page that repaints itself dark (no scroll, no load) turns the glass dark", repainted);
  b.setHomeTheme("clear");
  check("Home takes its theme from setHomeTheme", b.homeTheme === "clear");
  // Text-heavy light pages: 13 px text on white reads as light glass (the sampler snapshots at 1/4
  // scale; at 1/16 the text rasterised so dark that such pages turned the glass dark).
  const dense = (font, bg) => T.page("Dense text", `<body style='margin:0;background:${bg};color:#111;font:${font}'>` + Array.from({ length: 60 }, () => "<div style='white-space:nowrap'>" + "The quick brown fox jumps over the lazy dog 0123456789 ".repeat(6) + "</div>").join(""), T.tile("#888", "#fff"));
  const denseThemes = {};
  for (const [name, font, bg] of [["segoe13", "13px/16px Segoe UI", "#fff"], ["verdana11", "11px/13px Verdana", "#f6f6ef"]]) {
    await T.go(dense(font, bg));
    await sleep(400);
    denseThemes[name] = b.theme();
  }
  await spike.capture("look-dense-text-1280");
  check("dense 13 px and 11 px text on a light page keeps the glass light", denseThemes.segoe13 === "light" && denseThemes.verdana11 === "light", denseThemes);

  // ---- 6. three tabs: circles ----
  await T.tabs(3);
  await T.go(T.pages.white);
  info = T.bar();
  const c1 = info.items[1];
  const c2 = info.items[2];
  check("three tabs: pill 480, circles 44, all 8 px apart, centred", info.pill.w === 480 && c1.w === 44 && c2.w === 44 && near(c1.x - (info.pill.x + 480), 8) && near(c2.x - (c1.x + 44), 8) && near(info.items[3].x - (c2.x + 44), 8) && near((info.items[0].x + info.items[3].x + 44) / 2, W / 2, 1), info.items.map((i) => [i.kind, i.x, i.w]));
  const face = c1.el.querySelector(".circle-face");
  const fav = face.querySelector(".fav img");
  check("circle: favicon 18 px (board), radius 3, centred", !!fav && T.rect(fav).w === 18 && css(fav, "borderTopLeftRadius") === "3px" && near(T.rect(fav).x + 9, c1.x + 22, 1) && near(T.rect(fav).y + 9, c1.y + 22, 1), fav && T.rect(fav));
  check("circle is named after its tab", face.getAttribute("aria-label") === b.tabs[1].title && c1.el.querySelector(".close-badge").getAttribute("aria-label") === "Close " + b.tabs[1].title, face.getAttribute("aria-label"));

  // ---- 7. the lenses, measured (check.py reads the MEASURE lines) ----
  await T.tabs(12);
  for (const name of ["stripes", "stripesLight", "stripesDark"]) {
    await T.go(T.pages[name]);
    for (const [w, h] of [[1280, 800], [900, 700]]) {
      await spike.resize(w, h);
      await T.settled();
      await sleep(300);
      await T.shot(`look-${name}-12-${w}`);
    }
    await spike.resize(1280, 800);
  }
  await T.settled();
  info = T.bar();
  check("12 tabs at 1280: the pill gives way (368), circles stay 44, one row lens for 12 shapes", info.state.pill === 368 && info.state.size === 44 && info.rows.length === 1 && info.circles.length === 12, info.state);
  const rowFilter = document.querySelector("#vitre-glass-defs filter[id^=vitre-row-]");
  check("row lens: 6 shared strips + 4 per shape", rowFilter.querySelectorAll("feOffset").length === 6 + 4 * 12 && document.querySelectorAll("#vitre-glass-defs filter[id^=vitre-row-]").length === 1, rowFilter.querySelectorAll("feOffset").length);
  await spike.resize(900, 700);
  await T.settled();
  info = T.bar();
  const right = Math.max(...info.items.map((i) => i.x + i.w));
  check("12 tabs at 900: compact circles, everything left of the window controls, none hidden", info.state.pill === 220 && info.state.size < 44 && info.state.size >= 30 && info.state.shown === 12 && right <= info.capsule.x - 16 && info.items[0].x >= 12, { state: info.state, right, capsule: info.capsule.x });
  await spike.resize(1280, 800);
  await T.tabs(1);
  await T.go(T.pages.stripes);
  await T.shot("look-stripes-1-1280");
  await T.tabs(3);
  await T.shot("look-stripes-3-1280");

  // ---- 8. a busy photo under the bar ----
  await T.tabs(3);
  await T.go(T.pages.wiki);
  gBrowser.selectedBrowser.messageManager.loadFrameScript("data:,content.scrollTo(0, 215)", false);
  await sleep(900);
  log("wiki scrolled to the photo: theme", b.theme());
  await spike.capture("look-wiki-photo-1280");

  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
});
