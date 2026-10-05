// The Firefox 157 internals the switcher uses beyond the core's (src/window/firefox.ts), each behind
// one small function with its source under gecko/reference/omni, so a runtime update is a checklist.

const w = window as any;

/**
 * Run fn(tab) just before Firefox discards (unloads) a tab, in the same tick, while its document can
 * still be drawn. Every discard goes through gBrowser.discardBrowser(aTab, aForceDiscard): explicit
 * ones, TabUnloader on low memory, extensions' tabs.discard, about:processes
 * (gre/moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs discardBrowser; verified in
 * spikes/switcher/verify/v-discard.js: 8 of 8 snapshots started there resolved). Returns the undo.
 */
export function onDiscard(fn: (tab: XULTab) => void): () => void {
  const g = w.gBrowser;
  const original = g?.discardBrowser;
  if (typeof original !== 'function') return () => undefined;
  const wrapped = function (this: unknown, tab: XULTab, force?: boolean): unknown {
    try {
      if (tab && !tab.selected) fn(tab);
    } catch (e) {
      console.error('Deer switcher: discard hook failed', e);
    }
    return original.call(this, tab, force);
  };
  g.discardBrowser = wrapped;
  return () => {
    if (g.discardBrowser === wrapped) g.discardBrowser = original;
  };
}

/** 32 hex characters (nsIUUIDGenerator, xpcom/base/nsIUUIDGenerator.idl). */
export function newId(): string {
  return String(Services.uuid.generateUUID()).replace(/[{}-]/g, '').toLowerCase();
}

/** A page document is being loaded in the browser right now (nsIWebProgress.isLoadingDocument). */
export function loadingDocument(browser: XULBrowser): boolean {
  try {
    return !!browser.webProgress?.isLoadingDocument;
  } catch {
    return false;
  }
}

/**
 * Closing this tab would show the page's "Leave page?" prompt. Firefox asks the page synchronously
 * when a tab is removed (browser.permitUnload() spins a nested event loop until the prompt is
 * answered) and shows the prompt in that tab's own dialog box, which is invisible while the tab is in
 * the background or covered by the switcher. Asked here without prompting: a page with no
 * beforeunload listener answers at once (browser.hasBeforeUnload, the test Tabbrowser's
 * #hasBeforeUnload uses), else browser.asyncPermitUnload('dontUnload') runs its handlers and reports
 * whether they would prompt, bounded by dom.beforeunload_timeout_ms
 * (gre/chrome/toolkit/content/global/elements/browser-custom-element.mjs hasBeforeUnload,
 * asyncPermitUnload; gre/moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs #beginRemoveTab).
 * mayAskBeforeClosing is the synchronous first half (false: closing never prompts); asksBeforeClosing
 * resolves true when it would prompt (or the question cannot be asked: the prompt must then be seen).
 */
export function mayAskBeforeClosing(browser: XULBrowser): boolean {
  const b = browser as any;
  try {
    return !!(b.isRemoteBrowser && b.frameLoader && b.hasBeforeUnload);
  } catch {
    return false;
  }
}

export async function asksBeforeClosing(browser: XULBrowser): Promise<boolean> {
  const b = browser as any;
  if (!mayAskBeforeClosing(browser)) return false;
  try {
    const { permitUnload } = await b.asyncPermitUnload('dontUnload');
    return !permitUnload;
  } catch {
    return true;
  }
}

/** The browser has a document that drawSnapshot can draw (a discarded or lazy tab has none). */
export function drawable(browser: XULBrowser): boolean {
  try {
    return !!browser.browsingContext?.currentWindowGlobal;
  } catch {
    return false;
  }
}
