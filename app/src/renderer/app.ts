import type { WebviewTag } from 'electron';
import { applyRebind, match, type ActionId } from '../shared/shortcuts';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { OpenUrlMessage, SessionData } from '../shared/types';
import { Bar } from './bar';
import { lens } from './glass';
import { icons } from './icons';
import { makeTab, type Tab, type Theme, ZOOM_STEPS } from './model';
import { installModules } from './modules';
import { Omnibox } from './omnibox';
import { setSearchEngine } from './url';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type BrowserEvent = 'tab-created' | 'webview-created' | 'tab-activated' | 'tab-closed' | 'tab-updated' | 'render' | 'settings' | 'ctrl-up' | 'key';
type Layer = { priority: number; handle: () => boolean };

export class Browser {
  tabs: Tab[] = [];
  activeId = 0;
  /** Most recently used first. */
  mru: number[] = [];
  closedStack: { url: string; title: string; index: number }[] = [];
  private mruCycle: { index: number; order: number[] } | null = null;
  private views = $('views');
  readonly bar: Bar;
  readonly omni: Omnibox;
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** Feature modules plug in through these. */
  private listeners = new Map<BrowserEvent, ((...args: any[]) => void)[]>();
  private actions = new Map<ActionId, (arg?: number) => void>();
  private escLayers: Layer[] = [];
  private closeLayers: Layer[] = [];
  private openInterceptors: ((m: OpenUrlMessage) => boolean)[] = [];
  private sampleTimer: number | null = null;
  private saveTimer: number | null = null;
  private fullscreen = false;
  homeTheme: Theme = 'clear';

  constructor() {
    this.bar = new Bar($('bar'), {
      activate: (id) => this.activate(id),
      close: (id) => this.closeTab(id),
      newTab: () => this.newTab(),
      editAddress: () => this.editAddress(),
      back: () => this.run('back'),
      forward: () => this.run('forward'),
      reloadOrStop: () => (this.active()?.loading ? this.run('stop') : this.run('reload')),
    });
    this.omni = new Omnibox({
      go: (url, where) => (where === 'newTab' ? this.newTab(url) : this.navigate(this.activeId, url)),
      switchTo: (id) => this.activate(id),
      tabs: () => this.tabs,
      activeId: () => this.activeId,
      closed: () => this.focusPage(),
    });
    this.setupWindowControls();
    this.setupKeys();
    window.vitre.onShortcut((m) => this.run(m.action, m.arg));
    window.vitre.onCtrlUp(() => {
      this.commitMru();
      this.emit('ctrl-up');
    });
    window.vitre.onOpenUrl((m) => {
      for (const fn of this.openInterceptors) if (fn(m)) return;
      const opener = this.tabs.findIndex((t) => t.webview?.getWebContentsId?.() === m.openerId);
      this.newTab(m.url, { background: m.disposition === 'background-tab', index: opener >= 0 ? opener + 1 : undefined });
    });
    window.vitre.settings.onChange((s) => {
      this.settings = s;
      applyRebind(s.rebind);
      setSearchEngine(s.searchEngine);
      this.emit('settings', s);
    });
    window.addEventListener('resize', () => this.render());
    $('error-retry').addEventListener('click', () => this.run('reload'));
  }

  // ---- module API ----

  on(event: BrowserEvent, fn: (...args: any[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event: BrowserEvent, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`listener for ${event} failed`, err);
      }
    }
  }

  /** Give an action (find, peekLink, downloads, settings...) its behaviour. */
  registerAction(action: ActionId, fn: (arg?: number) => void): void {
    this.actions.set(action, fn);
  }

  /**
   * Esc unwinds one layer per press. Lower priority runs first: menu 20, popover 30,
   * latched switcher 40, element full screen 50, panel 60, Vitre field 70, parked find 90, peek 100.
   * handle() returns true when it used the Esc.
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

  /** Return true to take over a link the page wants opened in a new tab or window (Peek). */
  interceptOpen(fn: (m: OpenUrlMessage) => boolean): void {
    this.openInterceptors.push(fn);
  }

  /** A full-window overlay layer for a module's UI. z: peek 8, bar 10, find 12, omnibox 20, panels 30, switcher 40, menus 50. */
  layer(id: string, z: number): HTMLElement {
    let el = document.getElementById(`layer-${id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `layer-${id}`;
      el.className = 'module-layer';
      el.style.zIndex = String(z);
      document.body.append(el);
    }
    return el;
  }

  /** Inject a module's CSS once. */
  css(id: string, text: string): void {
    if (document.getElementById(`css-${id}`)) return;
    const st = document.createElement('style');
    st.id = `css-${id}`;
    st.textContent = text;
    document.head.append(st);
  }

  /** Home's glass follows its background (light on bright wallpapers, clear on dark ones). */
  setHomeTheme(theme: Theme): void {
    this.homeTheme = theme;
    for (const t of this.tabs) if (t.kind === 'home') t.theme = theme;
    this.render();
  }

  escape(): boolean {
    for (const l of [...this.escLayers]) if (l.handle()) return true;
    const t = this.active();
    if (t?.loading && t.webview && t.ready) {
      t.webview.stop();
      return true;
    }
    return false;
  }

  tabForWebContents(id: number): Tab | undefined {
    return this.tabs.find((t) => t.webview && t.ready && t.webview.getWebContentsId() === id);
  }

  async start(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await window.vitre.settings.get()) };
    applyRebind(this.settings.rebind);
    setSearchEngine(this.settings.searchEngine);
    installModules(this);
    const wp = await window.vitre.wallpaper();
    const img = $<HTMLImageElement>('wallpaper');
    if (wp) img.src = wp;
    else document.body.classList.add('no-wallpaper');
    if (this.settings.homeBackground.kind === 'windows') {
      const wl = await window.vitre.wallpaperLuma();
      this.homeTheme = wl !== null && wl > 0.62 ? 'light' : 'clear';
    }

    const initial = await window.vitre.initialUrl();
    const saved = initial ? null : await window.vitre.session.load();
    if (initial) {
      this.newTab(initial);
    } else if (saved && saved.tabs.length) {
      for (const s of saved.tabs) {
        const t = makeTab(s.kind, s.url, s.title);
        t.deferred = s.kind === 'web';
        this.tabs.push(t);
      }
      const active = this.tabs[Math.min(saved.active, this.tabs.length - 1)];
      this.mru = this.tabs.map((t) => t.id);
      this.activate(active.id);
    } else {
      this.newTab();
    }
  }

  active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  // ---- tabs ----

  newTab(url?: string, opts: { background?: boolean; index?: number } = {}): Tab {
    const t = makeTab(url ? 'web' : 'home', url ?? '');
    const activeIndex = this.tabs.findIndex((x) => x.id === this.activeId);
    const index = opts.index ?? (this.settings.newTabPosition === 'next' && activeIndex >= 0 ? activeIndex + 1 : this.tabs.length);
    this.tabs.splice(Math.min(index, this.tabs.length), 0, t);
    this.emit('tab-created', t);
    if (url) this.createWebview(t, url);
    if (opts.background) {
      this.mru.splice(1, 0, t.id);
      this.render();
    } else {
      this.activate(t.id);
      if (!url) requestAnimationFrame(() => this.editAddress());
    }
    this.scheduleSave();
    return t;
  }

  closeTab(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = this.tabs[i];
    if (t.kind === 'web' && t.url) this.closedStack.push({ url: t.url, title: t.title, index: i });
    if (this.closedStack.length > 25) this.closedStack.shift();
    t.webview?.remove();
    this.tabs.splice(i, 1);
    this.emit('tab-closed', t);
    this.mru = this.mru.filter((m) => m !== id);
    if (!this.tabs.length) {
      window.vitre.win.close();
      return;
    }
    if (this.activeId === id) this.activate(this.mru[0] ?? this.tabs[Math.max(0, i - 1)].id);
    else this.render();
    this.scheduleSave();
  }

  activate(id: number): void {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    this.activeId = id;
    if (!this.mruCycle) this.mru = [id, ...this.mru.filter((m) => m !== id)];
    if (t.deferred && t.kind === 'web') {
      t.deferred = false;
      this.createWebview(t, t.url);
    }
    for (const x of this.tabs) x.webview?.classList.toggle('shown', x.id === id);
    $('home').classList.toggle('shown', t.kind === 'home');
    this.render();
    if (this.omni.open) this.omni.close();
    this.focusPage();
    this.sampleSoon(0);
    this.scheduleSave();
    this.emit('tab-activated', t);
  }

  navigate(id: number, url: string): void {
    const t = this.tabs.find((x) => x.id === id);
    if (!t || !url) return;
    if (/^(mailto|tel):/i.test(url)) {
      window.vitre.openExternal(url);
      return;
    }
    t.error = null;
    if (t.kind === 'home' || !t.webview) {
      t.kind = 'web';
      t.url = url;
      this.createWebview(t, url);
      this.activate(t.id);
    } else {
      t.url = url;
      if (t.ready) t.webview.loadURL(url).catch(() => undefined);
      else t.webview.src = url;
      this.render();
    }
    this.scheduleSave();
  }

  /** A page element with Vitre's settings, not yet attached. Peek uses this for its sheet. */
  makeWebview(url: string): WebviewTag {
    const wv = document.createElement('webview') as WebviewTag;
    wv.setAttribute('partition', 'persist:vitre');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes');
    wv.src = url;
    return wv;
  }

  /** The element every page lives in. Webviews must never be re-parented (that reloads them). */
  viewsRoot(): HTMLElement {
    return this.views;
  }

  /**
   * Turn a page that is already loaded (a peek being promoted) into a tab without reloading it.
   * The webview must already be inside viewsRoot().
   */
  adoptWebview(wv: WebviewTag, opts: { url: string; title: string; favicon?: string | null; index?: number; activate?: boolean }): Tab {
    const t = makeTab('web', opts.url, opts.title);
    t.favicon = opts.favicon ?? null;
    const activeIndex = this.tabs.findIndex((x) => x.id === this.activeId);
    this.tabs.splice(Math.min(opts.index ?? activeIndex + 1, this.tabs.length), 0, t);
    this.emit('tab-created', t);
    this.createWebview(t, opts.url, wv);
    if (opts.activate !== false) this.activate(t.id);
    else this.render();
    this.scheduleSave();
    return t;
  }

  private createWebview(t: Tab, url: string, existing?: WebviewTag): void {
    const wv = existing ?? this.makeWebview(url);
    t.webview = wv;
    t.ready = false;
    if (existing) {
      try {
        existing.getWebContentsId();
        t.ready = true;
        t.loading = existing.isLoading();
      } catch {
        /* not attached yet: dom-ready will set it */
      }
    }
    const update = () => this.tabChanged(t);

    wv.addEventListener('dom-ready', () => {
      t.ready = true;
      if (t.zoom !== 1) wv.setZoomFactor(t.zoom);
    });
    wv.addEventListener('did-start-loading', () => {
      t.loading = true;
      update();
    });
    wv.addEventListener('did-stop-loading', () => {
      t.loading = false;
      this.syncNav(t);
      update();
      this.sampleSoon(60);
    });
    wv.addEventListener('did-navigate', (e) => {
      t.url = e.url;
      t.error = null;
      t.favicon = null;
      this.syncNav(t);
      window.vitre.history.add(e.url, t.title);
      update();
      this.scheduleSave();
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return;
      t.url = e.url;
      this.syncNav(t);
      window.vitre.history.add(e.url, t.title);
      update();
      this.scheduleSave();
    });
    wv.addEventListener('page-title-updated', (e) => {
      t.title = e.title;
      window.vitre.history.title(t.url, e.title);
      update();
      this.scheduleSave();
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      t.favicon = e.favicons[0] ?? null;
      update();
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return;
      t.error = { code: e.errorCode, description: e.errorDescription, url: e.validatedURL };
      update();
    });
    wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('element-fullscreen'));
    wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('element-fullscreen'));
    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'page-key') this.run(e.args[0] as ActionId, (e.args[1] as number | null) ?? undefined);
      else if (e.channel === 'page-scroll' && t.id === this.activeId) this.sampleSoon(80);
    });
    wv.addEventListener('focus', () => {
      if (this.omni.open) this.omni.close();
    });
    if (!existing) this.views.append(wv);
    this.syncNav(t);
    this.emit('webview-created', t, wv);
  }

  private syncNav(t: Tab): void {
    if (!t.webview || !t.ready) return;
    try {
      t.canBack = t.webview.canGoBack();
      t.canForward = t.webview.canGoForward();
    } catch {
      /* not attached yet */
    }
  }

  private tabChanged(t: Tab): void {
    this.emit('tab-updated', t);
    if (t.id === this.activeId) {
      this.render();
    } else {
      this.bar.render(this.tabs, this.activeId, this.theme());
    }
  }

  // ---- rendering ----

  private theme(): Theme {
    const t = this.active();
    return t ? t.theme : 'clear';
  }

  render(): void {
    const t = this.active();
    const theme = this.theme();
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-clear');
    document.body.classList.add(`theme-${theme}`);
    this.bar.render(this.tabs, this.activeId, theme);
    const err = $('error');
    if (t?.error && t.kind === 'web') {
      err.hidden = false;
      $('error-detail').textContent = `${t.error.description || 'The page didn’t load'} (${t.error.url})`;
    } else {
      err.hidden = true;
    }
    document.title = t?.kind === 'web' ? `${t.title || t.url} – Vitre` : 'Vitre';
    this.emit('render');
  }

  private sampleSoon(delay: number): void {
    if (this.sampleTimer !== null) clearTimeout(this.sampleTimer);
    this.sampleTimer = window.setTimeout(() => this.sample(), delay);
  }

  /** Light or dark glass from the page under the bar. */
  private async sample(): Promise<void> {
    this.sampleTimer = null;
    const t = this.active();
    if (!t) return;
    if (t.kind === 'home' || !t.webview || !t.ready) {
      if (t.kind === 'home' && t.theme !== this.homeTheme) {
        t.theme = this.homeTheme;
        this.render();
      }
      return;
    }
    const l = this.bar.layout;
    const rect = { x: Math.max(0, Math.round(l.left - 16)), y: 0, width: Math.max(1, Math.round(l.right - l.left + 32)), height: 64 };
    const luma = await window.vitre.sampleLuma(t.webview.getWebContentsId(), rect);
    if (luma === null) return;
    const theme: Theme = luma > 0.56 ? 'light' : 'dark';
    if (theme !== t.theme) {
      t.theme = theme;
      if (t.id === this.activeId) this.render();
    }
  }

  focusPage(): void {
    const t = this.active();
    if (t?.kind === 'web' && t.webview) t.webview.focus();
  }

  editAddress(query?: string): void {
    this.omni.show(this.bar.layout.pillRect, this.active(), { query });
  }

  // ---- actions ----

  run(action: ActionId, arg?: number): void {
    // A module may take over any action (the switcher owns Ctrl+Tab, for example).
    // Find keys go to the topmost surface: an open panel (Settings, Downloads) searches itself.
    if ((action === 'find' || action === 'findNext' || action === 'findPrev') && document.body.classList.contains('panel-open')) {
      document.dispatchEvent(new CustomEvent('vitre:panel-find'));
      return;
    }
    const custom = this.actions.get(action);
    if (custom) {
      custom(arg);
      return;
    }
    const t = this.active();
    const wv = t?.webview && t.ready ? t.webview : null;
    switch (action) {
      case 'newTab': this.newTab(); break;
      case 'closeTab': {
        for (const l of [...this.closeLayers]) if (l.handle()) return;
        if (t) this.closeTab(t.id);
        break;
      }
      case 'reopenClosed': {
        const c = this.closedStack.pop();
        if (c) this.newTab(c.url, { index: c.index });
        break;
      }
      case 'newWindow': window.vitre.win.newWindow(); break;
      case 'closeWindow': window.vitre.win.close(); break;
      case 'nextTabMru': this.cycleMru(1); break;
      case 'prevTabMru': this.cycleMru(-1); break;
      case 'nextTab':
      case 'prevTab': {
        const i = this.tabs.findIndex((x) => x.id === this.activeId);
        const n = this.tabs.length;
        this.activate(this.tabs[(i + (action === 'nextTab' ? 1 : n - 1)) % n].id);
        break;
      }
      case 'goTab': {
        const target = this.tabs[(arg ?? 1) - 1];
        if (target) this.activate(target.id);
        break;
      }
      case 'goLastTab': this.activate(this.tabs[this.tabs.length - 1].id); break;
      case 'moveTabLeft':
      case 'moveTabRight': {
        const i = this.tabs.findIndex((x) => x.id === this.activeId);
        const j = i + (action === 'moveTabLeft' ? -1 : 1);
        if (j < 0 || j >= this.tabs.length) break;
        [this.tabs[i], this.tabs[j]] = [this.tabs[j], this.tabs[i]];
        this.render();
        this.scheduleSave();
        break;
      }
      case 'focusAddress': this.editAddress(); break;
      case 'history': this.editAddress(''); break;
      case 'fullscreen': window.vitre.win.toggleFullscreen(); break;
      case 'back': {
        // A focused peek gets Back first; on its first page Back closes it.
        const p = window.vitrePeek?.webview();
        if (p && document.activeElement === p) {
          if (p.canGoBack()) p.goBack();
          else window.vitrePeek?.close();
        } else if (wv?.canGoBack()) wv.goBack();
        break;
      }
      case 'forward': {
        const p = window.vitrePeek?.webview();
        if (p && document.activeElement === p) {
          if (p.canGoForward()) p.goForward();
        } else if (wv?.canGoForward()) wv.goForward();
        break;
      }
      case 'reload': if (t?.error && wv) { t.error = null; wv.reload(); } else wv?.reload(); break;
      case 'hardReload': wv?.reloadIgnoringCache(); break;
      case 'stop': this.escape(); break;
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomReset': {
        if (!t || !wv) break;
        const i = ZOOM_STEPS.findIndex((z) => z >= t.zoom - 0.001);
        t.zoom = action === 'zoomReset' ? 1 : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + (action === 'zoomIn' ? 1 : -1)))];
        wv.setZoomFactor(t.zoom);
        t.zoomFlash = Date.now() + 2000;
        this.render();
        window.setTimeout(() => this.render(), 2050);
        break;
      }
      case 'devtools': if (wv) (wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools()); break;
      case 'print': wv?.print(); break;
      case 'savePage': if (wv) window.vitre.savePage(wv.getWebContentsId()); break;
      case 'viewSource': if (t?.kind === 'web' && t.url) this.newTab(`view-source:${t.url}`, { index: this.tabs.indexOf(t) + 1 }); break;
      default: break;
    }
  }

  /** Ctrl+Tab: step through tabs in most-recently-used order; letting go of Ctrl commits. */
  private cycleMru(dir: 1 | -1): void {
    if (this.tabs.length < 2) return;
    if (!this.mruCycle) this.mruCycle = { index: 0, order: [...this.mru] };
    const c = this.mruCycle;
    c.index = (c.index + dir + c.order.length) % c.order.length;
    this.activate(c.order[c.index]);
  }

  private commitMru(): void {
    if (!this.mruCycle) return;
    this.mruCycle = null;
    this.mru = [this.activeId, ...this.mru.filter((m) => m !== this.activeId)];
  }

  // ---- keys while focus is in Vitre's own UI ----

  private setupKeys(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        const b = match({ key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat, composing: e.isComposing || e.keyCode === 229 });
        if (!b) return;
        // A Settings key-capture field takes every key itself.
        if ((e.target as HTMLElement)?.closest?.('[data-key-capture]')) return;
        const inField = (e.target as HTMLElement)?.tagName === 'INPUT';
        // Editing keys stay with the field; Esc belongs to the omnibox.
        if (inField && (b.action === 'stop' || (!e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.key)))) return;
        e.preventDefault();
        this.run(b.action, b.arg);
      },
      true,
    );
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Control') {
        this.commitMru();
        this.emit('ctrl-up');
      }
    });
  }

  private setupWindowControls(): void {
    (document.querySelector('#winctl .lens') as HTMLElement).style.backdropFilter = lens(108, 32);
    const min = $('win-min');
    const max = $('win-max');
    const close = $('win-close');
    min.innerHTML = icons.minimize;
    max.innerHTML = icons.maximize;
    close.innerHTML = icons.closeWin;
    min.addEventListener('click', () => window.vitre.win.minimize());
    max.addEventListener('click', () => window.vitre.win.toggleMaximize());
    close.addEventListener('click', () => window.vitre.win.close());
    $('drag-strip').addEventListener('dblclick', () => window.vitre.win.toggleMaximize());
    window.vitre.win.onState((s) => {
      max.innerHTML = s.maximized ? icons.restore : icons.maximize;
      max.setAttribute('aria-label', s.maximized ? 'Restore' : 'Maximize');
      this.fullscreen = s.fullscreen;
      document.body.classList.toggle('fullscreen', s.fullscreen);
      document.body.classList.toggle('maximized', s.maximized);
    });
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      const data: SessionData = {
        tabs: this.tabs.map((t) => ({ url: t.url, title: t.title, kind: t.kind })),
        active: Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId)),
      };
      window.vitre.session.save(data);
    }, 400);
  }
}

const browser = new Browser();
browser.start();
(window as unknown as { browser: Browser }).browser = browser;
