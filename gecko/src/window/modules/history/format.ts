// Words and dates of the History panel (../design/HISTORY-SPEC.md "Day heading", "Toolbar", "Row").
// Days start at local midnight: every boundary is new Date(y, m, d), never steps of 86 400 000 ms, so
// a daylight-saving day lasts 23 or 25 hours. Dates and times follow the Windows locale (gecko.ts
// dateFormat: mozIntl reads the OS regional formats).
import { dateFormat, number } from './gecko';

/** Local midnight that starts the day of `ms`. */
export function dayStartOf(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight that starts the day after the one starting at `dayStart`. */
export function nextDayStart(dayStart: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Local midnight that starts the day before. */
export function prevDayStart(dayStart: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
}

const DAY_MONTH = { weekday: 'long', day: 'numeric', month: 'long' } as const;
const DAY_MONTH_YEAR = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const;

/** A day heading: its label, the dim date after Today / Yesterday, its accessible date, and Delete day's name. */
export interface DayLabel {
  /** "Today", "Yesterday", "Tuesday, 21 October", "Saturday, 14 June 2025". */
  label: string;
  /** The date after Today and Yesterday ("Thursday, 23 October"); '' for other days. */
  sub: string;
  /** "Today, Thursday 23 October 2026" (the rowheader's name, before the page count). */
  aria: string;
  /** The words Delete day and the undo line name the day with: "Today", "Tuesday, 21 October". */
  name: string;
}

export function dayLabel(dayStart: number, today: number): DayLabel {
  const full = dateFormat(DAY_MONTH_YEAR).format(dayStart);
  if (dayStart === today || dayStart === prevDayStart(today)) {
    const label = dayStart === today ? 'Today' : 'Yesterday';
    return { label, sub: dateFormat(DAY_MONTH).format(dayStart), aria: `${label}, ${full}`, name: label };
  }
  const sameYear = new Date(dayStart).getFullYear() === new Date(today).getFullYear();
  const label = sameYear ? dateFormat(DAY_MONTH).format(dayStart) : full;
  return { label, sub: '', aria: full, name: label };
}

/** Windows' short time: "14:32" or "2:32 PM". */
export function timeOf(ms: number): string {
  return dateFormat({ hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** The tooltip's third line: "Thursday, 23 October 2026, 14:32". */
export function fullDateTime(ms: number): string {
  return `${dateFormat(DAY_MONTH_YEAR).format(ms)}, ${timeOf(ms)}`;
}

/** A <time datetime> value in local time: "2026-10-23T14:32". */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** When a tab or window was closed: "14:36" today, "Yesterday", "21 Oct" for anything older (spec "Recently closed"). */
export function closedWhen(ms: number, today: number): string {
  if (ms >= today) return timeOf(ms);
  if (ms >= prevDayStart(today)) return 'Yesterday';
  return dateFormat({ day: 'numeric', month: 'short' }).format(ms);
}

/** The summary's date: "3 March 2026". */
export function longDate(ms: number): string {
  return dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(ms);
}

export const count = (n: number): string => number(n);

export const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;

/** A title quoted in the undo line: cut at 40 characters plus "…" (spec "Toolbar"). */
export function quoteTitle(title: string): string {
  const t = title.trim();
  return t.length > 40 ? `${t.slice(0, 40).trimEnd()}…` : t;
}

/** The host without "www." ("Local file" for file: pages): the address column. */
export function hostOf(url: string): string {
  if (/^file:/i.test(url)) return 'Local file';
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

/** The address without its scheme ("fieldnotes.press/archive"): a row with no title shows it. */
export function bare(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

/** The words of a search, lower case. */
export function wordsOf(q: string): string[] {
  return q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Where the words fall in `s` (merged, in order): [start, end) pairs. */
export function hitsIn(s: string, words: string[]): [number, number][] {
  if (!words.length || !s) return [];
  const low = s.toLocaleLowerCase();
  // Lower-casing can change the length (rare: İ); then nothing is marked rather than the wrong letters.
  if (low.length !== s.length) return [];
  const all: [number, number][] = [];
  for (const w of words) {
    let i = low.indexOf(w);
    while (i >= 0) {
      all.push([i, i + w.length]);
      i = low.indexOf(w, i + w.length);
    }
  }
  all.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of all) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/**
 * The address column of a search result: the host, or, when a word matches only the path or the
 * query, the host and the matching segment kept whole ("fieldnotes.press/…/float-glass"; spec
 * "Search": the host is the part that gets cut).
 */
export function addressFor(url: string, title: string, words: string[]): string {
  const host = hostOf(url);
  if (!words.length || /^file:/i.test(url)) return host;
  let rest = '';
  try {
    const u = new URL(url);
    rest = `${u.pathname}${u.search}`;
  } catch {
    return host;
  }
  const low = (s: string): string => s.toLocaleLowerCase();
  const w = words.find((x) => !low(title).includes(x) && !low(host).includes(x) && low(rest).includes(x));
  if (!w) return host;
  const segs = rest.split(/[/?&]/).filter(Boolean);
  const i = segs.findIndex((s) => low(s).includes(w));
  if (i < 0) return host;
  let seg = segs[i];
  try {
    seg = decodeURIComponent(seg);
  } catch {
    /* keep it encoded */
  }
  return `${host}${i > 0 ? '/…/' : '/'}${seg}`;
}
