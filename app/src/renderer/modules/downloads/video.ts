// "Download this video": a glass pill in the top-right corner of a hovered video (12 px in) with
// the quality that suits this screen; click opens the quality picker, Shift+click downloads at
// once. While the video downloads the pill stays on it with live progress, then says Saved.
// DRM video says Protected, a live stream says it can't be saved. Ctrl+Shift+D opens the picker
// for the page's main video; the tab pill's download mark does the same.
import type { WebviewTag } from 'electron';
import type { DownloadView, PageVideo, StartOptions, VideoOffer, VideoOption } from '../../../main/modules/downloads/types';
import type { Browser } from '../../app';
import { glassLayers, lens } from '../../glass';
import type { Tab } from '../../model';
import * as f from './format';
import { ic } from './icons';
import type { Panel } from './panel';
import type { Ring } from './ring';
import type { DownloadStore } from './store';

type PillMode = 'found' | 'downloading' | 'paused' | 'saved' | 'protected' | 'live';

interface Target {
  tabId: number;
  wcId: number;
  video: PageVideo;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Sites whose terms often forbid saving: a one-line reminder on the first download from each. */
const TERMS_HOSTS = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|facebook\.com|fbcdn\.net|instagram\.com|tiktok\.com|x\.com|twitter\.com|vimeo\.com|twitch\.tv|reddit\.com|dailymotion\.com|soundcloud\.com|netflix\.com)$/i;

export class VideoUI {
  private hover: Target | null = null;
  /**
   * The video the pill stays on while its download runs ('download') or the picker is open
   * ('hold'). `waiting` until the started download shows up in the list.
   */
  private pinned: (Target & { key: string; why: 'download' | 'hold'; waiting: boolean }) | null = null;
  private offer: VideoOffer | null = null;
  private offers = new Map<string, { at: number; p: Promise<VideoOffer | null> }>();
  private media = new Map<number, number>();
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private replies = new Map<number, (v: PageVideo | null) => void>();
  private pill: HTMLElement;
  private mode: PillMode | null = null;
  private hideTimer: number | null = null;
  private savedTimer: number | null = null;
  private overPill = false;
  private picker: Picker;
  private lensWidth = 0;
  private sampled = '';

  constructor(private b: Browser, private store: DownloadStore, private ring: Ring, private panel: Panel) {
    this.pill = document.createElement('div');
    this.pill.className = 'vd-pill vd-glass';
    this.pill.innerHTML = `${glassLayers()}<div class="vd-pill-face"></div>`;
    b.layer('downloads-video', 9).append(this.pill);
    this.picker = new Picker(b, this);
    this.pill.addEventListener('pointerenter', () => {
      this.overPill = true;
      this.pill.classList.add('hot');
      this.cancelHide();
    });
    this.pill.addEventListener('pointerleave', () => {
      this.overPill = false;
      this.pill.classList.remove('hot');
      if (!this.hover) this.hideSoon();
    });
    this.pill.addEventListener('click', (e) => this.pillClick(e));

    b.on('webview-created', (tab: Tab, wv: WebviewTag) => this.attach(tab, wv));
    b.on('tab-activated', () => this.reset());
    b.on('tab-closed', (tab: Tab) => {
      this.pointers.delete(tab.id);
      if (this.pinned?.tabId === tab.id || this.hover?.tabId === tab.id) this.reset();
    });
    b.on('render', () => this.syncMarks());
    window.vitre.ipc.on('dl:media', (n) => {
      const notice = n as { webContentsId: number; count: number };
      this.media.set(notice.webContentsId, notice.count);
      this.syncMarks();
    });
    store.subscribe(() => this.renderPill());
    store.onAdded((ev) => {
      // With the panel open the new row appears right there; the ring is under the dimmed page.
      if (this.panel.open) {
        this.ring.show();
        return;
      }
      const origin = ev.origin ?? this.recentPointer();
      this.ring.fly(origin, ev.view);
    });
    window.addEventListener('resize', () => this.renderPill());
  }

  // ---- page messages ----

  private attach(tab: Tab, wv: WebviewTag): void {
    wv.addEventListener('ipc-message', (e) => {
      const args = e.args as unknown[];
      switch (e.channel) {
        case 'dl-video-hover':
          this.onHover(tab, wv, (args[0] as PageVideo | null) ?? null);
          break;
        case 'dl-video-rect':
          this.onRect(tab, args[0] as number, (args[1] as PageVideo['rect'] | null) ?? null);
          break;
        case 'dl-main-video': {
          const reply = this.replies.get(tab.id);
          this.replies.delete(tab.id);
          reply?.((args[0] as PageVideo | null) ?? null);
          break;
        }
        case 'dl-pointer':
          this.pointers.set(tab.id, { x: Number(args[0]) * tab.zoom, y: Number(args[1]) * tab.zoom, t: Date.now() });
          break;
        case 'dl-link':
          if (typeof args[0] === 'string') {
            const p = this.pointers.get(tab.id);
            void this.store.start(args[0], { pageUrl: tab.url, webContentsId: wv.getWebContentsId(), origin: p ? { x: p.x, y: p.y } : undefined });
          }
          break;
      }
    });
    wv.addEventListener('did-start-navigation', (e) => {
      const ev = e as unknown as { isMainFrame: boolean; isInPlace: boolean };
      if (ev.isMainFrame && !ev.isInPlace && (this.hover?.tabId === tab.id || this.pinned?.tabId === tab.id)) this.reset();
    });
  }

  private onHover(tab: Tab, wv: WebviewTag, video: PageVideo | null): void {
    if (tab.id !== this.b.activeId) return;
    if (!video) {
      this.hover = null;
      if (!this.overPill && !this.picker.isOpen) this.hideSoon();
      return;
    }
    this.cancelHide();
    const wcId = wv.getWebContentsId();
    const same = this.hover && this.hover.video.id === video.id && this.hover.tabId === tab.id;
    this.hover = { tabId: tab.id, wcId, video };
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

  private onRect(tab: Tab, id: number, rect: PageVideo['rect'] | null): void {
    if (!this.pinned || this.pinned.tabId !== tab.id || this.pinned.video.id !== id) return;
    if (!rect) {
      this.unpin();
      this.renderPill();
      return;
    }
    this.pinned.video = { ...this.pinned.video, rect };
    this.renderPill();
    this.picker.follow(this.pillRect());
  }

  private resolve(t: Target): Promise<VideoOffer | null> {
    const count = this.media.get(t.wcId) ?? 0;
    const key = `${t.wcId}|${t.video.src}|${t.video.frameSrc}|${t.video.protected}|${t.video.live}|${count}`;
    const hit = this.offers.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.p;
    for (const [k, v] of this.offers) if (Date.now() - v.at >= 60_000) this.offers.delete(k);
    const p = (window.vitre.ipc.invoke('dl:offer', t.wcId, t.video) as Promise<VideoOffer | null>).catch(() => null);
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

  renderPill(): void {
    this.letGoOfEnded();
    const t = this.target();
    const { mode, dl } = this.modeFor(t ? this.offer : null);
    if (!t || !mode || document.body.classList.contains('element-fullscreen')) {
      this.setShown(false);
      return;
    }
    // "Saved" stays a few seconds, then the pill goes back to normal (or away).
    if (mode === 'saved' && this.savedTimer === null && dl) {
      this.savedTimer = window.setTimeout(() => {
        this.savedTimer = null;
        this.unpin();
        this.renderPill();
      }, Math.max(500, 6000 - (Date.now() - dl.finishedAt)));
    }
    const face = this.pill.querySelector('.vd-pill-face') as HTMLElement;
    if (this.mode !== mode) {
      this.mode = mode;
      this.pill.dataset.mode = mode;
      this.pill.classList.toggle('quiet', mode === 'protected' || mode === 'live');
      face.innerHTML = faceHtml(mode);
    }
    const opt = this.offer?.options.find((o) => o.id === this.offer?.suggested) ?? this.offer?.options[0];
    const q = (s: string) => face.querySelector(s) as HTMLElement | null;
    if (mode === 'found') {
      setText(q('.q'), opt?.label ?? '');
      const main = face.querySelector('button');
      main?.setAttribute('aria-label', `Download this video${opt ? `, ${opt.label}` : ''}`);
      main?.setAttribute('title', 'Download this video  Ctrl+Shift+D');
      main?.setAttribute('aria-expanded', String(this.picker.isOpen));
    } else if ((mode === 'downloading' || mode === 'paused') && dl) {
      const pct = f.percent(dl);
      const arc = q('.arc');
      arc?.setAttribute('stroke-dasharray', `${(Math.max(0.03, pct / 100) * 44).toFixed(1)} 44`);
      const starting = dl.state === 'starting' || dl.state === 'queued' || dl.phase === 'probing';
      setText(q('.pct'), dl.state === 'paused' ? 'Paused' : starting ? 'Starting' : dl.phase === 'merging' ? 'Saving' : dl.total > 0 ? `${pct}%` : f.bytes(dl.received) || 'Starting');
      setText(q('.rest'), [dl.state === 'paused' ? '' : f.speed(dl.speed), dl.quality].filter(Boolean).join(' · '));
      const btn = q('.vd-pill-small');
      if (btn) {
        btn.innerHTML = dl.state === 'paused' ? ic.play(11) : ic.pause(11);
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
    const tab = this.b.tabs.find((x) => x.id === t.tabId);
    const z = tab?.zoom ?? 1;
    const r = t.video.rect;
    const w = this.pill.offsetWidth || 168;
    const minTop = document.body.classList.contains('fullscreen') ? 8 : 64;
    const right = Math.min(window.innerWidth - 8, (r.x + r.w) * z - 12);
    const top = Math.max(minTop, r.y * z + 12);
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
    const x = parseFloat(this.pill.style.left);
    const y = parseFloat(this.pill.style.top);
    void window.vitre.sampleLuma(t.wcId, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: 36 }).then((luma) => {
      if (this.sampled === key) this.pill.classList.toggle('bright', luma !== null && luma > 0.55);
    });
  }

  pillRect(): DOMRect {
    return this.pill.getBoundingClientRect();
  }

  private setShown(on: boolean): void {
    this.pill.classList.toggle('shown', on);
    this.pill.toggleAttribute('inert', !on);
    if (!on) {
      this.mode = null;
      this.pill.dataset.mode = '';
    }
  }

  private hideSoon(): void {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      if (this.hover || this.overPill || this.picker.isOpen) return;
      if (!this.pinned) this.offer = null;
      this.renderPill();
    }, 450);
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private pillClick(e: MouseEvent): void {
    const t = this.target();
    const offer = this.offer;
    if (!t || !offer) return;
    const target = e.target as HTMLElement;
    const { dl } = this.modeFor(offer);
    if (this.mode === 'found') {
      if (e.shiftKey) {
        const opt = offer.options.find((o) => o.id === offer.suggested) ?? offer.options[0];
        if (opt) this.download(t, offer, opt, this.center(this.pillRect()));
      } else this.picker.toggle(t, offer, e.detail === 0);
    } else if ((this.mode === 'downloading' || this.mode === 'paused') && dl) {
      if (target.closest('.vd-pill-small')) this.store.run(dl.state === 'paused' ? 'resume' : 'pause', dl.id);
      else this.panel.show(dl.id);
    } else if (this.mode === 'saved' && dl && target.closest('.vd-pill-open')) {
      this.store.run('open', dl.id);
    }
  }

  // ---- downloading ----

  download(t: Target, offer: VideoOffer, opt: VideoOption, origin: { x: number; y: number }, dir?: string): void {
    const opts: StartOptions = {
      mode: opt.mode,
      variantUrl: opt.variantUrl || undefined,
      audioUrl: opt.audioUrl || undefined,
      audioOnly: opt.group === 'audio',
      quality: opt.label,
      bytes: opt.bytes || undefined,
      videoKey: offer.key,
      title: offer.title,
      webContentsId: t.wcId,
      origin,
      dir,
    };
    acknowledgeTerms(offer.host);
    // The page's media without a video on screen (Ctrl+Shift+D from the tab pill) has nothing to stay on.
    if (t.video.id >= 0) this.pin(t, offer.key, 'download');
    void this.store.start(opt.url, opts).then((id) => {
      if (!id && this.pinned?.key === offer.key) {
        this.unpin();
        this.renderPill();
      }
    });
  }

  private pin(t: Target, key: string, why: 'download' | 'hold'): void {
    this.unpin();
    this.pinned = { ...t, key, why, waiting: why === 'download' };
    if (this.savedTimer !== null) clearTimeout(this.savedTimer);
    this.savedTimer = null;
    this.webview(t.tabId)?.send('dl-video-pin', t.video.id);
  }

  /** Keep the pill on this video while the picker is open, even if the pointer leaves it. */
  hold(t: Target): void {
    if (this.pinned?.video.id === t.video.id && this.pinned.tabId === t.tabId) return;
    this.pin(t, this.offer?.key ?? '', 'hold');
  }

  release(): void {
    const { mode } = this.modeFor(this.offer);
    if (mode === 'downloading' || mode === 'paused' || mode === 'saved') return;
    this.unpin();
    if (!this.hover && !this.overPill) this.hideSoon();
  }

  private unpin(): void {
    if (!this.pinned) return;
    this.webview(this.pinned.tabId)?.send('dl-video-pin', null);
    this.pinned = null;
  }

  private reset(): void {
    this.picker.close(false);
    this.unpin();
    this.hover = null;
    this.offer = null;
    this.overPill = false;
    this.renderPill();
  }

  private webview(tabId: number): WebviewTag | null {
    const t = this.b.tabs.find((x) => x.id === tabId);
    return t?.webview && t.ready ? t.webview : null;
  }

  private center(r: DOMRect): { x: number; y: number } {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private recentPointer(): { x: number; y: number } | null {
    const p = this.pointers.get(this.b.activeId);
    return p && Date.now() - p.t < 4000 ? { x: p.x, y: p.y } : null;
  }

  // ---- Ctrl+Shift+D and the tab pill's mark ----

  async downloadVideo(keyboard: boolean): Promise<void> {
    const tab = this.b.active();
    const wv = tab?.webview;
    if (!tab || tab.kind !== 'web' || !wv || !tab.ready) return;
    if (this.picker.isOpen) {
      this.picker.close(true);
      return;
    }
    const wcId = wv.getWebContentsId();
    const video = await new Promise<PageVideo | null>((resolve) => {
      this.replies.set(tab.id, resolve);
      wv.send('dl-main-video');
      setTimeout(() => {
        if (this.replies.get(tab.id) === resolve) {
          this.replies.delete(tab.id);
          resolve(null);
        }
      }, 800);
    });
    if (video) {
      const t: Target = { tabId: tab.id, wcId, video };
      const offer = await this.resolve(t);
      if (!offer || offer.state === 'none') return;
      this.hover = t;
      this.offer = offer;
      this.hold(t);
      this.renderPill();
      if (offer.state === 'ok') this.picker.open(t, offer, keyboard);
      else window.setTimeout(() => this.release(), 3000);
      return;
    }
    if (!(this.media.get(wcId) ?? 0)) return;
    const frame: PageVideo = { id: -1, kind: 'video', rect: { x: 0, y: 0, w: 0, h: 0 }, src: '', duration: NaN, width: 0, height: 0, protected: false, live: false, title: tab.title, frameSrc: '' };
    const offer = await this.resolve({ tabId: tab.id, wcId, video: frame });
    if (offer?.state === 'ok') this.picker.open({ tabId: tab.id, wcId, video: frame }, offer, keyboard, this.b.bar.layout.pillRect);
  }

  /** The download mark in the active tab pill, shown while the page has media worth saving. */
  private syncMarks(): void {
    for (const item of document.querySelectorAll<HTMLElement>('#bar .item.tab[data-id]')) {
      const face = item.querySelector('.pill-face');
      const reload = face?.querySelector('.reload');
      if (!face || !reload) continue;
      // The bar may provide the button itself; otherwise it goes in just before reload.
      let mark = face.querySelector<HTMLButtonElement>('.dl-mark');
      if (!mark) {
        mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'nav dl-mark';
        face.insertBefore(mark, reload);
      }
      if (!mark.dataset.wired) {
        mark.dataset.wired = '1';
        mark.setAttribute('aria-label', 'Download media on this page');
        mark.title = 'Download this video  Ctrl+Shift+D';
        mark.innerHTML = ic.download(15, 1.9);
        mark.addEventListener('click', (e) => void this.downloadVideo((e as MouseEvent).detail === 0));
      }
      const tab = this.b.tabs.find((x) => x.id === Number(item.dataset.id));
      const wcId = tab?.webview && tab.ready ? safeId(tab.webview) : 0;
      mark.hidden = !(tab && tab.kind === 'web' && wcId && (this.media.get(wcId) ?? 0) > 0);
    }
  }
}

/** The quality picker under the pill (340 wide): a radio list, where it saves, and Download. */
class Picker {
  private el: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;
  private target: Target | null = null;
  private offer: VideoOffer | null = null;
  private chosen = '';
  private dir = '';
  private unEsc: (() => void) | null = null;

  constructor(private b: Browser, private ui: VideoUI) {}

  get isOpen(): boolean {
    return !!this.el;
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
    this.catcher = document.createElement('div');
    this.catcher.className = 'vd-menu-catcher';
    this.catcher.addEventListener('pointerdown', () => this.close(false));
    const el = document.createElement('section');
    el.className = 'vd-picker vd-glass';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Download this video');
    el.tabIndex = -1;
    el.innerHTML = `${glassLayers()}<div class="vd-pick-body">${this.html(offer)}</div>`;
    layer.append(this.catcher, el);
    this.el = el;
    this.wire(el);
    this.paint();
    this.follow(barAnchor ?? this.ui.pillRect());
    (this.el.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(340, el.offsetHeight, { radius: 18, scale: 22, blur: 16 });
    this.ui.renderPill();
    document.querySelector('.vd-pill')?.classList.add('open');
    if (!reduced()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'cubic-bezier(0.2,0,0,1)' });
      el.animate([{ transform: 'translate(-4px, -4px) scale(0.96)' }, { transform: 'none' }], { duration: 200, easing: SPRING });
    } else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    this.unEsc = this.b.addEscLayer(30, () => {
      this.close(true);
      return true;
    });
    const sel = el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>('.vd-go');
    if (keyboard) sel?.focus();
    else el.focus();
    void this.thumb(t);
  }

  close(focusPill: boolean): void {
    const el = this.el;
    if (!el) return;
    this.el = null;
    this.unEsc?.();
    this.unEsc = null;
    this.catcher?.remove();
    this.catcher = null;
    document.querySelector('.vd-pill')?.classList.remove('open');
    el.style.pointerEvents = 'none';
    const hadFocus = el.contains(document.activeElement);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 150 : 120, fill: 'forwards' }).onfinish = () => el.remove();
    const pillButton = document.querySelector<HTMLElement>('.vd-pill.shown button');
    // Esc goes back to the pill; anything else (Download, a click outside) back to the page.
    if (focusPill && pillButton) pillButton.focus();
    else if (hadFocus) this.b.focusPage();
    this.ui.release();
    this.ui.renderPill();
  }

  /** Stay under the pill (right edges aligned, 8 px below); flip above when there is no room. */
  follow(anchor: DOMRect): void {
    const el = this.el;
    if (!el) return;
    const h = el.offsetHeight;
    const right = anchor.right;
    let top = anchor.bottom + 8;
    if (top + h > window.innerHeight - 8 && anchor.top - 8 - h >= 8) top = anchor.top - 8 - h;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    el.style.left = `${Math.round(Math.max(8, Math.min(right - 340, window.innerWidth - 348)))}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  private html(offer: VideoOffer): string {
    const videos = offer.options.filter((o) => o.group === 'video');
    const audios = offer.options.filter((o) => o.group === 'audio');
    const sub = [offer.host, f.duration(offer.duration)].filter(Boolean).join(' · ');
    const row = (o: VideoOption) => `<button type="button" role="radio" class="vd-opt" data-id="${f.esc(o.id)}" aria-checked="false" tabindex="-1">
        <span class="vd-radio"></span><span class="lbl">${f.esc(o.label)}</span><span class="det"></span>
        <span class="size">${o.bytes ? f.bytes(o.bytes) : ''}</span></button>`;
    const terms = TERMS_HOSTS.test(offer.host) && !termsSeen(offer.host) ? '<div class="vd-terms">Check that the site’s terms allow saving its videos.</div>' : '';
    return `<div class="vd-pick-head"><img class="vd-thumb" alt="" hidden><div class="vd-pick-text"><span class="vd-pick-title">${f.esc(offer.title || 'Video')}</span><span class="vd-pick-sub">${f.esc(sub)}</span></div></div>
      <div class="vd-opts" role="radiogroup" aria-label="Quality">
        ${videos.length ? `<div class="vd-group">Video · ${f.esc(videos[0].container)}</div>${videos.map(row).join('')}` : ''}
        ${audios.length ? `<div class="vd-group">Audio only</div>${audios.map(row).join('')}` : ''}
      </div>
      <div class="vd-pick-sep"></div>
      <div class="vd-saveto"><span class="k">Save to</span><span class="v"></span><button type="button" class="vd-change">Change</button></div>
      ${terms}
      <button type="button" class="vd-go"></button>`;
  }

  private wire(el: HTMLElement): void {
    el.querySelector('.vd-opts')?.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('.vd-opt');
      if (!opt) return;
      this.chosen = opt.dataset.id ?? '';
      this.paint();
    });
    el.querySelector('.vd-opts')?.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.vd-opt')) this.go();
    });
    el.querySelector('.vd-go')?.addEventListener('click', () => this.go());
    el.querySelector('.vd-change')?.addEventListener('click', async () => {
      const dir = (await window.vitre.ipc.invoke('dl:choose-folder')) as string | null;
      if (dir) {
        this.dir = dir;
        this.paint();
      }
    });
    el.addEventListener('keydown', (e) => {
      const opts = [...el.querySelectorAll<HTMLElement>('.vd-opt')];
      const i = opts.findIndex((o) => o.dataset.id === this.chosen);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opts.length) {
        const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        this.chosen = opts[j].dataset.id ?? '';
        this.paint();
        opts[j].focus();
      } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('.vd-change')) {
        this.go();
      } else if (e.key === 'Tab') {
        const stops = [opts.find((o) => o.dataset.id === this.chosen), el.querySelector<HTMLElement>('.vd-change'), el.querySelector<HTMLElement>('.vd-go')].filter((x): x is HTMLElement => !!x);
        const k = stops.indexOf(document.activeElement as HTMLElement);
        stops[(k + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      } else return;
      e.preventDefault();
    });
  }

  private paint(): void {
    const el = this.el;
    const offer = this.offer;
    if (!el || !offer) return;
    // "Best for this screen" only means something when there is a choice of qualities.
    const choice = offer.options.filter((x) => x.group === 'video').length > 1;
    for (const o of el.querySelectorAll<HTMLElement>('.vd-opt')) {
      const on = o.dataset.id === this.chosen;
      o.setAttribute('aria-checked', String(on));
      o.tabIndex = on ? 0 : -1;
      const opt = offer.options.find((x) => x.id === o.dataset.id);
      const det = o.querySelector('.det') as HTMLElement;
      setText(det, choice && opt?.id === offer.suggested && opt.group === 'video' ? 'Best for this screen' : (opt?.detail ?? ''));
    }
    const opt = offer.options.find((x) => x.id === this.chosen);
    setText(el.querySelector('.vd-saveto .v') as HTMLElement, folderName(this.dir || this.b.settings.downloadsFolder));
    const go = el.querySelector('.vd-go') as HTMLElement;
    setText(go, opt ? `Download ${opt.label}${opt.bytes ? ` · ${f.bytes(opt.bytes)}` : ''}` : 'Download');
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

  private async thumb(t: Target): Promise<void> {
    if (t.video.id < 0) return;
    const tab = this.b.tabs.find((x) => x.id === t.tabId);
    const z = tab?.zoom ?? 1;
    const r = t.video.rect;
    const url = (await window.vitre.ipc.invoke('dl:thumb', t.wcId, { x: r.x * z, y: r.y * z, w: r.w * z, h: r.h * z })) as string | null;
    const img = this.el?.querySelector<HTMLImageElement>('.vd-thumb');
    if (!url || !img) return;
    img.src = url;
    img.hidden = false;
  }
}

function faceHtml(mode: PillMode): string {
  switch (mode) {
    case 'found':
      return `<button type="button" class="vd-pill-main" aria-haspopup="dialog" aria-expanded="false">${ic.download(16, 1.8)}Download<span class="div"></span><span class="q"></span></button>`;
    case 'downloading':
    case 'paused':
      return `<div class="vd-pill-prog" role="group" aria-label="Downloading this video">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/><circle class="arc" cx="9" cy="9" r="7" fill="none" stroke="#4cc2ff" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 44" transform="rotate(-90 9 9)"/></svg>
        <span class="pct"></span><span class="rest"></span><span class="div"></span>
        <button type="button" class="vd-pill-small" aria-label="Pause download">${ic.pause(11)}</button></div>`;
    case 'saved':
      return `<div class="vd-pill-note saved">${ic.saved}<span class="b">Saved</span><span class="div"></span><button type="button" class="vd-pill-open">Open</button></div>`;
    case 'protected':
      return `<div class="vd-pill-note" role="status">${ic.lock}<span>Protected video</span></div>`;
    case 'live':
      return '<div class="vd-pill-note" role="status"><span class="live"></span><span>Live · can’t be saved</span></div>';
  }
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function folderName(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? 'Downloads';
}

function safeId(wv: WebviewTag): number {
  try {
    return wv.getWebContentsId();
  } catch {
    return 0;
  }
}

function termsSeen(host: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem('vd-terms') ?? '[]') as string[]).includes(host);
  } catch {
    return false;
  }
}

function acknowledgeTerms(host: string): void {
  if (!TERMS_HOSTS.test(host) || termsSeen(host)) return;
  try {
    const seen = JSON.parse(localStorage.getItem('vd-terms') ?? '[]') as string[];
    localStorage.setItem('vd-terms', JSON.stringify([...seen, host]));
  } catch {
    /* storage unavailable: the line shows again next time */
  }
}
