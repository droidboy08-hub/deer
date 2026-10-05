// Menus opened from the keyboard, through the real Windows path: WM_CONTEXTMENU with lParam -1 is
// what Windows sends for the Menu key and Shift+F10 (posted to this window; no OS focus needed).
// Placement (DESIGN-NOTES "Placement", Keyboard), the focused first row, underlined access keys and
// every menu key; keys never reach the page or Vitre's shortcuts while a menu is open.
/* global spike, Services, Cc, Ci, ChromeUtils, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  await M.load(M.page("article.html"));
  const tab = b.active();
  const page = (fn, arg) => M.inContent(tab.browser, fn, arg);
  const lastKey = () => page((content) => content.document.documentElement.dataset.lastKey || "");
  const kbd = async () => {
    await M.activate();
    M.keyboardMenu();
    return M.waitOpen();
  };
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(150);
  };

  // ---- a focused link ----
  await page((content) => {
    content.scrollTo(0, 0);
    content.document.getElementById("link1").focus();
  });
  tab.browser.focus();
  await sleep(300);
  let link = await M.rectOf("#link1", { scroll: false });
  check("keyboard menu on a focused link opened", await kbd());
  let st = M.describe("KBD LINK");
  check("keyboard: detected as keyboard", M.last().context.keyboard === true && st.source === "keyboard", M.last().context);
  check("keyboard: the link menu", st.rows[0]?.label === "Open link in new tab", st.rows.map((r) => r.label));
  check("keyboard: first item focused", st.active === 0, st.active);
  check("keyboard: access keys underlined", st.classes.includes("keys"), st.classes);
  check("keyboard: 4 px below the link, left-aligned to it", Math.abs(st.rect.left - link.x) <= 2 && Math.abs(st.rect.top - (link.bottom + 4)) <= 2, { menu: [st.rect.left, st.rect.top], link: [link.x, link.bottom] });
  const underlined = [...document.querySelectorAll("#layer-menus .vt-menu.keys .vt-ak")].map((e) => e.textContent).join("");
  check("keyboard: the designed access letters", underlined.toUpperCase() === "TPWEDN", underlined);
  await capture("keyboard-link");

  // ---- moving ----
  const before = await lastKey();
  M.key("KEY_ArrowDown");
  check("Down moves", M.state().active === 1, M.state().active);
  M.key("KEY_ArrowUp");
  M.key("KEY_ArrowUp");
  check("Up wraps to the last row", M.state().active === M.state().rows.length - 1, M.state().active);
  M.key("KEY_Home");
  check("Home", M.state().active === 0, M.state().active);
  M.key("KEY_End");
  check("End", M.state().active === M.state().rows.length - 1, M.state().active);
  M.key("KEY_Tab");
  check("Tab acts as Down (wraps)", M.state().active === 0, M.state().active);
  M.key("KEY_Tab", { shiftKey: true });
  check("Shift+Tab acts as Up", M.state().active === M.state().rows.length - 1, M.state().active);
  await sleep(150);
  check("keys never reached the page", (await lastKey()) === before, { before, after: await lastKey() });
  const tabs = b.tabs.length;
  M.key("t", { accelKey: true });
  await sleep(300);
  check("Ctrl+T while a menu is open does nothing", b.tabs.length === tabs && M.isOpen(), b.tabs.length);
  await capture("keyboard-moved");
  // an access key runs at once
  M.setClipboard("before");
  M.key("e");
  check("access key E: Copy link address ran, menu closed", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html") && (await M.waitClosed()), M.readClipboard());

  // Enter runs the focused row
  await page((content) => content.document.getElementById("link1").focus());
  await kbd();
  M.key("KEY_ArrowDown");
  M.key("KEY_ArrowDown");
  M.key("KEY_ArrowDown");
  M.setClipboard("before");
  check("Down x3 lands on Copy link address", M.labels()[M.state().active] === "Copy link address", M.state().active);
  M.key("KEY_Enter");
  check("Enter runs it", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html"));
  await M.waitClosed();
  // Space runs it too
  await page((content) => content.document.getElementById("link1").focus());
  await kbd();
  M.key("KEY_End");
  M.key("KEY_ArrowUp");
  M.key("KEY_ArrowUp");
  M.setClipboard("before");
  M.key(" ");
  check("Space runs the focused row", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html") && (await M.waitClosed()));
  // Esc, Alt, F10 close and leave the page alone
  for (const k of ["KEY_Escape", "KEY_Alt", "KEY_F10"]) {
    await page((content) => content.document.getElementById("link1").focus());
    await kbd();
    M.key(k);
    check(k.slice(4) + " closes", await M.waitClosed(1500));
    await sleep(200);
  }
  const focused = await page((content) => content.document.activeElement?.id);
  check("focus is back on the link", focused === "link1", focused);

  // ---- disabled rows: reachable, never run ----
  await page((content) => {
    content.document.activeElement?.blur();
    content.getSelection().removeAllRanges();
  });
  await sleep(200);
  await kbd();
  st = M.describe("KBD NOTHING FOCUSED");
  check("nothing focused: the page menu", st.rows[0]?.label === "Back", st.rows.map((r) => r.label));
  check("nothing focused: at (24, 76)", Math.abs(st.rect.left - 24) <= 1 && Math.abs(st.rect.top - 76) <= 1, st.rect);
  check("nothing focused: first enabled item focused", st.active === 0, st.active);
  M.key("KEY_ArrowDown");
  check("Down stops on a disabled row (Forward)", M.state().active === 1 && M.state().rows[1].disabled, M.state().active);
  const plate = document.querySelector("#layer-menus .vt-menu .vt-plate");
  check("the disabled row gets the faint plate", plate?.classList.contains("dis"), plate?.className);
  await capture("keyboard-disabled");
  M.key("KEY_Enter");
  await sleep(200);
  check("Enter on a disabled row does nothing", M.isOpen(), M.isOpen());
  await close();

  // ---- a selection: below its last line, from its start ----
  const sel = await page((content) => {
    const p = content.document.getElementById("p1");
    const t = p.firstChild;
    const i = t.data.indexOf("surface tension");
    const range = content.document.createRange();
    range.setStart(t, i);
    range.setEnd(t, i + 15);
    content.document.activeElement?.blur();
    const s = content.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const r = range.getClientRects();
    const a = r[0];
    const z = r[r.length - 1];
    return { left: a.left, bottom: z.bottom };
  });
  await sleep(200);
  await kbd();
  st = M.describe("KBD SELECTION");
  const box = tab.browser.getBoundingClientRect();
  check("selection: the selection menu", st.rows[0]?.label === "Copy" && st.rows[1]?.label.startsWith("Search for"), st.rows.map((r) => r.label));
  check("selection: 4 px below its last line, left-aligned to its start", Math.abs(st.rect.left - (box.left + sel.left)) <= 2 && Math.abs(st.rect.top - (box.top + sel.bottom + 4)) <= 2, { menu: [st.rect.left, st.rect.top], sel: [box.left + sel.left, box.top + sel.bottom] });
  await capture("keyboard-selection");
  await close();
  await page((content) => content.getSelection().removeAllRanges());

  // ---- caret in a field near the bottom of the window: flips up (MenuSpelling) ----
  await page((content) => {
    const ta = content.document.getElementById("ta");
    ta.scrollIntoView({ block: "end" });
    content.scrollBy(0, -40);
    ta.focus();
    const i = ta.value.indexOf("flaot") + 2;
    ta.setSelectionRange(i, i);
  });
  await M.activate();
  await sleep(1500); // the spellchecker runs on focus
  const ta = await M.rectOf("#ta", { scroll: false });
  await kbd();
  st = M.describe("KBD SPELLING");
  check("caret on a misspelled word: the spelling menu", M.last().context.spelling?.word === "flaot" && st.rows[0]?.bold, M.last().context.spelling);
  check("spelling by keyboard: the first suggestion focused", st.active === 0, st.active);
  // MenuSpelling: the menu ends 4 px above the word (menu bottom 630, "flaot" at 634). The field's
  // first line box starts at ta.y + 9 (1 px border, 8 px padding); the word's glyph box 2.3 px into
  // its 27.2 px line, so the menu's bottom sits between 4 px above the line box and its top.
  check("near the bottom: flips up, ending 4 px above the caret's word", st.rect.top + st.rect.height <= ta.y + 9 + 0.5 && st.rect.top + st.rect.height >= ta.y + 9 - 4, { menuBottom: st.rect.top + st.rect.height, lineTop: ta.y + 9, field: [ta.y, ta.bottom] });
  await capture("keyboard-spelling-flip");
  await close();

  // ---- Shift+F10 as the key itself (WM_SYSKEYDOWN VK_F10 with Shift down) ----
  await page((content) => {
    content.scrollTo(0, 0);
    content.document.getElementById("link1").focus();
  });
  await M.activate();
  await sleep(200);
  {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const GetKeyboardState = user32.declare("GetKeyboardState", ctypes.winapi_abi, ctypes.bool, ctypes.uint8_t.ptr);
    const SetKeyboardState = user32.declare("SetKeyboardState", ctypes.winapi_abi, ctypes.bool, ctypes.uint8_t.ptr);
    const setKey = (vk, down) => {
      const buf = ctypes.uint8_t.array(256)();
      GetKeyboardState(buf);
      buf[vk] = down ? 0x80 : 0;
      SetKeyboardState(buf);
    };
    const w = M.win32();
    setKey(0x10, true);
    w.post(0x0100, 0x10, 1); // WM_KEYDOWN Shift
    w.post(0x0104, 0x79, 1); // WM_SYSKEYDOWN F10
    await sleep(150);
    w.post(0x0105, 0x79, 0xc0000001 | 0); // WM_SYSKEYUP F10
    setKey(0x10, false);
    w.post(0x0101, 0x10, 0xc0000001 | 0); // WM_KEYUP Shift
  }
  const viaKey = await M.waitOpen(3000);
  check("Shift+F10 (the key) opens the keyboard menu", viaKey && M.state().source === "keyboard", M.state().source);
  await close();

  // ---- a tab circle from the keyboard (MenuChrome: left-aligned to the circle, y 64, first item focused) ----
  const other = b.newTab(M.page("counter.html"), { background: true });
  await sleep(800);
  const item = b.bar.item(other.id);
  const face = item.querySelector(".circle-face");
  face.focus();
  await sleep(150);
  check("focus is on the tab circle", document.activeElement === face, document.activeElement?.className);
  M.keyboardMenu();
  await M.waitOpen();
  st = M.describe("KBD CIRCLE");
  const ir = item.getBoundingClientRect();
  check("circle by keyboard: the circle menu with its caption", st.captions[0]?.includes("Counter") && st.rows[0]?.label === "Reload tab", { captions: st.captions, rows: st.rows.map((r) => r.label) });
  check("circle by keyboard: left-aligned to the circle, hanging at y 64", Math.abs(st.rect.left - ir.left) <= 1 && Math.abs(st.rect.top - 64) <= 1, { menu: [st.rect.left, st.rect.top], circle: ir.left });
  check("circle by keyboard: first item focused, keys shown", st.active === 0 && st.classes.includes("keys"), st);
  check("circle keeps its pressed look while the menu is open", item.classList.contains("vt-menu-owner") && item.getAttribute("aria-expanded") === "true");
  await capture("keyboard-circle");
  const n = b.tabs.length;
  M.key("c"); // Close tab
  await M.waitClosed();
  await sleep(400);
  check("access key C closed that tab", b.tabs.length === n - 1 && !b.tabs.includes(other), b.tabs.length);
  check("the pressed look is gone", !item.classList.contains("vt-menu-owner"));
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
});
