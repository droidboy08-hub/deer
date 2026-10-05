// Page module for the downloader (port of app/src/preload/page-modules/video.ts):
//   - reports the video (or large embedded frame) under the pointer, with its rectangle, so the
//     window can put the "Download this video" pill in its corner (top document only);
//   - follows one pinned video's rectangle while its download runs or its picker is open;
//   - answers "which is the page's main video?" for Ctrl+Shift+D and the tab pill's download mark;
//   - Alt+click on a link downloads it (Chrome's convention) unless the page handled the click;
//   - reports where the last press was, so a new download can fly from there to the ring;
//   - reports DRM: an 'encrypted' event in any frame marks the tab protected (the engine also
//     hears every key-system request through Firefox's EncryptedMedia actor).
//
// Messages to the window (b.on('page-message')):
//   downloads:hover        PageVideo | null      (src/modules/downloads/types.ts; CSS px of the top viewport,
//                                                view = the viewport without its scrollbars)
//   downloads:video-rect   { id, rect | null, view } the pinned video moved (null: it is gone)
//   downloads:link         { href, policy }      Alt+click on an http(s) link (the click was prevented);
//                                                policy: the link's referrer policy (W3C name, referrer.ts)
//   downloads:pointer      { x, y }              a primary-button press in the top document
//   downloads:drm          { encrypted: true }   an 'encrypted' media event in this frame
//   downloads:element-media { src, kind, frameUrl, protected }  a <video>/<audio> of this frame loaded
//                                                an http(s) file (any frame; see reportElement)
// From the window:
//   downloads:pin          { id } | { id: null } follow that video's rectangle (every 250 ms + scroll)
//   downloads:main-video   (query) -> PageVideo | null: the largest visible playing (else any) video
//
// Elements are reached through Xray wrappers: tag names are compared by localName (instanceof
// across the wrapper is not reliable), and nothing from the page is evaluated.
import { policyOf, type ReferrerPolicy } from '../../modules/downloads/referrer';
import type { PageContext } from '../page-api';

const MIN_VIDEO = { w: 200, h: 112 };

/** The referrer policy a click on `a` would use: nsIReferrerInfo.initWithElement (dom/security/ReferrerInfo.cpp). */
function linkPolicy(a: Element): ReferrerPolicy {
  try {
    const info = Cc['@mozilla.org/referrer-info;1'].createInstance(Ci.nsIReferrerInfo);
    info.initWithElement(a);
    return policyOf(info);
  } catch {
    return '';
  }
}
const MIN_FRAME = { w: 320, h: 180 };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface VideoReport {
  id: number;
  kind: 'video' | 'frame';
  rect: Rect;
  src: string;
  duration: number;
  width: number;
  height: number;
  protected: boolean;
  live: boolean;
  title: string;
  frameSrc: string;
  view: { w: number; h: number };
}

interface State {
  ids?: WeakMap<Element, number>;
  byId?: Map<number, WeakRef<Element>>;
  encrypted?: WeakSet<Element>;
  nextId?: number;
  hovered?: Element | null;
  pointer?: { x: number; y: number };
  frame?: number;
  resend?: boolean;
  pinned?: { id: number; key: string } | null;
  pinTimer?: number;
}

export const events = {
  pointermove: { capture: true, passive: true, createActor: false },
  pointerdown: { capture: true, passive: true, createActor: false },
  mouseout: { capture: true, passive: true, createActor: false },
  scroll: { capture: true, passive: true, createActor: false },
  resize: { capture: true, passive: true, createActor: false },
  // 'encrypted' doesn't bubble; a capturing listener still sees it.
  encrypted: { capture: true },
  loadedmetadata: { capture: true, createActor: false },
  durationchange: { capture: true, createActor: false },
  // Bubble phase wanted (the page's own handlers first); see onEvent for when it is merged into capture.
  click: { createActor: false },
};

const st = (ctx: PageContext): State => ctx.state as State;

function idOf(ctx: PageContext, el: Element): number {
  const s = st(ctx);
  s.ids ??= new WeakMap();
  s.byId ??= new Map();
  let id = s.ids.get(el);
  if (!id) {
    id = s.nextId = (s.nextId ?? 0) + 1;
    s.ids.set(el, id);
    s.byId.set(id, new WeakRef(el));
  }
  return id;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function titleOf(ctx: PageContext, el: Element): string {
  const own = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  if (own.trim()) return own.trim().slice(0, 300);
  const doc = ctx.document;
  const og = doc?.querySelector('meta[property="og:title"]')?.getAttribute('content');
  return String(og || doc?.title || '')
    .trim()
    .slice(0, 300);
}

/** The visible area of the top document: the viewport without its scrollbars (CSS px). */
function viewOf(ctx: PageContext): { w: number; h: number } {
  const root = ctx.document?.documentElement;
  return { w: Number(root?.clientWidth) || 0, h: Number(root?.clientHeight) || 0 };
}

function infoOf(ctx: PageContext, el: Element): VideoReport {
  const id = idOf(ctx, el);
  const view = viewOf(ctx);
  if (el.localName === 'video') {
    const v = el as HTMLVideoElement;
    const src = String(v.currentSrc || v.src || v.querySelector('source[src]')?.getAttribute('src') || '');
    const d = Number(v.duration);
    return {
      id,
      kind: 'video',
      rect: rectOf(el),
      src: absolute(ctx, src),
      duration: Number.isFinite(d) ? d : 0,
      width: Number(v.videoWidth) || 0,
      height: Number(v.videoHeight) || 0,
      // EME in use means DRM: the key system decides what can be decoded, not the page.
      protected: !!(v as unknown as { mediaKeys: unknown }).mediaKeys || !!st(ctx).encrypted?.has(el),
      live: d === Infinity,
      title: titleOf(ctx, el),
      frameSrc: '',
      view,
    };
  }
  return { id, kind: 'frame', rect: rectOf(el), src: '', duration: 0, width: 0, height: 0, protected: false, live: false, title: titleOf(ctx, el), frameSrc: absolute(ctx, String((el as HTMLIFrameElement).src || '')), view };
}

function absolute(ctx: PageContext, url: string): string {
  if (!url) return '';
  try {
    return new URL(url, ctx.document?.baseURI ?? undefined).href;
  } catch {
    return '';
  }
}

function shown(ctx: PageContext, el: Element, r: DOMRect): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  const s = ctx.window?.getComputedStyle(el);
  return !!s && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

/** The largest video containing the point; failing that, a large embedded frame (players live in iframes). */
function videoAt(ctx: PageContext, x: number, y: number): Element | null {
  const doc = ctx.document;
  if (!doc) return null;
  const pick = (list: HTMLCollectionOf<Element>, min: { w: number; h: number }): Element | null => {
    let best: Element | null = null;
    let area = 0;
    for (const el of Array.from(list)) {
      const r = el.getBoundingClientRect();
      if (r.width < min.w || r.height < min.h || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height <= area || !shown(ctx, el, r)) continue;
      best = el;
      area = r.width * r.height;
    }
    return best;
  };
  return pick(doc.getElementsByTagName('video'), MIN_VIDEO) ?? pick(doc.getElementsByTagName('iframe'), MIN_FRAME);
}

/** Hit-test once per frame; `withRect` re-sends the hovered video's rectangle (it scrolled or resized). */
function check(ctx: PageContext, withRect: boolean): void {
  const s = st(ctx);
  const p = s.pointer ?? { x: -1, y: -1 };
  const el = p.x < 0 ? null : videoAt(ctx, p.x, p.y);
  if (el === (s.hovered ?? null) && !withRect) return;
  s.hovered = el;
  ctx.send('downloads:hover', el ? infoOf(ctx, el) : null);
}

function soon(ctx: PageContext, withRect: boolean): void {
  const s = st(ctx);
  s.resend ||= withRect;
  if (s.frame) return;
  const win = ctx.window;
  if (!win) return;
  s.frame = win.requestAnimationFrame(() => {
    s.frame = 0;
    const r = !!s.resend;
    s.resend = false;
    check(ctx, r);
  });
}

function sendPinned(ctx: PageContext): void {
  const s = st(ctx);
  const pinned = s.pinned;
  if (!pinned) return;
  const el = s.byId?.get(pinned.id)?.deref();
  if (!el || !el.isConnected) {
    ctx.send('downloads:video-rect', { id: pinned.id, rect: null });
    unpin(ctx);
    return;
  }
  const r = rectOf(el);
  const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
  if (key === pinned.key) return;
  pinned.key = key;
  ctx.send('downloads:video-rect', { id: pinned.id, rect: r, view: viewOf(ctx) });
}

function unpin(ctx: PageContext): void {
  const s = st(ctx);
  s.pinned = null;
  if (s.pinTimer) {
    try {
      ctx.window?.clearInterval(s.pinTimer);
    } catch {
      /* window gone */
    }
  }
  s.pinTimer = 0;
}

/**
 * A media element that plays an ordinary file (http(s), not an MSE blob:). The engine sees media
 * through the network, but a page can get its media without a request of its own (Gecko's media
 * cache clones the resource of another element with the same address, a page from the
 * back-forward cache): the element's own report keeps the download mark right.
 */
function reportElement(ctx: PageContext, el: Element | null): void {
  if (!el || (el.localName !== 'video' && el.localName !== 'audio')) return;
  const m = el as HTMLMediaElement;
  const src = absolute(ctx, String(m.currentSrc || m.src || ''));
  if (!/^https?:/i.test(src) || src.length > 8192) return;
  const d = Number(m.duration);
  // Short sounds and tiny previews are not worth a mark (the network rule skips files under 500 kB).
  if (Number.isFinite(d) && d < 5) return;
  const kind = el.localName === 'video' ? 'video' : 'audio';
  ctx.send('downloads:element-media', { src, kind, frameUrl: ctx.isTop ? '' : String(ctx.document?.documentURI ?? '').slice(0, 8192), protected: !!(m as unknown as { mediaKeys: unknown }).mediaKeys });
}

export function onEvent(ctx: PageContext, event: Event): void {
  const s = st(ctx);
  switch (event.type) {
    case 'encrypted': {
      const t = event.target as Element | null;
      if (t && (t.localName === 'video' || t.localName === 'audio')) {
        (s.encrypted ??= new WeakSet()).add(t);
        ctx.send('downloads:drm', { encrypted: true });
      }
      return;
    }
    case 'click': {
      const e = event as MouseEvent;
      if (!e.isTrusted || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.button !== 0 || e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = a ? String(a.href) : '';
      if (!/^https?:/i.test(href) || !a) return;
      // The link's referrer policy (rel=noreferrer, referrerpolicy=, the document's): what Firefox's
      // own link click would carry (nsIReferrerInfo.initWithElement, as ClickHandlerChild does).
      const policy = linkPolicy(a);
      const decide = (ev: Event): void => {
        if (ev.defaultPrevented) return; // the page handled its own Alt+click
        ev.preventDefault();
        ctx.send('downloads:link', { href, policy });
      };
      // Another module may ask for 'click' in the capture phase (the listener options are merged per
      // event): then the page has not seen this click yet. Decide when it bubbles back to the window,
      // after the page's own handlers.
      const win = ctx.window;
      if (e.eventPhase === 1 && win) {
        win.addEventListener('click', decide, { once: true });
        win.setTimeout(() => win.removeEventListener('click', decide), 0);
      } else decide(e);
      return;
    }
  }
  if (event.type === 'loadedmetadata') reportElement(ctx, event.target as Element | null);
  if (!ctx.isTop) return;
  switch (event.type) {
    case 'pointermove': {
      const e = event as PointerEvent;
      s.pointer = { x: e.clientX, y: e.clientY };
      soon(ctx, false);
      break;
    }
    case 'pointerdown': {
      const e = event as PointerEvent;
      if (e.isTrusted && e.button === 0) ctx.send('downloads:pointer', { x: e.clientX, y: e.clientY });
      break;
    }
    case 'mouseout': {
      // The pointer left the page (onto Deer's own UI, or out of the window).
      const e = event as MouseEvent;
      if (e.relatedTarget) return;
      s.pointer = { x: -1, y: -1 };
      if (s.hovered) {
        s.hovered = null;
        ctx.send('downloads:hover', null);
      }
      break;
    }
    case 'scroll':
    case 'resize':
      if (s.hovered) soon(ctx, true);
      if (s.pinned) sendPinned(ctx);
      break;
    case 'loadedmetadata':
    case 'durationchange':
      if (event.target === s.hovered) soon(ctx, true);
      break;
  }
}

export function onMessage(ctx: PageContext, name: string, data: unknown): unknown {
  if (name === 'downloads:pin') {
    if (!ctx.isTop) return undefined;
    unpin(ctx);
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id !== 'number' || id <= 0) return true;
    const s = st(ctx);
    s.pinned = { id, key: '' };
    // Layout can move a video without a scroll (ads loading, the page reflowing).
    s.pinTimer = ctx.window?.setInterval(() => sendPinned(ctx), 250) ?? 0;
    sendPinned(ctx);
    return true;
  }
  if (name === 'downloads:main-video') {
    if (!ctx.isTop) return undefined;
    const doc = ctx.document;
    const win = ctx.window;
    if (!doc || !win) return null;
    let best: Element | null = null;
    let score = 0;
    for (const v of Array.from(doc.getElementsByTagName('video'))) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_VIDEO.w || r.height < MIN_VIDEO.h || !shown(ctx, v, r)) continue;
      const w = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
      const sc = w * h * ((v as HTMLVideoElement).paused ? 1 : 2) + 1;
      if (sc > score) {
        best = v;
        score = sc;
      }
    }
    return best ? infoOf(ctx, best) : null;
  }
  return undefined;
}

export function onDestroy(ctx: PageContext): void {
  unpin(ctx);
  const s = st(ctx);
  try {
    if (s.frame) ctx.window?.cancelAnimationFrame(s.frame);
  } catch {
    /* window gone */
  }
}
