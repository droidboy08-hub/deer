// Streams: the segments of one HLS rendition (or one DASH representation) fetched on parallel
// connections and written in order, then joined with ffmpeg. Port of
// app/src/main/modules/downloads/hls.ts (HLSDownload.swift) onto the Gecko pieces proven in
// spikes/downloader/verify/engine/VitreHls.sys.mjs, with what the prototype left out:
//   - racing: when the connections are idle and the next segment to write is overdue, a second
//     request races it (the slower one is dropped);
//   - spill-to-disk: segments that arrive early wait in memory up to 48 MB, then in <part>.d/;
//   - playlist refresh: a segment refused (401, 403, 404, 410, 451), answered with something that is not
//     media, or whose key is refused, is looked up again in a fresh copy of its playlist (or manifest),
//     matched by media sequence; it takes the fresh key address even when its own did not change;
//   - segments disguised behind a small PNG/JPEG/GIF are unwrapped;
//   - DASH (dash.ts): the best video + the best audio representation as two tracks, joined;
//   - fMP4 with a separate audio rendition (verified on Apple's bipbop stream by the verifier).
// AES-128 is decrypted with WebCrypto; SAMPLE-AES, Widevine, PlayReady, FairPlay and any DASH
// ContentProtection are DRM and refused. Appends go through partfile.Writer (off the main thread);
// snapshot() persists only what certainly reached the file, at a segment boundary.
//
// Streams that expire or change (spikes/downloader/RESUME-DESIGN.md G2, 2.6, 4.1-4.3; Phase 6):
//   - the segment table (table.ts): every segment written leaves a line {i, seq, off, len, h, d} in the
//     download's <id>.stream.jsonl, hashed as the in-order write loop writes it; the init segment's hash,
//     the key addresses and the rung go in the track's header;
//   - a segment is media by its first bytes (sniff(): TS sync bytes at 0 and 188, MP4 boxes, WebM, ADTS, ID3);
//     a web page or JSON (by its type, or a first byte of '<' or '{') is never written (NotTheFileError);
//   - a resume continues where the table says, mapped by media sequence while the MEDIA-SEQUENCE base is
//     the same, otherwise by time (table.ts mapNext()), never by position; streamProof (proveTrack()) asks
//     the duration within 1 s, the place to map, the init segment to hash as before, and the last written
//     segment, fetched again, decrypted and unwrapped, to hash to its line. Key addresses may change. Where
//     it continues comes from the table's last line below the saved count (a crash or a disk error can
//     save a later nextSeq), and segments the count claims beyond the last line are fetched again (review
//     of Phase 6). A resume at addresses that did not change runs the network part of the proof beside the
//     download: nothing is written before it passes (lazyProof); a passed proof is reused for a minute only
//     over the same segments at the same addresses (StreamState.proven);
//   - the renewal steps, when a playlist or a segment is refused or is not what it should be (renewSteps()):
//     the same media playlist (refreshed()), then the master playlist or manifest read again with the same
//     rung picked by its fingerprint (table.ts repick(), matchRep(): DASH ids renamed no longer end it; an
//     audio rendition by its GROUP-ID, language and name), then yt-dlp's manifest for the same height when it
//     is installed (StreamEnv.ytdlpManifest), then (Phase 7, outside a run) the streams of the page opened out
//     of sight, each proven in turn (StreamEnv.pageStreams). A new playlist goes through the proof;
//     on SAME the tracks take the new addresses and continue at the next sequence. Inside a run, a playlist
//     read again is taken only when it is the same stream (the same numbering, count and durations, a DASH
//     representation by its id or renamed) and, once the track wrote segments, its last written segment asked
//     at the new address hashes to its line (review of Phase 6: a renamed representation re-encoded mixed two
//     encodes). An init segment refused is looked up as the init, never as a media segment;
//   - before the proof, the saved parts are checked against the table (inspect()): a part shorter than
//     recorded is cut at the end of its last good segment (no longer started again from zero), and a
//     damaged segment is fetched again, checked against its line and written back at its offset (4.3);
//   - one-file pieces (DASH SegmentBase, HLS byte ranges) carry If-Range. A 200 under another validator
//     decides nothing by itself (2.4 R6): the last written piece of that file, asked again without If-Range,
//     must hash to its line (ChangedError when it does not), then the new validator is taken; two such answers
//     in 10 minutes and Last-Modified is sent instead, one more and no If-Range (another CDN edge, a farm
//     whose backends differ);
//   - the merge reports what ffmpeg said and the output's length, checked against the stream's (within
//     2% or 2 s; 4.2), and Keep partial file merges the written segments, cut to the shorter track (3 G3);
//   - a finished stream repaired (4.3, `expect`) must be the same stream: the same number of segments per
//     track as its table holds, the same length within 1 s and the init segment it had, every segment and
//     the init hashing to their lines.
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { dashAudio, dashLadder, isMpd, parseMpd, type DashRep, type Mpd } from './dash';
import { runFfmpeg } from './ffmpeg';
import { MTIME_SLACK } from './ledger';
import { throttle } from './limiter';
import {
  AbortedError, ChangedError, ConnectionRefusedError, DownloadError, HttpStatusError, NotTheFileError, REFUSED_STATUS, ShortBodyError, backoff, isRetryable, open,
  parseContentRange, refusedConnection, retryAfter, sleep, stopsRun, textStart, type Response,
} from './net';
import { Writer, existsSync, readAt, setSize, sizeOf, writeAt } from './partfile';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia, type KeyRef, type MasterPlaylist, type MediaPlaylist, type MediaSegment } from './playlist';
import { silentRestart, type TransferEnv } from './ranged';
import { DURATION_SLACK, StreamTable, durHash, fingerprinted, keysOf, mapNext, matchRep, pathShape, renditionRung, repRung, repick, rungOf, segmentHash, type SegLine, type TrackHead } from './table';
import type { FfmpegInfo, StreamRung } from './types';

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
  /**
   * RESUME-DESIGN.md 5.3 (Phase 6). `nextSeq`: the media sequence of the next segment to write, in the
   * playlist whose MEDIA-SEQUENCE base is `seq0` (absent or -1 in older records: mapped by time, 5.8).
   * `lastDur`: the last written segment's duration (the time mapping's neighbour check); `initHash` and
   * `lastHash`: the init segment's and the last written segment's hash (their table lines decide);
   * `pathShape`: the media playlist's origin and path; `keyUrls`: the key addresses (they may change);
   * `rung`: a DASH representation's fingerprint; `sealedAt`: when its writer last closed (a .part modified
   * later while nothing ran was changed by another program: every segment is checked, 4.2).
   */
  nextSeq?: number;
  seq0?: number;
  lastDur?: number;
  initHash?: string;
  lastHash?: string;
  pathShape?: string;
  keyUrls?: string[];
  rung?: StreamRung;
  sealedAt?: number;
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
  /** When the tracks started again by themselves after the stream changed (ranged.ts silentRestart). */
  silent?: number[];
  /**
   * The merge crash window (RESUME-DESIGN.md G4, 5.3): 'merging' once the merge's output path was
   * chosen, saved (flushed) before ffmpeg runs, until the row is saved completed. `mergeOut` is that
   * output and `mergeBase` the base the track parts were named after (trackPart()), so a start after
   * a crash can tell a finished merge (the output there, the parts gone) from one to run again.
   */
  phase?: 'merging';
  mergeOut?: string;
  mergeBase?: string;
  /**
   * Phase 6 (RESUME-DESIGN.md 5.3, 5.7): `rung`, the HLS variant's fingerprint (with its audio rendition's),
   * from the picker or the master; `journal`, the segment table's journal (<profile>/vitre-downloads/
   * <id>.stream.jsonl; '' or absent: none, or a private download's in memory); `renew`, the addresses were
   * replaced (the pill's Continue, renewWith()): the next prepare reads them and keeps the progress, and the
   * proof decides; `proven`, when a proof last passed, by what it proved (proofKey(): the track, how many
   * segments were written and every address the playlist gives): a run queued right after a renewal attempt
   * does not fetch the last segment again, but a playlist at other addresses is proven again (review of
   * Phase 6: a proof of one playlist let a re-encoded one through); `prior`, the addresses renewWith()
   * replaced, put back when the proof finds another stream (the new ones are then kept for Start over).
   */
  rung?: StreamRung;
  journal?: string;
  renew?: boolean;
  proven?: Record<string, number>;
  prior?: StreamAddresses & { urls: string[] };
}

/** Where a stream is asked (renewWith()'s addresses, Start over's candidate). */
export interface StreamAddresses {
  sourceUrl: string;
  variantUrl: string;
  audioUrl: string;
  dashVideo: string;
  dashAudio: string;
}

export interface StreamEnv extends TransferEnv {
  ffmpeg: () => Promise<FfmpegInfo>;
  /**
   * G2 step 3: yt-dlp's manifest (manifest_url) for the same rung on the download's page, when yt-dlp is
   * installed; null otherwise. Absent: the step is skipped.
   */
  ytdlpManifest?: (rung: StreamRung | undefined, audioOnly: boolean, signal: AbortSignal) => Promise<{ url: string; format: 'hls' | 'dash' } | null>;
  /**
   * G2 step 4 (Phase 7): the stream addresses the download's page loaded when opened out of sight (the
   * engine's background page step: MediaWatch's HLS or DASH items under the hidden tab, likeliest master
   * first, described fresh, within 1 s of `duration`, on the stream's host or path shape, not protected).
   * Only the renewal attempts outside a run have it; absent: the step is skipped.
   */
  pageStreams?: (format: 'hls' | 'dash', duration: number, own: string[], signal: AbortSignal) => Promise<string[]>;
}

export const DRM_MESSAGE = 'This video is protected and can’t be saved.';
export const LIVE_MESSAGE = 'Live streams can’t be saved.';
const PLAYLIST_MESSAGE = 'The stream’s playlist couldn’t be read.';
const ATTEMPTS = 3;
const SEGMENT_MAX = 256 * 1024 * 1024;
/** Early segments wait in memory up to this much, then on disk. */
const SPILL_AFTER = 48 * 1024 * 1024;
/** The writer may hold this much before the in-order loop waits for the disk. */
const WRITE_BACKLOG = 32 * 1024 * 1024;
/** A one-file DASH representation (SegmentBase) is fetched in pieces of this size. */
const PIECE = 4 * 1024 * 1024;
const REP = '#vitre-rep=';
/** A proof this recent, over the same written segments, is not repeated by the run a renewal attempt queued. */
const PROVEN_FOR = 60 * 1000;
/** A resume checks this many segments below where each track stopped, and this many placed by the id (4.2). */
const SPOT_LAST = 2;
const SPOT_SEEDED = 2;
/** A part shorter than recorded is cut back to the last of at most this many segments that still hash right (4.3). */
const CUT_TRIES = 4;
/** The merged output's length agrees with the stream's within this share, or this many seconds (4.2). */
const LENGTH_SHARE = 0.02;
const LENGTH_SLACK = 2;
/** If-Range answered with 200 under another validator this many times within SLIP_WINDOW: Last-Modified instead (2.4 R6). */
const SLIPS = 2;
const SLIP_WINDOW = 10 * 60 * 1000;

type Piece = { buf: Uint8Array | null; file: string; net: number };
/**
 * Where a track stood after a segment was handed to its writer. `nextSeq` and `lastDur` go back with the
 * counts (review of Phase 6: a crash or a disk error saved the next segment's place with the count before it).
 */
type Mark = { done: number; bytes: number; secs: number; initBytes: number; container: Container; at: number; nextSeq?: number; lastDur?: number };
/** A segment to fetch; the init segment is marked, so a refused one is looked up again as the init (never as a media segment). */
type Fetchable = MediaSegment & { init?: boolean };
/**
 * How a piece is fetched. `refresh`: a refused address is looked up again in a fresh playlist (a run's
 * segments; the proof's own fetches leave renewal to prepare()). `counts`: its bytes are in flight (the
 * proof's are not). `ifRange`: a piece of one file carries If-Range (a check asked without it is R4's window).
 */
type FetchOpts = { mayYield?: (attempt: number) => boolean; lane?: number | null; refresh?: boolean; counts?: boolean; ifRange?: boolean };
/** An If-Range validator pair, as the file first answered with it. */
type Validators = { etag: string; lm: string };

/** The stream's playlist answered with something that is not a playlist: the address is not the stream any more (G2). */
class NotAPlaylistError extends NotTheFileError {
  constructor(contentType = '') {
    super(contentType, 'playlist');
    this.message = PLAYLIST_MESSAGE;
  }
}

/** An address that refused the stream, or a page where a playlist or a segment should be: the renewal steps may find another (G2). */
function renewable(err: unknown): boolean {
  return err instanceof NotTheFileError || (err instanceof HttpStatusError && REFUSED_STATUS.has(err.status));
}

export class StreamTransfer {
  live = 0;
  /** A sentence for the finished download when it could not be joined ("" when it was). */
  note = '';
  /** A changed stream may start its tracks again by itself; false for a row that already asks (see ranged.ts). */
  silentRestarts = true;
  /** A wait's automatic try on its check (prepare()): a 429 or 5xx ends it at once (see ranged.ts waitTry). */
  waitTry = false;
  /** The segment table (RESUME-DESIGN.md 4.1, 5.7), given by the engine; null keeps none. */
  table: StreamTable | null = null;
  /**
   * A finished stream repaired by running it again (4.3): every segment, and the init segment, must hash to
   * this table's line for its place, or the file on the site changed.
   */
  expect: StreamTable | null = null;
  /** Check every written segment against the table: after an unclean session (4.2). */
  deep = false;
  /** History lines for the row (RESUME-DESIGN.md 6): what a renewal or a check did. */
  events: string[] = [];
  /** prepare() ran the renewal steps: a refusal after them was already the attempt at the failure (3.0). */
  renewTried = false;
  /**
   * A run's resume at addresses that did not change runs the network part of the proof (the init segment and
   * the last written segment fetched again) beside the download instead of before it; nothing of a track is
   * written before its proof passes (review of Phase 6). Set by the engine for runs only: a renewal attempt
   * and a repair prove before they answer.
   */
  lazyProof = false;
  /**
   * renewWith()'s addresses when the proof found another stream there (review of Phase 6): the row's own
   * addresses were put back, these are kept for Start over (need.candidate).
   */
  candidate: StreamAddresses | null = null;
  /** prepare() took the addresses renewWith() gave: they are the row's now. */
  renewed = false;
  /** What ffmpeg reported for the merge (4.2): the output's media seconds and its error output. */
  merged = { secs: -1, said: '' };
  private inflight = 0;
  /** Segments fetched but not yet written (they arrive out of order): bytes and media seconds. */
  private early = { bytes: 0, secs: 0 };
  private playlists = new Map<string, MediaPlaylist>();
  private texts = new Map<string, string>();
  private keys = new Map<string, Promise<CryptoKey>>();
  private refreshedAt = new Map<StreamTrack, number>();
  private refreshing = new Map<StreamTrack, Promise<void>>();
  private writers = new Map<StreamTrack, { writer: Writer; marks: Mark[] }>();
  /** Where each track continues in its playlist (the proof's mapping; RESUME-DESIGN.md 2.6). */
  private starts = new Map<StreamTrack, number>();
  /** The network part of each track's proof while it runs beside the download (lazyProof). */
  private proofs = new Map<StreamTrack, Promise<void>>();
  /** Where a running track's written segment i sits in its playlist: index offset + i (the in-run proofs). */
  private offsets = new Map<StreamTrack, number>();
  /** If-Range validators of one-file pieces, by address (the first ranged answer's strong ETag and Last-Modified). */
  private tags = new Map<string, Validators>();
  /** When an address's If-Range ETag was answered with 200 under another one; addresses whose Last-Modified was too (R6). */
  private slips = new Map<string, number[]>();
  private noIfRange = new Set<string>();
  /** Validators the bytes proved (an address and its validator), and the checks running for one. */
  private verified = new Set<string>();
  private verifying = new Map<string, Promise<void>>();
  /** Segment hashes still being computed (the table lines they write). */
  private hashing = new Set<Promise<void>>();
  private mpd: Mpd | null = null;
  private muxer: FfmpegInfo = { path: null, source: 'none', settingBroken: false };
  /** prepare()'s parts and whether it proves renewWith()'s addresses: what the page step's proofs use (renewSteps()). */
  private proveWith = { partBase: '', renewing: false };

  constructor(
    readonly state: StreamState,
    private env: StreamEnv
  ) {}

  static fresh(sourceUrl: string, opts: { format?: 'hls' | 'dash'; variantUrl?: string; audioUrl?: string; dashVideo?: string; dashAudio?: string; audioOnly?: boolean; bytes?: number; rung?: StreamRung } = {}): StreamState {
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
      ...(opts.rung ? { rung: opts.rung } : {}),
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

  /**
   * The state as it is safe to persist: each track at the last segment that certainly reached its file, with
   * the place it continues from and the last written duration of that segment (review of Phase 6: a crash
   * saved them a segment ahead of the count, and the time mapping then found no place: File changed for ever).
   */
  snapshot(): StreamState {
    return {
      ...this.state,
      tracks: this.state.tracks.map((t) => {
        const w = this.writers.get(t);
        if (!w) return { ...t };
        const durable = w.writer.durable;
        const mark = [...w.marks].reverse().find((m) => m.at <= durable) ?? w.marks[0];
        return { ...t, ...atMark(mark), lastHash: mark.done === t.done ? t.lastHash : undefined };
      }),
    };
  }

  // ---- preparing ----

  /**
   * Only what the merge needs (RESUME-DESIGN.md G4): a merge a quit or a crash cut short runs again from
   * the parts on disk, without asking the stream's addresses (prepare()). Phase 6: so does a resume where
   * every segment is already written (G2): an expired playlist never blocks bytes already on disk.
   */
  async loadMuxer(): Promise<void> {
    this.muxer = await this.env.ffmpeg();
  }

  /**
   * Resolve a master playlist (or a manifest) to one rendition and its audio, then read the media
   * playlists; a resume then proves each track's written segments against them (RESUME-DESIGN.md 2.6) and
   * finds where it continues. `partBase`: where the track parts are (a resume's checks of the saved parts,
   * 4.2); '' before the download has a path. The renewal steps (G2) run when an address refuses or is not
   * what it should be, while reading or while the proof fetches its segment, and the proof runs again on
   * what they found.
   */
  async prepare(signal: AbortSignal, partBase = ''): Promise<void> {
    this.muxer = await this.env.ffmpeg();
    // renewWith() (the pill's Continue): the page's addresses replace the row's only once the proof says SAME;
    // another stream there puts the row's back (review of Phase 6) and never starts the row again by itself.
    // `prior` stays until a proof decides (a refused read leaves it for the next try).
    const s = this.state;
    const renewing = !!s.prior;
    // The page step proves each of its streams in renewSteps() with these (review of Phase 7).
    this.proveWith = { partBase, renewing };
    try {
      for (let round = 0; ; round++) {
        await this.read(signal);
        try {
          // The network part of the proof runs beside the download only when no address changed here.
          await this.settle(signal, partBase, this.lazyProof && !this.renewTried && !renewing && round === 0, renewing);
          break;
        } catch (err) {
          if (signal.aborted) throw new AbortedError();
          if (round > 0 || !renewable(err) || !(await this.renewSteps(signal))) throw err;
        }
      }
    } catch (err) {
      if (renewing && err instanceof ChangedError && s.prior) this.putBack(s.prior);
      throw err;
    }
    if (renewing) {
      s.prior = undefined;
      this.renewed = true;
    }
  }

  /** renewWith()'s addresses are another stream: the row's own go back, the new ones are kept for Start over. */
  private putBack(prior: StreamAddresses & { urls: string[] }): void {
    const s = this.state;
    this.candidate = { sourceUrl: s.sourceUrl, variantUrl: s.variantUrl, audioUrl: s.audioUrl, dashVideo: s.dashVideo ?? '', dashAudio: s.dashAudio ?? '' };
    Object.assign(s, { sourceUrl: prior.sourceUrl, variantUrl: prior.variantUrl, audioUrl: prior.audioUrl, dashVideo: prior.dashVideo, dashAudio: prior.dashAudio });
    s.tracks.forEach((t, k) => {
      if (prior.urls[k]) t.url = prior.urls[k];
    });
    s.renew = false;
    s.prior = undefined;
  }

  /** The playlists, read; when they refuse or are not playlists, the renewal steps (G2). */
  private async read(signal: AbortSignal): Promise<void> {
    try {
      if (this.state.format === 'dash') await this.prepareDash(signal);
      else await this.prepareHls(signal);
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      if (!renewable(err) || !(await this.renewSteps(signal, true))) throw err;
    }
  }

  /**
   * Every track against what was read: DRM, live and empty playlists are refused as before; a track with
   * nothing written starts at the first segment; a resume is proven (proveTrack()). A changed stream with at
   * most 1 MiB written starts its tracks again by itself, at most twice in ten minutes (RESUME-DESIGN.md 3
   * G3, Phase 1); otherwise the row asks (ChangedError). Nothing is changed before the decision but what the
   * checks of the saved parts do (a part cut at its last good segment, damaged segments written back with bytes
   * that hash to their lines). `lazy`: the network part of the proof runs beside the download (proofs).
   * `renewing`: renewWith()'s addresses, which never start the row again by themselves (review of Phase 6).
   * A repair (`expect`) asks the same stream first: as many segments per track as its table holds, the length
   * within 1 s, the init segment it had (review of Phase 6: a shorter playlist "repaired" a 24 s video into 12 s).
   */
  private async settle(signal: AbortSignal, partBase: string, lazy = false, renewing = false): Promise<void> {
    const s = this.state;
    let restart: boolean | null = null;
    this.proofs.clear();
    for (const [k, t] of s.tracks.entries()) {
      const pl = this.playlists.get(t.url);
      if (!pl) throw new DownloadError(PLAYLIST_MESSAGE);
      if (pl.drm) throw new DownloadError(DRM_MESSAGE);
      if (!pl.endList) throw new DownloadError(LIVE_MESSAGE);
      if (pl.iframesOnly || !pl.segments.length) throw new DownloadError('This video can’t be saved.');
      if (this.expect) this.sameAsFinished(k, t, pl);
      let start = 0;
      if (t.done) {
        try {
          start = await this.proveTrack(k, t, pl, partBase ? trackPart(partBase, t) : '', signal, lazy);
        } catch (err) {
          if (!(err instanceof ChangedError)) throw err;
          if (restart === null) {
            const log = silentRestart(s.silent, s.tracks.reduce((n, x) => n + x.bytes, 0), this.silentRestarts && !renewing);
            restart = !!log;
            if (log) s.silent = log;
          }
          if (!restart) throw err;
          Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0, nextSeq: undefined, lastDur: undefined, lastHash: undefined, initHash: undefined });
          this.proofs.delete(t);
          start = 0;
        }
      }
      this.starts.set(t, start);
      // Older records (before Phase 6) recount what they wrote from the playlist, as before.
      if (t.done && !(this.table?.lines(k, t.done).length ?? 0)) t.secs = pl.segments.slice(0, t.done).reduce((n, x) => n + x.duration, 0);
      t.count = t.done + (pl.segments.length - start);
      t.length = pl.duration;
      t.seq0 = t.done ? (t.seq0 ?? pl.segments[0].seq) : pl.segments[0].seq;
      t.nextSeq = pl.segments[start]?.seq ?? (pl.segments[pl.segments.length - 1].seq + 1);
      t.pathShape = pathShape(t.url);
      t.keyUrls = keysOf(pl);
      if (t.kind === 'main') s.duration = pl.duration;
    }
  }

  /**
   * A repair's stream against the finished one (RESUME-DESIGN.md 4.3; review of Phase 6): its table's lines for
   * the track (repairStream() checked they are whole), the length the track had within 1 s, an init segment
   * where it had one and none where it had none. Each segment and the init then hash to their lines as they
   * are written (runTrack()), and the engine checks every line was matched.
   */
  private sameAsFinished(k: number, t: StreamTrack, pl: MediaPlaylist): void {
    const want = this.expect?.lines(k) ?? [];
    if (pl.segments.length !== want.length) throw new ChangedError(`it now has ${pl.segments.length} parts instead of ${want.length}`);
    if (t.length > 0 && Math.abs(pl.duration - t.length) > DURATION_SLACK) throw new ChangedError(`it is now ${clock(pl.duration)} long instead of ${clock(t.length)}`);
    if (!!pl.init !== !!this.expect?.head(k)?.init) throw new ChangedError('the start of the video on the site is different now');
  }

  /** What a passed proof proved (StreamState.proven): the track, how many segments it had written, and every address its playlist gives. */
  private proofKey(k: number, t: StreamTrack, pl: MediaPlaylist): string {
    const where = addressesOf(pl);
    return `${k}|${t.done}|${t.url}|${durHash(pl)}|${fnv(where).toString(16)}|${where.length}`;
  }

  /** A proof passed for `key` (StreamState.proven; older ones are dropped). */
  private passed(key: string): void {
    const now = Date.now();
    const kept: Record<string, number> = {};
    for (const [k, at] of Object.entries(this.state.proven ?? {})) if (typeof at === 'number' && now - at < PROVEN_FOR) kept[k] = at;
    kept[key] = now;
    this.state.proven = kept;
  }

  /**
   * streamProof(track, newPlaylist) (RESUME-DESIGN.md 2.6), for a track with written segments; resolves with
   * the index in `pl` of the next segment to write, or rejects with ChangedError:
   *   - the duration within 1 s;
   *   - where it continues comes from the table's last line below the saved count (fromLastLine(); review of
   *     Phase 6);
   *   - the saved part first (4.2, 4.3; inspect()): cut back to its last good segment when shorter than
   *     recorded; damaged segments fetched again, checked against their lines and written back in place
   *     (one that hashes right is the proof below too);
   *   - the place where it continues maps (by media sequence, else by time: table.ts mapNext());
   *   - the network part: the init segment hashes as before, and the last written segment, fetched again,
   *     decrypted and unwrapped, hashes to its line. Skipped when a proof passed in the last minute over the
   *     same segments at the same addresses (proofKey(): a playlist at other addresses is proven again, review
   *     of Phase 6). `lazy`: it runs beside the download (proofs; runTrack() writes nothing of the track before
   *     it passes, and a failure stops the run: review of Phase 6, an ordinary resume waited for it).
   * The proof's own fetches never look the address up again (refreshed()): a refusal goes back to prepare(),
   * whose renewal steps read the playlists again and prove what they find. A record from before Phase 6 (no
   * table) is judged as before: the same number of segments (5.8).
   */
  private async proveTrack(k: number, t: StreamTrack, pl: MediaPlaylist, part: string, signal: AbortSignal, lazy: boolean): Promise<number> {
    const segs = pl.segments;
    if (t.length > 0 && Math.abs(pl.duration - t.length) > DURATION_SLACK) throw new ChangedError(`it is now ${clock(pl.duration)} long instead of ${clock(t.length)}`);
    let lines = this.table?.lines(k, t.done) ?? [];
    if (!lines.length) {
      if (t.count && t.count !== segs.length) throw new ChangedError(`it now has ${segs.length} parts instead of ${t.count}`);
      if (part && (await sizeOf(part)) < 0) {
        this.events.push('Started over: the saved part was moved or deleted');
        Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
        return 0;
      }
      return t.done;
    }
    this.fromLastLine(k, t, lines);
    lines = this.table?.lines(k, t.done) ?? [];
    let bad: SegLine[] = [];
    if (part) {
      bad = await this.inspect(k, t, part, lines);
      if (!t.done) return 0;
      lines = this.table?.lines(k, t.done) ?? [];
    }
    const start = mapNext(t, pl);
    if (start < 0) throw new ChangedError('its parts no longer line up with what is saved');
    const at = (line: SegLine): MediaSegment => {
      const seg = segs[start - (t.done - line.i)];
      if (!seg) throw new ChangedError('its parts no longer line up with what is saved');
      return seg;
    };
    const head = this.table?.head(k);
    // An init segment it was written with and none now: another stream.
    if (head?.init && !pl.init) throw new ChangedError('the start of the video on the site is different now');
    // 4.3: a damaged segment is fetched again, checked against its line before it is written back in place.
    for (const line of bad) {
      const got = await this.fetchPiece(at(line), t, signal, { refresh: false, counts: false });
      if (got.buf.length !== line.len || (await segmentHash(got.buf)) !== line.h) throw new ChangedError('the video on the site is different now');
      await writeAt(part, line.off, got.buf);
    }
    if (bad.length) this.events.push(`Checked the saved video · ${bad.length === 1 ? '1 damaged part' : `${bad.length} damaged parts`} fetched again`);
    const key = this.proofKey(k, t, pl);
    const when = this.state.proven?.[key];
    if (!(typeof when === 'number' && Date.now() - when < PROVEN_FOR)) {
      const init = pl.init && head?.init ? pl.init : null;
      const lastLine = bad.length ? null : lines[lines.length - 1];
      const last = lastLine ? at(lastLine) : null;
      const check = async (): Promise<void> => {
        if (init) {
          // Marked as the init: a refusal is never answered with a media segment (review of Phase 6).
          const got = await this.fetchPiece({ url: init.url, seq: 0, key: init.key, range: init.range, duration: 0, init: true }, t, signal, { refresh: false, counts: false });
          if ((await segmentHash(got.buf)) !== head?.init) throw new ChangedError('the start of the video on the site is different now');
        }
        if (last && lastLine) {
          const got = await this.fetchPiece(last, t, signal, { refresh: false, counts: false });
          if ((await segmentHash(got.buf)) !== lastLine.h) throw new ChangedError('the video on the site is different now');
        }
        this.passed(key);
      };
      if (lazy && (init || last)) {
        const job = check();
        job.catch(() => undefined);
        this.proofs.set(t, job);
      } else await check();
    }
    // Continued from another playlist (renewed, or renumbered): the sequence goes on in its numbering.
    if (segs[0].seq !== t.seq0) {
      t.seq0 = segs[0].seq;
      this.table?.retarget(k, headOf(pl, head?.init ?? '', t, this.state));
    }
    return start;
  }

  /**
   * Where a track continues, from the table's last line below its saved count (review of Phase 6). A crash or a
   * disk error could save the place of the next segment (nextSeq, lastDur) with the count before it, and the time
   * mapping then found no place in a playlist whose segments differ in length: File changed for ever. The line
   * says where the last written segment came from. Lines also lag the count (a line reaches the journal on the
   * engine's next tick, the count once the segment is on disk): segments the count claims beyond the last line
   * are not known to be right, so the track is cut back to that line and fetches them again (4.2: claims above
   * the last hashed block are rewound). A table begun after its first segments (a row from before Phase 6)
   * is taken as it is.
   */
  private fromLastLine(k: number, t: StreamTrack, lines: SegLine[]): void {
    const last = lines[lines.length - 1];
    if (!last) return;
    const whole = lines[0].i === 0 && last.i === lines.length - 1;
    if (last.i < t.done - 1 && whole && last.off + last.len > t.initBytes) {
      Object.assign(t, { done: last.i + 1, bytes: last.off + last.len, secs: lines.reduce((n, l) => n + l.d, 0) });
      this.table?.cut(k, t.done);
    }
    if (last.i === t.done - 1) Object.assign(t, { nextSeq: last.seq + 1, lastDur: last.d, lastHash: last.h });
  }

  /**
   * A resume's check of a track's saved part against the table (RESUME-DESIGN.md 4.2, 4.3). A part that is
   * gone starts the track again ("Started over: the saved part was moved or deleted"); one shorter than
   * recorded is cut at the end of its last good segment (4.3: before Phase 6 the track started again from
   * zero). Then every segment when the part was modified after its writer closed while nothing ran
   * (another program changed it) or after an unclean session (`deep`), else the last SPOT_LAST and
   * SPOT_SEEDED placed by the download's id: returns the lines whose bytes no longer hash to them.
   */
  private async inspect(k: number, t: StreamTrack, part: string, lines: SegLine[]): Promise<SegLine[]> {
    let st: { size: number; mtime: number } | null = null;
    try {
      const s = await IOUtils.stat(part);
      st = { size: Number(s.size), mtime: Number(s.lastModified) };
    } catch {
      st = null;
    }
    if (!st) {
      this.events.push('Started over: the saved part was moved or deleted');
      this.restartTrack(k, t);
      return [];
    }
    if (st.size < t.bytes) {
      const fits = lines.filter((l) => l.off + l.len <= st.size).reverse().slice(0, CUT_TRIES);
      let back: SegLine | null = null;
      for (const l of fits) {
        if (await this.intact(part, l)) {
          back = l;
          break;
        }
      }
      if (!back || back.off < t.initBytes) {
        this.events.push('Started over: the saved part was cut short');
        this.restartTrack(k, t);
        return [];
      }
      const keep = lines.filter((l) => l.i <= back.i);
      Object.assign(t, { done: back.i + 1, bytes: back.off + back.len, secs: keep.reduce((n, l) => n + l.d, 0), nextSeq: back.seq + 1, lastDur: back.d, lastHash: back.h });
      this.table?.cut(k, t.done);
      setSize(part, t.bytes);
      this.events.push(`The saved part was cut short: it continues after ${clock(t.secs)}`);
      lines = keep;
    }
    const changed = !!t.sealedAt && st.mtime > t.sealedAt + MTIME_SLACK;
    let pick = lines;
    if (!this.deep && !changed) {
      const want = new Set<number>(lines.slice(-SPOT_LAST).map((l) => l.i));
      let h = fnv(`${this.env.seed ?? ''}|${k}`);
      for (let n = 0; n < SPOT_SEEDED && lines.length; n++) {
        want.add(lines[h % lines.length].i);
        h = Math.imul(h ^ 0x9e3779b9, 0x01000193) >>> 0;
      }
      pick = lines.filter((l) => want.has(l.i));
    }
    const bad: SegLine[] = [];
    for (const l of pick) if (!(await this.intact(part, l))) bad.push(l);
    return bad;
  }

  /** A written segment's bytes in the part still hash to its line. */
  private async intact(part: string, l: SegLine): Promise<boolean> {
    const b = await readAt(part, l.off, l.len);
    return !!b && b.length === l.len && (await segmentHash(b)) === l.h;
  }

  /** A track starts again from its first segment (its part is gone or nothing of it holds). */
  private restartTrack(k: number, t: StreamTrack): void {
    Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0, nextSeq: undefined, lastDur: undefined, lastHash: undefined, initHash: undefined });
    this.table?.cut(k, 0);
  }

  private async prepareHls(signal: AbortSignal): Promise<void> {
    const s = this.state;
    if (!s.resolved || s.renew) {
      // renew (the pill's Continue: renewWith()): the same tracks at fresh addresses, their progress kept.
      const again = s.resolved && !!s.renew;
      // A renewal with the row's fingerprint re-picks its rung from the page's master, rather than trust the
      // page's option (its label and variant; review of Phase 6); the option's variant stays for Start over.
      let first = again && fingerprinted(s.rung, s.audioOnly) ? s.sourceUrl : s.variantUrl || s.sourceUrl;
      let text: string;
      // The picker's rendition whose signed address expired before it started (a Start over later, a queue):
      // the master it came from is read and the same rung picked (G2 step 2), as for a renewal.
      let byRung = again;
      let refusal: unknown = null;
      try {
        text = await this.text(first, signal, again);
      } catch (err) {
        if (!renewable(err) || !s.variantUrl || s.variantUrl === s.sourceUrl || signal.aborted) throw err;
        first = s.sourceUrl;
        text = await this.text(first, signal, true);
        if (!isMaster(text)) throw err;
        byRung = true;
        refusal = err;
        s.audioUrl = '';
      }
      let main = first;
      let audio = s.audioUrl;
      if (isMaster(text)) {
        const master = parseMaster(text, first);
        if (master.drm) throw new DownloadError(DRM_MESSAGE);
        if (byRung) ({ main, audio } = this.pickAgain(master, s.tracks[0]?.url || s.variantUrl, refusal));
        else {
          const rungs = ladder(master);
          const pick = s.audioOnly ? rungs.find((v) => v.audioOnly) : (rungs.find((v) => !v.audioOnly) ?? rungs[0]);
          const rendition = pick ? audioFor(master, pick) : (master.renditions.find((r) => r.type === 'AUDIO' && r.url) ?? null);
          if (s.audioOnly && !pick && rendition) {
            main = rendition.url;
            // Review of Phase 6: the rendition's fingerprint, so a master read again finds it.
            s.rung ??= renditionRung(rendition);
          } else if (pick) {
            main = pick.url;
            s.bandwidth = pick.bandwidth;
            if (!s.audioOnly && rendition && !audio) audio = rendition.url;
            // RESUME-DESIGN.md 5.3: the rung picked here, so a master read again picks it again.
            s.rung ??= rungOf(pick, rendition);
          } else throw new DownloadError('This stream has nothing Deer can save.');
        }
      }
      if (again) this.retrack(main, audio);
      else {
        s.tracks = [newTrack('main', main)];
        if (audio && audio !== main) s.tracks.push(newTrack('audio', audio));
      }
      s.resolved = true;
      s.renew = false;
    }
    for (const t of s.tracks) this.playlists.set(t.url, parseMedia(await this.text(t.url, signal), t.url));
  }

  /**
   * The same rung in a master playlist read again (G2 step 2; table.ts repick()): its variant and that
   * variant's audio, or the audio rendition an audio-only download was made of (review of Phase 6: those could
   * never renew). A rung the master no longer offers is ChangedError ("this quality is no longer offered");
   * with nothing to look for (an older row without a fingerprint) nothing was found: `refusal` (the step found
   * no address, never File changed). A stream whose sound is a track of its own keeps its language and name:
   * gone, the sound would be another (ChangedError; review of Phase 6).
   */
  private pickAgain(master: MasterPlaylist, oldUrl: string, refusal: unknown = null): { main: string; audio: string } {
    const s = this.state;
    const strict = s.tracks.some((t) => t.kind === 'audio');
    const got = repick(master, s.rung, s.audioOnly, oldUrl, strict);
    if (got.rendition) {
      s.rung ??= renditionRung(got.rendition);
      return { main: got.rendition.url, audio: '' };
    }
    if (!got.variant) {
      if (fingerprinted(s.rung, s.audioOnly)) throw new ChangedError('this quality is no longer offered');
      throw refusal ?? new NotAPlaylistError();
    }
    if (strict && !got.audio) {
      const lang = s.rung?.audioName || s.rung?.audioLang;
      throw new ChangedError(lang ? `its sound (${lang}) is no longer offered` : 'its sound is no longer offered separately');
    }
    s.bandwidth = got.variant.bandwidth;
    s.rung ??= rungOf(got.variant, got.audio);
    return { main: got.variant.url, audio: !s.audioOnly && got.audio ? got.audio.url : '' };
  }

  /** The tracks take new addresses, keeping what they wrote (the proof decides: prepare()); another shape is another stream. */
  private retrack(main: string, audio: string): void {
    const s = this.state;
    const [m, a] = s.tracks;
    if (!m) {
      s.tracks = [newTrack('main', main)];
      if (audio && audio !== main) s.tracks.push(newTrack('audio', audio));
      return;
    }
    if (!!a !== !!(audio && audio !== main)) throw new ChangedError(a ? 'its sound is no longer offered separately' : 'it now comes with separate sound');
    m.url = main;
    if (a) a.url = audio;
    if (s.variantUrl) s.variantUrl = main;
    if (s.audioUrl || a) s.audioUrl = audio;
  }

  private async prepareDash(signal: AbortSignal, fresh = false): Promise<void> {
    const s = this.state;
    const text = await this.text(s.sourceUrl, signal, fresh || !!s.renew);
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
      s.tracks = [{ ...newTrack('main', s.sourceUrl + REP + encodeURIComponent(main.id)), rung: repRung(main) }];
      if (!s.audioOnly && audio && video) s.tracks.push({ ...newTrack('audio', s.sourceUrl + REP + encodeURIComponent(audio.id)), rung: repRung(audio) });
      s.resolved = true;
    }
    for (const t of s.tracks) {
      const kind = t.kind === 'audio' || s.audioOnly ? 'audio' : 'video';
      // The pill's Continue names the representations the page offers now (renewWith()).
      const wanted = s.renew ? (kind === 'video' ? s.dashVideo : s.dashAudio) || '' : '';
      const id = wanted || repIdOf(t.url);
      // RESUME-DESIGN.md G2 step 2: the representation by its id, then by its attributes (renamed ids).
      const rep = matchRep(mpd, id, wanted ? undefined : t.rung, kind);
      if (!rep) throw new ChangedError('the stream no longer offers this quality');
      t.url = s.sourceUrl + REP + encodeURIComponent(rep.id);
      t.rung = repRung(rep);
      if (kind === 'video') s.dashVideo = rep.id;
      else s.dashAudio = rep.id;
      this.playlists.set(t.url, rep.playlist ?? (await this.onePieceList(rep, mpd.duration, signal)));
    }
    s.renew = false;
  }

  /** A representation that is one file (SegmentBase): its byte ranges as segments. */
  private async onePieceList(rep: DashRep, duration: number, signal: AbortSignal): Promise<MediaPlaylist> {
    const res = await open(rep.file, this.env.identity, { Range: 'bytes=0-0' }, signal);
    res.destroy();
    if (res.status !== 206 && res.status !== 200) throw new HttpStatusError(res.status, retryAfter(res));
    // RESUME-DESIGN.md 7 Phase 6: its pieces carry If-Range with this answer's validator.
    const v = validatorsOf(res);
    if (v.etag || v.lm) {
      this.tags.set(rep.file, v);
      for (const x of [v.etag, v.lm]) if (x) this.verified.add(`${rep.file}\n${x}`);
    }
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

  // ---- renewing (RESUME-DESIGN.md G2) ----

  /**
   * The automatic steps after the same media playlist (G2): 2, the master playlist or manifest read again,
   * the same rung picked by its fingerprint; 3, yt-dlp's manifest for the same rung, when it is installed;
   * 4, the streams of the page opened out of sight (Phase 7, StreamEnv.pageStreams). True once the tracks have
   * addresses whose playlists were read; the proof (prepare()) then decides whether they are the same stream
   * (step 4 proves each of its streams itself). A master that no longer offers the rung is ChangedError.
   */
  private async renewSteps(signal: AbortSignal, readable = false): Promise<boolean> {
    const s = this.state;
    // A stream without its tracks yet (a first start) has nothing to renew: no step could use what it found, so
    // yt-dlp is not asked for nothing (review of Phase 6).
    if (!s.resolved || !s.tracks.length) return false;
    this.renewTried = true;
    // What the tracks are asked at now: their playlists' addresses and their segments' and keys'.
    const at = (): string => s.tracks.map((t) => `${t.url} ${(this.playlists.get(t.url)?.segments ?? []).map((x) => `${x.url} ${x.key?.url ?? ''}`).join(' ')}`).join(' | ');
    const before = at();
    // A step helps when the addresses changed; `readable` (the playlists themselves failed): when they read now.
    const tried = async (fn: () => Promise<boolean>): Promise<boolean> => {
      try {
        return (await fn()) && (readable || at() !== before);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (err instanceof ChangedError || err instanceof DownloadError) {
          if (err instanceof ChangedError || err.message === DRM_MESSAGE || err.message === LIVE_MESSAGE) throw err;
        }
        return false;
      }
    };
    if (await tried(() => this.fromSource(s.sourceUrl, signal))) {
      if (at() !== before) this.events.push('New link found');
      return true;
    }
    const found = this.env.ytdlpManifest ? await this.env.ytdlpManifest(s.rung ?? s.tracks[0]?.rung, s.audioOnly, signal).catch(() => null) : null;
    if (signal.aborted) throw new AbortedError();
    if (found && found.format === (s.format ?? 'hls') && found.url !== s.sourceUrl) {
      const before = s.sourceUrl;
      s.sourceUrl = found.url;
      if (await tried(() => this.fromSource(found.url, signal))) {
        this.events.push('New link found through yt-dlp');
        return true;
      }
      s.sourceUrl = before;
    }
    // Step 4 (Phase 7): the page opened out of sight. Each of its streams is read AND proven here, in turn
    // (review of Phase 7: the first one, when it was another stream, ended the attempt as File changed before
    // the stream's own one further down the list was tried): the first that proves SAME is the renewal (prepare()
    // then finds it proven: no segment asked twice); one that is another stream (ChangedError) or can't be read
    // gives the tracks their addresses back and the next is tried. Only when none proved SAME does the first
    // ChangedError decide (File changed). Never a silent start over from a page's stream.
    const own = [s.sourceUrl, s.variantUrl, ...s.tracks.map((t) => t.url)].filter((u) => /^https?:\/\//i.test(u));
    const page = this.env.pageStreams ? await this.env.pageStreams(s.format ?? 'hls', s.duration, own, signal).catch(() => [] as string[]) : [];
    if (signal.aborted) throw new AbortedError();
    let changed: ChangedError | null = null;
    const silent = this.silentRestarts;
    this.silentRestarts = false;
    try {
      for (const url of page) {
        if (url === s.sourceUrl) continue;
        const back = this.keepAddresses();
        try {
          s.sourceUrl = url;
          if (!(await this.fromSource(url, signal))) throw new NotAPlaylistError();
          await this.settle(signal, this.proveWith.partBase, false, this.proveWith.renewing);
          this.events.push('New link found on its page');
          return true;
        } catch (err) {
          if (signal.aborted) throw new AbortedError();
          back();
          if (err instanceof ChangedError) changed ??= err;
        }
      }
    } finally {
      this.silentRestarts = silent;
    }
    if (changed) throw changed;
    return false;
  }

  /**
   * Where the stream is asked and what the proof of a renewal set on it, for putting back (step 4 above): the
   * addresses, the rung and each track's place in the playlist read. What the checks of the saved parts did (a
   * part cut back, segments written back) is the parts' truth and stays.
   */
  private keepAddresses(): () => void {
    const s = this.state;
    const top = { sourceUrl: s.sourceUrl, variantUrl: s.variantUrl, audioUrl: s.audioUrl, dashVideo: s.dashVideo, dashAudio: s.dashAudio, bandwidth: s.bandwidth, rung: s.rung, duration: s.duration, renew: s.renew };
    const tracks = s.tracks.map((t) => ({ t, was: { url: t.url, rung: t.rung, seq0: t.seq0, nextSeq: t.nextSeq, count: t.count, length: t.length, pathShape: t.pathShape, keyUrls: t.keyUrls } }));
    return () => {
      Object.assign(s, top);
      for (const { t, was } of tracks) Object.assign(t, was);
    };
  }

  /**
   * G2 step 2 from `url` (the stream's source, or yt-dlp's manifest): read fresh; a master playlist re-picks
   * the rung (table.ts repick()); a manifest matches the representations by id, then attributes. The tracks
   * take the new addresses (their progress kept) and their media playlists are read. False when it can't be
   * done (the stream has no tracks yet; a media playlist as the source of a stream with separate sound).
   */
  private async fromSource(url: string, signal: AbortSignal): Promise<boolean> {
    const s = this.state;
    if (!s.resolved || !s.tracks.length) return false;
    if (s.format === 'dash') {
      await this.prepareDash(signal, true);
      return true;
    }
    const text = await this.text(url, signal, true);
    if (!isMaster(text)) {
      // The source is itself the media playlist: a fresh read that works is the renewal.
      if (s.tracks.length !== 1) return false;
      s.tracks[0].url = url;
      this.playlists.set(url, parseMedia(text, url));
      return true;
    }
    const master = parseMaster(text, url);
    if (master.drm) throw new DownloadError(DRM_MESSAGE);
    const { main, audio } = this.pickAgain(master, s.variantUrl || s.tracks[0].url);
    const lists = new Map<string, MediaPlaylist>();
    for (const u of [main, audio].filter(Boolean)) lists.set(u, parseMedia(await this.text(u, signal, true), u));
    this.retrack(main, audio);
    for (const [u, pl] of lists) this.playlists.set(u, pl);
    return true;
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
    for (const [k, t] of this.state.tracks.entries()) {
      this.inflight = 0;
      await this.runTrack(t, k, trackPart(partBase, t), signal);
    }
    this.inflight = 0;
  }

  /**
   * Turn the track files into the finished file. `place(ext, suffix)` returns a free path for the
   * download's name with that extension. Returns the main file's path. Without ffmpeg, or when it
   * fails, the tracks are kept as they are and `note` says so. `before(out)` runs once the merge's
   * output path is chosen and before ffmpeg starts (the engine saves the merge's phase: RESUME-DESIGN.md G4);
   * `before(null)` once ffmpeg failed, before the tracks are moved as they are: from then on the output
   * path is no proof of a finished merge (review of Phase 4: the engine's mergeLeft() reads a merge whose
   * output is there as finished). Phase 6 (4.2): what ffmpeg said is kept (`merged.said`, and the console),
   * and an output whose length differs from the stream's by more than 2% or 2 s says so in `note`.
   */
  async finish(partBase: string, place: (ext: string, suffix?: string) => string, signal: AbortSignal, onProgress: ((seconds: number) => void) | null = null, before: ((out: string | null) => Promise<void>) | null = null): Promise<string> {
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
      if (before) await before(out);
      try {
        let secs = -1;
        const said = await runFfmpeg(ff, args, signal, (x) => {
          secs = x;
          onProgress?.(x);
        });
        this.merged = { secs, said: said.trim() };
        if (this.merged.said) console.warn('Deer downloads: ffmpeg reported while joining', this.merged.said.slice(-600));
        await IOUtils.move(tmp, out);
        await IOUtils.remove(mainPart, { ignoreAbsent: true });
        if (audioPart) await IOUtils.remove(audioPart, { ignoreAbsent: true });
        this.lengthCheck(secs, Math.max(...this.state.tracks.map((t) => t.length || 0)));
        return out;
      } catch (err) {
        await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => undefined);
        if (signal.aborted) throw new AbortedError();
        if (before) await before(null);
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

  /** The merged output's length against the stream's (RESUME-DESIGN.md 4.2: within 2% or 2 s); `note` says when it is not. */
  private lengthCheck(secs: number, want: number): void {
    if (!(secs >= 0) || !(want > 0)) return;
    if (Math.abs(secs - want) <= Math.max(LENGTH_SLACK, LENGTH_SHARE * want)) return;
    console.warn('Deer downloads: the joined video is', secs, 's long; the stream is', want, 's');
    this.note ||= `The saved video is ${clock(secs)} long; the stream is ${clock(want)}.`;
  }

  /**
   * Keep partial file for a stream (RESUME-DESIGN.md 3 G3, the owner's decision 3): the written segments of
   * each track that has some, joined with ffmpeg and cut to the shorter of them, as `target` with the
   * extension the container calls for. Without ffmpeg, or when it fails, each track's written segments as they
   * are: the main one as `target`, a sound track beside it as "<stem> (audio)" (review of Phase 6: the saved
   * sound was deleted), as finish() keeps them. Resolves with the main file made and its seconds; the track
   * parts left are the caller's.
   */
  async keepPartial(partBase: string, target: string, signal: AbortSignal): Promise<{ path: string; secs: number }> {
    const muxer = await this.env.ffmpeg();
    const tracks = this.state.tracks.filter((t) => t.done > 0 && t.bytes > 0);
    if (!tracks.length) throw new DownloadError('Nothing of this video is saved yet.');
    for (const t of tracks) {
      const part = trackPart(partBase, t);
      if ((await sizeOf(part)) > t.bytes) setSize(part, t.bytes);
    }
    const secs = Math.min(...tracks.map((t) => t.secs));
    const stem = target.replace(/\.[^.\\/]+$/, '');
    const webm = tracks.every((t) => t.container === 'webm');
    const audioOnly = this.state.audioOnly || tracks.every((t) => t.kind === 'audio');
    if (muxer.path) {
      const out = `${stem}${webm ? (audioOnly ? '.weba' : '.webm') : audioOnly ? '.m4a' : '.mp4'}`;
      const tmp = `${partBase}.keep.part`;
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      for (const t of tracks) args.push('-i', trackPart(partBase, t));
      if (tracks.length > 1) args.push('-map', '0:v:0?', '-map', '1:a:0?');
      else args.push('-map', '0:v?', '-map', '0:a?');
      args.push('-t', secs.toFixed(3), '-c', 'copy');
      if (!webm) args.push('-movflags', '+faststart');
      args.push('-f', webm ? 'webm' : 'mp4', tmp);
      try {
        let got = -1;
        await runFfmpeg(muxer.path, args, signal, (x) => {
          got = x;
        });
        await IOUtils.move(tmp, out);
        return { path: out, secs: got > 0 ? Math.min(got, secs) : secs };
      } catch (err) {
        await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => undefined);
        if (signal.aborted) throw new AbortedError();
        console.warn('Deer downloads: ffmpeg could not join the partial video', String(err));
      }
    }
    const [main, sound] = tracks;
    const out = `${stem}${extension(main.container, audioOnly)}`;
    await IOUtils.move(trackPart(partBase, main), out);
    if (sound) {
      const ext = extension(sound.container, true);
      let to = `${stem} (audio)${ext}`;
      for (let n = 2; existsSync(to); n++) to = `${stem} (audio) (${n})${ext}`;
      await IOUtils.move(trackPart(partBase, sound), to);
    }
    return { path: out, secs: main.secs };
  }

  /**
   * Fetch a track's segments on parallel connections and write them in order. Segments that arrive
   * early wait in memory (up to 48 MB) and then on disk, so a slow one never stalls the others; when
   * the connections are idle and the next segment to write is overdue, a second request races it.
   * Phase 6: it continues at the place the proof mapped (prepare(): never by position), and every segment
   * written leaves its line in the segment table (RESUME-DESIGN.md 4.1).
   */
  private async runTrack(track: StreamTrack, k: number, partPath: string, signal: AbortSignal): Promise<void> {
    const pl = this.playlists.get(track.url);
    if (!pl) throw new DownloadError(PLAYLIST_MESSAGE);
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
    // Keyed by the index in `segs`; `head` is the index of the next segment to write.
    const ready = new Map<number, Piece>();
    const started = new Map<number, number>();
    const hedged = new Set<number>();
    const racers = new Map<number, AbortController[]>();
    const spill = `${partPath}.d`;
    let spillMade = false;
    let held = 0;
    let avgMs = 0;
    let failure: unknown = null;
    let head = Math.max(0, Math.min(segs.length, this.starts.get(track) ?? track.done));
    let next = head;
    const conns = Math.max(1, Math.min(16, this.env.connections()));
    const ahead = Math.max(24, conns * 4);
    // While the proof of what the track wrote runs beside it (lazyProof), only the next segment is fetched: a
    // stream found changed costs one segment, not a window of them (review of Phase 6).
    let proof = this.proofs.get(track);
    let proving = !!proof;
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
        const piece = await this.fetchPiece(segs[i], track, ac.signal, { mayYield, lane: conn.lane });
        conn.accepted = true;
        if (ready.has(i) || i < head) {
          this.inflight -= piece.net;
          return;
        }
        for (const other of racers.get(i) ?? []) if (other !== ac) other.abort();
        avgMs = avgMs ? avgMs * 0.8 + (Date.now() - t0) * 0.2 : Date.now() - t0;
        if (i !== head && held + piece.buf.length > SPILL_AFTER) {
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
        if (stop.signal.aborted || ac.signal.aborted || hedge || ready.has(i) || i < head) return;
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
      while (failure === null && !stop.signal.aborted && head < segs.length) {
        const again = requeue.shift();
        if (again !== undefined) {
          if ((await take(again, false, conn)) === 'retire') return;
          continue;
        }
        if (next < segs.length && next < head + (proving ? 1 : ahead)) {
          if ((await take(next++, false, conn)) === 'retire') return;
          continue;
        }
        const first = head;
        const since = started.get(first);
        if (since !== undefined && !ready.has(first) && !hedged.has(first) && Date.now() - since > Math.max(3000, avgMs * 2)) {
          hedged.add(first);
          await take(first, true, conn);
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

    // Resume: the part file is the truth (prepare() already checked it against the table and cut it to its
    // last good segment when that could be done). Longer than recorded: cut back. Shorter: start again.
    const size = await sizeOf(partPath);
    if (track.done === 0 || size < track.bytes) {
      Object.assign(track, { done: 0, bytes: 0, initBytes: 0, secs: 0, lastDur: undefined, lastHash: undefined, initHash: undefined });
      // Nothing written is left to prove.
      this.proofs.delete(track);
      proof = undefined;
      proving = false;
      head = next = 0;
      setSize(partPath, 0, { truncate: true });
      // RESUME-DESIGN.md 5.7: the track's lines start again under a new header.
      track.seq0 = segs[0]?.seq ?? 0;
      this.table?.begin(k, headOf(pl, '', track, this.state));
    } else if (size > track.bytes) {
      setSize(partPath, track.bytes);
    }
    track.nextSeq = segs[head]?.seq ?? (segs.length ? segs[segs.length - 1].seq + 1 : 0);
    this.offsets.set(track, head - track.done);
    const writer = new Writer(partPath, -1);
    const marks: Mark[] = [];
    const mark = (): void => {
      marks.push({ done: track.done, bytes: track.bytes, secs: track.secs, initBytes: track.initBytes, container: track.container, at: writer.written, nextSeq: track.nextSeq, lastDur: track.lastDur });
      // Marks older than what is certainly on disk are never needed again.
      const durable = writer.durable;
      while (marks.length > 2 && marks[1].at <= durable) marks.shift();
    };
    mark();
    this.writers.set(track, { writer, marks });
    /** A table line for the segment just written (4.1): hashed off the main thread, recorded when the hash is ready. */
    const record = (buf: Uint8Array, line: Omit<SegLine, 'h'>): void => {
      const job = segmentHash(buf).then(
        (h) => {
          this.table?.add(k, { ...line, h });
          if (track.done === line.i + 1) track.lastHash = h;
        },
        () => undefined
      );
      this.hashing.add(job);
      void job.then(() => this.hashing.delete(job));
    };
    try {
      try {
        if (track.done === 0 && pl.init) {
          // Marked as the init: refused, it is looked up again as the init, never as segment 0 (review of Phase 6).
          const init = await this.fetchPiece({ url: pl.init.url, seq: 0, key: pl.init.key, range: pl.init.range, duration: 0, init: true }, track, stop.signal);
          const h = await segmentHash(init.buf);
          // A repair (4.3): the init segment must be the one the finished file was made of.
          if (this.expect && this.expect.head(k)?.init && this.expect.head(k)?.init !== h) throw new ChangedError('the video on the site is different now');
          writer.writeBytes(init.buf);
          this.inflight -= init.net;
          track.bytes = track.initBytes = init.buf.length;
          track.container = sniff(init.buf) === 'webm' ? 'webm' : 'mp4';
          track.initHash = h;
          this.table?.setInit(k, h);
          mark();
        }
        const workers = Array.from({ length: conns }, (_, i) => worker(i));
        // The proof of what this track wrote, running beside the download (lazyProof; review of Phase 6): the
        // workers fetch meanwhile, nothing is written before it passes, and a failure stops the run.
        if (proof) {
          try {
            await proof;
          } finally {
            proving = false;
            this.proofs.delete(track);
            notify();
          }
        }
        while (head < segs.length) {
          while (!ready.has(head) && failure === null && !stop.signal.aborted && alive > 0) await wait(1000);
          if (signal.aborted) throw new AbortedError();
          if (failure !== null) throw failure;
          if (stop.signal.aborted) throw new AbortedError();
          if (!ready.has(head)) throw new DownloadError('Some parts of the video didn’t arrive.');
          const piece = ready.get(head) as Piece;
          const buf = piece.buf ?? (await IOUtils.read(piece.file));
          ready.delete(head);
          if (piece.buf) held -= piece.buf.length;
          else IOUtils.remove(piece.file, { ignoreAbsent: true }).catch(() => undefined);
          const seg = segs[head];
          if (this.expect) {
            // A repair (4.3): every segment is checked against the old table before it is written.
            const want = this.expect.entry(k, track.done);
            if (!want || want.h !== (await segmentHash(buf))) throw new ChangedError('the video on the site is different now');
          }
          if (!track.container) track.container = sniff(buf);
          const off = track.bytes;
          writer.writeBytes(buf);
          this.early.bytes -= buf.length;
          this.early.secs -= seg.duration;
          track.bytes += buf.length;
          track.secs += seg.duration;
          track.done++;
          head++;
          track.nextSeq = segs[head]?.seq ?? seg.seq + 1;
          track.lastDur = seg.duration;
          this.inflight -= piece.net;
          mark();
          record(buf, { i: track.done - 1, seq: seg.seq, off, len: buf.length, d: seg.duration });
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
      let closed: unknown = null;
      try {
        await writer.close();
      } catch (err) {
        closed = err;
        const durable = writer.durable;
        const m = [...marks].reverse().find((x) => x.at <= durable) ?? marks[0];
        Object.assign(track, atMark(m), m.done === track.done ? {} : { lastHash: undefined });
      }
      this.writers.delete(track);
      // The table lines of what was written reach the journal, flushed (a stop: 4.1).
      await Promise.all([...this.hashing]);
      this.table?.cut(k, track.done);
      track.sealedAt = Date.now();
      await this.table?.flush(true).catch(() => undefined);
      if (closed) throw closed;
    }
  }

  /**
   * One segment: fetched with backoff, decrypted, unwrapped. Inside a run (`refresh`), a refused (expired)
   * address, an answer that is not media, or a refused key is looked up again in a fresh copy of its playlist
   * (G2 step 1; refreshed()), taken only when it is the same stream (ChangedError when its bytes are not); the
   * init segment is looked up again as the init. A connection the server turns away steps aside when
   * `mayYield(attempt)` allows it. A piece of one file carries If-Range (fetchBytes()).
   */
  private async fetchPiece(seg: Fetchable, track: StreamTrack, signal: AbortSignal, opts: FetchOpts = {}): Promise<{ buf: Uint8Array; net: number }> {
    const { mayYield, lane = null, refresh = true, counts = true, ifRange = true } = opts;
    let current = seg;
    let refreshes = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await this.fetchBytes(current.url, current.range, signal, { counts, lane, ifRange, verify: (url) => this.proveFile(track, url, signal) });
        // RESUME-DESIGN.md G2 (Phase 1, extended in Phase 6): a segment that is a web page or JSON is never
        // written. A clear segment of a page type that starts like a page is one at once. An encrypted one
        // is judged only after decryption (review of Phase 1): about 1 ciphertext in 130 starts with '<' or
        // '{', and some CDNs label real segments text/html. A page fed to AES-CBC fails its padding (then it
        // is not the file, not "couldn't be decrypted"); one that decrypts is no media. After decryption, a
        // whole segment (or the first piece of a file) that starts with '<' or '{', or a page type whose
        // bytes are not media (sniff()), is not the file either.
        const pageType = /text\/html|xhtml|json/i.test(got.type);
        if (pageType && !current.key && textStart(got.buf)) throw this.notMedia(got);
        let buf = got.buf;
        if (current.key) {
          const key = await this.key(current.key, signal);
          try {
            buf = await decrypt(buf, key, current.key.iv ?? sequenceIv(current.seq));
          } catch (err) {
            if (pageType && textStart(got.buf)) throw this.notMedia(got);
            throw err;
          }
        }
        buf = unwrapDisguised(buf);
        if (((!current.range || current.range[0] === 0) && textStart(buf)) || (pageType && !looksLikeMedia(buf))) throw this.notMedia(got);
        return { buf, net: got.net };
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (refusedConnection(err) && mayYield?.(attempt)) throw new ConnectionRefusedError();
        if (refresh && renewable(err) && refreshes < ATTEMPTS) {
          // An expired address (or key): the same segment as a fresh playlist describes it. A new address
          // does not use up an attempt; a segment takes the fresh key address even when its own address did
          // not change (G2 step 1: a key failure uses the refresh too). A playlist that is another stream
          // stops the run (ChangedError); one that can't be read or taken leaves this answer to decide.
          refreshes++;
          const fresh = await this.refreshed(track, current, signal).catch((e: unknown) => {
            if (e instanceof ChangedError) throw e;
            return null;
          });
          if (fresh && (fresh.url !== current.url || (fresh.key?.url ?? '') !== (current.key?.url ?? ''))) {
            current = fresh;
            attempt--;
            continue;
          }
        }
        // The last connection: a server that asks for a long wait stops the run (net.ts serverStops()). A wait's
        // automatic try ends at its first 429 or 5xx, as the playlist fetch does (review).
        if (attempt >= ATTEMPTS || !isRetryable(err) || (stopsRun(err) && !mayYield?.(Infinity)) || (this.waitTry && stopsRun(err, true))) throw err;
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** A fetched answer that is not a segment: its bytes leave the in-flight count, nothing is written. */
  private notMedia(got: { net: number; type: string }): NotTheFileError {
    this.inflight -= got.net;
    return new NotTheFileError(got.type);
  }

  /**
   * One answer's bytes (`counts`: they are in flight while they arrive). `range`: a piece of one file, asked
   * with Range and, unless `ifRange` is false, If-Range carrying the validator the file first answered with
   * (Phase 6). A 200 under another validator decides nothing by itself (RESUME-DESIGN.md 2.4 R6; review of
   * Phase 6: CDN edges and farms whose backends differ turned working streams into File changed): `verify`
   * checks the bytes already written of that file (R4, proveFile(); ChangedError when they differ), then the
   * new validator is taken and the piece asked again. After SLIPS such answers within SLIP_WINDOW If-Range
   * carries Last-Modified, and once that slips too, nothing (ranged.ts etagUnstable).
   */
  private async fetchBytes(
    url: string,
    range: [number, number] | null,
    signal: AbortSignal,
    opts: { counts?: boolean; lane?: number | null; ifRange?: boolean; verify?: (url: string) => Promise<void> } = {}
  ): Promise<{ buf: Uint8Array; net: number; type: string }> {
    const { counts = true, lane = null, ifRange = true, verify } = opts;
    let res: Response;
    for (;;) {
      const tag = range && ifRange ? this.ifRangeOf(url) : '';
      res = await open(url, this.env.identity, range ? { Range: `bytes=${range[0]}-${range[1] - 1}`, ...(tag ? { 'If-Range': tag } : {}) } : {}, signal, { lane });
      if (res.status < 200 || res.status >= 300) {
        res.destroy();
        throw new HttpStatusError(res.status, retryAfter(res));
      }
      if (!range) break;
      const v = validatorsOf(res);
      const known = this.tags.get(url);
      if (!known) {
        // The first answer's validators are the file's as it is written.
        if (v.etag || v.lm) this.tags.set(url, v);
        for (const x of [v.etag, v.lm]) if (x) this.verified.add(`${url}\n${x}`);
        break;
      }
      // What the file is known by now (a request sent before the first answer carried none); a check's own
      // request (ifRange false) compares bytes itself.
      const current = ifRange ? this.ifRangeOf(url) : '';
      const lm = !!current && current === known.lm && current !== known.etag;
      const now = lm ? v.lm : v.etag;
      if (!current || !now || now === current) break;
      // Another validator: the whole file (an If-Range that did not hold), or a piece of it (none sent yet,
      // or ignored). The bytes decide (R4), then the piece is asked again. It counts as a slip only once the
      // bytes said it is the same file: counted before, the connections that all met a file swapped mid-run
      // (each with its own 200) took If-Range down to Last-Modified and then to nothing within one swap, and
      // the next answer of the new file was written unchecked.
      res.destroy();
      await this.vouch(url, now, verify);
      this.slipped(url, lm);
      this.tags.set(url, { etag: v.etag || known.etag, lm: v.lm || known.lm });
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
      return { buf, net, type: res.header('content-type') };
    } catch (err) {
      this.inflight -= net;
      throw err;
    } finally {
      this.live--;
    }
  }

  /** The If-Range validator for a piece of `url`: its ETag; Last-Modified once the ETag slipped SLIPS times; none once that slipped too. */
  private ifRangeOf(url: string): string {
    const v = this.tags.get(url);
    if (!v || this.noIfRange.has(url)) return '';
    const now = Date.now();
    const slips = (this.slips.get(url) ?? []).filter((t) => now - t < SLIP_WINDOW).length;
    return slips >= SLIPS ? v.lm : v.etag || v.lm;
  }

  /** An If-Range of `url` answered with the whole file under another validator (`lm`: it carried Last-Modified). */
  private slipped(url: string, lm: boolean): void {
    if (lm) {
      this.noIfRange.add(url);
      return;
    }
    const now = Date.now();
    const list = (this.slips.get(url) ?? []).filter((t) => now - t < SLIP_WINDOW);
    list.push(now);
    this.slips.set(url, list);
  }

  /** A validator `url` answered with is the same file's: proven once (the connections that met it wait for the same check). */
  private async vouch(url: string, now: string, verify?: (url: string) => Promise<void>): Promise<void> {
    const key = `${url}\n${now}`;
    if (this.verified.has(key) || !verify) return;
    let pending = this.verifying.get(key);
    if (!pending) {
      pending = verify(url).then(() => {
        this.verified.add(key);
      });
      this.verifying.set(key, pending);
      pending.then(
        () => this.verifying.delete(key),
        () => this.verifying.delete(key)
      );
    }
    await pending;
  }

  /**
   * R4 for a piece of one file whose If-Range was answered with 200 under another validator (RESUME-DESIGN.md
   * 2.4; review of Phase 6): the last written piece of that file, asked again without If-Range, decrypted and
   * unwrapped, hashes to its line, or the file on the site changed (ChangedError). Nothing of the file written
   * yet, or its line unknown: nothing to compare (the proof of a resume compares its own piece).
   */
  private async proveFile(track: StreamTrack, url: string, signal: AbortSignal): Promise<void> {
    await Promise.all([...this.hashing]);
    const k = this.state.tracks.indexOf(track);
    const line = k >= 0 && track.done > 0 ? this.lineOf(k, track.done - 1) : undefined;
    if (!line) return;
    const segs = this.playlists.get(track.url)?.segments ?? [];
    const off = this.offsets.get(track);
    const seg = off !== undefined ? segs[off + line.i] : segs.find((x) => x.seq === line.seq);
    if (!seg || seg.url !== url) return;
    const got = await this.fetchPiece(seg, track, signal, { refresh: false, counts: false, ifRange: false });
    if (got.buf.length !== line.len || (await segmentHash(got.buf)) !== line.h) throw new ChangedError('the video file on the site changed');
  }

  /** Track k's line for its written segment i: the table's, or the finished stream's (a repair's `expect`). */
  private lineOf(k: number, i: number): SegLine | undefined {
    return this.table?.entry(k, i) ?? this.expect?.entry(k, i);
  }

  /** The renewal steps can follow a refusal: the stream has its tracks and something written (text(): fewer tries first). */
  private mayRenew(): boolean {
    const s = this.state;
    return s.resolved && s.tracks.some((t) => t.done > 0);
  }

  /** A playlist or manifest, read once (or again, fresh). Not a playlist: NotTheFileError (G2: the renewal steps may find one). */
  private async text(url: string, signal: AbortSignal, fresh = false): Promise<string> {
    const hit = this.texts.get(url);
    if (hit && !fresh) return hit;
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await this.fetchBytes(url, null, signal, { counts: false });
        const text = new TextDecoder('utf-8').decode(got.buf);
        if (!isPlaylist(text) && !isMpd(text)) throw new NotAPlaylistError(got.type);
        this.texts.set(url, text);
        return text;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        // A refused playlist (403) is asked once more, then the renewal steps take over (G2), when they can: a
        // stream with nothing written keeps its three tries (review of Phase 6).
        if (attempt >= ATTEMPTS || !isRetryable(err) || stopsRun(err, this.waitTry) || (renewable(err) && attempt >= 2 && this.mayRenew())) throw err;
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
            const { buf } = await this.fetchBytes(ref.url, null, signal, { counts: false });
            if (buf.length !== 16) throw new DownloadError('The stream’s key couldn’t be read.');
            return crypto.subtle.importKey('raw', buf as Uint8Array<ArrayBuffer>, { name: 'AES-CBC' }, false, ['decrypt']);
          } catch (err) {
            if (signal.aborted) throw new AbortedError();
            if (attempt >= ATTEMPTS || !isRetryable(err) || (this.waitTry && stopsRun(err, true))) throw err;
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
   * The same segment as the playlist (or manifest) describes it now (G2 step 1): matched by media sequence,
   * never by position; the init segment as the init (review of Phase 6: a refused init was answered with media
   * segment 0, written as the init). The playlist is read again once for every connection that hit the expired
   * address (they wait for the same read), at most every 5 s, and taken only when it is the same stream
   * (reread()).
   */
  private async refreshed(track: StreamTrack, stale: Fetchable, signal: AbortSignal): Promise<Fetchable | null> {
    const lookup = (): Fetchable | null => {
      const pl = this.playlists.get(track.url);
      if (!pl) return null;
      if (stale.init) return pl.init ? { url: pl.init.url, seq: stale.seq, key: pl.init.key, range: pl.init.range, duration: 0, init: true } : null;
      return pl.segments.find((s) => s.seq === stale.seq) ?? null;
    };
    const changed = (s: Fetchable | null): boolean => !!s && (s.url !== stale.url || (s.key?.url ?? '') !== (stale.key?.url ?? ''));
    const known = lookup();
    if (changed(known)) return known;
    let pending = this.refreshing.get(track);
    if (!pending && Date.now() - (this.refreshedAt.get(track) ?? 0) > 5000) {
      this.refreshedAt.set(track, Date.now());
      pending = this.reread(track, signal);
      this.refreshing.set(track, pending);
      pending.then(
        () => this.refreshing.delete(track),
        () => this.refreshing.delete(track)
      );
    }
    if (pending) await pending;
    return lookup();
  }

  /**
   * G2 step 1 inside a run: the track's playlist read again (DASH: its representation in the manifest read
   * again), taken only when it is the same stream (RESUME-DESIGN.md 2.6; review of Phase 6: a renamed
   * representation, matched by its attributes and taken with no proof, mixed two encodes in one track):
   *   - the same numbering, count and durations as the playlist the run has;
   *   - a DASH representation by its id; one renamed (matched by its attributes) only for a track that wrote
   *     segments, which prove it: a track with none is left to the renewal outside the run, which reads it
   *     from its start;
   *   - once the track wrote segments and an address changed, its last written segment asked at the new
   *     address hashes to its line, else ChangedError (proveAgain()).
   * Not taken: the run's playlist stays, and the segment's own answer decides.
   */
  private async reread(track: StreamTrack, signal: AbortSignal): Promise<void> {
    const s = this.state;
    const k = s.tracks.indexOf(track);
    const old = this.playlists.get(track.url);
    if (k < 0 || !old) return;
    let url = track.url;
    let rep: DashRep | null = null;
    let pl: MediaPlaylist;
    if (s.format === 'dash') {
      const mpd = parseMpd(await this.text(s.sourceUrl, signal, true), s.sourceUrl);
      if (mpd.drm || mpd.live || mpd.periods > 1) return;
      const id = repIdOf(track.url);
      rep = matchRep(mpd, id, track.rung, track.kind === 'audio' || s.audioOnly ? 'audio' : 'video');
      if (!rep || (rep.id !== id && !track.done)) return;
      url = s.sourceUrl + REP + encodeURIComponent(rep.id);
      pl = rep.playlist ?? (await this.onePieceList(rep, mpd.duration, signal));
    } else pl = parseMedia(await this.text(track.url, signal, true), track.url);
    if (!sameShape(old, pl)) return;
    if (track.done > 0 && (url !== track.url || addressesOf(old) !== addressesOf(pl)) && !(await this.proveAgain(k, track, pl, signal))) return;
    if (rep && url !== track.url) {
      track.url = url;
      track.rung = repRung(rep);
      if (track.kind === 'audio' || s.audioOnly) s.dashAudio = rep.id;
      else s.dashVideo = rep.id;
      this.table?.retarget(k, headOf(pl, this.table.head(k)?.init ?? '', track, s));
    }
    this.playlists.set(url, pl);
  }

  /**
   * The last written segment of a running track, asked at a playlist read again (one of the same shape: its
   * place is the same), hashes to its line (2.6), else ChangedError. False when it can't be told (the place is
   * not known): the playlist is not taken. True with no line to compare (a record from before Phase 6).
   */
  private async proveAgain(k: number, track: StreamTrack, pl: MediaPlaylist, signal: AbortSignal): Promise<boolean> {
    await Promise.all([...this.hashing]);
    const line = this.lineOf(k, track.done - 1);
    if (!line) return true;
    const off = this.offsets.get(track);
    const seg = off !== undefined ? pl.segments[off + line.i] : undefined;
    if (!seg) return false;
    const got = await this.fetchPiece(seg, track, signal, { refresh: false, counts: false });
    if ((await segmentHash(got.buf)) !== line.h) throw new ChangedError('the video on the site is different now');
    return true;
  }
}

function newTrack(kind: StreamTrack['kind'], url: string): StreamTrack {
  return { kind, url, done: 0, bytes: 0, initBytes: 0, count: 0, secs: 0, length: 0, container: '' };
}

/** A track's table header (RESUME-DESIGN.md 5.7) for the playlist it is written from. */
function headOf(pl: MediaPlaylist, init: string, t: StreamTrack, s: StreamState): TrackHead {
  return { seq0: pl.segments[0]?.seq ?? 0, count: pl.segments.length, durHash: durHash(pl), init, keys: keysOf(pl), rung: (t.kind === 'main' && s.format !== 'dash' ? s.rung : t.rung) ?? null, t: Date.now() };
}

/** The validators If-Range can carry: a strong ETag ('' for a weak one) and Last-Modified. */
function validatorsOf(res: Response): Validators {
  const etag = res.header('etag');
  return { etag: etag && !/^W\//i.test(etag) ? etag : '', lm: res.header('last-modified') || '' };
}

/** A track's counts at a mark (snapshot(), a disk error), with the place it continues from. */
function atMark(m: Mark): Partial<StreamTrack> {
  return { done: m.done, bytes: m.bytes, secs: m.secs, initBytes: m.initBytes, container: m.container, nextSeq: m.nextSeq, lastDur: m.lastDur };
}

/** A DASH track's representation id (its url is the manifest with #vitre-rep=<id>). */
function repIdOf(url: string): string {
  return decodeURIComponent(url.slice(url.indexOf(REP) + REP.length));
}

/** Two playlists of the same stream as far as their outline tells: the same numbering, count and durations, an init or none. */
function sameShape(a: MediaPlaylist, b: MediaPlaylist): boolean {
  return a.segments.length === b.segments.length && a.segments[0]?.seq === b.segments[0]?.seq && durHash(a) === durHash(b) && !!a.init === !!b.init;
}

/** Every address a playlist gives (its init, its segments, their keys and ranges), one per line. */
function addressesOf(pl: MediaPlaylist): string {
  return [pl.init ? `${pl.init.url} ${pl.init.key?.url ?? ''} ${pl.init.range ?? ''}` : '', ...pl.segments.map((x) => `${x.seq} ${x.url} ${x.key?.url ?? ''} ${x.range ?? ''}`)].join('\n');
}

/** "4:05", "1:02:03". */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 32 bits of FNV-1a (the seeded spot checks, placed as ledger.ts places its blocks). */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
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

/** Every segment of every track is written (RESUME-DESIGN.md G2: such a resume goes straight to the merge). */
export function allWritten(s: StreamState | null | undefined): boolean {
  return !!s && s.resolved && s.tracks.length > 0 && s.tracks.every((t) => t.count > 0 && t.done >= t.count);
}

/** Seconds a stream's Keep partial file would keep: the shorter written track (3 G3), and the whole stream's. */
export function keptSecs(s: StreamState | null | undefined): { secs: number; of: number } {
  const tracks = (s?.tracks ?? []).filter((t) => t.done > 0 && t.bytes > 0);
  if (!tracks.length) return { secs: 0, of: 0 };
  return { secs: Math.min(...tracks.map((t) => t.secs)), of: Math.max(s?.duration ?? 0, ...tracks.map((t) => t.length || 0)) };
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

/** MP4 boxes a segment or an init segment starts with (RESUME-DESIGN.md G2 sniff). */
const MP4_BOXES = ['ftyp', 'styp', 'moof', 'sidx', 'emsg', 'prft', 'mdat'];

/** TS: the sync byte at 0 and, in a segment longer than one packet, at 188 (G2 sniff). */
function isTs(buf: Uint8Array): boolean {
  return buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47);
}

/** WebM: an EBML header, or a Cluster (a segment that continues one). */
function isWebm(buf: Uint8Array): boolean {
  return (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) || (buf[0] === 0x1f && buf[1] === 0x43 && buf[2] === 0xb6 && buf[3] === 0x75);
}

/** The container a segment's first bytes say (RESUME-DESIGN.md G2 sniff); TS when nothing else matches, as before. */
export function sniff(buf: Uint8Array): Container {
  if (isTs(buf)) return 'ts';
  if (MP4_BOXES.includes(boxType(buf, 0))) return 'mp4';
  if (isWebm(buf)) return 'webm';
  if (latin1(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0)) return 'aac';
  return 'ts';
}

function looksLikeSegment(buf: Uint8Array): boolean {
  return buf.length >= 8 && (buf[0] === 0x47 || ['ftyp', 'styp', 'moof'].includes(boxType(buf, 0)));
}

/**
 * Media a stream segment may be (RESUME-DESIGN.md G2): TS (sync byte at 0 and 188), MP4 boxes, WebM
 * (EBML or a Cluster), ADTS or MP3 audio, ID3.
 */
export function looksLikeMedia(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  if (isTs(buf)) return true;
  if ([...MP4_BOXES, 'free'].includes(boxType(buf, 0))) return true;
  if (isWebm(buf)) return true;
  return latin1(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
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
