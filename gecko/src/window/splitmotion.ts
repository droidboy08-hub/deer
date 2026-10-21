// Split view motion (../design/SPLIT-VIEW-SPEC.md "Motion"; board SplitMotion): the pieces bar.ts,
// split.ts and splitlift.ts share. One spring, cubic-bezier(0.22, 1, 0.36, 1), and the expand curve
// cubic-bezier(0.2, 0, 0, 1). Pages never animate their width (spec "Principles"): a pane lays out
// once at its final width and only transforms and opacity move. Reduced motion: every moment is a
// 150 ms cross-fade, with no glide, scale, slide, flight or pulse (the callers ask reduced()).
//
//   ghost(host, from, to, parts)   a glass shape that morphs between a circle and a half of the split
//                                  pill (the joining circle into its half, a separated half into its
//                                  circle, a dropped circle flying in): left/width on the spring, the
//                                  favicon 18 <-> 16 px, the host fading, the glass tint and rim fading
//                                  out into the pill's own glass (or in, out of it). { done, retarget }.
//   paneEnter(panel, side)         a pane slides 24 px in from its outer edge (280 ms) and fades in (200 ms).
//   paneLeave(layer, bitmap, rect) the picture of a pane that went (a closed side, a separated one)
//                                  slides 24 px outward and fades (200 ms), over the page that widened.
//   fadeIn(el, ms, delay)          opacity from 0 to whatever the element's CSS says (an implicit
//                                  end keyframe), so a class that hides it still wins.
import { el } from './dom';

export const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EXPAND = 'cubic-bezier(0.2, 0, 0, 1)';
/** The bar's re-flow and every morph of a glass shape (spec "Motion": 420 ms on the spring). */
export const MORPH_MS = 420;
/** Reduced motion: every row is a 150 ms cross-fade. */
export const FADE_MS = 150;

export const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A glass shape of the bar in a morph: a circle (glass on, favicon centred at 18 px) or a half (no glass of its own, favicon 16 px at 14, the host shown). */
export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The shape carries its own glass (tint, rim, shadow): a circle; a half sits on the pill's glass. */
  glass: boolean;
  /** Favicon: its left and top inside the shape, and its size. */
  fav: { x: number; y: number; size: number };
  /** The host's opacity (a half shows it, a circle does not). */
  host: number;
}

/** A circle of size s at (x, y). */
export function circleShape(x: number, y: number, s: number): Shape {
  return { x, y, w: s, h: s, glass: true, fav: { x: (s - 18) / 2, y: (s - 18) / 2, size: 18 }, host: 0 };
}

/** A half of the split pill (window rect), as SplitPill draws it: favicon 16 px at 14, 14, host from 38. */
export function halfShape(r: { x: number; y: number; width: number; height: number }): Shape {
  return { x: r.x, y: r.y, w: r.width, h: r.height, glass: false, fav: { x: 14, y: 14, size: 16 }, host: 1 };
}

const favTransform = (s: Shape): string => `translate(${s.fav.x}px, ${s.fav.y}px) scale(${s.fav.size / 18})`;

/** A ghost on its way: `done` resolves when the morph is over; `retarget` aims it at another end shape. */
export interface Ghost {
  done: Promise<void>;
  retarget(to: Shape): void;
}

/**
 * A glass shape morphing between a circle and a half (see the header). `parts.fav` are copies of the
 * favicon's nodes and `parts.tone` its tone (a flat light or dark favicon keeps its contrast plate:
 * skin/bar.css), `parts.label` the half's text; `shadow` the circle's contact shadow (the bar's
 * theme). The ghost lives in the bar (its stacking and theme); it is removed when the morph ends.
 * `retarget` changes where it lands while it runs (bar.ts: a half's place once the extension
 * buttons have moved into the new pill, after the render that started it, before it is painted).
 */
export function ghost(host: HTMLElement, from: Shape, to: Shape, parts: { fav: Node[]; tone?: string; label: string; focused: boolean; shadow: string }, ms = MORPH_MS): Ghost {
  const fav = el('span', { class: 'g-fav' });
  fav.append(...parts.fav);
  if (parts.tone) fav.dataset.tone = parts.tone;
  const label = el('span', { class: 'g-host' }, parts.label);
  const node = el('div', { class: `sv-ghost${parts.focused ? ' focused' : ''}`, 'aria-hidden': 'true' }, el('div', { class: 'g-lens' }), el('div', { class: 'g-tint' }), el('div', { class: 'g-rim' }), fav, label);
  const box = (s: Shape): Keyframe => ({ left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px`, boxShadow: s.glass ? parts.shadow : 'none' });
  const place = (s: Shape): void => {
    Object.assign(node.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px` });
  };
  place(to);
  host.append(node);
  const runs: Animation[] = [];
  const play = (target: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation => {
    const a = target.animate(frames, { fill: 'both', ...opts });
    runs.push(a);
    return a;
  };
  const shape = play(node, [box(from), box(to)], { duration: ms, easing: SPRING });
  // The lens goes with the tint and rim: over the pill's own glass a second frost would blur it twice.
  for (const layer of node.querySelectorAll('.g-lens, .g-tint, .g-rim')) play(layer, [{ opacity: from.glass ? 1 : 0 }, { opacity: to.glass ? 1 : 0 }], { duration: 200, easing: 'ease' });
  const icon = play(fav, [{ transform: favTransform(from) }, { transform: favTransform(to) }], { duration: 240, easing: SPRING });
  if (to.host > from.host) play(label, [{ opacity: from.host }, { opacity: to.host }], { duration: 150, delay: 200, easing: 'ease' });
  else play(label, [{ opacity: from.host }, { opacity: to.host }], { duration: 100, easing: 'ease' });
  const done = new Promise<void>((resolve) => {
    window.setTimeout(() => {
      for (const a of runs) a.cancel();
      node.remove();
      resolve();
    }, ms);
  });
  return {
    done,
    retarget(next: Shape): void {
      if (!node.isConnected) return;
      to = next;
      place(next);
      (shape.effect as KeyframeEffect | null)?.setKeyframes([box(from), box(next)]);
      (icon.effect as KeyframeEffect | null)?.setKeyframes([{ transform: favTransform(from) }, { transform: favTransform(next) }]);
    },
  };
}

/**
 * Opacity from 0 up to the element's own (CSS) opacity, an implicit end keyframe: a hidden state set
 * by a class still wins. (The one keyframe needs offset 0: without it, it would be the end.)
 */
export function fadeIn(target: Element, ms: number, delay = 0, easing = 'ease'): Animation {
  return target.animate([{ opacity: 0, offset: 0 }], { duration: ms, delay, easing, fill: 'backwards' });
}

/** A pane comes in (spec "Split forms"): 24 px in from its outer edge on the spring, fading in. */
export function paneEnter(panel: Element, side: 'left' | 'right'): void {
  if (reduced()) {
    fadeIn(panel, FADE_MS);
    return;
  }
  const dx = side === 'left' ? -24 : 24;
  panel.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 280, easing: SPRING });
  fadeIn(panel, 200);
}

/**
 * The picture of a pane that went (a closed side, the other side of a separated pair): it slides
 * 24 px outward and fades over 200 ms (reduced motion: fades in 150 ms), over the page that has
 * already widened, which it uncovers. `layer` is a full-window layer under the bar.
 */
export function paneLeave(layer: HTMLElement, bitmap: ImageBitmap, rect: DOMRect, side: 'left' | 'right'): void {
  const canvas = el('canvas', { class: 'sv-leaving', 'aria-hidden': 'true' });
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  Object.assign(canvas.style, { left: `${Math.round(rect.left)}px`, top: `${Math.round(rect.top)}px`, width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px`, borderRadius: side === 'left' ? '0 8px 8px 0' : '8px 0 0 8px' });
  layer.append(canvas);
  const dx = side === 'left' ? -24 : 24;
  const a = reduced()
    ? canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' })
    : canvas.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dx}px)`, opacity: 0 }], { duration: 200, easing: SPRING, fill: 'forwards' });
  void a.finished.catch(() => undefined).then(() => canvas.remove());
}

/** A promise that settles with `p`'s value, or null after `ms`. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))]);
}
