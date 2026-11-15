// macOS One row: the Grid switcher's search field takes the row's place (a 36 px capsule at top 8,
// radius 18, centred, the cards from y 52), follows --vitre-row-shift in full screen, stays clear of the
// traffic lights in a narrow window and, in a private window, of the row's Private capsule.
//   python3 tools/run.py --test tests/switcher/mac-grid.js --name mac-grid --timeout 150
//   python3 tools/run.py --test tests/switcher/mac-grid.js --name mac-grid-private --arg=-private-window --timeout 150
/* global spike, Services, S */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const { b, check, sleep, state } = S;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  await spike.resize(1440, 900);
  await spike.activate();
  const page = (name) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>${name}</title><body style="margin:0;background:#eee"><p>${name}</p>`);
  await S.openTabs(["A", "B", "C"].map(page));
  await S.setStyle("grid");
  const open = async () => { b.service("switcher").open("latched"); await S.waitFor(() => state().phase === "open"); await sleep(700); };
  await open();
  const f = document.querySelector("#layer-switcher .sw-gfield");
  const sc = document.querySelector("#layer-switcher .sw-gscroll");
  const fr = f.getBoundingClientRect();
  const sr = sc.getBoundingClientRect();
  const lensH = f.querySelector(".lens")?.style.backdropFilter || "";
  check("grid field: top 8, 36 tall, radius 18, 480 wide, centred", fr.y === 8 && fr.height === 36 && getComputedStyle(f).borderTopLeftRadius === "18px" && fr.width === 480 && Math.abs(fr.x - (1440 - 480) / 2) <= 1, [fr.x, fr.y, fr.width, fr.height, getComputedStyle(f).borderTopLeftRadius]);
  check("grid scroller starts at 52", Math.round(sr.y) === 52, [sr.x, sr.y, sr.width, sr.height]);
  spike.log("lens", lensH.slice(0, 120));
  // full screen simulated (as mac-onerow-behaviour.js does via classes) with the menu bar shift
  b.root.classList.add("fullscreen", "row-shifted");
  b.root.style.setProperty("--vitre-row-shift", "24px");
  await sleep(100);
  check("full screen, menu bar down: the field moves by --vitre-row-shift", getComputedStyle(f).translate === "0px 24px", getComputedStyle(f).translate);
  b.root.classList.remove("fullscreen", "row-shifted");
  b.root.style.removeProperty("--vitre-row-shift");
  await sleep(100);
  check("back: no translate", getComputedStyle(f).translate === "none", getComputedStyle(f).translate);
  spike.press("Escape");
  await S.waitFor(() => state().phase === "idle");
  // narrow window: the field keeps 96 from each edge
  await spike.resize(b.isPrivate ? 676 : 600, 700);
  await sleep(500);
  await open();
  const f2 = document.querySelector("#layer-switcher .sw-gfield").getBoundingClientRect();
  check("narrow window: the field is clear of the traffic lights (x >= 96, right margin >= 96)", f2.x >= 96 && innerWidth - f2.right >= 96, [f2.x, f2.width, innerWidth]);
  const cap = document.getElementById("vitre-private")?.getBoundingClientRect();
  if (b.isPrivate) {
    check("private: the Private capsule is shown in the row", !!cap && cap.width > 0, cap && cap.toJSON());
    check("private, narrow window: the field ends 8 px short of the Private capsule", !!cap && f2.right <= cap.left - 8 + 0.5, [f2.x, f2.right, cap && cap.left]);
  }
  spike.press("Escape");
  await S.waitFor(() => state().phase === "idle");
});
