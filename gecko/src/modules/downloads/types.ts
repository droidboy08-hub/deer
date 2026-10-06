// Shapes shared by the downloads engine (VitreDownloads.sys.ts and src/modules/downloads/*) and
// its window UI (src/window/modules/downloads). Types only: window code imports this file with
// `import type`. Same shapes as the Electron build's app/src/main/modules/downloads/types.ts, plus
// what Gecko adds (the cookie jar a download belongs to, DASH, the "ffmpeg not found" state).

export type DownloadState = 'starting' | 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

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
  /** '' while transferring; 'probing' before the first byte; 'merging' while ffmpeg joins a stream. */
  phase: '' | 'probing' | 'merging';
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
  /** Safe Browsing blocked the finished file ('' when it did not): the row's error says why. */
  blocked: '' | 'dangerous' | 'uncommon' | 'unwanted';
  /** The blocked file waits aside and may be kept anyway (engine keep(id)). */
  keepable: boolean;
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
  dir?: string;
  /** Ask where to save this one (Save link as…), whatever the setting says. */
  saveAs?: boolean;
  /** Window point where the download started, for the flight to the ring (the window's own business). */
  origin?: { x: number; y: number };
  /** The browserId of the tab it came from: the window that owns that tab flies it. */
  browserId?: number;
}

/** Engine -> windows. One event per change batch (about four a second while downloading). */
export type DownloadEvent =
  | { kind: 'added'; view: DownloadView; origin: { x: number; y: number } | null; browserId: number }
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
}

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
