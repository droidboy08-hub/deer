// Core smoke test: the shell, the Browser API, the tab model, the page actor, settings broadcast.
//   python tools/run.py --test tests/core/smoke.js --name core-smoke --url https://example.com --env VITRE_SELFTEST=1 --timeout 150
// Captures: smoke-1-web.png (dark page, three tabs), smoke-2-light.png (light page),
// smoke-3-second-window.png, smoke-4-private-window.png.
/* global spike, gBrowser, Services, ChromeUtils, Ci */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const $ = (id) => document.getElementById(id);
  const shown = (el) => !!el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const page = (html) => "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>t</title>" + html);
  const nodes = () => gBrowser.tabs.filter((t) => !t.hidden && !t.closing);
  const mirrors = () => b.tabs.length === nodes().length && b.tabs.every((t, i) => t.node === nodes()[i]);

  await spike.resize(1280, 800);
  await spike.activate();

  // ---- 1. Vitre is loaded and Firefox's interface is not rendered ----
  const S = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs").VitreStartup;
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("window.vitre exists", !!b && typeof b.newTab === "function");
  check("startup ran from config.js", S.inited && S.options.loader === "autoconfig", S.timeline);
  log("package:", S.options.appDir);
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  const hooks = Shell.timeline.filter((n) => n.win === window.docShell.outerWindowID);
  check("hooks ran in order before first paint", hooks.map((h) => h.hook).join(",") === "beforeLayout,domContentLoaded,delayedStartup" && hooks[0].paints === 0 && hooks[1].paints === 0, hooks);
  check(":root[vitre] and #vitre-root inside the tab box", document.documentElement.hasAttribute("vitre") && $("vitre-root")?.parentElement === $("tabbrowser-tabbox"));
  check("nav bar, tab strip, menu bar, bookmarks bar not rendered", ["nav-bar", "TabsToolbar", "toolbar-menubar", "PersonalToolbar"].every((id) => !shown($(id))));
  check("toolbox takes no space", $("navigator-toolbox").getBoundingClientRect().height === 0);
  check("sidebar not rendered", !shown($("sidebar-main")) && !shown($("sidebar-box")));
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  check("page fills the window", br.x === 0 && br.y === 0 && br.width === window.innerWidth && br.height === window.innerHeight, [br.x, br.y, br.width, br.height, window.innerWidth, window.innerHeight]);
  check("no native caption (customtitlebar)", document.documentElement.hasAttribute("customtitlebar"));
  check("tab box carries the glass filter", getComputedStyle($("tabbrowser-tabbox")).filter.startsWith("saturate"), getComputedStyle($("tabbrowser-tabbox")).filter);
  check("window icon attribute and title", document.documentElement.getAttribute("icon") === "vitre" && /Deer$/.test(document.title), document.title);
  check("ready after delayed startup", b.ready === true);
  check("product defaults applied over Firefox's", Services.prefs.getDefaultBranch("").getIntPref("browser.startup.page") === 3 && Services.prefs.getDefaultBranch("").getBoolPref("browser.shell.customIcon.enabled") === false && Services.prefs.getIntPref("gfx.webrender.max-filter-ops-per-chain") === 256);

  // ---- 2. module auto-discovery, layer / css / registerAction ----
  const st = window.vitreSelftest;
  check("sample module was discovered and installed", b.modules.includes("selftest") && st?.installed === true && b.moduleErrors.length === 0, [b.modules, b.moduleErrors]);
  check("module saw the tab model at install", st?.tabsAtInstall >= 1);
  check("module heard 'ready'", st.events.includes("ready"), st.events);
  b.run("shortcutsHelp");
  check("registerAction + run(action)", st.ran === 1);
  const layer = b.layer("selftest", 30);
  check("layer(id, z) is one element per id, inside #vitre-root, at its z", layer === $("layer-selftest") && layer.parentElement === b.root && getComputedStyle(layer).zIndex === "30");
  check("layers are click-through, their children are not", getComputedStyle(layer).pointerEvents === "none" && getComputedStyle(layer.firstElementChild).pointerEvents === "auto");
  check("css(id, text) applies once", getComputedStyle(layer.firstElementChild).backgroundColor === "rgb(76, 194, 255)" && (b.css("selftest", "#x{}"), document.querySelectorAll("#css-selftest").length === 1));
  let fired = [];
  const off20 = b.addEscLayer(20, () => (fired.push(20), false));
  const off60 = b.addEscLayer(60, () => (fired.push(60), true));
  const off90 = b.addEscLayer(90, () => (fired.push(90), true));
  check("Esc ladder: lowest priority first, stops at the first that uses it", b.escape() === true && fired.join() === "20,60", fired);
  off20(); off60(); off90();
  let closed = 0;
  const offClose = b.addCloseLayer(60, () => (closed++, true));
  const before = b.tabs.length;
  b.run("closeTab");
  check("close ladder takes Ctrl+W before the tab", closed === 1 && b.tabs.length === before);
  offClose();
  check("sys(name) returns the singleton", b.sys("VitreSettings") === ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings);

  // ---- 3. the tab model mirrors gBrowser ----
  await spike.loaded();
  const first = b.active();
  check("initial tab mirrored", b.tabs.length === 1 && first?.node === gBrowser.selectedTab && first.url.startsWith("https://example.com"), first?.url);
  await waitFor(() => first.title === "Example Domain" && !first.loading, { what: "title of example.com" });
  check("title, kind and loading state follow the page", first.title === "Example Domain" && first.kind === "web" && first.loading === false);

  const dark = page("<body style='margin:0;background:#101014;color:#eee'><h1>dark</h1>");
  const t2 = b.newTab(dark, { background: true });
  check("newTab(url, {background}) adds a tab without activating", b.tabs.length === 2 && b.activeId === first.id && t2?.node === nodes()[1] && mirrors());
  check("background tab is second in MRU", b.mru[0] === first.id && b.mru[1] === t2.id, b.mru);

  const n3 = gBrowser.addTrustedTab(page("<body style='margin:0;background:#fff'><h1>light</h1>"), { inBackground: true });
  const t3 = b.tabs.find((t) => t.node === n3);
  check("a tab opened by Firefox itself is mirrored", !!t3 && b.tabs.length === 3 && mirrors());
  check("selftest module heard tab-created for both", [t2.id, t3.id].every((id) => st.events.includes("created:" + id)), st.events);

  b.activate(t2);
  check("activate(tab) selects it in gBrowser", gBrowser.selectedTab === t2.node && b.activeId === t2.id && b.active() === t2);
  gBrowser.selectedTab = n3;
  check("a selection made by Firefox is mirrored", b.activeId === t3.id && b.mru.join() === [t3.id, t2.id, first.id].join(), b.mru);
  check("tab-activated events", st.events.includes("activated:" + t2.id) && st.events.includes("activated:" + t3.id));
  check("tabFor(browser) and tab(id)", b.tabFor(t2.browser) === t2 && b.tab(t3.id) === t3);

  b.moveTab(t3, 0);
  check("moveTab(tab, index)", b.tabs[0] === t3 && mirrors(), b.tabs.map((t) => t.id));
  gBrowser.moveTabTo(n3, { tabIndex: 2 });
  check("a move made by Firefox is mirrored", b.tabs[2] === t3 && mirrors(), b.tabs.map((t) => t.id));
  b.run("moveTabLeft");
  check("moveTabLeft action", b.tabs[1] === t3 && mirrors());
  b.run("goTab", 1);
  check("goTab action", b.activeId === b.tabs[0].id);
  b.run("nextTab");
  b.run("nextTab");
  b.run("nextTab");
  check("nextTab wraps around", b.activeId === b.tabs[0].id);
  b.run("goLastTab");
  check("goLastTab action", b.activeId === b.tabs[2].id);

  // The bar placeholder follows the model.
  check("bar shows one pill and two circles plus the + circle", document.querySelectorAll("#vitre-bar .item.tab").length === 3 && document.querySelectorAll("#vitre-bar .item.tab.active").length === 1 && !!document.querySelector("#vitre-bar .item.plus"));
  check("bar.layout describes the pill", b.bar.layout.pillRect?.width > 200 && b.bar.layout.left < b.bar.layout.right, b.bar.layout);

  // A hidden tab (what a peek is) is not in b.tabs; showing it brings it back.
  const hiddenNode = gBrowser.addTrustedTab("about:blank", { inBackground: true });
  const hiddenTab = b.tabs.find((t) => t.node === hiddenNode);
  gBrowser.hideTab(hiddenNode, "vitre-test");
  check("hidden tabs leave b.tabs", !b.tabs.includes(hiddenTab) && b.tabs.length === 3 && b.tabFor(hiddenNode.linkedBrowser) === undefined && mirrors());
  gBrowser.showTab(hiddenNode);
  check("shown tabs come back", b.tabs.length === 4 && mirrors());
  gBrowser.removeTab(hiddenNode, { animate: false });
  check("a close made by Firefox is mirrored", b.tabs.length === 3 && mirrors());

  // ---- 4. the page actor answers from a web content process ----
  b.activate(first);
  const pong = await b.page(first).query("core:ping", { n: 7 });
  log("ping from example.com:", pong);
  check("page actor answers on a real https page", pong?.url.startsWith("https://example.com") && pong.echo?.n === 7 && pong.isTop === true);
  check("...from a sandboxed web content process", /^web/.test(pong?.remoteType) && pong.pid !== Services.appinfo.processID, [pong?.remoteType, pong?.pid, Services.appinfo.processID]);
  check("unknown queries resolve undefined", (await b.page(first).query("nobody:home")) === undefined);

  const heard = [];
  const offMsg = b.on("page-message", (tab, name, data, from) => heard.push({ tab: tab?.id, name, data, top: from.isTop }));
  const mixed = page("<body style='margin:0'><div style='height:400px;background:#fff'></div><div style='height:4000px;background:#0c0c10'></div>");
  const t4 = b.newTab(mixed);
  await waitFor(() => heard.some((h) => h.tab === t4.id && h.name === "core:pageshow"), { what: "core:pageshow from the new tab" });
  check("page -> window: core:ready and core:pageshow arrive as 'page-message' with the tab", heard.some((h) => h.tab === t4.id && h.name === "core:ready") && heard.some((h) => h.tab === t4.id && h.name === "core:pageshow" && h.top));
  await waitFor(() => t4.theme === "light" && b.root.classList.contains("theme-light"), { what: "light theme over the white top" });
  check("glass theme sampled from the page: light over a white page", document.documentElement.getAttribute("vitre-theme") === "light");
  await spike.capture("smoke-2-light");
  heard.length = 0;
  t4.browser.messageManager.loadFrameScript("data:,content.scrollTo(0, 900)", false);
  await waitFor(() => heard.some((h) => h.name === "core:scroll" && h.data.y === 900), { what: "core:scroll" });
  check("scroll signal carries the offset", true);
  await waitFor(() => t4.theme === "dark", { what: "dark theme after scrolling to the dark part" });
  check("theme follows a scroll", b.root.classList.contains("theme-dark"));
  const scrollState = await b.page(t4).query("core:scroll");
  check("core:scroll query", scrollState?.y === 900 && scrollState.zoom === 1, scrollState);
  offMsg();

  // ---- 5. links the page wants opened elsewhere go through interceptOpen ----
  const linkPage = page("<body style='margin:0'><a href='https://example.org/vitre-test' style='position:absolute;left:100px;top:200px;width:400px;height:100px;background:#ccd;display:block'>link</a>");
  b.navigate(t4, linkPage);
  await waitFor(() => t4.url === linkPage && !t4.loading, { what: "link page" });
  await sleep(300);
  const requests = [];
  let take = true;
  const offOpen = b.interceptOpen((r) => (requests.push(r), take));
  const tabsBefore = b.tabs.length;
  spike.click(300, 250, { shiftKey: true });
  await waitFor(() => requests.length === 1, { what: "Shift+click reaching interceptOpen" });
  await sleep(300);
  check("Shift+click is offered as new-window with its opener", requests[0].url === "https://example.org/vitre-test" && requests[0].disposition === "new-window" && requests[0].opener === t4 && requests[0].source === "click", [requests[0].url, requests[0].disposition]);
  check("taken requests open nothing", b.tabs.length === tabsBefore && [...Services.wm.getEnumerator("navigator:browser")].length === 1);
  take = false;
  spike.click(300, 250, { ctrlKey: true });
  await waitFor(() => requests.length === 2 && b.tabs.length === tabsBefore + 1, { what: "declined Ctrl+click opening a tab" });
  check("declined requests fall through to Firefox (Ctrl+click opens a background tab)", requests[1].disposition === "background-tab" && b.activeId === t4.id);
  offOpen();
  b.closeTab(b.tabs[b.tabs.indexOf(t4) + 1]);
  b.closeTab(t4);
  check("closeTab(tab) closes it and Firefox picks the next", b.tabs.length === 3 && !b.tabs.includes(t4) && mirrors() && st.events.includes("closed:" + t4.id));

  // ---- 6. engine actions ----
  b.activate(first);
  b.navigate(first, "https://example.com/?second");
  await waitFor(() => first.url.endsWith("?second") && !first.loading && first.canBack, { what: "navigate + canBack" });
  check("navigate(tab, url) and canBack", first.canBack === true && first.canForward === false);
  b.run("back");
  await waitFor(() => !first.url.endsWith("?second") && first.canForward, { what: "back" });
  check("back action", first.canForward === true);
  b.run("zoomIn");
  await waitFor(() => first.zoom > 1, { what: "zoom in" });
  check("zoomIn action updates tab.zoom", first.zoom > 1 && first.zoomFlash > Date.now(), first.zoom);
  b.run("zoomReset");
  await waitFor(() => first.zoom === 1, { what: "zoom reset" });
  b.editAddress();
  check("editAddress() opens the field over the pill, focused", b.omni.open && document.activeElement === $("vitre-omni") && $("vitre-omni").value.startsWith("https://example.com"));
  spike.press("Escape");
  check("Esc closes the field", !b.omni.open);
  window.openLocation();
  check("Firefox's open-location command lands in Vitre's field", b.omni.open);
  b.omni.close();

  b.activate(t2);
  await waitFor(() => b.root.classList.contains("theme-dark"), { what: "dark theme over the dark tab" });
  b.activate(first);
  await sleep(400);
  await spike.capture("smoke-1-web");

  // ---- 7. settings: get / set / broadcast across two windows ----
  const settings = b.sys("VitreSettings");
  // The harness turns auto-hide off (tools/run.py); reset() brings back Deer's own default.
  const defaults = { ...settings.get(), barAutoHide: Services.prefs.getDefaultBranch("vitre.").getBoolPref("barAutoHide") };
  check("defaults match the Settings interface", defaults.theme === "system" && defaults.closeButton === "hover" && defaults.connections === 8 && defaults.homeBackground.kind === "windows" && defaults.rebind && Object.keys(defaults.rebind).length === 0 && defaults.searchEngine === "google" && defaults.downloadsFolder.length > 0, defaults);

  const win2 = await spike.openWindow();
  const b2 = win2.vitre;
  check("a second window gets the shell", !!b2 && b2 !== b && win2.document.documentElement.hasAttribute("vitre") && !!win2.document.getElementById("vitre-root") && b2.tabs.length === 1 && b2.modules.includes("selftest"));
  check("...with Firefox's interface hidden there too", win2.getComputedStyle(win2.document.getElementById("nav-bar")).display === "none" && win2.document.documentElement.hasAttribute("customtitlebar"));
  const heard1 = [];
  const heard2 = [];
  const off1 = b.on("settings", (s, changed) => heard1.push({ s, changed }));
  b2.on("settings", (s, changed) => heard2.push({ s, changed }));
  const t0 = performance.now();
  settings.set({ closeButton: "always", connections: 12, homeBackground: { path: "C:\\Pictures\\caf\u00e9 #1.png" }, rebind: { peekLink: "Ctrl+K" } });
  await waitFor(() => heard1.length && heard2.length, { what: "settings broadcast" });
  log("settings broadcast after", (performance.now() - t0).toFixed(1), "ms; changed", heard2[0].changed);
  check("set(patch) is heard once in every window", heard1.length === 1 && heard2.length === 1 && heard2[0].changed.sort().join() === "closeButton,connections,homeBackground.path,rebind");
  check("b.settings is updated in both windows", b.settings.closeButton === "always" && b2.settings.connections === 12 && b2.settings.homeBackground.path === "C:\\Pictures\\caf\u00e9 #1.png" && b2.settings.homeBackground.kind === "windows" && b2.settings.rebind.peekLink === "Ctrl+K");
  check("stored as vitre.* prefs", Services.prefs.getStringPref("vitre.closeButton") === "always" && Services.prefs.getIntPref("vitre.connections") === 12 && Services.prefs.getStringPref("vitre.rebind") === '{"peekLink":"Ctrl+K"}');
  check("the bar picked the setting up", document.querySelector("#vitre-bar").classList.contains("close-always"));
  Services.prefs.setStringPref("vitre.theme", "dark");
  await waitFor(() => heard2.length === 2, { what: "direct pref write" });
  check("a direct pref write (about:config) is heard too", b2.settings.theme === "dark" && heard2[1].changed.join() === "theme");
  Services.prefs.setStringPref("vitre.theme", "purple");
  await waitFor(() => heard2.length === 3, { what: "invalid pref write" });
  check("invalid values fall back to the default", b2.settings.theme === "system");
  settings.reset();
  await waitFor(() => heard2.length === 4, { what: "reset" });
  check("reset() restores the defaults", JSON.stringify(settings.get()) === JSON.stringify(defaults));
  off1();

  win2.vitre.navigate(win2.vitre.active(), page("<body style='margin:0;background:#f4f1ea;font:16px Segoe UI'><h1 style='margin:120px 80px'>Second window</h1>"));
  await waitFor(() => win2.vitre.active().theme === "light" && !win2.vitre.active().loading, { what: "second window page" });
  win2.resizeTo(1000, 640);
  win2.moveTo(120, 120);
  await sleep(500);
  await win2.spike.capture("smoke-3-second-window");
  win2.close();
  await waitFor(() => !ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell.windows.has(win2), { what: "second window closing" });

  // ---- 8. a private window gets the shell ----
  const pw = await spike.openWindow({ private: true });
  check("a private window gets the shell", !!pw.vitre && pw.vitre.isPrivate === true && pw.document.documentElement.hasAttribute("vitre") && pw.document.documentElement.getAttribute("privatebrowsingmode") === "temporary" && pw.getComputedStyle(pw.document.getElementById("nav-bar")).display === "none" && pw.vitre.root.classList.contains("private"));
  check("its icon attribute is Vitre's", pw.document.documentElement.getAttribute("icon") === "vitre");
  pw.resizeTo(1000, 640);
  pw.moveTo(160, 160);
  await sleep(1200);
  await pw.spike.capture("smoke-4-private-window");
  pw.close();

  check("no boot errors at the end", Shell.errors.length === 0, Shell.errors);
});
