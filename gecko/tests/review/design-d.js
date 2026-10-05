// Design-fidelity review, scene D: many tabs, narrow windows, maximized, private and popup
// windows, favicon plates, reduced motion, auto-hide, history-row icons.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
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
    await settled(win);
  };
  const go = async (url, t = b.active()) => {
    b.navigate(t, url);
    await waitFor(() => t.url.startsWith(url.slice(0, 24)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(700);
    await settled();
  };
  const layout = (win = window) => {
    const d = win.document;
    const items = [...d.querySelectorAll("#vitre-bar .item:not(.leaving)")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left);
    const wc = d.getElementById("vitre-winctl");
    const priv = d.getElementById("vitre-private");
    return {
      inner: [win.innerWidth, win.innerHeight],
      tabs: win.vitre.tabs.length,
      state: win.vitre.bar.state,
      items: items.map((it) => (it.classList.contains("plus") ? "+" : it.classList.contains("active") ? "P" : "c") + R(it).join("/")),
      winctl: R(wc),
      priv: priv ? { rect: R(priv), text: priv.textContent, font: win.getComputedStyle(priv).fontSize + " " + win.getComputedStyle(priv).fontWeight, color: win.getComputedStyle(priv).color } : null,
      gapToWinctl: +(R(wc)[0] - Math.max(...items.map((it) => it.getBoundingClientRect().right))).toFixed(1),
      favSizes: [...new Set(items.filter((it) => !it.classList.contains("active") && !it.classList.contains("plus")).map((it) => { const f = it.querySelector(".circle-face .fav").firstElementChild; return f ? R(f).slice(2).join("x") : "none"; }))],
    };
  };

  await inner(1440, 900);
  await spike.activate();
  await go(site("fieldnotes", "/article"));
  const first = b.active();

  // ---- 1. favicon plates on light and dark glass ----
  for (const u of [site("mark", "/white-mark"), site("ink", "/dark-mark"), site("plain", "/noicon"), site("tideline", "/tideline")]) b.newTab(u, { background: true, index: b.tabs.length });
  await waitFor(() => b.tabs.length === 5 && b.tabs.every((t) => !t.loading), { timeout: 30000, what: "tabs" });
  await sleep(1500);
  await settled();
  const plates = () => [...document.querySelectorAll("#vitre-bar .item.tab:not(.active)")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left).map((it) => { const fav = it.querySelector(".circle-face .fav"); const c = fav.firstElementChild; return { tip: it.querySelector(".circle-face").dataset.tip, tone: fav.dataset.tone || "", tag: c.localName, rect: R(c), bg: cs(c).backgroundColor, radius: cs(c).borderTopLeftRadius, pad: cs(c).paddingTop }; });
  dump("plates-light", plates());
  await spike.capture("d1-plates-light");
  await go(site("code", "/dark"));
  dump("plates-dark", plates());
  await spike.capture("d2-plates-dark");
  // a white-mark tab as the ACTIVE pill on a light page
  b.activate(b.tabs[1]);
  await sleep(1200);
  await settled();
  const pf = document.querySelector("#vitre-bar .item.active .address .fav");
  dump("plate-in-pill", { theme: b.theme(), tone: pf.dataset.tone || "", rect: R(pf.firstElementChild), bg: cs(pf.firstElementChild).backgroundColor });
  await spike.capture("d3-plate-in-pill");
  b.activate(first);
  await sleep(600);
  await go(site("fieldnotes", "/article"));

  // ---- 2. history rows: do they show the site's icon? ----
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  await sleep(1500);
  const iconInfo = [];
  for (const t of b.tabs) {
    let stored = null;
    try {
      const f = await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(t.url));
      stored = f ? (f.uri?.spec || String(f.dataURI || "")).slice(0, 60) : null;
    } catch (e) {
      stored = "ERR " + e;
    }
    iconInfo.push({ url: t.url, tabFavicon: (t.favicon || "").slice(0, 40), placesIcon: stored });
  }
  dump("places-icons", iconInfo);
  b.editAddress();
  await sleep(900);
  const rows = [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((el) => { const img = el.querySelector(".omni-glyph img"); return { title: el.querySelector(".omni-title").textContent, src: img ? img.src.slice(0, 70) : "svg", natural: img ? [img.naturalWidth, img.naturalHeight] : null }; });
  dump("history-row-icons", rows);
  await spike.capture("d4-history-row-icons");
  b.omni.close();
  await sleep(300);

  // ---- 3. many tabs ----
  const fill = async (n) => {
    while (b.tabs.length > n) b.closeTab(b.tabs[b.tabs.length - 1]);
    const hosts = ["tideline", "refract", "code", "longexposure"];
    const paths = ["/tideline", "/refract", "/shell", "/club"];
    for (let i = b.tabs.length; i < n; i++) b.newTab(site(hosts[i % 4] + i, paths[i % 4]), { background: true, index: i });
    await waitFor(() => b.tabs.length === n && b.tabs.every((t) => !t.loading), { timeout: 40000, what: n + " tabs" });
    await sleep(800);
    await settled();
  };
  for (const n of [8, 12, 16, 20, 30]) {
    await fill(n);
    dump("many-" + n + "-1440", layout());
    await spike.capture("d5-many-" + n + "-1440");
  }
  // active in the middle with 30 tabs
  b.activate(b.tabs[15]);
  await sleep(900);
  await settled();
  dump("many-30-mid-1440", layout());
  await spike.capture("d6-many-30-mid-1440");
  b.activate(first);
  await sleep(900);
  await inner(1000, 700);
  dump("many-30-1000", layout());
  await spike.capture("d7-many-30-1000");
  await fill(12);
  dump("many-12-1000", layout());
  await spike.capture("d8-many-12-1000");

  // ---- 4. narrow windows ----
  await fill(3);
  for (const [w, h] of [[900, 600], [700, 500], [560, 420], [480, 360]]) {
    await inner(w, h);
    dump("narrow-" + w, layout());
    await spike.capture("d9-narrow-" + w);
  }
  await inner(560, 420);
  b.editAddress();
  await sleep(600);
  spike.type("fie");
  await sleep(600);
  dump("narrow-560-omni", { field: R(document.getElementById("vitre-omni-field")), panel: R(document.getElementById("vitre-omni-panel")), winctl: R(document.getElementById("vitre-winctl")) });
  await spike.capture("d10-narrow-560-omni");
  b.omni.close();
  await inner(1440, 900);

  // ---- 5. reduced motion ----
  const item = document.querySelector("#vitre-bar .item.active");
  const normal = { item: cs(item).transition, bar: cs(document.getElementById("vitre-bar")).transition, winctl: cs(document.getElementById("vitre-winctl")).transition, pillFace: cs(item.querySelector(".pill-face")).transition, badge: cs(item.querySelector(".close-badge")).transition, tip: cs(document.querySelector("#layer-tips .vitre-tip")).transition, scrim: cs(document.getElementById("vitre-omni-scrim")).transition, field: cs(document.getElementById("vitre-omni-field")).transition };
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await waitFor(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, { what: "reduced motion" });
  const reduced = { item: cs(item).transition, bar: cs(document.getElementById("vitre-bar")).transition, winctl: cs(document.getElementById("vitre-winctl")).transition, pillFace: cs(item.querySelector(".pill-face")).transition, badge: cs(item.querySelector(".close-badge")).transition, tip: cs(document.querySelector("#layer-tips .vitre-tip")).transition, scrim: cs(document.getElementById("vitre-omni-scrim")).transition, field: cs(document.getElementById("vitre-omni-field")).transition, entering: null };
  // what an entering / leaving item does under reduced motion
  const nt = b.newTab(site("tideline", "/tideline"), { background: true });
  const ni = b.bar.item(nt.id);
  reduced.entering = { transform: cs(ni).transform, opacity: cs(ni).opacity, transition: cs(ni).transition };
  await sleep(400);
  b.closeTab(nt);
  await sleep(30);
  const leaving = document.querySelector("#vitre-bar .item.leaving");
  reduced.leaving = leaving ? { transform: cs(leaving).transform, opacity: cs(leaving).opacity } : null;
  dump("motion", { normal, reduced });
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await sleep(600);

  // ---- 6. auto-hide ----
  b.sys("VitreSettings").set({ barAutoHide: true });
  spike.EU.synthesizeMouseAtPoint(700, 500, { type: "mousemove" }, window);
  await sleep(1500);
  dump("autohide-hidden", { cls: b.root.className, bar: cs(document.getElementById("vitre-bar")).transform + " op " + cs(document.getElementById("vitre-bar")).opacity, winctl: R(document.getElementById("vitre-winctl")), winctlOpacity: cs(document.getElementById("vitre-winctl")).opacity });
  await spike.capture("d11-autohide-hidden");
  spike.EU.synthesizeMouseAtPoint(700, 10, { type: "mousemove" }, window);
  await sleep(900);
  dump("autohide-revealed", { cls: b.root.className, bar: cs(document.getElementById("vitre-bar")).transform + " op " + cs(document.getElementById("vitre-bar")).opacity });
  await spike.capture("d12-autohide-revealed");
  b.sys("VitreSettings").set({ barAutoHide: false });
  spike.EU.synthesizeMouseAtPoint(700, 500, { type: "mousemove" }, window);
  await sleep(800);

  // ---- 7. maximized ----
  window.maximize();
  await sleep(1200);
  await settled();
  dump("maximized", { ...layout(), drag: R(document.getElementById("vitre-drag")), max: document.getElementById("vitre-win-max").getAttribute("aria-label") });
  await spike.capture("d13-maximized");
  window.restore();
  await sleep(900);
  await inner(1440, 900);

  // ---- 8. private window ----
  const priv = await spike.openWindow({ private: true });
  await sleep(1500);
  await inner(1440, 900, priv);
  await priv.spike.activate();
  dump("private", { ...layout(priv), url: priv.vitre.active().url, kind: priv.vitre.active().kind, theme: priv.vitre.theme(), pill: priv.document.querySelector("#vitre-bar .item.active .host").textContent });
  await priv.spike.capture("d14-private");
  priv.vitre.navigate(priv.vitre.active(), site("fieldnotes", "/article"));
  await sleep(2500);
  await settled(priv);
  dump("private-page", { ...layout(priv), theme: priv.vitre.theme() });
  await priv.spike.capture("d15-private-page");
  priv.close();
  await sleep(800);

  // ---- 9. popup window ----
  const known = new Set(Services.wm.getEnumerator("navigator:browser"));
  window.openDialog("chrome://browser/content/browser.xhtml", "_blank", "chrome,dialog=no,width=640,height=420,location=yes,resizable=yes", site("fieldnotes", "/article"));
  const popup = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => !known.has(w)), { timeout: 10000, what: "popup window" });
  await waitFor(() => popup.vitre?.ready && popup.vitre.tabs.length === 1 && !popup.vitre.tabs[0].loading && popup.vitre.tabs[0].url.startsWith("http"), { timeout: 15000, what: "popup ready" });
  await sleep(1500);
  await settled(popup);
  const pp = popup.document.querySelector("#vitre-bar .item.active");
  dump("popup", { ...layout(popup), address: { rect: R(pp.querySelector(".address")), pad: popup.getComputedStyle(pp.querySelector(".address")).paddingLeft, text: pp.querySelector(".host").textContent, fav: R(pp.querySelector(".address .fav")) }, theme: popup.vitre.theme() });
  await popup.spike.capture("d16-popup");
  popup.close();
  await sleep(500);
});
