// Split view, every way in (../design/SPLIT-VIEW-SPEC.md "How to start split view", "Menus";
// CtxMenu kinds circlesplit, circlepair, linksplit, linkpair, pillsplit): the circle's menu, the
// link menu, the pill's "New tab in split view", the address field's "Show here", b.split().
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const circle = (t) => b.bar.item(t.id)?.querySelector(".circle-face");
  const pill = () => b.bar.item(b.activeId)?.querySelector(".address") ?? SL.half(b.splitView.sideOf(b.active()) ?? "left");
  const order = () => b.tabs.map((t) => t.title).join(" | ");

  log("--- 1. a circle's menu: Open in split view (it keeps its side of the bar)");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  let rows = await SL.menuAt(circle(tl));
  check("circle menu: Open in split view is the first row, under the caption (CtxMenu circlesplit)", rows[0] === "Open in split view" && SL.rows()[0].access.toUpperCase() === "S", SL.rows().map((r) => r.label + (r.access ? "[" + r.access + "]" : "")));
  await SL.pick("Open in split view");
  await SL.shown();
  let p = b.splitView.active();
  check("the circle on the right of the pill becomes the right half; focus stays on the page you were on", p && p.left === fn && p.right === tl && b.active() === fn, p && { left: p.left.title, right: p.right.title, active: b.active().title });
  check("the pair takes the active tab's place in the bar", order() === "Field Notes | Tideline | Links", order());
  await sleep(200);
  check("announced: Tideline opened on the right", b.splitView.announced === "Tideline opened on the right", b.splitView.announced);
  await spike.capture("start-1-circle");

  log("--- 2. a circle left of the pill becomes the left half");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.moveTab(ln, 0);
  await sleep(300);
  check("set-up: Links | Field Notes | Tideline", order() === "Links | Field Notes | Tideline", order());
  rows = await SL.menuAt(circle(ln));
  await SL.pick("Open in split view");
  await SL.shown();
  p = b.splitView.active();
  check("Links is the left half, Field Notes the right, focus on Field Notes", p && p.left === ln && p.right === fn && b.active() === fn, p && { left: p.left.title, right: p.right.title });

  log("--- 3. with a pair active the row reads '... instead of <the unfocused side>' and replaces it");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  rows = await SL.menuAt(circle(ln));
  check("circle menu in a pair: Open in split view instead of Tideline (CtxMenu circlepair)", rows[0] === "Open in split view instead of Tideline", rows);
  await SL.pick("Open in split view instead of");
  await SL.until(() => b.splitView.active()?.right === ln);
  p = b.splitView.active();
  check("Links replaced the unfocused side; Tideline is back in the bar beside the pair on its side, not closed", p && p.left === fn && p.right === ln && b.tabs.includes(tl) && order() === "Field Notes | Links | Tideline" && b.active() === fn, { order: order(), active: b.active()?.title });
  const longTitle = await SL.tab("light.html?long");
  await SL.inPage((content, doc) => { doc.title = "A very long page title that goes on and on"; return doc.title; }, longTitle.browser);
  await SL.until(() => longTitle.title.startsWith("A very long"));
  b.split(longTitle);
  await SL.until(() => b.splitView.active()?.right === longTitle);
  rows = await SL.menuAt(circle(ln));
  check("the replaced side's name is cut at 20 characters with an ellipsis", rows[0] === "Open in split view instead of A very long page tit…", rows[0]);
  SL.closeMenu();

  log("--- 4. a Home side is what a circle replaces (and Home is dropped)");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split("home");
  await SL.shown();
  const home = b.splitView.active()?.right;
  b.omni.close();
  b.activate(fn);
  await sleep(300);
  rows = await SL.menuAt(circle(tl));
  check("circle menu with a Home side: ... instead of Home", rows[0] === "Open in split view instead of Home", rows);
  await SL.pick("Open in split view instead of");
  await SL.until(() => b.splitView.active()?.right === tl);
  check("Tideline took the Home side; the empty Home tab is closed", b.splitView.active()?.right === tl && !b.tabs.includes(home), order());

  log("--- 5. the link menu: Open link in split view (third row), on the right, focus stays");
  [fn, tl] = await SL.scene(["dark.html"]);
  const links = await SL.load(http("links.html"), fn);
  let r = await SL.pageRect("#plain");
  SL.rightClick(r.cx, r.cy);
  await SL.until(() => SL.menuOpen(), 4000);
  await sleep(260);
  rows = SL.labels();
  check("link menu: Open link in split view is the third row, after Peek link (CtxMenu linksplit)", rows[2] === "Open link in split view" && rows[1] === "Peek link", rows);
  await SL.pick("Open link in split view");
  await SL.until(() => b.splitView.active() && SL.loaded(b.splitView.active().right, http("light.html?from-links")), 15000);
  p = b.splitView.active();
  check("the link opened as a new tab on the right of the page; the page keeps focus", p && p.left === links && p.right.url === http("light.html?from-links") && b.active() === links, p && { left: p.left.url, right: p.right.url, active: b.active().url });

  log("--- 6. in a pair: Open link on the right side loads into that side (Back returns)");
  const right = p.right;
  const tabsBefore = b.tabs.length;
  r = await SL.pageRect("#dark", links.browser);
  SL.rightClick(r.cx, r.cy);
  await SL.until(() => SL.menuOpen(), 4000);
  await sleep(260);
  rows = SL.labels();
  check("in a pair the third row reads Open link on the right side (CtxMenu linkpair)", rows[2] === "Open link on the right side", rows);
  await SL.pick("Open link on the right side");
  await SL.until(() => SL.loaded(right, http("dark.html?from-links")), 15000);
  check("the other side's tab loaded the link, no new tab, focus stays on the link's page", right.url === http("dark.html?from-links") && b.tabs.length === tabsBefore && b.active() === links, { right: right.url, tabs: b.tabs.length, active: b.active().title });
  // The side's history keeps its page (Firefox's back-button intervention skips entries nobody
  // interacted with, so canGoBack itself may still say false for an untouched test page).
  const hist = right.browser.browsingContext?.sessionHistory;
  check("Back on that side returns to its page: the load is a new entry of that side's history", !!hist && hist.index >= 1 && hist.count >= 2 && right.browser.canGoBackIgnoringUserInteraction, { index: hist?.index, count: hist?.count });
  b.swapSides();
  await sleep(300);
  r = await SL.pageRect("#plain", links.browser);
  SL.rightClick(r.cx, r.cy);
  await SL.until(() => SL.menuOpen(), 4000);
  await sleep(260);
  check("with the link's page on the right the row reads ... left side", SL.labels()[2] === "Open link on the left side", SL.labels());
  SL.closeMenu();

  log("--- 7. no split row on image, mail, phone, javascript or file links");
  b.separate();
  await sleep(300);
  const none = [];
  for (const sel of ["#imglink img", "#mail", "#tel", "#file"]) {
    r = await SL.pageRect(sel, links.browser);
    if (!r) {
      none.push(sel + ": not found");
      continue;
    }
    SL.closeMenu();
    await sleep(150);
    SL.rightClick(r.cx, r.cy);
    await SL.until(() => SL.menuOpen(), 4000);
    await sleep(200);
    const got = SL.labels();
    if (!got.length || got.some((l) => /split|side/.test(l))) none.push({ sel, got });
  }
  SL.closeMenu();
  check("image links, mailto:, tel: and file links get no split row (owner's decision 2026-10-20: image links)", none.length === 0, none);

  log("--- 8. the pill's menu: New tab in split view (Ctrl+Shift+U), Home on the right, focused, its field open");
  [fn, tl] = await SL.scene(["dark.html"]);
  rows = await SL.menuAt(pill());
  const row = SL.rows().find((x) => x.label === "New tab in split view");
  check("pill menu: New tab in split view [N] with Ctrl+Shift+U, after Duplicate tab (CtxMenu pillsplit)", !!row && row.key === "Ctrl+Shift+U" && row.access.toUpperCase() === "N" && rows.indexOf("New tab in split view") === rows.indexOf("Duplicate tab") + 1, SL.rows().map((x) => [x.label, x.key, x.access]));
  await SL.pick("New tab in split view");
  await SL.until(() => b.splitView.active() && b.omni.focused, 6000);
  p = b.splitView.active();
  check("the page went left, a new Home opened on the right and is focused", p && p.left === fn && p.right.kind === "home" && b.active() === p.right, p && { left: p.left.title, right: p.right.url, active: b.active()?.url });
  check("its address field is open and focused, for the right page (side glyph, name)", b.omni.focused && b.omni.input.getAttribute("aria-label") === "Address for the right page" && !!document.querySelector("#vitre-omni-field .omni-icon path[fill-opacity]"), { focused: b.omni.focused, label: b.omni.input.getAttribute("aria-label") });
  const field = SL.rect(document.getElementById("vitre-omni-field"));
  await sleep(300);
  const fieldNow = SL.rect(document.getElementById("vitre-omni-field"));
  check("the field is centred in the window as today (640 wide)", Math.abs(fieldNow.x + fieldNow.w / 2 - window.innerWidth / 2) <= 1 && fieldNow.w === 640, { field, fieldNow });
  const homeButton = document.getElementById("vitre-home-bg");
  check("the Home side shows the wallpaper and nothing else (no Change background button)", !homeButton || homeButton.classList.contains("off"), homeButton?.className);
  await spike.capture("start-8-new-tab");

  log("--- 9. Show here: an open tab that matches takes the empty side; Home is dropped");
  const homeSide = p.right;
  spike.type("Tideline");
  await SL.until(() => document.querySelector("#vitre-omni-list .omni-tail")?.textContent.includes("Show here"), 4000);
  const tail = document.querySelector("#vitre-omni-list .omni-tail");
  check("open tabs that match read Show here on the empty side", !!tail && tail.textContent.includes("Show here"), tail?.textContent);
  await spike.capture("start-9-show-here");
  // The list is drawn again when history answers: take the row as it is now.
  const item = [...document.querySelectorAll("#vitre-omni-list .omni-tail")].find((x) => x.textContent.includes("Show here"))?.closest(".omni-item");
  if (item) spike.EU.synthesizeMouseAtCenter(item, { type: "mousedown" }, window);
  await SL.until(() => b.splitView.active()?.right === tl, 5000);
  p = b.splitView.active();
  check("Tideline moved into the side, the Home tab is gone, its circle left the bar", p?.right === tl && !b.tabs.includes(homeSide) && !document.querySelector(`#vitre-bar .item.tab:not(.pair):not(.leaving)[data-id="${tl.id}"]`), { order: order(), right: p?.right?.title });

  log("--- 10. not on Home; Home is never paired with Home; b.split()");
  [fn] = await SL.scene([]);
  b.newTab();
  await SL.until(() => b.active()?.kind === "home");
  b.omni.close();
  await sleep(300);
  rows = await SL.menuAt(pill());
  check("Home's pill menu has no New tab in split view", !rows.includes("New tab in split view"), rows);
  SL.closeMenu();
  const h1 = b.active();
  b.newTab(undefined, { background: true });
  await sleep(400);
  const h2 = b.tabs.find((t) => t.kind === "home" && t !== h1);
  check("b.split refuses Home with Home", b.split(h2) === null && !b.splitView.active(), !!b.splitView.active());
  rows = await SL.menuAt(circle(h2));
  check("a Home circle's menu on Home has no split row", !rows.some((l) => l.startsWith("Open in split view")), rows);
  SL.closeMenu();
  b.activate(fn);
  await sleep(300);
  const made = b.split(h2);
  check("b.split(tab) pairs the active tab with it and returns the pair", !!made && made.left === fn && made.right === h2 && b.active() === fn, made && [made.left.title, made.right.url]);
});
