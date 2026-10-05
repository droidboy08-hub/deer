// VERIFY switcher/Ctrl+Tab takeover: positive control, which of the three measures is needed,
// focus in the URL bar / in a page input, a second window, and a native key event.
// Run: python tools/run.py --boot spikes/switcher/verify/v-keys.js --name switcher-verify-vkeys --out spikes/switcher/verify/out/v-keys --timeout 120
/* global gBrowser, Services, Ci, Cc, spike, vx, ctrlTab, gURLBar, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(() => {
  const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
  /** Vitre's takeover, exactly the recipe minus the optional parts (flags choose them). */
  function install(win, state) {
    const down = (e) => {
      if (ShortcutUtils.getSystemActionForEvent(e) !== ShortcutUtils.CYCLE_TABS) return;
      e.preventDefault();
      e.stopPropagation();
      state.steps.push((e.shiftKey ? "back" : "fwd") + (e.repeat ? "(repeat)" : ""));
      state.open = true;
    };
    const up = (e) => {
      if (e.key !== "Control" || !state.open) return;
      state.open = false;
      state.steps.push("commit");
    };
    win.addEventListener("keydown", down, true);
    win.addEventListener("keyup", up, true);
    return () => {
      win.removeEventListener("keydown", down, true);
      win.removeEventListener("keyup", up, true);
    };
  }

  if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
    // second window: install the listener, report through a global the first window reads
    window.vxState = { steps: [], open: false };
    install(window, window.vxState);
    return;
  }

  spike.main(async () => {
    await spike.resize(1280, 800);
    const EU = vx.EU();
    const input = `<input id=q style="font-size:30px;margin:40px 80px" value="page input">`;
    const first = gBrowser.selectedTab;
    const tabs = [1, 2, 3, 4].map((n) => vx.addTab(vx.page(n, vx.COLOURS[n - 1], "#fff", input)));
    for (const t of tabs) await vx.waitLoaded(t.linkedBrowser);
    gBrowser.removeTab(first);
    const n = (t) => tabs.indexOf(t) + 1;
    const sel = () => n(gBrowser.selectedTab);
    const seen = [];
    for (const t of tabs) {
      t.linkedBrowser.messageManager.addMessageListener("vx:key", (m) => seen.push(n(t) + ":" + m.data));
      vx.inContent(t.linkedBrowser, "addEventListener('keydown',e=>sendAsyncMessage('vx:key',(e.ctrlKey?'Ctrl+':'')+e.key),true)");
    }
    gBrowser.selectedTab = tabs[0];
    gBrowser.selectedBrowser.focus();
    await spike.sleep(400);
    const ctrlDown = (w = window) => EU.synthesizeKey("KEY_Control", { type: "keydown" }, w);
    const ctrlUp = (w = window) => EU.synthesizeKey("KEY_Control", { type: "keyup" }, w);
    const tab = (shift = false, w = window) => EU.synthesizeKey("KEY_Tab", { ctrlKey: true, shiftKey: shift }, w);
    const press = async (w = window) => { ctrlDown(w); tab(false, w); await spike.sleep(150); ctrlUp(w); await spike.sleep(250); };

    // sanity: an ordinary key reaches the page listener
    EU.synthesizeKey("x", {}, window);
    EU.synthesizeKey("KEY_Tab", {}, window); // a plain Tab reaches the page
    EU.synthesizeKey("y", { ctrlKey: true, altKey: true }, window);
    await spike.sleep(250);
    spike.log("0 sanity: page listener saw ordinary keys:", seen.splice(0));

    // P. positive control: nobody handles Ctrl+Tab -> the page must see it
    gBrowser.tabbox.handleCtrlTab = false;
    let before = sel();
    await press();
    spike.log("P positive control (handleCtrlTab=false, no Vitre listener): selected", before, "->", sel(), "| page saw", seen.splice(0));
    gBrowser.tabbox.handleCtrlTab = true;

    // A. ONLY the capture listener (no pref lock, tabbox.handleCtrlTab left at true)
    const state = { steps: [], open: false };
    let uninstall = install(window, state);
    before = sel();
    await press();
    spike.log("A listener only (handleCtrlTab=true, pref default): selected", before, "->", sel(), "| listener", state.steps.splice(0), "| page saw", seen.splice(0));

    // B. listener + Firefox's own MRU panel pref turned ON by the user
    Services.prefs.setBoolPref("browser.ctrlTab.sortByRecentlyUsed", true);
    await spike.sleep(150);
    before = sel();
    ctrlDown(); tab();
    await spike.sleep(500);
    const panelState = ctrlTab.panel?.state;
    ctrlUp();
    await spike.sleep(300);
    spike.log("B listener + browser.ctrlTab.sortByRecentlyUsed=true: Firefox panel state while held:", panelState, "| selected", before, "->", sel(), "| listener", state.steps.splice(0), "| page saw", seen.splice(0));
    Services.prefs.clearUserPref("browser.ctrlTab.sortByRecentlyUsed");
    await spike.sleep(100);

    // C. focus elsewhere
    gURLBar.focus();
    await spike.sleep(150);
    before = sel();
    await press();
    spike.log("C focus in URL bar: selected", before, "->", sel(), "| listener", state.steps.splice(0), "| focused element", document.activeElement?.id || document.activeElement?.localName);
    gBrowser.selectedBrowser.focus();
    vx.inContent(gBrowser.selectedBrowser, "content.document.getElementById('q').focus()");
    await spike.sleep(300);
    before = sel();
    await press();
    spike.log("C focus in a page <input>: selected", before, "->", sel(), "| listener", state.steps.splice(0), "| page saw", seen.splice(0));
    // key repeat (holding Tab)
    ctrlDown();
    EU.synthesizeKey("KEY_Tab", { ctrlKey: true }, window);
    EU.synthesizeKey("KEY_Tab", { ctrlKey: true, repeat: 3 }, window);
    ctrlUp();
    await spike.sleep(200);
    spike.log("C key repeat: listener", state.steps.splice(0), "| page saw", seen.splice(0));

    // D. a native key event (widget path: nsWindow -> TextEventDispatcher), no OS focus needed?
    {
      const VK_TAB = 0x09, CTRL_L = 0x0400;
      let r = "no callback";
      try {
        await new Promise((resolve, reject) => {
          window.windowUtils.sendNativeKeyEvent(0x409, VK_TAB, CTRL_L, "\t", "\t", { observe: () => resolve() });
          setTimeout(() => reject(new Error("timeout")), 3000);
        });
        r = "dispatched";
      } catch (e) {
        r = "failed: " + e;
      }
      await spike.sleep(300);
      spike.log("D native Ctrl+Tab (sendNativeKeyEvent):", r, "| selected stays", sel(), "| listener", state.steps.splice(0), "| page saw", seen.splice(0));
      state.open = false;
    }

    // E. a second window gets its own listener (boot scripts run per window)
    {
      const win2 = OpenBrowserWindow();
      await new Promise((r) => {
        const obs = (w) => {
          if (w === win2) {
            Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
            r();
          }
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
      await spike.sleep(600);
      const g2 = win2.gBrowser;
      const a = g2.addTab(vx.page(21, "#246"), { triggeringPrincipal: vx.SYS });
      await vx.waitLoaded(a.linkedBrowser);
      const i0 = g2.tabContainer.selectedIndex;
      const EU2 = { window: win2, parent: win2, _EU_Ci: Ci, _EU_Cc: Cc };
      Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU2);
      EU2.synthesizeKey("KEY_Control", { type: "keydown" }, win2);
      EU2.synthesizeKey("KEY_Tab", { ctrlKey: true }, win2);
      await spike.sleep(150);
      EU2.synthesizeKey("KEY_Control", { type: "keyup" }, win2);
      await spike.sleep(250);
      spike.log("E second window: tabs", g2.tabs.length, "selected index", i0, "->", g2.tabContainer.selectedIndex, "| its listener", win2.vxState?.steps, "| handleCtrlTab there", g2.tabbox.handleCtrlTab,
        "| first window's listener saw nothing:", state.steps.length === 0);
      win2.close();
      await spike.sleep(300);
    }

    // F. after removing the listener Firefox behaves as before (nothing sticky)
    uninstall();
    before = sel();
    await press();
    spike.log("F listener removed: selected", before, "->", sel(), "(Firefox tabbox again)");
  });
})();
