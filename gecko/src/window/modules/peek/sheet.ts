// The peek sheet: its geometry and the elements drawn around the page (ported from
// app/src/renderer/modules/peek/sheet.ts; look and sizes from the PeekMotion / PeekOpen boards).
//
// Stacking, back to front:
//   #tabbrowser-tabpanels   the selected tab's panel (the page under the sheet)
//                           .vitre-peek-dim     the page dim (0.22), takes the click on the dim
//                           .vitre-peek-frame   the sheet's background and shadow
//                           .vitre-peek-panel   the peek's own tab panel: the live page
//   #vitre-root             layer 'peek' (z 8): .vp-sheet with the header, the frosted cover until the
//                           first paint, the hop snapshot and the rim; the wash after closing
//                           bar (z 10), find (12), ... ; layer 'peek-rise' (z 11): the capsule that
//                           rises into the bar on Open as tab
// The dim, frame and page live in the tab panels because the bar (in #vitre-root, above every
// panel) must stay above the dim; the header is drawn in Deer's layer, sized to the sheet.
//
// Motion: the page is never resized while it moves. It is laid out at its resting box and posed
// with a translate and a rounded clip-path that follow the sheet's box (poseView), one rAF loop for
// frame, chrome and page (motion.ts tween).
import { el, svg } from '../../dom';
import { icons } from '../../icons';
import { setTip } from '../../tips';
import { type Ease, type Fade, fadeAt, lerp, tween } from './motion';
import * as gk from './gecko';

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

/** A page posed in the sheet: the panel, the box it is laid out at, and how much of its top is hidden (px). */
export interface PosedPage {
  panel: HTMLElement;
  layout: Box;
  lift?: (k: number) => number;
}

export interface PoseAnim {
  from: Pose;
  to: Pose;
  ms: number;
  ease: Ease;
  /** Opacity of the sheet (and of the page, unless pageFade is given). */
  fade: Fade;
  pages: PosedPage[];
  pageFade?: Fade;
  done?: () => void;
}

export const HEADER = 44;
export const RADIUS = 22;
const TOP = 72;

const OPEN_TAB_ICON =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 4.5h4.5V9"/><path d="M15.5 4.5 9.5 10.5"/></svg>';
const CLOSE_ICON =
  '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';
const BACK_ICON =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.8 6.8 10l5.2 5.2"/></svg>';

/** The area the sheet lives in (the tab panels, i.e. the window below nothing: pages fill the window). */
export function area(): DOMRect {
  return gk.tabpanels().getBoundingClientRect();
}

/**
 * The sheet for this window (window coordinates): 72% of the width in 8 px steps (720 to 1120), the
 * full height minus 96, under the bar. 1040×804 at (200, 72) in a 1440×900 window. Below 900×600 it
 * fills the window under the bar with 8 px margins.
 */
export function sheetBox(a: DOMRect = area()): Box {
  const W = a.width;
  const H = a.height;
  if (W < 900 || H < 600) return { x: a.left + 8, y: a.top + TOP, w: Math.max(1, W - 16), h: Math.max(HEADER + 40, H - 80), r: RADIUS };
  const w = Math.min(1120, Math.max(720, Math.round((W * 0.72) / 8) * 8));
  return { x: a.left + Math.round((W - w) / 2), y: a.top + TOP, w, h: H - 96, r: RADIUS };
}

export function windowBox(a: DOMRect = area()): Box {
  return { x: a.left, y: a.top, w: a.width, h: a.height, r: 0 };
}

/** The page's own rectangle inside a pose. */
export function contentOf(p: Pose): Box {
  return { x: p.box.x, y: p.box.y + p.off, w: p.box.w, h: p.box.h - p.off, r: p.box.r };
}

/** A smaller sheet in the same place (an open or close without a link to grow from). */
export function shrunk(s: Box): Box {
  return { x: s.x + s.w * 0.04, y: s.y + s.h * 0.04, w: s.w * 0.92, h: s.h * 0.92, r: s.r };
}

/** Header text: the domain and the path and query (readable, without the bare "/"). */
export function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) {
      if (u.protocol === 'file:') return { host: decodeURIComponent(u.pathname.split('/').pop() || 'file'), rest: '' };
      return { host: url, rest: '' };
    }
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

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    box: { x: lerp(a.box.x, b.box.x, k), y: lerp(a.box.y, b.box.y, k), w: lerp(a.box.w, b.box.w, k), h: lerp(a.box.h, b.box.h, k), r: lerp(a.box.r, b.box.r, k) },
    off: lerp(a.off, b.off, k),
  };
}

/**
 * Lay the peek's panel out at `layout` (its resting box, so the page never re-lays out while it
 * moves) and show it as if it sat in the sheet at `p`: its top under the header, clipped to the
 * sheet. `lift` px of the page's top stay hidden above the content's top edge (Open as tab: the
 * page's inset strip appears as the page reaches the bar).
 */
export function poseView(panel: HTMLElement, layout: Box, p: Pose, opacity: number, lift = 0, a: DOMRect = area()): void {
  const c = contentOf(p);
  const s = panel.style;
  s.left = px(layout.x - a.left);
  s.top = px(layout.y - a.top);
  s.width = px(layout.w);
  s.height = px(layout.h);
  const dx = c.x - layout.x;
  const dy = c.y - layout.y - lift;
  s.transform = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 ? `translate(${px(dx)}, ${px(dy)})` : 'none';
  const top = Math.max(0, p.box.r - p.off);
  const right = Math.max(0, layout.w - c.w);
  const bottom = Math.min(layout.h, Math.max(0, layout.h - c.h - lift));
  s.clipPath = `inset(${px(lift)} ${px(right)} ${px(bottom)} 0px round ${px(top)} ${px(top)} ${px(p.box.r)} ${px(p.box.r)})`;
  s.opacity = String(Math.round(opacity * 1000) / 1000);
}

/** Forget everything poseView set, so the panel follows the tab panels' own rules again. */
export function releaseView(panel: HTMLElement): void {
  for (const prop of ['left', 'top', 'width', 'height', 'transform', 'clip-path', 'opacity', 'translate']) panel.style.removeProperty(prop);
}

export interface SheetHandlers {
  close(): void;
  promote(): void;
  back(): void;
  dimClick(e: MouseEvent): void;
  headerMenu(e: MouseEvent): void;
}

export class Sheet {
  readonly dim: HTMLElement;
  readonly frame: HTMLElement;
  readonly chrome: HTMLElement;
  readonly head: HTMLElement;
  private back: HTMLButtonElement;
  private open: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private site: HTMLElement;
  private load: HTMLElement;
  private cover: HTMLElement;
  private snap: HTMLCanvasElement;
  private shownUrl = '';
  private stop: (() => void) | null = null;
  private snapTimer = 0;
  /** Where the sheet is drawn right now (mid-move included). */
  current: Pose | null = null;

  constructor(layer: HTMLElement, h: SheetHandlers) {
    this.dim = el('div', { class: 'vitre-peek-dim', 'aria-hidden': 'true' });
    // Keep keyboard focus in the sheet's page when the dim is clicked.
    this.dim.addEventListener('mousedown', (e) => e.preventDefault());
    this.dim.addEventListener('click', (e) => h.dimClick(e));
    // Right-clicking the dim never closes the peek (MenuSpec, "Peek").
    this.dim.addEventListener('contextmenu', (e) => e.preventDefault());

    this.frame = el('div', { class: 'vitre-peek-frame', 'aria-hidden': 'true' });

    this.back = el('button', { type: 'button', class: 'vp-back', 'aria-label': 'Back' });
    this.back.append(svg(BACK_ICON));
    setTip(this.back, 'Back', 'Alt+Left');
    this.site = el('div', { class: 'vp-site' });
    this.open = el('button', { type: 'button', class: 'vp-open', 'aria-label': 'Open as tab' });
    this.open.append(svg(OPEN_TAB_ICON));
    this.closeBtn = el('button', { type: 'button', class: 'vp-close', 'aria-label': 'Close peek' });
    this.closeBtn.append(svg(CLOSE_ICON));
    setTip(this.closeBtn, 'Close peek', 'Esc');
    this.load = el('div', { class: 'vp-load', 'aria-hidden': 'true' });
    this.head = el('header', { class: 'vp-head' }, this.back, this.site, el('div', { class: 'vp-actions' }, this.open, this.closeBtn), this.load);
    this.cover = el('div', { class: 'vp-cover', 'aria-hidden': 'true' });
    this.snap = el('canvas', { class: 'vp-snap', 'aria-hidden': 'true' });
    this.chrome = el('section', { class: 'vp-sheet', 'aria-label': 'Peek' }, this.head, this.cover, this.snap, el('div', { class: 'vp-rim', 'aria-hidden': 'true' }));

    this.back.addEventListener('click', () => h.back());
    this.open.addEventListener('click', () => h.promote());
    this.closeBtn.addEventListener('click', () => h.close());
    // Like a toolbar, the sheet's chrome never takes focus from the page on a click: page keys
    // (Alt+Left, Ctrl+R) keep reaching the peek, not the tab under it.
    this.chrome.addEventListener('mousedown', (e) => e.preventDefault());
    this.head.addEventListener('dblclick', (e) => {
      if (!(e.target as Element).closest('button')) h.promote();
    });
    this.head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      h.headerMenu(e);
    });
    layer.append(this.chrome);
  }

  /** Put the dim and the frame into the tab panels (again: the panels are Firefox's). */
  attach(): void {
    const panels = gk.tabpanels();
    if (this.dim.parentNode !== panels) panels.append(this.dim);
    if (this.frame.parentNode !== panels) panels.append(this.frame);
  }

  /**
   * Move the sheet and its pages along `a`, one rAF loop for all of them. The containers' places
   * are measured once (a resize cancels the motion), so a frame writes styles and never reads layout.
   */
  animate(a: PoseAnim): void {
    this.cancel();
    const total = Math.max(a.ms, (a.fade.delay ?? 0) + a.fade.ms, a.pageFade ? (a.pageFade.delay ?? 0) + a.pageFade.ms : 0);
    const origins = this.origins();
    this.stop = tween(
      total,
      (elapsed) => {
        const k = a.ms > 0 ? a.ease(Math.min(1, elapsed / a.ms)) : 1;
        const p = lerpPose(a.from, a.to, k);
        const o = fadeAt(a.fade, elapsed);
        const po = a.pageFade ? fadeAt(a.pageFade, elapsed) : o;
        this.place(p, o, origins);
        for (const v of a.pages) poseView(v.panel, v.layout, p, po, v.lift ? v.lift(k) : 0, origins.panels);
      },
      () => {
        this.stop = null;
        a.done?.();
      }
    );
  }

  cancel(): void {
    this.stop?.();
    this.stop = null;
  }

  get moving(): boolean {
    return !!this.stop;
  }

  /** Where the tab panels and Deer's layer are in the window (the frame and the chrome are placed in them). */
  private origins(): { panels: DOMRect; layer: DOMRect } {
    return { panels: area(), layer: this.chrome.parentElement?.getBoundingClientRect() ?? new DOMRect() };
  }

  /** Put the frame (tab panels coordinates) and the chrome (layer coordinates) at `p`. */
  place(p: Pose, opacity: number, origins = this.origins()): void {
    this.current = p;
    const a = origins.panels;
    const layer = origins.layer;
    const o = String(Math.round(opacity * 1000) / 1000);
    const set = (node: HTMLElement, ox: number, oy: number): void => {
      const s = node.style;
      s.left = px(p.box.x - ox);
      s.top = px(p.box.y - oy);
      s.width = px(p.box.w);
      s.height = px(p.box.h);
      s.borderRadius = px(p.box.r);
      s.opacity = o;
      node.classList.add('on');
    };
    set(this.frame, a.left, a.top);
    set(this.chrome, layer.left, layer.top);
    // The cover and the hop snapshot fill the page's part of the sheet.
    const top = px(p.off);
    if (this.cover.style.top !== top) this.cover.style.top = top;
    if (this.snap.style.top !== top) this.snap.style.top = top;
  }

  /** The Open as tab key (rebindable), in its tooltip as plain dim text. */
  promoteKey(spec: string): void {
    setTip(this.open, 'Open as tab', spec);
  }

  /** Open as tab: the header and rim give way while the sheet fills the window. */
  filling(on: boolean): void {
    this.chrome.classList.toggle('full', on);
  }

  /** Closing: the sheet no longer takes clicks, so they reach the page under it as it shrinks away. */
  leaving(on: boolean): void {
    for (const node of [this.frame, this.chrome]) node.classList.toggle('leaving', on);
  }

  hide(): void {
    this.cancel();
    for (const node of [this.frame, this.chrome]) node.classList.remove('on', 'full', 'leaving');
    this.dimmed(false, 0);
    this.loading(false);
    this.clearSnapshot();
    this.shownUrl = '';
    this.site.replaceChildren();
    this.current = null;
  }

  dimmed(on: boolean, ms: number): void {
    this.dim.style.transition = ms ? (on ? `opacity ${ms}ms ease` : `opacity ${ms}ms ease, visibility 0s linear ${ms}ms`) : 'none';
    this.dim.classList.toggle('on', on);
  }

  /** Which page is in the sheet: favicon, domain (Semibold) and the dimmed path. */
  showSite(url: string, favicon: string | null, crossfade: number): void {
    const { host } = splitUrl(url);
    this.chrome.setAttribute('aria-label', `Peek: ${host || url}`);
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
    const { host, rest } = splitUrl(url);
    const row = el('div', { class: 'vp-id' }, this.favicon(favicon), el('span', { class: 'dom' }, host), el('span', { class: 'path' }, rest));
    row.dataset.favicon = favicon ?? '';
    return row;
  }

  private favicon(src: string | null): HTMLElement {
    const fav = el('span', { class: 'fav' });
    if (!src) {
      fav.append(svg(icons.globe));
      return fav;
    }
    const img = el('img', { alt: '', draggable: 'false' });
    img.addEventListener('error', () => fav.replaceChildren(svg(icons.globe)));
    img.src = src;
    fav.append(img);
    return fav;
  }

  /** The domain's box in the window, for the capsule that rises into the bar. */
  siteRect(): DOMRect | null {
    const row = this.site.lastElementChild;
    const dom = row?.querySelector('.dom');
    if (!row || !dom) return null;
    const a = row.getBoundingClientRect();
    const b = dom.getBoundingClientRect();
    return new DOMRect(a.left, a.top, b.right - a.left, a.height);
  }

  /** The element permission doorhangers hang from: the site row (favicon, domain, path), so they hang under the header. */
  siteAnchor(): Element | null {
    return this.site;
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

  get isLoading(): boolean {
    return this.load.classList.contains('loading');
  }

  /** The frosted cover over the page until it first paints. */
  covered(on: boolean, fadeMs = 200): void {
    this.cover.style.transitionDuration = on ? '0ms' : `${fadeMs}ms`;
    this.cover.classList.toggle('gone', !on);
  }

  get isCovered(): boolean {
    return !this.cover.classList.contains('gone');
  }

  /** A hop: the old page's last frame over the content, until the new page paints. */
  showSnapshot(bitmap: ImageBitmap, cssWidth: number, cssHeight: number): void {
    window.clearTimeout(this.snapTimer);
    const c = this.snap;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.style.width = px(cssWidth);
    c.style.height = px(cssHeight);
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
    c.style.transitionDuration = '0ms';
    c.classList.add('on');
  }

  /** Cross-fade the hop snapshot away (the new page painted). */
  fadeSnapshot(ms: number): void {
    const c = this.snap;
    if (!c.classList.contains('on')) return;
    c.style.transitionDuration = `${ms}ms`;
    c.classList.remove('on');
    window.clearTimeout(this.snapTimer);
    this.snapTimer = window.setTimeout(() => {
      c.width = 1;
      c.height = 1;
    }, ms + 40);
  }

  get hasSnapshot(): boolean {
    return this.snap.classList.contains('on');
  }

  clearSnapshot(): void {
    window.clearTimeout(this.snapTimer);
    this.snap.classList.remove('on');
    this.snap.width = 1;
    this.snap.height = 1;
  }

  /** While find's capsule sits in the header, the domain and path give way (FindSpec, "Peek"). */
  covering(on: boolean): void {
    this.head.classList.toggle('find', on);
  }

  /** The header region in the window. */
  headerRect(): DOMRect {
    return this.head.getBoundingClientRect();
  }

  /**
   * The header's free slot for find's 440×32 capsule: from 8 px right of the favicon to 8 px left of
   * the buttons, vertically centred (window (238,78)-(678,110) for the sheet at (200,72)). The
   * favicon moves right when the back button shows (.can-back): the slot follows it.
   */
  slotRect(): DOMRect {
    const h = this.head.getBoundingClientRect();
    const favs = Array.from(this.site.querySelectorAll<HTMLElement>('.vp-id .fav'))
      .map((f) => f.getBoundingClientRect())
      .filter((r) => r.width > 0);
    const fav = favs[favs.length - 1];
    const left = fav ? fav.right + 8 : h.left + 38;
    const right = this.open.getBoundingClientRect().left - 8;
    return new DOMRect(left, h.top + 6, Math.max(0, Math.min(440, right - left)), 32);
  }

  /** The header's first control, for F6 (peek page -> peek header -> address field). */
  focusHeader(): void {
    const first = this.head.classList.contains('can-back') ? this.back : this.open;
    first.focus({ focusVisible: true } as FocusOptions);
  }

  headerHasFocus(): boolean {
    return this.head.contains(document.activeElement);
  }
}
