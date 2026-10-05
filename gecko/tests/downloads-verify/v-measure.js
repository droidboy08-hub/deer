// Every surface measured against its board (sizes, radii, spacing, colours, copy), in a 1440x900 window:
//   Downloads (panel), DownloadsPopover (quick view), VideoDownload / VideoStates (pill), VideoPicker
//   (picker), Home (ring). A list like the boards': two running (one 8-connection), one queued, one
//   paused, one completed. Measures what the captures show, so a regression in the CSS fails here.
/* global spike, Services, gBrowser, DL, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const $ = (sel, root = b.root) => root.querySelector(sel);
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cs = (el) => getComputedStyle(el);
  const eq = (name, got, want) => check(`${name}: ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), got);

  await DL.open(DL.base + "/video.html", { settle: 1200 });
  const done = engine.start(DL.base + "/blob/medium", { filename: "field-notes-issue-14.pdf", named: true });
  await DL.until(done, ["completed"], { timeout: 30000 });
  const paused = engine.start(DL.base + "/blob/big?rate=512", { filename: "dataset-2026-q3.csv.gz", named: true });
  await DL.until(paused, ["downloading"], { test: (v) => v.received > 8 << 20, timeout: 30000 });
  engine.pause(paused);
  await engine.whenSettled(paused);
  const a = engine.start(DL.base + "/blob/big?rate=1024", { filename: "float-line-tour-4k.mp4", named: true });
  const c = engine.start(DL.base + "/blob/big?rate=256", { filename: "photos-archive-2026.zip", named: true });
  const q = engine.start(DL.base + "/blob/medium?rate=64", { filename: "vitre-setup-0.3.0.exe", named: true });
  await DL.until(a, ["downloading"], { test: (v) => v.received > 8 << 20 && !v.phase, timeout: 30000 });
  await DL.until(c, ["downloading"], { test: (v) => !v.phase, timeout: 30000 });

  // ---- the panel (board Downloads) ----
  spike.press("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel");
  await sleep(600);
  spike.click($(`.vd-row[data-id="${a}"] .vd-name`));
  await sleep(700);
  const panel = $(".vd-panel");
  eq("panel size", [box(panel).w, box(panel).h], [960, 688]);
  eq("panel radius", cs(panel).borderTopLeftRadius, "22px");
  eq("panel tint", cs($(".vd-panel > .tint")).backgroundColor, "rgba(20, 20, 24, 0.62)");
  eq("scrim", cs($(".vd-scrim")).backgroundColor, "rgba(8, 8, 12, 0.3)");
  eq("title bar height", box($(".vd-head")).h, 48);
  eq("title", [$(".vd-head h2").textContent, cs($(".vd-head h2")).fontSize, cs($(".vd-head h2")).fontWeight], ["Downloads", "14px", "600"]);
  eq("close button", [box($(".vd-close")).w, box($(".vd-close")).h, cs($(".vd-close")).borderTopLeftRadius], [30, 30, "15px"]);
  eq("sidebar width", box($(".vd-nav")).w, 216);
  eq("search field", [box($(".vd-search")).h, cs($(".vd-search")).borderTopLeftRadius, $(".vd-search input").placeholder], [34, "8px", "Search downloads"]);
  const filter = $('.vd-filter[data-filter="all"]');
  eq("filter row", [box(filter).h, cs(filter).borderTopLeftRadius, cs(filter).fontSize], [34, "6px", "13.5px"]);
  eq("current filter", cs(filter).backgroundColor, "rgba(255, 255, 255, 0.1)");
  eq("other filter text", cs($('.vd-filter[data-filter="queued"]')).color, "rgba(255, 255, 255, 0.88)");
  eq("filters", [...b.root.querySelectorAll(".vd-filter .label")].map((x) => x.textContent).slice(0, 5), ["All", "Downloading", "Queued", "Paused", "Completed"]);
  eq("categories caption", $(".vd-nav-head").textContent, "Categories");
  eq("summary", /^2 downloading at [\d.]+ MB\/s · 1 queued · 1 paused$/.test($(".vd-summary").textContent), true);
  const add = $(".vd-add-btn");
  eq("Add link", [add.textContent, box(add).h, cs(add).backgroundColor, cs(add).color, cs(add).fontWeight], ["Add link", 32, "rgb(76, 194, 255)", "rgb(4, 18, 26)", "600"]);
  eq("Pause all / speed limit", [$(".vd-pause-all").textContent, $(".vd-limit").textContent], ["Pause all", "No speed limit"]);
  eq("columns", [...b.root.querySelectorAll(".vd-cols span")].map((x) => x.textContent), ["", "Name", "Progress", "Speed", "Time", ""]);
  eq("column header height", box($(".vd-cols")).h, 28);
  const row = $(`.vd-row[data-id="${a}"]`);
  eq("row height and radius", [box(row).h, cs(row).borderTopLeftRadius], [50, "8px"]);
  eq("selected row", cs(row).backgroundColor, "rgba(255, 255, 255, 0.1)");
  eq("grid columns", cs(row).gridTemplateColumns.split(" ").map((x) => Math.round(parseFloat(x))).filter((x, i) => i !== 1), [32, 150, 76, 60, 64]);
  eq("file tile", [box($(".vd-tile", row)).w, box($(".vd-tile", row)).h, $(".vd-tile", row).textContent, cs($(".vd-tile", row)).fontSize], [32, 32, "MP4", "9.5px"]);
  eq("name / size line", [$(".n", row).textContent, $(".s", row).textContent, cs($(".n", row)).fontSize, cs($(".s", row)).fontSize], ["float-line-tour-4k.mp4", "256 MB · Video", "13.5px", "12px"]);
  eq("progress bar", [box($(".vd-bar", row)).h, cs($(".vd-bar > i", row)).backgroundColor], [6, "rgb(76, 194, 255)"]);
  eq("row buttons", [box($(".primary", row)).w, box($(".more", row)).w, $(".primary", row).getAttribute("aria-label")], [28, 28, "Pause float-line-tour-4k.mp4"]);
  const qrow = $(`.vd-row[data-id="${q}"]`);
  eq("queued row", [$(".vd-status", qrow).textContent, $(".time", qrow).textContent, $(".primary", qrow).getAttribute("aria-label")], ["Queued", "Next", "Start now vitre-setup-0.3.0.exe"]);
  const prow = $(`.vd-row[data-id="${paused}"]`);
  eq("paused row", [$(".speed", prow).textContent, $(".time", prow).textContent, cs($(".vd-bar > i", prow)).backgroundColor], ["Paused", "—", "rgba(255, 255, 255, 0.45)"]);
  const drow = $(`.vd-row[data-id="${done}"]`);
  eq("completed row", [$(".vd-status", drow).textContent, $(".primary", drow).getAttribute("aria-label")], ["Completed", "Show in folder field-notes-issue-14.pdf"]);
  const det = $(".vd-details");
  eq("details", [cs(det).paddingTop, cs(det).paddingLeft, cs(det).borderTopLeftRadius, cs(det).gridTemplateColumns.split(" ")[0]], ["14px", "18px", "10px", "270px"]);
  eq("details captions", [$(".vd-d-title").textContent, /^8 of 8 active · Resumable$/.test($(".vd-d-cap").textContent), $(".vd-d-note").textContent], ["Connections", true, "Each block is one part of the file, fetched in parallel"]);
  eq("connection blocks", [b.root.querySelectorAll(".vd-segs > span").length, box($(".vd-segs > span")).h], [8, 16]);
  eq("facts", [...b.root.querySelectorAll(".vd-facts .k")].map((x) => x.textContent), ["Address", "Saved to", "From page", "Started"]);
  eq("detail actions", [...b.root.querySelectorAll(".vd-d-btn")].map((x) => x.textContent), ["Pause", "Limit speed", "Show in folder", "Cancel"]);
  eq("Cancel is the danger button", cs($(".vd-d-btn.danger")).color, "rgb(255, 153, 164)");
  eq("detail button height", box($(".vd-d-btn")).h, 30);
  spike.press("Escape");
  await sleep(500);

  // ---- the ring and the quick view (boards Home, DownloadsPopover) ----
  const ring = ui.ring.el;
  eq("ring", [box(ring).w, box(ring).h, innerWidth - box(ring).x - box(ring).w, innerHeight - box(ring).y - box(ring).h], [44, 44, 72, 20]);
  spike.click(ring.querySelector("button"));
  await V.until(() => ui.ring.pop.isOpen, "the quick view");
  await sleep(600);
  const pop = $(".vd-pop");
  eq("quick view", [box(pop).w, innerWidth - box(pop).x - box(pop).w, innerHeight - box(pop).y - box(pop).h, cs(pop).borderTopLeftRadius], [360, 20, 76, "20px"]);
  eq("quick view head", [$(".vd-pop-head b").textContent, /^3 active · [\d.]+ MB\/s$/.test($(".vd-pop-head span").textContent)], ["Downloads", true]);
  const prowA = $(`.vd-pop-row[data-id="${a}"]`);
  eq("quick view running row", [box(prowA).h, /^\d+ MB of 256 MB · [\d.]+ MB\/s · .+ left$/.test($(".vd-pop-meta", prowA).textContent), box($(".vd-round", prowA)).w], [68, true, 28]);
  eq("quick view segments", [prowA.querySelectorAll(".vd-pop-segs > span").length, box($(".vd-pop-segs", prowA)).h], [8, 5]);
  eq("Open Downloads", [$(".vd-pop-open").textContent, box($(".vd-pop-open")).h, cs($(".vd-pop-open")).borderTopLeftRadius], ["Open Downloads", 36, "10px"]);
  spike.press("Escape");
  await sleep(400);

  // ---- the pill and the picker (VideoDownload, VideoStates, VideoPicker) ----
  await DL.hoverInPage("#v", { dx: 0.45, dy: 0.5 });
  await V.until(() => ui.video.state.shown && ui.video.state.mode === "found", "the pill");
  await sleep(300);
  const pill = $(".vd-pill");
  eq("pill (found)", [box(pill).w, box(pill).h, cs(pill).borderTopLeftRadius], [168, 36, "18px"]);
  eq("pill copy", [$(".vd-pill-main").textContent, cs($(".vd-pill-main")).fontWeight, cs($(".vd-pill-main .q")).color], ["Download360p", "600", "rgba(255, 255, 255, 0.78)"]);
  spike.click($(".vd-pill-main"));
  await V.until(() => ui.video.picker.isOpen, "the picker");
  await sleep(500);
  const pk = ui.video.picker.element;
  eq("picker", [box(pk).w, cs(pk).borderTopLeftRadius, box(pk).y - (box(pill).y + 36), box(pk).x + box(pk).w - (box(pill).x + box(pill).w)], [340, "18px", 8, 0]);
  eq("picker tint", cs($(".vd-picker > .tint")).backgroundColor, "rgba(22, 22, 26, 0.62)");
  eq("picker head", [box($(".vd-pick-head")).h, $(".vd-pick-title").textContent, $(".vd-pick-sub").textContent], [36, "Molten: a 4K study of glass in motion", "127.0.0.1 · 0:24"]);
  const opt = $('.vd-opt[aria-checked="true"]');
  eq("quality row", [box(opt).h, cs(opt).borderTopLeftRadius, cs(opt).backgroundColor, $(".det", opt).textContent], [36, "10px", "rgba(255, 255, 255, 0.12)", "Best for this screen"]);
  eq("radio", [box($(".vd-radio", opt)).w, cs($(".vd-radio", opt)).backgroundColor], [16, "rgb(76, 194, 255)"]);
  eq("group label", [$(".vd-group").textContent, cs($(".vd-group")).fontSize], ["Video · MP4", "12px"]);
  eq("Save to row", [box($(".vd-saveto")).h, $(".vd-saveto .k").textContent, $(".vd-change").textContent, cs($(".vd-change")).color], [32, "Save to", "Change", "rgb(159, 227, 255)"]);
  eq("Download button", [box($(".vd-go")).h, cs($(".vd-go")).backgroundColor, cs($(".vd-go")).color, /^Download 360p · [\d.]+ MB$/.test($(".vd-go").textContent)], [38, "rgb(76, 194, 255)", "rgb(4, 18, 26)", true]);
  await V.capture("v-measure-01-picker");
  ui.video.picker.close(false);
  await sleep(300);

  for (const v of engine.list()) engine.cancel(v.id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
