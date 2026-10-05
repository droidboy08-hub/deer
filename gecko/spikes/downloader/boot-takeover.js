// Spike 3: taking over Firefox's own downloads with a real click on a link in a page.
// The tab loads http://127.0.0.1:PORT/page.html (which sets a cookie); the link's answer is an
// attachment (Content-Disposition) that needs that cookie. Then: <a download>, Save Link As
// (saveURL), a data: download that must stay with Firefox, and Vitre's own Save dialog.
/* global spike, ChromeUtils, Services, Ci, Cc, IOUtils, PathUtils, gBrowser, window, saveURL */
spike.main(async () => {
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { VitreTakeover, askWhereToSave, defaultFolder } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreTakeover.sys.mjs");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

  await spike.resize(1200, 760);
  const dir = PathUtils.join(H.DATA, "downloads-takeover");
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });

  spike.log("default folder before prefs:", await defaultFolder(), "| DfltDwnld:", Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path);
  // The user's chosen folder: folderList 2 = custom (0 desktop, 1 the system Downloads folder).
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setStringPref("browser.download.dir", dir);
  spike.log("default folder after prefs:", await defaultFolder());

  await VitreDownloads.init({ dir, connections: 8 });
  await VitreTakeover.install();
  Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
  window.vitreOverlay.setNote("take-over test");

  const browser = gBrowser.selectedBrowser;
  await spike.loaded();
  await H.serverReset();
  const firefoxList = await Downloads.getList(Downloads.ALL);

  /**
   * A real mouse click on an element of the page: mousedown + mouseup dispatched through the
   * content window's PresShell at the element's centre (Window.synthesizeMouseEvent, chrome-only),
   * so the page gets a trusted click with user activation, exactly as from the mouse.
   */
  const click = (id) => new Promise((resolve) => {
    const mm = browser.messageManager;
    const name = "vitre-spike:clicked:" + id + ":" + Date.now();
    mm.addMessageListener(name, function on(m) {
      mm.removeMessageListener(name, on);
      resolve(m.data);
    });
    const script = (id, name) => {
      const el = content.document.getElementById(id);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      let trusted = null;
      el.addEventListener("click", (e) => (trusted = e.isTrusted), { once: true });
      for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, x, y, { button: 0, clickCount: 1 }, {});
      sendAsyncMessage(name, { x: Math.round(x), y: Math.round(y), trusted, href: el.href });
    };
    mm.loadFrameScript(`data:,(${encodeURIComponent(script.toString())})(${JSON.stringify(id)}, ${JSON.stringify(name)})`, false);
  });
  const waitFor = async (what, fn, ms = 20000) => {
    for (let i = 0; i < ms / 50; i++) {
      const v = await fn();
      if (v) return v;
      await spike.sleep(50);
    }
    throw new Error("timed out waiting for " + what);
  };
  const settle = async (id) => VitreDownloads.whenSettled(id);

  // ---- 1. a real click on a link whose answer is an attachment ----
  spike.log("--- click on #dl (attachment, needs the page's cookie)");
  await spike.capture("takeover-0-page");
  const at = await click("dl");
  spike.log(`clicked ${at.href} at ${at.x},${at.y} in the page; the page's click event was trusted: ${at.trusted}`);
  const ev = await waitFor("the take-over", () => VitreTakeover.events.find((e) => e.action));
  spike.log("Firefox's download as the list view saw it:", JSON.stringify(ev));
  await waitFor("progress", () => VitreDownloads.list()[0]?.received > 4 * 1048576);
  await spike.capture("takeover-1-downloading");
  const done = await settle(ev.id);
  const stats = await H.serverStats();
  const reqs = stats.requests.filter((q) => q.path.startsWith("/dl/report"));
  const nav = reqs.filter((q) => !q.range);
  const ranged = reqs.filter((q) => q.range && q.end > q.start);
  const sha = done.state === "completed" ? await IOUtils.computeHexDigest(done.path, "sha256") : "";
  const left = (await firefoxList.getAll()).length;
  const files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
  check("a clicked attachment link is taken over by Vitre's engine", ev.action === "taken over" && done.state === "completed" && sha === H.SHA.medium,
    `saved as "${done.filename}" (${done.total} bytes, sha256 ok), from ${ev.url}`);
  check("the page's cookie and Referer travel with the engine's requests", ranged.length > 1 && ranged.every((q) => q.cookie.includes("sid=vitre-secret") && q.referer.endsWith("/page.html?rate=1024")),
    `${ranged.length} ranged requests; Firefox's own navigation made ${nav.length} plain request(s); referer ${ranged[0]?.referer}`);
  check("the tab is known", ev.browsingContextId > 0 && ev.tabLabel === "Download test page", `browsingContextId ${ev.browsingContextId} -> tab "${ev.tabLabel}"`);
  check("Firefox's own download is gone", left === 0 && files.length === 1, `Firefox's list has ${left} entries; files in the folder: ${JSON.stringify(files)}`);
  await spike.capture("takeover-2-done");
  const zone = await runTool("cmd.exe", ["/c", `more < "${done.path}:Zone.Identifier"`]);
  check("the finished file carries the Mark of the Web (Zone.Identifier)", /ZoneId=3/.test(zone.stdout) && zone.stdout.includes("HostUrl="), zone.stdout.trim().split(/\s*\n\s*/).join(" | "));

  // ---- 2. <a download="chosen-name.dat"> ----
  spike.log("--- click on #named (<a download>)");
  let n = VitreTakeover.events.length;
  await click("named");
  const ev2 = await waitFor("the take-over", () => VitreTakeover.events[n]?.action && VitreTakeover.events[n]);
  const done2 = await settle(ev2.id);
  check("<a download=name> is taken over with the name the page chose", ev2.action === "taken over" && done2.state === "completed" && done2.filename === "chosen-name.dat", `"${done2.filename}" ${done2.state}`);

  // ---- 3. Save Link As (contentAreaUtils saveURL, without Firefox's picker) ----
  spike.log("--- saveURL() (what Save Link As calls)");
  n = VitreTakeover.events.length;
  saveURL(`${H.BASE}/blob/medium?rate=4096&via=saveurl`, null, "saved-link.dat", null, true, true, null, null, null, false, Services.scriptSecurityManager.getSystemPrincipal());
  const ev3 = await waitFor("the take-over", () => VitreTakeover.events[n]?.action && VitreTakeover.events[n]);
  const done3 = await settle(ev3.id);
  check("Save Link As (saveURL) is taken over", ev3.action === "taken over" && done3.state === "completed", `saver ${ev3.saver}, "${done3.filename}" ${done3.state}`);

  // ---- 4. what Vitre's engine can't fetch stays with Firefox ----
  spike.log("--- a data: download");
  n = VitreTakeover.events.length;
  const before = (await firefoxList.getAll()).length;
  saveURL("data:text/plain,hello%20from%20a%20data%20url", null, "from-data.txt", null, true, true, null, null, null, false, Services.scriptSecurityManager.getSystemPrincipal());
  const ev4 = await waitFor("the data: download", () => VitreTakeover.events[n]?.action && VitreTakeover.events[n]);
  const ffDownload = await waitFor("Firefox finishing it", async () => (await firefoxList.getAll()).find((d) => d.succeeded));
  check("a data: download is left to Firefox and finishes there", ev4.action.startsWith("left to Firefox") && ffDownload.succeeded && (await firefoxList.getAll()).length === before + 1,
    `${ev4.action}; Firefox saved ${PathUtils.filename(ffDownload.target.path)} (${ffDownload.currentBytes} bytes)`);

  // ---- 5. "ask where to save": Vitre's own native Save dialog ----
  spike.log("--- nsIFilePicker (Save)");
  const title = "Vitre spike save " + H.PORT;
  const shot = PathUtils.join(spike.outDir, "takeover-3-save-dialog.png");
  const helper = runTool(Services.env.get("VITRE_DL_PYTHON") || "python.exe", [PathUtils.join(Services.env.get("VITRE_DL_HERE"), "server", "dialog_helper.py"), title, shot, "accept", "20"]).catch((e) => ({ error: String(e) }));
  const chosen = await askWhereToSave(window, { title, name: "asked-name.dat", dir });
  const helped = await helper;
  spike.log("dialog helper:", (helped.stdout || helped.error || "").trim());
  check("the native Save dialog opens on the chosen folder and returns the path", chosen === PathUtils.join(dir, "asked-name.dat"), `returned ${chosen}`);

  spike.log("all take-over events:", JSON.stringify(VitreTakeover.events.map((e) => [e.url.slice(0, 60), e.saver, e.action])));
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
});
