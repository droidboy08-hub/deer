// VitreShell.adopt(win): the shell claims a window that was already open when the package was
// registered. Run against the stock interface so nothing of Vitre is loaded at start:
//   python tools/run.py --stock --test tests/core/adopt.js --name core-adopt --url https://example.com --timeout 90
// Captures: adopt-1-stock.png (Firefox's interface), adopt-2-adopted.png (Vitre's).
/* global spike, Services, Components, Ci, Cc, ChromeUtils, gBrowser */
spike.main(async () => {
  await spike.resize(1200, 760);
  await spike.loaded();
  spike.check("stock start: no Vitre in the window", !window.vitre && !document.documentElement.hasAttribute("vitre"));
  spike.check("stock start: Firefox's nav bar is rendered", document.getElementById("nav-bar").getBoundingClientRect().height > 0);
  await spike.capture("adopt-1-stock");

  // What config.js does, late: register the package from <runtime>\vitre, then adopt this window.
  const dir = Services.dirsvc.get("GreD", Ci.nsIFile);
  dir.append("vitre");
  dir.append("chrome.manifest");
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(dir);
  const { VitreShell } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs");
  VitreShell.adopt(window);
  await window.vitre.whenReady;
  await spike.sleep(600);

  const b = window.vitre;
  spike.check("adopt() builds the Browser", !!b && b.ready && b.tabs.length === 1 && b.active()?.url.startsWith("https://example.com"), b?.tabs.map((t) => t.url));
  spike.check("Firefox's interface is hidden after adopt", document.getElementById("nav-bar").getBoundingClientRect().height === 0 && document.getElementById("navigator-toolbox").getBoundingClientRect().height === 0);
  spike.check("page fills the window", gBrowser.selectedBrowser.getBoundingClientRect().y === 0);
  spike.check("no errors", VitreShell.errors.length === 0, VitreShell.errors);
  const pong = await b.page(b.active()).query("core:ping");
  spike.check("page actor registered late still answers in the existing content process", /^web/.test(pong?.remoteType), pong);
  await spike.capture("adopt-2-adopted");
});
