// Built-in page module: the top inset. Pages start below Deer's glass bar.
//
// The bar floats over the top BAR_AREA (68) CSS px of the window (src/shared/geometry.ts). Without
// help the top of every page (a site's header, the first search result) sits under it until the user
// scrolls. This module gives the page a strip of exactly that height at its top, in the page's own
// colour, that is part of the page: everything in the document flow starts below it, and it scrolls
// away with the page like any content. After that the bar floats over the page as before.
//
// Setting: Settings.pageInset (pref vitre.pageInset, default true), read here from the pref and
// observed with a pref observer (see ./README): turning it off or on applies at once to every open
// page; a page in the back/forward cache re-reads it on pageshow.
//
// Which documents: the tab's top document only (never frames), when it is a web document: an
// http(s), file, data, blob, moz-extension or view-source URL, an HTML <html> root, and a principal
// that is not privileged. That leaves out about: pages (Home, error pages, Firefox's own pages),
// chrome: pages, the PDF viewer (principal resource://pdf.js; ./pdf.ts gives it its own offset),
// image and media documents (Firefox centres their content in the viewport) and frameset pages.
// text/plain and view-source documents are ordinary HTML documents and get the strip.
//
// How:
//   - Height: BAR_AREA chrome px, i.e. BAR_AREA / fullZoom page px, so the strip is exactly the bar
//     area at any page zoom (re-applied on resize, which a zoom change fires).
//   - A USER sheet (windowUtils.loadSheetUsingURIString, data: URL) gives the root element
//     `padding-top: <inset + the site's own root padding>px !important` and the custom property
//     `--vitre-inset: <inset>px` (screen media only, not while the root itself is full screen).
//     Nothing is inserted into the page's DOM, a page's CSP does not apply to user sheets, and user
//     !important outranks the page's own rules. Padding rather than margin or border: the root's box
//     stays at the top of the canvas and documentElement.clientTop stays 0, so scripts that measure
//     offsets (jQuery offset(), scroll spies) still get true document positions, and a border-box
//     root sized to 100% absorbs the strip instead of overflowing.
//   - The same sheet gives the root `scroll-padding-top: <inset>px` (normal priority, so a site's own
//     scroll padding wins): fragment jumps (#hash links), scrollIntoView() and find's jumps to a match
//     land below the bar instead of under it. No sheet (setting off, skipped page) = no padding.
//   - The site's own root padding (html { padding-top: 56px } that makes room for its fixed header)
//     is kept: the strip adds to it. Only when an author rule or the root's style attribute declares
//     a top padding (InspectorUtils.getMatchingCSSRules) is it measured, with the sheet out for a
//     moment (style only, nothing paints in between).
//   - Colour: the root (or body) background propagates to the canvas, which paints under the
//     padding: the strip is the page's own background, no sampling. Only when the root and the body
//     both have no background at all (the visible background is a wrapper element's; the canvas
//     would show the default white) the sheet adds an inset box-shadow of the strip's height on the
//     root, in the colour of the outermost wide box with an opaque background found just below the
//     strip that is not pinned to the viewport (an in-flow wrapper, or an absolute page background;
//     not a fixed or sticky header). It is re-read on every re-check, not on every paint.
//   - Background images: the canvas background is positioned from the top of the root's padding
//     box, i.e. under the strip, so a banner image drawn behind the site's header would stay put
//     while the header moves down. When the background that reaches the canvas has an image that
//     scrolls with the page and does not repeat downwards (a banner, a repeat-x strip), the sheet
//     sets `background-origin: content-box` on the element it comes from (root or body): the image
//     starts below the strip with the content, and the strip shows the background colour. Images
//     that repeat downwards (textures, full-page gradients) already fill the strip in phase and are
//     left as they are.
//   - The sheet goes in at DOMDocElementInserted, before the first layout, so an ordinary page never
//     jumps; the decision below is made from DOMContentLoaded on.
//
// Skip rule (app-like pages keep their bottom edge). H = the viewport height, S1 = the document's
// scroll height with the strip, S0 = max(H, S1 - inset) = without it:
//   keep  when S0 > H + 2   the page scrolls by itself and the strip adds to it. When the viewport
//                           is locked (computed overflow-y hidden or clip on the root, or on the body
//                           when the root's is visible) the page must overflow by more than the inset:
//                           a long page that locks scrolling for a dialog keeps the strip, an app
//                           that spills a few px does not.
//   keep  when S1 <= H + 2  page and strip fit together: short pages, and layouts that size a
//                           border-box root to 100% (they shrink by the strip).
//   skip  otherwise         the page is sized to the viewport (100vh / 100% layouts, Gmail- or
//                           Figma-like apps, min-height: 100vh pages): the strip would cut off its
//                           bottom edge or add a scrollbar that exists only for the strip.
// While the document is still loading a skip waits for the load event (a loading skeleton is often
// sized to the viewport and then becomes a long page). While the strip is off and the page does not
// scroll by itself, a re-check tries it (on, measure, off again in the same task; nothing paints in
// between). The decision is re-made on every re-check; after MAX_FLIPS changes it is frozen for the
// document, so a page that reacts to the strip cannot make it flicker. When the strip comes or goes
// while the page is scrolled, the scroll position moves with it, so the content under the user's
// eyes stays where it is.
//
// Headers: boxes pinned to the top of the viewport do not move with the flow and would stay under
// the bar. This is the obscured-inset model of translucent toolbars: in-flow content scrolls under
// the glass, boxes pinned to the top of the viewport sit below it.
//   - fixed: hit-testing (elementsFromPoint, into shadow trees too) a grid of 3 rows x COLUMNS points
//     in the strip band (probes: 2 rows x PROBE_COLUMNS) finds what paints there; the outermost position: fixed ancestor of each hit
//     in the flat tree (not inside a transformed, filtered or contained ancestor, which would make it
//     scroll with the page) whose box reaches into the band and is at most HEADER_MAX of the viewport
//     high, or taller but stretched between a top and a bottom so the push shortens it instead of
//     moving it and it starts below the window's top or still covers it after the push (a sidebar
//     below the site's header, as YouTube's guide; an overlay reaching above the window; a box that
//     fills the window from its top edge, or a tall box with a height of its own, is left), gets an
//     inline `margin-top: calc(<its margin> + var(--vitre-inset, 0px)) !important`. A margin composes
//     with the page's own top and transform, so headers that hide on scroll still move. The custom
//     property lives in the screen-only sheet: in print (and print preview) the push resolves to 0
//     and the header prints where the site put it; a zoom change re-sizes every push at once.
//   - fixed boxes that hide inside the band: a pushed header hidden with translateY(-100%) would sit
//     inside the band (behind the glass) instead of out of sight. While a pushed fixed box lies
//     entirely inside the band and nothing animates it, its push is parked (given back, so it hides
//     above the window as the site meant); it is pushed again as soon as it shows (its own box
//     reaches below the window top, or a transition / animation starts that moves it down).
//   - absolute boxes whose containing block is the initial containing block or the root (the body
//     too, when it is absolutely positioned), found the same way with their document position inside
//     the strip: the same margin push (they scroll with the page, so they then sit on the content
//     like before).
//   - sticky: a bounded scan (the first SCAN_LIMIT elements of the body's light tree, skipping
//     display: none subtrees) finds position: sticky boxes with a top of 0..inset, at most HEADER_MAX
//     of the viewport high, whose scroll container is the viewport; they get an inline
//     `top: calc(<top> + var(--vitre-inset, 0px)) !important` and stick below the bar instead of under
//     it. In the flow the strip pushes them like any content. The band probe also finds sticky boxes
//     stuck in the band (past the scan limit, in shadow trees) and pushes them the same way.
//   Only boxes the page shows are pushed (a fixed header that is hidden at the time stays as it is).
//   The probe first checks the boxes it pushed: one that is gone or no longer fixed / absolute /
//   sticky gets its own inline value back; one whose inline value the page replaced is pushed again,
//   up to MAX_ATTEMPTS pushes in all, then left to the page for good. A box that keeps switching
//   (pushed and given back MAX_CYCLES times within CYCLE_WINDOW ms) is left alone. At most MAX_PUSHED
//   boxes and MAX_OPS pushes of new or replaced boxes per document. A skip, or the setting turned
//   off, gives every pushed box its own inline value back.
//
// Re-checks (decision, colour, site padding, headers): DOMContentLoaded (unless style sheets are
// still loading); pageshow (load, and the back/forward cache restore) and SETTLE ms after it;
// resize and zoom (RESIZE_WAIT ms after the last resize); same-document navigations (pushState,
// fragments, history: a location listener on the docShell) NAV_SETTLE ms after the last of a burst,
// at most one per NAV_GAP ms while a page keeps calling replaceState; the setting.
// Probes (headers only, no decision): headers that appear later (added by script, made fixed once
// the page is scrolled, shown again) are found while the page scrolls (a band probe at most every
// PROBE_SCROLL ms, a check of the pushed and parked boxes once per frame) and when it repaints (a
// band probe at most every PROBE_PAINT ms); a transition or animation starting or ending on a pushed
// or parked box checks it in the next frame. A probe costs a few elementsFromPoint calls: tests
// measure it (inset:state probeMs).
//
// Theme sampling (src/window/browser.ts sample()): the window snapshots the band under the bar. At
// scroll 0 that is now the strip, i.e. the page's own background, which is what the glass is over.
//
// Per-browser off switch (a page that is not under the bar, such as a peek's sheet, which sits below
// the bar with its own header): the window lists the <browser>'s browserId in the shared-data entry
// INSET_OFF_KEY (src/shared/geometry.ts: an array of numbers in Services.ppmm.sharedData, read here
// from Services.cpmm.sharedData), flushes it, and sends inset:check to the open document. Every
// document of that browser reads the list when it starts (before the first layout) and on every
// re-check, in whatever process it lands after a process switch, so the browser's pages never get
// the strip; taking the id out and sending inset:check again gives it back (a peek opened as a tab).
// Read-modify-write the list: other windows keep their own ids in it. inset:state reports
// `browserOff`. Example: src/window/modules/peek/gecko.ts setPageInset().
//
// Hidden bar: while a window's bar is in hiding mode (the barAutoHide setting, F11 full screen) it
// keeps no band at the top, so the strip would be an empty band above the page. The window core
// (src/window/pagearea.ts) then lists every page of that window under INSET_BAR_HIDDEN_KEY
// (src/shared/geometry.ts) and sends inset:check, exactly as the off switch above; the strip goes
// (a scrolled page keeps its content in place) and comes back when the mode ends. A reveal of the
// hidden bar changes nothing (the bar slides in over the page; nothing reflows). inset:state
// reports `barHidden`. src/actors/page/pdf.ts follows the same list for the viewer's offset.
//
// Queries from the window (tests):
//   inset:state  { selector? } -> { eligible, reason, wanted, applied, px, pad, padding, colour,
//                                  origin, decision, S, H, scrollY, flips, frozen, checks, why, log
//                                  (the last checks as "why:decision"), pushed: [{ kind, prop, value,
//                                  computed, tag, id, cls, attempts }], parked, yielded, ops, scanMs,
//                                  checkMs, checkMsMax, checkMsTotal, times (the last checks as
//                                  "why:ms/decide ms"), probes, probeMs, probeMsMax,
//                                  url, rect: the selector's first match in viewport px, or null }
//   inset:check  { selector? } -> re-check now, then the same answer
//   inset:probe  { selector? } -> run a probe now, then the same answer
//
// Firefox internals (version 157): the chrome-only DOMDocElementInserted event (fired by the document
// when its root goes in; gre/actors/AboutTranslationsChild.sys.mjs listens for it the same way);
// nsIDOMWindowUtils.loadSheetUsingURIString / removeSheetUsingURIString with USER_SHEET;
// nsIWebProgress.addProgressListener(NOTIFY_LOCATION) on the docShell and
// nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT; BrowsingContext.fullZoom;
// InspectorUtils.getMatchingCSSRules and CSSStyleSheet.parsingMode (chrome-only; devtools'
// shared/inspector/css-logic.js uses both); MozAfterPaint (chrome-only, as ./core.ts).
import type { PageContext } from '../page-api';
import { BAR_AREA, INSET_BAR_HIDDEN_KEY, INSET_OFF_KEY } from '../../shared/geometry';
import { settingPref } from '../../shared/settings';

const PREF = settingPref('pageInset');
const SCHEMES = /^(?:https?|file|data|blob|moz-extension|view-source):/i;
const PRIVILEGED = /^(?:about|chrome|resource|moz-src):/i;
const XHTML = 'http://www.w3.org/1999/xhtml';
/** The custom property the pushes add (set in the screen-only sheet; 0 in print). */
const VAR = '--vitre-inset';
/** px of rounding a "does it scroll" comparison forgives. */
const SLACK = 2;
/** A pinned box taller than this share of the viewport is not a header. */
const HEADER_MAX = 0.5;
const COLUMNS = 9;
/** Probes (while scrolling or repainting) hit-test a lighter grid: 2 rows x PROBE_COLUMNS. */
const PROBE_COLUMNS = 5;
const SCAN_LIMIT = 3000;
const MAX_PUSHED = 16;
const MAX_ATTEMPTS = 3;
const MAX_OPS = 64;
const MAX_FLIPS = 8;
/** A box pushed and given back this many times within CYCLE_WINDOW ms is left alone. */
const MAX_CYCLES = 8;
const CYCLE_WINDOW = 2000;
const SETTLE = [700, 2500];
const NAV_SETTLE = [150, 1200];
/** Least time between two navigation re-checks while a page keeps calling replaceState. */
const NAV_GAP = 1000;
const RESIZE_WAIT = 250;
/** Least time between two band probes while the page scrolls / repaints. */
const PROBE_SCROLL = 150;
const PROBE_PAINT = 500;

type Kind = 'fixed' | 'absolute' | 'sticky';

interface Push {
  el: Element;
  kind: Kind;
  prop: 'margin-top' | 'top';
  /** The page's own value of prop (px) that the inset is added to. */
  base: number;
  /** The inline value and priority the element had before (given back on removal). */
  old: string;
  oldPriority: string;
  /** Our inline value as the element serializes it (to see whether the page replaced it). */
  value: string;
  attempts: number;
}

interface State {
  started?: boolean;
  /** Why the document never gets the strip ('' = it can). */
  reason?: string;
  /** URL of the user sheet in the document, '' when the strip is off. */
  sheet?: string;
  /** The strip (page px), the site's own root padding it adds to, the colour fallback, and whose
   * background starts below the strip ('' | 'root' | 'body'). */
  px?: number;
  pad?: number;
  colour?: string;
  origin?: string;
  decision?: string;
  decided?: boolean;
  S?: number;
  H?: number;
  flips?: number;
  frozen?: boolean;
  checks?: number;
  why?: string;
  /** The last few checks: "why:decision" (for tests and diagnosis). */
  log?: string[];
  pushes?: Push[];
  /** Pushed fixed boxes that hide inside the band: given back until they show again. */
  parked?: Push[];
  yielded?: WeakSet<Element>;
  yieldedCount?: number;
  /** Times each box was pushed again after being given back (park, position change). */
  cycles?: WeakMap<Element, number[]>;
  ops?: number;
  scanMs?: number;
  /** Cost of the last check, the most expensive one and all of them (ms, for tests); the last few as "why:ms". */
  checkMs?: number;
  times?: string[];
  /** Of the last check: the decision (its first layout read lays the page out when nothing has yet). */
  decideMs?: number;
  checkMsMax?: number;
  checkMsTotal?: number;
  probes?: number;
  probeMs?: number;
  probeMsMax?: number;
  /** Pending probe: its timer, when it is due, and when the last one ran. */
  probeTimer?: number;
  probeDue?: number;
  lastProbe?: number;
  /** A check of the pushed and parked boxes is booked for the next animation frame. */
  frame?: boolean;
  lastNav?: number;
  /** Pending re-checks by kind ('settle', 'navigation'); a new burst of a kind replaces the old one. */
  timers?: Map<string, number[]>;
  resizeTimer?: number;
  observer?: () => void;
  onResize?: () => void;
  progress?: object;
  webProgress?: any;
}

const st = (ctx: PageContext): State => ctx.state as State;
const now = (): number => ChromeUtils.now();

function wanted(): boolean {
  try {
    return !!Services.prefs.getBoolPref(PREF, true);
  } catch {
    return true;
  }
}

/** This document's <browser> is in a shared-data list of browserIds (Services.cpmm.sharedData). */
function listed(ctx: PageContext, key: string): boolean {
  try {
    const list = Services.cpmm.sharedData.get(key) as unknown;
    if (!Array.isArray(list) || !list.length) return false;
    const id = ctx.actor.browsingContext?.browserId;
    return id !== undefined && list.includes(Number(id));
  } catch {
    return false;
  }
}

/** The window switched the strip off for this document's <browser> (header: per-browser off switch). */
const browserOff = (ctx: PageContext): boolean => listed(ctx, INSET_OFF_KEY);

/** The window's bar is in hiding mode: it keeps no band at the top (header: hidden bar). */
const barHidden = (ctx: PageContext): boolean => listed(ctx, INSET_BAR_HIDDEN_KEY);

/** The bar area in this page's CSS px (page zoom makes a page px bigger than a window px). */
function insetPx(ctx: PageContext): number {
  let zoom = 1;
  try {
    zoom = Number(ctx.actor.browsingContext?.fullZoom) || 1;
  } catch {
    zoom = 1;
  }
  return Math.round((BAR_AREA / zoom) * 1000) / 1000;
}

/** '' when the document gets the strip, else why not. */
function eligibility(ctx: PageContext, doc: Document): string {
  if (!ctx.isTop) return 'frame';
  if (!SCHEMES.test(doc.documentURI)) return 'scheme';
  try {
    const principal = (doc as any).nodePrincipal;
    if (!principal || principal.isSystemPrincipal || PRIVILEGED.test(String(principal.spec ?? ''))) return 'privileged';
  } catch {
    return 'privileged';
  }
  if (/^(?:image|video|audio)\//i.test(doc.contentType)) return 'media';
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== XHTML || root.localName !== 'html') return 'not html';
  return '';
}

interface Sheet {
  px: number;
  pad: number;
  colour: string;
  origin: string;
}

function sheetURL({ px, pad, colour, origin }: Sheet): string {
  const total = Math.round((px + pad) * 1000) / 1000;
  const root = ':root:not(:fullscreen)';
  let css = `@media screen { ${root} { padding-top: ${total}px !important; ${VAR}: ${px}px !important; } }`;
  // Anchor jumps, scrollIntoView() and find's jumps land below the bar. Not !important: a site's own
  // scroll-padding-top (room for its fixed header) wins.
  css += `\n@media screen { ${root} { scroll-padding-top: ${px}px; } }`;
  if (colour) css += `\n@media screen { ${root} { box-shadow: inset 0 ${px}px 0 0 ${colour} !important; } }`;
  if (origin) css += `\n@media screen { ${origin === 'body' ? `${root} > body` : root} { background-origin: content-box !important; } }`;
  return 'data:text/css;charset=utf-8,' + encodeURIComponent(css);
}

function loadSheet(win: Window, url: string): boolean {
  try {
    const utils = (win as any).windowUtils;
    utils.loadSheetUsingURIString(url, utils.USER_SHEET);
    return true;
  } catch (e) {
    console.error('Deer inset: could not load the sheet', e);
    return false;
  }
}

function removeSheet(win: Window, url: string): void {
  try {
    const utils = (win as any).windowUtils;
    utils.removeSheetUsingURIString(url, utils.USER_SHEET);
  } catch {
    /* not loaded */
  }
}

const current = (s: State): Sheet => ({ px: s.px ?? 0, pad: s.pad ?? 0, colour: s.colour ?? '', origin: s.origin ?? '' });

/** Put the strip in, or change it (height, the site's padding, colour, background origin). */
function setSheet(ctx: PageContext, patch: Partial<Sheet>): void {
  const s = st(ctx);
  const win = ctx.window;
  if (!win) return;
  const next = { ...current(s), ...patch };
  const url = sheetURL(next);
  if (url === s.sheet) return;
  if (!loadSheet(win, url)) return;
  if (s.sheet) removeSheet(win, s.sheet);
  s.sheet = url;
  Object.assign(s, next);
}

/** Strip on or off; with `keep`, a scrolled page moves with it so its content stays in place. */
function setStrip(ctx: PageContext, on: boolean, keep: boolean): void {
  const s = st(ctx);
  const win = ctx.window;
  const doc = ctx.document;
  if (!win || !doc || !!s.sheet === on) return;
  const before = win.scrollY;
  let delta: number;
  if (on) {
    const px = insetPx(ctx);
    setSheet(ctx, { px, colour: '', origin: '' });
    delta = px + (s.pad ?? 0);
  } else {
    delta = -((s.px ?? 0) + (s.pad ?? 0));
    restoreAll(ctx);
    removeSheet(win, s.sheet ?? '');
    s.sheet = '';
    s.colour = '';
    s.origin = '';
  }
  if (!keep || before <= 0) return;
  try {
    // Reading layout flushes it; scroll anchoring may already have moved the page by the strip.
    doc.documentElement.getBoundingClientRect();
    const target = Math.max(0, before + delta);
    if (Math.abs(win.scrollY - target) > 1) win.scrollTo({ left: win.scrollX, top: target, behavior: 'instant' });
  } catch {
    /* the page went away */
  }
}

function metrics(doc: Document): { S: number; H: number } {
  const se = doc.scrollingElement ?? doc.documentElement;
  return { S: se.scrollHeight, H: se.clientHeight };
}

/** The viewport cannot be scrolled by the user (overflow hidden / clip, propagated as CSS does). */
function viewportLocked(win: Window, doc: Document): boolean {
  let oy = win.getComputedStyle(doc.documentElement)?.overflowY ?? 'visible';
  const body = doc.body;
  if (oy === 'visible' && body?.localName === 'body') oy = win.getComputedStyle(body)?.overflowY ?? 'visible';
  return oy === 'hidden' || oy === 'clip';
}

function verdict(S1: number, H: number, px: number, locked: boolean): string {
  const S0 = Math.max(H, S1 - px);
  if (S0 > H + (locked ? px : SLACK)) return 'scrolls';
  if (S1 <= H + SLACK) return 'fits';
  return locked ? 'skip:locked' : 'skip:fitted';
}

/** Should this document have the strip now? Leaves the sheet as it found it. */
function decide(ctx: PageContext, px: number): boolean {
  const s = st(ctx);
  const win = ctx.window!;
  const doc = ctx.document!;
  const locked = viewportLocked(win, doc);
  let { S, H } = metrics(doc);
  if (!s.sheet) {
    if (S > H + (locked ? px : SLACK)) {
      s.decision = 'scrolls';
      s.S = S;
      s.H = H;
      return true;
    }
    // Does the page still fit with the strip? Try it: on, measure, off (no paint in between).
    const url = sheetURL({ px, pad: s.pad ?? 0, colour: '', origin: '' });
    if (!loadSheet(win, url)) return false;
    ({ S, H } = metrics(doc));
    removeSheet(win, url);
  } else if (!locked) {
    // The trial above had no pushes. A pushed absolute box sized to the viewport (YouTube's whole app,
    // ytd-app) then makes the page overflow by the strip, and measured with it this check would take
    // the strip away, the next trial would bring it back, and so on until the flips freeze it either
    // way (owner's report, 2026-10-06). Measure as the trial did; the overflow can be scrolled to.
    S = withoutAbsolutePushes(ctx, () => metrics(doc).S);
  }
  s.decision = verdict(S, H, px, locked);
  s.S = S;
  s.H = H;
  return !s.decision.startsWith('skip');
}

/** `measure()` with the absolute boxes' pushes out for a moment (style only: nothing paints). */
function withoutAbsolutePushes<T>(ctx: PageContext, measure: () => T): T {
  const out = (st(ctx).pushes ?? []).filter((p) => p.kind === 'absolute' && (p.el as HTMLElement).style?.getPropertyValue(p.prop) === p.value);
  const set = (p: Push, value: string, priority: string): void => {
    const style = (p.el as HTMLElement).style;
    if (value) style.setProperty(p.prop, value, priority);
    else style.removeProperty(p.prop);
  };
  for (const p of out) set(p, p.old, p.oldPriority);
  try {
    return measure();
  } finally {
    for (const p of out) set(p, p.value, 'important');
  }
}

/** An author rule or the style attribute declares a top padding on the root. */
function declaresPadding(root: Element): boolean {
  if (/padding/i.test(root.getAttribute('style') ?? '')) return true;
  let rules: any[] = [];
  try {
    rules = InspectorUtils.getMatchingCSSRules(root) ?? [];
  } catch {
    return false;
  }
  for (const rule of rules) {
    try {
      if (rule?.parentStyleSheet?.parsingMode !== 'author') continue;
      const style = rule.style as CSSStyleDeclaration | undefined;
      if (style && (style.getPropertyValue('padding-top') || style.getPropertyValue('padding-block-start'))) return true;
    } catch {
      /* a rule without a style */
    }
  }
  return false;
}

/** The site's own root padding-top (px), which the strip adds to. */
function sitePadding(ctx: PageContext): number {
  const s = st(ctx);
  const win = ctx.window!;
  const root = ctx.document!.documentElement;
  if (!declaresPadding(root)) return 0;
  // Our sheet outranks the site's rules: read the site's value with it out for a moment.
  const url = s.sheet;
  if (url) removeSheet(win, url);
  try {
    return Math.max(0, parseFloat(win.getComputedStyle(root)?.paddingTop ?? '') || 0);
  } finally {
    if (url) loadSheet(win, url);
  }
}

function check(ctx: PageContext, why: string): void {
  const s = st(ctx);
  const win = ctx.window;
  const doc = ctx.document;
  if (!s.started || s.reason || !win || !doc?.documentElement) return;
  s.checks = (s.checks ?? 0) + 1;
  s.why = why;
  const t0 = now();
  try {
    checkNow(ctx, why);
  } catch (e) {
    console.error(`Deer inset: check (${why}) failed`, e);
  } finally {
    const ms = now() - t0;
    s.checkMs = Math.round(ms * 100) / 100;
    s.checkMsMax = Math.max(s.checkMsMax ?? 0, s.checkMs);
    s.checkMsTotal = Math.round(((s.checkMsTotal ?? 0) + ms) * 100) / 100;
    (s.times ??= []).push(`${why}:${s.checkMs}/decide ${s.decideMs ?? 0}`);
    if (s.times.length > 12) s.times.shift();
  }
}

function checkNow(ctx: PageContext, why: string): void {
  const s = st(ctx);
  const doc = ctx.document!;
  if (doc.body?.localName === 'frameset') {
    s.reason = 'frameset';
    setStrip(ctx, false, false);
    return;
  }
  if (!wanted() || browserOff(ctx) || barHidden(ctx)) {
    setStrip(ctx, false, true);
    s.decision = 'off';
    // Turned back on later, the page starts afresh (a setting change is not the page flickering).
    s.decided = false;
    s.frozen = false;
    s.flips = 0;
    return;
  }
  const px = insetPx(ctx);
  const pad = sitePadding(ctx);
  if (s.sheet && (s.px !== px || s.pad !== pad)) {
    // The page zoom or the site's own padding changed; a scrolled page keeps its content in place.
    const before = ctx.window!.scrollY;
    const delta = px + pad - (s.px ?? 0) - (s.pad ?? 0);
    setSheet(ctx, { px, pad });
    if (before > 0 && delta) ctx.window!.scrollTo({ left: ctx.window!.scrollX, top: Math.max(0, before + delta), behavior: 'instant' });
  }
  s.pad = pad;
  if (!s.frozen) {
    const had = !!s.sheet;
    const t0 = now();
    let keep = decide(ctx, px);
    s.decideMs = Math.round((now() - t0) * 100) / 100;
    // Until the load event the layout is not final (a loading skeleton sized to the viewport that
    // becomes a long page): only the load and later re-checks take the strip away.
    if (!keep && had && doc.readyState !== 'complete') {
      keep = true;
      s.decision += ':held';
    }
    if (keep !== had) {
      setStrip(ctx, keep, true);
      if (s.decided && (s.flips = (s.flips ?? 0) + 1) >= MAX_FLIPS) s.frozen = true;
    }
    s.decided = true;
  }
  (s.log ??= []).push(`${why}:${s.decision}${s.frozen ? ':frozen' : ''}`);
  if (s.log.length > 24) s.log.shift();
  if (s.sheet) {
    canvas(ctx);
    const t0 = now();
    headers(ctx, true);
    s.scanMs = Math.round((now() - t0) * 100) / 100;
  }
}

// ---- colour and background ----

/** Alpha of a computed colour ("rgb(...)", "rgba(...)", "color(srgb ... / a)", "transparent"). */
function alphaOf(c: string): number {
  if (!c || c === 'transparent') return 0;
  const rgb = /^rgba?\(([^)]*)\)$/.exec(c);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1) : 1;
  }
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
  if (slash) return parseFloat(slash[1]) / (slash[2] ? 100 : 1);
  return 1;
}

function noBackground(cs: CSSStyleDeclaration | null): boolean {
  return !cs || (alphaOf(cs.backgroundColor) === 0 && (!cs.backgroundImage || cs.backgroundImage === 'none'));
}

/** A background image that scrolls with the page and does not repeat downwards (a banner, a
 * repeat-x strip): it belongs to the content's top. One that repeats vertically (a texture, a
 * full-page gradient, which repeats by default) already fills the strip in phase with the page,
 * and moving its origin would bring its bottom end into the strip. */
function bannerImage(cs: CSSStyleDeclaration | null): boolean {
  if (!cs || !cs.backgroundImage || cs.backgroundImage === 'none') return false;
  // Layers are matched by index (shorter lists repeat); only layers with an image count (the
  // shorthand's colour-only last layer is a layer with no image).
  const images = layers(cs.backgroundImage);
  const repeats = layers(cs.backgroundRepeat);
  const attachments = layers(cs.backgroundAttachment);
  let any = false;
  for (let i = 0; i < images.length; i++) {
    if (images[i] === 'none') continue;
    if ((attachments[i % attachments.length] ?? 'scroll') === 'fixed') continue;
    const r = repeats[i % repeats.length] ?? 'repeat';
    const parts = r.split(/\s+/);
    const once = parts.length === 1 ? r === 'no-repeat' || r === 'repeat-x' : parts[1] === 'no-repeat';
    if (!once) return false;
    any = true;
  }
  return any;
}

/** A computed list value split at its top-level commas (a gradient has commas of its own). */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const v = String(value ?? '');
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(v.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(v.slice(start).trim());
  return out.filter(Boolean);
}

/** Inside (or itself) a box pinned to the viewport (a header): its colour is not the page's background. */
function pinned(win: Window, el: Element, stop: Element | null): boolean {
  for (let n: Element | null = el; n && n !== stop; n = n.parentElement) {
    const pos = win.getComputedStyle(n)?.position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/** The page's visible background just below the strip: the outermost wide opaque box that is not
 * pinned to the viewport (an in-flow wrapper, or an absolute page-sized background box). */
function sampleColour(win: Window, doc: Document, y0: number): string {
  const root = doc.documentElement;
  const body = doc.body;
  const W = root.clientWidth;
  const y = y0 + 2 - win.scrollY;
  if (y < 0 || y >= (doc.scrollingElement ?? root).clientHeight) return '';
  const list = doc.elementsFromPoint(W / 2, y);
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (el === root || el === body) continue;
    const cs = win.getComputedStyle(el);
    if (!cs || alphaOf(cs.backgroundColor) < 0.9) continue;
    if (el.getBoundingClientRect().width < W * 0.5 || pinned(win, el, body)) continue;
    const c = cs.backgroundColor;
    return /^[a-z0-9(),.%\s/+-]+$/i.test(c) ? c : '';
  }
  return '';
}

/** The strip's colour fallback and the background image origin (see the header). */
function canvas(ctx: PageContext): void {
  const s = st(ctx);
  const win = ctx.window!;
  const doc = ctx.document!;
  const px = s.px ?? 0;
  const rootCs = win.getComputedStyle(doc.documentElement);
  const body = doc.body?.localName === 'body' ? doc.body : null;
  const bodyCs = body ? win.getComputedStyle(body) : null;
  const rootBare = noBackground(rootCs);
  // The canvas takes the root's background, or the body's when the root has none.
  const source = rootBare ? bodyCs : rootCs;
  const origin = bannerImage(source) ? (rootBare ? 'body' : 'root') : '';
  let colour = s.colour ?? '';
  const bare = rootBare && noBackground(bodyCs);
  if (!bare) colour = '';
  else if (win.scrollY < px) colour = sampleColour(win, doc, px + (s.pad ?? 0)); // else the strip is scrolled away: keep it
  if (colour !== (s.colour ?? '') || origin !== (s.origin ?? '')) setSheet(ctx, { colour, origin });
}

// ---- headers ----

/** A box that makes fixed (and absolute) descendants scroll with it instead of the viewport. */
function containsFixed(cs: CSSStyleDeclaration): boolean {
  const v = (p: string) => cs.getPropertyValue(p);
  return (
    v('transform') !== 'none' ||
    v('translate') !== 'none' ||
    v('rotate') !== 'none' ||
    v('scale') !== 'none' ||
    v('perspective') !== 'none' ||
    v('filter') !== 'none' ||
    v('backdrop-filter') !== 'none' ||
    /\b(?:paint|layout|strict|content)\b/.test(v('contain')) ||
    /\b(?:transform|translate|rotate|scale|perspective|filter)\b/.test(v('will-change')) ||
    (v('container-type') || 'normal') !== 'normal' ||
    (v('content-visibility') || 'visible') !== 'visible'
  );
}

/** The parent in the flat tree: a slotted element's slot, else its parent, else its shadow host. */
function parentOf(n: Element): Element | null {
  try {
    const slot = (n as any).openOrClosedAssignedSlot as Element | null;
    if (slot) return slot;
  } catch {
    /* not chrome-privileged here: fall through */
  }
  if (n.parentElement) return n.parentElement;
  const host = (n.parentNode as (Node & { host?: Element }) | null)?.host;
  return host ?? null;
}

/** Everything at a point, looking into (open or closed) shadow trees: a header can live in one. */
function hitsAt(doc: Document, x: number, y: number): Element[] {
  const out: Element[] = [];
  const visit = (scope: Document | ShadowRoot, depth: number) => {
    for (const el of scope.elementsFromPoint(x, y)) {
      out.push(el);
      const shadow = depth < 4 ? ((el as any).openOrClosedShadowRoot as ShadowRoot | null) : null;
      if (shadow) visit(shadow, depth + 1);
    }
  };
  visit(doc, 0);
  return out;
}

/** position and "contains fixed descendants" of an element, read once per probe. */
type Facts = { pos: string; holds: boolean } | null;
function factsOf(win: Window, cache: Map<Element, Facts>, n: Element): Facts {
  let f = cache.get(n);
  if (f === undefined) {
    const cs = win.getComputedStyle(n);
    f = cs ? { pos: cs.position, holds: containsFixed(cs) } : null;
    cache.set(n, f);
  }
  return f;
}

/** The box that pins a hit in the band to the top of the viewport (or of the document), if any. */
function anchored(win: Window, cache: Map<Element, Facts>, el: Element, body: Element | null, root: Element): { el: Element; kind: Kind } | null {
  let fixed: Element | null = null;
  let fixedHeld = false; // an ancestor above the outermost fixed box contains it
  let absolute: Element | null = null;
  let absoluteHeld = false; // an ancestor above the outermost absolute box is its containing block
  let sticky: Element | null = null;
  const chain: Element[] = [];
  for (let n: Element | null = el; n && n !== root && chain.length < 64; n = parentOf(n)) chain.push(n);
  for (const n of chain) {
    const f = factsOf(win, cache, n);
    if (!f) return null;
    if (n !== body && f.pos === 'fixed') {
      fixed = n;
      fixedHeld = false;
      absolute = null;
      sticky = null;
      continue;
    }
    // An absolutely positioned body is anchored to the top of the document like any box.
    if (f.pos === 'absolute' && !fixed) {
      absolute = n;
      absoluteHeld = false;
      continue;
    }
    if (n !== body && f.pos === 'sticky' && !fixed) {
      sticky = n;
      absolute = null;
      continue;
    }
    if (fixed && f.holds) fixedHeld = true;
    if (absolute && (f.holds || f.pos !== 'static')) absoluteHeld = true;
  }
  const rootFacts = factsOf(win, cache, root);
  if (rootFacts?.holds) fixedHeld = true;
  if (fixed) return fixedHeld ? null : { el: fixed, kind: 'fixed' };
  if (sticky) return { el: sticky, kind: 'sticky' };
  if (absolute && !absoluteHeld) return { el: absolute, kind: 'absolute' };
  return null;
}

const propOf = (kind: Kind): Push['prop'] => (kind === 'sticky' ? 'top' : 'margin-top');

function baseOf(cs: CSSStyleDeclaration, kind: Kind): number {
  return parseFloat(kind === 'sticky' ? cs.top : cs.marginTop) || 0;
}

/** Write the push. `fresh`: a new box, or one the page replaced (counts against MAX_OPS). */
function push(ctx: PageContext, p: Push, fresh: boolean): boolean {
  const s = st(ctx);
  if (fresh && (s.ops ?? 0) >= MAX_OPS) return false;
  const style = (p.el as HTMLElement).style;
  if (!style) return false;
  p.old = style.getPropertyValue(p.prop);
  p.oldPriority = style.getPropertyPriority(p.prop);
  style.setProperty(p.prop, `calc(${p.base}px + var(${VAR}, 0px))`, 'important');
  p.value = style.getPropertyValue(p.prop);
  if (fresh) s.ops = (s.ops ?? 0) + 1;
  return true;
}

/** Give a pushed box its own inline value back (unless the page has set one since). */
function restore(p: Push): void {
  try {
    const style = (p.el as HTMLElement).style;
    if (style.getPropertyValue(p.prop) !== p.value) return;
    if (p.old) style.setProperty(p.prop, p.old, p.oldPriority);
    else style.removeProperty(p.prop);
  } catch {
    /* the element went away */
  }
}

function restoreAll(ctx: PageContext): void {
  const s = st(ctx);
  for (const p of s.pushes ?? []) restore(p);
  s.pushes = [];
  s.parked = [];
}

function yieldBox(s: State, el: Element): void {
  s.yielded?.add(el);
  s.yieldedCount = (s.yieldedCount ?? 0) + 1;
}

/** Count one more give-back-and-push-again of a box; false when it switches too often (leave it). */
function cycle(s: State, el: Element): boolean {
  s.cycles ??= new WeakMap();
  const t = now();
  const times = (s.cycles.get(el) ?? []).filter((x) => t - x < CYCLE_WINDOW);
  times.push(t);
  s.cycles.set(el, times);
  return times.length < MAX_CYCLES;
}

/** Vertical offset an animated value puts on a box (px; NaN when it cannot tell). */
function yOf(value: string, el: Element): number {
  const v = value.trim();
  if (!v || v === 'none') return 0;
  const num = (t: string) => {
    const n = parseFloat(t);
    return /%$/.test(t.trim()) ? (n / 100) * ((el as HTMLElement).offsetHeight || 0) : n;
  };
  let m = /^matrix3d\(([^)]*)\)/.exec(v);
  if (m) return parseFloat(m[1].split(',')[13]);
  m = /^matrix\(([^)]*)\)/.exec(v);
  if (m) return parseFloat(m[1].split(',')[5]);
  m = /translateY\(\s*([^)]+)\)/.exec(v);
  if (m) return num(m[1]);
  m = /translate(?:3d)?\(\s*[^,]+,\s*([^,)]+)/.exec(v);
  if (m) return num(m[1]);
  const parts = v.split(/\s+/);
  if (parts.length >= 2 && /^-?[\d.]/.test(parts[1])) return num(parts[1]); // the translate property
  return /^-?[\d.]/.test(v) ? num(v) : NaN; // top, margin-top
}

const MOVES = ['transform', 'translate', 'top', 'marginTop', 'insetBlockStart'];

/** A running transition or animation moves the box: +1 down, -1 up, 0 none / cannot tell. */
function moving(el: Element): number {
  let anims: any[] = [];
  try {
    anims = (el as any).getAnimations?.() ?? [];
  } catch {
    return 0;
  }
  let dir = 0;
  for (const a of anims) {
    if (a.playState !== 'running' && !a.pending) continue;
    let frames: any[] = [];
    try {
      frames = a.effect?.getKeyframes?.() ?? [];
    } catch {
      continue;
    }
    if (frames.length < 2) continue;
    const first = frames[0];
    const last = frames[frames.length - 1];
    for (const prop of MOVES) {
      if (!(prop in last) || !(prop in first)) continue;
      const d = yOf(String(last[prop]), el) - yOf(String(first[prop]), el);
      if (d > 0.5) return 1;
      if (d < -0.5) dir = -1;
    }
    if (!dir) dir = -1; // something animates it: do not park it mid-flight
  }
  return dir;
}

/** Look at what was pushed before: gone, no longer pinned, replaced by the page, hidden in the band. */
function verify(ctx: PageContext): void {
  const s = st(ctx);
  const win = ctx.window!;
  const px = s.px ?? 0;
  const kept: Push[] = [];
  for (const p of s.pushes ?? []) {
    const el = p.el as HTMLElement;
    if (!el.isConnected) continue;
    const cs = win.getComputedStyle(el);
    const ours = el.style.getPropertyValue(p.prop) === p.value && el.style.getPropertyPriority(p.prop) === 'important';
    if (!ours) {
      // The page replaced its inline style (a re-render). Push again a few times, then let it be.
      if (++p.attempts >= MAX_ATTEMPTS || cs?.position !== p.kind) {
        yieldBox(s, el);
        continue;
      }
      p.base = baseOf(cs, p.kind);
      if (push(ctx, p, true)) kept.push(p);
      continue;
    }
    if (cs?.position !== p.kind) {
      restore(p); // not pinned any more: a margin would now move it in the flow
      continue;
    }
    if (p.kind === 'fixed') {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom <= px + 0.5 && moving(el) === 0) {
        // Hidden inside the band (translated up by its own height): let it hide above the window.
        restore(p);
        (s.parked ??= []).push(p);
        continue;
      }
    }
    kept.push(p);
  }
  s.pushes = kept;
  // Parked boxes: pushed again as soon as they show.
  const still: Push[] = [];
  for (const p of s.parked ?? []) {
    const el = p.el as HTMLElement;
    if (!el.isConnected || s.yielded?.has(el)) continue;
    const cs = win.getComputedStyle(el);
    if (cs?.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    const shows = (r.height > 0 && r.bottom > 0.5) || moving(el) > 0;
    if (!shows) {
      still.push(p);
      continue;
    }
    if (!cycle(s, el)) {
      yieldBox(s, el);
      continue;
    }
    p.base = baseOf(cs, 'fixed');
    if (push(ctx, p, false)) s.pushes.push(p);
  }
  s.parked = still;
}

function pushed(s: State, el: Element): boolean {
  return !!s.yielded?.has(el) || !!s.pushes?.some((p) => p.el === el) || !!s.parked?.some((p) => p.el === el);
}

/** A sticky box sticks to the viewport only when no ancestor is a scroll container. */
function stickyToViewport(win: Window, el: Element, body: Element, root: Element): boolean {
  const scrolls = (cs: CSSStyleDeclaration | null) => !!cs && (!['visible', 'clip'].includes(cs.overflowX) || !['visible', 'clip'].includes(cs.overflowY));
  for (let n = parentOf(el); n && n !== body && n !== root; n = parentOf(n)) if (scrolls(win.getComputedStyle(n))) return false;
  // With the root's overflow not visible, the body's own overflow makes the body a scroller.
  const rootCs = win.getComputedStyle(root);
  if (rootCs && (rootCs.overflowX !== 'visible' || rootCs.overflowY !== 'visible') && scrolls(win.getComputedStyle(body))) return false;
  return true;
}

/** Is this sticky box a header to push: top 0..inset, not too tall, sticking to the viewport. */
function stickyHeader(win: Window, el: Element, body: Element, root: Element, px: number, H: number, stuck: boolean): number | null {
  const cs = win.getComputedStyle(el);
  if (!cs || cs.position !== 'sticky') return null;
  const top = parseFloat(cs.top);
  const r = el.getBoundingClientRect();
  if (!Number.isFinite(top) || top < -SLACK || top >= px || r.width <= 0 || r.height <= 0 || r.height > H * HEADER_MAX) return null;
  if (stuck && Math.abs(r.top - top) > 1) return null; // in the flow, not stuck: the strip moves it
  return stickyToViewport(win, el, body, root) ? top : null;
}

/** Fixed, absolute and stuck sticky boxes that paint in the band (`light`: the probes' grid). */
function bandProbe(ctx: PageContext, light: boolean): void {
  const s = st(ctx);
  const win = ctx.window!;
  const doc = ctx.document!;
  const px = s.px ?? 0;
  const root = doc.documentElement;
  const body = doc.body;
  const H = (doc.scrollingElement ?? root).clientHeight;
  const W = root.clientWidth;
  const full = () => s.pushes!.length >= MAX_PUSHED || (s.ops ?? 0) >= MAX_OPS;
  const seen = new Set<Element>();
  const cache = new Map<Element, Facts>();
  const rows = light ? [px / 4, (px * 3) / 4] : [1, px / 2, px - 2];
  const columns = light ? PROBE_COLUMNS : COLUMNS;
  for (const y of rows) {
    for (let i = 0; i < columns && !full(); i++) {
      const x = W * (0.02 + (0.96 * i) / (columns - 1));
      for (const hit of hitsAt(doc, x, y)) {
        if (hit === root || hit === body) continue;
        const found = anchored(win, cache, hit, body, root);
        if (!found || seen.has(found.el)) continue;
        seen.add(found.el);
        if (pushed(s, found.el) || full()) continue;
        const r = found.el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        let base: number;
        if (found.kind === 'sticky') {
          if (!body) continue;
          const top = stickyHeader(win, found.el, body, root, px, H, true);
          if (top === null) continue;
          base = top;
        } else {
          if (found.kind === 'fixed' && (r.top >= px || r.bottom <= 0)) continue;
          if (found.kind === 'absolute' && (r.top + win.scrollY >= px || r.bottom + win.scrollY <= 0)) continue;
          base = baseOf(win.getComputedStyle(found.el), found.kind);
        }
        const p: Push = { el: found.el, kind: found.kind, prop: propOf(found.kind), base, old: '', oldPriority: '', value: '', attempts: 0 };
        // A box pushed before and given back (its position switched) is not a new one.
        const known = s.cycles?.has(found.el);
        if (known && !cycle(s, found.el)) {
          yieldBox(s, found.el);
          continue;
        }
        // Taller than a header (a sidebar, an overlay): pushed only when it stretches between a top and
        // a bottom (YouTube's guide: top 56px below its own header, bottom -120px), so the push makes
        // it shorter and its bottom edge stays where it was. One with a height of its own would move
        // down and lose its bottom edge: it is given back at once (nothing paints in between) and left.
        // And only one that starts below the window's top (a sidebar under the site's header) or still
        // covers it after the push (YouTube's overlay guide, top -120px): a box that fills the window
        // from its top edge (a full-window app or overlay) keeps covering it, with no empty band.
        const tall = found.kind === 'fixed' && r.height > H * HEADER_MAX;
        if (tall && !(r.top > 0.5 || r.top + px <= 0.5)) continue;
        if (push(ctx, p, !known)) {
          if (tall && Math.abs(found.el.getBoundingClientRect().bottom - r.bottom) > 1) {
            restore(p);
            yieldBox(s, found.el);
            continue;
          }
          s.pushes!.push(p);
          if (!known) cycle(s, found.el);
        }
      }
    }
  }
}

/** Sticky boxes with a top of 0..inset: a bounded walk of the body. */
function stickyScan(ctx: PageContext): void {
  const s = st(ctx);
  const win = ctx.window!;
  const doc = ctx.document!;
  const body = doc.body;
  const root = doc.documentElement;
  if (!body) return;
  const px = s.px ?? 0;
  const H = (doc.scrollingElement ?? root).clientHeight;
  const full = () => s.pushes!.length >= MAX_PUSHED || (s.ops ?? 0) >= MAX_OPS;
  const walker = doc.createTreeWalker(body, 1 /* NodeFilter.SHOW_ELEMENT */);
  let visited = 0;
  let node = walker.nextNode() as Element | null;
  while (node && visited++ < SCAN_LIMIT && !full()) {
    const cs = win.getComputedStyle(node);
    if (cs?.display === 'none') {
      // Skip the subtree: next sibling, or the next sibling of the nearest ancestor that has one.
      let next: Node | null = walker.nextSibling();
      while (!next && walker.parentNode()) next = walker.nextSibling();
      node = next as Element | null;
      continue;
    }
    if (cs?.position === 'sticky' && !pushed(s, node)) {
      const top = stickyHeader(win, node, body, root, px, H, false);
      if (top !== null) {
        const p: Push = { el: node, kind: 'sticky', prop: 'top', base: top, old: '', oldPriority: '', value: '', attempts: 0 };
        if (push(ctx, p, true)) s.pushes!.push(p);
      }
    }
    node = walker.nextNode() as Element | null;
  }
}

/** The pushed boxes, then the band; `full` (re-checks) also scans for sticky boxes below it. */
function headers(ctx: PageContext, full: boolean): void {
  const s = st(ctx);
  s.pushes ??= [];
  s.parked ??= [];
  s.yielded ??= new WeakSet();
  verify(ctx);
  bandProbe(ctx, !full);
  if (full) stickyScan(ctx);
}

// ---- probes: headers that appear or change after the checks ----

/** Run a band probe now (also from the inset:probe query). */
function probe(ctx: PageContext): void {
  const s = st(ctx);
  s.probeTimer = 0;
  s.probeDue = 0;
  s.lastProbe = Date.now();
  if (!s.sheet || !ctx.window || !ctx.document?.documentElement) return;
  const t0 = now();
  try {
    headers(ctx, false);
  } catch (e) {
    console.error('Deer inset: probe failed', e);
  }
  const ms = now() - t0;
  s.probes = (s.probes ?? 0) + 1;
  s.probeMs = Math.round(((s.probeMs ?? 0) + ms) * 100) / 100;
  s.probeMsMax = Math.max(s.probeMsMax ?? 0, Math.round(ms * 100) / 100);
}

/** Book a band probe no sooner than `gap` ms after the last one (it runs in an animation frame,
 * after the page's own scroll handlers and before the paint). */
function probeSoon(ctx: PageContext, gap: number): void {
  const s = st(ctx);
  const win = ctx.window;
  if (!win || !s.sheet) return;
  const due = Math.max(Date.now(), (s.lastProbe ?? 0) + gap);
  if (s.probeTimer && (s.probeDue ?? 0) <= due) return;
  if (s.probeTimer) win.clearTimeout(s.probeTimer);
  s.probeDue = due;
  s.probeTimer = win.setTimeout(() => {
    const w = ctx.window;
    if (w) w.requestAnimationFrame(() => probe(ctx));
    else s.probeTimer = 0;
  }, due - Date.now());
}

/** Check the pushed and parked boxes in the next animation frame (cheap: at most MAX_PUSHED boxes). */
function verifySoon(ctx: PageContext): void {
  const s = st(ctx);
  const win = ctx.window;
  if (!win || !s.sheet || s.frame || (!s.pushes?.length && !s.parked?.length)) return;
  s.frame = true;
  win.requestAnimationFrame(() => {
    s.frame = false;
    if (!s.sheet || !ctx.window) return;
    try {
      verify(ctx);
    } catch (e) {
      console.error('Deer inset: verify failed', e);
    }
  });
}

// ---- life cycle ----

/** Re-check after each of `delays`. A new call for the same `why` replaces the pending ones, so a
 * page that calls replaceState while scrolling gets a re-check after it stops, not one per call. */
function settle(ctx: PageContext, delays: number[], why: string): void {
  const s = st(ctx);
  const win = ctx.window;
  if (!win || !s.timers) return;
  for (const id of s.timers.get(why) ?? []) win.clearTimeout(id);
  s.timers.set(
    why,
    delays.map((ms) =>
      win.setTimeout(() => {
        if (why === 'navigation') s.lastNav = Date.now();
        check(ctx, why);
      }, ms)
    )
  );
}

/** Same-document navigations (pushState, fragments) re-check: an app may change its layout. */
function watchLocation(ctx: PageContext): void {
  const s = st(ctx);
  try {
    const webProgress = ctx.actor.docShell?.QueryInterface(Ci.nsIWebProgress);
    if (!webProgress) return;
    const listener = {
      onLocationChange(progress: any, _request: unknown, _location: unknown, flags: number) {
        if (!(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) return;
        try {
          if (!progress?.isTopLevel || progress.DOMWindow?.document !== ctx.document) return;
        } catch {
          return;
        }
        // A page that keeps calling replaceState (a scroll spy, a timer) gets one re-check per
        // NAV_GAP, not one per call.
        const wait = Math.max(0, (s.lastNav ?? 0) + NAV_GAP - Date.now());
        settle(
          ctx,
          NAV_SETTLE.map((ms) => Math.max(ms, wait)),
          'navigation'
        );
      },
      QueryInterface: ChromeUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
    };
    webProgress.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_LOCATION);
    s.progress = listener; // the docShell holds it weakly
    s.webProgress = webProgress;
  } catch (e) {
    console.error('Deer inset: no location listener', e);
  }
}

function start(ctx: PageContext): void {
  const s = st(ctx);
  const win = ctx.window;
  const doc = ctx.document;
  if (s.started || !win || !doc?.documentElement) return;
  s.started = true;
  s.reason = eligibility(ctx, doc);
  if (s.reason) return;
  s.pushes = [];
  s.parked = [];
  s.yielded = new WeakSet();
  s.timers = new Map();
  s.observer = () => check(ctx, 'setting');
  try {
    Services.prefs.addObserver(PREF, s.observer);
  } catch (e) {
    console.error('Deer inset: cannot observe the setting', e);
  }
  s.onResize = () => {
    const w = ctx.window;
    if (!w) return;
    if (s.resizeTimer) w.clearTimeout(s.resizeTimer);
    s.resizeTimer = w.setTimeout(() => {
      s.resizeTimer = 0;
      check(ctx, 'resize');
    }, RESIZE_WAIT);
  };
  win.addEventListener('resize', s.onResize);
  watchLocation(ctx);
  // Before the first layout: an ordinary page is laid out with the strip from the start.
  if (wanted() && !browserOff(ctx) && !barHidden(ctx)) setSheet(ctx, { px: insetPx(ctx), pad: 0, colour: '', origin: '' });
}

/** A <link rel=stylesheet> of the document has not finished loading (its sheet is not there yet). */
function sheetsPending(doc: Document): boolean {
  try {
    for (const link of doc.querySelectorAll('link[rel~="stylesheet" i]')) {
      if (!(link as HTMLLinkElement).sheet && !(link as HTMLLinkElement).disabled) return true;
    }
  } catch {
    return true;
  }
  return false;
}

export const events = {
  // Chrome-only: the document's root element went in (before any layout).
  DOMDocElementInserted: {},
  DOMContentLoaded: {},
  pageshow: {},
  // Probes. Scroll does not bubble out of scrollable elements: capture sees the viewport's too.
  scroll: { capture: true, passive: true, createActor: false },
  MozAfterPaint: { capture: true, createActor: false },
  transitionrun: { capture: true, createActor: false },
  transitionend: { capture: true, createActor: false },
  animationstart: { capture: true, createActor: false },
  animationend: { capture: true, createActor: false },
};

/** The element an event is about, through shadow-root retargeting. */
function targetOf(event: Event): Element | null {
  try {
    const t = ((event as any).composedTarget ?? event.target) as Node | null;
    return t && t.nodeType === 1 ? (t as Element) : null;
  } catch {
    return null;
  }
}

export function onEvent(ctx: PageContext, event: Event): void {
  if (!ctx.isTop) return;
  const doc = ctx.document;
  if (!doc) return;
  const s = st(ctx);
  switch (event.type) {
    case 'scroll':
      // Only the document's own scrolling moves the band over the page.
      if (!s.sheet || (event.target !== doc && event.target !== doc.documentElement)) return;
      verifySoon(ctx);
      probeSoon(ctx, PROBE_SCROLL);
      return;
    case 'MozAfterPaint':
      if (s.sheet) probeSoon(ctx, PROBE_PAINT);
      return;
    case 'transitionrun':
    case 'transitionend':
    case 'animationstart':
    case 'animationend': {
      if (!s.sheet) return;
      const el = targetOf(event);
      if (el && pushed(s, el)) verifySoon(ctx);
      return;
    }
  }
  if (event.target !== doc) return;
  switch (event.type) {
    case 'DOMDocElementInserted':
      start(ctx);
      break;
    case 'DOMContentLoaded':
      start(ctx);
      // With style sheets still loading, layout has not started: measuring now would force it
      // (Firefox warns of a flash of unstyled content) and measure an unstyled page. Load decides.
      if (!sheetsPending(doc)) check(ctx, 'ready');
      break;
    case 'pageshow': {
      start(ctx);
      const restored = !!(event as PageTransitionEvent).persisted;
      // A frame or probe booked just before the page went into the back/forward cache must not
      // block new ones.
      s.frame = false;
      if (s.probeTimer) ctx.window?.clearTimeout(s.probeTimer);
      s.probeTimer = 0;
      check(ctx, restored ? 'restored' : 'load');
      settle(ctx, SETTLE, 'settle');
      break;
    }
  }
}

function describe(ctx: PageContext, data: unknown): object {
  const s = st(ctx);
  const win = ctx.window;
  const doc = ctx.document;
  let padding = '';
  let rect: Record<string, number> | null = null;
  try {
    if (win && doc?.documentElement) padding = win.getComputedStyle(doc.documentElement)?.paddingTop ?? '';
    const selector = data && typeof data === 'object' && typeof (data as any).selector === 'string' ? ((data as any).selector as string) : '';
    const el = selector && doc ? doc.querySelector(selector) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      rect = { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
    }
  } catch {
    /* a bad selector, or the document is going away */
  }
  const box = (p: Push) => {
    const cls = (p.el as any).className;
    let computed = '';
    try {
      computed = win?.getComputedStyle(p.el)?.getPropertyValue(p.prop) ?? '';
    } catch {
      computed = '';
    }
    return { kind: p.kind, prop: p.prop, value: p.value, computed, tag: p.el.localName, id: p.el.id, cls: String(cls?.baseVal ?? cls ?? '').slice(0, 60), attempts: p.attempts };
  };
  return {
    eligible: !!s.started && !s.reason,
    reason: s.started ? (s.reason ?? '') : ctx.isTop ? 'not started' : 'frame',
    wanted: wanted(),
    browserOff: browserOff(ctx),
    barHidden: barHidden(ctx),
    applied: !!s.sheet,
    px: s.px ?? 0,
    pad: s.pad ?? 0,
    padding,
    colour: s.colour ?? '',
    origin: s.origin ?? '',
    decision: s.decision ?? '',
    S: s.S ?? 0,
    H: s.H ?? 0,
    scrollY: win?.scrollY ?? 0,
    flips: s.flips ?? 0,
    frozen: !!s.frozen,
    checks: s.checks ?? 0,
    why: s.why ?? '',
    log: s.log ?? [],
    pushed: (s.pushes ?? []).map(box),
    parked: (s.parked ?? []).map(box),
    yielded: s.yieldedCount ?? 0,
    ops: s.ops ?? 0,
    scanMs: s.scanMs ?? 0,
    checkMs: s.checkMs ?? 0,
    checkMsMax: s.checkMsMax ?? 0,
    checkMsTotal: s.checkMsTotal ?? 0,
    times: s.times ?? [],
    probes: s.probes ?? 0,
    probeMs: s.probeMs ?? 0,
    probeMsMax: s.probeMsMax ?? 0,
    url: doc?.documentURI ?? '',
    rect,
  };
}

export function onMessage(ctx: PageContext, name: string, data: unknown): unknown {
  if (name === 'inset:check') {
    check(ctx, 'asked');
    return describe(ctx, data);
  }
  if (name === 'inset:probe') {
    probe(ctx);
    return describe(ctx, data);
  }
  if (name === 'inset:state') return describe(ctx, data);
  return undefined;
}

export function onDestroy(ctx: PageContext): void {
  const s = st(ctx);
  if (!s.started || s.reason) return;
  try {
    if (s.observer) Services.prefs.removeObserver(PREF, s.observer);
  } catch {
    /* already gone */
  }
  try {
    if (s.progress) s.webProgress?.removeProgressListener(s.progress);
  } catch {
    /* the docShell is gone */
  }
  try {
    const win = ctx.window;
    if (win && s.onResize) win.removeEventListener('resize', s.onResize);
    for (const ids of s.timers?.values() ?? []) for (const id of ids) win?.clearTimeout(id);
    if (s.resizeTimer) win?.clearTimeout(s.resizeTimer);
    if (s.probeTimer) win?.clearTimeout(s.probeTimer);
  } catch {
    /* the window is gone */
  }
  s.timers?.clear();
}
