# Spike result: switcher

Verdict: works-with-compromises

## Summary
All seven items work on Firefox 157 in the runtime, each backed by a run. FINDINGS.md was NOT written: the harness refused the Write call for a findings .md file, so the findings are in this output and the runnable scripts and their out/ logs and screenshots are the evidence.

- **Thumbnails:** `drawSnapshot` captures the selected tab, background tabs that were never shown, and tabs in a minimized window. Twelve tabs take 9-10 ms at 1280x800 and 33-75 ms at 1920x1080 with eight real sites (half scale, in parallel). Discarded and not-yet-restored tabs cannot be captured; they come from a cache, which also survives a restart as JPEG files.
- **Live deck:** a tab's panel can be shown scaled with a CSS transform, and several tabs can be live at once.
- **Ctrl+Tab:** Vitre can take it from Firefox completely; the page never sees the key. MRU order from tab events matches `tab.lastAccessed`.
- **Theme sampling:** 0.25-2.1 ms median per sample (max 2.8 ms). The bar class switches about 82 ms after a scroll (80 ms of that is debounce) and 7-9 ms after `pageshow`.
- **Home:** `about:vitre-home` registered at runtime works as new tab and home page, showing the user's Windows wallpaper, a custom image, or a video. I recommend the page-in-a-tab over a chrome-document layer.
- **Settings:** `vitre.*` prefs cover every field, broadcast to every window in about 1 ms, and survive a restart. I recommend prefs over a JSON file.
- **Session, history, clearing:** all provided by Firefox (Places, SessionStore, Sanitizer with time ranges).

Three things need care: content-process code cannot be loaded from the project folder, in-process pages need an explicit snapshot rect, and Home must be registered before a restored Home tab loads.

## Claims
- [proven] Thumbnail of the selected tab via browsingContext.currentWindowGlobal.drawSnapshot(null, scale, 'white')
  evidence: thumbs.js, out/thumbs/log.txt 'A' lines: 1264x707 at scale 1 in 1.7-3 ms, 632x353 in 0.7-0.9 ms. out/thumbs-big/log.txt: 1904x987 Wikipedia page 5-50 ms at scale 1 (first call slowest), 952x493 in 3.5-23 ms.
- [proven] Thumbnails of BACKGROUND tabs that were never shown, at the right size and their own scroll position
  evidence: thumbs.js 'B' lines: all 12 tabs return 632x353 bitmaps with distinct luma; 'D' line: a scrolled tab's snapshot is identical selected and as background (luma 0.403 both), and DOMRect(0,0) gives the document top instead (0.361). Screenshots out/thumbs/thumbs-grid.png and out/thumbs-big/thumbs-grid.png (real sites) viewed.
- [proven] Speed at 12 tabs and resolution
  evidence: out/thumbs/log.txt (1280x800): sequential 17-61 ms, Promise.all 9-10 ms at 0.5 scale, 13-40 ms at 0.75 (948x530). out/thumbs-big/log.txt (1920x1080, 8 real sites + 4 generated): sequential 62-180 ms, Promise.all 33-75 ms at 0.5 (952x493), 48-111 ms at 0.75 (1428x740). Ranges are across repeated runs; devicePixelRatio 1 only.
- [proven] Snapshots still work when the window is minimized
  evidence: thumbs.js 'D2' lines: windowState 2, background-tab and selected-tab snapshots returned in 1-8 ms with real content.
- [proven] PageThumbs.captureToCanvas / captureToBlob / captureTabPreviewThumbnail (tab-hover-preview path) on background tabs
  evidence: thumbs.js 'C' lines: 2-51 ms, all return content. They are wrappers over drawSnapshot with an extra actor round trip; not needed.
- [not-possible] Capturing discarded or lazy (unloaded) tabs
  evidence: thumbs.js 'E' lines: after gBrowser.discardBrowser the browser has browsingContext null, linkedPanel null, 'pending' attribute; drawSnapshot cannot be called; moz-page-thumb:// has nothing stored (naturalWidth 0). Same for createLazyBrowser tabs. Best alternative: Vitre's own cache, proven in the grid (cell '[discarded] Page 6' shows its cached thumbnail).
- [proven] Thumbnail cache refreshed on tab switch and on load
  evidence: thumbs.js 'F' line: TabSelect refreshes the outgoing tab (5-27 ms) and the incoming one (1-7 ms); addTabsProgressListener load-stop refresh 1-2 ms.
- [proven] Thumbnails that survive a restart for restored, not-yet-loaded tabs
  evidence: session.js step 4 + RUN 2: 632x353 JPEG q0.8 is 8-49 KB, encode 0.6 ms, write 0.6 ms; id stored with SessionStore.setCustomTabValue comes back after restore; out/session2/session-restored-thumbs.png shows pending tabs with thumbnails read from disk (viewed).
- [proven] 12 real thumbnails in a grid overlay drawn in browser.xhtml
  evidence: out/thumbs/thumbs-grid.png and out/thumbs-big/thumbs-grid.png (both viewed); log 'G overlay cells 12 with thumbnails 12'.
- [proven] A tab's <browser> shown live and scaled with a CSS transform (deck animation)
  evidence: live.js, out/live/live-scaled-selected.png: panel at scale 0.62 with rounded corners and shadow; the page's clock reads 2.0, 4.1, 6.5 across successive captures, so it keeps running. live-restored.png: back to normal after removing styles.
- [proven] Several tabs displayed live at once (selected plus background panels)
  evidence: live.js, out/live/live-three-panels.png: three tabs side by side, each animating. Needs an agent-sheet override of -moz-subtree-hidden-only-visually plus docShellIsActive = true; the inline-style attempt was rejected (cssText showed only the transform).
- [proven] Mouse input maps correctly through a scaled browser
  evidence: live.js line 'c.': a synthesized click 100 px into a 0.5-scaled browser arrives in content at (200, 201).
- [proven] MRU order tracking
  evidence: mru.js line 1: own list from TabSelect/TabOpen/TabClose = [2,4,1,3,5], identical to sorting by tab.lastAccessed. session.js RUN 2 shows lastAccessed restored after session restore (4-16 s old values).
- [proven] Disabling Firefox's own Ctrl+Tab handling and panel, and handling Ctrl+Tab in Vitre
  evidence: mru.js lines 2-4: default pref false and tabbox moves 2->3 in bar order; with the pref true Firefox's panel opens (state 'open'); after locking the pref false + tabbox.handleCtrlTab=false + a capture keydown listener, two taps with Ctrl held leave the selection at 2 and release commits tab 4; quick tap goes to the previous tab; Ctrl+Shift+Tab goes backwards; the page saw only the bare Control key; Ctrl+PageDown still Firefox's; setting the locked pref has no effect. Screenshot out/mru/mru-vitre-switcher-held.png viewed.
- [partial] Screenshot of Firefox's own ctrlTab panel
  evidence: The panel is a XUL popup (separate OS window), so out/mru/mru-firefox-panel.png does not show it; the log line 'panel state open isOpen true' is the evidence that it opened.
- [proven] Theme sampling: light or dark bar from the page under it, over a white page and a dark page
  evidence: theme.js: white page luma 0.999 -> theme-light (out/theme/theme-white.png), dark page 0.065 -> theme-dark (theme-dark.png), both viewed.
- [proven] Resampling on tab switch, load and scroll, with timings
  evidence: theme.js timeline: tabselect sample 4-35 ms; pageshow -> class change 7-9 ms after the content event; scroll -> class change 81-84 ms after the scroll event (80 ms debounce + 1-3 ms sample). theme-mixed-top.png / theme-mixed-scrolled.png show the same tab flipping light -> dark on scroll.
- [proven] Sampling cost
  evidence: theme.js 'cost' lines, 30 samples each: viewport at 1/16 scale median 0.24-0.28 ms (simple page), 1.8-2.1 ms (Wikipedia), max 2.8 ms; strip rect median 0.12-0.9 ms. A strip with a stale scroll offset reads the wrong place (fixed dark header: 1.000 instead of 0.097), so the viewport strategy is recommended.
- [proven] Scroll and paint notifications from content via a runtime-registered JSWindowActor
  evidence: probe-actor.js, out/probe-actor/log.txt: 'page changed: DOMContentLoaded / pageshow / scroll scrollY 500' in a 'web' process and ping answered in a 'webIsolated=https://example.com' process.
- [not-possible] Loading the actor's child module straight from the project folder
  evidence: probe-actor.js lines 2: 'Failed to load resource://vitre-boot/actors/VitrePageChild.sys.mjs', ping TIMEOUT, content process gets NS_ERROR_FILE_ACCESS_DENIED on a project file (also with security.sandbox.content.level=0). Alternative proven: copy to <profile>/chrome/ and map a resource:// substitution (line 3 works).
- [unverified] Actor modules served from the application directory in a packaged build
  evidence: Nothing was written into gecko/runtime (not allowed), so only the <profile>/chrome location was run.
- [proven] Reading the Windows wallpaper path (registry and TranscodedWallpaper) and loading it in a privileged page
  evidence: homepage.js 'A' lines: nsIWindowsRegKey returns the HKCU WallPaper value, file exists; TranscodedWallpaper exists (2.4 MB) and decodes in a plain <img> at 5120x2880 despite no extension. out/home/home-wallpaper.png shows the user's wallpaper as Home's background (viewed).
- [proven] Mean luma of the wallpaper
  evidence: homepage.js 'A' lines: 0.728 in 52-75 ms (IOUtils.read + createImageBitmap resized to 64x36); Home applies theme-light (> 0.62).
- [proven] about:vitre-home registered at runtime as new-tab page and home page
  evidence: homepage.js 'B' lines: BROWSER_NEW_TAB_URL and HomePage.get() = about:vitre-home, isInitialPage true; Ctrl+T opens it in 220-365 ms with URL bar empty, label 'Home', remoteType null, system principal; Home -> example.com -> Back returns to Home; BrowserCommands.home() loads it.
- [proven] Custom image background from a file, driven by settings
  evidence: homepage.js 'C' line + out/home/home-custom-image.png: path with space, 'é' and '#' loads; the open Home page followed the pref change in 13 ms.
- [proven] Video background from a file
  evidence: homepage.js 'D' lines + home-video-1.png / home-video-2.png: a WebM plays (currentTime 0.0 -> 2.04). Also found: the video keeps advancing while the Home tab is in the background (visibilityState hidden), so Home must pause it itself.
- [proven] nsIFilePicker opens the native dialog and returns
  evidence: homepage.js 'E1': the dialog window was found by title with FindWindowW (js-ctypes) and the callback returned cancel after WM_CLOSE.
- [partial] Choosing a file in the native dialog end to end
  evidence: Not automated (no native input). 'E2' ran the same consumer code with a stand-in picker factory returning the test image: settings became kind=image and the Home page showed it. fp.init(window.browsingContext, title, mode) signature confirmed.
- [proven] Home as a layer in the chrome document (the Electron approach)
  evidence: homepage.js 'F' + out/home/home-layer-variant.png: renders, but the tab under it is about:blank and its thumbnail is a blank white page (luma 1, 1 colour). Rejected in favour of the page.
- [partial] drawSnapshot of in-process pages (Home) with rect = null
  evidence: probe-home-snapshot.js + out/probe-home/probe-home-snapshots.png: null rect returns a 640x400 bitmap (window-sized, page drawn small) in 56-60 ms; an explicit DOMRect(0,0,w,h) returns the correct 632x353 in 4 ms. Use an explicit rect for non-remote browsers.
- [proven] A Home tab comes back through session restore
  evidence: session.js RUN 2: 'restored Home tab selected -> page ready true document about:vitre-home'; probe-home-restore.js: a pending restored Home tab loads once the about module is registered.
- [unverified] Home restored as the SELECTED tab at startup when registration happens late
  evidence: Could not be produced: the harness always passes a URL, which takes the selection, so the restored Home tab stayed pending (out/probe-restore2/log.txt). Registering from config.js at AutoConfig time is the recommendation but was not run.
- [proven] Settings in vitre.* prefs covering every field of the Settings interface
  evidence: settings.js lines 1 and 3: defaults equal DEFAULT_SETTINGS; set() of all fields (17 prefs, homeBackground split in two, rebind as JSON) takes 0.9 ms and round-trips exactly, including non-ASCII paths.
- [proven] Change broadcast to every window
  evidence: settings.js lines 2-4: one coalesced listener call per set(), delivered 1.0 ms after set() starts; a second browser window logged '[window 2] heard change' for every change and updated its attribute; a direct pref write (as from about:config) was heard too; invalid values fall back to defaults.
- [proven] Settings persist across a restart without an explicit save
  evidence: settings.js line 5: 17 vitre.* lines already in prefs.js with no savePrefFile call; out/settings2/log.txt 'RUN 2 restored from prefs.js equals what run 1 stored: true'.
- [proven] JSON-file alternative (IOUtils.writeJSON)
  evidence: settings.js line 6: write 0.97 ms, read 0.10 ms, observer-service broadcast works. Not recommended: async at startup, and it needs its own defaults, validation and broadcast.
- [proven] History recorded by Places with no Vitre code
  evidence: session.js line 1: PlacesUtils.history.fetch returns title, 1 visit, frecency for example.com and Wikipedia; SQL over promiseDBConnection lists them; data: pages are not recorded.
- [proven] Reopen closed tab with its history
  evidence: session.js line 2: closed count 0 -> 1 with 2 history entries; SessionStore.undoCloseTab(window, 0) restores https://example.org/ with canGoBack true.
- [proven] Session restore across a restart
  evidence: session.js run 1 quits with eAttemptQuit ('sessionstore-final-state-write-complete' logged); RUN 2 with browser.startup.page=3: all tabs back with URL, title, lastAccessed and custom values, lazy until selected, then load.
- [proven] Clear browsing data with time ranges
  evidence: session.js line 3: Sanitizer.sanitize([...], {ignoreTimespan:false, range: getClearRange(TIMESPAN_HOUR)}) removed the fresh visit and cookie and kept a visit dated two days ago (69-75 ms); without options it removed everything (29-36 ms). It also emptied the closed-tab list (1 -> 0); open tabs untouched. Services.clearData.deleteDataInTimeRange also ran.
- [unverified] undoCloseWindow and Sanitizer.showUI
  evidence: Present in the 157 source (SessionStore.undoCloseWindow, Sanitizer.showUI) but not run.

## Recipe
All paths are under gecko\spikes\switcher\.

**1. Thumbnails** (thumbs.js)
- Primitive: `browser.browsingContext.currentWindowGlobal.drawSnapshot(rect, scale, "white")` returns an `ImageBitmap`. `rect = null` is the tab's current viewport; a `DOMRect` is in document coordinates.
- Call `browser.getBoundingClientRect()` first (layout flush; a 0x0 browser makes it throw).
- Remote tabs: pass `null`. In-process pages (Home, parent `about:` pages): pass `new DOMRect(contentWindow.scrollX, contentWindow.scrollY, w, h)`; `null` gives a window-sized, wrong bitmap.
- On switcher open: `await Promise.all(gBrowser.tabs.map(snapshot))` at `0.75 * devicePixelRatio`, width capped at 1920 px. Background and minimized tabs capture fine, so no periodic capture timers are needed.
- Discarded or lazy tabs have `browser.browsingContext == null` and the `pending` attribute: serve them from a `Map<tab, ImageBitmap>` cache. Refresh the cache on `TabSelect` (`event.detail.previousTab` immediately, the new tab about 300 ms later) and on load stop via `gBrowser.addTabsProgressListener({onStateChange})` with `STATE_STOP | STATE_IS_NETWORK` and `webProgress.isTopLevel`. Delete on `TabClose`; `close()` replaced bitmaps.
- Across restarts: `OffscreenCanvas.convertToBlob({type:"image/jpeg", quality:0.8})`, `IOUtils.write` to `<profile>/vitre-thumbs/<uuid>.jpg`, and `SessionStore.setCustomTabValue(tab, "vitre-thumb", uuid)`; read back with `getCustomTabValue` after restore.
- Skip `PageThumbs.*`; it only wraps `drawSnapshot`.

**2. Live deck** (live.js)
- Panel element: `document.getElementById(tab.linkedPanel)`. Style it with `transform`, `border-radius`, `overflow: clip`, `box-shadow`, `transition`.
- To show non-selected tabs live, load once: `windowUtils.loadSheetUsingURIString("data:text/css,…", windowUtils.AGENT_SHEET)` with the rule `#tabbrowser-tabpanels > [vitre-live] { -moz-subtree-hidden-only-visually: 0 !important; visibility: inherit !important; }`. The property is refused in inline styles.
- Then `panel.setAttribute("vitre-live", "true")` and `tab.linkedBrowser.docShellIsActive = true`. Undo both afterwards (`docShellIsActive = false` for non-selected tabs).
- All panels are `position: absolute` in one box, so place them with translate, scale and z-index. Input maps through the transform, so cover the panels or set `pointer-events: none`.

**3. MRU and Ctrl+Tab** (mru.js)
- MRU: sort by `tab.lastAccessed` at startup and after `SSWindowRestored`, then maintain from `TabSelect` / `TabOpen` / `TabClose` on `gBrowser.tabContainer`.
- Takeover:
  - `Services.prefs.getDefaultBranch("").setBoolPref("browser.ctrlTab.sortByRecentlyUsed", false)` then `Services.prefs.lockPref(...)`.
  - `gBrowser.tabbox.handleCtrlTab = false`.
  - `window.addEventListener("keydown", h, true)` where `h` tests `ShortcutUtils.getSystemActionForEvent(e) === ShortcutUtils.CYCLE_TABS` (resource://gre/modules/ShortcutUtils.sys.mjs), then `preventDefault()` + `stopPropagation()`.
  - Commit on capture `keyup` with `e.key === "Control"`.
- Ctrl+PageUp/PageDown stay with Firefox's tabbox.
- For tests, synthesize keys in-process with `chrome://remote/content/external/EventUtils.js` (lib.js `vx.EU()`).

**4. Theme sampling** (theme.js, actors/)
- Sample: `drawSnapshot(null, 1/16, "white")`, draw into an `OffscreenCanvas` (`willReadFrequently`), mean Rec. 709 luma of the top `barHeight/16` rows; above 0.56 is light, else dark; toggle a class on the root element.
- Keep a per-browser cache so `TabSelect` applies the theme at once, then re-sample.
- Triggers: `TabSelect`; load stop from the tabs progress listener; and the `VitrePage` JSWindowActor child (events `scroll` with `capture: true`, `DOMContentLoaded`, `pageshow`), which sends one message per animation frame at most. The parent debounces scroll by 80 ms and drops stale results with a sequence number.
- Register with `ChromeUtils.registerWindowActor("VitrePage", { parent: {esModuleURI}, child: {esModuleURI, events}, messageManagerGroups: ["browsers"], allFrames: false, safeForUntrustedWebProcess: true })`.
- The actor name fixes the export names (`VitrePageParent`, `VitrePageChild`).
- The child module must be readable by sandboxed content processes: the application directory, or `<profile>/chrome/` plus a `resource://` substitution in development (lib.js `mountForContent`).
- In the parent actor use `this.browsingContext.top.embedderElement.documentGlobal`; `ownerGlobal` is undefined in 157.

**5. Home** (homepage.js, home/, modules/VitreHomeAbout.sys.mjs, modules/VitreWallpaper.sys.mjs)
- Wallpaper path: `Cc["@mozilla.org/windows-registry-key;1"]`, `open(ROOT_KEY_CURRENT_USER, "Control Panel\\Desktop", ACCESS_READ)`, `readStringValue("WallPaper")`. Fallback: `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper`.
- File URL: `Services.io.newFileURI(nsIFile).spec`.
- Luma: `IOUtils.read(path)`, `createImageBitmap(new Blob([bytes]), {resizeWidth:64, resizeHeight:36})`, `getImageData`; above 0.62 is light, else clear.
- Registration:
  - `Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup).registerChrome(manifestURI, [["content","vitre-home","home/"]])`.
  - `Components.manager.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(classID, desc, "@mozilla.org/network/protocol/about;1?what=vitre-home", factory)`.
  - The about module's `newChannel` returns `Services.io.newChannelFromURIWithLoadInfo(chromeURI, loadInfo)` with `originalURI = uri` and `owner =` system principal; `getURIFlags` returns `ALLOW_SCRIPT | IS_SECURE_CHROME_UI`.
  - `AboutNewTab.newTabURL = "about:vitre-home"` (resource:///modules/AboutNewTab.sys.mjs). It is in memory only, so set it at every startup.
  - `browser.startup.homepage` on the default branch.
- Do all of this once per process, as early as possible.
- The page uses external script and CSS files plus a CSP meta. It imports `VitreSettings`, listens with `onChange`, and must pause its video on `visibilitychange`.
- Cache a screen-sized copy of the wallpaper and its luma (the 5K decode costs about 160 ms per open).
- Chrome detects home mode with `gBrowser.selectedBrowser.currentURI.spec === "about:vitre-home"` and can read `browser.contentDocument` directly.
- File picker: `fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker)`; `fp.init(window.browsingContext, title, Ci.nsIFilePicker.modeOpen)`; `fp.appendFilters(filterImages | filterVideo)`; `fp.open(result => …)`; use `fp.file.path` when `result === returnOK`.

**6. Settings** (modules/VitreSettings.sys.mjs)
- One pref per field under `vitre.`: bool, int or string; `homeBackground` becomes `.kind` and `.path`; `rebind` is a JSON string.
- Defaults via `Services.prefs.getDefaultBranch("vitre.")`. One observer: `Services.prefs.addObserver("vitre.", obj)`. Coalesce notifications in a microtask and call the window listeners; `onChange` returns an unsubscribe to call on `unload`.
- Reset is `clearUserPref`. Empty `downloadsFolder` resolves to `Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path`. Validate enums on read.

**7. Session, history, clearing** (session.js)
- History: Places records it; read with `PlacesUtils.history.fetch` or `PlacesUtils.promiseDBConnection()`.
- Closed tabs: `SessionStore.getClosedTabCountForWindow(window)`, `getClosedTabDataForWindow(window)`, `undoCloseTab(window, 0)`.
- Restore: `browser.startup.page = 3`; wait on `SessionStore.promiseAllWindowsRestored`.
- Clear: `Sanitizer.sanitize(["history","cookies","cache","offlineApps","formdata","downloads","sessions","siteSettings"], { ignoreTimespan: false, range: Sanitizer.getClearRange(Sanitizer.TIMESPAN_HOUR) })` from resource:///modules/Sanitizer.sys.mjs. Other spans: `TIMESPAN_5MIN`, `_2HOURS`, `_4HOURS`, `_TODAY`, `_24HOURS`; omit the options for everything.
- Clearing history also empties the reopen-closed-tab list.

**Harness gotchas**
- Do not run two `--name` values in parallel where one is a prefix of the other; run.py matches processes by profile-name substring.
- XUL popups are not in the PrintWindow capture.
- `tab._tPos` does not exist in 157; use `tab.elementIndex`.
- For a session-restore test, quit with `eAttemptQuit` and write `@@quit` on `sessionstore-final-state-write-complete` (modules/SpikeQuit.sys.mjs).

## Compromises
- **FINDINGS.md is missing.** The task asked for it, but the harness blocked writing a findings .md file from a subagent. Its content is this output; someone with write access can paste it into gecko/spikes/switcher/FINDINGS.md.
- **Discarded and unloaded tabs cannot be captured.** Their cards come from Vitre's own cache (memory, plus JPEG on disk keyed through SessionStore custom tab values).
- **Content-process code cannot be loaded from the project folder.** In development the actor modules are copied to `<profile>/chrome/` at startup; a packaged build should keep them in the application directory (not tested).
- **Home runs in the parent process with the system principal**, as a tab page rather than a chrome layer. Opening it costs 220-365 ms with a 5K wallpaper until a downscaled copy is cached (13-14 ms with a 1600x900 image).
- **Home's video keeps decoding in a background tab** unless the page pauses it.
- **In-process pages need an explicit snapshot rect**; the null-rect shortcut only works for remote tabs.
- **The native file dialog was only opened and cancelled.** Picking a file was exercised with a stand-in picker.
- **`searchEngine` is stored as a plain Vitre pref.** Whether it should map to Firefox's own default-engine setting was not looked at.
- **Test overlays were drawn over Firefox's stock toolbar.** Hiding Firefox's interface was not combined with these spikes.

## Risks
1. **Home restored as the selected tab at startup** needs `about:vitre-home` registered before session restore loads it. The spike registers per window at `browser-delayed-startup-finished`. Registering from config.js at AutoConfig time is the recommendation and is unverified.
2. **The packaged location for content-process modules** (application directory or omni.ja) is unverified; only `<profile>/chrome/` was run.
3. **Firefox internals move between versions.** Already seen in 157:
   - `ownerGlobal` became `documentGlobal`.
   - `tab._tPos` was removed.
   - Actors need `safeForUntrustedWebProcess`.
   - `nsIFilePicker.init` takes a BrowsingContext.
   - SessionStore moved to `moz-src:`.
   The live deck depends on `-moz-subtree-hidden-only-visually` and the tab panel structure; the Ctrl+Tab takeover depends on `tabbox.handleCtrlTab` and `browser.ctrlTab.sortByRecentlyUsed`. Re-run live.js and mru.js on every Firefox update.
4. **Home is a system-principal page.** A bug there is a browser-level bug. Keep it static with a strict CSP and no outside content.
5. **Timings come from one machine at devicePixelRatio 1**, at 1280x800 and 1920x1080. At 4K / 200% pixel counts are four times larger; twelve 1428x740 bitmaps are already about 50 MB. Cap the width and close bitmaps.
6. **A busy content process answers `drawSnapshot` late.** The slowest snapshot seen was 50 ms. Show the cached thumbnail first and swap in the fresh one.
7. **Wallpaper source.** The registry path is tried first, as in Electron. With a Windows slideshow or solid colour it can be stale or empty; only a static wallpaper was run.
8. **Clearing history also wipes the reopen-closed-tab list.** The clear-data UI should say so or expect it.
9. **run.py matches processes by profile-name substring.** Parallel runs with prefix-related names capture and kill each other's windows; this happened once here and the runs were redone alone.

## Files
gecko\spikes\switcher\lib.js
gecko\spikes\switcher\thumbs.js
gecko\spikes\switcher\live.js
gecko\spikes\switcher\mru.js
gecko\spikes\switcher\theme.js
gecko\spikes\switcher\homepage.js
gecko\spikes\switcher\settings.js
gecko\spikes\switcher\session.js
gecko\spikes\switcher\probe-actor.js
gecko\spikes\switcher\probe-home-snapshot.js
gecko\spikes\switcher\probe-home-restore.js
gecko\spikes\switcher\modules\VitreSettings.sys.mjs
gecko\spikes\switcher\modules\VitreWallpaper.sys.mjs
gecko\spikes\switcher\modules\VitreHomeAbout.sys.mjs
gecko\spikes\switcher\modules\SpikeQuit.sys.mjs
gecko\spikes\switcher\actors\VitrePageParent.sys.mjs
gecko\spikes\switcher\actors\VitrePageChild.sys.mjs
gecko\spikes\switcher\home\home.html
gecko\spikes\switcher\home\home.css
gecko\spikes\switcher\home\home-page.js
gecko\spikes\switcher\out\thumbs\thumbs-grid.png
gecko\spikes\switcher\out\thumbs\log.txt
gecko\spikes\switcher\out\thumbs-big\thumbs-grid.png
gecko\spikes\switcher\out\thumbs-big\log.txt
gecko\spikes\switcher\out\live\live-scaled-selected.png
gecko\spikes\switcher\out\live\live-three-panels.png
gecko\spikes\switcher\out\live\log.txt
gecko\spikes\switcher\out\mru\mru-vitre-switcher-held.png
gecko\spikes\switcher\out\mru\log.txt
gecko\spikes\switcher\out\theme\theme-white.png
gecko\spikes\switcher\out\theme\theme-dark.png
gecko\spikes\switcher\out\theme\theme-mixed-scrolled.png
gecko\spikes\switcher\out\theme\log.txt
gecko\spikes\switcher\out\home\home-wallpaper.png
gecko\spikes\switcher\out\home\home-custom-image.png
gecko\spikes\switcher\out\home\home-video-2.png
gecko\spikes\switcher\out\home\home-layer-variant.png
gecko\spikes\switcher\out\home\log.txt
gecko\spikes\switcher\out\probe-home\probe-home-snapshots.png
gecko\spikes\switcher\out\probe-actor\log.txt
gecko\spikes\switcher\out\probe-restore2\log.txt
gecko\spikes\switcher\out\settings\log.txt
gecko\spikes\switcher\out\settings2\log.txt
gecko\spikes\switcher\out\session\log.txt
gecko\spikes\switcher\out\session2\log.txt
gecko\spikes\switcher\out\session2\session-restored-thumbs.png
gecko\spikes\switcher\out\session2\session-restored-home.png

# Independent verification

## Overall
The spike holds up: every claim marked proven reproduced on a fresh run under my own profile names, and I viewed the screenshots. Nothing a product decision rests on turned out false.

**Two numbers do not hold as stated**
- Home's "220-365 ms" open time ranged from 110 ms to 1147 ms.
- The "82 ms after a scroll" theme switch is only true for a single scroll jump; during continuous scrolling the bar does not change until scrolling stops (1.5-1.8 s in my test).

**What changed for the better**
- **Discarded tabs:** they can be captured at the moment of discard by wrapping `gBrowser.discardBrowser` (8 of 8, including Firefox's own low-memory unloader).
- **Actor modules:** they load from the application directory in sandboxed content processes, so the packaged layout works.
- **File picker:** the real native dialog was driven end to end.
- **Restored Home tab:** a selected Home tab restores correctly if registration happens synchronously at the top of the boot script; no AutoConfig-time hook is needed.
- **Session and clearing:** `undoCloseWindow` and `Sanitizer.showUI` both work.
- **Ctrl+Tab:** the capture listener alone is enough; the pref lock and `handleCtrlTab = false` are optional.

**What an implementer would trip on**
- Thumbnail scale must be multiplied by `browser.fullZoom`.
- The bitmap cache is about 4 MB per tab at 0.75 scale on 1080p and needs a cap.
- A tab switch during the live deck blanks the outgoing panel after about 300 ms unless it is re-activated.
- Script-driven colour changes are missed by the theme triggers unless a paint trigger is added.

**Not verified**
- Hardware-decoded video and WebGL in thumbnails.
- Ctrl released while another application has focus.
- Keyboard Lock pages.
- Claim 15 (a picture of Firefox's own panel) stays partial and does not matter.

**VERIFY.md was not written.** This subagent's instructions forbid writing report .md files, the same block the spike hit for FINDINGS.md, so the notes are this output. The evidence is in `gecko\spikes\switcher\verify\`: reruns of the spike scripts in `out\<spike name>\`, and my own scripts `v-*.js` plus `run_v.py`, with their logs and screenshots in `out\v-*\`. The verify folder holds copies of the spike's `lib.js`, `modules/`, `home/` and `actors/` so the scripts run on their own; `home/home-page.js` there has the video pause added. I deleted my throwaway profiles and the scratch runtime copy; nothing outside the verify folder was changed.

## Confirmed
- Claims 1-3 (drawSnapshot of selected and never-shown background tabs, speed at 12 tabs): reproduced. verify/out/thumbs/log.txt: 12 background tabs 632x353, Promise.all 10.5 ms at 0.5 scale, 18.7 ms at 0.75 (1280x800). verify/out/thumbs-big/log.txt (1920x1080, 8 real sites): sequential 116 ms, Promise.all 51 ms at 0.5, 60 ms at 0.75. All inside the reported ranges. Screenshots thumbs-grid.png in both folders viewed: 12 real, distinct thumbnails.
- Claim 2 holds under harder cases the spike did not run (verify/v-thumbs.js, out/v-thumbs/log.txt + v-thumbs-overlay.png viewed): a cross-origin out-of-process iframe is painted in a background tab's snapshot; a background tab whose DOM keeps changing gives a current picture each time; a 2D canvas is painted; tabs of a second window (selected, background, and with that window minimized) all capture; six snapshots taken during a cross-process navigation all resolved. <video> frames are painted too, selected and background (verify/v-video.js, software VP8 only).
- Thumbnails scale past 12 tabs (verify/v-many.js, out/v-many/log.txt): 40 tabs at 1920x1080 take 72-123 ms at 0.5 scale and 102-154 ms at 0.75; first card after 6-70 ms; longest chrome-thread frame gap while they were in flight 12 ms.
- HiDPI (the spike ran devicePixelRatio 1 only): with layout.css.devPixelsPerPx=1.5 the `scale * devicePixelRatio` rule gives the same device-pixel sizes (632x342 for an 843x456 CSS browser) and a sharp card (out/v-thumbs-hidpi/log.txt, v-thumbs-wiki-card.png viewed).
- Claim 4 (minimized window): reproduced, windowState 2, content returned in 1-8 ms (thumbs logs, 'D2' lines; also for a second minimized window in v-thumbs.js).
- Claim 5 (PageThumbs helpers work but only wrap drawSnapshot): reproduced, 3.6-6.7 ms small / 22-24 ms big ('C' lines); gre/modules/PageThumbs.sys.mjs calls aBrowser.drawSnapshot.
- Claim 6 as literally stated (a tab cannot be captured AFTER it is discarded or while lazy): reproduced; browsingContext null, linkedPanel null, moz-page-thumb empty ('E' lines). See 'improved' for capture at discard time.
- Claims 7-9 (cache refresh on TabSelect/load stop, JPEG thumbnails surviving a restart via SessionStore custom tab values, 12-cell grid overlay): reproduced. 'F' line leave 4.9-34 ms / enter 0.9-11 ms / load 0.8-2.6 ms; verify/out/session log: JPEG 7.9-49 KB, encode 0.7-0.9 ms, write 0.6-1.0 ms; out/session2/session-restored-thumbs.png viewed (four pending tabs show thumbnails read from disk).
- Claims 10-12 (live scaled panel, several live panels, input mapping): reproduced. verify/out/live screenshots viewed (clock 2.0, 4.2, 5.5 across captures; three panels animating; click arrives at 200,201). Also holds for real sites kept live for 6 s (verify/v-live.js, v-live-4-real-6s.png viewed), with one gotcha listed under corrections.
- Claim 13 (MRU): reproduced, own list equals lastAccessed order [2,4,1,3,5]. After a restart tab.lastAccessed is exactly the saved value (verify/v-restore.js: saved 1790945426180, restored 1790945426180).
- Claim 14 (Ctrl+Tab takeover): reproduced and strengthened by verify/v-keys.js. Positive control: with nobody handling it the page DOES receive 'Ctrl+Tab'; with Vitre's capture listener it does not. Works with focus in the URL bar, in a page <input>, in a second window, with key repeat, and for a native key event (windowUtils.sendNativeKeyEvent reached the listener, page saw only Control). Removing the listener restores Firefox's behaviour.
- Claims 16-18 (theme sampling over white and dark pages, triggers, cost): reproduced. verify/out/theme: white 1.000 -> theme-light, dark 0.065 -> theme-dark, mixed page flips on scroll (three screenshots viewed); pageshow 9 ms, single scroll jump 82 ms; cost medians 0.24 ms simple page / 2.3 ms Wikipedia (max 3.2 ms, reported 2.8). Also correct per window in a second window, after a bfcache Back (pageshow persisted, 10-14 ms), and on real sites (Wikipedia light, GitHub dark, mozilla.org light because its top strip is white; v-theme-real-site.png viewed).
- Claims 19-20 (runtime-registered JSWindowActor works from <profile>/chrome; child module in the project folder fails under the content sandbox): reproduced (verify/out/probe-actor/log.txt). verify/v-actor.js shows the cause directly: a web content process gets NS_ERROR_FILE_ACCESS_DENIED on the project folder and on the profile root, but can read <profile>/chrome and the application directory.
- Claims 22-23, 25-27 (wallpaper path from registry and TranscodedWallpaper, luma 0.728 in 55-79 ms, custom image via settings in 14 ms, WebM video background, native file dialog opens and cancels): reproduced (verify/out/home/log.txt; home-wallpaper.png, home-custom-image.png, home-video-2.png viewed).
- Claim 24 capability (about:vitre-home as new-tab and home page, parent process, system principal, empty URL bar, label 'Home', Back returns to Home, BrowserCommands.home loads it): reproduced. Additionally a new window opens Home and Ctrl+T works there, and web content cannot reach it: location.href and window.open throw 'Access to about:vitre-home from script denied', iframes to about:vitre-home and chrome://vitre-home stay about:blank (verify/v-home.js H2, H3). The timing figure is not confirmed, see 'refuted'.
- Claim 29 facts (chrome-layer Home renders; drawSnapshot of the tab under it is a blank white page) and claim 30 (null rect on an in-process page returns a window-sized bitmap, 640x400 or 80x50 at 1/16; an explicit DOMRect returns the right size): reproduced (homepage.js 'F' line; v-home.js H6).
- Claim 31 (a pending Home tab restores once registered): reproduced (out/session2 log: 'restored Home tab selected -> page ready true').
- Claims 33-34, 36 (17 vitre.* prefs cover all 16 fields of Settings in app/src/shared/settings.ts, exact round trip incl. non-ASCII paths, one coalesced notification per set() delivered in 0.7 ms, second window hears every change, invalid values fall back, JSON alternative 0.94 ms write): reproduced (verify/out/settings/log.txt).
- Claim 35 conclusion (settings persist without an explicit save): true, but the spike's evidence did not show it (its run 1 called savePrefFile before quitting). Proven properly by verify/v-settings-kill.js: set(), no savePrefFile, process hard-killed with taskkill /F, next start reads all values back.
- Claims 37-40 (Places history for free, undoCloseTab with history, session restore across restart, Sanitizer with time range keeps a two-day-old visit and clears the closed-tab list): reproduced (verify/out/session and session2 logs; last-hour sanitize 117 ms, everything 45 ms).

## Refuted
- Timing figure only (claim 24 and compromises): 'Ctrl+T opens Home in 220-365 ms'.
  why: Not a stable number. My rerun of the same script (homepage.js) measured 1146.7 ms for the first open (verify/out/home/log.txt, 'B Ctrl+T -> Home ready true in 1146.7 ms', other spikes were running on the machine). Six consecutive opens in verify/v-home.js measured 208, 142, 128, 120, 110, 110 ms to wallpaper-ready and 38-56 ms to DOM ready. The capability itself is confirmed; treat the first open as possibly slow and cache a screen-sized wallpaper copy as the spike already suggests.
- Summary and claim 17 as a general statement: 'the bar class switches about 82 ms after a scroll'.
  why: True only for a single scroll jump. The recipe's debounce (clearTimeout on every scroll message, 80 ms) never fires while scrolling continues. verify/v-theme.js T3: scrolling 40 px per frame for about 1.5 s across a light/dark boundary reached after about 280 ms, the class changed 1550 ms and 1771 ms after scrolling started (two runs), i.e. only once scrolling stopped. A leading+trailing throttle at 80 ms changed it after 344 ms with 19 samples. The Electron build has the same debounce, so this is parity, not a regression, but the number should not be read as a latency bound.

## Improved
- Claim 6 (not-possible): thumbnails of discarded tabs
  finding: A tab cannot be captured after discard, but it can be captured AT discard. Every discard goes through gBrowser.discardBrowser(tab, force) (Tabbrowser.sys.mjs:3400; callers: TabUnloader, ext-tabs discard, about:processes, privacy prefs). Wrapping that method on the gBrowser instance and starting drawSnapshot in the same tick, before calling the original, resolved 8 of 8 times with real content in 7-85 ms, including five real sites, three discards in one tick, and two discards made by Firefox's own TabUnloader.unloadLeastRecentlyUsedTab (verify/v-discard.js, out/v-discard/log.txt, v-discard-thumbs.png viewed). The 'TabBrowserDiscarded' event fires afterwards (v-many.js M2). Lazy tabs that were never loaded since restore still need the on-disk JPEG; that part stays not-possible.
- Claim 20 (not-possible): actor child module from the project folder
  finding: Still fails with the sandbox on (reproduced). Two ways around it for development, both run: (1) start Firefox with the environment variable MOZ_DISABLE_CONTENT_SANDBOX=1: the module then loads straight from resource://vitre-boot/actors/ and ping answers (out/v-actor-nosandbox/log.txt); security.sandbox.content.level=0 does not do this on release builds. (2) Use no file at all: window.messageManager.loadFrameScript('data:application/javascript,...', true) delivered scroll and pageshow messages from the current tab and from a tab opened later in a webIsolated process, 1-7 ms after the content event (verify/v-actor.js step 3). The spike's copy to <profile>/chrome remains valid.
- Claim 21 (unverified): actor modules in the application directory
  finding: Now proven. Against a scratch copy of the runtime with <appdir>/vitre-actors/VitrePage{Parent,Child}.sys.mjs added and a resource:// substitution to it, the child module loaded in both a 'web' and a 'webIsolated=https://example.com' process with the sandbox on; ping answered and DOMContentLoaded/pageshow/scroll events arrived (verify/v-appdir.js via verify/run_v.py with VX_FIREFOX, out/v-appdir/log.txt). gecko/runtime itself was not touched; the scratch copy was deleted afterwards (the script header says how to recreate it).
- Claim 28 (partial): choosing a file in the real native dialog
  finding: Now proven end to end without OS focus. verify/v-home.js H4 opens the real nsIFilePicker (the dialog lives in a separate utility process, pid 30404 vs parent 41912), finds the filename Edit (ComboBoxEx32 > ComboBox > Edit), sends WM_SETTEXT with the path and WM_COMMAND IDOK. The callback returned returnOK with fp.file.path identical to the path sent (name contains a space, 'é' and '#'), settings became kind=image and the open Home page showed the picked image (v-home-picked-in-real-dialog.png viewed).
- Claim 32 (unverified): Home restored as the SELECTED tab
  finding: Produced with verify/run_v.py (starts Firefox with no URL argument). Late registration (after windows restored): the selected Home tab shows Firefox's error page 'Hmm. That address doesn't look right', label 'Problem loading page', in a privilegedabout process; registering does not heal it by itself, browser.reload() does in 191 ms (out/v-restore2, before/after screenshots viewed). Registration at AutoConfig time is NOT needed: registering synchronously at the top of the boot script is early enough. SessionStore starts the first window's restore only in a promise continuation after that window's 'browser-delayed-startup-finished' (SessionStore.sys.mjs #onBeforeBrowserWindowShown, lines 1764-1810), and the log shows only a blank tab at boot-script time. With the synchronous registration the selected Home tab restored correctly with no reload (out/v-restore2b/log.txt and screenshot viewed).
- Claim 41 (unverified): undoCloseWindow and Sanitizer.showUI
  finding: Both run in verify/v-restore.js run 1. SessionStore.undoCloseWindow(0) reopened a closed window with its tabs (closed-window count 0 -> 1 -> 0, example.org selected). Sanitizer.showUI(window) opens Firefox's in-window dialog chrome://browser/content/sanitize_v2.xhtml through gDialogBox ('Clear browsing data and cookies' with a time-range menu; v-sanitizer-showui.png viewed).
- Claim 29: the reason for rejecting the chrome-layer Home
  finding: The blank thumbnail is not inherent to the layer variant. window.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(layer rect), 0.5, 'white') on the chrome document returns the layer's picture, 632x353 in 2-3 ms after a 54 ms first call (verify/v-home.js H5, v-home-layer-thumbnail.png viewed). The page-in-a-tab recommendation still stands on other grounds that were run: it restores through SessionStore, has Back/Forward history, and opens in new windows without extra code.
- Claim 17: resampling triggers
  finding: Two gaps measured in verify/v-theme.js. (1) A page that changes colour by script with no scroll and no load is never resampled by the spike's triggers: class stayed theme-light for 1.2 s while a manual sample read luma 0.065. Adding MozAfterPaint (capture: true) to the actor's events, throttled to one message per 250 ms in the child, switched the class 2 ms after the change on a quiet page and cost 7 samples in 2 s on a page with a running animation (verify/actors2/VitreProbeChild.sys.mjs). (2) Continuous scrolling: see 'refuted'; a leading+trailing throttle fixes it.
- Claim 11: several live panels
  finding: Confirmed with real sites for 6 s, but a tab switch while panels are live blanks the outgoing tab: Firefox's tab switcher sets it inactive and drops its layers 303 ms after the switch (verify/v-live.js, v-live-after-switch.png viewed: the Wikipedia panel is empty). Setting tab.linkedBrowser.docShellIsActive = true again restores it (v-live-after-switch-reasserted.png viewed). Clean-up as the recipe describes leaves no tab active that should not be, and an ordinary switch works afterwards.
- Claim 35: persistence timing
  finding: prefs.js is written by Firefox on its own between 250 ms and 500 ms after a pref write (v-settings-kill1 log: 0 lines at 250 ms, present at 500 ms; the spike's '17 lines right after set()' was timing luck, my rerun of settings.js showed 0 right after and 17 at 1.5 s). A crash inside that half second loses the change; call Services.prefs.savePrefFile(null) (0.2 ms) after changes that must not be lost.
- Claim 15 (partial): picture of Firefox's own Ctrl+Tab panel
  finding: Still partial. One more route tried: drawSnapshot of the chrome document while the panel was open (state 'open', 8 previews) does not include the popup either (verify/v-panel.js, out/v-panel/v-panel-chrome.png viewed). Not pursued further because Vitre removes this panel. Side result: a chrome-document snapshot does include the selected tab's remote page.

## Recipe corrections
All corrections were run; scripts are in gecko\spikes\switcher\verify\ and logs in verify\out\<name>\log.txt.

**Thumbnails**
- Multiply the scale by the tab's zoom: `drawSnapshot(null, s * devicePixelRatio * browser.fullZoom, "white")`. Without it a tab at 150% gives 421x236 instead of 632x353 and a tab at 67% gives 948x530 (v-zoom.js). Firefox's own tabs.captureTab does `scale * zoom`.
- Do not `await Promise.all` before showing the switcher. Paint from the cache at once and replace cards as snapshots resolve; first card arrives in 6-70 ms, all 40 in about 150 ms.
- Bound the cache. Bitmaps at 0.75 scale on 1920x1080 are about 4 MB per tab (161 MB for 40 tabs; 72 MB at 0.5). Keep full-size bitmaps for the most recent tabs only and JPEG blobs (8-49 KB) for the rest.
- A snapshot taken mid-navigation can be a blank white page (luma 1 seen once in v-thumbs-hidpi). Do not overwrite a good cache entry on TabSelect-leave while `browser.webProgress.isLoadingDocument`.
- Add the discard hook: wrap `gBrowser.discardBrowser` per window, start the snapshot, then call the original (v-discard.js). Listen for `TabBrowserDiscarded` to mark the card as cached.
- The on-disk JPEGs need a clean-up rule (delete on TabClose and sweep files no open or closed tab refers to); the spike has none.
- `drawSnapshot` has a 4th argument `{ resetScrollPosition: true }` for the document top; no need to build DOMRect(0,0,w,h) for that.
- In-process pages with `null` rect: the page is drawn at the right scale in the top-left of a window-sized bitmap (not 'drawn small'); an explicit DOMRect is still the right call.

**Live deck**
- On `TabSelect` while panels are live, set `event.detail.previousTab.linkedBrowser.docShellIsActive = true` again (Firefox drops it about 300 ms after the switch), or commit the real tab switch only when the animation ends.

**Ctrl+Tab**
- The capture `keydown` listener with `preventDefault()` + `stopPropagation()` is sufficient on its own. Both Firefox handlers return early on `event.defaultPrevented` (tabbox.js handleEvent, browser-ctrlTab.js onKeyDown). Verified with `handleCtrlTab` left true and with `browser.ctrlTab.sortByRecentlyUsed` set to true: Firefox's panel stayed closed and the selection did not move (v-keys.js A, B). Locking the pref and `handleCtrlTab = false` are optional; if kept, note `handleCtrlTab` is per window and is rewritten whenever that pref changes.
- Install the listener in every window (the boot script runs per window).
- `keydown` arrives with `e.repeat` while Tab is held; decide whether to step on repeats.
- Commit also on window `deactivate`/blur: if Ctrl is released while another application has focus no keyup arrives (not run, reasoning only).
- Pages using the Keyboard Lock API in fullscreen will no longer receive Ctrl+Tab (not run; follows from preventing it in the parent).

**Theme sampling**
- Use scale `1/16 * browser.fullZoom` so the sampled rows match the bar height at any zoom.
- Replace the pure debounce for scroll with a leading+trailing throttle (80 ms).
- Add a throttled `MozAfterPaint: { capture: true }` event to the actor so script-driven colour changes are seen.
- `pageshow` also covers bfcache Back (event.persisted), verified.
- For the Home tab, read the page's own luma instead of snapshotting: the first in-process snapshot with the 5K wallpaper costs 40-54 ms.

**Actors**
- Production: put the modules in the application directory; verified to load in sandboxed web processes. Development: either the spike's copy to `<profile>/chrome`, or `MOZ_DISABLE_CONTENT_SANDBOX=1`, or a data: frame script on `window.messageManager` with `allowDelayedLoad = true`.

**Home**
- Call `VitreHomeAbout.register()` synchronously as the first statements of the boot script, before any `await`. That is early enough for a restored, selected Home tab; nothing at AutoConfig time is required. As a safety net, after registering, reload any non-pending tab whose `currentURI.spec` is `about:vitre-home` but whose document is not Home.
- The spike's probe-home-restore.js logged 'at boot-script time' after `await spike.resize()`, 400 ms later; at true boot-script time the session has not been restored yet.
- Add the video pause the spike only described: `document.addEventListener('visibilitychange', () => document.hidden ? video.pause() : video.play())`; verified (currentTime frozen in a background tab, resumes in front; v-home.js H7, verify/home/home-page.js).
- The file picker dialog runs in a separate utility process in 157; nothing changes for the caller.
- `chan.owner = system principal` in newChannel is redundant for a chrome:// target (harmless).

**Settings**
- Call `Services.prefs.savePrefFile(null)` after a settings write if losing the last half second on a crash matters.

**Harness**
- run.py turns numeric `--pref` values into number prefs, so string prefs with numeric content (layout.css.devPixelsPerPx) cannot be set from the command line; set them in the boot script.
- For restart tests where the restored session must keep its own selected tab, use verify/run_v.py with `--url vitre:none`.
- Sanity keys in key tests must not be Firefox shortcuts (Ctrl+B opened the bookmarks sidebar and stole focus in my first run).