// Settings › Keyboard shortcuts: rebinding one of Vitre's own verbs through the capture field, the
// refusals with their reason, and the new key then working in the key router (and the old one not).
//   node tools/build.mjs --out=build-settings --modules=settings
//   python tools/run.py --app build-settings --test tests/settings/rebind.js --name settings-rebind --timeout 200
// Captures: rebind-refused.png (the board SettingsKeys state: Ctrl+Shift+1 refused), rebind-saved.png,
// rebind-conflict.png.
/* global spike, Services, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  await spike.resize(1440, 900);
  await spike.activate();
  store.set({ theme: "dark" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });

  const svc = b.service("settings");
  const { panel } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");
  const settle = (ms = 400) => sleep(ms);
  const specOf = (action) => b.keys.bindings().filter((x) => x.action === action).map((x) => x.spec);
  // Peek is another module; this run counts its action instead (the router runs whatever is registered).
  let peeks = 0;
  b.registerAction("peekLink", () => peeks++);

  const page = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>Keys</title><body style='margin:0;background:#f3eee4;font:17px Segoe UI'><p style='margin:120px 40px'>A page that does not use Ctrl+Q or Ctrl+Shift+Y. <a href='https://example.com/'>A link</a></p>");
  b.navigate(b.active(), page);
  await waitFor(() => b.active().title === "Keys" && !b.active().loading, { timeout: 15000, what: "page" });
  await settle(500);

  check("defaults: the four rebindable verbs carry the keys Settings lists", specOf("peekLink").join() === "Ctrl+Q" && specOf("openAsTab").join() === "Alt+Enter" && specOf("switcherSearch").join() === "Ctrl+Shift+A" && specOf("downloadVideo").join() === "Ctrl+Shift+D", { peek: specOf("peekLink"), tab: specOf("openAsTab"), search: specOf("switcherSearch"), video: specOf("downloadVideo") });
  const pressOnPage = async (spec, ms = 450) => {
    b.focusPage();
    await sleep(150);
    spike.press(spec);
    await sleep(ms);
  };
  await pressOnPage("Ctrl+Q");
  check("before: Ctrl+Q runs Peek from the page", peeks === 1, { peeks, log: b.keys.log.slice(-2) });

  // ---------------------------------------------------------------- capture with refusals
  await pressOnPage("F1", 600);
  check("F1 opens Keyboard shortcuts", panel.isOpen && root().querySelector(".vs-content").dataset.page === "shortcuts");
  const rowEl = () => root().querySelector('[data-rebind="peekLink"]');
  rowEl().scrollIntoView({ block: "center" });
  await settle(200);
  spike.click(rowEl().querySelector(".vs-keybtn"));
  await settle(250);
  const field = () => rowEl().querySelector("[data-key-capture]");
  check("clicking the key opens the capture field with focus", !!field() && document.activeElement === field() && /Press the new keys/.test(field().textContent), document.activeElement && document.activeElement.className);
  const tabs0 = b.tabs.length;
  spike.press("Ctrl+Shift+1");
  await settle(250);
  const refusal = () => rowEl().querySelector(".vs-refusal")?.textContent ?? "";
  check("Ctrl+Shift+1 is refused with the board's reason", field().getAttribute("aria-invalid") === "true" && refusal() === "Windows uses Ctrl+Shift+1 to switch input language. Try another key." && field().textContent === "Ctrl+Shift+1", refusal());
  await spike.capture("rebind-refused");
  spike.press("Ctrl+T");
  await settle(400);
  check("Ctrl+T while capturing is only a key being tried: refused, no new tab", b.tabs.length === tabs0 && /Already used by New tab/.test(refusal()) && document.activeElement === field(), { tabs: b.tabs.length, refusal: refusal() });
  spike.press("Ctrl+W");
  await settle(300);
  check("Ctrl+W while capturing: refused, the tab and the panel stay", b.tabs.length === tabs0 && panel.isOpen && /Already used by Close the tab/.test(refusal()), refusal());
  spike.press("Alt+K");
  await settle(200);
  check("Alt+letter is refused (pages use access keys)", /access keys/.test(refusal()), refusal());
  spike.press("Ctrl+Shift+A");
  await settle(200);
  check("another verb's key is refused (Ctrl+Shift+A: Search tabs)", /Already used by Search tabs/.test(refusal()), refusal());
  const routerBefore = b.keys.log.length;
  spike.press("Ctrl+Shift+Y");
  await settle(400);
  check("Ctrl+Shift+Y is accepted and stored in settings.rebind", store.get().rebind.peekLink === "Ctrl+Shift+Y", store.get().rebind);
  check("the router acted on none of the captured keys", b.keys.log.length === routerBefore || !b.keys.log.slice(routerBefore).some((l) => l.startsWith("ACTION")), b.keys.log.slice(routerBefore));
  const keyBtn = () => rowEl().querySelector(".vs-keybtn");
  const resetBtn = () => rowEl().querySelector(".vs-link");
  check("the row shows the new key, a Reset, and focus is back on the key", keyBtn().textContent === "Ctrl+Shift+Y" && !resetBtn().hidden && document.activeElement === keyBtn(), { key: keyBtn().textContent, reset: !resetBtn().hidden });
  check("other rows that print the verb's key follow ({peekLink})", [...root().querySelectorAll(".vs-key")].some((k) => /Shift\+Enter, Ctrl\+Shift\+Y/.test(k.textContent)));
  check("Reset all shortcuts is enabled now", !root().querySelector(".vs-headrow .vs-btn").disabled);
  await spike.capture("rebind-saved");

  // ---------------------------------------------------------------- the router uses the new key
  check("b.keys.bindings() has the new key for peekLink", specOf("peekLink").join() === "Ctrl+Shift+Y", specOf("peekLink"));
  panel.close();
  await settle();
  await pressOnPage("Ctrl+Shift+Y");
  check("Ctrl+Shift+Y now runs Peek from the page", peeks === 2 && b.keys.log.slice(-3).some((l) => /ACTION peekLink via Ctrl\+Shift\+Y \[page-first\/reply\]/.test(l)), { peeks, log: b.keys.log.slice(-3) });
  await pressOnPage("Ctrl+Q");
  check("Ctrl+Q no longer does (and Firefox's own Ctrl+Q stays parked)", peeks === 2 && !Services.startup.shuttingDown, { peeks, log: b.keys.log.slice(-3) });
  const win2 = await spike.openWindow();
  const specs2 = win2.vitre.keys.bindings().filter((x) => x.action === "peekLink").map((x) => x.spec);
  check("a second window's router has the rebind too", specs2.join() === "Ctrl+Shift+Y", specs2);
  win2.close();
  await settle(400);
  await spike.activate();

  // ---------------------------------------------------------------- Esc cancels, conflicts show
  svc.open("shortcuts");
  await settle();
  rowEl().scrollIntoView({ block: "center" });
  spike.click(rowEl().querySelector(".vs-keybtn"));
  await settle(250);
  spike.press("Escape");
  await settle(300);
  check("Esc cancels the capture and keeps the panel open with the key unchanged", panel.isOpen && !field() && keyBtn().textContent === "Ctrl+Shift+Y" && document.activeElement === keyBtn());
  // A conflict that came from outside the page (about:config): both rows say so.
  store.set({ rebind: { peekLink: "Ctrl+Shift+Y", downloadVideo: "Ctrl+Shift+Y" } });
  await settle(300);
  const desc = (id) => root().querySelector(`[data-rebind="${id}"] .vs-desc`);
  check("two verbs on one key are shown as a conflict on both rows", desc("peekLink").classList.contains("vs-conflict") && /Also used by Download this video/.test(desc("peekLink").textContent) && desc("downloadVideo").classList.contains("vs-conflict"), [desc("peekLink").textContent, desc("downloadVideo").textContent]);
  root().querySelector('[data-rebind="downloadVideo"]').scrollIntoView({ block: "center" });
  await settle(200);
  await spike.capture("rebind-conflict");
  store.set({ rebind: { peekLink: "Ctrl+Shift+Y" } });
  await settle(300);

  // ---------------------------------------------------------------- Shift+click switch
  const segBtn = (label) => [...root().querySelectorAll(".vs-seg-btn")].find((x) => x.textContent === label);
  const peeksRow = () => [...root().querySelectorAll(".vs-row.compact .vs-title")].find((x) => /Shift\+click peeks instead/.test(x.textContent))?.closest(".vs-row");
  root().querySelector(".vs-main").scrollTop = 0;
  await settle(150);
  check("Different from Chrome lists Shift+click peeking while Shift+click is Peek", peeksRow() && !peeksRow().hidden);
  spike.click(segBtn("Open in new window"));
  await settle(300);
  check("Shift+click a link › Open in new window writes shiftClick and that difference goes away", store.get().shiftClick === "window" && peeksRow().hidden);
  spike.click(segBtn("Peek"));
  await settle(300);
  check("…and Peek brings it back", store.get().shiftClick === "peek" && !peeksRow().hidden);

  // ---------------------------------------------------------------- Reset
  rowEl().scrollIntoView({ block: "center" });
  await settle(150);
  spike.click(resetBtn());
  await settle(300);
  check("Reset puts Ctrl+Q back", !store.get().rebind.peekLink && keyBtn().textContent === "Ctrl+Q" && specOf("peekLink").join() === "Ctrl+Q" && resetBtn().hidden);
  check("Reset all shortcuts is disabled again", root().querySelector(".vs-headrow .vs-btn").disabled);
  panel.close();
  await settle();
  await pressOnPage("Ctrl+Q");
  check("Ctrl+Q runs Peek again", peeks === 3, peeks);
  // Reset all, through the button.
  store.set({ rebind: { switcherSearch: "Ctrl+Shift+K", openAsTab: "Ctrl+Shift+O" } });
  await settle(200);
  svc.open("shortcuts");
  await settle();
  spike.click(root().querySelector(".vs-headrow .vs-btn"));
  await settle(300);
  check("Reset all shortcuts clears every rebind", Object.keys(store.get().rebind).length === 0 && specOf("switcherSearch").join() === "Ctrl+Shift+A", store.get().rebind);
  panel.close();
  store.reset("theme");
  await settle();
  log("router log tail", b.keys.log.slice(-10));
});
