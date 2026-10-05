# Spike result: shell

Verdict: works-with-compromises

## Summary
Vitre's shell works inside Firefox 157's stock browser.xhtml: Firefox's interface is hidden, pages fill the whole window, and a floating pill + circles + plus bar driven only by gBrowser sits above the page, with a window-control capsule and no native caption. All six areas were run in the runtime and checked in screenshots and logs under gecko\spikes\shell\out.

FINDINGS.md was NOT written: the Write tool refused it ("Subagents should return findings as text, not write report files"), so the findings are in this output instead. The spike scripts and evidence are all in place and runnable (`bash spikes/shell/run_all.sh` from gecko\).

What was proven:
- **Hiding the chrome:** `#browser` fills the window (browser rect 0,0,1264,792 in a 1280x800 window), and gBrowser, session restore, crash pages and full screen keep working.
- **Popups:** without help, the app menu and extension popups do not open at all and permission doorhangers land at the window's top-left corner. With a small anchor router they hang 8 px under the bar: site panels left-aligned to the pill, the app menu right-aligned to the + circle. Page select dropdowns, autocomplete and context menus were never affected.
- **Window behaviour:** WM_NCHITTEST on the real window returns resize borders on all sides, HTCAPTION on the drag strip, HTCLIENT on bar items and page, and HTMINBUTTON / HTMAXBUTTON / HTCLOSE on Vitre's own buttons. Minimize, maximize, restore and close work through the real non-client message path.
- **Entry point:** Firefox 157 has per-window category hooks; a chrome.manifest with three `category` lines gets VitreShell called for every window (new, private, popup, torn-off, reopened). Registered at AutoConfig time, the first window already has Firefox's toolbars hidden at its first paint.
- **Tab bar:** captured with 1, 3 and 12 tabs over real pages at 1280x800 and 900x700, with real favicons, load progress, select, move, close, pin and new tab.

The compromises:
- A normal window loses the top 18 px of every page to resizing and dragging (Windows keeps the top 8 px for resize, so the design's 10 px strip only gives 2 px of drag).
- The snap-layout flyout, hover highlight on the caption buttons and an actual window drag need a real pointer and are unverified.
- The glass here is a frost stand-in, not the lens.
- Everything rests on Firefox 157 internals, so each runtime update needs the scenarios re-run.

One trap found and fixed: an unconsumed mouseup on a caption button lets Windows run the button's action as well, so a toggling maximize handler fires twice per click. `preventDefault()` on mouseup fixes it.

## Claims
- [proven] Hide Firefox's own chrome (toolbox, tab strip, nav bar, bookmarks bar, menubar, sidebar) without breaking gBrowser
  evidence: boot-basic.js -> out/basic.log: toolbars display none, toolbox 0 px high, browser rect [0,0,1264,792], gBrowser alive; out/basic-1-shell.png, basic-2-shell-900.png. boot-tabs.js exercises open/close/select/move/pin/hide through gBrowser (out/tabs.log).
- [proven] No native caption, including with browser.tabs.inTitlebar=0 and in popup windows
  evidence: CustomTitlebar.allowedBy wrapper in chrome/VitreShell.sys.mjs. out/titlebar0/basic-0-stock.png shows the native caption with the pref off, basic-1-shell.png shows none after the shell installs. Popup window: customtitlebar true and hit-tests TOP/CAPTION/MINBUTTON in out/windows.log.
- [proven] Where panels and doorhangers go once the toolbars are hidden (baseline, no fix)
  evidence: boot-popups.js with vitre.spike.noroute=true -> out/popups-noroute.log: app menu state closed (never opens), extension popup not opened, geolocation doorhanger at rect [-4,-4] (window top-left, popups-noroute-2-doorhanger.png).
- [proven] Sane anchors for PanelUI, permission doorhangers and extension popups
  evidence: out/popups.log: app menu rect [622,60,280,693] anchored to the + circle, doorhanger [362,60,382,182] and extension popup [362,60,270,150] anchored to the active pill; router log lists each reroute. Composite captures popups-1-appmenu.png, popups-2-doorhanger.png, popups-6-extension-popup.png (run_popups.py).
- [proven] Page select dropdown, datalist/autocomplete popup and page context menu still work
  evidence: out/popups.log: ContentSelectDropdownPopup, PopupAutoComplete and contentAreaContextMenu all state open at the expected rects; popups-3-select.png, popups-4-autocomplete.png, popups-5-contextmenu.png. Same result without the router (popups-noroute.log).
- [proven] Firefox notification bars and tab-modal prompts with the chrome hidden
  evidence: Notification bar floated as a 640 px card at [312,68,640,40] without moving the page (popups-7-notification-bar.png); alert() dialog centred in the content area, not under the bar (popups-8-alert.png). Stacked bars and their styling were not designed.
- [proven] Page fills the window with Vitre's bar floating above the remote browser, correct hit-testing
  evidence: boot-window.js -> out/window.log: in-process clicks at (100,30), (1000,34) and 12 px left of the pill reach the page (title becomes 'hit: x,y'); clicks on plus, circle and close badge act on the bar and leave the page untouched. backdrop-filter blur over the page visible in window-1-hover-close.png.
- [partial] Draggable region and resize borders
  evidence: WM_NCHITTEST on the real HWND (out/native.log, out/window.log): y 0-7 HTTOP, strip y 8-17 HTCAPTION, bar items HTCLIENT (with -moz-window-dragging: no-drag), LEFT/RIGHT/BOTTOM and corners just outside the client rect; maximized y 0-7 HTCAPTION. Posted WM_NCLBUTTONDBLCLK on the strip maximizes and restores. An actual mouse drag was not performed (needs real input).
- [proven] Window controls: minimize, maximize/restore, close
  evidence: out/native.log: four posted non-client clicks on HTMAXBUTTON give exactly one sizemode change each; HTMINBUTTON minimizes; HTCLOSE closes a second window. out/window.log: same via DOM clicks, glyph and label switch to Restore; window-3-maximized.png.
- [proven] Unconsumed mouseup on a caption button makes Windows act too (double toggle), fixed by preventDefault on mouseup
  evidence: boot-ncprobe.js -> out/ncprobe.log: raw-none toggles with no JS at all; raw-toggle and raw-maximize show 'maximized' then 'normal' 5 ms later on every click; shipped (preventDefault on mouseup) shows one change per click.
- [partial] Snap layouts on hover of maximize
  evidence: The maximize button returns HTMAXBUTTON (out/window.log, out/native.log) via -moz-default-appearance: -moz-window-button-maximize on an HTML button, which is the hook Windows 11 uses. The flyout itself was not observed: it needs a real pointer.
- [unverified] Hover highlight of the caption buttons under a real pointer
  evidence: Posted WM_NCMOUSEMOVE did not set :hover (out/ncprobe.log, variant hover). Likely an artefact of posted messages, since Firefox's own caption buttons use the same path, but not shown.
- [proven] Maximized and F11 full-screen states, reveal zone, auto-hide
  evidence: out/states.log: F11 via the real key path sets inFullscreen and sizemode fullscreen, bar at pillTop -60 opacity 0; pointer at y 2 reveals it, pointer on the pill keeps it, leaving hides it (states-1-f11.png, states-2-f11-revealed.png). Auto-hide class: native-1-autohide-hidden.png, native-2-autohide-revealed.png.
- [proven] Element (video) full screen
  evidence: out/states.log: chrome fullscreen element is the browser, inDOMFullscreen set, vitre-root display none, page title 'fullscreen: v', Esc restores the normal window; states-4-dom-fullscreen.png shows Firefox's own full-screen warning.
- [proven] Register chrome://vitre/ at run time and inject HTML, CSS and scripts into the XUL document
  evidence: autoRegister of chrome.manifest in lib.js; out/basic.log shows createElement gives XHTML namespace. out/native.log 'injection' line: loadSheetUsingURIString synchronous, link async, processing instruction and nsIStyleSheetService work; loadSubScript, script type=module, import() and importESModule({global:'current'}) work; inline script blocked by CSP; innerHTML sanitized.
- [proven] Per-window entry point covering new windows (category hooks)
  evidence: chrome.manifest category lines; out/windows.log timeline: beforeLayout(interactive) -> domContentLoaded -> delayedStartup for new, private, popup and torn-off windows; reopened window in out/states.log.
- [proven] First window gets the shell before its first paint when registered at AutoConfig time
  evidence: run_early.py + early/config.js on a throwaway copy of the runtime -> out/early.log: hooks beforeLayout@0ms, domContentLoaded@87ms, firstPaint@480ms with nav-bar and TabsToolbar display none, toolbox height 0, 1 bar item; early-first-paint.png. gecko\runtime\config.js itself was not edited.
- [proven] Tab bar reflecting gBrowser (events, title, favicon, busy/progress), activate, close, new tab
  evidence: boot-tabs.js -> out/tabs.log: load sequence as seen by the bar, event streams for TabOpen/TabSelect/TabMove/TabClose/TabPinned/TabHide/TabAttrModified, clicks on circle, close badge and plus. Middle-click close is coded but was not exercised.
- [proven] Captures with 1, 3 and 12 tabs over real pages at 1280x800 and 900x700
  evidence: out/tabs-1-1280.png, tabs-1-900.png, tabs-3-1280.png, tabs-3-900.png, tabs-12-1280.png, tabs-12-900.png, tabs-12-mid-1280.png, tabs-12-mid-900.png. 12 tabs at 900 px uses a compact layout (34 px circles) that is not in the design.
- [proven] Pill doubles as the address field; Firefox key commands still work
  evidence: out/native.log: Ctrl+T opens a tab, Ctrl+L (openLocation override) puts the pill in edit mode, typed 'example.com' + Enter navigates, Ctrl+W closes; native-3-typed-url.png, window-4-pill-editing.png. After Ctrl+T focus lands on body, so the real bar must focus the pill itself.
- [proven] Private windows and popup windows (window.open with features)
  evidence: out/windows.log: private window has the shell, private true, privatebrowsingmode temporary (windows-2-private-window.png). Popup: popup-window attribute, one read-only pill plus window controls (windows-3-popup-window.png); native-caption variant for comparison in windows-nativepopup-3-popup-window.png.
- [proven] Session restore across a restart, reopen closed tab and window
  evidence: boot-session.js two phases on one profile -> out/session.log: pinned tab and two pending tabs restored with host, title and favicon from session data (session-2-restored.png); clicking a pending circle loads it. undoCloseTab and undoCloseWindow in out/states.log (states-8-reopened-window.png).
- [proven] Content process crash (tab crashed page) and revive
  evidence: out/states.log: content process killed by PID, oop-browser-crashed fired, tab has crashed attribute and about:tabcrashed document, other tab alive, reviveCrashedTab returns to https://example.com/; states-6-tab-crashed.png, states-7-tab-revived.png.
- [proven] Glass theme follows the page (light/dark) from a compositor snapshot
  evidence: bar.js sampleTheme uses browser.drawSnapshot at 0.1 scale; theme-light over Wikipedia (tabs-12-1280.png), theme-dark over example.com and GitHub (tabs-12-mid-900.png). The glass itself is a blur stand-in, not the lens.
- [not-possible] Start a window drag from script (e.g. drag the pill)
  evidence: out/native.log: typeof window.beginWindowMove is undefined on Windows in 157. Only -moz-window-dragging: drag regions move the window.
- [partial] Favicons readable on light glass
  evidence: boot-favicon.js -> out/favicon.log: GitHub's SVG favicon is pure white (mean luma 255) whatever colorScheme is requested, so it vanishes on light glass (visible gap in tabs-12-1280.png). Needs a design answer such as a backplate; canvas read-back of the icon works in the chrome document.

## Recipe
All paths are under gecko\spikes\shell\.

**1. Entry point (chrome.manifest + chrome\VitreShell.sys.mjs)**
```
content vitre chrome/
category browser-window-before-initial-xul-layout chrome://vitre/content/VitreShell.sys.mjs VitreShell.beforeLayout
category browser-window-domcontentloaded          chrome://vitre/content/VitreShell.sys.mjs VitreShell.domContentLoaded
category browser-window-delayed-startup           chrome://vitre/content/VitreShell.sys.mjs VitreShell.delayedStartup
```
- Register once in config.js at AutoConfig time: `Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(nsIFile)` (see early\config.js). Firefox then calls `VitreShell.method(window)` for every browser window through `BrowserUtils.callModulesFromCategory`.
- Entries run in entry-name order, so `chrome://browser/...` consumers (e.g. `CustomTitlebar.init`) have already run.
- `beforeLayout(win)` (no gBrowser yet):
  - set `:root[vitre]`;
  - `win.windowUtils.loadSheetUsingURIString("chrome://vitre/content/shell.css", win.windowUtils.AUTHOR_SHEET)` (synchronous, no flash);
  - `win.gReduceMotionOverride = true` so the hidden tab strip never waits on its own transitions;
  - lock the custom title bar: wrap `win.CustomTitlebar.allowedBy` to answer every condition with true, then call `allowedBy("pref", true)` and `allowedBy("non-popup", true)`.
- `domContentLoaded(win)` (gBrowser exists): `Services.scriptloader.loadSubScript("chrome://vitre/content/bar.js", win)`, mount the DOM, install the anchor router.
- `delayedStartup(win)`:
  - `win.PopupNotifications._getVisibleAnchorElement = () => activePill`;
  - `root.removeAttribute("retargetdocumentfocus")`;
  - `win.openLocation = () => bar.editAddress()` (Ctrl+L / Alt+D).
- For a window that is already open (the current harness): `VitreShell.adopt(win)` runs all three.
- UI code can be classic scripts via loadSubScript or `<script type="module" src="chrome://vitre/...">` (async; allowed by the document CSP). Inline scripts are blocked. `innerHTML` is sanitized (handlers and scripts dropped).

**2. Hide CSS (chrome\shell.css, all under `:root[vitre]`, no default @namespace)**
```css
#navigator-toolbox { position: fixed !important; top:0; left:0; right:0; margin:0 !important; border:0 !important;
  min-height:0 !important; background:none !important; pointer-events:none; -moz-window-dragging:no-drag; }
#navigator-toolbox::after { display:none !important; }
#navigator-toolbox > toolbar:not(#notifications-toolbar) { display:none !important; }
#sidebar-container, #sidebar-box, #sidebar-main, #sidebar-splitter, #sidebar-launcher-splitter,
#ai-window-splitter, #ai-window-box, #fullscr-toggler { display:none !important; }
#tabbrowser-tabbox, #tabbrowser-tabpanels, .browserContainer, .browserStack { margin:0 !important; border:0 !important;
  border-radius:0 !important; outline:none !important; box-shadow:none !important; }
#navigator-toolbox > #notifications-toolbar { position:fixed; top:68px; left:50%; translate:-50% 0;
  width:min(640px, calc(100vw - 32px)); pointer-events:auto; }
:root { --window-min-width: 480px; }
```
- Keep the toolbox in the frame tree (do not `display:none` it): notification bars live in `#notifications-toolbar`.
- There is no `chromemargin` attribute in 157; the `customtitlebar` root attribute is the switch.

**3. Mount point and layering (chrome\bar.js)**
- `document.body.append(<html:div id="vitre-root">)` with `position:fixed; inset:0; z-index:10; pointer-events:none`; interactive children use `pointer-events:auto`.
- `document.createElement` gives HTML elements in browser.xhtml. Build markup with DOMParser as XHTML + `importNode`: it must be well-formed, SVG needs its xmlns, and an attribute may appear only once.
- XUL panels, the fullscreen `<browser>` and window-modal dialogs sit above this layer automatically.
- State selectors: `:root[sizemode=normal|maximized|fullscreen]`, `:root[inFullscreen]`, `:root[inDOMFullscreen]` (hide the whole root), `:root[popup-window]`, `:root[privatebrowsingmode="temporary"]`.

**4. Caption behaviour**
```css
#vitre-drag { position:absolute; inset:0 0 auto 0; height:18px; pointer-events:auto; -moz-window-dragging:drag; }
:root[sizemode="maximized"] #vitre-drag { height:8px; }
:root[inFullscreen] #vitre-drag { display:none; }
#vitre-bar .item, #vitre-winctl { -moz-window-dragging:no-drag; }
#vitre-win-min { appearance:none; -moz-default-appearance:-moz-window-button-minimize; }
#vitre-win-max { appearance:none; -moz-default-appearance:-moz-window-button-maximize; }
:root:is([sizemode="maximized"],[sizemode="fullscreen"]) #vitre-win-max { -moz-default-appearance:-moz-window-button-restore; }
#vitre-win-close { appearance:none; -moz-default-appearance:-moz-window-button-close; }
```
- Buttons: `mouseup -> e.preventDefault()` on all three (mandatory), then `click ->` `window.minimize()`; `window.fullScreen ? BrowserCommands.fullScreen() : windowState === STATE_MAXIMIZED ? window.restore() : window.maximize()`; `BrowserCommands.tryToCloseWindow()`. Listen to `sizemodechange` to swap the glyph.
- The drag region is geometric: anything painted over the strip drags unless it declares `no-drag`.
- The top 8 px of a normal window is always resize (HTTOP), so the strip must be taller than 8 px to be usable.
- `window.beginWindowMove` does not exist on Windows.

**5. Popup anchor router (VitreShell.routeAnchors / route)**
- Wrap `win.XULPopupElement.prototype.openPopup(anchor, options, x, y, isContextMenu, attributesOverride, triggerEvent)` once per window.
- Reroute only when the anchor has no box (`anchor.getClientRects().length === 0`) or the popup is `#notification-popup` (with no anchor, or with Vitre's element from the callback):
  - site panels -> the active pill, `{position:"bottomleft topleft", x:0, y:8}`;
  - `#appMenu-popup` -> the + circle, `"bottomright topright"`.
- Everything else passes through untouched, so select, autocomplete and context menus need nothing.
- Extension button popups can be opened by dispatching a `command` CustomEvent with `detail.openPopupWithoutUserInteraction` on the widget's `.unified-extensions-item-action-button`.

**6. Tab model (chrome\bar.js class Bar)**
- Render `gBrowser.tabs.filter(t => !t.closing && !t.hidden)`; key DOM by the `<tab>` element.
- Events on `gBrowser.tabContainer`:
  - re-layout on TabOpen, TabClose (the tab is still in the list, with `closing` set), TabSelect, TabMove, TabPinned, TabUnpinned, TabShow, TabHide;
  - update one item on TabAttrModified (`event.detail.changed`: label, image, busy, progress...).
- `gBrowser.addTabsProgressListener({onLocationChange, onStateChange, onProgressChange})`, filter on `webProgress.isTopLevel`, map back with `gBrowser.getTabForBrowser(browser)`.
- Per tab: `tab.label`, `tab.getAttribute("image")` (always data:, chrome: or moz-remote-image: in 157, safe as an `<img src>`), `busy` / `pending` / `crashed` attributes, `linkedBrowser.currentURI`, `canGoBack`.
- Pending (restored, not yet loaded) tabs: read the URL from `JSON.parse(SessionStore.getTabState(tab)).entries[index-1].url`.
- Actions: `gBrowser.selectedTab = tab`; `gBrowser.removeTab(tab, {animate:false})`; `BrowserCommands.openTab()`; `gBrowser.goBack()` / `goForward()`; `BrowserCommands.reload()` / `stop()`; `browser.fixupAndLoadURIString(text, {triggeringPrincipal: systemPrincipal})`; `gBrowser.moveTabTo(tab, {tabIndex})`; `gBrowser.replaceTabWithWindow(tab)`; `SessionStore.undoCloseTab(window, 0)`; `SessionStore.reviveCrashedTab(tab)`.
- Page-following theme: `browser.drawSnapshot(0, 0, 0, 0, 0.1, "rgb(255,255,255)", true)` -> ImageBitmap -> canvas -> mean luma under the bar.

**7. Popup windows**
- `:root[popup-window]` is set by Firefox. Show one read-only pill (favicon + host) plus the window-control capsule; hide nav buttons, plus and close badges.
- Keep the custom caption through the `allowedBy` wrapper; Firefox re-disallows it on every `TabBarVisibility.update`, so a one-off call is not enough.

**Testing helpers worth keeping (lib.js)**
- `vt.hit(x, y)`: WM_NCHITTEST through js-ctypes.
- `window.synthesizeMouseEvent` for in-process clicks.
- EventUtils from `chrome://remote/content/external/EventUtils.js` for keys.
- run_popups.py: captures that include popup windows (panels are separate HWNDs).
- Never run two harness instances whose `--name` share a prefix: tools/run.py matches and kills processes by substring of the profile name.

## Compromises
- **Top of the page is not clickable.** In a normal window the top 18 px across the full width (outside bar items) belongs to Windows: 8 px resize band plus a 10 px drag strip. Maximized it is 8 px. The Electron design gave up 10 px. The design's 10 px strip would leave only 2 px to drag by.
- **Glass is a stand-in.** The spike uses `backdrop-filter: blur(22px) saturate(1.6)` with stronger tints than the design so captures are legible; the displacement lens was not part of this spike.
- **Many tabs in a narrow window is not designed.** The spike shrinks circles from 44 to as little as 28 px and centres the bar in the space left of the window controls; past that it would overflow.
- **Popup windows:** I chose Vitre's own caption (one read-only pill + capsule) over Firefox's native popup caption. Keeping the native caption also works but then the capsule duplicates the native buttons and must be hidden.
- **Notification bars** are Firefox's own UI floated as a card under the bar, restyled only minimally.
- **Sidebar is simply hidden**, so extension sidebars would not show. Firefox's find bar and status panel were left untouched.
- **The pill editor is minimal** (plain input, Enter navigates through URI fixup); no suggestions.
- **FINDINGS.md was not written**: the Write tool refused report files for subagents, so the findings live in this structured output. Scripts, logs and screenshots are in the spike folder.
- **The first-window proof ran on a temporary copy of the runtime** (run_early.py copies it to %TEMP%, swaps in early\config.js, deletes it afterwards), because gecko\runtime\config.js may not be edited by spikes. The real config.js still needs the one `autoRegister` line.

## Risks
- **Firefox internals.** The category names, `CustomTitlebar.allowedBy`, `gReduceMotionOverride`, `PopupNotifications._getVisibleAnchorElement`, the global `openLocation`, the element ids in the hide CSS, and `-moz-window-dragging` / `-moz-default-appearance` are version-157 internals. Every runtime update needs `run_all.sh` re-run; if a category is renamed, the fallback is the `browser-window-before-show` and `browser-delayed-startup-finished` observers, which lose the before-first-layout hook.
- **Caption buttons need a hands-on check.** With a real pointer, nobody has yet seen the first click on maximize, the hover highlight, the snap-layout flyout or an actual drag. The message-level tests pass, and the double-toggle trap is fixed, but posted messages are not a mouse.
- **The openPopup wrapper is a monkey-patch** of a WebIDL prototype that every XUL popup in the window passes through. It only rewrites calls whose anchor has no box, but a Firefox change to how panels open could bypass or break it.
- **Hidden features still run.** The urlbar and toolbar buttons exist without boxes. Anything Firefox shows by focusing or anchoring to them needs a Vitre replacement, command by command (focus after Ctrl+T lands on body today; Ctrl+K, bookmark star and downloads button were not looked at).
- **White favicons vanish on light glass** when the OS is dark and the page is light (GitHub). Needs a design decision.
- **Focus-dependent behaviour:** element full screen is refused unless the window is the active OS window, and select/autocomplete popups roll up when another window takes focus. This made two test steps flaky while other spikes ran; it is not a product defect.
- **Harness:** tools/run.py matches and kills Firefox processes by substring of the profile name, so concurrent runs with names sharing a prefix capture and kill each other.

## Files
gecko\spikes\shell\chrome.manifest
gecko\spikes\shell\chrome\VitreShell.sys.mjs
gecko\spikes\shell\chrome\shell.css
gecko\spikes\shell\chrome\bar.js
gecko\spikes\shell\lib.js
gecko\spikes\shell\run_all.sh
gecko\spikes\shell\run_popups.py
gecko\spikes\shell\run_early.py
gecko\spikes\shell\early\config.js
gecko\spikes\shell\boot-basic.js
gecko\spikes\shell\boot-window.js
gecko\spikes\shell\boot-native.js
gecko\spikes\shell\boot-ncprobe.js
gecko\spikes\shell\boot-popups.js
gecko\spikes\shell\boot-tabs.js
gecko\spikes\shell\boot-windows.js
gecko\spikes\shell\boot-states.js
gecko\spikes\shell\boot-session.js
gecko\spikes\shell\boot-early.js
gecko\spikes\shell\boot-favicon.js
gecko\spikes\shell\out\basic-1-shell.png
gecko\spikes\shell\out\early-first-paint.png
gecko\spikes\shell\out\tabs-12-1280.png
gecko\spikes\shell\out\tabs-12-900.png
gecko\spikes\shell\out\popups-2-doorhanger.png
gecko\spikes\shell\out\popups-noroute-2-doorhanger.png
gecko\spikes\shell\out\windows-3-popup-window.png
gecko\spikes\shell\out\states-2-f11-revealed.png
gecko\spikes\shell\out\states-6-tab-crashed.png
gecko\spikes\shell\out\session-2-restored.png
gecko\spikes\shell\out\native.log
gecko\spikes\shell\out\ncprobe.log
gecko\spikes\shell\out\window.log
gecko\spikes\shell\out\popups.log
gecko\spikes\shell\out\popups-noroute.log
gecko\spikes\shell\out\tabs.log
gecko\spikes\shell\out\windows.log
gecko\spikes\shell\out\states.log
gecko\spikes\shell\out\session.log
gecko\spikes\shell\out\early.log

# Independent verification

## Overall
The shell architecture holds: every structural claim reproduced, and four things the spike could not show are now proven with a real pointer. Two of its statements are wrong and one area is incomplete.

I reran all the spike's scenarios unchanged under my own profile names, then added my own scripts, including guarded real-pointer input and a screen capture that can see shell flyouts. Notes are in `gecko\spikes\shell\verify\VERIFY.md`.

**Now proven (were partial, unverified or not-possible):**
- **Snap layouts:** the Windows 11 flyout appears under Vitre's own maximize button (`vnative-1-hover-max.png`).
- **Caption hover:** `:hover` and the hover colours apply on all three buttons.
- **Real drag:** dragging the strip moved the window by exactly the drag distance.
- **Window move from script:** possible through js-ctypes (`ReleaseCapture` + posted `WM_NCLBUTTONDOWN`/`HTCAPTION`), with Aero Snap and drag-restore from maximized. Dragging the pill or bar is therefore an option, so the 10 px drag strip is a design choice.

**Wrong or incomplete:**
- **Glass:** `backdrop-filter` does nothing over the page. With only the filter left, the pill is invisible over a page but filters chrome-drawn content. The "frost stand-in" is a tint; the real glass must come from another mechanism.
- **Auto-hide:** the reveal zone cannot be reached with a real pointer in a normal window, because it sits inside Windows' resize band. It works in F11 and maximized. A JS reveal rule fixes it (proven).
- **Popup anchors:** the router misses panels. Site info opens at the window corner, Ctrl+D throws and saves nothing, and Firefox's downloads panel never opens. Two small additions fix the first two (proven).
- **Load progress:** there is no real fraction, only busy plus one or two late jumps.
- **Popup evidence:** the spike's popup script only passes when its window has OS focus; it failed twice here until I forced activation.

**Smaller traps:** `title` tooltips do not show on the bar, `webProgress` is null in `onProgressChange`, and Vitre's hooks run before Firefox's `moz-src:`/`resource:` consumers.

**Not checked:** display scaling other than 100 %, and window-modal dialogs over the layer (my probe hangs the harness even in stock Firefox).

The real-pointer tests moved the actual mouse cursor for a few seconds each and pressed the left button only over the test window; the cursor was put back afterwards.

## Confirmed
- 1 Hide Firefox's chrome without breaking gBrowser - rerun: verify/out/basic.log (toolbox 0 px, browser [0,0,1264,792]), basic-1-shell.png, tabs.log
- 2 No native caption, also with browser.tabs.inTitlebar=0 and in popup windows - verify/out/titlebar0/basic-0-stock.png vs basic-1-shell.png; windows.log popup NCHITTEST TOP/CAPTION/MINBUTTON
- 3 Baseline without the router - verify/out/vpopups-noroute.log (window forced active): doorhanger at [-4,-4], app menu and extension popup never open, select/autocomplete fine
- 4 Anchors for PanelUI, permission doorhangers and extension popups - verify/out/vpopups.log: doorhanger [362,60] under the pill, follows the pill after a tab switch ([336,60]) and in a second window; app menu [622,60] under the + circle; extension popup [362,60]. Coverage is incomplete, see refuted
- 5 Page select dropdown, autocomplete and context menu work - vpopups.log, vselect.log (stable when the window is active; the one failure had active:false and also happens without the shell)
- 6 Notification bars float as a card and tab-modal alert is centred - popups-7-notification-bar.png, popups-8-alert.png
- 7 Page fills the window, bar floats above the remote browser, hit-testing correct - window.log plus REAL clicks in vnative-clicks-drag.log ((300,40) and (1000,30) reach the page, + opens a tab). The blur part of this claim is refuted separately
- 9 Window controls minimize/maximize/restore/close - native.log (posted non-client messages) and vnative-clicks-drag.log (real clicks: exactly one sizemode change each)
- 10 Unconsumed mouseup on a caption button makes Windows act too; preventDefault on mouseup fixes it - ncprobe.log: raw-none toggles with no JS, raw-toggle/raw-maximize double, shipped single
- 13 (part) Maximized state and F11 full screen with reveal - states.log and vreveal.log: real pointer at y 0 and 3 reveals the bar in F11 and when maximized
- 14 Element (video) full screen - states.log, states-4-dom-fullscreen.png
- 15 chrome://vitre/ registered at run time; sheet, script and module injection routes - native.log injection line (loadSheetUsingURIString sync, link async, PI, style sheet service, loadSubScript, script type=module, import(), importESModule global:current; inline script blocked; innerHTML sanitized)
- 16 Category hooks run for every window (new, private, popup, torn-off, reopened) - windows.log timeline, states.log
- 17 First window has the shell before its first paint when registered at AutoConfig time - strengthened: verify/out/earlyv.log shows windowUtils.paintCount 0 at beforeLayout and at domContentLoaded. early-first-paint.png itself is taken later (page already loaded), so the log is the evidence, not the picture
- 18 (part) Bar reflects gBrowser: TabOpen/TabClose/TabSelect/TabMove/TabPinned/TabHide/TabAttrModified, title, favicon, busy; activate, close, new tab - tabs.log; middle-click close, which the spike did not exercise, works (vmisc.log 2 -> 1)
- 19 Captures with 1, 3 and 12 tabs over real pages at 1280x800 and 900x700 - verify/out/tabs-*.png (compact 34 px circles at 900 px with 12 tabs, as reported)
- 20 Pill doubles as address field; Ctrl+T, Ctrl+L, typed URL + Enter, Ctrl+W - native.log keys step, native-3-typed-url.png
- 21 Private windows and popup windows - windows.log (privatebrowsingmode temporary; popup-window with one read-only pill), windows-3-popup-window.png
- 22 Session restore across a restart, pending tabs, undoCloseTab/undoCloseWindow - session.log, session-2-restored.png, states.log
- 23 Content process crash and revive - states.log, states-6-tab-crashed.png, states-7-tab-revived.png
- 24 Light/dark theme from browser.drawSnapshot - tabs-12-1280.png (light over Wikipedia), tabs-12-mid-1280.png (dark over GitHub)
- 26 White SVG favicon vanishes on light glass; needs a design answer - favicon.log (mean luma 255 for every colorScheme), blank circle in tabs-12-1280.png

## Refuted
- 7/24: 'backdrop-filter blur over the page visible in window-1-hover-close.png' and the glass being a 'blur stand-in'
  why: backdrop-filter in the chrome document has no effect over the remote <browser>. verify/out/vmisc-2-backdrop-invert-only.png (crop zoom-vmisc-backdrop.png): with tint and rim removed and backdrop-filter: blur(22px) invert(1) left, the pill is invisible over the page, while the same element blurs and inverts chrome-drawn stripes (vmisc-3). In the spike's own window-1-hover-close.png the page's stripe edges under the pill are as sharp as outside it (10 hard edges per 400 px in both). What the captures show is a tint only.
- 13 (part): auto-hide with a reveal zone works (native-1-autohide-hidden.png, native-2-autohide-revealed.png)
  why: It fails in a normal (non-maximized) window with a real pointer. The 6 px #vitre-reveal zone lies inside Windows' resize band (y 0-7 = HTTOP) where Gecko sends no DOM mouse events, so :hover never matches. verify/out/vreveal.log: real cursor at y 2, 5, 12 and 22 leaves the bar at -60 px (vreveal-1-normal-pointer-at-top.png). The spike proved it with in-process synthesized mouse moves, which bypass non-client hit-testing. It does work maximized and in F11.
- 4 (scope): the anchor router gives Firefox's panels a sane anchor
  why: True only for the three surfaces tested. verify/out/vpanels.log 'spike rules': the site-info/trust panel is opened with a null anchor, which the router only handles for #notification-popup, so it lands at the window corner [-4,-4] (vpanels-spike-1-trustpanel.png); the Ctrl+D bookmark editor throws 'PageActions: No anchor node for bookmark' and no bookmark is created at all; Firefox's downloads panel never opens (DownloadsButton.getAnchor() returns null).
- 5/3/4 evidence robustness: boot-popups.js as the proof for doorhanger, select, autocomplete and extension popup
  why: The script only passes when its window happens to be the active window. Rerun unchanged it failed twice here (verify/out/popups.log, rerun-chain.txt: doorhanger, select, autocomplete, extension popup closed; once even the app menu) because another window had focus. PopupNotifications checks Services.focus.activeWindow and select/autocomplete need an active window. The behaviour itself is confirmed once the window is activated (vpopups.log).
- 18 (part): load progress shown through web progress listeners
  why: There is no usable fraction. verify/out/vprogress.log: onProgressChange fires once or twice per load (100 %, or 87 % then 99 %), and the spike's own tabs.log only ever shows --progress 0.1. Busy state is real; the progress line needs its own time-based easing. Also webProgress is null in onProgressChange of a tabs progress listener.
- Recipe 3: 'window-modal dialogs sit above this layer automatically'
  why: Not shown by any spike script and I could not show it either: Services.prompt.asyncAlert with MODAL_TYPE_WINDOW blocks the main thread in this harness with and without the shell (verify/boot-v-modal.js, marked blocked). Treat as unverified.

## Improved
- Claim 25: start a window move from script (was not-possible)
  finding: It works through js-ctypes. On mousedown remember the point; on the first mousemove beyond about 5 px call user32.ReleaseCapture() and PostMessageW(hwnd, WM_NCLBUTTONDOWN 0xA1, HTCAPTION 2, MAKELPARAM(screenX, screenY)). Windows then runs its own move loop. verify/out/vnative-pilldrag.log: dragging the pill by (-112,+98) moved the window (-104,+91); dragging to the top screen edge maximized it (Aero Snap); a plain click afterwards still entered edit mode. vnative-pillmax-wheel.log: dragging the pill of a maximized window restored it to 1280x800 and carried it. PostMessage(WM_SYSCOMMAND, 0xF012) also moves but leaves :active stuck and failed once in an inactive window; SendMessage variants only from a timer. Consequence: the 10 px drag strip under the resize band is a design choice, not a necessity (the 8 px resize band stays). Script: verify/boot-v-native.js steps pilldrag and pillmax.
- Claim 11: snap layouts on hover of maximize (was partial)
  finding: Proven with the real pointer: verify/out/vnative-1-hover-max.png shows the Windows 11 snap-layouts flyout hanging from Vitre's own maximize button (reproduced in two runs). Needs nothing beyond -moz-default-appearance: -moz-window-button-maximize.
- Claim 12: hover highlight on caption buttons (was unverified)
  finding: Proven with the real pointer: verify/out/vnative-hover.log shows :hover true on minimize, maximize and close, with the hover backgrounds applied (close rgb(196,43,28)); vnative-2-hover-close.png. The spike's negative result was an artefact of posted WM_NCMOUSEMOVE.
- Claim 8: actual mouse drag on the strip (was partial)
  finding: Proven: a real press-move-release on the drag strip at (150,13) moved the window by exactly (+140,+84), verify/out/vnative-clicks-drag.log. Extra: the mouse wheel scrolls the page in the bar strip beside the pill but is dead on the drag strip (y 8-17), on bar items and on the window controls (vnative-pillmax-wheel.log).
- Auto-hide reveal that works with a real pointer
  finding: Replace :hover on the reveal zone with JS: reveal on window mousemove with clientY < 28 and on mouseout with relatedTarget === null when the last y was near the top; hide when the pointer goes below the bar. verify/out/vreveal.log 'FIX' lines: revealed at y 2, 12 and 22 in a normal window and at y 0 maximized, stays revealed while the pointer rests in the resize band, hides again on the page (vreveal-3-fix-normal-pointer-at-top.png).
- Router fixes for the missed panels
  finding: Two additions in verify/chrome/VitreShell.sys.mjs (marked VERIFY improvement): (1) any <panel> opened through openPopup() with no anchor and no coordinates is routed to the pill; (2) win.BrowserPageActions.panelAnchorNodeForAction = () => pill. verify/out/vpanels.log 'verifier rules': trust panel at [362,60] under the pill (vpanels-improved-1-trustpanel.png), bookmark editor opens and the bookmark is saved (vpanels-improved-2-bookmark.png), and select, autocomplete, context menu and doorhanger still behave the same.
- Deterministic popup testing
  finding: vv.activate() in verify/vlib.js (SendMessage WM_ACTIVATE(WA_ACTIVE) then WM_SETFOCUS to the window) makes Gecko treat the window as active without OS foreground, so doorhanger/select/autocomplete tests stop depending on which window has focus.
- Tooltips on the bar
  finding: title attributes on the bar's HTML buttons never show a tooltip (document root and body are HTML). Mounting the layer inside a XUL element with tooltip="aHTMLTooltip" makes them show ('New tab  Ctrl+T' opened) and the layer keeps working (click on +, HTMAXBUTTON). verify/out/vtooltip.log; the evidence is the log line, the tooltip is not in the capture.

## Recipe corrections
All paths under gecko\spikes\shell\verify\ (notes: VERIFY.md; rerun the spike's scripts with rerun.sh, mine with run_verify.sh).

1. **Glass:** drop `backdrop-filter` from the shell recipe. It is inert over the remote `<browser>`; the `.lens` rule only ever filters chrome-drawn content. The stand-in is a tint.
2. **Reveal zone:** `#vitre-reveal:hover` on a 6 px strip only works in F11 and maximized. In a normal window use JS (mousemove with clientY < ~28, plus mouseout-to-nothing near the top), or the bar cannot be brought back with a real pointer.
3. **Anchor router:** add the null-anchor rule (`!anchor && popup.localName === "panel"` and no x/y) and override `BrowserPageActions.panelAnchorNodeForAction` to return the pill. Without them the site-info panel opens at the window corner and Ctrl+D neither opens the editor nor saves the bookmark. Firefox's own downloads panel never opens (silent). Panels that Firefox anchors to the pill itself keep Firefox's alignment (bookmark editor at [540,52], right-aligned, no 8 px gap) unless the router also realigns anchors inside `#vitre-root`.
4. **Window move:** `window.beginWindowMove` is gone, but `ReleaseCapture()` + `PostMessageW(hwnd, 0xA1, 2, MAKELPARAM(screenX, screenY))` from the first mousemove after a mousedown starts a native move, with Aero Snap and drag-restore from maximized. Prefer this over the WM_SYSCOMMAND form.
5. **Progress listener:** in `onProgressChange` of `gBrowser.addTabsProgressListener`, `webProgress` is null; filtering on `webProgress.isTopLevel` there throws (swallowed). Filter only in onLocationChange/onStateChange. Do not expect a smooth fraction.
6. **Hook order:** entries run sorted by module URL. `chrome://vitre/` runs after `chrome://browser/` but before `moz-src:` and `resource:` consumers. At `VitreShell.domContentLoaded`, `CustomizableUI.handleNewBrowserWindow` and `BrowserWindowTracker.track` have not run for that window yet; 11 Firefox consumers still follow at delayed startup (vmisc.log).
7. **`gReduceMotionOverride = true`** is not needed for tab closing (6 ms with and without, vmisc.log). Harmless, but it also disables Firefox's own animations; optional.
8. **Tooltips:** mount `#vitre-root` under a XUL element carrying `tooltip="aHTMLTooltip"`, or draw own tooltips; `title` alone does nothing.
9. **Popup tests** must activate the window first (`vv.activate()`), or doorhangers, select and autocomplete silently do not open.
10. **Caption buttons, snap, drag strip:** recipe is right as written; now also proven with a real pointer. The wheel is dead on the 10 px drag strip.
11. **From source, not run:** doorhanger suppression (`shouldSuppress` in browser.js) keys off `gURLBar` focus/pageproxystate, so nothing suppresses doorhangers while the user types in the pill.
12. **Unverified in the recipe:** "window-modal dialogs sit above this layer automatically".
13. **Scope of all numbers:** 100 % display scaling only (dpr 1, 2560x1440). The 8 px resize band and 18 px strip were not checked at 125/150 %.