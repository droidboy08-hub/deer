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
//   Phase 8 of spikes/downloader/RESUME-DESIGN.md (2.7, 5.4, G1 step 2):
//   formatOf()      the chosen formats as the download records them at the start (height, fps, ext,
//                   audioOnly, filesize), carried from the picker (VideoOption.ytdlpFormats);
//   extract()       -J again (as probe() runs it) at a resume, an attempt of the schedule or Retry;
//   judge()         the same format id with the same reported filesize continues (--continue); another
//                   filesize is another file; a format that is gone is picked again by its height, ext and
//                   kind (sound alone, picture alone, both), then the nearest bitrate;
//   partsOf()       which of ytdlpParts() belong to one format (what can't be continued is set aside);
//   formatsOf()     a page media file's fresh addresses: the https formats of its page whose filesize is
//                   the file's (G1 step 2), each then proven by the engine.
//   A refused download (HTTP Error 403...) is YtdlpRefusedError: Link expired for a row with saved parts.
//   Review of Phase 8:
//   - a format yt-dlp only estimates (no filesize: YouTube's HLS formats) is compared by its estimate
//     (filesize_approx), bitrate and the video's length, recorded at the start; nothing to compare at all is R7
//     (RESUME-DESIGN.md 2.4: a fresh start under 1 MiB saved, asked above);
//   - extract() is shared: callers of one page join the -J under way, the answer stands for a while for those that
//     may reuse it, and the background steps' runs (the schedule's attempts, G1 step 2) go BACKGROUND_RUNS at a time;
//   - a re-pick the row's file type can't hold (H.264 into WEBM) is saved as one that holds it (containerFor()).
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
import { AbortedError, AddressRefusedError, DownloadError, REFUSED_STATUS } from './net';
import { fileFor } from './partfile';
import { sizeText } from './proof';
import type { StreamRung, VideoOffer, VideoOption, YtdlpFormat } from './types';

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
  // Stopped before it began (a Pause during a resume's check, Phase 8): never started, as its abort listener would
  // never hear an abort that already happened.
  if (opts.signal?.aborted) throw new AbortedError();
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
  /** HLS or DASH formats: the master playlist or manifest the format comes from. */
  manifest_url?: string;
}

const has = (c?: string): boolean => !!c && c !== 'none';
/** The format's size: given, else estimated from its bitrate (kbit/s) and the video's length. */
const size = (f: Format | undefined, duration = 0): number => (f ? Number(f.filesize || f.filesize_approx) || (f.tbr && duration ? Math.round((f.tbr * 1000 * duration) / 8) : 0) : 0);
/** What yt-dlp can download of a page's formats: no DRM, no storyboards (probe()'s rule). */
const usable = (f: Format): boolean => !f.has_drm && !/^(mhtml|m3u8_native_storyboards)$/.test(String(f.protocol)) && f.ext !== 'mhtml';
/** A sound track in another language or for the blind (YouTube marks them in format_note): the original comes first. */
const dubbed = (f: Format): boolean => /dubbed|descriptive/i.test(f.format_note ?? '');

/**
 * A format as a download records it when it starts (RESUME-DESIGN.md 5.4, Phase 8): its id, height, fps and ext,
 * whether it is sound alone or carries picture and sound, the exact size yt-dlp reported (0: it gave only an
 * estimate) and its bitrate (kbit/s; abr for sound alone). A resume compares it (2.7) and re-picks by it. Review of
 * Phase 8: also yt-dlp's estimate (filesize_approx), the video's length (s) the same -J reported (`duration`), and
 * the codecs, which tell the file types that can hold the format (containerFor()).
 */
export function formatOf(f: Format, duration = 0): YtdlpFormat {
  return {
    id: String(f.format_id ?? ''),
    ext: String(f.ext ?? ''),
    height: Number(f.height) || 0,
    fps: Number(f.fps) || 0,
    audioOnly: has(f.acodec) && !has(f.vcodec),
    video: has(f.vcodec),
    audio: has(f.acodec),
    filesize: Number(f.filesize) || 0,
    tbr: Number(f.tbr || f.abr) || 0,
    approx: Number(f.filesize_approx) || 0,
    duration: Number(duration) || 0,
    vcodec: has(f.vcodec) ? String(f.vcodec) : '',
    acodec: has(f.acodec) ? String(f.acodec) : '',
  };
}

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
  const clean = formats.filter(usable);
  if (!clean.length) return formats.some((f) => f.has_drm) ? { ...offer, state: 'protected' } : { ...offer, reason: 'no format yt-dlp can download' };

  const audios = clean.filter((f) => has(f.acodec) && !has(f.vcodec)).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  // The original-language track first (YouTube adds dubbed ones marked in format_note).
  const original = audios.filter((a) => !dubbed(a));
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
      // Phase 8 (5.4): the chosen formats as yt-dlp reports them now, recorded by the download at its start.
      options.push(opt({ id: `y${h}${fps}`, group: 'video', label: `${h}p${fps}`, detail: h >= 2160 ? '4K' : h >= 1440 ? '2K' : '', container: ext.toUpperCase(), bytes: size(pick, dur) + size(audio, dur), height: h, ytdlpFormat: `${pick.format_id}+${audio.format_id}`, ytdlpExt: ext, needsMux: true, ytdlpFormats: [formatOf(pick, dur), formatOf(audio, dur)] }));
    }
  }
  if (!options.length) {
    // No joining possible (no ffmpeg) or no separate streams: formats that carry both.
    const both = clean.filter((f) => has(f.vcodec) && has(f.acodec) && (f.height ?? 0) > 0 && /^https?$/.test(String(f.protocol ?? 'https'))).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr || 0) - (a.tbr || 0));
    const seen = new Set<number>();
    for (const f of both) {
      if (seen.has(f.height as number)) continue;
      seen.add(f.height as number);
      options.push(opt({ id: `y${f.height}`, group: 'video', label: `${f.height}p`, container: f.ext.toUpperCase(), bytes: size(f, dur), height: f.height, ytdlpFormat: f.format_id, ytdlpExt: f.ext, ytdlpFormats: [formatOf(f, dur)] }));
    }
  }
  const audio = audioFor('mp4');
  if (audio) {
    const ext = audio.ext === 'webm' ? 'weba' : audio.ext;
    options.push(opt({ id: 'ya', group: 'audio', label: ext.toUpperCase(), detail: audio.abr ? `${Math.round(audio.abr)} kbps` : '', container: ext.toUpperCase(), bytes: size(audio, dur), ytdlpFormat: audio.format_id, ytdlpExt: audio.ext, ytdlpFormats: [formatOf(audio, dur)] }));
  }
  if (!options.length) return { ...offer, reason: 'no format yt-dlp can download' };
  const videos = options.filter((o) => o.group === 'video');
  const suggested = (videos.find((o) => o.height && o.height <= fit) ?? videos[videos.length - 1] ?? options[0]).id;
  return { ...offer, state: 'ok', options, suggested };
}

/**
 * RESUME-DESIGN.md G2 step 3 (Phase 6): a stream download's page asked through yt-dlp for a fresh manifest of
 * the same quality: the manifest_url of an HLS or DASH format of the same height (an audio-only one for an
 * audio download), without cookies (ytdlp.ts header). Null when yt-dlp is not installed, finds nothing, or
 * has no such format; the stream's own proof then decides whether what it found is the same video. Review of
 * Phase 8: through the shared -J (extract()): the streams of one page join one run, and read its answer for
 * HEARD_FRESH; an attempt of the schedule (`background`) waits its turn.
 */
export async function manifestFor(pageUrl: string, rung: StreamRung | undefined, audioOnly: boolean, signal: AbortSignal, background = false): Promise<{ url: string; format: 'hls' | 'dash' } | null> {
  if (!ytdlpTools() || !/^https?:/i.test(pageUrl)) return null;
  const info = await extract(pageUrl, signal, { maxAge: HEARD_FRESH, background }).catch(() => null);
  if (!info) return null;
  const formats = info.formats;
  const streams = formats.filter((f) => !f.has_drm && typeof f.manifest_url === 'string' && /^https?:/i.test(f.manifest_url) && /^(m3u8|m3u8_native|http_dash_segments)$/.test(String(f.protocol)));
  const want = audioOnly ? streams.filter((f) => !has(f.vcodec)) : streams.filter((f) => has(f.vcodec) && (!rung?.height || f.height === rung.height));
  const pick = want.sort((a, b) => Math.abs((a.tbr || 0) * 1000 - (rung?.bandwidth || 0)) - Math.abs((b.tbr || 0) * 1000 - (rung?.bandwidth || 0)))[0];
  if (!pick?.manifest_url) return null;
  return { url: pick.manifest_url, format: /dash/.test(String(pick.protocol)) ? 'dash' : 'hls' };
}

// ---- a resume asks again (RESUME-DESIGN.md 2.7, 3 G3, G1 step 2; Phase 8) ----

/**
 * yt-dlp was refused the video's own addresses (HTTP Error 401, 403, 404, 410 or 451: RESUME-DESIGN.md 2.4 R1).
 * classify() reads it as 'refused', so a row with saved parts pauses as Link expired; the sentence stays yt-dlp's,
 * as before (a row with nothing saved fails with it).
 */
export class YtdlpRefusedError extends AddressRefusedError {
  constructor(status: number, why: string) {
    super(status, null, 'ytdlp');
    this.message = why;
  }
}

/** What a yt-dlp run that failed means: a refusal (YtdlpRefusedError) or its own sentence, as before Phase 8. */
function failure(stderr: string, fallback: string): Error {
  const why = lastError(stderr) || fallback;
  const status = Number(/HTTP Error (\d{3})/i.exec(why)?.[1] || 0);
  return REFUSED_STATUS.has(status) ? new YtdlpRefusedError(status, why) : new DownloadError(why);
}

/** What yt-dlp -J said of a page (Phase 8): its formats, the video's length (s, 0 when it gave none) and when it answered. */
export interface YtdlpInfo {
  formats: Format[];
  duration: number;
  at: number;
}

/** How a caller may share yt-dlp's -J of a page (extract(); review of Phase 8). */
export interface AskOptions {
  /** What yt-dlp said of the page (or how it failed) this recently (ms) is used instead of asking again; 0: ask. */
  maxAge?: number;
  /** A step out of sight (the schedule's attempts, G1 step 2): a new run waits its turn, BACKGROUND_RUNS at a time. */
  background?: boolean;
  /** Asked right before a new run starts, once it is this caller's turn: false gives up (a site's budget). */
  mayRun?: () => boolean;
}

/**
 * Review of Phase 8: at most this many -J runs the background steps started run at once (each is a whole yt-dlp,
 * with Deno for YouTube); more wait their turn, holding no download slot. A run under way for the same page is
 * joined instead. Runs a download's own check starts are not counted (the download queue limits them).
 */
export const BACKGROUND_RUNS = 2;
/** What a page's -J said stands for this long for a caller that may reuse it (the rows of one page: maxAge). */
export const HEARD_FRESH = 60 * 1000;
/** Answers are forgotten this long after they came. */
const HEARD_KEEP = 10 * 60 * 1000;

/** A -J run under way for a page: the callers waiting for it, and its stop (when every caller gave up). */
interface Asking {
  key: string;
  promise: Promise<YtdlpInfo>;
  ac: AbortController;
  users: number;
}

const heard = new Map<string, { at: number; info?: YtdlpInfo; error?: unknown }>();
const asking = new Map<string, Asking>();
let running = 0;
const turns: Array<() => void> = [];

/** A caller gave up before its turn: a site's budget said no (AskOptions.mayRun). */
class Skipped extends Error {}

/** A page as its answers are shared: its address without the fragment. */
const pageKey = (pageUrl: string): string => pageUrl.replace(/#.*$/, '');

/** Tests: forget every page's answer (a section that watches a step ask yt-dlp itself). */
export function forgetHeard(): void {
  heard.clear();
}

function remember(key: string, entry: { at: number; info?: YtdlpInfo; error?: unknown }): void {
  heard.set(key, entry);
  for (const [k, h] of heard) if (entry.at - h.at > HEARD_KEEP || h.at > entry.at + HEARD_KEEP) heard.delete(k);
}

/** A background step's turn to start a -J (BACKGROUND_RUNS at a time); AbortedError when `signal` stops the wait. */
function turn(signal: AbortSignal | null): Promise<void> {
  if (running < BACKGROUND_RUNS) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const go = (): void => {
      signal?.removeEventListener('abort', stop);
      running++;
      resolve();
    };
    const stop = (): void => {
      const i = turns.indexOf(go);
      if (i >= 0) turns.splice(i, 1);
      reject(new AbortedError());
    };
    turns.push(go);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function freeTurn(): void {
  running = Math.max(0, running - 1);
  turns.shift()?.();
}

/** A -J run for a page that callers join (join()); `done` when it ends (a background turn given back). */
function begin(key: string, pageUrl: string, done: (() => void) | null): Asking {
  const ac = new AbortController();
  const s: Asking = { key, ac, users: 0, promise: Promise.resolve({ formats: [], duration: 0, at: 0 }) };
  s.promise = (async (): Promise<YtdlpInfo> => {
    try {
      const r = await run(['-J', '--no-warnings', pageUrl], { signal: ac.signal, timeoutMs: 60000 });
      if (r.code !== 0) throw failure(r.stderr, 'yt-dlp found no video on this page');
      let info: any;
      try {
        info = JSON.parse(r.stdout);
      } catch {
        throw new DownloadError('yt-dlp gave an answer Deer could not read');
      }
      const out: YtdlpInfo = { formats: Array.isArray(info?.formats) ? info.formats : [], duration: Number(info?.duration) || 0, at: Date.now() };
      remember(key, { at: out.at, info: out });
      return out;
    } catch (e) {
      // A run every caller gave up on said nothing of the page.
      if (!ac.signal.aborted) remember(key, { at: Date.now(), error: e });
      throw e;
    } finally {
      if (asking.get(key) === s) asking.delete(key);
      done?.();
    }
  })();
  s.promise.catch(() => undefined);
  asking.set(key, s);
  return s;
}

/** The answer of run `s` for one caller; AbortedError when `signal` stops it (the run stops once nobody waits). */
function join(s: Asking, signal: AbortSignal | null): Promise<YtdlpInfo> {
  s.users++;
  return new Promise<YtdlpInfo>((resolve, reject) => {
    let left = false;
    const leave = (): boolean => {
      if (left) return false;
      left = true;
      s.users--;
      signal?.removeEventListener('abort', stop);
      return true;
    };
    const stop = (): void => {
      if (!leave()) return;
      // Nobody waits for it any more (a Pause during a check, Phase 8): it stops, and a later caller asks anew.
      if (s.users <= 0) {
        if (asking.get(s.key) === s) asking.delete(s.key);
        s.ac.abort();
      }
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', stop, { once: true });
    s.promise.then(
      (v) => {
        if (leave()) resolve(v);
      },
      (e) => {
        if (leave()) reject(e);
      }
    );
    if (signal?.aborted) stop();
  });
}

/**
 * A page's formats now: yt-dlp -J, as probe() runs it (no cookies: see the header). yt-dlp signs the addresses
 * again itself, so this is also how a yt-dlp row renews (Phase 8). Throws what the run means when it fails
 * (failure()), AbortedError when `signal` stopped it.
 * Review of Phase 8 (the reviewer saw one yt-dlp per waiting row, all at once, three for one page): callers of one
 * page join the run under way; `maxAge` lets a caller read what the page's last run said (or how it failed) that
 * recently; a `background` caller's new run waits its turn (BACKGROUND_RUNS at a time), and `mayRun` may still say
 * no then (Skipped). A run stops only when every caller gave up on it.
 */
export async function extract(pageUrl: string, signal: AbortSignal | null, opts: AskOptions = {}): Promise<YtdlpInfo> {
  const key = pageKey(pageUrl);
  const recent = (): YtdlpInfo | null => {
    const h = heard.get(key);
    const now = Date.now();
    if (!h || !opts.maxAge || h.at > now || now - h.at > opts.maxAge) return null;
    if (h.error) throw h.error;
    return h.info ?? null;
  };
  if (signal?.aborted) throw new AbortedError();
  const had = recent();
  if (had) return had;
  const under = asking.get(key);
  if (under) return join(under, signal);
  if (!opts.background) {
    if (opts.mayRun && !opts.mayRun()) throw new Skipped();
    return join(begin(key, pageUrl, null), signal);
  }
  await turn(signal);
  let mine = true;
  try {
    // Again now that it is this caller's turn: the page may have been asked meanwhile.
    const again = recent();
    if (again) return again;
    const other = asking.get(key);
    if (other) return await join(other, signal);
    if (signal?.aborted) throw new AbortedError();
    if (opts.mayRun && !opts.mayRun()) throw new Skipped();
    // The run gives the turn back when it ends.
    mine = false;
    return await join(begin(key, pageUrl, freeTurn), signal);
  } finally {
    if (mine) freeTurn();
  }
}

export type { Format as YtdlpInfoFormat };

/** Which part of a download a format is: sound alone, picture alone (joined with sound) or both. */
const kindOf = (f: YtdlpFormat): 'audio' | 'video' | 'both' | '' => (f.audioOnly ? 'audio' : f.video && f.audio ? 'both' : f.video ? 'video' : '');

/** "1080p", "1080p 60", "M4A": a format's quality as the picker labels it. */
function labelOf(f: YtdlpFormat): string {
  if (f.audioOnly || !f.height) return (f.ext === 'webm' ? 'weba' : f.ext || 'audio').toUpperCase();
  return `${f.height}p${f.fps > 30 ? ` ${Math.round(f.fps)}` : ''}`;
}

/**
 * The formats a row recorded at its start (5.4), or for a row from before Phase 8 what can be told of them: a
 * joined pair is picture then sound (probe() makes it so), one format is the sound alone or both; the height comes
 * from the row's quality ("1080p"), the exts from the file type it is joined into (mp4: mp4 and m4a; webm: both
 * webm). Their sizes are unknown (0), so nothing is ever called changed by them: they are `guessed`, and such a
 * row continues as every resume did before Phase 8 (compare()), its record made from what yt-dlp says now.
 */
export function recorded(state: YtdlpState, quality: string): YtdlpFormat[] {
  const ids = state.format.split('+').filter(Boolean);
  if (state.formats?.length === ids.length && state.formats.every((f, i) => f.id === ids[i])) return state.formats;
  const height = Number(/^(\d{3,4})p/.exec(quality || '')?.[1] || 0);
  const exts = state.ext === 'mp4' ? ['mp4', 'm4a'] : state.ext === 'webm' ? ['webm', 'webm'] : ['', ''];
  return ids.map((id, i) => {
    const old = state.formats?.find((f) => f.id === id);
    if (old) return old;
    const sound = ids.length > 1 ? i === 1 : state.audioOnly;
    const ext = ids.length > 1 ? exts[i] : state.ext;
    return { id, ext, height: sound ? 0 : height, fps: 0, audioOnly: sound, video: !sound, audio: sound || ids.length === 1, filesize: 0, tbr: 0, guessed: true };
  });
}

/**
 * A format that is gone, picked again from what the page offers now (RESUME-DESIGN.md 7 Phase 8): the same kind
 * (sound alone, picture alone, both), ext and height (any height for sound), the original-language sound first,
 * then the same fps and the nearest bitrate. `loose`: when nothing of its ext and height is offered, the same kind
 * at the nearest height (the lower on a tie), its ext first: another quality, which the row always asks about.
 */
function repick(old: YtdlpFormat, now: Format[], loose: boolean): Format | undefined {
  const kind = kindOf(old);
  let pool = now.filter((f) => usable(f) && (!kind || kindOf(formatOf(f)) === kind));
  if (kind === 'audio' && pool.some((f) => !dubbed(f))) pool = pool.filter((f) => !dubbed(f));
  if (!loose) pool = pool.filter((f) => (!old.ext || f.ext === old.ext) && (kind === 'audio' || !old.height || Number(f.height) === old.height));
  const rate = (f: Format): number => Number(f.tbr || f.abr) || 0;
  const away = (f: Format): number => Math.abs((Number(f.height) || 0) - old.height);
  return pool.sort(
    (a, b) =>
      (loose && kind !== 'audio' ? away(a) - away(b) || (Number(a.height) || 0) - (Number(b.height) || 0) : 0) ||
      (loose ? Number(b.ext === old.ext) - Number(a.ext === old.ext) : 0) ||
      Number((Number(b.fps) || 0) === old.fps) - Number((Number(a.fps) || 0) === old.fps) ||
      Math.abs(rate(a) - old.tbr) - Math.abs(rate(b) - old.tbr)
  )[0];
}

/** Two of yt-dlp's estimates or bitrates are the same within this share of the larger (its rounding). */
const NEAR = 0.001;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= NEAR * Math.max(a, b);

/** "0:19", "1:02:03": a video's length in the evidence ("was 4:05 long, now 4:07"). */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * RESUME-DESIGN.md 2.7 for one format of the same id, its record (`old`) against what yt-dlp says now. An exact
 * filesize on both sides decides, as before. Review of Phase 8 (a resume continued a format yt-dlp only estimates into
 * its old part over other bytes: YouTube's HLS formats report no filesize): otherwise another length of the video
 * (more than 1 s, as streamProof's 2.6), another estimate (filesize_approx) or another bitrate is another file, and
 * the same estimate or bitrate the same (a new encode of the same bitrate and length goes unseen, as one of the same
 * exact size does); nothing to compare at all is R7, UNKNOWN (2.4). A record a row from before Phase 8 never made
 * (`guessed`: recorded()) compares nothing and continues, as every resume did then.
 */
function compare(old: YtdlpFormat, now: YtdlpFormat): { verdict: 'same' | 'changed' | 'unknown'; size: boolean; why: string } {
  if (old.guessed) return { verdict: 'same', size: false, why: '' };
  if (old.filesize > 0 && now.filesize > 0) return { verdict: old.filesize === now.filesize ? 'same' : 'changed', size: true, why: '' };
  const d0 = old.duration || 0;
  const d1 = now.duration || 0;
  if (d0 > 0 && d1 > 0 && Math.abs(d0 - d1) > 1) return { verdict: 'changed', size: false, why: `was ${clock(d0)} long, now ${clock(d1)}` };
  let seen = false;
  const a0 = old.approx || 0;
  const a1 = now.approx || 0;
  if (a0 > 0 && a1 > 0) {
    if (!near(a0, a1)) return { verdict: 'changed', size: false, why: `was about ${sizeText(a0)}, now about ${sizeText(a1)}` };
    seen = true;
  }
  if (old.tbr > 0 && now.tbr > 0) {
    if (!near(old.tbr, now.tbr)) return { verdict: 'changed', size: false, why: `was ${Math.round(old.tbr)} kbit/s, now ${Math.round(now.tbr)} kbit/s` };
    seen = true;
  }
  return { verdict: seen ? 'same' : 'unknown', size: false, why: '' };
}

/** A format's record kept by a resume that found it the same: the start's values stay the reference, what is new is added. */
function kept(old: YtdlpFormat, now: YtdlpFormat): YtdlpFormat {
  if (old.guessed) return now;
  return { ...now, filesize: old.filesize || now.filesize, tbr: old.tbr || now.tbr, approx: old.approx || now.approx, duration: old.duration || now.duration };
}

/** Codecs ffmpeg joins into each file type yt-dlp may be asked to merge into (--merge-output-format). */
const MP4_VIDEO = /^(avc|h26[45]|hev|hvc|vp0?9|av0?1)/i;
const MP4_AUDIO = /^(mp4a|aac|opus|mp3|e?ac-?3|ec-?3|flac|alac)/i;
const WEBM_VIDEO = /^(vp0?[89]|av0?1)/i;
const WEBM_AUDIO = /^(opus|vorbis)/i;

/** Whether a file of type `ext` can hold format `f`: by its codecs, or for a record without them by its own ext. */
function holds(ext: string, f: YtdlpFormat): boolean {
  if (ext === 'mkv') return true;
  const v = f.video ? f.vcodec || '' : '';
  const a = f.audio ? f.acodec || '' : '';
  if (ext === 'webm') return (!f.video || (v ? WEBM_VIDEO.test(v) : f.ext === 'webm')) && (!f.audio || (a ? WEBM_AUDIO.test(a) : f.ext === 'webm'));
  if (ext === 'mp4') return (!f.video || (v ? MP4_VIDEO.test(v) : f.ext === 'mp4')) && (!f.audio || (a ? MP4_AUDIO.test(a) : f.ext === 'm4a' || f.ext === 'mp4'));
  return false;
}

/**
 * The file type a selection is saved as (review of Phase 8: a 1440p WEBM row re-picked to H.264 was asked to join it
 * into WEBM, which ffmpeg refuses, and a sound row given a picture kept ".m4a"). One format is saved as itself: its
 * own ext. A joined pair goes into the row's type `ext` when that holds both, otherwise into the type probe() gives
 * such a pair (MP4 for an MP4 picture with M4A sound, WEBM for both WEBM, else MKV, which holds anything).
 */
export function containerFor(ext: string, formats: YtdlpFormat[], joined: boolean): string {
  if (!joined) return formats[0]?.ext || ext;
  if (formats.every((f) => holds(ext, f))) return ext;
  const picture = formats.find((f) => !f.audioOnly);
  const sound = formats.find((f) => f.audioOnly);
  return picture?.ext === 'mp4' && sound?.ext === 'm4a' ? 'mp4' : picture?.ext === 'webm' && sound?.ext === 'webm' ? 'webm' : 'mkv';
}

/**
 * The verdict of a resume's check for a yt-dlp row (RESUME-DESIGN.md 2.7, 3 G3; Phase 8). `format` and `formats`:
 * the selection to ask for now and its record; `drop`: the recorded format ids whose saved parts can't be
 * continued (another file by its filesize, estimate, bitrate or length, or one Deer can't confirm: R7; a format that
 * is gone: its replacement is another file, whose parts yt-dlp names apart); `evidence` for File changed ('' when
 * nothing differed, or only R7: the row says UNSURE); `other`: always asked, whatever is saved: a gone picture
 * re-picked at another height or ext (another quality), or a selection the row's file type can't hold; `ext`: the
 * type the selection is saved as (Start over names the file for it); `none`: nothing of its kind is offered at all;
 * `label`: the new selection's quality (its picture's, or a sound row's sound); `audioOnly`: whether it is sound
 * alone; `part`: what can't be continued (all of it, its picture or its sound: the history line); `why`: a format is
 * no longer offered, the file changed, or Deer can't confirm it (R7).
 */
export interface YtdlpJudged {
  format: string;
  formats: YtdlpFormat[];
  drop: string[];
  evidence: string;
  other: boolean;
  none: boolean;
  label: string;
  ext: string;
  audioOnly: boolean;
  part: 'all' | 'picture' | 'sound';
  why: 'gone' | 'changed' | 'unsure' | '';
}

/**
 * RESUME-DESIGN.md 2.7: the chosen formats (`chosen`, recorded at the start) of the row's selection `y` against what
 * the page offers now (`info`). The same format id compare() finds the same continues; another file, or one Deer
 * can't confirm, can't; a format id that is gone is picked again (repick()).
 * Review of Phase 8: a sound that is gone in a row with a picture is named as the sound ("the M4A sound is no longer
 * offered"), and its replacement in another ext is asked about only when the row's file type can't hold it:
 * otherwise it follows the 1 MiB rule like any other format that can't be continued.
 */
export function judge(chosen: YtdlpFormat[], y: { format: string; ext: string; audioOnly: boolean }, info: { formats: Format[]; duration: number }): YtdlpJudged {
  const ids = y.format.split('+').filter(Boolean);
  const joined = ids.length > 1;
  const now = info.formats;
  const out: YtdlpFormat[] = [];
  const drop: string[] = [];
  const gone: YtdlpFormat[] = [];
  let other = false;
  let none = false;
  let changed = false;
  let unsure = false;
  let bySize = false;
  let said = '';
  let sized = '';
  // The whole download's sizes ("was 3.1 MB, now 2.7 MB") when every format still offered has an exact size on both sides.
  let exact = true;
  let was = 0;
  let is = 0;
  for (const id of ids) {
    const old = chosen.find((f) => f.id === id) ?? { id, ext: '', height: 0, fps: 0, audioOnly: false, video: false, audio: false, filesize: 0, tbr: 0, guessed: true };
    const cur = now.find((f) => String(f.format_id) === id && usable(f));
    if (cur) {
      const fresh = formatOf(cur, info.duration);
      was += old.filesize;
      is += fresh.filesize || old.filesize;
      if (!(old.filesize > 0 && fresh.filesize > 0)) exact = false;
      const c = compare(old, fresh);
      if (c.verdict === 'same') {
        out.push(kept(old, fresh));
        continue;
      }
      drop.push(id);
      out.push(fresh);
      if (c.verdict === 'unknown') unsure = true;
      else {
        changed = true;
        if (c.size) {
          bySize = true;
          sized ||= `was ${sizeText(old.filesize)}, now ${sizeText(fresh.filesize)}`;
        } else said ||= c.why;
      }
      continue;
    }
    drop.push(id);
    gone.push(old);
    const pick = repick(old, now, false) ?? repick(old, now, true);
    if (!pick) {
      none = true;
      out.push(old);
      continue;
    }
    const fresh = formatOf(pick, info.duration);
    // A picture of another height or ext is another quality: always asked.
    if (kindOf(old) !== 'audio' && (fresh.ext !== old.ext || fresh.height !== old.height)) other = true;
    out.push(fresh);
  }
  // A selection the row's file type can't hold is saved as another: always asked (Start over names the file for it).
  const ext = none ? y.ext : containerFor(y.ext, out, joined);
  if (ext !== y.ext) other = true;
  const audioOnly = !joined && !!out[0]?.audioOnly;
  // The row's own quality is its picture's, or a sound row's sound.
  const main = Math.max(0, out.findIndex((f) => !f.audioOnly));
  const label = out[main] ? labelOf(out[main]) : '';
  const part = drop.length >= ids.length || !joined ? 'all' : drop.includes(ids[main]) ? 'picture' : 'sound';
  let evidence = '';
  if (gone.length) {
    const sound = gone.some((f) => f.id === ids[main]) ? null : gone[0];
    evidence = sound ? `the ${labelOf(sound)} sound is no longer offered` : 'this quality is no longer offered';
    if (other && !none) {
      const before = sound ?? chosen.find((f) => f.id === ids[main]);
      const after = sound ? out[ids.indexOf(sound.id)] : out[main];
      let gets = labelOf(after);
      // The same height in another ext: say which ("1080p WEBM").
      if (before && gets === labelOf(before) && after.ext !== before.ext) gets = `${gets} ${after.ext.toUpperCase()}`;
      // Another file type for a picture (a sound alone's label says its type: "WEBA").
      evidence += `; Start over gets ${gets}${ext !== y.ext && !audioOnly ? ` as ${ext.toUpperCase()}` : ''}`;
    }
  } else if (changed) evidence = bySize ? (exact ? `was ${sizeText(was)}, now ${sizeText(is)}` : sized) : said;
  const why = gone.length ? 'gone' : changed ? 'changed' : unsure ? 'unsure' : '';
  return { format: out.map((f) => f.id).join('+'), formats: out, drop, evidence, other, none, label, ext, audioOnly, part, why };
}

/** What Start over set aside (owner's decision 2): "<name>.old.part", "<name>.old (2).part". */
const OLD_PART = /\.old( \(\d+\))?\.part$/i;

/**
 * Which of ytdlpParts() hold format `id` of the download at `path` (Phase 8): "<stem>.f<id>.<ext>" with its .part,
 * fragments and .ytdl notes when formats are joined ('137+140': yt-dlp names each by its id); "<name>.part" and its
 * fragments and notes when one format is saved as the file itself (any format's, so another format there would
 * continue the old one's bytes). Never what Start over set aside. Seen from real yt-dlp on YouTube (ytdlp-real.js,
 * an HLS format): "<stem>.f230.mp4.part", "<stem>.f230.mp4.ytdl", "<stem>.f230.mp4.part-Frag1" and, while a fragment
 * is written, "<stem>.f230.mp4.part-Frag1.part".
 */
export function partsOf(files: string[], path: string, id: string, joined: boolean): string[] {
  const name = PathUtils.filename(path);
  const stemName = name.replace(/\.[^.]+$/, '');
  return files.filter((c) => {
    const n = PathUtils.filename(c);
    if (OLD_PART.test(n)) return false;
    return joined ? n.startsWith(`${stemName}.f${id}.`) : n.startsWith(`${name}.`) && /^\.(part(-Frag\d+(\.part)?)?|ytdl)$/i.test(n.slice(name.length));
  });
}

/**
 * The files of `files` (ytdlpParts()) that are the download's at `path` asking for `format` (review of Phase 8:
 * Cancel removed every "<stem>.*" part, another row's of the same video too, as an M4A beside its MP4): each of its
 * formats' (partsOf()) and the joining's "<stem>.temp.<ext>". Never what Start over set aside (Rec.oldParts).
 */
export function ownParts(files: string[], path: string, format: string): string[] {
  const ids = format.split('+').filter(Boolean);
  const name = PathUtils.filename(path);
  const temp = `${name.replace(/\.[^.]+$/, '')}.temp${/\.[^.]+$/.exec(name)?.[0] ?? ''}`.toLowerCase();
  const own = ids.flatMap((id) => partsOf(files, path, id, ids.length > 1));
  return [...new Set([...own, ...files.filter((f) => PathUtils.filename(f).toLowerCase() === temp)])];
}

/**
 * RESUME-DESIGN.md G1 step 2 (Phase 8): fresh addresses of a page media file whose own expired, from yt-dlp's
 * formats of its page (probe()'s -J run, no cookies: the header): only https formats (yt-dlp's protocol, not a
 * playlist or manifest) whose reported filesize is the file's `total`. The engine proves each against the saved
 * bytes; nothing here decides. Empty when yt-dlp is not installed or finds nothing. Review of Phase 8: a step out of
 * sight (extract()'s `background`: its turn, the page's answer shared for HEARD_FRESH); `mayRun` (the site's budget)
 * may still say no before a run starts: empty then too.
 */
export async function formatsOf(pageUrl: string, total: number, signal: AbortSignal, mayRun?: () => boolean): Promise<string[]> {
  if (!ytdlpTools() || !/^https?:\/\//i.test(pageUrl) || !(total > 0)) return [];
  let formats: Format[];
  try {
    formats = (await extract(pageUrl, signal, { maxAge: HEARD_FRESH, background: true, mayRun })).formats;
  } catch (e) {
    if (signal.aborted) throw new AbortedError();
    if (!(e instanceof Skipped)) console.warn('Deer downloads: yt-dlp found no formats for the page', String(e));
    return [];
  }
  const urls: string[] = [];
  for (const f of formats as Array<Format & { url?: string }>) {
    if (f.has_drm || String(f.protocol) !== 'https' || typeof f.url !== 'string' || !/^https?:\/\//i.test(f.url) || Number(f.filesize) !== total) continue;
    if (!urls.includes(f.url)) urls.push(f.url);
  }
  return urls;
}

// ---- downloading ----

export interface YtdlpState {
  pageUrl: string;
  format: string;
  ext: string;
  audioOnly: boolean;
  /** The picker's size estimate. */
  expected: number;
  /**
   * RESUME-DESIGN.md 5.4 (Phase 8): each format of `format` as yt-dlp reported it when the download started (its
   * height, fps, ext, audioOnly and filesize: formatOf(); review of Phase 8: also its estimate, codecs and the
   * video's length), from the picker; a resume compares them (2.7) and re-picks a format that is gone by them.
   * Absent on rows from before Phase 8: their first check records them.
   */
  formats?: YtdlpFormat[];
  /** When a changed format started again by itself (3 G3, the owner's decision 1: at most twice in ten minutes). */
  silent?: number[];
}

/**
 * Another version of a yt-dlp row's download, kept on File changed for Start over (need.candidate; Phase 8): the
 * selection to ask for and its record, and the format ids whose saved parts are set aside ("<name>.old.part").
 * Review of Phase 8: the file type it is saved as (`ext`, containerFor(): the row's file is named for it) and whether
 * it is sound alone; absent on a choice saved before, which keeps the row's.
 */
export interface YtdlpChoice {
  format: string;
  formats: YtdlpFormat[];
  drop: string[];
  quality: string;
  ext?: string;
  audioOnly?: boolean;
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
  /** Bytes saved: what the parts held when the run began (the engine sets it), then yt-dlp's own counts. */
  received = 0;
  /** Connections in use, for the panel: yt-dlp's process is one. */
  live = 0;
  phase: '' | 'merging' = '';
  /** Phase 8: the run's check asked yt-dlp again (a refusal after it waits for the schedule's next attempt). */
  checked = false;
  /** Phase 8: the other version the check found, for File changed's Start over (need.candidate). */
  candidate?: YtdlpChoice;
  /** Phase 8: a changed format may start again by itself (false for a row that already asks: 3 G3). */
  silentRestarts = true;
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
        const total = Number(m[3]) || Number(m[4]) || 0;
        // A format a resume finds already downloaded is reported 'finished' with no downloaded bytes (yt-dlp's
        // FileDownloader: only total_bytes): its whole size counts (Phase 8, so a resume shows what is saved).
        const got = Number(m[2]) || (m[1] === 'finished' ? total : 0);
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
      // Phase 8: a refusal (HTTP Error 403...) is YtdlpRefusedError (Link expired for a row with saved parts).
      if (r.code !== 0) throw failure(r.stderr, 'yt-dlp stopped with an error.');
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
