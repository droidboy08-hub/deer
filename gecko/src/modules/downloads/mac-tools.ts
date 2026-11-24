// The video tools on a Mac: which macOS builds Deer downloads when the person asks for them
// (Settings › Video downloads › Download ffmpeg / yt-dlp), and the steps that turn a checked download
// into programs macOS lets Deer start. ffmpeg-install.ts and ytdlp.ts call this only behind isMac;
// Windows never reaches it.
//
// Sources (the rule is Windows': nothing is unpacked unless its SHA-256 matches the one its source
// publishes beside it, and a mismatch installs nothing):
//   ffmpeg  Martin Riedl's FFmpeg build server, the newest release build for this Mac's processor:
//           .../redirect/latest/macos/<arm64|amd64>/release/ffmpeg.zip answers with a redirect to the
//           versioned file (.../download/macos/arm64/<id>_9.0.2/ffmpeg.zip). Deer reads
//           <that address>.sha256 ("<sha256>  ffmpeg.zip") and downloads that same address, so a release
//           published in between cannot pair one file with another's fingerprint. GET only: the
//           server's HEAD answers are unreliable. One file in the zip, ffmpeg: static, signed with its
//           author's Developer ID and notarized; GPL v3 (no macOS source builds LGPL).
//   yt-dlp  yt-dlp_macos.zip from yt-dlp's GitHub release (SHA2-256SUMS, as on Windows): the "onedir"
//           build, yt-dlp_macos beside its _internal folder (universal: Apple silicon and Intel). Not
//           the one-file yt-dlp_macos: it unpacks its Python into a new temporary folder on every run,
//           which a quarantined process such as Deer's yt-dlp may not load libraries from.
//   Deno    deno-<aarch64|x86_64>-apple-darwin.zip from Deno's GitHub release, with its .sha256sum.
// The processor is the engine's own (Services.appinfo.XPCOMABI: aarch64 or x86_64), so the tools run
// wherever Deer runs (under Rosetta too).
//
// Runnable (platform/tools.ts trustInstalledTree): after the checksum passed and before the first
// start, mode 0755 on the programs and no com.apple.quarantine on any file Deer unpacked. Then each
// tool is started once (tryRun, --version / -version) before it replaces the one in place: that proves
// it runs on this Mac, and macOS's first-run check of new code (12 to 30 s for yt-dlp, measured) happens
// during the install instead of the person's first download.
//
// Two Deers at once (Deer and Deer Dev share ~/Library/Application Support/Deer; each is its own
// process, and macOS, unlike Windows, lets a folder whose program runs be replaced):
//   - an install holds a lock file in the folder it installs into (takeInstallLock: <tools>/.install-lock,
//     <Deer>/.ffmpeg-install-lock) from its start to its end; while another live Deer holds it, the install
//     fails at once and says so. A lock whose process has ended (or now runs another program, or that is
//     6 h old) is stale and taken over. Under the lock, what a stopped install left is removed (sweep).
//   - every temporary name of an install is its own (tempId: yt-dlp.new-<id>, ffmpeg-download-<id>.zip...),
//     so two installs never write, hash or unpack each other's files.
//   - a yt-dlp that runs is marked in the tools folder (markRunning: .yt-dlp-running-<pid>, holding the
//     program; removed when it ends), and an update waits for, then refuses over, every mark whose process
//     still runs that program (runningMarked), whichever Deer started it.
// Whether a process runs: /bin/ps -p <pid> -o comm= (processRuns).
//
// For tests: the source prefs of ffmpeg-install.ts and ytdlp.ts are read the same way on a Mac
// (base URLs ending with "/"); vitre.ffmpeg.source serves <base>ffmpeg.zip (it may redirect) and
// <final address>.sha256.
//
// Firefox internals: fetch (Response.url: the address after redirects), nsIZipReader (findEntries,
// extract; extract keeps the entry's Unix mode), resource://gre/modules/Subprocess.sys.mjs (call, pid),
// IOUtils.writeUTF8 mode 'create' (fails when the file is there), Services.appinfo.processID,
// Services.dirsvc "XREExeF".
import { Subprocess } from 'resource://gre/modules/Subprocess.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { fileFor } from './partfile';

/** The processor the engine was built for: 'arm64' (Apple silicon) or 'x86_64' (Intel, or Rosetta). */
export function macArch(): 'arm64' | 'x86_64' {
  let abi = '';
  try {
    abi = String(Services.appinfo.XPCOMABI);
  } catch {
    /* unknown: Deer's Mac engine is arm64 */
  }
  return /^x86_64/i.test(abi) ? 'x86_64' : 'arm64';
}

/** The ffmpeg release folder for this Mac: <it>ffmpeg.zip redirects to the newest release build. */
export function ffmpegMacRelease(): string {
  return `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${macArch() === 'x86_64' ? 'amd64' : 'arm64'}/release/`;
}

/** yt-dlp's macOS build (onedir) in its release, the folder it is unpacked into, and its program there. */
export const YTDLP_MAC_ZIP = 'yt-dlp_macos.zip';
export const YTDLP_MAC_DIR = 'yt-dlp';
export const YTDLP_MAC_EXE = 'yt-dlp_macos';

/** Deno's zip for this Mac. */
export function denoMacZip(): string {
  return `deno-${macArch() === 'x86_64' ? 'x86_64' : 'aarch64'}-apple-darwin.zip`;
}

/** GET `url`, following redirects; the address it ended at. The body is not read. */
export async function finalAddress(url: string): Promise<string> {
  const ac = new AbortController();
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ac.signal });
  } catch {
    throw new Error('the release could not be reached');
  }
  try {
    ac.abort();
  } catch {
    /* the body is not needed */
  }
  if (!res.ok) throw new Error(`the release answered ${res.status}`);
  return res.url || url;
}

/** The text at `url` (a checksum list). */
export async function releaseText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new Error('the release could not be reached');
  }
  if (!res.ok) throw new Error(`the release's checksum list answered ${res.status}`);
  return res.text();
}

/** The SHA-256 a "<hex>  name" list gives `name`, lower case, or ''. */
export function listedFingerprint(text: string, name: string): string {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return '';
}

/** "9.0.2" from Riedl's versioned address (.../<id>_9.0.2/ffmpeg.zip), or ''. */
export function ffmpegVersionOf(url: string): string {
  return /\/\d+_([0-9][\w.-]*)\/ffmpeg\.zip$/i.exec(url)?.[1] ?? '';
}

function entryNames(reader: any): string[] {
  const names: string[] = [];
  const all = reader.findEntries(null);
  while (all.hasMore()) names.push(all.getNext());
  return names;
}

/** An entry's path parts, or null for a folder entry or a name that would land outside the folder. */
function safeParts(name: string): string[] | null {
  if (name.endsWith('/') || name.startsWith('/') || name.includes('\\')) return null;
  const parts = name.split('/');
  return parts.every((p) => p && p !== '.' && p !== '..') ? parts : null;
}

/** Unpack every file of the zip into `dir` (folders made as needed); the files' paths. Throws on a name outside `dir`. */
export async function unzipAll(zip: string, dir: string): Promise<string[]> {
  const reader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
  reader.open(fileFor(zip));
  try {
    const out: string[] = [];
    for (const name of entryNames(reader)) {
      if (name.endsWith('/')) continue;
      const parts = safeParts(name);
      if (!parts) throw new Error('the download holds a file outside its folder, so it was not installed');
      const target = PathUtils.join(dir, ...parts);
      await IOUtils.makeDirectory(PathUtils.parent(target) ?? dir, { createAncestors: true, ignoreExisting: true });
      reader.extract(name, fileFor(target));
      out.push(target);
      // Let the window paint between files.
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  } finally {
    reader.close();
  }
}

/** Unpack the zip's one entry whose name matches `re` to `target`; false when there is none. */
export async function unzipOne(zip: string, re: RegExp, target: string): Promise<boolean> {
  const reader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
  reader.open(fileFor(zip));
  try {
    const entry = entryNames(reader).find((n) => re.test(n) && !!safeParts(n));
    if (!entry) return false;
    await IOUtils.remove(target, { ignoreAbsent: true });
    reader.extract(entry, fileFor(target));
    return true;
  } finally {
    reader.close();
  }
}

/**
 * Start `program` with `args` once and read what it prints (stdout and stderr together), at most
 * `timeoutMs`. `onStart` gets a stop function (a Cancel kills it). Never rejects: `error` says why it
 * did not run to the end.
 */
export async function tryRun(program: string, args: string[], timeoutMs: number, onStart: (stop: () => void) => void = () => undefined): Promise<{ code: number; out: string; error: string }> {
  let proc: any;
  try {
    proc = await Subprocess.call({ command: program, arguments: args, stderr: 'stdout' });
  } catch (e) {
    return { code: -1, out: '', error: e instanceof Error ? e.message : String(e) };
  }
  let timedOut = false;
  let stopped = false;
  const kill = (): void => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  };
  onStart(() => {
    stopped = true;
    kill();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  let out = '';
  try {
    for (;;) {
      const s: string = await proc.stdout.readString();
      if (!s) break;
      if (out.length < 20000) out += s;
    }
    const { exitCode } = await proc.wait();
    const error = timedOut ? `it did not answer within ${Math.round(timeoutMs / 1000)} s` : stopped ? 'stopped' : exitCode !== 0 ? `it stopped with code ${exitCode}` : '';
    return { code: exitCode, out, error };
  } catch (e) {
    return { code: -1, out, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---- two Deers at once (header) ----

/** A program's file name ("/usr/bin/xattr" -> "xattr"). */
function leaf(path: string): string {
  return path.trim().split('/').pop() ?? '';
}

/**
 * Whether process `pid` runs and runs a program of the file name of `program` ('' accepts any): a pid
 * macOS has given to another program since is not it. True when ps does not answer (the safe side: wait
 * or refuse, never replace under a program that may run).
 */
export async function processRuns(pid: number, program: string): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const r = await tryRun('/bin/ps', ['-p', String(pid), '-o', 'comm='], 10000);
  if (r.code === 1 && !r.out.trim()) return false; // no such process
  if (r.code !== 0 || !r.out.trim()) return true;
  return !program || leaf(r.out) === leaf(program);
}

/** A name part no other install uses ("yt-dlp.new-<it>"). */
export function tempId(): string {
  let pid = 0;
  try {
    pid = Services.appinfo.processID;
  } catch {
    /* only a part of the name */
  }
  return `${pid}${Math.random().toString(36).slice(2, 8)}`;
}

/** An install lock taken this long ago is stale, whoever took it (no install takes this long). */
const LOCK_STALE_MS = 6 * 3600 * 1000;

/**
 * Take the install lock file `lock` (header): resolves with its release, or null while another Deer
 * that runs holds it. Throws when the folder cannot be written.
 */
export async function takeInstallLock(lock: string): Promise<(() => Promise<void>) | null> {
  let me = 0;
  let exe = '';
  try {
    me = Services.appinfo.processID;
    exe = Services.dirsvc.get('XREExeF', Ci.nsIFile).path;
  } catch {
    /* recorded as far as known */
  }
  const body = JSON.stringify({ pid: me, exe, at: Date.now() });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await IOUtils.writeUTF8(lock, body, { mode: 'create' });
      return async () => {
        await IOUtils.remove(lock, { ignoreAbsent: true }).catch(() => undefined);
      };
    } catch {
      if (!(await IOUtils.exists(lock).catch(() => false))) throw new Error('Deer’s folder could not be written to');
    }
    let held: { pid?: unknown; exe?: unknown; at?: unknown } | null = null;
    try {
      held = JSON.parse(await IOUtils.readUTF8(lock));
    } catch {
      /* just created and not written yet, or damaged: judged by its age */
    }
    let stale: boolean;
    if (held && typeof held === 'object') {
      const pid = Number(held.pid);
      // This process's own: its install guard lets one install at a time, so it is left from an earlier one.
      stale = pid === me || !(Date.now() - Number(held.at) < LOCK_STALE_MS) || !(await processRuns(pid, String(held.exe ?? '')));
    } else {
      const st = await IOUtils.stat(lock).catch(() => null);
      stale = !st || Date.now() - Number(st.lastModified) > 60000;
    }
    if (!stale) return null;
    await IOUtils.remove(lock, { ignoreAbsent: true }).catch(() => undefined);
  }
  return null;
}

/** Under the install lock: remove what in `dir` a stopped install left (the names `leftover` accepts). */
export async function sweep(dir: string, leftover: (name: string) => boolean): Promise<void> {
  for (const p of await IOUtils.getChildren(dir).catch(() => [] as string[])) {
    if (leftover(PathUtils.filename(p))) await IOUtils.remove(p, { recursive: true, ignoreAbsent: true }).catch(() => undefined);
  }
}

const MARK = /^\.yt-dlp-running-(\d+)$/;

/** Mark yt-dlp process `pid` (running `program`) as running in tools folder `dir`; the mark's path, or '' (best effort). */
export async function markRunning(dir: string, pid: number, program: string): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const path = PathUtils.join(dir, `.yt-dlp-running-${pid}`);
  try {
    await IOUtils.writeUTF8(path, program);
    return path;
  } catch {
    return ''; // no tools folder (a stand-in command): nothing an update could replace under it
  }
}

/** Remove a mark markRunning made. */
export async function unmarkRunning(path: string): Promise<void> {
  if (path) await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => undefined);
}

/** How many yt-dlp marked in `dir` (by any Deer) still run; the marks of ended ones are removed. */
export async function runningMarked(dir: string): Promise<number> {
  let n = 0;
  for (const p of await IOUtils.getChildren(dir).catch(() => [] as string[])) {
    const m = MARK.exec(PathUtils.filename(p));
    if (!m) continue;
    let program = '';
    try {
      program = await IOUtils.readUTF8(p);
    } catch {
      continue; // removed meanwhile: it ended
    }
    if (await processRuns(Number(m[1]), program)) n++;
    else await IOUtils.remove(p, { ignoreAbsent: true }).catch(() => undefined);
  }
  return n;
}
