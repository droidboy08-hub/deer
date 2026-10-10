// No flash of unstyled content while a site loads (owner's report, 2026-10-08: GitHub showed as a
// plain text page for a few ms before it was styled). Gecko warns "Layout was forced before the page
// was fully loaded" when something makes the page lay out before its style sheets are in: that
// layout can be painted, unstyled. Deer caused it on every page: the window's theme sampling took a
// drawSnapshot of a new document right after its address changed (browser.ts `unpainted`). This
// loads sites in a fresh profile (nothing cached) and fails on any such warning; then checks that
// the bar's glass still follows the page once it has painted.
//   python tools/run.py --test tests/input/fouc.js --name input-fouc --timeout 240
//   python tools/run.py --test tests/input/fouc.js --name input-fouc-stock --stock   (plain Firefox:
//   no warnings either; the comparison that confirmed the cause)
// Needs the network (github.com, en.wikipedia.org, www.mozilla.org).
/* global spike, K, Services, Ci, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { log, sleep } = spike;
  // Plain Firefox (run.py --stock, to compare) has no Deer: load through gBrowser.
  const load = window.vitre
    ? K.load
    : async (url) => {
        gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        await sleep(300);
        await spike.loaded();
      };
  await spike.resize(1440, 900);
  await spike.activate();

  const seen = [];
  const listener = {
    observe(msg) {
      try {
        const text = msg.message || String(msg);
        if (!/Layout was forced/.test(text)) return;
        const e = msg instanceof Ci.nsIScriptError ? msg : null;
        const stack = [];
        for (let f = e?.stack; f && stack.length < 8; f = f.parent) stack.push(`${f.source}:${f.line} ${f.functionDisplayName || ""}`);
        seen.push({ url: currentUrl, source: e ? `${e.sourceName}:${e.lineNumber}` : "?", stack });
      } catch (err) {
        seen.push({ url: currentUrl, error: String(err) });
      }
    },
  };
  let currentUrl = "";
  Services.console.registerListener(listener);
  const URLS = (Services.env.get("FOUC_URLS") || "https://github.com/,https://github.com/mozilla/gecko-dev,https://en.wikipedia.org/wiki/Deer,https://www.mozilla.org/en-US/").split(",");
  for (const url of URLS) {
    currentUrl = url;
    const before = seen.length;
    await load(url);
    await sleep(4000);
    log("loaded", url, "warnings:", seen.length - before);
  }
  Services.console.unregisterListener(listener);
  for (const w of seen) log("WARN", JSON.stringify(w));
  log("total", seen.length);
  spike.check("no page was laid out before its style sheets were in (no flash of unstyled content)", seen.length === 0, seen.map((w) => w.url));
  if (window.vitre) {
    // The glass still follows the page: Wikipedia is white under the bar.
    await load("https://en.wikipedia.org/wiki/Deer");
    await spike.waitFor(() => window.vitre.theme() === "light", { timeout: 8000, what: "light glass over Wikipedia" }).catch(() => null);
    spike.check("the bar's glass still follows the page after it loads (light over Wikipedia)", window.vitre.theme() === "light", window.vitre.theme());
  }
});
