// Vitre product defaults. Installed as runtime\defaults\pref\vitre-prefs.js by tools\setup-runtime.py.
// Default-branch values: the user (or about:config) can still change any of them.
// Gecko reads this folder BEFORE Firefox's own firefox.js, which would win for the prefs it also
// defines, so runtime\config.js applies this file again once all defaults are loaded.
// Only pref("name", value) lines; evidence for each group is in gecko\spikes\<area>\RESULT.md.

// ---- Never write outside the profile (packaging: the stock runtime otherwise rewrites the user's
// ---- Start Menu "Firefox" shortcut to point at this runtime and creates a private-browsing shortcut)
pref("browser.shell.customIcon.enabled", false);
pref("browser.privacySegmentation.createdShortcut", true);
// Taskbar jump lists: their tasks start the engine exe WITHOUT -profile, which would open the
// Firefox profile store (release-prep installer check, 2026-10-04).
pref("browser.taskbar.lists.enabled", false);

// ---- No default-browser prompts (Firefox's own "make default" would register the exe without -profile)
pref("browser.shell.checkDefaultBrowser", false);
pref("browser.shell.skipDefaultBrowserCheckOnFirstRun", true);
pref("browser.shell.didSkipDefaultBrowserCheckOnFirstRun", true);
pref("browser.shell.mostRecentDateSetAsDefault", "1700000000");
pref("browser.shell.setDefaultBrowserUserChoice", false);
pref("browser.shell.setDefaultPDFHandler", false);
pref("browser.defaultbrowser.notificationbar", false);
pref("browser.startup.windowsLaunchOnLogin.disableLaunchOnLoginPrompt", true);

// ---- Firefox's onboarding, messaging and promotions: off (with Vitre's brand strings they would
// ---- speak as Vitre)
pref("browser.aboutwelcome.enabled", false);
pref("browser.startup.homepage_override.mstone", "ignore");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("startup.homepage_override_url", "");
pref("trailhead.firstrun.didSeeAboutWelcome", true);
pref("browser.preonboarding.enabled", false);
pref("browser.startup.upgradeDialog.enabled", false);
pref("browser.laterrun.enabled", false);
pref("browser.uitour.enabled", false);
pref("browser.messaging-system.whatsNewPanel.enabled", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("messaging-system.rsexperimentloader.enabled", false);
pref("browser.discovery.enabled", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("browser.vpn_promo.enabled", false);
pref("browser.promo.focus.enabled", false);
pref("browser.translations.automaticallyPopup", false);
// Mozilla's terms-of-use and data-choices notices are for Firefox; nothing is sent (below).
pref("termsofuse.bypassNotification", true);
pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);

// ---- Telemetry, studies, crash reports: off. (toolkit.telemetry.unified stays at its default:
// ---- false makes TelemetrySession skip its init and throw a TypeError on every session;
// ---- the two datareporting prefs and distribution/policies.json already send nothing.)
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("toolkit.telemetry.reportingpolicy.firstRun", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("app.normandy.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("browser.tabs.crashReporting.sendReport", false);

// ---- Startup: restore the last session; no Firefox-shaped placeholder window before Vitre's UI.
// ---- Home and new tab are blank until the Home page is in the build (VitreStartup then points
// ---- both at about:vitre-home).
pref("browser.startup.page", 3);
pref("browser.startup.homepage", "about:blank");
pref("browser.newtabpage.enabled", false);
pref("browser.startup.preXulSkeletonUI", false);

// ---- Closing: no prompts (design: Ctrl+Shift+W closes the window, Ctrl+Shift+T brings it back)
pref("browser.tabs.warnOnClose", false);
pref("browser.warnOnQuit", false);
pref("browser.warnOnQuitShortcut", false);

// ---- Keyboard (keys spike, recipe A.2): Vitre's router owns the keys
pref("ui.key.menuAccessKeyFocuses", false);
pref("ui.key.menuAccessKey", 0);
pref("ui.key.contentAccess", 4);
pref("accessibility.browsewithcaret_shortcut.enabled", false);
pref("browser.backspace_action", 2);
// Firefox's own Ctrl+Tab panel stays off; Vitre's switcher takes Ctrl+Tab.
pref("browser.ctrlTab.sortByRecentlyUsed", false);

// ---- Find: no native type-ahead find; Vitre's find field drives browser.finder
pref("accessibility.typeaheadfind", false);
pref("accessibility.typeaheadfind.manual", false);
pref("accessibility.typeaheadfind.enablesound", false);
pref("findbar.highlightAll", true);

// ---- Firefox interface that Vitre replaces
pref("sidebar.revamp", false);
pref("browser.toolbars.bookmarks.visibility", "never");
pref("browser.tabs.hoverPreview.enabled", false);
pref("browser.download.alwaysOpenPanel", false);
pref("browser.ml.chat.enabled", false);
// Firefox's urlbar keeps a results page's search terms as the tab's typed value (SmartbarInput.mjs
// #handlePersistedSearchTerms); Vitre never shows that urlbar, and terms such as "c++:templates"
// would read as the tab's address (src/window/firefox.ts tabUrl keeps its own guard too).
pref("browser.urlbar.showSearchTerms.enabled", false);
// The extensions button must exist even when nothing is pinned (extensions spike, correction 1).
pref("extensions.unifiedExtensions.button.always_visible", true);

// ---- Pages
// Sized window.open() popups take the tab path too, so Peek and the tab bar see them.
pref("browser.link.open_newwindow.restriction", 0);
// Favicons and icons that use context-fill follow the glass theme.
pref("svg.context-properties.content.enabled", true);
// Design (DESIGN-NOTES, Find in page): pages keep the standard Fluent scrollbar with its 15 px
// track; Vitre never turns on overlay scrollbars (find's match ticks sit on the track).
pref("widget.windows.overlay-scrollbars.enabled", false);
// Error pages: the plain layout, not the illustrated "felt privacy" one (skin/pages.css restyles it).
pref("security.certerrors.felt-privacy-v1", false);

// ---- Glass (glass spike, correction 5): a row lens is one SVG filter; the default of 64
// ---- primitives per chain holds only 13 shapes and fails silently beyond that. Vitre chunks rows
// ---- at 24 shapes (src/window/glass.ts MAX_ROW_SHAPES: 29 sits on WebRender's hard cap).
pref("gfx.webrender.max-filter-ops-per-chain", 256);
