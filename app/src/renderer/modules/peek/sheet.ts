// The peek sheet's chrome and geometry. The page itself is a <webview> that lives directly in
// #views (so it can become a tab without reloading); the sheet is drawn around it in layers:
// dim, frame (background and shadow), the page, then header, cover and rim on top.
import type { WebviewTag } from 'electron';
import { icons } from '../../icons';
import { displayHost } from '../../url';
import { type Ease, type Fade, fadeAt, lerp, tween } from './motion';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** Where the sheet is: its box, and how far the page sits below its top (the header, or 0). */
export interface Pose {
  box: Box;
  off: number;
}

/** A move of the sheet and its pages from one pose to another, with an opacity fade. */
export interface PoseAnim {
  from: Pose;
  to: Pose;
  ms: number;
  ease: Ease;
  /** Opacity of the sheet (and of the pages, unless viewFade is given). */
  fade: Fade;
  views: { wv: WebviewTag; layout: Box }[];
  viewFade?: Fade;
  done?: () => void;
}

export const HEADER = 44;

const OPEN_TAB_ICON =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 4.5h4.5V9"/><path d="M15.5 4.5 9.5 10.5"/></svg>';
const CLOSE_ICON =
  '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';
const BACK_ICON =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.8 6.8 10l5.2 5.2"/></svg>';

/**
 * The sheet for this window: 72% of the width in 8 px steps (720 to 1120), the full height
 * minus 96, under the tab bar. 1040×804 at (200, 72) in a 1440×900 window. Below 900×600 it
 * fills the window under the bar with 8 px margins.
 */
export function sheetBox(W = window.innerWidth, H = window.innerHeight): Box {
  if (W < 900 || H < 600) return { x: 8, y: 72, w: Math.max(1, W - 16), h: Math.max(HEADER + 40, H - 80), r: 22 };
  const w = Math.min(1120, Math.max(720, Math.round((W * 0.72) / 8) * 8));
  return { x: Math.round((W - w) / 2), y: 72, w, h: H - 96, r: 22 };
}

export function windowBox(): Box {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, r: 0 };
}

/** The page's own rectangle inside a pose. */
export function contentOf(p: Pose): Box {
  return { x: p.box.x, y: p.box.y + p.off, w: p.box.w, h: p.box.h - p.off, r: p.box.r };
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Header text: the domain, and the path and query (readable, without the bare "/"). */
function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { host: displayHost(url), rest: '' };
    let rest = `${u.pathname}${u.search}`;
    try {
      rest = decodeURI(rest);
    } catch {
      /* keep it encoded */
    }
    return { host: u.host.replace(/^www\./, ''), rest: rest === '/' ? '' : rest };
  } catch {
    return { host: url, rest: '' };
  }
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    box: { x: lerp(a.box.x, b.box.x, k), y: lerp(a.box.y, b.box.y, k), w: lerp(a.box.w, b.box.w, k), h: lerp(a.box.h, b.box.h, k), r: lerp(a.box.r, b.box.r, k) },
    off: lerp(a.off, b.off, k),
  };
}

/**
 * Lay a page out at `layout` (its resting box, so it never re-lays out while moving) and show
 * it as if it sat in the sheet at `p`: anchored under the header and clipped to the sheet.
 */
export function poseView(wv: WebviewTag, layout: Box, p: Pose, opacity: number): void {
  const c = contentOf(p);
  const s = wv.style;
  s.left = px(layout.x);
  s.top = px(layout.y);
  s.width = px(layout.w);
  s.height = px(layout.h);
  const dx = c.x - layout.x;
  const dy = c.y - layout.y;
  s.transform = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 ? `translate(${px(dx)}, ${px(dy)})` : 'none';
  const top = Math.max(0, p.box.r - p.off);
  const right = Math.max(0, layout.w - c.w);
  const bottom = Math.min(layout.h, Math.max(0, layout.h - c.h));
  s.clipPath = `inset(0px ${px(right)} ${px(bottom)} 0px round ${px(top)} ${px(top)} ${px(p.box.r)} ${px(p.box.r)})`;
  s.opacity = String(Math.round(opacity * 1000) / 1000);
}

/** Forget everything poseView set, so the page follows the stylesheet again (as a tab). */
export function releaseView(wv: WebviewTag): void {
  for (const prop of ['left', 'top', 'width', 'height', 'transform', 'clip-path', 'opacity', 'translate']) wv.style.removeProperty(prop);
}

export interface SheetHandlers {
  close(): void;
  promote(): void;
  back(): void;
  retry(): void;
  dimClick(e: MouseEvent): void;
  isPromoteKey(e: KeyboardEvent): boolean;
}

export class Sheet {
  readonly dim: HTMLElement;
  readonly frame: HTMLElement;
  readonly chrome: HTMLElement;
  readonly head: HTMLElement;
  private site: HTMLElement;
  private load: HTMLElement;
  private cover: HTMLElement;
  private error: HTMLElement;
  private errorDetail: HTMLElement;
  private shownUrl = '';
  private stop: (() => void) | null = null;
  /** Where the sheet is drawn right now (mid-move included). */
  current: Pose | null = null;

  constructor(root: HTMLElement, h: SheetHandlers) {
    this.dim = document.createElement('div');
    this.dim.className = 'vt-peek-dim';
    this.dim.setAttribute('aria-hidden', 'true');
    this.dim.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the peek
    this.dim.addEventListener('click', (e) => h.dimClick(e));
    this.dim.addEventListener('contextmenu', (e) => e.preventDefault());

    this.frame = document.createElement('div');
    this.frame.className = 'vt-peek-frame';
    this.frame.setAttribute('aria-hidden', 'true');

    this.chrome = document.createElement('section');
    this.chrome.className = 'vt-peek-sheet';
    this.chrome.innerHTML = `
      <header class="vt-peek-head">
        <button type="button" class="vt-peek-back" aria-label="Back" title="Back  Alt+Left">${BACK_ICON}</button>
        <div class="vt-peek-site"></div>
        <div class="vt-peek-actions">
          <button type="button" class="vt-peek-open" aria-label="Open as tab" title="Open as tab  Alt+Enter">${OPEN_TAB_ICON}</button>
          <button type="button" class="vt-peek-close" aria-label="Close peek" title="Close peek  Esc">${CLOSE_ICON}</button>
        </div>
        <div class="vt-peek-load" aria-hidden="true"></div>
      </header>
      <div class="vt-peek-cover" aria-hidden="true"></div>
      <div class="vt-peek-error" role="alert" hidden><div>
        <h2>Can’t reach this page</h2>
        <p class="vt-peek-error-detail"></p>
        <button type="button">Try again</button>
      </div></div>
      <div class="vt-peek-rim" aria-hidden="true"></div>`;
    const q = <T extends HTMLElement>(sel: string) => this.chrome.querySelector(sel) as T;
    this.head = q('.vt-peek-head');
    this.site = q('.vt-peek-site');
    this.load = q('.vt-peek-load');
    this.cover = q('.vt-peek-cover');
    this.error = q('.vt-peek-error');
    this.errorDetail = q('.vt-peek-error-detail');
    q('.vt-peek-back').addEventListener('click', () => h.back());
    q('.vt-peek-open').addEventListener('click', () => h.promote());
    q('.vt-peek-close').addEventListener('click', () => h.close());
    q('.vt-peek-error button').addEventListener('click', () => h.retry());
    // Like a toolbar, the sheet's chrome never takes focus from the page on a click: page keys
    // (Alt+Left, Ctrl+R) must keep reaching the peek, not the tab under it. The error text
    // stays selectable.
    this.chrome.addEventListener('mousedown', (e) => {
      if (!(e.target as Element).closest('.vt-peek-error-detail')) e.preventDefault();
    });
    this.head.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('button')) h.promote();
    });
    this.chrome.addEventListener('keydown', (e) => {
      if (!e.repeat && h.isPromoteKey(e)) {
        e.preventDefault();
        h.promote();
      }
    });
    root.append(this.dim, this.frame, this.chrome);
  }

  /** Move the sheet and its pages along `a`, one rAF loop for all of them. */
  animate(a: PoseAnim): void {
    this.cancel();
    const total = Math.max(a.ms, (a.fade.delay ?? 0) + a.fade.ms);
    this.stop = tween(
      total,
      (elapsed) => {
        const p = lerpPose(a.from, a.to, a.ms > 0 ? a.ease(Math.min(1, elapsed / a.ms)) : 1);
        const o = fadeAt(a.fade, elapsed);
        const vo = a.viewFade ? fadeAt(a.viewFade, elapsed) : o;
        this.place(p, o);
        for (const v of a.views) poseView(v.wv, v.layout, p, vo);
      },
      () => {
        this.stop = null;
        a.done?.();
      },
    );
  }

  cancel(): void {
    this.stop?.();
    this.stop = null;
  }

  /** Put the frame and the chrome at `p`. */
  place(p: Pose, opacity: number): void {
    this.current = p;
    for (const el of [this.frame, this.chrome]) {
      el.style.left = px(p.box.x);
      el.style.top = px(p.box.y);
      el.style.width = px(p.box.w);
      el.style.height = px(p.box.h);
      el.style.borderRadius = px(p.box.r);
      el.style.opacity = String(Math.round(opacity * 1000) / 1000);
      el.classList.add('on');
    }
  }

  /** The Open as tab key, shown in its tooltip as plain text. */
  promoteLabel(spec: string): void {
    (this.head.querySelector('.vt-peek-open') as HTMLElement).title = `Open as tab  ${spec}`;
  }

  /** Open as tab: the header and rim give way (CSS, 140 ms) while the sheet fills the window. */
  filling(on: boolean): void {
    this.chrome.classList.toggle('full', on);
  }

  /** Closing: the sheet no longer takes clicks, so they reach the page as it shrinks away. */
  leaving(on: boolean): void {
    for (const el of [this.frame, this.chrome]) el.classList.toggle('leaving', on);
  }

  hide(): void {
    this.cancel();
    for (const el of [this.frame, this.chrome]) el.classList.remove('on', 'full', 'leaving');
    this.dimmed(false, 0);
    this.loading(false);
    this.error.hidden = true;
    this.shownUrl = '';
    this.site.replaceChildren();
  }

  dimmed(on: boolean, ms: number): void {
    this.dim.style.transition = ms ? (on ? `opacity ${ms}ms ease` : `opacity ${ms}ms ease, visibility 0s linear ${ms}ms`) : 'none';
    this.dim.classList.toggle('on', on);
  }

  /** Show which page is in the sheet: favicon, domain (semibold) and the dimmed path. */
  showSite(url: string, favicon: string | null, crossfade: number): void {
    const label = `Peek: ${displayHost(url) || url}`;
    this.chrome.setAttribute('aria-label', label);
    const current = this.site.lastElementChild as HTMLElement | null;
    if (url === this.shownUrl && current) {
      // Same page: only the favicon may have arrived.
      if (current.dataset.favicon !== (favicon ?? '')) current.querySelector('.fav')?.replaceWith(this.favicon(favicon));
      current.dataset.favicon = favicon ?? '';
      return;
    }
    this.shownUrl = url;
    const next = this.siteRow(url, favicon);
    const old = Array.from(this.site.children) as HTMLElement[];
    if (!crossfade || !old.length) {
      this.site.replaceChildren(next);
      return;
    }
    next.classList.add('out');
    next.style.transitionDuration = `${crossfade}ms`;
    this.site.append(next);
    void next.offsetWidth;
    next.classList.remove('out');
    for (const o of old) {
      o.style.transitionDuration = `${crossfade}ms`;
      o.classList.add('out');
      window.setTimeout(() => o.remove(), crossfade + 40);
    }
  }

  private siteRow(url: string, favicon: string | null): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vt-peek-id';
    row.dataset.favicon = favicon ?? '';
    const dom = document.createElement('span');
    dom.className = 'dom';
    const path = document.createElement('span');
    path.className = 'path';
    const { host, rest } = splitUrl(url);
    dom.textContent = host;
    path.textContent = rest;
    row.append(this.favicon(favicon), dom, path);
    return row;
  }

  private favicon(src: string | null): HTMLElement {
    const fav = document.createElement('span');
    fav.className = 'fav';
    if (!src) {
      fav.innerHTML = icons.globe;
      return fav;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = src;
    img.addEventListener('error', () => (fav.innerHTML = icons.globe));
    fav.append(img);
    return fav;
  }

  /** The domain's box in the window, for the capsule that rises into the tab bar. */
  siteRect(): DOMRect | null {
    const row = this.site.lastElementChild;
    const dom = row?.querySelector('.dom');
    if (!row || !dom) return null;
    const a = row.getBoundingClientRect();
    const b = dom.getBoundingClientRect();
    return new DOMRect(a.left, a.top, b.right - a.left, a.height);
  }

  canGoBack(on: boolean): void {
    this.head.classList.toggle('can-back', on);
  }

  loading(on: boolean): void {
    if (on) {
      if (this.load.classList.contains('loading')) return;
      this.load.classList.remove('done');
      this.load.style.transition = 'none';
      this.load.style.width = '0';
      void this.load.offsetWidth;
      this.load.style.removeProperty('transition');
      this.load.style.removeProperty('width');
      this.load.classList.add('loading');
    } else if (this.load.classList.contains('loading')) {
      this.load.classList.replace('loading', 'done');
    }
  }

  /** The frosted cover over the page until it first paints. */
  covered(on: boolean, fadeMs = 200): void {
    this.cover.style.transitionDuration = on ? '0ms' : `${fadeMs}ms, 380ms`;
    this.cover.classList.toggle('gone', !on);
  }

  failed(detail: string | null): void {
    this.error.hidden = detail === null;
    this.errorDetail.textContent = detail ?? '';
  }

  /** The header region, for other modules (find's capsule sits in it). */
  headerRect(): DOMRect {
    return this.head.getBoundingClientRect();
  }
}
