// Split view's keys (../design/SPLIT-VIEW-SPEC.md "Keys", the owner's decision of 2026-10-20 on
// Ctrl+Shift+U): Ctrl+Shift+U both ways with its guards, the F6 ring, Ctrl+Page Down, Ctrl+1..9,
// Ctrl+Tab treating a pair as one entry (core and switcher), Ctrl+Shift+Page Up / Down moving the
// pair, new tabs after the pair, a mouse side button over the other pane. Keys are synthesized
// in-process (spike.press), so page-first keys really go to the page first.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const order = () => b.tabs.map((t) => t.title).join(" | ");
  const ran = () => b.keys.log.filter((l) => l.startsWith("ACTION splitView"));

  log("--- 1. Ctrl+Shift+U on a single tab: New tab in split view");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+Shift+U");
  await SL.until(() => b.splitView.active() && b.omni.focused, 5000);
  let p = b.splitView.active();
  check("Ctrl+Shift+U: the page goes left, an empty Home opens on the right, focused, with its field open", p && p.left === fn && p.right.kind === "home" && b.active() === p.right && b.omni.focused, p && [p.left.title, p.right.url]);
  check("…routed page-first (the page had the key first)", (b.keys.log.filter((l) => l.startsWith("ACTION splitView")).pop() ?? "").includes("page-first"), b.keys.log.slice(-3));
  const home = p.right;
  log("--- 2. Ctrl+Shift+U in a pair: Separate tabs (also from the address field)");
  spike.press("Ctrl+Shift+U");
  await SL.until(() => !b.splitView.active(), 3000);
  check("Ctrl+Shift+U in the pair separated it; the focused (Home) side stays active", !b.splitView.active() && b.active() === home && b.tabs.includes(fn), { order: order(), active: b.active()?.url });
  await sleep(200);
  const label2 = b.omni.input.getAttribute("aria-label");
  check("the address field, still open, is no longer for a side: its name and glyph are the one page's again", !b.omni.open || (label2 === "Search or enter address" && !document.querySelector("#vitre-omni-field .omni-icon path[fill-opacity]")), { open: b.omni.open, label: label2 });
  log("--- 3. nothing on a single Home tab; key repeat ignored; a page that keeps the key keeps it");
  b.omni.close();
  await sleep(200);
  const n = b.tabs.length;
  b.focusPage();
  spike.press("Ctrl+Shift+U");
  await sleep(600);
  check("on a single Home tab Ctrl+Shift+U does nothing", !b.splitView.active() && b.tabs.length === n, { tabs: b.tabs.length, active: b.active()?.url });
  b.closeTab(home);
  b.activate(fn);
  await sleep(400);
  b.focusPage();
  await sleep(200);
  const before = ran().length;
  spike.press("Ctrl+Shift+U", { repeat: true });
  await sleep(600);
  check("a key repeat of Ctrl+Shift+U does nothing", !b.splitView.active() && ran().length === before, b.keys.log.slice(-3));
  await SL.load(http("prevent.html"), fn);
  b.focusPage();
  await sleep(200);
  const before3 = ran().length;
  spike.press("Ctrl+Shift+U");
  await sleep(700);
  const seen = await SL.inPage((content, doc) => doc.getElementById("seen").textContent, fn.browser);
  check("a page that uses the key keeps it (page-first: the page saw it, Deer did nothing)", !b.splitView.active() && ran().length === before3 && /U/i.test(seen), { log: b.keys.log.slice(-3), seen });
  await SL.load(http("light.html"), fn);

  log("--- 4. the F6 ring: left page -> right page -> address pill -> left page (Shift reverses)");
  b.split(tl);
  await SL.shown();
  b.focusPage();
  await sleep(300);
  const where = () => (b.omni.focused ? "pill" : document.activeElement === fn.browser ? "left" : document.activeElement === tl.browser ? "right" : document.activeElement?.localName ?? "?");
  const ring = [];
  for (let i = 0; i < 3; i++) {
    spike.press("F6");
    await sleep(400);
    ring.push(where() + (b.omni.focused ? ":" + b.omni.input.getAttribute("aria-label") : ""));
  }
  check("F6: right page, then the pill for the right page, then the left page", ring.join(" > ") === "right > pill:Address for the right page > left", ring);
  const back = [];
  for (let i = 0; i < 3; i++) {
    spike.press("Shift+F6");
    await sleep(400);
    back.push(where() + (b.omni.focused ? ":" + b.omni.input.getAttribute("aria-label") : ""));
  }
  check("Shift+F6: the pill (for the left page), then the right page, then the left page", back.join(" > ") === "pill:Address for the left page > right > left", back);

  log("--- 5. Ctrl+Page Down / Up and Ctrl+1..9 count both sides");
  b.activate(fn);
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+PageDown");
  await SL.until(() => b.active() === tl, 2000);
  check("Ctrl+Page Down from the left side: the right side", b.active() === tl && !!b.splitView.showing());
  spike.press("Ctrl+PageDown");
  await SL.until(() => b.active() === ln, 2000);
  check("…then the next tab (the pair goes to the background)", b.active() === ln && !b.splitView.showing());
  b.focusPage();
  spike.press("Ctrl+2");
  await SL.until(() => b.active() === tl, 2000);
  check("Ctrl+2 is the pair's right side (each side counts)", b.active() === tl && !!b.splitView.showing(), b.active()?.title);

  log("--- 6. Ctrl+Tab: the pair is one entry, standing for the side used last");
  b.activate(fn);
  await sleep(250);
  b.activate(ln);
  await sleep(250);
  b.activate(tl);
  await sleep(250);
  b.builtin("nextTabMru");
  await sleep(250);
  const step1 = b.active();
  b.commitMru();
  await sleep(200);
  check("core Ctrl+Tab from the right side goes to Links, not to the pair's other side", step1 === ln, step1?.title);
  b.builtin("nextTabMru");
  await sleep(250);
  b.commitMru();
  check("…and back: landing on the pair restores the side that last had focus (right)", b.active() === tl, b.active()?.title);
  const sw = b.service("switcher");
  if (sw && window.vitreSwitcher) {
    sw.open("latched");
    await sleep(500);
    const list = window.vitreSwitcher.state().list ?? [];
    check("the switcher lists the pair once (as its focused side)", list.length === 2 && list.includes(tl.id) && !list.includes(fn.id) && list.includes(ln.id), { list, ids: { fn: fn.id, tl: tl.id, ln: ln.id } });
    sw.close();
    await sleep(500);
  }

  log("--- 7. Ctrl+Shift+Page Down / Up move the pair as one");
  b.activate(fn);
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+Shift+PageDown");
  await sleep(400);
  check("Ctrl+Shift+Page Down: the pair moves past Links, together", order() === "Links | Field Notes | Tideline" && b.pairOf(fn)?.right === tl, order());
  b.activate(ln);
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+Shift+PageDown");
  await sleep(400);
  check("a tab moves past a whole pair in one step", order() === "Field Notes | Tideline | Links" && b.pairOf(fn)?.right === tl, order());
  b.run("moveTabLeft");
  await sleep(300);
  check("…and back in one step", order() === "Links | Field Notes | Tideline", order());

  log("--- 8. new tabs open after the pair and are selected");
  b.activate(fn);
  await sleep(300);
  b.focusPage();
  spike.press("Ctrl+T");
  await SL.until(() => b.active()?.kind === "home", 3000);
  const t8 = b.active();
  check("Ctrl+T from the left side: the new tab opens after the pair (not between its sides) and is selected", b.tabs.indexOf(t8) === b.tabs.indexOf(tl) + 1 && b.pairOf(fn)?.right === tl && !b.splitView.showing(), order());
  b.omni.close();
  b.closeTab(t8);
  await sleep(300);

  log("--- 9. a mouse side button over the other pane acts on that pane and focuses it");
  b.activate(fn);
  await SL.shown();
  await SL.load(http("dark.html?second"), tl);
  b.activate(fn);
  await sleep(300);
  const panes = SL.panes();
  SL.mouse(panes.right.x + 300, 500, { type: "mousemove" });
  await sleep(100);
  const ev = new Event("AppCommand", { bubbles: true });
  ev.command = "Back";
  window.dispatchEvent(ev);
  await SL.until(() => b.active() === tl && SL.loaded(tl, http("dark.html")), 6000);
  check("Back from a side button over the right pane: the right side is focused and went back", b.active() === tl && tl.url === http("dark.html"), { active: b.active()?.title, url: tl.url });

  log("--- 10. every other hardware key acts on the focused side, wherever the pointer rests");
  b.activate(fn);
  await sleep(300);
  b.focusPage();
  const p10 = SL.panes();
  SL.mouse(p10.right.x + 300, 500, { type: "mousemove" });
  await sleep(150);
  SL.appCommand("Search");
  await SL.until(() => b.omni.open, 2000);
  await sleep(200);
  check("hardware Search with the pointer over the right pane: the field opens for the focused (left) side", b.active() === fn && b.omni.open && b.omni.input.getAttribute("aria-label") === "Address for the left page", { active: b.active()?.title, label: b.omni.input.getAttribute("aria-label") });
  b.omni.close();
  await sleep(300);
  SL.mouse(p10.right.x + 300, 500, { type: "mousemove" });
  await sleep(100);
  SL.appCommand("Reload");
  await sleep(500);
  check("hardware Reload with the pointer over the right pane: focus stays on the left side", b.active() === fn, b.active()?.title);
  // The pointer leaves the window over its right edge: "mousecancel" is the top-level exit Gecko makes
  // of WM_MOUSELEAVE ("mouseout" would be a child widget's exit, which leaves the hover as it is).
  SL.mouse(Math.floor(window.innerWidth) - 1, 500, { type: "mousemove" });
  SL.mouse(Math.floor(window.innerWidth) - 1, 500, { type: "mousecancel" });
  await sleep(150);
  SL.appCommand("Back");
  await sleep(600);
  check("a side button with the pointer gone from the window acts on the focused side (no stale pane)", b.active() === fn, b.active()?.title);
  // Over the bar, above the right pane: the bar is not the pane.
  const overBar = SL.items().filter((x) => !x.active && x.x > p10.right.x).pop();
  if (overBar) {
    SL.mouse(overBar.x + 20, 30, { type: "mousemove" });
    await sleep(150);
    SL.appCommand("Forward");
    await sleep(500);
    check("a side button with the pointer over a bar circle above the right pane: focus stays", b.active() === fn, { active: b.active()?.title, over: overBar });
  } else log("no bar item over the right pane at this width");
  SL.mouse(p10.right.x + 300, 500, { type: "mousemove" });
  await sleep(100);
  const n10 = b.tabs.length;
  SL.appCommand("Close");
  await SL.until(() => b.tabs.length === n10 - 1, 3000);
  check("hardware Close with the pointer over the right pane closes the focused (left) side, as Ctrl+W does", !b.tabs.includes(fn) && b.tabs.includes(tl), order());

  log("--- 11. the split pill's halves and the capsule are stops of the bar (Tab, Left / Right, the Menu key)");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(400);
  const focusedIs = (el) => !!el && (document.activeElement === el || el.contains(document.activeElement));
  const lmain = () => SL.half("left").querySelector(".half-main");
  const rmain = () => SL.half("right").querySelector(".half-main");
  b.editAddress();
  await SL.until(() => b.omni.focused, 2000);
  spike.press("Tab");
  await sleep(200);
  check("Tab from the field (for the left side): the right half, the stop after the focused half", focusedIs(rmain()), document.activeElement?.className);
  spike.press("Left");
  await sleep(150);
  check("Left: the left half", focusedIs(lmain()), document.activeElement?.className);
  spike.press("Right");
  await sleep(100);
  check("Right: the right half again", focusedIs(rmain()), document.activeElement?.className);
  spike.press("Right");
  await sleep(150);
  const beyond = document.activeElement;
  check("Right: past the pill to the next stop (a circle, an extension button or +)", !focusedIs(lmain()) && !focusedIs(rmain()) && !!beyond?.closest?.("#vitre-root"), beyond?.className);
  spike.press("Left");
  await sleep(150);
  check("…and Left comes back to the right half", focusedIs(rmain()), document.activeElement?.className);
  SL.keyboardMenu();
  await SL.until(() => SL.menuOpen(), 3000);
  await sleep(250);
  check("the Menu key on the right half: that half's menu (splitpill: Swap sides, Separate tabs), focus not moved", SL.menuOpen() && SL.labels().includes("Swap sides") && SL.labels().includes("Separate tabs") && b.active() === fn && SL.half("right").classList.contains("vt-menu-owner"), { rows: SL.labels(), active: b.active()?.title });
  spike.press("p");
  await SL.until(() => !SL.menuOpen(), 2000);
  await sleep(300);
  check("its access key P swaps the sides from the keyboard", b.pairOf(fn)?.left === tl && b.pairOf(fn)?.right === fn, b.pairOf(fn) && [b.pairOf(fn).left.title, b.pairOf(fn).right.title]);
  spike.press("Escape");
  await sleep(200);
  b.activate(ln);
  await sleep(600);
  b.editAddress();
  await SL.until(() => b.omni.focused, 2000);
  spike.press("Tab");
  await sleep(150);
  const capHalves = () => [...SL.pairItem().querySelectorAll(".capsule-face .cap-half")];
  let reached = null;
  for (let i = 0; i < 12 && !reached; i++) {
    reached = capHalves().find((c) => focusedIs(c)) ?? null;
    if (!reached) {
      spike.press("Left");
      await sleep(120);
    }
  }
  check("with the pair in the background, Left / Right reach the capsule's halves", !!reached, document.activeElement?.className);
  if (reached) {
    SL.keyboardMenu();
    await SL.until(() => SL.menuOpen(), 3000);
    await sleep(250);
    check("the Menu key on the capsule: its menu (Swap sides, Separate tabs, Close other tabs, Close both tabs)", JSON.stringify(SL.labels()) === JSON.stringify(["Swap sides", "Separate tabs", "Close other tabs", "Close both tabs"]) && b.active() === ln, SL.labels());
    spike.press("Escape");
    await SL.until(() => !SL.menuOpen(), 2000);
    await sleep(200);
    const side = reached.closest(".cap-slot").classList.contains("left") ? "left" : "right";
    reached.focus({ focusVisible: true });
    spike.press("Enter");
    await SL.until(() => b.splitView.showing(), 3000);
    await sleep(300);
    check("Enter on a capsule half shows the pair with that side focused", !!b.splitView.showing() && b.splitView.sideOf(b.active()) === side, { side, active: b.active()?.title });
  }
});
