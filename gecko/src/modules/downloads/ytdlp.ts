// yt-dlp, for video sites that do not play from a file address (YouTube streams with SABR/UMP POST
// requests: nothing in the page's traffic can be downloaded). Installed only when the person asks
// (Settings › Video downloads), used only when the person asks to download a video.
//
// Tools (installed in %LOCALAPPDATA%\Deer\tools, or the pref vitre.tools.installDir; a pair installed
// before the rename in %LOCALAPPDATA%\Vitre\tools is used where it is and never moved or deleted; an
// update installs both into Deer's folder, which is looked at first from then on):
//   yt-dlp.exe  https://github.com/yt-dlp/yt-dlp/releases/latest: SHA2-256SUMS lists "<sha256>  yt-dlp.exe"
//   deno.exe    https://github.com/denoland/deno/releases/latest: deno-x86_64-pc-windows-msvc.zip and its
//               .zip.sha256sum (PowerShell Get-FileHash text); yt-dlp needs a JavaScript runtime for
//               YouTube since 2025.11 (--js-runtimes deno:<path>).
// Nothing is installed when a fingerprint does not match.
//
// Use:
//   probe(pageUrl)  yt-dlp -J: title, duration, live, DRM and formats -> a VideoOffer (mode 'ytdlp');
//   YtdlpTransfer   yt-dlp -f <video>+<audio> -o <path>: progress from --progress-template lines,
//                   ffmpeg (Deer's) joins the parts; pause = stop the process, resume = run it again
//                   (yt-dlp continues its .part files).
// No cookies are given to yt-dlp: it downloads what anyone can watch without signing in.
//
// For tests (prefs): vitre.tools.installDir; vitre.localAppData (stands in for %LOCALAPPDATA%, both
// folders; ffmpeg-install.ts); vitre.tools.source.ytdlp / vitre.tools.source.deno (base URLs
// of a release, ending with "/"); vitre.tools.ytdlpCommand = JSON array [program, ...first arguments]
// replacing yt-dlp.exe (a stand-in script).
//
// Firefox internals: resource://gre/modules/Subprocess.sys.mjs, Downloads.sys.mjs (createDownload),
// nsIZipReader.
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';
import { Subprocess } from 'resource://gre/modules/Subprocess.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { deerFolder, fetchText, oldFolder, sha256 } from './ffmpeg-install';
import { AbortedError, DownloadError } from './net';
import { fileFor } from './partfile';
import type { VideoOffer, VideoOption } from './types';

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const DENO_RELEASE = 'https://github.com/denoland/deno/releases/latest/download/';
const DENO_ZIP = 'deno-x86_64-pc-windows-msvc.zip';

function pref(name: string): string {
  try {
    return Services.prefs.getStringPref(name, '');
  } catch {
    return '';
  }
}

function exists(path: string): boolean {
  try {
    const f = fileFor(path);
    return f.exists() && f.isFile();
  } catch {
    return false;
  }
}

/** Where yt-dlp and Deno are installed: %LOCALAPPDATA%\Deer\tools (a test can move it). */
export function toolsDir(): string {
  return pref('vitre.tools.installDir') || deerFolder('tools');
}

/** The folder installed before the rename, %LOCALAPPDATA%\Vitre\tools: read, never written. */
export function oldToolsDir(): string {
  return oldFolder('tools');
}

/** The yt-dlp command ([program, ...first arguments]) and Deno, or null when they are not installed. */
export function ytdlpTools(): { command: string[]; deno: string } | null {
  const custom = pref('vitre.tools.ytdlpCommand');
  if (custom) {
    try {
      const cmd = JSON.parse(custom);
      if (Array.isArray(cmd) && cmd.length && cmd.every((x) => typeof x === 'string')) return { command: cmd, deno: '' };
    } catch {
      /* fall through */
    }
  }
  // Deer's folder first: once an update has put a pair there, the old folder is no longer used.
  for (const dir of [toolsDir(), oldToolsDir()]) {
    const ytdlp = PathUtils.join(dir, 'yt-dlp.exe');
    const deno = PathUtils.join(dir, 'deno.exe');
    if (exists(ytdlp) && exists(deno)) return { command: [ytdlp], deno };
  }
  return null;
}

// ---- running yt-dlp ----

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** The arguments every run gets: no user config, Deer's JavaScript runtime, UTF-8 output. */
function base(tools: { deno: string }): string[] {
  const args = ['--no-config', '--no-playlist', '--no-colors', '--encoding', 'utf-8'];
  if (tools.deno) args.push('--js-runtimes', `deno:${tools.deno}`);
  return args;
}

/** The last ERROR line yt-dlp printed, without its prefix (for the person). */
function lastError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => /^ERROR:/.test(l));
  const last = lines[lines.length - 1] ?? stderr.trim().split(/\r?\n/).pop() ?? '';
  return last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:]*:\s*)?/, '').trim();
}

async function readAll(pipe: any, onChunk?: (s: string) => void): Promise<string> {
  let all = '';
  for (;;) {
    const s: string = await pipe.readString();
    if (!s) return all;
    all += s;
    onChunk?.(s);
  }
}

async function run(args: string[], opts: { signal?: AbortSignal | null; onLine?: (line: string) => void; timeoutMs?: number } = {}): Promise<Ran> {
  const tools = ytdlpTools();
  if (!tools) throw new DownloadError('yt-dlp is not installed (Settings › Video downloads).');
  const [command, ...first] = tools.command;
  const proc = await Subprocess.call({
    command,
    arguments: [...first, ...base(tools), ...args],
    environment: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    environmentAppend: true,
    stderr: 'pipe',
  });
  let killed = false;
  const kill = (): void => {
    killed = true;
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  };
  opts.signal?.addEventListener('abort', kill, { once: true });
  const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : 0;
  let pending = '';
  const outP = readAll(proc.stdout, (s) => {
    if (!opts.onLine) return;
    pending += s;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const l of lines) opts.onLine(l);
  });
  const errP = readAll(proc.stderr);
  const [stdout, stderr] = await Promise.all([outP, errP]);
  const { exitCode } = await proc.wait();
  opts.signal?.removeEventListener('abort', kill);
  if (timer) clearTimeout(timer);
  if (opts.signal?.aborted) throw new AbortedError();
  if (killed) throw new DownloadError('yt-dlp took too long to answer.');
  return { code: exitCode, stdout, stderr };
}

// ---- what a page offers ----

interface Format {
  format_id: string;
  ext: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
  has_drm?: boolean | string;
  protocol?: string;
  language?: string;
  format_note?: string;
}

const has = (c?: string): boolean => !!c && c !== 'none';
/** The format's size: given, else estimated from its bitrate (kbit/s) and the video's length. */
const size = (f: Format | undefined, duration = 0): number => (f ? Number(f.filesize || f.filesize_approx) || (f.tbr && duration ? Math.round((f.tbr * 1000 * duration) / 8) : 0) : 0);

export { ytdlpFirst } from './sites';

/**
 * yt-dlp's offer for a page: one option per video height (the best format of that height with the
 * audio that suits it), and the best audio alone. Without ffmpeg only formats that already carry
 * both picture and sound are offered.
 */
export async function probe(pageUrl: string, base: VideoOffer, muxer: boolean, fit: number): Promise<VideoOffer> {
  const r = await run(['-J', '--no-warnings', pageUrl], { timeoutMs: 60000 });
  if (r.code !== 0) {
    const why = lastError(r.stderr);
    if (/drm/i.test(why)) return { ...base, state: 'protected', key: `ytdlp|${pageUrl}` };
    console.warn('Deer downloads: yt-dlp found nothing', why);
    return { ...base, reason: why || 'yt-dlp found no video on this page' };
  }
  let info: any;
  try {
    info = JSON.parse(r.stdout);
  } catch {
    return { ...base, reason: 'yt-dlp gave an answer Deer could not read' };
  }
  const key = `ytdlp|${info.webpage_url || pageUrl}`;
  const offer: VideoOffer = { ...base, key, title: String(info.title || base.title || '').trim(), duration: Number(info.duration) || base.duration };
  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') return { ...offer, state: 'live' };
  const formats: Format[] = Array.isArray(info.formats) ? info.formats : [];
  const dur = Number(info.duration) || 0;
  const clean = formats.filter((f) => !f.has_drm && !/^(mhtml|m3u8_native_storyboards)$/.test(String(f.protocol)) && f.ext !== 'mhtml');
  if (!clean.length) return formats.some((f) => f.has_drm) ? { ...offer, state: 'protected' } : { ...offer, reason: 'no format yt-dlp can download' };

  const audios = clean.filter((f) => has(f.acodec) && !has(f.vcodec)).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  // The original-language track first (YouTube adds dubbed ones marked in format_note).
  const original = audios.filter((a) => !/dubbed|descriptive/i.test(a.format_note ?? ''));
  const audioFor = (ext: string): Format | undefined => {
    const pool = original.length ? original : audios;
    return ext === 'mp4' ? (pool.find((a) => a.ext === 'm4a') ?? pool[0]) : (pool.find((a) => a.ext === 'webm') ?? pool[0]);
  };
  const options: VideoOption[] = [];
  const opt = (o: Partial<VideoOption> & Pick<VideoOption, 'id' | 'group' | 'label'>): VideoOption =>
    ({ detail: '', container: '', bytes: 0, height: 0, url: pageUrl, mode: 'ytdlp', variantUrl: '', audioUrl: '', dashVideo: '', dashAudio: '', needsMux: false, ytdlpFormat: '', ytdlpExt: '', ...o }) as VideoOption;

  if (muxer && audios.length) {
    const videos = clean.filter((f) => has(f.vcodec) && !has(f.acodec) && (f.height ?? 0) > 0);
    const heights = [...new Set(videos.map((v) => v.height as number))].sort((a, b) => b - a);
    for (const h of heights) {
      const at = videos.filter((v) => v.height === h);
      // Plain H.264 MP4 plays everywhere; above 1080p sites only have VP9/AV1, kept in WEBM or MP4 as given.
      const pick = at.filter((v) => v.ext === 'mp4' && /^(avc1|h264)/i.test(v.vcodec ?? '')).sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] ?? at.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
      const audio = audioFor(pick.ext === 'mp4' ? 'mp4' : 'webm');
      if (!audio) continue;
      const ext = pick.ext === 'mp4' && audio.ext === 'm4a' ? 'mp4' : pick.ext === 'webm' && audio.ext === 'webm' ? 'webm' : 'mkv';
      const fps = pick.fps && pick.fps > 30 ? ` ${Math.round(pick.fps)}` : '';
      options.push(opt({ id: `y${h}${fps}`, group: 'video', label: `${h}p${fps}`, detail: h >= 2160 ? '4K' : h >= 1440 ? '2K' : '', container: ext.toUpperCase(), bytes: size(pick, dur) + size(audio, dur), height: h, ytdlpFormat: `${pick.format_id}+${audio.format_id}`, ytdlpExt: ext, needsMux: true }));
    }
  }
  if (!options.length) {
    // No joining possible (no ffmpeg) or no separate streams: formats that carry both.
    const both = clean.filter((f) => has(f.vcodec) && has(f.acodec) && (f.height ?? 0) > 0 && /^https?$/.test(String(f.protocol ?? 'https'))).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr || 0) - (a.tbr || 0));
    const seen = new Set<number>();
    for (const f of both) {
      if (seen.has(f.height as number)) continue;
      seen.add(f.height as number);
      options.push(opt({ id: `y${f.height}`, group: 'video', label: `${f.height}p`, container: f.ext.toUpperCase(), bytes: size(f, dur), height: f.height, ytdlpFormat: f.format_id, ytdlpExt: f.ext }));
    }
  }
  const audio = audioFor('mp4');
  if (audio) {
    const ext = audio.ext === 'webm' ? 'weba' : audio.ext;
    options.push(opt({ id: 'ya', group: 'audio', label: ext.toUpperCase(), detail: audio.abr ? `${Math.round(audio.abr)} kbps` : '', container: ext.toUpperCase(), bytes: size(audio, dur), ytdlpFormat: audio.format_id, ytdlpExt: audio.ext }));
  }
  if (!options.length) return { ...offer, reason: 'no format yt-dlp can download' };
  const videos = options.filter((o) => o.group === 'video');
  const suggested = (videos.find((o) => o.height && o.height <= fit) ?? videos[videos.length - 1] ?? options[0]).id;
  return { ...offer, state: 'ok', options, suggested };
}

// ---- downloading ----

export interface YtdlpState {
  pageUrl: string;
  format: string;
  ext: string;
  audioOnly: boolean;
  /** The picker's size estimate. */
  expected: number;
}

/** The files yt-dlp leaves while it works on `path` (parts of each format, its .ytdl notes, unmerged formats). */
export async function ytdlpParts(path: string): Promise<string[]> {
  const dir = PathUtils.parent(path);
  if (!dir) return [];
  const stemName = PathUtils.filename(path).replace(/\.[^.]+$/, '');
  let children: string[] = [];
  try {
    children = await IOUtils.getChildren(dir);
  } catch {
    return [];
  }
  return children.filter((c) => {
    const name = PathUtils.filename(c);
    if (!name.startsWith(stemName + '.')) return false;
    const rest = name.slice(stemName.length);
    return /\.part(-Frag\d+)?$/i.test(rest) || /\.ytdl$/i.test(rest) || /^\.f[\w-]+\.\w+$/i.test(rest) || /\.temp\.\w+$/i.test(rest);
  });
}

export class YtdlpTransfer {
  received = 0;
  /** Connections in use, for the panel: yt-dlp's process is one. */
  live = 0;
  phase: '' | 'merging' = '';
  /** Bytes of the formats already finished (video, then audio). */
  private done = 0;
  private current = 0;
  private total = 0;

  constructor(
    readonly state: YtdlpState,
    private env: { onBytes: (n: number) => void; ffmpeg: () => Promise<{ path: string | null }>; connections: () => number }
  ) {}

  get estimate(): number {
    return Math.max(this.state.expected, this.total, this.received);
  }

  async download(path: string, signal: AbortSignal): Promise<void> {
    const ff = await this.env.ffmpeg();
    const args = ['-f', this.state.format, '-o', path.replace(/%/g, '%%'), '--newline', '--no-mtime', '--continue', '-N', String(Math.max(1, Math.min(8, this.env.connections()))),
      '--progress-template', 'download:VITRE %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s'];
    if (ff.path) args.push('--ffmpeg-location', ff.path);
    if (this.state.format.includes('+')) args.push('--merge-output-format', this.state.ext);
    args.push(this.state.pageUrl);
    this.live = 1;
    let last = 0;
    const onLine = (line: string): void => {
      const m = /^VITRE (\w+) (\S+) (\S+) (\S+)/.exec(line);
      if (m) {
        const got = Number(m[2]) || 0;
        const total = Number(m[3]) || Number(m[4]) || 0;
        if (got < last) {
          // The next format started (video done, now its audio).
          this.done += last;
        }
        last = got;
        this.current = got;
        if (total) this.total = Math.max(this.total, this.done + total);
        const before = this.received;
        this.received = this.done + this.current;
        if (this.received > before) this.env.onBytes(this.received - before);
        if (m[1] === 'finished') {
          this.done += got;
          last = 0;
          this.current = 0;
        }
        return;
      }
      if (/^\[Merger\]|^\[ExtractAudio\]|^\[FixupM/.test(line)) this.phase = 'merging';
    };
    try {
      const r = await run(args, { signal, onLine });
      if (r.code !== 0) throw new DownloadError(lastError(r.stderr) || 'yt-dlp stopped with an error.');
    } finally {
      this.live = 0;
    }
    if (!(await IOUtils.exists(path))) throw new DownloadError('yt-dlp finished but the file is not there.');
  }
}

// ---- installing ----

export type ToolsPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'unpacking' | 'done' | 'failed' | 'cancelled';

export interface ToolsState {
  phase: ToolsPhase;
  /** 'yt-dlp' or 'Deno' while it works on one. */
  tool: string;
  received: number;
  total: number;
  error: string;
}

let toolsState: ToolsState = { phase: 'idle', tool: '', received: 0, total: 0, error: '' };
const listeners = new Set<(s: ToolsState) => void>();
let installing: Promise<void> | null = null;
let cancelled = false;
let active: any = null;

function setState(patch: Partial<ToolsState>): void {
  toolsState = { ...toolsState, ...patch };
  for (const fn of listeners) {
    try {
      fn(toolsState);
    } catch (e) {
      console.error('Deer tools install listener', e);
    }
  }
}

export function toolsInstallState(): ToolsState {
  return toolsState;
}

export function onToolsInstall(fn: (s: ToolsState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cancelToolsInstall(): void {
  if (!installing) return;
  cancelled = true;
  active?.cancel?.().catch?.(() => undefined);
}

class Cancelled extends Error {}

function stopIfCancelled(): void {
  if (cancelled) throw new Cancelled('cancelled');
}

/** The SHA-256 a release lists for `name`: "<hex>  name" lines, or PowerShell's "Hash : <HEX>" text. */
export function listedHash(text: string, name: string): string {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  const ps = /Hash\s*:\s*([0-9a-f]{64})/i.exec(text);
  return ps ? ps[1].toLowerCase() : '';
}

async function fetchTo(url: string, path: string, tool: string): Promise<void> {
  await IOUtils.remove(path, { ignoreAbsent: true });
  setState({ phase: 'downloading', tool, received: 0, total: 0 });
  const download = await Downloads.createDownload({ source: { url, isPrivate: false }, target: { path } });
  active = download;
  download.onchange = () => {
    if (toolsState.phase === 'downloading') setState({ received: download.currentBytes || 0, total: download.totalBytes || 0 });
  };
  try {
    await download.start();
  } catch {
    stopIfCancelled();
    throw new Error(`the ${tool} download stopped` + (download.error?.message ? `: ${download.error.message}` : ''));
  } finally {
    active = null;
    await download.finalize(false).catch(() => undefined);
  }
  stopIfCancelled();
}

async function verified(path: string, want: string, tool: string): Promise<void> {
  if (!want) throw new Error(`${tool} is not in its release's checksum list`);
  setState({ phase: 'verifying', tool });
  const got = await sha256(path, () => cancelled);
  if (got !== want) throw new Error(`${tool} did not match its published fingerprint, so it was not installed`);
}

async function installAll(force: boolean): Promise<void> {
  const dir = toolsDir();
  const ytSource = pref('vitre.tools.source.ytdlp') || YTDLP_RELEASE;
  const denoSource = pref('vitre.tools.source.deno') || DENO_RELEASE;
  const ytdlp = PathUtils.join(dir, 'yt-dlp.exe');
  const deno = PathUtils.join(dir, 'deno.exe');
  const temp: string[] = [];
  setState({ phase: 'checking', tool: '', received: 0, total: 0, error: '' });
  await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
  try {
    // yt-dlp: one file.
    const ytHash = listedHash(await fetchText(ytSource + 'SHA2-256SUMS'), 'yt-dlp.exe');
    stopIfCancelled();
    const ytTmp = ytdlp + '.download';
    temp.push(ytTmp);
    await fetchTo(ytSource + 'yt-dlp.exe', ytTmp, 'yt-dlp');
    await verified(ytTmp, ytHash, 'yt-dlp');

    // Deno: a zip with deno.exe (kept when it is there already, unless updating).
    let denoTmp = '';
    if (force || !exists(deno)) {
      const denoHash = listedHash(await fetchText(denoSource + DENO_ZIP + '.sha256sum'), DENO_ZIP);
      stopIfCancelled();
      const zip = PathUtils.join(dir, 'deno-download.zip');
      temp.push(zip);
      await fetchTo(denoSource + DENO_ZIP, zip, 'Deno');
      await verified(zip, denoHash, 'Deno');
      setState({ phase: 'unpacking', tool: 'Deno' });
      await new Promise((r) => setTimeout(r, 0));
      denoTmp = deno + '.download';
      temp.push(denoTmp);
      const reader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
      reader.open(fileFor(zip));
      try {
        const names: string[] = [];
        const all = reader.findEntries(null);
        while (all.hasMore()) names.push(all.getNext());
        const entry = names.find((n) => /(^|\/)deno\.exe$/i.test(n));
        if (!entry) throw new Error('the Deno download has no deno.exe in it');
        await IOUtils.remove(denoTmp, { ignoreAbsent: true });
        reader.extract(entry, fileFor(denoTmp));
      } finally {
        reader.close();
      }
      // The zip marks deno.exe read-only, which would stop the next update from replacing it.
      await IOUtils.setWindowsAttributes(denoTmp, { readOnly: false }).catch(() => undefined);
    }
    stopIfCancelled();
    // Put both in place (the old ones may be in use by a running download: say so).
    try {
      await IOUtils.move(ytTmp, ytdlp);
      if (denoTmp) {
        if (exists(deno)) await IOUtils.setWindowsAttributes(deno, { readOnly: false }).catch(() => undefined);
        await IOUtils.move(denoTmp, deno);
      }
    } catch {
      throw new Error('yt-dlp or Deno is in use by a download; let it finish and try again');
    }
    setState({ phase: 'done', tool: '' });
  } catch (e) {
    if (e instanceof Cancelled || cancelled) setState({ phase: 'cancelled' });
    else setState({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    for (const t of temp) await IOUtils.remove(t, { ignoreAbsent: true }).catch(() => undefined);
  }
}

/** Download, check and put in place yt-dlp (always) and Deno (when missing, or always with `force`). */
export function installTools(force = false): Promise<void> {
  if (installing) return installing;
  cancelled = false;
  installing = installAll(force).finally(() => {
    installing = null;
  });
  return installing;
}

/** "yt-dlp 2026.08.19 · Deno 2.9.7", or '' when they are not installed. */
export async function toolsVersion(): Promise<string> {
  const tools = ytdlpTools();
  if (!tools) return '';
  try {
    const yt = (await run(['--version'], { timeoutMs: 20000 })).stdout.trim().split(/\r?\n/).pop() ?? '';
    let dv = '';
    if (tools.deno) {
      const p = await Subprocess.call({ command: tools.deno, arguments: ['--version'], stderr: 'stdout' });
      const out = await readAll(p.stdout);
      await p.wait();
      dv = /deno\s+([\d.]+)/i.exec(out)?.[1] ?? '';
    }
    return `yt-dlp ${yt}${dv ? ` · Deno ${dv}` : ''}`;
  } catch {
    return 'yt-dlp';
  }
}
