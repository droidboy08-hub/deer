// The page strip on YouTube (owner's report, 2026-10-06: "it doesn't work quite right on sites like
// YouTube"). YouTube pins its header (56 px) and, below it, its guide (the side menu: top 56px,
// stretched to the bottom). The strip moves the header below Deer's bar; the guide must move with it
// instead of starting under the header (its first entry, "Home", sat on the YouTube logo).
//   python tools/run.py --test tests/input/inset-youtube.js --name input-inset-youtube --timeout 240
// Needs the network (www.youtube.com). Captures: yt-home-0, yt-home-400, yt-watch-0, yt-watch-guide.
/* global spike, K, Services, ChromeUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { load, inPage } = K;
  const Settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  Settings.set({ barAutoHide: false, pageInset: true });
  await spike.resize(1440, 900);
  await spike.activate();

  const state = () => b.page(b.active()).query("inset:state", {});
  const scroll = (y) => inPage(`function (w, d) { w.scrollTo({ top: ${y}, left: 0, behavior: "instant" }); return w.scrollY; }`);
  const parts = () =>
    inPage(`function (w, d) {
      const box = (sel) => {
        const el = d.querySelector(sel);
        if (!el || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null;
      };
      return {
        masthead: box("#masthead-container"), guide: box("tp-yt-app-drawer#guide"), guideItems: box("#guide-inner-content"),
        mini: box("ytd-mini-guide-renderer"), player: box("#movie_player"), pages: box("#page-manager"),
        H: d.documentElement.clientHeight, padding: w.getComputedStyle(d.documentElement).paddingTop, scrollY: w.scrollY,
      };
    }`);

  async function open(name, url) {
    await load(url);
    await sleep(6000);
    await scroll(0);
    await sleep(800);
    const s = await state();
    log(name, "pushed", JSON.stringify((s.pushed || []).map((p) => [p.kind, p.tag + (p.id ? "#" + p.id : ""), p.computed])), "log", JSON.stringify(s.log));
    const p = await parts();
    log(name, "parts", JSON.stringify(p));
    return { s, p };
  }

  // ---- Home: header, guide ----
  const home = await open("yt-home", "https://www.youtube.com/");
  if (!home.s.eligible || !home.p.masthead) {
    log("NOTE YouTube did not load as expected; nothing checked", JSON.stringify(home.p));
    return;
  }
  await spike.capture("yt-home-0");
  const m = home.p.masthead;
  check("YouTube: the strip is in and the header sits below Deer's bar", home.s.applied && m.top >= 67, { masthead: m, padding: home.p.padding });
  const side = home.p.guide ? "guide" : home.p.mini ? "mini" : null;
  if (side) {
    const g = home.p[side];
    const items = side === "guide" ? home.p.guideItems : g;
    check(`YouTube: the side menu (${side}) starts below the header, not under it`, items.top >= m.bottom - 1, { masthead: m, side: g, items });
    check(`YouTube: the side menu (${side}) still reaches the bottom of the window`, g.bottom >= home.p.H - 1, { side: g, H: home.p.H });
  } else log("NOTE no side menu at this width");
  await scroll(400);
  await sleep(900);
  const after = await parts();
  await spike.capture("yt-home-400");
  if (side) check("YouTube: after scrolling, the header and the side menu stay where they were", after.masthead.top === m.top && after[side].top === home.p[side].top, { before: [m.top, home.p[side].top], after: [after.masthead.top, after[side].top] });

  // ---- Watch page: player below the header; the guide opened as an overlay ----
  const watch = await open("yt-watch", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await spike.capture("yt-watch-0");
  if (watch.p.player) check("YouTube watch page: the player starts below the header", watch.p.player.top >= watch.p.masthead.bottom - 1, { masthead: watch.p.masthead, player: watch.p.player });
  await inPage(`function (w, d) { const btn = d.querySelector("#guide-button button, #guide-button"); if (btn) btn.click(); return !!btn; }`);
  const opened = await waitFor(async () => { const p = await parts(); return p.guideItems && p.guideItems.left >= -1 ? p : null; }, { timeout: 5000, what: "the guide opened" }).catch(() => null);
  if (opened) {
    await sleep(1500); // the probe runs on the next repaints
    const p = await parts();
    await spike.capture("yt-watch-guide");
    check("YouTube watch page: the opened side menu starts below Deer's bar", p.guideItems.top >= 67, { guide: p.guide, items: p.guideItems, masthead: p.masthead });
  } else log("NOTE the guide did not open on the watch page");
});
