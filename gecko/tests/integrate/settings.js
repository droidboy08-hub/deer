// Settings changed in the Settings panel (its own controls, clicked) take effect live in every
// module and every window:
//   Tabs › Tab switcher style › Grid      the switcher opens as the grid (here and in a second window)
//   Appearance › Show the tab bar          auto-hide: the bar hides in both windows, pages lose the strip
//   Appearance › Start pages below...      the strip goes from every page, and comes back
//   Keyboard shortcuts › rebind            Open as tab moved to Ctrl+Shift+O: the key promotes a peek,
//                                          the old Alt+Enter no longer does, the peek page's menu prints
//                                          the new key; Peek link moved to Ctrl+Shift+Y works from a page
//   Downloads › Save files to › Change     (the folder dialog answered by a stand-in) the next download
//                                          lands in the new folder
//   Settings › Extensions and Video downloads are registered by their modules, in the sidebar order.
// Captures: settings-1-tabs-grid, settings-2-grid-switcher, settings-3-autohide, settings-4-rebind,
// settings-5-folder, settings-6-extensions, settings-7-video-downloads.
/* global spike, Services, I, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  const store = b.sys("VitreSettings");
  const svc = b.service("settings");
  const peek = b.service("peek");
  const switcher = b.service("switcher");
  const EU = spike.EU;
  const key = (k, opts = {}) => EU.synthesizeKey(k, opts, window);
  await spike.resize(1440, 900);
  await spike.activate();
  I.mouse(700, 500, { type: "mousemove" });

  const root = () => document.getElementById("vitre-settings");
  const sheet = () => root()?.querySelector(".vs-sheet");
  const content = () => root()?.querySelector(".vs-content");
  const settle = (ms = 400) => sleep(ms);
  const rowFor = (title) => [...content().querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === title);
  const ddFor = (title) => rowFor(title)?.querySelector(".vs-dd");
  const switchFor = (title) => rowFor(title)?.querySelector(".vs-switch");
  const pickOption = async (dd, label) => {
    spike.click(dd);
    await waitFor(() => sheet().querySelector(".vs-pop"), { timeout: 2000, what: "list " + label });
    const opt = [...sheet().querySelectorAll(".vs-opt")].find((o) => o.textContent === label);
    spike.click(opt);
    await settle(300);
  };
  const openPage = async (id) => {
    svc.open(id);
    await waitFor(() => content()?.dataset.page === id, { timeout: 3000, what: "page " + id });
    await settle(500);
  };
  const closePanel = async () => {
    svc.close();
    await waitFor(() => !svc.isOpen(), { timeout: 3000, what: "panel closed" }).catch(() => null);
    await settle(400);
  };

  const t1 = await I.load(I.page("article.html"), 600);
  const t2 = await I.open(I.page("long.html"), 600);
  const win2 = await spike.openWindow();
  await sleep(400);
  const w2t = win2.vitre.active();
  win2.vitre.navigate(w2t, I.page("long.html?w2"));
  await waitFor(() => w2t.url === I.page("long.html?w2") && !w2t.loading, { timeout: 15000, what: "second window page" });
  window.focus();
  await spike.activate();
  await sleep(500);

  // ---- Tabs › Tab switcher style › Grid ----
  await openPage("tabs");
  const tile = (label) => content().querySelector(`.vs-style[aria-label="${label}"]`);
  spike.click(tile("Grid"));
  await settle(300);
  check("Tabs › Grid writes switcherStyle", store.get().switcherStyle === "grid" && win2.vitre.settings.switcherStyle === "grid", store.get().switcherStyle);
  await capture("settings-1-tabs-grid");
  await closePanel();
  b.focusPage();
  await sleep(200);
  key("KEY_Control", { type: "keydown" });
  await sleep(40);
  key("KEY_Tab");
  await waitFor(() => window.vitreSwitcher.state().phase === "open", { timeout: 3000, what: "switcher" }).catch(() => null);
  await sleep(900);
  const sw = window.vitreSwitcher.state();
  check("the next Ctrl+Tab opens the grid", sw.phase === "open" && sw.style === "grid" && b.root.classList.contains("vitre-switcher-grid"), sw);
  await capture("settings-2-grid-switcher");
  key("KEY_Control", { type: "keyup" });
  await waitFor(() => !switcher.isOpen(), { timeout: 3000, what: "switcher closed" }).catch(() => null);
  await sleep(600);
  // The second window needs two tabs for a switcher.
  win2.vitre.newTab(I.page("counter.html?w2"), { background: true });
  await sleep(800);
  win2.vitre.service("switcher").open("latched");
  await win2.spike.waitFor(() => win2.vitreSwitcher.state().phase === "open", { timeout: 3000, what: "second window switcher" }).catch(() => null);
  await sleep(300);
  const sw2 = win2.vitreSwitcher.state();
  check("the second window's switcher is the grid too", sw2.style === "grid", sw2);
  win2.spike.EU.synthesizeKey("KEY_Escape", {}, win2);
  await sleep(500);
  window.focus();
  await spike.activate();
  await openPage("tabs");
  spike.click(tile("Full-screen deck"));
  await settle(300);
  check("…and the deck again", store.get().switcherStyle === "deck");

  // ---- Appearance › Show the tab bar › When I point at the top ----
  b.activate(t2);
  await openPage("appearance");
  await pickOption(ddFor("Show the tab bar"), "When I point at the top");
  await closePanel();
  I.mouse(700, 500, { type: "mousemove" });
  await waitFor(() => b.bar.hidden && win2.vitre.bar.hiding, { timeout: 4000, what: "bars hiding" }).catch(() => null);
  await waitFor(async () => !(await I.inset(t2.browser)).applied && !(await win2.vitre.page(w2t.browser).query("inset:state", {})).applied, { timeout: 4000, what: "strips gone" }).catch(() => null);
  const a1 = await I.inset(t2.browser, "#first");
  const a2 = await win2.vitre.page(w2t.browser).query("inset:state", {});
  check("Show the tab bar › When I point at the top: both windows' bars hide and their pages start at the top", store.get().barAutoHide && b.bar.hidden && win2.vitre.bar.hiding && !a1.applied && Math.abs(a1.rect.top) < 1 && !a2.applied, { hidden: b.bar.hidden, w2: win2.vitre.bar.hiding, here: [a1.applied, a1.rect?.top], there: a2.applied });
  await capture("settings-3-autohide");
  store.set({ pageInset: false }); // the link below turns it back on
  await openPage("appearance");
  await pickOption(ddFor("Show the tab bar"), "Always");
  await waitFor(async () => (await I.inset(t2.browser)).applied, { timeout: 4000, what: "strip back" }).catch(() => null);
  check("…Always: the bars stay and the strip is back", !store.get().barAutoHide && !b.bar.hiding && !win2.vitre.bar.hiding && (await I.inset(t2.browser)).applied);
  check("…Always also turns on Start pages below the tab bar (it was off)", store.get().pageInset === true);

  // ---- Appearance › Start pages below the tab bar ----
  spike.click(switchFor("Start pages below the tab bar"));
  await waitFor(async () => !(await I.inset(t2.browser)).applied && !(await I.inset(t1.browser)).applied && !(await win2.vitre.page(w2t.browser).query("inset:state", {})).applied, { timeout: 4000, what: "strip off everywhere" }).catch(() => null);
  const off = [(await I.inset(t1.browser)).applied, (await I.inset(t2.browser)).applied, (await win2.vitre.page(w2t.browser).query("inset:state", {})).applied];
  check("Start pages below the tab bar off: every page of every window loses the strip at once", store.get().pageInset === false && off.every((x) => !x), off);
  spike.click(switchFor("Start pages below the tab bar"));
  await waitFor(async () => (await I.inset(t2.browser)).applied && (await win2.vitre.page(w2t.browser).query("inset:state", {})).applied, { timeout: 4000, what: "strip on everywhere" }).catch(() => null);
  check("…on again: the strip is back everywhere", store.get().pageInset === true && (await I.inset(t1.browser)).applied && (await I.inset(t2.browser)).applied);
  await closePanel();

  // ---- Keyboard shortcuts › rebind Open as tab and Peek link ----
  await openPage("shortcuts");
  const rebind = async (action, chord) => {
    const row = () => root().querySelector(`[data-rebind="${action}"]`);
    row().scrollIntoView({ block: "center" });
    await settle(200);
    spike.click(row().querySelector(".vs-keybtn"));
    await settle(250);
    const [k, mods] = chord;
    key(k, mods);
    await settle(400);
    return row().querySelector(".vs-keybtn")?.textContent;
  };
  const shownA = await rebind("openAsTab", ["o", { ctrlKey: true, shiftKey: true }]);
  const shownB = await rebind("peekLink", ["y", { ctrlKey: true, shiftKey: true }]);
  check("Keyboard shortcuts: Open as tab → Ctrl+Shift+O and Peek link → Ctrl+Shift+Y saved", store.get().rebind.openAsTab === "Ctrl+Shift+O" && store.get().rebind.peekLink === "Ctrl+Shift+Y" && shownA === "Ctrl+Shift+O" && shownB === "Ctrl+Shift+Y", { rebind: store.get().rebind, shownA, shownB });
  await capture("settings-4-rebind");
  await closePanel();
  b.activate(t1);
  await sleep(500);
  // Peek link by its new key, on the hovered link.
  const lr = await I.rectOf("#peeklink");
  I.mouse(lr.cx, lr.cy, { type: "mousemove" });
  b.focusPage();
  await sleep(300);
  key("q", { ctrlKey: true });
  await sleep(900);
  const byOld = peek.isOpen();
  key("y", { ctrlKey: true, shiftKey: true });
  const byNew = await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html"), { timeout: 6000, what: "peek by Ctrl+Shift+Y" }).catch(() => false);
  await sleep(800);
  check("Ctrl+Shift+Y (the new key) peeks the hovered link; Ctrl+Q no longer does", !byOld && !!byNew, { byOld, byNew: !!byNew });
  // The peek page's menu prints the new Open as tab key, and the key works; Alt+Enter does not.
  const pb = peek.browser();
  const pr = pb.getBoundingClientRect();
  I.rightClick(pr.left + pr.width / 2, pr.top + pr.height * 0.7);
  await I.waitMenu();
  const st = I.describeMenu("PEEK PAGE");
  check("the peek page's menu prints Open as tab with its new key", st.rows[0]?.label === "Open as tab" && st.rows[0]?.key === "Ctrl+Shift+O", st.rows[0]);
  I.key("KEY_Escape");
  await I.waitMenuClosed();
  pb.focus();
  await sleep(200);
  key("KEY_Enter", { altKey: true });
  await sleep(900);
  const stillPeek = peek.isOpen();
  pb.focus();
  await sleep(150);
  key("o", { ctrlKey: true, shiftKey: true });
  const promoted = await waitFor(() => !peek.isOpen() && b.tabs.length === 3, { timeout: 5000, what: "promoted by Ctrl+Shift+O" }).catch(() => false);
  check("Ctrl+Shift+O opens the peek as a tab; Alt+Enter no longer does", stillPeek && !!promoted, { stillPeek, tabs: b.tabs.length });
  const promotedTab = b.active();
  store.set({ rebind: {} });
  await sleep(300);

  // ---- Downloads › Save files to › Change ----
  const folder = PathUtils.join(I.dlDir, "chosen");
  await IOUtils.makeDirectory(folder, { createAncestors: true });
  const picker = I.mockFilePicker(() => folder);
  try {
    await openPage("downloads");
    const change = [...content().querySelectorAll(".vs-btn")].find((x) => x.textContent === "Change");
    spike.click(change);
    await waitFor(() => store.get().downloadsFolder === folder, { timeout: 5000, what: "folder set" }).catch(() => null);
    await settle(300);
    check("Save files to › Change: the folder dialog was asked and the setting follows", store.get().downloadsFolder === folder && picker.asked.length === 1 && rowFor("Save files to")?.querySelector(".vs-desc")?.textContent === folder, { asked: picker.asked, folder: store.get().downloadsFolder });
    await capture("settings-5-folder");
    await closePanel();
  } finally {
    picker.restore();
  }
  b.activate(t1);
  await sleep(400);
  b.service("downloads").download(I.page("files/notes.zip"), { browser: t1.browser });
  const landed = await waitFor(async () => {
    try {
      return (await IOUtils.getChildren(folder)).some((p) => p.endsWith("notes.zip"));
    } catch {
      return false;
    }
  }, { timeout: 15000, what: "download in the new folder" }).catch(() => false);
  check("the next download lands in the folder chosen in Settings", !!landed, { files: await IOUtils.getChildren(folder).catch(() => []) });

  // ---- pages other modules registered ----
  await openPage("extensions");
  const nav = [...root().querySelectorAll(".vs-navitem")].map((n) => n.textContent);
  const title = root().querySelector(".vs-content h1, .vs-content .vs-h1")?.textContent;
  log("sidebar", nav, "title", title);
  check("Settings › Extensions is registered by the extensions module, after Privacy and security", content().dataset.page === "extensions" && nav.indexOf("Extensions") === nav.indexOf("Privacy and security") + 1, { nav, title });
  check("Settings › Video downloads is registered by the downloads module, after Downloads", nav.indexOf("Video downloads") === nav.indexOf("Downloads") + 1, nav);
  await capture("settings-6-extensions");
  await openPage("video-downloads");
  await capture("settings-7-video-downloads");
  await closePanel();
  check("the promoted tab is still there", b.tabs.includes(promotedTab));
  win2.close();
  store.reset("downloadsFolder");
});
