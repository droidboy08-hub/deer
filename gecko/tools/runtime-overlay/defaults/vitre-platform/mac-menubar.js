// Vitre product defaults for macOS only: the menu bar (src/window/modules/macmenu). Installed as
// <app>/Contents/Resources/defaults/vitre-platform/mac-menubar.js by tools/setup-runtime.py and read by
// config.js on macOS only, after vitre-prefs.js (mac-base.js says how this folder works).
// Only pref("name", value) lines, and only values that are decided.
//
// Not here: browser.referrals.enabled. Its app-menu slot holds Deer's "Check for Updates…", and it is
// turned on at run time only when Deer's items made the app menu (macmenu/items.ts
// installHiddenMenus); when Firefox's did, the same slot would say "Share Deer".

// ---- App menu: no "Set Deer as Default Browser". The approved menu is About Deer, Check for
// ---- Updates…, Settings…, Services, Hide Deer, Hide Others, Show All, Quit Deer. Firefox shows the
// ---- item while this is true (widget/cocoa/nsMenuBarX.mm ApplicationMenuOpened). Firefox's own
// ---- default is false as well, and only Nimbus turns it on (toolkit/components/nimbus/
// ---- FeatureManifest.yaml); stated here so Deer's choice does not rest on Firefox's.
pref("browser.macAppMenu.setAsDefaultShown", false);
