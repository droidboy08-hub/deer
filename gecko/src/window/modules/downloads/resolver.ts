// The background page step's window half (spikes/downloader/RESUME-DESIGN.md G1 automatic step 3, G2 automatic
// step 4, decisions 6 and 7 of section 9; Phase 7). The engine (VitreDownloads setResolver(), pageStep()) asks a
// window of the download's privacy to open the download's page out of sight and report what it shows; it
// decides nothing itself: every address it reports goes through the engine's same-file proof.
//
//   open     b.openHidden(pageUrl) with a content principal (the page's own origin, in the download's container
//            and privacy) AND the download's userContextId, always both: without a triggering principal
//            openHidden calls addTrustedTab with no container (design 1, "Facts checked"). A hidden tab is not in
//            b.tabs and emits no tab events, so nothing flies and the bar does not change.
//   history  kept out of Places (decision 7): the new tab's BrowsingContext gets useGlobalHistory = false (and
//            its <browser> the disableglobalhistory attribute) in TabOpen, which tabbrowser fires after the
//            browser is inserted and before it starts the load (Tabbrowser.sys.mjs addTab: #insertBrowser,
//            #fireTabOpen, #kickOffBrowserLoad), as Firefox's own hidden browsers do (HiddenFrame.sys.mjs,
//            ExtensionParent.sys.mjs). The Phase 7 spike (spikes/downloader/boot-pagestep.js, 9 real sites) found
//            no visit with it and 2 without; it held when the BrowsingContext was replaced (YouTube). It is set
//            again whenever the tab's BrowsingContext changes, to be sure.
//   quiet    muted through its media controller (peek/gecko.ts setMuted; review of Phase 7: <browser>.mute() does
//            not exist in 157, and a site allowed to autoplay was heard), again on every top context the tab
//            gets (a process switch makes a new, unmuted one: "browsing-context-attached", TabRemotenessChange,
//            and the 600 ms look) and whenever its media turns audible anyway ("audiblechange", as tab.js
//            drives the sound icon); kept active (keepActive: the page runs and lays out as a shown one,
//            unthrottled). Media is still held back until a tab was in front (media.block-autoplay-until-in-
//            foreground), which the spike saw: players fetched their media without playing. A page's alert() or
//            window.focus() would select its tab: both are stopped (peek/gecko.ts blockDialogSwitch,
//            blockFocusRequests). Pop-ups and new tabs it opens (window.open, target=_blank) are refused
//            (b.interceptOpen: window.open gets null; review of Phase 7: on a site allowed pop-ups they opened as
//            visible tabs and took the selection). Saved logins are kept from it by the engine (keepLoginsFrom).
//   collect  every 600 ms while it loads (at most job.loadMs) and then for at most job.collectMs: its links
//            in every frame and whether a frame shows a password field (the read-only 'downloads:links' query,
//            src/actors/page/downloads.ts), its main video ('downloads:main-video'), what MediaWatch saw under
//            its tab, whether it landed on another site (site.ts siteKey(): its registrable domain, an http
//            page moved to https being the same site), its principal and cookie jar. job.enough() (the
//            engine's: a download the page started, a strong link, media of the file's size) ends it early.
//   close    letSleep, removeQuietly (no closed-tab entry, no beforeunload prompt), then forgetClosedMarked for a tab
//            Firefox closed by itself (a load that became a download), now and on the closed lists' next
//            changes for a few seconds: b.tabs, the tab strip and the closed-tab list end as they were.
//            Removing any tab resets tabbrowser's related-tab chain (Tabbrowser.sys.mjs _endRemoveTab:
//            #lastRelatedTabMap), which places the next link opened from a page right after the ones opened
//            from it before (review of Phase 7: a step ending between two Ctrl+clicks put the third link first).
//            So while that chain is live (a tab was opened from another since the last switch, close or move),
//            the page is parked instead: asleep, its history purged, on about:blank, still hidden, and removed
//            at the window's next TabSelect, TabClose or TabMove, which reset the chain anyway (at most
//            MAX_PARKED wait so; closing the last visible tab still closes the window: tabbrowser's
//            #isLastTabInWindow skips hidden tabs). A window that
//            closes with a page open or parked removes it before SessionStore keeps its tabs ("SSWindowClosing",
//            SessionStore.sys.mjs #onClose; review of Phase 7: its address went into the closed-window list) and
//            ends the engine's step at once (setResolver(window, null)).
// Never a click, a form, a sign-in or a CAPTCHA: only links already on the page and requests it made itself.
import type { Browser } from '../../browser';
import { HIDDEN_TAB_VALUE } from '../../model';
import { siteKey } from '../../../modules/downloads/site';
import type { PageJob, PageLink, PageMedia, PageSeen } from '../../../modules/downloads/types';
import { blockDialogSwitch, blockFocusRequests, browserIdOf, forgetClosedMarked, isMuted, keepActive, letSleep, loadIn, onClosedTabsChanged, onTabEvent, removeQuietly, setMuted } from '../peek/gecko';

/** How often what the page shows is read while it loads and collects. */
const LOOK_EVERY = 600;
/** A page query that does not answer in this long counts as nothing. */
const QUERY_MS = 3000;
/** The closed-tab list is cleaned again on its changes for this long after the page closed. */
const FORGET_FOR = 5000;
/** At most this many pages wait parked for the next tab switch (each holds a browser): one more is removed at once. */
const MAX_PARKED = 3;

let e10s: any = null;
const E10SUtils = (): any => (e10s ??= ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs').E10SUtils);

/** This window's pages open now: each one's "close it now" (the window is closing). */
const open = new Set<() => void>();
/** This window's parked pages (see the header) and what ends each once it is removed. */
const parked = new Map<XULTab, () => void>();
/** A tab was opened from another since the window's last TabSelect, TabClose or TabMove: the related-tab chain is live. */
let chained = false;
/** The window is closing ("SSWindowClosing"). */
let closingNow = false;

/** Register this window's page step with the engine (not in a popup window); unregistered when it closes. */
export function installResolver(b: Browser): void {
  if (b.isPopup) return;
  const engine = b.sys('VitreDownloads');
  engine.setResolver(window, (job) => resolve(b, job));
  // Tabbrowser's related-tab chain (#insertTabAtIndex records a tab opened from another; updateCurrentBrowser,
  // _endRemoveTab and moveTabTo forget it): live from such a TabOpen until the next switch, close or move,
  // which is when a parked page may go without changing anything.
  const unchain = (): void => {
    chained = false;
    if (parked.size) window.setTimeout(unpark, 0);
  };
  const offs = [
    onTabEvent('TabOpen', (node) => {
      if ((node as any).openerTab && !node.hidden) chained = true;
    }),
    onTabEvent('TabSelect', unchain),
    onTabEvent('TabClose', unchain),
    onTabEvent('TabMove', unchain),
  ];
  // SessionStore keeps a closing window's tabs right after this event: its pages go first (and nothing is
  // left watching the closed-tab list of a window that is going away).
  const closing = (): void => {
    engine.setResolver(window, null);
    closingNow = true;
    for (const close of [...open]) close();
    unpark();
  };
  window.addEventListener('SSWindowClosing', closing, { once: true });
  b.onDestroy(() => {
    window.removeEventListener('SSWindowClosing', closing);
    engine.setResolver(window, null);
    for (const off of offs) off();
  });
}

/** Remove the parked pages (the related-tab chain was reset anyway, or the window is closing). */
function unpark(): void {
  if (!parked.size) return;
  for (const [node, finish] of [...parked]) {
    parked.delete(node);
    removeQuietly(node);
    finish();
  }
  forgetSoon();
}

/**
 * Forget a hidden tab in the closed-tab list now and on its next changes (Firefox adds a tab it closed by itself
 * once its last state flush is in); only now when the window is closing (its timers end with it).
 */
function forgetSoon(): void {
  forgetClosedMarked(HIDDEN_TAB_VALUE);
  if (closingNow) return;
  const stop = onClosedTabsChanged(() => forgetClosedMarked(HIDDEN_TAB_VALUE));
  window.setTimeout(stop, FORGET_FOR);
}

/**
 * Keep a hidden page's visits out of history (decision 7): BrowsingContext.useGlobalHistory, a synced field
 * every process reads before it records a visit (nsDocShell; Interactions.sys.mjs checks it too), and the
 * disableglobalhistory attribute nsFrameLoader reads for a BrowsingContext it makes for the element.
 */
function offHistory(browser: XULBrowser | null | undefined): void {
  if (!browser) return;
  try {
    browser.setAttribute('disableglobalhistory', 'true');
  } catch {
    /* gone */
  }
  try {
    const bc = (browser as any).browsingContext;
    if (bc && bc.useGlobalHistory) bc.useGlobalHistory = false;
  } catch {
    /* gone */
  }
}

/** The same site as the engine counts it (site.ts siteKey(): the registrable domain, without the scheme). */
function sameSite(a: string, b: string): boolean {
  const x = siteKey(a);
  return !!x && x === siteKey(b);
}

/** The browsing contexts of a tab (its top and every frame): a download that arrives after the tab closed is matched by them. */
function contextsOf(browser: XULBrowser): number[] {
  const out: number[] = [];
  const walk = (bc: any): void => {
    if (!bc) return;
    out.push(Number(bc.id) || 0);
    for (const child of bc.children ?? []) walk(child);
  };
  try {
    walk((browser as any).browsingContext);
  } catch {
    /* gone */
  }
  return out.filter(Boolean);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms))]);
}

/** One answer of 'downloads:links', narrowed (a page process may send anything). */
function asLinks(answer: unknown): { links: PageLink[]; password: boolean } {
  const a = answer as { links?: unknown; password?: unknown } | null;
  const links: PageLink[] = [];
  if (a && Array.isArray(a.links)) {
    for (const l of a.links.slice(0, 2000)) {
      const href = (l as { href?: unknown })?.href;
      const text = (l as { text?: unknown })?.text;
      const download = (l as { download?: unknown })?.download;
      if (typeof href !== 'string' || href.length > 8192 || !/^https?:\/\//i.test(href)) continue;
      links.push({ href, text: typeof text === 'string' ? text.slice(0, 200) : '', download: typeof download === 'string' ? download.slice(0, 300) : null });
    }
  }
  return { links, password: a?.password === true };
}

/**
 * Park a page whose removal would reset the related-tab chain (see the header): asleep (letSleep was done),
 * stopped, its session history purged and on about:blank (a null principal in its container and privacy,
 * replacing the entry: nothing of the page is kept in the session), still hidden and muted. `finish` runs
 * once it is removed (unpark()).
 */
function park(node: XULTab, browser: XULBrowser, job: PageJob, finish: () => void): void {
  try {
    browser.stop();
  } catch {
    /* gone */
  }
  try {
    (browser as any).purgeSessionHistory();
  } catch {
    /* no history yet */
  }
  try {
    const blank = Services.scriptSecurityManager.createNullPrincipal({ userContextId: job.userContextId, privateBrowsingId: job.isPrivate ? 1 : 0 });
    loadIn(browser, 'about:blank', { triggeringPrincipal: blank }, { replace: true });
  } catch {
    /* it stays as it was, asleep, until it goes */
  }
  parked.set(node, finish);
}

/** Open the job's page out of sight, watch it, and close it without a trace (see the header). */
async function resolve(b: Browser, job: PageJob): Promise<PageSeen> {
  const engine = b.sys('VitreDownloads');
  const seen: PageSeen = { outcome: 'failed', finalUrl: '', browserId: 0, password: false, links: [], video: '', media: [], protected: false, principal: '', cookieJarSettings: '' };
  if (job.signal.aborted) return { ...seen, outcome: 'aborted' };
  let principal: unknown;
  try {
    principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(job.pageUrl), { userContextId: job.userContextId, privateBrowsingId: job.isPrivate ? 1 : 0 });
  } catch {
    return seen;
  }
  const strip: any = (window as any).gBrowser?.tabContainer;
  const onOpen = (e: Event): void => offHistory((e.target as XULTab | null)?.linkedBrowser);
  strip?.addEventListener('TabOpen', onOpen, true);
  let made: { node: XULTab; browser: XULBrowser };
  try {
    made = b.openHidden(job.pageUrl, { triggeringPrincipal: principal, userContextId: job.userContextId });
  } catch (e) {
    console.warn('Deer downloads: the page could not be opened out of sight', String(e));
    return seen;
  } finally {
    strip?.removeEventListener('TabOpen', onOpen, true);
  }
  const { node, browser } = made;
  offHistory(browser);
  const id = browserIdOf(browser);

  // Muted on every media controller the tab's top context gets, and again whenever its media turns audible.
  let controller: any = null;
  const onAudible = (): void => {
    if (!isMuted(browser)) setMuted(browser, true);
  };
  const hush = (): void => {
    setMuted(browser, true);
    let now: any = null;
    try {
      now = (browser as any).browsingContext?.mediaController ?? null;
    } catch {
      now = null;
    }
    if (now === controller) return;
    try {
      controller?.removeEventListener('audiblechange', onAudible);
    } catch {
      /* gone */
    }
    controller = now;
    try {
      controller?.addEventListener('audiblechange', onAudible);
    } catch {
      /* no controller yet */
    }
  };
  // A new top context for the tab (a process switch) is muted as it attaches, before its page runs.
  const attached = {
    observe: (subject: any): void => {
      try {
        if (Number(subject?.browserId) !== id || subject.parent) return;
        subject.mediaController?.mute();
      } catch {
        /* not a top context of ours */
      }
      window.setTimeout(hush, 0);
    },
  };
  hush();
  keepActive(browser);
  const isOurs = (t: EventTarget | null): boolean => t === browser;
  Services.obs.addObserver(attached, 'browsing-context-attached');
  // Until the tab is gone (removed, or parked and then removed): an unload handler may still try a pop-up.
  const undo = [
    blockFocusRequests(isOurs),
    blockDialogSwitch(isOurs),
    b.interceptOpen((r) => r.browser === browser),
    onTabEvent('TabRemotenessChange', (t) => {
      if (t === node) hush();
    }),
    () => Services.obs.removeObserver(attached, 'browsing-context-attached'),
    () => controller?.removeEventListener('audiblechange', onAudible),
  ];
  const finish = (): void => {
    for (const fn of undo.splice(0)) {
      try {
        fn();
      } catch {
        /* already gone */
      }
    }
  };
  seen.browserId = id;
  let bcId = Number((browser as any).browsingContext?.id) || 0;
  job.opened(id, contextsOf(browser));
  const gone = (): boolean => !node.isConnected || !!(node as any).closing;

  // Closed at the end (parked while the related-tab chain is live), or at once when the window closes.
  let closed = false;
  const close = (mayPark: boolean): void => {
    if (closed) return;
    closed = true;
    open.delete(closeNow);
    // Out of tabbrowser's kept-active set first (peek/gecko.ts letSleep), so no closed browser stays in it.
    letSleep(browser);
    if (mayPark && chained && !gone() && parked.size < MAX_PARKED) {
      park(node, browser, job, finish);
      return;
    }
    removeQuietly(node);
    finish();
    forgetSoon();
  };
  const closeNow = (): void => close(false);
  open.add(closeNow);

  /** Read what the page shows now (links, password fields, main video, media, where it is, its principal). */
  const look = async (): Promise<void> => {
    if (gone() || closed) return;
    // A replaced BrowsingContext (a process switch) keeps the history switch and the mute: set again to be sure.
    const now = Number((browser as any).browsingContext?.id) || 0;
    if (now && now !== bcId) {
      bcId = now;
      offHistory(browser);
      hush();
    }
    job.opened(id, contextsOf(browser));
    let spec = '';
    try {
      spec = browser.currentURI?.spec ?? '';
    } catch {
      spec = '';
    }
    if (/^https?:/i.test(spec)) seen.finalUrl = spec;
    try {
      const wgp = (browser as any).browsingContext?.currentWindowGlobal;
      const p = wgp?.documentPrincipal;
      if (p?.isContentPrincipal) {
        seen.principal = String(E10SUtils().serializePrincipal(p) ?? '');
        seen.cookieJarSettings = wgp.cookieJarSettings ? String(E10SUtils().serializeCookieJarSettings(wgp.cookieJarSettings) ?? '') : '';
      }
    } catch {
      /* not yet */
    }
    const answers = await within(b.page(browser).queryAll('downloads:links'), QUERY_MS, [] as { answer: unknown }[]);
    const links: PageLink[] = [];
    let password = false;
    for (const a of answers) {
      const got = asLinks(a.answer);
      links.push(...got.links);
      password ||= got.password;
    }
    if (answers.length) {
      seen.links = links.slice(0, 4000);
      seen.password = password;
    }
    const video = (await within(b.page(browser).query('downloads:main-video'), QUERY_MS, null)) as { src?: unknown } | null;
    if (typeof video?.src === 'string' && /^https?:\/\//i.test(video.src) && video.src.length <= 8192) seen.video = video.src;
    seen.media = engine.media.candidates(id).map((c): PageMedia => ({ url: c.url, kind: c.kind, bytes: c.bytes, frameUrl: c.frameUrl }));
    seen.protected = engine.media.isProtected(id);
    if (seen.finalUrl && !sameSite(seen.finalUrl, job.pageUrl)) seen.outcome = 'elsewhere';
    else if (seen.finalUrl && seen.outcome !== 'timeout') seen.outcome = 'ok';
  };

  try {
    // Loading: at most job.loadMs; looked at as it goes, so a download it starts or a strong link ends it early.
    const loadEnd = Date.now() + job.loadMs;
    let loaded = false;
    while (!job.signal.aborted && !gone() && !closed && Date.now() < loadEnd) {
      let busy = true;
      try {
        busy = !!browser.webProgress?.isLoadingDocument || browser.currentURI?.spec === 'about:blank';
      } catch {
        busy = true;
      }
      if (!busy) {
        loaded = true;
        break;
      }
      await wait(LOOK_EVERY, job.signal);
      await look();
      if (job.enough(seen)) break;
    }
    if (!loaded && !job.signal.aborted && !gone() && !closed && Date.now() >= loadEnd) seen.outcome = 'timeout';
    // Collecting: at most job.collectMs more, for what the page fetches once loaded (a player's media).
    const collectEnd = Date.now() + job.collectMs;
    await look();
    while (!job.signal.aborted && !gone() && !closed && !job.enough(seen) && Date.now() < collectEnd) {
      await wait(LOOK_EVERY, job.signal);
      await look();
    }
    if (job.signal.aborted || closed) seen.outcome = 'aborted';
    else if (!seen.finalUrl && seen.outcome !== 'timeout') seen.outcome = gone() ? 'ok' : 'failed';
  } catch (e) {
    console.warn('Deer downloads: reading the page failed', String(e));
  } finally {
    close(true);
  }
  return seen;
}
