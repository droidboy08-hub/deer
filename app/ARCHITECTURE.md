# Vitre app architecture

Electron 44 (Chromium), TypeScript, esbuild. No UI framework: the chrome is plain TypeScript and CSS.
The design is the source of truth: `../design/DESIGN-NOTES.md`, `../design/keymap.json`, and the canvas
boards in `../design/canvas/project/*.dc.html` (HTML with exact sizes, colours and copy).

## Processes

- **Main** (`src/main/`): one frameless `BrowserWindow` per Vitre window. History, session, settings
  stores (JSON in userData). Pages are `<webview>` guests in the `persist:vitre` session; every guest is
  hardened in `will-attach-webview` (sandbox, contextIsolation, Vitre's page preload).
  Browser-first shortcuts are caught in each guest's `before-input-event` and sent to the window.
- **Chrome renderer** (`src/renderer/`): the window's UI. Pages are `<webview>` elements in `#views`,
  so the glass (CSS `backdrop-filter` with SVG displacement lens maps from `glass.ts`) really bends the
  page, and anything can animate with CSS. Webviews must never be re-parented in the DOM (that reloads them).
- **Page preload** (`src/preload/page.ts` + `page-modules/*`): runs in every page's isolated world.
  Page-first shortcuts are forwarded only when the page didn't `preventDefault` (checked after dispatch).
- **Chrome preload** (`src/preload/chrome.ts`): `window.vitre` API (see `src/shared/types.ts`).

## Feature modules (auto-discovered by build.mjs)

| Where | Folder | Export | Gets |
|---|---|---|---|
| Main | `src/main/modules/<name>.ts` or `<name>/index.ts` | `register(ctx: MainContext)` | `src/main/context.ts`: session, settings, onGuest(wc), hostWindow, broadcast, createWindow |
| Renderer | `src/renderer/modules/<name>.ts` or folder | `install(b: Browser)` | the `Browser` class in `src/renderer/app.ts` |
| Page | `src/preload/page-modules/<name>.ts` | side effects | `ipcRenderer` (sendToHost / on) in the page's isolated world |

Renderer ↔ main for modules: `window.vitre.ipc.invoke/send/on` on channels prefixed `find:`, `menu:`,
`peek:`, `dl:`, `settings:`, `switcher:`, `home:` or `app:` (main side: `ipcMain.handle/on` in your module).
Page ↔ renderer: in the page, `ipcRenderer.sendToHost(channel, ...)`; in the renderer listen on the
webview's `ipc-message` event (`b.on('webview-created', (tab, wv) => ...)`), send with `wv.send(channel, ...)`.

### Browser API for modules (`src/renderer/app.ts`)

- State: `tabs`, `activeId`, `active()`, `mru`, `settings`, `bar.layout` (`pillRect`, `left`, `right`), `omni`.
- Tabs: `newTab(url?, {background, index})`, `closeTab(id)`, `activate(id)`, `navigate(id, url)`,
  `makeWebview(url)` + `viewsRoot()` + `adoptWebview(wv, {url,title,favicon,index,activate})` (Peek → tab
  without reload), `tabForWebContents(id)`, `focusPage()`, `editAddress(query?)`, `render()`.
- Plug-ins: `on(event, fn)` for `tab-created | webview-created | tab-activated | tab-closed | tab-updated |
  render | settings | ctrl-up`; `registerAction(actionId, fn)` (actions are in `src/shared/shortcuts.ts`;
  a registered action overrides the built-in one); `addEscLayer(priority, handle)` and
  `addCloseLayer(priority, handle)` (handle returns true when it used the key; priorities: menu 20,
  popover 30, latched switcher 40, element full screen 50, panel 60, Vitre field 70, parked find 90,
  peek 100); `interceptOpen(fn)` for links the page opens in a new tab/window (Peek takes Shift+click);
  `layer(id, z)` returns a full-window overlay div (pointer-events only on children; z: peek 8,
  bar 10, find 12, omnibox 20, panels 30, switcher 40, menus 50); `css(id, text)` injects a module's CSS;
  `escape()` runs the Esc ladder.
- Shortcuts already bound (no edits needed): find/findNext/findPrev, peekLink (Ctrl+Q), downloads (Ctrl+J),
  downloadVideo (Ctrl+Shift+D), settings (Ctrl+,), shortcutsHelp (F1), clearData (Ctrl+Shift+Delete),
  switcherSearch (Ctrl+Shift+A), nextTabMru/prevTabMru (Ctrl+Tab / Ctrl+Shift+Tab).
- Settings: `src/shared/settings.ts` (`b.settings`, `window.vitre.settings.get/set/onChange`; main: `ctx.settings`).

## Look and motion

Glass recipe and tokens are in `src/renderer/styles.css` (`.glass` with `.lens`, `.tint`, `.rim`;
themes `body.theme-light | theme-dark | theme-clear` via CSS variables `--g-*`). Lens filters:
`lens(w, h, opts)` from `glass.ts` returns a `backdrop-filter` value. Menus and panels use frost
(`blur(24px) saturate(1.6)`) with the tints in DESIGN-NOTES. Spring `cubic-bezier(0.22, 1, 0.36, 1)`,
expand `cubic-bezier(0.2, 0, 0, 1)`, reduced motion = 150 ms cross-fades. Font Segoe UI Variable.
No keycap or chip styling; keys appear as plain dim text in menus, tooltips and Settings.

## Build, run, test

- `npm start` (build + run), `node build.mjs`, `npx tsc --noEmit -p .` (type-check).
- Parallel work: `node build.mjs --out=dist-<name>` then `./node_modules/.bin/electron dist-<name>/main/main.js
  --profile=<name>` (its own userData in %TEMP%).
- Screenshots: `./node_modules/.bin/electron dist-<name>/main/main.js --capture --profile=<name> --out=shot.png
  --wait=4000 "--script=<url-encoded JS run in the chrome renderer after load>"`. The renderer exposes
  `window.browser` (the Browser). Example script: `browser.navigate(browser.activeId,'https://example.com');
  setTimeout(()=>browser.run('find'),3000)`.
