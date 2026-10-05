// Numbers and words for the downloads UI: "1.2 GB", "18.4 MB/s", "38 s", "Today, 21:31".
import type { Category, DownloadView } from '../../../main/modules/downloads/types';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function bytes(n: number): string {
  if (!(n >= 0)) return '';
  if (n < KB) return `${n} bytes`;
  if (n < MB) return `${Math.max(1, Math.round(n / KB))} KB`;
  if (n < GB) return n < 10 * MB ? `${(n / MB).toFixed(1)} MB` : `${Math.round(n / MB)} MB`;
  return n < 100 * GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / GB)} GB`;
}

export function speed(bps: number): string {
  if (!(bps > 0)) return '';
  if (bps < MB) return `${Math.max(1, Math.round(bps / KB))} KB/s`;
  return `${(bps / MB).toFixed(1)} MB/s`;
}

export function eta(seconds: number): string {
  if (!(seconds >= 0)) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today, 21:31", "Yesterday, 20:10", "30 Sep, 18:02". */
export function when(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= start) return `Today, ${clock(ms)}`;
  if (ms >= start - 86_400_000) return `Yesterday, ${clock(ms)}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock(ms)}`;
}

/** Finish time for the Time column: the clock today, the date before that. */
export function finished(ms: number): string {
  if (!ms) return '';
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return ms >= start ? clock(ms) : new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function duration(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The file-type tile: "MP4", "ZIP", "GZ". */
export function tile(filename: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename);
  return m ? m[1].slice(0, 4).toUpperCase() : 'FILE';
}

export const CATEGORY_LABEL: Record<Category, string> = {
  video: 'Video',
  music: 'Music',
  documents: 'Documents',
  compressed: 'Compressed',
  programs: 'Programs',
  images: 'Images',
  other: 'Other',
};

export function percent(v: DownloadView): number {
  if (v.state === 'completed') return 100;
  return v.total > 0 ? Math.min(100, Math.floor((v.received / v.total) * 100)) : 0;
}

/** An address without its scheme, for display. */
export function bare(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '');
}

export function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const isActive = (v: DownloadView) => v.state === 'downloading' || v.state === 'starting' || v.state === 'queued';
export const isFinished = (v: DownloadView) => v.state === 'completed' || v.state === 'failed' || v.state === 'cancelled';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
