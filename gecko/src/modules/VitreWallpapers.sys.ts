// Deer wallpapers: the collection the owner hosts on GitHub Pages (droidboy08-hub/deer-wallpapers),
// offered as one more group, "Deer wallpapers", in the background picker's Photo tab (Settings ›
// Home and background and Home's Background popover, src/window/modules/settings/bg-picker.ts).
// Choosing a tile downloads that picture once into the profile and makes it Home's background: an
// ordinary 'image' background whose path is the profile copy, so Home (VitreHome) shows it as any
// other photo. Nothing changes by itself: no rotation, no picture of the day. A process singleton
// (window code: b.sys('VitreWallpapers')).
//
// What is contacted, and when (nothing else, and never while no picker shows its Photo tab):
//   GET <base>wallpapers.json   when a picker's Photo tab comes on screen, at most once per 10 minutes
//                               per session (counted when it is sent; once sent it runs to its end, at
//                               most 1 MiB within a minute, even when the tab goes meanwhile, so its
//                               answer is not thrown away for another request)
//   GET <base>thumbs/<id>.jpg   the thumbnails of the entries listed, 3 at a time, while a Photo tab is
//                               on screen; each is kept in the profile and fetched again only when the
//                               manifest lists another one under that id
//   GET <base>full/<id>.jpg     a picture, only when the person chooses its tile (it goes on when the
//                               picker closes: the person asked for it)
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
//     never the whole list): id, file exactly full/<id>.jpg, thumb exactly thumbs/<id>.jpg, sizes,
//     SHA-256s, colour, width and height, short strings without control or bidi characters.
//   - every file is read with its declared size as a hard limit, and before a byte is written it must
//     be exactly that size, hash to the SHA-256 listed, start with a JPEG's FF D8 FF and have a frame of
//     the width and height listed (a thumbnail at most 2048 px a side). It is then written under a
//     temporary name and renamed (IOUtils.write tmpPath): a failure leaves nothing behind.
//
// Files, only ever in <profile>\deer-wallpapers (nothing outside it is written or removed):
//   wallpapers.json   the last good manifest as checked, with the base it came from (a manifest from
//                     another base is not shown)
//   thumbs\<id>.jpg   thumbnails; those the manifest no longer lists (or lists with another hash) go
//                     whenever a manifest arrives
//   <id>.jpg          pictures chosen; kept: the current background's and the 5 chosen most recently,
//                     the others removed after each choice
//   chosen.json       those pictures, newest choice first: id, SHA-256, size, title, credit, colour
//                     (a picture taken out of the collection keeps working, and its tile stays in the
//                     group while it is Home's background)
// Removal is of regular files named as above, in those two folders, and only when the folder is not a
// link elsewhere. Temporary files a write cut short (Deer killed, a crash: <id>.jpg.part in either
// folder, wallpapers.json.tmp, chosen.json.tmp) are removed when the folder is first read in a session.
//
// Contract:
//   watch()                a picker's Photo tab came on screen; returns the call for when it goes. While
//                          any is on screen: the manifest when due, then the missing thumbnails. A second
//                          after the last one goes, the thumbnails under way stop (a manifest request
//                          sent runs to its end) and a failure is forgotten.
//   state() / onChange(fn) the group to show (WallpaperState); fn() on every change; returns the remover
//   choose(id)             download (once) and set as Home's background; 'applied' | 'failed' |
//                          'superseded'. Choosing the tile that is downloading again joins it.
//   supersede()            the person chose something else: a download under way is cancelled and never
//                          applied. Also done for any other change of homeBackground (another window,
//                          about:config).
//   isDeerPath(path)       a picture of this folder (the picker keeps it out of the recent photos)
//   folder()               <profile>\deer-wallpapers
// Tests: the pref above; now() can be replaced (the 10-minute rule); debug() tells what is going on.
//
// Firefox internals (157): fetch() in the shared system global (as VitreUpdater uses it);
// RequestCredentials 'omit' -> nsIRequest::LOAD_ANONYMOUS (dom/fetch/FetchDriver.cpp); IOUtils
// (write with tmpPath, getChildren, stat, remove); nsIFile.isSymlink (true for a junction on Windows).
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { checkEntry, checkManifest, ID_RE, jpegSize, MAX_MANIFEST, MAX_THUMB_SIDE, type WallpaperEntry } from './wallpapers/manifest';

declare global {
  interface VitreSysModules {
    VitreWallpapers: typeof VitreWallpapers;
  }
}

/** One tile of the group. */
export interface WallpaperTile {
  id: string;
  title: string;
  /** '' for a picture no longer listed whose credit was never recorded. */
  author: string;
  license: string;
  /** '#rrggbb': the face until the thumbnail is in. */
  color: string;
  /** The picture's place in the profile: Home's background once chosen (it may not be there yet). */
  path: string;
  /** The checked thumbnail in the profile, or '' (not fetched yet, or refused). */
  thumb: string;
  /** The picture is in the profile already: choosing it needs no download. */
  local: boolean;
  /** False: the current background, taken out of the collection since it was chosen. */
  listed: boolean;
}

export interface WallpaperState {
  tiles: WallpaperTile[];
  /** The person's choice being downloaded. */
  downloading: { id: string; received: number; total: number } | null;
  /** The last choice that could not be downloaded or checked (its tile says so). */
  failed: string | null;
}

export type ChooseResult = 'applied' | 'failed' | 'superseded';

interface Chosen {
  id: string;
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
const KEEP_CHOSEN = 5;
/** No byte for this long: the request is given up. */
const IDLE_MS = 30_000;
/** The manifest and a thumbnail, whole, within this. */
const SMALL_DEADLINE_MS = 60_000;
/** The last picker gone this long: what is under way stops (a re-render builds a new picker at once). */
const STOP_DELAY_MS = 1000;
const NAME = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.jpg$/;
const TEMP = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.jpg\.part$/;

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
/** Pictures in the profile, by id. */
const pictures = new Set<string>();
let chosen: Chosen[] = [];
let download: Download | null = null;
let failed: string | null = null;
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
const picturePath = (id: string): string => PathUtils.join(folder(), `${id}.jpg`);
const thumbPath = (id: string): string => PathUtils.join(thumbsFolder(), `${id}.jpg`);

function isDeerPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  const dir = folder().toLowerCase() + '\\';
  const p = path.replace(/\//g, '\\').toLowerCase();
  return p.startsWith(dir) && NAME.test(p.slice(dir.length));
}

/** The id of the current background when it is one of these pictures. */
function currentId(): string | null {
  try {
    const bg = VitreSettings.get().homeBackground;
    if (bg.kind !== 'image' || !isDeerPath(bg.path)) return null;
    return NAME.exec(PathUtils.filename(bg.path).toLowerCase())?.[1] ?? null;
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

/** What is in the profile now: pictures and thumbnails by id (swapped in whole, never half-read). */
async function scan(): Promise<void> {
  const found = new Set<string>();
  const sizes = new Map<string, number>();
  for (const child of await children(folder())) {
    const m = NAME.exec(PathUtils.filename(child));
    if (m && (await exists(child))) found.add(m[1]);
  }
  for (const child of await children(thumbsFolder())) {
    const m = NAME.exec(PathUtils.filename(child));
    if (!m) continue;
    try {
      const st = await IOUtils.stat(child);
      if (st.type === 'regular') sizes.set(m[1], Number(st.size));
    } catch {
      /* gone meanwhile */
    }
  }
  pictures.clear();
  for (const id of found) pictures.add(id);
  thumbs.clear();
  for (const [id, size] of sizes) thumbs.set(id, size);
}

/** Thumbnails `keep` does not vouch for go, with temporary files no fetch is writing. */
async function pruneThumbs(keep: (id: string) => boolean): Promise<void> {
  const dir = thumbsFolder();
  if (!realFolder(dir)) return;
  for (const child of await children(dir)) {
    const name = PathUtils.filename(child);
    const m = NAME.exec(name);
    const temp = TEMP.exec(name);
    if (m && keep(m[1])) continue;
    if (temp && thumbRunning.has(temp[1])) continue;
    if (m || temp) {
      await removeFile(child);
      if (m) thumbs.delete(m[1]);
    }
  }
}

/** The pictures that stay: the current background's, the 5 chosen most recently, one downloading. */
function keptPictures(): Set<string> {
  const keep = new Set(chosen.slice(0, KEEP_CHOSEN).map((c) => c.id));
  const cur = currentId();
  if (cur) keep.add(cur);
  if (download) keep.add(download.id);
  return keep;
}

let pruning: Promise<void> = Promise.resolve();

/** Pictures not kept go; one prune at a time, each file judged when it is reached (a choice may land meanwhile). */
function prunePictures(): Promise<void> {
  const run = async (): Promise<void> => {
    const dir = folder();
    if (!realFolder(dir)) return;
    let removed = false;
    for (const child of await children(dir)) {
      const name = PathUtils.filename(child);
      const m = NAME.exec(name);
      const temp = TEMP.exec(name);
      if (m && !keptPictures().has(m[1])) {
        await removeFile(child);
        removed = pictures.delete(m[1]) || removed;
      } else if (temp && temp[1] !== download?.id) {
        await removeFile(child); // left by a write that never finished
      }
    }
    const keep = keptPictures();
    const before = chosen.length;
    chosen = chosen.filter((c) => keep.has(c.id));
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
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_RE.test(c.id) || out.some((x) => x.id === c.id)) continue;
    // The credit is shown again: it gets the manifest's own checks.
    const e = checkEntry({ ...c, file: `full/${c.id}.jpg`, thumb: `thumbs/${c.id}.jpg`, width: 16, height: 16, thumbBytes: 4, thumbSha256: c.sha256, added: undefined });
    if (typeof e === 'string') continue;
    out.push({ id: e.id, sha256: e.sha256, bytes: e.bytes, title: e.title, author: e.author, license: e.license, color: e.color, at: Number(c.at) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Temporary files a write cut short left behind (Deer killed, a crash, power lost: IOUtils leaves its
 * temporary file then). Run once, first, before anything of this session can be writing.
 */
async function removeLeftovers(): Promise<void> {
  if (!realFolder(folder())) return;
  for (const child of await children(folder())) {
    const name = PathUtils.filename(child);
    if (TEMP.test(name) || name === `${CACHE}.tmp` || name === `${CHOSEN}.tmp`) await removeFile(child);
  }
  if (!realFolder(thumbsFolder())) return;
  for (const child of await children(thumbsFolder())) if (TEMP.test(PathUtils.filename(child))) await removeFile(child);
}

/** Leftovers go; the cached manifest, the records of chosen pictures, the files; then follow homeBackground. */
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
      emit(); // a picture no longer listed is shown only while it is the background
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
 * One file, read whole into memory: a 200 answer of at most `cap` bytes (more is refused while it
 * arrives), each piece within IDLE_MS, a small one within SMALL_DEADLINE_MS. Anonymous: see the header.
 */
async function getBytes(url: string, cap: number, accept: string, signal: AbortSignal, small: boolean, progress?: (n: number) => void): Promise<Uint8Array> {
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
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const r: { done: boolean; value?: Uint8Array } = await reader.read();
      if (r.done || !r.value) break;
      clearTimeout(idle);
      idle = setTimeout(stop, IDLE_MS);
      n += r.value.byteLength;
      if (n > cap) throw new Refused(`more than ${cap} bytes`);
      chunks.push(r.value);
      progress?.(n);
    }
    return join(chunks, n);
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
  const wallpapers = entries.map((e) => ({ ...e, file: `full/${e.id}.jpg`, thumb: `thumbs/${e.id}.jpg` }));
  await writeJSON(CACHE, { version: 1, base: b, savedAt: new Date().toISOString(), wallpapers });
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
  }
}

/** No picker has shown its Photo tab for a second: the thumbnails stop (not a manifest request sent). */
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

function listedEntry(id: string): WallpaperEntry | undefined {
  return manifest && manifest.base === baseURL() ? manifest.entries.find((e) => e.id === id) : undefined;
}

/** The picture in the profile is the one this entry lists (it was checked against that hash). */
function isLocal(e: WallpaperEntry): boolean {
  return pictures.has(e.id) && chosen.some((c) => c.id === e.id && c.sha256 === e.sha256);
}

/** Put a choice first in chosen.json (an entry: its record anew; else the record it had). */
async function remember(id: string, e: WallpaperEntry | undefined): Promise<void> {
  const old = chosen.find((c) => c.id === id);
  const rec: Chosen | undefined = e
    ? { id, sha256: e.sha256, bytes: e.bytes, title: e.title, author: e.author, license: e.license, color: e.color, at: Date.now() }
    : old && { ...old, at: Date.now() };
  if (!rec) return;
  chosen = [rec, ...chosen.filter((c) => c.id !== id)];
  await writeJSON(CHOSEN, chosen);
}

function apply(path: string): void {
  VitreSettings.set({ homeBackground: { kind: 'image', path } });
}

function fail(d: Download, why: string): ChooseResult {
  console.warn(`Deer wallpapers: ${d.id} was not used: ${why}`);
  if (download === d) {
    download = null;
    failed = d.id;
    emit();
  }
  return 'failed';
}

async function fetchAndApply(d: Download): Promise<ChooseResult> {
  await ensureLoaded();
  const b = baseURL();
  const e = listedEntry(d.id);
  const path = picturePath(d.id);
  // Here already (the same picture as listed; one no longer listed is used as it is): at once.
  if ((e ? isLocal(e) : pictures.has(d.id)) && (await exists(path))) {
    if (download !== d) return 'superseded';
    download = null;
    apply(path); // nothing awaited since the check: a choice made meanwhile cannot be overwritten
    await remember(d.id, e);
    void prunePictures();
    return 'applied';
  }
  if (!e) return fail(d, 'it is not in the collection');
  d.total = e.bytes;
  emit();
  let bytes: Uint8Array;
  try {
    bytes = await getBytes(`${b}full/${e.id}.jpg`, e.bytes, 'image/jpeg', d.ac.signal, false, (n) => {
      d.received = n;
      emitSoon();
    });
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
  if (download !== d) {
    // Superseded while it was written: never applied, and not kept (unless it is the background).
    if (currentId() !== e.id) await removeFile(path);
    return 'superseded';
  }
  download = null;
  pictures.add(e.id);
  apply(path);
  await remember(e.id, e);
  void prunePictures();
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
      tiles.push({ id: e.id, title: e.title, author: e.author, license: e.license, color: e.color, path: picturePath(e.id), thumb, local, listed: true });
    }
    const cur = currentId();
    if (cur && pictures.has(cur) && !tiles.some((t) => t.id === cur)) {
      const r = chosen.find((c) => c.id === cur);
      tiles.unshift({ id: cur, title: r?.title ?? 'Deer wallpaper', author: r?.author ?? '', license: r?.license ?? '', color: r?.color ?? '#2b2a2e', path: picturePath(cur), thumb: '', local: true, listed: false });
    }
    return { tiles, downloading: download ? { id: download.id, received: download.received, total: download.total } : null, failed };
  },

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  choose(id: string): Promise<ChooseResult> {
    if (download?.id === id) return download.done;
    VitreWallpapers.supersede();
    const d: Download = { id, ac: new AbortController(), received: 0, total: 0, done: Promise.resolve<ChooseResult>('failed') };
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
  debug(): { base: string; fetching: boolean; asked: Record<string, number>; source: 'none' | 'cache' | 'network'; watchers: number; thumbsRunning: number; chosen: string[] } {
    const b = baseURL();
    const source = manifest?.base === b ? (manifest.network ? 'network' : 'cache') : 'none';
    return { base: b, fetching: !!manifestAc, asked: Object.fromEntries(asked), source, watchers, thumbsRunning: thumbRunning.size, chosen: chosen.map((c) => c.id) };
  },
};
