// The landing ring: 2 px, radius 6, 3 px outside the active match. It starts 16 px larger at
// opacity 0, contracts in 280 ms on the spring, holds 260 ms and fades in 240 ms (780 ms in all;
// reduced motion: a 560 ms fade in and out). #005fb8 over light pages, #4cc2ff with a 1 px
// rgba(0,0,0,0.35) hairline over dark pages and photos. Drawn in a click-through layer under the bar.
// Ported from app/src/renderer/modules/find.ts (LandingRing).
import { el } from '../../dom';
import { reducedMotion } from './views';

const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class LandingRing {
  private el: HTMLElement | null = null;
  shownAt = 0;
  /** The last ring drawn (tests). */
  last: Rect | null = null;

  constructor(private layer: HTMLElement) {}

  show(r: Rect, light: boolean): void {
    this.cancel();
    const edge = el('div', { class: 'vf-ring-edge' });
    const ring = el('div', { class: `vf-ring${light ? ' light' : ''}`, 'aria-hidden': 'true' }, edge);
    Object.assign(ring.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    this.layer.append(ring);
    this.el = ring;
    this.last = { ...r };
    this.shownAt = performance.now();
    const frames: Keyframe[] = reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.27 }, { opacity: 1, offset: 0.73 }, { opacity: 0 }]
      : [
          { inset: '-21px', opacity: 0, easing: SPRING },
          { inset: '-5px', opacity: 1, offset: 0.36, easing: SPRING },
          { inset: '-5px', opacity: 1, offset: 0.69, easing: 'ease' },
          { inset: '-5px', opacity: 0 },
        ];
    const anim = edge.animate(frames, { duration: reducedMotion() ? 560 : 780, fill: 'both' });
    anim.onfinish = () => {
      if (this.el === ring) this.cancel();
    };
  }

  /** Hold the ring at its landed state (tests capture it). */
  freeze(): void {
    const edge = this.el?.querySelector('.vf-ring-edge');
    for (const a of edge?.getAnimations() ?? []) {
      a.pause();
      a.currentTime = 400;
    }
  }

  cancel(): void {
    this.el?.remove();
    this.el = null;
  }

  get visible(): boolean {
    return this.el !== null;
  }
}
