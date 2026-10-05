// Robustness review: real permission prompts and Firefox's own panels through the anchor router,
// in normal, auto-hide, F11, element full screen, popup-window and second-window states; Esc with a
// native panel open; notification bars.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-panels.js --name review-robust-panels --url https://example.com --timeout 300
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, PopupNotifications, PanelUI */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s, d = document) => d.querySelector(s);
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  await spike.loaded();
  await sleep(500);

  const evalIn = (code, browser) => R.inPage("function(w, d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }", browser);
  const panelOpen = (win = window) => waitFor(() => win.PopupNotifications.panel.state === "open", { timeout: 8000, what: "doorhanger" }).then(() => true, () => false);
  const panelClosed = (win = window) => waitFor(() => win.PopupNotifications.panel.state === "closed", { timeout: 5000, what: "doorhanger closing" }).then(() => true, () => false);
  const pill = (win = window) => R.rect(win.document.querySelector("#vitre-bar .item.active"));
  const under = (rect, win = window) => {
    const p = pill(win);
    return Math.abs(rect.x - p.x) <= 10 && Math.abs(rect.y - 64) <= 10;
  };
  const mark = () => b.keys.log.length;
  const actions = (m) => b.keys.log.slice(m).filter((l) => l.startsWith("ACTION")).map((l) => l.replace(/^ACTION /, ""));
  const askGeo = (browser) => evalIn("navigator.geolocation.getCurrentPosition(() => { document.title = 'geo-ok'; }, (e) => { document.title = 'geo-denied'; }); 'asked'", browser);
  const clearPerms = () => Services.perms.removeAll();

  const site = b.active();
  check("the test page is https://example.com", site.url.startsWith("https://example.com"), site.url);

  // ---- 1. a real geolocation prompt ----
  log("--- 1. geolocation prompt");
  await askGeo();
  let open = await panelOpen();
  check("geolocation prompt opens", open);
  if (open) {
    await sleep(300);
    const r = R.popupRect(PopupNotifications.panel);
    log("geolocation doorhanger:", r, "pill", pill());
    check("geolocation doorhanger hangs from the pill, 8 px under the bar", under(r), { r, pill: pill() });
    // The address field opened and used while the prompt is pending (Firefox suppresses doorhangers
    // while its own address bar is being edited: browser.js shouldSuppress).
    b.focusPage();
    await sleep(200);
    spike.press("Ctrl+L");
    await sleep(400);
    spike.type("exa");
    await sleep(900);
    const dr = R.popupRect(PopupNotifications.panel);
    const sp = R.rect($("#vitre-omni-panel"));
    const fr = R.rect($("#vitre-omni-field"));
    const overlaps = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    log("doorhanger while typing in the address field:", { doorhanger: dr, field: fr, suggestions: sp, rows: $("#vitre-omni-list").children.length });
    check("a pending permission prompt does not cover the open address field or its suggestions", !(dr.state === "open" && (overlaps(dr, sp) || overlaps(dr, fr))), { doorhanger: dr, suggestions: sp, field: fr });
    b.omni.close();
    await sleep(600);
    check("the prompt is back once the field closes", PopupNotifications.panel.state === "open", PopupNotifications.panel.state);
    // Tab switch and back: the prompt comes back under the (new) pill element.
    const other = b.newTab(R.page("Other tab"));
    await sleep(900);
    check("switching tabs hides the doorhanger", PopupNotifications.panel.state === "closed", PopupNotifications.panel.state);
    b.omni.open && b.omni.close();
    b.activate(site);
    await sleep(1200);
    const back = PopupNotifications.panel.state;
    log("back on the tab with the pending prompt:", { state: back, rect: back === "open" ? R.popupRect(PopupNotifications.panel) : null, pending: PopupNotifications._currentNotifications.length });
    check("...and it is back under the pill after returning", back === "open" && under(R.popupRect(PopupNotifications.panel)), back === "open" ? R.popupRect(PopupNotifications.panel) : back);
    b.closeTab(other);
    await sleep(500);
    // Esc with the doorhanger open and focus in the page.
    b.focusPage();
    await sleep(200);
    const m = mark();
    spike.press("Escape");
    await sleep(700);
    log("Esc with a doorhanger open:", { state: PopupNotifications.panel.state, actions: actions(m), title: site.title, pending: PopupNotifications._currentNotifications.length });
    check("Esc with a permission doorhanger open: Vitre's own Esc step does not run", actions(m).length === 0, actions(m));
    check("Esc answers the prompt (Firefox's esc-press action) and leaves nothing pending and unreachable", PopupNotifications.panel.state === "closed" && PopupNotifications._currentNotifications.length === 0, { state: PopupNotifications.panel.state, pending: PopupNotifications._currentNotifications.length, title: site.title });
    for (const n of [...PopupNotifications._currentNotifications]) PopupNotifications.remove(n);
    await panelClosed();
  }
  clearPerms();

  // ---- 2. prompt with auto-hide on, and tab closed under it ----
  log("--- 2. prompt with the bar auto-hidden");
  const settings = b.sys("VitreSettings");
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden" }).catch(() => {});
  const t2 = b.newTab("https://example.com/?two", { background: false });
  await waitFor(() => t2.url.includes("?two") && !t2.loading, { timeout: 20000, what: "second example.com tab" });
  b.omni.open && b.omni.close();
  b.focusPage();
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden again" }).catch(() => {});
  await askGeo();
  open = await panelOpen();
  await sleep(400);
  if (check("auto-hide: prompt opens", open)) {
    const r = R.popupRect(PopupNotifications.panel);
    check("auto-hide: the bar is brought back and the doorhanger hangs under it", !b.bar.hidden && under(r), { hidden: b.bar.hidden, r, pill: pill() });
    // The tab is closed while its prompt is open.
    b.closeTab(t2);
    await panelClosed();
    await sleep(1500);
    check("auto-hide: closing the tab closes its prompt and the bar hides again (hold released)", PopupNotifications.panel.state === "closed" && b.bar.hidden, { state: PopupNotifications.panel.state, hidden: b.bar.hidden, st: b.bar.state });
  }
  settings.set({ barAutoHide: false });
  await sleep(400);
  clearPerms();

  // ---- 3. prompt in F11 full screen ----
  log("--- 3. prompt in F11");
  b.activate(site);
  b.focusPage();
  b.run("fullscreen");
  await waitFor(() => window.fullScreen && b.bar.hidden, { timeout: 6000, what: "F11" }).catch(() => {});
  await sleep(1200);
  await askGeo();
  open = await panelOpen();
  await sleep(400);
  if (check("F11: prompt opens", open)) {
    const r = R.popupRect(PopupNotifications.panel);
    check("F11: the bar comes back and the doorhanger hangs under it", !b.bar.hidden && under(r), { hidden: b.bar.hidden, r, pill: pill() });
    for (const n of [...PopupNotifications._currentNotifications]) PopupNotifications.remove(n);
    await panelClosed();
    await waitFor(() => b.bar.hidden, { timeout: 4000, what: "bar hiding after the prompt" }).catch(() => {});
    check("F11: the bar leaves again after the prompt", b.bar.hidden);
  }
  b.run("fullscreen");
  await waitFor(() => !window.fullScreen, { timeout: 6000, what: "leaving F11" }).catch(() => {});
  await sleep(800);
  clearPerms();

  // ---- 4. prompt while the page is in element full screen ----
  log("--- 4. prompt in element full screen");
  Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
  await spike.activate();
  b.focusPage();
  await evalIn("document.documentElement.requestFullscreen().catch(() => {}); 'asked'");
  const full = await waitFor(() => document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 4000, what: "element full screen" }).then(() => true, () => false);
  if (full) {
    await sleep(800);
    let exited = 0;
    window.addEventListener("MozDOMFullscreen:Exited", () => (exited = performance.now()), { once: true });
    const asked = performance.now();
    await askGeo();
    open = await panelOpen();
    await sleep(100);
    const during = { dom: document.documentElement.hasAttribute("inDOMFullscreen"), rect: open ? R.popupRect(PopupNotifications.panel) : null, screen: open ? (() => { const r = PopupNotifications.panel.getOuterScreenRect(); return [Math.round(r.left), Math.round(r.top)]; })() : null, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], anchor: PopupNotifications.panel.anchorNode?.id || null };
    await sleep(1500);
    const after = { dom: document.documentElement.hasAttribute("inDOMFullscreen"), exitedMs: exited ? Math.round(exited - asked) : null, rect: PopupNotifications.panel.state === "open" ? R.popupRect(PopupNotifications.panel) : null, state: PopupNotifications.panel.state, win: [window.screenX, window.screenY, window.outerWidth, window.outerHeight], rootDisplay: getComputedStyle(b.root).display, anchor: PopupNotifications.panel.anchorNode?.id || null };
    log("prompt in element full screen:", { during, after });
    const r = after.rect;
    check("element full screen: the permission prompt is shown on screen", open && during.rect && during.rect.w > 100, during);
    check("element full screen: once full screen ends (Firefox exits it for the prompt) the prompt hangs under the pill", !!r && under(r), after);
    for (const n of [...PopupNotifications._currentNotifications]) PopupNotifications.remove(n);
    await sleep(500);
    if (document.documentElement.hasAttribute("inDOMFullscreen")) document.exitFullscreen();
    await waitFor(() => !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 5000 }).catch(() => {});
    await sleep(800);
  } else log("SKIP element full screen was not granted");
  clearPerms();

  // ---- 5. Firefox's own panels (no extensions) ----
  log("--- 5. Firefox panels");
  b.activate(site);
  await sleep(300);
  PanelUI.show();
  await waitFor(() => PanelUI.panel.state === "open", { timeout: 10000, what: "app menu" }).catch(() => {});
  await sleep(300);
  const menu = R.popupRect(PanelUI.panel);
  const plus = R.rect($("#vitre-bar .plus"));
  check("app menu: opens under the + circle", PanelUI.panel.state === "open" && Math.abs(menu.x + menu.w - (plus.x + plus.w)) <= 10 && Math.abs(menu.y - 64) <= 10, { menu, plus });
  // Keys with the app menu open.
  let m = mark();
  let tabs = b.tabs.length;
  spike.press("Escape");
  await sleep(600);
  check("app menu: Esc closes it and runs nothing of Vitre's", PanelUI.panel.state === "closed" && actions(m).length === 0, { state: PanelUI.panel.state, actions: actions(m) });
  if (PanelUI.panel.state !== "closed") { PanelUI.hide(); await sleep(400); }
  PanelUI.show();
  await waitFor(() => PanelUI.panel.state === "open", { timeout: 10000, what: "app menu again" }).catch(() => {});
  await sleep(300);
  m = mark();
  spike.press("Ctrl+T");
  await sleep(900);
  log("Ctrl+T with the app menu open:", { tabs: b.tabs.length - tabs, panel: PanelUI.panel.state, omni: b.omni.open, focused: b.omni.focused, actions: actions(m) });
  check("app menu: Ctrl+T while it is open leaves no panel hanging over the new tab's field", !(b.tabs.length === tabs + 1 && PanelUI.panel.state === "open"), { tabs: b.tabs.length - tabs, panel: PanelUI.panel.state });
  if (PanelUI.panel.state !== "closed") { PanelUI.hide(); await sleep(400); }
  b.omni.open && b.omni.close();
  while (b.tabs.length > tabs) { b.closeTab(b.active()); await sleep(200); }
  b.activate(site);
  await sleep(400);

  // Site information and the bookmark editor.
  await spike.activate();
  window.gTrustPanelHandler?.showPopup({});
  const trust = await waitFor(() => { const p = document.getElementById("trustpanel-popup"); return p?.state === "open" ? p : null; }, { timeout: 8000, what: "site information" }).catch(() => null);
  if (check("site information panel opens", !!trust)) {
    await sleep(300);
    check("site information: under the pill", under(R.popupRect(trust)), R.popupRect(trust));
    m = mark();
    spike.press("Escape");
    await sleep(600);
    check("site information: Esc closes it, nothing of Vitre's runs", trust.state === "closed" && actions(m).length === 0, { state: trust.state, actions: actions(m) });
    if (trust.state !== "closed") trust.hidePopup();
  }
  window.PlacesCommandHook.bookmarkPage();
  const editor = await waitFor(() => { const p = document.getElementById("editBookmarkPanel"); return p?.state === "open" ? p : null; }, { timeout: 8000, what: "bookmark editor" }).catch(() => null);
  if (check("bookmark editor opens", !!editor)) {
    await sleep(500);
    check("bookmark editor: under the pill", under(R.popupRect(editor)), R.popupRect(editor));
    // Typing in the editor's name field must not be eaten by the key router (Ctrl+A, letters, Enter).
    const name = document.getElementById("editBMPanel_namePicker");
    name?.focus();
    await sleep(200);
    m = mark();
    spike.press("Ctrl+A");
    spike.type("Robust name");
    await sleep(300);
    check("bookmark editor: its name field takes typing (Ctrl+A, letters)", name?.value === "Robust name" && actions(m).length === 0, { value: name?.value, actions: actions(m) });
    spike.press("Enter");
    await sleep(700);
    check("bookmark editor: Enter saves and closes", editor.state === "closed", editor.state);
    if (editor.state !== "closed") editor.hidePopup();
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const bm = await PlacesUtils.bookmarks.fetch({ url: site.url });
    check("bookmark editor: the bookmark exists with the typed name", bm?.title === "Robust name", bm?.title);
  }

  // ---- 6. popup blocked: Firefox's notification bar ----
  log("--- 6. notification bar from a blocked popup");
  await evalIn("setTimeout(() => window.open('https://example.org/', 'x', 'width=300,height=200'), 50); 'later'");
  const barEl = await waitFor(() => { const n = document.getElementById("notifications-toolbar"); return n && n.getBoundingClientRect().height > 10 ? n : null; }, { timeout: 6000, what: "popup-blocked bar" }).catch(() => null);
  if (barEl) {
    await sleep(500);
    const nb = R.rect(barEl);
    log("popup-blocked notification bar:", nb, "text:", barEl.textContent.trim().slice(0, 80));
    check("popup-blocked bar: a card under the tab bar", nb.y === 68 && nb.w <= 640, nb);
    await spike.capture("panels-popup-blocked");
    // Its button opens a menu: is it reachable (pointer-events) and where does it open?
    const box = gBrowser.getNotificationBox ? null : null;
    const note = window.gNotificationBox.currentNotification;
    const button = note?.buttonContainer?.querySelector("button") || note?.querySelector("button");
    if (button) {
      const br = R.rect(button);
      const hit = document.elementFromPoint(br.x + br.w / 2, br.y + br.h / 2);
      log("options button:", br, "hit:", hit?.localName, hit?.id || hit?.className);
      check("popup-blocked bar: its button is clickable (not under Vitre's layer)", !!hit && (hit === button || button.contains(hit) || hit.contains(button) || note.contains(hit)), hit?.localName + "#" + hit?.id);
    }
    window.gNotificationBox.removeAllNotifications(true);
  } else log("NOTE no popup-blocked bar appeared:", { tabs: b.tabs.length });
  while (b.tabs.length > 1) { const t = b.tabs.find((x) => x !== site); b.closeTab(t); await sleep(200); }

  // ---- 7. second window and popup window ----
  log("--- 7. other windows");
  const w2 = await spike.openWindow();
  await w2.spike.resize(900, 600);
  await R.load("https://example.com/?w2", w2.vitre.active(), w2);
  await w2.spike.activate();
  w2.gBrowser.selectedBrowser.focus();
  await askGeo(w2.gBrowser.selectedBrowser);
  open = await panelOpen(w2);
  await sleep(400);
  if (check("second window: prompt opens", open)) {
    const r = R.popupRect(w2.PopupNotifications.panel, w2);
    check("second window: doorhanger under that window's pill", under(r, w2), { r, pill: pill(w2) });
    check("second window: the first window's bar was not touched (no hold there)", PopupNotifications.panel.state === "closed");
    // Close the window with the prompt open.
    w2.close();
    await sleep(1200);
  } else w2.close();
  clearPerms();
  await spike.activate();

  const known = new Set(Services.wm.getEnumerator("navigator:browser"));
  window.openDialog("chrome://browser/content/browser.xhtml", "_blank", "chrome,dialog=no,width=520,height=420,location=yes,resizable=yes", "https://example.com/?popup");
  const pop = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")].find((w) => !known.has(w)), { timeout: 10000, what: "popup window" }).catch(() => null);
  if (pop) {
    await waitFor(() => pop.vitre?.ready && pop.vitre.tabs.length === 1 && !pop.vitre.tabs[0].loading && pop.vitre.tabs[0].url.includes("?popup"), { timeout: 20000, what: "popup ready" }).catch(() => {});
    await sleep(800);
    await pop.spike.activate();
    pop.gBrowser.selectedBrowser.focus();
    await askGeo(pop.gBrowser.selectedBrowser);
    open = await panelOpen(pop);
    await sleep(400);
    if (check("popup window: prompt opens", open)) {
      const r = R.popupRect(pop.PopupNotifications.panel, pop);
      log("popup window doorhanger:", r, "pill", pill(pop), "inner", pop.innerWidth);
      check("popup window: doorhanger hangs under its pill", Math.abs(r.y - 64) <= 10 && Math.abs(r.x - pill(pop).x) <= 10, { r, pill: pill(pop) });
    }
    // The app menu in a popup window has no + circle to hang from.
    try {
      pop.PanelUI.show();
      await waitFor(() => pop.PanelUI.panel.state === "open", { timeout: 6000, what: "app menu in popup" });
      await sleep(300);
      const mr = R.popupRect(pop.PanelUI.panel, pop);
      log("popup window app menu:", mr, "inner", [pop.innerWidth, pop.innerHeight]);
      check("popup window: the app menu opens near the bar (fallback anchor)", mr.y >= 40 && mr.y <= 80, mr);
      pop.PanelUI.hide();
    } catch (e) {
      log("popup window app menu: " + e);
    }
    pop.close();
  }
  clearPerms();
  await spike.activate();

  // ---- 8. page-side popups are untouched ----
  log("--- 8. page select");
  await R.load(R.page("Select", "<select id=s style='position:fixed;left:300px;top:300px;width:200px;height:30px'><option>one<option>two<option>three</select>"), site);
  b.focusPage();
  await sleep(300);
  spike.click(400, 315);
  const sel = await waitFor(() => { const p = document.getElementById("ContentSelectDropdown")?.menupopup || document.querySelector("#ContentSelectDropdown menupopup"); return p?.state === "open" ? p : null; }, { timeout: 4000, what: "select dropdown" }).catch(() => null);
  if (check("a page <select> opens its list", !!sel)) {
    const sr = R.popupRect(sel);
    check("...at the select, not under the bar", Math.abs(sr.x - 300) <= 12 && sr.y >= 320 && sr.y <= 345, sr);
    m = mark();
    tabs = b.tabs.length;
    spike.press("Escape");
    await sleep(500);
    check("Esc closes the list and nothing else", sel.state === "closed" && actions(m).length === 0, { state: sel.state, actions: actions(m) });
    if (sel.state !== "closed") sel.hidePopup();
  }

  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("panels");
});
