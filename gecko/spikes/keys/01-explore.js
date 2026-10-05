// 01: what does a synthesized key look like in the chrome window, with stock Firefox keys intact?
// Shows the two-pass dispatch for keys aimed at a remote page (first pass, then the REPLY event).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1100, 720);
  spike.log("testmode pref", Services.prefs.getBoolPref("focusmanager.testmode", false));
  await KS.load(KS.pageURL("keys.html", "prevent=ctrl-k"));
  spike.log("loaded", gBrowser.currentURI.spec, "remote", gBrowser.selectedBrowser.isRemoteBrowser, "remoteType", gBrowser.selectedBrowser.remoteType);
  spike.log("focus before", KS.focusInfo());
  gBrowser.selectedBrowser.focus();
  await spike.sleep(200);
  spike.log("focus after browser.focus()", KS.focusInfo());

  const rec = [];
  const tap = (label, opts) => {
    for (const type of ["keydown", "keypress", "keyup"]) {
      window.addEventListener(type, (e) => rec.push(label + " " + KS.describe(e)), opts);
    }
  };
  tap("win-capture", { capture: true });
  tap("win-bubble", { capture: false });
  tap("sys-capture", { capture: true, mozSystemGroup: true });
  tap("sys-bubble", { capture: false, mozSystemGroup: true });

  const run = async (label, fn) => {
    rec.length = 0;
    const tabsBefore = gBrowser.tabs.length;
    fn();
    await spike.sleep(500);
    spike.log("=== " + label + " (tabs " + tabsBefore + " -> " + gBrowser.tabs.length + ")");
    for (const r of rec) spike.log("   " + r);
    spike.log("   page saw:", await KS.pageSeen());
    spike.log("   focus:", KS.focusInfo());
  };

  await run("plain a", () => KS.press("a"));
  await run("Ctrl+K (page prevents; Firefox: focus search)", () => KS.press("Ctrl+K"));
  await run("Ctrl+L (page does not prevent; Firefox: focus urlbar)", () => KS.press("Ctrl+L"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(200);
  await run("Ctrl+T (Firefox reserved)", () => KS.press("Ctrl+T"));
  await spike.capture("01-after");
});
