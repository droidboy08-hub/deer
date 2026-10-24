// History: the third floating panel, beside Settings and Downloads (../design/HISTORY-SPEC.md,
// approved by the owner 2026-10-24; boards on the canvas page "History"). Your history by day, a
// search over it, the tabs and windows you recently closed, and deletes that can be undone. It reads
// Firefox 157's own history database (Places) and session store; Firefox's own history interface
// stays hidden.
//
// Ways in (spec "Opening and closing"): Ctrl+H (page-first, key repeat ignored: the 'history' action,
// which this module takes over from the core's editAddress('')), History in the + circle's menu
// (menus/chrome-items.ts plusRows), and Ctrl+H in the address field, whose typed text becomes the
// search when it differs from the page's address. Ctrl+H toggles. In a private window every way in
// opens the panel to its one line, and the typed text is not carried.
//
// Service 'history' (b.service('history'), HistoryApi below):
//   open(opts?)   open (or bring forward) the panel: { query?: string; view?: 'all' | 'closed' }
//   toggle()      open, or close when open
//   close()       close it
//   isOpen()
//
// Files: panel.ts (DOM, keys, focus, motion), store.ts (day pages, search, observers, the deferred
// commit), closed.ts (SessionStore), gecko.ts (every Firefox internal), format.ts (words and dates),
// css.ts (Settings' --vs-* tokens). The deletes run in the process singleton VitreHistory
// (src/modules/VitreHistory.sys.ts), which outlives the window and holds Places' shutdown.
//
// For tests: window.vitreHistory = { panel, store, closed } (store and closed are null in a private
// window); panel.undoMs and panel.assistive are knobs, store.clock moves "now".
import type { Browser } from '../../browser';
import type { HistoryRange } from '../../../modules/VitreHistory.sys';
import { ClosedList } from './closed';
import { CSS } from './css';
import { HistoryPanel } from './panel';
import { HistoryStore } from './store';

export interface HistoryApi {
  open(opts?: { query?: string; view?: 'all' | 'closed' }): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

declare global {
  interface VitreServices {
    history: HistoryApi;
  }
}

export function install(b: Browser): void {
  b.css('history', CSS);
  // A private window shows no history at all: nothing is read, no observer is added (spec "Private windows").
  const commit = (ranges: HistoryRange[]): Promise<void> => b.sys('VitreHistory').commit(ranges);
  const store = b.isPrivate ? null : new HistoryStore(commit);
  const closed = b.isPrivate ? null : new ClosedList();
  const panel = new HistoryPanel(b, store, closed);
  (window as any).vitreHistory = { panel, store, closed };
  if (store) {
    // Clear browsing data (any window) and quitting commit this window's pending delete first.
    const off = b.sys('VitreHistory').register(() => panel.commit());
    b.onDestroy(off);
  }

  b.registerAction('history', () => {
    // Ctrl+H in the address field: what was typed becomes the search (not in a private window).
    if (b.omni.open) {
      const typed = b.omni.input.value.trim();
      const page = b.active()?.url ?? '';
      panel.show(typed && typed !== page && !b.isPrivate ? { query: typed } : {});
      return;
    }
    panel.toggle();
  });

  b.provide('history', {
    open: (opts) => panel.show(opts ?? {}),
    toggle: () => panel.toggle(),
    close: () => panel.close(),
    isOpen: () => panel.isOpen,
  });
}
