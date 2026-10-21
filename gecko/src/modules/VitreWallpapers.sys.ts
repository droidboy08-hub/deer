// Deer wallpapers: the collection the owner hosts on GitHub (droidboy08-hub/deer-wallpapers, served by
// GitHub Pages), offered as one more group, "Deer wallpapers", in the background picker's Photo tab
// (its photos) and Video tab (its videos, the live wallpapers); the picker is in Settings › Home and
// background and Home's Background popover (src/window/modules/settings/bg-picker.ts).
// Owner's plan of 2026-10-21: nothing is asked of the network until the person clicks the group's
// "Get wallpapers" (Photo tab) or "Get live wallpapers" (Video tab). A Get reads index.json and
// downloads every item of that kind not here yet, thumbnail and file, one after the other; an item
// becomes a tile once both are in and checked, and choosing a tile applies it at once (an ordinary
// 'image' or 'video' background on the profile copy: Home shows it as any other photo, or plays it as
// any other video, muted and looping). Nothing changes by itself: no rotation, no picture of the day.
// A process singleton (window code: b.sys('VitreWallpapers')).
//
// What is contacted, and when (nothing else, and nothing before a Get is clicked):
//   GET <base>index.json                          once per Get (at most 1 MiB, within a minute)
//   GET <base>wallpapers/thumbs/<id>.jpg, then    each photo of the index not here yet (a Get of
//       <base>wallpapers/<id>.jpg                 photos), one at a time
//   GET <base>live-wallpapers/thumbs/<id>.jpg,    each video likewise (a Get of live wallpapers)
//       then <base>live-wallpapers/<id>.mp4
// <base> is BASE, or the hidden pref vitre.wallpapers.base when it is an https:// address or
// http://127.0.0.1 / http://localhost (the tests' stand-in; tools/run.py points it at a port nothing
// listens on, so no test reaches GitHub). Every request is fetch() with credentials 'omit' (Necko's
// LOAD_ANONYMOUS: no cookie sent, none stored), no referrer, cache 'no-store' (nothing taken from or
// kept in the HTTP cache), redirect 'error' (an address that redirects anywhere fails), no query
// string; the browser's own headers otherwise.
//
// A Get (get(kind)): index.json must be a version 2 index (the rules are in wallpapers/manifest.ts:
// each entry is checked on its own, a bad one is skipped and named in a console warning). Then, of
// that kind only: the copies the index no longer lists (or retires) are removed, except the current
// background's; every entry not here yet (or here with other bytes, unless Home shows that copy) and
// not removed by the person is downloaded, newest first. An item the server answers wrongly (an HTTP
// error, the wrong size, hash or format) is skipped and the Get goes on; the network failing stops it
// (no answer, no byte for 30 s, or an answer cut off before its Content-Length: over HTTP/1.x Necko
// hands such a body over as if complete). Either way the Get ends 'failed' (the picker's line:
// "Couldn’t get wallpapers. Try again.") and what came in stays. A Get is stopped by stop(kind) (the
// button clicked again) and when no picker has been open for a second ("leaving": closing Settings or
// the popover; switching the picker's tab does not stop it); an item whose bytes are all in is kept.
// A Get that found everything ends 'complete' for that base (the button then reads "Check for new
// wallpapers"); one that had nothing to fetch ends 'nothing-new'.
//
// Nothing from the server is trusted: every file is read with its listed size as a hard limit. A
// photo or a thumbnail is read whole, and before a byte is written it must be exactly that size, hash
// to the SHA-256 listed, start with a JPEG's FF D8 FF and have a frame of the width and height listed
// (a thumbnail at most 2048 px a side); it is then written under a temporary name and renamed. A
// video is never held whole in memory: it is written to <id>.mp4.part as it arrives, hashed on the
// way, and refused as soon as it does not start as an MP4 video does (its whole 'ftyp' box, read
// before a byte is written, naming an MP4 brand and no picture's: AVIF and HEIC have that box too) or
// runs past its size; it is renamed to <id>.mp4 only once its size and SHA-256 are the ones listed. A
// failure leaves nothing behind.
//
// Files, only ever in <profile>\deer-wallpapers (nothing outside it is written or removed):
//   wallpapers\<id>.jpg, wallpapers\thumbs\<id>.jpg              photos and their thumbnails
//   live-wallpapers\<id>.mp4, live-wallpapers\thumbs\<id>.jpg    videos and their posters
//   state.json   the items here (each as its index entry was: title, credit, colour, sizes, hashes),
//                each kind's order in the last index, the ids the person removed (later Gets skip
//                them), the base each kind's last Get was complete at, and the record of a file of
//                Deer 0.1.5-0.1.8 that is still Home's background
// Deer 0.1.5-0.1.8 kept <id>.jpg / <id>.mp4 at the folder's top (the current background, the 5 photos
// and 2 videos chosen last), thumbs\<id>.jpg, its last wallpapers.json and chosen.json. When the folder
// is first read (no network): each of those files that wallpapers.json (of this base) lists with its
// size and SHA-256, and whose thumbnail is the one listed too, moves into the new layout with that
// entry as its record (an upgrade loses no tile; a Get later finds it here, or removes it when the
// index no longer lists it); the one that is Home's background stays where it is and keeps working
// (its tile shows first, from chosen.json's record) until the background is something else, and a
// Get that brings the same file (same SHA-256) moves Home to the new copy; everything else of that
// version goes. When the folder is first read in a session, and at each Get for its kind, files no
// record vouches for go (a write cut short, a removal Home held up) and records whose files have gone
// are dropped.
// Nothing is written or removed through a link: before every write and removal, the folder and each
// folder down to the file must be an ordinary folder (kernel32 GetFileAttributesW: a directory, and
// no reparse point, so neither a junction nor a symbolic link; nsIFile.isSymlink is false for a
// junction), and a temporary name is cleared before a write so a link planted there is not followed.
// Removal is of files named as above, in those folders.
//
// Contract:
//   watch(kind)            a picker is open (it watches both kinds, whichever tab shows); returns the
//                          call for when it closes (a second after the last one closes, that kind's
//                          Get stops and its line is forgotten). Reads the folder (no network).
//   state() / onChange(fn) the tiles (both kinds; each Get's progress, outcome and completeness);
//                          fn() on every change; returns the remover
//   get(kind)              'done' | 'failed' | 'stopped' | 'busy' (one Get of a kind at a time)
//   stop(kind)             stop that kind's Get
//   choose(id, kind)       apply a tile (its copy is here): 'applied' | 'failed' (the file has gone:
//                          its record goes too, nothing else is touched, a Get under way goes on)
//   remove(id, kind)       the person's "Remove": the copy and its thumbnail go, later Gets skip it;
//                          Home's background, it is set back to the default (as on a first start)
//   isDeerPath(path)       a file of this folder (the picker keeps it out of the recent photos and videos)
//   folder()               <profile>\deer-wallpapers
// A video chosen also gives VitreHome its entry's colour (setBaseColor): a Home page loading it paints
// that colour until the first frame is in. debug() tells tests what is going on.
//
// Firefox internals (157): fetch() in the shared system global (as VitreUpdater uses it);
// RequestCredentials 'omit' -> nsIRequest::LOAD_ANONYMOUS (dom/fetch/FetchDriver.cpp); IOUtils
// (write with tmpPath or mode 'append', read with offset / maxBytes, move, getChildren, stat, remove);
// nsICryptoHash (update() takes a Uint8Array: XPConnect copies a typed array of octets as it is;
// 8 MiB in about 12 ms); js-ctypes for GetFileAttributesW (as downloads/partfile.ts uses kernel32).
import { VitreHome } from 'chrome://vitre/content/modules/VitreHome.sys.mjs';
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { checkEntry, checkIndex, checkRecord, EXT, fileOf, FOLDER, ID_RE, jpegSize, KINDS, MAX_ENTRIES, MAX_FTYP, MAX_INDEX, MAX_THUMB_SIDE, mp4Start, thumbOf, toRecord, type Index, type WallpaperEntry, type WallpaperKind } from './wallpapers/manifest';

declare global {
  interface VitreSysModules {
    VitreWallpapers: typeof VitreWallpapers;
  }
}

/** One tile of a group. */
export interface WallpaperTile {
  id: string;
  /** 'photo': a tile of the Photo tab's group; 'video': of the Video tab's. */
  kind: WallpaperKind;
  title: string;
  /** Both '' for the owner's own files (no credit), or a file whose credit was never recorded. */
  author: string;
  license: string;
  /** '#rrggbb': the face under the thumbnail. */
  color: string;
  /** The file in the profile: Home's background once chosen. */
  path: string;
  /** Its checked thumbnail in the profile; '' for a file of Deer 0.1.5-0.1.8 (the face is the file itself). */
  thumb: string;
}

/** A kind's Get, as the picker's button and line show it. */
export interface GetState {
  running: boolean;
  /** The item being fetched (from 1) and how many this Get fetches; both 0 while index.json is read. */
  at: number;
  of: number;
  /** How the last Get ended, while a picker shows that kind's tab ('stopped' leaves none). */
  outcome: 'added' | 'nothing-new' | 'failed' | null;
  /** Items the last Get brought. */
  added: number;
  /** Everything the collection lists of this kind (but what the person removed) is here, as of the last Get. */
  complete: boolean;
}

export interface WallpaperState {
  tiles: WallpaperTile[];
  get: Record<WallpaperKind, GetState>;
  /** The folder has been read (until then the tiles may still come by themselves). */
  ready: boolean;
}

export type GetResult = 'done' | 'failed' | 'stopped' | 'busy';

/** A file Deer 0.1.5-0.1.8 downloaded that is Home's background: its record from chosen.json. */
interface Old {
  id: string;
  kind: WallpaperKind;
  title: string;
  author: string;
  license: string;
  color: string;
  /** '' when chosen.json had no record of it. */
  sha256: string;
}

interface Run {
  ac: AbortController;
  at: number;
  of: number;
}

export const BASE = 'https://droidboy08-hub.github.io/deer-wallpapers/';
/** The credits of the collection's photos and videos (CREDITS.md, made by the collection's Action). */
export const CREDITS = 'https://github.com/droidboy08-hub/deer-wallpapers/blob/main/CREDITS.md';
const BASE_PREF = 'vitre.wallpapers.base';
const DIR = 'deer-wallpapers';
const STATE = 'state.json';
/** No byte for this long: the request is given up (as the network failing). */
const IDLE_MS = 30_000;
/** index.json and a thumbnail, whole, within this. */
const SMALL_DEADLINE_MS = 60_000;
/** The last picker of a kind gone this long: its Get stops (a re-render builds a new picker at once). */
const STOP_DELAY_MS = 1000;
/** A video goes to its temporary file this much at a time. */
const WRITE_STEP = 1024 * 1024;
const NAME = '([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)';
/** Each kind's files, and what a write cut short leaves of them. */
const FILE: Record<WallpaperKind, RegExp> = { photo: new RegExp(`^${NAME}\\.jpg$`), video: new RegExp(`^${NAME}\\.mp4$`) };
const FILE_TEMP: Record<WallpaperKind, RegExp> = { photo: new RegExp(`^${NAME}\\.jpg\\.part$`), video: new RegExp(`^${NAME}\\.mp4\\.part$`) };
/** Thumbnails, in each kind's thumbs\ (JPEG only). */
const THUMB = new RegExp(`^${NAME}\\.jpg$`);
const THUMB_TEMP = new RegExp(`^${NAME}\\.jpg\\.part$`);
/** Deer 0.1.5-0.1.8's files at the folder's top, its temporary files and its records. */
const OLD_FILE = new RegExp(`^${NAME}\\.(jpg|mp4)$`);
const OLD_TEMP = new RegExp(`^${NAME}\\.(jpg|mp4)\\.part$`);
const OLD_RECORDS = new Set(['wallpapers.json', 'wallpapers.json.tmp', 'chosen.json', 'chosen.json.tmp']);

const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let ready = false;
/** The items here, checked: kind:id -> the entry they were checked against. */
const items = new Map<string, WallpaperEntry>();
/** Each kind's ids in the order of the last index read. */
const order: Record<WallpaperKind, string[]> = { photo: [], video: [] };
/** Ids the person removed: later Gets skip them. */
const removed: Record<WallpaperKind, Set<string>> = { photo: new Set(), video: new Set() };
/** The base each kind's last Get found everything at, or ''. */
const complete: Record<WallpaperKind, string> = { photo: '', video: '' };
let old: Old | null = null;
const runs: Record<WallpaperKind, Run | null> = { photo: null, video: null };
const outcome: Record<WallpaperKind, { kind: 'added' | 'nothing-new' | 'failed'; added: number } | null> = { photo: null, video: null };
const watchers: Record<WallpaperKind, number> = { photo: 0, video: 0 };
const stopTimers: Record<WallpaperKind, number> = { photo: 0, video: 0 };

class Refused extends Error {}

const key = (kind: WallpaperKind, id: string): string => `${kind}:${id}`;
const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('Deer wallpapers: listener failed', e);
    }
  }
}

// ---- where ----

/** BASE, or the stand-in a test gave (https://, or plain http on this machine only). */
function baseURL(): string {
  let v = '';
  try {
    v = Services.prefs.getStringPref(BASE_PREF, '');
  } catch {
    v = '';
  }
  if (!v) return BASE;
  try {
    const u = new URL(v);
    const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if ((u.protocol !== 'https:' && !local) || u.username || u.password || u.search || u.hash) return BASE;
    return u.href.endsWith('/') ? u.href : u.href + '/';
  } catch {
    return BASE;
  }
}

function folder(): string {
  return PathUtils.join(PathUtils.profileDir, DIR);
}

const kindDir = (kind: WallpaperKind): string => PathUtils.join(folder(), FOLDER[kind]);
const thumbDir = (kind: WallpaperKind): string => PathUtils.join(kindDir(kind), 'thumbs');
const filePath = (id: string, kind: WallpaperKind): string => PathUtils.join(kindDir(kind), `${id}.${EXT[kind]}`);
const thumbPath = (id: string, kind: WallpaperKind): string => PathUtils.join(thumbDir(kind), `${id}.jpg`);
const oldPath = (id: string, kind: WallpaperKind): string => PathUtils.join(folder(), `${id}.${EXT[kind]}`);

/** The Deer file a path names: a kind's file, or one of Deer 0.1.5-0.1.8's at the folder's top (`old`). */
function deerFile(path: string): { id: string; kind: WallpaperKind; old: boolean } | null {
  if (!path || typeof path !== 'string') return null;
  const root = folder().toLowerCase() + '\\';
  const p = path.replace(/\//g, '\\').toLowerCase();
  if (!p.startsWith(root)) return null;
  const parts = p.slice(root.length).split('\\');
  if (parts.length === 1) {
    const m = OLD_FILE.exec(parts[0]);
    return m ? { id: m[1], kind: m[2] === 'mp4' ? 'video' : 'photo', old: true } : null;
  }
  if (parts.length !== 2) return null;
  for (const kind of KINDS) {
    const m = parts[0] === FOLDER[kind] ? FILE[kind].exec(parts[1]) : null;
    if (m) return { id: m[1], kind, old: false };
  }
  return null;
}

function isDeerPath(path: string): boolean {
  return !!deerFile(path);
}

/**
 * The current background when it is one of these files: a photo as an 'image' background, a video as
 * a 'video' one (a file shown as the other kind is not one Deer set).
 */
function current(): { id: string; kind: WallpaperKind; old: boolean; path: string } | null {
  try {
    const bg = VitreSettings.get().homeBackground;
    if (bg.kind !== 'image' && bg.kind !== 'video') return null;
    const f = deerFile(bg.path);
    return f && (f.kind === 'video') === (bg.kind === 'video') ? { ...f, path: bg.path } : null;
  } catch {
    return null;
  }
}

/** Home shows this copy (a kind's file, not one of Deer 0.1.5-0.1.8's). */
function isShown(id: string, kind: WallpaperKind): boolean {
  const cur = current();
  return !!cur && !cur.old && cur.id === id && cur.kind === kind;
}

// ---- files ----

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

const INVALID_FILE_ATTRIBUTES = 0xffffffff;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
let kernel32: { attributes: (path: string) => number } | null | undefined;

/**
 * Windows' attributes of what is at `path` itself (kernel32 GetFileAttributesW does not follow a
 * link: a junction or symbolic link shows FILE_ATTRIBUTE_REPARSE_POINT); -1 when nothing is there, null
 * when they cannot be read (no js-ctypes).
 */
function attributes(path: string): number | null {
  if (kernel32 === undefined) {
    try {
      const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
      // Kept open for the session, as downloads/partfile.ts keeps its own.
      const lib = ctypes.open('kernel32.dll');
      kernel32 = { attributes: lib.declare('GetFileAttributesW', ctypes.winapi_abi, ctypes.uint32_t, ctypes.char16_t.ptr) };
    } catch {
      kernel32 = null;
    }
  }
  if (!kernel32) return null;
  try {
    const a = kernel32.attributes(path);
    return a === INVALID_FILE_ATTRIBUTES ? -1 : a;
  } catch {
    return null;
  }
}

/**
 * `dir` is this folder or one inside it, and every folder from <profile>\deer-wallpapers down to it is
 * an ordinary folder of its own, or not there yet (makeDirectory then makes ordinary ones): none is a
 * link (a junction, a symbolic link) to somewhere else. Only then is anything written or removed in it.
 */
function ownFolder(dir: string): boolean {
  const root = folder();
  const d = dir.replace(/\//g, '\\').replace(/\\+$/, '');
  if (d.toLowerCase() !== root.toLowerCase() && !d.toLowerCase().startsWith(root.toLowerCase() + '\\')) return false;
  let p = root;
  for (const part of ['', ...d.slice(root.length).split('\\').filter(Boolean)]) {
    if (part) p = PathUtils.join(p, part);
    const a = attributes(p);
    if (a === -1) return true; // not there yet, nor anything below it
    if (a === null) {
      // No js-ctypes: nsIFile's view (a symbolic link at least).
      try {
        const f = localFile(p);
        if (!f.exists()) return true;
        if (!f.isDirectory() || f.isSymlink()) return false;
      } catch {
        return false;
      }
      continue;
    }
    if (!(a & FILE_ATTRIBUTE_DIRECTORY) || a & FILE_ATTRIBUTE_REPARSE_POINT) return false;
  }
  return true;
}

/** Nothing at `path` (in an own folder): whatever is there, a leftover or a link a write would follow, is removed. */
async function clearPath(path: string): Promise<boolean> {
  if (!ownFolder(PathUtils.parent(path)!)) return false;
  try {
    await IOUtils.remove(path); // a link itself, never what it points at; nothing there is fine
  } catch {
    /* told below */
  }
  const a = attributes(path);
  return a === null ? !(await IOUtils.exists(path)) : a === -1;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await IOUtils.stat(path)).type === 'regular';
  } catch {
    return false;
  }
}

async function removeFile(path: string): Promise<void> {
  if (!ownFolder(PathUtils.parent(path)!)) return;
  try {
    if ((await IOUtils.stat(path)).type === 'regular') await IOUtils.remove(path);
  } catch {
    /* gone already, or in use: removeSoon, the next sweep */
  }
}

/** Remove these files; one Home still holds open (a video playing) goes a moment later, or at the next sweep. */
async function removeSoon(paths: string[], wait = 250): Promise<void> {
  const left: string[] = [];
  for (const p of paths) {
    await removeFile(p);
    if (await exists(p)) left.push(p);
  }
  if (left.length && wait <= 8000) setTimeout(() => void removeSoon(left, wait * 2), wait);
}

async function children(dir: string): Promise<string[]> {
  try {
    return await IOUtils.getChildren(dir);
  } catch {
    return [];
  }
}

/** Make a folder of this one's (refused when it, or one above it, is a link elsewhere). */
async function makeFolder(dir: string): Promise<void> {
  if (!ownFolder(dir)) throw new Error(`${dir} is not an ordinary folder`);
  await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
  if (!ownFolder(dir)) throw new Error(`${dir} is not an ordinary folder`);
}

/** Write checked bytes under a temporary name, then rename; nothing is left when it fails. */
async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await makeFolder(PathUtils.parent(path)!);
  if (!(await clearPath(path + '.part'))) throw new Error(`${path}.part cannot be cleared`);
  try {
    await IOUtils.write(path, bytes, { tmpPath: path + '.part' });
  } catch (e) {
    await removeFile(path + '.part');
    throw e;
  }
}

const hexOf = (raw: string): string => Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

/** A file's SHA-256 when it is `size` bytes (read a few MiB at a time), or null. */
async function fileSha256(path: string, size: number): Promise<string | null> {
  try {
    if ((await IOUtils.stat(path)).size !== size) return null;
    const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
    hash.init(Ci.nsICryptoHash.SHA256);
    const step = 8 * WRITE_STEP;
    for (let at = 0; at < size; ) {
      const piece = await IOUtils.read(path, { offset: at, maxBytes: Math.min(step, size - at) });
      if (!piece.byteLength) return null;
      hash.update(piece, piece.byteLength);
      at += piece.byteLength;
    }
    return hexOf(hash.finish(false));
  } catch {
    return null;
  }
}

let saving: Promise<void> = Promise.resolve();

/** state.json as things are now (one write at a time, in order). */
function save(): Promise<void> {
  const value = {
    version: 2,
    items: [...items.values()].map(toRecord),
    order: { photo: [...order.photo], video: [...order.video] },
    removed: { photo: [...removed.photo], video: [...removed.video] },
    complete: { ...complete },
    old,
  };
  const run = async (): Promise<void> => {
    try {
      await makeFolder(folder());
      const path = PathUtils.join(folder(), STATE);
      if (!(await clearPath(path + '.tmp'))) throw new Error(`${STATE}.tmp cannot be cleared`);
      await IOUtils.writeJSON(path, value, { tmpPath: path + '.tmp' });
    } catch (e) {
      console.warn(`Deer wallpapers: could not write ${STATE}`, e);
    }
  };
  saving = saving.then(run, run);
  return saving;
}

const ids = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.slice(0, max).filter((x): x is string => typeof x === 'string' && ID_RE.test(x)) : []);

/** A record of Deer 0.1.5-0.1.8's chosen.json, or state.json's `old`, checked as an entry's credit is (it is shown). */
function readOld(raw: unknown): Old | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const kind: WallpaperKind | null = c.kind === undefined || c.kind === 'photo' ? 'photo' : c.kind === 'video' ? 'video' : null;
  if (!kind || typeof c.id !== 'string' || !ID_RE.test(c.id)) return null;
  const sha = typeof c.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(c.sha256) ? c.sha256.toLowerCase() : '';
  const zero = '0'.repeat(64);
  const e = checkEntry({ id: c.id, title: c.title, author: c.author, license: c.license, color: c.color, file: fileOf(c.id, kind), thumb: thumbOf(c.id, kind), width: 16, height: 16, duration: 1, bytes: 4, sha256: sha || zero, thumbBytes: 4, thumbSha256: zero }, kind);
  return typeof e === 'string' ? null : { id: e.id, kind, title: e.title, author: e.author, license: e.license, color: e.color, sha256: sha };
}

async function readState(): Promise<void> {
  let j: any = null;
  try {
    j = await IOUtils.readJSON(PathUtils.join(folder(), STATE));
  } catch {
    return; // nothing downloaded yet
  }
  if (!j || typeof j !== 'object' || j.version !== 2) return;
  for (const raw of Array.isArray(j.items) ? j.items.slice(0, 2 * MAX_ENTRIES) : []) {
    const e = checkRecord(raw);
    if (e && !items.has(key(e.kind, e.id))) items.set(key(e.kind, e.id), e);
  }
  for (const kind of KINDS) {
    order[kind] = ids(j.order?.[kind], MAX_ENTRIES);
    removed[kind] = new Set(ids(j.removed?.[kind], 10_000));
    complete[kind] = typeof j.complete?.[kind] === 'string' ? j.complete[kind] : '';
  }
  old = readOld(j.old);
}

/**
 * Deer 0.1.5-0.1.8's wallpapers.json, cached in the folder: its entries by kind:id, checked as an
 * index entry is; only when it came from the collection Deer reads now (it kept the base it came from).
 */
async function oldRecords(): Promise<Map<string, WallpaperEntry>> {
  const out = new Map<string, WallpaperEntry>();
  let j: any = null;
  try {
    j = await IOUtils.readJSON(PathUtils.join(folder(), 'wallpapers.json'));
  } catch {
    return out;
  }
  if (!j || typeof j !== 'object' || j.version !== 1 || j.base !== baseURL() || !Array.isArray(j.wallpapers)) return out;
  const seen = new Set<string>();
  for (const raw of j.wallpapers.slice(0, MAX_ENTRIES)) {
    const id = raw?.id;
    const kind: WallpaperKind | null = raw?.kind === undefined || raw?.kind === 'photo' ? 'photo' : raw?.kind === 'video' ? 'video' : null;
    if (!kind || typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    // Its paths were full/<id>.jpg|mp4 and thumbs/<id>.jpg: the rest is checked as an index entry is.
    const e = checkEntry({ ...raw, file: fileOf(id, kind), thumb: thumbOf(id, kind) }, kind);
    if (typeof e !== 'string') out.set(key(kind, id), e);
  }
  return out;
}

/**
 * A file of Deer 0.1.5-0.1.8 (`path`, at the folder's top) into the new layout when it and its
 * thumbnail (thumbs\<id>.jpg) are the ones its record lists (size, SHA-256, a JPEG of the listed size
 * or an MP4's start): the thumbnail is written to its kind's thumbs\, the file moved, the record kept.
 * False, and nothing kept, otherwise.
 */
async function adopt(e: WallpaperEntry, path: string): Promise<boolean> {
  try {
    const oldThumb = PathUtils.join(folder(), 'thumbs', `${e.id}.jpg`);
    if (!ownFolder(PathUtils.parent(oldThumb)!) || (await IOUtils.stat(oldThumb)).size !== e.thumbBytes) return false;
    const thumb = await IOUtils.read(oldThumb);
    if (await verify(thumb, e.thumbBytes, e.thumbSha256, null)) return false;
    if (e.kind === 'video') {
      const head = await IOUtils.read(path, { maxBytes: MAX_FTYP });
      if (mp4Start(head, e.bytes) !== true || (await fileSha256(path, e.bytes)) !== e.sha256) return false;
    } else if ((await IOUtils.stat(path)).size !== e.bytes || (await verify(await IOUtils.read(path), e.bytes, e.sha256, e))) return false;
    await writeFile(thumbPath(e.id, e.kind), thumb);
    await makeFolder(kindDir(e.kind));
    if (!(await clearPath(filePath(e.id, e.kind)))) return false;
    await IOUtils.move(path, filePath(e.id, e.kind));
    items.set(key(e.kind, e.id), e);
    return true;
  } catch (err) {
    console.warn(`Deer wallpapers: ${e.id} of Deer 0.1.5-0.1.8 was not kept: ${why(err)}`);
    return false;
  }
}

/**
 * Deer 0.1.5-0.1.8's files: the one that is Home's background stays (its record from chosen.json
 * kept in state.json); the others move into the new layout when its wallpapers.json vouches for them
 * (adopt()); the rest goes, with its thumbnails, wallpapers.json and chosen.json.
 */
async function adoptOld(): Promise<void> {
  const root = folder();
  if (!ownFolder(root) || !(await IOUtils.exists(root))) return;
  const cur = current();
  const was = JSON.stringify(old);
  if (cur?.old && (await exists(cur.path))) {
    if (!old || old.id !== cur.id || old.kind !== cur.kind) {
      let rec: Old | null = null;
      try {
        const j = await IOUtils.readJSON(PathUtils.join(root, 'chosen.json'));
        if (Array.isArray(j)) rec = j.map(readOld).find((r) => r && r.id === cur.id && r.kind === cur.kind) ?? null;
      } catch {
        rec = null;
      }
      old = rec ?? { id: cur.id, kind: cur.kind, title: 'Deer wallpaper', author: '', license: '', color: '#2b2a2e', sha256: '' };
    }
  } else old = null;
  const keep = cur?.old ? PathUtils.filename(cur.path).toLowerCase() : null;
  // The files that version's wallpapers.json vouches for become tiles of the new layout (read before
  // anything of it goes; a person's removal still holds).
  let adopted = 0;
  const records = await oldRecords();
  if (records.size) {
    for (const child of await children(root)) {
      const name = PathUtils.filename(child);
      const m = OLD_FILE.exec(name);
      if (!m || name.toLowerCase() === keep) continue;
      const kind: WallpaperKind = m[2] === 'mp4' ? 'video' : 'photo';
      const e = records.get(key(kind, m[1]));
      if (e && !items.has(key(kind, e.id)) && !removed[kind].has(e.id) && (await adopt(e, child))) adopted++;
    }
    // Their order, until a Get reads the index: the collection's as that version last saw it.
    if (adopted) for (const kind of KINDS) if (!order[kind].length) order[kind] = [...records.values()].filter((e) => e.kind === kind).map((e) => e.id);
  }
  if (adopted || JSON.stringify(old) !== was) await save(); // before wallpapers.json and chosen.json go
  for (const child of await children(root)) {
    const name = PathUtils.filename(child);
    if ((OLD_FILE.test(name) && name.toLowerCase() !== keep) || OLD_TEMP.test(name) || OLD_RECORDS.has(name)) await removeFile(child);
  }
  const thumbs = PathUtils.join(root, 'thumbs');
  if (!ownFolder(thumbs)) return;
  for (const child of await children(thumbs)) {
    const name = PathUtils.filename(child);
    if (THUMB.test(name) || THUMB_TEMP.test(name)) await removeFile(child);
  }
  try {
    await IOUtils.remove(thumbs); // only when nothing else is in it
  } catch {
    /* something that is not Deer's: it stays */
  }
}

/**
 * Files of a kind's folders no record vouches for go (a write cut short, a removal Home held up; the
 * current background's file stays), and records whose files have gone are dropped. Never while
 * that kind's Get writes.
 */
async function sweep(kind: WallpaperKind): Promise<void> {
  let dropped = false;
  for (const [k, e] of [...items]) {
    if (e.kind !== kind) continue;
    if ((await exists(filePath(e.id, kind))) && (await exists(thumbPath(e.id, kind)))) continue;
    items.delete(k);
    dropped = true;
  }
  const dir = kindDir(kind);
  if (ownFolder(dir)) {
    for (const child of await children(dir)) {
      const name = PathUtils.filename(child);
      const m = FILE[kind].exec(name);
      if ((m && !items.has(key(kind, m[1])) && !isShown(m[1], kind)) || FILE_TEMP[kind].test(name)) await removeFile(child);
    }
  }
  const tdir = thumbDir(kind);
  if (ownFolder(tdir)) {
    for (const child of await children(tdir)) {
      const name = PathUtils.filename(child);
      const m = THUMB.exec(name);
      if ((m && !items.has(key(kind, m[1]))) || THUMB_TEMP.test(name)) await removeFile(child);
    }
  }
  if (dropped) {
    await save();
    emit();
  }
}

/** The background moved: a file of Deer 0.1.5-0.1.8 that is no longer Home's background goes. */
async function backgroundChanged(): Promise<void> {
  emit();
  const cur = current();
  if (!old || (cur?.old && cur.id === old.id && cur.kind === old.kind)) return;
  const gone = old;
  old = null;
  await save();
  await removeSoon([oldPath(gone.id, gone.kind)]);
  emit();
}

/** The records and the files; leftovers go; then follow homeBackground. */
function ensureLoaded(): Promise<void> {
  loading ??= (async () => {
    try {
      await readState();
      await adoptOld();
      for (const kind of KINDS) await sweep(kind);
    } catch (e) {
      console.warn('Deer wallpapers: could not read the folder', e);
    }
    VitreSettings.onChange((_s, changed) => {
      if (changed.some((k) => k.startsWith('homeBackground'))) void backgroundChanged();
    });
    ready = true;
    emit();
  })();
  return loading;
}

// ---- network ----

function join(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * One file, piece by piece as it arrives: a 200 answer of at most `cap` bytes (more is refused while it
 * arrives), each piece within IDLE_MS, a small one whole within SMALL_DEADLINE_MS. `take` gets each
 * piece and the bytes so far (it may refuse the rest by throwing). Anonymous: see the header. Returns
 * the number of bytes received. Refused: the server answered, wrongly; anything else: the network.
 */
async function getStream(url: string, cap: number, accept: string, signal: AbortSignal, small: boolean, take: (piece: Uint8Array, n: number) => void | Promise<void>): Promise<number> {
  const ac = new AbortController();
  const stop = (): void => ac.abort();
  if (signal.aborted) throw new Refused('stopped');
  signal.addEventListener('abort', stop, { once: true });
  let idle = setTimeout(stop, IDLE_MS);
  const deadline = small ? setTimeout(stop, SMALL_DEADLINE_MS) : 0;
  let reader: any = null;
  try {
    const res = await fetch(url, { headers: { Accept: accept }, signal: ac.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (res.status !== 200) throw new Refused(`HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? NaN);
    // A compressed answer's Content-Length is not the length of the bytes read.
    const plain = !res.headers.get('content-encoding');
    if (Number.isFinite(length) && length > cap) throw new Refused(`${length} bytes, more than ${cap}`);
    if (!res.body) throw new Refused('no body');
    reader = res.body.getReader();
    let n = 0;
    for (;;) {
      const r: { done: boolean; value?: Uint8Array } = await reader.read();
      if (r.done || !r.value) break;
      clearTimeout(idle);
      idle = setTimeout(stop, IDLE_MS);
      n += r.value.byteLength;
      if (n > cap) throw new Refused(`more than ${cap} bytes`);
      await take(r.value, n);
    }
    // Over HTTP/1.x Necko ends a body the connection cut off before its Content-Length as if it were
    // whole (it does not enforce the framing): the network failed; this is not a wrong file.
    if (plain && Number.isFinite(length) && n < length) throw new Error(`the connection closed after ${n} of ${length} bytes`);
    return n;
  } finally {
    clearTimeout(idle);
    if (deadline) clearTimeout(deadline);
    signal.removeEventListener('abort', stop);
    ac.abort(); // whatever is left of the answer is not wanted
    try {
      reader?.cancel()?.catch?.(() => undefined);
    } catch {
      /* finished */
    }
  }
}

/** One file, read whole into memory (index.json, a thumbnail, a photo). */
async function getBytes(url: string, cap: number, accept: string, signal: AbortSignal, small: boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const n = await getStream(url, cap, accept, signal, small, (piece) => {
    chunks.push(piece);
  });
  return join(chunks, n);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Why these bytes are not the JPEG listed, or null when they are (`frame`: a photo's size; none: a thumbnail's limit). */
async function verify(bytes: Uint8Array, size: number, sha256: string, frame: { width: number; height: number } | null): Promise<string | null> {
  if (bytes.byteLength !== size) return `${bytes.byteLength} bytes, not the ${size} listed`;
  const jpeg = jpegSize(bytes);
  if (!jpeg) return 'not a JPEG';
  if (frame ? jpeg.width !== frame.width || jpeg.height !== frame.height : jpeg.width > MAX_THUMB_SIDE || jpeg.height > MAX_THUMB_SIDE) return `${jpeg.width}x${jpeg.height}, not the size listed`;
  if (hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) !== sha256) return 'its SHA-256 is not the one listed';
  return null;
}

async function fetchIndex(b: string, signal: AbortSignal): Promise<Index> {
  const bytes = await getBytes(b + 'index.json', MAX_INDEX, 'application/json', signal, true);
  let json: unknown = null;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    json = null;
  }
  const idx = checkIndex(json);
  if (!idx) throw new Refused('index.json is not a version 2 index');
  if (idx.skipped.length) console.warn(`Deer wallpapers: ${idx.skipped.length} entries of index.json skipped: ${idx.skipped.slice(0, 20).join('; ')}`);
  return idx;
}

/**
 * A video (up to 100 MiB), never whole in memory: written to <id>.mp4.part a step at a time as it
 * arrives and hashed on the way, refused as soon as it does not start as an MP4 video does (its 'ftyp'
 * box, read whole before the first byte is written) or runs past its size, renamed to <id>.mp4 once its
 * size and SHA-256 are the ones listed. A failure removes the temporary file and is thrown.
 */
async function saveVideo(b: string, e: WallpaperEntry, signal: AbortSignal): Promise<void> {
  const path = filePath(e.id, 'video');
  const part = path + '.part';
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  /** The file's first bytes (at most MAX_FTYP), until mp4Start() can tell. */
  let head: Uint8Array = new Uint8Array(0);
  let mp4: boolean | null = null;
  let queued: Uint8Array[] = [];
  let queuedBytes = 0;
  let written = 0;
  const flush = async (): Promise<void> => {
    if (!queuedBytes) return;
    if (mp4 !== true) throw new Refused('not an MP4 video'); // nothing reaches the disk before the box is judged
    const step = join(queued, queuedBytes);
    queued = [];
    queuedBytes = 0;
    await IOUtils.write(part, step, { mode: written ? 'append' : 'overwrite' });
    written += step.byteLength;
  };
  try {
    await makeFolder(kindDir('video'));
    if (!(await clearPath(part))) throw new Error(`${part} cannot be cleared`);
    const n = await getStream(b + fileOf(e.id, 'video'), e.bytes, 'video/mp4', signal, false, async (piece) => {
      if (mp4 === null) {
        const more = piece.subarray(0, MAX_FTYP - head.byteLength);
        head = join([head, more], head.byteLength + more.byteLength);
        mp4 = mp4Start(head, e.bytes);
        if (mp4 === false) throw new Refused('not an MP4 video');
      }
      hash.update(piece, piece.byteLength);
      queued.push(piece);
      queuedBytes += piece.byteLength;
      if (queuedBytes >= WRITE_STEP) await flush();
    });
    await flush();
    if (n !== e.bytes) throw new Refused(`${n} bytes, not the ${e.bytes} listed`);
    if (mp4 !== true) throw new Refused('not an MP4 video');
    const raw: string = hash.finish(false);
    if (hexOf(raw) !== e.sha256) throw new Refused('its SHA-256 is not the one listed');
    await IOUtils.move(part, path);
  } catch (err) {
    await removeFile(part);
    throw err;
  }
}

/** Home's background: a photo as an 'image', a video as a 'video' (its colour first, for Home's first paint). */
function apply(path: string, kind: WallpaperKind, color: string | undefined): void {
  const bg = { kind: kind === 'video' ? ('video' as const) : ('image' as const), path };
  if (kind === 'video' && color) VitreHome.setBaseColor(bg, color);
  VitreSettings.set({ homeBackground: bg });
}

/**
 * One item: its thumbnail, then its file, each checked before it is written; then its record. True
 * once it is here; false when the person removed it meanwhile (nothing is kept). Thrown: why not.
 */
async function fetchItem(b: string, e: WallpaperEntry, signal: AbortSignal): Promise<boolean> {
  const { id, kind } = e;
  const thumb = await getBytes(b + thumbOf(id, kind), e.thumbBytes, 'image/jpeg', signal, true);
  const bad = await verify(thumb, e.thumbBytes, e.thumbSha256, null);
  if (bad) throw new Refused(`its thumbnail: ${bad}`);
  if (kind === 'video') await saveVideo(b, e, signal);
  else {
    const bytes = await getBytes(b + fileOf(id, kind), e.bytes, 'image/jpeg', signal, false);
    const wrong = await verify(bytes, e.bytes, e.sha256, e);
    if (wrong) throw new Refused(wrong);
    await writeFile(filePath(id, kind), bytes);
  }
  // Every byte is in and checked: kept, even when the Get was stopped meanwhile (not when removed).
  if (removed[kind].has(id)) {
    await removeFile(filePath(id, kind));
    return false;
  }
  await writeFile(thumbPath(id, kind), thumb);
  items.set(key(kind, id), e);
  await save();
  // A file of Deer 0.1.5-0.1.8 that is Home's background, the same bytes: Home moves to this copy
  // (backgroundChanged() then removes the old one).
  const cur = current();
  if (old && cur?.old && cur.id === id && cur.kind === kind && old.id === id && old.kind === kind && old.sha256 === e.sha256) apply(filePath(id, kind), kind, e.color);
  return true;
}

/** Copies of `kind` the index no longer lists (or retires) go, but the one Home shows. */
async function prune(kind: WallpaperKind, idx: Index): Promise<void> {
  const gone = [...items.values()].filter((e) => e.kind === kind && !idx.listed[kind].has(e.id) && !isShown(e.id, kind));
  if (!gone.length) return;
  for (const e of gone) items.delete(key(kind, e.id));
  await save();
  emit();
  for (const e of gone) await removeSoon([filePath(e.id, kind), thumbPath(e.id, kind)]);
}

/** The same file and thumbnail as listed. */
const same = (a: WallpaperEntry, e: WallpaperEntry): boolean => a.sha256 === e.sha256 && a.bytes === e.bytes && a.thumbSha256 === e.thumbSha256 && a.thumbBytes === e.thumbBytes;

async function runGet(kind: WallpaperKind, run: Run): Promise<GetResult> {
  const signal = run.ac.signal;
  try {
    await ensureLoaded();
    if (signal.aborted) return 'stopped';
    const b = baseURL();
    const idx = await fetchIndex(b, signal);
    if (signal.aborted) return 'stopped';
    order[kind] = idx.entries[kind].map((e) => e.id);
    await prune(kind, idx);
    await sweep(kind);
    const want = idx.entries[kind].filter((e) => {
      const have = items.get(key(kind, e.id));
      // Removed by the person; here already; or Home shows the copy here (not replaced under it).
      return !removed[kind].has(e.id) && !(have && (same(have, e) || isShown(e.id, kind)));
    });
    run.of = want.length;
    emit();
    let added = 0;
    let failed = false;
    for (const [i, e] of want.entries()) {
      if (signal.aborted) break;
      run.at = i + 1;
      emit();
      try {
        if (await fetchItem(b, e, signal)) added++;
        emit();
      } catch (err) {
        if (signal.aborted) break;
        failed = true;
        console.warn(`Deer wallpapers: ${e.id} was not downloaded: ${why(err)}`);
        if (!(err instanceof Refused)) break; // the network went: the rest would wait for it too
      }
    }
    if (signal.aborted) return 'stopped';
    complete[kind] = failed ? '' : b;
    outcome[kind] = { kind: failed ? 'failed' : added ? 'added' : 'nothing-new', added };
    await save();
    return failed ? 'failed' : 'done';
  } catch (err) {
    if (signal.aborted) return 'stopped';
    console.warn(`Deer wallpapers: could not get the ${kind === 'video' ? 'live wallpapers' : 'wallpapers'}: ${why(err)}`);
    outcome[kind] = { kind: 'failed', added: 0 };
    return 'failed';
  }
}

/** No picker has shown this kind's tab for a second: its Get stops and its line is forgotten. */
function leave(kind: WallpaperKind): void {
  stopTimers[kind] = 0;
  if (watchers[kind]) return;
  runs[kind]?.ac.abort();
  if (outcome[kind]) {
    outcome[kind] = null;
    emit();
  }
}

function getState(kind: WallpaperKind): GetState {
  const r = runs[kind];
  const o = outcome[kind];
  return { running: !!r, at: r?.at ?? 0, of: r?.of ?? 0, outcome: r ? null : (o?.kind ?? null), added: r ? 0 : (o?.added ?? 0), complete: !!complete[kind] && complete[kind] === baseURL() };
}

const isKind = (kind: unknown): kind is WallpaperKind => kind === 'photo' || kind === 'video';

export const VitreWallpapers = {
  BASE,
  CREDITS,

  folder,
  isDeerPath,

  watch(kind: WallpaperKind): () => void {
    if (!isKind(kind)) return () => undefined;
    watchers[kind]++;
    if (stopTimers[kind]) {
      clearTimeout(stopTimers[kind]);
      stopTimers[kind] = 0;
    }
    void ensureLoaded();
    let on = true;
    return () => {
      if (!on) return;
      on = false;
      watchers[kind] = Math.max(0, watchers[kind] - 1);
      if (!watchers[kind] && !stopTimers[kind]) stopTimers[kind] = setTimeout(() => leave(kind), STOP_DELAY_MS);
    };
  },

  state(): WallpaperState {
    const tiles: WallpaperTile[] = [];
    for (const kind of KINDS) {
      const rank = new Map(order[kind].map((id, i) => [id, i]));
      // In the order of the last index; one it no longer lists (Home's background) first.
      const mine = [...items.values()].filter((e) => e.kind === kind).sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
      for (const e of mine) tiles.push({ id: e.id, kind, title: e.title, author: e.author, license: e.license, color: e.color, path: filePath(e.id, kind), thumb: thumbPath(e.id, kind) });
    }
    // Home's background, a file of Deer 0.1.5-0.1.8: its own tile, first in its group.
    const cur = current();
    if (cur?.old && old && old.id === cur.id && old.kind === cur.kind) {
      tiles.unshift({ id: old.id, kind: old.kind, title: old.title, author: old.author, license: old.license, color: old.color, path: cur.path, thumb: '' });
    }
    return { tiles, get: { photo: getState('photo'), video: getState('video') }, ready };
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  get(kind: WallpaperKind): Promise<GetResult> {
    if (!isKind(kind)) return Promise.resolve('failed');
    if (runs[kind]) return Promise.resolve('busy');
    const run: Run = { ac: new AbortController(), at: 0, of: 0 };
    runs[kind] = run;
    outcome[kind] = null;
    emit();
    return runGet(kind, run).finally(() => {
      if (runs[kind] === run) runs[kind] = null;
      emit();
    });
  },

  stop(kind: WallpaperKind): void {
    if (isKind(kind)) runs[kind]?.ac.abort();
  },

  async choose(id: string, kind: WallpaperKind): Promise<'applied' | 'failed'> {
    if (!isKind(kind) || typeof id !== 'string') return 'failed';
    await ensureLoaded();
    const e = items.get(key(kind, id));
    const cur = current();
    const legacy = !e && old && old.id === id && old.kind === kind && cur?.old && cur.id === id && cur.kind === kind ? old : null;
    const path = e ? filePath(id, kind) : legacy ? cur!.path : null;
    if (!path || !(await exists(path))) {
      // Its file has gone: its record goes (its thumbnail at the next sweep). Never a sweep here: a Get
      // of this kind may be writing its folder.
      if (e && items.get(key(kind, id)) === e) {
        items.delete(key(kind, id));
        await save();
        emit();
      }
      return 'failed';
    }
    apply(path, kind, e?.color ?? legacy?.color);
    return 'applied';
  },

  async remove(id: string, kind: WallpaperKind): Promise<boolean> {
    if (!isKind(kind) || typeof id !== 'string' || !ID_RE.test(id)) return false;
    await ensureLoaded();
    const had = items.get(key(kind, id));
    const cur = current();
    const shown = !!cur && cur.id === id && cur.kind === kind;
    if (!had && !(shown && cur!.old)) return false;
    const paths = had ? [filePath(id, kind), thumbPath(id, kind)] : [];
    if (shown) {
      paths.push(cur!.path);
      // Home goes back to its default background, as on a first start (one change: both are
      // reported together).
      VitreSettings.reset('homeBackground.kind');
      VitreSettings.reset('homeBackground.path');
    }
    items.delete(key(kind, id));
    removed[kind].add(id);
    if (old && old.id === id && old.kind === kind) old = null;
    await save();
    emit();
    await removeSoon([...new Set(paths)]);
    return true;
  },

  /** For tests and diagnostics. */
  debug(): { base: string; ready: boolean; running: Record<WallpaperKind, boolean>; watchers: Record<WallpaperKind, number>; items: string[]; removed: Record<WallpaperKind, string[]>; complete: Record<WallpaperKind, string>; old: Old | null } {
    return {
      base: baseURL(),
      ready,
      running: { photo: !!runs.photo, video: !!runs.video },
      watchers: { ...watchers },
      items: [...items.keys()].sort(),
      removed: { photo: [...removed.photo].sort(), video: [...removed.video].sort() },
      complete: { ...complete },
      old: old && { ...old },
    };
  },
};
