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
import type { Category, DownloadView } from '../../../modules/downloads/types';
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

  constructor(
    private b: Browser,
    private store: DownloadStore
  ) {
    store.subscribe(() => {
      if (this.isOpen) this.render();
    });
    const resize = (): void => {
      if (this.isOpen) this.layout();
    };
    window.addEventListener('resize', resize);
    b.onDestroy(() => window.removeEventListener('resize', resize));
    b.on('settings', () => {
      if (this.isOpen) this.render();
    });
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
    if (hadFocus && !els.panel.contains(document.activeElement)) {
      const row = this.rows.get(this.selected);
      if (row) row.row.focus();
      else els.search.focus();
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
    const done = views.filter((v) => v.state === 'completed').length;
    const rate = running.reduce((n, v) => n + v.speed, 0);
    const parts: string[] = [];
    if (running.length) parts.push(`${running.length} downloading${rate > 0 ? ` at ${f.speed(rate)}` : ''}`);
    if (queued) parts.push(`${queued} queued`);
    if (paused) parts.push(`${paused} paused`);
    if (!parts.length) parts.push(done ? `${done} completed` : 'No downloads');
    f.setText(els.summary, parts.join(' · '));
    const anyActive = running.length > 0 || queued > 0;
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
      if (v) this.store.primary(v);
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
    f.setText(r.sub, failed ? v.error : [size, f.CATEGORY_LABEL[v.category]].filter(Boolean).join(' · '));

    const pct = f.percent(v);
    const transferring = v.state === 'downloading' && !v.phase;
    const showBar = (transferring && v.total > 0) || (v.state === 'paused' && v.total > 0);
    r.prog.hidden = !showBar;
    r.status.hidden = showBar;
    if (showBar) {
      r.bar.classList.toggle('dim', v.state === 'paused');
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
    const [s, sCls] = transferring ? [f.speed(v.speed) || '—', v.speed > 0 ? '' : 'dim'] : v.state === 'paused' && showBar ? ['Paused', 'soft'] : ['—', 'dim'];
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
        cap: el('span', { class: 'vd-d-cap' }),
        segs: el('div', { class: 'vd-segs' }),
        note: el('span', { class: 'vd-d-note' }),
        avg: el('span', { class: 'v' }),
        peak: el('span', { class: 'v' }),
        got: el('span', { class: 'v' }),
        addr: el('span', { class: 'v' }),
        dir: el('span', { class: 'v' }),
        page: el('span', { class: 'v' }),
        started: el('span', { class: 'v' }),
        acts: el('div', { class: 'vd-d-acts' }),
      };
      const stat = (k: string, v2: HTMLElement): HTMLElement => el('div', {}, el('span', { class: 'k' }, k), v2);
      box.replaceChildren(
        el('div', { class: 'vd-d-left' }, el('span', { class: 'vd-d-title' }, 'Connections'), e.cap, e.segs, e.note, el('div', { class: 'vd-stats' }, stat('Average', e.avg), stat('Peak', e.peak), stat('Received', e.got))),
        el(
          'div',
          { class: 'vd-d-right' },
          el('div', { class: 'vd-facts' }, el('span', { class: 'k' }, 'Address'), e.addr, el('span', { class: 'k' }, 'Saved to'), e.dir, el('span', { class: 'k' }, 'From page'), e.page, el('span', { class: 'k' }, 'Started'), e.started),
          e.acts
        )
      );
      e.acts.addEventListener('click', (ev) => {
        const btn = (ev.target as Element).closest<HTMLElement>('[data-act]');
        const cur = this.store.get(this.details?.id ?? '');
        if (btn && cur) this.detailAction(btn.dataset.act ?? '', cur, btn);
      });
      this.details = { id: v.id, acts: '', els: e };
    }
    const e = this.details.els;
    const running = v.state === 'downloading' && !v.phase;
    // Connections caption: how many are open, and whether the download can carry on later.
    let cap = '';
    if (v.state === 'completed') cap = v.missing ? 'The file was moved or deleted' : v.note || 'Finished';
    else if (v.state === 'failed') cap = v.error || 'Failed';
    else if (v.state === 'cancelled') cap = 'Cancelled';
    else if (v.state === 'queued') cap = v.queuePos === 1 ? 'Queued · Next' : 'Queued';
    else if (v.state === 'starting' || v.phase === 'probing') cap = 'Starting';
    else if (v.phase === 'merging') cap = v.stream ? 'Joining video and sound' : 'Saving';
    else if (v.engine === 'browser') cap = `${v.state === 'downloading' ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else if (v.maxConnections <= 1) cap = `${running ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else cap = `${running ? `${Math.min(v.connections, v.maxConnections)} of ${v.maxConnections} active` : `${v.maxConnections} connections`} · ${v.stream ? 'Stream' : 'Resumable'}`;
    e.cap.classList.toggle('err', v.state === 'failed');
    f.setText(e.cap, cap);
    const fills = v.state === 'completed' && !v.missing ? new Array<number>(v.maxConnections > 1 ? 8 : 1).fill(1) : v.segments;
    e.segs.hidden = !fills.length;
    e.note.hidden = !fills.length || v.maxConnections <= 1;
    f.setText(e.note, v.stream ? 'Each block is a stretch of the video' : 'Each block is one part of the file, fetched in parallel');
    if (e.segs.childElementCount !== fills.length) e.segs.replaceChildren(...fills.map(() => el('span', {}, el('i', {}))));
    e.segs.classList.toggle('dim', v.state === 'paused' || v.state === 'failed');
    fills.forEach((x, i) => ((e.segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(x * 100)}%`));
    f.setText(e.avg, f.speed(v.average) || '—');
    f.setText(e.peak, f.speed(v.peak) || '—');
    f.setText(e.got, v.received > 0 ? f.bytes(v.received) : '—');
    f.setText(e.addr, f.bare(v.url));
    f.setText(e.dir, f.folderLabel(v.dir, this.b.settings.downloadsFolder));
    f.setText(e.page, v.pageUrl ? f.bare(v.pageUrl) : '—');
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
          el('button', { type: 'button', class: `vd-d-btn ${cls}`, 'data-act': act, 'aria-haspopup': act === 'limit' ? 'menu' : null }, act === 'limit' && v.limitKBps ? `Limited to ${limitLabel(v.limitKBps)}` : label)
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
    const map: Record<string, Command> = { pause: 'pause', resume: 'resume', now: 'start-now', retry: 'resume', open: 'open', folder: 'show-in-folder', copy: 'copy-address', cancel: 'cancel', keep: 'keep' };
    const cmd = map[act];
    if (cmd) this.store.run(cmd, v.id);
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
      if (v.state !== 'completed') this.store.primary(v);
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
    if (v.state === 'completed' && !v.missing) entries.push({ label: 'Open', access: 'o', key: 'Enter', icon: 'open', run: run('open') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else if (v.state === 'completed') entries.push({ label: 'Download again', access: 'd', icon: 'reload', run: run('resume') });
    else if (active) entries.push({ label: 'Pause', access: 'p', key: 'Space', icon: 'pause', run: run('pause') }, { label: 'Show in folder', access: 'f', icon: 'folder', run: run('show-in-folder') });
    else if (v.state === 'queued') entries.push({ label: 'Start now', access: 's', icon: 'play', run: run('start-now') }, { label: 'Pause', access: 'p', key: 'Space', icon: 'pause', run: run('pause') });
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
    this.closeAdd();
  }
}

function statusOf(v: DownloadView): [string, string, string] {
  if (v.state === 'completed') return v.missing ? ['Deleted', 'dim', ''] : ['Completed', '', ic.done];
  if (v.state === 'failed') return ['Failed', 'err', ''];
  if (v.state === 'cancelled') return ['Cancelled', 'dim', ''];
  if (v.state === 'queued') return ['Queued', '', ''];
  if (v.state === 'paused') return ['Paused', '', ''];
  if (v.state === 'starting' || v.phase === 'probing') return ['Starting', '', ''];
  if (v.phase === 'merging') return ['Saving', '', ''];
  return [f.bytes(v.received) || 'Starting', '', ''];
}

function primaryOf(v: DownloadView): [string, string, string] {
  if (v.state === 'downloading' || v.state === 'starting') return ['pause', 'Pause', ic.pause(14)];
  if (v.state === 'queued') return ['now', 'Start now', ic.play(14)];
  if (v.state === 'paused') return ['resume', 'Resume', ic.play(14)];
  if (v.state === 'completed' && !v.missing) return ['folder', 'Show in folder', ic.folder()];
  return ['retry', v.state === 'completed' ? 'Download again' : 'Retry', ic.retry];
}

function rowState(v: DownloadView): string {
  if (v.state === 'downloading' && !v.phase) return `${f.percent(v)} percent${v.speed ? `, ${f.speed(v.speed)}` : ''}${v.eta >= 0 ? `, ${f.eta(v.eta)} left` : ''}`;
  return statusOf(v)[0];
}

function detailActions(v: DownloadView): [string, string, string][] {
  const active = v.state === 'downloading' || v.state === 'starting';
  if (v.state === 'completed' && !v.missing) return [['open', 'Open', ''], ['folder', 'Show in folder', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'completed') return [['retry', 'Download again', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'failed' && v.keepable) return [['keep', 'Keep file', ''], ['retry', 'Retry', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  if (v.state === 'failed' || v.state === 'cancelled') return [['retry', 'Retry', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  const first: [string, string, string] = active ? ['pause', 'Pause', ''] : v.state === 'queued' ? ['now', 'Start now', ''] : ['resume', 'Resume', ''];
  const acts: [string, string, string][] = [first];
  if (v.engine === 'vitre') acts.push(['limit', 'Limit speed', '']);
  acts.push(['folder', 'Show in folder', ''], ['cancel', 'Cancel', 'danger']);
  return acts;
}
