// Vitre keyboard defaults for macOS only (the Mac keymap: src/shared/shortcuts.ts, the router
// src/window/keys.ts). Loaded by config.js on Darwin only, after defaults/pref/vitre-prefs.js, with
// pref() writing the default branch; Windows keeps vitre-prefs.js exactly as it is. See mac-base.js
// for why this folder is not defaults/pref.
// Only pref("name", value) lines, and only values that are decided.

// ---- Quit: Cmd+Q asks first (owner's decision: Peek is Control+Q, one modifier away). Firefox asks
// ---- from BrowserGlue.sys.mjs _onQuitRequest when the quit came from the shortcut
// ---- (globalOverlay.js goQuitApplication with metaKey; the router passes it for Cmd+Q). That code
// ---- returns at once while browser.warnOnQuit is false, which vitre-prefs.js sets for Windows, so
// ---- both are needed. browser.tabs.warnOnClose stays false (vitre-prefs.js): only Cmd+Q asks, never
// ---- Deer > Quit Deer or a closing window.
pref("browser.warnOnQuit", true);
pref("browser.warnOnQuitShortcut", true);

// ---- Page access keys: Control+Option+letter, Firefox's macOS default
// ---- (modules/libpref/init/StaticPrefList.yaml ui.key.contentAccess). vitre-prefs.js sets 4 (Alt)
// ---- for Windows; on a Mac Option with a letter types a character (Option+C is a c cedilla), and
// ---- with 4 a page's accesskey="c" would take that character instead
// ---- (widget/WidgetEventImpl.cpp ModifiersMatchWithAccessKey masks out AltGraph, which Option sets).
pref("ui.key.contentAccess", 6);

// ---- Full screen: Esc never leaves window full screen (owner's decision; Control+Cmd+F, the green
// ---- button and the View menu do). The router consumes every Esc it routes; this Mac-only pref stops
// ---- the native fallback for any Esc nobody consumed (widget/cocoa/nsCocoaWindow.mm
// ---- PostHandleKeyEvent). Element full screen (a video) still leaves on Esc: that is PresShell's own.
pref("browser.fullscreen.exit_on_escape", false);
