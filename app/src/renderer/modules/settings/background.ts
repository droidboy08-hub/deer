// Home's background: the Windows wallpaper, a photo, a video (muted, looping) or none.
// Applies the setting to #home, keeps the tab bar's glass light or clear to match the
// picture's brightness, and pauses a video whenever Home isn't on screen.
import type { Browser } from '../../app';
import type { Theme } from '../../model';
import type { Settings } from '../../../shared/settings';

export type HomeBg = Settings['homeBackground'];
export type BgKind = HomeBg['kind'];

export interface Tile {
  kind: BgKind;
  path: string;
  label: string;
}

const RECENT_KEY = 'vitre.home.recent';
const RECENT_MAX = 6;
/** Same rule as the core's wallpaper check: a bright top band gets light glass. */
const LIGHT_LUMA = 0.62;
/** Cross-fade between backgrounds; matches .hb-media in styles.ts. */
const FADE_MS = 300;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** A file:// URL for a Windows path, escaping what URLs reserve ('#', '?', '%', spaces, non-ASCII). */
export function fileUrl(p: string): string {
  const s = p.replace(/\\/g, '/');
  const enc = (part: string) => part.split('/').map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':')).join('/');
  if (s.startsWith('//')) return `file:${enc(s)}`;
  return `file://${enc(s.startsWith('/') ? s : `/${s}`)}`;
}

/** Windows 11's theme folders by the names Settings › Personalization uses. */
const THEME_NAMES: Record<string, string> = { ThemeA: 'Glow', ThemeB: 'Captured Motion', ThemeC: 'Sunrise', ThemeD: 'Flow', Windows: 'Bloom', Spotlight: 'Spotlight' };

const folderOf = (p: string) => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';

/** …\Wallpaper\ThemeA\img21.jpg → 'Glow 2' (numbered among the tiles shown from that theme). */
function builtinName(p: string, all: string[]): string {
  const dir = folderOf(p);
  const name = THEME_NAMES[dir] ?? 'Windows wallpaper';
  const siblings = all.filter((x) => folderOf(x) === dir);
  return siblings.length > 1 ? `${name} ${siblings.indexOf(p) + 1}` : name;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const keyOf = (bg: HomeBg) => `${bg.kind}|${bg.path}`;

/** Mean luminance (0–1) of the picture's top tenth, where the tab bar sits. */
function topLuma(el: HTMLImageElement | HTMLVideoElement): number | null {
  const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!iw || !ih) return null;
  const w = 160;
  const h = Math.max(1, Math.round((w * ih) / iw));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  try {
    g.drawImage(el, 0, 0, w, h);
    const rows = Math.max(1, Math.round(h * 0.1));
    const d = g.getImageData(0, 0, w, rows).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  } catch {
    return null;
  }
}

export class HomeBackground {
  /** What Home shows (or is loading) now; ahead of b.settings until the store echoes a choice. */
  private cur: HomeBg = { kind: 'windows', path: '' };
  private applied = '';
  private media: HTMLImageElement | HTMLVideoElement | null = null;
  /** A picture still loading; dropped if another choice comes first. */
  private incoming: HTMLImageElement | HTMLVideoElement | null = null;
  /** Choices made here that the settings store hasn't echoed yet, oldest first. */
  private pending: string[] = [];
  private theme: Theme | null = null;
  private coreReady = false;
  private listeners = new Set<() => void>();
  /** Set when the chosen file couldn't be shown. */
  error: string | null = null;
  private wallpaperCache: Promise<{ windows: string | null; builtins: string[] }> | null = null;

  constructor(private b: Browser) {}

  install(): void {
    const bg = this.b.settings.homeBackground ?? this.cur;
    // Hide the Windows wallpaper the core loads at start until our own picture is ready.
    if (bg.kind === 'image' || bg.kind === 'video') document.body.classList.add('hb-pending');
    this.apply(bg);
    this.b.on('settings', (s: Settings) => this.fromStore(s.homeBackground));
    this.b.on('tab-activated', () => {
      if (!this.coreReady) {
        // The core sets homeTheme from the Windows wallpaper during start; ours wins after that.
        this.coreReady = true;
        if (this.theme) this.setTheme(this.theme);
      }
      this.syncPlayback();
    });
    this.b.on('render', () => this.syncPlayback());
    document.addEventListener('visibilitychange', () => this.syncPlayback());
    reducedMotion.addEventListener('change', () => this.syncPlayback());
  }

  current(): HomeBg {
    return this.cur;
  }

  /** Called whenever the background or its error state changes. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply and store a background; `fromDisk` files (picked in the dialog) join the recent list. */
  choose(bg: HomeBg, fromDisk = false): void {
    if (fromDisk && (bg.kind === 'image' || bg.kind === 'video')) this.remember(bg);
    this.apply(bg);
    this.pending.push(keyOf(bg));
    window.vitre.settings.set({ homeBackground: bg });
  }

  /**
   * A settings change. Echoes of quick successive choices arrive in order, so an older one must
   * not bring back a background that was already replaced here; changes from elsewhere apply.
   */
  private fromStore(bg: HomeBg | undefined): void {
    if (!bg) return;
    const i = this.pending.indexOf(keyOf(bg));
    if (i >= 0) this.pending.splice(0, i + 1);
    if (this.pending.length) return;
    this.apply(bg);
  }

  /** Windows' file dialog; the picked file becomes the background. */
  async browse(want: 'any' | 'image' | 'video' = 'any'): Promise<boolean> {
    const r = (await window.vitre.ipc.invoke('home:pick-media', want)) as { kind: 'image' | 'video'; path: string } | null;
    if (!r) return false;
    this.choose({ kind: r.kind, path: r.path }, true);
    return true;
  }

  wallpapers(): Promise<{ windows: string | null; builtins: string[] }> {
    this.wallpaperCache ??= (window.vitre.ipc.invoke('home:wallpapers') as Promise<{ windows: string | null; builtins: string[] }>).catch(() => ({ windows: null, builtins: [] }));
    return this.wallpaperCache;
  }

  thumb(path: string, width: number): Promise<string | null> {
    return (window.vitre.ipc.invoke('home:thumb', path, width) as Promise<string | null>).catch(() => null);
  }

  /** Tiles for the picker: photos (Windows wallpaper, yours, then Windows' own) or videos (yours). */
  async tiles(kind: 'photo' | 'video'): Promise<Tile[]> {
    const want = kind === 'video' ? 'video' : 'image';
    const wp = kind === 'photo' ? await this.wallpapers() : { windows: null, builtins: [] as string[] };
    const shipped = new Set(wp.builtins.map((p) => p.toLowerCase()));
    const yours = (p: string) => !!p && !shipped.has(p.toLowerCase());
    const mine = this.recent().filter((r) => r.kind === want && yours(r.path));
    const cur = this.current();
    if (cur.kind === want && yours(cur.path) && !mine.some((r) => r.path.toLowerCase() === cur.path.toLowerCase())) mine.unshift(cur);
    const own: Tile[] = mine.map((r) => ({ kind: r.kind, path: r.path, label: baseName(r.path) }));
    if (kind === 'video') return own;
    const builtins: Tile[] = wp.builtins.map((p) => ({ kind: 'image', path: p, label: builtinName(p, wp.builtins) }));
    return [{ kind: 'windows', path: wp.windows ?? '', label: 'Your Windows wallpaper' }, ...own, ...builtins];
  }

  // ---- applying ----

  private apply(bg: HomeBg): void {
    const key = keyOf(bg);
    if (key === this.applied) return;
    this.applied = key;
    this.cur = { kind: bg.kind, path: bg.path };
    this.error = null;
    this.discardIncoming();
    if (bg.kind === 'image' || bg.kind === 'video') {
      this.showMedia(bg);
    } else {
      this.dropMedia();
      document.body.classList.remove('hb-custom', 'hb-pending');
      document.body.classList.toggle('hb-none', bg.kind === 'none');
      if (bg.kind === 'none') this.setTheme('clear');
      else window.vitre.wallpaperLuma().then((l) => this.applied === key && this.setTheme(l !== null && l > LIGHT_LUMA ? 'light' : 'clear'));
    }
    this.changed();
  }

  private showMedia(bg: HomeBg): void {
    const home = document.getElementById('home');
    if (!home) return;
    const key = this.applied;
    const el = bg.kind === 'video' ? this.makeVideo() : this.makeImage();
    el.className = 'hb-media';
    this.incoming = el;
    const ready = () => {
      if (this.incoming !== el) return;
      this.incoming = null;
      const old = this.media;
      this.media = el;
      // Fade the new picture in over whatever Home shows now, then retire what's underneath.
      requestAnimationFrame(() => el.classList.add('shown'));
      window.setTimeout(() => {
        old?.remove();
        if (this.applied !== key) return;
        document.body.classList.remove('hb-none', 'hb-pending');
        document.body.classList.add('hb-custom');
      }, FADE_MS + 20);
      if (old instanceof HTMLVideoElement) old.pause();
      const l = topLuma(el);
      this.setTheme(l !== null && l > LIGHT_LUMA ? 'light' : 'clear');
      this.syncPlayback();
    };
    el.addEventListener(bg.kind === 'video' ? 'loadeddata' : 'load', ready, { once: true });
    el.addEventListener(
      'error',
      () => {
        if (this.incoming !== el) return;
        this.incoming = null;
        el.remove();
        this.dropMedia();
        // Fall back to the plain background so Home never shows a stale picture.
        document.body.classList.remove('hb-custom', 'hb-pending');
        document.body.classList.add('hb-none');
        this.error = `Couldn’t open ${baseName(bg.path)}`;
        this.setTheme('clear');
        this.changed();
      },
      { once: true },
    );
    el.src = fileUrl(bg.path);
    home.append(el);
  }

  private makeImage(): HTMLImageElement {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    return img;
  }

  private makeVideo(): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.autoplay = !reducedMotion.matches;
    v.playsInline = true;
    v.disablePictureInPicture = true;
    v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    // Autoplay can start after the first frame while Home is hidden; playback follows Home.
    v.addEventListener('play', () => this.syncPlayback());
    return v;
  }

  private dropMedia(): void {
    if (this.media) this.fadeOut(this.media);
    this.media = null;
  }

  /** Stop loading a picture that was replaced before it could be shown. */
  private discardIncoming(): void {
    const el = this.incoming;
    this.incoming = null;
    if (!el) return;
    el.remove();
    if (el instanceof HTMLVideoElement) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }

  private fadeOut(el: HTMLElement): void {
    el.classList.remove('shown');
    if (el instanceof HTMLVideoElement) el.pause();
    window.setTimeout(() => el.remove(), FADE_MS + 20);
  }

  /** A video plays only while Home is on screen, the window is visible and motion is welcome. */
  private syncPlayback(): void {
    const v = this.media;
    if (!(v instanceof HTMLVideoElement)) return;
    const visible = this.b.active()?.kind === 'home' && document.visibilityState === 'visible';
    if (visible && !reducedMotion.matches) {
      if (v.paused) v.play().catch(() => undefined);
    } else if (!v.paused) {
      v.pause();
    }
  }

  private setTheme(theme: Theme): void {
    this.theme = theme;
    if (!this.coreReady) return;
    this.b.homeTheme = theme;
    let changed = false;
    for (const t of this.b.tabs) {
      if (t.kind === 'home' && t.theme !== theme) {
        t.theme = theme;
        changed = true;
      }
    }
    if (changed) this.b.render();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- recently used files (a per-window convenience, not a setting) ----

  private recent(): HomeBg[] {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as HomeBg[];
      return Array.isArray(list) ? list.filter((r) => r && (r.kind === 'image' || r.kind === 'video') && typeof r.path === 'string') : [];
    } catch {
      return [];
    }
  }

  private remember(bg: HomeBg): void {
    const list = [bg, ...this.recent().filter((r) => r.path.toLowerCase() !== bg.path.toLowerCase())].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable: the picker just shows fewer tiles */
    }
  }
}
