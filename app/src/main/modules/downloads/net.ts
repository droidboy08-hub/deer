// Node's HTTP client for the downloader, with the retry rules from the reference engine
// (DownloadRetry.swift). Chromium's network stack is deliberately not used: it caps a host at
// six connections and runs HTTP/2 on one, which is the limit the ranged engine exists to beat.
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

export type Headers = Record<string, string>;
/** Headers for a given address: cookies differ per host, so they are asked for on every hop. */
export type HeaderSource = (url: string) => Promise<Headers>;

export interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Where the request ended up after redirects. */
  url: string;
  body: http.IncomingMessage;
}

/** A failure with a sentence a person can read; never retried. */
export class DownloadError extends Error {}

export class HttpStatusError extends Error {
  constructor(readonly status: number, readonly retryAfter: number | null) {
    super(statusMessage(status));
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Stopped');
    this.name = 'AbortError';
  }
}

/**
 * The server turned a connection away (429, 503) while the download has others: many hosts allow
 * only one or two per client. That connection steps aside and the others take its part.
 */
export class ConnectionRefusedError extends Error {}

export function refusedConnection(err: unknown): boolean {
  return err instanceof HttpStatusError && (err.status === 429 || err.status === 503);
}

/** The body ended before the bytes asked for: a hole of zeros if it were written as-is. */
export class ShortBodyError extends Error {
  constructor() {
    super('The connection closed early.');
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** 403 is here on purpose: on a CDN it is usually a token that fresh cookies fix. */
export const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504, 507, 509]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'ENETDOWN', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET', 'EPROTO',
]);

let agents: { http: http.Agent; https: https.Agent } | null = null;

/** Windows' own certificate store as well as Node's bundled one, so corporate roots work. */
function certificates(): string[] | undefined {
  const get = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates;
  if (!get) return undefined;
  try {
    return [...new Set([...get('default'), ...get('system')])];
  } catch {
    return undefined;
  }
}

function agentFor(protocol: string): http.Agent {
  if (!agents) {
    agents = {
      http: new http.Agent({ keepAlive: true, maxSockets: 48 }),
      https: new https.Agent({ keepAlive: true, maxSockets: 48, ca: certificates() }),
    };
  }
  return protocol === 'https:' ? agents.https : agents.http;
}

function requestOnce(url: string, headers: Headers, signal?: AbortSignal, timeoutMs = 30000): Promise<Omit<Response, 'url'>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers, agent: agentFor(u.protocol), signal }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res });
    });
    // Idle timeout for the whole exchange, body included.
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('The connection timed out.'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => reject(signal?.aborted ? new AbortedError() : err));
    req.end();
  });
}

/** GET `url`, following redirects (each hop gets its own cookies). */
export async function open(url: string, source: HeaderSource, extra: Headers = {}, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 12; hop++) {
    const base = await source(current);
    const res = await requestOnce(current, { ...base, ...extra }, signal);
    const location = res.headers.location;
    if (REDIRECTS.has(res.status) && location) {
      res.body.destroy();
      current = new URL(location, current).toString();
      if (!/^https?:/i.test(current)) throw new DownloadError('The site redirected to an address Vitre can’t download.');
      continue;
    }
    return { ...res, url: current };
  }
  throw new DownloadError('The site redirected too many times.');
}

export function header(headers: http.IncomingHttpHeaders, name: string): string {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : (v ?? '');
}

/** `bytes 0-0/1234` → {start 0, end 0, total 1234}; total -1 for `*`. */
export function parseContentRange(value: string): { start: number; end: number; total: number } | null {
  const m = /^\s*bytes\s+(?:(\d+)-(\d+)|\*)\s*\/\s*(\d+|\*)\s*$/i.exec(value);
  if (!m) return null;
  const total = m[3] === '*' ? -1 : Number(m[3]);
  if (m[1] === undefined) return { start: -1, end: -1, total };
  return { start: Number(m[1]), end: Number(m[2]), total };
}

/** Retry-After in seconds, from either spelling: a count or an HTTP date. */
export function retryAfter(headers: http.IncomingHttpHeaders): number | null {
  const raw = header(headers, 'retry-after').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, (when - Date.now()) / 1000);
}

/** Seconds before retry number `attempt` (1 = the first retry). The server's own wait wins. */
export function backoff(attempt: number, after: number | null): number {
  if (after !== null && after > 0) return Math.min(after, 60);
  return attempt <= 1 ? 2 : attempt === 2 ? 6 : 15;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpStatusError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof ShortBodyError) return true;
  if (err instanceof DownloadError || err instanceof AbortedError) return false;
  const code = (err as { code?: string })?.code ?? '';
  if (RETRYABLE_CODES.has(code)) return true;
  // Disk hiccups and anything unrecognised get another go; certificate errors never do.
  return !/CERT|SSL|TLS|ERR_INVALID/i.test(code) && !(err instanceof TypeError);
}

export function statusMessage(status: number): string {
  if (status === 401 || status === 403) return `The site refused the download (${status}). It may need you to be signed in.`;
  if (status === 404 || status === 410) return `The file is no longer there (${status}).`;
  if (status === 429) return 'The site is limiting downloads. Try again in a few minutes.';
  if (status >= 500) return `The site had a problem serving the file (${status}).`;
  return `The site answered ${status}.`;
}

/** A sentence for the row, whatever went wrong. */
export function describeError(err: unknown): string {
  if (err instanceof DownloadError || err instanceof HttpStatusError) return err.message;
  const { code = '', syscall = '' } = (err ?? {}) as { code?: string; syscall?: string };
  if (code === 'ENOSPC') return 'The disk is full.';
  // A file-system call failed: the folder, not the network.
  if (/^(mkdir|open|write|rename|ftruncate|unlink|stat|copyfile)$/.test(syscall)) {
    return code === 'EACCES' || code === 'EPERM' ? 'Vitre isn’t allowed to write to the downloads folder.' : 'Couldn’t write to the downloads folder.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Couldn’t reach the site.';
  if (code === 'ETIMEDOUT') return 'The connection timed out.';
  if (/CERT|SSL|TLS/i.test(code)) return 'The site’s security certificate isn’t trusted.';
  return 'The connection was lost.';
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const done = () => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** Reads a whole (small) body: playlists, keys and stream segments. */
export async function readBody(body: http.IncomingMessage, opts: { max?: number; onChunk?: (n: number) => Promise<void> | void } = {}): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    parts.push(chunk);
    size += chunk.length;
    if (opts.max && size > opts.max) {
      body.destroy();
      throw new DownloadError('The response was larger than expected.');
    }
    await opts.onChunk?.(chunk.length);
  }
  if (!body.complete) throw new ShortBodyError();
  return Buffer.concat(parts, size);
}
