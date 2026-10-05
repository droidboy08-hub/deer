// Peek verification: ladders, keyboard-only use, rapid input, service misuse.
//   - Esc / Ctrl+W against the layers above a peek: find in the sheet, a glass menu, the Settings
//     panel; an Esc a layer used never counts toward Esc Esc.
//   - Keyboard only: Tab to a link + Shift+Enter, Tab out of the sheet's page, F6 to the header and
//     Enter / Space on its buttons, Esc from the header.
//   - Rapid input: Shift+click storms, Esc storms during the open, open/close cycles, Open as tab
//     during the open motion and Esc during Open as tab, double Alt+Enter, Ctrl+Shift+T storms.
//   - Service misuse: schemes a peek must refuse, calls in the wrong phase.
//   python tests/peek-verify/all.py ladder
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(500);
  const src = b.active();
  const esc = async (br) => (await P.state(br)).esc;

  await V.section("find over a peek", async () => {
    const find = b.service("find");
    if (!find) {
      log("find module not installed: skipped");
      return;
    }
    await P.shiftClick("#i33");
    const br = await P.waitOpen("trapesc");
    await P.focusPeek();
    P.press("Ctrl+F");
    await waitFor(() => find.isOpen(), { what: "find in the peek" });
    await sleep(300);
    check("Ctrl+F in a peek opens find (the peek stays)", find.isOpen() && peek().isOpen());
    const e0 = await esc(br);
    P.press("Escape");
    await sleep(80);
    check("Esc closes find first", !find.isOpen() && peek().isOpen());
    // Within 400 ms of the Esc that closed find: this one is a first Esc for the peek, so the
    // page (which keeps Esc) gets it and the peek stays.
    P.press("Escape");
    await sleep(500);
    check("the Esc that closed find never counts toward Esc Esc: the next Esc goes to the page", peek().isOpen() && (await esc(br)) === e0 + 1, { before: e0, after: await esc(br) });
    P.press("Escape");
    await sleep(100);
    P.press("Escape");
    await P.waitClosed();
    check("then Esc Esc closes the peek", !peek().isOpen());
    // Ctrl+W with find open in the sheet: the peek closes (find with it), never the tab.
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    await P.focusPeek();
    P.press("Ctrl+F");
    await waitFor(() => find.isOpen(), { what: "find in the peek again" });
    await sleep(300);
    P.press("Ctrl+W");
    await P.waitClosed();
    await sleep(300);
    check("Ctrl+W with find open in a peek closes the peek and its find, not the tab", !peek().isOpen() && !find.isOpen() && b.tabs.length === 1);
  });

  await V.section("glass menu over a peek", async () => {
    const menus = b.service("menus");
    if (!menus) {
      log("menus module not installed: skipped");
      return;
    }
    await P.shiftClick("#i33");
    const br = await P.waitOpen("trapesc");
    await P.focusPeek();
    const r = await P.rectOf(br, "#title");
    spike.EU.synthesizeMouseAtPoint(r.cx, r.cy, { type: "contextmenu", button: 2 }, window);
    await waitFor(() => menus.isOpen(), { timeout: 4000, what: "the page menu in the sheet" });
    await sleep(300);
    const e0 = await esc(br);
    P.press("Escape");
    await sleep(80);
    check("Esc closes the menu, not the peek", !menus.isOpen() && peek().isOpen());
    P.press("Escape");
    await sleep(500);
    check("the Esc the menu used does not count toward Esc Esc", peek().isOpen() && (await esc(br)) === e0 + 1, { before: e0, after: await esc(br) });
    // The header menu, then Ctrl+W: the menu takes it? Ctrl+W closes the peek (browser-first).
    const head = peek().headerRect();
    spike.EU.synthesizeMouseAtPoint(head.left + 400, head.top + 22, { type: "contextmenu", button: 2 }, window);
    await waitFor(() => menus.isOpen(), { timeout: 4000, what: "the header menu" });
    P.press("Escape");
    await sleep(100);
    check("Esc closes the header menu first", !menus.isOpen() && peek().isOpen());
  });

  await V.section("settings panel over a peek", async () => {
    const settings = b.service("settings");
    if (!settings) {
      log("settings module not installed: skipped");
      return;
    }
    await P.shiftClick("#i39");
    await P.waitOpen("n=39");
    settings.open();
    await waitFor(() => settings.isOpen(), { what: "the Settings panel" });
    await sleep(600);
    P.press("Ctrl+W");
    await sleep(600);
    check("Ctrl+W with Settings open over a peek closes Settings first", !settings.isOpen() && peek().isOpen());
    settings.open();
    await waitFor(() => settings.isOpen(), { what: "the Settings panel again" });
    await sleep(600);
    P.press("Escape");
    await sleep(600);
    check("Esc with Settings open over a peek closes Settings first", !settings.isOpen() && peek().isOpen());
    P.press("Escape");
    await P.waitClosed();
    check("the next Esc closes the peek", !peek().isOpen());
  });

  await V.section("keyboard only", async () => {
    // Tab to the #39 link and peek it with Shift+Enter.
    b.focusPage();
    await P.inContent(src.browser, (w) => w.document.getElementById("i41").focus());
    P.press("Tab");
    await sleep(200);
    check("Tab reached the #39 link", (await P.state(src.browser)).active === "i39");
    P.press("Shift+Enter");
    const br = await P.waitOpen("n=39");
    check("Shift+Enter on a focused link peeks it", peek().isOpen() && document.activeElement === br);
    // Tab through the sheet's page to its end and once more: focus must stay in the sheet (its page
    // or its header), never land on the dimmed page or nowhere.
    await P.inContent(br, (w) => w.document.getElementById("fs").focus());
    const where = [];
    for (let i = 0; i < 6; i++) {
      P.press("Tab");
      await sleep(150);
      const ae = document.activeElement;
      where.push(ae === br ? "peek:" + (await P.state(br)).active : ae === src.browser ? "UNDER" : (ae?.closest?.(".vp-head") ? "header:" + ae.className : (ae?.id || ae?.localName)));
    }
    log("Tab past the end of the sheet's page", where);
    check("Tab past the end of the sheet's page never lands on the dimmed page", !where.includes("UNDER"), where);
    // F6 to the header, Enter on Open as tab.
    await P.focusPeek();
    P.press("F6");
    await sleep(200);
    const focused = document.activeElement;
    check("F6 from the sheet's page focuses the header's first button", !!focused?.closest?.(".vp-head") && focused.localName === "button", focused?.className);
    P.press("Escape");
    await P.waitClosed();
    check("Esc with focus in the header closes the peek", !peek().isOpen());
    await sleep(300);
    check("focus went back to the #39 link", (await P.state(src.browser)).active === "i39", (await P.state(src.browser)).active);
    P.press("Shift+Enter");
    await P.waitOpen("n=39");
    P.press("F6");
    await sleep(200);
    // With no history the first header control is Open as tab.
    check("the header's first control is Open as tab (no history yet)", document.activeElement?.classList.contains("vp-open"), document.activeElement?.className);
    P.press("Enter");
    await waitFor(() => !peek().isOpen() && b.tabs.length === 2, { what: "Enter on Open as tab" });
    await sleep(500);
    check("Enter on the focused Open as tab button promotes; focus is in the new tab's page", b.active().browser === br && document.activeElement === br);
  });

  await V.section("Shift+click storm", async () => {
    const ids = ["#i41", "#i39", "#i38", "#i36", "#i29"];
    const rects = [];
    for (const id of ids) rects.push(await P.rectOf(src.browser, id));
    // Each at 10 px into its link: left of where the sheet will be, so the later ones land on the
    // dimmed page (hops) or, before the dim is up, on the page itself (new requests).
    for (const r of rects) {
      P.move(r.x + 10, r.cy);
      P.mouse(r.x + 10, r.cy, { shiftKey: true });
      await sleep(25);
    }
    await sleep(2500);
    const br = peek().browser();
    const ph = V.phase();
    log("after the storm", ph, br?.currentURI.spec, V.insetOff());
    check("five Shift+clicks in 125 ms leave one sheet showing the last link", ph.open && ph.shown && br && /n=29\b/.test(br.currentURI.spec) && ph.bar === 1, ph);
    check("and at most one hidden tab (the sheet's) plus no stray warm page", V.hidden() === 1, V.hidden());
    check("the inset switch list holds only that browser", V.insetOff().length === 1 && V.insetOff()[0] === br.browserId, V.insetOff());
    check("hops add no history: no back chevron", !P.sheet().back);
  });

  await V.section("Esc storm while opening", async () => {
    Services.prefs.setIntPref("vitre.debug.peekMotionScale", 3);
    await P.shiftClick("#i39");
    await waitFor(() => peek().isOpen(), { what: "the sheet" });
    for (let i = 0; i < 6; i++) {
      P.press("Escape");
      await sleep(30);
    }
    await sleep(2500);
    Services.prefs.clearUserPref("vitre.debug.peekMotionScale");
    const ph = V.phase();
    check("Esc pressed six times during the open motion: closed cleanly, nothing stuck", !ph.open && !ph.shown && !ph.dim && ph.hidden <= 1, ph);
    check("the dim is fully gone (no leftover visible dim)", getComputedStyle(gBrowser.tabpanels.querySelector(".vitre-peek-dim")).visibility === "hidden");
  });

  await V.section("open/close cycles", async () => {
    for (let i = 0; i < 8; i++) {
      await P.shiftClick(i % 2 ? "#i38" : "#i36");
      await waitFor(() => peek().isOpen(), { what: "open " + i });
      await sleep(60 + (i % 3) * 120);
      P.press("Escape");
      await waitFor(() => !peek().isOpen(), { what: "close " + i });
      await sleep(40);
    }
    await sleep(1500);
    const ph = V.phase();
    log("after cycles", ph, V.insetOff());
    check("eight quick open/close cycles: no sheet, at most one warm page", !ph.open && !ph.shown && !ph.dim && ph.hidden <= 1, ph);
    check("the inset switch list holds at most the warm page", V.insetOff().length <= 1, V.insetOff());
    check("no peek page in the closed-tab list", !P.tabsInfo().closed.some((u) => /issue\.html/.test(String(u))), P.tabsInfo().closed);
  });

  await V.section("Open as tab during the open motion; Esc during Open as tab", async () => {
    Services.prefs.setIntPref("vitre.debug.peekMotionScale", 4);
    await P.shiftClick("#i39");
    await waitFor(() => peek().isOpen(), { what: "the sheet" });
    await sleep(100);
    peek().promote();
    await sleep(60);
    P.press("Escape");
    P.press("Ctrl+W");
    await sleep(60);
    peek().promote();
    await waitFor(() => !peek().isOpen() && !P.sheet().shown, { timeout: 8000, what: "promote to finish" });
    Services.prefs.clearUserPref("vitre.debug.peekMotionScale");
    await sleep(800);
    check("promote mid-open, then Esc / Ctrl+W / promote again during it: one new tab, active, no sheet left", b.tabs.length === 2 && b.active().url.includes("n=39") && V.hidden() === 0 && !P.sheet().dimOn, { tabs: b.tabs.map((t) => t.url.slice(-12)), hidden: V.hidden() });
    check("the source pill is a circle again and the panels are back to normal", !gBrowser.tabpanels.querySelector(".vitre-peek-under, .vitre-peek-panel"));
  });

  await V.section("double Alt+Enter, Ctrl+Shift+T storm", async () => {
    await P.shiftClick("#i38");
    const br = await P.waitOpen("n=38");
    await P.focusPeek();
    P.press("Alt+Enter");
    P.press("Alt+Enter");
    await sleep(1200);
    check("Alt+Enter twice: one new tab", b.tabs.length === 2 && b.active().browser === br, b.tabs.length);
    b.activate(src);
    await sleep(300);
    await P.shiftClick("#i36");
    await P.waitOpen("n=36");
    P.press("Escape");
    await P.waitClosed();
    for (let i = 0; i < 4; i++) {
      P.press("Ctrl+Shift+T");
      await sleep(40);
    }
    await sleep(1500);
    log("after the Ctrl+Shift+T storm", V.phase(), b.tabs.map((t) => t.url.slice(-12)));
    check("Ctrl+Shift+T four times fast: the warm peek is back once, and nothing else was reopened on top of it", peek().isOpen() && V.hidden() === 1 && b.tabs.length === 2, { phase: V.phase(), tabs: b.tabs.length });
  });

  await V.section("service misuse", async () => {
    const p = peek();
    const before = V.phase();
    for (const url of ["javascript:alert(1)", "file:///C:/", "chrome://browser/content/browser.xhtml", "about:config", "data:text/html,<b>x</b>", "", "view-source:https://example.com/"]) {
      try {
        p.open(url);
      } catch (e) {
        check("open(" + url + ") does not throw", false, String(e));
      }
    }
    await sleep(800);
    check("open() refuses non-web addresses given without a page principal", !p.isOpen() && V.hidden() === before.hidden, V.phase());
    const web = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI("https://example.com/"), {});
    p.open("file:///C:/Windows/win.ini", { triggeringPrincipal: web });
    p.open("chrome://browser/content/browser.xhtml", { triggeringPrincipal: web });
    await sleep(600);
    check("a page principal cannot peek file: or chrome:", !p.isOpen() && V.hidden() === before.hidden);
    p.promote();
    p.close();
    p.reopen();
    check("promote / close / reopen with no peek do nothing", !p.isOpen() && b.tabs.length === before.bar && p.headerRect() === null && p.browser() === null && (p.headerSlot ? p.headerSlot(true) === null : true));
    check("window.vitrePeek with no peek: browser() null, close() false", window.vitrePeek.browser() === null && window.vitrePeek.close() === false);
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
