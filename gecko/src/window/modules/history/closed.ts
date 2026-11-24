// Recently closed (../design/HISTORY-SPEC.md "Recently closed"): SessionStore's closed tabs of every
// open normal window, newest first, and its closed windows (up to 5). Read in normal windows only: a
// private window's panel never starts this (no SessionStore read).
// Left out: Home and blank tabs, Deer's hidden tabs (peeks and resolver pages carry the session value
// HIDDEN_TAB_VALUE, model.ts), and tabs inside a closed window, which come back with that window. A
// side of a split pair comes back as an ordinary tab (SessionStore's own restore).
import { HIDDEN_TAB_VALUE } from '../../model';
import { isHomeUrl } from '../../../shared/url';
import { closedTabs, closedWindows, forgetTab, forgetWindow, onClosedChanged, undoClose, type RawClosedTab } from './gecko';

export interface ClosedTab {
  kind: 'tab';
  /** DOM key. */
  id: string;
  closedId: number;
  sourceWindowId?: string;
  title: string;
  url: string;
  closedAt: number;
  /** Ctrl+Shift+T in this window would bring this one back next. */
  next: boolean;
}

export interface ClosedWindow {
  kind: 'window';
  id: string;
  closedId: number;
  /** The selected tab's title. */
  title: string;
  url: string;
  /** Up to 10 tab titles, for the tooltip. */
  titles: string[];
  count: number;
  closedAt: number;
  next: boolean;
}

export type ClosedEntry = ClosedTab | ClosedWindow;

const MAX_WINDOWS = 5;

/** Blank and Home pages are not worth listing. */
function worthy(url: string): boolean {
  if (!url || isHomeUrl(url)) return false;
  return !/^about:(blank|newtab|home|privatebrowsing|vitre-home)\b/i.test(url);
}

type Entry = { url?: string; title?: string };
type TabState = { entries?: Entry[]; index?: number; extData?: Record<string, string> };

/** The entry a tab shows (index is 1-based in SessionStore). */
function current(state: TabState | undefined): Entry | null {
  const entries = state?.entries ?? [];
  if (!entries.length) return null;
  const i = Math.max(1, Math.min(entries.length, Number(state?.index) || entries.length));
  return entries[i - 1] ?? null;
}

export class ClosedList {
  tabs: ClosedTab[] = [];
  windows: ClosedWindow[] = [];
  private stop: (() => void) | null = null;

  /** Read SessionStore now. */
  read(): void {
    const tabs: ClosedTab[] = [];
    for (const t of closedTabs() as RawClosedTab[]) {
      if (t.state?.extData?.[HIDDEN_TAB_VALUE]) continue;
      const e = current(t.state);
      const url = String(e?.url ?? '');
      if (!worthy(url)) continue;
      tabs.push({ kind: 'tab', id: `ct${t.closedId}`, closedId: t.closedId, sourceWindowId: t.sourceWindowId, title: String(e?.title || t.title || ''), url, closedAt: Number(t.closedAt) || 0, next: false });
    }
    tabs.sort((a, b) => b.closedAt - a.closedAt);
    const windows: ClosedWindow[] = [];
    for (const w of closedWindows()) {
      const all = (w.tabs ?? []).filter((t) => !t.extData?.[HIDDEN_TAB_VALUE]);
      if (!all.length) continue;
      const sel = all[Math.max(0, Math.min(all.length - 1, (Number(w.selected) || 1) - 1))];
      const e = current(sel);
      const titles = all.map((t) => String(current(t)?.title || current(t)?.url || '')).filter(Boolean);
      windows.push({ kind: 'window', id: `cw${w.closedId}`, closedId: w.closedId, title: String(e?.title || w.title || e?.url || ''), url: String(e?.url ?? ''), titles: titles.slice(0, 10), count: all.length, closedAt: Number(w.closedAt) || 0, next: false });
    }
    windows.sort((a, b) => b.closedAt - a.closedAt);
    this.tabs = tabs;
    this.windows = windows.slice(0, MAX_WINDOWS);
    // What Ctrl+Shift+T brings back: the last close action, a tab of any normal window or a window
    // (SessionWindowUI.restoreLastClosedTabOrWindowOrSession pops SessionStore's last closed action).
    const newest = [...tabs, ...this.windows].sort((a, b) => b.closedAt - a.closedAt)[0];
    if (newest) newest.next = true;
  }

  get count(): number {
    return this.tabs.length + this.windows.length;
  }

  /** Follow SessionStore's closed lists while the panel is open. */
  watch(fn: (() => void) | null): void {
    this.stop?.();
    this.stop = fn ? onClosedChanged(fn) : null;
  }

  /** Reopen a tab (into this window, where Ctrl+Shift+T would put it) or a whole window. */
  restore(e: ClosedEntry): unknown {
    return undoClose(e.closedId);
  }

  /** Remove an entry from the list (no undo: SessionStore can't put it back). */
  forget(e: ClosedEntry): void {
    if (e.kind === 'tab') forgetTab(e.closedId, e.sourceWindowId);
    else forgetWindow(e.closedId);
  }
}
