// Find in page: per-page state, the finder, keys, the Esc ladder, the landing ring and the scroll
// guard. Ported from app/src/renderer/modules/find.ts (FindController) onto Gecko's browser.finder
// (recipe: spikes/pagefeatures/RESULT.md, FIND, with the verifier's corrections 1-6).
//
// State is per page (<browser>: a tab or a peek). The page find acts on is the open peek, else the
// active tab. The pill's find face shows a tab's find; the capsule in the peek header a peek's.
//
// Gecko notes
//   - The finder answers onFindResult (result, findBackwards, searchString) and then
//     onMatchesCountResult (current, total, limit; total -1 = the limit was hit). A count of 0 that
//     arrives while the last result was a hit is a superseded request: it is dropped, and 120 ms after
//     the last result of a burst the count is asked again (requestMatchesCount). (Correction 1.)
//     Overlapping count requests can also answer with a partial total: FinderParent sums the frames'
//     answers and stops at the first frame whose request was superseded (FinderParent.sys.mjs
//     updateHighlightAndMatchCount), and Finder.requestMatchesCount hands a superseded request the
//     count so far, and the newer request then gets nothing. So the repair waits until no query to
//     the frames is out (gecko.ts finderActivity), asks once, and the answer to that request (no
//     other query sent meanwhile) is authoritative: it stands until the next result. Until then a
//     count lower than the last authoritative total for the same query is shown as that total, so
//     a burst never flashes a partial "N of 11" on a page with 13.
//   - The rect in onFindResult is relative to the frame that holds the match (correction 4): the page
//     module measures the find selection itself and carries it up through the frames.
//   - The scroll guard (a match under the glass goes to y 92) also covers matches in frames (the top
//     document scrolls what holds the frame). With the page inset on, Gecko's find would centre a
//     match that sits inside the inset's scroll padding (it counts as off-screen), so while find is
//     open the page module sets that padding back to 0 in the top document (page find.ts).
//   - Peeks: a find open in a sheet that closes is closed with it (the 'vitre:peek' event, or a check
//     after the capsule leaves); a promoted sheet's find carries over to its new tab. The poll that
//     follows the sheet's header runs only while a peek is up.
//   - A tab that leaves the window (closed, or moved to another window, where its document and its
//     finder live on) has its find closed properly: no highlights or armed page left behind.
//   - A page whose content process crashes ('tab-crashed') loses its find like a page that went to
//     another document: closed, query kept, no dead count left on screen.
//   - PDFs: pdf.js searches the whole document itself and talks only to a findbar; a stand-in per tab
//     (gecko.ts) hands it Deer's queries and gives back its results and growing counts, shown with
//     "+" until they settle (FIND_PENDING, correction 2). No ring, guard or pre-fill there (design).
//   - The native findbar is never created: gLazyFindCommand is Deer's, the content find shortcut
//     can never match, and type-ahead find is off (runtime prefs).
import type { Browser, OpenRequest, Tab } from '../../browser';
import { find as findBinding, keyInput } from '../../../shared/shortcuts';
import * as gk from './gecko';
import { LandingRing, type Rect } from './ring';
import { CSS } from './styles';
import { fmt, PeekCapsule, PillFace, type CountView, type Dir } from './views';

type Landing = 'ring' | 'guard';
type CloseHow = 'keep' | 'clear' | 'activate';
type View = PillFace | PeekCapsule;

interface FindState {
  browser: XULBrowser;
  open: boolean;
  /** The field's text; kept after close for F3 and the next Ctrl+F. */
  query: string;
  matchCase: boolean;
  ord: number;
  /** -1: the count limit was hit. */
  total: number;
  limit: number;
  final: boolean;
  /** The last onFindResult result (nsITypeAheadFind FIND_*), null before the first. */
  result: number | null;
  /** A result has arrived for the current session. */
  searched: boolean;
  /** Query and case the current session was started for. */
  session: string | null;
  sessionAt: number;
  /** One step in flight; extra presses merge into one queued step. */
  inFlight: boolean;
  queued: 0 | Dir;
  flightTimer: number;
  countTimer: number;
  pdfTimer: number;
  /** Count requests sent since the last result (see repairCount). */
  repairs: number;
  /** finderActivity().sent right after the last repair request went out (-1: none out). */
  repairSent: number;
  /** The repair's answer came: the count stands until the next result. */
  countSettled: boolean;
  /** The last authoritative total, for the session (query and case) it was counted for. */
  trusted: { key: string; total: number } | null;
  /** F3 with find closed: step once the reopened session has found its first match. */
  pendingStep: 0 | Dir;
  /** The step whose count is awaited (the counter rolls up or down). */
  stepDir: 0 | Dir;
  rapid: boolean;
  /** The user stepped or scrolled since the page started loading (no re-run at the end of the load). */
  stepped: boolean;
  /** Searched while the page was loading (or it reloaded): run once more when it stops. */
  rerun: boolean;
  loading: boolean;
  lastResultAt: number;
  guardedAt: number;
  /** The active match in window coordinates (after the last landing). */
  rect: Rect | null;
  ringKey: string;
  url: string;
  pdf: boolean;
  /** The finder object the listener is on (browser.finder changes with remoteness). */
  finder: any;
  listener: Record<string, (...args: any[]) => unknown>;
  /** The frame that holds the active match. */
  foundBC: any;
}

interface Target {
  browser: XULBrowser;
  tab: Tab | undefined;
  peek: boolean;
}

/** A row of the 'menus' service (menus/types.ts), typed by the provider's declaration. */
type MenuItem = Parameters<VitreServices['menus']['show']>[0][number];

const GUARD_Y = 92;
const RAPID_MS = 140;
const TYPE_PAUSE_MS = 400;
const COUNT_REPAIR_MS = 120;
/** No answer to a count request at all (its first frame's request superseded): ask again. */
const COUNT_WATCHDOG_MS = 600;
/** While queries to the frames are out, look again this often... */
const COUNT_POLL_MS = 40;
/** ...but no longer than this after the last result (a frame that never answers). */
const COUNT_IDLE_CAP_MS = 4000;
const MAX_REPAIRS = 4;
/** A peek's find whose page has left (closed, not promoted) is closed after this long. */
const ORPHAN_MS = 1200;
const FLIGHT_MS = 700;
const OURS_MS = 300;
const ONE_CHAR_HOLD = 150;
const PDF_SETTLE = 500;
const POLL_MS = 250;
const LOST_SESSION_MS = 1000;
const SELECTION_WAIT = 150;
const MAX_QUERY = 120;
const SCROLL_KEYS: Record<string, 'up' | 'down' | 'pageUp' | 'pageDown'> = { ArrowUp: 'up', ArrowDown: 'down', PageUp: 'pageUp', PageDown: 'pageDown' };

const sessionKey = (s: FindState): string => `${s.matchCase ? 'C' : 'c'}:${s.query}`;
const stripHash = (u: string): string => u.split('#')[0];
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export class FindController {
  private states = new WeakMap<XULBrowser, FindState>();
  private open = new Set<FindState>();
  /** This window's last query, for pages that have none. */
  private windowQuery = '';
  readonly face: PillFace;
  readonly capsule: PeekCapsule;
  readonly ring: LandingRing;
  private lastStepAt = 0;
  /** What the next result for the shown page does: land the ring (and guard), or only guard. */
  private landNext: Landing | null = null;
  private typedSinceOpen = false;
  /** The user typed in the field since find opened (the typing schedules its own search). */
  private userTyped = false;
  private composing = false;
  private orphanTimer = 0;
  private searchRaf = 0;
  private holdTimer = 0;
  private pauseTimer = 0;
  private glassTimer = 0;
  private pollTimer = 0;
  private lastTarget: XULBrowser | null = null;
  private lastSlot = '';

  constructor(private b: Browser) {
    b.css('find', CSS);
    this.ring = new LandingRing(b.layer('find-ring', 9));
    const layer = b.layer('find', 12);
    const handlers = {
      input: () => this.onInput(),
      key: (e: KeyboardEvent) => this.onKey(e),
      buttonKey: (e: KeyboardEvent) => this.onButtonKey(e),
      step: (dir: Dir) => this.withShown((st) => this.step(st, dir, false)),
      toggleCase: () => this.withShown((st) => this.toggleCase(st)),
      close: () => this.withShown((st) => this.close(st, 'keep', { focusPage: true })),
      focusChanged: () => this.focusChanged(),
      compose: (on: boolean) => this.onCompose(on),
      menu: (e: MouseEvent) => this.onMenu(e),
    };
    this.face = new PillFace(b, layer, handlers);
    this.capsule = new PeekCapsule(b, layer, handlers);

    // Process-wide (idempotent) and per window: the native findbar is never made.
    gk.silenceContentShortcut();
    gk.setMatchColours();
    gk.takeOverFindCommands((cmd, arg) => {
      if (cmd === 'onFindAgainCommand') this.findAgain(arg ? -1 : 1);
      else if (cmd === 'onFindCommand' || cmd === 'onFindSelectionCommand') this.find();
    });
    gk.installStandIn({
      result: (browser, result, findPrevious) => {
        const st = this.states.get(browser);
        if (!st?.open) return;
        st.pdf = true;
        this.onResult(st, { result, findBackwards: findPrevious });
      },
      count: (browser, r) => {
        const st = this.states.get(browser);
        if (!st?.open) return;
        st.pdf = true;
        this.onCount(st, r);
      },
    });

    b.registerAction('find', () => this.find());
    b.registerAction('findNext', () => this.findAgain(1));
    b.registerAction('findPrev', () => this.findAgain(-1));
    // Esc ladder: the focused find field closes find (70); parked find closes after the page (90).
    b.addEscLayer(70, () => this.escape(true));
    b.addEscLayer(90, () => this.escape(false));
    b.keys.addHook((binding, e) => this.keyHook(binding, e));

    b.on('tab-activated', () => this.sync());
    b.on('render', () => this.sync());
    b.on('tab-closed', (t) => this.forget(t.browser));
    b.on('tab-navigated', (_t, browser, info) => this.onNavigate(browser, info));
    b.on('tab-crashed', (_t, browser) => this.onCrash(browser));
    b.on('tab-loading', (_t, browser, loading) => this.onLoading(browser, loading));
    b.on('page-message', (_t, name, data, from) => {
      if (name !== 'find:page-event') return;
      const kind = (data as { kind?: unknown } | null)?.kind;
      if (kind === 'scroll' || kind === 'wheel' || kind === 'menu') this.onPageEvent(from.browser, kind);
    });
    window.addEventListener('resize', () => this.ring.cancel());
    // The peek module announces its sheet changing (open, closing, promoting, closed). A closed
    // sheet takes its find with it (a promoted one keeps it: its page becomes a tab).
    const peekChanged = (e: Event): void => {
      this.sync();
      if ((e as CustomEvent<{ phase?: unknown }>).detail?.phase === 'closed') this.dropOrphans();
    };
    window.addEventListener('vitre:peek', peekChanged);
    b.onDestroy(() => window.removeEventListener('vitre:peek', peekChanged));
    // The address field opens (Ctrl+L, a click on another address): find steps aside, keeping the
    // query. F11 or auto-hide: the face takes or gives back its own glass.
    const observer = new MutationObserver(() => {
      this.syncGlass();
      if (!b.root.classList.contains('omni-open')) return;
      const st = this.shown();
      if (st?.open) this.close(st, 'clear', { focusPage: false, fade: true });
    });
    observer.observe(b.root, { attributes: true, attributeFilter: ['class'] });
    b.onDestroy(() => {
      observer.disconnect();
      window.clearInterval(this.pollTimer);
      window.clearTimeout(this.orphanTimer);
    });
  }

  // ---- the API other modules use ('find' service) ----

  api(): { open(opts?: { query?: string; browser?: XULBrowser }): void; close(): void; isOpen(): boolean } {
    return {
      open: (opts = {}) => this.openFor(opts),
      close: () => {
        const st = this.shown();
        if (st?.open) this.close(st, 'keep', { focusPage: true });
      },
      isOpen: () => !!this.shown()?.open,
    };
  }

  /** For tests: the state of a page as plain data. */
  inspect(browser?: XULBrowser): Record<string, unknown> | null {
    const br = browser ?? this.target()?.browser;
    const st = br ? this.states.get(br) : undefined;
    if (!st) return null;
    const view = this.viewOf(st);
    return {
      open: st.open, query: st.query, matchCase: st.matchCase, ord: st.ord, total: st.total, limit: st.limit,
      final: st.final, result: st.result, searched: st.searched, pdf: st.pdf, rect: st.rect,
      counter: view?.countText ?? null, focused: view?.hasFocus() ?? false, view: view === this.face ? 'pill' : view === this.capsule ? 'capsule' : null,
      foundTop: !!st.foundBC && st.foundBC === st.browser.browsingContext,
    };
  }

  // ---- targets and views ----

  /** The 'peek' service, typed by its provider (peek/index.ts); undefined when the build has no Peek. */
  private peek(): VitreServices['peek'] | undefined {
    return this.b.service('peek');
  }

  /** The open peek's page, or null. */
  private peekBrowser(): XULBrowser | null {
    try {
      const p = this.peek();
      if (p?.isOpen && !p.isOpen()) return null;
      return p?.browser?.() ?? window.vitrePeek?.browser?.() ?? null;
    } catch {
      return null;
    }
  }

  /** The page find acts on: the topmost one (an open peek, else the active tab). */
  private target(): Target | null {
    const pb = this.peekBrowser();
    if (pb) return { browser: pb, tab: undefined, peek: true };
    const t = this.b.active();
    return t ? { browser: t.browser, tab: t, peek: false } : null;
  }

  private targetFor(browser: XULBrowser): Target | null {
    const t = this.target();
    return t && t.browser === browser ? t : null;
  }

  private state(browser: XULBrowser): FindState {
    let st = this.states.get(browser);
    if (!st) {
      const s: FindState = {
        browser, open: false, query: '', matchCase: false, ord: 0, total: 0, limit: 0, final: true, result: null,
        searched: false, session: null, sessionAt: 0, inFlight: false, queued: 0, flightTimer: 0, countTimer: 0,
        pdfTimer: 0, repairs: 0, repairSent: -1, countSettled: false, trusted: null, pendingStep: 0, stepDir: 0, rapid: false, stepped: false, rerun: false, loading: false,
        lastResultAt: 0, guardedAt: 0, rect: null, ringKey: '', url: '', pdf: false, finder: null, listener: {}, foundBC: null,
      };
      s.listener = {
        onFindResult: (d: any) => this.onResult(s, d),
        onMatchesCountResult: (r: any) => this.onCount(s, r),
        onHighlightFinished: () => {},
        onCurrentSelection: () => {},
        shouldFocusContent: () => true,
      };
      this.states.set(browser, s);
      st = s;
    }
    return st;
  }

  /** The finder of the page right now, with the listener on it. */
  private attach(st: FindState): any {
    const f = gk.finderOf(st.browser);
    if (f === st.finder) return f;
    try {
      st.finder?.removeResultListener(st.listener);
    } catch {
      /* the old finder is gone */
    }
    st.finder = f;
    try {
      f?.addResultListener(st.listener);
    } catch {
      /* no finder */
    }
    // Follow its traffic to the frames from the first query on (see repairCount).
    gk.finderActivity(f);
    return f;
  }

  /** The view showing a page's find, if any. */
  private viewOf(st: FindState): View | null {
    if (this.face.mode !== 'hidden' && this.face.browser === st.browser) return this.face;
    if (this.capsule.mode !== 'hidden' && this.capsule.browser === st.browser) return this.capsule;
    return null;
  }

  /** The state whose view is up (open, or closing). */
  private shown(): FindState | null {
    const br = this.face.mode === 'open' ? this.face.browser : this.capsule.mode === 'open' ? this.capsule.browser : null;
    return br ? (this.states.get(br) ?? null) : null;
  }

  private withShown(fn: (st: FindState) => void): void {
    const st = this.shown();
    if (st?.open) fn(st);
  }

  private barHidden(): boolean {
    return this.b.bar.hidden || (this.b.root.classList.contains('fullscreen') && !this.b.root.classList.contains('bar-revealed'));
  }

  private elementFullscreen(): boolean {
    return this.b.root.classList.contains('element-fullscreen');
  }

  /**
   * Where the capsule goes: the peek's slot (headerSlot(true) also hides the header's domain and
   * path), else 38 px into its header, vertically centred (FindContexts board).
   */
  private slot(): { x: number; y: number; width: number } | null {
    const p = this.peek();
    try {
      if (p?.headerSlot) {
        const s = p.headerSlot(true);
        if (s && s.width) return { x: s.x, y: s.y + (s.height - 32) / 2, width: s.width };
      }
      const h = p?.headerRect?.();
      if (h && h.width) return { x: h.x + 38, y: h.y + (h.height - 32) / 2, width: Math.min(440, h.width - 38 - 84) };
    } catch {
      /* the peek is going away */
    }
    return null;
  }

  /** The capsule leaves the header: the header's domain and path come back. */
  private hideCapsule(): void {
    if (this.capsule.mode === 'hidden') return;
    this.capsule.hide();
    try {
      this.peek()?.headerSlot?.(false);
    } catch {
      /* the peek is gone */
    }
  }

  // ---- actions ----

  /** Ctrl+F: open find on the topmost page (Home: the address field, as Ctrl+L). */
  private find(): void {
    if (this.elementFullscreen()) return;
    const tg = this.target();
    if (!tg) return;
    if (!tg.peek && tg.tab?.kind === 'home') {
      this.b.builtin('find');
      return;
    }
    if (this.b.omni.open) this.b.omni.close(false);
    const st = this.state(tg.browser);
    const view = this.viewOf(st);
    if (st.open && view && view.mode === 'open') {
      const parked = !view.hasFocus();
      view.focusField(true); // again: select all, no motion
      if (parked) void this.refill(st);
      return;
    }
    void this.openOn(st, tg, { parked: false });
  }

  /** F3, Shift+F3, Ctrl+G, Ctrl+Shift+G: step; with find closed, reopen it parked and step. */
  private findAgain(dir: Dir): void {
    if (this.elementFullscreen()) return;
    const tg = this.target();
    if (!tg || (!tg.peek && tg.tab?.kind !== 'web')) return;
    const st = this.state(tg.browser);
    const repeat = !!this.b.keys.current?.repeat;
    if (st.open && this.viewOf(st)) {
      this.step(st, dir, !!this.b.keys.current, repeat);
      return;
    }
    if (!st.query && !this.windowQuery) {
      void this.openOn(st, tg, { parked: false });
      return;
    }
    void this.openOn(st, tg, { parked: true, step: dir });
  }

  /** The 'find' service: open on a page, optionally with a query (menus: Find "x" on page). */
  private openFor(opts: { query?: string; browser?: XULBrowser }): void {
    if (this.elementFullscreen()) return;
    const tg = opts.browser ? this.targetFor(opts.browser) : this.target();
    if (!tg) return;
    if (!tg.peek && tg.tab?.kind === 'home') {
      this.b.builtin('find');
      return;
    }
    const q = typeof opts.query === 'string' ? opts.query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY) : '';
    if (!q) {
      this.find();
      return;
    }
    if (this.b.omni.open) this.b.omni.close(false);
    const st = this.state(tg.browser);
    const view = this.viewOf(st);
    if (st.open && view && view.mode === 'open') {
      this.typedSinceOpen = true;
      st.query = q;
      this.windowQuery = q;
      view.setQuery(q);
      view.focusField(true);
      this.search(st);
      return;
    }
    void this.openOn(st, tg, { parked: false, query: q });
  }

  private async openOn(st: FindState, tg: Target, opts: { parked: boolean; step?: Dir; query?: string }): Promise<void> {
    const browser = tg.browser;
    this.b.closePanels();
    st.open = true;
    this.open.add(st);
    st.query = opts.query ?? (st.query || this.windowQuery);
    st.url = browser.currentURI?.spec ?? '';
    st.pdf = gk.isPdfViewer(browser);
    st.loading = tg.tab ? tg.tab.loading : !!browser.webProgress?.isLoadingDocument;
    st.searched = false;
    st.result = null;
    st.session = null;
    st.ord = st.total = 0;
    st.repairSent = -1;
    st.countSettled = false;
    st.trusted = null;
    this.typedSinceOpen = !!opts.query;
    this.userTyped = false;
    const finder = this.attach(st);
    try {
      finder?.onFindbarOpen();
      finder?.onHighlightAllChange(true);
    } catch (e) {
      console.error('Deer find: the finder did not open', e);
    }
    gk.releasePassThrough(browser);
    gk.announceOpen(browser, true);

    let view: View;
    if (tg.peek) {
      if (this.face.mode !== 'hidden') this.face.hide('instant');
      view = this.capsule;
      this.prepare(view, st);
      this.capsule.show(browser, this.slot() ?? { x: 0, y: 0, width: 440 }, true);
    } else {
      this.hideCapsule();
      view = this.face;
      this.prepare(view, st);
      if (tg.tab) this.face.show(tg.tab, 'open', this.barHidden());
    }
    // The field has focus from the first frame, so typing never waits.
    if (!opts.parked) view.focusField(true);
    this.focusChanged();
    this.b.page(browser).sendAll('find:armed', { on: true });
    this.armPoll();

    let picked: string | null = null;
    if (!opts.query && !st.pdf) picked = await this.askSelection(browser);
    if (!st.open || this.viewOf(st) !== view) return;
    if (!opts.parked && !this.typedSinceOpen && picked && picked !== st.query) this.prefill(st, view, picked);
    if (st.query) this.windowQuery = st.query;
    if (opts.step && st.query) st.pendingStep = opts.step;
    // Typing while the selection was asked for has scheduled its own search: no second one.
    if (this.userTyped && this.shown() === st) return;
    if (st.query) {
      this.search(st);
      // Land on the first match once it is found.
      if (this.shown() === st) this.landNext = 'ring';
    } else this.refreshCount(st, null);
  }

  /** Put a page's query, case and counter into a view before it shows. */
  private prepare(view: View, st: FindState): void {
    view.setQuery(st.query);
    view.setCase(st.matchCase);
    view.setComposing(false);
    view.setCount(this.countView(st), null);
  }

  /** Ctrl+F with find parked: a selection made in the page since find last closed replaces the query. */
  private async refill(st: FindState): Promise<void> {
    if (st.pdf) return;
    this.typedSinceOpen = false;
    const picked = await this.askSelection(st.browser);
    const view = this.viewOf(st);
    if (!st.open || !view || this.typedSinceOpen || !picked || picked === st.query) return;
    this.prefill(st, view, picked);
    this.windowQuery = picked;
    this.search(st);
    this.landNext = 'ring';
  }

  /** The user's fresh selection in the page (the focused frame first), or null. */
  private async askSelection(browser: XULBrowser): Promise<string | null> {
    type Answer = { text?: unknown; fresh?: unknown; focused?: unknown };
    const answers = await Promise.race([
      this.b.page(browser).queryAll<Answer | null>('find:selection'),
      new Promise<[]>((r) => window.setTimeout(() => r([]), SELECTION_WAIT)),
    ]);
    let best: string | null = null;
    let bestFocused = false;
    for (const a of answers) {
      const ans = a.answer;
      if (!ans || typeof ans.text !== 'string' || !ans.text || ans.fresh !== true) continue;
      const text = ans.text.slice(0, MAX_QUERY);
      const focused = ans.focused === true;
      if (best === null || (focused && !bestFocused) || (a.isTop && !bestFocused && !focused)) {
        best = text;
        bestFocused = focused;
      }
    }
    return best;
  }

  private prefill(st: FindState, view: View, text: string): void {
    st.query = text;
    view.setQuery(text);
    if (view.hasFocus()) view.focusField(true);
  }

  /**
   * Close find on a page. 'keep': the active match stays as the page's selection and takes focus
   * (or its link does); 'clear': the selection goes too (Ctrl+L); 'activate': the match's link is
   * clicked (Ctrl+Enter). gone: the document went away (navigation).
   */
  private close(st: FindState, how: CloseHow, opts: { focusPage: boolean; fade?: boolean; gone?: boolean; instant?: boolean }): void {
    if (!st.open) return;
    st.open = false;
    this.open.delete(st);
    if (st.query) this.windowQuery = st.query;
    const view = this.viewOf(st);
    if (view) {
      this.cancelTimers();
      this.ring.cancel();
      this.landNext = null;
    }
    this.armPoll();
    window.clearTimeout(st.flightTimer);
    window.clearTimeout(st.countTimer);
    window.clearTimeout(st.pdfTimer);
    st.inFlight = false;
    st.queued = 0;
    st.pendingStep = 0;
    const finder = this.attach(st);
    try {
      // Finder.keyPress clicks the link that holds the match on Return (DOM_VK_RETURN, 13).
      if (!opts.gone && how === 'activate') finder?.keyPress({ keyCode: 13, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
      if (!opts.gone && how === 'clear') finder?.removeSelection();
      if (opts.focusPage) {
        if (!opts.gone && how !== 'clear' && finder) finder.focusContent();
        else st.browser.focus();
      }
      finder?.onFindbarClose();
    } catch (e) {
      console.error('Deer find: close failed', e);
    }
    gk.announceOpen(st.browser, false);
    try {
      finder?.removeResultListener(st.listener);
    } catch {
      /* gone */
    }
    st.finder = null;
    this.b.page(st.browser).sendAll('find:closed');
    st.session = null;
    st.ord = st.total = 0;
    st.searched = false;
    st.result = null;
    st.rect = null;
    st.ringKey = '';
    st.foundBC = null;
    if (view === this.face) this.face.hide(opts.instant ? 'instant' : opts.fade ? 'fade' : 'morph', this.face.ownGlass);
    else if (view === this.capsule) this.hideCapsule();
  }

  /**
   * Open finds whose page is neither a tab of this window nor the open peek (a peek closed with find
   * open) are closed, keeping their query. A promoted peek's page is a tab by then and keeps its find.
   */
  private dropOrphans(): void {
    window.clearTimeout(this.orphanTimer);
    const peek = this.peekBrowser();
    for (const st of [...this.open]) {
      if (st.browser !== peek && !this.b.tabFor(st.browser)) this.close(st, 'keep', { focusPage: false });
    }
  }

  /**
   * Ctrl+Q in the field: close find keeping the match selected, then peek the link that holds it
   * (the page answers once the link has focus).
   */
  private async closeAndPeek(st: FindState): Promise<void> {
    const peek = this.peek();
    const bc = st.foundBC ?? st.browser.browsingContext;
    this.close(st, 'keep', { focusPage: true });
    if (!peek?.open || !bc) return;
    type Link = { href?: unknown; rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }; via?: unknown };
    const link = await this.b.page(bc).query<Link | null>('find:link');
    const href = typeof link?.href === 'string' ? link.href : '';
    if (!href) return;
    const principal = gk.framePrincipal(bc);
    if (!principal || !gk.checkLoad(principal, href)) return;
    const request: OpenRequest = {
      url: href,
      disposition: 'foreground-tab',
      source: 'click',
      opener: this.b.tabFor(st.browser),
      browser: st.browser,
      click: { href, triggeringPrincipal: principal, originPrincipal: principal, button: 0, shiftKey: false, ctrlKey: false, altKey: false },
    };
    let rect: Rect | null = null;
    if (link?.rect && num(link.via) === 0) {
      rect = this.toWindow(st.browser, { x: num(link.rect.x), y: num(link.rect.y), width: num(link.rect.width), height: num(link.rect.height) });
    }
    try {
      peek.open(request, rect ? { origin: rect } : undefined);
    } catch (e) {
      console.error('Deer find: peek failed', e);
    }
  }

  private escape(fieldLayer: boolean): boolean {
    const st = this.shown();
    if (!st?.open) return false;
    const view = this.viewOf(st);
    if (!view || view.hasFocus() !== fieldLayer) return false;
    this.close(st, 'keep', { focusPage: true });
    return true;
  }

  private toggleCase(st: FindState): void {
    if (!st.open) return;
    st.matchCase = !st.matchCase;
    this.viewOf(st)?.setCase(st.matchCase);
    if (st.query) this.search(st);
  }

  // ---- keys ----

  /**
   * F6 moves between the find field and its page while find is open (both ways; find stays open).
   * Ctrl+Q typed in the field is the field's own (closes find and peeks the match's link): the
   * router leaves it alone.
   */
  private keyHook(binding: { action: string; arg?: number } | null, e: KeyboardEvent): 'swallow' | 'pass' | undefined {
    if (!binding) return undefined;
    const st = this.shown();
    if (!st?.open) return undefined;
    const view = this.viewOf(st);
    if (!view) return undefined;
    if (binding.action === 'peekLink' && e.target === view.input) return 'pass';
    if (binding.action !== 'focusAddress' || binding.arg !== 6) return undefined;
    const inField = view.hasFocus();
    const inPage = e.target === st.browser || document.activeElement === st.browser;
    if (!inField && !inPage) return undefined;
    if (e.repeat) return 'swallow';
    if (inField) st.browser.focus();
    else view.focusField(true);
    this.focusChanged();
    return 'swallow';
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const st = this.shown();
    if (!st?.open) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.key === 'Enter') {
      if (e.altKey || e.metaKey) return; // Alt+Enter goes to the router (a peek's Open as tab)
      e.preventDefault();
      if (e.ctrlKey) {
        if (!e.shiftKey && !e.repeat) this.close(st, 'activate', { focusPage: true });
      } else this.step(st, e.shiftKey ? -1 : 1, true, e.repeat);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!e.repeat && plain && !e.shiftKey) this.b.escape();
    } else if (this.isAltC(e)) {
      e.preventDefault();
      if (!e.repeat) this.toggleCase(st);
    } else if (plain && !e.shiftKey && Object.hasOwn(SCROLL_KEYS, e.key)) {
      // Scroll the page without leaving the field: what the wheel would scroll at the middle of it.
      e.preventDefault();
      this.b.page(st.browser).send('find:scroll', { how: SCROLL_KEYS[e.key] });
    } else if (findBinding(keyInput(e))?.action === 'peekLink') {
      e.preventDefault();
      if (!e.repeat) void this.closeAndPeek(st);
    }
  }

  /** Keys on the face's buttons (Tab moved focus there): Alt+C still toggles match case. */
  private onButtonKey(e: KeyboardEvent): void {
    const st = this.shown();
    if (!st?.open || !this.isAltC(e)) return;
    e.preventDefault();
    if (!e.repeat) this.toggleCase(st);
  }

  /** Alt+C, never with Ctrl or AltGr, so AltGr+C still types. Letters follow the key's label. */
  private isAltC(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.getModifierState('AltGraph')) return false;
    return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() === 'c' : e.code === 'KeyC';
  }

  private focusChanged(): void {
    for (const v of [this.face, this.capsule] as View[]) if (v.mode !== 'hidden') v.setFocused(v.hasFocus());
  }

  /** The field menu: the editing rows plus Match case (Shift+F10 or the Menu key too). */
  private onMenu(e: MouseEvent): void {
    const menus = this.b.service('menus');
    const st = this.shown();
    if (!menus || !st) return;
    const view = this.viewOf(st);
    if (!view) return;
    // Not stopped: the menus module's own window listener sees that a menu was shown for it.
    e.preventDefault();
    const cmd = (label: string, key: string, icon: string | undefined, command: string): MenuItem => ({
      label,
      key,
      icon,
      disabled: !gk.commandEnabled(command),
      run: () => {
        view.input.focus();
        gk.editCommand(command);
      },
    });
    let edit: MenuItem[] | null = null;
    try {
      edit = menus.editItems?.(view.input) ?? null;
    } catch {
      edit = null;
    }
    edit ??= [
      cmd('Undo', 'Ctrl+Z', 'undo', 'cmd_undo'),
      cmd('Redo', 'Ctrl+Y', 'redo', 'cmd_redo'),
      { separator: true },
      cmd('Cut', 'Ctrl+X', 'cut', 'cmd_cut'),
      cmd('Copy', 'Ctrl+C', 'copy', 'cmd_copy'),
      cmd('Paste', 'Ctrl+V', 'paste', 'cmd_paste'),
      cmd('Select all', 'Ctrl+A', undefined, 'cmd_selectAll'),
    ];
    const items: MenuItem[] = [...edit, { separator: true }, { label: 'Match case', key: 'Alt+C', checked: st.matchCase, run: () => this.toggleCase(st) }];
    // A keyboard-opened menu (button 0) hangs from the field; a mouse one opens at the pointer.
    menus.show(items, e.button === 0 ? view.input : { x: e.clientX, y: e.clientY });
  }

  // ---- typing ----

  private onInput(): void {
    const st = this.shown();
    if (!st?.open) return;
    const view = this.viewOf(st);
    if (!view) return;
    this.typedSinceOpen = true;
    this.userTyped = true;
    st.query = view.input.value;
    if (st.query) this.windowQuery = st.query;
    if (this.composing) return; // searches when the composition ends
    this.scheduleSearch(st);
  }

  private onCompose(on: boolean): void {
    this.composing = on;
    const st = this.shown();
    if (st) this.viewOf(st)?.setComposing(on);
    // The composition's final text: search it now (an input event may or may not follow).
    if (!on) this.onInput();
  }

  /** One request per frame; a single character waits 150 ms for the next one. */
  private scheduleSearch(st: FindState): void {
    this.cancelTimers();
    if (!st.query) {
      this.search(st);
      return;
    }
    if (st.query.length === 1) this.holdTimer = window.setTimeout(() => this.search(st), ONE_CHAR_HOLD);
    else this.searchRaf = window.requestAnimationFrame(() => this.search(st));
    // Once typing pauses, the ring lands if the active match changed.
    this.pauseTimer = window.setTimeout(() => {
      if (!st.open || this.shown() !== st) return;
      if (!st.searched) this.landNext = 'ring';
      else if (st.ord > 0 || st.total === -1) void this.land(st, 'ring', true);
    }, TYPE_PAUSE_MS);
  }

  private cancelTimers(): void {
    window.cancelAnimationFrame(this.searchRaf);
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.pauseTimer);
  }

  // ---- the finder ----

  /** A new search for the current query (or clear everything for an empty field). */
  private search(st: FindState): void {
    if (!st.open) return;
    const shown = this.shown() === st;
    window.clearTimeout(st.flightTimer);
    window.clearTimeout(st.countTimer);
    st.inFlight = false;
    st.queued = 0;
    st.stepDir = 0;
    if (shown) {
      window.cancelAnimationFrame(this.searchRaf);
      window.clearTimeout(this.holdTimer);
      this.landNext = null;
      this.face.setUnder(false);
    }
    const finder = this.attach(st);
    if (!st.query) {
      try {
        finder?.removeSelection();
        finder?.highlight(false, '', false);
      } catch {
        /* no document */
      }
      if (st.pdf) gk.offerToViewer(st.browser, 'find', { query: '', caseSensitive: st.matchCase, findPrevious: false });
      st.session = null;
      st.ord = st.total = 0;
      st.searched = false;
      st.result = null;
      st.rect = null;
      if (shown) this.ring.cancel();
      this.refreshCount(st, null);
      return;
    }
    st.session = sessionKey(st);
    st.sessionAt = performance.now();
    st.searched = false;
    if (st.loading) st.rerun = true;
    // pdf.js takes the query when the page is its viewer (the event is cancelled).
    if (!gk.offerToViewer(st.browser, 'find', { query: st.query, caseSensitive: st.matchCase, findPrevious: false })) {
      st.pdf = true;
      return;
    }
    if (!finder) return;
    try {
      finder.caseSensitive = st.matchCase;
      finder.fastFind(st.query, false, false);
    } catch (e) {
      console.error('Deer find: search failed', e);
    }
  }

  private step(st: FindState, dir: Dir, fromKeys: boolean, repeat = false): void {
    if (!st.open || !st.query) return;
    const view = this.viewOf(st);
    const shown = this.shown() === st;
    if (fromKeys && view) view.echo(dir);
    if (st.session !== sessionKey(st)) {
      // Enter before the typed query went out: search now and land on its first match.
      this.search(st);
      if (shown) this.landNext = 'ring';
      return;
    }
    if (!st.searched) {
      // The session has not answered yet: land on its first match when it comes. Restart a lost one.
      if (performance.now() - st.sessionAt > LOST_SESSION_MS) this.search(st);
      if (shown) this.landNext = 'ring';
      return;
    }
    if (st.result === gk.FIND.NOTFOUND) {
      if (shown) view?.pulse();
      return;
    }
    if (st.inFlight) {
      st.queued = dir;
      return;
    }
    const now = performance.now();
    st.rapid = repeat || now - this.lastStepAt < RAPID_MS;
    this.lastStepAt = now;
    st.stepDir = dir;
    st.stepped = true;
    if (shown) {
      // Key repeat still keeps the match clear of the glass, but the ring waits for a pause.
      this.landNext = st.rapid ? 'guard' : 'ring';
      this.ring.cancel();
      this.face.setUnder(false);
    }
    st.inFlight = true;
    window.clearTimeout(st.flightTimer);
    st.flightTimer = window.setTimeout(() => this.settle(st), FLIGHT_MS);
    if (!gk.offerToViewer(st.browser, 'findagain', { query: st.query, caseSensitive: st.matchCase, findPrevious: dir < 0 })) {
      st.pdf = true;
      return;
    }
    try {
      const finder = this.attach(st);
      finder.caseSensitive = st.matchCase;
      finder.findAgain(st.query, dir < 0, false, false);
    } catch (e) {
      console.error('Deer find: step failed', e);
      this.settle(st);
    }
  }

  /** A step's answer came (or never will): send the step that was queued meanwhile. */
  private settle(st: FindState): void {
    if (!st.inFlight) return;
    st.inFlight = false;
    window.clearTimeout(st.flightTimer);
    const next = st.queued;
    st.queued = 0;
    if (next && st.open) this.step(st, next, false, true);
  }

  private onResult(st: FindState, d: { result?: unknown; findBackwards?: unknown; searchString?: unknown }): void {
    if (!st.open) return;
    const result = num(d.result);
    if (Number.isNaN(result)) return;
    // A result for a query the field no longer holds.
    if (typeof d.searchString === 'string' && d.searchString && d.searchString.toLowerCase() !== st.query.toLowerCase()) return;
    st.result = result;
    st.searched = true;
    st.lastResultAt = performance.now();
    const found = result === gk.FIND.FOUND || result === gk.FIND.WRAPPED;
    if (result === gk.FIND.NOTFOUND) {
      st.ord = 0;
      st.total = 0;
      st.final = true;
      st.rect = null;
    }
    st.foundBC = found ? gk.lastFoundContext(st.finder) : null;
    const view = this.viewOf(st);
    if (result === gk.FIND.WRAPPED && view) view.announce(d.findBackwards ? 'Wrapped to last match' : 'Wrapped to first match');
    // An authoritative count after the last result of a burst (verifier's correction 1), confirmed.
    st.countSettled = false;
    st.repairs = 0;
    st.repairSent = -1;
    window.clearTimeout(st.countTimer);
    if (found && !st.pdf) this.repairCount(st, COUNT_REPAIR_MS);
    this.refreshCount(st, null);
    if (st.inFlight) this.settle(st);
    // A queued step just went out: the ring waits for its answer, not this in-between match.
    if (st.inFlight) return;
    if (st.pendingStep && found) {
      const dir = st.pendingStep;
      st.pendingStep = 0;
      this.step(st, dir, false);
      return;
    }
    st.pendingStep = 0;
    const landing = this.landNext;
    if (landing && found && this.shown() === st) {
      this.landNext = null;
      void this.land(st, landing);
    } else if (!found && this.shown() === st) this.landNext = null;
  }

  private onCount(st: FindState, r: { current?: unknown; total?: unknown; limit?: unknown; searchString?: unknown }): void {
    if (!st.open) return;
    if (typeof r.searchString === 'string' && r.searchString && r.searchString.toLowerCase() !== st.query.toLowerCase()) return;
    const total = num(r.total);
    const current = num(r.current);
    if (Number.isNaN(total)) return;
    // A superseded request answers 0 of 0 while the last result was a hit (verifier's correction 1).
    if (!st.pdf && total === 0 && st.result !== gk.FIND.NOTFOUND) return;
    // The repair's answer stands until the next result: a late answer to an older request changes nothing.
    if (!st.pdf && st.countSettled) return;
    let shown = total;
    if (!st.pdf) {
      const key = sessionKey(st);
      const act = gk.finderActivity(st.finder);
      // The answer to the repair: asked with the frames idle, and nothing else asked since.
      const authoritative = st.repairSent !== -1 && (act ? act.sent === st.repairSent && act.outstanding === 0 : true);
      if (authoritative && st.result !== gk.FIND.NOTFOUND) {
        st.countSettled = true;
        st.repairSent = -1;
        window.clearTimeout(st.countTimer);
        st.trusted = { key, total };
      } else if (st.trusted?.key === key && total !== -1) {
        // A partial answer during a burst: never below what this query was last counted at.
        const t = st.trusted.total;
        if (t === -1 || t > total) shown = t;
      }
    }
    const prev = st.ord;
    st.total = shown;
    st.limit = num(r.limit) > 0 ? num(r.limit) : gk.matchesCountLimit();
    if (current > 0) st.ord = current;
    else if (total === 0) st.ord = 0;
    if (st.pdf) {
      // pdf.js counts page by page: "+" until the count settles.
      st.final = false;
      window.clearTimeout(st.pdfTimer);
      st.pdfTimer = window.setTimeout(() => {
        st.final = true;
        this.refreshCount(st, null);
      }, PDF_SETTLE);
    } else st.final = total !== -1;
    let roll: 'up' | 'down' | null = null;
    if (st.stepDir && prev > 0 && st.ord !== prev) {
      roll = st.rapid ? null : st.ord > prev ? 'up' : 'down';
      st.stepDir = 0;
    }
    this.refreshCount(st, roll);
  }

  /**
   * Ask for an authoritative count `ms` from now, once no query to the frames is out (asking while
   * a frame still counts supersedes that count and spoils this one; see the header). No answer at
   * all: ask again.
   */
  private repairCount(st: FindState, ms: number): void {
    window.clearTimeout(st.countTimer);
    if (st.pdf) return;
    st.countTimer = window.setTimeout(() => {
      if (!st.open || !st.query || st.result === gk.FIND.NOTFOUND || st.countSettled || st.repairs >= MAX_REPAIRS) return;
      const finder = this.attach(st);
      const act = gk.finderActivity(finder);
      if (act && act.outstanding > 0 && performance.now() - st.lastResultAt < COUNT_IDLE_CAP_MS) {
        this.repairCount(st, COUNT_POLL_MS);
        return;
      }
      st.repairs++;
      try {
        finder?.requestMatchesCount(st.query, { linksOnly: false });
      } catch {
        /* no document */
      }
      st.repairSent = act ? act.sent : 0;
      st.countTimer = window.setTimeout(() => this.repairCount(st, 0), COUNT_WATCHDOG_MS);
    }, ms);
  }

  /** What the counter says for a page. */
  private countView(st: FindState): CountView {
    if (!st.query) return { kind: 'blank', ord: 0, total: '', off: true };
    const none = st.searched && st.result === gk.FIND.NOTFOUND;
    if (none) return st.loading ? { kind: 'blank', ord: 0, total: '', off: true } : { kind: 'none', ord: 0, total: '', off: true };
    if (st.ord > 0 && (st.total > 0 || st.total === -1)) {
      const total = st.total === -1 ? `${fmt(st.limit || gk.matchesCountLimit())}+` : `${fmt(st.total)}${st.pdf && !st.final ? '+' : ''}`;
      return { kind: 'count', ord: st.ord, total, off: false };
    }
    return { kind: 'blank', ord: 0, total: '', off: false };
  }

  private refreshCount(st: FindState, roll: 'up' | 'down' | null): void {
    const view = this.viewOf(st);
    if (!view) return;
    // Until a new session answers, the counter keeps its last text.
    if (st.query && !st.searched && st.session) return;
    view.setCount(this.countView(st), roll);
  }

  // ---- pages: navigation, loading, scrolling ----

  private onNavigate(browser: XULBrowser, info: { url: string; sameDocument: boolean }): void {
    const st = this.states.get(browser);
    if (!st) return;
    if (info.sameDocument) {
      st.url = info.url;
      return;
    }
    const reload = !!st.url && stripHash(info.url) === stripHash(st.url);
    st.url = info.url;
    st.pdf = false;
    st.foundBC = null;
    st.trusted = null;
    st.session = null;
    st.ord = st.total = 0;
    st.searched = false;
    st.result = null;
    st.rect = null;
    if (!st.open) return;
    if (reload) {
      // Reload keeps the query and runs it again once the page has loaded. The new document is
      // armed (page events for the ring, the match colours, the scroll padding; page find.ts).
      st.rerun = true;
      this.b.page(browser).sendAll('find:armed', { on: true });
      this.refreshCount(st, null);
      return;
    }
    // Another document: find closes and keeps the query.
    this.close(st, 'keep', { focusPage: this.viewOf(st)?.hasFocus() ?? false, gone: true });
  }

  /**
   * The page's content process crashed ('tab-crashed'): its document, matches and count are gone,
   * as after a navigation to another document. Find closes and keeps the query (F3 or Ctrl+F after a
   * reload searches again).
   */
  private onCrash(browser: XULBrowser): void {
    const st = this.states.get(browser);
    if (!st) return;
    st.url = '';
    st.pdf = false;
    st.foundBC = null;
    st.trusted = null;
    st.session = null;
    st.ord = st.total = 0;
    st.searched = false;
    st.result = null;
    st.rect = null;
    if (st.open) this.close(st, 'keep', { focusPage: false, gone: true });
  }

  private onLoading(browser: XULBrowser, loading: boolean): void {
    const st = this.states.get(browser);
    if (!st) return;
    st.loading = loading;
    if (this.face.browser === browser && this.face.mode !== 'hidden') {
      const t = this.b.tabFor(browser);
      if (t) this.face.syncTab(t);
    }
    if (loading) {
      st.stepped = false;
      return;
    }
    // Frames (and a reloaded document's late decisions, such as the inset) are in by now.
    if (st.open) this.b.page(browser).sendAll('find:armed', { on: true });
    // One re-run when loading stops, unless the user has stepped or scrolled meanwhile.
    const rerun = st.rerun && st.open && !!st.query && !st.stepped;
    st.rerun = false;
    if (rerun) {
      st.pdf = st.pdf || gk.isPdfViewer(browser);
      this.search(st);
    } else this.refreshCount(st, null);
  }

  /** Scrolling, the wheel or a right-click send the ring away; find's own jump and the guard do not. */
  private onPageEvent(browser: XULBrowser, kind: 'scroll' | 'wheel' | 'menu'): void {
    const st = this.states.get(browser);
    if (!st?.open) return;
    const now = performance.now();
    const ours = kind === 'scroll' && (now - st.lastResultAt < OURS_MS || now - st.guardedAt < OURS_MS);
    if (!ours) st.stepped = true;
    if (this.shown() !== st) return;
    if (!ours && (kind !== 'scroll' || now - this.ring.shownAt > 150)) this.ring.cancel();
    if (!ours) this.face.setUnder(false);
  }

  /**
   * A tab left this window: closed, or moved to another window. A moved tab keeps its document and
   * its finder (FinderParent.swapBrowser), so its find is closed properly: no highlights, no armed
   * page module and no scroll-padding override are left in a page this window no longer shows.
   */
  private forget(browser: XULBrowser): void {
    const st = this.states.get(browser);
    if (!st) return;
    if (st.open) this.close(st, 'keep', { focusPage: false, instant: true });
    window.clearTimeout(st.countTimer);
    window.clearTimeout(st.pdfTimer);
    this.states.delete(browser);
  }

  // ---- where the match is: the landing ring and the scroll guard ----

  private zoom(browser: XULBrowser): number {
    try {
      return browser.fullZoom || 1;
    } catch {
      return 1;
    }
  }

  /** A rectangle in the top document's viewport (CSS px of the page) -> window coordinates. */
  private toWindow(browser: XULBrowser, r: Rect): Rect | null {
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return null;
    const box = browser.getBoundingClientRect();
    const z = this.zoom(browser);
    return { x: box.left + r.x * z, y: box.top + r.y * z, width: r.width * z, height: r.height * z };
  }

  /** The active match in window coordinates, carried up through out-of-process frames. */
  private async matchRect(st: FindState): Promise<{ rect: Rect; top: boolean } | null> {
    const topBC = st.browser.browsingContext;
    const bc = st.foundBC ?? topBC;
    if (!bc) return null;
    type Match = { rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null; via?: unknown };
    const m = await this.b.page(bc).query<Match>('find:match');
    if (!m?.rect) return null;
    let x = num(m.rect.x);
    let y = num(m.rect.y);
    const width = num(m.rect.width);
    const height = num(m.rect.height);
    let via = num(m.via);
    for (let i = 0; via > 0 && i < 8; i++) {
      const child = gk.contextById(via);
      const parent = child?.parent;
      if (!parent) return null;
      const off = await this.b.page(parent).query<{ x?: unknown; y?: unknown; via?: unknown } | null>('find:frame-offset', { child: via });
      if (!off) return null;
      x += num(off.x);
      y += num(off.y);
      via = num(off.via);
    }
    if (via !== 0) return null;
    const rect = this.toWindow(st.browser, { x, y, width, height });
    return rect ? { rect, top: bc === topBC } : null;
  }

  /** The id of the top document's frame that (perhaps through more frames) holds the active match, or 0. */
  private topFrameOf(st: FindState): number {
    const top = st.browser.browsingContext;
    let bc = st.foundBC;
    for (let i = 0; bc && i < 16; i++) {
      const parent = bc.parent;
      if (!parent) return 0;
      if (parent === top) return Number(bc.id) || 0;
      bc = parent;
    }
    return 0;
  }

  /** Where the visible chrome covers the page, inflated 12 px. */
  private chromeZones(): Rect[] {
    const zones: Rect[] = [];
    if (!this.barHidden()) {
      const l = this.b.bar.layout;
      zones.push({ x: l.left - 12, y: 0, width: l.right - l.left + 24, height: 12 + 44 + 12 });
      const ctl = document.getElementById('vitre-winctl')?.getBoundingClientRect();
      if (ctl && ctl.width) zones.push({ x: ctl.x - 12, y: 0, width: ctl.width + 24, height: ctl.bottom + 12 });
    } else {
      const f = this.face.rectNow();
      if (f) zones.push({ x: f.x - 12, y: 0, width: f.width + 24, height: f.bottom + 12 });
    }
    return zones;
  }

  /**
   * After a step: if the match is under the glass, scroll it clear (its top to y 92); on fixed or
   * sticky content the pill takes its parked tint instead. Then the ring lands ('ring' only).
   * onlyIfChanged: typing paused; the ring lands only if the active match moved.
   */
  private async land(st: FindState, how: Landing, onlyIfChanged = false): Promise<void> {
    if (st.pdf) return;
    const found = await this.matchRect(st);
    if (!found || !st.open || this.shown() !== st) return;
    let r = found.rect;
    const key = `${st.ord}:${Math.round(r.x)},${Math.round(r.y)}`;
    if (onlyIfChanged && key === st.ringKey) return;
    const peek = this.capsule.browser === st.browser;
    // A match in a frame is guarded by scrolling what holds that frame in the top document.
    const frame = found.top ? 0 : this.topFrameOf(st);
    if (!peek && (found.top || frame)) {
      const hit = this.chromeZones().some((z) => r.x < z.x + z.width && r.x + r.width > z.x && r.y < z.y + z.height && r.y + r.height > z.y);
      if (hit) {
        const zoom = this.zoom(st.browser);
        const dy = (r.y - GUARD_Y) / zoom;
        st.guardedAt = performance.now();
        const g = await this.b.page(st.browser).query<{ moved?: unknown; pinned?: unknown }>('find:guard', { dy, frame });
        if (!st.open || this.shown() !== st) return;
        if (g?.pinned === true) this.face.setUnder(true);
        else r = { ...r, y: r.y - (num(g?.moved) || 0) * zoom };
      }
    }
    st.rect = r;
    if (how !== 'ring') return;
    st.ringKey = `${st.ord}:${Math.round(r.x)},${Math.round(r.y)}`;
    const light = peek || this.b.root.classList.contains('theme-light');
    this.ring.show(r, light);
  }

  // ---- the active page ----

  /** F11 while finding: the face takes its own glass at once, and gives it back once the bar is in. */
  private syncGlass(): void {
    window.clearTimeout(this.glassTimer);
    if (this.face.mode !== 'open') return;
    if (this.barHidden()) this.face.setOwnGlass(true);
    else this.glassTimer = window.setTimeout(() => this.face.setOwnGlass(this.barHidden()), 340);
  }

  /** Keep the views on the topmost page: the pill face for a tab, the capsule for a peek. */
  private sync(): void {
    const tg = this.target();
    this.lastTarget = tg?.browser ?? null;
    const st = tg ? this.states.get(tg.browser) : undefined;
    const open = !!(tg && st?.open);
    const faceFor = open && tg && !tg.peek && tg.tab?.kind === 'web' ? tg.browser : null;
    const capFor = open && tg?.peek ? tg.browser : null;

    if (this.face.mode !== 'hidden' && this.face.browser !== faceFor) {
      // A face that is closing on this very tab finishes its morph.
      if (!(this.face.mode === 'closing' && tg && !tg.peek && this.face.browser === tg.browser)) {
        this.ring.cancel();
        window.clearTimeout(this.pauseTimer);
        this.landNext = null;
        this.face.hide('instant');
      }
    }
    if (this.capsule.mode !== 'hidden' && this.capsule.browser !== capFor) {
      this.ring.cancel();
      this.hideCapsule();
      // The sheet closed (or is being promoted): a peek without the 'vitre:peek' event is checked later.
      window.clearTimeout(this.orphanTimer);
      this.orphanTimer = window.setTimeout(() => this.dropOrphans(), ORPHAN_MS);
    }
    if (faceFor && st && tg?.tab) {
      if (this.face.mode === 'hidden') {
        this.prepare(this.face, st);
        this.face.show(tg.tab, 'restore', this.barHidden());
        this.focusChanged();
      } else if (this.face.browser === faceFor) {
        this.face.follow();
        this.face.syncTab(tg.tab);
        this.refreshCount(st, null);
      }
    }
    if (capFor && st) {
      const slot = this.slot();
      if (this.capsule.mode === 'hidden') {
        this.prepare(this.capsule, st);
        this.capsule.show(capFor, slot ?? { x: 0, y: 0, width: 440 }, false);
        this.focusChanged();
      } else if (slot) this.capsule.place(slot);
      this.lastSlot = slot ? `${Math.round(slot.x)},${Math.round(slot.y)},${Math.round(slot.width)}` : '';
    }
    this.armPoll();
  }

  /**
   * While a find is open and a peek is up, watch for the peek's header moving (the capsule follows
   * it) and for the sheet closing or being promoted without an event. Nothing runs otherwise: a peek
   * opening is announced ('vitre:peek'), and tab changes are tab events.
   */
  private pollNeeded(): boolean {
    return this.open.size > 0 && (this.capsule.mode !== 'hidden' || !!this.peekBrowser());
  }

  private armPoll(): void {
    if (!this.pollNeeded()) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = 0;
      return;
    }
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => {
      if (!this.pollNeeded()) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = 0;
        return;
      }
      const tg = this.target();
      const now = tg?.browser ?? null;
      let moved = false;
      if (this.capsule.mode !== 'hidden') {
        const slot = this.slot();
        const key = slot ? `${Math.round(slot.x)},${Math.round(slot.y)},${Math.round(slot.width)}` : '';
        moved = key !== this.lastSlot;
      }
      if (now !== this.lastTarget || moved) this.sync();
    }, POLL_MS);
  }
}
