// Home's "Change background" circle (bottom right, as on the Home board) and its Background
// popover (board HomeBackground): Photo / Video / None, the tiles, and "Add a photo or video".
// Ported from app/src/renderer/modules/settings/home-button.ts. Gecko: Home is a page in a tab
// (about:vitre-home); the circle and popover are drawn in Deer's layer over it (layer z 7: under a
// peek's dim and the tab bar) and show only while the active tab shows Home itself (a blank tab
// also counts as kind 'home' but has no background to change).
// The board's "Dim" slider and "Show tabs on the home page" switch are not here: Settings has no
// such settings (as in the Electron build); the popover is 358 px tall instead of 472.
import { HOME_URL } from '../../../shared/home';
import type { Browser } from '../../browser';
import { glass, lens } from '../../glass';
import { setTip } from '../../tips';
import type { HomeBackground } from './background';
import { backgroundPicker, type Picker } from './bg-picker';
import { h, iconBox } from './controls';
import { ico } from './icons';

const POPOVER_LAYER = 30;
const POP_W = 340;
const POP_H = 358;

export class HomeButton {
  private circle: HTMLElement;
  private face: HTMLButtonElement;
  private pop: HTMLElement | null = null;
  private picker: Picker | null = null;
  private offEsc: (() => void) | null = null;
  private onDown = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (this.pop && !this.pop.contains(t) && !this.circle.contains(t)) this.close(false);
  };

  constructor(
    private b: Browser,
    private bg: HomeBackground
  ) {
    // Under the tab bar and under a peek's dim, above the page.
    const layer = b.layer('home-bg', 7);
    this.circle = h('div', { class: 'hb-circle off', id: 'vitre-home-bg' });
    const layers = glass(this.circle);
    layers.lens.style.backdropFilter = lens(44, 44);
    this.face = h('button', { type: 'button', class: 'hb-circle-face', 'aria-label': 'Change background', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, iconBox(ico.pictureButton, 'hb-circle-ico'));
    setTip(this.face, 'Change background');
    this.face.addEventListener('click', () => (this.pop ? this.close(true) : this.open()));
    this.circle.append(this.face);
    layer.append(this.circle);
    b.on('render', () => this.sync());
    b.on('tab-activated', () => this.sync());
    // Settings and Downloads take the window (panel-open on b.root): the popover steps aside.
    const watch = new MutationObserver(() => {
      if (this.pop && b.root.classList.contains('panel-open')) this.close(false);
    });
    watch.observe(b.root, { attributes: true, attributeFilter: ['class'] });
    b.onDestroy(() => watch.disconnect());
    this.sync();
  }

  get isOpen(): boolean {
    return !!this.pop;
  }

  /** The active tab shows Home itself (not just a blank tab, which also counts as kind 'home'). */
  onHome(): boolean {
    return this.b.active()?.url === HOME_URL;
  }

  /** Shown only on Home. */
  private sync(): void {
    const onHome = this.onHome();
    this.circle.classList.toggle('off', !onHome);
    this.face.tabIndex = onHome ? 0 : -1;
    if (!onHome && this.pop) this.close(false);
  }

  open(): void {
    if (this.pop) {
      this.picker?.focus();
      return;
    }
    if (!this.onHome()) return;
    this.picker = backgroundPicker(this.bg, 'popover');
    const close = h('button', { type: 'button', class: 'hb-pop-close', 'aria-label': 'Close' }, iconBox(ico.close, 'hb-pop-close-ico'));
    setTip(close, 'Close', 'Esc');
    close.addEventListener('click', () => this.close(true));
    const add = h('button', { type: 'button', class: 'hb-add' }, iconBox(ico.plus, 'hb-add-ico'), 'Add a photo or video');
    add.addEventListener('click', async () => {
      await this.bg.browse();
      this.picker?.focus();
    });
    const lensEl = h('div', { class: 'hb-pop-lens' });
    lensEl.style.backdropFilter = lens(POP_W, POP_H, { radius: 20, scale: 24, blur: 14, saturate: 1.6, opaque: true });
    this.pop = h(
      'div',
      { class: 'hb-pop', role: 'dialog', 'aria-label': 'Background', id: 'vitre-home-bg-pop' },
      lensEl,
      h('div', { class: 'hb-pop-tint' }),
      h('div', { class: 'hb-pop-rim' }),
      h('div', { class: 'hb-pop-body' }, h('div', { class: 'hb-pop-head' }, h('span', { class: 'hb-pop-title', text: 'Background' }), close), this.picker.el, add),
    );
    this.pop.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') this.trapTab(e);
    });
    this.circle.parentElement?.append(this.pop);
    requestAnimationFrame(() => this.pop?.classList.add('shown'));
    this.face.setAttribute('aria-expanded', 'true');
    // No tooltip over the popover the circle just opened (the pointer is usually still on it).
    setTip(this.face, null);
    this.offEsc = this.b.addEscLayer(POPOVER_LAYER, () => {
      this.close(true);
      return true;
    });
    document.addEventListener('mousedown', this.onDown, true);
    requestAnimationFrame(() => this.picker?.focus());
  }

  close(focusCircle: boolean): void {
    const pop = this.pop;
    if (!pop) return;
    this.pop = null;
    this.picker?.dispose();
    this.picker = null;
    this.offEsc?.();
    this.offEsc = null;
    document.removeEventListener('mousedown', this.onDown, true);
    this.face.setAttribute('aria-expanded', 'false');
    setTip(this.face, 'Change background');
    pop.classList.remove('shown');
    pop.classList.add('leaving');
    window.setTimeout(() => pop.remove(), 140);
    if (focusCircle) this.face.focus();
  }

  private trapTab(e: KeyboardEvent): void {
    if (!this.pop) return;
    const list = [...this.pop.querySelectorAll<HTMLElement>('button, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden]'));
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
