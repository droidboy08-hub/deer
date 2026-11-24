// macOS bug hunt for the One row now that the gray band is gone (the owner, 2026-11-15: "remove the
// gray bar like windows", and the row's text colour follows the page). The row floats over the page in
// a normal window as the Windows bar does: no gray band, the traffic lights in their own glass
// capsule over the page, every capsule in Deer's CSS glass and in the PAGE's colours (dark ink over a
// light page, light ink over a dark one, whatever the system's appearance; in split view a capsule
// over the other page takes that page's), the address suggestions and the Downloads quick view in the
// colours of the capsule they hang from, compact titles whole while the row has room, web content
// starting below the row through the 64 px top strip and scrolling under the capsules, headers pinned
// to the top and window-modal dialogs sitting below the row, nothing of Windows in the words (every
// Settings page, the + and page menus). No band lies across the row: the window's drag region is the
// 18 px strip at the top (#vitre-drag, as on Windows). Split view: the Downloads and Extensions
// capsules over the other side's page take its theme (over-dark / over-light), and so do the extension
// icons (brighttext), the buttons' hover, the ring's track and dot and the Downloads quick view; a
// private window stays dark.
//   python3 tools/run.py --test tests/menus/mac-hunt-look.js --name mac-hunt-dark --url about:blank --timeout 420 --pref ui.systemUsesDarkTheme=1
//   python3 tools/run.py --test tests/menus/mac-hunt-look.js --name mac-hunt-light --url about:blank --timeout 420 --pref ui.systemUsesDarkTheme=0
//   python3 tools/run.py --test tests/menus/mac-hunt-look.js --name mac-hunt-priv --url about:blank --timeout 420 --arg=-private-window
// Needs the screen unlocked for the captures (--no-capture runs the checks alone).
// macOS only (passes at once elsewhere). Every capture name ends in the system appearance the run
// forced (-dark / -light, from ui.systemUsesDarkTheme; -sys when not forced) and, when the first
// window is private (--arg=-private-window), -private, so the runs do not overwrite each other:
//   hunt-01-light          a light article page, five tabs
//   hunt-02-hover          the pointer on a background tab (it grows to its title and a close x)
//   hunt-03-scrolled       the light page scrolled: its text under the capsules, blurred
//   hunt-04-sticky         a page with a sticky header, scrolled: the header sticks below the row
//   hunt-04b-fixed         a page with a fixed header: it sits below the row
//   hunt-05-dark           a dark page: light ink on dark glass
//   hunt-05b-dark-scrolled the dark page scrolled under the row
//   hunt-06-typing         the address field with suggestions, over the light page
//   hunt-06b-typing-dark   the same over the dark page
//   hunt-07-plus-menu      the + capsule's menu (a popup window: spike.captureScreen)
//   hunt-08-page-menu      the page's right-click menu (spike.captureScreen)
//   hunt-09-home           Home (the wallpaper) in a new tab
//   hunt-10-settings       Settings open over the light page
//   hunt-11-quickview      the Downloads quick view under its capsule
//   hunt-11b-downloads     the Downloads panel
//   hunt-12-find           Find in page with matches on the light page
//   hunt-12b-find-dark     Find in page on the dark page
//   hunt-13-split          split view of the light page and the dark page
//   hunt-14-peek           a Peek sheet over the light page
//   hunt-16-dialog         a window-modal prompt (what ⌘Q's quit prompt is): below the row
//   hunt-15-private        a private window over a light page (opened by this run; not in a private run)
// Each capture comes with checks of what it shows (the row's theme class and ink, where the page's
// content and headers are, the drag strip, the traffic lights), so a failing look is also a failing line.
/* global spike, M, Services, Ci, ChromeUtils, gBrowser, InspectorUtils, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, log, waitFor } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  // The person's real pointer over the window would replace the synthesized hover (tests/split/slib.js).
  window.windowUtils.disableNonTestMouseEvents(true);
  const forced = Services.prefs.getIntPref("ui.systemUsesDarkTheme", -1);
  const priv = b.isPrivate === true;
  const suffix = (forced === 1 ? "-dark" : forced === 0 ? "-light" : "-sys") + (priv ? "-private" : "");
  const shots = [];
  // Each capture brings the window to the front: a key the person types meanwhile reaches Deer (a ⌘Q
  // opens Firefox's quit prompt over the window and every later step goes wrong). Say so and cancel it.
  const strayDialog = (where) => {
    const box = window.gDialogBox;
    if (!box?.isOpen) return;
    log("WARN a window-modal dialog is open before " + where + " (a real key from the desktop?): closing it");
    try {
      box._dialog?.close();
    } catch (e) {
      log("WARN could not close it: " + e);
    }
  };
  const capture = async (name) => {
    strayDialog(name);
    shots.push(name + suffix);
    await spike.capture(name + suffix);
  };
  const captureScreen = async (name) => {
    strayDialog(name);
    shots.push(name + suffix);
    await spike.captureScreen(name + suffix);
  };
  const vr = b.root;
  log("system appearance: " + (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") + " (ui.systemUsesDarkTheme " + forced + "), private window: " + priv);

  await spike.resize(1280, 800);
  await M.activate();

  // ---- helpers ----
  const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = (c) => {
    if (!c) return NaN;
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const theme = () => ["light", "dark", "clear"].find((t) => vr.classList.contains("theme-" + t)) || "none";
  const color = (el) => (el ? getComputedStyle(el).color : null);
  /** The row's ink: the active capsule's host, a background tab's title, the +, Downloads, Extensions. */
  const inks = () => {
    const item = b.bar.item(b.active().id);
    const host = item?.querySelector(".address .host") || item?.querySelector(".address");
    const compact = document.querySelector("#vitre-bar .item.tab:not(.active) .circle-face");
    const plus = document.querySelector("#vitre-bar .item.plus .face");
    const ring = document.querySelector("#vitre-row-end > .vd-ring");
    const ext = document.querySelector("#vitre-row-end > .vx-rowcap");
    const extBtn = ext?.querySelector("svg") ? ext.querySelector("svg").closest("button, div") : ext;
    return {
      theme: theme(),
      active: color(host),
      compact: color(compact),
      plus: color(plus),
      downloads: color(ring),
      extensions: color(extBtn),
      fill: item ? getComputedStyle(item.querySelector(":scope > .tint")).backgroundColor : null,
    };
  };
  /** Dark ink (light page) or light ink (dark page / private) on every capsule. */
  const inkFollows = (tag, want) => {
    const i = inks();
    const vals = [i.active, i.compact, i.plus, i.downloads, i.extensions].filter(Boolean).map(luminance);
    const ok = want === "dark" ? vals.every((v) => v < 0.2) : vals.every((v) => v > 0.6);
    check(tag + ": the row's ink is " + want + " on every capsule", vals.length >= 3 && ok, i);
    return i;
  };
  const strip = document.getElementById("vitre-drag");
  const lights = document.getElementById("vitre-win-lights");
  // -moz-window-dragging is chrome-only, so getComputedStyle() reports "" for it: the winning
  // declaration of the matching rules instead (tests/menus/mac-onerow-behaviour.js dragging()).
  const dragging = (el) => {
    const find = InspectorUtils.getMatchingCSSRules || InspectorUtils.getCSSStyleRules;
    let value = "";
    for (const rule of find.call(InspectorUtils, el) || []) {
      const m = /(?:^|;)\s*-moz-window-dragging\s*:\s*([\w-]+)/.exec(rule.style?.cssText || "");
      if (m) value = m[1];
    }
    return value;
  };
  /** A private window's Private capsule is a capsule like the others: no-drag, and it takes the pointer (its glass is never the page's). */
  const privateSolid = (tag, w) => {
    const cap = w.document.getElementById("vitre-private");
    const r = cap?.getBoundingClientRect();
    const hit = r ? w.document.elementFromPoint(r.left + r.width / 2, r.top + r.height - 6) : null;
    const look = { drag: cap && dragging(cap), pointerEvents: cap && w.getComputedStyle(cap).pointerEvents, rect: r && [r.left, r.top, r.width, r.height], hit: hit && (hit.id || hit.localName) };
    check(tag + ": the Private capsule is no-drag and takes the pointer (a press on its glass is not the page's)", !!cap && look.drag === "no-drag" && look.pointerEvents === "auto" && !!hit && cap.contains(hit), look);
  };
  /** Words of Windows that a Mac must not see (Settings, menus). */
  const WIN_WORDS = /Windows|\bCtrl\b|\bAlt\b|Explorer|Program Files|\.exe\b|this PC/;
  /** The structural look of a normal window: page at 0, no band, a transparent drag strip, lights clear of the capsules. */
  const rowLooks = (tag) => {
    const br = gBrowser.selectedBrowser.getBoundingClientRect();
    const bs = getComputedStyle(strip);
    const lr = lights.getBoundingClientRect();
    const firstItem = [...document.querySelectorAll("#vitre-bar .item")].filter((e) => e.getBoundingClientRect().width > 0).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left)[0];
    const fr = firstItem?.getBoundingClientRect();
    const winBtns = [...document.querySelectorAll("#vitre-winctl button, #vitre-win-min, #vitre-win-max, #vitre-win-close")].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden");
    const cap = document.getElementById("vitre-winctl");
    const cr = cap.getBoundingClientRect();
    const capLens = cap.querySelector(":scope > .lens");
    check(tag + ": no gray band (the page at y 0, no band across the row, the 18 px drag strip paints nothing)", Math.round(br.top) === 0 && !document.getElementById("vitre-row-band") && Math.round(strip.getBoundingClientRect().height) === 18 && bs.appearance === "none" && bs.backgroundColor === "rgba(0, 0, 0, 0)" && bs.backgroundImage === "none", { pageTop: br.top, strip: strip.getBoundingClientRect().height, appearance: bs.appearance, bg: bs.backgroundColor, img: bs.backgroundImage });
    check(tag + ": the traffic lights are painted at x 20 and no capsule overlaps them", lr.width > 0 && Math.round(lr.left) === 20 && (!fr || fr.left >= lr.right + 8), { lights: [lr.left, lr.top, lr.width, lr.height], first: fr && [fr.left, fr.top, fr.width] });
    check(tag + ": no Windows window buttons in the row", winBtns.length === 0, winBtns.map((e) => e.className || e.id));
    check(tag + ": the lights sit in a 76 x 36 glass capsule at (12, 8), clear of the first tab", Math.round(cr.left) === 12 && Math.round(cr.top) === 8 && Math.round(cr.width) === 76 && Math.round(cr.height) === 36 && !!capLens && getComputedStyle(capLens).backdropFilter.includes("blur") && (!fr || fr.left >= cr.right + 7), { cap: [cr.left, cr.top, cr.width, cr.height], filter: capLens && getComputedStyle(capLens).backdropFilter });
    // Compact titles: no title cut short while the row has room to spare. A crowded row shrinks its
    // titles until the row is full (mac-row-titles.js), so a cut title is right when nothing is spare.
    // The strip ends where the bar says (a private window's Private capsule is past it).
    const laid = b.bar.place.row;
    const plusR = document.querySelector("#vitre-bar .item.plus")?.getBoundingClientRect();
    const spare = plusR && laid ? laid.right - plusR.right : 0;
    // (A title longer than a COMPACT_MAX capsule, 160, is cut by design.)
    const cut = [...document.querySelectorAll("#vitre-bar:not(.icons) .item.tab:not(.active) .circle-face > .title")].filter((t) => t.scrollWidth > t.clientWidth + 1 && t.closest(".item").getBoundingClientRect().width < 159).map((t) => [t.textContent, t.clientWidth, t.scrollWidth]);
    check(tag + ": no compact title is cut short while the row has room (" + Math.round(spare) + " px spare)", cut.length === 0 || spare < 8, cut);
  };
  /** Where the page's content starts (window px). */
  const topOf = async (sel) => {
    const r = await M.rectOf(sel, { scroll: false });
    return r ? Math.round(r.y * 10) / 10 : null;
  };
  const text = (n) => "<p style='margin:0 40px 14px;max-width:700px'>A ribbon of glass floats on molten tin until it is flat on both faces, then cools as it moves down the line and is cut into sheets.</p>".repeat(n);
  const doc = (title, bg, fg, body) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style="margin:0;background:${bg};color:${fg};font:17px/1.5 Georgia">${body}`);
  const light = doc("Field Notes", "#f6f4ee", "#1d1d1f", "<h1 id=h style='margin:0 40px 12px;padding-top:4px'>Float glass</h1>" + text(40));
  const dark = doc("Night Shift", "#15161a", "#e8e8ea", "<h1 id=h style='margin:0 40px 12px;padding-top:4px'>Night Shift</h1>" + text(40));
  const sticky = doc("Sticky header", "#ffffff", "#1d1d1f", "<header id=hd style='position:sticky;top:0;height:56px;background:#2b5f9e;color:#fff;font:600 18px system-ui;display:flex;align-items:center;padding:0 40px'>Sticky site header</header><h1 id=h style='margin:16px 40px'>Sticky</h1>" + text(60));
  const fixed = doc("Fixed header", "#fbfbfd", "#1d1d1f", "<header id=hd style='position:fixed;top:0;left:0;right:0;height:56px;background:#1e7f5c;color:#fff;font:600 18px system-ui;display:flex;align-items:center;padding:0 40px;z-index:5'>Fixed site header</header><div style='height:56px'></div><h1 id=h style='margin:16px 40px'>Fixed</h1>" + text(60));
  const waitTheme = (t, what) => waitFor(() => vr.classList.contains("theme-" + t), { timeout: 6000, what }).catch(() => {});
  const want = (pageTheme) => (priv ? "light" : pageTheme === "light" ? "dark" : "light");

  // ---- 1. a light page, five tabs ----
  await M.load(light, 600);
  for (const [t, bg] of [["Tideline", "#e9f4f3"], ["Refract", "#f4f2ec"], ["Issues · vitre-shell", "#f6f6f6"], ["Long Exposure Club", "#efeff2"]]) b.newTab(doc(t, bg, "#1d1d1f", `<h1 style='margin:0 40px'>${t}</h1>` + text(30)), { background: true });
  await waitFor(() => b.tabs.length === 5 && b.tabs.every((t) => !t.loading), { what: "five tabs loaded" });
  if (!priv) await waitTheme("light", "light theme");
  await sleep(900);
  rowLooks("light page");
  if (!priv) check("light page: the row takes the light theme", theme() === "light", vr.className);
  else {
    check("private window: dark glass over a light page", vr.classList.contains("private") && luminance(inks().active) > 0.6, inks());
    privateSolid("private window", window);
  }
  inkFollows("light page", want("light"));
  const h1 = await topOf("#h");
  check("light page at scroll top: its content starts below the row (y >= 64)", h1 !== null && h1 >= 64, h1);
  await capture("hunt-01-light");

  // ---- 2. the pointer on a background tab ----
  const bg2 = [...document.querySelectorAll("#vitre-bar .item.tab:not(.active)")][1];
  if (bg2) {
    const r = bg2.getBoundingClientRect();
    M.mouse(r.left + 20, r.top + r.height / 2, { type: "mousemove" });
    await sleep(700);
    check("hovered background tab: it shows its title and close x (class hovered)", bg2.classList.contains("hovered"), bg2.className);
    const face = bg2.querySelector(".circle-face");
    check("hovered background tab: its title is readable (" + want("light") + " ink)", want("light") === "dark" ? luminance(color(face)) < 0.2 : luminance(color(face)) > 0.6, color(face));
    await capture("hunt-02-hover");
    M.mouse(640, 500, { type: "mousemove" });
    await sleep(500);
  }

  // ---- 3. the light page scrolled ----
  await M.inContent(b.active().browser, (content) => content.scrollTo(0, 260));
  await sleep(800);
  if (!priv) check("light page scrolled: the row stays light", theme() === "light", vr.className);
  inkFollows("light page scrolled", want("light"));
  await capture("hunt-03-scrolled");
  await M.inContent(b.active().browser, (content) => content.scrollTo(0, 0));
  await sleep(300);

  // ---- 4. headers pinned to the top ----
  const lightTab = b.active();
  const hdrTab = b.newTab(sticky);
  await waitFor(() => !hdrTab.loading && hdrTab.url === sticky, { timeout: 15000, what: "sticky page" });
  await sleep(900);
  const hd0 = await topOf("#hd");
  check("sticky header at scroll top: below the row (y >= 64)", hd0 !== null && hd0 >= 63, hd0);
  await M.inContent(hdrTab.browser, (content) => content.scrollTo(0, 900));
  await sleep(1000);
  const hd1 = await topOf("#hd");
  check("sticky header scrolled: it sticks below the row (y ~64)", hd1 !== null && hd1 >= 63 && hd1 <= 66, hd1);
  await capture("hunt-04-sticky");
  b.navigate(hdrTab, fixed);
  await waitFor(() => !hdrTab.loading && hdrTab.url === fixed, { timeout: 15000, what: "fixed page" });
  await sleep(1200);
  const hd2 = await topOf("#hd");
  check("fixed header: it sits below the row (y ~64)", hd2 !== null && hd2 >= 63 && hd2 <= 66, hd2);
  const h1f = await topOf("#h");
  check("fixed header page: the heading is below the header", h1f !== null && h1f >= 64 + 56, h1f);
  await capture("hunt-04b-fixed");

  // ---- 5. a dark page ----
  b.navigate(hdrTab, dark);
  await waitFor(() => !hdrTab.loading && hdrTab.url === dark, { timeout: 15000, what: "dark page" });
  if (!priv) await waitTheme("dark", "dark theme");
  await sleep(900);
  rowLooks("dark page");
  if (!priv) check("dark page: the row takes the dark theme", theme() === "dark", vr.className);
  inkFollows("dark page", "light");
  const h1d = await topOf("#h");
  check("dark page at scroll top: its content starts below the row (y >= 64)", h1d !== null && h1d >= 64, h1d);
  await capture("hunt-05-dark");
  await M.inContent(hdrTab.browser, (content) => content.scrollTo(0, 260));
  await sleep(800);
  inkFollows("dark page scrolled", "light");
  await capture("hunt-05b-dark-scrolled");
  await M.inContent(hdrTab.browser, (content) => content.scrollTo(0, 0));
  await sleep(300);
  const darkTab = hdrTab;

  // ---- 6. the address field with suggestions ----
  b.activate(lightTab);
  if (!priv) await waitTheme("light", "light theme again");
  await sleep(600);
  b.editAddress("deer browser");
  await sleep(1000);
  const field = document.getElementById("vitre-omni-field");
  const input = field?.querySelector("input");
  check("typing on a light page: the field's text is " + want("light"), !!input && (want("light") === "dark" ? luminance(color(input)) < 0.2 : luminance(color(input)) > 0.6), { color: color(input), theme: theme() });
  log("suggestions:", JSON.stringify([...document.querySelectorAll("#layer-omnibox *")].filter((e) => /sugg|row|list/.test(e.className?.baseVal ?? e.className ?? "")).slice(0, 3).map((e) => [e.className, getComputedStyle(e).backgroundColor, getComputedStyle(e).color])));
  await capture("hunt-06-typing");
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  await sleep(500);
  b.activate(darkTab);
  if (!priv) await waitTheme("dark", "dark theme again");
  await sleep(600);
  b.editAddress("deer browser");
  await sleep(1000);
  check("typing on a dark page: the field's text is light", luminance(color(document.querySelector("#vitre-omni-field input"))) > 0.6, { color: color(document.querySelector("#vitre-omni-field input")), theme: theme() });
  await capture("hunt-06b-typing-dark");
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  await sleep(500);
  b.activate(lightTab);
  if (!priv) await waitTheme("light", "light theme again");
  await sleep(600);

  // ---- 7, 8. the + menu and the page menu (popup windows) ----
  const plus = document.querySelector("#vitre-bar .item.plus");
  if (plus) {
    const r = plus.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    const open = await M.waitOpen();
    check("+ menu opens", open);
    if (open) {
      const st = M.state();
      log("+ menu rows", JSON.stringify(st.rows.map((x) => x.label + (x.key ? " [" + x.key + "]" : ""))));
      check("+ menu: no Ctrl key labels", st.rows.every((x) => !/Ctrl|Alt\+/.test(x.key || "")), st.rows.map((x) => x.key));
      check("+ menu: no Windows words in its rows", st.rows.every((x) => !WIN_WORDS.test(x.label || "")), st.rows.map((x) => x.label));
      check("+ menu: it hangs below the row (y >= 52)", st.rect && st.rect.top >= 52, st.rect);
      await sleep(400);
      await captureScreen("hunt-07-plus-menu");
      M.key("KEY_Escape");
      await M.waitClosed();
    }
  }
  await sleep(500);
  strayDialog("the page menu");
  M.rightClick(520, 420);
  let pmOpen = await M.waitOpen();
  if (!pmOpen) {
    log("page menu: not open after one right-click, trying once more");
    await sleep(600);
    M.rightClick(520, 420);
    pmOpen = await M.waitOpen();
  }
  check("page menu opens", pmOpen);
  if (pmOpen) {
    const st = M.state();
    log("page menu rows", JSON.stringify(st.rows.map((x) => x.label + (x.key ? " [" + x.key + "]" : ""))));
    check("page menu: no Ctrl key labels", st.rows.every((x) => !/Ctrl|Alt\+/.test(x.key || "")), st.rows.map((x) => x.key));
    check("page menu: no Windows words in its rows", st.rows.every((x) => !WIN_WORDS.test(x.label || "")), st.rows.map((x) => x.label));
    await sleep(400);
    await captureScreen("hunt-08-page-menu");
    M.key("KEY_Escape");
    await M.waitClosed();
  }

  // ---- 9. Home in a new tab ----
  const home = b.newTab();
  await sleep(1800);
  rowLooks("Home");
  log("Home theme", theme(), JSON.stringify(inks()));
  const homeBox = home?.browser?.getBoundingClientRect();
  check("Home: its page fills the window from y 0 (the wallpaper behind the row)", !!homeBox && Math.round(homeBox.top) === 0 && Math.round(homeBox.height) >= window.innerHeight - 1, homeBox && homeBox.toJSON());
  await capture("hunt-09-home");

  // ---- 10. Settings over the light page ----
  b.activate(lightTab);
  await sleep(600);
  b.run("settings");
  await sleep(1300);
  const sheetText = document.querySelector("#vitre-settings .vs-sheet")?.textContent ?? "";
  check("Settings (General): nothing says Windows on a Mac", sheetText.length > 0 && !/Windows/.test(sheetText), (sheetText.match(/[^.]{0,40}Windows[^.]{0,20}/) || [sheetText.slice(0, 60)])[0]);
  await capture("hunt-10-settings");
  // Every page of Settings (the modules' pages too): nothing names Windows, Ctrl, Alt, Explorer,
  // Program Files, .exe or "this PC" on a Mac, in the text (hidden lines included) or in the labels.
  const pageIds = [...document.querySelectorAll("#vitre-settings .vs-navitem")].map((n) => n.dataset.id);
  const said = [];
  let video = null;
  for (const id of pageIds) {
    b.service("settings").open(id);
    await waitFor(() => document.querySelector("#vitre-settings .vs-content")?.dataset.page === id, { timeout: 3000, what: "Settings page " + id }).catch(() => {});
    await sleep(500);
    const main = document.querySelector("#vitre-settings .vs-main");
    const words = [main?.textContent ?? "", ...[...(main?.querySelectorAll("[aria-label], [title], [placeholder]") ?? [])].map((e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("placeholder")].join(" "))].join(" | ");
    const m = words.match(new RegExp("[^.|]{0,50}(?:" + WIN_WORDS.source + ")[^.|]{0,30}"));
    if (m) said.push(id + ": " + m[0]);
    if (id === "video-downloads") {
      // Let the ffmpeg lookup answer (paint() is async).
      await waitFor(() => !!main?.querySelector(".vs-path")?.textContent, { timeout: 3000, what: "the ffmpeg status" }).catch(() => {});
      video = {
        downloadRows: [...(main?.querySelectorAll("#vd-ff-get-row, #vd-ff-get, #vd-yt-row, #vd-yt-get") ?? [])].map((e) => e.id),
        notYet: (main?.textContent.match(/(?:on a Mac|on macOS) yet|not available on (?:a Mac|macOS)/gi) || []).length,
        status: main?.querySelector(".vs-path")?.textContent ?? null,
      };
    }
  }
  log("Settings pages walked: " + pageIds.join(", "));
  check("Settings, every page (" + pageIds.length + "): nothing names Windows, Ctrl, Alt, Explorer, Program Files, .exe or this PC on a Mac", pageIds.length >= 9 && said.length === 0, said);
  M.key("KEY_Escape");
  await sleep(700);
  // Settings › Video downloads: Deer gets the video tools on a Mac as on Windows (their macOS builds,
  // downloads/mac-tools.ts), so the Download ffmpeg and yt-dlp rows are there, no "not on a Mac yet",
  // and the ffmpeg status answers. (tests/downloads/mac-tools.py installs them from stand-ins.)
  check("Settings › Video downloads on a Mac: the Download ffmpeg and yt-dlp rows, nothing says they are not there yet, and the ffmpeg status answers", !!video && video.downloadRows.length === 4 && video.notYet === 0 && !!video.status, video);
  // And the engine tries to install them there: with the sources pointing nowhere each install fails on the
  // network ("the release could not be reached", what a Mac install says when its source cannot be reached;
  // nothing naming a Mac), receives nothing and installs or leaves nothing (no temporary file, no lock).
  const engine = b.sys("VitreDownloads");
  const folders = engine.toolFolders();
  const hadYtdlp = engine.hasYtdlp();
  const dead = "http://127.0.0.1:9/";
  const srcPrefs = ["vitre.ffmpeg.source", "vitre.tools.source.ytdlp", "vitre.tools.source.deno"];
  for (const p of srcPrefs) Services.prefs.setStringPref(p, dead);
  const refused = async (p) => {
    try {
      await p;
      return "";
    } catch (e) {
      return String(e?.message || e);
    }
  };
  try {
    const ff = await refused(engine.installFfmpeg());
    const yt = await refused(engine.installYtdlp(false));
    const st = { ff, yt, ffState: engine.ffmpegInstall(), ytState: engine.ytdlpInstall(), hasYtdlp: engine.hasYtdlp() };
    const leftovers = [];
    const installed = [PathUtils.join(folders.ffmpeg, "ffmpeg"), PathUtils.join(folders.tools, "yt-dlp"), PathUtils.join(folders.tools, "deno")];
    for (const p of installed) if (await IOUtils.exists(p)) leftovers.push(p);
    // Temporary names are each install's own (ffmpeg.new-<id>, yt-dlp-download-<id>.zip...), and the locks.
    for (const dir of [PathUtils.parent(folders.ffmpeg), folders.tools]) {
      for (const p of await IOUtils.getChildren(dir).catch(() => [])) {
        if (/^(?:ffmpeg\.new|ffmpeg-download|yt-dlp\.new|yt-dlp-download|deno-download|deno\.download)|install-lock$|^\.yt-dlp-running-/.test(PathUtils.filename(p))) leftovers.push(p);
      }
    }
    check(
      "on a Mac the engine tries to install ffmpeg and yt-dlp (no refusal for being a Mac), fails on the unreachable sources, receives and installs nothing",
      /could not be reached/.test(ff) && /could not be reached/.test(yt) && !/mac/i.test(ff + yt) && st.ffState.phase === "failed" && st.ytState.phase === "failed" && st.ffState.received === 0 && st.ytState.received === 0 && st.hasYtdlp === hadYtdlp && !hadYtdlp && leftovers.length === 0 && folders.oldFfmpeg === "" && folders.oldTools === "",
      { ...st, folders, leftovers }
    );
  } finally {
    for (const p of srcPrefs) Services.prefs.clearUserPref(p);
  }

  // ---- 11. the Downloads quick view and the Downloads panel ----
  const dl = window.vitreDownloads;
  if (dl?.ring?.pop) {
    dl.ring.pop.open(false);
    await sleep(700);
    const pop = document.querySelector(".vd-pop.under-row");
    const ring = document.querySelector("#vitre-row-end > .vd-ring");
    const pr = pop?.getBoundingClientRect();
    const rr = ring?.getBoundingClientRect();
    check("quick view: 8 px under the Downloads capsule, right edges aligned", !!pr && !!rr && Math.abs(pr.top - (rr.bottom + 8)) <= 1 && Math.abs(pr.right - rr.right) <= 1, { pop: pr && [pr.left, pr.top, pr.width, pr.height], ring: rr && [rr.left, rr.top, rr.width, rr.height] });
    await capture("hunt-11-quickview");
    dl.ring.pop.close(false);
    await sleep(400);
  }
  b.run("downloads");
  await sleep(1100);
  await capture("hunt-11b-downloads");
  b.run("downloads");
  await sleep(700);
  if (document.querySelector(".vd-panel.open, .vd-panel[open]")) M.key("KEY_Escape");

  // ---- 12. Find in page ----
  const find = b.service("find");
  find.open({ query: "glass" });
  await sleep(1400);
  const fst = window.vitreFind?.inspect(b.active().browser);
  log("find state", JSON.stringify(fst && { counter: fst.counter, total: fst.total, ord: fst.ord, query: fst.query, view: fst.view }));
  await capture("hunt-12-find");
  find.close();
  await sleep(500);
  b.activate(darkTab);
  if (!priv) await waitTheme("dark", "dark theme for find");
  await sleep(600);
  find.open({ query: "glass" });
  await sleep(1400);
  await capture("hunt-12b-find-dark");
  find.close();
  await sleep(500);

  // ---- 13. split view: the light page and the dark page ----
  b.activate(lightTab);
  await sleep(500);
  const pair = b.split(darkTab, { side: "right" });
  await sleep(1500);
  check("split view started", !!pair, b.splitView.active());
  /** The row-end capsules and what keys on their theme (over-dark / over-light from bar.ts paintRowSplit). */
  const endLook = () => {
    const ext = document.querySelector("#vitre-row-end > .vx-rowcap");
    const ring = document.querySelector("#vitre-row-end > .vd-ring");
    const extBar = document.getElementById("vitre-ext-bar");
    return {
      ext: ext ? ext.className : null,
      ring: ring ? ring.className : null,
      bright: !!extBar && extBar.hasAttribute("brighttext"),
      hover: ext ? getComputedStyle(ext).getPropertyValue("--vx-hover").replace(/\s+/g, "") : null,
      track: ring ? getComputedStyle(ring.querySelector(".track")).opacity : null,
      dot: ring ? getComputedStyle(ring.querySelector(".vd-ring-dot")).backgroundColor : null,
    };
  };
  const DARK_END = { hover: "rgba(255,255,255,0.12)", track: "0.24", dot: "rgb(76, 194, 255)" };
  const LIGHT_END = { hover: "rgba(29,29,31,0.08)", track: "0.16", dot: "rgb(0, 95, 184)" };
  /** The Downloads quick view's glass, opened under its capsule: light (row-light) or dark. */
  const quickViewLight = async () => {
    const pop = window.vitreDownloads?.ring?.pop;
    if (!pop) return null;
    pop.open(false);
    await sleep(500);
    const el = document.querySelector(".vd-pop.under-row");
    const light = el ? el.classList.contains("row-light") : null;
    const tint = el ? getComputedStyle(el.querySelector(":scope > .tint")).backgroundColor : null;
    const ink = el ? getComputedStyle(el).color : null;
    pop.close(false);
    await sleep(400);
    return { light, tint, ink };
  };
  /** Split view, the focused page on the left and the other one (of `otherTheme`) on the right, under the row's right end. */
  const endFollows = async (tag, otherTheme) => {
    const want = priv ? "dark" : otherTheme;
    const cls = "over-" + otherTheme;
    if (!priv) await waitFor(() => [...document.querySelectorAll("#vitre-row-end > *")].every((e) => e.classList.contains(cls)), { timeout: 4000, what: cls + " on the row end" }).catch(() => {});
    await sleep(300);
    const e = endLook();
    const v = want === "dark" ? DARK_END : LIGHT_END;
    check(tag + ": the Extensions and Downloads capsules over the " + otherTheme + " page " + (priv ? "stay dark glass (private)" : "carry " + cls), priv ? !/over-/.test(e.ext + e.ring) : /over-/.test(e.ext) && e.ext.includes(cls) && e.ring.includes(cls), e);
    check(tag + ": the extension icons are " + (want === "dark" ? "light (brighttext on)" : "dark (brighttext off)"), e.bright === (want === "dark"), e);
    check(tag + ": the extension buttons' hover is the " + want + " glass's (" + v.hover + ")", e.hover === v.hover, e);
    check(tag + ": the Downloads ring's track and dot are the " + want + " glass's", e.track === v.track && e.dot === v.dot, e);
    const qv = await quickViewLight();
    // What is painted, not only the class: light glass is white 72 % under #1d1d1f ink (downloads/css.ts
    // row-light), dark glass a dark tint under light ink.
    const painted = !!qv && (want === "light" ? qv.tint === "rgba(255, 255, 255, 0.72)" && qv.ink === "rgb(29, 29, 31)" : qv.tint !== "rgba(255, 255, 255, 0.72)" && luminance(qv.tint) < 0.05 && luminance(qv.ink) > 0.6);
    check(tag + ": the Downloads quick view takes its capsule's theme (" + want + "): class and painted glass and ink", !!qv && qv.light === (want === "light") && painted, qv);
  };
  if (pair) {
    rowLooks("split view");
    // Capsules over the other side's page take that page's colours (bar.ts paintRowSplit).
    await sleep(600);
    const rects = b.splitView.paneRects();
    const darkSide = rects && (b.splitView.active().right === darkTab ? rects.right : rects.left);
    const overDark = (e) => {
      const r = e?.getBoundingClientRect();
      return !!r && !!darkSide && r.left + r.width / 2 >= darkSide.left && r.left + r.width / 2 < darkSide.right;
    };
    const plusEl = document.querySelector("#vitre-bar .item.plus");
    const ringEl = document.querySelector("#vitre-row-end > .vd-ring");
    const sides = [["the + capsule", plusEl, plusEl?.querySelector(".face")], ["the Downloads capsule", ringEl, ringEl]].filter(([, e]) => overDark(e));
    log("split: capsules over the dark page: " + sides.map(([n]) => n).join(", "));
    for (const [name, e, ink] of sides) check("split view, focused side light: " + name + " over the dark page has light ink", priv || luminance(color(ink)) > 0.6, { color: color(ink), cls: e.className });
    await endFollows("split view, light page focused on the left, dark on the right", "dark");
    await capture("hunt-13-split");
    b.splitView.separate(b.splitView.active(), { animate: false });
    await sleep(800);
    // The other way round: the dark page focused on the left, the light one on the right.
    b.activate(darkTab);
    if (!priv) await waitTheme("dark", "dark theme for the reversed split");
    await sleep(500);
    const reversed = b.split(lightTab, { side: "right" });
    await sleep(1500);
    check("split view (reversed) started", !!reversed && b.splitView.active()?.left === darkTab, b.splitView.active());
    if (reversed) {
      await endFollows("split view, dark page focused on the left, light on the right", "light");
      b.splitView.separate(b.splitView.active(), { animate: false });
      await sleep(800);
    }
  }

  // ---- 14. a Peek sheet ----
  b.activate(lightTab);
  await sleep(400);
  const peek = b.service("peek");
  if (peek) {
    // A file: page needs a page principal (peek/index.ts open: without one only http(s) is peeked).
    const url = M.page("article.html");
    peek.open(url, { triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(url), {}) });
    await waitFor(() => peek.isOpen(), { timeout: 6000, what: "peek open" }).catch(() => {});
    await sleep(1600);
    check("peek opens", peek.isOpen());
    if (peek.isOpen()) {
      await capture("hunt-14-peek");
      peek.close();
      await sleep(800);
    }
  }

  // ---- 16. a window-modal dialog (what ⌘Q's quit prompt is): it hangs below the row ----
  // Opened the way Prompter.sys.mjs openInternalWindowPrompt opens one, without waiting on it
  // (Services.prompt's window-modal calls spin a nested event loop with this window's timers suspended).
  const { PromptUtils } = ChromeUtils.importESModule("resource://gre/modules/PromptUtils.sys.mjs");
  const bag = PromptUtils.objectToPropBag({ promptType: "confirm", title: "Hunt", text: "A window-modal prompt over the row.", checkLabel: null, checked: false, ok: false, modalType: Ci.nsIPromptService.MODAL_TYPE_WINDOW });
  bag.setProperty("async", true);
  const asked = window.gDialogBox.open("chrome://global/content/commonDialog.xhtml", bag);
  await waitFor(() => window.gDialogBox?.isOpen, { timeout: 5000, what: "window-modal dialog" }).catch(() => {});
  await sleep(700);
  const dbox = document.querySelector("#window-modal-dialog .dialogBox");
  const dr = dbox?.getBoundingClientRect();
  check("window-modal dialog: it hangs below the row, clear of the capsules and the traffic lights (top >= 60)", !!dr && dr.top >= 60, dr && [dr.left, dr.top, dr.width, dr.height]);
  shots.push("hunt-16-dialog" + suffix);
  await spike.capture("hunt-16-dialog" + suffix);
  try {
    window.gDialogBox._dialog?.close();
  } catch (e) {
    log("could not close the dialog: " + e);
  }
  await Promise.race([asked, sleep(2000)]);
  await sleep(400);

  // ---- 15. a private window ----
  if (!priv) {
    const pw = await spike.openWindow({ private: true });
    pw.resizeTo(1280, 800);
    pw.moveTo(60, 60);
    await sleep(600);
    const pb = pw.vitre;
    const pt = pb.active();
    pb.navigate(pt, light);
    await waitFor(() => pt.url === light && !pt.loading, { timeout: 15000, what: "private page" }).catch(() => {});
    pb.newTab(dark, { background: true });
    await sleep(1500);
    const pitem = pb.bar.item(pt.id);
    const phost = pitem?.querySelector(".address .host") || pitem?.querySelector(".address");
    const pbr = pw.gBrowser.selectedBrowser.getBoundingClientRect();
    const pstrip = pw.getComputedStyle(pw.document.getElementById("vitre-drag"));
    check("private window: the page at y 0, no band across the row, the drag strip paints nothing", Math.round(pbr.top) === 0 && !pw.document.getElementById("vitre-row-band") && pstrip.appearance === "none" && pstrip.backgroundColor === "rgba(0, 0, 0, 0)", { top: pbr.top, appearance: pstrip.appearance, bg: pstrip.backgroundColor });
    check("private window over a light page: white ink on dark glass", pb.root.classList.contains("private") && luminance(pw.getComputedStyle(phost).color) > 0.6, { cls: pb.root.className, color: pw.getComputedStyle(phost).color });
    const pcap = pw.document.getElementById("vitre-private");
    check("private window: the Private capsule has its glass", !!pcap && pw.getComputedStyle(pcap.querySelector(".lens") || pcap).backdropFilter.includes("blur"), pcap && pw.getComputedStyle(pcap.querySelector(".lens") || pcap).backdropFilter);
    privateSolid("private window (opened by this run)", pw);
    await pw.spike.capture("hunt-15-private" + suffix);
    shots.push("hunt-15-private" + suffix);
    pw.close();
    await sleep(800);
  }
  log("captures: " + shots.join(", "));
});
