// macOS One row, a crowded row (the owner, 2026-11-15: "make the titles shrink gradually first"): the
// background tabs' titles shrink together (a short title keeps its width, the longer ones share what is
// left) down to COMPACT_MIN, and only below that do they fold to favicons; then the active capsule gives
// way, then the strip scrolls. A narrow window shows titles when they fit (no more favicons-only under
// 900 px). Only the row's layout; the rest of the row is mac-onerow-behaviour.js.
//   python3 tools/run.py --test tests/menus/mac-row-titles.js --name mac-row-titles --url about:blank --timeout 200 [--pref ui.systemUsesDarkTheme=1]
// Captures: row-titles-1-six-tabs (the case that folded every title with 13 px missing),
// row-titles-2-shrunk (the most tabs that still show titles), row-titles-3-narrow (860 px, two tabs).
/* global spike, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log, waitFor } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  const COMPACT_MIN = 96;
  const COMPACT_MAX = 160;
  const host = document.getElementById("vitre-bar");
  const away = () => M.mouse(640, 600, { type: "mousemove" });
  const settle = async () => {
    await sleep(120);
    await waitFor(() => b.bar.state.settled, { timeout: 5000, what: "the row settles" }).catch(() => {});
    await sleep(520);
  };
  const titled = (t, bg = "#f4f2ec") => "data:text/html;charset=utf-8," + encodeURIComponent(
    `<!doctype html><meta charset=utf-8><title>${t}</title><body style="margin:0;background:${bg};color:#1d1d1f;font:17px Georgia"><h1 style="margin:80px 40px">${t}</h1>`);
  /** The row now: every background capsule's width, its title's shown and full width, and the room. */
  const row = () => {
    const p = b.bar.place;
    const r = p.row;
    const active = b.active().id;
    const tabs = b.tabs.filter((t) => t.id !== active).map((t) => {
      const item = b.bar.item(t.id);
      const title = item?.querySelector(".circle-face > .title");
      const shown = !!title && title.getClientRects().length > 0 && getComputedStyle(title).display !== "none";
      return { title: t.title, w: item ? Math.round(item.getBoundingClientRect().width) : 0, shown, cut: shown && title.scrollWidth > title.clientWidth + 1, text: shown ? title.clientWidth : 0 };
    });
    return { icons: !!r?.icons, cls: host.classList.contains("icons"), overflow: r?.overflow ?? 0, room: r ? r.right - r.left : 0, total: Math.round(p.total), pill: p.pill, tabs };
  };
  const brief = (s) => ({ icons: s.icons, overflow: s.overflow, room: s.room, total: s.total, pill: s.pill, widths: s.tabs.map((t) => t.w), cut: s.tabs.filter((t) => t.cut).length });

  await spike.resize(1280, 800);
  await M.activate();
  await M.load(M.page("article.html"));
  away();
  const names = ["Tideline", "Refract", "Issues · vitre-shell", "Long Exposure Club", "Night Shift", "Field Notes on Float Glass", "Molten Tin", "A very long page title about annealing lehrs", "Cutting Table", "Pilkington"];
  const opened = [];
  /** Close the newest tabs this run opened until `n` are left. */
  const closeTo = async (n) => {
    while (b.tabs.length > n && opened.length) b.closeTab(opened.pop(), { animate: false });
    await waitFor(() => b.tabs.length === n, { timeout: 8000, what: n + " tabs left" }).catch(() => {});
    await settle();
  };

  // 1. Tabs one by one at 1280 px: titles stay while they can be COMPACT_MIN wide, shrinking together.
  const steps = [];
  let firstIcons = -1;
  let shrunkSeen = -1;
  for (let i = 0; i < names.length; i++) {
    opened.push(b.newTab(titled(names[i]), { background: true }));
    await waitFor(() => b.tabs.length === i + 2 && b.tabs.every((t) => !t.loading), { what: "tab " + (i + 2) });
    await settle();
    const s = row();
    steps.push(s);
    log((i + 2) + " tabs: " + JSON.stringify(brief(s)));
    if (s.icons && firstIcons < 0) firstIcons = i + 2;
    if (!s.icons && s.tabs.some((t) => t.cut && t.w < COMPACT_MAX - 1)) shrunkSeen = shrunkSeen < 0 ? i + 2 : shrunkSeen;
    if (i + 2 === 6) {
      check("6 tabs at 1280 px (the owner's screenshot: every title folded with 13 px missing): every background tab keeps its title", !s.icons && s.tabs.every((t) => t.shown), brief(s));
      await capture("row-titles-1-six-tabs");
    }
    if (!s.icons) {
      check((i + 2) + " tabs, titles shown: nothing overflows and the row fits its room", s.overflow === 0 && s.total <= s.room + 1, brief(s));
      check((i + 2) + " tabs, titles shown: every background tab is at least " + COMPACT_MIN + " px or as wide as its whole title", s.tabs.every((t) => t.w >= COMPACT_MIN - 1 || !t.cut), s.tabs);
      const longest = Math.max(...s.tabs.map((t) => t.w));
      check((i + 2) + " tabs: a short title keeps its width; the cut ones share one width", s.tabs.filter((t) => t.cut && t.w < COMPACT_MAX - 1).every((t) => Math.abs(t.w - longest) <= 1), s.tabs);
    }
  }
  check("the titles shrank before any folded (a step with cut titles and no favicons-only row)", shrunkSeen > 0 && (firstIcons < 0 || shrunkSeen < firstIcons), { shrunkSeen, firstIcons });
  // Each tab already there keeps its width or gets narrower when one more opens.
  const widened = [];
  for (let k = 1; k < steps.length; k++) {
    for (const t of steps[k].tabs) {
      const before = steps[k - 1].tabs.find((p) => p.title === t.title);
      if (before && t.w > before.w + 1) widened.push({ tabs: k + 2, title: t.title, before: before.w, now: t.w });
    }
  }
  check("opening a tab never widens the ones already there", widened.length === 0, widened);
  if (firstIcons > 0) {
    const before = steps[firstIcons - 3];
    const at = steps[firstIcons - 2];
    const share = (at.room - at.pill - 44 - at.tabs.length * 8) / at.tabs.length;
    check("titles fold only when they would be under " + COMPACT_MIN + " px (" + firstIcons + " tabs: " + Math.floor(share) + " px each)", share < COMPACT_MIN + 2, { share, at: brief(at) });
    check("the row before it still had titles, the cut ones at " + COMPACT_MIN + " px or more", !before.icons && before.tabs.every((t) => t.shown && (t.w >= COMPACT_MIN - 1 || !t.cut)), brief(before));
    check("favicons only: the active capsule keeps its width while it can", at.pill === 400 || at.overflow === 0, brief(at));
  }
  // Favicons only: a hovered favicon grows only when the row can hold its x beside the favicon and
  // some title; otherwise it stays a favicon (no x on the favicon).
  if (row().icons) {
    const t = b.tabs.find((x) => x.id !== b.active().id);
    const item = b.bar.item(t.id);
    const r = item.getBoundingClientRect();
    M.mouse(r.left + r.width / 2, r.top + r.height / 2, { type: "mousemove" });
    await sleep(450);
    await settle();
    const ir = item.getBoundingClientRect();
    const fav = item.querySelector(".circle-face > .fav").getBoundingClientRect();
    const x = item.querySelector(".close-badge");
    const xr = x.getBoundingClientRect();
    const xShown = getComputedStyle(x).display !== "none" && xr.width > 0;
    const look = { w: Math.round(ir.width), xShown, x: [Math.round(xr.left), Math.round(xr.width)], fav: [Math.round(fav.left), Math.round(fav.right)], overflow: row().overflow };
    log("favicons only, hover: " + JSON.stringify(look));
    check("favicons only, hover: the capsule stays 36 px or grows to hold its x beside the favicon (the x never on the favicon)", look.w <= 37 || (look.w >= 100 && (!xShown || xr.left >= fav.right - 0.5)), look);
    away();
    await settle();
  }
  // The most tabs that still show titles.
  const lastTitled = firstIcons > 0 ? firstIcons - 1 : names.length + 1;
  await closeTo(lastTitled);
  const most = row();
  log("back to " + b.tabs.length + " tabs: " + JSON.stringify(brief(most)));
  check("closing tabs again: the titles come back, shrunk to fit (" + b.tabs.length + " tabs)", !most.icons && most.overflow === 0 && most.tabs.every((t) => t.shown), brief(most));
  await capture("row-titles-2-shrunk");

  // 2. Hover on a shrunk tab: after 300 ms it shows its whole title and the close x, taking the room
  // from the other titles, which give down to 72 px (favicon and a few letters) and never fold; the
  // strip never overflows. A short title that was whole stays whole. Leaving puts the row back as it was.
  const restWidths = most.tabs.map((t) => t.w);
  // The pointer onto a tab until the bar holds its hover (300 ms) and the row has settled. A real
  // pointer over the window (a capture brings it to the front) can take the hover away: try again.
  const hoverOn = async (tab) => {
    const item = b.bar.item(tab.id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = item.getBoundingClientRect();
      // A move to the same point is not a move (bar.ts ignores it), so each try lands a little further.
      M.mouse(r.left + Math.min(22, r.width / 2) + attempt * 3, r.top + r.height / 2, { type: "mousemove" });
      // The 300 ms hover timer runs late in a window that is covered (timers are throttled there).
      const held = await waitFor(() => b.bar.hoverId === tab.id && item.classList.contains("hovered"), { timeout: 4000 }).then(() => true, () => false);
      await settle();
      if (held && b.bar.hoverId === tab.id && item.matches(":hover")) return item;
      log("WARN the hover on " + tab.title + " did not hold (a real pointer over the window?): again");
    }
    return item;
  };
  const hoverLook = (item) => {
    const x = item.querySelector(".close-badge");
    const xr = x.getBoundingClientRect();
    const ir = item.getBoundingClientRect();
    const title = item.querySelector(".circle-face > .title");
    const tr = title.getBoundingClientRect();
    return { w: Math.round(ir.width), xShown: getComputedStyle(x).display !== "none" && xr.width > 0, xInside: xr.left >= ir.left - 0.5 && xr.right <= ir.right + 0.5, xAfterTitle: xr.left >= tr.right - 1, titleWhole: title.scrollWidth <= title.clientWidth + 1, title: [title.clientWidth, title.scrollWidth] };
  };
  const bgTabs = () => b.tabs.filter((t) => t.id !== b.active().id);
  const cutTab = bgTabs().find((t) => {
    const title = b.bar.item(t.id)?.querySelector(".circle-face > .title");
    return title && title.scrollWidth > title.clientWidth + 1;
  });
  if (cutTab) {
    const item = await hoverOn(cutTab);
    const h = hoverLook(item);
    const s = row();
    const others = s.tabs.filter((t) => t.title !== cutTab.title);
    log("hover on a shrunk tab: " + JSON.stringify({ h, row: brief(s) }));
    check("hover on a shrunk tab: its whole title shows (or the 280 px hover limit), the close x after it, inside the capsule", (h.titleWhole || h.w >= 279) && h.xShown && h.xInside && h.xAfterTitle, h);
    check("hover on a shrunk tab: the other titles give it room down to 72 px, and none folds", !s.icons && others.every((t) => t.shown && (t.w >= 71 || !t.cut)), brief(s));
    check("hover on a shrunk tab: the strip does not overflow", s.overflow === 0 && s.total <= s.room + 1, brief(s));
    away();
    await settle();
    await sleep(300);
    const back = row().tabs.map((t) => t.w);
    check("the pointer leaves: the row is as it was", back.every((w, k) => Math.abs(w - restWidths[k]) <= 1), { before: restWidths, after: back });
  } else check("a shrunk tab to hover", false, brief(row()));
  const shortTab = bgTabs().find((t) => {
    const title = b.bar.item(t.id)?.querySelector(".circle-face > .title");
    return title && title.scrollWidth <= title.clientWidth + 1;
  });
  if (shortTab) {
    const h = hoverLook(await hoverOn(shortTab));
    const s = row();
    check("hover on a short whole title in a full row: it stays whole beside the close x", h.titleWhole && h.xShown && h.xInside && h.xAfterTitle && s.overflow === 0, { h, row: brief(s) });
    away();
    await settle();
  }

  // 2b. The close x always shown (Settings): a shrunk tab keeps COMPACT_MIN of room beside it, or the
  // titles fold.
  const store = b.sys("VitreSettings");
  store.set({ closeButton: "always" });
  await settle();
  const always = row();
  log("close x always: " + JSON.stringify(brief(always)));
  check("close x always shown: no shrunk tab under " + (COMPACT_MIN + 20) + " px (else favicons only)", always.icons || always.tabs.every((t) => !t.cut || t.w >= COMPACT_MIN + 19), brief(always));
  check("close x always shown: nothing overflows", always.overflow === 0, brief(always));
  store.reset("closeButton");
  await settle();

  // 3. The address being edited: the titles shrink first, then fold.
  b.editAddress("deer");
  await settle();
  const typing = row();
  log("editing: " + JSON.stringify(brief(typing)));
  check("editing the address: the field grows (as far as the row allows) and nothing overflows", typing.pill > 400 && typing.overflow === 0, brief(typing));
  check("editing the address: titles shrink or fold, never overlap", typing.icons || typing.tabs.every((t) => t.w >= COMPACT_MIN - 1 || !t.cut), brief(typing));
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  await settle();

  // 4. A window being narrowed with three background tabs: the titles shrink step by step, fold once.
  await closeTo(4);
  await settle();
  const series = [];
  for (let w = 1280; w >= 700; w -= 60) {
    await spike.resize(w, 800);
    await settle();
    const s = row();
    series.push({ w, icons: s.icons, widest: Math.max(...s.tabs.map((t) => t.w)), overflow: s.overflow, cut: s.tabs.filter((t) => t.cut).length });
  }
  log("narrowing: " + JSON.stringify(series));
  const flips = series.filter((s, k) => k > 0 && s.icons !== series[k - 1].icons).length;
  check("narrowing the window: the titles fold at most once (no flicker between titles and favicons)", flips <= 1, series);
  check("narrowing the window: the titles get shorter step by step before they fold", series.some((s) => !s.icons && s.cut > 0), series);
  check("narrowing the window: never an overflowing row while titles show", series.every((s) => s.icons || s.overflow === 0), series);
  let mono = true;
  for (let k = 1; k < series.length; k++) if (!series[k].icons && !series[k - 1].icons && series[k].widest > series[k - 1].widest + 1) mono = false;
  check("narrowing the window: no tab gets wider", mono, series);

  // 5. A narrow window with two background tabs: their titles show (it was favicons-only under 900 px).
  await closeTo(3);
  await spike.resize(860, 700);
  await settle();
  const narrow = row();
  log("860 px, " + b.tabs.length + " tabs: " + JSON.stringify(brief(narrow)));
  // Titles when each can have COMPACT_MIN (a private window's Private capsule leaves too little at
  // 860 px: favicons there are right).
  const n = narrow.tabs.length;
  const roomy = narrow.room - narrow.pill - 44 - n * 8 >= n * COMPACT_MIN;
  check("an 860 px window with two background tabs: their titles show when each has " + COMPACT_MIN + " px (" + (roomy ? "it has" : "it has not") + ")", narrow.overflow === 0 && (roomy ? !narrow.icons && narrow.tabs.every((t) => t.shown) : narrow.icons), brief(narrow));
  await capture("row-titles-3-narrow");
  await spike.resize(1280, 800);
  await settle();
});
