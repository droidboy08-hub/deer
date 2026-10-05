// Settings verifier: restart and session restore. Settings changed through the panel's own controls
// (and a rebind through key capture, caret browsing, Home's background) survive a restart; a panel
// left open is not restored as a ghost; after the restart the panel shows the stored values and they
// work (the rebind in the router, Firefox's tab position, the address field's engine).
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/restart.js --name settings-verify-restart --timeout 300
// Captures: restart-after-tabs.png (Settings › Tabs after the restart).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const svc = b.service("settings");
  const store = b.sys("VitreSettings");
  const pick = async (title, label) => {
    V.rowFor(title).querySelector(".vs-dd").click();
    await waitFor(() => V.sheet().querySelector(".vs-pop"), { timeout: 2000, what: "list " + title });
    [...V.sheet().querySelectorAll(".vs-opt")].find((o) => o.textContent === label).click();
    await sleep(200);
  };
  const seg = (label) => [...V.content().querySelectorAll(".vs-seg-btn")].find((x) => x.textContent === label);
  const PAGE = V.page("Restored page", "<p style='margin:120px 40px'>A page that comes back after the restart.</p>");

  if (spike.run === 1) {
    await V.load(PAGE);
    svc.open("appearance");
    await sleep(400);
    seg("Dark").click();
    await sleep(300);
    svc.open("tabs");
    await sleep(500);
    V.content().querySelector('.vs-style[data-value="strip"]').click();
    await pick("Order of tabs", "Tab bar order");
    await pick("Close button on tabs", "Always");
    await pick("New tabs open", "At the end");
    await pick("Searches from selected text", "Open in a new tab");
    svc.open("downloads");
    await sleep(300);
    await pick("Connections per download", "16 connections");
    await pick("Limit speed", "512 KB/s");
    svc.open("search");
    await sleep(300);
    [...V.content().querySelectorAll(".vs-pickrow")].find((x) => x.querySelector(".vs-title").textContent === "Brave Search").click();
    await sleep(200);
    svc.open("shortcuts");
    await sleep(400);
    const row = V.root().querySelector('[data-rebind="switcherSearch"]');
    row.scrollIntoView({ block: "center" });
    row.querySelector(".vs-keybtn").click();
    await sleep(250);
    V.press("Ctrl+Shift+K");
    await sleep(300);
    V.rowFor("Caret browsing").querySelector(".vs-switch").click();
    await sleep(200);
    svc.open("home");
    await sleep(800);
    [...V.content().querySelectorAll('.hb-tabs [role="tab"], .vs-seg-btn')].find((x) => x.textContent === "None")?.click();
    await sleep(300);
    V.content().querySelector('.hb-tile[data-kind="none"]')?.click();
    await sleep(300);
    const s = store.get();
    log("before restart:", JSON.stringify({ theme: s.theme, switcherStyle: s.switcherStyle, tabOrder: s.tabOrder, closeButton: s.closeButton, newTabPosition: s.newTabPosition, selectionSearchOpens: s.selectionSearchOpens, connections: s.connections, speedLimitKBps: s.speedLimitKBps, searchEngine: s.searchEngine, rebind: s.rebind, homeBackground: s.homeBackground }));
    check("run 1: every change went through the panel's controls into the store", s.theme === "dark" && s.switcherStyle === "strip" && s.tabOrder === "bar" && s.closeButton === "always" && s.newTabPosition === "end" && s.selectionSearchOpens === "tab" && s.connections === 16 && s.speedLimitKBps === 512 && s.searchEngine === "brave" && s.rebind.switcherSearch === "Ctrl+Shift+K" && s.homeBackground.kind === "none" && Services.prefs.getBoolPref("accessibility.browsewithcaret"), s);
    // Leave it open (on Tabs) and restart.
    svc.open("tabs");
    await sleep(400);
    V.consoleCheck("before restart");
    await spike.restart();
    return;
  }

  // ---------------------------------------------------------------- run 2
  await waitFor(() => b.tabs.some((t) => t.title === "Restored page"), { timeout: 15000, what: "session restored" }).catch(() => null);
  await sleep(1200);
  const s = store.get();
  check("after the restart: the session came back", b.tabs.some((t) => t.title === "Restored page"), b.tabs.map((t) => t.title));
  check("the panel left open is not restored (no ghost layer, no panel-open)", !panel.isOpen && !b.root.classList.contains("panel-open") && (!V.root() || V.root().hidden));
  check("every setting survived", s.theme === "dark" && s.switcherStyle === "strip" && s.tabOrder === "bar" && s.closeButton === "always" && s.newTabPosition === "end" && s.selectionSearchOpens === "tab" && s.connections === 16 && s.speedLimitKBps === 512 && s.searchEngine === "brave" && s.rebind.switcherSearch === "Ctrl+Shift+K" && s.homeBackground.kind === "none", s);
  check("Firefox's side of them too: insertAfterCurrent off, caret browsing on", Services.prefs.getBoolPref("browser.tabs.insertAfterCurrent") === false && Services.prefs.getBoolPref("accessibility.browsewithcaret") === true);
  check("the window applied them at start: dark chrome, close buttons always", window.matchMedia("(prefers-color-scheme: dark)").matches && document.getElementById("vitre-bar").classList.contains("close-always"));
  check("the router has the rebind from the start", b.keys.bindings().filter((x) => x.action === "switcherSearch").map((x) => x.spec).join() === "Ctrl+Shift+K");
  let searched = 0;
  b.registerAction("switcherSearch", () => searched++);
  b.focusPage();
  await sleep(200);
  V.press("Ctrl+Shift+K");
  await sleep(500);
  V.press("Ctrl+Shift+A");
  await sleep(500);
  check("Ctrl+Shift+K runs Search tabs, Ctrl+Shift+A no longer does", searched === 1, { searched, log: b.keys.log.slice(-3) });
  b.editAddress("vitre");
  await sleep(300);
  const typed = b.omni.current && b.omni.current();
  check("the address field searches with Brave", typed && /search\.brave\.com/.test(typed.url), typed);
  b.omni.close();
  await sleep(200);

  svc.open("tabs");
  await sleep(900);
  const ddText = (title) => V.rowFor(title)?.querySelector(".vs-dd-label")?.textContent;
  check("the panel shows the stored values (Tabs)", V.content().querySelector('.vs-style[data-value="strip"]').getAttribute("aria-checked") === "true" && ddText("Order of tabs") === "Tab bar order" && ddText("Close button on tabs") === "Always" && ddText("New tabs open") === "At the end" && ddText("Searches from selected text") === "Open in a new tab", [ddText("Order of tabs"), ddText("Close button on tabs"), ddText("New tabs open")]);
  await spike.capture("restart-after-tabs");
  svc.open("shortcuts");
  await sleep(400);
  check("…and Keyboard shortcuts (the rebind with its Reset, caret browsing on)", V.root().querySelector('[data-rebind="switcherSearch"] .vs-keybtn').textContent === "Ctrl+Shift+K" && !V.root().querySelector('[data-rebind="switcherSearch"] .vs-link').hidden && V.rowFor("Caret browsing").querySelector(".vs-switch").getAttribute("aria-checked") === "true");
  // Reset all through the panel and put Firefox's prefs back.
  V.root().querySelector(".vs-headrow .vs-btn").click();
  await sleep(300);
  V.rowFor("Caret browsing").querySelector(".vs-switch").click();
  await sleep(200);
  panel.close();
  for (const k of ["theme", "switcherStyle", "tabOrder", "closeButton", "newTabPosition", "selectionSearchOpens", "connections", "speedLimitKBps", "searchEngine", "homeBackground.kind", "homeBackground.path"]) store.reset(k);
  await sleep(300);
  check("reset: rebinds gone, caret browsing off", Object.keys(store.get().rebind).length === 0 && !Services.prefs.getBoolPref("accessibility.browsewithcaret"));
  V.consoleCheck("after restart");
});
