// Spike 3: the production entry point. Run through run_early.py, which registers chrome.manifest
// at AutoConfig time. By the time this script runs (delayed startup finished) the shell must
// already be in the FIRST window, put there by Firefox's own category hooks.
//   python spikes/shell/run_early.py --boot spikes/shell/boot-early.js --name shell-early --url https://example.com
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const alreadyThere = { vitreAttr: document.documentElement.getAttribute("vitre"), ui: !!window.VitreUI?.root, routed: !!XULPopupElement.prototype.vitreRouted };
    const shell = vt.register();
    spike.log("registered by config.js before this script:", vt.registeredEarly);
    spike.log("first window when the boot script starts (nothing installed by the script):", alreadyThere);
    spike.log("timeline", shell.timeline);
    const me = window.docShell.outerWindowID;
    const hooks = shell.timeline.filter((t) => t.win === me);
    spike.log("first window hook order", hooks.map((t) => `${t.hook}@${t.ms}ms${t.readyState ? "(" + t.readyState + ")" : ""}`));
    spike.log("at first paint", hooks.find((t) => t.hook === "firstPaint"));
    await spike.loaded();
    await spike.sleep(800);
    spike.log("bar", vt.barState());
    spike.log("size", { inner: [innerWidth, innerHeight], sizemode: document.documentElement.getAttribute("sizemode") });
    await spike.capture("early-after-load");

    // a second window goes through exactly the same path
    const win = OpenBrowserWindow();
    await vt.until(() => win.gBrowserInit?.delayedStartupFinished, 10000);
    await spike.sleep(500);
    spike.log("second window hooks", shell.timeline.filter((t) => t.win === win.docShell.outerWindowID).map((t) => `${t.hook}@${t.ms}ms`));
    win.close();
  });
}
