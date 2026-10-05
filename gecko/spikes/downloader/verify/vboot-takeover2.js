// VERIFY (claims 16, 17, 20, 21): is the Downloads-list take-over robust?
//   A  a container tab (userContextId 2): the cookie only exists in that container's jar
//   B  a real private window: the cookie only exists in the private jar; nothing is persisted
//   C  a second normal window
//   D  page2.html: PDF attachment, inline PDF, tiny attachment (done before anyone reacts),
//      one-time link, POST download, blob: download
// The engine here is verify/engine (a copy of the spike's; VitreTakeover only gained log fields).
/* global spike, ChromeUtils, Services, Ci, Cc, IOUtils, PathUtils, gBrowser, window, OpenBrowserWindow */
if (Services.prefs.getBoolPref("vitre.verify.started", false)) {
  // config.js runs the boot script in every new browser window: only the first one is the test.
} else {
  Services.prefs.setBoolPref("vitre.verify.started", true);
  spike.main(async () => {
    const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
    const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
    const { VitreTakeover } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreTakeover.sys.mjs");
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
    const system = Services.scriptSecurityManager.getSystemPrincipal();
    const only = (Services.env.get("VITRE_V_ONLY") || "").split(",").filter(Boolean);
    const want = (k) => !only.length || only.includes(k);

    await spike.resize(1200, 760);
    const dir = PathUtils.join(H.DATA, "downloads-takeover2");
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    Services.prefs.setIntPref("browser.download.folderList", 2);
    // VITRE_V_FFDIR=1: Firefox's own download folder is a scratch folder, Vitre saves elsewhere.
    const ffDir = Services.env.get("VITRE_V_FFDIR") === "1" ? dir + "-firefox-scratch" : dir;
    await IOUtils.remove(ffDir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(ffDir, { ignoreExisting: true });
    Services.prefs.setStringPref("browser.download.dir", ffDir);
    await VitreDownloads.init({ dir, connections: 8 });
    await VitreTakeover.install();
    Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
    window.vitreOverlay.setNote("take-over robustness");
    const firefoxList = await Downloads.getList(Downloads.ALL);

    const click = (browser, id) => new Promise((resolve) => {
      const mm = browser.messageManager;
      const name = "vitre-verify:clicked:" + id + ":" + Date.now();
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
        sendAsyncMessage(name, { trusted, href: el.href || "" });
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
    const loadIn = async (browser, url) => {
      browser.fixupAndLoadURIString(url, { triggeringPrincipal: system });
      await waitFor("load of " + url, () => !browser.webProgress?.isLoadingDocument && browser.currentURI.spec === url);
      await spike.sleep(300);
    };
    const openWin = (opts) => new Promise((resolve) => {
      const win = OpenBrowserWindow(opts);
      const obs = (subject) => {
        if (subject !== win) return;
        Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
        resolve(win);
      };
      Services.obs.addObserver(obs, "browser-delayed-startup-finished");
    });
    const nextEvent = async (n) => waitFor("the take-over", () => VitreTakeover.events[n]?.action && VitreTakeover.events[n]);
    const cookieCount = (oa) => Services.cookies.getCookiesFromHost("127.0.0.1", oa).length;
    const page = `${H.BASE}/page.html?rate=2048`;

    const attachmentCase = async (label, browser, expect) => {
      await H.serverReset();
      const n = VitreTakeover.events.length;
      const at = await click(browser, "dl");
      const ev = await nextEvent(n);
      const done = ev.id ? await VitreDownloads.whenSettled(ev.id) : null;
      const stats = await H.serverStats();
      const ranged = stats.requests.filter((q) => q.path.startsWith("/dl/report") && q.range && q.end > q.start);
      const sha = done?.state === "completed" ? await IOUtils.computeHexDigest(done.path, "sha256") : "";
      spike.log(`${label}: trusted click ${at.trusted}; event ${JSON.stringify({ action: ev.action, isPrivate: ev.isPrivate, userContextId: ev.userContextId, tab: ev.tabLabel, part: ev.firefoxPart, target: ev.firefoxTarget })}`);
      check(`${label}: taken over, finished, sha256 ok, cookie + Referer on every ranged request`,
        ev.action === "taken over" && done?.state === "completed" && sha === H.SHA.medium && ranged.length > 1 && ranged.every((q) => q.cookie.includes("sid=vitre-secret") && q.referer.includes("/page.html")) && expect(ev),
        `${ranged.length} ranged requests, state ${done?.state}, file "${done?.filename}"`);
      return { ev, done };
    };

    // ---- A: container tab ----
    if (want("A")) {
      spike.log("--- A: container tab (userContextId 2)");
      const tab = gBrowser.addTab("about:blank", { userContextId: 2, triggeringPrincipal: system });
      gBrowser.selectedTab = tab;
      await loadIn(tab.linkedBrowser, page);
      spike.log(`cookies for 127.0.0.1: default jar ${cookieCount({})}, container 2 jar ${cookieCount({ userContextId: 2 })}`);
      const { ev } = await attachmentCase("A container", tab.linkedBrowser, (e) => e.userContextId === 2 && !e.isPrivate && e.tabLabel === "Download test page");
      check("A: the cookie existed only in the container's jar", cookieCount({}) === 0 && cookieCount({ userContextId: 2 }) === 1);
      await spike.capture("takeover2-A-container");
      void ev;
    }

    // ---- B: private window ----
    if (want("B")) {
      spike.log("--- B: private window");
      const pw = await openWin({ private: true });
      pw.resizeTo(1000, 640);
      await loadIn(pw.gBrowser.selectedBrowser, page);
      spike.log(`cookies for 127.0.0.1: default jar ${cookieCount({})}, private jar ${cookieCount({ privateBrowsingId: 1 })}`);
      const before = cookieCount({});
      const { ev, done } = await attachmentCase("B private", pw.gBrowser.selectedBrowser, (e) => e.isPrivate === true);
      check("B: the cookie existed only in the private jar", before === 0 && cookieCount({ privateBrowsingId: 1 }) === 1);
      await VitreDownloads.save();
      const store = await IOUtils.readJSON(VitreDownloads.storePath);
      check("B: the private download is not written to the store", !store.items.some((r) => r.id === ev.id), `${store.items.length} item(s) stored`);
      const priv = await Downloads.getList(Downloads.PRIVATE);
      check("B: nothing is left in Firefox's private list", (await priv.getAll()).length === 0);
      const tabOwner = pw.gBrowser.getTabForBrowser(pw.gBrowser.selectedBrowser);
      check("B: the event maps to the private window's tab", ev.tabLabel === tabOwner.label, ev.tabLabel);
      pw.close();
      void done;
    }

    // ---- C: second normal window ----
    if (want("C")) {
      spike.log("--- C: second normal window");
      const w2 = await openWin({});
      w2.resizeTo(1000, 640);
      await loadIn(w2.gBrowser.selectedBrowser, page);
      const { ev } = await attachmentCase("C second window", w2.gBrowser.selectedBrowser, (e) => !e.isPrivate && e.userContextId === 0);
      const bc = BrowsingContext.get(ev.browsingContextId);
      const owner = bc?.top?.embedderElement?.ownerDocument?.defaultView;
      check("C: the event's browsing context belongs to the second window", owner === w2,
        `event bc ${ev.browsingContextId}; w2's selected browser bc ${w2.gBrowser.selectedBrowser.browsingContext.id}; owner is ${owner === window ? "the FIRST window" : owner === w2 ? "w2" : String(owner)}; embedder ${bc?.top?.embedderElement?.localName}`);
      if (ffDir !== dir) {
        const names = async (d) => (await IOUtils.getChildren(d)).map((p) => PathUtils.filename(p));
        check("C: with a scratch folder for Firefox, its placeholder and .part never touch the user's folder", ev.firefoxPart.startsWith(ffDir) && ev.firefoxTarget.startsWith(ffDir) && (await names(ffDir)).length === 0 && (await names(dir)).length === 1,
          `Firefox wrote in ${PathUtils.filename(ffDir)} (now ${JSON.stringify(await names(ffDir))}); user's folder has ${JSON.stringify(await names(dir))}`);
      }
      w2.close();
    }

    // ---- D: other kinds of download ----
    if (want("D")) {
      spike.log("--- D: page2.html");
      const browser = gBrowser.selectedBrowser;
      const page2 = `${H.BASE}/page2.html?token=${Date.now()}`;
      await loadIn(browser, page2);
      const ffCount = async () => (await firefoxList.getAll()).length;

      // tiny attachment
      let n = VitreTakeover.events.length;
      await H.serverReset();
      await click(browser, "small");
      let ev = await nextEvent(n);
      let done = ev.id ? await VitreDownloads.whenSettled(ev.id) : null;
      let files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
      spike.log(`tiny: ${JSON.stringify({ action: ev.action, succeededBeforeAdopt: ev.succeededBeforeAdopt, succeededAfterProbe: ev.succeededAfterProbe, launch: ev.launchWhenSucceeded })}; server saw ${(await H.serverStats()).requests.filter((q) => q.path === "/dl/small").length} request(s); files ${JSON.stringify(files)}`);
      check("D tiny: one file, complete, whoever saved it", files.filter((f) => f.startsWith("tiny")).length === 1 && (await IOUtils.stat(PathUtils.join(dir, "tiny.dat"))).size === 2048, `Vitre state ${done?.state}; Firefox list ${await ffCount()}`);

      // PDF attachment
      n = VitreTakeover.events.length;
      const tabsBefore = gBrowser.tabs.length;
      await click(browser, "pdf");
      ev = await nextEvent(n).catch(() => null);
      if (!ev) {
        const seen = (await H.serverStats()).requests.filter((q) => q.path.startsWith("/dl/pdfdoc")).length;
        spike.log(`pdf attachment: NO download appeared in Firefox's list within 20 s; the server saw ${seen} request(s) for it (Internet Download Manager's driver on this machine intercepts firefox.exe PDF downloads)`);
        ev = { action: "none" };
      }
      done = ev.id ? await VitreDownloads.whenSettled(ev.id) : null;
      await spike.sleep(1500);
      files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
      spike.log(`pdf attachment: ${JSON.stringify({ action: ev.action, launch: ev.launchWhenSucceeded, contentType: ev.contentType, succeededBeforeAdopt: ev.succeededBeforeAdopt, succeededAfterProbe: ev.succeededAfterProbe })}; tabs ${tabsBefore} -> ${gBrowser.tabs.length} (${[...gBrowser.tabs].map((t) => t.linkedBrowser.currentURI.spec.slice(0, 70)).join(" | ")}); files ${JSON.stringify(files)}`);
      check("D pdf attachment: saved once as a .pdf", files.filter((f) => /\.pdf$/i.test(f)).length === 1, `Vitre state ${done?.state}`);
      await spike.capture("takeover2-D-pdf");
      while (gBrowser.tabs.length > tabsBefore) gBrowser.removeTab(gBrowser.tabs[gBrowser.tabs.length - 1]);
      gBrowser.selectedTab = gBrowser.getTabForBrowser(browser);

      // one-time link
      n = VitreTakeover.events.length;
      await H.serverReset();
      await click(browser, "once");
      ev = await nextEvent(n);
      spike.log(`one-time link: ${JSON.stringify({ action: ev.action, target: PathUtils.filename(ev.firefoxTarget) })}`);
      const left = VitreTakeover.lastLeft;
      const finished = await waitFor("Firefox finishing the one-time download", () => left?.succeeded || left?.error, 40000).catch(() => null);
      const oncePath = PathUtils.join(dir, "one-time.dat");
      const onceSha = (await IOUtils.exists(oncePath)) ? await IOUtils.computeHexDigest(oncePath, "sha256") : "";
      const onceReqs = (await H.serverStats()).requests.filter((q) => q.path.startsWith("/dl/once"));
      check("D one-time link: Vitre's probe is refused, Firefox keeps the download and finishes it intact", ev.action.startsWith("left to Firefox") && !!finished && left.succeeded && onceSha === H.SHA.medium,
        `${ev.action}; server saw ${onceReqs.map((q) => q.status).join(",")}; Firefox succeeded=${left?.succeeded} error=${left?.error?.message ?? ""}`);

      // POST download
      n = VitreTakeover.events.length;
      await click(browser, "post");
      ev = await nextEvent(n);
      await spike.sleep(1200);
      files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
      spike.log(`POST: ${JSON.stringify({ action: ev.action, url: ev.url })}; files ${JSON.stringify(files)}`);
      check("D POST download: left to Firefox, file saved", ev.action.startsWith("left to Firefox") && files.includes("posted.dat") && (await IOUtils.stat(PathUtils.join(dir, "posted.dat"))).size === 14 * 4096, ev.action);
      await loadIn(browser, page2);

      // blob:
      n = VitreTakeover.events.length;
      await click(browser, "blob");
      ev = await nextEvent(n);
      await spike.sleep(1200);
      files = (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p));
      const blobSize = files.includes("from-blob.txt") ? (await IOUtils.stat(PathUtils.join(dir, "from-blob.txt"))).size : -1;
      check("D blob: left to Firefox, file saved with its bytes", ev.action.startsWith("left to Firefox") && blobSize === 28, `${ev.action}; ${ev.url.slice(0, 40)}; size ${blobSize}`);

      // inline PDF: not a download at all
      n = VitreTakeover.events.length;
      await click(browser, "pdfinline");
      await spike.sleep(2500);
      check("D inline PDF: Firefox shows it, no download is created", VitreTakeover.events.length === n && /\/view\/pdfdoc$/.test(browser.currentURI.spec), `tab at ${browser.currentURI.spec}; content principal ${browser.contentPrincipal.spec.slice(0, 50)}`);
      await spike.capture("takeover2-D-inline-pdf");
    }

    spike.log("all events:", JSON.stringify(VitreTakeover.events.map((e) => [e.url.slice(0, 50), e.action, e.isPrivate ? "private" : "", e.userContextId])));
    spike.log("Vitre list:", JSON.stringify(VitreDownloads.list().map((v) => [v.filename, v.state, v.total])));
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    Services.prefs.clearUserPref("vitre.verify.started");
  });
}
