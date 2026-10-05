// VERIFY (claim 21, second half): a download started by a WebExtension's downloads.download().
// A tiny local extension is written into the profile and loaded with installTemporaryAddon
// (nothing is fetched from the internet). What does the take-over do to it, and what does the
// extension see?
/* global spike, ChromeUtils, Services, Ci, Cc, IOUtils, PathUtils, window */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { VitreTakeover } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreTakeover.sys.mjs");
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  const dir = PathUtils.join(H.DATA, "downloads-extdl");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setStringPref("browser.download.dir", dir);
  await VitreDownloads.init({ dir, connections: 8 });
  await VitreTakeover.install();
  await H.serverReset();

  const ext = PathUtils.join(PathUtils.profileDir, "verify-ext");
  await IOUtils.makeDirectory(ext, { ignoreExisting: true });
  await IOUtils.writeUTF8(PathUtils.join(ext, "manifest.json"), JSON.stringify({
    manifest_version: 2, name: "Vitre verify downloader", version: "1.0",
    browser_specific_settings: { gecko: { id: "verify-dl@vitre.test" } },
    permissions: ["downloads", "http://127.0.0.1/*"],
    background: { scripts: ["background.js"] },
  }));
  await IOUtils.writeUTF8(PathUtils.join(ext, "background.js"), `
    const report = (s) => fetch("${H.BASE}/page.html?ext=" + encodeURIComponent(s)).catch(() => {});
    browser.downloads.onChanged.addListener((d) => report("changed:" + JSON.stringify(d)));
    browser.downloads.onErased.addListener((id) => report("erased:" + id));
    browser.downloads.download({ url: "${H.BASE}/blob/medium?rate=2048&from=extension", filename: "from-extension.dat" })
      .then((id) => report("started:" + id), (e) => report("failed:" + e));
  `);
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(ext);
  const addon = await AddonManager.installTemporaryAddon(file);
  spike.log("extension loaded:", addon.id);
  let ev = null;
  for (let i = 0; i < 200 && !(ev = VitreTakeover.events.find((e) => e.action)); i++) await spike.sleep(50);
  spike.log("take-over event:", JSON.stringify(ev));
  const done = ev?.id ? await VitreDownloads.whenSettled(ev.id) : null;
  await spike.sleep(1500);
  const stats = await H.serverStats();
  const reports = stats.requests.filter((q) => q.path.includes("?ext=")).map((q) => decodeURIComponent(q.path.split("?ext=")[1]));
  spike.log("what the extension saw:", JSON.stringify(reports));
  const files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
  spike.log("files:", JSON.stringify(files), "| Vitre:", JSON.stringify(done ? [done.filename, done.state] : null));
  check("an extension's downloads.download() reaches the Downloads list view", !!ev, ev ? `${ev.action}; loading principal ${ev.loadingPrincipal}` : "");
  check("the extension's download can be told apart (its loading principal is the extension's)", /^moz-extension:/.test(ev?.loadingPrincipal ?? ""), ev?.loadingPrincipal);
  const interrupted = reports.some((r) => /interrupted|USER_CANCELED/.test(r));
  spike.log(`the extension ${interrupted ? "was told its download was INTERRUPTED/cancelled" : "was not told of a cancellation"}${reports.some((r) => r.startsWith("erased")) ? " and that it was erased" : ""}`);
  await addon.uninstall();
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
