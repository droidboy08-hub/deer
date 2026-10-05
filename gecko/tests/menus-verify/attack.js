// The verifier's attack on the right-click menus: states and transitions the feature's own suites do
// not drive. Each block is independent (V.section); captures land in tests/menus-verify/out.
//   python tests/menus-verify/all.py attack
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, capture, waitFor } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  const fake = M.fakeServices();
  const article = M.page("article.html");
  const tab0 = await M.load(article);
  const popupNode = document.getElementById("contentAreaContextMenu");
  const until = async (fn, ms = 4000, what = "condition") => {
    try {
      await waitFor(fn, { timeout: ms, what });
      return true;
    } catch {
      return false;
    }
  };
  const esc = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(150);
  };
  const atText = async (selector) => {
    const r = await M.rectOf(selector);
    return { x: r.x + 12, y: r.y + 10 };
  };

  // ---- 1. A menu that replaces another keeps its context loss: navigation still closes it ----
  await V.section("replacement keeps navigation closing", async () => {
    await M.load(article);
    const p = await atText("#p1");
    M.rightClick(p.x, p.y);
    check("replace: first page menu", await M.waitOpen(), M.last().kind);
    // The keyboard menu (WM_CONTEXTMENU) while the mouse menu is open: a second page menu replaces it.
    const before = M.last().pageMenus;
    await M.activate();
    tab0.browser.focus();
    M.keyboardMenu();
    check("replace: the keyboard menu replaced the mouse one", await until(() => M.last().pageMenus > before && M.isOpen(), 4000), { pageMenus: M.last().pageMenus, before });
    await sleep(300);
    b.navigate(tab0, M.page("counter.html"));
    check("replace: navigating the page closes the replacing menu", await until(() => !M.isOpen(), 6000), M.state().label);
    await M.load(article);
    // The service replacing a page menu: same rule.
    M.rightClick(p.x, p.y);
    await M.waitOpen();
    M.menus().api.show([{ label: "Service row", run: () => {} }], { x: 400, y: 300 });
    check("replace: the service menu replaced the page menu", M.isOpen() && M.labels()[0] === "Service row", M.labels());
    b.navigate(tab0, M.page("counter.html"));
    check("replace: navigating the page closes the service menu", await until(() => !M.isOpen(), 6000));
    await M.load(article);
  });

  // ---- 2. Rapid repeated input ----
  await V.section("rapid right-clicks", async () => {
    await M.load(article);
    // Three points no earlier menu can cover (a menu opens right of and below its point): a right
    // press released on an open menu's row would run that row (as in Windows).
    const text = await atText("#p1");
    const h1 = await M.rectOf("h1");
    const link = await M.rectOf("#link1");
    const points = [[text.x, text.y], [h1.x + 20, h1.cy], [link.cx, link.cy]];
    const before = M.last().pageMenus;
    for (let i = 0; i < 12; i++) {
      const [x, y] = points[i % 3];
      M.rightClick(x, y);
      await sleep(25);
    }
    await until(() => M.isOpen(), 4000);
    await sleep(900);
    const nodes = V.menuNodes();
    log("after 12 rapid right-clicks", JSON.stringify({ nodes, pageMenus: M.last().pageMenus - before, kind: M.last().kind }));
    check("rapid: exactly one menu on screen", nodes.panels === 1 && nodes.allPanels === 1, nodes);
    check("rapid: it is the menu of the last click (the link)", M.last().kind === "link", M.last().kind);
    check("rapid: never a native popup", M.last().nativeShown === 0 && popupNode.state === "closed", { shown: M.last().nativeShown, state: popupNode.state });
    check("rapid: one wash, on the last link only", nodes.washes === 1, nodes.washes);
    await capture("attack-rapid");
    await esc();
    await sleep(300);
    const after = V.menuNodes();
    check("rapid: everything gone after Esc", after.allPanels === 0 && after.washes === 0 && !after.catcherUp && after.owners === 0, after);
    check("rapid: Firefox's context menu session ended (gContextMenu null)", !window.gContextMenu, String(window.gContextMenu));

    // Keyboard: six WM_CONTEXTMENU back to back.
    await M.activate();
    tab0.browser.focus();
    for (let i = 0; i < 6; i++) M.keyboardMenu();
    await until(() => M.isOpen(), 4000);
    await sleep(900);
    const k = V.menuNodes();
    check("rapid keyboard menus: one menu, first row focused", k.panels === 1 && M.state().active === 0 && M.state().source === "keyboard", { k, active: M.state().active });
    await esc();

    // Arrow keys held down (auto-repeat) and a burst of Esc.
    const l = await M.openOn("#link1");
    check("rapid keys: link menu", l.ok);
    const n = M.state().rows.length;
    for (let i = 0; i < 23; i++) M.key("KEY_ArrowDown", { repeat: i > 0 });
    check("rapid keys: 23 Downs land on row 23 mod n", M.state().active === 22 % n, { active: M.state().active, n });
    M.key("KEY_Escape", { repeat: true });
    check("rapid keys: a repeated Esc does not close", M.isOpen());
    M.key("KEY_Escape");
    check("rapid keys: one Esc closes", await M.waitClosed());
    const tabs = b.tabs.length;
    for (let i = 0; i < 4; i++) M.key("KEY_Escape");
    await sleep(300);
    check("rapid keys: extra Escs after the close did not open or close anything", b.tabs.length === tabs && !M.isOpen());

    // Chrome menus hammered: only the current owner keeps the pressed look.
    const second = b.newTab(M.page("counter.html"), { background: true });
    await sleep(800);
    const pill = b.bar.item(tab0.id);
    const circle = b.bar.item(second.id);
    for (let i = 0; i < 11; i++) {
      const el = i % 2 ? circle : pill;
      const r = el.getBoundingClientRect();
      M.rightClick(r.left + Math.min(200, r.width / 2), r.top + r.height / 2);
      await sleep(20);
    }
    await until(() => M.isOpen(), 3000);
    await sleep(400);
    const own = [...document.querySelectorAll(".vt-menu-owner")];
    check("rapid chrome menus: one owner pressed, the last one clicked (the pill)", own.length === 1 && own[0] === pill, own.map((e) => e.className));
    await esc();
    check("rapid chrome menus: no owner left pressed", document.querySelectorAll(".vt-menu-owner").length === 0);
    b.closeTab(second);
    await sleep(300);
  });

  // ---- 3. The address field open ----
  await V.section("address field open", async () => {
    await M.load(article);
    b.editAddress();
    await until(() => b.omni.open && b.omni.focused, 3000);
    await sleep(300);
    const input = b.omni.input;
    const r = input.getBoundingClientRect();
    M.rightClick(r.left + 60, r.top + r.height / 2);
    check("omnibox: field menu opened", await M.waitOpen(), M.labels());
    const rows = M.labels();
    log("omnibox field menu", JSON.stringify(rows));
    check("omnibox: the address field's rows (Undo, Cut, Copy, Paste, Select all)", ["Undo", "Cut", "Copy", "Paste", "Select all"].every((x) => rows.includes(x)) && !rows.includes("Redo"), rows);
    await capture("attack-omnibox-menu");
    M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(200);
    check("omnibox: the first Esc closes only the menu", b.omni.open, b.omni.open);
    M.key("KEY_Escape");
    await sleep(400);
    check("omnibox: the second Esc closes the address field", !b.omni.open, b.omni.open);

    // Keyboard menu on the focused address field.
    b.editAddress();
    await until(() => b.omni.open && b.omni.focused, 3000);
    await sleep(300);
    await M.activate();
    M.keyboardMenu();
    check("omnibox: keyboard menu opened", await M.waitOpen());
    const st = M.state();
    const fr = b.omni.input.getBoundingClientRect();
    check("omnibox: keyboard menu below the field, first row focused", Math.abs(st.rect.top - (fr.bottom + 4)) <= 1 && st.active >= 0 && st.source === "keyboard", { rect: st.rect, field: [fr.left, fr.bottom] });
    await esc();
    if (b.omni.open) b.omni.close();
    await sleep(300);

    // A right-click on the page while the address field is open: no native menu, ever.
    b.editAddress();
    await until(() => b.omni.open, 3000);
    await sleep(300);
    const p = await atText("#p2");
    M.rightClick(p.x, p.y);
    await sleep(900);
    log("right-click on the page with the address field open", JSON.stringify({ menu: M.isOpen(), kind: M.isOpen() ? M.state().label : "", omni: b.omni.open, native: popupNode.state }));
    check("omnibox open + right-click on the page: no native menu", M.last().nativeShown === 0 && popupNode.state === "closed");
    await esc();
    if (b.omni.open) b.omni.close();
    await sleep(300);
  });

  // ---- 3b. Pen: 40 px rows, but at the hotspot like the mouse (DESIGN-NOTES Anatomy, Placement) ----
  await V.section("pen", async () => {
    await M.load(article);
    const r = await M.rectOf("#p4");
    const x = r.x + 100;
    const y = r.cy;
    M.rightClick(x, y, { inputSource: 2 /* MOZ_SOURCE_PEN */ });
    check("pen: menu opened", await M.waitOpen());
    const st = M.state();
    const row = M.menus().view.rowElement(0).getBoundingClientRect();
    check("pen: 40 px rows", Math.round(row.height) === 40 && st.classes.includes("touch"), row.height);
    const flippedUp = st.rect.top + st.rect.height <= y + 1;
    check("pen: a corner at the hotspot (not centred above it like a finger)", Math.abs(st.rect.left - x) <= 1 && (Math.abs(st.rect.top - y) <= 1 || (flippedUp && Math.abs(st.rect.top + st.rect.height - y) <= 1)), { rect: st.rect, at: [x, y] });
    await esc();
  });

  // ---- 3c. A cross-site frame in its own process (127.0.0.1 page, localhost frame) ----
  await V.section("cross-site frame", async () => {
    const t = await M.load(V.page("xframe.html"));
    const loaded = await until(() => t.browser.browsingContext.children[0]?.currentWindowGlobal?.documentURI?.spec.includes("framelink.html"), 10000);
    check("frame: the cross-site frame loaded", loaded);
    const fbc = t.browser.browsingContext.children[0];
    const outOfProcess = fbc && fbc.currentWindowGlobal?.osPid !== t.browser.browsingContext.currentWindowGlobal?.osPid;
    log("frame process", JSON.stringify({ top: t.browser.browsingContext.currentWindowGlobal?.osPid, frame: fbc?.currentWindowGlobal?.osPid }));
    check("frame: it lives in another process", !!outOfProcess);
    await sleep(500);
    const fr = await M.rectOf("#xf", { scroll: false });
    const x = fr.x + 1 + 60;
    const y = fr.y + 1 + 54;
    M.rightClick(x, y, { asyncEnabled: true });
    check("frame: link menu", (await M.waitOpen()) && M.last().kind === "link", M.last().kind);
    const ctx = M.last().context;
    check("frame: the frame's link and frame address", ctx.inFrame === true && /\/\/localhost:\d+\/v\/plain\.html#from-frame$/.test(ctx.linkURL), { inFrame: ctx.inFrame, link: ctx.linkURL, frame: ctx.frameURL });
    const st = M.state();
    check("frame: top-left at the pointer", Math.abs(st.rect.left - x) <= 1 && Math.abs(st.rect.top - y) <= 1, { rect: [st.rect.left, st.rect.top], at: [x, y] });
    await until(() => document.querySelector(".vt-menus .vt-wash"), 1500);
    const wash = document.querySelector(".vt-menus .vt-wash")?.getBoundingClientRect();
    log("frame wash", JSON.stringify({ wash: wash && [wash.left, wash.top, wash.width, wash.height], frame: [fr.x, fr.y], record: M.last().record && { partial: M.last().record.partial, screen: M.last().record.screen, link: M.last().record.link } }));
    check("frame: the link is washed where it is drawn (frame + 40, 40)", !!wash && Math.abs(wash.left - (fr.x + 1 + 40)) <= 2 && Math.abs(wash.top - (fr.y + 1 + 40)) <= 4 && wash.width > 100, wash && [wash.left, wash.top, wash.width]);
    await capture("attack-xframe-link");
    const n = b.tabs.length;
    await M.pick("Open link in new tab");
    check("frame: Open link in new tab opens the frame's link", await until(() => b.tabs.length === n + 1 && b.tabs.some((tt) => /localhost:\d+\/v\/plain\.html#from-frame$/.test(tt.url)), 6000), b.tabs.map((tt) => tt.url));
    while (b.tabs.length > 1) b.closeTab(b.tabs[b.tabs.length - 1]);
    await b.activate(b.tabs[0]);
    await sleep(400);
  });

  // ---- 3d. A video from a blob: (as MSE players use): no address to copy (DESIGN-NOTES Video) ----
  await V.section("blob video", async () => {
    const t = await M.load(article);
    const clip = await M.makeVideo("attack-clip.webm", 1);
    const src = await M.inContent(t.browser, async (content, url) => {
      const v = content.document.getElementById("vid");
      const blob = await (await content.fetch(url)).blob();
      v.src = content.URL.createObjectURL(blob);
      v.muted = true;
      await v.play().catch(() => {});
      return v.currentSrc;
    }, clip);
    check("blob video: the page plays a blob: source", typeof src === "string" && src.startsWith("blob:"), src);
    await sleep(500);
    await M.openOn("#vid");
    const rows = M.labels();
    check("blob video: the video menu", M.last().kind === "media" && rows.includes("Download video…"), rows);
    check("blob video: no Copy video address for a blob: source", !rows.includes("Copy video address"), rows);
    await esc();
  });

  // ---- 4. Resize closes, then the menu is not stuck ----
  await V.section("resize", async () => {
    await M.load(article);
    const o = await M.openOn("#link1");
    check("resize: menu open", o.ok);
    window.resizeTo(1400, 880);
    check("resize: closes at once", await until(() => !M.isOpen(), 2000));
    await spike.resize(1440, 900);
    const o2 = await M.openOn("#link1");
    check("resize: a menu opens again afterwards", o2.ok);
    await esc();
  });

  // ---- 5. Auto-hide: a bar menu keeps the bar on screen ----
  await V.section("auto-hide bar", async () => {
    await M.load(article);
    b.sys("VitreSettings").set({ barAutoHide: true });
    await until(() => b.bar.hidden, 4000, "bar hidden");
    M.mouse(700, 600, { type: "mousemove" });
    await sleep(900);
    check("auto-hide: the bar hides", b.bar.hidden, b.bar.hidden);
    M.mouse(720, 5, { type: "mousemove" });
    await until(() => !b.bar.hidden, 2000);
    // Right-click the pill as soon as its middle is below the drag strip, while it is still sliding in.
    const pill = b.bar.item(tab0.id);
    await until(() => pill.getBoundingClientRect().top + 22 >= 24, 2000);
    const pr = pill.getBoundingClientRect();
    const sliding = pr.top < 11.5;
    M.rightClick(pr.left + 200, pr.top + 22);
    check("auto-hide: pill menu opened", await M.waitOpen());
    let st = M.state();
    check("auto-hide: a menu from a sliding bar still hangs at y 64", Math.abs(st.rect.top - 64) <= 1, { top: st.rect.top, pillTopAtClick: pr.top, sliding });
    // The pointer goes down onto the menu's last row: below the bar's keep-alive band.
    const lastRow = M.menus().view.rowElement(st.rows.length - 1).getBoundingClientRect();
    M.mouse(lastRow.left + 40, lastRow.top + lastRow.height / 2, { type: "mousemove" });
    await sleep(1300);
    check("auto-hide: the bar stays while its menu is open", !b.bar.hidden && M.isOpen(), { hidden: b.bar.hidden, open: M.isOpen() });
    check("auto-hide: the pill keeps its pressed look", pill.classList.contains("vt-menu-owner"));
    await capture("attack-autohide-menu");
    await esc();
    M.mouse(700, 600, { type: "mousemove" });
    check("auto-hide: once the menu is gone the bar hides again", await until(() => b.bar.hidden, 3000), b.bar.hidden);
    b.sys("VitreSettings").set({ barAutoHide: false });
    await until(() => !b.bar.hidden, 3000);
    await sleep(400);
  });

  // ---- 6. A slow page, a hung page ----
  await V.section("slow and hung pages", async () => {
    const hang = V.page("hang.html");
    await M.load(hang);
    await M.inContent(tab0.browser, (content) => (content.document.documentElement.dataset.slowMenu = "1200"));
    const link = await M.rectOf("#link");
    const t0 = Date.now();
    M.rightClick(link.cx, link.cy);
    const opened = await M.waitOpen(6000);
    log("slow contextmenu listener: menu after", Date.now() - t0, "ms");
    check("slow page: the link menu still opens", opened && M.last().kind === "link", M.last().kind);
    await esc();
    await M.inContent(tab0.browser, (content) => (content.document.documentElement.dataset.slowMenu = "0"));

    // The page hangs while its menu is open: the menu keeps working (it lives in the parent).
    await M.openOn("#link");
    check("hung page: menu open", M.isOpen());
    void M.inContent(tab0.browser, (content) => {
      const end = Date.now() + 2500;
      while (Date.now() < end);
      return true;
    });
    await sleep(300);
    const t1 = performance.now();
    M.key("KEY_ArrowDown");
    M.key("KEY_ArrowDown");
    check("hung page: arrows move the plate at once", M.state().active === 1 && performance.now() - t1 < 200, M.state().active);
    M.key("KEY_Escape");
    check("hung page: Esc closes at once", await until(() => !M.isOpen(), 300));
    await sleep(2600);

    // A slow navigation: the menu stays until the new document arrives, then goes.
    await M.load(hang);
    await M.openOn("#p1", { dx: 400, dy: 10 });
    check("slow navigation: page menu open", M.isOpen());
    b.navigate(tab0, V.slow(2500, "plain.html"));
    await sleep(1000);
    check("slow navigation: still open while the old document shows", M.isOpen());
    check("slow navigation: closes when the new document commits", await until(() => !M.isOpen(), 8000));
    await until(() => !tab0.loading, 8000);
  });

  // ---- 7. Dark and light pages, Vitre's appearance ----
  await V.section("themes", async () => {
    await M.load(M.page("dark.html"));
    const prev = b.settings.theme;
    b.sys("VitreSettings").set({ theme: "dark" });
    await sleep(600);
    await M.openOn("#dlink");
    await sleep(400);
    let st = M.state();
    check("dark appearance over a dark page: raised dark material", st.classes.includes("t-dark") && st.classes.includes("t-raised"), st.classes);
    await capture("attack-dark-on-dark");
    await esc();
    // Transparency effects off (LookAndFeel's ui.prefersReducedTransparency stands in for the Windows
    // setting): solid #2C2C2C, no frost, also over a dark page where the menu is raised.
    Services.prefs.setIntPref("ui.prefersReducedTransparency", 1);
    await sleep(500);
    const reduce = window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    log("ui.prefersReducedTransparency=1 -> media matches", reduce);
    if (reduce) {
      await M.openOn("#dlink");
      await sleep(500);
      const el = document.querySelector(".vt-menus .vt-menu[role=menu]");
      const cs = getComputedStyle(el);
      check("transparency off over a dark page: solid #2C2C2C, no frost (also when raised)", cs.backdropFilter === "none" && cs.backgroundColor === "rgb(44, 44, 44)", { bg: cs.backgroundColor, frost: cs.backdropFilter, classes: el.className });
      await capture("attack-transparency-off");
      await esc();
    }
    Services.prefs.clearUserPref("ui.prefersReducedTransparency");
    await sleep(300);
    b.sys("VitreSettings").set({ theme: "light" });
    await sleep(800);
    await M.openOn("#dlink");
    st = M.state();
    check("light appearance over a dark page: the light material, never the page's", st.classes.includes("t-light") && !st.classes.includes("t-raised"), st.classes);
    await capture("attack-light-on-dark");
    await esc();
    await M.load(article);
    await M.openOn("#link1");
    st = M.state();
    check("light appearance over a light page: the light material", st.classes.includes("t-light"), st.classes);
    await capture("attack-light-on-light");
    await esc();
    b.sys("VitreSettings").set({ theme: prev || "system" });
    await sleep(600);
  });

  // ---- 8. The service under abuse ----
  await V.section("service abuse", async () => {
    const api = M.menus().api;
    let closes = 0;
    api.show([], { x: 300, y: 300 }, { onClose: () => closes++ });
    check("service: no rows, no menu, onClose still runs once", !M.isOpen() && closes === 1, closes);
    closes = 0;
    api.show([{ separator: true }, { caption: "Only a caption" }, { separator: true }], { x: 300, y: 300 }, { onClose: () => closes++ });
    check("service: separators and a caption only: no menu, onClose once", !M.isOpen() && closes === 1, closes);
    api.close();
    api.close();
    const ran = [];
    api.show(
      [
        { label: "<b>bold</b> & co", run: () => ran.push("html") },
        { label: "A&&B", run: () => ran.push("amp") },
        { label: "Bad icon", icon: "javascript:alert(1)", run: () => {} },
        { label: "File icon", icon: "file:///C:/Windows/win.ini", run: () => {} },
        { separator: true },
        { separator: true },
        { label: "Deep", submenu: [{ label: "Deeper", submenu: [{ label: "Deepest", run: () => ran.push("deep") }] }] },
      ],
      { x: 300, y: 300 },
      { keyboard: true }
    );
    check("service: opened", M.isOpen());
    const el = M.menus().view.rowElement(0);
    check("service: markup in a label is text", el.querySelector("b") === null && el.textContent.includes("<b>bold</b>"), el.textContent);
    check("service: '&&' shows one '&'", M.labels()[1] === "A&B", M.labels()[1]);
    const imgs = M.menus().view.rowElement(2).querySelectorAll("img").length + M.menus().view.rowElement(3).querySelectorAll("img").length;
    check("service: javascript: and file: icons are not loaded", imgs === 0, imgs);
    const seps = document.querySelectorAll(".vt-menus .vt-menu[role=menu] .vt-sep").length;
    check("service: doubled separators collapse", seps === 1, seps);
    // No submenus (design): nested rows are listed in place under their captions.
    check("service: nested submenus are listed in place under captions", M.labels().includes("Deepest") && M.state().submenus === 0 && (M.state().captions || []).join("|") === "Deep|Deeper", { labels: M.labels(), captions: M.state().captions });
    M.key("KEY_End");
    M.key("KEY_Enter");
    await M.waitClosed();
    check("service: Enter on the deepest row ran it and closed everything", ran.includes("deep") && V.menuNodes().panels === 0, { ran, nodes: V.menuNodes() });
    // Forty rows: the menu fits the window and scrolls.
    api.show(Array.from({ length: 40 }, (_, i) => ({ label: "Row " + (i + 1), run: () => {} })), { x: 300, y: 300 });
    await sleep(300); // the open motion (scale 0.96) has landed
    const st = M.state();
    check("service: forty rows fit inside the window (8 px margins)", st.rect.top >= 8 && st.rect.top + st.rect.height <= window.innerHeight - 8 + 0.5, st.rect);
    api.close();
    // A row whose action opens another menu (a picker): the new menu stays open.
    api.show([{ label: "Open another", run: () => api.show([{ label: "Second menu", run: () => {} }], { x: 500, y: 400 }) }], { x: 300, y: 300 });
    await M.pick("Open another", { stayOpen: true });
    await sleep(200);
    check("service: a row that opens another menu leaves that menu open", M.isOpen() && M.labels()[0] === "Second menu", M.labels());
    await esc();
    // show() twice in a row: one menu.
    api.show([{ label: "One", run: () => {} }], { x: 300, y: 300 });
    api.show([{ label: "Two", run: () => {} }], { x: 320, y: 320 });
    await sleep(300);
    check("service: two shows, one menu", V.menuNodes().panels === 1 && M.labels()[0] === "Two", V.menuNodes());
    await esc();
  });

  // ---- 10. A second window, a private window, a popup window ----
  await V.section("other windows", async () => {
    await M.load(article);
    await M.openOn("#link1");
    check("windows: a menu in the first window", M.isOpen());
    const win2 = await spike.openWindow();
    await win2.spike.activate();
    await sleep(500);
    check("windows: another window becoming active closes the first window's menu (deactivation)", !M.isOpen(), { open: M.isOpen(), active: Services.focus.activeWindow === win2 });
    await win2.spike.resize(1200, 800);
    await win2.spike.activate();
    const M2 = win2.M;
    win2.M.fakeServices();
    await M2.load(article);
    const o2 = await M2.openOn("#link1");
    check("windows: a menu in the second window", o2.ok && M2.last().kind === "link", M2.last().kind);
    check("windows: none in the first", !M.isOpen());
    await win2.spike.capture("attack-window2");
    await M2.pick("Copy link address");
    check("windows: second window's action ran", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html"), M.readClipboard());
    // Close the window with a menu open.
    await M2.openOn("#link1");
    const weak = Cu.getWeakReference(win2);
    const gone = new Promise((r) => win2.addEventListener("unload", r, { once: true }));
    win2.close();
    await gone;
    await sleep(800);
    await M.activate();
    const back = await M.openOn("#link1");
    check("windows: the first window's menus still work after the other closed with a menu open", back.ok);
    await esc();
    for (let i = 0; i < 6; i++) {
      Cu.forceGC();
      Cu.forceCC();
      await sleep(300);
    }
    log("closed window collected after GC/CC:", !weak.get());

    // Private window.
    const winP = await spike.openWindow({ private: true });
    await winP.spike.resize(1200, 800);
    await winP.spike.activate();
    const MP = winP.M;
    const fakeP = MP.fakeServices();
    await MP.load(article);
    const tabsP = winP.vitre.tabs.length;
    const tabs1 = b.tabs.length;
    await MP.openOn("#link1");
    check("private: link menu", MP.isOpen() && MP.last().kind === "link");
    await winP.spike.capture("attack-private");
    await MP.pick("Open link in new tab");
    await until(() => winP.vitre.tabs.length === tabsP + 1, 4000);
    const opened = winP.vitre.tabs[winP.vitre.tabs.length - 1];
    const PBU = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils;
    check("private: Open link in new tab stays in the private window, private", winP.vitre.tabs.length === tabsP + 1 && b.tabs.length === tabs1 && PBU.isBrowserPrivate(opened.browser), { p: winP.vitre.tabs.length, n: b.tabs.length });
    await MP.openOn("#link1");
    await MP.pick("Download linked file");
    const dl = fakeP.take().find((c) => c.name === "downloads.download");
    check("private: Download linked file tells the downloader it is private", dl && dl.args[1]?.isPrivate === true, dl && { url: dl.args[0], isPrivate: dl.args[1]?.isPrivate });
    const goneP = new Promise((r) => winP.addEventListener("unload", r, { once: true }));
    winP.close();
    await goneP;
    await sleep(600);
    await M.activate();

    // A popup window (window.open with features) from a click in the page. Vitre ships the
    // restriction at 0 (sized popups become tabs); 2, Firefox's default, gives a real popup window.
    Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
    await M.load(V.page("hang.html"));
    const before = new Set([...Services.wm.getEnumerator("navigator:browser")]);
    const btn = await M.rectOf("#pop");
    M.mouse(btn.cx, btn.cy);
    let popup = null;
    await until(() => {
      for (const w of Services.wm.getEnumerator("navigator:browser")) if (!before.has(w) && w.vitre) popup = w;
      return popup;
    }, 8000);
    check("popup: a popup window opened", !!popup);
    if (popup) {
      await until(() => popup.vitre?.isPopup !== undefined && popup.M, 8000);
      await new Promise((r) => (popup.vitre.whenReady ? Promise.resolve(popup.vitre.whenReady).then(r) : r()));
      await sleep(1200);
      await popup.spike.activate();
      check("popup: Vitre sees it as a popup", popup.vitre.isPopup === true, popup.vitre.isPopup);
      const PM = popup.M;
      PM.fakeServices();
      const pt = popup.vitre.active();
      await until(() => pt && !pt.loading && pt.url.includes("plain.html"), 8000);
      await sleep(500);
      await popup.spike.activate();
      const pill = popup.vitre.bar.item(pt.id);
      const r = pill.getBoundingClientRect();
      PM.rightClick(r.left + r.width / 2, r.top + r.height / 2);
      const pillOpen = await PM.waitOpen();
      const rows = pillOpen ? PM.labels() : [];
      log("popup pill rows", JSON.stringify(rows));
      check("popup: the read-only pill's menu has no tab-strip rows", pillOpen && !rows.includes("Duplicate tab") && !rows.includes("Close other tabs") && !rows.includes("Move tab to new window") && rows.includes("Copy address"), rows);
      await popup.spike.capture("attack-popup-pill");
      if (PM.isOpen()) PM.key("KEY_Escape");
      await sleep(200);
      const n1 = b.tabs.length;
      const o = await PM.openOn("#link");
      check("popup: link menu in the popup", o.ok && PM.last().kind === "link", PM.last().kind);
      await popup.spike.capture("attack-popup-link");
      await PM.pick("Open link in new tab");
      check("popup: Open link in new tab opens in the normal window", await until(() => b.tabs.length === n1 + 1, 5000), { before: n1, now: b.tabs.length });
      const goneW = new Promise((res) => popup.addEventListener("unload", res, { once: true }));
      popup.close();
      await goneW;
      await sleep(500);
    }
    Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 0);
    await M.activate();
    while (b.tabs.length > 1) b.closeTab(b.tabs[b.tabs.length - 1]);
    await sleep(400);
  });

  // ---- 11. Window full screen (F11): a bar menu keeps the revealed bar ----
  await V.section("F11", async () => {
    await M.load(article);
    await M.activate();
    b.run("fullscreen");
    const fs = await until(() => window.fullScreen, 5000);
    check("F11: window full screen", fs);
    if (!fs) return;
    await sleep(1200);
    M.mouse(720, 4, { type: "mousemove" });
    await until(() => !b.bar.hidden, 3000);
    await sleep(500);
    const plus = document.querySelector("#vitre-bar .item.plus");
    const r = plus.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    check("F11: + menu opened", await M.waitOpen());
    const st = M.state();
    const row = st.rows.find((x) => x.label === "Full screen");
    check("F11: Full screen is checked", row && row.checked === true, row);
    const lastRow = M.menus().view.rowElement(st.rows.length - 1).getBoundingClientRect();
    M.mouse(lastRow.left + 40, lastRow.top + lastRow.height / 2, { type: "mousemove" });
    await sleep(1300);
    check("F11: the bar stays while its menu is open", !b.bar.hidden && M.isOpen(), { hidden: b.bar.hidden, open: M.isOpen() });
    await capture("attack-f11-plus");
    await M.pick("Full screen");
    check("F11: Full screen from the menu leaves full screen", await until(() => !window.fullScreen, 5000));
    await sleep(1200);
    await spike.resize(1440, 900);
  });

  // ---- 11b. Element full screen: Esc closes the menu first (ladder: menu 20 before full screen 50) ----
  await V.section("element full screen Esc", async () => {
    Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
    await M.load(article);
    await M.inContent(b.active().browser, async (content) => {
      await content.document.getElementById("cv").requestFullscreen();
    });
    const fs = await until(() => document.documentElement.hasAttribute("inDOMFullscreen"), 6000);
    check("element full screen: entered", fs);
    if (!fs) return;
    await sleep(1200);
    M.rightClick(700, 450);
    check("element full screen: menu opened", await M.waitOpen());
    M.key("KEY_Escape");
    await sleep(600);
    check("element full screen: the first Esc closes only the menu", !M.isOpen() && document.documentElement.hasAttribute("inDOMFullscreen"), { open: M.isOpen(), fullscreen: document.documentElement.hasAttribute("inDOMFullscreen") });
    M.key("KEY_Escape");
    check("element full screen: the next Esc leaves full screen", await until(() => !document.documentElement.hasAttribute("inDOMFullscreen"), 4000));
    await sleep(800);
    if (window.fullScreen) window.fullScreen = false;
    await spike.resize(1440, 900);
  });

  // ---- 12. Nothing left behind ----
  await V.section("leftovers", async () => {
    await sleep(500);
    const nodes = V.menuNodes();
    check("leftovers: no menu, wash, owner or catcher left", nodes.allPanels === 0 && nodes.washes === 0 && nodes.owners === 0 && !nodes.catcherUp, nodes);
    const scratch = document.getElementById("vitre-menus-ext-scratch");
    check("leftovers: the extension scratch popup is empty", !scratch || scratch.children.length === 0, scratch?.children.length);
    const ext = [...popupNode.children].filter((n) => String(n.id).includes("-menuitem-")).length;
    check("leftovers: no extension items left in Firefox's popup", ext === 0, ext);
    check("leftovers: gContextMenu ended", !window.gContextMenu);
    check("leftovers: the native page popup was never shown", M.last().nativeShown === 0, M.last().nativeShown);
    check("leftovers: no top-layer host outside element full screen", !document.getElementById("vitre-menus-top"));
    // Transparency effects (Windows) and how the menu could know: the media query must parse in chrome.
    let enableTransparency = null;
    try {
      const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
      key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", Ci.nsIWindowsRegKey.ACCESS_READ);
      enableTransparency = key.readIntValue("EnableTransparency");
      key.close();
    } catch (e) {
      enableTransparency = String(e).slice(0, 80);
    }
    const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
    log("transparency", JSON.stringify({ windowsEnableTransparency: enableTransparency, mediaParsed: mq.media, reduce: mq.matches, pref: Services.prefs.getBoolPref("layout.css.prefers-reduced-transparency.enabled", null) }));
    const errs = V.errors();
    log("console errors from Vitre during the run", JSON.stringify(errs));
    check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
  });
  void fake;
});
