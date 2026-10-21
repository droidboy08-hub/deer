// IDM-style multi-connection download of one file. Port of the verified prototype
// spikes/downloader/verify/engine/VitreRanged.sys.mjs (itself from app/src/main/modules/downloads/
// ranged.ts and RangedDownload.swift): same segment plan, work stealing, validators, retry rules and
// persisted state (FileState). On Gecko:
//   - requests are Necko channels (net.open), each connection on its own lane (net.ts header);
//   - bytes go channel -> pipe -> background file writer (partfile.Writer), never through JS;
//   - the speed limit and disk back-pressure suspend the channel;
//   - the checksum is IOUtils.computeHexDigest (md5 through nsICryptoHash), free space
//     nsIFile.diskSpaceAvailable.
// Recipe correction 6 applied: a disk error (DiskError) is never retried, reads as a disk problem,
// and the bytes that reached the file before it are kept (Writer.durable).
//
// Never lose or mix bytes (spikes/downloader/RESUME-DESIGN.md, Phase 1). `state` is the record the
// store saves (rec.file), so nothing here empties it on a guess:
//   - probe() decides whether the answer is still the file BEFORE it changes any state (proof.ts
//     judge()); a resume never forgets its segments and never probes twice;
//   - an answer that is not the file (a page, a refused address) is NotTheFileError or
//     AddressRefusedError; another version of the file is ChangedError. The download stops with its
//     .part and segments as they are, and the row asks (VitreDownloads stopped());
//   - headers alone (a 200 to If-Range, another ETag or Last-Modified) never decide while saved bytes
//     can be compared (R6): prove() compares windows with the .part, and the same bytes carry on under
//     the new validators, as a redeployed file did before Phase 1;
//   - only under ASK_ABOVE saved bytes does a changed file start again by itself, at most twice in
//     ten minutes (the owner's decision of 2026-10-13);
//   - the .part is emptied only when `allowFresh` says nothing in it is worth keeping (a first start,
//     Start over, such a silent restart), and never sized below the bytes its segments claim;
//   - a single-stream answer that would replace saved bytes is written to "<part>.new" and takes the
//     .part's place only once it is complete, as long as the saved size, and starts with the saved
//     bytes. A download whose length was never known continues by ranges only when If-Range or
//     prove() says it is the same file; otherwise it stays such a single stream.
//
// Same-file proof and renewal (RESUME-DESIGN.md Phase 2):
//   - a resume's probe asks bytes=0-65535: window 0 rides on it and is compared with the saved bytes
//     (2.5), so an unchanged resume makes no extra request, and a file swapped with no validators at
//     all (same size) is caught (R4);
//   - an address that refused or isn't the file, with saved bytes at stake, goes to the renewal hook
//     (TransferEnv.renew, renew.ts): a 403 keeps exactly one retry at the same address, and only while
//     its expiry time (expiry.ts) is unknown or ahead; an address whose time has passed is renewed
//     before a resume's first request. A new address proven to be the same file is adopted and every
//     connection carries on there, without using up a retry;
//   - an ETag that changes over the same bytes twice within ten minutes (another CDN edge on every
//     answer) is no longer trusted (etagUnstable, R6): If-Range carries Last-Modified or nothing, and
//     one window is compared every 256 MiB or 5 minutes instead. Review of Phase 2: Last-Modified gets
//     the same rule (dateUnstable), so a farm whose backends differ in both sends no If-Range at all
//     instead of ending as File changed, and a resume there compares the 3 or 4 windows;
//   - the windows of a proof always make one (proof.ts windows(), enough()): never window 0 alone while
//     other saved bytes were not compared (review of Phase 2: a file that changed after its first 64 KiB
//     completed mixed). A file of at most 64 KiB is probed one byte short, so a server that answers a
//     Range over a whole file with a 200 still ranges it.
//
// The block hash record (RESUME-DESIGN.md section 4, Phase 5; ledger.ts):
//   - plan() and claim() cut segments at multiples of the block size, so each block sits inside one
//     segment (4.1); older, unaligned segments still work;
//   - each writer.close() hashes what newly lies wholly under the certain bytes (Ledger.pump()); the run
//     drains the hashing before it verifies the file only when released blocks must hash to their old
//     values (or a checksum did not match), and otherwise the blocks still unhashed at the finish are
//     hashed from the finished file (review of Phase 5: the finish held fast downloads at 100%);
//   - a block released for fetching again must hash to its old value: otherwise the file on the site
//     changed, and the run stops with its claims on that block given back (G3; Ledger.mismatch);
//   - a disk error makes the block that holds the failed write suspect: the segment claims up to that
//     block's start only (4.2);
//   - a server checksum that does not match at the end (4.3) is no longer a whole download again: the
//     blocks are checked locally and the bad ones fetched again; when every block matches its record, the
//     network delivered wrong bytes, so the windows are proven and each block is compared with the server
//     and replaced where it differs (fromServer()). Only when that does not make it match does it fail as
//     before;
//   - with the record, the windows the proof compares are hashed block heads, against their recorded head
//     hashes (proof.ts Heads): local damage is never taken for another file;
//   - the completion check (2.5) stops a file only when the site's bytes differ; anything it can't
//     compare (a refused address, a page, no network) lets it complete as before (review of Phase 5);
//   - a silent restart and a checksum that did not match forget the block hashes with the bytes.
import { NetUtil } from 'resource://gre/modules/NetUtil.sys.mjs';
import { clearInterval, setInterval } from 'resource://gre/modules/Timer.sys.mjs';
import { expiredAt, expiresAt } from './expiry';
import { throttle, type RateLimiter } from './limiter';
import { nameFromDisposition } from './naming';
import {
  AbortedError, AddressRefusedError, ChangedError, ChecksumError, ConnectionRefusedError, DiskError, DownloadError, HttpStatusError, NetError, NotTheFileError,
  REFUSED_STATUS, Response, ShortBodyError, backoff, isRetryable, isRetryableStatus, open, parseContentRange, refusal, refusedConnection,
  retryAfter, serverStops, sleep, stopsRun, textStart, textual, type Identity,
} from './net';
import { blockSize, hashBytes, heldBytes, sha256Hex, sparsePart, type Ledger } from './ledger';
import { Writer, freeSpace, readAt, setSize, sizeOf, writeAt } from './partfile';
import {
  ASK_ABOVE, UNSURE, WINDOW, compareWindows, differs, digestOf, enough, fetchRange, headerChange, judge, notFile, readKind, sizeText, totalOf, validatorsDiffer,
  windows, type Kind, type ProofCtx,
} from './proof';
import type { RenewWhy, Renewed } from './renew';

export { ASK_ABOVE } from './proof';

/** Below this, connection setup costs more than parallel pieces return. */
const MIN_SPLIT = 8 * 1024 * 1024;
/** A running segment is only split when both halves would be at least this big. */
const MIN_STEAL = 1024 * 1024;
const ATTEMPTS = 3;
/** Suspend a channel when this much of it is waiting for the disk; resume below the low mark. */
const BACKLOG_HIGH = 8 * 1024 * 1024;
const BACKLOG_LOW = 2 * 1024 * 1024;
const STOP = { stop: true as const };
/** At most this many silent restarts within RESTART_WINDOW; after that the row asks too. */
const SILENT_RESTARTS = 2;
const RESTART_WINDOW = 10 * 60 * 1000;
/**
 * A guard against loops only: at most this many byte proofs per run, and as many answers taken with
 * nothing saved to compare. etagUnstable and dateUnstable are what keep an address whose validators
 * change on every answer from proving again and again (R6).
 */
const PROOF_GUARD = 8;
/** R6: a validator that did not hold over the same bytes twice within this long is no longer trusted. */
const UNSTABLE_WINDOW = 10 * 60 * 1000;
/** With etagUnstable or dateUnstable, one window is compared every this many bytes or this long (R6). */
const SPOT_BYTES = 256 * 1024 * 1024;
const SPOT_MS = 5 * 60 * 1000;
/** While streaming, the block hashing is looked at every this many bytes too (besides writer.close() and the tick). */
const HASH_EVERY = 4 * 1024 * 1024;
/**
 * Connections that keep up (compared with IDM 6.43 on a local bench, 2026-10-20: gecko/spikes/downloader/
 * IDM-BENCH.md). A connection that used up its attempts steps aside while another one received bytes within
 * MOVING_MS: its segment is free for the others and it tries again after STEP_ASIDE_MS, the run going on
 * meanwhile (it used to stop every connection and wait). tick() looks at every answer each TICK_MS:
 *   - stall: no bytes for STALL_TICKS ticks while another answer got some: cut (the idle timeout takes 30 s);
 *   - slow: below max(SLOW_FLOOR, SLOW_SHARE x the others' median) for SLOW_TICKS ticks while the others ran
 *     at BUSY_RATE or more, when what is left (RECUT_MIN or more) would take more than RECUT_SECS at its own
 *     speed and more than twice as long as at the median: cut (a fixed 4 MiB floor kept a crawler on a 3 MiB
 *     segment, which then decided when the whole download ended);
 * a cut answer is asked again at once on a new connection (no failure): a server edge or route that went
 * silent or slow is left for a new one. At most once per RECUT_GAP per connection. An answer Deer itself
 * held for more than HELD_SHARE of a tick (the disk, the speed limit) is never judged on that stretch, and
 * nothing is judged while a speed limit holds the speed down.
 * A connection cut after it brought PROGRESS_MIN bytes or ran PROGRESS_MS (a reset, an interrupted or short
 * body, the idle timeout) is asked again after PROGRESS_RETRY_MS, no failure: IDM retries at once (0.01 s,
 * measured) where Deer waited 2 s each time.
 */
const MOVING_MS = 10 * 1000;
const STEP_ASIDE_MS = [10, 20, 40, 60].map((s) => s * 1000);
const TICK_MS = 2000;
const STALL_TICKS = 5;
const SLOW_TICKS = 8;
const SLOW_SHARE = 0.25;
const SLOW_FLOOR = 8 * 1024;
const BUSY_RATE = 64 * 1024;
const RECUT_GAP = 60 * 1000;
const RECUT_MIN = 256 * 1024;
const RECUT_SECS = 8;
const HELD_SHARE = 0.5;
/** A lone answer (the others finished or between answers) is judged against the last busy median this long. */
const BUSY_MEMORY_MS = 30 * 1000;
const PROGRESS_MIN = 1024 * 1024;
const PROGRESS_MS = 5000;
const PROGRESS_RETRY_MS = 100;
/** Necko failures that mean the connection was cut (not refused): asked again at once after progress. */
const CUT_CODES = new Set(['NS_ERROR_NET_RESET', 'NS_ERROR_NET_INTERRUPT', 'NS_ERROR_NET_PARTIAL_TRANSFER', 'NS_ERROR_NET_TIMEOUT', 'NS_ERROR_NET_TIMEOUT_EXTERNAL']);

class RangeIgnoredError extends Error {}
/** A connection used up its attempts while others still receive: it steps aside (runRanged()). */
class StepAsideError extends Error {}

/** One connection's record for the diagnostics (transferInfo()). */
interface LaneStat {
  requests: number;
  bytes: number;
  /** When it last received bytes (0: never). */
  lastData: number;
  /** Waiting for an answer's head now. */
  connecting: boolean;
  /** The last answer's head time in ms, and its protocol. */
  headMs: number;
  protocol: string;
  /** How its answers ended: done, slow, stall, reset, timeout, short, refused, mismatch, changed, disk, other. */
  ends: Record<string, number>;
}

/** A connection of a ranged run (runRanged() worker). */
interface Conn {
  accepted: boolean;
  lane: number;
  /** It left the run (refused, retired, or its worker ended). */
  left: boolean;
  /** Another connection is still fetching (not resting, not gone). */
  mayYield: () => boolean;
  /** Leave the run now, in the same step as the decision (runRanged()). */
  leave: (err: unknown) => void;
}

/** An answer streaming into a segment: its connection, the bytes it brought this tick, per-tick bytes and held ms. */
interface Flow {
  res: Response;
  lane: number;
  stat: LaneStat;
  bytes: number;
  samples: number[];
  heldSamples: number[];
  heldLast: number;
  /** Its first body byte arrived (the stall rule waits for it: the time before it is the idle timeout's). */
  firstByte: boolean;
}

/** How an answer ended, for LaneStat.ends. */
function endOf(err: unknown): string {
  if (err instanceof ShortBodyError) return 'short';
  if (err instanceof NetError) return err.code === 'NS_ERROR_NET_TIMEOUT' || err.code === 'NS_ERROR_NET_TIMEOUT_EXTERNAL' ? 'timeout' : CUT_CODES.has(err.code) ? 'reset' : 'other';
  if (err instanceof HttpStatusError || err instanceof NotTheFileError) return 'refused';
  if (err instanceof RangeMismatchError) return 'mismatch';
  if (err instanceof ChangedError || err instanceof RangeIgnoredError) return 'changed';
  if (err instanceof DiskError) return 'disk';
  return 'other';
}

/** The connection was cut (not refused): asked again at once after progress. */
function isCut(err: unknown): boolean {
  return err instanceof ShortBodyError || (err instanceof NetError && CUT_CODES.has(err.code));
}
class RangeMismatchError extends Error {
  constructor() {
    super('The server sent a different part of the file than was asked for.');
  }
}

export interface Segment {
  start: number;
  /** Exclusive; -1 when the length is unknown. */
  end: number;
  received: number;
}

/** Where a download's address came from and until when it works (RESUME-DESIGN.md 5.2). */
export interface AddressInfo {
  obtainedAt: number;
  /** From the final address (expiry.ts); 0 when it does not say. */
  expiresAt: number;
  /**
   * 'first' (the download's own first answer), 'original' (renewed from it), 'pasted' (Use another
   * address), 'page' or 'link' (started again on its page, or from an address with no page: Phase 3).
   */
  how: string;
  /** The addresses it replaced, newest first (at most 5). */
  history: Array<{ url: string; finalUrl: string; at: number; how: string }>;
}

/** What is persisted about one file download. Fields after `restarts` are missing in older records. */
export interface FileState {
  url: string;
  finalUrl: string;
  total: number;
  ranges: boolean;
  etag: string;
  lastModified: string;
  digest: { alg: string; value: string } | null;
  segments: Segment[];
  probed: boolean;
  restarts: number;
  /** The first probe's Content-Type and Content-Disposition name (RESUME-DESIGN.md 2.3, 5.2). */
  contentType?: string;
  dispositionName?: string;
  /**
   * contentType is not this download's own answer but a guess: Firefox's type for a Retry of its
   * download, or an older record's row type (RESUME-DESIGN.md 5.8). R1 then only takes a page or JSON
   * for "not the file", never text or XML (review of Phase 1). The next answer replaces it.
   */
  typeGuessed?: boolean;
  /** The .part may be emptied: a first start, Start over or a silent restart (3 G3). Cleared once the .part is set up. */
  allowFresh?: boolean;
  /** When the silent restarts after a change happened (at most SILENT_RESTARTS in RESTART_WINDOW). */
  silent?: number[];
  /**
   * A download Firefox was moving, continued by Deer's engine (Retry): its first answer must already
   * be the file Firefox had (contentType holds Firefox's type), or the row stops (Phase 1 guard).
   */
  guarded?: boolean;
  /**
   * The addresses the answer that set finalUrl was redirected from, the requested one first (at most
   * 8): what the original-address step asks again when finalUrl expires (RESUME-DESIGN.md 5.2, G1).
   */
  chain?: string[];
  address?: AddressInfo;
  /**
   * R6 (RESUME-DESIGN.md 2.4): the ETag changed over the same bytes twice within ten minutes. If-Range
   * then carries Last-Modified or nothing, the ETag is no longer compared, and one window is compared
   * every 256 MiB or 5 minutes of a run instead.
   */
  etagUnstable?: boolean;
  /** When a new ETag over the same bytes was proven (kept for UNSTABLE_WINDOW). */
  retagged?: number[];
  /**
   * Review of Phase 2, R6 for Last-Modified: it did not hold over the same bytes twice within ten
   * minutes (a farm whose backends differ in both validators). With etagUnstable or no strong ETag,
   * If-Range then carries nothing, neither validator is compared, and the spot checks remain.
   */
  dateUnstable?: boolean;
  /** When a Last-Modified that did not hold over the same bytes was proven (kept for UNSTABLE_WINDOW). */
  redated?: number[];
  /**
   * RESUME-DESIGN.md 4.1, 5.2 (Phase 5): a run may have written bytes no seal covers yet. Set (and saved,
   * flushed) before a run writes; a clean stop drains the hashing, seals and clears it. Still set at the
   * next start: the unclean-session rules of 4.2 decide what is trusted.
   */
  dirty?: boolean;
  /**
   * When the last clean stop's seal began, if it could not flush the .part (review of Phase 5): its bytes
   * may still have been in the cache when that session ended. If it ended uncleanly, the row is checked as
   * after a crash (the dirty mark is set again at the next start).
   */
  unflushed?: number;
  /** What reading block 0 back said the download is (4.1), when no Content-Type says it. */
  kind?: 'text' | 'binary';
}

export interface ProbeInfo {
  status: number;
  contentType: string;
  disposition: string;
  total: number;
  finalUrl: string;
  protocol: string;
}

/** Everything a transfer needs from its download. */
export interface TransferEnv {
  identity: Identity;
  limiters: RateLimiter[];
  connections: () => number;
  onBytes: (n: number) => void;
  /** The download's id: places the proof's seeded window (RESUME-DESIGN.md 2.5). */
  seed?: string;
  /**
   * The renewal hook (RESUME-DESIGN.md 3.0; it replaces the unused refreshIdentity and onRetry): the
   * address refused the download or answers with something else, or its expiry time has passed.
   * Resolves once a new address proven to give the same file was adopted into `state` (finalUrl,
   * validators, chain), null when none was found; rejects with ChangedError when the original address
   * now gives another version of the file. Single-flight per download, with its limits (renew.ts Gate).
   */
  renew?: (why: RenewWhy, status: number) => Promise<Renewed | null>;
}

const remaining = (s: Segment): number => s.end - s.start - s.received;

/**
 * The owner's decision 1 (RESUME-DESIGN.md 3 G3): with at most ASK_ABOVE bytes saved, a changed
 * file may start again by itself, at most SILENT_RESTARTS times in RESTART_WINDOW. Returns the
 * restart log with this restart added, or null when the row must ask instead.
 */
export function silentRestart(log: number[] | undefined, saved: number, allowed = true): number[] | null {
  const now = Date.now();
  const recent = (log ?? []).filter((t) => now - t < RESTART_WINDOW && t <= now);
  if (!allowed || saved > ASK_ABOVE || recent.length >= SILENT_RESTARTS) return null;
  return [...recent, now];
}

export class FileTransfer {
  /** Connections currently receiving. */
  live = 0;
  /** The most connections that were receiving at once (tests). */
  peakLive = 0;
  /** Sockets the responses came over (tests: distinct = separate connections). */
  sockets = new Set<string>();
  /** Silent or slow connections tick() cut to reconnect, and failing ones that stepped aside, in this transfer (tests). */
  reconnects = 0;
  stepAsides = 0;
  /**
   * Diagnostics (transferInfo()): every reconnect (tick() cuts and cut answers asked again at once), connections
   * a refusal retired, the sparse mark, the .part's sizing time, the slowest Writer open, and how long answers
   * were held for the disk and the speed limit. O(connections); nothing here decides anything.
   */
  diag = { reconnectsAll: 0, retired: 0, sparse: null as null | { ok: boolean; ms: number }, room: null as null | { needed: number; others: number; holds: number }, openPartMs: 0, writerOpenMaxMs: 0, heldDiskMs: 0, heldLimitMs: 0 };
  /** Lane -> its record for the diagnostics. */
  private laneStats = new Map<number, LaneStat>();
  /** Lane -> when it last received bytes. */
  private moved = new Map<number, number>();
  /** Segment -> the answer streaming into it (tick()). */
  private flows = new Map<Segment, Flow>();
  /** Lane -> when tick() last cut it. */
  private cutAt = new Map<number, number>();
  /** Segments whose answer tick() cut, and why ('stall' or 'slow'): the next try goes at once and is no failure. */
  private recut = new Map<Segment, string>();
  /** Lane -> its generation (net.ts ChannelOptions.gen): a cut bumps it, so the next ask is a new connection. */
  private laneGen = new Map<number, number>();
  /** Lane -> bytes per tick over the last SLOW_TICKS ticks, across its answers (the reference speeds). */
  private laneWin = new Map<number, number[]>();
  /** Lane -> its byte count at the last tick. */
  private laneSeen = new Map<number, number>();
  /** The busy lanes' last median and when it was taken (BUSY_MEMORY_MS). */
  private busy = { median: 0, at: 0 };

  /** A lane's diagnostics record (made on first use). */
  private lane(lane: number): LaneStat {
    let s = this.laneStats.get(lane);
    if (!s) {
      s = { requests: 0, bytes: 0, lastData: 0, connecting: false, headMs: -1, protocol: '', ends: {} };
      this.laneStats.set(lane, s);
    }
    return s;
  }

  /** The diagnostics, as plain data (VitreDownloads transferInfo()). */
  diagnostics(): Record<string, unknown> {
    const now = Date.now();
    return {
      ...this.diag,
      reconnects: this.reconnects,
      stepAsides: this.stepAsides,
      lanes: [...this.laneStats].map(([lane, s]) => ({ lane, ...s, ends: { ...s.ends }, quietMs: s.lastData ? now - s.lastData : -1 })),
    };
  }
  /**
   * A changed file may start again by itself (see silentRestart). False for a row that already asks:
   * Resume there only checks again, it never starts over (RESUME-DESIGN.md 3 G3).
   */
  silentRestarts = true;
  /**
   * The run is a network or server wait's automatic try and this is its check (RESUME-DESIGN.md G4,
   * review of Phase 4): a 429 or 5xx ends the check at once (net.ts serverStops()), and the wait's own
   * schedule spaces the tries. Set by the engine around the check only.
   */
  waitTry = false;
  /**
   * The download's block hash record (RESUME-DESIGN.md 4.1, Phase 5; ledger.ts), set by the engine once the
   * file's length and path are known. Null: no record (a length never known), as before Phase 5.
   */
  ledger: Ledger | null = null;
  /** The whole file's SHA-256 (hex), when verify() computed it for the server's checksum (reused at completion). */
  sha256 = '';
  /** Blocks fromServer() replaced (the history line). */
  fixedFromServer = 0;
  /** A digest mismatch is repaired at most once per run (4.3). */
  private digestRounds = 0;
  /** Bytes taken since the hashing was last looked at while streaming (HASH_EVERY). */
  private sinceHash = 0;
  /** Stops a running ranged transfer with an error (a released block that hashed to another value). */
  private halt: ((err: unknown) => void) | null = null;
  private pending: Response | null = null;
  /** Segment -> the Writer currently filling it. */
  private writers = new Map<Segment, Writer>();
  /** Whether the download is text (a page, JSON...) or a file, for R1 (proof.ts readKind()). */
  private k: Kind = { kind: '', sure: false };
  /** Byte proofs made in this run (at most PROOF_GUARD). */
  private proofs = 0;
  /** Header changes taken with nothing saved to compare (R7), in this run (at most PROOF_GUARD). */
  private unproven = 0;
  /** A new single-stream answer being written to "<part>.new" while the saved bytes stay in the .part. */
  private shadow: Segment | null = null;
  /** The spot checks of etagUnstable and dateUnstable: bytes since the last one, when it was, the one running, how many so far. */
  private sinceSpot = 0;
  private spotAt = Date.now();
  private spot: Promise<void> | null = null;
  private spots = 0;

  constructor(
    readonly state: FileState,
    private env: TransferEnv
  ) {}

  static fresh(url: string): FileState {
    return { url, finalUrl: url, total: -1, ranges: false, etag: '', lastModified: '', digest: null, segments: [], probed: false, restarts: 0, contentType: '', dispositionName: '', allowFresh: true };
  }

  /** Bytes received, for the row: while a new single-stream answer is checked, the larger count. */
  get received(): number {
    return this.shadow ? Math.max(this.saved, this.shadow.received) : this.saved;
  }

  /** Bytes the segments claim: what is in the .part. */
  private get saved(): number {
    return this.state.segments.reduce((n, s) => n + s.received, 0);
  }

  /**
   * The state as it is safe to persist right now: bytes still waiting in a writer's pipe are not
   * counted, so a crash never leaves a segment claiming bytes that didn't reach the file.
   */
  snapshot(): FileState {
    const s = this.state;
    return {
      ...s,
      segments: s.segments.map((seg) => {
        const w = this.writers.get(seg);
        return { start: seg.start, end: seg.end, received: w ? Math.max(0, seg.received - w.backlog) : seg.received };
      }),
    };
  }

  /**
   * The segments as far as their bytes are certainly in the .part now, for windows read back while
   * connections still write (a renewal in the middle of a run): a writer's backlog and the chunk its
   * copier may still be writing (IN_FLIGHT) are left out.
   */
  provable(): Segment[] {
    return this.state.segments.map((seg) => {
      const w = this.writers.get(seg);
      // The writer took seg.received - written before it began; of its own bytes, only the settled ones are
      // certainly in the file. Review of Phase 5: once a write failed its copier closes the pipe, whose
      // backlog then reads 0, so the backlog no longer says what never arrived (Writer.settled).
      return { start: seg.start, end: seg.end, received: w ? Math.max(0, seg.received - w.written + w.settled) : seg.received };
    });
  }

  /** What a proof of this download reads (proof.ts): the record, its identity, its kind, the saved bytes. */
  proofCtx(): ProofCtx {
    return { state: this.state, identity: this.env.identity, kind: this.k, saved: this.saved, sockets: this.sockets, heads: this.ledger, waitTry: this.waitTry };
  }

  /** The first answer, kept for a single-stream download; dropped when the download waits in the queue. */
  dropPending(): void {
    this.pending?.destroy();
    this.pending = null;
  }

  /**
   * The validator for If-Range: a strong ETag; Last-Modified when there is no ETag or only a weak one
   * (a weak ETag can't be used for ranges, RFC 9110 13.1.5; RESUME-DESIGN.md section 7, Phase 1), or
   * when the ETag is not to be trusted (etagUnstable, R6); nothing when Last-Modified isn't either
   * (dateUnstable, review of Phase 2).
   */
  private ifRange(): string {
    const { etag, lastModified, etagUnstable, dateUnstable } = this.state;
    if (etag && !etag.startsWith('W/') && !etagUnstable) return etag;
    return dateUnstable ? '' : lastModified;
  }

  /**
   * Ask for the start of the file: length, range support, validators, and (when resuming) whether it
   * is unchanged. A resume asks bytes=0-65535, so window 0 is compared with the saved bytes in the
   * same request (RESUME-DESIGN.md 2.5); a first probe asks one byte. `partPath` lets an older record
   * without a Content-Type be judged by its saved bytes, and the saved bytes decide when only headers
   * say the file changed (prove()). A refused address goes to the renewal hook first (afterRefusal()).
   * Throws NotTheFileError, AddressRefusedError or ChangedError without changing any state but the
   * address a renewal proved.
   */
  async probe(signal: AbortSignal, partPath = ''): Promise<ProbeInfo> {
    const s = this.state;
    const resuming = s.probed && this.saved > 0;
    const judging = resuming || !!s.guarded;
    if (judging) this.k = await readKind(s, partPath);
    // RESUME-DESIGN.md 3.0: an address whose expiry time has passed is renewed before the first request,
    // instead of waiting out its 403s. When nothing new is found the probe still asks it once.
    if (resuming && s.finalUrl !== s.url && expiredAt(s.finalUrl)) await this.renewed('expired', 0, s.finalUrl);
    // The bytes a resume's probe asks for (window 0). A file of at most WINDOW bytes is asked one byte
    // short: a server may answer a Range over the whole file with the whole file, a 200 that reads as
    // "changed" (review of Phase 2; Phase 1 asked one byte, which every such server ranges).
    const head = s.total > 1 && s.total <= WINDOW ? s.total - 1 : WINDOW;
    let retried = false;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      const asked = s.probed ? s.finalUrl : s.url;
      const validator = resuming ? this.ifRange() : '';
      try {
        const extra: Record<string, string> = { Range: resuming ? `bytes=0-${head - 1}` : 'bytes=0-0' };
        if (validator) extra['If-Range'] = validator;
        res = await open(asked, this.env.identity, extra, signal, { lane: 0 });
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(1000, signal);
        continue;
      }
      if (res.status === 200 || res.status === 206 || res.status === 416) {
        // The verdict comes first: rec.file is this state, and the store saves it right after.
        let verdict = judging ? judge(s, this.saved, this.k, res, resuming, validator) : null;
        if (verdict instanceof NotTheFileError) {
          res.destroy();
          if ((await this.afterRefusal(verdict, asked, true)) === 'renewed') {
            attempt--;
            continue;
          }
          throw verdict;
        }
        if (verdict && !(verdict instanceof ChangedError && verdict.headersOnly)) {
          res.destroy();
          throw verdict;
        }
        if (!resuming) return this.learn(res, false);
        // Review of Phase 2: neither validator can be trusted any more (R6), so nothing in this answer
        // says the file is unchanged: the saved bytes decide, as for a header difference (2.5).
        if (!verdict && !validator && res.status === 206 && (s.etagUnstable || s.dateUnstable)) verdict = headerChange(UNSURE, res);
        // Window 0 against the saved bytes (R4; with the same strong ETag, R5's check).
        const first = await this.windowZero(res, partPath, !!verdict, head);
        if (first instanceof NotTheFileError) {
          if ((await this.afterRefusal(first, asked, true)) === 'renewed') {
            attempt--;
            continue;
          }
          throw first;
        }
        if (first instanceof Error) throw first;
        // A 206 to If-Range that judge() let through confirms the saved bytes are this file's start.
        if (!verdict) return this.learn(res, true, !!validator && res.status === 206);
        if (!first) res.destroy();
        // R6: only headers said it changed; the saved bytes decide (prove()), then its validators are adopted (held()).
        const change = verdict as ChangedError;
        const proven = await this.prove(partPath, signal, change, first ? res : null);
        if (proven instanceof ChangedError || !proven) throw proven ?? change;
        this.held(change.validators);
        return this.learn(proven, true, true);
      }
      const wait = retryAfter(res);
      if (REFUSED_STATUS.has(res.status) || res.status === 400) {
        const err = await refusal(res, wait);
        const next = await this.afterRefusal(err, asked, retried);
        if (next === 'renewed') {
          attempt--;
          continue;
        }
        if (next === 'retry') retried = true;
        else if (next === 'stop' || attempt >= ATTEMPTS || !isRetryableStatus(res.status)) throw err;
        await sleep(backoff(next === 'retry' ? 1 : attempt, wait) * 1000, signal);
        continue;
      }
      if (attempt >= ATTEMPTS || !isRetryableStatus(res.status) || serverStops(res.status, wait, this.waitTry)) throw await refusal(res, wait);
      res.destroy();
      await sleep(backoff(attempt, wait) * 1000, signal);
    }
  }

  /**
   * The probe with the owner's rule for a changed file: with little saved it starts again by itself
   * (silentRestart), otherwise ChangedError goes to the row, which asks.
   */
  async check(signal: AbortSignal, partPath = ''): Promise<ProbeInfo> {
    try {
      return await this.probe(signal, partPath);
    } catch (err) {
      if (!(err instanceof ChangedError) || !this.restartSilently()) throw err;
      return this.probe(signal, partPath);
    }
  }

  /**
   * Window 0 of a resume's probe against the saved bytes (RESUME-DESIGN.md 2.5): true when equal, false
   * when nothing could be compared (no saved bytes at 0, a range that starts elsewhere, an answer that
   * broke off, a 200 the single stream keeps: only with `whole`, a 200 judged by its headers, is a 200
   * read), NotTheFileError for a page where the saved bytes are not one, ChangedError for other bytes.
   * Only the whole window counts: one longer than the `asked` bytes is not compared here (prove()
   * asks for it). What it reads of the answer is dropped with it.
   */
  private async windowZero(res: Response, partPath: string, whole: boolean, asked: number): Promise<boolean | Error> {
    const first = this.state.segments.find((x) => x.start === 0 && x.received > 0);
    if (!partPath || !first) return false;
    if (res.status === 206) {
      const cr = parseContentRange(res.header('content-range'));
      if (!cr || cr.start !== 0) return false;
    } else if (res.status !== 200 || !whole) return false;
    const n = Math.min(WINDOW, first.received);
    if (n > asked) return false;
    const theirs = await res.head(n);
    if (theirs.length < n) return false;
    // With the record (Phase 5), block 0's head hash is the reference: damage in the .part is never
    // taken for another file (the local checks find it).
    const recorded = this.ledger?.head(0, n);
    if (recorded) {
      if ((await sha256Hex(theirs)) === recorded) return true;
      if (textStart(theirs) && this.k.kind === 'binary') return new NotTheFileError(res.header('content-type'));
      return new ChangedError('its first bytes are different');
    }
    const ours = await readAt(partPath, 0, n);
    if (!ours || ours.length < n) return false;
    if (textStart(theirs) && !textStart(ours)) return new NotTheFileError(res.header('content-type'));
    return differs(theirs, ours) ? new ChangedError('its first bytes are different') : true;
  }

  /**
   * RESUME-DESIGN.md 3.0, with saved bytes at stake and the renewal hook present (otherwise null: the
   * retry rules of before apply). An address that refused (401, 403, 404, 410, 451, an expired 400) or
   * answers with something that is not the file (R1): a 403 gets exactly one retry at the same address,
   * and only while its expiry time is unknown or still ahead ('retry'; cookies are read afresh on every
   * request). Otherwise the hook looks for the file at the original address: 'renewed' means
   * state.finalUrl is a new address proven to give the same file, 'stop' that none was found.
   */
  private async afterRefusal(err: unknown, asked: string, retried: boolean): Promise<'retry' | 'renewed' | 'stop' | null> {
    const status = err instanceof AddressRefusedError ? err.status : err instanceof NotTheFileError ? 0 : -1;
    if (status < 0 || !this.env.renew || this.saved <= 0) return null;
    if (status === 403 && !retried && !expiredAt(asked)) return 'retry';
    return (await this.renewed(status ? 'refused' : 'not-file', status, asked)) ? 'renewed' : 'stop';
  }

  /** The renewal hook: true when it moved state.finalUrl on from `failing` (rejects with its ChangedError). */
  private async renewed(why: RenewWhy, status: number, failing: string): Promise<boolean> {
    if (!this.env.renew) return false;
    await this.env.renew(why, status);
    return this.state.finalUrl !== failing;
  }

  /**
   * `trusted`: the answer is known to describe the saved bytes (a 206 to If-Range judge() let
   * through, or windows prove() compared). Only then may a download whose length was never known
   * continue by ranges.
   */
  private learn(res: Response, resuming: boolean, trusted = false): ProbeInfo {
    const s = this.state;
    const type = res.header('content-type');
    const disposition = res.header('content-disposition');
    const info: ProbeInfo = { status: res.status, contentType: type, disposition, total: -1, finalUrl: res.url, protocol: res.protocol };
    const total = totalOf(res);
    let ranges = res.status === 206 && total > 0;
    if (res.status === 200) {
      // The server ignored the Range: this answer is the whole file. It stays suspended for the single stream.
      this.dropPending();
      this.pending = res;
    } else res.destroy();
    s.finalUrl = res.url;
    if (!resuming) {
      // Nothing saved yet: this answer describes the file from now on (RESUME-DESIGN.md 2.3), and its
      // redirect hops are where a renewal asks again (5.2).
      s.total = total;
      s.segments = [];
      s.etag = res.header('etag');
      s.lastModified = res.header('last-modified');
      s.digest = digestOf(res);
      s.contentType = type;
      s.typeGuessed = false;
      s.dispositionName = nameFromDisposition(disposition);
      s.chain = res.chain;
      s.address = { obtainedAt: Date.now(), expiresAt: 0, how: 'first', history: s.address?.history ?? [] };
    } else {
      // A resume keeps every segment (judge() stopped a file that changed); an older record learns
      // what it never recorded. A server that stopped ranging goes the single-stream way, which
      // keeps the saved bytes until the new answer proves to start with them (runSingle).
      const open = s.segments.some((seg) => seg.end < 0);
      if (open && ranges && trusted) {
        // Review of Phase 1: a download whose length was never known, at an address that now takes
        // ranges and gives the same file: the saved bytes are the start of a file `total` long
        // (judge() made sure they fit), and the rest comes by ranges.
        for (const seg of s.segments) if (seg.end < 0) seg.end = total;
      } else if (open) {
        // Otherwise it stays the single stream it was, its length unknown: never ranges after a
        // stretch whose end was never known (bytes that never arrived would complete the file).
        ranges = false;
      }
      // A known total stays known when the answer doesn't say (a 206 with "/*", a 200 without
      // Content-Length), so replaceSingle still checks the new answer's length (review of Phase 1).
      if (total >= 0 && !(open && !ranges)) s.total = total;
      if (!s.contentType || s.typeGuessed) {
        // The address's own type replaces a guess, now that the answer proved to be the file.
        s.contentType = type;
        s.typeGuessed = false;
      }
      if (!s.dispositionName) s.dispositionName = nameFromDisposition(disposition);
      if (res.chain.length) s.chain = res.chain;
    }
    if (s.address) s.address.expiresAt = expiresAt(s.finalUrl);
    s.ranges = ranges;
    if (!this.k.kind && s.contentType) this.k = { kind: textual(s.contentType) ? 'text' : 'binary', sure: !s.typeGuessed };
    s.guarded = false;
    s.probed = true;
    info.total = total;
    return info;
  }

  /**
   * R4 at the download's own address (RESUME-DESIGN.md 2.4 R4-R6, 2.5): only headers said the file
   * changed, so the saved bytes decide. The windows (proof.ts windows(): 3 or 4, those after window 0
   * when the probe's answer already carried it as `first`) are asked for with Range and no If-Range and
   * compared with the .part; together they must make a proof (enough()). All equal: the same file
   * under new validators (a redeploy, another CDN edge; the caller adopts them, held()), and the answer
   * to learn() from is returned: the last window's, or `first` when it is a 206 and nothing else was
   * left to compare. A 200 that carried window 0 can't be learned from (its body was read), so when
   * window 0 was all there was it is asked again with a plain Range, as Phase 1 did (review of Phase 2).
   * A 200 to a window (the address no longer takes ranges) is returned unread: as the single stream's
   * answer it must start with the saved bytes (replaceSingle). A window that differs or another total
   * is the ChangedError to stop with; so is `because` when a window can't be compared or the run used
   * PROOF_GUARD proofs. With no saved bytes to compare at all, null under ASK_ABOVE (R7: nothing at
   * stake, the answer is taken as the file): no proof, so it never counts toward PROOF_GUARD (review
   * of Phase 2), only toward its own guard. A refused address or a page throws, as the probe would.
   * Changes nothing.
   */
  private async prove(partPath: string, signal: AbortSignal, because: ChangedError, first: Response | null): Promise<ChangedError | Response | null> {
    const s = this.state;
    if (!partPath) return because;
    const segs = this.provable();
    const planned = windows(segs, this.env.seed ?? s.url, this.ledger);
    if (!planned.length) return this.saved > ASK_ABOVE || ++this.unproven > PROOF_GUARD ? because : null;
    if (this.proofs >= PROOF_GUARD) return because;
    this.proofs++;
    const answer = first?.status === 206 ? first : null;
    let wins = planned.filter(([a]) => !(first && a === 0));
    if (!wins.length && !answer) wins = planned;
    if (!wins.length) return enough(segs, planned) ? answer : because;
    const r = await compareWindows(this.proofCtx(), s.finalUrl, wins, partPath, signal, s.total);
    if (r.verdict === 'whole') return r.res;
    if (r.verdict === 'changed') return r.err;
    if (r.verdict === 'unknown' || !enough(segs, planned)) return because;
    return r.res ?? answer ?? because;
  }

  /**
   * R6 (RESUME-DESIGN.md 2.4): the saved bytes proved that an answer whose headers said otherwise is
   * the same file, so its validators become the download's. A validator that changed, or that an
   * If-Range carried when the server sent the whole file anyway, did not hold: twice within
   * UNSTABLE_WINDOW and it is no longer trusted (the ETag: etagUnstable; Last-Modified: dateUnstable).
   * Review of Phase 2: a farm whose backends differ in both ETag and Last-Modified then sends no
   * If-Range at all (the spot checks remain), instead of proving every other answer until it gave up.
   */
  private held(v: ChangedError['validators']): void {
    if (!v) return;
    const s = this.state;
    const now = Date.now();
    const log = (old: number[] | undefined): number[] => [...(old ?? []).filter((t) => t <= now && now - t < UNSTABLE_WINDOW), now];
    const slipped = (ours: string, theirs: string): boolean => (!!ours && !!theirs && ours !== theirs) || (!!v.whole && !!v.sent && v.sent === ours);
    if (slipped(s.etag, v.etag)) {
      s.retagged = log(s.retagged);
      if (s.retagged.length >= 2) s.etagUnstable = true;
    }
    if (slipped(s.lastModified, v.lastModified)) {
      s.redated = log(s.redated);
      if (s.redated.length >= 2) s.dateUnstable = true;
    }
    s.etag = v.etag;
    s.lastModified = v.lastModified;
  }

  /**
   * With etagUnstable (or dateUnstable) the validators no longer say the file is unchanged, so one
   * window is compared every SPOT_BYTES or SPOT_MS of a run instead (R6). Another file stops the download (ChangedError); a
   * window that can't be compared waits for the next turn. Every connection waits for the one check.
   */
  private spotCheck(partPath: string, signal: AbortSignal): Promise<void> {
    if (this.spot) return this.spot;
    if (this.sinceSpot < SPOT_BYTES && Date.now() - this.spotAt < SPOT_MS) return Promise.resolve();
    this.sinceSpot = 0;
    this.spotAt = Date.now();
    const wins = windows(this.provable(), this.env.seed ?? this.state.url, this.ledger);
    if (!wins.length) return Promise.resolve();
    const win = wins[this.spots++ % wins.length];
    const spot = (async () => {
      const r = await compareWindows(this.proofCtx(), this.state.finalUrl, [win], partPath, signal, this.state.total);
      if (r.verdict === 'whole') r.res.destroy();
      if (r.verdict === 'changed') throw r.err;
    })();
    this.spot = spot;
    const done = (): void => {
      if (this.spot === spot) this.spot = null;
    };
    spot.then(done, done);
    return spot;
  }

  /**
   * Start again from nothing after a change, when silentRestart allows it: the saved bytes (at most
   * ASK_ABOVE) are forgotten and openPart may empty the .part. False: the row must ask.
   */
  private restartSilently(): boolean {
    const s = this.state;
    const log = silentRestart(s.silent, this.saved, this.silentRestarts);
    if (!log) return false;
    this.dropPending();
    Object.assign(s, { silent: log, restarts: (s.restarts || 0) + 1, probed: false, segments: [], etag: '', lastModified: '', digest: null, contentType: '', typeGuessed: false, dispositionName: '', allowFresh: true, kind: undefined });
    this.k = { kind: '', sure: false };
    // Review of Phase 5: the block hashes described the old file; the new one's bytes are hashed afresh
    // (a hash kept made the new file's completion check fail against the old head, every time).
    this.ledger?.forget('restarted');
    return true;
  }

  private connections(): number {
    return this.state.total >= MIN_SPLIT ? Math.max(1, Math.min(32, this.env.connections())) : 1;
  }

  private plan(): void {
    const s = this.state;
    if (s.segments.length) return;
    if (s.ranges && s.total > 0) {
      // Cut at multiples of the block size, so each block sits inside one segment (RESUME-DESIGN.md 4.1).
      const bs = blockSize(s.total);
      const size = Math.ceil(Math.ceil(s.total / this.connections()) / bs) * bs;
      for (let start = 0; start < s.total; start += size) s.segments.push({ start, end: Math.min(s.total, start + size), received: 0 });
    } else {
      s.segments = [{ start: 0, end: s.total >= 0 ? s.total : -1, received: 0 }];
    }
  }

  /** Download into `partPath` until every byte has landed and checks out. */
  async download(partPath: string, signal: AbortSignal): Promise<void> {
    try {
      await this.downloadTo(partPath, signal);
    } finally {
      filling.delete(this);
    }
  }

  private async downloadTo(partPath: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      this.plan();
      // Ranges never continue a segment whose end was never known (review of Phase 1; learn() already
      // sees to it): such bytes go the single-stream way, compared before they are replaced.
      if (this.state.ranges && this.state.segments.some((seg) => seg.end < 0)) this.state.ranges = false;
      await this.openPart(partPath);
      try {
        if (this.state.total === 0) return;
        if (this.state.ranges && this.state.total > 0) await this.runRanged(partPath, signal);
        else await this.runSingle(partPath, signal);
        // A released block fetched again must hash to its old value before the file counts as complete
        // (4.3: otherwise the file on the site changed), so with released blocks the hashing is drained
        // here. Review of Phase 5: otherwise the finish no longer waits for it: above about 700 MB/s it fell
        // behind and held a finished download at 100% for seconds; the blocks not hashed yet are hashed
        // from the finished file right after (VitreDownloads finishRecord()). Pause and Cancel still stop it.
        if (this.ledger?.expect.size) await untilAborted(this.ledger.drain(), signal);
        if (signal.aborted) throw new AbortedError();
        if (this.ledger?.mismatch) throw this.ledger.mismatch;
        await this.completionCheck(partPath, signal);
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (err instanceof ChangedError && this.ledger?.mismatch === err && this.ledger.mismatchBlock >= 0) {
          // Its claims on that block go: the other file's bytes there are never kept as this one's.
          this.state.segments = this.ledger.release(this.state.segments, [this.ledger.mismatchBlock], 'changed');
        }
        if (err instanceof RangeIgnoredError) {
          // The server stopped honouring Range: the single stream from the start. The segments stay:
          // the saved bytes are kept until the new answer proves to start with them (runSingle).
          this.state.ranges = false;
          continue;
        }
        if (err instanceof ChangedError) {
          // The file changed mid-download: every connection closed its writer, so the counts are
          // exact and the .part is as it was. When only headers said so, the saved bytes decide
          // (R6, prove()): the same file carries on under its new validators (held()); with nothing
          // saved to compare, under ASK_ABOVE, the answer's validators are taken (R7). Otherwise, with
          // little saved it starts again; with more the row asks.
          const verdict = err.headersOnly ? await this.prove(partPath, signal, err, null) : err;
          if (!(verdict instanceof ChangedError)) {
            this.held(err.validators);
            if (verdict) this.learn(verdict, true, true);
            continue;
          }
          if (!this.restartSilently()) throw verdict;
          await this.probe(signal, partPath);
          continue;
        }
        throw err;
      }
      if ((await this.verify(partPath, signal)) === 'again') continue;
      return;
    }
  }

  /**
   * Size the .part file for the ranged path; a missing or short file rewinds the segments. The file
   * is emptied only when allowFresh says nothing in it is worth keeping (RESUME-DESIGN.md 3 G3), and
   * never sized below the bytes the segments claim (review of Phase 1): a total under them is another
   * file (judge() stops that first).
   */
  private async openPart(partPath: string): Promise<void> {
    const s = this.state;
    const size = await sizeOf(partPath);
    if (size < 0) for (const seg of s.segments) seg.received = 0;
    else for (const seg of s.segments) seg.received = Math.max(0, Math.min(seg.received, size - seg.start));
    const fresh = this.saved === 0;
    const empty = fresh && !!s.allowFresh;
    const claimed = s.segments.reduce((n, seg) => (seg.received > 0 ? Math.max(n, seg.start + seg.received) : n), 0);
    if (s.total >= 0 && claimed > s.total) throw new ChangedError(`now ${sizeText(s.total)}, but ${sizeText(claimed)} were already saved`);
    // A single stream with saved bytes writes the whole new answer next to them ("<part>.new"). A ranged .part is
    // sparse (below), so it holds only what was written and what lies past its farthest write: the room still
    // needed is what it does not hold yet, and the other sparse downloads on that disk still need theirs
    // (review: counting the sized .part as held let a resume or a second download run out of room midway).
    // A .part that is emptied gives its room back before the room is counted (review).
    const dir = PathUtils.parent(partPath) ?? partPath;
    if (empty && size > 0) setSize(partPath, 0, { truncate: true });
    let needed = s.total <= 0 ? 0 : !s.ranges && !fresh ? s.total : s.total - Math.max(0, fresh ? 0 : size);
    let holds = -1;
    if (s.ranges && s.total > 0) {
      // Untold (the worker busy past flushPart's 15 s, or broken): the count from before sparse parts, since a
      // .part that worker never answered for was most likely never made sparse either.
      holds = size < 0 || empty ? 0 : await heldBytes(partPath, 20000);
      needed = Math.max(0, s.total - (holds >= 0 ? holds : Math.max(0, size)));
    }
    const others = needed > 0 ? await stillNeeded(this, dir) : 0;
    this.diag.room = { needed, others, holds };
    ensureRoom(dir, needed > 0 ? needed + others : 0);
    if (s.ranges && s.total > 0) {
      const t0 = Date.now();
      if (size !== s.total || empty) setSize(partPath, s.total, { truncate: empty });
      // Sparse before any connection writes (workers/flush.js): otherwise NTFS fills the gap up to a write far
      // into the file with zeros inside that write, and the connections there wait minutes on a big file.
      // Also for a .part sized by an older run; where the volume has no sparse files it stays as before.
      const t1 = Date.now();
      const ok = await sparsePart(partPath);
      this.diag.sparse = { ok: ok === true, ms: Date.now() - t1 };
      // No answer in time still counts: the call runs when the worker reaches it (review).
      if (ok !== false) filling.set(this, { dir, path: partPath, total: s.total, written: () => written(s) });
      this.diag.openPartMs = Date.now() - t0;
    } else if (size < 0 || empty) {
      setSize(partPath, 0, { truncate: true });
    }
    s.allowFresh = false;
  }

  private async runRanged(partPath: string, signal: AbortSignal): Promise<void> {
    const owned = new Set<Segment>();
    const stop = new AbortController();
    const relay = (): void => stop.abort();
    signal.addEventListener('abort', relay);
    let fatal: unknown = null;
    const n = this.connections();
    // Connections still taking segments; a refused one may step aside only while another remains. `active`
    // leaves out the ones resting after a step-aside: the last connection actually fetching never yields
    // to resting ones (review: nobody downloaded until they woke).
    let alive = n;
    let active = n;
    // Resting connections wake when a connection finds no work left (review: a finished download sat at
    // 100% while one rested for up to a minute). One controller per wake-up: later rests wait again.
    let wake = new AbortController();
    const rouse = (): void => {
      const w = wake;
      wake = new AbortController();
      w.abort();
    };
    // A released block that hashed to another value stops every connection (4.3: Ledger.mismatch).
    this.halt = (err): void => {
      if (fatal === null) fatal = err;
      stop.abort();
    };
    if (this.ledger) this.ledger.onMismatch = (err) => this.halt?.(err);
    // The last refusal a connection left on: what the run reports if every one of them left (review: never
    // "Some parts of the file didn't arrive." where the address was refused).
    let lastRefusal: unknown = null;
    const worker = async (lane: number): Promise<void> => {
      // leave(): the decision to leave and the counts that let the next connection decide are one synchronous
      // step (review: lanes woken by one shared renewal all saw "others still here" and all left together).
      const conn: Conn = {
        accepted: false,
        lane,
        left: false,
        mayYield: () => active > 1,
        leave: (err: unknown): void => {
          if (conn.left) return;
          conn.left = true;
          alive--;
          active--;
          this.moved.delete(lane);
          lastRefusal = err;
        },
      };
      // Step-asides in a row with no bytes in between: each waits longer (STEP_ASIDE_MS).
      let asides = 0;
      try {
        for (;;) {
          if (fatal !== null || stop.signal.aborted) return;
          const seg = this.claim(owned);
          if (!seg) {
            rouse();
            return;
          }
          owned.add(seg);
          const movedBefore = this.moved.get(lane) ?? 0;
          let aside = false;
          try {
            await this.fetchSegment(seg, partPath, stop.signal, conn);
            asides = 0;
          } catch (err) {
            // Its segment is left for the connections the server does accept.
            if (err instanceof ConnectionRefusedError) return;
            if (err instanceof StepAsideError) {
              // Its segment is free for the others meanwhile; the run goes on.
              aside = true;
              asides = (this.moved.get(lane) ?? 0) > movedBefore ? 1 : asides + 1;
              this.stepAsides++;
            } else {
              if (fatal === null) fatal = err;
              stop.abort();
              return;
            }
          } finally {
            owned.delete(seg);
          }
          if (aside) {
            active--;
            try {
              await sleep(STEP_ASIDE_MS[Math.min(asides, STEP_ASIDE_MS.length) - 1], AbortSignal.any([stop.signal, wake.signal]));
            } catch {
              // Woken: a connection found no work left, so this one looks again (and leaves when there is none).
              if (stop.signal.aborted) return;
            } finally {
              active++;
            }
          }
        }
      } finally {
        if (!conn.left) {
          conn.left = true;
          alive--;
          active--;
          // A connection that left never counts as one still receiving (othersMoving()).
          this.moved.delete(lane);
        }
      }
    };
    this.moved.clear();
    const ticker = setInterval(() => this.tick(), TICK_MS);
    try {
      await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));
    } finally {
      clearInterval(ticker);
      this.flows.clear();
      this.recut.clear();
      signal.removeEventListener('abort', relay);
      this.halt = null;
      if (this.ledger) this.ledger.onMismatch = null;
    }
    if (signal.aborted) throw new AbortedError();
    if (fatal !== null) throw fatal;
    if (this.state.segments.some((s) => remaining(s) > 0)) throw lastRefusal ?? new DownloadError('Some parts of the file didn’t arrive.');
  }

  /**
   * The next segment nobody is fetching, or half of the busiest one. The cut is a multiple of the block
   * size, nearest the middle, with at least MIN_STEAL on both sides (RESUME-DESIGN.md 4.1); a segment with
   * no such cut is not split.
   */
  private claim(owned: Set<Segment>): Segment | null {
    const segs = this.state.segments;
    const free = segs.find((s) => !owned.has(s) && remaining(s) > 0);
    if (free) return free;
    const bs = blockSize(this.state.total);
    const cutOf = (s: Segment): number => {
      const from = s.start + s.received;
      const mid = from + Math.floor(remaining(s) / 2);
      const down = Math.floor(mid / bs) * bs;
      for (const c of mid - down <= bs / 2 ? [down, down + bs] : [down + bs, down]) if (c - from >= MIN_STEAL && s.end - c >= MIN_STEAL) return c;
      return -1;
    };
    let best: Segment | null = null;
    let cut = -1;
    for (const s of owned) {
      if (remaining(s) < 2 * MIN_STEAL || (best && remaining(s) <= remaining(best))) continue;
      const c = cutOf(s);
      if (c < 0) continue;
      best = s;
      cut = c;
    }
    if (!best || cut < 0) return null;
    const piece = { start: cut, end: best.end, received: 0 };
    best.end = cut;
    segs.splice(segs.indexOf(best) + 1, 0, piece);
    return piece;
  }

  /**
   * One segment, with backoff. A retry that made progress earns a fresh budget. A host that allows
   * only one or two connections per client refuses the rest (429, 503): a connection it never
   * accepted steps aside at once, one it did accept after its retries, while another remains.
   * A disk error ends the download at once (nothing on the network can fix it). An address that
   * refused or isn't the file goes to the renewal hook (afterRefusal()); a new address does not use up
   * an attempt (RESUME-DESIGN.md 3.0).
   */
  private async fetchSegment(seg: Segment, partPath: string, signal: AbortSignal, conn: Conn): Promise<void> {
    let failures = 0;
    let retried = false;
    const stat = this.lane(conn.lane);
    const ended = (why: string): void => {
      stat.ends[why] = (stat.ends[why] ?? 0) + 1;
    };
    // When this connection's current run of failures began: another connection counts as still receiving only
    // when it got bytes after that (review: in an outage every lane saw the others' last bytes as recent).
    let streakAt = 0;
    // A refusal on this connection while others still receive and the address's expiry has not passed: this
    // connection leaves for the run (its segment is free for the others) instead of stopping them all; the run
    // stops on the refusal of the last one, as before (a link that expired for everyone). Deciding and leaving
    // are one step (conn.leave()).
    const retire = (asked: string, err: unknown): boolean => {
      // Another connection received bytes within MOVING_MS (not 'since this failure': a refusal is decided at once,
      // and at the end of a piece the others sit between answers). The last connection never retires (leave()), so
      // when every one is refused, the last reports it (Link expired).
      if (expiredAt(asked) || !conn.mayYield() || !this.othersMoving(conn.lane)) return false;
      conn.leave(err);
      this.diag.retired++;
      return true;
    };
    while (remaining(seg) > 0) {
      const before = seg.received;
      const asked = this.state.finalUrl;
      const began = Date.now();
      // A cut mark belongs to one answer: never to the next attempt (review: a stale mark swallowed an error).
      this.recut.delete(seg);
      try {
        if (this.state.etagUnstable || (this.state.dateUnstable && !this.ifRange())) await this.spotCheck(partPath, signal);
        await this.pull(seg, partPath, signal, conn.lane);
        this.recut.delete(seg);
        conn.accepted = true;
        ended('done');
        // An answer that brought bytes (a capped 206 included) ends any run of failures.
        if (seg.received > before) {
          failures = 0;
          retried = false;
        }
      } catch (err) {
        if (seg.received > before) {
          conn.accepted = true;
          retried = false;
        }
        if (signal.aborted) throw new AbortedError();
        // tick() cut a connection that went silent or ran far slower than the others: ask again at once, no
        // failure. Only for the cancel the cut itself caused: any other error is handled as such.
        const cut = this.recut.get(seg);
        this.recut.delete(seg);
        if (cut && err instanceof AbortedError) {
          ended(cut);
          this.diag.reconnectsAll++;
          failures = 0;
          continue;
        }
        ended(endOf(err));
        if (err instanceof DiskError || err instanceof RangeIgnoredError || err instanceof ChangedError) throw err;
        // Cut after it brought bytes (a reset, an interrupted or short body, the idle timeout): asked again at once,
        // as IDM does, no failure (it used to wait 2 s every time).
        const progressed = seg.received - before;
        if (progressed > 0 && isCut(err) && (progressed >= PROGRESS_MIN || Date.now() - began >= PROGRESS_MS)) {
          this.diag.reconnectsAll++;
          failures = 0;
          await sleep(PROGRESS_RETRY_MS, signal);
          continue;
        }
        failures = seg.received > before ? 1 : failures + 1;
        if (failures === 1) streakAt = Date.now();
        const next = await this.afterRefusal(err, asked, retried);
        if (next === 'stop') {
          if (retire(asked, err)) throw new ConnectionRefusedError();
          throw err;
        }
        if (next === 'renewed') {
          failures = Math.max(0, failures - 1);
          continue;
        }
        if (next === 'retry') retried = true;
        else {
          if (refusedConnection(err) && conn.mayYield() && (!conn.accepted || failures >= ATTEMPTS)) {
            conn.leave(err);
            throw new ConnectionRefusedError();
          }
          // Its attempts used up while another connection is still fetching and received bytes since this one's
          // failures began: it steps aside instead of stopping them all (runRanged()). Otherwise (an outage, the
          // last connection) the run stops and waits as before (G4).
          if (failures >= ATTEMPTS && (isRetryable(err) || err instanceof RangeMismatchError) && conn.mayYield() && this.othersMoving(conn.lane, streakAt)) throw new StepAsideError();
          // A refusal the renewal does not take (nothing saved yet, no renewal hook): as with 'stop' above.
          if ((err instanceof AddressRefusedError || err instanceof NotTheFileError) && !isRetryable(err) && retire(asked, err)) throw new ConnectionRefusedError();
          // The last connection: a server that asks for a long wait stops the run (net.ts serverStops()).
          if (failures >= ATTEMPTS || !(isRetryable(err) || err instanceof RangeMismatchError) || (!conn.mayYield() && stopsRun(err))) throw err;
        }
        await sleep(backoff(next === 'retry' ? 1 : failures, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  private async pull(seg: Segment, partPath: string, signal: AbortSignal, lane: number): Promise<void> {
    const from = seg.start + seg.received;
    const to = seg.end - 1;
    const extra: Record<string, string> = { Range: `bytes=${from}-${to}` };
    const validator = this.ifRange();
    if (validator) extra['If-Range'] = validator;
    const stat = this.lane(lane);
    stat.requests++;
    stat.connecting = true;
    let res: Response;
    try {
      res = await open(this.state.finalUrl, this.env.identity, extra, signal, { lane, gen: this.laneGen.get(lane) ?? 0 });
    } finally {
      stat.connecting = false;
    }
    stat.headMs = res.headMs;
    stat.protocol = res.protocol;
    this.sockets.add(res.socket);
    // R1: a whole answer that is a page (or JSON, XML, text) where the file was: the address expired.
    if (res.status === 200 && notFile(this.k, res.header('content-type'))) {
      res.destroy();
      throw new NotTheFileError(res.header('content-type'));
    }
    const whole = from === 0 && seg.end === this.state.total && this.state.segments.length === 1;
    if (res.status === 200 && !whole) {
      // A 200 to If-Range is the server saying the file changed; to a plain Range, that it won't range.
      // Headers only: download() lets the saved bytes decide (prove()).
      const err = validator ? headerChange('the site sent the whole file again', res, validator) : new RangeIgnoredError();
      res.destroy();
      throw err;
    }
    if (res.status !== 200 && res.status !== 206) throw await refusal(res, retryAfter(res));
    // Where the server's own answer ends: a 206 may cover less than asked (a host that caps each answer).
    let servedEnd = -1;
    try {
      if (validatorsDiffer(this.state, res.header('etag'), res.header('last-modified'))) throw headerChange('the site gives it another version tag', res);
      if (res.status === 206) {
        const cr = parseContentRange(res.header('content-range'));
        // An empty or inverted range (end < start) is a mismatch too (review: it looped with no failure).
        if (!cr || cr.start !== from || cr.end < cr.start || cr.end > to || (cr.total >= 0 && cr.total !== this.state.total)) throw new RangeMismatchError();
        servedEnd = cr.end + 1;
      }
    } catch (err) {
      res.destroy();
      throw err;
    }
    const flow: Flow = { res, lane, stat, bytes: 0, samples: [], heldSamples: [], heldLast: 0, firstByte: false };
    this.flows.set(seg, flow);
    try {
      await this.stream(res, seg, partPath, res.status === 206 ? to + 1 : -1, null, 0, servedEnd);
    } finally {
      if (this.flows.get(seg) === flow) this.flows.delete(seg);
      const held = res.held;
      this.diag.heldDiskMs += held.disk;
      this.diag.heldLimitMs += held.limit;
    }
  }

  /** Another connection received bytes within MOVING_MS, and after `since` when given. */
  private othersMoving(lane: number, since = 0): boolean {
    const now = Date.now();
    for (const [l, t] of this.moved) if (l !== lane && now - t < MOVING_MS && t > since) return true;
    return false;
  }

  /**
   * Every TICK_MS of a ranged run: a connection that ran far slower than the others for SLOW_TICKS ticks,
   * while they are busy, is cut and asked again at once (fetchSegment(): no failure, no wait): a server edge
   * or route that went slow is left for a new connection. (IDM 6.43 never replaces a crawling connection,
   * measured 2026-10-20; it only times out a silent one after 30 s.) Never under a
   * speed limit (it decides the speeds), never while the connection's writer waits for the disk.
   */
  private tick(): void {
    for (const f of this.flows.values()) {
      const held = f.res.held;
      const total = held.disk + held.limit;
      f.samples.push(f.bytes);
      f.heldSamples.push(total - f.heldLast);
      f.heldLast = total;
      f.bytes = 0;
      if (f.samples.length > SLOW_TICKS) {
        f.samples.shift();
        f.heldSamples.shift();
      }
    }
    // Each lane's bytes per tick across its answers: the reference speeds (review: per-answer samples went
    // blind on a host that caps each answer, and in the end game).
    for (const [lane, st] of this.laneStats) {
      const w = this.laneWin.get(lane) ?? [];
      w.push(st.bytes - (this.laneSeen.get(lane) ?? 0));
      this.laneSeen.set(lane, st.bytes);
      if (w.length > SLOW_TICKS) w.shift();
      this.laneWin.set(lane, w);
    }
    // While a speed limit holds the speed down it decides the speeds: nothing is judged, and the window starts
    // over once it lets go. A limit the line never reaches does not count (limiter.ts binding()).
    if (this.env.limiters.some((l) => l.binding(SLOW_TICKS * TICK_MS))) {
      for (const f of this.flows.values()) {
        f.samples = [];
        f.heldSamples = [];
      }
      this.laneWin.clear();
      this.busy = { median: 0, at: 0 };
      return;
    }
    const now = Date.now();
    const secs = (SLOW_TICKS * TICK_MS) / 1000;
    const median = (rates: number[]): number => {
      const r = [...rates].sort((a, b) => a - b);
      const mid = r.length / 2;
      return r.length % 2 ? r[Math.floor(mid)] : (r[mid - 1] + r[mid]) / 2;
    };
    // A lane's speed over a full window in which it received something (-1: no reference).
    const laneRate = (lane: number): number => {
      const w = this.laneWin.get(lane);
      return w && w.length >= SLOW_TICKS && w.some((b) => b > 0) ? w.reduce((a, b) => a + b, 0) / secs : -1;
    };
    const allRates = [...this.laneWin.keys()].map(laneRate).filter((r) => r >= 0);
    if (allRates.length >= 2) this.busy = { median: median(allRates), at: now };
    // The other lanes' median, or the last busy median for a lone answer.
    const others = (lane: number): number => {
      const r = [...this.laneWin.keys()].filter((l) => l !== lane).map(laneRate).filter((x) => x >= 0);
      if (r.length) return median(r);
      return now - this.busy.at < BUSY_MEMORY_MS ? this.busy.median : 0;
    };
    // Deer held this answer itself (the disk, the speed limit) for more than HELD_SHARE of a tick in the window.
    const held = (f: Flow, n: number): boolean => f.heldSamples.slice(-n).some((ms) => ms > TICK_MS * HELD_SHARE);
    const cut = (seg: Segment, f: Flow, why: string): void => {
      this.cutAt.set(f.lane, now);
      // A new partition: the next ask is a new connection even where HTTP/2 would reuse the session (review).
      this.laneGen.set(f.lane, (this.laneGen.get(f.lane) ?? 0) + 1);
      this.recut.set(seg, why);
      this.flows.delete(seg);
      this.reconnects++;
      f.res.destroy();
    };
    // Stall: no bytes for STALL_TICKS ticks after its first byte, while the others run at BUSY_RATE or more and
    // one of them received bytes in those ticks (the idle timeout takes 30 s). On a crawling line (TLS records
    // arriving seconds apart) silence is left to the idle timeout (review).
    for (const [seg, f] of [...this.flows]) {
      if (!f.firstByte || f.samples.length < STALL_TICKS || f.samples.slice(-STALL_TICKS).some((b) => b > 0) || held(f, STALL_TICKS)) continue;
      if (now - (this.cutAt.get(f.lane) ?? 0) < RECUT_GAP || others(f.lane) < BUSY_RATE) continue;
      if (![...this.laneWin].some(([l, w]) => l !== f.lane && w.slice(-STALL_TICKS).some((b) => b > 0))) continue;
      cut(seg, f, 'stall');
    }
    // Slow: far below the others' median while they are busy.
    const rate = (f: Flow): number => f.samples.reduce((a, b) => a + b, 0) / secs;
    // Only ticks since the body began count (samples restart at the first byte): the wait before it is the
    // idle timeout's, as for a stall (review: a late body was cut as slow).
    for (const [seg, f] of [...this.flows]) {
      if (!f.firstByte || f.samples.length < SLOW_TICKS || held(f, SLOW_TICKS)) continue;
      const median = others(f.lane);
      if (median < BUSY_RATE || rate(f) >= Math.max(SLOW_FLOOR, SLOW_SHARE * median)) continue;
      // Worth a new connection: what is left takes long at this speed, and far longer than at the others'.
      const left = remaining(seg);
      const own = left / Math.max(1, rate(f));
      if (left < RECUT_MIN || own < RECUT_SECS || own < (2 * left) / median || now - (this.cutAt.get(f.lane) ?? 0) < RECUT_GAP) continue;
      if ((this.writers.get(seg)?.backlog ?? 0) > BACKLOG_LOW) continue;
      cut(seg, f, 'slow');
    }
  }

  /**
   * Write the body at the segment's place, stopping at its end (which a split may have moved).
   * `tap` sees the first `tapBytes` bytes (read into JS for it, then written) and may throw to stop.
   */
  private async stream(res: Response, seg: Segment, partPath: string, askedEnd = -1, tap: ((bytes: Uint8Array) => void) | null = null, tapBytes = 0, servedEnd = -1): Promise<void> {
    const base = seg.received;
    let writer: Writer;
    const opening = Date.now();
    try {
      writer = new Writer(partPath, seg.start + seg.received);
    } catch (err) {
      res.destroy();
      throw err;
    }
    this.diag.writerOpenMaxMs = Math.max(this.diag.writerOpenMaxMs, Date.now() - opening);
    this.writers.set(seg, writer);
    this.live++;
    this.peakLive = Math.max(this.peakLive, this.live);
    let failure: unknown = null;
    let tapped = 0;
    try {
      await res.stream((input, count) => {
        const room = seg.end < 0 ? count : seg.end - seg.start - seg.received;
        if (room <= 0) return STOP;
        const n = Math.min(count, room);
        let rest = n;
        if (tap && tapped < tapBytes) {
          const k = Math.min(rest, tapBytes - tapped);
          const bytes = new Uint8Array(NetUtil.readInputStream(input, k));
          tap(bytes);
          writer.writeBytes(bytes);
          tapped += k;
          rest -= k;
        }
        if (rest > 0) writer.write(input, rest);
        seg.received += n;
        this.sinceSpot += n;
        this.env.onBytes(n);
        const flow = this.flows.get(seg);
        if (flow) {
          const now = Date.now();
          if (!flow.firstByte) {
            flow.firstByte = true;
            flow.samples = [];
            flow.heldSamples = [];
          }
          flow.bytes += n;
          flow.stat.bytes += n;
          flow.stat.lastData = now;
          this.moved.set(flow.lane, now);
        }
        // A fast transfer has its blocks hashed while it runs, not all at its end (4.1); a very fast one has
        // its hashing wait instead (ledger.ts HOLD_ABOVE: took() measures how fast it goes).
        if (this.ledger && (this.sinceHash += n) >= HASH_EVERY) {
          this.ledger.took(this.sinceHash);
          this.sinceHash = 0;
        }
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
      // The answer has ended: tick() must no longer judge (or cut) it while its writer drains (review).
      if (this.flows.get(seg)?.res === res) this.flows.delete(seg);
      // Nobody may trust seg.received until the writer has put every byte in the file.
      try {
        await writer.close();
      } catch (err) {
        // The disk refused a write: keep what certainly reached the file, refetch the rest.
        seg.received = base + Math.min(seg.received - base, writer.durable);
        // RESUME-DESIGN.md 4.2: the block holding the failed write is suspect: the claim stops at its start.
        if (this.ledger) {
          const bs = this.ledger.bs;
          seg.received = Math.max(0, Math.min(seg.received, Math.floor((seg.start + seg.received) / bs) * bs - seg.start));
        }
        failure = err;
      }
      this.writers.delete(seg);
      // What newly lies wholly under the certain bytes is hashed (4.1).
      this.ledger?.pump();
    }
    if (failure) throw failure;
    if (seg.end >= 0 && remaining(seg) > 0) {
      // A 206 that ended cleanly at its own Content-Range end, short of what was asked (a host that caps each
      // answer): no failure, fetchSegment() asks for the rest next.
      if (servedEnd > 0 && seg.received > base && seg.start + seg.received === servedEnd) return;
      throw new ShortBodyError();
    }
  }

  /**
   * No ranges: one stream from the start. With nothing saved it goes straight into the .part, and a
   * failed attempt starts it again there, as before. With bytes saved before this run (a resume, a
   * server that stopped ranging) the new answer goes to "<part>.new" (replaceSingle), so the saved
   * bytes are never lost or mixed; a refused address then goes to the renewal hook (afterRefusal()).
   */
  private async runSingle(partPath: string, signal: AbortSignal): Promise<void> {
    const kept = this.saved > 0;
    let retried = false;
    for (let attempt = 1; ; attempt++) {
      const asked = this.state.finalUrl;
      try {
        let res = this.pending;
        this.pending = null;
        if (kept) {
          await this.replaceSingle(partPath, res, signal);
          return;
        }
        const s = this.state;
        const seg: Segment = { start: 0, end: s.total >= 0 ? s.total : -1, received: 0 };
        s.segments = [seg];
        if (!res) res = await this.openWhole(signal);
        // Nothing in the .part is claimed: it starts empty.
        setSize(partPath, 0, { truncate: true });
        await this.stream(res, seg, partPath);
        if (seg.end < 0) {
          seg.end = seg.received;
          this.state.total = seg.received;
        }
        return;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        const next = kept ? await this.afterRefusal(err, asked, retried) : null;
        if (next === 'stop') throw err;
        if (next === 'renewed') {
          attempt--;
          continue;
        }
        if (next === 'retry') retried = true;
        else if (attempt >= ATTEMPTS || !isRetryable(err) || stopsRun(err)) throw err;
        await sleep(backoff(next === 'retry' ? 1 : attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** The whole file, without Range. */
  private async openWhole(signal: AbortSignal): Promise<Response> {
    const res = await open(this.state.finalUrl, this.env.identity, {}, signal, { lane: 0 });
    if (res.status !== 200) throw await refusal(res, retryAfter(res));
    return res;
  }

  /**
   * RESUME-DESIGN.md 3 G3 (Phase 1): a new single-stream answer while the .part holds saved bytes is
   * written to "<part>.new". Its first bytes must equal the saved ones (up to WINDOW), it must be
   * the same length (the stored total, kept by learn() when the probe's answer did not say), and only
   * then, complete, it replaces the .part and its validators and checksum become the download's. A
   * page where the file was is NotTheFileError; different bytes are ChangedError. Either way the .part
   * is untouched.
   */
  private async replaceSingle(partPath: string, pending: Response | null, signal: AbortSignal): Promise<void> {
    const s = this.state;
    const next = `${partPath}.new`;
    const first = s.segments[0];
    const want = first && first.start === 0 ? Math.min(first.received, WINDOW) : 0;
    let res = pending;
    try {
      let saved: Uint8Array = new Uint8Array(0);
      if (want > 0) {
        try {
          saved = await IOUtils.read(partPath, { maxBytes: want });
        } catch {
          throw new DiskError(Cr.NS_ERROR_FILE_NOT_FOUND);
        }
      }
      if (!res) res = await this.openWhole(signal);
      const type = res.header('content-type');
      if (notFile(this.k, type)) throw new NotTheFileError(type);
      const total = totalOf(res);
      if (total >= 0 && s.total >= 0 && total !== s.total) throw new ChangedError(`was ${sizeText(s.total)}, now ${sizeText(total)}`);
      // What the answer says about itself, kept for when it has replaced the saved bytes.
      const said = { etag: res.header('etag'), lastModified: res.header('last-modified'), digest: digestOf(res) };
      setSize(next, 0, { truncate: true });
      const seg: Segment = { start: 0, end: total, received: 0 };
      this.shadow = seg;
      let at = 0;
      const compare = (bytes: Uint8Array): void => {
        // A page where saved bytes that are not one were: the address expired (R1), not a new file.
        if (at === 0 && textStart(bytes) && !textStart(saved)) throw new NotTheFileError(type);
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== saved[at + i]) throw new ChangedError('its first bytes are different');
        at += bytes.length;
      };
      const body = res;
      res = null;
      await this.stream(body, seg, next, -1, saved.length ? compare : null, saved.length);
      if (at < saved.length) throw new ChangedError(`it is shorter than the ${sizeText(saved.length)} saved`);
      if (seg.end < 0) seg.end = seg.received;
      if (s.total >= 0 && seg.end !== s.total) throw new ChangedError(`was ${sizeText(s.total)}, now ${sizeText(seg.end)}`);
      try {
        await IOUtils.move(next, partPath);
      } catch {
        throw new DiskError(Cr.NS_ERROR_FILE_ACCESS_DENIED);
      }
      s.segments = [seg];
      // Its record described the bytes this answer replaced: they are hashed again from the new ones.
      this.ledger?.forget('replaced');
      s.total = seg.end;
      s.etag = said.etag;
      s.lastModified = said.lastModified;
      s.digest = said.digest;
      this.shadow = null;
    } catch (err) {
      res?.destroy();
      this.shadow = null;
      await IOUtils.remove(next, { ignoreAbsent: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Every byte landed, the file is the promised length, and it matches any checksum the server gave.
   * 'again': a checksum that did not match found bad blocks in the .part, released to be fetched again
   * (RESUME-DESIGN.md 4.3).
   */
  private async verify(partPath: string, signal: AbortSignal): Promise<'ok' | 'again'> {
    const s = this.state;
    // Every segment complete and together the whole file: a stretch that never arrived (zeros under a
    // file sized to its total) is never completed, whatever the file's size says (review of Phase 1).
    if (s.segments.some((seg) => seg.end < 0 || seg.start + seg.received !== seg.end) || (s.total >= 0 && this.saved !== s.total)) {
      throw new DownloadError('Some parts of the file didn’t arrive.');
    }
    if (s.total >= 0) {
      const size = await sizeOf(partPath);
      if (size !== s.total) throw new DownloadError(`The finished file is ${size} bytes; the server promised ${s.total}.`);
    }
    if (s.digest) {
      // md5 through nsICryptoHash: IOUtils.computeHexDigest is not known to take it (RESUME-DESIGN.md 1).
      const alg = s.digest.alg;
      const digest = (): Promise<string> => (alg === 'md5' ? md5Hex(partPath) : IOUtils.computeHexDigest(partPath, alg));
      const want = base64ToHex(s.digest.value);
      let hex = await digest();
      if (hex !== want && this.ledger && s.ranges && this.digestRounds++ < 1) {
        // RESUME-DESIGN.md 4.3: the blocks are checked against the record first; bad ones are fetched again.
        // The finish does not wait for the hashing (download()): what is still unhashed is hashed now.
        await untilAborted(this.ledger.drain(), signal);
        if (this.ledger.mismatch) throw this.ledger.mismatch;
        const bad = await this.ledger.verify(partPath, [...this.ledger.blocks.keys()]);
        if (bad.length) {
          s.segments = this.ledger.release(s.segments, bad, 'checksum');
          return 'again';
        }
        // Every block matches its record: the network delivered wrong bytes. Proven, then compared with
        // the server block by block, and replaced where it differs.
        if ((await this.fromServer(partPath, signal)) > 0) hex = await digest();
      }
      if (hex !== want) {
        // The bytes are known bad: a Retry starts over (and may empty the .part), and their block hashes
        // go with them (review of Phase 5: kept, they made the new bytes read as damaged or changed).
        s.segments = [];
        s.allowFresh = true;
        this.ledger?.forget('checksum');
        throw new ChecksumError();
      }
      if (alg === 'sha256') this.sha256 = hex;
    }
    return 'ok';
  }

  /**
   * The completion check (RESUME-DESIGN.md 2.5, Phase 5): with no strong validator (no ETag, a weak one, or one
   * that did not hold: If-Range could not keep another version out) and no server checksum, the file is
   * compared with the site before it counts as complete: the first block of each third of the file (where a
   * plan of 3 segments starts) and the last block, one 64 KiB window each, against their recorded head
   * hashes (or the saved bytes). Another file stops it (ChangedError: File changed, nothing renamed).
   * Review of Phase 5: anything else is "not compared" and the file completes as it did before Phase 5: a
   * window that can't be compared, an address that refuses (a link valid for one download, or one that
   * expired with the last byte), a page, the network gone. Each window is asked once: an address that
   * refuses is not asked again for a check that can only stop the download.
   */
  private async completionCheck(partPath: string, signal: AbortSignal): Promise<void> {
    const s = this.state;
    const strong = !!s.etag && !s.etag.startsWith('W/') && !s.etagUnstable;
    if (strong || s.digest || !s.ranges || !(s.total > 0)) return;
    const bs = blockSize(s.total);
    const last = Math.floor((s.total - 1) / bs);
    const blocks = [...new Set([0, Math.floor(s.total / 3 / bs), Math.floor((2 * s.total) / 3 / bs), last])];
    const wins = blocks.map((b): [number, number] => [b * bs, Math.min(s.total, b * bs + Math.min(WINDOW, bs))]);
    let r: Awaited<ReturnType<typeof compareWindows>>;
    try {
      r = await compareWindows(this.proofCtx(), s.finalUrl, wins, partPath, signal, s.total, 1);
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      return;
    }
    if (r.verdict === 'whole') r.res.destroy();
    else if (r.verdict === 'same') r.res?.destroy();
    if (r.verdict === 'changed') throw r.err;
  }

  /**
   * RESUME-DESIGN.md 4.3, a server checksum that does not match while every block matches its record: the
   * windows are proven first (another file stops it: ChangedError), then each block is asked for with
   * If-Range, compared in memory with its record and written in place only where it differs (its new hash
   * recorded). Returns how many blocks were replaced.
   */
  private async fromServer(partPath: string, signal: AbortSignal): Promise<number> {
    const l = this.ledger;
    const s = this.state;
    if (!l) return 0;
    const wins = windows(this.provable(), this.env.seed ?? s.url, l);
    const proof = await compareWindows(this.proofCtx(), s.finalUrl, wins, partPath, signal, s.total);
    if (proof.verdict === 'changed') throw proof.err;
    if (proof.verdict === 'whole') proof.res.destroy();
    else if (proof.verdict === 'same') proof.res?.destroy();
    if (proof.verdict !== 'same') return 0;
    let fixed = 0;
    for (let b = 0; b < l.count(); b++) {
      const [a, e] = l.span(b);
      const bytes = await fetchRange(this.proofCtx(), s.finalUrl, a, e, signal, this.ifRange());
      const got = await hashBytes(bytes);
      if (got.h === l.blocks.get(b)?.h) continue;
      await writeAt(partPath, a, bytes);
      l.put(b, { h: got.h, w: got.w, a: Date.now() });
      fixed++;
    }
    this.fixedFromServer += fixed;
    return fixed;
  }
}

/**
 * `work` (the block hashing draining, which can't be stopped) awaited until it is done or `signal` aborts:
 * Pause and Cancel never wait for it (review of Phase 5). AbortedError when aborted.
 */
export function untilAborted(work: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise((resolve, reject) => {
    const stop = (): void => reject(new AbortedError());
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      () => {
        signal.removeEventListener('abort', stop);
        resolve();
      },
      (err: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(err);
      }
    );
  });
}

function base64ToHex(b64: string): string {
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

/** MD5 of a file, hex, read in 4 MiB pieces (as reputation.ts hashes SHA-256). */
async function md5Hex(path: string): Promise<string> {
  const CHUNK = 4 * 1024 * 1024;
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.MD5);
  for (let at = 0; ; at += CHUNK) {
    const buf: Uint8Array = await IOUtils.read(path, { offset: at, maxBytes: CHUNK });
    if (!buf.length) break;
    const s = Cc['@mozilla.org/io/arraybuffer-input-stream;1'].createInstance(Ci.nsIArrayBufferInputStream);
    s.setData(buf.buffer, buf.byteOffset, buf.length);
    hash.updateFromStream(s, buf.length);
    if (buf.length < CHUNK) break;
  }
  const raw: string = hash.finish(false);
  return Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/** How full each of `n` equal stretches of the file is (the connection bar). */
export function fileFills(s: FileState, n = 8): number[] {
  if (s.total <= 0) return [];
  const block = s.total / n;
  const out = new Array<number>(n).fill(0);
  for (const seg of s.segments) {
    let a = seg.start;
    // Never past the file's end: a record claiming more bytes than its total looped here forever (review of Phase 1).
    const b = Math.min(s.total, seg.start + seg.received);
    while (a < b) {
      const i = Math.min(n - 1, Math.floor(a / block));
      const edge = Math.min(b, (i + 1) * block);
      if (edge <= a) break;
      out[i] += edge - a;
      a = edge;
    }
  }
  return out.map((v) => Math.min(1, v / block));
}

/**
 * Sparse ranged downloads still writing, with the bytes each has left (openPart(); gone when download() ends):
 * a sparse .part holds no room ahead of its writes.
 */
const filling = new Map<FileTransfer, { dir: string; path: string; total: number; written: () => number }>();

function written(s: FileState): number {
  return s.segments.reduce((n, seg) => n + seg.received, 0);
}

/** The drive letter or \\server\share of a path (also behind \\?\ and \\?\UNC\). */
function volumeOf(path: string): string {
  const m = /^(?:\\\\\?\\)?([A-Za-z]:)|^(?:\\\\\?\\UNC\\|\\\\)([^\\]+\\[^\\]+)/i.exec(path);
  return (m?.[1] ?? (m?.[2] ? `\\\\${m[2]}` : path)).toLowerCase();
}

/**
 * The room the other sparse downloads on `dir`'s disk still need: what each .part does not hold yet (the free
 * space already leaves out what it holds, review), or what it has left to write when the disk can't tell.
 */
async function stillNeeded(self: FileTransfer, dir: string): Promise<number> {
  const vol = volumeOf(dir);
  let n = 0;
  for (const [t, f] of [...filling]) {
    if (t === self || volumeOf(f.dir) !== vol) continue;
    const h = await heldBytes(f.path);
    n += Math.max(0, f.total - (h >= 0 ? h : f.written()));
  }
  return n;
}

/** A sparse .part or a single stream holds no room ahead of its writes: without this check a download on a full disk dies at 100%. */
export function ensureRoom(dir: string, bytes: number): void {
  if (bytes <= 0) return;
  const free = freeSpace(dir);
  const margin = 16 * 1024 * 1024;
  if (free < bytes + margin) {
    const short = bytes + margin - free;
    throw new DownloadError(`Not enough space on the disk. ${short / 1024 ** 3 >= 1 ? `${(short / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(short / 1024 ** 2)} MB`} more is needed.`);
  }
}

/** Room for `bytes` more in `dir`, with ensureRoom's margin (Start over decides whether the old part may stay). */
export function hasRoom(dir: string, bytes: number): boolean {
  return bytes <= 0 || freeSpace(dir) >= bytes + 16 * 1024 * 1024;
}
