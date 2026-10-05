// v6 (verifier): the omnibox data claims under less friendly conditions.
//   1. suggest() timing with a realistic history (60 000 pages), not 7 rows.
//   2. Services.search really absent; SearchService module present.
//   3. LIKE escaping with %, _, /, quotes; non-ASCII; very long input.
//   4. tabs of a second window are offered; a private window's pages are not written to history.
//   5. PlacesUtils.history.remove on a URL that is open / bookmarked.
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreOmniboxData */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-omnibox-data.js?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  spike.log("typeof Services.search = " + typeof Services.search + "; 'search' in Services = " + ("search" in Services));
  await KS.load(KS.pageURL("keys.html"));

  // ---- 1. scale
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango"];
  const N = 60000, CHUNK = 5000;
  const t0 = performance.now();
  const now = Date.now();
  for (let c = 0; c < N / CHUNK; c++) {
    const batch = [];
    for (let i = 0; i < CHUNK; i++) {
      const n = c * CHUNK + i;
      const w1 = words[n % 20], w2 = words[(n * 7 + 3) % 20];
      batch.push({ url: "https://" + w1 + (n % 900) + ".example/" + w2 + "/" + n + "?q=" + w1, title: w1 + " " + w2 + " page " + n, visits: [{ date: new Date(now - (n % 400) * 86400000 - n * 1000), transition: PlacesUtils.history.TRANSITIONS.LINK }] });
    }
    await PlacesUtils.history.insertMany(batch);
  }
  await PlacesUtils.history.insertMany([
    { url: "https://github.com/mozilla/gecko-dev", title: "mozilla/gecko-dev", visits: Array.from({ length: 20 }, (_, i) => ({ date: new Date(now - i * 3600000), transition: PlacesUtils.history.TRANSITIONS.TYPED })) },
    { url: "https://example.org/100%_done/it's", title: "50%_x \"quoted\" it's", visits: [{ date: new Date(now), transition: PlacesUtils.history.TRANSITIONS.TYPED }] },
    { url: "https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC", title: "日本 - Wikipedia", visits: [{ date: new Date(now), transition: PlacesUtils.history.TRANSITIONS.TYPED }] },
  ]);
  const db = await PlacesUtils.promiseLargeCacheDBConnection();
  const count = (await db.execute("SELECT count(*) AS n FROM moz_places"))[0].getResultByName("n");
  spike.log("inserted in " + Math.round(performance.now() - t0) + " ms; moz_places rows: " + count);
  const time = async (q, fn = VitreOmniboxData.suggest) => {
    const runs = [];
    let rows = [];
    for (let i = 0; i < 5; i++) { const t = performance.now(); rows = await fn(q, { limit: 6 }); runs.push(Math.round(performance.now() - t)); }
    return { q, ms: runs, n: rows.length, first: rows[0] ? (rows[0].url || "").slice(0, 60) : null };
  };
  for (const q of ["g", "gi", "git", "github", "tango", "tango 123", "page 59999", "zzzzqqq", "example", "e", ""]) spike.log("  suggest " + JSON.stringify(await time(q)));
  // keystroke burst: 8 queries fired without waiting, as fast typing does
  const tb = performance.now();
  const burst = await Promise.all(["s", "si", "sie", "sier", "sierr", "sierra", "sierra ", "sierra 4"].map((q) => VitreOmniboxData.suggest(q, { limit: 6 })));
  spike.log("  burst of 8 overlapping queries: " + Math.round(performance.now() - tb) + " ms total, last has " + burst[7].length + " rows");
  // main-thread jank while a query runs (the query is async on the Places connection thread)
  let maxGap = 0, last = performance.now(), stop = false;
  const tick = () => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; if (!stop) setTimeout(tick, 0); };
  tick();
  for (let i = 0; i < 10; i++) await VitreOmniboxData.suggest("zzzzqqq" + i, { limit: 6 });
  stop = true;
  spike.log("  longest main-thread gap during 10 no-match (full scan) queries: " + Math.round(maxGap) + " ms");
  const tu = performance.now();
  let viaUrlbar = null;
  try { viaUrlbar = await VitreOmniboxData.suggestViaUrlbar("tango", { limit: 8 }); } catch (e) { viaUrlbar = "ERR " + e; }
  spike.log("  Firefox urlbar providers for 'tango' on the same DB: " + Math.round(performance.now() - tu) + " ms, " + (Array.isArray(viaUrlbar) ? viaUrlbar.length + " rows" : viaUrlbar));

  // ---- 3. escaping
  for (const q of ["100%_done", "50%_x", "it's", "\"quoted\"", "日本", "%", "_", "/", "a".repeat(3000)]) {
    let r;
    try { const rows = await VitreOmniboxData.suggest(q, { limit: 6 }); r = rows.length + " rows" + (rows[0] ? ", first " + rows[0].url.slice(0, 50) : ""); } catch (e) { r = "THROWS " + String(e).slice(0, 120); }
    spike.log("  suggest(" + JSON.stringify(q.length > 20 ? q.slice(0, 8) + "...x" + q.length : q) + ") -> " + r);
  }

  // ---- 4. second window + private window
  const w2 = window.OpenBrowserWindow();
  await new Promise((r) => w2.addEventListener("load", r, { once: true }));
  for (let i = 0; i < 40 && !w2.gBrowser; i++) await spike.sleep(100);
  await spike.sleep(1200);
  w2.gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.org/?second-window", { triggeringPrincipal: KS.sysPrincipal });
  const wp = window.OpenBrowserWindow({ private: true });
  await new Promise((r) => wp.addEventListener("load", r, { once: true }));
  for (let i = 0; i < 40 && !wp.gBrowser; i++) await spike.sleep(100);
  await spike.sleep(1200);
  wp.gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/?private-window", { triggeringPrincipal: KS.sysPrincipal });
  await spike.sleep(3500);
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const rows = await VitreOmniboxData.suggest("example.", { limit: 8 });
  spike.log("  second window at " + w2.gBrowser.currentURI.spec + "; private window (isPrivate=" + PrivateBrowsingUtils.isWindowPrivate(wp) + ") at " + wp.gBrowser.currentURI.spec);
  spike.log("  suggest('example.') from window 1: " + JSON.stringify(rows.map((r) => r.kind + ":" + r.url.slice(0, 50))));
  spike.log("  private page in history: " + JSON.stringify(await PlacesUtils.history.fetch("https://example.com/?private-window")) + " | normal second-window page in history: " + !!(await PlacesUtils.history.fetch("https://example.org/?second-window")));
  spike.log("  LEAK CHECK: suggest() offers the private window's tab to the normal window: " + rows.some((r) => r.kind === "switch" && r.url.includes("private-window")));
  wp.close(); w2.close();
  await spike.sleep(500);

  // ---- 5. remove
  const bm = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.unfiledGuid, url: "https://github.com/mozilla/gecko-dev", title: "gecko-dev bookmark" });
  const removed = await VitreOmniboxData.removeFromHistory("https://github.com/mozilla/gecko-dev");
  const after = await VitreOmniboxData.suggest("github", { limit: 6 });
  spike.log("  remove a bookmarked history URL -> " + removed + "; suggest('github') now " + JSON.stringify(after.map((r) => r.kind + ":" + r.url)) + "; history.fetch: " + JSON.stringify(await PlacesUtils.history.fetch("https://github.com/mozilla/gecko-dev")) + "; bookmark still there: " + !!(await PlacesUtils.bookmarks.fetch(bm.guid)));
  spike.log("  remove a URL that is not in history -> " + (await VitreOmniboxData.removeFromHistory("https://never-visited.example/")));
});
