// Deer wallpapers: the collection the owner hosts on GitHub Pages (droidboy08-hub/deer-wallpapers),
// offered as one more group, "Deer wallpapers", in the background picker's Photo tab (its photos) and
// in its Video tab (its videos, the live wallpapers: owner's decision 2026-10-17); the picker is in
// Settings › Home and background and Home's Background popover, src/window/modules/settings/bg-picker.ts.
// Choosing a tile downloads that file once into the profile and makes it Home's background: an
// ordinary 'image' or 'video' background whose path is the profile copy, so Home (VitreHome) shows it
// as any other photo, or plays it as any other video (muted, looping, however long it is). Nothing
// changes by itself: no rotation, no picture of the day. A process singleton (window code:
// b.sys('VitreWallpapers')).
//
// What is contacted, and when (nothing else, and never while no picker shows its Photo or Video tab):
//   GET <base>wallpapers.json   when a picker's Photo or Video tab comes on screen, at most once per 10
//                               minutes per session (counted when it is sent; once sent it runs to its
//                               end, at most 1 MiB within a minute, even when the tab goes meanwhile, so
//                               its answer is not thrown away for another request)
//   GET <base>thumbs/<id>.jpg   the thumbnails of the entries listed (a video's is its poster frame), 3 at
//                               a time, while such a tab is on screen; each is kept in the profile and
//                               fetched again only when the manifest lists another one under that id
//   GET <base>full/<id>.jpg     a photo, or full/<id>.mp4, a video, only when the person chooses its tile
//                               (it goes on when the picker closes: the person asked for it)
// <base> is BASE, or the hidden pref vitre.wallpapers.base when it is an https:// address or
// http://127.0.0.1 / http://localhost (the tests' stand-in; tools/run.py points it at a port nothing
// listens on, so no test reaches GitHub). Every request is fetch() with credentials 'omit' (Necko's
// LOAD_ANONYMOUS: no cookie sent, none stored), no referrer, cache 'no-store' (nothing taken from or
// kept in the HTTP cache), redirect 'error' (an address that redirects anywhere fails), no query string;
// the browser's own headers otherwise. Offline, a refusal or a bad answer shows what is cached, with no
// message; nothing cached means no group.
//
// Nothing from the server is trusted (the rules are in wallpapers/manifest.ts):
//   - wallpapers.json is read up to 1 MiB and must be {"version": 1, "wallpapers": [...]}; at most 500
//     entries are looked at, each on its own (a bad one is skipped and named in a console warning,
//     never the whole list): id, kind (none or "photo", or "video"; any other is skipped), file exactly
//     full/<id>.jpg (a photo) or full/<id>.mp4 (a video), thumb exactly thumbs/<id>.jpg, sizes (a
//     video up to 100 MiB and 3840 px a side, with a duration), SHA-256s, colour, width and height,
//     short strings without control or bidi characters.
//   - every file is read with its declared size as a hard limit. A photo or a thumbnail is read whole,
//     and before a byte is written it must be exactly that size, hash to the SHA-256 listed, start with
//     a JPEG's FF D8 FF and have a frame of the width and height listed (a thumbnail at most 2048 px a
//     side); it is then written under a temporary name and renamed (IOUtils.write tmpPath). A video is
//     never held whole in memory: it is written to <id>.mp4.part as it arrives, hashed on the way, and
//     refused as soon as it does not start as an MP4 video does (its whole 'ftyp' box, read before a
//     byte is written, naming an MP4 brand and no picture's: AVIF and HEIC have that box too) or runs
//     past its size; it is renamed to <id>.mp4 only once its size and SHA-256 are the ones listed. A
//     failure leaves nothing behind.
//   - a wallpaper is an id AND a kind: the collection may list an id as a photo today and as a video
//     tomorrow. Choices, downloads, failures and the records of chosen files are kept per id and kind,
//     so a tile only ever gets (and applies) its own kind's file, and the other kind's copy is kept.
//
// Files, only ever in <profile>\deer-wallpapers (nothing outside it is written or removed):
//   wallpapers.json   the last good manifest as checked, with the base it came from (a manifest from
//                     another base is not shown)
//   thumbs\<id>.jpg   thumbnails; those the manifest no longer lists (or lists with another hash) go
//                     whenever a manifest arrives
//   <id>.jpg          photos chosen, <id>.mp4 videos chosen; kept: the current background's, the 5
//                     photos and the 2 videos chosen most recently, the others removed after each choice
//   chosen.json       those files, newest choice first: id, kind, SHA-256, size, title, credit, colour,
//                     one record per id and kind (a file taken out of the collection keeps working, and
//                     its tile stays in the group while it is Home's background)
// Removal is of regular files named as above, in those two folders, and only when the folder is not a
// link elsewhere. Temporary files a write cut short (Deer killed, a crash: <id>.jpg.part or
// <id>.mp4.part, thumbs\<id>.jpg.part, wallpapers.json.tmp, chosen.json.tmp) are removed when the folder
// is first read in a session.
//
// Contract:
//   watch()                a picker's Photo or Video tab came on screen; returns the call for when it
//                          goes. While any is on screen: the manifest when due, then the missing
//                          thumbnails (of both kinds). A second after the last one goes, the thumbnails
//                          under way stop (a manifest request sent runs to its end) and a failure is
//                          forgotten.
//   state() / onChange(fn) the groups to show (WallpaperState: every tile carries its kind, as do the
//                          download and the failure; `pending` while the collection may still change by
//                          itself); fn() on every change; returns the remover
//   choose(id, kind)       download (once) and set as Home's background; 'applied' | 'failed' |
//                          'superseded'. Choosing the tile that is downloading again joins it. A kind
//                          the collection does not list under that id is the copy in the profile, if any.
//   supersede()            the person chose something else: a download under way is cancelled and never
//                          applied. Also done for any other change of homeBackground (another window,
//                          about:config).
//   isDeerPath(path)       a file of this folder (the picker keeps it out of the recent photos and videos)
//   folder()               <profile>\deer-wallpapers
// A video chosen also gives VitreHome its entry's colour (setBaseColor): a Home page loading it paints
// that colour until the first frame is in. Tests: the pref above; now() can be replaced (the 10-minute
// rule); debug() tells what is going on.
//
// Firefox internals (157): fetch() in the shared system global (as VitreUpdater uses it);
// RequestCredentials 'omit' -> nsIRequest::LOAD_ANONYMOUS (dom/fetch/FetchDriver.cpp); IOUtils
// (write with tmpPath or mode 'append', move, getChildren, stat, remove); nsICryptoHash (update() takes
// a Uint8Array: XPConnect copies a typed array of octets as it is; 8 MiB in about 12 ms);
// nsIFile.isSymlink (true for a junction on Windows).
import { VitreHome } from 'chrome://vitre/content/modules/VitreHome.sys.mjs';
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { checkEntry, checkManifest, EXT, ID_RE, jpegSize, MAX_FTYP, MAX_MANIFEST, MAX_THUMB_SIDE, mp4Start, toManifest, type WallpaperEntry, type WallpaperKind } from './wallpapers/manifest';

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
  /** '' for a file no longer listed whose credit was never recorded. */
  author: string;
  license: string;
  /** '#rrggbb': the face until the thumbnail is in. */
  color: string;
  /** The file's place in the profile (<id>.jpg, <id>.mp4): Home's background once chosen (it may not be there yet). */
  path: string;
  /** The checked thumbnail in the profile, or '' (not fetched yet, or refused). */
  thumb: string;
  /** The file is in the profile already: choosing it needs no download. */
  local: boolean;
  /** False: the current background, taken out of the collection since it was chosen. */
  listed: boolean;
}

/** A wallpaper as chosen: the same id may be a photo in one collection and a video in another. */
export interface WallpaperRef {
  id: string;
  kind: WallpaperKind;
}

export interface WallpaperState {
  tiles: WallpaperTile[];
  /** The person's choice being downloaded. */
  downloading: (WallpaperRef & { received: number; total: number }) | null;
  /** The last choice that could not be downloaded or checked (its tile says so). */
  failed: WallpaperRef | null;
  /**
   * The tiles may still change by themselves: the folder not read yet, or the manifest being asked
   * for (a picker holds its "no video" note meanwhile, rather than show it and take it back).
   */
  pending: boolean;
}

export type ChooseResult = 'applied' | 'failed' | 'superseded';

interface Chosen {
  id: string;
  /** A record Deer 0.1.5 wrote has none: a photo. */
  kind: WallpaperKind;
  sha256: string;
  bytes: number;
  title: string;
  author: string;
  license: string;
  color: string;
  /** When it was last chosen (ms). */
  at: number;
}

interface Download {
  id: string;
  /** The tile's kind: only that kind's file is downloaded and applied. */
  kind: WallpaperKind;
  ac: AbortController;
  received: number;
  total: number;
  done: Promise<ChooseResult>;
}

export const BASE = 'https://droidboy08-hub.github.io/deer-wallpapers/';
const BASE_PREF = 'vitre.wallpapers.base';
const DIR = 'deer-wallpapers';
const CACHE = 'wallpapers.json';
const CHOSEN = 'chosen.json';
const REFRESH_MS = 10 * 60 * 1000;
const THUMBS_AT_ONCE = 3;
/** Files kept besides the current background's: the photos and the videos chosen most recently. */
const KEEP: Record<WallpaperKind, number> = { photo: 5, video: 2 };
/** No byte for this long: the request is given up. */
const IDLE_MS = 30_000;
/** The manifest and a thumbnail, whole, within this. */
const SMALL_DEADLINE_MS = 60_000;
/** The last picker gone this long: what is under way stops (a re-render builds a new picker at once). */
const STOP_DELAY_MS = 1000;
/** A video goes to its temporary file this much at a time. */
const WRITE_STEP = 1024 * 1024;
/** Chosen files in the folder, and what a write cut short leaves of them. */
const FILE = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.(jpg|mp4)$/;
const FILE_TEMP = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.(jpg|mp4)\.part$/;
/** Thumbnails in thumbs\ (JPEG only, of either kind). */
const THUMB = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.jpg$/;
const THUMB_TEMP = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.jpg\.part$/;

const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
/** The manifest shown: from the network this session, or the cached copy. */
let manifest: { base: string; entries: WallpaperEntry[]; network: boolean } | null = null;
/** base -> when its manifest was last asked for (when the request was sent). */
const asked = new Map<string, number>();
/** The manifest request under way (it is never stopped: see the header). */
let manifestAc: AbortController | null = null;
/** Thumbnails in the profile: id -> size (checked against the manifest's entry when written). */
const thumbs = new Map<string, number>();
const thumbRunning = new Map<string, AbortController>();
/** Thumbnails refused or unreachable since the last manifest: not asked again until the next one. */
const thumbFailed = new Set<string>();
/** Chosen files in the profile, by name (<id>.jpg, <id>.mp4). */
const files = new Set<string>();
let chosen: Chosen[] = [];
let download: Download | null = null;
let failed: WallpaperRef | null = null;
/** start() runs under way (reading the folder, the manifest when due): see WallpaperState.pending. */
let starting = 0;
let watchers = 0;
let stopTimer = 0;
let emitTimer = 0;

class Refused extends Error {}

function emit(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = 0;
  }
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('Deer wallpapers: listener failed', e);
    }
  }
}

/** For download progress: at most ten times a second. */
function emitSoon(): void {
  if (!emitTimer) emitTimer = setTimeout(emit, 100);
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

const thumbsFolder = (): string => PathUtils.join(folder(), 'thumbs');
const fileName = (id: string, kind: WallpaperKind): string => `${id}.${EXT[kind]}`;
const filePath = (id: string, kind: WallpaperKind): string => PathUtils.join(folder(), fileName(id, kind));
const thumbPath = (id: string): string => PathUtils.join(thumbsFolder(), `${id}.jpg`);

function isDeerPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  const dir = folder().toLowerCase() + '\\';
  const p = path.replace(/\//g, '\\').toLowerCase();
  return p.startsWith(dir) && FILE.test(p.slice(dir.length));
}

/**
 * The current background when it is one of these files: a photo as an 'image' background, a video as
 * a 'video' one (a file shown as the other kind is not one Deer set).
 */
function current(): { id: string; kind: WallpaperKind } | null {
  try {
    const bg = VitreSettings.get().homeBackground;
    if ((bg.kind !== 'image' && bg.kind !== 'video') || !isDeerPath(bg.path)) return null;
    const m = FILE.exec(PathUtils.filename(bg.path).toLowerCase());
    const kind: WallpaperKind = m?.[2] === 'mp4' ? 'video' : 'photo';
    return m && (kind === 'video') === (bg.kind === 'video') ? { id: m[1], kind } : null;
  } catch {
    return null;
  }
}

// ---- files ----

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

/** A folder of its own, not a link (junction) to somewhere else: only then is anything removed in it. */
function realFolder(path: string): boolean {
  try {
    const f = localFile(path);
    return f.exists() && f.isDirectory() && !f.isSymlink();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await IOUtils.stat(path)).type === 'regular';
  } catch {
    return false;
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    if ((await IOUtils.stat(path)).type === 'regular') await IOUtils.remove(path);
  } catch {
    /* gone already, or in use: the next prune */
  }
}

async function children(dir: string): Promise<string[]> {
  try {
    return await IOUtils.getChildren(dir);
  } catch {
    return [];
  }
}

/** Write checked bytes under a temporary name, then rename; nothing is left when it fails. */
async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await IOUtils.makeDirectory(thumbsFolder(), { createAncestors: true, ignoreExisting: true });
  try {
    await IOUtils.write(path, bytes, { tmpPath: path + '.part' });
  } catch (e) {
    await removeFile(path + '.part');
    throw e;
  }
}

async function writeJSON(name: string, value: unknown): Promise<void> {
  try {
    await IOUtils.makeDirectory(folder(), { createAncestors: true, ignoreExisting: true });
    const path = PathUtils.join(folder(), name);
    await IOUtils.writeJSON(path, value, { tmpPath: path + '.tmp' });
  } catch (e) {
    console.warn(`Deer wallpapers: could not write ${name}`, e);
  }
}

/** What is in the profile now: chosen files by name, thumbnails by id (swapped in whole, never half-read). */
async function scan(): Promise<void> {
  const found = new Set<string>();
  const sizes = new Map<string, number>();
  for (const child of await children(folder())) {
    const name = PathUtils.filename(child);
    if (FILE.test(name) && (await exists(child))) found.add(name);
  }
  for (const child of await children(thumbsFolder())) {
    const m = THUMB.exec(PathUtils.filename(child));
    if (!m) continue;
    try {
      const st = await IOUtils.stat(child);
      if (st.type === 'regular') sizes.set(m[1], Number(st.size));
    } catch {
      /* gone meanwhile */
    }
  }
  files.clear();
  for (const name of found) files.add(name);
  thumbs.clear();
  for (const [id, size] of sizes) thumbs.set(id, size);
}

/** Thumbnails `keep` does not vouch for go, with temporary files no fetch is writing. */
async function pruneThumbs(keep: (id: string) => boolean): Promise<void> {
  const dir = thumbsFolder();
  if (!realFolder(dir)) return;
  for (const child of await children(dir)) {
    const name = PathUtils.filename(child);
    const m = THUMB.exec(name);
    const temp = THUMB_TEMP.exec(name);
    if (m && keep(m[1])) continue;
    if (temp && thumbRunning.has(temp[1])) continue;
    if (m || temp) {
      await removeFile(child);
      if (m) thumbs.delete(m[1]);
    }
  }
}

/** The files that stay: the current background's, the 5 photos and the 2 videos chosen most recently, one downloading. */
function keptFiles(): Set<string> {
  const keep = new Set<string>();
  for (const kind of ['photo', 'video'] as const) for (const c of chosen.filter((x) => x.kind === kind).slice(0, KEEP[kind])) keep.add(fileName(c.id, kind));
  const cur = current();
  if (cur) keep.add(fileName(cur.id, cur.kind));
  if (download) keep.add(fileName(download.id, download.kind));
  return keep;
}

/** The temporary file the download under way may be writing (a video's, as it arrives). */
const writing = (): string | null => (download ? fileName(download.id, download.kind) + '.part' : null);

let pruning: Promise<void> = Promise.resolve();

/** Files not kept go; one prune at a time, each file judged when it is reached (a choice may land meanwhile). */
function pruneFiles(): Promise<void> {
  const run = async (): Promise<void> => {
    const dir = folder();
    if (!realFolder(dir)) return;
    let removed = false;
    for (const child of await children(dir)) {
      const name = PathUtils.filename(child);
      if (FILE.test(name) && !keptFiles().has(name)) {
        await removeFile(child);
        removed = files.delete(name) || removed;
      } else if (FILE_TEMP.test(name) && name !== writing()) {
        await removeFile(child); // left by a write that never finished
      }
    }
    const keep = keptFiles();
    const before = chosen.length;
    chosen = chosen.filter((c) => keep.has(fileName(c.id, c.kind)));
    if (chosen.length !== before) await writeJSON(CHOSEN, chosen);
    if (removed) emit(); // those tiles need a download again
  };
  pruning = pruning.then(run, run);
  return pruning;
}

function readChosen(j: unknown): Chosen[] {
  if (!Array.isArray(j)) return [];
  const out: Chosen[] = [];
  for (const c of j) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_RE.test(c.id)) continue;
    // The credit is shown again: it gets the manifest's own checks (a record without a kind is a photo).
    const kind: WallpaperKind | null = c.kind === undefined || c.kind === 'photo' ? 'photo' : c.kind === 'video' ? 'video' : null;
    if (!kind || out.some((x) => x.id === c.id && x.kind === kind)) continue; // one record per id and kind
    const e = checkEntry({ ...c, kind, file: `full/${fileName(c.id, kind)}`, thumb: `thumbs/${c.id}.jpg`, width: 16, height: 16, duration: 1, thumbBytes: 4, thumbSha256: c.sha256, added: undefined });
    if (typeof e === 'string') continue;
    out.push({ id: e.id, kind: e.kind, sha256: e.sha256, bytes: e.bytes, title: e.title, author: e.author, license: e.license, color: e.color, at: Number(c.at) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Temporary files a write cut short left behind (Deer killed, a crash, power lost: IOUtils leaves its
 * temporary file then, a video its .part). Run once, first, before anything of this session can be writing.
 */
async function removeLeftovers(): Promise<void> {
  if (!realFolder(folder())) return;
  for (const child of await children(folder())) {
    const name = PathUtils.filename(child);
    if (FILE_TEMP.test(name) || name === `${CACHE}.tmp` || name === `${CHOSEN}.tmp`) await removeFile(child);
  }
  if (!realFolder(thumbsFolder())) return;
  for (const child of await children(thumbsFolder())) if (THUMB_TEMP.test(PathUtils.filename(child))) await removeFile(child);
}

/** Leftovers go; the cached manifest, the records of chosen files, the files; then follow homeBackground. */
function ensureLoaded(): Promise<void> {
  loading ??= (async () => {
    await removeLeftovers();
    try {
      const j = await IOUtils.readJSON(PathUtils.join(folder(), CACHE));
      const list = j && typeof j.base === 'string' ? checkManifest({ version: 1, wallpapers: j.wallpapers }) : null;
      if (list && !manifest) manifest = { base: j.base, entries: list.entries, network: false };
    } catch {
      /* no cache yet */
    }
    try {
      chosen = readChosen(await IOUtils.readJSON(PathUtils.join(folder(), CHOSEN)));
    } catch {
      chosen = [];
    }
    await scan();
    VitreSettings.onChange((_s, changed) => {
      if (!changed.some((k) => k.startsWith('homeBackground'))) return;
      // A background chosen anywhere else wins over a download under way.
      if (download) VitreWallpapers.supersede();
      emit(); // a file no longer listed is shown only while it is the background
    });
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
 * the number of bytes received.
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

/** One file, read whole into memory (the manifest, a thumbnail, a photo). */
async function getBytes(url: string, cap: number, accept: string, signal: AbortSignal, small: boolean, progress?: (n: number) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const n = await getStream(url, cap, accept, signal, small, (piece, total) => {
    chunks.push(piece);
    progress?.(total);
  });
  return join(chunks, n);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Why these bytes are not the file listed, or null when they are. */
async function verify(bytes: Uint8Array, size: number, sha256: string, frame: { width: number; height: number } | null): Promise<string | null> {
  if (bytes.byteLength !== size) return `${bytes.byteLength} bytes, not the ${size} listed`;
  const jpeg = jpegSize(bytes);
  if (!jpeg) return 'not a JPEG';
  if (frame ? jpeg.width !== frame.width || jpeg.height !== frame.height : jpeg.width > MAX_THUMB_SIDE || jpeg.height > MAX_THUMB_SIDE) return `${jpeg.width}x${jpeg.height}, not the size listed`;
  if (hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) !== sha256) return 'its SHA-256 is not the one listed';
  return null;
}

/** The manifest, when it is due (see the header). */
async function refresh(): Promise<void> {
  const b = baseURL();
  if (manifestAc) return;
  const last = asked.get(b);
  if (last !== undefined && VitreWallpapers.now() - last < REFRESH_MS) return;
  const ac = new AbortController();
  manifestAc = ac;
  // Counted now, whatever comes of it: a picker closed and opened again before the answer does not
  // ask again (the request runs to its end; stop() leaves it be).
  asked.set(b, VitreWallpapers.now());
  emit();
  try {
    const bytes = await getBytes(b + 'wallpapers.json', MAX_MANIFEST, 'application/json', ac.signal, true);
    let json: unknown = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      json = null;
    }
    const list = checkManifest(json);
    if (!list) {
      console.warn('Deer wallpapers: wallpapers.json is not a version 1 list; the last good copy stays');
      return;
    }
    if (list.skipped.length) console.warn(`Deer wallpapers: ${list.skipped.length} entries of wallpapers.json skipped: ${list.skipped.slice(0, 20).join('; ')}`);
    await adopt(b, list.entries);
  } catch {
    // Offline, refused, too big, too slow: what is cached is shown, and nothing is said.
  } finally {
    if (manifestAc === ac) manifestAc = null;
    emit();
  }
}

/** A good manifest from the network: thumbnails it no longer vouches for go, then it is cached. */
async function adopt(b: string, entries: WallpaperEntry[]): Promise<void> {
  const before = manifest && manifest.base === b ? new Map(manifest.entries.map((e) => [e.id, e])) : null;
  const next = new Map(entries.map((e) => [e.id, e]));
  // A thumbnail stays only for the entry it was checked against (another base: none can be vouched
  // for). Done before the new list is taken, so no thumbnail of it is fetched while this runs.
  await pruneThumbs((id) => {
    const was = before?.get(id);
    const now = next.get(id);
    return !!was && !!now && was.thumbSha256 === now.thumbSha256 && was.thumbBytes === now.thumbBytes;
  });
  manifest = { base: b, entries, network: true };
  thumbFailed.clear();
  // In the manifest's own format: it is checked again, as the site's, when it is read back.
  await writeJSON(CACHE, { version: 1, base: b, savedAt: new Date().toISOString(), wallpapers: entries.map(toManifest) });
}

function pumpThumbs(): void {
  const b = baseURL();
  if (!watchers || !manifest || manifest.base !== b || !manifest.network) return;
  for (const e of manifest.entries) {
    if (thumbRunning.size >= THUMBS_AT_ONCE) return;
    if (thumbs.get(e.id) === e.thumbBytes || thumbFailed.has(e.id) || thumbRunning.has(e.id)) continue;
    void fetchThumb(b, e);
  }
}

async function fetchThumb(b: string, e: WallpaperEntry): Promise<void> {
  const ac = new AbortController();
  thumbRunning.set(e.id, ac);
  try {
    const bytes = await getBytes(`${b}thumbs/${e.id}.jpg`, e.thumbBytes, 'image/jpeg', ac.signal, true);
    const why = await verify(bytes, e.thumbBytes, e.thumbSha256, null);
    if (why) {
      thumbFailed.add(e.id);
      console.warn(`Deer wallpapers: the thumbnail of ${e.id} was refused: ${why}`);
      return;
    }
    const still = manifest?.base === b && manifest.entries.some((x) => x.id === e.id && x.thumbSha256 === e.thumbSha256);
    if (ac.signal.aborted || !still) return;
    await writeFile(thumbPath(e.id), bytes);
    thumbs.set(e.id, e.thumbBytes);
    emit();
  } catch {
    if (!ac.signal.aborted) thumbFailed.add(e.id);
  } finally {
    thumbRunning.delete(e.id);
    pumpThumbs();
  }
}

async function start(first: boolean): Promise<void> {
  starting++; // counted at once: the picker that called watch() renders before anything is read
  try {
    await ensureLoaded();
    if (!watchers) return;
    if (first) {
      await scan();
      emit();
    }
    await refresh();
    pumpThumbs();
  } catch (e) {
    console.warn('Deer wallpapers: could not start', e);
  } finally {
    starting--;
    emit(); // no longer pending
  }
}

/** No picker has shown its Photo or Video tab for a second: the thumbnails stop (not a manifest request sent). */
function stop(): void {
  stopTimer = 0;
  if (watchers) return;
  for (const ac of thumbRunning.values()) ac.abort();
  if (failed) {
    failed = null;
    emit();
  }
}

// ---- choosing ----

/** The entry listed under this id with this kind (the same id listed as the other kind is another wallpaper). */
function listedEntry(id: string, kind: WallpaperKind): WallpaperEntry | undefined {
  return manifest && manifest.base === baseURL() ? manifest.entries.find((e) => e.id === id && e.kind === kind) : undefined;
}

/** The file in the profile is the one this entry lists (it was checked against that hash). */
function isLocal(e: WallpaperEntry): boolean {
  return files.has(fileName(e.id, e.kind)) && chosen.some((c) => c.id === e.id && c.kind === e.kind && c.sha256 === e.sha256);
}

/**
 * Put a choice first in chosen.json (an entry: its record anew; else the record it had). The record
 * of the same id's other kind stays as it is, and so does its file.
 */
async function remember(id: string, kind: WallpaperKind, e: WallpaperEntry | undefined): Promise<void> {
  const same = (c: Chosen): boolean => c.id === id && c.kind === kind;
  const old = chosen.find(same);
  const rec: Chosen | undefined = e
    ? { id, kind, sha256: e.sha256, bytes: e.bytes, title: e.title, author: e.author, license: e.license, color: e.color, at: Date.now() }
    : old && { ...old, at: Date.now() };
  if (!rec) return;
  chosen = [rec, ...chosen.filter((c) => !same(c))];
  await writeJSON(CHOSEN, chosen);
}

/** Home's background: a photo as an 'image', a video as a 'video' (its colour first, for Home's first paint). */
function apply(path: string, kind: WallpaperKind, color: string | undefined): void {
  const bg = { kind: kind === 'video' ? ('video' as const) : ('image' as const), path };
  if (kind === 'video' && color) VitreHome.setBaseColor(bg, color);
  VitreSettings.set({ homeBackground: bg });
}

function fail(d: Download, why: string): ChooseResult {
  console.warn(`Deer wallpapers: ${d.id} was not used: ${why}`);
  if (download === d) {
    download = null;
    failed = { id: d.id, kind: d.kind };
    emit();
  }
  return 'failed';
}

function progressOf(d: Download, n: number): void {
  d.received = n;
  emitSoon();
}

/** A photo (at most 25 MiB), read whole and checked, then written. Null once it is at `path`. */
async function savePhoto(b: string, e: WallpaperEntry, path: string, d: Download): Promise<ChooseResult | null> {
  let bytes: Uint8Array;
  try {
    bytes = await getBytes(`${b}full/${e.id}.jpg`, e.bytes, 'image/jpeg', d.ac.signal, false, (n) => progressOf(d, n));
  } catch (err) {
    if (download !== d) return 'superseded';
    return fail(d, err instanceof Error ? err.message : String(err));
  }
  if (download !== d) return 'superseded';
  const why = await verify(bytes, e.bytes, e.sha256, e);
  if (why) return fail(d, why);
  if (download !== d) return 'superseded';
  try {
    await writeFile(path, bytes);
  } catch (err) {
    return fail(d, `it could not be saved (${err})`);
  }
  return null;
}

/**
 * A video (up to 100 MiB), never whole in memory: written to <id>.mp4.part a step at a time as it
 * arrives and hashed on the way, refused as soon as it does not start as an MP4 video does (its 'ftyp'
 * box, read whole before the first byte is written) or runs past its size, renamed to <id>.mp4 once its
 * size and SHA-256 are the ones listed. Null once it is at `path`; otherwise the temporary file is gone
 * before the tile hears of it.
 */
async function saveVideo(b: string, e: WallpaperEntry, path: string, d: Download): Promise<ChooseResult | null> {
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
    // The first step makes the file; later ones fail if it went meanwhile (a prune: this was superseded).
    await IOUtils.write(part, step, { mode: written ? 'append' : 'overwrite' });
    written += step.byteLength;
  };
  const refuse = async (why: string): Promise<ChooseResult> => {
    await removeFile(part);
    return download === d ? fail(d, why) : 'superseded';
  };
  let n = 0;
  try {
    await IOUtils.makeDirectory(folder(), { createAncestors: true, ignoreExisting: true });
    n = await getStream(`${b}full/${e.id}.mp4`, e.bytes, 'video/mp4', d.ac.signal, false, async (piece, total) => {
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
      progressOf(d, total);
    });
    await flush();
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
  if (download !== d) return refuse('superseded');
  if (n !== e.bytes) return refuse(`${n} bytes, not the ${e.bytes} listed`);
  if (mp4 !== true) return refuse('not an MP4 video');
  const raw: string = hash.finish(false);
  if (Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') !== e.sha256) return refuse('its SHA-256 is not the one listed');
  if (download !== d) return refuse('superseded');
  try {
    await IOUtils.move(part, path);
  } catch (err) {
    return refuse(`it could not be saved (${err})`);
  }
  return null;
}

async function fetchAndApply(d: Download): Promise<ChooseResult> {
  await ensureLoaded();
  const b = baseURL();
  const { id, kind } = d;
  // Only this kind's entry: the same id listed as the other kind is not this tile's wallpaper.
  const e = listedEntry(id, kind);
  const rec = chosen.find((c) => c.id === id && c.kind === kind);
  const path = filePath(id, kind);
  // Here already (the same file as listed; one no longer listed is used as it is): at once.
  if ((e ? isLocal(e) : files.has(fileName(id, kind))) && (await exists(path))) {
    if (download !== d) return 'superseded';
    download = null;
    apply(path, kind, e?.color ?? rec?.color); // nothing awaited since the check: a choice made meanwhile cannot be overwritten
    // The tile is no longer busy (choosing the background it already is changes no setting, so no
    // other change would tell the pickers).
    emit();
    await remember(id, kind, e);
    void pruneFiles();
    return 'applied';
  }
  if (!e) return fail(d, 'it is not in the collection');
  d.total = e.bytes;
  emit();
  const stopped = e.kind === 'video' ? await saveVideo(b, e, path, d) : await savePhoto(b, e, path, d);
  if (stopped) return stopped;
  if (download !== d) {
    // Superseded while it was written: never applied, and not kept (unless it is the background).
    const now = current();
    if (now?.id !== e.id || now.kind !== e.kind) await removeFile(path);
    return 'superseded';
  }
  download = null;
  files.add(fileName(e.id, e.kind));
  apply(path, e.kind, e.color);
  await remember(e.id, e.kind, e);
  void pruneFiles();
  return 'applied';
}

export const VitreWallpapers = {
  BASE,
  /** The clock of the 10-minute rule (tests replace it). */
  now: (): number => Date.now(),

  folder,
  isDeerPath,

  watch(): () => void {
    watchers++;
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = 0;
    }
    void start(watchers === 1);
    let on = true;
    return () => {
      if (!on) return;
      on = false;
      watchers = Math.max(0, watchers - 1);
      if (!watchers && !stopTimer) stopTimer = setTimeout(stop, STOP_DELAY_MS);
    };
  },

  state(): WallpaperState {
    const b = baseURL();
    const m = manifest && manifest.base === b ? manifest : null;
    const tiles: WallpaperTile[] = [];
    for (const e of m?.entries ?? []) {
      const thumb = thumbs.get(e.id) === e.thumbBytes ? thumbPath(e.id) : '';
      const local = isLocal(e);
      if (!m!.network && !thumb && !local) continue; // without the network: only what is here
      tiles.push({ id: e.id, kind: e.kind, title: e.title, author: e.author, license: e.license, color: e.color, path: filePath(e.id, e.kind), thumb, local, listed: true });
    }
    const cur = current();
    if (cur && files.has(fileName(cur.id, cur.kind)) && !tiles.some((t) => t.id === cur.id && t.kind === cur.kind)) {
      const r = chosen.find((c) => c.id === cur.id && c.kind === cur.kind);
      tiles.unshift({ id: cur.id, kind: cur.kind, title: r?.title ?? 'Deer wallpaper', author: r?.author ?? '', license: r?.license ?? '', color: r?.color ?? '#2b2a2e', path: filePath(cur.id, cur.kind), thumb: '', local: true, listed: false });
    }
    return {
      tiles,
      downloading: download ? { id: download.id, kind: download.kind, received: download.received, total: download.total } : null,
      failed: failed && { ...failed },
      pending: starting > 0 || !!manifestAc,
    };
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  choose(id: string, kind: WallpaperKind): Promise<ChooseResult> {
    if (kind !== 'photo' && kind !== 'video') return Promise.resolve('failed');
    if (download?.id === id && download.kind === kind) return download.done;
    VitreWallpapers.supersede();
    const d: Download = { id, kind, ac: new AbortController(), received: 0, total: 0, done: Promise.resolve<ChooseResult>('failed') };
    download = d;
    d.done = fetchAndApply(d).catch((e) => fail(d, String(e)));
    emit();
    return d.done;
  },

  supersede(): void {
    const d = download;
    const hadFailure = !!failed;
    download = null;
    failed = null;
    d?.ac.abort();
    if (d || hadFailure) emit();
  },

  /** For tests and diagnostics. */
  debug(): { base: string; fetching: boolean; asked: Record<string, number>; source: 'none' | 'cache' | 'network'; watchers: number; thumbsRunning: number; chosen: string[]; files: string[] } {
    const b = baseURL();
    const source = manifest?.base === b ? (manifest.network ? 'network' : 'cache') : 'none';
    return { base: b, fetching: !!manifestAc, asked: Object.fromEntries(asked), source, watchers, thumbsRunning: thumbRunning.size, chosen: chosen.map((c) => fileName(c.id, c.kind)), files: [...files].sort() };
  },
};
