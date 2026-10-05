// Settings panel: every page captured (dark and light), controls wired to the real settings and
// taking effect live, "Find a setting", the page registry (the 'settings' service), and the panel's
// keys (Ctrl+, F1, Ctrl+Shift+Delete, Esc, Ctrl+W, Ctrl+F).
//   node tools/build.mjs --out=build-settings --modules=settings
//   python tools/run.py --app build-settings --test tests/settings/pages.js --name settings-pages --timeout 240
// Captures (tests/settings/out/): pages-<page>.png for every page in dark mode, pages-light-*.png,
// pages-dropdown.png (a list open), pages-find-*.png, pages-registered.png, pages-small.png (a window
// smaller than the sheet).
/* global spike, Services, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  await spike.resize(1440, 900);
  await spike.activate();

  check("settings module installed", b.modules.includes("settings") && !b.moduleErrors.some((m) => m.name === "settings"), { modules: b.modules, errors: b.moduleErrors });
  const svc = b.service("settings");
  check("the 'settings' service is provided", !!svc && typeof svc.open === "function" && typeof svc.registerPage === "function", Object.keys(svc || {}));
  const { panel } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");
  const sheet = () => root()?.querySelector(".vs-sheet");
  const content = () => root()?.querySelector(".vs-content");
  const page = () => content()?.dataset.page;
  const open = () => panel.isOpen && !root().hidden;
  const settle = (ms = 450) => sleep(ms);

  // A page under the panel, as on the board (a light article under the glass bar).
  const article = "data:text/html;charset=utf-8," + encodeURIComponent(
    "<!doctype html><meta charset=utf-8><title>Field Notes</title><body style='margin:0;background:#f3eee4;font:17px/1.6 Georgia,serif;color:#2b2722'>" +
    "<div style='max-width:760px;margin:0 auto;padding:110px 24px'><h1 style='font:600 44px/1.15 Georgia,serif;margin:0 0 18px'>Float glass and the long road to a flat pane</h1>" +
    "<p>For most of history a window was a compromise. Crown glass was spun into a disc, cylinder glass was blown, slit and flattened, and both left ripples that bent the street outside.</p>".repeat(6) +
    "</div><div style='position:fixed;right:40px;top:180px;width:220px;height:300px;border-radius:14px;background:linear-gradient(160deg,#c46a3b,#2f5d73)'></div>");
  b.navigate(b.active(), article);
  await waitFor(() => b.active().title === "Field Notes" && !b.active().loading, { timeout: 15000, what: "article" });
  await settle(600);

  // Dark mode first: the board is drawn in Windows dark mode.
  store.set({ theme: "dark" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });
  await settle(300);

  // ---------------------------------------------------------------- Ctrl+, opens, Esc closes
  b.focusPage();
  await settle(200);
  spike.press("Ctrl+,");
  await waitFor(open, { timeout: 3000, what: "panel open" });
  await settle();
  check("Ctrl+, opens Settings over the page (from the page)", open() && b.root.classList.contains("panel-open") && b.root.classList.contains("settings-open"), b.keys.log.slice(-3));
  const r = sheet().getBoundingClientRect();
  check("the sheet is 960x688, centred", Math.round(r.width) === 960 && Math.round(r.height) === 688 && Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 1 && Math.abs(r.top + r.height / 2 - window.innerHeight / 2) <= 1, { r: [r.left, r.top, r.width, r.height], win: [window.innerWidth, window.innerHeight] });
  const lensFilter = getComputedStyle(root().querySelector(".vs-lens")).backdropFilter;
  check("the sheet carries its lens (strip lens filter)", /url\(/.test(lensFilter), lensFilter);
  const navLabels = [...root().querySelectorAll(".vs-navitem")].map((n) => n.textContent);
  check("the sidebar lists the pages in the board's order", navLabels.join("|") === "General|Appearance|Home and background|Tabs|Downloads|Privacy and security|Search engine|Keyboard shortcuts|About Deer", navLabels);
  check("focus is inside the sheet", sheet().contains(document.activeElement), document.activeElement && document.activeElement.className);

  spike.press("Escape");
  await settle();
  check("Esc closes Settings and focus goes back to the page", !panel.isOpen && !b.root.classList.contains("panel-open") && document.activeElement === gBrowser.selectedBrowser, document.activeElement && document.activeElement.localName);
  await sleep(250);
  check("the panel is hidden after its close motion", root().hidden, root().className);

  // ---------------------------------------------------------------- every page, dark
  const pages = ["general", "appearance", "home", "tabs", "downloads", "privacy", "search", "shortcuts", "about"];
  for (const id of pages) {
    svc.open(id);
    await waitFor(() => page() === id, { timeout: 3000, what: "page " + id });
    await settle(id === "home" || id === "tabs" ? 900 : 400);
    const current = root().querySelector('.vs-navitem[aria-current="page"]');
    const rows = content().querySelectorAll(".vs-row, .vs-style, .hb-tile").length;
    check(`page ${id}: shown, current in the sidebar, has rows`, current && current.dataset.id === id && rows > 0, { current: current && current.dataset.id, rows });
    await spike.capture("pages-" + id);
  }
  // The shortcuts page scrolled down (the long list), and the tabs page at the board's state.
  svc.open("shortcuts");
  await settle();
  root().querySelector(".vs-main").scrollTop = 900;
  await settle(200);
  await spike.capture("pages-shortcuts-scrolled");

  // ---------------------------------------------------------------- controls are wired, live
  svc.open("appearance");
  await settle();
  const seg = (label) => [...content().querySelectorAll(".vs-seg-btn")].find((x) => x.textContent === label);
  spike.click(seg("Light"));
  await waitFor(() => store.get().theme === "light", { timeout: 3000, what: "theme light" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: light)").matches, { timeout: 10000, what: "light chrome" });
  await settle(500);
  check("Appearance › Mode › Light writes the setting and the chrome turns light at once", store.get().theme === "light" && seg("Light").getAttribute("aria-checked") === "true", store.get().theme);
  await spike.capture("pages-light-appearance");
  for (const id of ["tabs", "shortcuts", "privacy"]) {
    svc.open(id);
    await settle(id === "tabs" ? 800 : 400);
    await spike.capture("pages-light-" + id);
  }
  svc.open("appearance");
  await settle();
  spike.click(seg("Dark"));
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome again" });
  await settle(300);

  // Drop-down: Show the tab bar -> When I point at the top (barAutoHide) and back.
  const ddFor = (title) => {
    const row = [...content().querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === title);
    return row && row.querySelector(".vs-dd");
  };
  const pickOption = async (dd, label, shot) => {
    spike.click(dd);
    await waitFor(() => sheet().querySelector(".vs-pop"), { timeout: 2000, what: "list " + label });
    if (shot) await spike.capture(shot);
    const opt = [...sheet().querySelectorAll(".vs-opt")].find((o) => o.textContent === label);
    spike.click(opt);
    await settle(300);
  };
  await pickOption(ddFor("Show the tab bar"), "When I point at the top", "pages-dropdown");
  check("Show the tab bar › When I point at the top sets barAutoHide and the bar starts hiding", store.get().barAutoHide === true && b.root.classList.contains("bar-hiding"), { auto: store.get().barAutoHide, root: b.root.className });
  await pickOption(ddFor("Show the tab bar"), "Always");
  check("…and Always puts it back", store.get().barAutoHide === false && !b.root.classList.contains("bar-hiding"), b.root.className);

  // Switch: pageInset
  const switchFor = (title) => {
    const row = [...content().querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === title);
    return row && row.querySelector(".vs-switch");
  };
  spike.click(switchFor("Start pages below the tab bar"));
  await settle(300);
  check("Start pages below the tab bar off writes pageInset=false (vitre.pageInset pref)", store.get().pageInset === false && Services.prefs.getBoolPref("vitre.pageInset") === false && switchFor("Start pages below the tab bar").getAttribute("aria-checked") === "false");
  spike.click(switchFor("Start pages below the tab bar"));
  await settle(300);
  check("…and on again", store.get().pageInset === true);

  // Tabs page: switcher style tiles, close button, new tab position, selection search.
  svc.open("tabs");
  await settle(500);
  const tile = (label) => content().querySelector(`.vs-style[aria-label="${label}"]`);
  spike.click(tile("Grid"));
  await settle(300);
  check("Tab switcher style › Grid writes switcherStyle and the note follows", store.get().switcherStyle === "grid" && tile("Grid").getAttribute("aria-checked") === "true" && /grid/.test(content().querySelector(".vs-note").textContent), store.get().switcherStyle);
  await spike.capture("pages-tabs-grid");
  spike.click(tile("Full-screen deck"));
  await settle(200);
  await pickOption(ddFor("Close button on tabs"), "Always");
  check("Close button on tabs › Always: the bar shows close buttons always", store.get().closeButton === "always" && document.getElementById("vitre-bar").classList.contains("close-always"));
  await pickOption(ddFor("Close button on tabs"), "When I point at a tab");
  await pickOption(ddFor("New tabs open"), "At the end");
  check("New tabs open › At the end writes newTabPosition and Firefox's insertAfterCurrent", store.get().newTabPosition === "end" && Services.prefs.getBoolPref("browser.tabs.insertAfterCurrent") === false);
  await pickOption(ddFor("New tabs open"), "Next to the current tab");
  await pickOption(ddFor("Order of tabs"), "Tab bar order");
  check("Order of tabs › Tab bar order writes tabOrder and its description follows", store.get().tabOrder === "bar" && /right/.test(ddFor("Order of tabs").closest(".vs-row").querySelector(".vs-desc").textContent));
  await pickOption(ddFor("Order of tabs"), "Most recently used");
  await pickOption(ddFor("Searches from selected text"), "Open in a new tab");
  check("Searches from selected text writes selectionSearchOpens", store.get().selectionSearchOpens === "tab");
  await pickOption(ddFor("Searches from selected text"), "Open in a peek");
  spike.click(switchFor("Type to search while switching"));
  await settle(200);
  check("Type to search while switching writes typeToSearch", store.get().typeToSearch === false);
  spike.click(switchFor("Type to search while switching"));
  await settle(200);

  // Downloads page.
  svc.open("downloads");
  await settle();
  await pickOption(ddFor("Connections per download"), "16 connections");
  await pickOption(ddFor("Limit speed"), "1 MB/s");
  spike.click(switchFor("Ask where to save each file"));
  await settle(200);
  const s1 = store.get();
  check("Downloads: connections, speed limit and ask-where-to-save are written", s1.connections === 16 && s1.speedLimitKBps === 1024 && s1.askWhereToSave === true, { c: s1.connections, s: s1.speedLimitKBps, a: s1.askWhereToSave });
  const folderDesc = [...content().querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === "Save files to").querySelector(".vs-desc").textContent;
  check("Save files to shows the downloads folder", folderDesc && folderDesc === s1.downloadsFolder, folderDesc);
  store.reset("connections");
  store.reset("speedLimitKBps");
  store.reset("askWhereToSave");

  // Search engine radios: the address field's engine follows.
  svc.open("search");
  await settle();
  const radio = [...content().querySelectorAll(".vs-pickrow")].find((x) => x.querySelector(".vs-title").textContent === "DuckDuckGo");
  spike.click(radio);
  await settle(300);
  check("Search engine › DuckDuckGo writes searchEngine", store.get().searchEngine === "duckduckgo" && radio.querySelector(".vs-radio").getAttribute("aria-checked") === "true");
  // The core applies it to the address field (shared/url.ts setSearchEngine in the window bundle).
  b.editAddress("float glass");
  await settle(300);
  const typed = b.omni.current && b.omni.current();
  check("…and the address field now searches with it", typed && /duckduckgo\.com/.test(typed.url), typed);
  b.omni.close();
  await settle(200);
  check("the address field taking focus closed Settings", !panel.isOpen);
  store.reset("searchEngine");

  // Another window hears the change at once (VitreSettings broadcasts).
  const win2 = await spike.openWindow();
  store.set({ closeButton: "always" });
  await sleep(150);
  check("a second window follows a change made here", win2.vitre.settings.closeButton === "always" && win2.document.getElementById("vitre-bar").classList.contains("close-always"));
  store.reset("closeButton");
  win2.close();
  await settle(400);
  await spike.activate();

  // ---------------------------------------------------------------- Find a setting
  svc.open("general");
  await settle();
  const search = root().querySelector(".vs-search-input");
  b.focusPage();
  await settle(150);
  svc.open();
  await settle(200);
  spike.press("Ctrl+F");
  await settle(200);
  check("Ctrl+F with Settings open focuses Find a setting (not the page's find)", document.activeElement === search, document.activeElement && document.activeElement.className);
  spike.type("cookie");
  await settle(400);
  const titles = () => [...content().querySelectorAll(".vs-title")].map((x) => x.textContent);
  check("typing 'cookie' lists Clear browsing data under Privacy", page() === "results" && titles().includes("Cookies and site data") && [...content().querySelectorAll(".vs-h2")].some((x) => /Privacy and security/.test(x.textContent)), titles());
  await spike.capture("pages-find-cookie");
  search.select();
  spike.type("ctrl+q");
  await settle(400);
  check("typing a key ('ctrl+q') finds the shortcut rows that use it", titles().some((t) => /Peek the focused link/.test(t)), titles().slice(0, 6));
  await spike.capture("pages-find-ctrlq");
  search.select();
  spike.type("wallpaper");
  await settle(600);
  check("'wallpaper' finds Home's background", titles().includes("Background"), titles());
  search.select();
  spike.type("zzqx");
  await settle(300);
  const empty = content().querySelector(".vs-empty");
  check("no match says so", empty && /No settings match/.test(empty.textContent), empty && empty.textContent);
  spike.press("Escape");
  await settle(200);
  check("Esc in the field clears it first (the panel stays)", panel.isOpen && search.value === "" && page() !== "results");
  svc.open(undefined, "tab bar");
  await settle(400);
  check("open(undefined, query) opens with the results for the query", page() === "results" && search.value === "tab bar" && titles().includes("Show the tab bar"), titles());

  // ---------------------------------------------------------------- the page registry
  let rendered = 0;
  let cleaned = 0;
  const off = svc.registerPage({
    id: "extensions-test",
    title: "Extensions",
    order: 55,
    keywords: "add-ons addons ublock",
    render(host) {
      rendered++;
      const h2 = document.createElement("h2");
      h2.className = "vs-h2";
      h2.textContent = "Installed";
      const card = document.createElement("div");
      card.className = "vs-card";
      const row = document.createElement("div");
      row.className = "vs-row";
      const text = document.createElement("div");
      text.className = "vs-text";
      const t = document.createElement("span");
      t.className = "vs-title";
      t.textContent = "uBlock Origin";
      const d = document.createElement("span");
      d.className = "vs-desc";
      d.textContent = "A test page drawn by another module through registerPage";
      text.append(t, d);
      const btn = document.createElement("button");
      btn.className = "vs-btn";
      btn.textContent = "Options";
      row.append(text, btn);
      card.append(row);
      host.append(h2, card);
      return () => cleaned++;
    },
  });
  await settle(200);
  const navNow = [...root().querySelectorAll(".vs-navitem")].map((n) => n.textContent);
  check("a registered page appears in the sidebar at its order (55: after Downloads)", navNow.indexOf("Extensions") === navNow.indexOf("Downloads") + 1, navNow);
  svc.open("extensions-test");
  await settle(400);
  check("open(id) shows the registered page, drawn into its host under the title", page() === "extensions-test" && rendered === 1 && content().querySelector(".vs-h1").textContent === "Extensions" && content().querySelector(".vs-ext .vs-title")?.textContent === "uBlock Origin", { page: page(), rendered });
  await spike.capture("pages-registered");
  svc.open("about");
  await settle(200);
  check("leaving the page runs its clean-up", cleaned === 1, cleaned);
  svc.open(undefined, "ublock");
  await settle(300);
  check("Find a setting finds the registered page by its keywords", titles().includes("Extensions"), titles());
  off();
  await settle(200);
  check("removing it takes it out of the sidebar", ![...root().querySelectorAll(".vs-navitem")].some((n) => n.textContent === "Extensions"));
  const offIcon = svc.registerPage({
    id: "icon-test",
    title: "Icon test",
    order: 95,
    icon: "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'><circle cx='9' cy='9' r='7' fill='%234cc2ff'/></svg>"),
    render: () => () => {},
  });
  await settle(200);
  const iconItem = [...root().querySelectorAll(".vs-navitem")].pop();
  check("a page registered with an image URL icon gets it (as SVG <image>), last by its order 95", iconItem.textContent === "Icon test" && !!iconItem.querySelector("svg image"), iconItem.textContent);
  offIcon();
  let threw = false;
  try {
    svc.registerPage({ id: "general", title: "x", order: 1, render: () => () => {} });
  } catch {
    threw = true;
  }
  check("a page id that exists is refused", threw);

  // ---------------------------------------------------------------- the panel's keys
  svc.close();
  await settle();
  b.focusPage();
  await settle(150);
  spike.press("F1");
  await waitFor(() => panel.isOpen && page() === "shortcuts", { timeout: 3000, what: "F1" });
  check("F1 opens Settings at Keyboard shortcuts", page() === "shortcuts");
  spike.press("Ctrl+,");
  await settle();
  check("Ctrl+, again closes it", !panel.isOpen);
  b.focusPage();
  await settle(150);
  spike.press("Ctrl+Shift+Delete");
  await waitFor(() => panel.isOpen && page() === "privacy", { timeout: 3000, what: "Ctrl+Shift+Delete" });
  await settle(300);
  const clearCard = content().querySelector('[data-anchor="clear"]');
  check("Ctrl+Shift+Delete opens Privacy with focus in Clear browsing data", clearCard && clearCard.contains(document.activeElement), document.activeElement && document.activeElement.className);
  const tabsBefore = b.tabs.length;
  spike.press("Ctrl+W");
  await settle();
  check("Ctrl+W closes the panel, not the tab", !panel.isOpen && b.tabs.length === tabsBefore, { open: panel.isOpen, tabs: b.tabs.length });
  svc.open("general");
  await settle(300);
  spike.click(30, 400);
  await settle();
  check("a click on the dimmed page closes Settings", !panel.isOpen);
  svc.open("general");
  await settle(300);
  spike.press("Ctrl+T");
  await settle(700);
  check("Ctrl+T while Settings is open: a new tab, the field takes focus, Settings steps aside", !panel.isOpen && b.omni.open && b.active().kind === "home", { open: panel.isOpen, omni: b.omni.open });
  spike.press("Escape");
  await settle(200);
  spike.press("Ctrl+W");
  await settle(400);

  // A small window: the sheet scales down to fit with a 16 px margin.
  await spike.resize(900, 640);
  svc.open("appearance");
  await settle(500);
  const rs = sheet().getBoundingClientRect();
  check("in a 900x640 window the sheet is scaled to fit with a margin", rs.left >= 15 && rs.top >= 15 && rs.right <= window.innerWidth - 15 && rs.bottom <= window.innerHeight - 15, { rs: [rs.left, rs.top, rs.right, rs.bottom], win: [window.innerWidth, window.innerHeight] });
  await spike.capture("pages-small");
  svc.close();
  store.reset("theme");
  await settle(300);
  log("router log tail", b.keys.log.slice(-12));
});
