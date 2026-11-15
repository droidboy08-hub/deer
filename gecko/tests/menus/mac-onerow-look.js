// macOS look check for the One-row tab bar and the Liquid Glass menus (DirOneRow.dc.html, RowSpec.dc.html).
//   python3 tools/run.py --test tests/menus/mac-onerow-look.js --name mac-onerow --url about:blank --timeout 150 [--pref ui.systemUsesDarkTheme=1]
// The row floats over the page as the Windows bar does (the owner, 2026-11-15: "remove the gray bar
// like windows"): no gray band, the traffic lights over the page, the capsules in their own glass and
// in the page's colours (dark ink over a light page, light ink over a dark one, whatever the system's
// appearance; run it with --pref ui.systemUsesDarkTheme=1 and =0 to see both).
// Captures: mac-row-1-tabs (the row over a light page, five tabs), mac-row-1b-scrolled (the same page
// scrolled under the row), mac-row-2-typing (the address capsule while typing), mac-row-3-plus-menu and
// mac-row-4-page-menu (Liquid Glass menus: popup windows, so spike.captureScreen), mac-row-5-dark,
// mac-row-6-home, mac-row-7-settings, mac-row-8-downloads.
/* global spike, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log, waitFor } = spike;
  await spike.resize(1280, 800);
  await M.activate();
  await M.load(M.page("article.html"));
  const titled = (t, bg, fg = "#1d1d1f") => "data:text/html;charset=utf-8," + encodeURIComponent(
    `<!doctype html><meta charset=utf-8><title>${t}</title><body style="margin:0;background:${bg};color:${fg};font:17px Georgia"><h1 style="margin:40px">${t}</h1>` +
    "<p style='margin:0 40px 14px;max-width:700px'>A ribbon of glass floats on molten tin until it is flat on both faces, then cools as it moves down the line.</p>".repeat(12));
  for (const [t, bg] of [["Tideline", "#e9f4f3"], ["Refract", "#f4f2ec"], ["Issues · vitre-shell", "#f6f6f6"], ["Long Exposure Club", "#efeff2"]]) b.newTab(titled(t, bg), { background: true });
  await waitFor(() => b.tabs.length === 5 && b.tabs.every((t) => !t.loading), { what: "five tabs loaded" });
  await sleep(800);
  // No band across the row: the window's drag region is the 18 px strip at the top, as on Windows.
  const strip = document.getElementById("vitre-drag");
  check("no band across the row; the drag strip is 18 px at the top (macOS)", !document.getElementById("vitre-row-band") && !!strip && Math.round(strip.getBoundingClientRect().height) === 18, strip?.getBoundingClientRect().toJSON());
  check("row end exists (macOS)", !!document.getElementById("vitre-row-end"));
  const br = gBrowser.selectedBrowser.getBoundingClientRect();
  check("the page starts at the top, under the row (as on Windows)", Math.round(br.top) === 0, br.toJSON());
  const bs = getComputedStyle(strip);
  check("no gray band: the drag strip has no title-bar appearance and no fill", bs.appearance === "none" && bs.backgroundColor === "rgba(0, 0, 0, 0)", { appearance: bs.appearance, background: bs.backgroundColor });
  log("system appearance: " + (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") + ", row theme: " + b.root.className.match(/theme-\w+/)?.[0]);
  await capture("mac-row-1-tabs");
  await M.inContent(b.active().browser, (content) => content.scrollTo(0, 220));
  await sleep(700);
  await capture("mac-row-1b-scrolled");
  await M.inContent(b.active().browser, (content) => content.scrollTo(0, 0));
  await sleep(400);

  b.editAddress("deer browser");
  await sleep(900);
  await capture("mac-row-2-typing");
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  await sleep(500);

  const plus = document.querySelector("#vitre-bar .item.plus");
  check("+ capsule found", !!plus);
  if (plus) {
    const r = plus.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    await M.waitOpen();
    await sleep(600);
    await spike.captureScreen("mac-row-3-plus-menu");
    M.key("KEY_Escape");
    await M.waitClosed();
  }
  M.rightClick(420, 360);
  await M.waitOpen();
  await sleep(600);
  await spike.captureScreen("mac-row-4-page-menu");
  M.key("KEY_Escape");
  await M.waitClosed();

  // A dark page: the row over it, in light ink.
  b.newTab(titled("Night Shift", "#15161a", "#e8e8ea"));
  await waitFor(() => b.tabs.length === 6 && !b.tabs[b.tabs.length - 1].loading, { what: "dark tab" });
  await sleep(800);
  await waitFor(() => b.root.classList.contains("theme-dark"), { timeout: 5000, what: "dark theme" }).catch(() => {});
  check("a dark page: the row takes the dark theme", b.root.classList.contains("theme-dark"), b.root.className);
  await capture("mac-row-5-dark");

  // Home (wallpaper) in a new tab, then Settings over it, then Downloads.
  b.newTab();
  await sleep(1500);
  await capture("mac-row-6-home");
  b.run("settings");
  await sleep(1200);
  await spike.captureScreen("mac-row-7-settings");
  M.key("KEY_Escape");
  await sleep(600);
  b.run("downloads");
  await sleep(1000);
  await spike.captureScreen("mac-row-8-downloads");
  M.key("KEY_Escape");
  await sleep(400);
});
