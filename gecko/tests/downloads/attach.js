// Phase 3 of spikes/downloader/RESUME-DESIGN.md (section 7), "Refresh address, attach, Keep partial",
// against the local server's /attach.html, /qsigned, /qmint, /onetime and /swap routes
// (tests/downloads/server.py):
//   - click: a clicked link (taken over from Firefox), paused, its signed address expired: Link expired;
//     Refresh address in the panel runs an attempt, opens the page in a foreground tab and arms the row
//     (Waiting for link, the note under the tab pill); a click on the page then continues the same row:
//     one row, no 'added' (no new-row flight) but one 'attached', Firefox's copy gone from the scratch
//     folder, no " (1)" file, only the missing ranges fetched, the file intact;
//   - alt: Alt+click on the page (no Refresh address: the same page and name score) continues the row;
//   - addlink: a fresh address pasted into Add link (the same path and name) continues the row, which
//     the panel selects;
//   - other: an unrelated download clicked in the armed tab makes a new row while the old one keeps
//     waiting;
//   - changed: the same name over other bytes clicked there makes the old row File changed, with no new
//     row and Firefox's copy gone; Start over then downloads that new file from the address the click
//     found, keeping "<name>.old.part" until it is complete;
//   - keep: Keep partial file on a File changed row saves the unbroken beginning as
//     "<stem> (partial).<ext>", byte for byte the old prefix, a completed row with the Mark of the Web;
//   - container: a click in another container never continues a row of the default one; closing the
//     armed tab does not stop the wait, and after its 30 minutes (brought forward) it lapses;
//   - renew: Refresh address whose original address works again renews at once (Renewing link) and
//     opens no page;
//   - private: the same in a private window: Refresh address opens the page there, the click continues
//     the row, and the private row is never written to the store or its .bak.
// From the review of Phase 3:
//   - addlink: the row an Add link continued keeps its page (Open page, Refresh address later);
//   - othername: the same name on another page, clicked in the armed tab, is another file: a row of its
//     own, the waiting row untouched;
//   - endpoint: two files behind one script (/fetch?f=, /fetch.html): Add link and a click of the other
//     file make rows of their own (the panel selects the new one), never File changed; so does a click
//     when neither has a Content-Disposition name (anon);
//   - quiet: the real file changed with under 1 MiB saved: the click starts the row over from the new file
//     without asking (the owner's decision 1), keeping "<name>.old.part" until it is done;
//   - race: a start again while an attempt of the schedule hangs continues the row (the attempt gives
//     way);
//   - chosen: a start the person sent to a folder of their choice makes its own row;
//   - keeprace: Resume during Keep partial's last step starts nothing; Keep partial says it deletes the
//     part an earlier Start over set aside, and does;
//   - peek: a click in a peek sheet that continues a row flies from the sheet's header and is announced.
// VITRE_DL_ONLY=a,b runs only those sections: click, alt, addlink, other, changed (needs other), keep,
// container, renew, private, othername, endpoint, anon, quiet, race, chosen, keeprace, peek.
/* global spike, Services, ChromeUtils, IOUtils, PathUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const MiB = 1 << 20;
  const medium = m["medium.bin"];
  const store = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);

  /** Every engine event, for "no new-row flight": the kinds and ids since `mark()`. */
  const events = [];
  engine.subscribe((e) => {
    if (e.kind === "added" || e.kind === "attached") events.push({ kind: e.kind, id: e.view.id, name: e.view.filename });
  });
  const since = (n) => events.slice(n);

  const settled = (id, what) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && v.phase !== "renewing" && ["paused", "failed", "completed", "cancelled"].includes(v.state) ? v : null;
      },
      { timeout: 90000, interval: 100, what }
    );
  const pauseAt = async (id, bytes, what) => {
    const v = await DL.until(id, ["downloading", "paused", "failed", "completed", "cancelled"], { test: (x) => x.state !== "downloading" || x.received > bytes, timeout: 30000, what });
    if (v.state === "downloading") engine.pause(id);
    return settled(id, what + " to pause");
  };
  const requests = async () => {
    let reqs = [];
    for (let i = 0; i < 50; i++) {
      reqs = (await DL.stats()).requests;
      if (reqs.every((x) => x.start === undefined || x.sent !== undefined)) break;
      await sleep(100);
    }
    return reqs;
  };
  const brief = (reqs) => reqs.map((r) => `${r.status} ${r.path.split("?")[0].slice(0, 28)} ${r.range || "-"} ${r.ifrange || "-"}`);
  const sentIn = (reqs) => reqs.reduce((n, r) => n + (r.sent || 0), 0);
  /** Ranges that continue the download: If-Range carried, not the resume probe's window 0. */
  const pulls = (reqs) => reqs.filter((r) => r.status === 206 && r.end > r.start && r.ifrange && r.range !== "bytes=0-65535");
  /** The expiry time of the first /qsigned address in the log. */
  const expiresOf = (reqs) => {
    const r = reqs.find((x) => x.path.startsWith("/qsigned/") && /Expires=\d+/.test(x.path));
    return r ? Number(/Expires=(\d+)/.exec(r.path)[1]) * 1000 : 0;
  };
  const scratch = async () => (await IOUtils.getChildren(engine.scratch)).map((p) => PathUtils.filename(p));
  const exists = (p) => IOUtils.exists(p);
  const rec = (id) => engine.recs.find((r) => r.id === id);
  const browserIdOf = (browser) => Number(browser?.browsingContext?.browserId) || 0;
  /** Load `url` in a window's active tab and wait for it. */
  const openIn = async (win, url) => {
    const vb = win.vitre;
    const t = vb.active();
    vb.navigate(t.id, url);
    await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "load of " + url });
    await sleep(400);
    return t;
  };
  /** The take-over of a click made after `n` take-overs, by its action. */
  const takeover = (n, test, what) => waitFor(() => engine.takeovers.slice(n).find(test), { timeout: 20000, what });

  /**
   * A clicked download from /attach.html (key, name), paused, whose signed address then expired: Resume
   * makes it Link expired (its own address is the expired signed one: nothing to renew from).
   */
  const linkExpired = async (key, name, { win = window, bytes = 2 * MiB, rate = 512, query = "" } = {}) => {
    await DL.reset();
    const page = `${DL.base}/attach.html?k=${key}&ttl=5&name=${encodeURIComponent(name)}&rate=${rate}${query}`;
    await openIn(win, page);
    const n = engine.takeovers.length;
    const click = await DL.clickInPage("#dl", { browser: win.gBrowser.selectedBrowser });
    const taken = await takeover(n, (t) => t.action === "taken over", `the take-over of ${name}`);
    const p = await pauseAt(taken.id, bytes, name);
    const reqs = await requests();
    const expires = expiresOf(reqs);
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the signed address to expire" });
    const sha = await DL.sha256(p.path + ".part");
    await DL.reset();
    engine.resume(taken.id);
    const v = await settled(taken.id, `${name}: Link expired`);
    return { id: taken.id, p, v, sha, page, click };
  };
  /** Refresh address through the engine and the window (store.refresh): the page opens and the row is armed. */
  const refresh = async (win, id) => {
    const vb = win.vitre;
    const tabs = vb.tabs.length;
    const kind = await win.vitreDownloads.store.refresh(id);
    const tab = await waitFor(() => (vb.tabs.length > tabs && engine.get(id)?.armed ? vb.active() : null), { timeout: 15000, what: "the page to open and the row to be armed" });
    await waitFor(() => !tab.loading && tab.browser.currentURI.spec.includes("/attach.html"), { timeout: 20000, what: "the page to load" });
    await sleep(400);
    return { kind, tab };
  };

  // ---- click: Refresh address, then a click on the page continues the row ----
  if (want("click")) {
    const x = await linkExpired("a1", "song.mp3");
    check("a clicked download whose signed address expired during a pause is Link expired, its bytes kept", x.v.state === "paused" && x.v.need?.kind === "address" && x.v.canRenew && (await DL.sha256(x.p.path + ".part")) === x.sha, { state: x.v.state, need: x.v.need, canRenew: x.v.canRenew });

    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(400);
    const row = () => b.root.querySelector(`.vd-row[data-id="${x.id}"]`);
    row().scrollIntoView({ block: "nearest" });
    spike.click(row().querySelector(".vd-name"));
    await sleep(500);
    const primary = row().querySelector(".primary");
    check("the Link expired row's primary verb is Refresh address", primary.getAttribute("aria-label") === "Refresh address song.mp3", primary.getAttribute("aria-label"));
    const tabs = b.tabs.length;
    const before = b.active();
    spike.click(primary);
    const tab = await waitFor(() => (b.tabs.length > tabs && engine.get(x.id)?.armed ? b.active() : null), { timeout: 15000, what: "the page to open and the row to be armed" });
    await waitFor(() => !tab.loading && tab.browser.currentURI.spec === x.page, { timeout: 20000, what: "the page to load" });
    await sleep(600);
    const armed = engine.get(x.id);
    const catcher = rec(x.id)?.catcher;
    check("Refresh address found nothing, opened the page in a new foreground tab and closed the panel", tab !== before && b.activeId === tab.id && tab.url === x.page && !ui.panel.open, { url: tab.url, panel: ui.panel.open });
    check("the row waits for the link for 30 minutes, armed with that tab (Waiting for link)", armed.armed && armed.state === "paused" && armed.need?.kind === "address" && catcher?.browserId === browserIdOf(tab.browser) && catcher.until - Date.now() > 29 * 60000, { armed: armed.armed, catcher, tab: browserIdOf(tab.browser) });
    const note = b.root.querySelector(".vd-note");
    const pct = Math.floor((armed.received / armed.total) * 100);
    check("the note under the tab pill says what to do, with Stop waiting", !!note && note.textContent.includes(`Start song.mp3 again on this page.Deer continues from ${pct}%.`) && note.querySelector(".vd-note-act")?.textContent === "Stop waiting", note?.textContent);
    await spike.capture("attach-1-waiting-for-link");

    const n = engine.takeovers.length;
    const e0 = events.length;
    const count = engine.list(false).length;
    await DL.reset();
    await DL.clickInPage("#dl");
    const t = await takeover(n, (t) => t.id === x.id || t.action === "taken over", "the click to be caught");
    check("the click on the page is caught and continues the waiting row", t.action === "attached" && t.id === x.id, t);
    await sleep(300);
    const left = await scratch();
    check("Firefox's copy is gone from the scratch folder at once", left.length === 0, left);
    const pill = b.root.querySelector(".vd-note");
    check("the note says the download continues", !!pill && pill.textContent.includes(`Continuing song.mp3 from ${pct}%`), pill?.textContent);
    const d = await settled(x.id, "the continued download");
    const reqs = await requests();
    const fetched = sentIn(pulls(reqs));
    const ev = since(e0);
    log("click", { reqs: brief(reqs).slice(0, 8), events: ev });
    check("one row: no new record, no 'added' (no new-row flight), one 'attached' for the old row", engine.list(false).length === count && !ev.some((e) => e.kind === "added") && ev.filter((e) => e.kind === "attached").length === 1 && ev[0]?.id === x.id, ev);
    check("it completed intact under its own name, with no ' (1)' file", d.state === "completed" && d.filename === "song.mp3" && (await DL.sha256(d.path)) === medium.sha256 && !(await DL.files()).some((f) => /song \(1\)/.test(f)), { state: d.state, filename: d.filename, error: d.error, files: await DL.files() });
    check("only the missing ranges were fetched", fetched === medium.size - x.p.received, { fetched, missing: medium.size - x.p.received });
    check("the scratch folder is still empty, and the row says where it continued from", (await scratch()).length === 0 && d.history.some((h) => h.text === "Continued from its page") && d.url !== x.v.url, d.history);
    check("the click's requests carried the page's cookie and Referer", pulls(reqs).every((r) => r.cookie.includes("sid=vitre-secret") && r.referer.includes("/attach.html")), pulls(reqs).map((r) => [r.cookie, r.referer]).slice(0, 2));
  }

  // ---- alt: Alt+click on the page continues the row ----
  if (want("alt")) {
    const x = await linkExpired("b1", "alt.mp3");
    check("alt: Link expired", x.v.need?.kind === "address", [x.v.state, x.v.need]);
    // The same page again in the same tab: a fresh address on it.
    await DL.reset();
    await openIn(window, x.page);
    const e0 = events.length;
    const count = engine.list(false).length;
    await DL.clickInPage("#dl", { altKey: true });
    await waitFor(() => since(e0).length, { timeout: 15000, what: "the Alt+click to be decided" });
    const d = await settled(x.id, "the Alt+click download");
    const reqs = await requests();
    check("Alt+click on the page continues the waiting row (the same page and name): one row, 'attached', no 'added'", engine.list(false).length === count && since(e0).every((e) => e.kind === "attached" && e.id === x.id), since(e0));
    check("it completed intact, only the missing ranges fetched, no ' (1)'", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && sentIn(pulls(reqs)) === medium.size - x.p.received && !(await DL.files()).some((f) => /alt \(1\)/.test(f)), { state: d.state, error: d.error, fetched: sentIn(pulls(reqs)), missing: medium.size - x.p.received });
  }

  // ---- addlink: a fresh address pasted into Add link continues the row ----
  if (want("addlink")) {
    const x = await linkExpired("c1", "pasted.mp3");
    check("addlink: Link expired", x.v.need?.kind === "address", [x.v.state, x.v.need]);
    const minted = (await (await fetch(`${DL.base}/qmint/medium?rate=512`, { cache: "no-store" })).json()).url;
    await DL.reset();
    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(300);
    const e0 = events.length;
    const count = engine.list(false).length;
    spike.click(b.root.querySelector(".vd-add-btn"));
    await sleep(200);
    const input = b.root.querySelector(".vd-add input");
    input.value = `${DL.base}${minted}`;
    spike.click(b.root.querySelector(".vd-add-go"));
    await waitFor(() => since(e0).length, { timeout: 15000, what: "the pasted link to be decided" });
    await sleep(400);
    const selected = b.root.querySelector('.vd-row[aria-selected="true"]')?.dataset.id;
    // Review of Phase 3: Add link has no page; the row keeps its own, its container and privacy, and the
    // pasted address is asked with no Referer, as Use another address… asks one.
    const kept = engine.get(x.id);
    const target = engine.openPage(x.id);
    const identity = rec(x.id).identity;
    check("the row Add link continued keeps its page: From page, Open page and Refresh address still have it", kept.pageUrl === x.page && target?.pageUrl === x.page && identity.userContextId === 0 && !identity.isPrivate && identity.referrerPolicy === "no-referrer", { pageUrl: kept.pageUrl, target, identity });
    const d = await settled(x.id, "the Add link download");
    const reqs = await requests();
    check("Add link with a fresh address of the file (the same path and name) continues the waiting row, which the panel selects", engine.list(false).length === count && since(e0).every((e) => e.kind === "attached" && e.id === x.id) && selected === x.id, { events: since(e0), selected, id: x.id });
    check("it completed intact from the pasted address (asked with no Referer), only the missing ranges fetched", d.state === "completed" && d.url === `${DL.base}${minted}` && (await DL.sha256(d.path)) === medium.sha256 && sentIn(pulls(reqs)) === medium.size - x.p.received && pulls(reqs).every((r) => !r.referer) && d.history.some((h) => h.text === "Continued from another address") && d.pageUrl === x.page, { state: d.state, url: d.url, fetched: sentIn(pulls(reqs)), referers: pulls(reqs).map((r) => r.referer).slice(0, 2), pageUrl: d.pageUrl });
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
  }

  // ---- other, changed: an unrelated download, then the same name over other bytes, in the armed tab ----
  let waiting = null;
  if (want("other")) {
    waiting = await linkExpired("d1", "wait.mp3");
    const r = await refresh(window, waiting.id);
    check("other: Refresh address opened the page and armed the row", r.kind === "page" && engine.get(waiting.id).armed, r.kind);
    const n = engine.takeovers.length;
    const e0 = events.length;
    await DL.reset();
    await DL.clickInPage("#other");
    const t = await takeover(n, () => true, "the unrelated download");
    const added = await waitFor(() => since(e0).find((e) => e.kind === "added"), { timeout: 10000, what: "the new row" });
    const o = await settled(t.id, "the unrelated download");
    const w = engine.get(waiting.id);
    check("an unrelated download clicked in the armed tab makes a new row of its own", t.action === "taken over" && t.id !== waiting.id && added.id === t.id && o.state === "completed" && o.filename === "other.bin", { t, added, state: o.state, filename: o.filename });
    check("the old row keeps waiting (Waiting for link), its bytes untouched", w.state === "paused" && w.need?.kind === "address" && w.armed && (await DL.sha256(waiting.p.path + ".part")) === waiting.sha, { state: w.state, need: w.need, armed: w.armed });
  }
  if (want("changed") && waiting) {
    const n = engine.takeovers.length;
    const e0 = events.length;
    const count = engine.list(false).length;
    await DL.reset();
    await DL.clickInPage("#changed");
    const t = await takeover(n, () => true, "the changed download");
    await sleep(300);
    const w = await settled(waiting.id, "the File changed verdict");
    check("the same name over other bytes, clicked on the page: the old row becomes File changed, no new row", t.action === "changed" && t.id === waiting.id && w.need?.kind === "choice" && /first bytes are different/.test(w.need.evidence) && engine.list(false).length === count && !since(e0).length, { t, need: w.need, events: since(e0) });
    check("Firefox's copy is gone and the old part is untouched", (await scratch()).length === 0 && (await DL.sha256(waiting.p.path + ".part")) === waiting.sha && w.received === waiting.p.received, await scratch());
    // Start over downloads the file the click found (need.candidate), keeping the old part aside.
    const swapped = (await (await fetch(`${DL.base}/flag?k=attach-sha&f=medium`, { cache: "no-store" })).json()).sha256;
    const old = waiting.p.path + ".old.part";
    await DL.reset();
    ui.store.run("start-over", waiting.id);
    await DL.until(waiting.id, ["downloading"], { test: (v) => v.received > 1 * MiB, timeout: 30000, what: "the new file to start" });
    check("Start over keeps the old partial as <name>.old.part while the new file downloads", (await exists(old)) && (await DL.sha256(old)) === waiting.sha);
    const d = await settled(waiting.id, "the new file");
    const reqs = await requests();
    check("the new file comes from the address the click found, under the same name", d.state === "completed" && d.filename === "wait.mp3" && (await DL.sha256(d.path)) === swapped && reqs.some((r) => r.path.includes("xor=1")), { state: d.state, filename: d.filename, error: d.error });
    check("the old partial goes once the new file is complete", await waitFor(async () => !(await exists(old)), { timeout: 5000, what: "the old partial to go" }).catch(() => false));
  }

  // ---- keep: Keep partial file ----
  if (want("keep")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/swap/medium?val=etag&k=keep&rate=512`, { filename: "keep.bin", named: true });
    const p = await pauseAt(id, 3 * MiB, "the download to keep part of");
    await fetch(`${DL.base}/flag?k=keep`, { cache: "no-store" });
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "File changed");
    check("keep: File changed", v.need?.kind === "choice" && !!v.keep && v.keep.name === "keep (partial).bin" && v.keep.bytes > 0, [v.need, v.keep]);
    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(300);
    const row = b.root.querySelector(`.vd-row[data-id="${id}"]`);
    row.scrollIntoView({ block: "nearest" });
    spike.click(row.querySelector(".vd-name"));
    await sleep(500);
    const details = b.root.querySelector(".vd-details");
    const note = details.querySelector(".vd-d-note").textContent;
    const kp = details.querySelector('[data-act="keep-partial"]');
    check("the details say exactly what Keep partial saves", note.includes(`Keep partial saves the first ${v.keep.bytes < 1 << 20 ? Math.round(v.keep.bytes / 1024) + " KB" : (v.keep.bytes / MiB).toFixed(1) + " MB"} as keep (partial).bin.`) && !!kp && kp.getAttribute("aria-describedby") === "vd-d-cap", note);
    await spike.capture("attach-2-file-changed-keep");
    const bytes = v.keep.bytes;
    spike.click(kp);
    const d = await DL.until(id, ["completed", "failed"], { timeout: 20000, what: "Keep partial" });
    const kept = PathUtils.join(DL.dir, "keep (partial).bin");
    const ours = await IOUtils.read(kept).catch(() => new Uint8Array(0));
    const theirs = await IOUtils.read(PathUtils.join(DL.fix, "medium.bin"), { maxBytes: bytes });
    check("Keep partial saves the unbroken beginning as '<stem> (partial).<ext>', byte for byte the old prefix", d.state === "completed" && d.path === kept && ours.length === bytes && ours.every((x, i) => x === theirs[i]), { state: d.state, path: d.path, size: ours.length, bytes });
    check("the row is completed with a note, the .part is gone, and the file carries the Mark of the Web", /^Kept the first \S+ \S+ of 24 MB$/.test(d.note) && !(await exists(p.path + ".part")) && /ZoneId=3/.test(await DL.motw(kept)), { note: d.note });
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
  }

  // ---- container: a click in another container never continues a row ----
  if (want("container")) {
    Services.prefs.setBoolPref("privacy.userContext.enabled", true);
    const x = await linkExpired("h1", "box.mp3");
    const r = await refresh(window, x.id);
    check("container: the row waits (armed)", r.kind === "page" && engine.get(x.id).armed, r.kind);
    const node = gBrowser.addTab(x.page, { userContextId: 1, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    gBrowser.selectedTab = node;
    await waitFor(() => node.linkedBrowser.currentURI.spec === x.page && !node.linkedBrowser.webProgress?.isLoadingDocument, { timeout: 20000, what: "the container tab" });
    await sleep(500);
    const n = engine.takeovers.length;
    const e0 = events.length;
    await DL.clickInPage("#dl", { browser: node.linkedBrowser });
    const t = await takeover(n, () => true, "the container's download");
    const added = await waitFor(() => since(e0).find((e) => e.kind === "added"), { timeout: 10000, what: "the container's row" });
    const w = engine.get(x.id);
    check("a click in another container (userContextId 1) never continues the default container's row: a new row", node.linkedBrowser.browsingContext.originAttributes.userContextId === 1 && t.action === "taken over" && t.id !== x.id && added.id === t.id && !since(e0).some((e) => e.kind === "attached"), { t, events: since(e0) });
    check("the waiting row is untouched", w.state === "paused" && w.need?.kind === "address" && w.armed && (await DL.sha256(x.p.path + ".part")) === x.sha, [w.state, w.need, w.armed]);
    engine.cancel(t.id);
    gBrowser.removeTab(node);
    // Closing the tab Refresh address opened does not stop the wait (the person may sign in elsewhere
    // first); after its 30 minutes (brought forward: a test reaches into the engine) the row is Link
    // expired again.
    b.closeTab(r.tab.id);
    await sleep(300);
    check("closing the armed tab does not stop the wait", engine.get(x.id).armed);
    rec(x.id).catcher.until = Date.now() + 300;
    engine.armWaits();
    const lapsed = await waitFor(() => (!engine.get(x.id).armed ? engine.get(x.id) : null), { timeout: 5000, what: "the wait to lapse" }).catch(() => engine.get(x.id));
    check("after its 30 minutes the wait lapses: Link expired again, the bytes kept", !lapsed.armed && lapsed.state === "paused" && lapsed.need?.kind === "address" && !rec(x.id).catcher && (await DL.sha256(x.p.path + ".part")) === x.sha, { armed: lapsed.armed, need: lapsed.need });
    // Every file of these pages is medium.bin: a row left waiting would be proven the same file by a
    // later section's start again (the same bytes), so each section's waiting rows go when it ends.
    engine.cancel(x.id);
  }

  // ---- renew: Refresh address finds the original address working again ----
  if (want("renew")) {
    await DL.reset();
    const page = `${DL.base}/attach.html?k=r1&name=renewed.bin`;
    const id = engine.start(`${DL.base}/signed-once/medium?ttl=3&k=p3-renew&rate=512&delay2=1`, { filename: "renewed.bin", named: true, pageUrl: page });
    const p = await pauseAt(id, 2 * MiB, "the download from a once-only address");
    const first = (await requests()).find((x) => x.path.startsWith("/signed/") && /Expires=\d+/.test(x.path));
    const expires = first ? Number(/Expires=(\d+)/.exec(first.path)[1]) * 1000 : 0;
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the signed address to expire" });
    await DL.reset();
    engine.resume(id);
    const v = await settled(id, "Link expired");
    check("renew: Link expired (the original address is gone too)", v.need?.kind === "address", [v.state, v.need]);
    // The site is back: its original address works once more.
    await fetch(`${DL.base}/flag?k=revive-p3-renew`, { cache: "no-store" });
    const tabs = b.tabs.length;
    let renewing = false;
    const watch = setInterval(() => {
      if (engine.get(id)?.phase === "renewing") renewing = true;
    }, 30);
    const kind = await ui.store.refresh(id);
    clearInterval(watch);
    const d = await settled(id, "the renewed download");
    const reqs = await requests();
    check("Refresh address runs a renewal attempt at once (Renewing link); the original address works again, so the row carries on and no page opens", kind === "renewed" && renewing && b.tabs.length === tabs && d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && d.history.some((h) => h.text === "New link found") && sentIn(pulls(reqs)) === medium.size - p.received, { kind, renewing, tabs: b.tabs.length - tabs, state: d.state, error: d.error, fetched: sentIn(pulls(reqs)) });
  }

  // ---- private: the same in a private window, never written ----
  if (want("private")) {
    const pw = await spike.openWindow({ private: true });
    await sleep(500);
    const onDisk = async () => {
      await engine.save(true);
      const a = await IOUtils.readJSON(store).catch(() => ({ items: [] }));
      const bak = await IOUtils.readJSON(store + ".bak").catch(() => ({ items: [] }));
      return [...a.items, ...bak.items];
    };
    const x = await linkExpired("i1", "secret.mp3", { win: pw });
    const pv = engine.get(x.id);
    check("private: a private window's download is Link expired", pv.isPrivate && pv.need?.kind === "address", [pv.isPrivate, pv.need]);
    let written = (await onDisk()).some((r) => r.id === x.id);
    const normalTabs = b.tabs.length;
    const r = await refresh(pw, x.id);
    written ||= (await onDisk()).some((r2) => r2.id === x.id);
    check("Refresh address opens the page in the private window, never the normal one", r.kind === "page" && pw.vitre.active().url === x.page && b.tabs.length === normalTabs && engine.get(x.id).armed, { kind: r.kind, url: pw.vitre.active().url, normal: b.tabs.length - normalTabs });
    const e0 = events.length;
    await DL.reset();
    await DL.clickInPage("#dl", { browser: pw.gBrowser.selectedBrowser });
    await waitFor(() => since(e0).length, { timeout: 15000, what: "the private click to be decided" });
    const d = await settled(x.id, "the private download");
    written ||= (await onDisk()).some((r2) => r2.id === x.id);
    check("the click in the private window continues the private row", since(e0).every((e) => e.kind === "attached" && e.id === x.id) && d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256, { events: since(e0), state: d.state, error: d.error });
    check("the private row was never written to the store or its .bak", !written);
    pw.close();
    await waitFor(() => !engine.list(true).length, { timeout: 10000, what: "private downloads to go with the last private window" });
  }

  // ---- review of Phase 3 ----

  /** The address of a link on a page, as the page has it now (fresh tokens on every load). */
  const linkOn = async (page, id) => {
    const html = await (await fetch(page, { cache: "no-store" })).text();
    const m = new RegExp(`id="${id}" href="([^"]+)"`).exec(html);
    return m ? DL.base + m[1].replace(/&amp;/g, "&") : "";
  };
  const swappedSha = async () => (await (await fetch(`${DL.base}/flag?k=attach-sha&f=medium`, { cache: "no-store" })).json()).sha256;

  // ---- othername: the same name on another page, clicked in the armed tab, is another file ----
  if (want("othername")) {
    const x = await linkExpired("e1", "plain.bin");
    const r = await refresh(window, x.id);
    check("othername: Refresh address opened the page and armed the row", r.kind === "page" && engine.get(x.id).armed, r.kind);
    // The armed tab goes to another page, whose link serves another (64 KiB) file under the same name.
    await openIn(window, `${DL.base}/links.html`);
    const n = engine.takeovers.length;
    const e0 = events.length;
    const count = engine.list(false).length;
    await DL.reset();
    await DL.clickInPage("#plain");
    const t = await takeover(n, () => true, "the plain.bin click");
    const added = await waitFor(() => since(e0).find((e) => e.kind === "added"), { timeout: 10000, what: "a row of its own" }).catch(() => null);
    const o = added ? await settled(added.id, "the other plain.bin") : null;
    const w = engine.get(x.id);
    const reqs = await requests();
    log("othername", { t, events: since(e0), reqs: brief(reqs) });
    check("the same name on another page, clicked in the armed tab, is another file: a row of its own, completed", t.action === "taken over" && !!added && added.id === t.id && engine.list(false).length === count + 1 && o?.state === "completed" && !since(e0).some((e) => e.kind === "attached"), { t, events: since(e0), state: o?.state });
    check("the waiting row keeps waiting, its bytes untouched, and nothing asked its address (another size on another page: not ours, R2)", w.state === "paused" && w.need?.kind === "address" && w.armed && (await DL.sha256(x.p.path + ".part")) === x.sha && !reqs.some((q) => q.path.startsWith("/qsigned/")), { state: w.state, need: w.need, armed: w.armed });
    engine.cancel(x.id);
  }

  // ---- endpoint: two files behind one script; anon: neither named by the server ----
  for (const anon of [false, true]) {
    if (!want(anon ? "anon" : "endpoint")) continue;
    const tag = anon ? "anon" : "endpoint";
    await DL.reset();
    const page = `${DL.base}/fetch.html?k=${tag}&ttl=5&rate=512${anon ? "&anon=1" : ""}`;
    const loaded = Date.now();
    await openIn(window, page);
    let n = engine.takeovers.length;
    await DL.clickInPage("#a");
    const taken = await takeover(n, (t) => t.action === "taken over", `${tag}: the take-over of a`);
    const p = await pauseAt(taken.id, 2 * MiB, `${tag}: a`);
    await waitFor(() => Date.now() > loaded + 5500, { timeout: 20000, interval: 100, what: "the token to expire" });
    const sha = await DL.sha256(p.path + ".part");
    await DL.reset();
    engine.resume(taken.id);
    const v = await settled(taken.id, `${tag}: Link expired`);
    check(`${tag}: a download from one script (/fetch?f=) whose token expired is Link expired`, v.need?.kind === "address", [v.state, v.need, v.filename]);
    const untouched = async () => {
      const w = engine.get(taken.id);
      return w.state === "paused" && w.need?.kind === "address" && (await DL.sha256(p.path + ".part")) === sha;
    };
    if (!anon) {
      // Add link with the other file's address: the same script, another file (a different size, another name).
      const other = await linkOn(page, "b");
      spike.press("Ctrl+J");
      await waitFor(() => ui.panel.open, { what: "the panel" });
      await sleep(300);
      const e0 = events.length;
      const count = engine.list(false).length;
      spike.click(b.root.querySelector(".vd-add-btn"));
      await sleep(200);
      b.root.querySelector(".vd-add input").value = other;
      spike.click(b.root.querySelector(".vd-add-go"));
      const added = await waitFor(() => since(e0).find((e) => e.kind === "added"), { timeout: 15000, what: "the other file's row" }).catch(() => null);
      await sleep(400);
      const selected = b.root.querySelector('.vd-row[aria-selected="true"]')?.dataset.id;
      log("endpoint addlink", { events: since(e0), selected, a: taken.id });
      check("Add link of another file behind the same script makes a row of its own, which the panel selects", !!added && added.id !== taken.id && engine.list(false).length === count + 1 && !since(e0).some((e) => e.kind === "attached") && selected === added.id, { events: since(e0), selected });
      check("the waiting a.bin is not made File changed: still Link expired, its part untouched", await untouched(), engine.get(taken.id).need);
      if (added) {
        const o = await settled(added.id, "b.bin");
        check("that row is the other file, complete", o.state === "completed" && o.filename === "b.bin" && o.received === 3 * MiB, [o.state, o.filename, o.received]);
      }
      spike.press("Escape");
      await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    }
    // A click on the other file, on the same page.
    await openIn(window, page);
    n = engine.takeovers.length;
    const e1 = events.length;
    await DL.reset();
    await DL.clickInPage("#b");
    const t = await takeover(n, () => true, `${tag}: the click on b`);
    const added = await waitFor(() => since(e1).find((e) => e.kind === "added"), { timeout: 15000, what: "the clicked file's row" }).catch(() => null);
    const o = added ? await settled(added.id, `${tag}: b`) : null;
    log(tag, { t, events: since(e1), filename: o?.filename, a: v.filename, reqs: brief(await requests()) });
    check(`${tag}: a click on the other file behind the same script makes a row of its own${anon ? " (no Content-Disposition: the script's name is not the file's)" : ""}`, t.action === "taken over" && !!added && added.id === t.id && o?.state === "completed" && o.received === 3 * MiB && !since(e1).some((e) => e.kind === "attached"), { t, events: since(e1), state: o?.state, received: o?.received });
    check(`${tag}: the waiting row is untouched (not File changed)`, await untouched(), engine.get(taken.id).need);
    engine.cancel(taken.id);
  }

  // ---- quiet: the real file changed with under 1 MiB saved: it starts over without asking ----
  if (want("quiet")) {
    const x = await linkExpired("q1", "quiet.mp3", { bytes: 256 * 1024, rate: 64, query: "&crate=1024" });
    check("quiet: Link expired with under 1 MiB saved", x.v.need?.kind === "address" && x.v.received > 0 && x.v.received <= MiB, [x.v.need, x.v.received]);
    const swapped = await swappedSha();
    await openIn(window, x.page);
    const n = engine.takeovers.length;
    const e0 = events.length;
    const count = engine.list(false).length;
    await DL.reset();
    await DL.clickInPage("#changed");
    const t = await takeover(n, () => true, "the changed click");
    const old = x.p.path + ".old.part";
    const going = await DL.until(x.id, ["queued", "downloading", "completed"], { timeout: 15000, what: "the row to start over" }).catch(() => engine.get(x.id));
    const kept = await exists(old);
    const d = await settled(x.id, "the new file");
    log("quiet", { t, events: since(e0), state: going.state, need: going.need, kept });
    check("the real file with other bytes and under 1 MiB saved: the click starts the row over from the new file, no question, no new row", t.action === "changed" && t.id === x.id && going.state !== "paused" && engine.list(false).length === count && !since(e0).some((e) => e.kind === "added") && since(e0).filter((e) => e.kind === "attached" && e.id === x.id).length === 1, { t, state: going.state, need: going.need, events: since(e0) });
    check("the old part waits as <name>.old.part until the new file is complete, then goes; the new file is the site's", kept && d.state === "completed" && d.filename === "quiet.mp3" && (await DL.sha256(d.path)) === swapped && !(await exists(old)), { kept, state: d.state, error: d.error });
  }

  // ---- race: a start again while an attempt of the schedule runs ----
  if (want("race")) {
    await DL.reset();
    const page = `${DL.base}/attach.html?k=r2&name=race.bin`;
    const id = engine.start(`${DL.base}/signed-once/medium?ttl=3&k=p3fix-race&rate=512`, { filename: "race.bin", named: true, pageUrl: page });
    const p = await pauseAt(id, 2 * MiB, "race");
    const first = (await requests()).find((x) => x.path.startsWith("/signed/") && /Expires=\d+/.test(x.path));
    const expires = first ? Number(/Expires=(\d+)/.exec(first.path)[1]) * 1000 : 0;
    await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the signed address to expire" });
    engine.resume(id);
    const v = await settled(id, "race: Link expired");
    check("race: Link expired", v.need?.kind === "address", [v.state, v.need]);
    const mint = async () => DL.base + (await (await fetch(`${DL.base}/qmint/medium?rate=512&name=race.bin`, { cache: "no-store" })).json()).url;
    // The original address now hangs; an attempt of the schedule runs (Renewing link).
    await fetch(`${DL.base}/flag?k=hang-p3fix-race`, { cache: "no-store" });
    rec(id).wait = { ...(rec(id).wait ?? { for: "address", since: Date.now(), tries: 1, status: 403 }), nextAt: Date.now() };
    engine.armWaits();
    await waitFor(() => engine.get(id)?.phase === "renewing", { timeout: 15000, what: "the attempt to run" });
    await DL.reset();
    const e1 = events.length;
    const got = engine.start(await mint(), { pageUrl: page, filename: "race.bin", named: true });
    const ev = await waitFor(() => since(e1).find((e) => e.id === got || e.kind === "added"), { timeout: 15000, what: "the start to be decided" }).catch(() => null);
    log("race", { id, got, events: since(e1) });
    check("a start again while an attempt of the schedule runs continues the waiting row (the attempt gives way): no new row", got === id && ev?.kind === "attached" && !since(e1).some((e) => e.kind === "added"), { got, id, events: since(e1) });
    if (got !== id) engine.cancel(got);
    const d = await settled(id, "the continued race.bin");
    const reqs = await requests();
    check("it completed intact, only the missing ranges fetched", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && sentIn(pulls(reqs)) === medium.size - p.received && !(await DL.files()).some((f) => /race \(1\)/.test(f)), { state: d.state, error: d.error, fetched: sentIn(pulls(reqs)), missing: medium.size - p.received });
  }

  // ---- chosen: a start the person sent to a folder of their choice is theirs ----
  if (want("chosen")) {
    const x = await linkExpired("c2", "chosen.mp3");
    check("chosen: Link expired", x.v.need?.kind === "address", [x.v.state, x.v.need]);
    const minted = DL.base + (await (await fetch(`${DL.base}/qmint/medium?rate=512&name=chosen.mp3`, { cache: "no-store" })).json()).url;
    const elsewhere = PathUtils.join(DL.dir, "elsewhere");
    await IOUtils.makeDirectory(elsewhere, { ignoreExisting: true });
    const e0 = events.length;
    // A folder (dir); Save link as… and Save video as… (saveAs) go the same way, with their dialog.
    const own = engine.start(minted, { pageUrl: x.page, filename: "chosen.mp3", dir: elsewhere });
    await sleep(500);
    check("a start again of the file sent to a folder of the person's choice makes its own row there (never continues the waiting one)", own !== x.id && since(e0).some((e) => e.kind === "added" && e.id === own) && engine.get(own)?.dir === elsewhere && engine.get(x.id).need?.kind === "address" && engine.get(x.id).state === "paused", { own, id: x.id, events: since(e0) });
    engine.cancel(own);
    if (own !== x.id) engine.cancel(x.id);
  }

  // ---- keeprace: Keep partial's last step; the part an earlier Start over set aside ----
  if (want("keeprace")) {
    await DL.reset();
    const id = engine.start(`${DL.base}/swap/medium?val=etag&k=p3fix-keep&rate=512`, { filename: "kr.bin", named: true });
    const p = await pauseAt(id, 3 * MiB, "keeprace");
    await fetch(`${DL.base}/flag?k=p3fix-keep`, { cache: "no-store" });
    engine.resume(id);
    const v = await settled(id, "keeprace: File changed");
    check("keeprace: File changed", v.need?.kind === "choice" && !!v.keep && !v.keep.older, [v.need, v.keep]);
    // An earlier Start over's partial, recorded as startOver() records it (a test reaches into the engine).
    const older = p.path + ".old.part";
    await IOUtils.write(older, new Uint8Array(4096));
    rec(id).oldParts = [older];
    engine.touch(rec(id));
    spike.press("Ctrl+J");
    await waitFor(() => ui.panel.open, { what: "the panel" });
    await sleep(300);
    const row = b.root.querySelector(`.vd-row[data-id="${id}"]`);
    row.scrollIntoView({ block: "nearest" });
    spike.click(row.querySelector(".vd-name"));
    await sleep(500);
    const note = b.root.querySelector(".vd-details .vd-d-note")?.textContent ?? "";
    check("the details say Keep partial also deletes the part an earlier Start over set aside", engine.get(id).keep?.older && /as kr \(partial\)\.bin and deletes the partial file an earlier Start over set aside\.$/.test(note), note);
    spike.press("Escape");
    await waitFor(() => !ui.panel.open, { what: "the panel to close" });
    // Keep partial, then Resume and the row's primary verb (Space) right after the part was moved.
    const tick = () => new Promise((r) => Services.tm.dispatchToMainThread(r));
    const t0 = Date.now() / 1000;
    const pk = engine.keepPartial(id);
    let turns = 0;
    while (turns < 5000 && !rec(id).path.includes("(partial)")) {
      await tick();
      turns++;
    }
    const mid = engine.get(id);
    engine.resume(id);
    ui.store.primary(engine.get(id));
    const after = engine.get(id);
    const started = !!engine.transferInfo(id) || after.state === "queued" || after.state === "downloading";
    await pk;
    await sleep(1500);
    const d = engine.get(id);
    const files = await DL.files();
    const fetched = (await requests()).filter((r) => r.path.startsWith("/swap/") && r.t >= t0);
    log("keeprace", { turns, mid: [mid.state, mid.need?.kind ?? "", mid.path], after: after.state, started, end: [d.state, d.path, d.note], files, fetched: brief(fetched) });
    check("Resume during Keep partial's last step starts nothing: completed, no new .part, nothing fetched", rec(id).path.includes("(partial)") && mid.state === "paused" && !started && d.state === "completed" && !engine.transferInfo(id) && d.path.endsWith("kr (partial).bin") && !files.some((f) => /\.part$/.test(f) && /kr/.test(f)) && !fetched.length, { turns, started, state: d.state, path: d.path, files, fetched: fetched.length });
    check("the part the earlier Start over set aside went with Keep partial, as the row said", !(await exists(older)), files);
  }

  // ---- peek: a click in a peek sheet that continues a row flies from the sheet's header ----
  if (want("peek")) {
    const peek = b.service("peek");
    if (!peek) log("no peek module in this build");
    else {
      const x = await linkExpired("k1", "peek.mp3");
      check("peek: Link expired", x.v.need?.kind === "address", [x.v.state, x.v.need]);
      const flights = [];
      const said = [];
      const fly = ui.ring.fly.bind(ui.ring);
      const announce = ui.ring.announce.bind(ui.ring);
      ui.ring.fly = (from, view) => {
        flights.push({ from, id: view.id });
        fly(from, view);
      };
      ui.ring.announce = (text) => {
        said.push(text);
        announce(text);
      };
      peek.open(x.page);
      await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec === x.page && !peek.browser().webProgress?.isLoadingDocument, { timeout: 15000, what: "the peek" });
      await sleep(800);
      const header = peek.headerRect();
      const e0 = events.length;
      await DL.reset();
      await DL.clickInPage("#dl", { browser: peek.browser() });
      await waitFor(() => since(e0).length, { timeout: 15000, what: "the peek's click to be decided" });
      await waitFor(() => flights.some((f) => f.id === x.id), { timeout: 5000, what: "the flight" }).catch(() => null);
      const f = flights.find((g) => g.id === x.id)?.from;
      log("peek", { events: since(e0), flights, said, header: header && [header.left, header.top, header.width, header.height] });
      check("a click in a peek sheet continues the row: it flies from the sheet's header and is announced", since(e0).every((e) => e.kind === "attached" && e.id === x.id) && !!f && !!header && f.x >= header.left && f.x <= header.right && f.y >= header.top && f.y <= header.bottom && said.some((s) => /^Continuing peek\.mp3 from \d+%$/.test(s)), { events: since(e0), f, said });
      ui.ring.fly = fly;
      ui.ring.announce = announce;
      peek.close();
      await sleep(600);
      const d = await settled(x.id, "the peek's download");
      check("it completed intact", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256, [d.state, d.error]);
    }
  }
  log("files", await DL.files());
});
