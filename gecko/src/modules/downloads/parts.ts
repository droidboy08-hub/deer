// The hybrid file layout (spikes/downloader/IDM-WAY-DESIGN.md section 4; the owner's decision of 2026-10-21).
// On a volume with sparse files (NTFS) a ranged download is one sparse .part written in place, as before. On one
// without them (exFAT, FAT32, some network shares) writing far into a file makes Windows fill the gap with zeros
// first (minutes on a big file), so the download is kept as IDM keeps it: "<name>.part" for the part that starts at
// byte 0 and one file per other part in "<name>.parts\" ("<start in hex>.part"), each written only at its end, then
// added to "<name>.part" in order after the last byte (ranged.ts join()).
//
// A segment's bytes are in the file that starts at its `base` (missing: 0), at local offset start - base. Every
// read of saved bytes by file offset (proofs, block hashes, checks) goes through placeOf() (partfile.ts readAt()
// and ledger.ts hashBlock() consult it), so no caller needs to know the layout; in place nothing is registered
// and every read is the .part at the file offset, as before.
import { setTimeout, clearTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { AbortedError } from './net';
import { registerPlaces, unregisterPlaces, type Place } from './partfile';

/** A segment as this module sees it (ranged.ts Segment). */
export interface Based {
  start: number;
  end: number;
  received: number;
  base?: number;
}

/** "<name>.parts", the folder of a .part's other parts. */
export function partsDir(partPath: string): string {
  return `${partPath.replace(/\.part$/i, '')}.parts`;
}

/** The file of the part that starts at `base` (0: the .part itself). */
export function partFile(partPath: string, base: number): string {
  return base > 0 ? PathUtils.join(partsDir(partPath), `${base.toString(16)}.part`) : partPath;
}

/** A part file's own name ("4000000.part"), never another file someone put in the folder. */
export function partBase(name: string): number {
  const m = /^([0-9a-f]+)\.part$/.exec(name);
  if (!m || parseInt(m[1], 16).toString(16) !== m[1]) return -1;
  return parseInt(m[1], 16);
}

/** Where the bytes from file offset `from` (for `len`, within one segment's file) are kept, by the segments' bases. */
export function locate(partPath: string, segments: Based[], from: number, len: number): Place | null {
  const seg = segments.find((s) => from >= s.start && from < s.end);
  const base = seg?.base ?? 0;
  // The range must stay in the files of one base: the segments it touches all share it.
  const to = from + Math.max(1, len);
  for (const s of segments) if (s.start < to && s.end > from && (s.base ?? 0) !== base) return null;
  return { path: partFile(partPath, base), offset: from - base };
}

/** Reads of `partPath` go to its parts from now on (the parts layout), by the segments `source()` gives. */
export function useParts(partPath: string, source: () => Based[]): void {
  registerPlaces(partPath, (from, len) => locate(partPath, source(), from, len));
}

/** Reads of `partPath` are of the .part itself again (in place, or once every part is joined). */
export function dropParts(partPath: string): void {
  unregisterPlaces(partPath);
}

/** True when some segment's bytes are in a part file of their own. */
export function hasParts(segments: Based[]): boolean {
  return segments.some((s) => (s.base ?? 0) > 0);
}

/** What a volume is, for the layout (workers/flush.js 'volume'). */
export interface Volume {
  fs: string;
  sparse: boolean;
  /** The largest file it can hold (FAT: 4 GiB - 1), 0 when there is no limit known. */
  maxFile: number;
  root: string;
  serial: number;
}

const FILE_SUPPORTS_SPARSE_FILES = 0x40;
const VOLUME_TIMEOUT = 10 * 1000;
const VOLUME_CACHE_MS = 60 * 1000;
const cache = new Map<string, { at: number; v: Volume }>();

/**
 * The volume `dir` is on, from GetVolumeInformationW in a worker of its own (a network share that hangs never
 * holds the flush worker): null when it can't be told in VOLUME_TIMEOUT. Answers are kept VOLUME_CACHE_MS.
 * Test prefs: vitre.test.volumeInfo (JSON, e.g. {"fs":"FAT32","flags":0,"serial":1}) fakes the answer.
 */
export async function volumeInfo(dir: string): Promise<Volume | null> {
  const fake = Services.prefs.getStringPref('vitre.test.volumeInfo', '');
  if (fake) {
    try {
      const f = JSON.parse(fake);
      return toVolume(String(f.fs ?? ''), Number(f.flags ?? 0), String(f.root ?? ''), Number(f.serial ?? 0));
    } catch {
      /* a broken fake: the real answer */
    }
  }
  const key = dir.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < VOLUME_CACHE_MS) return hit.v;
  const data = await new Promise<any>((resolve) => {
    let worker: any = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (v: any): void => {
      if (timer) clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* gone */
      }
      resolve(v);
    };
    try {
      worker = new (globalThis as any).ChromeWorker('chrome://vitre/content/workers/flush.js');
      worker.onmessage = (e: any) => done(e.data);
      worker.onerror = () => done(null);
      timer = setTimeout(() => done(null), VOLUME_TIMEOUT);
      worker.postMessage({ id: 1, path: dir, op: 'volume' });
    } catch {
      done(null);
    }
  });
  if (!data?.ok) return null;
  const v = toVolume(String(data.fs), Number(data.flags), String(data.root), Number(data.serial));
  cache.set(key, { at: Date.now(), v });
  return v;
}

function toVolume(fs: string, flags: number, root: string, serial: number): Volume {
  const fat = /^(FAT|FAT12|FAT16|FAT32)$/i.test(fs);
  return { fs, sparse: (flags & FILE_SUPPORTS_SPARSE_FILES) !== 0, maxFile: fat ? 0xffffffff : 0, root, serial };
}

/** The layout a new ranged download takes on `v` (vitre.test.partLayout forces one). */
export function layoutFor(v: Volume | null): 'inplace' | 'parts' {
  const forced = Services.prefs.getStringPref('vitre.test.partLayout', '');
  if (forced === 'parts' || forced === 'inplace') return forced;
  // Unknown (a timeout, an error): in place, as before (the sparse mark then decides as it always did).
  return v && !v.sparse ? 'parts' : 'inplace';
}

/**
 * Copies ranges between files in a worker of its own (workers/flush.js 'copy': ReadFile and WriteFile, no bytes
 * through JS), one join's worth: copy() moves `len` bytes of `from` at `src` to `to` at `at`, flushing `to` when
 * `flush`; a write that would start past `to`'s end is refused there (no gap, never a zero-fill). close() ends it.
 */
export class Copier {
  private worker: any = null;
  private asked = 0;
  private answers = new Map<number, (data: any) => void>();

  copy(from: string, to: string, src: number, at: number, len: number, flush: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        if (!this.worker) {
          this.worker = new (globalThis as any).ChromeWorker('chrome://vitre/content/workers/flush.js');
          this.worker.onmessage = (e: any) => {
            const done = this.answers.get(e.data?.id);
            this.answers.delete(e.data?.id);
            done?.(e.data);
          };
          this.worker.onerror = () => {
            for (const done of this.answers.values()) done(null);
            this.answers.clear();
          };
        }
        const id = ++this.asked;
        this.answers.set(id, (data) => resolve(!!data?.ok && data.copied === len));
        this.worker.postMessage({ id, op: 'copy', path: to, from, src, at, len, flush });
      } catch {
        resolve(false);
      }
    });
  }

  close(): void {
    try {
      this.worker?.terminate();
    } catch {
      /* gone */
    }
    this.worker = null;
    for (const done of this.answers.values()) done(null);
    this.answers.clear();
  }
}

/** The join's step: Pause, sleep and quit wait for at most one (about 2 s on a slow USB stick). */
export const JOIN_STEP = 8 * 1024 * 1024;


/**
 * The parts of the parts layout added to "<name>.part" in order (IDM's join, after the last byte): walking the file
 * from byte 0, each segment of a part is copied to its own place in JOIN_STEP steps, as far as the bytes run on
 * without a hole and below `upTo` (Keep partial file joins the unbroken beginning; the last byte of a whole download
 * leaves no hole). Once a part is copied whole, its segments' base is cleared and `checkpoint()` saves that (flushed:
 * the last step flushed the .part) before the part is deleted, so every state between steps is a valid layout: a
 * crash after a copy copies again (the same bytes at the same place), one after the checkpoint leaves an orphan the
 * next openPart deletes. Only what segments claim is copied (a part's old bytes never cover another's stretch), and
 * never past the .part's end (the worker refuses a gap). Throws AbortedError on `signal` between steps, and `fail()`
 * when a copy fails. Returns the bytes moved.
 */
export async function joinParts(partPath: string, segments: Based[], signal: AbortSignal, checkpoint: () => Promise<void>, fail: () => Error, upTo = Infinity): Promise<number> {
  const ordered = [...segments].sort((x, y) => x.start - y.start);
  if (!ordered.some((s) => (s.base ?? 0) > 0)) return 0;
  const copier = new Copier();
  let moved = 0;
  let end = 0;
  // Bytes copied since the last flush: flushed before the walk ends (review: a walk that stopped between two
  // segments of one part left them unflushed, and Keep partial then deleted the part).
  let unflushed = false;
  try {
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i];
      if (s.start !== end || end >= upTo) break;
      const b = s.base ?? 0;
      const take = Math.min(s.received, upTo - s.start);
      if (b > 0 && take > 0) {
        const file = partFile(partPath, b);
        for (let done = 0; done < take; done += JOIN_STEP) {
          if (signal.aborted) throw new AbortedError();
          const len = Math.min(JOIN_STEP, take - done);
          // The last step of a part (its last segment, or where the walk stops) flushes the .part.
          const next = ordered[i + 1];
          const partEnds = !next || (next.base ?? 0) !== b || take < s.received || s.received < s.end - s.start;
          const flush = partEnds && done + len >= take;
          if (!(await copier.copy(file, partPath, s.start - b + done, s.start + done, len, flush))) throw fail();
          moved += len;
          unflushed = !flush;
        }
      }
      end = s.start + take;
      const whole = take === s.received && s.received === s.end - s.start;
      // A part copied whole (its last segment done): its segments are the .part's from now on, then it goes.
      const next = ordered[i + 1];
      if (b > 0 && (!next || (next.base ?? 0) !== b)) {
        if (whole) {
          for (const x of segments) if ((x.base ?? 0) === b) delete x.base;
          await checkpoint();
          await removeFile(partFile(partPath, b));
        }
      }
      if (!whole) break;
    }
    if (unflushed && !(await copier.copy(partPath, partPath, 0, 0, 0, true))) throw fail();
  } finally {
    copier.close();
  }
  if (!segments.some((s) => (s.base ?? 0) > 0)) await removeDirIfEmpty(partsDir(partPath));
  return moved;
}

/** Delete a part by its exact name, trying again a while (an antivirus or indexer may hold a new file a moment). */
export async function removeFile(path: string): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    try {
      await IOUtils.remove(path, { ignoreAbsent: true });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

/** The parts folder goes once it holds nothing (a file someone else put there keeps it). */
export async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    if (!(await IOUtils.exists(dir))) return;
    if ((await IOUtils.getChildren(dir)).length) return;
    await IOUtils.remove(dir, { ignoreAbsent: true });
  } catch {
    /* in use, or gone */
  }
}

/** Every part file of `partPath`'s folder (never another file in it), then the folder if that leaves it empty. */
export async function removeParts(partPath: string): Promise<void> {
  const dir = partsDir(partPath);
  try {
    if (!(await IOUtils.exists(dir))) return;
    for (const p of await IOUtils.getChildren(dir)) if (partBase(PathUtils.filename(p)) > 0) await removeFile(p);
  } catch {
    /* gone */
  }
  await removeDirIfEmpty(dir);
}

/**
 * Each segment's claim kept within its own file (the parts layout), as openPart() does in place with the one .part;
 * the newest modification time of those files (the check after a stop: another program changed one of them).
 */
export async function clampParts(partPath: string, segments: Based[]): Promise<number> {
  const stats = new Map<number, { size: number; mtime: number } | null>();
  let newest = 0;
  for (const s of segments) {
    const base = s.base ?? 0;
    if (!stats.has(base)) {
      try {
        const st = await IOUtils.stat(partFile(partPath, base));
        stats.set(base, { size: st.size ?? 0, mtime: st.lastModified ?? 0 });
        newest = Math.max(newest, st.lastModified ?? 0);
      } catch {
        stats.set(base, null);
      }
    }
    const st = stats.get(base);
    s.received = st ? Math.max(0, Math.min(s.received, st.size - (s.start - base))) : 0;
  }
  return newest;
}

/** Every file a parts-layout download keeps now: the .part, then its parts (seal flushes them all). */
export function partFiles(partPath: string, segments: Based[]): string[] {
  return [...new Set(segments.map((s) => s.base ?? 0))].sort((a, b) => a - b).map((b) => partFile(partPath, b));
}
