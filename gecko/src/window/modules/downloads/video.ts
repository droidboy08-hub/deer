// "Download this video" (boards VideoDownload, VideoPicker, VideoStates): a glass pill in the
// top-right corner of a hovered video (12 px in) with the quality that suits this screen; click
// opens the quality picker, Shift+click downloads that quality at once. While the video downloads
// the pill stays on it with live progress, then says Saved (Open). DRM video says "Protected
// video", a live stream "Live · can't be saved". Ctrl+Shift+D opens the picker for the page's main
// video; the active tab pill's download mark (b.bar.downloadMark()) does the same and shows
// whenever the page has media worth saving. Port of app/src/renderer/modules/downloads/video.ts.
//
// Gecko: the page side is src/actors/page/downloads.ts (messages downloads:*); the offer and the
// DRM state come from the engine's MediaWatch (b.sys('VitreDownloads').media), keyed by the tab's
// browserId; page rectangles (CSS px of the page) become window coordinates through the <browser>
// box and the tab's zoom.
import type { Browser, PageSource } from '../../browser';
import { el } from '../../dom';
import * as fx from '../../firefox';
import { scrollThumb } from '../../scrollthumb';
import { glass, lens } from '../../glass';
import type { Tab } from '../../model';
import { setTip } from '../../tips';
import type { DownloadView, PageVideo, StartOptions, VideoOffer, VideoOption } from '../../../modules/downloads/types';
import { asPolicy, policyConstant } from '../../../modules/downloads/referrer';
import * as f from './format';
import { ic, node } from './icons';
import type { Panel } from './panel';
import type { Ring } from './ring';
import type { DownloadStore } from './store';
import { leaveElementFullscreen } from './system';
import { ytdlpFirst } from '../../../modules/downloads/sites';

type PillMode = 'found' | 'downloading' | 'paused' | 'saved' | 'protected' | 'live';

interface Target {
  tabId: number;
  browserId: number;
  video: PageVideo;
}

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Sites whose terms often forbid saving: a one-line reminder on the first download from each. */
const TERMS_HOSTS = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|facebook\.com|fbcdn\.net|instagram\.com|tiktok\.com|x\.com|twitter\.com|vimeo\.com|twitch\.tv|reddit\.com|dailymotion\.com|soundcloud\.com|netflix\.com)$/i;
const TERMS_PREF = 'vitre.downloads.termsSeen';
export const TERMS_LINE = 'Check that the site’s terms allow saving its videos.';

function termsSeen(host: string): boolean {
  try {
    return (JSON.parse(Services.prefs.getStringPref(TERMS_PREF, '[]')) as string[]).includes(host);
  } catch {
    return false;
  }
}

function acknowledgeTerms(host: string): void {
  if (!TERMS_HOSTS.test(host) || termsSeen(host)) return;
  try {
    const seen = JSON.parse(Services.prefs.getStringPref(TERMS_PREF, '[]')) as string[];
    Services.prefs.setStringPref(TERMS_PREF, JSON.stringify([...seen, host].slice(-200)));
  } catch {
    /* the line shows again next time */
  }
}

/** The tallest video this screen shows at full size (device pixels). */
function screenFit(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(Math.max(window.screen.height, window.screen.width * (9 / 16)) * dpr);
}

export class VideoUI {
  private hover: Target | null = null;
  /**
   * The video the pill stays on while its download runs ('download') or the picker is open
   * ('hold'). `waiting` until the started download shows up in the list.
   */
  private pinned: (Target & { key: string; why: 'download' | 'hold'; waiting: boolean }) | null = null;
  private offer: VideoOffer | null = null;
  private offers = new Map<string, { at: number; p: Promise<VideoOffer | null> }>();
  /** Each tab's address without its #fragment, to tell a single-page site's next video from a hash change. */
  private pages = new Map<number, string>();
  /** browserId -> media count (the mark) and protected state. */
  private media = new Map<number, { count: number; protected: boolean }>();
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private pill: HTMLElement;
  private face: HTMLElement;
  private mode: PillMode | null = null;
  private hideTimer = 0;
  private savedTimer = 0;
  private overPill = false;
  /** The page reported the pointer gone while it was on the pill or the picker. */
  private hoverLost = false;
  readonly picker: Picker;
  private lensWidth = 0;
  private sampled = '';

  constructor(
    private b: Browser,
    private store: DownloadStore,
    private ring: Ring,
    private panel: Panel
  ) {
    this.face = el('div', { class: 'vd-pill-face' });
    this.pill = el('div', { class: 'vd-pill' }, this.face);
    glass(this.pill);
    this.pill.setAttribute('inert', '');
    b.layer('downloads-video', 9).append(this.pill);
    this.picker = new Picker(b, this);
    // The panel is the topmost surface: a picker left under it would take the first Esc.
    panel.onShow(() => this.picker.close(false));
    this.pill.addEventListener('pointerenter', () => {
      this.overPill = true;
      this.pill.classList.add('hot');
      this.cancelHide();
    });
    this.pill.addEventListener('pointerleave', () => {
      this.overPill = false;
      this.pill.classList.remove('hot');
      if (this.hoverLost && !this.picker.isOpen) {
        // Back on the page: its next report (the video again, or nothing) decides.
        this.hoverLost = false;
        this.hover = null;
      }
      if (!this.hover) this.hideSoon();
    });
    this.pill.addEventListener('click', (e) => this.pillClick(e));

    b.on('page-message', (tab, name, data, from) => this.onPage(tab, name, data, from));
    b.on('tab-activated', () => this.reset());
    b.on('tab-closed', (tab) => {
      this.pointers.delete(tab.id);
      this.pages.delete(tab.id);
      if (this.pinned?.tabId === tab.id || this.hover?.tabId === tab.id) this.reset();
    });
    b.on('tab-navigated', (tab, _browser, info) => {
      if (!tab) return;
      if (info.sameDocument) {
        // A single-page site moved to another video (YouTube, X...): forget what the old address
        // played and the offers made for it; an address that only changed its #fragment is the same page.
        const page = info.url.replace(/#.*$/, '');
        const before = this.pages.get(tab.id);
        this.pages.set(tab.id, page);
        if (!before || before === page) return;
        this.offers.clear();
        if (this.hover?.tabId === tab.id || this.pinned?.tabId === tab.id) this.reset();
        const browserId = this.browserIdOf(tab);
        if (browserId) store.engine.media.pageChanged(browserId);
        this.refreshMedia(tab);
        return;
      }
      this.pages.set(tab.id, info.url.replace(/#.*$/, ''));
      if (this.hover?.tabId === tab.id || this.pinned?.tabId === tab.id) this.reset();
      // The engine drops a tab's media with its document; read the count again (media.ts header).
      this.refreshMedia(tab);
    });
    b.on('render', () => this.syncMark());
    const media = store.engine.media;
    b.onDestroy(
      media.subscribe((n) => {
        this.media.set(n.browserId, { count: n.count, protected: n.protected });
        this.syncMark();
        if (n.protected) this.onProtected(n.browserId);
      })
    );
    store.subscribe(() => this.renderPill());
    store.onAdded((ev) => {
      // A download from another window's tab flies there.
      const tab = ev.browserId ? this.tabByBrowserId(ev.browserId) : undefined;
      // From the open peek's page (not in b.tabs): it flies from the sheet's header (DESIGN-NOTES Peek).
      const fromPeek = !tab && ev.browserId && !ev.origin ? this.peekOrigin(ev.browserId) : null;
      if (ev.browserId && !tab && !ev.origin && !fromPeek) {
        this.ring.show();
        return;
      }
      // With the panel open the new row appears right there; the ring is under the dimmed page.
      if (this.panel.open) {
        this.ring.show();
        return;
      }
      const origin = ev.origin ?? fromPeek ?? this.recentPointer(tab?.id ?? this.b.activeId);
      this.ring.fly(origin, ev.view);
    });
    const resize = (): void => this.renderPill();
    window.addEventListener('resize', resize);
    b.onDestroy(() => window.removeEventListener('resize', resize));
  }

  // ---- helpers ----

  browserIdOf(tab: Tab | undefined): number {
    try {
      return Number(tab?.browser?.browsingContext?.browserId) || 0;
    } catch {
      return 0;
    }
  }

  private tabByBrowserId(id: number): Tab | undefined {
    return this.b.tabs.find((t) => this.browserIdOf(t) === id);
  }

  /** The centre of the open peek's header when the download came from the peek's page ('peek' service). */
  private peekOrigin(browserId: number): { x: number; y: number } | null {
    try {
      const peek = this.b.service('peek');
      if (!peek?.isOpen()) return null;
      const browser = peek.browser();
      if (!browser || Number(browser.browsingContext?.browserId) !== browserId) return null;
      const r = peek.headerRect();
      return r ? center(r) : null;
    } catch {
      return null;
    }
  }

  private refreshMedia(tab: Tab): void {
    const id = this.browserIdOf(tab);
    if (!id) return;
    const n = this.store.engine.media.notice(id);
    this.media.set(id, { count: n.count, protected: n.protected });
    this.syncMark();
  }

  /**
   * The page started DRM (a key session) after its offer was made: the open picker closes and the
   * pill says "Protected video" (a download already running for that video keeps its progress).
   */
  private onProtected(browserId: number): void {
    const t = this.target();
    const offer = this.offer;
    if (!t || t.browserId !== browserId || !offer || offer.state === 'protected') return;
    const dl = this.store.byVideo(offer.key);
    if (dl && (f.isActive(dl) || dl.state === 'paused')) return;
    this.offers.clear();
    this.picker.close(false);
    this.offer = { ...offer, state: 'protected', options: [], suggested: '' };
    this.renderPill();
  }

  /** The tab's media as the menus module and the mark see it. */
  mediaState(tab: Tab | undefined): { count: number; protected: boolean } {
    const id = this.browserIdOf(tab);
    if (!id) return { count: 0, protected: false };
    return this.store.engine.media.notice(id);
  }

  /** A rectangle in the page's CSS px as window coordinates. */
  private toWindow(tabId: number, r: PageVideo['rect']): { x: number; y: number; w: number; h: number } {
    const tab = this.b.tab(tabId);
    const z = tab?.zoom ?? 1;
    const box = tab?.browser?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    return { x: box.left + r.x * z, y: box.top + r.y * z, w: r.w * z, h: r.h * z };
  }

  // ---- page messages ----

  private onPage(tab: Tab | undefined, name: string, data: unknown, from: PageSource): void {
    // Alt+click comes from any page of the window, a peek's included (tab undefined).
    if (name === 'downloads:link') {
      this.altClick(tab, data, from);
      return;
    }
    if (!name.startsWith('downloads:') || !tab) return;
    switch (name) {
      case 'downloads:hover':
        this.onHover(tab, asVideo(data));
        break;
      case 'downloads:video-rect': {
        const d = data as { id?: unknown; rect?: unknown; view?: unknown } | null;
        if (d && typeof d.id === 'number') this.onRect(tab, d.id, asRect(d.rect), asView(d.view));
        break;
      }
      case 'downloads:pointer': {
        const d = data as { x?: unknown; y?: unknown } | null;
        if (d && typeof d.x === 'number' && typeof d.y === 'number') {
          const p = this.toWindow(tab.id, { x: d.x, y: d.y, w: 0, h: 0 });
          this.pointers.set(tab.id, { x: p.x, y: p.y, t: Date.now() });
        }
        break;
      }
      case 'downloads:element-media': {
        const d = data as { src?: unknown; kind?: unknown; frameUrl?: unknown; protected?: unknown } | null;
        const id = this.browserIdOf(tab);
        if (!id || !d || typeof d.src !== 'string' || d.src.length > 8192) break;
        if (d.protected === true) this.store.engine.media.eme(id, { encrypted: true });
        else this.store.engine.media.element(id, { url: d.src, kind: d.kind === 'audio' ? 'audio' : 'video', frameUrl: typeof d.frameUrl === 'string' ? d.frameUrl.slice(0, 8192) : '' });
        break;
      }
      case 'downloads:drm': {
        const id = this.browserIdOf(tab);
        if (id) this.store.engine.media.eme(id, { encrypted: true });
        break;
      }
    }
  }

  /**
   * Alt+click on a link (the page module prevented the click): the link is downloaded as the page's
   * own Save Link As would fetch it, through the 'downloads' service (index.ts): the frame's
   * principal and cookie jar (its WindowGlobalParent, never the page's word), its address as the
   * referrer under the link's policy (the page module read it with nsIReferrerInfo.initWithElement).
   * From a peek's page the file flies from the sheet's header (store.onAdded, peekOrigin).
   */
  private altClick(tab: Tab | undefined, data: unknown, from: PageSource): void {
    const d = data as { href?: unknown; policy?: unknown } | null;
    const href = d?.href;
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href) || href.length >= 8192) return;
    const page = fx.frameLoadData(from.browsingContext);
    if (!page) return;
    const info = Cc['@mozilla.org/referrer-info;1'].createInstance(Ci.nsIReferrerInfo);
    const policy = asPolicy(d?.policy);
    info.init(policyConstant(policy), policy !== 'no-referrer', page.documentURI);
    this.b.service('downloads')?.download(href, {
      browser: from.browser,
      triggeringPrincipal: page.principal,
      referrerInfo: info,
      cookieJarSettings: page.cookieJarSettings,
      origin: tab ? (this.recentPointer(tab.id) ?? undefined) : undefined,
    });
  }

  private onHover(tab: Tab, video: PageVideo | null): void {
    if (tab.id !== this.b.activeId) return;
    if (!video) {
      // The pointer went onto the pill (or the picker): the page lost it, the pill keeps its video.
      if (this.overPill || this.picker.isOpen) {
        this.hoverLost = true;
        return;
      }
      this.hover = null;
      this.hideSoon();
      return;
    }
    this.hoverLost = false;
    this.cancelHide();
    const browserId = this.browserIdOf(tab);
    const same = this.hover && this.hover.video.id === video.id && this.hover.tabId === tab.id;
    this.hover = { tabId: tab.id, browserId, video };
    if (this.pinned && this.pinned.tabId === tab.id && this.pinned.video.id === video.id) this.pinned.video = video;
    if (same && this.offer) {
      this.renderPill();
      return;
    }
    void this.resolve(this.hover).then((offer) => {
      if (this.hover?.video.id !== video.id || this.hover.tabId !== tab.id) return;
      if (this.pinned && this.pinned.video.id !== video.id) return;
      this.offer = offer;
      this.renderPill();
    });
  }

  private onRect(tab: Tab, id: number, rect: PageVideo['rect'] | null, view?: PageVideo['view']): void {
    if (!this.pinned || this.pinned.tabId !== tab.id || this.pinned.video.id !== id) return;
    if (!rect) {
      this.unpin();
      this.renderPill();
      return;
    }
    this.pinned.video = { ...this.pinned.video, rect, view: view ?? this.pinned.video.view };
    this.renderPill();
    this.picker.follow(this.pillRect());
  }

  resolve(t: Target, explicit = false): Promise<VideoOffer | null> {
    const count = this.media.get(t.browserId)?.count ?? 0;
    // Per document: the same <video> address on another page can come with other streams.
    let doc = 0;
    try {
      doc = Number(this.b.tab(t.tabId)?.browser.browsingContext?.currentWindowGlobal?.innerWindowId) || 0;
    } catch {
      doc = 0;
    }
    const tabUrl = this.b.tab(t.tabId)?.url ?? '';
    // An explicit request may run yt-dlp (seconds); a hover never does.
    const key = `${t.browserId}|${doc}|${tabUrl}|${t.video.src}|${t.video.frameSrc}|${t.video.protected}|${t.video.live}|${count}|${explicit && this.store.engine.hasYtdlp()}|${explicit}`;
    const hit = this.offers.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.p;
    for (const [k, v] of this.offers) if (Date.now() - v.at >= 60_000) this.offers.delete(k);
    const tab = this.b.tab(t.tabId);
    const p = this.store.engine.media
      .offer(t.browserId, t.video, { pageUrl: tab?.url ?? '', title: tab?.title ?? '', userContextId: tab?.node.userContextId ?? 0, isPrivate: this.b.isPrivate, fit: screenFit(), allowTools: explicit })
      .catch((e: unknown) => {
        console.warn('Deer downloads: offer failed', String(e));
        return null;
      });
    this.offers.set(key, { at: Date.now(), p });
    return p;
  }

  // ---- the pill ----

  private target(): Target | null {
    return this.pinned ?? this.hover;
  }

  private modeFor(offer: VideoOffer | null): { mode: PillMode | null; dl?: DownloadView } {
    if (!offer) return { mode: null };
    if (offer.state === 'protected') return { mode: 'protected' };
    if (offer.state === 'live') return { mode: 'live' };
    const dl = this.store.byVideo(offer.key);
    if (dl && (f.isActive(dl) || dl.state === 'paused')) return { mode: dl.state === 'paused' ? 'paused' : 'downloading', dl };
    if (dl && dl.state === 'completed' && Date.now() - dl.finishedAt < 6000) return { mode: 'saved', dl };
    return { mode: offer.state === 'ok' ? 'found' : null };
  }

  /** The pill's state, for tests. */
  get state(): { mode: PillMode | null; shown: boolean; rect: DOMRect; offer: VideoOffer | null; hover: boolean; pinned: string; overPill: boolean; hoverLost: boolean } {
    return { mode: this.mode, shown: this.pill.classList.contains('shown'), rect: this.pill.getBoundingClientRect(), offer: this.offer, hover: !!this.hover, pinned: this.pinned?.why ?? '', overPill: this.overPill, hoverLost: this.hoverLost };
  }

  renderPill(): void {
    this.letGoOfEnded();
    const t = this.target();
    const { mode, dl } = this.modeFor(t ? this.offer : null);
    if (!t || !mode || this.b.root.classList.contains('element-fullscreen') || t.tabId !== this.b.activeId) {
      this.setShown(false);
      return;
    }
    // "Saved" stays a few seconds, then the pill goes back to normal (or away).
    if (mode === 'saved' && !this.savedTimer && dl) {
      this.savedTimer = window.setTimeout(
        () => {
          this.savedTimer = 0;
          this.unpin();
          this.renderPill();
        },
        Math.max(500, 6000 - (Date.now() - dl.finishedAt))
      );
    }
    if (this.mode !== mode) {
      this.mode = mode;
      this.pill.dataset.mode = mode;
      this.pill.classList.toggle('quiet', mode === 'protected' || mode === 'live');
      this.face.replaceChildren(...faceOf(mode));
    }
    const opt = this.offer?.options.find((o) => o.id === this.offer?.suggested) ?? this.offer?.options[0];
    const q = (s: string): HTMLElement | null => this.face.querySelector(s);
    if (mode === 'found') {
      f.setText(q('.q'), opt?.label ?? '');
      const main = q('button');
      if (main) {
        main.setAttribute('aria-label', `Download this video${opt ? `, ${opt.label}` : ''}`);
        main.setAttribute('aria-expanded', String(this.picker.isOpen));
        setTip(main, 'Download this video', 'Ctrl+Shift+D');
      }
    } else if ((mode === 'downloading' || mode === 'paused') && dl) {
      const pct = f.percent(dl);
      q('.arc')?.setAttribute('stroke-dasharray', `${(Math.max(0.03, pct / 100) * 44).toFixed(1)} 44`);
      const starting = dl.state === 'starting' || dl.state === 'queued' || dl.phase === 'probing';
      f.setText(q('.pct'), dl.state === 'paused' ? 'Paused' : starting ? 'Starting' : dl.phase === 'merging' ? 'Saving' : dl.total > 0 ? `${pct}%` : f.bytes(dl.received) || 'Starting');
      f.setText(q('.rest'), [dl.state === 'paused' ? '' : f.speed(dl.speed), dl.quality].filter(Boolean).join(' · '));
      const btn = q('.vd-pill-small');
      if (btn && btn.dataset.k !== dl.state) {
        btn.dataset.k = dl.state;
        btn.replaceChildren(node(dl.state === 'paused' ? ic.play(11) : ic.pause(11)));
        btn.setAttribute('aria-label', dl.state === 'paused' ? 'Resume download' : 'Pause download');
      }
    }
    this.place(t);
    this.setShown(true);
  }

  /** A pinned download that ended without saving (failed, cancelled, removed) no longer holds the pill on its video. */
  private letGoOfEnded(): void {
    const p = this.pinned;
    if (!p || p.why !== 'download' || this.picker.isOpen) return;
    const dl = this.store.byVideo(p.key);
    if (p.waiting) {
      if (dl) p.waiting = false;
      return;
    }
    if (dl && (f.isActive(dl) || dl.state === 'paused' || (dl.state === 'completed' && Date.now() - dl.finishedAt < 6000))) return;
    this.unpin();
    if (!this.hover && !this.overPill) this.offer = null;
  }

  private place(t: Target): void {
    const r = this.toWindow(t.tabId, t.video.rect);
    const w = this.pill.offsetWidth || 168;
    const minTop = this.b.root.classList.contains('fullscreen') || this.b.bar.hidden ? 8 : 64;
    // 12 px inside the part of the video the page shows: a video wider than the page (zoomed in)
    // must not put the pill over the page's own scrollbar.
    const view = t.video.view && t.video.view.w > 0 ? this.toWindow(t.tabId, { x: 0, y: 0, w: t.video.view.w, h: t.video.view.h }) : null;
    const right = Math.min(window.innerWidth - 8, Math.min(r.x + r.w, view ? view.x + view.w : Infinity) - 12);
    const top = Math.max(minTop, r.y + 12);
    this.pill.style.left = `${Math.max(8, Math.round(right - w))}px`;
    this.pill.style.top = `${Math.round(Math.min(top, window.innerHeight - 44))}px`;
    if (w !== this.lensWidth) {
      this.lensWidth = w;
      (this.pill.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(w, 36, { radius: 18, scale: 14, blur: 2 });
    }
    this.sample(t, w);
  }

  /** Over a bright frame the glass needs a deeper tint for its white text (sampled once per video). */
  private sample(t: Target, w: number): void {
    const key = `${t.tabId}:${t.video.id}`;
    if (this.sampled === key) return;
    this.sampled = key;
    const tab = this.b.tab(t.tabId);
    if (!tab) return;
    const box = tab.browser.getBoundingClientRect();
    const x = parseFloat(this.pill.style.left) - box.left;
    const y = parseFloat(this.pill.style.top) - box.top;
    void this.b.luma(tab.browser, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: Math.round(w), height: 36 }).then((luma) => {
      if (this.sampled === key) this.pill.classList.toggle('bright', luma !== null && luma > 0.55);
    });
  }

  pillRect(): DOMRect {
    return this.pill.getBoundingClientRect();
  }

  private setShown(on: boolean): void {
    this.pill.classList.toggle('shown', on);
    if (on) this.pill.removeAttribute('inert');
    else this.pill.setAttribute('inert', '');
    if (!on) {
      this.mode = null;
      this.pill.dataset.mode = '';
    }
  }

  private hideSoon(): void {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = 0;
      if (this.hover || this.overPill || this.picker.isOpen) return;
      if (!this.pinned) this.offer = null;
      this.renderPill();
    }, 450);
  }

  private cancelHide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = 0;
  }

  private pillClick(e: MouseEvent): void {
    const t = this.target();
    const offer = this.offer;
    if (!t || !offer) return;
    const target = e.target as Element;
    const { dl } = this.modeFor(offer);
    if (this.mode === 'found') {
      if (e.shiftKey) {
        const opt = offer.options.find((o) => o.id === offer.suggested) ?? offer.options[0];
        if (opt) this.download(t, offer, opt, center(this.pillRect()));
      } else this.picker.toggle(t, offer, e.detail === 0);
    } else if ((this.mode === 'downloading' || this.mode === 'paused') && dl) {
      // The engine's state now, not the copy a frame behind (a quick second click resumes).
      if (target.closest('.vd-pill-small')) this.store.run((this.store.engine.get(dl.id) ?? dl).state === 'paused' ? 'resume' : 'pause', dl.id);
      else this.panel.show(dl.id);
    } else if (this.mode === 'saved' && dl && target.closest('.vd-pill-open')) {
      this.store.run('open', dl.id);
    }
  }

  // ---- downloading ----

  download(t: Target, offer: VideoOffer, opt: VideoOption, origin: { x: number; y: number }, dir?: string): void {
    const tab = this.b.tab(t.tabId);
    const opts: StartOptions = {
      mode: opt.mode,
      variantUrl: opt.variantUrl || undefined,
      audioUrl: opt.audioUrl || undefined,
      dashVideo: opt.dashVideo || undefined,
      dashAudio: opt.dashAudio || undefined,
      ytdlpFormat: opt.ytdlpFormat || undefined,
      ytdlpExt: opt.ytdlpExt || undefined,
      audioOnly: opt.group === 'audio',
      quality: opt.label,
      bytes: opt.bytes || undefined,
      videoKey: offer.key,
      title: offer.title,
      pageUrl: tab?.url ?? '',
      browserId: t.browserId,
      // The media a page's player fetched: the page is the loading principal, Origin is sent. An
      // embedded player's media its server only gives to that player goes out as the player's frame
      // (offer.requestPage); pageUrl stays the tab's page (the download's source).
      identity: { userContextId: tab?.node.userContextId ?? 0, withOrigin: true, firstParty: false, ...(offer.requestPage ? { requestPage: offer.requestPage } : {}) },
      origin,
      dir,
    };
    acknowledgeTerms(offer.host);
    // The page's media without a video on screen (Ctrl+Shift+D from the tab pill) has nothing to stay on.
    if (t.video.id >= 0) this.pin(t, offer.key, 'download');
    const id = this.store.start(opt.url, opts);
    if (!id) {
      if (this.pinned?.key === offer.key) this.unpin();
      // Refused because the page turned to DRM after its offer was made: the pill says so now.
      if (this.store.engine.media.isProtected(t.browserId)) {
        this.offers.clear();
        this.offer = { ...offer, state: 'protected', options: [], suggested: '' };
      }
      this.renderPill();
    }
  }

  private pin(t: Target, key: string, why: 'download' | 'hold'): void {
    this.unpin();
    this.pinned = { ...t, key, why, waiting: why === 'download' };
    window.clearTimeout(this.savedTimer);
    this.savedTimer = 0;
    this.b.page(t.tabId).send('downloads:pin', { id: t.video.id });
  }

  /** Keep the pill on this video while the picker is open, even if the pointer leaves it. */
  hold(t: Target): void {
    if (this.pinned?.video.id === t.video.id && this.pinned.tabId === t.tabId) return;
    this.pin(t, this.offer?.key ?? '', 'hold');
  }

  release(): void {
    if (this.hoverLost && !this.overPill) {
      this.hoverLost = false;
      this.hover = null;
    }
    const { mode } = this.modeFor(this.offer);
    if (mode === 'downloading' || mode === 'paused' || mode === 'saved') return;
    this.unpin();
    if (!this.hover && !this.overPill) this.hideSoon();
  }

  private unpin(): void {
    if (!this.pinned) return;
    if (this.b.tab(this.pinned.tabId)) this.b.page(this.pinned.tabId).send('downloads:pin', { id: null });
    this.pinned = null;
  }

  private reset(): void {
    this.picker.close(false);
    this.unpin();
    this.hover = null;
    this.hoverLost = false;
    this.offer = null;
    this.overPill = false;
    this.renderPill();
  }

  private recentPointer(tabId: number): { x: number; y: number } | null {
    const p = this.pointers.get(tabId);
    return p && Date.now() - p.t < 4000 ? { x: p.x, y: p.y } : null;
  }

  // ---- Ctrl+Shift+D and the tab pill's mark ----

  async downloadVideo(keyboard: boolean): Promise<void> {
    const tab = this.b.active();
    if (!tab || tab.kind !== 'web' || tab.deferred) return;
    if (this.picker.isOpen) {
      this.picker.close(true);
      return;
    }
    // Over a full-screen video (the menus' "Download video…", Ctrl+Shift+D) the picker could not be
    // seen: leave full screen first, then measure the video where it now is.
    const wasFullscreen = this.b.root.classList.contains('element-fullscreen');
    if (wasFullscreen) {
      leaveElementFullscreen(this.b);
      for (let i = 0; i < 40 && this.b.root.classList.contains('element-fullscreen'); i++) await new Promise((r) => window.setTimeout(r, 50));
      await new Promise((r) => window.setTimeout(r, 250));
    }
    const browserId = this.browserIdOf(tab);
    // The video the pill sits on (hovered, or the right-clicked one for "Download video…"), else
    // the page's main video (asked again after full screen: the rectangle it reported is gone).
    const own = wasFullscreen ? null : this.target();
    let video: PageVideo | null = own && own.tabId === tab.id && own.video.id >= 0 ? own.video : null;
    try {
      video ??= asVideo(await Promise.race([this.b.page(tab).query('downloads:main-video'), new Promise((r) => window.setTimeout(() => r(null), 800))]));
    } catch {
      video = null;
    }
    // yt-dlp can take a few seconds: say what is happening under the pill meanwhile.
    const busy = ytdlpFirst(tab.url) && this.store.engine.hasYtdlp() ? this.note('Finding the qualities…', '', 60000) : null;
    if (video) {
      const t: Target = { tabId: tab.id, browserId, video };
      const offer = await this.resolve(t, true);
      busy?.();
      if (!offer || offer.state === 'none') {
        // The element itself gave nothing (a player's blob: source, or media its frame did not load):
        // offer what the page loaded instead, the same streams that lit the mark.
        await this.offerPageMedia(tab, browserId, keyboard, offer);
        return;
      }
      if (offer.key.startsWith('ytdlp|') && offer.state === 'ok') {
        // yt-dlp's offer belongs to the page, not to one element: the picker hangs under the tab pill.
        this.picker.open({ tabId: tab.id, browserId, video: { ...video, id: -1 } }, offer, keyboard, this.b.bar.layout.pillRect);
        return;
      }
      this.hover = t;
      this.offer = offer;
      this.hold(t);
      this.renderPill();
      if (offer.state === 'ok') this.picker.open(t, offer, keyboard);
      else window.setTimeout(() => this.release(), 3000);
      return;
    }
    await this.offerPageMedia(tab, browserId, keyboard, null);
    busy?.();
  }

  /**
   * The picker for everything the page loaded, under the tab pill. When there is nothing it can save,
   * say so there instead of doing nothing (the mark was lit by streams it then could not read).
   */
  private async offerPageMedia(tab: Tab, browserId: number, keyboard: boolean, elementOffer: VideoOffer | null): Promise<void> {
    const state = this.mediaState(tab);
    let offer: VideoOffer | null = null;
    if (state.count || state.protected || ytdlpFirst(tab.url) || elementOffer?.needsTools) {
      const frame: PageVideo = { id: -1, kind: 'video', rect: { x: 0, y: 0, w: 0, h: 0 }, src: '', duration: NaN, width: 0, height: 0, protected: state.protected, live: false, title: tab.title, frameSrc: '' };
      offer = elementOffer?.key.startsWith('ytdlp|') || elementOffer?.needsTools ? elementOffer : await this.resolve({ tabId: tab.id, browserId, video: frame }, true);
      if (offer?.state === 'ok') {
        this.picker.open({ tabId: tab.id, browserId, video: frame }, offer, keyboard, this.b.bar.layout.pillRect);
        return;
      }
    }
    const why = offer?.state === 'protected' || elementOffer?.state === 'protected' ? 'protected' : offer?.state === 'live' || elementOffer?.state === 'live' ? 'live' : 'none';
    console.warn('Deer downloads: nothing to offer on this page', JSON.stringify({ url: tab.url, media: state, element: elementOffer?.state ?? null, page: offer?.state ?? null, reason: offer?.reason ?? elementOffer?.reason ?? '' }));
    if (offer?.needsTools || elementOffer?.needsTools) {
      this.note('Saving videos from this site needs yt-dlp', 'Get it once in Settings › Video downloads.', 8000, { label: 'Open settings', run: () => this.openToolsSettings() });
      return;
    }
    const reason = offer?.reason || elementOffer?.reason || '';
    this.note(
      why === 'protected' ? 'Protected video' : why === 'live' ? 'Live · can’t be saved' : 'Can’t save this video',
      why === 'none' ? (reason ? sentence(reason) : 'Deer couldn’t read the streams this page plays.') : ''
    );
  }

  /** Settings › Video downloads, where yt-dlp is installed. */
  private openToolsSettings(): void {
    const settings = this.b.service('settings');
    settings?.open('video-downloads');
  }

  /** A short note under the tab pill, gone after `ms` or on the next click elsewhere. Returns its close. */
  private note(title: string, detail: string, ms = 3500, action?: { label: string; run: () => void }): () => void {
    const layer = this.b.layer('downloads-note', 30);
    layer.replaceChildren();
    const button = action ? el('button', { type: 'button', class: 'vd-note-act' }, action.label) : null;
    const elm = el('section', { class: 'vd-note', role: 'status' }, el('div', { class: 'vd-note-body' }, el('span', { class: 'b' }, title), detail ? el('span', { class: 'd' }, detail) : '', button ?? ''));
    glass(elm);
    layer.append(elm);
    const r = this.b.bar.layout.pillRect;
    if (r) {
      elm.style.left = `${Math.round(r.left + r.width / 2 - elm.offsetWidth / 2)}px`;
      elm.style.top = `${Math.round(r.bottom + 8)}px`;
    }
    (elm.querySelector('.lens') as HTMLElement | null)?.style.setProperty('backdrop-filter', lens(elm.offsetWidth, elm.offsetHeight, { radius: 14, scale: 18, blur: 16, opaque: true }));
    if (!reduced()) elm.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: SPRING });
    const close = (): void => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
      elm.remove();
    };
    const outside = (e: Event): void => {
      if (!elm.contains(e.target as Node)) close();
    };
    button?.addEventListener('click', () => {
      close();
      action?.run();
    });
    const timer = window.setTimeout(close, ms);
    document.addEventListener('pointerdown', outside, true);
    return close;
  }

  /** The download mark in the active tab pill, shown while the page has media worth saving. */
  syncMark(): void {
    const mark = this.b.bar.downloadMark();
    if (!mark) return;
    if (!mark.dataset.wired) {
      mark.dataset.wired = '1';
      mark.replaceChildren(node(ic.download(15, 1.9)));
      mark.setAttribute('aria-label', 'Download media on this page');
      setTip(mark, 'Download this video', 'Ctrl+Shift+D');
      mark.addEventListener('click', (e) => void this.downloadVideo(e.detail === 0));
    }
    const tab = this.b.active();
    const id = this.browserIdOf(tab);
    const known = this.media.get(id) ?? (id ? this.store.engine.media.notice(id) : { count: 0, protected: false });
    // While find is open its face covers the pill's (the find module hides it: find/styles.ts).
    const show = !!tab && tab.kind === 'web' && !known.protected && (known.count > 0 || ytdlpFirst(tab.url));
    mark.classList.toggle('empty', !show);
    if (show) {
      mark.removeAttribute('aria-hidden');
      mark.tabIndex = 0;
    } else {
      mark.setAttribute('aria-hidden', 'true');
      mark.tabIndex = -1;
    }
  }
}

/** The quality picker under the pill (board VideoPicker, 340 wide): a radio list, where it saves, and Download. */
class Picker {
  private el: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;
  private unthumb: (() => void) | null = null;
  private target: Target | null = null;
  private offer: VideoOffer | null = null;
  private chosen = '';
  private dir = '';
  private unEsc: (() => void) | null = null;
  private unFocus: (() => void) | null = null;

  constructor(
    private b: Browser,
    private ui: VideoUI
  ) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  /** For tests. */
  get element(): HTMLElement | null {
    return this.el;
  }

  toggle(t: Target, offer: VideoOffer, keyboard: boolean): void {
    if (this.el) this.close(true);
    else this.open(t, offer, keyboard);
  }

  open(t: Target, offer: VideoOffer, keyboard: boolean, barAnchor?: DOMRect | null): void {
    this.close(false);
    this.target = t;
    this.offer = offer;
    this.chosen = offer.suggested || offer.options[0]?.id || '';
    this.dir = '';
    if (t.video.id >= 0) this.ui.hold(t);
    const layer = this.b.layer('downloads-picker', 30);
    this.catcher = el('div', { class: 'vd-menu-catcher' });
    this.catcher.addEventListener('pointerdown', () => this.close(false));
    const body = el('div', { class: 'vd-pick-body' });
    const elm = el('section', { class: 'vd-picker', role: 'dialog', 'aria-label': 'Download this video', tabindex: '-1' }, body);
    glass(elm);
    this.build(body, offer);
    layer.append(this.catcher, elm);
    this.el = elm;
    this.wire(elm);
    this.paint();
    this.follow(barAnchor ?? this.ui.pillRect());
    (elm.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(340, elm.offsetHeight, { radius: 18, scale: 22, blur: 16, opaque: true });
    this.ui.renderPill();
    this.b.root.querySelector('.vd-pill')?.classList.add('open');
    if (!reduced()) {
      elm.animate([{ transform: 'translate(-4px, -4px) scale(0.96)' }, { transform: 'none' }], { duration: 200, easing: SPRING });
      body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'cubic-bezier(0.2,0,0,1)' });
    }
    this.unEsc = this.b.addEscLayer(30, () => {
      this.close(true);
      return true;
    });
    // Another Deer surface took the keyboard (the switcher's search, find, the address field): the
    // picker gives way, or it would stay under that surface and take its first Esc.
    const pill = this.b.root.querySelector('.vd-pill');
    const lost = (e: FocusEvent): void => {
      const t = e.target as Element | null;
      if (t && this.b.root.contains(t) && !elm.contains(t) && !pill?.contains(t)) this.close(false);
    };
    document.addEventListener('focusin', lost, true);
    this.unFocus = () => document.removeEventListener('focusin', lost, true);
    const sel = elm.querySelector<HTMLElement>('[aria-checked="true"]') ?? elm.querySelector<HTMLElement>('.vd-go');
    if (keyboard) sel?.focus();
    else elm.focus();
    void this.thumb(t);
  }

  close(focusPill: boolean): void {
    this.unthumb?.();
    this.unthumb = null;
    const elm = this.el;
    if (!elm) return;
    this.el = null;
    this.unEsc?.();
    this.unEsc = null;
    this.unFocus?.();
    this.unFocus = null;
    this.catcher?.remove();
    this.catcher = null;
    this.b.root.querySelector('.vd-pill')?.classList.remove('open');
    elm.style.pointerEvents = 'none';
    const hadFocus = elm.contains(document.activeElement);
    elm.remove();
    const pillButton = this.b.root.querySelector<HTMLElement>('.vd-pill.shown button');
    // Esc goes back to the pill; anything else (Download, a click outside) back to the page.
    if (focusPill && pillButton) pillButton.focus();
    else if (hadFocus) this.b.focusPage();
    this.ui.release();
    this.ui.renderPill();
  }

  /** Stay under the pill (right edges aligned, 8 px below); flip above when there is no room. */
  follow(anchor: DOMRect): void {
    const elm = this.el;
    if (!elm) return;
    const h = elm.offsetHeight;
    const right = anchor.right;
    let top = anchor.bottom + 8;
    if (top + h > window.innerHeight - 8 && anchor.top - 8 - h >= 8) top = anchor.top - 8 - h;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    elm.style.left = `${Math.round(Math.max(8, Math.min(right - 340, window.innerWidth - 348)))}px`;
    elm.style.top = `${Math.round(top)}px`;
  }

  private build(body: HTMLElement, offer: VideoOffer): void {
    const videos = offer.options.filter((o) => o.group === 'video');
    const audios = offer.options.filter((o) => o.group === 'audio');
    const sub = [offer.host, f.duration(offer.duration)].filter(Boolean).join(' · ');
    const row = (o: VideoOption): HTMLElement =>
      el(
        'button',
        { type: 'button', role: 'radio', class: 'vd-opt', 'data-id': o.id, 'aria-checked': 'false', tabindex: '-1' },
        el('span', { class: 'vd-radio' }),
        el('span', { class: 'lbl' }, o.label),
        el('span', { class: 'det' }),
        el('span', { class: 'size' }, o.bytes ? f.bytes(o.bytes) : '')
      );
    const thumb = el('canvas', { class: 'vd-thumb', width: '128', height: '72' });
    thumb.hidden = true;
    const opts = el('div', { class: 'vd-opts', role: 'radiogroup', 'aria-label': 'Quality' });
    if (videos.length) opts.append(el('div', { class: 'vd-group' }, `Video · ${videos[0].container}`), ...videos.map(row));
    if (audios.length) opts.append(el('div', { class: 'vd-group' }, 'Audio only'), ...audios.map(row));
    const terms = TERMS_HOSTS.test(offer.host) && !termsSeen(offer.host) ? el('div', { class: 'vd-terms' }, TERMS_LINE) : null;
    body.append(
      el('div', { class: 'vd-pick-head' }, thumb, el('div', { class: 'vd-pick-text' }, el('span', { class: 'vd-pick-title' }, offer.title || 'Video'), el('span', { class: 'vd-pick-sub' }, sub))),
      opts,
      el('div', { class: 'vd-pick-sep' }),
      el('div', { class: 'vd-saveto' }, el('span', { class: 'k' }, 'Save to'), el('span', { class: 'v' }), el('button', { type: 'button', class: 'vd-change' }, 'Change')),
      el('div', { class: 'vd-mux' }),
      ...(terms ? [terms] : []),
      el('button', { type: 'button', class: 'vd-go' })
    );
  }

  private wire(elm: HTMLElement): void {
    const opts = elm.querySelector('.vd-opts') as HTMLElement;
    // The board's 2 px overlay thumb; it goes with the picker's element (detached on close).
    this.unthumb?.();
    this.unthumb = scrollThumb(opts);
    opts.addEventListener('click', (e) => {
      const opt = (e.target as Element).closest<HTMLElement>('.vd-opt');
      if (!opt) return;
      this.chosen = opt.dataset.id ?? '';
      this.paint();
    });
    opts.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('.vd-opt')) this.go();
    });
    elm.querySelector('.vd-go')?.addEventListener('click', () => this.go());
    elm.querySelector('.vd-change')?.addEventListener('click', async () => {
      const dir = await this.b.sys('VitreDownloads').pickFolder(window, { title: 'Save the video to', dir: this.dir || this.b.settings.downloadsFolder });
      if (dir) {
        this.dir = dir;
        this.paint();
      }
    });
    elm.addEventListener('keydown', (e) => {
      const rows = Array.from(elm.querySelectorAll<HTMLElement>('.vd-opt'));
      const i = rows.findIndex((o) => o.dataset.id === this.chosen);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length) {
        const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        this.chosen = rows[j].dataset.id ?? '';
        this.paint();
        rows[j].focus();
      } else if (e.key === 'Enter' && !(e.target as Element).closest('.vd-change')) {
        this.go();
      } else if (e.key === 'Tab') {
        const stops = [rows.find((o) => o.dataset.id === this.chosen), elm.querySelector<HTMLElement>('.vd-change'), elm.querySelector<HTMLElement>('.vd-go')].filter((x): x is HTMLElement => !!x);
        const k = stops.indexOf(document.activeElement as HTMLElement);
        stops[(k + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      } else return;
      e.preventDefault();
    });
  }

  private paint(): void {
    const elm = this.el;
    const offer = this.offer;
    if (!elm || !offer) return;
    // "Best for this screen" only means something when there is a choice of qualities.
    const choice = offer.options.filter((x) => x.group === 'video').length > 1;
    for (const o of Array.from(elm.querySelectorAll<HTMLElement>('.vd-opt'))) {
      const on = o.dataset.id === this.chosen;
      o.setAttribute('aria-checked', String(on));
      o.tabIndex = on ? 0 : -1;
      const opt = offer.options.find((x) => x.id === o.dataset.id);
      f.setText(o.querySelector('.det'), choice && opt?.id === offer.suggested && opt.group === 'video' ? 'Best for this screen' : (opt?.detail ?? ''));
    }
    const opt = offer.options.find((x) => x.id === this.chosen);
    f.setText(elm.querySelector('.vd-saveto .v'), f.folderLabel(this.dir || this.b.settings.downloadsFolder, this.b.settings.downloadsFolder) || 'Downloads');
    const mux = elm.querySelector('.vd-mux') as HTMLElement;
    const missing = !!opt?.needsMux && !offer.muxer;
    mux.hidden = !missing;
    f.setText(mux, missing ? (opt?.mode === 'dash' || opt?.audioUrl ? 'ffmpeg not found: the video and its sound are saved as two files.' : 'ffmpeg not found: saved as it comes (TS).') : '');
    f.setText(elm.querySelector('.vd-go'), opt ? `Download ${opt.label}${opt.bytes ? ` · ${f.bytes(opt.bytes)}` : ''}` : 'Download');
  }

  private go(): void {
    const t = this.target;
    const offer = this.offer;
    const opt = offer?.options.find((x) => x.id === this.chosen);
    if (!t || !offer || !opt || !this.el) return;
    const r = (this.el.querySelector('.vd-go') as HTMLElement).getBoundingClientRect();
    const dir = this.dir || undefined;
    this.close(false);
    this.ui.download(t, offer, opt, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, dir);
  }

  /** A still of the video as it is now (a compositor snapshot of the page), drawn 64x36. */
  private async thumb(t: Target): Promise<void> {
    if (t.video.id < 0) return;
    const tab = this.b.tab(t.tabId);
    if (!tab) return;
    const z = tab.zoom || 1;
    const r = t.video.rect;
    if (r.w < 8 || r.h < 8) return;
    const bitmap = await this.b.snapshot(tab.browser, { x: Math.max(0, r.x * z), y: Math.max(0, r.y * z), width: r.w * z, height: r.h * z }, 0.5).catch(() => null);
    const canvas = this.el?.querySelector<HTMLCanvasElement>('.vd-thumb');
    if (!bitmap) return;
    try {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // object-fit: cover into 128x72 (drawn at 64x36).
      const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      canvas.hidden = false;
    } finally {
      bitmap.close();
    }
  }
}

function faceOf(mode: PillMode): Node[] {
  switch (mode) {
    case 'found':
      return [el('button', { type: 'button', class: 'vd-pill-main', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, node(ic.download(16, 1.8)), 'Download', el('span', { class: 'div' }), el('span', { class: 'q' }))];
    case 'downloading':
    case 'paused':
      return [
        el(
          'div',
          { class: 'vd-pill-prog', role: 'group', 'aria-label': 'Downloading this video' },
          node(
            '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/><circle class="arc" cx="9" cy="9" r="7" fill="none" stroke="#4cc2ff" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 44" transform="rotate(-90 9 9)"/></svg>'
          ),
          el('span', { class: 'pct' }),
          el('span', { class: 'rest' }),
          el('span', { class: 'div' }),
          el('button', { type: 'button', class: 'vd-pill-small', 'aria-label': 'Pause download' }, node(ic.pause(11)))
        ),
      ];
    case 'saved':
      return [el('div', { class: 'vd-pill-note saved' }, node(ic.saved), el('span', { class: 'b' }, 'Saved'), el('span', { class: 'div' }), el('button', { type: 'button', class: 'vd-pill-open' }, 'Open'))];
    case 'protected':
      return [el('div', { class: 'vd-pill-note', role: 'status' }, node(ic.lock), el('span', {}, 'Protected video'))];
    case 'live':
      return [el('div', { class: 'vd-pill-note', role: 'status' }, el('span', { class: 'live' }), el('span', {}, 'Live · can’t be saved'))];
  }
}

function center(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A page's report, checked field by field (a page can send anything). */
function asRect(v: unknown): PageVideo['rect'] | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const n = (k: string): number => (typeof r[k] === 'number' && Number.isFinite(r[k] as number) ? (r[k] as number) : NaN);
  const out = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  return Object.values(out).every((x) => Number.isFinite(x)) ? out : null;
}

function asVideo(v: unknown): PageVideo | null {
  const d = v as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || typeof d.id !== 'number') return null;
  const rect = asRect(d.rect);
  if (!rect) return null;
  const str = (k: string, max = 4096): string => (typeof d[k] === 'string' ? (d[k] as string).slice(0, max) : '');
  const num = (k: string): number => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  return {
    id: d.id,
    kind: d.kind === 'frame' ? 'frame' : 'video',
    rect,
    src: str('src', 8192),
    duration: num('duration'),
    width: num('width'),
    height: num('height'),
    protected: !!d.protected,
    live: !!d.live,
    title: str('title', 300),
    frameSrc: str('frameSrc', 8192),
    view: asView(d.view),
  };
}

function asView(v: unknown): { w: number; h: number } | undefined {
  const d = v as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return undefined;
  const w = d.w;
  const h = d.h;
  return typeof w === 'number' && typeof h === 'number' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : undefined;
}

/** A reason from yt-dlp or the engine as a sentence: capital first letter, full stop. */
function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}
