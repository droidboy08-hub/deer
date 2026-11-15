// macOS One row: the Downloads quick view hangs 8 px under the Downloads capsule in #vitre-row-end and
// moves with the row when macOS's menu bar slides in during full screen (#layer-downloads-pop
// translates by --vitre-row-shift; the quick view is placed from layout boxes, so the shift counts
// once); the open quick view holds the row; the row-end capsules carry the full 0 8 24 shadow in a
// normal window and in full screen (skin/bar.css, the row floats over the page in both); the video
// pill keeps 8 px under the row (y >= 60), also when the video's top is scrolled under the row (the
// page runs under it from y 0: video.ts minTop), and moves by the part of the shift that would cover
// it. Full screen is simulated with the root's classes, as tests/menus/mac-onerow-behaviour.js does.
//   python3 tests/downloads/all.py mac-row --app build
/* global spike, Services, DL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const ui = DL.ui();
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 }; };
  await DL.open(DL.base + "/page.html", { settle: 600 });
  const ringEl = ui.ring.el;
  check("ring is in #vitre-row-end", !!ringEl.closest("#vitre-row-end"), ringEl.parentElement?.id);
  // ---- quick view ----
  ui.ring.pop.open(false);
  await sleep(500);
  const pop = document.querySelector(".vd-pop.under-row");
  let rr = R(ringEl), pr = pop && R(pop);
  check("quick view hangs 8 px under the capsule, right edges aligned", !!pop && Math.abs(pr.y - (rr.b + 8)) <= 1 && Math.abs(pr.r - rr.r) <= 1 && pr.w === 380, { ring: rr, pop: pr });
  check("the open quick view holds the bar (Mac)", !!ui.ring.pop.releaseBar);
  // A normal window: the row floats over the page, and its right-end capsules carry the full shadow.
  const capShadow = (e) => (e ? getComputedStyle(e).boxShadow : "missing");
  check("normal window: the Downloads and Extensions capsules' shadows include 0 8px 24px at 16 %", [ringEl, document.querySelector("#vitre-row-end > .vx-rowcap")].every((e) => capShadow(e).includes("rgba(0, 0, 0, 0.16) 0px 8px 24px")), [capShadow(ringEl), capShadow(document.querySelector("#vitre-row-end > .vx-rowcap"))]);
  // full screen simulated with the menu bar shift
  b.root.classList.add("fullscreen", "row-shifted");
  b.root.style.setProperty("--vitre-row-shift", "24px");
  await sleep(150);
  ui.ring.pop.render();
  await sleep(50);
  rr = R(ringEl); pr = R(pop);
  const layer = document.getElementById("layer-downloads-pop");
  check("shifted: #layer-downloads-pop translates by --vitre-row-shift", getComputedStyle(layer).translate === "0px 24px", getComputedStyle(layer).translate);
  check("shifted: the capsule moved down by 24 (layer-bar)", Math.abs(rr.y - 32) <= 1, rr);
  check("shifted (re-placed while shifted): still 8 px under the moved capsule, not counted twice", Math.abs(pr.y - (rr.b + 8)) <= 1 && Math.abs(pr.r - rr.r) <= 1, { ring: rr, pop: pr, top: pop.style.top });
  const ringShadow = getComputedStyle(ringEl).boxShadow;
  check("full screen: the Downloads capsule's shadow includes 0 8px 24px at 16 %", ringShadow.includes("rgba(0, 0, 0, 0.16) 0px 8px 24px"), ringShadow);
  const ext = document.querySelector("#vitre-row-end > .vx-rowcap");
  const extShadow = ext ? getComputedStyle(ext).boxShadow : "no vx-rowcap";
  check("full screen: the Extensions capsule's shadow includes 0 8px 24px at 16 %", extShadow.includes("rgba(0, 0, 0, 0.16) 0px 8px 24px"), extShadow);
  b.root.classList.remove("fullscreen", "row-shifted");
  b.root.style.removeProperty("--vitre-row-shift");
  await sleep(150);
  check("back: layer not translated, quick view under the capsule", getComputedStyle(layer).translate === "none" && Math.abs(R(pop).y - (R(ringEl).b + 8)) <= 1, [getComputedStyle(layer).translate, R(pop), R(ringEl)]);
  ui.ring.pop.close(false);
  await sleep(300);
  check("closed: the bar hold is released", !ui.ring.pop.releaseBar && !document.querySelector(".vd-pop.under-row:not([style*='pointer-events'])"));
  // ---- video pill ----
  await DL.open(DL.base + "/video.html", { settle: 800 });
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await waitFor(() => ui.video.state.shown && ui.video.state.mode === "found", { timeout: 8000, what: "the pill" }).catch(() => null);
  const pill = b.root.querySelector(".vd-pill");
  if (!pill || !ui.video.state.shown) { check("the pill shows", false, ui.video.state); return; }
  const top = parseFloat(pill.style.top);
  const room = parseFloat(pill.style.getPropertyValue("--vd-pill-room"));
  log("pill top", top, "room", room, "rect", JSON.stringify(R(pill)));
  check("pill: at least 8 px under the row (y >= 60) and --vd-pill-room = top - 60", top >= 60 && Math.abs(room - (top - 60)) <= 0.5, { top, room });
  b.root.classList.add("fullscreen", "row-shifted");
  b.root.style.setProperty("--vitre-row-shift", "200px");
  await sleep(100);
  const tr = getComputedStyle(pill).translate;
  check("shifted by 200: the pill moves by 200 - room", tr === `0px ${200 - room}px` || (200 - room <= 0 && tr === "none") || (200 - room <= 0 && tr === "0px 0px"), { tr, want: 200 - room });
  b.root.classList.remove("fullscreen", "row-shifted");
  b.root.style.removeProperty("--vitre-row-shift");
  await sleep(100);
  check("back: pill not translated", ["none", "0px 0px", "0px"].includes(getComputedStyle(pill).translate), getComputedStyle(pill).translate);
  // The video's top scrolled under the row (the page fills the window from y 0): the pill stays 8 px
  // under the row, at y 60, with no room left above it.
  const under = await DL.frameScript(gBrowser.selectedBrowser, () => {
    const d = content.document;
    d.body.style.paddingBottom = "1600px";
    const v = d.getElementById("v");
    content.scrollTo(0, v.getBoundingClientRect().top + content.scrollY - 10);
    return { top: v.getBoundingClientRect().top, scrollY: content.scrollY };
  });
  await sleep(300);
  await DL.hoverInPage("#v", { dx: 0.4, dy: 0.5 });
  await sleep(400);
  const top2 = parseFloat(pill.style.top);
  const room2 = parseFloat(pill.style.getPropertyValue("--vd-pill-room"));
  spike.log("video scrolled under the row", JSON.stringify(under), "pill top", top2, "room", room2);
  check("video top under the row (y ~10): the pill sits 8 px under the row (y 60, room 0)", under && Math.abs(under.top - 10) <= 2 && top2 === 60 && room2 === 0, { under, top2, room2 });
});
