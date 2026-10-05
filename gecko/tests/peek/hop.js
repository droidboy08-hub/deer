// Peek: hop and close. Shift+click a link still visible on the dimmed page: the sheet stays and its
// content cross-fades (the old page's last frame over the new one until it paints), with no new
// history. A click on the dim closes: the sheet shrinks back into its link, the link's row glows
// (wash) and keyboard focus returns to the link (boards PeekMotion, PeekSpec "Hop", "Close").
//   python tests/peek/all.py hop
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();

  await P.shiftClick("#i39");
  const br = await P.waitOpen("n=39");
  const tok39 = (await P.state(br)).token;
  const hidden0 = P.tabsInfo().hidden;

  // ---- 1. hop: Shift+click #38 where it shows beside the sheet ------------------------------------
  const r38 = await P.rectOf(src.browser, "#i38");
  const s0 = sheet();
  log("link #38", P.R(r38), "sheet", s0.chrome);
  check("part of #38 is visible on the dim, left of the sheet", r38.x < s0.chrome.x - 20, { link: P.R(r38), sheet: s0.chrome });
  const hx = Math.round((r38.x + s0.chrome.x) / 2);
  P.move(hx, r38.cy);
  await sleep(80);
  const seen = { snapshot: false, frames: 0 };
  const watch = setInterval(() => {
    seen.frames++;
    if (sheet().snapshot) seen.snapshot = true;
  }, 10);
  P.mouse(hx, r38.cy, { shiftKey: true });
  await sleep(30);
  await spike.capture("hop-1-swapping");
  await waitFor(() => br.currentURI.spec.includes("n=38") && !br.webProgress.isLoadingDocument, { what: "the hop's page" });
  await sleep(700);
  clearInterval(watch);
  const s1 = sheet();
  log("after hop", s1, seen);
  check("the hop swapped the content in place: same sheet, same browser, no tab, no window", peek().isOpen() && peek().browser() === br && b.tabs.length === 1 && P.tabsInfo().hidden === hidden0 && s1.chrome.x === s0.chrome.x && s1.chrome.w === s0.chrome.w, P.tabsInfo());
  check("the old page's last frame covered the swap, then faded", seen.snapshot && !s1.snapshot, seen);
  check("the header shows the new page; a hop adds no history (no back chevron)", s1.path === "/issue.html?n=38" && !s1.back && !br.canGoBack, { path: s1.path, back: s1.back });
  check("a new document (it is #38, not #39)", (await P.state(br)).token !== tok39);
  await spike.capture("hop-2-after");

  // ---- 2. close by a click on the dim: shrink into #38, wash its row, focus it --------------------
  Services.prefs.setIntPref("vitre.debug.peekMotionScale", 4);
  P.mouse(100, 860);
  await sleep(20);
  await spike.capture("hop-3-closing");
  const closing = sheet();
  log("closing sheet", closing.chrome);
  await P.waitClosed(6000);
  Services.prefs.clearUserPref("vitre.debug.peekMotionScale");
  const wash = gBrowser.tabpanels.querySelector(":scope > .vitre-peek-wash");
  const washRect = wash && P.R(wash.getBoundingClientRect());
  const row38 = await P.inContent(src.browser, (w) => {
    const r = w.document.getElementById("i38").closest('[role="listitem"]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  log("wash", washRect, "row", row38);
  check("the sheet shrank toward its link while closing (mid-motion it is smaller than the sheet)", closing.chrome && closing.chrome.w < s0.chrome.w, closing.chrome);
  check("a wash lights the link's row after closing", !!wash && P.near(washRect.x, row38.x, 3) && P.near(washRect.y, row38.y, 3) && P.near(washRect.w, row38.w, 3) && P.near(washRect.h, row38.h, 3), { wash: washRect, row: row38 });
  await sleep(150);
  await spike.capture("hop-4-wash");
  check("keyboard focus is back on the link the peek came from (#38 after the hop)", (await P.state(src.browser)).active === "i38" && document.activeElement === src.browser, (await P.state(src.browser)).active);
  check("the dim is gone and the page under it did not navigate", !sheet().dimOn && src.url.endsWith("issues.html"));
  await sleep(1500);
  check("the wash fades away by itself", !gBrowser.tabpanels.querySelector(":scope > .vitre-peek-wash"));

  // ---- 3. peeking the same link again is instant: the warm page comes back -------------------------
  const tok38 = (await P.state(br)).token;
  await P.shiftClick("#i38");
  const again = await P.waitOpen("n=38");
  check("Shift+click on the same link reuses the warm page (same document)", again === br && (await P.state(br)).token === tok38 && Number(sheet().cover) === 0);

  // ---- 4. a click on the dim after typing only nudges the sheet ------------------------------------
  await P.focusPeek();
  const ta = await P.rectOf(br, "#comment");
  P.mouse(ta.cx, ta.cy);
  await sleep(150);
  spike.type("draft");
  await sleep(300);
  P.mouse(100, 860);
  await sleep(80);
  const nudged = gBrowser.tabpanels.querySelector(".vitre-peek-frame").style.translate;
  await sleep(500);
  check("after typing in the peek, a click on the dim only nudges it", peek().isOpen() && /px/.test(nudged) && (await P.state(br)).typed === "draft", nudged);
  // A Shift+click on the dim where there is no link: nothing to hop to, the typed text stays.
  P.mouse(100, 870, { shiftKey: true });
  await sleep(500);
  check("a Shift+click on the dim off any link keeps the typed peek open", peek().isOpen());
  P.press("Ctrl+W");
  await P.waitClosed();
  check("Ctrl+W still closes it", !peek().isOpen());
});
