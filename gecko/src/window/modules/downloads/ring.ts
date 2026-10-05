// The downloads ring: a 44 px glass circle at the bottom right (right 72, bottom 20: 1324,836 in a
// 1440x900 window, board Home) shown over pages and Home while anything downloads, with the overall
// progress as an arc; it hides 6 s after the last download finishes (decided with the user,
// DESIGN-NOTES "Right-click menus"). Click: the quick view (board DownloadsPopover); right-click or
// Shift+F10: the ring menu (opens up and to the left, right edge 1368, bottom 828). New downloads
// fly into it as a 32 px glass file-type circle (480 ms on the spring) and it pulses 1 -> 1.06 -> 1.
// Port of app/src/renderer/modules/downloads/ring.ts.
import type { Browser } from '../../browser';
import { el, svg } from '../../dom';
import { glass, lens } from '../../glass';
import type { DownloadView } from '../../../modules/downloads/types';
import * as f from './format';
import { ic, node } from './icons';
import { closeMenu, openMenu, type MenuEntry } from './menu';
import type { Panel } from './panel';
import type { DownloadStore } from './store';

const CIRC = 2 * Math.PI * 14;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const HIDE_AFTER = 6000;
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Ring {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private arc: SVGCircleElement;
  private shown = false;
  private hideTimer = 0;
  readonly pop: Popover;

  constructor(
    private b: Browser,
    private store: DownloadStore,
    private panel: Panel
  ) {
    const layer = b.layer('downloads-ring', 11);
    this.el = el('div', { class: 'vd-ring' });
    glass(this.el).lens.style.backdropFilter = lens(44, 44);
    const face = svg(
      `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" focusable="false"><circle class="track" cx="17" cy="17" r="14" fill="none" stroke-width="2"/><g class="spin"><circle class="arc" cx="17" cy="17" r="14" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 ${CIRC.toFixed(2)}" transform="rotate(-90 17 17)"/></g><path d="M17 11.5v9M13.6 17.2 17 20.6l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    );
    // data-bar-stop: a keyboard stop of the tab bar, after + (src/window/barkeys.ts header).
    this.btn = el('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Downloads', 'data-bar-stop': '' }, face);
    this.el.append(this.btn);
    this.el.setAttribute('inert', '');
    layer.append(this.el);
    this.arc = face.querySelector('.arc') as SVGCircleElement;
    this.pop = new Popover(b, store, panel, this);
    // The panel is the topmost surface: the quick view under it would take the first Esc.
    panel.onShow(() => this.pop.close(false));
    this.btn.addEventListener('click', (e) => this.pop.toggle(e.detail === 0));
    this.btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu(false);
    });
    this.btn.addEventListener('keydown', (e) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        this.menu(true);
      }
    });
    store.subscribe(() => this.update());
    // The menus module's anchor router may hang native popups from the ring (none today).
    b.setAnchor('downloads', () => (this.shown ? this.el : null));
  }

  /** Window coordinates of the ring's centre (also while it is hidden). */
  center(): { x: number; y: number } {
    return { x: window.innerWidth - 72 - 22, y: window.innerHeight - 20 - 22 };
  }

  get isShown(): boolean {
    return this.shown;
  }

  update(): void {
    const views = this.store.all();
    const active = views.filter(f.isActive);
    if (active.length) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
      this.show();
    } else if (this.shown && !this.hideTimer) {
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = 0;
        if (!this.pop.isOpen && !this.store.all().some(f.isActive)) this.hide();
      }, HIDE_AFTER);
    }
    const known = active.filter((v) => v.total > 0);
    const total = known.reduce((n, v) => n + v.total, 0);
    const got = known.reduce((n, v) => n + Math.min(v.received, v.total), 0);
    const pct = active.length ? (total ? got / total : 0) : 1;
    const spinning = active.length > 0 && !known.length && active.some((v) => v.state === 'downloading');
    this.el.classList.toggle('indeterminate', spinning);
    this.arc.setAttribute('stroke-dasharray', `${((spinning ? 0.25 : Math.max(pct, active.length ? 0.02 : 1)) * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`);
    const label = active.length ? `Downloads, ${active.length} active${known.length ? `, ${Math.floor(pct * 100)} percent` : ''}` : 'Downloads, finished';
    this.btn.setAttribute('aria-label', label);
    this.pop.render();
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.el.removeAttribute('inert');
    this.el.classList.add('shown');
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('shown');
    this.el.setAttribute('inert', '');
    if (this.el.contains(document.activeElement)) this.b.focusPage();
  }

  pulse(): void {
    if (reduced()) return;
    this.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
  }

  /** A new download: a small glass circle carries its file type from where it started to the ring. */
  fly(from: { x: number; y: number } | null, view: DownloadView): void {
    this.show();
    if (reduced() || !from) {
      this.pulse();
      return;
    }
    const to = this.center();
    const dot = el('div', { class: 'vd-flight' }, el('span', {}, f.tile(view.filename)));
    glass(dot).lens.style.backdropFilter = lens(32, 32);
    this.b.layer('downloads-flight', 45).append(dot);
    const at = (p: { x: number; y: number }, s: number): string => `translate(${p.x - 16}px, ${p.y - 16}px) scale(${s})`;
    // The fade is on the label only: opacity on the glass element itself would blind its lens.
    const label = dot.lastElementChild as HTMLElement;
    label.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 480, fill: 'forwards' });
    dot.animate([{ transform: at(from, 1) }, { transform: at(to, 0.82) }], { duration: 480, easing: SPRING, fill: 'forwards' }).onfinish = () => {
      dot.remove();
      this.pulse();
    };
  }

  menu(keyboard: boolean): void {
    this.pop.close(false);
    const views = this.store.all();
    const anyActive = views.some(f.isActive);
    const anyPaused = views.some((v) => v.state === 'paused');
    const copied = this.store.engine.clipboardUrl();
    const entries: MenuEntry[] = [
      { label: 'Show downloads', access: 's', key: 'Ctrl+J', icon: 'download', run: () => this.panel.show() },
      { label: 'Open Downloads folder', access: 'f', icon: 'folder', run: () => this.store.engine.openFolder() },
      'separator',
      anyActive || !anyPaused
        ? { label: 'Pause all', access: 'p', icon: 'pause', disabled: !anyActive, run: () => this.store.pauseAll() }
        : { label: 'Resume all', access: 'r', icon: 'play', run: () => this.store.resumeAll() },
    ];
    if (copied) entries.push({ label: 'Download copied link', access: 'd', icon: 'link', run: () => void this.store.start(copied, { origin: this.center() }) });
    entries.push({ label: 'Clear finished', access: 'c', disabled: !views.some(f.isFinished), run: () => this.store.clearFinished() });
    // Opens up and to the left: right edge at the ring's right, bottom 8 px above it.
    openMenu(this.b, 'Downloads', entries, { at: this.el, align: 'above-end' }, { keyboard, owner: this.el, returnFocus: this.btn });
  }

  focus(): void {
    this.btn.focus();
  }
}

/** The quick view above the ring (board DownloadsPopover): what is downloading now and what just finished. */
class Popover {
  private el: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;
  private rows = new Map<string, HTMLElement>();
  private height = 0;
  private unEsc: (() => void) | null = null;
  private unFocus: (() => void) | null = null;

  constructor(
    private b: Browser,
    private store: DownloadStore,
    private panel: Panel,
    private ring: Ring
  ) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  toggle(keyboard: boolean): void {
    if (this.el) this.close(true);
    else this.open(keyboard);
  }

  open(keyboard: boolean): void {
    closeMenu(this.b);
    this.store.reload();
    const layer = this.b.layer('downloads-pop', 30);
    this.catcher = el('div', { class: 'vd-menu-catcher' });
    this.catcher.addEventListener('pointerdown', () => this.close(false));
    const openBtn = el('button', { type: 'button', class: 'vd-pop-open' }, 'Open Downloads');
    const elm = el(
      'section',
      { class: 'vd-pop', role: 'dialog', 'aria-label': 'Downloads', tabindex: '-1' },
      el('div', { class: 'vd-pop-body' }, el('div', { class: 'vd-pop-head' }, el('b', {}, 'Downloads'), el('span', { class: 'vd-pop-sum' })), el('div', { class: 'vd-pop-list' }), openBtn)
    );
    glass(elm);
    layer.append(this.catcher, elm);
    this.el = elm;
    this.rows.clear();
    this.height = 0;
    openBtn.addEventListener('click', () => {
      this.close(false);
      this.panel.show();
    });
    elm.addEventListener('keydown', (e) => this.keys(e));
    this.unEsc = this.b.addEscLayer(30, () => {
      this.close(true);
      return true;
    });
    // Another Deer surface took the keyboard (the switcher's search, find, the address field): the
    // quick view gives way, or it would stay under that surface and take its first Esc.
    const lost = (e: FocusEvent): void => {
      const t = e.target as Element | null;
      if (t && this.b.root.contains(t) && !elm.contains(t) && !this.ring.el.contains(t)) this.close(false);
    };
    document.addEventListener('focusin', lost, true);
    this.unFocus = () => document.removeEventListener('focusin', lost, true);
    this.render();
    if (!reduced()) {
      elm.animate([{ transform: 'translate(4px, 6px) scale(0.96)' }, { transform: 'none' }], { duration: 240, easing: SPRING });
      (elm.querySelector('.vd-pop-body') as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'cubic-bezier(0.2,0,0,1)' });
    }
    const first = elm.querySelector<HTMLElement>('.vd-pop-row') ?? openBtn;
    if (keyboard) first.focus();
    else elm.focus();
  }

  close(focusRing: boolean): void {
    const elm = this.el;
    if (!elm) return;
    this.el = null;
    this.unEsc?.();
    this.unEsc = null;
    this.unFocus?.();
    this.unFocus = null;
    this.catcher?.remove();
    this.catcher = null;
    elm.style.pointerEvents = 'none';
    const hadFocus = elm.contains(document.activeElement);
    elm.animate([{ transform: 'none' }, { transform: 'scale(0.985)' }], { duration: reduced() ? 150 : 120, fill: 'forwards' }).onfinish = () => elm.remove();
    if (focusRing) this.ring.focus();
    else if (hadFocus) this.b.focusPage();
    this.ring.update();
  }

  render(): void {
    const elm = this.el;
    if (!elm) return;
    const views = this.store.all().filter((v) => v.state !== 'cancelled');
    const active = views.filter((v) => f.isActive(v));
    const rate = active.reduce((n, v) => n + v.speed, 0);
    f.setText(elm.querySelector('.vd-pop-sum'), active.length ? `${active.length} active${rate > 0 ? ` · ${f.speed(rate)}` : ''}` : views.length ? 'All done' : 'Nothing yet');
    const pick = views.slice(0, 3);
    const list = elm.querySelector('.vd-pop-list') as HTMLElement;
    const keep = new Set(pick.map((v) => v.id));
    for (const [id, row] of this.rows) {
      if (!keep.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
    const order = pick.map((v) => v.id).join('|');
    for (const v of pick) {
      let row = this.rows.get(v.id);
      if (!row) {
        row = this.row(v.id);
        this.rows.set(v.id, row);
      }
      this.update(row, v);
    }
    // Rebuild the order only when it changed, so a row is never moved under the pointer.
    if (list.dataset.order !== order) {
      list.dataset.order = order;
      list.replaceChildren();
      pick.forEach((v, i) => {
        if (i) list.append(el('div', { class: 'vd-pop-sep' }));
        list.append(this.rows.get(v.id) as HTMLElement);
      });
      if (!pick.length) list.append(el('div', { class: 'vd-pop-empty' }, 'Downloads you start appear here.'));
    }
    const h = elm.offsetHeight;
    if (h !== this.height) {
      this.height = h;
      (elm.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(360, h, { radius: 20, scale: 24, blur: 14, opaque: true });
    }
  }

  private row(id: string): HTMLElement {
    const btn = el('button', { type: 'button', class: 'vd-round', tabindex: '-1' });
    const row = el(
      'div',
      { class: 'vd-pop-row', tabindex: '-1', 'data-id': id },
      el('span', { class: 'vd-tile' }),
      el('div', { class: 'vd-pop-info' }, el('span', { class: 'vd-pop-name' }), el('div', { class: 'vd-pop-segs' }), el('span', { class: 'vd-pop-meta' })),
      btn
    );
    row.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.close(false);
      this.panel.show(id);
    });
    btn.addEventListener('click', () => {
      const v = this.store.get(id);
      if (v) this.store.primary(v);
    });
    return row;
  }

  private update(row: HTMLElement, v: DownloadView): void {
    const done = f.isFinished(v);
    row.classList.toggle('done', done);
    f.setText(row.querySelector('.vd-tile'), f.tile(v.filename));
    f.setText(row.querySelector('.vd-pop-name'), v.filename);
    const segs = row.querySelector('.vd-pop-segs') as HTMLElement;
    const fills = done ? [] : v.segments.length > 1 && v.maxConnections > 1 ? v.segments : v.total > 0 ? [v.received / v.total] : [];
    segs.hidden = !fills.length;
    segs.classList.toggle('dim', v.state === 'paused');
    segs.classList.toggle('single', fills.length === 1);
    if (segs.childElementCount !== fills.length) segs.replaceChildren(...fills.map(() => el('span', {}, el('i', {}))));
    fills.forEach((x, i) => ((segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, x) * 100)}%`));
    f.setText(row.querySelector('.vd-pop-meta'), meta(v));
    const btn = row.querySelector('button') as HTMLElement;
    const [k, label, icon] =
      v.state === 'downloading' || v.state === 'starting'
        ? ['p', 'Pause', ic.pause(12)]
        : v.state === 'queued'
          ? ['n', 'Start now', ic.play(12)]
          : v.state === 'paused'
            ? ['r', 'Resume', ic.play(12)]
            : v.state === 'completed' && !v.missing
              ? ['f', 'Show in folder', ic.folder(14, 1.6)]
              : ['t', 'Retry', ic.retry];
    if (btn.dataset.k !== k) {
      btn.dataset.k = k;
      btn.replaceChildren(node(icon));
    }
    btn.setAttribute('aria-label', `${label} ${v.filename}`);
    row.setAttribute('aria-label', `${v.filename}, ${meta(v)}`);
  }

  private keys(e: KeyboardEvent): void {
    const elm = this.el;
    if (!elm) return;
    const items = Array.from(elm.querySelectorAll<HTMLElement>('.vd-pop-row, .vd-pop-open'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focused = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Enter' && focused?.classList.contains('vd-pop-row')) focused.click();
    else if (e.key === ' ' && focused?.classList.contains('vd-pop-row')) {
      // Space is the row's own button: pause, resume, start now, show in folder or retry.
      (focused.querySelector('.vd-round') as HTMLElement | null)?.click();
    } else if (e.key === 'Tab') {
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    } else return;
    e.preventDefault();
  }
}

function meta(v: DownloadView): string {
  const of = v.total > 0 ? `${f.bytes(v.received)} of ${f.bytes(v.total)}` : f.bytes(v.received);
  if (v.state === 'completed') return v.missing ? 'Moved or deleted' : [f.bytes(v.total), 'Completed'].filter(Boolean).join(' · ');
  if (v.state === 'failed') return v.error || 'Failed';
  if (v.state === 'queued') return 'Queued';
  if (v.state === 'paused') return [of, 'Paused'].filter(Boolean).join(' · ');
  if (v.state === 'starting' || v.phase === 'probing') return 'Starting';
  if (v.phase === 'merging') return 'Saving';
  return [of, f.speed(v.speed), v.eta >= 0 ? `${f.eta(v.eta)} left` : ''].filter(Boolean).join(' · ');
}
