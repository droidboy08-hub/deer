// VERIFY claim 25 (was "unverified"): the extension bar recipe in a second window and in a private
// window. The boot script is loaded into every browser window; the first window drives the test,
// later windows only install the bar (which is what the real app would do per window).
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  try {
    xt.hideFirefoxUI();
    const ui = xt.buildBar();
    window.vitre = Object.assign(xt.installExtensionBar(ui), { ui });
  } catch (e) {
    window.vitreError = String(e) + "\n" + e.stack;
  }
} else {
  spike.main(async () => {
    await spike.resize(1100, 700);
    xt.hideFirefoxUI();
    const ui = xt.buildBar();
    const first = xt.installExtensionBar(ui);
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
    await xt.nav(xt.page());
    const mv2 = await xt.installTemp("mv2");
    const mv3 = await xt.installTemp("mv3");
    await xt.waitFor(() => xt.reported(mv2.id)?.tabs && xt.reported(mv3.id)?.dynamicRules);
    await xt.nav(xt.page() + "?w1");
    await xt.waitFor(() => xt.actionData(mv2.id)?.badgeText);
    const w2id = xt.actionFor(mv2.id).widget.id, w3id = xt.actionFor(mv3.id).widget.id;
    const rect = (el) => (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect());
    const clickIn = (win, el, button = 0) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const base = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, screenX: win.mozInnerScreenX + x, screenY: win.mozInnerScreenY + y, button };
      for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new win.MouseEvent(t, base));
    };
    const closeIn = async (win) => {
      for (const p of win.document.querySelectorAll("panel, menupopup")) if (p.state === "open" || p.state === "showing") { try { p.hidePopup(); } catch (e) {} }
      await xt.sleep(500);
    };
    const open = async (opts, w, h) => {
      const win = OpenBrowserWindow(opts);
      await xt.waitFor(() => win.vitre || win.vitreError, 20000);
      if (win.vitreError) spike.log("installExtensionBar FAILED in new window:", win.vitreError);
      win.resizeTo(w, h);
      win.moveTo(20, 20);
      await xt.sleep(800);
      return win;
    };
    const state = (win, label) => {
      const bar = win.document.getElementById("vitre-ext-bar");
      const node = win.document.getElementById(w2id);
      const btn = node?.querySelector(".unified-extensions-item-action-button");
      spike.log(label + ": widgets in this window's pill=" + JSON.stringify([...(bar?.children || [])].map((c) => c.id)), "mv2 node parent=" + node?.parentNode?.id, "badge=" + btn?.getAttribute("badge"),
        "ext button in vitre-bar=" + !!win.document.getElementById("unified-extensions-button")?.closest("#vitre-bar"), "ext button hidden=" + win.document.getElementById("unified-extensions-button")?.hidden);
      return { bar, node, btn };
    };

    // ---------------- second normal window
    const win2 = await open(undefined, 1400, 860);
    spike.log("window 2 opened: vitre=" + !!win2.vitre, "private=" + PrivateBrowsingUtils.isWindowPrivate(win2), "windows=" + [...Services.wm.getEnumerator("navigator:browser")].length);
    win2.gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page() + "?w2", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await xt.waitFor(() => win2.gBrowser.selectedTab.label.startsWith("RESULT"), 15000);
    await xt.sleep(1200);
    let s2 = state(win2, "window 2");
    state(window, "window 1");
    await spike.capture("win2-1-second-window-pill");

    // popup from the pill button of window 2
    clickIn(win2, s2.btn);
    await xt.waitFor(() => s2.btn.open, 6000);
    await xt.sleep(1200);
    const wp = win2.document.getElementById("customizationui-widget-panel");
    spike.log("window 2 popup via click: open=" + s2.btn.open, "panel state=" + wp?.state, "panel rect", JSON.stringify(wp ? rect(wp) : null), "button rect", JSON.stringify(rect(s2.btn)),
      "| window 1 button open=" + document.getElementById(w2id).querySelector(".unified-extensions-item-action-button").open);
    await spike.capture("win2-2-popup-in-second-window");
    await closeIn(win2);

    // extensions panel of window 2
    const eb2 = win2.document.getElementById("unified-extensions-button");
    clickIn(win2, eb2);
    const up2 = await xt.waitFor(() => win2.document.getElementById("unified-extensions-panel"), 5000);
    await xt.waitFor(() => up2?.state === "open", 5000);
    await xt.sleep(900);
    spike.log("window 2 extensions panel: state=" + up2?.state, "items", JSON.stringify([...(up2?.querySelectorAll(".unified-extensions-item") || [])].map((n) => n.id)), "anchor in vitre-bar=" + !!up2?.anchorNode?.closest("#vitre-bar"));
    await spike.capture("win2-3-panel-in-second-window");
    await closeIn(win2);

    // pin from window 2 (its own gUnifiedExtensions override), both windows must follow
    win2.gUnifiedExtensions.pinToToolbar(w3id, true);
    await xt.sleep(600);
    spike.log("after win2.gUnifiedExtensions.pinToToolbar(mv3,true): placement", JSON.stringify(CustomizableUI.getPlacementOfWidget(w3id)),
      "| win1 pill", JSON.stringify([...first.toolbar.children].map((c) => c.id)), "| win2 pill", JSON.stringify([...win2.vitre.toolbar.children].map((c) => c.id)));
    win2.gUnifiedExtensions.pinToToolbar(w3id, false);
    await xt.sleep(400);

    // an install doorhanger raised for a tab of window 2 anchors to window 2's bar
    win2.focus();
    await xt.sleep(500);
    win2.gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("127.0.0.1", "/vitre-install.xpi"), { triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://127.0.0.1:47631"), hasValidUserGestureActivation: true });
    const pn2 = win2.PopupNotifications;
    const shown = await xt.waitFor(() => { if (Services.focus.activeWindow !== win2 && !pn2.isPanelOpen) { try { pn2._update(); } catch (e) {} } return pn2.panel.state === "open"; }, 12000, 300);
    await xt.sleep(600);
    spike.log("window 2 doorhanger: open=" + !!shown, "id=" + pn2.panel.firstElementChild?.getAttribute("popupid"), "anchor in window 2's vitre-bar=" + !!pn2.panel.anchorNode?.closest("#vitre-bar"),
      "anchor document is window 2=" + (pn2.panel.anchorNode?.ownerDocument === win2.document), "| window 1 panel state=" + PopupNotifications.panel.state);
    await spike.capture("win2-4-doorhanger-in-second-window");
    await closeIn(win2);

    // close window 2, then make sure window 1 still works (no dead-window fallout)
    win2.close();
    await xt.sleep(1500);
    let err = null;
    try {
      gUnifiedExtensions.pinToToolbar(w3id, true);
      await xt.sleep(400);
      gUnifiedExtensions.pinToToolbar(w3id, false);
      await xt.sleep(400);
    } catch (e) { err = String(e); }
    spike.log("after closing window 2: pin/unpin in window 1 error=" + err, "| win1 pill", JSON.stringify([...first.toolbar.children].map((c) => c.id)));

    // ---------------- private window
    const pw = await open({ private: true }, 1500, 900);
    spike.log("private window opened: vitre=" + !!pw.vitre, "private=" + PrivateBrowsingUtils.isWindowPrivate(pw));
    pw.gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page() + "?pw", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await xt.waitFor(() => pw.gBrowser.selectedTab.label.startsWith("RESULT"), 15000);
    await xt.sleep(1000);
    spike.log("private window, extensions NOT allowed in private windows: page result", pw.gBrowser.selectedTab.label);
    state(pw, "private window (no private access)");
    await spike.capture("win2-5-private-window-no-access");
    const ebp = pw.document.getElementById("unified-extensions-button");
    clickIn(pw, ebp);
    const upp = await xt.waitFor(() => pw.document.getElementById("unified-extensions-panel"), 5000);
    await xt.waitFor(() => upp?.state === "open", 5000);
    await xt.sleep(900);
    spike.log("private window extensions panel: state=" + upp?.state, "items", JSON.stringify([...(upp?.querySelectorAll(".unified-extensions-item") || [])].map((n) => n.id)),
      "text", JSON.stringify((upp?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300)), "| tabs opened instead:", JSON.stringify(pw.gBrowser.tabs.map((t) => t.linkedBrowser.currentURI.spec)));
    await spike.capture("win2-6-private-window-panel");
    await closeIn(pw);

    // grant private access to mv2 the way the recipe says, reload it
    await ExtensionPermissions.add(mv2.id, { permissions: ["internal:privateBrowsingAllowed"], origins: [] });
    const a2 = await xt.AddonManager.getAddonByID(mv2.id);
    await a2.reload();
    await xt.waitFor(() => xt.reported(mv2.id)?.tabs, 10000);
    pw.gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page() + "?pw2", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await xt.sleep(3000);
    spike.log("private window after granting mv2 private access + reload: page result", pw.gBrowser.selectedTab.label, "privateBrowsingAllowed=" + xt.policy(mv2.id)?.privateBrowsingAllowed);
    const sp = state(pw, "private window (mv2 allowed)");
    await spike.capture("win2-7-private-window-with-access");
    if (sp.btn) {
      clickIn(pw, sp.btn);
      await xt.waitFor(() => sp.btn.open, 6000);
      await xt.sleep(1200);
      spike.log("private window popup: open=" + sp.btn.open);
      await spike.capture("win2-8-private-window-popup");
      await closeIn(pw);
    }
    pw.close();
    await xt.sleep(800);
  });
}
