// macOS check for the ⌘ keymap, Deer's native menu bar and the Mac key labels (MacKeys, MacMenuReference).
//   python3 tools/run.py --test tests/menus/mac-keys-menubar.js --name mac-keys --url about:blank --timeout 150
// Keys are synthesized DOM events, so this proves the router, not the Cocoa key-equivalent path; the
// "acts once" check by real keyboard is in the reviewer's try-on-keyboard list.
/* global spike, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, log, waitFor } = spike;
  await spike.resize(1280, 800);
  await M.activate();
  await M.load(M.page("article.html"));

  // Prefs from mac-keys.js / mac-menubar.js.
  check("pref browser.warnOnQuit", Services.prefs.getBoolPref("browser.warnOnQuit", false) === true);
  check("pref browser.warnOnQuitShortcut", Services.prefs.getBoolPref("browser.warnOnQuitShortcut", false) === true);
  check("pref ui.key.contentAccess = 6", Services.prefs.getIntPref("ui.key.contentAccess", 0) === 6);
  check("pref fullscreen.exit_on_escape off", Services.prefs.getBoolPref("browser.fullscreen.exit_on_escape", true) === false);

  // Menu bar.
  const { VitreShell } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs");
  const hook = VitreShell.timeline.find((n) => n.hook === "mac-hidden-menubar");
  check("hidden window got Deer's menus in time", hook?.menubar === "deer", hook);
  check("no VitreShell errors", !(VitreShell.errors || []).length, VitreShell.errors);
  const fxBar = document.getElementById("main-menubar");
  check("Firefox menu bar marked nonnative", fxBar?.hasAttribute("nonnative"));
  const bar = document.getElementById("vitre-menubar");
  check("Deer menu bar exists", !!bar);
  const top = bar ? [...bar.children].filter((m) => m.localName === "menu").map((m) => m.getAttribute("label")) : [];
  log("MENUBAR " + JSON.stringify(top));
  check("menus are File Edit View History Window Help", ["File", "Edit", "View", "History", "Window", "Help"].every((l) => top.includes(l)), top);
  const glyph = (k) => k && ((k.getAttribute("modifiers") || "") + " " + (k.getAttribute("key") || k.getAttribute("keycode") || ""));
  for (const m of bar ? bar.querySelectorAll(":scope > menu") : []) {
    const rows = [...m.querySelectorAll("menuitem")].map((i) => {
      const k = i.getAttribute("key") && document.getElementById(i.getAttribute("key"));
      return i.getAttribute("label") + (k ? " [" + glyph(k).trim() + "]" : "");
    });
    log("MENU " + m.getAttribute("label") + " " + JSON.stringify(rows));
  }
  const hidden = Services.appShell.hiddenDOMWindow?.document;
  const appItems = hidden ? ["menu_FileQuitItem", "menu_settings", "aboutName", "menu_mac_hide_app"].map((id) => [id, hidden.getElementById(id)?.getAttribute("label")]) : [];
  log("APPMENU " + JSON.stringify(appItems));
  check("app menu reads Deer", appItems.some(([, l]) => /Deer/.test(l || "")), appItems);

  // Labels (⌃⌥⇧⌘, no "+").
  const want = { newTab: "⌘T", closeTab: "⌘W", reopenClosed: "⇧⌘T", focusAddress: "⌘L", back: "⌘[", forward: "⌘]", reload: "⌘R", stop: "⎋", fullscreen: "⌃⌘F", downloads: "⌥⌘L", peekLink: "⌃Q", history: "⌘Y", settings: "⌘,", quit: "⌘Q", minimize: "⌘M" };
  for (const [a, w] of Object.entries(want)) check(`label ${a} = ${w}`, b.keys.label(a) === w, b.keys.label(a));

  // Router (synthesized). Chrome focus first, then a page.
  const tabs = () => b.tabs.length;
  const n0 = tabs();
  M.key("t", { metaKey: true });
  await waitFor(() => tabs() === n0 + 1, { what: "⌘T opened one tab" }).catch(() => {});
  check("⌘T opens one tab", tabs() === n0 + 1, tabs());
  await sleep(400);
  M.key("w", { metaKey: true });
  await waitFor(() => tabs() === n0, { what: "⌘W closed it" }).catch(() => {});
  check("⌘W closes one tab", tabs() === n0, tabs());
  M.key("t", { ctrlKey: true });
  await sleep(500);
  check("⌃T does nothing on Mac", tabs() === n0, tabs());
  M.key("t", { metaKey: true, shiftKey: true });
  await waitFor(() => tabs() === n0 + 1, { what: "⇧⌘T reopened" }).catch(() => {});
  check("⇧⌘T reopens the closed tab", tabs() === n0 + 1, tabs());
  M.key("w", { metaKey: true });
  await waitFor(() => tabs() === n0).catch(() => {});
  await sleep(300);
  M.key("l", { metaKey: true });
  await sleep(500);
  const ae = document.activeElement;
  check("⌘L focuses the address field", !!ae && (ae.closest?.("#vitre-omnibox, .omnibox, [vitre-omnibox]") || /omni|address/i.test(ae.id + " " + ae.className)), ae && (ae.id || ae.className));
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  await sleep(300);

  // Deer's page menu: glyph keys, no Ctrl/Alt text.
  M.rightClick(420, 360);
  await M.waitOpen();
  await sleep(300);
  const st = M.state();
  const keys = st.rows.map((r) => r.key).filter(Boolean);
  log("PAGEMENU " + JSON.stringify(st.rows.map((r) => r.label + (r.key ? " [" + r.key + "]" : ""))));
  check("page menu keys are glyphs", keys.length > 0 && keys.every((k) => !/Ctrl|Alt\+|Shift\+/.test(k)), keys);
  check("page menu has no underlined access keys", !document.querySelector(".vitre-menu u, .vm-row u, [data-access] u"));
  M.key("KEY_Escape");
  await M.waitClosed();
});
