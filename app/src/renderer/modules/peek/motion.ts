// Frame-driven motion for the peek. Chromium composites a webview's clip-path animation without
// applying it to the page's surface, so CSS transitions can't clip the page as the sheet grows.
// Instead one requestAnimationFrame loop sets the sheet and the page on the same frame.

export type Ease = (t: number) => number;

/** A CSS cubic-bezier() timing function (the WebKit UnitBezier solver). */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}

/** Vitre's spring, for anything that moves as an object. */
export const SPRING = bezier(0.22, 1, 0.36, 1);
/** Expand-to-window. */
export const EXPAND = bezier(0.2, 0, 0, 1);
/** CSS `ease`, for fades. */
export const EASE = bezier(0.25, 0.1, 0.25, 1);

export interface Fade {
  from: number;
  to: number;
  ms: number;
  delay?: number;
}

export function fadeAt(f: Fade, elapsed: number): number {
  const t = f.ms > 0 ? (elapsed - (f.delay ?? 0)) / f.ms : elapsed >= (f.delay ?? 0) ? 1 : 0;
  return f.from + (f.to - f.from) * EASE(Math.min(1, Math.max(0, t)));
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Call `frame(elapsed)` now and on every animation frame for `ms`, then `done`.
 * Returns a cancel function; a cancelled run never calls `done`.
 */
export function tween(ms: number, frame: (elapsed: number) => void, done?: () => void): () => void {
  const start = performance.now();
  let live = true;
  let raf = 0;
  const step = (now: number) => {
    if (!live) return;
    const elapsed = Math.min(ms, Math.max(0, now - start));
    frame(elapsed);
    if (elapsed >= ms) {
      live = false;
      done?.();
    } else {
      raf = requestAnimationFrame(step);
    }
  };
  frame(0);
  if (ms <= 0) {
    live = false;
    done?.();
  } else {
    raf = requestAnimationFrame(step);
  }
  return () => {
    live = false;
    cancelAnimationFrame(raf);
  };
}
