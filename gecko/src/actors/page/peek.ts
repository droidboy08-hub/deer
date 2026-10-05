// Peek, page side (the Gecko counterpart of app/src/preload/page-modules/peek.ts). Runs next to
// every tab's documents; the window module is src/window/modules/peek.
//
// What it does
//   - Remembers the link of a trusted Shift+click in the top document (Shift+Enter on a focused
//     link arrives as the same click), so the window can grow the sheet out of that link and give
//     focus back to it when the peek closes. The request itself reaches the window through
//     ClickHandlerParent (b.interceptOpen), which only sees clicks the page did not preventDefault.
//   - Answers which link Ctrl+Q means (the focused link when it was reached with the keyboard, else
//     the link under the pointer; never while the user is typing in a field), which link sits at
//     a point (Shift+click on the dimmed page around a sheet: hop), where a remembered link is now
//     and focuses it.
//   - Reports the first trusted input in each document (peek:typed): once the user typed in a
//     peek, a click on the dim or Esc Esc only nudges the sheet, so nothing typed is lost.
//
// Messages to the window
//   peek:typed      {}                         first trusted 'input' event in this document
// Queries from the window (top document; rects are CSS px of the page's viewport)
//   peek:gesture    { href }   -> LinkInfo | null   the Shift+click / Shift+Enter link of the last
//                                                   1.5 s with this href (or the latest of the last 1 s)
//   peek:query      { x?, y? } -> LinkInfo | null   Ctrl+Q: focused link (keyboard) or the link at x, y
//   peek:at         { x, y }   -> LinkInfo | null   the link at a point
//   peek:locate     { id }     -> { rect, row } | null   where a remembered link is now
//   peek:focus      { id }                         focus a remembered link (no scroll)
//   LinkInfo = { id, href, rect: Box, row: Box | null }, Box = { x, y, w, h, r }. `row` is the list
//   row, table row or card around the link when it is row sized (the wash after closing lights it).
//
// Rules (page-api.ts): state per document in ctx.state; everything read here is the page's and is
// narrowed by the window; no DOM constructors from this scope (Xrays): elements are told apart by
// localName. Firefox internals used: Element.openOrClosedShadowRoot (chrome-only,
// dom/webidl/Element.webidl), as devtools' shared/layout/utils.js uses it.
import type { PageContext } from '../page-api';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

interface LinkInfo {
  id: number;
  href: string;
  rect: Box;
  row: Box | null;
}

interface State {
  links?: Map<number, WeakRef<Element>>;
  nextId?: number;
  gestures?: { info: LinkInfo; at: number }[];
  typed?: boolean;
}

const LINK = 'a[href], area[href]';
/** Containers that read as "the link's row" for the wash after closing. */
const ROW = 'li, tr, dt, dd, article, [role="row"], [role="listitem"], [role="option"], [role="article"]';
const NOT_TEXT = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range', 'hidden']);
const GESTURE_MS = 1500;
const MAX_REMEMBERED = 16;

const st = (ctx: PageContext): State => ctx.state as State;

function hrefOf(el: Element | null): string {
  if (!el) return '';
  try {
    const href = (el as HTMLAnchorElement).href as unknown;
    // SVG <a> has an SVGAnimatedString.
    if (typeof href === 'string') return href;
    const anim = href as { animVal?: string } | null;
    return anim && typeof anim.animVal === 'string' ? new URL(anim.animVal, el.ownerDocument?.baseURI).href : '';
  } catch {
    return '';
  }
}

const isWeb = (href: string): boolean => /^https?:/i.test(href);

function shadowOf(el: Element): ShadowRoot | null {
  return ((el as any).openOrClosedShadowRoot ?? el.shadowRoot ?? null) as ShadowRoot | null;
}

/** closest(LINK), climbing out of shadow roots. */
function closestLink(start: Element | null): Element | null {
  let n: Node | null = start;
  while (n) {
    if (n.nodeType === 1 && (n as Element).matches(LINK)) return n as Element;
    const parent: Node | null = n.parentNode;
    n = parent && parent.nodeType === 11 ? ((parent as ShadowRoot).host ?? null) : parent;
  }
  return null;
}

function linkInEvent(e: Event): Element | null {
  try {
    for (const n of e.composedPath()) {
      const el = n as Element;
      if (el && el.nodeType === 1 && el.matches(LINK)) return el;
    }
  } catch {
    /* no path */
  }
  return null;
}

function deepActive(doc: Document): Element | null {
  let el = doc.activeElement;
  for (let i = 0; el && i < 16; i++) {
    const inner = shadowOf(el)?.activeElement ?? null;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function elementAt(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  for (let i = 0; el && i < 16; i++) {
    const root = shadowOf(el);
    const inner = root ? root.elementFromPoint(x, y) : null;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function editing(el: Element | null): boolean {
  if (!el) return false;
  const name = el.localName;
  if (name === 'textarea') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
  if (name === 'input') {
    const input = el as HTMLInputElement;
    return !NOT_TEXT.has(String(input.type)) && !input.readOnly && !input.disabled;
  }
  return !!(el as HTMLElement).isContentEditable;
}

function clampBox(win: Window, b: Box): Box {
  const w = Math.max(1, Math.min(b.w, win.innerWidth));
  const h = Math.max(1, Math.min(b.h, win.innerHeight));
  const x = Math.min(Math.max(b.x, 0), Math.max(0, win.innerWidth - w));
  const y = Math.min(Math.max(b.y, 0), Math.max(0, win.innerHeight - h));
  return { x, y, w, h, r: b.r };
}

/** The link's own box: the line box under the point for a wrapped link, else the first one. */
function linkBox(win: Window, el: Element, at?: { x: number; y: number } | null): Box {
  const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const hit = at ? rects.find((r) => at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom) : undefined;
  const r = hit ?? rects[0];
  if (!r) {
    // <area> and display: contents links have no boxes of their own.
    const p = at ?? { x: win.innerWidth / 2, y: win.innerHeight / 2 };
    return clampBox(win, { x: p.x - 8, y: p.y - 8, w: 16, h: 16, r: 6 });
  }
  return clampBox(win, { x: r.left, y: r.top, w: r.width, h: r.height, r: 4 });
}

/** A row around the link, if it is row sized. */
function rowBox(win: Window, el: Element, link: Box): Box | null {
  const row = el.closest(ROW);
  if (!row) return null;
  const r = row.getBoundingClientRect();
  if (r.width < link.w || r.height < link.h || r.height > Math.max(120, link.h * 4)) return null;
  let radius = 0;
  try {
    radius = parseFloat(win.getComputedStyle(row)?.borderTopLeftRadius ?? '') || 0;
  } catch {
    radius = 0;
  }
  return clampBox(win, { x: r.left, y: r.top, w: r.width, h: r.height, r: Math.min(radius, r.height / 2) });
}

function remember(ctx: PageContext, el: Element): number {
  const s = st(ctx);
  s.links ??= new Map();
  // Ids differ between documents, so an id from the page a peek came from never names an element
  // of the next document in that tab.
  s.nextId ??= 1 + Math.floor(Math.random() * 1e6) * 64;
  const id = s.nextId++;
  s.links.set(id, new WeakRef(el));
  if (s.links.size > MAX_REMEMBERED) s.links.delete(s.links.keys().next().value as number);
  return id;
}

function recall(ctx: PageContext, id: unknown): Element | null {
  if (typeof id !== 'number') return null;
  const el = st(ctx).links?.get(id)?.deref() ?? null;
  return el && el.isConnected ? el : null;
}

function describe(ctx: PageContext, el: Element, at?: { x: number; y: number } | null): LinkInfo | null {
  const win = ctx.window;
  const href = hrefOf(el);
  if (!win || !href) return null;
  const rect = linkBox(win, el, at);
  return { id: remember(ctx, el), href, rect, row: rowBox(win, el, rect) };
}

function point(data: unknown): { x: number; y: number } | null {
  const d = data as { x?: unknown; y?: unknown } | null;
  if (!d || typeof d.x !== 'number' || typeof d.y !== 'number' || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
  return { x: d.x, y: d.y };
}

export const events = {
  // Capture on the frame's root: runs before the page's own listeners, whatever they do later.
  click: { capture: true },
  input: { capture: true, createActor: false },
};

export function onEvent(ctx: PageContext, event: Event): void {
  if (!event.isTrusted) return;
  if (event.type === 'input') {
    const s = st(ctx);
    if (s.typed) return;
    s.typed = true;
    ctx.send('peek:typed', {});
    return;
  }
  if (event.type !== 'click' || !ctx.isTop) return;
  const e = event as MouseEvent;
  if (e.button !== 0 || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const link = linkInEvent(e);
  if (!link) return;
  // Keyboard activation (Shift+Enter) arrives as a click with detail 0 and no useful point.
  const info = describe(ctx, link, e.detail > 0 ? { x: e.clientX, y: e.clientY } : null);
  if (!info) return;
  const s = st(ctx);
  const now = Date.now();
  s.gestures = (s.gestures ?? []).filter((g) => now - g.at < GESTURE_MS);
  s.gestures.push({ info, at: now });
  if (s.gestures.length > 8) s.gestures.shift();
}

export function onMessage(ctx: PageContext, name: string, data: unknown): unknown {
  if (!name.startsWith('peek:')) return undefined;
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win) return null;
  switch (name) {
    case 'peek:gesture': {
      const href = typeof (data as any)?.href === 'string' ? ((data as any).href as string) : '';
      const s = st(ctx);
      const now = Date.now();
      const recent = (s.gestures ?? []).filter((g) => now - g.at < GESTURE_MS);
      // The same address, or (for a page that rewrote the link as it was clicked) the latest one.
      const g = recent.find((x) => x.info.href === href) ?? recent.filter((x) => now - x.at < 1000).pop();
      s.gestures = [];
      return g?.info ?? null;
    }
    case 'peek:query': {
      const active = deepActive(doc);
      if (editing(active)) return null;
      // A link reached with the keyboard wins; after mouse use, the link under the pointer does.
      const focused = closestLink(active);
      let byKeyboard = false;
      try {
        byKeyboard = !!focused && isWeb(hrefOf(focused)) && !!active?.matches(':focus-visible');
      } catch {
        byKeyboard = false;
      }
      const at = point(data);
      const hovered = at ? closestLink(elementAt(doc, at.x, at.y)) : null;
      const link = byKeyboard || !hovered || !isWeb(hrefOf(hovered)) ? focused : hovered;
      if (!link || !isWeb(hrefOf(link))) return null;
      return describe(ctx, link, link === hovered ? at : null);
    }
    case 'peek:at': {
      const at = point(data);
      if (!at) return null;
      const link = closestLink(elementAt(doc, at.x, at.y));
      return link ? describe(ctx, link, at) : null;
    }
    case 'peek:locate': {
      const el = recall(ctx, (data as any)?.id);
      if (!el) return null;
      const rect = linkBox(win, el);
      return { rect, row: rowBox(win, el, rect) };
    }
    case 'peek:focus': {
      const el = recall(ctx, (data as any)?.id) as HTMLElement | null;
      try {
        el?.focus({ preventScroll: true });
      } catch {
        /* not focusable */
      }
      return true;
    }
  }
  return undefined;
}
