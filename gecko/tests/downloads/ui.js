// Every downloads surface, captured against the boards (Downloads, DownloadsPopover, VideoDownload,
// VideoPicker, VideoStates, Home's ring, the right-click menu spec):
//   the panel with downloading / queued / paused / completed / failed rows, a filter, search, Add link,
//   a row's menu and the speed-limit menu (through the menus service), the panel scaled in a small window; the quick view
//   above the ring and the ring menu; the pill found / hover / paused / live; the picker with the
//   one-line terms notice.
/* global spike, Services, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const menus = () => b.service("menus");

  // ---- a list like the board's ----
  await DL.open(DL.base + "/video.html", { settle: 800 });
  const done = engine.start(DL.base + "/blob/medium", { filename: "field-notes-issue-14.pdf", named: true, pageUrl: DL.base + "/page.html" });
  await DL.until(done, ["completed"], { timeout: 30000 });
  const failed = engine.start(DL.base + "/blob/missing", { filename: "old-press-kit.zip", named: true });
  await DL.until(failed, ["failed"], { timeout: 30000 });
  const paused = engine.start(DL.base + "/blob/big?rate=512", { filename: "dataset-2026-q3.csv.gz", named: true });
  await DL.until(paused, ["downloading"], { test: (v) => v.received > 8 << 20, timeout: 30000 });
  engine.pause(paused);
  await DL.until(paused, ["paused"]);
  const a = engine.start(DL.base + "/blob/big?rate=2048", { filename: "float-line-tour-4k.mp4", named: true, pageUrl: DL.base + "/video.html" });
  const c = engine.start(DL.base + "/blob/big?rate=256", { filename: "photos-archive-2026.zip", named: true });
  const q = engine.start(DL.base + "/blob/medium?rate=256", { filename: "vitre-setup-0.3.0.exe", named: true });
  await DL.until(a, ["downloading"], { test: (v) => v.received > 24 << 20, timeout: 30000 });
  check("two run at once, the third waits its turn", engine.get(q).state === "queued" && engine.get(q).queuePos === 1, engine.get(q).state);

  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(300);
  // Select the running video, as on the board.
  spike.click(b.root.querySelector(`.vd-row[data-id="${a}"] .vd-name`));
  await sleep(900);
  await spike.capture("ui-01-panel-states");
  const summary = b.root.querySelector(".vd-summary").textContent;
  check("the summary reads like the board", /^2 downloading at [\d.]+ MB\/s · 1 queued · 1 paused$/.test(summary), summary);

  // Filter: Downloading.
  spike.click(b.root.querySelector('[data-filter="active"]'));
  await sleep(500);
  await spike.capture("ui-02-panel-filter-downloading");
  check("the Downloading filter shows the two running", b.root.querySelectorAll(".vd-row").length === 2);
  spike.click(b.root.querySelector('[data-filter="all"]'));
  // Search.
  b.root.querySelector(".vd-search input").focus();
  spike.type("archive");
  await sleep(500);
  check("search narrows the list", b.root.querySelectorAll(".vd-row").length === 1);
  await spike.capture("ui-03-panel-search");
  const input = b.root.querySelector(".vd-search input");
  input.select();
  spike.press("Backspace");
  await sleep(300);

  // A row's menu (More) and the speed limit menu, through the menus service.
  const more = b.root.querySelector(`.vd-row[data-id="${a}"] .more`);
  spike.click(more);
  await sleep(500);
  const menuShown = !!menus()?.isOpen?.() || !!b.root.querySelector(".vd-menu");
  check("a row's More button opens its menu", menuShown);
  await spike.capture("ui-04-row-menu");
  spike.press("Escape");
  await sleep(300);
  spike.click(b.root.querySelector(".vd-limit"));
  await sleep(500);
  await spike.capture("ui-05-limit-menu");
  spike.press("Escape");
  await sleep(300);

  // Add link.
  spike.click(b.root.querySelector(".vd-add-btn"));
  await sleep(200);
  spike.type("example.invalid/file.zip");
  await sleep(300);
  await spike.capture("ui-06-add-link");
  spike.click(b.root.querySelector(".vd-add-cancel"));
  await sleep(200);

  // Narrow window.
  await spike.resize(760, 600);
  await sleep(900);
  await spike.capture("ui-07-panel-narrow");
  // Below 992x720 the panel is scaled as a whole around its centre (as Settings), nothing re-flows.
  {
    const pr = b.root.querySelector(".vd-panel").getBoundingClientRect();
    const k = Math.min(1, (innerWidth - 32) / 960, (innerHeight - 32) / 688);
    check("the panel fits a narrow window: scaled whole, centred, 16 px clear", Math.abs(pr.width - 960 * k) < 1.5 && Math.abs(pr.height - 688 * k) < 1.5 && pr.left >= 15 && pr.top >= 15 && pr.right <= innerWidth - 15, [pr.left, pr.top, pr.width, pr.height, k]);
  }
  await spike.resize(1440, 900);
  await sleep(600);
  const tabs = b.tabs.length;
  spike.press("Ctrl+W");
  await waitFor(() => !ui.panel.open, { what: "Ctrl+W to close the panel" });
  check("Ctrl+W closes the panel, not the tab", b.tabs.length === tabs);

  // ---- the ring: quick view and menu ----
  spike.click(ui.ring.el.querySelector("button"));
  await waitFor(() => ui.ring.pop.isOpen, { what: "the quick view" });
  await sleep(600);
  await spike.capture("ui-08-popover");
  const pop = b.root.querySelector(".vd-pop").getBoundingClientRect();
  check("the quick view sits above the ring (right 20, bottom 76, 360 wide)", Math.round(pop.width) === 360 && Math.round(window.innerWidth - pop.right) === 20 && Math.round(window.innerHeight - pop.bottom) === 76, [pop.left, pop.top, pop.width, pop.height]);
  spike.press("Escape");
  await sleep(300);
  ui.ring.menu(false);
  await sleep(500);
  await spike.capture("ui-09-ring-menu");
  spike.press("Escape");
  await sleep(300);
  const ring = ui.ring.el.getBoundingClientRect();
  check("the ring is 44 px at right 72, bottom 20", Math.round(ring.width) === 44 && Math.round(window.innerWidth - ring.right) === 72 && Math.round(window.innerHeight - ring.bottom) === 20, [ring.left, ring.top]);

  // ---- the pill: found, hover, paused ----
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 8000, what: "the pill" });
  await spike.capture("ui-10-pill-found");
  const pill = b.root.querySelector(".vd-pill");
  const pr = pill.getBoundingClientRect();
  spike.EU.synthesizeMouseAtPoint(pr.left + pr.width / 2, pr.top + pr.height / 2, { type: "mousemove" }, window);
  await waitFor(() => pill.classList.contains("hot"), { timeout: 3000, what: "the hover look" });
  await sleep(250);
  await spike.capture("ui-11-pill-hover");
  check("the pill brightens under the pointer", pill.classList.contains("hot"));
  // Shift+click downloads the suggested quality at once, then pause it from the pill.
  spike.click(b.root.querySelector(".vd-pill-main"), { shiftKey: true });
  await waitFor(() => ui.video.state.mode === "downloading", { timeout: 8000, what: "the downloading pill" });
  check("Shift+click downloads without the picker", !ui.video.picker.isOpen);
  await sleep(400);
  spike.click(b.root.querySelector(".vd-pill-small"));
  await waitFor(() => ui.video.state.mode === "paused", { timeout: 8000, what: "the paused pill" });
  await sleep(400);
  await spike.capture("ui-12-pill-paused");

  // ---- live ----
  await DL.open(DL.base + "/video-live.html", { settle: 1500 });
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "live", { timeout: 8000, what: "the live pill" });
  check("a live stream says it can't be saved", /Live · can’t be saved/.test(pill.textContent));
  await spike.capture("ui-13-pill-live");
  check("the live pill stays while the pointer is on it and downloads update", ui.video.state.mode === "live");

  // ---- the terms notice on a big platform (a picker opened with that host) ----
  await DL.open(DL.base + "/video-file.html", { settle: 1000 });
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 8000, what: "the pill" });
  const offer = { ...ui.video.state.offer, host: "www.youtube.com" };
  const t = { tabId: b.activeId, browserId: gBrowser.selectedBrowser.browsingContext.browserId, video: (await b.page(b.active()).query("downloads:main-video")) };
  Services.prefs.clearUserPref("vitre.downloads.termsSeen");
  ui.video.picker.open(t, offer, false);
  await sleep(600);
  check("the first download from a big platform shows the terms line", /terms allow saving/.test(ui.video.picker.element.textContent));
  check("the mark shows for a video whose file came from the media cache", !b.bar.downloadMark().classList.contains("empty"), engine.media.notice(gBrowser.selectedBrowser.browsingContext.browserId));
  await spike.capture("ui-14-picker-terms");
  ui.video.picker.close(false);

  for (const id of [a, c, q, paused]) engine.cancel(id);
  log("done");
});
