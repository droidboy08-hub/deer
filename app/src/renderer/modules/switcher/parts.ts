// Small pieces shared by the deck, grid and strip: motion helpers, glass, card faces and labels.
import { icons } from '../../icons';
import type { Tab } from '../../model';
import { detailLine, esc, highlight, tabText } from './search';
import type { Model } from './types';

export const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EXPAND = 'cubic-bezier(0.2, 0, 0, 1)';

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** A Web Animation, or nothing when motion is reduced. */
export function play(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (reducedMotion()) return null;
  return el.animate(frames, { fill: 'backwards', ...opts });
}

export function el(tag: string, cls: string, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** A glass surface: lens, tint and rim layers, styled per surface in the module CSS. */
export function glass(cls: string): HTMLElement {
  return el('div', `sw-glass ${cls}`, '<div class="lens"></div><div class="tint"></div><div class="rim"></div>');
}

export const optionId = (id: number) => `sw-opt-${id}`;

/** Runs a view's first layout with transitions off, so cards start where they belong. */
export function settle(root: HTMLElement, layout: () => void): void {
  root.classList.add('sw-still');
  layout();
  void root.offsetWidth;
  root.classList.remove('sw-still');
}

/** The wallpaper Home shows, if there is one. */
export function wallpaperSrc(): string | null {
  const img = document.getElementById('wallpaper') as HTMLImageElement | null;
  return !document.body.classList.contains('no-wallpaper') && img?.getAttribute('src') ? img.src : null;
}

/** Favicon markup at a size; Home gets the house, a page without one the globe. */
export function favicon(t: Tab, size: number): string {
  if (t.kind === 'home') return sized(icons.home, size);
  if (t.favicon) return `<img src="${esc(t.favicon)}" alt="" width="${size}" height="${size}" draggable="false">`;
  return sized(icons.globe, size);
}

function sized(svg: string, size: number): string {
  return svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
}

/** Falls back to the globe when a favicon fails to load. */
export function guardFavicons(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('.fav img')) {
    img.addEventListener('error', () => {
      const size = img.width || 16;
      img.outerHTML = sized(icons.globe, size);
    }, { once: true });
  }
}

/** Fills a card's picture: the page's thumbnail, the wallpaper for Home, or a quiet placeholder. */
export function paintMedia(media: HTMLElement, t: Tab, thumb: string | null, favSize: number): void {
  const src = t.kind === 'home' ? wallpaperSrc() : thumb;
  // Thumbnails are long data URLs: key on their length and tail rather than storing them twice.
  const key = src ? `${t.kind}:${src.length}:${src.slice(-32)}` : `${t.kind}:${t.favicon ?? ''}`;
  if (media.dataset.key === key) return;
  media.dataset.key = key;
  media.classList.toggle('home', t.kind === 'home');
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = src;
    media.replaceChildren(img);
  } else if (t.kind === 'home') {
    media.replaceChildren();
  } else {
    media.innerHTML = `<div class="sw-ph"><span class="ring fav">${favicon(t, favSize)}</span></div>`;
    guardFavicons(media);
  }
}

/** Accessible name for a card, e.g. "Float glass, refract.wiki, current tab". */
export function cardName(t: Tab, m: Model): string {
  const x = tabText(t);
  return [x.title, x.host, t.id === m.startId ? 'current tab' : ''].filter(Boolean).join(', ');
}

/** Title and detail HTML with the query's matches marked. */
export function labelHtml(t: Tab, m: Model): { title: string; detail: string } {
  const match = m.match(t.id);
  const d = detailLine(t, match);
  return { title: highlight(tabText(t).title, match?.title ?? []), detail: highlight(d.text, d.ranges) };
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
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(selector);
  return card?.dataset.id ? Number(card.dataset.id) : null;
}

/** Geometry of a box on screen, for flights between a card and the window. */
export interface Box {
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
 * switcher, while the real face waits hidden. Used by Grid and Strip, whose cards sit in
 * clipped, scrolling containers. The copy stays at the end of an outward flight.
 */
export function flight(face: HTMLElement, host: HTMLElement, outward: boolean, radius: number, duration: number, easing: string): Promise<void> {
  const r = face.getBoundingClientRect();
  const slot: Box = { x: r.left, y: r.top, w: r.width, h: r.height, r: radius };
  const full: Box = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, r: 0 };
  const copy = face.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
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
