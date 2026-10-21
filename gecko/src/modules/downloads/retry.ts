// How a connection of a ranged download asks again after a failure: IDM 6.43's policy, as measured on the
// owner's copy (2026-10-20/21, spikes/downloader/IDM-BENCH.md, IDM-WAY-DESIGN.md), by the owner's decision of
// 2026-10-21 ("exactly like IDM"):
//   - a cut connection (a reset, an interrupted or short body, a timeout) or a site that can't be reached: asked
//     again at once (AT_ONCE_MS; IDM: 0.01 s), without limit;
//   - a site error (408, 425, 5xx but 501 and 505): the same spot again after 4 s, 8 s, 12 s ... (STEP_MS x k), on
//     a new connection, without limit, while the others go on;
//   - a connection turned away (429, 503: the site allows fewer connections): it gives its part back and asks
//     again on the same growing gaps, without limit, and once more each time an answer of the download that
//     brought bytes ends (ranged.ts nudge(); IDM re-sends at once then);
//   - a Retry-After is honoured, up to RETRY_AFTER_MAX.
// Not copied, each on purpose: IDM's endless loop when the file's size changed (Deer says File changed), its
// weak check after an outage (Deer proves one window before any byte is written again: ranged.ts rejoin()),
// and asking again while Windows says there is no network at all (once every OFFLINE_MS, or at once when it
// comes back). The only cap: Deer as a whole asks again at most GLOBAL_RATE times a second after failures. Necko
// itself sends a request that was reset at once up to 10 times (network.http.request.max-attempts), so in a local
// outage the server sees about ten times as many: 150 asks a second come to about IDM's 1,270 a second (measured
// 2026-10-21; the main thread showed no lag to speak of up to 800 asks a second).
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import {
  AbortedError, AddressRefusedError, ChangedError, DiskError, HttpStatusError, NetError, NotTheFileError, ShortBodyError, isRetryable, sleep,
} from './net';

export const AT_ONCE_MS = 10;
export const STEP_MS = 4000;
export const RETRY_AFTER_MAX = 24 * 60 * 60 * 1000;
export const OFFLINE_MS = 30 * 1000;
export const GLOBAL_RATE = 150;
/** No byte for this long while every connection is failing: the row shows the wait (Waiting for network, Retrying). */
export const HOLD_AFTER_MS = 10 * 1000;

/** Necko failures that mean the connection was cut (not refused). */
export const CUT_CODES = new Set(['NS_ERROR_NET_RESET', 'NS_ERROR_NET_INTERRUPT', 'NS_ERROR_NET_PARTIAL_TRANSFER', 'NS_ERROR_NET_TIMEOUT', 'NS_ERROR_NET_TIMEOUT_EXTERNAL']);
/** Necko failures that mean the site can't be reached now (net.ts classify()'s UNREACHABLE but the cuts). */
const NETWORK_CODES = new Set(['NS_ERROR_UNKNOWN_HOST', 'NS_ERROR_OFFLINE', 'NS_ERROR_CONNECTION_REFUSED', 'NS_ERROR_UNKNOWN_PROXY_HOST', 'NS_ERROR_PROXY_CONNECTION_REFUSED']);

export type RetryClass = 'cut' | 'network' | 'server' | 'refused-start' | 'refused-address' | 'challenge' | 'other' | 'fatal';

/** What kind of failure `err` is, for asking again. */
export function classOf(err: unknown): RetryClass {
  if (err instanceof AbortedError || err instanceof DiskError || err instanceof ChangedError) return 'fatal';
  if (err instanceof ShortBodyError) return 'cut';
  if (err instanceof NetError) {
    if (CUT_CODES.has(err.code)) return 'cut';
    if (NETWORK_CODES.has(err.code)) return 'network';
    return isRetryable(err) ? 'other' : 'fatal';
  }
  if (err instanceof AddressRefusedError) return err.hint === 'challenge' ? 'challenge' : 'refused-address';
  if (err instanceof NotTheFileError) return 'refused-address';
  if (err instanceof HttpStatusError) {
    const s = err.status;
    if (s === 429 || s === 503) return 'refused-start';
    if (s === 408 || s === 425 || (s >= 500 && s <= 599 && s !== 501 && s !== 505)) return 'server';
    return 'fatal';
  }
  return isRetryable(err) ? 'other' : 'fatal';
}

/** The wait before failure number `k` (1 for the first since the connection's last progress) of `cls` is asked again. */
export function delayOf(cls: RetryClass, k: number, retryAfterSecs: number | null): number {
  const after = retryAfterSecs !== null && retryAfterSecs > 0 ? Math.min(retryAfterSecs * 1000, RETRY_AFTER_MAX) : 0;
  const own = cls === 'cut' || cls === 'network' ? AT_ONCE_MS : STEP_MS * Math.max(1, k);
  return Math.max(own, after);
}

/** True while Windows (or Firefox) says there is no network at all. */
export function offline(): boolean {
  try {
    return !!Services.io.offline;
  } catch {
    return false;
  }
}

/** A clock that never goes back (a wall-clock step back stalled every ask, review). */
function monotonic(): number {
  try {
    return ChromeUtils.now();
  } catch {
    return Date.now();
  }
}

/**
 * The asks after failures of all of Deer, at most GLOBAL_RATE a second (a token bucket with a burst of as
 * many). take() resolves when one may go: waiters queue in order behind one timer (review: each polled on its
 * own, thousands of wake-ups a second when the bucket ran dry).
 */
class Pacer {
  private tokens = GLOBAL_RATE;
  private at = monotonic();
  private queue: Array<{ resolve: () => void; reject: (e: unknown) => void; signal: AbortSignal; onAbort: () => void }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private refill(): void {
    const now = monotonic();
    this.tokens = Math.min(GLOBAL_RATE, this.tokens + (Math.max(0, now - this.at) / 1000) * GLOBAL_RATE);
    this.at = now;
  }

  take(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new AbortedError());
    this.refill();
    if (!this.queue.length && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        onAbort: (): void => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) this.queue.splice(i, 1);
          reject(new AbortedError());
        },
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.arm();
    });
  }

  private arm(): void {
    if (this.timer || !this.queue.length) return;
    const ms = Math.max(1, Math.ceil(((1 - this.tokens) / GLOBAL_RATE) * 1000));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refill();
      while (this.queue.length && this.tokens >= 1) {
        this.tokens -= 1;
        const e = this.queue.shift()!;
        e.signal.removeEventListener('abort', e.onAbort);
        e.resolve();
      }
      this.arm();
    }, ms);
  }
}

export const pacer = new Pacer();

let netChange: AbortController = new AbortController();
let watching = false;

/** A signal that aborts the next time the network comes back or changes (offline status, link up, link changed). */
export function networkBack(): AbortSignal {
  if (!watching) {
    watching = true;
    const fire = (): void => {
      const c = netChange;
      netChange = new AbortController();
      c.abort();
    };
    const observer = {
      observe(_subject: unknown, topic: string, data: string): void {
        if (topic === 'network:offline-status-changed' && data === 'offline') return;
        if (topic === 'network:link-status-changed' && data !== 'up' && data !== 'changed') return;
        fire();
      },
    };
    try {
      Services.obs.addObserver(observer, 'network:offline-status-changed');
      Services.obs.addObserver(observer, 'network:link-status-changed');
    } catch {
      /* no observer service (a unit test): the timer alone decides */
    }
  }
  return netChange.signal;
}

/**
 * The wait of a failure of class `cls`, then one token of the pacer. Network failures while Windows says
 * there is no network wait OFFLINE_MS, or until it comes back.
 */
export async function waitToAsk(cls: RetryClass, ms: number, signal: AbortSignal, wake: AbortSignal | null = null): Promise<void> {
  if (cls === 'network' && offline()) ms = Math.max(ms, OFFLINE_MS);
  const signals = [signal, ...(wake ? [wake] : []), ...(cls === 'network' ? [networkBack()] : [])];
  try {
    await sleep(ms, signals.length > 1 ? AbortSignal.any(signals) : signal);
  } catch (err) {
    if (signal.aborted) throw err;
  }
  await pacer.take(signal);
}
