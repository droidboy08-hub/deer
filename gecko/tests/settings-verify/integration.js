// Settings verifier: with every module in the build. The pages other modules register (Video
// downloads, Extensions) in the sidebar; one panel at a time with Downloads (Ctrl+J and Ctrl+, hand
// over, focus comes back); Settings over a peek (Ctrl+W and Esc close the panel first, Ctrl+Q makes
// no second peek); Ctrl+F with find open goes to Find a setting; Ctrl+Tab under the panel.
//   node tools/build.mjs --out=build-settings-verify-full
//   python tools/run.py --app build-settings-verify-full --test tests/settings-verify/integration.js --name settings-verify-integration --timeout 300
// Captures: integration-video-downloads.png, integration-extensions.png, integration-over-peek.png.
// Modules other authors are still building may be missing: their checks are skipped, logged.
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const svc = b.service("settings");
  log("modules:", b.modules.join(","), "errors:", JSON.stringify(b.moduleErrors));
  await V.load(V.page("Integration page", "<p style='margin:120px 40px'>Links: <a id=l href='https://example.com/'>example</a></p>"));

  // ---------------------------------------------------------------- registered pages
  await sleep(1500);
  const navIds = () => [...V.root()?.querySelectorAll(".vs-navitem") ?? []].map((n) => n.dataset.id);
  svc.open("general");
  await sleep(400);
  const ids = navIds();
  log("sidebar:", ids.join(" "));
  const extra = ids.filter((id) => !["general", "appearance", "home", "tabs", "downloads", "privacy", "search", "shortcuts", "about"].includes(id));
  check("other modules' pages are in the sidebar, between the built-in ones by their order", extra.length >= 1 && ids.indexOf("downloads") < ids.indexOf(extra[0]) && ids.indexOf(extra[extra.length - 1]) < ids.indexOf("search"), ids);
  for (const id of extra) {
    svc.open(id);
    await sleep(900);
    const host = V.content().querySelector(".vs-ext");
    check(`registered page "${id}" draws into its host under its title`, V.shown() === id && !!host && host.childElementCount > 0 && !V.content().querySelector(".vs-empty"), { shown: V.shown(), children: host?.childElementCount });
    await spike.capture(`integration-${id.replace(/[^a-z0-9-]/gi, "")}`);
  }
  V.consoleCheck("registered pages");

  // ---------------------------------------------------------------- Downloads, one panel at a time
  if (b.service("downloads")) {
    b.focusPage();
    await sleep(150);
    V.press("Ctrl+Comma");
    await sleep(500);
    V.press("Ctrl+J");
    await sleep(700);
    check("Ctrl+J with Settings open: Downloads takes the window, Settings steps aside", b.root.classList.contains("downloads-open") && !panel.isOpen && b.root.classList.contains("panel-open"), b.root.className);
    V.press("Ctrl+J");
    await sleep(700);
    check("Ctrl+J again: Downloads closes, nothing is left open, focus back on the page", !b.root.classList.contains("downloads-open") && !b.root.classList.contains("panel-open") && !panel.isOpen && V.active() === gBrowser.selectedBrowser, { root: b.root.className, focus: V.describe(V.active()) });
    V.press("Ctrl+J");
    await sleep(700);
    V.press("Ctrl+Comma");
    await sleep(700);
    check("Ctrl+, with Downloads open: Downloads closes, Settings opens with focus", !b.root.classList.contains("downloads-open") && V.isOpen() && V.focusInSheet() && b.root.classList.contains("panel-open"), { root: b.root.className, focus: V.describe(V.active()) });
    V.press("Escape");
    await sleep(500);
    check("Esc closes Settings; panel-open is gone", !panel.isOpen && !b.root.classList.contains("panel-open"), b.root.className);
  } else log("no downloads module in this build: hand-off not checked");

  // ---------------------------------------------------------------- over a peek
  const peek = b.service("peek");
  if (peek) {
    peek.open("https://example.com/");
    await waitFor(() => peek.isOpen(), { timeout: 8000, what: "peek open" }).catch(() => null);
    await sleep(900);
    if (peek.isOpen()) {
      svc.open("general");
      await sleep(500);
      await spike.capture("integration-over-peek");
      V.press("Ctrl+Q");
      await sleep(400);
      check("Settings over a peek: open, the peek still under it, Ctrl+Q makes no new peek", V.isOpen() && peek.isOpen() && V.focusInSheet());
      V.press("Ctrl+W");
      await sleep(500);
      check("Ctrl+W closes Settings first, the peek stays", !panel.isOpen && peek.isOpen());
      svc.open("general");
      await sleep(400);
      V.press("Escape");
      await sleep(500);
      check("Esc closes Settings first, the peek stays", !panel.isOpen && peek.isOpen());
      peek.close();
      await sleep(700);
    } else check("a peek could be opened for the test", false);
  } else log("no peek module in this build");

  // ---------------------------------------------------------------- find under the panel
  if (b.service("find")) {
    b.focusPage();
    await sleep(150);
    b.service("find").open({ query: "Links" });
    await sleep(600);
    const findOpen = b.service("find").isOpen();
    V.press("Ctrl+Comma");
    await sleep(500);
    V.press("Ctrl+F");
    await sleep(300);
    check("find open on the page, Settings over it: Ctrl+F goes to Find a setting", V.isOpen() && V.active() === V.root().querySelector(".vs-search-input"), { findOpen, focus: V.describe(V.active()) });
    V.press("Escape");
    await sleep(400);
    check("Esc (the field is empty) closes Settings; find is still as it was", !panel.isOpen && b.service("find").isOpen() === findOpen, { open: panel.isOpen, find: b.service("find").isOpen(), findOpen });
    b.service("find").close();
    await sleep(300);
  } else log("no find module in this build");

  // ---------------------------------------------------------------- right-click inside the panel
  if (b.service("menus")) {
    const menus = b.service("menus");
    const openPopups = () => [...document.querySelectorAll("menupopup, panel")].filter((p) => p.state === "open" || p.state === "showing").map((p) => p.id || p.localName);
    svc.open("general");
    await sleep(400);
    const item = V.root().querySelector('.vs-navitem[data-id="tabs"]');
    spike.click(item, { button: 2, type: "contextmenu" });
    await sleep(500);
    log("right-click on a sidebar item:", { vitreMenu: menus.isOpen(), native: openPopups() });
    check("right-click in the sheet opens no page menu for the page under it and no Firefox menu", !openPopups().length && (!menus.isOpen() || !/Back|Reload/.test(document.querySelector(".vm-menu, [role=menu]")?.textContent ?? "")), { vitre: menus.isOpen(), native: openPopups() });
    if (menus.isOpen()) menus.close();
    const field = V.root().querySelector(".vs-search-input");
    field.focus();
    spike.type("tab");
    await sleep(200);
    spike.click(field, { button: 2, type: "contextmenu" });
    await sleep(500);
    const rows = [...document.querySelectorAll("[role=menuitem]")].map((r) => r.textContent.trim());
    log("right-click in Find a setting:", { vitreMenu: menus.isOpen(), rows, native: openPopups() });
    check("right-click in Find a setting gives the glass editing menu (Cut, Copy, Paste, Select all), and no native one beside it", menus.isOpen() && ["Cut", "Copy", "Paste", "Select all"].every((l) => rows.some((r) => r.startsWith(l))) && !openPopups().length, { rows, native: openPopups() });
    V.press("Escape");
    await sleep(300);
    check("Esc closes that menu first; Settings stays", !menus.isOpen() && V.isOpen(), { menu: menus.isOpen(), open: panel.isOpen });
    panel.close();
    await sleep(300);
    // For the report (another module's field): the address field has the same native menu problem?
    b.editAddress("vitre");
    await sleep(300);
    spike.click(b.omni.input, { button: 2, type: "contextmenu" });
    await sleep(500);
    log("right-click in the address field:", { vitreMenu: menus.isOpen(), native: openPopups() });
    for (const p of document.querySelectorAll("menupopup")) if (p.state === "open") p.hidePopup();
    if (menus.isOpen()) menus.close();
    b.omni.close();
    await sleep(300);
  } else log("no menus module in this build");

  // ---------------------------------------------------------------- Ctrl+Tab under the panel
  const t2 = b.newTab(V.page("Other tab"), { background: true });
  await waitFor(() => t2.title === "Other tab" && !t2.loading, { timeout: 10000, what: "other tab" });
  const first = b.active();
  svc.open("general");
  await sleep(400);
  spike.EU.synthesizeKey("KEY_Control", { type: "keydown" }, window);
  await sleep(20);
  V.press("Ctrl+Tab");
  await sleep(40);
  spike.EU.synthesizeKey("KEY_Control", { type: "keyup" }, window);
  await sleep(900);
  check("a quick Ctrl+Tab switches tabs under the open panel, which keeps focus", b.active() !== first && V.isOpen() && V.focusInSheet(), { active: b.active()?.title, open: panel.isOpen, focus: V.describe(V.active()) });
  panel.close();
  await sleep(300);
  b.closeTab(t2);
  await sleep(400);
  V.consoleCheck("integration");
});
