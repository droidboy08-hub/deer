// Deer's downloader: the process-wide engine. It belongs to no window, so downloads carry on while
// windows open and close; every window's UI (src/window/modules/downloads) subscribes to it.
// Port of app/src/main/modules/downloads/manager.ts onto the verified Gecko prototype
// (spikes/downloader/verify/engine/*.sys.mjs, recipe spikes/downloader/RESULT.md + corrections).
//
// Contract (window code: b.sys('VitreDownloads')):
//   init()                         idempotent; installs the take-over, media watch, quit guard. ready: Promise
//   list(isPrivate?)               DownloadView[] (src/modules/downloads/types.ts), newest first per state
//   subscribe(fn)                  fn(DownloadEvent): 'added' (with the source tab's browserId and the
//                                  flight origin), 'update' (about four a second while running), 'removed',
//                                  'attached' (a start again continued a waiting row: it flies like 'added')
//   start(url, StartOptions)       a download Deer starts itself (picker, Add link, menus, Alt+click); id
//   pause / resume(id, now?) / cancel / remove / clearFinished / pauseAll / resumeAll / setLimit(id, kbps)
//   open(id) / showInFolder(id) / openFolder() / copyAddress(id) / clipboardUrl()
//   keep(id)                       a download Safe Browsing blocked as uncommon or unwanted: the person
//                                  keeps it anyway (its quarantined file takes its name)
//   startOver(id, url?)            a File changed row (view.need 'choice') downloads the file the site
//                                  has now; the old partial waits as "<name>.old.part" until it completes.
//                                  With url: a paused file row starts over from that address instead
//                                  ("Use it and start over")
//   setAddress(id, url)            "Use another address…": a paused file row continues from a pasted
//                                  address that proves to be the same file; AddressResult (types.ts)
//   refreshAddress(id)             Refresh address: a renewal attempt at once; RefreshResult (types.ts)
//                                  'page' asks the window to open the download's page, then arm it
//   arm(id, browserId) / stopWaiting(id)
//                                  Waiting for link: for 30 minutes a start of the download again on its
//                                  page (that tab scores most) continues the row / no longer
//   openPage(id)                   PageTarget (types.ts): the download's page, its container and privacy,
//                                  and whether the window arms the row once the tab is open
//   keepPartial(id) / decide(id, 'start-over' | 'keep-partial')
//                                  File changed: the unbroken beginning kept as "<stem> (partial).<ext>"
//                                  (a completed row), or Start over (startOver(id))
//   checkFile(id) / repair(id) / restoreOriginal(id) / downloadAgain(id)
//                                  a completed row (RESUME-DESIGN.md 4.2, 4.3, Phase 5): Check file hashes it
//                                  again against its block record (Damaged: view.need 'repair'; Changed after
//                                  download: view.check.edited); Repair fetches only the damaged parts again;
//                                  Restore original puts an edited file back; Download again is a new row
//   hooks.beforeMerge(id) / hooks.afterMerge(id)
//                                  tests only: awaited once a stream's merge phase is saved and before ffmpeg
//                                  runs / between the merge and the save that completes the row (the merge
//                                  crash window, RESUME-DESIGN.md G4)
//   hooks.beforePlace(id)          tests only: awaited once a one-file download's final seal is done, before
//                                  its .part is renamed (a Pause or Cancel then still stops it)
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
//   - Never lose or mix bytes (spikes/downloader/RESUME-DESIGN.md, Phase 1): a download whose address
//     now refuses it or answers with a page pauses as Link expired (need 'address') with its bytes;
//     one whose file changed on the site pauses as File changed (need 'choice') with its .part
//     untouched, unless under 1 MiB was saved (it then starts again by itself, at most twice in ten
//     minutes). The store keeps a .bak of its previous copy and is flushed on state changes.
//   - Renewing an address (RESUME-DESIGN.md Phase 2, downloads/renew.ts): a file download whose address
//     refuses or expires asks its original address and redirect hops again; one that proves to be the
//     same file (downloads/proof.ts) is adopted and the download carries on from its segments. Found
//     nowhere: Link expired, tried again by itself 2 min, 15 min, 1 h and 6 h after the failure
//     (rec.wait, one timer for the earliest), or from an address the person pastes (setAddress).
//   - Starting it again on its page (RESUME-DESIGN.md G1 manual fallback, Phase 3; downloads/attach.ts):
//     Refresh address runs a renewal attempt, then the window opens the download's page in a foreground
//     tab and arms the row (Waiting for link, 30 minutes, rec.catcher). A download started again (a click
//     Firefox hands over, Alt+click, Add link, Download copied link, the 'downloads' service) in the same
//     privacy and container is scored against the rows that wait for an address (preMatch); a pre-match
//     is held back (no 'added') until the byte proof says: the same file continues the old row (Firefox's
//     copy is dropped, no new row, 'attached'); the same name with other bytes makes it File changed (the
//     new address kept for Start over); anything else goes on as before. File changed can also keep the
//     unbroken beginning of its part (keepPartial). Rows Firefox moves itself (a form's answer, a
//     one-time link, blob:, data:, an extension's) are never fetched again by Deer: Retry asks for their
//     page (need 'page'), and why Deer left them to Firefox is kept on the record (rec.origin).
//   - Network, sleep and restarts (RESUME-DESIGN.md G4, Phase 4; downloads/waits.ts). A download whose
//     site can't be reached waits (Waiting for network, wait 'network'; only the Necko failures net.ts
//     classify() lists: others, a blocked port or a redirect loop, fail as before): tried again 10 s,
//     30 s, 1 min, 2 min and 5 min after each failure, then every 10 min, and it never fails by itself;
//     network link-up or wake brings the next try to 5 s. A site that answers 5xx or 429 waits the same
//     way (Retrying, wait 'server'), never before its Retry-After, and fails as before 24 h after its
//     first 5xx or 429. Network and server failures share one count (a site that drops some tries and
//     answers 503 to others still backs off), which starts again after 8 MiB of progress or on the
//     person's Try now. A run stops into its wait only once every connection has closed its writer, so
//     the counts it keeps are exact; a Retry-After over a minute stops the run at once, and a wait's own
//     try stops its check at the first 429 or 5xx. That try keeps the wait on the record until its check
//     passed (rec.trying): it never holds a quit back, and a quit or a crash before then leaves the row
//     waiting. Sleep pauses what runs (wait 'sleep'); after the wake it queues again on link-up or 10 s
//     later, through Checking. Pause ends a wait; Try now is resume(id, true). The one wait timer
//     (armWaits) serves every kind.
//   - Quit while downloads run: refused (quit-application-requested), the window shows its prompt;
//     a quit that goes ahead pauses everything, resumable, and the list (with every segment) is
//     written before the profile closes. Unfinished downloads come back paused; those the quit stopped
//     (rec.resumeOnStart) continue 10 s after the first window opens while "Continue unfinished
//     downloads when Deer starts" is on (the default, G4); rows the person paused stay paused, and
//     waiting rows always continue. The store's session is unclean until the last save at quit: after
//     a crash, the rows that were running continue the same way and fetch again the last 8 MiB below
//     each segment's mark (rec.suspect), unless the download has its block hash record (Phase 5, below).
//     A stream's merge saves its phase and output path (flushed) before ffmpeg runs: after a crash an
//     output in place completes the row (the parts left go), or the parts are merged again.
//   - The block hash record (RESUME-DESIGN.md section 4, 5.7; Phase 5; downloads/ledger.ts, finished.ts).
//     A one-file download of known length keeps <profile>/vitre-downloads/<id>.jsonl (in memory only for a
//     private one): every block of the .part is hashed once it is certainly written. A run marks the file
//     dirty (saved, flushed) before it writes; a seal (the .part flushed through FlushFileBuffers when it
//     can be, a seal line, a flushed save) runs every 30 s or 256 MiB, before the final rename and at every
//     stop, and a clean stop drains the hashing, seals and clears the mark. Every resume checks its saved
//     part first (inspect(), Checking): the last 2 hashed blocks below each frontier and 2 placed by the id;
//     every block when the .part was modified while nothing ran; after an unclean stop (still dirty), what
//     each segment claims above its last hashed block is given back and the blocks hashed since the last
//     seal (2 minutes before it when the flush was not proven) are checked again. Bad blocks are released
//     (the split saved, flushed, before anything is fetched) and fetched again, and must hash to their old
//     value (otherwise File changed). A missing .part starts over, saying so. A finished file keeps its record
//     as <id>.done.jsonl with its SHA-256, computed once (checked against a server checksum, reused by Safe
//     Browsing). Check file, Repair (only the damaged blocks, each checked against the record before it is
//     written), Restore original, Changed after download (modified after it finished: never damage); after an
//     unclean session the files finished in it are checked by themselves. If the store and its .bak are both
//     lost, the rows come back from the journals.
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
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { findFfmpeg, forgetFfmpeg } from './downloads/ffmpeg';
import { cancelFfmpegInstall, ffmpegInstallDir, ffmpegInstallState, installFfmpeg, oldFolder, onFfmpegInstall, type FfmpegInstallState } from './downloads/ffmpeg-install';
import { DRM_MESSAGE, StreamTransfer, streamEstimate, streamFills, trackPart, type StreamState } from './downloads/hls';
import { RateLimiter } from './downloads/limiter';
import { MediaWatch } from './downloads/media';
import { MEDIA_URL } from './downloads/media-url';
import { PRE_MATCH, partialName, realFile, score, unbroken, type Named } from './downloads/attach';
import { categoryOf, chooseName, extOf, nameFromDisposition, nameFromUrl, sanitize, streamTitle, uniquePath } from './downloads/naming';
import { checkFinished, damagedFills, editedSince, mediaCheck, repairFinished, restoreFinished, siteCompare, statOf, type RepairOutcome } from './downloads/finished';
import { Ledger, MTIME_SLACK, SEAL_BYTES, SEAL_EVERY, SEAL_MIN_GAP, UNFLUSHED_MARGIN, blockSize, flushPart, type Header } from './downloads/ledger';
import { AbortedError, ChangedError, DiskError, DownloadError, HttpStatusError, Identity, classify, describeError } from './downloads/net';
import { existsSync, fileFor, setSize, sizeOf } from './downloads/partfile';
import type { Segment } from './downloads/ranged';
import * as platform from './downloads/platform';
import { ASK_ABOVE, UNSURE, compareWindows, proveAddress, readKind, sizeText, windows, type Candidate, type Found } from './downloads/proof';
import { asPolicy, readReferrerInfo } from './downloads/referrer';
import { hashWanted, mayLaunch, reputationOf, type Verdict } from './downloads/reputation';
import { FileTransfer, fileFills, hasRoom, silentRestart, type FileState, type TransferEnv } from './downloads/ranged';
import { FORGET_FAILURE, Gate, addresses, adopt, nextTry, originalAddress, type AttachHow, type Outcome, type RenewWhy, type Renewed } from './downloads/renew';
import type { AddressResult, DownloadEvent, DownloadState, DownloadView, FfmpegInfo, IdentityJSON, NeedKind, PageTarget, RefreshResult, StartOptions, WaitFor } from './downloads/types';
import { CONTINUE_AFTER, FRESH_AFTER, SERVER_GIVE_UP, SLEEP_FALLBACK, SOON, WAKE_SETTLE, rewindTails, waitNext } from './downloads/waits';
import { YtdlpTransfer, cancelToolsInstall, installTools, oldToolsDir, onToolsInstall, toolsDir, toolsInstallState, toolsVersion, ytdlpParts, ytdlpTools, type ToolsState, type YtdlpState } from './downloads/ytdlp';

declare global {
  interface VitreSysModules {
    VitreDownloads: typeof VitreDownloads;
  }
}

const MAX_ACTIVE = 2;
const TICK = 250;
const SAVE_EVERY = 2000;
/** While downloads run, a save reaches the disk (flushed) at least this often (RESUME-DESIGN.md 5.6). */
const FLUSH_EVERY = 30000;
/**
 * 2 (RESUME-DESIGN.md 5.6): {version, session, items}, written with a .bak of the previous copy and
 * flushed on state changes. Version 1 files load (load() fills in what they lack).
 */
const STORE_VERSION = 2;
/** Attempts of the schedule that fell due while Deer was closed wait this long after start (renewing, Phase 2). */
const WAIT_GRACE = 5000;
/** How long Refresh address waits for the download to be started again on its page (RESUME-DESIGN.md G1). */
const CATCH_FOR = 30 * 60 * 1000;
/** Checking shows only once a resume's check took this long, so a quick resume never flickers (RESUME-DESIGN.md 6). */
const CHECKING_AFTER = 400;
/** A finished file's hashing waits this long first, and then while a download goes very fast (whileFast()), at most FAST_WAIT. */
const FAST_LOOK = 1000;
const FAST_WAIT = 5 * 60 * 1000;
/** Link-up or wake does not bring an exhausted Link expired schedule's attempt within this long of the last one (G4). */
const RENEW_ON_LINK = 10 * 60 * 1000;
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

/**
 * Why the take-over left a download to Firefox (rec.origin.reason, RESUME-DESIGN.md G1 browser-mode
 * rows): blob: or data:; an extension started it; it was saved where Firefox was told; Deer's own request
 * got a page or an error (a form's answer, a one-time link).
 */
type LeftReason = 'not-http' | 'extension' | 'saved-elsewhere' | 'needs-request';

/** Start it again from its page (need 'page'): why, as the row's caption says it. */
const LEFT_WHY: Record<LeftReason, string> = {
  'not-http': 'the page made this file itself',
  extension: 'an extension started it',
  'saved-elsewhere': 'it was saved where Firefox was told',
  'needs-request': 'the site gives it only to its page’s own request',
};

type StartMode = 'file' | 'hls' | 'dash' | 'ytdlp';

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
  /**
   * The person must act; the row is paused and nothing is lost (RESUME-DESIGN.md 5.1, Phase 1 kinds):
   * 'address' = Link expired (the address refused or answers with a page), 'choice' = File changed.
   */
  need?: { kind: NeedKind; since: number; status?: number; evidence?: string; candidate?: NeedCandidate };
  /**
   * Deer comes back to this paused row by itself (RESUME-DESIGN.md 5.1). Phase 2: 'address', the next
   * attempt to renew a Link expired row's address (renew.ts schedule): `tries` attempts so far, the
   * next at `nextAt` (0: none planned). Saved with the row, so the schedule survives restarts.
   */
  wait?: WaitState;
  /**
   * The network or server wait whose automatic try is running (RESUME-DESIGN.md G4, review of Phase 4),
   * kept on the record until the try got past its check: a quit or a crash before that leaves the row
   * waiting (waiting rows always continue, whatever the setting says), and the try never holds a quit
   * back (runningCount()). Past its check the run is a download like any other.
   */
  trying?: WaitState;
  /**
   * An attempt of the schedule proved an address and attached it: the `tries` the next Link expired
   * takes if the run it queued fails before it saves a byte, so a host that passes the proof but
   * refuses the transfer still runs out of attempts (review of Phase 2). Cleared once a run saves bytes
   * and by any manual action.
   */
  renewTries?: number;
  /** The last history lines (at most 5): every automatic fix leaves one (RESUME-DESIGN.md 6). */
  events?: { at: number; text: string }[];
  /** Start over kept the old partial files here ("<name>.old.part") until the new file completes (owner's decision 2). */
  oldParts?: string[];
  /**
   * Refresh address opened the download's page and waits for the person to start it again there
   * (RESUME-DESIGN.md 5.1, G1; Phase 3): until when, and the tab it opened (the strongest nominator,
   * preMatch()). Waiting for link while `until` is ahead. Not kept over a restart (browserIds are per
   * session).
   */
  catcher?: { until: number; browserId?: number };
  /**
   * How the download came (RESUME-DESIGN.md 5.1). Phase 3 sets it on the take-over's rows, with why Deer
   * left one to Firefox (`reason`), which today lived only in memory: Retry then asks for its page.
   */
  origin?: { kind: 'takeover'; reason?: LeftReason };
  /** Keep partial file is moving the .part to this name (written, flushed, before the move; load() undoes a move cut short). */
  keeping?: string;
  /**
   * A quit or a crash stopped it while it ran or waited its turn (RESUME-DESIGN.md 5.1, G4): it
   * continues CONTINUE_AFTER after the first window opens, while the setting is on. Cleared by that, by
   * any action of the person's and when it starts.
   */
  resumeOnStart?: boolean;
  /**
   * It was running when a session ended without its last save (G4 crash detection): `bytes`, the tail
   * below each segment's mark load() gave back to be fetched again (before Phase 5's hash record). Its
   * next run that passes its check says so in the history and clears it.
   */
  suspect?: { at: number; bytes: number };
  /**
   * The block hash record's journal (RESUME-DESIGN.md 5.7, Phase 5): <profile>/vitre-downloads/<id>.jsonl,
   * <id>.done.jsonl once the file is finished. Absent for a private download (its record stays in memory),
   * for a length never known, and for rows from before Phase 5.
   */
  journal?: string;
  /** The finished file's SHA-256 (hex), computed once at completion (RESUME-DESIGN.md 4.1). */
  sha256?: string;
  /** Its size and modified time once it finished (after the Mark of the Web): a later one is Changed after download (4.2). */
  final?: { size: number; mtime: number };
  /** The last Check file and what Repair found (RESUME-DESIGN.md 5.1 check). */
  check?: CheckState;
  /** Repair or Restore original was writing the file when it began (saved): a crash then has it checked at the next start (4.3). */
  repairing?: number;
}

/**
 * A finished file's last Check file (RESUME-DESIGN.md 4.2, Phase 5): `bad` damaged blocks of size `bs`;
 * `unlocated`, its checksum no longer matches and no record says where; `edited`, modified after it
 * finished (`changedAt`); `media`, what ffmpeg found wrong; `site` and `status`, what the last Repair
 * found at the site (another file, a link that stopped working, no answer).
 */
type CheckState = {
  at: number;
  ok: boolean;
  bad: number[];
  bs: number;
  badBytes: number;
  unlocated: boolean;
  edited: boolean;
  changedAt: number;
  media: string;
  site: '' | 'changed' | 'expired' | 'unreachable';
  status: number;
};

/**
 * A paused row's wait (Rec.wait; RESUME-DESIGN.md 5.1). `since`: when the wait began (a network and a
 * server wait are one: their failures share one count, review of Phase 4); `serverSince`: the first 5xx
 * or 429 of it, kept through the network failures between, which SERVER_GIVE_UP counts from.
 */
type WaitState = { for: WaitFor; since: number; nextAt: number; tries: number; status?: number; serverSince?: number };

/**
 * The address that gives the other version of a File changed row's file, kept for Start over
 * (RESUME-DESIGN.md 5.1). `identity`: the download was started again on its page (Phase 3), whose
 * requests (its page, cookies, container) Start over makes.
 */
type NeedCandidate = { url: string; finalUrl: string; total: number; etag: string; lastModified: string; contentType: string; identity?: IdentityJSON };

/** Why a finished file was blocked, as the row says it. */
const BLOCKED: Record<Exclude<Verdict, 'safe'>, string> = {
  dangerous: 'Removed: Safe Browsing reports this file as dangerous.',
  uncommon: 'Blocked: this file is not commonly downloaded and may be dangerous.',
  unwanted: 'Blocked: this file may make unwanted changes to your computer.',
};

interface Run {
  ac: AbortController;
  /** Why the run is being stopped: 'sleep', the computer is going to sleep (RESUME-DESIGN.md G4). */
  reason: 'pause' | 'cancel' | 'quit' | 'sleep' | null;
  transfer: FileTransfer | StreamTransfer | YtdlpTransfer | null;
  /** A download Firefox moves the bytes for (mode 'browser'). */
  firefox: any;
  samples: { t: number; bytes: number }[];
  speed: number;
  /** 'checking': a run with saved bytes asks its address before it continues (Checking, RESUME-DESIGN.md 6). */
  phase: '' | 'probing' | 'merging' | 'renewing' | 'checking';
  /** When `phase` began (Checking shows only after CHECKING_AFTER). */
  phaseAt?: number;
  /**
   * The network, server or sleep wait this run continues (RESUME-DESIGN.md G4): the count of a network or
   * server wait goes on if the run stops into either again (stopped(), waitAgain()), unless it made
   * FRESH_AFTER of progress.
   */
  waited?: WaitState;
  last: number;
  /** The in-run renewal hook's limits (renew.ts Gate), made on its first use. */
  gate?: Gate;
  /** The status that started this run's renewal (the Renewing link caption). */
  status?: number;
  /** Resume was asked while the pause was still stopping the connections: queue again once stopped. */
  resumeAfter?: boolean;
  /** Bytes saved when the run started: a run that ends with more made progress (renewTries). */
  saved0?: number;
  /** rec.netBytes at the run's last seal (a seal every SEAL_BYTES, RESUME-DESIGN.md 4.1). */
  sealBytes?: number;
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
  private lastFlushed = 0;
  private saving: Promise<void> = Promise.resolve();
  /** This session as the store records it; clean only in the save at quit (crash detection is Phase 4). */
  private session = { startedAt: Date.now(), clean: false };
  /** Rows whose Start over is writing its decision (startOver()). */
  private deciding = new Set<string>();
  /** Rows whose address is being renewed outside a run (an attempt of the schedule, a pasted address), with its stop. */
  private renewing = new Map<string, AbortController>();
  /** When a row's last renewal found nothing: not asked again within FORGET_FAILURE (renew.ts). */
  private renewFailed = new Map<string, number>();
  /**
   * The probes of Firefox downloads that pre-matched a waiting row (adopt(), Phase 3): no row's run, so
   * they hold no download slot (pump() counts runs); a quit stops them.
   */
  private holding = new Set<Run>();
  /**
   * Rows whose `renewing` entry is the person's address being proven (a pasted one, setAddress(); a
   * download started again, proveFor()), not an attempt of the schedule: a start again never takes such
   * a row, but it does take one an attempt of the schedule is renewing (review of Phase 3).
   */
  private proving = new Set<string>();
  /**
   * The one timer for the earliest wait.nextAt (RESUME-DESIGN.md 3.0): the ticker stops when nothing
   * runs, so waiting rows have their own. Re-armed at load and on every save.
   */
  private waitTimer: any = null;
  private loadedAt = 0;
  /** Whether the session before this one ended with its last save (RESUME-DESIGN.md G4 crash detection). */
  prevClean = true;
  /** Streams whose merge finished before a crash, the output there and the parts gone (load()): completed at init. */
  private joined: Rec[] = [];
  /** continueAfterStart(), CONTINUE_AFTER after the engine started (G4). */
  private continueTimer: any = null;
  /**
   * Test hooks (never set in the product): beforeMerge(id) runs once a stream's merge phase is saved, before
   * ffmpeg; afterMerge(id) between the merge and the save that completes the row (network.js); beforePlace(id)
   * once a one-file download's final seal is done, before its .part is renamed (repair.js).
   */
  hooks: { beforeMerge?: (id: string) => Promise<void>; afterMerge?: (id: string) => Promise<void>; beforePlace?: (id: string) => Promise<void> } = {};
  /** Block hash records by row (RESUME-DESIGN.md 4.1, Phase 5), read from their journals when first needed. */
  private ledgers = new Map<string, Ledger>();
  /** A row's seal in progress (seal()): its next run waits for it. */
  private sealing = new Map<string, Promise<void>>();
  /** Completed rows Check file is reading (Checking), and the ones Repair or Restore original is fixing (Repairing). */
  private checking = new Set<string>();
  private fixing = new Map<string, { parts: number; bytes: number; ac: AbortController }>();
  /** Where the journals live: <profile>/vitre-downloads (5.7). */
  private journalDir = '';
  /** When the session the store was written by began: after a crash, files finished in it are checked (4.2). */
  private prevStartedAt = 0;
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
      this.journalDir = PathUtils.join(PathUtils.profileDir, 'vitre-downloads');
      await IOUtils.makeDirectory(this.journalDir, { ignoreExisting: true, createAncestors: true }).catch(() => undefined);
      await this.load();
      this.installLifecycle();
      this.loadedAt = Date.now();
      // RESUME-DESIGN.md G4 crash detection: this session is unclean until shutdown's last save, and the
      // store says so (flushed) before anything runs.
      await this.save(true);
      this.armWaits();
      // Merges a crash interrupted once their output was complete finish now (load(): the merge crash window),
      // and the track parts the merge had not removed yet go.
      for (const r of this.joined.splice(0)) {
        const base = r.stream?.mergeBase || '';
        if (base) for (const t of r.stream?.tracks ?? []) await IOUtils.remove(trackPart(base, t), { ignoreAbsent: true }).catch(() => undefined);
        void this.complete(r);
      }
      // What a quit or a crash stopped continues once the first window has had its moment (G4).
      this.continueTimer = setTimeout(() => this.continueAfterStart(), CONTINUE_AFTER);
      // RESUME-DESIGN.md 4.2: after an unclean exit the files finished in that session are checked, and so is
      // a repair a crash cut short: once the first window has had its moment too.
      setTimeout(() => void this.checkAfterStart().catch(() => undefined), CONTINUE_AFTER);
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
    // An unreadable or missing store falls back to the copy the last flushed save kept (.bak), instead
    // of starting empty and writing the empty list over it (RESUME-DESIGN.md 5.6, G4 store safety).
    // As JSONFile does (gre/modules/JSONFile.sys.mjs), a copy that can't be read is set aside as
    // "<file>.corrupt" before anything is written: when both are unreadable, neither is ever
    // overwritten by the empty list the next save writes (review of Phase 1).
    let saved: { version?: number; items?: Rec[] } | null = null;
    for (const path of [this.storePath, this.storePath + '.bak']) {
      try {
        const read = await IOUtils.readJSON(path);
        saved = read && Array.isArray(read.items) ? read : null;
      } catch {
        saved = null;
      }
      if (saved) {
        if (path !== this.storePath) {
          console.warn('Deer downloads: the download list could not be read; its backup copy was used');
          await IOUtils.copy(path, this.storePath).catch(() => undefined);
        }
        break;
      }
      if (await IOUtils.exists(path).catch(() => false)) {
        console.warn('Deer downloads: an unreadable copy of the download list was set aside', path);
        await IOUtils.move(path, path + '.corrupt').catch(() => undefined);
      }
    }
    // RESUME-DESIGN.md 5.7: the store and its .bak both lost: the rows come back from the journals.
    if (!saved) {
      const items = await this.fromJournals();
      if (items.length) {
        console.warn('Deer downloads: the download list and its backup were lost; rows were rebuilt from the hash records');
        saved = { version: STORE_VERSION, items };
      }
    }
    // RESUME-DESIGN.md G4: a session ends clean only with shutdown()'s last save; a store that says
    // otherwise was left by a crash or a power loss. A version 1 store never said: taken as clean.
    const unclean = (saved as { session?: { clean?: unknown } } | null)?.session?.clean === false;
    this.prevClean = !unclean;
    this.prevStartedAt = Number((saved as { session?: { startedAt?: unknown } } | null)?.session?.startedAt) || 0;
    const now = Date.now();
    for (const r of saved?.items ?? []) {
      if (!r?.id || !r.url || typeof r.url !== 'string') continue;
      // Version 1 records (RESUME-DESIGN.md 5.8): the row's type stands in for what the first probe
      // would have recorded, but only as a guess (it may be Firefox's, or empty for a named row): R1
      // then takes only a page or JSON for "not the file" (ranged.ts notFile(); review of Phase 1).
      if (r.file && r.file.contentType === undefined) {
        r.file.contentType = typeof r.mime === 'string' ? r.mime : '';
        r.file.typeGuessed = true;
      }
      if (r.file) settleSegments(r.file);
      if (ACTIVE.includes(r.state)) {
        // Firefox's own transfers don't survive a restart; Deer's carry on from their .part files.
        if (r.mode === 'browser' || r.state === 'starting') {
          r.state = 'failed';
          r.error = 'Interrupted when Deer closed.';
        } else if (r.trying && r.state === 'downloading') {
          // A wait's automatic try stopped on its check (review of Phase 4): it wrote nothing, and the row
          // still waits, so it continues by its wait whatever the setting says (G4, the owner's decision 5).
          r.wait = { ...r.trying, nextAt: now };
          r.state = 'paused';
          r.resumeOnStart = undefined;
        } else {
          // G4: a crash stopped it, as a quit would have, so it continues the same way (resumeOnStart);
          // what it was writing may never have reached the disk (its suspect tail, fetched again).
          if (unclean) {
            r.resumeOnStart = true;
            // Phase 5: a download with its block hash record is judged by it when it continues (its dirty
            // mark, RESUME-DESIGN.md 4.2: inspect()); one without keeps the suspect tail of Phase 4.
            if (r.state === 'downloading') {
              if (r.mode === 'file' && r.file?.dirty && r.journal && existsSync(r.journal)) r.suspect = { at: now, bytes: 0 };
              else suspectTail(r, now);
            }
          }
          r.state = 'paused';
        }
      }
      // Review of Phase 5 (RESUME-DESIGN.md 4.2): a row whose last stop could not flush its .part, in the session
      // that ended uncleanly, may hold bytes the disk never got under its claims: it is checked as after a crash.
      if (unclean && r.mode === 'file' && r.file?.unflushed && r.file.unflushed >= this.prevStartedAt && r.journal) r.file.dirty = true;
      r.trying = undefined;
      // G4, the merge crash window: a stream whose merge had begun (runStream()).
      if (r.mode === 'stream' && r.stream?.phase === 'merging' && !FINISHED.includes(r.state)) this.mergeLeft(r);
      r.hold = false;
      r.note ??= '';
      // Waiting for link belongs to this session's tabs (browserIds are per session).
      r.catcher = undefined;
      // Keep partial file stopped between writing its decision and moving the part: the part is put
      // back where the row expects it, and the row asks again.
      if (r.keeping) {
        const part = `${r.path}.part`;
        try {
          if (r.path && !existsSync(part) && existsSync(r.keeping)) fileFor(r.keeping).moveTo(null, PathUtils.filename(part));
        } catch {
          /* the row asks again; its part is wherever the move left it */
        }
        r.keeping = undefined;
      }
      // Only a paused row waits: Link expired's schedule (a file with its record), and a network, server or
      // sleep wait (G4), which always continues after a restart: one a quit caught in a run it had started,
      // or between its tries, is due at the start, and so is a sleep's (the computer is awake now).
      if (r.wait) {
        if (r.state !== 'paused' || (r.wait.for === 'address' ? r.mode !== 'file' || !r.file : r.mode === 'browser')) r.wait = undefined;
        else if (r.wait.for !== 'address' && (!r.wait.nextAt || r.wait.for === 'sleep')) r.wait = { ...r.wait, nextAt: now };
      }
      r.identity = new Identity(r.identity ?? {}).toJSON();
      this.recs.push(r);
    }
  }

  /**
   * A stream whose merge had begun when Deer stopped (RESUME-DESIGN.md G4, the merge crash window; the
   * phase and output path were saved, flushed, before ffmpeg ran). The output is looked at first (review
   * of Phase 4): it was a free path when the merge chose it, only the move of ffmpeg's finished file makes
   * it, and a failed merge ends the phase before it moves anything else there (hls.ts finish()). So an
   * output there, with no "<base>.merge.part" still being written, is the finished merge, whatever parts
   * its removal left: the row is completed from it (init(), which removes those parts). Otherwise, its
   * parts still there: the merge runs again when the row continues (runStream() goes straight to it).
   * Neither: nothing of it is left, and the row fails saying so (Phase 5 gives such rows Damaged).
   */
  private mergeLeft(r: Rec): void {
    const s = r.stream as StreamState;
    const base = s.mergeBase || stem(r.path);
    const out = s.mergeOut ?? '';
    let size = 0;
    try {
      size = out && existsSync(out) && !(base && existsSync(`${base}.merge.part`)) ? Number(fileFor(out).fileSize) : 0;
    } catch {
      size = 0;
    }
    if (size > 0) {
      r.path = out;
      r.filename = PathUtils.filename(out);
      r.state = 'paused';
      r.resumeOnStart = undefined;
      r.wait = undefined;
      this.joined.push(r);
      return;
    }
    if (base && s.tracks.some((t) => existsSync(trackPart(base, t)))) return;
    r.state = 'failed';
    r.error = 'Deer closed while joining this video, and its parts are gone. Retry downloads it again.';
    r.resumeOnStart = undefined;
    r.wait = undefined;
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

  /**
   * Downloads that are running or waiting to (the quit prompt counts these). A wait's automatic try on
   * its check, or waiting for a slot, is still the wait (RESUME-DESIGN.md 6: waits never hold a quit back;
   * review of Phase 4): a quit gives it its wait back (stopped()), and it continues at the next start.
   */
  runningCount(): number {
    return this.recs.filter(running).length;
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

  /**
   * A download Deer starts itself (the video picker, Add link, menus, Alt+click). Returns its id: the id
   * of the row it continues when it is that row's file started again (RESUME-DESIGN.md G1, Phase 3).
   */
  start(url: string, opts: StartOptions = {}): string {
    if (!/^https?:\/\//i.test(url)) throw new DownloadError('Only web addresses can be downloaded.');
    const mode: StartMode = opts.mode === 'hls' || opts.mode === 'dash' || opts.mode === 'ytdlp' ? opts.mode : opts.mode === 'file' ? 'file' : /\.m3u8(\?|#|$)/i.test(url) ? 'hls' : /\.mpd(\?|#|$)/i.test(url) ? 'dash' : 'file';
    // DRM, whoever asks: the page may have started its key session after its picker opened.
    const browserId = Number(opts.browserId) || 0;
    if (browserId && this.media.isProtected(browserId) && (mode !== 'file' || !!opts.videoKey || MEDIA_URL.test(url))) throw new DownloadError(DRM_MESSAGE);
    // RESUME-DESIGN.md G1, "Catching a re-click in start()" (Phase 3): the menus, Alt+click, Add link,
    // Download copied link and the 'downloads' service. Only when a row waits for its address and this is
    // an http(s) file (not the video picker's): on a pre-match no new record is made; the address is
    // proven against that row's saved bytes and continues it, and the row's id is returned. Anything else
    // then starts as it always did, a moment later (attachStart()). Never when the person chose where it
    // goes (Save link as…, Save video as…: saveAs; a folder: dir): that start makes its own row, with its
    // dialog (review of Phase 3).
    if (mode === 'file' && !opts.videoKey && !opts.saveAs && !opts.dir) {
      const asked = new Identity({ pageUrl: opts.pageUrl, ...(opts.identity ?? {}) }).toJSON();
      const match = this.preMatch({ url, identity: asked, browserId, pageUrl: asked.pageUrl, names: [opts.filename ?? ''] });
      if (match) {
        // A start with no page (Add link, Download copied link) is asked as a pasted address is
        // (setAddress()), and the row keeps its page, container and privacy (review of Phase 3: its page
        // was lost for every later Refresh address and Open page).
        const how: AttachHow = asked.pageUrl ? 'page' : 'link';
        void this.attachStart(match, url, opts, how === 'page' ? asked : pastedIdentity(match.identity), how);
        return match.id;
      }
    }
    return this.startNew(url, opts, mode);
  }

  /**
   * start() as it always was: a new row, queued. `replaces`: the waiting row's id start() returned for
   * it, before the proof said it was not that row's file; the 'added' event carries it, so the window that
   * asked (Add link) selects this row instead.
   */
  private startNew(url: string, opts: StartOptions, mode: StartMode, replaces = ''): string {
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
    this.added(rec, opts.origin ?? null, replaces);
    this.pump();
    return rec.id;
  }

  private added(rec: Rec, origin: { x: number; y: number } | null, replaces = ''): void {
    this.emit({ kind: 'added', view: this.view(rec, false), origin, browserId: rec.browserId, ...(replaces ? { replaces } : {}) });
    this.save(true);
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
    rec.origin = { kind: 'takeover' };
    if (!/^https?:/i.test(url) || fromExtension || !inScratch) {
      // Why it is left to Firefox is kept on the record (RESUME-DESIGN.md G1, browser-mode rows).
      rec.origin.reason = !inScratch ? 'saved-elsewhere' : fromExtension ? 'extension' : 'not-http';
      this.takeovers.push({ url, action: !inScratch ? 'left: saved where Firefox was told' : fromExtension ? 'left: extension' : 'left: not http', id: rec.id, page: pageUrl });
      this.mirror(rec, download);
      return;
    }
    // RESUME-DESIGN.md G1, "Catching a re-click in adopt()" (Phase 3): the file a row waits an address
    // for, started again on its page. With a pre-match the row is held back ('added' is not sent) until
    // the probe and the byte proof have spoken, about 0.3-2 s, so the window never flies a row that then
    // vanishes. Without one (no row waits, or none scores) this is today's path, unchanged. The claim
    // registry for hidden pages comes with Phase 7.
    const match = this.preMatch({ url, identity, browserId, pageUrl, names: [suggested] });
    rec.state = 'starting';
    rec.queuedAt = 0;
    if (!match) {
      this.recs.unshift(rec);
      this.added(rec, null);
    }
    // Ask the server ourselves while Firefox's transfer keeps going (a probe that fails, or gets a
    // page where Firefox got a file, means the download needs the original request).
    const run = this.makeRun();
    run.phase = 'probing';
    // A held probe is no row's run: it holds no download slot and nothing can pause it.
    if (match) this.holding.add(run);
    else this.runs.set(rec.id, run);
    this.ensureTicker();
    const transfer = new FileTransfer(FileTransfer.fresh(url), this.env(rec, run));
    let info: Awaited<ReturnType<FileTransfer['probe']>> | null = null;
    try {
      info = await transfer.probe(run.ac.signal);
    } catch {
      info = null;
    }
    if (match) this.holding.delete(run);
    else this.runs.delete(rec.id);
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
      rec.origin.reason = 'needs-request';
      this.recs = this.recs.filter((r) => r !== rec);
      // A held row was never listed: it is added now.
      this.mirror(rec, download, !match);
      return;
    }
    if (match) {
      // The same file continues the waiting row; the real file (same page and name) with other bytes makes
      // it File changed. Either way Firefox's copy goes and no row is made. Anything else: today's path,
      // the row added now.
      const verdict = await this.proveFor(match, url, identity, { pageUrl, names: [suggested], disposition: nameFromDisposition(info.disposition), urls: [url, info.finalUrl] }, info.total);
      if (this.quitting) {
        transfer.dropPending();
        return;
      }
      if (verdict.kind !== 'not') {
        transfer.dropPending();
        await this.dropFirefox(list, download, target);
        this.takeovers.push({ url, action: verdict.kind === 'same' ? 'attached' : 'changed', id: match.id, page: pageUrl, crossSite });
        if (verdict.kind === 'same') this.attach(match, verdict.found, 'page', identity, { origin: null, browserId });
        else this.changedFor(match, verdict.found, verdict.evidence, identity, { origin: null, browserId });
        return;
      }
      this.recs.unshift(rec);
      this.added(rec, null);
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
    this.save(true);
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
        this.save(true);
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
      this.save(true);
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
    run.saved0 = savedBytes(rec);
    // A network, server or sleep wait goes on with the run that tries again (its count: stopped()). A
    // network or server wait's try keeps it on the record until its check passed (rec.trying; review of
    // Phase 4); the sleep is over once the computer woke, so that run is a download like any other.
    rec.trying = undefined;
    if (rec.wait && rec.wait.for !== 'address') {
      run.waited = rec.wait;
      if (rec.wait.for === 'network' || rec.wait.for === 'server') rec.trying = rec.wait;
      rec.wait = undefined;
    }
    rec.resumeOnStart = undefined;
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
        rec.renewTries = undefined;
        await this.complete(rec);
        this.pump();
      },
      (err) => this.stopped(rec, run, err)
    );
  }

  private async runFile(rec: Rec, run: Run): Promise<void> {
    // The seal of the row's last stop is done first (it may still be draining its hashing: seal()).
    await this.sealing.get(rec.id);
    // A taken-over download starts with the transfer its probe made (same identity, same counters).
    const transfer = this.warm.get(rec.id) ?? new FileTransfer(rec.file ?? FileTransfer.fresh(rec.url), this.env(rec, run));
    this.warm.delete(rec.id);
    rec.file = transfer.state;
    run.transfer = transfer;
    // A File changed row is only checked again here, never started over (RESUME-DESIGN.md 3 G3).
    transfer.silentRestarts = rec.need?.kind !== 'choice';
    let ledger: Ledger | null = null;
    if (!transfer.state.probed || transfer.received > 0) {
      // With saved bytes this is Checking (RESUME-DESIGN.md 6): the saved part and the link, before anything is fetched.
      this.setPhase(run, transfer.received > 0 ? 'checking' : 'probing');
      this.touch(rec);
      // Phase 5 (RESUME-DESIGN.md 4.2): the saved part against its block hash record, before the link is asked.
      if (transfer.received > 0 && rec.path) ledger = await this.inspect(rec, transfer);
      // A wait's try ends its check at the first 429 or 5xx: the wait spaces the tries (review of Phase 4).
      transfer.waitTry = !!rec.trying;
      try {
        const info = await transfer.check(run.ac.signal, rec.path ? `${rec.path}.part` : '');
        if (!rec.path && !rec.named) {
          rec.filename = chooseName({ disposition: info.disposition, url: info.finalUrl, mime: info.contentType, title: rec.videoKey ? rec.title : '', suggested: rec.filename || nameFromUrl(rec.url) || undefined });
          rec.mime = info.contentType;
        }
      } finally {
        transfer.waitTry = false;
      }
    }
    // The address gives the same file again: the row no longer needs the person or waits, and a wait's
    // try is a download like any other from here on.
    rec.need = undefined;
    rec.wait = undefined;
    rec.trying = undefined;
    rec.catcher = undefined;
    // After a crash (G4): the suspect tail load() gave back is fetched again from here on.
    if (rec.suspect) {
      this.event(rec, `Checked after Deer closed unexpectedly · ${sizeText(rec.suspect.bytes)} fetched again`);
      rec.suspect = undefined;
    }
    run.phase = '';
    rec.total = transfer.state.total;
    if (!rec.path) {
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      await this.reserve(rec);
    }
    const part = `${rec.path}.part`;
    // The block hash record (RESUME-DESIGN.md 4.1), once the length and the path are known.
    ledger = await this.recordFor(rec, transfer, ledger, run.ac.signal);
    transfer.ledger = ledger;
    if (ledger) {
      ledger.attach(part, () => transfer.provable());
      ledger.onKind = (kind) => {
        transfer.state.kind ??= kind;
      };
      // 4.1: until a clean stop seals, the .part may hold bytes no seal covers (saved, flushed, before a byte is written).
      transfer.state.dirty = true;
      transfer.state.unflushed = undefined;
      run.sealBytes = rec.netBytes;
    }
    this.touch(rec);
    this.save(true);
    // A new answer checked in "<part>.new" by a run that never ended (a crash) is left over: it goes
    // before this run, which writes its own if it needs one (review of Phase 1).
    await IOUtils.remove(`${part}.new`, { ignoreAbsent: true }).catch(() => undefined);
    await transfer.download(part, run.ac.signal);
    // 4.1: a seal before the final rename (the hashing still behind is done from the finished file:
    // finishRecord()). The blocks being hashed are let finish first: their reads hold the .part open.
    if (ledger) {
      await ledger.quiet();
      await this.seal(rec, transfer, 'final');
    }
    await this.hooks.beforePlace?.(rec.id);
    // Review of Phase 5: a Pause or Cancel that came while the run finished stops it here, before the rename,
    // as one during the transfer does (the row stays paused at 100%, or is cancelled).
    if (run.ac.signal.aborted) throw new AbortedError();
    if (transfer.fixedFromServer) this.event(rec, `The checksum did not match: ${damagedParts(transfer.fixedFromServer)} fetched again`);
    if (transfer.sha256) rec.sha256 = transfer.sha256;
    await this.placeFinished(rec, part);
  }

  /**
   * Every resume's check of the saved part (RESUME-DESIGN.md 4.2, Phase 5), before its address is asked;
   * returns the record (null when there is none: Phase 4's rules stand). A missing .part starts over (a
   * history line says so; nothing is left to protect, so nothing asks). Then, against the block hash record:
   *   - after an unclean stop (file.dirty still set): what each segment claims above its last hashed block
   *     is given back, and the blocks hashed after the last seal are hashed again (when the seal could not
   *     flush the .part, those hashed in the UNFLUSHED_MARGIN before it too);
   *   - a .part modified more than MTIME_SLACK after its last seal while nothing ran: every block (another
   *     program changed it), and what no hashed block covers is given back as after an unclean stop;
   *   - always: the last 2 hashed blocks below each frontier and 2 placed by the download's id.
   * Bad blocks are released (their segment split around them) and the new segments saved, flushed, before
   * anything is fetched; they are fetched again by the run and must hash to their old value (4.3).
   */
  private async inspect(rec: Rec, t: FileTransfer): Promise<Ledger | null> {
    const s = t.state;
    const part = `${rec.path}.part`;
    const st = await statOf(part);
    const l = await this.ledgerOf(rec);
    if (!st) {
      // 4.2: the saved part was moved or deleted. It starts over (the probe is a first one again).
      this.event(rec, 'Started over: the saved part was moved or deleted');
      s.segments = [];
      s.allowFresh = true;
      s.dirty = false;
      rec.received = 0;
      rec.suspect = undefined;
      this.dropLedger(rec);
      await this.save(true);
      return null;
    }
    if (!l || l.total !== s.total || l.bs !== blockSize(s.total)) return null;
    t.ledger = l;
    const before = savedBytes(rec);
    // Never claims past the file's end (openPart() does the same).
    for (const seg of s.segments) seg.received = Math.max(0, Math.min(seg.received, st.size - seg.start));
    const bad = new Set<number>();
    let why: '' | 'crash' | 'other' = '';
    if (s.dirty) {
      why = 'crash';
      l.rewind(s.segments);
      const since = l.seal ? l.seal.t - (l.seal.f ? 0 : UNFLUSHED_MARGIN) : 0;
      for (const b of await l.verify(part, l.newer(since))) bad.add(b);
    } else if (l.seal && st.mtime > l.seal.t + MTIME_SLACK) {
      why = 'other';
      // What no hashed block covers can't be checked (the part of a block below each frontier): fetched again too.
      l.rewind(s.segments);
      for (const b of await l.verify(part, [...l.blocks.keys()])) bad.add(b);
    }
    for (const b of await l.verify(part, l.spot(s.segments, rec.id))) bad.add(b);
    // A repair a crash cut short (a repair line with no repaired line after it): those blocks too.
    if (l.pendingRepair.length) for (const b of await l.verify(part, l.pendingRepair)) bad.add(b);
    // Hashed blocks no longer under the claims keep their hashes as what the bytes fetched again must be.
    l.retain(s.segments, why === 'crash' ? 'unclean' : 'gone');
    if (bad.size) s.segments = l.release(s.segments, [...bad]);
    const again = before - s.segments.reduce((n, seg) => n + seg.received, 0);
    rec.received = savedBytes(rec);
    if (why === 'crash') this.event(rec, `Checked after Deer closed unexpectedly · ${again > 0 ? `${sizeText(again)} fetched again` : 'nothing was lost'}`);
    else if (why === 'other' && bad.size) this.event(rec, `The saved part was changed by another program · ${sizeText(again)} fetched again`);
    else if (bad.size) this.event(rec, `${damagedParts(bad.size)} in the saved part · ${sizeText(again)} fetched again`);
    rec.suspect = undefined;
    // 4.3: the split is saved, flushed, before anything is fetched.
    if (again > 0 || why) {
      await l.journal.flush(true);
      await this.save(true);
    }
    return l;
  }

  /**
   * The download's block hash record for this run (RESUME-DESIGN.md 4.1, 5.8): the one it has, kept when it
   * still fits the file; otherwise a new one once the length is known. A partial download from before the
   * record (saved bytes, no record) gets one only after a second window matched the site (the resume probe
   * compared window 0), so a part that is already damaged or mixed never becomes the reference; another
   * file there stops the run (File changed). A length never known has no record, as before Phase 5.
   */
  private async recordFor(rec: Rec, t: FileTransfer, have: Ledger | null, signal: AbortSignal): Promise<Ledger | null> {
    const s = t.state;
    if (rec.mode !== 'file' || !rec.path || !(s.total > 0)) return null;
    const bs = blockSize(s.total);
    const l = have ?? (await this.ledgerOf(rec));
    if (l && l.total === s.total && l.bs === bs) return l;
    const saved = s.segments.reduce((n, seg) => n + seg.received, 0);
    if (saved > 0 && s.ranges) {
      const part = `${rec.path}.part`;
      const wins = windows(t.provable(), rec.id).filter(([a]) => a !== 0).slice(0, 1);
      if (wins.length) {
        // Review of Phase 5: only other bytes at the site stop the run; a window that can't be asked (a
        // refusal, a page, the network) only means no record is made yet, and the run goes on as before.
        let r: Awaited<ReturnType<typeof compareWindows>>;
        try {
          r = await compareWindows(t.proofCtx(), s.finalUrl, wins, part, signal, s.total, 1);
        } catch {
          if (signal.aborted) throw new AbortedError();
          return null;
        }
        if (r.verdict === 'whole') r.res.destroy();
        else if (r.verdict === 'same') r.res?.destroy();
        if (r.verdict === 'changed') throw r.err;
        if (r.verdict !== 'same') return null;
      }
    } else if (saved > 0) return null;
    const header: Header = {
      deer: 1,
      id: rec.id,
      path: rec.path,
      url: rec.url,
      identity: rec.identity,
      total: s.total,
      bs,
      ct: s.contentType ?? '',
      name: s.dispositionName ?? '',
      etag: s.etag,
      lm: s.lastModified,
      t: Date.now(),
    };
    if (l) {
      // Another length (a silent restart, a new start): the record starts again.
      l.reset(header);
      return l;
    }
    const path = rec.identity.isPrivate ? '' : PathUtils.join(this.journalDir, `${rec.id}.jsonl`);
    const made = Ledger.create(path, header);
    rec.journal = path || undefined;
    this.ledgers.set(rec.id, made);
    return made;
  }

  /** The row's block hash record: in memory, or read from its journal (null when it has none). */
  private async ledgerOf(rec: Rec): Promise<Ledger | null> {
    const have = this.ledgers.get(rec.id);
    if (have) return have;
    if (!rec.journal) return null;
    const l = await Ledger.open(rec.journal);
    if (!l) return null;
    // Another read may have finished first.
    const again = this.ledgers.get(rec.id);
    if (again) return again;
    this.ledgers.set(rec.id, l);
    return l;
  }

  /** The record goes with what it describes (Cancel, Remove, Start over, a .part that went missing: 5.7). */
  private dropLedger(rec: Rec): void {
    const l = this.ledgers.get(rec.id);
    this.ledgers.delete(rec.id);
    if (l) {
      l.detach();
      void l.journal.remove();
    } else if (rec.journal) IOUtils.remove(rec.journal, { ignoreAbsent: true }).catch(() => undefined);
    rec.journal = undefined;
  }

  /**
   * A seal (RESUME-DESIGN.md 4.1): the .part flushed to the disk when that can be done (ledger.ts
   * flushPart()), a seal line with the coverage (flushed), and a flushed save. 'timer': every SEAL_EVERY or
   * SEAL_BYTES of a run (the bytes certainly in the .part); 'final': before the final rename; 'stop': any
   * stop (pause, quit, sleep, a disk error, a failure), which drains the hashing first and clears the dirty
   * mark. One at a time per row; the row's next run waits for it. Review of Phase 5:
   *   - the seal's time is taken before the flush starts, so a block hashed while it runs counts as newer
   *     than the seal (its bytes may be younger than the flush: ledger.ts sealed());
   *   - a seal whose record was dropped meanwhile (Remove, Cancel, Start over) writes nothing more;
   *   - a stop whose flush could not be done says so on the record (file.unflushed): when the session it
   *     ran in ends uncleanly, the row is checked as after a crash (load());
   *   - 'final' neither drains the hashing nor flushes, and leaves the store's flushed save to complete()
   *     right after the rename: the finish no longer waits for them (above about 700 MB/s they held a
   *     finished download at 100% for seconds; the save alone added 15 ms to every download). The blocks
   *     still unhashed are hashed from the finished file (finishRecord()), whose record is what Check file
   *     and the check after an unclean exit read, so the flush is not needed for correctness
   *     (RESUME-DESIGN.md 1, durability).
   */
  private seal(rec: Rec, t: FileTransfer | null, why: 'stop' | 'final' | 'timer'): Promise<void> {
    const l = this.ledgers.get(rec.id);
    if (!l || !rec.file || !rec.path) return Promise.resolve();
    l.sealedAt = Date.now();
    const prev = this.sealing.get(rec.id) ?? Promise.resolve();
    const ours = (): boolean => this.ledgers.get(rec.id) === l && this.recs.includes(rec);
    const job = prev
      .then(async () => {
        if (!ours()) return;
        const part = `${rec.path}.part`;
        // A stop's seal hashes what its run left behind under the exact segments (every writer is closed).
        if (why === 'stop' && existsSync(part)) l.use(part, () => rec.file?.segments ?? []);
        if (why === 'stop') await l.drain();
        if (why === 'stop') l.detach();
        if (!ours()) return;
        const segs = t && why === 'timer' ? t.provable() : (rec.file?.segments ?? []);
        const cov = segs.filter((seg) => seg.received > 0).map((seg): [number, number] => [seg.start, seg.received]);
        const at = Date.now();
        const flushed = why !== 'final' && existsSync(part) ? await flushPart(part) : false;
        if (!ours()) return;
        await l.sealed(cov, flushed, at);
        if (why === 'stop' && rec.file) {
          rec.file.dirty = false;
          rec.file.unflushed = flushed ? undefined : at;
        }
        // 'final': complete() saves, flushed, right after the rename.
        if (why !== 'final') await this.save(true);
      })
      .catch((e: unknown) => console.warn('Deer downloads: a seal failed', String(e)));
    this.sealing.set(rec.id, job);
    void job.then(() => {
      if (this.sealing.get(rec.id) === job) this.sealing.delete(rec.id);
    });
    return job;
  }

  private async runStream(rec: Rec, run: Run): Promise<void> {
    const state = rec.stream ?? StreamTransfer.fresh(rec.url);
    rec.stream = state;
    const transfer = new StreamTransfer(state, { ...this.env(rec, run), ffmpeg: () => this.ffmpeg() });
    transfer.silentRestarts = rec.need?.kind !== 'choice';
    run.transfer = transfer;
    // G4, the merge crash window: a merge a quit or a crash cut short, with every segment in its part,
    // runs again at once: the parts are the whole download, so the stream's addresses are not asked.
    const parted = state.mergeBase || (rec.path ? stem(rec.path) : '');
    const remerge = state.phase === 'merging' && !!parted && state.tracks.length > 0 && state.tracks.every((t) => t.count > 0 && t.done >= t.count && existsSync(trackPart(parted, t)));
    let base = parted;
    if (remerge) {
      rec.trying = undefined;
      await transfer.loadMuxer();
    } else {
      this.setPhase(run, savedBytes(rec) > 0 ? 'checking' : 'probing');
      this.touch(rec);
      // A wait's try ends its check at the first 429 or 5xx (review of Phase 4; see runFile()).
      transfer.waitTry = !!rec.trying;
      try {
        await transfer.prepare(run.ac.signal);
      } finally {
        transfer.waitTry = false;
      }
      rec.need = undefined;
      rec.trying = undefined;
      run.phase = '';
      if (!rec.path) {
        if (!rec.named) rec.filename = rec.filename.replace(/\.(mp4|m4a|ts|aac|webm|weba)$/i, '') + transfer.expectedExtension();
        if (!(await this.confirmPath(rec))) throw new SaveDeclined();
        await this.reserve(rec);
      }
      this.save(true);
      base = stem(rec.path);
      await transfer.download(base, run.ac.signal);
    }
    run.phase = 'merging';
    this.touch(rec);
    const out = await transfer.finish(base, (ext, suffix = '') => this.freePath(rec, `${PathUtils.filename(base)}${suffix}${ext}`), run.ac.signal, null, async (target) => {
      // G4: the phase, the output's path and where the parts are reach the disk before ffmpeg runs. They
      // stay until complete() saves the row completed, so a crash in between is read right (mergeLeft()).
      // ffmpeg failed (null): the phase ends before the tracks are moved as they are, so nothing they
      // leave at that path is ever read as a finished merge (review of Phase 4).
      state.phase = target === null ? undefined : 'merging';
      state.mergeOut = target ?? undefined;
      state.mergeBase = target === null ? undefined : base;
      await this.save(true);
      if (target !== null && this.hooks.beforeMerge) await this.hooks.beforeMerge(rec.id);
    });
    rec.note = transfer.note;
    rec.path = out;
    rec.filename = PathUtils.filename(out);
    if (this.hooks.afterMerge) await this.hooks.afterMerge(rec.id);
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
    this.save(true);
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
    // A partial Start over keeps aside ("<name>.old.part") is reserved like a download's own .part.
    return this.recs.some((r) => r.id !== except && ((r.path.toLowerCase() === key && !FINISHED.includes(r.state)) || (r.oldParts ?? []).some((o) => o.toLowerCase() === `${key}.part`)));
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
    // The new file is complete: the partial Start over kept goes now (owner's decision 2).
    this.dropOldParts(rec);
    // Safe Browsing, for what the engine fetched itself (Firefox checked its own mirrored ones).
    if (rec.path && rec.mode !== 'browser' && /^https?:/i.test(rec.url)) {
      let size = rec.received;
      try {
        size = (await IOUtils.stat(rec.path)).size;
      } catch {
        /* keep the counted bytes */
      }
      // RESUME-DESIGN.md 4.1: the whole file's SHA-256, computed once (off the main thread): ranged.ts verify()
      // already has it when the server gave a SHA-256. Safe Browsing reuses it; it is computed here, before
      // the verdict, only when Safe Browsing would read the file for it (as it did before); otherwise right
      // after the row reads Completed (finishRecord()), so finishing takes no longer than before.
      if (!rec.sha256 && hashWanted(rec.path)) rec.sha256 = (await IOUtils.computeHexDigest(rec.path, 'sha256').catch(() => '')) || undefined;
      const verdict = await reputationOf({ url: rec.url, pageUrl: rec.identity.pageUrl, policy: asPolicy(rec.identity.referrerPolicy), path: rec.path, size, sha256: rec.sha256 });
      if (!this.recs.includes(rec) || rec.state === 'cancelled') return;
      if (verdict !== 'safe') {
        await this.block(rec, verdict);
        return;
      }
    }
    rec.state = 'completed';
    rec.finishedAt = Date.now();
    rec.error = '';
    rec.need = undefined;
    rec.catcher = undefined;
    rec.resumeOnStart = undefined;
    rec.suspect = undefined;
    rec.trying = undefined;
    // The merge's crash window closes with this save (runStream(), mergeLeft()).
    if (rec.stream) rec.stream = { ...rec.stream, phase: undefined, mergeOut: undefined, mergeBase: undefined };
    try {
      rec.total = rec.received = (await IOUtils.stat(rec.path)).size;
    } catch {
      /* keep the counted bytes */
    }
    // Firefox writes it for the downloads it moves (mirrored ones) before they are moved here; a move
    // to another volume may drop the stream, so it is written again.
    if (rec.path) await platform.markOfTheWeb(rec.path, rec.url, rec.identity.pageUrl, rec.identity.isPrivate, asPolicy(rec.identity.referrerPolicy));
    // 4.1, 4.2: what the file is when it finished (a later modified time is Changed after download).
    await this.stamp(rec);
    if (rec.file) rec.file.dirty = false;
    this.ledgers.get(rec.id)?.detach();
    this.touch(rec);
    this.settle(rec);
    this.save(true);
    void this.finishRecord(rec).catch((e: unknown) => console.warn('Deer downloads: the finished file could not be recorded', String(e)));
  }

  /**
   * After a file finished (RESUME-DESIGN.md 4.1): its whole SHA-256 when it is not known yet, and its block
   * record kept as <id>.done.jsonl with it. A file moved or changed meanwhile keeps neither. Review of Phase 5:
   * the blocks the run had not hashed yet (the finish no longer waits for the hashing) are hashed here, from
   * the finished file, before the record is kept; ones read from a file that changed meanwhile are dropped.
   * Also run after the start for a finished row whose record was never kept (a quit or a crash came first).
   */
  private async finishRecord(rec: Rec): Promise<void> {
    const path = rec.path;
    const final = rec.final;
    if (!path || rec.state !== 'completed') return;
    // Reading the whole file back competes with a download that runs very fast (a queue of local or LAN
    // downloads: the next one starts as this one finishes), so this waits a moment, and while one does.
    await this.whileFast();
    if (!this.recs.includes(rec) || rec.path !== path || rec.state !== 'completed') return;
    const l = rec.mode === 'file' ? await this.ledgerOf(rec) : null;
    const ours = (): boolean => this.recs.includes(rec) && rec.path === path && rec.state === 'completed' && (!l || this.ledgers.get(rec.id) === l);
    let fresh: number[] = [];
    if (l && final && l.total === final.size && l.blocks.size < l.count() && !l.fin) {
      const had = new Set(l.blocks.keys());
      l.use(path, () => [{ start: 0, end: l.total, received: l.total }]);
      await l.drain();
      l.detach();
      fresh = [...l.blocks.keys()].filter((b) => !had.has(b));
    }
    const drop = (): void => {
      // What was hashed from a file that changed meanwhile describes that file, not the download.
      if (l && this.ledgers.get(rec.id) === l) l.unhash(fresh, 'changed');
    };
    if (!rec.sha256) {
      const hex = await IOUtils.computeHexDigest(path, 'sha256').catch(() => '');
      const now = await statOf(path);
      if (!ours() || !hex || !now || !final || now.mtime !== final.mtime || now.size !== final.size) return drop();
      rec.sha256 = hex;
    } else if (fresh.length) {
      const now = await statOf(path);
      if (!ours() || !now || !final || now.mtime !== final.mtime || now.size !== final.size) return drop();
    }
    if (!ours()) return;
    if (l && final && rec.journal && !rec.journal.endsWith('.done.jsonl')) {
      const done = rec.journal.replace(/\.jsonl$/, '.done.jsonl');
      await l.finish({ sha256: rec.sha256 ?? '', size: final.size, mtime: final.mtime, path, t: Date.now() }, done);
      if (rec.journal) rec.journal = done;
    } else if (l && final && !rec.journal) {
      // A private download: its record stays in memory.
      await l.finish({ sha256: rec.sha256 ?? '', size: final.size, mtime: final.mtime, path, t: Date.now() }, '');
    }
    this.touch(rec);
    this.save(true);
  }

  /**
   * Review of Phase 5: resolves once no download takes bytes faster than the hashing's hold rate (ledger.ts
   * fast()), looked at FAST_LOOK after the call and then every FAST_LOOK, for at most FAST_WAIT. A finished
   * file's hashing ran beside the next download of a queue and slowed it by up to a half at 1 GB/s.
   */
  private async whileFast(): Promise<void> {
    const until = Date.now() + FAST_WAIT;
    do {
      await new Promise((r) => setTimeout(r, FAST_LOOK));
    } while (!this.quitting && Date.now() < until && [...this.runs.values()].some((run) => run.transfer instanceof FileTransfer && !!run.transfer.ledger?.fast()));
  }

  /** The finished file's size and modified time as it is now (Rec.final: Changed after download is later than this). */
  private async stamp(rec: Rec): Promise<void> {
    const st = rec.path ? await statOf(rec.path) : null;
    rec.final = st ?? undefined;
  }

  /** The partial files Start over kept aside go (the new file completed, or the row was cancelled or removed). */
  private dropOldParts(rec: Rec): void {
    for (const p of rec.oldParts ?? []) IOUtils.remove(p, { ignoreAbsent: true }).catch(() => undefined);
    rec.oldParts = undefined;
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
    this.save(true);
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
    await this.stamp(rec);
    this.touch(rec);
    this.save(true);
    void this.finishRecord(rec).catch((e: unknown) => console.warn('Deer downloads: the finished file could not be recorded', String(e)));
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
    // A run that saved bytes ends what an attach left of the schedule (renewTries).
    if (savedBytes(rec) > (run.saved0 ?? 0)) rec.renewTries = undefined;
    const { kind, status } = classify(err);
    // A wait's try that had not got past its check (review of Phase 4): only a quit gives the wait back.
    const trying = rec.trying;
    rec.trying = undefined;
    if (run.reason === 'pause' && run.resumeAfter && !this.quitting) {
      // Pause, then Resume before the connections had stopped: the last word wins.
      rec.state = 'queued';
      rec.queuedAt = queueStamp();
    } else if (run.reason === 'pause') rec.state = 'paused';
    else if (run.reason === 'quit') {
      rec.state = 'paused';
      // A wait's try the quit stopped on its check: the row still waits, and waiting rows always continue
      // (G4). A run past its check is a download the quit stopped (resumeOnStart: the setting decides).
      if (trying) {
        rec.wait = { ...trying, nextAt: 0 };
        rec.resumeOnStart = undefined;
      }
    } else if (run.reason === 'sleep') {
      // RESUME-DESIGN.md G4: the computer is going to sleep. The row continues after the wake (wake():
      // on network link-up or WAKE_SETTLE later); SLEEP_FALLBACK if no wake ever comes.
      const now = Date.now();
      rec.state = 'paused';
      rec.wait = { for: 'sleep', since: now, tries: 0, nextAt: now + SLEEP_FALLBACK };
    } else if (run.reason === 'cancel' || (err instanceof AbortedError && !run.reason)) this.markCancelled(rec);
    else if ((kind === 'refused' || kind === 'not-file') && (rec.mode === 'file' || rec.mode === 'stream') && savedBytes(rec) > 0) {
      // RESUME-DESIGN.md 3.0: the address no longer gives the file, and the run's renewal hook found
      // no new one (the attempt at the failure). Nothing saved is lost: the row pauses as Link expired
      // and Retry tries the address again. A file row is also tried again by itself 2 min, 15 min, 1 h
      // and 6 h after the failure (renew.ts; a stream's renewal comes with Phase 6). With nothing
      // saved it fails as before. A run an attempt of the schedule queued, that failed before it
      // saved a byte, carries on that schedule instead of starting it again (renewTries; review of
      // Phase 2: a host that passes the proof but refuses the transfer was asked every 2 minutes).
      const now = Date.now();
      const tries = rec.renewTries ?? 1;
      rec.renewTries = undefined;
      rec.state = 'paused';
      rec.error = '';
      rec.need = { kind: 'address', since: now, status };
      rec.wait = rec.mode === 'file' ? { for: 'address', since: now, tries, nextAt: nextTry(tries, now), status } : undefined;
    } else if (kind === 'changed' && (rec.mode === 'file' || rec.mode === 'stream')) {
      // The file on the site is another one (3 G3): stop with the .part untouched and ask. A renewal
      // that found the other version keeps its address for Start over (need.candidate).
      rec.state = 'paused';
      rec.error = '';
      rec.need = { kind: 'choice', since: Date.now(), evidence: err instanceof ChangedError ? err.evidence : '', candidate: err instanceof ChangedError ? err.candidate : undefined };
      rec.wait = undefined;
    } else if ((kind === 'offline' || kind === 'timeout' || kind === 'server') && (rec.mode === 'file' || rec.mode === 'stream') && this.waitAgain(rec, run, kind === 'server' ? 'server' : 'network', status, err)) {
      // RESUME-DESIGN.md G4: Waiting for network or Retrying; nothing is lost and Deer tries again by itself.
    } else {
      rec.state = 'failed';
      rec.error = kind === 'not-file' && rec.file?.guarded ? 'Start this download again from its page.' : describeError(err);
      if (!(err instanceof DownloadError) && !(err instanceof DiskError)) console.warn('Deer downloads: failed', rec.url, String(err));
    }
    // RESUME-DESIGN.md 4.1: a stop with every writer closed (a pause, the quit, sleep, a disk error, any
    // failure) drains the hashing, seals and clears the dirty mark; Cancel removed the record with the part.
    const l = this.ledgers.get(rec.id);
    if (l && rec.state !== 'cancelled' && rec.file) void this.seal(rec, null, 'stop');
    else l?.detach();
    this.touch(rec);
    this.settle(rec);
    this.save(true);
    this.pump();
  }

  /**
   * RESUME-DESIGN.md G4: a run that could not reach its site ('network': offline, a timeout, a refused or
   * reset connection, a body cut short once its attempts were used up) or whose site answered 5xx or 429
   * ('server') waits, paused, and is tried again by itself (waits.ts waitNext(): 10 s, 30 s, 1 min, 2 min,
   * 5 min, then every 10 min, never before the server's Retry-After). The count goes on from the network
   * or server wait the run continued (run.waited), whichever of the two it was: a site that answers some
   * tries with 503 and drops others still backs off (review of Phase 4). It starts again once the run
   * saved FRESH_AFTER more, and on the person's Try now or Resume (resume() drops the wait). A network
   * wait never ends by itself; a server wait does SERVER_GIVE_UP after the wait's first 5xx or 429
   * (serverSince, kept through the network failures between): false, the row fails with today's sentence.
   */
  private waitAgain(rec: Rec, run: Run, what: 'network' | 'server', status: number, err: unknown): boolean {
    const now = Date.now();
    const carried = run.waited?.for === 'network' || run.waited?.for === 'server' ? run.waited : null;
    const prev = carried && savedBytes(rec) - (run.saved0 ?? 0) < FRESH_AFTER ? carried : null;
    const since = prev?.since ?? now;
    // A server wait saved before serverSince existed counts from its since.
    const before = prev?.serverSince ?? (prev?.for === 'server' ? prev.since : 0);
    const serverSince = what === 'server' ? before || now : before;
    if (what === 'server' && now - serverSince >= SERVER_GIVE_UP) return false;
    const tries = (prev?.tries ?? 0) + 1;
    rec.state = 'paused';
    rec.error = '';
    rec.wait = {
      for: what,
      since,
      tries,
      nextAt: waitNext(tries, now, err instanceof HttpStatusError ? err.retryAfter : null),
      ...(serverSince ? { serverSince } : {}),
      ...(status ? { status } : {}),
    };
    return true;
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
    rec.need = undefined;
    rec.wait = undefined;
    rec.catcher = undefined;
    rec.resumeOnStart = undefined;
    this.stopRenewing(rec.id);
    this.removeParts(rec);
    this.rewind(rec);
    this.touch(rec);
    this.settle(rec);
    this.save(true);
  }

  /** Back to the start: no partial file, no place on disk, no measurements (Retry after Cancel, Download again). */
  private rewind(rec: Rec): void {
    rec.file = null;
    rec.suspect = undefined;
    // The block hash record and what was known of the finished file go with the bytes (5.7).
    this.dropLedger(rec);
    rec.sha256 = undefined;
    rec.final = undefined;
    rec.check = undefined;
    if (rec.need?.kind === 'repair') rec.need = undefined;
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
    // Its block hashing may hold the .part open a moment (Phase 5): the removal waits for a seal still
    // running and tries again for a while.
    if (rec.mode === 'file') void (this.sealing.get(rec.id) ?? Promise.resolve()).then(() => removeSoon(parts[0]));
    else for (const p of parts) IOUtils.remove(p, { ignoreAbsent: true }).catch(() => undefined);
    // RESUME-DESIGN.md 5.7: a stream's spill folder ("<part>.d", hls.ts) was left behind before.
    if (rec.mode === 'stream') for (const p of parts) IOUtils.remove(`${p}.d`, { recursive: true, ignoreAbsent: true }).catch(() => undefined);
    // What Phase 1 adds next to them: a new single-stream answer being checked, and Start over's old partial.
    if (rec.mode === 'file') IOUtils.remove(`${rec.path}.part.new`, { ignoreAbsent: true }).catch(() => undefined);
    this.dropOldParts(rec);
  }

  // ---- commands ----

  pause(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    const run = this.runs.get(id);
    // The person paused it: it stays paused over a restart (RESUME-DESIGN.md G4).
    rec.resumeOnStart = undefined;
    if (rec.state === 'queued') {
      rec.state = 'paused';
      // A wait's try waiting its turn: Pause ends the wait too (G4).
      rec.wait = undefined;
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
    } else if (rec.state === 'paused' && (rec.wait || this.renewing.has(id))) {
      // RESUME-DESIGN.md 6 and G4: Pause on a row Deer comes back to by itself cancels the attempt
      // running (Renewing link) and the ones planned, and keeps the bytes; the row still says what it
      // needs (Link expired) and Retry starts again (review of Phase 2). A network, server or sleep wait
      // ends: the row is plainly paused (Phase 4).
      this.stopRenewing(id);
      rec.wait = undefined;
    } else return;
    this.touch(rec);
    this.settle(rec);
    this.save(true);
    this.pump();
  }

  resume(id: string, now = false): void {
    const rec = this.find(id);
    // While Start over writes its decision, the row is neither checked again nor started.
    if (!rec || this.deciding.has(id)) return;
    // A manual action: an attempt of the schedule gives way, and the count starts again (renew.ts),
    // and the original address is asked again even right after a renewal failed (review of Phase 2).
    this.stopRenewing(id);
    this.renewFailed.delete(id);
    rec.wait = undefined;
    rec.renewTries = undefined;
    rec.resumeOnStart = undefined;
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
      // RESUME-DESIGN.md G1, browser-mode rows (Phase 3): a download Firefox moved (a form's answer, a
      // one-time link, blob:, data:, an extension's) is never fetched again by Deer, which could only
      // send its address a plain GET with no checks (before Phase 1) or guarded (Phase 1). Retry asks
      // for its page instead: Start it again from its page (need 'page'), with Open page and why it was
      // Firefox's (rec.origin). With no page to open it fails with that sentence, as blob: did.
      if (rec.identity.pageUrl) {
        rec.state = 'paused';
        rec.error = '';
        rec.need = { kind: 'page', since: Date.now(), evidence: rec.origin?.reason ? LEFT_WHY[rec.origin.reason] : '' };
      } else {
        rec.state = 'failed';
        rec.error = 'Start this download again from its page.';
      }
      this.touch(rec);
      this.settle(rec);
      this.save(true);
      return;
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
    this.save(true);
  }

  /**
   * File changed (need 'choice'): start over with the file the site has now (RESUME-DESIGN.md 3 G3,
   * the owner's decision 2). The old partial file is kept as "<name>.old.part" until the new file
   * completes, or deleted at once when the disk has no room for both. Same address, same name.
   * Review of Phase 1:
   *   - the decision reaches the disk first: the store names the old parts (flushed) before they are
   *     moved, so a stop in between never leaves one nobody removes;
   *   - "<name>.old.part" that is another file (another download's partial, the person's own) is never
   *     touched: the next free "<name>.old (n).part" is used;
   *   - a part that can't be set aside (another program has it open) stops the Start over: nothing is
   *     moved or emptied, the row still asks, and its note says why.
   */
  startOver(id: string, url = ''): Promise<void> {
    return this.startAfresh(id, url, null);
  }

  /**
   * startOver()'s work. `quiet`: another version of the file a waiting row's start again found, with
   * nothing worth asking about saved (changedFor(), the owner's decision 1): the row starts over from it
   * without ever reading File changed.
   */
  private async startAfresh(id: string, url: string, quiet: NeedCandidate | null): Promise<void> {
    const rec = this.find(id);
    if (!rec) return;
    // With `url` (Use another address…, "Use it and start over"): a paused file row, from that address.
    const ready = (): boolean =>
      this.recs.includes(rec) && rec.state === 'paused' && (url || quiet ? rec.mode === 'file' : rec.need?.kind === 'choice') && !this.runs.has(rec.id) && (rec.mode === 'file' || rec.mode === 'stream') && !!rec.path;
    if (!ready() || this.deciding.has(id) || (url && !/^https?:\/\//i.test(url))) return;
    this.stopRenewing(id);
    this.renewFailed.delete(id);
    rec.renewTries = undefined;
    // Resume waits while the decision is written (resume()).
    this.deciding.add(id);
    // The address a renewal or a start again found for the new file (need.candidate): no new lookup.
    const cand = url ? undefined : (quiet ?? rec.need?.candidate);
    try {
      // The last stop's seal is done first: its hashing holds the .part open (Phase 5).
      await this.sealing.get(id);
      // RESUME-DESIGN.md 4.3, 5.7: the decision reaches the record first (flushed); the record then starts again.
      await (await this.ledgerOf(rec))?.decision('restart');
      const parts = (rec.mode === 'stream' && rec.stream ? rec.stream.tracks.map((t) => trackPart(stem(rec.path), t)) : [`${rec.path}.part`]).filter((p) => existsSync(p));
      const before = rec.oldParts ?? [];
      const moves: Array<[string, string]> = [];
      for (const p of parts) moves.push([p, this.oldPartFor(rec, p, moves.map(([, old]) => old))]);
      rec.oldParts = [...new Set([...before, ...moves.map(([, old]) => old)])];
      await this.save(true);
      if (!ready()) {
        // Cancelled or removed meanwhile: only names of files that exist stay recorded.
        if (rec.oldParts) rec.oldParts = rec.oldParts.filter((p) => existsSync(p));
        return;
      }
      const moved: Array<[string, string]> = [];
      try {
        for (const [p, old] of moves) {
          // Only a partial this row set aside before is replaced (oldPartFor never names another file).
          if (existsSync(old)) fileFor(old).remove(false);
          fileFor(p).moveTo(null, PathUtils.filename(old));
          moved.push([p, old]);
        }
      } catch (e) {
        console.warn('Deer downloads: the old partial file could not be set aside; nothing was started over', String(e));
        for (const [p, old] of moved.reverse()) {
          try {
            fileFor(old).moveTo(null, PathUtils.filename(p));
          } catch {
            /* it stays recorded below and goes with the row */
          }
        }
        const still = (rec.oldParts ?? []).filter((p) => existsSync(p));
        rec.oldParts = still.length ? still : undefined;
        if (rec.need) rec.need = { ...rec.need, evidence: 'another program has the saved part open; close it and try again' };
        this.touch(rec);
        await this.save(true);
        return;
      }
      if (!hasRoom(rec.dir, rec.total > 0 ? rec.total : 0)) this.dropOldParts(rec);
      this.dropLedger(rec);
      // A fresh start at the stored address; the path (and so the name) stays this row's.
      if (rec.mode === 'stream' && rec.stream) {
        const s = rec.stream;
        rec.stream = StreamTransfer.fresh(s.sourceUrl, { format: s.format, variantUrl: s.variantUrl, audioUrl: s.audioUrl, dashVideo: s.dashVideo, dashAudio: s.dashAudio, audioOnly: s.audioOnly, bytes: s.expected });
      } else rec.file = FileTransfer.fresh(url || cand?.url || rec.file?.url || rec.url);
      if (url) {
        rec.url = url;
        rec.identity = pastedIdentity(rec.identity);
      } else if (rec.mode === 'file' && cand?.identity) {
        // Found by a start again on the page (Phase 3): its address, asked as that start asked it.
        rec.url = cand.url;
        rec.identity = cand.identity;
      }
      rec.catcher = undefined;
      rec.need = undefined;
      rec.wait = undefined;
      rec.error = '';
      rec.received = 0;
      rec.netBytes = 0;
      rec.activeMs = 0;
      rec.peak = 0;
      rec.state = 'queued';
      rec.queuedAt = queueStamp();
      this.touch(rec);
      await this.save(true);
    } finally {
      this.deciding.delete(id);
    }
    this.pump();
  }

  /**
   * Where Start over sets `part` aside: "<name>.old.part", or "<name>.old (n).part" when that name is
   * another file or another download's (taken()). A name this row set aside before is its own and is
   * reused; `planned` are names this Start over already picked.
   */
  private oldPartFor(rec: Rec, part: string, planned: string[]): string {
    const base = part.replace(/\.part$/i, '');
    const has = (list: string[], name: string): boolean => list.some((x) => x.toLowerCase() === name.toLowerCase());
    for (let n = 0; n < 1000; n++) {
      const name = `${base}.old${n ? ` (${n})` : ''}.part`;
      if (has(planned, name)) continue;
      if (has(rec.oldParts ?? [], name)) return name;
      if (!existsSync(name) && !this.taken(name.slice(0, -'.part'.length), rec.id)) return name;
    }
    return `${base}.old (${Date.now()}).part`;
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
    this.stopRenewing(id);
    this.renewFailed.delete(id);
    this.fixing.get(id)?.ac.abort();
    // The hash record goes with the row (5.7), a finished file's too (never the file).
    const gone = this.find(id);
    if (gone) this.dropLedger(gone);
    this.recs = this.recs.filter((r) => r.id !== id);
    this.dirty.delete(id);
    this.emit({ kind: 'removed', ids: [id] });
    this.save(true);
  }

  clearFinished(isPrivate?: boolean): void {
    const gone = this.recs.filter((r) => FINISHED.includes(r.state) && (isPrivate === undefined || r.identity.isPrivate === isPrivate)).map((r) => r.id);
    if (!gone.length) return;
    for (const r of this.recs) {
      if (!gone.includes(r.id)) continue;
      this.dropQuarantine(r);
      this.fixing.get(r.id)?.ac.abort();
      this.dropLedger(r);
    }
    this.recs = this.recs.filter((r) => !gone.includes(r.id));
    this.emit({ kind: 'removed', ids: gone });
    this.save(true);
  }

  /** Pause all: what runs or waits its turn, and the waits Deer would continue by itself (format.ts isWaiting(), G4). */
  pauseAll(isPrivate?: boolean): void {
    for (const r of [...this.recs]) if ((ACTIVE.includes(r.state) || waiting(r)) && (isPrivate === undefined || r.identity.isPrivate === isPrivate)) this.pause(r.id);
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

  private setPhase(run: Run, phase: Run['phase']): void {
    run.phase = phase;
    run.phaseAt = Date.now();
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
      seed: rec.id,
      // Looked up in the download's current run when called: a taken-over download's transfer was
      // made by the run that probed it.
      renew: (why, status) => this.renewInRun(rec, why, status),
    };
  }

  // ---- renewing an address (RESUME-DESIGN.md 3.0, G1; Phase 2) ----

  /**
   * The in-run renewal hook (TransferEnv.renew): the original address and its redirect hops, asked
   * once for every connection that hit the dead address (renew.ts Gate), proven against the bytes
   * certainly in the .part, and adopted into the transfer's state, which is rec.file. CHANGED or
   * UNKNOWN (R7) there rejects with the ChangedError the row asks about (File changed, its address
   * kept); nothing found is null, remembered for FORGET_FAILURE. The row reads Renewing link meanwhile.
   */
  private renewInRun(rec: Rec, _why: RenewWhy, status: number): Promise<Renewed | null> {
    const run = this.runs.get(rec.id);
    const t = run?.transfer;
    if (!run || !(t instanceof FileTransfer) || rec.mode !== 'file' || !rec.path) return Promise.resolve(null);
    run.gate ??= new Gate();
    return run.gate.run(async () => {
      if (Date.now() - (this.renewFailed.get(rec.id) ?? 0) < FORGET_FAILURE) return null;
      const s = t.state;
      const list = addresses(rec.url, s, s.finalUrl);
      if (!list.length) return null;
      const phase = run.phase;
      run.phase = 'renewing';
      run.status = status;
      this.touch(rec);
      try {
        const out = await originalAddress({ ctx: t.proofCtx(), partPath: `${rec.path}.part`, segments: t.provable(), seed: rec.id }, list, run.ac.signal);
        if (out.verdict === 'same') {
          adopt(s, out.found, 'original');
          this.renewFailed.delete(rec.id);
          this.event(rec, 'New link found');
          return { url: s.url, finalUrl: s.finalUrl, validators: { etag: s.etag, lastModified: s.lastModified } };
        }
        if (out.verdict !== 'failed') {
          const err = new ChangedError(out.verdict === 'changed' ? out.evidence : UNSURE);
          err.candidate = candidateOf(out.found);
          throw err;
        }
        this.renewFailed.set(rec.id, Date.now());
        return null;
      } finally {
        if (run.phase === 'renewing') run.phase = phase;
        this.touch(rec);
      }
    });
  }

  /**
   * One attempt of the schedule, outside any run (RESUME-DESIGN.md 3.0 "episode"): the original
   * address and its hops are proven against the saved bytes while the row stays paused (Renewing
   * link); it holds no download slot. SAME attaches and the row carries on; CHANGED makes it File
   * changed (UNKNOWN too, unless at most ASK_ABOVE is saved: then it starts again from the address);
   * nothing found counts the attempt and plans the next (wait.tries, renew.ts nextTry()).
   */
  private async episode(rec: Rec): Promise<void> {
    const s = rec.file;
    if (rec.state !== 'paused' || !rec.wait || this.runs.has(rec.id) || this.renewing.has(rec.id) || this.quitting) return;
    if (!s || rec.mode !== 'file' || !rec.path) {
      // Nothing to renew: the wait goes, so it never fires again.
      rec.wait = undefined;
      return;
    }
    const ac = new AbortController();
    this.renewing.set(rec.id, ac);
    this.touch(rec);
    let out: Outcome | null = null;
    try {
      const part = `${rec.path}.part`;
      const list = addresses(rec.url, s, '');
      const ctx = { state: s, identity: new Identity(rec.identity), kind: await readKind(s, part), saved: savedBytes(rec) };
      out = list.length ? await originalAddress({ ctx, partPath: part, segments: s.segments, seed: rec.id }, list, ac.signal) : { verdict: 'failed', status: 0 };
    } catch (e) {
      // Counted as an attempt that found nothing, so an overdue wait never fires again at once.
      if (!ac.signal.aborted) {
        console.warn('Deer downloads: renewing the address failed', String(e));
        out = { verdict: 'failed', status: 0 };
      }
    } finally {
      if (this.renewing.get(rec.id) === ac) this.renewing.delete(rec.id);
    }
    // Retry, Cancel, a pasted address or a quit came first: theirs is the last word.
    if (!out || ac.signal.aborted || !this.recs.includes(rec) || rec.state !== 'paused' || !rec.wait) {
      this.touch(rec);
      this.armWaits();
      return;
    }
    const now = Date.now();
    if (out.verdict === 'same') {
      // Counted like a failed attempt until the run it queues saves a byte (renewTries).
      rec.renewTries = rec.wait.tries + 1;
      this.attach(rec, out.found, 'original');
      return;
    }
    if (out.verdict === 'unknown' && savedBytes(rec) <= ASK_ABOVE) {
      // R7 with nothing at stake: a fresh start from the original address.
      rec.file = FileTransfer.fresh(s.url);
      rec.need = undefined;
      rec.wait = undefined;
      rec.state = 'queued';
      rec.queuedAt = queueStamp();
      this.touch(rec);
      this.save(true);
      this.pump();
      return;
    }
    if (out.verdict === 'changed' || out.verdict === 'unknown') {
      rec.need = { kind: 'choice', since: now, evidence: out.verdict === 'changed' ? out.evidence : UNSURE, candidate: candidateOf(out.found) };
      rec.wait = undefined;
    } else {
      this.renewFailed.set(rec.id, now);
      const tries = rec.wait.tries + 1;
      rec.wait = { ...rec.wait, tries, nextAt: nextTry(tries, now), status: out.status || rec.wait.status };
      if (out.status && rec.need) rec.need.status = out.status;
    }
    this.touch(rec);
    this.save(true);
  }

  /**
   * A proven address becomes the row's (RESUME-DESIGN.md G1 attach): adopted into rec.file (the old one
   * goes to address.history); one from the person (pasted, or the download started again: Phase 3) also
   * becomes rec.url, with its identity (for a click, the page's principal and cookie jar), and is a
   * manual action: what the schedule remembers starts again. need, wait and catcher are cleared and the
   * row queues. Segments, path and .part stay, so it carries on under the same name (taken() and
   * uniquePath never make " (1)"). `from`: a start again, announced as 'attached' (it flies from that tab).
   */
  private attach(rec: Rec, found: Found, how: AttachHow, identity?: IdentityJSON, from?: { origin: { x: number; y: number } | null; browserId: number }): void {
    if (!rec.file) return;
    adopt(rec.file, found, how);
    if (how !== 'original') {
      rec.url = found.url;
      if (identity) rec.identity = identity;
      rec.renewTries = undefined;
    }
    rec.need = undefined;
    rec.wait = undefined;
    rec.catcher = undefined;
    rec.error = '';
    this.renewFailed.delete(rec.id);
    this.event(rec, how === 'pasted' || how === 'link' ? 'Continued from another address' : how === 'page' ? 'Continued from its page' : 'New link found');
    rec.state = 'queued';
    rec.queuedAt = queueStamp();
    if (from) this.emit({ kind: 'attached', view: this.view(rec, false), origin: from.origin, browserId: from.browserId });
    this.touch(rec);
    this.save(true);
    this.pump();
  }

  /**
   * "Use another address…" (RESUME-DESIGN.md G1, 6): an address the person pastes for a paused file
   * download. It is asked once for window 0 and proven against the saved bytes like any new address
   * (proof.ts proveAddress()), with the download's container and private state, as a pasted address
   * (first-party, as Add link sends it). The same file attaches and the row carries on from its
   * segments; otherwise nothing changes and the result's note says why (the wording of section 6).
   */
  async setAddress(id: string, url: string): Promise<AddressResult> {
    const rec = this.find(id);
    const no = (kind: AddressResult['kind'], note: string): AddressResult => ({ ok: false, kind, note });
    if (!rec || rec.mode !== 'file' || !rec.file?.probed || !rec.path) return no('busy', 'Deer can’t use another address for this download.');
    if (rec.state !== 'paused' || this.runs.has(id) || this.deciding.has(id)) return no('busy', 'Pause the download first.');
    if (!/^https?:\/\/\S+$/i.test(url)) return no('unreachable', 'Enter a web address that starts with http or https.');
    // A scheduled attempt gives way to the person's address; a manual action resets what the schedule remembers.
    this.stopRenewing(id);
    this.renewFailed.delete(id);
    rec.renewTries = undefined;
    const ac = new AbortController();
    this.renewing.set(id, ac);
    this.proving.add(id);
    this.touch(rec);
    const s = rec.file;
    const part = `${rec.path}.part`;
    const identity = pastedIdentity(rec.identity);
    let c: Candidate;
    try {
      const ctx = { state: s, identity: new Identity(identity), kind: await readKind(s, part), saved: savedBytes(rec) };
      c = await proveAddress(ctx, part, s.segments, rec.id, url, ac.signal);
    } catch {
      c = { verdict: 'unreachable', status: 0 };
    } finally {
      if (this.renewing.get(id) === ac) {
        this.renewing.delete(id);
        this.proving.delete(id);
      }
      this.touch(rec);
    }
    if (ac.signal.aborted || !this.recs.includes(rec) || rec.state !== 'paused' || this.runs.has(id)) return no('busy', '');
    if (c.verdict === 'same') {
      this.attach(rec, c.found, 'pasted', identity);
      return { ok: true, kind: '', note: '' };
    }
    if (c.verdict === 'unknown' && savedBytes(rec) <= ASK_ABOVE) {
      // R7 with nothing at stake: taken as a fresh start from that address.
      await this.startOver(id, url);
      return { ok: true, kind: '', note: '' };
    }
    const ours = sizeText(rec.total > 0 ? rec.total : savedBytes(rec));
    const theirs = c.verdict === 'changed' ? c.found.total : c.verdict === 'refused' && !c.page ? c.total : -1;
    if (c.verdict === 'changed' || theirs >= 0) return no('different', `That address is a different file (${theirs >= 0 ? `${sizeText(theirs)}; ` : ''}this download is ${ours}).`);
    if (c.verdict === 'unknown') return no('unknown', 'Deer can’t confirm that address is the same file.');
    if (c.verdict === 'refused' && c.page) return no('page', 'That address answers with a web page, not the file.');
    return no('unreachable', 'Deer couldn’t reach that address.');
  }

  // ---- starting it again on its page (RESUME-DESIGN.md G1 manual fallback; Phase 3) ----

  /**
   * Refresh address, a Link expired row's primary verb: a renewal attempt at once (an attempt of the
   * schedule with its count started again, as for any manual action; the row reads Renewing link). When
   * it finds nothing and the download has a source page, the result asks the window to open that page
   * in a foreground tab in the download's container (a private download in its private window) and then
   * to arm the row (arm()): Waiting for link. Pause meanwhile stops it ('busy'), and nothing opens.
   */
  async refreshAddress(id: string): Promise<RefreshResult> {
    const rec = this.find(id);
    const out = (kind: RefreshResult['kind']): RefreshResult => ({ kind, pageUrl: rec?.identity.pageUrl ?? '', userContextId: rec?.identity.userContextId ?? 0, isPrivate: !!rec?.identity.isPrivate });
    if (!rec || rec.state !== 'paused' || rec.need?.kind !== 'address' || this.runs.has(id) || this.deciding.has(id)) return out('busy');
    this.stopRenewing(id);
    this.renewFailed.delete(id);
    rec.renewTries = undefined;
    rec.catcher = undefined;
    if (rec.mode === 'file' && rec.file && rec.path) {
      rec.wait = { for: 'address', since: Date.now(), tries: 0, nextAt: 0, status: rec.need.status };
      await this.episode(rec);
      // Pause (or Cancel, Remove) stopped the attempt: theirs is the last word. So did the download
      // started again meanwhile, whose proof now decides (proveFor()): no page opens.
      if ((rec.state === 'paused' && rec.need?.kind === 'address' && !rec.wait) || this.proving.has(id)) return out('busy');
    }
    // What the attempt left (episode() changed the row).
    const need = rec.need as Rec['need'];
    if (!this.recs.includes(rec)) return out('busy');
    if (rec.state !== 'paused' || !need) return out('renewed');
    if (need.kind === 'choice') return out('changed');
    if (need.kind !== 'address') return out('busy');
    return out(rec.identity.pageUrl ? 'page' : 'none');
  }

  /**
   * The window opened the download's page for Refresh address or Open page (that tab: browserId): for 30
   * minutes the row waits for the download to be started again (Waiting for link). A start in that tab
   * scores most; one in another tab of the same container may still continue it (the person may sign in
   * elsewhere first), and closing the tab does not stop the wait.
   */
  arm(id: string, browserId = 0): void {
    const rec = this.find(id);
    if (!rec || rec.state !== 'paused' || rec.need?.kind !== 'address' || rec.mode !== 'file' || !rec.file || !rec.path) return;
    rec.catcher = { until: Date.now() + CATCH_FOR, browserId: Number(browserId) || 0 };
    this.touch(rec);
    this.save(true);
  }

  /** Stop waiting: the row no longer waits for a start on its page (Link expired again; the schedule's attempts stay). */
  stopWaiting(id: string): void {
    const rec = this.find(id);
    if (!rec?.catcher) return;
    rec.catcher = undefined;
    this.touch(rec);
    this.save(true);
  }

  /** Open page, From page: the download's page, its container and privacy, and whether the window arms the row once it is open. */
  openPage(id: string): PageTarget | null {
    const rec = this.find(id);
    if (!rec?.identity.pageUrl) return null;
    const arm = rec.state === 'paused' && rec.need?.kind === 'address' && rec.mode === 'file' && !!rec.file && !!rec.path;
    return { pageUrl: rec.identity.pageUrl, userContextId: rec.identity.userContextId, isPrivate: rec.identity.isPrivate, arm };
  }

  /**
   * A row that waits for its address (RESUME-DESIGN.md G1): a one-file download with saved bytes, paused,
   * needing an address (Link expired), waiting for one or armed, and free to be proven against now. An
   * attempt of the schedule running (Renewing link) does not keep it out: the person's start again is a
   * manual action and comes first (proveFor() stops that attempt; review of Phase 3: a start again during
   * an attempt became "name (1)" and downloaded the whole file again). Another address of the person's
   * being proven (a paste, another start) does.
   */
  private waitsForAddress(r: Rec): boolean {
    return r.state === 'paused' && r.mode === 'file' && !!r.file?.probed && !!r.path && (r.need?.kind === 'address' || r.wait?.for === 'address' || !!r.catcher) && !this.runs.has(r.id) && !this.proving.has(r.id) && !this.deciding.has(r.id);
  }

  /**
   * Which waiting row a download started again may be (RESUME-DESIGN.md G1; downloads/attach.ts score()):
   * only rows of the same privacy and container (2.1), the best scoring PRE_MATCH or more; null otherwise.
   * Costs nothing while no row waits for an address.
   */
  private preMatch(s: { url: string; identity: IdentityJSON; browserId: number; pageUrl: string; names: string[] }): Rec | null {
    if (!/^https?:\/\//i.test(s.url)) return null;
    const now = Date.now();
    let best: Rec | null = null;
    let top = 0;
    for (const r of this.recs) {
      if (r.identity.isPrivate !== s.identity.isPrivate || r.identity.userContextId !== s.identity.userContextId || !this.waitsForAddress(r)) continue;
      const armed = r.catcher && r.catcher.until > now ? (r.catcher.browserId ?? 0) : 0;
      const n = score({ armedBrowserId: armed, names: namesOf(r), pageUrl: r.identity.pageUrl, urls: urlsOf(r) }, { url: s.url, browserId: s.browserId, pageUrl: s.pageUrl, names: s.names }, sameSite);
      if (n >= PRE_MATCH && n > top) {
        best = r;
        top = n;
      }
    }
    return best;
  }

  /**
   * The byte proof for a download started again (RESUME-DESIGN.md G1 step 4, Phase 3): its address,
   * asked with `identity` (a click's page, cookies and container; a start with no page as a pasted
   * address), against the waiting row's saved bytes (proof.ts proveAddress(): window 0, R1-R7, the
   * windows). 'same' continues the row; 'changed' only for the real file (attach.ts realFile(): the same
   * page and a name a person or the server gave, never an address's script name), another version of it;
   * anything else is not this row's ('not'): a refused address or a page, another file, and another size
   * that is not the real file (R2, decided from the probe's `total` and names without a request). An
   * attempt of the schedule running for the row gives way (a manual action); meanwhile the row reads
   * Renewing link, and no other start or attempt takes it.
   */
  private async proveFor(rec: Rec, url: string, identity: IdentityJSON, start: Named, total = -1): Promise<{ kind: 'same'; found: Found } | { kind: 'changed'; found: Found; evidence: string } | { kind: 'not' }> {
    const not = { kind: 'not' as const };
    const s = rec.file;
    if (!s || !this.waitsForAddress(rec)) return not;
    const ours: Named = { pageUrl: rec.identity.pageUrl, names: [rec.filename], disposition: s.dispositionName ?? '', urls: urlsOf(rec) };
    const real = (disposition: string): boolean => realFile(ours, { ...start, disposition: disposition || start.disposition });
    if (total >= 0 && s.total >= 0 && total !== s.total && !real('')) return not;
    this.stopRenewing(rec.id);
    const ac = new AbortController();
    this.renewing.set(rec.id, ac);
    this.proving.add(rec.id);
    this.touch(rec);
    let c: Candidate;
    try {
      const part = `${rec.path}.part`;
      const ctx = { state: s, identity: new Identity(identity), kind: await readKind(s, part), saved: savedBytes(rec) };
      c = await proveAddress(ctx, part, s.segments, rec.id, url, ac.signal);
    } catch {
      c = { verdict: 'unreachable', status: 0 };
    } finally {
      if (this.renewing.get(rec.id) === ac) {
        this.renewing.delete(rec.id);
        this.proving.delete(rec.id);
      }
      this.touch(rec);
    }
    if (ac.signal.aborted || !this.recs.includes(rec) || rec.state !== 'paused' || this.runs.has(rec.id) || this.deciding.has(rec.id)) return not;
    if (c.verdict === 'same') return { kind: 'same', found: c.found };
    if ((c.verdict === 'changed' || c.verdict === 'unknown') && real(c.found.disposition)) return { kind: 'changed', found: c.found, evidence: c.verdict === 'changed' ? c.evidence : UNSURE };
    return not;
  }

  /**
   * start()'s pre-match (Phase 3): proven and continued, File changed, or started as it always was, a
   * moment later; that new row's 'added' names the row start() returned (replaces), so Add link selects
   * the new one (review of Phase 3).
   */
  private async attachStart(rec: Rec, url: string, opts: StartOptions, identity: IdentityJSON, how: AttachHow): Promise<void> {
    const from = { origin: opts.origin ?? null, browserId: Number(opts.browserId) || 0 };
    const verdict = await this.proveFor(rec, url, identity, { pageUrl: identity.pageUrl && how === 'page' ? identity.pageUrl : '', names: [opts.filename ?? ''], disposition: '', urls: [url] });
    if (this.quitting) return;
    if (verdict.kind === 'same') {
      this.attach(rec, verdict.found, how, identity, from);
      return;
    }
    if (verdict.kind === 'changed') {
      this.changedFor(rec, verdict.found, verdict.evidence, identity, from);
      return;
    }
    try {
      this.startNew(url, opts, 'file', rec.id);
    } catch (e) {
      console.warn('Deer downloads: could not start', String(e));
    }
  }

  /**
   * A download started again gives another version of the waiting row's file (the real file, other
   * bytes: G1 step 4, 3 G3): the row becomes File changed, with that address and the start's identity
   * kept for Start over (need.candidate). With nothing at stake (at most ASK_ABOVE saved, the owner's
   * decision 1, whatever the evidence; at most twice in ten minutes, ranged.ts silentRestart()) it starts
   * over from it at once instead of asking, and the start flies to the row as an attach does (review of
   * Phase 3: a click over a few KiB saved got a question about almost nothing).
   */
  private changedFor(rec: Rec, found: Found, evidence: string, identity: IdentityJSON, from: { origin: { x: number; y: number } | null; browserId: number }): void {
    this.stopRenewing(rec.id);
    const candidate: NeedCandidate = { ...candidateOf(found), identity };
    rec.wait = undefined;
    rec.catcher = undefined;
    rec.renewTries = undefined;
    const log = silentRestart(rec.file?.silent, savedBytes(rec));
    if (log) {
      // Straight from Link expired to the new file: the row never reads File changed (no dot, nothing
      // announced but the start); the old part waits as "<name>.old.part" until the new file completes.
      void this.startAfresh(rec.id, '', candidate).then(() => {
        if (!this.recs.includes(rec)) return;
        if (rec.state === 'paused' && !this.runs.has(rec.id)) {
          // It could not start over (the part is held open, or another decision came first): the row asks.
          rec.need = { kind: 'choice', since: Date.now(), evidence: rec.need?.evidence || evidence, candidate };
          this.touch(rec);
          this.save(true);
          return;
        }
        if (rec.need || (rec.state !== 'queued' && rec.state !== 'downloading')) return;
        if (rec.file) rec.file.silent = log;
        this.event(rec, 'Started over: the file on the site changed');
        this.emit({ kind: 'attached', view: this.view(rec, false), origin: from.origin, browserId: from.browserId });
      });
      return;
    }
    rec.need = { kind: 'choice', since: Date.now(), evidence, candidate };
    this.touch(rec);
    this.save(true);
  }

  /** File changed's two choices (RESUME-DESIGN.md 3 G3, 6): Start over with the new file, or Keep partial file. */
  decide(id: string, choice: 'start-over' | 'keep-partial'): Promise<void> {
    return choice === 'keep-partial' ? this.keepPartial(id) : this.startOver(id);
  }

  /**
   * Keep partial file, File changed's second choice (RESUME-DESIGN.md 3 G3, the owner's decision 3): the
   * unbroken beginning of the saved bytes from byte 0 becomes "<stem> (partial).<ext>" and the row is
   * completed with a note; Safe Browsing and the Mark of the Web run as for any finished file
   * (complete()). As Start over does, the decision reaches the disk first: the new name is written to the
   * store (flushed) before the part is moved; the moved file is then cut to that beginning. A part
   * another program holds open moves nothing, and the row says why. Streams keep their written segments
   * with Phase 6.
   */
  async keepPartial(id: string): Promise<void> {
    const rec = this.find(id);
    const ready = (): boolean => !!rec && this.recs.includes(rec) && rec.state === 'paused' && rec.need?.kind === 'choice' && rec.mode === 'file' && !!rec.file && !!rec.path && !this.runs.has(rec.id);
    if (!rec || !ready() || this.deciding.has(id) || !rec.file) return;
    const part = `${rec.path}.part`;
    const bytes = Math.min(unbroken(rec.file.segments), Math.max(0, await sizeOf(part)));
    if (bytes <= 0 || !ready() || this.deciding.has(id)) return;
    this.stopRenewing(id);
    this.deciding.add(id);
    // The last stop's seal is done first: its hashing holds the .part open (Phase 5).
    await this.sealing.get(id);
    const total = rec.total > 0 ? rec.total : rec.file.total;
    try {
      const target = uniquePath(rec.dir, partialName(rec.filename), (p) => this.taken(p, rec.id));
      rec.keeping = target;
      // RESUME-DESIGN.md 5.7: the decision reaches the record first (flushed).
      await (await this.ledgerOf(rec))?.decision('keep');
      await this.save(true);
      if (!ready()) {
        rec.keeping = undefined;
        return;
      }
      const why = (e: unknown): void => {
        console.warn('Deer downloads: the partial file could not be kept', String(e));
        rec.keeping = undefined;
        if (rec.need) rec.need = { ...rec.need, evidence: 'another program has the saved part open; close it and try again' };
        this.touch(rec);
      };
      try {
        fileFor(part).moveTo(null, PathUtils.filename(target));
      } catch (e) {
        why(e);
        await this.save(true);
        return;
      }
      try {
        setSize(target, bytes);
      } catch (e) {
        // Never a file that holds more than the unbroken beginning under that name: the part goes back.
        try {
          fileFor(target).moveTo(null, PathUtils.filename(part));
        } catch {
          /* load() puts it back (rec.keeping) */
        }
        why(e);
        await this.save(true);
        return;
      }
      rec.keeping = undefined;
      rec.path = target;
      rec.filename = PathUtils.filename(target);
      rec.file = { ...rec.file, segments: [{ start: 0, end: bytes, received: bytes }] };
      rec.received = bytes;
      rec.need = undefined;
      rec.wait = undefined;
      rec.catcher = undefined;
      rec.note = `Kept the first ${sizeText(bytes)}${total > bytes ? ` of ${sizeText(total)}` : ''}`;
      this.event(rec, 'Partial file kept');
      // The row stays out of resume(), startOver(), setAddress() and preMatch() (deciding) until
      // complete() is done, which waits for Safe Browsing: as a paused row with no need, Resume or Space
      // then started the whole download again under the kept file's name, on a row that ended Completed
      // (review of Phase 3).
      await this.complete(rec);
    } finally {
      this.deciding.delete(id);
    }
  }

  /** An attempt of the schedule or a pasted address's proof for the row stops (Retry, Cancel, Remove, quit). */
  private stopRenewing(id: string): void {
    const ac = this.renewing.get(id);
    if (!ac) return;
    this.renewing.delete(id);
    this.proving.delete(id);
    ac.abort();
  }

  /** One history line for the row (the last 5 are kept): every automatic fix leaves one (RESUME-DESIGN.md 6). */
  private event(rec: Rec, text: string): void {
    rec.events = [...(rec.events ?? []), { at: Date.now(), text }].slice(-5);
  }

  /**
   * The one timer for the earliest wait.nextAt among paused rows (RESUME-DESIGN.md 3.0), and for the end
   * of a Waiting for link (catcher.until, Phase 3). Attempts that fell due while Deer was closed come
   * WAIT_GRACE after it started.
   */
  private armWaits(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    if (this.quitting || !this.loadedAt) return;
    let next = Infinity;
    for (const r of this.recs) {
      if (r.wait?.nextAt && r.state === 'paused' && !this.renewing.has(r.id) && !this.runs.has(r.id)) next = Math.min(next, r.wait.nextAt);
      if (r.catcher) next = Math.min(next, r.catcher.until);
    }
    if (next === Infinity) return;
    const now = Date.now();
    const delay = Math.min(2 ** 31 - 1, Math.max(0, next - now, this.loadedAt + WAIT_GRACE - now));
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      const due = Date.now() + 50;
      let ended = false;
      for (const r of [...this.recs]) {
        if (r.catcher && r.catcher.until <= due) {
          // Thirty minutes without the download started again: the row is Link expired again.
          r.catcher = undefined;
          this.touch(r);
          ended = true;
        }
        if (r.wait?.nextAt && r.wait.nextAt <= due && r.state === 'paused' && !this.renewing.has(r.id) && !this.runs.has(r.id)) {
          if (r.wait.for === 'address') void this.episode(r);
          else this.retryWait(r);
        }
      }
      if (ended) this.save(true);
      this.armWaits();
    }, delay);
  }

  /**
   * A network, server or sleep wait is due (RESUME-DESIGN.md G4): the row queues again and its run starts
   * through Checking, carrying the wait on (launch(), stopped()). While Firefox is offline
   * (Services.io.offline) a network wait only counts the try, since nothing can be reached; going online
   * brings the next one (bringWaits()).
   */
  private retryWait(r: Rec): void {
    if (r.state !== 'paused' || !r.wait || r.wait.for === 'address' || this.runs.has(r.id) || this.quitting) return;
    const now = Date.now();
    if (r.wait.for === 'network' && Services.io.offline) {
      const tries = r.wait.tries + 1;
      r.wait = { ...r.wait, tries, nextAt: waitNext(tries, now) };
    } else {
      r.state = 'queued';
      r.queuedAt = queueStamp();
      r.error = '';
      r.wait = { ...r.wait, nextAt: 0 };
    }
    this.touch(r);
    this.save(true);
    this.pump();
  }

  /**
   * RESUME-DESIGN.md G4: the network is back ('up': Firefox online again, a network link up), it changed
   * ('changed': another network), or the computer woke ('wake'). The next try of every network wait comes
   * SOON (never later than planned); a Link expired schedule that ran out gets one more attempt (3.0:
   * "after that, only on wake, on network link-up, or on a manual action"), at most once per
   * RENEW_ON_LINK; the transfers sleep stopped queue again WAKE_SETTLE after the wake, or at once on
   * link-up. A change alone does not end that settle: Gecko reports one on every wake, before the
   * network is really back (nsIOService's wake-up notifier).
   */
  private bringWaits(cause: 'up' | 'changed' | 'wake'): void {
    if (this.quitting || !this.loadedAt) return;
    const now = Date.now();
    let moved = false;
    for (const r of this.recs) {
      const w = r.wait;
      if (r.state !== 'paused' || !w || this.runs.has(r.id) || this.renewing.has(r.id)) continue;
      let at = 0;
      if (w.for === 'sleep') at = cause === 'wake' ? now + WAKE_SETTLE : cause === 'up' ? now : 0;
      else if (w.for === 'network') at = now + SOON;
      else if (w.for === 'address' && !w.nextAt && now - (this.renewFailed.get(r.id) ?? 0) >= RENEW_ON_LINK) at = now + SOON;
      if (!at || (w.for !== 'sleep' && w.nextAt && w.nextAt <= at)) continue;
      r.wait = { ...w, nextAt: at };
      this.touch(r);
      moved = true;
    }
    if (moved) this.save(true);
  }

  /**
   * The computer is going to sleep (RESUME-DESIGN.md G4): what runs pauses with reason 'sleep' (every
   * connection closes its writer, then stopped() saves the list, flushed) into wait 'sleep'. What waits
   * its turn waits for the wake too, so nothing starts on the way down.
   */
  private sleep(): void {
    if (this.quitting || !this.loadedAt) return;
    const now = Date.now();
    let changed = false;
    for (const r of this.recs) {
      if (r.state !== 'queued' || this.runs.has(r.id)) continue;
      this.warm.get(r.id)?.dropPending();
      this.warm.delete(r.id);
      r.state = 'paused';
      r.wait = { for: 'sleep', since: now, tries: 0, nextAt: now + SLEEP_FALLBACK };
      this.touch(r);
      changed = true;
    }
    for (const [id, run] of this.runs) {
      const r = this.find(id);
      if (!r || run.firefox || run.reason || r.state !== 'downloading') continue;
      run.reason = 'sleep';
      run.ac.abort();
      this.touch(r);
    }
    if (changed) this.save(true);
  }

  /**
   * CONTINUE_AFTER after the engine started (RESUME-DESIGN.md G4, the owner's decision 5): the downloads a
   * quit or a crash stopped (resumeOnStart) queue again, through Checking, while "Continue unfinished
   * downloads when Deer starts" is on (the default). Rows the person paused were never marked; waiting
   * rows continue on their own schedule either way. The marks go now, whatever the setting says.
   */
  private continueAfterStart(): void {
    this.continueTimer = null;
    if (this.quitting) return;
    const on = settings().continueDownloadsOnStart !== false;
    let changed = false;
    for (const r of [...this.recs].sort((a, b) => a.queuedAt - b.queuedAt)) {
      if (!r.resumeOnStart) continue;
      r.resumeOnStart = undefined;
      changed = true;
      if (!on || r.state !== 'paused' || r.need || r.wait || r.mode === 'browser' || this.runs.has(r.id) || this.deciding.has(r.id) || this.renewing.has(r.id)) continue;
      r.state = 'queued';
      r.queuedAt = queueStamp();
      r.error = '';
      this.event(r, 'Continued after restart');
      this.touch(r);
    }
    if (!changed) return;
    this.save(true);
    this.pump();
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
      // Slept time is not active time (RESUME-DESIGN.md G4): a tick after a sleep counts as two at most.
      const dt = Math.max(0, Math.min(now - run.last, 2 * TICK));
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
      // RESUME-DESIGN.md 4.1: the hashing is looked at on a timer too, and a run seals every SEAL_EVERY or SEAL_BYTES.
      const t = run.transfer;
      const l = t instanceof FileTransfer ? t.ledger : null;
      if (l && t instanceof FileTransfer && rec.state === 'downloading' && !run.reason) {
        l.pump();
        // Not once every byte is in: the seal before the final rename comes next. The bytes never bring one
        // sooner than SEAL_MIN_GAP after the last (review of Phase 5: back to back above about 1 GB/s).
        if (!this.sealing.has(id) && t.received < t.state.total && (now - l.sealedAt >= SEAL_EVERY || (rec.netBytes - (run.sealBytes ?? 0) >= SEAL_BYTES && now - l.sealedAt >= SEAL_MIN_GAP))) {
          run.sealBytes = rec.netBytes;
          void this.seal(rec, t, 'timer');
        }
      }
      this.dirty.add(id);
    }
    this.flush();
    if (now - this.lastSave > SAVE_EVERY && this.runs.size) {
      this.save(now - this.lastFlushed > FLUSH_EVERY);
      // The block lines hashed meanwhile reach the journal (a seal flushes them to the disk).
      for (const [id, run] of this.runs) if (run.transfer instanceof FileTransfer) void this.ledgers.get(id)?.journal.flush();
    }
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
    const multi = r.mode === 'stream' || (!!r.file?.ranges && r.file.total >= 8 * 1024 * 1024);
    const connections = Math.max(1, Math.min(32, Number(s.connections) || 8));
    const renewing = !pausing && (this.renewing.has(r.id) || run?.phase === 'renewing');
    // Checking (RESUME-DESIGN.md 6) only once it took CHECKING_AFTER; 'probing' until then.
    // A completed row: Check file (Checking) and Repair or Restore original (Repairing), Phase 5.
    const fixing = r.state === 'completed' ? this.fixing.get(r.id) : undefined;
    const runPhase = run?.phase === 'checking' && Date.now() - (run.phaseAt ?? 0) < CHECKING_AFTER ? 'probing' : (run?.phase ?? '');
    const phase = fixing ? 'repairing' : r.state === 'completed' && this.checking.has(r.id) ? 'checking' : runPhase;
    const wait = r.state === 'paused' && !pausing && r.wait ? { for: r.wait.for, tries: r.wait.tries, nextAt: r.wait.nextAt } : null;
    // Changed after download (4.2): modified after it finished, read from the disk as `missing` is. Not while
    // Deer's own Repair writes it, nor after one a crash cut short until the check after the start has looked.
    const disk = checkDisk && r.state === 'completed' && !!r.path ? diskState(r.path, !!r.final) : null;
    const own = !!fixing || !!r.repairing;
    const edited = r.state === 'completed' && !own && (!!r.check?.edited || (!!disk && !!r.final && disk.mtime > 0 && editedSince(disk.mtime, r.final, r.finishedAt)));
    // Damaged (RESUME-DESIGN.md 6): a completed row that needs Repair. A file modified after it finished is
    // Changed after download first (review of Phase 5: Space on such a Damaged row repaired over the edit).
    const need = (r.state === 'paused' && !pausing && r.need) || (r.state === 'completed' && r.need?.kind === 'repair' && !edited) ? (r.need ?? null) : null;
    const damaged = need?.kind === 'repair' && !!r.check?.bad.length;
    const fills = damaged && r.check ? damagedFills(r.total > 0 ? r.total : (r.final?.size ?? 0), r.check.bad, r.check.bs) : r.mode === 'stream' && r.stream ? streamFills(r.stream) : r.file ? fileFills(r.file) : [];
    // Keep partial file (3 G3): the unbroken beginning, for a one-file File changed row.
    const kept = need?.kind === 'choice' && r.mode === 'file' && r.file && r.path ? unbroken(r.file.segments) : 0;
    return {
      id: r.id,
      url: r.url,
      pageUrl: r.identity.pageUrl,
      filename: r.filename,
      dir: r.dir,
      path: r.path,
      category: categoryOf(r.filename, r.mime),
      state: pausing ? 'paused' : r.state,
      phase: pausing ? '' : renewing ? 'renewing' : phase,
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
      missing: !!disk && !disk.exists,
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
      need: need ? { kind: need.kind, status: need.status ?? 0, evidence: need.evidence ?? '' } : null,
      wait,
      nextAt: wait?.nextAt ?? 0,
      status: r.state === 'paused' ? (r.need?.status ?? r.wait?.status ?? 0) : (run?.status ?? 0),
      history: (r.events ?? []).map((e) => ({ at: e.at, text: e.text })),
      armed: need?.kind === 'address' && !!r.catcher && r.catcher.until > Date.now(),
      canRenew: r.mode === 'file' && !!r.file?.probed && !!r.path,
      // The ring's dot (RESUME-DESIGN.md 6): only rows that started needing the person in this session.
      attention: !!need && need.since >= this.session.startedAt,
      keep: kept > 0 ? { bytes: kept, name: partialName(r.filename), older: !!r.oldParts?.length } : null,
      check:
        r.state === 'completed' && (r.check || edited)
          ? {
              at: r.check?.at ?? 0,
              ok: !!r.check?.ok && !edited,
              bad: r.check?.bad.length ?? 0,
              badBytes: r.check?.badBytes ?? 0,
              unlocated: !!r.check?.unlocated,
              edited,
              changedAt: r.check?.edited ? r.check.changedAt : (disk?.mtime ?? 0),
              media: r.check?.media ?? '',
              site: r.check?.site ?? '',
              status: r.check?.status ?? 0,
            }
          : null,
      repair: fixing ? { parts: fixing.parts, bytes: fixing.bytes } : null,
    };
  }

  // ---- finished files: Check file, Repair, Restore original (RESUME-DESIGN.md 4.2, 4.3, 6; Phase 5) ----

  /**
   * Check file (access key H): see downloads/finished.ts checkFinished(). Modified after it finished is
   * Changed after download (never damage); damaged blocks make the row Damaged (need 'repair'); with ffmpeg,
   * a video or a song is also read through (mediaCheck()). The result stays on the row (rec.check) and a
   * history line says what was found.
   */
  async checkFile(id: string, quiet = false): Promise<void> {
    const rec = this.find(id);
    if (!rec || rec.state !== 'completed' || !rec.path || this.checking.has(id) || this.fixing.has(id)) return;
    this.checking.add(id);
    this.touch(rec);
    const ac = new AbortController();
    try {
      const l = rec.mode === 'file' ? await this.ledgerOf(rec) : null;
      const s = rec.file;
      const path = rec.path;
      // A file with no record and no checksum is compared with the site (never after a crash: no network then).
      const site =
        rec.mode === 'file' && s && s.ranges && s.finalUrl && !quiet
          ? (total: number) => siteCompare({ state: s, identity: new Identity(rec.identity), kind: { kind: 'binary', sure: false }, saved: total }, s.finalUrl, path, total, ac.signal).catch(() => null)
          : null;
      // A repair of Deer's own that a quit or a crash cut short (its mark on the row, its repair line in the
      // record: 4.3 step 4): its writes moved the modified time, so the record decides, never "edited".
      const repairing = !!l && (!!rec.repairing || l.pendingRepair.length > 0);
      const r = await checkFinished({ path: rec.path, ledger: l, sha256: rec.sha256 ?? '', final: rec.final, finishedAt: rec.finishedAt, site, repairing });
      if (!this.recs.includes(rec) || rec.state !== 'completed') return;
      if (r.missing) return;
      if (repairing && l && !r.edited) {
        // Review of Phase 5: that repair is accounted for now (what it left damaged is below); the file as it
        // is now is what a later edit is measured from.
        await this.stamp(rec);
        rec.repairing = undefined;
        if (l.pendingRepair.length && this.ledgers.get(rec.id) === l) await l.repaired([], new Map());
      }
      let media = '';
      const ff = /^(video|music)$/.test(categoryOf(rec.filename, rec.mime)) && !r.edited ? (await this.ffmpeg()).path : null;
      if (ff) media = (await mediaCheck(ff, rec.path)) ?? '';
      const firstLine = media.split(/\r?\n/).find(Boolean) ?? '';
      const damaged = r.bad.length > 0 || r.unlocated;
      rec.check = {
        at: Date.now(),
        ok: !damaged && !r.edited && !r.changed,
        bad: r.bad,
        bs: r.bs,
        badBytes: r.badBytes,
        unlocated: r.unlocated,
        edited: r.edited,
        changedAt: r.changedAt,
        media: firstLine.slice(0, 200),
        site: r.changed ? 'changed' : '',
        status: 0,
      };
      if (damaged) rec.need = { kind: 'repair', since: Date.now(), evidence: r.unlocated ? 'its checksum no longer matches' : damagedParts(r.bad.length) };
      else if (rec.need?.kind === 'repair') rec.need = undefined;
      if (r.edited) this.event(rec, 'Changed after download');
      else if (r.changed) this.event(rec, 'Checked: the file on the site is different from this one');
      else if (damaged) this.event(rec, r.unlocated ? 'Checked: the file no longer matches its checksum' : `Checked: ${damagedParts(r.bad.length)}`);
      else if (r.how === 'none') this.event(rec, 'Checked: Deer has nothing to check this file against');
      else this.event(rec, firstLine ? 'Checked: no damaged parts, but ffmpeg found problems' : 'Checked: no damage found');
    } catch (e) {
      console.warn('Deer downloads: Check file failed', String(e));
    } finally {
      this.checking.delete(id);
      this.touch(rec);
      this.save(true);
    }
  }

  /**
   * Repair (RESUME-DESIGN.md 4.3): a Damaged row's damaged parts, and only those, fetched again: proven with
   * its good blocks, each part checked against the record before it is written in place
   * (downloads/finished.ts repairFinished()). The site's file is another one: Repair refuses (the row stays
   * Damaged and offers Download again). The link stopped working: the original address is asked first
   * (G1). A file with no record is compared with the site first (2 of 3 windows, then block by block). With
   * `restore` (Restore original, Changed after download, only when chosen) every block that no longer
   * matches the record (downloads/finished.ts restoreFinished(): nothing of the file changes until every
   * block is in hand). A stream or a yt-dlp file has no record: its repair is Download again (4.4).
   * Review of Phase 5:
   *   - a file modified after it finished is never repaired (4.4, 6: the person's edit, or another file
   *     saved under the name): Repair refuses before anything is asked or written and the row reads Changed
   *     after download; repairFinished() also checks before each block it writes;
   *   - Deer's own writes move the modified time: the file as it is afterwards is what a later edit is
   *     measured from (rec.final), also when the repair was cut short (a quit), whose mark (rec.repairing)
   *     then stays so the next start checks it (4.3 step 4);
   *   - a repaired file that still does not match the SHA-256 it was saved with stays Damaged and says so.
   */
  async repair(id: string, restore = false): Promise<void> {
    const rec = this.find(id);
    if (!rec || rec.state !== 'completed' || !rec.path || this.fixing.has(id) || this.checking.has(id) || !existsSync(rec.path)) return;
    if (rec.mode !== 'file' || !rec.file) {
      if (rec.need?.kind === 'repair') this.downloadAgain(id);
      return;
    }
    const s = rec.file;
    const ac = new AbortController();
    const total = rec.final?.size ?? rec.total;
    this.fixing.set(id, { parts: rec.check?.bad.length ?? 0, bytes: rec.check?.badBytes ?? 0, ac });
    this.touch(rec);
    const ctx = { state: s, identity: new Identity(rec.identity), kind: await readKind(s, ''), saved: total };
    let site: CheckState['site'] = '';
    let status = 0;
    let wrote = 0;
    let done = false;
    let edited = 0;
    try {
      const l = await this.ledgerOf(rec);
      if (restore && !l) return;
      const st = await statOf(rec.path);
      if (!st) return;
      // 4.4: never over a file someone changed after it finished (a repair of Deer's own cut short excepted).
      const own = !!rec.repairing || (l?.pendingRepair.length ?? 0) > 0;
      if (!restore && !own && editedSince(st.mtime, rec.final, rec.finishedAt)) {
        edited = st.mtime;
        return;
      }
      let bad = rec.check?.bad ?? [];
      let bs = rec.check?.bs || l?.bs || blockSize(total);
      if (!restore && (!l || (rec.check?.unlocated && !bad.length))) {
        // No record (an older file), or a checksum no record can place: the site's bytes are the reference
        // once 2 of 3 windows matched (4.3).
        const cmp = await siteCompare(ctx, s.finalUrl, rec.path, total, ac.signal).catch(() => null);
        if (!cmp) site = 'unreachable';
        else if (cmp.changed) site = 'changed';
        else {
          bad = cmp.bad;
          bs = cmp.bs;
        }
      }
      if (site) return;
      // What Repairing says it fetches (RESUME-DESIGN.md 6), and the mark a crash leaves (saved, flushed) before
      // anything is written.
      const plan = async (list: number[], size: number): Promise<void> => {
        this.fixing.set(id, { parts: list.length, bytes: list.reduce((n, b) => n + Math.max(0, Math.min(bs, size - b * bs)), 0), ac });
        if (list.length) {
          rec.repairing = Date.now();
          await this.save(true);
        }
        this.touch(rec);
      };
      const renew = async (): Promise<string | null> => {
        const list = addresses(rec.url, s, s.finalUrl);
        if (!list.length) return null;
        const out = await originalAddress({ ctx: { ...ctx, heads: l }, partPath: rec.path, segments: [{ start: 0, end: total, received: total }], seed: rec.id }, list, ac.signal);
        if (out.verdict !== 'same') return null;
        adopt(s, out.found, 'original');
        this.event(rec, 'New link found');
        return s.finalUrl;
      };
      const counted = (): void => {
        wrote++;
      };
      let out: RepairOutcome;
      if (restore && l) {
        bs = l.bs;
        const patch = PathUtils.join(this.journalDir, `${rec.id}.restore`);
        out = await restoreFinished({ ctx: { ...ctx, heads: l }, path: rec.path, url: s.finalUrl, seed: rec.id, ledger: l, patch, signal: ac.signal, renew, planned: (list) => plan(list, l.total), wrote: counted });
      } else {
        await plan(bad, l?.total ?? total);
        out = bad.length ? await repairFinished({ ctx: { ...ctx, heads: l }, path: rec.path, url: s.finalUrl, seed: rec.id, ledger: l, bad, bs, total: l?.total ?? total, signal: ac.signal, renew, wrote: counted }) : { kind: 'repaired', fixed: [], url: s.finalUrl };
      }
      if (out.kind === 'edited') {
        edited = (await statOf(rec.path))?.mtime ?? Date.now();
        return;
      }
      if (out.kind === 'repaired') {
        done = true;
        if (out.url !== s.finalUrl) s.finalUrl = out.url;
        await this.stamp(rec);
        const sha = await IOUtils.computeHexDigest(rec.path, 'sha256').catch(() => '');
        // A repaired file matches the SHA-256 it was saved with; with no record that is what decides. One that
        // still does not keeps that SHA-256 as the reference, and stays Damaged (review of Phase 5).
        const whole = !rec.sha256 || !sha || sha === rec.sha256;
        if (sha && !rec.sha256) rec.sha256 = sha;
        if (l && rec.final) await l.refinish({ sha256: rec.sha256 ?? '', size: rec.final.size, mtime: rec.final.mtime, path: rec.path, t: Date.now() });
        rec.need = whole ? undefined : { kind: 'repair', since: rec.need?.kind === 'repair' ? rec.need.since : Date.now(), evidence: 'its checksum no longer matches' };
        rec.check = { at: Date.now(), ok: whole, bad: [], bs, badBytes: 0, unlocated: !whole, edited: false, changedAt: 0, media: rec.check?.media ?? '', site: '', status: 0 };
        const n = out.fixed.length;
        if (!whole) this.event(rec, n ? `${damagedParts(n)} fetched again, but the file still does not match its checksum` : 'The file still does not match its checksum');
        else this.event(rec, restore ? 'Original restored' : n ? `Repaired ${damagedParts(n)}` : 'Checked: no damage found');
        return;
      }
      site = out.kind;
      status = out.kind === 'expired' || out.kind === 'unreachable' ? out.status : 0;
    } catch (e) {
      if (!ac.signal.aborted) console.warn('Deer downloads: Repair failed', String(e));
      site = ac.signal.aborted ? '' : 'unreachable';
    } finally {
      this.fixing.delete(id);
      const here = this.recs.includes(rec);
      // Deer's own writes moved the modified time; a repair cut short keeps its mark for the next start's check.
      if (here && wrote > 0 && !edited && !done) await this.stamp(rec);
      if (done || !wrote || edited || !ac.signal.aborted) rec.repairing = undefined;
      if (here && edited) {
        rec.check = { ...(rec.check ?? { at: 0, ok: false, bad: [], bs: 0, badBytes: 0, unlocated: false, media: '', site: '' as const, status: 0 }), at: Date.now(), ok: false, edited: true, changedAt: edited };
        if (rec.need?.kind === 'repair') rec.need = undefined;
        this.event(rec, restore ? 'Restore stopped: the file changed while it was being restored' : 'Repair stopped: the file was changed after download');
      } else if (site && here) {
        rec.check = { ...(rec.check ?? { at: Date.now(), ok: false, bad: [], bs: 0, badBytes: 0, unlocated: false, edited: false, changedAt: 0, media: '' }), site, status };
        const what = restore ? 'Restore' : 'Repair';
        this.event(rec, site === 'changed' ? `${what} stopped: the file on the site is different now` : site === 'expired' ? `${what} stopped: the link stopped working` : `${what} stopped: the site could not be reached`);
      }
      this.touch(rec);
      this.save(true);
    }
  }

  /** Restore original (Changed after download, RESUME-DESIGN.md 4.4, 6): only when the person chooses it. */
  restoreOriginal(id: string): Promise<void> {
    return this.repair(id, true);
  }

  /**
   * Download again: the same download as a new row, the finished file left as it is (Repair refused: the
   * file on the site changed; a stream or a yt-dlp file, which has no block record: 4.4). Its id, or null.
   */
  downloadAgain(id: string): string | null {
    const rec = this.find(id);
    if (!rec || rec.mode === 'browser') return null;
    const base: StartOptions = { filename: rec.filename, named: true, title: rec.title, quality: rec.quality, pageUrl: rec.identity.pageUrl, identity: { ...rec.identity } };
    try {
      if (rec.mode === 'ytdlp' && rec.ytdlp) return this.start(rec.ytdlp.pageUrl, { ...base, mode: 'ytdlp', ytdlpFormat: rec.ytdlp.format, ytdlpExt: rec.ytdlp.ext, audioOnly: rec.ytdlp.audioOnly });
      if (rec.mode === 'stream' && rec.stream) {
        const st = rec.stream;
        return this.start(st.sourceUrl, { ...base, mode: st.format, variantUrl: st.variantUrl, audioUrl: st.audioUrl, dashVideo: st.dashVideo, dashAudio: st.dashAudio, audioOnly: st.audioOnly, bytes: st.expected });
      }
      return this.start(rec.url, { ...base, mode: 'file' });
    } catch (e) {
      console.warn('Deer downloads: could not download again', String(e));
      return null;
    }
  }

  /**
   * RESUME-DESIGN.md 4.2: after an unclean session, the files finished in it are checked (their records
   * hashed again: no network), and so is any file whose repair a crash cut short. One at a time.
   */
  private async checkAfterStart(): Promise<void> {
    const due: Rec[] = [];
    for (const r of this.recs) {
      if (r.state !== 'completed' || r.mode !== 'file' || !r.journal || !r.path) continue;
      const crashed = !this.prevClean && !!this.prevStartedAt && r.finishedAt >= this.prevStartedAt;
      if (crashed || r.repairing) due.push(r);
    }
    for (const r of due) {
      if (this.quitting) return;
      await this.checkFile(r.id, true);
    }
    // Review of Phase 5: a finished file whose record was never kept (a quit or a crash came while its last
    // blocks were hashed from it after the finish: finishRecord()) gets it now.
    for (const r of this.recs) {
      if (this.quitting) return;
      if (r.state === 'completed' && r.mode === 'file' && !!r.path && !!r.journal && !r.journal.endsWith('.done.jsonl')) await this.finishRecord(r).catch(() => undefined);
    }
  }

  /**
   * RESUME-DESIGN.md 5.7: the store and its .bak are both lost: a row for every journal, from its header
   * (address, path, length, validators) and its last seal (the coverage), unfinished ones paused and marked
   * dirty (so their saved part is checked when they continue), finished ones completed with their SHA-256.
   */
  private async fromJournals(): Promise<Rec[]> {
    let names: string[] = [];
    try {
      names = await IOUtils.getChildren(this.journalDir);
    } catch {
      return [];
    }
    const out: Rec[] = [];
    for (const path of names.filter((p) => /\.jsonl$/i.test(p)).sort()) {
      const l = await Ledger.open(path).catch(() => null);
      if (!l || !l.header.id || !l.header.url) continue;
      const h = l.header;
      const done = /\.done\.jsonl$/i.test(path);
      const file = FileTransfer.fresh(h.url);
      const cov = [...(l.seal?.cov ?? [])].sort((a, b) => a[0] - b[0]);
      const segments: Segment[] = cov.map(([start, received], i) => ({ start, end: i + 1 < cov.length ? cov[i + 1][0] : h.total, received }));
      Object.assign(file, { total: h.total, ranges: true, probed: true, etag: h.etag, lastModified: h.lm, contentType: h.ct, dispositionName: h.name, allowFresh: false, segments: done ? [{ start: 0, end: h.total, received: h.total }] : segments, dirty: !done });
      const where = done && l.fin?.path ? l.fin.path : h.path;
      const rec = this.newRec(h.url, { filename: PathUtils.filename(where), named: true, dir: PathUtils.parent(where) ?? '', identity: (h.identity ?? {}) as Partial<IdentityJSON> });
      Object.assign(rec, {
        id: h.id,
        path: where,
        mime: h.ct,
        file,
        total: h.total,
        received: file.segments.reduce((n, seg) => n + seg.received, 0),
        state: done ? 'completed' : 'paused',
        startedAt: h.t,
        finishedAt: done ? (l.fin?.t ?? h.t) : 0,
        journal: path,
        ...(done && l.fin ? { sha256: l.fin.sha256 || undefined, final: { size: l.fin.size, mtime: l.fin.mtime } } : {}),
      });
      out.push(rec);
    }
    return out;
  }

  // ---- persistence ----

  private persisted(): { version: number; session: { startedAt: number; clean: boolean }; items: Rec[] } {
    return {
      version: STORE_VERSION,
      session: { ...this.session },
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

  /**
   * Atomic: written to a temp file, then moved over the store. `flush` (state changes, every
   * FLUSH_EVERY while running, quit) makes the OS write it to the disk before the promise resolves,
   * and the same list is then written, flushed, as the .bak that load() falls back to; progress saves
   * stay unflushed and leave the .bak alone (RESUME-DESIGN.md 5.6). So the .bak is always the last
   * flushed list, never one a power loss can catch half-written with the store (review of Phase 1:
   * backupFile on every save rotated it every 2 s).
   */
  save(flush = false): Promise<void> {
    this.lastSave = Date.now();
    if (flush) this.lastFlushed = this.lastSave;
    if (!this.storePath) return this.saving;
    const data = this.persisted();
    const store = this.storePath;
    this.saving = this.saving
      .then(async () => {
        await IOUtils.writeJSON(store, data, { tmpPath: store + '.tmp', flush });
        if (flush) await IOUtils.writeJSON(store + '.bak', data, { tmpPath: store + '.bak.tmp', flush: true });
      })
      .catch((e: unknown) => console.error('Deer downloads: store write failed', e));
    this.armWaits();
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
    return this.recs.filter((r) => r.identity.isPrivate && running(r)).length;
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
    // RESUME-DESIGN.md G4: the network and the computer's sleep (bringWaits(), sleep()). Firefox online
    // again ("online"; netwerk/base/nsIOService.cpp), a network link up or changed ("up", "changed";
    // netwerk/base/nsINetworkLinkService.idl), sleep_notification and wake_notification (widget/nsIWidget.h
    // topics, sent by the Windows widget on power events).
    Services.obs.addObserver((_s: unknown, _t: string, data: string) => {
      if (data === 'online') this.bringWaits('up');
    }, 'network:offline-status-changed');
    Services.obs.addObserver((_s: unknown, _t: string, data: string) => {
      if (data === 'up' || data === 'changed') this.bringWaits(data);
    }, 'network:link-status-changed');
    Services.obs.addObserver(() => this.sleep(), 'sleep_notification');
    Services.obs.addObserver(() => this.bringWaits('wake'), 'wake_notification');
  }

  private shuttingDown: Promise<void> | null = null;

  /** Stop every transfer where it is (resumable) and write the store. */
  shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = (async () => {
      this.quitting = true;
      // Attempts of the schedule stop; their rows stay paused with the count and time saved.
      for (const id of [...this.renewing.keys()]) this.stopRenewing(id);
      // Probes held for a waiting row (adopt()) stop as a row's would.
      for (const run of this.holding) {
        run.reason = 'quit';
        run.ac.abort();
      }
      this.armWaits();
      if (this.continueTimer) clearTimeout(this.continueTimer);
      this.continueTimer = null;
      // RESUME-DESIGN.md G4: what this quit stops continues at the next start (resumeOnStart); what the
      // person had paused, or was cancelling, does not.
      for (const r of this.recs) if (r.state === 'queued' && !this.runs.has(r.id)) r.resumeOnStart = true;
      const waits: Promise<unknown>[] = [];
      for (const [id, run] of this.runs) {
        const rec = this.find(id);
        if (!rec) continue;
        if (run.firefox) {
          rec.state = 'failed';
          rec.error = 'Interrupted when Deer closed.';
          continue;
        }
        if (run.reason !== 'cancel' && !(run.reason === 'pause' && !run.resumeAfter)) rec.resumeOnStart = true;
        run.reason = 'quit';
        run.ac.abort();
        waits.push(this.whenSettled(id));
      }
      await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 5000))]);
      // The seals of those stops (RESUME-DESIGN.md 4.1: at quit); one that does not finish leaves its row
      // dirty, which the next start checks (4.2).
      await Promise.race([Promise.all([...this.sealing.values()]), new Promise((r) => setTimeout(r, 4000))]);
      for (const f of this.fixing.values()) f.ac.abort();
      this.session.clean = true;
      await this.save(true);
    })();
    return this.shuttingDown;
  }
}

/**
 * A stored file record put back to what can be true (review of Phase 1): a segment whose end was never
 * known beside a known total is the single stream of unknown length it was (such a record cut the
 * .part and looped fileFills() forever), and no segment claims more than its own length.
 */
function settleSegments(f: FileState): void {
  if (!Array.isArray(f.segments)) return;
  if (f.total >= 0 && f.segments.some((seg) => seg.end < 0)) {
    f.total = -1;
    f.ranges = false;
  }
  for (const seg of f.segments) if (seg.end >= 0) seg.received = Math.max(0, Math.min(seg.received, seg.end - seg.start));
}

/** A paused row Deer continues by itself, the person needed for nothing (RESUME-DESIGN.md G4; format.ts isWaiting()). */
function waiting(r: Rec): boolean {
  return r.state === 'paused' && !r.need && !!r.wait && r.wait.for !== 'address';
}

/**
 * Under way for the quit prompt (runningCount()): running or waiting its turn, but not a network or server
 * wait's automatic try still on its check (rec.trying) or queued for a slot (rec.wait): those are still
 * the wait, which a quit never waits for (RESUME-DESIGN.md 6; review of Phase 4).
 */
function running(r: Rec): boolean {
  return ACTIVE.includes(r.state) && !r.trying && !(r.state === 'queued' && r.wait && r.wait.for !== 'address');
}

/**
 * After a crash (RESUME-DESIGN.md G4, before Phase 5's hash record): the last SUSPECT_TAIL below each
 * segment's mark of a file download that was running may never have reached the disk, so it is given back
 * to be fetched again (rec.suspect, which the history line of its next run reports).
 */
function suspectTail(r: Rec, now: number): void {
  if (r.mode !== 'file' || !r.file || !Array.isArray(r.file.segments)) return;
  const back = rewindTails(r.file.segments);
  if (back <= 0) return;
  r.received = savedBytes(r);
  r.suspect = { at: now, bytes: back + (r.suspect?.bytes ?? 0) };
}

/** A row's names for preMatch() (RESUME-DESIGN.md 2.2): its file name and the server's. */
function namesOf(r: Rec): string[] {
  return [r.filename, r.file?.dispositionName ?? ''].filter(Boolean);
}

/** A row's addresses for preMatch() (2.2): its own, the final one, the redirect hops and the ones it replaced; its own first. */
function urlsOf(r: Rec): string[] {
  const f = r.file;
  const all = [r.url, f?.url ?? '', f?.finalUrl ?? '', ...(f?.chain ?? []), ...(f?.address?.history ?? []).flatMap((h) => [h.url, h.finalUrl])];
  return [...new Set(all.filter((u) => /^https?:\/\//i.test(u)))];
}

/** What a found address answered, kept on a File changed row for Start over (need.candidate). */
function candidateOf(f: Found): NeedCandidate {
  return { url: f.url, finalUrl: f.finalUrl, total: f.total, etag: f.etag, lastModified: f.lastModified, contentType: f.contentType };
}

/**
 * A pasted address (Use another address…) goes out as Add link's do: first-party, in the download's
 * container and private state (RESUME-DESIGN.md 2.1), and with no source page (RESUME-DESIGN.md 8):
 * no Referer and no Origin, so the old page is never sent to whatever host the person pastes (review
 * of Phase 2). The page stays on the row (From page; the Phase 3 page step), never the old page's
 * principal or cookie jar, which belonged to the old address's page.
 */
function pastedIdentity(id: IdentityJSON): IdentityJSON {
  return new Identity({ pageUrl: id.pageUrl, userContextId: id.userContextId, isPrivate: id.isPrivate, withOrigin: false, referrerPolicy: 'no-referrer', firstParty: true }).toJSON();
}

/** Bytes certainly in the download's part files: the file's segments, or the stream's written tracks. */
function savedBytes(rec: Rec): number {
  if (rec.mode === 'stream') return (rec.stream?.tracks ?? []).reduce((n, t) => n + (t.bytes || 0), 0);
  return (rec.file?.segments ?? []).reduce((n, s) => n + (s.received || 0), 0);
}

/** "1 damaged part", "3 damaged parts" (RESUME-DESIGN.md 6 wording: "Fetching 3 damaged parts again"). */
function damagedParts(n: number): string {
  return `${n} damaged ${n === 1 ? 'part' : 'parts'}`;
}

/**
 * Whether a finished file is there and, with `time`, when it was last modified (view(): Deleted, Changed after
 * download).
 */
function diskState(path: string, time: boolean): { exists: boolean; mtime: number } {
  try {
    const f = fileFor(path);
    if (!f.exists()) return { exists: false, mtime: 0 };
    return { exists: true, mtime: time ? Number(f.lastModifiedTime) || 0 : 0 };
  } catch {
    return { exists: false, mtime: 0 };
  }
}

/** Remove a file, trying again a few times while something (a scan, a hash read) still holds it. */
async function removeSoon(path: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      await IOUtils.remove(path, { ignoreAbsent: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function streamPartsExist(p: string): boolean {
  const base = stem(p);
  return ['.video.part', '.audio.part'].some((ext) => existsSync(base + ext));
}

export const VitreDownloads = new Manager();
