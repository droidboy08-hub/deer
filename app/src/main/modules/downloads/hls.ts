// HLS: the segments of one rendition fetched in parallel and written in order, ported from
// HLSDownload.swift. TS segments are concatenated into a .ts; fMP4 segments (init + fragments)
// already make an MP4. With ffmpeg the result is repackaged as .mp4 (-c copy) and a separate
// audio rendition is joined in; without it the .ts (and the audio file) are kept as they are.
// AES-128 is decrypted here; SAMPLE-AES and Widevine, PlayReady or FairPlay keys are DRM and refused.
import { createDecipheriv } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { findFfmpeg, runFfmpeg } from './ffmpeg';
import { throttle } from './limiter';
import {
  AbortedError, ConnectionRefusedError, DownloadError, HttpStatusError, ShortBodyError, backoff, header, isRetryable, open, readBody,
  refusedConnection, retryAfter, sleep,
} from './net';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia, type KeyRef, type MediaPlaylist, type MediaSegment } from './playlist';
import type { TransferEnv } from './ranged';

export type Container = '' | 'ts' | 'mp4' | 'aac';

export interface HlsTrack {
  kind: 'main' | 'audio';
  url: string;
  /** Segments written, in order. */
  done: number;
  /** Bytes in the track's .part file. */
  bytes: number;
  initBytes: number;
  count: number;
  /** Media seconds written so far, and in the whole track: the size estimate scales one by the other. */
  secs: number;
  length: number;
  container: Container;
}

export interface HlsState {
  sourceUrl: string;
  variantUrl: string;
  audioUrl: string;
  audioOnly: boolean;
  resolved: boolean;
  bandwidth: number;
  duration: number;
  /** A size estimate from the picker, used until segments are measured. */
  expected?: number;
  tracks: HlsTrack[];
}

export const DRM_MESSAGE = 'This video is protected and can’t be saved.';
export const LIVE_MESSAGE = 'Live streams can’t be saved.';
const ATTEMPTS = 3;
const SEGMENT_MAX = 256 * 1024 * 1024;
/** Early segments wait in memory up to this much, then on disk. */
const SPILL_AFTER = 48 * 1024 * 1024;

export class HlsTransfer {
  live = 0;
  private inflight = 0;
  /** Segments fetched but not yet written (they arrive out of order): bytes and media seconds. */
  private early = { bytes: 0, secs: 0 };
  private playlists = new Map<string, MediaPlaylist>();
  private texts = new Map<string, string>();
  private keys = new Map<string, Buffer>();
  private refreshedAt = new Map<string, number>();

  constructor(readonly state: HlsState, private env: TransferEnv) {}

  static fresh(sourceUrl: string, opts: { variantUrl?: string; audioUrl?: string; audioOnly?: boolean; bytes?: number } = {}): HlsState {
    return { sourceUrl, variantUrl: opts.variantUrl ?? '', audioUrl: opts.audioUrl ?? '', audioOnly: !!opts.audioOnly, resolved: false, bandwidth: 0, duration: 0, expected: opts.bytes || 0, tracks: [] };
  }

  get received(): number {
    return this.state.tracks.reduce((n, t) => n + t.bytes, 0) + Math.max(0, this.inflight);
  }

  /** Bytes the finished stream is likely to be: measured segments once there are some, the bitrate before. */
  get estimate(): number {
    const e = hlsEstimate(this.state, this.early);
    return e < 0 ? -1 : Math.max(e, this.received);
  }

  /** Resolve a master playlist to one rendition (and its audio), then read the media playlists. */
  async prepare(signal: AbortSignal): Promise<void> {
    const s = this.state;
    if (!s.resolved) {
      const first = s.variantUrl || s.sourceUrl;
      const text = await this.text(first, signal);
      let main = first;
      let audio = s.audioUrl;
      if (isMaster(text)) {
        const master = parseMaster(text, first);
        if (master.drm) throw new DownloadError(DRM_MESSAGE);
        const rungs = ladder(master);
        const pick = s.audioOnly ? rungs.find((v) => v.audioOnly) : rungs.find((v) => !v.audioOnly) ?? rungs[0];
        const rendition = pick ? audioFor(master, pick) : master.renditions.find((r) => r.type === 'AUDIO' && r.url) ?? null;
        if (s.audioOnly && !pick && rendition) main = rendition.url;
        else if (pick) {
          main = pick.url;
          s.bandwidth = pick.bandwidth;
          if (!s.audioOnly && rendition && !audio) audio = rendition.url;
        } else throw new DownloadError('This stream has nothing Vitre can save.');
      }
      const track = (kind: HlsTrack['kind'], url: string): HlsTrack => ({ kind, url, done: 0, bytes: 0, initBytes: 0, count: 0, secs: 0, length: 0, container: '' });
      s.tracks = [track('main', main)];
      if (audio && audio !== main) s.tracks.push(track('audio', audio));
      s.resolved = true;
    }
    for (const t of s.tracks) {
      const pl = parseMedia(await this.text(t.url, signal), t.url);
      if (pl.drm) throw new DownloadError(DRM_MESSAGE);
      if (!pl.endList) throw new DownloadError(LIVE_MESSAGE);
      if (pl.iframesOnly || !pl.segments.length) throw new DownloadError('This video can’t be saved.');
      // A playlist that changed shape since the last run can't be continued by position.
      if (t.count && t.count !== pl.segments.length) Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
      t.count = pl.segments.length;
      t.length = pl.duration;
      t.secs = pl.segments.slice(0, t.done).reduce((n, x) => n + x.duration, 0);
      this.playlists.set(t.url, pl);
      if (t.kind === 'main') s.duration = pl.duration;
    }
  }

  /** The finished file's extension as far as can be told before downloading (ffmpeg, an init segment, the segment names). */
  expectedExtension(): string {
    const main = this.state.tracks[0];
    const pl = main ? this.playlists.get(main.url) : undefined;
    if (findFfmpeg() || pl?.init) return this.state.audioOnly ? '.m4a' : '.mp4';
    if (this.state.audioOnly && /\.aac(\?|#|$)/i.test(pl?.segments[0]?.url ?? '')) return '.aac';
    return '.ts';
  }

  async download(partBase: string, signal: AbortSignal): Promise<void> {
    for (const t of this.state.tracks) {
      this.inflight = 0;
      await this.runTrack(t, trackPart(partBase, t), signal);
    }
    this.inflight = 0;
  }

  /**
   * Turn the track files into the finished file. `place(ext, suffix)` returns a free path for the
   * download's name with that extension. Returns the main file's path.
   */
  async finish(partBase: string, place: (ext: string, suffix?: string) => string, signal: AbortSignal): Promise<string> {
    const [main, audio] = this.state.tracks;
    const mainPart = trackPart(partBase, main);
    const audioPart = audio ? trackPart(partBase, audio) : '';
    const ff = findFfmpeg();
    const needsMux = !!audio || main.container === 'ts' || main.container === 'aac';
    if (ff && needsMux) {
      const out = place(this.state.audioOnly ? '.m4a' : '.mp4');
      const tmp = `${partBase}.merge.part`;
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', mainPart];
      if (audio) args.push('-i', audioPart, '-map', '0:v:0?', '-map', '1:a:0?');
      else args.push('-map', '0:v?', '-map', '0:a?');
      args.push('-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp);
      try {
        await runFfmpeg(ff, args, signal);
        await fs.promises.rename(tmp, out);
        await removeQuietly(mainPart, audioPart);
        return out;
      } catch (err) {
        await removeQuietly(tmp);
        if (signal.aborted) throw new AbortedError();
        // Keep what downloaded rather than throw it away over the container.
      }
    }
    const out = place(extension(main.container, this.state.audioOnly));
    await fs.promises.rename(mainPart, out);
    if (audio) await fs.promises.rename(audioPart, place(extension(audio.container, true), ' (audio)'));
    return out;
  }

  /**
   * Fetch a track's segments on parallel connections and write them in order. Segments that
   * arrive early wait in memory (up to 48 MB) and then on disk, so a slow one never stalls the
   * others; when the connections are idle and the next segment to write is overdue, a second
   * request races it (the slower one is dropped).
   */
  private async runTrack(track: HlsTrack, partPath: string, signal: AbortSignal): Promise<void> {
    const pl = this.playlists.get(track.url);
    if (!pl) throw new DownloadError('The stream’s playlist couldn’t be read.');
    const segs = pl.segments;
    const stop = new AbortController();
    let wake: (() => void)[] = [];
    const notify = () => {
      const w = wake;
      wake = [];
      for (const f of w) f();
    };
    const wait = (ms: number) => new Promise<void>((r) => {
      wake.push(r);
      setTimeout(r, ms);
    });
    const relay = () => {
      stop.abort();
      notify();
    };
    signal.addEventListener('abort', relay);
    const ready = new Map<number, { buf: Buffer | null; file: string; net: number }>();
    const started = new Map<number, number>();
    const hedged = new Set<number>();
    const racers = new Map<number, AbortController[]>();
    const spill = `${partPath}.d`;
    let held = 0;
    let avgMs = 0;
    let failure: unknown = null;
    let next = track.done;
    const conns = Math.max(1, Math.min(16, this.env.connections()));
    const ahead = Math.max(24, conns * 4);
    // Workers still fetching; one the server turns away steps aside while another remains,
    // and its segment goes back in line.
    let alive = conns;
    const requeue: number[] = [];

    /** Fetch segment `i` on worker `conn`; 'retire' when the server refused that connection. */
    const take = async (i: number, hedge: boolean, conn: { accepted: boolean }): Promise<'retire' | void> => {
      const ac = new AbortController();
      const onStop = () => ac.abort();
      stop.signal.addEventListener('abort', onStop);
      racers.set(i, [...(racers.get(i) ?? []), ac]);
      const t0 = Date.now();
      if (!started.has(i)) started.set(i, t0);
      try {
        // A connection the server never let in steps aside at once; one it did, after its retries.
        const mayYield = (attempt: number) => !hedge && alive > 1 && (!conn.accepted || attempt >= ATTEMPTS);
        const piece = await this.fetchPiece(segs[i], track, ac.signal, mayYield);
        conn.accepted = true;
        if (ready.has(i) || i < track.done) {
          this.inflight -= piece.net;
          return;
        }
        for (const other of racers.get(i) ?? []) if (other !== ac) other.abort();
        avgMs = avgMs ? avgMs * 0.8 + (Date.now() - t0) * 0.2 : Date.now() - t0;
        if (i !== track.done && held + piece.buf.length > SPILL_AFTER) {
          await fs.promises.mkdir(spill, { recursive: true });
          const file = path.join(spill, String(i));
          await fs.promises.writeFile(file, piece.buf);
          ready.set(i, { buf: null, file, net: piece.net });
        } else {
          held += piece.buf.length;
          ready.set(i, { buf: piece.buf, file: '', net: piece.net });
        }
        this.early.bytes += piece.buf.length;
        this.early.secs += segs[i].duration;
        notify();
      } catch (err) {
        // Lost a race, stopped, or a second try whose first is still running: not a failure.
        if (stop.signal.aborted || ac.signal.aborted || hedge || ready.has(i) || i < track.done) return;
        if (err instanceof ConnectionRefusedError) {
          requeue.push(i);
          notify();
          return 'retire';
        }
        if (failure === null) failure = err;
        stop.abort();
        notify();
      } finally {
        stop.signal.removeEventListener('abort', onStop);
        racers.set(i, (racers.get(i) ?? []).filter((x) => x !== ac));
      }
    };

    const work = async (conn: { accepted: boolean }) => {
      while (failure === null && !stop.signal.aborted && track.done < segs.length) {
        const again = requeue.shift();
        if (again !== undefined) {
          if ((await take(again, false, conn)) === 'retire') return;
          continue;
        }
        if (next < segs.length && next < track.done + ahead) {
          if ((await take(next++, false, conn)) === 'retire') return;
          continue;
        }
        const head = track.done;
        const since = started.get(head);
        if (since !== undefined && !ready.has(head) && !hedged.has(head) && Date.now() - since > Math.max(3000, avgMs * 2)) {
          hedged.add(head);
          await take(head, true, conn);
          continue;
        }
        await wait(500);
      }
    };
    const worker = async () => {
      try {
        await work({ accepted: false });
      } finally {
        alive--;
      }
    };

    const fd = await fs.promises.open(partPath, track.done === 0 ? 'w' : 'r+').catch(() => fs.promises.open(partPath, 'w'));
    try {
      if (track.done === 0 || (await fd.stat()).size < track.bytes) {
        Object.assign(track, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
        next = 0;
        await fd.truncate(0);
        if (pl.init) {
          const init = await this.fetchPiece({ url: pl.init.url, seq: 0, key: pl.init.key, range: pl.init.range, duration: 0 }, track, stop.signal);
          await fd.write(init.buf, 0, init.buf.length, 0);
          this.inflight -= init.net;
          track.bytes = track.initBytes = init.buf.length;
          track.container = 'mp4';
        }
      } else {
        await fd.truncate(track.bytes);
      }
      const workers = Array.from({ length: conns }, worker);
      while (track.done < segs.length) {
        while (!ready.has(track.done) && failure === null && !stop.signal.aborted) await wait(1000);
        if (signal.aborted) throw new AbortedError();
        if (failure !== null) throw failure;
        if (stop.signal.aborted) throw new AbortedError();
        const piece = ready.get(track.done) as { buf: Buffer | null; file: string; net: number };
        const buf = piece.buf ?? (await fs.promises.readFile(piece.file));
        ready.delete(track.done);
        if (piece.buf) held -= piece.buf.length;
        else void fs.promises.rm(piece.file, { force: true }).catch(() => undefined);
        if (!track.container) track.container = sniff(buf);
        await fd.write(buf, 0, buf.length, track.bytes);
        this.early.bytes -= buf.length;
        this.early.secs -= segs[track.done].duration;
        track.bytes += buf.length;
        track.secs += segs[track.done].duration;
        track.done++;
        this.inflight -= piece.net;
        notify();
      }
      await Promise.all(workers);
    } finally {
      if (failure === null) failure = new AbortedError();
      stop.abort();
      notify();
      signal.removeEventListener('abort', relay);
      ready.clear();
      this.early = { bytes: 0, secs: 0 };
      await fd.close().catch(() => undefined);
      await fs.promises.rm(spill, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * One segment: fetched with backoff, decrypted, unwrapped. A refused (expired) address is looked
   * up again. A connection the server turns away steps aside when `mayYield(attempt)` allows it.
   */
  private async fetchPiece(seg: MediaSegment, track: HlsTrack, signal: AbortSignal, mayYield?: (attempt: number) => boolean): Promise<{ buf: Buffer; net: number }> {
    let current = seg;
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await this.fetchBytes(current.url, current.range, signal, true);
        let buf = got.buf;
        if (current.key) buf = decrypt(buf, await this.key(current.key, signal), current.key.iv ?? sequenceIv(current.seq));
        return { buf: unwrapDisguised(buf), net: got.net };
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (refusedConnection(err) && mayYield?.(attempt)) throw new ConnectionRefusedError();
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) {
          this.env.refreshHeaders();
          const fresh = await this.refreshed(track, current.seq, signal).catch(() => null);
          if (fresh && attempt < ATTEMPTS) {
            current = fresh;
            continue;
          }
        }
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  private async fetchBytes(url: string, range: [number, number] | null, signal: AbortSignal, counts: boolean): Promise<{ buf: Buffer; net: number }> {
    const res = await open(url, this.env.headers, range ? { Range: `bytes=${range[0]}-${range[1] - 1}` } : {}, signal);
    if (res.status < 200 || res.status >= 300) {
      res.body.destroy();
      throw new HttpStatusError(res.status, retryAfter(res.headers));
    }
    if (range && res.status === 200 && Number(header(res.headers, 'content-length')) > 64 * 1024 * 1024) {
      res.body.destroy();
      throw new DownloadError('The site wouldn’t send this video in parts.');
    }
    let net = 0;
    this.live++;
    try {
      let buf = await readBody(res.body, {
        max: SEGMENT_MAX,
        onChunk: async (n) => {
          if (counts) {
            net += n;
            this.inflight += n;
          }
          this.env.onBytes(n);
          const w = throttle(this.env.limiters, n);
          if (w > 0) await sleep(w, signal);
        },
      });
      if (range) {
        // A 200 is the whole resource: cut the slice out. A 206 must be exactly the slice.
        if (res.status === 200) {
          if (buf.length < range[1]) throw new DownloadError('The site wouldn’t send this video in parts.');
          buf = buf.subarray(range[0], range[1]);
        } else if (buf.length !== range[1] - range[0]) throw new DownloadError('The site wouldn’t send this video in parts.');
      }
      if (!buf.length) throw new ShortBodyError();
      return { buf, net };
    } catch (err) {
      this.inflight -= net;
      throw err;
    } finally {
      this.live--;
    }
  }

  private async text(url: string, signal: AbortSignal, fresh = false): Promise<string> {
    const hit = this.texts.get(url);
    if (hit && !fresh) return hit;
    for (let attempt = 1; ; attempt++) {
      try {
        const text = (await this.fetchBytes(url, null, signal, false)).buf.toString('utf8');
        if (!isPlaylist(text)) throw new DownloadError('The stream’s playlist couldn’t be read.');
        this.texts.set(url, text);
        return text;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshHeaders();
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  private async key(ref: KeyRef, signal: AbortSignal): Promise<Buffer> {
    const hit = this.keys.get(ref.url);
    if (hit) return hit;
    for (let attempt = 1; ; attempt++) {
      try {
        const { buf } = await this.fetchBytes(ref.url, null, signal, false);
        if (buf.length !== 16) throw new DownloadError('The stream’s key couldn’t be read.');
        this.keys.set(ref.url, buf);
        return buf;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(backoff(attempt, null) * 1000, signal);
      }
    }
  }

  /** The same segment as the playlist describes it now (matched by media sequence, never by position). */
  private async refreshed(track: HlsTrack, seq: number, signal: AbortSignal): Promise<MediaSegment | null> {
    const last = this.refreshedAt.get(track.url) ?? 0;
    if (Date.now() - last > 30_000) {
      this.refreshedAt.set(track.url, Date.now());
      this.playlists.set(track.url, parseMedia(await this.text(track.url, signal, true), track.url));
    }
    return this.playlists.get(track.url)?.segments.find((s) => s.seq === seq) ?? null;
  }
}

/** How far through each of `n` stretches of the stream the main track is (written in order, so they fill left to right). */
export function hlsFills(s: HlsState, n = 8): number[] {
  const t = s.tracks[0];
  if (!t?.count) return [];
  const per = t.count / n;
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(1, (t.done - i * per) / per)));
}

/**
 * Bytes a stream is likely to be: bytes per media second so far (written, plus `early` segments
 * fetched out of order) times the track's length; the playlist's bitrate before anything arrived.
 */
export function hlsEstimate(s: HlsState, early = { bytes: 0, secs: 0 }): number {
  if (s.expected && !s.tracks.some((t) => (t.secs ?? 0) > 0) && !early.secs) return s.expected;
  let total = 0;
  s.tracks.forEach((t, i) => {
    const current = i === s.tracks.findIndex((x) => x.done < x.count);
    const secs = (t.secs ?? 0) + (current ? early.secs : 0);
    const bytes = t.bytes - t.initBytes + (current ? early.bytes : 0);
    if (secs > 0 && t.length > 0) total += t.initBytes + (bytes / secs) * t.length;
    else if (t.kind === 'main' && s.bandwidth && s.duration) total += (s.bandwidth / 8) * s.duration;
    else if (t.kind === 'audio' && t.length) total += 16_000 * t.length;
  });
  return Math.round(total) || -1;
}

export function trackPart(partBase: string, t: HlsTrack): string {
  return `${partBase}.${t.kind === 'main' ? 'video' : 'audio'}.part`;
}

function extension(c: Container, audio: boolean): string {
  if (c === 'mp4') return audio ? '.m4a' : '.mp4';
  if (c === 'aac') return '.aac';
  return '.ts';
}

async function removeQuietly(...files: string[]): Promise<void> {
  for (const f of files) if (f) await fs.promises.rm(f, { force: true }).catch(() => undefined);
}

function sequenceIv(seq: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(seq), 8);
  return iv;
}

function decrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  try {
    const d = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([d.update(data), d.final()]);
  } catch {
    throw new DownloadError('A piece of the video couldn’t be decrypted.');
  }
}

function boxType(buf: Buffer, at: number): string {
  return buf.length >= at + 8 ? buf.toString('latin1', at + 4, at + 8) : '';
}

export function sniff(buf: Buffer): Container {
  if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) return 'ts';
  if (['ftyp', 'styp', 'moof', 'sidx'].includes(boxType(buf, 0))) return 'mp4';
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0)) return 'aac';
  return 'ts';
}

function looksLikeSegment(buf: Buffer): boolean {
  return buf.length >= 8 && (buf[0] === 0x47 || ['ftyp', 'styp', 'moof'].includes(boxType(buf, 0)));
}

/** Some CDNs hide segments behind a tiny PNG, JPEG or GIF; the real bytes follow the image. */
function unwrapDisguised(buf: Buffer): Buffer {
  if (buf.length <= 80) return buf;
  let rest: Buffer | null = null;
  if (buf.readUInt32BE(0) === 0x89504e47) {
    let at = 8;
    while (at + 12 <= buf.length) {
      const len = buf.readUInt32BE(at);
      const type = buf.toString('latin1', at + 4, at + 8);
      at += 12 + len;
      if (type === 'IEND') {
        rest = at < buf.length ? buf.subarray(at) : null;
        break;
      }
    }
  } else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const end = buf.indexOf(Buffer.from([0xff, 0xd9]), 2);
    rest = end > 0 ? buf.subarray(end + 2) : null;
  } else if (buf.toString('latin1', 0, 4) === 'GIF8') {
    const end = buf.lastIndexOf(0x3b);
    rest = end > 0 ? buf.subarray(end + 1) : null;
  }
  return rest && looksLikeSegment(rest) ? rest : buf;
}
