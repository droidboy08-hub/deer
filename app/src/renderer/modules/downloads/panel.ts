// The Downloads panel (Ctrl+J): a 960×688 frosted panel over the dimmed page, like Settings.
// Filters and categories on the left; the list with the connection bar, speed and time; the
// selected download's details at the bottom.
import type { Category, DownloadView } from '../../../main/modules/downloads/types';
import type { Browser } from '../../app';
import { glassLayers, lens } from '../../glass';
import * as f from './format';
import { CATEGORY_ICON, ic } from './icons';
import { closeMenu, openMenu, type MenuEntry } from './menu';
import type { DownloadStore } from './store';

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
export const limitLabel = (kbps: number) => (kbps ? f.speed(kbps * 1024) : 'No speed limit');

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Els {
  scrim: HTMLElement;
  panel: HTMLElement;
  lens: HTMLElement;
  nav: HTMLElement;
  search: HTMLInputElement;
  summary: HTMLElement;
  pauseAll: HTMLButtonElement;
  limit: HTMLButtonElement;
  add: HTMLFormElement;
  addInput: HTMLInputElement;
  addNote: HTMLElement;
  list: HTMLElement;
  details: HTMLElement;
}

export class Panel {
  private els: Els | null = null;
  private isOpen = false;
  private filter: Filter = 'all';
  private query = '';
  private selected = '';
  private rows = new Map<string, HTMLElement>();
  private undo: (() => void)[] = [];
  private returnFocus: HTMLElement | null = null;
  private size = { w: 0, h: 0 };
  private lensTimer: number | null = null;

  constructor(private b: Browser, private store: DownloadStore) {
    store.subscribe(() => {
      if (this.isOpen) this.render();
    });
    window.addEventListener('resize', () => {
      if (this.isOpen) this.layout();
    });
    b.on('settings', () => {
      if (this.isOpen) this.render();
    });
    // Switching tabs underneath (Ctrl+Tab, Ctrl+1) focuses the page; the panel keeps the keys.
    b.on('tab-activated', () => {
      if (this.isOpen) this.focusSelected();
    });
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(focusId?: string): void {
    if (focusId) {
      this.selected = focusId;
      this.filter = 'all';
      this.query = '';
    }
    if (this.isOpen) {
      this.render();
      this.focusSelected();
      return;
    }
    this.isOpen = true;
    closeMenu();
    // Files moved or deleted since the list was read show as such.
    void this.store.reload();
    const active = document.activeElement as HTMLElement | null;
    // The address field steps aside for the panel; closing returns to the page, not to it.
    const omni = this.b.omni.open;
    if (omni) this.b.omni.close();
    this.returnFocus = !omni && active && active !== document.body && active.tagName !== 'WEBVIEW' ? active : null;
    const els = this.build();
    this.layout();
    this.render();
    void els.panel.offsetWidth;
    els.scrim.classList.add('in');
    els.panel.classList.add('in');
    document.body.classList.add('panel-open', 'downloads-open');
    this.undo.push(
      this.b.addEscLayer(60, () => {
        this.hide();
        return true;
      }),
      this.b.addCloseLayer(60, () => {
        this.hide();
        return true;
      }),
    );
    const keys = (e: KeyboardEvent) => {
      // Ctrl+F belongs to the panel's own search while it is open.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        requestAnimationFrame(() => els.search.focus());
      }
    };
    window.addEventListener('keydown', keys, true);
    this.undo.push(() => window.removeEventListener('keydown', keys, true));
    this.focusSelected();
  }

  hide(): void {
    if (!this.isOpen || !this.els) return;
    this.isOpen = false;
    for (const u of this.undo) u();
    this.undo = [];
    closeMenu();
    document.body.classList.remove('panel-open', 'downloads-open');
    const { scrim, panel } = this.els;
    this.els = null;
    this.rows.clear();
    panel.classList.remove('in');
    scrim.classList.remove('in');
    panel.style.pointerEvents = 'none';
    scrim.style.pointerEvents = 'none';
    setTimeout(() => {
      panel.remove();
      scrim.remove();
    }, reduced() ? 160 : 300);
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    else this.b.focusPage();
  }

  // ---- building ----

  private build(): Els {
    const layer = this.b.layer('downloads-panel', 30);
    const scrim = document.createElement('div');
    scrim.className = 'vd-scrim';
    scrim.addEventListener('pointerdown', () => this.hide());
    const panel = document.createElement('section');
    panel.className = 'vd-panel vd-glass';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Downloads');
    panel.innerHTML = `${glassLayers()}
      <div class="vd-body">
        <header class="vd-head">${ic.download(16)}<h2>Downloads</h2>
          <button type="button" class="vd-close" aria-label="Close downloads" title="Close  Esc">${ic.close}</button></header>
        <div class="vd-main">
          <nav class="vd-nav" aria-label="Download filters">
            <label class="vd-search">${ic.search}<input type="search" placeholder="Search downloads" aria-label="Search downloads" spellcheck="false" autocomplete="off"></label>
            <div class="vd-filters"></div>
          </nav>
          <div class="vd-divider"></div>
          <div class="vd-content">
            <div class="vd-toolbar">
              <span class="vd-summary"></span>
              <button type="button" class="vd-btn accent vd-add-btn">${ic.plus}Add link</button>
              <button type="button" class="vd-btn vd-pause-all">Pause all</button>
              <button type="button" class="vd-btn vd-limit" aria-haspopup="menu"><span></span>${ic.chevron}</button>
            </div>
            <form class="vd-add" hidden novalidate>
              <label class="vd-field">${ic.link}<input type="text" inputmode="url" placeholder="Paste a link to download" aria-label="Link to download" spellcheck="false" autocomplete="off"></label>
              <button type="submit" class="vd-btn accent">Download</button>
              <button type="button" class="vd-btn vd-add-cancel">Cancel</button>
              <span class="vd-add-note" role="alert"></span>
            </form>
            <div class="vd-cols" aria-hidden="true"><span></span><span>Name</span><span>Progress</span><span>Speed</span><span>Time</span><span></span></div>
            <div class="vd-list" role="grid" aria-label="Downloads" aria-multiselectable="false"></div>
            <section class="vd-details" aria-label="Details" hidden></section>
          </div>
        </div>
      </div>`;
    layer.append(scrim, panel);
    const q = <T extends Element>(sel: string) => panel.querySelector(sel) as T;
    const els: Els = {
      scrim,
      panel,
      lens: q('.lens'),
      nav: q('.vd-filters'),
      search: q('.vd-search input'),
      summary: q('.vd-summary'),
      pauseAll: q('.vd-pause-all'),
      limit: q('.vd-limit'),
      add: q('.vd-add'),
      addInput: q('.vd-add input'),
      addNote: q('.vd-add-note'),
      list: q('.vd-list'),
      details: q('.vd-details'),
    };
    this.els = els;
    this.size = { w: 0, h: 0 };

    q<HTMLButtonElement>('.vd-close').addEventListener('click', () => this.hide());
    els.search.value = this.query;
    els.search.addEventListener('input', () => {
      this.query = els.search.value.trim().toLowerCase();
      this.render();
    });
    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.b.escape();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusSelected();
      }
    });
    els.nav.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
      if (!btn) return;
      this.filter = btn.dataset.filter as Filter;
      this.render();
    });
    q<HTMLButtonElement>('.vd-add-btn').addEventListener('click', () => void this.openAdd());
    q<HTMLButtonElement>('.vd-add-cancel').addEventListener('click', () => this.closeAdd());
    els.add.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitAdd();
    });
    els.addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeAdd();
      }
    });
    els.pauseAll.addEventListener('click', () => {
      const anyActive = this.store.all().some(f.isActive);
      void window.vitre.ipc.invoke(anyActive ? 'dl:pause-all' : 'dl:resume-all');
    });
    els.limit.addEventListener('click', (e) => this.limitMenu(els.limit, (e as MouseEvent).detail === 0, this.b.settings.speedLimitKBps, (kbps) => window.vitre.settings.set({ speedLimitKBps: kbps })));
    els.list.addEventListener('keydown', (e) => this.listKeys(e));
    // Tab stays inside the panel while it is open.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]):not([disabled]), input, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
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

  private layout(): void {
    if (!this.els) return;
    const w = Math.min(960, window.innerWidth - 32);
    const h = Math.min(688, window.innerHeight - 32);
    const { panel, lens: lensEl } = this.els;
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.style.left = `${Math.round((window.innerWidth - w) / 2)}px`;
    panel.style.top = `${Math.round((window.innerHeight - h) / 2)}px`;
    panel.classList.toggle('narrow', w < 760);
    if (w !== this.size.w || h !== this.size.h) {
      const first = !this.size.w;
      this.size = { w, h };
      // A lens map is built per size: while the window is being resized the panel is plain frost,
      // and the lens comes back once the size settles.
      if (this.lensTimer !== null) clearTimeout(this.lensTimer);
      this.lensTimer = null;
      if (first) lensEl.style.backdropFilter = lens(w, h, { radius: 22, scale: 24, blur: 22 });
      else {
        lensEl.style.backdropFilter = 'blur(22px) saturate(1.5)';
        this.lensTimer = window.setTimeout(() => {
          this.lensTimer = null;
          if (this.els?.lens === lensEl) lensEl.style.backdropFilter = lens(this.size.w, this.size.h, { radius: 22, scale: 24, blur: 22 });
        }, 300);
      }
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
        row.remove();
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
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] ?? null);
    });
    let empty = list.querySelector<HTMLElement>('.vd-empty');
    if (!shown.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'vd-empty';
        list.append(empty);
      }
      empty.textContent = views.length ? 'Nothing here.' : 'Downloads you start appear here.';
    } else empty?.remove();
    this.renderDetails(shown.find((v) => v.id === this.selected) ?? null);
    if (hadFocus && !els.panel.contains(document.activeElement)) {
      const row = this.rows.get(this.selected);
      if (row) row.focus();
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
    // Rebuilt only when the list of filters changes; counts and the current one update in place,
    // so a focused filter keeps focus while downloads move between states.
    const shape = items.map((i) => i.id).join('|');
    if (nav.dataset.shape !== shape) {
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-filter]')?.dataset.filter;
      nav.dataset.shape = shape;
      nav.innerHTML = items
        .map((i) => `${i.head ? `<div class="vd-nav-head">${i.head}</div>` : ''}<button type="button" class="vd-filter" data-filter="${i.id}">${i.icon}<span class="label">${i.label}</span><span class="count"></span></button>`)
        .join('');
      if (focused) nav.querySelector<HTMLElement>(`[data-filter="${focused}"]`)?.focus();
    }
    for (const i of items) {
      const btn = nav.querySelector<HTMLElement>(`[data-filter="${i.id}"]`);
      if (!btn) continue;
      setText(btn.querySelector('.count') as HTMLElement, String(i.count));
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
    setText(els.summary, parts.join(' · '));
    const anyActive = running.length > 0 || queued > 0;
    setText(els.pauseAll, anyActive || !paused ? 'Pause all' : 'Resume all');
    els.pauseAll.disabled = !anyActive && !paused;
    setText(els.limit.firstElementChild as HTMLElement, limitLabel(this.b.settings.speedLimitKBps));
  }

  private createRow(id: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vd-row';
    row.setAttribute('role', 'row');
    row.tabIndex = -1;
    row.dataset.id = id;
    row.innerHTML = `<span class="vd-tile" role="gridcell"></span>
      <div class="vd-name" role="gridcell"><span class="n"></span><span class="s"></span></div>
      <div class="vd-progcell" role="gridcell"><div class="vd-prog"><div class="vd-bar"><i></i></div><span class="vd-pct"></span></div><span class="vd-status"></span></div>
      <span class="vd-cell speed" role="gridcell"></span>
      <span class="vd-cell time" role="gridcell"></span>
      <div class="vd-acts" role="gridcell"><button type="button" class="vd-icon-btn primary" tabindex="-1"></button><button type="button" class="vd-icon-btn more" tabindex="-1" aria-label="More actions" aria-haspopup="menu">${ic.more}</button></div>`;
    row.addEventListener('pointerdown', () => this.select(id, false));
    row.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const v = this.store.get(id);
      if (v?.state === 'completed' && !v.missing) this.store.run('open', id);
    });
    row.querySelector('.primary')?.addEventListener('click', () => {
      const v = this.store.get(id);
      if (v) this.store.primary(v);
    });
    const more = row.querySelector('.more') as HTMLElement;
    more.addEventListener('click', (e) => {
      const r = more.getBoundingClientRect();
      this.rowMenu(id, { right: r.right, top: r.bottom + 4 }, (e as MouseEvent).detail === 0, more);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.select(id, false);
      this.rowMenu(id, { left: e.clientX, top: e.clientY }, false, row);
    });
    return row;
  }

  private updateRow(row: HTMLElement, v: DownloadView): void {
    const sel = v.id === this.selected;
    row.setAttribute('aria-selected', String(sel));
    row.tabIndex = sel ? 0 : -1;
    setText(row.querySelector('.vd-tile') as HTMLElement, f.tile(v.filename));
    setText(row.querySelector('.n') as HTMLElement, v.filename);
    (row.querySelector('.n') as HTMLElement).title = v.filename;
    const sub = row.querySelector('.s') as HTMLElement;
    const failed = v.state === 'failed' && !!v.error;
    sub.classList.toggle('err', failed);
    const size = v.total > 0 ? f.bytes(v.total) : v.received > 0 ? f.bytes(v.received) : '';
    setText(sub, failed ? v.error : [size, f.CATEGORY_LABEL[v.category]].filter(Boolean).join(' · '));

    const prog = row.querySelector('.vd-prog') as HTMLElement;
    const status = row.querySelector('.vd-status') as HTMLElement;
    const pct = f.percent(v);
    const transferring = v.state === 'downloading' && !v.phase;
    const showBar = (transferring && v.total > 0) || (v.state === 'paused' && v.total > 0);
    prog.hidden = !showBar;
    status.hidden = showBar;
    if (showBar) {
      const bar = prog.firstElementChild as HTMLElement;
      bar.classList.toggle('dim', v.state === 'paused');
      (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
      setText(prog.lastElementChild as HTMLElement, `${pct}%`);
    } else {
      const [text, cls, icon] = statusOf(v);
      if (status.dataset.k !== text + cls) {
        status.dataset.k = text + cls;
        status.className = `vd-status ${cls}`;
        status.innerHTML = `${icon}${f.esc(text)}`;
      }
    }
    const speed = row.querySelector('.speed') as HTMLElement;
    const time = row.querySelector('.time') as HTMLElement;
    const [s, sCls] = transferring ? [f.speed(v.speed) || '—', v.speed > 0 ? '' : 'dim'] : v.state === 'paused' && showBar ? ['Paused', 'soft'] : ['—', 'dim'];
    speed.className = `vd-cell speed ${sCls}`;
    setText(speed, s);
    const [t, tCls] = transferring && v.eta >= 0 ? [f.eta(v.eta), ''] : v.state === 'queued' && v.queuePos === 1 ? ['Next', 'soft'] : v.state === 'completed' ? [f.finished(v.finishedAt), 'soft'] : ['—', 'dim'];
    time.className = `vd-cell time ${tCls}`;
    setText(time, t);

    const btn = row.querySelector('.primary') as HTMLElement;
    const [kind, label, icon] = primaryOf(v);
    if (btn.dataset.k !== kind) {
      btn.dataset.k = kind;
      btn.innerHTML = icon;
    }
    btn.setAttribute('aria-label', `${label} ${v.filename}`);
    btn.title = label;
    row.setAttribute('aria-label', `${v.filename}, ${rowState(v)}`);
  }

  private renderDetails(v: DownloadView | null): void {
    const box = this.els?.details;
    if (!box) return;
    box.hidden = !v;
    if (!v) return;
    box.setAttribute('aria-label', `Details for ${v.filename}`);
    if (box.dataset.id !== v.id) {
      box.dataset.id = v.id;
      box.dataset.k = '';
      box.innerHTML = `<div class="vd-d-left">
          <span class="vd-d-title">Connections</span>
          <span class="vd-d-cap"></span>
          <div class="vd-segs"></div>
          <span class="vd-d-note"></span>
          <div class="vd-stats"><div><span class="k">Average</span><span class="v avg"></span></div><div><span class="k">Peak</span><span class="v peak"></span></div><div><span class="k">Received</span><span class="v got"></span></div></div>
        </div>
        <div class="vd-d-right">
          <div class="vd-facts">
            <span class="k">Address</span><span class="v addr"></span>
            <span class="k">Saved to</span><span class="v dir"></span>
            <span class="k">From page</span><span class="v page"></span>
            <span class="k">Started</span><span class="v started"></span>
          </div>
          <div class="vd-d-acts"></div>
        </div>`;
      box.querySelector('.vd-d-acts')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
        const cur = this.store.get(box.dataset.id ?? '');
        if (b && cur) this.detailAction(b.dataset.act ?? '', cur, b);
      });
    }
    const q = (s: string) => box.querySelector(s) as HTMLElement;
    const running = v.state === 'downloading' && !v.phase;
    // Connections caption: how many are open, and whether the download can carry on later.
    let cap = '';
    if (v.state === 'completed') cap = v.missing ? 'The file was moved or deleted' : 'Finished';
    else if (v.state === 'failed') cap = v.error || 'Failed';
    else if (v.state === 'cancelled') cap = 'Cancelled';
    else if (v.state === 'queued') cap = v.queuePos === 1 ? 'Queued · Next' : 'Queued';
    else if (v.state === 'starting' || v.phase === 'probing') cap = 'Starting';
    else if (v.engine === 'browser') cap = `${v.state === 'downloading' ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else if (v.maxConnections <= 1) cap = `${running ? '1 of 1 active' : '1 connection'} · ${v.resumable ? 'Resumable' : 'Can’t resume'}`;
    else cap = `${running ? `${Math.min(v.connections, v.maxConnections)} of ${v.maxConnections} active` : `${v.maxConnections} connections`} · ${v.stream ? 'Stream' : 'Resumable'}`;
    const capEl = q('.vd-d-cap');
    capEl.classList.toggle('err', v.state === 'failed');
    setText(capEl, cap);
    const segs = q('.vd-segs');
    const fills = v.state === 'completed' && !v.missing ? new Array(v.maxConnections > 1 ? 8 : 1).fill(1) : v.segments;
    segs.hidden = !fills.length;
    q('.vd-d-note').hidden = !fills.length || v.maxConnections <= 1;
    setText(q('.vd-d-note'), v.stream ? 'Each block is a stretch of the video' : 'Each block is one part of the file, fetched in parallel');
    if (segs.childElementCount !== fills.length) segs.innerHTML = fills.map(() => '<span><i></i></span>').join('');
    segs.classList.toggle('dim', v.state === 'paused' || v.state === 'failed');
    fills.forEach((x, i) => ((segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(x * 100)}%`));
    setText(q('.avg'), f.speed(v.average) || '—');
    setText(q('.peak'), f.speed(v.peak) || '—');
    setText(q('.got'), v.received > 0 ? f.bytes(v.received) : '—');
    setText(q('.addr'), f.bare(v.url));
    q('.addr').title = v.url;
    setText(q('.dir'), folderLabel(v.dir, this.b.settings.downloadsFolder));
    q('.dir').title = v.dir;
    setText(q('.page'), v.pageUrl ? f.bare(v.pageUrl) : '—');
    q('.page').title = v.pageUrl;
    setText(q('.started'), f.when(v.startedAt));
    const acts = detailActions(v);
    const k = acts.map((a) => a.join(':')).join('|') + v.limitKBps;
    if (box.dataset.k !== k) {
      box.dataset.k = k;
      const holder = q('.vd-d-acts');
      // Pause turning into Resume replaces the buttons; keyboard focus stays in the same place.
      const at = [...holder.children].indexOf(document.activeElement as Element);
      holder.innerHTML = acts.map(([act, label, cls]) => `<button type="button" class="vd-d-btn ${cls}" data-act="${act}"${act === 'limit' ? ' aria-haspopup="menu"' : ''}>${f.esc(act === 'limit' && v.limitKBps ? `Limited to ${limitLabel(v.limitKBps)}` : label)}</button>`).join('');
      if (at >= 0) (holder.children[Math.min(at, holder.children.length - 1)] as HTMLElement | undefined)?.focus();
    }
  }

  private detailAction(act: string, v: DownloadView, btn: HTMLElement): void {
    if (act === 'limit') {
      this.limitMenu(btn, false, v.limitKBps, (kbps) => void window.vitre.ipc.invoke('dl:limit', v.id, kbps));
      return;
    }
    if (act === 'remove') {
      this.removeRow(v.id);
      return;
    }
    const map: Record<string, Parameters<DownloadStore['run']>[0]> = { pause: 'pause', resume: 'resume', now: 'start-now', retry: 'resume', open: 'open', folder: 'show-in-folder', copy: 'copy-address', cancel: 'cancel' };
    const cmd = map[act];
    if (cmd) this.store.run(cmd, v.id);
  }

  // ---- selection and keys ----

  private select(id: string, focus: boolean): void {
    this.selected = id;
    for (const [rid, row] of this.rows) {
      row.setAttribute('aria-selected', String(rid === id));
      row.tabIndex = rid === id ? 0 : -1;
    }
    this.renderDetails(this.store.get(id) ?? null);
    if (focus) this.rows.get(id)?.focus();
  }

  private focusSelected(): void {
    requestAnimationFrame(() => {
      const row = this.rows.get(this.selected);
      if (row) {
        row.focus();
        row.scrollIntoView({ block: 'nearest' });
      } else this.els?.search.focus();
    });
  }

  /** Row ids in the order they are shown. */
  private order(): string[] {
    return [...(this.els?.list.children ?? [])].map((el) => (el as HTMLElement).dataset.id).filter((x): x is string => !!x && this.rows.has(x));
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
    const go = (j: number) => {
      const id = order[Math.max(0, Math.min(order.length - 1, j))];
      if (!id) return;
      this.select(id, true);
      this.rows.get(id)?.scrollIntoView({ block: 'nearest' });
    };
    const v = this.store.get(this.selected);
    // A row's own button (focused after its menu closed) keeps Enter and Space.
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).closest('button')) return;
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
        const r = row.getBoundingClientRect();
        this.rowMenu(v.id, { left: r.left + 44, top: r.bottom + 4 }, true, row);
      }
    } else return;
    e.preventDefault();
  }

  // ---- menus ----

  private rowMenu(id: string, place: { left?: number; right?: number; top?: number }, keyboard: boolean, from: HTMLElement): void {
    const v = this.store.get(id);
    if (!v) return;
    const run = (cmd: Parameters<DownloadStore['run']>[0]) => () => this.store.run(cmd, id);
    const entries: MenuEntry[] = [];
    const active = v.state === 'downloading' || v.state === 'starting';
    if (v.state === 'completed' && !v.missing) entries.push({ label: 'Open', key: 'o', accel: 'Enter', icon: ic.open, run: run('open') }, { label: 'Show in folder', key: 'f', icon: ic.folder(), run: run('show-in-folder') });
    else if (v.state === 'completed') entries.push({ label: 'Download again', key: 'd', icon: ic.retry, run: run('resume') });
    else if (active) entries.push({ label: 'Pause', key: 'p', accel: 'Space', icon: ic.pause(14), run: run('pause') }, { label: 'Show in folder', key: 'f', icon: ic.folder(), run: run('show-in-folder') });
    else if (v.state === 'queued') entries.push({ label: 'Start now', key: 's', icon: ic.play(14), run: run('start-now') }, { label: 'Pause', key: 'p', accel: 'Space', icon: ic.pause(14), run: run('pause') });
    else if (v.state === 'paused') entries.push({ label: 'Resume', key: 's', accel: 'Space', icon: ic.play(14), run: run('resume') }, { label: 'Show in folder', key: 'f', icon: ic.folder(), run: run('show-in-folder') });
    else entries.push({ label: 'Retry', key: 't', icon: ic.retry, run: run('resume') });
    entries.push('separator', { label: 'Copy address', key: 'a', icon: ic.copy, run: run('copy-address') }, 'separator');
    if (!['completed', 'failed', 'cancelled'].includes(v.state)) entries.push({ label: 'Cancel', key: 'c', icon: ic.cancel, run: run('cancel') });
    entries.push({ label: 'Remove from list', key: 'r', accel: 'Delete', icon: ic.remove, run: () => this.removeRow(id) });
    openMenu(this.b, `${v.filename} actions`, entries, place, { keyboard, returnFocus: from });
  }

  private limitMenu(from: HTMLElement, keyboard: boolean, current: number, set: (kbps: number) => void): void {
    const r = from.getBoundingClientRect();
    const entries: MenuEntry[] = LIMITS.map((kbps) => ({ label: limitLabel(kbps), checked: kbps === current, run: () => set(kbps) }));
    openMenu(this.b, 'Speed limit', entries, { left: r.left, top: r.bottom + 4 }, { keyboard, returnFocus: from });
  }

  // ---- add link ----

  private async openAdd(): Promise<void> {
    const els = this.els;
    if (!els) return;
    els.add.hidden = false;
    setText(els.addNote, '');
    if (!els.addInput.value) {
      const url = (await window.vitre.ipc.invoke('dl:clipboard-url')) as string | null;
      if (url && !els.addInput.value) els.addInput.value = url;
    }
    els.addInput.focus();
    els.addInput.select();
  }

  private closeAdd(): void {
    const els = this.els;
    if (!els) return;
    els.add.hidden = true;
    els.addInput.value = '';
    (els.panel.querySelector('.vd-add-btn') as HTMLElement).focus();
  }

  private async submitAdd(): Promise<void> {
    const els = this.els;
    if (!els) return;
    let url = els.addInput.value.trim();
    if (url && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setText(els.addNote, 'Enter a web address that starts with http or https.');
      return;
    }
    const btn = els.add.querySelector('button[type="submit"]') as HTMLElement;
    const r = btn.getBoundingClientRect();
    const id = await this.store.start(url, { origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
    if (!id) {
      setText(els.addNote, 'Vitre can’t download that address.');
      return;
    }
    this.selected = id;
    this.closeAdd();
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
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
  if (v.state === 'failed' || v.state === 'cancelled') return [['retry', 'Retry', ''], ['copy', 'Copy address', ''], ['remove', 'Remove from list', '']];
  const first: [string, string, string] = active ? ['pause', 'Pause', ''] : v.state === 'queued' ? ['now', 'Start now', ''] : ['resume', 'Resume', ''];
  const acts: [string, string, string][] = [first];
  if (v.engine === 'vitre') acts.push(['limit', 'Limit speed', '']);
  acts.push(['folder', 'Show in folder', ''], ['cancel', 'Cancel', 'danger']);
  return acts;
}

/** "Downloads" for the downloads folder itself; "Downloads › Video" or "D: › Films" elsewhere. */
function folderLabel(dir: string, base: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return dir;
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  if (base && norm(dir) === norm(base)) return parts[parts.length - 1];
  return parts.slice(-2).join(' › ');
}
