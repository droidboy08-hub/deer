// IDM-style multi-connection download of one file, ported from RangedDownload.swift.
//
// The file is cut into one segment per connection. Each connection streams its segment straight
// to its place in a pre-sized .part file; when one finishes it takes half of the largest segment
// still running (the owner stops at the new boundary). Segments record how much of them has
// landed, so pause, a dropped connection or a restart of Vitre resume where they were.
//
// The rules that keep the file being the file (README of the reference engine):
// - probe with Range: bytes=0-0; a 206 total after the slash means the server ranges;
// - pin the URL the probe ended at; send If-Range with a strong ETag only, or Last-Modified
//   only when there is no ETag at all (issue #39); weak validators are never sent;
// - compare the validator on every response ourselves, and check each Content-Range;
// - check free space before pre-sizing; at the end assert the length and any server checksum.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { throttle, type RateLimiter } from './limiter';
import {
  AbortedError, ConnectionRefusedError, DownloadError, HttpStatusError, RETRYABLE_STATUS, ShortBodyError, backoff, header,
  isRetryable, open, parseContentRange, refusedConnection, retryAfter, sleep, type HeaderSource, type Response,
} from './net';

export interface Segment {
  start: number;
  /** Exclusive; -1 while the length is unknown. */
  end: number;
  received: number;
}

/** Everything needed to carry on later; persisted in downloads.json. */
export interface FileState {
  url: string;
  finalUrl: string;
  total: number;
  ranges: boolean;
  etag: string;
  lastModified: string;
  digest: { alg: 'sha256' | 'md5'; value: string } | null;
  segments: Segment[];
  probed: boolean;
  restarts: number;
}

export interface ProbeInfo {
  status: number;
  contentType: string;
  disposition: string;
  total: number;
  finalUrl: string;
}

export interface TransferEnv {
  headers: HeaderSource;
  /** Gather the page's cookies again (after a 401 or 403). */
  refreshHeaders(): void;
  limiters: RateLimiter[];
  connections(): number;
  /** Bytes just landed on disk. */
  onBytes(n: number): void;
}

/** Below this, connection setup costs more than parallel pieces return. */
const MIN_SPLIT = 8 * 1024 * 1024;
/** A running segment is only split when both halves would be at least this big. */
const MIN_STEAL = 1024 * 1024;
const ATTEMPTS = 3;

class RangeIgnoredError extends Error {}
class ResourceChangedError extends Error {}
class RangeMismatchError extends Error {
  constructor() {
    super('The server sent a different part of the file than was asked for.');
  }
}

const remaining = (s: Segment) => s.end - s.start - s.received;

/** One worker's standing with the server: whether it was ever let in, and whether it may step aside. */
interface Connection {
  accepted: boolean;
  mayYield(): boolean;
}

export class FileTransfer {
  /** Connections currently receiving. */
  live = 0;
  private pending: Response | null = null;

  constructor(readonly state: FileState, private env: TransferEnv) {}

  static fresh(url: string): FileState {
    return { url, finalUrl: url, total: -1, ranges: false, etag: '', lastModified: '', digest: null, segments: [], probed: false, restarts: 0 };
  }

  get received(): number {
    return this.state.segments.reduce((n, s) => n + s.received, 0);
  }

  /** The bytes of the first answer, kept for a single-stream download; dropped when the download waits in the queue. */
  dropPending(): void {
    this.pending?.body.destroy();
    this.pending = null;
  }

  /** The validator for If-Range: a strong ETag, or Last-Modified only when there is no ETag at all. */
  private ifRange(): string {
    const { etag, lastModified } = this.state;
    if (etag) return etag.startsWith('W/') ? '' : etag;
    return lastModified;
  }

  /** Ask for one byte: length, range support, validators, and (when resuming) whether the file is unchanged. */
  async probe(signal: AbortSignal): Promise<ProbeInfo> {
    const resuming = this.state.probed && this.received > 0;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        const extra: Record<string, string> = { Range: 'bytes=0-0' };
        const validator = resuming ? this.ifRange() : '';
        if (validator) extra['If-Range'] = validator;
        res = await open(this.state.probed ? this.state.finalUrl : this.state.url, this.env.headers, extra, signal);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        // Nothing has been shown yet: a short wait, and Chromium takes over if this keeps failing.
        await sleep(1000, signal);
        continue;
      }
      if (res.status === 200 && resuming && this.ifRange()) {
        // If-Range answered with the whole file: it changed since the pause. Start over and ask
        // afresh, so a server that ranges still gets every connection.
        res.body.destroy();
        this.forget();
        return this.probe(signal);
      }
      if (res.status === 200 || res.status === 206 || res.status === 416) return this.learn(res, resuming);
      res.body.destroy();
      const wait = retryAfter(res.headers);
      if (attempt >= ATTEMPTS || !RETRYABLE_STATUS.has(res.status)) throw new HttpStatusError(res.status, wait);
      if (res.status === 401 || res.status === 403) this.env.refreshHeaders();
      await sleep(backoff(attempt, wait) * 1000, signal);
    }
  }

  private learn(res: Response, resuming: boolean): ProbeInfo {
    const s = this.state;
    const etag = header(res.headers, 'etag');
    const lastModified = header(res.headers, 'last-modified');
    const changed = resuming && this.validatorsDiffer(etag, lastModified);
    const info: ProbeInfo = {
      status: res.status,
      contentType: header(res.headers, 'content-type'),
      disposition: header(res.headers, 'content-disposition'),
      total: -1,
      finalUrl: res.url,
    };
    let total = -1;
    let ranges = false;
    if (res.status === 206) {
      total = parseContentRange(header(res.headers, 'content-range'))?.total ?? -1;
      ranges = total > 0;
      res.body.destroy();
    } else if (res.status === 416) {
      // bytes=0-0 is unsatisfiable only for an empty file (or a server that won't range).
      const t = parseContentRange(header(res.headers, 'content-range'))?.total ?? -1;
      total = t === 0 ? 0 : -1;
      res.body.destroy();
    } else {
      const length = Number(header(res.headers, 'content-length'));
      total = Number.isFinite(length) && header(res.headers, 'content-length') !== '' ? length : -1;
      // The server ignored the Range: this answer is the whole file. Keep it for the single stream.
      this.dropPending();
      this.pending = res;
    }
    const restart = !resuming || changed || !ranges || total !== s.total;
    s.finalUrl = res.url;
    s.total = total;
    s.ranges = ranges;
    if (restart) {
      s.segments = [];
      s.etag = etag;
      s.lastModified = lastModified;
      s.digest = digestOf(res);
    }
    s.probed = true;
    info.total = total;
    return info;
  }

  /** The file changed: what was received and what was known about it no longer apply. */
  private forget(): void {
    const s = this.state;
    s.probed = false;
    s.segments = [];
    s.etag = '';
    s.lastModified = '';
    s.digest = null;
  }

  private validatorsDiffer(etag: string, lastModified: string): boolean {
    if (this.state.etag) return !!etag && etag !== this.state.etag;
    return !!this.state.lastModified && !!lastModified && lastModified !== this.state.lastModified;
  }

  private checkValidators(res: Response): void {
    if (this.validatorsDiffer(header(res.headers, 'etag'), header(res.headers, 'last-modified'))) throw new ResourceChangedError();
  }

  private plan(): void {
    const s = this.state;
    if (s.segments.length) return;
    if (s.ranges && s.total > 0) {
      const n = s.total >= MIN_SPLIT ? Math.max(1, Math.min(32, this.env.connections())) : 1;
      const size = Math.ceil(s.total / n);
      for (let start = 0; start < s.total; start += size) s.segments.push({ start, end: Math.min(s.total, start + size), received: 0 });
    } else {
      s.segments = [{ start: 0, end: s.total >= 0 ? s.total : -1, received: 0 }];
    }
  }

  /** Download into `partPath` until every byte has landed and checks out. */
  async download(partPath: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      this.plan();
      const handle = await this.openPart(partPath);
      try {
        if (this.state.total === 0) return;
        if (this.state.ranges && this.state.total > 0) await this.runRanged(handle, signal);
        else await this.runSingle(handle, signal);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (err instanceof RangeIgnoredError) {
          // The server stopped honouring Range: the plain path from the start.
          this.state.ranges = false;
          this.state.segments = [];
          continue;
        }
        if (err instanceof ResourceChangedError) {
          if (this.state.restarts >= 2) throw new DownloadError('The file changed on the server while downloading.');
          this.state.restarts++;
          this.forget();
          await this.probe(signal);
          continue;
        }
        throw err;
      } finally {
        await handle.close().catch(() => undefined);
      }
      await this.verify(partPath);
      return;
    }
  }

  /** Open the .part file, sized for the ranged path; a missing or short file rewinds the segments. */
  private async openPart(partPath: string): Promise<fs.promises.FileHandle> {
    const s = this.state;
    let size = -1;
    try {
      size = (await fs.promises.stat(partPath)).size;
    } catch {
      size = -1;
    }
    if (size < 0) for (const seg of s.segments) seg.received = 0;
    else for (const seg of s.segments) seg.received = Math.max(0, Math.min(seg.received, size - seg.start));
    const fresh = this.received === 0;
    const needed = s.total > 0 ? s.total - Math.max(0, fresh ? 0 : size) : 0;
    await ensureRoom(path.dirname(partPath), needed);
    const handle = await fs.promises.open(partPath, fresh || size < 0 ? 'w' : 'r+');
    if (s.ranges && s.total > 0 && size !== s.total) await handle.truncate(s.total);
    return handle;
  }

  private async runRanged(fd: fs.promises.FileHandle, signal: AbortSignal): Promise<void> {
    const owned = new Set<Segment>();
    const stop = new AbortController();
    const relay = () => stop.abort();
    signal.addEventListener('abort', relay);
    let fatal: unknown = null;
    const n = this.state.total >= MIN_SPLIT ? Math.max(1, Math.min(32, this.env.connections())) : 1;
    // Connections still taking segments; a refused one may step aside only while another remains.
    let alive = n;
    const worker = async () => {
      const conn: Connection = { accepted: false, mayYield: () => alive > 1 };
      try {
        for (;;) {
          if (fatal !== null || stop.signal.aborted) return;
          const seg = this.claim(owned);
          if (!seg) return;
          owned.add(seg);
          try {
            await this.fetchSegment(seg, fd, stop.signal, conn);
          } catch (err) {
            // Its segment is left for the connections the server does accept.
            if (err instanceof ConnectionRefusedError) return;
            if (fatal === null) fatal = err;
            stop.abort();
            return;
          } finally {
            owned.delete(seg);
          }
        }
      } finally {
        alive--;
      }
    };
    try {
      await Promise.all(Array.from({ length: n }, worker));
    } finally {
      signal.removeEventListener('abort', relay);
    }
    if (signal.aborted) throw new AbortedError();
    if (fatal !== null) throw fatal;
    if (this.state.segments.some((s) => remaining(s) > 0)) throw new DownloadError('Some parts of the file didn’t arrive.');
  }

  /** The next segment nobody is fetching, or half of the busiest one. */
  private claim(owned: Set<Segment>): Segment | null {
    const segs = this.state.segments;
    const free = segs.find((s) => !owned.has(s) && remaining(s) > 0);
    if (free) return free;
    let best: Segment | null = null;
    for (const s of owned) if (remaining(s) >= 2 * MIN_STEAL && (!best || remaining(s) > remaining(best))) best = s;
    if (!best) return null;
    const cut = best.start + best.received + Math.floor(remaining(best) / 2);
    const piece: Segment = { start: cut, end: best.end, received: 0 };
    best.end = cut;
    segs.splice(segs.indexOf(best) + 1, 0, piece);
    return piece;
  }

  /**
   * One segment, with backoff. A retry that made progress earns a fresh budget. A host that allows
   * only one or two connections per client refuses the rest (429, 503): a connection it never
   * accepted steps aside at once, one it did accept after its retries, while another remains.
   */
  private async fetchSegment(seg: Segment, fd: fs.promises.FileHandle, signal: AbortSignal, conn: Connection): Promise<void> {
    let failures = 0;
    while (remaining(seg) > 0) {
      const before = seg.received;
      try {
        await this.pull(seg, fd, signal);
        conn.accepted = true;
      } catch (err) {
        if (seg.received > before) conn.accepted = true;
        if (signal.aborted) throw new AbortedError();
        if (err instanceof RangeIgnoredError || err instanceof ResourceChangedError) throw err;
        failures = seg.received > before ? 1 : failures + 1;
        if (refusedConnection(err) && conn.mayYield() && (!conn.accepted || failures >= ATTEMPTS)) throw new ConnectionRefusedError();
        if (failures >= ATTEMPTS || !(isRetryable(err) || err instanceof RangeMismatchError)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshHeaders();
        await sleep(backoff(failures, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  private async pull(seg: Segment, fd: fs.promises.FileHandle, signal: AbortSignal): Promise<void> {
    const from = seg.start + seg.received;
    const to = seg.end - 1;
    const extra: Record<string, string> = { Range: `bytes=${from}-${to}` };
    const validator = this.ifRange();
    if (validator) extra['If-Range'] = validator;
    const res = await open(this.state.finalUrl, this.env.headers, extra, signal);
    const whole = from === 0 && seg.end === this.state.total && this.state.segments.length === 1;
    if (res.status === 200 && !whole) {
      res.body.destroy();
      // A 200 to If-Range is the server saying the file changed; to a plain Range, that it won't range.
      throw validator ? new ResourceChangedError() : new RangeIgnoredError();
    }
    if (res.status !== 200 && res.status !== 206) {
      res.body.destroy();
      throw new HttpStatusError(res.status, retryAfter(res.headers));
    }
    try {
      this.checkValidators(res);
      if (res.status === 206) {
        const cr = parseContentRange(header(res.headers, 'content-range'));
        if (!cr || cr.start !== from || cr.end > to || (cr.total >= 0 && cr.total !== this.state.total)) throw new RangeMismatchError();
      }
    } catch (err) {
      res.body.destroy();
      throw err;
    }
    await this.stream(res, seg, fd, signal);
  }

  /** Write the body at the segment's place, stopping at its end (which a split may have moved). */
  private async stream(res: Response, seg: Segment, fd: fs.promises.FileHandle, signal: AbortSignal): Promise<void> {
    this.live++;
    try {
      for await (const chunk of res.body as AsyncIterable<Buffer>) {
        const room = seg.end < 0 ? chunk.length : seg.end - seg.start - seg.received;
        if (room <= 0) break;
        const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
        await fd.write(piece, 0, piece.length, seg.start + seg.received);
        seg.received += piece.length;
        this.env.onBytes(piece.length);
        if (seg.end >= 0 && remaining(seg) <= 0) break;
        const wait = throttle(this.env.limiters, piece.length);
        if (wait > 0) await sleep(wait, signal);
      }
    } finally {
      this.live--;
      res.body.destroy();
    }
    if (seg.end >= 0 && remaining(seg) > 0) throw new ShortBodyError();
  }

  /** No ranges: one stream from the start. A failure starts again from zero. */
  private async runSingle(fd: fs.promises.FileHandle, signal: AbortSignal): Promise<void> {
    const seg = this.state.segments[0];
    for (let attempt = 1; ; attempt++) {
      try {
        let res = this.pending;
        this.pending = null;
        if (!res || seg.received > 0) {
          res?.body.destroy();
          seg.received = 0;
          await fd.truncate(0);
          res = await open(this.state.finalUrl, this.env.headers, {}, signal);
          if (res.status !== 200) {
            res.body.destroy();
            throw new HttpStatusError(res.status, retryAfter(res.headers));
          }
        }
        await this.stream(res, seg, fd, signal);
        if (seg.end < 0) {
          seg.end = seg.received;
          this.state.total = seg.received;
        }
        return;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshHeaders();
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** Every byte landed, the file is the promised length, and it matches any checksum the server gave. */
  private async verify(partPath: string): Promise<void> {
    const s = this.state;
    if (s.total >= 0) {
      const size = (await fs.promises.stat(partPath)).size;
      if (size !== s.total) throw new DownloadError(`The finished file is ${size} bytes; the server promised ${s.total}.`);
    }
    if (s.digest) {
      const hash = createHash(s.digest.alg);
      for await (const chunk of fs.createReadStream(partPath, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
      if (hash.digest('base64') !== s.digest.value) {
        s.segments = [];
        throw new DownloadError('The finished file doesn’t match the server’s checksum.');
      }
    }
  }
}

/** How full each of `n` equal stretches of the file is (the connection bar). */
export function fileFills(s: FileState, n = 8): number[] {
  if (s.total <= 0) return [];
  const block = s.total / n;
  const out = new Array<number>(n).fill(0);
  for (const seg of s.segments) {
    let a = seg.start;
    const b = seg.start + seg.received;
    while (a < b) {
      const i = Math.min(n - 1, Math.floor(a / block));
      const edge = Math.min(b, (i + 1) * block);
      out[i] += edge - a;
      a = edge;
    }
  }
  return out.map((v) => Math.min(1, v / block));
}

/** The server's checksum of the whole file, when it volunteers one (Repr-Digest, Digest, Content-MD5). */
function digestOf(res: Response): FileState['digest'] {
  const value = header(res.headers, 'repr-digest') || header(res.headers, 'digest');
  for (const entry of value.split(',')) {
    const [name, ...rest] = entry.split('=');
    const alg = name?.trim().toLowerCase();
    const encoded = rest.join('=').trim().replace(/^:|:$/g, '');
    if ((alg === 'sha-256' || alg === 'sha256') && encoded) return { alg: 'sha256', value: encoded };
  }
  // Content-MD5 on a 206 describes the one byte, not the file.
  const md5 = res.status === 200 ? header(res.headers, 'content-md5').trim() : '';
  return md5 ? { alg: 'md5', value: md5 } : null;
}

/** Sizing a file reserves no blocks: without this a download on a full disk dies at 100%. */
export async function ensureRoom(dir: string, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  let free = Infinity;
  try {
    const st = await fs.promises.statfs(dir);
    free = st.bavail * st.bsize;
  } catch {
    return; // the volume wouldn't say; better to try than to refuse
  }
  const margin = 16 * 1024 * 1024;
  if (free < bytes + margin) {
    const short = bytes + margin - free;
    throw new DownloadError(`Not enough space on the disk. ${(short / 1024 ** 3 >= 1 ? `${(short / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(short / 1024 ** 2)} MB`)} more is needed.`);
  }
}
