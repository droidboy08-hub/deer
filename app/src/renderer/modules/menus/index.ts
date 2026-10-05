// Right-click menus (DESIGN-NOTES "Right-click menus"). Page menus come from the main process
// ('menu:open', built from Electron's context-menu params plus the page preload's notes); the tab
// bar, the peek's header, Home and Vitre's fields build theirs here. One MenuView draws whichever
// is open.
import type { WebviewTag } from 'electron';
import type { Browser } from '../../app';
import type { Tab } from '../../model';
import type { MenuKey, MenuOpenPayload } from '../../../main/modules/menus';
import { act, chromeContext, peekApi } from './actions';
import { circleCaption, circleRows, fieldRows, homeRows, peekHeaderRows, pillRows, plusRows, type ChromeEnv } from './chrome-items';
import { MENU_CSS } from './css';
import { pageMenu, type PageKind } from './page-items';
import type { MenuAnchor, MenuRow, MenuSource, MenuSpec } from './types';
import { MenuView, type MenuTheme } from './view';

let view: MenuView | null = null;
let browser: Browser | null = null;
let lastMenuKeyAt = -Infinity;
/** The page whose keys the open menu borrows (main forwards them as 'menu:key'). */
let borrowedFrom: number | null = null;

/** While a menu is open the page keeps focus and main hands its keys to the menu. */
function borrowKeysOf(wcId: number): (on: boolean) => void {
  return (on) => {
    if (on) borrowedFrom = wcId;
    else if (borrowedFrom === wcId) borrowedFrom = null;
    window.vitre.ipc.send('menu:keys', wcId, on);
  };
}

// Registered as the bundle loads, ahead of the Browser's own key handling: while a menu is open it
// sees every key first and swallows global shortcuts, as Windows menus do.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) lastMenuKeyAt = performance.now();
    if (!view?.isOpen || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    view.handleKey(e);
  },
  true,
);

/** Nothing focused: a keyboard-opened page menu goes here, below the tab bar. */
const NO_FOCUS_ANCHOR = { x: 24, y: 76 };
/** Tab bar menus hang 8 px below the bar's 44 px items (top 12): y 64. */
const BAR_GAP = 8;

/** Menus follow Vitre's Appearance mode (Match Windows by default), never the page. */
function menuTheme(b: Browser): MenuTheme {
  const t = b.settings.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function webviewFor(b: Browser, wcId: number): WebviewTag | null {
  const tabView = b.tabForWebContents(wcId)?.webview;
  if (tabView) return tabView;
  for (const el of document.querySelectorAll('webview')) {
    const wv = el as WebviewTag;
    try {
      if (wv.getWebContentsId() === wcId) return wv;
    } catch {
      /* not attached */
    }
  }
  return null;
}

/** The page (tab or peek) that has keyboard focus, if any. */
function focusedPage(): { wv: WebviewTag; id: number } | null {
  const el = document.activeElement;
  if (!el || el.tagName !== 'WEBVIEW') return null;
  const wv = el as WebviewTag;
  try {
    return { wv, id: wv.getWebContentsId() };
  } catch {
    return null;
  }
}

// ---- page menus ----

function pageAnchor(p: MenuOpenPayload, kind: PageKind, r: DOMRect, scale: number): MenuAnchor {
  const at = (x: number, y: number) => ({ x: r.left + x * scale, y: r.top + y * scale });
  if (p.source === 'touch') return { kind: 'touch', x: r.left + p.x, y: r.top + p.y };
  if (p.source !== 'keyboard') return { kind: 'point', x: r.left + p.x, y: r.top + p.y };
  const rec = p.page;
  // A selection anchors below its last line, left-aligned to its start.
  if (rec?.selection && kind === 'selection') {
    const s = rec.selection;
    return { kind: 'below', left: at(s.left, 0).x, top: at(0, s.top).y, bottom: at(0, s.bottom).y };
  }
  // A field's menu hangs from the caret's line, not the whole field. Blink's anchor is mid-line.
  if (kind === 'editable' || kind === 'misspelled' || !p.isMainFrame) {
    const half = ((rec?.lineHeight ?? 20) * scale) / 2;
    return { kind: 'below', left: r.left + p.x, top: r.top + p.y - half, bottom: r.top + p.y + half };
  }
  if (rec?.target) {
    const a = rec.target;
    return { kind: 'below', left: at(a.x, 0).x, top: at(0, a.y).y, bottom: at(0, a.y + a.h).y };
  }
  return { kind: 'point', x: r.left + NO_FOCUS_ANCHOR.x, y: r.top + NO_FOCUS_ANCHOR.y };
}

function openPage(b: Browser, menus: MenuView, p: MenuOpenPayload): void {
  const wv = webviewFor(b, p.wcId);
  if (!wv) return;
  const tab = b.tabForWebContents(p.wcId);
  // The page left the screen while its menu was on the way (a tab switch, the peek closing).
  if (tab ? tab.id !== b.activeId : peekApi()?.webview() !== wv) return;
  const r = wv.getBoundingClientRect();
  // The page reports CSS pixels; its device pixel ratio carries its zoom.
  const scale = p.page ? p.page.dpr / window.devicePixelRatio : 1;
  const toWindow = (x: number, y: number, w: number, h: number) => new DOMRect(r.left + x * scale, r.top + y * scale, w * scale, h * scale);
  const rec = p.page;
  const linkRects = (rec?.link ?? []).map((l) => toWindow(l.x, l.y, l.w, l.h));
  const sel = rec?.selection;
  const selectionRect = sel ? toWindow(sel.left, sel.top, sel.right - sel.left, sel.bottom - sel.top) : null;
  const targetRect = rec?.target ? toWindow(rec.target.x, rec.target.y, rec.target.w, rec.target.h) : null;
  const { kind, rows } = pageMenu({ b, p, wv, tab, linkRects, selectionRect, targetRect });
  menus.open(
    {
      rows,
      label: 'Context',
      anchor: pageAnchor(p, kind, r, scale),
      source: p.source,
      wash: kind === 'link' ? linkRects : [],
      backdrop: wv,
      guest: wv,
      borrowKeys: p.a11y ? null : borrowKeysOf(p.wcId),
    },
    menuTheme(b),
  );
}

// ---- tab bar, Home and fields ----

interface ChromeTarget {
  label: string;
  owner: HTMLElement | null;
  ownerButton?: HTMLElement | null;
  /** The page under the menu, sampled for the raised tint (default: the active tab's page). */
  backdrop?: WebviewTag | null;
  rows(env: ChromeEnv): MenuRow[];
  anchor(keyboard: boolean, x: number, y: number): MenuAnchor;
}

const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|password|tel|number|)$/.test(el.type));

function hangFrom(owner: HTMLElement) {
  return (keyboard: boolean, x: number): MenuAnchor => {
    const r = owner.getBoundingClientRect();
    return { kind: 'hang', left: keyboard ? r.left : x - 16, top: r.bottom + BAR_GAP };
  };
}

function belowOrAt(el: Element) {
  return (keyboard: boolean, x: number, y: number): MenuAnchor => {
    if (!keyboard) return { kind: 'point', x, y };
    const r = el.getBoundingClientRect();
    return { kind: 'below', left: r.left, top: r.top, bottom: r.bottom };
  };
}

function chromeTarget(b: Browser, target: Element): ChromeTarget | null {
  const field = target.closest('input, textarea');
  if (isTextField(field)) {
    const isAddress = field.id === 'omni-input';
    return { label: isAddress ? 'Address' : 'Edit', owner: null, rows: (env) => fieldRows(env, field, isAddress), anchor: belowOrAt(field) };
  }
  const peek = peekApi();
  if (target.closest('.vt-peek-head') && peek?.isOpen()) {
    return { label: 'Peek', owner: null, backdrop: peek.webview(), rows: (env) => peekHeaderRows(env, peek), anchor: belowOrAt(target) };
  }
  const barItem = target.closest('#bar .item') as HTMLElement | null;
  if (barItem?.classList.contains('plus')) {
    return { label: 'New tab', owner: barItem, ownerButton: barItem.querySelector<HTMLElement>('button'), rows: plusRows, anchor: hangFrom(barItem) };
  }
  if (barItem?.classList.contains('tab')) {
    const tab = b.tabs.find((t) => t.id === Number(barItem.dataset.id));
    if (!tab) return null;
    const active = tab.id === b.activeId;
    return {
      label: active ? 'Tab' : circleCaption(tab),
      owner: barItem,
      ownerButton: barItem.querySelector<HTMLElement>(active ? '.address' : '.circle-face'),
      rows: (env) => (active ? pillRows(env, tab) : circleRows(env, tab)),
      anchor: hangFrom(barItem),
    };
  }
  const home = target.closest('#home');
  if (home && b.active()?.kind === 'home' && !target.closest('button, a, select, [role="button"], [contenteditable]')) {
    return {
      label: 'Home',
      owner: null,
      rows: homeRows,
      anchor: (keyboard, x, y) => (keyboard ? { kind: 'point', ...NO_FOCUS_ANCHOR } : { kind: 'point', x, y }),
    };
  }
  return null;
}

/**
 * For other modules' surfaces (the find field's Match case, the downloads ring, a history
 * suggestion): show a Vitre menu. Build rows with item() and SEP from './menus/types'.
 */
export function openMenu(spec: MenuSpec): void {
  if (view && browser) view.open(spec, menuTheme(browser));
}

export function install(b: Browser): void {
  b.css('menus', MENU_CSS);
  const menus = new MenuView(b.layer('menus', 50));
  view = menus;
  browser = b;
  const played = new WeakSet<WebviewTag>();
  let token = 0;

  const openChrome = async (target: Element, x: number, y: number, keyboard: boolean): Promise<boolean> => {
    const ct = chromeTarget(b, target);
    if (!ct) return false;
    const mine = ++token;
    const { clip, a11y } = await chromeContext();
    if (mine !== token) return true;
    const env: ChromeEnv = { b, clip, audible: (t: Tab) => !!t.webview && played.has(t.webview) };
    const source: MenuSource = keyboard ? 'keyboard' : 'mouse';
    const active = b.active();
    const page = active?.kind === 'web' && active.ready ? active.webview : null;
    // A page that has focus (a tab or the peek) keeps it while a Vitre menu is open, as it does
    // for its own menu.
    const focused = focusedPage();
    menus.open(
      {
        rows: ct.rows(env),
        label: ct.label,
        anchor: ct.anchor(keyboard, x, y),
        source,
        owner: ct.owner,
        ownerButton: ct.ownerButton,
        backdrop: ct.backdrop === undefined ? page : ct.backdrop,
        guest: focused?.wv ?? null,
        borrowKeys: focused && !a11y ? borrowKeysOf(focused.id) : null,
      },
      menuTheme(b),
    );
    return true;
  };

  // Esc ladder: a menu is the first layer after the IME.
  b.addEscLayer(20, () => {
    if (!menus.isOpen) return false;
    menus.close('dismiss');
    return true;
  });

  window.vitre.ipc.on('menu:open', (payload) => {
    token++;
    openPage(b, menus, payload as MenuOpenPayload);
  });
  // Keys the page didn't get while its menu is open. A key from a page no open menu borrows
  // from (a lost close, a reloaded window) hands that page its keys back.
  window.vitre.ipc.on('menu:key', (raw) => {
    const k = raw as MenuKey;
    if (menus.isOpen && borrowedFrom === k.wcId) menus.handleKey(k);
    else window.vitre.ipc.send('menu:keys', k.wcId, false);
  });

  // A right press on the tab bar never takes focus from the page.
  document.getElementById('bar')?.addEventListener('mousedown', (e) => {
    if (e.button === 2) e.preventDefault();
  });

  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || !(e.target instanceof Element)) return;
    if (e.target.closest('.vt-menus')) {
      e.preventDefault();
      return;
    }
    const keyboard = e.button !== 2 || performance.now() - lastMenuKeyAt < 500;
    if (!chromeTarget(b, e.target)) return;
    e.preventDefault();
    void openChrome(e.target, e.clientX, e.clientY, keyboard);
  });

  // A right-click outside an open menu opens a fresh one where it landed.
  menus.onOutsideRightClick = (x, y, shift) => {
    const under = document.elementFromPoint(x, y);
    const wv = under?.closest('webview') as WebviewTag | null;
    if (wv) {
      try {
        const r = wv.getBoundingClientRect();
        void act({ op: 'replay', wcId: wv.getWebContentsId(), x: x - r.left, y: y - r.top, shift });
      } catch {
        /* not attached */
      }
    } else if (under) {
      void openChrome(under, x, y, false);
    }
  };

  // Context loss closes a menu at once. The window losing focus is reported by main, because the
  // chrome document sees no blur while the page it hosts has focus.
  window.vitre.win.onState((s) => {
    if (!s.focused) menus.close('instant', false);
  });
  b.on('tab-activated', () => menus.close('instant', false));
  b.on('tab-closed', () => menus.close('instant', false));
  b.on('webview-created', (_t: Tab, wv: WebviewTag) => {
    wv.addEventListener('media-started-playing', () => played.add(wv));
  });
}
