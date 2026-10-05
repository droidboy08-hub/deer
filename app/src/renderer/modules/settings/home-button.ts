// Home's "Change background" circle (bottom right, as on the Home board) and its Background
// popover: Photo / Video / None, the tiles, and "Add a photo or video".
import type { Browser } from '../../app';
import { glassLayers, lens } from '../../glass';
import type { HomeBackground } from './background';
import { backgroundPicker, type Picker } from './bg-picker';
import { h } from './controls';
import { ico } from './icons';

const POPOVER_LAYER = 30;
const POP_W = 340;
const POP_H = 358;

const pictureIcon =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.2"/><circle cx="7.5" cy="8.3" r="1.3"/><path d="m3.6 14.2 4-3.6 3 2.5 2.4-2 3.4 3"/></svg>';

export class HomeButton {
  private circle: HTMLElement;
  private face: HTMLButtonElement;
  private pop: HTMLElement | null = null;
  private picker: Picker | null = null;
  private offEsc: (() => void) | null = null;
  private onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (this.pop && !this.pop.contains(t) && !this.circle.contains(t)) this.close(false);
  };

  constructor(private b: Browser, private bg: HomeBackground) {
    // Under the tab bar and under a peek's dim, above the page.
    const layer = b.layer('home-bg', 7);
    this.circle = h('div', { class: 'glass hb-circle off' });
    this.circle.innerHTML = glassLayers();
    (this.circle.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(44, 44);
    this.face = h('button', { type: 'button', class: 'hb-circle-face', 'aria-label': 'Change background', title: 'Change background', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', html: pictureIcon });
    this.face.addEventListener('click', () => (this.pop ? this.close(true) : this.open()));
    this.circle.append(this.face);
    layer.append(this.circle);
    b.on('render', () => this.sync());
    b.on('tab-activated', () => this.sync());
    // Settings and Downloads take the window (body.panel-open): the popover steps aside.
    new MutationObserver(() => {
      if (this.pop && document.body.classList.contains('panel-open')) this.close(false);
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /** Shown only on Home. */
  private sync(): void {
    const onHome = this.b.active()?.kind === 'home';
    this.circle.classList.toggle('off', !onHome);
    this.face.tabIndex = onHome ? 0 : -1;
    if (!onHome && this.pop) this.close(false);
  }

  open(): void {
    if (this.pop) {
      this.picker?.focus();
      return;
    }
    if (this.b.active()?.kind !== 'home') return;
    this.picker = backgroundPicker(this.bg, 'popover');
    const close = h('button', { type: 'button', class: 'hb-pop-close', 'aria-label': 'Close', title: 'Close  Esc', html: ico.close });
    close.addEventListener('click', () => this.close(true));
    const add = h('button', { type: 'button', class: 'hb-add' }, h('span', { html: ico.plus, class: 'hb-add-ico' }), 'Add a photo or video');
    add.addEventListener('click', async () => {
      await this.bg.browse('any');
      this.picker?.focus();
    });
    const lensEl = h('div', { class: 'hb-pop-lens' });
    lensEl.style.backdropFilter = lens(POP_W, POP_H, { radius: 20, scale: 24, blur: 14 });
    this.pop = h(
      'div',
      { class: 'hb-pop', role: 'dialog', 'aria-label': 'Background' },
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
    this.picker = null;
    this.offEsc?.();
    this.offEsc = null;
    document.removeEventListener('mousedown', this.onDown, true);
    this.face.setAttribute('aria-expanded', 'false');
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
