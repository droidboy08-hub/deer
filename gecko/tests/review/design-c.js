// Design-fidelity review, scene C: the Home and HomeSearch boards at 1440x900 (clear glass over a
// dark photo), then the address field over a light and a dark page. Everything measurable is dumped.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const out = Services.env.get("VITRE_OUT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const R = (el) => { const r = el.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async () => { await waitFor(() => b.bar.state.settled, { timeout: 6000, what: "settle" }); await sleep(150); };
  const inner = async (w, h) => {
    window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight));
    window.moveTo(30, 30);
    await sleep(500);
  };
  const go = async (url, t = b.active()) => {
    b.navigate(t, url);
    await waitFor(() => t.url.startsWith(url.slice(0, 24)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(700);
    await settled();
  };
  const glassOf = (el) => ({
    rect: R(el),
    radius: cs(el).borderTopLeftRadius,
    shadow: cs(el).boxShadow,
    lens: cs(el.querySelector(":scope > .lens")).backdropFilter,
    tint: cs(el.querySelector(":scope > .tint")).backgroundImage + " / " + cs(el.querySelector(":scope > .tint")).backgroundColor,
    rim: cs(el.querySelector(":scope > .rim")).backgroundImage,
  });
  const $ = (id) => document.getElementById(id);
  const omniDump = (name) => {
    const field = $("vitre-omni-field");
    const panel = $("vitre-omni-panel");
    const input = b.omni.input;
    const icon = field.querySelector(".omni-icon svg");
    const o = {
      theme: b.theme(),
      field: glassOf(field),
      fieldTransition: cs(field).transition,
      row: { pad: cs(field.querySelector(".omni-row")).paddingLeft, gap: cs(field.querySelector(".omni-row")).columnGap },
      icon: { rect: R(icon), stroke: cs(icon).stroke, sw: cs(icon).strokeWidth },
      input: { rect: R(input), value: input.value, sel: [input.selectionStart, input.selectionEnd], font: cs(input).fontSize + " " + cs(input).fontWeight + " " + cs(input).fontFamily, color: cs(input).color, caret: cs(input).caretColor, placeholder: input.placeholder },
      scrim: { bg: cs($("vitre-omni-scrim")).backgroundColor, opacity: cs($("vitre-omni-scrim")).opacity, transition: cs($("vitre-omni-scrim")).transition },
      barItemsOpacity: [...document.querySelectorAll("#vitre-bar .item")].map((el) => cs(el).opacity).join(","),
      winctl: glassOf($("vitre-winctl")),
      panelHidden: panel.hidden,
    };
    if (!panel.hidden) {
      o.panel = { ...glassOf(panel), pad: [cs(panel).paddingTop, cs(panel).paddingRight, cs(panel).paddingBottom, cs(panel).paddingLeft].join(" "), fontSize: cs(panel).fontSize };
      o.rows = [...panel.querySelectorAll(".omni-group, .omni-item")].map((el) => {
        if (el.classList.contains("omni-group")) return { group: el.textContent, rect: R(el), margin: cs(el).margin, color: cs(el).color, font: cs(el).fontSize + "/" + cs(el).lineHeight };
        const g = el.querySelector(".omni-glyph");
        const gi = g.firstElementChild;
        return {
          rect: R(el), selected: el.classList.contains("selected"), bg: cs(el).backgroundColor, shadow: cs(el).boxShadow, radius: cs(el).borderTopLeftRadius, color: cs(el).color, font: cs(el).fontSize + " " + cs(el).fontWeight,
          glyph: { tag: gi.localName, rect: R(gi), stroke: cs(gi).stroke },
          title: el.querySelector(".omni-title").textContent, detail: el.querySelector(".omni-detail").textContent, detailColor: cs(el.querySelector(".omni-detail")).color,
          tail: el.querySelector(".omni-tail") ? { text: el.querySelector(".omni-tail").textContent, color: cs(el.querySelector(".omni-tail")).color, font: cs(el.querySelector(".omni-tail")).fontSize, svg: R(el.querySelector(".omni-tail svg")) } : null,
        };
      });
    }
    dump(name, o);
    return o;
  };

  // a dark photo-like picture (like the board's lake at dusk)
  async function picture(name, w, h) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#27303f");
    sky.addColorStop(0.45, "#8a5a54");
    sky.addColorStop(0.55, "#3b3f4c");
    sky.addColorStop(1, "#14181f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e8e3da";
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo((w / 14) * i - 60, h * 0.5); ctx.lineTo((w / 14) * i + 90, h * (0.18 + (i % 4) * 0.06)); ctx.lineTo((w / 14) * i + 260, h * 0.5); ctx.fill(); }
    ctx.fillStyle = "#11151b";
    for (let i = 0; i < 60; i++) ctx.fillRect((w / 60) * i, h * 0.02 + ((i * 37) % 50), 6, 60 + ((i * 53) % 90));
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const path = PathUtils.join(out, name);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }

  await inner(1440, 900);
  await spike.activate();
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const day = 86400000;
  const visit = (url, title, n = 1, ago = 1) => ({ url, title, visits: Array.from({ length: n }, (_, i) => ({ date: new Date(Date.now() - ago * day - i * 3600000) })) });
  await PlacesUtils.history.insertMany([
    visit(site("fieldnotes", "/archive"), "Archive", 4, 2),
    visit(site("fieldnotes", "/ice"), "The quiet science of ice", 3, 3),
    visit("https://www.fields-institute.example/medal", "Fields medal", 1, 9),
  ]);
  const dark = await picture("c-home-dark.jpg", 1920, 1200);
  const settings = b.sys("VitreSettings");
  settings.set({ homeBackground: { kind: "image", path: dark } });

  await go(site("fieldnotes", "/article"));
  const first = b.active();
  for (const u of [site("tideline", "/tideline"), site("refract", "/refract"), site("code", "/shell"), site("longexposure", "/club")]) b.newTab(u, { background: true, index: b.tabs.length });
  await waitFor(() => b.tabs.length === 5 && b.tabs.every((t) => !t.loading && t.favicon), { timeout: 30000, what: "tabs" });
  const home = b.newTab(undefined, { index: b.tabs.length });
  await waitFor(() => b.active().kind === "home" && b.active().browser.contentDocument?.documentElement.dataset.state === "ready", { timeout: 15000, what: "home" });
  if (b.omni.open) b.omni.close();
  await sleep(1200);
  await settled();

  // ---- Home, idle ----
  const pill = document.querySelector("#vitre-bar .item.active");
  const addr = pill.querySelector(".address");
  const favSvg = addr.querySelector(".fav svg");
  const circles = [...document.querySelectorAll("#vitre-bar .item.tab:not(.active)")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left);
  dump("home-idle", {
    theme: b.theme(), homeData: { ...b.active().browser.contentDocument.documentElement.dataset },
    pill: glassOf(pill),
    address: { rect: R(addr), cls: addr.className, color: cs(addr).color, size: cs(addr).fontSize, weight: cs(addr).fontWeight, gap: cs(addr).columnGap, text: addr.textContent },
    icon: { rect: R(favSvg), stroke: cs(favSvg).stroke },
    host: R(addr.querySelector(".host")),
    nav: [...pill.querySelectorAll(".back,.forward,.reload")].map((n) => cs(n).visibility + ":" + R(n).join("/")),
    circles: circles.map((c) => ({ rect: R(c), shadow: cs(c).boxShadow, tone: c.querySelector(".fav").dataset.tone || "", img: R(c.querySelector(".fav").firstElementChild), imgBg: cs(c.querySelector(".fav").firstElementChild).backgroundColor })),
    plus: { rect: R(document.querySelector("#vitre-bar .plus")), color: cs(document.querySelector("#vitre-bar .plus .face")).color },
    winctl: glassOf($("vitre-winctl")),
    winColor: cs($("vitre-win-min")).color,
    bodyChildren: [...b.active().browser.contentDocument.body.children].map((e) => e.localName + "#" + e.id),
  });
  await spike.capture("c1-home-idle");

  // ---- HomeSearch: type "fie" ----
  b.editAddress();
  await sleep(500);
  omniDump("omni-home-empty");
  await spike.capture("c2-home-field-empty");
  spike.type("fie");
  await sleep(700);
  omniDump("omni-home-fie");
  await spike.capture("c3-home-search-fie");
  spike.press("Down");
  await sleep(150);
  omniDump("omni-home-fie-down");
  await spike.capture("c4-home-search-down");
  spike.press("Escape");
  await sleep(200);
  spike.press("Escape");
  await sleep(400);

  // ---- field over a light page ----
  b.activate(first);
  await sleep(900);
  await settled();
  b.editAddress();
  await sleep(600);
  omniDump("omni-light-open");
  await spike.capture("c5-light-field-open");
  spike.type("fie");
  await sleep(700);
  omniDump("omni-light-fie");
  await spike.capture("c6-light-field-fie");
  b.omni.close();
  await sleep(400);

  // ---- field over a dark page ----
  await go(site("code", "/dark"));
  b.editAddress();
  await sleep(600);
  spike.type("fie");
  await sleep(700);
  omniDump("omni-dark-fie");
  await spike.capture("c7-dark-field-fie");
  b.omni.close();
  await sleep(300);

  // ---- growing: slow the field's transition and capture half-way ----
  await go(site("fieldnotes", "/article"));
  const slow = document.createElement("style");
  slow.textContent = "#vitre-root #vitre-omni-field { transition-duration: 4s !important; } #vitre-bar .item { transition-duration: 4s !important; }";
  document.documentElement.append(slow);
  b.editAddress();
  await sleep(900);
  dump("omni-growing", { field: R($("vitre-omni-field")), cls: $("vitre-omni-field").className, lens: cs($("vitre-omni-field").querySelector(".lens")).backdropFilter, pillOpacity: cs(document.querySelector("#vitre-bar .item.active")).opacity });
  await spike.capture("c8-growing");
  slow.remove();
  b.omni.close();
  await sleep(300);

  // ---- "none" background ----
  settings.set({ homeBackground: { kind: "none", path: "" } });
  b.activate(home);
  await sleep(1200);
  if (b.omni.open) b.omni.close();
  await sleep(600);
  dump("home-none", { theme: b.theme(), bg: cs(b.active().browser.contentDocument.body).backgroundColor, bgImage: cs(b.active().browser.contentDocument.body).backgroundImage });
  await spike.capture("c9-home-none");
});
