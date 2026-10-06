// Window chrome: caption hit-testing, resize borders, caption buttons, moving the window from the bar,
// maximized, F11 and element full screen, auto-hide (hidden and revealed), a second, a private and
// a popup window, a navigation (the glass must not drop out), Firefox's notification bars, native
// popups hanging from the bar.
//   python tests/shell/all.py chrome      (the navigation step needs all.py's slow page)
// Captures: chrome-maximized, chrome-autohide-hidden, chrome-autohide-revealed, chrome-f11-hidden,
// chrome-f11-revealed, chrome-second-window, chrome-private-window, chrome-popup-window,
// chrome-nav-0..5, chrome-notification, chrome-doorhanger-autohide.
/* global spike, T, gBrowser, Services, ChromeUtils, PopupNotifications, PanelUI, gNotificationBox */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const $ = (s, d = document) => d.querySelector(s);
  const css = (el, prop) => el.ownerDocument.defaultView.getComputedStyle(el)[prop];
  const near = (a, c, tol = 1) => Math.abs(a - c) <= tol;
  const settings = b.sys("VitreSettings");
  const popupOpen = (p, timeout = 8000) => waitFor(() => p.state === "open", { timeout, what: "popup " + (p.id || p.localName) });
  const popupClosed = (p) => waitFor(() => p.state === "closed", { timeout: 5000, what: "popup closing" });
  const screenRect = (p, win = window) => {
    const r = p.getOuterScreenRect();
    return { x: Math.round(r.x - win.mozInnerScreenX), y: Math.round(r.y - win.mozInnerScreenY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const barTop = (win = window) => Math.round($("#vitre-bar .item.active", win.document).getBoundingClientRect().top);

  await spike.resize(1280, 800);
  await spike.activate();
  await T.go(T.pages.stripes);
  await T.tabs(3);
  const W = window.innerWidth;
  const H = window.innerHeight;

  // ---- 1. hit-testing: resize borders, drag strip, client, caption buttons ----
  const pill = b.bar.layout.pillRect;
  const hits = {
    top: T.hit(150, 3), topLeft: T.hit(-3, 1), topRight: T.hit(W + 3, 1), left: T.hit(-4, 300), right: T.hit(W + 3, 300), bottom: T.hit(300, H + 3), bottomLeft: T.hit(-4, H + 3), bottomRight: T.hit(W + 3, H + 3),
    strip: T.hit(150, 13), underStrip: T.hit(150, 30), pill: T.hit(pill.left + 200, 34), pillOverStrip: T.hit(pill.left + 200, 14), circle: T.hit(...T.centre($("#vitre-bar .item.tab:not(.active)"))), plus: T.hit(...T.centre($("#vitre-bar .plus"))),
    min: T.hit(...T.centre($("#vitre-win-min"))), max: T.hit(...T.centre($("#vitre-win-max"))), close: T.hit(...T.centre($("#vitre-win-close"))), page: T.hit(400, 400),
  };
  log("WM_NCHITTEST:", hits);
  check("resize borders on every side and corner", hits.top === "TOP" && hits.left === "LEFT" && hits.right === "RIGHT" && hits.bottom === "BOTTOM" && hits.topLeft === "TOPLEFT" && hits.topRight === "TOPRIGHT" && hits.bottomLeft === "BOTTOMLEFT" && hits.bottomRight === "BOTTOMRIGHT", hits);
  check("drag strip is caption; the page under it and the bar items are client", hits.strip === "CAPTION" && hits.underStrip === "CLIENT" && hits.page === "CLIENT" && hits.pill === "CLIENT" && hits.pillOverStrip === "CLIENT" && hits.circle === "CLIENT" && hits.plus === "CLIENT", hits);
  check("caption buttons are Windows' own (snap layouts on Maximize)", hits.min === "MINBUTTON" && hits.max === "MAXBUTTON" && hits.close === "CLOSE", hits);

  // ---- 2. caption buttons ----
  const changes = [];
  window.addEventListener("sizemodechange", () => changes.push(window.windowState));
  spike.click($("#vitre-win-max"));
  await waitFor(() => window.windowState === window.STATE_MAXIMIZED, { what: "maximize" });
  await sleep(500);
  await T.settled();
  let info = T.bar();
  const maxW = window.innerWidth;
  check("Maximize maximizes once and becomes Restore", changes.length === 1 && b.root.classList.contains("maximized") && $("#vitre-win-max").getAttribute("aria-label") === "Restore" && $("#vitre-win-max").dataset.icon === "restore", changes);
  check("maximized: the top 8 px is the drag strip, no resize band; controls keep their place", T.hit(150, 4) === "CAPTION" && T.hit(150, 13) === "CLIENT" && info.capsule.y === 18 && near(maxW - (info.capsule.x + 108), 12) && info.pill.y === 12 && near((info.items[0].x + info.items[info.items.length - 1].x + 44) / 2, maxW / 2, 1), { capsule: info.capsule, maxW, strip: [T.hit(150, 4), T.hit(150, 13)] });
  await T.shot("chrome-maximized");
  spike.click($("#vitre-win-max"));
  await waitFor(() => window.windowState === window.STATE_NORMAL, { what: "restore" });
  await sleep(400);
  check("Restore restores once", changes.length === 2 && !b.root.classList.contains("maximized") && $("#vitre-win-max").getAttribute("aria-label") === "Maximize", changes);
  spike.click($("#vitre-win-min"));
  await waitFor(() => window.windowState === window.STATE_MINIMIZED, { what: "minimize" });
  check("Minimize minimizes", true);
  window.restore();
  await waitFor(() => window.windowState === window.STATE_NORMAL, { what: "restore from minimized" });
  await sleep(500);
  await spike.activate();
  await T.settled();

  // ---- 3. dragging the bar moves the window ----
  const moves = [];
  const realMove = b.bar.moveWindow;
  b.bar.moveWindow = (x, y) => (moves.push([x, y]), true);
  const address = $("#vitre-bar .item.active .address");
  const [ax, ay] = T.centre(address);
  const EU = spike.EU;
  EU.synthesizeMouseAtPoint(ax, ay, { type: "mousedown" }, window);
  EU.synthesizeMouseAtPoint(ax + 2, ay + 2, { type: "mousemove", buttons: 1 }, window);
  const early = moves.length;
  EU.synthesizeMouseAtPoint(ax + 9, ay + 7, { type: "mousemove", buttons: 1 }, window);
  EU.synthesizeMouseAtPoint(ax + 30, ay + 20, { type: "mousemove", buttons: 1 }, window);
  EU.synthesizeMouseAtPoint(ax + 30, ay + 20, { type: "mouseup" }, window);
  check("pressing on the pill and dragging more than 5 px starts one window move at the pointer", early === 0 && moves.length === 1 && near(moves[0][0], window.mozInnerScreenX + ax + 9, 1) && near(moves[0][1], window.mozInnerScreenY + ay + 7, 1), moves);
  const circleFace = $("#vitre-bar .item.tab:not(.active) .circle-face");
  const [cx, cy] = T.centre(circleFace);
  EU.synthesizeMouseAtPoint(cx, cy, { type: "mousedown" }, window);
  EU.synthesizeMouseAtPoint(cx - 12, cy + 2, { type: "mousemove", buttons: 1 }, window);
  EU.synthesizeMouseAtPoint(cx - 12, cy + 2, { type: "mouseup" }, window);
  check("a circle drags the window too", moves.length === 2, moves);
  check("a drag is not a click: nothing was activated or opened", !b.omni.open && b.active() === b.tabs[0]);
  EU.synthesizeMouseAtPoint(400, 300, { type: "mousedown" }, window);
  EU.synthesizeMouseAtPoint(430, 330, { type: "mousemove", buttons: 1 }, window);
  EU.synthesizeMouseAtPoint(430, 330, { type: "mouseup" }, window);
  check("dragging on the page does not", moves.length === 2);
  spike.click(address);
  check("a plain click on the pill still opens the address field, with no move", b.omni.open && moves.length === 2);
  spike.press("Escape");
  await waitFor(() => !b.omni.open, { what: "field to close" });
  b.bar.moveWindow = realMove;
  check("the native move is ready: user32 through js-ctypes knows this window", b.bar.canMoveWindow() === true);

  // ---- 4. auto-hide ----
  check("Deer's default is auto-hide (the harness turns it off for tests)", Services.prefs.getDefaultBranch("vitre.").getBoolPref("barAutoHide") === true && b.sys("VitreSettings").get().barAutoHide === false);
  T.pointer(640, 400);
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden && b.root.classList.contains("bar-hiding"), { what: "auto-hide" });
  await sleep(500);
  check("auto-hide: the bar slides out of the window and fades; it is inert", barTop() <= -44 && css($("#vitre-bar"), "opacity") === "0" && $("#vitre-bar").hasAttribute("inert") && b.bar.state.hiding && !b.bar.state.revealed, { top: barTop(), opacity: css($("#vitre-bar"), "opacity") });
  check("auto-hide: the window controls leave with the bar (above the window, faded, inert)", Math.round($("#vitre-winctl").getBoundingClientRect().bottom) <= 0 && css($("#vitre-winctl"), "opacity") === "0" && $("#vitre-winctl").hasAttribute("inert"), { capsuleBottom: $("#vitre-winctl").getBoundingClientRect().bottom, opacity: css($("#vitre-winctl"), "opacity") });
  check("hidden bar: its slot is still reported, and clicks go to the page there", b.bar.layout.pillRect.top === 12 && document.elementFromPoint(pill.left + 100, 30)?.localName === "browser");
  await spike.capture("chrome-autohide-hidden");
  T.measure("chrome-autohide-hidden", window, "none");
  T.pointer(640, 60);
  await sleep(200);
  check("pointer 60 px from the top: still hidden", b.bar.hidden);
  T.pointer(640, 20);
  await waitFor(() => !b.bar.hidden, { what: "reveal" });
  await sleep(500);
  check("pointer within 28 px of the top: the bar comes back", barTop() === 12 && css($("#vitre-bar"), "opacity") === "1" && !$("#vitre-bar").hasAttribute("inert") && b.root.classList.contains("bar-revealed"));
  check("…and the window controls with it", T.rect($("#vitre-winctl")).y === 18 && css($("#vitre-winctl"), "opacity") === "1" && !$("#vitre-winctl").hasAttribute("inert"));
  await T.shot("chrome-autohide-revealed");
  T.pointer(pill.left + 60, 34);
  await sleep(700);
  check("pointer resting on the bar keeps it", !b.bar.hidden);
  T.pointer(640, 300);
  await waitFor(() => b.bar.hidden, { timeout: 3000, what: "hide after leaving" });
  check("pointer back on the page: it leaves after a moment", true);
  // Leaving the window through the top edge (into the resize band, where Gecko gets no events).
  T.pointer(640, 30);
  await sleep(50);
  window.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientX: 640, clientY: 9, relatedTarget: null }));
  await waitFor(() => !b.bar.hidden, { what: "reveal through the top edge" });
  check("pointer leaving through the top edge brings the bar back", true);
  T.pointer(640, 300);
  await waitFor(() => b.bar.hidden, { timeout: 3000, what: "hide" });
  const release = b.bar.hold("test");
  await sleep(700);
  check("hold() shows the bar and keeps it while the pointer is on the page", !b.bar.hidden);
  release();
  await waitFor(() => b.bar.hidden, { timeout: 3000, what: "hide after release" });
  b.editAddress();
  await sleep(700);
  check("opening the address field shows the bar and keeps it while the field is open", !b.bar.hidden && b.omni.open);
  spike.press("Escape");
  await waitFor(() => b.bar.hidden, { timeout: 3000, what: "hide after the field closed" });
  // A native popup hangs from the pill: the bar is in place before the popup measures it.
  await spike.activate();
  const note = PopupNotifications.show(gBrowser.selectedBrowser, "vitre-test", "A test permission question", null, { label: "Allow", accessKey: "A", callback() {} }, [], { persistent: true });
  await popupOpen(PopupNotifications.panel);
  await sleep(300);
  let door = screenRect(PopupNotifications.panel);
  check("auto-hide: a permission doorhanger brings the bar back and hangs 8 px under it, at the pill", !b.bar.hidden && Math.abs(door.x - pill.left) <= 8 && Math.abs(door.y - 64) <= 8, door);
  await spike.capture("chrome-doorhanger-autohide");
  PopupNotifications.remove(note);
  await popupClosed(PopupNotifications.panel);
  await waitFor(() => b.bar.hidden, { timeout: 3000, what: "hide after the doorhanger" });
  check("...and the bar leaves again when the doorhanger closes", true);
  settings.set({ barAutoHide: false });
  await waitFor(() => !b.bar.hidden && !b.root.classList.contains("bar-hiding"), { what: "auto-hide off" });

  // ---- 5. native popups from the bar ----
  PanelUI.show();
  await popupOpen(PanelUI.panel, 10000);
  await sleep(300);
  const menu = screenRect(PanelUI.panel);
  const plusRight = Math.round($("#vitre-bar .plus").getBoundingClientRect().right);
  check("Firefox's application menu hangs under the + circle, right-aligned", Math.abs(menu.x + menu.w - plusRight) <= 8 && Math.abs(menu.y - 64) <= 8, menu);
  PanelUI.hide();
  await popupClosed(PanelUI.panel);
  await T.go("https://example.com/");
  await spike.activate();
  window.gTrustPanelHandler.showPopup({});
  const trust = await waitFor(() => { const p = document.getElementById("trustpanel-popup"); return p?.state === "open" ? p : null; }, { timeout: 8000, what: "site information panel" }).catch(() => null);
  if (trust) {
    await sleep(300);
    const tr = screenRect(trust);
    check("the site information panel (opened with no anchor) hangs from the pill", Math.abs(tr.x - b.bar.layout.pillRect.left) <= 8 && Math.abs(tr.y - 64) <= 8, tr);
    trust.hidePopup();
    await popupClosed(trust);
  } else check("the site information panel opens", false, "did not open");
  window.PlacesCommandHook.bookmarkPage();
  const editor = await waitFor(() => { const p = document.getElementById("editBookmarkPanel"); return p?.state === "open" ? p : null; }, { timeout: 8000, what: "bookmark editor" }).catch(() => null);
  if (editor) {
    await sleep(300);
    const er = screenRect(editor);
    check("the bookmark editor (a page action) hangs from the pill, 8 px under the bar, left-aligned", Math.abs(er.x - b.bar.layout.pillRect.left) <= 8 && Math.abs(er.y - 64) <= 8, er);
    editor.hidePopup();
    await popupClosed(editor);
  } else check("the bookmark editor opens", false, "did not open");
  const anchors = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell.errors;
  check("no errors from the anchor router", anchors.length === 0, anchors);

  // ---- 6. Firefox's notification bars ----
  await T.go(T.pages.white);
  await gNotificationBox.appendNotification("vitre-test-bar", { label: "A notification bar from Firefox, floated under the tab bar", priority: gNotificationBox.PRIORITY_INFO_MEDIUM }, [{ label: "OK", callback() {} }]);
  await sleep(700);
  const nb = T.rect(document.getElementById("notifications-toolbar"));
  const pageTop = Math.round(gBrowser.selectedBrowser.getBoundingClientRect().top);
  check("a notification bar is a card under the bar (top 68), centred, at most 640 wide, and does not move the page", nb.y === 68 && nb.w <= 640 && nb.h > 20 && near(nb.x + nb.w / 2, window.innerWidth / 2, 1) && pageTop === 0, { nb, pageTop });
  await spike.capture("chrome-notification");
  gNotificationBox.removeAllNotifications(true);

  // ---- 7. a navigation: the glass must not drop out ----
  const server = Services.env.get("VITRE_TEST_SERVER");
  await T.go(T.pages.stripes);
  if (server) {
    const t = b.active();
    const lensOf = () => css($("#vitre-bar .item.active > .lens"), "backdropFilter");
    let frames = 0;
    let dropped = 0;
    let watching = true;
    const watch = () => {
      frames++;
      if (!/^url\(/.test(lensOf()) || !$("#vitre-bar .row-lens") || !css(document.getElementById("tabbrowser-tabbox"), "filter").startsWith("saturate")) dropped++;
      if (watching) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    b.navigate(t, server + "/slow?nav");
    for (let i = 0; i < 6; i++) {
      await T.shot(`chrome-nav-${i}`);
      log(`navigation capture ${i}: loading ${t.loading}, url ${t.url.slice(0, 40)}, theme ${b.theme()}`);
    }
    await waitFor(() => !t.loading && t.url.startsWith(server), { timeout: 15000, what: "slow page" });
    await sleep(600);
    await T.shot("chrome-nav-done");
    watching = false;
    check("navigating to another site (new process): the lenses stay installed on every frame", frames > 60 && dropped === 0 && gBrowser.selectedBrowser.remoteType.startsWith("webIsolated"), { frames, dropped, remoteType: gBrowser.selectedBrowser.remoteType });
  } else log("no VITRE_TEST_SERVER: navigation step skipped (run through tests/shell/all.py)");

  // ---- 8. F11 full screen ----
  await T.go(T.pages.stripes);
  T.pointer(640, 400);
  b.run("fullscreen");
  await waitFor(() => window.fullScreen && b.root.classList.contains("fullscreen") && b.bar.hidden, { what: "F11 full screen" });
  await sleep(1200);
  await T.settled();
  check("F11: bar and window controls are off screen, no drag strip", barTop() <= -44 && Math.round($("#vitre-winctl").getBoundingClientRect().bottom) <= 0 && css($("#vitre-drag"), "display") === "none" && $("#vitre-win-max").getAttribute("aria-label") === "Restore", { top: barTop(), capsuleBottom: $("#vitre-winctl").getBoundingClientRect().bottom });
  await spike.capture("chrome-f11-hidden");
  T.measure("chrome-f11-hidden", window, "none");
  T.pointer(900, 1);
  await waitFor(() => !b.bar.hidden, { what: "reveal in full screen" });
  await sleep(600);
  check("F11: pointer at the top edge brings back the bar and the window controls", barTop() === 12 && T.rect($("#vitre-winctl")).y === 18);
  await T.shot("chrome-f11-revealed");
  spike.click($("#vitre-win-max"));
  await waitFor(() => !window.fullScreen && !b.root.classList.contains("fullscreen"), { what: "leaving full screen" });
  await sleep(800);
  check("the Restore button leaves full screen; the bar is back for good", !b.bar.hidden && !b.root.classList.contains("bar-hiding") && document.documentElement.hasAttribute("customtitlebar"));

  // ---- 9. element full screen ----
  const tabbox = document.getElementById("tabbrowser-tabbox");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  await spike.activate();
  gBrowser.selectedBrowser.focus();
  gBrowser.selectedBrowser.messageManager.loadFrameScript("data:,content.document.documentElement.requestFullscreen().catch(e => dump('fullscreen refused: ' + e + '\n'))", false);
  const real = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000, what: "element full screen" }).then(() => true, () => false);
  if (real) {
    await sleep(800);
    check("element full screen (a real request from the page): Vitre's layer is gone and the tab box filter is off", css(b.root, "display") === "none" && css(tabbox, "filter") === "none" && b.root.classList.contains("element-fullscreen"));
    await spike.capture("chrome-element-fullscreen");
    document.exitFullscreen();
    await waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 5000, what: "leaving element full screen" });
    await sleep(800);
  } else {
    log("element full screen could not be entered from the test (no OS focus): checking the CSS by setting the attribute");
    document.documentElement.setAttribute("inDOMFullscreen", "true");
    check("element full screen (attribute set by hand): Vitre's layer is gone and the tab box filter is off", css(b.root, "display") === "none" && css(tabbox, "filter") === "none");
    document.documentElement.removeAttribute("inDOMFullscreen");
  }
  check("...and both are back afterwards", css(b.root, "display") !== "none" && css(tabbox, "filter").startsWith("saturate") && !b.root.classList.contains("element-fullscreen"));

  // ---- 10. display scaling 150 % ----
  await T.go(T.pages.stripes);
  await spike.resize(1500, 800);
  Services.prefs.setStringPref("layout.css.devPixelsPerPx", "1.5");
  await waitFor(() => window.devicePixelRatio === 1.5, { timeout: 5000, what: "150 % scaling" });
  await sleep(700);
  await T.settled();
  info = T.bar();
  const scaled = { top: T.hit(150, 2), strip: T.hit(150, 13), under: T.hit(150, 30), max: T.hit(...T.centre($("#vitre-win-max"))), pill: T.hit(info.pill.x + 100, 34) };
  log("150 %:", { inner: [window.innerWidth, window.innerHeight], pill: [info.pill.x, info.pill.y, info.pill.w, info.pill.h], capsule: info.capsule, hits: scaled });
  check("150 % scaling: same sizes in CSS px (pill 44 high at top 12, circles 44, capsule 108x32 at 12 / 18), centred", info.pill.h === 44 && info.pill.y === 12 && info.circles[0].w === 44 && info.capsule.w === 108 && info.capsule.h === 32 && info.capsule.y === 18 && near(window.innerWidth - (info.capsule.x + 108), 12) && near((info.items[0].x + info.items[info.items.length - 1].x + 44) / 2, window.innerWidth / 2, 1), info.state);
  check("150 % scaling: resize band, drag strip, client area and caption buttons hit-test as at 100 %", scaled.top === "TOP" && scaled.strip === "CAPTION" && scaled.under === "CLIENT" && scaled.max === "MAXBUTTON" && scaled.pill === "CLIENT", scaled);
  await T.shot("chrome-scale-150");
  Services.prefs.clearUserPref("layout.css.devPixelsPerPx");
  await waitFor(() => window.devicePixelRatio === 1, { timeout: 5000, what: "100 % scaling" });
  await spike.resize(1280, 800);
  await T.settled();

  // ---- 11. a second window, a private window, a popup window ----
  const second = await spike.openWindow();
  await second.spike.resize(1100, 700);
  await T.go(T.pages.stripes, second);
  await T.tabs(3, second);
  const si = T.bar(second);
  check("second window: its own bar, lenses and window controls", si.pill.w === 480 && si.rows.length === 1 && si.items.length === 4 && near(second.innerWidth - (si.capsule.x + 108), 12) && second.document.querySelectorAll("#vitre-glass-defs filter").length >= 3, si.state);
  await T.shot("chrome-second-window", second);
  second.close();

  const priv = await spike.openWindow({ private: true });
  await priv.spike.resize(1100, 700);
  await T.go(T.pages.stripes, priv);
  await sleep(300);
  const label = priv.document.getElementById("vitre-private");
  const pi = T.bar(priv);
  const lr = label ? T.rect(label) : null;
  check("private window: a 'Private' label in the capsule's material, 8 px left of the window controls", priv.vitre.isPrivate && !!label && label.textContent === "Private" && lr.h === 32 && lr.y === 18 && near(pi.capsule.x - (lr.x + lr.w), 8) && label.classList.contains("glass") && /^url\(/.test(css(label.querySelector(".lens"), "backdropFilter")) && priv.vitre.root.classList.contains("private"), lr);
  check("private window: the bar keeps clear of the label", Math.max(...pi.items.map((i) => i.x + i.w)) <= lr.x - 16 && !document.getElementById("vitre-private"), pi.items.map((i) => i.x));
  await T.shot("chrome-private-window", priv);
  priv.close();

  const known = new Set(Services.wm.getEnumerator("navigator:browser"));
  // A window without the toolbar feature is what Firefox calls a popup window (window.open with
  // features from a page ends up here too when it is not turned into a tab).
  window.openDialog("chrome://browser/content/browser.xhtml", "_blank", "chrome,dialog=no,width=640,height=420,location=yes,resizable=yes", T.pages.stripes);
  const popup = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => !known.has(w)), { timeout: 10000, what: "popup window" });
  await waitFor(() => popup.vitre?.ready && popup.vitre.tabs.length === 1 && !popup.vitre.tabs[0].loading && popup.vitre.tabs[0].url.startsWith("data:"), { timeout: 15000, what: "popup window ready" });
  await sleep(800);
  await T.settled(popup);
  const pd = popup.document;
  const pb = T.bar(popup);
  const shown = (el) => !!el && el.getClientRects().length > 0;
  log("popup window:", { inner: [popup.innerWidth, popup.innerHeight], popupAttr: pd.documentElement.hasAttribute("popup-window"), items: pb.items.map((i) => [i.kind, i.x, i.w]), state: pb.state, customtitlebar: pd.documentElement.hasAttribute("customtitlebar") });
  check("popup window: one pill, no + circle, no Back / Forward / Reload, with the window controls", popup.vitre.isPopup && pb.items.length === 1 && pb.items[0].kind === "pill" && !shown($("#vitre-bar .plus", pd)) && !shown($("#vitre-bar .back", pd)) && !shown($("#vitre-bar .reload", pd)) && shown($("#vitre-winctl", pd)) && pd.documentElement.hasAttribute("customtitlebar"), pb.items.map((i) => [i.kind, i.x, i.w]));
  check("popup window: the pill fits left of the window controls", pb.pill.x >= 12 && pb.pill.x + pb.pill.w <= pb.capsule.x - 16, [pb.pill.x, pb.pill.w, pb.capsule.x]);
  popup.spike.click($("#vitre-bar .item.active .address", pd));
  await sleep(200);
  check("popup window: the pill is read-only", !popup.vitre.omni.open && $("#vitre-bar .address", pd).getAttribute("aria-disabled") === "true");
  check("popup window: caption hit-testing", T.hit(...T.centre($("#vitre-win-close", pd)), popup) === "CLOSE" && T.hit(60, 13, popup) === "CAPTION", [T.hit(...T.centre($("#vitre-win-close", pd)), popup), T.hit(60, 13, popup)]);
  await T.shot("chrome-popup-window", popup);
  popup.close();

  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
});
