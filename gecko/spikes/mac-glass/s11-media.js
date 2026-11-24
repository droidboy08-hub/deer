// Spike S11, media-query half: do (prefers-reduced-transparency) and (prefers-contrast) exist and
// report in Firefox 157, in Deer's chrome document and in a web page? Run plain (the Mac's own
// settings), then with Gecko's LookAndFeel overrides to show the queries are wired (this changes
// nothing on the Mac):
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s11-media.js --name mac-glass-s11 --url about:blank --timeout 120 --out tests/menus/out --no-capture
//   ... --pref ui.prefersReducedTransparency=1 --pref ui.useAccessibilityTheme=1
/* global spike, G, Services, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
spike.main(async () => {
  const { log, check } = spike;
  const qs = [
    "(prefers-reduced-transparency)",
    "(prefers-reduced-transparency: reduce)",
    "(prefers-reduced-transparency: no-preference)",
    "(prefers-reduced-transparency: bogus)",
    "(prefers-contrast)",
    "(prefers-contrast: more)",
    "(prefers-contrast: less)",
    "(prefers-contrast: custom)",
    "(prefers-contrast: no-preference)",
    "(forced-colors: active)",
    "(inverted-colors: inverted)",
    "(prefers-reduced-motion: reduce)",
  ];
  const run = (win) => Object.fromEntries(qs.map((q) => { const m = win.matchMedia(q); return [q, m.media === "not all" ? "UNSUPPORTED" : m.matches]; }));
  const prefs = {};
  for (const p of ["ui.prefersReducedTransparency", "ui.useAccessibilityTheme", "ui.prefersReducedMotion", "layout.css.prefers-reduced-transparency.enabled"]) {
    const t = Services.prefs.getPrefType(p);
    prefs[p] = t === 128 ? Services.prefs.getBoolPref(p) : t === 64 ? Services.prefs.getIntPref(p) : "(unset)";
  }
  log("S11 prefs " + JSON.stringify(prefs));
  const chrome = run(window);
  log("S11 chrome " + JSON.stringify(chrome));
  // A change listener, as Deer would use one.
  const mq = matchMedia("(prefers-reduced-transparency: reduce)");
  log("S11 chrome MediaQueryList has addEventListener: " + (typeof mq.addEventListener === "function"));
  await G.load(G.page("Media", "#fff", "#000", "<p>media</p>"));
  const content = await G.inContent(gBrowser.selectedBrowser, (c, list) => Object.fromEntries(list.map((q) => { const m = c.matchMedia(q); return [q, m.media === "not all" ? "UNSUPPORTED" : m.matches]; })), qs);
  log("S11 content " + JSON.stringify(content));
  check("the queries parse in chrome", chrome["(prefers-reduced-transparency: reduce)"] !== "UNSUPPORTED" && chrome["(prefers-contrast: more)"] !== "UNSUPPORTED", chrome);
  check("the queries parse in a web page", content["(prefers-reduced-transparency: reduce)"] !== "UNSUPPORTED" && content["(prefers-contrast: more)"] !== "UNSUPPORTED", content);
});
