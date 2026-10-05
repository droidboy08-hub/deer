// Find in page, page side (isolated world, main frame).
// - Remembers whether the user selected something since find last closed, so Ctrl+F can pre-fill it.
// - Scrolls the page for Up, Down, Page Up and Page Down typed in the find field.
// - Names the link holding the match find left selected (Ctrl+Q peeks it).
// - Keeps a match clear of the glass bar (the scroll guard), and says how far Chromium's own jump
//   to a match moved the page.
// - While find is open, reports scrolling, the wheel and right-clicks so the landing ring can go.
import { ipcRenderer } from 'electron';

const MAX_PREFILL = 120;
const LINE = 40;

let selectedSinceClose = false;
let ignoreSelectionUntil = 0;
let armed = false;

document.addEventListener('selectionchange', () => {
  // Closing find with 'keepSelection' selects the match itself; that isn't the user's selection.
  if (performance.now() >= ignoreSelectionUntil) selectedSinceClose = true;
});

function textControlSelection(el: HTMLInputElement | HTMLTextAreaElement): string | null {
  try {
    const { selectionStart: s, selectionEnd: e } = el;
    return s !== null && e !== null && e > s ? el.value.slice(s, e) : null;
  } catch {
    return null; // input types without a text selection
  }
}

function currentSelection(): string | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement) return el.type === 'password' ? null : textControlSelection(el);
  if (el instanceof HTMLTextAreaElement) return textControlSelection(el);
  return window.getSelection()?.toString() ?? null;
}

/** One line, at most 120 characters, never from a password field. */
function prefill(): string | null {
  if (!selectedSinceClose) return null;
  const text = currentSelection()?.trim();
  if (!text || /[\r\n]/.test(text) || text.length > MAX_PREFILL) return null;
  return text;
}

function isScrollable(el: Element): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1;
}

function pageScroller(): Element {
  return document.scrollingElement ?? document.documentElement;
}

/** The element that scrolls this element's content (the page itself when nothing nearer does). */
function scrollerOf(start: Element | null): Element {
  for (let el = start; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  return pageScroller();
}

/** The element that scrolls the content at a point, like the wheel would. */
function scrollerAt(x: number, y: number): Element {
  return scrollerOf(document.elementFromPoint(x, y));
}

/**
 * The element holding the match at a point: the topmost one there whose text contains it, so a
 * page's own sticky header painted over the match isn't taken for the match.
 */
function matchElementAt(x: number, y: number, text: string, matchCase: boolean): Element | null {
  const fold = (s: string) => (matchCase ? s : s.toLocaleLowerCase());
  const query = fold(text);
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (el === document.body || el === document.documentElement) break;
    const content = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent;
    if (query && content && fold(content).includes(query)) return el;
  }
  return stack[0] ?? null;
}

function isPinned(el: Element | null): boolean {
  for (; el; el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The page's current selection and where it is (CSS pixels), whenever it was made. A new find session
 * should start on it when it is a match: Chromium starts after it while the page isn't focused.
 */
function selectionAnchor(): { text: string; x: number; y: number; width: number; height: number } | null {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!sel || !text || sel.rangeCount === 0 || text.length > MAX_PREFILL) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { text, x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

ipcRenderer.on('find:selection-request', (_e, id: number) => {
  ipcRenderer.sendToHost('find:selection', id, prefill(), selectionAnchor());
});

// Replies once the page has keyboard focus, so Chromium's 'activateSelection' can click the match.
ipcRenderer.on('find:focus-request', (_e, id: number) => {
  if (document.hasFocus()) {
    ipcRenderer.sendToHost('find:focused', id);
    return;
  }
  window.addEventListener('focus', () => ipcRenderer.sendToHost('find:focused', id), { once: true });
});

// Ctrl+Q in the find field: the web link holding the match find has just left selected (or the
// link Chromium focused with it), in CSS pixels.
ipcRenderer.on('find:selected-link', (_e, id: number) => {
  const sel = window.getSelection();
  const node = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0).startContainer : null;
  const start = node instanceof Element ? node : node?.parentElement ?? document.activeElement;
  const link = start?.closest('a[href], area[href]') as HTMLAnchorElement | HTMLAreaElement | null;
  if (!link || !/^https?:/i.test(link.href)) {
    ipcRenderer.sendToHost('find:link', id, null);
    return;
  }
  const r = link.getBoundingClientRect();
  ipcRenderer.sendToHost('find:link', id, { href: link.href, x: r.x, y: r.y, width: r.width, height: r.height });
});

ipcRenderer.on('find:armed', (_e, on: boolean) => {
  armed = on;
});

ipcRenderer.on('find:closed', () => {
  armed = false;
  selectedSinceClose = false;
  ignoreSelectionUntil = performance.now() + 600;
});

ipcRenderer.on('find:scroll', (_e, how: 'up' | 'down' | 'pageUp' | 'pageDown') => {
  const el = scrollerAt(innerWidth / 2, innerHeight / 2);
  const view = el === pageScroller() ? innerHeight : el.clientHeight;
  const page = Math.max(LINE, Math.round(view * 0.875));
  const top = { up: -LINE, down: LINE, pageUp: -page, pageDown: page }[how];
  el.scrollBy({ top, behavior: reducedMotion() ? 'instant' : 'smooth' });
});

// Chromium reports the active match where it was before it scrolled the page to it. The host marks
// the scroll position just before each find request and asks how far the page has moved since.
let base = { x: scrollX, y: scrollY };
ipcRenderer.on('find:baseline', () => {
  base = { x: scrollX, y: scrollY };
});
ipcRenderer.on('find:delta', (_e, id: number) => {
  const reply = () => {
    const now = { x: scrollX, y: scrollY };
    ipcRenderer.sendToHost('find:moved', id, now.x - base.x, now.y - base.y);
    base = now;
  };
  if (scrollX !== base.x || scrollY !== base.y) {
    reply();
    return;
  }
  // Chromium answers before it scrolls to the match: wait a moment for that scroll.
  let timer = 0;
  const settle = () => {
    window.clearTimeout(timer);
    window.removeEventListener('scroll', settle, true);
    reply();
  };
  timer = window.setTimeout(settle, 150);
  window.addEventListener('scroll', settle, { capture: true, passive: true });
});

// Move a match out from under the glass: dy is in CSS pixels. Replies with how far the content moved,
// or pinned when the match sits on fixed or sticky content that can't scroll away.
ipcRenderer.on('find:guard', (_e, id: number, x: number, y: number, dy: number, text: string, matchCase: boolean) => {
  const hit = matchElementAt(x, y, String(text ?? ''), !!matchCase);
  if (!hit || isPinned(hit)) {
    ipcRenderer.sendToHost('find:guarded', id, 0, true);
    return;
  }
  const el = scrollerOf(hit);
  const before = el.scrollTop;
  el.scrollBy({ top: dy, behavior: 'instant' });
  ipcRenderer.sendToHost('find:guarded', id, el.scrollTop - before, false);
});

// Ring cancellers, sent at most every 100 ms and only while find is open in this page.
let lastReport = 0;
function report(kind: 'scroll' | 'wheel' | 'menu'): void {
  if (!armed) return;
  const now = performance.now();
  if (kind !== 'menu' && now - lastReport < 100) return;
  lastReport = now;
  ipcRenderer.sendToHost('find:page-event', kind);
}

window.addEventListener('scroll', () => report('scroll'), { capture: true, passive: true });
window.addEventListener('wheel', () => report('wheel'), { capture: true, passive: true });
window.addEventListener('contextmenu', () => report('menu'), { capture: true });
