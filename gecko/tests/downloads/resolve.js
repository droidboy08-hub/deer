// Phase 7 of spikes/downloader/RESUME-DESIGN.md (section 7), "Background page resolver" (G1 automatic step 3,
// G2 automatic step 4, decisions 6 and 7), against the local server's /page/<id>.html, /pfile, /signin.html and
// /vod-page.html routes (tests/downloads/server.py). Each download starts from a page's first signed address,
// pauses, and resumes after that address expired: the run finds nothing at its original address, and the page
// is opened out of sight.
//   - renew: renewed from a link on the page within 30 s (Renewing link meanwhile); b.tabs never changed, no
//     flight ('added' or 'attached'), the hidden tab gone and the closed-tab list as it was; only the missing
//     ranges fetched; asked with the page's own principal (Referer: the page);
//   - history: the page's visit is not in Places (the setting says so), nor any of this suite's hidden pages;
//   - auto: a page that starts the download by itself: claimed (no row, Firefox's copy gone from the scratch
//     folder, its download history gone) and proven;
//   - click: a page whose link needs a click falls back to Link expired within 45 s and is never clicked;
//   - login, elsewhere: a page with a password field, or one that lands on another site: "the page may need you
//     to sign in" (need 'page'), and Open page arms the row;
//   - container: a download of container 1 whose file answers only to a cookie its page set in that container:
//     the hidden page opens in container 1, its cookie reaches the server, and the download completes;
//   - off: the setting off: Link expired as before, no page opened;
//   - budget: seven expiries on one site within an hour: six pages open, the seventh waits for the hour;
//   - private: a private download resolves in the private window and nothing is written (store, .bak, journal,
//     history); with no private window's page step it is never resolved, not even in a normal window;
//   - stream: an HLS stream from the pill whose master and variant tokens expired is renewed from its page's
//     player out of sight and completes, the same row.
// From the review of Phase 7:
//   - twin: another file of the same name and size listed above the row's own does not end the search (2 MiB and
//     256 KiB saved: the row continues from its own file, never File changed, never started over from the other);
//     that file alone is File changed, asked even under 1 MiB saved;
//   - stream2: a stream whose page's player also fetched another stream of the same length (tried first) is
//     renewed from its own one, never File changed;
//   - quiet: a page that plays by itself where the site may autoplay plays muted (never audible);
//   - popup: a page that opens pop-ups where the site allows them opens nothing (window.open gets null), the
//     selection and the tabs stay as they were;
//   - iframe: every frame of the hidden tab is in the claim registry, even one removed as soon as it was added,
//     and a download started from a frame the page then removes is claimed (no row, no flight);
//   - login (with a saved login): the hidden sign-in page is never filled in (a visible one is), and Open page
//     arms the row: Waiting for link, with Stop waiting;
//   - close: a window closed with its page open ends the step at once, and its closed-window entry holds nothing
//     of the page;
//   - order: a step that ends between two Ctrl+clicks leaves the related-tab order alone (its page is parked
//     until the next tab switch, then gone).
// VITRE_DL_ONLY=a,b runs only those sections: renew, auto, click, login, container, off, budget, private, stream,
// twin, stream2, quiet, popup, iframe, close, order.
/* global spike, Services, ChromeUtils, IOUtils, PathUtils, gBrowser, DL, Cc, Ci */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const settings = b.sys("VitreSettings");
  const MiB = 1 << 20;
  const medium = m["medium.bin"];
  const store = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
  const journals = PathUtils.join(PathUtils.profileDir, "vitre-downloads");
  const only = new Set((Services.env.get("VITRE_DL_ONLY") || "").split(",").filter(Boolean));
  const want = (section) => !only.size || only.has(section);
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const SS = window.SessionStore;
  const began = Date.now();

  check("Find new links on the download's page is on by default (the owner's decision 6)", settings.get().renewFromPage === true, settings.get().renewFromPage);

  /** Every engine event that flies a row: 'added' and 'attached'. */
  const events = [];
  engine.subscribe((e) => {
    if (e.kind === "added" || e.kind === "attached") events.push({ kind: e.kind, id: e.view.id, name: e.view.filename });
  });
  const since = (n) => events.slice(n);
  const rec = (id) => engine.recs.find((r) => r.id === id);
  const settled = (id, what, test = null, timeout = 90000) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && v.phase !== "renewing" && ["paused", "failed", "completed", "cancelled"].includes(v.state) && (!test || test(v)) ? v : null;
      },
      { timeout, interval: 100, what }
    );
  const pauseAt = async (id, bytes, what) => {
    const v = await DL.until(id, ["downloading", "paused", "failed", "completed", "cancelled"], { test: (x) => x.state !== "downloading" || x.received > bytes, timeout: 30000, what });
    if (v.state === "downloading") engine.pause(id);
    return settled(id, what + " to pause");
  };
  const requests = async () => (await DL.settledStats()).requests;
  const brief = (reqs) => reqs.map((r) => `${r.status} ${r.path.split("?")[0].slice(0, 30)} ${r.range || "-"}`);
  const sentIn = (reqs) => reqs.reduce((n, r) => n + (r.sent || 0), 0);
  /** Ranges that continue the download: If-Range carried, not the resume probe's window 0. */
  const pulls = (reqs) => reqs.filter((r) => r.status === 206 && r.end > r.start && r.ifrange && r.range !== "bytes=0-65535");
  const pageLoads = (reqs, id) => reqs.filter((r) => r.path.startsWith(`/page/${id}.html`));
  const scratch = async () => (await IOUtils.getChildren(engine.scratch)).map((p) => PathUtils.filename(p));
  const db = await PlacesUtils.promiseDBConnection();
  /** Places visits since `t` whose address contains `part`. */
  const visits = async (part, t = began) =>
    (await db.execute("SELECT h.url AS url, v.visit_type AS type FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id WHERE v.visit_date >= :d", { d: t * 1000 }))
      .map((r) => ({ url: String(r.getResultByName("url")), type: r.getResultByName("type") }))
      .filter((x) => x.url.includes(part));
  /** The tab state the page step must leave as it was: b.tabs, the tab strip, the closed-tab list. */
  const tabState = () => ({ tabs: b.tabs.map((t) => t.id).join(), strip: gBrowser.tabs.length, closed: SS.getClosedTabCountForWindow(window) });
  /** Samples b.tabs while the step runs: it must never change (the hidden tab is not in it). */
  const watchTabs = () => {
    const ids = b.tabs.map((t) => t.id).join();
    const seen = { changed: false, hidden: 0, renewing: false };
    const strip = gBrowser.tabs.length;
    const timer = setInterval(() => {
      if (b.tabs.map((t) => t.id).join() !== ids) seen.changed = true;
      seen.hidden = Math.max(seen.hidden, gBrowser.tabs.length - strip);
    }, 40);
    return {
      seen,
      stop: () => {
        clearInterval(timer);
        return seen;
      },
    };
  };

  /** The address /page/<id>.json mints (its first: `ttl` seconds at 512 KB/s), and the page that shows it. */
  const mint = async (id, query) => {
    const r = await (await fetch(`${DL.base}/page/${id}.json?name=song.mp3${query}`, { cache: "no-store" })).json();
    return DL.base + r.url;
  };
  /**
   * A download of /page/<id>.html's file, started from its first address (valid 5 s), paused with ~2 MiB; with
   * `wait`, until that address expired. The page's later loads give addresses valid for 10 minutes.
   */
  const expired = async (id, q = "", { bytes = 2 * MiB, isPrivate = false, wait = true, rate = 512 } = {}) => {
    await DL.reset();
    const query = `&ttl=5&rate=${rate}${q}`;
    const url = await mint(id, query);
    const page = `${DL.base}/page/${id}.html?name=song.mp3${query}`;
    const did = engine.start(url, { filename: "song.mp3", named: true, pageUrl: page, ...(isPrivate ? { identity: { isPrivate: true } } : {}) });
    const p = await pauseAt(did, bytes, id);
    const expires = Number(/Expires=(\d+)/.exec(url)?.[1] ?? 0) * 1000;
    if (wait) await waitFor(() => Date.now() > expires + 300, { timeout: 20000, interval: 100, what: "the address to expire" });
    const sha = await DL.sha256(p.path + ".part");
    return { id: did, p, page, url, expires, sha };
  };

  // ---- renew: a link on the page, renewed out of sight ----
  if (want("renew")) {
    engine.pageSites.clear();
    // The renewed address at 512 KB/s a connection, as attach.js: the server's byte counts are exact only when a
    // split segment's first connection did not race ahead of it.
    const x = await expired("r1", "&rate2=512");
    await DL.reset();
    const before = tabState();
    const e0 = events.length;
    const w = watchTabs();
    const t0 = Date.now();
    let renewing = false;
    const phase = setInterval(() => {
      if (engine.get(x.id)?.phase === "renewing") renewing = true;
    }, 30);
    engine.resume(x.id);
    const found = await waitFor(() => (rec(x.id)?.events ?? []).some((e) => e.text === "New link found on its page") ? Date.now() : null, { timeout: 45000, interval: 50, what: "the link to be renewed from its page" }).catch(() => 0);
    const d = await settled(x.id, "the renewed download", (v) => v.state !== "paused");
    clearInterval(phase);
    const seenTabs = w.stop();
    await sleep(500);
    const after = tabState();
    const reqs = await requests();
    const loads = pageLoads(reqs, "r1");
    const fetched = sentIn(pulls(reqs));
    log("renew", { took: found - t0, reqs: brief(reqs).slice(0, 12), events: since(e0), hidden: seenTabs.hidden });
    check("renew: the download whose signed address expired is renewed from a link on its page within 30 s, reading Renewing link meanwhile", found > 0 && found - t0 < 30000 && renewing, { took: found - t0, renewing });
    check("renew: it completed intact under its own name, no ' (1)'", d.state === "completed" && d.filename === "song.mp3" && (await DL.sha256(d.path)) === medium.sha256 && !(await DL.files()).some((f) => /song \(1\)/.test(f)), { state: d.state, error: d.error, files: await DL.files() });
    check("renew: only the missing ranges were fetched", fetched === medium.size - x.p.received, { fetched, missing: medium.size - x.p.received });
    check("renew: the page was opened once, out of sight: a hidden tab existed meanwhile, b.tabs never changed", loads.length === 1 && seenTabs.hidden === 1 && !seenTabs.changed, { loads: loads.length, hidden: seenTabs.hidden, changed: seenTabs.changed });
    check("renew: the hidden tab is gone and the tab strip and the closed-tab list are as they were", after.tabs === before.tabs && after.strip === before.strip && after.closed === before.closed, { before, after });
    check("renew: no flight: no 'added' and no 'attached' event", since(e0).length === 0, since(e0));
    const r = rec(x.id);
    check("renew: the row's address is the page's new one, asked with the page's own principal (its Referer the page)", r.url !== x.url && /\/qsigned\/medium\?/.test(r.url) && !!r.identity.principal && pulls(reqs).every((q) => q.referer.startsWith(`${DL.base}/page/r1.html`)), { url: r.url, principal: !!r.identity.principal, referers: pulls(reqs).map((q) => q.referer).slice(0, 2) });
    check("renew: the page step is remembered on the row (at most once per 30 minutes)", r.pageAt >= t0 && r.pageAt <= Date.now(), r.pageAt);
    // ---- history (decision 7): the visit is not in Places, and the setting says so ----
    await sleep(1500);
    const info = await PlacesUtils.history.fetch(x.page, { includeVisits: true });
    const hidden = await visits("/page/r1.html", t0);
    check("history: the hidden page's visit is not in Places", !info?.visits?.length && !hidden.length, { info: !!info, visits: hidden });
  }

  // ---- auto: a page that starts the download by itself ----
  if (want("auto")) {
    engine.pageSites.clear();
    const x = await expired("a1", "&v=auto");
    await DL.reset();
    const n = engine.takeovers.length;
    const e0 = events.length;
    const count = engine.list(false).length;
    const t0 = Date.now();
    engine.resume(x.id);
    const d = await settled(x.id, "the download the page started", (v) => v.state !== "paused");
    const claims = engine.takeovers.slice(n);
    log("auto", { claims, events: since(e0) });
    check("auto: the download the hidden page started by itself was claimed for the row, never taken over as a download", claims.length >= 1 && claims.every((t) => t.action === "claimed" && t.id === x.id), claims);
    check("auto: no row was made and nothing flew", engine.list(false).length === count && since(e0).length === 0, { rows: engine.list(false).length - count, events: since(e0) });
    check("auto: Firefox's copy is gone from the scratch folder", (await scratch()).length === 0, await scratch());
    check("auto: the claimed address was proven the same file and the row completed from it", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && (rec(x.id).events ?? []).some((e) => e.text === "New link found on its page"), { state: d.state, error: d.error });
    await sleep(4000);
    const claimed = claims.find((t) => /^https?:/.test(t.url))?.url ?? "";
    const dl = claimed ? await PlacesUtils.history.fetch(claimed, { includeVisits: true }) : null;
    check("auto: Firefox's download history of the claimed address is gone, and the page's visit is not in Places", !!claimed && !dl?.visits?.length && !(await visits("/page/a1.html", t0)).length, { claimed, visits: dl?.visits?.length });
  }

  // ---- click: a page whose link needs a click ----
  if (want("click")) {
    engine.pageSites.clear();
    const x = await expired("c1", "&v=click");
    await DL.reset();
    const before = tabState();
    const t0 = Date.now();
    engine.resume(x.id);
    const v = await settled(x.id, "the fallback to Link expired", (y) => (rec(x.id)?.pageAt ?? 0) >= t0 && y.need?.kind === "address", 60000);
    const took = Date.now() - t0;
    await sleep(1000);
    const reqs = await requests();
    log("click", { took, reqs: brief(reqs) });
    check("click: a page whose link needs a click falls back within 45 s: Link expired, its bytes kept, the next try planned", took < 45000 && v.state === "paused" && v.need?.kind === "address" && v.nextAt > Date.now() && (await DL.sha256(x.p.path + ".part")) === x.sha, { took, state: v.state, need: v.need, nextAt: v.nextAt });
    check("click: the page was opened once and never clicked (nothing asked /clicked, no address but the first)", pageLoads(reqs, "c1").length === 1 && !reqs.some((r) => r.path.includes("/clicked")) && reqs.filter((r) => r.path.startsWith("/qsigned/")).every((r) => r.path.split("?")[1] === x.url.split("?")[1]), brief(reqs));
    check("click: the tabs are as they were", JSON.stringify(tabState()) === JSON.stringify(before), { before, after: tabState() });
    engine.cancel(x.id);
  }

  // ---- login, elsewhere: the page may need the person to sign in ----
  // Review of Phase 7: with a login saved for the site, Firefox fills the sign-in page in a visible tab (the
  // control) but never the hidden one (its saved logins are kept from it: no fill, no Primary Password prompt).
  let saved = null;
  if (want("login")) {
    Services.prefs.setBoolPref("signon.autofillForms.http", true);
    const li = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
    li.init(DL.base, DL.base, null, "tester@example.com", "deer-test-only", "user", "pw");
    saved = await Services.logins.addLoginAsync(li);
    await DL.reset();
    await DL.open(`${DL.base}/page/lc.html?name=song.mp3&v=login`, { settle: 200 });
    let filled = false;
    for (let i = 0; i < 40 && !filled; i++) {
      await sleep(150);
      filled = (await DL.stats()).requests.some((r) => r.path.startsWith("/page/lc/filled"));
    }
    check("login, the control: Firefox fills the saved login into the sign-in page in a visible tab", filled);
    await DL.open(`${DL.base}/links.html`);
  }
  for (const [tag, v] of [["login", "login"], ["elsewhere", "elsewhere"]]) {
    if (!want("login")) break;
    engine.pageSites.clear();
    const x = await expired(`l-${tag}`, `&v=${v}`);
    await DL.reset();
    const t0 = Date.now();
    engine.resume(x.id);
    const s = await settled(x.id, `${tag}: may need you to sign in`, (y) => (rec(x.id)?.pageAt ?? 0) >= t0 && y.need?.kind !== "address" && !!y.need, 60000).catch(() => engine.get(x.id));
    log(tag, { state: s.state, need: s.need, reqs: brief(await requests()) });
    check(`${tag}: ${tag === "login" ? "a page with a password field" : "a page that lands on another site"} makes the row ask for its page: "The page may need you to sign in."`, s.state === "paused" && s.need?.kind === "page" && /may need you to sign in/.test(s.need.evidence) && (await DL.sha256(x.p.path + ".part")) === x.sha, { state: s.state, need: s.need });
    check(`${tag}: Open page arms the row (a start again there continues it), and its attempts go on`, engine.openPage(x.id)?.arm === true && !!rec(x.id).wait && s.nextAt > Date.now(), { target: engine.openPage(x.id), wait: rec(x.id).wait });
    if (tag === "login") {
      const reqs = await requests();
      check("login: the hidden sign-in page was never filled in with the saved login", pageLoads(reqs, "l-login").length === 1 && !reqs.some((r) => r.path.startsWith("/page/l-login/filled")), brief(reqs));
      spike.press("Ctrl+J");
      await waitFor(() => ui.panel.open, { what: "the panel" });
      await sleep(400);
      const row = b.root.querySelector(`.vd-row[data-id="${x.id}"]`);
      row.scrollIntoView({ block: "nearest" });
      spike.click(row.querySelector(".vd-name"));
      await sleep(500);
      const cap = b.root.querySelector(".vd-details .vd-d-cap")?.textContent ?? "";
      const acts = Array.from(b.root.querySelectorAll(".vd-details [data-act]")).map((x) => x.textContent);
      check("login: the row's caption says \"The page may need you to sign in.\", and its verb is Open page", cap === "The page may need you to sign in." && row.querySelector(".primary")?.getAttribute("aria-label") === `Open page ${s.filename}`, { cap, primary: row.querySelector(".primary")?.getAttribute("aria-label") });
      check("login: its details keep the bytes' other ways back: Open page · Use another address… · Show in folder · Cancel, and its label the saved share", acts.join("|") === "Open page|Use another address…|Show in folder|Cancel" && /percent saved$/.test(row.getAttribute("aria-label")), { acts, label: row.getAttribute("aria-label") });
      await spike.capture("resolve-1-sign-in");
      spike.press("Escape");
      await waitFor(() => !ui.panel.open, { what: "the panel to close" });
      // Out of sight it left no visit (Open page below loads it in a tab, which may).
      check("history: the hidden sign-in page's visit is not in Places", !(await visits("/page/l-login.html", t0)).length);
      // Review of Phase 7: Open page arms the row, and the panel says so (Waiting for link, with Stop waiting).
      const home = b.activeId;
      ui.store.openPage(x.id);
      const armed = await waitFor(() => (engine.get(x.id)?.armed ? engine.get(x.id) : null), { timeout: 15000, what: "the row armed by Open page" }).catch(() => engine.get(x.id));
      // The page it opened takes keys once it has loaded (Ctrl+J goes through it).
      await waitFor(() => (b.active().id !== home && !b.active().loading) || null, { timeout: 15000, what: "the page Open page opened" }).catch(() => null);
      await sleep(800);
      spike.press("Ctrl+J");
      await waitFor(() => ui.panel.open, { what: "the panel" });
      await sleep(400);
      const row2 = b.root.querySelector(`.vd-row[data-id="${x.id}"]`);
      row2.scrollIntoView({ block: "nearest" });
      if (!b.root.querySelector(".vd-details [data-act]")) {
        spike.click(row2.querySelector(".vd-name"));
        await sleep(500);
      }
      const status = row2.querySelector(".vd-status")?.textContent ?? "";
      const acts2 = Array.from(b.root.querySelectorAll(".vd-details [data-act]")).map((n) => n.textContent);
      const cap2 = b.root.querySelector(".vd-details .vd-d-cap")?.textContent ?? "";
      check("login: Open page arms the row and the panel says so: Waiting for link; Open page · Stop waiting · Use another address… · Cancel", armed?.armed === true && status === "Waiting for link" && acts2.join("|") === "Open page|Stop waiting|Use another address…|Cancel" && /^Start it again on 127\.0\.0\.1\. Deer continues from \d+%\.$/.test(cap2), { armed: armed?.armed, status, acts: acts2, cap: cap2 });
      spike.press("Escape");
      await waitFor(() => !ui.panel.open, { what: "the panel to close" });
      for (const t of [...b.tabs]) if (t.id !== home && /\/page\/l-login\.html/.test(t.url)) b.closeTab(t);
      await sleep(300);
    }
    engine.cancel(x.id);
  }
  if (saved) {
    try {
      await Services.logins.removeLoginAsync(saved);
    } catch (e) {
      log("the saved login could not be removed", String(e));
    }
    Services.prefs.clearUserPref("signon.autofillForms.http");
  }

  // ---- container: the page opens in the download's container, whose cookie reaches the server ----
  if (want("container")) {
    engine.pageSites.clear();
    Services.prefs.setBoolPref("privacy.userContext.enabled", true);
    await DL.reset();
    const page = `${DL.base}/page/k1.html?name=song.mp3&ttl=5&rate=512&pc=1`;
    const node = gBrowser.addTab(page, { userContextId: 1, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    gBrowser.selectedTab = node;
    await waitFor(() => node.linkedBrowser.currentURI.spec === page && !node.linkedBrowser.webProgress?.isLoadingDocument, { timeout: 20000, what: "the container tab" });
    await sleep(500);
    const loaded = Date.now();
    const n = engine.takeovers.length;
    await DL.clickInPage("#dl", { browser: node.linkedBrowser });
    const taken = await waitFor(() => engine.takeovers.slice(n).find((t) => t.action === "taken over"), { timeout: 20000, what: "the container's download" });
    const p = await pauseAt(taken.id, 2 * MiB, "the container's download");
    const issued = (await requests()).find((r) => r.path.startsWith("/pfile/k1/"))?.cookie ?? "";
    gBrowser.removeTab(node);
    await waitFor(() => Date.now() > loaded + 5800, { timeout: 20000, interval: 100, what: "the address to expire" });
    await DL.reset();
    engine.resume(taken.id);
    const d = await settled(taken.id, "the container's renewed download", (v) => v.state !== "paused");
    const reqs = await requests();
    const hidden = pageLoads(reqs, "k1");
    const cookie = /pc_k1=\w+/.exec(issued)?.[0] ?? "";
    const jar = (uc) => Services.cookies.getCookiesFromHost("127.0.0.1", { userContextId: uc }).some((c) => c.name === "pc_k1");
    log("container", { issued, hidden: hidden.map((r) => r.cookie), pulls: pulls(reqs).map((r) => r.cookie).slice(0, 2) });
    check("container: the download is container 1's", engine.get(taken.id).userContextId === 1, engine.get(taken.id).userContextId);
    check("container: the hidden page opened in container 1: its request carried the cookie the page set there", !!cookie && hidden.length === 1 && hidden[0].cookie.includes(cookie), { cookie, hidden: hidden.map((r) => r.cookie) });
    check("container: the renewed address answered only to that cookie, and the download completed intact", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && pulls(reqs).length > 0 && pulls(reqs).every((r) => r.cookie.includes(cookie)), { state: d.state, error: d.error });
    check("container: the default container never got the cookie", jar(1) && !jar(0), { one: jar(1), zero: jar(0) });
    void p;
  }

  // ---- off: the setting off disables the step ----
  if (want("off")) {
    engine.pageSites.clear();
    settings.set({ renewFromPage: false });
    await sleep(200);
    const x = await expired("o1");
    await DL.reset();
    const t0 = Date.now();
    engine.resume(x.id);
    const v = await settled(x.id, "Link expired with the setting off", (y) => y.need?.kind === "address");
    await sleep(1500);
    const reqs = await requests();
    const ahead = v.nextAt - t0;
    check("off: with the setting off no page opens: Link expired, the next try in 2 minutes, as before", v.state === "paused" && v.need?.kind === "address" && pageLoads(reqs, "o1").length === 0 && !rec(x.id).pageAt && ahead > 100000 && ahead < 130000, { need: v.need, loads: pageLoads(reqs, "o1").length, ahead });
    settings.set({ renewFromPage: true });
    await sleep(200);
    engine.cancel(x.id);
  }

  // ---- budget: six pages per site per hour; the seventh waits ----
  if (want("budget")) {
    engine.pageSites.clear();
    const rows = [];
    for (let i = 1; i <= 7; i++) rows.push(await expired(`s${i}`, "", { bytes: MiB, wait: false }));
    await waitFor(() => Date.now() > Math.max(...rows.map((r) => r.expires)) + 300, { timeout: 30000, interval: 100, what: "the addresses to expire" });
    await DL.reset();
    const t0 = Date.now();
    for (const r of rows) engine.resume(r.id);
    const ends = await waitFor(
      () => {
        const vs = rows.map((r) => engine.get(r.id));
        const done = vs.filter((v) => v.state === "completed");
        // Waiting for the hour: its next try planned far ahead (a row between its failure and its page step reads
        // paused with its next try now).
        const waiting = vs.filter((v) => v.state === "paused" && v.need?.kind === "address" && v.phase !== "renewing" && !engine.transferInfo(v.id) && v.nextAt > Date.now() + 60000);
        return done.length + waiting.length === 7 ? { done, waiting } : null;
      },
      { timeout: 180000, interval: 200, what: "six renewed, one waiting" }
    );
    const reqs = await requests();
    const loads = rows.map((r, i) => pageLoads(reqs, `s${i + 1}`).length);
    const late = ends.waiting[0];
    log("budget", { loads, done: ends.done.length, waiting: ends.waiting.map((v) => [v.id, v.nextAt - t0]) });
    check("budget: six expiries on one site open six pages and are renewed", ends.done.length === 6 && loads.reduce((a, b2) => a + b2, 0) === 6 && ends.done.every((v) => rec(v.id).events?.some((e) => e.text === "New link found on its page")), { done: ends.done.length, loads });
    check("budget: the seventh within the hour waits: no page opened for it, Link expired with its next try when the hour has room again", ends.waiting.length === 1 && late && !rec(late.id).pageAt && late.nextAt - t0 > 55 * 60000 && loads[rows.findIndex((r) => r.id === late.id)] === 0, { waiting: ends.waiting.length, nextIn: late ? late.nextAt - t0 : 0 });
    for (const r of rows) engine.cancel(r.id);
  }

  // ---- private: in the private window, never written; never without one ----
  if (want("private")) {
    engine.pageSites.clear();
    const pw = await spike.openWindow({ private: true });
    await sleep(800);
    const onDisk = async () => {
      await engine.save(true);
      const a = await IOUtils.readJSON(store).catch(() => ({ items: [] }));
      const bak = await IOUtils.readJSON(store + ".bak").catch(() => ({ items: [] }));
      return [...a.items, ...bak.items];
    };
    const fn = engine.resolvers.get(pw);
    check("private: the private window has its page step", typeof fn === "function");
    const x = await expired("pv1", "", { isPrivate: true });
    let written = (await onDisk()).some((r) => r.id === x.id);
    await DL.reset();
    const normal = gBrowser.tabs.length;
    const priv = pw.gBrowser.tabs.length;
    let inPrivate = 0;
    let inNormal = 0;
    const timer = setInterval(() => {
      inPrivate = Math.max(inPrivate, pw.gBrowser.tabs.length - priv);
      inNormal = Math.max(inNormal, gBrowser.tabs.length - normal);
    }, 40);
    const t0 = Date.now();
    engine.resume(x.id);
    const d = await settled(x.id, "the private download renewed", (v) => v.state !== "paused");
    clearInterval(timer);
    written ||= (await onDisk()).some((r) => r.id === x.id);
    const files = (await IOUtils.getChildren(journals).catch(() => [])).map((p) => PathUtils.filename(p));
    check("private: a private download is renewed from its page, opened out of sight in the private window (never a normal one)", d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256 && inPrivate === 1 && inNormal === 0 && pw.gBrowser.tabs.length === priv, { state: d.state, error: d.error, inPrivate, inNormal });
    check("private: nothing was written: not the store or its .bak, no journal, no history", !written && !files.some((f) => f.startsWith(x.id)) && !(await visits("/page/pv1.html", t0)).length, { written, files: files.filter((f) => f.startsWith(x.id)) });
    // With no private window's page step (as when no private window is open), a private download's page never
    // opens: not in a normal window either.
    engine.setResolver(pw, null);
    engine.pageSites.clear();
    const y = await expired("pv2", "", { isPrivate: true });
    await DL.reset();
    const before = gBrowser.tabs.length;
    let grew = 0;
    const t2 = setInterval(() => (grew = Math.max(grew, gBrowser.tabs.length - before)), 40);
    engine.resume(y.id);
    const v = await settled(y.id, "the private download with no private page step", (z) => z.need?.kind === "address");
    await sleep(1500);
    clearInterval(t2);
    const reqs = await requests();
    check("private: with no private window's page step it is Link expired, its page never opened anywhere", v.state === "paused" && v.need?.kind === "address" && pageLoads(reqs, "pv2").length === 0 && grew === 0 && !rec(y.id).pageAt, { need: v.need, loads: pageLoads(reqs, "pv2").length, grew });
    engine.setResolver(pw, fn);
    engine.cancel(y.id);
    pw.close();
    await waitFor(() => !engine.list(true).length, { timeout: 10000, what: "private downloads to go with the last private window" });
  }

  // ---- stream: the page's player gives the stream's fresh master ----
  if (want("stream")) {
    engine.pageSites.clear();
    const hold = async (k, from) => fetch(`${DL.base}/vod-hold?k=${k}&from=${from}`, { cache: "no-store" });
    const expire = async (k) => fetch(`${DL.base}/vod-expire?k=${k}`, { cache: "no-store" });
    await DL.reset();
    await hold("rs", 6);
    await DL.open(`${DL.base}/vod-page.html?k=rs`, { settle: 1500 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 10000, what: "the pill" });
    const known = new Set(engine.list(false).map((v) => v.id));
    spike.click(b.root.querySelector(".vd-pill-main"), { shiftKey: true });
    const dl = await waitFor(() => engine.list(false).find((v) => !known.has(v.id)), { timeout: 8000, what: "the pill's download" });
    await waitFor(() => (rec(dl.id)?.stream?.tracks?.[0]?.done ?? 0) >= 6, { timeout: 60000, interval: 50, what: "six segments" });
    engine.pause(dl.id);
    await settled(dl.id, "the stream to pause");
    await expire("rs");
    await hold("rs", -1);
    // The visible page goes elsewhere: only the page opened out of sight can renew the stream.
    await DL.open(`${DL.base}/links.html`);
    await DL.reset();
    const before = tabState();
    const rows = engine.list(false).length;
    const e0 = events.length;
    engine.resume(dl.id);
    const done = await DL.until(dl.id, ["completed", "failed"], { timeout: 120000, what: "the renewed stream" });
    const reqs = await requests();
    const pages = reqs.filter((r) => r.path.startsWith("/vod-page.html?k=rs"));
    log("stream", { state: done.state, error: done.error, events: (rec(dl.id).events ?? []).map((e) => e.text), pages: pages.length });
    check("stream: a stream whose master and variant expired is renewed from its page's player, out of sight, and completes as the same row", done.state === "completed" && engine.list(false).length === rows && (rec(dl.id).events ?? []).some((e) => e.text === "New link found on its page") && pages.length === 1, { state: done.state, error: done.error, pages: pages.length });
    check("stream: no flight, and the tabs are as they were", since(e0).length === 0 && JSON.stringify(tabState()) === JSON.stringify(before), { events: since(e0), before, after: tabState() });
    const dur = Number((await DL.probe(done.path))?.format?.duration);
    check("stream: the joined video is complete (24 s)", Math.abs(dur - 24) < 1, dur);
  }

  // ---- stream2 (review of Phase 7): the page's player also fetched another stream of the same length, latest ----
  if (want("stream2")) {
    engine.pageSites.clear();
    const hold = async (k, from) => fetch(`${DL.base}/vod-hold?k=${k}&from=${from}`, { cache: "no-store" });
    await DL.reset();
    await hold("rs2", 6);
    await DL.open(`${DL.base}/vod-page.html?k=rs2`, { settle: 1500 });
    await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
    await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 10000, what: "the pill" });
    const known = new Set(engine.list(false).map((v) => v.id));
    spike.click(b.root.querySelector(".vd-pill-main"), { shiftKey: true });
    const dl = await waitFor(() => engine.list(false).find((v) => !known.has(v.id)), { timeout: 8000, what: "the pill's download" });
    await waitFor(() => (rec(dl.id)?.stream?.tracks?.[0]?.done ?? 0) >= 6, { timeout: 60000, interval: 50, what: "six segments" });
    engine.pause(dl.id);
    await settled(dl.id, "the stream to pause");
    await fetch(`${DL.base}/vod-expire?k=rs2`, { cache: "no-store" });
    await hold("rs2", -1);
    // From now on the page's player also fetches another stream (other bytes, the same length and host), last.
    await fetch(`${DL.base}/flag?k=rs2-twin`, { cache: "no-store" });
    await DL.open(`${DL.base}/links.html`);
    await DL.reset();
    const t0 = Date.now();
    engine.resume(dl.id);
    const done = await waitFor(
      () => {
        const v = engine.get(dl.id);
        return v && (v.state === "completed" || v.state === "failed" || (v.state === "paused" && !!v.need && v.phase !== "renewing" && !engine.transferInfo(dl.id) && (rec(dl.id)?.pageAt ?? 0) >= t0)) ? v : null;
      },
      { timeout: 120000, interval: 100, what: "the stream renewed from its page" }
    ).catch(() => engine.get(dl.id));
    const reqs = await requests();
    const other = reqs.filter((r) => r.path.startsWith("/vod-reenc/rs2-twin/"));
    log("stream2", { state: done.state, need: done.need, error: done.error, events: (rec(dl.id).events ?? []).map((e) => e.text), other: other.map((r) => r.path.slice(0, 50)).slice(0, 6) });
    check("stream2: the page's other stream (fetched last, so tried first) is proven not the stream and the stream's own renews it: the same row completes, never File changed", done.state === "completed" && !done.need && (rec(dl.id).events ?? []).some((e) => e.text === "New link found on its page") && other.some((r) => /\.ts$/.test(r.path.split("?")[0])), { state: done.state, need: done.need, error: done.error, tried: other.length });
    const dur = done.state === "completed" ? Number((await DL.probe(done.path))?.format?.duration) : 0;
    check("stream2: the joined video is complete (24 s)", Math.abs(dur - 24) < 1, dur);
    engine.cancel(dl.id);
  }

  // ---- twin (review of Phase 7): another file of the same name and size listed above the row's own ----
  if (want("twin")) {
    // 2 MiB saved (File changed would ask) and under 1 MiB (it would start over by itself): the row's own file either way.
    for (const [tag, bytes, rate] of [["t2", 2 * MiB, 512], ["t0", 256 * 1024, 64]]) {
      engine.pageSites.clear();
      const x = await expired(`tw-${tag}`, "&v=twin", { bytes, rate });
      await DL.reset();
      const t0 = Date.now();
      engine.resume(x.id);
      const d = await settled(x.id, `twin ${tag}: the row's own file`, (v) => v.state !== "paused" || ((rec(x.id)?.pageAt ?? 0) >= t0 && !!v.need && v.need.kind !== "address"), 90000).catch(() => engine.get(x.id));
      const texts = (rec(x.id).events ?? []).map((e) => e.text);
      const sha = d.state === "completed" ? await DL.sha256(d.path) : "";
      log(`twin ${tag}`, { saved: x.p.received, state: d.state, need: d.need, events: texts, reqs: brief(await requests()).slice(0, 14) });
      check(`twin (${tag === "t2" ? "2 MiB" : "under 1 MiB"} saved): another file of the same name listed above the row's own does not end the search: the row continues from its own file, completes intact, never File changed, never started over`, d.state === "completed" && sha === medium.sha256 && texts.includes("New link found on its page") && !texts.some((t) => /Started over/.test(t)) && (tag === "t2" || x.p.received <= MiB), { state: d.state, need: d.need, saved: x.p.received, events: texts, intact: sha === medium.sha256 });
    }
    // That file alone: the real file over other bytes, but only a link named it: File changed, asked either way.
    for (const [tag, bytes, rate] of [["o2", 2 * MiB, 512], ["o0", 256 * 1024, 64]]) {
      engine.pageSites.clear();
      const x = await expired(`tw-${tag}`, "&v=other", { bytes, rate });
      await DL.reset();
      const t0 = Date.now();
      engine.resume(x.id);
      const v = await settled(x.id, `other ${tag}: File changed`, (y) => y.state !== "paused" || ((rec(x.id)?.pageAt ?? 0) >= t0 && !!y.need && y.need.kind !== "address") || ((rec(x.id)?.pageAt ?? 0) >= t0 && y.need?.kind === "address"), 90000).catch(() => engine.get(x.id));
      const texts = (rec(x.id).events ?? []).map((e) => e.text);
      const candidate = rec(x.id).need?.candidate?.url ?? "";
      log(`other ${tag}`, { saved: x.p.received, state: v.state, need: v.need, candidate, events: texts });
      check(`other (${tag === "o2" ? "2 MiB" : "under 1 MiB"} saved): only another file of the same name on the page: File changed with it kept for Start over, asked even under 1 MiB, the part untouched, never started over from it`, v.state === "paused" && v.need?.kind === "choice" && /xor=1/.test(candidate) && (await DL.sha256(x.p.path + ".part")) === x.sha && !texts.some((t) => /Started over/.test(t)) && (tag === "o2" || x.p.received <= MiB), { state: v.state, need: v.need, candidate, saved: x.p.received, events: texts });
      engine.cancel(x.id);
    }
  }

  // ---- quiet (review of Phase 7): a page that plays by itself where the site may autoplay ----
  if (want("quiet")) {
    engine.pageSites.clear();
    const pm = Services.perms;
    const site = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(DL.base), {});
    pm.addFromPrincipal(site, "autoplay-media", pm.ALLOW_ACTION);
    const x = await expired("q1", "&v=audio");
    await DL.reset();
    const seen = { audible: false, unmuted: false, sound: false, controllers: 0 };
    const timer = setInterval(() => {
      for (const t of gBrowser.tabs) {
        if (t.hasAttribute("soundplaying")) seen.sound = true;
        if (!t.hidden || b.tabs.some((y) => y.node === t)) continue;
        try {
          const mc = t.linkedBrowser?.browsingContext?.mediaController;
          if (!mc) continue;
          seen.controllers++;
          if (mc.isAudible) seen.audible = true;
          if (mc.isPlaying && !mc.isMuted) seen.unmuted = true;
        } catch {
          /* gone */
        }
      }
    }, 25);
    const t0 = Date.now();
    engine.resume(x.id);
    await settled(x.id, "quiet: the page step to end", (y) => (rec(x.id)?.pageAt ?? 0) >= t0 && y.need?.kind === "address", 60000).catch(() => null);
    await sleep(500);
    clearInterval(timer);
    pm.removeFromPrincipal(site, "autoplay-media");
    const reqs = await requests();
    const played = reqs.some((r) => r.path.startsWith("/page/q1/played"));
    log("quiet", { seen, played, clip: reqs.filter((r) => r.path.startsWith("/media/clip")).length });
    check("quiet: the hidden page's player played by itself (the site may autoplay)", played && seen.controllers > 0, { played, seen });
    check("quiet: it played muted throughout: never audible, the hidden tab never 'soundplaying'", !seen.unmuted && !seen.audible && !seen.sound, seen);
    engine.cancel(x.id);
  }

  // ---- popup (review of Phase 7): a page that opens pop-ups where the site allows them ----
  if (want("popup")) {
    engine.pageSites.clear();
    const pm = Services.perms;
    const site = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(DL.base), {});
    pm.addFromPrincipal(site, "popup", pm.ALLOW_ACTION);
    const x = await expired("pp1", "&v=popup");
    await DL.reset();
    const before = tabState();
    const sel = gBrowser.selectedTab;
    const windows = () => [...Services.wm.getEnumerator("navigator:browser")].length;
    const wins0 = windows();
    const most = { tabs: b.tabs.length, strip: before.strip, wins: wins0, moved: false };
    const timer = setInterval(() => {
      if (gBrowser.selectedTab !== sel) most.moved = true;
      most.tabs = Math.max(most.tabs, b.tabs.length);
      most.strip = Math.max(most.strip, gBrowser.tabs.length);
      most.wins = Math.max(most.wins, windows());
    }, 25);
    const t0 = Date.now();
    engine.resume(x.id);
    const d = await settled(x.id, "popup: renewed", (v) => v.state !== "paused" || ((rec(x.id)?.pageAt ?? 0) >= t0 && !!v.need), 60000).catch(() => engine.get(x.id));
    await sleep(1500);
    clearInterval(timer);
    pm.removeFromPrincipal(site, "popup");
    const reqs = await requests();
    const opened = reqs.filter((r) => r.path.startsWith("/page/pp1/opened")).map((r) => r.path.split("?")[1]);
    const after = tabState();
    log("popup", { opened, most, before, after });
    check("popup: the hidden page tried its pop-ups (the site allows them) and window.open gave it no window", opened.length >= 3 && opened.every((q) => /got=0/.test(q)), opened);
    check("popup: no tab or window opened, the selection never moved, nothing a pop-up would show was loaded, the tabs as they were", most.tabs === before.tabs.split(",").length && most.strip <= before.strip + 1 && most.wins === wins0 && !most.moved && JSON.stringify(after) === JSON.stringify(before) && !reqs.some((r) => r.path.startsWith("/links.html")), { most, before, after });
    check("popup: the row was renewed from the page's link all the same", d.state === "completed" && (rec(x.id).events ?? []).some((e) => e.text === "New link found on its page"), { state: d.state, need: d.need });
    // Anything a pop-up opened (the review's failure) goes, so the sections after start as before.
    for (const t of [...b.tabs]) if (/\/links\.html\?popup/.test(t.url)) b.closeTab(t);
    for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (w !== window && !w.closed) w.close();
  }

  // ---- iframe (review of Phase 7): frames the page removes at once, and a download started from one ----
  if (want("iframe")) {
    // Every frame context attached under the hidden tab is in the claim registry, even one removed as soon as it was
    // added (the window's 600 ms samples never saw such a frame: a download it started became a row of its own).
    // Read while the claim lasts (CLAIM_GRACE after the page closed).
    engine.pageSites.clear();
    const frames = [];
    const watch = {
      observe: (s) => {
        try {
          if (s.parent) frames.push({ id: Number(s.id), browserId: Number(s.browserId) });
        } catch {
          /* gone */
        }
      },
    };
    const n2 = engine.takeovers.length;
    const known2 = new Set(engine.list(false).map((v) => v.id));
    Services.obs.addObserver(watch, "browsing-context-attached");
    const fake = { id: "iframe-f2", identity: { pageUrl: `${DL.base}/page/f2.html?name=song.mp3&v=iframe`, userContextId: 0, isPrivate: false }, mode: "file", file: { probed: true }, path: PathUtils.join(DL.dir, "iframe-f2.bin") };
    const seen2 = await engine.visitPage(fake, new AbortController().signal, () => false);
    Services.obs.removeObserver(watch, "browsing-context-attached");
    const mine = frames.filter((f) => f.browserId && f.browserId === seen2.seen?.browserId);
    const unclaimed = mine.filter((f) => !engine.claimOf(0, f.id));
    await sleep(1500);
    const tk2 = engine.takeovers.slice(n2);
    const extra2 = engine.list(false).filter((v) => !known2.has(v.id));
    log("iframe frames", { kind: seen2.kind, frames: mine, unclaimed, takeovers: tk2.map((t) => t.action), claimed: seen2.claimed?.length });
    check("iframe: every frame the hidden page made, even one it removed as soon as it was added, is in the claim registry", seen2.kind === "seen" && mine.length >= 2 && unclaimed.length === 0, { frames: mine, unclaimed });
    check("iframe: the download the page started from a frame it removed was claimed, never a row", tk2.length >= 1 && tk2.every((t) => t.action === "claimed") && extra2.length === 0, { takeovers: tk2, rows: extra2.map((v) => v.filename) });
    for (const v of extra2) engine.cancel(v.id);
    // The same page for a real row: the claimed address is proven and the row completes from it.
    engine.pageSites.clear();
    const x = await expired("f1", "&v=iframe");
    await DL.reset();
    const known = new Set(engine.list(false).map((v) => v.id));
    const n = engine.takeovers.length;
    const e0 = events.length;
    const t0 = Date.now();
    engine.resume(x.id);
    const d = await settled(x.id, "iframe: the download the page started from a frame", (v) => v.state !== "paused" || ((rec(x.id)?.pageAt ?? 0) >= t0 && !!v.need), 90000).catch(() => engine.get(x.id));
    await sleep(1500);
    const tk = engine.takeovers.slice(n);
    const extra = engine.list(false).filter((v) => !known.has(v.id));
    log("iframe", { tk, events: since(e0), state: d.state, extra: extra.map((v) => v.filename) });
    check("iframe: a download the hidden page starts from a frame it then removes is claimed for the row, never taken over as a row of its own", tk.length >= 1 && tk.every((t) => t.action === "claimed" && t.id === x.id), tk);
    check("iframe: no row was made, nothing flew, and the row completed from the claimed address", extra.length === 0 && since(e0).length === 0 && d.state === "completed" && (await DL.sha256(d.path)) === medium.sha256, { extra: extra.map((v) => v.filename), events: since(e0), state: d.state, error: d.error });
    for (const v of extra) engine.cancel(v.id);
  }

  // ---- close (review of Phase 7): a window closed while its page is open ----
  if (want("close")) {
    engine.pageSites.clear();
    const mine = engine.resolvers.get(window);
    const w2 = await spike.openWindow({});
    await sleep(1000);
    // Only the second window's page step is registered, so the step runs there.
    engine.setResolver(window, null);
    const pageUrl = `${DL.base}/page/w1.html?name=song.mp3&v=click`;
    const fake = { id: "close-w1", identity: { pageUrl, userContextId: 0, isPrivate: false }, mode: "file", file: { probed: true }, path: PathUtils.join(DL.dir, "close-w1.bin") };
    let doneAt = 0;
    const visit = engine.visitPage(fake, new AbortController().signal, () => false).then(
      (v) => ((doneAt = Date.now()), v),
      (e) => ((doneAt = Date.now()), { kind: "error", error: String(e) })
    );
    const hiddenIn = (w) => [...w.gBrowser.tabs].some((t) => t.hidden && /\/page\/w1\.html/.test(t.linkedBrowser?.currentURI?.spec ?? ""));
    const opened = await waitFor(() => hiddenIn(w2) || null, { timeout: 15000, what: "the page open out of sight in the second window" }).catch(() => false);
    await sleep(1000);
    const closedAt = Date.now();
    w2.close();
    const v = await visit;
    await sleep(1500);
    engine.setResolver(window, mine);
    let kept = "";
    try {
      const raw = SS.getClosedWindowData();
      kept = typeof raw === "string" ? raw : JSON.stringify(raw);
    } catch (e) {
      kept = String(e);
    }
    log("close", { opened, took: doneAt - closedAt, kind: v.kind, outcome: v.seen?.outcome });
    check("close: a window closed while its page is open ends the step at once (not after the engine's 55 s guard)", opened && v.kind === "seen" && doneAt - closedAt < 5000, { opened, took: doneAt - closedAt, kind: v.kind });
    check("close: the closed-window list keeps nothing of the hidden page", !kept.includes("/page/w1.html"), kept.slice(0, 600));
  }

  // ---- order (review of Phase 7): a step that ends between two Ctrl+clicks leaves the related-tab order alone ----
  if (want("order")) {
    engine.pageSites.clear();
    const x = await expired("or1");
    const A = b.active();
    for (const t of [...b.tabs]) if (t !== A) b.closeTab(t);
    await sleep(300);
    const page = "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>Links</title><body style="font:16px sans-serif;padding:40px"><p>` + [1, 2, 3].map((k) => `<a id="l${k}" href="${DL.base}/signin.html?l=${k}">link ${k}</a>`).join("<br>") + `</p></body>`);
    await DL.open(page);
    const ctrlClick = (sel) =>
      DL.frameScript(gBrowser.selectedBrowser, (s) => {
        const el = content.document.querySelector(s);
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, r.left + Math.min(10, r.width / 2), r.top + r.height / 2, { button: 0, clickCount: 1, modifiers: Ci.nsIDOMWindowUtils.MODIFIER_CONTROL }, {});
        return { found: true };
      }, [sel]);
    const order = () => b.tabs.map((t) => (t === A ? "A" : /l=(\d)/.exec(t.url)?.[1] ? "L" + /l=(\d)/.exec(t.url)[1] : "?"));
    await spike.activate();
    for (const k of [1, 2]) {
      const clicked = await ctrlClick("#l" + k);
      await waitFor(() => b.tabs.length === k + 1 || null, { timeout: 8000, what: `link tab ${k} (${JSON.stringify(clicked)}, ${b.tabs.length} tabs: ${b.tabs.map((t) => t.url.slice(0, 40)).join(" ")})` });
      await sleep(300);
    }
    await DL.reset();
    const closed0 = SS.getClosedTabCountForWindow(window);
    engine.resume(x.id);
    await waitFor(() => ((rec(x.id)?.events ?? []).some((e) => e.text === "New link found on its page") ? true : null), { timeout: 45000, interval: 50, what: "the link renewed from its page" });
    await sleep(800);
    const parkedNow = [...gBrowser.tabs].filter((t) => t.hidden && !b.tabs.some((y) => y.node === t)).length;
    await ctrlClick("#l3");
    await waitFor(() => b.tabs.length === 4 || null, { timeout: 8000, what: "link tab 3" });
    await sleep(300);
    const got = order();
    log("order", { got, parked: parkedNow, selected: b.active() === A });
    check("order: a page step ending between two Ctrl+clicks leaves the related-tab order alone: the third link opens after the second", got.join() === "A,L1,L2,L3" && b.active() === A, { got, parked: parkedNow });
    // The next tab switch resets that order anyway: the page waiting out of sight goes then, leaving nothing.
    b.activate(b.tabs[1]);
    await waitFor(() => ([...gBrowser.tabs].every((t) => !t.hidden || b.tabs.some((y) => y.node === t)) ? true : null), { timeout: 5000, what: "the parked page to go" }).catch(() => null);
    await sleep(500);
    const left = [...gBrowser.tabs].filter((t) => t.hidden && !b.tabs.some((y) => y.node === t)).length;
    check("order: after the next tab switch no hidden tab is left and the closed-tab list is as it was", left === 0 && SS.getClosedTabCountForWindow(window) === closed0, { left, closed: [closed0, SS.getClosedTabCountForWindow(window)] });
    await settled(x.id, "or1 settled", (v) => v.state !== "paused", 90000).catch(() => null);
    for (const t of [...b.tabs]) if (t !== A) b.closeTab(t);
    b.activate(A);
    await sleep(300);
  }

  // Every page this suite opened out of sight stayed out of history.
  // (l-login is checked in its section: Open page then loads it in a tab.)
  const hiddenPages = ["r1", "a1", "c1", "l-elsewhere", "pv1", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "tw-t2", "tw-t0", "tw-o2", "tw-o0", "q1", "pp1", "f1", "f2", "w1", "or1"];
  const left = [];
  for (const id of hiddenPages) left.push(...(await visits(`/page/${id}.html`)));
  check("history: no page opened out of sight left a visit in Places", left.length === 0, left);
});
