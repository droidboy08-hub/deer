// Peek: Shift+click (or Shift+Enter on a focused link, or Ctrl+Q) opens a link in a glass sheet over
// the dimmed page. Esc, a click on the dim or Ctrl+W puts it back into its link; Alt+Enter, the
// Open as tab button or a double-click on the header turns it into a tab without reloading.
// Design: DESIGN-NOTES "Peek", keymap.json "Peek", boards PeekMotion, PeekOpen, PeekSpec,
// PeekDiscover. Ported from app/src/renderer/modules/peek; the Gecko mechanics follow
// spikes/pagefeatures/RESULT.md (PEEK, and the verifier's corrections 11-17).
//
// A peek is a real tab that is not in the bar (b.openHidden): its own <browser>, process, history,
// dialogs and permission prompts. Its tab panel is shown as the sheet (sheet.ts) and kept rendering
// while another tab is selected (gecko.ts keepActive). Open as tab is b.adopt(): the same browser
// becomes a tab, nothing reloads. A closed peek stays warm (hidden, muted, asleep) for 60 s.
//
// For other modules
//   b.service('peek')        PeekApi below (declared in VitreServices). Contract fields: open,
//                            isOpen, browser, close, promote, headerRect, canReopen, reopen. Extra,
//                            optional for callers: headerSlot (find's capsule) and search
//                            (Search for, honouring Settings › Tabs "Searches from selected text").
//   window.vitrePeek         { browser(), close(), open(url) } for the core (page keys act on the
//                            focused peek; the address field's Shift+Enter peeks).
//   'vitre:peek' event       on window, detail { phase: 'open' | 'closing' | 'promoting' | 'closed' }
//                            whenever the sheet changes (find hides its capsule, menus close).
//   A URL that came from a page must come with its principal: an OpenRequest, or
//   opts.triggeringPrincipal (plus referrerInfo / policyContainer / userContextId). A bare string
//   is treated as typed by the user (system principal) and must be http(s). A request from the
//   sheet's own page navigates the sheet (peeks don't nest); a sheet only shows over the active
//   tab (for another tab the link opens as a tab next to it).
//   Uses (optional)          'menus' service: the header's right-click menu (MenuSpec "Peek header").
//   Debug pref               vitre.debug.peekMotionScale (integer, tests only) slows the sheet's
//                            motion so a capture can catch it mid-flight (motion.ts).
//
// Links (b.interceptOpen): Shift+click (ClickHandlerParent, only clicks the page did not
// preventDefault) on an http(s) or file link of the active tab peeks it, unless Settings › Keyboard
// shortcuts says "Open in new window" (shiftClick: 'window'; Firefox then opens the window). A
// #fragment of the same page is left alone. From the sheet's page, target=_blank, window.open(url)
// and Shift+click load in the sheet; Ctrl+click and middle click make a background tab;
// window.open('') keeps its real window. A tab's own window.open / target=_blank are Firefox's.
// Shift+click on the dimmed page hops (the page module names the link under the pointer).
//
// Keys (src/shared/shortcuts.ts; the router keys.ts decides page-first / browser-first)
//   peekLink (Ctrl+Q)        the focused link, else the link under the pointer; in the address
//                            field, the highlighted result; nothing inside a sheet (peeks don't nest)
//   openAsTab (Alt+Enter)    promote (page-first: a page that uses Alt+Enter keeps it; rebindable)
//   Esc                      page-first; the Esc ladder (b.addEscLayer 100) closes the sheet. A
//                            second Esc within 400 ms is taken browser-first (a key hook) and closes
//                            anyway, unless the user typed in the peek: then it only nudges. Key
//                            repeat and an Esc used by a lower layer (menu, find...) never count.
//   Ctrl+W                   b.addCloseLayer(100): closes the sheet, never the tab under it
//   Alt+Left                 back in the sheet; on its first page it closes it (never on repeat)
//   F6 / Shift+F6            peek page -> header -> address field (and back), in a key hook while a
//                            peek is open; otherwise the registered focusAddress action runs
//   Ctrl+Shift+T             reopens the warm peek while its source tab is active and nothing was
//                            closed after it; otherwise Firefox's reopen (registerAction reopenClosed)
//   Developer tools          the peek is opened as a tab first (DevTools attach to the selected tab)
//
// The page inside the sheet gets no top inset (it sits below the bar, under its own header): the
// inset module's per-browser off switch (src/actors/page/inset.ts header) is set for the peek's
// browser before its first document and cleared when it becomes a tab, when the strip comes back
// as the sheet grows to the window. The PDF viewer's bar offset (src/actors/page/pdf.ts) follows
// the same switch.
//
// The bar stays on screen while a sheet is up (b.bar.hold: auto-hide and F11 full screen), and
// leaves with the dim. Keyboard focus never stays in a page that is no longer shown: a close by any
// route gives it back to the link (or, after a tab switch, to the new tab's page). A hop waits at
// most SNAPSHOT_MS for the old page's last frame and the latest hop asked for wins. A tab prompt in
// the sheet (alert, print preview) owns its Esc (keys.ts escTaken).
//
// Discovery (board PeekDiscover): after two bounces (a link followed and left again for the page
// before it within 30 s), the next web link pointed at shows the status bubble with "Shift+click to
// peek" in place of Firefox's own (OverLink event). Once, then retired (pref vitre.peek.hintShown;
// opening any peek retires it too).
//
// Edge cases (verifier corrections): element full screen from the sheet promotes it first (12);
// selecting the peek's tab from outside (DevTools, an extension) promotes it (11); permission
// prompts from the sheet show at once, hanging from the header (13); a peek tab never enters the
// closed-tab list (14); framefocusrequested / modal dialogs from the sheet never select its tab;
// focus is re-asserted after the first load and after a process switch (17).
import type { Browser, OpenRequest, Tab } from '../../browser';
import { HIDDEN_TAB_VALUE } from '../../model';
import { searchUrl } from '../../../shared/url';
import * as gk from './gecko';
import { EXPAND, reducedMotion, SPRING, tween } from './motion';
import { area, type Box, contentOf, HEADER, type Pose, poseView, releaseView, Sheet, sheetBox, shrunk, windowBox } from './sheet';
import { PEEK_CSS } from './style';

/** A link as the page module describes it (CSS px of its page's viewport). */
interface LinkInfo {
  id: number;
  href: string;
  rect: Box;
  row: Box | null;
}

interface Where {
  rect: Box;
  row: Box | null;
}

/** The page shown in the sheet: a hidden tab. */
interface Live {
  node: XULTab;
  browser: XULBrowser;
  panel: HTMLElement;
  openedUrl: string;
  /** A document other than the initial blank page arrived. */
  committed: boolean;
  /** The first document has painted (the cover can go). */
  painted: boolean;
  /** The user typed into it: a click on the dim or Esc Esc only nudges the sheet. */
  typed: boolean;
  paintTimer: number;
  /** The last link the sheet was asked to show and its principals (a crashed page is reloaded from it). */
  request: { url: string; principals: gk.Principals };
  /** Its content process crashed: never kept warm. */
  crashed: boolean;
}

interface Warm {
  live: Live;
  tab: Tab;
  link: LinkInfo | null;
  closedAt: number;
  timer: number;
}

type Phase = 'closed' | 'open' | 'closing' | 'promoting';

export interface PeekOpenOptions extends gk.Principals {
  /** Where the sheet grows from (window px), when there is no link to grow from. */
  origin?: { x: number; y: number; width: number; height: number };
  /** The page that asked (default: the active tab's). */
  browser?: XULBrowser;
}

export interface PeekApi {
  /** Peek a URL (or a request a page made) over the active tab; hops when a sheet is open there. */
  open(urlOrRequest: string | OpenRequest, opts?: PeekOpenOptions): void;
  isOpen(): boolean;
  /** The page in the open sheet (the topmost page), or null. */
  browser(): XULBrowser | null;
  close(): void;
  promote(): void;
  /** The sheet's header in the window, while a peek is open. */
  headerRect(): DOMRect | null;
  /** Ctrl+Shift+T would bring back a closed peek (rather than a closed tab) right now. */
  canReopen(): boolean;
  reopen(): void;
  /**
   * Find's capsule mounts in the header: true hides the domain and path and returns the slot the
   * 440×32 capsule goes in (window px); false gives them back. Null when no peek is open.
   */
  headerSlot?(on: boolean): DOMRect | null;
  /** "Search for" a selection: in a peek or a new tab, as Settings › Tabs says (selectionSearchOpens). */
  search?(text: string, opts?: { origin?: { x: number; y: number; width: number; height: number } }): void;
}

declare global {
  interface VitreServices {
    peek: PeekApi;
  }
}

const WARM_MS = 60_000;
/** A page in the sheet that crashes again this soon after being reloaded closes the sheet instead. */
const CRASH_AGAIN_MS = 30_000;
/** Discovery (PeekDiscover): a link followed and left again within BOUNCE_MS is a bounce; two in BOUNCES_WITHIN arm the hint. */
const BOUNCE_MS = 30_000;
const BOUNCES_WITHIN = 10 * 60_000;
const HINT_PREF = 'vitre.peek.hintShown';
const ESC_ESC_MS = 400;
const PAINT_FALLBACK_MS = 1200;
/** The longest a hop waits for the old page's snapshot before it goes on without one. */
const SNAPSHOT_MS = 250;
const isWeb = (url: string): boolean => /^https?:/i.test(url);
const isPeekable = (url: string): boolean => /^(?:https?|file):/i.test(url);

function padded(r: Box): Box {
  return { x: r.x - 4, y: r.y - 2, w: r.w + 8, h: r.h + 4, r: 4 };
}

function withTimeout<T>(p: Promise<T | undefined>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v ?? null);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Narrow what a page module answered (a compromised page can send anything). */
function asBox(v: unknown): Box | null {
  const b = v as Box | null;
  if (!b || typeof b !== 'object') return null;
  for (const k of ['x', 'y', 'w', 'h', 'r'] as const) if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) return null;
  return { x: b.x, y: b.y, w: Math.max(0, b.w), h: Math.max(0, b.h), r: Math.max(0, b.r) };
}
function asLink(v: unknown): LinkInfo | null {
  const l = v as LinkInfo | null;
  if (!l || typeof l !== 'object' || typeof l.id !== 'number' || typeof l.href !== 'string') return null;
  const rect = asBox(l.rect);
  if (!rect) return null;
  return { id: l.id, href: l.href, rect, row: asBox(l.row) };
}
function asWhere(v: unknown): Where | null {
  const w = v as Where | null;
  if (!w || typeof w !== 'object') return null;
  const rect = asBox(w.rect);
  return rect ? { rect, row: asBox(w.row) } : null;
}

export function install(b: Browser): void {
  b.css('peek', PEEK_CSS);
  const peek = new Peek(b);
  b.provide('peek', peek.api());
  window.vitrePeek = peek.hook();
}

class Peek {
  private sheet: Sheet;
  private phase: Phase = 'closed';
  private source: Tab | null = null;
  private link: LinkInfo | null = null;
  /** Where a peek opened without a link grew from (window px). */
  private anchor: Box | null = null;
  private live: Live | null = null;
  private warm: Warm | null = null;
  private lastEsc = 0;
  private forcedEsc = false;
  private escUsed = false;
  private lastTabClosedAt = 0;
  private washTab: Tab | null = null;
  /** b.adopt is running for the peek's tab (its TabSelect is ours). */
  private adopting = false;
  /** A hop is under way: its page has not painted yet (the old page's snapshot may be up). */
  private hopping = false;
  /** The hop's document arrived (a hop that never commits was a download, or was stopped). */
  private hopCommitted = false;
  private hopTimer = 0;
  /** Counts hops: only the latest one asked for goes on after its snapshot. */
  private hopSeq = 0;
  private pointer: { x: number; y: number; target: EventTarget | null } | null = null;
  private stopNudge: (() => void) | null = null;
  /** Discovery: per tab the page before and the one shown, the bounces seen, the bubble. */
  private trail = new Map<number, { back: string; leftAt: number; cur: string }>();
  private bounces: number[] = [];
  private hint: HTMLElement | null = null;
  private hintTimer = 0;
  /** The bar is held on screen while a sheet is up (auto-hide, F11): DESIGN-NOTES "Sheet". */
  private releaseBar: (() => void) | null = null;
  /** When the sheet last reloaded a crashed page (a second crash soon after closes it). */
  private crashReloadAt = 0;

  constructor(private b: Browser) {
    this.sheet = new Sheet(b.layer('peek', 8), {
      close: () => this.close(),
      promote: () => void this.promote(),
      back: () => this.live?.browser.goBack(),
      dimClick: (e) => this.dimClick(e),
      headerMenu: (e) => this.headerMenu(e),
    });
    if (b.isPopup) return; // a popup window shows one page: its links open the way Firefox opens them
    b.interceptOpen((r) => this.intercept(r));
    b.registerAction('peekLink', () => void this.peekFromPage());
    b.registerAction('openAsTab', () => {
      if (this.phase === 'open') void this.promote();
    });
    b.registerAction('reopenClosed', () => this.reopenClosed());
    for (const id of ['devtools', 'devtoolsConsole', 'devtoolsInspect'] as const) {
      b.registerAction(id, () => {
        // Developer tools attach to the selected tab: the page in the sheet becomes one first.
        if (this.phase === 'open' && this.peekFocused()) this.promoteNow();
        b.builtin(id);
      });
    }
    b.addEscLayer(0, () => this.escProbe());
    b.addEscLayer(100, () => this.escLayer());
    b.addCloseLayer(100, () => this.closeLayer());
    b.keys.addHook((binding, e) => this.keyHook(binding?.action, e));

    b.on('tab-activated', (t) => this.tabActivated(t));
    b.on('tab-closed', (t) => this.tabClosed(t));
    b.on('tab-navigated', (t, browser, info) => this.navigated(t, browser, info));
    b.on('tab-loading', (_t, browser, loading) => this.loadingChanged(browser, loading));
    b.on('tab-crashed', (_t, browser) => this.crashed(browser));
    b.on('page-message', (t, name, _data, from) => this.pageMessage(t, name, from.browser, from.isTop));
    b.on('settings', (_s, changed) => {
      if (changed.includes('rebind')) this.sheet.promoteKey(this.promoteSpec());
    });

    const isLive = (t: EventTarget | null): boolean => !!this.live && t === this.live.browser;
    const off = [
      gk.onTabEvent('TabSelect', (node) => this.tabSelected(node)),
      gk.onTabEvent('TabClose', (node) => this.tabClosing(node)),
      gk.onTabEvent('TabAttrModified', (node) => {
        if (this.live && node === this.live.node) this.refresh();
      }),
      gk.onTabEvent('TabRemotenessChange', (node) => {
        // A process switch inside the sheet replaces its browsingContext: keep it active and focused.
        if (!this.live || node !== this.live.node || this.phase !== 'open') return;
        gk.keepActive(this.live.browser);
        this.focusPeek(false);
      }),
      gk.blockFocusRequests(isLive),
      // A peek's tab that Firefox closed by itself (a download, window.close()) entered the closed-tab
      // list like any tab: a peek never stays there (Ctrl+Shift+T reopens one only while it is warm).
      gk.onClosedTabsChanged(() => gk.forgetClosedMarked(HIDDEN_TAB_VALUE)),
      gk.blockDialogSwitch(isLive),
    ];
    const resized = (): void => this.relayout();
    window.addEventListener('resize', resized);
    // Where the pointer is (window px): Ctrl+Q peeks the link under it, a Shift+click grows from it.
    const moved = (e: MouseEvent): void => {
      this.pointer = { x: e.clientX, y: e.clientY, target: e.target };
    };
    const left = (e: MouseEvent): void => {
      if (!e.relatedTarget) this.pointer = null;
    };
    window.addEventListener('mousemove', moved, { capture: true, passive: true });
    window.addEventListener('mousedown', moved, { capture: true, passive: true });
    window.addEventListener('mouseout', left, true);
    // The dimmed page never keeps keyboard focus while its peek is open (closing the address field
    // hands focus back to the tab, for example): the keys belong to the sheet.
    const focused = (e: FocusEvent): void => {
      if (this.phase === 'open' && this.source && e.target === this.source.browser) queueMicrotask(() => this.focusPeek(false));
    };
    window.addEventListener('focus', focused, true);
    // Firefox announces the link under the pointer (browser.js XULBrowserWindow.setOverLink).
    const overLink = (e: Event): void => this.overLink(String((e as CustomEvent).detail?.url ?? ''));
    window.addEventListener('OverLink', overLink);
    b.onDestroy(() => {
      window.removeEventListener('OverLink', overLink);
      for (const fn of off) fn();
      window.removeEventListener('resize', resized);
      window.removeEventListener('mousemove', moved, true);
      window.removeEventListener('mousedown', moved, true);
      window.removeEventListener('mouseout', left, true);
      window.removeEventListener('focus', focused, true);
      if (this.warm) window.clearTimeout(this.warm.timer);
      if (this.live) window.clearTimeout(this.live.paintTimer);
      // The window's tabs go with it; its ids leave the inset switch list.
      for (const live of [this.live, this.warm?.live]) if (live) gk.setPageInset(live.browser, true);
    });
    void b.whenReady.then(() => {
      gk.routeDoorhangers(() => this.topmost());
      // FullScreen is one of browser.js's lazy scripts: wrapped once delayed startup has loaded it.
      off.push(
        gk.beforeDomFullscreen((browser) => {
          if (this.phase === 'open' && this.live?.browser === browser) this.promoteNow();
        })
      );
    });
  }

  // ---- triggers ----

  /** Links a page wants opened somewhere else (b.interceptOpen). */
  private intercept(r: OpenRequest): boolean {
    const live = this.live;
    // From inside the sheet: a new tab or window the page asks for stays in the sheet; Ctrl+click
    // and middle click still make a background tab; window.open('') keeps its real window.
    if (live && r.browser === live.browser) {
      if (this.phase !== 'open' || r.disposition === 'background-tab' || r.disposition === 'save' || !r.url || !isPeekable(r.url)) return false;
      gk.loadIn(live.browser, r.url, this.principalsOf(r));
      return true;
    }
    if (r.source !== 'click' || r.disposition !== 'new-window') return false;
    const tab = r.opener;
    if (!tab || tab.id !== this.b.activeId) return false;
    // Settings › Keyboard shortcuts: "Shift+click a link: Peek / Open in new window".
    if (this.b.settings.shiftClick === 'window') return false;
    if (!isPeekable(r.url) || this.fragmentOf(tab, r.url)) return false;
    void this.claim(tab, r);
    return true;
  }

  /** Same document, another #fragment: not worth a sheet. */
  private fragmentOf(tab: Tab, url: string): boolean {
    try {
      const a = new URL(url);
      const c = new URL(tab.url);
      return !!a.hash && a.origin === c.origin && a.pathname === c.pathname && a.search === c.search;
    } catch {
      return false;
    }
  }

  private async claim(tab: Tab, r: OpenRequest): Promise<void> {
    // The link the user Shift+clicked (page module), so the sheet grows out of it and focus returns to it.
    const info = asLink(await withTimeout(this.b.page(tab).query('peek:gesture', { href: r.url }), 150));
    if (tab.id !== this.b.activeId) {
      // The user moved on meanwhile: the link opens as a tab next to its page, as Firefox would.
      this.b.openLink(r, 'tab', { index: this.b.tabs.indexOf(tab) + 1, background: true });
      return;
    }
    const from = info ? null : this.pointerBox();
    this.open(r.url, tab, info, from, this.principalsOf(r));
  }

  private principalsOf(r: OpenRequest): gk.Principals {
    const c = r.click ?? {};
    return { triggeringPrincipal: c.triggeringPrincipal, referrerInfo: c.referrerInfo, policyContainer: c.policyContainer, userContextId: c.originAttributes?.userContextId };
  }

  /** A small box at the last pointer position (window px). */
  private pointerBox(): Box | null {
    const p = this.pointer;
    return p ? { x: p.x - 8, y: p.y - 8, w: 16, h: 16, r: 8 } : null;
  }

  /** Ctrl+Q: the focused link, or the link under the pointer; in the address field, its highlighted result. */
  private async peekFromPage(): Promise<void> {
    const b = this.b;
    if (b.omni.open) {
      const cur = b.omni.current();
      const tab = b.active();
      if (!cur || !isWeb(cur.url) || !tab) return;
      const pill = b.bar.layout.pillRect;
      b.omni.close(false);
      this.open(cur.url, tab, null, pill ? { x: pill.x, y: pill.y, w: pill.width, h: pill.height, r: 22 } : null, {});
      return;
    }
    // Inside a sheet peeks don't nest.
    if (this.phase === 'open' && this.peekFocused()) return;
    if (this.phase === 'closing' || this.phase === 'promoting') return;
    const tab = b.active();
    if (!tab || tab.kind !== 'web') return;
    const at = this.pagePoint(tab);
    const info = asLink(await withTimeout(b.page(tab).query('peek:query', at ?? {}), 500));
    if (!info || !isWeb(info.href) || tab.id !== b.activeId) return;
    const principal = tab.browser.contentPrincipal;
    if (!gk.mayLoad(principal, info.href)) return;
    this.open(info.href, tab, info, null, { triggeringPrincipal: principal });
  }

  /** The pointer in the tab's page coordinates, when it is over that page. */
  private pagePoint(tab: Tab): { x: number; y: number } | null {
    const p = this.pointer;
    if (!p || p.target !== tab.browser) return null;
    const br = tab.browser.getBoundingClientRect();
    const z = tab.zoom || 1;
    return { x: (p.x - br.left) / z, y: (p.y - br.top) / z };
  }

  // ---- open, hop ----

  /**
   * Show `url` in the sheet over `tab`, growing from the link (page px of the tab) or `from`
   * (window px). With a sheet already open over that tab, the content swaps in place (hop).
   */
  private open(url: string, tab: Tab, link: LinkInfo | null, from: Box | null, principals: gk.Principals): void {
    if (this.phase === 'promoting') return;
    if (this.phase === 'open' && this.source === tab) {
      void this.hop(url, link, principals);
      return;
    }
    if (this.phase !== 'closed') this.finishClose(true);
    this.clearWash();
    this.hideHint();
    const live = this.takeWarm(url, tab) ?? this.create(url, principals, tab);
    if (!live) return;
    this.source = tab;
    this.link = link;
    this.anchor = link ? null : from;
    this.live = live;
    this.lastEsc = 0;
    live.typed = false;
    this.show(live, link ? this.toWindow(tab, link.rect, true) : from);
  }

  private create(url: string, p: gk.Principals, tab: Tab): Live | null {
    let made: { node: XULTab; browser: XULBrowser };
    try {
      // The page the link was on is the opener, as for a link Firefox opens in a new tab (ClickHandlerParent).
      made = this.b.openHidden(url, { ...p, openerBrowser: tab.browser });
    } catch (e) {
      console.error('Deer peek: could not open the page', e);
      return null;
    }
    // Before its first document: the sheet's page does not sit under the bar (inset.ts switch).
    gk.setPageInset(made.browser, false);
    const panel = gk.panelOf(made.node);
    if (!panel) {
      gk.removeQuietly(made.node);
      return null;
    }
    return { node: made.node, browser: made.browser, panel, openedUrl: url, committed: false, painted: false, typed: false, paintTimer: 0, request: { url, principals: p }, crashed: false };
  }

  /** Put the sheet on screen and grow it out of `from` (window px), 400 ms on the spring. */
  private show(live: Live, from: Box | null): void {
    const sheet = this.sheet;
    sheet.attach();
    live.panel.classList.remove('vitre-peek-leaving');
    live.panel.classList.add('vitre-peek-panel');
    gk.keepActive(live.browser);
    gk.setMuted(live.browser, false);
    sheet.clearSnapshot();
    sheet.covered(!live.painted);
    sheet.promoteKey(this.promoteSpec());
    this.phase = 'open';
    this.refresh();
    const S = sheetBox();
    const end: Pose = { box: S, off: HEADER };
    const reduced = reducedMotion();
    sheet.animate({
      from: reduced ? end : { box: from ?? shrunk(S), off: HEADER },
      to: end,
      ms: reduced ? 0 : 400,
      ease: SPRING,
      fade: { from: 0, to: 1, ms: reduced ? 150 : 80 },
      pages: [{ panel: live.panel, layout: contentOf(end) }],
    });
    sheet.dimmed(true, reduced ? 150 : 240);
    this.holdBar(true);
    this.b.setAnchor('peek', () => this.sheet.siteAnchor(), { popups: [gk.DOORHANGER_ID] });
    gk.refreshDoorhangers();
    this.focusPeek(true);
    if (live.committed && !live.painted) this.paintSoon(live);
    // Someone who peeks has found Peek: the hint is retired.
    this.retireHint();
    this.announce();
  }

  /** Shift+click another link on the dimmed page: the sheet stays, its content cross-fades. */
  private async hop(url: string, link: LinkInfo | null, p: gk.Principals): Promise<void> {
    const live = this.live;
    if (!live) return;
    if (link) {
      this.link = link;
      this.anchor = null;
    }
    // The last hop asked for wins: an earlier one still waiting for its snapshot gives up.
    const seq = ++this.hopSeq;
    if (url === live.browser.currentURI?.spec) {
      // Back to the page that is showing while a hop away from it is still loading: stay here.
      if (this.hopping && !this.hopCommitted) {
        live.browser.stop();
        this.endHop();
      }
      return;
    }
    live.typed = false;
    live.request = { url, principals: p };
    this.lastEsc = 0;
    const reduced = reducedMotion();
    // The old page's last frame stays over the content until the new page paints. Only a page that
    // painted has a frame to keep (before that the cover is up; a snapshot of a browser with no
    // painted document may never come), a snapshot already up (a hop that has not painted yet)
    // stays, and a slow snapshot is not waited for: a hop never stalls on it.
    const content = contentOf(this.sheet.current ?? { box: sheetBox(), off: HEADER });
    let bitmap: ImageBitmap | null = null;
    if (live.painted && !this.sheet.hasSnapshot) {
      const shot = this.b.snapshot(live.browser, null, window.devicePixelRatio || 1).catch(() => null);
      bitmap = await withTimeout(shot as Promise<ImageBitmap | undefined>, SNAPSHOT_MS);
      if (!bitmap) void shot.then((late) => late?.close());
    }
    if (seq !== this.hopSeq || this.live !== live || this.phase !== 'open') {
      bitmap?.close();
      return;
    }
    if (bitmap) {
      this.sheet.showSnapshot(bitmap, content.w, content.h);
      bitmap.close();
    }
    this.hopping = true;
    this.hopCommitted = false;
    window.clearTimeout(this.hopTimer);
    this.sheet.showSite(url, null, reduced ? 150 : 200);
    this.sheet.loading(true);
    this.sheet.canGoBack(false);
    gk.loadIn(live.browser, url, p, { replace: true });
  }

  /** The first document painted: the frosted cover fades. */
  private markPainted(live: Live): void {
    window.clearTimeout(live.paintTimer);
    live.paintTimer = 0;
    if (live.painted) return;
    live.painted = true;
    if (live !== this.live || this.phase !== 'open') return;
    this.sheet.covered(false, reducedMotion() ? 150 : 200);
  }

  /** The hop's page painted (or the hop ended without a page): the old page's snapshot fades. */
  private endHop(fade = true): void {
    window.clearTimeout(this.hopTimer);
    this.hopTimer = 0;
    if (!this.hopping) return;
    this.hopping = false;
    this.hopCommitted = false;
    if (!fade) {
      this.sheet.clearSnapshot();
      return;
    }
    this.sheet.fadeSnapshot(reducedMotion() ? 150 : 200);
    this.refresh();
  }

  /** A document committed: if no paint is reported, the cover goes after a while anyway. */
  private paintSoon(live: Live): void {
    window.clearTimeout(live.paintTimer);
    live.paintTimer = window.setTimeout(() => this.markPainted(live), PAINT_FALLBACK_MS);
  }

  private focusPeek(force: boolean): void {
    const live = this.live;
    if (!live || this.phase !== 'open' || this.b.active() !== this.source) return;
    const ae = document.activeElement;
    // Never take focus from the address field, find or a panel the user moved to.
    if (!force && ae && ae !== live.browser && ae !== this.source?.browser && ae !== document.body && ae !== document.documentElement) return;
    // DOM focus alone is not enough: keys go to the remote frame the focus manager thinks active.
    if (ae === live.browser) gk.clearChromeFocus();
    live.browser.focus();
  }

  /** The keys are the sheet's: its page or its header has focus. */
  private peekFocused(): boolean {
    const live = this.live;
    if (!live) return false;
    return this.b.keys.current?.browser === live.browser || document.activeElement === live.browser || this.sheet.headerHasFocus();
  }

  // ---- close ----

  close(): void {
    if (this.phase !== 'open' || !this.live) return;
    const live = this.live;
    this.phase = 'closing';
    this.endHop(false);
    this.leaving(live);
    this.sheet.cancel();
    const t0 = performance.now();
    const tab = this.source;
    const anchor = this.anchor;
    // The page under the dim may have moved (a banner loaded): ask where the link is now, then
    // shrink back into it.
    void this.locate(tab, this.link).then((where) => {
      if (this.live === live && this.phase === 'closing') this.shrink(live, where && tab ? this.toWindow(tab, where.rect, true) : anchor);
      const spot = where && tab ? this.toWindow(tab, where.row ?? padded(where.rect), false) : anchor && padded(anchor);
      if (tab && spot) this.wash(tab, spot, t0);
    });
    this.sheet.dimmed(false, reducedMotion() ? 150 : 240);
    // The bar leaves with the dim (it hides HIDE_DELAY after, reveal.ts), as on PeekMotion.
    this.holdBar(false);
    this.returnFocus(live);
    this.announce();
  }

  /**
   * Keep the bar on screen while a sheet is up: with auto-hide or in F11 full screen the bar stays
   * visible above the dim (DESIGN-NOTES "Sheet", board PeekMotion). b.bar.hold (reveal.ts).
   */
  private holdBar(on: boolean): void {
    if (on) this.releaseBar ??= this.b.bar.hold('peek');
    else {
      this.releaseBar?.();
      this.releaseBar = null;
    }
  }

  private async locate(tab: Tab | null, link: LinkInfo | null): Promise<Where | null> {
    if (!tab || !link) return null;
    const where = asWhere(await withTimeout(this.b.page(tab).query('peek:locate', { id: link.id }), 80));
    return where ?? { rect: link.rect, row: link.row };
  }

  /** Shrink back into the link (280 ms spring), fading over its last 120 ms. */
  private shrink(live: Live, into: Box | null): void {
    const S = sheetBox();
    const reduced = reducedMotion();
    this.sheet.animate({
      from: this.sheet.current ?? { box: S, off: HEADER },
      to: { box: reduced ? S : into ?? shrunk(S), off: HEADER },
      ms: reduced ? 0 : 280,
      ease: SPRING,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 0, ms: 120, delay: 180 },
      pages: [{ panel: live.panel, layout: contentOf({ box: S, off: HEADER }) }],
      done: () => this.finishClose(true),
    });
  }

  /** End the peek now. `keep` leaves the page warm for 60 s so peeking it again is instant. */
  private finishClose(keep: boolean): void {
    const live = this.live;
    const source = this.source;
    const link = this.link;
    // A page that is no longer shown never keeps keyboard focus: after a tab switch (Ctrl+Page
    // Down, Ctrl+1) Firefox leaves focus in the peek's <browser>, which is not the old selected
    // tab's, so keys would go to an invisible page and page-first keys would be dropped.
    const ae = document.activeElement;
    const hadFocus = !!live && (ae === live.browser || this.sheet.headerHasFocus());
    this.sheet.hide();
    this.stopNudge?.();
    this.endHop(false);
    this.holdBar(false);
    this.live = null;
    this.source = null;
    this.link = null;
    this.anchor = null;
    this.phase = 'closed';
    this.lastEsc = 0;
    if (live) {
      window.clearTimeout(live.paintTimer);
      this.detach(live);
      if (keep && source && live.committed && live.painted && !live.crashed && !live.node.closing) this.keepWarm(live, source, link);
      else this.discard(live);
    }
    if (hadFocus) this.b.focusPage();
    this.b.setAnchor('peek', () => null, { popups: [] });
    gk.refreshDoorhangers();
    this.announce();
  }

  /** The page leaves the sheet: its panel goes back to being a hidden tab's, asleep. */
  private detach(live: Live): void {
    live.panel.classList.remove('vitre-peek-panel', 'vitre-peek-leaving');
    releaseView(live.panel);
    gk.letSleep(live.browser);
  }

  private discard(live: Live): void {
    window.clearTimeout(live.paintTimer);
    gk.setPageInset(live.browser, true);
    gk.removeQuietly(live.node);
  }

  private leaving(live: Live): void {
    this.sheet.leaving(true);
    live.panel.classList.add('vitre-peek-leaving');
  }

  /**
   * An accent wash on the link's row (window px), so the eye finds its place again (1120 ms). It
   * lives among the tab panels under the dim and the shrinking sheet, as on PeekMotion (the wash is
   * drawn on the page, never over the sheet that is still folding into it).
   */
  private wash(tab: Tab, r: Box, t0: number): void {
    if (tab.id !== this.b.activeId || this.phase === 'open' || this.phase === 'promoting') return;
    this.clearWash();
    this.washTab = tab;
    const a = area();
    const el = document.createElement('div');
    el.className = 'vitre-peek-wash';
    el.style.left = `${r.x - a.left}px`;
    el.style.top = `${r.y - a.top}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.style.borderRadius = `${r.r}px`;
    el.style.animationDelay = `${Math.max(0, 260 - (performance.now() - t0))}ms`;
    gk.tabpanels().append(el);
    el.addEventListener('animationend', () => el.remove());
    window.setTimeout(() => el.remove(), 1700);
  }

  private clearWash(): void {
    this.washTab = null;
    for (const el of gk.tabpanels().querySelectorAll(':scope > .vitre-peek-wash')) el.remove();
  }

  /** Keyboard focus goes back to the page, on the link the peek came from. */
  private returnFocus(live: Live): void {
    const tab = this.source;
    if (!tab || tab.id !== this.b.activeId) return;
    if (document.activeElement === live.browser || this.sheet.headerHasFocus() || document.activeElement === document.body || !document.activeElement) {
      tab.browser.focus();
    }
    if (this.link) this.b.page(tab).send('peek:focus', { id: this.link.id });
  }

  /** After typing in the peek, a stray click on the dim or Esc Esc only bumps the sheet. */
  private nudge(): void {
    const live = this.live;
    if (reducedMotion() || !live) return;
    this.stopNudge?.();
    const els = [this.sheet.frame, this.sheet.chrome, live.panel];
    const set = (y: number): void => {
      for (const el of els) {
        if (y) el.style.translate = `0 ${Math.round(y * 100) / 100}px`;
        else el.style.removeProperty('translate');
      }
    };
    const stop = tween(
      300,
      (t) => set(-6 * Math.sin((Math.PI * t) / 300)),
      () => {
        set(0);
        this.stopNudge = null;
      }
    );
    this.stopNudge = () => {
      stop();
      set(0);
      this.stopNudge = null;
    };
  }

  private dimClick(e: MouseEvent): void {
    if (this.phase !== 'open' || e.button !== 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.shiftKey) void this.hopAt(e.clientX, e.clientY);
    else if (this.live?.typed) this.nudge();
    else this.close();
  }

  /** Shift+click on the dim: the link under the pointer on the page beneath. */
  private async hopAt(x: number, y: number): Promise<void> {
    const tab = this.source;
    if (!tab) return;
    const br = tab.browser.getBoundingClientRect();
    const z = tab.zoom || 1;
    const info = tab.kind === 'web' ? asLink(await withTimeout(this.b.page(tab).query('peek:at', { x: (x - br.left) / z, y: (y - br.top) / z }), 300)) : null;
    if (this.phase !== 'open' || this.source !== tab) return;
    const principal = tab.browser.contentPrincipal;
    if (info && isWeb(info.href) && gk.mayLoad(principal, info.href)) void this.hop(info.href, info, { triggeringPrincipal: principal });
    else if (this.live?.typed) this.nudge();
    else this.close();
  }

  // ---- open as tab ----

  /**
   * The sheet fills the window (380 ms, expand curve) while the header and rim give way; the
   * header's site rises into the bar as the new pill, right of its source (420 ms). Same browser:
   * nothing reloads. Over Home the new tab takes Home's place.
   */
  async promote(): Promise<void> {
    if (this.phase !== 'open' || !this.live || !this.source) return;
    const live = this.live;
    const src = this.source;
    this.phase = 'promoting';
    this.endHop(false);
    this.sheet.cancel();
    this.stopNudge?.();
    this.sheet.clearSnapshot();
    this.announce();
    const reduced = reducedMotion();
    const rise = reduced ? null : this.sheet.siteRect();
    // The page goes under the bar: it gets its top strip back. Where the strip lands at the top of a
    // page that is not scrolled, the page's content moves down by it: that part stays hidden above
    // the content's edge and shows as the sheet reaches the window's top.
    const shift = await this.insetBack(live.browser);
    if (this.live !== live || this.phase !== 'promoting') return;
    const from: Pose = this.sheet.current ?? { box: sheetBox(), off: HEADER };
    const to: Pose = { box: windowBox(), off: 0 };
    this.sheet.filling(true);
    // The page under the sheet stays on screen (and rendering) until the sheet covers the window.
    const underPanel = gk.panelOf(src.node);
    underPanel?.classList.add('vitre-peek-under');
    gk.keepActive(src.browser);
    // Adopt now, so the bar re-flows while the sheet grows.
    const at = this.b.tabs.indexOf(src);
    this.adopting = true;
    try {
      this.b.adopt(live.node, { index: src.kind === 'home' ? at : at + 1 });
    } finally {
      this.adopting = false;
    }
    this.sheet.animate({
      from: reduced ? to : from,
      to,
      ms: reduced ? 0 : 380,
      ease: EXPAND,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 1, ms: 0 },
      pages: [{ panel: live.panel, layout: to.box, lift: (k) => shift * (1 - k) }],
      pageFade: { from: 1, to: 1, ms: 0 },
      done: () => this.promoted(live, src, underPanel),
    });
    this.sheet.dimmed(false, reduced ? 150 : 240);
    if (rise) this.rise(rise, live);
  }

  /** The sheet fills the window: the page is an ordinary tab from here on. */
  private promoted(live: Live, src: Tab, underPanel: HTMLElement | null): void {
    this.detach(live);
    underPanel?.classList.remove('vitre-peek-under');
    if (src.node.isConnected && !src.node.selected) gk.letSleep(src.browser);
    this.sheet.hide();
    this.holdBar(false);
    this.live = null;
    this.source = null;
    this.link = null;
    this.anchor = null;
    this.phase = 'closed';
    if (src.kind === 'home' && this.b.tabs.includes(src)) this.b.closeTab(src);
    this.b.setAnchor('peek', () => null, { popups: [] });
    gk.refreshDoorhangers();
    this.b.focusPage();
    this.announce();
  }

  /**
   * Open as tab without motion, at once (element full screen asked from the sheet, developer
   * tools, the peek's tab selected from outside).
   */
  promoteNow(): void {
    const live = this.live;
    const src = this.source;
    if (!live || !src || (this.phase !== 'open' && this.phase !== 'promoting')) return;
    this.phase = 'promoting';
    this.sheet.cancel();
    this.stopNudge?.();
    this.sheet.hide();
    gk.panelOf(src.node)?.classList.remove('vitre-peek-under');
    gk.setPageInset(live.browser, true);
    this.b.page(live.browser).send('inset:check', {});
    this.detach(live);
    const at = this.b.tabs.indexOf(src);
    this.adopting = true;
    try {
      this.b.adopt(live.node, { index: src.kind === 'home' ? at : at + 1 });
    } finally {
      this.adopting = false;
    }
    gk.letSleep(live.browser);
    if (!src.node.selected) gk.letSleep(src.browser);
    this.holdBar(false);
    this.live = null;
    this.source = null;
    this.link = null;
    this.anchor = null;
    this.phase = 'closed';
    if (src.kind === 'home' && this.b.tabs.includes(src)) this.b.closeTab(src);
    this.b.setAnchor('peek', () => null, { popups: [] });
    gk.refreshDoorhangers();
    this.announce();
  }

  /** Turn the page's top strip back on; how far it moved the page's content down (window px). */
  private async insetBack(browser: XULBrowser): Promise<number> {
    const page = this.b.page(browser);
    const before = (await withTimeout(page.query<{ y?: number }>('core:scroll'), 120)) as { y?: number } | null;
    gk.setPageInset(browser, true);
    const state = (await withTimeout(page.query<{ applied?: boolean; px?: number }>('inset:check', {}), 150)) as { applied?: boolean; px?: number } | null;
    if (!state?.applied || typeof state.px !== 'number') return 0;
    // A scrolled page is kept in place by the inset module (it scrolls along with the strip).
    if (before && typeof before.y === 'number' && before.y > 0) return 0;
    const zoom = browser.fullZoom || 1;
    return Math.max(0, Math.min(200, state.px * zoom));
  }

  /** The header's site rises into the tab bar as the new pill (420 ms spring, fading out). */
  private rise(from: DOMRect, live: Live): void {
    const pill = this.b.bar.layout.pillRect;
    if (!pill) return;
    const layer = this.b.layer('peek-rise', 11);
    const lr = layer.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'vp-rise';
    el.setAttribute('aria-hidden', 'true');
    const icon = gk.iconOf(live.node);
    if (icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = icon;
      el.append(img);
    }
    const name = document.createElement('span');
    name.textContent = this.sheet.siteRect() ? (this.sheet.chrome.querySelector('.vp-id .dom')?.textContent ?? '') : '';
    el.append(name);
    const set = (x: number, y: number, w: number, h: number): void => {
      el.style.left = `${x - lr.left}px`;
      el.style.top = `${y - lr.top}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    set(from.left - 8, from.top + from.height / 2 - 14, from.width + 16, 28);
    layer.append(el);
    void el.offsetWidth;
    el.style.transition = ['left', 'top', 'width', 'height'].map((p) => `${p} 420ms cubic-bezier(0.22, 1, 0.36, 1)`).join(', ');
    set(pill.x, pill.y, pill.width, pill.height);
    window.setTimeout(() => el.remove(), 640);
  }

  // ---- keys ----

  /**
   * Key hook (keys.ts): F6 cycles through the sheet (focusCycle); Esc Esc: the second Esc within
   * 400 ms (no repeat) is taken before the page can use it.
   */
  private keyHook(action: string | undefined, e: KeyboardEvent): 'browser' | 'swallow' | undefined {
    if (action === 'focusAddress' && e.key === 'F6' && !e.repeat) return this.focusCycle(e.shiftKey) ? 'swallow' : undefined;
    if (e.key !== 'Escape' || action !== 'stop' || this.phase !== 'open' || !this.live) return undefined;
    if (e.target !== this.live.browser || e.repeat) return undefined;
    const now = performance.now();
    if (this.lastEsc && now - this.lastEsc < ESC_ESC_MS) {
      this.lastEsc = 0;
      this.forcedEsc = true;
      return 'browser';
    }
    this.lastEsc = now;
    return undefined;
  }

  /** First on every run of the Esc ladder: an Esc used by a layer below the peek never counts toward Esc Esc. */
  private escProbe(): boolean {
    if (this.phase !== 'open') return false;
    this.escUsed = false;
    queueMicrotask(() => {
      if (this.phase === 'open' && !this.escUsed) this.lastEsc = 0;
      this.forcedEsc = false;
    });
    return false;
  }

  private escLayer(): boolean {
    if (this.phase === 'closing' || this.phase === 'promoting') return true;
    if (this.phase !== 'open') return false;
    this.escUsed = true;
    if (this.forcedEsc && this.live?.typed) this.nudge();
    else this.close();
    this.forcedEsc = false;
    return true;
  }

  private closeLayer(): boolean {
    if (this.phase === 'open') {
      this.close();
      return true;
    }
    return this.phase === 'closing' || this.phase === 'promoting';
  }

  /** F6 / Shift+F6 with a peek open: peek page -> header -> address field, and back. */
  /**
   * F6 / Shift+F6 while a peek is open: peek page -> header -> address field, and back. Returns
   * true when it moved focus itself; otherwise the router runs whatever focusAddress action is
   * registered (the find module's, or the built-in that opens the address field).
   */
  private focusCycle(back: boolean): boolean {
    const b = this.b;
    if (this.phase !== 'open' || !this.live) return false;
    if (b.omni.focused) {
      b.omni.close(false);
      if (back) this.sheet.focusHeader();
      else this.focusPeek(true);
      return true;
    }
    if (document.activeElement === this.live.browser) {
      if (back) return false;
      this.sheet.focusHeader();
      return true;
    }
    if (this.sheet.headerHasFocus()) {
      if (!back) return false;
      this.focusPeek(true);
      return true;
    }
    return false;
  }

  /** Ctrl+Shift+T brings back a peek closed in the last 60 s while its tab is active. */
  private reopenClosed(): void {
    if (this.reopenable()) {
      void this.reopen();
      return;
    }
    this.b.builtin('reopenClosed');
  }

  private reopenable(): Warm | null {
    const w = this.warm;
    const tab = this.b.active();
    return w && tab && w.tab === tab && this.phase === 'closed' && w.closedAt > this.lastTabClosedAt && !w.live.node.closing ? w : null;
  }

  async reopen(): Promise<void> {
    const w = this.reopenable();
    if (!w) return;
    const tab = w.tab;
    let link = w.link;
    if (link) {
      const where = asWhere(await withTimeout(this.b.page(tab).query('peek:locate', { id: link.id }), 300));
      link = where ? { ...link, ...where } : null;
    }
    if (this.warm === w && tab.id === this.b.activeId && this.phase === 'closed') this.open(w.live.browser.currentURI?.spec ?? w.live.openedUrl, tab, link, null, {});
  }

  // ---- warm pages ----

  private keepWarm(live: Live, tab: Tab, link: LinkInfo | null): void {
    this.dropWarm();
    gk.setMuted(live.browser, true);
    const timer = window.setTimeout(() => this.dropWarm(), WARM_MS);
    this.warm = { live, tab, link, closedAt: Date.now(), timer };
  }

  private takeWarm(url: string, tab: Tab): Live | null {
    const w = this.warm;
    if (!w) return null;
    const current = w.live.browser.currentURI?.spec ?? '';
    if (w.tab !== tab || w.live.node.closing || (url !== current && url !== w.live.openedUrl)) {
      this.dropWarm();
      return null;
    }
    window.clearTimeout(w.timer);
    this.warm = null;
    return w.live;
  }

  private dropWarm(): void {
    const w = this.warm;
    if (!w) return;
    window.clearTimeout(w.timer);
    this.warm = null;
    this.discard(w.live);
  }

  // ---- the window and its tabs ----

  private tabActivated(tab: Tab): void {
    if (tab !== this.washTab) this.clearWash();
    this.hideHint();
    // Leaving the tab warm-closes its peek (keymap: "Leaving the tab warm-closes its peek").
    if ((this.phase === 'open' || this.phase === 'closing') && tab !== this.source) this.finishClose(true);
  }

  private tabClosed(tab: Tab): void {
    this.lastTabClosedAt = Date.now();
    this.trail.delete(tab.id);
    if (this.warm?.tab === tab) this.dropWarm();
    if (tab === this.source && (this.phase === 'open' || this.phase === 'closing')) this.finishClose(false);
  }

  /** Firefox's TabSelect for any tab. The peek's own tab selected by anything but Deer (DevTools, an extension) becomes a tab. */
  private tabSelected(node: XULTab): void {
    if (this.adopting) return;
    if (this.live && node === this.live.node && this.phase === 'open') {
      this.promoteNow();
      return;
    }
    const w = this.warm;
    if (w && node === w.live.node) {
      window.clearTimeout(w.timer);
      this.warm = null;
      gk.setMuted(w.live.browser, false);
      gk.setPageInset(w.live.browser, true);
      this.b.page(w.live.browser).send('inset:check', {});
      this.adopting = true;
      try {
        this.b.adopt(node, { index: this.b.tabs.indexOf(w.tab) + 1 });
      } finally {
        this.adopting = false;
      }
    }
  }

  /** The peek's tab is going away by itself (the page called window.close(), an extension closed it). */
  private tabClosing(node: XULTab): void {
    if (this.warm && node === this.warm.live.node) {
      window.clearTimeout(this.warm.timer);
      gk.setPageInset(this.warm.live.browser, true);
      this.warm = null;
    }
    if (this.live && node === this.live.node && this.phase !== 'promoting') {
      const live = this.live;
      const tab = this.source;
      gk.setPageInset(live.browser, true);
      // Keyboard focus was in the page that is going away: it goes back to the link, as for any close.
      if (this.phase === 'open') this.returnFocus(live);
      this.finishClose(false);
      // Firefox moves focus off the removed <browser> after TabClose (to the document): take it back.
      if (tab) {
        window.setTimeout(() => {
          const ae = document.activeElement;
          if (this.phase === 'closed' && tab.id === this.b.activeId && (!ae || ae === document.body || ae === document.documentElement)) tab.browser.focus();
        }, 0);
      }
    }
  }

  private navigated(tab: Tab | undefined, browser: XULBrowser, info: { url: string; sameDocument: boolean; errorPage: boolean }): void {
    const live = this.live;
    if (live && browser === live.browser) {
      if (!info.sameDocument && info.url && info.url !== 'about:blank') {
        const first = !live.committed;
        live.committed = true;
        if (!live.painted) this.paintSoon(live);
        if (first) this.focusPeek(false);
        if (this.hopping && !this.hopCommitted) {
          // The hop's document arrived: its first paint lets the snapshot go (or a while later anyway).
          this.hopCommitted = true;
          window.clearTimeout(this.hopTimer);
          this.hopTimer = window.setTimeout(() => this.endHop(), PAINT_FALLBACK_MS);
        }
      }
      this.refresh();
      return;
    }
    if (tab && !info.sameDocument && !info.errorPage) this.trackBounce(tab, info.url);
    // The page under the sheet went somewhere else: the link the peek came from is gone.
    if (tab && tab === this.source && this.phase === 'open' && !info.sameDocument) {
      this.link = null;
      this.anchor = null;
      this.close();
    }
  }

  private loadingChanged(browser: XULBrowser, loading: boolean): void {
    const live = this.live;
    if (!live || browser !== live.browser) return;
    this.refresh();
    if (loading || this.phase !== 'open') return;
    // A hop whose load ended without a document (a download, or stopped): the old page stays.
    if (this.hopping && !this.hopCommitted) this.endHop();
    // The first load ended without a document: the link was a download.
    else if (!live.committed) this.aborted(live);
  }

  private pageMessage(tab: Tab | undefined, name: string, browser: XULBrowser, isTop: boolean): void {
    const live = this.live;
    if (live && browser === live.browser) {
      if (name === 'peek:typed') live.typed = true;
      else if (isTop && (name === 'core:paint' || name === 'core:pageshow')) {
        if (live.committed) this.markPainted(live);
        if (this.hopping && this.hopCommitted) this.endHop();
      }
      return;
    }
    // The wash would no longer sit on the row once the page under it scrolls.
    if (name === 'core:scroll' && tab && tab === this.washTab) this.clearWash();
  }

  /**
   * A page's content process crashed ('tab-crashed', after Firefox's handling, which leaves a peek's
   * hidden tab blank: TabCrashHandler.onBackgroundBrowserCrash restores it only when it is
   * selected). A warm peek is dropped. The open sheet's page is replaced by a fresh one loading the
   * last link the sheet was asked for, with that link's principals (find in its header closed
   * itself on the same event); a page that crashes again within CRASH_AGAIN_MS closes the sheet.
   * While the sheet is turning into a tab the tab keeps Firefox's handling.
   */
  private crashed(browser: XULBrowser): void {
    if (this.warm && browser === this.warm.live.browser) {
      this.warm.live.crashed = true;
      this.dropWarm();
      return;
    }
    const live = this.live;
    if (!live || browser !== live.browser) return;
    live.crashed = true;
    const tab = this.source;
    if (this.phase !== 'open' || !tab) return;
    const now = Date.now();
    const again = now - this.crashReloadAt < CRASH_AGAIN_MS;
    const fresh = again ? null : this.create(live.request.url, live.request.principals, tab);
    if (!fresh) {
      this.close();
      return;
    }
    this.crashReloadAt = now;
    const hadFocus = document.activeElement === live.browser || this.sheet.headerHasFocus();
    this.endHop(false);
    // The new page first: removing the old tab fires TabClose (tabClosing must not see it as the sheet's).
    this.live = fresh;
    this.detach(live);
    this.discard(live);
    fresh.panel.classList.add('vitre-peek-panel');
    gk.keepActive(fresh.browser);
    gk.setMuted(fresh.browser, false);
    this.sheet.clearSnapshot();
    this.sheet.covered(true, 0);
    this.relayout();
    this.refresh();
    this.b.setAnchor('peek', () => this.sheet.siteAnchor(), { popups: [gk.DOORHANGER_ID] });
    gk.refreshDoorhangers();
    this.focusPeek(hadFocus);
    this.announce();
  }

  /** The link was a download: the sheet folds into a circle that drops toward the downloads ring. */
  private aborted(live: Live): void {
    if (this.live !== live || this.phase !== 'open') return;
    this.phase = 'closing';
    this.leaving(live);
    const reduced = reducedMotion();
    const a = area();
    const from: Pose = this.sheet.current ?? { box: sheetBox(), off: HEADER };
    const ring: Box = { x: a.right - 116, y: a.bottom - 64, w: 44, h: 44, r: 22 };
    this.sheet.animate({
      from,
      to: reduced ? from : { box: ring, off: HEADER },
      ms: reduced ? 0 : 400,
      ease: SPRING,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 0, ms: 160, delay: 240 },
      pages: [{ panel: live.panel, layout: contentOf({ box: sheetBox(), off: HEADER }) }],
      done: () => this.finishClose(false),
    });
    this.sheet.dimmed(false, reduced ? 150 : 240);
    this.holdBar(false);
    this.returnFocus(live);
    this.announce();
  }

  private relayout(): void {
    const live = this.live;
    if (this.phase !== 'open' || !live) return;
    this.sheet.cancel();
    const p: Pose = { box: sheetBox(), off: HEADER };
    this.sheet.place(p, 1);
    poseView(live.panel, contentOf(p), p, 1);
  }

  /** The header, the address and the back button follow the page in the sheet. */
  private refresh(): void {
    const live = this.live;
    if (!live || (this.phase !== 'open' && this.phase !== 'closing')) return;
    let url = '';
    try {
      url = live.browser.currentURI?.spec ?? '';
    } catch {
      url = '';
    }
    // Before the first document the address is the one asked for (Tabbrowser addTab userTypedValue).
    if (!url || url === 'about:blank') url = (typeof live.browser.userTypedValue === 'string' && live.browser.userTypedValue) || live.openedUrl;
    // Until the hop's document arrives the header keeps the address it is going to.
    const waiting = this.hopping && !this.hopCommitted;
    if (!waiting) this.sheet.showSite(url, gk.iconOf(live.node), 0);
    this.sheet.loading(gk.busy(live.node) || !live.committed || waiting);
    this.sheet.canGoBack(!waiting && !!live.browser.canGoBack);
  }

  /** The page permission prompts and page keys belong to: the sheet's while it is open over the active tab. */
  private topmost(): XULBrowser | null {
    return this.phase === 'open' && this.live && this.b.active() === this.source ? this.live.browser : null;
  }

  private promoteSpec(): string {
    const binding = this.b.keys?.bindings().find((x) => x.action === 'openAsTab');
    return binding?.spec ?? 'Alt+Enter';
  }

  /** Right-click on the header: the Peek header menu (MenuSpec "Peek header"), through the menus module. */
  private headerMenu(e: MouseEvent): void {
    // Typed by the provider (menus/types.ts MenusApi); undefined when the menus module is not in the build.
    const menus = this.b.service('menus');
    const live = this.live;
    if (!menus || !live || this.phase !== 'open') return;
    const url = live.browser.currentURI?.spec ?? '';
    // Glyph names of the menus module (menus/icons.ts); `key` is the accelerator column, `access`
    // the access key (menus/types.ts), as its own "Peek page" rows have them.
    const rows = [
      { label: 'Open as tab', icon: 'opentab', key: this.promoteSpec(), access: 'T', run: () => void this.promote() },
      { label: 'Copy address', icon: 'link', access: 'A', run: () => gk.copyText(url) },
      { label: 'Open in new window', icon: 'newwindow', access: 'W', run: () => this.openInWindow() },
      { separator: true as const },
      { label: 'Close peek', icon: 'close', key: 'Esc', access: 'C', run: () => this.close() },
    ];
    menus.show(rows, { x: e.clientX, y: e.clientY });
  }

  /** Header menu: the page in the sheet moves to a window of its own (it becomes a tab first). */
  private openInWindow(): void {
    const live = this.live;
    if (!live) return;
    const node = live.node;
    this.promoteNow();
    const t = this.b.tabFor(node.linkedBrowser);
    if (t) this.b.moveToNewWindow(t);
  }

  /** The sheet is in place, for other modules: rects in window px. */
  private headerRect(): DOMRect | null {
    return this.phase === 'open' ? this.sheet.headerRect() : null;
  }

  private announce(): void {
    window.dispatchEvent(new CustomEvent('vitre:peek', { detail: { phase: this.phase } }));
  }

  /** Page px of `tab` to window px; `link` boxes get a minimum size to grow from. */
  private toWindow(tab: Tab, r: Box, link: boolean): Box {
    const br = tab.browser.getBoundingClientRect();
    const z = tab.zoom || 1;
    const box = { x: br.left + r.x * z, y: br.top + r.y * z, w: r.w * z, h: r.h * z, r: r.r * z };
    if (!link) return box;
    return { ...box, w: Math.max(8, box.w), h: Math.max(8, box.h), r: 6 };
  }

  // ---- discovery (board PeekDiscover) ----

  /** A page followed and then left again for the page before it within 30 s: a bounce. Two arm the hint. */
  private trackBounce(tab: Tab, url: string): void {
    if (!url || url === 'about:blank' || this.hintRetired()) return;
    const tr = this.trail.get(tab.id) ?? { back: '', leftAt: 0, cur: '' };
    const now = Date.now();
    if (tr.cur && url === tr.back && now - tr.leftAt < BOUNCE_MS) {
      this.bounces = [...this.bounces.filter((t) => now - t < BOUNCES_WITHIN), now];
    }
    this.trail.set(tab.id, { back: tr.cur, leftAt: now, cur: url });
  }

  private hintRetired(): boolean {
    try {
      return Services.prefs.getBoolPref(HINT_PREF, false);
    } catch {
      return true;
    }
  }

  private retireHint(): void {
    this.bounces = [];
    this.trail.clear();
    if (this.hintRetired()) return;
    try {
      Services.prefs.setBoolPref(HINT_PREF, true);
    } catch {
      /* the pref cannot be written: the hint may show again next time, nothing worse */
    }
  }

  /**
   * The link under the pointer changed. Once the user has bounced twice, the first web link they
   * point at gets the status bubble with "Shift+click to peek"; it shows once, then is retired.
   */
  private overLink(url: string): void {
    if (this.hint) {
      if (!url) {
        window.clearTimeout(this.hintTimer);
        this.hintTimer = window.setTimeout(() => this.hideHint(), 600);
      }
      return;
    }
    if (!url || this.bounces.length < 2 || this.phase !== 'closed' || this.b.settings.shiftClick !== 'peek' || this.hintRetired()) return;
    const tab = this.b.active();
    // setOverLink trims "http://" for display: anything that is not another scheme is a web link.
    if (!tab || tab.kind !== 'web' || /^(?!https?:)[a-z][\w+.-]*:/i.test(url)) return;
    this.showHint(url);
  }

  private showHint(url: string): void {
    const layer = this.b.layer('peek', 8);
    const lr = layer.getBoundingClientRect();
    const a = area();
    const text = document.createElement('span');
    text.className = 'u';
    text.textContent = url.replace(/^https?:\/\//i, '');
    const dot = document.createElement('span');
    dot.className = 'd';
    const tip = document.createElement('span');
    tip.className = 'h';
    tip.textContent = 'Shift+click to peek';
    const el = document.createElement('div');
    el.className = 'vp-hint';
    el.setAttribute('role', 'status');
    el.append(text, dot, tip);
    el.style.left = `${a.left - lr.left + 12}px`;
    el.style.bottom = `${lr.bottom - a.bottom + 12}px`;
    layer.append(el);
    this.hint = el;
    // Firefox's own status bubble would sit in the same corner.
    document.documentElement.setAttribute('vitre-peek-hint', 'true');
    this.retireHint();
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), 6000);
  }

  private hideHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hint?.remove();
    this.hint = null;
    document.documentElement.removeAttribute('vitre-peek-hint');
  }

  // ---- API ----

  /** The API for other modules (b.service('peek')). */
  api(): PeekApi {
    return {
      open: (target, opts = {}) => this.apiOpen(target, opts),
      isOpen: () => this.phase === 'open',
      browser: () => (this.phase === 'open' ? (this.live?.browser ?? null) : null),
      close: () => this.close(),
      promote: () => void this.promote(),
      headerRect: () => this.headerRect(),
      canReopen: () => !!this.reopenable(),
      reopen: () => void this.reopen(),
      headerSlot: (on) => {
        if (this.phase !== 'open') {
          this.sheet.covering(false);
          return null;
        }
        this.sheet.covering(on);
        return on ? this.sheet.slotRect() : null;
      },
      search: (text, opts = {}) => {
        const q = text.trim();
        if (!q) return;
        const url = searchUrl(q);
        const tab = this.b.active();
        if (this.b.settings.selectionSearchOpens === 'tab' || !tab || this.phase === 'open') {
          // Inside a sheet peeks don't nest: Search for opens a new tab there (MenuSpec "Peek page").
          this.b.newTab(url, { index: tab ? this.b.tabs.indexOf(tab) + 1 : undefined });
          return;
        }
        this.apiOpen(url, opts);
      },
    };
  }

  /** window.vitrePeek: what the core uses (page keys on the focused peek, the address field's Shift+Enter). */
  hook(): NonNullable<Window['vitrePeek']> {
    return {
      browser: () => (this.phase === 'open' ? (this.live?.browser ?? null) : null),
      close: () => {
        if (this.phase !== 'open') return false;
        // Alt+Left on the first page closes the peek, never on key repeat (keymap "Peek").
        const k = this.b.keys?.current;
        if (k && k.action === 'back' && k.repeat) return false;
        this.close();
        return true;
      },
      open: (url: string) => this.apiOpen(url, { origin: this.pillOrigin() }),
    };
  }

  private pillOrigin(): { x: number; y: number; width: number; height: number } | undefined {
    const pill = this.b.bar.layout.pillRect;
    return pill ? { x: pill.x, y: pill.y, width: pill.width, height: pill.height } : undefined;
  }

  private apiOpen(target: string | OpenRequest, opts: PeekOpenOptions): void {
    const request = typeof target === 'string' ? null : target;
    const url = request ? request.url : target as string;
    if (!url) return;
    const principals: gk.Principals = request
      ? this.principalsOf(request)
      : { triggeringPrincipal: opts.triggeringPrincipal, referrerInfo: opts.referrerInfo, policyContainer: opts.policyContainer, userContextId: opts.userContextId };
    // Without a page principal this is the user's own address: only the web.
    if (!principals.triggeringPrincipal && !isWeb(url)) return;
    if (principals.triggeringPrincipal && (!isPeekable(url) || !gk.mayLoad(principals.triggeringPrincipal, url))) return;
    const asker = request?.browser ?? opts.browser ?? null;
    // From the page in the sheet: it navigates there (peeks don't nest).
    if (this.live && asker === this.live.browser) {
      if (this.phase === 'open') gk.loadIn(this.live.browser, url, principals);
      return;
    }
    const tab = (asker ? this.b.tabFor(asker) : undefined) ?? this.b.active();
    if (!tab) return;
    if (this.b.isPopup || tab.id !== this.b.activeId) {
      // A sheet shows over the active tab only.
      if (request) this.b.openLink(request, 'tab');
      else this.b.openLink(url, 'tab', { ...principals, index: this.b.tabs.indexOf(tab) + 1 });
      return;
    }
    const o = opts.origin;
    const from: Box | null = o ? { x: o.x, y: o.y, w: Math.max(8, o.width), h: Math.max(8, o.height), r: Math.min(22, o.height / 2) } : null;
    this.open(url, tab, null, from, principals);
  }
}
