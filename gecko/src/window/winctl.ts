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
import type { Browser } from './browser';
import { el, fill, svg } from './dom';
import * as fx from './firefox';
import { glass, lens } from './glass';
import { icons } from './icons';

const WIDTH = 108;
const HEIGHT = 32;
const RIGHT = 12;

export class WindowControls {
  readonly element: HTMLElement;
  private max: HTMLButtonElement;
  private label: HTMLElement | null = null;
  private labelWidth = 0;

  constructor(b: Browser, layer: HTMLElement) {
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

    this.element = el('div', { id: 'vitre-winctl', role: 'group', 'aria-label': 'Window' }, el('div', { class: 'winctl-buttons' }, min, max, close));
    glass(this.element).lens.style.backdropFilter = lens(WIDTH, HEIGHT);
    layer.append(this.element);

    if (b.isPrivate) {
      // No board exists for private windows: a plain label in the capsule's own material.
      const label = el('div', { id: 'vitre-private', role: 'status', 'aria-label': 'Private window' }, el('span', { class: 'label' }, 'Private'));
      const layers = glass(label);
      layer.append(label);
      this.label = label;
      // Its width depends on the font: measure once it is laid out.
      requestAnimationFrame(() => {
        this.labelWidth = Math.round(label.getBoundingClientRect().width);
        if (this.labelWidth) layers.lens.style.backdropFilter = lens(this.labelWidth, HEIGHT);
        b.render();
      });
    }
  }

  /** Width the bar must keep free at the right edge of the window. */
  get reserve(): number {
    const label = this.label ? (this.labelWidth || 72) + 8 : 0;
    return RIGHT + WIDTH + label + 16;
  }

  /** Maximize shows Restore while the window is maximized or in full screen. */
  sync(): void {
    const restored = !fx.isMaximized() && !window.fullScreen;
    const key = restored ? 'maximize' : 'restore';
    if (this.max.dataset.icon === key) return;
    this.max.dataset.icon = key;
    fill(this.max, svg(restored ? icons.maximize : icons.restore));
    this.max.setAttribute('aria-label', restored ? 'Maximize' : 'Restore');
  }
}
