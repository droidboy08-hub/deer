// Verifier: can a boot script under the STOCK harness (tools/run.py, gecko/runtime untouched, boot
// script outside the runtime) get a JSWindowActor CHILD running in a sandboxed web content process?
// The spike says no ("With the stock harness child actors cannot load at all").
// Idea: sandboxed content processes may read <profile>\chrome. So copy the actor modules there at
// run time, register a manifest for them, and point the actor at that chrome:// package.
//   python tools/run.py --boot spikes/packaging/verify/vboot-stock-actor.js --name packaging-verify-stockactor \
//       --out spikes/packaging/verify/out/stockactor --url https://example.com \
//       --pref browser.shell.customIcon.enabled=false --pref browser.privacySegmentation.createdShortcut=true
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, Components, IOUtils, PathUtils */
spike.main(async () => {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.loaded();
  spike.log("GreD=" + Services.dirsvc.get("GreD", Ci.nsIFile).path + " ProfD=" + PathUtils.profileDir);

  const dir = PathUtils.join(PathUtils.profileDir, "chrome", "vitre-verify");
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  // The sources live next to this boot script (outside the runtime): reachable in the PARENT as
  // resource://vitre-boot/..., but not readable by content processes. Copy them.
  const child = `export class VStockChild extends JSWindowActorChild {
  receiveMessage(msg) {
    return { title: this.document.title, processType: Services.appinfo.processType, remoteType: Services.appinfo.remoteType, url: import.meta.url };
  }
  handleEvent(e) { this.sendAsyncMessage("VStock:Loaded", { url: this.document.documentURI }); }
}
`;
  const parent = `export const seen = [];
export class VStockParent extends JSWindowActorParent {
  receiveMessage(msg) { seen.push(msg.data); }
}
`;
  await IOUtils.writeUTF8(PathUtils.join(dir, "VStockChild.sys.mjs"), child);
  await IOUtils.writeUTF8(PathUtils.join(dir, "VStockParent.sys.mjs"), parent);
  await IOUtils.writeUTF8(PathUtils.join(dir, "chrome.manifest"), "content vitre-verify ./\n");
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(PathUtils.join(dir, "chrome.manifest"));
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(f);

  ChromeUtils.registerWindowActor("VStock", {
    parent: { esModuleURI: "chrome://vitre-verify/content/VStockParent.sys.mjs" },
    child: { esModuleURI: "chrome://vitre-verify/content/VStockChild.sys.mjs", events: { DOMContentLoaded: {} } },
    matches: ["https://*/*"],
    messageManagerGroups: ["browsers"],
    safeForUntrustedWebProcess: true,
  });
  const ask = async (browser) => {
    try {
      return await Promise.race([browser.browsingContext.currentWindowGlobal.getActor("VStock").sendQuery("ping"), spike.sleep(5000).then(() => "TIMEOUT")]);
    } catch (e) {
      return "ERR " + e;
    }
  };
  const a = await ask(gBrowser.selectedBrowser);
  check("S1 existing tab (content process started BEFORE the registration): child actor answers", a && a.processType === 2, a);
  const tab = gBrowser.addTrustedTab("https://www.iana.org/help/example-domains", { inBackground: false });
  await spike.loaded(tab.linkedBrowser);
  const b = await ask(tab.linkedBrowser);
  check("S2 new tab on another site (other content process): child actor answers", b && b.processType === 2 && /Example Domains/.test(b.title), b);
  const { seen } = ChromeUtils.importESModule("chrome://vitre-verify/content/VStockParent.sys.mjs");
  check("S3 child -> parent event message arrived", seen.some((s) => /iana\.org/.test(s.url)), seen);
  const errs = Services.console.getMessageArray().map((m) => String(m.message || m)).filter((m) => /Failed to load chrome:\/\/vitre-verify/.test(m));
  check("S4 no 'Failed to load' errors", errs.length === 0, errs.slice(0, 2));
});
