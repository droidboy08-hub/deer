// Page module for the right-click menus (src/window/modules/menus). Gecko's context data
// (nsContextMenu) has no geometry; this notes what Deer's menu needs while a contextmenu event
// dispatches in this frame:
//   - the link's line boxes (the target wash, and where a Peek grows from),
//   - the target element's box (where an image peek grows from),
//   - the selection: left and right edges, top of its first and bottom of its last line (a
//     keyboard-opened selection menu hangs below its last line),
//   - the focused element and its line height (a keyboard-opened menu hangs 4 px below Gecko's
//     anchor; with nothing focused it goes to a fixed point under the bar).
// Rectangles are CSS px of the TOP document's viewport when every frame between this one and the
// top lives in this process (frameElement offsets added); otherwise `partial` is true, they are
// relative to this frame's own viewport, and `screen` gives that viewport's place on the screen
// (window.mozInnerScreenX/Y in this frame's CSS px, and its devicePixelRatio), from which the
// window maps them (a cross-site frame in its own process: the wash and keyboard anchors still fit).
//
// Messages (window -> page):
//   menus:record      -> the last record of this frame (at most 3 s old) or null.
// Sent unasked (page -> window), once per contextmenu event, before Firefox's own ContextMenuChild
// (a system-group listener) sends the menu's data over the same channel, so the window has it when
// it builds the menu:
//   menus:hit         { inSelection, linkSelected }: the click fell inside the page's selection (a
//                     keyboard-opened menu counts as inside), and the selection reaches into the
//                     clicked link. Gecko keeps a selection on a right-click anywhere (Chromium, which
//                     the design describes, drops it): with these the menu is the selection menu only
//                     for a click on the selection, and a link's menu adds Copy only for a selection
//                     inside the link (DESIGN-NOTES "Which menu", Link).
// The page's own listeners are not touched (Shift+right-click reaching Deer on pages that cancel
// contextmenu is Gecko's own behaviour).
import type { PageContext } from '../page-api';

export const events = {
  // Capture on the frame's chrome event handler: before the page's own listeners, so a page that
  // stops the event does not hide the geometry.
  contextmenu: { capture: true },
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MenuRecord {
  t: number;
  /** Mouse button of the contextmenu event: 0 when the keyboard opened it (Shift+F10, Menu key). */
  button: number;
  link: Box[] | null;
  download: boolean;
  target: Box | null;
  selection: { left: number; right: number; top: number; bottom: number } | null;
  focused: Box | null;
  lineHeight: number | null;
  /**
   * Height of the caret in the focused field: the font's ascent + descent (what Gecko's nsCaret
   * draws), measured on a detached canvas. Gecko anchors a keyboard menu at the caret's bottom, so
   * the caret's line starts this far above it (a flipped menu ends 4 px above the word, MenuSpelling).
   */
  caretHeight: number | null;
  /** Rectangles are relative to this frame only (a frame of another process sits above it). */
  partial: boolean;
  /** With `partial`: this frame's viewport on the screen (CSS px of this frame) and its device pixel ratio. */
  screen?: { x: number; y: number; dpr: number } | null;
}

const MAX_RECTS = 24;
const FRESH_MS = 3000;

function offsetToTop(win: Window): { x: number; y: number; partial: boolean } {
  let x = 0;
  let y = 0;
  let cur: Window | null = win;
  for (let depth = 0; cur && depth < 16; depth++) {
    let parent: Window | null = null;
    try {
      parent = cur.parent;
    } catch {
      return { x, y, partial: true };
    }
    if (!parent || parent === cur) return { x, y, partial: false };
    let frame: Element | null = null;
    try {
      frame = cur.frameElement;
    } catch {
      frame = null;
    }
    if (!frame) return { x, y, partial: true };
    const r = frame.getBoundingClientRect();
    x += r.left + (frame as HTMLElement).clientLeft;
    y += r.top + (frame as HTMLElement).clientTop;
    cur = parent;
  }
  return { x, y, partial: true };
}

/**
 * The font's ascent + descent (fontBoundingBox of a canvas measure: the metrics Gecko's caret uses),
 * on a canvas that is created once per frame document and never inserted (the page cannot see it).
 */
function fontHeight(ctx: PageContext, doc: Document, font: string): number | null {
  try {
    let c2d = ctx.state.measure as CanvasRenderingContext2D | undefined;
    if (!c2d) {
      c2d = (doc.createElement('canvas') as HTMLCanvasElement).getContext('2d') ?? undefined;
      if (!c2d) return null;
      ctx.state.measure = c2d;
    }
    c2d.font = font;
    const m = c2d.measureText('Hg');
    const h = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch {
    return null;
  }
}

export function onEvent(ctx: PageContext, event: Event): void {
  if (event.type !== 'contextmenu') return;
  const win = ctx.window;
  const doc = ctx.document;
  if (!win || !doc) return;
  const e = event as MouseEvent;
  const walk = offsetToTop(win);
  // A frame below another process: rectangles of this frame's own viewport, placed by `screen`.
  const off = walk.partial ? { x: 0, y: 0, partial: true } : walk;
  let screen: MenuRecord['screen'] = null;
  if (off.partial) {
    try {
      // Window.mozInnerScreenX/Y (dom/webidl/Window.webidl): Gecko-only, not in the DOM typings.
      const w = win as unknown as { mozInnerScreenX: number; mozInnerScreenY: number };
      screen = { x: Number(w.mozInnerScreenX), y: Number(w.mozInnerScreenY), dpr: win.devicePixelRatio };
    } catch {
      screen = null;
    }
  }
  const box = (r: DOMRect): Box => ({ x: r.left + off.x, y: r.top + off.y, w: r.width, h: r.height });
  const path = e.composedPath();

  let link: HTMLAnchorElement | HTMLAreaElement | null = null;
  for (const n of path) {
    const el = n as Element;
    if ((el?.localName === 'a' || el?.localName === 'area') && (el as HTMLAnchorElement).href) {
      link = el as HTMLAnchorElement;
      break;
    }
  }
  let linkRects: Box[] | null = null;
  if (link && link.localName === 'a') {
    const rects = Array.from(link.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .slice(0, MAX_RECTS)
      .map(box);
    linkRects = rects.length ? rects : null;
  }

  const first = path[0] as Element | undefined;
  let target: Box | null = null;
  if (first && typeof first.getBoundingClientRect === 'function' && first !== doc.body && first !== doc.documentElement) {
    const r = first.getBoundingClientRect();
    if (r.width || r.height) target = box(r);
  }

  let selection: MenuRecord['selection'] = null;
  let inSelection = false;
  let linkSelected = false;
  try {
    const sel = win.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      // Where the click fell (client px of this frame): on one of the selected line boxes? The
      // keyboard (button 0 at no particular point) opens the menu for the selection itself.
      const keyboardOpened = e.button !== 2;
      for (let i = 0; i < sel.rangeCount && !inSelection; i++) {
        for (const r of Array.from(sel.getRangeAt(i).getClientRects())) {
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            inSelection = true;
            break;
          }
        }
      }
      if (keyboardOpened) inSelection = true;
      if (link) linkSelected = sel.containsNode(link, true);
      const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length) {
        const a = rects[0];
        const z = rects[rects.length - 1];
        selection = { left: a.left + off.x, right: Math.max(...rects.map((r) => r.right)) + off.x, top: a.top + off.y, bottom: z.bottom + off.y };
      }
    }
  } catch {
    selection = null;
  }

  let focused: Box | null = null;
  let lineHeight: number | null = null;
  let caretHeight: number | null = null;
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== doc.body && active !== doc.documentElement && active.localName !== 'iframe' && active.localName !== 'frame') {
    const r = active.getBoundingClientRect();
    if (r.width || r.height) focused = box(r);
    if (active.isContentEditable || active.localName === 'input' || active.localName === 'textarea') {
      try {
        const cs = win.getComputedStyle(active);
        const lh = parseFloat(cs.lineHeight);
        lineHeight = Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.25 || null;
        caretHeight = fontHeight(ctx, doc, cs.font);
      } catch {
        lineHeight = null;
      }
    }
  }

  ctx.send('menus:hit', { inSelection, linkSelected });

  const record: MenuRecord = {
    t: Date.now(),
    button: e.button,
    link: linkRects,
    download: !!link && link.hasAttribute('download'),
    target,
    selection,
    focused,
    lineHeight,
    caretHeight,
    partial: off.partial,
    screen,
  };
  ctx.state.record = record;
}

export function onMessage(ctx: PageContext, name: string): unknown {
  if (name !== 'menus:record') return undefined;
  const r = ctx.state.record as MenuRecord | undefined;
  return r && Date.now() - r.t < FRESH_MS ? r : null;
}
