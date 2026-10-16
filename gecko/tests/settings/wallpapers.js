// Deer wallpapers (src/modules/VitreWallpapers.sys.ts) in the background picker, against a local
// stand-in for GitHub Pages (tests/settings/wallpaper_server.py: it records every request's headers,
// sets a cookie on every answer, and serves good and hostile collections). Run by tests/settings/all.py,
// which starts the server and passes WPTEST_ORIGIN (http://127.0.0.1:<port>) and WPTEST_DOWN (a port
// nothing listens on):
//   python tests/settings/all.py wallpapers [--no-build] [--port 47981]
// Run 1: nothing is asked before a Photo tab shows; no cache and the site down, an empty collection,
// a manifest over 1 MiB, a redirect: no group and no message; a manifest slow to answer, the picker
// closed before it does (three times): asked once, its answer still taken; the main collection: its
// good entries listed (bad ones skipped, their files never asked for) with checked thumbnails (3 at a
// time; one that passes the checks but cannot be decoded shows the colour and is not tried again on
// every repaint), names and tooltips with the credit, the same sizes as the other tiles; choose ->
// download -> checked -> Home shows it, never among the recent photos, downloaded once; progress on a
// slow tile and another choice superseding it (never applied, nothing left); wrong hash, short, long,
// not a JPEG, wrong size, 404: refused with the tile's line, nothing written, nothing changed; a note
// showing, then a Deer wallpaper chosen: the Photo tab and the progress stay; keys in the group; the
// popover shows the group; the open picker follows changes made elsewhere (another window, Browse),
// to and from a Deer wallpaper, keeps the arrows' tab stop through a download's repaints, and checks a
// photo chosen during a download at once and for good; the manifest asked once across reopenings,
// again only after 10 minutes; Find a setting; a wallpaper taken out of the collection that is the
// background stays shown and checked; pruning keeps the current one and the 5 chosen last; no Cookie,
// Referer or Origin ever sent, no cookie stored.
// Run 2 (a restart): temporary files a write cut short left are gone after the first look; the site
// down with a cache: the cached group, no message.
// Captures: wallpapers-settings, wallpapers-progress, wallpapers-failed, wallpapers-popover,
// wallpapers-removed, wallpapers-offline (tests/settings/out).
/* global spike, Services, Ci, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  const W = b.sys("VitreWallpapers");
  const ORIGIN = Services.env.get("WPTEST_ORIGIN");
  const DOWN = Services.env.get("WPTEST_DOWN");
  if (!ORIGIN || !DOWN) throw new Error("run through tests/settings/all.py (WPTEST_ORIGIN, WPTEST_DOWN)");
  const PREF = "vitre.wallpapers.base";
  const { panel, home, bg } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");
  const dir = W.folder();
  const FAILED = "Couldn’t download this wallpaper.";
  await spike.resize(1440, 900);
  await spike.activate();

  // ---------------------------------------------------------------- helpers
  const ctl = async (path, init = {}) => (await fetch(ORIGIN + path, { cache: "no-store", credentials: "omit", ...init })).json();
  const serverLog = () => ctl("/__log");
  const setBase = (path) => Services.prefs.setStringPref(PREF, path);
  const pathOf = (id) => PathUtils.join(dir, id + ".jpg");
  const files = async (folder) => {
    try {
      return (await IOUtils.getChildren(folder)).map((p) => PathUtils.filename(p)).sort();
    } catch {
      return [];
    }
  };
  const pictures = async () => (await files(dir)).filter((n) => n.endsWith(".jpg"));
  const temps = async () => [...(await files(dir)), ...(await files(PathUtils.join(dir, "thumbs")))].filter((n) => /\.(part|tmp)$/.test(n));
  const picker = (scope = root()) => scope?.querySelector(".hb-picker");
  const mainTiles = (scope = root()) => [...(picker(scope)?.querySelectorAll(".hb-panel > .hb-grid .hb-tile") ?? [])];
  const deerTiles = (scope = root()) => [...(picker(scope)?.querySelectorAll(".hb-deer .hb-tile") ?? [])];
  const deerIds = (scope) => deerTiles(scope).map((t) => t.dataset.id);
  const tileOf = (id, scope = root()) => picker(scope)?.querySelector(`.hb-deer .hb-tile[data-id="${id}"]`);
  const deerShown = (scope = root()) => !!picker(scope) && !picker(scope).querySelector(".hb-deer").hidden && deerTiles(scope).length > 0;
  const bgNow = () => store.get().homeBackground;
  const homeDoc = () => b.active().browser.contentDocument?.documentElement;
  const sha256 = async (path) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await IOUtils.read(path))), (x) => x.toString(16).padStart(2, "0")).join("");
  /** Settings › Home and background, drawn again (a new picker: the 10-minute rule decides whether it asks). */
  const openSettings = async () => {
    b.service("settings").open("home");
    await waitFor(() => picker()?.dataset.ready, { timeout: 8000, what: "the Settings picker" });
  };
  /** The manifest of `base` was asked for after `since` and the answer is in. */
  const attempted = async (base, since = 0) => {
    await waitFor(() => (W.debug().asked[base] ?? -1) >= since && !W.debug().fetching, { timeout: 20000, what: "the manifest of " + base });
    await sleep(400);
  };
  const noteText = (scope = root()) => (picker(scope)?.querySelector(".hb-note:not([hidden])")?.textContent ?? "").trim();
  /** The Settings picker's tabs (in the row's control column, outside .hb-picker). */
  const selectedTab = () => root()?.querySelector('.hb-tabs [aria-selected="true"]')?.textContent;
  const tabButton = (label) => [...(root()?.querySelectorAll('.hb-tabs [role="tab"]') ?? [])].find((x) => x.textContent === label);
  /** Every checked tile of the Settings picker, both groups: a Deer wallpaper by id, a photo by path. */
  const checkedOf = () => [...mainTiles(), ...deerTiles()].filter((t) => t.getAttribute("aria-checked") === "true").map((t) => t.dataset.id || (t.dataset.kind === "windows" ? "windows" : t.dataset.path));
  const choose = async (id, scope = root()) => {
    const t = tileOf(id, scope);
    if (!t) throw new Error("no tile " + id);
    t.scrollIntoView({ block: "center" });
    await sleep(150);
    spike.click(t);
  };
  const chooseAndWait = async (id, scope = root()) => {
    await choose(id, scope);
    await waitFor(() => bgNow().path === pathOf(id), { timeout: 15000, what: "background " + id });
  };
  const GOOD = ["lake-at-dawn", "hills", "quiet-bay", "red-rocks", "snow-field", "city-lights", "old-pier", "bad-thumb", "odd-thumb", "slow-forest"];
  const BAD = ["wrong-hash", "short-file", "long-file", "not-jpeg", "wrong-dims", "gone-file"];
  const LISTED = [...GOOD, ...BAD];
  /** Tiles whose face never shows a thumbnail: bad-thumb's is refused, odd-thumb's cannot be decoded. */
  const NO_THUMB = ["bad-thumb", "odd-thumb"];
  const PLANTED = ["wallpapers.json.tmp", "chosen.json.tmp", "cut-short.jpg.part", "thumbs/cut-short.jpg.part"];
  /** Every request Deer made: no cookie, no referrer, no origin, no credentials, no query string. */
  const anonymous = (reqs, label) => {
    const bad = reqs.filter((r) => {
      const names = Object.keys(r.headers).map((k) => k.toLowerCase());
      return r.query || names.some((n) => ["cookie", "referer", "origin", "authorization"].includes(n));
    });
    check(`${label}: ${reqs.length} requests, none with a Cookie, Referer, Origin, Authorization or query string`, reqs.length > 0 && bad.length === 0, bad.slice(0, 3));
    const names = new Set();
    for (const r of reqs) for (const k of Object.keys(r.headers)) names.add(k);
    log(`${label}: request headers seen: ${[...names].sort().join(", ")}`);
  };
  const jarHas = (name) => {
    try {
      return Services.cookies.getCookiesFromHost("127.0.0.1", {}).some((c) => c.name === name);
    } catch (e) {
      return "error " + e;
    }
  };

  if (spike.run === 1) {
    await ctl("/__reset");
    await ctl("/__drop?prefix=");
    // A cookie the jar really holds for the stand-in's host: an ordinary request would carry it.
    Services.cookies.add("127.0.0.1", "/", "planted", "1", false, false, false, Date.now() + 86400e3, {}, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTP);
    check("a cookie for 127.0.0.1 is in the jar (Deer must not send it)", jarHas("planted") === true, jarHas("planted"));

    // ---------------------------------------------------------------- nothing before a Photo tab shows
    setBase(ORIGIN + "/main/");
    b.newTab();
    await sleep(300);
    if (b.omni.open) b.omni.close();
    await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.state, { timeout: 15000, what: "Home" });
    await sleep(2500);
    check("starting Deer and showing Home asks the site for nothing", (await serverLog()).length === 0, (await serverLog()).map((r) => r.path));

    // ---------------------------------------------------------------- no cache, the site down: no group, no message
    const down = DOWN + "/";
    setBase(down);
    await openSettings();
    await attempted(down);
    check("the site down and nothing cached: no Deer wallpapers group", !deerShown() && picker().dataset.deer === "0", picker().dataset.deer);
    check("…and no message", noteText() === "", noteText());
    check("…and nothing written", (await files(dir)).length === 0, await files(dir));

    // ---------------------------------------------------------------- an empty collection (today's real state): no group
    const empty = ORIGIN + "/empty/";
    setBase(empty);
    await openSettings();
    await attempted(empty);
    check("an empty collection: no group, no message", !deerShown() && noteText() === "", picker().dataset.deer);
    check("…its manifest was asked for once", (await serverLog()).filter((r) => r.path === "/empty/wallpapers.json").length === 1);

    // ---------------------------------------------------------------- a manifest over 1 MiB, a redirect: refused, no group
    const huge = ORIGIN + "/huge/";
    setBase(huge);
    await openSettings();
    await attempted(huge);
    check("a manifest over 1 MiB is refused: no group", !deerShown() && noteText() === "");
    const redirect = ORIGIN + "/redirect/";
    setBase(redirect);
    await openSettings();
    await attempted(redirect);
    const afterRedirect = await serverLog();
    check("a manifest that redirects is refused, the redirect never followed", !deerShown() && afterRedirect.some((r) => r.path === "/redirect/wallpapers.json") && !afterRedirect.some((r) => r.path.startsWith("/main/")), afterRedirect.map((r) => r.path));

    // ---------------------------------------------------------------- a manifest slow to answer, the picker closed first
    // The 10-minute rule counts a request once it is sent: Settings closed before the answer (past the
    // second after which the rest stops) and opened again does not ask again, and the answer is taken.
    const slowBase = ORIGIN + "/slow/";
    setBase(slowBase);
    for (let i = 0; i < 3; i++) {
      await openSettings();
      await sleep(500);
      panel.close();
      await sleep(1700);
    }
    await openSettings();
    await waitFor(() => W.debug().source === "network" && !W.debug().fetching, { timeout: 10000, what: "the slow manifest's answer" }).catch(() => null);
    await sleep(300);
    const slowAsks = (await serverLog()).filter((r) => r.path === "/slow/wallpapers.json").length;
    check("a manifest slow to answer is asked for once, though Settings closed before it answered, three times", slowAsks === 1, slowAsks);
    check("…and its answer was taken when it came", W.debug().source === "network" && W.debug().base === slowBase, W.debug());

    // ---------------------------------------------------------------- the main collection
    const main = ORIGIN + "/main/";
    setBase(main);
    await openSettings();
    await attempted(main);
    await waitFor(() => deerShown() && W.debug().thumbsRunning === 0 && deerTiles().filter((t) => !NO_THUMB.includes(t.dataset.id) && t.querySelector(".hb-face img")).length >= LISTED.length - NO_THUMB.length, { timeout: 20000, what: "thumbnails" }).catch(() => null);
    await waitFor(() => tileOf("odd-thumb") && !tileOf("odd-thumb").querySelector("img"), { timeout: 5000, what: "odd-thumb's thumbnail failing to decode" }).catch(() => null);
    await sleep(500);
    check("the group lists exactly the entries that pass, in the manifest's order", JSON.stringify(deerIds()) === JSON.stringify(LISTED), deerIds());
    check("the group is captioned “Deer wallpapers” and labels its radio group with it", picker().querySelector(".hb-group")?.textContent === "Deer wallpapers" && document.getElementById(picker().querySelector(".hb-deer .hb-grid").getAttribute("aria-labelledby"))?.textContent === "Deer wallpapers");
    const withThumb = deerTiles().filter((t) => t.querySelector(".hb-face img")?.src.includes("/deer-wallpapers/thumbs/"));
    check("every tile but bad-thumb and odd-thumb shows its checked thumbnail from the profile", withThumb.length === LISTED.length - NO_THUMB.length && NO_THUMB.every((id) => !tileOf(id).querySelector("img")), withThumb.map((t) => t.dataset.id));
    check("bad-thumb (a thumbnail that does not match) shows its colour instead", !!tileOf("bad-thumb").querySelector(".hb-face").style.backgroundColor);
    check("odd-thumb (a thumbnail that passes the checks but cannot be decoded) shows its colour too", !!tileOf("odd-thumb").querySelector(".hb-face").style.backgroundColor && !tileOf("odd-thumb").querySelector("img"));
    // Every later repaint (progress comes ten times a second) must not try that picture again.
    let oddImgs = 0;
    const oddWatch = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.localName === "img") oddImgs++;
    });
    oddWatch.observe(tileOf("odd-thumb").querySelector(".hb-face"), { childList: true });
    const thumbFiles = await files(PathUtils.join(dir, "thumbs"));
    check("the thumbnails folder holds exactly those thumbnails", JSON.stringify(thumbFiles) === JSON.stringify(LISTED.filter((i) => i !== "bad-thumb").map((i) => i + ".jpg").sort()), thumbFiles);
    const mainLog = await serverLog();
    const asked = new Set(mainLog.map((r) => r.path));
    const wanted = new Set(["/main/wallpapers.json", ...LISTED.map((i) => `/main/thumbs/${i}.jpg`)]);
    const stray = [...asked].filter((p) => p.startsWith("/main/") && !wanted.has(p));
    check("only the manifest and the listed thumbnails were asked for (no file of a skipped entry, no picture)", stray.length === 0 && [...wanted].every((p) => asked.has(p)), stray);
    const stats = await ctl("/__stats");
    check("thumbnails are fetched a few at a time (at most 3 at once)", stats.thumbsAtOnce >= 1 && stats.thumbsAtOnce <= 3, stats);
    const lake = tileOf("lake-at-dawn");
    check("a tile's accessible name gives the title and the credit", lake.getAttribute("aria-label") === "Lake at dawn, Photo: Ada Park · CC0-1.0", lake.getAttribute("aria-label"));
    check("…and so does its tooltip", lake.dataset.tip === "Lake at dawn" && lake.dataset.key === "Photo: Ada Park · CC0-1.0", { tip: lake.dataset.tip, key: lake.dataset.key });
    check("…and its caption is the title", lake.querySelector(".hb-cap")?.textContent === "Lake at dawn");
    const own = tileOf("quiet-bay");
    check("the owner's own photo (no author or license) is listed with no credit", own?.getAttribute("aria-label") === "Quiet bay" && !own?.dataset.key, { label: own?.getAttribute("aria-label"), key: own?.dataset.key });
    const mf = mainTiles()[0]?.querySelector(".hb-face").getBoundingClientRect();
    const df = lake.querySelector(".hb-face").getBoundingClientRect();
    check("Deer tiles are the size of the other tiles (3 columns in Settings)", mf && Math.abs(mf.width - df.width) < 0.6 && Math.abs(mf.height - df.height) < 0.6 && picker().querySelector(".hb-deer .hb-grid").classList.contains("cols-3"), { main: mf && [mf.width, mf.height], deer: [df.width, df.height] });
    check("radio semantics: every Deer tile is a radio, none checked yet", deerTiles().every((t) => t.getAttribute("role") === "radio" && t.getAttribute("aria-checked") === "false"));
    check("the cookie the site set was not stored", jarHas("wptrack") === false, jarHas("wptrack"));
    picker().querySelector(".hb-deer").scrollIntoView({ block: "start" });
    await sleep(400);
    await spike.capture("wallpapers-settings");

    // ---------------------------------------------------------------- keys inside the group
    lake.focus();
    spike.press("Right");
    await sleep(100);
    check("Right moves to the next Deer tile without choosing", document.activeElement === tileOf("hills") && bgNow().kind === "windows");
    spike.press("End");
    await sleep(100);
    check("End goes to the group's last tile", document.activeElement === deerTiles().at(-1));
    spike.press("Home");
    await sleep(100);
    check("Home to its first", document.activeElement === lake);

    // ---------------------------------------------------------------- choose -> download -> checked -> Home shows it
    const recentBefore = Services.prefs.getStringPref("vitre.home.recent", "[]");
    await chooseAndWait("lake-at-dawn");
    const info = await ctl("/__info");
    check("choosing a tile downloads it into the profile and makes it Home's background (an ordinary image)", bgNow().kind === "image" && bgNow().path === pathOf("lake-at-dawn"), bgNow());
    check("the file is the one listed (size and SHA-256)", (await sha256(pathOf("lake-at-dawn"))) === info["lake-at-dawn"].sha256);
    await waitFor(() => homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { timeout: 10000, what: "Home shows it" }).catch(() => null);
    check("Home shows it", homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { ...homeDoc()?.dataset });
    await waitFor(() => tileOf("lake-at-dawn")?.getAttribute("aria-checked") === "true", { timeout: 5000, what: "check" }).catch(() => null);
    check("its tile is checked (and is its group's tab stop)", tileOf("lake-at-dawn").getAttribute("aria-checked") === "true" && tileOf("lake-at-dawn").tabIndex === 0);
    check("no other tile is checked", [...mainTiles(), ...deerTiles()].filter((t) => t.getAttribute("aria-checked") === "true").length === 1);
    check("it is not among the recent photos (not a tile of the main group, not in vitre.home.recent)", !mainTiles().some((t) => t.dataset.path?.toLowerCase() === pathOf("lake-at-dawn").toLowerCase()) && Services.prefs.getStringPref("vitre.home.recent", "[]") === recentBefore, mainTiles().map((t) => t.dataset.path));
    // Chosen again (another tile, then back): no second download.
    await chooseAndWait("hills");
    await chooseAndWait("lake-at-dawn");
    check("a picture is downloaded once: choosing it again uses the copy", (await serverLog()).filter((r) => r.path === "/main/full/lake-at-dawn.jpg").length === 1);

    // ---------------------------------------------------------------- progress, and another choice superseding it
    await choose("slow-forest");
    await waitFor(() => tileOf("slow-forest")?.getAttribute("aria-busy") === "true" && Number(tileOf("slow-forest").dataset.progress) > 0.05, { timeout: 8000, what: "progress" }).catch(() => null);
    const slow = tileOf("slow-forest");
    const p1 = Number(slow.dataset.progress);
    check("a download shows its progress on the tile (aria-busy, a line filling)", slow.getAttribute("aria-busy") === "true" && p1 > 0 && p1 < 1 && slow.querySelector(".hb-bar").style.width !== "0px", { busy: slow.getAttribute("aria-busy"), p: p1 });
    check("…while nothing else changes (the background, the check)", bgNow().path === pathOf("lake-at-dawn") && tileOf("lake-at-dawn").getAttribute("aria-checked") === "true" && slow.getAttribute("aria-checked") === "false");
    await spike.capture("wallpapers-progress");
    await chooseAndWait("hills");
    check("choosing another tile meanwhile: that one is applied", bgNow().path === pathOf("hills"));
    await sleep(5500);
    check("the superseded download is never applied", bgNow().path === pathOf("hills"), bgNow());
    check("…and left nothing behind (no picture, no temporary file)", !(await pictures()).includes("slow-forest.jpg") && (await temps()).length === 0, { pictures: await pictures(), temps: await temps() });
    check("…and its tile is no longer busy", tileOf("slow-forest").getAttribute("aria-busy") !== "true");
    oddWatch.disconnect();
    check("a thumbnail that cannot be decoded is not tried again on every repaint (no new <img> through the downloads since)", oddImgs === 0, oddImgs);

    // ---------------------------------------------------------------- downloads that do not check out
    let shot = false;
    for (const id of BAD) {
      await choose(id);
      await waitFor(() => tileOf(id)?.dataset.failed === "true", { timeout: 15000, what: id + " refused" }).catch(() => null);
      const t = tileOf(id);
      const line = t.querySelector(".hb-fail");
      check(`${id}: refused, the tile says “${FAILED}”`, t.dataset.failed === "true" && !line.hidden && line.textContent === FAILED, t.dataset.failed);
      check(`${id}: …nothing changed and nothing was written`, bgNow().path === pathOf("hills") && !(await pictures()).includes(id + ".jpg") && (await temps()).length === 0, { bg: bgNow().path, pictures: await pictures(), temps: await temps() });
      check(`${id}: …screen readers hear it`, picker().querySelector(".hb-live").textContent === FAILED);
      if (!shot) {
        shot = true;
        await spike.capture("wallpapers-failed");
      }
    }
    await chooseAndWait("lake-at-dawn");
    check("the next choice clears the failure line", deerTiles().every((t) => t.dataset.failed !== "true" && t.querySelector(".hb-fail").hidden));

    // ---------------------------------------------------------------- a note showing, then a Deer wallpaper chosen
    // Home on no picture, the person on the Photo tab: a photo whose file has gone says so; choosing a
    // Deer wallpaper next keeps the Photo tab, with the group and the tile's progress, on screen.
    const photoTab = async () => {
      if (selectedTab() !== "Photo") spike.click(tabButton("Photo"));
      await waitFor(() => selectedTab() === "Photo" && deerShown(), { timeout: 5000, what: "the Photo tab" }).catch(() => null);
    };
    const gonePhoto = PathUtils.join(PathUtils.profileDir, "wptest gone.jpg");
    const recentWas = Services.prefs.getStringPref("vitre.home.recent", "[]");
    Services.prefs.setStringPref("vitre.home.recent", JSON.stringify([{ kind: "image", path: gonePhoto }]));
    store.set({ homeBackground: { kind: "none", path: "" } });
    await waitFor(() => selectedTab() === "None", { timeout: 5000, what: "the None tab" }).catch(() => null);
    await photoTab();
    await waitFor(() => mainTiles().some((t) => t.dataset.path === gonePhoto), { timeout: 5000, what: "the gone photo's tile" }).catch(() => null);
    spike.click(mainTiles().find((t) => t.dataset.path === gonePhoto));
    await waitFor(() => noteText().startsWith("Couldn’t open"), { timeout: 5000, what: "the note" }).catch(() => null);
    await sleep(300);
    check("a photo whose file has gone: the note says so, and the picker stays on its Photo tab", noteText() === "Couldn’t open wptest gone.jpg" && selectedTab() === "Photo", { note: noteText(), tab: selectedTab() });
    await photoTab(); // the person goes back to it, should it have moved
    await choose("slow-forest");
    await sleep(700);
    const busyTile = tileOf("slow-forest");
    check("…then a Deer wallpaper chosen: still the Photo tab, the note gone, the group and the tile's progress on screen", selectedTab() === "Photo" && noteText() === "" && deerShown() && busyTile?.getAttribute("aria-busy") === "true" && Number(busyTile.dataset.progress) > 0, { tab: selectedTab(), note: noteText(), deer: deerShown(), busy: busyTile?.getAttribute("aria-busy") });
    check("…and the background is still none meanwhile", bgNow().kind === "none");
    await photoTab();
    await chooseAndWait("lake-at-dawn");
    Services.prefs.setStringPref("vitre.home.recent", recentWas);

    // ---------------------------------------------------------------- the popover (2 columns) shows the group
    panel.close();
    await sleep(500);
    spike.click(document.querySelector("#vitre-home-bg .hb-circle-face"));
    await waitFor(() => home.isOpen && document.querySelector("#vitre-home-bg-pop .hb-picker")?.dataset.ready, { timeout: 5000, what: "popover" });
    const pop = document.getElementById("vitre-home-bg-pop");
    await waitFor(() => deerShown(pop), { timeout: 5000, what: "the group in the popover" }).catch(() => null);
    await sleep(500);
    check("Home's Background popover shows the Deer wallpapers group", deerShown(pop) && JSON.stringify(deerIds(pop)) === JSON.stringify(LISTED), deerIds(pop));
    const pm = mainTiles(pop)[0]?.querySelector(".hb-face").getBoundingClientRect();
    const pd = tileOf("hills", pop).querySelector(".hb-face").getBoundingClientRect();
    check("…in its 2 columns, tiles the size of the popover's others", picker(pop).querySelector(".hb-deer .hb-grid").classList.contains("cols-2") && pm && Math.abs(pm.width - pd.width) < 0.6 && Math.abs(pm.height - pd.height) < 0.6, { main: pm && [pm.width, pm.height], deer: [pd.width, pd.height] });
    check("…with the chosen one checked", tileOf("lake-at-dawn", pop).getAttribute("aria-checked") === "true");
    pop.querySelector(".hb-deer").scrollIntoView({ block: "start" });
    await sleep(400);
    await spike.capture("wallpapers-popover");
    await chooseAndWait("hills", pop);
    check("choosing in the popover works the same", bgNow().path === pathOf("hills"));
    spike.press("Escape");
    await sleep(400);

    // ---------------------------------------------------------------- the open picker follows changes made elsewhere
    // Another window or about:config (VitreSettings.set), Browse picking the file already first in the
    // recent list (the same tiles): the check moves in the open picker, to and from a Deer wallpaper.
    const photo = async (name, hue) => {
      const c = new OffscreenCanvas(640, 360);
      const g = c.getContext("2d");
      g.fillStyle = `hsl(${hue} 40% 40%)`;
      g.fillRect(0, 0, 640, 360);
      const p = PathUtils.join(PathUtils.profileDir, name);
      await IOUtils.write(p, new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg" })).arrayBuffer()));
      return p;
    };
    const alpha = await photo("wptest alpha.jpg", 20);
    const beta = await photo("wptest beta.jpg", 200);
    const recentWas2 = Services.prefs.getStringPref("vitre.home.recent", "[]");
    Services.prefs.setStringPref("vitre.home.recent", JSON.stringify([{ kind: "image", path: alpha }, { kind: "image", path: beta }]));
    await openSettings();
    await waitFor(() => deerShown() && mainTiles().some((t) => t.dataset.path === beta), { timeout: 8000, what: "the two photos" }).catch(() => null);
    check("the Deer wallpaper hills is the only tile checked", JSON.stringify(checkedOf()) === JSON.stringify(["hills"]), checkedOf());
    const elsewhere = [
      ["a Deer wallpaper to a photo", { kind: "image", path: alpha }, alpha],
      ["a photo to another of the same tiles", { kind: "image", path: beta }, beta],
      ...(mainTiles().some((t) => t.dataset.kind === "windows") ? [["a photo to the Windows wallpaper", { kind: "windows", path: "" }, "windows"]] : []),
      ["back to a Deer wallpaper", { kind: "image", path: pathOf("lake-at-dawn") }, "lake-at-dawn"],
      ["a Deer wallpaper to another", { kind: "image", path: pathOf("hills") }, "hills"],
    ];
    for (const [what, value, want] of elsewhere) {
      store.set({ homeBackground: value });
      await waitFor(() => JSON.stringify(checkedOf()) === JSON.stringify([want]), { timeout: 3000, what }).catch(() => null);
      await sleep(300);
      check(`changed elsewhere, ${what}: the open picker checks exactly its tile`, JSON.stringify(checkedOf()) === JSON.stringify([want]), checkedOf());
    }
    spike.click(mainTiles().find((t) => t.dataset.path === beta));
    await waitFor(() => bgNow().path === beta, { timeout: 5000, what: "beta chosen" }).catch(() => null);
    await sleep(300);
    bg.choose({ kind: "image", path: alpha }, true); // what Browse does with the file the dialog gave
    await sleep(700);
    check("Browse picking the file already first in the recent list (the same tiles): its tile is checked", bgNow().path === alpha && JSON.stringify(checkedOf()) === JSON.stringify([alpha]), checkedOf());

    // A Deer wallpaper current, the arrows in the other group, then a download's repaints (ten a
    // second): the tab stop stays where the arrows put it.
    store.set({ homeBackground: { kind: "image", path: pathOf("hills") } });
    await waitFor(() => JSON.stringify(checkedOf()) === JSON.stringify(["hills"]), { timeout: 3000, what: "hills" }).catch(() => null);
    mainTiles()[0].focus();
    spike.press("Right");
    spike.press("Right");
    await sleep(150);
    const arrowed = document.activeElement;
    const busy = W.choose("slow-forest"); // as from another window's picker: focus stays here
    await waitFor(() => tileOf("slow-forest")?.getAttribute("aria-busy") === "true" && Number(tileOf("slow-forest").dataset.progress) > 0.1, { timeout: 8000, what: "the download's progress" }).catch(() => null);
    const stops = mainTiles().filter((t) => t.tabIndex === 0);
    check("a download's repaints leave the other group's tab stop where the arrows put it", mainTiles().indexOf(arrowed) === 2 && stops.length === 1 && stops[0] === arrowed && document.activeElement === arrowed, { at: mainTiles().indexOf(arrowed), stops: stops.map((t) => t.dataset.path || t.dataset.kind) });
    // A photo chosen while that download runs: checked at once, and never unchecked on the way.
    const states = [];
    const checks = new MutationObserver(() => states.push(checkedOf().join(" + ")));
    checks.observe(picker(), { subtree: true, attributes: true, attributeFilter: ["aria-checked"] });
    spike.click(mainTiles().find((t) => t.dataset.path === beta));
    await waitFor(() => bgNow().path === beta, { timeout: 5000, what: "beta chosen" }).catch(() => null);
    await sleep(600);
    checks.disconnect();
    check("a photo chosen during a download: its tile is checked at once and stays so", states.length > 0 && states.every((s) => s === beta), states);
    check("…and the download is superseded, never applied", (await busy) === "superseded" && bgNow().path === beta, bgNow());
    Services.prefs.setStringPref("vitre.home.recent", recentWas2);

    // ---------------------------------------------------------------- the manifest: once per 10 minutes, across reopenings
    for (let i = 0; i < 3; i++) {
      await openSettings();
      await sleep(600);
      panel.close();
      await sleep(450);
    }
    await openSettings();
    const tabs = [...root().querySelectorAll('.hb-tabs [role="tab"]')];
    spike.click(tabs.find((x) => x.textContent === "Video"));
    await sleep(1500);
    spike.click(tabs.find((x) => x.textContent === "Photo"));
    await sleep(1000);
    const manifestAsks = (await serverLog()).filter((r) => r.path === "/main/wallpapers.json").length;
    check("the manifest was asked for once, across Settings reopened, the popover and the tabs", manifestAsks === 1, manifestAsks);
    const realNow = W.now;
    W.now = () => Date.now() + 11 * 60 * 1000;
    try {
      const since = W.now();
      await openSettings();
      await attempted(main, since);
    } finally {
      W.now = realNow;
    }
    check("…and again after 10 minutes", (await serverLog()).filter((r) => r.path === "/main/wallpapers.json").length === 2);

    // ---------------------------------------------------------------- Find a setting
    // Results never ask the site, even when the manifest is due again.
    const asksBeforeSearch = (await serverLog()).filter((r) => r.path === "/main/wallpapers.json").length;
    const nowBeforeSearch = W.now;
    W.now = () => Date.now() + 22 * 60 * 1000;
    try {
      for (const q of ["deer wallpapers", "gallery"]) {
        b.service("settings").open("home", q);
        await sleep(400);
        const row = [...root().querySelectorAll(".vs-title")].some((x) => x.textContent === "Background") && !!root().querySelector(".hb-picker");
        check(`Find a setting “${q}” finds the Background row with the picker`, row);
      }
      await sleep(1500);
    } finally {
      W.now = nowBeforeSearch;
    }
    check("…and its results ask the site for nothing", (await serverLog()).filter((r) => r.path === "/main/wallpapers.json").length === asksBeforeSearch);
    b.service("settings").open("home", "download");
    await sleep(400);
    check("Find a setting “download” is for Downloads: no background picker", !root().querySelector(".hb-picker"));
    b.service("settings").open("home", "");
    await sleep(300);

    // ---------------------------------------------------------------- taken out of the collection while it is the background
    await openSettings();
    await chooseAndWait("lake-at-dawn");
    const main2 = ORIGIN + "/main2/";
    setBase(main2);
    await openSettings();
    await attempted(main2);
    await waitFor(() => W.debug().thumbsRunning === 0, { timeout: 15000, what: "thumbnails of main2" }).catch(() => null);
    await sleep(600);
    const gone = tileOf("lake-at-dawn");
    check("a wallpaper taken out of the collection that is the background keeps its tile, first, checked", deerIds()[0] === "lake-at-dawn" && gone?.getAttribute("aria-checked") === "true", deerIds());
    check("…its face is the picture itself (its thumbnail went with the manifest)", !!gone?.querySelector("img")?.src.includes("/deer-wallpapers/lake-at-dawn.jpg") && !(await files(PathUtils.join(dir, "thumbs"))).includes("lake-at-dawn.jpg"));
    check("…with its title and credit kept", gone?.getAttribute("aria-label") === "Lake at dawn, Photo: Ada Park · CC0-1.0", gone?.getAttribute("aria-label"));
    check("…and Home still shows it", bgNow().path === pathOf("lake-at-dawn") && homeDoc()?.dataset.state === "ready" && homeDoc()?.dataset.kind === "image");
    gone?.scrollIntoView({ block: "center" });
    await sleep(300);
    await spike.capture("wallpapers-removed");

    // ---------------------------------------------------------------- pruning: the current one and the 5 chosen last
    for (const id of ["quiet-bay", "red-rocks", "snow-field", "city-lights", "old-pier"]) await chooseAndWait(id);
    await sleep(1200);
    const kept = await pictures();
    check("pictures kept: the current one and the 5 chosen last (lake-at-dawn and hills removed)", JSON.stringify(kept) === JSON.stringify(["city-lights.jpg", "old-pier.jpg", "quiet-bay.jpg", "red-rocks.jpg", "snow-field.jpg"]), kept);
    check("…so the wallpaper no longer listed and no longer the background leaves the group", !tileOf("lake-at-dawn"), deerIds());
    check("…no temporary file anywhere", (await temps()).length === 0, await temps());

    // ---------------------------------------------------------------- what was sent
    const all = await serverLog();
    anonymous(all, "run 1");
    check("the planted cookie is still in the jar (Deer could have sent it), and no cookie of the site was stored", jarHas("planted") === true && jarHas("wptrack") === false);
    panel.close();
    await sleep(1500); // the picker gone, nothing under way
    // What writes cut short (Deer killed, a crash, power lost) leave behind, and a file that is not Deer's.
    for (const name of PLANTED) await IOUtils.write(PathUtils.join(dir, ...name.split("/")), new Uint8Array([0xff, 0xd8, 0xff]));
    await IOUtils.writeUTF8(PathUtils.join(dir, "notes.txt"), "not a file of Deer's");
    await ctl("/__reset");
    await ctl("/__drop?prefix=/main2/");
    log("restarting with the site down");
    await spike.restart();
    return;
  }

  // ==================================================================== run 2: the site down, a cache
  const main2 = ORIGIN + "/main2/";
  setBase(main2); // user.js put the harness's value back at the start
  b.newTab();
  await sleep(300);
  if (b.omni.open) b.omni.close();
  await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.state, { timeout: 15000, what: "Home" });
  check("after the restart Home shows the chosen Deer wallpaper from the profile", bgNow().path === pathOf("old-pier") && homeDoc()?.dataset.kind === "image");
  // The first picker of the session: the Deer tile comes a moment after the first render.
  spike.click(document.querySelector("#vitre-home-bg .hb-circle-face"));
  await waitFor(() => home.isOpen && document.querySelector("#vitre-home-bg-pop .hb-picker")?.dataset.ready, { timeout: 5000, what: "popover" });
  await waitFor(() => document.activeElement?.dataset?.id === "old-pier", { timeout: 4000, what: "focus on the Deer tile" }).catch(() => null);
  check("the popover opens with focus on the chosen tile, also when it is a Deer wallpaper", document.activeElement?.dataset?.id === "old-pier" && document.activeElement.getAttribute("aria-checked") === "true", document.activeElement?.getAttribute?.("aria-label"));
  spike.press("Escape");
  await sleep(400);
  const left = [];
  for (const name of PLANTED) if (await IOUtils.exists(PathUtils.join(dir, ...name.split("/")))) left.push(name);
  check("temporary files that writes cut short left are gone once the collection is first read", left.length === 0, left);
  check("…and a file that is not Deer's stays", await IOUtils.exists(PathUtils.join(dir, "notes.txt")));
  await openSettings();
  await attempted(main2);
  await waitFor(() => deerShown(), { timeout: 8000, what: "the cached group" }).catch(() => null);
  await sleep(500);
  const reqs = await serverLog();
  check("the site was asked (and dropped the connection)", reqs.some((r) => r.path === "/main2/wallpapers.json"), reqs.map((r) => r.path));
  const cached = LISTED.filter((i) => i !== "lake-at-dawn" && i !== "bad-thumb");
  check("the site down with a cache: the cached group (tiles with a thumbnail or a picture here)", W.debug().source === "cache" && JSON.stringify(deerIds()) === JSON.stringify(cached), { source: W.debug().source, ids: deerIds() });
  check("…the current one checked", tileOf("old-pier")?.getAttribute("aria-checked") === "true");
  check("…and no message", noteText() === "", noteText());
  check("…and no thumbnail was asked for (the site did not answer)", !reqs.some((r) => r.path.includes("/thumbs/")));
  picker().querySelector(".hb-deer").scrollIntoView({ block: "start" });
  await sleep(400);
  await spike.capture("wallpapers-offline");
  anonymous(reqs, "run 2");
  check("still no cookie of the site in the jar", jarHas("wptrack") === false);
  panel.close();
  await sleep(300);
  await ctl("/__drop?prefix=");
  Services.prefs.setStringPref(PREF, "http://127.0.0.1:9/");
  store.reset("homeBackground.kind");
  store.reset("homeBackground.path");
  await sleep(300);
});
