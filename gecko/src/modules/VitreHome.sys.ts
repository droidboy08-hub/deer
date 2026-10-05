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
}

interface CacheMeta {
  key: string;
  luma: number | null;
  /** The source is no larger than the screen: show the file itself. */
  direct: boolean;
}

/** Same rule as the Electron build: a bright top band gets light glass. */
const LIGHT_LUMA = 0.62;
const THEME_PREF = 'vitre.home.theme';
const CACHE_DIR = 'vitre-home';
/** Never keep a copy wider than this, whatever the screen. */
const MAX_WIDTH = 3840;

let started = false;
let theme: HomeTheme = 'clear';
const listeners = new Set<(theme: HomeTheme) => void>();
let pending: { key: string; promise: Promise<HomePicture | null> } | null = null;

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

function cachePath(name: string): string {
  return PathUtils.join(PathUtils.profileDir, CACHE_DIR, name);
}

/** Mean Rec. 709 luma of the top tenth of something drawable. */
function topLuma(win: any, source: any, width: number, height: number): number | null {
  try {
    const w = 160;
    const h = Math.max(1, Math.round((w * height) / width));
    const canvas = new win.OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const rows = Math.max(1, Math.round(h * 0.1));
    const d = ctx.getImageData(0, 0, w, rows).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  } catch {
    return null;
  }
}

async function build(win: any, path: string, key: string, box: { width: number; height: number }): Promise<HomePicture | null> {
  const metaFile = cachePath('picture.json');
  const copy = cachePath('picture.jpg');
  // 1. A copy made earlier for this file, at this size.
  try {
    const meta = (await IOUtils.readJSON(metaFile)) as CacheMeta;
    if (meta.key === key) {
      if (meta.direct) return { url: VitreHome.fileURL(path), luma: meta.luma, cached: true };
      if (await IOUtils.exists(copy)) return { url: `${VitreHome.fileURL(copy)}?${encodeURIComponent(key.slice(-24))}`, luma: meta.luma, cached: true };
    }
  } catch {
    /* no cache yet, or it is unreadable: build it */
  }
  // 2. Decode. The file is read as bytes, so a missing extension (TranscodedWallpaper) does not matter.
  const bytes = await IOUtils.read(path);
  const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
  try {
    const luma = topLuma(win, bitmap, bitmap.width, bitmap.height);
    // Cover the screen, never upscale.
    const scale = Math.min(1, Math.max(box.width / bitmap.width, box.height / bitmap.height));
    const meta: CacheMeta = { key, luma, direct: scale > 0.98 };
    await IOUtils.makeDirectory(PathUtils.join(PathUtils.profileDir, CACHE_DIR), { ignoreExisting: true });
    if (meta.direct) {
      await IOUtils.writeJSON(metaFile, meta);
      return { url: VitreHome.fileURL(path), luma, cached: false };
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
    return { url: `${VitreHome.fileURL(copy)}?${encodeURIComponent(key.slice(-24))}`, luma, cached: false };
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
};
