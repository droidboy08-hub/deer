// The Esc ladder (and Ctrl+W's close ladder) with several layers open at once, through the real key
// router: each Esc closes exactly the topmost layer.
//   A. menu over the find field over a peek:     Esc menu, Esc find, Esc peek
//   B. page menu over a peek with find parked:   Esc menu, Esc find (parked, 90), Esc peek (100)
//   C. Settings over find over a peek:           Esc Settings, Esc find, Esc peek
//   D. the latched switcher over a peek:         Esc switcher; the peek stays
//   E. the address field over a peek:            Esc the field; the peek stays
//   F. the Downloads panel over find on a tab:   Esc the panel; find stays, Esc find
//   G. Ctrl+W with Settings over a peek:         Settings, then the peek, then the tab
// Captures: ladder-a-three-layers, ladder-c-settings-over-find-peek.
/* global spike, Services, I */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const peek = b.service("peek");
  const find = b.service("find");
  const settings = b.service("settings");
  const switcher = b.service("switcher");
  const downloads = b.service("downloads");
  const EU = spike.EU;
  const key = (k, opts = {}) => EU.synthesizeKey(k, opts, window);
  const esc = async (ms = 500) => {
    key("KEY_Escape");
    await sleep(ms);
  };
  const layers = () => ({ menu: I.menuOpen(), find: find.isOpen(), peek: peek.isOpen(), settings: settings.isOpen(), switcher: switcher.isOpen(), omni: b.omni.open, downloads: downloads.isPanelOpen() });
  const fmt = (l) => Object.entries(l).filter(([, v]) => v).map(([k]) => k).join("+") || "none";

  const tab = await I.load(I.page("article.html"), 700);
  const openPeek = async () => {
    peek.open(I.page("counter.html"));
    await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html") && !peek.browser().webProgress?.isLoadingDocument, { timeout: 8000, what: "peek" });
    await sleep(700);
    peek.browser().focus();
    await sleep(200);
  };
  const findInPeek = async (text = "glass") => {
    key("f", { accelKey: true });
    await waitFor(() => find.isOpen(), { timeout: 3000, what: "find" });
    await sleep(400);
    EU.sendString(text, window);
    await sleep(700);
  };

  // ---- A. menu over the find field over a peek ----
  await openPeek();
  await findInPeek();
  const field = document.querySelector("#layer-find .vf-cap .vf-input");
  const fr = field.getBoundingClientRect();
  I.rightClick(fr.left + 40, fr.top + fr.height / 2);
  await I.waitMenu();
  I.describeMenu("A FIELD MENU");
  const a0 = layers();
  check("A: the find field's menu is open over find in a peek", a0.menu && a0.find && a0.peek, fmt(a0));
  await capture("ladder-a-three-layers");
  await esc();
  const a1 = layers();
  await esc();
  const a2 = layers();
  await esc(900);
  const a3 = layers();
  check("A: Esc closes the menu, then find, then the peek", fmt(a1) === "find+peek" && fmt(a2) === "peek" && fmt(a3) === "none", [fmt(a1), fmt(a2), fmt(a3)]);

  // ---- B. a page menu over the peek, find parked ----
  await openPeek();
  await findInPeek();
  peek.browser().focus(); // parks find (the field gives the keys back to the page)
  await sleep(400);
  const pb = peek.browser().getBoundingClientRect();
  I.rightClick(pb.left + pb.width / 2, pb.top + pb.height * 0.75);
  await I.waitMenu();
  I.describeMenu("B PAGE MENU");
  const b0 = layers();
  await esc();
  const b1 = layers();
  await esc();
  const b2 = layers();
  await esc(900);
  const b3 = layers();
  check("B: a page menu over a peek with find parked: Esc closes the menu, then find (parked), then the peek", b0.menu && b0.find && b0.peek && fmt(b1) === "find+peek" && fmt(b2) === "peek" && fmt(b3) === "none", [fmt(b0), fmt(b1), fmt(b2), fmt(b3)]);

  // ---- C. Settings over find over a peek ----
  await openPeek();
  await findInPeek();
  key(",", { ctrlKey: true });
  await waitFor(() => settings.isOpen(), { timeout: 3000, what: "settings" }).catch(() => null);
  await sleep(600);
  const c0 = layers();
  await capture("ladder-c-settings-over-find-peek");
  await esc(700);
  const c1 = layers();
  // Focus came back to where it was (the find field); Esc there closes find.
  await esc();
  const c2 = layers();
  await esc(900);
  const c3 = layers();
  check("C: Ctrl+, opens Settings over find in a peek; Esc closes Settings, then find, then the peek", c0.settings && c0.find && c0.peek && fmt(c1) === "find+peek" && fmt(c2) === "peek" && fmt(c3) === "none", [fmt(c0), fmt(c1), fmt(c2), fmt(c3)]);

  // ---- D. the latched switcher over a peek (needs a second tab) ----
  const other = b.newTab(I.page("long.html"), { background: true });
  await waitFor(() => other.url && !other.loading, { timeout: 10000, what: "second tab" });
  await sleep(500);
  await openPeek();
  key("a", { ctrlKey: true, shiftKey: true });
  await waitFor(() => switcher.isOpen(), { timeout: 3000, what: "switcher" }).catch(() => null);
  await sleep(700);
  const d0 = layers();
  await esc(700);
  const d1 = layers();
  check("D: Ctrl+Shift+A opens the switcher over a peek; Esc closes only the switcher", d0.switcher && d0.peek && fmt(d1) === "peek", [fmt(d0), fmt(d1)]);

  // ---- E. the address field over a peek ----
  peek.browser().focus();
  await sleep(200);
  key("l", { ctrlKey: true });
  await waitFor(() => b.omni.open, { timeout: 3000, what: "address field" }).catch(() => null);
  await sleep(400);
  const e0 = layers();
  await esc();
  const e1 = layers();
  check("E: Ctrl+L opens the address field over a peek; Esc closes only the field", e0.omni && e0.peek && fmt(e1) === "peek", [fmt(e0), fmt(e1)]);
  peek.close();
  await waitFor(() => !peek.isOpen(), { timeout: 3000, what: "peek closed" }).catch(() => null);
  await sleep(500);

  // ---- F. the Downloads panel over find on a tab ----
  b.activate(tab);
  await sleep(400);
  b.focusPage();
  await sleep(200);
  key("f", { accelKey: true });
  await waitFor(() => find.isOpen(), { timeout: 3000, what: "find on the tab" });
  EU.sendString("glass", window);
  await sleep(600);
  key("j", { ctrlKey: true });
  await waitFor(() => downloads.isPanelOpen(), { timeout: 3000, what: "downloads panel" }).catch(() => null);
  await sleep(500);
  const f0 = layers();
  await esc(600);
  const f1 = layers();
  await esc();
  const f2 = layers();
  check("F: Ctrl+J opens the Downloads panel over find; Esc closes the panel, then find", f0.downloads && f0.find && fmt(f1) === "find" && fmt(f2) === "none", [fmt(f0), fmt(f1), fmt(f2)]);

  // ---- G. Ctrl+W: Settings, then the peek, then the tab ----
  const tabs0 = b.tabs.length;
  await openPeek();
  key(",", { ctrlKey: true });
  await waitFor(() => settings.isOpen(), { timeout: 3000, what: "settings" }).catch(() => null);
  await sleep(500);
  key("w", { ctrlKey: true });
  await sleep(600);
  const g1 = { ...layers(), tabs: b.tabs.length };
  key("w", { ctrlKey: true });
  await sleep(900);
  const g2 = { ...layers(), tabs: b.tabs.length };
  b.focusPage();
  await sleep(200);
  key("w", { ctrlKey: true });
  await sleep(700);
  const g3 = { tabs: b.tabs.length };
  check("G: Ctrl+W closes Settings, then the peek, then the tab", !g1.settings && g1.peek && g1.tabs === tabs0 && !g2.peek && g2.tabs === tabs0 && g3.tabs === tabs0 - 1, { g1, g2, g3, tabs0 });
  log("router log", b.keys.log.slice(-30));
});
