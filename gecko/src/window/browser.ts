// The Browser: one per browser window, exposed as window.vitre. It mirrors Firefox's tab engine
// (gBrowser) as Tab objects and is the API every feature module builds on. Same shape as the
// Electron build's Browser (app/src/renderer/app.ts) so modules port directly.
//
// API for feature modules (src/window/modules/<name>.ts exports install(b: Browser)):
//
//   State     b.tabs (bar order; hidden tabs such as peeks are not in it), b.active(), b.activeId,
//             b.mru (tab ids, most recent first), b.settings, b.bar.layout ({ pillRect, left, right }),
//             b.omni, b.root (#vitre-root), b.isPrivate, b.isPopup, b.closedCount()
//   Bar       b.bar.item(tabId), b.bar.accessories(), b.bar.downloadMark(), b.bar.hidden,
//             b.bar.hiding, b.bar.reveal(), b.bar.hold(reason) -> release, b.bar.claimPill(width)
//             -> release (the active pill keeps that width; with many tabs the circles give way
//             instead: find's face) (see bar.ts). While the
//             bar is in hiding mode (auto-hide, F11) the window's pages are listed as "under a
//             hidden bar" for the page modules (pagearea.ts): no top strip, no PDF offset.
//   Tabs      b.newTab(url?, { background, index }), b.closeTab(tab), b.activate(tab),
//             b.navigate(tab, url), b.moveTab(tab, index), b.tab(id), b.tabFor(browserElement),
//             b.toggleMute(tab), b.moveToNewWindow(tab), b.forgetClosed(),
//             b.focusPage(), b.editAddress(query?), b.render()
//             (tab arguments accept a Tab or its id)
//             newTab(url) and navigate(tab, url) load with the SYSTEM principal: they are for
//             user-typed and Deer-chosen URLs only (they open chrome:, file: and about:config).
//             A URL that came from a page (a link, an image, a selection) goes through
//             b.openLink(urlOrRequest, where, opts), which loads it with the page's principal,
//             referrer and container; what the page could not load itself (file:, chrome:,
//             about:config from a web page) opens nothing at all.
//   Windows   b.openWindow(url?, { private, ...principals }) (a URL is loaded with the principals
//             given, else the system one); in a popup window (b.isPopup) newTab() and
//             reopenClosed open in the most recent normal window and the strip actions do nothing.
//   Hidden    b.openHidden(url, opts) -> { node, browser }: a real tab that is not in b.tabs and
//             emits no tab events (Peek); b.adopt(node, { index, activate }) puts it in the bar
//             (a hidden tab that something else already selected becomes the active tab).
//             Hidden tabs carry the session value HIDDEN_TAB_VALUE ("vitre-hidden", exported) and
//             are closed on restore, without entering the closed-tab list.
//   Events    b.on(name, fn) -> unsubscribe. Names and arguments: see BrowserEvents below
//             ('tab-crashed' (tab | undefined, browser): a page's content process died, peeks too).
//   Actions   b.registerAction(id, fn) overrides the built-in for an ActionId (src/shared/shortcuts.ts);
//             b.run(id, arg) runs it; b.builtin(id, arg) runs the built-in from inside an override.
//   Services  b.provide(name, api), b.service(name), await b.whenService(name): APIs modules offer
//             each other in this window (Peek, find, downloads, the settings panel...); names and
//             types in VitreServices (src/types/gecko.d.ts), extended by declaration merging.
//   Ladders   b.addEscLayer(priority, handle), b.addCloseLayer(priority, handle), b.escape().
//             handle() returns true when it used the key. Priorities: menu 20, popover 30, latched
//             switcher 40, element full screen 50, panel 60, Deer field 70, parked find 90, peek 100.
//   Links     b.interceptOpen(fn): fn(request) returns true to take over a link the page wants opened
//             elsewhere: modified clicks (Shift/Ctrl/middle/Alt) and window.open / target=_blank
//             (source 'window-open'). Load it with b.openLink(request, where). The interceptor
//             registered last is asked first (like registerAction, the latest wins), so a later,
//             more specific one (a test, a module wrapping another) sees a request before Peek's.
//   UI        b.layer(id, z) -> a full-window overlay div inside #vitre-root (pointer-events only on its
//             children; z: peek 8, omni-scrim 9 (core; a module layer at z 9 that must show above
//             the dim is created after boot and so paints over it), bar 10, find 12, omnibox 20,
//             panels 30, switcher 40, menus 50, downloads-prompt 55 (the quit prompt, above
//             everything it must not hide under), tips 60 (core));
//             b.css(id, text) injects a module's CSS once (the sheet applies to all of browser.xhtml:
//             scope selectors under #vitre-root or the module's own ids);
//             b.anchor(kind) / b.setAnchor(kind, fn, { popups, position }): the element native popups
//             hang from (anchors.ts routes the popup ids listed to that anchor);
//             b.setHomeTheme(theme); b.holdTheme(theme) -> release: the glass (window controls,
//             bar, native popups) reads `theme` while a module's own full-window surface covers the
//             page (the switcher's deck and grid hold 'clear'); b.luma(browser, rect) and
//             b.snapshot(browser, rect, scale) for any part of any page; b.closePanels() hides
//             Firefox's open panels.
//   Page      b.page(target).send(name, data), await .query(name, data), .sendAll(name, data),
//             await .queryAll(name, data) (one answer per frame); target: a Tab, its id, a <browser>
//             (peek) or a browsingContext (one frame, as 'page-message' hands it over);
//             b.on('page-message', (tab, name, data, from) => ...). Page side: src/actors/page-api.ts.
//             A compromised content process can send any name with any data: narrow `data` before
//             use (it is typed unknown).
//   Process   b.sys('VitreSettings') etc.: the singleton exported by src/modules/<Name>.sys.ts
//             (add yours to VitreSysModules in src/types/gecko.d.ts). b.onDestroy(fn) runs fn when
//             the window closes: unsubscribe there from singletons that outlive the window.
//
// Timing: install(b) runs at the window's DOMContentLoaded, before first paint; gBrowser and the
// first tab exist, Firefox's lazy UI objects (PopupNotifications, CustomizableUI areas) do not.
// Use b.whenReady or b.on('ready') for those (after delayed startup).
//
// The visible shell is in bar.ts (tab bar), winctl.ts (window controls), reveal.ts (auto-hide),
// tips.ts (tooltips), glass.ts (lens filters) and scrollthumb.ts (the panels' overlay scroll thumb);
// their headers are the contracts.
// The address field is omnibox.ts, the key router keys.ts (b.keys: hooks for state-dependent
// routing, the key that is running an action), keyboard access to the bar barkeys.ts.
//
// Actions (b.run): every id in src/shared/shortcuts.ts. The core implements the tab, window,
// navigation, zoom and page ones; find / findNext / findPrev (except on Home, where find opens the
// address field), peekLink, openAsTab, downloads, downloadVideo, settings, shortcutsHelp, clearData
// and switcherSearch do nothing until their module registers them. Page actions (back, forward,
// reload, stop, zoom, print, save, source) act on the topmost page: a focused peek first
// (window.vitrePeek, set by the Peek module: { browser(), close() }), else the active tab.
// Panels (Settings, Downloads): while one is open its module puts `panel-open` and `<name>-open`
// (settings-open, downloads-open) on b.root; find / findNext / findPrev then go to the panel as the
// document event 'vitre:panel-find' instead of running (Ctrl+F searches the topmost surface).
// The other page actions (PAGE_ACTIONS_UNDER_PANEL: back, forward, reload, zoom, print, save,
// source, developer tools, peekLink, openAsTab, downloadVideo) do nothing while a panel is open:
// the panel is the topmost surface and has no page (keymap.json routing rule "Topmost surface"),
// so they must not act on the page hidden under it (Ctrl+P would open Print under the panel).
// Tab and window actions, stop (Esc runs the ladder through it) and the panel toggles still run.
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import { applyRebind, type ActionId } from '../shared/shortcuts';
import { HOME_URL, isHomeUrl, setSearchEngine } from '../shared/url';
import { installAnchors, installAnchorsDelayed, type AnchorRoute } from './anchors';
import { Bar } from './bar';
import { BarKeys } from './barkeys';
import { el } from './dom';
import * as fx from './firefox';
import { installKeys, type Keys } from './keys';
import { HIDDEN_TAB_VALUE, startTheme, Tab, type Theme } from './model';
import { installModules } from './modules';
import { Omnibox } from './omnibox';
import { PageArea } from './pagearea';

export { HIDDEN_TAB_VALUE, Tab, type Theme } from './model';

/** Where a page message came from. `tab` is undefined for a browser outside b.tabs (a peek). */
export interface PageSource {
  browser: XULBrowser;
  /** The frame that sent it (top document or an iframe). */
  browsingContext: any;
  isTop: boolean;
}

export interface BrowserEvents {
  /** A tab appeared in b.tabs (opened, restored, or a hidden tab was shown). */
  'tab-created': [tab: Tab];
  'tab-activated': [tab: Tab];
  /** A tab left b.tabs (closed, or hidden). */
  'tab-closed': [tab: Tab];
  /** Title, URL, favicon, loading, navigation state, zoom, sound or pinned state changed. */
  'tab-updated': [tab: Tab];
  /**
   * A page's top document moved to another address (also for browsers outside b.tabs: tab is then
   * undefined). sameDocument: an anchor or history.pushState navigation. errorPage: Firefox's error
   * page is showing for that URL.
   */
  'tab-navigated': [tab: Tab | undefined, browser: XULBrowser, info: { url: string; sameDocument: boolean; errorPage: boolean }];
  /** A page's top document started (true) or stopped (false) loading; also for browsers outside b.tabs. */
  'tab-loading': [tab: Tab | undefined, browser: XULBrowser, loading: boolean];
  /**
   * A page's content process crashed (also for browsers outside b.tabs: a peek). Fired after
   * Firefox's own handling: the selected tab shows Firefox's crashed page; any other browser is
   * left blank (non-remote about:blank) until it is reloaded. Context loss for whatever showed
   * that page (find's count, a page menu, a peek's sheet). See fx.onBrowserCrashed.
   */
  'tab-crashed': [tab: Tab | undefined, browser: XULBrowser];
  /** After every render of the bar. */
  render: [];
  settings: [settings: Settings, changed: string[]];
  /**
   * The Ctrl key was released (the switcher commits): reason 'key' for the Control keyup, 'blur'
   * when the window lost focus with Ctrl down (no keyup will come; the switcher cancels).
   */
  'ctrl-up': [reason: 'key' | 'blur'];
  'page-message': [tab: Tab | undefined, name: string, data: unknown, from: PageSource];
  /** Firefox's delayed startup has run for this window. */
  ready: [];
  /** The window is closing: the last event (b.onDestroy runs after it). */
  closing: [];
}
export type BrowserEvent = keyof BrowserEvents;

/** A link the page wants opened somewhere other than the current tab. */
export interface OpenRequest {
  url: string;
  disposition: 'foreground-tab' | 'background-tab' | 'new-window' | 'save';
  /** A modified click on a link, or window.open / target=_blank (url may be empty for window.open('')). */
  source: 'click' | 'window-open';
  /** The tab whose page asked; undefined when the page is not in b.tabs (a peek). */
  opener: Tab | undefined;
  browser: XULBrowser;
  /**
   * The page's load data (ClickHandlerParent for clicks; nsIOpenURIInFrameParams for window.open):
   * triggeringPrincipal, originPrincipal, originStoragePrincipal, referrerInfo, policyContainer,
   * originAttributes ({ userContextId }), plus href / button / shiftKey / ctrlKey / altKey for
   * clicks and name for window.open. b.openLink(request, where) loads with it.
   */
  click: Record<string, any>;
}

/** Where b.openLink puts a page-derived URL. */
export type OpenWhere = 'tab' | 'tabshifted' | 'window' | 'current';

export interface OpenOptions extends fx.LoadPrincipals {
  /** For 'tab': position in b.tabs (default: the newTabPosition setting) and background. */
  index?: number;
  background?: boolean;
  /** For 'window'. */
  private?: boolean;
}

export interface PageLink {
  /** One-way message to the frame's page modules. */
  send(name: string, data?: unknown): void;
  /** Ask the frame's page modules; undefined when it has no document or nobody answers. */
  query<T = unknown>(name: string, data?: unknown): Promise<T | undefined>;
  /** One-way message to every frame of the tab. */
  sendAll(name: string, data?: unknown): void;
  /** Ask every frame of the tab; one entry per frame that answered. */
  queryAll<T = unknown>(name: string, data?: unknown): Promise<{ browsingContext: any; isTop: boolean; answer: T }[]>;
}

type Layer = { priority: number; handle: () => boolean };
type TabRef = Tab | number;

const SCROLL_THROTTLE = 80;
/** Longest wait between paint-driven samples that keep reading the same luma (see sampleFromPaint). */
const PAINT_BACKOFF_MAX = 2000;
const LIGHT_ABOVE = 0.56;
// HIDDEN_TAB_VALUE (model.ts): the session value on tabs b.openHidden made; they are closed on
// restore (nothing would show them).
/** Page actions that do nothing while a panel (panel-open on b.root) covers the page (see the header). */
const PAGE_ACTIONS_UNDER_PANEL: ReadonlySet<ActionId> = new Set<ActionId>([
  'back', 'forward', 'reload', 'hardReload', 'zoomIn', 'zoomOut', 'zoomReset', 'print', 'savePage', 'viewSource',
  'devtools', 'devtoolsConsole', 'devtoolsInspect', 'peekLink', 'openAsTab', 'downloadVideo',
]);

export class Browser {
  tabs: Tab[] = [];
  activeId = 0;
  /** Tab ids, most recently used first. */
  mru: number[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** #vitre-root: Deer's layer, mounted inside #tabbrowser-tabbox. Carries the theme-* class. */
  readonly root: HTMLElement;
  readonly bar: Bar;
  readonly omni: Omnibox;
  /** The key router (keys.ts). Set during boot, before the feature modules install. */
  keys!: Keys;
  homeTheme: Theme = 'clear';
  /** Resolves after Firefox's delayed startup for this window (lazy UI objects exist). */
  readonly whenReady: Promise<void>;
  ready = false;
  /** Names of the feature modules that installed, and the ones that threw. */
  modules: string[] = [];
  moduleErrors: { name: string; error: string }[] = [];
  readonly isPrivate = fx.isPrivate();
  readonly isPopup = fx.isPopup();

  private listeners = new Map<BrowserEvent, ((...args: any[]) => void)[]>();
  private actions = new Map<ActionId, (arg?: number) => void>();
  private services = new Map<string, unknown>();
  private serviceWaiters = new Map<string, ((v: unknown) => void)[]>();
  private escLayers: Layer[] = [];
  private closeLayers: Layer[] = [];
  private openInterceptors: ((request: OpenRequest) => boolean)[] = [];
  private anchors = new Map<string, AnchorRoute>();
  private byNode = new WeakMap<XULTab, Tab>();
  private barKeys: BarKeys | null = null;
  /** The window's pages listed as "under a hidden bar" while the bar is in hiding mode (pagearea.ts). */
  private pageArea: PageArea | null = null;
  /** When Ctrl+wheel last turned over a page (zoom shows in the pill for 2 s). */
  private wheelZoomAt = 0;
  private mruCycle: { index: number; order: number[] } | null = null;
  /** Themes held by modules (holdTheme), latest last. */
  private themeHolds: { theme: Theme }[] = [];
  private cleanups: (() => void)[] = [];
  private renderQueued = false;
  private sampleTimer = 0;
  private lastSample = 0;
  private sampleSeq = 0;
  /** Paint-driven sampling: the last luma read, the current back-off and when the next paint may sample. */
  private lastLuma: number | null = null;
  private paintBackoff = 0;
  private paintAllowedAt = 0;
  private pendingFromPaint = false;
  /** Tabs whose theme came from a real sample (the others still carry the start-up guess). */
  private sampled = new WeakSet<Tab>();
  /** While > 0 the tab list is not mirrored (b.openHidden). */
  private syncHeld = 0;
  /**
   * Tabs whose pending load ended without a document (stopped, or the server never answered):
   * Firefox keeps the typed address on a blank tab, so the address stays the tab's, but it is no
   * longer loading. Cleared by the next load (navigate, STATE_START).
   */
  private stoppedPending = new WeakSet<XULTab>();
  private resolveReady!: () => void;
  private destroyed = false;

  constructor() {
    this.whenReady = new Promise((resolve) => (this.resolveReady = resolve));
    this.root = this.mountRoot();
    this.bar = new Bar(this, {
      activate: (id) => this.activate(id),
      close: (id) => this.closeTab(id),
      newTab: () => this.run('newTab'),
      editAddress: () => this.editAddress(),
      back: () => this.run('back'),
      forward: () => this.run('forward'),
      reloadOrStop: (hard) => (this.active()?.loading ? this.run('stop') : this.run(hard ? 'hardReload' : 'reload')),
    });
    this.omni = new Omnibox(this, {
      go: (url, where) => {
        if (where === 'newTab') this.newTab(url);
        else if (this.active()) this.navigate(this.activeId, url);
      },
      switchTo: (win, tabId) => {
        win.vitre?.activate(tabId);
        if (win !== window) win.focus();
      },
      tabOut: (direction) => this.barKeys?.enter(direction),
      closed: () => this.focusPage(),
      // A permission prompt (a separate always-on-top window) would cover the field: hidden while open.
      visibility: () => fx.refreshDoorhangers(),
    });
  }

  // ---- startup (called by main.ts and VitreShell) ----

  /** DOMContentLoaded: settings, tab model, core UI, feature modules, first render. */
  boot(): void {
    this.step('settings', () => {
      const store = this.sys('VitreSettings');
      this.applySettings(store.get());
      this.cleanups.push(
        store.onChange((s, changed) => {
          this.applySettings(s);
          this.emit('settings', s, changed);
          this.render();
        })
      );
    });
    this.step('home', () => {
      // Home's glass (light or clear) is the same in every window; the Home page reports it.
      const home = this.sys('VitreHome');
      home.init();
      this.homeTheme = home.theme;
      this.cleanups.push(home.onTheme((theme) => this.setHomeTheme(theme)));
    });
    this.step('tabs', () => this.attachTabs());
    this.step('window state', () => this.watchWindowState());
    this.step('page area', () => (this.pageArea = new PageArea(this, () => this.bar.hiding)));
    this.step('title', () => fx.takeOverWindowTitle((browser) => this.windowTitle(browser)));
    this.step('keys', () => {
      this.keys = installKeys(this);
      this.barKeys = new BarKeys(this);
      // The focused address field closes first on Esc (it normally takes the key itself; this is
      // for Esc that arrives another way, such as the hardware Stop key).
      this.addEscLayer(70, () => this.omni.focused && this.omni.escape());
      // A tab switch must not blur the address field (Ctrl+T while typing, a new tab's field).
      fx.guardTabSwitchFocus(() => this.omni.focused);
      this.watchZoom();
    });
    this.step('anchors', () => installAnchors(this));
    this.step('window.open', () => this.watchWindowOpen());
    this.step('modules', () => installModules(this));
    this.step('render', () => this.render());
    this.sampleSoon(0);
  }

  /** Firefox's delayed startup has run: its lazy UI objects exist now. */
  delayedStartup(): void {
    if (this.ready) return;
    this.step('delayed startup', () => {
      fx.dropFocusRetarget();
      fx.takeOverOpenLocation(() => this.editAddress());
      installAnchorsDelayed(this);
      // Doorhangers are separate always-on-top windows: hidden while the address field is open.
      fx.suppressDoorhangersWhile(() => this.omni.open);
      this.keys?.delayed();
    });
    this.ready = true;
    this.resolveReady();
    this.emit('ready');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.emit('closing');
    this.destroyed = true;
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* the window is going away */
      }
    }
    clearTimeout(this.sampleTimer);
  }

  /** Run fn when the window closes (after the 'closing' event). Unsubscribe from process singletons here. */
  onDestroy(fn: () => void): void {
    this.cleanups.push(fn);
  }

  private step(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.sys('VitreShell').report(`window boot step "${name}" failed`, e);
    }
  }

  private mountRoot(): HTMLElement {
    const root = el('div', { id: 'vitre-root', class: `theme-${startTheme()}` });
    // Inside the tab box: it carries the neutral filter that lets glass sample the page (shell.css 3).
    const host = document.getElementById('tabbrowser-tabbox') ?? document.body;
    host.append(root);
    return root;
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    applyRebind(s.rebind);
    setSearchEngine(s.searchEngine);
  }

  /** The window title: "<title> – Deer" for a web page, "Deer" on Home; private windows say so. */
  private windowTitle(browser: XULBrowser): string {
    const brand = this.isPrivate ? 'Deer Private Browsing' : 'Deer';
    const t = this.tabFor(browser);
    let title = '';
    let url = '';
    if (t) {
      if (t.kind === 'home') return brand;
      title = t.title;
      url = t.url;
    } else {
      try {
        title = browser.contentTitle || '';
        url = browser.currentURI?.spec ?? '';
      } catch {
        /* no document */
      }
      if (isHomeUrl(url)) return brand;
    }
    const text = (title || url).replace(/\0/g, '').trim();
    return text ? `${text} – ${brand}` : brand;
  }

  // ---- module API ----

  on<K extends BrowserEvent>(event: K, fn: (...args: BrowserEvents[K]) => void): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
    return () => {
      const l = this.listeners.get(event);
      if (l) this.listeners.set(event, l.filter((x) => x !== fn));
    };
  }

  emit<K extends BrowserEvent>(event: K, ...args: BrowserEvents[K]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`Deer: listener for ${event} failed`, err);
      }
    }
  }

  /**
   * Offer a module's API to the other modules of this window (Peek, find, downloads, the settings
   * panel...). Modules install in any order: a consumer uses b.service(name) at the moment it needs
   * the API, or await b.whenService(name) at install time. Names and types: VitreServices (gecko.d.ts).
   */
  provide<K extends keyof VitreServices>(name: K, api: VitreServices[K]): void {
    this.services.set(name, api);
    for (const resolve of this.serviceWaiters.get(name) ?? []) resolve(api);
    this.serviceWaiters.delete(name);
  }

  /** The API another module provided, or undefined when that module is not installed (yet). */
  service<K extends keyof VitreServices>(name: K): VitreServices[K] | undefined {
    return this.services.get(name) as VitreServices[K] | undefined;
  }

  /** Resolves once the module has provided its API (never, if that module is not installed). */
  whenService<K extends keyof VitreServices>(name: K): Promise<VitreServices[K]> {
    const api = this.service(name);
    if (api !== undefined) return Promise.resolve(api);
    return new Promise((resolve) => {
      const list = this.serviceWaiters.get(name) ?? [];
      list.push(resolve as (v: unknown) => void);
      this.serviceWaiters.set(name, list);
    });
  }

  /**
   * Give an action (find, peekLink, downloads, settings...) its behaviour, or override a built-in.
   * Returns a function that puts back what was registered before.
   */
  registerAction(action: ActionId, fn: (arg?: number) => void): () => void {
    const before = this.actions.get(action);
    this.actions.set(action, fn);
    return () => {
      if (this.actions.get(action) !== fn) return;
      if (before) this.actions.set(action, before);
      else this.actions.delete(action);
    };
  }

  /**
   * Esc unwinds one layer per press. Lower priority runs first: menu 20, popover 30, latched
   * switcher 40, element full screen 50, panel 60, Deer field 70, parked find 90, peek 100.
   * handle() returns true when it used the Esc. Returns a function that removes the layer.
   */
  addEscLayer(priority: number, handle: () => boolean): () => void {
    const l = { priority, handle };
    this.escLayers.push(l);
    this.escLayers.sort((a, b) => a.priority - b.priority);
    return () => {
      this.escLayers = this.escLayers.filter((x) => x !== l);
    };
  }

  /** Ctrl+W acts on the topmost surface: panel (60), then peek (100), then the tab. */
  addCloseLayer(priority: number, handle: () => boolean): () => void {
    const l = { priority, handle };
    this.closeLayers.push(l);
    this.closeLayers.sort((a, b) => a.priority - b.priority);
    return () => {
      this.closeLayers = this.closeLayers.filter((x) => x !== l);
    };
  }

  /**
   * Return true from fn to take over a link the page wants opened in a new tab or window (Peek).
   * The interceptor registered last is asked first.
   */
  interceptOpen(fn: (request: OpenRequest) => boolean): () => void {
    this.openInterceptors.unshift(fn);
    return () => {
      this.openInterceptors = this.openInterceptors.filter((x) => x !== fn);
    };
  }

  /** Called by VitreShell's click hook and the window.open hook. True when an interceptor took the request. */
  offerOpen(request: Omit<OpenRequest, 'opener'>): boolean {
    const full: OpenRequest = { ...request, opener: this.tabFor(request.browser) };
    for (const fn of [...this.openInterceptors]) {
      try {
        if (fn(full)) return true;
      } catch (err) {
        console.error('Deer: open interceptor failed', err);
      }
    }
    return false;
  }

  /** window.open() and target=_blank from pages of this window go to the interceptors first. */
  private watchWindowOpen(): void {
    const where = fx.openWhere();
    fx.interceptWindowOpen(({ url, where: how, params, name }) => {
      if (!this.openInterceptors.length) return false;
      const browser: XULBrowser | null = params?.openerBrowser ?? null;
      if (!browser) return false;
      const background = how === where.background || (how !== where.foreground && fx.divertedLoadsInBackground());
      return this.offerOpen({
        url,
        disposition: background ? 'background-tab' : 'foreground-tab',
        source: 'window-open',
        browser,
        click: {
          href: url,
          name,
          triggeringPrincipal: params?.triggeringPrincipal,
          referrerInfo: params?.referrerInfo,
          policyContainer: params?.policyContainer,
          originAttributes: params?.openerOriginAttributes,
          isPrivate: !!params?.isPrivate,
        },
      });
    });
  }

  /**
   * A full-window overlay layer for a module's UI, inside #vitre-root.
   * z: peek 8, omni-scrim 9 (core), bar 10, find 12, omnibox 20, panels 30, switcher 40, menus 50,
   * tips 60 (core). A module layer at the scrim's z 9 paints above the dim only if it was created
   * after the core's (it always is: modules install after the Omnibox).
   */
  layer(id: string, z: number): HTMLElement {
    let layer = document.getElementById(`layer-${id}`);
    if (!layer) {
      layer = el('div', { id: `layer-${id}`, class: 'module-layer' });
      layer.style.zIndex = String(z);
      this.root.append(layer);
    }
    return layer;
  }

  /** Inject a module's CSS once. It applies to the whole chrome document: scope your selectors. */
  css(id: string, text: string): void {
    if (document.getElementById(`css-${id}`)) return;
    const st = el('style', { id: `css-${id}` });
    st.textContent = text;
    (document.head ?? document.documentElement).append(st);
  }

  /**
   * The element a native popup (permission doorhanger, extension popup, Firefox panel) hangs from.
   * Kinds: 'site' (the active pill) and 'menu' (the + circle); modules add their own with
   * setAnchor. Falls back to a point under the middle of the bar when nothing is registered.
   */
  anchor(kind: string): Element {
    let found: Element | null = null;
    try {
      found = this.anchors.get(kind)?.element() ?? null;
    } catch {
      found = null;
    }
    if (found?.isConnected && found.getClientRects().length) return found;
    let fallback = document.getElementById('vitre-anchor');
    if (!fallback) {
      fallback = el('div', { id: 'vitre-anchor' });
      fallback.style.cssText = 'position:absolute;left:50%;top:12px;width:1px;height:44px;pointer-events:none;';
      this.root.append(fallback);
    }
    return fallback;
  }

  /**
   * Register an anchor. `popups` lists the ids of Firefox popups (panel or menupopup ids) that the
   * anchor router hangs from this element, with `position` as XULPopupElement.openPopup takes it
   * (default 'bottomleft topleft', 8 px under the bar).
   */
  setAnchor(kind: string, fn: () => Element | null, opts: { popups?: string[]; position?: string } = {}): void {
    this.anchors.set(kind, { element: fn, popups: opts.popups ?? [], position: opts.position });
  }

  /** The registered anchor a popup id is routed to, if any (anchors.ts). */
  anchorFor(popupId: string): { kind: string; route: AnchorRoute } | null {
    if (!popupId) return null;
    for (const [kind, route] of this.anchors) if (route.popups.includes(popupId)) return { kind, route };
    return null;
  }

  /** Home's glass follows its background (light on bright wallpapers, clear on dark ones). */
  setHomeTheme(theme: Theme): void {
    this.homeTheme = theme;
    for (const t of this.tabs) if (t.url === HOME_URL) t.theme = theme;
    this.render();
  }

  /**
   * Hold the window's glass theme (window controls, bar, native popups) at `theme` while a module's
   * own full-window surface covers the page, so the glass is read against that surface rather than
   * the hidden page (the switcher's deck and grid: clear). Returns the release; the latest hold wins.
   */
  holdTheme(theme: Theme): () => void {
    const hold = { theme };
    this.themeHolds.push(hold);
    this.render();
    return () => {
      const i = this.themeHolds.indexOf(hold);
      if (i < 0) return;
      this.themeHolds.splice(i, 1);
      if (!this.destroyed) this.render();
    };
  }

  /** Hide Firefox's open panels (app menu, site information, doorhangers): a browser-first action moved on. */
  closePanels(): void {
    this.keys?.closePanels();
  }

  /** Run the Esc ladder; after the layers, Esc stops a loading page. True when something used it. */
  escape(): boolean {
    for (const l of [...this.escLayers]) if (l.handle()) return true;
    const t = this.active();
    if (t?.loading) {
      fx.stop();
      return true;
    }
    return false;
  }

  /** One of Deer's process singletons: b.sys('VitreSettings'). Add new ones to VitreSysModules (gecko.d.ts). */
  sys<K extends keyof VitreSysModules>(name: K): VitreSysModules[K] {
    return fx.sysModule(name);
  }

  /** Mean luma (0..1) of a rectangle of a page, in CSS px of the browser's box; null when it has no document. */
  luma(browser: XULBrowser, rect: { x: number; y: number; width: number; height: number }): Promise<number | null> {
    return fx.luma(browser, rect);
  }

  /** A compositor snapshot of a rectangle of a page (null = the visible area) at `scale`. Close the bitmap when done. */
  snapshot(browser: XULBrowser, rect: { x: number; y: number; width: number; height: number } | null, scale: number): Promise<ImageBitmap | null> {
    return fx.snapshot(browser, rect, scale);
  }

  /** The page side of a tab, of any <browser> (a peek's), or of one frame (its browsingContext). */
  page(target: TabRef | XULBrowser | { currentWindowGlobal: unknown }): PageLink {
    const context = (): any => {
      if (typeof target === 'number' || target instanceof Tab) return this.tab(target)?.browser?.browsingContext;
      if (target && typeof target === 'object' && 'localName' in target && (target as Element).localName === 'browser') return (target as XULBrowser).browsingContext;
      return target;
    };
    const walk = (bc: any, fn: (bc: any) => void): void => {
      if (!bc) return;
      fn(bc);
      for (const child of bc.children ?? []) walk(child, fn);
    };
    return {
      send: (name, data) => {
        try {
          fx.pageActor(context())?.send(name, data);
        } catch (err) {
          console.error(`Deer: page send ${name} failed`, err);
        }
      },
      query: async (name, data) => {
        const actor = fx.pageActor(context());
        return actor ? actor.query(name, data) : undefined;
      },
      sendAll: (name, data) => {
        walk(context(), (bc) => {
          try {
            fx.pageActor(bc)?.send(name, data);
          } catch {
            /* frame went away */
          }
        });
      },
      queryAll: async (name, data) => {
        const asks: Promise<{ browsingContext: any; isTop: boolean; answer: any }>[] = [];
        const top = context();
        walk(top, (bc) => {
          const actor = fx.pageActor(bc);
          if (!actor) return;
          asks.push(actor.query(name, data).then((answer: unknown) => ({ browsingContext: bc, isTop: bc === top, answer }), () => ({ browsingContext: bc, isTop: bc === top, answer: undefined })));
        });
        return (await Promise.all(asks)).filter((r) => r.answer !== undefined);
      },
    };
  }

  /** Called by the VitrePage parent actor for every ctx.send() from a page module. */
  receivePageMessage(browser: XULBrowser, name: string, data: unknown, from: { isTop: boolean; browsingContext: any }): void {
    const tab = this.tabFor(browser);
    if (tab && tab.id === this.activeId && from.isTop) {
      if (name === 'core:scroll') this.sampleThrottled();
      else if (name === 'core:pageshow' || name === 'core:ready') this.sampleSoon(0);
      else if (name === 'core:paint') this.sampleFromPaint();
    }
    this.emit('page-message', tab, name, data, { browser, ...from });
  }

  active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  /** A Tab from a Tab or an id. */
  tab(ref: TabRef | undefined): Tab | undefined {
    if (ref === undefined) return undefined;
    return typeof ref === 'number' ? this.tabs.find((t) => t.id === ref) : ref;
  }

  /** The Tab that owns a page's <browser> element (undefined for hidden tabs). */
  tabFor(browser: XULBrowser | null | undefined): Tab | undefined {
    if (!browser) return undefined;
    const node = fx.tabForBrowser(browser);
    const t = node ? this.byNode.get(node) : undefined;
    return t && this.tabs.includes(t) ? t : undefined;
  }

  // ---- tabs ----

  /**
   * Open a tab. Without a URL it opens Home with the address field ready for typing. Loads with
   * the system principal (see the header): page-derived URLs go through openLink. In a popup
   * window the tab opens in the most recent normal window (or a new one), as Firefox does.
   */
  newTab(url?: string, opts: { background?: boolean; index?: number } = {}): Tab | undefined {
    if (this.isPopup) {
      const home = this.normalWindow();
      if (home?.vitre) {
        const t = home.vitre.newTab(url, opts);
        home.focus();
        return t;
      }
      fx.newWindow({ private: this.isPrivate, url: url || undefined });
      return undefined;
    }
    const t = this.addTab(url || fx.newTabUrl(), { background: !!opts.background, index: opts.index });
    // The field opens on the new Home tab only if it is still the active one when the frame comes
    // (Ctrl+T, Ctrl+W at once), and once element full screen, which a new tab ends, is really over.
    if (!url && !opts.background && t) {
      const edit = (): void => {
        if (this.destroyed || this.active() !== t || t.kind !== 'home') return;
        if (fx.inDOMFullscreen()) fx.onDOMFullscreenExit(() => requestAnimationFrame(edit), true);
        else this.editAddress();
      };
      requestAnimationFrame(edit);
    }
    return t;
  }

  private addTab(url: string, opts: { background: boolean; index?: number; principals?: fx.LoadPrincipals }): Tab | undefined {
    const activeIndex = this.tabs.findIndex((x) => x.id === this.activeId);
    const index = opts.index ?? (this.settings.newTabPosition === 'next' && activeIndex >= 0 ? activeIndex + 1 : this.tabs.length);
    const node = fx.addTab(url, { background: opts.background, tabIndex: this.engineIndex(index), principals: opts.principals });
    if (!this.byNode.has(node)) this.syncTabs();
    const t = this.byNode.get(node);
    // TabOpen came before the load was asked for: read the pending address now, so the Tab is right
    // for the caller at once (not only from the first progress event).
    if (t && this.refresh(t)) {
      this.emit('tab-updated', t);
      this.renderSoon();
    }
    this.flushRender();
    return t;
  }

  /** The most recent normal (non-popup) window of this privacy kind, other than this one. */
  private normalWindow(): Window | null {
    const win = fx.topBrowserWindow(this.isPrivate);
    return win && win !== window && !(win as any).closed ? win : null;
  }

  /**
   * Open a page-derived URL (a link, an image, a selection, an OpenRequest) the way Firefox opens a
   * link the page clicked: with the page's principal, referrer, policy container and container, so
   * chrome:, file:, about:config and the like are refused for a web page. Returns the Tab for
   * 'tab' / 'tabshifted', else undefined. Without a triggering principal the load is Deer's own
   * (system principal), as newTab.
   */
  openLink(target: string | OpenRequest, where: OpenWhere = 'tab', opts: OpenOptions = {}): Tab | undefined {
    const request = typeof target === 'string' ? null : target;
    const url = typeof target === 'string' ? target : target.url;
    if (!url) return undefined;
    const click = request?.click ?? {};
    const principals: fx.LoadPrincipals = {
      triggeringPrincipal: opts.triggeringPrincipal ?? click.triggeringPrincipal,
      originPrincipal: opts.originPrincipal ?? click.originPrincipal,
      originStoragePrincipal: opts.originStoragePrincipal ?? click.originStoragePrincipal,
      referrerInfo: opts.referrerInfo ?? click.referrerInfo,
      policyContainer: opts.policyContainer ?? click.policyContainer,
      userContextId: opts.userContextId ?? click.originAttributes?.userContextId,
      openerBrowser: opts.openerBrowser ?? request?.browser ?? null,
    };
    // A page cannot open what it could not load itself: nothing opens (not even a blank tab named
    // after the refused address). Deer's own loads carry the system principal and pass.
    const tp = principals.triggeringPrincipal as { isSystemPrincipal?: boolean } | null | undefined;
    if (tp && !tp.isSystemPrincipal && !fx.principalMayLoad(tp, url)) return undefined;
    if (where === 'tab' || where === 'tabshifted') {
      if (this.isPopup) {
        const home = this.normalWindow();
        if (home?.vitre) {
          const t = home.vitre.openLink(target, where, opts);
          home.focus();
          return t;
        }
        fx.newWindow({ private: this.isPrivate, url, principals });
        return undefined;
      }
      let background = opts.background ?? request?.disposition === 'background-tab';
      if (where === 'tabshifted') background = !background;
      return this.addTab(url, { background, index: opts.index, principals });
    }
    if (where === 'window') {
      fx.newWindow({ private: opts.private ?? this.isPrivate, url, principals });
      return undefined;
    }
    fx.openLinkIn(url, 'current', { ...principals, targetBrowser: this.active()?.browser });
    return undefined;
  }

  /** A new browser window, on Home or on a URL (loaded with the principals given, else Deer's own). */
  openWindow(url?: string, opts: { private?: boolean } & fx.LoadPrincipals = {}): void {
    const { private: isPrivate, ...principals } = opts;
    fx.newWindow({ private: isPrivate ?? false, url: url || undefined, principals });
  }

  /**
   * A real tab that is not in b.tabs and emits no tab events (a peek): opened in the background
   * and hidden before the model sees it. Load principals as openLink. Show it with b.adopt(node).
   */
  openHidden(url: string, opts: OpenOptions = {}): { node: XULTab; browser: XULBrowser } {
    const principals: fx.LoadPrincipals = { ...opts, openerBrowser: opts.openerBrowser ?? null };
    this.syncHeld++;
    let node: XULTab;
    try {
      node = fx.addTab(url, { background: true, principals: principals.triggeringPrincipal ? principals : undefined });
      fx.hideTab(node, 'vitre-peek');
      fx.setTabValue(node, HIDDEN_TAB_VALUE, '1');
    } finally {
      this.syncHeld--;
    }
    this.syncTabs();
    return { node, browser: node.linkedBrowser };
  }

  /** Put a hidden tab into the bar at `index` (default: after the active tab) and, by default, activate it. One tab-created. */
  adopt(node: XULTab, opts: { index?: number; activate?: boolean } = {}): Tab | undefined {
    fx.setTabValue(node, HIDDEN_TAB_VALUE, null);
    const activeIndex = this.tabs.findIndex((x) => x.id === this.activeId);
    const index = opts.index ?? (activeIndex >= 0 ? activeIndex + 1 : this.tabs.length);
    this.syncHeld++;
    try {
      fx.showTab(node);
      const at = this.tabs[Math.min(index, this.tabs.length - 1)];
      if (at && at.node !== node) fx.moveTab(node, at.node, index >= this.tabs.length ? 'after' : 'before');
    } finally {
      this.syncHeld--;
    }
    this.syncTabs();
    const t = this.byNode.get(node);
    // Something else already selected the hidden tab (DevTools, an extension): its TabSelect came
    // while it was not in b.tabs, so the selection is taken over now.
    if (t && fx.selectedTab() === node) this.onSelect();
    else if (t && opts.activate !== false) this.activate(t);
    this.flushRender();
    return t;
  }

  closeTab(ref: TabRef): void {
    const t = this.tab(ref);
    if (!t) return;
    // Firefox keeps the closed tab for Ctrl+Shift+T (SessionStore) and closes the window with its last tab.
    fx.removeTab(t.node);
    this.flushRender();
  }

  activate(ref: TabRef): void {
    const t = this.tab(ref);
    if (!t) return;
    if (fx.selectedTab() === t.node) {
      this.focusPage();
      return;
    }
    fx.selectTab(t.node);
    this.flushRender();
  }

  /** Load a user-typed or Deer-chosen URL in a tab (system principal; see the header). */
  navigate(ref: TabRef, url: string): void {
    const t = this.tab(ref);
    if (!t || !url) return;
    // The pill shows the address from now on, not the old page's, until the load commits.
    this.stoppedPending.delete(t.node);
    fx.setPendingUrl(t.browser, url);
    fx.loadURI(t.browser, url);
    this.onChanged(t.node, true);
  }

  /** Move a tab to a position in b.tabs. */
  moveTab(ref: TabRef, index: number): void {
    const t = this.tab(ref);
    if (!t) return;
    const from = this.tabs.indexOf(t);
    const to = Math.max(0, Math.min(this.tabs.length - 1, index));
    if (from < 0 || from === to) return;
    fx.moveTab(t.node, this.tabs[to].node, to < from ? 'before' : 'after');
    this.flushRender();
  }

  /** Mute or unmute a tab's sound. */
  toggleMute(ref: TabRef): void {
    const t = this.tab(ref);
    if (t) fx.toggleMute(t.node);
  }

  /** Tear a tab off into its own window. */
  moveToNewWindow(ref: TabRef): void {
    const t = this.tab(ref);
    if (t && this.tabs.length > 1) fx.moveTabToNewWindow(t.node);
  }

  /** Tabs Ctrl+Shift+T can bring back in this window. */
  closedCount(): number {
    return fx.closedTabCount();
  }

  /** Forget this window's closed tabs (Settings › Clear data). */
  forgetClosed(): void {
    fx.forgetClosedTabs();
  }

  focusPage(): void {
    try {
      fx.selectedBrowser().focus();
    } catch {
      /* no browser yet */
    }
  }

  editAddress(query?: string): void {
    // A popup window's pill is read-only, and in element full screen Deer's layer is not drawn.
    if (this.isPopup || fx.inDOMFullscreen()) return;
    // A panel hanging from the bar would sit over the field.
    this.closePanels();
    // The field opens where the pill is: bring the bar back first if it is hidden.
    this.bar.reveal();
    this.omni.show(this.bar.layout.pillRect, this.active(), { query });
  }

  /** Position in b.tabs -> position in gBrowser.tabs (which also counts hidden tabs). */
  private engineIndex(index: number): number | undefined {
    const nodes = fx.tabNodes();
    if (index >= this.tabs.length) {
      const last = this.tabs[this.tabs.length - 1];
      return last ? nodes.indexOf(last.node) + 1 : undefined;
    }
    return nodes.indexOf(this.tabs[Math.max(0, index)].node);
  }

  // ---- mirror of gBrowser ----

  private attachTabs(): void {
    const container = fx.tabContainer();
    const listen = (type: string, fn: (e: any) => void): void => {
      container.addEventListener(type, fn);
      this.cleanups.push(() => container.removeEventListener(type, fn));
    };
    for (const type of fx.TAB_EVENTS.sync) listen(type, () => this.syncTabs());
    listen('TabOpen', (e) => fx.titleFromLoadedPage(e.target));
    listen(fx.TAB_EVENTS.select, () => this.onSelect());
    for (const type of fx.TAB_EVENTS.changed) listen(type, (e) => this.onChanged(e.target));

    const START = Ci.nsIWebProgressListener.STATE_START;
    const STOP = Ci.nsIWebProgressListener.STATE_STOP;
    const NETWORK = Ci.nsIWebProgressListener.STATE_IS_NETWORK;
    const ERROR_PAGE = Ci.nsIWebProgressListener.LOCATION_CHANGE_ERROR_PAGE;
    const SAME_DOCUMENT = Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
    this.cleanups.push(
      fx.addTabsProgressListener({
        onLocationChange: (browser: XULBrowser, webProgress: any, _request: unknown, location: any, flags: number) => {
          if (!webProgress?.isTopLevel) return;
          const t = this.tabFor(browser);
          const url = location?.spec ?? '';
          const errorPage = !!(flags & ERROR_PAGE);
          if (t) {
            t.error = errorPage ? { code: 0, description: '', url } : null;
            this.onChanged(t.node, true);
            if (t.id === this.activeId) {
              if (!(flags & SAME_DOCUMENT)) this.resetPaintBackoff();
              this.sampleSoon(60);
            }
          }
          this.emit('tab-navigated', t, browser, { url, sameDocument: !!(flags & SAME_DOCUMENT), errorPage });
        },
        onStateChange: (browser: XULBrowser, webProgress: any, _request: unknown, state: number) => {
          if (!webProgress?.isTopLevel || !(state & NETWORK) || !(state & (START | STOP))) return;
          const t = this.tabFor(browser);
          if (t) {
            if (state & START) this.stoppedPending.delete(t.node);
            else this.stoppedPending.add(t.node);
            this.onChanged(t.node, true);
            if (state & STOP && t.id === this.activeId) this.sampleSoon(60);
          }
          this.emit('tab-loading', t, browser, !!(state & START));
        },
      })
    );

    // A page's process died: whatever shows that page treats it as context loss ('tab-crashed').
    this.cleanups.push(fx.onBrowserCrashed((browser) => this.emit('tab-crashed', this.tabFor(browser), browser)));

    // Session restore brings tabs back with their own last-used times, and hidden tabs Deer made
    // (peeks) that nothing will show again.
    this.cleanups.push(
      fx.onSessionRestored(() => {
        for (const node of fx.tabNodes()) {
          // Not into the closed-tab list either: Ctrl+Shift+T must not bring an orphan peek back as a tab.
          if (node.hidden && fx.getTabValue(node, HIDDEN_TAB_VALUE)) fx.removeTab(node, { skipSessionStore: true });
        }
        this.sortMru();
      })
    );

    this.syncTabs();
    this.sortMru();
    const selected = this.byNode.get(fx.selectedTab());
    if (selected) {
      this.activeId = selected.id;
      this.mru = [selected.id, ...this.mru.filter((m) => m !== selected.id)];
    }
  }

  /** Bring b.tabs in line with gBrowser: order, new tabs, closed or hidden tabs. */
  private syncTabs(): void {
    if (this.syncHeld > 0) return;
    const next: Tab[] = [];
    const created: Tab[] = [];
    for (const node of fx.tabNodes()) {
      if (node.closing || node.hidden) continue;
      let t = this.byNode.get(node);
      if (!t || !this.tabs.includes(t)) {
        if (!t) {
          t = new Tab(node);
          this.byNode.set(node, t);
        }
        this.refresh(t);
        created.push(t);
      }
      next.push(t);
    }
    const gone = this.tabs.filter((t) => !next.includes(t));
    this.tabs = next;
    for (const t of gone) {
      this.mru = this.mru.filter((m) => m !== t.id);
      if (this.mruCycle) this.mruCycle.order = this.mruCycle.order.filter((m) => m !== t.id);
      this.emit('tab-closed', t);
    }
    for (const t of created) {
      // A tab opened in the background is the most likely next target; a foreground one moves to the
      // front on its TabSelect.
      this.mru.splice(Math.min(1, this.mru.length), 0, t.id);
      this.emit('tab-created', t);
    }
    this.renderSoon();
  }

  private onSelect(): void {
    this.syncTabs();
    const t = this.byNode.get(fx.selectedTab());
    if (!t || !this.tabs.includes(t)) return;
    this.activeId = t.id;
    this.resetPaintBackoff();
    if (!this.mruCycle) this.mru = [t.id, ...this.mru.filter((m) => m !== t.id)];
    this.refresh(t);
    if (this.omni.open) this.omni.close();
    // A panel hanging from the old tab's pill (site information, a doorhanger) is about another page.
    this.closePanels();
    this.renderSoon();
    this.sampleSoon(0);
    this.emit('tab-activated', t);
  }

  private onChanged(node: XULTab, force = false): void {
    const t = this.byNode.get(node);
    if (!t || !this.tabs.includes(t)) return;
    if (!this.refresh(t) && !force) return;
    this.emit('tab-updated', t);
    this.renderSoon();
  }

  /** Read a tab's state from Firefox. Returns whether anything changed. */
  private refresh(t: Tab): boolean {
    const node = t.node;
    const before = `${t.url}\n${t.title}\n${t.favicon}\n${t.loading}\n${t.canBack}\n${t.canForward}\n${t.deferred}\n${t.pinned}\n${t.crashed}\n${t.audible}\n${t.muted}\n${t.zoom}`;
    const state = fx.tabState(node);
    t.url = fx.tabUrl(node);
    // Home, or a blank tab nothing was asked of. A load on its way shows its address (fx.tabUrl).
    t.kind = isHomeUrl(t.url) ? 'home' : 'web';
    t.title = state.title;
    t.favicon = fx.tabIcon(node);
    // Busy, or a load asked for that has not produced its first progress event yet (the address
    // is already the tab's: a tab is never "loaded" while it still shows its initial page), unless
    // that load already ended without a document.
    t.loading = state.loading || (fx.hasPendingLoad(node) && !this.stoppedPending.has(node));
    t.deferred = state.deferred;
    t.ready = !t.deferred;
    t.pinned = state.pinned;
    t.crashed = state.crashed;
    t.audible = state.audible;
    t.muted = state.muted;
    try {
      const browser = t.browser;
      t.canBack = !t.deferred && !!browser.canGoBack;
      t.canForward = !t.deferred && !!browser.canGoForward;
      if (!t.deferred) t.zoom = fx.zoomOf(browser);
    } catch {
      t.canBack = t.canForward = false;
    }
    if (t.url === HOME_URL) t.theme = this.homeTheme;
    const after = `${t.url}\n${t.title}\n${t.favicon}\n${t.loading}\n${t.canBack}\n${t.canForward}\n${t.deferred}\n${t.pinned}\n${t.crashed}\n${t.audible}\n${t.muted}\n${t.zoom}`;
    return before !== after;
  }

  private sortMru(): void {
    this.mru = [...this.tabs].sort((a, b) => fx.tabLastAccessed(b.node) - fx.tabLastAccessed(a.node)).map((t) => t.id);
  }

  /** Mirror the window's state on #vitre-root as classes: maximized, fullscreen, element-fullscreen. */
  private watchWindowState(): void {
    const apply = (): void => {
      const s = fx.windowState();
      this.root.classList.toggle('maximized', s.maximized);
      this.root.classList.toggle('fullscreen', s.fullscreen);
      this.root.classList.toggle('element-fullscreen', s.domFullscreen);
      this.root.classList.toggle('private', this.isPrivate);
      this.root.classList.toggle('popup', this.isPopup);
    };
    const observer = new MutationObserver(() => {
      apply();
      this.renderSoon();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: fx.WINDOW_STATE_ATTRIBUTES });
    this.cleanups.push(() => observer.disconnect());
    const resized = (): void => this.renderSoon();
    window.addEventListener('resize', resized);
    this.cleanups.push(() => window.removeEventListener('resize', resized));
    apply();
    // A doorhanger asked for in element full screen opened without an anchor: hang it from the pill now.
    this.cleanups.push(fx.onDOMFullscreenExit(() => window.setTimeout(() => fx.refreshDoorhangers(), 0)));

    // The colour scheme is not settled at DOMContentLoaded (Firefox applies its theme a little later,
    // still before the first paint). Tabs that have not been sampled yet follow it, so the first frame
    // does not show light glass over a dark blank page.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const schemeChanged = (): void => {
      const guess = startTheme();
      for (const t of this.tabs) if (!this.sampled.has(t) && t.url !== HOME_URL) t.theme = guess;
      this.render();
    };
    scheme.addEventListener('change', schemeChanged);
    this.cleanups.push(() => scheme.removeEventListener('change', schemeChanged));
  }

  // ---- rendering ----

  /** The glass theme right now: the active tab's, unless a module holds it (holdTheme). */
  theme(): Theme {
    const held = this.themeHolds[this.themeHolds.length - 1];
    if (held) return held.theme;
    return this.active()?.theme ?? 'clear';
  }

  /** Draw the bar now and tell modules ('render'). Engine events batch into one render per task. */
  render(): void {
    this.renderQueued = false;
    const theme = this.theme();
    this.root.classList.remove('theme-light', 'theme-dark', 'theme-clear');
    this.root.classList.add(`theme-${theme}`);
    // Native popups are outside #vitre-root: they read the theme from the document root.
    document.documentElement.setAttribute('vitre-theme', theme);
    this.bar.render(this.tabs, this.activeId);
    // The bar's hiding mode is settled by bar.render (reveal.ts update): the page list follows it.
    this.pageArea?.update();
    this.emit('render');
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      if (this.renderQueued && !this.destroyed) this.render();
    });
  }

  private flushRender(): void {
    if (this.renderQueued) this.render();
  }

  // ---- glass theme: light or dark from the page under the bar ----

  private sampleSoon(delay: number): void {
    clearTimeout(this.sampleTimer);
    this.pendingFromPaint = false;
    this.sampleTimer = window.setTimeout(() => void this.sample(), delay);
  }

  /** Leading + trailing throttle: the theme keeps up during a long scroll instead of waiting for it to end. */
  private sampleThrottled(): void {
    // A scroll sample that is already due within 80 ms stands; a deferred paint sample gives way.
    if (this.sampleTimer && !this.pendingFromPaint) return;
    clearTimeout(this.sampleTimer);
    this.sampleTimer = 0;
    this.pendingFromPaint = false;
    const since = performance.now() - this.lastSample;
    if (since >= SCROLL_THROTTLE) void this.sample();
    else this.sampleTimer = window.setTimeout(() => void this.sample(), SCROLL_THROTTLE - since);
  }

  /**
   * The page repainted. On a page with a running compositor animation the snapshot a sample takes
   * repaints the page itself, which would feed the next sample for ever (four a second); on a static
   * page it causes no paint at all, so the echo cannot be told from a real repaint. The loop is
   * damped by its result instead: a paint-driven sample that reads the same luma as the last one
   * doubles the wait before the next paint may sample (250 ms up to PAINT_BACKOFF_MAX); a change in
   * luma, a scroll or a load resets it. A paint during the wait is sampled when the wait ends, so
   * a change made then is never lost.
   */
  private sampleFromPaint(): void {
    if (this.sampleTimer) return; // a sample is on its way anyway (scroll, load, or an earlier paint)
    const wait = Math.max(0, this.paintAllowedAt - performance.now());
    this.pendingFromPaint = true;
    this.sampleTimer = window.setTimeout(() => void this.sample(), wait);
  }

  /** Another page, or another document in this tab: paint-driven sampling starts afresh. */
  private resetPaintBackoff(): void {
    this.lastLuma = null;
    this.paintBackoff = 0;
    this.paintAllowedAt = 0;
  }

  private async sample(): Promise<void> {
    clearTimeout(this.sampleTimer);
    this.sampleTimer = 0;
    const fromPaint = this.pendingFromPaint;
    this.pendingFromPaint = false;
    this.lastSample = performance.now();
    const t = this.active();
    if (!t || this.destroyed) return;
    if (t.url === HOME_URL) {
      // Home reports its own background through setHomeTheme().
      if (t.theme !== this.homeTheme) {
        t.theme = this.homeTheme;
        this.render();
      }
      return;
    }
    if (t.deferred || t.crashed) return;
    const seq = ++this.sampleSeq;
    const l = this.bar.layout;
    const strip = { left: Math.max(0, l.left - 16), right: (l.right || window.innerWidth) + 16, height: 64 };
    let luma: number | null = null;
    try {
      luma = await fx.lumaUnderBar(t.browser, strip);
    } catch {
      luma = null; // the page went away mid-snapshot
    }
    if (luma === null || seq !== this.sampleSeq) return;
    const same = this.lastLuma !== null && Math.abs(luma - this.lastLuma) < 0.005;
    this.lastLuma = luma;
    if (!same) this.paintBackoff = 0;
    else if (fromPaint) this.paintBackoff = Math.min(PAINT_BACKOFF_MAX, Math.max(250, this.paintBackoff * 2));
    this.paintAllowedAt = performance.now() + this.paintBackoff;
    const theme: Theme = luma > LIGHT_ABOVE ? 'light' : 'dark';
    this.sampled.add(t);
    if (theme !== t.theme) {
      t.theme = theme;
      if (t.id === this.activeId) this.render();
    }
  }

  // ---- actions ----

  run(action: ActionId, arg?: number): void {
    // Find keys go to the topmost surface: an open panel (Settings, Downloads) searches itself.
    if ((action === 'find' || action === 'findNext' || action === 'findPrev') && this.root.classList.contains('panel-open')) {
      document.dispatchEvent(new CustomEvent('vitre:panel-find'));
      return;
    }
    // The other page keys have no page to act on while a panel covers it (header: Panels).
    if (PAGE_ACTIONS_UNDER_PANEL.has(action) && this.root.classList.contains('panel-open')) return;
    // A module may take over any action (the switcher owns Ctrl+Tab, for example).
    const custom = this.actions.get(action);
    if (custom) {
      custom(arg);
      return;
    }
    this.builtin(action, arg);
  }

  /**
   * The page that page keys act on: a focused peek first (the hook the Electron build has:
   * window.vitrePeek), else the active tab.
   */
  private pageTarget(): { browser: XULBrowser; peek: boolean } | null {
    const peek = window.vitrePeek?.browser?.() ?? null;
    if (peek && (this.keys?.current?.browser === peek || document.activeElement === peek)) return { browser: peek, peek: true };
    const t = this.active();
    return t && !t.deferred ? { browser: t.browser, peek: false } : null;
  }

  /** The built-in behaviour of an action, for overrides that only add to it. */
  builtin(action: ActionId, arg?: number): void {
    const t = this.active();
    // A popup window shows one page: the tab strip actions have nothing to act on there.
    const strip: ActionId[] = ['nextTab', 'prevTab', 'goTab', 'goLastTab', 'moveTabLeft', 'moveTabRight', 'nextTabMru', 'prevTabMru'];
    if (this.isPopup && strip.includes(action)) return;
    switch (action) {
      case 'newTab': this.newTab(); break;
      case 'closeTab': {
        for (const l of [...this.closeLayers]) if (l.handle()) return;
        if (t) this.closeTab(t);
        break;
      }
      case 'reopenClosed': {
        if (this.isPopup) {
          const home = this.normalWindow();
          if (home?.vitre) {
            home.vitre.run('reopenClosed');
            home.focus();
          }
          break;
        }
        fx.reopenClosed();
        break;
      }
      case 'newWindow': this.openWindow(undefined, { private: this.isPrivate }); break;
      case 'newPrivateWindow': this.openWindow(undefined, { private: true }); break;
      case 'closeWindow': fx.closeWindow(); break;
      case 'quit': fx.quit(); break;
      case 'nextTabMru': this.cycleMru(1); break;
      case 'prevTabMru': this.cycleMru(-1); break;
      case 'nextTab':
      case 'prevTab': {
        const i = this.tabs.findIndex((x) => x.id === this.activeId);
        const n = this.tabs.length;
        if (n > 1 && i >= 0) this.activate(this.tabs[(i + (action === 'nextTab' ? 1 : n - 1)) % n]);
        break;
      }
      case 'goTab': {
        const target = this.tabs[(arg ?? 1) - 1];
        if (target) this.activate(target);
        break;
      }
      case 'goLastTab': {
        const last = this.tabs[this.tabs.length - 1];
        if (last) this.activate(last);
        break;
      }
      case 'moveTabLeft':
      case 'moveTabRight': {
        if (!t) break;
        const j = this.tabs.indexOf(t) + (action === 'moveTabLeft' ? -1 : 1);
        if (j >= 0 && j < this.tabs.length) this.moveTab(t, j);
        break;
      }
      case 'focusAddress':
        // F6 and Shift+F6 (arg 6) move focus between the page and the address pill, both ways.
        // Ctrl+L, Alt+D and the Search key always open the field (and select the address).
        if (arg === 6 && this.omni.focused) this.omni.close();
        else this.editAddress();
        break;
      case 'history': this.editAddress(''); break;
      case 'goHome': {
        // The Home key goes to the Home tab: the one that is open, else a new one.
        const home = this.tabs.find((x) => x.url === HOME_URL);
        if (home) this.activate(home);
        else this.newTab();
        break;
      }
      // Home has no page to search: Ctrl+F focuses the search field there.
      case 'find': if (t?.kind === 'home') this.editAddress(); break;
      case 'fullscreen': fx.toggleFullScreen(); break;
      case 'back':
      case 'forward': {
        const p = this.pageTarget();
        if (!p) break;
        if (action === 'back') {
          if (p.browser.canGoBack) p.browser.goBack();
          // Back on a peek's first page closes the peek.
          else if (p.peek) window.vitrePeek?.close();
        } else if (p.browser.canGoForward) p.browser.goForward();
        break;
      }
      case 'reload':
      case 'hardReload': {
        const p = this.pageTarget();
        if (p) fx.reload(p.browser, action === 'hardReload');
        break;
      }
      case 'stop': this.escape(); break;
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomReset': {
        const p = this.pageTarget();
        if (!p) break;
        // The level shows in the pill from the moment it changes (FullZoomChange comes first).
        const zoomed = this.tabFor(p.browser);
        if (zoomed) zoomed.zoomFlash = Date.now() + 2000;
        const done = action === 'zoomIn' ? fx.zoomIn(p.browser) : action === 'zoomOut' ? fx.zoomOut(p.browser) : fx.zoomReset(p.browser);
        void done.then(() => this.zoomChanged(p.browser, true));
        break;
      }
      case 'devtools': fx.toggleDevTools(); break;
      case 'devtoolsConsole': fx.devToolsConsole(); break;
      case 'devtoolsInspect': fx.devToolsInspect(); break;
      case 'print': {
        const p = this.pageTarget();
        if (p) fx.print(p.browser);
        break;
      }
      case 'savePage': {
        const p = this.pageTarget();
        if (p && (p.peek || t?.kind === 'web')) fx.savePage(p.browser);
        break;
      }
      case 'viewSource': {
        const p = this.pageTarget();
        if (p && (p.peek || t?.kind === 'web')) fx.viewSource(p.browser);
        break;
      }
      default: break; // findNext, peek, downloads, settings, switcher...: their modules register them
    }
  }

  /** The zoom of a page changed: keep the tab current and show the level in the pill for 2 s. */
  private zoomChanged(browser: XULBrowser, flash: boolean): void {
    const t = this.tabFor(browser);
    if (!t || t.deferred) return;
    const zoom = fx.zoomOf(browser);
    const changed = Math.abs(zoom - t.zoom) > 0.001;
    t.zoom = zoom;
    if (flash) {
      t.zoomFlash = Date.now() + 2000;
      window.setTimeout(() => this.render(), 2050);
    }
    if (changed || flash) {
      this.emit('tab-updated', t);
      this.render();
    }
  }

  /**
   * Zoom that did not come through an action: Ctrl+wheel (Gecko zooms by itself) and the level a
   * site was left at being applied on navigation. Only a change right after a Ctrl+wheel shows in
   * the pill.
   */
  private watchZoom(): void {
    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey) this.wheelZoomAt = performance.now();
    };
    window.addEventListener('wheel', wheel, { capture: true, passive: true });
    this.cleanups.push(() => window.removeEventListener('wheel', wheel, { capture: true }));
    this.cleanups.push(fx.onFullZoomChange((browser) => this.zoomChanged(browser, performance.now() - this.wheelZoomAt < 400)));
  }

  /**
   * Ctrl+Tab without the switcher module: step through the tabs, most recently used first (or in
   * bar order, starting at the tab on the right, with Settings > Tabs > Order of tabs: Tab bar order).
   */
  private cycleMru(dir: 1 | -1): void {
    if (this.tabs.length < 2) return;
    if (!this.mruCycle) {
      let order = [...this.mru];
      if (this.settings.tabOrder === 'bar') {
        const ids = this.tabs.map((x) => x.id);
        const at = Math.max(0, ids.indexOf(this.activeId));
        order = [...ids.slice(at), ...ids.slice(0, at)];
      }
      this.mruCycle = { index: 0, order };
    }
    const c = this.mruCycle;
    if (!c.order.length) return;
    c.index = (c.index + dir + c.order.length) % c.order.length;
    this.activate(c.order[c.index]);
  }

  /** Letting go of Ctrl commits the MRU step. Called by the key router, which then emits 'ctrl-up'. */
  commitMru(): void {
    if (!this.mruCycle) return;
    this.mruCycle = null;
    this.mru = [this.activeId, ...this.mru.filter((m) => m !== this.activeId)];
  }
}
