// macOS look check for window full screen with the One row: as Deer's F11 full screen on Windows (the
// owner, 2026-11-15), the page fills the screen with no bars at the top; the row comes back over the
// page with the pointer at the top, in the page's colours; there is no drag strip. Back in a normal
// window the page still fills the window from y 0 under the row (no gray band: nothing lies across the
// row, and the 18 px drag strip at the top paints nothing).
//   python3 tools/run.py --test tests/menus/mac-fullscreen-look.js --name mac-fullscreen --url about:blank --timeout 150
// Needs the screen unlocked: native full screen does not start while it is locked.
/* global spike, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, waitFor } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  await spike.resize(1280, 800);
  await M.activate();
  await M.load(M.page("article.html"));
  const titled = (t, bg, fg = "#1d1d1f") => "data:text/html;charset=utf-8," + encodeURIComponent(
    `<!doctype html><meta charset=utf-8><title>${t}</title><body style="margin:0;background:${bg};color:${fg};font:17px Georgia"><h1 style="margin:40px">${t}</h1>` +
    "<p style='margin:0 40px 14px;max-width:700px'>A ribbon of glass floats on molten tin until it is flat on both faces, then cools as it moves down the line.</p>".repeat(12));
  for (const [t, bg] of [["Tideline", "#e9f4f3"], ["Refract", "#f4f2ec"]]) b.newTab(titled(t, bg), { background: true });
  await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading), { what: "three tabs loaded" });
  b.run("fullscreen");
  await waitFor(() => window.fullScreen && b.root.classList.contains("fullscreen"), { timeout: 10000, what: "native full screen" });
  await sleep(1800);
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  check("full screen: the page starts at the top", Math.round(br.top) === 0, br.toJSON());
  check("full screen: no drag strip", getComputedStyle(document.getElementById("vitre-drag")).display === "none", getComputedStyle(document.getElementById("vitre-drag")).display);
  const EU = spike.EU;
  EU.synthesizeMouseAtPoint(600, 500, { type: "mousemove" }, window);
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
  await sleep(500);
  check("full screen: no bars at the top", b.bar.hidden, b.bar.state);
  await capture("mac-fs-1-page");
  EU.synthesizeMouseAtPoint(600, 4, { type: "mousemove" }, window);
  await waitFor(() => !b.bar.hidden, { timeout: 2000, what: "row revealed" }).catch(() => {});
  await sleep(700);
  check("full screen, pointer at the top: the row comes back", !b.bar.hidden, b.bar.state);
  await capture("mac-fs-1b-revealed");
  EU.synthesizeMouseAtPoint(600, 500, { type: "mousemove" }, window);
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "row hidden" }).catch(() => {});
  await sleep(500);
  await M.load(titled("Night Shift", "#15161a", "#e8e8ea"));
  await sleep(1000);
  await capture("mac-fs-2-dark");
  check("full screen, dark page: the row takes the dark theme", b.root.classList.contains("theme-dark"), b.root.className);
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen, { timeout: 10000, what: "full screen left" });
  await sleep(1200);
  const after = gBrowser.selectedBrowser.getBoundingClientRect();
  check("normal window again: the page still starts at the top, under the row", Math.round(after.top) === 0, after.toJSON());
  const strip = document.getElementById("vitre-drag");
  const ss = getComputedStyle(strip);
  check("normal window again: no band across the row; the 18 px drag strip is back and paints nothing (no gray title-bar material)", !document.getElementById("vitre-row-band") && ss.display !== "none" && Math.round(strip.getBoundingClientRect().height) === 18 && ss.appearance === "none" && ss.backgroundColor === "rgba(0, 0, 0, 0)", { display: ss.display, height: strip.getBoundingClientRect().height, appearance: ss.appearance, background: ss.backgroundColor });
  check("normal window again: the row is not hiding", b.bar.hiding === false && !b.bar.hidden, b.bar.state);
  await capture("mac-fs-3-after");
});
