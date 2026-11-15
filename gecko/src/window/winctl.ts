// Window chrome at the top right: the 108x32 glass capsule with Minimize, Maximize / Restore and
// Close, and (private windows) the "Private" label beside it.
//
// Caption mechanics, verified in spikes/shell/RESULT.md (do not change without re-running
// tests/shell/chrome.js):
//   - Each button carries -moz-default-appearance: -moz-window-button-* with appearance: none
//     (skin/bar.css). Windows then hit-tests them as real caption buttons (HTMINBUTTON, HTMAXBUTTON,
//     HTCLOSE), which is what makes the Windows 11 snap-layout flyout appear on Maximize.
//   - mouseup on a caption button MUST be preventDefault()ed: an unconsumed mouseup lets Windows run
//     the button's own action as well, so a toggling maximize would run twice per click.
//   - The capsule and everything else painted over the drag strip declares
//     -moz-window-dragging: no-drag.
// The drag strip itself (#vitre-drag) is in skin/shell.css; double-click on it maximizes because
// Windows sees HTCAPTION there. Resize borders are Windows' own (the top 8 px of a normal window
// is the resize band, which is why the strip is 18 px tall).
//
// macOS (owner decision D2): none of the above. The window's own close, minimise and zoom buttons
// (the traffic lights) sit in a 76x32 glass capsule at the top LEFT (left 12, top 18: centred on the
// 44 px bar row), and the Private label goes to the top right (right 12). The capsule holds an empty
// placeholder, #vitre-win-lights, that Gecko puts the native buttons over (trafficLights below);
// they bring the green button's full-screen and tiling menu, VoiceOver's names and the grey look of
// an inactive window. They leave and come back with the bar (skin/bar.css, macOS block).
//
// One row (onerow.ts, the Mac tab bar the owner chose; board RowSpec): the placeholder at x
// LIGHTS_LEFT, centred on the 52 px row (y 26), in a 76x36 capsule of the row's glass at (12, 8), the
// tab capsules' CSS glass in the page's colours (skin/bar.css), and the tabs start at TABS_LEFT
// (AppKit draws the buttons above Gecko's view). The row floats over the page, so a scrolled page
// runs under it: with the lights plain over the page (RowSpec drew them on the gray title-bar band,
// gone since 2026-11-15) its text ran right through them. The capsule is a drag region (skin/bar.css):
// with the 18 px drag strip at the top (#vitre-drag) it is what moves the window from the row.
// A private window's label is the "Private" capsule of the row (dark glass, the glasses glyph, 36
// tall), just left of #vitre-row-end, the Downloads and Extensions group at the right end (the bar
// keeps the tabs clear of both).
// Window full screen (board RowFullScreen): macOS keeps the lights in its own title-bar strip, which
// slides in with the menu bar (widget/cocoa/nsCocoaWindow.mm FrameView__closeButtonOrigin leaves the
// buttons where the system puts them while the window is full screen). The placeholder is not drawn
// (skin/bar.css) and the first tab moves to TABS_LEFT_FULL.
import type { Browser } from './browser';
import { el, fill, svg } from './dom';
import * as fx from './firefox';
import { glass, lens } from './glass';
import { icons } from './icons';
import type { Theme } from './model';
import { LIGHTS_LEFT, oneRow, PRIVATE_W, rowFullScreen, TABS_LEFT, TABS_LEFT_FULL } from './onerow';
import { isMac } from '../shared/os';

const WIDTH = 108;
const HEIGHT = 32;
const RIGHT = 12;
/** macOS: the traffic lights' capsule, 12 px from the left edge (skin/bar.css). */
const MAC_WIDTH = 76;
const MAC_LEFT = 12;
/** One row: the Private capsule's width before it is measured (board DirOneRowBehaviour, "Private window"). */
const ROW_PRIVATE_W = PRIVATE_W;
/** One row: the native buttons' box is about this wide (54 when the window can't be asked; see trafficLights). */
const LIGHTS_W = 54;

/**
 * macOS: the box the window's own traffic lights are put over. Gecko takes the FIRST painted element
 * whose appearance is -moz-window-button-box (skin/bar.css gives it that) and moves the native
 * buttons onto it: widget/cocoa/nsCocoaWindow.mm, nsCocoaWindow::UpdateThemeGeometries ->
 * [ToolbarWindow placeWindowButtons:], the close button's origin on the box's bottom-left corner
 * (FrameView__closeButtonOrigin). The box's own size is the buttons' (widget/cocoa/nsNativeThemeCocoa.mm,
 * WindowButtonsSize: the union of the three buttons' frames, 54x16 when the window can't be asked),
 * so the CSS leaves it at that size and centres it. Firefox's own box (.titlebar-buttonbox,
 * browser/themes/shared/browser-shared.css) is in a toolbar Deer does not render. When no such
 * element is painted (display: none, visibility: hidden, DOM full screen) the rectangle is empty and
 * the buttons are moved above the window's top edge, out of sight, until it paints again. Opacity 0
 * is not enough: a transparent stacking context that takes pointer events is still built
 * (layout/generic/nsIFrame.cpp, BuildDisplayListForStackingContext), so hiding uses visibility.
 */
function trafficLights(): HTMLElement {
  return el('div', { id: 'vitre-win-lights' });
}

export class WindowControls {
  readonly element: HTMLElement;
  /** Maximize / Restore (Windows; on macOS the zoom button is the window's own). */
  private max: HTMLButtonElement | null = null;
  private label: HTMLElement | null = null;
  private labelWidth = 0;

  constructor(
    private b: Browser,
    layer: HTMLElement
  ) {
    this.element = isMac ? this.lightsCapsule() : this.captionCapsule();
    layer.append(this.element);

    if (b.isPrivate) {
      // No board exists for private windows on Windows: a plain label in the capsule's own material.
      // One row: the board's "Private" capsule, the glasses glyph before the word (skin/bar.css).
      const row = oneRow();
      const label = el('div', { id: 'vitre-private', role: 'status', 'aria-label': 'Private window' }, row ? svg(icons.privateGlasses) : null, el('span', { class: 'label' }, 'Private'));
      const layers = glass(label);
      layer.append(label);
      this.label = label;
      // Its width depends on the font: measure once it is laid out.
      requestAnimationFrame(() => {
        this.labelWidth = Math.round(label.getBoundingClientRect().width);
        // One row: the capsule's glass is CSS (skin/bar.css: a blur on its .lens), not a lens map.
        if (this.labelWidth && !row) layers.lens.style.backdropFilter = lens(this.labelWidth, HEIGHT);
        b.render();
      });
    }
  }

  /** Windows: Deer's own Minimize, Maximize / Restore and Close in the 108x32 capsule. */
  private captionCapsule(): HTMLElement {
    const min = el('button', { id: 'vitre-win-min', type: 'button', 'aria-label': 'Minimize' }, svg(icons.minimize));
    const max = el('button', { id: 'vitre-win-max', type: 'button', 'aria-label': 'Maximize' }, svg(icons.maximize));
    const close = el('button', { id: 'vitre-win-close', type: 'button', 'aria-label': 'Close window' }, svg(icons.closeWin));
    max.dataset.icon = 'maximize';
    this.max = max;
    // Mandatory: an unconsumed mouseup on a caption button lets Windows run the button's action too.
    for (const button of [min, max, close]) button.addEventListener('mouseup', (e) => e.preventDefault());
    min.addEventListener('click', () => window.minimize());
    max.addEventListener('click', () => {
      if (window.fullScreen) fx.toggleFullScreen();
      else if (fx.isMaximized()) window.restore();
      else window.maximize();
    });
    close.addEventListener('click', () => fx.closeWindow());

    const capsule = el('div', { id: 'vitre-winctl', role: 'group', 'aria-label': 'Window' }, el('div', { class: 'winctl-buttons' }, min, max, close));
    glass(capsule).lens.style.backdropFilter = lens(WIDTH, HEIGHT);
    return capsule;
  }

  /**
   * macOS: the 76x32 glass capsule the traffic lights sit in. It holds no control of Deer's (the
   * buttons are the window's own, named by the system), so it is hidden from assistive technology.
   * One row: a 76x36 capsule whose glass is CSS (skin/bar.css: a blur on its .lens), not a lens map.
   */
  private lightsCapsule(): HTMLElement {
    const capsule = el('div', { id: 'vitre-winctl', 'aria-hidden': 'true' }, trafficLights());
    const layers = glass(capsule);
    if (!oneRow()) layers.lens.style.backdropFilter = lens(MAC_WIDTH, HEIGHT);
    return capsule;
  }

  /** Width the bar must keep free at the right edge of the window (macOS: the Private label's, if any). */
  get reserve(): number {
    if (isMac) return this.label ? RIGHT + (this.labelWidth || 72) + 16 : 0;
    const label = this.label ? (this.labelWidth || 72) + 8 : 0;
    return RIGHT + WIDTH + label + 16;
  }

  /** One row: the Private capsule's width (0 in a normal window). The bar keeps it and a gap free left of #vitre-row-end. */
  get privateWidth(): number {
    return this.label ? this.labelWidth || ROW_PRIVATE_W : 0;
  }

  /**
   * Width the bar must keep free at the left edge of the window: the traffic lights' capsule on macOS
   * (one row: up to the first tab; TABS_LEFT_FULL in window full screen, where the lights are not in
   * the row), none on Windows.
   */
  get reserveLeft(): number {
    if (oneRow()) return rowFullScreen(this.b.root) ? TABS_LEFT_FULL : TABS_LEFT;
    return isMac ? MAC_LEFT + MAC_WIDTH + 12 : 0;
  }

  /** The middle of the capsule in window x (split view: the page there gives the controls their theme). */
  get centre(): number {
    if (oneRow()) return LIGHTS_LEFT + LIGHTS_W / 2;
    return isMac ? MAC_LEFT + MAC_WIDTH / 2 : window.innerWidth - RIGHT - WIDTH / 2;
  }

  /**
   * Split view: the controls sample the page under them (spec "Where the bar sits": Theme), which
   * may differ from the bar's (the focused side's). null: the bar's theme (no class of their own).
   */
  setTheme(theme: Theme | null): void {
    for (const t of ['light', 'dark', 'clear'] as const) this.element.classList.toggle(`theme-${t}`, theme === t);
  }

  /** Maximize shows Restore while the window is maximized or in full screen (Windows; macOS has no such button of Deer's). */
  sync(): void {
    const max = this.max;
    if (!max) return;
    const restored = !fx.isMaximized() && !window.fullScreen;
    const key = restored ? 'maximize' : 'restore';
    if (max.dataset.icon === key) return;
    max.dataset.icon = key;
    fill(max, svg(restored ? icons.maximize : icons.restore));
    max.setAttribute('aria-label', restored ? 'Maximize' : 'Restore');
  }
}
