// The person's desktop picture, for Home's "Your Mac wallpaper" background. The setting keeps its
// Windows-era kind, 'windows', on macOS too, so no stored setting is migrated (port plan D11). macOS
// only for now: on Windows VitreHome.windowsWallpaper() still reads the registry itself, and
// desktopWallpaper() answers null there.
//
//   desktopWallpaper(cacheDir)   { path, source } of a picture Gecko can decode, or null. In order:
//                                1. the file [NSWorkspace desktopImageURLForScreen:] names for the
//                                   main screen ('desktop');
//                                2. macOS's own default, /System/Library/CoreServices/DefaultDesktop.heic
//                                   ('default');
//                                3. null: Home shows its plain base colour, as for kind 'none'.
//                                A step gives nothing when its file is gone, unreadable or not a
//                                regular file (a dynamic or aerial wallpaper can come back as a
//                                .madesktop or a folder), or when sips can't read it. Never rejects.
//
// Gecko 157 decodes no HEIC (nor HEIF, TIFF...), which is what macOS's own wallpapers are, so such a
// file is converted once with /usr/bin/sips into a JPEG at most 2880 px on its long side, kept as
// <cacheDir>/src-<path hash>-<mtime>-<size>.jpg (cacheDir is VitreHome's <profile>/vitre-home): a new
// or edited wallpaper gets a new name and is converted again, and the older copy is removed then.
// VitreHome then makes its usual screen-sized copy from that JPEG. A file Gecko decodes is used as
// it is. The wallpaper store (~/Library/Application Support/com.apple.wallpaper) is never read: its
// format is private; NSWorkspace is the public way to ask.
//
// Firefox internals: resource://gre/modules/Subprocess.sys.mjs (toolkit/modules/subprocess: call,
// stdout.readString, wait, kill), resource://gre/modules/Timer.sys.mjs (toolkit/modules/Timer.sys.mjs),
// IOUtils (dom/chrome-webidl/IOUtils.webidl: stat, exists, makeDirectory, move, remove, getChildren),
// PathUtils (dom/chrome-webidl/PathUtils.webidl). AppKit through ./objc, on the main thread: every
// caller is a parent-process system module.
import { isMac } from '../../shared/os';
import * as objc from './objc';

export interface DesktopWallpaper {
  /** A picture Gecko decodes: the wallpaper file itself, or the JPEG copy of it in the cache folder. */
  path: string;
  /** 'desktop': what the main screen shows; 'default': macOS's default wallpaper instead. */
  source: 'desktop' | 'default';
}

const DEFAULT_DESKTOP = '/System/Library/CoreServices/DefaultDesktop.heic';
const SIPS = '/usr/bin/sips';
/** The long side of a converted copy, in pixels. */
const CONVERTED_MAX = 2880;
/** sips takes about half a second for a 4K HEIC; one that hangs (a stalled volume) is stopped. */
const SIPS_TIMEOUT_MS = 30000;
/** Extensions of what Gecko 157 decodes itself (image/decoders): everything else goes through sips. */
const DECODABLE = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'bmp', 'webp', 'avif']);

/** Conversions under way, by output path: Home and the switcher ask at the same moment. */
const converting = new Map<string, Promise<boolean>>();
/** Sources sips could not read (path|mtime|size): not tried again this session. */
const unreadable = new Set<string>();

/** Subprocess (toolkit/modules/subprocess/Subprocess.sys.mjs), loaded on first use. */
function subprocess(): any {
  return ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs').Subprocess;
}

/** setTimeout and clearTimeout (toolkit/modules/Timer.sys.mjs): a system module's global has no window timers. */
function timers(): { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void } {
  return ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
}

/**
 * The file the desktop shows on the main screen: [[NSWorkspace sharedWorkspace]
 * desktopImageURLForScreen:[NSScreen mainScreen]] (AppKit), when that is a file: URL, as
 * [[url path] UTF8String]. Every object here is autoreleased (./objc) and none outlives this call.
 * null when there is no screen, no URL or no path.
 */
function workspacePicture(): string | null {
  try {
    const id = objc.id();
    const ws = objc.send(id)(objc.cls('NSWorkspace'), objc.sel('sharedWorkspace'));
    const screen = objc.send(id)(objc.cls('NSScreen'), objc.sel('mainScreen'));
    if (objc.isNil(ws) || objc.isNil(screen)) return null;
    const url = objc.send(id, id)(ws, objc.sel('desktopImageURLForScreen:'), screen);
    // BOOL is a C bool on arm64 (Deer's Mac build is arm64 only).
    if (objc.isNil(url) || !objc.send(objc.ctypes().bool)(url, objc.sel('isFileURL'))) return null;
    return objc.jsString(objc.send(id)(url, objc.sel('path'))) || null;
  } catch (e) {
    console.error('Deer: desktop picture unavailable', e);
    return null;
  }
}

/** 32 bits of FNV-1a, for a short file name. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The lower-case extension of a path's file name, or ''. */
function extension(path: string): string {
  const name = PathUtils.filename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

async function exists(path: string): Promise<boolean> {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

/**
 * Run /usr/bin/sips: src as a JPEG at most CONVERTED_MAX px on its long side, written to out. True when
 * sips exits 0 (it also does for a folder, writing nothing: the caller checks the file).
 */
async function sips(src: string, out: string): Promise<boolean> {
  const proc = await subprocess().call({
    command: SIPS,
    arguments: ['-s', 'format', 'jpeg', '-Z', String(CONVERTED_MAX), src, '--out', out],
    stderr: 'stdout',
  });
  const { setTimeout, clearTimeout } = timers();
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }, SIPS_TIMEOUT_MS);
  try {
    // Read what it prints (the paths, or why it failed) so it never waits on a full pipe.
    while (await proc.stdout.readString()) {
      /* nothing to keep */
    }
    const { exitCode } = await proc.wait();
    return exitCode === 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Remove the copies of earlier wallpapers: only `keep` stays. */
async function prune(cacheDir: string, keep: string): Promise<void> {
  try {
    for (const child of await IOUtils.getChildren(cacheDir)) {
      const name = PathUtils.filename(child);
      if (child === keep || !name.startsWith('src-') || !name.endsWith('.jpg') || name.endsWith('.part.jpg')) continue;
      await IOUtils.remove(child, { ignoreAbsent: true });
    }
  } catch {
    /* not fatal: an old copy stays until the next change */
  }
}

/** Convert src into out through a .part file, so out is only ever a whole JPEG. */
async function convert(src: string, out: string, cacheDir: string): Promise<boolean> {
  const part = out.replace(/\.jpg$/, '.part.jpg');
  try {
    await IOUtils.makeDirectory(cacheDir, { ignoreExisting: true });
    if (!(await sips(src, part)) || !(await exists(part))) return false;
    await IOUtils.move(part, out);
  } catch (e) {
    console.error('Deer: wallpaper conversion failed', e);
    return false;
  } finally {
    try {
      await IOUtils.remove(part, { ignoreAbsent: true });
    } catch {
      /* not fatal: the next conversion of this file writes over it */
    }
  }
  await prune(cacheDir, out);
  return true;
}

/** A path Gecko can show for this picture: the file itself, or its JPEG copy (made now if missing). null: unusable. */
async function decodable(path: string, cacheDir: string): Promise<string | null> {
  let stat: any;
  try {
    stat = await IOUtils.stat(path);
  } catch {
    return null; // gone, or not ours to read
  }
  if (stat.type !== 'regular' || !(stat.size > 0)) return null;
  if (DECODABLE.has(extension(path))) return path;
  const key = `${path}|${stat.lastModified}|${stat.size}`;
  if (unreadable.has(key)) return null;
  const name = `src-${fnv(path).toString(36)}-${Number(stat.lastModified).toString(36)}-${Number(stat.size).toString(36)}.jpg`;
  const out = PathUtils.join(cacheDir, name);
  if (await exists(out)) return out;
  let job = converting.get(out);
  if (!job) {
    job = convert(path, out, cacheDir);
    converting.set(out, job);
    const done = job;
    const clear = (): void => {
      if (converting.get(out) === done) converting.delete(out);
    };
    done.then(clear, clear);
  }
  if (await job) return out;
  unreadable.add(key);
  return null;
}

/** The desktop picture as a file Gecko decodes (see the top of this file). macOS only: null elsewhere. */
export async function desktopWallpaper(cacheDir: string): Promise<DesktopWallpaper | null> {
  if (!isMac) return null;
  const shown = workspacePicture();
  const desktop = shown ? await decodable(shown, cacheDir) : null;
  if (desktop) return { path: desktop, source: 'desktop' };
  const fallback = await decodable(DEFAULT_DESKTOP, cacheDir);
  return fallback ? { path: fallback, source: 'default' } : null;
}
