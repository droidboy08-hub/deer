// Address-bar text helpers. Ported from app/src/renderer/url.ts.
//
// State note: the search engine is module state. Every bundle that imports this file has its own
// copy, so each must call setSearchEngine(settings.searchEngine) itself (the window's Browser does).
// Code that only needs HOME_URL / isHomeUrl imports ./home, which carries no state.
import { SEARCH_ENGINES, type Settings } from './settings';

export { HOME_URL, isHomeUrl } from './home';

let SEARCH = SEARCH_ENGINES.google.url;

export function setSearchEngine(engine: Settings['searchEngine']): void {
  SEARCH = (SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google).url;
}

/** Turn what was typed into a URL: an address if it looks like one, otherwise a search. */
export function resolveInput(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/^(https?|file|about|view-source|data):/i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[^/?#\s]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
  return SEARCH + encodeURIComponent(t);
}

export function searchUrl(text: string): string {
  return SEARCH + encodeURIComponent(text.trim());
}

export function looksLikeAddress(text: string): boolean {
  const r = resolveInput(text);
  return !!r && !r.startsWith(SEARCH);
}

export function displayHost(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'view-source:') return 'view-source';
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop() || 'file');
    if (u.protocol === 'about:') return url;
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export function stripUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}
