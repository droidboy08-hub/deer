// Verify claim 22 (PDF viewer, error pages, other document kinds) for both recipes.
//   VITRE_SIDE = parent  : lens in the parent layer under the surface root (verify recipe)
//   VITRE_SIDE = content : lens as anonymous content through the frame script (spike recipe)
// One pill with a hard-to-miss lens (blur + invert) and one with the strip lens; a parent-drawn
// outline shows where the lens should be.
/* global spike, G, gBrowser, Services, document, window, DOMParser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const side = Services.env.get("VITRE_SIDE") || "parent";
  G.hideFirefoxUI();
  const browser = gBrowser.selectedBrowser;
  const strip = G.stripLensMarkup("pill", 480, 44, { blur: 2.4, diag: false });
  const pos = side === "parent" ? "absolute" : "fixed";
  const html = `<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;width:0;height:0"><defs>${strip.markup}</defs></svg>` +
    `<div style="position:${pos}; left:120px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1);"></div>` +
    `<div style="position:${pos}; left:680px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:url(#pill);"></div>`;
  let L;
  let C = null;
  if (side === "parent") {
    const tabbox = document.getElementById("tabbrowser-tabbox");
    tabbox.style.filter = "saturate(1.0001)";
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
    L.appendChild(document.importNode(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`, "application/xhtml+xml").documentElement, true));
  } else L = G.layer();
  for (const x of [120, 680]) G.el("div", `position:absolute; left:${x}px; top:60px; width:480px; height:44px; border-radius:22px; outline:1px solid #f0f;`, L);
  const lab = G.el("div", "position:absolute; left:120px; top:108px; background:#000; color:#fff; padding:1px 6px;", L, "");

  const pages = [
    ["pdf", G.sibling("test.pdf")],
    ["neterror", "https://nonexistent-host-for-vitre-test.invalid/"],
    ["viewsource", "view-source:" + G.sibling("page.html")],
    ["image", "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#fd0"/><text x="40" y="100" font-size="60">standalone image document 0123456789</text></svg>')],
    ["text", "data:text/plain,plain text document " + "lorem ipsum 0123456789 ".repeat(200)],
    ["aboutblank", "about:blank"],
    ["aboutsupport", "about:support"],
  ];
  for (const [name, url] of pages) {
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await spike.sleep(name === "pdf" ? 3500 : 2000);
    let set = "(parent layer)";
    if (side === "content") {
      try {
        if (!C) C = await G.contentGlass();
        set = await C.set(html);
      } catch (e) {
        set = "ERR " + e;
      }
    }
    lab.textContent = `${side}: ${name}  remoteType=${browser.remoteType}  uri=${browser.currentURI.spec.slice(0, 50)}`;
    spike.log(side, name, "remoteType", browser.remoteType, "isRemote", browser.isRemoteBrowser, "set ->", set);
    await spike.sleep(600);
    await spike.capture(`pages-${side}-${name}`);
  }
});
