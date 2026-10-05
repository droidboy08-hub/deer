// Peek, page side. Runs in every page's isolated world.
// - Records trusted Shift+click and Shift+Enter on web links, so the chrome only peeks a
//   new-window request the user really made, and knows the link's rectangle to grow from.
// - Answers "which link?" for Ctrl+Q (the focused link, or the one under the pointer) and for
//   a Shift+click on the dimmed page, and locates or focuses the link a peek came from.
// - Inside a peek (the chrome says so with 'peek:role'): reports Esc and Alt+Left (with their
//   repeat flag), the Open as tab key (Alt+Enter unless rebound) when the page didn't use it,
//   typing, and the first paint.
import { ipcRenderer } from 'electron';
import { keyName } from '../../shared/shortcuts';

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

type WebLink = HTMLAnchorElement | HTMLAreaElement;

/** A key chord as the chrome sends it (Open as tab can be rebound in Settings). */
interface Chord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

const LINK = 'a[href], area[href]';
// Containers that read as "the link's row" for the accent wash after closing.
const ROW = 'li, tr, dt, dd, article, [role="row"], [role="listitem"], [role="option"], [role="article"]';
const NOT_TEXT = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range', 'hidden']);

const remembered = new Map<number, WeakRef<Element>>();
let nextId = 1;
let pointer: { x: number; y: number } | null = null;
let inPeek = false;
let typed = false;
let openAsTab: Chord = { key: 'Enter', ctrl: false, shift: false, alt: true };

// ---- links and rectangles ----

function isWebLink(el: Element | null): el is WebLink {
  if (!el) return false;
  const href = (el as HTMLAnchorElement).href;
  return typeof href === 'string' && /^https?:/i.test(href);
}

/** Like closest(), but climbs out of shadow roots. */
function closestLink(start: Element | null): Element | null {
  let n: Node | null = start;
  while (n) {
    if (n instanceof Element && n.matches(LINK)) return n;
    n = n.parentNode ?? null;
    if (n instanceof ShadowRoot) n = n.host;
  }
  return null;
}

function linkInEvent(e: Event): WebLink | null {
  for (const n of e.composedPath()) {
    if (n instanceof Element && n.matches(LINK)) return isWebLink(n) ? n : null;
  }
  return null;
}

function deepActive(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function elementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function editing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

function clampBox(b: Box): Box {
  const w = Math.max(1, Math.min(b.w, window.innerWidth));
  const h = Math.max(1, Math.min(b.h, window.innerHeight));
  const x = Math.min(Math.max(b.x, 0), window.innerWidth - w);
  const y = Math.min(Math.max(b.y, 0), window.innerHeight - h);
  return { x, y, w, h, r: b.r };
}

/** The link's own rectangle: the line box under the pointer for a wrapped link, else the first. */
function linkBox(el: Element, at?: { x: number; y: number } | null): Box {
  const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const hit = at ? rects.find((r) => at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom) : undefined;
  const r = hit ?? rects[0];
  if (!r) {
    // <area> and display:contents links have no boxes of their own.
    const p = at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return clampBox({ x: p.x - 8, y: p.y - 8, w: 16, h: 16, r: 6 });
  }
  return clampBox({ x: r.left, y: r.top, w: r.width, h: r.height, r: 4 });
}

/** A list row, table row or card around the link, if it is row-sized. */
function rowBox(el: Element, link: Box): Box | null {
  const row = el.closest(ROW);
  if (!row) return null;
  const r = row.getBoundingClientRect();
  if (r.width < link.w || r.height < link.h || r.height > Math.max(120, link.h * 4)) return null;
  const radius = parseFloat(getComputedStyle(row).borderTopLeftRadius) || 0;
  return clampBox({ x: r.left, y: r.top, w: r.width, h: r.height, r: Math.min(radius, r.height / 2) });
}

function remember(el: Element): number {
  const id = nextId++;
  remembered.set(id, new WeakRef(el));
  if (remembered.size > 16) remembered.delete(remembered.keys().next().value as number);
  return id;
}

function describe(el: WebLink, at?: { x: number; y: number } | null): LinkInfo {
  const rect = linkBox(el, at);
  return { id: remember(el), href: el.href, rect, row: rowBox(el, rect) };
}

function recall(id: number): Element | null {
  const el = remembered.get(id)?.deref() ?? null;
  return el && el.isConnected ? el : null;
}

const composing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;
const isChord = (e: KeyboardEvent, c: Chord) =>
  !e.metaKey && keyName(e.key, e.code) === c.key && e.ctrlKey === c.ctrl && e.shiftKey === c.shift && e.altKey === c.alt;
const only = (e: KeyboardEvent | MouseEvent, mod: 'shift' | 'alt') =>
  e.shiftKey === (mod === 'shift') && e.altKey === (mod === 'alt') && !e.ctrlKey && !e.metaKey;

// ---- gestures the chrome can trust ----

window.addEventListener(
  'click',
  (e) => {
    if (!e.isTrusted || e.button !== 0 || !only(e, 'shift')) return;
    const a = linkInEvent(e);
    // Keyboard activation (Shift+Enter) arrives as a click at 0,0: use the link's own box.
    if (a) ipcRenderer.sendToHost('peek:gesture', describe(a, e.detail > 0 ? { x: e.clientX, y: e.clientY } : null));
  },
  true,
);

window.addEventListener(
  'keydown',
  (e) => {
    if (!e.isTrusted) return;
    // An Esc that closes an IME composition never counts toward the peek's Esc Esc.
    if (inPeek && e.key === 'Escape') ipcRenderer.sendToHost('peek:key', 'escape', e.repeat || composing(e));
    if (composing(e)) return;
    if (e.key === 'Enter' && only(e, 'shift') && !e.repeat) {
      const a = closestLink(deepActive());
      if (isWebLink(a)) ipcRenderer.sendToHost('peek:gesture', describe(a));
    }
    if (!inPeek) return;
    if (e.key === 'ArrowLeft' && only(e, 'alt')) {
      ipcRenderer.sendToHost('peek:key', 'alt-left', e.repeat);
    } else if (!e.repeat && isChord(e, openAsTab)) {
      // Page first: sites like Sheets use Alt+Enter themselves.
      setTimeout(() => {
        if (!e.defaultPrevented) ipcRenderer.sendToHost('peek:key', 'alt-enter', false);
      }, 0);
    }
  },
  true,
);

window.addEventListener(
  'input',
  (e) => {
    if (!inPeek || typed || !e.isTrusted) return;
    typed = true;
    ipcRenderer.sendToHost('peek:typed');
  },
  true,
);

window.addEventListener(
  'pointermove',
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  },
  { capture: true, passive: true },
);
document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) pointer = null;
});

// ---- requests from the chrome ----

ipcRenderer.on('peek:query', (_e, req: number) => {
  const active = deepActive();
  let link: Element | null = null;
  if (!editing(active)) {
    // A link reached with the keyboard wins; after mouse use, the link under the pointer does.
    const focused = closestLink(active);
    const hovered = pointer ? closestLink(elementAt(pointer.x, pointer.y)) : null;
    const byKeyboard = isWebLink(focused) && !!active?.matches(':focus-visible');
    link = byKeyboard || !isWebLink(hovered) ? focused : hovered;
  }
  ipcRenderer.sendToHost('peek:link', req, isWebLink(link) ? describe(link, pointer) : null);
});

ipcRenderer.on('peek:at', (_e, req: number, x: number, y: number) => {
  const link = closestLink(elementAt(x, y));
  ipcRenderer.sendToHost('peek:link', req, isWebLink(link) ? describe(link, { x, y }) : null);
});

ipcRenderer.on('peek:locate', (_e, req: number, id: number) => {
  const el = recall(id);
  if (!el) {
    ipcRenderer.sendToHost('peek:where', req, null);
    return;
  }
  const rect = linkBox(el);
  ipcRenderer.sendToHost('peek:where', req, { rect, row: rowBox(el, rect) });
});

ipcRenderer.on('peek:focus', (_e, id: number) => {
  const el = recall(id);
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus({ preventScroll: true });
});

ipcRenderer.on('peek:role', (_e, on: boolean, key?: Chord) => {
  inPeek = on;
  if (key) openAsTab = key;
  typed = false;
  if (!on) return;
  // The second frame after the chrome asks has been painted: the cover can go.
  requestAnimationFrame(() => requestAnimationFrame(() => ipcRenderer.sendToHost('peek:painted')));
});
