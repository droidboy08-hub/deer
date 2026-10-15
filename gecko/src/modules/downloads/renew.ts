// Renewing an address that stopped working (spikes/downloader/RESUME-DESIGN.md 3.0 and G1; Phase 2:
// the original address, the in-run hook and the attempt schedule). A signed or redirected address
// expires: the address the download came from (rec.url, file.url) and every redirect hop recorded on
// the way to its final address (FileState.chain) are asked again without If-Range, Necko follows their
// redirects to a fresh final address, and proof.ts proveAddress() decides whether that answer is the
// same file. Only then is it adopted (finalUrl, validators, chain; the old address goes to
// address.history). The segments and the .part are never touched, so the download carries on where
// it was, under the same name.
//
//   - Gate, the in-run hook behind TransferEnv.renew(why): single-flight per download (every
//     connection that hit the dead address waits for the same attempt, so the original address is
//     asked once), at most one attempt per 10 s and 3 per run (as hls.ts refreshed() limits itself).
//     A failure is remembered for 30 s per download (REF HLSDownload.swift:881-889); the engine keeps
//     that, across runs.
//   - Attempts outside a run (VitreDownloads episode()): the run's own at the failure, then 2 min,
//     15 min, 1 h and 6 h after it; after that only a manual action starts one (Phase 4 adds wake and
//     network link-up). The count is rec.wait.tries, saved with the row, so it survives restarts.
// Nothing here waits for the network (Phase 4) or reads a master playlist (Phase 6); the source page opened
// out of sight is pagestep.ts (Phase 7).
import { expiredAt, expiresAt } from './expiry';
import { proveAddress, type Found, type ProofCtx } from './proof';
import type { FileState, Segment } from './ranged';
import type { IdentityJSON } from './types';

/** Why a renewal was asked for: the address's expiry time passed, it refused (401, 403, 404, 410...), or it answers with something else. */
export type RenewWhy = 'expired' | 'refused' | 'not-file';

/** A new address proven to give the same file, already adopted into the download's state (TransferEnv.renew). */
export interface Renewed {
  url: string;
  finalUrl: string;
  identity?: IdentityJSON;
  validators: { etag: string; lastModified: string };
}

/** The original-address step's verdict: the first address that gives the file decides; 'failed' when none did. */
export type Outcome =
  | { verdict: 'same'; found: Found }
  | { verdict: 'changed'; found: Found; evidence: string }
  | { verdict: 'unknown'; found: Found }
  | { verdict: 'failed'; status: number };

/** What a proof needs of a download: its record, its .part and the bytes certainly in it. */
export interface Subject {
  ctx: ProofCtx;
  partPath: string;
  segments: Segment[];
  /** The download's id: places its seeded window (RESUME-DESIGN.md 2.5). */
  seed: string;
}

const MINUTE = 60 * 1000;
/**
 * The waits between automatic attempts outside a run, by attempt number (RESUME-DESIGN.md 3.0, the
 * owner's decision 8): the run's own attempt at the failure is number 0, then 2 min, 13 min, 45 min and
 * 5 h, so they come 2 min, 15 min, 1 h and 6 h after the failure.
 */
export const SCHEDULE = [0, 2 * MINUTE, 13 * MINUTE, 45 * MINUTE, 300 * MINUTE];
/** At most one in-run attempt per this long, and at most PER_RUN per run. */
const GAP = 10 * 1000;
const PER_RUN = 3;
/** A failed attempt is not repeated within this long (per download). */
export const FORGET_FAILURE = 30 * 1000;
/** Old addresses kept in address.history (RESUME-DESIGN.md 5.2). */
const HISTORY = 5;
/** Redirect hops kept (5.2). */
const CHAIN = 8;

/** When attempt number `tries` is due, made `now`; 0 when no more are automatic. */
export function nextTry(tries: number, now = Date.now()): number {
  return tries > 0 && tries < SCHEDULE.length ? now + SCHEDULE[tries] : 0;
}

/**
 * The addresses the original-address step asks (G1 step 1), original first: the download's own
 * address and every redirect hop recorded on the way to its final one. Never `failing` (the request
 * that just failed was the attempt at it), nor an address whose expiry time has passed (so a download
 * whose own address is the expired signed one has nothing to ask).
 */
export function addresses(recUrl: string, s: FileState, failing: string, now = Date.now()): string[] {
  const out: string[] = [];
  for (const u of [s.url, recUrl, ...(s.chain ?? [])]) {
    if (!u || out.includes(u) || u === failing || !/^https?:\/\//i.test(u) || expiredAt(u, now)) continue;
    out.push(u);
  }
  return out;
}

/**
 * G1 step 1: each address in turn through the proof (proveAddress()). The first that gives the file
 * decides: SAME is adopted by the caller, CHANGED (the real file, another version) and UNKNOWN (R7) go
 * to the person's choice (3 G3). Refused ones, pages and unreachable ones lead to the next; 'failed'
 * (with the last refusal's status) when none gave the file.
 */
export async function originalAddress(sub: Subject, list: string[], signal: AbortSignal): Promise<Outcome> {
  let status = 0;
  for (const url of list) {
    const c = await proveAddress(sub.ctx, sub.partPath, sub.segments, sub.seed, url, signal);
    if (c.verdict === 'same' || c.verdict === 'changed' || c.verdict === 'unknown') return c;
    status = status || c.status;
  }
  return { verdict: 'failed', status };
}

/**
 * How an address became the download's: 'original' (renewed from its original address), 'pasted' (Use
 * another address…), 'page' (started again on its page: a click, Alt+click, the 'downloads' service;
 * Phase 3), 'link' (started again from an address with no page: Add link, Download copied link),
 * 'background' (found on its page opened out of sight: the page step, RESUME-DESIGN.md G1 step 3, Phase 7;
 * an automatic attempt, which the schedule counts like 'original').
 */
export type AttachHow = 'original' | 'pasted' | 'page' | 'link' | 'background';

/**
 * A proven address becomes the download's (RESUME-DESIGN.md 5.2 address, G1 attach): the one it
 * replaces goes to address.history (at most 5); finalUrl, validators and the redirect hops are the new
 * answer's, and an address that came from the person (pasted, or started again: Phase 3) becomes
 * file.url too. Segments, total and the .part stay as they are.
 */
export function adopt(s: FileState, found: Found, how: AttachHow, now = Date.now()): void {
  const prev = s.address ?? { obtainedAt: 0, expiresAt: 0, how: 'first', history: [] };
  const history = [{ url: s.url, finalUrl: s.finalUrl, at: prev.obtainedAt, how: prev.how }, ...prev.history].slice(0, HISTORY);
  if (how !== 'original') s.url = found.url;
  s.finalUrl = found.finalUrl;
  s.chain = found.chain.slice(0, CHAIN);
  s.etag = found.etag;
  s.lastModified = found.lastModified;
  if (found.digest) s.digest = found.digest;
  s.address = { obtainedAt: now, expiresAt: expiresAt(found.finalUrl, now), how, history };
}

/**
 * The in-run hook's limits (RESUME-DESIGN.md 3.0, in-run renewal), one per run: concurrent callers
 * share one attempt; within GAP of the last attempt they get its result again (adopted already, so a
 * connection that failed at the old address carries on at the new one); after PER_RUN, null.
 */
export class Gate {
  private flight: Promise<Renewed | null> | null = null;
  private count = 0;
  private lastAt = 0;
  private last: Renewed | null = null;

  run(step: () => Promise<Renewed | null>): Promise<Renewed | null> {
    if (this.flight) return this.flight;
    const now = Date.now();
    if (this.lastAt && now - this.lastAt < GAP) return Promise.resolve(this.last);
    if (this.count >= PER_RUN) return Promise.resolve(null);
    this.count++;
    this.lastAt = now;
    const flight = step().then((r) => {
      this.last = r;
      return r;
    });
    this.flight = flight;
    const done = (): void => {
      if (this.flight === flight) this.flight = null;
    };
    flight.then(done, done);
    return flight;
  }
}
