// Waits Deer comes back from by itself (spikes/downloader/RESUME-DESIGN.md G4, Phase 4): lost
// network, a server in trouble, the computer's sleep, and what a quit or a crash left unfinished.
// The engine (VitreDownloads stopped(), armWaits()) keeps a waiting row paused with rec.wait:
//   - 'network': the address could not be reached (classify() 'offline' or 'timeout': UNKNOWN_HOST,
//     OFFLINE, NET_TIMEOUT, NET_RESET, CONNECTION_REFUSED, NET_INTERRUPT, NET_PARTIAL_TRANSFER, a proxy
//     that can't be reached, a body cut short once a segment's attempts are used up; any other Necko
//     failure fails as before). Tried again every QUEUE_RETRY (30 s, as IDM's queue does: the owner's decision
//     of 2026-10-21; it was 10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min); it never fails on its own.
//     Network link-up or wake brings the next try to SOON. A ranged run no longer stops into such a wait on
//     network or site trouble (it keeps asking itself: retry.ts); these waits remain for what a quit, a crash or
//     sleep left, and for a check that could not reach the site;
//   - 'server': 5xx or 429, on the same schedule, never before the server's Retry-After, and never failed by
//     itself any more (it was after 24 hours: IDM retries without limit, the owner's decision of 2026-10-21);
//   - 'sleep': the computer went to sleep while it ran; it queues again once the network is back
//     after the wake, or WAKE_SETTLE after it.
// The count (wait.tries) goes on across the runs the wait starts, network and server failures alike
// (review of Phase 4), and starts again once a run made FRESH_AFTER of progress, as ranged.ts gives a
// connection a fresh budget once it made progress, or on the person's Try now.
import type { Segment } from './ranged';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The wait between tries of a network or server wait: IDM's queue rhythm (the owner's decision of 2026-10-21). */
export const QUEUE_RETRY = 30 * SECOND;
/** Network link-up or wake brings the next try of a network wait this close (G4). */
export const SOON = 5 * SECOND;
/** A server that keeps failing (5xx, 429) no longer ends the download by itself (IDM retries without limit, the owner's decision of 2026-10-21). */
export const SERVER_GIVE_UP = Infinity;
/** The longest Retry-After a wait honours. */
const RETRY_AFTER_MAX = 24 * 60 * MINUTE;
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
 * When the next try of a network or server wait is due, the failure being `now`: QUEUE_RETRY later, never
 * earlier than the server's Retry-After (seconds), at most RETRY_AFTER_MAX away. `tries` is kept for the callers.
 */
export function waitNext(_tries: number, now: number, retryAfter: number | null = null): number {
  const server = retryAfter !== null && retryAfter > 0 ? Math.min(retryAfter * SECOND, RETRY_AFTER_MAX) : 0;
  return now + Math.max(QUEUE_RETRY, server);
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
