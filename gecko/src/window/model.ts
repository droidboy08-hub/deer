// A tab as Deer's UI sees it: a mirror of one <tab> of gBrowser. Same fields as the Electron
// build's Tab (app/src/renderer/model.ts), with `node` / `browser` in place of `webview`.
// The Browser keeps the fields current from gBrowser's events; modules read them and never write
// them (except `theme`, which the Browser's sampler owns, and `zoomFlash`).

export type Theme = 'light' | 'dark' | 'clear';

/**
 * Session value on tabs b.openHidden made (browser.ts): they are closed on restore, and Peek forgets
 * closed-tab entries that carry it (a peek's tab never enters the closed-tab list).
 */
export const HIDDEN_TAB_VALUE = 'vitre-hidden';

let nextId = 1;

/**
 * Before the first sample: a tab starts on a blank page, which paints in the colour scheme pages
 * are given. (nsIXULRuntime.contentThemeDerivedColorSchemeIsDark; the chrome document's own
 * prefers-color-scheme is not settled yet at DOMContentLoaded.)
 */
export function startTheme(): Theme {
  try {
    return Services.appinfo.contentThemeDerivedColorSchemeIsDark ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export class Tab {
  /** Unique in this window for the life of the tab. */
  readonly id = nextId++;
  /** 'home' while the tab shows Home (or a blank new tab); 'web' otherwise. */
  kind: 'home' | 'web' = 'web';
  url = '';
  title = '';
  /** Always a data:, chrome: or moz-remote-image: URL on Firefox 157: safe as an <img src>. */
  favicon: string | null = null;
  /** The page is loading: busy, or a load was asked for and nothing has arrived yet (url is the pending address then). */
  loading = false;
  canBack = false;
  canForward = false;
  zoom = 1;
  /** Glass theme for this tab: sampled from the page under the bar; Home uses the Browser's homeTheme. */
  theme: Theme = startTheme();
  /** False while the tab is a restored placeholder with no document yet. */
  ready = true;
  /**
   * Restored (or discarded) and not loaded: it loads when first shown. Until then url and title come
   * from the session data and its browser shows about:blank (a snapshot or page query sees that).
   */
  deferred = false;
  pinned = false;
  crashed = false;
  /** Sound is playing / the tab is muted. */
  audible = false;
  muted = false;
  /** Set while the tab shows one of Firefox's error pages (the page itself explains the failure). */
  error: { code: number; description: string; url: string } | null = null;
  /** Until this time (ms) the pill shows the zoom percentage instead of the host. */
  zoomFlash = 0;

  constructor(
    /** The <tab> element of gBrowser this mirrors. */
    readonly node: XULTab
  ) {}

  /** The page's <browser> element. Its browsingContext changes on a process switch: never cache that. */
  get browser(): XULBrowser {
    return this.node.linkedBrowser;
  }
}
