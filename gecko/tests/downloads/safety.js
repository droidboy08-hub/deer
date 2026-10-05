// The downloader's safety rules (review 2 findings 14, 18, 19, 20, 21):
//   1. names: a server's .scf / .lnk / .url names get ".download", a bidi override becomes "_"
//      (Firefox's own validator, naming.ts), whoever names the file (Content-Disposition, a caller);
//   2. Safe Browsing: a stand-in reputation service says dangerous -> the file is deleted and the row
//      fails with the reason; uncommon -> the file waits as "<name>.blocked", Keep file gives it its
//      name, removing the row deletes the waiting file; safe -> completed as before;
//   3. opening an executable that is not an .exe asks first (DownloadIntegration.confirmLaunchExecutable,
//      a stand-in here that says no: nothing is launched);
//   4. page-derived downloads (the 'downloads' service with the page's principal): the server sees
//      the page as Referer under the default policy, none for rel=noreferrer; Alt+click too;
//   5. the Downloads panel at small window sizes: scaled as a whole, no overlapping or cut-off text;
//      Ctrl+J in a popup window opens it in the main window.
/* global spike, Services, Cc, Ci, ChromeUtils, Components, gBrowser, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, log, sleep, waitFor, capture } = spike;
  await DL.init();
  await spike.resize(1280, 800);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const dl = b.service("downloads");
  const page = await DL.open(DL.base + "/links.html");
  const finished = (id, ms = 20000) => DL.until(id, ["completed", "failed", "cancelled"], { timeout: ms });
  const newest = () => engine.list(false).sort((a, c) => c.startedAt - a.startedAt)[0];
  const startNamed = async (name, opts = {}) => {
    const before = new Set(engine.list(false).map((v) => v.id));
    dl.download(DL.base + "/named?name=" + encodeURIComponent(name), { browser: page.browser, ...opts });
    const v = await waitFor(() => engine.list(false).find((x) => !before.has(x.id)), { timeout: 5000, what: "download of " + name });
    return finished(v.id);
  };

  // ---- 1. names ----
  const names = { "evil.scf": "evil.scf.download", "doc.lnk": "doc.lnk.download", "site.url": "site.url.download", "inv‮fdp.exe": "inv_fdp.exe", "desktop.ini": "desktop.ini" };
  const ascii = (t) => t.replace(/[^ -~]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  for (const [name, want] of Object.entries(names)) {
    const v = await startNamed(name);
    check(`name "${ascii(name)}" is saved as "${want}" (Firefox's validator)`, v.state === "completed" && v.filename === want, { state: v.state, filename: ascii(v.filename), error: v.error });
  }
  // A caller's own name (a page's download="" attribute arrives as opts.filename) goes through it too.
  const named = await startNamed("ignored.bin", { filename: "chosen.lnk" });
  check("a caller's filename is validated too (chosen.lnk -> chosen.lnk.download)", named.filename === "chosen.lnk.download", named.filename);
  await DL.clean();

  // ---- 2. Safe Browsing (a stand-in reputation service) ----
  const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  const CONTRACT = "@mozilla.org/reputationservice/application-reputation-service;1";
  const asked = [];
  const V = Ci.nsIApplicationReputationService;
  const mock = {
    QueryInterface: ChromeUtils.generateQI(["nsIApplicationReputationService"]),
    isBinary: (n) => /\.(exe|bin|zip|bat|msi)$/i.test(n),
    isExecutable: (n) => /\.(exe|bat|msi)$/i.test(n),
    queryReputation(query, cb) {
      const name = String(query.suggestedFileName);
      asked.push({ name, source: query.sourceURI?.spec, size: Number(query.fileSize), hash: String(query.sha256Hash ?? "").length, referrer: query.referrerInfo?.originalReferrer?.spec ?? "" });
      const verdict = /danger/.test(name) ? V.VERDICT_DANGEROUS : /uncommon/.test(name) ? V.VERDICT_UNCOMMON : V.VERDICT_SAFE;
      const block = verdict !== V.VERDICT_SAFE;
      Services.tm.dispatchToMainThread(() => (typeof cb === "function" ? cb(block, 0, verdict) : cb.onComplete(block, 0, verdict)));
    },
  };
  const factory = { createInstance: (iid) => mock.QueryInterface(iid), QueryInterface: ChromeUtils.generateQI(["nsIFactory"]) };
  const realCid = registrar.contractIDToCID(CONTRACT);
  const mockCid = Components.ID(Services.uuid.generateUUID().toString());
  registrar.registerFactory(mockCid, "Safety test reputation", CONTRACT, factory);
  // The remote lookup is what needs the hash; the harness turns it off (tools/run.py), so here it is on.
  Services.prefs.setBoolPref("browser.safebrowsing.downloads.remote.enabled", true);
  try {
    const safe = await startNamed("fine.bin");
    check("Safe Browsing: a safe file completes, the service was asked with its name, size and SHA-256", safe.state === "completed" && asked.some((a) => a.name === "fine.bin" && a.size === 65536 && a.hash === 32), asked);
    const bad = await startNamed("danger.bin");
    const badPath = PathUtils.join(DL.dir, "danger.bin");
    check("Safe Browsing: a dangerous file is deleted and the row fails with the reason", bad.state === "failed" && /dangerous/i.test(bad.error) && bad.blocked === "dangerous" && !bad.keepable && !(await IOUtils.exists(badPath)) && !(await IOUtils.exists(badPath + ".blocked")), { state: bad.state, error: bad.error, blocked: bad.blocked, files: await DL.files() });
    const odd = await startNamed("uncommon.bin");
    const oddPath = PathUtils.join(DL.dir, "uncommon.bin");
    check("Safe Browsing: an uncommon file waits aside as .blocked, the row can keep it", odd.state === "failed" && odd.blocked === "uncommon" && odd.keepable && (await IOUtils.exists(oddPath + ".blocked")) && !(await IOUtils.exists(oddPath)), { state: odd.state, error: odd.error, files: await DL.files() });
    // The panel's row offers Keep file.
    dl.openPanel(odd.id);
    await waitFor(() => dl.isPanelOpen(), { timeout: 4000 }).catch(() => null);
    await sleep(600);
    const acts = [...document.querySelectorAll("#vitre-root .vd-panel .vd-d-btn")].map((x) => x.textContent);
    check("the panel's details offer Keep file for it", acts.includes("Keep file"), acts);
    await capture("safety-1-blocked");
    DL.ui().store.run("keep", odd.id);
    const kept = await waitFor(() => engine.get(odd.id)?.state === "completed" && engine.get(odd.id), { timeout: 5000 }).catch(() => null);
    check("Keep file: the file takes its name and the row completes, with a note", !!kept && (await IOUtils.exists(oddPath)) && !(await IOUtils.exists(oddPath + ".blocked")) && /warned/.test(kept.note), kept && { state: kept.state, note: kept.note, files: await DL.files() });
    W_closePanel();
    const odd2 = await startNamed("uncommon-two.bin");
    engine.remove(odd2.id);
    await sleep(500);
    check("removing a blocked row deletes its waiting file", !(await IOUtils.exists(PathUtils.join(DL.dir, "uncommon-two.bin.blocked"))), await DL.files());
  } finally {
    registrar.unregisterFactory(mockCid, factory);
    registrar.registerFactory(realCid, "", CONTRACT, null);
    Services.prefs.clearUserPref("browser.safebrowsing.downloads.remote.enabled");
  }
  await DL.clean();

  // ---- 3. opening an executable that is not an .exe asks first ----
  const { DownloadIntegration } = ChromeUtils.importESModule("resource://gre/modules/DownloadIntegration.sys.mjs");
  const realConfirm = DownloadIntegration.confirmLaunchExecutable;
  const prompts = [];
  DownloadIntegration.confirmLaunchExecutable = async (path) => {
    prompts.push(PathUtils.filename(path));
    return false;
  };
  try {
    const bat = await startNamed("tool.bat");
    check("tool.bat downloaded", bat.state === "completed", bat.error);
    const msg = engine.open(bat.id);
    await sleep(800);
    check("Open on a .bat asks first with Firefox's prompt (answered no: nothing launched)", msg === "" && prompts.includes("tool.bat"), { msg, prompts });
  } finally {
    DownloadIntegration.confirmLaunchExecutable = realConfirm;
  }
  await DL.clean();

  // ---- 4. page-derived downloads: the page's principal and its referrer policy ----
  await DL.reset();
  const principal = page.browser.contentPrincipal;
  const plainRef = Cc["@mozilla.org/referrer-info;1"].createInstance(Ci.nsIReferrerInfo);
  plainRef.init(Ci.nsIReferrerInfo.EMPTY, true, Services.io.newURI(DL.base + "/links.html"));
  const p1 = await startNamed("page-plain.bin", { triggeringPrincipal: principal, referrerInfo: plainRef });
  const noRef = Cc["@mozilla.org/referrer-info;1"].createInstance(Ci.nsIReferrerInfo);
  noRef.init(Ci.nsIReferrerInfo.NO_REFERRER, false, Services.io.newURI(DL.base + "/links.html"));
  const p2 = await startNamed("page-noref.bin", { triggeringPrincipal: principal, referrerInfo: noRef });
  let st = await DL.stats();
  const reqs = (n) => st.requests.filter((r) => r.path.includes("name=" + n));
  log("page-derived requests", { plain: reqs("page-plain.bin"), noref: reqs("page-noref.bin") });
  check("page principal, default policy: the page is the Referer (same origin: its full address)", p1.state === "completed" && reqs("page-plain.bin").length > 0 && reqs("page-plain.bin").every((r) => r.referer === DL.base + "/links.html"), reqs("page-plain.bin"));
  check("page principal, no-referrer policy: no Referer on any request", p2.state === "completed" && reqs("page-noref.bin").length > 0 && reqs("page-noref.bin").every((r) => r.referer === ""), reqs("page-noref.bin"));
  // Alt+click on a rel=noreferrer link (the page module reads the link's policy).
  await DL.reset();
  const before = engine.list(false).length;
  const click = await DL.clickInPage("#noref", { altKey: true });
  check("Alt+click is trusted", click.found && click.trusted === true, click);
  const alt = await waitFor(() => engine.list(false).length > before && newest(), { timeout: 8000, what: "Alt+click download" }).catch(() => null);
  if (alt) await finished(alt.id);
  st = await DL.stats();
  log("Alt+click requests", reqs("noref.bin"));
  check("Alt+click on a rel=noreferrer link: downloaded with no Referer", !!alt && reqs("noref.bin").length > 0 && reqs("noref.bin").every((r) => r.referer === ""), reqs("noref.bin"));
  await DL.clean();

  // ---- 5. the panel at small sizes; Ctrl+J from a popup window ----
  const leaves = (root) => [...root.querySelectorAll("*")].filter((el) => {
    if (el.children.length && [...el.children].some((c) => c.textContent.trim())) return false;
    if (!el.textContent.trim() && !/button|input/.test(el.localName)) return false;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  });
  const measure = (panel) => {
    const pr = panel.getBoundingClientRect();
    const els = leaves(panel);
    let overlaps = 0;
    for (let i = 0; i < els.length; i++) {
      const a = els[i].getBoundingClientRect();
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const c = els[j].getBoundingClientRect();
        if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 3 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 3) overlaps++;
      }
    }
    const cut = els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1;
    }).length;
    return { w: Math.round(pr.width), h: Math.round(pr.height), overlaps, cut };
  };
  dl.download(DL.base + "/blob/medium?rate=400", { browser: page.browser });
  await waitFor(() => engine.list(false).some((v) => v.received > 0), { timeout: 15000 }).catch(() => null);
  for (const [w, h] of [[640, 480], [480, 360]]) {
    await spike.resize(w, h);
    await sleep(500);
    dl.openPanel();
    await waitFor(() => dl.isPanelOpen(), { timeout: 4000 }).catch(() => null);
    await sleep(700);
    const m = measure(document.querySelector("#layer-downloads-panel .vd-panel"));
    log(`panel at ${w}x${h}`, m);
    check(`the Downloads panel at ${w}x${h}: scaled whole, no overlapping or cut-off text`, m.overlaps === 0 && m.cut === 0 && m.w <= window.innerWidth - 30, m);
    await capture(`safety-panel-${w}x${h}`);
    W_closePanel();
    await sleep(400);
  }
  await spike.resize(1280, 800);
  await sleep(400);
  // A real popup window (window.open with features, Firefox's default restriction).
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  const wins = () => [...Services.wm.getEnumerator("navigator:browser")].filter((x) => !x.closed);
  await DL.clickInPage("#pop");
  const popup = await waitFor(() => wins().find((x) => x !== window && x.vitre?.isPopup && x.vitre?.ready), { timeout: 15000, what: "popup window" }).catch(() => null);
  Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
  await sleep(500);
  check("a popup window opened", !!popup, wins().length);
  popup.vitre?.run("downloads");
  await sleep(1000);
  const inPopup = !!popup.vitre?.service("downloads")?.isPanelOpen();
  const inMain = dl.isPanelOpen();
  check("Ctrl+J (the downloads action) in a popup window opens the panel in the main window", !inPopup && inMain, { inPopup, inMain });
  W_closePanel();
  popup?.close();
  await waitFor(() => !popup || popup.closed, { timeout: 5000 }).catch(() => null);
  for (const v of engine.list(false)) engine.cancel(v.id);
  await DL.clean();

  function W_closePanel() {
    if (dl.isPanelOpen()) DL.ui().panel.hide();
  }
});
