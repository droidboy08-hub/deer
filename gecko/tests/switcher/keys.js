// The switcher's keys (keymap.json "Tab switcher", SwitcherKeys board): quick tap, held stepping and
// release, cancel, Ctrl+W / Delete, typing latches, Ctrl+Shift+A, latched keys, Esc, losing focus,
// global keys swallowed, Type to search off, tab-bar order, the 'switcher' service, and that the
// page never sees any of it.
// python tools/run.py --test tests/switcher/keys.js --name switcher-keys --app build-switcher --timeout 240
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  // Pages that log the keys they see into their title (A..F), and one about glass for the search.
  const page = (name, colour) =>
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<!doctype html><meta charset=utf-8><title>${name}</title><body style="margin:0;background:${colour};font:28px Segoe UI"><p style="margin:140px 60px">${name}</p>` +
        `<script>window.seen=[];for(const t of ['keydown','keyup'])addEventListener(t,e=>{seen.push(t[3]+':'+e.key);document.body.dataset.seen=JSON.stringify(seen)},true)</script>`
    );
  const names = ["Alpha", "Bravo glass", "Charlie", "Delta glass", "Echo", "Foxtrot"];
  const colours = ["#f4f1ea", "#dfe9f3", "#f3e0e0", "#e2f0df", "#ece2f3", "#f3efd9"];
  const tabs = await S.openTabs(names.map((n, i) => page(n, colours[i])), { batch: 6 });
  const byName = (n) => b.tabs.find((t) => t.title === n);
  const title = () => S.active();
  const settle = () => sleep(350);
  const reset = async (order) => {
    await S.visit(order.map(byName));
    b.focusPage();
    await sleep(200);
  };
  const seenIn = async (t) => {
    const r = await new Promise((resolve) => {
      const mm = t.browser.messageManager;
      const id = "S:" + Math.random();
      mm.addMessageListener(id, function on(m) {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      });
      mm.loadFrameScript("data:," + encodeURIComponent(`sendAsyncMessage(${JSON.stringify(id)}, content.document.body.dataset.seen || '[]')`), false);
    });
    try {
      return JSON.parse(r);
    } catch {
      return [];
    }
  };
  const clearSeen = (t) => t.browser.messageManager.loadFrameScript("data:," + encodeURIComponent("content.wrappedJSObject.seen.length=0;content.document.body.dataset.seen='[]'"), false);

  // MRU after this: Alpha (current), Bravo, Charlie, Delta, Echo, Foxtrot.
  const MRU = ["Foxtrot", "Echo", "Delta glass", "Charlie", "Bravo glass", "Alpha"];
  await reset(MRU);
  check("MRU order", b.mru.map((id) => S.titleOf(id)).join() === [...MRU].reverse().join(), b.mru.map((id) => S.titleOf(id)));

  // ---- 1. quick tap ----
  log("--- quick tap");
  clearSeen(byName("Alpha"));
  const tap = async (spec) => {
    down("Control");
    await sleep(20);
    press(spec);
    await sleep(40);
    up("Control");
    await settle();
  };
  await tap("Tab");
  const tap1 = title();
  const shown1 = S.sw().timing.show;
  check("a quick Ctrl+Tab switches straight to the previous tab; the switcher never shows", tap1 === "Bravo glass" && shown1 === 0 && state().phase === "idle", { tap1, shown1 });
  check("... and the page never saw Tab (only Control)", (await seenIn(byName("Alpha"))).every((k) => /Control/.test(k)), await seenIn(byName("Alpha")));
  await tap("Tab");
  check("again goes back", title() === "Alpha", title());
  await tap("Shift+Tab");
  check("a quick Ctrl+Shift+Tab goes to the least recent tab", title() === "Foxtrot", title());
  await reset(MRU);

  // ---- 2. held stepping and release ----
  log("--- held");
  await S.holdOpen(1);
  const steps = [S.selected()];
  press("Tab");
  await sleep(80);
  steps.push(S.selected());
  press("Right");
  await sleep(80);
  steps.push(S.selected());
  press("Shift+Tab");
  await sleep(80);
  steps.push(S.selected());
  press("Left");
  await sleep(80);
  steps.push(S.selected());
  check("held: opens on the previous tab; Tab / Right next, Ctrl+Shift+Tab / Left back", steps.join() === "Bravo glass,Charlie,Delta glass,Charlie,Bravo glass" && !state().latched, steps);
  check("held: the active tab does not change while stepping", title() === "Alpha", title());
  press("Tab");
  await sleep(80);
  await S.release();
  check("held: letting go of Ctrl opens the selected card", title() === "Charlie", title());
  await reset(MRU);

  // ---- 3. cancel ----
  log("--- cancel");
  await S.holdOpen(1);
  press("Shift+Tab");
  await sleep(80);
  const onStart = S.selected();
  await S.release();
  check("held: back to the starting card, then release, cancels", onStart === "Alpha" && title() === "Alpha", { onStart, now: title() });
  await S.holdOpen(2);
  spike.click(720, 40, { ctrlKey: true }); // above the cards: the wallpaper
  await S.waitFor(() => state().phase === "idle", { what: "closed after click" });
  up("Control");
  await settle();
  check("held: a click on the wallpaper cancels", title() === "Alpha", title());
  await S.holdOpen(1);
  window.dispatchEvent(new Event("deactivate"));
  await S.waitFor(() => state().phase === "idle", { what: "closed after deactivate" });
  up("Control");
  await settle();
  check("held: losing window focus cancels back to the starting tab", title() === "Alpha", title());
  await spike.activate();

  // ---- 4. Ctrl+W and Delete ----
  log("--- closing cards");
  const extra = [b.newTab(page("Golf", "#fff"), { background: true }), b.newTab(page("Hotel", "#fff"), { background: true })];
  await Promise.all(extra.map((t) => S.loaded(t)));
  await reset([...MRU.slice(0, 5), "Golf", "Hotel", "Alpha"].map((n) => n));
  const count0 = b.tabs.length;
  await S.holdOpen(1); // selects Hotel
  const doomed = S.selected();
  press("W", { ctrlKey: true });
  await sleep(400);
  const afterW = { tabs: b.tabs.length, open: state().phase, selected: S.selected(), gone: !b.tabs.some((t) => t.title === doomed) };
  check("held: Ctrl+W closes the selected card's tab and the switcher stays", doomed === "Hotel" && afterW.tabs === count0 - 1 && afterW.open === "open" && afterW.gone && title() === "Alpha", { doomed, ...afterW });
  press("Delete");
  await sleep(400);
  const afterDel = { tabs: b.tabs.length, open: state().phase, selected: S.selected() };
  check("Delete (query empty) closes the selected card too", afterDel.tabs === count0 - 2 && afterDel.open === "open", afterDel);
  await S.release();
  check("letting go opens the card the selection moved to", title() === afterDel.selected, { now: title(), expected: afterDel.selected });
  await reset(MRU);

  // ---- 5. typing while held latches ----
  log("--- typing while held");
  clearSeen(byName("Alpha"));
  await S.holdOpen(1);
  press("G", { ctrlKey: true });
  press("L", { ctrlKey: true });
  press("A", { ctrlKey: true });
  await sleep(150);
  const typed = { ...state() };
  up("Control");
  await sleep(300);
  const stillOpen = state().phase === "open";
  check("held: Ctrl+letter types into the search and latches; letting go of Ctrl keeps it open", typed.query === "gla" && typed.latched && stillOpen && typed.list.length === 2, typed);
  const count = document.querySelector("#layer-switcher .sw-count")?.textContent;
  check("the count reads 2 of 6", count === "2 of 6", count);
  await spike.capture("keys-typing-latched-deck");
  press("Down");
  await sleep(100);
  const second = S.selected();
  press("Enter");
  await S.waitFor(() => state().phase === "idle", { what: "closed after Enter" });
  await settle();
  check("latched: Down moves within the matches, Enter opens", second === "Delta glass" && title() === "Delta glass", { second, now: title() });
  check("the page never saw the letters", (await seenIn(byName("Alpha"))).every((k) => /Control/.test(k)), await seenIn(byName("Alpha")));
  await reset(MRU);

  // ---- 6. Ctrl+Shift+A ----
  log("--- Ctrl+Shift+A");
  press("Shift+A", { ctrlKey: true });
  await S.waitFor(() => state().phase === "open", { what: "search open" });
  const s0 = { ...state() };
  check("Ctrl+Shift+A opens latched on the current tab with the field focused", s0.latched && S.selected() === "Alpha" && document.activeElement?.classList.contains("sw-input"), { s0, focus: document.activeElement?.className });
  press("Right");
  await sleep(80);
  const r1 = S.selected();
  S.EU.sendString("echo", window);
  await sleep(150);
  const q = { ...state() };
  press("Left");
  await sleep(80);
  const caret = document.querySelector("#layer-switcher .sw-input").selectionStart;
  check("latched: Right moves while the query is empty; typed text searches; Left then edits the text", r1 === "Bravo glass" && q.query === "echo" && q.list.length === 1 && S.selected() === "Echo" && caret === 3, { r1, q, caret });
  press("Escape");
  await S.waitFor(() => state().phase === "idle", { what: "closed after Esc" });
  await settle();
  check("latched: Esc cancels back to the starting tab", title() === "Alpha", title());

  // ---- 7. global keys do nothing while it is up ----
  log("--- global keys swallowed");
  const before = { tabs: b.tabs.length, windows: [...Services.wm.getEnumerator("navigator:browser")].length };
  await S.holdOpen(1);
  press("T", { ctrlKey: true });
  press("N", { ctrlKey: true });
  press("F5");
  await sleep(300);
  const g = { ...state(), tabs: b.tabs.length, windows: [...Services.wm.getEnumerator("navigator:browser")].length };
  check("Ctrl+T, Ctrl+N type T and N; F5 does nothing; no tab or window opens", g.query === "tn" && g.tabs === before.tabs && g.windows === before.windows, g);
  press("Escape");
  await S.waitFor(() => state().phase === "idle");
  up("Control");
  await settle();
  check("Esc in a latched switcher cancels even with Ctrl down", title() === "Alpha", title());

  // ---- 8. Type to search off ----
  b.sys("VitreSettings").set({ typeToSearch: false });
  await sleep(150);
  await S.holdOpen(1);
  press("G", { ctrlKey: true });
  await sleep(150);
  const off = { ...state() };
  await S.release();
  check("with Type to search off a held Ctrl+letter does nothing and release still opens the card", off.query === "" && !off.latched && title() === "Bravo glass", { off, now: title() });
  b.sys("VitreSettings").reset("typeToSearch");
  await reset(MRU);

  // ---- 9. grid arrows ----
  await S.setStyle("grid");
  press("Shift+A", { ctrlKey: true });
  await S.waitFor(() => state().phase === "open");
  await sleep(300);
  const cols = Math.round(document.querySelector("#layer-switcher .sw-grid")?.clientWidth ? 4 : 0);
  press("Down");
  await sleep(100);
  const down1 = state().sel;
  press("Up");
  await sleep(100);
  const up1 = state().sel;
  check("grid, latched, empty query: Down and Up move a row", down1 === cols && up1 === 0, { down1, up1, cols });
  press("Escape");
  await S.waitFor(() => state().phase === "idle");
  await S.setStyle("deck");

  // ---- 10. tab-bar order ----
  b.sys("VitreSettings").set({ tabOrder: "bar" });
  await sleep(150);
  b.activate(byName("Bravo glass"));
  await settle();
  b.focusPage();
  await tap("Tab");
  const right = title();
  b.sys("VitreSettings").reset("tabOrder");
  await sleep(150);
  const barOrder = b.tabs.map((t) => t.title);
  check("tab-bar order: a quick Ctrl+Tab goes to the tab on the right", right === barOrder[(barOrder.indexOf("Bravo glass") + 1) % barOrder.length], { right, barOrder });
  await reset(MRU);

  // ---- 11. the service and the Esc ladder ----
  const api = b.service("switcher");
  api.open("cycle");
  await S.waitFor(() => state().phase === "open");
  const viaService = { ...state(), isOpen: api.isOpen() };
  check("service open('cycle') without Ctrl down opens latched on the previous tab", viaService.latched && viaService.isOpen && S.selected() === "Bravo glass", viaService);
  const used = b.escape();
  await S.waitFor(() => state().phase === "idle");
  check("the Esc ladder (b.escape) closes the latched switcher", used && !api.isOpen() && title() === "Alpha", { used });
  api.open("search");
  await S.waitFor(() => state().phase === "open");
  check("service open('search') selects the current tab", S.selected() === "Alpha" && state().latched, state());
  b.escape();
  await S.waitFor(() => state().phase === "idle");
  log("router log tail", b.keys.log.slice(-6));
});
