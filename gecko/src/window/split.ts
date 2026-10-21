// Split view: two pages side by side in one window, left and right only
// (../design/SPLIT-VIEW-SPEC.md; boards SplitOpen, SplitSpec, SplitPill, SplitStart, SplitMotion).
//
// Deer runs Firefox 157's own split view and hides its chrome. Firefox keeps the model: a
// <tab-split-view-wrapper> holding the two <tab>s in the tab strip, both docshells active while the
// pair is shown, the selected tab as the focused side, per-pane notification bars, DOM full screen
// from one pane and session restore of the pairs. This file wraps it (every Firefox internal it uses
// is behind one small function below, with its source under gecko/reference/omni) and draws
// Deer's parts of the content area: the 8 px gutter, pane corners and rims, the divider, the crash
// card of an unfocused pane and the polite announcements. The bar's split pill and capsule are in
// bar.ts, the menus' rows in modules/menus, the address field's side glyph and "Show here" in
// omnibox.ts.
//
// Contract (Browser API, browser.ts, which forwards to this class)
//   b.split(other?, opts?)    pair the active tab with `other` (a Tab or its id): the other tab keeps
//                             its side of the bar, focus stays (spec "How to start split view").
//                             With a pair active, `other` replaces its Home side if it has one, else
//                             its unfocused side ("Open in split view instead of ..."); a web tab it
//                             replaces goes back to the bar beside the pair, a Home side is closed.
//                             b.split('home') is "New tab in split view": the page goes left and an
//                             empty Home opens on the right, focused, its field open. Returns the
//                             pair, or null when refused (popup window, window under 648 px, Home
//                             with Home, a pinned tab).
//   b.split(other, { side })  with a side: `other` goes on that side (a circle dropped on an edge,
//                             splitlift.ts); with a pair active it replaces that side.
//   b.separate(ref?, { animate })  both tabs stay open; the focused side stays active. animate (the
//                             menus, Ctrl+Shift+U): the other pane's picture slides out as it goes,
//                             and the page that stays fills the window 250 ms later (holdPane).
//   b.closeTab(ref, { animate })   a side closed from Deer's own gestures: its pane's picture slides out.
//   b.swapSides(ref?)         the pages trade places; the divider stays where it is.
//   b.splitRatio(ref?, r?)    the left pane's share of (window - 8 px), 3 decimals, per pair,
//                             saved with the session (tab value RATIO_KEY on the column-0 tab).
//                             Stored as set: the 320 px minimums apply at layout, so a narrow or
//                             collapsed window never rewrites it (spec "Panes": kept through window
//                             resizes, clamped to the minimums).
//   b.units()                 the bar's units: a tab, or a pair as one unit (bar.ts arrange()).
//   b.shown(tab)              the tab's page is on screen: the active tab, or the other side of the
//                             active pair while the window is wide enough.
//   b.pairOf(ref)             the pair a tab belongs to (addition).
//   'split-changed'           a pair formed, ended, swapped, its focused side or ratio changed, the
//                             panes moved (a divider drag: at most once per frame; a window resize),
//                             or the window collapsed or restored it. The bar's mixed tint and the
//                             window controls' theme follow it (bar.ts), and an open address field
//                             its side (omnibox.ts).
//   'tab-activated' (tab, { withinPair })  withinPair: focus moved between the sides of one pair.
//
// Layout (spec "Panes", "Divider", "Build notes"): CSS on #tabbrowser-tabpanels[splitview] puts the
// column-0 panel at clamp(320, round(r * (W - 8)), W - 328) with an 8 px right margin (the gutter, in
// the Appearance mode's colour) and lets column 1 take the rest; Firefox's splitter, footers,
// outline and 50 ms width transition are hidden. Under 648 px the window collapses to the focused
// side (attribute vitre-collapsed) and comes back at 680 px. Deer's own parts live in div#vitre-split
// inside the tab panels (like Peek's dim: above the pages, under the dim and the sheet, the address
// field's scrim and the bar, which are in #vitre-root above every panel; mounted the first time a
// split shows, never moved, not displayed without one): the divider (the gutter
// itself; ew-resize; grip after a 120 ms rest; live resize at most once per frame, with the ghost
// fallback when the frame that carried a re-layout took over 50 ms; one magnet at 50/50 +-8 px;
// double-click 50/50; Esc cancels; a bar revealed in hiding mode stays shown during a drag;
// Left/Right 16 px, Shift 64 px, Home/End to the minimums, Enter 50/50; a Tab stop whose grip and
// ring show for keyboard focus only: a press hands focus back to the page), the rims (1 px inside
// each pane; the focused one in the accent, a 2 px pulse after a keyboard move) and the crash card
// ("This page stopped" over an unfocused pane whose process died). Keyboard focus in the layer goes
// to the page when the layer hides. The polite live region for the announcements is in #vitre-root
// (it must speak when no split shows).
//
// Motion (spec "Motion"; splitmotion.ts; the bar's part is in bar.ts): a pair forming slides the
// joining pane 24 px in from its outer edge (280 ms) as it fades in (200 ms), under a frosted cover
// until its page has painted (at most 600 ms, then a 200 ms fade), and both rims fade in at 240 ms (a
// side replaced: its own); a side that goes (Separate tabs, a side closed by Deer's own gestures) is
// pictured first (a snapshot, at most 150 ms), then its picture slides 24 px outward and fades
// (200 ms) and the rims fade out (200 ms) while the page that stays keeps its pane (holdPane: its page
// does not lay out), which fills the window in one step 250 ms later ("then the other page widens";
// SplitMotion); Swap sides fades both pages in (150 ms); a window narrowed under 648 px fades the
// pane it hides (150 ms) before vitre-collapsed hides it, and a collapsed split coming back enters as
// a pair forming. Reduced motion: 150 ms cross-fades (a leaving picture fades over the page that
// widened at once).
//
// Fixes for "only the active tab is on screen" (spec "Build notes"): setSuccessor both ways (closing
// a side gives focus to its partner), framefocusrequested from the unfocused pane is dropped unless
// that pane had input in the last second, a mouse side button (AppCommand Back / Forward) over the
// unfocused pane focuses it first, the shown unfocused side is never discarded (low memory,
// tabs.discard: fx.guardDiscard), the link status bubble shows in the pane under the pointer (Firefox
// keeps it in the selected one); the rest is in browser.ts (moveTab, cycleMru, openLink
// targetBrowser, the F6 ring, shown()).
//
// Tab order (spec "Divider": one Tab stop between the tab bar and the focused page): Tab on the bar's
// last stop goes to the divider (barkeys.ts), Tab on the divider into the focused page, Shift+Tab on
// it back to the bar's last stop, and Shift+Tab out of the focused page's first element to the divider
// (only focus leaving the page that way: a Shift+Tab the page keeps for itself leaves nothing behind).
import type { Browser } from './browser';
import { el } from './dom';
import * as fx from './firefox';
import type { Tab } from './model';
import { FADE_MS, fadeIn, paneEnter, paneLeave, reduced, within } from './splitmotion';

export type Side = 'left' | 'right';

/** One pair: Firefox's wrapper and its two tabs, left (column 0) and right. */
export interface Pair {
  /** splitViewId: unique in the window, kept through session restore. */
  readonly id: number;
  readonly wrapper: XULSplitView;
  readonly left: Tab;
  readonly right: Tab;
}

/** A unit of the bar: one tab, or a pair drawn as one pill (active) or one capsule. */
export type Unit = { kind: 'tab'; key: number; tab: Tab; tabs: [Tab] } | { kind: 'pair'; key: string; pair: Pair; tabs: [Tab, Tab] };

/**
 * A divider drag: the ratio it started from and is at, where the pointer grabbed the gutter, the
 * live re-layout asked for (`frame`), the frame that measures one (`probe`), and whether the divider
 * has moved at all.
 */
interface Drag {
  pair: Pair;
  start: number;
  grab: number;
  ratio: number;
  frame: number;
  probe: number;
  moved: boolean;
}

/** Spec "Panes": the gutter, and each pane's minimum (WCAG's reflow width). */
export const GUTTER = 8;
export const PANE_MIN = 320;
/** Below this window width every start is refused and an open split collapses (2 x 320 + 8). */
export const SPLIT_MIN_WIDTH = 2 * PANE_MIN + GUTTER;
/** A collapsed split comes back at this width (32 px of hysteresis). */
const RESTORE_WIDTH = 680;
/** Session value on the column-0 tab: the pair's ratio, 3 decimals (spec "Build notes"). */
export const RATIO_KEY = 'vitre-split-ratio';
const MAGNET = 8;
const KEY_STEP = 16;
const KEY_BIG = 64;
const HOVER_REST = 120;
/** A re-layout that takes longer than this during a drag switches it to ghost mode (spec "Divider"). */
const GHOST_MS = 50;
/** window.focus() from the unfocused pane counts only this soon after input in that pane. */
const INPUT_WINDOW = 1000;
/** A focus that comes this soon after a press on the divider is the press's, not the keyboard's. */
const PRESS_FOCUS = 500;
/** Ratios are stored within (0, 1); the 320 px minimums are applied at layout. */
const RATIO_MIN = 0.001;

// ---- Firefox internals (Firefox 157) ----

const gb = (): any => (window as any).gBrowser;

/** gBrowser.splitViews: the wrappers in bar order (Tabbrowser.sys.mjs get splitViews -> tabbrowser/tabs.js allSplitViews). */
function wrappers(): XULSplitView[] {
  try {
    return Array.from(gb().splitViews ?? []);
  } catch {
    return [];
  }
}

/**
 * gBrowser.addTabSplitView(tabs, { insertBefore }) (Tabbrowser.sys.mjs): creates the
 * <tab-split-view-wrapper> before `insertBefore` and moves the tabs into it in that order (column 0
 * first). It refuses pinned tabs (returns null when none could join).
 */
function addSplitView(tabs: XULTab[], insertBefore: XULTab | null): XULSplitView | null {
  return gb().addTabSplitView(tabs, { insertBefore }) ?? null;
}

/**
 * Take a pair apart now: wrapper.unsplitTabs() moves both tabs out to where the wrapper was
 * (tabsplitview.mjs); the empty wrapper is removed at once instead of a microtask later by its
 * MutationObserver (removing it disconnects that observer, so it never runs twice).
 */
function unsplit(w: XULSplitView): void {
  w.unsplitTabs();
  if (w.isConnected && !w.tabs.length) w.remove();
}

/** gBrowser.tabpanels: #tabbrowser-tabpanels (tabbrowser/tabbox.js MozTabpanels). */
const tabpanels = (): HTMLElement => gb().tabpanels;

/** A tab's panel (the hbox.browserSidebarContainer named by tab.linkedPanel). */
const panelOf = (node: XULTab): HTMLElement | null => document.getElementById(node.linkedPanel);

/** gBrowser.setSuccessor(tab, successor) (Tabbrowser.sys.mjs): closing `tab` selects `successor` (_findTabToBlurTo). */
function setSuccessor(node: XULTab, successor: XULTab | null): void {
  try {
    gb().setSuccessor(node, successor);
  } catch {
    /* a tab of another window, or closing */
  }
}

/**
 * How many history entries SessionStore still holds for a tab (SessionStore.getTabState). A background
 * tab whose process died is revived by Firefox itself (ContentCrashHandlers.sys.mjs
 * onBackgroundBrowserCrash -> SessionStore.reviveCrashedTab: restored on demand, when next selected),
 * but its history can be empty by then (the browser was made non-remote first).
 */
function savedEntries(node: XULTab): number {
  try {
    return JSON.parse((window as any).SessionStore.getTabState(node)).entries?.length ?? 0;
  } catch {
    return 0;
  }
}

/** A content principal for an address (the page loading itself again: never more than it could). */
function pagePrincipal(url: string, userContextId: number): unknown {
  return Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(url), { userContextId });
}

/**
 * The page's compositor layers are there (MozBrowser hasLayers, browser-custom-element.js; what
 * AsyncTabSwitcher.sys.mjs waits for with MozLayerTreeReady before it shows a tab).
 */
function hasLayers(browser: XULBrowser): boolean {
  try {
    return !!(browser as unknown as { hasLayers?: boolean }).hasLayers;
  } catch {
    return true;
  }
}

/** The page asks before it closes (MozBrowser hasBeforeUnload): its prompt must not come after its pane has gone. */
function asksBeforeUnload(browser: XULBrowser): boolean {
  try {
    return !!(browser as unknown as { hasBeforeUnload?: boolean }).hasBeforeUnload;
  } catch {
    return true;
  }
}

/**
 * Firefox's link status bubble, #statuspanel (tabbrowser/status-panel.js StatusPanel.panel). Firefox
 * keeps it after the selected browser (Tabbrowser.sys.mjs appendStatusPanel(browser), called on every
 * tab switch); XULBrowserWindow.setOverLink (browser.js) dispatches "OverLink" on the window, with
 * detail.url, before it updates the bubble.
 */
function statusPanel(): HTMLElement | null {
  try {
    return ((window as any).StatusPanel?.panel as HTMLElement | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Put the status bubble after `browser` (gBrowser.appendStatusPanel; default: the selected browser). */
function putStatusPanel(browser?: XULBrowser): void {
  try {
    gb().appendStatusPanel(browser);
  } catch {
    /* not up yet */
  }
}

/** The events Firefox's split view sends (tabbrowser/tabsplitview.mjs, Tabbrowser.sys.mjs addTabSplitView); all bubble to the window. */
const SPLIT_EVENTS = ['SplitViewCreated', 'SplitViewRemoved', 'TabSplitViewActivate', 'TabSplitViewDeactivate', 'SplitViewTabChange'];

/** A pane's picture is taken in at most this long before it goes (else it goes without one). */
const PICTURE_MS = 150;
/**
 * The page that stays keeps its pane this long after the other side went, while that side's picture
 * slides out (200 ms), then widens in one step (spec "Close one side", "Separate"; SplitMotion widens
 * it 250 ms after the separate).
 */
const HOLD_MS = 250;
/** The frosted cover over a pane whose page has not painted stays at most this long (spec "Split forms"). */
const COVER_MS = 600;

export class SplitView {
  /** The window is under 648 px (and not back at 680 yet): only the focused side shows. */
  collapsed = false;
  /** The divider is being dragged (tests read it). */
  dragging = false;
  /** Ghost mode for the rest of this drag (spec "Divider": a pane took over 50 ms to lay out). */
  ghost = false;
  /** Tests may lower it (to 0) to force ghost mode. */
  ghostThreshold = GHOST_MS;
  /** How long the page that stays keeps its pane after a side went (holdPane); tests may raise it. */
  holdMs = HOLD_MS;

  private layer!: HTMLElement;
  private divider!: HTMLElement;
  private rims!: { left: HTMLElement; right: HTMLElement };
  private live!: HTMLElement;
  private crash = new Map<number, HTMLElement>();
  /** The last address each tab showed (a crashed side's Reload loads it again). */
  private lastUrl = new Map<number, string>();
  private pairsNow: Pair[] = [];
  /** Tabs whose successor this file set (cleared when they leave their pair). */
  private successors = new Set<XULTab>();
  private queued = false;
  private hoverTimer = 0;
  /** The exact ratio last set per pair this session (the saved one has 3 decimals). */
  private exact = new WeakMap<XULSplitView, number>();
  private drag: Drag | null = null;
  private lastInput = new WeakMap<XULBrowser, number>();
  private observer: ResizeObserver | null = null;
  private lastActive: Pair | null = null;
  private lastFocused = 0;
  private overlay: HTMLElement | null = null;
  /** The left pane's right edge as last laid out (null: no split shows). */
  private edge: number | null = null;
  /** When a press on the divider began while it did not have focus (its focus then goes back to the page). */
  private pressAt = -Infinity;
  /** Tabs whose pane is being pictured before it goes (Separate, a closed side). */
  private outgoing = new Set<Tab>();
  /** Of those, the sides that close once pictured (closeSide). */
  private closingSides = new Set<Tab>();
  /** A Shift+Tab in the focused page: if focus leaves it for Deer's window, it lands on the divider. */
  private shiftTab: { at: number; tab: Tab } | null = null;
  /** A collapse under way: the pane it hides is fading (fadeCollapse). */
  private collapsing: { timer: number; anim: Animation | null } | null = null;
  /** A divider drag keeps a revealed bar shown (hiding mode): the release. */
  private barHold: (() => void) | null = null;
  /** The page that stays after a side went keeps its pane for HOLD_MS (holdPane). */
  private holding: { tab: Tab; timer: number } | null = null;

  constructor(private b: Browser) {}

  // ---- model ----

  /** Every pair whose two tabs are in b.tabs, in bar order. */
  pairs(): Pair[] {
    return this.pairsNow;
  }

  pairOf(t: Tab | undefined | null): Pair | null {
    if (!t) return null;
    return this.pairsNow.find((p) => p.left === t || p.right === t) ?? null;
  }

  partner(t: Tab | undefined | null): Tab | null {
    const p = this.pairOf(t);
    if (!p || !t) return null;
    return p.left === t ? p.right : p.left;
  }

  sideOf(t: Tab | undefined | null): Side | null {
    const p = this.pairOf(t);
    if (!p || !t) return null;
    return p.left === t ? 'left' : 'right';
  }

  /** The pair of the active tab (shown, unless the window is collapsed). */
  active(): Pair | null {
    return this.pairOf(this.b.active());
  }

  /** Both panes are on screen (an active pair in a window wide enough). */
  showing(): Pair | null {
    return this.collapsed ? null : this.active();
  }

  /** One page of the showing pair is light and the other is not: glass over both takes the mixed tint. */
  mixed(): boolean {
    const p = this.showing();
    const a = this.b.active();
    if (!p || !a) return false;
    const o = p.left === a ? p.right : p.left;
    return (a.theme === 'light') !== (o.theme === 'light');
  }

  /** The bar's units (b.units()). */
  units(): Unit[] {
    const out: Unit[] = [];
    for (const t of this.b.tabs) {
      const p = this.pairOf(t);
      if (!p) out.push({ kind: 'tab', key: t.id, tab: t, tabs: [t] });
      else if (p.left === t) out.push({ kind: 'pair', key: `pair-${p.id}`, pair: p, tabs: [p.left, p.right] });
    }
    return out;
  }

  /** Read the pairs from Firefox's wrappers. */
  private read(): Pair[] {
    const byNode = new Map(this.b.tabs.map((t) => [t.node, t] as const));
    const out: Pair[] = [];
    for (const w of wrappers()) {
      if (!w.isConnected) continue;
      const tabs = w.tabs ?? [];
      if (tabs.length !== 2) continue;
      const left = byNode.get(tabs[0]);
      const right = byNode.get(tabs[1]);
      if (!left || !right) continue;
      out.push({ id: Number(w.splitViewId) || 0, wrapper: w, left, right });
    }
    return out;
  }

  // ---- ratio ----

  /** The pair's ratio (default 0.5). */
  ratio(p: Pair | null = this.active()): number {
    if (!p) return 0.5;
    const r = parseFloat(fx.getTabValue(p.left.node, RATIO_KEY));
    return Number.isFinite(r) && r > 0 && r < 1 ? r : 0.5;
  }

  /**
   * The ratio the panes are laid out at: the exact value set in this session (a 16 px key step is
   * 16 px), else the saved one (3 decimals).
   */
  private layoutRatio(p: Pair): number {
    const saved = this.ratio(p);
    const exact = this.exact.get(p.wrapper);
    return exact !== undefined && Math.abs(exact - saved) < 0.0006 ? exact : saved;
  }

  /**
   * Store the pair's ratio (3 decimals) and lay the panes out again if it is on screen. It is stored
   * as asked, only kept within (0, 1): the 320 px minimums are the layout's (the CSS clamp, leftWidth),
   * so a swap, a key or a press in a narrow or collapsed window never rewrites the ratio the pair has
   * at full width (spec "Panes": r is kept through window resizes, clamped to the minimums).
   */
  setRatio(p: Pair, r: number, opts: { save?: boolean } = {}): number {
    r = Number.isFinite(r) ? Math.min(1 - RATIO_MIN, Math.max(RATIO_MIN, r)) : 0.5;
    const exact = r;
    r = Math.round(r * 1000) / 1000;
    this.exact.set(p.wrapper, exact);
    if (opts.save !== false) {
      try {
        if (Math.abs(r - 0.5) < 0.0005) fx.setTabValue(p.left.node, RATIO_KEY, null);
        else fx.setTabValue(p.left.node, RATIO_KEY, r.toFixed(3));
      } catch {
        /* closing */
      }
    }
    if (this.active() === p) this.applyRatio(exact);
    this.b.emit('split-changed');
    return r;
  }

  /** Width the two panes share: the window minus the gutter. */
  private paneArea(): number {
    let W = 0;
    try {
      W = tabpanels().getBoundingClientRect().width;
    } catch {
      W = 0;
    }
    return Math.max(0, (W || window.innerWidth) - GUTTER);
  }

  private applyRatio(r: number): void {
    try {
      tabpanels().style.setProperty('--vitre-split', String(r));
    } catch {
      /* not up yet */
    }
    this.layout();
  }

  // ---- start and end ----

  /** Why a start would be refused right now (null: allowed). */
  refusal(): 'popup' | 'narrow' | null {
    if (this.b.isPopup) return 'popup';
    if (window.innerWidth < SPLIT_MIN_WIDTH) return 'narrow';
    return null;
  }

  /**
   * Pair the active tab with `other` (see the header), or open a Home side ('home'). Focus stays
   * where it was, except for the Home side, which is focused with its field open.
   */
  start(other: Tab | 'home', opts: { side?: Side } = {}): Pair | null {
    const b = this.b;
    const a = b.active();
    const current = this.pairOf(a);
    // A narrow window refuses new pairs; replacing a side of the active pair is no start (the
    // address field's "Show here" on a collapsed Home side: the chosen tab takes that side and shows).
    const why = this.refusal();
    if (!a || why === 'popup' || (why === 'narrow' && !(current && other !== 'home'))) {
      if (a && why === 'narrow') this.announce('Window too narrow for split view');
      return null;
    }
    if (other === 'home') {
      if (current || a.kind === 'home' || a.pinned) return null;
      const index = b.tabs.indexOf(a) + 1;
      const home = b.newTab(fx.newTabUrl(), { background: true, index });
      if (!home) return null;
      const p = this.create(a, home, a);
      if (!p) return null;
      this.enterPane(home, { pair: true });
      b.activate(home);
      this.announce('New tab opened on the right');
      // The empty side needs typing: its field opens, as on a new tab (browser.ts newTab).
      requestAnimationFrame(() => {
        if (b.active() === home && home.kind === 'home') b.editAddress();
      });
      return p;
    }
    if (other === a || other.pinned || a.pinned || !b.tabs.includes(other)) return null;
    if (current) return this.pairOf(other) ? null : this.replaceSide(current, other, opts.side);
    if (a.kind === 'home' && other.kind === 'home') return null;
    const otherPair = this.pairOf(other);
    if (otherPair) return null; // a side of a background pair joins through its capsule's menu, not here
    // The joining tab keeps its side of the bar (left of the pill is the left half), unless it was
    // dropped on a side.
    const left = opts.side ? (opts.side === 'left' ? other : a) : b.tabs.indexOf(other) < b.tabs.indexOf(a) ? other : a;
    const right = left === a ? other : a;
    const p = this.create(left, right, a);
    if (p) {
      this.enterPane(other, { pair: true });
      this.announce(`${titleOf(other)} opened on the ${left === other ? 'left' : 'right'}`);
    }
    return p;
  }

  /**
   * A circle dropped on `side` (splitlift.ts) may go there: not with a window too narrow, a popup,
   * pinned tabs, the active tab itself or a side of another pair, and Home never with Home (with a
   * pair active the side it would stay beside is the other one). Nor while the active pair is
   * collapsed (a window narrowed under 648 px and not back at 680 yet): only its focused side shows,
   * so there are no drop zones, as in a window too narrow for split view (spec "Too narrow",
   * "Collapsed window").
   */
  dropAllowed(t: Tab, side: Side): boolean {
    const a = this.b.active();
    if (this.refusal() || !a || t === a || t.pinned || a.pinned || this.pairOf(t) || !this.b.tabs.includes(t)) return false;
    const p = this.active();
    if (p && this.collapsed) return false;
    const stays = p ? (side === 'left' ? p.right : p.left) : a;
    return !(stays.kind === 'home' && t.kind === 'home');
  }

  /** A circle dropped on a side: split view with `t` on that side; with a pair active it replaces that side. */
  drop(t: Tab, side: Side): Pair | null {
    return this.dropAllowed(t, side) ? this.start(t, { side }) : null;
  }

  /** The tab `other` would replace in the active pair (its Home side, else its unfocused side). */
  replaced(p: Pair | null = this.active()): Tab | null {
    if (!p) return null;
    const a = this.b.active();
    if (p.left.kind === 'home' && p.right.kind !== 'home') return p.left;
    if (p.right.kind === 'home' && p.left.kind !== 'home') return p.right;
    return p.left === a ? p.right : p.left;
  }

  /** Put `incoming` in place of one side of `p` (`side`, else replaced()); a web tab it replaces goes back to the bar, a Home side closes. */
  private replaceSide(p: Pair, incoming: Tab, side?: Side): Pair | null {
    const out = side ? p[side] : this.replaced(p);
    if (!out || incoming === out) return null;
    const kept = out === p.left ? p.right : p.left;
    if (kept.kind === 'home' && incoming.kind === 'home') return null;
    return this.swapIn(p, out, incoming);
  }

  /**
   * Replace side `out` of `p` with `incoming`. Firefox's wrapper.replaceTab closes the tab it
   * replaces, so the pair is taken apart and made again, in the same task (the ratio carries over):
   * unsplitTabs puts the two tabs where the wrapper was; the empty wrapper is removed at once (its
   * own MutationObserver would remove it a microtask later and deactivate its panels after the new
   * pair showed them: tabsplitview.mjs #observeTabChanges, disconnectedCallback); then the new pair
   * is made before the kept tab, so `out` stays on its side of the bar.
   */
  private swapIn(p: Pair, out: Tab, incoming: Tab): Pair | null {
    const b = this.b;
    const ratio = this.layoutRatio(p);
    const kept = out === p.left ? p.right : p.left;
    const keptLeft = kept === p.left;
    const focusedOut = b.active() === out;
    unsplit(p.wrapper);
    const made = keptLeft ? this.create(kept, incoming, kept, ratio) : this.create(incoming, kept, kept, ratio);
    if (focusedOut) b.activate(incoming);
    if (out.kind === 'home' && b.tabs.includes(out)) b.closeTab(out);
    if (made) {
      this.enterPane(incoming);
      this.announce(`${titleOf(incoming)} opened on the ${keptLeft ? 'right' : 'left'}`);
    }
    return made;
  }

  /**
   * Make a pair: `left` in column 0, in the bar where `stay` (the active tab) is. A new pair starts at
   * 50/50 (or at `ratio`, carried over by swapIn): a ratio value either tab still carries (one brought
   * back by an older session) is not this pair's.
   */
  private create(left: Tab, right: Tab, stay: Tab, ratio?: number): Pair | null {
    for (const t of [left, right]) {
      try {
        if (fx.getTabValue(t.node, RATIO_KEY)) fx.setTabValue(t.node, RATIO_KEY, null);
      } catch {
        /* closing */
      }
    }
    let w: XULSplitView | null = null;
    try {
      w = addSplitView([left.node, right.node], stay.node);
    } catch (e) {
      console.error('Deer: split view could not be made', e);
      return null;
    }
    if (!w) return null;
    this.sync();
    const p = this.pairsNow.find((x) => x.wrapper === w) ?? null;
    if (p && ratio !== undefined && Math.abs(ratio - 0.5) > 0.0005) this.setRatio(p, ratio);
    return p;
  }

  /**
   * Both tabs stay; the focused side stays active, the other becomes a circle on its own side. With
   * `animate` (Deer's own gestures) the other pane is pictured first and its picture slides out
   * (spec "Separate": then the page widens).
   */
  separate(p: Pair | null = this.active(), opts: { animate?: boolean } = {}): void {
    if (!p) return;
    if (opts.animate && this.showing() === p) {
      const out = this.b.active() === p.left ? p.right : p.left;
      void this.leaving(out, () => {
        if (this.pairsNow.includes(p)) this.separate(p);
      });
      return;
    }
    unsplit(p.wrapper);
    this.sync();
    this.announce('Split view closed');
  }

  /**
   * A side closed by Deer's own gestures (Ctrl+W, the half's x or middle-click, its menu's Close tab):
   * its pane is pictured first, then the tab closes and its picture slides 24 px outward and fades
   * (spec "Close one side"). A page that asks before it closes closes at once (its prompt shows in
   * place). False when `t` is no side of the pair on screen (the caller closes it as usual).
   */
  closeSide(t: Tab): boolean {
    // A second close of a side already on its way out (Ctrl+W twice within its picture's 150 ms) is
    // meant for the tab that takes focus once it has gone: its partner.
    if (this.closingSides.has(t) && this.pairOf(t)) {
      const other = this.partner(t);
      if (other) this.b.closeTab(other);
      return true;
    }
    const p = this.showing();
    if (!p || (p.left !== t && p.right !== t) || asksBeforeUnload(t.browser) || this.outgoing.has(t)) return false;
    this.closingSides.add(t);
    void this.leaving(t, () => {
      this.closingSides.delete(t);
      if (this.b.tabs.includes(t)) this.b.closeTab(t);
    });
    return true;
  }

  /**
   * Picture the pane `t` shows (at most PICTURE_MS), run `then` (the model changes: the bar's morph
   * starts), then let the picture leave (splitmotion.paneLeave: 24 px outward, fading, 200 ms) while
   * the page that stays keeps its pane, which widens in one step once the picture has gone (spec "Close
   * one side", "Separate": "then the other page widens"; SplitMotion: 250 ms after). The rims fade
   * out over 200 ms (SplitMotion "pane leave"). With reduced motion the picture fades out (150 ms)
   * over the page that widened at once: a cross-fade.
   */
  private async leaving(t: Tab, then: () => void): Promise<void> {
    if (this.outgoing.has(t)) return;
    this.outgoing.add(t);
    const rect = this.paneOf(t);
    const side = this.sideOf(t);
    let picture: ImageBitmap | null = null;
    if (rect && side) picture = await within(this.b.snapshot(t.browser, null, Math.max(1, window.devicePixelRatio || 1)), PICTURE_MS);
    this.outgoing.delete(t);
    // What stays on screen, read before the model changes: the other pane and both rims.
    const stay = this.paneOf(t) ? this.partner(t) : null;
    const stayRect = stay ? this.paneOf(stay) : null;
    const rims = rect ? this.rimPictures() : [];
    then();
    // The pair has gone once Firefox's model says so (a closed side's wrapper goes in a microtask: sync).
    queueMicrotask(() => {
      const gone = !this.showing() || !this.b.tabs.includes(t) || !this.pairOf(t);
      if (!picture || !rect || !side || !gone) {
        picture?.close();
        return;
      }
      const layer = this.b.layer('split-motion', 6);
      if (stay && stayRect && !reduced() && this.b.active() === stay && !this.showing()) this.holdPane(stay, stayRect, side === 'left' ? 'right' : 'left');
      paneLeave(layer, picture, rect, side);
      for (const rim of rims) {
        layer.append(rim);
        void rim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? FADE_MS : 200, easing: 'ease', fill: 'forwards' }).finished.catch(() => undefined).then(() => rim.remove());
      }
    });
  }

  /** Pictures of the two rims where they are now (window coordinates), for their fade out once their layer has gone. */
  private rimPictures(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const rim of [this.rims.left, this.rims.right]) {
      const r = rim.getBoundingClientRect();
      if (!r.width) continue;
      const cs = getComputedStyle(rim);
      const node = el('div', { class: 'sv-rim-out', 'aria-hidden': 'true' });
      Object.assign(node.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`, border: `${cs.borderTopWidth} solid ${cs.borderTopColor}`, borderRadius: cs.borderRadius });
      out.push(node);
    }
    return out;
  }

  /**
   * The page that stays keeps its pane's place and width (its page does not lay out again) for
   * HOLD_MS, then fills the window in one step: attribute vitre-hold on the tab panels, the CSS below.
   * Ends early when anything else changes the content area (a split, another tab, a resize).
   */
  private holdPane(stay: Tab, r: DOMRect, side: Side): void {
    this.releaseHold();
    let panels: HTMLElement;
    try {
      panels = tabpanels();
    } catch {
      return;
    }
    const base = panels.getBoundingClientRect();
    panels.style.setProperty('--vitre-hold-x', `${Math.round(r.left - base.left)}px`);
    panels.style.setProperty('--vitre-hold-w', `${Math.round(r.width)}px`);
    panels.setAttribute('vitre-hold', side);
    this.holding = { tab: stay, timer: window.setTimeout(() => this.releaseHold(), this.holdMs) };
  }

  private releaseHold(): void {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    window.clearTimeout(h.timer);
    try {
      const panels = tabpanels();
      panels.removeAttribute('vitre-hold');
      panels.style.removeProperty('--vitre-hold-x');
      panels.style.removeProperty('--vitre-hold-w');
    } catch {
      /* closing */
    }
    // The strip of the page under the bar changed with its width.
    this.b.resample();
  }

  /** For tests: the page that stays is held at its pane (the tab), or null. */
  get held(): Tab | null {
    return this.holding?.tab ?? null;
  }

  /** The left pane's share of the panes' width as laid out now (the 320 px minimums applied): the switcher's pair card. */
  layoutShare(p: Pair): number {
    const W = this.paneArea();
    return W > 0 ? this.leftWidth(this.layoutRatio(p)) / W : 0.5;
  }

  /** The pages trade places; the divider stays where it is (the ratio moves to the new column-0 tab). */
  swap(p: Pair | null = this.active()): void {
    if (!p) return;
    const r = this.layoutRatio(p);
    try {
      fx.setTabValue(p.left.node, RATIO_KEY, null);
    } catch {
      /* closing */
    }
    p.wrapper.reverseTabs();
    this.sync();
    const now = this.pairsNow.find((x) => x.wrapper === p.wrapper);
    if (now && Math.abs(r - 0.5) > 0.0005) this.setRatio(now, r);
    // The pages swap in one re-layout and fade in over 150 ms (spec "Swap sides"; the bar crosses the halves over).
    if (now && this.showing() === now) {
      for (const t of [now.left, now.right]) {
        const panel = panelOf(t.node);
        if (panel) fadeIn(panel, FADE_MS);
      }
    }
    this.announce('Sides swapped');
  }

  /** Close both tabs: two entries on the closed-tab list (wrapper.close -> gBrowser.removeTabs). */
  closeBoth(p: Pair): void {
    p.wrapper.close();
  }

  // ---- install ----

  install(): void {
    const b = this.b;
    b.css('split', CSS);
    // Mounted in the tab panels the first time a split shows (layout() -> mountLayer): until then
    // the content area is exactly as before, and without a split it is not displayed.
    this.layer = el('div', { id: 'vitre-split' });
    this.live = el('div', { class: 'sp-live', role: 'status', 'aria-live': 'polite' });
    this.rims = { left: el('div', { class: 'sp-rim', 'aria-hidden': 'true' }), right: el('div', { class: 'sp-rim', 'aria-hidden': 'true' }) };
    this.divider = el(
      'div',
      { class: 'sp-divider', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Split divider' },
      el('div', { class: 'sp-ghost' }),
      el('div', { class: 'sp-grip' })
    );
    this.layer.append(this.rims.left, this.rims.right, this.divider);
    // The live region stays in Deer's layer: it must speak when no split shows ("Split view closed").
    b.root.append(this.live);
    this.wireDivider();

    for (const type of SPLIT_EVENTS) {
      const fn = (): void => this.queue();
      window.addEventListener(type, fn);
      b.onDestroy(() => window.removeEventListener(type, fn));
    }
    b.on('tab-created', () => this.queue());
    b.on('tab-closed', (t) => {
      // A side closed: "Field Notes closed. Tideline fills the window." (spec "Accessibility").
      const was = this.pairsNow.find((p) => p.left === t || p.right === t);
      const other = was ? (was.left === t ? was.right : was.left) : null;
      if (other) {
        const closed = titleOf(t);
        window.setTimeout(() => {
          if (this.b.tabs.includes(other) && this.b.active() === other && !this.pairOf(other)) this.announce(`${closed} closed. ${titleOf(other)} fills the window.`);
        }, 0);
      }
      this.dropCrash(t.id);
      this.lastUrl.delete(t.id);
      this.queue();
    });
    b.on('tab-activated', () => this.queue());
    b.on('tab-updated', () => {
      this.paintRims();
      this.label(this.pairsNow, this.pairsNow);
    });
    b.on('tab-crashed', (t) => {
      if (t) window.setTimeout(() => this.showCrash(t), 0);
    });
    b.on('tab-loading', (t, _browser, loading) => {
      if (t && loading) this.dropCrash(t.id);
    });
    b.on('tab-navigated', (t, _browser, info) => {
      if (t && !info.errorPage && /^(https?|file|ftp):/i.test(info.url)) this.lastUrl.set(t.id, info.url);
    });
    const resized = (): void => this.onResize();
    window.addEventListener('resize', resized);
    b.onDestroy(() => window.removeEventListener('resize', resized));

    // Focus requests from the unfocused pane (spec "Focus": pages can't steal it). Peek's pattern
    // (modules/peek/gecko.ts blockFocusRequests); Tabbrowser.sys.mjs on_framefocusrequested would
    // select that tab.
    const focusRequest = (e: Event): void => {
      const p = this.showing();
      const target = e.target as XULBrowser | null;
      if (!p || !target || (target as unknown as Element).localName !== 'browser') return;
      const unfocused = this.b.active() === p.left ? p.right : p.left;
      if (target !== unfocused.browser) return;
      const at = this.lastInput.get(target) ?? -Infinity;
      if (performance.now() - at > INPUT_WINDOW) e.stopPropagation();
    };
    window.addEventListener('framefocusrequested', focusRequest, true);
    b.onDestroy(() => window.removeEventListener('framefocusrequested', focusRequest, true));
    // A page dialog (alert, confirm, prompt) from the unfocused pane takes focus: it must be answered
    // (spec "Focus"). Firefox selects a background tab for its prompt only with the site's
    // focus-tab-by-prompt permission (Tabbrowser.sys.mjs DOMWillOpenModalDialog); the dialog shows in
    // its own pane either way.
    const dialog = (e: Event): void => {
      const p = this.showing();
      const target = ((e as Event & { originalTarget?: EventTarget }).originalTarget ?? e.target) as Element | null;
      if (!e.isTrusted || !p || target?.localName !== 'browser') return;
      const unfocused = this.b.active() === p.left ? p.right : p.left;
      if (target === (unfocused.browser as unknown as Element)) window.setTimeout(() => this.focusSide(unfocused), 0);
    };
    window.addEventListener('DOMWillOpenModalDialog', dialog, true);
    b.onDestroy(() => window.removeEventListener('DOMWillOpenModalDialog', dialog, true));
    const input = (e: Event): void => {
      const target = e.target as Element | null;
      if (target?.localName === 'browser') this.lastInput.set(target as unknown as XULBrowser, performance.now());
    };
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, input, true);
    // Shift+Tab out of the focused page's first element lands on the divider (spec "Divider": the
    // divider is one Tab stop between the tab bar and the focused page). Firefox moves focus to
    // the element before the page's browser in the window: that landing (the other pane's browser
    // too, which would select that side) goes to the divider instead. Only that landing: a Shift+Tab
    // the page keeps (between its own links) leaves no trace, so the key or press after it is not
    // redirected. It is the focus that leaves the page's browser itself (the focus event's
    // relatedTarget, which Gecko sets within the chrome document), soon after the Shift+Tab, with
    // no other key or press in between.
    const shiftTab = (e: KeyboardEvent): void => {
      const p = this.showing();
      const a = this.b.active();
      if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.altKey || !p || !a || (e.target as Element | null) !== (a.browser as unknown as Element)) {
        // Any other key (or the Shift+Tab of another element) ends the wait.
        if (e.key !== 'Shift') this.shiftTab = null;
        return;
      }
      this.shiftTab = { at: performance.now(), tab: a };
    };
    window.addEventListener('keydown', shiftTab, true);
    b.onDestroy(() => window.removeEventListener('keydown', shiftTab, true));
    const pressed = (): void => {
      this.shiftTab = null;
    };
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) window.addEventListener(type, pressed, true);
    b.onDestroy(() => {
      for (const type of ['mousedown', 'pointerdown', 'touchstart']) window.removeEventListener(type, pressed, true);
    });
    const landed = (e: FocusEvent): void => {
      const st = this.shiftTab;
      const target = e.target as Element | null;
      if (!st || performance.now() - st.at > 600 || !target || target === this.divider) return;
      if (target === (st.tab.browser as unknown as Element) || !this.showing()) return;
      // Focus moved from somewhere else than the page (a module's own field, a window raised): not the tab-out.
      if (e.relatedTarget !== (st.tab.browser as unknown as EventTarget)) return;
      this.shiftTab = null;
      window.setTimeout(() => {
        if (!this.showing() || !this.b.tabs.includes(st.tab)) return;
        if (this.b.active() !== st.tab) this.b.activate(st.tab);
        this.divider.focus({ focusVisible: true } as FocusOptions);
      }, 0);
    };
    window.addEventListener('focus', landed, true);
    b.onDestroy(() => window.removeEventListener('focus', landed, true));
    // A mouse side button (or a hardware Back / Forward key) over the unfocused pane acts on that pane:
    // focus it first (spec "Keys": "Mouse side buttons, hardware Back/Forward"). Every other hardware
    // key (Reload, Close, Search, Find...) acts on the focused side, as its keyboard chord does.
    // Registered before the key router's AppCommand listener (keys.ts), which then acts on it.
    window.addEventListener(
      'AppCommand',
      (e) => {
        const command = (e as Event & { command?: string }).command;
        if (command === 'Back' || command === 'Forward') this.focusPaneUnderPointer();
      },
      true
    );
    // The link status bubble sits 12 px in from the bottom-left of the pane under the pointer (spec
    // "Prompts and other per-pane surfaces"; shell.css places it in its pane). Firefox keeps it in the
    // focused pane, so a link hovered in the other one would show in the wrong corner: each link hover
    // moves it to the hovered pane, and it goes back to the selected page once its pane is not on
    // screen any more (the pair ended or went to the background, a collapse).
    const overLink = (e: Event): void => {
      const url = (e as CustomEvent<{ url?: string } | null>).detail?.url;
      if (!url || !this.showing()) return;
      const t = this.paneUnderPointer();
      const panel = statusPanel();
      if (t && panel && panel.previousElementSibling !== (t.browser as unknown as Element)) putStatusPanel(t.browser);
    };
    window.addEventListener('OverLink', overLink);
    b.onDestroy(() => window.removeEventListener('OverLink', overLink));
    b.on('split-changed', () => this.homeStatusPanel());
    // A closing column-0 side takes the pair's ratio with it before SessionStore records the closed
    // tab (SessionStore's TabClose listener is a capture listener on the tab strip, which comes after
    // this one on the window): Ctrl+Shift+T brings it back as an ordinary tab (spec "Keys"), and a pair
    // made from it later starts at 50/50. Also before a tab is adopted by another window.
    const closing = (e: Event): void => {
      const node = e.target as XULTab;
      if (!this.pairsNow.some((p) => p.left.node === node)) return;
      try {
        if (fx.getTabValue(node, RATIO_KEY)) fx.setTabValue(node, RATIO_KEY, null);
      } catch {
        /* already gone */
      }
    };
    window.addEventListener('TabClose', closing, true);
    b.onDestroy(() => window.removeEventListener('TabClose', closing, true));
    // Both pages are live and visible (spec "Panes"): the shown unfocused side is never discarded
    // (Firefox only spares the selected tab: low-memory unloading, an extension's tabs.discard).
    fx.guardDiscard((node) => {
      const p = this.showing();
      return !!p && (p.left.node === node || p.right.node === node);
    });

    // Esc cancels a divider drag: a new first rung (spec "Keys": right after the IME).
    b.addEscLayer(5, () => {
      if (!this.dragging) return false;
      this.endDrag(true);
      return true;
    });

    this.observer = new ResizeObserver(() => this.layout());
    b.onDestroy(() => this.observer?.disconnect());
    this.sync();
  }

  /** The key router is up: Esc during a drag is ours before anything else. */
  installKeys(): void {
    this.b.keys.addHook(
      (_binding, e) => {
        if (!this.dragging || e.key !== 'Escape') return undefined;
        this.endDrag(true);
        return 'swallow';
      },
      { first: true }
    );
  }

  /**
   * The layer lives in the tab panels (see the CSS; Peek's dim does the same), appended last the
   * first time a split shows and never moved again: the deck keeps its selection as an index among
   * its children (tabbox.js MozTabpanels selectCurrentIndex on every child-list change), so taking it
   * out or moving it would shift the panels added after it. Without a split it is not displayed.
   */
  private mountLayer(on: boolean): void {
    if (!on || this.layer.parentNode) return;
    try {
      tabpanels().append(this.layer);
    } catch {
      /* not up yet */
    }
  }

  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.sync();
    });
  }

  /** Read Firefox's state and bring Deer's parts in line with it. */
  sync(): void {
    const before = this.pairsNow;
    const next = this.read();
    this.pairsNow = next;
    // Successors both ways (spec "Build notes"): closing one side selects its partner.
    const inPair = new Set<XULTab>();
    for (const p of next) {
      inPair.add(p.left.node);
      inPair.add(p.right.node);
      setSuccessor(p.left.node, p.right.node);
      setSuccessor(p.right.node, p.left.node);
      this.successors.add(p.left.node);
      this.successors.add(p.right.node);
    }
    for (const node of [...this.successors]) {
      if (inPair.has(node)) continue;
      this.successors.delete(node);
      if (node.isConnected && !node.closing) setSuccessor(node, null);
    }
    // A pair that ended takes its ratio with it: the tab starts at 50/50 if it is paired again.
    for (const p of before) {
      if (next.some((n) => n.wrapper === p.wrapper || n.left === p.left)) continue;
      this.exact.delete(p.wrapper);
      try {
        if (p.left.node.isConnected && !p.left.node.closing && fx.getTabValue(p.left.node, RATIO_KEY)) fx.setTabValue(p.left.node, RATIO_KEY, null);
      } catch {
        /* closing */
      }
    }
    const shown = this.active();
    // A page held at its pane after its partner went (holdPane) fills the window as soon as anything
    // else changes the content area: a split shows again, another tab is selected.
    if (this.holding && (shown || this.b.active() !== this.holding.tab)) this.releaseHold();
    if (shown) this.applyRatio(this.layoutRatio(shown));
    else {
      try {
        tabpanels().style.removeProperty('--vitre-split');
      } catch {
        /* not up yet */
      }
    }
    this.updateCollapse(false);
    this.label(before, next);
    this.observe();
    this.layout();
    const changed = before.length !== next.length || before.some((p, i) => p.wrapper !== next[i]?.wrapper || p.left !== next[i]?.left || p.right !== next[i]?.right);
    const focused = this.b.activeId;
    if (changed || shown !== this.lastActive || (shown && focused !== this.lastFocused)) {
      this.lastActive = shown;
      this.lastFocused = focused;
      this.b.emit('split-changed');
      this.b.render();
    }
  }

  /**
   * Panes are named "Left page: Field Notes" (spec "Accessibility"). A name needs a role that takes
   * one (the panel is a plain XUL box): each paired panel is a region while its pair exists.
   */
  private label(before: Pair[], next: Pair[]): void {
    const still = new Set(next.flatMap((p) => [p.left, p.right]));
    for (const p of before) {
      for (const t of [p.left, p.right]) {
        if (still.has(t)) continue;
        const panel = panelOf(t.node);
        panel?.removeAttribute('aria-label');
        if (panel?.getAttribute('role') === 'region') panel.removeAttribute('role');
      }
    }
    const name = (t: Tab, text: string): void => {
      const panel = panelOf(t.node);
      if (!panel) return;
      if (panel.getAttribute('role') !== 'region') panel.setAttribute('role', 'region');
      if (panel.getAttribute('aria-label') !== text) panel.setAttribute('aria-label', text);
    };
    for (const p of next) {
      name(p.left, `Left page: ${titleOf(p.left)}`);
      name(p.right, `Right page: ${titleOf(p.right)}`);
    }
  }

  private observe(): void {
    const o = this.observer;
    if (!o) return;
    o.disconnect();
    try {
      o.observe(tabpanels());
    } catch {
      /* not up yet */
    }
    const p = this.active();
    if (!p) return;
    for (const t of [p.left, p.right]) {
      const panel = panelOf(t.node);
      if (panel) o.observe(panel);
    }
  }

  // ---- narrow windows ----

  private onResize(): void {
    this.releaseHold();
    this.updateCollapse(true);
    this.layout();
  }

  /** Under 648 px only the focused side shows; it comes back at 680 px (spec "Edge cases"). */
  private updateCollapse(announce: boolean): void {
    const p = this.active();
    const W = window.innerWidth;
    let next = this.collapsed;
    if (!p) next = W < SPLIT_MIN_WIDTH;
    else if (!this.collapsed && W < SPLIT_MIN_WIDTH) next = true;
    else if (this.collapsed && W >= RESTORE_WIDTH) next = false;
    // A window narrowed under 648 px: the hidden pane fades over 150 ms before it goes (spec "Motion":
    // Collapse / restore); a restored session or a pair shown in a narrow window collapses at once.
    if (p && announce && next && !this.collapsed) this.fadeCollapse(p);
    if (!next || !p) this.endCollapseFade();
    // The attribute only while a pair is active: without one the panels carry nothing of Deer's.
    try {
      const panels = tabpanels();
      if (!this.collapsing && panels.hasAttribute('vitre-collapsed') !== (next && !!p)) panels.toggleAttribute('vitre-collapsed', next && !!p);
    } catch {
      /* not up yet */
    }
    if (next === this.collapsed) return;
    this.collapsed = next;
    if (p && announce && next) this.announce(`Window too narrow: showing ${titleOf(this.b.active())}`);
    // Coming back, the hidden pane enters as when a pair forms (spec "Collapse / restore").
    if (p && announce && !next) {
      const other = this.b.active() === p.left ? p.right : p.left;
      queueMicrotask(() => this.enterPane(other, { pair: true }));
    }
    if (p) {
      this.b.emit('split-changed');
      this.b.render();
    }
  }

  /**
   * The pane a collapse hides fades out over 150 ms (also with reduced motion: it is a cross-fade);
   * the vitre-collapsed attribute that hides it comes after. Its page's box fades, not the panel.
   */
  private fadeCollapse(p: Pair): void {
    this.endCollapseFade();
    const other = this.b.active() === p.left ? p.right : p.left;
    const box = panelOf(other.node)?.querySelector('.browserContainer') ?? null;
    const anim = box ? box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' }) : null;
    const timer = window.setTimeout(() => {
      this.endCollapseFade();
      this.updateCollapse(false);
    }, FADE_MS);
    this.collapsing = { timer, anim };
  }

  /** The collapse fade is over (or cancelled: the window is wide again, the pair went): the pane's opacity is its own again. */
  private endCollapseFade(): void {
    const c = this.collapsing;
    if (!c) return;
    this.collapsing = null;
    window.clearTimeout(c.timer);
    c.anim?.cancel();
  }

  // ---- drawing: rims, divider, crash cards ----

  /** The two panes' rectangles (window coordinates) while both show. */
  paneRects(): { left: DOMRect; right: DOMRect } | null {
    const p = this.showing();
    if (!p) return null;
    const l = panelOf(p.left.node)?.getBoundingClientRect();
    const r = panelOf(p.right.node)?.getBoundingClientRect();
    if (!l || !r || !l.width || !r.width) return null;
    return { left: l, right: r };
  }

  /** The rectangle of the pane that shows `t`, while both panes show. */
  paneOf(t: Tab): DOMRect | null {
    const rects = this.paneRects();
    const p = this.showing();
    if (!rects || !p) return null;
    return t === p.left ? rects.left : t === p.right ? rects.right : null;
  }

  /** Put the divider, rims and crash cards where the panes are. */
  layout(): void {
    if (!this.layer) return;
    const rects = this.paneRects();
    const on = !!rects;
    // Keyboard focus on the divider (a Tab stop) or a crash card's button must not be stranded on
    // the body when the layer goes (the pair ended, another tab, a collapse): it goes to the page.
    const stranded = !on && this.layer.contains(document.activeElement);
    const wasOn = this.layer.classList.contains('on');
    this.mountLayer(on);
    this.layer.classList.toggle('on', on);
    this.b.root.classList.toggle('split-on', on);
    if (!rects) {
      this.divider.setAttribute('inert', '');
      for (const card of this.crash.values()) card.hidden = true;
      if (stranded) this.b.focusPage();
      this.moved(null);
      return;
    }
    this.divider.removeAttribute('inert');
    const H = window.innerHeight;
    if (!this.ghost) this.placeDivider(rects.left.right);
    place(this.rims.left, rects.left);
    place(this.rims.right, rects.right);
    if (!wasOn) {
      // The rims take this pair's colours at once (they fade in: enterPane), not over 150 ms from the
      // last pair's: their colour transition is for focus moving within a pair.
      this.layer.classList.add('sp-instant');
      this.paintRims();
      void getComputedStyle(this.rims.left).borderTopColor;
      void getComputedStyle(this.rims.right).borderTopColor;
      this.layer.classList.remove('sp-instant');
    } else this.paintRims();
    const p = this.showing();
    for (const [id, card] of this.crash) {
      const t = this.b.tab(id);
      const r = t ? this.paneOf(t) : null;
      card.hidden = !r || t === this.b.active();
      if (r) {
        card.style.left = `${Math.round(r.left + r.width / 2)}px`;
        card.style.top = `${Math.round(r.top + r.height / 2)}px`;
      }
    }
    this.divider.style.setProperty('--sp-grip-top', `${Math.round(H / 2 - 20)}px`);
    if (p) this.aria(p, rects);
    this.moved(rects.left.right);
  }

  /**
   * The panes moved (a ratio, a live drag frame, a resize, a pair shown or gone): 'split-changed', so
   * the bar puts the mixed tint on the glass that is over the other page now and the window controls
   * take the theme of the page under them (spec "Where the bar sits": Theme). The pages under the bar
   * are sampled again, once a drag is over (endDrag): the strip of each page under it changed.
   */
  private moved(edge: number | null): void {
    if (edge === this.edge) return;
    this.edge = edge;
    this.b.emit('split-changed');
    if (edge !== null && !this.dragging) this.b.resample();
  }

  private placeDivider(x: number): void {
    this.divider.style.left = `${Math.round(x)}px`;
  }

  private aria(p: Pair, rects: { left: DOMRect; right: DOMRect }): void {
    const total = rects.left.width + rects.right.width;
    const pct = total ? Math.round((rects.left.width / total) * 100) : 50;
    const min = total ? Math.round((PANE_MIN / total) * 100) : 22;
    this.divider.setAttribute('aria-valuenow', String(pct));
    this.divider.setAttribute('aria-valuemin', String(min));
    this.divider.setAttribute('aria-valuemax', String(100 - min));
    this.divider.setAttribute('aria-valuetext', `Left page ${pct} percent`);
    this.divider.setAttribute('aria-controls', panelOf(p.left.node)?.id ?? '');
  }

  /** Rim colours from each page's theme (spec "Panes": rims). */
  paintRims(): void {
    const p = this.showing();
    if (!p || !this.rims) return;
    const active = this.b.active();
    for (const side of ['left', 'right'] as const) {
      const t = p[side];
      const rim = this.rims[side];
      rim.classList.toggle('focused', t === active);
      rim.classList.toggle('light', t.theme === 'light');
      rim.classList.toggle('home', t.kind === 'home');
      rim.classList.toggle('side-left', side === 'left');
      rim.classList.toggle('side-right', side === 'right');
    }
  }

  /** After a keyboard move the new side's rim pulses to 2 px (spec "Focus"). */
  pulse(t: Tab): void {
    const p = this.showing();
    if (!p || reduced()) return;
    const rim = t === p.left ? this.rims.left : t === p.right ? this.rims.right : null;
    if (!rim) return;
    rim.classList.remove('pulse');
    void rim.offsetWidth;
    rim.classList.add('pulse');
    window.setTimeout(() => rim.classList.remove('pulse'), 700);
  }

  /**
   * A pane comes in (a pair forming, a side replaced, a collapsed split coming back; spec "Split
   * forms"): it slides 24 px in from its outer edge and fades in, and a page that has not painted yet
   * keeps a frosted cover meanwhile. The rims fade in with the plate (240-390 ms): with `pair` (a pair
   * forming or coming back) both, the focused one too ("the focused plate and rim fade in"; SplitMotion
   * fades both from 240 ms); a side replaced fades in its own.
   */
  private enterPane(t: Tab, opts: { pair?: boolean } = {}): void {
    const p = this.showing();
    const side = this.sideOf(t);
    const panel = panelOf(t.node);
    if (!p || !side || !panel || (p.left !== t && p.right !== t)) return;
    // The page's box moves, not the panel: the panes' rectangles (rims, divider, the bar's mixed
    // tint) are the panels' and stay where the layout puts them.
    paneEnter(panel.querySelector('.browserContainer') ?? panel, side);
    for (const rim of opts.pair ? [this.rims.left, this.rims.right] : [this.rims[side]]) fadeIn(rim, 150, reduced() ? 0 : 240);
    this.coverUntilPainted(t, side);
  }

  /**
   * A frosted cover over a pane whose page has not painted (a tab that never loaded, one still on
   * its way, one whose layers are not there yet): it goes when the page has painted, at most 600 ms
   * later, fading over 200 ms (spec "Split forms").
   */
  private coverUntilPainted(t: Tab, side: Side): void {
    const browser = t.browser;
    if (!t.deferred && hasLayers(browser) && this.b.painted(browser)) return;
    const r = this.paneOf(t);
    if (!r) return;
    const cover = el('div', { class: `sp-frost side-${side}`, 'aria-hidden': 'true' });
    place(cover, r);
    this.layer.append(cover);
    const offs: (() => void)[] = [];
    const done = (): void => {
      if (cover.classList.contains('out')) return;
      cover.classList.add('out');
      for (const off of offs) off();
      void cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? FADE_MS : 200, easing: 'ease', fill: 'forwards' }).finished.catch(() => undefined).then(() => cover.remove());
    };
    const timer = window.setTimeout(done, COVER_MS);
    offs.push(() => window.clearTimeout(timer));
    offs.push(
      this.b.on('page-message', (_tab, name, _data, from) => {
        if (from.browser === browser && from.isTop && (name === 'core:paint' || name === 'core:pageshow') && hasLayers(browser)) done();
      })
    );
    const layers = (e: Event): void => {
      if (e.target === browser && !t.deferred && this.b.painted(browser)) done();
    };
    window.addEventListener('MozLayerTreeReady', layers);
    offs.push(() => window.removeEventListener('MozLayerTreeReady', layers));
  }

  /**
   * The content process of a side died (spec "Edge cases": a crashed unfocused pane). Firefox shows
   * its crash page only for the selected tab; any other browser is left on a non-remote about:blank
   * (Tabbrowser.sys.mjs onTabCrashed), so the pane gets Deer's card until it loads again or is focused.
   */
  private showCrash(t: Tab): void {
    const p = this.pairOf(t);
    if (!p || t === this.b.active()) return;
    let card = this.crash.get(t.id);
    if (!card) {
      const reload = el('button', { type: 'button', class: 'sp-crash-reload' }, 'Reload');
      reload.addEventListener('click', () => {
        this.dropCrash(t.id);
        const url = this.lastUrl.get(t.id);
        if (savedEntries(t.node)) {
          // Revived on demand: showing it as the focused side restores its history (SessionStore #onTabSelect).
          this.b.activate(t);
        } else if (url) {
          // Its history is gone: load its last address again, as the page itself would, and keep focus.
          try {
            this.b.openLink(url, 'current', { targetBrowser: t.browser, triggeringPrincipal: pagePrincipal(url, t.node.userContextId) });
          } catch (e) {
            console.error('Deer: a crashed side could not be loaded again', e);
          }
        } else this.b.activate(t);
      });
      card = el('div', { class: 'sp-crash', role: 'alert' }, el('div', { class: 'sp-crash-text' }, 'This page stopped'), reload);
      this.crash.set(t.id, card);
      this.layer.append(card);
    }
    this.layout();
  }

  private dropCrash(id: number): void {
    const card = this.crash.get(id);
    if (!card) return;
    card.remove();
    this.crash.delete(id);
  }

  /** For tests: the crash card shown over a side, if any. */
  crashCard(t: Tab): HTMLElement | null {
    const card = this.crash.get(t.id);
    return card && !card.hidden ? card : null;
  }

  /** The divider element (tests, the bar keys). */
  get dividerElement(): HTMLElement {
    return this.divider;
  }

  // ---- the divider ----

  private wireDivider(): void {
    const d = this.divider;
    d.addEventListener('pointerenter', () => {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => d.classList.add('hover'), HOVER_REST);
    });
    d.addEventListener('pointermove', () => {
      if (d.classList.contains('hover') || this.dragging) return;
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => d.classList.add('hover'), HOVER_REST);
    });
    d.addEventListener('pointerleave', () => {
      window.clearTimeout(this.hoverTimer);
      if (!this.dragging) d.classList.remove('hover');
    });
    d.addEventListener('pointerdown', (e) => {
      // A press (any button, a double-click's too) is not keyboard focus: the focus it gives the
      // divider goes back to the page (see 'focus' below). A divider that had keyboard focus keeps it.
      if (document.activeElement !== d) this.pressAt = performance.now();
      if (e.button !== 0) return;
      const p = this.showing();
      if (!p) return;
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      const rects = this.paneRects();
      const r = this.layoutRatio(p);
      this.drag = { pair: p, start: r, grab: e.clientX - (rects?.left.right ?? e.clientX), ratio: r, frame: 0, probe: 0, moved: false };
      this.dragging = true;
      this.ghost = false;
      d.classList.add('dragging');
      this.cover(true);
      // A bar revealed in hiding mode stays shown while the divider is dragged (spec "Auto-hide and
      // F11": drags hold the bar shown); a hidden one stays hidden, the whole gutter is free.
      this.barHold?.();
      this.barHold = this.b.bar.hiding && !this.b.bar.hidden ? this.b.bar.hold('split-divider') : null;
    });
    d.addEventListener('pointermove', (e) => {
      const g = this.drag;
      if (!g) return;
      const x = e.clientX - g.grab;
      const r = this.ratioAt(x);
      if (this.leftWidth(r) === this.leftWidth(g.ratio) && !g.moved) return; // a press that has not moved the divider yet
      g.ratio = r;
      g.moved = true;
      if (this.ghost) {
        this.placeDivider(this.leftWidth(g.ratio));
        return;
      }
      if (!g.frame) g.frame = requestAnimationFrame((now) => this.frame(now));
    });
    const end = (e: PointerEvent): void => {
      if (!this.drag) return;
      try {
        d.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      this.endDrag(false);
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('lostpointercapture', () => {
      if (this.drag) this.endDrag(false);
    });
    d.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const p = this.showing();
      if (p) this.setRatio(p, 0.5);
    });
    d.addEventListener('keydown', (e) => {
      // The divider is one Tab stop between the tab bar and the focused page (spec "Divider": Keyboard).
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.b.focusBarEnd();
        else this.b.focusPage();
        return;
      }
      this.onKey(e);
    });
    // The accent grip and its 2 px ring are keyboard focus only (spec "Divider": "Look at rest: the
    // gutter itself; no grip"; "Focus shows the accent grip and a 2 px focus ring"): class focused is
    // every focus but a press's (Tab, the bar's keys). The focus a press gave goes back to the page at
    // once: page keys act on the focused side (spec "Keys").
    d.addEventListener('focus', () => {
      if (performance.now() - this.pressAt < PRESS_FOCUS) {
        this.pressAt = -Infinity;
        d.classList.remove('focused');
        window.setTimeout(() => {
          if (document.activeElement === d) this.b.focusPage();
        }, 0);
        return;
      }
      d.classList.add('focused');
    });
    d.addEventListener('blur', () => d.classList.remove('focused'));
  }

  /**
   * One live re-layout per animation frame. Ghost mode (spec "Divider": a pane took more than 50 ms
   * to lay out) is decided by what the re-layout cost: its synchronous part here, and the frame that
   * carried it, from that frame's start to the next one, which is asked for at once, so the time the
   * pointer rested between two moves never counts. (The pages' own reflow runs in their content
   * processes and is not seen from here.)
   */
  private frame(now: number): void {
    const g = this.drag;
    if (!g) return;
    g.frame = 0;
    const t0 = performance.now();
    this.applyRatio(g.ratio);
    if (performance.now() - t0 > this.ghostThreshold) {
      this.toGhost(g);
      return;
    }
    if (g.probe) return;
    g.probe = requestAnimationFrame((next) => {
      g.probe = 0;
      if (this.drag === g && !this.ghost && next - now > this.ghostThreshold) this.toGhost(g);
    });
  }

  /** The rest of this drag moves only the gutter and grip, with the 2 px accent line; the pages resize on release. */
  private toGhost(g: Drag): void {
    this.ghost = true;
    this.divider.classList.add('ghost');
    this.placeDivider(this.leftWidth(g.ratio));
  }

  private endDrag(cancel: boolean): void {
    const g = this.drag;
    if (!g) return;
    if (g.frame) cancelAnimationFrame(g.frame);
    if (g.probe) cancelAnimationFrame(g.probe);
    this.drag = null;
    this.dragging = false;
    this.ghost = false;
    this.divider.classList.remove('dragging', 'ghost', 'hover');
    this.cover(false);
    this.barHold?.();
    this.barHold = null;
    if (cancel) {
      this.applyRatio(g.start);
    } else if (g.moved && this.pairsNow.includes(g.pair)) {
      // A press that never moved the divider keeps the stored ratio (in a narrow window it may be
      // laid out clamped: saving the clamped value would rewrite the pair's ratio).
      this.setRatio(g.pair, g.ratio);
    }
    // The strip of each page under the bar changed during the drag: sample both again.
    if (g.moved) this.b.resample();
  }

  /** A transparent cover over the pages while dragging: the cursor stays ew-resize everywhere. */
  private cover(on: boolean): void {
    if (on && !this.overlay) {
      this.overlay = el('div', { class: 'sp-cover' });
      this.layer.append(this.overlay);
    } else if (!on && this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /** Left pane width for ratio r at this window width. */
  private leftWidth(r: number): number {
    const W = this.paneArea();
    return Math.max(PANE_MIN, Math.min(W - PANE_MIN, Math.round(r * W)));
  }

  /** Ratio for a left pane ending at x: clamped to the minimums, one magnet at 50/50 (+-8 px). */
  private ratioAt(x: number): number {
    const W = this.paneArea();
    if (W <= 0) return 0.5;
    const left = Math.max(PANE_MIN, Math.min(W - PANE_MIN, x));
    if (Math.abs(left - W / 2) <= MAGNET) return 0.5;
    return left / W;
  }

  private onKey(e: KeyboardEvent): void {
    const p = this.showing();
    if (!p || e.ctrlKey || e.altKey || e.metaKey) return;
    const W = this.paneArea();
    const now = this.leftWidth(this.layoutRatio(p));
    let x: number | null = null;
    if (e.key === 'ArrowLeft') x = now - (e.shiftKey ? KEY_BIG : KEY_STEP);
    else if (e.key === 'ArrowRight') x = now + (e.shiftKey ? KEY_BIG : KEY_STEP);
    else if (e.key === 'Home') x = PANE_MIN;
    else if (e.key === 'End') x = W - PANE_MIN;
    else if (e.key === 'Enter') x = W / 2;
    if (x === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      this.setRatio(p, 0.5);
      return;
    }
    // A step that moves nothing on screen (at a minimum, or in a window whose minimums hold the
    // divider) keeps the stored ratio: the pair's ratio at full width is not the clamped one.
    const left = Math.max(PANE_MIN, Math.min(W - PANE_MIN, x));
    if (left !== now) this.setRatio(p, left / W);
  }

  // ---- focus helpers ----

  /**
   * The pane the pointer is over, while both panes show: the panel in the hover chain right now. Gecko
   * keeps :hover live (a layout change re-hits the last point; leaving the window clears it), and the
   * bar, a dim, the address field's scrim or the divider above a pane are not in that panel's chain.
   */
  private paneUnderPointer(): Tab | null {
    const p = this.showing();
    if (!p) return null;
    for (const t of [p.left, p.right]) if (panelOf(t.node)?.matches(':hover')) return t;
    return null;
  }

  /** The status bubble went with a pane that is not on screen now: back after the selected page (Firefox's place). */
  private homeStatusPanel(): void {
    const prev = statusPanel()?.previousElementSibling;
    if (!prev || prev.localName !== 'browser') return;
    const t = this.b.tabFor(prev as unknown as XULBrowser);
    if (t && !this.b.shown(t)) putStatusPanel();
  }

  private focusPaneUnderPointer(): void {
    const t = this.paneUnderPointer();
    if (t && t !== this.b.active()) this.b.activate(t);
  }

  /** Move focus to one side and into its page (F6, a click on the unfocused half). */
  focusSide(t: Tab, opts: { keyboard?: boolean } = {}): void {
    if (this.b.active() !== t) this.b.activate(t);
    else this.b.focusPage();
    if (opts.keyboard) this.pulse(t);
  }

  // ---- announcements ----

  /** A polite announcement (spec "Accessibility"). */
  announce(text: string): void {
    if (!this.live) return;
    this.live.textContent = '';
    window.setTimeout(() => {
      this.live.textContent = text;
    }, 30);
  }

  /** The last announcement (tests). */
  get announced(): string {
    return this.live?.textContent ?? '';
  }
}

/** "Field Notes": a tab's title, its host, or Home. */
export function titleOf(t: Tab | undefined | null): string {
  if (!t) return '';
  if (t.kind === 'home') return 'Home';
  return t.title || t.url.replace(/^[a-z]+:\/\/(www\.)?/i, '').replace(/\/.*$/, '') || 'New tab';
}

function place(node: HTMLElement, r: DOMRect): void {
  node.style.left = `${Math.round(r.left)}px`;
  node.style.top = `${Math.round(r.top)}px`;
  node.style.width = `${Math.round(r.width)}px`;
  node.style.height = `${Math.round(r.height)}px`;
}

/**
 * The content area in split view (spec "Build notes" CSS on #tabbrowser-tabpanels[splitview],
 * "Panes", "Divider", "Accessibility"). Firefox's own rules: skin/classic/browser/tabbrowser/
 * content-area.css (.split-view-panel, .split-view-splitter, split-view-footer). Everything is off in
 * DOM full screen, where Firefox's inDOMFullscreen rules show the one pane.
 */
const CSS = `
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview] {
  background: #f3f3f3 !important;
}
@media (prefers-color-scheme: dark) {
  :root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview] { background: #202020 !important; }
}
@media (forced-colors: active) {
  :root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview] { background: Canvas !important; }
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview] > .split-view-panel.split-view-panel-active {
  margin: 0 !important;
  min-width: 0 !important;
  max-width: none !important;
  transition: none !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview]:not([vitre-collapsed]) > .split-view-panel.split-view-panel-active[column="0"] {
  flex: none !important;
  width: clamp(${PANE_MIN}px, round(calc(var(--vitre-split, 0.5) * (100% - ${GUTTER}px)), 1px), calc(100% - ${PANE_MIN + GUTTER}px)) !important;
  margin-inline-end: ${GUTTER}px !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview]:not([vitre-collapsed]) > .split-view-panel.split-view-panel-active[column="1"] {
  flex: 1 1 0 !important;
  width: auto !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview]:not([vitre-collapsed]) > .split-view-panel.split-view-panel-active > .browserContainer {
  overflow: clip !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview]:not([vitre-collapsed]) > .split-view-panel.split-view-panel-active[column="0"] > .browserContainer {
  border-radius: 0 8px 8px 0 !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview]:not([vitre-collapsed]) > .split-view-panel.split-view-panel-active[column="1"] > .browserContainer {
  border-radius: 8px 0 0 8px !important;
}
/* Collapsed (a window under 648 px): only the focused side, filling the window. */
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview][vitre-collapsed] > .split-view-panel.split-view-panel-active:not(.deck-selected) {
  display: none !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[splitview][vitre-collapsed] > .split-view-panel.split-view-panel-active.deck-selected {
  flex: 1 1 auto !important;
  width: auto !important;
}
/* A side just went by Deer's own gesture (leaving, holdPane): the page that stays keeps its pane's
 * place, width and inner corners while the other pane's picture slides out, on the gutter's colour,
 * then fills the window in one step (spec "Close one side", "Separate"). */
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold] { background: #f3f3f3 !important; }
@media (prefers-color-scheme: dark) {
  :root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold] { background: #202020 !important; }
}
@media (forced-colors: active) {
  :root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold] { background: Canvas !important; }
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold] > .deck-selected {
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  left: var(--vitre-hold-x, 0) !important;
  width: var(--vitre-hold-w, 100%) !important;
  min-width: 0 !important;
  max-width: none !important;
  margin: 0 !important;
  flex: none !important;
}
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold] > .deck-selected > .browserContainer { overflow: clip !important; }
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold="left"] > .deck-selected > .browserContainer { border-radius: 0 8px 8px 0 !important; }
:root[vitre]:not([inDOMFullscreen]) #tabbrowser-tabpanels[vitre-hold="right"] > .deck-selected > .browserContainer { border-radius: 8px 0 0 8px !important; }
/* Firefox's split-view chrome: the splitter, the per-pane footer and the selected panel's outline. */
:root[vitre] #tabbrowser-tabpanels > .split-view-splitter { display: none !important; }
:root[vitre] split-view-footer { display: none !important; }
:root[vitre] #tabbrowser-tabpanels[splitview] .split-view-panel > .browserContainer { outline: none !important; }

/* Deer's layer of the content area: inside the tab panels (like Peek's dim, z 3), above the pages
 * (column 0 sits at z 1), under the dim and the sheet; the bar (#vitre-root) is above all of it. */
#tabbrowser-tabpanels > #vitre-split {
  -moz-subtree-hidden-only-visually: 0;
  visibility: visible;
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  font: 13.5px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --expand: cubic-bezier(0.2, 0, 0, 1);
}
:root[inDOMFullscreen] #tabbrowser-tabpanels > #vitre-split { display: none; }
#tabbrowser-tabpanels > #vitre-split:not(.on) { display: none; }
#vitre-split > .sp-rim { pointer-events: none; }
#vitre-split > :is(.sp-divider, .sp-crash, .sp-cover) { pointer-events: auto; }
#vitre-split:not(.on) > :is(.sp-rim, .sp-divider) { display: none; }
#vitre-root > .sp-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); pointer-events: none; }

#vitre-split .sp-rim {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(255,255,255,0.10);
}
#vitre-split .sp-rim.light { border-color: rgba(0,0,0,0.10); }
#vitre-split .sp-rim.side-left { border-radius: 0 8px 8px 0; }
#vitre-split .sp-rim.side-right { border-radius: 8px 0 0 8px; }
#vitre-split .sp-rim.focused { border-color: #4cc2ff; color: #4cc2ff; }
#vitre-split .sp-rim.focused.light:not(.home) { border-color: #005fb8; color: #005fb8; }
#vitre-split .sp-rim { transition: border-color 150ms ease; }
#vitre-split.sp-instant .sp-rim { transition: none !important; }
#vitre-split .sp-rim.pulse { animation: sp-pulse 600ms var(--expand) 1; }
@keyframes sp-pulse {
  0%, 33% { box-shadow: inset 0 0 0 1px currentColor; }
  100% { box-shadow: inset 0 0 0 0 currentColor; }
}

#vitre-split .sp-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: ${GUTTER}px;
  pointer-events: auto;
  cursor: ew-resize;
  -moz-window-dragging: no-drag;
  outline: none;
  background: transparent;
  transition: background-color 120ms ease;
}
/* By touch the hit area is 24 px (spec "Divider"): 8 px more on each side, over the pages' edges. */
@media (any-pointer: coarse) {
  #vitre-split .sp-divider::before { content: ''; position: absolute; top: 0; bottom: 0; left: -8px; right: -8px; }
}
#vitre-split .sp-divider.hover, #vitre-split .sp-divider.dragging { background: rgba(0,0,0,0.04); }
@media (prefers-color-scheme: dark) {
  #vitre-split .sp-divider.hover, #vitre-split .sp-divider.dragging { background: rgba(255,255,255,0.04); }
}
#vitre-split .sp-grip {
  position: absolute;
  left: 2px;
  top: var(--sp-grip-top, 50%);
  width: 4px;
  height: 40px;
  border-radius: 2px;
  background: rgba(0,0,0,0.45);
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}
@media (prefers-color-scheme: dark) {
  #vitre-split .sp-grip { background: rgba(255,255,255,0.70); }
}
/* .focused: keyboard focus only (a press's focus never shows the ring; it goes back to the page). */
#vitre-split .sp-divider:is(.hover, .dragging, .focused) .sp-grip { opacity: 1; }
#vitre-split .sp-divider:is(.dragging, .focused) .sp-grip { background: #005fb8; }
@media (prefers-color-scheme: dark) {
  #vitre-split .sp-divider:is(.dragging, .focused) .sp-grip { background: #4cc2ff; }
}
#vitre-split .sp-divider.focused .sp-grip { outline: 2px solid #005fb8; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  #vitre-split .sp-divider.focused .sp-grip { outline-color: #4cc2ff; }
}
#vitre-split .sp-ghost {
  position: absolute;
  left: 3px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #005fb8;
  display: none;
}
@media (prefers-color-scheme: dark) {
  #vitre-split .sp-ghost { background: #4cc2ff; }
}
#vitre-split .sp-divider.ghost .sp-ghost { display: block; }
#vitre-split .sp-cover { position: absolute; inset: 0; pointer-events: auto; cursor: ew-resize; -moz-window-dragging: no-drag; }

#vitre-split .sp-crash {
  position: absolute;
  box-sizing: border-box;
  translate: -50% -50%;
  min-width: 220px;
  padding: 18px 20px 16px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: rgba(32,32,38,0.80);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 18px 44px rgba(0,0,0,0.32);
  color: #fff;
  font: inherit;
  pointer-events: auto;
  user-select: none;
}
#vitre-split .sp-crash[hidden] { display: none; }

/* A pane whose page has not painted yet keeps a frosted cover (spec "Split forms"), in the
 * Appearance mode's colour, as the gutter. */
#vitre-split > .sp-frost { position: absolute; pointer-events: none; background: rgba(243,243,243,0.72); backdrop-filter: blur(24px) saturate(1.6); }
@media (prefers-color-scheme: dark) {
  #vitre-split > .sp-frost { background: rgba(32,32,32,0.72); }
}
#vitre-split > .sp-frost.side-left { border-radius: 0 8px 8px 0; }
#vitre-split > .sp-frost.side-right { border-radius: 8px 0 0 8px; }
/* The picture of a pane that went (splitmotion.paneLeave), in a layer under the bar, and the rims
 * fading out with it (leaving). */
#vitre-root > #layer-split-motion > .sv-leaving { position: absolute; pointer-events: none; }
#vitre-root > #layer-split-motion > .sv-rim-out { position: absolute; box-sizing: border-box; pointer-events: none; }
#vitre-split .sp-crash-reload {
  appearance: none;
  margin: 0;
  border: 0;
  height: 32px;
  min-width: 0;
  padding: 0 16px;
  border-radius: 6px;
  background: #4cc2ff;
  color: #000;
  font: inherit;
  font-weight: 500;
}
#vitre-split .sp-crash-reload:hover { background: #47b1e8; }
#vitre-split .sp-crash-reload:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

@media (forced-colors: active) {
  /* As specific as the light-page rules above, which would otherwise keep their colours (forced to CanvasText). */
  #vitre-split .sp-rim, #vitre-split .sp-rim.light { border-color: CanvasText; }
  #vitre-split .sp-rim.focused, #vitre-split .sp-rim.focused.light:not(.home) { border: 2px solid Highlight; }
  #vitre-split .sp-grip { background: ButtonText; }
  #vitre-split .sp-divider:is(.dragging, .focused) .sp-grip { background: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  #vitre-split .sp-rim.pulse { animation: none; }
}
`;
