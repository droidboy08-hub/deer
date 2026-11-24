// The "One row" tab bar of Deer for Mac (owner's choice; boards RowSpec, DirOneRow, DirOneRowBehaviour
// on the Mac canvas). One 52 px row at the top of the window: the window's own traffic lights at the
// left in a glass capsule of their own, the tabs as 36 px glass capsules from x 96 (the active one,
// 400 wide, is also the address field), a "+" capsule, and Downloads and Extensions at the right end. The row floats over the page
// as the Windows bar does (the owner, 2026-11-15: "remove the gray bar like windows"): the page fills
// the window from y 0 (skin/shell.css section 8), web content starts below the row at scroll top
// through the page's top strip (ROW_AREA, src/shared/geometry.ts; pagearea.ts) and scrolls under it,
// nothing is laid across the row (only the window's 18 px drag strip at the top, #vitre-drag, as on
// Windows, and the lights' capsule move the window; between the capsules the page gets the pointer,
// hover, right-click and the wheel), the capsules carry Deer's CSS glass, and the row's colours follow
// the theme of the page under it (#vitre-root theme-light / theme-dark / theme-clear, as the Windows
// bar's; skin/bar.css). Until then a band of macOS's gray title-bar material (-moz-window-titlebar)
// was the drag region across the row, with the page below it.
//
// The geometry every builder of the row shares, and the one switch that turns the layout on. Pure
// constants (CSS px) and functions of their arguments: safe to import from any bundle, the page side
// included.
//   bar.ts, winctl.ts, omnibox.ts     the row itself (tabs, traffic lights, the address field)
//   #vitre-drag                       the window's drag strip (bar.ts makes it on both systems;
//                                     skin/shell.css section 4): full width, 18 px tall at the top,
//                                     all of it a drag region on macOS (no resize band), zoomed too
//                                     (skin/bar.css); with the lights' capsule the only part of the
//                                     row that moves the window; between the capsules the row is
//                                     click-through, the page's (skin/bar.css)
//   #vitre-row-end                    right-aligned flex box at (right EDGE, top CAP_TOP, CAP_H tall,
//                                     GAP between children) that the downloads and extensions
//                                     modules fill; the bar measures it and keeps the tabs clear of it
// skin/bar.css and skin/omnibox.css carry the same numbers in their macOS sections (CSS cannot
// import this file): change them together.
//
// Window full screen (native Spaces; boards RowFullScreen, RowFullScreenReveal, DirOneRowBehaviour
// 6). rowFullScreen() below: #vitre-root has class `fullscreen` (browser.ts mirrors the root's
// inFullscreen attribute) and no `element-fullscreen` (a video in full screen is not this):
//   - the page fills the screen from y 0, as it fills a normal window, and the capsules look as they
//     do there; nothing is drawn across the top and there is no drag strip (skin/bar.css, "Window
//     full screen"; skin/shell.css); the first tab is at TABS_LEFT_FULL, since macOS keeps the
//     traffic lights in its own title-bar strip there;
//   - the row hides as the Windows bar does in F11 full screen, whatever the barAutoHide setting, and
//     comes back with the pointer at the top (reveal.ts), so pages get no top strip there (in a
//     normal window it hides only with the setting on, as the Windows bar does);
//   - when the pointer reaches the top, macOS slides in its menu bar and a title-bar strip with the
//     traffic lights over the top of the window. reveal.ts follows the overlap Gecko reports and
//     sets class `row-shifted` and --vitre-row-shift (CSS px) on #vitre-root while it is not 0;
//     skin/bar.css moves the layers that make the row (#layer-bar, #layer-omnibox, #layer-find)
//     and the Downloads quick view's layer (#layer-downloads-pop) down by it, so the row lands
//     below what macOS draws, as Firefox's toolbox does; the switcher's field and a video pill near
//     the top follow it from their own CSS (switcher/styles.ts, downloads/css.ts).
import { isMac } from '../shared/os';

/** The row's height over the top of the page (CAP_TOP + CAP_H + 8). Web content starts at ROW_AREA (64). */
export const ROW_H = 52;
/** A capsule's height (radius CAP_H / 2). */
export const CAP_H = 36;
/** A capsule's distance from the top of the window (the row is 8 + 36 + 8). */
export const CAP_TOP = 8;
/** Between two capsules. */
export const GAP = 8;
/** The traffic lights' left edge; they are centred on the row (y ROW_H / 2). */
export const LIGHTS_LEFT = 20;
/** Where the first tab starts. */
export const TABS_LEFT = 96;
/** The right margin of the row (after Downloads and Extensions). */
export const EDGE = 20;
/** The active tab's capsule at rest. */
export const ACTIVE_W = 400;
/** The active capsule never gets narrower than this (crowded tabs scroll instead). */
export const ACTIVE_MIN = 280;
/** The active capsule while the address is edited (clamped to the room the row has). */
export const ACTIVE_TYPING = 640;
/** A background tab's capsule with its title, at most. */
export const COMPACT_MAX = 160;
/**
 * A crowded row: the background tabs' titles shrink together down to this (favicon and about 48 px
 * of title), and only below it do they fold to favicons (the owner, 2026-11-15: "make the titles
 * shrink gradually first"). With the close x always shown (Settings) the least is 20 px more, so the
 * title keeps the same room beside it.
 */
export const COMPACT_MIN = 96;
/** Where the first tab starts in window full screen: no traffic lights in the row there (RowFullScreen). */
export const TABS_LEFT_FULL = 20;
/** The Extensions capsule as RowSpec draws it (a pinned extension and the Extensions button). */
export const EXT_W = 72;
/** A private window's "Private" capsule before it is measured (DirOneRowBehaviour "Private window"). */
export const PRIVATE_W = 104;

/**
 * The least width of a macOS window (CSS px), so the row always fits without overlap: the traffic
 * lights (up to TABS_LEFT), the active capsule at ACTIVE_MIN, "+", Downloads (CAP_H) and Extensions
 * (EXT_W) at the right end and EDGE, GAP between them:
 * 96 + 280 + 8 + 36 + 8 + 36 + 8 + 72 + 20 = 564. A private window adds its capsule and a GAP: 676.
 * RowSpec gives no minimum of its own. bar.ts sets it as the root's --window-min-width, which
 * Firefox's `:root:not([popup-window]) { min-width: var(--window-min-width) }` turns into the
 * NSWindow's minSize (browser/themes/shared/browser-shared.css; layout/base/PresShell.cpp
 * GetWindowSizeConstraints -> layout/generic/nsContainerFrame.cpp SetSizeConstraints ->
 * widget/cocoa/nsCocoaWindow.mm nsCocoaWindow::SetSizeConstraints).
 */
export function minWindowWidth(isPrivate: boolean): number {
  const row = TABS_LEFT + ACTIVE_MIN + GAP + CAP_H + GAP + CAP_H + GAP + EXT_W + EDGE;
  return row + (isPrivate ? PRIVATE_W + GAP : 0);
}

/**
 * Window full screen as the row sees it, from #vitre-root's classes (browser.ts mirrors the root's
 * inFullscreen and inDOMFullscreen): `fullscreen` without `element-fullscreen`. A page element in full
 * screen (a video) hides Deer's layer altogether (skin/shell.css section 4) and changes nothing here.
 */
export function rowFullScreen(root: Element): boolean {
  return root.classList.contains('fullscreen') && !root.classList.contains('element-fullscreen');
}

/** The One row layout is on: macOS. The single place that decides it. */
export function oneRow(): boolean {
  return isMac;
}
