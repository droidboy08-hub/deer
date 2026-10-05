// Address and search: the active pill opens into a 640x48 glass field (grown from the pill in
// 240 ms) with a frosted suggestion panel under it. Ported from app/src/renderer/omnibox.ts; the
// look is skin/omnibox.css, history comes from Places (./places.ts).
//
// Keys inside the field (design/keymap.json, "Address and search"; all local, the field takes
// them on keydown so the key router never sees them):
//   Enter            go to the highlighted row, or to what was typed (an address, or a search with
//                    the engine from Settings); on a "Switch to tab" row, switch to that tab
//   Alt+Enter        the same, in a new tab
//   Ctrl+Enter       add www. and .com to a bare word, then go
//   Shift+Enter      peek it when Peek is installed (window.vitrePeek), otherwise like Enter
//   Up / Down        move through the rows
//   Shift+Delete     remove a history row, only one the user moved onto (otherwise it stays Cut)
//   Esc              first press puts the address back and closes the suggestions; the next one
//                    closes the field and returns focus to the page
//   Tab / Shift+Tab  leave for the rest of the tab bar (handlers.tabOut)
// Every other bound key (Ctrl+T, Ctrl+L, F6, zoom...) goes through the router as usual.
//
// For other authors
//   b.omni.open                 the field is showing
//   b.omni.show(rect, tab, { query })   what b.editAddress(query?) calls
//   b.omni.close(refocus?)      close; refocus (default true) hands focus back to the page
//   b.omni.current()            { url, kind } of the highlighted row, or of the typed text: what
//                               Enter would open. Peek uses it for Shift+Enter and Ctrl+Q.
//   b.omni.input                the <input id="vitre-omni">
//   b.omni.removableRow(el)     the index of the suggestion row element `el` (or one inside it) when
//                               Shift+Delete would remove it (a history row the user moved onto),
//                               else -1; b.omni.removeRow(i) removes it as Shift+Delete does (the
//                               menus module's "Remove from history" on a suggestion row).
//   #vitre-root.omni-open       set while the field is open (the rest of the bar steps aside).
// Suggestions: the typed address or search first, then open tabs that match ("Switch to tab":
// tabs of every window of the same kind, never a private window's tabs in a normal window or the
// other way round), then history. Tabs are instant; history is asked 60 ms after the last
// keystroke and a newer search cancels the one that is running.
import { displayHost, looksLikeAddress, resolveInput, searchUrl, stripUrl } from '../shared/url';
import type { Browser } from './browser';
import { el, fill, svg } from './dom';
import { glass, lens } from './glass';
import { icons } from './icons';
import type { Tab } from './model';
import { HistorySearch, pageIcon, removeFromHistory } from './places';

const FIELD_W = 640;
const FIELD_H = 48;
const TOP = 12;
/** Rows shown at most (typed row, open tabs and history together). */
const MAX_ROWS = 7;
const MAX_SWITCH = 3;
/** History waits this long after a keystroke: at 60 000 places one search takes 20-150 ms. */
const HISTORY_DELAY = 60;
const GROW_MS = 240;

export interface OmniHandlers {
  go(url: string, where: 'current' | 'newTab'): void;
  /** Switch to a tab, possibly in another window. */
  switchTo(win: Window, tabId: number): void;
  /** Tab / Shift+Tab out of the field: into the rest of the tab bar. */
  tabOut(direction: 1 | -1): void;
  closed(): void;
  /** The field opened or closed: native popups that hide while it is open re-check (doorhangers). */
  visibility(): void;
}

interface Row {
  kind: 'switch' | 'history' | 'search' | 'url';
  title: string;
  detail: string;
  url: string;
  /** A favicon URL (always chrome-safe: data:, moz-remote-image:, page-icon:), or null for a glyph. */
  icon: string | null;
  win?: Window;
  tabId?: number;
  removable?: boolean;
}

export class Omnibox {
  open = false;
  readonly input: HTMLInputElement;
  /** The Places search behind the history rows (its `lastMs` is the last search's duration, for tests). */
  readonly history = new HistorySearch();

  private field: HTMLElement;
  private fieldLens: HTMLElement;
  private panel: HTMLElement;
  private list: HTMLElement;
  private scrim: HTMLElement;
  private rows: Row[] = [];
  /** -1: nothing highlighted, Enter goes to the typed text. */
  private sel = -1;
  private moved = false;
  private original = '';
  private token = 0;
  private timer = 0;
  private growTimer = 0;
  private historyRows: Row[] = [];

  constructor(
    private b: Browser,
    private h: OmniHandlers
  ) {
    this.scrim = el('div', { id: 'vitre-omni-scrim' });
    this.scrim.hidden = true;
    b.layer('omni-scrim', 9).append(this.scrim);

    this.input = el('input', {
      id: 'vitre-omni',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'vitre-omni-list',
      'aria-label': 'Search or enter address',
      placeholder: 'Search or enter address',
    });
    this.field = el('div', { id: 'vitre-omni-field' }, el('div', { class: 'omni-row' }, el('span', { class: 'omni-icon', 'aria-hidden': 'true' }, svg(icons.search)), this.input));
    this.fieldLens = glass(this.field).lens;
    this.field.hidden = true;

    this.list = el('div', { id: 'vitre-omni-list', role: 'listbox', 'aria-label': 'Suggestions' });
    this.panel = el('div', { id: 'vitre-omni-panel' }, this.list);
    glass(this.panel);
    this.panel.classList.add('frost');
    this.panel.hidden = true;
    b.layer('omnibox', 20).append(this.field, this.panel);

    this.input.addEventListener('input', () => {
      this.moved = false;
      this.refresh();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => {
      // A click on a row keeps focus (mousedown is prevented); a real blur closes. When the whole
      // window is deactivated the field stays the active element, so switching apps keeps it open.
      window.setTimeout(() => {
        if (!this.open || document.activeElement === this.input) return;
        // Focus went to another control: leave it there. Focus went nowhere: back to the page.
        const nowhere = !document.activeElement || document.activeElement === document.body || document.activeElement === document.documentElement;
        this.close(nowhere);
      }, 0);
    });
    // Firefox would show its own text-field menu (#textbox-contextmenu); the menus module adds Deer's.
    this.input.addEventListener('contextmenu', (e) => e.preventDefault());
    // A press beside the text (icon, padding) keeps the caret in the field.
    this.field.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) {
        e.preventDefault();
        this.input.focus();
      }
    });
    this.scrim.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.list.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus in the field
      const row = (e.target as Element).closest<HTMLElement>('.omni-item');
      if (!row || (e.button !== 0 && e.button !== 1)) return;
      this.sel = Number(row.dataset.i);
      this.choose(e.altKey || e.button === 1 ? 'newTab' : 'current');
    });
    this.list.addEventListener('mousemove', (e) => {
      const row = (e.target as Element).closest<HTMLElement>('.omni-item');
      if (row && Number(row.dataset.i) !== this.sel) {
        this.sel = Number(row.dataset.i);
        this.moved = true;
        this.paintSelection();
      }
    });
    window.addEventListener('resize', () => {
      if (this.open) this.place(null);
    });
  }

  /** Does the field hold keyboard focus right now? */
  get focused(): boolean {
    return this.open && document.activeElement === this.input;
  }

  /** The suggestion row `el` belongs to, when Shift+Delete would remove it (a history row the user moved onto); else -1. */
  removableRow(el: Element | null): number {
    const row = el?.closest?.('.omni-item') as HTMLElement | null;
    if (!this.open || !row || !this.list.contains(row)) return -1;
    const i = Number(row.dataset.i);
    return this.moved && i === this.sel && this.rows[i]?.removable ? i : -1;
  }

  /** Remove the history row at index i from history and from the list, as Shift+Delete does. */
  removeRow(i: number): void {
    const row = this.rows[i];
    if (!this.open || !row?.removable) return;
    this.historyRows = this.historyRows.filter((r) => r.url !== row.url);
    void removeFromHistory(row.url).then(() => {
      if (this.open) this.refresh(true);
    });
  }

  show(from: DOMRect | null, tab: Tab | undefined, opts: { query?: string } = {}): void {
    this.original = tab && tab.kind === 'web' ? tab.url : '';
    this.input.value = opts.query ?? this.original;
    if (!this.open) {
      this.open = true;
      this.field.hidden = false;
      this.scrim.hidden = false;
      void this.scrim.offsetWidth;
      this.scrim.classList.add('on');
      this.b.root.classList.add('omni-open');
      this.place(from);
      this.h.visibility();
    }
    this.input.focus();
    this.input.select();
    this.moved = false;
    this.historyRows = [];
    this.refresh(true);
  }

  /** Close the field. `refocus` hands focus back to the page (not wanted when focus already moved on). */
  close(refocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.token++;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.growTimer);
    this.history.cancel();
    this.field.hidden = true;
    this.panel.hidden = true;
    this.scrim.classList.remove('on');
    this.scrim.hidden = true;
    this.rows = [];
    this.historyRows = [];
    this.input.setAttribute('aria-expanded', 'false');
    this.b.root.classList.remove('omni-open');
    this.h.visibility();
    if (refocus) this.h.closed();
  }

  /**
   * One step of the Esc ladder for the field: put the address back and close the suggestions, or,
   * when there is nothing to put back, close the field. False when the field is not open.
   */
  escape(): boolean {
    if (!this.open) return false;
    if (this.input.value !== this.original) {
      this.input.value = this.original;
      this.input.select();
      this.token++;
      window.clearTimeout(this.timer);
      this.history.cancel();
      this.rows = [];
      this.sel = -1;
      this.moved = false;
      this.renderRows();
    } else this.close();
    return true;
  }

  /** What Enter would open right now. */
  current(): { url: string; kind: Row['kind'] } | null {
    if (!this.open) return null;
    const row = this.sel >= 0 ? this.rows[this.sel] : undefined;
    if (row) return { url: row.url, kind: row.kind };
    const text = this.input.value.trim();
    if (!text) return null;
    return { url: resolveInput(text), kind: looksLikeAddress(text) ? 'url' : 'search' };
  }

  // ---- geometry ----

  /** Put the field at its place; with `from` it grows out of that rectangle (the pill). */
  private place(from: DOMRect | null): void {
    const W = window.innerWidth;
    // Centred, 24 px from the left edge at least, and never over the window controls: Windows
    // hit-tests the caption buttons by their place, so a field drawn over them would minimize or
    // close the window on a click. (The Electron build lets the field cover them.)
    const limit = W - this.b.bar.reserve;
    const fw = Math.max(200, Math.min(FIELD_W, W - 48, limit - 24));
    const left = Math.max(24, Math.min(Math.round((W - fw) / 2), limit - fw));
    const f = this.field.style;
    this.panel.style.left = `${left}px`;
    this.panel.style.width = `${fw}px`;
    window.clearTimeout(this.growTimer);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (from && !reduced) {
      f.transition = 'none';
      f.left = `${from.x}px`;
      f.top = `${from.y}px`;
      f.width = `${from.width}px`;
      f.height = `${from.height}px`;
      void this.field.offsetWidth;
      f.transition = '';
      // A lens sized for the end state would bend unevenly while the size animates: frost until then.
      this.field.classList.add('morphing');
      this.growTimer = window.setTimeout(() => {
        this.field.classList.remove('morphing');
        this.fieldLens.style.backdropFilter = lens(fw, FIELD_H);
      }, GROW_MS + 20);
    } else {
      f.transition = 'none';
      this.field.classList.remove('morphing');
      this.fieldLens.style.backdropFilter = lens(fw, FIELD_H);
    }
    f.left = `${left}px`;
    f.top = `${TOP}px`;
    f.width = `${fw}px`;
    f.height = `${FIELD_H}px`;
    if (!from || reduced) {
      void this.field.offsetWidth;
      f.transition = '';
    }
  }

  // ---- keys ----

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && plain && !e.shiftKey) {
      e.preventDefault();
      const n = this.rows.length;
      if (!n) return;
      this.sel = e.key === 'ArrowDown' ? (this.sel + 1) % n : (this.sel <= 0 ? n : this.sel) - 1;
      this.moved = true;
      this.paintSelection();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      const text = this.input.value.trim();
      if (e.ctrlKey && !e.altKey && !e.shiftKey && text && !/\s/.test(text) && !text.includes('.') && !text.includes(':')) {
        this.close();
        this.h.go(`https://www.${text}.com`, 'current');
        return;
      }
      if (e.shiftKey && plain) {
        const target = this.current();
        const peek = window.vitrePeek;
        if (target && peek?.open && /^https?:/i.test(target.url)) {
          this.close();
          peek.open(target.url);
          return;
        }
      }
      this.choose(e.altKey && !e.ctrlKey ? 'newTab' : 'current');
      return;
    }
    if (e.key === 'Escape' && plain && !e.shiftKey) {
      e.preventDefault(); // the router's Esc step must not run as well
      if (!e.repeat) this.escape();
      return;
    }
    if (e.key === 'Delete' && e.shiftKey && plain) {
      // Only a row the user moved onto; the default top match never counts, and otherwise this is Cut.
      const row = this.moved && this.sel >= 0 ? this.rows[this.sel] : undefined;
      if (row?.removable) {
        e.preventDefault();
        this.historyRows = this.historyRows.filter((r) => r.url !== row.url);
        void removeFromHistory(row.url).then(() => {
          if (this.open) this.refresh(true);
        });
      }
      return;
    }
    if (e.key === 'Tab' && plain) {
      e.preventDefault();
      this.close(false);
      this.h.tabOut(e.shiftKey ? -1 : 1);
    }
  }

  private choose(where: 'current' | 'newTab'): void {
    const row = this.sel >= 0 ? this.rows[this.sel] : undefined;
    const text = this.input.value;
    this.close();
    if (row?.kind === 'switch' && row.win && row.tabId !== undefined && where === 'current') this.h.switchTo(row.win, row.tabId);
    else if (row) this.h.go(row.url, where);
    else if (text.trim()) this.h.go(resolveInput(text), where);
  }

  // ---- suggestions ----

  /** Tabs of this window and of other windows of the same kind (normal or private) that match every word. */
  private openTabs(tokens: string[]): Row[] {
    const out: Row[] = [];
    let wins: Window[] = [window];
    try {
      wins = [window, ...[...this.b.sys('VitreShell').windows].filter((w) => w !== window)];
    } catch {
      /* only this window then */
    }
    for (const win of wins) {
      const other = (win as Window).vitre;
      if (!other || (win as any).closed || other.isPrivate !== this.b.isPrivate) continue;
      for (const t of other.tabs) {
        if (t.kind !== 'web' || (win === window && t.id === this.b.activeId)) continue;
        const hay = `${t.url} ${t.title}`.toLowerCase();
        if (!tokens.every((k) => hay.includes(k))) continue;
        out.push({ kind: 'switch', title: t.title || displayHost(t.url), detail: displayHost(t.url), url: t.url, icon: t.favicon, win, tabId: t.id });
        if (out.length >= MAX_SWITCH) return out;
      }
    }
    return out;
  }

  private refresh(now = false): void {
    const text = this.input.value.trim();
    const token = ++this.token;
    const head: Row[] = [];
    if (text && text !== this.original) {
      const url = resolveInput(text);
      head.push(looksLikeAddress(text) ? { kind: 'url', title: stripUrl(url), detail: 'Go to address', url, icon: null } : { kind: 'search', title: text, detail: 'Search', url: searchUrl(text), icon: null });
    }
    const q = text === this.original ? '' : text.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length) head.push(...this.openTabs(tokens).slice(0, MAX_SWITCH - head.length));
    // Until the new history rows arrive, keep the ones on screen that still match.
    const still = this.historyRows.filter((r) => tokens.every((k) => `${r.url} ${r.title}`.toLowerCase().includes(k)));
    const keep = this.moved ? this.rows[this.sel]?.url : undefined;
    this.setRows(head, still, keep);

    window.clearTimeout(this.timer);
    const ask = async (): Promise<void> => {
      const found = await this.history.query(q, MAX_ROWS + 3);
      if (token !== this.token || !this.open || found === null) return;
      this.historyRows = found.map((e) => ({ kind: 'history' as const, title: e.title || stripUrl(e.url), detail: stripUrl(e.url), url: e.url, icon: pageIcon(e.url), removable: true }));
      this.setRows(head, this.historyRows, this.moved ? this.rows[this.sel]?.url : undefined);
    };
    if (now || !tokens.length) void ask();
    else this.timer = window.setTimeout(() => void ask(), HISTORY_DELAY);
  }

  private setRows(head: Row[], history: Row[], keepUrl: string | undefined): void {
    const have = new Set(head.map((r) => r.url));
    const rows = [...head];
    for (const r of history) {
      if (rows.length >= MAX_ROWS) break;
      if (have.has(r.url) || r.url === this.original) continue;
      have.add(r.url);
      rows.push(r);
    }
    this.rows = rows;
    // The typed row is the default; with nothing typed nothing is highlighted and Enter keeps the address.
    const kept = keepUrl ? rows.findIndex((r) => r.url === keepUrl) : -1;
    if (kept >= 0) this.sel = kept;
    else {
      this.sel = rows.length && (rows[0].kind === 'url' || rows[0].kind === 'search') ? 0 : -1;
      this.moved = false;
    }
    this.renderRows();
  }

  private glyph(row: Row): HTMLElement {
    const box = el('span', { class: 'omni-glyph' });
    const fallback = row.kind === 'search' ? icons.search : row.kind === 'history' ? icons.history : icons.globe;
    if (row.icon && (row.kind === 'history' || row.kind === 'switch')) {
      const img = el('img', { src: row.icon, alt: '', draggable: 'false' });
      img.addEventListener('error', () => fill(box, svg(fallback)), { once: true });
      box.append(img);
    } else box.append(svg(fallback));
    return box;
  }

  private renderRows(): void {
    const nodes: Node[] = [];
    let lastGroup = '';
    this.rows.forEach((r, i) => {
      // Board (HomeSearch): "Switch to tab" rows carry their own tail and need no group label.
      const group = r.kind === 'history' ? 'History' : '';
      if (group && group !== lastGroup) nodes.push(el('div', { class: 'omni-group' }, group));
      lastGroup = group;
      const item = el('div', { class: 'omni-item', role: 'option', 'data-i': i, id: `vitre-omni-row-${i}` }, this.glyph(r), el('span', { class: 'omni-title' }, r.title), el('span', { class: 'omni-detail' }, r.detail));
      if (r.kind === 'switch') item.append(el('span', { class: 'omni-tail' }, 'Switch to tab', svg(icons.switchTab)));
      nodes.push(item);
    });
    fill(this.list, ...nodes);
    this.panel.hidden = this.rows.length === 0;
    this.input.setAttribute('aria-expanded', String(this.rows.length > 0));
    this.paintSelection();
  }

  private paintSelection(): void {
    for (const item of this.list.querySelectorAll<HTMLElement>('.omni-item')) {
      const on = Number(item.dataset.i) === this.sel;
      item.classList.toggle('selected', on);
      item.setAttribute('aria-selected', String(on));
    }
    if (this.sel >= 0) this.input.setAttribute('aria-activedescendant', `vitre-omni-row-${this.sel}`);
    else this.input.removeAttribute('aria-activedescendant');
  }
}
