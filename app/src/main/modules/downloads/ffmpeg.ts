// ffmpeg, when there is one: Vitre's own copy beside the app, or one on PATH. Only ever used to
// change the container (-c copy); nothing is re-encoded.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AbortedError } from './net';

let cache: { at: number; bin: string | null } | null = null;

export function findFfmpeg(): string | null {
  if (cache && Date.now() - cache.at < 60_000) return cache.bin;
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  const dirs = [resources, resources && path.join(resources, 'ffmpeg'), path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)];
  let bin: string | null = null;
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir.replace(/^"|"$/g, ''), name);
    try {
      if (fs.statSync(candidate).isFile()) {
        bin = candidate;
        break;
      }
    } catch {
      /* not here */
    }
  }
  cache = { at: Date.now(), bin };
  return bin;
}

export function runFfmpeg(bin: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    child.stderr?.on('data', (d: Buffer) => {
      tail = (tail + d.toString()).slice(-2000);
    });
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', (err) => {
      signal.removeEventListener('abort', stop);
      reject(err);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new AbortedError());
      else if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${tail.trim()}`));
    });
  });
}
