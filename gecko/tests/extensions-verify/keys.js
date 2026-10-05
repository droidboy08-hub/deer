// Keyboard-only use of the extensions cluster and the Esc / close ladders (keymap.json "Menus and
// focus": Tab from the address field walks the tab bar, Left / Right cross its stops, Enter presses,
// Shift+F10 opens the element's menu with the first row focused, Esc returns to the page).
//   python tests/extensions/runx.py --test tests/extensions-verify/keys.js --name extensions-verify-keys --app build-extensions-verify-all --out tests/extensions-verify/out/keys
// Captures: keys-1-focus-ring, keys-2-keyboard-menu.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["popup", "blocker", "panelonly", "pageaction"]) await xt.install(name);
  await xt.waitFor(() => xt.button("popup") && xt.button("blocker"), 6000);
  await xt.nav(xt.page() + "?keys");
  await sleep(600);
  const ext = window.vitreExtensions.bar;
  const pa = () => ext.pageActions.buttons.get(xt.id("pageaction"));
  await xt.waitFor(() => pa() && !pa().hidden, 4000);

  const visibleButtons = () => [...xt.toolbar().querySelectorAll(".unified-extensions-item-action-button")].filter((n) => n.getClientRects().length);
  const active = () => document.activeElement;
  const isIn = (el) => !!el && (active() === el || el.contains(active()));
  log("cluster", xt.rect(xt.cluster()), "pinned visible", visibleButtons().map((n) => n.id));

  // ---- 1. Tab from the address field walks into the cluster ----
  b.editAddress();
  await xt.waitFor(() => b.omni.open, 3000);
  await sleep(300);
  spike.press("Tab");
  await sleep(300);
  log("after Tab", vx.focused());
  check("Tab from the address field: the page action button is the next stop (the cluster comes right after the address)", isIn(pa()), vx.focused());
  spike.press("Right");
  await sleep(150);
  check("Right: the first pinned extension button", isIn(visibleButtons()[0]), vx.focused());
  spike.press("Right");
  await sleep(150);
  check("Right: the second pinned extension button", isIn(visibleButtons()[1]), vx.focused());
  spike.press("Right");
  await sleep(150);
  check("Right: the extensions button", isIn(xt.extButton()), vx.focused());
  await capture("keys-1-focus-ring");
  const ring = getComputedStyle(xt.extButton()).outlineStyle;
  check("the focused extensions button shows the focus ring", ring === "solid", ring);
  spike.press("Right");
  await sleep(150);
  check("Right again: past the cluster (the + circle or the downloads ring)", !xt.cluster().contains(active()) && !!active()?.closest?.("#vitre-bar"), vx.focused());
  spike.press("Left");
  await sleep(150);
  check("Left: back on the extensions button", isIn(xt.extButton()), vx.focused());

  // ---- 2. Enter on the extensions button: Firefox's panel; Esc closes it and focus stays in the bar ----
  spike.press("Enter");
  const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 5000);
  check("Enter on the extensions button opens the extensions panel", !!panel);
  await sleep(500);
  spike.press("Escape");
  await xt.waitFor(() => document.getElementById("unified-extensions-panel")?.state === "closed", 3000);
  await sleep(300);
  check("Esc closes the panel", document.getElementById("unified-extensions-panel")?.state === "closed");
  log("focus after the panel closed", vx.focused());

  // ---- 3. Enter on a pinned button: its popup; Esc closes only the popup ----
  const popupButton = xt.button("popup");
  popupButton.focus({ focusVisible: true });
  await sleep(150);
  check("a pinned button takes keyboard focus", isIn(popupButton), vx.focused());
  spike.press("Enter");
  let wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
  check("Enter on a pinned button opens its popup", !!wp);
  await sleep(700);
  const tabsBefore = gBrowser.tabs.length;
  spike.press("Escape");
  await xt.waitFor(() => !xt.widgetPanel(), 3000);
  await sleep(300);
  check("Esc closes the popup", !xt.widgetPanel());
  check("...and nothing else (same tabs, page not left)", gBrowser.tabs.length === tabsBefore && gBrowser.selectedBrowser.currentURI.spec.endsWith("?keys"));

  // ---- 4. Shift+F10 on a focused pinned button: the button's menu, keyboard style ----
  const kbd = () => {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
    PostMessageW(ctypes.voidptr_t(ctypes.UInt64(handle)), 0x007b, ctypes.UInt64(handle), -1); // WM_CONTEXTMENU, keyboard
    user32.close();
  };
  const menuState = () => window.vitreMenus?.state?.();
  const blockerButton = xt.button("blocker");
  blockerButton.focus({ focusVisible: true });
  await sleep(150);
  kbd();
  await xt.waitFor(() => menuState()?.open, 3000);
  await sleep(400);
  log("keyboard menu", menuState()?.source, menuState()?.active, menuState()?.rows.map((r) => r.label));
  check("Shift+F10 on a pinned button opens its menu", !!menuState()?.open && menuState().rows.some((r) => /Manage extension/.test(r.label)), menuState()?.rows.map((r) => r.label));
  check("...as a keyboard menu with the first row focused", menuState()?.source === "keyboard" && menuState()?.active === 0, { source: menuState()?.source, active: menuState()?.active });
  check("...hanging 8 px under the pill", Math.round(menuState()?.rect?.top ?? 0) === 64, menuState()?.rect);
  await capture("keys-2-keyboard-menu");
  spike.press("Escape");
  await xt.waitFor(() => !menuState()?.open, 3000);
  await sleep(200);
  check("Esc closes the menu and focus returns to the button", !menuState()?.open && isIn(blockerButton), vx.focused());

  xt.extButton().focus({ focusVisible: true });
  await sleep(150);
  kbd();
  await xt.waitFor(() => menuState()?.open, 3000);
  await sleep(300);
  check("Shift+F10 on the extensions button: its menu, keyboard style", menuState()?.source === "keyboard" && menuState()?.rows.some((r) => /Extension settings/.test(r.label)), { source: menuState()?.source, rows: menuState()?.rows.map((r) => r.label) });
  spike.press("Escape");
  await xt.waitFor(() => !menuState()?.open, 3000);

  pa().focus({ focusVisible: true });
  await sleep(150);
  kbd();
  await xt.waitFor(() => menuState()?.open, 3000);
  await sleep(300);
  check("Shift+F10 on the page action button: its menu, keyboard style", menuState()?.source === "keyboard" && menuState()?.rows.some((r) => /Manage extension/.test(r.label)), { source: menuState()?.source, rows: menuState()?.rows.map((r) => r.label) });
  spike.press("Escape");
  await xt.waitFor(() => !menuState()?.open, 3000);
  pa().focus({ focusVisible: true });
  spike.press("Enter");
  const paPanel = () => { const p = document.getElementById("pageaction_vitre_test-panel"); return p?.state === "open" ? p : null; };
  check("Enter on the page action button opens its popup", !!(await xt.waitFor(paPanel, 5000)));
  await sleep(400);
  spike.press("Escape");
  await xt.waitFor(() => !paPanel(), 3000);
  check("Esc closes the page action popup", !paPanel());

  // ---- 5. Esc ladder: a popup over a page that is still loading ----
  // A server that accepts and never answers: the tab stays loading.
  const server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
  server.init(-1, true, -1);
  const held = [];
  server.asyncListen({ onSocketAccepted: (_s, transport) => held.push(transport), onStopListening() {} });
  const hung = "http://127.0.0.1:" + server.port + "/hung";
  gBrowser.selectedBrowser.fixupAndLoadURIString(hung, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await xt.waitFor(() => b.active()?.loading, 5000);
  await sleep(500);
  check("the hung page is loading", !!b.active()?.loading);
  spike.click(xt.button("popup"));
  wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
  await sleep(600);
  check("a popup opens over a hung page", !!wp);
  spike.press("Escape");
  await xt.waitFor(() => !xt.widgetPanel(), 3000);
  await sleep(300);
  check("Esc #1 closes the popup, the page keeps loading", !xt.widgetPanel() && !!b.active()?.loading);
  b.focusPage();
  await sleep(200);
  spike.press("Escape");
  await xt.waitFor(() => !b.active()?.loading, 4000);
  check("Esc #2 stops the load", !b.active()?.loading);

  // ---- 6. Ctrl+W with a popup open: the tab closes and the popup with it ----
  b.newTab(xt.page() + "?second");
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.endsWith("?second") && !b.active()?.loading, 8000);
  await sleep(500);
  const n = gBrowser.tabs.length;
  spike.click(xt.button("popup"));
  wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
  await sleep(600);
  b.focusPage();
  spike.press("Ctrl+W");
  await xt.waitFor(() => gBrowser.tabs.length === n - 1, 4000);
  await sleep(600);
  check("Ctrl+W with a popup open closes the tab", gBrowser.tabs.length === n - 1, gBrowser.tabs.length);
  check("...and the popup does not stay behind", !xt.widgetPanel(), vx.openPopups());
  check("the cluster followed to the new active pill", !!xt.cluster().closest(".item.active"));

  server.close();
  for (const t of held) t.close(0);
  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
