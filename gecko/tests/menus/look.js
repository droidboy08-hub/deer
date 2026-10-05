// Material and motion. The frost is measured: over a striped page the menu (text hidden) must flatten
// the stripes far below what its 0.80 tint alone leaves (tests/menus/check.py reads the MEASURE
// lines). Light theme, the raised tint over a dark page, reduced motion, the open / plate / close
// motion, and the MenuGallery scene (an image link near the right edge flips left) at 1440 x 900.
/* global spike, Services, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(250);
  };
  const menuEl = () => document.querySelector("#layer-menus .vt-menu");
  const dpr = window.devicePixelRatio;
  const measure = (name, menu, ref, expect) => {
    // segments in window CSS px; check.py scales by dpr
    log("MEASURE " + name + " " + JSON.stringify({ dpr, expect, probe: menu, ref }));
  };

  // ---- frost over stripes: on, then off ----
  await M.load(M.page("stripes.html"));
  M.rightClick(300, 160);
  check("menu over stripes", await M.waitOpen());
  let st = M.state();
  const hideText = document.createElement("style");
  hideText.id = "look-hide-text";
  hideText.textContent = "#layer-menus .vt-menu .vt-menu-list { visibility: hidden; }";
  document.head.append(hideText);
  await sleep(200);
  const seg = { x0: Math.round(st.rect.left + 24), x1: Math.round(st.rect.left + st.rect.width - 24), y: Math.round(st.rect.top + st.rect.height / 2) };
  const ref = { x0: seg.x0, x1: seg.x1, y: 760 };
  await capture("look-frost-on");
  measure("look-frost-on", seg, ref, "frost");
  menuEl().style.backdropFilter = "none";
  await sleep(200);
  await capture("look-frost-off");
  measure("look-frost-off", seg, ref, "tint");
  menuEl().style.backdropFilter = "";
  hideText.remove();
  await sleep(100);
  await capture("look-frost-text");
  await close();

  // ---- light theme (Settings › Appearance): the menu follows Vitre's mode, never the page ----
  await M.load(M.page("article.html"));
  b.sys("VitreSettings").set({ theme: "light" });
  await sleep(800);
  await M.openOn("#link1");
  st = M.describe("LIGHT");
  check("light theme: the light material", st.classes.includes("t-light"), st.classes);
  const cs = getComputedStyle(menuEl());
  check("light material: tint rgba(249,249,251,0.8)", cs.backgroundColor === "rgba(249, 249, 251, 0.8)", cs.backgroundColor);
  check("frost: blur(24px) saturate(1.6)", cs.backdropFilter === "blur(24px) saturate(1.6)", cs.backdropFilter);
  await capture("look-light");
  await close();
  b.sys("VitreSettings").set({ theme: "dark" });
  await sleep(800);
  await M.openOn("#link1");
  st = M.state();
  check("dark theme: the dark material", st.classes.includes("t-dark") && getComputedStyle(menuEl()).backgroundColor === "rgba(32, 32, 38, 0.8)", st.classes);
  check("over a light page: not raised", !st.classes.includes("t-raised"), menuEl().dataset.luma);
  await close();

  // ---- raised over a dark page ----
  await M.load(M.page("dark.html"));
  M.rightClick(500, 300);
  await M.waitOpen();
  await sleep(300);
  st = M.describe("RAISED");
  check("over a dark page: the raised tint (luma under 48)", st.classes.includes("t-raised") && getComputedStyle(menuEl()).backgroundColor === "rgba(48, 48, 56, 0.86)", { classes: st.classes, luma: menuEl().dataset.luma });
  await capture("look-raised");
  await close();
  b.sys("VitreSettings").set({ theme: "system" });
  await sleep(500);

  // ---- motion ----
  await M.load(M.page("article.html"));
  const link = await M.rectOf("#link1");
  M.rightClick(link.cx, link.cy);
  await spike.waitFor(() => menuEl(), { what: "menu element" });
  const early = getComputedStyle(menuEl());
  const earlyOpacity = parseFloat(early.opacity);
  const earlyTransform = early.transform;
  log("open motion at the start", earlyOpacity, earlyTransform, M.menus().view.lastMotion.open);
  check("open: fades in 90 ms and scales 0.96 -> 1 on the spring over 200 ms", /opacity 90ms cubic-bezier\(0\.2, 0, 0, 1\)/.test(M.menus().view.lastMotion.open) && /transform 200ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(M.menus().view.lastMotion.open), M.menus().view.lastMotion.open);
  check("open: starts transparent and scaled", earlyOpacity < 1 && earlyTransform !== "none", { earlyOpacity, earlyTransform });
  await sleep(300);
  const landed = getComputedStyle(menuEl());
  check("open: transform removed once landed (crisp text)", landed.transform === "none" && parseFloat(landed.opacity) === 1 && menuEl().style.transform === "", { transform: landed.transform, opacity: landed.opacity });
  // plate: glides between neighbours, snaps on jumps
  const rowRect = (i) => M.menus().view.rowElement(i).getBoundingClientRect();
  const plate = () => menuEl().querySelector(".vt-plate");
  let r = rowRect(0);
  M.mouse(r.left + 60, r.top + 17, { type: "mousemove" });
  await sleep(120);
  r = rowRect(1);
  M.mouse(r.left + 60, r.top + 17, { type: "mousemove" });
  check("plate glides 90 ms on the spring to a neighbouring row", /top 90ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(plate().style.transition), plate().style.transition);
  await sleep(150);
  r = rowRect(4);
  M.mouse(r.left + 60, r.top + 17, { type: "mousemove" });
  check("plate snaps on a jump", !/top/.test(plate().style.transition), plate().style.transition);
  await sleep(150);
  // dismiss: 120 ms fade with scale 0.985
  const el = menuEl();
  M.key("KEY_Escape");
  check("dismiss: 120 ms fade, scale 1 -> 0.985", /opacity 120ms/.test(el.style.transition) && el.style.transform === "scale(0.985)", { transition: el.style.transition, transform: el.style.transform });
  await sleep(250);
  check("dismissed menu removed", !el.isConnected);
  // choose: 100 ms fade with the row lit
  await M.openOn("#link1");
  const el2 = menuEl();
  M.setClipboard("x");
  M.key("e");
  check("choose: the row stays lit, 100 ms fade", /opacity 100ms/.test(el2.style.transition) && el2.querySelector(".vt-mi.active")?.textContent.includes("Copy link address"), el2.style.transition);
  await sleep(250);

  // ---- reduced motion ----
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await sleep(300);
  await M.openOn("#link1");
  check("reduced motion: a 150 ms cross-fade, no scale", M.menus().view.lastMotion.reduced && /opacity 150ms/.test(M.menus().view.lastMotion.open) && !/transform/.test(M.menus().view.lastMotion.open), M.menus().view.lastMotion);
  r = rowRect(0);
  M.mouse(r.left + 60, r.top + 17, { type: "mousemove" });
  await sleep(100);
  r = rowRect(1);
  M.mouse(r.left + 60, r.top + 17, { type: "mousemove" });
  check("reduced motion: the plate does not glide", !/top/.test(plate().style.transition), plate().style.transition);
  const el3 = menuEl();
  M.key("KEY_Escape");
  check("reduced motion: dismiss is a 150 ms fade, no scale", /opacity 150ms/.test(el3.style.transition) && !el3.style.transform.includes("scale"), el3.style.transition);
  await sleep(300);
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await sleep(300);

  // ---- touch: 40 px rows, centred on the finger, bottom edge 24 px above it ----
  await M.load(M.page("article.html"));
  {
    const r = await M.rectOf("#p4");
    M.rightClick(r.x + 200, r.cy, { inputSource: 5 /* MOZ_SOURCE_TOUCH */ });
    await M.waitOpen();
    st = M.describe("TOUCH");
    const row = M.menus().view.rowElement(0).getBoundingClientRect();
    check("touch: 40 px rows", Math.round(row.height) === 40 && st.classes.includes("touch"), row.height);
    check("touch: centred on the finger, bottom 24 px above it", Math.abs(st.rect.left + st.rect.width / 2 - (r.x + 200)) <= 1 && Math.abs(st.rect.top + st.rect.height - (r.cy - 24)) <= 1, { rect: st.rect, finger: [r.x + 200, r.cy] });
    await capture("look-touch");
    await close();
  }

  // ---- a menu taller than the window minus 16 scrolls inside ----
  await spike.resize(640, 360);
  await sleep(500);
  await M.load(M.page("article.html"));
  {
    const many = Array.from({ length: 14 }, (_, i) => ({ label: "Row " + (i + 1), run: () => {} }));
    b.service("menus").show(many, { x: 100, y: 60 });
    await M.waitOpen();
    st = M.state();
    const list = menuEl().querySelector(".vt-menu-list");
    check("small window: the menu is the window's height minus 16 and scrolls", Math.abs(st.rect.height - (window.innerHeight - 16)) <= 1 && list.scrollHeight > list.clientHeight + 10, { height: st.rect.height, inner: window.innerHeight, scroll: [list.scrollHeight, list.clientHeight] });
    M.key("KEY_End");
    await sleep(200);
    const last = M.menus().view.rowElement(M.state().rows.length - 1).getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    check("End brings the last row into view", last.bottom <= lr.bottom + 1 && last.top >= lr.top - 1, { row: [last.top, last.bottom], list: [lr.top, lr.bottom] });
    await capture("look-small-window");
    await close();
  }
  await spike.resize(1440, 900);
  await sleep(500);

  // ---- element full screen: #vitre-root is not drawn; menus go to a top-layer host (solid tint) ----
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  await M.load(M.page("article.html"));
  const clip = await M.makeVideo("look-clip.webm", 1);
  await M.inContent(b.active().browser, async (content, src) => {
    const v = content.document.getElementById("vid");
    v.src = src;
    v.loop = true;
    await v.play().catch(() => {});
    await v.requestFullscreen();
  }, clip);
  const fs = await spike.waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 6000, what: "element full screen" }).catch(() => false);
  check("element full screen entered", !!fs);
  if (fs) {
    await sleep(1200);
    M.rightClick(700, 450);
    const opened = await M.waitOpen();
    st = M.describe("FULLSCREEN VIDEO");
    const host = document.getElementById("vitre-menus-top");
    check("element full screen: Vitre's menu in the top-layer host", opened && !!host && host.matches(":popover-open") && !!host.querySelector(".vt-menu"), { opened, host: !!host, popover: host && host.matches(":popover-open") });
    check("element full screen: the solid material (no page to frost there)", st.classes.includes("solid"), st.classes);
    const mr = host.querySelector(".vt-menu").getBoundingClientRect();
    check("element full screen: the menu at the pointer", Math.abs(mr.left - 700) <= 1 && Math.abs(mr.top - 450) <= 1, [mr.left, mr.top]);
    await capture("look-fullscreen");
    await close();
    check("the top-layer host goes when the menu closes", !document.getElementById("vitre-menus-top"));
    await M.inContent(b.active().browser, (content) => content.document.exitFullscreen());
    await spike.waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 6000, what: "full screen exit" }).catch(() => null);
    await sleep(800);
    await M.openOn("#link1");
    check("after full screen: menus back in the layer", !!document.querySelector("#layer-menus .vt-menu"));
    await close();
  }

  // ---- MenuGallery: an image link near the right edge opens leftward (right edge at the hotspot) ----
  await M.load(M.page("gallery.html"));
  M.rightClick(1318, 452);
  await M.waitOpen();
  st = M.describe("GALLERY");
  check("gallery: the image-link menu", M.last().kind === "imagelink", M.last().kind);
  check("gallery: flipped left, as on the board (1054, 452)", Math.abs(st.rect.left - 1054) <= 1 && Math.abs(st.rect.top - 452) <= 1, st.rect);
  const r1 = M.menus().view.rowElement(1).getBoundingClientRect();
  M.mouse(r1.left + 60, r1.top + 17, { type: "mousemove" });
  await sleep(200);
  log("gallery: backdrop luma", menuEl().dataset.luma, "raised", M.state().classes.includes("t-raised"));
  await capture("look-gallery");
  await close();
});
