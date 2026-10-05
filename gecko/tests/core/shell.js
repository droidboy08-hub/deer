// Window chrome and popup anchors: caption hit-testing, caption buttons, the placeholder bar's
// clicks, the address field, native popup anchoring, full screen.
//   python tools/run.py --test tests/core/shell.js --name core-shell --url https://example.com --timeout 150
// Captures: shell-1-bar.png, shell-2-maximized.png, shell-3-doorhanger.png (the doorhanger itself is
// a separate OS window and is not in the picture; its position is in the log).
/* global spike, gBrowser, Services, ChromeUtils, Ci, PopupNotifications, PanelUI, BrowserCommands */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const $ = (id) => document.getElementById(id);
  const page = (html) => "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>t</title>" + html);

  // WM_NCHITTEST on the real window: what Windows thinks is at a client point.
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const SendMessageW = user32.declare("SendMessageW", ctypes.winapi_abi, ctypes.intptr_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const hwnd = ctypes.voidptr_t(ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
  const HT = { 1: "CLIENT", 2: "CAPTION", 8: "MINBUTTON", 9: "MAXBUTTON", 12: "TOP", 20: "CLOSE" };
  const hit = (x, y) => {
    const dpr = window.devicePixelRatio;
    const sx = Math.round((window.mozInnerScreenX + x) * dpr);
    const sy = Math.round((window.mozInnerScreenY + y) * dpr);
    const n = Number(SendMessageW(hwnd, 0x0084, 0, ((sy & 0xffff) << 16) | (sx & 0xffff)).toString());
    return HT[n] || String(n);
  };
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  };
  const popupOpen = (p, timeout = 6000) => waitFor(() => p.state === "open", { timeout, what: "popup " + (p.id || p.localName) });
  const screenRect = (p) => {
    const r = p.getOuterScreenRect();
    return { x: Math.round(r.x - window.mozInnerScreenX), y: Math.round(r.y - window.mozInnerScreenY), w: Math.round(r.width), h: Math.round(r.height) };
  };

  await spike.resize(1280, 800);
  await spike.activate();
  await spike.loaded();
  await sleep(500);

  // ---- 1. caption hit-testing ----
  const pill = b.bar.layout.pillRect;
  log("hit tests:", { top: hit(150, 3), strip: hit(150, 13), belowStrip: hit(150, 30), pill: hit(pill.left + 200, 34), plus: hit(...centre(document.querySelector("#vitre-bar .plus"))), min: hit(...centre($("vitre-win-min"))), max: hit(...centre($("vitre-win-max"))), close: hit(...centre($("vitre-win-close"))), page: hit(400, 400) });
  check("top 8 px is the resize band", hit(150, 3) === "TOP");
  check("drag strip (y 8-17) is caption", hit(150, 13) === "CAPTION");
  check("under the strip the page is client area", hit(150, 30) === "CLIENT" && hit(400, 400) === "CLIENT");
  check("bar items are client (no-drag) even over the strip", hit(pill.left + 200, 14) === "CLIENT" && hit(pill.left + 200, 34) === "CLIENT");
  check("caption buttons hit-test as Windows' own (snap layouts on maximize)", hit(...centre($("vitre-win-min"))) === "MINBUTTON" && hit(...centre($("vitre-win-max"))) === "MAXBUTTON" && hit(...centre($("vitre-win-close"))) === "CLOSE");
  await spike.capture("shell-1-bar");

  // ---- 2. caption buttons ----
  const changes = [];
  window.addEventListener("sizemodechange", () => changes.push(window.windowState));
  spike.click($("vitre-win-max"));
  await waitFor(() => window.windowState === window.STATE_MAXIMIZED, { what: "maximize" });
  await sleep(400);
  check("maximize button maximizes, once", changes.length === 1 && b.root.classList.contains("maximized") && $("vitre-win-max").getAttribute("aria-label") === "Restore", changes);
  check("maximized: the strip is the top 8 px", hit(150, 4) === "CAPTION" && hit(150, 13) === "CLIENT");
  await spike.capture("shell-2-maximized");
  spike.click($("vitre-win-max"));
  await waitFor(() => window.windowState === window.STATE_NORMAL, { what: "restore" });
  await sleep(400);
  check("the same button restores, once", changes.length === 2 && !b.root.classList.contains("maximized") && $("vitre-win-max").getAttribute("aria-label") === "Maximize", changes);

  // ---- 3. the bar's clicks and the address field ----
  const first = b.active();
  spike.click(document.querySelector("#vitre-bar .plus .face"));
  await waitFor(() => b.tabs.length === 2 && b.omni.open, { what: "new tab with the field open" });
  const fresh = b.active();
  check("+ opens a tab next to the active one, on Home, with the field focused", fresh !== first && b.tabs.indexOf(fresh) === 1 && fresh.kind === "home" && document.activeElement === $("vitre-omni") && $("vitre-omni").value === "");
  spike.type("example.org");
  spike.press("Enter");
  await waitFor(() => fresh.url.startsWith("https://example.org") && !fresh.loading, { timeout: 20000, what: "typed address loading" });
  check("typing an address and Enter navigates the tab", fresh.kind === "web" && !b.omni.open && fresh.title.length > 0, [fresh.url, fresh.title]);
  spike.click(document.querySelector("#vitre-bar .item.active .address"));
  check("clicking the pill opens the field with the URL selected", b.omni.open && $("vitre-omni").value === fresh.url && $("vitre-omni").selectionEnd - $("vitre-omni").selectionStart === fresh.url.length);
  spike.type("what is refraction");
  spike.press("Enter");
  await waitFor(() => fresh.url.startsWith("https://www.google.com/search?q=what%20is%20refraction"), { timeout: 20000, what: "search" });
  check("words go to the search engine from Settings", true, fresh.url);
  spike.click(document.querySelector("#vitre-bar .item.tab:not(.active) .circle-face"));
  await waitFor(() => b.active() === first, { what: "circle click" });
  check("clicking a circle activates that tab", gBrowser.selectedTab === first.node);
  const other = document.querySelector("#vitre-bar .item.tab:not(.active)");
  const badge = other.querySelector(".close-badge");
  check("the close badge is hidden until the circle is hovered", badge.getClientRects().length === 0);
  spike.click(other, { type: "mousemove" });
  await waitFor(() => badge.getClientRects().length > 0, { what: "close badge on hover" });
  spike.click(badge);
  await waitFor(() => b.tabs.length === 1, { what: "close badge" });
  check("the close badge shows on hover and closes its tab", b.tabs[0] === first);
  const circleTab = b.newTab(page("<body style='background:#fff'>middle"), { background: true });
  spike.click(document.querySelector("#vitre-bar .item.tab:not(.active)"), { button: 1 });
  await waitFor(() => !b.tabs.includes(circleTab), { what: "middle click" });
  check("middle click closes a tab", b.tabs.length === 1);

  // ---- 4. native popups hang from the bar ----
  const pillX = Math.round(b.bar.layout.pillRect.left);
  const n = PopupNotifications.show(gBrowser.selectedBrowser, "vitre-test", "A test permission question", null, { label: "Allow", accessKey: "A", callback() {} }, [], { persistent: true });
  await popupOpen(PopupNotifications.panel);
  await sleep(300);
  const door = screenRect(PopupNotifications.panel);
  log("doorhanger at", door, "pill left", pillX);
  check("permission doorhanger hangs 8 px under the bar, left-aligned to the pill", Math.abs(door.x - pillX) <= 8 && Math.abs(door.y - 64) <= 8, door);
  await spike.capture("shell-3-doorhanger");
  PopupNotifications.remove(n);
  await waitFor(() => PopupNotifications.panel.state === "closed", { what: "doorhanger closing" });

  PanelUI.show();
  await popupOpen(PanelUI.panel, 10000);
  await sleep(300);
  const menu = screenRect(PanelUI.panel);
  const plusRight = Math.round(document.querySelector("#vitre-bar .plus").getBoundingClientRect().right);
  log("app menu at", menu, "plus right edge", plusRight);
  check("Firefox's application menu opens, right-aligned to the + circle", Math.abs(menu.x + menu.w - plusRight) <= 8 && Math.abs(menu.y - 64) <= 8, menu);
  PanelUI.hide();
  await waitFor(() => PanelUI.panel.state === "closed", { what: "app menu closing" });

  const orphan = document.createXULElement("panel");
  orphan.setAttribute("type", "arrow");
  orphan.append(Object.assign(document.createXULElement("label"), { value: "A panel opened with no anchor" }));
  $("mainPopupSet").append(orphan);
  orphan.openPopup(null, "bottomleft topleft");
  await popupOpen(orphan);
  const lost = screenRect(orphan);
  check("a panel opened with no anchor is routed to the pill instead of the window corner", Math.abs(lost.x - pillX) <= 8 && Math.abs(lost.y - 64) <= 8, lost);
  orphan.hidePopup();
  const menuPopup = $("contentAreaContextMenu");
  const routedBefore = JSON.stringify(menuPopup.state);
  check("context menus are not routed (openPopupAtScreen path)", routedBefore === '"closed"');
  orphan.remove();

  // ---- 5. full screen ----
  const tabbox = $("tabbrowser-tabbox");
  document.documentElement.setAttribute("inDOMFullscreen", "true");
  check("DOM full screen: the tab box filter is removed and Vitre's layer is hidden", getComputedStyle(tabbox).filter === "none" && getComputedStyle(b.root).display === "none");
  document.documentElement.removeAttribute("inDOMFullscreen");
  check("...and both come back", getComputedStyle(tabbox).filter.startsWith("saturate") && getComputedStyle(b.root).display !== "none");
  b.run("fullscreen");
  await waitFor(() => window.fullScreen && b.root.classList.contains("fullscreen"), { what: "F11 full screen" });
  check("full screen action enters full screen and the state is mirrored on #vitre-root", document.documentElement.hasAttribute("inFullscreen"));
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen && !b.root.classList.contains("fullscreen"), { what: "leaving full screen" });
  check("...and leaves it", document.documentElement.hasAttribute("customtitlebar"), "customtitlebar back");

  // ---- 6. other chrome windows carry Vitre's icon ----
  const about = window.openDialog("chrome://browser/content/aboutDialog.xhtml", "", "chrome,centerscreen");
  await waitFor(() => about.document?.documentURI.includes("aboutDialog") && about.document.readyState === "complete", { what: "About window" });
  check("a non-browser window (About) gets the icon attribute too", about.document.documentElement.getAttribute("icon") === "vitre");
  await sleep(300);
  about.close();

  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
});
