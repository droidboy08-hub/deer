// Settings › Privacy › Clear browsing data through Firefox's Sanitizer: the last hour clears a fresh
// visit and a fresh cookie and keeps a visit from two days ago; All time clears that one too.
// Opened with Ctrl+Shift+Delete, driven by clicks.
//   node tools/build.mjs --out=build-settings --modules=settings
//   python tools/run.py --app build-settings --test tests/settings/clear.js --name settings-clear --timeout 200
// Captures: clear-before.png (Ctrl+Shift+Delete, cookies ticked), clear-done.png (the status line).
/* global spike, Services, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  await spike.resize(1440, 900);
  await spike.activate();
  store.set({ theme: "dark" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });
  const settle = (ms = 400) => sleep(ms);
  const { panel } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");

  // ---------------------------------------------------------------- data to clear
  const RECENT = "https://recent.vitre-test.example/";
  const OLD = "https://old.vitre-test.example/";
  await PlacesUtils.history.insert({ url: RECENT, title: "Visited just now", visits: [{ date: new Date() }] });
  await PlacesUtils.history.insert({ url: OLD, title: "Visited two days ago", visits: [{ date: new Date(Date.now() - 2 * 86400e3) }] });
  // nsICookieManager.add (expiry in ms in 157: devtools/server/actors/resources/storage/cookies.js addCookie).
  const cv = Services.cookies.add("recent.vitre-test.example", "/", "vx", "1", false, false, false, Date.now() + 86400e3, {}, Ci.nsICookie.SAMESITE_LAX, Ci.nsICookie.SCHEME_HTTPS);
  log("cookie add", cv && cv.result);
  // A closed tab for Ctrl+Shift+T.
  const page = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>Closed</title><body style='background:#f3eee4'><p style='margin:120px 40px'>A tab to close</p>");
  const t = b.newTab(page, { background: true });
  await waitFor(() => t.title === "Closed" && !t.loading, { timeout: 15000, what: "tab to close" });
  await settle(300);
  b.closeTab(t);
  await settle(500);
  const state = async () => ({
    recent: !!(await PlacesUtils.history.fetch(RECENT)),
    old: !!(await PlacesUtils.history.fetch(OLD)),
    cookies: Services.cookies.countCookiesFromHost("recent.vitre-test.example"),
    closed: b.closedCount(),
    open: b.tabs.length,
  });
  const before = await state();
  check("setup: a fresh visit, an old visit, a cookie and a closed tab", before.recent && before.old && before.cookies === 1 && before.closed >= 1, before);

  // ---------------------------------------------------------------- Ctrl+Shift+Delete, last hour
  b.focusPage();
  await settle(150);
  spike.press("Ctrl+Shift+Delete");
  await waitFor(() => panel.isOpen && root().querySelector(".vs-content").dataset.page === "privacy", { timeout: 3000, what: "privacy page" });
  await settle(300);
  const clearBox = () => root().querySelector(".vs-clear");
  const range = () => clearBox().querySelector(".vs-dd");
  check("the time range starts at Last hour", range().dataset.value === "hour" && /Last hour/.test(range().textContent), range().textContent);
  const box = (id) => clearBox().querySelector(`.vs-check[data-id="${id}"]`);
  check("history and cached files are ticked, cookies are not", box("history").getAttribute("aria-checked") === "true" && box("cache").getAttribute("aria-checked") === "true" && box("cookies").getAttribute("aria-checked") === "false");
  spike.click(box("cookies").closest(".vs-row"));
  await settle(200);
  check("a click on the row ticks Cookies and site data", box("cookies").getAttribute("aria-checked") === "true");
  await spike.capture("clear-before");
  const go = clearBox().querySelector('[data-action="clear-data"]');
  const status = clearBox().querySelector(".vs-status");
  const t0 = performance.now();
  spike.click(go);
  await waitFor(() => status.dataset.done, { timeout: 20000, what: "clearing" });
  const ms = Math.round(performance.now() - t0);
  await settle(300);
  const after = await state();
  check("Clear data (last hour) removed the fresh visit and the cookie and kept the old visit", !after.recent && after.old && after.cookies === 0, { after, ms });
  check("…emptied Ctrl+Shift+T's list and left the open tabs alone", after.closed === 0 && after.open === before.open, after);
  check("the status line says what was cleared", status.dataset.done !== "error" && status.textContent === "Cleared browsing history, cookies and cached files from the last hour.", status.textContent);
  await spike.capture("clear-done");

  // ---------------------------------------------------------------- All time
  spike.click(range());
  await waitFor(() => root().querySelector(".vs-pop"), { timeout: 2000, what: "range list" });
  spike.click([...root().querySelectorAll(".vs-opt")].find((o) => o.textContent === "All time"));
  await settle(300);
  check("the range list offers Chrome's spans", range().dataset.value === "all");
  spike.click(box("cookies").closest(".vs-row"));
  spike.click(box("cache").closest(".vs-row"));
  await settle(200);
  delete status.dataset.done;
  spike.click(go);
  await waitFor(() => status.dataset.done, { timeout: 20000, what: "clearing all" });
  await settle(300);
  const all = await state();
  check("All time with only Browsing history clears the old visit too", !all.old && !all.recent, all);
  check("the status names only history and no range", status.textContent === "Cleared browsing history.", status.textContent);
  spike.click(box("history").closest(".vs-row"));
  await settle(200);
  check("with nothing ticked the button is disabled", go.disabled);
  panel.close();
  store.reset("theme");
  await settle();
});
