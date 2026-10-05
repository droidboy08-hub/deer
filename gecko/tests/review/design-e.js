// Design-fidelity review, probe E: the font really used, window titles, the error page, history-row
// icons, the zoom flash, keyboard focus rings, the pill for odd URLs.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, InspectorUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const R = (el) => { const r = el.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async (win = window) => { await waitFor(() => win.vitre.bar.state.settled, { timeout: 6000, what: "settle" }); await sleep(150); };
  const inner = async (w, h, win = window) => {
    win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight));
    win.moveTo(30, 30);
    await sleep(600);
  };
  const go = async (url, t = b.active(), wait = 30000) => {
    b.navigate(t, url);
    await waitFor(() => !t.loading && t.url !== "about:blank", { timeout: wait, what: "load " + url }).catch((e) => log("NOTE " + e));
    await sleep(900);
    await settled();
  };
  const fontOf = (el) => {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      return InspectorUtils.getUsedFontFaces(range).map((f) => f.name + " [family " + f.CSSFamilyName + "]").join("; ");
    } catch (e) {
      return "ERR " + e;
    }
  };

  await inner(1440, 900);
  await spike.activate();
  await go(site("fieldnotes", "/article"));
  const first = b.active();
  b.newTab(site("tideline", "/tideline"), { background: true });
  await sleep(1500);
  await settled();

  // ---- fonts ----
  const pill = document.querySelector("#vitre-bar .item.active");
  const fonts = { host: fontOf(pill.querySelector(".host")), hostWeight: cs(pill.querySelector(".address")).fontWeight, title: document.title };
  // tooltip
  spike.EU.synthesizeMouseAtCenter(pill.querySelector(".back"), { type: "mousemove" }, window);
  await sleep(900);
  fonts.tip = fontOf(document.querySelector("#layer-tips .vitre-tip"));
  spike.EU.synthesizeMouseAtPoint(700, 500, { type: "mousemove" }, window);
  b.editAddress();
  await sleep(700);
  fonts.input = "(value font) " + cs(b.omni.input).fontFamily;
  const row = document.querySelector("#vitre-omni-list .omni-item");
  fonts.row = row ? fontOf(row) : "no row";
  const group = document.querySelector("#vitre-omni-list .omni-group");
  fonts.group = group ? fontOf(group) : "no group";
  const rows = [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((el) => { const img = el.querySelector(".omni-glyph img"); return { title: el.querySelector(".omni-title").textContent, src: img ? img.src.slice(0, 60) : "svg" }; });
  dump("fonts", fonts);
  dump("history-rows", rows);
  await spike.capture("e1-history-icons");
  b.omni.close();
  await sleep(300);
  const families = ["Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI Variable Display", "Segoe UI Variable Small", "Segoe UI"];
  dump("font-check", families.map((f) => f + ": " + document.fonts.check(`13px "${f}"`)));

  // ---- window title ----
  dump("titles", { web: document.title });
  const home = b.newTab(undefined, {});
  await sleep(1500);
  if (b.omni.open) b.omni.close();
  await sleep(400);
  dump("titles-home", { home: document.title });
  b.closeTab(home);
  await sleep(600);

  // ---- zoom flash ----
  b.activate(first);
  await sleep(500);
  b.run("zoomIn");
  await sleep(250);
  dump("zoom-flash", { text: pill.querySelector(".host").textContent, fav: pill.querySelector(".address .fav") ? R(pill.querySelector(".address .fav")) : null });
  await spike.capture("e2-zoom-flash");
  b.run("zoomReset");
  await sleep(1800);

  // ---- keyboard focus ring on bar controls ----
  b.editAddress();
  await sleep(400);
  spike.press("Tab");
  await sleep(400);
  const ae = document.activeElement;
  dump("focus-1", { el: ae.className, outline: cs(ae).outline, pillOutline: cs(pill).outline, pillOffset: cs(pill).outlineOffset });
  await spike.capture("e3-focus-pill");
  spike.press("Right");
  await sleep(300);
  const ae2 = document.activeElement;
  dump("focus-2", { el: ae2.className, outline: cs(ae2).outline, offset: cs(ae2).outlineOffset, radius: cs(ae2).borderTopLeftRadius });
  await spike.capture("e4-focus-next");
  spike.press("Escape");
  await sleep(400);

  // ---- an address that fails ----
  await go("http://nothing-here.invalid/", b.active(), 20000);
  await sleep(1500);
  dump("error-page", { url: b.active().url, title: b.active().title, docTitle: document.title, host: pill.querySelector(".host").textContent, theme: b.theme(), docURI: b.active().browser.documentURI?.spec.slice(0, 80) });
  await spike.capture("e5-error-page");

  // ---- odd URLs in the pill ----
  await go("about:config");
  dump("about-config", { host: pill.querySelector(".host").textContent, title: document.title, theme: b.theme() });
  await spike.capture("e6-about-config");
  await go("view-source:" + site("fieldnotes", "/tideline"));
  dump("view-source", { host: pill.querySelector(".host").textContent, title: document.title });
  await go("about:blank");
  await sleep(500);
  dump("about-blank", { host: pill.querySelector(".host").textContent, cls: pill.className, title: document.title, theme: b.theme(), kind: b.active().kind });
  await spike.capture("e7-about-blank");

  // ---- F11 revealed ----
  await go(site("fieldnotes", "/article"));
  b.run("fullscreen");
  await sleep(1800);
  spike.EU.synthesizeMouseAtPoint(700, 300, { type: "mousemove" }, window);
  await sleep(1200);
  dump("f11-hidden", { cls: b.root.className, inner: [window.innerWidth, window.innerHeight], winctl: R(document.getElementById("vitre-winctl")), winT: cs(document.getElementById("vitre-winctl")).transform });
  await spike.capture("e8-f11-hidden");
  spike.EU.synthesizeMouseAtPoint(700, 5, { type: "mousemove" }, window);
  await sleep(1200);
  dump("f11-revealed", { cls: b.root.className, winctl: R(document.getElementById("vitre-winctl")), max: document.getElementById("vitre-win-max").getAttribute("aria-label") });
  await spike.capture("e9-f11-revealed");
  b.run("fullscreen");
  await sleep(1500);
});
