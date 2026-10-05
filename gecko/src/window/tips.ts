// Tooltips for Deer's own controls. `title` attributes show nothing in browser.xhtml's HTML layer
// (spikes/shell/RESULT.md, verifier), and the design's tooltip is its own shape anyway: a dark
// 26 px label 8 px under the control, plain text, with the key as dim text after it (no keycaps).
//
// Use from anywhere inside #vitre-root:
//   setTip(button, 'Back', 'Alt+Left')      or the attributes data-tip="Back" data-key="Alt+Left"
//   setTip(button, null)                    removes it
// The tip shows after 600 ms of hover (data-tip-delay overrides), centred under the element (8 px
// above it instead when there is no room below, e.g. Home's corner circles), kept 8 px inside the
// window; it hides on mouse out, press, key or wheel. Keyboard focus does not show
// it (the accessible name already says the same). One tip element per window, in its own layer.
import type { Browser } from './browser';
import { el } from './dom';

const DELAY = 600;

export function setTip(target: HTMLElement, label: string | null, key?: string): void {
  if (!label) {
    delete target.dataset.tip;
    delete target.dataset.key;
    return;
  }
  if (target.dataset.tip !== label) target.dataset.tip = label;
  if (key) {
    if (target.dataset.key !== key) target.dataset.key = key;
  } else delete target.dataset.key;
}

export class Tips {
  private tip: HTMLElement;
  private text = el('span', { class: 't' });
  private key = el('span', { class: 'k' });
  private timer = 0;
  private current: HTMLElement | null = null;

  constructor(b: Browser) {
    this.tip = el('div', { class: 'vitre-tip', role: 'tooltip', 'aria-hidden': 'true' }, this.text, this.key);
    this.tip.hidden = true;
    b.layer('tips', 60).append(this.tip);
    const root = b.root;
    root.addEventListener('mouseover', (e) => this.over(e.target as Element | null));
    root.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (this.current && (!to || !this.current.contains(to))) this.hide();
    });
    for (const type of ['mousedown', 'wheel']) root.addEventListener(type, () => this.hide(), true);
    window.addEventListener('keydown', () => this.hide(), true);
    window.addEventListener('deactivate', () => this.hide());
  }

  /** The element whose tip is showing (null while one is still pending), for tests. */
  get shownFor(): HTMLElement | null {
    return this.tip.hidden ? null : this.current;
  }

  private over(target: Element | null): void {
    const host = target?.closest?.('[data-tip]') as HTMLElement | null;
    if (host === this.current) return;
    this.hide();
    if (!host) return;
    this.current = host;
    const delay = Number(host.dataset.tipDelay ?? DELAY);
    this.timer = window.setTimeout(() => this.show(host), delay);
  }

  private show(host: HTMLElement): void {
    const label = host.dataset.tip;
    if (!label || !host.isConnected || this.current !== host) return;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.text.textContent = label;
    this.key.textContent = host.dataset.key ?? '';
    this.key.hidden = !host.dataset.key;
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - 8 - w, r.left + r.width / 2 - w / 2));
    // Bar controls sit inside a 44 px glass shape: the tip hangs under the shape, not the button.
    const shape = (host.closest('.glass') as HTMLElement | null) ?? host;
    const sr = shape.getBoundingClientRect();
    const bottom = Math.max(r.bottom, sr.bottom);
    // No room under it (a control at the bottom of the window): above the shape instead.
    const h = this.tip.offsetHeight;
    const y = bottom + 8 + h > window.innerHeight - 8 ? Math.min(r.top, sr.top) - 8 - h : bottom + 8;
    this.tip.style.left = `${Math.round(x)}px`;
    this.tip.style.top = `${Math.round(y)}px`;
    requestAnimationFrame(() => this.tip.classList.add('on'));
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.current = null;
    if (this.tip.hidden) return;
    this.tip.classList.remove('on');
    this.tip.hidden = true;
  }
}
