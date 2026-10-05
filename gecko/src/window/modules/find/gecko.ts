// Firefox 157 internals used by find in page. Each one sits behind one small function naming its
// source in reference/omni, so a runtime update is a checklist.
//
//   finderOf(browser)            browser.finder: FinderParent for a remote page, Finder in process
//                                (gre/chrome/toolkit/content/global/elements/browser-custom-element.mjs
//                                `get finder()`; the object differs with isRemoteBrowser, so callers
//                                re-read it at every use and move their listener when it changes)
//   lastFoundContext(finder)     FinderParent._lastFoundBrowsingContext: the frame that holds the active
//                                match (gre/modules/FinderParent.sys.mjs)
//   finderActivity(finder)       FinderParent.sendQueryToContext, wrapped once per FinderParent: how many
//                                queries to the frames' FinderChild actors are out and how many were
//                                sent (gre/modules/FinderParent.sys.mjs; every Finder:Find,
//                                Finder:UpdateHighlightAndMatchCount and Finder:MatchesCount goes through
//                                it). A count asked while a frame is still counting supersedes that
//                                count, and the frame answers the later request with nothing or a
//                                part (gre/modules/Finder.sys.mjs requestMatchesCount, FinderIterator.start)
//   takeOverFindCommands(fn)     window.gLazyFindCommand, the one door to the native <findbar>
//                                (browser/chrome/browser/content/browser/browser.js; browser-sets.js and
//                                CustomizableWidgets call it)
//   silenceContentShortcut()     sharedData "Findbar:Shortcut": FindBarChild (gre/moz-src/toolkit/actors/
//                                FindBarChild.sys.mjs eventMatchesFindShortcut) passes every keypress to
//                                the parent after the find key until the native findbar has focus; a key
//                                that can never match keeps typing in the page
//   releasePassThrough(browser)  "Findbar:UpdateState" to the FindBar actor (FindBarChild receiveMessage)
//   setMatchColours()            LookAndFeel prefs for the active match (ui.textSelectAttention*) and the
//                                other matches (ui.textHighlight*); widget/LookAndFeel, spike vitre-find.js
//   installStandIn(hooks)        gBrowser.getCachedFindBar / getFindBar return a detached stand-in per
//                                tab (Tabbrowser.sys.mjs). pdf.js binds to it (gre/chrome/pdfjs/content/
//                                PdfJsParent.sys.mjs _hookupEventListeners, _updateControlState,
//                                _updateMatchesCount) and TranslationsParent reads `.hidden` and listens
//                                for findbaropen / findbarclose (gre/actors/TranslationsParent.sys.mjs).
//                                isFindBarInitialized stays false, so tabbrowser's own findbar paths
//                                (tab switch, remoteness change, sanitize, full screen) stay off.
//   editCommand / commandEnabled goDoCommand's controller lookup (gre/chrome/toolkit/content/global/
//                                globalOverlay.js)
//   framePrincipal(bc)           WindowGlobalParent.documentPrincipal, for a link found in a frame
//   checkLoad(principal, url)    nsIScriptSecurityManager.checkLoadURIStrWithPrincipal (the recipe's
//                                Ctrl+Q check, spikes/pagefeatures/RESULT.md)

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

export const FIND = {
  get FOUND(): number {
    return Ci.nsITypeAheadFind.FIND_FOUND;
  },
  get NOTFOUND(): number {
    return Ci.nsITypeAheadFind.FIND_NOTFOUND;
  },
  get WRAPPED(): number {
    return Ci.nsITypeAheadFind.FIND_WRAPPED;
  },
  get PENDING(): number {
    return Ci.nsITypeAheadFind.FIND_PENDING;
  },
};

/** The finder of a <browser> right now (see the header: re-read it at every use). */
export function finderOf(browser: XULBrowser): any {
  try {
    return browser.finder ?? null;
  } catch {
    return null;
  }
}

/** The frame that holds the active match, or null (in-process pages, nothing found yet). */
export function lastFoundContext(finder: any): any {
  try {
    const bc = finder?._lastFoundBrowsingContext ?? null;
    return bc && !bc.isDiscarded ? bc : null;
  } catch {
    return null;
  }
}

export interface FinderActivity {
  /** Queries to the frames not answered yet. */
  outstanding: number;
  /** Queries sent so far. */
  sent: number;
}

const activity = new WeakMap<object, FinderActivity>();

/**
 * The finder's traffic to its frames (see the header), or null for an in-process Finder (no
 * frames to ask). The wrapper is installed on first use and stays with the FinderParent, which moves
 * with its document (swapBrowser).
 */
export function finderActivity(finder: any): FinderActivity | null {
  if (!finder || typeof finder.sendQueryToContext !== 'function') return null;
  let a = activity.get(finder);
  if (a) return a;
  const state: FinderActivity = { outstanding: 0, sent: 0 };
  const original = finder.sendQueryToContext;
  try {
    finder.sendQueryToContext = function (this: unknown, ...args: unknown[]) {
      state.sent++;
      state.outstanding++;
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(original.apply(this, args));
      } catch (e) {
        state.outstanding--;
        throw e;
      }
      const done = (): void => {
        state.outstanding = Math.max(0, state.outstanding - 1);
      };
      p.then(done, done);
      return p;
    };
  } catch {
    return null;
  }
  activity.set(finder, state);
  a = state;
  return a;
}

/** Firefox's find commands (cmd_find, the toolbar button, find selection) run `fn` instead. */
export function takeOverFindCommands(fn: (cmd: string, arg?: unknown) => void): void {
  w.gLazyFindCommand = async (cmd: string, ...args: unknown[]) => fn(cmd, args[0]);
}

let silenced = false;
/** Process-wide, idempotent: content never waits for a native findbar after Ctrl+F. */
export function silenceContentShortcut(): void {
  if (silenced) return;
  silenced = true;
  try {
    const { sharedData } = Services.ppmm;
    sharedData.set('Findbar:Shortcut', { key: '￿', shiftKey: true, ctrlKey: true, altKey: true, metaKey: true });
    sharedData.flush();
  } catch (e) {
    console.error('Deer find: could not silence the content find shortcut', e);
  }
}

/** A page that already put itself in pass-through mode (FindBarContent.start) lets keys go again. */
export function releasePassThrough(browser: XULBrowser): void {
  try {
    (browser as any).sendMessageToActor('Findbar:UpdateState', { findMode: 0, isOpenAndFocused: true, hasQuickFindTimeout: false }, 'FindBar', 'all');
  } catch {
    /* no FindBar actor in this document */
  }
}

let coloured = false;
/**
 * The design's match colours: yellow rgb(255,255,0) for every match, orange rgb(255,150,50) for the
 * active one, black text. Default branch only, so nothing is written to the profile. The page module
 * pins the "others" pair per document (Gecko swaps it on light pages; src/actors/page/find.ts).
 */
export function setMatchColours(): void {
  if (coloured) return;
  coloured = true;
  try {
    const d = Services.prefs.getDefaultBranch('');
    d.setStringPref('ui.textSelectAttentionBackground', '#ff9632');
    d.setStringPref('ui.textSelectAttentionForeground', '#000000');
    d.setStringPref('ui.textHighlightBackground', '#ffff00');
    d.setStringPref('ui.textHighlightForeground', '#000000');
    d.setBoolPref('findbar.highlightAll', true);
    d.setBoolPref('findbar.modalHighlight', false);
  } catch (e) {
    console.error('Deer find: could not set the match colours', e);
  }
}

/** accessibility.typeaheadfind.matchesCountLimit (gre/modules/Finder.sys.mjs matchesCountLimit). */
export function matchesCountLimit(): number {
  try {
    return Services.prefs.getIntPref('accessibility.typeaheadfind.matchesCountLimit', 1000);
  } catch {
    return 1000;
  }
}

// ---- the findbar stand-in (PDF viewer, translations) ----

export interface StandInHooks {
  /** pdf.js answered a find: PdfJsParent calls findbar.updateControlState(result, findPrevious). */
  result(browser: XULBrowser, result: number, findPrevious: boolean): void;
  /** pdf.js counted: findbar.onMatchesCountResult({ current, total, limit }). */
  count(browser: XULBrowser, r: { current: number; total: number; limit: number }): void;
}

export interface StandIn extends EventTarget {
  hidden: boolean;
  readonly browser: XULBrowser;
}

const standIns = new WeakMap<XULTab, StandIn>();
let hooks: StandInHooks | null = null;

function standInFor(tab: XULTab): StandIn {
  let s = standIns.get(tab);
  if (s) return s;
  // A XUL box that is never attached: only an EventTarget with the members its callers use.
  const box = (document as any).createXULElement('box');
  box.hidden = true;
  Object.defineProperty(box, 'browser', { get: () => tab.linkedBrowser, set() {}, configurable: true });
  box.updateControlState = (result: number, findPrevious: boolean) => hooks?.result(tab.linkedBrowser, Number(result), !!findPrevious);
  box.onMatchesCountResult = (r: any) => hooks?.count(tab.linkedBrowser, { current: Number(r?.current) || 0, total: Number(r?.total) || 0, limit: Number(r?.limit) || 0 });
  box.onFindResult = () => {};
  box.onHighlightFinished = () => {};
  box.onCurrentSelection = () => {};
  box.close = () => {};
  box.clear = () => {};
  s = box as StandIn;
  standIns.set(tab, s);
  return s;
}

/** Per window: tabbrowser hands out a stand-in instead of creating a native <findbar>. */
export function installStandIn(h: StandInHooks): void {
  hooks = h;
  const g = w.gBrowser;
  if (!g || g.vitreFindStandIn) return;
  g.vitreFindStandIn = true;
  g.getCachedFindBar = function (this: any, tab: XULTab = this.selectedTab) {
    if (!tab) return null;
    return (tab as any)._findBar || standInFor(tab);
  };
  g.getFindBar = async function (this: any, tab: XULTab = this.selectedTab) {
    if (!tab || (tab as any).closing) return null;
    return (tab as any)._findBar || standInFor(tab);
  };
}

/** The stand-in of the tab a browser belongs to (tabs and peeks are both real tabs), or null. */
export function standInOf(browser: XULBrowser): StandIn | null {
  try {
    const tab = w.gBrowser.getTabForBrowser(browser);
    return tab ? standInFor(tab) : null;
  } catch {
    return null;
  }
}

/**
 * Tell whoever listens on the stand-in (pdf.js) about a find, as the native findbar does
 * (findbar.js _dispatchFindEvent). Returns false when a listener took it (pdf.js preventDefaults
 * the events it handles): the finder must not run then.
 */
export function offerToViewer(browser: XULBrowser, type: 'find' | 'findagain' | 'findcasesensitivitychange' | 'findhighlightallchange', detail: { query: string; caseSensitive: boolean; findPrevious: boolean }): boolean {
  const s = standInOf(browser);
  if (!s) return true;
  try {
    const event = new CustomEvent(type, {
      bubbles: true,
      cancelable: true,
      detail: { query: detail.query, caseSensitive: detail.caseSensitive, matchDiacritics: false, entireWord: false, highlightAll: true, findPrevious: detail.findPrevious },
    });
    return s.dispatchEvent(event);
  } catch {
    return true;
  }
}

/** findbaropen / findbarclose on the stand-in, and its hidden flag (TranslationsParent, pdf.js). */
export function announceOpen(browser: XULBrowser, open: boolean): void {
  const s = standInOf(browser);
  if (!s) return;
  s.hidden = !open;
  try {
    s.dispatchEvent(new Event(open ? 'findbaropen' : 'findbarclose', { bubbles: true, cancelable: true }));
  } catch {
    /* nobody listens */
  }
}

/** The pdf.js viewer: its document principal is resource://pdf.js/web/viewer.html (see src/actors/page/pdf.ts). */
export function isPdfViewer(browser: XULBrowser): boolean {
  try {
    const spec: string = browser.contentPrincipal?.spec ?? '';
    return spec.startsWith('resource://pdf.js/');
  } catch {
    return false;
  }
}

// ---- editing commands for the field menu ----

function controllerFor(cmd: string): any {
  try {
    return (document as any).commandDispatcher.getControllerForCommand(cmd);
  } catch {
    return null;
  }
}

export function commandEnabled(cmd: string): boolean {
  try {
    return !!controllerFor(cmd)?.isCommandEnabled(cmd);
  } catch {
    return false;
  }
}

export function editCommand(cmd: string): void {
  try {
    const c = controllerFor(cmd);
    if (c?.isCommandEnabled(cmd)) c.doCommand(cmd);
  } catch (e) {
    console.error('Deer find: edit command failed', cmd, e);
  }
}

// ---- links found by find (Ctrl+Q) ----

export function framePrincipal(bc: any): any {
  try {
    return bc?.currentWindowGlobal?.documentPrincipal ?? null;
  } catch {
    return null;
  }
}

export function checkLoad(principal: any, url: string): boolean {
  try {
    Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(principal, url, Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
    return true;
  } catch {
    return false;
  }
}

/** BrowsingContext.get(id) (dom/chrome-webidl/BrowsingContext.webidl). */
export function contextById(id: number): any {
  try {
    return (globalThis as any).BrowsingContext.get(id) ?? null;
  } catch {
    return null;
  }
}
