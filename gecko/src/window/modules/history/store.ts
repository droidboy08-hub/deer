// The History panel's data (../design/HISTORY-SPEC.md "What the list shows", "Search", "Deleting, and
// undo", "Build notes"): day pages read from Places, the search, the live updates and the deferred
// commit. One per normal window; a private window never makes one (no Places connection, nothing
// read, no observer).
//
// Rows: one per page per day, showing that day's latest counted visit; key guid|dayStart. A visit
// counts unless its type is invalid, embedded, download, framed link or reload (Places' own rule:
// visit_type NOT IN (0,4,7,8,9)); pages that were only redirect sources (hidden = 1) and pages that
// can't be opened (not http, https or file) are left out.
// Days load newest first, one query each (2-42 ms whatever the history's size: spike), at least
// MIN_ROWS rows at a time. Search reads moz_places by a full scan and sort (the + signs keep SQLite
// off the index, so a rare word can't walk it), 150 rows a page, keyset on (last visit, id), never
// interrupted (interrupt() would also stop other searches on the shared connection): a newer search
// wins by serial number.
//
// Deletes (spec "Deleting, and undo"): the rows leave the list at once and Places changes only when
// commit() runs (the panel calls it when the undo line goes, on another delete, on close, when a page
// opens from it, when its window closes, and Clear browsing data and quitting reach it through
// VitreHistory). A row takes that page's visits on its day only; a day, every visit of that day; for
// Today the range ends at the moment of the delete, so a visit made afterwards survives. Undo drops
// the pending list: nothing was removed, so nothing is written back. While a delete is pending, this
// window's address field leaves out the pages it would take out of history entirely (places.ts
// setPendingRemoval), until the commit has finished.
// The rows a delete hides stay in the model, and hides() leaves them out of what the panel draws:
// rows read again while a delete is pending (a reload after the Peek hand-off or a bulk change, Try
// again, a day loaded by scrolling, a search page) are still there for Undo ("Undo brings back
// exactly what was deleted"). Once committed, rows of the ranges still being removed stay hidden
// until Places is done (one removal per row, 2 to 5 ms each: a large selection takes seconds), so a
// reopen meanwhile never shows them.
// Rows read again keep the ids of the rows they replace (adopt()): the panel's rows, keyboard focus
// and selection survive a reload.
import { setPendingRemoval } from '../../places';
import type { HistoryRange } from '../../../modules/VitreHistory.sys';
import { dayStartOf, nextDayStart } from './format';
import { ACM_BEHAVIOR, ACM_MATCH, observe, readDb, searchDb, type PlacesEvent } from './gecko';

/** One row: a page on one day. */
export interface Row {
  /** Unique per row (the DOM key); a row read again for the same page and day keeps it. */
  id: string;
  guid: string;
  url: string;
  title: string;
  /** That day's latest counted visit (a search result: the page's last visit), ms. */
  last: number;
  dayStart: number;
  /** Places has a favicon for the page (or its site's root icon). */
  icon: boolean;
}

export interface Day {
  start: number;
  rows: Row[];
}

/** One removal range of a delete: a page's visits on a day (`guid` and `url` set), or a whole day. */
export type Range = HistoryRange & { guid?: string; dayStart: number };

/** What a pending delete holds, and the line the panel shows for it. */
export interface Pending {
  kind: 'row' | 'selection' | 'day';
  /** The rows it hid, in list order (focus goes to the first one on Undo). */
  rows: Row[];
  /** Days it took whole (a day delete). */
  days: number[];
  /** Removal ranges, in the order they will run. */
  ranges: Range[];
  at: number;
  /**
   * The pages the line counts. A row or a selection: its rows. A day: the pages listed under it in
   * All history; -1 while they are counted in Places (Delete day on a search-results heading whose
   * day isn't loaded: the heading shows only the matches, the delete takes the whole day).
   */
  pages: number;
}

/** Ranges looked up by day, then page (a large selection is checked against every loaded row). */
class Ranges {
  private byDay = new Map<number, { whole: Range | null; pages: Map<string, Range> }>();

  constructor(list: Range[]) {
    for (const r of list) {
      let d = this.byDay.get(r.dayStart);
      if (!d) this.byDay.set(r.dayStart, (d = { whole: null, pages: new Map() }));
      if (!r.guid) d.whole = r;
      else d.pages.set(r.guid, r);
    }
  }

  /** The range takes this row: its page and day match, and its visit is not newer than the delete. */
  covers(r: { guid: string; dayStart: number; last: number }): boolean {
    const d = this.byDay.get(r.dayStart);
    if (!d) return false;
    if (d.whole && r.last <= d.whole.end) return true;
    const p = d.pages.get(r.guid);
    return !!p && r.last <= p.end;
  }
}

/** Visit types that don't count (Places' own rule): invalid, embed, download, framed link, reload. */
const UNCOUNTED = '(0,4,7,8,9)';
const SCHEMES = `substr(h.url, 1, 6) IN ('http:/', 'https:', 'file:/')`;
/** A page's own favicon, or its site's root icon (what page-icon: falls back to). */
const HAS_ICON = `(EXISTS (SELECT 1 FROM moz_pages_w_icons pi WHERE pi.page_url_hash = hash(h.url) AND pi.page_url = h.url)
  OR EXISTS (SELECT 1 FROM moz_icons i WHERE i.fixed_icon_url_hash = hash(fixup_url(get_host_and_port(h.url)) || '/favicon.ico') AND i.root = 1))`;
const PAGE_SIZE = 150;
/** First open and every later load add at least this many rows (spec "What the list shows"). */
export const MIN_ROWS = 60;
/** A batch of this many Places events, or history-cleared, reloads the loaded days (500 ms later). */
const BULK = 50;
const BULK_DELAY = 500;

let serial = 0;
const rowId = (): string => `r${++serial}`;
const keyOf = (r: Row): string => `${r.guid}|${r.dayStart}`;
/** Row ids by guid|dayStart (what adopt() gives to the rows read again). */
const idsOf = (days: Day[]): Map<string, string> => new Map(days.flatMap((d) => d.rows.map((r) => [keyOf(r), r.id] as [string, string])));

function readRow(r: any, dayStart?: number): Row {
  const last = Math.floor(Number(r.getResultByName('last')) / 1000);
  return {
    id: rowId(),
    guid: String(r.getResultByName('guid')),
    url: String(r.getResultByName('url')),
    title: String(r.getResultByName('title') ?? ''),
    last,
    dayStart: dayStart ?? dayStartOf(last),
    icon: !!r.getResultByName('icon'),
  };
}

export type Change =
  | { type: 'reset' }
  | { type: 'loaded' }
  | { type: 'search' }
  | { type: 'visited'; row: Row; added: boolean }
  | { type: 'titled'; rows: Row[] }
  | { type: 'removed'; rows: Row[] }
  | { type: 'pending' };

export class HistoryStore {
  /** "Now" for day boundaries; tests move it (window.vitreHistory.clock). */
  clock: () => number = () => Date.now();

  // ---- All history ----
  days: Day[] = [];
  /** No older day is left to load. */
  atEnd = false;
  /** Places couldn't be read (the "History isn't available right now" state). */
  failed = false;
  /** The first day page has arrived since open(). */
  ready = false;
  summary: { pages: number; since: number } | null = null;
  private loading: Promise<void> | null = null;
  /** The day start the next load continues before. */
  private before = 0;
  private generation = 0;
  /** While a reload runs: the ids of the rows it replaces, by guid|dayStart (see adopt). */
  private reuse: Map<string, string> | null = null;

  // ---- Search ----
  /** The search asked for last ('' = none). */
  query = '';
  /** The search whose results `results` holds ('' = All history shows): old results stay until new ones arrive. */
  shown = '';
  results: Day[] = [];
  /** Matching pages in all, as Places counts them (the COUNT after the first page); -1 until known. See matchCount. */
  total = -1;
  searchEnd = false;
  searching = false;
  private searchSerial = 0;
  private cursor: { last: number; id: number } | null = null;
  private searchLoading: Promise<void> | null = null;

  // ---- Deletes ----
  private current: { p: Pending; set: Ranges } | null = null;
  /** Ranges of commits VitreHistory is still running: their rows stay hidden until Places is done. */
  private inflight: Ranges[] = [];
  /** The latest pendingRemoval answer belongs to this pending delete. */
  private removalFor: Pending | null = null;

  private listeners = new Set<(c: Change) => void>();
  private unobserve: (() => void) | null = null;
  private bulkTimer = 0;

  /** Commits go to the process-wide singleton (VitreHistory), which outlives the window. */
  constructor(private commitRanges: (ranges: HistoryRange[]) => Promise<void>) {}

  /** The delete the undo line offers to undo. */
  get pending(): Pending | null {
    return this.current?.p ?? null;
  }

  subscribe(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(c);
      } catch (e) {
        console.error('Deer history: a listener failed', e);
      }
    }
  }

  today(): number {
    return dayStartOf(this.clock());
  }

  // ---- loading days ----

  /**
   * Read the list again from Today: the first open and Try again (`keep` false: nothing shows until
   * the first day page arrives), or a bulk change (`keep`: the loaded days stay on screen until the
   * new ones replace them). Rows read again keep their ids.
   */
  async reload(minRows = MIN_ROWS, keep = false): Promise<void> {
    this.generation++;
    const old = this.visibleDays;
    this.reuse = idsOf(old);
    this.days = [];
    this.atEnd = false;
    this.failed = false;
    this.before = nextDayStart(this.today());
    this.loading = null;
    if (keep && this.ready) this.shownDays = old;
    else {
      this.ready = false;
      this.shownDays = null;
    }
    const gen = this.generation;
    await this.loadMore(minRows);
    if (gen !== this.generation) return;
    this.reuse = null;
    this.shownDays = null;
    this.ready = true;
    this.emit({ type: 'reset' });
  }

  /** The days on screen while a bulk reload reads the new ones. */
  private shownDays: Day[] | null = null;

  /** What All history shows now (the old days during a bulk reload). */
  get visibleDays(): Day[] {
    return this.shownDays ?? this.days;
  }

  /** Load older days until at least `minRows` more rows the panel draws are in (or history ends). */
  loadMore(minRows = MIN_ROWS): Promise<void> {
    if (this.atEnd || this.failed) return Promise.resolve();
    if (this.loading) return this.loading;
    const gen = this.generation;
    this.loading = (async () => {
      let added = 0;
      try {
        const db = await readDb();
        while (added < minRows && gen === this.generation) {
          const day = await this.olderDay(db, this.before);
          if (gen !== this.generation) return;
          if (day === null) {
            this.atEnd = true;
            break;
          }
          this.before = day;
          const rows = await this.dayPage(db, day);
          if (gen !== this.generation) return;
          // A day with only uncounted visits is skipped. Rows a delete hides stay in the model (Undo
          // shows them again) but don't count towards the rows wanted.
          if (rows.length) {
            this.days.push({ start: day, rows: this.adopt(rows) });
            for (const r of rows) if (!this.hides(r)) added++;
          }
        }
      } catch (e) {
        console.error('Deer history: could not read history', e);
        if (gen === this.generation) this.failed = true;
      } finally {
        if (gen === this.generation) this.loading = null;
      }
      if (gen === this.generation && this.ready && !this.shownDays) this.emit({ type: 'loaded' });
    })();
    return this.loading;
  }

  /** Rows read again for a page and day already in the model keep that row's id. */
  private adopt(rows: Row[], from = this.reuse): Row[] {
    if (!from?.size) return rows;
    for (const r of rows) {
      const k = keyOf(r);
      const id = from.get(k);
      if (id === undefined) continue;
      r.id = id;
      from.delete(k);
    }
    return rows;
  }

  /** The start of the newest day before `before` that has a counted visit, or null. */
  private async olderDay(db: any, before: number): Promise<number | null> {
    const rows = await db.executeCached(
      `SELECT v.visit_date AS d FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
       WHERE v.visit_date < :before AND v.visit_type NOT IN ${UNCOUNTED} AND h.hidden = 0 AND ${SCHEMES}
       ORDER BY v.visit_date DESC LIMIT 1`,
      { before: before * 1000 }
    );
    if (!rows.length) return null;
    return dayStartOf(Math.floor(Number(rows[0].getResultByName('d')) / 1000));
  }

  /** One day's rows, newest first (spec "Build notes": Day page). */
  private async dayPage(db: any, day: number): Promise<Row[]> {
    const rows = await db.executeCached(
      `SELECT h.guid, h.url, h.title, MAX(v.visit_date) AS last, ${HAS_ICON} AS icon
       FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
       WHERE v.visit_date >= :dayStart AND v.visit_date < :nextDayStart
         AND v.visit_type NOT IN ${UNCOUNTED} AND h.hidden = 0 AND ${SCHEMES}
       GROUP BY v.place_id ORDER BY last DESC`,
      { dayStart: day * 1000, nextDayStart: nextDayStart(day) * 1000 }
    );
    return rows.map((r: any) => readRow(r, day));
  }

  /** "1,284 pages since 3 March 2026": both counts once per open, both async. */
  async readSummary(): Promise<void> {
    try {
      const db = await readDb();
      // Pages the list can show: at least one counted visit (a page only ever reloaded is not one).
      const n = await db.executeCached(
        `SELECT COUNT(*) AS n FROM moz_places h WHERE h.hidden = 0 AND h.last_visit_date NOT NULL AND ${SCHEMES}
           AND EXISTS (SELECT 1 FROM moz_historyvisits v WHERE v.place_id = h.id AND v.visit_type NOT IN ${UNCOUNTED})`
      );
      const first = await db.executeCached(`SELECT v.visit_date AS d FROM moz_historyvisits v WHERE v.visit_type NOT IN ${UNCOUNTED} ORDER BY v.visit_date ASC LIMIT 1`);
      const pages = Number(n[0]?.getResultByName('n')) || 0;
      const since = first.length ? Math.floor(Number(first[0].getResultByName('d')) / 1000) : 0;
      this.summary = pages && since ? { pages, since } : null;
    } catch (e) {
      console.warn('Deer history: no summary', e);
      this.summary = null;
    }
    this.emit({ type: 'loaded' });
  }

  // ---- search ----

  /**
   * Search (60 ms after typing pauses: the panel's timer); '' ends the search. Old results stay until
   * new ones arrive; the same search run again (a bulk change) keeps its rows' ids.
   */
  search(q: string): Promise<void> {
    const query = q.replace(/\s+/g, ' ').trim();
    const mine = ++this.searchSerial;
    this.query = query;
    this.searchLoading = null;
    if (!query) {
      this.results = [];
      this.shown = '';
      this.total = -1;
      this.searchEnd = false;
      this.searching = false;
      this.cursor = null;
      this.emit({ type: 'search' });
      return Promise.resolve();
    }
    this.searching = true;
    const run = (async () => {
      try {
        const page = await this.searchPage(query, null);
        if (mine !== this.searchSerial) return;
        const ids = this.shown === query ? idsOf(this.results) : null;
        this.shown = query;
        this.results = [];
        this.addResults(this.adopt(page.rows, ids));
        this.cursor = page.cursor;
        this.searchEnd = page.rows.length < PAGE_SIZE;
        this.total = this.searchEnd ? this.resultCount() : -1;
        this.searching = false;
        this.emit({ type: 'search' });
        if (!this.searchEnd) {
          const n = await this.countMatches(query);
          if (mine !== this.searchSerial) return;
          this.total = n;
          this.emit({ type: 'search' });
        }
      } catch (e) {
        if (mine !== this.searchSerial) return;
        console.warn('Deer history: search did not finish', e);
        this.shown = query;
        this.results = [];
        this.total = 0;
        this.searchEnd = true;
        this.searching = false;
        this.emit({ type: 'search' });
      }
    })();
    return run;
  }

  /** The next 150 results (scrolling near the end). */
  searchMore(): Promise<void> {
    if (!this.query || this.shown !== this.query || this.searchEnd || this.searching) return Promise.resolve();
    if (this.searchLoading) return this.searchLoading;
    const mine = this.searchSerial;
    const query = this.query;
    this.searchLoading = (async () => {
      try {
        const page = await this.searchPage(query, this.cursor);
        if (mine !== this.searchSerial) return;
        this.addResults(page.rows);
        this.cursor = page.cursor ?? this.cursor;
        this.searchEnd = page.rows.length < PAGE_SIZE;
        this.emit({ type: 'search' });
      } catch (e) {
        console.warn('Deer history: search page did not finish', e);
        this.searchEnd = true;
      } finally {
        if (mine === this.searchSerial) this.searchLoading = null;
      }
    })();
    return this.searchLoading;
  }

  /** Results, grouped under the day of their last visit. Rows a delete hides stay (see hides). */
  private addResults(rows: Row[]): void {
    for (const r of rows) {
      const lastDay = this.results[this.results.length - 1];
      if (lastDay && lastDay.start === r.dayStart) lastDay.rows.push(r);
      else this.results.push({ start: r.dayStart, rows: [r] });
    }
  }

  private resultCount(): number {
    return this.results.reduce((n, d) => n + d.rows.length, 0);
  }

  /**
   * The match count the toolbar shows: Places' count less the loaded results a delete hides (spec
   * "Deleting, and undo": search leaves out a page whose listed row is pending); -1 until known.
   */
  get matchCount(): number {
    if (this.total < 0) return -1;
    let hidden = 0;
    for (const d of this.results) for (const r of d.rows) if (this.hides(r)) hidden++;
    return Math.max(0, this.total - hidden);
  }

  private async searchPage(q: string, cursor: { last: number; id: number } | null): Promise<{ rows: Row[]; cursor: { last: number; id: number } | null }> {
    const db = await searchDb();
    const keyset = cursor ? 'AND (+h.last_visit_date < :cl OR (+h.last_visit_date = :cl AND h.id < :ci))' : '';
    const params: Record<string, unknown> = { q, mb: ACM_MATCH(), sb: ACM_BEHAVIOR(), limit: PAGE_SIZE };
    if (cursor) Object.assign(params, { cl: cursor.last, ci: cursor.id });
    const raw = await db.executeCached(
      `SELECT h.id AS pid, h.guid, h.url, h.title, h.last_visit_date AS last, ${HAS_ICON} AS icon
       FROM moz_places h
       WHERE h.hidden = 0 AND h.last_visit_date NOT NULL AND ${SCHEMES} ${keyset}
         AND AUTOCOMPLETE_MATCH(:q, h.url, h.title, NULL, 1, 1, 1, 1, :mb, :sb, NULL)
       ORDER BY +h.last_visit_date DESC, h.id DESC LIMIT :limit`,
      params
    );
    const rows = raw.map((r: any) => readRow(r));
    const tail = raw[raw.length - 1];
    return { rows, cursor: tail ? { last: Number(tail.getResultByName('last')), id: Number(tail.getResultByName('pid')) } : cursor };
  }

  private async countMatches(q: string): Promise<number> {
    const db = await searchDb();
    const r = await db.executeCached(
      `SELECT COUNT(*) AS n FROM moz_places h
       WHERE h.hidden = 0 AND h.last_visit_date NOT NULL AND ${SCHEMES}
         AND AUTOCOMPLETE_MATCH(:q, h.url, h.title, NULL, 1, 1, 1, 1, :mb, :sb, NULL)`,
      { q, mb: ACM_MATCH(), sb: ACM_BEHAVIOR() }
    );
    return Number(r[0]?.getResultByName('n')) || 0;
  }

  // ---- deletes ----

  /**
   * A delete hides this row: the pending one (Undo shows it again), or a commit VitreHistory is
   * still running (until Places has removed its visits). The panel draws only rows this leaves.
   */
  hides(r: { guid: string; dayStart: number; last: number }): boolean {
    if (this.current?.set.covers(r)) return true;
    return this.committing(r);
  }

  /** A commit still running takes this row. */
  private committing(r: { guid: string; dayStart: number; last: number }): boolean {
    for (const set of this.inflight) if (set.covers(r)) return true;
    return false;
  }

  private setPending(p: Pending | null): void {
    this.current = p ? { p, set: new Ranges(p.ranges) } : null;
  }

  /** The range of one page's visits on one day (Today: up to the moment of the delete). */
  private rangeOf(dayStart: number, at: number, guid?: string, url?: string): Range {
    // Both ends inclusive; the next midnight less 0.001 ms keeps the day's last millisecond (VitreHistory header).
    const end = Math.min(nextDayStart(dayStart) - 0.001, at);
    return { url, guid, dayStart, begin: dayStart, end };
  }

  /** Delete rows (each from its own day). A pending delete commits first. */
  deleteRows(rows: Row[]): Pending | null {
    const list = rows.filter((r) => !this.hides(r));
    if (!list.length) return null;
    this.commit();
    const at = this.clock();
    const seen = new Set<string>();
    const ranges: Range[] = [];
    for (const r of list) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      seen.add(k);
      ranges.push(this.rangeOf(r.dayStart, at, r.guid, r.url));
    }
    this.setPending({ kind: list.length === 1 ? 'row' : 'selection', rows: list, days: [], ranges, at, pages: list.length });
    this.afterDelete();
    return this.pending;
  }

  /**
   * Delete one day's visits. A pending delete commits first. The line counts the pages the day lists
   * in All history: when that day isn't loaded (Delete day on a search-results heading, which shows
   * only the matches), they are counted in Places first (pages -1 until then).
   */
  deleteDay(dayStart: number): Pending | null {
    this.commit();
    const at = this.clock();
    const range = this.rangeOf(dayStart, at);
    const taken = (r: Row): boolean => r.last <= range.end && !this.committing(r);
    const loaded = this.days.find((d) => d.start === dayStart);
    const rows = loaded?.rows.filter(taken) ?? [];
    const results = this.results.find((d) => d.start === dayStart)?.rows.filter(taken) ?? [];
    const all = [...rows, ...results.filter((r) => !rows.some((x) => x.guid === r.guid))];
    const p: Pending = { kind: 'day', rows: all, days: [dayStart], ranges: [range], at, pages: loaded ? all.length : -1 };
    this.setPending(p);
    if (p.pages < 0) void this.countDay(p);
    this.afterDelete();
    return p;
  }

  /** The pages a day delete takes, for a day not loaded in All history: those it lists, and its rows shown. */
  private async countDay(p: Pending): Promise<void> {
    let pages: number;
    try {
      const db = await readDb();
      const range = p.ranges[0];
      const rows = await db.executeCached(
        `SELECT h.guid, MAX(v.visit_date) AS last FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
         WHERE v.visit_date >= :b AND v.visit_date <= :e AND v.visit_type NOT IN ${UNCOUNTED} AND h.hidden = 0 AND ${SCHEMES}
         GROUP BY v.place_id`,
        { b: range.begin * 1000, e: Math.floor(range.end * 1000) }
      );
      const guids = new Set(p.rows.map((r) => r.guid));
      for (const r of rows) {
        const row = { guid: String(r.getResultByName('guid')), dayStart: range.dayStart, last: Math.floor(Number(r.getResultByName('last')) / 1000) };
        // A page an earlier delete is still removing from that day is not this one's.
        if (!this.committing(row)) guids.add(row.guid);
      }
      pages = guids.size;
    } catch (e) {
      console.warn('Deer history: could not count the day', e);
      pages = p.rows.length;
    }
    if (this.pending !== p) return;
    p.pages = pages;
    this.emit({ type: 'pending' });
  }

  private afterDelete(): void {
    const p = this.pending!;
    void this.findRemovals(p);
    this.emit({ type: 'pending' });
  }

  /**
   * The pages this delete would take out of history entirely (no visit outside its ranges): this
   * window's address field leaves them out until the commit has finished (spec "Deleting, and undo").
   */
  private async findRemovals(p: Pending): Promise<void> {
    try {
      const db = await readDb();
      const guids = new Set(p.ranges.filter((r) => r.guid).map((r) => r.guid!));
      for (const range of p.ranges.filter((r) => !r.guid)) {
        const rows = await db.executeCached(
          `SELECT DISTINCT h.guid FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id WHERE v.visit_date >= :b AND v.visit_date <= :e`,
          { b: range.begin * 1000, e: Math.floor(range.end * 1000) }
        );
        for (const r of rows) guids.add(String(r.getResultByName('guid')));
      }
      const gone: string[] = [];
      const all = [...guids];
      for (let i = 0; i < all.length; i += 400) {
        const chunk = all.slice(i, i + 400);
        const params: Record<string, string> = {};
        chunk.forEach((g, j) => (params[`g${j}`] = g));
        // A statement of its own size each time: execute(), not the statement cache.
        const rows = await db.execute(
          `SELECT h.guid, h.url, v.visit_date AS d FROM moz_places h LEFT JOIN moz_historyvisits v ON v.place_id = h.id
           WHERE h.guid IN (${chunk.map((_, j) => `:g${j}`).join(',')})`,
          params
        );
        const visits = new Map<string, { url: string; dates: number[] }>();
        for (const r of rows) {
          const g = String(r.getResultByName('guid'));
          const entry = visits.get(g) ?? { url: String(r.getResultByName('url')), dates: [] };
          const d = r.getResultByName('d');
          if (d !== null && d !== undefined) entry.dates.push(Number(d));
          visits.set(g, entry);
        }
        for (const [g, v] of visits) {
          const inside = (us: number): boolean => p.ranges.some((r) => (!r.guid || r.guid === g) && us >= r.begin * 1000 && us <= Math.floor(r.end * 1000));
          if (v.dates.every(inside)) gone.push(v.url);
        }
      }
      if (this.pending === p) {
        this.removalFor = p;
        setPendingRemoval(gone);
      }
    } catch (e) {
      console.warn('Deer history: could not tell which pages a delete removes', e);
    }
  }

  /** Bring the pending delete's rows back (nothing was removed: Places is unchanged). */
  undo(): Pending | null {
    const cur = this.current;
    if (!cur) return null;
    this.current = null;
    this.removalFor = null;
    setPendingRemoval([]);
    this.mergeRevisits(cur.set);
    this.emit({ type: 'pending' });
    return cur.p;
  }

  /**
   * A page visited again while its row was pending got a fresh row at the top of Today (spec
   * "Deleting, and undo"). Undo brings the deleted row back, in its place, with the newer visit's time
   * (a visit to a page already listed updates its row in place), and the fresh row goes: one row per
   * page per day.
   */
  private mergeRevisits(set: Ranges): void {
    for (const d of this.days) {
      const back = new Map<string, Row>();
      for (const r of d.rows) if (set.covers(r)) back.set(r.guid, r);
      if (!back.size) continue;
      const fresh = new Set<Row>();
      for (const r of d.rows) {
        const old = back.get(r.guid);
        if (!old || old === r || set.covers(r)) continue;
        if (r.last > old.last) old.last = r.last;
        if (r.title) old.title = r.title;
        old.icon ||= r.icon;
        fresh.add(r);
      }
      if (fresh.size) d.rows = d.rows.filter((r) => !fresh.has(r));
    }
  }

  /** Run the pending delete now. Its rows leave the model; the address field's filter goes once Places is done. */
  commit(): Promise<void> {
    const cur = this.current;
    if (!cur) return Promise.resolve();
    const p = cur.p;
    this.current = null;
    // Until Places has removed them, rows of these ranges read again (a reopen, a reload) stay hidden.
    this.inflight.push(cur.set);
    this.drop(cur.set);
    const done = this.commitRanges(p.ranges.map(({ url, begin, end }) => ({ url, begin, end })));
    void done.then(() => {
      this.drop(cur.set);
      this.inflight = this.inflight.filter((s) => s !== cur.set);
      if (!this.pending && this.removalFor === p) {
        this.removalFor = null;
        setPendingRemoval([]);
      } else if (!this.pending) setPendingRemoval([]);
    });
    this.emit({ type: 'pending' });
    return done;
  }

  /** Take the rows these ranges cover out of the model (Places is removing their visits). */
  private drop(set: Ranges): void {
    const keep = (days: Day[]): Day[] => {
      for (const d of days) d.rows = d.rows.filter((r) => !set.covers(r));
      return days.filter((d) => d.rows.length);
    };
    this.days = keep(this.days);
    this.results = keep(this.results);
    if (this.shownDays) this.shownDays = keep(this.shownDays);
  }

  // ---- live updates (spec "Live, while the panel is open") ----

  /** Follow Places while the panel is open or stepped aside for a peek. */
  watch(on: boolean): void {
    if (on && !this.unobserve) this.unobserve = observe((events) => this.onEvents(events));
    else if (!on && this.unobserve) {
      this.unobserve();
      this.unobserve = null;
      window.clearTimeout(this.bulkTimer);
      this.bulkTimer = 0;
    }
  }

  private onEvents(events: PlacesEvent[]): void {
    if (events.length >= BULK || events.some((e) => e.type === 'history-cleared')) {
      window.clearTimeout(this.bulkTimer);
      this.bulkTimer = window.setTimeout(() => {
        this.bulkTimer = 0;
        const rows = Math.max(MIN_ROWS, this.days.reduce((n, d) => n + d.rows.length, 0));
        void this.reload(rows, true);
        if (this.query) void this.search(this.query);
        void this.readSummary();
      }, BULK_DELAY);
      return;
    }
    for (const e of events) {
      if (e.type === 'page-visited') this.visited(e);
      else if (e.type === 'page-title-changed') this.titled(e);
      else if (e.type === 'page-removed') void this.removed(e);
    }
  }

  /**
   * A new visit: a page not yet under Today appears at its top, a page already there gets its time
   * updated in place. While search results show, they stay as they are (new visits are ignored
   * there), but All history still takes the visit, which shows once the search ends.
   */
  private visited(e: PlacesEvent): void {
    // Before the first day page, or while a reload has read nothing yet, the read itself brings it.
    if (!this.ready || (this.loading && !this.days.length)) return;
    if (e.hidden || [0, 4, 7, 8, 9].includes(e.transition) || !/^(https?|file):/i.test(e.url)) return;
    const day = dayStartOf(e.time);
    const today = this.today();
    if (day !== today) return;
    let group = this.days[0];
    if (!group || group.start !== today) {
      if (group && group.start > today) return;
      group = { start: today, rows: [] };
      this.days.unshift(group);
    }
    const listed = group.rows.filter((r) => r.guid === e.guid);
    const shown = listed.find((r) => !this.hides(r));
    if (shown) {
      if (e.time > shown.last) shown.last = e.time;
      if (e.title) shown.title = e.title;
      this.emit({ type: 'visited', row: shown, added: false });
      return;
    }
    // A visit a delete's range takes (dated no later than the delete) goes with it: it joins the row
    // the delete hides (Undo shows that row with it), and never makes a row of its own.
    if (this.hides({ guid: e.guid, dayStart: today, last: e.time })) {
      const hidden = listed[0];
      if (hidden && e.time > hidden.last) hidden.last = e.time;
      if (hidden && e.title) hidden.title = e.title;
      return;
    }
    const row: Row = { id: rowId(), guid: e.guid, url: e.url, title: e.title, last: e.time, dayStart: today, icon: group.rows.find((r) => r.guid === e.guid)?.icon ?? false };
    group.rows.unshift(row);
    this.emit({ type: 'visited', row, added: true });
    // Its favicon may already be known.
    void this.iconOf(row);
  }

  private async iconOf(row: Row): Promise<void> {
    try {
      const db = await readDb();
      const r = await db.executeCached(`SELECT ${HAS_ICON} AS icon FROM moz_places h WHERE h.url_hash = hash(:url) AND h.url = :url`, { url: row.url });
      if (r.length && !!r[0].getResultByName('icon') !== row.icon) {
        row.icon = !row.icon;
        this.emit({ type: 'titled', rows: [row] });
      }
    } catch {
      /* the globe stays */
    }
  }

  private titled(e: PlacesEvent): void {
    const rows = [...this.days, ...this.results].flatMap((d) => d.rows).filter((r) => r.guid === e.guid);
    if (!rows.length) return;
    for (const r of rows) r.title = e.title;
    this.emit({ type: 'titled', rows });
  }

  /**
   * A deletion made elsewhere (another window's panel, the address field's Shift+Delete, Clear
   * browsing data): the rows it emptied go. A page with visits left keeps the rows of days that
   * still have one (one query on its url_hash over the loaded days). This window's own commits are
   * already out of the model (their rows read again stay hidden until it is done): nothing to do.
   */
  private async removed(e: PlacesEvent): Promise<void> {
    const mine = (d: Day[]): Row[] => d.flatMap((x) => x.rows).filter((r) => r.guid === e.guid && !this.committing(r));
    let rows = [...mine(this.days), ...mine(this.results)];
    if (!rows.length) return;
    if (e.partial) {
      try {
        const db = await readDb();
        const oldest = Math.min(...rows.map((r) => r.dayStart));
        const visits = await db.executeCached(
          `SELECT v.visit_date AS d FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
           WHERE h.url_hash = hash(:url) AND h.url = :url AND v.visit_type NOT IN ${UNCOUNTED} AND v.visit_date >= :oldest`,
          { url: e.url, oldest: oldest * 1000 }
        );
        const latest = new Map<number, number>();
        for (const v of visits) {
          const ms = Math.floor(Number(v.getResultByName('d')) / 1000);
          const day = dayStartOf(ms);
          latest.set(day, Math.max(latest.get(day) ?? 0, ms));
        }
        rows = [...mine(this.days), ...mine(this.results)];
        const gone: Row[] = [];
        for (const r of rows) {
          const keep = latest.get(r.dayStart);
          // A search result is listed under its last visit's day: it goes when that day has none left.
          if (keep === undefined) gone.push(r);
          else if (keep < r.last && this.days.some((d) => d.rows.includes(r))) r.last = keep;
        }
        rows = gone;
      } catch {
        return;
      }
    }
    if (!rows.length) return;
    const drop = new Set(rows);
    for (const d of this.days) d.rows = d.rows.filter((r) => !drop.has(r));
    this.days = this.days.filter((d) => d.rows.length);
    for (const d of this.results) d.rows = d.rows.filter((r) => !drop.has(r));
    this.results = this.results.filter((d) => d.rows.length);
    if (this.pending) this.pending.rows = this.pending.rows.filter((r) => !drop.has(r));
    this.emit({ type: 'removed', rows });
  }

  /** The panel closed for good (not stepped aside): stop following Places; the next open reads afresh. */
  dispose(): void {
    this.watch(false);
    this.searchSerial++;
    this.generation++;
  }
}
