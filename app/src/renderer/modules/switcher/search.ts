// Tab search: every word of the query must appear in the title or the address.
import type { Tab } from '../../model';
import { displayHost, stripUrl } from '../../url';

export type Range = [number, number];

export interface Match {
  title: Range[];
  /** Ranges in the address without its scheme (host and path). */
  url: Range[];
}

export interface TabText {
  title: string;
  host: string;
  /** Address without scheme or www., for showing where a word matched in the path. */
  url: string;
}

export function tabText(t: Tab): TabText {
  if (t.kind === 'home') return { title: 'Home', host: 'Start page', url: '' };
  // A data: address is the whole document; it says nothing useful as a second line.
  if (/^data:/i.test(t.url)) return { title: t.title || 'New tab', host: '', url: '' };
  const host = displayHost(t.url);
  return { title: t.title || host || 'New tab', host, url: stripUrl(t.url) };
}

export function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchTab(t: Tab, query: string): Match | null {
  const ws = words(query);
  if (!ws.length) return null;
  const text = tabText(t);
  const title = text.title.toLowerCase();
  const url = (t.kind === 'home' ? text.host : text.url).toLowerCase();
  const m: Match = { title: [], url: [] };
  for (const w of ws) {
    const inTitle = occurrences(title, w);
    const inUrl = occurrences(url, w);
    if (!inTitle.length && !inUrl.length) return null;
    m.title.push(...inTitle);
    m.url.push(...inUrl);
  }
  m.title = merge(m.title);
  m.url = merge(m.url);
  return m;
}

/** The second line of a card: the host, or the whole address when a word matched in its path. */
export function detailLine(t: Tab, m: Match | null): { text: string; ranges: Range[] } {
  const text = tabText(t);
  if (t.kind === 'home') return { text: text.host, ranges: m?.url ?? [] };
  if (!m) return { text: text.host, ranges: [] };
  const inPath = m.url.some(([, end]) => end > text.host.length);
  if (inPath) return { text: text.url, ranges: m.url };
  return { text: text.host, ranges: m.url.filter(([, end]) => end <= text.host.length) };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** HTML for text with the matched ranges marked. */
export function highlight(text: string, ranges: Range[]): string {
  let out = '';
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at || s >= text.length) continue;
    out += esc(text.slice(at, s)) + `<mark>${esc(text.slice(s, Math.min(e, text.length)))}</mark>`;
    at = Math.min(e, text.length);
  }
  return out + esc(text.slice(at));
}

function occurrences(hay: string, needle: string): Range[] {
  const out: Range[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push([i, i + needle.length]);
  return out;
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
