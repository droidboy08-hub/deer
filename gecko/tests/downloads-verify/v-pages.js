// Pages and servers that misbehave, and light and dark pages under the surfaces.
//   - the quick view over a light page and over a dark page (captures against DownloadsPopover);
//   - a page that never finishes loading: the pill and Ctrl+Shift+D still work for its video;
//   - a server that never answers: the row reads "Starting", Pause and Cancel stop it at once and
//     close the connection;
//   - a transfer that stalls: the speed falls to nothing, no time left is promised, Pause stops it;
//   - odd answers: an empty file, a chunked one of unknown size (the ring turns indeterminate), a 404
//     (failed, readable, Retry), a name that tries to leave the folder, a UTF-8 filename*, a redirect.
/* global spike, Services, gBrowser, DL, V, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  const m = await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const edge = `http://127.0.0.1:${Services.env.get("VITRE_DLV_EDGE")}`;
  const edgeOpen = async () => (await (await fetch(edge + "/stats", { cache: "no-store" })).json()).open;
  const ringBtn = ui.ring.el.querySelector("button");

  // ---- light and dark pages ----
  const run = engine.start(DL.base + "/blob/big?rate=256", { filename: "photos-archive-2026.zip", named: true });
  const done = engine.start(DL.base + "/blob/medium", { filename: "field-notes-issue-14.pdf", named: true });
  await DL.until(done, ["completed"], { timeout: 30000 });
  await DL.until(run, ["downloading"], { test: (v) => v.received > 1 << 20, timeout: 30000 });
  for (const [name, url] of [["light", "/page.html"], ["dark", "/video-file.html"]]) {
    await DL.open(DL.base + url, { settle: 1200 });
    spike.click(ringBtn);
    await V.until(() => ui.ring.pop.isOpen, "the quick view");
    await sleep(700);
    const tint = getComputedStyle(b.root.querySelector(".vd-pop > .tint")).backgroundColor;
    log(name, "page: root", b.root.className, "popover tint", tint);
    check(`the quick view keeps its dark glass over a ${name} page (white text stays readable)`, /rgba\(22, 22, 26, 0\.(52|7)\)/.test(tint), tint);
    await V.capture(`v-pages-0${name === "light" ? 1 : 2}-${name}-quickview`);
    await V.key("Escape");
    await sleep(300);
  }

  // ---- a page that never finishes loading ----
  b.navigate(b.active().id, edge + "/hung-page");
  const ready = await V.until(
    async () => {
      if (!gBrowser.selectedBrowser.currentURI.spec.includes("hung-page")) return false;
      const r = await DL.frameScript(gBrowser.selectedBrowser, () => content.document.getElementById("v")?.readyState ?? -1);
      return r >= 1;
    },
    "the hung page's video",
    20000
  );
  await sleep(800);
  check("the page is still loading", b.active().loading === true && !!ready, b.active().loading);
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await V.until(() => ui.video.state.shown && ui.video.state.mode === "found", "the pill on a page that is still loading", 10000);
  check("the pill offers the video of a page that is still loading", true);
  await V.key("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "Ctrl+Shift+D on a page still loading");
  check("Ctrl+Shift+D opens the picker there", true);
  await V.capture("v-pages-03-hung-page-picker");
  await V.key("Escape");
  await sleep(300);
  b.run("stop");
  await sleep(400);

  // ---- a server that never answers ----
  engine.pause(run);
  const hung = engine.start(edge + "/hang", { filename: "hung.bin", named: true });
  await sleep(1500);
  let v = engine.get(hung);
  check("a server that never answers: the download is starting", v.state === "downloading" && v.phase === "probing", [v.state, v.phase]);
  spike.press("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel");
  await sleep(500);
  const status = b.root.querySelector(`.vd-row[data-id="${hung}"] .vd-status`)?.textContent;
  check("its row reads Starting", status === "Starting", status);
  await V.capture("v-pages-04-hung-server-row");
  let t0 = Date.now();
  engine.pause(hung);
  await engine.whenSettled(hung);
  check("Pause stops a hung request at once", Date.now() - t0 < 1500 && engine.get(hung).state === "paused", Date.now() - t0);
  await V.until(async () => (await edgeOpen()) === 0, "the hung connection to close", 5000).catch(() => null);
  check("... and closes its connection", (await edgeOpen()) === 0, await edgeOpen());
  engine.resume(hung);
  await sleep(1200);
  t0 = Date.now();
  engine.cancel(hung);
  await engine.whenSettled(hung);
  check("Cancel stops it at once too", Date.now() - t0 < 1500 && engine.get(hung).state === "cancelled", engine.get(hung).state);

  // ---- a transfer that stalls ----
  const st = engine.start(edge + "/stall", { filename: "stalled.bin", named: true });
  await DL.until(st, ["downloading"], { test: (x) => x.received >= 4 << 20, timeout: 20000, what: "the stall's first megabytes" });
  await sleep(4000);
  v = engine.get(st);
  check("a stalled transfer shows no speed", v.speed < 1024, v.speed);
  check("... and promises no time left", v.eta === -1, v.eta);
  const row = b.root.querySelector(`.vd-row[data-id="${st}"]`);
  check("its row shows a dash for speed and time", row?.querySelector(".speed")?.textContent === "—" && row?.querySelector(".time")?.textContent === "—", [row?.querySelector(".speed")?.textContent, row?.querySelector(".time")?.textContent]);
  t0 = Date.now();
  engine.pause(st);
  await engine.whenSettled(st);
  check("Pause stops a stalled transfer at once", Date.now() - t0 < 1500, Date.now() - t0);
  check("... keeping what arrived", engine.get(st).received >= 4 << 20, engine.get(st).received);
  await V.until(async () => (await edgeOpen()) === 0, "the stalled connections to close", 5000).catch(() => null);
  check("... and closing every connection", (await edgeOpen()) === 0, await edgeOpen());
  engine.cancel(st);

  // ---- odd answers ----
  const zero = engine.start(edge + "/zero");
  const zv = await DL.until(zero, ["completed", "failed"], { timeout: 20000 });
  check("an empty file completes", zv.state === "completed" && zv.filename === "empty.txt", [zv.state, zv.filename, zv.error]);
  check("... and is on disk, empty", (await IOUtils.stat(zv.path).catch(() => ({ size: -1 }))).size === 0);

  const ch = engine.start(edge + "/chunked", { filename: "unknown-size.bin", named: true });
  await DL.until(ch, ["downloading"], { test: (x) => x.received > 0 && !x.phase, timeout: 15000 });
  await sleep(300);
  check("a download of unknown size turns the ring indeterminate", ui.ring.el.classList.contains("indeterminate"));
  const cv = await DL.until(ch, ["completed", "failed"], { timeout: 30000 });
  check("the chunked file completes with its size", cv.state === "completed" && cv.total === 3 << 20, [cv.state, cv.total, cv.error]);

  const miss = engine.start(edge + "/missing", { filename: "press-kit.zip", named: true });
  const mv = await DL.until(miss, ["failed", "completed"], { timeout: 30000 });
  check("a 404 fails with a readable reason", mv.state === "failed" && /404|not found|isn’t there|no longer/i.test(mv.error), mv.error);
  await sleep(400);
  const mrow = b.root.querySelector(`.vd-row[data-id="${miss}"]`);
  check("its row shows the reason and offers Retry", !!mrow && mrow.querySelector(".s")?.textContent === mv.error && /Retry/.test(mrow.querySelector(".primary")?.getAttribute("aria-label") ?? ""), [mrow?.querySelector(".s")?.textContent, mrow?.querySelector(".primary")?.getAttribute("aria-label")]);

  const evil = engine.start(edge + "/evilname");
  const ev = await DL.until(evil, ["completed", "failed"], { timeout: 20000 });
  log("evil name ->", ev.filename, ev.path);
  check("a name that tries to leave the folder is kept inside it", ev.state === "completed" && PathUtils.parent(ev.path).toLowerCase() === DL.dir.toLowerCase() && !/[\\/:<>|?*"]/.test(ev.filename), [ev.filename, ev.path]);
  const uni = engine.start(edge + "/unicode");
  const uv = await DL.until(uni, ["completed", "failed"], { timeout: 20000 });
  check("an RFC 5987 UTF-8 filename* is used", uv.filename === "résumé — final.pdf", uv.filename);
  const red = engine.start(edge + "/redirect");
  const rv = await DL.until(red, ["completed", "failed"], { timeout: 30000 });
  check("a redirect is followed and the file is intact", rv.state === "completed" && (await DL.sha256(rv.path)) === m["medium.bin"].sha256, [rv.state, rv.filename]);
  await sleep(500);
  await V.capture("v-pages-05-odd-answers");

  // ---- two downloads with the same name at once ----
  const s1 = engine.start(DL.base + "/blob/medium?rate=4096", { filename: "same-name.bin", named: true });
  const s2 = engine.start(DL.base + "/blob/medium?rate=4096", { filename: "same-name.bin", named: true });
  const [v1, v2] = [await DL.until(s1, ["completed", "failed"], { timeout: 60000 }), await DL.until(s2, ["completed", "failed"], { timeout: 60000 })];
  check("two downloads with the same name at once get two files", v1.state === "completed" && v2.state === "completed" && v1.path !== v2.path && (await DL.sha256(v1.path)) === m["medium.bin"].sha256 && (await DL.sha256(v2.path)) === m["medium.bin"].sha256, [v1.filename, v2.filename]);

  // ---- a downloads folder that can't be made (a file stands where a folder should be) ----
  const blocker = PathUtils.join(DL.dir, "not-a-folder");
  await IOUtils.writeUTF8(blocker, "a file");
  b.sys("VitreSettings").set({ downloadsFolder: PathUtils.join(blocker, "inside") });
  await sleep(300);
  const nf = engine.start(DL.base + "/blob/medium", { filename: "nowhere.bin", named: true });
  const nv = await DL.until(nf, ["failed", "completed"], { timeout: 20000 });
  check("a downloads folder that can't be made fails with a readable reason", nv.state === "failed" && /downloads folder|write/i.test(nv.error), nv.error);
  b.sys("VitreSettings").set({ downloadsFolder: DL.dir });
  await sleep(300);

  // ---- the Connections setting is read live (Settings › Downloads) ----
  b.sys("VitreSettings").set({ connections: 3 });
  await sleep(300);
  const three = engine.start(DL.base + "/blob/big?rate=1024", { filename: "three-connections.bin", named: true });
  await DL.until(three, ["downloading"], { test: (x) => x.received > 6 << 20 && !x.phase, timeout: 30000 });
  await sleep(1000);
  const ti = engine.transferInfo(three);
  check("a new download uses the connections the setting asks for (3)", engine.get(three).maxConnections === 3 && ti.peakLive <= 3 && ti.live === 3, { max: engine.get(three).maxConnections, ti });
  engine.cancel(three);
  b.sys("VitreSettings").set({ connections: 8 });

  for (const x of engine.list()) engine.cancel(x.id);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
