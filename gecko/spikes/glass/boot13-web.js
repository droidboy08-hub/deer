// Spike glass: the content-side lens on a REAL web page in a web content process (not file://),
// first through the frame script, then through a JSWindowActor (the production shape).
/* global spike, G, gBrowser, Services, document, window, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const browser = gBrowser.selectedBrowser;
  const L = G.layer();
  let url = "https://en.wikipedia.org/wiki/Stained_glass";
  await G.go(url);
  await spike.sleep(2500);
  if (!browser.currentURI.spec.startsWith("https://en.wikipedia.org")) {
    url = "https://example.com/";
    await G.go(url);
  }
  spike.log("loaded", browser.currentURI.spec, "remoteType", browser.remoteType, "title", browser.contentTitle);

  // Light glass bar: lens in content, tint/rim/shadow/labels in the parent.
  G.css(`
    .vg { position:absolute; border-radius:22px; box-shadow: 0 10px 28px rgba(40,30,15,0.14), 0 1px 2px rgba(40,30,15,0.18); font:500 13.5px 'Segoe UI Variable Text','Segoe UI',sans-serif; color:#16181d; display:flex; align-items:center; justify-content:center; }
    .vg > div { position:absolute; inset:0; border-radius:inherit; }
    .vg > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.22)); }
    .vg > .rim { padding:1px; background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 30%, rgba(255,255,255,0.2) 60%, rgba(255,255,255,0.8));
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
    .vg > span { position:relative; }
  `);
  const items = [];
  let x = 190;
  for (let i = 0; i < 6; i++) {
    if (i === 3) {
      items.push([x, 12, 480, 44, "en.wikipedia.org"]);
      x += 488;
    }
    items.push([x, 12, 44, 44, ""]);
    x += 52;
  }
  items.push([1160, 18, 108, 32, "–  □  ✕"]);
  const pill = G.stripLensMarkup("pill", 480, 44, { blur: 2.4, diag: false });
  const circle = G.stripLensMarkup("circle", 44, 44, { diag: false });
  const cap = G.stripLensMarkup("cap", 108, 32, { diag: false });
  let html = `<svg style="position:fixed;width:0;height:0"><defs>${pill.markup}${circle.markup}${cap.markup}</defs></svg>`;
  for (const [ix, iy, w, h, label] of items) {
    html += `<div style="position:fixed; left:${ix}px; top:${iy}px; width:${w}px; height:${h}px; border-radius:${h / 2}px; backdrop-filter:url(#${w === 480 ? "pill" : w === 44 ? "circle" : "cap"});"></div>`;
    const g = G.el("div", `left:${ix}px; top:${iy}px; width:${w}px; height:${h}px; border-radius:${h / 2}px;`, L);
    g.className = "vg";
    G.el("div", "", g).className = "tint";
    G.el("div", "", g).className = "rim";
    G.el("span", "", g, label);
  }

  // 1. Frame script route.
  const C = await G.contentGlass();
  spike.log("frame script set ->", await C.set(html));
  await spike.sleep(800);
  await spike.capture("web-framescript");
  spike.log("scroll ->", await C.scroll(900));
  await spike.sleep(700);
  await spike.capture("web-framescript-scrolled");
  await C.set("");

  // 2. JSWindowActor route. The child module is read by the CONTENT process: from this spike folder
  // (resource://vitre-boot/, a plain directory outside the app) a sandboxed web process may refuse it.
  try {
    ChromeUtils.registerWindowActor("VitreGlass", {
      child: { esModuleURI: "resource://vitre-boot/GlassChild.sys.mjs", events: { DOMContentLoaded: {} } },
      messageManagerGroups: ["browsers"],
    });
    const actor = browser.browsingContext.currentWindowGlobal.getActor("VitreGlass");
    const res = await Promise.race([actor.sendQuery("Set", { html }), new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))]);
    spike.log("actor Set (web process) ->", res);
  } catch (e) {
    spike.log("actor route failed in web process:", String(e));
  }
  await spike.sleep(700);
  await spike.capture("web-actor");

  // Same actor on a file:// page (file content process can read the spike folder).
  try {
    await G.go(G.sibling("page.html") + "?noanim=1");
    const actor = browser.browsingContext.currentWindowGlobal.getActor("VitreGlass");
    const res = await Promise.race([actor.sendQuery("Set", { html }), new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))]);
    spike.log("actor Set (file process) ->", res);
  } catch (e) {
    spike.log("actor route failed in file process:", String(e));
  }
  await spike.sleep(700);
  await spike.capture("file-actor");
});
