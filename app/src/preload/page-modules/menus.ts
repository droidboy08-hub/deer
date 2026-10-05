// Right-click menus, page side (isolated world, main frame). While a contextmenu event dispatches,
// note what Vitre's menu needs and the 'context-menu' params lack: the link's rectangles for the
// target wash, the focused element or selection a keyboard-opened menu hangs from, and whether a
// video is protected. Shift+right-click keeps the page's own handlers from ever seeing the event,
// so Vitre's menu opens even on sites that replace it.
import { ipcRenderer } from 'electron';

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CSS pixels in the page's viewport; the renderer scales by dpr against its own. */
export interface PageMenuRecord {
  t: number;
  dpr: number;
  /** The text link under the click, one rectangle per line box. */
  link: PageRect[] | null;
  /** The link asks to be downloaded (download attribute). */
  download: boolean;
  /** The element the menu is for: a keyboard-opened menu hangs from it, an image peek grows from it. */
  target: PageRect | null;
  /** The selection: left and right edges, top of its first and bottom of its last line. */
  selection: { left: number; right: number; top: number; bottom: number } | null;
  /** Line height of the field the menu is for (Blink anchors a field's menu mid-line at the caret). */
  lineHeight: number | null;
  media: { drm: boolean; noAddress: boolean } | null;
}

const MAX_RECTS = 24;

const rect = (r: DOMRect): PageRect => ({ x: r.left, y: r.top, w: r.width, h: r.height });

function linkIn(path: EventTarget[]): HTMLAnchorElement | HTMLAreaElement | null {
  for (const n of path) {
    if ((n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) && n.href) return n;
  }
  return null;
}

function linkRects(a: HTMLAnchorElement | HTMLAreaElement): PageRect[] | null {
  if (a instanceof HTMLAreaElement) return null;
  const rects = Array.from(a.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .slice(0, MAX_RECTS)
    .map(rect);
  return rects.length ? rects : null;
}

function targetOf(target: EventTarget | undefined): PageRect | null {
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return null;
  const r = target.getBoundingClientRect();
  return r.width || r.height ? rect(r) : null;
}

function selectionBox(): PageMenuRecord['selection'] {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];
  return { left: first.left, right: Math.max(...rects.map((r) => r.right)), top: first.top, bottom: last.bottom };
}

function lineHeightOf(target: EventTarget | undefined): number | null {
  if (!(target instanceof HTMLElement) || !(target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
  const cs = getComputedStyle(target);
  const lh = parseFloat(cs.lineHeight);
  return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.25 || null;
}

function mediaIn(path: EventTarget[]): PageMenuRecord['media'] {
  const el = path.find((n): n is HTMLMediaElement => n instanceof HTMLMediaElement);
  if (!el) return null;
  const src = el.currentSrc || el.src;
  return { drm: !!el.mediaKeys, noAddress: !!el.srcObject || !src || /^(blob|mediasource):/i.test(src) };
}

window.addEventListener(
  'contextmenu',
  (e) => {
    const mouse = e.button === 2;
    // Shift+right-click: Vitre's menu, even where a site replaces it. Shift+F10 stays page-first.
    if (mouse && e.shiftKey) e.stopImmediatePropagation();
    const path = e.composedPath();
    const link = linkIn(path);
    const record: PageMenuRecord = {
      t: Date.now(),
      dpr: window.devicePixelRatio,
      link: link ? linkRects(link) : null,
      download: !!link && link.hasAttribute('download'),
      target: targetOf(path[0]),
      selection: selectionBox(),
      lineHeight: lineHeightOf(path[0]),
      media: mediaIn(path),
    };
    ipcRenderer.send('menu:ctx', record);
  },
  true,
);
