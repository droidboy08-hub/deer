// Catching a download started again on its page (spikes/downloader/RESUME-DESIGN.md 2.2 and G1, Phase
// 3). A Link expired row waits for its address; Refresh address opens its page and arms it. When the
// person starts the download again (a click Firefox hands over, Alt+click, Add link, Download copied
// link, the 'downloads' service), the engine asks preMatch() which waiting row it may be. These are only
// nominators: they pick a candidate, the byte proof (proof.ts proveAddress()) decides.
//
// Score (G1, "Catching a re-click in adopt()"): the armed tab +5, the same name stem +3, the same page
// +2, the same path shape +3, the same site +1. 5 or more is a pre-match. The hard rules of 2.1 (the
// private flag and container equal, a one-file download) are the engine's: it only offers rows that pass
// them.
//
// realFile() is stricter than the score: whether other bytes may make the waiting row File changed (G1
// step 4, "the real file: same name and page, different bytes"; 2.4 R2). An address's last path segment
// nominates (score()) but never names the file there: /fetch?id=1 and /fetch?id=2, Drive's /uc?id=, are
// two files behind one script (review of Phase 3: an unrelated download behind the same endpoint was
// swallowed as the waiting row's changed file).
//
// Keep partial file (3 G3): the unbroken beginning of the saved bytes from byte 0, as
// "<stem> (partial).<ext>".
import { extOf, nameFromUrl } from './naming';
import type { Segment } from './ranged';

/** A pre-match needs at least this score (RESUME-DESIGN.md G1). */
export const PRE_MATCH = 5;

/** What the engine knows of a waiting row, for scoring. */
export interface Waiting {
  /** The tab Refresh address opened its page in, while the row is armed (0: none). */
  armedBrowserId: number;
  /** Its names: the file's, the server's (Content-Disposition), and the last part of each address. */
  names: string[];
  pageUrl: string;
  /** Its addresses: the download's own, the final one, every redirect hop and the ones it replaced. */
  urls: string[];
}

/** What is known of the new start. */
export interface Start {
  url: string;
  browserId: number;
  pageUrl: string;
  names: string[];
}

/** A name as names are compared: lower case, without its extension and without the " (n)" that uniquePath adds. */
function base(name: string): string {
  let s = (name || '').trim();
  const ext = extOf(s);
  if (ext) s = s.slice(0, -(ext.length + 1));
  return s
    .replace(/\s*\(\d+\)$/, '')
    .trim()
    .toLowerCase();
}

/**
 * A name's stem as 2.2 compares names: lower case, without its extension and without the " (n)" that
 * uniquePath adds ("Song (1).MP3" and "song.mp3" are the same). Empty for names nobody chose (an opaque
 * one: "download", "index", a long hex token), which say nothing about which file it is.
 */
export function stem(name: string): string {
  const s = base(name);
  if (!s || ['download', 'file', 'index', 'get', 'dl', 'attachment', 'media', 'video', 'audio'].includes(s)) return '';
  const compact = s.replace(/[^a-z0-9]/g, '');
  return compact.length >= 16 && /^[0-9a-f]+$/.test(compact) ? '' : s;
}

/** The stems of a set of names and addresses (an address gives its last path segment). */
export function stems(names: string[], urls: string[] = []): Set<string> {
  const out = new Set<string>();
  for (const n of [...names, ...urls.map((u) => nameFromUrl(u))]) {
    const s = stem(n);
    if (s) out.add(s);
  }
  return out;
}

/** An address's shape (2.2): origin and path, without the query or fragment; '' when it is not one. */
export function pathShape(url: string): string {
  try {
    const u = new URL(url);
    return /^https?:$/i.test(u.protocol) ? `${u.protocol}//${u.host}${u.pathname}`.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** A page's address without its #fragment (2.2: the source page). */
export function pageKey(url: string): string {
  return (url || '').replace(/#.*$/, '');
}

/**
 * The score of a waiting row for a new start (G1): +5 for the tab it was armed in, +3 for a name stem in
 * common, +2 for the same page, +3 for the same path shape, +1 for the same site (`sameSite`, the
 * engine's eTLD+1 comparison).
 */
export function score(w: Waiting, s: Start, sameSite: (a: string, b: string) => boolean): number {
  let n = 0;
  if (w.armedBrowserId && s.browserId && w.armedBrowserId === s.browserId) n += 5;
  const ours = stems(w.names, w.urls);
  for (const x of stems(s.names, [s.url])) {
    if (ours.has(x)) {
      n += 3;
      break;
    }
  }
  if (s.pageUrl && w.pageUrl && pageKey(s.pageUrl) === pageKey(w.pageUrl)) n += 2;
  const shape = pathShape(s.url);
  if (shape && w.urls.some((u) => pathShape(u) === shape)) n += 3;
  if (w.urls.length && sameSite(s.url, w.urls[0])) n += 1;
  return n;
}

/** One side of realFile(): where the download came from, the names it was given, and its addresses. */
export interface Named {
  pageUrl: string;
  /** The file's name (the row's, or the name Firefox or the caller suggested for the start). */
  names: string[];
  /** The server's name for it (Content-Disposition); '' when it gave none. */
  disposition: string;
  urls: string[];
}

/**
 * The names that say which file it is: the stems of the names given, except a script's name taken from
 * an address (the last path segment when it has no extension: "fetch" of /fetch?id=1, "uc" of Drive's
 * /uc?id=, "getfile", even with an extension Firefox added from the type). A file named in its address
 * (/files/song.mp3?sig=...) keeps its name.
 */
function fileNames(n: Named): Set<string> {
  const scripts = new Set(
    n.urls
      .map((u) => nameFromUrl(u))
      .filter((x) => x && !extOf(x))
      .map(base)
  );
  const out = new Set<string>();
  for (const name of [...n.names, n.disposition]) {
    const s = stem(name);
    if (s && !scripts.has(s)) out.add(s);
  }
  return out;
}

/**
 * Is a download started again the waiting row's own file, in another version (RESUME-DESIGN.md G1 step
 * 4: "the real file (same name and page, different bytes)")? Only then do its other bytes make the row
 * File changed; anything else is not the row's ("not ours") and starts as it always did, in a row of its
 * own. It takes:
 *   - the same page (without its #fragment), so a start with no page (Add link, a copied link) is never
 *     the real file of another version: a different file there makes its own row;
 *   - when both servers named it (Content-Disposition), the same name (2.4 R2: another
 *     dispositionName is another file);
 *   - and a name in common among the names a person or a server gave (fileNames(): never an opaque
 *     one, never a script's name from the address).
 */
export function realFile(row: Named, start: Named): boolean {
  if (!row.pageUrl || !start.pageUrl || pageKey(row.pageUrl) !== pageKey(start.pageUrl)) return false;
  if (row.disposition && start.disposition && base(row.disposition) !== base(start.disposition)) return false;
  const ours = fileNames(row);
  for (const x of fileNames(start)) if (ours.has(x)) return true;
  return false;
}

/**
 * Keep partial file (RESUME-DESIGN.md 3 G3): the bytes saved without a gap from byte 0, the unbroken
 * beginning of the file. Segments may be in any order; a stretch that starts past the end of what is
 * covered so far ends it.
 */
export function unbroken(segments: Segment[]): number {
  let covered = 0;
  for (const seg of [...segments].filter((x) => x.received > 0).sort((a, b) => a.start - b.start)) {
    if (seg.start > covered) break;
    covered = Math.max(covered, seg.start + seg.received);
  }
  return covered;
}

/** "song.mp3" -> "song (partial).mp3": the name Keep partial file saves under (3 G3). */
export function partialName(filename: string): string {
  const ext = extOf(filename);
  const base = ext ? filename.slice(0, -(ext.length + 1)) : filename;
  return `${base} (partial)${ext ? `.${ext}` : ''}`;
}
