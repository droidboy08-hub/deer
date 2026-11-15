// Vitre product defaults for macOS only. Installed as <app>/Contents/Resources/defaults/vitre-platform/
// mac-base.js by tools/setup-runtime.py.
// This folder is NOT defaults/pref on purpose: Gecko reads every .js in defaults/pref on every OS, so
// a Mac file there would change Windows too. Gecko never reads this folder; config.js does, only when
// Services.appinfo.OS is "Darwin": every mac*.js here, in name order, after defaults/pref/vitre-prefs.js,
// with pref() writing the default branch (the user, or about:config, can still change any of them).
// One file per area (mac-base.js, mac-keys.js, mac-window.js, ...), so each has one owner.
// Only pref("name", value) lines, and only values that are decided.

// ---- Mouse: Control-click opens the context menu, as everywhere on the Mac. Firefox's default
// ---- depends on the build: on Nightly builds it is a plain click (modules/libpref/init/StaticPrefList.yaml).
pref("dom.event.treat_ctrl_click_as_right_click.disabled", false);
