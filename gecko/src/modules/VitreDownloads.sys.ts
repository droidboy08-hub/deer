// Deer's downloader: the process-wide engine. It belongs to no window, so downloads carry on while
// windows open and close; every window's UI (src/window/modules/downloads) subscribes to it.
// Port of app/src/main/modules/downloads/manager.ts onto the verified Gecko prototype
// (spikes/downloader/verify/engine/*.sys.mjs, recipe spikes/downloader/RESULT.md + corrections).
//
// Contract (window code: b.sys('VitreDownloads')):
//   init()                         idempotent; installs the take-over, media watch, quit guard. ready: Promise
//   list(isPrivate?)               DownloadView[] (src/modules/downloads/types.ts), newest first per state
//   subscribe(fn)                  fn(DownloadEvent): 'added' (with the source tab's browserId and the
//                                  flight origin), 'update' (about four a second while running), 'removed'
//   start(url, StartOptions)       a download Deer starts itself (picker, Add link, menus, Alt+click); id
//   pause / resume(id, now?) / cancel / remove / clearFinished / pauseAll / resumeAll / setLimit(id, kbps)
//   open(id) / showInFolder(id) / openFolder() / copyAddress(id) / clipboardUrl()
//   keep(id)                       a download Safe Browsing blocked as uncommon or unwanted: the person
//                                  keeps it anyway (its quarantined file takes its name)
//   media                          MediaWatch: notice(browserId), subscribe(fn), offer(...), eme(...)
//   ffmpeg()                       FfmpegInfo (settings path, bundled copy, the downloaded copy, PATH; or 'none')
//   installFfmpeg(), ffmpegInstall(), onFfmpegInstall(fn), cancelFfmpegInstall()
//                                  get ffmpeg for the person when they ask (downloads/ffmpeg-install.ts)
//   toolFolders()                  where ffmpeg, yt-dlp and Deno are downloaded to (%LOCALAPPDATA%\Deer)
//                                  and read from (also %LOCALAPPDATA%\Vitre, from before the rename)
//   setQuitPrompt(win, fn)         fn(kind, count, privateCount) shows the window's own "downloads are
//                                  running" prompt; confirmQuit() lets the next quit through (then quit
//                                  again). kind 'private': the last private window is closing
//                                  (last-pb-context-exiting); confirmPrivateClose() cancels the private
//                                  downloads and lets the next close through.
//   pickSavePath / pickFolder / pickProgram(win, ...)   native dialogs
//
// Engine rules (see the files in ./downloads):
//   - Two downloads run at once; the rest wait their turn (MAX_ACTIVE).
//   - Firefox's own downloads are taken over through its Downloads list view: Firefox saves into a
//     scratch folder (<profile>/vitre-download-scratch, browser.download.dir), so its placeholder and
//     .part never reach the user's folder; an http(s) download is probed (Range 0-0) while Firefox's
//     transfer keeps going, then Firefox's is cancelled, removed from its list, and Deer's engine
//     starts again with the same address, referrer, container and private state. Left to Firefox and
//     only mirrored: blob:, data:, answers that need the original request (the probe gets HTML or an
//     error: POST forms, one-time links), downloads an extension started (moz-extension loading
//     principal: taking them over would tell the extension they were cancelled), and downloads saved
//     somewhere Firefox was told (outside the scratch folder: Save Page As). Mirrored downloads that
//     land in the scratch folder are moved to the user's folder when they finish.
//   - Mark of the Web is written on every finished file (Firefox's own service).
//   - Safe Browsing: every file the engine fetched itself is checked when it is complete, with the
//     query Firefox's own downloads make (downloads/reputation.ts; Firefox's mirrored downloads were
//     checked by Firefox). Dangerous: the file is deleted and the row fails with the reason.
//     Uncommon or potentially unwanted: the file waits as "<name>.blocked" and the row fails with the
//     reason and a "Keep file" action (keep(id)); Retry downloads it again, removing the row deletes
//     it. Opening an executable that is not an .exe asks first (Firefox's own prompt), as
//     DownloadIntegration.launchDownload does.
//   - DRM is never downloaded: streams with DRM keys or ContentProtection are refused by the engine,
//     a tab that used EME offers nothing (media.ts), and start() refuses a stream, a picked video or
//     a media address (MEDIA_URL) for a tab (opts.browserId) that uses DRM, whoever asks (throws
//     DownloadError with the "protected" message).
//   - Quit while downloads run: refused (quit-application-requested), the window shows its prompt;
//     a quit that goes ahead pauses everything, resumable, and the list (with every segment) is
//     written before the profile closes. Unfinished downloads come back paused.
//   - Private downloads are never written to disk lists and are dropped when the last private
//     window closes (last-pb-context-exited), as Firefox does. Closing the last private window
//     while one runs asks first (last-pb-context-exiting), and a quit cancels them (the prompt says so).
//
// Firefox internals (157, reference/omni), each used in one place below:
//   Downloads.getList(Downloads.ALL).addView     gre/modules/Downloads.sys.mjs, DownloadList.sys.mjs
//   download.source / target / cancel / removePartialData / finalize / start
//                                                gre/modules/DownloadCore.sys.mjs
//   BrowsingContext.get / getCurrentTopByBrowserId, embedderElement.documentGlobal (157 rename)
//   quit-application-requested ("lastwindow", "restart"), quit-application-granted
//                                                gre/chrome/toolkit/content/global/globalOverlay.js
//   last-pb-context-exiting (nsISupportsPRBool)  browser/chrome/browser/content/browser/browser.js
//                                                WindowIsClosing; gre/modules/DownloadIntegration.sys.mjs
//   AsyncShutdown.profileBeforeChange            gre/modules/AsyncShutdown.sys.mjs
//   prefs browser.download.{useDownloadDir, always_ask_before_handling_new_types, alwaysOpenPanel,
//   panel.shown, folderList, dir}                 gre/modules/DownloadIntegration.sys.mjs
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import { AsyncShutdown } from 'resource://gre/modules/AsyncShutdown.sys.mjs';
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';
import { clearInterval, setInterval, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { findFfmpeg, forgetFfmpeg } from './downloads/ffmpeg';
import { cancelFfmpegInstall, ffmpegInstallDir, ffmpegInstallState, installFfmpeg, oldFolder, onFfmpegInstall, type FfmpegInstallState } from './downloads/ffmpeg-install';
import { DRM_MESSAGE, StreamTransfer, streamEstimate, streamFills, trackPart, type StreamState } from './downloads/hls';
import { RateLimiter } from './downloads/limiter';
import { MediaWatch } from './downloads/media';
import { MEDIA_URL } from './downloads/media-url';
import { categoryOf, chooseName, extOf, nameFromUrl, sanitize, streamTitle, uniquePath } from './downloads/naming';
import { AbortedError, DiskError, DownloadError, Identity, describeError } from './downloads/net';
import { existsSync } from './downloads/partfile';
import * as platform from './downloads/platform';
import { asPolicy, readReferrerInfo } from './downloads/referrer';
import { mayLaunch, reputationOf, type Verdict } from './downloads/reputation';
import { FileTransfer, fileFills, type FileState, type TransferEnv } from './downloads/ranged';
import type { DownloadEvent, DownloadState, DownloadView, FfmpegInfo, IdentityJSON, StartOptions } from './downloads/types';
import { YtdlpTransfer, cancelToolsInstall, installTools, oldToolsDir, onToolsInstall, toolsDir, toolsInstallState, toolsVersion, ytdlpParts, ytdlpTools, type ToolsState, type YtdlpState } from './downloads/ytdlp';

declare global {
  interface VitreSysModules {
    VitreDownloads: typeof VitreDownloads;
  }
}

const MAX_ACTIVE = 2;
const TICK = 250;
const SAVE_EVERY = 2000;
const STORE_VERSION = 1;
const ACTIVE: DownloadState[] = ['starting', 'queued', 'downloading'];
const FINISHED: DownloadState[] = ['completed', 'cancelled', 'failed'];
const ORDER: Record<DownloadState, number> = { downloading: 0, starting: 0, queued: 1, paused: 2, failed: 2, completed: 3, cancelled: 3 };

/** The prefs that make Firefox hand its downloads over quietly (recipe TAKE-OVER, corrections 3). */
const TAKEOVER_PREFS: Record<string, boolean | number> = {
  // Never Firefox's "where to save" picker or its "open with" dialog: Deer asks (or not) itself.
  'browser.download.useDownloadDir': true,
  'browser.download.always_ask_before_handling_new_types': false,
  // The downloads panel is anchored to a toolbar button Deer hides; it must never pop open.
  'browser.download.alwaysOpenPanel': false,
  'browser.download.panel.shown': true,
  // Firefox's own folder is the scratch folder (browser.download.dir, set in installTakeover).
  'browser.download.folderList': 2,
};

/** The person closed the save dialog: the download never happened. */
class SaveDeclined extends Error {}

interface Rec {
  id: string;
  url: string;
  identity: IdentityJSON;
  title: string;
  filename: string;
  /** The name came from the person (or the picker) and must not be replaced by the server's. */
  named: boolean;
  dir: string;
  path: string;
  mime: string;
  state: DownloadState;
  mode: 'file' | 'stream' | 'browser' | 'ytdlp';
  file: FileState | null;
  stream: StreamState | null;
  /** mode 'ytdlp': the page, the format and the file type yt-dlp is asked for. */
  ytdlp?: YtdlpState;
  received: number;
  total: number;
  netBytes: number;
  activeMs: number;
  peak: number;
  error: string;
  note: string;
  startedAt: number;
  finishedAt: number;
  queuedAt: number;
  quality: string;
  videoKey: string;
  limitKBps: number;
  askWhere: boolean;
  overwrite: boolean;
  /** Paused while its first answer was still being read. */
  hold: boolean;
  browserId: number;
  /** Mirrored Firefox download: it is moved out of the scratch folder when it finishes. */
  fromScratch?: boolean;
  fromExtension?: boolean;
  /** Safe Browsing blocked the finished file (see the header). */
  blocked?: Exclude<Verdict, 'safe'>;
  /** Where a blocked file waits ("<path>.blocked") until it is kept, retried or removed. */
  quarantine?: string;
}

/** Why a finished file was blocked, as the row says it. */
const BLOCKED: Record<Exclude<Verdict, 'safe'>, string> = {
  dangerous: 'Removed: Safe Browsing reports this file as dangerous.',
  uncommon: 'Blocked: this file is not commonly downloaded and may be dangerous.',
  unwanted: 'Blocked: this file may make unwanted changes to your computer.',
};

interface Run {
  ac: AbortController;
  reason: 'pause' | 'cancel' | 'quit' | null;
  transfer: FileTransfer | StreamTransfer | YtdlpTransfer | null;
  /** A download Firefox moves the bytes for (mode 'browser'). */
  firefox: any;
  samples: { t: number; bytes: number }[];
  speed: number;
  phase: '' | 'probing' | 'merging';
  last: number;
  /** Resume was asked while the pause was still stopping the connections: queue again once stopped. */
  resumeAfter?: boolean;
}

/**
 * A window's "downloads are running" prompt. kind 'private': the last private window is closing
 * (its downloads would be cancelled: they can't be kept); count is what runs, privateCount how many
 * of those are private (a quit cancels them instead of pausing them).
 */
type QuitPrompt = (kind: 'quit' | 'lastwindow' | 'restart' | 'private', count: number, privateCount: number) => void;

/** Same site (scheme + registrable domain), as SameSite cookies count it. IP hosts compare by host. */
function sameSite(a: string, b: string): boolean {
  const site = (spec: string): string => {
    const uri = Services.io.newURI(spec);
    try {
      return Services.eTLD.getSite(uri);
    } catch {
      return uri.scheme + '://' + uri.host;
    }
  };
  try {
    return site(a) === site(b);
  } catch {
    return false;
  }
}

function uuid(): string {
  return Services.uuid.generateUUID().toString().slice(1, -1);
}

/**
 * The queue's clock: Date.now(), but strictly increasing, so downloads started in the same
 * millisecond (a batch) still wait in the order they were asked for.
 */
let lastQueued = 0;
function queueStamp(): number {
  lastQueued = Math.max(Date.now(), lastQueued + 1);
  return lastQueued;
}

/**
 * A file operation of the save step (make the folder, move the finished file): its failure is a disk
 * problem (DiskError, read as "Couldn't write to the downloads folder"), never "The connection was
 * lost." IOUtils rejects with a DOMException whose name says what went wrong.
 */
async function onDisk<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    if (e instanceof DiskError) throw e;
    const name = String((e as { name?: string })?.name ?? '');
    throw new DiskError(name === 'NotAllowedError' ? Cr.NS_ERROR_FILE_ACCESS_DENIED : name === 'NotFoundError' ? Cr.NS_ERROR_FILE_NOT_FOUND : Cr.NS_ERROR_FAILURE);
  }
}

function stem(p: string): string {
  return p.replace(/\.[^.\\/]+$/, '');
}

/**
 * The settings, read once and kept until they change (the speed limit is asked for on every chunk
 * of every connection: reading every vitre.* pref each time would cost the main thread).
 */
let cachedSettings: any = null;
function settings(): any {
  cachedSettings ??= VitreSettings.get();
  return cachedSettings;
}

/** The chrome window that shows a tab (by browserId), or the most recent browser window. */
function windowFor(browserId: number): any {
  try {
    const browser = browserId ? (globalThis as any).BrowsingContext.getCurrentTopByBrowserId(browserId)?.embedderElement : null;
    // Firefox 157 renamed node.ownerGlobal to node.documentGlobal.
    const win = browser ? (browser.documentGlobal ?? browser.ownerGlobal) : null;
    if (win && !win.closed) return win;
  } catch {
    /* tab gone */
  }
  return Services.wm.getMostRecentWindow('navigator:browser');
}

class Manager {
  private recs: Rec[] = [];
  private runs = new Map<string, Run>();
  private listeners = new Set<(e: DownloadEvent) => void>();
  private settled = new Map<string, ((v: DownloadView | null) => void)[]>();
  /** A transfer whose probe already ran (a taken-over download), waiting to start. */
  private warm = new Map<string, FileTransfer>();
  private dirty = new Set<string>();
  private ticker: any = null;
  private flushTimer: any = null;
  private lastSave = 0;
  private saving: Promise<void> = Promise.resolve();
  private global = new RateLimiter(() => Number(settings().speedLimitKBps) || 0);
  private started = false;
  private quitting = false;
  private quitConfirmed = false;
  private prompts = new Map<any, QuitPrompt>();
  private firefoxList: any = null;
  private storePath = '';
  /** Firefox's own download folder: Deer's scratch (see the header). */
  scratch = '';
  /** Firefox downloads seen by the take-over, for tests: what was done with each. */
  takeovers: { url: string; action: string; id?: string; page?: string; crossSite?: boolean }[] = [];
  readonly media = new MediaWatch(async () => !!(await this.ffmpeg()).path);
  ready: Promise<void> = Promise.resolve();

  // ---- start-up ----

  init(): Promise<void> {
    if (this.started) return this.ready;
    this.started = true;
    this.ready = (async () => {
      this.storePath = PathUtils.join(PathUtils.profileDir, 'vitre-downloads.json');
      this.scratch = PathUtils.join(PathUtils.profileDir, 'vitre-download-scratch');
      await this.load();
      this.installLifecycle();
      try {
        this.media.install();
      } catch (e) {
        console.error('Deer downloads: media watch failed', e);
      }
      VitreSettings.onChange((_s: unknown, changed: string[]) => {
        cachedSettings = null;
        if (changed.includes('ffmpegPath')) forgetFfmpeg();
      });
      try {
        await this.installTakeover();
      } catch (e) {
        console.error('Deer downloads: take-over failed', e);
      }
    })();
    return this.ready;
  }

  private async load(): Promise<void> {
    let saved: { version?: number; items?: Rec[] } | null = null;
    try {
      saved = await IOUtils.readJSON(this.storePath);
    } catch {
      saved = null;
    }
    for (const r of saved?.items ?? []) {
      if (!r?.id || !r.url || typeof r.url !== 'string') continue;
      if (ACTIVE.includes(r.state)) {
        // Firefox's own transfers don't survive a restart; Deer's carry on from their .part files.
        if (r.mode === 'browser' || r.state === 'starting') {
          r.state = 'failed';
          r.error = 'Interrupted when Deer closed.';
        } else r.state = 'paused';
      }
      r.hold = false;
      r.note ??= '';
      r.identity = new Identity(r.identity ?? {}).toJSON();
      this.recs.push(r);
    }
  }

  // ---- list ----

  list(isPrivate?: boolean): DownloadView[] {
    return this.recs.filter((r) => isPrivate === undefined || r.identity.isPrivate === isPrivate).map((r) => this.view(r, true)).sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.startedAt - a.startedAt);
  }

  get(id: string): DownloadView | null {
    const r = this.find(id);
    return r ? this.view(r, true) : null;
  }

  private find(id: string): Rec | undefined {
    return this.recs.find((r) => r.id === id);
  }

  subscribe(fn: (e: DownloadEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(e: DownloadEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (err) {
        console.error('Deer downloads: listener failed', err);
      }
    }
  }

  /** Downloads that are running or waiting to (the quit prompt counts these). */
  runningCount(): number {
    return this.recs.filter((r) => ACTIVE.includes(r.state)).length;
  }

  /** Resolves with the download's view once it is paused, finished, failed or cancelled. */
  whenSettled(id: string): Promise<DownloadView | null> {
    const rec = this.find(id);
    if (!rec || !ACTIVE.includes(rec.state)) return Promise.resolve(rec ? this.view(rec, false) : null);
    return new Promise((resolve) => {
      const list = this.settled.get(id) ?? [];
      list.push(resolve);
      this.settled.set(id, list);
    });
  }

  /** For tests: the live transfer's measurements. */
  transferInfo(id: string): { sockets: number; peakLive: number; live: number } | null {
    const t = this.runs.get(id)?.transfer;
    if (!t) return null;
    return t instanceof FileTransfer ? { sockets: t.sockets.size, peakLive: t.peakLive, live: t.live } : { sockets: 0, peakLive: t.live, live: t.live };
  }

  // ---- starting ----

  private newRec(url: string, opts: StartOptions): Rec {
    const s = settings();
    const dir = opts.dir || s.downloadsFolder || Services.dirsvc.get('DfltDwnld', Ci.nsIFile).path;
    const title = (opts.title ?? '').trim();
    const identity = new Identity({ pageUrl: opts.pageUrl, ...(opts.identity ?? {}) }).toJSON();
    return {
      id: uuid(),
      url,
      identity,
      title,
      filename: opts.filename ? sanitize(opts.filename) : sanitize(nameFromUrl(url) || title || 'download'),
      named: !!opts.named,
      dir,
      path: '',
      mime: '',
      state: 'queued',
      mode: 'file',
      file: null,
      stream: null,
      received: 0,
      total: -1,
      netBytes: 0,
      activeMs: 0,
      peak: 0,
      error: '',
      note: '',
      startedAt: Date.now(),
      finishedAt: 0,
      queuedAt: queueStamp(),
      quality: opts.quality ?? '',
      videoKey: opts.videoKey ?? '',
      limitKBps: 0,
      askWhere: (opts.saveAs ?? !!s.askWhereToSave) && !opts.dir,
      overwrite: false,
      hold: false,
      browserId: Number(opts.browserId) || 0,
    };
  }

  /** A download Deer starts itself (the video picker, Add link, menus, Alt+click). Returns its id. */
  start(url: string, opts: StartOptions = {}): string {
    if (!/^https?:\/\//i.test(url)) throw new DownloadError('Only web addresses can be downloaded.');
    const mode = opts.mode === 'hls' || opts.mode === 'dash' || opts.mode === 'ytdlp' ? opts.mode : opts.mode === 'file' ? 'file' : /\.m3u8(\?|#|$)/i.test(url) ? 'hls' : /\.mpd(\?|#|$)/i.test(url) ? 'dash' : 'file';
    // DRM, whoever asks: the page may have started its key session after its picker opened.
    const browserId = Number(opts.browserId) || 0;
    if (browserId && this.media.isProtected(browserId) && (mode !== 'file' || !!opts.videoKey || MEDIA_URL.test(url))) throw new DownloadError(DRM_MESSAGE);
    const rec = this.newRec(url, opts);
    if (mode === 'ytdlp') {
      if (!opts.ytdlpFormat) throw new DownloadError('No format was chosen.');
      rec.mode = 'ytdlp';
      const ext = (opts.ytdlpExt || 'mp4').replace(/[^\w]/g, '') || 'mp4';
      rec.ytdlp = { pageUrl: url, format: opts.ytdlpFormat, ext, audioOnly: !!opts.audioOnly, expected: Number(opts.bytes) || 0 };
      if (!opts.named) rec.filename = sanitize(`${rec.title || 'video'}.${ext}`);
    } else if (mode !== 'file') {
      rec.mode = 'stream';
      rec.stream = StreamTransfer.fresh(url, { format: mode, variantUrl: opts.variantUrl, audioUrl: opts.audioUrl, dashVideo: opts.dashVideo, dashAudio: opts.dashAudio, audioOnly: opts.audioOnly, bytes: opts.bytes });
      rec.identity.withOrigin = true;
      if (!opts.named) rec.filename = sanitize(`${rec.title || streamTitle(url)}${opts.audioOnly ? '.m4a' : '.mp4'}`);
    } else if (!opts.filename && rec.title && (opts.videoKey || !extOf(rec.filename))) {
      rec.filename = chooseName({ url, title: rec.title });
    }
    this.recs.unshift(rec);
    this.added(rec, opts.origin ?? null);
    this.pump();
    return rec.id;
  }

  private added(rec: Rec, origin: { x: number; y: number } | null): void {
    this.emit({ kind: 'added', view: this.view(rec, false), origin, browserId: rec.browserId });
    this.save();
  }

  // ---- Firefox's own downloads ----

  private async installTakeover(): Promise<void> {
    await IOUtils.makeDirectory(this.scratch, { ignoreExisting: true, createAncestors: true });
    for (const [k, v] of Object.entries(TAKEOVER_PREFS)) {
      if (typeof v === 'boolean') Services.prefs.setBoolPref(k, v);
      else Services.prefs.setIntPref(k, v);
    }
    Services.prefs.setStringPref('browser.download.dir', this.scratch);
    const list = await Downloads.getList(Downloads.ALL);
    this.firefoxList = list;
    let live = false;
    await list.addView({
      // addView replays the downloads already in the list (earlier sessions): those are history.
      onDownloadAdded: (download: any) => {
        if (live) this.adopt(list, download).catch((e) => console.error('Deer downloads: take-over failed', e));
      },
      onDownloadChanged: (download: any) => this.firefoxChanged(download),
    });
    live = true;
  }

  /** Firefox started a download (a link, <a download>, an extension, a page's blob:). */
  private async adopt(list: any, download: any): Promise<void> {
    const src = download.source;
    const url: string = src.url;
    const target: string = download.target?.path ?? '';
    const suggested = target ? PathUtils.filename(target) : '';
    // The page's referrer info: its policy decides the Referer of Deer's requests too (a
    // rel=noreferrer link sends none, as Firefox's own request did not).
    const ref = readReferrerInfo(src.referrerInfo);
    const referrer: string = ref?.url ?? '';
    let bc: any = null;
    try {
      bc = src.browsingContextId ? (globalThis as any).BrowsingContext.get(src.browsingContextId) : null;
    } catch {
      bc = null;
    }
    const browserId: number = bc?.top?.browserId ?? 0;
    const pageUrl = referrer || (bc?.top?.currentURI?.spec ?? '');
    // Cookies: a download from the same site (or from no page at all) is fetched as a first-party
    // request, with the address's own cookies, as Firefox does. One a page starts on ANOTHER site is
    // fetched with that page as the loading principal, so Necko applies the cross-site rules and its
    // SameSite=Strict/Lax cookies are not sent. If the server then refuses or answers with a page, the
    // probe below hands the download back to Firefox.
    const crossSite = /^https?:/i.test(url) && !!pageUrl && !sameSite(url, pageUrl);
    const identity = new Identity({ pageUrl, userContextId: src.userContextId ?? 0, isPrivate: !!src.isPrivate, firstParty: !crossSite, pageRules: crossSite, referrerPolicy: ref?.policy ?? '' }).toJSON();
    const loading: string = src.loadingPrincipal?.spec ?? src.loadingPrincipal?.origin ?? '';
    const fromExtension = /^moz-extension:/i.test(loading) || !!src.loadingPrincipal?.addonId;
    const inScratch = !!target && PathUtils.parent(target)?.toLowerCase() === this.scratch.toLowerCase();
    const rec = this.newRec(url, { filename: suggested, identity, browserId });
    rec.mime = download.contentType ?? '';
    rec.fromScratch = inScratch;
    rec.fromExtension = fromExtension;
    if (!/^https?:/i.test(url) || fromExtension || !inScratch) {
      this.takeovers.push({ url, action: !inScratch ? 'left: saved where Firefox was told' : fromExtension ? 'left: extension' : 'left: not http', id: rec.id, page: pageUrl });
      this.mirror(rec, download);
      return;
    }
    rec.state = 'starting';
    rec.queuedAt = 0;
    this.recs.unshift(rec);
    this.added(rec, null);
    // Ask the server ourselves while Firefox's transfer keeps going (a probe that fails, or gets a
    // page where Firefox got a file, means the download needs the original request).
    const run = this.makeRun();
    run.phase = 'probing';
    this.runs.set(rec.id, run);
    this.ensureTicker();
    const transfer = new FileTransfer(FileTransfer.fresh(url), this.env(rec, run));
    let info: Awaited<ReturnType<FileTransfer['probe']>> | null = null;
    try {
      info = await transfer.probe(run.ac.signal);
    } catch {
      info = null;
    }
    this.runs.delete(rec.id);
    if (run.reason === 'quit') return;
    if (run.reason === 'cancel') {
      transfer.dropPending();
      await this.dropFirefox(list, download, target);
      this.markCancelled(rec);
      return;
    }
    const html = !!info && /text\/html/i.test(info.contentType) && !/text\/html/i.test(rec.mime);
    if (!info || html) {
      this.takeovers.push({ url, action: `left: probe ${info ? info.status + ' ' + info.contentType : 'failed'}`, id: rec.id });
      this.recs = this.recs.filter((r) => r !== rec);
      this.mirror(rec, download, true);
      return;
    }
    // Stop Firefox's transfer, delete what it wrote (its .part and the empty placeholder), forget it.
    await this.dropFirefox(list, download, target);
    this.takeovers.push({ url, action: 'taken over', id: rec.id, page: pageUrl, crossSite });
    rec.file = transfer.state;
    rec.total = transfer.state.total;
    if (!rec.mime) rec.mime = info.contentType;
    rec.state = rec.hold ? 'paused' : 'queued';
    rec.queuedAt = queueStamp();
    rec.hold = false;
    if (rec.state === 'queued') this.warm.set(rec.id, transfer);
    else transfer.dropPending();
    this.touch(rec);
    this.save();
    this.pump();
  }

  private async dropFirefox(list: any, download: any, target: string): Promise<void> {
    await download.cancel().catch(() => undefined);
    await download.removePartialData().catch(() => undefined);
    await download.finalize(true).catch(() => undefined);
    await list.remove(download).catch(() => undefined);
    if (target) await IOUtils.remove(target, { ignoreAbsent: true }).catch(() => undefined);
  }

  /** Firefox moves the bytes; the row follows its Download object. */
  private mirror(rec: Rec, download: any, alreadyListed = false): void {
    rec.mode = 'browser';
    rec.state = 'downloading';
    try {
      download.tryToKeepPartialData = true;
    } catch {
      /* older object */
    }
    const run = this.makeRun();
    run.firefox = download;
    this.runs.set(rec.id, run);
    if (!alreadyListed) {
      this.recs.unshift(rec);
      this.added(rec, null);
    } else {
      this.recs.unshift(rec);
      this.touch(rec);
    }
    this.ensureTicker();
    this.firefoxChanged(download);
  }

  /** For tests: what each mirrored Firefox download reported (state flags, bytes, target). */
  firefoxTrace = new Map<string, string[]>();

  private firefoxChanged(download: any): void {
    for (const [id, run] of this.runs) {
      if (run.firefox !== download) continue;
      const rec = this.find(id);
      if (!rec) return;
      const trace = this.firefoxTrace.get(id) ?? [];
      if (trace.length < 40) trace.push(`${download.succeeded ? 'S' : ''}${download.stopped ? 's' : ''}${download.canceled ? 'c' : ''}${download.error ? 'E' : ''} ${download.currentBytes}/${download.totalBytes} ${download.target?.path ?? ''} exists=${download.target?.exists}`);
      this.firefoxTrace.set(id, trace);
      rec.received = Number(download.currentBytes) || 0;
      rec.total = download.hasProgress && download.totalBytes > 0 ? Number(download.totalBytes) : -1;
      if (download.succeeded) {
        if (rec.state === 'completed' || run.phase === 'merging') return;
        run.phase = 'merging';
        void this.placeFirefoxFile(rec, download);
      } else if (download.canceled) {
        if (rec.state === 'downloading') rec.state = download.hasPartialData ? 'paused' : 'cancelled';
      } else if (download.error) {
        rec.state = 'failed';
        rec.error = download.error.becauseTargetFailed ? 'Couldn’t write to the downloads folder.' : 'The download was interrupted.';
        this.runs.delete(id);
        this.save();
      } else if (!download.stopped) {
        rec.state = 'downloading';
        rec.error = '';
      }
      this.touch(rec);
      return;
    }
  }

  /** A mirrored download finished in the scratch folder: move it where the person keeps downloads. */
  private async placeFirefoxFile(rec: Rec, download: any): Promise<void> {
    const from: string = download.target?.path ?? '';
    try {
      // 'succeeded' is announced before Firefox's own last steps (DownloadCore _succeed ->
      // DownloadIntegration.downloadDone writes the Zone.Identifier stream and the permissions):
      // moving the file earlier races them and leaves a stray file behind. whenSucceeded() waits for them.
      await download.whenSucceeded?.();
      if (rec.fromScratch && from) {
        let target = '';
        if (rec.askWhere) {
          rec.askWhere = false;
          target = (await platform.pickSavePath(windowFor(rec.browserId), { name: rec.filename, dir: rec.dir })) ?? '';
          if (!target) {
            await IOUtils.remove(from, { ignoreAbsent: true });
            this.runs.delete(rec.id);
            this.removeRec(rec.id);
            return;
          }
          await IOUtils.remove(target, { ignoreAbsent: true });
        } else {
          await onDisk(IOUtils.makeDirectory(rec.dir, { ignoreExisting: true, createAncestors: true }));
          target = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id));
        }
        await onDisk(IOUtils.move(from, target));
        rec.path = target;
        rec.dir = PathUtils.parent(target) ?? rec.dir;
        rec.filename = PathUtils.filename(target);
        // The page's own blob:/data: downloads leave Firefox's list; an extension's stay (its API still answers).
        if (!rec.fromExtension) await this.firefoxList?.remove(download).catch(() => undefined);
      } else {
        rec.path = from;
        rec.filename = from ? PathUtils.filename(from) : rec.filename;
        rec.dir = from ? (PathUtils.parent(from) ?? rec.dir) : rec.dir;
      }
      this.runs.delete(rec.id);
      await this.complete(rec);
    } catch (err) {
      this.runs.delete(rec.id);
      rec.state = 'failed';
      rec.error = describeError(err);
      this.touch(rec);
      this.save();
    }
  }

  // ---- queue ----

  private pump(): void {
    if (this.quitting) return;
    let active = [...this.runs.entries()].filter(([id, run]) => !run.firefox && this.find(id)?.state !== 'starting').length;
    const waiting = this.recs.filter((r) => r.state === 'queued' && !this.runs.has(r.id)).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const r of waiting) {
      if (active >= MAX_ACTIVE) {
        // Still waiting: its place in the queue may have moved.
        this.dirty.add(r.id);
        continue;
      }
      this.launch(r);
      active++;
    }
    for (const [id, t] of this.warm) {
      const s = this.find(id)?.state;
      if (s !== 'downloading' && s !== 'queued') {
        t.dropPending();
        this.warm.delete(id);
      }
    }
    this.flushSoon();
  }

  private launch(rec: Rec): void {
    const run = this.makeRun();
    this.runs.set(rec.id, run);
    rec.state = 'downloading';
    rec.error = '';
    if (!rec.startedAt) rec.startedAt = Date.now();
    this.touch(rec);
    this.ensureTicker();
    const job = rec.mode === 'stream' ? this.runStream(rec, run) : rec.mode === 'ytdlp' ? this.runYtdlp(rec, run) : this.runFile(rec, run);
    job.then(
      async () => {
        this.runs.delete(rec.id);
        await this.complete(rec);
        this.pump();
      },
      (err) => this.stopped(rec, run, err)
    );
  }

  private async runFile(rec: Rec, run: Run): Promise<void> {
    // A taken-over download starts with the transfer its probe made (same identity, same counters).
    const transfer = this.warm.get(rec.id) ?? new FileTransfer(rec.file ?? FileTransfer.fresh(rec.url), this.env(rec, run));
    this.warm.delete(rec.id);
    rec.file = transfer.state;
    run.transfer = transfer;
    if (!transfer.state.probed || transfer.received > 0) {
      run.phase = 'probing';
      this.touch(rec);
      const info = await transfer.probe(run.ac.signal);
      if (!rec.path && !rec.named) {
        rec.filename = chooseName({ disposition: info.disposition, url: info.finalUrl, mime: info.contentType, title: rec.videoKey ? rec.title : '', suggested: rec.filename || nameFromUrl(rec.url) || undefined });
        rec.mime = info.contentType;
      }
    }
    run.phase = '';
    rec.total = transfer.state.total;
    if (!rec.path) {
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      await this.reserve(rec);
    }
    this.touch(rec);
    this.save();
    const part = `${rec.path}.part`;
    await transfer.download(part, run.ac.signal);
    await this.placeFinished(rec, part);
  }

  private async runStream(rec: Rec, run: Run): Promise<void> {
    const state = rec.stream ?? StreamTransfer.fresh(rec.url);
    rec.stream = state;
    const transfer = new StreamTransfer(state, { ...this.env(rec, run), ffmpeg: () => this.ffmpeg() });
    run.transfer = transfer;
    run.phase = 'probing';
    this.touch(rec);
    await transfer.prepare(run.ac.signal);
    run.phase = '';
    if (!rec.path) {
      if (!rec.named) rec.filename = rec.filename.replace(/\.(mp4|m4a|ts|aac|webm|weba)$/i, '') + transfer.expectedExtension();
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      await this.reserve(rec);
    }
    this.save();
    const base = stem(rec.path);
    await transfer.download(base, run.ac.signal);
    run.phase = 'merging';
    this.touch(rec);
    const out = await transfer.finish(base, (ext, suffix = '') => this.freePath(rec, `${PathUtils.filename(base)}${suffix}${ext}`), run.ac.signal);
    rec.note = transfer.note;
    rec.path = out;
    rec.filename = PathUtils.filename(out);
  }

  private async runYtdlp(rec: Rec, run: Run): Promise<void> {
    if (!rec.ytdlp) throw new DownloadError('This download lost its video details.');
    const env = this.env(rec, run);
    const transfer = new YtdlpTransfer(rec.ytdlp, { onBytes: env.onBytes, ffmpeg: () => this.ffmpeg(), connections: env.connections });
    run.transfer = transfer;
    if (!rec.path) {
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      await this.reserve(rec);
    }
    this.touch(rec);
    this.save();
    const merging = setInterval(() => {
      if (transfer.phase === 'merging' && run.phase !== 'merging') {
        run.phase = 'merging';
        this.touch(rec);
      }
    }, 250);
    try {
      await transfer.download(rec.path, run.ac.signal);
    } finally {
      clearInterval(merging);
    }
    rec.total = transfer.received || rec.total;
  }

  /** Rename the finished .part into place; if something took the name meanwhile, take the next free one. */
  private async placeFinished(rec: Rec, part: string): Promise<void> {
    let target = rec.path;
    if (rec.overwrite) await IOUtils.remove(target, { ignoreAbsent: true });
    else if (existsSync(target)) target = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id));
    await onDisk(IOUtils.move(part, target));
    rec.path = target;
    rec.filename = PathUtils.filename(target);
  }

  private freePath(rec: Rec, name: string): string {
    const wanted = PathUtils.join(rec.dir, name);
    if (!existsSync(wanted)) return wanted;
    return uniquePath(rec.dir, name, (p) => this.taken(p, rec.id));
  }

  private async reserve(rec: Rec): Promise<void> {
    await onDisk(IOUtils.makeDirectory(rec.dir, { ignoreExisting: true, createAncestors: true }));
    if (rec.overwrite) {
      rec.path = PathUtils.join(rec.dir, rec.filename);
      return;
    }
    rec.path = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id) || (rec.mode === 'stream' && streamPartsExist(p)));
    rec.filename = PathUtils.filename(rec.path);
  }

  private taken(p: string, except: string): boolean {
    const key = p.toLowerCase();
    return this.recs.some((r) => r.id !== except && r.path.toLowerCase() === key && !FINISHED.includes(r.state));
  }

  /** "Ask where to save each file": the Windows save dialog, once, before the first byte is written. */
  private async confirmPath(rec: Rec): Promise<boolean> {
    if (!rec.askWhere) return true;
    rec.askWhere = false;
    const path = await platform.pickSavePath(windowFor(rec.browserId), { name: rec.filename, dir: rec.dir });
    if (!path) return false;
    rec.dir = PathUtils.parent(path) ?? rec.dir;
    rec.filename = PathUtils.filename(path);
    rec.named = true;
    rec.overwrite = true;
    return true;
  }

  private async complete(rec: Rec): Promise<void> {
    // Safe Browsing, for what the engine fetched itself (Firefox checked its own mirrored ones).
    if (rec.path && rec.mode !== 'browser' && /^https?:/i.test(rec.url)) {
      let size = rec.received;
      try {
        size = (await IOUtils.stat(rec.path)).size;
      } catch {
        /* keep the counted bytes */
      }
      const verdict = await reputationOf({ url: rec.url, pageUrl: rec.identity.pageUrl, policy: asPolicy(rec.identity.referrerPolicy), path: rec.path, size });
      if (!this.recs.includes(rec) || rec.state === 'cancelled') return;
      if (verdict !== 'safe') {
        await this.block(rec, verdict);
        return;
      }
    }
    rec.state = 'completed';
    rec.finishedAt = Date.now();
    rec.error = '';
    try {
      rec.total = rec.received = (await IOUtils.stat(rec.path)).size;
    } catch {
      /* keep the counted bytes */
    }
    // Firefox writes it for the downloads it moves (mirrored ones) before they are moved here; a move
    // to another volume may drop the stream, so it is written again.
    if (rec.path) await platform.markOfTheWeb(rec.path, rec.url, rec.identity.pageUrl, rec.identity.isPrivate, asPolicy(rec.identity.referrerPolicy));
    this.touch(rec);
    this.settle(rec);
    this.save();
  }

  /** A finished file Safe Browsing blocked (see the header): deleted, or kept aside as "<path>.blocked". */
  private async block(rec: Rec, verdict: Exclude<Verdict, 'safe'>): Promise<void> {
    const path = rec.path;
    let quarantine = '';
    if (verdict === 'dangerous') await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => undefined);
    else {
      quarantine = `${path}.blocked`;
      try {
        await IOUtils.move(path, quarantine);
      } catch {
        await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => undefined);
        quarantine = '';
      }
    }
    this.rewind(rec);
    rec.state = 'failed';
    rec.finishedAt = Date.now();
    rec.blocked = verdict;
    rec.quarantine = quarantine;
    rec.error = BLOCKED[verdict];
    this.touch(rec);
    this.settle(rec);
    this.save();
  }

  /** The person keeps a file Safe Browsing blocked as uncommon or unwanted: it takes its name. */
  async keep(id: string): Promise<void> {
    const rec = this.find(id);
    if (!rec || rec.state !== 'failed' || !rec.quarantine || !existsSync(rec.quarantine)) return;
    const quarantine = rec.quarantine;
    const target = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id));
    try {
      await onDisk(IOUtils.move(quarantine, target));
    } catch (e) {
      rec.error = describeError(e);
      this.touch(rec);
      return;
    }
    rec.quarantine = '';
    rec.path = target;
    rec.filename = PathUtils.filename(target);
    rec.state = 'completed';
    rec.error = '';
    rec.note = 'Kept although Safe Browsing warned about it.';
    try {
      rec.total = rec.received = (await IOUtils.stat(target)).size;
    } catch {
      /* keep the counts */
    }
    await platform.markOfTheWeb(target, rec.url, rec.identity.pageUrl, rec.identity.isPrivate, asPolicy(rec.identity.referrerPolicy));
    this.touch(rec);
    this.save();
  }

  /** A blocked file waiting aside goes for good (Retry, Remove). */
  private dropQuarantine(rec: Rec): void {
    if (rec.quarantine) IOUtils.remove(rec.quarantine, { ignoreAbsent: true }).catch(() => undefined);
    rec.quarantine = '';
    rec.blocked = undefined;
  }

  private stopped(rec: Rec, run: Run, err: unknown): void {
    this.runs.delete(rec.id);
    if (err instanceof SaveDeclined) {
      this.removeRec(rec.id);
      this.pump();
      return;
    }
    if (run.transfer) rec.received = run.transfer.received;
    if (run.reason === 'pause' && run.resumeAfter && !this.quitting) {
      // Pause, then Resume before the connections had stopped: the last word wins.
      rec.state = 'queued';
      rec.queuedAt = queueStamp();
    } else if (run.reason === 'pause' || run.reason === 'quit') rec.state = 'paused';
    else if (run.reason === 'cancel' || (err instanceof AbortedError && !run.reason)) this.markCancelled(rec);
    else {
      rec.state = 'failed';
      rec.error = describeError(err);
      if (!(err instanceof DownloadError) && !(err instanceof DiskError)) console.warn('Deer downloads: failed', rec.url, String(err));
    }
    this.touch(rec);
    this.settle(rec);
    this.save();
    this.pump();
  }

  private settle(rec: Rec): void {
    if (ACTIVE.includes(rec.state)) return;
    const view = this.view(rec, false);
    for (const resolve of this.settled.get(rec.id) ?? []) resolve(view);
    this.settled.delete(rec.id);
  }

  private markCancelled(rec: Rec): void {
    rec.state = 'cancelled';
    rec.finishedAt = Date.now();
    this.removeParts(rec);
    this.rewind(rec);
    this.touch(rec);
    this.settle(rec);
    this.save();
  }

  /** Back to the start: no partial file, no place on disk, no measurements (Retry after Cancel, Download again). */
  private rewind(rec: Rec): void {
    rec.file = null;
    if (rec.stream) {
      const s = rec.stream;
      rec.stream = StreamTransfer.fresh(s.sourceUrl, { format: s.format, variantUrl: s.variantUrl, audioUrl: s.audioUrl, dashVideo: s.dashVideo, dashAudio: s.dashAudio, audioOnly: s.audioOnly, bytes: s.expected });
    }
    rec.received = 0;
    rec.path = '';
    rec.netBytes = 0;
    rec.activeMs = 0;
    rec.peak = 0;
    rec.note = '';
  }

  /** Deer's own unfinished files, never the finished one. */
  private removeParts(rec: Rec): void {
    if (!rec.path || rec.mode === 'browser') return;
    if (rec.mode === 'ytdlp') {
      ytdlpParts(rec.path).then((parts) => {
        for (const p of parts) IOUtils.remove(p, { ignoreAbsent: true }).catch(() => undefined);
      });
      return;
    }
    const parts =
      rec.mode === 'stream' && rec.stream ? [...rec.stream.tracks.map((t) => trackPart(stem(rec.path), t)), `${stem(rec.path)}.merge.part`] : [`${rec.path}.part`];
    for (const p of parts) IOUtils.remove(p, { ignoreAbsent: true }).catch(() => undefined);
  }

  // ---- commands ----

  pause(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    const run = this.runs.get(id);
    if (rec.state === 'queued') {
      rec.state = 'paused';
      this.warm.get(id)?.dropPending();
      this.warm.delete(id);
    } else if (rec.state === 'starting') {
      rec.hold = true;
      return;
    } else if (run && rec.state === 'downloading') {
      if (run.firefox) {
        run.firefox.cancel().catch(() => undefined);
        rec.state = 'paused';
      } else {
        if (run.reason === 'cancel') return;
        run.reason = 'pause';
        run.resumeAfter = false;
        run.ac.abort();
        // It reads as paused at once (view()), so a quick second press means Resume.
        this.touch(rec);
        return;
      }
    } else return;
    this.touch(rec);
    this.settle(rec);
    this.save();
    this.pump();
  }

  resume(id: string, now = false): void {
    const rec = this.find(id);
    if (!rec) return;
    if (rec.state === 'completed') {
      // Download again: only when the finished file is gone.
      if (rec.path && existsSync(rec.path)) return;
      this.rewind(rec);
      rec.startedAt = Date.now();
      rec.finishedAt = 0;
      rec.state = 'failed';
    }
    const run = this.runs.get(id);
    if (run && !run.firefox && run.reason === 'pause' && rec.state === 'downloading') {
      // Still stopping after a pause: it goes back in the queue once its connections are closed.
      run.resumeAfter = true;
      this.touch(rec);
      return;
    }
    if (rec.state === 'starting') {
      // A take-over still asking the server: undo a pause asked meanwhile.
      rec.hold = false;
      return;
    }
    if (rec.mode === 'browser') {
      if (run?.firefox && rec.state === 'paused') {
        run.firefox.start().catch(() => undefined);
        rec.state = 'downloading';
        this.touch(rec);
        return;
      }
      if (run) return;
      if (!/^https?:/i.test(rec.url)) {
        // blob: and data: addresses only ever lived in the page that made them.
        rec.state = 'failed';
        rec.error = 'Start this download again from its page.';
        this.touch(rec);
        this.save();
        return;
      }
      // Firefox can't carry on: start over with Deer's engine.
      rec.mode = 'file';
      rec.file = null;
      rec.path = '';
    }
    if (!['paused', 'failed', 'cancelled', 'queued'].includes(rec.state)) return;
    // Retry of a blocked download: it is fetched (and checked) again.
    if (rec.blocked) this.dropQuarantine(rec);
    rec.state = 'queued';
    rec.queuedAt = now ? 1 : queueStamp();
    rec.error = '';
    this.touch(rec);
    if (now && !this.runs.has(id)) this.launch(rec);
    this.pump();
    this.save();
  }

  cancel(id: string): void {
    const rec = this.find(id);
    if (!rec || FINISHED.includes(rec.state)) return;
    const run = this.runs.get(id);
    if (run) {
      run.reason = 'cancel';
      if (run.firefox) {
        const d = run.firefox;
        this.runs.delete(id);
        void this.dropFirefox(this.firefoxList, d, d.target?.path ?? '');
        this.markCancelled(rec);
        this.pump();
      } else run.ac.abort();
      return;
    }
    this.warm.get(id)?.dropPending();
    this.warm.delete(id);
    this.markCancelled(rec);
    this.pump();
  }

  /** Take the row off the list (never the finished file). */
  remove(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    if (!FINISHED.includes(rec.state)) this.cancel(id);
    // A blocked file was never the person's: it goes with its row.
    this.dropQuarantine(rec);
    this.removeRec(id);
  }

  private removeRec(id: string): void {
    this.recs = this.recs.filter((r) => r.id !== id);
    this.dirty.delete(id);
    this.emit({ kind: 'removed', ids: [id] });
    this.save();
  }

  clearFinished(isPrivate?: boolean): void {
    const gone = this.recs.filter((r) => FINISHED.includes(r.state) && (isPrivate === undefined || r.identity.isPrivate === isPrivate)).map((r) => r.id);
    if (!gone.length) return;
    for (const r of this.recs) if (gone.includes(r.id)) this.dropQuarantine(r);
    this.recs = this.recs.filter((r) => !gone.includes(r.id));
    this.emit({ kind: 'removed', ids: gone });
    this.save();
  }

  pauseAll(isPrivate?: boolean): void {
    for (const r of [...this.recs]) if (ACTIVE.includes(r.state) && (isPrivate === undefined || r.identity.isPrivate === isPrivate)) this.pause(r.id);
  }

  resumeAll(isPrivate?: boolean): void {
    for (const r of [...this.recs].reverse()) if (r.state === 'paused' && (isPrivate === undefined || r.identity.isPrivate === isPrivate)) this.resume(r.id);
  }

  setLimit(id: string, kbps: number): void {
    const rec = this.find(id);
    if (!rec) return;
    rec.limitKBps = Math.max(0, Math.round(kbps));
    this.touch(rec);
    this.save();
  }

  /** Open the finished file. Returns '' or why it couldn't. */
  open(id: string): string {
    const rec = this.find(id);
    if (!rec || rec.state !== 'completed') return 'The file isn’t ready.';
    if (!existsSync(rec.path)) {
      this.touch(rec);
      return 'The file was moved or deleted.';
    }
    // An executable that is not an .exe asks first (reputation.ts mayLaunch), then opens.
    const path = rec.path;
    void mayLaunch(path, rec.url).then((ok) => {
      if (ok) platform.openFile(path);
    });
    return '';
  }

  showInFolder(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    const part = rec.mode === 'stream' && rec.stream?.tracks[0] ? trackPart(stem(rec.path), rec.stream.tracks[0]) : `${rec.path}.part`;
    if (rec.path && existsSync(rec.path)) platform.showInFolder(rec.path);
    else if (rec.path && existsSync(part)) platform.showInFolder(part);
    else platform.openFolder(rec.dir);
    if (rec.state === 'completed') this.touch(rec);
  }

  openFolder(): void {
    platform.openFolder(settings().downloadsFolder || Services.dirsvc.get('DfltDwnld', Ci.nsIFile).path);
  }

  copyAddress(id: string): void {
    const rec = this.find(id);
    if (rec) platform.copyText(rec.url);
  }

  clipboardUrl(): string | null {
    return platform.clipboardUrl();
  }

  ffmpeg(): Promise<FfmpegInfo> {
    // Read fresh: a window's settings page asks right after the person chose a file.
    return findFfmpeg(String(VitreSettings.get().ffmpegPath ?? ''));
  }

  /**
   * Download, check and unpack ffmpeg for the person (Settings › Video downloads), then use it:
   * vitre.ffmpegPath points at the new ffmpeg.exe. Resolves with its path; see downloads/ffmpeg-install.ts.
   */
  async installFfmpeg(): Promise<string> {
    const exe = await installFfmpeg();
    forgetFfmpeg();
    VitreSettings.set({ ffmpegPath: exe });
    return exe;
  }

  /** The ffmpeg install: idle, checking, downloading (bytes), verifying, unpacking, done, failed, cancelled. */
  ffmpegInstall(): FfmpegInstallState {
    return ffmpegInstallState();
  }

  /** Called on every change of the ffmpeg install state; returns the unsubscribe. */
  onFfmpegInstall(fn: (s: FfmpegInstallState) => void): () => void {
    return onFfmpegInstall(fn);
  }

  cancelFfmpegInstall(): void {
    cancelFfmpegInstall();
  }

  /** yt-dlp and Deno are installed (Settings › Video downloads). */
  hasYtdlp(): boolean {
    return !!ytdlpTools();
  }

  /**
   * Where Deer downloads ffmpeg and yt-dlp + Deno to (ffmpeg, tools: %LOCALAPPDATA%\Deer\...), the
   * folders it still reads from before the rename (oldFfmpeg, oldTools: %LOCALAPPDATA%\Vitre\...,
   * never written) and the folder the yt-dlp in use was found in ('' when none, or a stand-in command).
   */
  toolFolders(): { ffmpeg: string; tools: string; oldFfmpeg: string; oldTools: string; ytdlpFrom: string } {
    const tools = ytdlpTools();
    const exe = tools?.deno ? tools.command[0] : ''; // a stand-in command has no Deno
    return { ffmpeg: ffmpegInstallDir(), tools: toolsDir(), oldFfmpeg: oldFolder('ffmpeg'), oldTools: oldToolsDir(), ytdlpFrom: exe ? (PathUtils.parent(exe) ?? '') : '' };
  }

  /** Install (or with `update`, refresh) yt-dlp and Deno; see downloads/ytdlp.ts. */
  installYtdlp(update = false): Promise<void> {
    return installTools(update);
  }

  ytdlpInstall(): ToolsState {
    return toolsInstallState();
  }

  onYtdlpInstall(fn: (s: ToolsState) => void): () => void {
    return onToolsInstall(fn);
  }

  cancelYtdlpInstall(): void {
    cancelToolsInstall();
  }

  /** "yt-dlp 2026.08.19 · Deno 2.9.7", or '' when they are not installed. */
  ytdlpVersion(): Promise<string> {
    return toolsVersion();
  }

  pickSavePath = platform.pickSavePath;
  pickFolder = platform.pickFolder;
  pickProgram = platform.pickProgram;

  // ---- progress ----

  private makeRun(): Run {
    return { ac: new AbortController(), reason: null, transfer: null, firefox: null, samples: [], speed: 0, phase: '', last: Date.now() };
  }

  /** Everything a transfer needs from its download. */
  private env(rec: Rec, _run: Run): TransferEnv {
    const own = new RateLimiter(() => rec.limitKBps || 0);
    return {
      identity: new Identity(rec.identity),
      limiters: [this.global, own],
      connections: () => Math.max(1, Math.min(32, Number(settings().connections) || 8)),
      onBytes: (n) => {
        rec.netBytes += n;
      },
    };
  }

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK);
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, run] of this.runs) {
      const rec = this.find(id);
      if (!rec) continue;
      const dt = now - run.last;
      run.last = now;
      if (run.firefox) {
        rec.received = Number(run.firefox.currentBytes) || 0;
        run.speed = rec.state === 'downloading' ? Number(run.firefox.speed) || 0 : 0;
        rec.netBytes = rec.received;
      } else if (run.transfer) {
        rec.received = run.transfer.received;
        rec.total = run.transfer instanceof StreamTransfer || run.transfer instanceof YtdlpTransfer ? run.transfer.estimate : run.transfer.state.total;
        run.samples.push({ t: now, bytes: rec.netBytes });
        while (run.samples.length > 2 && now - run.samples[0].t > 3000) run.samples.shift();
        const first = run.samples[0];
        const span = (now - first.t) / 1000;
        run.speed = span >= 0.5 ? (rec.netBytes - first.bytes) / span : run.speed;
      }
      if (rec.state === 'downloading' && !run.phase) {
        rec.activeMs += dt;
        rec.peak = Math.max(rec.peak, run.speed);
      }
      this.dirty.add(id);
    }
    this.flush();
    if (now - this.lastSave > SAVE_EVERY && this.runs.size) this.save();
    if (!this.runs.size && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private touch(rec: Rec): void {
    this.dirty.add(rec.id);
    this.flushSoon();
  }

  private flushSoon(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 60);
  }

  private flush(): void {
    if (!this.dirty.size) return;
    const views = [...this.dirty]
      .map((id) => this.find(id))
      .filter((r): r is Rec => !!r)
      .map((r) => this.view(r, r.state === 'completed'));
    this.dirty.clear();
    if (views.length) this.emit({ kind: 'update', views });
  }

  private view(r: Rec, checkDisk: boolean): DownloadView {
    const run = this.runs.get(r.id);
    const t = run?.transfer ?? null;
    const s = settings();
    // A pause still closing its connections already reads as paused (a quick Resume then queues it again).
    const pausing = !!run && !run.firefox && run.reason === 'pause' && !run.resumeAfter && r.state === 'downloading';
    const speed = run && r.state === 'downloading' && !pausing ? run.speed : 0;
    const total = t instanceof StreamTransfer || t instanceof YtdlpTransfer ? t.estimate : r.mode === 'stream' && r.stream ? streamEstimate(r.stream) : r.mode === 'ytdlp' ? Math.max(r.total, r.ytdlp?.expected ?? 0) : r.total;
    const received = t ? t.received : r.received;
    const left = total > 0 ? total - received : -1;
    const queued = this.recs.filter((x) => x.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    const fills = r.mode === 'stream' && r.stream ? streamFills(r.stream) : r.file ? fileFills(r.file) : [];
    const multi = r.mode === 'stream' || (!!r.file?.ranges && r.file.total >= 8 * 1024 * 1024);
    const connections = Math.max(1, Math.min(32, Number(s.connections) || 8));
    return {
      id: r.id,
      url: r.url,
      pageUrl: r.identity.pageUrl,
      filename: r.filename,
      dir: r.dir,
      path: r.path,
      category: categoryOf(r.filename, r.mime),
      state: pausing ? 'paused' : r.state,
      phase: pausing ? '' : (run?.phase ?? ''),
      received,
      total,
      speed,
      peak: r.peak,
      average: r.activeMs >= 250 ? r.netBytes / (r.activeMs / 1000) : 0,
      eta: speed > 0 && left >= 0 ? Math.round(left / speed) : -1,
      connections: run?.firefox ? (r.state === 'downloading' ? 1 : 0) : (t?.live ?? 0),
      maxConnections: r.mode === 'browser' || r.mode === 'ytdlp' ? 1 : multi ? Math.min(r.mode === 'stream' ? 16 : 32, connections) : 1,
      resumable: r.mode === 'stream' || r.mode === 'ytdlp' || (r.mode === 'file' ? !r.file?.probed || !!r.file.ranges : !!run?.firefox?.hasPartialData),
      stream: r.mode === 'stream' || r.mode === 'ytdlp',
      segments: fills,
      error: r.error,
      note: r.note ?? '',
      missing: checkDisk && r.state === 'completed' && !!r.path && !existsSync(r.path),
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      quality: r.quality,
      videoKey: r.videoKey,
      limitKBps: r.limitKBps,
      queuePos: r.state === 'queued' ? queued.indexOf(r) + 1 : 0,
      engine: r.mode === 'browser' ? 'browser' : 'vitre',
      isPrivate: r.identity.isPrivate,
      blocked: r.state === 'failed' ? (r.blocked ?? '') : '',
      keepable: r.state === 'failed' && !!r.quarantine,
    };
  }

  // ---- persistence ----

  private persisted(): { version: number; items: Rec[] } {
    return {
      version: STORE_VERSION,
      items: this.recs
        .filter((r) => !r.identity.isPrivate)
        .map((r) => {
          const t = this.runs.get(r.id)?.transfer;
          // A running transfer is saved as what is certainly on disk, not what is still in a pipe.
          if (t instanceof FileTransfer) {
            const file = t.snapshot();
            return { ...r, file, received: file.segments.reduce((n, seg) => n + seg.received, 0) };
          }
          if (t instanceof StreamTransfer) {
            const stream = t.snapshot();
            return { ...r, stream, received: stream.tracks.reduce((n, x) => n + x.bytes, 0) };
          }
          return { ...r };
        }),
    };
  }

  /** Atomic: written to a temp file, then moved over the store. */
  save(): Promise<void> {
    this.lastSave = Date.now();
    if (!this.storePath) return this.saving;
    const data = this.persisted();
    this.saving = this.saving.then(() => IOUtils.writeJSON(this.storePath, data, { tmpPath: this.storePath + '.tmp' })).catch((e: unknown) => console.error('Deer downloads: store write failed', e));
    return this.saving;
  }

  // ---- lifecycle ----

  /** The window that shows the quit prompt registers here (and unregisters when it closes). */
  setQuitPrompt(win: any, fn: QuitPrompt | null): void {
    if (fn) this.prompts.set(win, fn);
    else this.prompts.delete(win);
  }

  /** The person chose to quit anyway: the next quit request goes through. */
  confirmQuit(): void {
    this.quitConfirmed = true;
    setTimeout(() => {
      this.quitConfirmed = false;
    }, 10000);
  }

  private privateConfirmed = false;

  /**
   * The person chose to close the last private window anyway: its downloads are cancelled now
   * (as Firefox cancels its own private downloads there) and the next close goes through.
   */
  confirmPrivateClose(): void {
    this.privateConfirmed = true;
    for (const r of [...this.recs]) if (r.identity.isPrivate && !FINISHED.includes(r.state)) this.cancel(r.id);
    setTimeout(() => {
      this.privateConfirmed = false;
    }, 10000);
  }

  /** Private downloads that are running or waiting to. */
  private privateRunning(): number {
    return this.recs.filter((r) => r.identity.isPrivate && ACTIVE.includes(r.state)).length;
  }

  private installLifecycle(): void {
    // Asked before a quit: Exit (no data), closing the last window ("lastwindow"), a restart
    // ("restart"). Setting the nsISupportsPRBool refuses it; the window's prompt asks the person.
    Services.obs.addObserver((subject: any, _topic: string, data: string) => {
      try {
        const cancel = subject.QueryInterface(Ci.nsISupportsPRBool);
        // Private downloads the person already agreed to cancel (closing the last private window) don't count.
        const priv = this.privateConfirmed ? 0 : this.privateRunning();
        const count = this.runningCount() - (this.privateConfirmed ? this.privateRunning() : 0);
        if (cancel.data || count <= 0 || this.quitConfirmed || this.quitting) return;
        const kind = data === 'lastwindow' ? 'lastwindow' : /restart/.test(data ?? '') ? 'restart' : 'quit';
        const recent = Services.wm.getMostRecentWindow('navigator:browser');
        const prompt = this.prompts.get(recent) ?? [...this.prompts.values()][0];
        if (!prompt) return;
        cancel.data = true;
        setTimeout(() => prompt(kind, count, priv), 0);
      } catch (e) {
        console.error('Deer downloads: quit guard failed', e);
      }
    }, 'quit-application-requested');
    // The last private window is closing (browser.js WindowIsClosing notifies
    // "last-pb-context-exiting" with an nsISupportsPRBool; Firefox's DownloadIntegration asks there
    // for its own private downloads, which Deer took over, so it would not ask): refuse, and the
    // private window's prompt asks whether to cancel them.
    Services.obs.addObserver((subject: any) => {
      try {
        const cancel = subject.QueryInterface(Ci.nsISupportsPRBool);
        const count = this.privateRunning();
        if (cancel.data || !count || this.privateConfirmed || this.quitting) return;
        const recent = Services.wm.getMostRecentWindow('navigator:browser');
        const isPrivate = (w: any): boolean => {
          try {
            return !!w?.docShell?.QueryInterface(Ci.nsILoadContext).usePrivateBrowsing;
          } catch {
            return false;
          }
        };
        const win = isPrivate(recent) && this.prompts.has(recent) ? recent : [...this.prompts.keys()].find((w) => isPrivate(w) && !w.closed);
        const prompt = win ? this.prompts.get(win) : undefined;
        if (!prompt) return;
        cancel.data = true;
        setTimeout(() => prompt('private', count, count), 0);
      } catch (e) {
        console.error('Deer downloads: private window guard failed', e);
      }
    }, 'last-pb-context-exiting');
    // The quit is going ahead: stop everything where it is (resumable).
    Services.obs.addObserver(() => {
      this.quitting = true;
      void this.shutdown();
    }, 'quit-application-granted');
    // Whatever happens, the list (with every segment's progress) is on disk before the profile closes.
    AsyncShutdown.profileBeforeChange.addBlocker('Deer downloads: pause transfers and save the list', () => this.shutdown());
    // The last private window closed: its downloads go from the list, as in Firefox.
    Services.obs.addObserver(() => {
      for (const r of [...this.recs]) {
        if (!r.identity.isPrivate) continue;
        if (!FINISHED.includes(r.state)) this.cancel(r.id);
        this.removeRec(r.id);
      }
    }, 'last-pb-context-exited');
  }

  private shuttingDown: Promise<void> | null = null;

  /** Stop every transfer where it is (resumable) and write the store. */
  shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = (async () => {
      this.quitting = true;
      const waits: Promise<unknown>[] = [];
      for (const [id, run] of this.runs) {
        const rec = this.find(id);
        if (!rec) continue;
        if (run.firefox) {
          rec.state = 'failed';
          rec.error = 'Interrupted when Deer closed.';
          continue;
        }
        run.reason = 'quit';
        run.ac.abort();
        waits.push(this.whenSettled(id));
      }
      await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 5000))]);
      await this.save();
    })();
    return this.shuttingDown;
  }
}

function streamPartsExist(p: string): boolean {
  const base = stem(p);
  return ['.video.part', '.audio.part'].some((ext) => existsSync(base + ext));
}

export const VitreDownloads = new Manager();
