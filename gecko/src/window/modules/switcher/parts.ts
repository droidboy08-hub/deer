// Small pieces shared by the deck, grid and strip: motion helpers, card faces, labels.
// Ported from app/src/renderer/modules/switcher/parts.ts. Differences on Gecko: no innerHTML (the
// chrome document sanitizes it and page titles must never go through a parser), thumbnails are
// canvases painted from ImageBitmaps (thumbs.ts) instead of <img> data URLs.
import { el as make, svg } from '../../dom';
import { icons } from '../../icons';
import type { Tab } from '../../model';
import { detailLine, highlight, tabText, type Range } from './search';
import type { Model } from './types';

export const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EXPAND = 'cubic-bezier(0.2, 0, 0, 1)';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
/** Follows Windows' "Animation effects" (ui.prefersReducedMotion). */
export const reducedMotion = (): boolean => reduced.matches;

export const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** A Web Animation, or nothing when motion is reduced. */
export function play(target: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (reducedMotion()) return null;
  return target.animate(frames, { fill: 'backwards', ...opts });
}

/** A div (or other tag) with classes. */
export function el<K extends keyof HTMLElementTagNameMap = 'div'>(cls: string, tag?: K): HTMLElementTagNameMap[K] {
  const e = make((tag ?? 'div') as K);
  if (cls) e.className = cls;
  return e;
}

/**
 * A glass surface: lens, tint and rim layers (the core's .glass structure, src/window/glass.ts),
 * styled per surface in styles.ts. Opacity must never be animated on the .glass element itself while
 * its lens should refract (an ancestor with opacity < 1 cuts the lens off from the page): fade its
 * layers instead (fadeLayers).
 */
export function glassBox(cls: string): HTMLElement {
  const host = el(`sw-glass ${cls}`);
  host.classList.add('glass');
  host.append(el('lens'), el('tint'), el('rim'));
  return host;
}

/** Fade every child of a glass element in or out (see glassBox), and its shadow with them. */
export function fadeLayers(host: HTMLElement, from: number, to: number, opts: KeyframeAnimationOptions): void {
  for (const child of Array.from(host.children)) play(child, [{ opacity: from }, { opacity: to }], opts);
  const shadow = getComputedStyle(host).boxShadow;
  if (shadow && shadow !== 'none') play(host, from < to ? [{ boxShadow: 'none' }, { boxShadow: shadow }] : [{ boxShadow: shadow }, { boxShadow: 'none' }], opts);
}

export const optionId = (id: number): string => `sw-opt-${id}`;

/** Runs a view's first layout with transitions off, so cards start where they belong. */
export function settle(root: HTMLElement, layout: () => void): void {
  root.classList.add('sw-still');
  layout();
  void root.offsetWidth;
  root.classList.remove('sw-still');
}

/** The tab's favicon at a size: Home gets the house, a page without one (or a broken one) the globe. */
export function favicon(t: Tab, size: number): Element {
  const box = el('fav', 'span');
  box.style.width = box.style.height = `${size}px`;
  const fallback = (): Element => sized(t.kind === 'home' ? icons.home : icons.globe, size);
  if (t.kind !== 'home' && t.favicon) {
    const img = make('img', { alt: '', width: size, height: size, draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    // Always a data:, chrome: or moz-remote-image: URL on 157 (model.ts): safe as an <img src>.
    img.src = t.favicon;
    box.append(img);
  } else {
    box.append(fallback());
  }
  return box;
}

function sized(markup: string, size: number): SVGSVGElement {
  const s = svg(markup);
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  return s;
}

/** Text with the matched ranges wrapped in <mark>, built as nodes (titles come from pages). */
export function marked(text: string, ranges: Range[]): DocumentFragment {
  const out = document.createDocumentFragment();
  for (const part of highlight(text, ranges)) {
    if (part.hit) {
      const m = make('mark');
      m.textContent = part.text;
      out.append(m);
    } else out.append(part.text);
  }
  return out;
}

/** Title and detail line with the query's matches marked. */
export function labelParts(t: Tab, m: Model): { title: DocumentFragment; detail: DocumentFragment } {
  const match = m.match(t.id);
  const d = detailLine(t, match);
  return { title: marked(tabText(t).title, match?.title ?? []), detail: marked(d.text, d.ranges) };
}

/**
 * True when a card's label must be built again (title, address, favicon, query or "current tab"
 * changed): a loading page updates its tab many times a second, and rebuilding the favicon then
 * would flicker.
 */
const labelKeys = new WeakMap<Element, string>();
export function labelChanged(label: Element, t: Tab, m: Model): boolean {
  const key = [t.title, t.url, t.favicon ?? '', t.kind, m.query, t.id === m.startId].join('|');
  if (labelKeys.get(label) === key) return false;
  labelKeys.set(label, key);
  return true;
}

/** Accessible name for a card, e.g. "Float glass, refract.wiki, current tab". */
export function cardName(t: Tab, m: Model): string {
  const x = tabText(t);
  return [x.title, x.host, t.id === m.startId ? 'current tab' : ''].filter(Boolean).join(', ');
}

/**
 * Where a new card goes in the DOM: before the next card of the list that already exists, so the
 * options keep the list's order for assistive tech (cards that come back after a search is cleared).
 */
export function nextCard(list: number[], i: number, cards: Map<number, { el: HTMLElement }>): HTMLElement | null {
  for (let j = i + 1; j < list.length; j++) {
    const c = cards.get(list[j]);
    if (c) return c.el;
  }
  return null;
}

/** The card a pointer event landed on, if any. */
export function cardAt(e: Event, selector: string): number | null {
  const card = (e.target as Element | null)?.closest?.<HTMLElement>(selector);
  return card?.dataset.id ? Number(card.dataset.id) : null;
}

/**
 * The picture of a card: a canvas in device pixels for the card's CSS size, painted by the
 * thumbnail store, or a quiet placeholder with the favicon while there is none.
 */
export class Media {
  readonly root = el('sw-media');
  readonly canvas = make('canvas');
  private placeholder: HTMLElement | null = null;
  /** Thumbnail version painted (-1: none yet). */
  painted = -1;

  constructor(private favSize: number) {
    this.root.append(this.canvas);
  }

  /**
   * Size the canvas for a CSS box at the current device scale; returns true when the backing store
   * changed (repaint needed). Called again on layout, so a change of scale while the switcher is up
   * (another monitor, layout.css.devPixelsPerPx) gets sharp canvases.
   */
  size(w: number, h: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width === pw && this.canvas.height === ph) return false;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.painted = -1;
    return true;
  }

  /** Show the placeholder (no picture of this tab exists yet). */
  empty(t: Tab): void {
    this.root.classList.add('none');
    if (this.placeholder) return;
    this.placeholder = el('sw-ph');
    const ring = el('ring', 'span');
    ring.append(favicon(t, this.favSize));
    this.placeholder.append(ring);
    this.root.append(this.placeholder);
  }

  /** A picture was painted into the canvas. */
  filled(version: number): void {
    this.painted = version;
    this.root.classList.remove('none');
    this.placeholder?.remove();
    this.placeholder = null;
  }
}

/** Draw a bitmap into a canvas so it covers it, keeping the top of the page (the part users know). */
export function drawCover(canvas: HTMLCanvasElement, source: CanvasImageSource & { width: number; height: number }): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !source.width || !source.height) return;
  const W = canvas.width;
  const H = canvas.height;
  const scale = Math.max(W / source.width, H / source.height);
  const sw = W / scale;
  const sh = H / scale;
  const sx = Math.max(0, (source.width - sw) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = scale < 0.75 ? 'high' : 'medium';
  ctx.drawImage(source, sx, 0, sw, sh, 0, 0, W, H);
}

/**
 * A copy of a card's face for a flight between its slot and the whole window (Grid and Strip, whose
 * cards sit in clipped, scrolling containers): cloneNode does not copy a canvas's pixels.
 */
export function cloneFace(face: HTMLElement): HTMLElement {
  const copy = face.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  const from = face.querySelectorAll('canvas');
  const to = copy.querySelectorAll('canvas');
  from.forEach((c, i) => {
    const target = to[i];
    if (!target || !c.width || !c.height) return;
    target.width = c.width;
    target.height = c.height;
    target.getContext('2d')?.drawImage(c, 0, 0);
  });
  return copy;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const boxFrame = (b: Box): Keyframe => ({
  transform: `translate(${b.x}px, ${b.y}px)`,
  width: `${b.w}px`,
  height: `${b.h}px`,
  borderRadius: `${b.r}px`,
});

/**
 * Flies a copy of a card's face between its slot and the whole window, above everything in the
 * switcher, while the real face waits hidden. The copy stays at the end of an outward flight.
 */
export function flight(face: HTMLElement, host: HTMLElement, outward: boolean, radius: number, duration: number, easing: string): Promise<void> {
  const r = face.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const slot: Box = { x: r.left - hostBox.left, y: r.top - hostBox.top, w: r.width, h: r.height, r: radius };
  const full: Box = { x: 0, y: 0, w: hostBox.width, h: hostBox.height, r: 0 };
  const copy = cloneFace(face);
  copy.classList.add('sw-flight');
  host.append(copy);
  face.style.visibility = 'hidden';
  const frames = outward ? [boxFrame(slot), boxFrame(full)] : [boxFrame(full), boxFrame(slot)];
  const anim = copy.animate(frames, { duration, easing, fill: 'forwards' });
  return anim.finished
    .catch(() => undefined)
    .then(() => {
      if (outward) return;
      face.style.visibility = '';
      copy.remove();
    });
}
