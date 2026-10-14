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
import { NetUtil } from 'resource://gre/modules/NetUtil.sys.mjs';
import { expiredAt, expiresAt } from './expiry';
import { throttle, type RateLimiter } from './limiter';
import { nameFromDisposition } from './naming';
import {
  AbortedError, AddressRefusedError, ChangedError, ChecksumError, ConnectionRefusedError, DiskError, DownloadError, HttpStatusError, NotTheFileError,
  REFUSED_STATUS, RETRYABLE_STATUS, Response, ShortBodyError, backoff, isRetryable, open, parseContentRange, refusal, refusedConnection,
  retryAfter, serverStops, sleep, stopsRun, textStart, textual, type Identity,
} from './net';
import { IN_FLIGHT, Writer, freeSpace, readAt, setSize, sizeOf } from './partfile';
import {
  ASK_ABOVE, UNSURE, WINDOW, compareWindows, differs, digestOf, enough, headerChange, judge, notFile, readKind, sizeText, totalOf, validatorsDiffer,
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

class RangeIgnoredError extends Error {}
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
      return { start: seg.start, end: seg.end, received: w ? Math.max(0, seg.received - w.backlog - IN_FLIGHT) : seg.received };
    });
  }

  /** What a proof of this download reads (proof.ts): the record, its identity, its kind, the saved bytes. */
  proofCtx(): ProofCtx {
    return { state: this.state, identity: this.env.identity, kind: this.k, saved: this.saved, sockets: this.sockets };
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
        else if (next === 'stop' || attempt >= ATTEMPTS || !RETRYABLE_STATUS.has(res.status)) throw err;
        await sleep(backoff(next === 'retry' ? 1 : attempt, wait) * 1000, signal);
        continue;
      }
      if (attempt >= ATTEMPTS || !RETRYABLE_STATUS.has(res.status) || serverStops(res.status, wait, this.waitTry)) throw await refusal(res, wait);
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
    const ours = await readAt(partPath, 0, n);
    if (theirs.length < n || !ours || ours.length < n) return false;
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
    const planned = windows(segs, this.env.seed ?? s.url);
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
    const wins = windows(this.provable(), this.env.seed ?? this.state.url);
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
    Object.assign(s, { silent: log, restarts: (s.restarts || 0) + 1, probed: false, segments: [], etag: '', lastModified: '', digest: null, contentType: '', typeGuessed: false, dispositionName: '', allowFresh: true });
    this.k = { kind: '', sure: false };
    return true;
  }

  private connections(): number {
    return this.state.total >= MIN_SPLIT ? Math.max(1, Math.min(32, this.env.connections())) : 1;
  }

  private plan(): void {
    const s = this.state;
    if (s.segments.length) return;
    if (s.ranges && s.total > 0) {
      const size = Math.ceil(s.total / this.connections());
      for (let start = 0; start < s.total; start += size) s.segments.push({ start, end: Math.min(s.total, start + size), received: 0 });
    } else {
      s.segments = [{ start: 0, end: s.total >= 0 ? s.total : -1, received: 0 }];
    }
  }

  /** Download into `partPath` until every byte has landed and checks out. */
  async download(partPath: string, signal: AbortSignal): Promise<void> {
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
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
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
      await this.verify(partPath);
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
    // A single stream with saved bytes writes the whole new answer next to them ("<part>.new").
    const needed = s.total <= 0 ? 0 : !s.ranges && !fresh ? s.total : s.total - Math.max(0, fresh ? 0 : size);
    ensureRoom(PathUtils.parent(partPath) ?? partPath, needed);
    if (s.ranges && s.total > 0) {
      if (size !== s.total || empty) setSize(partPath, s.total, { truncate: empty });
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
    // Connections still taking segments; a refused one may step aside only while another remains.
    let alive = n;
    const worker = async (lane: number): Promise<void> => {
      const conn = { accepted: false, mayYield: () => alive > 1, lane };
      try {
        for (;;) {
          if (fatal !== null || stop.signal.aborted) return;
          const seg = this.claim(owned);
          if (!seg) return;
          owned.add(seg);
          try {
            await this.fetchSegment(seg, partPath, stop.signal, conn);
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
      await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));
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
  private async fetchSegment(seg: Segment, partPath: string, signal: AbortSignal, conn: { accepted: boolean; mayYield: () => boolean; lane: number }): Promise<void> {
    let failures = 0;
    let retried = false;
    while (remaining(seg) > 0) {
      const before = seg.received;
      const asked = this.state.finalUrl;
      try {
        if (this.state.etagUnstable || (this.state.dateUnstable && !this.ifRange())) await this.spotCheck(partPath, signal);
        await this.pull(seg, partPath, signal, conn.lane);
        conn.accepted = true;
      } catch (err) {
        if (seg.received > before) {
          conn.accepted = true;
          retried = false;
        }
        if (signal.aborted) throw new AbortedError();
        if (err instanceof DiskError || err instanceof RangeIgnoredError || err instanceof ChangedError) throw err;
        failures = seg.received > before ? 1 : failures + 1;
        const next = await this.afterRefusal(err, asked, retried);
        if (next === 'stop') throw err;
        if (next === 'renewed') {
          failures = Math.max(0, failures - 1);
          continue;
        }
        if (next === 'retry') retried = true;
        else {
          if (refusedConnection(err) && conn.mayYield() && (!conn.accepted || failures >= ATTEMPTS)) throw new ConnectionRefusedError();
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
    const res = await open(this.state.finalUrl, this.env.identity, extra, signal, { lane });
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
    try {
      if (validatorsDiffer(this.state, res.header('etag'), res.header('last-modified'))) throw headerChange('the site gives it another version tag', res);
      if (res.status === 206) {
        const cr = parseContentRange(res.header('content-range'));
        if (!cr || cr.start !== from || cr.end > to || (cr.total >= 0 && cr.total !== this.state.total)) throw new RangeMismatchError();
      }
    } catch (err) {
      res.destroy();
      throw err;
    }
    await this.stream(res, seg, partPath, res.status === 206 ? to + 1 : -1);
  }

  /**
   * Write the body at the segment's place, stopping at its end (which a split may have moved).
   * `tap` sees the first `tapBytes` bytes (read into JS for it, then written) and may throw to stop.
   */
  private async stream(res: Response, seg: Segment, partPath: string, askedEnd = -1, tap: ((bytes: Uint8Array) => void) | null = null, tapBytes = 0): Promise<void> {
    const base = seg.received;
    let writer: Writer;
    try {
      writer = new Writer(partPath, seg.start + seg.received);
    } catch (err) {
      res.destroy();
      throw err;
    }
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
        // The disk refused a write: keep what certainly reached the file, refetch the rest.
        seg.received = base + Math.min(seg.received - base, writer.durable);
        failure = err;
      }
      this.writers.delete(seg);
    }
    if (failure) throw failure;
    if (seg.end >= 0 && remaining(seg) > 0) throw new ShortBodyError();
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

  /** Every byte landed, the file is the promised length, and it matches any checksum the server gave. */
  private async verify(partPath: string): Promise<void> {
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
      const hex = s.digest.alg === 'md5' ? await md5Hex(partPath) : await IOUtils.computeHexDigest(partPath, s.digest.alg);
      if (hex !== base64ToHex(s.digest.value)) {
        // The bytes are known bad: a Retry starts over (and may empty the .part).
        s.segments = [];
        s.allowFresh = true;
        throw new ChecksumError();
      }
    }
  }
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

/** Sizing a file reserves no blocks: without this a download on a full disk dies at 100%. */
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
