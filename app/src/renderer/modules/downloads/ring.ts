// The downloads ring: a 44 px glass circle at the bottom right (right 72, bottom 20) while
// anything downloads, with the overall progress as an arc. It stays 6 s after the last download
// finishes. Click: the quick view (DownloadsPopover); right-click: the ring menu. New downloads
// fly into it as a 32 px glass circle (480 ms on the spring) and it pulses.
import type { DownloadView } from '../../../main/modules/downloads/types';
import type { Browser } from '../../app';
import { glassLayers, lens } from '../../glass';
import * as f from './format';
import { ic } from './icons';
import { closeMenu, openMenu, type MenuEntry } from './menu';
import type { Panel } from './panel';
import type { DownloadStore } from './store';

const CIRC = 2 * Math.PI * 14;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Ring {
  private el: HTMLElement;
  private btn: HTMLButtonElement;
  private arc: SVGCircleElement;
  private shown = false;
  private hideTimer: number | null = null;
  private pop: Popover;

  constructor(private b: Browser, private store: DownloadStore, private panel: Panel) {
    const layer = b.layer('downloads-ring', 11);
    this.el = document.createElement('div');
    this.el.className = 'vd-ring vd-glass';
    this.el.innerHTML = `${glassLayers()}<button type="button" aria-haspopup="dialog" title="Downloads  Ctrl+J">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle class="track" cx="17" cy="17" r="14" fill="none" stroke-width="2"/>
        <g class="spin"><circle class="arc" cx="17" cy="17" r="14" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 ${CIRC}" transform="rotate(-90 17 17)"/></g>
        <path d="M17 11.5v9M13.6 17.2 17 20.6l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></button>`;
    (this.el.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(44, 44);
    layer.append(this.el);
    this.btn = this.el.querySelector('button') as HTMLButtonElement;
    this.arc = this.el.querySelector('.arc') as SVGCircleElement;
    this.pop = new Popover(b, store, panel, this);
    this.btn.addEventListener('click', (e) => this.pop.toggle((e as MouseEvent).detail === 0));
    this.btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void this.menu(false);
    });
    this.btn.addEventListener('keydown', (e) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        void this.menu(true);
      }
    });
    store.subscribe(() => this.update());
  }

  /** Window coordinates of the ring's centre (also while it is hidden). */
  center(): { x: number; y: number } {
    return { x: window.innerWidth - 72 - 22, y: window.innerHeight - 20 - 22 };
  }

  get popoverOpen(): boolean {
    return this.pop.isOpen;
  }

  update(): void {
    const views = this.store.all();
    const active = views.filter(f.isActive);
    if (active.length) {
      if (this.hideTimer !== null) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      this.show();
    } else if (this.shown && this.hideTimer === null) {
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = null;
        if (!this.pop.isOpen && !this.store.all().some(f.isActive)) this.hide();
      }, 6000);
    }
    const known = active.filter((v) => v.total > 0);
    const total = known.reduce((n, v) => n + v.total, 0);
    const got = known.reduce((n, v) => n + Math.min(v.received, v.total), 0);
    const pct = active.length ? (total ? got / total : 0) : 1;
    const spinning = active.length > 0 && !known.length && active.some((v) => v.state === 'downloading');
    this.el.classList.toggle('indeterminate', spinning);
    this.arc.setAttribute('stroke-dasharray', `${(spinning ? 0.25 : Math.max(pct, active.length ? 0.02 : 1)) * CIRC} ${CIRC}`);
    const label = active.length ? `Downloads, ${active.length} active${known.length ? `, ${Math.floor(pct * 100)} percent` : ''}` : 'Downloads, finished';
    this.btn.setAttribute('aria-label', label);
    this.pop.render();
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.el.classList.add('shown');
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('shown');
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
    const dot = document.createElement('div');
    dot.className = 'vd-flight vd-glass';
    dot.innerHTML = `${glassLayers()}<span>${f.esc(f.tile(view.filename))}</span>`;
    (dot.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(32, 32);
    this.b.layer('downloads-flight', 45).append(dot);
    const at = (p: { x: number; y: number }, s: number) => `translate(${p.x - 16}px, ${p.y - 16}px) scale(${s})`;
    dot.animate([{ transform: at(from, 1) }, { transform: at(to, 0.82) }], { duration: 480, easing: SPRING, fill: 'forwards' });
    dot.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 480, fill: 'forwards' }).onfinish = () => {
      dot.remove();
      this.pulse();
    };
  }

  private async menu(keyboard: boolean): Promise<void> {
    this.pop.close(false);
    const views = this.store.all();
    const anyActive = views.some(f.isActive);
    const anyPaused = views.some((v) => v.state === 'paused');
    const copied = (await window.vitre.ipc.invoke('dl:clipboard-url')) as string | null;
    const entries: MenuEntry[] = [
      { label: 'Show downloads', key: 's', accel: 'Ctrl+J', run: () => this.panel.show() },
      { label: 'Open Downloads folder', key: 'f', run: () => void window.vitre.ipc.invoke('dl:open-folder') },
      'separator',
      anyActive || !anyPaused
        ? { label: 'Pause all', key: 'p', disabled: !anyActive, run: () => void window.vitre.ipc.invoke('dl:pause-all') }
        : { label: 'Resume all', key: 'r', run: () => void window.vitre.ipc.invoke('dl:resume-all') },
    ];
    if (copied) entries.push({ label: 'Download copied link', key: 'd', run: () => void this.store.start(copied, { origin: this.center() }) });
    entries.push({ label: 'Clear finished', key: 'c', disabled: !views.some(f.isFinished), run: () => void window.vitre.ipc.invoke('dl:clear-finished') });
    // Opens up and to the left: right edge at the ring's right, bottom 8 px above it.
    openMenu(this.b, 'Downloads', entries, { right: window.innerWidth - 72, bottom: window.innerHeight - 72 }, { keyboard, returnFocus: this.btn });
  }

  focus(): void {
    this.btn.focus();
  }
}

/** The quick view above the ring: what is downloading now and what just finished. */
class Popover {
  private el: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;
  private rows = new Map<string, HTMLElement>();
  private height = 0;
  private unEsc: (() => void) | null = null;

  constructor(private b: Browser, private store: DownloadStore, private panel: Panel, private ring: Ring) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  toggle(keyboard: boolean): void {
    if (this.el) this.close(true);
    else this.open(keyboard);
  }

  open(keyboard: boolean): void {
    closeMenu();
    void this.store.reload();
    const layer = this.b.layer('downloads-pop', 30);
    this.catcher = document.createElement('div');
    this.catcher.className = 'vd-menu-catcher';
    this.catcher.addEventListener('pointerdown', () => this.close(false));
    const el = document.createElement('section');
    el.className = 'vd-pop vd-glass';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Downloads');
    el.tabIndex = -1;
    el.innerHTML = `${glassLayers()}<div class="vd-pop-body">
      <div class="vd-pop-head"><b>Downloads</b><span class="vd-pop-sum"></span></div>
      <div class="vd-pop-list"></div>
      <button type="button" class="vd-pop-open">Open Downloads</button></div>`;
    layer.append(this.catcher, el);
    this.el = el;
    this.rows.clear();
    this.height = 0;
    el.querySelector('.vd-pop-open')?.addEventListener('click', () => {
      this.close(false);
      this.panel.show();
    });
    el.addEventListener('keydown', (e) => this.keys(e));
    this.unEsc = this.b.addEscLayer(30, () => {
      this.close(true);
      return true;
    });
    this.render();
    if (!reduced()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'cubic-bezier(0.2,0,0,1)' });
      el.animate([{ transform: 'translate(4px, 6px) scale(0.96)' }, { transform: 'none' }], { duration: 240, easing: SPRING });
    } else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    const first = el.querySelector<HTMLElement>('.vd-pop-row') ?? el.querySelector<HTMLElement>('.vd-pop-open');
    if (keyboard) first?.focus();
    else el.focus();
  }

  close(focusRing: boolean): void {
    const el = this.el;
    if (!el) return;
    this.el = null;
    this.unEsc?.();
    this.unEsc = null;
    this.catcher?.remove();
    this.catcher = null;
    el.style.pointerEvents = 'none';
    const hadFocus = el.contains(document.activeElement);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 150 : 120, fill: 'forwards' }).onfinish = () => el.remove();
    if (focusRing) this.ring.focus();
    else if (hadFocus) this.b.focusPage();
    this.ring.update();
  }

  render(): void {
    const el = this.el;
    if (!el) return;
    const views = this.store.all().filter((v) => v.state !== 'cancelled');
    const active = views.filter((v) => f.isActive(v));
    const rate = active.reduce((n, v) => n + v.speed, 0);
    setText(el.querySelector('.vd-pop-sum') as HTMLElement, active.length ? `${active.length} active${rate > 0 ? ` · ${f.speed(rate)}` : ''}` : views.length ? 'All done' : 'Nothing yet');
    const pick = views.slice(0, 3);
    const list = el.querySelector('.vd-pop-list') as HTMLElement;
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
        if (i) {
          const sep = document.createElement('div');
          sep.className = 'vd-pop-sep';
          list.append(sep);
        }
        list.append(this.rows.get(v.id) as HTMLElement);
      });
      if (!pick.length) {
        const empty = document.createElement('div');
        empty.className = 'vd-pop-empty';
        empty.textContent = 'Downloads you start appear here.';
        list.append(empty);
      }
    }
    const h = el.offsetHeight;
    if (h !== this.height) {
      this.height = h;
      (el.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(360, h, { radius: 20, scale: 24, blur: 14 });
    }
  }

  private row(id: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vd-pop-row';
    row.tabIndex = -1;
    row.dataset.id = id;
    row.innerHTML = `<span class="vd-tile"></span><div class="vd-pop-info"><span class="vd-pop-name"></span><div class="vd-pop-segs"></div><span class="vd-pop-meta"></span></div><button type="button" class="vd-round" tabindex="-1"></button>`;
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.close(false);
      this.panel.show(id);
    });
    row.querySelector('button')?.addEventListener('click', () => {
      const v = this.store.get(id);
      if (v) this.store.primary(v);
    });
    return row;
  }

  private update(row: HTMLElement, v: DownloadView): void {
    const done = f.isFinished(v);
    row.classList.toggle('done', done);
    setText(row.querySelector('.vd-tile') as HTMLElement, f.tile(v.filename));
    setText(row.querySelector('.vd-pop-name') as HTMLElement, v.filename);
    const segs = row.querySelector('.vd-pop-segs') as HTMLElement;
    const fills = done ? [] : v.segments.length > 1 && v.maxConnections > 1 ? v.segments : v.total > 0 ? [v.received / v.total] : [];
    segs.hidden = !fills.length;
    segs.classList.toggle('dim', v.state === 'paused');
    segs.classList.toggle('single', fills.length === 1);
    if (segs.childElementCount !== fills.length) segs.innerHTML = fills.map(() => '<span><i></i></span>').join('');
    fills.forEach((x, i) => ((segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, x) * 100)}%`));
    setText(row.querySelector('.vd-pop-meta') as HTMLElement, meta(v));
    const btn = row.querySelector('button') as HTMLElement;
    const [k, label, icon] = v.state === 'downloading' || v.state === 'starting' ? ['p', 'Pause', ic.pause(12)] : v.state === 'queued' ? ['n', 'Start now', ic.play(12)] : v.state === 'paused' ? ['r', 'Resume', ic.play(12)] : v.state === 'completed' && !v.missing ? ['f', 'Show in folder', ic.folder(14, 1.6)] : ['t', 'Retry', ic.retry];
    if (btn.dataset.k !== k) {
      btn.dataset.k = k;
      btn.innerHTML = icon;
    }
    btn.setAttribute('aria-label', `${label} ${v.filename}`);
    btn.title = label;
    row.setAttribute('aria-label', `${v.filename}, ${meta(v)}`);
  }

  private keys(e: KeyboardEvent): void {
    const el = this.el;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>('.vd-pop-row, .vd-pop-open')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Enter' && (document.activeElement as HTMLElement)?.classList.contains('vd-pop-row')) (document.activeElement as HTMLElement).click();
    else if (e.key === ' ' && (document.activeElement as HTMLElement)?.classList.contains('vd-pop-row')) {
      // Space is the row's own button: pause, resume, start now, show in folder or retry.
      (document.activeElement?.querySelector('.vd-round') as HTMLElement | null)?.click();
    } else if (e.key === 'Tab') {
      e.preventDefault();
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

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
