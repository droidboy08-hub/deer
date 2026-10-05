// Verify the untested part of the Home recipe: read the user's Windows wallpaper path (read-only
// registry query, as the Electron version does), draw it in the chrome layer as the Home background,
// and put glass with parent backdrop-filter on top (chrome-drawn backdrop: no surface root needed).
/* global spike, G, gBrowser, Services, document, window, Cc, Ci, IOUtils, PathUtils, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  let path = "";
  try {
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, "Control Panel\\Desktop", Ci.nsIWindowsRegKey.ACCESS_READ);
    path = key.readStringValue("WallPaper");
    key.close();
  } catch (e) {
    spike.log("registry read failed:", String(e));
  }
  let exists = path ? await IOUtils.exists(path) : false;
  if (!exists) {
    // Fallback: the transcoded copy Windows keeps for the current wallpaper.
    const alt = PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
    if (await IOUtils.exists(alt)) {
      path = alt;
      exists = true;
    }
  }
  spike.log("wallpaper path found:", !!path, "exists:", exists, "ext:", path.split(".").pop().slice(0, 5));
  const L = G.layer();
  // Hide the page; Home is drawn by the chrome layer.
  G.css(`#tabbrowser-tabpanels browser { visibility: hidden !important; }`);
  const bg = G.el("div", "position:absolute; inset:0; background:#223 center / cover no-repeat;", L);
  if (exists) {
    // file: URL in a chrome document; read as a blob so odd extensions (TranscodedWallpaper) still decode.
    const bytes = await IOUtils.read(path);
    const url = URL.createObjectURL(new Blob([bytes]));
    const img = new window.Image();
    await new Promise((r) => {
      img.onload = img.onerror = r;
      img.src = url;
    });
    spike.log("wallpaper decoded:", img.naturalWidth + "x" + img.naturalHeight, "bytes", bytes.length);
    bg.style.backgroundImage = `url(${url})`;
  }
  const strip = G.stripLensMarkup("home-pill", 560, 52, { blur: 2.4, diag: false });
  for (const f of [...new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${strip.markup}</svg>`, "image/svg+xml").documentElement.children]) G.defs().appendChild(document.importNode(f, true));
  const glass = (x, y, w, h, bf, label) => {
    const g = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border-radius:${Math.min(26, h / 2)}px; box-shadow:0 10px 28px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.22);`, L);
    G.el("div", `position:absolute; inset:0; border-radius:inherit; backdrop-filter:${bf};`, g);
    G.el("div", "position:absolute; inset:0; border-radius:inherit; background:linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03));", g);
    G.el("div", "position:absolute; inset:0; border-radius:inherit; padding:1px; background:linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35)); mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite:exclude;", g);
    G.el("div", "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font:500 14px 'Segoe UI Variable Text','Segoe UI'; text-shadow:0 1px 2px rgba(0,0,0,0.5);", g, label);
  };
  glass(360, 300, 560, 52, "url(#home-pill)", "Search or enter address (strip lens over the wallpaper)");
  glass(360, 390, 560, 220, "blur(24px) saturate(1.6)", "panel: blur(24px) saturate(1.6)");
  glass(400, 12, 480, 44, "blur(1.4px) saturate(1.5)", "bar pill: plain blur");
  await spike.sleep(800);
  await spike.capture("home-wallpaper");
});
