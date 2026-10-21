// Split view's fixes for "only the active tab is on screen" (../design/SPLIT-VIEW-SPEC.md "Build
// notes", "Focus", "With the rest of Deer", "Edge cases"): successors both ways, moveTab moving the
// pair, tab-activated { withinPair }, b.shown(), window.focus() from the unfocused pane, alert(), the
// crash card, Peek over both panes and its Open as tab, find in the focused side, the download mark,
// the window title.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const order = () => b.tabs.map((t) => t.title).join(" | ");

  log("--- 1. successors both ways, and gone after Separate");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  check("each side's successor is its partner (closing one focuses the other)", fn.node.successor === tl.node && tl.node.successor === fn.node);
  b.separate();
  await sleep(200);
  check("after Separate the successors are cleared", !fn.node.successor && !tl.node.successor);

  log("--- 2. moving a paired tab moves the pair");
  b.split(tl);
  await SL.shown();
  b.moveTab(fn, 2);
  await sleep(300);
  check("b.moveTab on a side moves the whole pair (it stays paired, sides in order)", order() === "Links | Field Notes | Tideline" && b.pairOf(fn)?.right === tl, order());
  b.moveTab(ln, 2);
  await sleep(300);
  check("a tab moved next to a pair goes beside it, never between its sides", b.pairOf(fn)?.right === tl && (order() === "Field Notes | Tideline | Links" || order() === "Links | Field Notes | Tideline"), order());

  log("--- 3. tab-activated { withinPair } and b.shown()");
  const seen = [];
  const off = b.on("tab-activated", (t, info) => seen.push([t.title, info?.withinPair]));
  b.activate(tl);
  await sleep(250);
  b.activate(ln);
  await sleep(250);
  b.activate(fn);
  await SL.shown();
  await sleep(250);
  off();
  check("tab-activated says withinPair only for a move between the sides of one pair", JSON.stringify(seen) === JSON.stringify([["Tideline", true], ["Links", false], ["Field Notes", false]]), seen);
  check("b.shown: both sides of the active pair, not the other tab", b.shown(fn) && b.shown(tl) && !b.shown(ln));
  b.activate(ln);
  await sleep(300);
  check("with the pair in the background only the active tab is shown", b.shown(ln) && !b.shown(fn) && !b.shown(tl));

  log("--- 4. the window title shows the focused side");
  b.activate(tl);
  await sleep(400);
  check("window title: the focused side", document.title.startsWith("Tideline"), document.title);
  b.activate(fn);
  await sleep(400);
  check("…and follows focus", document.title.startsWith("Field Notes"), document.title);

  log("--- 5. pages can't steal focus: window.focus() from the unfocused pane");
  const thief = await SL.tab(http("focus.html?after=1500", "localhost"));
  b.split(thief);
  await SL.until(() => b.splitView.active()?.right === thief);
  b.focusPage();
  await SL.until(() => thief.title.includes("asked"), 6000);
  await sleep(500);
  check("the unfocused page's window.focus() and field.focus() do not move focus", b.active() === fn && thief.title.includes("asked"), { active: b.active()?.title, thief: thief.title });
  SL.inPage((content) => {
    content.setTimeout(() => content.alert("answer me"), 200);
    return 1;
  }, thief.browser);
  await SL.until(() => b.active() === thief, 5000);
  check("a page dialog (alert) does take focus: it must be answered", b.active() === thief, b.active()?.title);
  try {
    gBrowser.getTabDialogBox(thief.browser).abortAllDialogs();
  } catch (e) {
    log("abortAllDialogs", String(e));
  }
  await sleep(400);

  log("--- 6. a crashed unfocused pane: Deer's card with Reload");
  b.activate(fn);
  await sleep(300);
  await SL.load(http("dark.html?crash", "localhost"), thief);
  b.activate(fn);
  await sleep(400);
  let crashed = false;
  const offc = b.on("tab-crashed", (t) => (crashed = crashed || t === thief));
  SL.inPage(() => {
    Components.classes["@mozilla.org/xpcom/debug;1"].getService(Components.interfaces.nsIDebug2).abort("", 0);
    return 1;
  }, thief.browser);
  await SL.until(() => crashed && b.splitView.crashCard(thief), 10000);
  offc();
  const card = b.splitView.crashCard(thief);
  const pane = b.splitView.paneOf(thief);
  const cr = card && SL.rect(card);
  check("the card shows centred in the crashed pane: This page stopped, Reload; focus stays", !!card && card.textContent.includes("This page stopped") && Math.abs(cr.x + cr.w / 2 - (pane.left + pane.width / 2)) <= 2 && b.active() === fn, { cr, pane: pane && SL.rect({ getBoundingClientRect: () => pane }) });
  await spike.capture("fixes-1-crash-card");
  spike.click(card.querySelector("button"));
  await SL.until(() => SL.loaded(thief, http("dark.html?crash", "localhost")), 10000);
  check("Reload brings the page back in its pane, the card goes, focus stays", thief.url === http("dark.html?crash", "localhost") && !b.splitView.crashCard(thief) && b.active() === fn, { url: thief.url, active: b.active()?.title });

  log("--- 7. Peek over both panes, and Open as tab");
  const peek = b.service("peek");
  if (peek) {
    peek.open(http("links.html?peek"), {});
    await SL.until(() => peek.isOpen() && peek.browser()?.currentURI?.spec === http("links.html?peek") && !peek.browser().webProgress?.isLoadingDocument, 8000);
    await sleep(800);
    const dim = document.querySelector("#tabbrowser-tabpanels > .vitre-peek-dim.on");
    const dr = dim && SL.rect(dim);
    const layer = document.getElementById("vitre-split");
    check("the peek sheet is window-centred with both panes dimmed (the dim covers the window, over the divider and rims)", peek.isOpen() && !!dr && dr.x <= 0 && dr.r >= Math.floor(window.innerWidth) - 1 && Number(getComputedStyle(dim).zIndex) > Number(getComputedStyle(layer).zIndex), { dr, dimZ: dim && getComputedStyle(dim).zIndex, layerZ: getComputedStyle(layer).zIndex });
    await spike.capture("fixes-2-peek");
    const samples = [];
    const p0 = b.tabs.length;
    peek.promote();
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      const held = [fn, thief].some((t) => SL.panel(t).classList.contains("vitre-peek-under"));
      if (!held && samples.length) break;
      if (held && b.tabs.length > p0) samples.push([fn, thief].map((t) => ({ under: SL.panel(t).classList.contains("vitre-peek-under"), display: getComputedStyle(SL.panel(t)).display, w: Math.round(SL.panel(t).getBoundingClientRect().width) })));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await SL.until(() => !peek.isOpen() && b.active()?.url === http("links.html?peek"), 6000);
    await sleep(500);
    check("while Open as tab grows the sheet both panes stay on screen", samples.length > 0 && samples.every((x) => x.every((u) => u.under && u.display !== "none" && u.w > 300)), samples.slice(0, 2));
    const promoted = b.active();
    check("the new tab is placed after the pair, which becomes a capsule", b.tabs.indexOf(promoted) === b.tabs.indexOf(thief) + 1 && !b.splitView.showing() && !!SL.pairItem() && !SL.pairItem().classList.contains("active"), order());
    check("the panes' pinned styles are gone afterwards", [fn, thief].every((t) => !SL.panel(t).classList.contains("vitre-peek-under") && !SL.panel(t).style.width));
    b.closeTab(promoted);
    await sleep(300);
  } else log("no peek module in this build");

  log("--- 8. find in the focused side; the download mark is the pair's");
  b.activate(thief);
  await SL.shown();
  await sleep(300);
  const find = b.service("find");
  if (find) {
    find.open({ query: "glass" });
    await SL.until(() => find.isOpen(), 3000);
    await sleep(600);
    const face = document.querySelector("#layer-find .vf-face");
    const pill = b.bar.layout.pillRect;
    check("Ctrl+F finds in the focused side: the whole split pill becomes the find face", find.isOpen() && b.root.classList.contains("find-face") && !!face && Math.abs(SL.rect(face).x - pill.x) <= 1 && Math.abs(SL.rect(face).w - pill.width) <= 1, { face: face && SL.rect(face), pill });
    await spike.capture("fixes-3-find");
    find.close();
    await sleep(400);
  } else log("no find module in this build");
  check("the download mark is the split pill's own slot", !!b.bar.downloadMark() && SL.pairItem()?.contains(b.bar.downloadMark()));
  check("the site anchor (permission prompts) is the focused half", b.anchor("site") === SL.half("right"));

  log("--- 9. Deer's layer in the tab panels never disturbs which panel the deck shows");
  const shows = () => {
    const panel = SL.panel(b.active());
    return !!panel && panel.classList.contains("deck-selected") && panel.getBoundingClientRect().width > 300;
  };
  const steps = [];
  b.separate();
  await sleep(300);
  steps.push(["separated", shows()]);
  const extra = [];
  for (let i = 0; i < 3; i++) {
    extra.push(b.newTab(http("light.html?panel" + i)));
    await SL.until(() => SL.loaded(extra[i]), 8000);
    steps.push(["new tab " + i, shows()]);
  }
  b.split(extra[0]);
  await SL.shown();
  steps.push(["split again", shows() && !!b.splitView.showing()]);
  b.activate(extra[1]);
  await sleep(500);
  steps.push(["another tab", shows()]);
  b.separate(extra[0]);
  await sleep(300);
  for (const t of [extra[2], fn, extra[0], extra[1]]) {
    b.activate(t);
    await sleep(400);
    steps.push(["activate " + t.title, shows()]);
  }
  b.closeTab(extra[1]);
  await sleep(400);
  steps.push(["after a close", shows()]);
  check("the active tab's panel is the deck's selected one after every step (splits, new tabs, closes)", steps.every((x) => x[1]), steps);

  log("--- 10. the shown unfocused side is never discarded (low-memory unloading, an extension's tabs.discard)");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(400);
  const live = (t) => t.browser.isConnected && !t.node.hasAttribute("pending");
  const refused = gBrowser.discardBrowser(tl.node);
  await sleep(400);
  check("discarding the shown unfocused side is refused: its page stays live in its pane", refused === false && live(tl) && !!SL.panes(), { refused, live: live(tl), panes: SL.panes() });
  let unloader = null;
  try {
    ({ TabUnloader: unloader } = ChromeUtils.importESModule("moz-src:///browser/components/tabbrowser/TabUnloader.sys.mjs"));
  } catch (e) {
    log("TabUnloader not reachable", String(e));
  }
  if (unloader) {
    await unloader.unloadLeastRecentlyUsedTab(0);
    await sleep(500);
    check("low-memory unloading passes over it (it may unload a background tab instead)", live(tl) && live(fn) && !!SL.panes(), { tl: live(tl), fn: live(fn), ln: live(ln) });
  }
  b.activate(ln);
  await SL.until(() => live(ln), 8000);
  await sleep(500);
  const discarded = gBrowser.discardBrowser(tl.node);
  await sleep(300);
  check("with the pair in the background its sides can be discarded as before", discarded === true && !live(tl), { discarded, live: live(tl) });
  b.activate(fn);
  await SL.shown();
  await SL.until(() => live(tl) && SL.loaded(tl), 10000);
  check("showing the pair again brings the discarded side back in its pane", live(tl) && SL.loaded(tl) && !!SL.panes(), { live: live(tl), url: tl.url, panes: SL.panes() });
});
