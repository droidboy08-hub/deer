// Runs in every page (isolated world) for the downloader:
// - reports the video (or large embedded frame) under the pointer, with its rectangle, so the
//   chrome can put the "Download this video" pill in its corner;
// - follows one pinned video's rectangle while its download runs;
// - answers "which is the main video?" for Ctrl+Shift+D;
// - Alt+click on a link downloads it (Chrome's convention) unless the page handled the click;
// - reports where the last click was, so a new download can fly from there to the ring.
import { ipcRenderer } from 'electron';
import type { PageVideo } from '../../main/modules/downloads/types';

const MIN_VIDEO = { w: 200, h: 112 };
const MIN_FRAME = { w: 320, h: 180 };

const ids = new WeakMap<Element, number>();
const byId = new Map<number, WeakRef<Element>>();
const encrypted = new WeakSet<Element>();
let nextId = 1;
let hovered: Element | null = null;
let pointer = { x: -1, y: -1 };
let frame = 0;
let pinned: { id: number; key: string } | null = null;
let pinTimer: number | null = null;

function idOf(el: Element): number {
  let id = ids.get(el);
  if (!id) {
    id = nextId++;
    ids.set(el, id);
    byId.set(id, new WeakRef(el));
  }
  return id;
}

function rectOf(el: Element): PageVideo['rect'] {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function titleOf(el: Element): string {
  const own = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  if (own.trim()) return own.trim();
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  return (og || document.title || '').trim();
}

function infoOf(el: Element): PageVideo {
  const id = idOf(el);
  if (el instanceof HTMLVideoElement) {
    const src = el.currentSrc || el.src || el.querySelector<HTMLSourceElement>('source[src]')?.src || '';
    const d = el.duration;
    return {
      id,
      kind: 'video',
      rect: rectOf(el),
      src,
      duration: Number.isFinite(d) ? d : 0,
      width: el.videoWidth,
      height: el.videoHeight,
      // EME in use means DRM: the key system decides what can be decoded, not the page.
      protected: !!el.mediaKeys || encrypted.has(el),
      live: d === Infinity,
      title: titleOf(el),
      frameSrc: '',
    };
  }
  return { id, kind: 'frame', rect: rectOf(el), src: '', duration: 0, width: 0, height: 0, protected: false, live: false, title: titleOf(el), frameSrc: (el as HTMLIFrameElement).src || '' };
}

function shown(el: Element, r: DOMRect): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

/** The largest video containing the point; failing that, a large embedded frame (players live in iframes). */
function videoAt(x: number, y: number): Element | null {
  const pick = (list: HTMLCollectionOf<Element>, min: { w: number; h: number }) => {
    let best: Element | null = null;
    let area = 0;
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (r.width < min.w || r.height < min.h || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height <= area || !shown(el, r)) continue;
      best = el;
      area = r.width * r.height;
    }
    return best;
  };
  return pick(document.getElementsByTagName('video'), MIN_VIDEO) ?? pick(document.getElementsByTagName('iframe'), MIN_FRAME);
}

/** Hit-test once per frame; `withRect` re-sends the hovered video's rectangle (it scrolled or resized). */
function check(withRect: boolean): void {
  const el = pointer.x < 0 ? null : videoAt(pointer.x, pointer.y);
  if (el === hovered && !withRect) return;
  hovered = el;
  ipcRenderer.sendToHost('dl-video-hover', el ? infoOf(el) : null);
}

let resend = false;
function soon(withRect: boolean): void {
  resend ||= withRect;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const r = resend;
    resend = false;
    check(r);
  });
}

window.addEventListener(
  'pointermove',
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    soon(false);
  },
  { capture: true, passive: true },
);

// The pointer left the page (onto Vitre's own UI, or out of the window).
window.addEventListener(
  'mouseout',
  (e) => {
    if (e.relatedTarget) return;
    pointer = { x: -1, y: -1 };
    if (hovered) {
      hovered = null;
      ipcRenderer.sendToHost('dl-video-hover', null);
    }
  },
  { capture: true, passive: true },
);

function moved(): void {
  if (hovered) soon(true);
  if (pinned) sendPinned();
}
window.addEventListener('scroll', moved, { capture: true, passive: true });
window.addEventListener('resize', moved, { passive: true });

// 'encrypted' doesn't bubble; a capturing listener still sees it.
document.addEventListener(
  'encrypted',
  (e) => {
    if (e.target instanceof HTMLMediaElement) encrypted.add(e.target);
  },
  true,
);
for (const type of ['loadedmetadata', 'durationchange']) {
  document.addEventListener(
    type,
    (e) => {
      if (e.target === hovered) soon(true);
    },
    true,
  );
}

// ---- pinned video ----

function sendPinned(): void {
  if (!pinned) return;
  const el = byId.get(pinned.id)?.deref();
  if (!el || !el.isConnected) {
    ipcRenderer.sendToHost('dl-video-rect', pinned.id, null);
    unpin();
    return;
  }
  const r = rectOf(el);
  const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
  if (key === pinned.key) return;
  pinned.key = key;
  ipcRenderer.sendToHost('dl-video-rect', pinned.id, r);
}

function unpin(): void {
  pinned = null;
  if (pinTimer !== null) clearInterval(pinTimer);
  pinTimer = null;
}

ipcRenderer.on('dl-video-pin', (_e, id: number | null) => {
  unpin();
  if (typeof id !== 'number' || id <= 0) return;
  pinned = { id, key: '' };
  // Layout can move a video without a scroll (ads loading, the page reflowing).
  pinTimer = window.setInterval(sendPinned, 250);
  sendPinned();
});

// ---- the page's main video (Ctrl+Shift+D) ----

ipcRenderer.on('dl-main-video', () => {
  let best: HTMLVideoElement | null = null;
  let score = 0;
  for (const v of document.getElementsByTagName('video')) {
    const r = v.getBoundingClientRect();
    if (r.width < MIN_VIDEO.w || r.height < MIN_VIDEO.h || !shown(v, r)) continue;
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const s = w * h * (v.paused ? 1 : 2) + 1;
    if (s > score) {
      best = v;
      score = s;
    }
  }
  ipcRenderer.sendToHost('dl-main-video', best ? infoOf(best) : null);
});

// ---- Alt+click a link: download it ----

window.addEventListener('click', (e) => {
  if (!e.isTrusted || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.button !== 0 || e.defaultPrevented) return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || !/^https?:/i.test(a.href)) return;
  e.preventDefault();
  ipcRenderer.sendToHost('dl-link', a.href);
});

window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.isTrusted && e.button === 0) ipcRenderer.sendToHost('dl-pointer', e.clientX, e.clientY);
  },
  { capture: true, passive: true },
);
