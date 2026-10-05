// The active pill's download mark always answers a click:
//   1. a page whose player loaded a stream Vitre cannot read: the mark lights, and a click says
//      "Can't save this video" under the pill (it used to do nothing);
//   2. a page whose <video> has no address of its own (an MSE player) but loaded a DASH manifest:
//      a click opens the picker with what the page loaded.
/* global spike, Services, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, waitFor, sleep } = spike;
  await DL.init();
  await spike.resize(1280, 860);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const mark = () => b.bar.downloadMark();

  // ---- 1. nothing readable ----
  await DL.open(DL.base + "/video-bad.html", { settle: 1200 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the download mark" });
  check("the mark lights for the stream the player loaded", !mark().classList.contains("empty"));
  spike.click(mark());
  const note = await waitFor(() => b.root.querySelector(".vd-note"), { timeout: 8000, what: "the note" });
  check("a click says it can't save this video", /Can’t save this video/.test(note.textContent), note.textContent);
  check("no picker opens", !ui.video.picker.isOpen);
  const pill = b.bar.layout.pillRect;
  const r = note.getBoundingClientRect();
  check("the note hangs under the tab pill", Math.abs(r.left + r.width / 2 - (pill.left + pill.width / 2)) < 2 && r.top >= pill.bottom, [r.left, r.top, r.width, pill.left, pill.bottom]);
  await spike.capture("mark-1-note");
  await sleep(3800);
  check("the note goes away by itself", !b.root.querySelector(".vd-note"));

  // ---- 2. the element has no address, the page loaded a manifest ----
  await DL.open(DL.base + "/video-dash.html", { settle: 1500 });
  await waitFor(() => !mark()?.classList.contains("empty"), { timeout: 8000, what: "the download mark (DASH)" });
  spike.click(mark());
  await waitFor(() => ui.video.picker.isOpen, { timeout: 10000, what: "the picker" });
  check("a click opens the picker with what the page loaded", ui.video.picker.isOpen && !b.root.querySelector(".vd-note"));
  await spike.capture("mark-2-picker");
});
