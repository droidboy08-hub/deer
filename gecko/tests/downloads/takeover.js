// Firefox's own downloads, taken over: a real (trusted) click on an attachment link that needs the
// page's cookie and Referer; an <a download> link; Alt+click on a plain link (Vitre's page module);
// a blob: download the page makes itself (left to Firefox, mirrored, moved out of the scratch
// folder); the 'downloads' service. Mark of the Web on finished files; Firefox's list and scratch
// folder stay empty.
/* global spike, Services, ChromeUtils, Cc, Ci, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  log("init");
  const m = await DL.init();
  log("ready");
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const firefoxList = await Downloads.getList(Downloads.ALL);
  const newest = () => DL.engine.list(false)[0];

  // ---- 1. a clicked attachment link ----
  await DL.open(DL.base + "/page.html?rate=2048");
  log("page open");
  await DL.reset();
  log("server reset");
  const before = engine.takeovers.length;
  const click = await DL.clickInPage("#dl");
  check("the click on the link is trusted", click.found && click.trusted === true, click);
  const taken = await waitFor(() => engine.takeovers.length > before && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "the take-over" });
  check("Firefox's download is taken over", taken.action === "taken over", taken);
  const v1 = engine.get(taken.id);
  check("the name comes from Content-Disposition", v1?.filename === "Quarterly report (final).dat", v1?.filename);
  await sleep(700);
  check("the ring shows (the new download flew to it)", DL.ui().ring.isShown);
  await spike.capture("takeover-1-ring");
  const done1 = await DL.until(taken.id, ["completed", "failed"], { timeout: 60000 });
  check("the taken-over download completed", done1.state === "completed", done1.error);
  check("it is intact (sha256)", (await DL.sha256(done1.path)) === m["medium.bin"].sha256);
  const st = await DL.stats();
  const vitreReqs = st.requests.filter((r) => r.path.startsWith("/dl/report") && r.range && r.range !== "bytes=0-0" && r.status === 206);
  check("Vitre's ranged requests carry the page's cookie and Referer", vitreReqs.length >= 2 && vitreReqs.every((r) => r.cookie.includes("sid=vitre-secret") && r.referer.includes("/page.html")), vitreReqs.map((r) => [r.range, r.cookie, r.referer]).slice(0, 3));
  check("the page did not navigate", gBrowser.selectedBrowser.currentURI.spec.endsWith("/page.html?rate=2048"));
  const ffItems = (await firefoxList.getAll()).filter((d) => d.source.url.includes("/dl/report"));
  check("Firefox's list no longer holds it", ffItems.length === 0, ffItems.length);
  const scratch = await IOUtils.getChildren(engine.scratch);
  check("Firefox's scratch folder is empty (no placeholder, no .part)", scratch.length === 0, scratch);
  const zone = await DL.motw(done1.path);
  check("the finished file carries the Mark of the Web", /ZoneId=3/.test(zone) && zone.includes("HostUrl="), zone.split(/\s*\n\s*/).join(" | "));

  // ---- 2. <a download> ----
  const before2 = engine.takeovers.length;
  await DL.clickInPage("#named");
  const taken2 = await waitFor(() => engine.takeovers.length > before2 && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "the second take-over" });
  check("<a download> is taken over", taken2.action === "taken over", taken2);
  const done2 = await DL.until(taken2.id, ["completed", "failed"], { timeout: 60000 });
  check("<a download> keeps the name the page gave", done2.filename === "chosen-name.dat" && done2.state === "completed", [done2.filename, done2.state]);

  // ---- 3. Alt+click a plain link: Vitre's own download, the page stays ----
  const count = engine.list(false).length;
  const alt = await DL.clickInPage("#plain", { altKey: true });
  log("alt click", alt);
  const v3 = await waitFor(() => engine.list(false).length > count && newest(), { timeout: 10000, what: "the Alt+click download" });
  check("Alt+click starts a Vitre download of the link", v3.url.includes("/blob/medium") && v3.engine === "vitre", v3.url);
  await sleep(500);
  check("Alt+click did not follow the link", gBrowser.selectedBrowser.currentURI.spec.endsWith("/page.html?rate=2048"));
  const done3 = await DL.until(v3.id, ["completed", "failed"], { timeout: 60000 });
  check("the Alt+click download completed intact", done3.state === "completed" && (await DL.sha256(done3.path)) === m["medium.bin"].sha256);

  // A page that handles Alt+click itself keeps it.
  const count3b = engine.list(false).length;
  await DL.clickInPage("#handled", { altKey: true });
  await sleep(800);
  check("Alt+click on a link the page handles is left to the page", engine.list(false).length === count3b && gBrowser.selectedBrowser.contentTitle === "handled by the page", gBrowser.selectedBrowser.contentTitle);

  // ---- 4. a blob: download is left to Firefox, mirrored, then moved to the downloads folder ----
  const before4 = engine.takeovers.length;
  await DL.clickInPage("#blobdl");
  const taken4 = await waitFor(() => engine.takeovers.length > before4 && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "the blob download" });
  check("a blob: download is left to Firefox", /not http/.test(taken4.action), taken4);
  const done4 = await DL.until(taken4.id, ["completed", "failed"], { timeout: 20000 });
  check("it shows in the list as Firefox's, completed", done4.engine === "browser" && done4.state === "completed", [done4.engine, done4.state, done4.error]);
  check("it was moved from the scratch folder to the downloads folder", PathUtils.parent(done4.path) === DL.dir && (await IOUtils.exists(done4.path)), done4.path);
  const left = await waitFor(async () => ((await IOUtils.getChildren(engine.scratch)).length === 0 ? [] : null), { timeout: 3000, what: "the scratch folder to empty" }).catch(async () => IOUtils.getChildren(engine.scratch));
  check("the scratch folder is empty again", left.length === 0, left);
  log("blob trace", engine.firefoxTrace.get(taken4.id));

  // ---- 5. the 'downloads' service (what the menus module calls for "Download linked file") ----
  await DL.reset();
  const count5 = engine.list(false).length;
  b.service("downloads").download(DL.base + "/dl/report", { browser: gBrowser.selectedBrowser, origin: { x: 300, y: 250 } });
  const v5 = await waitFor(() => engine.list(false).length > count5 && newest(), { timeout: 10000, what: "the service download" });
  const done5 = await DL.until(v5.id, ["completed", "failed"], { timeout: 60000 });
  check("downloads.download() sends the tab's cookie and Referer (and names the copy ' (1)')", done5.state === "completed" && done5.filename === "Quarterly report (final) (1).dat", [done5.state, done5.filename, done5.error]);

  // ---- 6. a private window: its download is private, shown only there, never stored ----
  const pw = await spike.openWindow({ private: true });
  const countP = engine.list(true).length;
  pw.vitre.service("downloads").download(DL.base + "/blob/medium", { browser: pw.gBrowser.selectedBrowser, filename: "private.bin" });
  const vp = await waitFor(() => engine.list(true).length > countP && engine.list(true)[0], { timeout: 10000, what: "the private download" });
  const dp = await DL.until(vp.id, ["completed", "failed"], { timeout: 60000 });
  check("a private window's download is private", dp.isPrivate === true && dp.state === "completed", [dp.isPrivate, dp.state]);
  check("the private download shows in the private window only", pw.vitreDownloads.store.all().some((v) => v.id === vp.id) && !DL.ui().store.all().some((v) => v.id === vp.id));
  await engine.save();
  const stored = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "vitre-downloads.json"));
  check("it is never written to the download list on disk", !stored.items.some((r) => r.id === vp.id), stored.items.length);
  pw.close();
  await waitFor(() => !engine.list(true).length, { timeout: 10000, what: "private downloads to go with the last private window" });
  check("closing the last private window drops its downloads from the list", engine.list(true).length === 0);

  // ---- 7. an extension's downloads.download() is left to Firefox (its API keeps working), then moved ----
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const extDir = PathUtils.join(PathUtils.tempDir, "vitre-dl-test-extension");
  await IOUtils.makeDirectory(extDir, { ignoreExisting: true });
  await IOUtils.writeJSON(PathUtils.join(extDir, "manifest.json"), {
    manifest_version: 2,
    name: "Vitre downloads test",
    version: "1.0",
    browser_specific_settings: { gecko: { id: "dl-test@vitre.invalid" } },
    permissions: ["downloads", "http://127.0.0.1/*"],
    background: { scripts: ["bg.js"] },
  });
  await IOUtils.writeUTF8(PathUtils.join(extDir, "bg.js"), `browser.downloads.download({ url: ${JSON.stringify(DL.base + "/blob/medium?ext=1")}, filename: "from-extension.bin" });`);
  const before7 = engine.takeovers.length;
  const dirFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dirFile.initWithPath(extDir);
  const addon = await AddonManager.installTemporaryAddon(dirFile);
  const taken7 = await waitFor(() => engine.takeovers.slice(before7).find((t) => t.url.includes("ext=1")), { timeout: 20000, what: "the extension's download" });
  check("an extension's download is left to Firefox", /extension/.test(taken7.action), taken7);
  const done7 = await DL.until(taken7.id, ["completed", "failed"], { timeout: 60000 });
  check("it completes and is moved to the downloads folder", done7.state === "completed" && PathUtils.parent(done7.path) === DL.dir && done7.filename === "from-extension.bin", [done7.state, done7.path]);
  log("extension trace", engine.firefoxTrace.get(taken7.id), engine.get(taken7.id));
  const ff7 = (await firefoxList.getAll()).find((d) => d.source.url.includes("ext=1"));
  check("Firefox still reports it to the extension as succeeded", !!ff7 && ff7.succeeded === true, ff7 ? { succeeded: ff7.succeeded, canceled: ff7.canceled } : null);
  await addon.uninstall();
  await IOUtils.remove(extDir, { recursive: true, ignoreAbsent: true });

  // The panel lists all of them.
  spike.press("Ctrl+J");
  await waitFor(() => DL.ui().panel.open, { what: "the panel" });
  await sleep(700);
  await spike.capture("takeover-2-panel");
  log("files", await DL.files());
});
