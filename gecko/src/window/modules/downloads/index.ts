// Downloads in the window: the panel (Ctrl+J), the ring and its quick view (over pages and Home
// while anything downloads), the "Download this video" pill and quality picker (Ctrl+Shift+D), the
// active pill's download mark, the flight of new downloads, the taskbar progress, the quit prompt,
// and Settings › Video downloads. The engine is the process singleton VitreDownloads
// (src/modules/VitreDownloads.sys.ts); this module is its face in one window.
// Port of app/src/renderer/modules/downloads/*.
//
// Service 'downloads' (b.service('downloads')):
//   download(urlOrRequest, opts?)  download a URL a page shows, with Deer's engine. opts:
//                                  { browser?, filename?, saveAs?, referrerInfo?, triggeringPrincipal?,
//                                    origin?: {x, y} (addition: where the glass file circle flies from),
//                                    isPrivate? (addition), cookieJarSettings? (addition: the page's,
//                                    an nsICookieJarSettings or its E10SUtils serialization) }.
//                                  With a page (content) principal, from opts or the OpenRequest, the
//                                  address is fetched as the page's own Save Link As would be
//                                  (principals.ts; net.ts): that principal loads and triggers it, the
//                                  referrer info's policy decides the Referer (rel=noreferrer sends
//                                  none), the page's cookie jar goes with it; an address the page may
//                                  not load is refused. Without one (or with the system principal) it
//                                  is Deer's own request: system principal, the page's address
//                                  (`browser`, the request's browser, else the active tab) as Referer
//                                  under the referrer info's policy. Container and private state come
//                                  from the page. blob: and data: go to Firefox's own saver
//                                  (contentAreaUtils.js saveURL) and arrive in the panel through the
//                                  take-over's mirror. A media address from a tab that uses DRM is
//                                  refused (MEDIA_URL, the engine's own list).
//   openPanel(focusId?)            show the Downloads panel (focusId, an addition, selects that
//                                  download). From a popup window it opens in the most recent normal
//                                  window of the same privacy (panel.ts header), as does Ctrl+J.
//   videoPicker()                  the quality picker for the active page's main video (Ctrl+Shift+D).
//   (additions) mediaState(browser?) -> { count, protected }: what the download mark counts for a
//                                  page, and whether it uses DRM (the menus module disables
//                                  "Download video…" with "Protected"); isPanelOpen().
// Actions: 'downloads' toggles the panel, 'downloadVideo' opens the picker (for the video the pill
// sits on, else the page's main video).
// One surface at a time: the panel (topmost) closes the quick view and the picker; the address field
// opening, or keyboard focus moving to another Deer surface (switcher search, find), closes them too;
// the pill hides while the address field dims the page. Surfaces that must be seen (the panel, the
// picker, the quit prompt) leave element full screen first (Deer's layer is hidden there).
// Keyboard: the ring is a stop of the tab bar (data-bar-stop, src/window/barkeys.ts).
// Tests: window.vitreDownloads = { store, panel, ring, video, prompt, taskbar } (the instances, and what
// the taskbar button was last told).
import type { Browser, OpenRequest } from '../../browser';
import { MEDIA_URL } from '../../../modules/downloads/media-url';
import { CSS } from './css';
import { Panel } from './panel';
import { pageIdentity } from './principals';
import { Ring } from './ring';
import { registerSettingsPage } from './settings-page';
import { DownloadStore } from './store';
import { installTaskbar, QuitPrompt, taskbarShown } from './system';
import { VideoUI } from './video';

export interface DownloadOptions {
  browser?: XULBrowser;
  filename?: string;
  saveAs?: boolean;
  referrerInfo?: unknown;
  triggeringPrincipal?: unknown;
  origin?: { x: number; y: number };
  isPrivate?: boolean;
  /** Addition: the page's cookie jar settings (nsContextMenu contentData.cookieJarSettings), object or serialized. */
  cookieJarSettings?: unknown;
}

export interface DownloadsApi {
  download(urlOrRequest: string | OpenRequest, opts?: DownloadOptions): void;
  /** Addition: `focusId` selects that download in the list. In a popup window the panel opens in the most recent normal window. */
  openPanel(focusId?: string): void;
  videoPicker(): void;
  mediaState(browser?: XULBrowser | null): { count: number; protected: boolean };
  isPanelOpen(): boolean;
}

declare global {
  interface VitreServices {
    downloads: DownloadsApi;
  }
  interface Window {
    vitreDownloads?: { store: DownloadStore; panel: Panel; ring: Ring; video: VideoUI; prompt: QuitPrompt; taskbar: typeof taskbarShown };
  }
}

/**
 * Firefox's own "save this URL" (gre/chrome/toolkit/content/global/contentAreaUtils.js saveURL:
 * aURL, aOriginalURL, aFileName, aFilePickerTitleKey, aShouldBypassCache, aSkipPrompt, aReferrerInfo,
 * aCookieJarSettings, aSourceDocument, aIsContentWindowPrivate, aPrincipal). Used for blob: and
 * data: addresses, which only the page's own process can read.
 */
function firefoxSave(url: string, opts: DownloadOptions, isPrivate: boolean): void {
  const w = window as unknown as { saveURL?: (...args: unknown[]) => void };
  w.saveURL?.(url, null, opts.filename ?? null, null, false, !opts.saveAs, opts.referrerInfo ?? null, null, null, isPrivate, opts.triggeringPrincipal ?? null);
}

export function install(b: Browser): void {
  const engine = b.sys('VitreDownloads');
  void engine.init();
  b.css('downloads', CSS);
  const store = new DownloadStore(b);
  const panel = new Panel(b, store);
  const ring = new Ring(b, store, panel);
  const video = new VideoUI(b, store, ring, panel);
  const prompt = new QuitPrompt(b);
  installTaskbar(b, store);
  registerSettingsPage(b);
  window.vitreDownloads = { store, panel, ring, video, prompt, taskbar: taskbarShown };

  // The address field opens over everything the page shows: the quick view and the picker give way
  // (the picker's layer, z 30, would cover the field's suggestions).
  let omniOpen = b.root.classList.contains('omni-open');
  const omniWatch = new MutationObserver(() => {
    const open = b.root.classList.contains('omni-open');
    if (open && !omniOpen) {
      ring.pop.close(false);
      video.picker.close(false);
    }
    omniOpen = open;
  });
  omniWatch.observe(b.root, { attributes: true, attributeFilter: ['class'] });
  b.onDestroy(() => omniWatch.disconnect());

  b.registerAction('downloads', () => panel.toggle());
  b.registerAction('downloadVideo', () => void video.downloadVideo(b.keys?.current !== null && b.keys?.current !== undefined));

  const browserIdOf = (browser: XULBrowser | null | undefined): number => {
    try {
      return Number(browser?.browsingContext?.browserId) || 0;
    } catch {
      return 0;
    }
  };

  const api: DownloadsApi = {
    download(urlOrRequest, opts = {}) {
      const request = typeof urlOrRequest === 'string' ? null : urlOrRequest;
      const url = request ? request.url : (urlOrRequest as string);
      if (!url) return;
      const browser = opts.browser ?? request?.browser ?? b.active()?.browser ?? null;
      const tab = b.tabFor(browser);
      let shown = '';
      try {
        shown = browser?.currentURI?.spec ?? tab?.url ?? '';
      } catch {
        shown = tab?.url ?? '';
      }
      let userContextId = 0;
      try {
        userContextId = Number(request?.click?.originAttributes?.userContextId ?? browser?.browsingContext?.originAttributes?.userContextId ?? tab?.node.userContextId ?? 0) || 0;
      } catch {
        userContextId = 0;
      }
      const isPrivate = opts.isPrivate ?? b.isPrivate;
      if (!/^https?:/i.test(url)) {
        if (/^(blob|data):/i.test(url)) firefoxSave(url, opts, isPrivate);
        return;
      }
      // Whose request this is: the page's (its principal, referrer policy, cookie jar) or Deer's.
      const page = pageIdentity(url, opts.triggeringPrincipal ?? request?.click?.triggeringPrincipal, opts.referrerInfo ?? request?.click?.referrerInfo, opts.cookieJarSettings, shown);
      if (!page) return;
      const browserId = browserIdOf(browser);
      // DRM: media a protected page plays is never downloaded, whoever asks.
      if (browserId && engine.media.isProtected(browserId) && MEDIA_URL.test(url)) return;
      store.start(url, {
        filename: opts.filename,
        named: !!opts.filename,
        saveAs: opts.saveAs,
        pageUrl: page.pageUrl,
        identity: page.principal
          ? { userContextId, isPrivate, firstParty: false, principal: page.principal, referrerPolicy: page.referrerPolicy, cookieJarSettings: page.cookieJarSettings }
          : { userContextId, isPrivate, firstParty: true, referrerPolicy: page.referrerPolicy },
        browserId,
        origin: opts.origin,
      });
    },
    openPanel: (focusId) => panel.show(focusId),
    videoPicker: () => void video.downloadVideo(false),
    mediaState: (browser) => video.mediaState(b.tabFor(browser ?? b.active()?.browser ?? null) ?? b.active()),
    isPanelOpen: () => panel.open,
  };
  b.provide('downloads', api);
}
