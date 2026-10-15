// Shapes shared by the downloads engine (VitreDownloads.sys.ts and src/modules/downloads/*) and
// its window UI (src/window/modules/downloads). Types only: window code imports this file with
// `import type`. Same shapes as the Electron build's app/src/main/modules/downloads/types.ts, plus
// what Gecko adds (the cookie jar a download belongs to, DASH, the "ffmpeg not found" state).

export type DownloadState = 'starting' | 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Why a paused row waits for the person (spikes/downloader/RESUME-DESIGN.md 5.1). Phase 1 sets
 * 'address' (Link expired) and 'choice' (File changed); Phase 3 'page' (a download Firefox moved,
 * which only its page can start again: Start it again from its page); Phase 5 'repair', on a completed
 * row: Damaged (Check file found damaged parts, or its whole-file checksum no longer matches). Phase 7
 * sets 'page' on a download of Deer's too, when its page opened out of sight landed on another site or
 * showed a password field and nothing there was the file ("The page may need you to sign in.").
 */
export type NeedKind = 'address' | 'choice' | 'repair' | 'page';

/**
 * What a paused row waits for, Deer acting by itself when it comes (RESUME-DESIGN.md 5.1). Phase 2 sets
 * 'address': the next automatic attempt to renew a Link expired row's address. Phase 4 (G4,
 * downloads/waits.ts): 'network' (Waiting for network: the site could not be reached), 'server'
 * (Retrying: the site answered 5xx or 429) and 'sleep' (the computer slept while it ran); each continues
 * by itself at `nextAt`.
 */
export type WaitFor = 'network' | 'server' | 'sleep' | 'address';

export type Category = 'video' | 'music' | 'documents' | 'compressed' | 'programs' | 'images' | 'other';

/** Whose request a download is: the page it came from and the cookie jar it lives in (VitreNet Identity). */
export interface IdentityJSON {
  pageUrl: string;
  /**
   * The page the requests go out as, when it is not pageUrl: an embedded player's frame whose server
   * only serves that player (media.ts offer()). Only Referer, Origin and the loading principal use it;
   * pageUrl stays the download's source (the list, Safe Browsing, Mark of the Web). Absent otherwise.
   */
  requestPage?: string;
  userContextId: number;
  isPrivate: boolean;
  /** Send Origin on cross-origin requests (media a page's player fetched). */
  withOrigin: boolean;
  /** Loaded as a top-level navigation would be (a clicked link): system principal, unpartitioned cookies. */
  firstParty: boolean;
  /**
   * With firstParty false: the page is the loading AND triggering principal and third-party cookies are
   * not forced, so Necko applies that page's cross-site cookie rules strictly (no SameSite=Strict/Lax
   * cookies of another site). A download one site starts on another. Missing in older saved records.
   */
  pageRules?: boolean;
  /**
   * The page's own principal (E10SUtils.serializePrincipal) for a page-derived address handed to
   * the 'downloads' service (a link, an image, Alt+click): the channel's loading AND triggering
   * principal, as Firefox's Save Link As makes it (nsContextMenu.sys.mjs saveHelper). Absent for
   * addresses Deer or the person chose (Add link, a copied link) and in older records.
   */
  principal?: string;
  /** The page's referrer policy for this download by its W3C name ('' = the default); see referrer.ts. */
  referrerPolicy?: string;
  /** The page's cookie jar settings (E10SUtils.serializeCookieJarSettings), with `principal`. */
  cookieJarSettings?: string;
}

/** What a window is told about one download. */
export interface DownloadView {
  id: string;
  url: string;
  pageUrl: string;
  filename: string;
  dir: string;
  /** Full path of the finished file (empty until it has a name). */
  path: string;
  category: Category;
  state: DownloadState;
  /**
   * '' while transferring; 'probing' before the first byte; 'merging' while ffmpeg joins a stream;
   * 'renewing' while Deer looks for a new address for it (Renewing link, RESUME-DESIGN.md 6);
   * 'checking' while a download with saved bytes asks its address again before it continues
   * (Checking, RESUME-DESIGN.md 6, Phase 4): reported only once that took 400 ms, so a quick resume
   * never flickers ('probing' until then, with the saved bytes in `received`). On a completed row
   * (Phase 5): 'checking' while Check file runs, 'repairing' while Repair or Restore original fetches
   * damaged parts again (Repairing, `repair`).
   */
  phase: '' | 'probing' | 'merging' | 'renewing' | 'checking' | 'repairing';
  received: number;
  /** -1 when the server didn't say. For streams this is an estimate. */
  total: number;
  /** Bytes per second, over the last few seconds. */
  speed: number;
  peak: number;
  average: number;
  /** Seconds left, or -1. */
  eta: number;
  connections: number;
  maxConnections: number;
  resumable: boolean;
  /** An HLS or DASH stream rather than one file. */
  stream: boolean;
  /** Eight equal stretches of the file, each 0..1 filled: the connection bar. */
  segments: number[];
  error: string;
  /** A note on a finished download that is not an error ("Saved as two files: ffmpeg not found"). */
  note: string;
  /** The finished file is no longer on disk. */
  missing: boolean;
  startedAt: number;
  finishedAt: number;
  /** '1080p' for a video chosen in the picker. */
  quality: string;
  /** Ties a download to the video it came from, so the hover pill can show its progress. */
  videoKey: string;
  limitKBps: number;
  /** Position in the queue (1 = next), 0 when not queued. */
  queuePos: number;
  /** Who moves the bytes: Deer's engine, or Firefox for blob:, data:, POST answers and extensions. */
  engine: 'vitre' | 'browser';
  isPrivate: boolean;
  /**
   * The container (Firefox's userContextId, 0 for none) the download's requests are made in. The pill on a page
   * opened again continues a stream row only from a tab in the same container (RESUME-DESIGN.md 2.1; review of
   * Phase 6).
   */
  userContextId: number;
  /** Safe Browsing blocked the finished file ('' when it did not): the row's error says why. */
  blocked: '' | 'dangerous' | 'uncommon' | 'unwanted';
  /** The blocked file waits aside and may be kept anyway (engine keep(id)). */
  keepable: boolean;
  /**
   * A paused row that needs the person (RESUME-DESIGN.md 6), null otherwise. 'address': Link expired
   * (`status` is the HTTP status that refused it, 0 for an answer that was a page); 'choice': File
   * changed (`evidence` says what differed, "was 24 MB, now 23 MB"). The saved bytes are kept either way.
   */
  need: { kind: NeedKind; status: number; evidence: string } | null;
  /**
   * A paused row Deer comes back to by itself: what for, how many attempts so far, when the next is (0: none
   * planned). With no `need`, a 'network', 'server' or 'sleep' wait is still under way for the person
   * (format.ts isWaiting(): Waiting for network, Retrying), and Pause ends it.
   */
  wait: { for: WaitFor; tries: number; nextAt: number } | null;
  /** When the next automatic attempt runs ("next try 14:05"), 0 when none is planned. */
  nextAt: number;
  /** The HTTP status behind Link expired, Renewing link or Retrying, 0 when there is none (an answer that was a page). */
  status: number;
  /** The row's last history lines, oldest first ("New link found", with when): every automatic fix leaves one. */
  history: { at: number; text: string }[];
  /**
   * A Link expired row Refresh address armed (RESUME-DESIGN.md G1 manual fallback, Phase 3): Deer waits
   * for the person to start the download again on its page (Waiting for link) and attaches that start
   * to this row; it lasts 30 minutes.
   */
  armed: boolean;
  /** Refresh address can run for this row: a one-file download Deer moves itself, with saved bytes (RESUME-DESIGN.md 5.5). */
  canRenew: boolean;
  /**
   * The row started needing the person during this session (RESUME-DESIGN.md 6): the ring's dot and its
   * "needs attention" label. Rows that already needed the person when Deer started don't count.
   */
  attention: boolean;
  /**
   * File changed (need 'choice') on a one-file download: what Keep partial file saves, the unbroken
   * beginning from byte 0, and the name it takes ("song (partial).mp3"; RESUME-DESIGN.md 3 G3). Null
   * when there is nothing to keep. `older`: an earlier Start over set a partial file aside
   * ("<name>.old.part"), which Keep partial deletes too, as the row says (review of Phase 3). A stream
   * (Phase 6): its written segments merged, cut to the shorter track: `secs` of `of` seconds ("Keeps 2:41
   * of 4:05"); `bytes` is what is written.
   */
  keep: { bytes: number; name: string; older: boolean; secs?: number; of?: number } | null;
  /**
   * A stream's stable key (RESUME-DESIGN.md G2, 5.1; Phase 6, streamkey.ts): the page's origin and path,
   * the rounded duration and the title; 'ytdlp|<webpage_url>' for yt-dlp. The pill on the page opened
   * again finds this row by it (videoKey changes with the session and the signed address). '' otherwise.
   */
  streamKey: string;
  /**
   * A finished file's last Check file (RESUME-DESIGN.md 4.2, 6; Phase 5), null when it was never checked.
   * `bad` damaged parts (`badBytes`): Damaged (need 'repair'); `unlocated`: its checksum no longer
   * matches and nothing says where (Repair compares it with the site); `edited`: modified after it
   * finished (`changedAt`), Changed after download, never damage; `media`: what ffmpeg found wrong in it;
   * `site`: what the last Repair found at the site ('changed': another file, Repair refused; 'expired':
   * the link no longer works; 'unreachable').
   */
  check: { at: number; ok: boolean; bad: number; badBytes: number; unlocated: boolean; edited: boolean; changedAt: number; media: string; site: '' | 'changed' | 'expired' | 'unreachable'; status: number } | null;
  /** Repairing (RESUME-DESIGN.md 6): how many damaged parts are fetched again, and their size. */
  repair: { parts: number; bytes: number } | null;
}

/**
 * What Refresh address did (engine refreshAddress(), RESUME-DESIGN.md G1 manual fallback): 'renewed', a
 * new address proven to be the same file was found and the row carries on; 'changed', the file on the
 * site is another one (File changed); 'page', nothing was found and the window opens `pageUrl` in a
 * foreground tab in the download's container, then arms the row (engine arm()); 'none', nothing was
 * found and the row has no page; 'busy', the row can't be refreshed now.
 */
export interface RefreshResult {
  kind: 'renewed' | 'changed' | 'page' | 'none' | 'busy';
  pageUrl: string;
  userContextId: number;
  isPrivate: boolean;
}

/**
 * A download's source page as engine openPage() gives it (Open page, From page): where to open it, in
 * which container and privacy, and whether the window arms the row once its tab is open (a Link
 * expired file download: engine arm(id, browserId)).
 */
export interface PageTarget {
  pageUrl: string;
  userContextId: number;
  isPrivate: boolean;
  arm: boolean;
}

/**
 * A link a page shows, as the read-only 'downloads:links' page query reports it (src/actors/page/downloads.ts;
 * RESUME-DESIGN.md G1 step 3, Phase 7): its absolute http(s) address, its text, and its download attribute
 * (null when it has none, '' when it has one with no name).
 */
export interface PageLink {
  href: string;
  text: string;
  download: string | null;
}

/** A media address MediaWatch saw under the hidden page's tab (media.ts candidates()). */
export interface PageMedia {
  url: string;
  kind: 'hls' | 'dash' | 'video' | 'audio';
  bytes: number;
  frameUrl: string;
}

/**
 * What the background page step saw on a download's page (RESUME-DESIGN.md G1 step 3, G2 step 4; Phase 7),
 * as the window's resolver (src/window/modules/downloads/resolver.ts) hands it to the engine:
 *   outcome   'ok' the page loaded on the download's site; 'elsewhere' it landed on another site (a sign-in
 *             service); 'timeout' it did not finish loading in time (what it had is kept); 'failed' no page
 *             could be opened; 'aborted' the attempt was stopped (Pause, Cancel, a quit)
 *   password  a password field showed in one of its frames (it may need the person to sign in)
 *   links     its links (every frame), video the main video's address ('downloads:main-video'), media what
 *             MediaWatch saw under its tab, protected the tab used DRM
 *   principal / cookieJarSettings   the top document's principal and cookie jar, serialized (E10SUtils): the
 *             identity its links are asked with, as Alt+click's (video.ts altClick())
 */
export interface PageSeen {
  outcome: 'ok' | 'elsewhere' | 'timeout' | 'failed' | 'aborted';
  finalUrl: string;
  browserId: number;
  password: boolean;
  links: PageLink[];
  video: string;
  media: PageMedia[];
  protected: boolean;
  principal: string;
  cookieJarSettings: string;
}

/**
 * One background page step, for the window that runs it (engine setResolver(); RESUME-DESIGN.md G1 step 3,
 * Phase 7): open `pageUrl` in a hidden, muted tab of the download's container (`userContextId`) and privacy,
 * give the engine the tab's browserId as soon as it exists (`opened`: the claim registry), let it load for at
 * most `loadMs` and collect for at most `collectMs` (`enough` ends either early), then close it without a
 * trace. `signal` stops it.
 */
export interface PageJob {
  id: string;
  pageUrl: string;
  userContextId: number;
  isPrivate: boolean;
  loadMs: number;
  collectMs: number;
  opened(browserId: number, contexts: number[]): void;
  enough(seen: PageSeen): boolean;
  signal: AbortSignal;
}

/** A window's background page step (engine setResolver(win, fn)). */
export type PageResolver = (job: PageJob) => Promise<PageSeen>;

/**
 * What "Use another address…" made of an address (engine setAddress(), RESUME-DESIGN.md 6). ok: it is
 * the same file and the download continues from it. Otherwise `note` is the sentence to show; with
 * 'different' or 'unknown' the person may use it anyway and start over.
 */
export interface AddressResult {
  ok: boolean;
  kind: '' | 'different' | 'unknown' | 'page' | 'unreachable' | 'busy';
  note: string;
}

export interface StartOptions {
  filename?: string;
  /** The filename must be kept as given (the person or the picker chose it). */
  named?: boolean;
  title?: string;
  pageUrl?: string;
  identity?: Partial<IdentityJSON>;
  /** 'hls' / 'dash' for a stream; 'file' for one file; 'auto' decides from the address. */
  mode?: 'auto' | 'file' | 'hls' | 'dash' | 'ytdlp';
  /** yt-dlp: the format ('137+140') and the file's extension; the address is the page's. */
  ytdlpFormat?: string;
  ytdlpExt?: string;
  /** HLS: the media playlist that was chosen, and a separate audio rendition when the stream has one. */
  variantUrl?: string;
  audioUrl?: string;
  /** DASH: the representations chosen (ids in the manifest). */
  dashVideo?: string;
  dashAudio?: string;
  /** Streams: download only the audio. */
  audioOnly?: boolean;
  quality?: string;
  /** The picker's size estimate, shown until the stream's own measurements take over. */
  bytes?: number;
  videoKey?: string;
  /** Streams: the chosen quality's fingerprint (RESUME-DESIGN.md 5.3), so a master read again re-picks it. */
  rung?: StreamRung;
  /** Streams: the stable key the pill finds the row by on the page opened again (streamkey.ts; G2). */
  streamKey?: string;
  dir?: string;
  /** Ask where to save this one (Save link as…), whatever the setting says. */
  saveAs?: boolean;
  /** Window point where the download started, for the flight to the ring (the window's own business). */
  origin?: { x: number; y: number };
  /** The browserId of the tab it came from: the window that owns that tab flies it. */
  browserId?: number;
}

/**
 * Engine -> windows. One event per change batch (about four a second while downloading). 'attached'
 * (RESUME-DESIGN.md G1, Phase 3): a download started again on its page (a click, Alt+click, Add link,
 * the 'downloads' service) proved to be a waiting row's file and continues that row: no new row; it
 * flies from the tab like 'added' (browserId, origin). 'added' with `replaces`: start() returned that
 * waiting row's id, then its proof said the address was another file, and this new row is the start.
 */
export type DownloadEvent =
  | { kind: 'added'; view: DownloadView; origin: { x: number; y: number } | null; browserId: number; replaces?: string }
  | { kind: 'attached'; view: DownloadView; origin: { x: number; y: number } | null; browserId: number }
  | { kind: 'update'; views: DownloadView[] }
  | { kind: 'removed'; ids: string[] };

/** What the page module reports about a video element (CSS px of the top document's viewport). */
export interface PageVideo {
  id: number;
  kind: 'video' | 'frame';
  rect: { x: number; y: number; w: number; h: number };
  src: string;
  duration: number;
  width: number;
  height: number;
  protected: boolean;
  live: boolean;
  title: string;
  frameSrc: string;
  /**
   * The page's visible area (documentElement client size, CSS px: without its scrollbars), when the
   * page module reported it: the pill stays inside it, never over the page's scrollbar.
   */
  view?: { w: number; h: number };
}

export interface VideoOption {
  id: string;
  group: 'video' | 'audio';
  /** "1080p", "720p", "M4A". */
  label: string;
  /** Plain dim text beside the label ("4K", "128 kbps"). */
  detail: string;
  /** Section heading container, "MP4", "TS", "WEBM". */
  container: string;
  bytes: number;
  height: number;
  url: string;
  mode: 'file' | 'hls' | 'dash' | 'ytdlp';
  variantUrl: string;
  audioUrl: string;
  dashVideo: string;
  dashAudio: string;
  /** Joining video and audio (or repackaging) needs ffmpeg for this option. */
  needsMux: boolean;
  /** yt-dlp: the format to ask for ('137+140') and the file's extension. */
  ytdlpFormat: string;
  ytdlpExt: string;
  /** Streams: the quality's fingerprint (RESUME-DESIGN.md 5.3), passed to the download (StartOptions.rung). */
  rung?: StreamRung;
}

/**
 * A stream's quality by its fingerprint (RESUME-DESIGN.md 5.3 rung; Phase 6, table.ts): what re-picks the
 * same quality in a master playlist or a manifest read again. HLS: the variant's height, width, bandwidth,
 * average bandwidth, codecs and audioOnly, and its audio rendition's GROUP-ID, language and name. DASH: the
 * representation's id, kind, mime, codecs, height and bandwidth (and its language for audio).
 */
export interface StreamRung {
  height?: number;
  width?: number;
  bandwidth?: number;
  average?: number;
  codecs?: string;
  audioOnly?: boolean;
  audioGroup?: string;
  audioLang?: string;
  audioName?: string;
  id?: string;
  kind?: 'video' | 'audio';
  mime?: string;
  /** DASH: the audio representation that plays with the video. */
  audio?: StreamRung;
}

/**
 * What the pill's Continue did (engine renewWith(), RESUME-DESIGN.md G2 manual fallback): 'continued', the
 * old row continues from the page's fresh addresses (its proof runs as it starts); 'changed', another
 * quality was chosen than the row's, which is now File changed; 'busy', the row can't be continued now.
 */
export type RenewWithResult = 'continued' | 'changed' | 'busy';

export interface VideoOffer {
  state: 'ok' | 'protected' | 'live' | 'none';
  key: string;
  title: string;
  host: string;
  duration: number;
  options: VideoOption[];
  suggested: string;
  /** ffmpeg was found (else options with needsMux save separate files). */
  muxer: boolean;
  /** Why there is nothing to offer ('none'), in a sentence for the person, when it is known. */
  reason?: string;
  /** 'none' because yt-dlp is needed for this site and is not installed. */
  needsTools?: boolean;
  /**
   * The page the media's requests go out as (Referer, Origin, loading principal) when it is not the
   * tab's page: the embedded player's frame, because the server refused the tab's page. The download
   * goes out the same way.
   */
  requestPage?: string;
}

/** A tab's media, as the download mark counts it. */
export interface MediaNotice {
  browserId: number;
  /** Downloadable media addresses the page has loaded (DASH included). */
  count: number;
  /** The page uses DRM (EME): nothing is offered. */
  protected: boolean;
}

/** Where ffmpeg is, and how it was found. */
export interface FfmpegInfo {
  path: string | null;
  /** 'downloaded': the copy Deer downloaded for the person (ffmpeg-install.ts), in Deer's folder or the old Vitre one. */
  source: 'settings' | 'bundled' | 'downloaded' | 'path' | 'none';
  /** The path in settings points at nothing usable. */
  settingBroken: boolean;
}
