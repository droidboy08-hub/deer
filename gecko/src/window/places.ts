// History for the address field: Firefox's Places database, read directly.
// Recipe: spikes/keys/RESULT.md section D and the verifier's correction 11 (sizes: 20-150 ms per
// query at 60 000 places with the spike's single query).
//
// Firefox internals used here (all version-157 behaviour):
//   - PlacesUtils.promiseLargeCacheDBConnection()  gre/modules/PlacesUtils.sys.mjs: the read-only
//     connection Firefox's own address bar queries, so typing never blocks a write.
//   - conn.executeCached(sql, params), conn.interrupt()  gre/modules/Sqlite.sys.mjs. interrupt()
//     aborts the statement that is running (NS_ERROR_ABORT); UrlbarProviderPlaces cancels the same way.
//     Sqlite.sys.mjs refuses a LIKE whose right-hand side is not a bare binding.
//   - Tables moz_places (url, title, frecency, hidden, last_visit_date, origin_id) and moz_origins
//     (id, host), toolkit/components/places (the schema is compiled in; re-check on a runtime update).
//   - PlacesUtils.history.remove(url): its boolean is not "the row is gone" for a bookmarked page.
//   - page-icon:<url>: the favicon Places has for a page, usable as an <img src> in chrome.
//
// Shape of a search (sized for large histories):
//   1. hosts first: moz_origins is small (one row per site), so "sites whose host starts with what
//      was typed" is cheap, and those rows lead the list, as a typed host usually is the target;
//   2. then any page whose URL or title contains every word, walked in frecency order so SQLite can
//      stop at the limit instead of sorting the whole table;
//   3. an empty text lists the most recent visits (Ctrl+H).
// One search runs at a time per window: a newer one interrupts the older one, whose promise then
// resolves to null ("superseded").

export interface HistoryRow {
  url: string;
  title: string;
}

const likeEscape = (s: string): string => s.replace(/[%_/]/g, '/$&');

let placesUtils: any = null;
const places = (): any => (placesUtils ??= ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils);

let connection: Promise<any> | null = null;
const db = (): Promise<any> => (connection ??= places().promiseLargeCacheDBConnection());

const BASE = 'h.hidden = 0 AND h.last_visit_date NOT NULL';

const COLUMNS = 'h.url, h.title, h.frecency, h.visit_count, h.last_visit_date';

/**
 * Rows in the order SQLite returned them, with ties in frecency broken by visit count, then by the
 * last visit. Places computes frecency a little after a visit, so fresh rows all carry the same
 * one; breaking ties here keeps the query itself a plain walk of the frecency index.
 */
function rows(result: any[], ranked = true): HistoryRow[] {
  const all = result.map((r) => ({
    url: r.getResultByName('url') as string,
    title: (r.getResultByName('title') as string) || '',
    frecency: Number(r.getResultByName('frecency')) || 0,
    visits: Number(r.getResultByName('visit_count')) || 0,
    last: Number(r.getResultByName('last_visit_date')) || 0,
  }));
  if (ranked) all.sort((a, c) => c.frecency - a.frecency || c.visits - a.visits || c.last - a.last);
  return all.map(({ url, title }) => ({ url, title }));
}

export class HistorySearch {
  private running = 0;
  private serial = 0;
  /** Duration of the last finished search in ms, for tests and diagnostics. */
  lastMs = 0;

  /** Up to `limit` rows for the text, best first; null when a newer search replaced this one. */
  async query(text: string, limit: number): Promise<HistoryRow[] | null> {
    const mine = ++this.serial;
    const started = performance.now();
    const conn = await db();
    if (this.running) {
      try {
        conn.interrupt();
      } catch {
        /* nothing was running after all */
      }
    }
    if (mine !== this.serial) return null;
    this.running++;
    try {
      const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
      if (!tokens.length) {
        return rows(await conn.executeCached(`SELECT ${COLUMNS} FROM moz_places h WHERE ${BASE} ORDER BY h.last_visit_date DESC LIMIT :limit`, { limit }), false);
      }
      const params: Record<string, unknown> = { limit };
      const words: string[] = [];
      tokens.forEach((t, i) => {
        params[`t${i}`] = `%${likeEscape(t)}%`;
        words.push(`(h.url LIKE :t${i} ESCAPE '/' OR IFNULL(h.title, '') LIKE :t${i} ESCAPE '/')`);
      });
      const where = `${BASE} AND ${words.join(' AND ')}`;
      // 1. Sites whose host starts with the first word.
      const prefix = likeEscape(tokens[0]);
      const hosts = rows(
        await conn.executeCached(
          `SELECT ${COLUMNS} FROM moz_origins o JOIN moz_places h ON h.origin_id = o.id
           WHERE (o.host LIKE :p ESCAPE '/' OR o.host LIKE :pw ESCAPE '/') AND ${where}
           ORDER BY h.frecency DESC LIMIT :limit`,
          { ...params, p: `${prefix}%`, pw: `www.${prefix}%` }
        )
      );
      if (mine !== this.serial) return null;
      if (hosts.length >= limit) return hosts;
      // 2. Everything else, most used first.
      const rest = rows(await conn.executeCached(`SELECT ${COLUMNS} FROM moz_places h WHERE ${where} ORDER BY h.frecency DESC LIMIT :limit`, params));
      if (mine !== this.serial) return null;
      const have = new Set(hosts.map((r) => r.url));
      return [...hosts, ...rest.filter((r) => !have.has(r.url))].slice(0, limit);
    } catch (e) {
      // Interrupted by a newer search, or the database is busy shutting down.
      if (mine === this.serial) console.warn('Deer: history search did not finish', e);
      return mine === this.serial ? [] : null;
    } finally {
      this.running--;
      if (mine === this.serial) this.lastMs = performance.now() - started;
    }
  }

  /** Drop whatever is running (the field closed). */
  cancel(): void {
    this.serial++;
    if (!this.running || !connection) return;
    void connection.then((conn) => {
      try {
        if (this.running) conn.interrupt();
      } catch {
        /* nothing running */
      }
    });
  }
}

/** Forget a page (Shift+Delete on a history suggestion). */
export async function removeFromHistory(url: string): Promise<void> {
  try {
    await places().history.remove(url);
  } catch (e) {
    console.error('Deer: could not remove a history entry', e);
  }
}

/** The favicon Places has for a page, as an <img src> (Firefox's default globe when it has none). */
export const pageIcon = (url: string): string => `page-icon:${url}`;
