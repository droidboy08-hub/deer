// Peek with find and the switcher, all real modules:
//   1. Shift+click a link: a peek opens over the page.
//   2. Ctrl+F with the peek's page focused: find opens as the 440x32 capsule in the sheet's header
//      (over its domain and path) and searches the peek's page, not the tab under it.
//   3. Esc closes find first, the peek stays; the query is kept.
//   4. Open as tab (Alt+Enter on the peek's page): the sheet becomes a tab right of its source,
//      without a reload.
//   5. Ctrl+Tab held: the switcher shows both tabs, the promoted one with its picture; letting go
//      goes back to the source tab; a quick Ctrl+Tab returns to the promoted tab.
// Captures: peek-1-open, peek-2-find-capsule, peek-3-promoted, peek-4-switcher.
/* global spike, Services, I */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const peek = b.service("peek");
  const find = b.service("find");
  const switcher = b.service("switcher");
  const EU = spike.EU;
  const key = (k, opts = {}) => EU.synthesizeKey(k, opts, window);

  const source = await I.load(I.page("article.html"), 800);
  // ---- 1. Shift+click ----
  const r = await I.rectOf("#peeklink");
  I.click(r.cx, r.cy, { shiftKey: true });
  const opened = await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html") && !peek.browser().webProgress?.isLoadingDocument, { timeout: 10000, what: "peek open" }).catch(() => false);
  await sleep(900);
  check("Shift+click opens the link in a peek over the page", !!opened && b.tabs.length === 1, { tabs: b.tabs.length });
  await capture("peek-1-open");
  const pb = peek.browser();
  // Mark the page so the promotion is seen to keep it (no reload).
  await I.inContent(pb, (content) => {
    content.document.getElementById("inc").click();
    content.document.getElementById("inc").click();
  });

  // ---- 2. Ctrl+F in the peek ----
  pb.focus();
  await sleep(200);
  key("f", { accelKey: true });
  await waitFor(() => find.isOpen(), { timeout: 4000, what: "find open" }).catch(() => null);
  await sleep(500);
  EU.sendString("glass", window);
  await sleep(1200);
  const st = window.vitreFind.inspect(pb);
  const capsule = document.querySelector("#layer-find .vf-cap");
  const head = peek.headerRect();
  const cr = capsule?.getBoundingClientRect();
  log("find in peek", st, "capsule", I.rect(capsule), "header", head && [head.left, head.top, head.width, head.height], "root", b.root.className);
  check("Ctrl+F in a peek: find opens as the capsule in the sheet's header and searches the peek's page", find.isOpen() && window.vitreFind.capsule?.mode === "open" && st?.open && st.query === "glass" && st.total >= 3 && !!cr && !!head && cr.top >= head.top && cr.bottom <= head.bottom + 0.5 && b.root.classList.contains("find-in-peek"), { total: st?.total, capsule: I.rect(capsule), mode: window.vitreFind.capsule?.mode });
  const tabFind = window.vitreFind.inspect(source.browser);
  check("the tab under the peek has no find open", !tabFind?.open, tabFind);
  await capture("peek-2-find-capsule");

  // ---- 3. Esc: find first, the peek stays ----
  key("KEY_Escape");
  await sleep(500);
  check("Esc closes find and leaves the peek open", !find.isOpen() && peek.isOpen(), { find: find.isOpen(), peek: peek.isOpen() });

  // ---- 4. Open as tab ----
  pb.focus();
  await sleep(200);
  key("KEY_Enter", { altKey: true });
  await waitFor(() => !peek.isOpen() && b.tabs.length === 2, { timeout: 5000, what: "promoted" }).catch(() => null);
  await sleep(900);
  const promoted = b.tabs[1];
  const count = await I.inContent(promoted.browser, (content) => content.document.getElementById("n").textContent);
  check("Alt+Enter opens the peek as a tab right of its source, active, the same page (no reload: the counter kept 2)", b.tabs.length === 2 && b.tabs[0] === source && promoted.browser === pb && b.active() === promoted && count === "2", { tabs: b.tabs.map((t) => t.url), count });
  await capture("peek-3-promoted");

  // ---- 5. Ctrl+Tab held: the switcher shows both, the promoted one with its picture ----
  b.focusPage();
  await sleep(300);
  key("KEY_Control", { type: "keydown" });
  await sleep(40);
  key("KEY_Tab");
  await waitFor(() => window.vitreSwitcher.state().phase === "open", { timeout: 3000, what: "switcher shown" }).catch(() => null);
  await sleep(900);
  const sw = window.vitreSwitcher.state();
  const thumbs = window.vitreSwitcher.thumbs;
  log("switcher", sw, "pictures", { promoted: thumbs.has(promoted.id), source: thumbs.has(source.id) });
  check("Ctrl+Tab held: the switcher shows both tabs, the source selected, the promoted tab has its picture", switcher.isOpen() && sw.phase === "open" && sw.list.includes(promoted.id) && sw.list.includes(source.id) && sw.selected === source.id && thumbs.has(promoted.id) && thumbs.has(source.id), sw);
  await capture("peek-4-switcher");
  // Step onto the promoted tab's card (its picture centred), then back to the source.
  key("KEY_Tab");
  await sleep(900);
  const sw2 = window.vitreSwitcher.state();
  check("Tab again selects the promoted tab's card", sw2.selected === promoted.id, sw2);
  await capture("peek-5-switcher-promoted");
  key("KEY_Tab");
  await sleep(700);
  key("KEY_Control", { type: "keyup" });
  await waitFor(() => !switcher.isOpen(), { timeout: 3000, what: "switcher closed" }).catch(() => null);
  await sleep(700);
  check("letting go of Ctrl opens the selected card: the source tab", b.active() === source, b.active()?.url);
  key("KEY_Control", { type: "keydown" });
  await sleep(30);
  key("KEY_Tab");
  await sleep(60);
  key("KEY_Control", { type: "keyup" });
  await sleep(700);
  check("a quick Ctrl+Tab goes back to the promoted tab", b.active() === promoted, b.active()?.url);
});
