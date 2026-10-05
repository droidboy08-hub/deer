// Every Firefox 157 internal Peek touches, each behind one small function with the file it comes
// from (under gecko/reference/omni), so a runtime update is a checklist for this file.
// Recipe: spikes/pagefeatures/RESULT.md, PEEK and the verifier's corrections 11-17.
import { INSET_OFF_KEY } from '../../../shared/geometry';

const w = window as any;
/** gBrowser: gre/moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs. */
const gb = (): any => w.gBrowser;

/** #tabbrowser-tabpanels (Tabbrowser.sys.mjs `tabpanels`): the panels of every tab, all absolutely placed (content-area.css .browserSidebarContainer). */
export const tabpanels = (): HTMLElement => gb().tabpanels;

/** A tab's panel (.browserSidebarContainer, id = tab.linkedPanel): the element a peek shows as its sheet. */
export const panelOf = (node: XULTab): HTMLElement | null => document.getElementById(node.linkedPanel);

export const selectedTab = (): XULTab => gb().selectedTab;

/**
 * Keep a page that is not the selected tab rendering and running: gBrowser.activateBrowserForPrintPreview
 * adds it to _printPreviewBrowsers, which AsyncTabSwitcher.shouldDeactivateDocShell leaves active
 * (AsyncTabSwitcher.sys.mjs). Nothing in 157 calls deactivatePrintPreviewBrowsers outside print
 * preview (verifier correction 16); split view's splitViewBrowsers is the fallback if this goes.
 */
export function keepActive(browser: XULBrowser): void {
  gb().activateBrowserForPrintPreview(browser);
}

/** Undo keepActive: out of _printPreviewBrowsers, and active only if the tab switcher says so (Tabbrowser.shouldActivateDocShell). */
export function letSleep(browser: XULBrowser): void {
  const g = gb();
  try {
    g._printPreviewBrowsers.delete(browser);
  } catch {
    /* gone */
  }
  try {
    browser.docShellIsActive = !!g.shouldActivateDocShell(browser);
  } catch {
    /* the browser went away */
  }
}

/**
 * Close a peek's tab for good without leaving it in the closed-tab list (Ctrl+Shift+T brings a peek
 * back only while it is warm) and without a beforeunload prompt for a page the user already left:
 * removeTab(tab, { skipSessionStore, skipPermitUnload }) (Tabbrowser.sys.mjs removeTab ->
 * SessionStore onTabClose is skipped).
 */
export function removeQuietly(node: XULTab): void {
  try {
    if (!node.closing && node.isConnected) gb().removeTab(node, { animate: false, skipSessionStore: true, skipPermitUnload: true });
  } catch (e) {
    console.error('Deer peek: could not remove the peek tab', e);
  }
}

/**
 * A peek's tab that Firefox closed by itself (a load that became a download closes the blank tab it
 * was opened for, the page called window.close()) went into the closed-tab list like any tab.
 * Entries whose tab carried the session value `key` (b.openHidden marks every hidden tab with
 * "vitre-hidden", browser.ts HIDDEN_TAB_VALUE) are forgotten: SessionStore.getClosedTabDataForWindow
 * (each entry has closedId and state.extData) and forgetClosedTabById(closedId, window)
 * (sessionstore/SessionStore.sys.mjs).
 */
export function forgetClosedMarked(key: string): number {
  const ss = w.SessionStore;
  let forgotten = 0;
  try {
    for (const entry of ss.getClosedTabDataForWindow(window) ?? []) {
      if (!entry?.state?.extData?.[key]) continue;
      ss.forgetClosedTabById(entry.closedId, window);
      forgotten++;
    }
  } catch (e) {
    console.error('Deer peek: could not clean the closed-tab list', e);
  }
  return forgotten;
}

/**
 * SessionStore's closed lists changed ("sessionstore-closed-objects-changed", SessionStore.sys.mjs
 * NOTIFY_CLOSED_OBJECTS_CHANGED): a closed tab is added only once its last state flush is in, some
 * time after TabClose.
 */
export function onClosedTabsChanged(fn: () => void): () => void {
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

/** Tab events on gBrowser.tabContainer (TabSelect, TabClose, TabAttrModified, TabRemotenessChange): tabbrowser/content/tab.js, Tabbrowser.sys.mjs. */
export function onTabEvent(type: string, fn: (node: XULTab, e: Event) => void): () => void {
  const container: HTMLElement = gb().tabContainer;
  const listener = (e: Event): void => fn(e.target as XULTab, e);
  container.addEventListener(type, listener);
  return () => container.removeEventListener(type, listener);
}

/** The favicon tabbrowser resolved for a tab (data:, chrome: or moz-remote-image: on 157). */
export const iconOf = (node: XULTab): string | null => node.getAttribute('image') || null;

/** tab.js sets "busy" while the page loads. */
export const busy = (node: XULTab): boolean => node.hasAttribute('busy');

/**
 * Content calling window.focus() (Finder.focusContent does too) fires "framefocusrequested" on the
 * <browser>; tabbrowser answers by selecting that tab (Tabbrowser.sys.mjs on_framefocusrequested),
 * which would turn the sheet into the active tab. Stopped before tabbrowser's listener sees it.
 */
export function blockFocusRequests(isPeek: (browser: EventTarget | null) => boolean): () => void {
  const fn = (e: Event): void => {
    if (isPeek(e.target)) e.stopPropagation();
  };
  window.addEventListener('framefocusrequested', fn, true);
  return () => window.removeEventListener('framefocusrequested', fn, true);
}

/**
 * alert() / confirm() from a page that is not the selected tab makes tabbrowser select it
 * (Tabbrowser.sys.mjs, its "DOMWillOpenModalDialog" listener). The dialog lives in the peek's own
 * panel (TabDialogBox in .browserStack), i.e. inside the sheet already: the switch is stopped.
 */
export function blockDialogSwitch(isPeek: (browser: EventTarget | null) => boolean): () => void {
  const fn = (e: Event): void => {
    if (isPeek((e as any).originalTarget) || isPeek(e.target)) e.stopPropagation();
  };
  window.addEventListener('DOMWillOpenModalDialog', fn, true);
  return () => window.removeEventListener('DOMWillOpenModalDialog', fn, true);
}

let e10s: any = null;
const e10sUtils = (): any => (e10s ??= ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs').E10SUtils);
/** ClickHandlerParent hands the referrer and policy container over serialized (E10SUtils.deserialize*). */
function deserialized(value: unknown, kind: 'referrer' | 'policy'): unknown {
  if (typeof value !== 'string') return value ?? undefined;
  try {
    return kind === 'referrer' ? e10sUtils().deserializeReferrerInfo(value) : e10sUtils().deserializePolicyContainer(value);
  } catch {
    return undefined;
  }
}

export interface Principals {
  triggeringPrincipal?: unknown;
  referrerInfo?: unknown;
  policyContainer?: unknown;
  userContextId?: number;
}

/**
 * Load a page-derived URL into one particular browser (the sheet), as a link the page clicked:
 * what URILoadingHelper.sys.mjs openInCurrentTab does with `targetBrowser`, minus its window focus
 * handling: browser.fixupAndLoadURIString(url, { triggeringPrincipal, referrerInfo, policyContainer,
 * loadFlags }) (browser-custom-element.mjs). LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL as openLinkIn sets
 * it; `replace` adds LOAD_FLAGS_REPLACE_HISTORY (a hop replaces the page in the sheet).
 * Without a triggering principal the URL is Deer's own (system principal).
 */
export function loadIn(browser: XULBrowser, url: string, p: Principals, opts: { replace?: boolean } = {}): void {
  const nav = Ci.nsIWebNavigation;
  let loadFlags = nav.LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL;
  if (opts.replace) loadFlags |= nav.LOAD_FLAGS_REPLACE_HISTORY;
  browser.fixupAndLoadURIString(url, {
    triggeringPrincipal: p.triggeringPrincipal ?? Services.scriptSecurityManager.getSystemPrincipal(),
    referrerInfo: deserialized(p.referrerInfo, 'referrer'),
    policyContainer: deserialized(p.policyContainer, 'policy'),
    loadFlags,
  });
}

/**
 * Whether a page principal may load this URL (the check ClickHandlerParent's openLinkIn path makes):
 * nsIScriptSecurityManager.checkLoadURIStrWithPrincipal with DISALLOW_INHERIT_PRINCIPAL.
 */
export function mayLoad(principal: unknown, url: string): boolean {
  if (!principal) return true;
  try {
    Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(principal, url, Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
    return true;
  } catch {
    return false;
  }
}

/** Silence a warm peek (browser-custom-element.mjs mute / unmute; the tab's own mute stays the user's). */
export function setMuted(browser: XULBrowser, on: boolean): void {
  try {
    if (on) (browser as any).mute();
    else (browser as any).unmute();
  } catch {
    /* no audio */
  }
}

/** browser.browserId (browser-custom-element.mjs): stable for the <browser> across navigations and process switches. */
export const browserIdOf = (browser: XULBrowser): number => Number((browser as any).browserId) || 0;

/**
 * The page top inset's per-browser off switch (src/actors/page/inset.ts header): the list of
 * browserIds in Services.ppmm.sharedData under INSET_OFF_KEY, shared by every window, so it is
 * read, changed and written back (gre/modules SharedMap; flush() sends it to every content
 * process now instead of at idle).
 */
export function setPageInset(browser: XULBrowser, on: boolean): void {
  const id = browserIdOf(browser);
  if (!id) return;
  try {
    const shared = Services.ppmm.sharedData;
    const before = shared.get(INSET_OFF_KEY);
    const list = new Set<number>(Array.isArray(before) ? before.map(Number) : []);
    if (on === !list.has(id)) return;
    if (on) list.delete(id);
    else list.add(id);
    shared.set(INSET_OFF_KEY, [...list]);
    shared.flush();
  } catch (e) {
    console.error('Deer peek: inset switch failed', e);
  }
}

/**
 * Element full screen asked for by a page that is not the selected tab is refused:
 * FullScreen.enterDomFullscreen(browser, actor) bails out unless browser is gBrowser.selectedBrowser
 * (browser/chrome/browser/content/browser/browser-fullScreenAndPointerLock.js). `before(browser)`
 * runs first and may select it (the peek is promoted): verifier correction 12.
 */
export function beforeDomFullscreen(before: (browser: XULBrowser) => void): () => void {
  const fs = w.FullScreen;
  if (!fs || typeof fs.enterDomFullscreen !== 'function') return () => {};
  const original = fs.enterDomFullscreen;
  fs.enterDomFullscreen = function (this: unknown, aBrowser: XULBrowser, ...rest: unknown[]) {
    try {
      before(aBrowser);
    } catch (e) {
      console.error('Deer peek: full screen hook failed', e);
    }
    return original.call(this, aBrowser, ...rest);
  };
  return () => {
    if (fs.enterDomFullscreen !== original) fs.enterDomFullscreen = original;
  };
}

/**
 * Permission doorhangers for the sheet. PopupNotifications (gre/modules/PopupNotifications.sys.mjs)
 * shows only the notifications of `this.tabbrowser.selectedBrowser` (_currentNotifications,
 * _isActiveBrowser, anchorVisibilityChange) and queues the others until their tab is selected:
 * a prompt from a peek would wait unseen (verifier correction 13). Its `tabbrowser` is replaced by
 * a view of gBrowser whose selectedBrowser is `topmost()` (the sheet's page while a peek is open,
 * else the selected tab's). Every other member reads through to gBrowser (methods bound to it, as
 * Tabbrowser uses private fields). Needs delayed startup (PopupNotifications is a lazy getter in
 * browser.js). Call refreshDoorhangers() when topmost() changes.
 */
export function routeDoorhangers(topmost: () => XULBrowser | null): void {
  const pn = w.PopupNotifications;
  if (!pn || pn.vitrePeekRouted) return;
  const real = pn.tabbrowser;
  pn.vitrePeekRouted = true;
  pn.tabbrowser = new Proxy(real, {
    get(target, prop) {
      if (prop === 'selectedBrowser') {
        try {
          const top = topmost();
          if (top) return top;
        } catch {
          /* fall through */
        }
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** PopupNotifications.anchorVisibilityChange(): re-pick the notifications to show and their anchor. */
export function refreshDoorhangers(): void {
  try {
    w.PopupNotifications?.anchorVisibilityChange();
  } catch {
    /* not up yet */
  }
}

/** The permission doorhanger's panel id (browser.xhtml <panel id="notification-popup">). */
export const DOORHANGER_ID = 'notification-popup';

/** Copy text to the clipboard (widget/nsIClipboardHelper). */
export function copyText(text: string): void {
  try {
    Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(text);
  } catch (e) {
    console.error('Deer peek: copy failed', e);
  }
}

/** Services.focus.clearFocus(window): forget the focused frame before focusing the sheet's page, so keys follow (spike gotcha). */
export function clearChromeFocus(): void {
  try {
    Services.focus.clearFocus(window);
  } catch {
    /* no focus */
  }
}
