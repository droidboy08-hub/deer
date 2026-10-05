// Shapes shared by the downloads engine (main process) and its UI (chrome renderer and page
// preload). Types only: the renderer imports this file with `import type`.

export type DownloadState = 'starting' | 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type Category = 'video' | 'music' | 'documents' | 'compressed' | 'programs' | 'images' | 'other';

/** What the renderer is told about one download (sent on dl:list and dl:update). */
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
  /** Bytes per second, smoothed over the last few seconds. */
  speed: number;
  peak: number;
  average: number;
  /** Seconds left, or -1. */
  eta: number;
  connections: number;
  maxConnections: number;
  resumable: boolean;
  /** An HLS stream rather than one file. */
  stream: boolean;
  /** Eight equal stretches of the file, each 0..1 filled: the connection bar. */
  segments: number[];
  error: string;
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
  /** Who moves the bytes: Vitre's engine, or Chromium for blob:, data: and POST-only downloads. */
  engine: 'vitre' | 'browser';
}

export interface StartOptions {
  filename?: string;
  title?: string;
  pageUrl?: string;
  webContentsId?: number;
  /** 'hls' for a stream; 'file' for one file; default decides from the address. */
  mode?: 'auto' | 'file' | 'hls';
  /** HLS: the media playlist that was chosen, and a separate audio rendition when the stream has one. */
  variantUrl?: string;
  audioUrl?: string;
  /** HLS: download only the audio. */
  audioOnly?: boolean;
  quality?: string;
  /** The picker's size estimate, shown until the stream's own measurements take over. */
  bytes?: number;
  videoKey?: string;
  /** Window point where the download started, for the flight to the ring. */
  origin?: { x: number; y: number };
  dir?: string;
}

/** Sent with dl:added so the renderer can fly the new download to the ring. */
export interface AddedEvent {
  view: DownloadView;
  origin: { x: number; y: number } | null;
}

/** What the page module reports about a video element (page CSS pixels). */
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
}

export interface VideoOption {
  id: string;
  group: 'video' | 'audio';
  /** "1080p", "720p", "M4A". */
  label: string;
  /** Plain dim text beside the label ("4K", "128 kbps"). */
  detail: string;
  /** Section heading container, "MP4" or "TS". */
  container: string;
  bytes: number;
  height: number;
  url: string;
  mode: 'file' | 'hls';
  variantUrl: string;
  audioUrl: string;
}

export interface VideoOffer {
  state: 'ok' | 'protected' | 'live' | 'none';
  key: string;
  title: string;
  host: string;
  duration: number;
  options: VideoOption[];
  suggested: string;
}

export interface MediaNotice {
  webContentsId: number;
  /** How many downloadable media addresses the page has loaded. */
  count: number;
}
