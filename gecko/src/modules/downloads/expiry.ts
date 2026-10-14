// When a signed address stops working, as the address itself says (spikes/downloader/RESUME-DESIGN.md
// 3.0, expiry.ts). Read from the query:
//   - S3 and Google signatures (V4): X-Amz-Date or X-Goog-Date (20261014T093000Z) plus X-Amz-Expires or
//     X-Goog-Expires (a lifetime in seconds);
//   - Azure SAS: se= (an ISO time), with its sig=;
//   - Akamai tokens: hdnts= or __token__= carrying exp=<epoch>;
//   - the plain epoch parameters Expires (S3 V2, CloudFront), exp and e, taken only within
//     [now - 1 year, now + 10 years], seconds or milliseconds.
// 0 when nothing in the address reads as such a time. Used at a resume (an expired address is renewed
// before its first request: renew.ts) and for a 403's one retry at the same address, which is kept only
// while the time is unknown or still ahead (ranged.ts).

const YEAR = 365 * 24 * 3600 * 1000;

/** The time (ms since 1970) the address stops working, or 0 when it does not say. */
export function expiresAt(url: string, now = Date.now()): number {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return 0;
  }
  const get = (name: string): string => {
    const want = name.toLowerCase();
    for (const [k, v] of params) if (k.toLowerCase() === want) return v;
    return '';
  };
  // S3 and Google V4: when it was signed, and for how long.
  for (const p of ['X-Amz', 'X-Goog']) {
    const signed = stamp(get(`${p}-Date`));
    const life = get(`${p}-Expires`);
    if (signed && /^\d{1,9}$/.test(life)) return signed + Number(life) * 1000;
  }
  // Azure: an ISO time, only beside the signature it belongs to.
  const se = get('se');
  if (se && get('sig')) {
    const t = Date.parse(se);
    if (Number.isFinite(t)) return t;
  }
  // Akamai: "exp=1760000000~acl=/*~hmac=...".
  for (const name of ['hdnts', '__token__']) {
    const m = /(?:^|~)exp=(\d{9,13})(?:~|$)/.exec(get(name));
    const t = m ? epoch(m[1], now) : 0;
    if (t) return t;
  }
  for (const name of ['Expires', 'exp', 'e']) {
    const v = get(name);
    const t = /^\d{9,13}$/.test(v) ? epoch(v, now) : 0;
    if (t) return t;
  }
  return 0;
}

/** The address says it has stopped working by now. */
export function expiredAt(url: string, now = Date.now()): boolean {
  const t = expiresAt(url, now);
  return t > 0 && t <= now;
}

/** Seconds or milliseconds since 1970, only within [now - 1 year, now + 10 years] (else 0). */
function epoch(value: string, now: number): number {
  const n = Number(value);
  const ms = n > 1e12 ? n : n * 1000;
  return ms >= now - YEAR && ms <= now + 10 * YEAR ? ms : 0;
}

/** "20261014T093000Z" (the signing time S3 and Google put in the address) as ms, or 0. */
function stamp(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(value);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
