// Every Firefox 157 internal the window core touches, each behind one small function with its
// source file under gecko/reference/omni, so a runtime update is a checklist: re-check this file.
// Feature modules keep their own internals in their own folder, in the same style.
//
// All of these run in a browser.xhtml window, where Firefox's globals (gBrowser, BrowserCommands,
// SessionWindowUI, FullZoom...) are window properties.

const w = window as any;
const doc = document;

/** gBrowser: gre/moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs (created by Tabbrowser.create). */
const gb = (): any => w.gBrowser;

export const systemPrincipal = (): unknown => Services.scriptSecurityManager.getSystemPrincipal();

/** Principal and context options a page-derived load must carry (names as gBrowser.addTab / openLinkIn take them). */
export interface LoadPrincipals {
  triggeringPrincipal?: unknown;
  originPrincipal?: unknown;
  originStoragePrincipal?: unknown;
  /** An nsIReferrerInfo, or its serialized form (E10SUtils.serializeReferrerInfo). */
  referrerInfo?: unknown;
  /** An nsIPolicyContainer, or its serialized form. */
  policyContainer?: unknown;
  userContextId?: number;
  openerBrowser?: XULBrowser | null;
}

// ---- tabs (Tabbrowser.sys.mjs) ----

/** All <tab> elements in bar order, including hidden and closing ones. `get tabs()`. */
export const tabNodes = (): XULTab[] => Array.from(gb().tabs);

/** The element that dispatches TabOpen, TabClose, TabSelect, TabMove, TabAttrModified, TabShow, TabHide, TabPinned, TabUnpinned. */
export const tabContainer = (): HTMLElement => gb().tabContainer;

/**
 * Tab events on tabContainer (Tabbrowser.sys.mjs, tabbrowser/content/tab.js):
 * `sync` change the list (open, close, move, hide, show); `select` is TabSelect; `changed` carry
 * one tab's attribute or state change (TabAttrModified: label, image, busy, soundplaying, muted...;
 * TabBrowserDiscarded: the tab was unloaded).
 */
export const TAB_EVENTS = {
  sync: ['TabOpen', 'TabClose', 'TabMove', 'TabShow', 'TabHide'],
  select: 'TabSelect',
  changed: ['TabAttrModified', 'TabPinned', 'TabUnpinned', 'TabBrowserDiscarded'],
};

export const selectedTab = (): XULTab => gb().selectedTab;
export const selectedBrowser = (): XULBrowser => gb().selectedBrowser;

/** `set selectedTab`. Dispatches TabSelect synchronously. */
export function selectTab(node: XULTab): void {
  gb().selectedTab = node;
}

/**
 * Open a tab. Without `principals.triggeringPrincipal` this is addTrustedTab(uri, options): the
 * system principal, for user-typed and Deer-chosen URLs only (it loads chrome:, file: and
 * about:config). With one it is addTab(uri, options) with that principal, so a page-derived URL is
 * checked like a link the page clicked (a web principal cannot load chrome: or file:).
 * tabIndex is an index into `tabs` (hidden tabs count). Dispatches TabOpen synchronously, after
 * the tab is in the list. Tabbrowser.sys.mjs addTab / addTrustedTab.
 */
export function addTab(url: string, opts: { background: boolean; tabIndex?: number; principals?: LoadPrincipals; options?: Record<string, unknown> }): XULTab {
  const common = { inBackground: opts.background, tabIndex: opts.tabIndex, skipAnimation: true, ...opts.options };
  const p = opts.principals;
  if (!p?.triggeringPrincipal) return gb().addTrustedTab(url, common);
  return gb().addTab(url, {
    ...common,
    triggeringPrincipal: p.triggeringPrincipal,
    originPrincipal: p.originPrincipal,
    originStoragePrincipal: p.originStoragePrincipal,
    referrerInfo: referrerInfoOf(p.referrerInfo),
    policyContainer: policyContainerOf(p.policyContainer),
    userContextId: p.userContextId,
    openerBrowser: p.openerBrowser ?? undefined,
    allowInheritPrincipal: true,
  });
}

/**
 * A tab that took Firefox's preloaded new-tab page (NewTabPagePreloading; on for Deer's Home, see
 * VitreStartup.useHomeAsNewTab) keeps its initial label "New Tab": the page set its title before the
 * tab existed, so no title change follows. setTabTitle(tab) reads browser.contentTitle
 * (Tabbrowser.sys.mjs). Does nothing for a tab whose page has no title yet.
 */
export function titleFromLoadedPage(node: XULTab): void {
  try {
    const title = node.linkedBrowser?.contentTitle;
    if (title && title !== node.label) gb().setTabTitle(node);
  } catch {
    /* the browser is not ready: its own title change will come */
  }
}

/** removeTab(tab, { animate }). Closing the last tab closes the window (browser.tabs.closeWindowWithLastTab). */
export function removeTab(node: XULTab, opts: { skipSessionStore?: boolean } = {}): void {
  // skipSessionStore: the tab never enters the closed-tab list (SessionStore onTabClose is skipped).
  gb().removeTab(node, { animate: false, skipSessionStore: !!opts.skipSessionStore });
}

/**
 * hideTab(tab, source): hidden tabs stay alive but leave Deer's bar (a peek is a hidden tab).
 * Pinned or selected tabs cannot be hidden. The source is kept by SessionStore as the custom tab
 * value "hiddenBy" and restored with the tab (Tabbrowser.sys.mjs hideTab, restoreTab).
 */
export function hideTab(node: XULTab, source: string): void {
  gb().hideTab(node, source);
}

export function showTab(node: XULTab): void {
  gb().showTab(node);
}

export const tabForBrowser = (browser: XULBrowser): XULTab | null => gb().getTabForBrowser(browser) ?? null;

/** moveTabBefore / moveTabAfter(tab, target). */
export function moveTab(node: XULTab, target: XULTab, where: 'before' | 'after'): void {
  if (where === 'before') gb().moveTabBefore(node, target);
  else gb().moveTabAfter(node, target);
}

/** replaceTabWithWindow(tab): tears the tab off into a new window; returns that window. */
export function moveTabToNewWindow(node: XULTab): Window | null {
  return gb().replaceTabWithWindow(node) ?? null;
}

/** tab.toggleMuteAudio() (tabbrowser/content/tab.js): mute or unmute the tab's sound. */
export function toggleMute(node: XULTab): void {
  node.toggleMuteAudio();
}

/**
 * The tab's state as Deer's Tab mirrors it. Attributes set by tabbrowser's progress listener and
 * tab.js: busy (loading), pending (restored, not loaded yet), crashed, soundplaying, muted;
 * node.pinned and node.label.
 */
export function tabState(node: XULTab): { loading: boolean; deferred: boolean; crashed: boolean; audible: boolean; muted: boolean; pinned: boolean; title: string } {
  return {
    loading: node.hasAttribute('busy'),
    deferred: node.hasAttribute('pending'),
    crashed: node.hasAttribute('crashed'),
    audible: node.hasAttribute('soundplaying'),
    muted: node.hasAttribute('muted'),
    pinned: !!node.pinned,
    title: node.label ?? '',
  };
}

/** Last time the tab was selected (tab.js lastAccessed; MAX for the selected tab). */
export const tabLastAccessed = (node: XULTab): number => (node.selected ? Number.MAX_SAFE_INTEGER : Number(node.lastAccessed) || 0);

/**
 * addTabsProgressListener: every tab's web progress. onLocationChange(browser, webProgress, request,
 * location, flags), onStateChange(browser, webProgress, request, stateFlags, status).
 * webProgress is null in onProgressChange (spikes/shell verifier): do not use that hook for filtering.
 */
export function addTabsProgressListener(listener: object): () => void {
  gb().addTabsProgressListener(listener);
  return () => {
    try {
      gb().removeTabsProgressListener(listener);
    } catch {
      /* window is closing */
    }
  };
}

/**
 * A page's content process died under one of this window's <browser>s (tabs and hidden tabs alike):
 * the trusted "oop-browser-crashed" / "oop-browser-buildid-mismatch" event Firefox's own handler
 * listens for (Tabbrowser.sys.mjs onTabCrashed; SessionStore.sys.mjs onBrowserCrashed), top frames
 * only. `fn` runs after Firefox's handling (a task later): the selected tab then shows Firefox's
 * crashed page, any other browser is left non-remote on about:blank until something reloads it.
 */
export function onBrowserCrashed(fn: (browser: XULBrowser) => void): () => void {
  const listener = (e: Event): void => {
    const ev = e as Event & { isTopFrame?: boolean; originalTarget?: EventTarget };
    if (!e.isTrusted || ev.isTopFrame === false) return;
    const browser = (ev.originalTarget ?? e.target) as XULBrowser;
    if ((browser as unknown as Element)?.localName !== 'browser') return;
    window.setTimeout(() => {
      try {
        fn(browser);
      } catch (err) {
        console.error('Deer: crash handler failed', err);
      }
    }, 0);
  };
  const types = ['oop-browser-crashed', 'oop-browser-buildid-mismatch'];
  for (const type of types) window.addEventListener(type, listener, true);
  return () => {
    for (const type of types) window.removeEventListener(type, listener, true);
  };
}

/**
 * May a page's principal load this address at all (a web page never reaches file:, chrome: or
 * about:config)? The check contentAreaUtils.js urlSecurityCheck makes
 * (gre/chrome/toolkit/content/global/contentAreaUtils.js): nsIScriptSecurityManager
 * .checkLoadURIStrWithPrincipal, here with DISALLOW_INHERIT_PRINCIPAL as openLinkIn loads it.
 */
export function principalMayLoad(principal: unknown, url: string): boolean {
  try {
    Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(principal, url, Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the parent process knows about a frame's document (its WindowGlobalParent:
 * documentPrincipal, documentURI, cookieJarSettings; browser/actors/ContextMenuParent.sys.mjs reads
 * the same three for its menu). Never what the page says about itself. Null without a document.
 */
export function frameLoadData(browsingContext: any): { principal: unknown; documentURI: any; cookieJarSettings: unknown } | null {
  try {
    const wgp = browsingContext?.currentWindowGlobal;
    if (!wgp?.documentPrincipal || !wgp.documentURI) return null;
    return { principal: wgp.documentPrincipal, documentURI: wgp.documentURI, cookieJarSettings: wgp.cookieJarSettings ?? null };
  } catch {
    return null;
  }
}

/** The favicon Firefox resolved for the tab: always a data:, chrome: or moz-remote-image: URL on 157, safe as an <img src>. */
export const tabIcon = (node: XULTab): string | null => node.getAttribute('image') || null;

/**
 * The tab's URL. A restored tab that has not loaded yet ("pending") has a real browser sitting on
 * about:blank; its URL is in the session data: SessionStore.getTabState(tab) -> JSON with entries[]
 * and a 1-based index (sessionstore/SessionStore.sys.mjs).
 * While a load is on its way the address is browser.userTypedValue: gBrowser.addTab sets it to the
 * URL "so it'll be available till the document successfully loads" (Tabbrowser.sys.mjs addTab),
 * Deer's navigate() does the same (setPendingUrl), and tabbrowser's progress listener clears it
 * when the load commits or fails. Deer never renders Firefox's address bar, so a value here is
 * always a load Deer or Firefox started, never text the user left in a field. One exception: on a
 * search engine's results page Firefox's search-terms persistence writes the search terms there
 * (SmartbarInput.mjs #handlePersistedSearchTerms: `this.userTypedValue = state.persist.searchTerms`),
 * so only a value that parses as an absolute URL counts as the pending address.
 */
export function tabUrl(node: XULTab): string {
  if (node.hasAttribute('pending')) {
    try {
      const state = JSON.parse(w.SessionStore.getTabState(node));
      const entry = state.entries?.[(state.index || state.entries.length) - 1];
      if (entry?.url) return entry.url;
    } catch {
      /* no session data: fall through */
    }
  }
  try {
    const browser = node.linkedBrowser;
    const typed = browser?.userTypedValue;
    if (typeof typed === 'string' && typed && !isInitialPage(typed) && pendingAddress(typed)) return typed;
    return browser?.currentURI?.spec ?? '';
  } catch {
    return '';
  }
}

/**
 * A userTypedValue that is a load's address (an absolute URL of a scheme a tab loads), not persisted
 * search terms (see tabUrl): "c++:templates" or "todo:list" parse as URLs but are no address. The
 * terms are switched off at the source too (pref browser.urlbar.showSearchTerms.enabled false in
 * tools/runtime-overlay/defaults/pref/vitre-prefs.js); this stays as the second line.
 */
const PENDING_SCHEMES = /^(https?|file|about|chrome|resource|moz-extension|moz-src|view-source|data|blob|jar|ftp):/i;
const pendingAddress = (typed: string): boolean => PENDING_SCHEMES.test(typed) && URL.canParse(typed);

/** The address a load that has not committed yet is for (browser-custom-element.mjs userTypedValue). */
export function setPendingUrl(browser: XULBrowser, url: string): void {
  browser.userTypedValue = url;
}

/**
 * A load has been asked for but no document has arrived yet: the browser still sits on its initial
 * page while userTypedValue holds the address (the gap between addTab / loadURI and the first
 * progress event, or a server that has not answered). Such a tab counts as loading. A restored tab
 * that has not loaded ("pending" attribute) is not: it loads when shown.
 */
export function hasPendingLoad(node: XULTab): boolean {
  if (node.hasAttribute('pending')) return false;
  try {
    const browser = node.linkedBrowser;
    const typed = browser?.userTypedValue;
    if (typeof typed !== 'string' || !typed || isInitialPage(typed)) return false;
    const current = browser.currentURI?.spec ?? '';
    return !current || isInitialPage(current);
  } catch {
    return false;
  }
}

/** browser.js gInitialPages: the blank pages a new tab may start on (about:blank, about:newtab, about:home...). */
export const isInitialPage = (url: string): boolean => !!w.gInitialPages?.includes?.(url);

/** The page a new tab opens: browser.js BROWSER_NEW_TAB_URL (AboutNewTab.newTabURL; about:privatebrowsing in private windows). */
export const newTabUrl = (): string => w.BROWSER_NEW_TAB_URL || 'about:blank';

/**
 * browser.fixupAndLoadURIString(uri, { triggeringPrincipal }): toolkit/content/widgets/browser-custom-element.mjs.
 * System principal: for user-typed and Deer-chosen URLs only.
 */
export function loadURI(browser: XULBrowser, url: string): void {
  browser.fixupAndLoadURIString(url, { triggeringPrincipal: systemPrincipal() });
}

/**
 * openLinkIn(url, where, params): browser/chrome/browser/content/browser/utilityOverlay.js ->
 * browser/modules/URILoadingHelper.sys.mjs. The call ClickHandlerParent makes for a link the page
 * clicked (browser/actors/ClickHandlerParent.sys.mjs contentAreaClick), so a page-derived URL loads
 * with the page's principal, referrer, policy container and container. `where`: current | tab |
 * tabshifted | window | save. A triggering principal is mandatory.
 */
export function openLinkIn(url: string, where: 'current' | 'tab' | 'tabshifted' | 'window' | 'save', params: LoadPrincipals & Record<string, unknown>): void {
  w.openLinkIn(url, where, {
    ...params,
    triggeringPrincipal: params.triggeringPrincipal ?? systemPrincipal(),
    referrerInfo: referrerInfoOf(params.referrerInfo),
    policyContainer: policyContainerOf(params.policyContainer),
    openerBrowser: params.openerBrowser ?? undefined,
  });
}

let e10s: any = null;
const e10sUtils = (): any => (e10s ??= ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs').E10SUtils);
/** A referrer info object from either form (gre/modules/E10SUtils.sys.mjs deserializeReferrerInfo). */
function referrerInfoOf(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? undefined;
  try {
    return e10sUtils().deserializeReferrerInfo(value);
  } catch {
    return undefined;
  }
}
/** A policy container from either form (E10SUtils.deserializePolicyContainer). */
function policyContainerOf(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? undefined;
  try {
    return e10sUtils().deserializePolicyContainer(value);
  } catch {
    return undefined;
  }
}

/**
 * Pages that call window.open() or follow a target=_blank link reach the window's nsIBrowserDOMWindow
 * (browser/modules/BrowserDOMWindow.sys.mjs: class BrowserDOMWindow, one instance per window with
 * `win`, created by setupInWindow; createContentWindowInFrame / openURIInFrame are called from
 * ContentParent::CommonCreateWindow), with browser.link.open_newwindow.restriction = 0 also the sized
 * popups. window.browserDOMWindow is an XPConnect wrapper (its properties cannot be written), so the
 * class prototype is patched once per process and dispatches to the hook of the window the instance
 * belongs to. `fn` sees every such request first; returning true cancels it (the content process
 * gets no window: window.open returns null). aURI is the page the new window will load, or null for
 * window.open('').
 */
export function interceptWindowOpen(fn: (request: { url: string; where: number; params: any; name: string }) => boolean): void {
  w.vitreWindowOpenHook = fn;
  const { BrowserDOMWindow } = ChromeUtils.importESModule('resource:///modules/BrowserDOMWindow.sys.mjs');
  const proto = BrowserDOMWindow.prototype;
  if (proto.vitreIntercepted) return;
  proto.vitreIntercepted = true;
  for (const method of ['createContentWindowInFrame', 'openURIInFrame']) {
    const original = proto[method];
    if (typeof original !== 'function') continue;
    proto[method] = function (this: any, aURI: any, aParams: any, aWhere: number, aFlags: number, aName: string) {
      try {
        const hook = this.win?.vitreWindowOpenHook;
        if (hook && aWhere !== Ci.nsIBrowserDOMWindow.OPEN_PRINT_BROWSER && hook({ url: aURI?.spec ?? '', where: aWhere, params: aParams, name: aName ?? '' })) return null;
      } catch (e) {
        console.error('Deer: window.open interception failed', e);
      }
      return original.call(this, aURI, aParams, aWhere, aFlags, aName);
    };
  }
}
/** nsIBrowserDOMWindow.OPEN_NEWTAB_BACKGROUND / _FOREGROUND (dom/interfaces/base/nsIBrowserDOMWindow.idl). */
export const openWhere = (): { background: number; foreground: number } => ({ background: Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_BACKGROUND, foreground: Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_FOREGROUND });
/** browser.tabs.loadDivertedInBackground: whether window.open / target=_blank tabs open behind (BrowserDOMWindow.sys.mjs). */
export const divertedLoadsInBackground = (): boolean => Services.prefs.getBoolPref('browser.tabs.loadDivertedInBackground', false);

// ---- commands (browser/chrome/browser/content/browser/browser-commands.js, browser.js) ----

/**
 * Reload a page. For the selected tab this is BrowserCommands.reload / reloadSkipCache (which also
 * handles view-source and multi-selected tabs); for any other browser (a peek) it is
 * browser.reloadWithFlags (toolkit/content/widgets/browser-custom-element.mjs).
 */
export function reload(browser?: XULBrowser, skipCache = false): void {
  if (!browser || browser === selectedBrowser()) {
    if (skipCache) w.BrowserCommands.reloadSkipCache();
    else w.BrowserCommands.reload();
    return;
  }
  const nav = Ci.nsIWebNavigation;
  browser.reloadWithFlags(skipCache ? nav.LOAD_FLAGS_BYPASS_PROXY | nav.LOAD_FLAGS_BYPASS_CACHE : nav.LOAD_FLAGS_NONE);
}
/** BrowserCommands.stop() for the selected tab; browser.stop() for any other browser. */
export function stop(browser?: XULBrowser): void {
  if (!browser || browser === selectedBrowser()) w.BrowserCommands.stop();
  else browser.stop();
}
/** F11 full screen: toggles window.fullScreen. */
export const toggleFullScreen = (): void => w.BrowserCommands.fullScreen();
/** Runs Firefox's close checks (beforeunload), then window.close(). */
export const closeWindow = (): void => w.BrowserCommands.tryToCloseWindow();
/**
 * A new browser window. Without a URL: browser.js OpenBrowserWindow(options) -> BrowserWindowTracker.openWindow,
 * which opens the home page (about:privatebrowsing for a private window). With one: openLinkIn(url,
 * "window", params) (URILoadingHelper openInWindow), with the principals given or the system one.
 */
export function newWindow(opts: { private?: boolean; url?: string; principals?: LoadPrincipals } = {}): void {
  if (opts.url) {
    openLinkIn(opts.url, 'window', { ...opts.principals, private: !!opts.private });
    return;
  }
  w.OpenBrowserWindow({ private: !!opts.private });
}
/**
 * The most recent browser window that is not a popup (toolbar.visible), of this privacy kind:
 * browser/modules/BrowserWindowTracker.sys.mjs getTopWindow({ private, allowPopups: false }).
 */
export function topBrowserWindow(isPrivate: boolean): Window | null {
  try {
    const { BrowserWindowTracker } = ChromeUtils.importESModule('resource:///modules/BrowserWindowTracker.sys.mjs');
    return BrowserWindowTracker.getTopWindow({ private: isPrivate, allowPopups: false }) ?? null;
  } catch {
    return null;
  }
}
/** BrowserCommands.viewSource(browser): opens view-source: in a new tab next to the page. */
export const viewSource = (browser: XULBrowser): void => w.BrowserCommands.viewSource(browser);

/** A <command> or <key> element of browser.xhtml, run the way its shortcut would (browser-sets.js). */
export function doCommand(id: string): boolean {
  const el = doc.getElementById(id) as any;
  if (!el) return false;
  el.doCommand();
  return true;
}
/** PrintUtils.startPrintWindow(browsingContext): gre/chrome/toolkit/content/global/printUtils.js (the tab-modal print preview). */
export function print(browser?: XULBrowser): boolean {
  const bc = (browser ?? selectedBrowser()).browsingContext;
  if (!bc) return false;
  w.PrintUtils.startPrintWindow(bc);
  return true;
}
/** saveBrowser(browser): gre/chrome/toolkit/content/global/contentAreaUtils.js ("Save page as", with the Windows dialog). */
export function savePage(browser?: XULBrowser): boolean {
  w.saveBrowser(browser ?? selectedBrowser());
  return true;
}
/**
 * Developer tools for the selected tab. The <key> elements are added by
 * browser/modules/DevToolsStartup.sys.mjs (hookKeyShortcuts) next to #mainKeyset after delayed
 * startup; Deer parks them (parkKeysets) and runs them by id: toggle, console, element picker.
 */
export const toggleDevTools = (): boolean => doCommand('key_toggleToolboxF12');
export const devToolsConsole = (): boolean => doCommand('key_webconsole');
export const devToolsInspect = (): boolean => doCommand('key_inspector');

/** Reopen the last closed tab, else window, else session: sessionstore/SessionWindowUI.sys.mjs. */
export function reopenClosed(): void {
  w.SessionWindowUI.restoreLastClosedTabOrWindowOrSession(window);
}

/** Closed tabs Ctrl+Shift+T can bring back in this window: SessionStore.getClosedTabCountForWindow. */
export function closedTabCount(): number {
  try {
    return Number(w.SessionStore.getClosedTabCountForWindow(window)) || 0;
  } catch {
    return 0;
  }
}

/** Forget every closed tab of this window (SessionStore.forgetClosedTab(window, 0), repeated). */
export function forgetClosedTabs(): void {
  try {
    const ss = w.SessionStore;
    for (let n = closedTabCount(); n > 0; n--) ss.forgetClosedTab(window, 0);
  } catch (e) {
    console.error('Deer: forgetClosedTabs failed', e);
  }
}

/** SessionStore.setCustomTabValue / getCustomTabValue / deleteCustomTabValue: a string saved and restored with the tab. */
export function setTabValue(node: XULTab, key: string, value: string | null): void {
  if (value === null) w.SessionStore.deleteCustomTabValue(node, key);
  else w.SessionStore.setCustomTabValue(node, key, value);
}
export function getTabValue(node: XULTab, key: string): string {
  try {
    return String(w.SessionStore.getCustomTabValue(node, key) ?? '');
  } catch {
    return '';
  }
}

/** SSWindowRestored on the window: session restore has put this window's tabs back (SessionStore.sys.mjs). */
export function onSessionRestored(fn: () => void): () => void {
  window.addEventListener('SSWindowRestored', fn);
  return () => window.removeEventListener('SSWindowRestored', fn);
}

/**
 * Quit the application the way Firefox's own Exit does: observers of quit-application-requested may
 * cancel, then nsIAppStartup.quit(eAttemptQuit) closes every window (the session is saved).
 * gre/chrome/toolkit/content/global/globalOverlay.js goQuitApplication(event).
 */
export function quit(): boolean {
  return !!w.goQuitApplication({});
}

// ---- zoom (browser/chrome/browser/content/browser/tabbrowser/browser-fullZoom.js, toolkit viewZoomOverlay.js ZoomManager) ----

/**
 * FullZoom.enlarge / reduce / reset(browser = selected): each returns a promise that resolves once
 * the zoom is applied. With browser.zoom.siteSpecific (Firefox's default, the design's "per site")
 * the level is stored for the site and every tab on that site follows.
 */
export const zoomIn = (browser?: XULBrowser): Promise<void> => Promise.resolve(w.FullZoom.enlarge(browser));
export const zoomOut = (browser?: XULBrowser): Promise<void> => Promise.resolve(w.FullZoom.reduce(browser));
export const zoomReset = (browser?: XULBrowser): Promise<void> => Promise.resolve(w.FullZoom.reset(browser));
export function zoomOf(browser: XULBrowser): number {
  try {
    return w.ZoomManager.getZoomForBrowser(browser) || 1;
  } catch {
    return 1;
  }
}
/** FullZoom fires "FullZoomChange" on the <browser> whose zoom changed (browser-fullZoom.js _notifyOnLocationChange / onZoomChange). */
export function onFullZoomChange(fn: (browser: XULBrowser) => void): () => void {
  const changed = (e: Event): void => {
    const browser = e.target as XULBrowser | null;
    if (browser?.localName === 'browser') fn(browser);
  };
  window.addEventListener('FullZoomChange', changed, true);
  return () => window.removeEventListener('FullZoomChange', changed, true);
}

// ---- keyboard (src/window/keys.ts; recipe and corrections in spikes/keys/RESULT.md) ----

/**
 * Make Firefox's own shortcuts inert: move every <key> out of its <keyset> into a hidden box, then
 * re-bind the (now empty) keyset, because Gecko caches a keyset's handlers when it is bound.
 * document.getElementById('key_...') keeps resolving, so Firefox's code and doCommand() still work.
 * #mainKeyset itself stays (DevToolsStartup.hookKeyShortcuts inserts next to it). Keysets whose id
 * starts with "ext-keyset-id-" belong to extension commands and are left alone
 * (gre/modules/ExtensionShortcuts.sys.mjs). A MutationObserver gives keysets added later
 * (DevTools, CustomKeys) the same treatment.
 * Source of the ids: browser/chrome/browser/content/browser/browser.xhtml (browser-sets.inc).
 * Returns the number of keys parked now.
 */
export function parkKeysets(): number {
  const main = doc.getElementById('mainKeyset');
  const home = main?.parentNode ?? doc.documentElement;
  let grave = doc.getElementById('vitre-dead-keys') as any;
  if (!grave) {
    grave = (doc as any).createXULElement('box');
    grave.id = 'vitre-dead-keys';
    grave.hidden = true;
    home.appendChild(grave);
  }
  const strip = (keyset: Element): number => {
    if (keyset.id.startsWith('ext-keyset-id-')) return 0;
    const keys = Array.from(keyset.querySelectorAll('key'));
    if (!keys.length) return 0;
    for (const key of keys) grave.appendChild(key);
    const parent = keyset.parentNode;
    const next = keyset.nextSibling;
    if (parent) {
      keyset.remove();
      parent.insertBefore(keyset, next);
    }
    return keys.length;
  };
  let parked = 0;
  for (const keyset of Array.from(doc.querySelectorAll('keyset'))) {
    if (keyset.parentElement?.closest('keyset')) continue; // nested keysets go with their parent
    parked += strip(keyset);
  }
  if (!w.vitreKeysetObserver) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if ((node as Element).localName === 'keyset') strip(node as Element);
        }
      }
    });
    observer.observe(home, { childList: true });
    if (home !== doc.documentElement) observer.observe(doc.documentElement, { childList: true });
    w.vitreKeysetObserver = observer;
  }
  return parked;
}

let shortcutUtils: any = null;
/**
 * The tab action Firefox's tabbox and tabbrowser would run for this key on their own (Ctrl+Tab,
 * Ctrl+PageUp/Down, Ctrl+Shift+PageUp/Down, Ctrl+F4, F7), or null. It ignores the Windows key,
 * which is why the router has to hide these events from the system group even when it does not
 * match them itself. gre/modules/ShortcutUtils.sys.mjs getSystemActionForEvent.
 */
export function systemAction(e: KeyboardEvent): unknown {
  try {
    shortcutUtils ??= ChromeUtils.importESModule('resource://gre/modules/ShortcutUtils.sys.mjs').ShortcutUtils;
    return shortcutUtils.getSystemActionForEvent(e) ?? null;
  } catch {
    return null;
  }
}

/**
 * Firefox's own handler for hardware browser keys and mouse side buttons (WM_APPCOMMAND arrives as
 * an "AppCommand" event on the window): browser-init.js adds HandleAppCommandEvent (browser.js) in
 * the capture phase at load. Deer's listener is registered earlier and stops the event; this
 * removes Firefox's one as well.
 */
export function dropAppCommandHandler(): void {
  try {
    window.removeEventListener('AppCommand', w.HandleAppCommandEvent, true);
  } catch {
    /* not registered yet */
  }
}

/**
 * A prompt owns the keyboard: a tab-modal dialog over the selected page (alert / confirm / prompt,
 * HTTP auth, print preview: TabDialogBox in browser.js sets "tabDialogShowing" on the <browser>) or a
 * window-modal one (gDialogBox sets "window-modal-open" on the root).
 */
export function dialogShowing(): boolean {
  try {
    return selectedBrowser().hasAttribute('tabDialogShowing') || windowModalOpen();
  } catch {
    return false;
  }
}
/** A tab-modal dialog over one particular page (a peek's, which is not the selected tab): the same attribute. */
export function browserDialogShowing(browser: XULBrowser): boolean {
  try {
    return browser.hasAttribute('tabDialogShowing');
  } catch {
    return false;
  }
}
/** A window-modal dialog (gDialogBox, browser.js) is open: "window-modal-open" on the root. */
export const windowModalOpen = (): boolean => doc.documentElement.hasAttribute('window-modal-open');

/**
 * Element full screen with keyboard lock (element.requestFullscreen({ keyboardLock: 'browser' }),
 * dom.fullscreen.keyboard_lock.enabled): the chrome document's fullscreenElement is the <browser>
 * and fullscreenKeyboardLock says "browser". Same test as gre/modules/KeyboardLockUtils.sys.mjs.
 */
export function keyboardLocked(): boolean {
  const d = doc as any;
  return !!d.fullscreenElement && d.fullscreenKeyboardLock === 'browser';
}

/** F11 window full screen or element full screen. */
export const inFullScreen = (): boolean => !!window.fullScreen || !!doc.fullscreenElement;

/** A page element is full screen: the root carries inDOMFullscreen (browser-fullScreenAndPictureInPicture.js, FullScreen.enterDomFullscreen). */
export const inDOMFullscreen = (): boolean => doc.documentElement.hasAttribute('inDOMFullscreen');

/** Element full screen ended: "MozDOMFullscreen:Exited" on the chrome window (browser/actors/DOMFullscreenParent.sys.mjs). */
export function onDOMFullscreenExit(fn: () => void, once = false): () => void {
  window.addEventListener('MozDOMFullscreen:Exited', fn, { once });
  return () => window.removeEventListener('MozDOMFullscreen:Exited', fn);
}

/**
 * Keep one of Deer's fields focused through a tab switch. With e10s the tab switcher calls
 * gBrowser._adjustFocusBeforeTabSwitch (which blurs whatever chrome element has focus) and
 * _adjustFocusAfterTabSwitch when the new tab's page is ready to show, which can be well after the
 * switch (Tabbrowser.sys.mjs, AsyncTabSwitcher.sys.mjs updateDisplay). While `owns()` is true both
 * do nothing. Wrapped once per window.
 */
export function guardTabSwitchFocus(owns: () => boolean): void {
  const g = gb();
  if (!g) return;
  if (g.vitreFocusGuards) {
    g.vitreFocusGuards.push(owns);
    return;
  }
  const guards: (() => boolean)[] = [owns];
  g.vitreFocusGuards = guards;
  const held = (): boolean =>
    guards.some((fn) => {
      try {
        return fn();
      } catch {
        return false;
      }
    });
  for (const name of ['_adjustFocusBeforeTabSwitch', '_adjustFocusAfterTabSwitch']) {
    const original = g[name];
    if (typeof original !== 'function') continue;
    g[name] = function (this: unknown, ...args: unknown[]) {
      if (held()) return undefined;
      return original.apply(this, args);
    };
  }
}

/**
 * Focus that lands nowhere is retargeted to #urlbar-input (the root's retargetdocumentfocus
 * attribute, browser.xhtml); that field is not rendered, so the retarget is dropped.
 */
export function dropFocusRetarget(): void {
  doc.documentElement.removeAttribute('retargetdocumentfocus');
}

/** browser.js openLocation(): what Firefox's own Ctrl+L / Alt+D and "open location" callers run. */
export function takeOverOpenLocation(fn: () => void): void {
  w.openLocation = fn;
}

/**
 * The window title. gBrowser.getWindowTitleForBrowser(browser) (Tabbrowser.sys.mjs) builds
 * "<page title> — <brand>" with an em dash and updateTitlebar() writes it to document.title on
 * every tab switch and title change. `fn` replaces the builder for this window.
 */
export function takeOverWindowTitle(fn: (browser: XULBrowser) => string): void {
  const g = gb();
  if (!g) return;
  g.getWindowTitleForBrowser = (browser: XULBrowser): string => {
    try {
      return fn(browser);
    } catch {
      return 'Deer';
    }
  };
  try {
    g.updateTitlebar();
  } catch {
    /* no selected browser yet */
  }
}

/**
 * Permission doorhangers (gre/modules/PopupNotifications.sys.mjs) are hidden while
 * PopupNotifications._shouldSuppress() says so and shown again when anchorVisibilityChange() is
 * called; Firefox's own rule hides them while its address bar is being edited (browser.js
 * shouldSuppress). `fn` adds Deer's condition. Needs delayed startup (PopupNotifications is lazy).
 */
export function suppressDoorhangersWhile(fn: () => boolean): void {
  const pn = w.PopupNotifications;
  if (!pn || pn.vitreSuppress) return;
  pn.vitreSuppress = true;
  const original = pn._shouldSuppress;
  pn._shouldSuppress = (): boolean => {
    try {
      if (fn()) return true;
    } catch {
      /* fall through */
    }
    return !!original.call(pn);
  };
}
/** The permission doorhanger panel (browser.xhtml <panel id="notification-popup">, owned by PopupNotifications). */
export const DOORHANGER_ID = 'notification-popup';
/** Re-evaluate doorhanger suppression and anchors now (PopupNotifications.anchorVisibilityChange). */
export function refreshDoorhangers(): void {
  try {
    w.PopupNotifications?.anchorVisibilityChange();
  } catch {
    /* not up yet */
  }
}
/**
 * The anchor doorhangers hang from. PopupNotifications asks _getVisibleAnchorElement(anchor) for
 * "the same anchor element if it is visible, or a fallback" (PopupNotifications.sys.mjs _showPanel).
 */
export function setDoorhangerAnchor(fn: (requested: Element | null) => Element | null): void {
  w.PopupNotifications._getVisibleAnchorElement = fn;
}
/**
 * browser-pageActions.js panelAnchorNodeForAction throws when none of its candidates is rendered,
 * so the Ctrl+D bookmark editor would neither open nor save.
 */
export function setPageActionAnchor(fn: () => Element | null): void {
  w.BrowserPageActions.panelAnchorNodeForAction = fn;
}

// ---- window ----

export const isPrivate = (): boolean => w.PrivateBrowsingUtils.isWindowPrivate(window);
/** A window.open() popup: browser-init.js sets the popup-window root attribute. */
export const isPopup = (): boolean => doc.documentElement.hasAttribute('popup-window');
export const isMaximized = (): boolean => w.windowState === w.STATE_MAXIMIZED;

/**
 * The window's state as the root attributes say it (browser.js, browser-fullScreenAndPictureInPicture.js):
 * sizemode="maximized", inFullscreen (F11), inDOMFullscreen (a page element).
 */
export function windowState(): { maximized: boolean; fullscreen: boolean; domFullscreen: boolean } {
  const root = doc.documentElement;
  return { maximized: root.getAttribute('sizemode') === 'maximized', fullscreen: root.hasAttribute('inFullscreen'), domFullscreen: root.hasAttribute('inDOMFullscreen') };
}
/** The attributes windowState() reads, for a MutationObserver. */
export const WINDOW_STATE_ATTRIBUTES = ['sizemode', 'inFullscreen', 'inDOMFullscreen'];

/**
 * The window's HWND as a hex string: nsIBaseWindow.nativeHandle (xpcom idl; the same call
 * tools/spike-lib.js uses for captures).
 */
export function nativeHandle(): string {
  return w.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
}

interface User32 {
  ReleaseCapture: () => unknown;
  PostMessageW: (...args: unknown[]) => unknown;
  IsWindow: (hwnd: unknown) => unknown;
  hwnd: () => unknown;
}
let user32: User32 | null = null;

/** user32.dll through js-ctypes (gre/modules/ctypes.sys.mjs), declared once per window. */
function win32(): User32 {
  if (!user32) {
    const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const lib = ctypes.open('user32.dll');
    user32 = {
      ReleaseCapture: lib.declare('ReleaseCapture', ctypes.winapi_abi, ctypes.int32_t),
      PostMessageW: lib.declare('PostMessageW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t),
      IsWindow: lib.declare('IsWindow', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
      hwnd: () => ctypes.voidptr_t(ctypes.UInt64(nativeHandle())),
    };
  }
  return user32;
}

/** Whether a native window move can be started: user32 is reachable and the HWND is this window's. */
export function canMoveWindow(): boolean {
  try {
    const u = win32();
    return !!u.IsWindow(u.hwnd());
  } catch {
    return false;
  }
}

/**
 * Start a native window move from script, as if the caption had been grabbed at this screen point
 * (CSS px, as in MouseEvent.screenX/Y). window.beginWindowMove does not exist on Windows in 157, so
 * this is the borderless-window recipe: give up Gecko's mouse capture, then post WM_NCLBUTTONDOWN /
 * HTCAPTION and Windows runs its own move loop, with Aero Snap and drag-restore from maximized
 * (spikes/shell/RESULT.md, recipe correction 4; the WM_SYSCOMMAND form leaves :active stuck).
 * Call it from a mousemove while the left button is down, never without a real button press:
 * Windows would wait for a click to end the move.
 */
export function beginWindowMove(screenX: number, screenY: number): boolean {
  try {
    const u = win32();
    const dpr = window.devicePixelRatio;
    const lParam = ((Math.round(screenY * dpr) & 0xffff) << 16) | (Math.round(screenX * dpr) & 0xffff);
    const WM_NCLBUTTONDOWN = 0x00a1;
    const HTCAPTION = 2;
    u.ReleaseCapture();
    return !!u.PostMessageW(u.hwnd(), WM_NCLBUTTONDOWN, HTCAPTION, lParam);
  } catch (e) {
    console.error('Deer: window move failed', e);
    return false;
  }
}

/** The parent side of the VitrePage actor for one frame (src/actors/VitrePageParent.sys.ts). */
export interface PageActor {
  send(name: string, data?: unknown): void;
  query(name: string, data?: unknown): Promise<any>;
}

/** The page-side actor of a frame (src/actors/VitrePageParent.sys.ts), or null while it has none (pending tab). */
export function pageActor(browsingContext: any): PageActor | null {
  try {
    return browsingContext?.currentWindowGlobal?.getActor('VitrePage') ?? null;
  } catch {
    return null;
  }
}

/**
 * A compositor snapshot of part of a page: WindowGlobalParent.drawSnapshot(rect, scale,
 * backgroundColor) -> ImageBitmap (dom/chrome-webidl/WindowGlobalActors.webidl). `rect` is in CSS
 * pixels of the browser's box (what the user sees); null = the whole visible area. For a remote
 * browser the visible area is the default; an in-process page (Home, about: pages) needs an explicit
 * rect in document coordinates, so the scroll position is added here (spikes/switcher/RESULT.md).
 * The scale is applied to CSS pixels of the page, so it is multiplied by the zoom to keep the
 * bitmap the same size at any zoom. A page with no background of its own (about:blank) is
 * transparent: what the user sees there is the tab panel's background (.browserContainer), which
 * follows the colour scheme, so that is the background colour. Call bitmap.close() when done.
 */
export async function snapshot(browser: XULBrowser, rect: { x: number; y: number; width: number; height: number } | null, scale: number): Promise<ImageBitmap | null> {
  const wg = browser.browsingContext?.currentWindowGlobal;
  if (!wg) return null;
  const box = browser.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const zoom = browser.fullZoom || 1;
  const container = browser.closest('.browserContainer');
  const behind = container ? getComputedStyle(container).backgroundColor : '';
  const background = behind && behind !== 'rgba(0, 0, 0, 0)' ? behind : 'white';
  if (!browser.isRemoteBrowser) {
    const cw = browser.contentWindow;
    if (!cw) return null;
    const r = rect ?? { x: 0, y: 0, width: box.width, height: box.height };
    const area = new DOMRect(cw.scrollX + r.x / zoom, cw.scrollY + r.y / zoom, r.width / zoom, r.height / zoom);
    return wg.drawSnapshot(area, scale * zoom, background);
  }
  // A remote browser renders its visible area (the verified path); the part asked for is cut out.
  const whole: ImageBitmap = await wg.drawSnapshot(null, scale * zoom, background);
  if (!rect) return whole;
  try {
    const x = Math.max(0, Math.floor(rect.x * scale));
    const y = Math.max(0, Math.floor(rect.y * scale));
    const width = Math.min(whole.width - x, Math.max(1, Math.ceil(rect.width * scale)));
    const height = Math.min(whole.height - y, Math.max(1, Math.ceil(rect.height * scale)));
    if (width <= 0 || height <= 0) return null;
    return await createImageBitmap(whole, x, y, width, height);
  } finally {
    whole.close();
  }
}

/**
 * Mean luma (0..1, Rec. 709) of a rectangle of a page (CSS pixels of the browser's box, as
 * snapshot()). The snapshot is taken at 1/4 scale: at 1/16 text-heavy pages rasterise far darker
 * than they look (13 px text on white read 0.52 instead of 0.85), at 1/4 the reading is within a
 * few hundredths of the full-size one.
 */
export async function luma(browser: XULBrowser, rect: { x: number; y: number; width: number; height: number }): Promise<number | null> {
  const bitmap = await snapshot(browser, rect, 1 / 4);
  if (!bitmap) return null;
  try {
    if (!bitmap.width || !bitmap.height) return null;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4) / 255;
  } finally {
    bitmap.close();
  }
}

/** Mean luma of the strip of the page under the bar (the window's top `height` px between `left` and `right`). */
export function lumaUnderBar(browser: XULBrowser, strip: { left: number; right: number; height: number }): Promise<number | null> {
  const box = browser.getBoundingClientRect();
  const left = Math.max(0, strip.left - box.left);
  const right = Math.min(box.width, strip.right - box.left);
  if (right <= left) return Promise.resolve(null);
  return luma(browser, { x: left, y: 0, width: right - left, height: strip.height });
}

/** Import one of Deer's singletons (chrome://vitre/content/modules/<Name>.sys.mjs exports <Name>). */
export function sysModule(name: string): any {
  return ChromeUtils.importESModule(`chrome://vitre/content/modules/${name}.sys.mjs`)[name];
}
