// IDM-style multi-connection download of one file on Gecko. Port of
// app/src/main/modules/downloads/ranged.ts (itself from RangedDownload.swift): same segment plan,
// work stealing, validators, retry rules and persisted state (FileState). What changed:
//   - requests are Necko channels (VitreNet.open) instead of Node http;
//   - bytes go channel -> pipe -> background file writer (VitrePartFile.Writer) instead of
//     fd.write(buffer, position): the body never enters the JS heap;
//   - the speed limit and disk back-pressure suspend the channel instead of awaiting in a loop;
//   - the checksum is IOUtils.computeHexDigest, free space nsIFile.diskSpaceAvailable.
import { throttle } from "resource://vitre-boot/engine/VitreLimiter.sys.mjs";
import {
  AbortedError, ConnectionRefusedError, DownloadError, HttpStatusError, RETRYABLE_STATUS, ShortBodyError, backoff,
  isRetryable, open, parseContentRange, refusedConnection, retryAfter, sleep,
} from "resource://vitre-boot/engine/VitreNet.sys.mjs";
import { Writer, freeSpace, setSize, sizeOf } from "resource://vitre-boot/engine/VitrePartFile.sys.mjs";

/** Below this, connection setup costs more than parallel pieces return. */
const MIN_SPLIT = 8 * 1024 * 1024;
/** A running segment is only split when both halves would be at least this big. */
const MIN_STEAL = 1024 * 1024;
const ATTEMPTS = 3;
/** Suspend a channel when this much of it is waiting for the disk; resume below the low mark. */
const BACKLOG_HIGH = 8 * 1024 * 1024;
const BACKLOG_LOW = 2 * 1024 * 1024;
const STOP = { stop: true };

class RangeIgnoredError extends Error {}
class ResourceChangedError extends Error {}
class RangeMismatchError extends Error {
  constructor() {
    super("The server sent a different part of the file than was asked for.");
  }
}

const remaining = (s) => s.end - s.start - s.received;

/**
 * FileState (persisted): { url, finalUrl, total, ranges, etag, lastModified, digest, segments:
 * [{start, end (exclusive, -1 unknown), received}], probed, restarts }
 *
 * env: { identity, refreshIdentity(), limiters: RateLimiter[], connections(): number, onBytes(n) }
 */
export class FileTransfer {
  /** Connections currently receiving. */
  live = 0;
  /** The most connections that were receiving at once (for the spike's measurements). */
  peakLive = 0;
  #pending = null;
  /** Segment -> the Writer currently filling it. */
  #writers = new Map();

  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  static fresh(url) {
    return { url, finalUrl: url, total: -1, ranges: false, etag: "", lastModified: "", digest: null, segments: [], probed: false, restarts: 0 };
  }

  get received() {
    return this.state.segments.reduce((n, s) => n + s.received, 0);
  }

  /**
   * The state as it is safe to persist right now: bytes still waiting in a writer's pipe are not
   * counted, so a crash never leaves a segment claiming bytes that didn't reach the file.
   */
  snapshot() {
    const s = this.state;
    return {
      ...s,
      segments: s.segments.map((seg) => {
        const w = this.#writers.get(seg);
        return { start: seg.start, end: seg.end, received: w ? Math.max(0, seg.received - w.backlog) : seg.received };
      }),
    };
  }

  /** The first answer, kept for a single-stream download; dropped when the download waits in the queue. */
  dropPending() {
    this.#pending?.destroy();
    this.#pending = null;
  }

  /** The validator for If-Range: a strong ETag, or Last-Modified only when there is no ETag at all. */
  #ifRange() {
    const { etag, lastModified } = this.state;
    if (etag) return etag.startsWith("W/") ? "" : etag;
    return lastModified;
  }

  /** Ask for one byte: length, range support, validators, and (when resuming) whether the file is unchanged. */
  async probe(signal) {
    const resuming = this.state.probed && this.received > 0;
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        const extra = { Range: "bytes=0-0" };
        const validator = resuming ? this.#ifRange() : "";
        if (validator) extra["If-Range"] = validator;
        res = await open(this.state.probed ? this.state.finalUrl : this.state.url, this.env.identity, extra, signal);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(1000, signal);
        continue;
      }
      if (res.status === 200 && resuming && this.#ifRange()) {
        // If-Range answered with the whole file: it changed since the pause. Start over.
        res.destroy();
        this.#forget();
        return this.probe(signal);
      }
      if (res.status === 200 || res.status === 206 || res.status === 416) return this.#learn(res, resuming);
      res.destroy();
      const wait = retryAfter(res);
      if (attempt >= ATTEMPTS || !RETRYABLE_STATUS.has(res.status)) throw new HttpStatusError(res.status, wait);
      if (res.status === 401 || res.status === 403) this.env.refreshIdentity?.();
      await sleep(backoff(attempt, wait) * 1000, signal);
    }
  }

  #learn(res, resuming) {
    const s = this.state;
    const etag = res.header("etag");
    const lastModified = res.header("last-modified");
    const changed = resuming && this.#validatorsDiffer(etag, lastModified);
    const info = { status: res.status, contentType: res.header("content-type"), disposition: res.header("content-disposition"), total: -1, finalUrl: res.url, protocol: res.protocol };
    let total = -1;
    let ranges = false;
    if (res.status === 206) {
      total = parseContentRange(res.header("content-range"))?.total ?? -1;
      ranges = total > 0;
      res.destroy();
    } else if (res.status === 416) {
      const t = parseContentRange(res.header("content-range"))?.total ?? -1;
      total = t === 0 ? 0 : -1;
      res.destroy();
    } else {
      const raw = res.header("content-length");
      total = raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : -1;
      // The server ignored the Range: this answer is the whole file. It stays suspended for the single stream.
      this.dropPending();
      this.#pending = res;
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
  #forget() {
    const s = this.state;
    s.probed = false;
    s.segments = [];
    s.etag = "";
    s.lastModified = "";
    s.digest = null;
  }

  #validatorsDiffer(etag, lastModified) {
    if (this.state.etag) return !!etag && etag !== this.state.etag;
    return !!this.state.lastModified && !!lastModified && lastModified !== this.state.lastModified;
  }

  #connections() {
    return this.state.total >= MIN_SPLIT ? Math.max(1, Math.min(32, this.env.connections())) : 1;
  }

  #plan() {
    const s = this.state;
    if (s.segments.length) return;
    if (s.ranges && s.total > 0) {
      const size = Math.ceil(s.total / this.#connections());
      for (let start = 0; start < s.total; start += size) s.segments.push({ start, end: Math.min(s.total, start + size), received: 0 });
    } else {
      s.segments = [{ start: 0, end: s.total >= 0 ? s.total : -1, received: 0 }];
    }
  }

  /** Download into `partPath` until every byte has landed and checks out. */
  async download(partPath, signal) {
    for (;;) {
      this.#plan();
      await this.#openPart(partPath);
      try {
        if (this.state.total === 0) return;
        if (this.state.ranges && this.state.total > 0) await this.#runRanged(partPath, signal);
        else await this.#runSingle(partPath, signal);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (err instanceof RangeIgnoredError) {
          // The server stopped honouring Range: the plain path from the start.
          this.state.ranges = false;
          this.state.segments = [];
          continue;
        }
        if (err instanceof ResourceChangedError) {
          if (this.state.restarts >= 2) throw new DownloadError("The file changed on the server while downloading.");
          this.state.restarts++;
          this.#forget();
          await this.probe(signal);
          continue;
        }
        throw err;
      }
      await this.#verify(partPath);
      return;
    }
  }

  /** Size the .part file for the ranged path; a missing or short file rewinds the segments. */
  async #openPart(partPath) {
    const s = this.state;
    const size = await sizeOf(partPath);
    if (size < 0) for (const seg of s.segments) seg.received = 0;
    else for (const seg of s.segments) seg.received = Math.max(0, Math.min(seg.received, size - seg.start));
    const fresh = this.received === 0;
    const needed = s.total > 0 ? s.total - Math.max(0, fresh ? 0 : size) : 0;
    ensureRoom(PathUtils.parent(partPath), needed);
    if (s.ranges && s.total > 0) {
      if (size !== s.total || fresh) setSize(partPath, s.total, { truncate: fresh });
    } else if (fresh || size < 0) {
      setSize(partPath, 0, { truncate: true });
    }
  }

  async #runRanged(partPath, signal) {
    const owned = new Set();
    const stop = new AbortController();
    const relay = () => stop.abort();
    signal.addEventListener("abort", relay);
    let fatal = null;
    const n = this.#connections();
    // Connections still taking segments; a refused one may step aside only while another remains.
    let alive = n;
    const worker = async (_unused, lane) => {
      const conn = { accepted: false, mayYield: () => alive > 1, lane };
      try {
        for (;;) {
          if (fatal !== null || stop.signal.aborted) return;
          const seg = this.#claim(owned);
          if (!seg) return;
          owned.add(seg);
          try {
            await this.#fetchSegment(seg, partPath, stop.signal, conn);
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
      signal.removeEventListener("abort", relay);
    }
    if (signal.aborted) throw new AbortedError();
    if (fatal !== null) throw fatal;
    if (this.state.segments.some((s) => remaining(s) > 0)) throw new DownloadError("Some parts of the file didn’t arrive.");
  }

  /** The next segment nobody is fetching, or half of the busiest one. */
  #claim(owned) {
    const segs = this.state.segments;
    const free = segs.find((s) => !owned.has(s) && remaining(s) > 0);
    if (free) return free;
    let best = null;
    for (const s of owned) if (remaining(s) >= 2 * MIN_STEAL && (!best || remaining(s) > remaining(best))) best = s;
    if (!best) return null;
    const cut = best.start + best.received + Math.floor(remaining(best) / 2);
    const piece = { start: cut, end: best.end, received: 0 };
    best.end = cut;
    segs.splice(segs.indexOf(best) + 1, 0, piece);
    return piece;
  }

  /**
   * One segment, with backoff. A retry that made progress earns a fresh budget. A host that allows
   * only one or two connections per client refuses the rest (429, 503): a connection it never
   * accepted steps aside at once, one it did accept after its retries, while another remains.
   */
  async #fetchSegment(seg, partPath, signal, conn) {
    let failures = 0;
    while (remaining(seg) > 0) {
      const before = seg.received;
      try {
        await this.#pull(seg, partPath, signal, conn);
        conn.accepted = true;
      } catch (err) {
        if (seg.received > before) conn.accepted = true;
        if (signal.aborted) throw new AbortedError();
        if (err instanceof RangeIgnoredError || err instanceof ResourceChangedError) throw err;
        failures = seg.received > before ? 1 : failures + 1;
        if (refusedConnection(err) && conn.mayYield() && (!conn.accepted || failures >= ATTEMPTS)) throw new ConnectionRefusedError();
        if (failures >= ATTEMPTS || !(isRetryable(err) || err instanceof RangeMismatchError)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshIdentity?.();
        this.env.onRetry?.(err, failures);
        await sleep(backoff(failures, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  async #pull(seg, partPath, signal, conn) {
    const from = seg.start + seg.received;
    const to = seg.end - 1;
    const extra = { Range: `bytes=${from}-${to}` };
    const validator = this.#ifRange();
    if (validator) extra["If-Range"] = validator;
    // VERIFY: env.lanes puts every connection in its own network partition (see VitreNet.makeChannel).
    const res = await open(this.state.finalUrl, this.env.identity, extra, signal, { h1: this.env.h1 ?? true, noH3: !!this.env.noH3, lane: this.env.lanes ? conn.lane : null });
    (this.protocols ??= new Map()).set(res.socket, res.protocol);
    const whole = from === 0 && seg.end === this.state.total && this.state.segments.length === 1;
    if (res.status === 200 && !whole) {
      res.destroy();
      // A 200 to If-Range is the server saying the file changed; to a plain Range, that it won't range.
      throw validator ? new ResourceChangedError() : new RangeIgnoredError();
    }
    if (res.status !== 200 && res.status !== 206) {
      res.destroy();
      throw new HttpStatusError(res.status, retryAfter(res));
    }
    try {
      if (this.#validatorsDiffer(res.header("etag"), res.header("last-modified"))) throw new ResourceChangedError();
      if (res.status === 206) {
        const cr = parseContentRange(res.header("content-range"));
        if (!cr || cr.start !== from || cr.end > to || (cr.total >= 0 && cr.total !== this.state.total)) throw new RangeMismatchError();
      }
    } catch (err) {
      res.destroy();
      throw err;
    }
    await this.#stream(res, seg, partPath, res.status === 206 ? to + 1 : -1);
  }

  /** Write the body at the segment's place, stopping at its end (which a split may have moved). */
  async #stream(res, seg, partPath, askedEnd = -1) {
    this.live++;
    this.peakLive = Math.max(this.peakLive, this.live);
    const base = seg.received;
    const writer = new Writer(partPath, seg.start + seg.received);
    this.#writers.set(seg, writer);
    let failure = null;
    try {
      await res.stream((input, count) => {
        const room = seg.end < 0 ? count : seg.end - seg.start - seg.received;
        if (room <= 0) return STOP;
        const n = Math.min(count, room);
        writer.write(input, n);
        seg.received += n;
        this.env.onBytes(n);
        // Asked for exactly this much: let the response end by itself, so the connection is kept
        // alive for the next segment. After a split the answer runs past the new end: cut it.
        if (seg.end >= 0 && remaining(seg) <= 0) return seg.end === askedEnd ? undefined : STOP;
        const wait = throttle(this.env.limiters, n);
        if (wait > 0) return { wait };
        if (writer.backlog > BACKLOG_HIGH) return { until: () => writer.backlog < BACKLOG_LOW };
        return undefined;
      });
    } catch (err) {
      failure = err;
    } finally {
      this.live--;
      // Nobody may trust seg.received until the writer has put every byte in the file.
      try {
        await writer.close();
      } catch (err) {
        seg.received = base;
        failure = err;
      }
      this.#writers.delete(seg);
    }
    if (failure) throw failure;
    if (seg.end >= 0 && remaining(seg) > 0) throw new ShortBodyError();
  }

  /** No ranges: one stream from the start. A failure starts again from zero. */
  async #runSingle(partPath, signal) {
    const seg = this.state.segments[0];
    for (let attempt = 1; ; attempt++) {
      try {
        let res = this.#pending;
        this.#pending = null;
        if (!res || seg.received > 0) {
          res?.destroy();
          seg.received = 0;
          setSize(partPath, 0, { truncate: true });
          res = await open(this.state.finalUrl, this.env.identity, {}, signal);
          if (res.status !== 200) {
            res.destroy();
            throw new HttpStatusError(res.status, retryAfter(res));
          }
        }
        await this.#stream(res, seg, partPath);
        if (seg.end < 0) {
          seg.end = seg.received;
          this.state.total = seg.received;
        }
        return;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshIdentity?.();
        this.env.onRetry?.(err, attempt);
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** Every byte landed, the file is the promised length, and it matches any checksum the server gave. */
  async #verify(partPath) {
    const s = this.state;
    if (s.total >= 0) {
      const size = await sizeOf(partPath);
      if (size !== s.total) throw new DownloadError(`The finished file is ${size} bytes; the server promised ${s.total}.`);
    }
    if (s.digest) {
      const hex = await IOUtils.computeHexDigest(partPath, s.digest.alg);
      if (hex !== base64ToHex(s.digest.value)) {
        s.segments = [];
        throw new DownloadError("The finished file doesn’t match the server’s checksum.");
      }
    }
  }
}

function base64ToHex(b64) {
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

/** How full each of `n` equal stretches of the file is (the connection bar). */
export function fileFills(s, n = 8) {
  if (s.total <= 0) return [];
  const block = s.total / n;
  const out = new Array(n).fill(0);
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
function digestOf(res) {
  const value = res.header("repr-digest") || res.header("digest");
  for (const entry of value.split(",")) {
    const [name, ...rest] = entry.split("=");
    const alg = name?.trim().toLowerCase();
    const encoded = rest.join("=").trim().replace(/^:|:$/g, "");
    if ((alg === "sha-256" || alg === "sha256") && encoded) return { alg: "sha256", value: encoded };
  }
  // Content-MD5 on a 206 describes the one byte, not the file.
  const md5 = res.status === 200 ? res.header("content-md5").trim() : "";
  return md5 ? { alg: "md5", value: md5 } : null;
}

/** Sizing a file reserves no blocks: without this a download on a full disk dies at 100%. */
export function ensureRoom(dir, bytes) {
  if (bytes <= 0) return;
  const free = freeSpace(dir);
  const margin = 16 * 1024 * 1024;
  if (free < bytes + margin) {
    const short = bytes + margin - free;
    throw new DownloadError(`Not enough space on the disk. ${short / 1024 ** 3 >= 1 ? `${(short / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(short / 1024 ** 2)} MB`} more is needed.`);
  }
}
