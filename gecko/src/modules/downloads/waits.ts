// Waits Deer comes back from by itself (spikes/downloader/RESUME-DESIGN.md G4, Phase 4): lost
// network, a server in trouble, the computer's sleep, and what a quit or a crash left unfinished.
// The engine (VitreDownloads stopped(), armWaits()) keeps a waiting row paused with rec.wait:
//   - 'network': the address could not be reached (classify() 'offline' or 'timeout': UNKNOWN_HOST,
//     OFFLINE, NET_TIMEOUT, NET_RESET, CONNECTION_REFUSED, NET_INTERRUPT, NET_PARTIAL_TRANSFER, a proxy
//     that can't be reached, a body cut short once a segment's attempts are used up; any other Necko
//     failure fails as before). Tried again 10 s, 30 s, 1 min, 2 min and 5 min after each failure, then
//     every 10 min; it never fails on its own. Network link-up or wake brings the next try to SOON;
//   - 'server': 5xx or 429, on the same schedule, never before the server's Retry-After, and failed
//     with today's sentence once the server has kept failing for SERVER_GIVE_UP since the wait's first
//     5xx or 429 (wait.serverSince);
//   - 'sleep': the computer went to sleep while it ran; it queues again once the network is back
//     after the wake, or WAKE_SETTLE after it.
// The count (wait.tries) goes on across the runs the wait starts, network and server failures alike
// (review of Phase 4), and starts again once a run made FRESH_AFTER of progress, as ranged.ts gives a
// connection a fresh budget once it made progress, or on the person's Try now.
import type { Segment } from './ranged';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The waits after failure number 1, 2, 3... of a network or server wait (G4); after them, every NET_EVERY. */
export const NET_SCHEDULE = [10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE];
export const NET_EVERY = 10 * MINUTE;
/** Network link-up or wake brings the next try of a network wait this close (G4). */
export const SOON = 5 * SECOND;
/** A server that keeps failing (5xx, 429) this long ends the download with today's sentence (G4, the owner's decision 8). */
export const SERVER_GIVE_UP = 24 * 60 * MINUTE;
/** A run that saved this much more starts its wait's count again (G4). */
export const FRESH_AFTER = 8 * 1024 * 1024;
/** After a wake, the transfers sleep stopped queue again on network link-up, or this long after it (G4). */
export const WAKE_SETTLE = 10 * SECOND;
/**
 * A sleep wait whose wake never came (the sleep was refused, or its wake was missed) continues this
 * long after it began, like a network wait's first try.
 */
export const SLEEP_FALLBACK = MINUTE;
/** Downloads a quit or a crash stopped continue this long after the first window opens (G4, the owner's decision 5). */
export const CONTINUE_AFTER = 10 * SECOND;
/**
 * After a session that ended without its last save (a crash, a power loss), this much below each
 * segment's mark is fetched again: those bytes may never have reached the disk. Phase 5's block hash
 * record replaces this rule (RESUME-DESIGN.md G4, 4.2).
 */
export const SUSPECT_TAIL = 8 * 1024 * 1024;

/**
 * When try number `tries` + 1 of a network or server wait is due, the failure being `now` (tries is
 * the number of failures so far, 1 for the first). `retryAfter` (seconds, the server's Retry-After)
 * is honoured: never earlier than it says, at most SERVER_GIVE_UP away.
 */
export function waitNext(tries: number, now: number, retryAfter: number | null = null): number {
  const base = tries >= 1 && tries <= NET_SCHEDULE.length ? NET_SCHEDULE[tries - 1] : NET_EVERY;
  const server = retryAfter !== null && retryAfter > 0 ? Math.min(retryAfter * SECOND, SERVER_GIVE_UP) : 0;
  return now + Math.max(base, server);
}

/**
 * The suspect tail of every segment is given back (G4, before Phase 5): each segment claims at most
 * SUSPECT_TAIL less, never below its start. Returns the bytes given back, which the next run fetches again.
 */
export function rewindTails(segments: Segment[], tail = SUSPECT_TAIL): number {
  let back = 0;
  for (const seg of segments) {
    const n = Math.min(Math.max(0, seg.received), tail);
    seg.received -= n;
    back += n;
  }
  return back;
}
