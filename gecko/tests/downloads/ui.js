// Every downloads surface, captured against the boards (Downloads, DownloadsPopover, VideoDownload,
// VideoPicker, VideoStates, Home's ring, the right-click menu spec):
//   the panel with downloading / queued / paused / completed / failed rows, a filter, search, Add link,
//   a row's menu and the speed-limit menu (through the menus service), the panel scaled in a small window; the quick view
//   above the ring and the ring menu; the pill found / hover / paused / live; the picker with the
//   one-line terms notice.
// RESUME-DESIGN.md 6 (Phase 3), the rows that need the person: Link expired, Waiting for link, File
//   changed and Start it again from its page, in the design's words (statuses, captions, buttons, the
//   toolbar's "need attention", the ring's dot and label, the quick view); their aria labels; Space on
//   each, which never destroys bytes; and every row's menu with access keys unique within it.
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

  // ---- RESUME-DESIGN.md 6 (Phase 3): rows that need the person ----
  const settledV = (id, what) =>
    waitFor(
      () => {
        const v = engine.get(id);
        return v && !engine.transferInfo(id) && v.phase !== "renewing" && ["paused", "failed", "completed", "cancelled"].includes(v.state) ? v : null;
      },
      { timeout: 60000, interval: 100, what }
    );
  const pauseNear = async (id, bytes) => {
    await DL.until(id, ["downloading", "paused", "failed", "completed"], { test: (v) => v.state !== "downloading" || v.received > bytes, timeout: 30000 });
    if (engine.get(id).state === "downloading") engine.pause(id);
    return settledV(id, "the pause");
  };
  // Link expired: a clicked signed download whose address expired during a pause.
  await DL.reset();
  const page = `${DL.base}/attach.html?k=ui1&ttl=5&name=field-recording.mp3&rate=512`;
  await DL.open(page);
  let n = engine.takeovers.length;
  await DL.clickInPage("#dl");
  const lx = (await waitFor(() => engine.takeovers.slice(n).find((t) => t.action === "taken over"), { timeout: 20000, what: "the take-over" })).id;
  const lp = await pauseNear(lx, 2 << 20);
  const signed = (await DL.stats()).requests.find((r) => r.path.startsWith("/qsigned/"));
  const expires = Number(/Expires=(\d+)/.exec(signed?.path ?? "")?.[1] ?? 0) * 1000;
  await waitFor(() => Date.now() > expires + 300, { timeout: 20000, what: "the address to expire" });
  const lsha = await DL.sha256(lp.path + ".part");
  engine.resume(lx);
  await settledV(lx, "Link expired");
  // File changed: the file swapped on the server during a pause.
  const fc = engine.start(`${DL.base}/swap/medium?val=etag&k=ui-fc&rate=512`, { filename: "mixtape.bin", named: true });
  const fp = await pauseNear(fc, 2 << 20);
  await fetch(`${DL.base}/flag?k=ui-fc`, { cache: "no-store" });
  engine.resume(fc);
  await settledV(fc, "File changed");
  const fsha = await DL.sha256(fp.path + ".part");
  // Start it again from its page: a one-time link Firefox moves, cancelled, then Retry.
  n = engine.takeovers.length;
  await DL.clickInPage("#once");
  const pg = (await waitFor(() => engine.takeovers.slice(n).find((t) => /^left: probe/.test(t.action)), { timeout: 20000, what: "the one-time link left to Firefox" })).id;
  await DL.until(pg, ["downloading"], { timeout: 10000 });
  engine.cancel(pg);
  await DL.until(pg, ["cancelled"], { timeout: 10000 });
  engine.resume(pg);
  const pv = await DL.until(pg, ["paused", "failed"], { timeout: 10000 });
  check("Retry on a download Firefox moved asks for its page instead of fetching it again (need 'page')", pv.state === "paused" && pv.need?.kind === "page" && pv.engine === "browser", [pv.state, pv.need, pv.engine]);

  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(500);
  const prow = (id) => b.root.querySelector(`.vd-row[data-id="${id}"]`);
  const details = () => b.root.querySelector(".vd-details");
  const acts = () => Array.from(details().querySelectorAll("[data-act]")).map((x) => x.textContent);
  const pick = async (id) => {
    prow(id).scrollIntoView({ block: "nearest" });
    spike.click(prow(id).querySelector(".vd-name"));
    await sleep(500);
  };
  const summary2 = b.root.querySelector(".vd-summary").textContent;
  const ringBtn = ui.ring.el.querySelector("button");
  check("the toolbar says how many rows need the person: '3 need attention'", /(^| · )3 need attention$/.test(summary2), summary2);
  check("the ring shows its 8 px dot and says 'Downloads, 3 need attention'", ui.ring.el.classList.contains("attention") && getComputedStyle(ui.ring.el.querySelector(".vd-ring-dot")).display === "block" && Math.round(ui.ring.el.querySelector(".vd-ring-dot").getBoundingClientRect().width) === 8 && ringBtn.getAttribute("aria-label").startsWith("Downloads, 3 need attention"), ringBtn.getAttribute("aria-label"));

  await pick(lx);
  check("Link expired: its status, its row's label, and Refresh address as its verb", prow(lx).querySelector(".vd-status").textContent === "Link expired" && /^field-recording\.mp3, Link expired, \d+ percent saved$/.test(prow(lx).getAttribute("aria-label")) && prow(lx).querySelector(".primary").getAttribute("aria-label") === "Refresh address field-recording.mp3", [prow(lx).getAttribute("aria-label"), prow(lx).querySelector(".primary").getAttribute("aria-label")]);
  check("Link expired details: Refresh address · Use another address… · Open page · Show in folder · Cancel", acts().join("|") === "Refresh address|Use another address…|Open page|Show in folder|Cancel" && /^The link stopped working \(403\) · \d+% is saved · next try /.test(details().querySelector(".vd-d-cap").textContent) && details().querySelector(".vd-page").textContent.startsWith("127.0.0.1"), { acts: acts(), cap: details().querySelector(".vd-d-cap").textContent });
  await spike.capture("ui-15-link-expired");
  // Space: Refresh address, which opens the page and arms the row; nothing saved is touched.
  const tabs2 = b.tabs.length;
  prow(lx).focus();
  spike.press("Space");
  await waitFor(() => b.tabs.length > tabs2 && engine.get(lx).armed, { timeout: 15000, what: "Refresh address from Space" });
  check("Space on Link expired runs Refresh address: the page opens and the row waits, its bytes untouched", !ui.panel.open && (await DL.sha256(lp.path + ".part")) === lsha && engine.get(lx).state === "paused", engine.get(lx));
  await sleep(600);
  await spike.capture("ui-16-waiting-note");
  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(400);
  await pick(lx);
  check("Waiting for link: its status, its sub-line, its label and Open page as its verb", prow(lx).querySelector(".vd-status").textContent === "Waiting for link" && prow(lx).querySelector(".vd-name .s").textContent === "Start it again on 127.0.0.1" && /^field-recording\.mp3, Waiting for link, \d+ percent saved$/.test(prow(lx).getAttribute("aria-label")) && prow(lx).querySelector(".primary").getAttribute("aria-label") === "Open page field-recording.mp3", [prow(lx).querySelector(".vd-name .s").textContent, prow(lx).getAttribute("aria-label")]);
  check("Waiting for link details: Open page · Stop waiting · Use another address… · Cancel", acts().join("|") === "Open page|Stop waiting|Use another address…|Cancel" && /^Start it again on 127\.0\.0\.1\. Deer continues from \d+%\.$/.test(details().querySelector(".vd-d-cap").textContent), { acts: acts(), cap: details().querySelector(".vd-d-cap").textContent });
  await spike.capture("ui-17-waiting-for-link");
  spike.click(details().querySelector('[data-act="stop-waiting"]'));
  await waitFor(() => !engine.get(lx).armed, { timeout: 5000, what: "Stop waiting" });
  await sleep(300);
  check("Stop waiting: Link expired again", prow(lx).querySelector(".vd-status").textContent === "Link expired");

  await pick(fc);
  const fcButtons = Array.from(details().querySelectorAll('[data-act="start-over"], [data-act="keep-partial"]'));
  check("File changed: its status and its choices, each described by the caption", prow(fc).querySelector(".vd-status").textContent === "File changed" && acts().join("|") === "Start over with the new file|Keep partial file|Show in folder" && fcButtons.length === 2 && fcButtons.every((x) => x.getAttribute("aria-describedby") === "vd-d-cap") && /Keep partial saves the first [\d.]+ (KB|MB) as mixtape \(partial\)\.bin\.$/.test(details().querySelector(".vd-d-note").textContent), { acts: acts(), note: details().querySelector(".vd-d-note").textContent });
  await spike.capture("ui-18-file-changed");
  prow(fc).focus();
  spike.press("Space");
  await sleep(400);
  check("Space on File changed only moves focus to Start over: nothing runs, the part is untouched", document.activeElement?.dataset?.act === "start-over" && !engine.transferInfo(fc) && engine.get(fc).need?.kind === "choice" && (await DL.sha256(fp.path + ".part")) === fsha, document.activeElement?.textContent);

  await pick(pg);
  check("Start it again from its page: its status, its caption, Open page", prow(pg).querySelector(".vd-status").textContent === "Start it again from its page" && details().querySelector(".vd-d-cap").textContent === "Start it again from its page: the site gives it only to its page’s own request." && acts().join("|") === "Open page|Copy address|Remove from list" && prow(pg).querySelector(".primary").getAttribute("aria-label") === "Open page once.bin", { cap: details().querySelector(".vd-d-cap").textContent, acts: acts() });
  await spike.capture("ui-19-start-again");

  // Every row's menu: access keys unique within it, each a letter of its label.
  const menusApi = b.service("menus");
  const show = menusApi.show;
  let shown = null;
  menusApi.show = function (items, ...rest) {
    shown = items;
    return show.call(this, items, ...rest);
  };
  const bad = [];
  for (const v of ui.store.all()) {
    const r = prow(v.id);
    if (!r) continue;
    shown = null;
    ui.panel.rowMenu(v.id, { x: 400, y: 300 }, true, r);
    await sleep(150);
    const items = (shown ?? []).filter((x) => !x.separator);
    const keys = items.map((x) => (x.access ?? "").toLowerCase()).filter(Boolean);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    const stray = items.filter((x) => x.access && !x.label.toLowerCase().includes(x.access.toLowerCase())).map((x) => x.label);
    if (!items.length || dup.length || stray.length) bad.push({ name: v.filename, state: v.need?.kind ?? v.state, labels: items.map((x) => `${x.label}(${x.access ?? ""})`), dup, stray });
    menusApi.close();
    await sleep(100);
  }
  menusApi.show = show;
  check("every row's menu has access keys unique within it, each a letter of its label", !bad.length, bad);

  // The quick view: the same verbs.
  spike.press("Escape");
  await waitFor(() => !ui.panel.open, { what: "the panel to close" });
  spike.click(ui.ring.el.querySelector("button"));
  await waitFor(() => ui.ring.pop.isOpen, { what: "the quick view" });
  await sleep(500);
  const popLabels = Array.from(b.root.querySelectorAll(".vd-pop-row .vd-round")).map((x) => x.getAttribute("aria-label"));
  check("the quick view's buttons: Open page, Choose, Refresh address", popLabels.includes("Open page once.bin") && popLabels.includes("Choose mixtape.bin") && popLabels.includes("Refresh address field-recording.mp3"), popLabels);
  await spike.capture("ui-20-popover-attention");
  spike.press("Escape");
  await sleep(300);
  // Space on Start it again from its page opens the page; the row stays as it was.
  spike.press("Ctrl+J");
  await waitFor(() => ui.panel.open, { what: "the panel" });
  await sleep(400);
  await pick(pg);
  const tabs3 = b.tabs.length;
  prow(pg).focus();
  spike.press("Space");
  await waitFor(() => b.tabs.length > tabs3, { timeout: 10000, what: "Open page from Space" });
  check("Space on Start it again from its page opens its page; the row still asks", b.active().url === page && engine.get(pg).need?.kind === "page", b.active().url);

  for (const id of [lx, fc]) engine.cancel(id);
  engine.remove(pg);
  log("done");
});
