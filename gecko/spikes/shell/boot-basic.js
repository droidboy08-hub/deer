// Spike 1+3: register chrome://vitre/, install the shell in the running window, look at it.
//   python tools/run.py --boot spikes/shell/boot-basic.js --name shell --url https://example.com
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    await spike.loaded();
    await spike.capture("basic-0-stock");

    const shell = vt.install();
    await spike.sleep(600);
    const d = document;
    const cs = (sel, prop) => {
      const e = d.querySelector(sel);
      return e ? getComputedStyle(e)[prop] : "(missing)";
    };
    spike.log("registered", { chromeURL: Services.io.newChannelFromURI ? "ok" : "?", timeline: shell.timeline });
    spike.log("namespaces", {
      createElement: d.createElement("div").namespaceURI,
      root: d.documentElement.namespaceURI,
      body: d.body.namespaceURI,
      vitreRoot: d.getElementById("vitre-root").namespaceURI,
    });
    spike.log("window", {
      inner: [window.innerWidth, window.innerHeight],
      outer: [window.outerWidth, window.outerHeight],
      dpr: window.devicePixelRatio,
      customtitlebar: d.documentElement.getAttribute("customtitlebar"),
      sizemode: d.documentElement.getAttribute("sizemode"),
      chromemargin: d.documentElement.getAttribute("chromemargin"),
    });
    spike.log("native chrome", {
      toolbox: vt.rect(d.getElementById("navigator-toolbox")),
      tabsToolbar: cs("#TabsToolbar", "display"),
      navBar: cs("#nav-bar", "display"),
      personal: cs("#PersonalToolbar", "display"),
      menubar: cs("#toolbar-menubar", "display"),
      sidebar: cs("#sidebar-box", "display"),
      browser: vt.rect(d.getElementById("browser")),
      selectedBrowser: vt.rect(gBrowser.selectedBrowser),
    });
    spike.log("vitre", {
      root: vt.rect(VitreUI.root),
      bar: vt.barState(),
      winctl: vt.rect(d.getElementById("vitre-winctl")),
    });
    spike.log("gBrowser alive", { tabs: gBrowser.tabs.length, uri: gBrowser.currentURI.spec, title: gBrowser.selectedTab.label });
    await spike.capture("basic-1-shell");

    await spike.resize(900, 700);
    await spike.sleep(400);
    await spike.capture("basic-2-shell-900");
  });
}
