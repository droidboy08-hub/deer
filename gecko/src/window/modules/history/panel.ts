// The History panel (../design/HISTORY-SPEC.md; boards HistoryOpen, HistoryMotion, HistoryMenus,
// HistoryStates, HistorySpec and the part HistoryPanel): a 960x688 frosted sheet over the page dimmed
// at 0.3, the third panel beside Settings and Downloads. Its DOM, keys, focus and motion; the data is
// store.ts (Places) and closed.ts (SessionStore).
//
// Gecko notes (as Settings' panel.ts):
//   - The lens is a strip lens built for 960x688 (glass.ts lens, radius 22, scale 24, blur 22,
//     opaque); nothing between #vitre-root and it fades. Below 992x720 the sheet scales as a whole.
//   - State on b.root: `panel-open` (the core sends Ctrl+F / F3 here as 'vitre:panel-find', and page
//     keys do nothing under the panel) and `history-open`. One panel at a time (spec "Panel
//     switching"): show() closes Settings and Downloads first; a MutationObserver makes History step
//     aside, without moving focus, when settings-open or downloads-open appears.
//   - The address field (z 20) sits under the panel (z 30): when it takes focus History closes and
//     leaves focus there. Element full screen is left before the panel shows. In a popup window the
//     panel opens in the most recent normal window of the same privacy.
//   - Tooltips are tips.ts setTip; a row's tooltip has three lines (title, address, date and time).
//   - Keys a page-first binding also uses (Alt+Enter, Ctrl+Q) are taken on keydown with
//     preventDefault, so the router leaves them to the panel (keys.ts point 4).
//
// A private window (spec "Private windows"): the title bar and one line, "History isn’t shown in
// private windows."; no sidebar, toolbar or list, Close is the only control, and nothing of Places
// or SessionStore is read (the store and the closed list are never made).
import type { Browser } from '../../browser';
import { el, svg } from '../../dom';
import * as fx from '../../firefox';
import { lens } from '../../glass';
import { scrollThumb } from '../../scrollthumb';
import { setTip } from '../../tips';
import type { ClosedEntry, ClosedList } from './closed';
import * as f from './format';
import * as gk from './gecko';
import { MIN_ROWS, type HistoryStore, type Pending, type Row } from './store';

const W = 960;
const H = 688;
const MARGIN = 16;
const PANEL_LAYER = 60;
const PANEL_Z = 30;
const CLOSE_MS = 160;
/** Warm state (spec "Warm state"): view, query, scroll and focused row come back within 60 s. */
const WARM_MS = 60_000;
/** The undo line stays this long (spec "Deleting, and undo"). */
const UNDO_MS = 10_000;
/** Search runs this long after typing pauses (the address field's delay). */
const SEARCH_DELAY = 60;
/** "Searching…" shows after this long without an answer. */
const SEARCHING_AFTER = 400;
/** Rows built per frame when a large day comes in. */
const ROWS_PER_FRAME = 200;
/** Within this distance of the end, the next days load. */
const LOAD_AHEAD = 600;
/** Firefox's warn-on-open threshold: above it the selection menu's Open rows grey out. */
const OPEN_MAX = 15;
const PAGE_STEP = 13;
/** aria-rowindex values written per frame: a row added or deleted near the top of thousands of loaded rows renumbers the rest over a few frames. */
const INDEX_BUDGET = 3000;

type View = 'all' | 'closed';
type CloseMode = 'back' | 'handoff' | 'stay' | 'peek' | 'page';
type Where = 'here' | 'background' | 'tab' | 'peek' | 'window' | 'private';

/** One drawn row: a page on a day, or a closed tab or window. */
interface Item {
  id: string;
  page?: Row;
  closed?: ClosedEntry;
}
interface Group {
  id: string;
  kind: 'day' | 'tabs' | 'windows';
  dayStart?: number;
  items: Item[];
}
interface GroupEls {
  el: HTMLElement;
  head: HTMLElement;
  card: HTMLElement;
  cb: HTMLElement;
  label: HTMLElement;
  sub: HTMLElement;
  header: HTMLElement;
  del: HTMLButtonElement | null;
  group: Group;
  /** The checkbox's drawn state: '', 'on' or 'mixed'. */
  mark: string;
  /** The card's last live row (the one without a hairline). */
  lastRow: HTMLElement | null;
  /** The row ids the card was last fully built with, in order (null: not yet, or being built). */
  ids: string[] | null;
}
interface RowEls {
  el: HTMLElement;
  item: Item;
  groupId: string;
  fav: HTMLElement;
  cb: HTMLElement;
  title: HTMLElement;
  addr: HTMLElement;
  time: HTMLElement;
  x: HTMLButtonElement;
  /** What a closed row was last painted from: unchanged rows are not painted again. */
  key: string;
  /** What a page row was last painted from (compared field by field: nothing is built per row). */
  painted: Painted | null;
  /** Its drawn selection. */
  sel: boolean;
}

/** The fields a page row is painted from. */
interface Painted {
  title: string;
  url: string;
  last: number;
  icon: boolean;
  results: boolean;
  words: string;
  day: number;
  today: number;
}

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Glyphs (HistoryPanel board), static markup.
const GLYPHS: Record<string, string> = {
  history16: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 10a5.8 5.8 0 1 0 1.7-4.1M3.6 3.6v2.8h2.8M10 6.6V10l2.4 1.5"/></svg>',
  history18: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 10a5.8 5.8 0 1 0 1.7-4.1M3.6 3.6v2.8h2.8M10 6.6V10l2.4 1.5"/></svg>',
  closed18: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 5.5 4 9l3.5 3.5M4 9h7.5a4 4 0 0 1 0 8H9"/></svg>',
  opentab18: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5V12M11 4.5h4.5V9M15.5 4.5 9.5 10.5"/></svg>',
  search14: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 3.6 3.6"/></svg>',
  close12: '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
  trash14: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.8 10a1.5 1.5 0 0 0 1.5 1.4h3.4a1.5 1.5 0 0 0 1.5-1.4L14 6"/></svg>',
  check20: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 10.2 8.6 13.2 14.5 7"/></svg>',
  globe16: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM3.5 10h13M10 3.5c-1.8 2-2.6 4.1-2.6 6.5s.8 4.5 2.6 6.5c1.8-2 2.6-4.1 2.6-6.5S11.8 5.5 10 3.5z"/></svg>',
  window16: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V6A1.5 1.5 0 0 1 4 4.5zM2.5 7.5h15"/></svg>',
};
const parsed = new Map<string, SVGSVGElement>();
function glyph(name: string): SVGSVGElement {
  let g = parsed.get(name);
  if (!g) {
    g = svg(GLYPHS[name]);
    parsed.set(name, g);
  }
  return g.cloneNode(true) as SVGSVGElement;
}

/** Text with the search's matches in Semibold (spec "Search": no colour fill). */
function marked(text: string, words: string[]): Node[] {
  const hits = f.hitsIn(text, words);
  if (!hits.length) return [document.createTextNode(text)];
  const out: Node[] = [];
  let at = 0;
  for (const [a, z] of hits) {
    if (a > at) out.push(document.createTextNode(text.slice(at, a)));
    const b = document.createElement('b');
    b.textContent = text.slice(a, z);
    out.push(b);
    at = z;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

const checkbox = (cls: string): HTMLElement => el('span', { class: `vh-cb ${cls}`, 'aria-hidden': 'true' }, glyph('check20'), el('span', { class: 'vh-mix' }));

export class HistoryPanel {
  private built = false;
  private openNow = false;
  private root!: HTMLElement;
  private sheet!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private live!: HTMLElement;
  // normal windows
  private search: HTMLInputElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private searchBox: HTMLElement | null = null;
  private viewAll: HTMLButtonElement | null = null;
  private viewClosed: HTMLButtonElement | null = null;
  private closedCount: HTMLElement | null = null;
  private clearData: HTMLButtonElement | null = null;
  private tbLines: HTMLElement[] = [];
  private tbActive = 0;
  private tbKey = '';
  private scroller: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private msg: HTMLElement | null = null;
  private thumbOff: (() => void) | null = null;

  private view: View = 'all';
  /** The field's text the list is filtered by (applied SEARCH_DELAY after typing). */
  private query = '';
  private searchTimer = 0;
  private searchingTimer = 0;
  private searchingShown = false;
  private sel = new Set<string>();
  private anchor = '';
  private allMatches = false;
  private stopId = '';
  private groups = new Map<string, GroupEls>();
  private rows = new Map<string, RowEls>();
  /** The groups the last sync drew, in order. */
  private drawn: Group[] = [];
  /** The list's stops in drawn order, until the list's rows change (see stops). */
  private stopsCache: HTMLElement[] | null = null;
  /** The stop with tabindex 0 (roving focus); every other stop has -1. */
  private tabStop: HTMLElement | null = null;
  /** The aria-rowindex each stop carries. */
  private rowIndex = new WeakMap<Element, number>();
  /** The frame that goes on renumbering (see INDEX_BUDGET). */
  private indexJob = 0;
  /** A day delete whose line waits for its pages to be counted (announced then). */
  private countWait: Pending | null = null;
  private renderQueued = 0;
  private returnFocus: HTMLElement | null = null;
  private lastInside: HTMLElement | null = null;
  private hideTimer = 0;
  private afterFullscreen: (() => void) | null = null;
  private warm: { at: number; view: View; query: string; scroll: number; focus: string } | null = null;
  private undoTimer = 0;
  private undoLeft = UNDO_MS;
  private undoStarted = 0;
  private undoHeld = false;
  private announceTimer = 0;
  private midnightTimer = 0;
  private peekBack: { rowKey: string; tabId: number; listen: (e: Event) => void } | null = null;
  private acting = false;
  private loadingFresh = false;
  private msgTimer = 0;

  /** Test knobs (window.vitreHistory): the undo line's life, and "assistive technology is running". */
  undoMs = UNDO_MS;
  assistive: boolean | null = null;

  constructor(
    private b: Browser,
    private store: HistoryStore | null,
    private closed: ClosedList | null
  ) {
    b.addEscLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      // One step per keydown: the selection, then the panel (the field clears its own text first).
      if (this.sel.size) this.clearSelection();
      else this.close();
      return true;
    });
    b.addCloseLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      this.close();
      return true;
    });
    const resized = (): void => {
      if (this.openNow) this.layout();
    };
    window.addEventListener('resize', resized);
    b.onDestroy(() => window.removeEventListener('resize', resized));
    // One panel at a time: Settings or Downloads opening makes History step aside. That panel hands
    // focus back to an element of this hidden sheet when it closes, which can't take it: focus then
    // goes to where it was before History opened (as Settings does for Downloads).
    const watch = new MutationObserver(() => {
      const cl = this.b.root.classList;
      if (this.openNow && (cl.contains('settings-open') || cl.contains('downloads-open'))) this.close('handoff');
      else if (this.handoffBack && !cl.contains('panel-open')) {
        const back = this.handoffBack;
        this.handoffBack = null;
        this.returnFromHandoff(back);
      }
    });
    watch.observe(this.b.root, { attributes: true, attributeFilter: ['class'] });
    b.onDestroy(() => watch.disconnect());
    // Switching tabs underneath (Ctrl+Tab, Ctrl+1) focuses the page; the panel keeps focus.
    b.on('tab-activated', () => {
      if (this.openNow) this.reclaimFocus();
    });
    const panelFind = (): void => {
      if (!this.openNow || !this.search) return;
      this.search.focus();
      this.search.select();
    };
    document.addEventListener('vitre:panel-find', panelFind);
    b.onDestroy(() => document.removeEventListener('vitre:panel-find', panelFind));
    if (store) {
      store.subscribe((c) => {
        if (!this.built) return;
        if (c.type === 'visited' && c.added) this.keepStill(() => this.sync());
        else if (c.type === 'reset' && !this.loadingFresh) this.keepFirst(() => this.sync());
        else if (c.type === 'removed') this.fadeOut();
        else if (c.type === 'titled') for (const r of c.rows) this.repaintRow(r.id);
        else if (c.type === 'search') this.onResults();
        else if (c.type === 'pending' && this.acting) return;
        else this.sync();
        this.paintToolbar();
        // A day's pages were counted (Delete day on a search-results heading): its line is heard now.
        if (c.type === 'pending' && this.countWait && this.countWait === this.store?.pending && this.countWait.pages >= 0) this.announceDelete();
      });
    }
    // Its window closing commits a pending delete (VitreHistory finishes it after the window is gone).
    b.onDestroy(() => {
      this.afterFullscreen?.();
      window.clearTimeout(this.undoTimer);
      window.clearTimeout(this.midnightTimer);
      this.closed?.watch(null);
      void this.store?.commit();
      this.store?.dispose();
      this.stopPeekWatch();
    });
  }

  get isOpen(): boolean {
    return this.openNow;
  }

  get private(): boolean {
    return this.b.isPrivate;
  }

  toggle(): void {
    if (this.openNow) this.close();
    else this.show();
  }

  /**
   * Open (or bring forward) the panel. `query` becomes its search (Ctrl+H in the address field),
   * `view` picks All history or Recently closed. Within 60 s of a close it opens warm.
   */
  show(opts: { query?: string; view?: View } = {}): void {
    if (this.elsewhere(opts)) return;
    // Deer's layer is hidden while a page element is full screen: leave it first, then open.
    if (fx.inDOMFullscreen()) {
      if (!this.afterFullscreen) {
        this.afterFullscreen = fx.onDOMFullscreenExit(() => {
          this.afterFullscreen = null;
          requestAnimationFrame(() => {
            if (!fx.inDOMFullscreen()) this.show(opts);
          });
        }, true);
      }
      gk.leaveElementFullscreen();
      return;
    }
    this.build();
    if (this.openNow) {
      if (opts.view) this.setView(opts.view);
      if (opts.query !== undefined && this.search) this.setQuery(opts.query, true);
      this.focusInitial();
      return;
    }
    this.enter();
    if (this.private) {
      requestAnimationFrame(() => this.openNow && this.closeBtn.focus());
      return;
    }
    const warm = this.warm && Date.now() - this.warm.at < WARM_MS && opts.query === undefined && !opts.view ? this.warm : null;
    this.warm = null;
    this.view = opts.view ?? warm?.view ?? 'all';
    const q = opts.query !== undefined ? opts.query : (warm?.query ?? '');
    this.query = q.replace(/\s+/g, ' ').trim();
    if (this.search) this.search.value = q;
    this.paintSearch();
    this.paintNav();
    this.stopId = warm?.focus ?? '';
    void this.loadFresh(warm);
    this.focusInitial(true);
  }

  /** In a popup window: open in the most recent normal window of the same privacy, which comes to the front. */
  private elsewhere(opts: { query?: string; view?: View }): boolean {
    if (!this.b.isPopup) return false;
    const win = fx.topBrowserWindow(this.b.isPrivate);
    const other = win && win !== window ? (win as Window).vitre : undefined;
    const api = other && !other.isPopup ? other.service('history') : undefined;
    if (!api) return false;
    api.open(opts);
    win!.focus();
    return true;
  }

  /**
   * Close. 'back' returns focus to where it was (or the page); 'handoff' when Settings or Downloads
   * takes over; 'stay' when the address field took focus; 'peek' when a peek from a row takes over
   * (the pending delete is kept, its timer running, and History comes back when the peek is put
   * back); 'page' after a page opened from the panel (focus goes to the page).
   */
  close(mode: CloseMode = 'back'): void {
    if (!this.openNow) return;
    this.openNow = false;
    this.b.service('menus')?.close();
    if (mode !== 'peek') {
      this.stopUndo();
      void this.store?.commit();
    }
    this.clearSelection(true);
    window.clearTimeout(this.searchTimer);
    window.clearTimeout(this.searchingTimer);
    window.clearTimeout(this.midnightTimer);
    if (!this.private) {
      this.warm = { at: Date.now(), view: this.view, query: this.search?.value ?? '', scroll: this.scroller?.scrollTop ?? 0, focus: this.stopId };
    }
    if (mode !== 'peek') {
      this.store?.watch(false);
      this.closed?.watch(null);
    }
    this.b.root.classList.remove('history-open');
    const cl = this.b.root.classList;
    if (!cl.contains('settings-open') && !cl.contains('downloads-open')) cl.remove('panel-open');
    this.root.classList.remove('open');
    this.root.classList.add('closing');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.openNow) return;
      this.root.hidden = true;
      this.root.classList.remove('closing');
      // Every open reads the list again (loadFresh): the rows' DOM goes with the sheet, unless History
      // only stepped aside for a peek and comes back.
      if (mode !== 'peek') this.clearRows();
    }, CLOSE_MS);
    const back = this.returnFocus;
    this.returnFocus = null;
    this.lastInside = null;
    if (mode === 'back') this.focusBack(back);
    else if (mode === 'page') this.b.focusPage();
    else if (mode === 'handoff') this.handoffBack = back ?? this.b.active()?.browser ?? null;
  }

  /** Where focus goes once the panel that took over from History closes again. */
  private handoffBack: HTMLElement | null = null;

  /**
   * The panel that took over from History closed, and no panel is open: focus goes back to where it
   * was before History opened (spec "Ways out": "to the element that had it before, or to the page"),
   * unless that panel put it somewhere usable. Downloads hands it back to History's hidden search
   * field, which can't take it, so it stays on Downloads' closing sheet (and falls to the document
   * when that sheet is removed, 300 ms later): both count as nowhere.
   */
  private returnFromHandoff(back: HTMLElement): void {
    const stranded = (): boolean => {
      if (this.openNow || this.b.root.classList.contains('panel-open')) return false;
      const at = document.activeElement as HTMLElement | null;
      if (!at || at === document.body || at === document.documentElement) return true;
      // Inside a panel (Settings, Downloads or History) while none is open: a sheet that is closing.
      return typeof at.closest === 'function' && !!at.closest('.vs-root, .vd-panel, .vh-root');
    };
    if (stranded()) this.focusBack(back);
    window.setTimeout(() => {
      if (stranded()) this.focusBack(back);
    }, 400);
  }

  /** Commit the pending delete now (Clear browsing data, tests). */
  commit(): Promise<void> {
    this.stopUndo();
    const done = this.store?.commit() ?? Promise.resolve();
    this.paintToolbar();
    return done;
  }

  // ---- building ----

  private build(): void {
    if (this.built) return;
    this.built = true;
    const layer = this.b.layer('history-panel', PANEL_Z);
    this.closeBtn = el('button', { type: 'button', class: 'vh-close', 'aria-label': 'Close history', 'aria-keyshortcuts': 'Escape' }, glyph('close12'));
    setTip(this.closeBtn, 'Close', 'Esc');
    this.closeBtn.addEventListener('click', () => this.close());
    const lensEl = el('div', { class: 'vh-lens' });
    lensEl.style.backdropFilter = lens(W, H, { radius: 22, scale: 24, blur: 22, opaque: true });
    this.live = el('div', { class: 'vh-live', role: 'status', 'aria-live': 'polite' });
    this.live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
    const titlebar = el('header', { class: 'vh-titlebar' }, el('span', { class: 'vh-tico' }, glyph('history16')), el('span', { class: 'vh-ttl', id: 'vh-title' }, 'History'), this.closeBtn);
    const body = el('div', { class: 'vh-body' }, titlebar);
    this.sheet = el('section', { class: 'vh-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vh-title' }, lensEl, el('div', { class: 'vh-tint' }), el('div', { class: 'vh-rim' }), body);
    if (this.private) {
      // Spec "Private windows": described by its one line, Close its only control.
      body.append(el('p', { class: 'vh-private', id: 'vh-private-note' }, 'History isn’t shown in private windows.'));
      this.sheet.setAttribute('aria-describedby', 'vh-private-note');
    } else body.append(this.buildColumns());
    body.append(this.live);
    this.sheet.addEventListener('keydown', (e) => this.onSheetKey(e));
    const scrim = el('div', { class: 'vh-scrim', 'aria-hidden': 'true' });
    scrim.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // The press must not take focus to the document: it goes back where it was.
      e.preventDefault();
      this.close();
    });
    this.root = el('div', { class: 'vh-root', id: 'vitre-history', hidden: true }, scrim, this.sheet);
    layer.append(this.root);
    // Keep focus inside the sheet while it is open (surfaces stacked above it may take it).
    const focusin = (e: FocusEvent): void => {
      if (!this.openNow) return;
      const t = e.target as HTMLElement;
      if (!t || typeof t.closest !== 'function') return;
      if (this.sheet.contains(t)) this.lastInside = t;
      // Ctrl+T, Ctrl+L or F6 opened the address field, which sits under the panel: step aside.
      else if (t === this.b.omni.input || t.closest('#vitre-omni-field')) this.close('stay');
      else if (this.isBeneath(t)) this.reclaimFocus();
    };
    document.addEventListener('focusin', focusin);
    this.b.onDestroy(() => document.removeEventListener('focusin', focusin));
  }

  private buildColumns(): HTMLElement {
    const search = el('input', { type: 'text', role: 'searchbox', class: 'vh-search-input', placeholder: 'Search history', 'aria-label': 'Search history', 'aria-description': 'Searches page titles and addresses', 'aria-keyshortcuts': 'Control+F', spellcheck: 'false', autocomplete: 'off' });
    this.search = search;
    this.clearBtn = el('button', { type: 'button', class: 'vh-search-clear', 'aria-label': 'Clear search', tabindex: '-1', hidden: true }, glyph('close12'));
    setTip(this.clearBtn, 'Clear');
    this.searchBox = el('label', { class: 'vh-search' }, el('span', { class: 'vh-ico' }, glyph('search14')), search, this.clearBtn);
    search.addEventListener('input', () => this.onInput());
    search.addEventListener('keydown', (e) => this.onSearchKey(e));
    // The menus module's glass editing menu only (Firefox's native textbox menu would open beside it).
    search.addEventListener('contextmenu', (e) => {
      if (this.b.service('menus')) e.preventDefault();
    });
    this.clearBtn.addEventListener('click', () => {
      this.setQuery('', true);
      search.focus();
    });

    this.viewAll = el('button', { type: 'button', class: 'vh-view', 'data-view': 'all' }, el('span', { class: 'vh-ico' }, glyph('history18')), el('span', { class: 'vh-view-label' }, 'All history'));
    this.closedCount = el('span', { class: 'vh-count' });
    this.viewClosed = el('button', { type: 'button', class: 'vh-view', 'data-view': 'closed' }, el('span', { class: 'vh-ico' }, glyph('closed18')), el('span', { class: 'vh-view-label' }, 'Recently closed'), this.closedCount);
    const views = el('nav', { class: 'vh-views', 'aria-label': 'History views' }, this.viewAll, this.viewClosed);
    for (const v of [this.viewAll, this.viewClosed]) v.addEventListener('click', () => this.setView(v.dataset.view as View));
    views.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const next = e.key === 'ArrowUp' || e.key === 'Home' ? 'all' : 'closed';
      this.setView(next);
      (next === 'all' ? this.viewAll : this.viewClosed)?.focus();
    });
    this.clearData = el('button', { type: 'button', class: 'vh-cleardata', 'aria-label': 'Clear browsing data, opens Settings', 'aria-keyshortcuts': 'Control+Shift+Delete' }, el('span', { class: 'vh-ico' }, glyph('opentab18')), el('span', { class: 'vh-view-label' }, 'Clear browsing data…'));
    setTip(this.clearData, 'Clear browsing data', 'Ctrl+Shift+Delete');
    this.clearData.addEventListener('click', () => this.openClearData());
    const side = el('div', { class: 'vh-side' }, this.searchBox, views, el('div', { class: 'vh-sideline', 'aria-hidden': 'true' }), this.clearData);

    this.tbLines = [0, 1].map(() => el('div', { class: 'vh-tbline', 'aria-hidden': 'true' }));
    const toolbar = el('div', { class: 'vh-toolbar' }, ...this.tbLines);
    // The undo line pauses while the pointer or keyboard focus is on it.
    toolbar.addEventListener('pointerenter', () => this.holdUndo(true));
    toolbar.addEventListener('pointerleave', () => this.holdUndo(this.sheet.querySelector('.vh-toolbar')?.contains(document.activeElement) ?? false));
    toolbar.addEventListener('focusin', () => this.holdUndo(true));
    toolbar.addEventListener('focusout', (e) => {
      if (!toolbar.contains(e.relatedTarget as Node | null) && !toolbar.matches(':hover')) this.holdUndo(false);
    });

    this.list = el('div', { class: 'vh-list pages', role: 'grid', 'aria-multiselectable': 'true', 'aria-label': 'All history', 'aria-rowcount': '-1' });
    this.scroller = el('div', { class: 'vh-scroll' }, this.list);
    this.msg = el('div', { class: 'vh-msg', role: 'status' });
    this.msg.hidden = true;
    const listbox = el('div', { class: 'vh-listbox' }, this.scroller, this.msg);
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.list.addEventListener('click', (e) => this.onListClick(e));
    this.list.addEventListener('mousedown', (e) => {
      // Middle-click opens in the background: no autoscroll. A press never moves keyboard focus off
      // the row it lands on (it becomes the list's stop).
      if (e.button === 1) e.preventDefault();
      const stop = (e.target as Element).closest<HTMLElement>('.vh-row, .vh-head');
      if (stop && e.button === 0) this.setStop(stop);
    });
    this.list.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const row = (e.target as Element).closest<HTMLElement>('.vh-row');
      if (!row || (e.target as Element).closest('.vh-x, .vh-slot')) return;
      e.preventDefault();
      this.activate(row.dataset.id ?? '', 'background');
    });
    this.list.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    const content = el('div', { class: 'vh-content' }, toolbar, listbox);
    return el('div', { class: 'vh-cols' }, side, el('div', { class: 'vh-vsep', 'aria-hidden': 'true' }), content);
  }

  private enter(): void {
    window.clearTimeout(this.hideTimer);
    // One panel at a time (spec "Panel switching"): the other panel steps aside first.
    const cl = this.b.root.classList;
    if (cl.contains('settings-open')) this.b.service('settings')?.close();
    if (cl.contains('downloads-open')) this.b.run('downloads');
    // Coming back over the panel that took over from History, keep the original place to return to.
    const active = document.activeElement as HTMLElement | null;
    this.returnFocus = this.handoffBack ?? (active && active !== document.body && active !== document.documentElement && !this.b.omni.open && !active.closest?.('.vs-root, .vd-panel') ? active : null);
    this.handoffBack = null;
    if (this.b.omni.open) this.b.omni.close(false);
    this.b.closePanels();
    this.openNow = true;
    this.b.root.classList.add('panel-open', 'history-open');
    this.layout();
    this.root.hidden = false;
    this.root.classList.remove('closing', 'open');
    void this.root.offsetWidth; // start the transition from the closed state
    this.root.classList.add('open');
    if (!this.private) {
      this.store?.watch(true);
      this.closed?.watch(() => this.onClosedChanged());
      if (!this.thumbOff && this.scroller) this.thumbOff = scrollThumb(this.scroller);
      this.armMidnight();
    }
  }

  /** Centre the sheet; below 992x720 scale it down so it always fits with a margin. */
  private layout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fit = Math.min(1, (vw - 2 * MARGIN) / W, (vh - 2 * MARGIN) / H);
    this.sheet.style.left = `${Math.round((vw - W) / 2)}px`;
    this.sheet.style.top = `${Math.round((vh - H) / 2)}px`;
    this.sheet.style.transform = fit < 1 ? `scale(${fit.toFixed(4)})` : '';
  }

  /** Read everything again (the order is corrected on every open); a warm open restores its place. */
  private async loadFresh(warm: { scroll: number; focus: string } | null): Promise<void> {
    const store = this.store;
    if (!store) return;
    this.loadingFresh = true;
    this.closed?.read();
    void this.readClosedIcons();
    this.paintNav();
    this.clearRows();
    void store.readSummary();
    const fresh = store.reload();
    if (this.query) void store.search(this.query);
    else void store.search('');
    await fresh;
    if (!this.openNow) {
      this.loadingFresh = false;
      return;
    }
    // A warm open goes back to its place: enough days for the scroll position it had.
    if (warm && warm.scroll > 0 && this.view === 'all' && !this.query) {
      for (let i = 0; i < 20 && !store.atEnd && store.days.reduce((n, d) => n + d.rows.length, 0) * 40 < warm.scroll + 578; i++) await store.loadMore(MIN_ROWS);
    }
    this.loadingFresh = false;
    this.sync();
    this.paintToolbar();
    if (warm && this.scroller) {
      this.scroller.scrollTop = warm.scroll;
      const back = warm.focus && this.findStop(warm.focus);
      if (back && this.sheet.contains(document.activeElement) && document.activeElement !== this.search) this.focusStop(back, false);
    }
  }

  private clearRows(): void {
    this.list?.replaceChildren();
    this.groups.clear();
    this.rows.clear();
    this.drawn = [];
    this.stopsCache = null;
    this.tabStop = null;
    cancelAnimationFrame(this.indexJob);
    this.indexJob = 0;
  }

  // ---- the model ----

  /** What the list shows now, in order. */
  private model(): Group[] {
    if (this.private) return [];
    if (this.view === 'closed') {
      const c = this.closed;
      if (!c) return [];
      const words = f.wordsOf(this.query);
      const match = (e: ClosedEntry): boolean => !words.length || words.every((w) => `${e.title} ${e.url}`.toLocaleLowerCase().includes(w) || (e.kind === 'window' && e.titles.join(' ').toLocaleLowerCase().includes(w)));
      const out: Group[] = [];
      const tabs = c.tabs.filter(match);
      const wins = c.windows.filter(match);
      if (tabs.length) out.push({ id: 'g-tabs', kind: 'tabs', items: tabs.map((e) => ({ id: e.id, closed: e })) });
      if (wins.length) out.push({ id: 'g-windows', kind: 'windows', items: wins.map((e) => ({ id: e.id, closed: e })) });
      return out;
    }
    const s = this.store;
    if (!s) return [];
    const days = s.shown ? s.results : s.visibleDays;
    const out: Group[] = [];
    for (const d of days) {
      // Rows a delete hides stay in the store for Undo; they are not drawn.
      const items = d.rows.filter((r) => !s.hides(r)).map((r) => ({ id: r.id, page: r }));
      if (items.length) out.push({ id: `g${s.shown ? 's' : 'd'}${d.start}`, kind: 'day', dayStart: d.start, items });
    }
    return out;
  }

  private words(): string[] {
    if (this.view === 'closed') return f.wordsOf(this.query);
    return f.wordsOf(this.store?.shown ?? '');
  }

  /**
   * Make the DOM match the model. `leave` says how rows and days that are no longer in it go:
   * 'collapse' (a delete: content fades, then the height closes), 'fade' (a deletion elsewhere: they
   * fade over 150 ms and the gap closes at once) or 'now'. `expand` lets new rows open (Undo).
   * Every loaded row is drawn, so a change costs little per row: a row is painted again only when
   * what it shows changed, and selection, indexes and the tab stop touch only the rows that changed.
   */
  private sync(opts: { leave?: 'collapse' | 'fade' | 'now'; expand?: boolean } = {}): void {
    const list = this.list;
    if (!list || this.private) return;
    const leave = opts.leave ?? 'now';
    const groups = this.model();
    const words = this.words();
    const wkey = words.join(' ');
    const keepGroups = new Set(groups.map((g) => g.id));
    const keepRows = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
    // Gone rows and days.
    const leaving: HTMLElement[] = [];
    for (const [id, r] of this.rows) {
      if (keepRows.has(id)) continue;
      this.rows.delete(id);
      if (keepGroups.has(r.groupId)) leaving.push(r.el);
      else r.el.classList.add('leaving');
    }
    for (const [id, g] of this.groups) {
      if (keepGroups.has(id)) continue;
      this.groups.delete(id);
      leaving.push(g.el);
    }
    const many = leaving.length > 40 || reduced();
    for (const node of leaving) this.leave(node, leave === 'collapse' && !many ? 'collapse' : leave === 'now' ? 'now' : 'fade');
    // Present ones, in order; new rows are built ROWS_PER_FRAME at a time.
    let budget = ROWS_PER_FRAME;
    let more = false;
    const today = this.store?.today() ?? f.dayStartOf(Date.now());
    let cursor = this.firstLive(list);
    for (const g of groups) {
      let ge = this.groups.get(g.id);
      const fresh = !ge;
      if (!ge) {
        ge = this.makeGroup(g);
        this.groups.set(g.id, ge);
        if (opts.expand) ge.el.classList.add('gone', 'leaving');
      }
      ge.group = g;
      this.paintGroup(ge, today);
      if (ge.el !== cursor) list.insertBefore(ge.el, cursor);
      else cursor = this.nextLive(cursor);
      // A card whose rows are the ones it was built with, in the same order, needs no DOM walk.
      if (!fresh && ge.ids && ge.ids.length === g.items.length && g.items.every((it, i) => it.id === ge!.ids![i])) {
        for (const it of g.items) {
          const re = this.rows.get(it.id)!;
          re.item = it;
          this.paintRow(re, words, wkey, g, today);
        }
        continue;
      }
      let complete = true;
      let rc = this.firstLive(ge.card);
      for (const it of g.items) {
        let re = this.rows.get(it.id);
        if (!re) {
          if (budget <= 0) {
            more = true;
            complete = false;
            continue;
          }
          budget--;
          re = this.makeRow(it, g.id);
          this.rows.set(it.id, re);
          if (opts.expand && !fresh) re.el.classList.add('gone', 'leaving');
        }
        re.item = it;
        re.groupId = g.id;
        this.paintRow(re, words, wkey, g, today);
        if (re.el !== rc) ge.card.insertBefore(re.el, rc);
        else rc = this.nextLive(rc);
      }
      ge.ids = complete ? g.items.map((it) => it.id) : null;
      this.paintLast(ge);
    }
    this.drawn = groups;
    this.stopsCache = null;
    if (opts.expand) {
      this.expand();
      for (const ge of this.groups.values()) this.paintLast(ge);
    }
    this.paintSelection();
    this.paintIndexes();
    this.paintMessage(groups);
    if (more && !this.renderQueued) {
      this.renderQueued = requestAnimationFrame(() => {
        this.renderQueued = 0;
        this.sync();
      });
    }
  }

  /** The first child that is a live (not leaving) row or group, or the card's outline. */
  private firstLive(parent: Element): Element | null {
    let c = parent.firstElementChild;
    while (c && (c.classList.contains('leaving') || c.classList.contains('vh-cardline'))) c = c.nextElementSibling;
    return c;
  }

  private nextLive(node: Element | null): Element | null {
    let c = node?.nextElementSibling ?? null;
    while (c && (c.classList.contains('leaving') || c.classList.contains('vh-cardline'))) c = c.nextElementSibling;
    return c;
  }

  /** A row or day goes: collapse (delete), fade (deleted elsewhere: the gap closes at once) or at once. */
  private leave(node: HTMLElement, how: 'collapse' | 'fade' | 'now'): void {
    this.stopsCache = null;
    node.classList.add('leaving');
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('tabindex');
    if (how === 'now') {
      node.remove();
      return;
    }
    if (how === 'fade') {
      node.classList.add('fade');
      window.setTimeout(() => node.remove(), 150);
      return;
    }
    node.classList.add('gone');
    window.setTimeout(() => node.remove(), node.classList.contains('vh-group') ? 300 : 360);
  }

  /** Undo: rows and days built hidden open again (the reverse of the collapse). */
  private expand(): void {
    const opening = [...(this.list?.querySelectorAll<HTMLElement>('.gone.leaving') ?? [])].filter((n) => (n.classList.contains('vh-row') && this.rows.has(n.dataset.id ?? '')) || (n.classList.contains('vh-group') && this.groups.has(n.dataset.id ?? '')));
    if (!opening.length) return;
    this.stopsCache = null;
    void this.list!.offsetWidth;
    for (const n of opening) {
      n.classList.remove('gone', 'leaving');
      n.removeAttribute('aria-hidden');
    }
  }

  private makeGroup(g: Group): GroupEls {
    const cb = checkbox('vh-hcb');
    const label = el('span', { class: 'vh-hl' });
    const sub = el('span', { class: 'vh-hs' });
    const header = el('span', { class: 'vh-htext', role: 'rowheader' }, label, sub);
    let del: HTMLButtonElement | null = null;
    const box = el('div', { class: 'vh-hbox' }, cb, header);
    if (g.kind === 'day') {
      del = el('button', { type: 'button', class: 'vh-hdel', tabindex: '-1', 'aria-keyshortcuts': 'Delete' }, 'Delete day');
      box.append(el('span', { class: 'vh-hdelcell', role: 'gridcell' }, del));
    }
    const head = el('div', { class: 'vh-head', role: 'row', tabindex: '-1', 'data-group': g.id });
    head.append(box);
    const card = el('div', { class: 'vh-card' }, el('div', { class: 'vh-cardline', 'aria-hidden': 'true' }));
    const node = el('div', { class: 'vh-group', role: 'rowgroup', 'data-id': g.id }, head, card, el('div', { class: 'vh-gap' }));
    return { el: node, head, card, cb, label, sub, header, del, group: g, mark: '', lastRow: null, ids: null };
  }

  private paintGroup(ge: GroupEls, today: number): void {
    const g = ge.group;
    const n = g.items.length;
    if (g.kind === 'day' && g.dayStart !== undefined) {
      const d = f.dayLabel(g.dayStart, today);
      if (ge.label.textContent !== d.label) ge.label.textContent = d.label;
      if (ge.sub.textContent !== d.sub) ge.sub.textContent = d.sub;
      ge.sub.hidden = !d.sub;
      ge.header.setAttribute('aria-label', `${d.aria}, ${f.plural(n, 'page', 'pages')}`);
      ge.del?.setAttribute('aria-label', `Delete day, ${d.name}`);
    } else {
      const label = g.kind === 'tabs' ? 'Tabs' : 'Windows';
      ge.label.textContent = label;
      ge.sub.hidden = true;
      ge.header.setAttribute('aria-label', `${label}, ${n}`);
    }
  }

  /** No hairline under a card's last row. */
  private paintLast(ge: GroupEls): void {
    let last = ge.card.lastElementChild as HTMLElement | null;
    while (last && (!last.classList.contains('vh-row') || last.classList.contains('leaving'))) last = last.previousElementSibling as HTMLElement | null;
    if (ge.lastRow === last) return;
    // A row that is leaving keeps its look while it goes.
    if (ge.lastRow && !ge.lastRow.classList.contains('leaving')) ge.lastRow.classList.remove('last');
    last?.classList.add('last');
    ge.lastRow = last;
  }

  private makeRow(it: Item, groupId: string): RowEls {
    const fav = el('span', { class: 'vh-fav' });
    const cb = checkbox('');
    const slot = el('span', { class: 'vh-slot', 'aria-hidden': 'true' }, fav, cb);
    const title = el('span', { class: 'vh-title', role: 'gridcell', dir: 'auto' });
    const addr = el('span', { class: 'vh-addr', role: 'gridcell' });
    const time = el('span', { class: 'vh-time', role: 'gridcell' });
    const x = el('button', { type: 'button', class: 'vh-x', tabindex: '-1', 'aria-keyshortcuts': 'Delete' }, glyph('close12'));
    setTip(x, it.closed ? 'Remove from list' : 'Delete from history', 'Delete');
    const inner = el(
      'div',
      { class: 'vh-in' },
      el('div', { class: 'vh-plate' }),
      el('div', { class: 'vh-wash' }),
      el('div', { class: 'vh-ring' }),
      slot,
      title,
      addr,
      time,
      el('span', { class: 'vh-xcell', role: 'gridcell' }, x),
      el('div', { class: 'vh-hair' })
    );
    const row = el('div', { class: 'vh-row', role: 'row', tabindex: '-1', 'data-id': it.id }, inner);
    if (it.page) row.setAttribute('aria-selected', 'false');
    return { el: row, item: it, groupId, fav, cb, title, addr, time, x, key: '', painted: null, sel: false };
  }

  private paintRow(re: RowEls, words: string[], wkey: string, g: Group, today: number): void {
    const it = re.item;
    if (it.page) {
      const r = it.page;
      const results = !!this.store?.shown;
      const dayStart = g.dayStart ?? r.dayStart;
      // Compared before anything is formatted (dates and addresses cost; every loaded row is drawn).
      const was = re.painted;
      if (!was || was.title !== r.title || was.url !== r.url || was.last !== r.last || was.icon !== r.icon || was.results !== results || was.words !== wkey || was.day !== dayStart || was.today !== today) {
        re.painted = { title: r.title, url: r.url, last: r.last, icon: r.icon, results, words: wkey, day: dayStart, today };
        const name = r.title || f.bare(r.url);
        const addr = results ? f.addressFor(r.url, r.title, words) : f.hostOf(r.url);
        const time = f.timeOf(r.last);
        this.paintFav(re, r.icon ? `page-icon:${r.url}` : '', 'globe16');
        re.title.replaceChildren(...marked(name, words));
        re.title.classList.toggle('bare', !r.title);
        re.addr.replaceChildren(el('span', {}, ...marked(addr, words)));
        re.time.replaceChildren(el('time', { datetime: f.isoLocal(r.last) }, time));
        const day = f.dayLabel(dayStart, today).name;
        re.el.setAttribute('aria-label', `${name}, ${addr}, ${time}`);
        re.x.setAttribute('aria-label', `Delete from history, ${name}, ${day}`);
        setTip(re.el, `${name}\n${r.url}\n${f.fullDateTime(r.last)}`);
        re.el.dataset.tipDelay = '600';
      }
      return;
    }
    const e = it.closed!;
    const when = f.closedWhen(e.closedAt, today);
    const addr = e.kind === 'window' ? `Window · ${f.plural(e.count, 'tab', 'tabs')}` : f.hostOf(e.url);
    const name = e.title || f.bare(e.url);
    const key = `c|${name}|${addr}|${when}|${wkey}`;
    if (re.key === key) return;
    re.key = key;
    if (e.kind === 'window') this.paintFav(re, '', 'window16');
    else this.paintFav(re, this.closedIcons.has(e.url) ? `page-icon:${e.url}` : '', 'globe16');
    re.title.replaceChildren(...marked(name, words));
    re.title.classList.toggle('bare', !e.title);
    re.addr.replaceChildren(el('span', {}, ...marked(addr, words)));
    re.time.replaceChildren(el('time', { datetime: f.isoLocal(e.closedAt) }, when));
    re.el.setAttribute('aria-label', `${name}, ${addr}, closed ${when}`);
    re.x.setAttribute('aria-label', `Remove ${name} from Recently closed`);
    setTip(re.el, e.kind === 'window' ? e.titles.join('\n') : `${name}\n${e.url}`);
  }

  /** Pages of closed tabs that have a favicon (asked once per open of the view). */
  private closedIcons = new Set<string>();

  private paintFav(re: RowEls, src: string, fallback: string): void {
    if (re.fav.dataset.src === src && re.fav.firstChild) return;
    re.fav.dataset.src = src;
    if (!src) {
      re.fav.replaceChildren(glyph(fallback));
      return;
    }
    const img = el('img', { src, alt: '', draggable: 'false' });
    img.addEventListener('error', () => {
      if (re.fav.dataset.src === src) re.fav.replaceChildren(glyph(fallback));
    });
    re.fav.replaceChildren(img);
  }

  private repaintRow(id: string): void {
    const re = this.rows.get(id);
    const ge = re && this.groups.get(re.groupId);
    if (!re || !ge) return;
    re.key = '';
    re.painted = null;
    const words = this.words();
    this.paintRow(re, words, words.join(' '), ge.group, this.store?.today() ?? f.dayStartOf(Date.now()));
  }

  /** aria-rowindex on every drawn stop; aria-rowcount once the end has loaded (-1 until then). */
  private paintIndexes(): void {
    const list = this.list;
    if (!list) return;
    const stops = this.stops();
    cancelAnimationFrame(this.indexJob);
    this.indexJob = 0;
    this.numberStops(0);
    const end = this.view === 'closed' || (this.store ? (this.store.shown ? this.store.searchEnd : this.store.atEnd) : true);
    list.setAttribute('aria-rowcount', end ? String(stops.length) : '-1');
    list.classList.toggle('pages', this.view === 'all');
    list.setAttribute('aria-multiselectable', String(this.view === 'all'));
    const q = this.view === 'closed' ? this.query : (this.store?.shown ?? '');
    list.setAttribute('aria-label', this.view === 'closed' ? (q ? `Recently closed, search results for ${q}` : 'Recently closed') : q ? `Search results for ${q}` : 'All history');
    // Roving focus: one stop takes Tab.
    const kept = this.currentStop();
    const current = kept && this.stopKey(kept) === this.stopId ? kept : (this.stopId && this.findStop(this.stopId)) || stops.find((s) => s.classList.contains('vh-row')) || stops[0] || null;
    this.rove(current);
  }

  /** aria-rowindex from stop `from` on; past INDEX_BUDGET writes the rest goes on in the next frame. */
  private numberStops(from: number): void {
    const stops = this.stops();
    let written = 0;
    for (let i = from; i < stops.length; i++) {
      if (this.rowIndex.get(stops[i]) === i + 1) continue;
      this.rowIndex.set(stops[i], i + 1);
      stops[i].setAttribute('aria-rowindex', String(i + 1));
      if (++written >= INDEX_BUDGET && i + 1 < stops.length) {
        this.indexJob = requestAnimationFrame(() => {
          this.indexJob = 0;
          this.numberStops(i + 1);
        });
        return;
      }
    }
  }

  /** Give the roving tab stop to `s` (tabindex 0); the stop that had it goes back to -1. */
  private rove(s: HTMLElement | null): void {
    if (this.tabStop !== s && this.tabStop?.hasAttribute('tabindex')) this.tabStop.tabIndex = -1;
    this.tabStop = s;
    if (s && s.tabIndex !== 0) s.tabIndex = 0;
  }

  /** The centred messages: empty, no match, unavailable (spec "Empty and other states"). */
  private paintMessage(groups: Group[]): void {
    const msg = this.msg;
    if (!msg) return;
    const s = this.store;
    let kind = '';
    if (this.view === 'closed') kind = groups.length ? '' : this.query ? 'nomatch-closed' : 'closed-empty';
    else if (s?.failed) kind = 'unavailable';
    else if (!s?.ready || this.loadingFresh) kind = '';
    else if (s.shown && !groups.length && !s.searching) kind = 'nomatch';
    else if (!s.shown && !groups.length && !s.query) kind = 'empty';
    // After everything is deleted the empty state shows once the collapse ends (spec "Empty and other states").
    window.clearTimeout(this.msgTimer);
    if ((kind === 'empty' || kind === 'closed-empty') && this.list?.querySelector('.leaving')) {
      this.msgTimer = window.setTimeout(() => this.paintMessage(this.model()), 400);
      return;
    }
    if (msg.dataset.kind === kind) return;
    msg.dataset.kind = kind;
    msg.hidden = !kind;
    const q = `“${this.view === 'closed' ? this.query : (s?.shown ?? '')}”`;
    const button = (label: string, run: () => void): HTMLButtonElement => {
      const btn = el('button', { type: 'button', class: 'vh-btn' }, label);
      btn.addEventListener('click', run);
      return btn;
    };
    if (kind === 'empty') msg.replaceChildren(el('p', {}, 'Pages you visit will show up here.'));
    else if (kind === 'closed-empty') msg.replaceChildren(el('p', {}, 'Tabs and windows you close show up here.'));
    else if (kind === 'nomatch' || kind === 'nomatch-closed')
      msg.replaceChildren(
        el('p', { class: 'strong' }, kind === 'nomatch' ? `No pages match ${q}.` : `No tabs or windows match ${q}.`),
        el('p', { class: 'small' }, 'Search looks in page titles and addresses.'),
        button('Clear search', () => {
          this.setQuery('', true);
          this.search?.focus();
        })
      );
    else if (kind === 'unavailable')
      msg.replaceChildren(
        el('p', { class: 'strong' }, 'History isn’t available right now.'),
        button('Try again', () => {
          void this.loadFresh(null);
        })
      );
    else msg.replaceChildren();
  }

  /** A visit added at the top of Today never moves what the person is looking at. */
  private keepStill(fn: () => void): void {
    const sc = this.scroller;
    if (!sc || sc.scrollTop <= 0) {
      fn();
      return;
    }
    const before = sc.scrollHeight;
    const top = sc.scrollTop;
    fn();
    sc.scrollTop = top + (sc.scrollHeight - before);
  }

  /**
   * A bulk change reloaded the loaded days (spec "Live"): the first visible row stays in place if it
   * still exists.
   */
  private keepFirst(fn: () => void): void {
    const sc = this.scroller;
    if (!sc || sc.scrollTop <= 0) {
      fn();
      return;
    }
    const box = sc.getBoundingClientRect();
    const drawn = this.stops()
      .map((s) => this.rows.get(s.dataset.id ?? ''))
      .filter((re): re is RowEls => !!re);
    const first = drawn.find((re) => re.item.page && re.el.getBoundingClientRect().bottom > box.top + 1);
    const key = first?.item.page ? `${first.item.page.guid}|${first.item.page.dayStart}` : '';
    const offset = first ? first.el.getBoundingClientRect().top - box.top : 0;
    fn();
    if (!key) return;
    const again = [...this.rows.values()].find((re) => re.item.page && `${re.item.page.guid}|${re.item.page.dayStart}` === key);
    if (again) sc.scrollTop += again.el.getBoundingClientRect().top - box.top - offset;
  }

  /** A deletion made elsewhere: the rows fade over 150 ms, without the collapse. */
  private fadeOut(): void {
    this.sync({ leave: 'fade' });
  }

  // ---- toolbar ----

  private paintToolbar(): void {
    if (!this.tbLines.length || this.private) return;
    const s = this.store;
    // A day delete whose pages are still being counted: the line it replaces stays until then (tens of ms).
    if (s?.pending?.kind === 'day' && s.pending.pages < 0) return;
    let kind: 'text' | 'sel' | 'undo' = 'text';
    let text = '';
    if (s?.pending) {
      kind = 'undo';
      text = this.undoText();
    } else if (this.sel.size && this.view === 'all') {
      kind = 'sel';
      text = this.allMatches ? `All ${f.count(this.sel.size)} matches selected` : `${f.count(this.sel.size)} selected`;
    } else if (this.view === 'closed') {
      const groups = this.model();
      const nt = groups.find((g) => g.kind === 'tabs')?.items.length ?? 0;
      const nw = groups.find((g) => g.kind === 'windows')?.items.length ?? 0;
      const parts = [nt ? f.plural(nt, 'tab', 'tabs') : '', nw ? f.plural(nw, 'window', 'windows') : ''].filter(Boolean).join(' and ');
      if (this.query) text = nt + nw ? `${parts} ${nt + nw === 1 ? 'matches' : 'match'} “${this.query}”` : '';
      else text = parts;
    } else if (s && (s.query || s.shown)) {
      if (this.searchingShown && s.searching) text = 'Searching…';
      else if (s.shown) {
        const m = s.matchCount;
        const n = m >= 0 ? m : s.results.reduce((a, d) => a + d.rows.filter((r) => !s.hides(r)).length, 0);
        text = n ? `${f.plural(n, 'page', 'pages')} ${n === 1 ? 'matches' : 'match'} “${s.shown}”` : '';
      }
    } else if (s?.summary && !s.failed && s.days.length) {
      text = `${f.plural(s.summary.pages, 'page', 'pages')} since ${f.longDate(s.summary.since)}`;
    }
    const key = `${kind}|${text}`;
    if (key === this.tbKey) return;
    this.tbKey = key;
    const old = this.tbLines[this.tbActive];
    this.tbActive = 1 - this.tbActive;
    const line = this.tbLines[this.tbActive];
    const hadFocus = old.contains(document.activeElement);
    line.className = `vh-tbline on ${kind}`;
    line.setAttribute('aria-hidden', 'false');
    const nodes: Node[] = [el('span', { class: 'vh-tbtext' }, text)];
    if (kind === 'sel') {
      const del = el('button', { type: 'button', class: 'vh-btn vh-tb-delete', 'aria-keyshortcuts': 'Delete' }, glyph('trash14'), 'Delete');
      del.addEventListener('click', () => this.deleteSelection());
      const clear = el('button', { type: 'button', class: 'vh-btn vh-tb-clear', 'aria-label': 'Clear selection', 'aria-keyshortcuts': 'Escape' }, glyph('close12'));
      setTip(clear, 'Clear selection', 'Esc');
      clear.addEventListener('click', () => this.clearSelection());
      nodes.push(del, clear);
    } else if (kind === 'undo') {
      const undo = el('button', { type: 'button', class: 'vh-btn vh-tb-undo', 'aria-keyshortcuts': 'Control+Z' }, 'Undo');
      setTip(undo, 'Undo', 'Ctrl+Z');
      undo.addEventListener('click', () => this.undo());
      nodes.push(undo);
    }
    line.replaceChildren(...nodes);
    old.className = 'vh-tbline';
    old.setAttribute('aria-hidden', 'true');
    // The old line's buttons go with it; focus that was on them moves to the new line or the list.
    window.setTimeout(() => {
      if (!old.classList.contains('on')) old.replaceChildren();
    }, 160);
    if (hadFocus) (line.querySelector<HTMLElement>('button') ?? this.currentStop() ?? this.search)?.focus();
  }

  private undoText(): string {
    const s = this.store!;
    const p = s.pending!;
    const today = s.today();
    if (p.kind === 'day') {
      // Every page the day lists, not only the matches its search-results heading showed.
      const d = f.dayLabel(p.days[0], today);
      const n = Math.max(0, p.pages);
      return d.label === 'Today' || d.label === 'Yesterday' ? `Deleted ${d.label}’s history (${f.plural(n, 'page', 'pages')}).` : `Deleted history from ${d.name} (${f.plural(n, 'page', 'pages')}).`;
    }
    const days = [...new Set(p.rows.map((r) => r.dayStart))];
    const from = days.length === 1 ? f.dayLabel(days[0], today).name : f.plural(days.length, 'day', 'days');
    if (p.rows.length === 1) return `Deleted “${f.quoteTitle(p.rows[0].title || f.bare(p.rows[0].url))}” from ${from}.`;
    return `Deleted ${f.count(p.rows.length)} pages from ${from}.`;
  }

  // ---- views and search ----

  private setView(view: View): void {
    if (this.private || view === this.view) return;
    this.clearSelection(true);
    this.view = view;
    if (view === 'closed') {
      this.closed?.read();
      void this.readClosedIcons();
    } else if (this.store && this.store.query !== this.query) void this.store.search(this.query);
    this.stopId = '';
    this.paintNav();
    this.paintSearch();
    this.clearRows();
    if (this.scroller) this.scroller.scrollTop = 0;
    this.sync();
    this.paintToolbar();
  }

  private paintNav(): void {
    if (!this.viewAll || !this.viewClosed) return;
    for (const [btn, v] of [[this.viewAll, 'all'], [this.viewClosed, 'closed']] as const) {
      const on = this.view === v;
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      btn.tabIndex = on ? 0 : -1;
    }
    const n = this.closed?.count ?? 0;
    if (this.closedCount) {
      this.closedCount.textContent = n ? f.count(n) : '';
      this.closedCount.hidden = !n;
    }
    this.viewClosed.setAttribute('aria-label', n ? `Recently closed, ${n}` : 'Recently closed');
  }

  private paintSearch(): void {
    if (!this.search) return;
    const ph = this.view === 'closed' ? 'Search recently closed' : 'Search history';
    this.search.placeholder = ph;
    this.search.setAttribute('aria-label', ph);
    const has = !!this.search.value;
    this.clearBtn!.hidden = !has;
    this.searchBox!.classList.toggle('has-text', has);
  }

  private onInput(): void {
    this.paintSearch();
    window.clearTimeout(this.searchTimer);
    // Nothing runs during IME composition (spec "Search").
    if ((this.search as any)?.isComposing) return;
    this.searchTimer = window.setTimeout(() => this.applyQuery(), SEARCH_DELAY);
  }

  /** Set the field (Clear search, Ctrl+H from the address field); `now` searches at once. */
  private setQuery(q: string, now: boolean): void {
    if (!this.search) return;
    this.search.value = q;
    this.paintSearch();
    window.clearTimeout(this.searchTimer);
    if (now) this.applyQuery();
  }

  private applyQuery(): void {
    const q = (this.search?.value ?? '').replace(/\s+/g, ' ').trim();
    if (q === this.query && (this.view === 'closed' || this.store?.query === q)) return;
    this.query = q;
    this.allMatches = false;
    if (this.view === 'closed') {
      this.sync();
      this.paintToolbar();
      this.announceFound();
      return;
    }
    if (!this.store) return;
    window.clearTimeout(this.searchingTimer);
    this.searchingShown = false;
    if (q) {
      this.searchingTimer = window.setTimeout(() => {
        this.searchingShown = true;
        this.paintToolbar();
      }, SEARCHING_AFTER);
    }
    void this.store.search(q);
  }

  /** Search results arrived (or the search ended): no motion on keystrokes. */
  private onResults(): void {
    const s = this.store;
    if (!s) return;
    if (!s.searching) {
      window.clearTimeout(this.searchingTimer);
      this.searchingShown = false;
    }
    const before = this.lastShown;
    this.lastShown = s.shown;
    if (before !== s.shown) {
      this.clearRows();
      if (this.scroller) this.scroller.scrollTop = 0;
      this.stopId = '';
    }
    this.sync();
    if (s.shown && !s.searching) this.announceFound();
  }

  private lastShown = '';

  private announceFound(): void {
    const m = this.store?.matchCount ?? -1;
    const n = this.view !== 'closed' && m >= 0 ? m : this.model().reduce((a, g) => a + g.items.length, 0);
    if (!this.query) return;
    this.announce(n ? `${f.plural(n, 'page', 'pages')} found` : 'No pages found');
  }

  private onScroll(): void {
    const sc = this.scroller;
    if (!sc || this.view !== 'all' || !this.store) return;
    if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - LOAD_AHEAD) return;
    if (this.store.shown) void this.store.searchMore();
    else void this.store.loadMore();
  }

  // ---- Recently closed ----

  private onClosedChanged(): void {
    const c = this.closed;
    if (!c) return;
    c.read();
    this.paintNav();
    if (this.view === 'closed') {
      // An entry reopened (Ctrl+Shift+T under the panel) or removed collapses out of the list.
      this.sync({ leave: 'collapse' });
      this.paintToolbar();
    }
  }

  private async readClosedIcons(): Promise<void> {
    const c = this.closed;
    if (!c || !c.tabs.length) return;
    try {
      const db = await gk.readDb();
      const urls = c.tabs.map((t) => t.url);
      const found = new Set<string>();
      for (let i = 0; i < urls.length; i += 200) {
        const chunk = urls.slice(i, i + 200);
        const params: Record<string, string> = {};
        chunk.forEach((u, j) => (params[`u${j}`] = u));
        const rows = await db.execute(
          `SELECT h.url FROM moz_places h WHERE h.url IN (${chunk.map((_, j) => `:u${j}`).join(',')})
             AND (EXISTS (SELECT 1 FROM moz_pages_w_icons pi WHERE pi.page_url_hash = hash(h.url) AND pi.page_url = h.url)
               OR EXISTS (SELECT 1 FROM moz_icons i WHERE i.fixed_icon_url_hash = hash(fixup_url(get_host_and_port(h.url)) || '/favicon.ico') AND i.root = 1))`,
          params
        );
        for (const r of rows) found.add(String(r.getResultByName('url')));
      }
      this.closedIcons = found;
      for (const re of this.rows.values()) re.key = '';
      if (this.view === 'closed') this.sync();
    } catch {
      /* globes stay */
    }
  }

  // ---- selection (spec "Selection") ----

  private rowOf(id: string): Row | null {
    return this.rows.get(id)?.item.page ?? null;
  }

  private toggleRow(id: string): void {
    if (!this.rowOf(id)) return;
    if (this.sel.has(id)) this.sel.delete(id);
    else this.sel.add(id);
    this.anchor = id;
    this.allMatches = false;
    this.afterSelection();
  }

  /** The rows between two rows, in list order (headings are not rows). */
  private rangeIds(a: string, z: string): string[] {
    const ids = this.stops()
      .filter((s) => s.classList.contains('vh-row'))
      .map((s) => s.dataset.id ?? '');
    const i = ids.indexOf(a);
    const j = ids.indexOf(z);
    if (i < 0 || j < 0) return [z];
    return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
  }

  private selectRange(id: string): void {
    const from = this.anchor && this.rows.has(this.anchor) ? this.anchor : id;
    this.sel = new Set(this.rangeIds(from, id).filter((x) => this.rowOf(x)));
    this.allMatches = false;
    this.afterSelection();
  }

  private toggleDay(groupId: string): void {
    const ge = this.groups.get(groupId);
    if (!ge || ge.group.kind !== 'day') return;
    const ids = ge.group.items.map((i) => i.id);
    const all = ids.every((id) => this.sel.has(id));
    for (const id of ids) {
      if (all) this.sel.delete(id);
      else this.sel.add(id);
    }
    this.anchor = ids[0] ?? this.anchor;
    this.allMatches = false;
    this.afterSelection();
  }

  private selectAllMatches(): void {
    if (!this.store?.shown) return;
    for (const g of this.model()) for (const it of g.items) this.sel.add(it.id);
    this.allMatches = true;
    this.afterSelection();
  }

  /** Esc, the toolbar's ×, a delete or a close. */
  private clearSelection(quiet = false): void {
    if (!this.sel.size) return;
    this.sel.clear();
    this.allMatches = false;
    if (quiet) {
      this.paintSelection();
      return;
    }
    this.afterSelection();
  }

  private afterSelection(): void {
    this.paintSelection();
    this.paintToolbar();
    if (this.sel.size) this.announce(this.allMatches ? `All ${this.sel.size} matches selected` : `${this.sel.size} selected`);
  }

  private paintSelection(): void {
    const list = this.list;
    if (!list) return;
    for (const id of [...this.sel]) if (!this.rows.has(id)) this.sel.delete(id);
    list.classList.toggle('selmode', this.sel.size > 0 && this.view === 'all');
    // Only rows and headings whose state changed are touched.
    for (const [id, re] of this.rows) {
      const on = this.sel.has(id);
      if (re.sel === on) continue;
      re.sel = on;
      if (re.item.page) re.el.setAttribute('aria-selected', String(on));
      re.cb.classList.toggle('on', on);
    }
    for (const ge of this.groups.values()) {
      let n = 0;
      if (this.sel.size) for (const it of ge.group.items) if (this.sel.has(it.id)) n++;
      const mark = !n ? '' : n === ge.group.items.length ? 'on' : 'mixed';
      if (ge.mark === mark) continue;
      ge.mark = mark;
      ge.cb.classList.toggle('on', mark === 'on');
      ge.cb.classList.toggle('mixed', mark === 'mixed');
    }
  }

  // ---- deletes and undo (spec "Deleting, and undo") ----

  private deleteRowsById(ids: string[]): void {
    const s = this.store;
    if (!s) return;
    const rows = ids.map((id) => this.rowOf(id)).filter((r): r is Row => !!r);
    if (!rows.length) return;
    const focusAfter = this.nextStopAfter(ids);
    this.acting = true;
    try {
      this.stopUndo();
      s.deleteRows(rows);
    } finally {
      this.acting = false;
    }
    this.sel.clear();
    this.allMatches = false;
    this.sync({ leave: 'collapse' });
    this.afterDelete(focusAfter);
  }

  private deleteSelection(): void {
    this.deleteRowsById([...this.sel]);
  }

  private deleteDay(groupId: string): void {
    const ge = this.groups.get(groupId);
    const s = this.store;
    if (!ge || !s || ge.group.dayStart === undefined) return;
    const focusAfter = this.nextStopAfter(ge.group.items.map((i) => i.id), groupId);
    this.acting = true;
    try {
      this.stopUndo();
      s.deleteDay(ge.group.dayStart);
    } finally {
      this.acting = false;
    }
    this.sel.clear();
    this.allMatches = false;
    this.sync({ leave: 'collapse' });
    this.afterDelete(focusAfter);
  }

  private afterDelete(focusAfter: string): void {
    this.paintToolbar();
    const s = this.store;
    if (!s?.pending) return;
    this.announceDelete();
    this.armUndo();
    // Keyboard focus stays in the list, on the stop after the deleted ones.
    if (this.list?.contains(document.activeElement) || document.activeElement === document.body) {
      const next = (focusAfter && this.findStop(focusAfter)) || this.stops()[0];
      if (next) this.focusStop(next, false);
      else this.search?.focus();
    }
  }

  /** Narrator hears the undo line, then "Undo with Control+Z." (a day being counted: once it is counted). */
  private announceDelete(): void {
    const p = this.store?.pending ?? null;
    this.countWait = p?.kind === 'day' && p.pages < 0 ? p : null;
    if (p && !this.countWait) this.announce(`${this.undoText()} Undo with Control+Z.`);
  }

  /** The stop to focus once these rows (and that heading) are gone. */
  private nextStopAfter(ids: string[], groupId?: string): string {
    const gone = new Set(ids);
    const stops = this.stops();
    const at = stops.findIndex((s) => gone.has(s.dataset.id ?? '') || (groupId && s.dataset.group === groupId));
    const keep = (s: HTMLElement): boolean => !gone.has(s.dataset.id ?? '') && !(groupId && s.dataset.group === groupId);
    const after = stops.slice(Math.max(0, at)).find(keep) ?? stops.slice(0, Math.max(0, at)).reverse().find(keep);
    return after ? this.stopKey(after) : '';
  }

  private undo(): void {
    const s = this.store;
    if (!s?.pending) return;
    this.stopUndo();
    this.acting = true;
    let p: Pending | null = null;
    try {
      p = s.undo();
    } finally {
      this.acting = false;
    }
    if (!p) return;
    this.countWait = null;
    // The rows come back from memory, even when the list was read again meanwhile (a peek, a bulk
    // change). A fresh row of a page visited again while pending folds into the restored one.
    this.sync({ expand: true, leave: 'fade' });
    this.paintToolbar();
    // Focus on the first restored row in list order.
    const keys = new Set(p.rows.map((r) => `r|${r.guid}|${r.dayStart}`));
    const first = this.stops().find((x) => x.classList.contains('vh-row') && keys.has(this.stopKey(x)));
    if (first) this.focusStop(first, false);
    this.announce(`Restored ${f.plural(p.kind === 'day' && p.pages >= 0 ? p.pages : p.rows.length, 'page', 'pages')}`);
  }

  /** The line stays 10 s, paused while pointed at or focused; with assistive technology running, until the next action. */
  private armUndo(): void {
    window.clearTimeout(this.undoTimer);
    this.undoLeft = this.undoMs;
    this.undoStarted = performance.now();
    this.undoHeld = false;
    const at = this.assistive ?? gk.assistiveTech();
    if (at) return;
    this.undoTimer = window.setTimeout(() => this.undoExpired(), this.undoLeft);
  }

  private holdUndo(on: boolean): void {
    if (!this.store?.pending || on === this.undoHeld || !this.undoTimer) {
      this.undoHeld = on && !!this.store?.pending;
      return;
    }
    this.undoHeld = on;
    if (on) {
      window.clearTimeout(this.undoTimer);
      this.undoLeft -= performance.now() - this.undoStarted;
    } else {
      this.undoStarted = performance.now();
      this.undoTimer = window.setTimeout(() => this.undoExpired(), Math.max(1000, this.undoLeft));
    }
  }

  private undoExpired(): void {
    this.undoTimer = 0;
    if (this.undoHeld) return;
    void this.commit();
  }

  private stopUndo(): void {
    window.clearTimeout(this.undoTimer);
    this.undoTimer = 0;
    this.undoHeld = false;
  }

  // ---- opening (spec "Opening a row") ----

  /** A gesture on a row by id: a page row opens, a closed row reopens. */
  private activate(id: string, where: Where): void {
    const re = this.rows.get(id);
    if (!re) return;
    if (re.item.closed) {
      if (where === 'background' || where === 'here' || where === 'tab') this.restoreClosed(re.item.closed, where === 'background');
      return;
    }
    if (re.item.page) this.openRow(re.item.page, where);
  }

  private openRow(r: Row, where: Where): void {
    const url = r.url;
    const file = /^file:/i.test(url);
    const peek = this.b.service('peek');
    if (where === 'peek' && (file || !peek || !/^https?:/i.test(url))) where = 'here';
    if (where === 'peek') {
      this.peekRow(r);
      return;
    }
    // Opening any page commits a pending delete first, so the new visit survives the commit.
    void this.commit();
    switch (where) {
      case 'here': {
        const t = this.b.active();
        if (!t) return;
        // A peek already open on the tab warm-closes first.
        if (peek?.isOpen()) peek.close();
        this.close('page');
        this.b.navigate(t, url);
        this.b.focusPage();
        break;
      }
      case 'background':
        this.b.newTab(url, { background: true });
        this.wash(r.id);
        this.announce('Opened in a new tab');
        break;
      case 'tab':
        this.close('page');
        this.b.newTab(url);
        break;
      case 'window':
      case 'private':
        this.b.openWindow(url, { private: where === 'private' });
        break;
    }
  }

  /** The accent wash on a row, fading over 900 ms (History draws it). */
  private wash(id: string): void {
    const re = this.rows.get(id);
    if (!re) return;
    re.el.classList.add('washed');
    void re.el.offsetWidth;
    requestAnimationFrame(() => re.el.classList.remove('washed'));
  }

  /**
   * Reopen a closed tab with its back history, in this window where Ctrl+Shift+T would put it, and
   * switch to it (the panel closes); in the background the panel stays. A window reopens whole and
   * comes to the front.
   */
  private restoreClosed(e: ClosedEntry, background: boolean): void {
    const prev = this.b.active();
    if (e.kind === 'window') {
      this.close('stay');
      this.closed?.restore(e);
      return;
    }
    this.closed?.restore(e);
    if (background) {
      if (prev) this.b.activate(prev);
      this.reclaimFocus();
      this.announce(`Reopened ${e.title || f.hostOf(e.url)}`);
    } else this.close('page');
  }

  private forgetClosed(e: ClosedEntry): void {
    const ids = [e.id];
    const after = this.nextStopAfter(ids);
    this.closed?.forget(e);
    this.announce('Removed from Recently closed');
    const next = after && this.findStop(after);
    if (next) this.focusStop(next, false);
  }

  // ---- Peek from a row (spec "Peek from a row") ----

  private peekRow(r: Row): void {
    const peek = this.b.service('peek');
    const re = this.rows.get(r.id);
    const tab = this.b.active();
    if (!peek || !re || !tab) return;
    const box = re.el.getBoundingClientRect();
    this.stopPeekWatch();
    this.close('peek');
    const listen = (ev: Event): void => {
      const phase = (ev as CustomEvent).detail?.phase;
      if (phase === 'promoting') {
        // Opened as a tab: History does not come back (Ctrl+H within 60 s brings it back warm).
        this.stopPeekWatch();
        this.peekEnded();
      } else if (phase === 'closing' || phase === 'closed') {
        const back = this.peekBack;
        this.stopPeekWatch();
        if (back && this.b.activeId === back.tabId && !this.openNow) this.comeBack(back.rowKey);
        else this.peekEnded();
      }
    };
    peek.open(r.url, { origin: { x: box.left, y: box.top, width: box.width, height: box.height }, noWash: true });
    // Listened to only once this peek is up: opening it ends a peek still closing, whose 'closed'
    // must not bring History back.
    if (!peek.isOpen()) {
      // No sheet came (Peek refused the address): History comes back as it was.
      this.show();
      return;
    }
    this.peekBack = { rowKey: `${r.guid}|${r.dayStart}`, tabId: tab.id, listen };
    window.addEventListener('vitre:peek', listen);
  }

  private stopPeekWatch(): void {
    if (!this.peekBack) return;
    window.removeEventListener('vitre:peek', this.peekBack.listen);
    this.peekBack = null;
  }

  /** The peek ended without History coming back: what the stepped-aside panel still held goes. */
  private peekEnded(): void {
    if (this.openNow) return;
    this.stopUndo();
    void this.store?.commit();
    this.store?.watch(false);
    this.closed?.watch(null);
    this.clearRows();
  }

  /** The peek was put back: History reopens warm, and that row gets the wash and keyboard focus. */
  private comeBack(rowKey: string): void {
    const pending = !!this.store?.pending;
    this.show();
    const find = (): RowEls | undefined => [...this.rows.values()].find((re) => re.item.page && `${re.item.page.guid}|${re.item.page.dayStart}` === rowKey);
    const land = (tries: number): void => {
      if (!this.openNow) return;
      const re = find();
      if (re) {
        this.focusStop(re.el, false);
        this.wash(re.item.id);
      } else if (tries > 0) window.setTimeout(() => land(tries - 1), 60);
    };
    window.setTimeout(() => land(10), 0);
    if (pending && this.store?.pending) {
      // The undo line kept its timer running while the peek was up.
      this.paintToolbar();
    }
  }

  // ---- Clear browsing data ----

  private openClearData(): void {
    void this.commit();
    // Settings opens at Privacy › Clear browsing data, as Ctrl+Shift+Delete does; History steps aside.
    this.b.run('clearData');
  }

  // ---- menus (spec "Menus") ----

  private onContextMenu(e: MouseEvent): void {
    const target = e.target as Element;
    const row = target.closest<HTMLElement>('.vh-row');
    const head = target.closest<HTMLElement>('.vh-head');
    if (!row && !head) return;
    e.preventDefault();
    const menus = this.b.service('menus');
    if (!menus) return;
    // Shift+F10 and the Menu key arrive as button 0 (WM_CONTEXTMENU), the mouse as button 2 (menus/index.ts).
    const keyboard = e.button === 0;
    const owner = row ?? head!;
    if (keyboard) this.focusStop(owner, false);
    const at = keyboard ? owner : { x: e.clientX, y: e.clientY };
    const opts = { keyboard, owner, gap: 4, label: 'History', onClose: () => owner.classList.remove('pressed') };
    owner.classList.add('pressed');
    if (row) {
      const id = row.dataset.id ?? '';
      const re = this.rows.get(id);
      if (!re) return;
      if (re.item.closed) menus.show(this.closedMenu(re.item.closed), at, opts);
      else if (this.sel.has(id)) menus.show(this.selectionMenu(), at, opts);
      else if (re.item.page) menus.show(this.rowMenu(re.item.page), at, opts);
    } else if (head) {
      const g = this.groups.get(head.dataset.group ?? '');
      if (g?.group.kind === 'day') menus.show(this.dayMenu(g), at, opts);
      else owner.classList.remove('pressed');
    }
  }

  private rowMenu(r: Row): VitreMenuItem[] {
    const peekable = !!this.b.service('peek') && /^https?:/i.test(r.url);
    const peekKey = this.b.settings.shiftClick === 'peek' ? 'Shift+click' : this.b.settings.rebind?.peekLink || 'Ctrl+Q';
    const items: VitreMenuItem[] = [
      { label: 'Open in new tab', icon: 'newtab', access: 'T', run: () => this.openRow(r, 'background') },
    ];
    if (peekable) items.push({ label: 'Peek', icon: 'peek', key: peekKey, access: 'P', run: () => this.openRow(r, 'peek') });
    items.push(
      { label: 'Open in new window', icon: 'newwindow', access: 'W', run: () => this.openRow(r, 'window') },
      { label: 'Open in new private window', icon: 'newwindow', access: 'R', run: () => this.openRow(r, 'private') },
      { separator: true },
      { label: 'Copy address', icon: 'link', access: 'A', run: () => gk.copyText(r.url) },
      { separator: true },
      { label: 'Delete from history', icon: 'close', key: 'Delete', access: 'D', run: () => this.deleteRowsById([r.id]) }
    );
    return items;
  }

  /** The selection's pages, each address once, in list order. */
  private selectedUrls(): string[] {
    const out: string[] = [];
    for (const s of this.stops()) {
      const id = s.dataset.id ?? '';
      if (!this.sel.has(id)) continue;
      const r = this.rowOf(id);
      if (r && !out.includes(r.url)) out.push(r.url);
    }
    return out;
  }

  private selectionMenu(): VitreMenuItem[] {
    const urls = this.selectedUrls();
    const n = urls.length;
    const rows = this.sel.size;
    const tooMany = n > OPEN_MAX;
    const pages = (k: number): string => (k === 1 ? '1 page' : `${f.count(k)} pages`);
    return [
      { label: n === 1 ? 'Open 1 page in a new tab' : `Open ${pages(n)} in new tabs`, icon: 'newtab', access: 'T', key: tooMany ? `${OPEN_MAX} at most` : undefined, disabled: tooMany, run: () => this.openMany(urls, 'tabs') },
      { label: `Open ${pages(n)} in a new window`, icon: 'newwindow', access: 'W', key: tooMany ? `${OPEN_MAX} at most` : undefined, disabled: tooMany, run: () => this.openMany(urls, 'window') },
      { separator: true },
      { label: n === 1 ? 'Copy 1 address' : `Copy ${f.count(n)} addresses`, icon: 'link', access: 'A', run: () => gk.copyText(urls.join('\n')) },
      { separator: true },
      { label: `Delete ${pages(rows)} from history`, icon: 'close', key: 'Delete', access: 'D', run: () => this.deleteSelection() },
    ];
  }

  private openMany(urls: string[], how: 'tabs' | 'window'): void {
    void this.commit();
    if (how === 'window') {
      gk.openWindowWith(urls, false);
      return;
    }
    for (const url of urls) this.b.newTab(url, { background: true });
    for (const id of this.sel) this.wash(id);
    this.announce(urls.length === 1 ? 'Opened in a new tab' : `Opened in ${urls.length} new tabs`);
  }

  private dayMenu(ge: GroupEls): VitreMenuItem[] {
    return [
      { label: 'Select this day', access: 'S', run: () => this.selectDay(ge.group.id) },
      { label: 'Delete this day’s history', icon: 'close', key: 'Delete', access: 'D', run: () => this.deleteDay(ge.group.id) },
    ];
  }

  private selectDay(groupId: string): void {
    const ge = this.groups.get(groupId);
    if (!ge) return;
    for (const it of ge.group.items) this.sel.add(it.id);
    this.allMatches = false;
    this.afterSelection();
  }

  private closedMenu(e: ClosedEntry): VitreMenuItem[] {
    if (e.kind === 'window') {
      return [
        { label: 'Reopen window', access: 'R', key: e.next ? 'Ctrl+Shift+T' : undefined, run: () => this.restoreClosed(e, false) },
        { separator: true },
        { label: 'Remove from list', icon: 'close', key: 'Delete', access: 'L', run: () => this.forgetClosed(e) },
      ];
    }
    return [
      { label: 'Reopen tab', access: 'R', key: e.next ? 'Ctrl+Shift+T' : undefined, run: () => this.restoreClosed(e, false) },
      { label: 'Copy address', icon: 'link', access: 'A', run: () => gk.copyText(e.url) },
      { separator: true },
      { label: 'Remove from list', icon: 'close', key: 'Delete', access: 'L', run: () => this.forgetClosed(e) },
    ];
  }

  // ---- mouse ----

  private onListClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const row = target.closest<HTMLElement>('.vh-row');
    if (row && !row.classList.contains('leaving')) {
      const id = row.dataset.id ?? '';
      const re = this.rows.get(id);
      if (!re) return;
      if (target.closest('.vh-x')) {
        if (re.item.closed) this.forgetClosed(re.item.closed);
        else this.deleteRowsById([id]);
        return;
      }
      // Only the checkbox selects; the row body keeps its link gestures (spec "Selection").
      if (target.closest('.vh-slot') && re.item.page) {
        if (e.shiftKey) this.selectRange(id);
        else this.toggleRow(id);
        return;
      }
      if (e.detail > 1) return; // the second click of a double-click: the first one opened it
      this.activate(id, this.whereFor(e, re));
      return;
    }
    const head = target.closest<HTMLElement>('.vh-head');
    if (head && !head.closest('.leaving')) {
      const gid = head.dataset.group ?? '';
      if (target.closest('.vh-hdel')) this.deleteDay(gid);
      else if (target.closest('.vh-hcb') && this.sel.size) this.toggleDay(gid);
    }
  }

  /** Click, Ctrl+click, Ctrl+Shift+click, Shift+click and Alt+click on a row (spec "Opening a row"). */
  private whereFor(e: MouseEvent | KeyboardEvent, re: RowEls): Where {
    if (e.ctrlKey && e.shiftKey) return 'tab';
    if (e.ctrlKey) return 'background';
    if (e.shiftKey) {
      if (re.item.closed) return 'here';
      return this.b.settings.shiftClick === 'window' ? 'window' : 'peek';
    }
    return 'here';
  }

  // ---- keys (spec "Keys") ----

  private onSheetKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      this.trapTab(e);
      return;
    }
    if (this.private) return;
    const inField = e.target === this.search;
    // Ctrl+Z: undo the last delete while its line shows, in the list and the sidebar, never in the field.
    if (!inField && e.ctrlKey && !e.shiftKey && !e.altKey && e.keyCode === 90) {
      e.preventDefault();
      if (!e.repeat) this.undo();
      return;
    }
    if (this.list?.contains(e.target as Node)) this.onListKey(e);
  }

  private onSearchKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      // One step per keydown: the selection, the field's text, then the panel.
      if (this.sel.size) this.clearSelection();
      else if (this.search!.value) this.setQuery('', true);
      else this.close();
    } else if ((e.key === 'ArrowDown' || e.key === 'Enter') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Down or Enter moves to the first result; Enter never opens a page from the field.
      e.preventDefault();
      if (e.key === 'Enter') this.applyQuery();
      const first = this.stops().find((s) => s.classList.contains('vh-row')) ?? this.stops()[0];
      if (first) this.focusStop(first, true);
    }
  }

  private onListKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const cur = (e.target as Element).closest<HTMLElement>('.vh-row, .vh-head');
    if (!cur) return;
    const stops = this.stops();
    const i = stops.indexOf(cur);
    const ctrl = e.ctrlKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const id = cur.dataset.id ?? '';
    const re = this.rows.get(id);
    const go = (j: number, extend: boolean): void => {
      const target = stops[Math.max(0, Math.min(stops.length - 1, j))];
      if (!target) return;
      this.focusStop(target, true);
      if (extend && this.view === 'all') {
        const tid = target.dataset.id ?? '';
        if (!this.anchor || !this.rows.has(this.anchor)) this.anchor = id || tid;
        if (this.rowOf(tid)) this.selectRange(tid);
      }
      if (j >= stops.length - 1) this.onScroll();
    };
    const key = e.key;
    let used = true;
    if (key === 'ArrowDown' && ctrl && !alt) go(this.headAfter(stops, i, 1), false);
    else if (key === 'ArrowUp' && ctrl && !alt) go(this.headAfter(stops, i, -1), false);
    else if (key === 'ArrowDown' && !ctrl && !alt) go(i + 1, shift);
    else if (key === 'ArrowUp' && !ctrl && !alt) go(i - 1, shift);
    else if (key === 'Home' && !ctrl && !alt) go(0, shift);
    else if (key === 'End' && !ctrl && !alt) {
      go(stops.length - 1, shift);
      // Reaching the end loads more.
      if (this.view === 'all' && this.store) void (this.store.shown ? this.store.searchMore() : this.store.loadMore());
    } else if (key === 'PageDown' && !ctrl && !alt) go(i + PAGE_STEP, shift);
    else if (key === 'PageUp' && !ctrl && !alt) go(i - PAGE_STEP, shift);
    else if (key === 'Enter' && !e.repeat) {
      if (!re) used = cur.classList.contains('vh-head');
      else if (alt && !ctrl && !shift) this.activate(id, re.item.closed ? 'here' : 'tab');
      else if (ctrl && !alt && !shift) this.activate(id, 'background');
      else if (shift && !ctrl && !alt) this.activate(id, re.item.closed ? 'here' : this.b.settings.shiftClick === 'window' ? 'window' : 'peek');
      else if (!ctrl && !alt && !shift) this.activate(id, 'here');
      else used = false;
    } else if (key === 'q' || key === 'Q' || e.keyCode === 81) {
      // Ctrl+Q always peeks (taken here, before the router's page-first peekLink).
      if (ctrl && !alt && !shift && re?.item.page && !e.repeat) this.openRow(re.item.page, 'peek');
      else used = ctrl && !alt;
    } else if (key === ' ' && !ctrl && !alt) {
      if (this.view !== 'all') used = false;
      else if (cur.classList.contains('vh-head')) this.toggleDay(cur.dataset.group ?? '');
      else if (shift) this.selectRange(id);
      else this.toggleRow(id);
    } else if ((key === 'Delete' || key === 'Del') && !ctrl && !alt && !e.repeat) {
      if (this.view === 'closed') {
        if (re?.item.closed) this.forgetClosed(re.item.closed);
      } else if (this.sel.size) this.deleteSelection();
      else if (cur.classList.contains('vh-head')) this.deleteDay(cur.dataset.group ?? '');
      else if (re) this.deleteRowsById([id]);
    } else if (ctrl && !alt && !shift && e.keyCode === 65) {
      // Ctrl+A selects every match, in search results only.
      if (this.view === 'all' && this.store?.shown) this.selectAllMatches();
    } else if (ctrl && !alt && !shift && e.keyCode === 67) {
      const urls = this.sel.size ? this.selectedUrls() : re?.item.page ? [re.item.page.url] : re?.item.closed?.url ? [re.item.closed.url] : [];
      if (urls.length) gk.copyText(urls.join('\n'));
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** The heading before or after a stop (Ctrl+Up / Ctrl+Down). */
  private headAfter(stops: HTMLElement[], i: number, dir: 1 | -1): number {
    for (let j = i + dir; j >= 0 && j < stops.length; j += dir) if (stops[j].classList.contains('vh-head')) return j;
    return i;
  }

  // ---- focus ----

  /**
   * The list's stops in drawn order: day headings and rows, never one that is leaving (rows that
   * leave are out of the model, and rows built hidden for Undo's expand open in the same sync). Read
   * from the groups the last sync drew (not a selector over every node), and kept until it changes.
   */
  private stops(): HTMLElement[] {
    if (this.stopsCache) return this.stopsCache;
    const out: HTMLElement[] = [];
    for (const g of this.drawn) {
      const ge = this.groups.get(g.id);
      if (!ge) continue;
      out.push(ge.head);
      for (const it of g.items) {
        const re = this.rows.get(it.id);
        if (re) out.push(re.el);
      }
    }
    this.stopsCache = out;
    return out;
  }

  /** A drawn stop that is not leaving. */
  private isLive(s: HTMLElement): boolean {
    if (!s.isConnected || s.classList.contains('leaving') || !this.list?.contains(s)) return false;
    const g = s.closest('.vh-group');
    return !!g && !g.classList.contains('leaving');
  }

  private stopKey(s: HTMLElement): string {
    if (s.classList.contains('vh-head')) {
      const g = this.groups.get(s.dataset.group ?? '');
      return g?.group.dayStart !== undefined ? `h|${g.group.dayStart}` : `h|${s.dataset.group}`;
    }
    const re = this.rows.get(s.dataset.id ?? '');
    if (re?.item.page) return `r|${re.item.page.guid}|${re.item.page.dayStart}`;
    return `c|${s.dataset.id}`;
  }

  /** The drawn stop with this key (stopKey), looked up through its group, not across every stop. */
  private findStop(key: string): HTMLElement | null {
    const [kind, a, b] = key.split('|');
    const drawn = (el: HTMLElement | undefined): HTMLElement | null => (el && this.isLive(el) ? el : null);
    if (kind === 'c') return drawn(this.rows.get(a)?.el);
    // h|<day> or h|<group id>; r|<guid>|<day>. A day's group is gd<day> in All history and gs<day> in
    // search results; Tabs and Windows go by their ids.
    const day = kind === 'r' ? b : a;
    const ge = /^\d+$/.test(day) ? (this.groups.get(`gd${day}`) ?? this.groups.get(`gs${day}`)) : this.groups.get(day);
    if (!ge) return null;
    if (kind === 'h') return drawn(ge.head);
    const it = ge.group.items.find((x) => x.page?.guid === a);
    return it ? drawn(this.rows.get(it.id)?.el) : null;
  }

  private currentStop(): HTMLElement | null {
    return this.tabStop && this.isLive(this.tabStop) ? this.tabStop : null;
  }

  private setStop(s: HTMLElement): void {
    this.stopId = this.stopKey(s);
    this.rove(s);
  }

  /** Move keyboard focus to a stop; jumps are instant, never smoothed (spec "Motion"). */
  private focusStop(s: HTMLElement, keyboard: boolean): void {
    this.setStop(s);
    s.focus({ focusVisible: keyboard } as FocusOptions);
    s.scrollIntoView({ block: 'nearest' });
  }

  private focusInitial(fresh = false): void {
    requestAnimationFrame(() => {
      if (!this.openNow) return;
      if (this.private) {
        this.closeBtn.focus();
        return;
      }
      // Focus starts in the search field, its warm query selected.
      if (fresh || !this.sheet.contains(document.activeElement)) {
        this.search?.focus();
        this.search?.select();
      }
    });
  }

  /** Tab order: search, views, Clear browsing data…, the toolbar's buttons, the list (one stop), Close. */
  private trapTab(e: KeyboardEvent): void {
    e.preventDefault();
    const order: HTMLElement[] = [];
    if (!this.private) {
      if (this.search) order.push(this.search);
      const view = this.view === 'all' ? this.viewAll : this.viewClosed;
      if (view) order.push(view);
      if (this.clearData) order.push(this.clearData);
      const line = this.tbLines[this.tbActive];
      if (line?.classList.contains('on')) order.push(...line.querySelectorAll<HTMLElement>('button'));
      const stop = this.currentStop();
      if (stop) order.push(stop);
      else if (this.msg && !this.msg.hidden) order.push(...this.msg.querySelectorAll<HTMLElement>('button'));
    }
    order.push(this.closeBtn);
    const at = document.activeElement as HTMLElement | null;
    let i = order.findIndex((x) => x === at || (x.classList.contains('vh-row') || x.classList.contains('vh-head') ? !!at && this.list?.contains(at) : false));
    if (i < 0 && at && this.list?.contains(at)) i = order.findIndex((x) => x.classList.contains('vh-row') || x.classList.contains('vh-head'));
    const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
    if (next.classList.contains('vh-row') || next.classList.contains('vh-head')) this.focusStop(next, true);
    else next.focus();
  }

  private isBeneath(t: HTMLElement): boolean {
    const layer = t.closest<HTMLElement>('.module-layer');
    return !layer || Number(layer.style.zIndex || 0) < PANEL_Z;
  }

  private reclaimFocus(): void {
    const pull = (): void => {
      const at = document.activeElement as HTMLElement | null;
      if (!this.openNow || (at && (this.sheet.contains(at) || (at !== document.body && at !== document.documentElement && !this.isBeneath(at))))) return;
      const back = this.lastInside;
      (back && this.sheet.contains(back) && back.isConnected ? back : this.private ? this.closeBtn : (this.currentStop() ?? this.search ?? this.closeBtn))?.focus();
    };
    pull();
    window.setTimeout(pull, 60);
  }

  /** Focus where it was before the panel opened, if that is still on screen; else the page. */
  private focusBack(t: HTMLElement | null): void {
    let usable = false;
    try {
      usable = !!t && t.isConnected && !this.sheet.contains(t) && t.checkVisibility({ visibilityProperty: true } as any);
      if (usable && t?.localName === 'browser') usable = t === this.b.active()?.browser || t === window.vitrePeek?.browser?.();
    } catch {
      usable = false;
    }
    if (usable) t!.focus();
    else this.b.focusPage();
  }

  // ---- announcements (polite, debounced 500 ms) ----

  private announce(text: string): void {
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      // A trailing no-break space makes the same words heard again.
      this.live.textContent = this.live.textContent === text ? `${text} ` : text;
    }, 500);
  }

  /** The last text announced (tests). */
  get announced(): string {
    return (this.live?.textContent ?? '').replace(/ $/, '');
  }

  // ---- midnight ----

  /** At midnight the headings relabel in place ("Today" becomes "Yesterday"). */
  private armMidnight(): void {
    window.clearTimeout(this.midnightTimer);
    const s = this.store;
    if (!s) return;
    const now = s.clock();
    const wait = Math.max(1000, f.nextDayStart(f.dayStartOf(now)) - now + 50);
    this.midnightTimer = window.setTimeout(() => this.midnight(), Math.min(wait, 2 ** 31 - 1));
  }

  /** Relabel the headings for a new day (the midnight timer; tests call it after moving the clock). */
  midnight(): void {
    if (!this.openNow) return;
    for (const re of this.rows.values()) {
      re.key = '';
      re.painted = null;
    }
    this.sync();
    this.armMidnight();
  }
}

/** A menu row as the 'menus' service takes it (menus/types.ts MenuItem), without importing that module. */
type VitreMenuItem = Parameters<VitreServices['menus']['show']>[0][number];
