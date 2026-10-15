// The Downloads panel (Ctrl+J): a 960x688 frosted panel over the page dimmed at 0.3 (board
// Downloads). Filters and categories on the left; the list with the connection bar, speed and time;
// the selected download's details (8-block connection bar, Average / Peak / Received, Address,
// Saved to, From page, Started, actions) at the bottom. Port of
// app/src/renderer/modules/downloads/panel.ts, built with createElement (browser.xhtml sanitizes
// innerHTML and page-derived strings never go through a parser).
//
// Keys (keymap.json "Downloads panel"): Up/Down/Home/End move, Enter opens a finished file, Space
// pauses or resumes, Delete removes the row (never the file), Shift+F10 or the Menu key opens the
// row's menu, Ctrl+F (the core sends 'vitre:panel-find') searches, Esc and Ctrl+W close the panel
// (Esc ladder 60, close ladder 60), Ctrl+J toggles it.
//
// Size: always laid out at 960x688 (the lens is built for that size); below 992x720 the whole panel
// is scaled down around its centre so it fits with a 16 px margin, as Settings does: nothing in it
// re-flows, so nothing overlaps or is cut in a small window. A popup window (b.isPopup) is too small
// for it: the panel opens in the most recent normal window of the same privacy, which comes to the
// front (Settings does the same); with no such window it opens in the popup.
import type { Browser } from '../../browser';
import { el } from '../../dom';
import * as fx from '../../firefox';
import { scrollThumb } from '../../scrollthumb';
import { glass, lens } from '../../glass';
import type { AddressResult, Category, DownloadView } from '../../../modules/downloads/types';
import * as f from './format';
import { CATEGORY_ICON, ic, node } from './icons';
import { closeMenu, openMenu, type MenuEntry } from './menu';
import type { Command, DownloadStore } from './store';
import { leaveElementFullscreen } from './system';

type Filter = 'all' | 'active' | 'queued' | 'paused' | 'done' | Category;

const FILTERS: { id: Filter; label: string; icon: string; test: (v: DownloadView) => boolean }[] = [
  { id: 'all', label: 'All', icon: ic.all, test: () => true },
  { id: 'active', label: 'Downloading', icon: ic.downloading, test: (v) => v.state === 'downloading' || v.state === 'starting' },
  { id: 'queued', label: 'Queued', icon: ic.queued, test: (v) => v.state === 'queued' },
  { id: 'paused', label: 'Paused', icon: ic.paused, test: (v) => v.state === 'paused' },
  { id: 'done', label: 'Completed', icon: ic.completed, test: (v) => v.state === 'completed' },
];
/** Images and Other show only when something is in them. */
const CATEGORIES: Category[] = ['video', 'music', 'documents', 'compressed', 'programs', 'images', 'other'];

export const LIMITS = [0, 256, 512, 1024, 2048, 5120, 10240];
export const limitLabel = (kbps: number): string => (kbps ? f.speed(kbps * 1024) : 'No speed limit');

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The panel's own size (board Downloads) and the least margin to the window's edges. */
const W = 960;
const H = 688;
const MARGIN = 16;

interface Els {
  scrim: HTMLElement;
  panel: HTMLElement;
  lens: HTMLElement;
  nav: HTMLElement;
  search: HTMLInputElement;
  summary: HTMLElement;
  addBtn: HTMLButtonElement;
  pauseAll: HTMLButtonElement;
  limit: HTMLButtonElement;
  limitText: HTMLElement;
  add: HTMLFormElement;
  addInput: HTMLInputElement;
  addNote: HTMLElement;
  list: HTMLElement;
  details: HTMLElement;
}

interface RowEls {
  row: HTMLElement;
  tile: HTMLElement;
  name: HTMLElement;
  sub: HTMLElement;
  prog: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  pct: HTMLElement;
  status: HTMLElement;
  speed: HTMLElement;
  time: HTMLElement;
  primary: HTMLButtonElement;
  more: HTMLButtonElement;
}

export class Panel {
  private els: Els | null = null;
  private isOpen = false;
  private filter: Filter = 'all';
  private query = '';
  private selected = '';
  private rows = new Map<string, RowEls>();
  private undo: (() => void)[] = [];
  private returnFocus: HTMLElement | null = null;
  private lensSet = false;
  /** The open panel's overlay scroll thumbs (detached when it closes). */
  private thumbs: (() => void)[] = [];
  private details: { id: string; acts: string; els: Record<string, HTMLElement> } | null = null;
  /** The address the "Use another address…" note is about ("Use it and start over" starts from it). */
  private addrUrl = '';
  /**
   * The id Add link selected when the engine took the address for a waiting row's file (it returned that
   * row's id), until the proof decides: an attach keeps it; otherwise the new row ('added' with
   * `replaces`) is selected instead (review of Phase 3).
   */
  private addedAs = '';
  /** Redraws the open panel every second while a row counts down to its next try (Retrying · in 40 s). */
  private countdown = 0;

  constructor(
    private b: Browser,
    private store: DownloadStore
  ) {
    store.subscribe(() => {
      if (this.isOpen) this.render();
    });
    store.onAdded((ev) => {
      if (!ev.replaces || ev.replaces !== this.addedAs) return;
      this.addedAs = '';
      if (this.selected === ev.replaces) this.selected = ev.view.id;
    });
    store.onAttached((ev) => {
      if (ev.view.id === this.addedAs) this.addedAs = '';
    });
    const resize = (): void => {
      if (this.isOpen) this.layout();
    };
    window.addEventListener('resize', resize);
    b.onDestroy(() => window.removeEventListener('resize', resize));
    b.on('settings', () => {
      if (this.isOpen) this.render();
    });
    b.onDestroy(() => this.tickCountdown(false));
    // Switching tabs underneath (Ctrl+Tab, Ctrl+1) focuses the page; the panel keeps the keys.
    b.on('tab-activated', () => {
      if (this.isOpen) this.focusSelected();
    });
    const find = (): void => {
      if (this.isOpen) this.els?.search.focus();
    };
    document.addEventListener('vitre:panel-find', find);
    b.onDestroy(() => document.removeEventListener('vitre:panel-find', find));
  }

  get open(): boolean {
    return this.isOpen;
  }

  private showHooks: (() => void)[] = [];

  /** Run fn whenever the panel opens (the quick view and the picker close: the panel is topmost). */
  onShow(fn: () => void): void {
    this.showHooks.push(fn);
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(focusId?: string): void {
    if (this.elsewhere(focusId)) return;
    if (focusId) {
      this.selected = focusId;
      this.filter = 'all';
      this.query = '';
      if (this.els) this.els.search.value = '';
    }
    if (this.isOpen) {
      this.render();
      this.focusSelected();
      return;
    }
    this.isOpen = true;
    closeMenu(this.b);
    // Ctrl+J over a full-screen video: the panel shows once the page leaves full screen.
    leaveElementFullscreen(this.b);
    for (const fn of this.showHooks) {
      try {
        fn();
      } catch (e) {
        console.error('Deer downloads: panel hook failed', e);
      }
    }
    // Files moved or deleted since the list was read show as such.
    this.store.reload();
    const active = document.activeElement as HTMLElement | null;
    // The address field steps aside for the panel; closing returns to the page, not to it.
    const omni = this.b.omni.open;
    if (omni) this.b.omni.close();
    this.b.closePanels();
    this.returnFocus = !omni && active && active.localName !== 'browser' && this.b.root.contains(active) ? active : null;
    const els = this.build();
    this.layout();
    this.render();
    void els.panel.offsetWidth;
    els.scrim.classList.add('in');
    els.panel.classList.add('in');
    this.b.root.classList.add('panel-open', 'downloads-open');
    this.undo.push(
      this.b.addEscLayer(60, () => {
        this.hide();
        return true;
      }),
      this.b.addCloseLayer(60, () => {
        this.hide();
        return true;
      })
    );
    this.focusSelected();
  }

  /** In a popup window: open the panel in the most recent normal window instead (see the header). */
  private elsewhere(focusId?: string): boolean {
    if (!this.b.isPopup) return false;
    const win = fx.topBrowserWindow(this.b.isPrivate);
    const other = win && win !== window ? (win as Window).vitre : undefined;
    const api = other && !other.isPopup ? other.service('downloads') : undefined;
    if (!api) return false;
    api.openPanel(focusId);
    win!.focus();
    return true;
  }

  hide(): void {
    if (!this.isOpen || !this.els) return;
    this.isOpen = false;
    for (const u of this.undo.splice(0)) u();
    closeMenu(this.b);
    this.b.root.classList.remove('downloads-open');
    // Settings may still be open (it puts settings-open next to panel-open: browser.ts header).
    if (!this.b.root.classList.contains('settings-open')) this.b.root.classList.remove('panel-open');
    const { scrim, panel } = this.els;
    for (const off of this.thumbs.splice(0)) off();
    this.els = null;
    this.rows.clear();
    this.details = null;
    panel.classList.remove('in');
    scrim.classList.remove('in');
    panel.style.pointerEvents = 'none';
    scrim.style.pointerEvents = 'none';
    window.setTimeout(
      () => {
        panel.remove();
        scrim.remove();
      },
      reduced() ? 160 : 300
    );
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    else this.b.focusPage();
  }

  // ---- building ----

  private build(): Els {
    const layer = this.b.layer('downloads-panel', 30);
    const scrim = el('div', { class: 'vd-scrim' });
    scrim.addEventListener('pointerdown', () => this.hide());
    const panel = el('section', { class: 'vd-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Downloads' });
    const layers = glass(panel);

    const close = el('button', { type: 'button', class: 'vd-close', 'aria-label': 'Close downloads' }, node(ic.close));
    close.addEventListener('click', () => this.hide());
    const head = el('header', { class: 'vd-head' }, node(ic.download(16)), el('h2', {}, 'Downloads'), close);

    const search = el('input', { type: 'search', placeholder: 'Search downloads', 'aria-label': 'Search downloads', spellcheck: 'false', autocomplete: 'off' });
    const nav = el('div', { class: 'vd-filters' });
    const navBox = el('nav', { class: 'vd-nav', 'aria-label': 'Download filters' }, el('label', { class: 'vd-search' }, node(ic.search), search), nav);

    const summary = el('span', { class: 'vd-summary' });
    const addBtn = el('button', { type: 'button', class: 'vd-btn accent vd-add-btn' }, node(ic.plus), 'Add link');
    const pauseAll = el('button', { type: 'button', class: 'vd-btn vd-pause-all' }, 'Pause all');
    const limitText = el('span', {});
    const limit = el('button', { type: 'button', class: 'vd-btn vd-limit', 'aria-haspopup': 'menu' }, limitText, node(ic.chevron));
    const toolbar = el('div', { class: 'vd-toolbar' }, summary, addBtn, pauseAll, limit);

    const addInput = el('input', { type: 'text', inputmode: 'url', placeholder: 'Paste a link to download', 'aria-label': 'Link to download', spellcheck: 'false', autocomplete: 'off' });
    const addNote = el('span', { class: 'vd-add-note', role: 'alert' });
    const addCancel = el('button', { type: 'button', class: 'vd-btn vd-add-cancel' }, 'Cancel');
    const addGo = el('button', { type: 'submit', class: 'vd-btn accent vd-add-go' }, 'Download');
    const add = el('form', { class: 'vd-add', novalidate: true }, el('label', { class: 'vd-field' }, node(ic.link), addInput), addGo, addCancel, addNote);
    add.hidden = true;

    const cols = el('div', { class: 'vd-cols', 'aria-hidden': 'true' }, el('span', {}), el('span', {}, 'Name'), el('span', {}, 'Progress'), el('span', {}, 'Speed'), el('span', {}, 'Time'), el('span', {}));
    const list = el('div', { class: 'vd-list', role: 'grid', 'aria-label': 'Downloads', 'aria-multiselectable': 'false' });
    const details = el('section', { class: 'vd-details', 'aria-label': 'Details' });
    details.hidden = true;
    const content = el('div', { class: 'vd-content' }, toolbar, add, cols, list, details);
    const main = el('div', { class: 'vd-main' }, navBox, el('div', { class: 'vd-divider' }), content);
    panel.append(el('div', { class: 'vd-body' }, head, main));
    layer.append(scrim, panel);

    const els: Els = { scrim, panel, lens: layers.lens, nav, search, summary, addBtn, pauseAll, limit, limitText, add, addInput, addNote, list, details };
    this.els = els;
    this.lensSet = false;
    for (const off of this.thumbs.splice(0)) off();
    this.thumbs.push(scrollThumb(navBox), scrollThumb(list));

    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusSelected();
      }
    });
    nav.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-filter]');
      if (!btn) return;
      this.filter = btn.dataset.filter as Filter;
      this.render();
    });
    addBtn.addEventListener('click', () => this.openAdd());
    addCancel.addEventListener('click', () => this.closeAdd());
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAdd();
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeAdd();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.submitAdd();
      }
    });
    pauseAll.addEventListener('click', () => {
      const anyActive = this.store.all().some(f.isActive);
      if (anyActive) this.store.pauseAll();
      else this.store.resumeAll();
    });
    limit.addEventListener('click', (e) => this.limitMenu(limit, (e as MouseEvent).detail === 0, this.b.settings.speedLimitKBps, (kbps) => this.b.sys('VitreSettings').set({ speedLimitKBps: kbps })));
    list.addEventListener('keydown', (e) => this.listKeys(e));
    // Tab stays inside the panel while it is open.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]):not([disabled]), input, [tabindex="0"]')).filter((x) => x.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    return els;
  }

  /** Centre the panel at 960x688; below 992x720 scale it down so it always fits with a margin. */
  private layout(): void {
    if (!this.els) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fit = Math.min(1, (vw - 2 * MARGIN) / W, (vh - 2 * MARGIN) / H);
    const { panel, lens: lensEl } = this.els;
    panel.style.width = `${W}px`;
    panel.style.height = `${H}px`;
    panel.style.left = `${Math.round((vw - W) / 2)}px`;
    panel.style.top = `${Math.round((vh - H) / 2)}px`;
    panel.style.transform = fit < 1 ? `scale(${fit.toFixed(4)})` : '';
    if (!this.lensSet) {
      this.lensSet = true;
      lensEl.style.backdropFilter = lens(W, H, { radius: 22, scale: 24, blur: 22, opaque: true });
    }
  }

  // ---- rendering ----

  private render(): void {
    const els = this.els;
    if (!els) return;
    // A removed row (or a details pane for another download) may take keyboard focus with it.
    const hadFocus = els.panel.contains(document.activeElement);
    const views = this.store.all();
    this.renderNav(views);
    this.renderToolbar(views);
    const test = FILTERS.find((x) => x.id === this.filter)?.test ?? ((v: DownloadView) => v.category === this.filter);
    const shown = views.filter((v) => test(v) && (!this.query || v.filename.toLowerCase().includes(this.query) || v.url.toLowerCase().includes(this.query)));
    if (!shown.some((v) => v.id === this.selected)) this.selected = shown[0]?.id ?? '';
    const list = els.list;
    const keep = new Set(shown.map((v) => v.id));
    for (const [id, row] of this.rows) {
      if (!keep.has(id)) {
        row.row.remove();
        this.rows.delete(id);
      }
    }
    shown.forEach((v, i) => {
      let row = this.rows.get(v.id);
      if (!row) {
        row = this.createRow(v.id);
        this.rows.set(v.id, row);
      }
      this.updateRow(row, v);
      if (list.children[i] !== row.row) list.insertBefore(row.row, list.children[i] ?? null);
    });
    let empty = list.querySelector<HTMLElement>('.vd-empty');
    if (!shown.length) {
      if (!empty) {
        empty = el('div', { class: 'vd-empty' });
        list.append(empty);
      }
      f.setText(empty, views.length ? 'Nothing here.' : 'Downloads you start appear here.');
    } else empty?.remove();
    this.renderDetails(shown.find((v) => v.id === this.selected) ?? null);
    // Retrying counts down to its next try (RESUME-DESIGN.md 6): drawn again every second meanwhile.
    this.tickCountdown(shown.some((v) => f.isWaiting(v) && v.wait?.for === 'server'));
    if (hadFocus && !els.panel.contains(document.activeElement)) {
      const row = this.rows.get(this.selected);
      if (row) row.row.focus();
      else els.search.focus();
    }
  }

  private tickCountdown(on: boolean): void {
    if (on && !this.countdown) {
      this.countdown = window.setInterval(() => {
        if (this.isOpen) this.render();
        else this.tickCountdown(false);
      }, 1000);
    } else if (!on && this.countdown) {
      window.clearInterval(this.countdown);
      this.countdown = 0;
    }
  }

  private renderNav(views: DownloadView[]): void {
    const nav = this.els?.nav;
    if (!nav) return;
    const items: { id: Filter; label: string; icon: string; count: number; head?: string }[] = FILTERS.map((x) => ({ id: x.id, label: x.label, icon: x.icon, count: views.filter(x.test).length }));
    let first = true;
    for (const c of CATEGORIES) {
      const count = views.filter((v) => v.category === c).length;
      if ((c === 'images' || c === 'other') && !count && this.filter !== c) continue;
      items.push({ id: c, label: f.CATEGORY_LABEL[c], icon: CATEGORY_ICON[c], count, head: first ? 'Categories' : undefined });
      first = false;
    }
    // Rebuilt only when the list of filters changes; counts and the current one update in place, so
    // a focused filter keeps focus while downloads move between states.
    const shape = items.map((i) => i.id).join('|');
    if (nav.dataset.shape !== shape) {
      const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('[data-filter]')?.dataset.filter;
      nav.dataset.shape = shape;
      nav.replaceChildren();
      for (const i of items) {
        if (i.head) nav.append(el('div', { class: 'vd-nav-head' }, i.head));
        nav.append(el('button', { type: 'button', class: 'vd-filter', 'data-filter': i.id }, node(i.icon), el('span', { class: 'label' }, i.label), el('span', { class: 'count' })));
      }
      if (focused) nav.querySelector<HTMLElement>(`[data-filter="${focused}"]`)?.focus();
    }
    for (const i of items) {
      const btn = nav.querySelector<HTMLElement>(`[data-filter="${i.id}"]`);
      if (!btn) continue;
      f.setText(btn.querySelector('.count'), String(i.count));
      if (i.id === this.filter) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }

  private renderToolbar(views: DownloadView[]): void {
    const els = this.els;
    if (!els) return;
    const running = views.filter((v) => v.state === 'downloading' || v.state === 'starting');
    const queued = views.filter((v) => v.state === 'queued').length;
    const paused = views.filter((v) => v.state === 'paused').length;
    // Rows that need the person (Link expired, File changed, Start it again...): RESUME-DESIGN.md 6.
    const attention = views.filter((v) => v.state === 'paused' && !!v.need).length;
    // Waiting for network and Retrying (G4): still under way, Deer continues them by itself.
    const waiting = views.filter(f.isWaiting).length;
    const done = views.filter((v) => v.state === 'completed').length;
    const rate = running.reduce((n, v) => n + v.speed, 0);
    const parts: string[] = [];
    if (running.length) parts.push(`${running.length} downloading${rate > 0 ? ` at ${f.speed(rate)}` : ''}`);
    if (queued) parts.push(`${queued} queued`);
    if (waiting) parts.push(`${waiting} waiting`);
    if (paused > attention + waiting) parts.push(`${paused - attention - waiting} paused`);
    // A Damaged file needs the person too (RESUME-DESIGN.md 6, Phase 5).
    const damaged = views.filter(f.isDamaged).length;
    if (attention + damaged) parts.push(needAttention(attention + damaged));
    if (!parts.length) parts.push(done ? `${done} completed` : 'No downloads');
    f.setText(els.summary, parts.join(' · '));
    const anyActive = running.length > 0 || queued > 0 || waiting > 0;
    f.setText(els.pauseAll, anyActive || !paused ? 'Pause all' : 'Resume all');
    els.pauseAll.disabled = !anyActive && !paused;
    f.setText(els.limitText, limitLabel(this.b.settings.speedLimitKBps));
  }

  private createRow(id: string): RowEls {
    const tile = el('span', { class: 'vd-tile', role: 'gridcell' });
    const name = el('span', { class: 'n' });
    const sub = el('span', { class: 's' });
    const fill = el('i', {});
    const bar = el('div', { class: 'vd-bar' }, fill);
    const pct = el('span', { class: 'vd-pct' });
    const prog = el('div', { class: 'vd-prog' }, bar, pct);
    const status = el('span', { class: 'vd-status' });
    const speed = el('span', { class: 'vd-cell speed', role: 'gridcell' });
    const time = el('span', { class: 'vd-cell time', role: 'gridcell' });
    const primary = el('button', { type: 'button', class: 'vd-icon-btn primary', tabindex: '-1' });
    const more = el('button', { type: 'button', class: 'vd-icon-btn more', tabindex: '-1', 'aria-label': 'More actions', 'aria-haspopup': 'menu' }, node(ic.more));
    const row = el(
      'div',
      { class: 'vd-row', role: 'row', tabindex: '-1', 'data-id': id },
      tile,
      el('div', { class: 'vd-name', role: 'gridcell' }, name, sub),
      el('div', { class: 'vd-progcell', role: 'gridcell' }, prog, status),
      speed,
      time,
      el('div', { class: 'vd-acts', role: 'gridcell' }, primary, more)
    );
    row.addEventListener('pointerdown', () => this.select(id, false));
    row.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('button')) return;
      const v = this.store.get(id);
      if (v?.state === 'completed' && !v.missing) this.store.run('open', id);
    });
    primary.addEventListener('click', () => {
      const v = this.store.get(id);
      if (v) this.primary(v);
    });
    more.addEventListener('click', (e) => this.rowMenu(id, { at: more, align: 'end' }, (e as MouseEvent).detail === 0, more));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.select(id, false);
      this.rowMenu(id, { x: e.clientX, y: e.clientY }, false, row);
    });
    return { row, tile, name, sub, prog, bar, fill, pct, status, speed, time, primary, more };
  }

  private updateRow(r: RowEls, v: DownloadView): void {
    const sel = v.id === this.selected;
    r.row.setAttribute('aria-selected', String(sel));
    r.row.tabIndex = sel ? 0 : -1;
    f.setText(r.tile, f.tile(v.filename));
    f.setText(r.name, v.filename);
    const failed = v.state === 'failed' && !!v.error;
    r.sub.classList.toggle('err', failed);
    const size = v.total > 0 ? f.bytes(v.total) : v.received > 0 ? f.bytes(v.received) : '';
    // Waiting for link says where to start it again (RESUME-DESIGN.md 6).
    f.setText(r.sub, failed ? v.error : v.armed && v.pageUrl ? `Start it again on ${f.host(v.pageUrl)}` : [size, f.CATEGORY_LABEL[v.category]].filter(Boolean).join(' · '));

    const pct = f.percent(v);
    const transferring = v.state === 'downloading' && !v.phase;
    // Checking (RESUME-DESIGN.md 6): the bar stays dimmed at its old percentage.
    const checking = f.isChecking(v);
    // A row that needs the person says why where the bar was (RESUME-DESIGN.md 6); so does one that waits
    // to try again by itself (Waiting for network, Retrying: G4).
    const showBar = !v.need && !f.isWaiting(v) && v.total > 0 && (transferring || checking || v.state === 'paused');
    r.prog.hidden = !showBar;
    r.status.hidden = showBar;
    if (showBar) {
      r.bar.classList.toggle('dim', v.state === 'paused' || checking);
      r.fill.style.width = `${pct}%`;
      f.setText(r.pct, `${pct}%`);
    } else {
      const [text, cls, icon] = statusOf(v);
      if (r.status.dataset.k !== text + cls) {
        r.status.dataset.k = text + cls;
        r.status.className = `vd-status ${cls}`;
        r.status.replaceChildren(...(icon ? [node(icon)] : []), text);
      }
    }
    const [s, sCls] = transferring
      ? [f.speed(v.speed) || '—', v.speed > 0 ? '' : 'dim']
      : checking && showBar
        ? v.phase === 'checking' ? ['Checking', 'soft'] : ['—', 'dim']
        : v.state === 'paused' && showBar ? ['Paused', 'soft'] : ['—', 'dim'];
    r.speed.className = `vd-cell speed ${sCls}`;
    f.setText(r.speed, s);
    const [t, tCls] = transferring && v.eta >= 0 ? [f.eta(v.eta), ''] : v.state === 'queued' && v.queuePos === 1 ? ['Next', 'soft'] : v.state === 'completed' ? [f.finished(v.finishedAt), 'soft'] : ['—', 'dim'];
    r.time.className = `vd-cell time ${tCls}`;
    f.setText(r.time, t);

    const [kind, label, icon] = primaryOf(v);
    if (r.primary.dataset.k !== kind) {
      r.primary.dataset.k = kind;
      r.primary.replaceChildren(node(icon));
    }
    r.primary.setAttribute('aria-label', `${label} ${v.filename}`);
    r.row.setAttribute('aria-label', `${v.filename}, ${rowState(v)}`);
  }

  private renderDetails(v: DownloadView | null): void {
    const box = this.els?.details;
    if (!box) return;
    box.hidden = !v;
    if (!v) return;
    box.setAttribute('aria-label', `Details for ${v.filename}`);
    if (this.details?.id !== v.id) {
      const e: Record<string, HTMLElement> = {
        cap: el('span', { class: 'vd-d-cap', id: 'vd-d-cap' }),
        segs: el('div', { class: 'vd-segs' }),
        note: el('span', { class: 'vd-d-note' }),
        avg: el('span', { class: 'v' }),
        peak: el('span', { class: 'v' }),
        got: el('span', { class: 'v' }),
        addr: el('span', { class: 'v' }),
        dir: el('span', { class: 'v' }),
        // From page is a button (RESUME-DESIGN.md 6): it opens the page, in the download's container.
        page: el('button', { type: 'button', class: 'v vd-page' }),
        started: el('span', { class: 'v' }),
        acts: el('div', { class: 'vd-d-acts' }),
      };
      this.buildAddress(e);
      const stat = (k: string, v2: HTMLElement): HTMLElement => el('div', {}, el('span', { class: 'k' }, k), v2);
      box.replaceChildren(
        el('div', { class: 'vd-d-left' }, el('span', { class: 'vd-d-title' }, 'Connections'), e.cap, e.segs, e.note, el('div', { class: 'vd-stats' }, stat('Average', e.avg), stat('Peak', e.peak), stat('Received', e.got))),
        el(
          'div',
          { class: 'vd-d-right' },
          el('div', { class: 'vd-facts' }, el('span', { class: 'k' }, 'Address'), e.addr, el('span', { class: 'k' }, 'Saved to'), e.dir, el('span', { class: 'k' }, 'From page'), e.page, el('span', { class: 'k' }, 'Started'), e.started),
          e.acts,
          e.newAddr
        )
      );
      e.acts.addEventListener('click', (ev) => {
        const btn = (ev.target as Element).closest<HTMLElement>('[data-act]');
        const cur = this.store.get(this.details?.id ?? '');
        if (btn && cur) this.detailAction(btn.dataset.act ?? '', cur, btn);
      });
      e.page.addEventListener('click', () => {
        const cur = this.details?.id;
        if (cur) this.store.run('open-page', cur);
      });
      this.details = { id: v.id, acts: '', els: e };
    }
    const e = this.details.els;
    const running = v.state === 'downloading' && !v.phase;
    // Connections caption: how many are open, and whether the download can carry on later.
    let cap = '';
    // A finished file (RESUME-DESIGN.md 6, Phase 5): Repairing, Checking, Damaged, Changed after download.
    if (v.state === 'completed' && !v.missing && v.phase === 'repairing') cap = `Fetching ${f.damagedParts(v.repair?.parts ?? 0)} again${v.repair?.bytes ? ` (${f.bytes(v.repair.bytes)})` : ''}`;
    else if (v.state === 'completed' && !v.missing && v.phase === 'checking') cap = 'Checking the file';
    else if (f.isDamaged(v)) cap = damagedCaption(v);
    else if (f.isEdited(v)) cap = `This file was changed on ${f.day(v.check?.changedAt || Date.now())}`;
    else if (v.state === 'completed' && !v.missing && v.check?.site === 'changed') cap = 'The file on the site is different from this one.';
    else if (v.state === 'completed' && !v.missing && v.check?.media) cap = `${v.note || 'Finished'} · ffmpeg reports: ${v.check.media}`;
    else if (v.state === 'completed') cap = v.missing ? 'The file was moved or deleted' : v.note || 'Finished';
    else if (v.state === 'failed') cap = v.error || 'Failed';
    else if (v.state === 'cancelled') cap = 'Cancelled';
    else if (v.state === 'queued') cap = v.queuePos === 1 ? 'Queued · Next' : 'Queued';
    else if (v.phase === 'renewing') cap = `The link stopped working${v.status ? ` (${v.status})` : ''}. Looking for a new one`;
    else if (v.need?.kind === 'address' && v.armed) cap = `Start it again on ${f.host(v.pageUrl) || 'its page'}. Deer continues from ${f.percent(v)}%.`;
    else if (v.need?.kind === 'address') cap = `The link stopped working${v.need.status ? ` (${v.need.status})` : ''} · ${f.percent(v)}% is saved${v.nextAt ? ` · next try ${nextTry(v.nextAt)}` : ''}`;
    else if (v.need?.kind === 'choice') cap = `The file on the site is different from the one being downloaded. ${f.percent(v)}% of the old one is saved.`;
    else if (v.need?.kind === 'page') cap = `Start it again from its page${v.need.evidence ? `: ${v.need.evidence}` : ''}.`;
    // Waiting for network and Retrying (RESUME-DESIGN.md 6, G4).
    else if (f.isWaiting(v)) cap = v.wait?.for === 'server' ? `The site had a problem${v.status ? ` (${v.status})` : ''}. Trying again at ${nextTry(v.nextAt)}` : 'Continues when the connection is back';
    else if (v.phase === 'checking') cap = 'Checking the saved part and the link';
    else if (v.state === 'starting' || (v.phase === 'probing' && v.received <= 0)) cap = 'Starting';
    else if (v.phase === 'merging') cap = v.stream ? 'Joining video and sound' : 'Saving';
    else if (v.engine === 'browser') cap = `${v.state === 'downloading' ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else if (v.maxConnections <= 1) cap = `${running ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else cap = `${running ? `${Math.min(v.connections, v.maxConnections)} of ${v.maxConnections} active` : `${v.maxConnections} connections`} · ${v.stream ? 'Stream' : 'Resumable'}`;
    // Red only for Damaged and real failures (RESUME-DESIGN.md 6).
    e.cap.classList.toggle('err', v.state === 'failed' || f.isDamaged(v));
    e.cap.classList.toggle('wrap', !!v.need || v.phase === 'renewing' || f.isWaiting(v) || (v.state === 'completed' && (!!v.check || !!v.phase)));
    f.setText(e.cap, cap);
    // Damaged: the 8-block bar shows the damaged stretches empty (RESUME-DESIGN.md 6).
    const fills = f.isDamaged(v) && v.segments.length ? v.segments : v.state === 'completed' && !v.missing ? new Array<number>(v.maxConnections > 1 ? 8 : 1).fill(1) : v.segments;
    e.segs.hidden = !fills.length;
    const choice = v.need?.kind === 'choice';
    // Every automatic fix leaves a history line here (RESUME-DESIGN.md 6): "New link found today, 13:02".
    const line = choice ? '' : historyLine(v);
    e.note.hidden = !choice && !line && (!fills.length || v.maxConnections <= 1);
    // File changed: what differed, and exactly what each choice keeps (RESUME-DESIGN.md 6; owner's
    // decisions 2 and 3): Start over keeps the old part until the new file is complete, Keep partial the
    // unbroken beginning.
    const evidence = choice && v.need?.evidence ? `${v.need.evidence[0].toUpperCase()}${v.need.evidence.slice(1)}. ` : '';
    // The partial file an earlier Start over set aside goes with Keep partial too: the line says so
    // (review of Phase 3).
    const keeps = choice && v.keep ? ` Keep partial saves the first ${f.bytes(v.keep.bytes)} as ${v.keep.name}${v.keep.older ? ' and deletes the partial file an earlier Start over set aside' : ''}.` : '';
    f.setText(
      e.note,
      choice
        ? `${evidence}Start over keeps what is saved as ${v.stream ? 'old parts' : `${v.filename}.old.part`} until the new file is complete.${keeps}`
        : line
          ? line
          : v.stream
            ? 'Each block is a stretch of the video'
            : 'Each block is one part of the file, fetched in parallel'
    );
    if (e.segs.childElementCount !== fills.length) e.segs.replaceChildren(...fills.map(() => el('span', {}, el('i', {}))));
    e.segs.classList.toggle('dim', v.state === 'paused' || v.state === 'failed' || f.isChecking(v));
    fills.forEach((x, i) => ((e.segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(x * 100)}%`));
    f.setText(e.avg, f.speed(v.average) || '—');
    f.setText(e.peak, f.speed(v.peak) || '—');
    f.setText(e.got, v.received > 0 ? f.bytes(v.received) : '—');
    f.setText(e.addr, f.bare(v.url));
    f.setText(e.dir, f.folderLabel(v.dir, this.b.settings.downloadsFolder));
    f.setText(e.page, v.pageUrl ? f.bare(v.pageUrl) : '—');
    (e.page as HTMLButtonElement).disabled = !v.pageUrl;
    if (v.pageUrl) e.page.setAttribute('aria-label', `From page: ${f.bare(v.pageUrl)}. Open page`);
    else e.page.removeAttribute('aria-label');
    f.setText(e.started, f.when(v.startedAt));
    const acts = detailActions(v);
    const k = acts.map((a) => a.join(':')).join('|') + v.limitKBps;
    if (this.details.acts !== k) {
      this.details.acts = k;
      const holder = e.acts;
      // Pause turning into Resume replaces the buttons; keyboard focus stays in the same place.
      const at = Array.from(holder.children).indexOf(document.activeElement as Element);
      holder.replaceChildren(
        ...acts.map(([act, label, cls]) =>
          el('button', { type: 'button', class: `vd-d-btn ${cls}`, 'data-act': act, 'aria-haspopup': act === 'limit' ? 'menu' : null, 'aria-describedby': act === 'start-over' || act === 'keep-partial' || act === 'repair' || act === 'restore' ? 'vd-d-cap' : null }, act === 'limit' && v.limitKBps ? `Limited to ${limitLabel(v.limitKBps)}` : label)
        )
      );
      if (at >= 0) (holder.children[Math.min(at, holder.children.length - 1)] as HTMLElement | undefined)?.focus();
    }
  }

  private detailAction(act: string, v: DownloadView, btn: HTMLElement): void {
    if (act === 'limit') {
      this.limitMenu(btn, false, v.limitKBps, (kbps) => this.store.engine.setLimit(v.id, kbps));
      return;
    }
    if (act === 'remove') {
      this.removeRow(v.id);
      return;
    }
    if (act === 'use-address') {
      this.openAddress(v.id);
      return;
    }
    if (act === 'refresh') {
      this.refresh(v.id);
      return;
    }
    const map: Record<string, Command> = {
      pause: 'pause', resume: 'resume', now: 'start-now', try: 'start-now', retry: 'resume', open: 'open', folder: 'show-in-folder', copy: 'copy-address', cancel: 'cancel', keep: 'keep',
      'start-over': 'start-over', 'keep-partial': 'keep-partial', 'open-page': 'open-page', 'stop-waiting': 'stop-waiting',
      check: 'check', repair: 'repair', restore: 'restore', 'open-anyway': 'open', again: 'download-again',
    };
    const cmd = map[act];
    if (cmd) this.store.run(cmd, v.id);
  }

  /**
   * A row's primary verb (its button, Space). On a File changed row it only moves focus to the choice:
   * Space never destroys bytes (RESUME-DESIGN.md 6).
   */
  private primary(v: DownloadView): void {
    if (v.need?.kind === 'choice') this.choose(v.id);
    // Changed after download: Space only moves focus to Restore original (RESUME-DESIGN.md 6).
    else if (f.isEdited(v)) this.choose(v.id, 'restore');
    else this.afterRefresh(v.id, this.store.primary(v));
  }

  /** Refresh address from the panel (RESUME-DESIGN.md G1 manual fallback). */
  private refresh(id: string): void {
    this.afterRefresh(id, this.store.refresh(id));
  }

  /**
   * Refresh address found nothing and the download has no page to open (Add link, a pasted address):
   * the address field is the way left, so it opens (Use another address…).
   */
  private afterRefresh(id: string, done: Promise<string> | null): void {
    void done?.then((kind) => {
      const v = this.store.get(id);
      if (kind === 'none' && this.isOpen && v && canUseAddress(v)) this.openAddress(id);
    });
  }

  /**
   * Select a File changed row and put focus on its first choice (Start over), or a Changed after download
   * row's Restore original (`act`). The quick view uses it too.
   */
  choose(id: string, act = 'start-over'): void {
    if (!this.isOpen) this.show(id);
    this.select(id, false);
    requestAnimationFrame(() => this.details?.els.acts.querySelector<HTMLElement>(`[data-act="${act}"]`)?.focus());
  }

  // ---- Use another address… (RESUME-DESIGN.md 6) ----

  /**
   * The inline address field in the details: the Add link form's look and Esc handling, labelled "New
   * address for <name>". Its note says what the address turned out to be (a polite live region); for
   * another file it offers "Use it and start over".
   */
  private buildAddress(e: Record<string, HTMLElement>): void {
    const input = el('input', { type: 'text', inputmode: 'url', placeholder: 'Paste the new address', spellcheck: 'false', autocomplete: 'off' });
    const go = el('button', { type: 'submit', class: 'vd-btn accent vd-addr-go' }, 'Use address');
    const cancel = el('button', { type: 'button', class: 'vd-btn vd-addr-cancel' }, 'Cancel');
    const note = el('span', { class: 'vd-addr-note', role: 'status' });
    const over = el('button', { type: 'button', class: 'vd-d-btn danger vd-addr-over' }, 'Use it and start over');
    const form = el('form', { class: 'vd-add vd-addr', novalidate: true }, el('label', { class: 'vd-field' }, node(ic.link), input), go, cancel, note, over);
    form.hidden = true;
    over.hidden = true;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.submitAddress();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeAddress();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        void this.submitAddress();
      }
    });
    cancel.addEventListener('click', () => this.closeAddress());
    over.addEventListener('click', () => {
      const id = this.details?.id;
      if (!id || !this.addrUrl) return;
      void this.store.engine.startOver(id, this.addrUrl);
      this.closeAddress();
    });
    Object.assign(e, { newAddr: form, addrInput: input, addrGo: go, addrNote: note, addrOver: over });
  }

  /** Open the address field for a row (its details, its menu). */
  openAddress(id: string): void {
    if (!this.isOpen) this.show(id);
    if (this.selected !== id) this.select(id, false);
    const d = this.details;
    if (!d || d.id !== id) return;
    const v = this.store.get(id);
    (d.els.addrInput as HTMLInputElement).setAttribute('aria-label', `New address for ${v?.filename ?? 'this download'}`);
    d.els.newAddr.hidden = false;
    d.els.addrOver.hidden = true;
    f.setText(d.els.addrNote, '');
    this.addrUrl = '';
    requestAnimationFrame(() => (this.details?.els.addrInput as HTMLInputElement | undefined)?.focus());
  }

  private closeAddress(): void {
    const d = this.details;
    if (!d) return;
    d.els.newAddr.hidden = true;
    (d.els.addrInput as HTMLInputElement).value = '';
    f.setText(d.els.addrNote, '');
    d.els.addrOver.hidden = true;
    this.addrUrl = '';
    const back = d.els.acts.querySelector<HTMLElement>('[data-act="use-address"]') ?? this.rows.get(d.id)?.row;
    back?.focus();
  }

  private async submitAddress(): Promise<void> {
    const d = this.details;
    if (!d) return;
    const id = d.id;
    let url = (d.els.addrInput as HTMLInputElement).value.trim();
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    d.els.addrOver.hidden = true;
    if (!/^https?:\/\/\S+$/i.test(url)) {
      f.setText(d.els.addrNote, 'Enter a web address that starts with http or https.');
      return;
    }
    const go = d.els.addrGo as HTMLButtonElement;
    go.disabled = true;
    f.setText(d.els.addrNote, 'Checking that address…');
    let r: AddressResult;
    try {
      r = await this.store.engine.setAddress(id, url);
    } catch {
      r = { ok: false, kind: 'unreachable', note: 'Deer couldn’t reach that address.' };
    }
    go.disabled = false;
    // Another row was chosen meanwhile: its details are not this note's.
    if (this.details?.id !== id) return;
    if (r.ok) {
      this.closeAddress();
      return;
    }
    this.addrUrl = url;
    f.setText(this.details.els.addrNote, r.note);
    this.details.els.addrOver.hidden = !(r.kind === 'different' || r.kind === 'unknown');
  }

  // ---- selection and keys ----

  private select(id: string, focus: boolean): void {
    this.selected = id;
    for (const [rid, row] of this.rows) {
      row.row.setAttribute('aria-selected', String(rid === id));
      row.row.tabIndex = rid === id ? 0 : -1;
    }
    this.renderDetails(this.store.get(id) ?? null);
    if (focus) this.rows.get(id)?.row.focus();
  }

  private focusSelected(): void {
    requestAnimationFrame(() => {
      const row = this.rows.get(this.selected);
      if (row) {
        row.row.focus();
        row.row.scrollIntoView({ block: 'nearest' });
      } else this.els?.search.focus();
    });
  }

  /** Row ids in the order they are shown. */
  private order(): string[] {
    return Array.from(this.els?.list.children ?? [])
      .map((x) => (x as HTMLElement).dataset.id)
      .filter((x): x is string => !!x && this.rows.has(x));
  }

  /** Take a row off the list; the selection moves to its neighbour rather than back to the top. */
  private removeRow(id: string): void {
    if (id === this.selected) {
      const order = this.order();
      const i = order.indexOf(id);
      this.selected = order[i + 1] ?? order[i - 1] ?? '';
    }
    this.store.run('remove', id);
  }

  private listKeys(e: KeyboardEvent): void {
    const order = this.order();
    const i = order.indexOf(this.selected);
    const go = (j: number): void => {
      const id = order[Math.max(0, Math.min(order.length - 1, j))];
      if (!id) return;
      this.select(id, true);
      this.rows.get(id)?.row.scrollIntoView({ block: 'nearest' });
    };
    const v = this.store.get(this.selected);
    // A row's own button (focused after its menu closed) keeps Enter and Space.
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).closest('button')) return;
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(order.length - 1);
    else if (e.key === 'Enter' && v) {
      if (v.state === 'completed' && !v.missing) this.store.run('open', v.id);
    } else if (e.key === ' ' && v) {
      // A finished file: Space is Repair on a Damaged row, and only moves focus on a Changed after download one.
      if (v.state !== 'completed' || f.isDamaged(v) || f.isEdited(v)) this.primary(v);
    } else if (e.key === 'Delete' && v) {
      this.removeRow(v.id);
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const row = this.rows.get(this.selected);
      if (row && v) {
        const r = row.row.getBoundingClientRect();
        this.rowMenu(v.id, { x: r.left + 44, y: r.bottom + 4 }, true, row.row);
      }
    } else return;
    e.preventDefault();
  }

  // ---- menus ----

  private rowMenu(id: string, place: Parameters<typeof openMenu>[3], keyboard: boolean, from: HTMLElement): void {
    const v = this.store.get(id);
    if (!v) return;
    const run = (cmd: Command) => () => this.store.run(cmd, id);
    const entries: MenuEntry[] = [];
    const active = v.state === 'downloading' || v.state === 'starting';
    // A finished file (RESUME-DESIGN.md 6, Phase 5): Damaged offers Repair (Download again once the site's file
    // changed) and Open anyway; Changed after download, Restore original; every finished file, Check file (H).
    if (f.isDamaged(v)) {
      if (v.check?.site === 'changed') entries.push({ label: 'Download again', access: 'd', icon: 'reload', run: run('download-again') });
      else entries.push({ label: 'Repair', access: 'e', key: v.phase ? undefined : 'Space', icon: 'reload', run: run('repair') });
      entries.push({ label: 'Open anyway', access: 'o', icon: 'open', run: run('open') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') }, { label: 'Check file', access: 'h', icon: 'verify', run: run('check') });
    } else if (f.isEdited(v)) entries.push({ label: 'Restore original', access: 's', icon: 'reload', run: run('restore') }, { label: 'Open', access: 'o', key: 'Enter', icon: 'open', run: run('open') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else if (v.state === 'completed' && !v.missing) entries.push({ label: 'Open', access: 'o', key: 'Enter', icon: 'open', run: run('open') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') }, { label: 'Check file', access: 'h', icon: 'verify', run: run('check') });
    else if (v.state === 'completed') entries.push({ label: 'Download again', access: 'd', icon: 'reload', run: run('resume') });
    else if (active) entries.push({ label: 'Pause', access: 'p', key: 'Space', icon: 'pause', run: run('pause') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else if (v.state === 'queued') entries.push({ label: 'Start now', access: 's', icon: 'play', run: run('start-now') }, { label: 'Pause', access: 'p', key: 'Space', icon: 'pause', run: run('pause') });
    else if (v.need?.kind === 'address') {
      // Renewing link: Space pauses (the attempt stops); with attempts planned, Pause stops those too (RESUME-DESIGN.md 6, G4).
      const renewing = v.phase === 'renewing';
      const space = renewing ? undefined : 'Space';
      if (renewing) entries.push({ label: 'Pause', access: 'p', key: 'Space', icon: 'pause', run: run('pause') });
      else if (v.nextAt) entries.push({ label: 'Pause', access: 'p', icon: 'pause', run: run('pause') });
      // Waiting for link: Open page and Stop waiting; Link expired: Refresh address (Retry for a stream).
      if (v.armed) entries.push({ label: 'Open page', access: 'o', key: space, icon: 'opentab', run: run('open-page') }, { label: 'Stop waiting', access: 'w', icon: 'close', run: run('stop-waiting') });
      else {
        entries.push(v.canRenew ? { label: 'Refresh address', access: 'e', key: space, icon: 'reload', run: () => this.refresh(id) } : { label: 'Retry', access: 't', key: space, icon: 'reload', run: run('resume') });
        if (v.pageUrl) entries.push({ label: 'Open page', access: 'o', icon: 'opentab', run: run('open-page') });
      }
      if (canUseAddress(v)) entries.push({ label: 'Use another address…', access: 'u', icon: 'link', run: () => this.openAddress(id) });
      entries.push({ label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    }
    else if (v.need?.kind === 'choice') {
      entries.push({ label: 'Start over with the new file', access: 'n', icon: 'reload', run: run('start-over') });
      if (v.keep) entries.push({ label: 'Keep partial file', access: 'k', icon: 'download', run: run('keep-partial') });
      entries.push({ label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    }
    else if (v.need?.kind === 'page') entries.push({ label: 'Open page', access: 'o', key: 'Space', icon: 'opentab', run: run('open-page') });
    // Waiting for network, Retrying (RESUME-DESIGN.md 6, G4): Try now; Pause ends the wait.
    else if (f.isWaiting(v)) entries.push({ label: 'Try now', access: 't', key: 'Space', icon: 'reload', run: run('start-now') }, { label: 'Pause', access: 'p', icon: 'pause', run: run('pause') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else if (v.state === 'paused') entries.push({ label: 'Resume', access: 's', key: 'Space', icon: 'play', run: run('resume') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else {
      // Safe Browsing blocked it as uncommon or unwanted: the person may keep it anyway.
      if (v.keepable) entries.push({ label: 'Keep file', access: 'k', icon: 'download', run: run('keep') });
      entries.push({ label: 'Retry', access: 't', icon: 'reload', run: run('resume') });
    }
    entries.push('separator', { label: 'Copy address', access: 'a', icon: 'copy', run: run('copy-address') }, 'separator');
    if (!['completed', 'failed', 'cancelled'].includes(v.state)) entries.push({ label: 'Cancel', access: 'c', icon: 'close', danger: true, run: run('cancel') });
    entries.push({ label: 'Remove from list', access: 'r', key: 'Delete', run: () => this.removeRow(id) });
    openMenu(this.b, `${v.filename} actions`, entries, place, { keyboard, owner: from, returnFocus: from });
  }

  private limitMenu(from: HTMLElement, keyboard: boolean, current: number, set: (kbps: number) => void): void {
    const entries: MenuEntry[] = LIMITS.map((kbps) => ({ label: limitLabel(kbps), checked: kbps === current, run: () => set(kbps) }));
    // Right edges aligned: the buttons sit at the right end of the toolbar and the details.
    openMenu(this.b, 'Speed limit', entries, { at: from, align: from.classList.contains('vd-limit') ? 'end' : 'start' }, { keyboard, owner: from, returnFocus: from });
  }

  // ---- add link ----

  private openAdd(): void {
    const els = this.els;
    if (!els) return;
    els.add.hidden = false;
    f.setText(els.addNote, '');
    if (!els.addInput.value) {
      const url = this.store.engine.clipboardUrl();
      if (url) els.addInput.value = url;
    }
    els.addInput.focus();
    els.addInput.select();
  }

  private closeAdd(): void {
    const els = this.els;
    if (!els) return;
    els.add.hidden = true;
    els.addInput.value = '';
    els.addBtn.focus();
  }

  private submitAdd(): void {
    const els = this.els;
    if (!els) return;
    let url = els.addInput.value.trim();
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\/\S+$/i.test(url)) {
      f.setText(els.addNote, 'Enter a web address that starts with http or https.');
      return;
    }
    const go = els.add.querySelector('.vd-add-go') as HTMLElement;
    const r = go.getBoundingClientRect();
    const id = this.store.start(url, { origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
    if (!id) {
      f.setText(els.addNote, 'Deer can’t download that address.');
      return;
    }
    this.selected = id;
    // A waiting row's id (it still reads paused): its proof decides which row is this start.
    this.addedAs = this.store.engine.get(id)?.state === 'paused' ? id : '';
    this.closeAdd();
  }
}

function statusOf(v: DownloadView): [string, string, string] {
  if (v.state === 'completed' && !v.missing && v.phase === 'repairing') return ['Repairing', '', ''];
  if (v.state === 'completed' && !v.missing && v.phase === 'checking') return ['Checking', '', ''];
  // RESUME-DESIGN.md 6 (Phase 5): Damaged in the error colour; Changed after download in the normal one.
  if (f.isDamaged(v)) return ['Damaged', 'err', ''];
  if (f.isEdited(v)) return ['Changed after download', '', ''];
  if (v.state === 'completed') return v.missing ? ['Deleted', 'dim', ''] : ['Completed', '', ic.done];
  if (v.state === 'failed') return ['Failed', 'err', ''];
  if (v.state === 'cancelled') return ['Cancelled', 'dim', ''];
  if (v.state === 'queued') return ['Queued', '', ''];
  if (v.phase === 'renewing') return ['Renewing link', '', ic.link];
  if (v.need?.kind === 'address') return [v.armed ? 'Waiting for link' : 'Link expired', '', ic.link];
  if (v.need?.kind === 'choice') return ['File changed', '', ''];
  // No glyph: the design's words fill the column.
  if (v.need?.kind === 'page') return ['Start it again from its page', '', ''];
  // RESUME-DESIGN.md 6 (G4): Waiting for network; Retrying · in 40 s.
  if (f.isWaiting(v)) return [v.wait?.for === 'server' ? retrying(v) : 'Waiting for network', '', ''];
  if (v.state === 'paused') return ['Paused', '', ''];
  if (v.phase === 'checking') return ['Checking', '', ''];
  if (v.state === 'starting' || (v.phase === 'probing' && v.received <= 0)) return ['Starting', '', ''];
  if (v.phase === 'merging') return ['Saving', '', ''];
  return [f.bytes(v.received) || 'Starting', '', ''];
}

function primaryOf(v: DownloadView): [string, string, string] {
  // A Damaged file: Repair (Download again once the site's file changed); Changed after download: Restore
  // original, which only moves focus there (RESUME-DESIGN.md 6). While it is repaired or checked: Show in folder.
  if (f.isDamaged(v) && !v.phase) return v.check?.site === 'changed' ? ['again', 'Download again', ic.retry] : ['repair', 'Repair', ic.retry];
  if (f.isEdited(v) && !v.phase) return ['restore', 'Restore original', ic.chevron];
  // Renewing link: Pause cancels the attempt and keeps the bytes (RESUME-DESIGN.md 6).
  if (v.state === 'downloading' || v.state === 'starting' || v.phase === 'renewing') return ['pause', 'Pause', ic.pause(14)];
  if (v.state === 'queued') return ['now', 'Start now', ic.play(14)];
  // RESUME-DESIGN.md 6: Waiting for link and Start it again from its page open the page; Link expired
  // refreshes the address (a stream retries: its renewal comes with Phase 6).
  if (v.need?.kind === 'page' || (v.need?.kind === 'address' && v.armed)) return ['open-page', 'Open page', ic.open];
  if (v.need?.kind === 'address') return v.canRenew ? ['refresh', 'Refresh address', ic.retry] : ['retry', 'Retry', ic.retry];
  if (v.need?.kind === 'choice') return ['choose', 'Choose', ic.chevron];
  // Waiting for network and Retrying (RESUME-DESIGN.md 6, G4): Try now.
  if (f.isWaiting(v)) return ['try', 'Try now', ic.retry];
  if (v.state === 'paused') return ['resume', 'Resume', ic.play(14)];
  if (v.state === 'completed' && !v.missing) return ['folder', 'Show in folder', ic.folder()];
  return ['retry', v.state === 'completed' ? 'Download again' : 'Retry', ic.retry];
}

function rowState(v: DownloadView): string {
  if (f.isDamaged(v) && !v.phase) return `Damaged, ${v.check?.bad ? f.damagedParts(v.check.bad) : 'it no longer matches its checksum'}`;
  if (v.state === 'downloading' && !v.phase) return `${f.percent(v)} percent${v.speed ? `, ${f.speed(v.speed)}` : ''}${v.eta >= 0 ? `, ${f.eta(v.eta)} left` : ''}`;
  // "song.mp3, Link expired, 62 percent saved" (RESUME-DESIGN.md 6); a row Firefox moved saved nothing.
  if (v.need && v.need.kind !== 'page') return `${statusOf(v)[0]}, ${f.percent(v)} percent saved`;
  // Without Retrying's countdown, which would change the label every second.
  if (f.isWaiting(v)) return `${v.wait?.for === 'server' ? 'Retrying' : 'Waiting for network'}, ${f.percent(v)} percent saved`;
  return statusOf(v)[0];
}

/** "Retrying · in 40 s" (RESUME-DESIGN.md 6): the next try of a server wait, counted down; "Retrying" once it is due. */
function retrying(v: DownloadView): string {
  const left = Math.ceil((v.nextAt - Date.now()) / 1000);
  return left > 0 ? `Retrying · in ${f.eta(left)}` : 'Retrying';
}

/** "1 needs attention", "2 need attention" (the toolbar summary; the ring says it too). */
export function needAttention(n: number): string {
  return `${n} ${n === 1 ? 'needs' : 'need'} attention`;
}

/**
 * A Damaged row's caption (RESUME-DESIGN.md 6): how much is damaged and what Repair does, or what the last
 * Repair found at the site.
 */
function damagedCaption(v: DownloadView): string {
  const c = v.check;
  if (c?.site === 'changed') return 'The file on the site is different now, so this copy can’t be repaired. Download again gets the new one.';
  if (c?.site === 'expired') return `The link stopped working${c.status ? ` (${c.status})` : ''}. Repair needs a working link.`;
  if (c?.site === 'unreachable') return `Deer couldn’t reach the site to repair this file${c.status ? ` (${c.status})` : ''}.`;
  if (c?.unlocated || !c?.bad) return 'This file no longer matches the checksum it was saved with. Repair compares it with the site.';
  return `${f.damagedParts(c.bad)} (${f.bytes(c.badBytes)}). Repair fetches only ${c.bad === 1 ? 'that part' : 'those parts'} again.`;
}

/** "Use another address…" is for a one-file download Deer moves itself (streams renew with Phase 6). */
function canUseAddress(v: DownloadView): boolean {
  return v.engine === 'vitre' && !v.stream;
}

/** "next try 14:05"; another day's time with its date. */
function nextTry(ms: number): string {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return ms >= start && ms < start + 86_400_000 ? f.clock(ms) : f.when(ms);
}

/** The row's latest history line with when it happened: "New link found today, 13:02". */
function historyLine(v: DownloadView): string {
  const last = v.history[v.history.length - 1];
  if (!last) return '';
  const when = f.when(last.at);
  return `${last.text} ${/^(Today|Yesterday)/.test(when) ? when[0].toLowerCase() + when.slice(1) : `on ${when}`}`;
}

function detailActions(v: DownloadView): [string, string, string][] {
  const active = v.state === 'downloading' || v.state === 'starting';
  // A finished file (RESUME-DESIGN.md 6, Phase 5). Repairing: what can't disturb it. Damaged: Repair · Open
  // anyway · Show in folder · Remove from list (Download again first once the site's file changed). Changed
  // after download: Restore original (only when chosen) · Open · Show in folder · Remove from list. Every
  // other finished file gains Check file.
  if (v.state === 'completed' && !v.missing && v.phase === 'repairing') return [['folder', 'Show in folder', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (f.isDamaged(v)) return [v.check?.site === 'changed' ? ['again', 'Download again', ''] : ['repair', 'Repair', ''], ['open-anyway', 'Open anyway', ''], ['folder', 'Show in folder', ''], ['remove', 'Remove from list', '']];
  if (f.isEdited(v)) return [['restore', 'Restore original', ''], ['open', 'Open', ''], ['folder', 'Show in folder', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'completed' && !v.missing) return [['open', 'Open', ''], ['folder', 'Show in folder', ''], ['check', 'Check file', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'completed') return [['retry', 'Download again', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'failed' && v.keepable) return [['keep', 'Keep file', ''], ['retry', 'Retry', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'failed' || v.state === 'cancelled') return [['retry', 'Retry', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  // RESUME-DESIGN.md 6 (Phase 3). Link expired: Refresh address · Use another address… · Open page · Show
  // in folder · Cancel (a stream retries instead: its renewal comes with Phase 6; Copy address stays in
  // the row's menu). While an attempt runs (Renewing link) Pause comes first: it stops that attempt and
  // the ones planned. Waiting for link: Open page · Stop waiting · Use another address… · Cancel. File
  // changed: Start over with the new file · Keep partial file · Show in folder. Start it again from its
  // page: Open page.
  if (v.need?.kind === 'address' && v.armed && v.phase !== 'renewing') {
    const acts: [string, string, string][] = [['open-page', 'Open page', ''], ['stop-waiting', 'Stop waiting', '']];
    if (canUseAddress(v)) acts.push(['use-address', 'Use another address…', '']);
    acts.push(['cancel', 'Cancel', 'danger']);
    return acts;
  }
  if (v.need?.kind === 'address') {
    const acts: [string, string, string][] = [v.phase === 'renewing' ? ['pause', 'Pause', ''] : v.canRenew ? ['refresh', 'Refresh address', ''] : ['retry', 'Retry', '']];
    if (canUseAddress(v)) acts.push(['use-address', 'Use another address…', '']);
    if (v.pageUrl) acts.push(['open-page', 'Open page', '']);
    acts.push(['folder', 'Show in folder', ''], ['cancel', 'Cancel', 'danger']);
    return acts;
  }
  if (v.need?.kind === 'choice') return [['start-over', 'Start over with the new file', 'danger'], ...(v.keep ? [['keep-partial', 'Keep partial file', ''] as [string, string, string]] : []), ['folder', 'Show in folder', '']];
  if (v.need?.kind === 'page') return [['open-page', 'Open page', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  // Waiting for network and Retrying (RESUME-DESIGN.md 6, G4): Try now · Pause (the wait ends) · Show in folder · Cancel.
  if (f.isWaiting(v)) return [['try', 'Try now', ''], ['pause', 'Pause', ''], ['folder', 'Show in folder', ''], ['cancel', 'Cancel', 'danger']];
  const first: [string, string, string] = active ? ['pause', 'Pause', ''] : v.state === 'queued' ? ['now', 'Start now', ''] : ['resume', 'Resume', ''];
  const acts: [string, string, string][] = [first];
  if (v.engine === 'vitre') acts.push(['limit', 'Limit speed', '']);
  acts.push(['folder', 'Show in folder', ''], ['cancel', 'Cancel', 'danger']);
  return acts;
}
