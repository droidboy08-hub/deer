// Home (about:vitre-home): what the page needs from the parent process, and the one piece of state
// every window shares about it. Process singleton; the page itself is src/pages/home.
// Recipe: spikes/switcher/RESULT.md section 5 and the verifier's "Home" corrections.
//
//   VitreHome.init()                 idempotent; called by every window's Browser at boot.
//   VitreHome.theme                  'light' | 'clear': the glass that suits Home's background
//                                    (light over a bright picture, clear otherwise). Remembered in
//                                    the pref vitre.home.theme so the first frame after a start
//                                    already has it.
//   VitreHome.setTheme(theme)        called by the Home page once it knows its picture's brightness.
//   VitreHome.onTheme(fn)            fn(theme) on every change; returns an unsubscribe. The window's
//                                    Browser forwards it to b.setHomeTheme().
//   VitreHome.windowsWallpaper()     { path, source } of the user's Windows desktop wallpaper, or null.
//   VitreHome.picture(win, path, box)
//                                    a picture ready to show as Home's background:
//                                    { url, luma, cached }. A picture larger than the screen is
//                                    decoded once and kept as a screen-sized JPEG in
//                                    <profile>\vitre-home (a 5K wallpaper otherwise costs 100-300 ms
//                                    per new tab); luma is the mean brightness of its top tenth,
//                                    where the tab bar sits. `win` is the calling page's window
//                                    (image decoding and canvas live on window globals).
//   VitreHome.background(win, bg, box)
//                                    the picture of a Home background setting ('windows' or 'image':
//                                    finds the wallpaper, then picture()), remembered in memory for
//                                    the next Home tab.
//   VitreHome.peek(bg, box)          synchronously, what background() last answered for this setting
//                                    and screen, or null: a new Home tab starts loading it before any
//                                    file access (each one otherwise waits for 4-5 file reads first).
//   VitreHome.baseColor(bg)          the mean colour of that background's picture (remembered in the
//                                    pref vitre.home.color across restarts), or null: what Home paints
//                                    under the picture while it decodes, instead of the plain grey.
//   VitreHome.themeFor(luma)         the rule: luma above 0.62 is light glass.
//   VitreHome.fileURL(path)          file: URL for a Windows path (spaces, #, non-ASCII).
// Everything here is local file access: nothing is fetched from the network.

export type HomeTheme = 'light' | 'clear';

export interface HomePicture {
  /** file: URL to show: the screen-sized copy, or the file itself when it is small enough. */
  url: string;
  /** Mean luma (0..1) of the top tenth of the picture, or null when it could not be read. */
  luma: number | null;
  /** True when the answer came from the cache (nothing was decoded). */
  cached: boolean;
  /** Mean colour of the whole picture, '#rrggbb', or null when it could not be read. */
  color: string | null;
}

/** The part of Settings' homeBackground these calls need. */
export interface HomeBackground {
  kind: string;
  path: string;
}

interface CacheMeta {
  key: string;
  luma: number | null;
  /** Absent in caches written before 2026-10-05: such a cache is rebuilt once. */
  color?: string | null;
  /** The source is no larger than the screen: show the file itself. */
  direct: boolean;
}

/** Same rule as the Electron build: a bright top band gets light glass. */
const LIGHT_LUMA = 0.62;
const THEME_PREF = 'vitre.home.theme';
const COLOR_PREF = 'vitre.home.color';
const CACHE_DIR = 'vitre-home';
/** Never keep a copy wider than this, whatever the screen. */
const MAX_WIDTH = 3840;

let started = false;
let theme: HomeTheme = 'clear';
const listeners = new Set<(theme: HomeTheme) => void>();
let pending: { key: string; promise: Promise<HomePicture | null> } | null = null;
/** What background() answered last (one entry: Home shows one background at a time). */
let remembered: { key: string; picture: HomePicture } | null = null;

/** A background setting without the screen: 'windows' does not depend on the path field. */
const settingKey = (bg: HomeBackground): string => `${bg.kind}|${bg.kind === 'windows' ? '' : bg.path}`;
const memoryKey = (bg: HomeBackground, box: { width: number; height: number }): string => `${settingKey(bg)}|${Math.round(box.width)}x${Math.round(box.height)}`;

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

function cachePath(name: string): string {
  return PathUtils.join(PathUtils.profileDir, CACHE_DIR, name);
}

/** Mean Rec. 709 luma of the top tenth of something drawable, and the mean colour of all of it. */
function sample(win: any, source: any, width: number, height: number): { luma: number | null; color: string | null } {
  try {
    const w = 160;
    const h = Math.max(1, Math.round((w * height) / width));
    const canvas = new win.OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const topEnd = Math.max(1, Math.round(h * 0.1)) * w * 4;
    let luma = 0;
    const rgb = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      if (i < topEnd) luma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      rgb[0] += d[i];
      rgb[1] += d[i + 1];
      rgb[2] += d[i + 2];
    }
    const n = d.length / 4;
    const hex = rgb.map((c) => Math.round(c / n).toString(16).padStart(2, '0')).join('');
    return { luma: luma / (topEnd / 4) / 255, color: '#' + hex };
  } catch {
    return { luma: null, color: null };
  }
}

async function build(win: any, path: string, key: string, box: { width: number; height: number }): Promise<HomePicture | null> {
  const metaFile = cachePath('picture.json');
  const copy = cachePath('picture.jpg');
  // 1. A copy made earlier for this file, at this size.
  try {
    const meta = (await IOUtils.readJSON(metaFile)) as CacheMeta;
    if (meta.key === key && meta.color !== undefined) {
      const known = { luma: meta.luma, cached: true, color: meta.color };
      if (meta.direct) return { url: VitreHome.fileURL(path), ...known };
      if (await IOUtils.exists(copy)) return { url: `${VitreHome.fileURL(copy)}?${encodeURIComponent(key.slice(-24))}`, ...known };
    }
  } catch {
    /* no cache yet, or it is unreadable: build it */
  }
  // 2. Decode. The file is read as bytes, so a missing extension (TranscodedWallpaper) does not matter.
  const bytes = await IOUtils.read(path);
  const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
  try {
    const { luma, color } = sample(win, bitmap, bitmap.width, bitmap.height);
    // Cover the screen, never upscale.
    const scale = Math.min(1, Math.max(box.width / bitmap.width, box.height / bitmap.height));
    const meta: CacheMeta = { key, luma, color, direct: scale > 0.98 };
    await IOUtils.makeDirectory(PathUtils.join(PathUtils.profileDir, CACHE_DIR), { ignoreExisting: true });
    if (meta.direct) {
      await IOUtils.writeJSON(metaFile, meta);
      return { url: VitreHome.fileURL(path), luma, cached: false, color };
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new win.OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    await IOUtils.write(copy, new Uint8Array(await blob.arrayBuffer()), { tmpPath: copy + '.tmp' });
    await IOUtils.writeJSON(metaFile, meta);
    return { url: `${VitreHome.fileURL(copy)}?${encodeURIComponent(key.slice(-24))}`, luma, cached: false, color };
  } finally {
    bitmap.close();
  }
}

export const VitreHome = {
  LIGHT_LUMA,

  /** Idempotent. Reads the theme the last session ended with (user prefs are loaded by now). */
  init(): void {
    if (started) return;
    started = true;
    try {
      theme = Services.prefs.getStringPref(THEME_PREF, 'clear') === 'light' ? 'light' : 'clear';
    } catch {
      theme = 'clear';
    }
  },

  get theme(): HomeTheme {
    VitreHome.init();
    return theme;
  },

  setTheme(next: HomeTheme): void {
    VitreHome.init();
    if (next !== 'light' && next !== 'clear') return;
    if (next === theme) return;
    theme = next;
    try {
      Services.prefs.setStringPref(THEME_PREF, next);
    } catch {
      /* not fatal: the next start begins on clear glass */
    }
    for (const fn of [...listeners]) {
      try {
        fn(next);
      } catch (e) {
        console.error('VitreHome theme listener failed', e);
      }
    }
  },

  onTheme(fn: (theme: HomeTheme) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  themeFor(luma: number | null): HomeTheme {
    return luma !== null && luma > LIGHT_LUMA ? 'light' : 'clear';
  },

  /** file: URL for a Windows path (nsIIOService.newFileURI escapes '#', '?', '%', spaces, non-ASCII). */
  fileURL(path: string): string {
    return Services.io.newFileURI(localFile(path)).spec;
  },

  /**
   * The user's desktop wallpaper: HKCU\Control Panel\Desktop\WallPaper (nsIWindowsRegKey), else
   * %APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper (what the desktop shows now; it has no
   * extension). Null with a solid-colour desktop.
   */
  async windowsWallpaper(): Promise<{ path: string; source: 'registry' | 'transcoded' } | null> {
    let fromRegistry = '';
    const key = Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
    try {
      key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, 'Control Panel\\Desktop', Ci.nsIWindowsRegKey.ACCESS_READ);
      if (key.hasValue('WallPaper')) fromRegistry = key.readStringValue('WallPaper');
    } catch {
      fromRegistry = '';
    } finally {
      try {
        key.close();
      } catch {
        /* never opened */
      }
    }
    const exists = async (p: string): Promise<boolean> => {
      try {
        return !!p && (await IOUtils.exists(p));
      } catch {
        return false;
      }
    };
    if (await exists(fromRegistry)) return { path: fromRegistry, source: 'registry' };
    const appdata = Services.env.get('APPDATA');
    const transcoded = appdata ? PathUtils.join(appdata, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper') : '';
    if (await exists(transcoded)) return { path: transcoded, source: 'transcoded' };
    return null;
  },

  /**
   * A picture ready to show. `box` is the screen in device pixels. Callers asking for the same
   * file at the same size while a decode runs share it. The decode runs on the calling page's
   * window (image decoding and canvas are window APIs; the shared system global has no
   * createImageBitmap), whose DOM promises never settle once that window is gone: a Home tab closed
   * mid-decode (Ctrl+T, Ctrl+W within the first decode of a large wallpaper) therefore rejects the
   * shared promise at its unload, and the next caller decodes again. The shared entry is cleared
   * whichever way it settles; a finished build is then served from the cache files.
   */
  async picture(win: any, path: string, box: { width: number; height: number }): Promise<HomePicture | null> {
    const stat = await IOUtils.stat(path);
    const width = Math.min(MAX_WIDTH, Math.max(1, Math.round(box.width)));
    const height = Math.max(1, Math.round((box.height * width) / Math.max(1, box.width)));
    const key = `${path}|${stat.lastModified}|${stat.size}|${width}x${height}`;
    if (pending?.key === key) return pending.promise;
    const promise = new Promise<HomePicture | null>((resolve, reject) => {
      let settled = false;
      const gone = (): void => {
        if (settled) return;
        settled = true;
        reject(new Error('Deer Home: the window decoding the picture went away'));
      };
      try {
        if (win.closed) {
          gone();
          return;
        }
        win.addEventListener('unload', gone, { once: true });
      } catch {
        /* not a window: the decode must stand on its own */
      }
      build(win, path, key, { width, height }).then(
        (result) => {
          settled = true;
          resolve(result);
        },
        (error) => {
          settled = true;
          reject(error);
        }
      );
    });
    pending = { key, promise };
    const clear = (): void => {
      if (pending?.promise === promise) pending = null;
    };
    promise.then(clear, clear);
    return promise;
  },

  /**
   * The picture of a 'windows' or 'image' background (null: no wallpaper, no path, or the file is
   * gone), remembered for peek() and baseColor(). Rejects as picture() does.
   */
  async background(win: any, bg: HomeBackground, box: { width: number; height: number }): Promise<HomePicture | null> {
    const path = bg.kind === 'windows' ? (await VitreHome.windowsWallpaper())?.path : bg.kind === 'image' ? bg.path : '';
    const picture = path ? await VitreHome.picture(win, path, box) : null;
    remembered = picture ? { key: memoryKey(bg, box), picture } : null;
    const color = picture?.color ? JSON.stringify({ key: settingKey(bg), color: picture.color }) : '';
    try {
      if (Services.prefs.getStringPref(COLOR_PREF, '') !== color) Services.prefs.setStringPref(COLOR_PREF, color);
    } catch {
      /* not fatal: the first Home after a start paints the plain grey under its picture */
    }
    return picture;
  },

  peek(bg: HomeBackground, box: { width: number; height: number }): HomePicture | null {
    return remembered?.key === memoryKey(bg, box) ? remembered.picture : null;
  },

  baseColor(bg: HomeBackground): string | null {
    if (remembered?.key.startsWith(settingKey(bg) + '|')) return remembered.picture.color;
    try {
      const saved = JSON.parse(Services.prefs.getStringPref(COLOR_PREF, '') || 'null');
      return saved?.key === settingKey(bg) && /^#[0-9a-f]{6}$/.test(saved.color) ? saved.color : null;
    } catch {
      return null;
    }
  },
};
