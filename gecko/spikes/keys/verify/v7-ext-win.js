// v7 (verifier):
//   A. a REAL (local, temporary) WebExtension with commands, instead of the spike's hand-made keyset:
//      free chord fires the extension; chords Vitre binds fire only Vitre.
//   B. chords with the Win key held: Firefox's tabbox/tabbrowser ignore Win on Windows, Vitre's
//      guard refuses Win chords, so does Firefox still act by itself under the router?
//   env KS_KEYS=fixed uses vitre-keys-fixed.js (+ the extra system-action hiding below).
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
const fixed = Services.env.get("KS_KEYS") === "fixed";
Services.scriptloader.loadSubScript("resource://vitre-boot/" + (fixed ? "vitre-keys-fixed.js" : "vitre-keys.js") + "?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  spike.log("router under test: " + (fixed ? "vitre-keys-fixed.js + hide every Firefox system action" : "vitre-keys.js (spike)"));
  const actions = [];
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + "[" + info.how + "]") });
  if (fixed) {
    // Proposed addition: whatever Vitre does not bind, Firefox's tabbox/tabbrowser must not act on.
    const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
    for (const t of ["keydown", "keypress"]) {
      window.addEventListener(t, (e) => { if (e.isTrusted && ShortcutUtils.getSystemActionForEvent(e) != null) e.stopPropagation(); }, { capture: true, mozSystemGroup: true });
    }
  }
  const url = KS.pageURL("keys.html");
  await KS.load(url);
  const tabs = [gBrowser.selectedTab, gBrowser.addTrustedTab(url + "?t=2"), gBrowser.addTrustedTab(url + "?t=3")];
  await spike.sleep(1500);
  gBrowser.selectedTab = tabs[1];
  await spike.sleep(500);
  window.focus(); gBrowser.selectedBrowser.focus();
  await spike.sleep(300);

  spike.log("--- A. real temporary extension with commands");
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(Services.env.get("VITRE_BOOT"));
  const ext = dir.parent.clone(); ext.append("ext");
  const addon = await AddonManager.installTemporaryAddon(ext);
  let ks = null;
  for (let i = 0; i < 50 && !ks; i++) { await spike.sleep(200); ks = document.querySelector("keyset[id^='ext-keyset-id-']"); }
  spike.log("  installed " + addon.id + "; keyset " + (ks ? ks.id + " keys: " + [...ks.querySelectorAll("key")].map((k) => (k.getAttribute("modifiers") || "") + "+" + (k.getAttribute("key") || k.getAttribute("keycode"))).join(" | ") + " parent=" + ks.parentNode.localName : "NOT FOUND") + "; parked keys: " + document.getElementById("vitre-dead-keys").children.length);
  const fired = [];
  window.addEventListener("command", (e) => { if (e.target.closest && e.target.closest("keyset[id^='ext-keyset-id-']")) fired.push("ext key " + e.target.id.replace(/^.*?_/, "")); }, true);
  const extTabs = () => gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec).filter((u) => u.includes("ext-command=")).map((u) => u.split("ext-command=")[1]);
  const press = async (spec) => {
    actions.length = 0; fired.length = 0;
    const before = extTabs().length;
    const s0 = (await KS.pageSeen(tabs[1].linkedBrowser)).length;
    KS.press(spec);
    await spike.sleep(1500);
    const newTabs = extTabs().slice(before);
    spike.log("  " + spec.padEnd(14) + "vitre " + JSON.stringify(actions.slice()) + " | extension key command " + JSON.stringify(fired.slice()) + " | tabs opened by the extension's background page " + JSON.stringify(newTabs) + " | page saw " + JSON.stringify((await KS.pageSeen(tabs[1].linkedBrowser)).slice(s0)));
  };
  await press("Ctrl+Shift+Y");
  await press("Ctrl+Shift+D");
  await press("Ctrl+Shift+T");
  for (const t of [...gBrowser.tabs]) if (!tabs.includes(t)) gBrowser.removeTab(t);
  await addon.uninstall();
  await spike.sleep(500);
  spike.log("  after uninstall: extension keyset present = " + !!document.querySelector("keyset[id^='ext-keyset-id-']"));

  spike.log("--- B. Win-modified chords (Firefox ignores the Win key for its tab keys on Windows)");
  const snap = () => gBrowser.tabs.map((t) => (t === tabs[0] ? "T1" : t === tabs[1] ? "T2" : t === tabs[2] ? "T3" : "T?")).join(",") + " selected=" + (gBrowser.tabs.indexOf(gBrowser.selectedTab) + 1);
  for (const spec of ["Ctrl+Meta+Tab", "Ctrl+Shift+Meta+Tab", "Ctrl+Meta+PageDown", "Ctrl+Shift+Meta+PageDown", "Ctrl+Meta+F4", "Ctrl+Meta+T", "Ctrl+Meta+L"]) {
    for (const t of [...gBrowser.tabs]) if (!tabs.includes(t)) gBrowser.removeTab(t);
    for (let i = 0; i < 3; i++) { if (!tabs[i].isConnected || tabs[i].closing) { tabs[i] = gBrowser.addTrustedTab(url + "?t=" + (i + 1)); await spike.sleep(700); } if (gBrowser.tabs[i] !== tabs[i]) gBrowser.moveTabTo(tabs[i], { tabIndex: i }); }
    gBrowser.selectedTab = tabs[1];
    await spike.sleep(500);
    window.focus(); gBrowser.selectedBrowser.focus();
    await spike.sleep(300);
    const before = snap();
    actions.length = 0;
    KS.press(spec);
    await spike.sleep(600);
    const after = snap();
    spike.log("  " + spec.padEnd(26) + "vitre " + JSON.stringify(actions.slice()) + " | firefox: " + (before === after ? "nothing" : before + " -> " + after + "   <-- Firefox acted on its own"));
  }
});
