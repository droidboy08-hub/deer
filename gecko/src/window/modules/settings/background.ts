// Home's background as Settings sees it: the Windows wallpaper, a photo, a video (muted, looping)
// or none. On Gecko the Home page itself (src/pages/home) shows settings.homeBackground and sets the
// glass theme; this model only chooses, offers the tiles and remembers the files picked here.
// Ported from app/src/renderer/modules/settings/background.ts (the "applying" half lives in the
// Home page now).
//
//   bg.current()         what Home shows, or is about to (ahead of b.settings until the store echoes)
//   bg.choose(bg)        store a background (every window's Home pages follow at once)
//   bg.browse()          Windows' Open dialog (nsIFilePicker) for a photo or a video; the file is
//                        chosen and remembered in the recent list
//   bg.tiles(kind)       tiles for the picker: 'photo' (the Windows wallpaper, your recent photos,
//                        the photos Windows ships) or 'video' (your recent videos)
//   bg.error             why the last choice could not be shown, or null
//   bg.onChange(fn)      the choice or the error changed
// The recent list is a per-profile convenience, not a setting: the pref vitre.home.recent (a JSON
// array of { kind, path }), outside the Settings schema so VitreSettings never reports it.
import type { Settings } from '../../../shared/settings';
import type { Browser } from '../../browser';
import { builtinWallpapers, exists, extOf, knownFolder, pickFile, PHOTO_EXT, VIDEO_EXT } from './gecko';

export type HomeBg = Settings['homeBackground'];
export type BgKind = HomeBg['kind'];

export interface Tile {
  kind: BgKind;
  path: string;
  label: string;
}

const RECENT_PREF = 'vitre.home.recent';
const RECENT_MAX = 6;
/** The Open dialog's title; tests/settings/picker.js finds the dialog window by it. */
export const PICK_TITLE = 'Choose a photo or video for Home';

/** Windows 11's theme folders by the names Settings › Personalization uses. */
const THEME_NAMES: Record<string, string> = { ThemeA: 'Glow', ThemeB: 'Captured Motion', ThemeC: 'Sunrise', ThemeD: 'Flow', Windows: 'Bloom', Spotlight: 'Spotlight' };

const folderOf = (p: string): string => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';

/** ...\Wallpaper\ThemeA\img21.jpg -> 'Glow 2' (numbered among the tiles shown from that theme). */
function builtinName(p: string, all: string[]): string {
  const dir = folderOf(p);
  const name = THEME_NAMES[dir] ?? 'Windows wallpaper';
  const siblings = all.filter((x) => folderOf(x) === dir);
  return siblings.length > 1 ? `${name} ${siblings.indexOf(p) + 1}` : name;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const keyOf = (bg: HomeBg): string => `${bg.kind}|${bg.path}`;

export class HomeBackground {
  /** Choices made here that the settings store hasn't echoed yet, newest last. */
  private pending: HomeBg[] = [];
  private listeners = new Set<() => void>();
  private wallpaperCache: Promise<{ windows: string | null; builtins: string[] }> | null = null;
  /** Set when the chosen file could not be shown. */
  error: string | null = null;

  constructor(private b: Browser) {
    b.on('settings', (s, changed) => {
      if (!changed.some((k) => k.startsWith('homeBackground'))) return;
      const i = this.pending.findIndex((p) => keyOf(p) === keyOf(s.homeBackground));
      if (i >= 0) this.pending.splice(0, i + 1);
      else this.pending = [];
      this.changed();
    });
  }

  current(): HomeBg {
    const last = this.pending[this.pending.length - 1];
    const bg = last ?? this.b.settings.homeBackground;
    return { kind: bg.kind, path: bg.path };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Store a background; `fromDisk` files (picked in the dialog) join the recent list. */
  choose(bg: HomeBg, fromDisk = false): void {
    if (fromDisk && (bg.kind === 'image' || bg.kind === 'video')) this.remember(bg);
    this.error = null;
    this.pending.push({ kind: bg.kind, path: bg.path });
    this.b.sys('VitreSettings').set({ homeBackground: { kind: bg.kind, path: bg.path } });
    this.changed();
  }

  /** Choose a tile, unless its file has gone (then say so and keep what Home shows). */
  async chooseTile(t: Tile): Promise<void> {
    if ((t.kind === 'image' || t.kind === 'video') && !(await exists(t.path))) {
      this.error = `Couldn’t open ${baseName(t.path)}`;
      this.forget(t.path);
      this.changed();
      return;
    }
    this.choose(t.kind === 'windows' || t.kind === 'none' ? { kind: t.kind, path: '' } : { kind: t.kind, path: t.path });
  }

  /** Windows' Open dialog; the picked file becomes the background. False when nothing was picked. */
  async browse(): Promise<boolean> {
    const path = await pickFile(
      PICK_TITLE,
      [
        { name: 'Photos and videos', extensions: [...PHOTO_EXT, ...VIDEO_EXT] },
        { name: 'Photos', extensions: PHOTO_EXT },
        { name: 'Videos', extensions: VIDEO_EXT },
      ],
      knownFolder('pictures'),
    );
    if (!path) return false;
    const ext = extOf(path);
    const kind = VIDEO_EXT.includes(ext) ? 'video' : PHOTO_EXT.includes(ext) ? 'image' : null;
    if (!kind) {
      this.error = `${baseName(path)} isn’t a photo or a video`;
      this.changed();
      return false;
    }
    this.choose({ kind, path }, true);
    return true;
  }

  wallpapers(): Promise<{ windows: string | null; builtins: string[] }> {
    this.wallpaperCache ??= (async () => {
      let windows: string | null = null;
      try {
        windows = (await this.b.sys('VitreHome').windowsWallpaper())?.path ?? null;
      } catch {
        windows = null;
      }
      return { windows, builtins: await builtinWallpapers() };
    })();
    return this.wallpaperCache;
  }

  /** Tiles for the picker: photos (Windows wallpaper, yours, then Windows' own) or videos (yours). */
  async tiles(kind: 'photo' | 'video'): Promise<Tile[]> {
    const want = kind === 'video' ? 'video' : 'image';
    const wp = kind === 'photo' ? await this.wallpapers() : { windows: null, builtins: [] as string[] };
    const shipped = new Set(wp.builtins.map((p) => p.toLowerCase()));
    const yours = (p: string): boolean => !!p && !shipped.has(p.toLowerCase());
    const mine = this.recent().filter((r) => r.kind === want && yours(r.path));
    const cur = this.current();
    if (cur.kind === want && yours(cur.path) && !mine.some((r) => r.path.toLowerCase() === cur.path.toLowerCase())) mine.unshift(cur);
    const own: Tile[] = mine.map((r) => ({ kind: r.kind, path: r.path, label: baseName(r.path) }));
    if (kind === 'video') return own;
    const builtins: Tile[] = wp.builtins.map((p) => ({ kind: 'image', path: p, label: builtinName(p, wp.builtins) }));
    return [{ kind: 'windows', path: wp.windows ?? '', label: 'Your Windows wallpaper' }, ...own, ...builtins];
  }

  /**
   * The Home page reports a file it could not show on its <html> (data-state="error"). Read it from
   * any Home tab of this window (in-process page: its document is reachable from chrome).
   */
  homeError(): string | null {
    const cur = this.current();
    if (cur.kind !== 'image' && cur.kind !== 'video') return null;
    for (const t of this.b.tabs) {
      if (t.kind !== 'home') continue;
      try {
        const d = (t.browser.contentDocument?.documentElement as HTMLElement | undefined)?.dataset;
        if (d?.state === 'error' && d.kind === cur.kind) return `Couldn’t open ${baseName(cur.path)}`;
      } catch {
        /* no document yet */
      }
    }
    return null;
  }

  private changed(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (e) {
        console.error('Deer settings: background listener failed', e);
      }
    }
  }

  // ---- recently used files ----

  private recent(): HomeBg[] {
    try {
      const list = JSON.parse(Services.prefs.getStringPref(RECENT_PREF, '[]')) as HomeBg[];
      return Array.isArray(list) ? list.filter((r) => r && (r.kind === 'image' || r.kind === 'video') && typeof r.path === 'string' && r.path) : [];
    } catch {
      return [];
    }
  }

  private writeRecent(list: HomeBg[]): void {
    try {
      Services.prefs.setStringPref(RECENT_PREF, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
      /* the picker just shows fewer tiles */
    }
  }

  private remember(bg: HomeBg): void {
    this.writeRecent([{ kind: bg.kind, path: bg.path }, ...this.recent().filter((r) => r.path.toLowerCase() !== bg.path.toLowerCase())]);
  }

  private forget(path: string): void {
    this.writeRecent(this.recent().filter((r) => r.path.toLowerCase() !== path.toLowerCase()));
  }
}
