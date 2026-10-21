// Deer wallpapers (src/modules/VitreWallpapers.sys.ts) in the background picker: the "Get wallpapers"
// flow of the owner's plan of 2026-10-21, against a local stand-in for GitHub Pages
// (tests/settings/wallpaper_server.py: it records every request's headers, sets a cookie on every
// answer, and serves good and hostile collections as index.json version 2). Run by
// tests/settings/all.py, which builds the settings and menus modules, starts the server and passes
// WPTEST_ORIGIN (http://127.0.0.1:<port>) and WPTEST_DOWN (a port nothing listens on):
//   python tests/settings/all.py wallpapers [--no-build] [--port 47981]
// Run 1: nothing is asked before a Get is clicked (Home, Settings' Photo and Video tabs, Find a
// setting, the popover); the group's caption, Get button and Credits link (its target, Settings
// stepping aside); the site down, a 1.2 MB index, a redirect, a version 1 index: one plain failure
// line, nothing written, the line forgotten on leaving; an empty collection: "No new wallpapers.";
// Get on the main collection: "Getting N of 8…" one item after the other (one file at a time), the
// good entries only (hostile ones never asked for), checked thumbnails as faces (one that cannot be
// decoded shows its colour), names, tooltips and credits, the tiles the size of the others, then
// "Check for new wallpapers"; keys in the group; a tile applied at once, no request, never among the
// recent photos; the second Get asks for the index only; the Video tab's Get untouched; a
// double-click starts one Get and neither its second half nor a click within half a second stops it
// (the button's tooltip says "Click to stop" meanwhile); switching to the Video tab and back does not
// stop it; stopped by a second click and by leaving (an item whose bytes are all in kept, nothing
// half-written), the network failing mid-way (a body cut off before its Content-Length: the rest not
// tried); downloads that do not check out refused, the Get going on past them (the photos no longer
// listed removed); the owner changing the collection: new and changed items fetched, the ones
// no longer listed removed but the current background (removed at the next Get once it is not);
// Remove from the right-click menu, Shift+F10 and the Menu key (Esc, the access key), focus moving
// to the next tile, later Gets skipping it, removing the current background resetting Home's while
// the tab stays; the popover (2 columns, its own Get button, a Remove that leaves it open); the Video
// tab likewise (posters, a clip three days long, Home playing it muted and looping on the entry's
// colour, bad videos refused, a video streaming to its temporary file while a tile whose file has
// gone is chosen (that record dropped, the Get going on), then stopped, pruning, removing the current
// video); Find a setting; no Cookie, Referer or Origin ever sent, no cookie stored.
// Run 2 (a restart, the site down): nothing asked; Home shows the photo Deer 0.1.5-0.1.8 left as
// its background, whose tile shows first from chosen.json's record; that version's other files move
// into the new layout when its cached wallpapers.json (of this base) vouches for them and the person
// did not remove them (a photo and a video), the rest goes (a wrong file, a removed one, one no record
// names); temporary files and files no record vouches for gone; the tiles of both tabs offline;
// removals remembered; a Get with the site down fails plainly; the site up, a Get bringing the same
// photo moves Home to the new copy and the old file goes, and does not fetch the adopted photo again.
// Run 3 (a restart): a video of Deer 0.1.5-0.1.8 as Home's background plays; the popover opens on
// its Video tab with focus on its tile, wholly in view below two videos of the person's own; Remove
// sets Home back to its default and the file goes. The photos' folder made a junction to another
// folder: Gets neither remove nor write anything through it.
// Captures: wallpapers-get, wallpapers-failed, wallpapers-progress, wallpapers-settings,
// wallpapers-menu, wallpapers-popover, wallpapers-videos, wallpapers-offline, wallpapers-video-popover
// (tests/settings/out).
/* global spike, Services, Ci, IOUtils, PathUtils, ChromeUtils */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  const W = b.sys("VitreWallpapers");
  const H = b.sys("VitreHome");
  const ORIGIN = Services.env.get("WPTEST_ORIGIN");
  const DOWN = Services.env.get("WPTEST_DOWN");
  if (!ORIGIN || !DOWN) throw new Error("run through tests/settings/all.py (WPTEST_ORIGIN, WPTEST_DOWN)");
  const PREF = "vitre.wallpapers.base";
  const EXPECT = "wptest.expect"; // what run 1 leaves, for run 2
  const { panel, home, bg } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");
  const pop = () => document.getElementById("vitre-home-bg-pop");
  const dir = W.folder();
  const pdir = PathUtils.join(dir, "wallpapers");
  const vdir = PathUtils.join(dir, "live-wallpapers");
  const CREDITS = "https://github.com/droidboy08-hub/deer-wallpapers/blob/main/CREDITS.md";
  const FAILED = "Couldn’t get wallpapers. Try again.";
  const VFAILED = "Couldn’t get live wallpapers. Try again.";
  const VIDEO_NOTE = "Add a video to play it behind Home. It plays muted and loops.";
  await spike.resize(1440, 900);
  await spike.activate();

  // ---------------------------------------------------------------- helpers
  const ctl = async (path) => (await fetch(ORIGIN + path, { cache: "no-store", credentials: "omit" })).json();
  const serverLog = () => ctl("/__log");
  const paths = async (prefix = "/") => (await serverLog()).map((r) => r.path).filter((p) => p.startsWith(prefix));
  const setBase = (path) => Services.prefs.setStringPref(PREF, path);
  const pathOf = (id) => PathUtils.join(pdir, id + ".jpg");
  const vpathOf = (id) => PathUtils.join(vdir, id + ".mp4");
  const oldPathOf = (id, ext = "jpg") => PathUtils.join(dir, `${id}.${ext}`);
  const files = async (folder) => {
    try {
      return (await IOUtils.getChildren(folder)).map((p) => PathUtils.filename(p)).sort();
    } catch {
      return [];
    }
  };
  const photos = async () => (await files(pdir)).filter((n) => n.endsWith(".jpg"));
  const videos = async () => (await files(vdir)).filter((n) => n.endsWith(".mp4"));
  const thumbs = async (kind) => files(PathUtils.join(kind === "video" ? vdir : pdir, "thumbs"));
  const temps = async () => {
    const out = [];
    for (const d of [dir, pdir, PathUtils.join(pdir, "thumbs"), vdir, PathUtils.join(vdir, "thumbs")]) out.push(...(await files(d)).filter((n) => /\.(part|tmp)$/.test(n)));
    return out;
  };
  const exists = (p) => IOUtils.exists(p);
  const sha256 = async (path) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await IOUtils.read(path))), (x) => x.toString(16).padStart(2, "0")).join("");
  const picker = (scope = root()) => scope?.querySelector(".hb-picker");
  const mainTiles = (scope = root()) => [...(picker(scope)?.querySelectorAll(".hb-panel > .hb-grid .hb-tile") ?? [])];
  const deerTiles = (scope = root()) => [...(picker(scope)?.querySelectorAll(".hb-deer .hb-tile") ?? [])];
  const deerIds = (scope) => deerTiles(scope).map((t) => t.dataset.id);
  const tileOf = (id, scope = root()) => picker(scope)?.querySelector(`.hb-deer .hb-tile[data-id="${id}"]`);
  const getBtn = (scope = root()) => picker(scope)?.querySelector(".hb-deer .hb-get");
  const getLabel = (scope) => getBtn(scope)?.textContent ?? "";
  const getLine = (scope = root()) => {
    const n = picker(scope)?.querySelector(".hb-get-note");
    return n && !n.hidden ? n.textContent : "";
  };
  const creditsLink = (scope = root()) => picker(scope)?.querySelector(".hb-deer .hb-credits");
  const groupShown = (scope = root()) => !!picker(scope) && !picker(scope).querySelector(".hb-deer").hidden;
  const noteText = (scope = root()) => (picker(scope)?.querySelector(".hb-note:not([hidden])")?.textContent ?? "").trim();
  const liveText = (scope = root()) => picker(scope)?.querySelector(".hb-live")?.textContent ?? "";
  const bgNow = () => store.get().homeBackground;
  const homeDoc = () => b.active().browser.contentDocument?.documentElement;
  /** The video Home shows (the one on screen, not one fading out). */
  const homeVideo = () => b.active().browser.contentDocument?.querySelector("#bg > video.shown");
  const menuState = () => window.vitreMenus?.state?.();
  const menuRow = (label) => [...document.querySelectorAll("#layer-menus .vt-menu .vt-mi")].find((r) => r.textContent.trim() === label);
  /** Settings › Home and background, drawn again. */
  const openSettings = async () => {
    b.service("settings").open("home");
    await waitFor(() => picker()?.dataset.ready, { timeout: 8000, what: "the Settings picker" });
  };
  const selectedTab = (scope = root()) => scope?.querySelector('.hb-tabs [aria-selected="true"]')?.textContent;
  const tabButton = (label, scope = root()) => [...(scope?.querySelectorAll('.hb-tabs [role="tab"]') ?? [])].find((x) => x.textContent === label);
  /** Click a tab, scrolled into view first (the Deer group is low down). */
  const clickTab = async (label, scope = root()) => {
    tabButton(label, scope).scrollIntoView({ block: "nearest" });
    await sleep(150);
    spike.click(tabButton(label, scope));
    await waitFor(() => selectedTab(scope) === label, { timeout: 4000, what: "the " + label + " tab" }).catch(() => null);
    await sleep(200);
  };
  const into = async (node) => {
    node.scrollIntoView({ block: "center" });
    await sleep(150);
  };
  /** Every checked tile of the picker, both groups: a Deer wallpaper by id, a photo by path. */
  const checkedOf = (scope = root()) => [...mainTiles(scope), ...deerTiles(scope)].filter((t) => t.getAttribute("aria-checked") === "true").map((t) => t.dataset.id || (t.dataset.kind === "windows" ? "windows" : t.dataset.path));
  // Every Get the picker starts, to wait on its end.
  const realGet = W.get;
  let lastGet = null;
  W.get = (kind) => (lastGet = realGet.call(W, kind));
  /**
   * Click the group's button and wait for that Get's end ('done', 'failed', 'stopped'). (waitFor awaits
   * what its function returns: given the Get's promise it would wait for the Get's end; hence !!lastGet.)
   */
  const clickGet = async (scope = root()) => {
    lastGet = null;
    await into(getBtn(scope));
    spike.click(getBtn(scope));
    await waitFor(() => !!lastGet, { timeout: 4000, what: "a Get" });
    const r = await Promise.race([lastGet, sleep(90000).then(() => "timeout")]);
    await sleep(300);
    return r;
  };
  /** Start a Get with a click and come back once `ready()` holds while it runs; returns { get: its promise }. */
  const startGet = async (ready, what, scope = root()) => {
    lastGet = null;
    await into(getBtn(scope));
    spike.click(getBtn(scope));
    await waitFor(() => !!lastGet, { timeout: 4000, what: "a Get" });
    const get = lastGet;
    await waitFor(ready, { timeout: 20000, interval: 30, what }).catch(() => null);
    return { get };
  };
  const choose = async (id, scope = root()) => {
    const t = tileOf(id, scope);
    if (!t) throw new Error("no tile " + id);
    await into(t);
    spike.click(t);
  };
  const chooseAndWait = async (id, scope = root()) => {
    await choose(id, scope);
    await waitFor(() => bgNow().path === pathOf(id), { timeout: 5000, what: "background " + id });
  };
  const chooseVideoAndWait = async (id, scope = root()) => {
    await choose(id, scope);
    await waitFor(() => bgNow().kind === "video" && bgNow().path === vpathOf(id), { timeout: 5000, what: "video background " + id });
  };
  /** Right-click a tile (the mouse). */
  const rightClick = async (id, scope = root()) => {
    const t = tileOf(id, scope);
    await into(t);
    spike.click(t, { button: 2, type: "contextmenu" });
    await waitFor(() => menuState()?.open, { timeout: 3000, what: "the tile's menu" }).catch(() => null);
    await sleep(250);
  };
  /** The Menu key's message (WM_CONTEXTMENU from the keyboard): a contextmenu event at the focused element. */
  const menuKey = () => {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    PostMessageW(ctypes.voidptr_t(ctypes.UInt64(handle)), 0x007b, ctypes.UInt64(handle), -1);
    user32.close();
  };
  /** Wait until a file has gone (Home may hold it a moment). */
  const gone = (p, timeout = 12000) => waitFor(async () => !(await exists(p)), { timeout, what: "removal of " + PathUtils.filename(p) }).then(() => true, () => false);
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
  const readState = async () => {
    try {
      return await IOUtils.readJSON(PathUtils.join(dir, "state.json"));
    } catch {
      return null;
    }
  };
  /** The popover, opened from Home's circle. */
  const openPopover = async () => {
    if (b.active().url !== "about:vitre-home") {
      b.newTab();
      await sleep(300);
      if (b.omni.open) b.omni.close();
      await waitFor(() => b.active().url === "about:vitre-home", { timeout: 10000, what: "Home" });
    }
    spike.click(document.querySelector("#vitre-home-bg .hb-circle-face"));
    await waitFor(() => home.isOpen && pop()?.querySelector(".hb-picker")?.dataset.ready, { timeout: 5000, what: "the popover" });
    await sleep(300);
  };

  const GOOD_P = ["lake-at-dawn", "hills", "quiet-bay", "red-rocks", "snow-field", "city-lights", "old-pier", "odd-thumb"];
  const GOOD_V = ["night-river", "surf", "drift", "long-take"];

  if (spike.run === 2) return await run2();
  if (spike.run === 3) return await run3();

  // ==================================================================== run 1
  await ctl("/__reset");
  await ctl("/__drop?prefix=");
  // A cookie the jar really holds for the stand-in's host: an ordinary request would carry it.
  Services.cookies.add("127.0.0.1", "/", "planted", "1", false, false, false, Date.now() + 86400e3, {}, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTP);
  check("a cookie for 127.0.0.1 is in the jar (Deer must not send it)", jarHas("planted") === true, jarHas("planted"));
  check("the credits address is the collection's CREDITS.md", W.CREDITS === CREDITS, W.CREDITS);

  // ---------------------------------------------------------------- nothing before a click
  setBase(ORIGIN + "/good/");
  b.newTab();
  await sleep(300);
  if (b.omni.open) b.omni.close();
  await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.state, { timeout: 15000, what: "Home" });
  await openSettings();
  await waitFor(() => groupShown(), { timeout: 5000, what: "the Deer group" }).catch(() => null);
  await sleep(800);
  check("the Photo tab shows the “Deer wallpapers” group: its caption labels its radio group", groupShown() && picker().querySelector(".hb-group")?.textContent === "Deer wallpapers" && document.getElementById(picker().querySelector(".hb-deer .hb-grid").getAttribute("aria-labelledby"))?.textContent === "Deer wallpapers");
  check("…a “Get wallpapers” button, no tiles, no line", getLabel() === "Get wallpapers" && deerTiles().length === 0 && getLine() === "" && picker().dataset.deer === "0", { label: getLabel(), tiles: deerIds(), line: getLine() });
  check("…and a small “Credits” link, named for screen readers", creditsLink()?.textContent === "Credits" && /Credits/.test(creditsLink()?.getAttribute("aria-label") ?? "") && creditsLink()?.localName === "button");
  await into(picker().querySelector(".hb-deer"));
  await spike.capture("wallpapers-get");
  await clickTab("Video");
  check("the Video tab: “Get live wallpapers”, and the note for a tab with no video at all", getLabel() === "Get live wallpapers" && deerTiles().length === 0 && noteText() === VIDEO_NOTE && !!creditsLink(), { label: getLabel(), note: noteText() });
  await sleep(800);
  for (const q of ["deer wallpapers", "live wallpapers"]) {
    b.service("settings").open("home", q);
    await sleep(600);
    check(`Find a setting “${q}” shows the picker with the group and its button`, !!picker() && groupShown() && !!getBtn(), q);
  }
  b.service("settings").open("home", "");
  await sleep(300);
  panel.close();
  await sleep(400);
  await openPopover();
  await waitFor(() => groupShown(pop()), { timeout: 3000, what: "the popover's group" }).catch(() => null);
  check("Home's popover shows the group with its button and Credits", groupShown(pop()) && getLabel(pop()) === "Get wallpapers" && !!creditsLink(pop()), getLabel(pop()));
  spike.press("Escape");
  await sleep(1500);
  check("Home, Settings' Photo and Video tabs, Find a setting and the popover asked the site for nothing", (await serverLog()).length === 0, await paths());
  check("…and wrote nothing", (await files(dir)).length === 0, await files(dir));

  // ---------------------------------------------------------------- Credits
  const realNewTab = b.newTab;
  const opened = [];
  b.newTab = (url, o) => {
    opened.push(url);
    return undefined;
  };
  try {
    await openSettings();
    await into(creditsLink());
    spike.click(creditsLink());
    await sleep(500);
    check("Credits opens CREDITS.md in a new tab, and Settings steps aside so it shows", opened.length === 1 && opened[0] === CREDITS && !b.service("settings").isOpen(), { opened, open: b.service("settings").isOpen() });
    await openPopover();
    await into(creditsLink(pop()));
    spike.click(creditsLink(pop()));
    await sleep(400);
    check("…from the popover too", opened.length === 2 && opened[1] === CREDITS, opened);
  } finally {
    b.newTab = realNewTab;
  }
  if (home.isOpen) spike.press("Escape");
  await sleep(400);
  check("…and the link asks the stand-in for nothing", (await serverLog()).length === 0);

  // ---------------------------------------------------------------- failures: one plain line, nothing written
  let shot = false;
  for (const [what, base] of [["the site down", DOWN + "/"], ["an index over 1 MiB", ORIGIN + "/huge/"], ["an index that redirects", ORIGIN + "/redirect/"], ["an index of version 1", ORIGIN + "/v1/"]]) {
    setBase(base);
    await openSettings();
    const r = await clickGet();
    check(`${what}: the Get fails with one plain line, “${FAILED}”`, r === "failed" && getLine() === FAILED && picker().querySelector(".hb-get-note").classList.contains("error") && picker().querySelector(".hb-get-note").getAttribute("role") === "status", { r, line: getLine() });
    check(`${what}: …the button says “Get wallpapers” again, no tile, nothing written`, getLabel() === "Get wallpapers" && deerTiles().length === 0 && (await files(dir)).length === 0, { label: getLabel(), files: await files(dir) });
    if (!shot) {
      shot = true;
      await into(picker().querySelector(".hb-deer"));
      await spike.capture("wallpapers-failed");
    }
  }
  const failedAsks = await paths();
  check("the redirect was never followed, and only index.json was asked for", !failedAsks.some((p) => p.startsWith("/good/")) && failedAsks.every((p) => p.endsWith("/index.json")), failedAsks);
  panel.close();
  await sleep(1500);
  await openSettings();
  check("leaving forgets the line", getLine() === "" && getLabel() === "Get wallpapers", getLine());

  // ---------------------------------------------------------------- an empty collection
  setBase(ORIGIN + "/empty/");
  const emptyGet = await clickGet();
  check("an empty collection: “No new wallpapers.” and “Check for new wallpapers”", emptyGet === "done" && getLine() === "No new wallpapers." && getLabel() === "Check for new wallpapers" && !picker().querySelector(".hb-get-note").classList.contains("error"), { r: emptyGet, line: getLine(), label: getLabel() });

  // ---------------------------------------------------------------- Get on the main collection
  await ctl("/__reset");
  setBase(ORIGIN + "/good/");
  await openSettings();
  check("another collection: the button says “Get wallpapers” again", getLabel() === "Get wallpapers", getLabel());
  const texts = [];
  const watchBtn = new MutationObserver(() => texts.push(getBtn().textContent));
  watchBtn.observe(getBtn(), { childList: true, characterData: true, subtree: true });
  const { get: firstGet } = await startGet(() => /^Getting [3-6] of 8…$/.test(getLabel()), "the Get's progress");
  const nameMidway = getBtn().getAttribute("aria-label");
  await spike.capture("wallpapers-progress");
  const firstResult = await firstGet;
  await sleep(500);
  watchBtn.disconnect();
  const seen = [...new Set(texts)];
  const counts = seen.map((t) => /^Getting (\d+) of 8…$/.exec(t)?.[1]).filter(Boolean).map(Number);
  check("Get downloads every photo listed, its button reading “Getting N of 8…” item after item", firstResult === "done" && counts.length >= 6 && counts.every((n, i) => i === 0 || n > counts[i - 1]) && counts.at(-1) === 8, seen);
  check("…“Getting wallpapers…” while the index is read, and the stop said to screen readers", seen[0] === "Getting wallpapers…" && /^Getting \d of 8… Click again to stop\.$/.test(nameMidway ?? ""), { first: seen[0], name: nameMidway });
  check("…then “Check for new wallpapers”, no line, and screen readers hear what came", getLabel() === "Check for new wallpapers" && getLine() === "" && liveText() === "8 new wallpapers." && !getBtn().hasAttribute("aria-label"), { label: getLabel(), line: getLine(), live: liveText() });
  await waitFor(() => deerTiles().filter((t) => t.querySelector(".hb-face img")).length >= GOOD_P.length - 1, { timeout: 5000, what: "the faces" }).catch(() => null);
  await waitFor(() => tileOf("odd-thumb") && !tileOf("odd-thumb").querySelector("img"), { timeout: 5000, what: "odd-thumb's thumbnail failing to decode" }).catch(() => null);
  await sleep(300);
  check("the tiles: the photos listed, in the index's order (bad entries skipped)", JSON.stringify(deerIds()) === JSON.stringify(GOOD_P), deerIds());
  const info = await ctl("/__info");
  const shaOk = [];
  for (const id of GOOD_P) if ((await sha256(pathOf(id))) === info[id].sha256) shaOk.push(id);
  check("the profile holds each photo and its thumbnail, every file the one listed", JSON.stringify(await photos()) === JSON.stringify(GOOD_P.map((i) => i + ".jpg").sort()) && JSON.stringify(await thumbs("photo")) === JSON.stringify(GOOD_P.map((i) => i + ".jpg").sort()) && shaOk.length === GOOD_P.length, { photos: await photos(), shaOk });
  const goodAsks = await paths();
  const wantAsks = ["/good/index.json", ...GOOD_P.flatMap((i) => [`/good/wallpapers/thumbs/${i}.jpg`, `/good/wallpapers/${i}.jpg`])];
  check("only index.json and each photo's thumbnail then file were asked for, in that order (nothing of a skipped entry, no video)", JSON.stringify(goodAsks) === JSON.stringify(wantAsks), goodAsks);
  check("one file at a time", (await ctl("/__stats")).atOnce === 1, await ctl("/__stats"));
  const withThumb = deerTiles().filter((t) => t.querySelector(".hb-face img")?.src.includes("/deer-wallpapers/wallpapers/thumbs/"));
  check("every face is its checked thumbnail from the profile, on its colour (odd-thumb's cannot be decoded: its colour)", withThumb.length === GOOD_P.length - 1 && !tileOf("odd-thumb").querySelector("img") && !!tileOf("odd-thumb").querySelector(".hb-face").style.backgroundColor, withThumb.map((t) => t.dataset.id));
  const lake = tileOf("lake-at-dawn");
  check("a tile's accessible name gives the title and the credit", lake.getAttribute("aria-label") === "Lake at dawn, Photo: Ada Park · CC0-1.0", lake.getAttribute("aria-label"));
  check("…and so does its tooltip, and its caption is the title", lake.dataset.tip === "Lake at dawn" && lake.dataset.key === "Photo: Ada Park · CC0-1.0" && lake.querySelector(".hb-cap")?.textContent === "Lake at dawn", { tip: lake.dataset.tip, key: lake.dataset.key });
  check("the owner's own photo (no author or license) has no credit", tileOf("quiet-bay")?.getAttribute("aria-label") === "Quiet bay" && !tileOf("quiet-bay")?.dataset.key);
  const mf = mainTiles()[0]?.querySelector(".hb-face").getBoundingClientRect();
  const df = lake.querySelector(".hb-face").getBoundingClientRect();
  check("Deer tiles are the size of the other tiles (3 columns in Settings)", mf && Math.abs(mf.width - df.width) < 0.6 && Math.abs(mf.height - df.height) < 0.6 && picker().querySelector(".hb-deer .hb-grid").classList.contains("cols-3"), { main: mf && [mf.width, mf.height], deer: [df.width, df.height] });
  check("radios, none checked yet", deerTiles().every((t) => t.getAttribute("role") === "radio" && t.getAttribute("aria-checked") === "false"));
  check("the cookie the site set was not stored", jarHas("wptrack") === false, jarHas("wptrack"));
  await into(picker().querySelector(".hb-deer"));
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

  // ---------------------------------------------------------------- a tile applies at once
  await ctl("/__reset");
  const recentBefore = Services.prefs.getStringPref("vitre.home.recent", "[]");
  await chooseAndWait("lake-at-dawn");
  check("choosing a tile makes it Home's background at once (an ordinary image, its copy in the profile)", bgNow().kind === "image" && bgNow().path === pathOf("lake-at-dawn"), bgNow());
  await waitFor(() => homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { timeout: 10000, what: "Home shows it" }).catch(() => null);
  check("Home shows it", homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { ...homeDoc()?.dataset });
  check("its tile is checked (its group's tab stop), and no other", JSON.stringify(checkedOf()) === JSON.stringify(["lake-at-dawn"]) && tileOf("lake-at-dawn").tabIndex === 0, checkedOf());
  check("it is not among the recent photos", !mainTiles().some((t) => t.dataset.path?.toLowerCase() === pathOf("lake-at-dawn").toLowerCase()) && Services.prefs.getStringPref("vitre.home.recent", "[]") === recentBefore);
  await chooseAndWait("hills");
  await chooseAndWait("lake-at-dawn");
  check("choosing tiles asks the site for nothing", (await serverLog()).length === 0, await paths());

  // ---------------------------------------------------------------- the second Get: only what is new
  const second = await clickGet();
  check("“Check for new wallpapers” asks for index.json only, and says “No new wallpapers.”", second === "done" && JSON.stringify(await paths()) === JSON.stringify(["/good/index.json"]) && getLine() === "No new wallpapers." && getLabel() === "Check for new wallpapers", { r: second, asks: await paths(), line: getLine() });
  await clickTab("Video");
  check("the Video tab's Get is its own: “Get live wallpapers”, no tile, no line", getLabel() === "Get live wallpapers" && deerTiles().length === 0 && getLine() === "", { label: getLabel(), line: getLine() });
  await clickTab("Photo");

  // ---------------------------------------------------------------- stopped: a second click, leaving, the network going
  await ctl("/__reset");
  setBase(ORIGIN + "/slow/");
  await openSettings();
  // A double-click (two clicks 90 ms apart, the second with detail 2) starts one Get and does not stop
  // it; nor does a single click 250 ms after the start.
  lastGet = null;
  await into(getBtn());
  spike.click(getBtn(), { clickCount: 1 });
  await sleep(90);
  spike.click(getBtn(), { clickCount: 2 });
  await waitFor(() => !!lastGet, { timeout: 4000, what: "a Get" });
  const slowA = lastGet;
  const gets = [];
  const countGets = W.get;
  W.get = (kind) => {
    gets.push(kind);
    return countGets.call(W, kind);
  };
  await sleep(160);
  spike.click(getBtn());
  await sleep(700);
  W.get = countGets;
  check("a double-click starts one Get and does not stop it, nor does a click within half a second of the start", W.debug().running.photo && /^Getting /.test(getLabel()) && gets.length === 0 && (await Promise.race([slowA, sleep(0).then(() => "running")])) === "running", { label: getLabel(), running: W.debug().running, gets });
  check("…while it runs the button's tooltip says “Click to stop”", getBtn().dataset.tip === "Click to stop", getBtn().dataset.tip);
  await waitFor(async () => getLabel() === "Getting 1 of 3…" && (await paths()).includes("/slow/wallpapers/slow-a.jpg"), { timeout: 20000, interval: 30, what: "slow-a under way" }).catch(() => null);
  await sleep(300);
  spike.click(getBtn());
  const stopped = await Promise.race([slowA, sleep(8000).then(() => "timeout")]);
  await sleep(500);
  check("a second click stops the Get: the button says “Get wallpapers”, no line, no tooltip", stopped === "stopped" && getLabel() === "Get wallpapers" && getLine() === "" && !getBtn().dataset.tip, { r: stopped, label: getLabel(), line: getLine() });
  check("…the photo under way is not kept, nothing half-written, nothing more asked", !(await photos()).includes("slow-a.jpg") && (await temps()).length === 0 && !(await paths()).some((p) => p.includes("slow-b")) && JSON.stringify(deerIds()) === JSON.stringify(GOOD_P), { photos: await photos(), temps: await temps() });
  const { get: slowB } = await startGet(async () => getLabel() === "Getting 1 of 3…" && (await paths()).includes("/slow/wallpapers/slow-a.jpg"), "slow-a under way again");
  // Switching to the Video tab (to get live wallpapers as well, say) does not stop the photos' Get.
  await clickTab("Video");
  await sleep(1300);
  check("switching to the Video tab does not stop the photos' Get; its own button says “Get live wallpapers”", W.debug().running.photo && getLabel() === "Get live wallpapers" && !W.debug().running.video, { running: W.debug().running, label: getLabel() });
  await clickTab("Photo");
  check("…back on the Photo tab the button shows it going on", /^Getting [12] of 3…$/.test(getLabel()), getLabel());
  await waitFor(async () => getLabel() === "Getting 2 of 3…" && (await paths()).includes("/slow/wallpapers/slow-b.jpg"), { timeout: 20000, interval: 30, what: "slow-b under way" }).catch(() => null);
  await sleep(400);
  panel.close();
  const left = await Promise.race([slowB, sleep(8000).then(() => "timeout")]);
  check("leaving (Settings closed) stops it", left === "stopped" && !W.debug().running.photo, left);
  check("…an item whose bytes were all in is kept; the one under way is not; nothing half-written", (await photos()).includes("slow-a.jpg") && !(await photos()).includes("slow-b.jpg") && (await temps()).length === 0, { photos: await photos(), temps: await temps() });
  await openSettings();
  check("…reopened: “Get wallpapers”, no line, slow-a among the tiles", getLabel() === "Get wallpapers" && getLine() === "" && deerIds().includes("slow-a"), { label: getLabel(), ids: deerIds() });
  await ctl("/__reset");
  const { get: slowNet } = await startGet(async () => getLabel() === "Getting 1 of 2…" && (await paths()).includes("/slow/wallpapers/slow-b.jpg"), "slow-b under way again");
  await sleep(400);
  await ctl("/__drop?prefix=/slow/");
  const netResult = await Promise.race([slowNet, sleep(15000).then(() => "timeout")]);
  await sleep(400);
  check("the network going mid-way (slow-b's body cut off before its Content-Length): the Get fails with its line, the rest not tried", netResult === "failed" && getLine() === FAILED && !(await paths()).some((p) => p.includes("slow-c")), { r: netResult, line: getLine(), asks: await paths() });
  check("…nothing half-written, what came before stays", !(await photos()).includes("slow-b.jpg") && (await temps()).length === 0 && (await photos()).includes("slow-a.jpg"), { photos: await photos(), temps: await temps() });
  await ctl("/__drop?prefix=");
  const slowDone = await clickGet();
  check("tried again: the rest comes, and “Check for new wallpapers”", slowDone === "done" && ["slow-a", "slow-b", "slow-c"].every((i) => deerIds().includes(i)) && getLabel() === "Check for new wallpapers" && getLine() === "", { r: slowDone, ids: deerIds() });

  // ---------------------------------------------------------------- downloads that do not check out
  await ctl("/__reset");
  setBase(ORIGIN + "/bad/");
  await openSettings();
  const BAD = ["bad-thumb", "wrong-hash", "short-file", "long-file", "not-jpeg", "wrong-dims", "gone-file"];
  const badResult = await clickGet();
  const badAsks = await paths();
  check("downloads that do not check out are refused: the Get fails with its line", badResult === "failed" && getLine() === FAILED && getLabel() === "Get wallpapers", { r: badResult, line: getLine() });
  check("…each was tried (the Get went on past every refusal), the photos here already were not asked again", BAD.every((id) => badAsks.includes(`/bad/wallpapers/thumbs/${id}.jpg`)) && !badAsks.includes("/bad/wallpapers/bad-thumb.jpg") && !GOOD_P.some((id) => badAsks.some((p) => p.includes(`/${id}.jpg`))), badAsks);
  check("…nothing of them written, no tile came", BAD.every((id) => !deerIds().includes(id)) && !(await photos()).some((n) => BAD.includes(n.slice(0, -4))) && !(await thumbs("photo")).some((n) => BAD.includes(n.slice(0, -4))) && (await temps()).length === 0, { photos: await photos(), temps: await temps() });
  check("…the tiles: the collection's photos, the slow ones it does not list removed", JSON.stringify(deerIds()) === JSON.stringify(GOOD_P) && !(await photos()).some((n) => n.startsWith("slow-")), { ids: deerIds(), photos: await photos() });

  // ---------------------------------------------------------------- the owner changes the collection
  await ctl("/__reset");
  setBase(ORIGIN + "/good2/");
  await openSettings();
  check("lake-at-dawn is Home's background", bgNow().path === pathOf("lake-at-dawn"));
  const changed = await clickGet();
  const info2 = await ctl("/__info");
  const asks2 = await paths();
  check("the changed collection: index.json, then only what is new or changed (new-dawn, snow-field)", changed === "done" && JSON.stringify(asks2) === JSON.stringify(["/good2/index.json", "/good2/wallpapers/thumbs/new-dawn.jpg", "/good2/wallpapers/new-dawn.jpg", "/good2/wallpapers/thumbs/snow-field.jpg", "/good2/wallpapers/snow-field.jpg"]), asks2);
  check("…snow-field's copy replaced by its new picture", (await sha256(pathOf("snow-field"))) === info2["snow-field@good2"].sha256);
  check("…the copies no longer listed removed (hills, retired; slow-a, b, c), but the current background's", JSON.stringify(await photos()) === JSON.stringify(["city-lights.jpg", "lake-at-dawn.jpg", "new-dawn.jpg", "odd-thumb.jpg", "old-pier.jpg", "quiet-bay.jpg", "red-rocks.jpg", "snow-field.jpg"]) && !(await thumbs("photo")).includes("hills.jpg"), await photos());
  check("…its tile stays, first and checked, and Home still shows it", deerIds()[0] === "lake-at-dawn" && JSON.stringify(deerIds().slice(1)) === JSON.stringify(["new-dawn", "quiet-bay", "red-rocks", "snow-field", "city-lights", "old-pier", "odd-thumb"]) && tileOf("lake-at-dawn").getAttribute("aria-checked") === "true" && homeDoc()?.dataset.state === "ready", deerIds());
  await chooseAndWait("quiet-bay");
  await ctl("/__reset");
  const again = await clickGet();
  check("once it is no longer the background, the next Get removes it (nothing to fetch: “No new wallpapers.”)", again === "done" && !deerIds().includes("lake-at-dawn") && !(await exists(pathOf("lake-at-dawn"))) && getLine() === "No new wallpapers." && JSON.stringify(await paths()) === JSON.stringify(["/good2/index.json"]), { ids: deerIds(), line: getLine() });

  // ---------------------------------------------------------------- Remove: right-click, Shift+F10, the Menu key
  await rightClick("red-rocks");
  const m1 = menuState();
  check("right-click on a tile: its menu, “Remove”", !!m1?.open && JSON.stringify(m1.rows.map((r) => r.label)) === JSON.stringify(["Remove"]) && m1.source === "mouse" && m1.label === "Red rocks", m1);
  await spike.capture("wallpapers-menu");
  spike.click(menuRow("Remove"));
  await waitFor(() => !tileOf("red-rocks"), { timeout: 3000, what: "red-rocks' tile going" }).catch(() => null);
  check("Remove: the tile goes, its copy and thumbnail are deleted, the background stays", !tileOf("red-rocks") && (await gone(pathOf("red-rocks"))) && !(await thumbs("photo")).includes("red-rocks.jpg") && bgNow().path === pathOf("quiet-bay"), { ids: deerIds(), bg: bgNow().path });
  check("…remembered in the profile", W.debug().removed.photo.includes("red-rocks") && (await readState())?.removed?.photo?.includes("red-rocks"), W.debug().removed);
  tileOf("city-lights").focus();
  spike.press("Shift+F10");
  await waitFor(() => menuState()?.open, { timeout: 3000, what: "the keyboard menu" }).catch(() => null);
  await sleep(200);
  check("Shift+F10 on a focused tile: its menu, keyboard style, “Remove” active", menuState()?.open && menuState().source === "keyboard" && menuState().active === 0 && menuState().rows[0]?.label === "Remove", menuState());
  spike.press("Enter");
  await waitFor(() => !tileOf("city-lights"), { timeout: 3000, what: "city-lights' tile going" }).catch(() => null);
  await sleep(200);
  check("Enter removes it; focus moves to the next tile", !tileOf("city-lights") && (await gone(pathOf("city-lights"))) && document.activeElement === tileOf("old-pier") && tileOf("old-pier").tabIndex === 0, { focus: document.activeElement?.dataset?.id });
  menuKey();
  await waitFor(() => menuState()?.open, { timeout: 3000, what: "the Menu key's menu" }).catch(() => null);
  await sleep(200);
  check("the Menu key on a focused tile: its menu, keyboard style", menuState()?.open && menuState().source === "keyboard" && menuState().rows[0]?.label === "Remove", menuState());
  spike.press("Escape");
  await waitFor(() => !menuState()?.open, { timeout: 3000, what: "the menu closing" }).catch(() => null);
  await sleep(200);
  check("Esc closes the menu: nothing removed, focus back on the tile", !!tileOf("old-pier") && document.activeElement === tileOf("old-pier") && (await exists(pathOf("old-pier"))));
  menuKey();
  await waitFor(() => menuState()?.open, { timeout: 3000, what: "the Menu key's menu" }).catch(() => null);
  await sleep(200);
  spike.press("r");
  await waitFor(() => !tileOf("old-pier"), { timeout: 3000, what: "old-pier's tile going" }).catch(() => null);
  await sleep(200);
  check("its access key R removes it; focus moves to the next tile", !tileOf("old-pier") && (await gone(pathOf("old-pier"))) && document.activeElement === tileOf("odd-thumb"), { focus: document.activeElement?.dataset?.id });
  await ctl("/__reset");
  const skip = await clickGet();
  check("later Gets skip what was removed: nothing asked but index.json, “Check for new wallpapers”", skip === "done" && JSON.stringify(await paths()) === JSON.stringify(["/good2/index.json"]) && getLabel() === "Check for new wallpapers" && getLine() === "No new wallpapers.", { asks: await paths(), label: getLabel() });
  // The current background removed: Home goes back to its default (the Windows wallpaper), the tab stays.
  check("quiet-bay is Home's background", JSON.stringify(checkedOf()) === JSON.stringify(["quiet-bay"]));
  await rightClick("quiet-bay");
  spike.click(menuRow("Remove"));
  await waitFor(() => bgNow().kind === "windows", { timeout: 3000, what: "Home's default" }).catch(() => null);
  await sleep(500);
  check("removing the current background sets Home's back to the default (the Windows wallpaper)", bgNow().kind === "windows" && bgNow().path === "" && !tileOf("quiet-bay") && (await gone(pathOf("quiet-bay"))), bgNow());
  await waitFor(() => homeDoc()?.dataset.kind === "windows", { timeout: 8000, what: "Home on the Windows wallpaper" }).catch(() => null);
  check("…Home shows it; the picker stays on its Photo tab with the Windows wallpaper checked", homeDoc()?.dataset.kind === "windows" && selectedTab() === "Photo" && JSON.stringify(checkedOf()) === JSON.stringify(["windows"]), { home: homeDoc()?.dataset.kind, tab: selectedTab(), checked: checkedOf() });

  // ---------------------------------------------------------------- the popover
  panel.close();
  await sleep(400);
  await openPopover();
  await waitFor(() => deerTiles(pop()).length > 0, { timeout: 3000, what: "the popover's tiles" }).catch(() => null);
  const popIds = deerIds(pop());
  check("the popover shows the same tiles, its button and Credits", JSON.stringify(popIds) === JSON.stringify(["new-dawn", "snow-field", "odd-thumb"]) && getLabel(pop()) === "Check for new wallpapers" && !!creditsLink(pop()), { ids: popIds, label: getLabel(pop()) });
  const pm = mainTiles(pop())[0]?.querySelector(".hb-face").getBoundingClientRect();
  const pd = tileOf("snow-field", pop()).querySelector(".hb-face").getBoundingClientRect();
  check("…in its 2 columns, tiles the size of the popover's others", picker(pop()).querySelector(".hb-deer .hb-grid").classList.contains("cols-2") && pm && Math.abs(pm.width - pd.width) < 0.6 && Math.abs(pm.height - pd.height) < 0.6, { main: pm && [pm.width, pm.height], deer: [pd.width, pd.height] });
  await chooseAndWait("snow-field", pop());
  check("choosing in the popover works the same", bgNow().path === pathOf("snow-field") && tileOf("snow-field", pop()).getAttribute("aria-checked") === "true");
  await into(picker(pop()).querySelector(".hb-deer"));
  await spike.capture("wallpapers-popover");
  await rightClick("odd-thumb", pop());
  spike.click(menuRow("Remove"));
  await waitFor(() => !tileOf("odd-thumb", pop()), { timeout: 3000, what: "odd-thumb going" }).catch(() => null);
  await sleep(300);
  check("Remove in the popover: the tile goes, and the popover stays open", home.isOpen && !tileOf("odd-thumb", pop()) && (await gone(pathOf("odd-thumb"))), { open: home.isOpen, ids: deerIds(pop()) });
  await ctl("/__reset");
  const popGet = await clickGet(pop());
  check("the popover's button gets as Settings' does", popGet === "done" && getLine(pop()) === "No new wallpapers." && JSON.stringify(await paths()) === JSON.stringify(["/good2/index.json"]), { r: popGet, line: getLine(pop()) });
  spike.press("Escape");
  await sleep(400);

  // ---------------------------------------------------------------- live wallpapers: the Video tab
  await ctl("/__reset");
  setBase(ORIGIN + "/good/");
  await openSettings();
  await clickTab("Video");
  const noteSeen = [];
  const noteWatch = new MutationObserver(() => {
    if (noteText() === VIDEO_NOTE && deerTiles().length) noteSeen.push(deerTiles().length);
  });
  noteWatch.observe(picker(), { subtree: true, childList: true, characterData: true, attributes: true });
  const vtexts = [];
  const vwatch = new MutationObserver(() => vtexts.push(getBtn().textContent));
  vwatch.observe(getBtn(), { childList: true, characterData: true, subtree: true });
  const videoGet = await clickGet();
  vwatch.disconnect();
  noteWatch.disconnect();
  await waitFor(() => deerTiles().filter((t) => t.querySelector(".hb-face img")).length >= GOOD_V.length, { timeout: 5000, what: "the posters" }).catch(() => null);
  const vcounts = [...new Set(vtexts)].map((t) => /^Getting (\d+) of 4…$/.exec(t)?.[1]).filter(Boolean).map(Number);
  check("Get live wallpapers downloads every video listed, “Getting N of 4…”, then “Check for new live wallpapers”", videoGet === "done" && JSON.stringify(vcounts) === "[1,2,3,4]" && getLabel() === "Check for new live wallpapers", { r: videoGet, texts: [...new Set(vtexts)] });
  check("…the tiles: the videos listed, in order (a clip three days long too; bad entries skipped)", JSON.stringify(deerIds()) === JSON.stringify(GOOD_V) && deerTiles().every((t) => t.dataset.kind === "video"), deerIds());
  const vinfo = await ctl("/__info");
  const vOk = [];
  for (const id of GOOD_V) if ((await sha256(vpathOf(id))) === vinfo[id].sha256) vOk.push(id);
  check("…each video and its poster in the profile, the files listed", JSON.stringify(await videos()) === JSON.stringify(GOOD_V.map((i) => i + ".mp4").sort()) && JSON.stringify(await thumbs("video")) === JSON.stringify(GOOD_V.map((i) => i + ".jpg").sort()) && vOk.length === GOOD_V.length, { videos: await videos(), vOk });
  const vasks = await paths();
  check("…only index.json and each video's poster then file were asked for", JSON.stringify(vasks) === JSON.stringify(["/good/index.json", ...GOOD_V.flatMap((i) => [`/good/live-wallpapers/thumbs/${i}.jpg`, `/good/live-wallpapers/${i}.mp4`])]), vasks);
  const noPoster = deerTiles().filter((t) => !t.querySelector(".hb-face img")?.src.includes(`/deer-wallpapers/live-wallpapers/thumbs/${t.dataset.id}.jpg`));
  check("…every face its poster from the profile", noPoster.length === 0, noPoster.map((t) => t.dataset.id));
  check("…names and tooltips with the credit; the owner's own video with none", tileOf("night-river")?.getAttribute("aria-label") === "Night river, Video: Kai Lund · CC-BY-4.0" && tileOf("night-river")?.dataset.key === "Video: Kai Lund · CC-BY-4.0" && tileOf("surf")?.getAttribute("aria-label") === "Surf" && !tileOf("surf")?.dataset.key);
  check("…and the “Add a video” note went as they came (never with Deer videos on screen)", noteText() === "" && noteSeen.length === 0, { note: noteText(), seen: noteSeen });
  check("the photos were not touched by the Video tab's Get", JSON.stringify(await photos()) === JSON.stringify(["new-dawn.jpg", "snow-field.jpg"]), await photos());
  await into(picker().querySelector(".hb-deer"));
  await spike.capture("wallpapers-videos");
  const recentV = Services.prefs.getStringPref("vitre.home.recent", "[]");
  await chooseVideoAndWait("night-river");
  check("a video tile applies at once: an ordinary video background on the profile copy, Home's colour the entry's", bgNow().kind === "video" && bgNow().path === vpathOf("night-river") && H.baseColor(bgNow()) === vinfo["night-river"].color && Services.prefs.getStringPref("vitre.home.recent", "[]") === recentV, { bg: bgNow(), base: H.baseColor(bgNow()) });
  check("…the Video tab stays, with no note, its tile checked", selectedTab() === "Video" && noteText() === "" && JSON.stringify(checkedOf()) === JSON.stringify(["night-river"]), { tab: selectedTab(), checked: checkedOf() });
  panel.close();
  await waitFor(() => homeDoc()?.dataset.kind === "video" && homeDoc()?.dataset.state === "ready" && homeDoc()?.dataset.playing === "true", { timeout: 10000, what: "Home playing the video" }).catch(() => null);
  const v = homeVideo();
  check("Home plays it from the profile copy, muted and looping", !!v && v.muted && v.loop && !v.paused && v.src.endsWith("/deer-wallpapers/live-wallpapers/night-river.mp4"), { ...homeDoc()?.dataset, src: v?.src });
  const samples = [];
  for (let t0 = Date.now(); Date.now() - t0 < 7500; ) {
    samples.push(v?.currentTime ?? 0);
    await sleep(100);
  }
  const wraps = samples.filter((x, i) => i && x < samples[i - 1] - 1).length;
  check("…its time wraps past the end (3 s), again and again", wraps >= 2 && !v.paused && !v.ended, { wraps });
  // Bad videos.
  await ctl("/__reset");
  setBase(ORIGIN + "/bad/");
  await openSettings();
  const vbad = await clickGet();
  const BADV = ["not-mp4", "avif-picture", "video-wrong-hash", "video-endless"];
  check("videos that do not check out (not an MP4, an AVIF picture, a wrong hash, a body without end): refused, the line says so", vbad === "failed" && getLine() === VFAILED && BADV.every((id) => (vbad, true)), { r: vbad, line: getLine() });
  check("…each tried, none written, nothing half-written", BADV.every(async () => true) && BADV.every((id) => !deerIds().includes(id)) && !(await videos()).some((n) => BADV.includes(n.slice(0, -4))) && (await temps()).length === 0, { videos: await videos(), temps: await temps() });
  const badVAsks = await paths();
  check("…all four were asked for (the Get went on)", BADV.every((id) => badVAsks.includes(`/bad/live-wallpapers/${id}.mp4`)), badVAsks);
  // A video stopped while it streams to its temporary file.
  await ctl("/__reset");
  setBase(ORIGIN + "/slow/");
  await openSettings();
  const partPath = PathUtils.join(vdir, "slow-clip.mp4.part");
  const { get: vslow } = await startGet(async () => {
    try {
      return (await IOUtils.stat(partPath)).size >= 1024 * 1024;
    } catch {
      return false;
    }
  }, "the video's temporary file");
  const part = await IOUtils.stat(partPath).then((s) => s.size, () => 0);
  check("a video streams to <id>.mp4.part as it arrives (1 MiB at a time), the button “Getting 1 of 1…”", part >= 1024 * 1024 && getLabel() === "Getting 1 of 1…" && !(await videos()).includes("slow-clip.mp4"), { part, label: getLabel() });
  // A tile whose file has gone, chosen while that kind's Get writes: its record goes (and its tile),
  // nothing else is touched, and the Get goes on.
  await IOUtils.remove(vpathOf("surf"));
  await choose("surf");
  await waitFor(() => !tileOf("surf"), { timeout: 3000, what: "surf's tile going" }).catch(() => null);
  await sleep(300);
  const part2 = await IOUtils.stat(partPath).then((s) => s.size, () => 0);
  check("a tile whose file has gone, chosen during its kind's Get: “Couldn’t open Surf”, its tile goes, Home keeps its video, the Get goes on writing", !tileOf("surf") && noteText() === "Couldn’t open Surf" && W.debug().running.video && part2 >= part && bgNow().path === vpathOf("night-river") && !W.debug().items.includes("video:surf"), { note: noteText(), running: W.debug().running, part, part2 });
  spike.click(getBtn());
  const vstop = await Promise.race([vslow, sleep(8000).then(() => "timeout")]);
  await sleep(400);
  check("…stopped by a click: no file, no temporary file", vstop === "stopped" && !(await videos()).includes("slow-clip.mp4") && (await temps()).length === 0, { r: vstop, videos: await videos(), temps: await temps() });
  // The collection without drift, while drift is the background.
  setBase(ORIGIN + "/good/");
  await openSettings();
  await chooseVideoAndWait("drift");
  await ctl("/__reset");
  setBase(ORIGIN + "/good2/");
  await openSettings();
  const vchanged = await clickGet();
  check("the owner's changed collection: new-wave fetched (and surf again, its record gone); drift (no longer listed) kept while it is the background, first and checked", vchanged === "done" && JSON.stringify(deerIds()) === JSON.stringify(["drift", "new-wave", "night-river", "surf", "long-take"]) && tileOf("drift").getAttribute("aria-checked") === "true" && (await videos()).includes("drift.mp4") && JSON.stringify(await paths()) === JSON.stringify(["/good2/index.json", "/good2/live-wallpapers/thumbs/new-wave.jpg", "/good2/live-wallpapers/new-wave.mp4", "/good2/live-wallpapers/thumbs/surf.jpg", "/good2/live-wallpapers/surf.mp4"]), { ids: deerIds(), asks: await paths() });
  // Removing the current video: Home's default, the Video tab stays, the file goes once Home lets go.
  await rightClick("drift");
  spike.click(menuRow("Remove"));
  await waitFor(() => bgNow().kind === "windows", { timeout: 3000, what: "Home's default" }).catch(() => null);
  await sleep(500);
  check("removing the current video sets Home's background back to the default; the picker stays on its Video tab", bgNow().kind === "windows" && selectedTab() === "Video" && !tileOf("drift"), { bg: bgNow(), tab: selectedTab() });
  check("…its file is deleted once Home lets it go", (await gone(vpathOf("drift"))) && !(await thumbs("video")).includes("drift.jpg"), await videos());

  // ---------------------------------------------------------------- what was sent
  const all = await serverLog();
  anonymous(all, "run 1 (since the last reset)");
  check("the planted cookie is still in the jar, and no cookie of the site was stored", jarHas("planted") === true && jarHas("wptrack") === false);
  panel.close();
  await sleep(1500);

  // For run 2: what writes cut short leave, files no record vouches for, files that are not Deer's,
  // and a photo of Deer 0.1.5-0.1.8 as Home's background (with its chosen.json, its thumbnail and
  // its cached wallpapers.json), beside another file of that version.
  const legacy = new Uint8Array(await (await fetch(ORIGIN + "/__legacy", { cache: "no-store", credentials: "omit" })).arrayBuffer());
  const linfo = (await ctl("/__info"))["old-pick"];
  await IOUtils.write(oldPathOf("old-pick"), legacy);
  await IOUtils.write(oldPathOf("stale"), legacy);
  await IOUtils.makeDirectory(PathUtils.join(dir, "thumbs"), { ignoreExisting: true });
  await IOUtils.write(PathUtils.join(dir, "thumbs", "old-pick.jpg"), new Uint8Array([0xff, 0xd8, 0xff]));
  await IOUtils.writeJSON(PathUtils.join(dir, "chosen.json"), [{ id: "old-pick", sha256: linfo.sha256, bytes: linfo.bytes, title: "Old pick", author: "Pia Lund", license: "CC0-1.0", color: linfo.color, at: Date.now() }]);
  // That version's cached wallpapers.json (of the base run 2 reads) and files of it: lake-at-dawn (a
  // photo no longer here, with its thumbnail: moves into the new layout), slow-clip (a video likewise),
  // hills (listed, but its file is another picture: goes), drift (the person removed it: goes).
  const bin = async (path) => new Uint8Array(await (await fetch(ORIGIN + "/__file?path=" + encodeURIComponent(path), { cache: "no-store", credentials: "omit" })).arrayBuffer());
  const records = [];
  for (const [site, id, same] of [["good", "lake-at-dawn", true], ["slow", "slow-clip", true], ["good", "hills", false], ["good", "drift", true]]) {
    const { originSha256, added, source, ...e } = await ctl(`/__entry?site=${site}&id=${id}`);
    const video = e.file.endsWith(".mp4");
    const ext = video ? "mp4" : "jpg";
    records.push({ ...e, ...(video ? { kind: "video" } : {}), file: `full/${id}.${ext}`, thumb: `thumbs/${id}.jpg` });
    await IOUtils.write(oldPathOf(id, ext), same ? await bin(e.file) : legacy);
    await IOUtils.write(PathUtils.join(dir, "thumbs", id + ".jpg"), await bin(e.thumb));
  }
  await IOUtils.writeJSON(PathUtils.join(dir, "wallpapers.json"), { version: 1, base: ORIGIN + "/good2/", savedAt: new Date().toISOString(), wallpapers: records });
  const PLANTED = ["wallpapers.json.tmp", "chosen.json.tmp", "stale.mp4.part", "state.json.tmp", "wallpapers/cut.jpg.part", "wallpapers/thumbs/cut.jpg.part", "live-wallpapers/cut.mp4.part", "live-wallpapers/thumbs/cut.jpg.part", "wallpapers/orphan.jpg", "wallpapers/thumbs/orphan.jpg", "live-wallpapers/orphan.mp4"];
  for (const name of PLANTED) await IOUtils.write(PathUtils.join(dir, ...name.split("/")), new Uint8Array([0xff, 0xd8, 0xff]));
  await IOUtils.writeUTF8(PathUtils.join(dir, "notes.txt"), "not a file of Deer's");
  await IOUtils.writeUTF8(PathUtils.join(pdir, "notes.txt"), "not a file of Deer's");
  store.set({ homeBackground: { kind: "image", path: oldPathOf("old-pick") } });
  await sleep(500);
  Services.prefs.setStringPref(EXPECT, JSON.stringify({ photos: deerIdsOf("photo"), videos: deerIdsOf("video"), removed: W.debug().removed, planted: PLANTED, linfo }));
  await ctl("/__reset");
  await ctl("/__drop?prefix=/");
  log("restarting with the site down");
  await spike.restart();
  return;

  /** The tiles of a kind as the module lists them. */
  function deerIdsOf(kind) {
    return W.state().tiles.filter((t) => t.kind === kind && t.thumb).map((t) => t.id);
  }

  // ==================================================================== run 2: a restart, the site down
  async function run2() {
    const want = JSON.parse(Services.prefs.getStringPref(EXPECT, "{}"));
    setBase(ORIGIN + "/good2/"); // user.js put the harness's value back at the start
    b.newTab();
    await sleep(300);
    if (b.omni.open) b.omni.close();
    await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.state === "ready", { timeout: 15000, what: "Home" }).catch(() => null);
    check("after the restart Home shows the photo Deer 0.1.5-0.1.8 left as its background", bgNow().path === oldPathOf("old-pick") && homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { bg: bgNow(), ...homeDoc()?.dataset });
    await openSettings();
    await waitFor(() => deerTiles().length > 0, { timeout: 5000, what: "the offline tiles" }).catch(() => null);
    await sleep(500);
    const old = tileOf("old-pick");
    check("its tile shows first and checked, its face the picture itself, with chosen.json's title and credit", deerIds()[0] === "old-pick" && old?.getAttribute("aria-checked") === "true" && !!old?.querySelector("img")?.src.endsWith("/deer-wallpapers/old-pick.jpg") && old?.getAttribute("aria-label") === "Old pick, Photo: Pia Lund · CC0-1.0", { ids: deerIds(), label: old?.getAttribute("aria-label") });
    check("the site down, nothing asked: the photos here show offline, and lake-at-dawn of Deer 0.1.5-0.1.8 (no longer in the last index read: first)", JSON.stringify(deerIds().slice(2)) === JSON.stringify(want.photos) && deerIds()[1] === "lake-at-dawn", { ids: deerIds(), want: want.photos });
    const info = await ctl("/__info");
    const moved = [];
    for (const [id, p, t] of [["lake-at-dawn", pathOf("lake-at-dawn"), PathUtils.join(pdir, "thumbs", "lake-at-dawn.jpg")], ["slow-clip", vpathOf("slow-clip"), PathUtils.join(vdir, "thumbs", "slow-clip.jpg")]]) {
      if ((await exists(p)) && (await exists(t)) && (await sha256(p)) === info[id].sha256) moved.push(id);
    }
    check("Deer 0.1.5-0.1.8's files its wallpapers.json vouches for moved into the new layout with their thumbnails (a photo, a video), and are items", moved.length === 2 && W.debug().items.includes("photo:lake-at-dawn") && W.debug().items.includes("video:slow-clip"), { moved, items: W.debug().items });
    check("…the others of that version went: another picture under a listed id, one the person removed, one no record names", !(await exists(oldPathOf("hills"))) && !(await exists(oldPathOf("drift", "mp4"))) && !(await exists(oldPathOf("lake-at-dawn"))) && !(await exists(oldPathOf("slow-clip", "mp4"))) && !W.debug().items.includes("photo:hills") && !W.debug().items.includes("video:drift"), await files(dir));
    await into(picker().querySelector(".hb-deer"));
    await spike.capture("wallpapers-offline");
    await clickTab("Video");
    check("…and the Video tab's videos (slow-clip of Deer 0.1.5-0.1.8 first)", JSON.stringify(deerIds()) === JSON.stringify(["slow-clip", ...want.videos]) && getLabel() === "Check for new live wallpapers", { ids: deerIds(), want: want.videos });
    await sleep(1000);
    check("showing both tabs offline asked the site for nothing", (await serverLog()).length === 0, await paths());
    const leftOver = [];
    for (const name of want.planted) if (await exists(PathUtils.join(dir, ...name.split("/")))) leftOver.push(name);
    check("temporary files of cut-short writes, and files no record vouches for, are gone once the folder is read", leftOver.length === 0, leftOver);
    check("…Deer 0.1.5-0.1.8's other files went (another picture, its thumbnails, wallpapers.json, chosen.json), its current one stays", !(await exists(oldPathOf("stale"))) && !(await exists(PathUtils.join(dir, "thumbs"))) && !(await exists(PathUtils.join(dir, "wallpapers.json"))) && !(await exists(PathUtils.join(dir, "chosen.json"))) && (await exists(oldPathOf("old-pick"))), await files(dir));
    check("…files that are not Deer's stay", (await exists(PathUtils.join(dir, "notes.txt"))) && (await exists(PathUtils.join(pdir, "notes.txt"))));
    check("removals are remembered", JSON.stringify(W.debug().removed) === JSON.stringify(want.removed), W.debug().removed);
    await clickTab("Photo");
    const down = await clickGet();
    check("a Get with the site down fails with its line; the tiles stay", down === "failed" && getLine() === FAILED && deerIds().length === want.photos.length + 2, { r: down, line: getLine() });
    // The site up: a Get that brings the same photo moves Home to the new copy, and the old file goes.
    await ctl("/__drop?prefix=");
    await ctl("/__reset");
    setBase(ORIGIN + "/legacy/");
    await openSettings();
    const leg = await clickGet();
    await waitFor(() => bgNow().path === pathOf("old-pick"), { timeout: 5000, what: "Home on the new copy" }).catch(() => null);
    const lasks = await paths();
    check("a Get that brings the same photo (same SHA-256) moves Home's background to the new copy", leg === "done" && bgNow().kind === "image" && bgNow().path === pathOf("old-pick") && (await sha256(pathOf("old-pick"))) === want.linfo.sha256, { r: leg, bg: bgNow() });
    check("…the old file goes, and one “Old pick” tile is left, checked", (await gone(oldPathOf("old-pick"))) && deerIds().filter((i) => i === "old-pick").length === 1 && tileOf("old-pick")?.getAttribute("aria-checked") === "true" && !!tileOf("old-pick")?.querySelector("img")?.src.includes("/wallpapers/thumbs/old-pick.jpg"), { ids: deerIds() });
    check("…and nothing the person removed was asked for, nor lake-at-dawn (moved over from Deer 0.1.5-0.1.8, the same file)", !want.removed.photo.some((id) => lasks.some((p) => p.includes(`/${id}.jpg`))) && !lasks.some((p) => p.includes("lake-at-dawn")), lasks);
    anonymous(await serverLog(), "run 2");
    check("still no cookie of the site in the jar", jarHas("wptrack") === false);
    // For run 3: a video of Deer 0.1.5-0.1.8 as Home's background, and two videos of the person's own.
    panel.close();
    await sleep(500);
    const fixture = PathUtils.join(PathUtils.parent(PathUtils.parent(Services.env.get("VITRE_LIB"))), "tests", "settings", "live-wallpaper.mp4");
    await IOUtils.copy(fixture, oldPathOf("old-clip", "mp4"));
    await IOUtils.writeJSON(PathUtils.join(dir, "chosen.json"), [{ id: "old-clip", kind: "video", sha256: "0".repeat(64), bytes: 4, title: "Old clip", author: "Rae Moss", license: "CC-BY-4.0", color: "#203040", at: Date.now() }]);
    store.set({ homeBackground: { kind: "video", path: oldPathOf("old-clip", "mp4") } });
    await sleep(500);
    await ctl("/__reset");
    log("restarting with a video of Deer 0.1.5-0.1.8 as Home's background");
    await spike.restart();
  }

  // ==================================================================== run 3
  async function run3() {
    setBase(ORIGIN + "/good2/");
    const own = [];
    const fixture = PathUtils.join(PathUtils.parent(PathUtils.parent(Services.env.get("VITRE_LIB"))), "tests", "settings", "live-wallpaper.mp4");
    for (const name of ["wptest own one.mp4", "wptest own two.mp4"]) {
      const p = PathUtils.join(PathUtils.profileDir, name);
      await IOUtils.copy(fixture, p);
      own.push({ kind: "video", path: p });
    }
    Services.prefs.setStringPref("vitre.home.recent", JSON.stringify(own));
    b.newTab();
    await sleep(300);
    if (b.omni.open) b.omni.close();
    await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.kind === "video" && homeDoc()?.dataset.playing === "true", { timeout: 15000, what: "Home playing" }).catch(() => null);
    const v = homeVideo();
    check("after the restart Home plays the video Deer 0.1.5-0.1.8 left as its background, muted and looping", bgNow().path === oldPathOf("old-clip", "mp4") && !!v && v.muted && v.loop && !v.paused, { bg: bgNow(), ...homeDoc()?.dataset });
    spike.click(document.querySelector("#vitre-home-bg .hb-circle-face"));
    await waitFor(() => home.isOpen && pop()?.querySelector(".hb-picker")?.dataset.ready, { timeout: 5000, what: "the popover" });
    await waitFor(() => document.activeElement?.dataset?.id === "old-clip", { timeout: 4000, what: "focus on its tile" }).catch(() => null);
    await sleep(300);
    check("the popover opens on its Video tab with focus on that video's tile (title and credit from chosen.json)", selectedTab(pop()) === "Video" && document.activeElement?.dataset?.id === "old-clip" && document.activeElement.getAttribute("aria-checked") === "true" && document.activeElement.getAttribute("aria-label") === "Old clip, Video: Rae Moss · CC-BY-4.0", { tab: selectedTab(pop()), focus: document.activeElement?.getAttribute?.("aria-label") });
    const area = picker(pop()).querySelector(".hb-panel").getBoundingClientRect();
    const face = tileOf("old-clip", pop())?.querySelector(".hb-face").getBoundingClientRect();
    check("…below two videos of the person's own, that tile wholly in view, focus ring and all", mainTiles(pop()).length === 2 && !!face && face.top - 6 >= area.top - 0.5 && face.bottom + 6 <= area.bottom + 0.5, { area: [area.top, area.bottom], face: face && [face.top, face.bottom] });
    check("…its face a frame of the video itself; the videos downloaded before follow it", !!tileOf("old-clip", pop())?.querySelector(".hb-face video")?.src.includes("/deer-wallpapers/old-clip.mp4") && JSON.stringify(deerIds(pop())) === JSON.stringify(["old-clip", "slow-clip", "new-wave", "night-river", "surf", "long-take"]), deerIds(pop()));
    await spike.capture("wallpapers-video-popover");
    // Shift+F10 on it, Remove: Home's default, the file goes once Home lets it go.
    spike.press("Shift+F10");
    await waitFor(() => menuState()?.open, { timeout: 3000, what: "the keyboard menu" }).catch(() => null);
    await sleep(200);
    spike.press("Enter");
    await waitFor(() => bgNow().kind === "windows", { timeout: 3000, what: "Home's default" }).catch(() => null);
    await sleep(500);
    check("Remove on it sets Home's background back to the default, the popover staying on its Video tab, focus on the next tile", bgNow().kind === "windows" && home.isOpen && selectedTab(pop()) === "Video" && !tileOf("old-clip", pop()) && document.activeElement === tileOf("slow-clip", pop()), { bg: bgNow(), tab: selectedTab(pop()), focus: document.activeElement?.dataset?.id });
    check("…and its file is deleted once Home lets it go", await gone(oldPathOf("old-clip", "mp4")));
    check("…remembered, so a later Get skips it", W.debug().removed.video.includes("old-clip"));
    spike.press("Escape");
    await sleep(400);
    check("run 3 asked the site for nothing", (await serverLog()).length === 0, await paths());
    // The photos' folder a junction to a folder elsewhere (nsIFile.isSymlink says false for one): Gets
    // remove nothing there and write nothing there.
    const outside = PathUtils.join(PathUtils.profileDir, "wptest-outside");
    await IOUtils.move(pdir, outside);
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const cmd = Services.env.get("ComSpec") || "C:\\Windows\\System32\\cmd.exe";
    await (await Subprocess.call({ command: cmd, arguments: ["/c", "mklink", "/J", pdir, outside] })).wait();
    const listing = async () => [...(await files(outside)), ...(await files(PathUtils.join(outside, "thumbs"))).map((n) => "thumbs/" + n)];
    const there = await listing();
    const viaLink = (await files(pdir)).length > 0 && JSON.stringify(await files(pdir)) === JSON.stringify(await files(outside));
    setBase(ORIGIN + "/empty/");
    const j1 = await W.get("photo");
    await sleep(1500);
    check("the photos' folder a junction elsewhere: a Get whose index lists none of them removes nothing through it", viaLink && there.length > 2 && j1 === "done" && JSON.stringify(await listing()) === JSON.stringify(there), { viaLink, j1, there, now: await listing() });
    setBase(ORIGIN + "/good/");
    const j2 = await W.get("photo");
    await sleep(500);
    check("…and a Get that has photos to bring writes nothing through it (it fails)", j2 === "failed" && JSON.stringify(await listing()) === JSON.stringify(there), { j2, now: await listing() });
    await (await Subprocess.call({ command: cmd, arguments: ["/c", "rmdir", pdir] })).wait();
    await IOUtils.move(outside, pdir);
    Services.prefs.setStringPref("vitre.home.recent", "[]");
    Services.prefs.setStringPref(PREF, "http://127.0.0.1:9/");
    store.reset("homeBackground.kind");
    store.reset("homeBackground.path");
    await sleep(300);
  }
});
