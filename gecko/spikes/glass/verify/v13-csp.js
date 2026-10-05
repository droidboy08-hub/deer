// Verify the content-side recipe against pages whose CSP forbids inline styles.
//   left pill  : spike recipe (innerHTML with style="" attributes, ../content-glass.js)
//   right pill : CSP-safe recipe (data-style + element.style.cssText, content-glass2.js)
// Pages: a local strict-CSP page (csp.html), the PDF viewer (test.pdf), and a normal page as control.
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const browser = gBrowser.selectedBrowser;
  const L = G.layer();
  G.el("div", "position:absolute; left:120px; top:60px; width:480px; height:44px; border-radius:22px; outline:1px solid #f0f;", L);
  G.el("div", "position:absolute; left:680px; top:60px; width:480px; height:44px; border-radius:22px; outline:1px solid #f0f;", L);
  G.el("div", "position:absolute; left:120px; top:108px; background:#000; color:#fff; padding:1px 6px;", L, "spike recipe: innerHTML + style attributes");
  G.el("div", "position:absolute; left:680px; top:108px; background:#000; color:#fff; padding:1px 6px;", L, "CSP-safe: data-style + CSSOM (content-glass2.js)");

  const strip = G.stripLensMarkup("pill", 480, 44, { blur: 2.4, diag: false });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>${strip.markup}</defs></svg>`;
  const css1 = "position:fixed; left:120px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1);";
  const css2 = "position:fixed; left:680px; top:60px; width:480px; height:44px; border-radius:22px; backdrop-filter:url(#pill) invert(1);";

  const code2 = await (await fetch("resource://vitre-boot/content-glass2.js")).text();
  window.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(code2), true);
  const set2 = (html) =>
    new Promise((res) => {
      const on = (m) => {
        if (m.target !== browser) return;
        window.messageManager.removeMessageListener("VitreGlass2:Result", on);
        res(m.data.value);
      };
      window.messageManager.addMessageListener("VitreGlass2:Result", on);
      browser.messageManager.sendAsyncMessage("VitreGlass2:Set", { html });
      setTimeout(() => res("TIMEOUT"), 5000);
    });
  let C = null;
  for (const [name, url] of [["normal", G.sibling("page.html") + "?noanim=1"], ["csp", G.sibling("csp.html")], ["pdf", G.sibling("test.pdf")]]) {
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await spike.sleep(name === "pdf" ? 3500 : 1500);
    if (!C) C = await G.contentGlass();
    const r1 = await C.set(`<div style="${css1}"></div>`);
    const r2 = await set2(`${svg}<div data-style="${css2}"></div>`);
    spike.log(name, "spike recipe set ->", r1, "| CSP-safe set -> styled elements:", r2);
    await spike.sleep(700);
    await spike.capture("csp-" + name);
  }
});
