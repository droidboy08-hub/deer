// The menus with the real modules of the tree (full build): keys of other modules' hooks while a
// menu is open, the Esc ladder through a peek, the peek's dim, the find field, the Settings panel's
// fields and Home's "Change background…" (the background popover, MenuChrome).
//   python tests/menus-verify/all.py modules
/* global spike, Services, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, capture, waitFor } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  const peek = b.service("peek");
  const find = b.service("find");
  const settings = b.service("settings");
  check("modules: peek, find and settings are installed", !!peek && !!find && !!settings, b.modules);
  const article = M.page("article.html");
  const tab = await M.load(article);
  const until = (fn, ms = 4000) => waitFor(fn, { timeout: ms }).then(() => true, () => false);
  const esc = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(200);
  };
  const atText = async (sel) => {
    const r = await M.rectOf(sel);
    return { x: r.x + 14, y: r.y + 10 };
  };

  await V.section("find open: other modules' keys while a menu is open", async () => {
    find.open({ query: "float", browser: tab.browser });
    await until(() => find.isOpen(), 4000);
    await sleep(600);
    tab.browser.focus();
    await M.activate();
    await sleep(200);
    const p = await atText("#p2");
    M.rightClick(p.x, p.y);
    check("find open: page menu opened", await M.waitOpen());
    const input = document.querySelector(".vf-input");
    const before = document.activeElement;
    M.key("KEY_F6");
    await sleep(300);
    check("find open: F6 with a menu open is swallowed (the menu stays, focus does not move to find)", M.isOpen() && document.activeElement === before && document.activeElement !== input, { open: M.isOpen(), active: document.activeElement?.className || document.activeElement?.localName });
    await esc();
    check("find open: Esc closed only the menu", find.isOpen());
    // The find field's own menu (through the service), then Ctrl+Q (Peek link, which find passes to its field).
    input.focus();
    await sleep(200);
    const ir = input.getBoundingClientRect();
    M.rightClick(ir.left + 30, ir.top + ir.height / 2);
    check("find field: its menu opened", await M.waitOpen(), M.labels());
    const peekBefore = peek.isOpen();
    spike.press("Ctrl+Q");
    await sleep(400);
    check("find field: Ctrl+Q with the menu open does nothing but stay in the menu", M.isOpen() && peek.isOpen() === peekBefore, { open: M.isOpen(), peek: peek.isOpen() });
    M.key("KEY_ArrowDown");
    check("find field: arrows still reach the menu", M.state().active >= 0, M.state().active);
    await esc();
    find.close();
    await sleep(500);
  });

  await V.section("peek: the dim, the Esc ladder", async () => {
    peek.open(M.page("counter.html"));
    await until(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html"), 8000);
    await sleep(1000);
    // Right-click the dim (outside the sheet): never closes the peek, never a native menu.
    M.rightClick(60, 600);
    await sleep(800);
    log("right-click on the dim", JSON.stringify({ menu: M.isOpen(), label: M.isOpen() ? M.state().label : "", peek: peek.isOpen() }));
    check("peek: a right-click on the dim leaves the peek open", peek.isOpen());
    check("peek: no native menu", M.last().nativeShown === 0);
    await esc();
    // A menu in the sheet: Esc closes the menu, the next Esc the peek.
    const pb = peek.browser();
    const r = pb.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    check("peek: page menu in the sheet", await M.waitOpen() && M.last().context.inPeek === true);
    await capture("modules-peek-menu");
    M.key("KEY_F6");
    await sleep(200);
    check("peek: F6 with a menu open is swallowed", M.isOpen());
    M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(300);
    check("peek: the first Esc closed only the menu", peek.isOpen());
    pb.focus();
    M.key("KEY_Escape");
    check("peek: the next Esc closes the peek", await until(() => !peek.isOpen(), 4000));
    await sleep(600);
  });

  await V.section("settings panel fields", async () => {
    settings.open("general");
    await until(() => b.root.classList.contains("panel-open"), 4000);
    await sleep(800);
    const field = [...document.querySelectorAll("#vitre-root input[type=search], #vitre-root input[type=text], #vitre-root input:not([type])")].find((el) => el.getBoundingClientRect().width > 40);
    check("settings: a text field in the panel", !!field);
    if (field) {
      field.focus();
      const fr = field.getBoundingClientRect();
      M.rightClick(fr.left + 30, fr.top + fr.height / 2);
      check("settings: the field menu", await M.waitOpen() && M.labels().includes("Paste"), M.labels());
      await capture("modules-settings-field");
      M.key("KEY_Escape");
      await M.waitClosed();
      await sleep(300);
      check("settings: Esc closed the menu, the panel stays", b.root.classList.contains("panel-open"));
    }
    settings.close?.();
    await until(() => !b.root.classList.contains("panel-open"), 3000);
    await sleep(400);
  });

  await V.section("Home: Change background", async () => {
    const home = b.newTab();
    await until(() => home.kind === "home" && !home.loading, 6000);
    if (b.omni.open) b.omni.close();
    await sleep(1000);
    M.rightClick(700, 600);
    check("Home: menu", await M.waitOpen() && M.last().kind === "home", M.last().kind);
    await M.pick("Change background…");
    await sleep(700);
    const pop = window.vitreSettingsPanel?.home;
    log("after Change background", JSON.stringify({ popover: pop?.isOpen, panel: b.root.classList.contains("panel-open") }));
    check("Home: Change background… opens Home's background popover (MenuChrome)", pop?.isOpen === true && !b.root.classList.contains("panel-open"), { popover: pop?.isOpen, panel: b.root.className });
    await capture("modules-home-background");
    b.escape();
    await sleep(400);
    b.closeTab(home);
    await sleep(400);
  });

  check("native popup never shown", M.last().nativeShown === 0, M.last().nativeShown);
  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
});
