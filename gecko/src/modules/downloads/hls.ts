// Streams: the segments of one HLS rendition (or one DASH representation) fetched on parallel
// connections and written in order, then joined with ffmpeg. Port of
// app/src/main/modules/downloads/hls.ts (HLSDownload.swift) onto the Gecko pieces proven in
// spikes/downloader/verify/engine/VitreHls.sys.mjs, with what the prototype left out:
//   - racing: when the connections are idle and the next segment to write is overdue, a second
//     request races it (the slower one is dropped);
//   - spill-to-disk: segments that arrive early wait in memory up to 48 MB, then in <part>.d/;
//   - playlist refresh: a segment refused with 401/403 is looked up again in a fresh copy of its
//     playlist (or manifest), matched by media sequence;
//   - segments disguised behind a small PNG/JPEG/GIF are unwrapped;
//   - DASH (dash.ts): the best video + the best audio representation as two tracks, joined;
//   - fMP4 with a separate audio rendition (verified on Apple's bipbop stream by the verifier).
// AES-128 is decrypted with WebCrypto; SAMPLE-AES, Widevine, PlayReady, FairPlay and any DASH
// ContentProtection are DRM and refused. Appends go through partfile.Writer (off the main thread);
// snapshot() persists only what certainly reached the file, at a segment boundary.
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { dashAudio, dashLadder, isMpd, parseMpd, type DashRep, type Mpd } from './dash';
import { runFfmpeg } from './ffmpeg';
import { throttle } from './limiter';
import {
  AbortedError, ConnectionRefusedError, DownloadError, HttpStatusError, ShortBodyError, backoff, isRetryable, open, parseContentRange,
  refusedConnection, retryAfter, sleep,
} from './net';
import { Writer, setSize, sizeOf } from './partfile';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia, type KeyRef, type MediaPlaylist, type MediaSegment } from './playlist';
import type { TransferEnv } from './ranged';
import type { FfmpegInfo } from './types';

export type Container = '' | 'ts' | 'mp4' | 'aac' | 'webm';

export interface StreamTrack {
  kind: 'main' | 'audio';
  /** HLS: the media playlist. DASH: the manifest with #vitre-rep=<id>. */
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

export interface StreamState {
  format?: 'hls' | 'dash';
  sourceUrl: string;
  variantUrl: string;
  audioUrl: string;
  dashVideo?: string;
  dashAudio?: string;
  audioOnly: boolean;
  resolved: boolean;
  bandwidth: number;
  duration: number;
  /** A size estimate from the picker, used until segments are measured. */
  expected?: number;
  tracks: StreamTrack[];
}

export interface StreamEnv extends TransferEnv {
  ffmpeg: () => Promise<FfmpegInfo>;
}

export const DRM_MESSAGE = 'This video is protected and can’t be saved.';
export const LIVE_MESSAGE = 'Live streams can’t be saved.';
const ATTEMPTS = 3;
const SEGMENT_MAX = 256 * 1024 * 1024;
/** Early segments wait in memory up to this much, then on disk. */
const SPILL_AFTER = 48 * 1024 * 1024;
/** The writer may hold this much before the in-order loop waits for the disk. */
const WRITE_BACKLOG = 32 * 1024 * 1024;
/** A one-file DASH representation (SegmentBase) is fetched in pieces of this size. */
const PIECE = 4 * 1024 * 1024;
const REP = '#vitre-rep=';

type Piece = { buf: Uint8Array | null; file: string; net: number };
type Mark = { done: number; bytes: number; secs: number; initBytes: number; container: Container; at: number };

export class StreamTransfer {
  live = 0;
  /** A sentence for the finished download when it could not be joined ("" when it was). */
  note = '';
  private inflight = 0;
  /** Segments fetched but not yet written (they arrive out of order): bytes and media seconds. */
  private early = { bytes: 0, secs: 0 };
  private playlists = new Map<string, MediaPlaylist>();
  private texts = new Map<string, string>();
  private keys = new Map<string, Promise<CryptoKey>>();
  private refreshedAt = new Map<string, number>();
  private refreshing = new Map<string, Promise<void>>();
  private writers = new Map<StreamTrack, { writer: Writer; marks: Mark[] }>();
  private mpd: Mpd | null = null;
  private muxer: FfmpegInfo = { path: null, source: 'none', settingBroken: false };

  constructor(
    readonly state: StreamState,
    private env: StreamEnv
  ) {}

  static fresh(sourceUrl: string, opts: { format?: 'hls' | 'dash'; variantUrl?: string; audioUrl?: string; dashVideo?: string; dashAudio?: string; audioOnly?: boolean; bytes?: number } = {}): StreamState {
    return {
      format: opts.format ?? 'hls',
      sourceUrl,
      variantUrl: opts.variantUrl ?? '',
      audioUrl: opts.audioUrl ?? '',
      dashVideo: opts.dashVideo ?? '',
      dashAudio: opts.dashAudio ?? '',
      audioOnly: !!opts.audioOnly,
      resolved: false,
      bandwidth: 0,
      duration: 0,
      expected: opts.bytes || 0,
      tracks: [],
    };
  }

  get received(): number {
    return this.state.tracks.reduce((n, t) => n + t.bytes, 0) + Math.max(0, this.inflight);
  }

  /** Bytes the finished stream is likely to be: measured segments once there are some, the bitrate before. */
  get estimate(): number {
    const e = streamEstimate(this.state, this.early);
    return e < 0 ? -1 : Math.max(e, this.received);
  }

  /** The state as it is safe to persist: each track at the last segment that certainly reached its file. */
  snapshot(): StreamState {
    return {
      ...this.state,
      tracks: this.state.tracks.map((t) => {
        const w = this.writers.get(t);
        if (!w) return { ...t };
        const durable = w.writer.durable;
        const mark = [...w.marks].reverse().find((m) => m.at <= durable) ?? w.marks[0];
        return { ...t, done: mark.done, bytes: mark.bytes, secs: mark.secs, initBytes: mark.initBytes, container: mark.container };
      }),
    };
  }

  // ---- preparing ----

  /** Resolve a master playlist (or a manifest) to one rendition and its audio, then read the media playlists. */
  async prepare(signal: AbortSignal): Promise<void> {
    this.muxer = await this.env.ffmpeg();
    if (this.state.format === 'dash') await this.prepareDash(signal);
    else await this.prepareHls(signal);
    for (const t of this.state.tracks) {
      const pl = this.playlists.get(t.url);
      if (!pl) throw new DownloadError('The stream’s playlist couldn’t be read.');
      if (pl.drm) throw new DownloadError(DRM_MESSAGE);
      if (!pl.endList) throw new DownloadError(LIVE_MESSAGE);
      if (pl.iframesOnly || !pl.segments.length) throw new DownloadError('This video can’t be saved.');
      // A playlist that changed shape since the last run can't be continued by position.
      if (t.count && t.count !== pl.segments.length) Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
      t.count = pl.segments.length;
      t.length = pl.duration;
      t.secs = pl.segments.slice(0, t.done).reduce((n, x) => n + x.duration, 0);
      if (t.kind === 'main') this.state.duration = pl.duration;
    }
  }

  private async prepareHls(signal: AbortSignal): Promise<void> {
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
        const pick = s.audioOnly ? rungs.find((v) => v.audioOnly) : (rungs.find((v) => !v.audioOnly) ?? rungs[0]);
        const rendition = pick ? audioFor(master, pick) : (master.renditions.find((r) => r.type === 'AUDIO' && r.url) ?? null);
        if (s.audioOnly && !pick && rendition) main = rendition.url;
        else if (pick) {
          main = pick.url;
          s.bandwidth = pick.bandwidth;
          if (!s.audioOnly && rendition && !audio) audio = rendition.url;
        } else throw new DownloadError('This stream has nothing Deer can save.');
      }
      s.tracks = [newTrack('main', main)];
      if (audio && audio !== main) s.tracks.push(newTrack('audio', audio));
      s.resolved = true;
    }
    for (const t of s.tracks) this.playlists.set(t.url, parseMedia(await this.text(t.url, signal), t.url));
  }

  private async prepareDash(signal: AbortSignal, fresh = false): Promise<void> {
    const s = this.state;
    const text = await this.text(s.sourceUrl, signal, fresh);
    const mpd = parseMpd(text, s.sourceUrl);
    this.mpd = mpd;
    if (mpd.drm) throw new DownloadError(DRM_MESSAGE);
    if (mpd.live) throw new DownloadError(LIVE_MESSAGE);
    if (mpd.periods > 1) throw new DownloadError('This video is made of several parts Deer can’t join yet.');
    if (!s.resolved) {
      const video = (s.dashVideo && mpd.reps.find((r) => r.kind === 'video' && r.id === s.dashVideo)) || dashLadder(mpd)[0] || null;
      const audio = (s.dashAudio && mpd.reps.find((r) => r.kind === 'audio' && r.id === s.dashAudio)) || dashAudio(mpd);
      const main = s.audioOnly ? audio : video;
      if (!main) throw new DownloadError('This stream has nothing Deer can save.');
      s.dashVideo = video?.id ?? '';
      s.dashAudio = audio?.id ?? '';
      s.bandwidth = main.bandwidth + (!s.audioOnly && audio ? audio.bandwidth : 0);
      s.tracks = [newTrack('main', s.sourceUrl + REP + encodeURIComponent(main.id))];
      if (!s.audioOnly && audio && video) s.tracks.push(newTrack('audio', s.sourceUrl + REP + encodeURIComponent(audio.id)));
      s.resolved = true;
    }
    for (const t of s.tracks) {
      const id = decodeURIComponent(t.url.slice(t.url.indexOf(REP) + REP.length));
      const rep = mpd.reps.find((r) => r.id === id);
      if (!rep) throw new DownloadError('The stream changed since the download started.');
      this.playlists.set(t.url, rep.playlist ?? (await this.onePieceList(rep, mpd.duration, signal)));
    }
  }

  /** A representation that is one file (SegmentBase): its byte ranges as segments. */
  private async onePieceList(rep: DashRep, duration: number, signal: AbortSignal): Promise<MediaPlaylist> {
    const res = await open(rep.file, this.env.identity, { Range: 'bytes=0-0' }, signal);
    res.destroy();
    if (res.status !== 206 && res.status !== 200) throw new HttpStatusError(res.status, retryAfter(res));
    const total = res.status === 206 ? (parseContentRange(res.header('content-range'))?.total ?? -1) : res.contentLength;
    const out: MediaPlaylist = { segments: [], init: null, endList: true, drm: false, iframesOnly: false, duration: 0 };
    if (!(total > 0)) {
      out.segments.push({ url: rep.file, seq: 0, key: null, range: null, duration });
      out.duration = duration;
      return out;
    }
    for (let at = 0, i = 0; at < total; at += PIECE, i++) {
      const end = Math.min(total, at + PIECE);
      const d = duration ? (duration * (end - at)) / total : 0;
      out.segments.push({ url: rep.file, seq: i, key: null, range: [at, end], duration: d });
      out.duration += d;
    }
    return out;
  }

  /** The finished file's extension as far as can be told before downloading. */
  expectedExtension(): string {
    const s = this.state;
    if (s.format === 'dash') {
      const webm = this.mpd?.reps.some((r) => s.tracks.some((t) => t.url.endsWith(REP + encodeURIComponent(r.id))) && /webm/i.test(r.mime));
      if (webm) return s.audioOnly ? '.weba' : '.webm';
      return s.audioOnly ? '.m4a' : '.mp4';
    }
    const main = s.tracks[0];
    const pl = main ? this.playlists.get(main.url) : undefined;
    if (this.muxer.path || pl?.init) return s.audioOnly ? '.m4a' : '.mp4';
    if (s.audioOnly && /\.aac(\?|#|$)/i.test(pl?.segments[0]?.url ?? '')) return '.aac';
    return '.ts';
  }

  // ---- downloading ----

  async download(partBase: string, signal: AbortSignal): Promise<void> {
    for (const t of this.state.tracks) {
      this.inflight = 0;
      await this.runTrack(t, trackPart(partBase, t), signal);
    }
    this.inflight = 0;
  }

  /**
   * Turn the track files into the finished file. `place(ext, suffix)` returns a free path for the
   * download's name with that extension. Returns the main file's path. Without ffmpeg, or when it
   * fails, the tracks are kept as they are and `note` says so.
   */
  async finish(partBase: string, place: (ext: string, suffix?: string) => string, signal: AbortSignal, onProgress: ((seconds: number) => void) | null = null): Promise<string> {
    const [main, audio] = this.state.tracks;
    const mainPart = trackPart(partBase, main);
    const audioPart = audio ? trackPart(partBase, audio) : '';
    const webm = main.container === 'webm' && (!audio || audio.container === 'webm');
    const needsMux = !!audio || main.container === 'ts' || main.container === 'aac';
    const ff = this.muxer.path;
    if (ff && needsMux) {
      const out = place(webm ? (this.state.audioOnly ? '.weba' : '.webm') : this.state.audioOnly ? '.m4a' : '.mp4');
      const tmp = `${partBase}.merge.part`;
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', mainPart];
      if (audio) args.push('-i', audioPart, '-map', '0:v:0?', '-map', '1:a:0?');
      else args.push('-map', '0:v?', '-map', '0:a?');
      args.push('-c', 'copy');
      if (!webm) args.push('-movflags', '+faststart');
      args.push('-f', webm ? 'webm' : 'mp4', tmp);
      try {
        await runFfmpeg(ff, args, signal, onProgress);
        await IOUtils.move(tmp, out);
        await IOUtils.remove(mainPart, { ignoreAbsent: true });
        if (audioPart) await IOUtils.remove(audioPart, { ignoreAbsent: true });
        return out;
      } catch (err) {
        await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => undefined);
        if (signal.aborted) throw new AbortedError();
        // Keep what downloaded rather than throw it away over the container.
        this.note = audio ? 'Couldn’t join the video and its sound: saved as two files.' : 'Couldn’t repackage the video: saved as it came.';
        console.warn('Deer downloads: ffmpeg failed', String(err));
      }
    } else if (needsMux) {
      this.note = audio ? 'ffmpeg not found: the video and its sound are saved as two files.' : 'ffmpeg not found: saved as it came (TS).';
    }
    const out = place(extension(main.container, this.state.audioOnly));
    await IOUtils.move(mainPart, out);
    if (audio) await IOUtils.move(audioPart, place(extension(audio.container, true), ' (audio)'));
    return out;
  }

  /**
   * Fetch a track's segments on parallel connections and write them in order. Segments that arrive
   * early wait in memory (up to 48 MB) and then on disk, so a slow one never stalls the others; when
   * the connections are idle and the next segment to write is overdue, a second request races it.
   */
  private async runTrack(track: StreamTrack, partPath: string, signal: AbortSignal): Promise<void> {
    const pl = this.playlists.get(track.url);
    if (!pl) throw new DownloadError('The stream’s playlist couldn’t be read.');
    const segs = pl.segments;
    const stop = new AbortController();
    let wake: (() => void)[] = [];
    const notify = (): void => {
      const w = wake;
      wake = [];
      for (const f of w) f();
    };
    const wait = (ms: number): Promise<void> =>
      new Promise<void>((r) => {
        wake.push(r);
        setTimeout(r, ms);
      });
    const relay = (): void => {
      stop.abort();
      notify();
    };
    signal.addEventListener('abort', relay);
    const ready = new Map<number, Piece>();
    const started = new Map<number, number>();
    const hedged = new Set<number>();
    const racers = new Map<number, AbortController[]>();
    const spill = `${partPath}.d`;
    let spillMade = false;
    let held = 0;
    let avgMs = 0;
    let failure: unknown = null;
    let next = track.done;
    const conns = Math.max(1, Math.min(16, this.env.connections()));
    const ahead = Math.max(24, conns * 4);
    // Workers still fetching; one the server turns away steps aside while another remains, and its
    // segment goes back in line.
    let alive = conns;
    const requeue: number[] = [];

    /** Fetch segment `i` on a worker; 'retire' when the server refused that connection. */
    const take = async (i: number, hedge: boolean, conn: { accepted: boolean; lane: number }): Promise<'retire' | void> => {
      const ac = new AbortController();
      const onStop = (): void => ac.abort();
      stop.signal.addEventListener('abort', onStop);
      racers.set(i, [...(racers.get(i) ?? []), ac]);
      const t0 = Date.now();
      if (!started.has(i)) started.set(i, t0);
      try {
        // A connection the server never let in steps aside at once; one it did, after its retries.
        const mayYield = (attempt: number): boolean => !hedge && alive > 1 && (!conn.accepted || attempt >= ATTEMPTS);
        const piece = await this.fetchPiece(segs[i], track, ac.signal, mayYield, conn.lane);
        conn.accepted = true;
        if (ready.has(i) || i < track.done) {
          this.inflight -= piece.net;
          return;
        }
        for (const other of racers.get(i) ?? []) if (other !== ac) other.abort();
        avgMs = avgMs ? avgMs * 0.8 + (Date.now() - t0) * 0.2 : Date.now() - t0;
        if (i !== track.done && held + piece.buf.length > SPILL_AFTER) {
          if (!spillMade) {
            await IOUtils.makeDirectory(spill, { ignoreExisting: true });
            spillMade = true;
          }
          const file = PathUtils.join(spill, String(i));
          await IOUtils.write(file, piece.buf);
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

    const work = async (conn: { accepted: boolean; lane: number }): Promise<void> => {
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
    const worker = async (lane: number): Promise<void> => {
      try {
        await work({ accepted: false, lane });
      } finally {
        alive--;
        notify();
      }
    };

    // Resume: the part file is the truth. Longer than recorded: cut back. Shorter: start again.
    const size = await sizeOf(partPath);
    if (track.done === 0 || size < track.bytes) {
      Object.assign(track, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
      next = 0;
      setSize(partPath, 0, { truncate: true });
    } else if (size > track.bytes) {
      setSize(partPath, track.bytes);
    }
    const writer = new Writer(partPath, -1);
    const marks: Mark[] = [];
    const mark = (): void => {
      marks.push({ done: track.done, bytes: track.bytes, secs: track.secs, initBytes: track.initBytes, container: track.container, at: writer.written });
      // Marks older than what is certainly on disk are never needed again.
      const durable = writer.durable;
      while (marks.length > 2 && marks[1].at <= durable) marks.shift();
    };
    mark();
    this.writers.set(track, { writer, marks });
    try {
      try {
        if (track.done === 0 && pl.init) {
          const init = await this.fetchPiece({ url: pl.init.url, seq: 0, key: pl.init.key, range: pl.init.range, duration: 0 }, track, stop.signal);
          writer.writeBytes(init.buf);
          this.inflight -= init.net;
          track.bytes = track.initBytes = init.buf.length;
          track.container = sniff(init.buf) === 'webm' ? 'webm' : 'mp4';
          mark();
        }
        const workers = Array.from({ length: conns }, (_, i) => worker(i));
        while (track.done < segs.length) {
          while (!ready.has(track.done) && failure === null && !stop.signal.aborted && alive > 0) await wait(1000);
          if (signal.aborted) throw new AbortedError();
          if (failure !== null) throw failure;
          if (stop.signal.aborted) throw new AbortedError();
          if (!ready.has(track.done)) throw new DownloadError('Some parts of the video didn’t arrive.');
          const piece = ready.get(track.done) as Piece;
          const buf = piece.buf ?? (await IOUtils.read(piece.file));
          ready.delete(track.done);
          if (piece.buf) held -= piece.buf.length;
          else IOUtils.remove(piece.file, { ignoreAbsent: true }).catch(() => undefined);
          if (!track.container) track.container = sniff(buf);
          writer.writeBytes(buf);
          this.early.bytes -= buf.length;
          this.early.secs -= segs[track.done].duration;
          track.bytes += buf.length;
          track.secs += segs[track.done].duration;
          track.done++;
          this.inflight -= piece.net;
          mark();
          notify();
          // The disk sets the pace: never hold more than WRITE_BACKLOG in the writer's pipe.
          while (writer.backlog > WRITE_BACKLOG && !stop.signal.aborted) await sleep(20).catch(() => undefined);
        }
        await Promise.all(workers);
      } finally {
        if (failure === null) failure = new AbortedError();
        stop.abort();
        notify();
        signal.removeEventListener('abort', relay);
        ready.clear();
        this.early = { bytes: 0, secs: 0 };
        if (spillMade) await IOUtils.remove(spill, { recursive: true, ignoreAbsent: true }).catch(() => undefined);
      }
    } finally {
      // The track's counters are only true once the writer has flushed; after a disk error they go
      // back to the last segment that certainly reached the file.
      try {
        await writer.close();
      } catch (err) {
        const durable = writer.durable;
        const m = [...marks].reverse().find((x) => x.at <= durable) ?? marks[0];
        Object.assign(track, { done: m.done, bytes: m.bytes, secs: m.secs, initBytes: m.initBytes, container: m.container });
        this.writers.delete(track);
        throw err;
      }
      this.writers.delete(track);
    }
  }

  /**
   * One segment: fetched with backoff, decrypted, unwrapped. A refused (expired) address is looked
   * up again. A connection the server turns away steps aside when `mayYield(attempt)` allows it.
   */
  private async fetchPiece(seg: MediaSegment, track: StreamTrack, signal: AbortSignal, mayYield?: (attempt: number) => boolean, lane: number | null = null): Promise<{ buf: Uint8Array; net: number }> {
    let current = seg;
    let refreshes = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await this.fetchBytes(current.url, current.range, signal, true, lane);
        let buf = got.buf;
        if (current.key) buf = await decrypt(buf, await this.key(current.key, signal), current.key.iv ?? sequenceIv(current.seq));
        return { buf: unwrapDisguised(buf), net: got.net };
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (refusedConnection(err) && mayYield?.(attempt)) throw new ConnectionRefusedError();
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403) && refreshes < ATTEMPTS) {
          // An expired address: the same segment as a fresh playlist describes it. A new address does
          // not use up an attempt.
          refreshes++;
          this.env.refreshIdentity?.();
          const fresh = await this.refreshed(track, current, signal).catch(() => null);
          if (fresh && fresh.url !== current.url) {
            current = fresh;
            attempt--;
            continue;
          }
        }
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  private async fetchBytes(url: string, range: [number, number] | null, signal: AbortSignal, counts: boolean, lane: number | null = null): Promise<{ buf: Uint8Array; net: number }> {
    const res = await open(url, this.env.identity, range ? { Range: `bytes=${range[0]}-${range[1] - 1}` } : {}, signal, { lane });
    if (res.status < 200 || res.status >= 300) {
      res.destroy();
      throw new HttpStatusError(res.status, retryAfter(res));
    }
    if (range && res.status === 200 && res.contentLength > 64 * 1024 * 1024) {
      res.destroy();
      throw new DownloadError('The site wouldn’t send this video in parts.');
    }
    let net = 0;
    this.live++;
    try {
      let buf = await res.bytes({
        max: SEGMENT_MAX,
        onChunk: (n) => {
          if (counts) {
            net += n;
            this.inflight += n;
          }
          this.env.onBytes(n);
          const w = throttle(this.env.limiters, n);
          return w > 0 ? { wait: w } : undefined;
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

  /** A playlist or manifest, read once (or again, fresh). */
  private async text(url: string, signal: AbortSignal, fresh = false): Promise<string> {
    const hit = this.texts.get(url);
    if (hit && !fresh) return hit;
    for (let attempt = 1; ; attempt++) {
      try {
        const text = new TextDecoder('utf-8').decode((await this.fetchBytes(url, null, signal, false)).buf);
        if (!isPlaylist(text) && !isMpd(text)) throw new DownloadError('The stream’s playlist couldn’t be read.');
        this.texts.set(url, text);
        return text;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) this.env.refreshIdentity?.();
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** The key, fetched once however many segments ask for it at the same moment. */
  private key(ref: KeyRef, signal: AbortSignal): Promise<CryptoKey> {
    let pending = this.keys.get(ref.url);
    if (!pending) {
      pending = (async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            const { buf } = await this.fetchBytes(ref.url, null, signal, false);
            if (buf.length !== 16) throw new DownloadError('The stream’s key couldn’t be read.');
            return crypto.subtle.importKey('raw', buf as Uint8Array<ArrayBuffer>, { name: 'AES-CBC' }, false, ['decrypt']);
          } catch (err) {
            if (signal.aborted) throw new AbortedError();
            if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
            await sleep(backoff(attempt, null) * 1000, signal);
          }
        }
      })();
      this.keys.set(ref.url, pending);
      pending.catch(() => this.keys.delete(ref.url));
    }
    return pending;
  }

  /**
   * The same segment as the playlist (or manifest) describes it now: matched by media sequence, never
   * by position. The playlist is read again once for every connection that hit the expired address
   * (they wait for the same read), and at most every 5 s.
   */
  private async refreshed(track: StreamTrack, stale: MediaSegment, signal: AbortSignal): Promise<MediaSegment | null> {
    const lookup = (): MediaSegment | null => this.playlists.get(track.url)?.segments.find((s) => s.seq === stale.seq) ?? null;
    const known = lookup();
    if (known && known.url !== stale.url) return known;
    let pending = this.refreshing.get(track.url);
    if (!pending && Date.now() - (this.refreshedAt.get(track.url) ?? 0) > 5000) {
      this.refreshedAt.set(track.url, Date.now());
      pending = (async () => {
        if (this.state.format === 'dash') await this.prepareDash(signal, true);
        else this.playlists.set(track.url, parseMedia(await this.text(track.url, signal, true), track.url));
      })();
      this.refreshing.set(track.url, pending);
      pending.then(
        () => this.refreshing.delete(track.url),
        () => this.refreshing.delete(track.url)
      );
    }
    if (pending) await pending;
    return lookup();
  }
}

function newTrack(kind: StreamTrack['kind'], url: string): StreamTrack {
  return { kind, url, done: 0, bytes: 0, initBytes: 0, count: 0, secs: 0, length: 0, container: '' };
}

/** How far through each of `n` stretches of the stream the main track is (written in order, so they fill left to right). */
export function streamFills(s: StreamState, n = 8): number[] {
  const t = s.tracks[0];
  if (!t?.count) return [];
  const per = t.count / n;
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(1, (t.done - i * per) / per)));
}

/**
 * Bytes a stream is likely to be: bytes per media second so far (written, plus `early` segments
 * fetched out of order) times the track's length; the playlist's bitrate before anything arrived.
 */
export function streamEstimate(s: StreamState, early = { bytes: 0, secs: 0 }): number {
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

export function trackPart(partBase: string, t: StreamTrack): string {
  return `${partBase}.${t.kind === 'main' ? 'video' : 'audio'}.part`;
}

function extension(c: Container, audio: boolean): string {
  if (c === 'mp4') return audio ? '.m4a' : '.mp4';
  if (c === 'webm') return audio ? '.weba' : '.webm';
  if (c === 'aac') return '.aac';
  return '.ts';
}

function sequenceIv(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setBigUint64(8, BigInt(seq));
  return iv;
}

/** AES-128-CBC with PKCS#7 padding, which is what WebCrypto's AES-CBC does. */
async function decrypt(data: Uint8Array, key: CryptoKey, iv: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as Uint8Array<ArrayBuffer> }, key, data as Uint8Array<ArrayBuffer>));
  } catch {
    throw new DownloadError('A piece of the video couldn’t be decrypted.');
  }
}

function latin1(buf: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...buf.subarray(from, to));
}

function boxType(buf: Uint8Array, at: number): string {
  return buf.length >= at + 8 ? latin1(buf, at + 4, at + 8) : '';
}

export function sniff(buf: Uint8Array): Container {
  if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) return 'ts';
  if (['ftyp', 'styp', 'moof', 'sidx'].includes(boxType(buf, 0))) return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (latin1(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0)) return 'aac';
  return 'ts';
}

function looksLikeSegment(buf: Uint8Array): boolean {
  return buf.length >= 8 && (buf[0] === 0x47 || ['ftyp', 'styp', 'moof'].includes(boxType(buf, 0)));
}

function indexOfPair(buf: Uint8Array, a: number, b: number, from: number): number {
  for (let i = from; i + 1 < buf.length; i++) if (buf[i] === a && buf[i + 1] === b) return i;
  return -1;
}

/** Some CDNs hide segments behind a tiny PNG, JPEG or GIF; the real bytes follow the image. */
export function unwrapDisguised(buf: Uint8Array): Uint8Array {
  if (buf.length <= 80) return buf;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let rest: Uint8Array | null = null;
  if (view.getUint32(0) === 0x89504e47) {
    let at = 8;
    while (at + 12 <= buf.length) {
      const len = view.getUint32(at);
      const type = latin1(buf, at + 4, at + 8);
      at += 12 + len;
      if (type === 'IEND') {
        rest = at < buf.length ? buf.subarray(at) : null;
        break;
      }
    }
  } else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const end = indexOfPair(buf, 0xff, 0xd9, 2);
    rest = end > 0 ? buf.subarray(end + 2) : null;
  } else if (latin1(buf, 0, 4) === 'GIF8') {
    const end = buf.lastIndexOf(0x3b);
    rest = end > 0 ? buf.subarray(end + 1) : null;
  }
  return rest && looksLikeSegment(rest) ? rest : buf;
}
