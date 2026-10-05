// Spike glass / diagnosis: why does backdrop-filter not show? Log the compositor, the gfx feature
// status, and compare a tile over chrome-drawn content with a tile over the remote browser.
/* global spike, G, gBrowser, Services, document, window, Cc, Ci, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const tag = Services.env.get("VITRE_TAG") || "default";
  if (Services.env.get("VITRE_HIDEUI") !== "0") G.hideFirefoxUI();
  await G.go(G.sibling("page.html"));
  const L = G.layer();

  const gfx = Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo);
  spike.log("layerManagerType", window.windowUtils.layerManagerType, "remote", window.windowUtils.layerManagerRemote);
  const feat = (name) => {
    try {
      return gfx.getFeatureStatus(Ci.nsIGfxInfo[name]) + " (1=ok)";
    } catch (e) {
      return "ERR " + e.message;
    }
  };
  for (const f of ["FEATURE_WEBRENDER", "FEATURE_WEBRENDER_COMPOSITOR", "FEATURE_BACKDROP_FILTER", "FEATURE_WEBRENDER_SOFTWARE", "FEATURE_DIRECT2D", "FEATURE_DIRECT3D_11_LAYERS"]) spike.log(f, feat(f));
  try {
    spike.log("adapter", gfx.adapterDescription, "driver", gfx.adapterDriverVersion, "vendor", gfx.adapterVendorID);
    const info = gfx.getInfo ? gfx.getInfo() : {};
    spike.log("gfxinfo", info);
  } catch (e) {
    spike.log("gfxinfo err", e.message);
  }
  try {
    const feats = gfx.getFeatures();
    spike.log("features", feats);
  } catch (e) {
    spike.log("features err", e.message);
  }
  try {
    const fl = gfx.getFeatureLog();
    const pick = fl.features.filter((f) => /WEBRENDER|BACKDROP|COMPOSIT|D3D11|HW_/.test(f.name)).map((f) => f.name + ":" + f.status);
    spike.log("featureLog", pick.join(" "));
  } catch (e) {
    spike.log("featureLog err", e.message);
  }
  for (const p of ["gfx.webrender.software", "gfx.webrender.all", "gfx.webrender.compositor", "gfx.webrender.compositor.force-enabled", "layout.css.backdrop-filter.force-enabled", "layers.acceleration.disabled"]) {
    const t = Services.prefs.getPrefType(p);
    spike.log("pref", p, t === 128 ? Services.prefs.getBoolPref(p) : t === 64 ? Services.prefs.getIntPref(p) : "(none)");
  }

  // Chrome-drawn busy strip at the top of the layer, with a tile half over it and half over the page.
  G.el("div", "position:absolute; left:0; top:0; width:640px; height:140px; background:repeating-linear-gradient(90deg,#e6194b 0 20px,#ffe119 20px 40px,#4363d8 40px 60px,#fff 60px 80px,#000 80px 100px);", L);
  G.el("div", "position:absolute; left:10px; top:4px; background:#fff; color:#000; padding:2px 8px; font-size:16px;", L, "CHROME-DRAWN STRIPES (parent process content)");
  const mk = (x, y, w, h, bf, label) => {
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:24px; outline:2px solid #000;`, L);
    t.style.backdropFilter = bf;
    G.el("div", "position:absolute; left:8px; bottom:4px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap;", t, label + " -> " + getComputedStyle(t).backdropFilter);
    return t;
  };
  mk(40, 40, 260, 200, "blur(10px)", "blur over chrome+page");
  mk(340, 40, 260, 200, "invert(1)", "invert over chrome+page");
  mk(700, 40, 260, 200, "blur(10px)", "blur over page only");
  mk(980, 40, 260, 200, "invert(1)", "invert over page only");
  // Same thing with an opaque-ish background and isolation variants.
  const a = mk(700, 300, 260, 160, "blur(10px)", "blur + rgba bg");
  a.style.background = "rgba(255,255,255,0.25)";
  const b = mk(980, 300, 260, 160, "invert(1)", "invert, will-change");
  b.style.willChange = "backdrop-filter";
  await spike.sleep(800);
  await spike.capture("diag-" + tag);
});
