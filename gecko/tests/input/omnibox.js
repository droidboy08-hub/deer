// The address field: geometry and look (captures to compare with the board HomeSearch), suggestions
// (typed row, open tabs, history from Places), its keys, focus hand-over, private windows, and the
// cost of a history search in a large history.
//   python tools/run.py --test tests/input/omnibox.js --name input-omnibox --timeout 400
// Captures in tests/input/out: omni-1-open-light, omni-2-typed-light, omni-3-selected, omni-4-dark,
// omni-5-home (the board's scene), omni-6-history, omni-7-bar-focus, omni-8-narrow.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { press, key } = K;
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const $ = (id) => document.getElementById(id);
  const input = b.omni.input;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const rows = () => [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((el) => ({
    title: el.querySelector(".omni-title").textContent,
    detail: el.querySelector(".omni-detail").textContent,
    tail: el.querySelector(".omni-tail")?.textContent ?? "",
    selected: el.classList.contains("selected"),
    icon: el.querySelector(".omni-glyph img") ? "img" : "glyph",
  }));
  const groups = () => [...document.querySelectorAll("#vitre-omni-list .omni-group")].map((el) => el.textContent);
  const selected = () => rows().findIndex((r) => r.selected);
  const settle = (ms = 350) => sleep(ms);
  /** Wait until the history rows for the current text have arrived. */
  const suggestions = async (ms = 450) => { await sleep(ms); return rows(); };
  await spike.resize(1440, 900);
  await spike.activate();

  // History in the shape of the board's mock sites.
  const day = 86400000;
  const visit = (url, title, n = 1, ago = 1) => ({ url, title, visits: Array.from({ length: n }, (_, i) => ({ date: new Date(Date.now() - ago * day - i * 3600000) })) });
  await PlacesUtils.history.insertMany([
    visit("https://fieldnotes.press/", "Field Notes", 9, 1),
    visit("https://fieldnotes.press/archive", "Archive", 4, 2),
    visit("https://fieldnotes.press/ice", "The quiet science of ice", 3, 3),
    visit("https://tideline.fm/", "Tideline", 5, 1),
    visit("https://refract.wiki/wiki/Float_glass", "Float glass - Refract", 2, 4),
    visit("https://code.vitre.dev/vitre-shell/issues/39", "ETag mismatch on resume #39", 2, 2),
    visit("https://longexposure.club/slow-light", "Slow light - Long Exposure Club", 1, 6),
    visit("https://www.fields-institute.example/medal", "Fields medal", 1, 9),
  ]);

  await K.load("https://example.com/");
  const first = b.active();
  b.newTab("https://example.org/", { background: true });
  await waitFor(() => b.tabs.length === 2 && !b.tabs[1].loading && b.tabs[1].title, { timeout: 20000, what: "second tab" });
  await sleep(600);

  // ------------------------------------------------------------------ 1. open from the pill
  log("--- 1. opening");
  const pill = rect(b.bar.item(first.id));
  spike.click(document.querySelector("#vitre-bar .item.active .address"));
  await sleep(120);
  const mid = rect($("vitre-omni-field"));
  await sleep(500);
  const field = rect($("vitre-omni-field"));
  const panel = $("vitre-omni-panel").hidden ? null : rect($("vitre-omni-panel"));
  check("the field grows out of the pill to 640x48, centred, 12 px from the top", field.w === 640 && field.h === 48 && field.y === 12 && field.x === Math.round((window.innerWidth - 640) / 2) && mid.w > pill.w - 1 && mid.w <= 640, { pill, mid, field });
  check("the address is in the field, selected, and the field has focus", b.omni.open && document.activeElement === input && input.value === "https://example.com/" && input.selectionStart === 0 && input.selectionEnd === input.value.length, input.value);
  const cs = (el) => window.getComputedStyle(el);
  check("the field is glass: radius 24, a lens for its final size, the light tint, 15 px text", cs($("vitre-omni-field")).borderRadius === "24px" && /url\(/.test(cs($("vitre-omni-field").querySelector(".lens")).backdropFilter) && cs(input).fontSize === "15px" && cs($("vitre-omni-field").querySelector(".tint")).backgroundImage.includes("0.72"), { radius: cs($("vitre-omni-field")).borderRadius, lens: cs($("vitre-omni-field").querySelector(".lens")).backdropFilter, tint: cs($("vitre-omni-field").querySelector(".tint")).backgroundImage });
  // The items step aside by fading their tint, rim and faces and then hiding their lens (an item at
  // opacity 0 would be a backdrop root and show the sharp page through its half-faded shape).
  const stepped = [...document.querySelectorAll("#vitre-bar .item")].every((el) => cs(el.querySelector(":scope > .tint")).opacity === "0" && cs(el.querySelector(":scope > .lens")).visibility === "hidden" && cs(el).pointerEvents === "none");
  check("while it is open the page is dimmed at 0.26 and the rest of the bar steps aside; the window controls stay", cs($("vitre-omni-scrim")).backgroundColor === "rgba(0, 0, 0, 0.26)" && cs($("vitre-omni-scrim")).opacity === "1" && stepped && cs($("vitre-winctl")).opacity === "1", { scrim: cs($("vitre-omni-scrim")).backgroundColor, stepped });
  const recent = await suggestions();
  check("with nothing typed the panel lists recent history under 'History', nothing highlighted", panel && panel.y === 68 && panel.x === field.x && panel.w === 640 && groups().join() === "History" && recent.length >= 5 && selected() === -1 && recent.every((r) => r.icon === "img"), { panel, groups: groups(), recent: recent.map((r) => r.title) });
  await spike.capture("omni-1-open-light");

  // ------------------------------------------------------------------ 2. typing
  log("--- 2. suggestions");
  spike.type("exa");
  let list = await suggestions();
  check("typing words: the first row is the search, highlighted; then matching open tabs with 'Switch to tab'; the active tab is never offered", list[0].title === "exa" && list[0].detail === "Search" && list[0].selected && list[1].tail.startsWith("Switch to tab") && list[1].detail === "example.org" && !list.some((r) => r.detail === "example.com" && r.tail), list);
  // Board (HomeSearch): "Switch to tab" rows carry their own tail; only history gets a group label.
  check("groups: no label over the open tabs, 'History' over the rest", !groups().includes("Open tabs") && groups().join() === "History", groups());
  input.select();
  spike.type("field");
  list = await suggestions();
  check("history: sites whose host starts with what was typed come first, most used first", list[0].detail === "Search" && list[1].title === "Field Notes" && list[1].detail === "fieldnotes.press" && list.slice(1, 4).every((r) => r.detail.startsWith("fieldnotes.press")) && list.some((r) => r.title === "Fields medal") && groups().join() === "History", { list, groups: groups() });
  await spike.capture("omni-2-typed-light");
  input.select();
  spike.type("ice science");
  list = await suggestions();
  check("several words must all match, in the title or the address", list.length === 2 && list[1].title === "The quiet science of ice", list);
  input.select();
  spike.type("fieldnotes.press/arc");
  list = await suggestions();
  check("something that looks like an address offers 'Go to address' first", list[0].detail === "Go to address" && list[0].title === "fieldnotes.press/arc" && list[0].selected && list[1].title === "Archive", list);

  // ------------------------------------------------------------------ 3. moving and choosing
  log("--- 3. keys in the field");
  input.select();
  spike.type("exa");
  await suggestions();
  press("Down");
  const down1 = selected();
  press("Up");
  press("Up");
  const wrappedUp = selected();
  press("Down");
  press("Down");
  check("Down and Up move the highlight and wrap", down1 === 1 && wrappedUp === rows().length - 1 && selected() === 1, { down1, wrappedUp, now: selected() });
  await spike.capture("omni-3-selected");
  press("Enter");
  await settle(500);
  check("Enter on a 'Switch to tab' row switches to that tab and closes the field", !b.omni.open && b.active() === b.tabs[1] && b.tabs.length === 2 && document.activeElement === gBrowser.selectedBrowser, { active: b.active().url, tabs: b.tabs.length });
  b.activate(first);
  await settle();

  // What Enter, Alt+Enter and Ctrl+Enter ask for (recorded, so nothing depends on a search site loading).
  const went = [];
  const realNavigate = b.navigate.bind(b);
  const realNewTab = b.newTab.bind(b);
  b.navigate = (t, url) => went.push("here " + url);
  b.newTab = (url, opts) => (url ? went.push("tab " + url) : realNewTab(url, opts));
  const typeAndPress = async (text, spec) => { b.editAddress(); await sleep(150); spike.type(text); await sleep(200); press(spec); await sleep(250); };
  await typeAndPress("what is refraction", "Enter");
  await typeAndPress("example.org/typed", "Enter");
  await typeAndPress("localhost:8080/x", "Enter");
  await typeAndPress("glass", "Alt+Enter");
  await typeAndPress("tideline", "Ctrl+Enter");
  await typeAndPress("two words", "Ctrl+Enter");
  check("Enter searches or goes; Alt+Enter opens in a new tab; Ctrl+Enter adds www. and .com to a bare word",
    went.join("\n") === ["here https://www.google.com/search?q=what%20is%20refraction", "here https://example.org/typed", "here http://localhost:8080/x", "tab https://www.google.com/search?q=glass", "here https://www.tideline.com", "here https://www.google.com/search?q=two%20words"].join("\n") && !b.omni.open, went);
  went.length = 0;
  b.sys("VitreSettings").set({ searchEngine: "duckduckgo" });
  await sleep(150);
  await typeAndPress("float glass", "Enter");
  b.sys("VitreSettings").reset("searchEngine");
  await sleep(150);
  check("the search engine comes from Vitre's own list in Settings", went.join() === "here https://duckduckgo.com/?q=float%20glass", went);
  went.length = 0;
  b.editAddress();
  await sleep(200);
  press("Enter");
  await sleep(200);
  check("Enter with the address untouched reloads nothing new: it goes to the same address", went.join() === "here https://example.com/" && !b.omni.open, went);
  went.length = 0;
  b.editAddress();
  await suggestions();
  press("Down");
  const picked = rows()[selected()];
  press("Alt+Enter");
  await sleep(250);
  check("Alt+Enter on a history row opens that page in a new tab", went.length === 1 && went[0].startsWith("tab https://") && went[0].includes(picked.detail.split("/")[0]), { went, picked });
  // Rows by mouse.
  went.length = 0;
  b.editAddress();
  spike.type("tide");
  await suggestions();
  const row = [...document.querySelectorAll("#vitre-omni-list .omni-item")].find((el) => el.textContent.includes("Tideline"));
  spike.click(row, { type: "mousemove" });
  await sleep(100);
  const hovered = selected();
  spike.click(row);
  await sleep(250);
  check("pointing at a row highlights it; a click goes there", hovered === rows().length - 1 + 0 || hovered >= 1, hovered);
  check("... and the click navigates", went.join() === "here https://tideline.fm/" && !b.omni.open, went);
  b.navigate = realNavigate;
  b.newTab = realNewTab;

  // ------------------------------------------------------------------ 4. Esc, editing, Shift+Delete
  log("--- 4. Esc, editing, removing history");
  await K.load(K.pageURL("keys.html"));
  b.focusPage();
  await sleep(250);
  press("Ctrl+L");
  await sleep(450);
  const url = first.url;
  spike.type("abc def");
  await suggestions(300);
  press("Escape");
  await sleep(150);
  const afterEsc1 = { open: b.omni.open, value: input.value, panel: !$("vitre-omni-panel").hidden, selected: input.selectionEnd - input.selectionStart };
  press("Escape");
  await sleep(300);
  check("the first Esc puts the address back (selected) and closes the suggestions; the second closes the field", afterEsc1.open && afterEsc1.value === url && !afterEsc1.panel && afterEsc1.selected === url.length && !b.omni.open, afterEsc1);
  const before = (await K.seen()).length;
  spike.type("x");
  const after = await K.seen();
  check("focus is back on the page: the next key goes to the page, and that Esc did not reach it", document.activeElement === gBrowser.selectedBrowser && after.slice(before).includes("d:x") && !after.join().includes("escape"), after.slice(-6));
  press("Ctrl+L");
  await sleep(450);
  K.mark();
  press("Ctrl+A");
  spike.type("abc def");
  const e1 = input.value;
  press("Ctrl+Backspace");
  const e2 = input.value;
  press("Ctrl+Z");
  const e3 = input.value;
  press("Home");
  press("Shift+End");
  press("Delete");
  const e4 = input.value;
  spike.type("xy");
  press("Left");
  press("Shift+Right");
  press("Backspace");
  const e5 = input.value;
  await sleep(200);
  check("editing keys work in the field (Ctrl+A, typing, Ctrl+Backspace, Ctrl+Z, Home, Shift+End, Delete, arrows) and run no action", e1 === "abc def" && e2 === "abc " && e3 === "abc def" && e4 === "" && e5 === "x" && K.actions().length === 0 && b.omni.open, { e1, e2, e3, e4, e5, actions: K.actions() });
  input.select();
  spike.type("fields");
  list = await suggestions();
  const medal = list.findIndex((r) => r.title === "Fields medal");
  press("Shift+Delete"); // nothing moved onto: this is Cut (of an empty selection), the row stays
  await sleep(300);
  const stillThere = (await PlacesUtils.history.fetch("https://www.fields-institute.example/medal")) !== null && rows().some((r) => r.title === "Fields medal");
  for (let i = 0; i < medal; i++) press("Down");
  const onMedal = rows()[selected()]?.title;
  press("Shift+Delete");
  await waitFor(async () => (await PlacesUtils.history.fetch("https://www.fields-institute.example/medal")) === null, { timeout: 5000, what: "history entry removed" });
  await sleep(400);
  check("Shift+Delete removes a history row only once the user moved onto it; before that the row stays", medal > 0 && stillThere && onMedal === "Fields medal" && !rows().some((r) => r.title === "Fields medal") && b.omni.open, { medal, stillThere, onMedal, rows: rows().map((r) => r.title) });
  press("Escape");
  press("Escape");
  await settle();

  // ------------------------------------------------------------------ 5. leaving the field
  log("--- 5. focus");
  press("Ctrl+L");
  await sleep(400);
  spike.click($("vitre-omni-scrim"));
  await settle();
  check("a press on the dimmed page closes the field and gives the page focus", !b.omni.open && document.activeElement === gBrowser.selectedBrowser);
  press("Ctrl+L");
  await sleep(400);
  // Feature modules may add stops inside the active pill, after the address (the extensions
  // module's buttons in b.bar.accessories(), barkeys.ts data-bar-stop): they come first after the
  // address, in drawn order, before the next tab circle.
  const accessoryStops = () => [...(b.bar.accessories()?.querySelectorAll("[data-bar-stop]") ?? [])].filter((s) => !s.closest("[inert]") && s.getClientRects().length > 0).length;
  const extra = accessoryStops();
  press("Tab");
  await settle();
  const first1 = document.activeElement;
  for (let i = 0; i < extra; i++) press("Right");
  const stop1 = document.activeElement;
  press("Right");
  const stop2 = document.activeElement;
  for (let i = 0; i < extra + 2; i++) press("Left");
  const stop3 = document.activeElement;
  await sleep(200);
  await spike.capture("omni-7-bar-focus");
  check("Tab leaves the field for the tab bar (pill accessories first, if any); Left and Right cross its stops", !b.omni.open && (extra ? !!first1.closest("[data-bar-stop]") : first1 === stop1) && stop1.classList.contains("circle-face") && stop2.classList.contains("face") && stop3.classList.contains("address"), { extra, stops: [first1.className, stop1.className, stop2.className, stop3.className] });
  for (let i = 0; i < extra + 1; i++) press("Right");
  press("Enter");
  await settle(500);
  check("Enter on a tab circle switches to it", b.active() === b.tabs[1], b.active().url);
  b.activate(first);
  await settle();
  press("Ctrl+L");
  await sleep(300);
  press("Shift+Tab");
  await sleep(150);
  const back = document.activeElement.className;
  press("Escape");
  await settle();
  check("Shift+Tab goes the other way, and Esc from the bar returns to the page", /face/.test(back) && document.activeElement === gBrowser.selectedBrowser, back);
  // A tab switch closes the field; opening a tab keeps the new field focused through the switch.
  press("Ctrl+L");
  await sleep(300);
  press("Ctrl+PageDown");
  await settle(500);
  check("switching tabs closes the field and the new tab's page has focus", !b.omni.open && b.active() === b.tabs[1] && document.activeElement === gBrowser.selectedBrowser);
  b.activate(first);
  await settle();

  // ------------------------------------------------------------------ 6. Ctrl+H
  log("--- 6. recent history");
  b.focusPage();
  await sleep(150);
  press("Ctrl+H");
  list = await suggestions(600);
  check("Ctrl+H opens the field empty with the History group", b.omni.open && input.value === "" && groups().join() === "History" && list.length >= 5, { value: input.value, groups: groups(), n: list.length });
  await spike.capture("omni-6-history");
  press("Escape");
  await settle();

  // ------------------------------------------------------------------ 7. dark page, Home
  log("--- 7. themes");
  await K.load(K.dataPage("Dark page", "A dark page.", "#101014"));
  await waitFor(() => b.theme() === "dark", { timeout: 8000, what: "dark theme" });
  press("Ctrl+L");
  await sleep(400);
  input.select();
  spike.type("tide");
  await suggestions();
  check("over a dark page the field uses the dark tint and white text", cs($("vitre-omni-field").querySelector(".tint")).backgroundColor === "rgba(16, 16, 20, 0.38)" && cs(input).color === "rgb(255, 255, 255)", { tint: cs($("vitre-omni-field").querySelector(".tint")).backgroundColor, color: cs(input).color });
  await spike.capture("omni-4-dark");
  press("Escape");
  press("Escape");
  await settle();

  b.newTab();
  await waitFor(() => b.active().url === "about:vitre-home" && b.omni.open, { timeout: 10000, what: "Home tab with the field" });
  const homeTab = b.active();
  await waitFor(() => homeTab.browser.contentDocument?.documentElement.dataset.state === "ready", { timeout: 15000, what: "Home background" });
  await sleep(500);
  spike.type("fie");
  list = await suggestions();
  log("Home theme " + b.theme() + ", rows " + JSON.stringify(list.map((r) => r.title)));
  check("on Home the field is empty at first and typing lists the same suggestions", list[0].title === "fie" && list.some((r) => r.title === "Field Notes"), list.map((r) => r.title));
  await spike.capture("omni-5-home");
  press("Escape");
  press("Escape");
  await settle();
  check("Esc on Home leaves the Home page focused", !b.omni.open && document.activeElement === gBrowser.selectedBrowser && b.active() === homeTab);
  // Typing on Home starts a search.
  spike.type("r");
  await sleep(300);
  const typed1 = { open: b.omni.open, value: input.value };
  spike.type("efr");
  await sleep(200);
  check("typing on Home opens the field with what was typed (typeToSearch)", typed1.open && typed1.value === "r" && input.value === "refr", { typed1, value: input.value });
  press("Escape");
  press("Escape");
  await settle();
  b.sys("VitreSettings").set({ typeToSearch: false });
  await sleep(150);
  spike.type("q");
  await sleep(300);
  check("with typeToSearch off, typing on Home does nothing", !b.omni.open);
  b.sys("VitreSettings").reset("typeToSearch");
  await sleep(150);
  press("Ctrl+F");
  await sleep(300);
  check("Ctrl+F on Home focuses the search field (Home has no page to search)", b.omni.open && document.activeElement === input);
  press("Escape");
  await settle();
  b.closeTab(homeTab);
  await settle();

  // ------------------------------------------------------------------ 8. private windows
  log("--- 8. private windows");
  const pw = await spike.openWindow({ private: true });
  await pw.spike.resize(1000, 700);
  pw.vitre.navigate(pw.vitre.active(), "https://example.org/?private-window");
  await waitFor(() => pw.vitre.active().url.includes("private-window") && !pw.vitre.active().loading, { timeout: 20000, what: "page in the private window" });
  pw.vitre.newTab("https://example.com/?private-two", { background: true });
  await waitFor(() => pw.vitre.tabs.length === 2 && !pw.vitre.tabs[1].loading, { timeout: 20000, what: "second private tab" });
  window.focus();
  b.activate(first);
  await settle();
  press("Ctrl+L");
  await sleep(300);
  input.select();
  spike.type("example");
  list = await suggestions();
  const offered = list.filter((r) => r.tail).map((r) => r.detail);
  const leak = [...document.querySelectorAll("#vitre-omni-list .omni-item")].some((el) => el.textContent.includes("private"));
  check("a normal window is never offered a private window's tabs", offered.join() === "example.org" && !leak, { offered, list: list.map((r) => r.title + " | " + r.detail) });
  press("Escape");
  press("Escape");
  await settle();
  pw.focus();
  await sleep(400);
  pw.vitre.editAddress();
  await sleep(300);
  pw.vitre.omni.input.select();
  pw.spike.type("example");
  await sleep(500);
  const privateRows = [...pw.document.querySelectorAll("#vitre-omni-list .omni-item")].map((el) => el.textContent);
  check("a private window is offered its own tabs only", privateRows.some((t) => t.includes("Switch to tab")) && privateRows.filter((t) => t.includes("Switch to tab")).length === 1 && privateRows.filter((t) => t.includes("Switch to tab")).every((t) => t.includes("example.com")), privateRows);
  await pw.spike.capture("omni-9-private");
  pw.close();
  await sleep(600);
  window.focus();
  await sleep(300);

  // ------------------------------------------------------------------ 9. narrow window
  await spike.resize(700, 600);
  await sleep(300);
  b.focusPage();
  press("Ctrl+L");
  await sleep(500);
  const narrow = rect($("vitre-omni-field"));
  const capsule = rect($("vitre-winctl"));
  check("in a narrow window the field starts 24 px from the left and stops 16 px short of the window controls", narrow.x === 24 && narrow.x + narrow.w === capsule.x - 16, { narrow, capsule });
  await spike.capture("omni-8-narrow");
  press("Escape");
  await settle();
  await spike.resize(1440, 900);

  // ------------------------------------------------------------------ 10. a large history
  log("--- 10. history search in a large history");
  const words = ["glass", "river", "north", "field", "atlas", "paper", "stone", "light", "cloud", "tides", "ember", "quiet", "maple", "orbit", "delta", "lumen"];
  const N = 30000;
  const t0 = performance.now();
  for (let chunk = 0; chunk < N / 5000; chunk++) {
    const batch = [];
    for (let i = chunk * 5000; i < (chunk + 1) * 5000; i++) {
      const w1 = words[i % 16], w2 = words[(i * 7) % 16], w3 = words[(i * 13) % 16];
      batch.push({ url: `https://${w1}${i % 900}.example/${w2}/${w3}-${i}`, title: `${w2} ${w3} page ${i}`, visits: [{ date: new Date(Date.now() - (i % 400) * day / 4) }] });
    }
    await PlacesUtils.history.insertMany(batch);
  }
  log("seeded " + N + " places in " + Math.round(performance.now() - t0) + " ms");
  await sleep(1500);
  press("Ctrl+L");
  await sleep(400);
  const times = [];
  for (const q of ["g", "gl", "glass", "glass river", "page 2999", "zzzz-nothing", "field", "example", "quiet maple orbit"]) {
    const t = performance.now();
    const found = await b.omni.history.query(q, 10);
    times.push({ q, ms: Math.round(performance.now() - t), rows: found ? found.length : null });
  }
  log("history search times at " + N + " places: " + JSON.stringify(times));
  check("every history search answers in a large history, the slowest under 400 ms", times.every((t) => t.rows !== null && t.ms < 400), times);
  // A burst of keystrokes: the searches before the last one are dropped, not queued.
  const burst = performance.now();
  input.select();
  for (const ch of "river qu") { spike.type(ch); await sleep(25); }
  const tabsAtOnce = rows().length;
  await waitFor(() => rows().some((r) => /river quiet/.test(r.title)) && rows().length > 1, { timeout: 5000, what: "history rows after a burst" });
  const burstMs = Math.round(performance.now() - burst);
  const pendingNull = await Promise.all([b.omni.history.query("gl", 10), b.omni.history.query("gla", 10), b.omni.history.query("glas", 10)]);
  check("typing fast: the typed row is there at once, history follows shortly, and superseded searches are cancelled", tabsAtOnce >= 1 && burstMs < 1500 && pendingNull[0] === null && pendingNull[1] === null && Array.isArray(pendingNull[2]), { tabsAtOnce, burstMs, superseded: pendingNull.map((r) => (r === null ? "cancelled" : r.length)) });
  press("Escape");
  press("Escape");
  await settle();
});
