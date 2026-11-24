// Installing ffmpeg for the person, when they ask for it (Settings › Video downloads).
//
// Source: BtbN's FFmpeg Builds on GitHub, the Windows build ffmpeg.org links to. Deer takes the
// newest stable release (not the nightly "master" build), LGPL licence, "shared" variant: ffmpeg.exe
// plus its DLLs, about 75 MB instead of about 170 MB for the static one.
//   1. checksums.sha256 of the release lists every file with its SHA-256; the newest
//      ffmpeg-n<major>.<minor>-latest-win64-lgpl-shared-<version>.zip is picked from it.
//   2. The zip is downloaded with Firefox's Download object (progress, cancel), outside any download
//      list, so neither Firefox's history nor Deer's take-over sees it.
//   3. Its SHA-256 must match the list, else nothing is installed.
//   4. bin\ffmpeg.exe, bin\*.dll and LICENSE.txt are unpacked into a fresh folder that then replaces
//      %LOCALAPPDATA%\Deer\ffmpeg; the zip is deleted. The caller points vitre.ffmpegPath at the exe.
// One install at a time per process; the state is kept here so a reopened Settings page shows it.
//
// macOS (runMac; the sources and the steps are in mac-tools.ts): the same steps from Martin Riedl's
// macOS release build for this Mac's processor. 1. <release>ffmpeg.zip is asked for and its redirect
// followed to the versioned file; <that address>.sha256 gives its SHA-256 and the version (9.0.2) is
// read from the address. 2. That same address is downloaded as above. 3. The SHA-256 must match.
// 4. ffmpeg alone is unpacked into the fresh folder, made runnable (mode 0755, no quarantine:
// platform/tools.ts trustInstalledTree) and started once (-version; the row says Checking, Cancel
// stops it) before it replaces ~/Library/Application Support/Deer/ffmpeg; the caller points
// vitre.ffmpegPath at it. Deer and Deer Dev share that folder: the install holds
// <Deer>/.ffmpeg-install-lock and its temporary names are its own (ffmpeg-download-<id>.zip,
// ffmpeg.new-<id>; mac-tools.ts, two Deers at once).
//
// Deer's folders under %LOCALAPPDATA% (deerFolder, also used for yt-dlp and Deno): new downloads go
// to %LOCALAPPDATA%\Deer. A copy downloaded while the browser was called Vitre, in
// %LOCALAPPDATA%\Vitre (oldFolder), is still found and used (ffmpeg.ts, ytdlp.ts), never downloaded
// again, and never written to, moved or deleted. macOS: the data root is ~/Library/Application Support
// (platform/dirs.ts dataRoot), so Deer's folder is ~/Library/Application Support/Deer, shared by Deer
// and Deer Dev as %LOCALAPPDATA%\Deer is on Windows; there is no old folder (oldFolder is never read).
//
// For tests (prefs): vitre.ffmpeg.source = base URL of a release (ends with "/"; on a Mac it serves
// ffmpeg.zip, which may redirect, and <final address>.sha256), vitre.ffmpeg.installDir = the folder
// that replaces %LOCALAPPDATA%\Deer\ffmpeg, vitre.localAppData = a folder that stands in for
// %LOCALAPPDATA% (on a Mac for ~/Library/Application Support; tools/run.py sets one inside each
// throwaway profile, so a test never reads the person's real copies).
//
// Firefox internals: resource://gre/modules/Downloads.sys.mjs (createDownload, Download.start /
// cancel / finalize / onchange), nsICryptoHash (updateFromStream), nsIZipReader (findEntries,
// extract), Services.dirsvc "LocalAppData".
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { isMac } from '../../shared/os';
import { dataRoot } from '../platform/dirs';
import { toolName, trustInstalledTree } from '../platform/tools';
import { ffmpegMacRelease, ffmpegVersionOf, finalAddress, listedFingerprint, releaseText, sweep, takeInstallLock, tempId, tryRun, unzipOne } from './mac-tools';
import { fileFor } from './partfile';

const RELEASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
const BUILD = /^([0-9a-f]{64})\s+\*?(ffmpeg-n(\d+)\.(\d+)-latest-win64-lgpl-shared-([\d.]+)\.zip)$/i;

export type FfmpegInstallPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'unpacking' | 'done' | 'failed' | 'cancelled';

export interface FfmpegInstallState {
  phase: FfmpegInstallPhase;
  /** "9.0" once the release list has been read. */
  version: string;
  received: number;
  total: number;
  /** The installed ffmpeg.exe ('done'; ffmpeg on a Mac). */
  path: string;
  /** What went wrong, in a sentence ('failed'). */
  error: string;
}

let state: FfmpegInstallState = { phase: 'idle', version: '', received: 0, total: 0, path: '', error: '' };
const listeners = new Set<(s: FfmpegInstallState) => void>();
let running: Promise<string> | null = null;
let cancelled = false;
let active: any = null;

function set(patch: Partial<FfmpegInstallState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.error('Deer ffmpeg install listener', e);
    }
  }
}

export function ffmpegInstallState(): FfmpegInstallState {
  return state;
}

/** Called on every change of the install state; returns the unsubscribe. */
export function onFfmpegInstall(fn: (s: FfmpegInstallState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cancelFfmpegInstall(): void {
  if (!running) return;
  cancelled = true;
  active?.cancel?.().catch?.(() => undefined);
}

class Stop extends Error {}

function check(): void {
  if (cancelled) throw new Stop('cancelled');
}

function pref(name: string): string {
  try {
    return Services.prefs.getStringPref(name, '');
  } catch {
    return '';
  }
}

/** %LOCALAPPDATA% (~/Library/Application Support on a Mac), or the folder a test put in its place (vitre.localAppData). */
export function localAppData(): string {
  // macOS has no "LocalAppData" folder key (Services.dirsvc.get throws there).
  if (isMac) return dataRoot();
  return pref('vitre.localAppData') || Services.dirsvc.get('LocalAppData', Ci.nsIFile).path;
}

/** A folder in Deer's own %LOCALAPPDATA%\Deer, where what Deer downloads for the person goes. */
export function deerFolder(name: string): string {
  return PathUtils.join(localAppData(), 'Deer', name);
}

/** The same folder in %LOCALAPPDATA%\Vitre, from before the rename: only ever read (never on a Mac). */
export function oldFolder(name: string): string {
  return PathUtils.join(localAppData(), 'Vitre', name);
}

/** Where ffmpeg goes: %LOCALAPPDATA%\Deer\ffmpeg (a test can move it). */
export function ffmpegInstallDir(): string {
  return pref('vitre.ffmpeg.installDir') || deerFolder('ffmpeg');
}

/** Pick the newest stable LGPL shared build from the release's checksum list. */
export function pickBuild(list: string): { name: string; sha256: string; version: string } | null {
  let best: { name: string; sha256: string; version: string; rank: number } | null = null;
  for (const line of list.split(/\r?\n/)) {
    const m = BUILD.exec(line.trim());
    if (!m) continue;
    const rank = Number(m[3]) * 1000 + Number(m[4]);
    if (!best || rank > best.rank) best = { sha256: m[1].toLowerCase(), name: m[2], version: `${m[3]}.${m[4]}`, rank };
  }
  return best && { name: best.name, sha256: best.sha256, version: best.version };
}

/** SHA-256 of a file, read in 8 MB steps so the window keeps painting. */
export async function sha256(path: string, isCancelled: () => boolean = () => cancelled): Promise<string> {
  const file = fileFor(path);
  const size = file.fileSize;
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  const input = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
  input.init(file, -1, 0, 0);
  try {
    for (let done = 0; done < size; ) {
      if (isCancelled()) throw new Stop('cancelled');
      const n = Math.min(8 * 1024 * 1024, size - done);
      hash.updateFromStream(input, n);
      done += n;
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    input.close();
  }
  const bin: string = hash.finish(false);
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

/** bin\ffmpeg.exe, bin\*.dll and LICENSE.txt from the zip into `dir`. Returns the exe's path. */
function unpack(zipPath: string, dir: string): string {
  const reader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
  reader.open(fileFor(zipPath));
  try {
    const names: string[] = [];
    const all = reader.findEntries(null);
    while (all.hasMore()) names.push(all.getNext());
    const wanted = names.filter((n) => /^[^/]+\/bin\/(ffmpeg\.exe|[^/]+\.dll)$/i.test(n) || /^[^/]+\/LICENSE\.txt$/i.test(n));
    if (!wanted.some((n) => /\/bin\/ffmpeg\.exe$/i.test(n))) throw new Error('the download has no ffmpeg.exe in it');
    let exe = '';
    for (const name of wanted) {
      const leaf = name.slice(name.lastIndexOf('/') + 1);
      const target = PathUtils.join(dir, leaf);
      reader.extract(name, fileFor(target));
      if (/^ffmpeg\.exe$/i.test(leaf)) exe = target;
    }
    return exe;
  } finally {
    reader.close();
  }
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(`the release's checksum list answered ${res.status}`);
  return res.text();
}

async function run(): Promise<string> {
  const source = pref('vitre.ffmpeg.source') || RELEASE;
  const home = ffmpegInstallDir();
  const parent = PathUtils.parent(home) ?? home;
  const zip = PathUtils.join(parent, 'ffmpeg-download.zip');
  const fresh = home + '.new';
  set({ phase: 'checking', version: '', received: 0, total: 0, path: '', error: '' });
  await IOUtils.makeDirectory(parent, { createAncestors: true, ignoreExisting: true });
  try {
    const build = pickBuild(await fetchText(source + 'checksums.sha256'));
    if (!build) throw new Error('no Windows build was found in the release');
    check();
    set({ phase: 'downloading', version: build.version });

    await IOUtils.remove(zip, { ignoreAbsent: true });
    const download = await Downloads.createDownload({ source: { url: source + build.name, isPrivate: false }, target: { path: zip } });
    active = download;
    download.onchange = () => {
      if (state.phase === 'downloading') set({ received: download.currentBytes || 0, total: download.totalBytes || 0 });
    };
    try {
      await download.start();
    } catch (e) {
      check();
      throw new Error('the download stopped' + (download.error?.message ? `: ${download.error.message}` : ''));
    } finally {
      active = null;
      await download.finalize(false).catch(() => undefined);
    }
    check();

    set({ phase: 'verifying' });
    const actual = await sha256(zip);
    if (actual !== build.sha256) throw new Error('the file did not match its published fingerprint, so it was not installed');

    set({ phase: 'unpacking' });
    await new Promise((r) => setTimeout(r, 0));
    await IOUtils.remove(fresh, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(fresh, { createAncestors: true, ignoreExisting: true });
    unpack(zip, fresh);
    check();
    try {
      await IOUtils.remove(home, { recursive: true, ignoreAbsent: true });
    } catch {
      throw new Error('the ffmpeg already there is in use; close what uses it and try again');
    }
    await IOUtils.move(fresh, home);
    const exe = PathUtils.join(home, 'ffmpeg.exe');
    if (!(await IOUtils.exists(exe))) throw new Error('ffmpeg.exe is missing after unpacking');
    set({ phase: 'done', path: exe });
    return exe;
  } catch (e) {
    if (e instanceof Stop || cancelled) set({ phase: 'cancelled' });
    else set({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    await IOUtils.remove(zip, { ignoreAbsent: true }).catch(() => undefined);
    if (state.phase !== 'done') await IOUtils.remove(fresh, { recursive: true, ignoreAbsent: true }).catch(() => undefined);
  }
}

/** macOS: run()'s steps from the macOS release build (header; mac-tools.ts). */
async function runMac(): Promise<string> {
  const source = pref('vitre.ffmpeg.source') || ffmpegMacRelease();
  const home = ffmpegInstallDir();
  const parent = PathUtils.parent(home) ?? home;
  // This install's own names (another Deer may install into the same folder; mac-tools.ts).
  const id = tempId();
  const zip = PathUtils.join(parent, `ffmpeg-download-${id}.zip`);
  const fresh = `${home}.new-${id}`;
  const stem = PathUtils.filename(home) + '.new';
  const leftover = (n: string): boolean => /^ffmpeg-download(-\w+)?\.zip$/.test(n) || n === stem || (n.startsWith(stem + '-') && /^\w+$/.test(n.slice(stem.length + 1)));
  const name = toolName('ffmpeg');
  let release: (() => Promise<void>) | null = null;
  set({ phase: 'checking', version: '', received: 0, total: 0, path: '', error: '' });
  try {
    try {
      await IOUtils.makeDirectory(parent, { createAncestors: true, ignoreExisting: true });
    } catch {
      throw new Error('Deer’s folder could not be created');
    }
    release = await takeInstallLock(PathUtils.join(parent, '.ffmpeg-install-lock'));
    if (!release) throw new Error('another Deer is installing it right now; try again when it has finished');
    await sweep(parent, leftover);
    // The versioned address "latest" points at now; its fingerprint and its download are read from it.
    const url = await finalAddress(source + 'ffmpeg.zip');
    const want = listedFingerprint(await releaseText(url + '.sha256'), 'ffmpeg.zip');
    if (!want) throw new Error('no macOS build was found in the release');
    check();
    set({ phase: 'downloading', version: ffmpegVersionOf(url) });

    await IOUtils.remove(zip, { ignoreAbsent: true });
    const download = await Downloads.createDownload({ source: { url, isPrivate: false }, target: { path: zip } });
    active = download;
    download.onchange = () => {
      if (state.phase === 'downloading') set({ received: download.currentBytes || 0, total: download.totalBytes || 0 });
    };
    try {
      await download.start();
    } catch (e) {
      check();
      throw new Error('the download stopped' + (download.error?.message ? `: ${download.error.message}` : ''));
    } finally {
      active = null;
      await download.finalize(false).catch(() => undefined);
    }
    check();

    set({ phase: 'verifying' });
    const actual = await sha256(zip);
    if (actual !== want) throw new Error('the file did not match its published fingerprint, so it was not installed');

    set({ phase: 'unpacking' });
    await new Promise((r) => setTimeout(r, 0));
    await IOUtils.remove(fresh, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(fresh, { createAncestors: true, ignoreExisting: true });
    const exeNew = PathUtils.join(fresh, name);
    if (!(await unzipOne(zip, /(^|\/)ffmpeg$/, exeNew))) throw new Error('the download has no ffmpeg in it');
    check();
    // Runnable before its first start: 0755, and no quarantine (else macOS may hold it at its first start).
    if (!(await trustInstalledTree(fresh, [exeNew]))) throw new Error('macOS did not let Deer mark ffmpeg as safe to run');
    // Its first start (macOS checks new code then): the row says Checking and offers Cancel.
    set({ phase: 'verifying' });
    const ran = await tryRun(exeNew, ['-version'], 60000, (stop) => {
      active = { cancel: async () => stop() };
    });
    active = null;
    check();
    if (ran.error || !/ffmpeg version/i.test(ran.out)) throw new Error(`the downloaded ffmpeg did not start on this Mac (${ran.error || 'no version'})`);
    try {
      await IOUtils.remove(home, { recursive: true, ignoreAbsent: true });
    } catch {
      throw new Error('the ffmpeg already there could not be replaced');
    }
    await IOUtils.move(fresh, home);
    const exe = PathUtils.join(home, name);
    if (!(await IOUtils.exists(exe))) throw new Error('ffmpeg is missing after unpacking');
    set({ phase: 'done', path: exe });
    return exe;
  } catch (e) {
    if (e instanceof Stop || cancelled) set({ phase: 'cancelled' });
    else set({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    active = null;
    await IOUtils.remove(zip, { ignoreAbsent: true }).catch(() => undefined);
    if (state.phase !== 'done') await IOUtils.remove(fresh, { recursive: true, ignoreAbsent: true }).catch(() => undefined);
    await release?.();
  }
}

/** Download, check and unpack ffmpeg; resolves with the path of ffmpeg.exe (ffmpeg on a Mac). One at a time. */
export function installFfmpeg(): Promise<string> {
  if (running) return running;
  cancelled = false;
  running = (isMac ? runMac() : run()).finally(() => {
    running = null;
  });
  return running;
}
