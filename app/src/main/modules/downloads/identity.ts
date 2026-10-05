// The page's identity for a download: the session's User-Agent and cookies, and the page as
// Referer (Chromium's default policy: full URL on the same origin, the origin across origins,
// nothing from https to http). Media fetched by a page's player also sends Origin.
import type { Session } from 'electron';
import type { Headers } from './net';

export class Identity {
  private cookies = new Map<string, { at: number; value: string }>();

  constructor(private ses: Session, readonly pageUrl: string, private withOrigin: boolean) {}

  /** Forget cached cookies, so the next request asks the session again (after a 401 or 403). */
  refresh = (): void => {
    this.cookies.clear();
  };

  headers = async (url: string): Promise<Headers> => {
    const h: Headers = {
      'User-Agent': this.ses.getUserAgent(),
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'Accept-Language': acceptLanguage(),
    };
    const referer = this.referer(url);
    if (referer) h.Referer = referer;
    if (this.withOrigin) {
      const origin = originOf(this.pageUrl);
      if (origin && origin !== originOf(url)) h.Origin = origin;
    }
    const cookie = await this.cookieFor(url);
    if (cookie) h.Cookie = cookie;
    return h;
  };

  private referer(url: string): string {
    if (!/^https?:/i.test(this.pageUrl)) return '';
    try {
      const page = new URL(this.pageUrl);
      const target = new URL(url);
      if (page.protocol === 'https:' && target.protocol === 'http:') return '';
      page.hash = '';
      return page.origin === target.origin ? page.toString() : `${page.origin}/`;
    } catch {
      return '';
    }
  }

  private async cookieFor(url: string): Promise<string> {
    let key = url;
    try {
      const u = new URL(url);
      key = `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`;
    } catch {
      return '';
    }
    const hit = this.cookies.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    let value = '';
    try {
      const list = await this.ses.cookies.get({ url });
      value = list.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch {
      value = '';
    }
    this.cookies.set(key, { at: Date.now(), value });
    return value;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

let language = '';
function acceptLanguage(): string {
  if (!language) {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
    const base = locale.split('-')[0];
    language = base && base !== locale ? `${locale},${base};q=0.9` : locale;
  }
  return language;
}
