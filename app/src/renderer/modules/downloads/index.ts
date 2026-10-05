// Downloads in the chrome renderer: the panel (Ctrl+J), the ring and its quick view, the
// "Download this video" pill and picker (Ctrl+Shift+D), and the flight of new downloads.
import type { Browser } from '../../app';
import { CSS } from './css';
import { Panel } from './panel';
import { Ring } from './ring';
import { DownloadStore } from './store';
import { VideoUI } from './video';

export function install(b: Browser): void {
  b.css('downloads', CSS);
  const store = new DownloadStore();
  const panel = new Panel(b, store);
  const ring = new Ring(b, store, panel);
  const video = new VideoUI(b, store, ring, panel);
  b.registerAction('downloads', () => panel.toggle());
  b.registerAction('downloadVideo', () => void video.downloadVideo(true));
  // For other modules (menus, peek): window.dispatchEvent(new CustomEvent('vitre:download', { detail: { url, origin } })).
  window.addEventListener('vitre:download', (e) => {
    const d = (e as CustomEvent<{ url?: string; origin?: { x: number; y: number }; pageUrl?: string; filename?: string }>).detail;
    if (d?.url) void store.start(d.url, { origin: d.origin, pageUrl: d.pageUrl, filename: d.filename });
  });
}
