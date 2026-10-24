// The History panel's process-wide part (../design/HISTORY-SPEC.md "Deleting, and undo"; the panel is
// src/window/modules/history). A delete in the panel is held in its window for 10 s so Undo is exact;
// when it commits, the visits are removed here, in a module that outlives the window: a commit that
// starts as its window closes, or as Deer quits, still finishes, and Places' shutdown waits for it
// (a blocker on PlacesUtils.history.shutdownClient). A process singleton (window code:
// b.sys('VitreHistory')).
//
//   commit(ranges)     remove the visits of each range, one call after another, in order:
//                      PlacesUtils.history.removeVisitsByFilter({ url?, beginDate, endDate })
//                      (gre/modules/History.sys.mjs). Never history.remove, which takes a page from
//                      every day. `begin` and `end` are ms and both inclusive; `end` may carry a
//                      fraction: Places compares visit_date <= end * 1000 while it stores
//                      microseconds, so a day's range ends at the next midnight less 0.001 ms and a
//                      visit in the last millisecond before midnight still goes (spec "Build notes",
//                      spike H2). The Date handed over keeps that fraction in its valueOf.
//   register(flush)    a window's pending delete, committed by flushAll(); returns the remover
//   flushAll()         every window commits its pending delete, then waits until the removals are
//                      done (Clear browsing data runs it first: settings/gecko.ts sanitize)
//   idle()             resolves once every commit asked for so far has finished (tests)
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';

/** One removal: a page's visits in a range (`url` set), or every visit in it (a whole day). */
export interface HistoryRange {
  url?: string;
  /** First instant, ms, inclusive. */
  begin: number;
  /** Last instant, ms, inclusive; may have a fraction (see the header). */
  end: number;
}

declare global {
  interface VitreSysModules {
    VitreHistory: typeof VitreHistory;
  }
}

let placesUtils: any = null;
const places = (): any => (placesUtils ??= ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils);

let queue: Promise<void> = Promise.resolve();
let blocked = false;
const flushers = new Set<() => unknown>();

/** A Date for removeVisitsByFilter whose number value may carry a fraction of a millisecond. */
function placesDate(ms: number): Date {
  const d = new Date(Math.floor(ms));
  if (ms !== Math.floor(ms)) Object.defineProperty(d, 'valueOf', { value: () => ms });
  return d;
}

/** Places waits for the removals under way before it closes its database (quit). */
function blockShutdown(): void {
  if (blocked) return;
  blocked = true;
  try {
    places().history.shutdownClient.jsclient.addBlocker('Deer: History deletes', () => queue);
  } catch (e) {
    // Too late (Places is shutting down already): the queue still runs as far as Places lets it.
    console.warn('Deer history: no shutdown blocker', e);
  }
}

async function removeOne(r: HistoryRange): Promise<void> {
  const filter: Record<string, unknown> = { beginDate: placesDate(r.begin), endDate: placesDate(r.end) };
  if (r.url) filter.url = r.url;
  try {
    await places().history.removeVisitsByFilter(filter);
  } catch (e) {
    console.error('Deer history: a delete did not finish', e);
  }
}

export const VitreHistory = {
  /** Remove these ranges' visits, in order, after anything asked for before. */
  commit(ranges: HistoryRange[]): Promise<void> {
    const list = ranges.filter((r) => Number.isFinite(r.begin) && Number.isFinite(r.end) && r.end >= r.begin).map((r) => ({ url: r.url ? String(r.url) : undefined, begin: r.begin, end: r.end }));
    if (!list.length) return queue;
    blockShutdown();
    queue = queue.then(async () => {
      for (const r of list) await removeOne(r);
    });
    return queue;
  },

  /** A window's pending delete, committed by flushAll(). Returns the remover. */
  register(flush: () => unknown): () => void {
    flushers.add(flush);
    return () => flushers.delete(flush);
  },

  /** Every window's pending delete committed, and every removal done (at most 10 s of waiting). */
  async flushAll(): Promise<void> {
    for (const flush of [...flushers]) {
      try {
        flush();
      } catch (e) {
        console.error('Deer history: a window could not commit its delete', e);
      }
    }
    let timer: unknown = null;
    await Promise.race([queue, new Promise<void>((resolve) => (timer = setTimeout(resolve, 10_000)))]);
    clearTimeout(timer as number);
  },

  /** Resolves once every commit asked for so far has finished. */
  idle(): Promise<void> {
    return queue;
  },
};
