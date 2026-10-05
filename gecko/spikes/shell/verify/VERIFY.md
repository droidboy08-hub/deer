# Verification of the "shell" spike (Firefox 157, 2026-10-02)

Verifier folder: `gecko/spikes/shell/verify/`. Everything below was run in the runtime; logs and
captures are in `verify/out/`.

- `rerun.sh`: the spike's own boot scripts, unchanged, under `shell-verify-*` profile names.
- `run_verify.sh`: the verifier's scenarios (`boot-v-*.js`). `verify/chrome`, `lib.js`, `pages`, `ext`
  are copies of the spike's files; `verify/chrome/VitreShell.sys.mjs` has three marked additions
  (`VERIFY`): paint count in the timeline, and two router fixes behind `vitre.verify.improved`.
- `vlib.js`: `vv.activate()` (Gecko-level window activation without OS focus) and guarded REAL
  pointer input (SetCursorPos + mouse_event through js-ctypes; a button is pressed only while this
  window is under the cursor; the cursor is put back).
- `run_screen.py`: captures the screen at the window's client rectangle, so shell flyouts show.

All measurements are at 100 % display scaling (dpr 1) on a 2560x1440 screen. Nothing was tested at
125/150 %.

## Verdicts

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Hide Firefox's chrome, gBrowser intact | confirmed | `out/basic.log` (toolbox 0 px, browser [0,0,1264,792]), `basic-1-shell.png`, `tabs.log` |
| 2 | No native caption (also inTitlebar=0, popups) | confirmed | `out/titlebar0/basic-0-stock.png` vs `basic-1-shell.png`; `windows.log` popup NCHITTEST TOP/CAPTION/MINBUTTON |
| 3 | Baseline without router | confirmed | `vpopups-noroute.log`: doorhanger [-4,-4], app menu and extension popup never open; select/autocomplete fine |
| 4 | Sane anchors for PanelUI, doorhangers, extension popups | confirmed for those three, but **incomplete** | `vpopups.log`: doorhanger [362,60], follows the pill after a tab switch ([336,60]) and in a second window. Missed: site-info panel opens at the window corner, Ctrl+D throws (see "Refuted / gaps") |
| 5 | select, autocomplete, context menu | confirmed (only in an ACTIVE window) | `vselect.log`: 4 of 5 opens stay open; the one failure has `active:false` and the same happens without the shell |
| 6 | Notification bars, tab-modal prompts | confirmed | `popups-7-notification-bar.png`, `popups-8-alert.png` |
| 7 | Page fills window, bar above, hit-testing | confirmed, **except the blur** | `window.log`; real clicks in `vnative-clicks-drag.log` ((300,40) and (1000,30) reach the page, + opens a tab). The statement "backdrop-filter blur over the page visible" is refuted, see below |
| 8 | Drag region, resize borders | **now proven** (was partial) | `vnative-clicks-drag.log`: a real mouse drag on the strip moved the window by exactly (+140,+84) |
| 9 | Window controls | confirmed, also with a real pointer | `native.log` (posted), `vnative-clicks-drag.log`: one sizemode change per real click |
| 10 | Unconsumed mouseup double toggle | confirmed | `ncprobe.log`: raw-none toggles with no JS; raw-toggle/raw-maximize double; shipped single |
| 11 | Snap layouts on maximize | **now proven** (was partial) | `vnative-1-hover-max.png`: the Windows 11 snap flyout under Vitre's maximize button (seen twice) |
| 12 | Hover highlight of caption buttons | **now proven** (was unverified) | `vnative-hover.log`: `:hover` true on min/max/close with the real cursor; `vnative-2-hover-close.png` (red close) |
| 13 | Maximized, F11, reveal zone, auto-hide | F11 and maximized confirmed; **auto-hide reveal in a normal window refuted** | `vreveal.log`, see below |
| 14 | Element full screen | confirmed | `states.log`, `states-4-dom-fullscreen.png` |
| 15 | chrome://vitre/ at run time, injection routes | confirmed | `native.log` "injection" line |
| 16 | Category hooks for every window | confirmed | `windows.log` timeline (new, private, popup, torn-off), `states.log` (reopened) |
| 17 | Shell before first paint (AutoConfig registration) | confirmed and strengthened | `earlyv.log`: `paints:0` at beforeLayout AND at domContentLoaded. Note `early-first-paint.png` is taken >100 ms later (page already loaded), it is not the first frame; the log is the evidence |
| 18 | Bar reflects gBrowser, busy/progress | confirmed for events/title/favicon/busy; **progress fraction is not real** | `tabs.log`; `vprogress.log`: 1-2 onProgressChange calls per load (100 %, or 87 % then 99 %) |
| 19 | Captures 1/3/12 tabs, 1280 and 900 | confirmed | `tabs-*.png` |
| 20 | Pill as address field, key commands | confirmed | `native.log` keys step |
| 21 | Private and popup windows | confirmed | `windows.log`, `windows-3-popup-window.png` |
| 22 | Session restore | confirmed | `session.log`, `session-2-restored.png` |
| 23 | Content crash and revive | confirmed | `states.log`, `states-6-tab-crashed.png` |
| 24 | Light/dark from a snapshot | confirmed (the "blur stand-in" is tint only) | `tabs-12-1280.png` light, `tabs-12-mid-1280.png` dark |
| 25 | Start a window move from script | **refuted as not-possible: it works** | `vnative-pilldrag.log`, `vnative-pillmax-wheel.log`, see below |
| 26 | Favicons on light glass | confirmed as an open design problem | `favicon.log` (luma 255 for every colour scheme) |

Middle-click close (coded, not exercised by the spike) works: `vmisc.log` "middle click" 2 -> 1.

## Refuted / gaps

1. **backdrop-filter does nothing over the page.** `vmisc-2-backdrop-invert-only.png` (crop:
   `zoom-vmisc-backdrop.png`): with tint and rim removed and `backdrop-filter: blur(22px) invert(1)`
   left, the pill is invisible over the remote page; over chrome-drawn stripes the same element
   blurs and inverts. In the spike's own `window-1-hover-close.png` the stripe edges under the pill
   are as sharp as outside it (10 hard edges in 400 px, inside and outside). The "frost stand-in"
   is a tint. Parent-process backdrop-filter cannot see the remote `<browser>`; the glass has to
   come from another mechanism (glass spike).
2. **Auto-hide reveal fails in a normal window with a real pointer.** The 6 px reveal zone lies
   inside Windows' resize band (y 0-7 = HTTOP); Gecko sends no DOM mouse events there, so
   `#vitre-reveal:hover` never matches. `vreveal.log`: real pointer at y 2, 5, 12, 22 -> bar stays
   at -60 px, `vreveal-1-normal-pointer-at-top.png`. The spike's proof used in-process synthesized
   moves, which skip non-client hit-testing. It works maximized (y 0-7 is HTCAPTION, which does get
   DOM mouse events) and in F11 (client area).
   Fix proven in the same log ("FIX" lines, `vreveal-3-fix-normal-pointer-at-top.png`): reveal on
   `mousemove` with clientY < 28, and on `mouseout` with `relatedTarget === null` when the last y was
   near the top; hide when the pointer is below the bar. Revealed and stays revealed with the
   pointer resting at y 2.
3. **The anchor router misses panels.** `vpanels.log`, "spike rules":
   - Site info / trust panel: Firefox passes a null anchor, the router only handles that for
     `#notification-popup`, the panel opens at [-4,-4] (`vpanels-spike-1-trustpanel.png`).
   - Bookmark editor (Ctrl+D): `BrowserPageActions.panelAnchorNodeForAction` throws
     "PageActions: No anchor node for bookmark"; no panel and **no bookmark is created**.
   - Firefox's downloads panel never opens (`DownloadsButton.getAnchor()` returns null and it
     returns before `openPopup`). Fine if Vitre's downloader replaces it, but it fails silently.
   Fix proven ("verifier rules", `vpanels-improved-1-trustpanel.png`, `-2-bookmark.png`):
   treat any `<panel>` opened through `openPopup()` with no anchor and no coordinates as an orphan,
   and set `win.BrowserPageActions.panelAnchorNodeForAction = () => pill`. Select, autocomplete,
   context menu and doorhanger are unaffected (same log).
4. **Popup tests depend on window activation.** Doorhangers (`PopupNotifications` checks
   `Services.focus.activeWindow`), `<select>` and autocomplete do not open in an inactive window.
   The spike's `boot-popups.js` failed here twice (`out/popups.log`, `rerun-chain.txt`: doorhanger,
   select, autocomplete, extension popup and once even the app menu closed) because another window
   had focus. `vv.activate()` (SendMessage WM_ACTIVATE + WM_SETFOCUS) makes it deterministic.
5. **`title` tooltips never show** on the bar's HTML buttons: `vtooltip.log`. The document root and
   body are HTML; only a XUL ancestor with `tooltip="aHTMLTooltip"` enables them. With the layer
   inside `<xul:box tooltip="aHTMLTooltip">` the tooltip "New tab  Ctrl+T" opens and the layer still
   works (click, HTMAXBUTTON).
6. **Load progress.** In a tabs progress listener `onProgressChange` gets `webProgress === null`
   (do not filter on `webProgress.isTopLevel` there) and fires once or twice per load. The load line
   needs its own time-based easing; Gecko only gives "busy" plus a late jump.

## Improved

- **Window move from script (claim 25).** `window.beginWindowMove` is indeed gone, but js-ctypes does it:
  on `mousedown` remember the point; on the first `mousemove` beyond ~5 px call
  `user32.ReleaseCapture()` then `PostMessageW(hwnd, WM_NCLBUTTONDOWN /*0xA1*/, HTCAPTION /*2*/, MAKELPARAM(screenX, screenY))`.
  Windows runs its own move loop: the window moved (-104,+91) for a (-112,+98) drag with a 5 px
  threshold, dragging to the top edge maximized it (Aero Snap), dragging the pill of a maximized
  window restored it and carried it along, and a plain click afterwards still entered edit mode.
  `PostMessage(WM_SYSCOMMAND, SC_MOVE|2)` also moves but leaves `:active` stuck (no mouseup) and
  failed once in an inactive window; `SendMessage` variants work only from a timer. Use the
  WM_NCLBUTTONDOWN post. This makes "drag the pill / the bar" possible, so the 10 px drag strip under
  the resize band is a design choice, not a necessity (the 8 px resize band stays).
- **Snap layouts, hover, real drag** (claims 8, 11, 12): proven with the real pointer, see table.
- **Wheel** (`vnative-pillmax-wheel.log`): scrolls the page in the bar strip beside the pill; dead on
  the drag strip (y 8-17), on bar items and on the window controls.

## Recipe corrections

1. Reveal zone: not `:hover` on a 6 px strip. Use the JS rule above (or at least a zone that extends
   below y 18 in normal windows); keep the CSS for F11.
2. Router: add the null-anchor `<panel>` rule and the `panelAnchorNodeForAction` override; decide
   what replaces Firefox's downloads panel. Page-action panels anchored to the pill by Firefox keep
   Firefox's own alignment (bookmark editor at [540,52], right-aligned, no 8 px gap) unless the
   router also realigns panels whose anchor is inside `#vitre-root`.
3. Remove `backdrop-filter` from the recipe's expectations: it is inert over pages.
4. `gReduceMotionOverride = true` is not needed for tab closing: Ctrl+W path removes the tab in 6 ms
   with and without it (`vmisc.log`). It is harmless but also switches off Firefox's own animations.
5. Hook order (`vmisc.log`): entries run sorted by module URL. `chrome://vitre/` runs after
   `chrome://browser/` but BEFORE `moz-src:` and `resource:` consumers. At
   `VitreShell.domContentLoaded` `CustomizableUI.handleNewBrowserWindow` and
   `BrowserWindowTracker.track` have not run yet for that window; at `delayedStartup` 11 Firefox
   consumers (SearchUIUtils.init, HomePage.delayedStartup, ...) still follow.
6. Tooltips: mount the layer under a XUL element with `tooltip="aHTMLTooltip"`, or draw own tooltips.
7. Progress listener: see gap 6.
8. Any popup test must activate the window first (gap 4).
9. Doorhanger suppression (`shouldSuppress` in browser.js) is tied to `gURLBar` focus/pageproxystate;
   with the pill as the address field nothing suppresses doorhangers while the user types
   (from source, not run).
10. "window-modal dialogs sit above this layer automatically" is unverified: my probe
    (`boot-v-modal.js`, `Services.prompt.asyncAlert` with MODAL_TYPE_WINDOW) blocks the main thread
    in this harness with and without the shell, so it shows nothing. Tab-modal prompts are fine
    (`popups-8-alert.png`: dialog centred, the bar is drawn above the dimmed page; whether it should be blocked while the
    prompt is up was not tested).

## Not checked

Display scaling other than 100 %, touch/pen, multiple monitors, the extensions-list panel beyond
one open (it closed within 0.5 s in one of two runs), print preview under the floating bar.
