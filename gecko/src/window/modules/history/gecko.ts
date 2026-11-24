// Every Firefox 157 internal the History panel uses, one small function each, with its source in
// reference/omni (the Settings rule: a runtime update is a checklist of this file).
//
//   places()                       PlacesUtils (gre/modules/PlacesUtils.sys.mjs)
//   readDb() / searchDb()          PlacesUtils.promiseDBConnection() (day pages, counts) and
//                                  promiseLargeCacheDBConnection() (search), both read-only clones of
//                                  the Places connection; favicons.sqlite is attached to both
//                                  (moz_pages_w_icons, moz_icons). conn.executeCached(sql, params).
//   ACM_MATCH / ACM_BEHAVIOR       mozIPlacesAutoComplete.MATCH_ANYWHERE_UNMODIFIED / BEHAVIOR_HISTORY,
//                                  the arguments of the SQL function AUTOCOMPLETE_MATCH as
//                                  gre/modules/PlacesQuery.sys.mjs searchHistory() passes them
//   observe(types, fn)             PlacesObservers.addListener / removeListener (dom/chrome-webidl/
//                                  PlacesObservers.webidl): page-visited, page-removed (both
//                                  spellings of isPartialVisistsRemoval, misspelled in 157:
//                                  History.sys.mjs notifyCleanup), page-title-changed, history-cleared
//   closedTabs() / closedWindows() SessionStore.getClosedTabData({ sourceWindow, private: false,
//                                  closedTabsFromAllWindows: true }) and getClosedWindowData()
//                                  (moz-src/browser/components/sessionstore/SessionStore.sys.mjs)
//   undoClose(id, window)          SessionStore.undoCloseById(closedId, includePrivate, targetWindow)
//   forgetTab(id, source) /        SessionStore.forgetClosedTabById(closedId, { sourceWindowId }) /
//   forgetWindow(id)               forgetClosedWindowById(closedId)
//   onClosedChanged(fn)            the observer topic sessionstore-closed-objects-changed
//   windowId()                     window.__SSi, SessionStore's id of this window (a closed tab's
//                                  sourceWindowId names its window with it)
//   copyText(text)                 nsIClipboardHelper.copyString
//   openWindowWith(urls, private)  BrowserWindowTracker.openWindow({ private, args }) with an
//                                  nsIArray of nsISupportsString: the window loads them as tabs
//                                  (browser/chrome/browser/content/browser/browser-init.js
//                                  _handleURIToLoad, gBrowser.loadTabs)
//   timeFormat() / dateFormat()    Services.intl.DateTimeFormat (mozIntl): the OS regional formats
//                                  (Windows' short time, its locale's dates), falling back to Intl
//   assistiveTech()                Services.appinfo.accessibilityEnabled (nsIXULRuntime): a screen
//                                  reader or another accessibility client is running
//   leaveElementFullscreen()       FullScreen.exitDomFullScreen (browser-fullScreenAndPointerLock.js)

let placesUtils: any = null;
/** PlacesUtils, gre/modules/PlacesUtils.sys.mjs. */
export const places = (): any => (placesUtils ??= ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils);

let readConn: Promise<any> | null = null;
let searchConn: Promise<any> | null = null;
/** The read-only clone for day pages, counts and the summary (PlacesUtils.promiseDBConnection). */
export const readDb = (): Promise<any> => (readConn ??= places().promiseDBConnection());
/** The read-only clone Firefox's address bar searches on (PlacesUtils.promiseLargeCacheDBConnection). */
export const searchDb = (): Promise<any> => (searchConn ??= places().promiseLargeCacheDBConnection());

/** mozIPlacesAutoComplete constants for AUTOCOMPLETE_MATCH (PlacesQuery.sys.mjs searchHistory). */
export const ACM_MATCH = (): number => Ci.mozIPlacesAutoComplete.MATCH_ANYWHERE_UNMODIFIED;
export const ACM_BEHAVIOR = (): number => Ci.mozIPlacesAutoComplete.BEHAVIOR_HISTORY;

/** A Places event as the panel reads it (PlacesVisit, PlacesVisitRemoved, PlacesVisitTitle, PlacesHistoryCleared). */
export interface PlacesEvent {
  type: 'page-visited' | 'page-removed' | 'page-title-changed' | 'history-cleared';
  url: string;
  guid: string;
  /** page-visited: the visit's time in ms, its transition and whether the page is hidden. */
  time: number;
  transition: number;
  hidden: boolean;
  /** page-visited: the title Places knows; page-title-changed: the new title. */
  title: string;
  /** page-removed: the page left the store (no visits, no bookmark). */
  removedFromStore: boolean;
  /** page-removed: some visits were removed and the page has others left. */
  partial: boolean;
}

const TYPES = ['page-visited', 'page-removed', 'page-title-changed', 'history-cleared'] as const;

/** Listen to Places (PlacesObservers.addListener); returns the remover. fn gets each batch as it came. */
export function observe(fn: (events: PlacesEvent[]) => void): () => void {
  const obs = (window as any).PlacesObservers;
  if (!obs) return () => undefined;
  const listener = (raw: any[]): void => {
    const out: PlacesEvent[] = [];
    for (const e of raw) {
      out.push({
        type: e.type,
        url: String(e.url ?? ''),
        guid: String(e.pageGuid ?? ''),
        time: Number(e.visitTime) || 0,
        transition: Number(e.transitionType) || 0,
        hidden: !!e.hidden,
        title: String(e.type === 'page-title-changed' ? (e.title ?? '') : (e.lastKnownTitle ?? '')),
        removedFromStore: !!e.isRemovedFromStore,
        // 157 spells it isPartialVisistsRemoval (History.sys.mjs notifyCleanup); a fixed spelling is read too.
        partial: !!(e.isPartialVisistsRemoval ?? e.isPartialVisitsRemoval),
      });
    }
    fn(out);
  };
  obs.addListener([...TYPES], listener);
  return () => {
    try {
      obs.removeListener([...TYPES], listener);
    } catch {
      /* the window is going */
    }
  };
}

const w = window as any;

/** A closed tab as SessionStore keeps it (TabStateData plus closedId, closedAt, sourceWindowId). */
export interface RawClosedTab {
  closedId: number;
  closedAt: number;
  sourceWindowId?: string;
  title?: string;
  state?: { entries?: { url?: string; title?: string }[]; index?: number; extData?: Record<string, string> };
}

/** A closed window (WindowStateData plus closedId, closedAt). */
export interface RawClosedWindow {
  closedId: number;
  closedAt: number;
  title?: string;
  selected?: number;
  tabs?: { entries?: { url?: string; title?: string }[]; index?: number; extData?: Record<string, string> }[];
}

/** Closed tabs of every open normal window (SessionStore.getClosedTabData), never a private window's. */
export function closedTabs(): RawClosedTab[] {
  try {
    return w.SessionStore.getClosedTabData({ sourceWindow: window, private: false, closedTabsFromAllWindows: true, closedTabsFromClosedWindows: false }) ?? [];
  } catch (e) {
    console.error('Deer history: could not read the closed tabs', e);
    return [];
  }
}

/** Closed windows (SessionStore.getClosedWindowData; SessionStore keeps none of a private window). */
export function closedWindows(): RawClosedWindow[] {
  try {
    return w.SessionStore.getClosedWindowData() ?? [];
  } catch (e) {
    console.error('Deer history: could not read the closed windows', e);
    return [];
  }
}

/** Reopen a closed tab (into this window) or window: SessionStore.undoCloseById. The tab or window, or null. */
export function undoClose(closedId: number): any {
  try {
    return w.SessionStore.undoCloseById(closedId, false, window) ?? null;
  } catch (e) {
    console.error('Deer history: could not reopen', e);
    return null;
  }
}

/** Forget a closed tab: SessionStore.forgetClosedTabById(closedId, { sourceWindowId }). */
export function forgetTab(closedId: number, sourceWindowId?: string): void {
  try {
    if (sourceWindowId) w.SessionStore.forgetClosedTabById(closedId, { sourceWindowId });
    else w.SessionStore.forgetClosedTabById(closedId, { includePrivate: false });
  } catch (e) {
    console.error('Deer history: could not forget a closed tab', e);
  }
}

/** Forget a closed window: SessionStore.forgetClosedWindowById. */
export function forgetWindow(closedId: number): void {
  try {
    w.SessionStore.forgetClosedWindowById(closedId);
  } catch (e) {
    console.error('Deer history: could not forget a closed window', e);
  }
}

/** SessionStore's id of this window (window.__SSi), which a closed tab's sourceWindowId names. */
export function windowId(): string {
  return String(w.__SSi ?? '');
}

/** Run fn whenever SessionStore's closed lists change (sessionstore-closed-objects-changed). */
export function onClosedChanged(fn: () => void): () => void {
  const observer = { observe: () => fn() };
  Services.obs.addObserver(observer, 'sessionstore-closed-objects-changed');
  return () => {
    try {
      Services.obs.removeObserver(observer, 'sessionstore-closed-objects-changed');
    } catch {
      /* already gone */
    }
  };
}

/** Plain text to the clipboard (nsIClipboardHelper). */
export function copyText(text: string): void {
  Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(String(text));
}

/** A new window with these pages as its tabs (BrowserWindowTracker.openWindow with an nsIArray of strings). */
export function openWindowWith(urls: string[], isPrivate: boolean): void {
  const args = Cc['@mozilla.org/array;1'].createInstance(Ci.nsIMutableArray);
  for (const url of urls) {
    const s = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
    s.data = url;
    args.appendElement(s);
  }
  const { BrowserWindowTracker } = ChromeUtils.importESModule('resource:///modules/BrowserWindowTracker.sys.mjs');
  BrowserWindowTracker.openWindow({ private: isPrivate, args });
}

/** A date formatter in the OS regional format (mozIntl), else the app locale's. */
function formatter(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    const Mozintl = (Services as any).intl?.DateTimeFormat;
    if (Mozintl) return new Mozintl(undefined, opts);
  } catch {
    /* fall back below */
  }
  return new Intl.DateTimeFormat(undefined, opts);
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** A cached formatter: 'time' (Windows' short time), or Intl options as JSON. */
export function dateFormat(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = formats.get(key);
  if (!f) {
    f = formatter(opts);
    formats.set(key, f);
  }
  return f;
}

/** A count in the OS locale's digits and grouping ("1,284"). */
export function number(n: number): string {
  try {
    const Mozintl = (Services as any).intl?.NumberFormat;
    if (Mozintl) return new Mozintl(undefined).format(n);
  } catch {
    /* fall back below */
  }
  return n.toLocaleString();
}

/** A screen reader or another accessibility client is running (nsIXULRuntime.accessibilityEnabled). */
export function assistiveTech(): boolean {
  try {
    return !!Services.appinfo.accessibilityEnabled;
  } catch {
    return false;
  }
}

/** Leave a page element's full screen (FullScreen.exitDomFullScreen, browser-fullScreenAndPointerLock.js). */
export function leaveElementFullscreen(): void {
  try {
    if (w.FullScreen?.exitDomFullScreen) w.FullScreen.exitDomFullScreen();
    else if (document.fullscreenElement) void document.exitFullscreen();
  } catch (e) {
    console.error('Deer history: could not leave element full screen', e);
  }
}
