// Design-fidelity review, scene A: the HomeBrowse board (light bar over an article) at 1440x900,
// with every measurable value dumped as DUMP lines, plus hover, tooltip, dark, busy and text pages.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const R = (el) => { const r = el.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async () => { await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "settle" }); await sleep(150); };
  const inner = async (w, h) => {
    window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
    window.moveTo(30, 30);
    await sleep(500);
    if (window.innerWidth !== w || window.innerHeight !== h) {
      window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
      await sleep(400);
    }
  };
  const go = async (url, t = b.active()) => {
    b.navigate(t, url);
    await waitFor(() => t.url.startsWith(url.slice(0, 24)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(700);
    await settled();
  };
  const pointer = (target, y) => {
    if (typeof target === "number") spike.EU.synthesizeMouseAtPoint(target, y, { type: "mousemove" }, window);
    else spike.EU.synthesizeMouseAtCenter(target, { type: "mousemove" }, window);
  };
  const glassOf = (el) => ({
    rect: R(el),
    radius: cs(el).borderTopLeftRadius,
    shadow: cs(el).boxShadow,
    lens: cs(el.querySelector(":scope > .lens")).backdropFilter,
    tint: cs(el.querySelector(":scope > .tint")).backgroundImage + " / " + cs(el.querySelector(":scope > .tint")).backgroundColor,
    rim: cs(el.querySelector(":scope > .rim")).backgroundImage,
  });
  const svgOf = (el) => { const s = el.querySelector("svg"); return s ? { rect: R(s), stroke: cs(s).stroke, sw: cs(s).strokeWidth, attrW: s.getAttribute("width"), color: cs(s).color } : null; };
  const barDump = (name) => {
    const items = [...document.querySelectorAll("#vitre-bar .item:not(.leaving)")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left);
    const out = { inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio, theme: b.theme(), rootClass: b.root.className, items: [] };
    for (const it of items) {
      const kind = it.classList.contains("plus") ? "plus" : it.classList.contains("active") ? "pill" : "circle";
      const o = { kind, cls: it.className, ...glassOf(it) };
      if (kind === "pill") {
        const q = (s) => it.querySelector(s);
        o.back = { rect: R(q(".back")), svg: svgOf(q(".back")), color: cs(q(".back")).color, vis: cs(q(".back")).visibility };
        o.forward = { rect: R(q(".forward")), svg: svgOf(q(".forward")), color: cs(q(".forward")).color };
        o.reload = { rect: R(q(".reload")), svg: svgOf(q(".reload")), color: cs(q(".reload")).color };
        o.address = { rect: R(q(".address")), font: cs(q(".address")).fontFamily, size: cs(q(".address")).fontSize, weight: cs(q(".address")).fontWeight, color: cs(q(".address")).color, gap: cs(q(".address")).columnGap };
        o.host = { rect: R(q(".host")), text: q(".host").textContent };
        const fav = q(".address .fav");
        o.fav = { rect: R(fav), child: fav.firstElementChild ? { tag: fav.firstElementChild.localName, rect: R(fav.firstElementChild), tone: fav.dataset.tone || "" } : null };
        o.accessories = R(q(".accessories"));
        o.loadLine = { rect: R(q(".load-line")), bg: cs(q(".load-line")).backgroundColor };
      } else if (kind === "circle") {
        const fav = it.querySelector(".circle-face .fav");
        o.fav = { rect: R(fav), child: fav.firstElementChild ? { tag: fav.firstElementChild.localName, rect: R(fav.firstElementChild), tone: fav.dataset.tone || "", bg: cs(fav.firstElementChild).backgroundColor, color: cs(fav.firstElementChild).color, stroke: cs(fav.firstElementChild).stroke } : null };
        o.tip = it.querySelector(".circle-face").dataset.tip;
      } else {
        o.svg = svgOf(it);
        o.faceColor = cs(it.querySelector(".face")).color;
      }
      out.items.push(o);
    }
    out.rows = [...document.querySelectorAll("#vitre-bar .row-lens")].map((r) => ({ rect: R(r), filter: cs(r).backdropFilter }));
    const wc = document.getElementById("vitre-winctl");
    out.winctl = { ...glassOf(wc), buttons: [...wc.querySelectorAll("button")].map((x) => ({ id: x.id, rect: R(x), svg: svgOf(x), color: cs(x).color })) };
    out.barTransition = cs(document.getElementById("vitre-bar")).transition;
    out.itemTransition = cs(items[0]).transition;
    out.rootFont = { family: cs(b.root).fontFamily, size: cs(b.root).fontSize };
    dump(name, out);
    return out;
  };
  const filterDump = (name) => {
    const fs = [...document.querySelectorAll("#vitre-glass-defs filter")].map((f) => ({ id: f.id, w: f.getAttribute("width"), h: f.getAttribute("height"), nodes: f.getAttribute("data-nodes"), blur: f.querySelector("feGaussianBlur")?.getAttribute("stdDeviation"), offs: [...f.querySelectorAll("feOffset")].slice(0, 12).map((o) => [o.getAttribute("x"), o.getAttribute("y"), o.getAttribute("width"), o.getAttribute("height"), o.getAttribute("dx"), o.getAttribute("dy")].join(",")) }));
    dump(name, fs);
  };

  await inner(1440, 900);
  await spike.activate();
  log("inner " + window.innerWidth + "x" + window.innerHeight + " outer " + window.outerWidth + "x" + window.outerHeight);

  // ---- scene 1: the HomeBrowse board ----
  await go(site("fieldnotes", "/article"));
  const first = b.active();
  const urls = [site("tideline", "/tideline"), site("refract", "/refract"), site("code", "/shell"), site("longexposure", "/club")];
  for (const u of urls) b.newTab(u, { background: true, index: b.tabs.length });
  await waitFor(() => b.tabs.length === 5 && b.tabs.every((t) => !t.loading && t.favicon), { timeout: 30000, what: "tabs" });
  b.newTab(undefined, { background: true, index: b.tabs.length }); // Home
  await sleep(1200);
  await settled();
  // the board scrolls the article 76 px
  await b.page(first).query("core:scroll").catch(() => null);
  first.browser.messageManager?.loadFrameScript?.("data:,content.scrollTo(0,76)", false);
  await sleep(500);
  dump("tabs", b.tabs.map((t) => ({ url: t.url, title: t.title, kind: t.kind, fav: (t.favicon || "").slice(0, 50), theme: t.theme })));
  barDump("browse-light");
  filterDump("filters-light");
  await spike.capture("a1-browse-light");

  // hover a circle (the board hovers vitre-shell): wash, badge, tooltip
  const items = [...document.querySelectorAll("#vitre-bar .item.tab:not(.active)")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left);
  const shellItem = items[2];
  const face = shellItem.querySelector(".circle-face");
  pointer(face);
  await sleep(900);
  const tipEl = document.querySelector("#layer-tips .vitre-tip");
  const badge = shellItem.querySelector(".close-badge");
  dump("hover-circle", {
    faceBg: cs(face).backgroundColor,
    itemShadow: cs(shellItem).boxShadow,
    tint: cs(shellItem.querySelector(":scope > .tint")).backgroundImage,
    badge: { rect: R(badge), bg: cs(badge).backgroundColor, shadow: cs(badge).boxShadow, svg: svgOf(badge) },
    tip: { hidden: tipEl.hidden, rect: R(tipEl), text: tipEl.textContent, font: cs(tipEl).font, fontSize: cs(tipEl).fontSize, family: cs(tipEl).fontFamily, pad: cs(tipEl).paddingLeft, radius: cs(tipEl).borderTopLeftRadius, bg: cs(tipEl).backgroundColor, shadow: cs(tipEl).boxShadow, item: R(shellItem) },
  });
  await spike.capture("a2-hover-circle");
  pointer(700, 500);
  await sleep(200);
  // tooltip with a key
  const back = document.querySelector("#vitre-bar .item.active .back");
  pointer(back);
  await sleep(900);
  dump("tip-back", { rect: R(tipEl), text: tipEl.querySelector(".t").textContent, key: tipEl.querySelector(".k").textContent, keyColor: cs(tipEl.querySelector(".k")).color, gap: cs(tipEl).columnGap, backBg: cs(back).backgroundColor });
  await spike.capture("a3-tip-back");
  pointer(700, 500);
  await sleep(200);
  // window control hover (minimize and close)
  const min = document.getElementById("vitre-win-min");
  pointer(min);
  await sleep(200);
  dump("hover-min", { bg: cs(min).backgroundColor, tipHidden: tipEl.hidden, radius: cs(min).borderTopLeftRadius + " " + cs(min).borderTopRightRadius });
  await sleep(800);
  dump("hover-min-tip", { tipHidden: tipEl.hidden, text: tipEl.textContent });
  await spike.capture("a4-hover-min");
  pointer(700, 500);
  await sleep(200);

  // ---- scene 2: text page (how the glass treats text) ----
  await go(site("refract", "/text"));
  barDump("text-light");
  await spike.capture("a5-text-light");

  // ---- scene 3: dark page ----
  await go(site("code", "/dark"));
  barDump("browse-dark");
  await spike.capture("a6-browse-dark");
  pointer(face);
  await sleep(900);
  dump("hover-circle-dark", { faceBg: cs(face).backgroundColor });
  await spike.capture("a7-hover-dark");
  pointer(700, 500);
  await sleep(200);

  // ---- scene 4: busy colourful page ----
  await go(site("longexposure", "/busy"));
  barDump("browse-busy");
  await spike.capture("a8-browse-busy");

  // ---- scene 5: stripes (glass strength) ----
  await go(site("tideline", "/stripes"));
  barDump("browse-stripes");
  await spike.capture("a9-stripes");

  // ---- scene 6: loading state (load line + Stop) ----
  await go(site("fieldnotes", "/article"));
  const t = b.active();
  // fake a load state through the model for the look only
  const pillEl = document.querySelector("#vitre-bar .item.active");
  pillEl.classList.add("loading");
  await sleep(700);
  const line = pillEl.querySelector(".load-line");
  dump("load-line", { rect: R(line), bg: cs(line).backgroundColor, anim: cs(line).animationName + " " + cs(line).animationDuration + " " + cs(line).animationTimingFunction, radius: cs(line).borderTopLeftRadius, pill: R(pillEl) });
  await spike.capture("a10-loading");
  pillEl.classList.remove("loading");
});
