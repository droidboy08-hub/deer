// Right-click menus (DESIGN-NOTES "Right-click menus", "Find and menu build notes"; boards CtxMenu,
// MenuChrome, MenuGallery, MenuMotion, MenuReference, MenuSelection, MenuSpec, MenuSpelling).
// Gecko recipe: spikes/pagefeatures/RESULT.md (MENUS and corrections 7-10). Firefox internals are
// in ./gecko.ts; the page-side geometry in src/actors/page/menus.ts.
//
// One glass menu system replaces Firefox's menus:
//   - Page menus: Firefox's #contentAreaContextMenu is cancelled on popupshowing (after Firefox built
//     its nsContextMenu and the extensions their items) and Deer's menu opens at the same point
//     with the rows for that context (page-items.ts) plus the extension items. Closing it runs
//     Firefox's teardown for the popup that never showed.
//   - Deer's own surfaces (chrome-items.ts): the active pill, a background tab circle, the +
//     circle, Deer's text fields. Anything else in #vitre-root never shows a native menu: a text
//     field's contextmenu is prevented in the capture phase, before Firefox's editMenuOverlay.js
//     window listener would open its native textbox menu beside the glass one (any module's field,
//     with or without a menu of its own).
//   - The native menu is kept only where the design keeps it: the drag strip at the top of the
//     window and the window controls show Windows' own system menu. A page inside a native panel
//     (an extension's popup, a separate OS window above Deer's layer) keeps Firefox's page menu;
//     DevTools keeps its own menus.
//   - Tab bar menus hang at y 64 (the bar's resting geometry, also while an auto-hidden bar is still
//     sliding in) and hold an auto-hidden or full-screen bar on screen while they are open (any menu
//     whose owner is inside #vitre-bar, service menus included).
//   - The page whose navigation closes a menu is kept on its spec (Spec.page): the page for a page
//     menu, the tab a bar menu names, the active page for a service menu.
//
// Service 'menus' (types.ts MenusApi) for other modules' glass menus:
//   const menus = b.service('menus');
//   menus?.show([{ label: 'Show downloads', key: 'Ctrl+J', access: 'S', icon: 'download', run }, { separator: true }, ...],
//               ringElement, { align: 'above-end', onClose });
//   Call it from your own contextmenu listener (and preventDefault there): a menu shown while a
//   keyboard-triggered contextmenu (Shift+F10, the Menu key) is handled opens with its first row
//   focused and access keys underlined. menus.editItems(field) gives the standard editing rows for a
//   Deer text field (find adds Match case to them).
//
// Keys: while a menu is open every keydown goes to it through the key router's first hook
// (b.keys.addHook(fn, { first: true }): before find's and Peek's F6 hooks) (Up, Down, Home, End,
// Tab, Enter, Space, Right / Left for submenus, access letters; Esc, Alt, F10 close) and none
// reaches the page, another module or Deer's shortcuts. The page keeps focus unless assistive
// technology runs.
// Touch: 40 px rows centred above the finger; a pen gets the 40 px rows at its hotspot (as the mouse).
// Esc ladder priority 20. Context loss closes at once: resize, window deactivation, tab switch or
// close, navigation of the menu's page, a crash of its page's process ('tab-crashed'), element full
// screen starting or ending.
//
// For tests: window.vitreMenus = { state(), view, last } (last: the most recent page menu's kind
// and context, and the native popup's show count, which must stay 0).
import type { Browser } from '../../browser';
import type { Tab } from '../../model';
import type { MenuRecord } from '../../../actors/page/menus';
import { BAR_ITEM, BAR_TOP } from '../../../shared/geometry';
import { circleRows, fieldRows, isTextField, pillRows, plusRows } from './chrome-items';
import { MENU_CSS } from './css';
import * as gecko from './gecko';
import { extensionRows, isHome, kindOf, pageMenu, withExtensions, type PageEnv, type PageKind, type SelectionHit } from './page-items';
import { peekBrowser } from './services';
import { flatten, isCommand, item, SEP, tidy, type Anchor, type MenuItem, type MenusApi, type MenuSource, type ShowOptions, type Spec } from './types';
import { labelOf, MenuView, type MenuTheme } from './view';

/** Nothing focused: a keyboard-opened page menu goes here, below the tab bar (DESIGN-NOTES Placement). */
const NO_FOCUS_ANCHOR = { x: 24, y: 76 };
/** Tab bar menus hang 8 px below the bar's 44 px items (top 12): y 64. */
const BAR_GAP = 8;
/** A contextmenu event this recent still describes the menu being opened. */
const TRIGGER_FRESH_MS = 1500;

interface Trigger {
  keyboard: boolean;
  at: number;
  event: Event;
}

/** Menus follow Deer's Appearance mode (Match Windows by default), never the page or the bar's tint. */
function menuTheme(b: Browser): MenuTheme {
  const t = b.settings.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function install(b: Browser): void {
  b.css('menus', MENU_CSS);
  const view = new MenuView(b, b.layer('menus', 50));
  let trigger: Trigger | null = null;
  /** The contextmenu event being dispatched right now (set in capture, cleared after bubble). */
  let dispatching: Event | null = null;
  /** A menu was shown by someone while `dispatching` ran. */
  let shownDuring: Event | null = null;
  const last: { kind: PageKind | 'chrome' | ''; context: Record<string, unknown>; nativeShown: number; nativeAllowed: number; pageMenus: number; record: MenuRecord | null } = {
    kind: '',
    context: {},
    nativeShown: 0,
    nativeAllowed: 0,
    pageMenus: 0,
    record: null,
  };

  /** Page menus: the contextmenu that led to this popupshowing (it arrives a little later, from the page). */
  const keyboardTrigger = (): boolean => !!trigger && trigger.keyboard && performance.now() - trigger.at < TRIGGER_FRESH_MS;
  /** Service menus: shown while a keyboard-triggered contextmenu is being dispatched. */
  const keyboardDispatch = (): boolean => !!dispatching && !!trigger && trigger.event === dispatching && trigger.keyboard;

  const activePage = (): XULBrowser | null => {
    const peek = peekBrowser(b);
    if (peek) return peek;
    const t = b.active();
    return t && t.kind === 'web' && !t.deferred ? t.browser : null;
  };

  /**
   * Show a menu. `page` is the page whose navigation closes it; it is kept on the spec itself, so
   * the onClose of a menu this one replaces (it runs inside view.open) cannot clear it. A menu that
   * hangs from the tab bar (its owner is in #vitre-bar) holds an auto-hidden bar on screen until it
   * closes: the pointer on the menu's rows is below the bar's keep-alive band (reveal.ts), and the
   * element keeps its pressed look under its menu (MenuChrome). Returns whether it opened.
   */
  const open = (spec: Spec, page: XULBrowser | null): boolean => {
    spec.page = page;
    // The design has no submenus: nested rows are listed in place under a caption (types.ts flatten).
    spec.rows = flatten(spec.rows, (r) => labelOf(r).access);
    if (dispatching) shownDuring = dispatching;
    const owner = spec.owner as Element | null | undefined;
    if (owner?.closest?.('#vitre-bar')) {
      const release = b.bar.hold('menu');
      const done = spec.onClose;
      spec.onClose = (how) => {
        release();
        done?.(how);
      };
      view.open(spec, menuTheme(b));
      if (!view.isOpen || view.currentSpec() !== spec) release();
    } else {
      view.open(spec, menuTheme(b));
    }
    return view.isOpen && view.currentSpec() === spec;
  };

  // ---- the service ----

  const api: MenusApi = {
    show(items: MenuItem[], at: { x: number; y: number } | Element, opts: ShowOptions = {}) {
      const keyboard = opts.keyboard ?? keyboardDispatch();
      let anchor: Anchor;
      let owner: Element | null = opts.owner ?? null;
      if (at instanceof Element) {
        const r = at.getBoundingClientRect();
        anchor = { kind: 'below', left: r.left, right: r.right, top: r.top, bottom: r.bottom, gap: opts.gap ?? BAR_GAP, align: opts.align };
        if (opts.owner === undefined && b.root.contains(at)) owner = at;
      } else {
        anchor = { kind: 'point', x: Number(at.x) || 0, y: Number(at.y) || 0, align: opts.align };
      }
      const source: MenuSource = opts.touch ? 'touch' : keyboard ? 'keyboard' : 'mouse';
      const onClose = opts.onClose;
      const shown = open({ rows: items, label: opts.label ?? 'Context', anchor, source, owner, backdrop: activePage(), onClose: onClose ? () => onClose() : undefined }, activePage());
      // Nothing to show (no command row): onClose still runs once, so a caller that set a pressed
      // look or a hold of its own is never left waiting for a close that cannot come.
      if (!shown && onClose) {
        try {
          onClose();
        } catch (err) {
          console.error('Deer: menu onClose failed', err);
        }
      }
    },
    close() {
      view.close('instant');
    },
    isOpen: () => view.isOpen,
    editItems(field) {
      return fieldRows(b, field, false).filter((r) => !(isCommand(r) && r.label === 'Paste and go'));
    },
  };
  b.provide('menus', api);
  // Tests: the live menu, the last page menu's context, and the page rows for a stand-in context
  // (a peek page cannot be right-clicked without the Peek module, so its rows are checked this way).
  (window as any).vitreMenus = {
    state: () => view.state(),
    view,
    last,
    api,
    rowsFor: (cmLike: any, opts: { inPeek?: boolean; home?: boolean } = {}) => {
      const browser = cmLike.browser as XULBrowser;
      const env: PageEnv = { b, cm: cmLike, browser, tab: opts.inPeek ? undefined : b.tabFor(browser), inPeek: !!opts.inPeek, linkRects: [], selectionRect: null, targetRect: null, from: () => null };
      return tidy(pageMenu(env, kindOf(cmLike, !!opts.home))).map((r) => ('label' in r ? `${r.label}${r.key ? ` [${r.key}]` : ''}` : 'separator' in r ? '—' : `(${r.caption})`));
    },
  };

  // ---- triggers: who opened the next menu, and with what ----

  // Capture, on the window: sees every contextmenu before the page or any chrome element. button 0 is
  // the keyboard (Shift+F10, the Menu key: WM_CONTEXTMENU), 2 the mouse; the inputSource Gecko sends
  // with the page's context says "mouse" for the real keyboard path (pagefeatures correction 7).
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (performance.now() < view.quietUntil) {
        // The right button was released on a row: its contextmenu must not open another menu.
        view.quietUntil = 0;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      trigger = { keyboard: (e as MouseEvent).button === 0, at: performance.now(), event: e };
      dispatching = e;
      // Firefox's editMenuOverlay.js (gre/chrome/toolkit/content/global/editMenuOverlay.js) opens its
      // native textbox-contextmenu for any HTML input or textarea of this document from a window
      // listener registered at load, before this module's bubble listener, unless the event was
      // prevented first: Deer's own fields (Downloads' search, any module's field) get only the glass
      // menu. Not stopped: the field's own listener and the bubble listener below still run.
      const field = (e.target as Element | null)?.closest?.('input, textarea') ?? null;
      if (field && b.root.contains(field) && isTextField(field)) e.preventDefault();
      // Cleared by the bubble listener below; this covers a target that stopped the event.
      window.setTimeout(() => {
        if (dispatching === e) dispatching = null;
      }, 0);
    },
    true
  );

  // ---- page menus ----

  const popup = gecko.contextPopup();
  popup?.addEventListener('popupshown', () => last.nativeShown++);

  /**
   * The page module's menus:hit for the right-click being opened: it arrives just before Firefox's
   * own menu data (same channel, sent earlier in the event's dispatch). Kept for one menu, briefly.
   */
  let hit: (SelectionHit & { browser: XULBrowser; at: number }) | null = null;
  b.on('page-message', (_t, name, data, from) => {
    if (name !== 'menus:hit') return;
    const d = data as { inSelection?: unknown; linkSelected?: unknown } | null;
    hit = { browser: from.browser, at: performance.now(), inSelection: d?.inSelection === true, linkSelected: d?.linkSelected === true };
  });
  const takeHit = (browser: XULBrowser): SelectionHit | null => {
    const h = hit;
    hit = null;
    return h && h.browser === browser && performance.now() - h.at < TRIGGER_FRESH_MS ? { inSelection: h.inSelection, linkSelected: h.linkSelected } : null;
  };

  /** The rest of a page menu once the page module's record arrives: wash, origins, keyboard place. */
  const refine = async (env: PageEnv, spec: Spec, kind: PageKind, keyboard: boolean, point: { x: number; y: number }): Promise<void> => {
    let record: MenuRecord | null = null;
    try {
      const bc = env.cm.frameBrowsingContext ?? env.cm.contentData?.frameBrowsingContext ?? env.browser.browsingContext;
      record = ((await b.page(bc).query('menus:record')) as MenuRecord | null | undefined) ?? null;
    } catch {
      record = null;
    }
    last.record = record;
    if (!record || typeof record !== 'object') return;
    const box = env.browser.getBoundingClientRect();
    const zoom = env.browser.fullZoom || 1;
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    // A frame below another process (a cross-site frame) measured its own viewport and says where
    // that is on the screen: its CSS px times its device pixel ratio are device px, which this
    // window's ratio turns into window CSS px. Otherwise the record is in the top page's CSS px.
    const sc = record.partial && record.screen && ok(record.screen.x) && ok(record.screen.y) && ok(record.screen.dpr) && record.screen.dpr > 0 ? record.screen : null;
    const k = sc ? sc.dpr / (window.devicePixelRatio || 1) : zoom;
    const inner = gecko.innerScreen();
    const ox = sc ? sc.x * k - inner.x : box.left;
    const oy = sc ? sc.y * k - inner.y : box.top;
    const rect = (x: number, y: number, w: number, h: number): DOMRect => new DOMRect(ox + x * k, oy + y * k, w * k, h * k);
    const placed = !record.partial || !!sc;
    if (placed) {
      if (Array.isArray(record.link)) env.linkRects = record.link.filter((r) => r && ok(r.x) && ok(r.y) && ok(r.w) && ok(r.h)).slice(0, 24).map((r) => rect(r.x, r.y, r.w, r.h));
      const s = record.selection;
      if (s && ok(s.left) && ok(s.top) && ok(s.right) && ok(s.bottom)) env.selectionRect = rect(s.left, s.top, s.right - s.left, s.bottom - s.top);
      const t = record.target;
      if (t && ok(t.x) && ok(t.y) && ok(t.w) && ok(t.h)) env.targetRect = rect(t.x, t.y, t.w, t.h);
    }
    if (!view.isOpen || view.currentSpec() !== spec) return;
    if (kind === 'link' || kind === 'imagelink') view.addWash(kind === 'link' ? env.linkRects : []);
    if (!keyboard) return;
    // Keyboard: 4 px below Gecko's anchor (a focused link's bottom-left, the caret); a selection
    // hangs below its last line from its start; nothing focused: (24, 76).
    if (kind === 'selection' && env.selectionRect) {
      const r = env.selectionRect;
      view.reanchor(spec, { kind: 'below', left: r.left, right: r.right, top: r.top, bottom: r.bottom, gap: 4 });
    } else if (!record.focused && !env.selectionRect) {
      const r = box;
      view.reanchor(spec, { kind: 'point', x: r.left + NO_FOCUS_ANCHOR.x, y: r.top + NO_FOCUS_ANCHOR.y });
    } else if (record.lineHeight && ok(record.lineHeight)) {
      // A field: Gecko anchors at the caret's bottom-left; the menu hangs 4 px below the caret, or,
      // flipped near the bottom, ends 4 px above it (MenuSpelling). The caret is the font's
      // ascent + descent tall, centred in the line (the line height is only the fallback).
      const caret = record.caretHeight && ok(record.caretHeight) && record.caretHeight > 0 ? record.caretHeight : record.lineHeight;
      const lh = caret * zoom;
      view.reanchor(spec, { kind: 'below', left: point.x, right: point.x, top: point.y - lh, bottom: point.y, gap: 4 });
    } else if (record.focused && placed) {
      // Any other focused element (a link, a button): 4 px below it, left-aligned to it (the
      // focused #38 link at (86, 379, 425 x 20) gives a menu at (86, 403)).
      const f = rect(record.focused.x, record.focused.y, record.focused.w, record.focused.h);
      view.reanchor(spec, { kind: 'below', left: f.left, right: f.right, top: f.top, bottom: f.bottom, gap: 4 });
    }
  };

  const openPage = (cm: any): void => {
    const browser = cm.browser as XULBrowser;
    const tab = b.tabFor(browser);
    const peek = peekBrowser(b);
    const inPeek = !!peek && browser === peek;
    const home = isHome(browser, tab);
    const selHit = takeHit(browser);
    const kind = kindOf(cm, home, selHit);
    const src = gecko.contextInputSource(cm);
    const keyboard = src === gecko.SOURCE_KEYBOARD || keyboardTrigger();
    // DESIGN-NOTES: rows are 40 px by touch or pen; a finger's menu is centred above it, a pen opens
    // at its hotspot like the mouse.
    const touch = !keyboard && src === gecko.SOURCE_TOUCH;
    const pen = !keyboard && src === gecko.SOURCE_PEN;
    const point = gecko.contextPoint(cm);
    const env: PageEnv = { b, cm, browser, tab, inPeek, linkRects: [], selectionRect: null, targetRect: null, from: () => view.lastIcon, hit: selHit };
    let rows = pageMenu(env, kind);
    // Extension items (ext-menus.js put them into the XUL popup while Firefox built its menu). An
    // extension that overrides the context (menus.overrideContext, showDefaults false) shows alone.
    const ext = extensionRows(gecko.extensionNodes(popup));
    const override = cm.contentData?.webExtContextData;
    rows = override && override.showDefaults === false && ext.length ? ext : withExtensions(rows, ext);
    const lh = 20;
    const anchor: Anchor = keyboard
      ? { kind: 'below', left: point.x, right: point.x, top: point.y - lh, bottom: point.y, gap: 4 }
      : touch
        ? { kind: 'touch', x: point.x, y: point.y }
        : { kind: 'point', x: point.x, y: point.y };
    const session = cm;
    // An extension may change its items while the menu is open (menus.refresh() from menus.onShown:
    // ext-menus.js rebuildMenu replaces its nodes in the popup): the open menu follows.
    let watcher: MutationObserver | null = null;
    let pending = 0;
    const spec: Spec = {
      rows,
      label: 'Context',
      anchor,
      source: keyboard ? 'keyboard' : touch || pen ? 'touch' : 'mouse',
      backdrop: browser,
      onClose: () => {
        watcher?.disconnect();
        clearTimeout(pending);
        // Firefox's teardown, unless a newer right-click already replaced this session's
        // nsContextMenu (its own teardown will clean the popup up then).
        if (gecko.currentContextMenu() === session) gecko.endContextMenu(popup);
      },
    };
    last.kind = kind;
    last.pageMenus++;
    last.record = null;
    last.context = {
      kind,
      x: Math.round(point.x),
      y: Math.round(point.y),
      inputSource: src,
      keyboard,
      linkURL: cm.onLink ? String(cm.linkURL ?? '') : '',
      linkProtocol: String(cm.linkProtocol ?? ''),
      mediaURL: String(cm.mediaURL ?? ''),
      onImage: !!cm.onImage,
      onCanvas: !!cm.onCanvas,
      onVideo: !!cm.onVideo,
      onAudio: !!cm.onAudio,
      onDRMMedia: !!cm.onDRMMedia,
      selectionText: cm.isTextSelected ? String(cm.selectionInfo?.fullText ?? '') : '',
      editable: !!(cm.onTextInput || cm.onEditable),
      password: !!cm.onPassword,
      spelling: gecko.spelling(cm),
      inFrame: !!cm.inFrame,
      frameURL: String(cm.contentData?.docLocation ?? ''),
      pageURL: String(browser.currentURI?.spec ?? ''),
      inPeek,
      home,
      extensionItems: ext.length,
    };
    if (!open(spec, browser)) {
      // Nothing to show (no row survived): end Firefox's session all the same.
      spec.onClose?.('instant');
      return;
    }
    if (popup) {
      const extNode = (n: Node | null): boolean => !!(n as Element | null)?.id?.includes('-menuitem-') || !!(n as Element | null)?.closest?.('[id*="-menuitem-"]');
      watcher = new MutationObserver((records) => {
        // Firefox's own items change too (async password and text-fragment rows): only extension nodes matter.
        if (!records.some((r) => extNode(r.target) || Array.from(r.addedNodes).some(extNode) || Array.from(r.removedNodes).some(extNode))) return;
        clearTimeout(pending);
        pending = window.setTimeout(() => {
          if (view.currentSpec() !== spec) return;
          const fresh = extensionRows(gecko.extensionNodes(popup));
          const base = pageMenu(env, kind);
          view.refresh(spec, flatten(override && override.showDefaults === false && fresh.length ? fresh : withExtensions(base, fresh), (r) => labelOf(r).access));
          last.context.extensionItems = fresh.length;
        }, 30);
      });
      watcher.observe(popup, { childList: true, subtree: true, attributes: true, attributeFilter: ['label', 'checked', 'disabled', 'hidden', 'image'] });
    }
    void refine(env, spec, kind, keyboard, point);
  };

  // Bubble phase on the window: runs after Firefox's own popupshowing listener on the popup
  // (browser-context.js), which created gContextMenu and let extensions add their items.
  window.addEventListener('popupshowing', (e) => {
    if (!popup || e.target !== popup || e.defaultPrevented) return;
    const cm = gecko.currentContextMenu();
    if (!cm || !cm.shouldDisplay || !cm.contentData) return;
    // A page inside a native panel (an extension's popup) is a separate OS window above Deer's
    // layer: Firefox's own menu stays there, the one place a page keeps the native menu.
    if ((cm.browser as Element | null)?.closest?.('panel, menupopup')) {
      last.nativeAllowed++;
      return;
    }
    e.preventDefault();
    try {
      openPage(cm);
    } catch (err) {
      console.error('Deer: page menu failed', err);
      if (gecko.currentContextMenu() === cm) gecko.endContextMenu(popup);
    }
  });

  // ---- Deer's own surfaces ----

  // The bar's resting geometry, not the element's live box: an auto-hidden bar that is still sliding
  // in (or a circle mid-morph) would otherwise hang the menu higher than y 64.
  const hangFrom = (owner: Element, keyboard: boolean, x: number): Anchor => {
    const r = owner.getBoundingClientRect();
    return { kind: 'hang', left: keyboard ? r.left : x - 16, top: BAR_TOP + BAR_ITEM + BAR_GAP };
  };

  /** Extension items for a tab menu (contexts: ["tab"]): built into a scratch popup, cleaned up on close. */
  const tabExtensions = (t: Tab): { rows: MenuItem[]; end: () => void } => {
    let scratch: any = null;
    try {
      scratch = gecko.extensionScratch({ tab: t.node, pageUrl: t.url });
    } catch (err) {
      console.error('Deer: extension tab items failed', err);
    }
    const rows = scratch ? extensionRows(gecko.extensionNodes(scratch)) : [];
    return { rows, end: () => scratch && gecko.endExtensionScratch(scratch) };
  };

  const openChrome = (target: Element, e: MouseEvent): boolean => {
    const keyboard = e.button === 0;
    // A suggestion row of the address field: Remove from history, only on a row the user moved onto.
    const suggestion = target.closest('#vitre-omni-list .omni-item');
    if (suggestion) {
      const i = b.omni.removableRow(suggestion);
      if (i < 0) return true;
      const r = suggestion.getBoundingClientRect();
      last.kind = 'chrome';
      open(
        {
          rows: [item('Remove from history', 'close', 'Shift+Delete', 'R', () => b.omni.removeRow(i))],
          label: 'Suggestion',
          anchor: keyboard ? { kind: 'below', left: r.left, right: r.right, top: r.top, bottom: r.bottom, gap: 4 } : { kind: 'point', x: e.clientX, y: e.clientY },
          source: keyboard ? 'keyboard' : 'mouse',
          backdrop: activePage(),
        },
        activePage()
      );
      return true;
    }
    const field = target.closest('input, textarea');
    if (isTextField(field)) {
      const isAddress = field === b.omni.input;
      const r = field.getBoundingClientRect();
      const anchor: Anchor = keyboard ? { kind: 'below', left: r.left, right: r.right, top: r.top, bottom: r.bottom, gap: 4 } : { kind: 'point', x: e.clientX, y: e.clientY };
      last.kind = 'chrome';
      open({ rows: fieldRows(b, field, isAddress), label: isAddress ? 'Address' : 'Edit', anchor, source: keyboard ? 'keyboard' : 'mouse', backdrop: activePage() }, activePage());
      return true;
    }
    const barItem = target.closest('#vitre-bar .item') as HTMLElement | null;
    if (!barItem || barItem.classList.contains('leaving')) return false;
    let rows: MenuItem[];
    let label: string;
    let end: (() => void) | null = null;
    /** The page whose navigation makes this menu stale: the tab it names (the + circle names none). */
    let page: XULBrowser | null = null;
    if (barItem.classList.contains('plus')) {
      rows = plusRows(b);
      label = 'New tab';
    } else if (barItem.classList.contains('tab')) {
      const t = b.tab(Number(barItem.dataset.id));
      if (!t) return false;
      const active = t.id === b.activeId;
      page = t.deferred ? null : t.browser;
      rows = active ? pillRows(b, t) : circleRows(b, t);
      label = active ? 'Tab' : rows.find((r): r is { caption: string } => 'caption' in r)?.caption ?? 'Tab';
      const ext = tabExtensions(t);
      if (ext.rows.length) rows = tidy([...rows, SEP, ...ext.rows]);
      end = ext.end;
    } else {
      return false;
    }
    last.kind = 'chrome';
    const shown = open(
      {
        rows,
        label,
        anchor: hangFrom(barItem, keyboard, e.clientX),
        source: keyboard ? 'keyboard' : 'mouse',
        owner: barItem,
        backdrop: activePage(),
        onClose: end ? () => end?.() : undefined,
      },
      page
    );
    if (!shown) end?.();
    return true;
  };

  // A right press on the bar never takes focus from the page (the menu's edit rows act on it).
  b.root.addEventListener('mousedown', (e) => {
    if (e.button === 2 && (e.target as Element)?.closest?.('#vitre-bar')) e.preventDefault();
  });

  // Bubble phase on the window: after the target's own listeners, so a module that shows its own
  // menu from its element (menus.show in its contextmenu listener) wins.
  window.addEventListener('contextmenu', (e) => {
    const event = e as MouseEvent;
    const target = event.target as Element | null;
    const mine = dispatching === e;
    if (mine) dispatching = null;
    const shown = shownDuring === e;
    shownDuring = null;
    if (!target || typeof target.closest !== 'function') return;
    // The drag strip and the window controls keep Windows' own system menu (DESIGN-NOTES).
    if (target.closest('#vitre-drag, #vitre-winctl')) {
      event.preventDefault();
      if (event.button === 2) gecko.systemMenu(event.screenX, event.screenY);
      return;
    }
    if (!b.root.contains(target)) return; // pages and Firefox's own chrome: popupshowing above
    // Nothing in Deer's layer ever shows a native menu.
    event.preventDefault();
    if (shown || target.closest('.vt-menus')) return;
    try {
      openChrome(target, event);
    } catch (err) {
      console.error('Deer: chrome menu failed', err);
    }
  });

  // ---- keys ----

  // First of all hooks: an open menu takes every key, so find's and Peek's F6 hooks (installed
  // earlier or later) never see one while it is up.
  b.keys.addHook(
    (_binding, e) => {
      if (!view.isOpen) return undefined;
      if (e.isComposing || e.keyCode === 229) return undefined;
      view.handleKey(e);
      return 'swallow';
    },
    { first: true }
  );
  // Esc that arrives another way (the hardware Stop key runs b.escape()).
  b.addEscLayer(20, () => {
    if (!view.isOpen) return false;
    view.close('dismiss');
    return true;
  });

  // ---- context loss closes a menu at once ----

  const instant = (): void => {
    if (view.isOpen) view.close('instant');
  };
  window.addEventListener('resize', instant);
  window.addEventListener('deactivate', () => {
    if (view.closeOnBlur) instant();
  });
  window.addEventListener('MozDOMFullscreen:Entered', instant);
  window.addEventListener('MozDOMFullscreen:Exited', instant);
  b.on('tab-activated', instant);
  b.on('tab-closed', instant);
  b.on('tab-navigated', (_t, browser, info) => {
    const page = view.currentSpec()?.page;
    if (!info.sameDocument && page && browser === page) instant();
  });
  // The menu's page lost its content process: its rows describe a document that is gone.
  b.on('tab-crashed', (_t, browser) => {
    if (view.currentSpec()?.page === browser) instant();
  });
  b.on('closing', instant);
}

export type { MenusApi, MenuItem } from './types';
