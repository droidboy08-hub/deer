// Page module for find in page (window side: src/window/modules/find/). Runs in every frame.
//
// The search itself is Firefox's (FinderChild / Finder.sys.mjs, driven from the window through
// browser.finder); this module only does what the finder does not:
//   - Match colours: Gecko swaps the "every match" pair (yellow on black) on light pages unless the
//     find selection of the document carries its own colours (repeated as the alternate pair). Set
//     on DOMDocElementInserted and again when find opens. The active match is the normal selection
//     shown with the attention colours, which the window sets as prefs (gecko.ts setMatchColours).
//   - Pre-fill: whether the user made a selection since find last closed, and its text: one line, at
//     most 120 characters, never from a password field. "Made by the user" = a selectstart (mouse or
//     keyboard; double-click included), or a selection-key keyup (Shift+arrows, Shift+Home / End,
//     Ctrl+A) that leaves a selection; a page selecting by script does not count (and selectionchange
//     never reaches the actor: tested).
//   - Where the active match is: the find selection's rectangle in viewport CSS px, carried up
//     through the frames of this process (frameElement); an out-of-process parent is named by its
//     browsing context and asked in turn (find:frame-offset). FinderParent's own result rect is
//     relative to the frame that holds the match, so the landing ring could not use it.
//   - The scroll guard: scroll the match's own scroller by dy, unless it sits on fixed or sticky
//     content (pinned: the window then gives the pill its parked tint). A match inside a frame is
//     guarded in the top document: what scrolls the frame element that holds it.
//   - The link that holds the match (Ctrl+Q in the field peeks it), once the page has focus.
//   - Up, Down, Page Up and Page Down typed in the field scroll what the wheel would scroll at the
//     middle of the view (a line is 40 px; a page is 87.5 % of the view below the bar's scroll
//     padding), smoothly unless the user asked for reduced motion.
//   - While find is open in the page: scrolling, the wheel and right-clicks are reported (at most
//     every 100 ms), so the landing ring can go.
//   - While find is open in a tab's top document whose scroll padding is the inset's (inset.ts gives
//     the root `scroll-padding-top: <inset>px` so #hash jumps land below the bar), that padding is
//     set back to 0 by an author-level sheet (`:where(:root)`, so a site's own scroll padding still
//     wins). Gecko's find treats a match inside the scroll padding as off-screen and centres it
//     (y ~450); without the padding a match under the glass stays put and the window's scroll guard
//     lifts it to y 92, as the design asks (FindContexts "Scrolled to y 92"). Off-screen matches are
//     still centred by Gecko. The sheet goes when find closes (find:closed) or the document goes.
//
// Messages (window -> page; every frame answers for itself):
//   find:armed { on }        find opened (or closed without find:closed) in this tab; sent again
//                            for a new document while find stays open (reload)
//   find:closed              find closed: selections made from now on count for the pre-fill
//   find:selection           -> { text, fresh, focused } | null    (focused: focus is in this document)
//   find:match               -> { rect: {x,y,width,height} | null, via, pinned }
//                               via 0: rect is in the top document's viewport; else the id of the
//                               browsing context whose viewport it is in (its parent is in another
//                               process: ask that parent find:frame-offset { child: via })
//   find:frame-offset {child}-> { x, y, via } | null   the content box of the frame element hosting
//                               browsing context `child`, carried up the same way
//   find:guard { dy, frame } -> { moved, pinned }      dy and moved in this document's CSS px; frame:
//                               the id of this document's frame that holds the match (0: the
//                               match is in this document)
//   find:link                -> { href, rect, via } | null
//   find:scroll { how }      how: 'up' | 'down' | 'pageUp' | 'pageDown' (top document)
// Page -> window: find:page-event { kind: 'scroll' | 'wheel' | 'menu' }.
//
// Firefox internals (version 157): nsISelectionController.SELECTION_FIND / Selection.setColors through
// the frame's docShell (nsISelectionDisplay; spikes/pagefeatures/VitrePageChild.sys.mjs), the
// chrome-only DOMDocElementInserted event, the chrome-only `editor` of text controls and
// Window.browsingContext (as gre/modules/Finder.sys.mjs _getResultRect walks frames).
import type { PageContext } from '../page-api';

const FIND_BG = '#ffff00';
const FIND_FG = '#000000';
const MAX_PREFILL = 120;
/** After find closes, its own selection changes (the match it leaves selected) are not the user's. */
const IGNORE_AFTER_CLOSE = 600;
const REPORT_EVERY = 100;
const FOCUS_WAIT = 300;
const LINE = 40;
/** The inset's custom property on the root (src/actors/page/inset.ts VAR). */
const INSET_VAR = '--vitre-inset';
/** While find is open: the inset's scroll padding back to 0 (author level, specificity 0). */
const NO_PADDING = 'data:text/css;charset=utf-8,' + encodeURIComponent('@media screen { :where(:root) { scroll-padding-top: 0px; } }');

interface State {
  armed?: boolean;
  userSelectAt?: number;
  ignoreUntil?: number;
  lastReport?: number;
  /** The NO_PADDING sheet is in. */
  unpadded?: boolean;
}

export const events = {
  DOMDocElementInserted: {},
  selectstart: { capture: true, createActor: false },
  keyup: { capture: true, createActor: false },
  scroll: { capture: true, passive: true, createActor: false },
  wheel: { capture: true, passive: true, createActor: false },
  contextmenu: { capture: true, createActor: false },
};

const st = (ctx: PageContext): State => ctx.state as State;

function setFindColors(ctx: PageContext): boolean {
  try {
    const sc = ctx.actor.docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay).QueryInterface(Ci.nsISelectionController);
    sc.getSelection(Ci.nsISelectionController.SELECTION_FIND).setColors(FIND_FG, FIND_BG, FIND_FG, FIND_BG);
    return true;
  } catch {
    return false;
  }
}

/**
 * While find is open, the inset's scroll padding is set back to 0 in the tab's top document (see the
 * header). Only when the padding in effect is the inset's own: a site's padding is left alone, and a
 * page without the inset gets no sheet (adding one restyles the document).
 */
function setUnpadded(ctx: PageContext, on: boolean): void {
  const s = st(ctx);
  const win = ctx.window;
  const doc = ctx.document;
  if (!ctx.isTop || !win || !doc?.documentElement || !!s.unpadded === on) return;
  try {
    const utils = (win as any).windowUtils;
    if (on) {
      const cs = win.getComputedStyle(doc.documentElement);
      const inset = parseFloat(cs.getPropertyValue(INSET_VAR)) || 0;
      const pad = parseFloat(cs.scrollPaddingTop) || 0;
      if (!inset || Math.abs(pad - inset) > 0.01) return;
      utils.loadSheetUsingURIString(NO_PADDING, utils.AUTHOR_SHEET);
    } else utils.removeSheetUsingURIString(NO_PADDING, utils.AUTHOR_SHEET);
    s.unpadded = on;
  } catch {
    /* the document is going away */
  }
}

function report(ctx: PageContext, kind: 'scroll' | 'wheel' | 'menu'): void {
  const s = st(ctx);
  if (!s.armed) return;
  const now = Date.now();
  if (kind !== 'menu' && now - (s.lastReport ?? 0) < REPORT_EVERY) return;
  s.lastReport = now;
  ctx.send('find:page-event', { kind });
}

export function onEvent(ctx: PageContext, event: Event): void {
  const s = st(ctx);
  switch (event.type) {
    case 'DOMDocElementInserted':
      if (event.target === ctx.document) setFindColors(ctx);
      break;
    case 'selectstart':
      if (event.isTrusted && Date.now() >= (s.ignoreUntil ?? 0)) s.userSelectAt = Date.now();
      break;
    case 'keyup': {
      // Keyboard selection (Shift+arrows, Shift+Home/End, Ctrl+A).
      if (!event.isTrusted || Date.now() < (s.ignoreUntil ?? 0)) break;
      const k = event as KeyboardEvent;
      const extend = k.shiftKey && /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(k.key);
      if ((extend || (k.ctrlKey && k.keyCode === 65)) && hasSelection(ctx)) s.userSelectAt = Date.now();
      break;
    }
    case 'scroll':
      report(ctx, 'scroll');
      break;
    case 'wheel':
      report(ctx, 'wheel');
      break;
    case 'contextmenu':
      report(ctx, 'menu');
      break;
  }
}

const isTextControl = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && el.namespaceURI === 'http://www.w3.org/1999/xhtml' && (el.localName === 'input' || el.localName === 'textarea');
const isFrameElement = (el: Element | null): boolean => !!el && /^(iframe|frame|object|embed)$/.test(el.localName);

function controlSelection(el: HTMLInputElement | HTMLTextAreaElement): string {
  try {
    if (el.localName === 'input' && (el as HTMLInputElement).type === 'password') return '';
    const { selectionStart: a, selectionEnd: b } = el;
    return a !== null && b !== null && b > a ? el.value.slice(a, b) : '';
  } catch {
    return ''; // input types without a text selection
  }
}

function hasSelection(ctx: PageContext): boolean {
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win) return false;
  const active = doc.activeElement;
  if (isTextControl(active)) return !!controlSelection(active);
  const sel = win.getSelection();
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
}

/** The pre-fill candidate: the user's selection, if they made one since find last closed. */
function selection(ctx: PageContext): { text: string; fresh: boolean; focused: boolean } | null {
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win) return null;
  const active = doc.activeElement;
  let text = '';
  if (isTextControl(active)) text = controlSelection(active);
  else text = win.getSelection()?.toString() ?? '';
  text = text.trim();
  if (/[\r\n]/.test(text) || text.length > MAX_PREFILL) text = '';
  let focused = false;
  try {
    focused = doc.hasFocus() && !isFrameElement(active);
  } catch {
    focused = false;
  }
  return { text, fresh: !!st(ctx).userSelectAt, focused };
}

/** The range find left selected in this document (in a text control: its editor's selection). */
function matchRange(ctx: PageContext): { range: Range; holder: Element | null } | null {
  const win = ctx.window;
  const doc = ctx.document;
  if (!win || !doc) return null;
  const sel = win.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    return { range, holder: node.nodeType === 1 ? (node as Element) : node.parentElement };
  }
  for (const node of Array.from(doc.querySelectorAll('input, textarea'))) {
    try {
      const editor = (node as any).editor;
      const s = editor?.selectionController?.getSelection(Ci.nsISelectionController.SELECTION_NORMAL);
      if (s && s.rangeCount && !s.isCollapsed) return { range: s.getRangeAt(0), holder: node };
    } catch {
      /* a hidden control has no selection controller */
    }
  }
  return null;
}

/** Carry a point in this frame's viewport up through the frames of this process. */
function carry(win: Window, x: number, y: number): { x: number; y: number; via: number } {
  let w: Window = win;
  for (let depth = 0; depth < 16; depth++) {
    if (w.parent === w) return { x, y, via: 0 };
    let fe: Element | null = null;
    try {
      fe = w.frameElement;
    } catch {
      fe = null;
    }
    if (!fe) {
      // The parent document lives in another process: it is asked next.
      let id = 0;
      try {
        id = (w as any).browsingContext?.id ?? 0;
      } catch {
        id = 0;
      }
      return { x, y, via: id };
    }
    const off = contentBox(fe);
    x += off.x;
    y += off.y;
    w = w.parent as Window;
  }
  return { x, y, via: 0 };
}

/** Where a frame element's content (its document's viewport) starts, in its own viewport. */
function contentBox(fe: Element): { x: number; y: number } {
  const r = fe.getBoundingClientRect();
  let pl = 0;
  let pt = 0;
  try {
    const cs = fe.ownerDocument.defaultView?.getComputedStyle(fe);
    pl = parseFloat(cs?.paddingLeft ?? '0') || 0;
    pt = parseFloat(cs?.paddingTop ?? '0') || 0;
  } catch {
    /* no style */
  }
  return { x: r.left + (fe as HTMLElement).clientLeft + pl, y: r.top + (fe as HTMLElement).clientTop + pt };
}

function pinnedFrom(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    try {
      const pos = e.ownerDocument.defaultView?.getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isScrollable(el: Element): boolean {
  try {
    const oy = el.ownerDocument.defaultView?.getComputedStyle(el).overflowY;
    return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1;
  } catch {
    return false;
  }
}

function scrollerOf(doc: Document, start: Element | null): Element {
  for (let el = start; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  return doc.scrollingElement ?? doc.documentElement;
}

function match(ctx: PageContext): { rect: { x: number; y: number; width: number; height: number } | null; via: number; pinned: boolean } {
  const win = ctx.window;
  const m = matchRange(ctx);
  if (!win || !m) return { rect: null, via: 0, pinned: false };
  const r = m.range.getBoundingClientRect();
  if (!r.width && !r.height) return { rect: null, via: 0, pinned: false };
  const p = carry(win, r.left, r.top);
  return { rect: { x: p.x, y: p.y, width: r.width, height: r.height }, via: p.via, pinned: pinnedFrom(m.holder) };
}

function frameOffset(ctx: PageContext, child: number): { x: number; y: number; via: number } | null {
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win || !Number.isFinite(child)) return null;
  const fe = frameElementFor(doc, child);
  if (!fe) return null;
  const off = contentBox(fe);
  return carry(win, off.x, off.y);
}

/** The frame element of this document that hosts browsing context `id`, or null. */
function frameElementFor(doc: Document, id: number): Element | null {
  for (const fe of Array.from(doc.querySelectorAll('iframe, frame, object, embed'))) {
    try {
      if ((fe as any).browsingContext?.id === id) return fe;
    } catch {
      /* not a frame */
    }
  }
  return null;
}

/**
 * Scroll the active match clear of the glass by dy. frame: the match is inside the frame element of
 * this (top) document that hosts that browsing context: what holds the frame is scrolled.
 */
function guard(ctx: PageContext, dy: number, frame: number): { moved: number; pinned: boolean } {
  const doc = ctx.document;
  if (!doc || !Number.isFinite(dy)) return { moved: 0, pinned: false };
  const holder = frame > 0 ? frameElementFor(doc, frame) : (matchRange(ctx)?.holder ?? null);
  if (!holder) return { moved: 0, pinned: false };
  if (pinnedFrom(holder)) return { moved: 0, pinned: true };
  const el = scrollerOf(doc, holder);
  const before = el.scrollTop;
  el.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
  return { moved: el.scrollTop - before, pinned: false };
}

async function link(ctx: PageContext): Promise<{ href: string; rect: { x: number; y: number; width: number; height: number }; via: number } | null> {
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win) return null;
  // Finder.focusContent focuses the match's link; wait for the focus to land (at most 300 ms).
  if (!doc.hasFocus()) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        win.clearTimeout(timer);
        win.removeEventListener('focus', done, true);
        resolve();
      };
      const timer = win.setTimeout(done, FOCUS_WAIT);
      win.addEventListener('focus', done, true);
    });
  }
  const sel = win.getSelection();
  const node = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).startContainer : null;
  const start = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
  const a = (start?.closest('a[href], area[href]') ?? doc.activeElement?.closest?.('a[href], area[href]')) as HTMLAnchorElement | null;
  if (!a || !a.href) return null;
  const r = a.getBoundingClientRect();
  const p = carry(win, r.left, r.top);
  return { href: String(a.href), rect: { x: p.x, y: p.y, width: r.width, height: r.height }, via: p.via };
}

function scroll(ctx: PageContext, how: unknown): boolean {
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win || (how !== 'up' && how !== 'down' && how !== 'pageUp' && how !== 'pageDown')) return false;
  const root = doc.scrollingElement ?? doc.documentElement;
  const el = scrollerOf(doc, doc.elementFromPoint(win.innerWidth / 2, win.innerHeight / 2));
  let view = el === root ? win.innerHeight : el.clientHeight;
  if (el === root) {
    // What the bar covers: the inset (its scroll padding is off while find is open) or the site's
    // own larger scroll padding.
    try {
      const cs = win.getComputedStyle(doc.documentElement);
      view -= Math.max(parseFloat(cs.getPropertyValue(INSET_VAR)) || 0, parseFloat(cs.scrollPaddingTop) || 0);
    } catch {
      /* no style */
    }
  }
  const page = Math.max(LINE, Math.round(view * 0.875));
  const top = { up: -LINE, down: LINE, pageUp: -page, pageDown: page }[how];
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollBy({ top, behavior: (reduced ? 'instant' : 'smooth') as ScrollBehavior });
  return true;
}

export function onMessage(ctx: PageContext, name: string, data: any): unknown {
  if (!name.startsWith('find:')) return undefined;
  const s = st(ctx);
  switch (name) {
    case 'find:armed':
      s.armed = !!data?.on;
      if (s.armed) setFindColors(ctx);
      setUnpadded(ctx, s.armed);
      return true;
    case 'find:closed':
      s.armed = false;
      s.userSelectAt = 0;
      s.ignoreUntil = Date.now() + IGNORE_AFTER_CLOSE;
      setUnpadded(ctx, false);
      return true;
    case 'find:selection':
      return selection(ctx) ?? null;
    case 'find:match':
      return match(ctx);
    case 'find:frame-offset':
      return frameOffset(ctx, Number(data?.child)) ?? null;
    case 'find:guard':
      return guard(ctx, Number(data?.dy), Number(data?.frame) || 0);
    case 'find:link':
      return link(ctx).then((r) => r ?? null);
    case 'find:scroll':
      return scroll(ctx, data?.how);
    case 'find:colours':
      // For tests: are the colours pinned in this document?
      return setFindColors(ctx);
  }
  return undefined;
}
