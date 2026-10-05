// Peek: Shift+click (or Shift+Enter, or Ctrl+Q) a link to open it in a glass sheet over the
// dimmed page. Esc, a click on the dim or Ctrl+W puts it back into its link; Alt+Enter, the
// Open as tab button or a double-click on the header turns it into a tab without reloading.
// Design: DESIGN-NOTES "Peek", keymap.json "Peek", boards PeekMotion, PeekOpen, PeekSpec.
import type { WebviewTag } from 'electron';
import type { Browser } from '../../app';
import { ZOOM_STEPS, type Tab } from '../../model';
import { displayHost } from '../../url';
import type { ActionId } from '../../../shared/shortcuts';
import type { OpenUrlMessage } from '../../../shared/types';
import { type Chord, OPEN_AS_TAB, isChord, parseChord } from './chord';
import { EASE, EXPAND, SPRING, tween } from './motion';
import { HEADER, Sheet, contentOf, poseView, reducedMotion, releaseView, sheetBox, windowBox, type Box, type Pose } from './sheet';
import { PEEK_CSS } from './style';
import { PeekView, type ViewEvents } from './view';

/** A link as the page module describes it (page CSS pixels). */
interface LinkInfo {
  id: number;
  href: string;
  rect: Box;
  row: Box | null;
}

/** Where a link is now, as the page module reports it (page CSS pixels). */
interface Where {
  rect: Box;
  row: Box | null;
}

interface Gesture {
  tab: number;
  info: LinkInfo;
  at: number;
}

interface Waiter {
  tab: number;
  url: string;
  resolve: (info: LinkInfo | null) => void;
  timer: number;
}

interface Warm {
  view: PeekView;
  tab: number;
  origin: LinkInfo | null;
  closedAt: number;
  timer: number;
}

type Phase = 'closed' | 'open' | 'closing' | 'promoting';

/** For other modules (address field Shift+Enter, link menu, find): window.vitrePeek. */
export interface PeekApi {
  /** Peek a URL over the active tab, growing from `origin` (window pixels) if given. */
  open(url: string, origin?: { x: number; y: number; width: number; height: number }): void;
  isOpen(): boolean;
  /** The page in the open sheet (the topmost surface for page keys). */
  webview(): WebviewTag | null;
  headerRect(): DOMRect | null;
  close(): boolean;
  promote(): void;
  /** Ctrl+Shift+T would bring back a closed peek (rather than a closed tab) right now. */
  canReopen(): boolean;
}

declare global {
  interface Window {
    vitrePeek?: PeekApi;
  }
}

const WARM_MS = 60_000;
const ESC_ESC_MS = 400;
const GESTURE_WAIT_MS = 300;
const isWeb = (url: string) => /^https?:/i.test(url);

function shrunk(s: Box): Box {
  return { x: s.x + s.w * 0.04, y: s.y + s.h * 0.04, w: s.w * 0.92, h: s.h * 0.92, r: s.r };
}

function padded(r: Box): Box {
  return { x: r.x - 4, y: r.y - 2, w: r.w + 8, h: r.h + 4, r: 4 };
}

/** Page CSS pixels to window pixels (the tab's page fills the window). */
function scaled(b: Box, zoom: number): Box {
  return { x: b.x * zoom, y: b.y * zoom, w: b.w * zoom, h: b.h * zoom, r: b.r * zoom };
}

/** A link's rectangle as the box the sheet grows from or shrinks into. */
function linkBox(rect: Box, zoom: number): Box {
  const b = scaled(rect, zoom);
  return { ...b, w: Math.max(8, b.w), h: Math.max(8, b.h), r: 6 };
}

export function install(b: Browser): void {
  b.css('peek', PEEK_CSS);
  new Peek(b);
}

class Peek implements ViewEvents {
  private sheet: Sheet;
  private phase: Phase = 'closed';
  private source: Tab | null = null;
  private origin: LinkInfo | null = null;
  /** Where a peek opened through the API grew from (window pixels), when there is no link. */
  private anchor: Box | null = null;
  private view: PeekView | null = null;
  /** A hop's page, loading under the current one until it paints. */
  private incoming: PeekView | null = null;
  private typed = false;
  private lastEsc = 0;
  private altLeft = { at: 0, repeat: false };
  private inFullscreen = false;
  private focused = false;
  /** A hop's cross-fade in progress; finishing it shows the new page and drops the old one. */
  private fade: { stop: () => void; finish: () => void } | null = null;
  private warm: Warm | null = null;
  private lastTabClosedAt = 0;
  /** The tab the accent wash is drawn over. */
  private washTab: number | null = null;
  private gestures: Gesture[] = [];
  private waiters = new Set<Waiter>();
  private requests = new Map<number, (value: unknown) => void>();
  private nextRequest = 1;

  constructor(private b: Browser) {
    this.sheet = new Sheet(b.viewsRoot(), {
      close: () => this.close(),
      promote: () => this.promote(),
      back: () => this.view?.act((wv) => wv.goBack()),
      retry: () => this.view?.act((wv) => wv.reload()),
      dimClick: (e) => this.dimClick(e),
      isPromoteKey: (e) => isChord(e, this.promoteKey()),
    });
    b.on('webview-created', (tab: Tab, wv: WebviewTag) => this.watchTab(tab, wv));
    b.on('tab-activated', (tab: Tab) => this.tabActivated(tab));
    b.on('tab-closed', (tab: Tab) => this.tabClosed(tab));
    b.interceptOpen((m) => this.intercept(m));
    b.registerAction('peekLink', () => void this.peekFromPage());
    b.registerAction('reopenClosed', () => this.reopenClosed());
    b.addEscLayer(100, () => this.escLayer());
    b.addCloseLayer(100, () => this.closeLayer());
    window.addEventListener('resize', () => this.relayout());
    window.vitrePeek = this.api();
  }

  // ---- triggers ----

  /** Every tab's page: link gestures and answers from the page module, and navigation. */
  private watchTab(tab: Tab, wv: WebviewTag): void {
    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'peek:gesture') this.gestureArrived(tab.id, e.args[0] as LinkInfo);
      else if (e.channel === 'peek:link' || e.channel === 'peek:where') this.requests.get(e.args[0] as number)?.(e.args[1]);
      else if (e.channel === 'page-scroll' && tab.id === this.b.activeId) this.clearWash(); // it would no longer sit on the row
    });
    // The page under the sheet went somewhere else: the link the peek came from is gone.
    wv.addEventListener('did-navigate', () => {
      if (tab === this.source && this.phase === 'open') {
        this.origin = null;
        this.anchor = null;
        this.close();
      }
    });
    // The dimmed page never keeps keyboard focus while its peek is open (closing the address
    // field hands focus back to the tab, for example): the keys belong to the peek.
    wv.addEventListener('focus', () => {
      if (tab !== this.source || this.phase !== 'open' || !this.view) return;
      this.focused = false;
      this.focusView(this.view);
    });
  }

  private intercept(m: OpenUrlMessage): boolean {
    // Links the peek's page opens in a new tab or window stay in the sheet; Ctrl+click still
    // makes a background tab.
    const v = this.view;
    if (v && this.phase === 'open' && v.webContentsId() === m.openerId) {
      if (m.disposition === 'background-tab') return false;
      v.act((wv) => void wv.loadURL(m.url).catch(() => undefined));
      return true;
    }
    if (m.disposition !== 'new-window') return false;
    const tab = this.b.tabForWebContents(m.openerId);
    if (!tab || tab.id !== this.b.activeId) return false;
    if (this.b.settings.shiftClick === 'window') {
      window.vitre.win.newWindow(m.url);
      return true;
    }
    if (!isWeb(m.url)) return false;
    // Peek only what the user asked for: a trusted Shift+click or Shift+Enter on this link.
    void this.claim(tab.id, m.url).then((info) => {
      if (info && tab.id === this.b.activeId) this.open(m.url, tab, info);
      else this.b.newTab(m.url, { index: this.b.tabs.indexOf(tab) + 1 });
    });
    return true;
  }

  private claim(tab: number, url: string): Promise<LinkInfo | null> {
    const hit = this.takeGesture(tab, url);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const w: Waiter = { tab, url, resolve, timer: 0 };
      w.timer = window.setTimeout(() => {
        this.waiters.delete(w);
        resolve(null);
      }, GESTURE_WAIT_MS);
      this.waiters.add(w);
    });
  }

  private gestureArrived(tab: number, info: LinkInfo): void {
    this.gestures.push({ tab, info, at: performance.now() });
    if (this.gestures.length > 8) this.gestures.shift();
    for (const w of this.waiters) {
      if (w.tab !== tab) continue;
      const hit = this.takeGesture(tab, w.url);
      if (!hit) continue;
      clearTimeout(w.timer);
      this.waiters.delete(w);
      w.resolve(hit);
    }
  }

  private takeGesture(tab: number, url: string): LinkInfo | null {
    const now = performance.now();
    const mine = this.gestures.filter((g) => g.tab === tab && now - g.at < 1500);
    // The same address, or (for a page that rewrote the link as it was clicked) the latest gesture.
    const g = mine.find((x) => x.info.href === url) ?? mine.filter((x) => now - x.at < 1000).pop();
    if (!g) return null;
    this.gestures = this.gestures.filter((x) => x.tab !== tab);
    return g.info;
  }

  /** Ctrl+Q: the focused link, or the link under the pointer. */
  private async peekFromPage(): Promise<void> {
    const tab = this.b.active();
    if (!tab || tab.kind !== 'web' || this.phase === 'closing' || this.phase === 'promoting') return;
    const info = await this.ask<LinkInfo>(tab, 'peek:query');
    if (info && isWeb(info.href) && tab.id === this.b.activeId) this.open(info.href, tab, info);
  }

  /** Ask the tab's page module something; null if it doesn't answer within `timeout` ms. */
  private ask<T>(tab: Tab, channel: string, args: unknown[] = [], timeout = 500): Promise<T | null> {
    const wv = tab.webview;
    if (!wv || !tab.ready) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = this.nextRequest++;
      const done = (value: unknown) => {
        clearTimeout(timer);
        this.requests.delete(id);
        resolve((value ?? null) as T | null);
      };
      const timer = window.setTimeout(() => done(null), timeout);
      this.requests.set(id, done);
      try {
        wv.send(channel, id, ...args);
      } catch {
        done(null);
      }
    });
  }

  // ---- open, hop ----

  private open(url: string, tab: Tab, link: LinkInfo | null, from?: Box): void {
    if (this.phase === 'promoting') return;
    if (this.phase === 'open' && this.source === tab) {
      this.hop(url, link);
      return;
    }
    if (this.phase !== 'closed') this.finishClose(true);
    this.clearWash();
    const v = this.takeWarm(url, tab) ?? new PeekView(this.b, url, this);
    this.source = tab;
    this.origin = link;
    this.anchor = link ? null : from ?? null;
    this.view = v;
    this.typed = false;
    this.lastEsc = 0;
    this.focused = false;
    v.wv.classList.remove('vt-peek-warm', 'vt-peek-leaving');
    v.muted(false);
    this.sheet.showSite(v.url, v.favicon, 0);
    this.sheet.covered(!v.painted);
    this.sheet.failed(v.failure);
    this.sheet.loading(v.loading);
    this.sheet.canGoBack(v.canGoBack());
    this.sheet.promoteLabel(this.promoteSpec());

    const S = sheetBox();
    const end: Pose = { box: S, off: HEADER };
    const reduced = reducedMotion();
    // Grow out of the link on the spring (400 ms); the scrim comes up underneath (240 ms).
    this.sheet.animate({
      from: reduced ? end : { box: from ?? (link ? linkBox(link.rect, tab.zoom || 1) : shrunk(S)), off: HEADER },
      to: end,
      ms: reduced ? 0 : 400,
      ease: SPRING,
      fade: { from: 0, to: 1, ms: reduced ? 150 : 80 },
      views: [{ wv: v.wv, layout: contentOf(end) }],
    });
    this.sheet.dimmed(true, reduced ? 150 : 240);
    this.phase = 'open';
    this.focusView(v);
    this.announce();
  }

  /** Shift+click another link on the dimmed page: the content cross-fades in place. */
  private hop(url: string, link: LinkInfo | null): void {
    const current = this.incoming ?? this.view;
    if (!current) return;
    if (link) {
      this.origin = link;
      this.anchor = null;
    }
    if (url === current.url || url === current.openedUrl) return;
    this.incoming?.destroy();
    const end: Pose = { box: sheetBox(), off: HEADER };
    const v = new PeekView(this.b, url, this);
    v.wv.classList.add('vt-peek-incoming');
    poseView(v.wv, contentOf(end), end, 0);
    this.incoming = v;
    this.typed = false;
    this.lastEsc = 0;
    this.sheet.showSite(url, null, reducedMotion() ? 150 : 200);
    this.sheet.loading(true);
    this.sheet.canGoBack(false);
  }

  /** The hop's page painted: fade it in over the old one, then let the old one go. */
  private settle(v: PeekView): void {
    const old = this.view;
    this.view = v;
    this.incoming = null;
    const ms = reducedMotion() ? 150 : 200;
    v.wv.classList.remove('vt-peek-incoming');
    this.endFade();
    const finish = () => {
      v.wv.style.opacity = '1';
      old?.destroy();
    };
    const stop = tween(
      ms,
      (t) => (v.wv.style.opacity = String(EASE(t / ms))),
      () => {
        this.fade = null;
        finish();
      },
    );
    this.fade = { stop, finish };
    this.sheet.covered(false, ms);
    this.refresh();
    this.focused = false;
    this.focusView(v);
  }

  private focusView(v: PeekView): void {
    if (this.focused || v !== this.view || this.phase !== 'open') return;
    const active = document.activeElement;
    // Don't take focus from the address field or a panel the user moved to meanwhile.
    if (active && active !== document.body && active !== v.wv && active.tagName !== 'WEBVIEW') return;
    v.wv.focus();
    if (v.ready()) this.focused = true;
  }

  // ---- close ----

  private close(): void {
    if (this.phase !== 'open' || !this.view) return;
    this.endFade();
    const v = this.view;
    this.incoming?.destroy();
    this.incoming = null;
    this.exitFullscreen();
    this.phase = 'closing';
    this.leaving(v);
    // The page under the dim may have moved (a banner loaded, say): hold the sheet still for the
    // moment it takes the page to say where the link is now, then shrink back into it.
    this.sheet.cancel();
    const t0 = performance.now();
    const tab = this.source;
    const anchor = this.anchor;
    void this.locate(tab, this.origin).then((where) => {
      const zoom = tab?.zoom || 1;
      if (this.view === v && this.phase === 'closing') this.shrink(v, where ? linkBox(where.rect, zoom) : anchor);
      const spot = where ? scaled(where.row ?? padded(where.rect), zoom) : anchor && padded(anchor);
      if (tab && spot) this.wash(tab, spot, t0);
    });
    this.sheet.dimmed(false, reducedMotion() ? 150 : 240);
    this.returnFocus();
    this.announce();
  }

  /** Where the link the peek came from is now; its first rectangle if the page doesn't say. */
  private async locate(tab: Tab | null, origin: LinkInfo | null): Promise<Where | null> {
    if (!tab || !origin) return null;
    const where = await this.ask<Where>(tab, 'peek:locate', [origin.id], 80);
    return where ?? { rect: origin.rect, row: origin.row };
  }

  /** Shrink back into the link (280 ms spring), fading over its last 120 ms. */
  private shrink(v: PeekView, into: Box | null): void {
    const S = sheetBox();
    const reduced = reducedMotion();
    this.sheet.animate({
      from: this.sheet.current ?? { box: S, off: HEADER },
      to: { box: reduced ? S : into ?? shrunk(S), off: HEADER },
      ms: reduced ? 0 : 280,
      ease: SPRING,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 0, ms: 120, delay: 180 },
      views: [{ wv: v.wv, layout: contentOf({ box: S, off: HEADER }) }],
      done: () => this.finishClose(true),
    });
  }

  /** End the peek now. `keep` leaves the page warm for 60 s so peeking it again is instant. */
  private finishClose(keep: boolean): void {
    this.endFade();
    this.exitFullscreen();
    const v = this.view;
    this.incoming?.destroy();
    this.incoming = null;
    this.sheet.hide();
    if (v) {
      if (keep && this.source && v.painted && !v.failure) this.keepWarm(v, this.source, this.origin);
      else v.destroy();
    }
    this.view = null;
    this.source = null;
    this.origin = null;
    this.anchor = null;
    this.phase = 'closed';
    this.announce();
  }

  /** The sheet and its page stop taking clicks while they shrink away. */
  private leaving(v: PeekView): void {
    this.sheet.leaving(true);
    v.wv.classList.add('vt-peek-leaving');
  }

  /** An accent wash on the link's row (window pixels), so the eye finds its place again (1120 ms). */
  private wash(tab: Tab, r: Box, t0: number): void {
    // Another peek (or another tab) may have come up while the page answered.
    if (tab.id !== this.b.activeId || this.phase === 'open' || this.phase === 'promoting') return;
    this.clearWash();
    this.washTab = tab.id;
    const el = document.createElement('div');
    el.className = 'vt-peek-wash';
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.style.borderRadius = `${r.r}px`;
    el.style.animationDelay = `${Math.max(0, 260 - (performance.now() - t0))}ms`;
    this.b.layer('peek', 8).append(el);
    el.addEventListener('animationend', () => el.remove());
    window.setTimeout(() => el.remove(), 1600);
  }

  private clearWash(): void {
    this.washTab = null;
    for (const el of document.querySelectorAll('#layer-peek > .vt-peek-wash')) el.remove();
  }

  /** Keyboard focus goes back to the page, on the link the peek came from. */
  private returnFocus(): void {
    const tab = this.source;
    const peek = this.view?.wv;
    if (!tab || tab.id !== this.b.activeId) return;
    this.b.focusPage();
    if (this.origin && tab.webview && tab.ready) {
      try {
        tab.webview.send('peek:focus', this.origin.id);
      } catch {
        /* the page went away */
      }
    }
    // Home has no page to take focus: don't leave it in the peek that is going away.
    if (peek && document.activeElement === peek) peek.blur();
  }

  /** After typing in the peek, a stray click or Esc Esc only bumps the sheet. */
  private nudge(): void {
    const v = this.view;
    if (reducedMotion() || !v) return;
    const els = [this.sheet.frame, this.sheet.chrome, v.wv];
    const set = (y: number) => els.forEach((el) => (el.style.translate = y ? `0 ${y}px` : ''));
    tween(300, (t) => set(-6 * Math.sin((Math.PI * t) / 300)), () => set(0));
  }

  private dimClick(e: MouseEvent): void {
    if (this.phase !== 'open' || e.button !== 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.shiftKey) void this.hopAt(e.clientX, e.clientY);
    else if (this.typed) this.nudge();
    else this.close();
  }

  /** Shift+click on the dim: the link under the pointer on the page beneath. */
  private async hopAt(x: number, y: number): Promise<void> {
    const tab = this.source;
    if (!tab) return;
    const z = tab.zoom || 1;
    const info = tab.kind === 'web' ? await this.ask<LinkInfo>(tab, 'peek:at', [x / z, y / z]) : null;
    if (this.phase !== 'open' || this.source !== tab) return;
    if (info && isWeb(info.href)) this.hop(info.href, info);
    else if (this.typed) this.nudge();
    else this.close();
  }

  // ---- open as tab ----

  private promote(): void {
    if (this.phase !== 'open' || !this.view || !this.source) return;
    this.endFade();
    const v = this.view;
    const src = this.source;
    this.incoming?.destroy();
    this.incoming = null;
    this.exitFullscreen();
    this.phase = 'promoting';
    const reduced = reducedMotion();
    const rise = reduced ? null : this.sheet.siteRect();
    const from: Pose = this.sheet.current ?? { box: sheetBox(), off: HEADER };
    const to: Pose = { box: windowBox(), off: 0 };
    // The page takes the whole window at once and shows through a clip that grows with the
    // sheet (380 ms, expand curve) while the header and rim give way.
    this.sheet.filling(true);
    this.sheet.animate({
      from: reduced ? to : from,
      to,
      ms: reduced ? 0 : 380,
      ease: EXPAND,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 1, ms: 0 },
      views: [{ wv: v.wv, layout: to.box }],
      viewFade: { from: 1, to: 1, ms: 0 },
      done: () => this.promoted(v, src),
    });
    this.sheet.dimmed(false, reduced ? 150 : 240);

    // Adopt now so the tab bar re-flows (420 ms) while the sheet grows. The page under the sheet
    // (or Home's wallpaper) stays visible until the sheet covers the window.
    src.webview?.classList.add('vt-peek-under');
    if (src.kind === 'home') document.getElementById('home')?.classList.add('vt-peek-under');
    v.release();
    const at = this.b.tabs.indexOf(src);
    const tab = this.b.adoptWebview(v.wv, {
      url: v.url,
      title: v.title || displayHost(v.url),
      favicon: v.favicon,
      index: src.kind === 'home' ? at : at + 1,
    });
    tab.zoom = v.zoom;
    if (rise) this.rise(rise, v);
    if (src.kind === 'home') this.b.closeTab(src.id); // promoting over Home replaces it
    this.view = null;
    this.announce();
  }

  /** The sheet fills the window: the page is an ordinary tab from here on. */
  private promoted(v: PeekView, src: Tab): void {
    releaseView(v.wv);
    v.wv.classList.remove('vt-peek-view');
    src.webview?.classList.remove('vt-peek-under');
    document.getElementById('home')?.classList.remove('vt-peek-under');
    this.sheet.hide();
    this.source = null;
    this.origin = null;
    this.phase = 'closed';
    this.announce();
  }

  /** The header's site rises into the tab bar as the new pill (420 ms spring, fading out). */
  private rise(from: DOMRect, v: PeekView): void {
    const pill = this.b.bar.layout.pillRect;
    if (!pill) return;
    const el = document.createElement('div');
    el.className = 'vt-peek-rise';
    el.setAttribute('aria-hidden', 'true');
    const fav = document.createElement('span');
    fav.style.display = 'flex';
    if (v.favicon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = v.favicon;
      fav.append(img);
    }
    const name = document.createElement('span');
    name.textContent = displayHost(v.url);
    el.append(fav, name);
    const set = (x: number, y: number, w: number, h: number) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    set(from.left - 8, from.top + from.height / 2 - 14, from.width + 16, 28);
    this.b.layer('peek-rise', 11).append(el);
    void el.offsetWidth;
    el.style.transition = ['left', 'top', 'width', 'height'].map((p) => `${p} 420ms var(--spring)`).join(', ');
    set(pill.x, pill.y, pill.width, pill.height);
    window.setTimeout(() => el.remove(), 640);
  }

  // ---- keys ----

  private escLayer(): boolean {
    if (this.phase === 'closing' || this.phase === 'promoting') return true;
    if (this.phase !== 'open') return false;
    if (this.inFullscreen) {
      // Leaving element full screen comes first; it settles back into the sheet.
      this.view?.act((wv) => void wv.executeJavaScript('document.exitFullscreen && document.exitFullscreen()').catch(() => undefined));
      return true;
    }
    this.close();
    return true;
  }

  private closeLayer(): boolean {
    if (this.phase === 'open') {
      this.close();
      return true;
    }
    return this.phase === 'closing' || this.phase === 'promoting';
  }

  /** Page-first keys pressed in the peek act on the peek; tab and window keys on the window. */
  private pageKey(v: PeekView, action: ActionId, arg?: number): void {
    switch (action) {
      case 'stop':
        this.b.escape();
        break;
      case 'back': {
        const held = this.altLeft.repeat && performance.now() - this.altLeft.at < 250;
        if (v.canGoBack()) v.act((wv) => wv.goBack());
        else if (!held) this.close(); // first page: Alt+Left closes (never on key repeat)
        break;
      }
      case 'forward':
        if (v.canGoForward()) v.act((wv) => wv.goForward());
        break;
      case 'reload':
        v.act((wv) => wv.reload());
        break;
      case 'hardReload':
        v.act((wv) => wv.reloadIgnoringCache());
        break;
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomReset':
        this.zoom(v, action);
        break;
      case 'devtools':
        v.act((wv) => (wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools()));
        break;
      case 'print':
        v.act((wv) => void wv.print().catch(() => undefined));
        break;
      case 'savePage': {
        const id = v.webContentsId();
        if (id !== null) window.vitre.savePage(id);
        break;
      }
      case 'viewSource':
        if (this.source) this.b.newTab(`view-source:${v.url}`, { index: this.b.tabs.indexOf(this.source) + 1 });
        break;
      case 'peekLink':
        break; // peeks don't nest
      default:
        this.b.run(action, arg);
    }
  }

  private zoom(v: PeekView, action: 'zoomIn' | 'zoomOut' | 'zoomReset'): void {
    const i = ZOOM_STEPS.findIndex((z) => z >= v.zoom - 0.001);
    const step = action === 'zoomIn' ? 1 : -1;
    v.zoom = action === 'zoomReset' ? 1 : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + step))];
    v.act((wv) => wv.setZoomFactor(v.zoom));
  }

  /** Keys the page module reports from inside the peek. */
  private peekKey(kind: string, repeat: boolean): void {
    if (kind === 'alt-left') {
      this.altLeft = { at: performance.now(), repeat };
    } else if (kind === 'alt-enter') {
      this.promote();
    } else if (kind === 'escape' && !repeat) {
      // The Esc that leaves full screen never counts toward Esc Esc.
      if (this.inFullscreen) {
        this.lastEsc = 0;
        return;
      }
      const now = performance.now();
      if (now - this.lastEsc > ESC_ESC_MS) {
        this.lastEsc = now;
        return;
      }
      this.lastEsc = 0;
      // Esc Esc: if the page let this Esc through, the Esc ladder has already closed the peek.
      // If the page used it, close anyway, unless the user typed here (then only bump).
      window.setTimeout(() => {
        if (this.phase !== 'open') return;
        if (this.typed) this.nudge();
        else this.close();
      }, 60);
    }
  }

  /** Ctrl+Shift+T brings back a peek closed in the last 60 s while its tab is active. */
  private reopenClosed(): void {
    const w = this.reopenable();
    const tab = this.b.active();
    if (w && tab) {
      void this.reopenWarm(w, tab);
      return;
    }
    const c = this.b.closedStack.pop();
    if (c) this.b.newTab(c.url, { index: c.index });
  }

  /** The warm peek, if it is what Ctrl+Shift+T brings back: its tab is active, no tab closed since. */
  private reopenable(): Warm | null {
    const w = this.warm;
    const tab = this.b.active();
    return w && tab && w.tab === tab.id && this.phase === 'closed' && w.closedAt > this.lastTabClosedAt ? w : null;
  }

  private async reopenWarm(w: Warm, tab: Tab): Promise<void> {
    let origin = w.origin;
    if (origin) {
      const where = await this.ask<Where>(tab, 'peek:locate', [origin.id]);
      origin = where ? { ...origin, ...where } : null;
    }
    if (this.warm === w && tab.id === this.b.activeId && this.phase === 'closed') this.open(w.view.url, tab, origin);
  }

  // ---- warm pages ----

  private keepWarm(v: PeekView, tab: Tab, origin: LinkInfo | null): void {
    this.dropWarm();
    v.wv.classList.add('vt-peek-warm');
    v.muted(true);
    const timer = window.setTimeout(() => this.dropWarm(), WARM_MS);
    this.warm = { view: v, tab: tab.id, origin, closedAt: Date.now(), timer };
  }

  private takeWarm(url: string, tab: Tab): PeekView | null {
    const w = this.warm;
    if (!w) return null;
    if (w.tab !== tab.id || (url !== w.view.url && url !== w.view.openedUrl)) {
      this.dropWarm();
      return null;
    }
    clearTimeout(w.timer);
    this.warm = null;
    return w.view;
  }

  private dropWarm(): void {
    if (!this.warm) return;
    clearTimeout(this.warm.timer);
    this.warm.view.destroy();
    this.warm = null;
  }

  // ---- the window and its tabs ----

  private tabActivated(tab: Tab): void {
    // Leaving the tab warm-closes its peek. A wash belongs to the page it was drawn over.
    if (tab.id !== this.washTab) this.clearWash();
    if ((this.phase === 'open' || this.phase === 'closing') && tab !== this.source) this.finishClose(true);
  }

  private tabClosed(tab: Tab): void {
    this.lastTabClosedAt = Date.now();
    if (this.warm?.tab === tab.id) this.dropWarm();
    if (tab === this.source && (this.phase === 'open' || this.phase === 'closing')) this.finishClose(false);
  }

  private relayout(): void {
    const v = this.view;
    if (this.phase !== 'open' || !v) return;
    this.sheet.cancel();
    if (this.inFullscreen) {
      const F = windowBox();
      poseView(v.wv, F, { box: F, off: 0 }, 1);
      return;
    }
    const p: Pose = { box: sheetBox(), off: HEADER };
    this.sheet.place(p, 1);
    poseView(v.wv, contentOf(p), p, 1);
    if (this.incoming) poseView(this.incoming.wv, contentOf(p), p, 0);
  }

  private exitFullscreen(): void {
    if (!this.inFullscreen) return;
    this.inFullscreen = false;
    document.body.classList.remove('element-fullscreen');
    this.view?.wv.classList.remove('vt-peek-full');
    this.view?.act((wv) => void wv.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => undefined));
  }

  // ---- view events ----

  promoteKey(): Chord {
    return parseChord(this.promoteSpec());
  }

  private promoteSpec(): string {
    return this.b.settings.rebind?.openAsTab || OPEN_AS_TAB;
  }

  changed(v: PeekView): void {
    if (v === this.view && this.phase === 'open') this.focusView(v);
    if (v === (this.incoming ?? this.view)) this.refresh();
  }

  painted(v: PeekView): void {
    if (this.phase !== 'open') return;
    if (v === this.incoming) {
      this.settle(v);
    } else if (v === this.view) {
      this.sheet.covered(false, reducedMotion() ? 150 : 200);
      this.sheet.failed(v.failure);
    }
  }

  /** The link was a download: fold the sheet into a circle that drops toward the downloads ring. */
  aborted(v: PeekView): void {
    if (v === this.incoming) {
      this.incoming = null;
      v.destroy();
      this.refresh();
      return;
    }
    if (v !== this.view || this.phase !== 'open') return;
    this.endFade();
    this.phase = 'closing';
    this.leaving(v);
    const reduced = reducedMotion();
    const from: Pose = this.sheet.current ?? { box: sheetBox(), off: HEADER };
    const ring: Box = { x: window.innerWidth - 116, y: window.innerHeight - 64, w: 44, h: 44, r: 22 };
    this.sheet.animate({
      from,
      to: reduced ? from : { box: ring, off: HEADER },
      ms: reduced ? 0 : 400,
      ease: SPRING,
      fade: reduced ? { from: 1, to: 0, ms: 150 } : { from: 1, to: 0, ms: 160, delay: 240 },
      views: [{ wv: v.wv, layout: contentOf({ box: sheetBox(), off: HEADER }) }],
      done: () => this.finishClose(false),
    });
    this.sheet.dimmed(false, reduced ? 150 : 240);
    this.returnFocus();
    this.announce();
  }

  ipc(v: PeekView, channel: string, args: unknown[]): void {
    if (v !== this.view || this.phase !== 'open') return;
    if (channel === 'page-key') this.pageKey(v, args[0] as ActionId, (args[1] as number | null) ?? undefined);
    else if (channel === 'peek:key') this.peekKey(String(args[0]), !!args[1]);
    else if (channel === 'peek:typed') this.typed = true;
  }

  /** Element full screen (a video) fills the window without becoming a tab, then settles back. */
  fullscreen(v: PeekView, on: boolean): void {
    if (v !== this.view || this.phase !== 'open') return;
    this.inFullscreen = on;
    document.body.classList.toggle('element-fullscreen', on);
    v.wv.classList.toggle('vt-peek-full', on);
    this.relayout();
  }

  private refresh(): void {
    const shown = this.incoming ?? this.view;
    if (!shown || this.phase !== 'open') return;
    this.sheet.showSite(shown.url, shown.favicon, 0);
    this.sheet.loading(shown.loading);
    this.sheet.canGoBack(!this.incoming && !!this.view?.canGoBack());
    if (!this.incoming && this.view?.painted) this.sheet.failed(this.view.failure);
  }

  // ---- plumbing ----

  private endFade(): void {
    const f = this.fade;
    this.fade = null;
    f?.stop();
    f?.finish();
  }

  private announce(): void {
    window.dispatchEvent(new CustomEvent('vitre:peek', { detail: { phase: this.phase } }));
  }

  private api(): PeekApi {
    return {
      open: (url, origin) => {
        const tab = this.b.active();
        if (!tab || !isWeb(url)) return;
        const from = origin ? { x: origin.x, y: origin.y, w: origin.width, h: origin.height, r: Math.min(22, origin.height / 2) } : undefined;
        this.open(url, tab, null, from);
      },
      isOpen: () => this.phase === 'open',
      webview: () => (this.phase === 'open' ? this.view?.wv ?? null : null),
      headerRect: () => (this.phase === 'open' ? this.sheet.headerRect() : null),
      close: () => {
        const was = this.phase === 'open';
        this.close();
        return was;
      },
      promote: () => this.promote(),
      canReopen: () => !!this.reopenable(),
    };
  }
}

