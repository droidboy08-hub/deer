// Settings and Home background, main-process side: folder and file pickers, thumbnails,
// clearing site data, About details, and the Appearance mode for every surface.
import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { Settings } from '../../shared/settings';
import type { MainContext } from '../context';
import { findWallpaper } from '../wallpaper';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'm4v', 'mov', 'ogv'];
const THUMB_CACHE_MAX = 64;
const BUILTIN_MAX = 8;

const thumbs = new Map<string, string | null>();

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

function extOf(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}

function isFile(p: unknown): p is string {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Appearance › Mode drives prefers-color-scheme for Vitre's own surfaces and for pages, as in Chrome. */
function applyMode(theme: Settings['theme']): void {
  const source = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
}

async function pickFolder(e: IpcMainInvokeEvent, current: unknown): Promise<string | null> {
  const win = senderWindow(e);
  const opts: Electron.OpenDialogOptions = {
    title: 'Save downloads to',
    defaultPath: typeof current === 'string' && current ? current : app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

async function pickMedia(e: IpcMainInvokeEvent, want: unknown): Promise<{ kind: 'image' | 'video'; path: string } | null> {
  const win = senderWindow(e);
  const filters: Electron.FileFilter[] =
    want === 'image'
      ? [{ name: 'Photos', extensions: IMAGE_EXT }]
      : want === 'video'
        ? [{ name: 'Videos', extensions: VIDEO_EXT }]
        : [
            { name: 'Photos and videos', extensions: [...IMAGE_EXT, ...VIDEO_EXT] },
            { name: 'Photos', extensions: IMAGE_EXT },
            { name: 'Videos', extensions: VIDEO_EXT },
          ];
  const opts: Electron.OpenDialogOptions = {
    title: want === 'video' ? 'Choose a video for Home' : want === 'image' ? 'Choose a photo for Home' : 'Choose a photo or video for Home',
    defaultPath: app.getPath(want === 'video' ? 'videos' : 'pictures'),
    properties: ['openFile'],
    filters,
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const file = r.canceled ? undefined : r.filePaths[0];
  if (!file) return null;
  const ext = extOf(file);
  if (VIDEO_EXT.includes(ext)) return { kind: 'video', path: file };
  if (IMAGE_EXT.includes(ext)) return { kind: 'image', path: file };
  return null;
}

/** A small JPEG data URL for a background tile, or null when Windows can't make one. */
async function thumbnail(p: unknown, width: unknown): Promise<string | null> {
  if (!isFile(p)) return null;
  const w = Math.max(64, Math.min(640, Math.round(Number(width) || 320)));
  const key = `${p}|${w}`;
  if (thumbs.has(key)) return thumbs.get(key) ?? null;
  let img: Electron.NativeImage | null = null;
  try {
    img = await nativeImage.createThumbnailFromPath(p, { width: w, height: Math.round((w * 10) / 16) });
  } catch {
    img = null;
  }
  if ((!img || img.isEmpty()) && !VIDEO_EXT.includes(extOf(p))) {
    const full = nativeImage.createFromPath(p);
    img = full.isEmpty() ? null : full.resize({ width: w, quality: 'good' });
  }
  const url = img && !img.isEmpty() ? `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}` : null;
  if (thumbs.size >= THUMB_CACHE_MAX) thumbs.delete(thumbs.keys().next().value as string);
  thumbs.set(key, url);
  return url;
}

/** The desktop wallpaper and the photos that ship with Windows. */
async function wallpapers(): Promise<{ windows: string | null; builtins: string[] }> {
  const windows = await findWallpaper();
  const root = path.join(process.env.SystemRoot || 'C:\\Windows', 'Web', 'Wallpaper');
  const themes: string[][] = [];
  try {
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const files = fs.readdirSync(path.join(root, dir.name)).filter((f) => IMAGE_EXT.includes(extOf(f)));
      files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (files.length) themes.push(files.map((f) => path.join(root, dir.name, f)));
    }
  } catch {
    /* no built-in wallpapers on this edition */
  }
  // One from each theme first, then the second of each, so the first tiles vary.
  const builtins: string[] = [];
  for (let i = 0; builtins.length < BUILTIN_MAX && themes.some((t) => t[i]); i++) {
    for (const t of themes) if (t[i] && builtins.length < BUILTIN_MAX) builtins.push(t[i]);
  }
  return { windows, builtins };
}

async function clearData(ctx: MainContext, what: unknown): Promise<boolean> {
  const w = (what ?? {}) as { cookies?: boolean; cache?: boolean };
  const ses = ctx.session();
  const tasks: Promise<unknown>[] = [];
  if (w.cookies) {
    // Every storage type (cookies, local storage, IndexedDB, service workers, cache storage…).
    tasks.push(ses.clearStorageData());
    tasks.push(ses.clearAuthCache());
  }
  if (w.cache) {
    tasks.push(ses.clearCache());
    tasks.push(ses.clearCodeCaches({}));
    tasks.push(ses.clearHostResolverCache());
  }
  await Promise.all(tasks.map((t) => t.catch((err: unknown) => console.error('clear data failed', err))));
  return true;
}

function aboutInfo(): { version: string; electron: string; chrome: string; userData: string } {
  let version = app.getVersion();
  try {
    // Running from dist-*/main, the app's own package.json sits two folders up.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    if (pkg.version) version = pkg.version;
  } catch {
    /* packaged: app.getVersion() is right */
  }
  return { version, electron: process.versions.electron, chrome: process.versions.chrome, userData: app.getPath('userData') };
}

/** Only Vitre's own window may read files, open dialogs or clear data; pages never can. */
function fromChrome<A extends unknown[], R>(fn: (e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): (e: IpcMainInvokeEvent, ...args: A) => Promise<R | null> {
  return async (e, ...args) => (e.sender.getType() === 'window' ? fn(e, ...args) : null);
}

export function register(ctx: MainContext): void {
  applyMode(ctx.settings.get().theme);
  ctx.settings.onChange((s) => applyMode(s.theme));

  ipcMain.handle('settings:pick-folder', fromChrome((e, current: unknown) => pickFolder(e, current)));
  ipcMain.handle('home:pick-media', fromChrome((e, want: unknown) => pickMedia(e, want)));
  ipcMain.handle('home:thumb', fromChrome((_e, p: unknown, width: unknown) => thumbnail(p, width)));
  ipcMain.handle('home:wallpapers', fromChrome(() => wallpapers()));
  ipcMain.handle('app:clear-data', fromChrome((_e, what: unknown) => clearData(ctx, what)));
  ipcMain.handle('app:about', fromChrome(() => aboutInfo()));
  // Opens only Vitre's own data folder, never a path the renderer names.
  ipcMain.handle('app:open-data-folder', fromChrome(async () => (await shell.openPath(app.getPath('userData'))) === ''));
}
