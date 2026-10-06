# Deer on Gecko: architecture

Deer is a privileged chrome layer on Firefox 157's engine. Firefox's own window
(`browser.xhtml`) stays the host: its tab engine (`gBrowser`), session restore, history (Places),
permissions, WebExtensions and networking all keep working. Deer hides Firefox's interface and draws
its own inside that window. Nothing is compiled from Mozilla source. Development runs on a local copy
of the stock Firefox 157 in `runtime/`, which is never published; a release ships Mozilla's unbranded
Firefox 157 build, made into Deer's engine by `tools/setup-engine.py` and installed by `installer/`
(`../docs/BUILDING.md`).

Deer was called Vitre during development. Every name a person sees says Deer; internal identifiers
keep the old name: the `vitre.*` prefs, the `chrome://vitre/` package, `Vitre*` module and file names,
`#vitre-root` and the other CSS ids and classes, the `vitre-profile` marker, the `vitre.ico` file
(the gold icon) and the package folder `vitre/` next to the engine.

The design is unchanged and is the source of truth: `../design/DESIGN-NOTES.md`, `../design/keymap.json`,
and the canvas boards in `../design/canvas/project/*.dc.html` (exact sizes, colours, copy).
The Electron build in `../app` is the reference implementation of that design (see `../app/ARCHITECTURE.md`);
port behaviour and look from it, and take the Gecko mechanics from the verified spike results below.

## Verified recipes (read the one for your area before writing code)

Each spike was run on this runtime and then independently re-verified. `RESULT.md` holds the recipe,
the verifier's corrections (they override the recipe where they differ) and the evidence paths.

| Area | File | Decision |
|---|---|---|
| Glass | `spikes/glass/RESULT.md` | Parent-layer glass: `#tabbrowser-tabbox { filter: saturate(1.0001) }` makes `backdrop-filter` in Deer's layer sample the live page. No true displacement map in WebRender: refraction is the feOffset strip lens (`spikes/glass/glasslib.js`, `verify/v4-parent.js`, `verify/v6-row.js`). |
| Shell | `spikes/shell/RESULT.md` | Category hooks per window, hide CSS, `#vitre-root` layer, caption buttons, popup anchor router, tab model on `gBrowser`. |
| Keys, omnibox data | `spikes/keys/RESULT.md` | Capture-phase router; browser-first = chrome `preventDefault`; page-first = `requestReplyFromRemoteContent()`; Places SQL suggestions. Use `verify/vitre-keys-fixed.js`, not the first router. |
| Extensions | `spikes/extensions/RESULT.md` | Real browserAction widgets re-homed into a CustomizableUI area inside the pill; Firefox's unified extensions panel for the rest; AMO installs. |
| Downloader | `spikes/downloader/RESULT.md` | Engine as system modules (`spikes/downloader/verify/engine/*.sys.mjs` is the patched prototype), one network partition ("lane") per connection, take-over through the Downloads list view. |
| Peek, find, menus | `spikes/pagefeatures/RESULT.md` | Peek = hidden real tab shown as a sheet; find through `browser.finder` with Deer's field; HTML menus replacing `#contentAreaContextMenu`. |
| Switcher, Home, settings | `spikes/switcher/RESULT.md` | `drawSnapshot` thumbnails with a cache; Home is `about:vitre-home` in a tab; settings are `vitre.*` prefs. |
| Packaging | `spikes/packaging/RESULT.md` | AutoConfig `config.js` registers the package from inside the runtime dir; launcher always passes `-profile`. |

## Layout

```
gecko/
  runtime/        development engine: stock Firefox 157 + config.js, defaults/pref/*.js,
                  distribution/policies.json, browser/chrome/icons/default/*.ico,
                  vitre.exe (byte copy of firefox.exe; the process Deer runs as in development),
                  vitre/ (junction -> ../build; content processes can only read files inside runtime/)
  engines/        Mozilla's unbranded builds and the release engine made from one
                  (deer-runtime: deer.exe with Deer's identity and icon, tools/setup-engine.py; its
                  deer-engine.json lists every engine file with its SHA-256, which --check compares)
  src/
    chrome.manifest
    modules/      *.sys.ts  process-wide singletons (startup, settings, downloads engine, updater, ...)
    actors/       JSWindowActor parents/children (page-side code)
    window/       per-window UI: core (*.ts) + feature modules (modules/<name>.ts or <name>/index.ts)
    pages/        privileged pages (home)
    shared/       code used by several bundles. settings.ts and home.ts are pure; shortcuts.ts
                  (BINDINGS) and url.ts (the search engine) hold per-bundle state that each bundle
                  applies itself (applyRebind / setSearchEngine), so a singleton imports only home.ts
    skin/         css (shell, glass, bar, omnibox for the window; pages.css for Firefox's own pages
                  and prompts, pdf.css for the PDF viewer)
    locales/      brand strings and the few Firefox strings Deer overrides (L10nRegistry source)
    types/        gecko.d.ts (Gecko globals; XULBrowser / XULTab declare only the members Deer uses)
  build/          build output = the chrome package (git-ignored)
  tools/          build.mjs, run.py (run + real screenshots), spike-lib.js,
                  setup-runtime.py + runtime-overlay/ (the tracked source of everything Deer adds to
                  runtime/: run the script after changing it), setup-engine.py (the release engine
                  from an unbranded build, with the same overlay: its --check compares the overlay
                  byte for byte, so run it again too), build-launcher.mjs, make-icon.py (the two app
                  icons from ../design/icon), extract-reference.py
  tests/          boot scripts that drive the app and capture (one folder per feature)
  launcher/       development launcher: Deer.cmd (+ Launcher.cs for Deer.exe; Vitre.cmd forwards to it,
                  Vitre.exe, for old pins, is a copy of Deer.exe)
  installer/      release launcher (Deer.exe), setup and uninstaller; build.py, test.py
  spikes/, reference/omni/   evidence and Firefox's own UI source for grepping
```

## Loading

1. `runtime/config.js` (AutoConfig, unsandboxed) registers `<app dir>/chrome.manifest` with
   `nsIComponentRegistrar.autoRegister`, then calls `VitreStartup.init()` from
   `chrome://vitre/content/modules/VitreStartup.sys.mjs`. App dir = `<engine>/vitre` (`runtime/vitre`
   in development, a real copy in a release), or `VITRE_APP_DIR` when set (must be a path the content
   sandbox can read: inside the runtime or `<profile>/chrome`).
2. `chrome.manifest` has `content vitre ./` plus three `category` lines so Firefox calls
   `VitreShell.beforeLayout / domContentLoaded / delayedStartup(window)` for every browser window
   (new, private, popup, restored).
3. `beforeLayout` loads the shell stylesheet synchronously (`windowUtils.loadSheetUsingURIString`) and
   sets `:root[vitre]`, so Firefox's interface never paints. `domContentLoaded` loads the window bundle
   (`chrome://vitre/content/window/window.js`, via `loadSubScript`), which builds `window.vitre`
   (the `Browser`), mounts the UI and installs the feature modules.
4. Never start the runtime without `-profile`: with the stock identity it would use the user's real
   Firefox data. The launcher creates `<profile>/vitre-profile`; `config.js` refuses to continue without
   that marker (the test harness sets `VITRE_ALLOW_ANY_PROFILE=1`). The test hook and
   `VITRE_APP_DIR` (both run script with full privileges) are honoured only in a profile that also
   carries `vitre-harness`, which `tools/run.py` writes; elsewhere `config.js` ignores them.
   The release engine (`engines/*`, `tools/setup-engine.py`) runs as Deer: data root `%APPDATA%\Deer`
   and `%LOCALAPPDATA%\Deer`, remoting name `deer`, engine housekeeping under `HKCU\Software\Deer`,
   `C:\ProgramData\Deer-Engine-<guid>` and `%TEMP%\deerapp-temp-files`, a user agent that is exactly
   Firefox's (UAName); both launchers clear `XUL_APP_FILE`, `XRE_PROFILE_PATH`,
   `XRE_PROFILE_LOCAL_PATH` and `MOZ_NEW_INSTANCE` (which would turn the hand-off of a second start
   off). Details in `tests/engine/identity.py`. `runtime/` (the branded
   development engine) keeps Mozilla's identity, so the `-profile` rule still applies there.
5. Profile: an installed Deer uses `%LOCALAPPDATA%\Deer\Profile` (`installer/Launcher.cs`), the
   development launcher `%LOCALAPPDATA%\Deer Dev\Profile` (`launcher/Launcher.cs`): never the same
   folder, since the two engines differ (remoting name, and an updated release engine may be newer
   than `runtime/`). Each copies the profile from before the rename, `%LOCALAPPDATA%\Vitre\Profile`,
   on its first start (`installer/ProfileMigration.cs`: a copy into a temporary folder renamed when
   complete; not while a browser runs on the old profile; a blank target counts as absent; free
   space checked first; a copy that keeps failing is tried once a day and the installed Deer says so
   once). Every window carries the AppUserModelID
   `Deer.Browser` (`VitreStartup.APP_ID`), the id of the installer's shortcuts and file types, so the
   taskbar groups them together. The Electron build owns `%APPDATA%\Vitre`.

## Build

`node tools/build.mjs [--out=build-<name>] [--watch]`, esbuild + TypeScript, no UI framework.

- `src/modules/*.sys.ts` and `src/actors/*.sys.ts`: each top-level file is one ES module
  (`.sys.mjs`), bundled with its relative imports. Singletons import each other only by URL
  (`chrome://vitre/content/modules/X.sys.mjs`, typed through `tsconfig` paths); a relative import of a
  stateful file from two entry points would create two copies of its state. The build enforces it:
  a relative import of a `.sys.ts` file from anywhere fails with a message (window and page code use
  `b.sys('X')` plus type-only imports).
- `src/window/main.ts` -> `window/window.js` (IIFE). Feature modules in `src/window/modules/` are
  auto-discovered (`_generated.ts`) and export `install(b: Browser)`. `--modules=a,b` bundles only
  those discovered modules (for building around another author's half-written module).
- Page-side code: files in `src/actors/page/` are auto-discovered and bundled into the one
  `VitrePageChild.sys.mjs`; each exports `{ events?, onEvent?, onMessage? }` (see `src/actors/page/README`).
  `core` (theme sampling signals), `keys` (Esc layers), `pdf` (the PDF viewer under the bar) and
  `inset` (pages start below the bar) are built in. Everything a page sends is validated as an
  envelope by the parent actor and reaches modules as `unknown`. A page module reads its setting from
  the `vitre.*` pref in the content process (`src/actors/page/README`).
- `src/pages/<name>/` -> bundled per page. `src/skin/*.css` copied. `browser.xhtml` CSP allows only
  `chrome:`/`resource:`/`moz-src:` scripts: no inline scripts, no `eval`; build DOM with
  `createElement`/DOMParser, never `innerHTML` with page-derived strings.
- Type-check: `npx tsc --noEmit -p .` (strict, unused locals and parameters are errors). Gecko
  globals are declared loosely in `src/types/gecko.d.ts`, except `XULBrowser` and `XULTab`, which
  declare only the members Deer uses: add a member there (with its source) rather than going
  through `any`.
- `.sys.mjs`, actors and window modules are cached for the process: restart to reload
  (`python tools/run.py` always starts fresh).

## Window architecture (`src/window/`)

- `#vitre-root` is mounted INSIDE `#tabbrowser-tabbox` (position: fixed, inset 0, pointer-events none,
  children opt in), because the tab box carries the neutral filter that lets glass see the page.
  The filter is removed in DOM full screen. Page text under the filter is greyscale-antialiased
  (no ClearType): known cost of real glass on Gecko.
- `gBrowser` is the tab model. `Browser` wraps it: `Tab` objects mirror `<tab>` elements
  (`TabOpen/TabClose/TabSelect/TabMove/TabAttrModified`, a tabs progress listener). Hidden tabs
  (peeks) are not in `b.tabs`.
- Glass: `glass.ts` builds strip-lens and row-lens SVG filters; `.glass > .lens/.tint/.rim` and the
  theme variables `--g-*` (`theme-light | theme-dark | theme-clear`) are the Electron ones. The bar
  uses one row-lens element for its circles (max 13 shapes per element unless
  `gfx.webrender.max-filter-ops-per-chain` is raised; Deer ships it at 256 and chunks at 24, because
  29 shapes sit exactly on WebRender's hard cap of about 122 `feOffset` nodes) and a separate lens for
  the active pill. While the bar moves, each shape blurs for itself and the lenses for the final
  layout go in 440 ms later (`bar.ts`). Panels and menus use frost `blur(24px) saturate(1.6)`
  (class `frost` on the `.glass` element; `glass(el)`, `lens(w, h)` and `rowLens()` are in `glass.ts`).
  Never put `url("...")` or `path("...")` inside a double-quoted `style` attribute; set styles through the CSSOM.
- Native XUL popups (extension popups, permission doorhangers, page `<select>` lists, Firefox panels)
  are separate OS windows: they are anchored to Deer's bar by the anchor router and restyled with CSS,
  but they cannot be glass. Doorhangers hide while the address field is open (as Firefox hides them
  while its own bar is edited) and are left to Firefox in element full screen, re-anchored under the
  pill when it ends.
- Firefox's own pages and prompts: `skin/pages.css` is a process-wide user sheet (nsIStyleSheetService,
  registered by `VitreStartup`) that gives every about: page and chrome document Deer's accent
  (`--color-accent-primary` #005fb8 / #4cc2ff) and lays the network error page out as the Electron
  error card; `locales/en-US/toolkit/neterror/*.ftl` override its title and button strings (an id
  missing from Deer's file falls through to Firefox's). The PDF viewer is pushed under the bar by
  the `pdf` page module (`skin/pdf.css`).
- Web pages start below the bar: the `inset` page module (setting `pageInset`) gives a tab's top
  document a strip of the bar area's height (`BAR_AREA`, `src/shared/geometry.ts`) as root padding in a
  user sheet (added to the site's own root padding), in the page's own canvas colour, that scrolls away
  with the page; a canvas background image starts below it with the content. Boxes pinned to the top
  of the viewport (fixed, sticky) are moved below it by `var(--vitre-inset)` from the screen-only
  sheet, so print is unchanged; headers that appear or become fixed later are found while the page
  scrolls or repaints, and a pushed header that hides itself (translateY(-100%)) is given back while
  hidden. Pages sized to the viewport (apps) are left alone. The same sheet sets `scroll-padding-top`
  (normal priority: a site's own wins), so #hash jumps and `scrollIntoView()` land below the bar; page
  modules that need the bar's height read `--vitre-inset`, not the scroll padding (find turns the
  padding off while it is open). Two lists in `Services.ppmm.sharedData` switch the strip off per
  `<browser>`, read before a document's first layout and on every re-check: `INSET_OFF_KEY` (a page
  that is not under the bar: a peek's sheet) and `INSET_BAR_HIDDEN_KEY` (`src/window/pagearea.ts`: every
  page of a window whose bar is in hiding mode, auto-hide or F11, so there is no empty band; a reveal of
  the hidden bar changes nothing, the bar slides in over the page). The PDF viewer's offset
  (`pdf` page module) follows both. The rules are in the module's header.
- The glass theme sampler (`fx.luma`, a 1/4-scale `drawSnapshot` of the strip under the bar) runs
  on load, scroll and main-thread repaints. Its own snapshot repaints the page, so the window ignores
  the paint reported within 400 ms of a sample; compositor animations (transforms, video) never
  report paints. `b.luma(browser, rect)` and `b.snapshot(browser, rect, scale)` expose the same
  snapshot for modules (thumbnails, menus).
- Window chrome: `-moz-window-dragging` strip, caption buttons with `-moz-default-appearance`
  (snap layouts work), `preventDefault()` on their `mouseup` (`winctl.ts`), script-started window move
  through js-ctypes for dragging the bar (`firefox.ts` `beginWindowMove`), JS reveal rule for auto-hide
  and full screen (`reveal.ts`). Styles: `skin/shell.css` (hide rules, layer), `skin/glass.css`
  (tokens, themes, `.glass`), `skin/bar.css` (bar, window controls, tooltips), `skin/omnibox.css`
  (address field), all loaded by `VitreShell.beforeLayout`.

### Browser API for feature modules (`window.vitre`, class `Browser` in `src/window/browser.ts`)

Same shape as the Electron `Browser` so modules port directly (the full contract is the header of
`browser.ts`):

- State: `tabs`, `active()`, `activeId`, `mru`, `settings`, `bar.layout` (`pillRect`, `left`, `right`),
  `omni` (`open`, `focused`, `current()`, `input`; `omnibox.ts`), `keys` (the router, below), `root`,
  `isPrivate`, `isPopup`, `closedCount()`.
- Bar (`bar.ts`): `bar.item(tabId)`, `bar.accessories()` (the active pill's extensions slot; the bar
  measures it and keeps the favicon + host centred at the pill's middle while they fit beside it, else
  as near as the box allows: `has-acc` / `--vitre-acc` in `skin/bar.css`), `bar.downloadMark()`,
  `bar.reserve`, `bar.hidden` (slid away now), `bar.hiding` (in hiding mode: auto-hide or F11, shown or
  not), `bar.reveal()`, `bar.hold(reason)` (keeps an auto-hidden bar on screen until the returned
  function is called), `bar.claimPill(width)` (the active pill keeps that width, at most 480, until the
  returned function is called; with many tabs the circles shrink and give way instead: find's face).
  Tooltips: `setTip(el, label, key)` from `tips.ts` (above the control when there
  is no room below). Keyboard stops: any element with `data-bar-stop` in `#vitre-root` joins the bar's
  Left / Right row in drawn order (`barkeys.ts`: the extension buttons, the downloads ring).
- Tabs: `newTab(url?, {background, index})`, `closeTab(tab)`, `activate(tab)`, `navigate(tab, url)`,
  `moveTab(tab, index)`, `toggleMute(tab)`, `moveToNewWindow(tab)`, `forgetClosed()`, `tab(id)`,
  `tabFor(browserElement)`, `focusPage()`, `editAddress(query?)`, `render()`. `newTab(url)` and
  `navigate(tab, url)` load with the system principal: user-typed and Deer-chosen URLs only. A URL
  that came from a page (a link, an image, a selection, an `OpenRequest`) goes through
  `openLink(urlOrRequest, 'tab' | 'tabshifted' | 'window' | 'current', { triggeringPrincipal,
  referrerInfo, policyContainer, userContextId, openerBrowser, index, background, private })`, which
  loads it as Firefox loads a clicked link (a web principal cannot open chrome:, file: or about:config:
  such a request opens nothing, not even a blank tab).
  A tab's `url` is its pending address from the moment the load is asked for (`browser.userTypedValue`,
  when it is an absolute URL: Firefox's search-terms persistence writes a results page's terms there),
  and it counts as `loading` until a document arrives: `t.url === target && !t.loading` means loaded.
- Windows: `openWindow(url?, { private, ...principals })`. In a popup window (`isPopup`) `newTab`,
  `openLink('tab')` and `reopenClosed` act on the most recent normal window; the tab-strip actions do
  nothing there.
- Hidden tabs (Peek): `openHidden(url, opts)` returns `{ node, browser }` for a real tab that is not in
  `tabs` and emits no tab events; `adopt(node, { index, activate })` puts it in the bar with one
  `tab-created`. Hidden tabs are closed at session restore.
- Events `on(name, fn)` (returns the unsubscribe): `tab-created | tab-activated | tab-closed |
  tab-updated | tab-navigated (tab | undefined, browser, { url, sameDocument, errorPage }) |
  tab-loading (tab | undefined, browser, loading) | tab-crashed (tab | undefined, browser: the page's
  content process died, after Firefox's own handling) | render | settings (settings, changedKeys) |
  ctrl-up (reason: 'key' | 'blur') | page-message (tab | undefined, name, data: unknown, { browser,
  browsingContext, isTop }) | ready | closing`. The two navigation events also fire for browsers
  outside `tabs` (peeks), and so does `tab-crashed` (find closes keeping its query, a page menu
  closes, a peek reloads its page in a fresh sheet page, or closes if it crashes again within 30 s).
  `install(b)` runs at DOMContentLoaded, before first paint; Firefox's lazy UI objects exist only
  after `ready` (also `await b.whenReady`). `onDestroy(fn)` runs when the window closes (after
  `closing`): unsubscribe there from singletons that outlive the window.
- Plug-in points: `registerAction(actionId, fn)` (ids in `src/shared/shortcuts.ts`; overrides the
  built-in and returns a function that puts the previous one back), `builtin(actionId, arg)` (the
  built-in behaviour, for an override that only adds to it), `run(actionId, arg)` (while a panel is
  open, `panel-open` on `b.root`, the page actions in `PAGE_ACTIONS_UNDER_PANEL` do nothing: back,
  forward, reload, zoom, print, save, source, developer tools, peekLink, openAsTab, downloadVideo),
  `keys.addHook(fn, { first? })` (state-dependent key routing; `first` runs before every other hook:
  an open menu), `addEscLayer(priority, handle)`, `addCloseLayer(priority, handle)`
  (priorities: menu 20, popover 30, latched switcher 40, element full screen 50, panel 60, Deer field
  70, parked find 90, peek 100), `escape()`, `interceptOpen(fn)` (modified clicks and, with source
  `'window-open'`, `window.open` / `target=_blank`; the latest interceptor is asked first; load a taken
  request with `openLink(request, where)`), services (`provide`, `service`, `whenService`, below),
  `layer(id, z)` (z: home-bg 7, peek 8, omni-scrim 9 (core; a module layer at 9 made after boot paints
  over the dim: find-ring, downloads-video), bar 10, peek-rise and downloads-ring 11, find 12, omnibox
  20, panels and popovers 30, switcher 40, downloads-flight 45, menus 50, downloads-prompt 55 (the quit
  prompt: it closes an open menu and the switcher first), tips 60 (core)),
  `css(id, text)`, `scrollThumb(scroller)` (`scrollthumb.ts`: the panels' 2 px overlay scroll thumb in
  place of Gecko's scrollbar), `setHomeTheme(theme)`, `holdTheme(theme)` (the glass reads `theme` while a module's
  own full-window surface covers the page; returns the release), `closePanels()` (hides Firefox's open panels, not the permission doorhanger,
  which PopupNotifications owns: it is suppressed while the address field is open), `luma(browser, rect)` and
  `snapshot(browser, rect, scale)`, `anchor(kind)` (the element native popups hang from) and
  `setAnchor(kind, fn, { popups: [popupIds], position })` (the anchor router hangs the popups listed
  from that element, so a module never edits `anchors.ts`).
- Page side: `b.page(target)` where target is a Tab, its id, a `<browser>` (peek) or a browsingContext
  (one frame): `.send(name, data)`, `await .query(name, data)`, `.sendAll(name, data)` and
  `await .queryAll(name, data)` (one answer per frame, with `browsingContext` and `isTop`); and
  `b.on('page-message', (tab, name, data, from) => ...)`, carried by the `VitrePage` actor. A
  compromised content process can send any name with any data: narrow `data` before use.
- Singletons: `sys('VitreSettings')` etc., typed through `VitreSysModules` in `gecko.d.ts` (add yours
  there by declaration merging; an unknown name does not compile).

### Keyboard (`src/window/keys.ts`, bindings in `src/shared/shortcuts.ts`)

Firefox's keysets are parked and its system-group tab handlers are hidden from; only Deer's map runs.
Browser-first keys are taken in the chrome capture phase. Page-first keys call
`event.requestReplyFromRemoteContent()` and act on the reply only if the page did not use the key.
Letters match by `event.keyCode`, comma by keyCode 188, digits by physical code. Guards: AltGraph,
IME composition, key repeat, Win-modified chords. Under keyboard lock browser-first keys become
page-first through the keydown-reply variant. Esc belongs to a page `<dialog>` / popover (reported by
the page module `src/actors/page/keys.ts`), an `alert()` / print preview / auth prompt over the
selected tab or over the open peek's page, or an open native panel, before Deer; an Esc pressed in
Deer's own layer (a panel over a prompt) is Deer's.

For modules: `b.keys.addHook((binding, event) => 'browser' | 'page' | 'pass' | 'swallow' | undefined,
{ first? })` runs on every keydown before the router acts (the second Esc on a peek, find's F6, the
latched switcher taking global keys; an open menu's hook is `first`, so it sees every key before the
others); `b.keys.current` is the key that is running an action (its `browser` is the
focused page: tab or peek); `b.keys.bindings()` lists the map with rebinds applied; the router does
nothing while focus is inside a `[data-key-capture]` element. Keys that belong to one surface (the
address field's Enter, a menu's arrows) are handled by that surface on keydown with `preventDefault()`.
Hardware browser keys and mouse side buttons arrive as `AppCommand` and run the same actions.
Page actions act on the topmost page: `window.vitrePeek` (`{ browser(), close(), open?(url) }`, set by
the Peek module) while its page has focus, else the active tab.

## Feature modules and their services

Seven feature modules sit on the core. Each lives in `src/window/modules/<key>/` (contract in its
`index.ts` header), keeps every Firefox internal it uses in its own `gecko.ts` / `fx.ts` with the
source file named, and is tested by `tests/<key>/` (the builder's suites) and `tests/<key>-verify/`
(the verifier's attack suites, which also rerun the builder's). `tests/integrate/` runs them together.

Services (`b.provide` / `b.service` / `b.whenService`; types declared next to the provider with
`declare global { interface VitreServices { name: Api } }`). A consumer reads a service at the moment
of use and copes with its absence (a build may leave the provider out); members marked "addition"
are optional for callers and were added during the build, the rest is the agreed contract.

| Service | Provider | Members | Additions | Used by |
|---|---|---|---|---|
| `peek` | peek | `open(urlOrRequest, opts?)` (opts: `origin` rect, `browser`, principals), `isOpen()`, `browser()`, `close()`, `promote()`, `headerRect()`, `canReopen()`, `reopen()` | `headerSlot(on)` (find's capsule slot; hides the header's domain and path), `search(text, opts?)`; window event `vitre:peek` (`detail.phase`: open, closing, promoting, closed); `window.vitrePeek` `{ browser(), close(), open(url) }` for the core | menus, find, downloads |
| `find` | find | `open({ query?, browser? }?)`, `close()`, `isOpen()` | | menus |
| `menus` | menus | `show(items, at, { align?, onClose? })`, `close()` | `isOpen()`, `editItems(field)`; `MenuItem.access`, `.bold`; show options `keyboard`, `label`, `owner`, `gap`, `touch`; `onClose` also runs when nothing could be shown | find, peek, downloads, extensions |
| `downloads` | downloads | `download(urlOrRequest, { browser?, filename?, saveAs?, referrerInfo?, triggeringPrincipal? })`, `openPanel()`, `videoPicker()` | options `origin` (where the file flies from), `isPrivate`, `cookieJarSettings` (the page's); `openPanel(focusId?)`; `mediaState(browser?)`, `isPanelOpen()` | menus |
| `settings` | settings | `open(pageId?, query?)`, `registerPage({ id, title, icon?, order, render })` | page `keywords`; `isOpen()`, `close()`, `changeBackground()` (Home's popover on Home, else Settings › Home and background) | menus, downloads (Video downloads, 51), extensions (Extensions, 65) |
| `extensions` | extensions | `openPanel()`, `count()` | | |
| `switcher` | switcher | `open('cycle' \| 'latched' \| 'search')`, `isOpen()` | `close()` (cancel as Esc does) | downloads (the quit prompt) |

`tests/integrate/services.js` checks every provider against this table. Consumers read a service
typed by its provider's declaration (`b.service('menus')` is `MenusApi | undefined`), never through a
local look-alike type, so a contract change fails `tsc`.

- **Peek** (`modules/peek/`, page module `actors/page/peek.ts`): Shift+click, Shift+Enter or Ctrl+Q opens
  a link in a glass sheet over the dimmed page; the sheet is a hidden real tab (`b.openHidden`), Open
  as tab (Alt+Enter) is `b.adopt` (no reload). Esc page-first then the ladder (100), Ctrl+W close layer
  100, a second Esc within 400 ms closes even on a page that keeps Esc. Holds the bar while a sheet is
  up; its page gets no top strip (`INSET_OFF_KEY`). Tests: `tests/peek` (open, hop, promote, esc,
  real, permission, fullscreen, session, extras), `tests/peek-verify` (+ ladder, windows, scale, pages,
  core, idle, reduced, motion, actions, restore; `regress.py` for the core suites).
- **Find** (`modules/find/`, page module `actors/page/find.ts`): Ctrl+F turns the active pill into its
  480x44 find face (z 12), or a 440x32 capsule in a peek's header; `browser.finder` with Deer's
  counter, ring and scroll guard; a per-tab findbar stand-in lets pdf.js search. Esc layers 70 (field)
  and 90 (parked). While the face shows it claims a 480 px pill (`b.bar.claimPill`): with many tabs
  the circles shrink and give way instead, so the field keeps its room. A page whose process crashes
  closes its find (query kept). Tests: `tests/find` (core, contexts, peek, motion, reduced),
  `tests/find-verify` (+ ladder, windows, scale, pages, restore, idle, mouse, counts).
- **Menus** (`modules/menus/`, page module `actors/page/menus.ts`): replaces Firefox's page menu
  (cancelled on `popupshowing` after Firefox and the extensions built it) and every menu of Deer's
  layer (pill, circles, +, text fields: Firefox's native textbox menu is prevented in the capture
  phase); the drag strip and window controls keep Windows' system menu. Key hook `first`, Esc 20.
  No submenus (design): a row with children is listed in place under a caption with its label
  (`types.ts flatten`: an extension's nested items). A right-click away from the page's selection gets
  the page or link menu, and a link's menu adds Copy only for a selection inside the link (the page
  module's `menus:hit`). Destructive rows are drawn like any row.
  Tests: `tests/menus` (pages, keyboard, chrome, ext, look + `check.py`, real, integration),
  `tests/menus-verify` (+ attack, modules, extpopup, leak, idle, scale, restore).
- **Switcher** (`modules/switcher/`, singleton `modules/VitreSwitcher.sys.ts`): Ctrl+Tab held or
  latched, Ctrl+Shift+A with search; deck (default), grid or strip (`switcherStyle`); thumbnails by
  `drawSnapshot` with a JPEG cache in `<profile>/vitre-thumbs`. Owns nextTabMru / prevTabMru
  (tabs change on release), Esc and close layers 40, `holdTheme('clear')` and `vitre-switcher-cover`
  while the deck or grid is up. Tests: `tests/switcher` (styles, keys, mouse, search, thumbs, motion,
  smoke), `tests/switcher-verify` (+ ladders, windows, scale, stress, restore, pages, input).
- **Settings** (`modules/settings/`): the 960x688 panel (Ctrl+, F1, Ctrl+Shift+Delete), every page
  wired to `VitreSettings`, rebinding of the four rebindable verbs, Clear browsing data (Sanitizer),
  Home's background popover; other modules add pages with `registerPage`. Panel state `panel-open`
  and `settings-open` on `b.root`; Esc and close layers 60. Tests: `tests/settings` (pages, rebind,
  clear, picker, appicon), `tests/settings-verify` (ladder, keyboard, windows, scale, restart, hung, a11y,
  integration).
- **Downloads** (`modules/downloads/`, engine `modules/VitreDownloads.sys.ts` + `modules/downloads/*`,
  page module `actors/page/downloads.ts`): IDM-style segmented engine (one network partition per
  connection), take-over of Firefox's downloads, HLS / DASH joined by ffmpeg (`-c copy`), yt-dlp with
  Deno for sites that never play from a file address (YouTube), DRM never offered; the panel
  (Ctrl+J), the ring, the "Download this video" pill and picker (Ctrl+Shift+D), the pill's download
  mark, the quit and private-window prompts, Settings › Video downloads. ffmpeg, yt-dlp and Deno are
  not bundled: Deer downloads them only when the person asks there, from their GitHub releases, and
  installs them only when they match the published SHA-256 (`ffmpeg-install.ts`, `ytdlp.ts`). They go
  to `%LOCALAPPDATA%\Deer\ffmpeg` and `\tools`; copies from before the rename in
  `%LOCALAPPDATA%\Vitre\ffmpeg` and `\tools` are found and used where they are, never moved, deleted
  or downloaded again (ffmpeg is looked for in the settings path, beside the program, Deer's folder,
  the old folder, then PATH). The pref `vitre.localAppData` stands in for `%LOCALAPPDATA%`:
  `tools/run.py` points it into each throwaway profile, so tests never read the person's real copies.
  Safety as Firefox's own downloads: names through Firefox's validator
  (`naming.ts`), Safe Browsing on every file the engine fetched (`reputation.ts`), Firefox's prompt
  before opening an executable that is not an .exe, page-derived addresses fetched with the page's
  principal, cookie jar and referrer policy (`principals.ts`, `net.ts`). The quit prompt sits at z 55
  over everything it must not hide under. The panel scales as a whole below 992x720 and opens in the
  main window from a popup. Tests: `tests/downloads` (engine, restart, takeover, crosssite, mark, spa,
  ytdlp, streams, noffmpeg, faults, drm, ui, safety, folders; perf and ytdlp-real on demand; the
  ffmpeg download against a local stand-in release: `tests/downloads/ffmpeg-install.py`),
  `tests/downloads-verify` (+ v-keys, v-windows, v-core, v-scale, v-pages, v-rapid, v-restore,
  v-measure).
- **Extensions** (`modules/extensions/`, singleton `modules/VitreExtensions.sys.ts`): pinned
  browserAction widgets in a CustomizableUI area inside the active pill (the address keeps at least
  140 px), Firefox's extensions button and panel, page actions drawn by Deer, popups and doorhangers
  hanging from the bar (holding it), menus through the `menus` service, Settings › Extensions,
  temporary add-ons re-installed at start. Tests: `tests/extensions` (bar, install, settings, persist,
  private, update, fallback; `runx.py` composites popup windows, `make-extensions.py` builds the test
  packages), `tests/extensions-verify` (+ keys, core, stress, idle, windows, scale, restore, panel, edge,
  rapid, realsite).

Cross-module behaviour worth knowing: the menus' Peek link / Download linked file / Save image as… /
Find selection / Settings rows go through the services above; find in a peek uses `headerSlot` and
closes with the sheet (`vitre:peek` closed); a promoted peek is an ordinary tab for the switcher; the
download mark and the extension buttons share the pill's right end (mark slot 410..438 always kept,
cluster before it); Downloads and Settings are panels (one at a time: `downloads-open` /
`settings-open`); any menu whose owner is in the bar, an extension popup and a peek hold an
auto-hidden bar on screen.

## Settings, data, pages

- Settings: `vitre.*` prefs through `VitreSettings.sys.ts` (`get()`, `set(patch)`, `onChange(fn)`),
  same `Settings` interface as `app/src/shared/settings.ts`. Call `Services.prefs.savePrefFile(null)`
  after changes that must survive a crash. Values are validated on read (`rebind` keeps only
  rebindable actions with a string spec). Settings Firefox's own code must know about are mapped in
  one place, `syncEngine()` there: `newTabPosition` -> `browser.tabs.insertAfterCurrent`; `theme`
  (Match Windows / Light / Dark) -> the enabled built-in theme (`default-theme`, `firefox-compact-light`,
  `firefox-compact-dark`), which decides the colour scheme of prompts, native panels and pages alike.
  A feature's own settings are observed by the feature's singleton itself.
- App icon (`appIcon`, Settings › Appearance): gold (default, `vitre.ico`) or orange (`deer-orange.ico`),
  both in `<engine>\browser\chrome\icons\default\`, built from `design/icon/` by `tools/make-icon.py`.
  `VitreAppIcon.sys.ts`: new windows get root `icon="<name>"` (VitreStartup.brandWindow); a change
  switches open windows (`nsIWindowsUIUtils.setWindowIcon`) and points an installed Deer's shortcuts
  (install.ini's Start menu / Desktop, the taskbar pin) at the .ico (`nsIWindowsShellService.setShortcutsIcon`);
  at startup it re-points them if an update recreated them. Firefox's CustomIconManager stays off.
- History, session restore, closed tabs, clear-data: Firefox's (Places, SessionStore, Sanitizer).
- Home: `about:vitre-home` (registered synchronously at boot; new-tab and home page), a static
  privileged page (`src/pages/home`) with a strict CSP showing the wallpaper/image/video background.
  `VitreHome.sys.ts` finds the Windows wallpaper, keeps a screen-sized copy in `<profile>/vitre-home`
  and holds the glass theme the background calls for (light or clear), which every window follows.
  New tabs never flash white or grey: Firefox's new-tab preloading (`NewTabPagePreloading`) is
  switched back on for Home (`VitreStartup.useHomeAsNewTab`), so each window keeps one Home drawn in
  a hidden browser for the next new tab; a Home page that does load from scratch starts from the
  picture `VitreHome` remembers in memory, shows it only once decoded, and paints the picture's mean
  colour under it until then (tests `input/home-preload.js`, `input/home-flash.js`). Decoded
  pictures are not locked (`imgIRequest.lockImage` hung the browser when such a tab closed).
- Address field history: Places SQL in `src/window/places.ts` (hosts first, then a frecency-ordered
  scan; a newer search interrupts the running one). Search engines: Deer's own list in
  `src/shared/settings.ts`.
- Version: Settings › About shows the installed `deer-version.json`'s version, else `version` in
  `gecko/package.json`, which `tools/build.mjs` bakes into every bundle as `__DEER_VERSION__`.
- Product defaults live in `runtime/defaults/pref/vitre-prefs.js` (Firefox messaging, telemetry
  upload, shortcut creation, default-browser prompts, native find/typeahead, Ctrl+Tab panel: off;
  standard scrollbars, plain error pages). Edit the tracked copy in `tools/runtime-overlay/` and run
  `python tools/setup-runtime.py` (and `tools/setup-engine.py` for the release engine). Gecko reads that folder before Firefox's own `firefox.js`, so
  `config.js` applies the file again afterwards.

## Updates

`src/modules/VitreUpdater.sys.ts` (contract and file layout in its header), started by `VitreStartup`
at `final-ui-startup`, where it only reads the install. Window side: the Updates card in
Settings › About (`settings/pages.ts`, status lines in `src/shared/update.ts`), the note
(`window/modules/updates.ts`) and the + circle's menu row (`menus/chrome-items.ts`).

- **Only an installed release updates**: `<install>\deer-version.json` (written by `installer/build.py`)
  says channel `release`, and `<install>\install.ini` (Deer Setup's record) exists and is not a test
  install, where `<install>` is the parent of the engine's folder (`<install>\engine\deer.exe`). A
  development run, a local-test build, a test install or a release folder that was never installed
  never contacts anything; About says "Updates are off in development builds".
- **What is contacted**: `GET https://api.github.com/repos/droidboy08-hub/deer/releases/latest`
  (prefs `vitre.update.apiBase`, `vitre.update.repo`) and, only when that release is newer, its
  `SHA256SUMS.txt` and `Deer-Setup.exe` assets (GitHub's download links). No identifiers, no
  telemetry, no cookies or credentials, no query string: the browser's own request headers plus
  GitHub's `Accept` and API version.
- **When**: automatically at most once a day (`vitre.update.auto`, default on; `vitre.update.lastCheck`
  holds the last time in seconds), the first check `vitre.update.firstDelay` seconds (300) after start,
  never during startup; and when the person clicks "Check for updates".
- **What is offered**: a tag `vX.Y.Z` above the installed version (semver; drafts and prereleases,
  flagged or by tag, never). The setup is downloaded to `%LOCALAPPDATA%\Deer\updates` (a `.part`
  continued with a Range request; older versions and stray files removed) and staged only when its
  size is the one the API gives and its SHA-256 the one in `SHA256SUMS.txt` of the same release (and
  GitHub's asset digest, when present). Errors read as one sentence in the status line.
- **Addresses and answers**: with the default API base, asset links must be
  `https://github.com/<repo>/releases/download/...` and every answer must come, after redirects, from
  `api.github.com` (the API) or `github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com` (files) over https; a stand-in base (tests) keeps everything
  on its own host. The API's JSON and `SHA256SUMS.txt` are read within 30 s without a byte, 2 minutes
  in all, 1 MB and 64 KB; a stalled answer ends the check with one sentence.
- **Apply**: "Restart to update" (About; the note "Deer <v> is ready", shown once per version
  (`vitre.update.notified`); the + menu while an update waits) hashes the file again, asks to quit as
  Firefox's restart does (`quit-application-requested` "restart"; the downloads quit prompt may hold
  it back and its "Restart" goes on through `proceedRestart()`, which hashes the file once more; any
  other quit or restart asked for meanwhile drops the held one), sets
  `browser.sessionstore.resume_session_once`, and at `quit-application` holds the setup open with read
  sharing only, hashes it a last time and starts
  `Deer-Setup.exe /update /installdir:<install> /wait:180 /launch /log:<updates>\setup.log /sha256:<hex>`
  with nsIProcess, which outlives the browser; a setup that changed since the click is not started. A
  quit that a page refuses ("leave this page?") stops the update at once (ready again, the session flag
  cleared). Setup checks `/sha256` against its own file and keeps that file held while it runs (the
  elevated copy of an all-users update starts from it), waits for Deer to close (and for another
  setup, up to `/wait`), installs over it and starts it again, also when it stops early
  (`installer/Setup.cs` UpdateMain). The next start reads `setup.log`'s `RESULT` and says why an
  update did not install; a damaged setup (4) is dropped and downloaded again; a release whose setup
  turned out to be another version than its tag (0 or 6 with the install still older) is remembered
  in `vitre.update.skip` and not offered again until its setup changes. For an all-users install
  (`install.ini` `Scope=machine`) setup asks for administrator permission itself; About and the note
  say so first.
- **Signed releases**: once `gecko/update-key.txt` exists (`tools/release-key.mjs new`, the owner's
  step before the first public release), every build carries the release key's public half
  (`__DEER_UPDATE_KEY__`) and a release must also have `SHA256SUMS.txt.sig`, the Ed25519 signature of
  that exact `SHA256SUMS.txt` (`installer/build.py --sign-key`), or nothing is downloaded: a release
  that is not the owner's (a stolen account or token, a repository name claimed after a rename) is
  refused. Without the file (today) releases are trusted as GitHub serves them. Not covered either
  way: a program running as the person can replace the staged setup and its record together before
  the click (the setup is not Authenticode-signed).
- **Turning it off**: Settings › About › Check automatically (`vitre.update.auto` false). "Check for
  updates" still works on demand.
- **Tests** (`tests/update/all.py [--port N] [--name-prefix P]`): a local stand-in for GitHub
  (`release_server.py`, with hostile scenarios: a stalled answer, oversized answers, links on other
  hosts, redirects elsewhere), the install stood in by `VitreUpdater.testInstallDir`,
  `vitre.update.testCommand` started instead of the setup (honoured only while that stand-in is set;
  `fake_setup.py` records its arguments and outlives Deer), and `tools/run.py --until-exit` for the
  runs that quit Deer (apply, prompt, toctou: the setup replaced after the click is never started).

## Extensions

Firefox add-ons from addons.mozilla.org; the Chrome Web Store cannot work on Gecko. No blocker is
bundled: the person installs one. The request-blocking API a blocker needs (MV2 `webRequest`
blocking, MV3 `declarativeNetRequest`) was proven on this engine under Deer's interface
(`spikes/extensions/RESULT.md`); uBlock Origin itself has not been tested in Deer. Pinned extension buttons are Firefox's real widgets inside the pill's `.accessories` area;
the extensions button opens Firefox's panel. Install, permission and update prompts anchor to the bar.
Unsigned add-ons load only as temporary add-ons, re-installed at every start (the user's decision,
DESIGN-NOTES "Ad blocking and extensions"); signing is never waived. Their cost: a restored tab
loads before such a blocker is back, until it is reloaded.

## Tests and captures

```
python tools/run.py --test tests/<feature>/<script>.js --name <unique> [--url U] [--app build-<name>] [--timeout 90]
```

The runtime starts with Deer loaded; the test script then runs in the window with `spike` helpers
(`spike.log`, `await spike.capture('name')` = real composited screenshot, `spike.main`). Tests run with
`focusmanager.testmode=true`; synthesize input in-process (EventUtils from
`chrome://remote/content/external/EventUtils.js`, `window.synthesizeMouseEvent`), never OS input.
Panels are separate windows and do not appear in window captures. Each `--name` has its own throwaway
profile, deleted after the run. Use a unique name per agent; names must not be prefixes of each other.
Pages render in the light colour scheme under the harness (`layout.css.prefers-color-scheme.content-override`):
a test that wants a dark page gives it dark colours itself.
`python tests/core/all.py` runs the core set (smoke, shell, api, restart, session, adopt, noboot,
brand (no "Vitre" left anywhere a person reads: titles, taskbar id, brand strings, every Settings
page, the Downloads panel), app, launcher); `python tests/shell/all.py` runs the shell and glass set (look, states, chrome) and
measures the lenses in its captures (`tests/shell/check.py`; every measured capture must be checked,
and the script asserts the number of pixel checks); `python tests/input/all.py` runs keys, actions,
omnibox, home, inset, edges (the inset's edge cases), restart and crash (`tests/input/lib.js` has the key-synthesis and "did Firefox do
anything" helpers). `tests/core/api.js` is the regression script for the module hooks above and for
the review findings (error card, prompt accent, PDF viewer, sampling, lens cache, guards).
The core, shell and input sets run on `build/`, i.e. with every feature module installed; where a
module changes a core behaviour on purpose the test checks the module's behaviour when the module is
present (`tests/input/actions.js`: a held Ctrl+Tab with the switcher; `tests/input/omnibox.js` and
`tests/shell/look.js`: the extension buttons in the pill).

`python tests/update/all.py` runs the updater's suite (check, key, about, dev, schedule, refuse, apply,
prompt, toctou; see "Updates"). `python installer/test.py` runs the installer end to end in test mode,
`python installer/tests/migration.py` the profile copy and the development launcher, and
`python installer/tests/engine_check.py` what `installer/build.py --check-engine` refuses.
Feature suites: `python tests/<key>/all.py` and `python tests/<key>-verify/all.py` for each key above
(each runner's docstring lists its suites, builds and network needs; most build their own
`build-<key>...` folders, find-, peek-, switcher- and downloads-verify take `--app build-x`).
`python tests/integrate/all.py [name ...] [--app build-x] [--no-build]` builds `build-integrate`
(every module) and runs the cross-module flows: services (the table above), inset (the strip under a
hidden bar, F11, the PDF viewer), menus (Peek link, Download linked file, Save image as…, Find
selection, Settings, Show downloads; no native menu), peek (find in a peek, promote, the switcher),
pill (0 / 1 / 3 / 8 extensions with and without the download mark and a running download: the
address stays whole and centred), settings (switcher style, auto-hide, page inset, rebinds and the
downloads folder changed in the panel take effect in every module and window; Settings › Extensions)
and ladder (Esc and Ctrl+W with menu, find, peek, Settings, switcher, address field and Downloads
layered). Its downloads go to `%TEMP%\vitre-integrate`; native file dialogs are answered by a stand-in
`nsIFilePicker` (`I.mockFilePicker` in `tests/integrate/lib.js`).

## Rules

- Every Firefox internal used (ids, private methods, category names) is version-157 behaviour: keep it
  behind one small function with a comment naming the source file in `reference/omni`, so a runtime
  update is a checklist (`src/window/firefox.ts` for the window core, the top of each `.sys.ts` for
  singletons, the page module's header for page-side internals).
- Never touch the user's real Firefox (`C:\Program Files\Mozilla Firefox`, `%APPDATA%\Mozilla`).
- Never download extensions or executables in tests. DRM-protected media is never downloadable.
- Never touch the person's own Deer data in tests (`%LOCALAPPDATA%\Deer`, `%APPDATA%\Deer`, the old
  `%LOCALAPPDATA%\Vitre`): throwaway profiles in `%TEMP%`, and `vitre.localAppData` for the tool and
  update folders. Tests never contact GitHub and never start a real setup.
- Publishing: `runtime/` is Mozilla's branded Firefox binary with changed behaviour: never publish it.
  Releases ship Mozilla's unbranded build through `tools/setup-engine.py` and `installer/build.py`
  (`../docs/BUILDING.md`).

## Decisions for the user

Choices the feature builds made where the design is silent or Gecko forces a departure. Each is in
the code as described; the user may want it otherwise.

- **Page strip under a hidden bar** (integration): with auto-hide on or in F11 pages get no top strip,
  and a reveal of the bar (pointer at the top, a hold) does not bring it back: the bar floats over
  the page's top and nothing reflows. The alternative, the strip following every reveal, makes every
  page jump 68 px each time the pointer touches the top. Decided by the owner (2026-10-06): the window
  controls (and a private window's label) hide and come back with the bar in auto-hide too, not only
  in F11, and auto-hide is the default (`DEFAULT_SETTINGS.barAutoHide`; `tools/run.py` turns it off
  for tests, `tests/shell/chrome.js` checks the default). Switching the bar to Always turns the strip
  on as well (`VitreSettings.set`; it can be turned off again afterwards).
- **Address with extension buttons** (integration): the favicon + host stay at the pill's middle while
  they fit beside the buttons; with many buttons (five fit) a short host sits as near the middle as the
  box allows, right against the buttons; a host too long for the box is cut at its end.
- **Element full screen and developer tools on a peek** promote it to a tab first (the design has the
  sheet fill the window and settle back). `window.open(url)` from a sheet loads in the sheet and returns
  null to the page. One warm peek is kept. The peek header has no dark variant. The discovery hint's
  "bounce" rule (a link followed and left within 30 s, twice in 10 minutes) is the builder's. A page
  whose process crashes in the sheet is loaded again from the last link the sheet was asked for (where
  the person had navigated inside the sheet is lost); a second crash within 30 s closes the sheet.
- **Link status bubble** (review 2): Firefox's own `#statuspanel` is drawn as the PeekDiscover bubble
  (12 px from the corner, 30 px, dark frost) in every mode and over any page; it keeps Firefox's rule of
  moving to the bottom-right corner when the pointer comes near it.
- **Find**: Firefox's count limit reads "1 of 1,000+" (the board's "1 of 4,812+" has no Gecko
  equivalent); while find is open #hash links and `scrollIntoView()` land under the bar (the scroll
  padding is off so the guard can lift a match to y 92 as the board wants); a new query searches on
  from the current match (Firefox's findbar behaviour); the peek capsule is light only and grows by a
  clip reveal from its left edge. With many tabs the face keeps a 480 px pill and the other circles
  shrink or give way while find is open (the design says nothing else moves when find opens; it does
  not cover a pill squeezed below 480; the alternative is a face drawn over the neighbouring circles).
- **Switcher**: the deck shows pictures, never live pages (a playing video freezes on its card); the
  strip uses CSS frost, not the SVG strip lens (the lens intermittently showed the raw page); the deck
  hides its neighbours' labels; the dock rises from 160 ms (TabMotion's text says 140); the IME rule
  "with an IME on, the first key only latches" is not implemented.
- **Settings**: rows with no setting behind them are left out (Accent color, Transparency, Refraction,
  Tint glass with site colors, Tab bar on the home page, the popover's Dim slider and "Show tabs on the
  home page"), so the Home popover is 358 px tall and its third tab reads "None"; the board's 0.6-white
  descriptions measure about 4:1 over light pages (below 4.5:1) and are kept; over bright wallpapers the
  popover's tint is deepened to 0.72; developer tools keys do nothing while a panel is open. The
  canvas shows Windows dark mode only: Settings and the Downloads panel (and its quit prompt) follow
  Appearance › Mode with the Windows 11 light set in Light; the downloads quick view and video picker,
  like Home's background popover, stay dark glass over the page. Panel scrollers carry the board's 2 px
  overlay thumb, always shown while the content overflows (it does not widen for dragging).
- **Downloads**: the board's "Schedule downloads" button is not built (no scheduler design); the quit
  and private-window prompts are not on any board (panel frost, 400 px, Keep downloading as the
  default); "Download copied link" in the ring menu reads the system clipboard. Safe Browsing (review
  2): a file reported dangerous is deleted and its row fails with the reason; an uncommon or
  potentially unwanted one waits as "<name>.blocked" with Keep file and Retry (no board shows these
  states); the SHA-256 for the remote lookup is read from the finished file (binaries only) and no
  Authenticode signature is sent, so a signed but rare program can be judged "uncommon" where
  Firefox would pass it. Page-derived downloads (Download linked file, Save image as…, Alt+click) are
  fetched as Firefox's Save Link As fetches them: the page's principal, its referrer policy, third-party
  cookies allowed; a download another site's page starts and that Deer takes over keeps the
  integration's stricter cross-site rule. Below 992x720 the panel is scaled as a whole (its text gets
  small in a very small window, as Settings').
- **Menus**: Shift+right-click still lists extension items (no Shift tier in the design); extension
  items may push a menu past the 10-row limit (more so now that an extension's nested items are listed
  in place under captions instead of a submenu); the overlay scrollbar is Gecko's thin one, not 2 px; in
  element full screen menus use the solid material.
- **Extensions** (no board exists): the cluster is not drawn on Home or in popup windows (there
  `openPanel()` opens Settings or nothing); pinned buttons give way below a 140 px address and the
  cluster below 100 px; page actions come before pinned buttons; Firefox's wording is replaced by "Pin
  to tab bar", "Manage extension", "Remove extension…"; "<name> was added" hangs from the extensions
  button. The signing waiver stays off (DESIGN-NOTES); a per-start patch of Firefox's signing check is
  possible but turns signature checks off for every add-on while active. Settings › Extensions is laid
  out as the other Settings pages (a card of rows: Get add-ons [Browse], Load a temporary add-on
  [Choose…], Updates [Check for updates]; the add-ons manager as a last row with "Open ›").
