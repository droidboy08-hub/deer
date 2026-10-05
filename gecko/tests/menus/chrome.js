// Vitre's own menus (MenuChrome.dc.html): the active pill, a background circle, the + circle, the
// address field, Home; the drag strip and window controls keep Windows' system menu; and the
// 'menus' service other modules use (points, elements, alignment, flattened submenus, onClose, keyboard).
/* global spike, Services, Cc, Ci, ChromeUtils, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  const fake = M.fakeServices();
  const article = M.page("article.html");
  await M.load(article);
  const tab0 = b.active();
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(150);
  };
  const rightClickEl = (el, dx, dy) => {
    const r = el.getBoundingClientRect();
    const x = dx == null ? r.left + r.width / 2 : r.left + dx;
    const y = dy == null ? r.top + r.height / 2 : r.top + dy;
    M.rightClick(x, y);
    return { x, y, r };
  };
  const windows = () => {
    let c = 0;
    for (const w of Services.wm.getEnumerator("navigator:browser")) if (!w.closed) c++;
    return c;
  };
  const closeOtherWindows = async () => {
    for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window) w.close();
    await sleep(800);
    await M.activate();
  };

  // ---- the active pill ----
  const second = b.newTab(M.page("counter.html"), { background: true });
  await sleep(600);
  M.setClipboard(M.page("counter.html?pasted=1"));
  let pill = b.bar.item(tab0.id);
  let at = rightClickEl(pill, 300, 22);
  check("pill: menu opened", await M.waitOpen());
  let st = M.describe("PILL");
  check("pill rows", JSON.stringify(st.rows.map((r) => r.label)) === JSON.stringify(["Copy address", "Paste and go", "Duplicate tab", "Move tab to new window", "Close other tabs", "Close tab"]), st.rows.map((r) => r.label));
  check("pill: hangs at y 64 from the pointer x - 16", Math.abs(st.rect.top - 64) <= 1 && Math.abs(st.rect.left - (at.x - 16)) <= 1, { menu: [st.rect.left, st.rect.top], x: at.x });
  check("pill: Close tab prints Ctrl+W", st.rows[5].key === "Ctrl+W", st.rows[5]);
  check("pill keeps its pressed look", pill.classList.contains("vt-menu-owner"));
  await capture("chrome-pill");
  await M.pick("Copy address");
  check("pill Copy address", (await M.clipboardIs(article)) === article, M.readClipboard());
  M.setClipboard("float glass ribbons");
  rightClickEl(pill, 300, 22);
  await M.waitOpen();
  check("text on the clipboard: Paste and search", M.labels()[1] === "Paste and search", M.labels());
  await close();
  M.setClipboard(M.page("counter.html?pasted=1"));
  rightClickEl(pill, 300, 22);
  await M.waitOpen();
  await M.pick("Paste and go");
  await spike.waitFor(() => tab0.url.includes("pasted=1"), { what: "paste and go" }).catch(() => null);
  check("Paste and go", tab0.url === M.page("counter.html?pasted=1"), tab0.url);
  await M.load(article);
  let n = b.tabs.length;
  rightClickEl(pill, 300, 22);
  await M.waitOpen();
  await M.pick("Duplicate tab");
  await spike.waitFor(() => b.tabs.length === n + 1 && b.tabs[b.tabs.indexOf(tab0) + 1]?.url === article, { what: "duplicate" }).catch(() => null);
  const dup = b.tabs[b.tabs.indexOf(tab0) + 1];
  check("Duplicate tab: a copy right after it", b.tabs.length === n + 1 && dup?.url === article, dup?.url);
  await b.activate(tab0);
  await sleep(300);

  // ---- a background circle ----
  let item = b.bar.item(second.id);
  at = rightClickEl(item);
  check("circle: menu opened", await M.waitOpen());
  st = M.describe("CIRCLE");
  check("circle: caption names the tab", st.captions[0] === "Counter - Field Notes · 127.0.0.1", st.captions);
  check("circle rows", JSON.stringify(st.rows.map((r) => r.label)) === JSON.stringify(["Reload tab", "Duplicate tab", "Copy address", "Move tab to new window", "Close other tabs", "Close tab"]), st.rows.map((r) => r.label));
  check("circle: Close tab has no key (Ctrl+W closes the active tab)", st.rows[5].key === "", st.rows[5]);
  check("circle: height has the 28 px caption", Math.abs(st.rect.height - (12 + 28 + 9 + 6 * 34 + 9)) <= 1, st.rect.height);
  check("circle: hangs at y 64", Math.abs(st.rect.top - 64) <= 1 && Math.abs(st.rect.left - (at.x - 16)) <= 1, st.rect);
  await capture("chrome-circle");
  await M.pick("Copy address");
  check("circle Copy address", (await M.clipboardIs(second.url)) === second.url, M.readClipboard());
  const w0 = windows();
  rightClickEl(b.bar.item(second.id));
  await M.waitOpen();
  await M.pick("Move tab to new window");
  await spike.waitFor(() => windows() === w0 + 1 && !b.tabs.includes(second), { what: "moved window", timeout: 8000 }).catch(() => null);
  check("Move tab to new window", windows() === w0 + 1 && !b.tabs.includes(second), { windows: windows(), tabs: b.tabs.length });
  await closeOtherWindows();
  // mute: a tab that has played sound gets Mute tab
  const clip = "";
  Services.prefs.setIntPref("media.autoplay.default", 0);
  Services.prefs.setBoolPref("media.autoplay.block-webaudio", false);
  const noisy = b.newTab(M.page("counter.html?noisy=1"), { background: true });
  await spike.waitFor(() => !noisy.loading && noisy.url.includes("noisy"), { what: "noisy tab" });
  await M.inContent(noisy.browser, async (content, src) => {
    const ctx = new content.AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.02;
    o.connect(g).connect(ctx.destination);
    o.start();
    content.wrappedJSObject.__osc = o;
  }, clip);
  await spike.waitFor(() => noisy.audible, { what: "sound", timeout: 6000 }).catch(() => null);
  rightClickEl(b.bar.item(noisy.id));
  await M.waitOpen();
  st = M.describe("CIRCLE WITH SOUND");
  check("a tab that played sound: Mute tab", st.rows.some((r) => r.label === "Mute tab"), { audible: noisy.audible, rows: st.rows.map((r) => r.label) });
  if (st.rows.some((r) => r.label === "Mute tab")) {
    await M.pick("Mute tab");
    await spike.waitFor(() => noisy.muted, { what: "muted", timeout: 3000 }).catch(() => null);
    check("Mute tab", noisy.muted);
  } else await close();
  b.closeTab(noisy);
  await sleep(300);
  // Close other tabs
  n = b.tabs.length;
  rightClickEl(b.bar.item(tab0.id), 300, 22);
  await M.waitOpen();
  await M.pick("Close other tabs");
  await sleep(500);
  check("Close other tabs", b.tabs.length === 1 && b.tabs[0] === tab0, b.tabs.map((t) => t.url));

  // ---- the + circle ----
  const plus = document.querySelector("#vitre-bar .item.plus");
  at = rightClickEl(plus);
  await M.waitOpen();
  st = M.describe("PLUS");
  check("plus rows", JSON.stringify(st.rows.map((r) => r.label)) === JSON.stringify(["New window", "New private window", "Reopen closed tab", "Show downloads", "Full screen", "Settings"]), st.rows.map((r) => r.label));
  check("plus: accelerators", st.rows.map((r) => r.key).join(",") === "Ctrl+N,Ctrl+Shift+N,Ctrl+Shift+T,Ctrl+J,F11,Ctrl+,", st.rows.map((r) => r.key));
  check("plus: Full screen is a check item, off", st.rows[4].checked === false, st.rows[4]);
  check("plus: Reopen closed tab on (tabs were closed)", !st.rows[1].disabled, st.rows[1]);
  await capture("chrome-plus");
  await M.pick("Show downloads");
  check("Show downloads: downloads.openPanel()", fake.take().some((c) => c.name === "downloads.openPanel"));
  rightClickEl(plus);
  await M.waitOpen();
  await M.pick("Settings");
  check("Settings: settings.open()", fake.take().some((c) => c.name === "settings.open"));
  n = b.tabs.length;
  rightClickEl(plus);
  await M.waitOpen();
  await M.pick("Reopen closed tab");
  await spike.waitFor(() => b.tabs.length === n + 1, { what: "reopened" }).catch(() => null);
  check("Reopen closed tab", b.tabs.length === n + 1, b.tabs.length);
  const w1 = windows();
  rightClickEl(plus);
  await M.waitOpen();
  await M.pick("New window");
  await spike.waitFor(() => windows() === w1 + 1, { what: "new window", timeout: 8000 }).catch(() => null);
  check("New window", windows() === w1 + 1, windows());
  await closeOtherWindows();
  await b.activate(tab0);
  for (const t of [...b.tabs]) if (t !== tab0) b.closeTab(t);
  await sleep(400);

  // ---- the address field ----
  b.editAddress();
  await spike.waitFor(() => b.omni.open && b.omni.focused, { what: "address field" });
  b.omni.input.value = "float glass history";
  b.omni.input.select();
  await sleep(200);
  M.setClipboard("refract.wiki");
  rightClickEl(b.omni.input, 120, 24);
  await M.waitOpen();
  st = M.describe("ADDRESS");
  check("address field rows", JSON.stringify(st.rows.map((r) => r.label)) === JSON.stringify(["Undo", "Cut", "Copy", "Paste", "Paste and go", "Select all"]), st.rows.map((r) => r.label));
  check("address field stays open and focused under its menu", b.omni.open && b.omni.focused);
  await capture("chrome-address");
  await M.pick("Copy");
  check("address field Copy", (await M.clipboardIs("float glass history")) === "float glass history", M.readClipboard());
  check("address field still open after Copy", b.omni.open);
  b.omni.close();
  await sleep(300);

  // ---- a history suggestion: Remove from history, only on a row the user moved onto ----
  b.editAddress("");
  await spike.waitFor(() => b.omni.open && b.omni.focused, { what: "address field" });
  spike.type("counter");
  const histRow = await spike.waitFor(() => [...document.querySelectorAll("#vitre-omni-list .omni-item")].find((r) => /Counter/.test(r.textContent) && r.dataset.i !== "0"), { timeout: 5000, what: "history row" }).catch(() => null);
  check("a history row for the counter page", !!histRow, [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((r) => r.textContent));
  if (histRow) {
    let hr = histRow.getBoundingClientRect();
    M.rightClick(hr.left + 80, hr.top + hr.height / 2);
    await sleep(500);
    // the pointer moving onto the row before the press counts as moving onto it
    st = M.state();
    check("suggestion row: Remove from history Shift+Delete", st.open && st.rows.length === 1 && st.rows[0].label === "Remove from history" && st.rows[0].key === "Shift+Delete", st.rows);
    await capture("chrome-suggestion");
    const before = document.querySelectorAll("#vitre-omni-list .omni-item").length;
    if (st.open) await M.pick("Remove from history");
    await spike.waitFor(() => document.querySelectorAll("#vitre-omni-list .omni-item").length < before, { timeout: 3000, what: "row removed" }).catch(() => null);
    check("Remove from history: the row goes, the field stays open", document.querySelectorAll("#vitre-omni-list .omni-item").length < before && b.omni.open, document.querySelectorAll("#vitre-omni-list .omni-item").length);
  }
  b.omni.close();
  await sleep(300);

  // ---- Home ----
  const home = b.newTab();
  await spike.waitFor(() => home.kind === "home" && !home.loading, { what: "home" });
  if (b.omni.open) b.omni.close();
  await sleep(800);
  M.setClipboard("example.org");
  M.rightClick(700, 600);
  check("Home: menu opened", await M.waitOpen());
  st = M.describe("HOME");
  check("Home rows", JSON.stringify(st.rows.map((r) => r.label)) === JSON.stringify(["Paste and go", "Change background…", "Show tab bar", "Settings"]), st.rows.map((r) => r.label));
  check("Home: Show tab bar checked, no Inspect", st.rows[2].checked === true && !st.rows.some((r) => r.label === "Inspect"), st.rows);
  check("Home: kind home", M.last().kind === "home", M.last().kind);
  await capture("chrome-home");
  await M.pick("Change background…");
  // MenuChrome: "Change background opens the background popover" (the settings service's
  // changeBackground(): Home's popover on Home, Settings › Home and background elsewhere).
  const sc = fake.take();
  check("Change background…: settings.changeBackground()", sc.some((c) => c.name === "settings.changeBackground") && !sc.some((c) => c.name === "settings.open"), sc.map((c) => c.name));
  M.rightClick(700, 600);
  await M.waitOpen();
  await M.pick("Show tab bar");
  await sleep(300);
  check("Show tab bar toggles the auto-hide setting", b.settings.barAutoHide === true, b.settings.barAutoHide);
  b.sys("VitreSettings").set({ barAutoHide: false });
  await sleep(300);
  b.closeTab(home);
  await b.activate(tab0);
  await sleep(400);

  // ---- the drag strip and the window controls: Windows' own system menu ----
  const gecko = {
    showing: () => {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const u = ctypes.open("user32.dll");
      const FindWindowW = u.declare("FindWindowW", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
      const IsWindowVisible = u.declare("IsWindowVisible", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t);
      const m = FindWindowW("#32768", null);
      return !m.isNull() && !!IsWindowVisible(m);
    },
    rect: () => {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const u = ctypes.open("user32.dll");
      const FindWindowW = u.declare("FindWindowW", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
      const GetWindowRect = u.declare("GetWindowRect", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.int32_t.array(4));
      const m = FindWindowW("#32768", null);
      if (m.isNull()) return null;
      const r = ctypes.int32_t.array(4)();
      GetWindowRect(m, r);
      return [r[0], r[1], r[2], r[3]];
    },
    end: () => {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const u = ctypes.open("user32.dll");
      u.declare("EndMenu", ctypes.winapi_abi, ctypes.int32_t)();
    },
  };
  const strip = document.getElementById("vitre-drag");
  check("no Win32 menu showing before", !gecko.showing());
  const pages = M.last().pageMenus;
  rightClickEl(strip, 200, 12);
  const sys1 = await spike.waitFor(() => gecko.showing(), { timeout: 3000, what: "system menu" }).catch(() => false);
  check("drag strip: Windows' system menu", !!sys1 && !M.isOpen() && M.last().pageMenus === pages, { system: !!sys1, vitre: M.isOpen() });
  gecko.end();
  await spike.waitFor(() => !gecko.showing(), { timeout: 3000, what: "system menu closed" }).catch(() => null);
  await sleep(300);
  rightClickEl(document.getElementById("vitre-win-max"));
  const sys2 = await spike.waitFor(() => gecko.showing(), { timeout: 3000, what: "system menu" }).catch(() => false);
  check("window controls: Windows' system menu", !!sys2 && !M.isOpen(), { system: !!sys2 });
  gecko.end();
  await sleep(400);
  // the real path: Windows sends WM_CONTEXTMENU with the pointer for a right-click; Gecko turns it
  // into a contextmenu event at that point
  for (const [name, el, dx, dy] of [["strip", strip, 300, 10], ["window controls", document.getElementById("vitre-win-min"), null, null]]) {
    const w = M.win32();
    const r = el.getBoundingClientRect();
    const px = r.left + (dx ?? r.width / 2);
    const py = r.top + (dy ?? r.height / 2);
    const dpr = window.devicePixelRatio;
    const sx = Math.round((window.mozInnerScreenX + px) * dpr);
    const sy = Math.round((window.mozInnerScreenY + py) * dpr);
    w.post(0x007b, w.self, ((sy & 0xffff) << 16) | (sx & 0xffff));
    const rect = await spike.waitFor(() => gecko.showing() && gecko.rect(), { timeout: 3000, what: "system menu" }).catch(() => null);
    check("real right-click (WM_CONTEXTMENU) on the " + name + ": the system menu at the pointer", !!rect && Math.abs(rect[0] - sx) <= 2 && Math.abs(rect[1] - sy) <= 2 && !M.isOpen(), { rect, pointer: [sx, sy] });
    gecko.end();
    await spike.waitFor(() => !gecko.showing(), { timeout: 3000, what: "system menu closed" }).catch(() => null);
    await sleep(300);
  }

  // ---- the service ----
  const menus = b.service("menus");
  let closed = 0;
  let ran = "";
  const items = [
    { label: "Show &downloads", key: "Ctrl+J", icon: "download", run: () => (ran = "downloads") },
    { label: "Open Downloads folder", access: "F", icon: "folder", run: () => (ran = "folder") },
    { separator: true },
    { label: "Pause all", access: "P", icon: "pause", run: () => (ran = "pause") },
    { label: "Remove from list", access: "R", danger: true, run: () => (ran = "remove") },
    { label: "Ask where to save", access: "A", checked: true, run: () => (ran = "ask") },
    { separator: true },
    { caption: "More" },
    {
      label: "Sort by",
      access: "S",
      submenu: [
        { label: "Name", access: "N", run: () => (ran = "sort-name") },
        { label: "Date", access: "D", checked: true, run: () => (ran = "sort-date") },
        { label: "Size", access: "Z", disabled: true, run: () => (ran = "sort-size") },
      ],
    },
  ];
  menus.show(items, { x: 300, y: 300 }, { onClose: () => closed++ });
  await M.waitOpen();
  st = M.describe("SERVICE POINT");
  check("service: menu at the point", Math.abs(st.rect.left - 300) <= 1 && Math.abs(st.rect.top - 300) <= 1, st.rect);
  check("service: '&' marks the access key", st.rows[0].label === "Show downloads" && st.rows[0].access === "d", st.rows[0]);
  check("service: danger row", document.querySelector("#layer-menus .vt-mi.danger") !== null);
  // The design has no submenus (DESIGN-NOTES "Right-click menus"): a row with children becomes a
  // caption with its label, its rows listed in place (menus/types.ts flatten).
  const flat = st.rows.map((r) => r.label);
  check("service: no submenu: 'Sort by' is a caption and its rows are listed in place", !document.querySelector("#layer-menus .vt-mi-sub") && M.state().submenus === 0 && flat.slice(5).join("|") === "Name|Date|Size" && (st.captions || []).includes("Sort by"), { flat, captions: st.captions });
  check("service: the listed rows keep their check and disabled state", st.rows[6]?.checked === true && st.rows[7]?.disabled === true, st.rows.slice(5));
  check("service: height still follows the spec formula with the extra caption", Math.abs(st.rect.height - M.expectedHeight(M.menus().view)) <= 1, { h: st.rect.height, want: M.expectedHeight(M.menus().view) });
  await capture("chrome-service-flattened");
  // keys reach the listed rows: End goes to the last row (Size, disabled but reachable), Up to Date
  M.key("KEY_End");
  M.key("KEY_ArrowUp");
  M.key("KEY_Enter");
  check("Enter on a listed row runs it and the menu closes", ran === "sort-date" && (await M.waitClosed()) && closed === 1, { ran, closed });
  // a click on a listed row
  menus.show(items, { x: 300, y: 300 });
  await M.waitOpen();
  const childRow = M.menus().view.rowElement(5).getBoundingClientRect();
  M.mouse(childRow.left + 30, childRow.top + 17, { type: "mousemove" });
  await sleep(100);
  M.mouse(childRow.left + 30, childRow.top + 17, { type: "mousedown" });
  M.mouse(childRow.left + 30, childRow.top + 17, { type: "mouseup" });
  check("a click on a listed row runs it", ran === "sort-name" && (await M.waitClosed()), ran);
  // element anchor, above and right-aligned (the downloads ring)
  const ring = document.createElement("div");
  ring.style.cssText = "position:absolute;left:1324px;top:836px;width:44px;height:44px;border-radius:22px;background:rgba(255,255,255,.3)";
  M.b.layer("menus-test", 30).append(ring);
  menus.show(items.slice(0, 6), ring, { align: "above-end" });
  await M.waitOpen();
  st = M.describe("SERVICE RING");
  check("element anchor, above-end: right edge 1368, bottom 828 (the ring)", Math.abs(st.rect.left + st.rect.width - 1368) <= 1 && Math.abs(st.rect.top + st.rect.height - 828) <= 1, st.rect);
  check("the anchor element gets aria-expanded while open", ring.getAttribute("aria-expanded") === "true");
  await capture("chrome-service-ring");
  M.key("p");
  check("access key in a service menu", ran === "pause" && (await M.waitClosed()), ran);
  // keyboard detection: show() from a keyboard-triggered contextmenu
  const btn = document.createElement("button");
  btn.textContent = "module button";
  btn.style.cssText = "position:absolute;left:600px;top:400px";
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menus.show(items.slice(0, 4), btn);
  });
  M.b.layer("menus-test", 30).append(btn);
  btn.focus();
  await sleep(100);
  M.keyboardMenu();
  await M.waitOpen();
  st = M.describe("SERVICE KEYBOARD");
  check("show() during a keyboard contextmenu: first row focused, keys underlined", st.active === 0 && st.classes.includes("keys"), st);
  check("…and only that one menu (no chrome menu over it)", M.state().rows.length === 3, M.state().rows.length);
  await close();
  // editItems for a module's own field
  const field = document.createElement("input");
  field.value = "find me";
  M.b.layer("menus-test", 30).append(field);
  const edit = menus.editItems(field).map((r) => r.label || (r.separator ? "—" : ""));
  check("editItems: the standard editing rows", JSON.stringify(edit) === JSON.stringify(["Undo", "Redo", "—", "Cut", "Copy", "Paste", "Select all"]), edit);
  ring.remove();
  btn.remove();
  field.remove();
  // label rules: '&&' is a literal '&' even with an explicit access key; a single letter in `key` is an access key
  menus.show([{ label: "R&&D notes", access: "n", run: () => (ran = "rd") }, { label: "Close peek", key: "C", run: () => (ran = "close-peek") }], { x: 200, y: 200 });
  await M.waitOpen();
  st = M.state();
  check("'&&' shows one '&'", st.rows[0].label === "R&D notes" && st.rows[0].access === "n", st.rows[0]);
  check("a single letter in key is the access key, not printed", st.rows[1].key === "" && st.rows[1].access === "c" && !document.querySelector("#layer-menus .vt-menu .vt-mi-accel"), st.rows[1]);
  M.key("c");
  check("…and it runs", ran === "close-peek" && (await M.waitClosed()), ran);
  // reduced-motion and close(): close() is instant
  menus.show(items.slice(0, 2), { x: 200, y: 200 });
  await M.waitOpen();
  menus.close();
  check("menus.close() is instant", !M.isOpen() && !document.querySelector("#layer-menus .vt-menu"));
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
});
