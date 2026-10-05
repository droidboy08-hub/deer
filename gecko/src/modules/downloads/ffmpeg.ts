// ffmpeg, when there is one. Only ever used to change the container or join video and audio
// (-c copy): nothing is re-encoded. ffmpeg is downloaded only when the person asks for it
// (ffmpeg-install.ts, which then sets the path below). Port of
// spikes/downloader/verify/engine/VitreFfmpeg.sys.mjs (Subprocess instead of child_process).
//
// Where it is looked for, in order:
//   1. the path in Settings › Downloads (vitre.ffmpegPath);
//   2. Deer's own copy beside the application (<install dir>\ffmpeg\ffmpeg.exe or <install dir>\ffmpeg.exe,
//      the folder of the runtime's exe, "XREExeF"), where a release would bundle its LGPL build;
//   3. the copy Deer downloaded for the person: %LOCALAPPDATA%\Deer\ffmpeg\ffmpeg.exe, then the one
//      downloaded before the rename, %LOCALAPPDATA%\Vitre\ffmpeg\ffmpeg.exe (used where it is, never
//      moved or downloaded again; ffmpeg-install.ts);
//   4. PATH (Subprocess.pathSearch).
// None: the UI says "ffmpeg not found" and streams that need joining are kept as separate files.
//
// Firefox internals: resource://gre/modules/Subprocess.sys.mjs (call, pathSearch; stdout/stderr
// readString; wait; kill), Services.dirsvc "XREExeF".
import { Subprocess } from 'resource://gre/modules/Subprocess.sys.mjs';
import { ffmpegInstallDir, oldFolder } from './ffmpeg-install';
import { AbortedError } from './net';
import { existsSync, fileFor } from './partfile';
import type { FfmpegInfo } from './types';

let cache: { at: number; key: string; info: FfmpegInfo } | null = null;

function isFile(path: string): boolean {
  try {
    const f = fileFor(path);
    return f.exists() && f.isFile();
  } catch {
    return false;
  }
}

/** Forget the cached answer (the setting changed). */
export function forgetFfmpeg(): void {
  cache = null;
}

export async function findFfmpeg(settingPath: string): Promise<FfmpegInfo> {
  const setting = settingPath || '';
  const downloads = [PathUtils.join(ffmpegInstallDir(), 'ffmpeg.exe'), PathUtils.join(oldFolder('ffmpeg'), 'ffmpeg.exe')];
  const key = [setting, ...downloads].join('|');
  if (cache && cache.key === key && Date.now() - cache.at < 60000) return cache.info;
  let info: FfmpegInfo = { path: null, source: 'none', settingBroken: false };
  if (setting) {
    if (isFile(setting)) info = { path: setting, source: 'settings', settingBroken: false };
    else info.settingBroken = true;
  }
  if (!info.path) {
    try {
      const exeDir = Services.dirsvc.get('XREExeF', Ci.nsIFile).parent.path;
      const bundled = [PathUtils.join(exeDir, 'ffmpeg', 'ffmpeg.exe'), PathUtils.join(exeDir, 'ffmpeg.exe')].find((c) => existsSync(c) && isFile(c));
      if (bundled) info = { ...info, path: bundled, source: 'bundled' };
    } catch {
      /* no exe dir */
    }
  }
  if (!info.path) {
    const downloaded = downloads.find((c) => isFile(c));
    if (downloaded) info = { ...info, path: downloaded, source: 'downloaded' };
  }
  if (!info.path) {
    try {
      const found = await Subprocess.pathSearch('ffmpeg');
      if (found) info = { ...info, path: found, source: 'path' };
    } catch {
      /* not on PATH */
    }
  }
  cache = { at: Date.now(), key, info };
  return info;
}

/**
 * Run ffmpeg to the end. `onProgress(seconds)` is called as ffmpeg reports how much media time it
 * has written (-progress pipe:2 puts key=value lines on stderr). Rejects with the tail of stderr
 * when the exit code isn't 0; `signal` kills the process.
 */
export async function runFfmpeg(bin: string, args: string[], signal: AbortSignal | null = null, onProgress: ((seconds: number) => void) | null = null): Promise<void> {
  if (signal?.aborted) throw new AbortedError();
  const proc = await Subprocess.call({
    command: bin,
    arguments: ['-nostdin', '-progress', 'pipe:2', '-nostats', ...args],
    stderr: 'pipe',
  });
  const stop = (): void => {
    try {
      proc.kill(0);
    } catch {
      /* already gone */
    }
  };
  signal?.addEventListener('abort', stop, { once: true });
  let tail = '';
  let pending = '';
  const drain = async (pipe: any, each: (chunk: string) => void): Promise<void> => {
    for (;;) {
      const chunk = await pipe.readString();
      if (!chunk) return;
      each(chunk);
    }
  };
  // Both pipes must be read or a chatty child blocks on a full pipe.
  const out = drain(proc.stdout, () => undefined);
  const err = drain(proc.stderr, (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m) onProgress?.(Number(m[1]) / 1e6);
      else if (!/^[a-z_0-9]+=/.test(line)) tail = (tail + line + '\n').slice(-2000);
    }
  });
  const { exitCode } = await proc.wait();
  await Promise.all([out, err]).catch(() => undefined);
  signal?.removeEventListener('abort', stop);
  if (signal?.aborted) throw new AbortedError();
  if (exitCode !== 0) throw new Error(`ffmpeg exited with ${exitCode}: ${tail.trim()}`);
}
